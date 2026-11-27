-- ==========================================================================
-- sql/30_r61_paywall.sql — Ronde 61 (D1: T-2 paywall sinyal L5+ di server)
-- ==========================================================================
-- MASALAH (audit pra-Fase 3, T-2): paywall sinyal Level 5+ hanya dijaga di
-- client. Policy `signals_select_public` (02_rls.sql) membiarkan anon +
-- authenticated membaca SEMUA kolom tabel signals — entry/SL/TP/lot sinyal
-- berbayar bisa dibaca lewat REST walau UI menyembunyikannya.
--
-- PERBAIKAN (Opsi A — view, dipilih karena paling minimal):
--   1. View `signals_public` (security_invoker = false) — SATU-SATUNYA
--      jalur baca klien. Kolom entry/stop_loss/take_profit/lot_size/
--      entry_type di-NULL-kan bila sinyal terkunci bagi pembaca; baris
--      CANCELLED tetap disembunyikan kecuali milik sendiri (sama seperti
--      policy lama). View memirror 24 kolom tabel signals persis — agar
--      `select *` dan embed `traders(...)` di js/api.js tetap jalan.
--   2. Helper `signal_locked_for(trader_id, status)` — SATU definisi
--      predikat terkunci, dipakai view + trigger salinan. SECURITY DEFINER
--      (anon tidak punya grant SELECT ke subscriptions, jadi predikat
--      harus dievaluasi sebagai pemilik). TANPA parameter pembaca — helper
--      membaca auth.uid() sendiri, jadi tidak bisa dipakai sebagai oracle
--      untuk menanyakan status langganan orang lain.
--   3. `revoke select on signals from anon, authenticated` — tabel mentah
--      tidak lagi bisa dibaca klien; grant SELECT hanya ke view.
--   4. Trigger `guard_copy_locked` — sisi TULIS paywall yang sama: salinan
--      sinyal terkunci ditolak server (42501), bukan hanya disembunyikan
--      tombolnya di UI. Menutup juga jalur snapshot reset (salinan sinyal
--      terkunci tidak bisa dibuat, jadi snapshot-nya tidak ada).
--   5. Policy `copies_select_own_or_trader` diperbaiki: subquery EXISTS ke
--      tabel signals diganti helper SECURITY DEFINER `signal_owned_by`
--      (subquery itu ikut pecah setelah revoke SELECT di atas).
--
-- YANG TIDAK DIUBAH (batas scope R61):
--   - create_signal / update_signal TIDAK disalin ulang — file ini TIDAK
--     berisi salinan penuh fungsi apa pun (lihat sql/README.md).
--   - Jalur pasang harga (trigger guard_trader_guards, sql/16) TIDAK
--     disentuh — sudah dijaga server sejak R27; hanya diuji regresi
--     (sql/tests/31_r61_tests.sql).
--   - Policy `signals_select_public` di tabel dipertahankan (defense in
--     depth bila suatu hari grant SELECT dikembalikan).
--   - Pengecualian demo (is_demo) dipertahankan: predikat terkunci SAMA
--     dengan client (isLockedForMe) — tanpa carve-out demo. Sinyal demo
--     tetap terbuka karena level < 5 / harga null (bukan karena pengecualian
--     khusus di predikat ini).
--   - Fail-closed: bila helper mengembalikan NULL (tidak boleh terjadi —
--     semua cabang di-coalesce), view + trigger menganggap TERKUNCI.
--
-- URUTAN JALANKAN: setelah 28 (dan r8-notif-fix TIDAK perlu — file itu
-- SUPERSEDED, lihat sql/tests/). Idempotent (create or replace / drop if
-- exists) kecuali REVOKE/GRANT.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper predikat terkunci — SATU definisi, dipakai view + trigger.
--    Terkunci bila: status PENDING/AKTIF, BUKAN milik sendiri, level trader
--    >= 5, harga langganan > 0, pembaca BUKAN subscriber aktif.
--    (Cermin persis isLockedForMe di js/app.js.)
-- ---------------------------------------------------------------------------
create or replace function public.signal_locked_for(p_trader_id uuid, p_status text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_status in ('PENDING', 'AKTIF')
    and coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) <> p_trader_id
    and coalesce((select t.subscription_price_usd from public.traders t where t.profile_id = p_trader_id), 0) > 0
    and coalesce((select tp.level from public.trader_progress tp where tp.trader_id = p_trader_id), 1) >= 5
    and not exists (
      select 1 from public.subscriptions s
      where s.trader_id = p_trader_id
        and s.follower_id = auth.uid()
        and s.status = 'active'
    ),
    false
  );
