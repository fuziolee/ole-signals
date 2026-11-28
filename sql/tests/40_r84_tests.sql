-- ============================================================================
-- OLE Signals - tests/40_r84_tests.sql
-- Tes verifikasi Ronde 84 (riwayat CANCELLED + EXPIRED untuk penyalin)
-- di Postgres SCRATCH.
--
-- JALANKAN HANYA DI SCRATCH (bukan live): file ini memakai UUID uji dan
-- mereset akun uji. Pola mengikuti 37_r77_hide_expired.sql: user uji dibuat
-- di auth.users, hasil dicatat ke tabel temp test_results, satu tes gagal
-- TIDAK menghentikan tes lain. Jalankan ulang file ini untuk rerun - SETUP
-- menghapus sisa run sebelumnya.
--
-- Prasyarat: rantai migrasi kanonis + sql/40 sudah diterapkan (urutan
-- scratch: bootstrap auth, 01, 02, 09, 12, 13, 14, 15, 16, 17, 21, 22,
-- 03, 18, 23, 25, 26, 28, 30, 32, 33, 34, 35, 37, 40). Identitas user
-- disimulasikan lewat klaim JWT (teknik R27); baca sebagai klien memakai
-- `set role` (anon/authenticated).
--
-- Yang diuji (R84-S):
--   S-01: matriks view signals_public untuk baris CANCELLED/EXPIRED
--      (pembaca x status x penyalin): terlihat HANYA oleh pemilik +
--      penyalin (bukan orang asing, bukan anon, bukan subscriber yang
--      tidak menyalin, bukan ex-subscriber yang tidak menyalin).
--   S-02: redaksi S1b: penyalin non-subscriber melihat entry/SL/TP/lot/
--      entry_type NULL untuk trader L5+ berbayar; pemilik dan subscriber
--      aktif melihat penuh; trader gratis/L<5 melihat penuh; pair dan
--      direction TIDAK pernah diredaksi.
--   S-03: regresi PENDING/AKTIF terkunci: redaksi lama tetap jalan
--      (anon/asing/ex-sub NULL, pelanggan + pemilik penuh); WIN/LOSS
--      terlihat semua orang dengan angka penuh.
--   S-04: grant SELECT pada signals_public untuk anon + authenticated
--      tetap ada sesudah CREATE OR REPLACE VIEW; jumlah kolom tetap 25.
--   S-05: signal_locked_for TIDAK berubah (MD5 ternormalisasi dicatat
--      untuk perbandingan sebelum/sesudah sql/40; badan tetap memuat
--      predikat PENDING/AKTIF dan level >= 5).
--   S-06: definisi view ternormalisasi dicatat (MD5) + memuat
--      pengecualian penyalin (EXISTS copies) dan redaksi S1b.
--   S-07: kueri gaya listMyCopies (signals_public WHERE id IN salinan
--      milik pembaca) mengembalikan persis baris CANCELLED/EXPIRED yang
--      disalin pembaca itu, dan 0 baris untuk orang asing.
--   S-08: regresi copy_signal: atas EXPIRED tetap notpending; atas
--      PENDING terkunci tetap locked; atas PENDING gratis tetap ok;
--      pelanggan tetap lolos atas PENDING terkunci.
-- ============================================================================

drop table if exists test_results;
create temp table test_results (
  test text primary key,
  status text not null,
  detail text not null default ''
);

create temp table test_state (
  k text primary key,
  v text not null
);

create or replace function pg_temp.check(p_test text, p_ok boolean, p_detail text)
returns void
language plpgsql
as $func$
begin
  insert into test_results values (p_test, case when p_ok then 'PASS' else 'FAIL' end, p_detail)
  on conflict (test) do update set status = excluded.status, detail = excluded.detail;
end;
$func$;

create or replace function pg_temp.as_user(p_uid uuid)
returns void
language sql
as $func$
  select set_config('request.jwt.claims',
    '{"sub":"' || p_uid::text || '","role":"authenticated","aud":"authenticated"}', false);
$func$;

create or replace function pg_temp.clear_user()
returns void
language sql
as $func$
  select set_config('request.jwt.claims', '', false);
$func$;

