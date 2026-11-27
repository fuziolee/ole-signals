-- ============================================================================
-- OLE Signals - tests/31_r61_tests.sql
-- Tes verifikasi Ronde 61 (D1 T-2 paywall server + D2 T-08 + regresi gerbang
-- harga L5) di Postgres SCRATCH.
--
-- JALANKAN HANYA DI SCRATCH (bukan live): file ini memakai UUID uji +
-- harga tetap dan mereset akun uji. Pola mengikuti 27/29: user uji dibuat
-- di auth.users, hasil dicatat ke tabel temp test_results, satu tes gagal
-- TIDAK menghentikan tes lain. Jalankan ulang file ini untuk rerun - SETUP
-- menghapus sisa run sebelumnya.
--
-- Prasyarat: migrasi 01..28 + 30 sudah diterapkan (urutan scratch:
-- bootstrap auth, 01, 02, 09, 12, 13, 14, 15, 16, 17, 21, 22, 03, 18,
-- 23, 25, 26, 28, 30). Identitas user disimulasikan lewat klaim JWT
-- (teknik R27); baca view memakai `set role` (anon/authenticated).
--
-- Yang diuji (R61-V/H/C/G/P):
--   V: matriks redaksi view signals_public — anon / orang asing /
--      ex-pelanggan (langganan dibatalkan) / pelanggan aktif / pemilik,
--      atas sinyal terkunci PENDING+AKTIF, WIN, CANCELLED, EXPIRED,
--      sinyal trader L5 gratis, L1, dan demo.
--   H: helper signal_locked_for — unit per peran + bukti BUKAN oracle
--      (jawaban sama untuk input sama BERBEDA menurut pemanggil, karena
--      helper membaca auth.uid() sendiri tanpa parameter pembaca).
--   C: trigger guard_copy_locked (salinan sinyal terkunci ditolak server)
--      + policy copies (pemilik trader bisa membaca salinan sinyalnya
--      lewat helper signal_owned_by).
--   G: grant/revoke — tabel signals mentah tidak bisa dibaca anon/
--      authenticated; view bisa.
--   P: regresi gerbang harga L5 (guard_trader_guards, sql/16) — L1
--      ditolak, rentang Rp100rb–Rp10jt, pengecualian demo, cooldown
--      1x/bulan, uji ANTI-RESET harga -> NULL -> harga (stempel TIDAK
--      direset langkah NULL, jadi set harga lagi tetap ditolak), stempel
--      tidak bisa diubah langsung, blok harga selama jeda reset (23).
--      Bagian P PALING AKHIR karena memutasi harga trader uji.
-- ============================================================================

