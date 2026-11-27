-- ============================================================================
-- OLE Signals - 29_r60_tests.sql
-- Tes verifikasi Ronde 60 (jarak entry PENDING MIN $2, lot acuan 0,01)
-- di Postgres SCRATCH - PEMBALIKAN Ronde 59 (maks $2 -> min $2).
--
-- JALANKAN HANYA DI SCRATCH (bukan live): file ini memakai harga tetap
-- dan mereset akun uji. Pola mengikuti 27_r59_tests.sql: user uji dibuat
-- di auth.users, hasil dicatat ke tabel temp test_results, satu tes gagal
-- TIDAK menghentikan tes lain. Jalankan ulang file ini untuk rerun - SETUP
-- menghapus sisa run sebelumnya.
--
-- Prasyarat: migrasi 01..28 sudah diterapkan (urutan scratch:
-- bootstrap auth, 01, 02, 09, 12, 13, 14, 15, 16, 17, 21, 22, 03, 18,
-- 23, 25, 26, 28). Identitas user disimulasikan lewat klaim JWT (teknik R27).
--
-- Yang diuji (R60-H-01..07, R60-C-01..28, R60-E-01a..05):
--   H: helper pending_entry_distance_usd per kelompok pair + null +
--      contoh user (harga emas 4002: entry 4000 = $2,00; 4001 = $1,00).
--      Helper TIDAK berubah di R60 - hanya ekspektasi create/edit yang
--      dibalik.
--   C: create - batas tepat $2,00 lolos / di bawah $2,00 ditolak
--      'distance' (emas, major USD-quote, JPY, CHF, CAD, GBP-quote);
--      sinyal XAUUSD user 26 Nov (entry $17 dan $36 dari harga) kini
--      LOLOS (tidak ada batas maks lagi); entry == harga ditolak;
--      harga hilang -> fail-closed 'invalid'; harga basi tetap
--      dipakai; urutan cek RR -> risiko -> jarak; blok jeda reset
--      dari 23 tetap hidup (bukti 28 dibangun dari 26, bukan 03).
--   E: edit - entry dekat ditolak + sinyal tidak berubah; edit jauh
--      lolos; edit ke entry == harga persis kini DITOLAK 'distance'
--      (tidak pernah lagi mengaktifkan langsung); edit tanpa harga ->
--      'invalid'; sinyal PENDING lama tidak dibatalkan retroaktif
--      (tetap PENDING apa adanya).
--
-- Harga acuan tes: XAUUSD 3590.00, EURUSD 1.0951, GBPUSD 1.3090,
-- USDJPY 159.16, AUDUSD 0.6600, NZDUSD 0.5500, USDCHF 0.8800,
-- USDCAD 1.3800, EURJPY 173.00, GBPJPY 210.00, EURGBP 0.8500.
-- SL/TP tiap kasus simetris (RR 1:1, risiko <= $42) supaya hanya jarak
-- yang membedakan lolos/tolak - kecuali C-24/C-25 yang memang menguji
-- urutan cek (keduanya JUGA gagal jarak, supaya cek RR/risiko yang
-- lebih dulu terbukti).
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

create or replace function pg_temp.set_price(p_pair text, p_price numeric, p_age interval default interval '0 minutes')
returns void
language sql
as $func$
  insert into public.prices (pair, price, fetched_at)
  values (p_pair, p_price, now() - p_age)
  on conflict (pair) do update set price = excluded.price, fetched_at = excluded.fetched_at;
$func$;

-- ---------------------------------------------------------------------------
-- SETUP: user uji R60 (UUID tetap supaya rerun membersihkan dirinya sendiri)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    'c0000000-0000-0000-0000-000000000001', -- T1: create (L1, ref $10.000)
    'c0000000-0000-0000-0000-000000000002', -- T2: edit + PENDING lama
    'c0000000-0000-0000-0000-000000000003', -- T3: EURUSD SELL batas
    'c0000000-0000-0000-0000-000000000004'  -- T4: sinyal jauh + harga basi
  ];
  v_id uuid;