-- ---------------------------------------------------------------------------
-- SETUP: user + trader uji R84 (UUID tetap supaya rerun membersihkan diri).
--   O  = pemilik, L5, harga $15.625 (Rp250.000) -> sinyalnya TERKUNCI.
--   F  = trader L5 GRATIS (harga NULL) -> sinyalnya TIDAK terkunci.
--   L  = trader L1, harga NULL -> sinyalnya TIDAK terkunci.
--   S  = pelanggan AKTIF O. X = ex-pelanggan O (dibatalkan).
--   R  = orang asing (bukan pelanggan, bukan pemilik, bukan penyalin).
--   C  = penyalin (bukan pelanggan) atas 005, 006, 009, 010.
-- Salinan dibuat dengan INSERT langsung (copy_signal menolak
-- CANCELLED/EXPIRED dengan notpending, jadi salinan riwayat hanya bisa
-- ada karena sinyal disalin saat masih PENDING lalu dibatalkan/kedaluwarsa;
-- INSERT langsung meniru keadaan akhir itu).
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    'd8400000-0000-0000-0000-000000000001', -- O
    'd8400000-0000-0000-0000-000000000002', -- F
    'd8400000-0000-0000-0000-000000000003', -- L
    'd8400000-0000-0000-0000-000000000004', -- S
    'd8400000-0000-0000-0000-000000000005', -- X
    'd8400000-0000-0000-0000-000000000006', -- R
    'd8400000-0000-0000-0000-000000000007'  -- C
  ];
  v_sig uuid[] := array[
    'a8400000-0000-0000-0000-000000000001',
    'a8400000-0000-0000-0000-000000000002',
    'a8400000-0000-0000-0000-000000000003',
    'a8400000-0000-0000-0000-000000000004',
    'a8400000-0000-0000-0000-000000000005',
    'a8400000-0000-0000-0000-000000000006',
    'a8400000-0000-0000-0000-000000000007',
    'a8400000-0000-0000-0000-000000000008',
    'a8400000-0000-0000-0000-000000000009',
    'a8400000-0000-0000-0000-000000000010'
  ];
  v_id uuid;