drop table if exists test_results;
create temp table test_results (
  test text primary key,
  status text not null,
  detail text not null default ''
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
-- SETUP: user + trader uji R61 (UUID tetap supaya rerun membersihkan diri).
--   O  = pemilik, L5, harga $15.625 (Rp250.000) -> sinyalnya TERKUNCI.
--   F  = trader L5 GRATIS (harga NULL) -> sinyalnya TIDAK terkunci.
--   F2 = trader L5, harga NULL, untuk uji blok jeda reset (P-10).
--   L  = trader L1, harga NULL -> sinyalnya TIDAK terkunci.
--   D  = trader DEMO L1 -> pengecualian demo (boleh pasang harga).
--   S  = pelanggan AKTIF O. X = ex-pelanggan O (dibatalkan).
--   R  = orang asing (bukan pelanggan, bukan pemilik).
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    'd6100000-0000-0000-0000-000000000001', -- O
    'd6100000-0000-0000-0000-000000000002', -- F
    'd6100000-0000-0000-0000-000000000003', -- L
    'd6100000-0000-0000-0000-000000000004', -- S
    'd6100000-0000-0000-0000-000000000005', -- X
    'd6100000-0000-0000-0000-000000000006', -- R
    'd6100000-0000-0000-0000-000000000007', -- D (demo)
    'd6100000-0000-0000-0000-000000000008'  -- F2
  ];
  v_sig uuid[] := array[
    'a0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005',
    'a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000008'
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
    values (v_id, '00000000-0000-0000-0000-000000000000', 'r61-' || substr(v_id::text, 33, 4) || '@ole-signals.local', 'dummy-hash-tidak-untuk-login', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, username, display_name)
    values (v_id, 'r61_' || substr(v_id::text, 33, 4), 'R61 ' || substr(v_id::text, 33, 4))
    on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
  end loop;

  -- Trader: O (L5, harga 15.625), F (L5, gratis), F2 (L5, gratis),
  -- L (L1), D (demo L1). S/X/R bukan trader.
  insert into public.traders (profile_id, username, trader_display_name, subscription_price_usd, is_demo)
  values
    ('d6100000-0000-0000-0000-000000000001', 'r61_0001', 'R61 0001', 15.625, false),
    ('d6100000-0000-0000-0000-000000000002', 'r61_0002', 'R61 0002', null, false),
    ('d6100000-0000-0000-0000-000000000008', 'r61_0008', 'R61 0008', null, false),
    ('d6100000-0000-0000-0000-000000000003', 'r61_0003', 'R61 0003', null, false),
    ('d6100000-0000-0000-0000-000000000007', 'r61_0007', 'R61 0007', null, true)
  on conflict (profile_id) do update set username = excluded.username,
    trader_display_name = excluded.trader_display_name,
    subscription_price_usd = excluded.subscription_price_usd, is_demo = excluded.is_demo;

  -- Progress: ref(L5) = 10000 x 1,05^4 = 12155.06; ref(L1) = 10000.
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values
    ('d6100000-0000-0000-0000-000000000001', 5, 12500.00, 12155.06, 0, 0, 12500.00, 0, 0),
    ('d6100000-0000-0000-0000-000000000002', 5, 12500.00, 12155.06, 0, 0, 12500.00, 0, 0),
    ('d6100000-0000-0000-0000-000000000008', 5, 12500.00, 12155.06, 0, 0, 12500.00, 0, 0),
    ('d6100000-0000-0000-0000-000000000003', 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0),
    ('d6100000-0000-0000-0000-000000000007', 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd,
    level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level,
    trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd,
    max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;

  -- Langganan: S aktif ke O; X dibatalkan (bukan pelanggan lagi).
  insert into public.subscriptions (follower_id, trader_id, price_usd, status, ends_at)
  values
    ('d6100000-0000-0000-0000-000000000004', 'd6100000-0000-0000-0000-000000000001', 15.625, 'active', now() + interval '1 month'),
    ('d6100000-0000-0000-0000-000000000005', 'd6100000-0000-0000-0000-000000000001', 15.625, 'cancelled', now() + interval '1 month');

  -- Sinyal (insert langsung, bypass RPC — hanya butuh baris valid):
  -- 001 O PENDING terkunci,
  -- 002 O AKTIF terkunci, 003 O WIN, 004 O CANCELLED,
  -- 005 F (L5 gratis) PENDING, 006 L (L1) PENDING, 007 D (demo) PENDING,
  -- 008 O EXPIRED.
  insert into public.signals (id, trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, profit_usd, profit_pips, r_value, created_at, expires_at, closed_at, version)
  values
    ('a0000000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a0000000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-000000000001', 'XAUUSD', 'BUY', 3600.00, 3590.00, 3620.00, 0.02, 'limit', 'AKTIF', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a0000000-0000-0000-0000-000000000003', 'd6100000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'WIN', 45.00, 200.00, 1.5000, now(), now() + interval '3 days', now(), 1),
    ('a0000000-0000-0000-0000-000000000004', 'd6100000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'CANCELLED', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a0000000-0000-0000-0000-000000000005', 'd6100000-0000-0000-0000-000000000002', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a0000000-0000-0000-0000-000000000006', 'd6100000-0000-0000-0000-000000000003', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a0000000-0000-0000-0000-000000000007', 'd6100000-0000-0000-0000-000000000007', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'PENDING', null, null, null, now(), now() + interval '3 days', null, 1),
    ('a0000000-0000-0000-0000-000000000008', 'd6100000-0000-0000-0000-000000000001', 'EURUSD', 'BUY', 1.1000, 1.0900, 1.1200, 0.05, 'limit', 'EXPIRED', null, null, null, now(), now() + interval '3 days', null, 1);

  -- Salinan awal: S menyalin WIN O (bukan terkunci); R menyalin PENDING L.
  insert into public.copies (id, follower_id, signal_id, lot_size)
  values
    ('c0000000-0000-0000-0000-000000000001', 'd6100000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 0.05),
    ('c0000000-0000-0000-0000-000000000002', 'd6100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 0.05);

  perform pg_temp.check('SETUP', true, '8 user (O/F/F2/L/D/S/X/R) + 8 sinyal + 2 langganan + 2 salinan');
exception when others then
  perform pg_temp.check('SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- V - matriks redaksi view signals_public.
-- Setiap blok: set role (+ klaim), baca view, reset role, catat hasil.
-- ===========================================================================
do $$
declare
  v_entry numeric; v_sl numeric; v_tp numeric; v_lot numeric; v_et text;
  v_n int; v_pair text; v_status text;
begin
  -- V-01: anon — sinyal terkunci PENDING: entry NULL.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  perform pg_temp.check('R61-V-01', v_entry is null, format('anon locked PENDING entry=%s (harap NULL)', v_entry));

  -- V-02: anon — sinyal terkunci PENDING: SL/TP/lot/entry_type SEMUA NULL.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select stop_loss, take_profit, lot_size, entry_type into v_sl, v_tp, v_lot, v_et
    from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  perform pg_temp.check('R61-V-02', v_sl is null and v_tp is null and v_lot is null and v_et is null,
    format('anon locked SL=%s TP=%s lot=%s type=%s (harap semua NULL)', v_sl, v_tp, v_lot, v_et));

  -- V-03: anon — sinyal terkunci AKTIF: entry NULL.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000002';
  reset role;
  perform pg_temp.check('R61-V-03', v_entry is null, format('anon locked AKTIF entry=%s (harap NULL)', v_entry));

  -- V-04: anon — WIN milik trader berbayar: entry PENUH (tidak terkunci).
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000003';
  reset role;
  perform pg_temp.check('R61-V-04', v_entry = 1.1000, format('anon WIN entry=%s (harap 1.1000)', v_entry));

  -- V-05: anon — PENDING trader L5 GRATIS: entry PENUH.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000005';
  reset role;
  perform pg_temp.check('R61-V-05', v_entry = 1.1000, format('anon L5-gratis PENDING entry=%s (harap 1.1000)', v_entry));

  -- V-06: anon — PENDING trader L1: entry PENUH.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000006';
  reset role;
  perform pg_temp.check('R61-V-06', v_entry = 1.1000, format('anon L1 PENDING entry=%s (harap 1.1000)', v_entry));

  -- V-07: anon — PENDING trader DEMO: entry PENUH.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000007';
  reset role;
  perform pg_temp.check('R61-V-07', v_entry = 1.1000, format('anon demo PENDING entry=%s (harap 1.1000)', v_entry));

  -- V-08: anon — EXPIRED milik trader berbayar: entry PENUH (bukan PENDING/AKTIF).
  reset role; perform pg_temp.clear_user();
  set role anon;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000008';
  reset role;
  perform pg_temp.check('R61-V-08', v_entry = 1.1000, format('anon EXPIRED entry=%s (harap 1.1000)', v_entry));

  -- V-09: anon — CANCELLED TIDAK ADA di view.
  reset role; perform pg_temp.clear_user();
  set role anon;
  select count(*) into v_n from public.signals_public where id = 'a0000000-0000-0000-0000-000000000004';
  reset role;
  perform pg_temp.check('R61-V-09', v_n = 0, format('anon CANCELLED rows=%s (harap 0)', v_n));

  -- V-10: anon — total baris terlihat = 7 (8 sinyal minus CANCELLED).
  reset role; perform pg_temp.clear_user();
  set role anon;
  select count(*) into v_n from public.signals_public;
  reset role;
  perform pg_temp.check('R61-V-10', v_n = 7, format('anon total rows=%s (harap 7)', v_n));

  -- V-11: orang asing — sinyal terkunci PENDING: entry NULL.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
  set role authenticated;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-V-11', v_entry is null, format('stranger locked PENDING entry=%s (harap NULL)', v_entry));

  -- V-12: ex-pelanggan (langganan dibatalkan) — sinyal terkunci: entry NULL.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000005');
  set role authenticated;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-V-12', v_entry is null, format('ex-sub locked PENDING entry=%s (harap NULL)', v_entry));

  -- V-13: pelanggan aktif — sinyal terkunci PENDING + AKTIF: entry PENUH.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000004');
  set role authenticated;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  perform pg_temp.check('R61-V-13a', v_entry = 1.1000, format('subscriber locked PENDING entry=%s (harap 1.1000)', v_entry));
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000004');
  set role authenticated;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000002';
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-V-13b', v_entry = 3600.00, format('subscriber locked AKTIF entry=%s (harap 3600)', v_entry));

  -- V-14: pemilik — sinyal terkunci sendiri: entry PENUH.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
  set role authenticated;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-V-14', v_entry = 1.1000, format('owner locked PENDING entry=%s (harap 1.1000)', v_entry));

  -- V-15: pemilik — CANCELLED sendiri TERLIHAT + entry PENUH.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
  set role authenticated;
  select entry into v_entry from public.signals_public where id = 'a0000000-0000-0000-0000-000000000004';
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-V-15', v_entry = 1.1000, format('owner CANCELLED entry=%s (harap 1.1000)', v_entry));

  -- V-16: pemilik — total baris terlihat = 8 (semua, termasuk CANCELLED sendiri).
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
  set role authenticated;
  select count(*) into v_n from public.signals_public;
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-V-16', v_n = 8, format('owner total rows=%s (harap 8)', v_n));

  -- V-17: anon — kolom NON-sensitif sinyal terkunci tetap terlihat
  -- (pair/direction/status/version BUKAN di-NULL-kan — hanya 5 kolom
  -- sensitif yang di-NULL-kan view).
  reset role; perform pg_temp.clear_user();
  set role anon;
  select pair, status, version into v_pair, v_status, v_n
    from public.signals_public where id = 'a0000000-0000-0000-0000-000000000001';
  reset role;
  perform pg_temp.check('R61-V-17', v_pair = 'EURUSD' and v_status = 'PENDING' and v_n = 1,
    format('anon locked pair=%s status=%s version=%s (harap EURUSD/PENDING/1)', v_pair, v_status, v_n));
exception when others then
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-V', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- H - helper signal_locked_for: unit + bukti bukan oracle.
-- ===========================================================================
do $$
declare
  v_b boolean;
  v_stranger boolean;
  v_subscriber boolean;
begin
  -- H-01: orang asing -> terkunci.
  perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
  v_b := public.signal_locked_for('d6100000-0000-0000-0000-000000000001', 'PENDING');
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-H-01', v_b is true, format('helper stranger O/PENDING=%s (harap true)', v_b));
  v_stranger := v_b;

  -- H-02: pelanggan aktif -> TIDAK terkunci.
  perform pg_temp.as_user('d6100000-0000-0000-0000-000000000004');
  v_b := public.signal_locked_for('d6100000-0000-0000-0000-000000000001', 'PENDING');
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-H-02', v_b is false, format('helper subscriber O/PENDING=%s (harap false)', v_b));
  v_subscriber := v_b;

  -- H-03: pemilik -> TIDAK terkunci.
  perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
  v_b := public.signal_locked_for('d6100000-0000-0000-0000-000000000001', 'PENDING');
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-H-03', v_b is false, format('helper owner O/PENDING=%s (harap false)', v_b));

  -- H-04: anon -> terkunci.
  perform pg_temp.clear_user();
  v_b := public.signal_locked_for('d6100000-0000-0000-0000-000000000001', 'PENDING');
  perform pg_temp.check('R61-H-04', v_b is true, format('helper anon O/PENDING=%s (harap true)', v_b));

  -- H-05: BUKAN oracle — input SAMA, pemanggil beda -> jawaban beda.
  -- (Tidak ada parameter pembaca, jadi pemanggil tidak bisa menanyakan
  -- status langganan orang lain; ia hanya mendapat jawaban tentang dirinya.)
  perform pg_temp.check('R61-H-05', v_stranger is true and v_subscriber is false,
    format('oracle-check stranger=%s subscriber=%s (harap true/false)', v_stranger, v_subscriber));

  -- H-06: trader L5 GRATIS -> tidak terkunci untuk siapa pun.
  perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
  v_b := public.signal_locked_for('d6100000-0000-0000-0000-000000000002', 'PENDING');
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-H-06', v_b is false, format('helper stranger F(L5 gratis)/PENDING=%s (harap false)', v_b));

  -- H-07: status WIN -> tidak terkunci walau trader berbayar.
  perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
  v_b := public.signal_locked_for('d6100000-0000-0000-0000-000000000001', 'WIN');
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-H-07', v_b is false, format('helper stranger O/WIN=%s (harap false)', v_b));
exception when others then
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-H', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- C - trigger guard_copy_locked + policy copies.
-- ===========================================================================
do $$
declare
  v_ok boolean; v_msg text; v_n int;
begin
  -- C-01: orang asing menyalin PENDING terkunci -> DITOLAK server (42501).
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
    set role authenticated;
    insert into public.copies (follower_id, signal_id, lot_size)
    values ('d6100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 0.05);
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%Sinyal terkunci%';
  end;
  perform pg_temp.check('R61-C-01', v_ok, format('stranger copy locked PENDING msg=%s', v_msg));

  -- C-02: orang asing menyalin AKTIF terkunci -> DITOLAK.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
    set role authenticated;
    insert into public.copies (follower_id, signal_id, lot_size)
    values ('d6100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', 0.02);
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%Sinyal terkunci%';
  end;
  perform pg_temp.check('R61-C-02', v_ok, format('stranger copy locked AKTIF msg=%s', v_msg));

  -- C-03: pelanggan aktif menyalin PENDING terkunci -> LOLOS.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000004');
    set role authenticated;
    insert into public.copies (follower_id, signal_id, lot_size)
    values ('d6100000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 0.05);
    reset role; perform pg_temp.clear_user();
    v_ok := true;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-C-03', v_ok, format('subscriber copy locked PENDING ok=%s msg=%s', v_ok, v_msg));

  -- C-04: pemilik menyalin sinyal terkunci SENDIRI -> LOLOS.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    insert into public.copies (follower_id, signal_id, lot_size)
    values ('d6100000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 0.05);
    reset role; perform pg_temp.clear_user();
    v_ok := true;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-C-04', v_ok, format('owner copy own locked PENDING ok=%s msg=%s', v_ok, v_msg));

  -- C-05: orang asing menyalin PENDING trader L5 GRATIS -> LOLOS.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
    set role authenticated;
    insert into public.copies (follower_id, signal_id, lot_size)
    values ('d6100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000005', 0.05);
    reset role; perform pg_temp.clear_user();
    v_ok := true;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-C-05', v_ok, format('stranger copy L5-gratis PENDING ok=%s msg=%s', v_ok, v_msg));

  -- C-06: orang asing menyalin WIN -> LOLOS (WIN tidak terkunci).
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
    set role authenticated;
    insert into public.copies (follower_id, signal_id, lot_size)
    values ('d6100000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000003', 0.05);
    reset role; perform pg_temp.clear_user();
    v_ok := true;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-C-06', v_ok, format('stranger copy WIN ok=%s msg=%s', v_ok, v_msg));

  -- C-07: pemilik membaca copies -> 4 baris (salinan sinyalnya: S->WIN,
  -- S->locked PENDING, R->WIN, + salinannya sendiri O->locked PENDING).
  -- Salinan R atas sinyal L/F TIDAK terlihat pemilik O.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
  set role authenticated;
  select count(*) into v_n from public.copies;
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-C-07', v_n = 4, format('owner copies rows=%s (harap 4)', v_n));

  -- C-08: pelanggan membaca copies sendiri -> 2 baris (WIN + locked PENDING).
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000004');
  set role authenticated;
  select count(*) into v_n from public.copies;
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-C-08', v_n = 2, format('subscriber copies rows=%s (harap 2)', v_n));

  -- C-09: orang asing membaca copies sendiri -> 3 baris (L + F + WIN).
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
  set role authenticated;
  select count(*) into v_n from public.copies;
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-C-09', v_n = 3, format('stranger copies rows=%s (harap 3)', v_n));

  -- C-10: ex-pelanggan (tanpa salinan) membaca copies -> 0 baris.
  reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000005');
  set role authenticated;
  select count(*) into v_n from public.copies;
  reset role; perform pg_temp.clear_user();
  perform pg_temp.check('R61-C-10', v_n = 0, format('ex-sub copies rows=%s (harap 0)', v_n));
exception when others then
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-C', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- G - grant/revoke: tabel mentah tertutup, view terbuka.
-- ===========================================================================
do $$
declare
  v_b boolean; v_ok boolean; v_msg text;
begin
  -- G-01: anon TIDAK punya SELECT ke tabel signals.
  v_b := has_table_privilege('anon', 'public.signals', 'SELECT');
  perform pg_temp.check('R61-G-01', v_b is false, format('anon SELECT signals=%s (harap false)', v_b));

  -- G-02: authenticated TIDAK punya SELECT ke tabel signals.
  v_b := has_table_privilege('authenticated', 'public.signals', 'SELECT');
  perform pg_temp.check('R61-G-02', v_b is false, format('auth SELECT signals=%s (harap false)', v_b));

  -- G-03: anon PUNYA SELECT ke view signals_public.
  v_b := has_table_privilege('anon', 'public.signals_public', 'SELECT');
  perform pg_temp.check('R61-G-03', v_b is true, format('anon SELECT signals_public=%s (harap true)', v_b));

  -- G-04: anon baca tabel mentah langsung -> permission denied.
  v_ok := false; v_msg := '';
  begin
    reset role; perform pg_temp.clear_user();
    set role anon;
    perform (select count(*) from public.signals);
    reset role;
  exception when others then
    reset role;
    v_msg := sqlerrm; v_ok := v_msg like '%permission denied%';
  end;
  perform pg_temp.check('R61-G-04', v_ok, format('anon direct signals msg=%s', v_msg));

  -- G-05: authenticated baca tabel mentah langsung -> permission denied.
  v_ok := false; v_msg := '';
  begin
    reset role; perform pg_temp.as_user('d6100000-0000-0000-0000-000000000006');
    set role authenticated;
    perform (select count(*) from public.signals);
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%permission denied%';
  end;
  perform pg_temp.check('R61-G-05', v_ok, format('auth direct signals msg=%s', v_msg));
exception when others then
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-G', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- P - regresi gerbang harga L5 (PALING AKHIR — memutasi harga trader uji).
-- ===========================================================================
do $$
declare
  v_ok boolean; v_msg text;
  v_stamp1 timestamptz; v_stamp2 timestamptz; v_price numeric;
begin
  -- P-01: trader L1 (bukan demo) pasang harga -> DITOLAK gerbang L5.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000003');
    set role authenticated;
    update public.traders set subscription_price_usd = 15.625 where profile_id = 'd6100000-0000-0000-0000-000000000003';
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%hanya untuk trader Level 5+%';
  end;
  perform pg_temp.check('R61-P-01', v_ok, format('L1 set price msg=%s', v_msg));

  -- P-02: trader L5 pasang harga DI BAWAH rentang ($5 < $6,25) -> DITOLAK.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    update public.traders set subscription_price_usd = 5.00 where profile_id = 'd6100000-0000-0000-0000-000000000001';
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%Rp100.000%';
  end;
  perform pg_temp.check('R61-P-02', v_ok, format('L5 set price $5 msg=%s', v_msg));

  -- P-03: trader L5 pasang harga DI ATAS rentang ($700 > $625) -> DITOLAK.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    update public.traders set subscription_price_usd = 700 where profile_id = 'd6100000-0000-0000-0000-000000000001';
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%Rp100.000%';
  end;
  perform pg_temp.check('R61-P-03', v_ok, format('L5 set price $700 msg=%s', v_msg));

  -- P-04: trader DEMO L1 pasang harga -> DIIZINKAN (pengecualian demo).
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000007');
    set role authenticated;
    update public.traders set subscription_price_usd = 15.625 where profile_id = 'd6100000-0000-0000-0000-000000000007';
    reset role; perform pg_temp.clear_user();
    -- Kolom numeric(12,2): 15.625 tersimpan sebagai 15.63.
    select subscription_price_usd into v_price from public.traders where profile_id = 'd6100000-0000-0000-0000-000000000007';
    v_ok := v_price = 15.63;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-P-04', v_ok, format('demo L1 set price ok=%s price=%s msg=%s', v_ok, v_price, v_msg));

  -- P-05: trader L5 mengubah harga (SETUP sudah memberi 15.63, jadi pakai
  -- 18.75 agar benar-benar berubah — bila nilainya sama, trigger menganggap
  -- tidak ada perubahan dan stempel tidak terisi) -> LOLOS + stempel terisi.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    update public.traders set subscription_price_usd = 18.75 where profile_id = 'd6100000-0000-0000-0000-000000000001';
    reset role; perform pg_temp.clear_user();
    select subscription_price_changed_at into v_stamp1 from public.traders where profile_id = 'd6100000-0000-0000-0000-000000000001';
    v_ok := v_stamp1 is not null;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-P-05', v_ok, format('L5 change price ok=%s stamp=%s msg=%s', v_ok, v_stamp1, v_msg));

  -- P-06 (ANTI-RESET, bagian 1): harga -> NULL DIIZINKAN, tapi stempel
  -- TIDAK berubah (dipaksa kembali ke nilai lama oleh trigger).
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    update public.traders set subscription_price_usd = null where profile_id = 'd6100000-0000-0000-0000-000000000001';
    reset role; perform pg_temp.clear_user();
    select subscription_price_usd, subscription_price_changed_at into v_price, v_stamp2
      from public.traders where profile_id = 'd6100000-0000-0000-0000-000000000001';
    v_ok := v_price is null and v_stamp2 is not distinct from v_stamp1;
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := false;
  end;
  perform pg_temp.check('R61-P-06', v_ok, format('price->NULL ok=%s price=%s stamp_unchanged=%s msg=%s', v_ok, v_price, (v_stamp2 is not distinct from v_stamp1), v_msg));

  -- P-07 (ANTI-RESET, bagian 2): pasang harga LAGI dalam sebulan sesudah
  -- trik NULL -> TETAP DITOLAK cooldown (bypass gagal).
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    update public.traders set subscription_price_usd = 20.00 where profile_id = 'd6100000-0000-0000-0000-000000000001';
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%1× sebulan%';
  end;
  perform pg_temp.check('R61-P-07', v_ok, format('price NULL->20 msg=%s', v_msg));

  -- P-08: harga tetap NULL sesudah penolakan P-07 (tidak berubah).
  select subscription_price_usd into v_price from public.traders where profile_id = 'd6100000-0000-0000-0000-000000000001';
  perform pg_temp.check('R61-P-08', v_price is null, format('price after rejected re-set=%s (harap NULL)', v_price));

  -- P-09: stempel cooldown tidak bisa diubah langsung.
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000001');
    set role authenticated;
    update public.traders set subscription_price_changed_at = now() - interval '2 months' where profile_id = 'd6100000-0000-0000-0000-000000000001';
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%Stempel cooldown tidak boleh diubah langsung%';
  end;
  perform pg_temp.check('R61-P-09', v_ok, format('direct stamp edit msg=%s', v_msg));

  -- P-10: trader L5 dalam masa jeda reset -> pasang harga DITOLAK.
  update public.trader_progress set reset_cooldown_until = now() + interval '1 month'
    where trader_id = 'd6100000-0000-0000-0000-000000000008';
  v_ok := false; v_msg := '';
  begin
    perform pg_temp.as_user('d6100000-0000-0000-0000-000000000008');
    set role authenticated;
    update public.traders set subscription_price_usd = 15.625 where profile_id = 'd6100000-0000-0000-0000-000000000008';
    reset role; perform pg_temp.clear_user();
  exception when others then
    reset role; perform pg_temp.clear_user();
    v_msg := sqlerrm; v_ok := v_msg like '%masa jeda reset%';
  end;
  perform pg_temp.check('R61-P-10', v_ok, format('reset-cooldown set price msg=%s', v_msg));
exception when others then
  reset role;
  perform pg_temp.clear_user();
  perform pg_temp.check('R61-P', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- RINGKASAN
-- ---------------------------------------------------------------------------
select test, status, detail from test_results order by test;
select count(*) filter (where status = 'PASS') as pass,
       count(*) filter (where status = 'FAIL') as fail,
       count(*) as total
from test_results;
