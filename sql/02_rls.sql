-- ============================================================================
-- OLE Signals — 02_rls.sql
-- Row Level Security. Jalankan SETELAH 01_schema.sql, SEBELUM 03_functions.sql.
--
-- Prinsip keamanan (perintah user 23 Nov 2026: "keamanan yang utama"):
--   1. RLS AKTIF di semua tabel — tanpa kecuali.
--   2. Baca publik untuk data marketplace (profil trader, sinyal terbuka,
--      progres/leaderboard, harga). Data pribadi hanya pemiliknya.
--   3. TIDAK ADA tulis langsung dari klien ke: signals, trader_progress,
--      prices, audit_log, subscriptions. Semua tulis sinyal HANYA lewat
--      fungsi RPC SECURITY DEFINER (03_functions.sql). service_role
--      (Edge Functions) melewati RLS dan HANYA dipakai server-side —
--      kunci service_role TIDAK PERNAH masuk kode frontend.
--   4. GRANT di bawah ini memberi hak PostgREST; RLS tetap yang memutuskan
--      baris mana yang boleh diakses. Tanpa policy yang cocok, akses
--      DITOLAK walaupun GRANT ada.
-- ============================================================================

alter table public.profiles        enable row level security;
alter table public.traders         enable row level security;
alter table public.signals         enable row level security;
alter table public.trader_progress enable row level security;
alter table public.follows         enable row level security;
alter table public.subscriptions   enable row level security;
alter table public.notifications   enable row level security;
alter table public.prices          enable row level security;
alter table public.copies          enable row level security;
alter table public.audit_log       enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- Data publik marketplace (username, nama, avatar, wilayah, badge
-- Terverifikasi). Siapa pun boleh membaca, termasuk pengunjung anon.
drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public"
  on public.profiles for select to anon, authenticated using (true);

-- Pemilik boleh mengubah profilnya sendiri. Kolom kyc_* TIDAK boleh diubah
-- lewat sini — dijaga trigger guard_profile_kyc_columns() di bawah.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- TIDAK ADA policy INSERT untuk klien: baris profil dibuat trigger
-- handle_new_user() saat akun Auth dibuat (03_functions.sql).

-- Penjaga: pemilik (authenticated) tidak boleh mengubah kolom kyc_*.
-- Hanya service_role yang boleh — service_role tidak punya JWT user
-- sehingga auth.uid() = NULL. Dipakai webhook Zyphe (Edge Function).
create or replace function public.guard_profile_kyc_columns()
returns trigger
language plpgsql
as $func$
begin
  if auth.uid() is not null
     and (new.kyc_status, new.kyc_full_name, new.kyc_provider, new.kyc_reference,
          new.kyc_submitted_at, new.kyc_verified_at, new.kyc_reject_reason)
         is distinct from
         (old.kyc_status, old.kyc_full_name, old.kyc_provider, old.kyc_reference,
          old.kyc_submitted_at, old.kyc_verified_at, old.kyc_reject_reason) then
    raise exception 'Kolom KYC hanya boleh diubah oleh sistem (Zyphe webhook).'
      using errcode = '42501';
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_guard_profile_kyc_columns on public.profiles;
create trigger trg_guard_profile_kyc_columns
  before update on public.profiles
  for each row execute function public.guard_profile_kyc_columns();

-- ---------------------------------------------------------------------------
-- traders
-- ---------------------------------------------------------------------------
drop policy if exists "traders_select_public" on public.traders;
create policy "traders_select_public"
  on public.traders for select to anon, authenticated using (true);

drop policy if exists "traders_insert_own" on public.traders;
create policy "traders_insert_own"
  on public.traders for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "traders_update_own" on public.traders;
create policy "traders_update_own"
  on public.traders for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- TIDAK ADA policy DELETE: identitas trader tidak dihapus dari aplikasi.

-- ---------------------------------------------------------------------------
-- signals — PALING KETAT
-- ---------------------------------------------------------------------------
-- Baca: siapa pun boleh membaca sinyal, KECUALI yang dibatalkan — sinyal
-- CANCELLED hanya terlihat pemiliknya (AC-CANCEL-05: hilang dari beranda /
-- profil / statistik publik; AC-CANCEL-06: catatan internal tetap disimpan).
drop policy if exists "signals_select_public" on public.signals;
create policy "signals_select_public"
  on public.signals for select to anon, authenticated
  using (status <> 'CANCELLED' or trader_id = auth.uid());

-- TIDAK ADA policy INSERT / UPDATE / DELETE untuk anon maupun authenticated.
-- Semua tulis sinyal HANYA lewat fungsi RPC SECURITY DEFINER
-- (create_signal / update_signal / cancel_signal, 03_functions.sql).
-- Settlement (Fase 3) memakai service_role dan melewati RLS.