begin
  perform pg_temp.clear_user();
  reset role;
  delete from public.audit_log where actor_id = any(v_ids);
  delete from public.notifications where user_id = any(v_ids);
  delete from public.copies where follower_id = any(v_ids);
  delete from public.subscriptions where follower_id = any(v_ids) or trader_id = any(v_ids);
  delete from public.signals where id = any(v_sig);
  delete from public.trader_progress where trader_id = any(v_ids);
  delete from public.traders where profile_id = any(v_ids);
  delete from public.profiles where id = any(v_ids);
  delete from auth.users where id = any(v_ids);

  foreach v_id in array v_ids loop
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'r84-' || substr(v_id::text, 33, 4) || '@ole-signals.local', 'dummy-hash-tidak-untuk-login', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, username, display_name)
    values (v_id, 'r84_' || substr(v_id::text, 33, 4), 'R84 ' || substr(v_id::text, 33, 4))
    on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
  end loop;

  -- Trader: O (L5, harga 15.625), F (L5, gratis), L (L1).
  -- S/X/R/C bukan trader.
  insert into public.traders (profile_id, username, trader_display_name, subscription_price_usd, is_demo)
  values
    ('d8400000-0000-0000-0000-000000000001', 'r84_0001', 'R84 0001', 15.625, false),
    ('d8400000-0000-0000-0000-000000000002', 'r84_0002', 'R84 0002', null, false),
    ('d8400000-0000-0000-0000-000000000003', 'r84_0003', 'R84 0003', null, false)
  on conflict (profile_id) do update set username = excluded.username,
    trader_display_name = excluded.trader_display_name,
    subscription_price_usd = excluded.subscription_price_usd, is_demo = excluded.is_demo;

  -- Progress: ref(L5) = 10000 x 1,05^4 = 12155.06; ref(L1) = 10000.
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values
    ('d8400000-0000-0000-0000-000000000001', 5, 12500.00, 12155.06, 0, 0, 12500.00, 0, 0),
    ('d8400000-0000-0000-0000-000000000002', 5, 12500.00, 12155.06, 0, 0, 12500.00, 0, 0),
    ('d8400000-0000-0000-0000-000000000003', 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd,
    level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level,
    trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd,
    max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;

  -- Langganan: S aktif ke O; X dibatalkan (bukan pelanggan lagi).
  insert into public.subscriptions (follower_id, trader_id, price_usd, status, ends_at)
  values
    ('d8400000-0000-0000-0000-000000000004', 'd8400000-0000-0000-0000-000000000001', 15.625, 'active', now() + interval '1 month'),
    ('d8400000-0000-0000-0000-000000000005', 'd8400000-0000-0000-0000-000000000001', 15.625, 'cancelled', now() + interval '1 month');

  -- Sinyal (insert langsung, bypass RPC, hanya butuh baris valid):
  -- 001 O PENDING terkunci, 002 O AKTIF, 003 O WIN, 004 O LOSS,
  -- 005 O EXPIRED, 006 O CANCELLED,
  -- 007 F (L5 gratis) PENDING, 008 L (L1) PENDING,
  -- 009 F EXPIRED, 010 L EXPIRED.
  insert into public.signals (id, trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, profit_usd, profit_pips, r_value, created_at, expires_at, closed_at, version)
  values
    ('a8400000-0000-0000-0000-000000000001', 'd8400000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a8400000-0000-0000-0000-000000000002', 'd8400000-0000-0000-0000-000000000001', 'XAUUSD', 'BUY', 3600.00, 3590.00, 3620.00, 0.02, 'limit', 'AKTIF', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a8400000-0000-0000-0000-000000000003', 'd8400000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'WIN', 45.00, 200.00, 1.5000, now(), now() + interval '3 days', now(), 1),
    ('a8400000-0000-0000-0000-000000000004', 'd8400000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'LOSS', -10.00, -100.00, -1.0000, now(), now() + interval '3 days', now(), 1),
    ('a8400000-0000-0000-0000-000000000005', 'd8400000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'EXPIRED', null, null, null, now(), now() + interval '3 days', now(), 1),
    ('a8400000-0000-0000-0000-000000000006', 'd8400000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'CANCELLED', null, null, null, now(), now() + interval '3 days', now(), 1),
    ('a8400000-0000-0000-0000-000000000007', 'd8400000-0000-0000-0000-000000000002', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a8400000-0000-0000-0000-000000000008', 'd8400000-0000-0000-0000-000000000003', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.07, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a8400000-0000-0000-0000-000000000009', 'd8400000-0000-0000-0000-000000000002', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'EXPIRED', null, null, null, now(), now() + interval '3 days', now(), 1),
    ('a8400000-0000-0000-0000-000000000010', 'd8400000-0000-0000-0000-000000000003', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'EXPIRED', null, null, null, now(), now() + interval '3 days', now(), 1);

  -- Salinan riwayat (dibuat saat sinyal masih PENDING, lalu sinyal mati):
  -- C menyalin 005, 006, 009, 010; S (pelanggan aktif) menyalin 005;
  -- X (ex-pelanggan) menyalin 006. R tidak menyalin apa pun.
  insert into public.copies (follower_id, signal_id, lot_size)
  values
    ('d8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000005', 0.05),
    ('d8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000006', 0.05),
    ('d8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000009', 0.05),
    ('d8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000010', 0.05),
    ('d8400000-0000-0000-0000-000000000004', 'a8400000-0000-0000-0000-000000000005', 0.05),
    ('d8400000-0000-0000-0000-000000000005', 'a8400000-0000-0000-0000-000000000006', 0.05);

  perform pg_temp.check('SETUP', true, '7 user (O/F/L/S/X/R/C) + 10 sinyal + 2 langganan + 6 salinan');
exception when others then
  perform pg_temp.check('SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- S-01 + S-02 + S-03: matriks view (pembaca x sinyal).
-- expect_entry NULL berarti entry harus NULL (teredaksi); angka berarti
-- entry harus terlihat sebesar itu. expect_redacted berarti kelima kolom
-- sensitif (entry/SL/TP/lot/entry_type) harus NULL dan pair harus tetap
-- terlihat (view tidak pernah meredaksi pair/direction).
-- ---------------------------------------------------------------------------
create temp table pg_temp.expect (
  test text primary key,
  reader text not null,
  sig uuid not null,
  expect_present boolean not null,
  expect_entry numeric,
  expect_redacted boolean not null
);
insert into pg_temp.expect values
  -- (a) CANCELLED/EXPIRED terlihat hanya oleh pemilik + penyalin.
  ('R84-S-01a', 'anon', 'a8400000-0000-0000-0000-000000000005', false, null, false), -- anon, O EXPIRED: tidak ada
  ('R84-S-01b', 'anon', 'a8400000-0000-0000-0000-000000000006', false, null, false), -- anon, O CANCELLED: tidak ada
  ('R84-S-01c', 'd8400000-0000-0000-0000-000000000006', 'a8400000-0000-0000-0000-000000000005', false, null, false), -- R asing, O EXPIRED: tidak ada
  ('R84-S-01d', 'd8400000-0000-0000-0000-000000000006', 'a8400000-0000-0000-0000-000000000006', false, null, false), -- R asing, O CANCELLED: tidak ada
  ('R84-S-01e', 'd8400000-0000-0000-0000-000000000006', 'a8400000-0000-0000-0000-000000000009', false, null, false), -- R asing, F EXPIRED: tidak ada (bukan penyalin)
  ('R84-S-01f', 'd8400000-0000-0000-0000-000000000004', 'a8400000-0000-0000-0000-000000000006', false, null, false), -- S pelanggan, O CANCELLED: tidak ada (pelanggan saja bukan penyalin)
  ('R84-S-01g', 'd8400000-0000-0000-0000-000000000005', 'a8400000-0000-0000-0000-000000000005', false, null, false), -- X ex-pelanggan, O EXPIRED: tidak ada (hanya menyalin 006)
  -- (b) redaksi S1b: penyalin non-subscriber atas trader L5+ berbayar.
  ('R84-S-02a', 'd8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000005', true, null, true), -- C penyalin, O EXPIRED: ada, TEREDAKSI
  ('R84-S-02b', 'd8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000006', true, null, true), -- C penyalin, O CANCELLED: ada, TEREDAKSI
  ('R84-S-02c', 'd8400000-0000-0000-0000-000000000005', 'a8400000-0000-0000-0000-000000000006', true, null, true), -- X ex-pelanggan penyalin, O CANCELLED: ada, TEREDAKSI
  ('R84-S-02d', 'd8400000-0000-0000-0000-000000000004', 'a8400000-0000-0000-0000-000000000005', true, 1.1000, false), -- S pelanggan+penyalin, O EXPIRED: ada, PENUH
  ('R84-S-02e', 'd8400000-0000-0000-0000-000000000001', 'a8400000-0000-0000-0000-000000000005', true, 1.1000, false), -- O pemilik, O EXPIRED: ada, PENUH
  ('R84-S-02f', 'd8400000-0000-0000-0000-000000000001', 'a8400000-0000-0000-0000-000000000006', true, 1.1000, false), -- O pemilik, O CANCELLED: ada, PENUH
  ('R84-S-02g', 'd8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000009', true, 1.1000, false), -- C penyalin, F EXPIRED (gratis L5): ada, PENUH
  ('R84-S-02h', 'd8400000-0000-0000-0000-000000000007', 'a8400000-0000-0000-0000-000000000010', true, 1.1000, false), -- C penyalin, L EXPIRED (L1): ada, PENUH
  ('R84-S-02i', 'd8400000-0000-0000-0000-000000000002', 'a8400000-0000-0000-0000-000000000009', true, 1.1000, false), -- F pemilik, F EXPIRED: ada, PENUH
  -- (c) regresi PENDING/AKTIF terkunci + WIN/LOSS.
  ('R84-S-03a', 'anon', 'a8400000-0000-0000-0000-000000000001', true, null, true),  -- anon, O PENDING: ada, entry NULL (terkunci)
  ('R84-S-03b', 'anon', 'a8400000-0000-0000-0000-000000000002', true, null, true),  -- anon, O AKTIF: ada, entry NULL (terkunci)
  ('R84-S-03c', 'd8400000-0000-0000-0000-000000000006', 'a8400000-0000-0000-0000-000000000001', true, null, true), -- R asing, O PENDING: ada, entry NULL
  ('R84-S-03d', 'd8400000-0000-0000-0000-000000000005', 'a8400000-0000-0000-0000-000000000001', true, null, true), -- X ex-pelanggan, O PENDING: ada, entry NULL
  ('R84-S-03e', 'd8400000-0000-0000-0000-000000000004', 'a8400000-0000-0000-0000-000000000001', true, 1.1000, false), -- S pelanggan, O PENDING: ada, PENUH
  ('R84-S-03f', 'd8400000-0000-0000-0000-000000000004', 'a8400000-0000-0000-0000-000000000002', true, 3600.00, false), -- S pelanggan, O AKTIF: ada, PENUH
  ('R84-S-03g', 'd8400000-0000-0000-0000-000000000001', 'a8400000-0000-0000-0000-000000000001', true, 1.1000, false), -- O pemilik, O PENDING: ada, PENUH
  ('R84-S-03h', 'anon', 'a8400000-0000-0000-0000-000000000003', true, 1.1000, false), -- anon, O WIN: ada, PENUH
  ('R84-S-03i', 'anon', 'a8400000-0000-0000-0000-000000000004', true, 1.1000, false), -- anon, O LOSS: ada, PENUH
  ('R84-S-03j', 'anon', 'a8400000-0000-0000-0000-000000000007', true, 1.1000, false), -- anon, F PENDING (gratis): ada, PENUH
  ('R84-S-03k', 'anon', 'a8400000-0000-0000-0000-000000000008', true, 1.1000, false); -- anon, L PENDING (L1): ada, PENUH

do $$
declare
  r record;
  v_n int;
  v_entry numeric; v_sl numeric; v_tp numeric; v_lot numeric; v_et text; v_pair text;
  v_ok boolean;
begin
  for r in select * from pg_temp.expect order by test loop
    if r.reader = 'anon' then
      reset role;
      perform pg_temp.clear_user();
      set role anon;
    else
      reset role;
      perform pg_temp.as_user(r.reader::uuid);
      set role authenticated;
    end if;
    select count(*), max(entry), max(stop_loss), max(take_profit), max(lot_size), max(entry_type), max(pair)
      into v_n, v_entry, v_sl, v_tp, v_lot, v_et, v_pair
      from public.signals_public where id = r.sig;
    reset role;
    perform pg_temp.clear_user();
    v_ok := (v_n = (case when r.expect_present then 1 else 0 end))
      and (not r.expect_present or v_entry is not distinct from r.expect_entry)
      and (not r.expect_redacted
        or (v_sl is null and v_tp is null and v_lot is null and v_et is null and v_pair is not null))
      and (r.expect_redacted
        or (not r.expect_present or (v_entry is not distinct from r.expect_entry)));
    perform pg_temp.check(r.test, v_ok,
      format('n=%s entry=%s sl=%s tp=%s lot=%s type=%s pair=%s (harap n=%s entry=%s redacted=%s)',
        v_n, v_entry, v_sl, v_tp, v_lot, v_et, v_pair,
        case when r.expect_present then 1 else 0 end, r.expect_entry, r.expect_redacted));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- S-04: grant SELECT + jumlah kolom view tetap.
-- ---------------------------------------------------------------------------
do $$
declare
  v_grants int;
  v_cols int;
begin
  select count(*) into v_grants
    from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'signals_public'
      and grantee in ('anon', 'authenticated') and privilege_type = 'SELECT';
  select count(*) into v_cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'signals_public';
  perform pg_temp.check('R84-S-04a', v_grants = 2,
    format('grant SELECT anon+authenticated = %s (harap 2)', v_grants));
  perform pg_temp.check('R84-S-04b', v_cols = 25,
    format('kolom signals_public = %s (harap 25)', v_cols));
end $$;

-- ---------------------------------------------------------------------------
-- S-05: signal_locked_for tidak berubah (MD5 ternormalisasi dicatat untuk
-- perbandingan sebelum/sesudah sql/40; badan tetap memuat predikat
-- PENDING/AKTIF dan level >= 5).
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
  v_md5 text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'signal_locked_for';
  v_md5 := md5(btrim(regexp_replace(regexp_replace(coalesce(v_src, ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  insert into test_state values ('signal_locked_for_md5', v_md5)
  on conflict (k) do update set v = excluded.v;
  perform pg_temp.check('R84-S-05', v_src like '%PENDING%' and v_src like '%AKTIF%'
    and position('>= 5' in v_src) > 0,
    format('md5=%s (bandingkan dengan sebelum sql/40)', v_md5));
end $$;

-- ---------------------------------------------------------------------------
-- S-06: definisi view ternormalisasi dicatat (MD5) + memuat pengecualian
-- penyalin dan redaksi S1b.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_md5 text;
begin
  v_def := pg_get_viewdef('public.signals_public', true);
  v_md5 := md5(btrim(regexp_replace(regexp_replace(coalesce(v_def, ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')));
  insert into test_state values ('signals_public_viewdef_md5', v_md5)
  on conflict (k) do update set v = excluded.v;
  perform pg_temp.check('R84-S-06', position('copies' in v_def) > 0
    and position('CANCELLED' in v_def) > 0
    and position('EXPIRED' in v_def) > 0
    and position('subscriptions' in v_def) > 0,
    format('md5=%s (bandingkan dengan file sql/40)', v_md5));
end $$;

-- ---------------------------------------------------------------------------
-- S-07: kueri gaya listMyCopies (kueri 2 listMyCopies: signals_public
-- WHERE id IN salinan milik pembaca).
-- ---------------------------------------------------------------------------
do $$
declare
  v_n int;
  v_ids text;
begin
  -- S-07a: sebagai C, kueri jurnal mengembalikan persis 4 baris riwayat
  -- yang disalinnya (005 EXPIRED, 006 CANCELLED, 009, 010).
  reset role;
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000007');
  set role authenticated;
  select count(*), string_agg(id::text, ',' order by id) into v_n, v_ids
    from public.signals_public
    where id in (select signal_id from public.copies where follower_id = auth.uid());
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-07a', v_n = 4
      and v_ids = 'a8400000-0000-0000-0000-000000000005,a8400000-0000-0000-0000-000000000006,a8400000-0000-0000-0000-000000000009,a8400000-0000-0000-0000-000000000010',
    format('jurnal C n=%s ids=%s (harap 4 baris 005/006/009/010)', v_n, v_ids));

  -- S-07b: sebagai R (bukan penyalin), kueri jurnal mengembalikan 0 baris
  -- CANCELLED/EXPIRED (WIN/LOSS/PENDING/AKTIF tidak disalin R, jadi 0).
  reset role;
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000006');
  set role authenticated;
  select count(*) into v_n
    from public.signals_public
    where id in (select signal_id from public.copies where follower_id = auth.uid())
      and status in ('CANCELLED', 'EXPIRED');
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-07b', v_n = 0,
    format('jurnal R baris CANCELLED/EXPIRED=%s (harap 0)', v_n));

  -- S-07c: sebagai S (pelanggan + penyalin 005), kueri jurnal
  -- mengembalikan 1 baris CANCELLED/EXPIRED (005 saja, bukan 006).
  reset role;
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000004');
  set role authenticated;
  select count(*), string_agg(id::text, ',' order by id) into v_n, v_ids
    from public.signals_public
    where id in (select signal_id from public.copies where follower_id = auth.uid())
      and status in ('CANCELLED', 'EXPIRED');
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-07c', v_n = 1
      and v_ids = 'a8400000-0000-0000-0000-000000000005',
    format('jurnal S n=%s ids=%s (harap 1 baris 005)', v_n, v_ids));
end $$;

-- ---------------------------------------------------------------------------
-- S-08: regresi copy_signal.
-- ---------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
begin
  -- S-08a: orang asing menyalin EXPIRED -> notpending.
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000006');
  v_res := public.copy_signal('a8400000-0000-0000-0000-000000000005'::uuid, null);
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-08a', (v_res->>'ok') = 'false' and (v_res->>'code') = 'notpending',
    format('copy EXPIRED res=%s (harap ok=false code=notpending)', v_res));

  -- S-08b: orang asing menyalin PENDING terkunci -> locked.
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000006');
  v_res := public.copy_signal('a8400000-0000-0000-0000-000000000001'::uuid, null);
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-08b', (v_res->>'ok') = 'false' and (v_res->>'code') = 'locked',
    format('copy PENDING terkunci res=%s (harap ok=false code=locked)', v_res));

  -- S-08c: orang asing menyalin PENDING gratis (L1) -> ok.
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000006');
  v_res := public.copy_signal('a8400000-0000-0000-0000-000000000008'::uuid, null);
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-08c', (v_res->>'ok') = 'true' and (v_res->>'code') = 'ok',
    format('copy PENDING gratis res=%s (harap ok=true code=ok)', v_res));
  delete from public.copies
    where follower_id = 'd8400000-0000-0000-0000-000000000006'
      and signal_id = 'a8400000-0000-0000-0000-000000000008';

  -- S-08d: pelanggan menyalin PENDING terkunci -> ok.
  perform pg_temp.as_user('d8400000-0000-0000-0000-000000000004');
  v_res := public.copy_signal('a8400000-0000-0000-0000-000000000001'::uuid, null);
  perform pg_temp.clear_user();
  perform pg_temp.check('R84-S-08d', (v_res->>'ok') = 'true' and (v_res->>'code') = 'ok',
    format('copy PENDING terkunci oleh pelanggan res=%s (harap ok=true code=ok)', v_res));
  delete from public.copies
    where follower_id = 'd8400000-0000-0000-0000-000000000004'
      and signal_id = 'a8400000-0000-0000-0000-000000000001';
end $$;

-- ---------------------------------------------------------------------------
-- Ringkasan.
-- ---------------------------------------------------------------------------
select test, status, detail from test_results order by test;
select k, v from test_state order by k;
select count(*) filter (where status = 'PASS') as pass,
       count(*) filter (where status = 'FAIL') as fail,
       count(*) as total
from test_results;