begin
  perform pg_temp.clear_user();
  delete from public.audit_log where actor_id = any(v_ids);
  delete from public.notifications where user_id = any(v_ids);
  delete from public.copies where follower_id = any(v_ids);
  delete from public.subscriptions where follower_id = any(v_ids) or trader_id = any(v_ids);
  delete from public.signals where trader_id = any(v_ids);
  delete from public.trader_progress where trader_id = any(v_ids);
  delete from public.traders where profile_id = any(v_ids);
  delete from public.profiles where id = any(v_ids);
  delete from auth.users where id = any(v_ids);
  delete from public.prices;

  foreach v_id in array v_ids loop
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'r60-' || substr(v_id::text, 33, 4) || '@ole-signals.local', 'dummy-hash-tidak-untuk-login', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, username, display_name)
    values (v_id, 'r60_' || substr(v_id::text, 33, 4), 'R60 ' || substr(v_id::text, 33, 4))
    on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
    insert into public.traders (profile_id, username, trader_display_name, is_demo)
    values (v_id, 'r60_' || substr(v_id::text, 33, 4), 'R60 ' || substr(v_id::text, 33, 4), false)
    on conflict (profile_id) do update set username = excluded.username,
      trader_display_name = excluded.trader_display_name, is_demo = excluded.is_demo;
    insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
    values (v_id, 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0)
    on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd, level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level, trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd, max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;
  end loop;

  -- Harga live tetap (dipakai jarak + inferensi + konversi risiko).
  perform pg_temp.set_price('XAUUSD', 3590.00);
  perform pg_temp.set_price('EURUSD', 1.0951);
  perform pg_temp.set_price('GBPUSD', 1.3090);
  perform pg_temp.set_price('USDJPY', 159.16);
  perform pg_temp.set_price('AUDUSD', 0.6600);
  perform pg_temp.set_price('NZDUSD', 0.5500);
  perform pg_temp.set_price('USDCHF', 0.8800);
  perform pg_temp.set_price('USDCAD', 1.3800);
  perform pg_temp.set_price('EURJPY', 173.00);
  perform pg_temp.set_price('GBPJPY', 210.00);
  perform pg_temp.set_price('EURGBP', 0.8500);

  -- PENDING LAMA T2: entry $55 dari harga (dibuat SEBELUM aturan ada,
  -- insert langsung bypass RPC) - harus tetap PENDING apa adanya.
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, expires_at, version)
  values ('c0000000-0000-0000-0000-000000000002', 'EURUSD', 'BUY', 1.1500, 1.1450, 1.1550, 0.02, 'limit', 'PENDING', now(), now() + interval '3 days', 1);

  perform pg_temp.check('SETUP', true, '4 user uji R60 + progress L1 + 11 harga + 1 PENDING lama T2 (EURUSD 1.1500)');
