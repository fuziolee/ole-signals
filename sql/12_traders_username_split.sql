-- ============================================================================
-- OLE Signals — 12_traders_username_split.sql
-- Ronde 6b (diputuskan user 23 Nov 2026 23:23 WIB): username trader
-- DIPISAH dari username follower, mengikuti model prototipe.
--
-- Sebelum ronde 6b, tabel traders TIDAK punya kolom username — satu-satunya
-- username adalah profiles.username, sehingga mengisi "username trader" di
-- Akun Trader diam-diam menimpa username follower juga. Setelah migrasi ini:
--   * traders.username  = username TRADER (publik: feed, Cari, Peringkat,
--     profil trader, overlay detail, kartu bagikan, dst. — aturan ronde 5).
--   * profiles.username = username FOLLOWER (kartu Info akun follower,
--     Profil akun, Pengaturan -> Akun).
-- Keunikan ditegakkan PER-JENIS (aturan prototipe usernameTaken(kind, v)):
-- string yang sama boleh dipakai sebagai username trader oleh satu orang
-- dan sebagai username follower oleh orang lain.
--
-- URUTAN DEPLOY — WAJIB:
--   1. Terapkan file ini di SQL Editor (Supabase Dashboard).
--   2. Terapkan ulang sql/03_functions.sql (setup_trader_identity yang
--      baru menulis traders.username, bukan profiles.username).
--   3. BARU deploy kode frontend baru (js/api.js + js/app.js membaca
--      traders.username). Kode baru yang jalan SEBELUM langkah 1 akan
--      gagal: query traders.username error "column does not exist".
--
-- Aturan case-sensitivity: SAMA dengan profiles.username — unique index
-- biasa Postgres (case-sensitive, byte-wise). 'Trader_Tes' dan 'trader_tes'
-- dianggap berbeda, persis seperti di profiles.username. (Prototipe
-- memeriksa taken secara case-insensitive; bila nanti diputuskan aturan
-- itu yang dipakai, tambahkan unique index fungsional lower(username)
-- di KEDUA tabel — jangan ubah satu tabel saja.)
--
-- Pertahanan berlapis untuk traders.username (sama seperti profiles):
-- format CHECK + unique index + trigger nama dilindungi. Ketiganya berlaku
-- JUGA untuk tulis langsung dari klien (kebijakan traders_update_own
-- mengizinkan pemilik memperbarui baris traders-nya sendiri — diperlukan
-- upload avatar — jadi validasi tidak boleh hanya di RPC).
-- TIDAK ADA kredensial di file ini.
-- ============================================================================

-- 1. Kolom baru (nullable dulu supaya backfill bisa jalan).
alter table public.traders
  add column if not exists username text;

-- 2. Backfill dari username follower masing-masing (4 trader yang sudah
-- ada: akun tes + 3 demo). Trader yang profiles.username-nya NULL tidak
-- ikut terisi — penjaga di langkah 3 akan menggagalkan migrasi bila ada.
update public.traders t
   set username = p.username
  from public.profiles p
 where p.id = t.profile_id
   and t.username is null
   and p.username is not null;

-- 3. Penjaga: tidak boleh ada traders.username NULL setelah backfill.
do $$
begin
  if exists (select 1 from public.traders where username is null) then
    raise exception 'Backfill gagal: masih ada traders.username NULL. Periksa trader tanpa username di profiles sebelum lanjut.';
  end if;
end $$;

-- 4. NOT NULL + format (regex yang sama dengan profiles_username_format
-- di 01_schema.sql).
alter table public.traders
  alter column username set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'traders_username_format'
      and conrelid = 'public.traders'::regclass
  ) then
    alter table public.traders
      add constraint traders_username_format
        check (username ~ '^[A-Za-z0-9_][A-Za-z0-9_.]{2,29}$');
  end if;
end $$;

-- 5. Keunikan per-jenis: username trader unik di antara trader saja
-- (bukan terhadap profiles.username).
create unique index if not exists traders_username_uidx
  on public.traders (username);

-- 6. Nama yang dilindungi (admin/support/dll., termasuk varian leet)
-- ditolak di level database — cerminan guard_profile_username di
-- 01_schema.sql, memakai fungsi is_reserved_username yang sama.
create or replace function public.guard_trader_username()
returns trigger
language plpgsql
as $func$
begin
  if new.username is not null and public.is_reserved_username(new.username) then
    raise exception 'Username tidak boleh dipakai (nama yang dilindungi).'
      using errcode = '23514';
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_guard_trader_username on public.traders;
create trigger trg_guard_trader_username
  before insert or update of username on public.traders
  for each row execute function public.guard_trader_username();

-- 7. Komentar tabel diperbarui.
comment on table public.traders is
  'Identitas trader (terpisah dari profil follower). Satu baris per pengguna. Username trader (traders.username) terpisah dari username follower (profiles.username) — ronde 6b.';

-- ---------------------------------------------------------------------------
-- Verifikasi setelah menjalankan (SQL Editor):
--   select profile_id, username from public.traders order by username;
--     -> 4 baris: demo_alpha, demo_beta, demo_gamma, trader_tes.
--   select username from public.profiles where username is not null;
--     -> TIDAK berubah (backfill hanya membaca profiles, tidak menulisnya).
-- Perilaku RPC diuji blok R6B di sql/04_verify_tests.sql (setelah
-- 03_functions.sql yang baru diterapkan).
-- ---------------------------------------------------------------------------
