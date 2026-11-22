-- ============================================================================
-- OLE Signals — 01_schema.sql
-- Skema database (Supabase Postgres). Jalankan PERTAMA di SQL Editor.
--
-- Sumber: blueprint §4 (tabel), §5 (aturan), §12 (bug audit — salinan
-- sinyal butuh tabel `copies`), §13 (kolom KYC di `profiles`).
-- TANPA data seed: keputusan user — mulai kosong, 15 trader prototipe
-- TIDAK dimigrasi.
-- TIDAK ADA pembayaran/QRIS di file ini: tabel `subscriptions` ada tapi
-- TIDAK DIPAKAI di MVP (pembayaran dibangun TERAKHIR, setelah luncur).
-- TIDAK ADA password/kunci di file ini.
--
-- Urutan pakai: 01_schema.sql -> 02_rls.sql -> 03_functions.sql
-- Semua perintah idempotent (IF NOT EXISTS / OR REPLACE) sehingga file
-- ini aman dijalankan ulang.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles — satu baris per pengguna (auth.users). Identitas follower.
-- Username dibuat saat setup identitas trader (03_functions.sql) atau
-- diedit di Profil akun. Nama + username diedit di Profil akun.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  region text not null default 'Indonesia',
  -- Admin ditandai manual oleh pemilik (SQL/dashboard), TIDAK PERNAH
  -- lewat aplikasi. Dipakai kebijakan RLS admin (02_rls.sql).
  is_admin boolean not null default false,
  -- KYC (§13, vendor Zyphe). Platform TIDAK menyimpan dokumen apa pun:
  -- hanya status + nama terverifikasi + referensi. NIK tidak disimpan.
  kyc_status text not null default 'unverified'
    check (kyc_status in ('unverified', 'verifying', 'verified', 'rejected')),
  kyc_full_name text,
  kyc_provider text,
  kyc_reference text,
  kyc_submitted_at timestamptz,
  kyc_verified_at timestamptz,
  kyc_reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format
    check (username is null
           or username ~ '^[A-Za-z0-9_][A-Za-z0-9_.]{2,29}$')
);
comment on table public.profiles is
  'Pengguna (follower). Kolom kyc_* hanya diubah sistem/webhook Zyphe (service_role); pemilik tidak boleh mengubahnya lewat API — dijaga trigger di 02_rls.sql.';

-- ---------------------------------------------------------------------------
-- traders — identitas trader, TERPISAH dari profil follower (§5).
-- Satu akun trader per pengguna (PK = profile_id).
-- ---------------------------------------------------------------------------
create table if not exists public.traders (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  trader_display_name text not null,
  trader_avatar_url text,
  -- Harga langganan (NULL = gratis). Nilai min/maks (Rp100.000–Rp10.000.000)
  -- dan cooldown ubah harga 1x/bulan ditegakkan di FASE PEMBAYARAN
  -- (dibangun TERAKHIR, setelah luncur — blueprint §8). Di MVP kolom ini
  -- ada tapi tidak dipakai untuk menagih; yang berlaku hanya gerbang
  -- signalLocked() di Level 5+.
  subscription_price_usd numeric(12, 2)
    check (subscription_price_usd is null or subscription_price_usd >= 0),
  subscription_price_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.traders is
  'Identitas trader (terpisah dari profil follower). Satu baris per pengguna.';

-- ---------------------------------------------------------------------------
-- signals — sinyal trader.
-- Status: PENDING (bisa edit/batal) -> AKTIF (entry tersentuh, terkunci)
-- -> WIN / LOSS. CANCELLED = dibatalkan pemilik (baris tetap tersimpan
-- sebagai catatan internal, disembunyikan dari publik oleh RLS).
-- EXPIRED = kedaluwarsa otomatis oleh sistem setelah 3 hari (AC §3).
-- ---------------------------------------------------------------------------
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  trader_id uuid not null references public.traders (profile_id) on delete cascade,
  pair text not null,
  direction text not null check (direction in ('BUY', 'SELL')),
  entry numeric(20, 8) not null check (entry > 0),
  stop_loss numeric(20, 8) not null check (stop_loss > 0),
  take_profit numeric(20, 8) not null check (take_profit > 0),
  -- §12 bug #4: lot 0 / negatif / NaN tidak boleh lolos.
  lot_size numeric(10, 4) not null check (lot_size > 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'AKTIF', 'WIN', 'LOSS', 'CANCELLED', 'EXPIRED')),
  -- Optimistic locking (AC-EDIT-06): permintaan ubah membawa nomor versi.
  version integer not null default 1 check (version >= 1),
  -- Kunci idempotensi (AC-GEN-05): create dengan kunci yang sama
  -- mengembalikan sinyal yang sudah dibuat, bukan duplikat.
  idempotency_key text,
  -- Jam SERVER (AC-GEN-02): tidak pernah memakai jam klien.
  -- PENDING kedaluwarsa 3 hari sejak PERTAMA diposting; edit TIDAK
  -- memperpanjang masa berlaku (AC-EDIT-05).
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days'),
  activated_at timestamptz,
  closed_at timestamptz,
  close_price numeric(20, 8),
  profit_usd numeric(14, 2),
  profit_pips numeric(12, 2),
  r_value numeric(10, 4),
  holding_minutes integer,
  -- Anti-duplikasi (§5): sinyal yang ditandai tetap tampil berlabel,
  -- tapi TIDAK dihitung ke level/R/statistik/leaderboard.
  duplicate_of uuid references public.signals (id) on delete set null,
  duplicate_flagged boolean not null default false,
  updated_at timestamptz not null default now(),
  -- Arah harga harus konsisten: BUY = SL < entry < TP; SELL = TP < entry < SL.
  constraint signals_price_order
    check (
      (direction = 'BUY'  and stop_loss < entry and entry < take_profit) or
      (direction = 'SELL' and take_profit < entry and entry < stop_loss)
    )
);
comment on table public.signals is
  'Sinyal trader. Tulis HANYA lewat fungsi RPC SECURITY DEFINER (03_functions.sql) — tidak ada tulis langsung dari klien. Batas 2 sinyal terbuka per (trader, pair) TIDAK bisa diungkapkan sebagai unique index; ditegakkan fungsi dengan kunci baris per-trader (lihat 03_functions.sql).';