exception when others then
  perform pg_temp.check('SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- H - helper pending_entry_distance_usd (unit; TIDAK berubah di R60).
-- ===========================================================================
do $$
declare
  v_h numeric;
begin
  -- H-01: emas tepat $2,00 (entry 3592.00 vs harga 3590.00).
  v_h := public.pending_entry_distance_usd('XAUUSD', 3592.00, 3590.00);
  perform pg_temp.check('R60-H-01', v_h = 2.00,
    format('helper XAUUSD = %s (harap 2.00)', v_h));
  -- H-02: EURUSD tepat $2,00 (20 pips).
  v_h := public.pending_entry_distance_usd('EURUSD', 1.0971, 1.0951);
  perform pg_temp.check('R60-H-02', v_h = 2.00,
    format('helper EURUSD = %s (harap 2.00)', v_h));
  -- H-03: USDJPY 0,31 = 31 pips -> $1,9477 (bukan bilangan bulat).
  v_h := public.pending_entry_distance_usd('USDJPY', 159.47, 159.16);
  perform pg_temp.check('R60-H-03', round(v_h, 4) = 1.9477,
    format('helper USDJPY = %s (harap 1.9477)', round(v_h, 4)));
  -- H-04: tanpa harga -> NULL.
  v_h := public.pending_entry_distance_usd('EURUSD', 1.0971, null);
  perform pg_temp.check('R60-H-04', v_h is null,
    format('helper tanpa harga = %s (harap NULL)', v_h));
  -- H-05: EURGBP 0,0015 (15 pips) -> $1,9635.
  v_h := public.pending_entry_distance_usd('EURGBP', 0.8515, 0.8500);
  perform pg_temp.check('R60-H-05', v_h = 1.9635,
    format('helper EURGBP = %s (harap 1.9635)', v_h));
  -- H-06: contoh user - harga emas 4002, entry 4000 -> tepat $2,00.
  v_h := public.pending_entry_distance_usd('XAUUSD', 4000.00, 4002.00);
  perform pg_temp.check('R60-H-06', v_h = 2.00,
    format('helper emas 4000 vs 4002 = %s (harap 2.00)', v_h));
  -- H-07: contoh user - harga emas 4002, entry 4001 -> $1,00 (terlalu dekat).
  v_h := public.pending_entry_distance_usd('XAUUSD', 4001.00, 4002.00);
  perform pg_temp.check('R60-H-07', v_h = 1.00,
    format('helper emas 4001 vs 4002 = %s (harap 1.00)', v_h));
exception when others then
  perform pg_temp.check('R60-H', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- C - create_signal: batas $2,00 lolos, di bawah $2,00 ditolak 'distance'.
-- SL/TP simetris (RR 1:1, risiko <= $42) supaya hanya jarak yang diuji.
-- ===========================================================================
do $$
declare
  v_t1 uuid := 'c0000000-0000-0000-0000-000000000001';
  v_t3 uuid := 'c0000000-0000-0000-0000-000000000003';
  v_t4 uuid := 'c0000000-0000-0000-0000-000000000004';
  r jsonb;
  s public.signals%rowtype;
begin
  perform pg_temp.clear_user();

  -- C-01: XAUUSD BUY tepat $2,00 lolos (entry 3592.00, harga 3590.00).
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('XAUUSD', 'BUY', 3592.00, 3590.00, 3594.00, 0.10, 'r60-c-01');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-01', (r->>'ok')::boolean,
    format('ok=%s code=%s (emas tepat $2.00)', r->>'ok', r->>'code'));

  -- C-02: XAUUSD BUY $2,01 lolos (di atas batas min, bukan lagi tolak).
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('XAUUSD', 'BUY', 3592.01, 3590.01, 3594.01, 0.10, 'r60-c-02');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-02', (r->>'ok')::boolean,
    format('ok=%s code=%s (emas $2.01)', r->>'ok', r->>'code'));

  -- C-03: XAUUSD BUY 3607.09 - sinyal user 26 Nov ($17,09 dari harga)
  -- kini LOLOS: tidak ada batas maks lagi.
  perform pg_temp.as_user(v_t4);
  r := public.create_signal('XAUUSD', 'BUY', 3607.09, 3605.09, 3609.09, 0.10, 'r60-c-03');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-03', (r->>'ok')::boolean,
    format('ok=%s code=%s (sinyal user 26 Nov BUY $17.09)', r->>'ok', r->>'code'));

  -- C-04: XAUUSD SELL 3554.27 - sinyal user 26 Nov ($35,73 dari harga)
  -- kini LOLOS.
  perform pg_temp.as_user(v_t4);
  r := public.create_signal('XAUUSD', 'SELL', 3554.27, 3556.27, 3552.27, 0.10, 'r60-c-04');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-04', (r->>'ok')::boolean,
    format('ok=%s code=%s (sinyal user 26 Nov SELL $35.73)', r->>'ok', r->>'code'));

  -- C-05: XAUUSD SELL tepat $2,00 lolos (T3 - T1 sudah punya 2 emas
  -- terbuka dari C-01/C-02).
  perform pg_temp.as_user(v_t3);
  r := public.create_signal('XAUUSD', 'SELL', 3588.00, 3590.00, 3586.00, 0.10, 'r60-c-05');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-05', (r->>'ok')::boolean,
    format('ok=%s code=%s (emas SELL tepat $2.00)', r->>'ok', r->>'code'));

  -- C-06: EURUSD BUY tepat $2,00 (20 pips) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURUSD', 'BUY', 1.0971, 1.0951, 1.0991, 0.20, 'r60-c-06');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-06', (r->>'ok')::boolean,
    format('ok=%s code=%s (EURUSD tepat $2.00)', r->>'ok', r->>'code'));

  -- C-07: EURUSD BUY $2,10 (21 pips) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURUSD', 'BUY', 1.0972, 1.0952, 1.0992, 0.20, 'r60-c-07');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-07', (r->>'ok')::boolean,
    format('ok=%s code=%s (EURUSD $2.10)', r->>'ok', r->>'code'));

  -- C-08: EURUSD SELL tepat $2,00 lolos (T3 - T1 sudah punya 2 EURUSD
  -- terbuka dari C-06/C-07).
  perform pg_temp.as_user(v_t3);
  r := public.create_signal('EURUSD', 'SELL', 1.0931, 1.0951, 1.0911, 0.20, 'r60-c-08');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-08', (r->>'ok')::boolean,
    format('ok=%s code=%s (EURUSD SELL tepat $2.00)', r->>'ok', r->>'code'));

  -- C-09: EURUSD SELL $2,10 lolos (T3, sinyal ke-2 EURUSD T3).
  perform pg_temp.as_user(v_t3);
  r := public.create_signal('EURUSD', 'SELL', 1.0930, 1.0950, 1.0910, 0.20, 'r60-c-09');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-09', (r->>'ok')::boolean,
    format('ok=%s code=%s (EURUSD SELL $2.10)', r->>'ok', r->>'code'));

  -- C-10: USDJPY BUY 31 pips ($1,95) ditolak 'distance' (di bawah min).
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDJPY', 'BUY', 159.47, 159.16, 159.78, 0.20, 'r60-c-10');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-10', not (r->>'ok')::boolean and (r->>'code') = 'distance',
    format('ok=%s code=%s (USDJPY 31 pips $1.95)', r->>'ok', r->>'code'));

  -- C-11: USDJPY BUY 32 pips ($2,01) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDJPY', 'BUY', 159.48, 159.16, 159.80, 0.20, 'r60-c-11');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-11', (r->>'ok')::boolean,
    format('ok=%s code=%s (USDJPY 32 pips $2.01)', r->>'ok', r->>'code'));

  -- C-12: USDCHF BUY 17 pips ($1,93) ditolak 'distance'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDCHF', 'BUY', 0.8817, 0.8800, 0.8834, 0.20, 'r60-c-12');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-12', not (r->>'ok')::boolean and (r->>'code') = 'distance',
    format('ok=%s code=%s (USDCHF 17 pips $1.93)', r->>'ok', r->>'code'));

  -- C-13: USDCHF BUY 18 pips ($2,05) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDCHF', 'BUY', 0.8818, 0.8800, 0.8836, 0.20, 'r60-c-13');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-13', (r->>'ok')::boolean,
    format('ok=%s code=%s (USDCHF 18 pips $2.05)', r->>'ok', r->>'code'));

  -- C-14: USDCAD BUY 27 pips ($1,96) ditolak 'distance'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDCAD', 'BUY', 1.3827, 1.3800, 1.3854, 0.20, 'r60-c-14');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-14', not (r->>'ok')::boolean and (r->>'code') = 'distance',
    format('ok=%s code=%s (USDCAD 27 pips $1.96)', r->>'ok', r->>'code'));

  -- C-15: USDCAD BUY 28 pips ($2,03) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDCAD', 'BUY', 1.3828, 1.3800, 1.3856, 0.20, 'r60-c-15');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-15', (r->>'ok')::boolean,
    format('ok=%s code=%s (USDCAD 28 pips $2.03)', r->>'ok', r->>'code'));

  -- C-16: EURGBP BUY 15 pips ($1,96) ditolak 'distance'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURGBP', 'BUY', 0.8515, 0.8500, 0.8530, 0.20, 'r60-c-16');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-16', not (r->>'ok')::boolean and (r->>'code') = 'distance',
    format('ok=%s code=%s (EURGBP 15 pips $1.96)', r->>'ok', r->>'code'));

  -- C-17: EURGBP BUY 16 pips ($2,09) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURGBP', 'BUY', 0.8516, 0.8500, 0.8532, 0.20, 'r60-c-17');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-17', (r->>'ok')::boolean,
    format('ok=%s code=%s (EURGBP 16 pips $2.09)', r->>'ok', r->>'code'));

  -- C-18: GBPJPY BUY 31 pips ($1,95) ditolak 'distance'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('GBPJPY', 'BUY', 210.31, 210.00, 210.62, 0.20, 'r60-c-18');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-18', not (r->>'ok')::boolean and (r->>'code') = 'distance',
    format('ok=%s code=%s (GBPJPY 31 pips $1.95)', r->>'ok', r->>'code'));

  -- C-19: GBPJPY BUY 32 pips ($2,01) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('GBPJPY', 'BUY', 210.32, 210.00, 210.64, 0.20, 'r60-c-19');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-19', (r->>'ok')::boolean,
    format('ok=%s code=%s (GBPJPY 32 pips $2.01)', r->>'ok', r->>'code'));

  -- C-20: AUDUSD BUY tepat $2,00 (20 pips) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('AUDUSD', 'BUY', 0.6620, 0.6600, 0.6640, 0.20, 'r60-c-20');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-20', (r->>'ok')::boolean,
    format('ok=%s code=%s (AUDUSD tepat $2.00)', r->>'ok', r->>'code'));

  -- C-21: NZDUSD BUY $2,10 (21 pips) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('NZDUSD', 'BUY', 0.5521, 0.5500, 0.5542, 0.20, 'r60-c-21');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-21', (r->>'ok')::boolean,
    format('ok=%s code=%s (NZDUSD $2.10)', r->>'ok', r->>'code'));

  -- C-22: harga EURGBP HILANG -> fail-closed 'invalid' (tetap seperti R59).
  delete from public.prices where pair = 'EURGBP';
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURGBP', 'BUY', 0.8515, 0.8500, 0.8530, 0.20, 'r60-c-22');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-22', not (r->>'ok')::boolean and (r->>'code') = 'invalid',
    format('ok=%s code=%s (EURGBP tanpa harga -> invalid)', r->>'ok', r->>'code'));
  perform pg_temp.set_price('EURGBP', 0.8500);

  -- C-23: harga EURUSD BASI 2 jam tetap dipakai (T4, trader segar).
  -- Entry tepat $2,00 dari harga basi lolos; bukan ditolak karena basi.
  perform pg_temp.set_price('EURUSD', 1.0951, interval '2 hours');
  perform pg_temp.as_user(v_t4);
  r := public.create_signal('EURUSD', 'BUY', 1.0971, 1.0951, 1.0991, 0.20, 'r60-c-23');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-23', (r->>'ok')::boolean,
    format('ok=%s code=%s (EURUSD harga basi 2 jam, tepat $2.00)', r->>'ok', r->>'code'));
  perform pg_temp.set_price('EURUSD', 1.0951);

  -- C-24: urutan cek - RR < 1 DAN jarak dekat ($1,00) -> kode 'rr'
  -- (bukan 'distance'): RR dicek di langkah 6, jarak di 7c.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('GBPUSD', 'BUY', 1.3100, 1.3090, 1.3105, 0.20, 'r60-c-24');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-24', not (r->>'ok')::boolean and (r->>'code') = 'rr',
    format('ok=%s code=%s (RR 0.5 + jarak $1.00 -> rr dulu)', r->>'ok', r->>'code'));

  -- C-25: urutan cek - risiko > 1% DAN jarak dekat ($1,00) -> kode 'risk'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('GBPUSD', 'BUY', 1.3100, 1.3050, 1.3200, 0.30, 'r60-c-25');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-25', not (r->>'ok')::boolean and (r->>'code') = 'risk',
    format('ok=%s code=%s (risiko $150 + jarak $1.00 -> risk dulu)', r->>'ok', r->>'code'));

  -- C-26: blok jeda reset dari 23 TETAP HIDUP di versi 28 (bukti 28
  -- dibangun dari 26, bukan 03): T1 dalam jeda -> 'resetcooldown'
  -- walau entry tepat $2,00.
  update public.trader_progress set reset_cooldown_until = now() + interval '1 day'
  where trader_id = v_t1;
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('AUDUSD', 'BUY', 0.6620, 0.6600, 0.6640, 0.20, 'r60-c-26');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-26', not (r->>'ok')::boolean and (r->>'code') = 'resetcooldown',
    format('ok=%s code=%s (jeda reset + entry $2.00 -> resetcooldown)', r->>'ok', r->>'code'));
  update public.trader_progress set reset_cooldown_until = null where trader_id = v_t1;

  -- C-27: PENDING lama T2 (EURUSD 1.1500, $55 dari harga) masih ada
  -- apa adanya - tidak dibatalkan retroaktif oleh aturan baru.
  select * into s from public.signals where trader_id = 'c0000000-0000-0000-0000-000000000002'
    and pair = 'EURUSD' and entry = 1.1500;
  perform pg_temp.check('R60-C-27', s.id is not null and s.status = 'PENDING',
    format('sinyal lama ada=%s status=%s entry=%s', s.id is not null, s.status, s.entry));

  -- C-28: entry == harga persis ($0,00) ditolak 'distance' (T4 -
  -- T4 baru punya 1 EURUSD terbuka dari C-23).
  perform pg_temp.as_user(v_t4);
  r := public.create_signal('EURUSD', 'BUY', 1.0951, 1.0931, 1.0971, 0.20, 'r60-c-28');
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-C-28', not (r->>'ok')::boolean and (r->>'code') = 'distance',
    format('ok=%s code=%s (entry == harga $0.00)', r->>'ok', r->>'code'));