-- ---------------------------------------------------------------------------
-- trader_progress — dibaca publik (level, saldo, leaderboard), ditulis
-- HANYA fungsi sistem (recalc_trader_progress, Fase 4).
-- ---------------------------------------------------------------------------
drop policy if exists "trader_progress_select_public" on public.trader_progress;
create policy "trader_progress_select_public"
  on public.trader_progress for select to anon, authenticated using (true);

-- TIDAK ADA policy tulis untuk klien.

-- ---------------------------------------------------------------------------
-- follows — Ikuti = monitoring gratis.
-- ---------------------------------------------------------------------------
drop policy if exists "follows_select_public" on public.follows;
create policy "follows_select_public"
  on public.follows for select to anon, authenticated using (true);

drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own"
  on public.follows for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own"
  on public.follows for delete to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------------
-- subscriptions — TIDAK DIPAKAI DI MVP (blueprint §8).
-- Baca hanya pihak terkait; TIDAK ADA tulis untuk klien sama sekali.
-- ---------------------------------------------------------------------------
drop policy if exists "subscriptions_select_parties" on public.subscriptions;
create policy "subscriptions_select_parties"
  on public.subscriptions for select to authenticated
  using (follower_id = auth.uid() or trader_id = auth.uid());

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- Pemilik boleh menandai sudah dibaca. Isi notifikasi tidak boleh diubah —
-- dijaga trigger guard_notification_update() di bawah.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- TIDAK ADA policy INSERT / DELETE untuk klien: notifikasi dibuat sistem.

create or replace function public.guard_notification_update()
returns trigger
language plpgsql
as $func$
begin
  if (new.user_id, new.type, new.title, new.message, new.signal_id, new.created_at)
     is distinct from
     (old.user_id, old.type, old.title, old.message, old.signal_id, old.created_at) then
    raise exception 'Notifikasi hanya boleh ditandai sudah dibaca.'
      using errcode = '42501';
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_guard_notification_update on public.notifications;
create trigger trg_guard_notification_update
  before update on public.notifications
  for each row execute function public.guard_notification_update();

-- ---------------------------------------------------------------------------
-- prices — dibaca publik; ditulis HANYA fetcher (service_role).
-- ---------------------------------------------------------------------------
drop policy if exists "prices_select_public" on public.prices;
create policy "prices_select_public"
  on public.prices for select to anon, authenticated using (true);

-- TIDAK ADA policy tulis untuk klien.

-- ---------------------------------------------------------------------------
-- copies — salinan sinyal follower.
-- ---------------------------------------------------------------------------
drop policy if exists "copies_select_own_or_trader" on public.copies;
create policy "copies_select_own_or_trader"
  on public.copies for select to authenticated
  using (
    follower_id = auth.uid()
    or exists (
      select 1 from public.signals s
      where s.id = copies.signal_id and s.trader_id = auth.uid()
    )
  );

drop policy if exists "copies_insert_own" on public.copies;
create policy "copies_insert_own"
  on public.copies for insert to authenticated
  with check (follower_id = auth.uid());

drop policy if exists "copies_delete_own" on public.copies;
create policy "copies_delete_own"
  on public.copies for delete to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log — jejak audit (AC-GEN-06).
-- Baca: pemilik jejaknya sendiri + admin. TIDAK ADA tulis untuk klien:
-- log hanya ditulis fungsi SECURITY DEFINER (03_functions.sql).
-- ---------------------------------------------------------------------------
drop policy if exists "audit_log_select_own" on public.audit_log;
create policy "audit_log_select_own"
  on public.audit_log for select to authenticated
  using (actor_id = auth.uid());

drop policy if exists "audit_log_select_admin" on public.audit_log;
create policy "audit_log_select_admin"
  on public.audit_log for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin
    )
  );

-- ---------------------------------------------------------------------------
-- GRANT — hak PostgREST. RLS tetap yang memutuskan baris mana boleh
-- diakses; tanpa policy yang cocok, akses DITOLAK walaupun GRANT ada.
-- Sengaja TIDAK ADA grant insert/update/delete untuk authenticated pada:
-- signals, trader_progress, prices, audit_log, subscriptions.
-- ---------------------------------------------------------------------------
grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;

grant select on public.traders to anon, authenticated;
grant insert, update on public.traders to authenticated;

grant select on public.signals to anon, authenticated;

grant select on public.trader_progress to anon, authenticated;

grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

grant select on public.subscriptions to authenticated;

grant select on public.notifications to authenticated;
grant update on public.notifications to authenticated;

grant select on public.prices to anon, authenticated;

grant select on public.copies to authenticated;
grant insert, delete on public.copies to authenticated;

grant select on public.audit_log to authenticated;