-- Hitung sinyal terbuka per (trader, pair) — dipakai fungsi batas pair.
create index if not exists signals_open_pair_idx
  on public.signals (trader_id, pair, status)
  where status in ('PENDING', 'AKTIF');
-- Riwayat + statistik per trader.
create index if not exists signals_trader_status_idx
  on public.signals (trader_id, status, created_at desc);
-- Settlement (Fase 3): cari sinyal PENDING/AKTIF per pair.
create index if not exists signals_settlement_idx
  on public.signals (pair, status)
  where status in ('PENDING', 'AKTIF');
-- Backstop idempotensi: satu kunci hanya satu sinyal per trader.
create unique index if not exists signals_idempotency_uidx
  on public.signals (trader_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- trader_progress — state level (stateful + latch, §5).
-- Diperbarui HANYA oleh fungsi sistem tiap kali sinyal ditutup (Fase 4) —
-- bukan oleh client. level_ref_balance = ref(level) = $10.000 x 1,05^(L-1),
-- tangga TETAP berlabuh di $10.000 (bukan ratchet dari saldo aktual).
-- ---------------------------------------------------------------------------
create table if not exists public.trader_progress (
  trader_id uuid primary key references public.traders (profile_id) on delete cascade,
  level integer not null default 1 check (level >= 1),
  balance_usd numeric(14, 2) not null default 10000.00 check (balance_usd >= 0),
  level_ref_balance numeric(14, 2) not null default 10000.00,
  r_since_level numeric(10, 4) not null default 0,
  -- Syarat KETIGA naik level (§5): minimal 5 trade tertutup sejak level
  -- saat ini (direset tiap kali level berubah, sama seperti R kumulatif).
  trades_since_level integer not null default 0 check (trades_since_level >= 0),
  -- Puncak saldo — dipakai menghitung max drawdown.
  peak_balance_usd numeric(14, 2) not null default 10000.00,
  max_drawdown_usd numeric(14, 2) not null default 0 check (max_drawdown_usd >= 0),
  max_drawdown_pct numeric(8, 4) not null default 0 check (max_drawdown_pct >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.trader_progress is
  'State level + saldo simulasi ($10.000 awal). Hanya ditulis fungsi sistem (recalc_trader_progress, Fase 4). Baris dibuat otomatis saat identitas trader dibuat (trigger di 03_functions.sql).';

-- ---------------------------------------------------------------------------
-- follows — Ikuti = monitoring gratis. Satu baris per (follower, trader).
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  trader_id uuid not null references public.traders (profile_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, trader_id),
  constraint follows_not_self check (follower_id <> trader_id)
);

-- ---------------------------------------------------------------------------
-- subscriptions — TABEL ADA TAPI TIDAK DIPAKAI DI MVP (blueprint §8).
-- Pembayaran dibangun TERAKHIR, setelah MVP luncur dan jalan. Jangan tulis
-- ke tabel ini dari klien; RLS di 02_rls.sql menolak semua tulis dari
-- authenticated. Struktur disiapkan supaya skema tidak berubah nanti.
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  trader_id uuid not null references public.traders (profile_id) on delete cascade,
  price_usd numeric(12, 2) not null check (price_usd >= 0),
  status text not null default 'active' check (status in ('active', 'cancelled')),
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- §12 bug #7: trader tidak bisa berlangganan ke dirinya sendiri.
  constraint subscriptions_not_self check (follower_id <> trader_id)
);
comment on table public.subscriptions is
  'TIDAK DIPAKAI DI MVP — disiapkan untuk fase pembayaran (akhir).';
create index if not exists subscriptions_follower_idx
  on public.subscriptions (follower_id, status);
create index if not exists subscriptions_trader_idx
  on public.subscriptions (trader_id, status);

-- ---------------------------------------------------------------------------
-- notifications — sinyal baru dari trader yang diikuti + hasil TP/SL +
-- perubahan/pembatalan sinyal yang disalin. Dibuat sistem, bukan klien.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  signal_id uuid references public.signals (id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- prices — cache harga live. Ditulis HANYA oleh fetcher (Edge Function
-- fetch-prices, service_role). Frontend tidak pernah memanggil API harga.
-- ---------------------------------------------------------------------------
create table if not exists public.prices (
  pair text primary key,
  price numeric(20, 8) not null check (price > 0),
  fetched_at timestamptz not null default now()
);
comment on table public.prices is
  'Cache harga live (satu baris per pair). Ditulis hanya oleh fetcher server-side.';

-- ---------------------------------------------------------------------------
-- copies — salinan sinyal follower (§12 bug #1: di prototipe salinan hanya
-- di memori; di build nyata HARUS di database). Salinan merujuk ke sinyal
-- live (bukan snapshot), sehingga edit sinyal PENDING tercermin di salinan.
-- ---------------------------------------------------------------------------
create table if not exists public.copies (
  id uuid primary key default gen_random_uuid(),
  follower_id uuid not null references public.profiles (id) on delete cascade,
  signal_id uuid not null references public.signals (id) on delete cascade,
  lot_size numeric(10, 4) check (lot_size is null or lot_size > 0),
  status text not null default 'copied' check (status in ('copied', 'closed')),
  created_at timestamptz not null default now(),
  unique (follower_id, signal_id)
);
create index if not exists copies_signal_idx on public.copies (signal_id);

-- ---------------------------------------------------------------------------
-- audit_log — jejak audit (AC-GEN-06). Setiap pembuatan, perubahan, dan
-- pembatalan sinyal tercatat: siapa, kapan, nilai sebelum dan sesudah.
-- TIDAK BISA diedit/dihapus pengguna (tidak ada policy tulis untuk klien).
-- actor_id TANPA foreign key supaya jejak tetap ada bila pengguna dihapus.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null,
  signal_id uuid references public.signals (id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
comment on table public.audit_log is
  'Jejak audit sinyal (create/update/cancel). Hanya ditulis fungsi SECURITY DEFINER. Tidak bisa diedit/dihapus pengguna.';
create index if not exists audit_log_signal_idx
  on public.audit_log (signal_id, created_at desc);
create index if not exists audit_log_actor_idx
  on public.audit_log (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Fungsi bantu skema (dipakai trigger di bawah).
-- ---------------------------------------------------------------------------

-- updated_at otomatis.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_traders_updated_at on public.traders;
create trigger trg_traders_updated_at
  before update on public.traders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_signals_updated_at on public.signals;
create trigger trg_signals_updated_at
  before update on public.signals
  for each row execute function public.set_updated_at();

drop trigger if exists trg_trader_progress_updated_at on public.trader_progress;
create trigger trg_trader_progress_updated_at
  before update on public.trader_progress
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Penjaga username (aturan prototipe, ronde 21): username yang dilindungi
-- (admin/support/moderator/dll., termasuk varian leet: 4dm1n, supp0rt)
-- DITOLAK di level database, jadi tidak bisa lolos lewat jalur mana pun.
-- ---------------------------------------------------------------------------
create or replace function public.is_reserved_username(p_username text)
returns boolean
language sql
immutable
as $func$
  select lower(translate(lower(p_username), '013457@$!', 'oieastasi')) in (
    'admin', 'administrator', 'support', 'moderator', 'official',
    'helpdesk', 'staff', 'manager', 'system', 'owner',
    'ole', 'olesignals', 'signalmarketplace', 'signals'
  );
$func$;

create or replace function public.guard_profile_username()
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

drop trigger if exists trg_guard_profile_username on public.profiles;
create trigger trg_guard_profile_username
  before insert or update of username on public.profiles
  for each row execute function public.guard_profile_username();