exception when others then
  perform pg_temp.check('R60-C', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- E - update_signal: edit entry PENDING dicek ulang terhadap harga edit.
-- Pembalikan R59: entry dekat kini DITOLAK, entry jauh lolos, entry ==
-- harga DITOLAK (tidak pernah lagi mengaktifkan langsung).
-- ===========================================================================
do $$
declare
  v_t2 uuid := 'c0000000-0000-0000-0000-000000000002';
  r jsonb;
  s public.signals%rowtype;
  v_old_entry numeric;
  v_old_version integer;
begin
  perform pg_temp.clear_user();

  -- E-01a: T2 buat EURUSD PENDING tepat $2,00 (sinyal ke-2 EURUSD T2).
  perform pg_temp.as_user(v_t2);
  r := public.create_signal('EURUSD', 'BUY', 1.0971, 1.0951, 1.0991, 0.20, 'r60-e-01a');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t2 and pair = 'EURUSD' and entry = 1.0971 and status = 'PENDING';
  perform pg_temp.check('R60-E-01a', (r->>'ok')::boolean and s.id is not null,
    format('ok=%s code=%s (T2 EURUSD tepat $2.00)', r->>'ok', r->>'code'));

  -- E-01b: edit entry ke 1.0960 ($0,90) -> ditolak 'distance', sinyal utuh.
  v_old_entry := s.entry; v_old_version := s.version;
  perform pg_temp.as_user(v_t2);
  r := public.update_signal(s.id, 'EURUSD', 'BUY', 1.0960, 1.0940, 1.0980, 0.20, s.version);
  perform pg_temp.clear_user();
  select * into s from public.signals where id = s.id;
  perform pg_temp.check('R60-E-01b', not (r->>'ok')::boolean and (r->>'code') = 'distance'
    and s.entry = v_old_entry and s.version = v_old_version,
    format('ok=%s code=%s entry_tetap=%s version_tetap=%s', r->>'ok', r->>'code', s.entry, s.version));

  -- E-02: edit entry ke 1.0972 ($2,10) -> lolos, tetap PENDING.
  perform pg_temp.as_user(v_t2);
  r := public.update_signal(s.id, 'EURUSD', 'BUY', 1.0972, 1.0952, 1.0992, 0.20, s.version);
  perform pg_temp.clear_user();
  select * into s from public.signals where id = s.id;
  perform pg_temp.check('R60-E-02', (r->>'ok')::boolean and s.entry = 1.0972 and s.status = 'PENDING',
    format('ok=%s code=%s entry=%s status=%s', r->>'ok', r->>'code', s.entry, s.status));

  -- E-03: edit entry ke 1.0951 == harga persis -> DITOLAK 'distance'
  -- (jarak $0 < $2); sinyal tetap PENDING dengan entry 1.0972,
  -- version tidak berubah - edit TIDAK PERNAH lagi mengaktifkan langsung.
  v_old_entry := s.entry; v_old_version := s.version;
  perform pg_temp.as_user(v_t2);
  r := public.update_signal(s.id, 'EURUSD', 'BUY', 1.0951, 1.0931, 1.0971, 0.20, s.version);
  perform pg_temp.clear_user();
  select * into s from public.signals where id = s.id;
  perform pg_temp.check('R60-E-03', not (r->>'ok')::boolean and (r->>'code') = 'distance'
    and s.entry = v_old_entry and s.version = v_old_version and s.status = 'PENDING',
    format('ok=%s code=%s entry_tetap=%s version_tetap=%s status=%s', r->>'ok', r->>'code', s.entry, s.version, s.status));

  -- E-04: edit tanpa harga -> 'invalid'. T2 buat GBPUSD PENDING dulu.
  perform pg_temp.as_user(v_t2);
  r := public.create_signal('GBPUSD', 'BUY', 1.3110, 1.3090, 1.3130, 0.20, 'r60-e-04a');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t2 and pair = 'GBPUSD' and status = 'PENDING';
  delete from public.prices where pair = 'GBPUSD';
  perform pg_temp.as_user(v_t2);
  r := public.update_signal(s.id, 'GBPUSD', 'BUY', 1.3100, 1.3080, 1.3120, 0.20, s.version);
  perform pg_temp.clear_user();
  perform pg_temp.check('R60-E-04', not (r->>'ok')::boolean and (r->>'code') = 'invalid',
    format('ok=%s code=%s (edit GBPUSD tanpa harga -> invalid)', r->>'ok', r->>'code'));
  perform pg_temp.set_price('GBPUSD', 1.3090);

  -- E-05: edit PENDING LAMA (EURUSD 1.1500) ke 1.0960 ($0,90) -> ditolak
  -- 'distance'; sinyal lama tetap PENDING dengan entry 1.1500
  -- (tidak dibatalkan).
  select * into s from public.signals where trader_id = v_t2 and pair = 'EURUSD' and entry = 1.1500 and status = 'PENDING';
  perform pg_temp.as_user(v_t2);
  r := public.update_signal(s.id, 'EURUSD', 'BUY', 1.0960, 1.0940, 1.0980, 0.02, s.version);
  perform pg_temp.clear_user();
  select * into s from public.signals where id = s.id;
  perform pg_temp.check('R60-E-05', not (r->>'ok')::boolean and (r->>'code') = 'distance'
    and s.entry = 1.1500 and s.status = 'PENDING',
    format('ok=%s code=%s entry_tetap=%s status=%s', r->>'ok', r->>'code', s.entry, s.status));
exception when others then
  perform pg_temp.check('R60-E', false, 'exception: ' || sqlerrm);
end $$;

select * from test_results order by test;
select count(*) filter (where status = 'PASS') as pass,
       count(*) filter (where status = 'FAIL') as fail,
       count(*) as total from test_results;