$$;
comment on function public.signal_locked_for(uuid, text) is
  'R61 (T-2): predikat paywall L5+ — SATU definisi untuk view signals_public + trigger guard_copy_locked. SECURITY DEFINER agar anon bisa dievaluasi (anon tanpa grant ke subscriptions). Tanpa parameter pembaca (baca auth.uid() sendiri) supaya bukan oracle langganan orang lain.';

-- ---------------------------------------------------------------------------
-- 2. Helper kepemilikan sinyal — untuk policy copies (SECURITY DEFINER agar
--    policy tetap jalan setelah REVOKE SELECT di tabel signals).
-- ---------------------------------------------------------------------------
create or replace function public.signal_owned_by(p_signal_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.signals s
    where s.id = p_signal_id and s.trader_id = p_uid
  );
$$;
comment on function public.signal_owned_by(uuid, uuid) is
  'R61 (T-2): helper SECURITY DEFINER untuk policy copies_select_own_or_trader — ganti subquery EXISTS ke tabel signals yang pecah setelah REVOKE SELECT.';

-- ---------------------------------------------------------------------------
-- 3. View baca publik — satu-satunya jalur baca sinyal untuk klien.
--    Flat (tanpa subquery) supaya PostgREST tetap mendeteksi FK trader_id
--    untuk embed traders(...) di js/api.js. Fail-closed: coalesce(..., true).
-- ---------------------------------------------------------------------------
create or replace view public.signals_public
with (security_invoker = false) as
select
  s.id,
  s.trader_id,
  s.pair,
  s.direction,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true) then null else s.entry end as entry,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true) then null else s.stop_loss end as stop_loss,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true) then null else s.take_profit end as take_profit,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true) then null else s.lot_size end as lot_size,
  s.status,
  s.version,
  s.idempotency_key,
  s.created_at,
  s.expires_at,
  s.activated_at,
  s.closed_at,
  s.close_price,
  s.profit_usd,
  s.profit_pips,
  s.r_value,
  s.holding_minutes,
  s.duplicate_of,
  s.duplicate_flagged,
  s.updated_at,
  s.shared_at,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true) then null else s.entry_type end as entry_type
from public.signals s
where s.status <> 'CANCELLED' or s.trader_id = auth.uid();
comment on view public.signals_public is
  'R61 (T-2): SATU-SATUNYA jalur baca sinyal untuk klien (anon + authenticated). Entry/SL/TP/lot/entry_type di-NULL-kan untuk sinyal terkunci L5+; CANCELLED disembunyikan kecuali milik sendiri. Baca tabel mentah dicabut (revoke di bawah).';

-- ---------------------------------------------------------------------------
-- 4. Grant view ke klien; cabut baca tabel mentah dari klien.
--    (service_role tidak terpengaruh — bypass RLS + grant penuh; settlement
--    Edge Function tetap membaca tabel langsung.)
-- ---------------------------------------------------------------------------
grant select on public.signals_public to anon, authenticated;
revoke select on public.signals from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Policy copies SELECT — ganti subquery EXISTS ke tabel signals (pecah
--    setelah revoke) dengan helper SECURITY DEFINER.
-- ---------------------------------------------------------------------------
drop policy if exists "copies_select_own_or_trader" on public.copies;
create policy "copies_select_own_or_trader"
  on public.copies for select to authenticated
  using (
    follower_id = auth.uid()
    or public.signal_owned_by(signal_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. Trigger sisi tulis paywall: salinan sinyal terkunci ditolak server.
-- ---------------------------------------------------------------------------
create or replace function public.guard_copy_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trader_id uuid;
  v_status text;
begin
  select s.trader_id, s.status into v_trader_id, v_status
  from public.signals s where s.id = new.signal_id;
  -- Sinyal tidak ada: biarkan FK yang menolak (bukan urusan trigger ini).
  if v_trader_id is null then
    return new;
  end if;
  if coalesce(public.signal_locked_for(v_trader_id, v_status), true) then
    raise exception 'Sinyal terkunci (Level 5+ berbayar).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
comment on function public.guard_copy_locked() is
  'R61 (T-2): sisi TULIS paywall L5+ — INSERT copies atas sinyal terkunci ditolak server (42501). Sebelum R61 hanya tombol UI yang menyembunyikan; INSERT langsung lewat REST lolos.';

drop trigger if exists trg_guard_copy_locked on public.copies;
create trigger trg_guard_copy_locked
  before insert on public.copies
  for each row execute function public.guard_copy_locked();
