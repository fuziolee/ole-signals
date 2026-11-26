-- ============================================================================
-- OLE Signals — 24_r35_tests.sql
-- Tes verifikasi Ronde 35 (risiko saldo acuan level + entry Stop/Limit +
-- reset statistik) di Postgres SCRATCH.
--
-- JALANKAN HANYA DI SCRATCH (bukan live): file ini memakai harga tetap
-- dan mereset akun uji. Pola mengikuti 19_fase3_tests.sql: user uji dibuat
-- di auth.users, hasil dicatat ke tabel temp test_results, satu tes gagal
-- TIDAK menghentikan tes lain. Jalankan ulang file ini untuk rerun — SETUP
-- menghapus sisa run sebelumnya.
--
-- Prasyarat: migrasi 01..23 sudah diterapkan (urutan riwayat live:
-- 01, 02, 03-versi-lama, 09, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23).
-- Identitas user disimulasikan lewat klaim JWT (teknik R27):
--   select set_config('request.jwt.claims', '{"sub":"<uid>",...}', false);
-- Fungsi RPC SECURITY DEFINER membaca auth.uid() dari klaim itu — TIDAK
-- perlu `set role authenticated` (tulis langsung tetap sebagai postgres
-- sehingga RLS tidak menghalangi setup; klaim dibersihkan sebelum DML
-- langsung supaya trigger guard tidak salah menilai).
--
-- Yang diuji (R35-RISK-01..06, R35-ENTRY-00..07, R35-SET-01..08,
-- R35-RESET-01..08):
--   RISK: batas 1% dari ref(L) — L1 saldo $9.000/ref $10.000 ($100 lolos,
--     $101 ditolak); L2 ref $10.500 ($105 lolos, $106 ditolak); di bawah
--     maks bebas dipilih trader (0,5% lolos); update ke $101 ditolak.
--   ENTRY: inferensi BUY/SELL x stop/limit (termasuk entry = harga ->
--     limit, tanpa harga -> limit) + update mengubah jenis entry.
--   SET: matriks aktivasi per jenis (tidak aktif di sisi yang salah;
--     aktif saat menyentuh) + penutupan satu putaran via gap (stop BISA
--     WIN; limit satu putaran selalu LOSS) + sinyal lama default 'limit'.
--   RESET: jalur sukses (sinyal terhapus, salinan bertahan + snapshot,
--     langganan dijeda, notifikasi, audit, statistik nol), penolakan
--     jeda (reset ulang / posting / update / ubah harga 42501),
--     pengecualian demo (reset 2x + posting langsung), backstop
--     'resettoosoon', helper trader_in_reset_cooldown.
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

-- Identitas user uji (klaim JWT sesi; lihat catatan header).
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

-- Sinyal sekali-pakai langsung insert (bypass create_signal — untuk uji
-- settle; entry_type eksplisit supaya matriks tidak bergantung inferensi).
create or replace function pg_temp.mk_pending(
  p_trader uuid, p_pair text, p_dir text,
  p_entry numeric, p_sl numeric, p_tp numeric, p_lot numeric,
  p_entry_type text default 'limit',
  p_expires timestamptz default now() + interval '3 days'
) returns uuid
language plpgsql
as $func$
declare
  v_id uuid;
begin
  insert into public.signals
    (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size,
     entry_type, status, created_at, expires_at, version)
  values
    (p_trader, p_pair, p_dir, p_entry, p_sl, p_tp, p_lot,
     p_entry_type, 'PENDING', now(), p_expires, 1)
  returning id into v_id;
  return v_id;
end;
$func$;

-- Bersihkan semua sinyal terbuka milik trader uji r35 (settle memproses
-- SEMUA sinyal terbuka — pola yang sama dipakai 19_fase3_tests.sql).
create or replace function pg_temp.clean_open()
returns void
language sql
as $func$
  -- D-R35-4: traders TIDAK punya kolom id (PK-nya profile_id). Versi lama
  -- menulis `select id ...` sehingga `id` terikat ke signals.id di query
  -- luar (correlated subquery) dan clean_open tidak menghapus apa-apa —
  -- sinyal sisa tes RISK/ENTRY ikut teraktivasi/tertutup di run berikutnya
  -- (SET-01a activated=3, SET-05 wins=5). Mesinnya benar; tesnya yang salah.
  delete from public.signals
  where trader_id in (select profile_id from public.traders where username like 'r35%')
    and status in ('PENDING', 'AKTIF');
$func$;

-- ---------------------------------------------------------------------------
-- SETUP: user uji R35 (UUID tetap supaya rerun membersihkan dirinya sendiri)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    'b0000000-0000-0000-0000-000000000001', -- T1: risiko L1, saldo $9.000
    'b0000000-0000-0000-0000-000000000002', -- T2: risiko L2, ref $10.500
    'b0000000-0000-0000-0000-000000000003', -- T3: matriks settlement
    'b0000000-0000-0000-0000-000000000004', -- T4: reset (L3, 3 sinyal)
    'b0000000-0000-0000-0000-000000000005', -- T5: demo (bebas cooldown)
    'b0000000-0000-0000-0000-000000000006', -- T6: penyalin (copier)
    'b0000000-0000-0000-0000-000000000007'  -- T7: pelanggan (subscriber)
  ];
  v_id uuid;
begin
  perform pg_temp.clear_user();
  delete from public.audit_log where actor_id = any(v_ids);
  delete from public.notifications where user_id = any(v_ids);
  delete from public.settlement_runs where run_at >= now() - interval '1 hour';
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
    values (v_id, '00000000-0000-0000-0000-000000000000', 'r35-' || substr(v_id::text, 33, 4) || '@ole-signals.local', 'dummy-hash-tidak-untuk-login', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now());
    -- Trigger on_auth_user_created (03) sudah membuat baris profiles;
    -- upsert supaya rerun + urutan ini tidak bentrok (pola yang sama di 19).
    insert into public.profiles (id, username, display_name)
    values (v_id, 'r35_' || substr(v_id::text, 33, 4), 'R35 ' || substr(v_id::text, 33, 4))
    on conflict (id) do update set username = excluded.username, display_name = excluded.display_name;
    insert into public.traders (profile_id, username, trader_display_name, is_demo)
    values (v_id, 'r35_' || substr(v_id::text, 33, 4), 'R35 ' || substr(v_id::text, 33, 4),
            v_id = 'b0000000-0000-0000-0000-000000000005')
    on conflict (profile_id) do update set username = excluded.username,
      trader_display_name = excluded.trader_display_name, is_demo = excluded.is_demo;
  end loop;

  -- T1: L1, saldo simulasi $9.000 (di bawah ref $10.000 — inti uji risiko).
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values ('b0000000-0000-0000-0000-000000000001', 1, 9000.00, 10000.00, 0, 0, 10000.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd, level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level, trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd, max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;
  -- T2: L2, ref $10.500.
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values ('b0000000-0000-0000-0000-000000000002', 2, 10500.00, 10500.00, 0, 5, 10500.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd, level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level, trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd, max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;
  -- T3: L1 standar (matriks settlement).
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values ('b0000000-0000-0000-0000-000000000003', 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd, level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level, trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd, max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;
  -- T4: L3, saldo $11.200, R +3, 5 trade, DD $100 (akan direset).
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values ('b0000000-0000-0000-0000-000000000004', 3, 11200.00, 11025.00, 3, 5, 11200.00, 100, 0.8929)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd, level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level, trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd, max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;
  -- T5: demo L1 (reset tanpa cooldown).
  insert into public.trader_progress (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values ('b0000000-0000-0000-0000-000000000005', 1, 10000.00, 10000.00, 0, 0, 10000.00, 0, 0)
  on conflict (trader_id) do update set level = excluded.level, balance_usd = excluded.balance_usd, level_ref_balance = excluded.level_ref_balance, r_since_level = excluded.r_since_level, trades_since_level = excluded.trades_since_level, peak_balance_usd = excluded.peak_balance_usd, max_drawdown_usd = excluded.max_drawdown_usd, max_drawdown_pct = excluded.max_drawdown_pct;

  -- Harga live (dipakai inferensi entry_type + konversi risiko/settlement).
  perform pg_temp.set_price('EURUSD', 1.0951);
  perform pg_temp.set_price('GBPUSD', 1.3090);
  perform pg_temp.set_price('USDJPY', 159.16);
  perform pg_temp.set_price('AUDUSD', 0.6600);
  perform pg_temp.set_price('NZDUSD', 0.5500);
  -- EURGBP SENGAJA tanpa harga (uji fallback 'limit' ENTRY-06).

  -- T4: 3 sinyal (PENDING + AKTIF + WIN) + salinan T6 + langganan T7.
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, expires_at, version)
  values ('b0000000-0000-0000-0000-000000000004', 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'limit', 'PENDING', now(), now() + interval '3 days', 1);
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, activated_at, expires_at, version)
  values ('b0000000-0000-0000-0000-000000000004', 'GBPUSD', 'BUY', 1.3000, 1.2950, 1.3050, 0.02, 'limit', 'AKTIF', now() - interval '2 hours', now() - interval '2 hours', now() + interval '3 days', 1);
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, activated_at, closed_at, close_price, profit_usd, profit_pips, r_value, version)
  values ('b0000000-0000-0000-0000-000000000004', 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10, 'limit', 'WIN', now() - interval '1 day', now() - interval '1 day', now() - interval '23 hours', 4020, 200.00, 200, 2.0, 1);
  insert into public.copies (follower_id, signal_id, lot_size, status)
  select 'b0000000-0000-0000-0000-000000000006', id, 0.02, 'copied'
  from public.signals where trader_id = 'b0000000-0000-0000-0000-000000000004' and status = 'AKTIF';
  insert into public.copies (follower_id, signal_id, lot_size, status)
  select 'b0000000-0000-0000-0000-000000000006', id, 0.10, 'closed'
  from public.signals where trader_id = 'b0000000-0000-0000-0000-000000000004' and status = 'WIN';
  insert into public.subscriptions (follower_id, trader_id, price_usd, status, started_at, ends_at)
  values ('b0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000004', 10.00, 'active', now() - interval '10 days', now() + interval '20 days');

  -- T5: 1 sinyal PENDING (akan direset 2x untuk uji pengecualian demo).
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, expires_at, version)
  values ('b0000000-0000-0000-0000-000000000005', 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'limit', 'PENDING', now(), now() + interval '3 days', 1);

  perform pg_temp.check('SETUP', true, '7 user uji R35 + progress + harga + data reset (T4: 3 sinyal, 2 salinan, 1 langganan; T5: 1 sinyal)');
exception when others then
  perform pg_temp.check('SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- RISIKO — batas 1% dari SALDO ACUAN LEVEL ref(L), bukan saldo simulasi.
-- EURUSD/GBPUSD/AUDUSD: risiko = |entry-SL| x lot x 100.000 (quote USD = 1).
-- SL 50 pips (0,0050) -> lot 0,20 = $100; 0,202 = $101; 0,21 = $105;
-- 0,212 = $106; 0,10 = $50. Batas: risk/ref > 0,01 ditolak (tepat 1% lolos).
-- ===========================================================================
do $$
declare
  v_t1 uuid := 'b0000000-0000-0000-0000-000000000001';
  v_t2 uuid := 'b0000000-0000-0000-0000-000000000002';
  r jsonb;
  s public.signals%rowtype;
begin
  perform pg_temp.clear_user();
  -- R35-RISK-01: T1 L1 saldo $9.000/ref $10.000 — risiko TEPAT $100 lolos
  -- (bila penyebut masih saldo aktual $9.000, $100 = 1,11% dan DITOLAK —
  -- tes ini membedakan aturan lama vs baru). Entry 1,1000 > harga 1,0951
  -- -> jenis 'stop' (dicatat juga untuk ENTRY-01).
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.20, 'r35-risk-01');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t1 and pair = 'EURUSD' and status = 'PENDING';
  perform pg_temp.check('R35-RISK-01', (r->>'ok')::boolean
    and s.id is not null and s.entry_type = 'stop',
    format('ok=%s code=%s entry_type=%s (saldo $9.000, ref $10.000, risiko $100 = 1%% ref)', r->>'ok', r->>'code', s.entry_type));

  -- R35-RISK-02: T1 lot 0,202 -> risiko $101 (1,01% ref) DITOLAK kode 'risk'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('GBPUSD', 'BUY', 1.3100, 1.3050, 1.3150, 0.202, 'r35-risk-02');
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RISK-02', not (r->>'ok')::boolean and (r->>'code') = 'risk',
    format('ok=%s code=%s msg=%s', r->>'ok', r->>'code', r->>'message'));

  -- R35-RISK-03: T2 L2 ref $10.500 — risiko TEPAT $105 lolos.
  perform pg_temp.as_user(v_t2);
  r := public.create_signal('EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.21, 'r35-risk-03');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t2 and pair = 'EURUSD' and status = 'PENDING';
  perform pg_temp.check('R35-RISK-03', (r->>'ok')::boolean and s.id is not null,
    format('ok=%s code=%s (L2 ref $10.500, risiko $105 = 1%% ref)', r->>'ok', r->>'code'));

  -- R35-RISK-04: T2 lot 0,212 -> risiko $106 (1,0095% ref) DITOLAK.
  perform pg_temp.as_user(v_t2);
  r := public.create_signal('GBPUSD', 'BUY', 1.3100, 1.3050, 1.3150, 0.212, 'r35-risk-04');
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RISK-04', not (r->>'ok')::boolean and (r->>'code') = 'risk',
    format('ok=%s code=%s msg=%s', r->>'ok', r->>'code', r->>'message'));

  -- R35-RISK-05: di bawah maks BEBAS dipilih trader — $50 (0,5% ref) lolos.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('AUDUSD', 'BUY', 0.6650, 0.6600, 0.6700, 0.10, 'r35-risk-05');
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RISK-05', (r->>'ok')::boolean,
    format('ok=%s code=%s (risiko $50 = 0,5%% ref — bukan kewajiban tepat 1%%)', r->>'ok', r->>'code'));

  -- R35-RISK-06: update sinyal RISK-01 (lot 0,20 -> 0,202) DITOLAK 'risk'.
  select * into s from public.signals where trader_id = v_t1 and pair = 'EURUSD' and status = 'PENDING';
  perform pg_temp.as_user(v_t1);
  r := public.update_signal(s.id, 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.202, s.version);
  perform pg_temp.clear_user();
  select * into s from public.signals where id = s.id;
  perform pg_temp.check('R35-RISK-06', not (r->>'ok')::boolean and (r->>'code') = 'risk'
    and s.lot_size = 0.20,
    format('ok=%s code=%s lot_tetap=%s', r->>'ok', r->>'code', s.lot_size));
exception when others then
  perform pg_temp.check('R35-RISK', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- ENTRY — inferensi dari entry vs harga live (tanpa selector manual).
-- Harga: EURUSD 1,0951; GBPUSD 1,3090; USDJPY 159,16; AUDUSD 0,6600;
-- NZDUSD 0,5500; EURGBP TANPA harga (fallback 'limit').
-- ===========================================================================
do $$
declare
  v_t1 uuid := 'b0000000-0000-0000-0000-000000000001';
  r jsonb;
  s public.signals%rowtype;
begin
  perform pg_temp.clear_user();
  -- R35-ENTRY-00: unit infer_entry_type (7 kasus sekaligus).
  perform pg_temp.check('R35-ENTRY-00',
    public.infer_entry_type('BUY', 1.1000, 1.0951) = 'stop'
    and public.infer_entry_type('BUY', 1.0900, 1.0951) = 'limit'
    and public.infer_entry_type('BUY', 1.0951, 1.0951) = 'limit'
    and public.infer_entry_type('SELL', 1.0900, 1.0951) = 'stop'
    and public.infer_entry_type('SELL', 1.1000, 1.0951) = 'limit'
    and public.infer_entry_type('SELL', 1.0951, 1.0951) = 'limit'
    and public.infer_entry_type('BUY', 1.1000, null) = 'limit',
    'BUY>/<=/=, SELL</>=/=, tanpa harga -> limit');

  -- R35-ENTRY-01: sudah dibuktikan RISK-01 (BUY 1,1000 > harga 1,0951 -> stop).
  select * into s from public.signals where trader_id = v_t1 and pair = 'EURUSD' and status = 'PENDING';
  perform pg_temp.check('R35-ENTRY-01', s.entry_type = 'stop',
    format('BUY entry 1,1000 > harga 1,0951 -> %s', s.entry_type));

  -- R35-ENTRY-02: BUY 1,3000 < harga GBPUSD 1,3090 -> limit.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('GBPUSD', 'BUY', 1.3000, 1.2950, 1.3050, 0.02, 'r35-entry-02');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t1 and pair = 'GBPUSD' and status = 'PENDING';
  perform pg_temp.check('R35-ENTRY-02', (r->>'ok')::boolean and s.entry_type = 'limit',
    format('ok=%s entry_type=%s', r->>'ok', s.entry_type));

  -- R35-ENTRY-03: SELL 159,00 < harga USDJPY 159,16 -> stop.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('USDJPY', 'SELL', 159.00, 159.20, 158.50, 0.02, 'r35-entry-03');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t1 and pair = 'USDJPY' and status = 'PENDING';
  perform pg_temp.check('R35-ENTRY-03', (r->>'ok')::boolean and s.entry_type = 'stop',
    format('ok=%s entry_type=%s', r->>'ok', s.entry_type));

  -- R35-ENTRY-04: SELL 0,6650 > harga AUDUSD 0,6600 -> limit.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('AUDUSD', 'SELL', 0.6650, 0.6700, 0.6600, 0.02, 'r35-entry-04');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t1 and pair = 'AUDUSD' and direction = 'SELL' and status = 'PENDING';
  perform pg_temp.check('R35-ENTRY-04', (r->>'ok')::boolean and s.entry_type = 'limit',
    format('ok=%s entry_type=%s', r->>'ok', s.entry_type));

  -- R35-ENTRY-05: BUY entry SAMA PERSIS dengan harga NZDUSD 0,5500 -> limit.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('NZDUSD', 'BUY', 0.5500, 0.5450, 0.5550, 0.02, 'r35-entry-05');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t1 and pair = 'NZDUSD' and status = 'PENDING';
  perform pg_temp.check('R35-ENTRY-05', (r->>'ok')::boolean and s.entry_type = 'limit',
    format('ok=%s entry_type=%s', r->>'ok', s.entry_type));

  -- R35-ENTRY-06: EURGBP TANPA harga live -> fallback 'limit'.
  perform pg_temp.as_user(v_t1);
  r := public.create_signal('EURGBP', 'BUY', 0.8500, 0.8450, 0.8550, 0.02, 'r35-entry-06');
  perform pg_temp.clear_user();
  select * into s from public.signals where trader_id = v_t1 and pair = 'EURGBP' and status = 'PENDING';
  perform pg_temp.check('R35-ENTRY-06', (r->>'ok')::boolean and s.entry_type = 'limit',
    format('ok=%s entry_type=%s (tanpa harga EURGBP)', r->>'ok', s.entry_type));

  -- R35-ENTRY-07: update sinyal RISK-01 (stop, entry 1,1000) ke entry
  -- 1,0900 < harga 1,0951 -> jenis BERUBAH jadi 'limit' (risiko tetap $100).
  select * into s from public.signals where trader_id = v_t1 and pair = 'EURUSD' and status = 'PENDING';
  perform pg_temp.as_user(v_t1);
  r := public.update_signal(s.id, 'EURUSD', 'BUY', 1.0900, 1.0850, 1.0950, 0.20, s.version);
  perform pg_temp.clear_user();
  select * into s from public.signals where id = s.id;
  perform pg_temp.check('R35-ENTRY-07', (r->>'ok')::boolean and s.entry_type = 'limit'
    and s.entry = 1.0900,
    format('ok=%s entry_type=%s entry=%s', r->>'ok', s.entry_type, s.entry));
exception when others then
  perform pg_temp.check('R35-ENTRY', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- RESET — RPC reset_trader_stats + penegakan jeda.
-- T4: L3 $11.200 R+3 (3 sinyal, 2 salinan T6, 1 langganan T7).
-- T5: demo (1 sinyal; bebas cooldown).
-- ===========================================================================
do $$
declare
  v_t4 uuid := 'b0000000-0000-0000-0000-000000000004';
  v_t5 uuid := 'b0000000-0000-0000-0000-000000000005';
  v_t6 uuid := 'b0000000-0000-0000-0000-000000000006';
  v_t7 uuid := 'b0000000-0000-0000-0000-000000000007';
  r jsonb;
  p public.trader_progress%rowtype;
  v_n int;
  v_ok boolean := true;
  v_detail text := '';
begin
  perform pg_temp.clear_user();
  -- R35-RESET-01: jalur sukses T4 — 3 sinyal terhapus, 1 langganan dijeda,
  -- refund_pending=true, cooldown ~+1 bulan; salinan BERTAHAN + snapshot;
  -- notifikasi ke trader/pelanggan/penyalin; audit 'trader_reset'.
  perform pg_temp.as_user(v_t4);
  r := public.reset_trader_stats();
  perform pg_temp.clear_user();
  select * into p from public.trader_progress where trader_id = v_t4;
  v_ok := (r->>'ok')::boolean
    and (r->>'deleted')::int = 3
    and (r->>'paused')::int = 1
    and (r->>'refund_pending')::boolean = true
    and (r->>'cooldown_until') is not null
    and (select count(*) from public.signals where trader_id = v_t4) = 0
    and p.level = 1 and p.balance_usd = 10000.00
    and p.level_ref_balance = 10000.00 and p.r_since_level = 0
    and p.trades_since_level = 0 and p.max_drawdown_usd = 0
    and p.last_reset_at is not null and p.reset_cooldown_until is not null
    and p.reset_cooldown_until > now()
    and (select status from public.subscriptions where trader_id = v_t4) = 'paused'
    and (select count(*) from public.copies where follower_id = v_t6) = 2
    and (select count(*) from public.copies where follower_id = v_t6 and signal_id is null and signal_snapshot is not null) = 2
    and (select count(*) from public.copies where follower_id = v_t6 and (signal_snapshot->>'pair') in ('GBPUSD', 'XAUUSD')) = 2
    and (select count(*) from public.notifications where user_id = v_t4 and type = 'reset') = 1
    and (select count(*) from public.notifications where user_id = v_t7 and type = 'reset') = 1
    and (select count(*) from public.notifications where user_id = v_t6 and type = 'reset') = 1
    and (select count(*) from public.audit_log where actor_id = v_t4 and action = 'trader_reset') = 1;
  perform pg_temp.check('R35-RESET-01', v_ok,
    format('ok=%s deleted=%s paused=%s refund_pending=%s cooldown=%s saldo=%s L%s salinan=%s snapshot=%s notif(T4/T7/T6)=%s/%s/%s',
      r->>'ok', r->>'deleted', r->>'paused', r->>'refund_pending', r->>'cooldown_until', p.balance_usd, p.level,
      (select count(*) from public.copies where follower_id = v_t6),
      (select count(*) from public.copies where follower_id = v_t6 and signal_snapshot is not null),
      (select count(*) from public.notifications where user_id = v_t4 and type = 'reset'),
      (select count(*) from public.notifications where user_id = v_t7 and type = 'reset'),
      (select count(*) from public.notifications where user_id = v_t6 and type = 'reset')));

  -- R35-RESET-02: reset ulang langsung -> 'resetcooldown'.
  perform pg_temp.as_user(v_t4);
  r := public.reset_trader_stats();
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET-02', not (r->>'ok')::boolean and (r->>'code') = 'resetcooldown',
    format('ok=%s code=%s', r->>'ok', r->>'code'));

  -- R35-RESET-03: posting selama jeda -> 'resetcooldown'.
  perform pg_temp.as_user(v_t4);
  r := public.create_signal('EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'r35-reset-03');
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET-03', not (r->>'ok')::boolean and (r->>'code') = 'resetcooldown',
    format('ok=%s code=%s', r->>'ok', r->>'code'));

  -- R35-RESET-04: update selama jeda -> 'resetcooldown' (dicek SEBELUM
  -- sinyal dimuat — UUID acak pun ditolak dengan kode jeda).
  perform pg_temp.as_user(v_t4);
  r := public.update_signal(gen_random_uuid(), 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 1);
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET-04', not (r->>'ok')::boolean and (r->>'code') = 'resetcooldown',
    format('ok=%s code=%s', r->>'ok', r->>'code'));

  -- R35-RESET-05: ubah harga langganan selama jeda -> trigger 42501.
  begin
    perform pg_temp.as_user(v_t4);
    update public.traders set subscription_price_usd = 25.00 where profile_id = v_t4;
    perform pg_temp.clear_user();
    perform pg_temp.check('R35-RESET-05', false, 'update harga LOLOS (seharusnya ditolak 42501)');
  exception when others then
    perform pg_temp.clear_user();
    perform pg_temp.check('R35-RESET-05', sqlstate = '42501',
      format('sqlstate=%s msg=%s', sqlstate, sqlerrm));
  end;

  -- R35-RESET-06: helper — T4 dalam jeda, T5 (demo) tidak, T1 tidak.
  perform pg_temp.check('R35-RESET-06',
    public.trader_in_reset_cooldown(v_t4) = true
    and public.trader_in_reset_cooldown(v_t5) = false
    and public.trader_in_reset_cooldown('b0000000-0000-0000-0000-000000000001') = false,
    'T4=true, T5 demo=false, T1=false');

  -- R35-RESET-07: demo T5 reset 2x berturut-turut (bebas cooldown) +
  -- posting langsung setelah reset tetap bisa.
  perform pg_temp.as_user(v_t5);
  r := public.reset_trader_stats();
  perform pg_temp.clear_user();
  select * into p from public.trader_progress where trader_id = v_t5;
  v_ok := (r->>'ok')::boolean and (r->>'deleted')::int = 1
    and (r->>'cooldown_until') is null and p.reset_cooldown_until is null
    and p.last_reset_at is not null;
  perform pg_temp.check('R35-RESET-07a', v_ok,
    format('reset demo #1: ok=%s deleted=%s cooldown_until=%s', r->>'ok', r->>'deleted', r->>'cooldown_until'));
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, expires_at, version)
  values (v_t5, 'GBPUSD', 'BUY', 1.3000, 1.2950, 1.3050, 0.02, 'limit', 'PENDING', now(), now() + interval '3 days', 1);
  perform pg_temp.as_user(v_t5);
  r := public.reset_trader_stats();
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET-07b', (r->>'ok')::boolean and (r->>'deleted')::int = 1,
    format('reset demo #2 langsung: ok=%s deleted=%s', r->>'ok', r->>'deleted'));
  perform pg_temp.as_user(v_t5);
  r := public.create_signal('EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'r35-reset-07c');
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET-07c', (r->>'ok')::boolean,
    format('posting demo pasca-reset: ok=%s code=%s', r->>'ok', r->>'code'));

  -- R35-RESET-08: backstop 'resettoosoon' — cooldown_until dikosongkan
  -- manual (last_reset_at masih < 1 bulan) -> reset ditolak kode kedua.
  update public.trader_progress set reset_cooldown_until = null where trader_id = v_t4;
  perform pg_temp.as_user(v_t4);
  r := public.reset_trader_stats();
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET-08', not (r->>'ok')::boolean and (r->>'code') = 'resettoosoon',
    format('ok=%s code=%s', r->>'ok', r->>'code'));
exception when others then
  perform pg_temp.clear_user();
  perform pg_temp.check('R35-RESET', false, 'exception: ' || sqlerrm);
end $$;

-- ===========================================================================
-- SETTLEMENT — matriks aktivasi per entry_type + penutupan satu putaran.
-- T3, EURUSD, lot 0,02, SL 50 pips / TP 50 pips (risiko $10, RR 1:1).
-- Sinyal uji lain dibersihkan sebelum tiap putaran (pola 19).
-- ===========================================================================
do $$
declare
  v_t3 uuid := 'b0000000-0000-0000-0000-000000000003';
  v_sig uuid;
  v_r jsonb;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
begin
  perform pg_temp.clear_user();
  -- R35-SET-01: BUY limit — harga 1,1001 (di atas entry) TIDAK aktif;
  -- harga 1,1000 (menyentuh) AKTIF.
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'limit');
  perform pg_temp.set_price('EURUSD', 1.1001);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-01a', s.status = 'PENDING' and (v_r->>'activated')::int = 0,
    format('harga 1,1001 > entry 1,1000 (limit BUY): status=%s activated=%s', s.status, v_r->>'activated'));
  perform pg_temp.set_price('EURUSD', 1.1000);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-01b', s.status = 'AKTIF' and s.activated_at is not null and (v_r->>'activated')::int = 1,
    format('harga 1,1000 = entry (limit BUY): status=%s', s.status));

  -- R35-SET-02: BUY stop — harga 1,0999 (di bawah entry) TIDAK aktif;
  -- harga 1,1000 AKTIF.
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'stop');
  perform pg_temp.set_price('EURUSD', 1.0999);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-02a', s.status = 'PENDING' and (v_r->>'activated')::int = 0,
    format('harga 1,0999 < entry 1,1000 (stop BUY): status=%s', s.status));
  perform pg_temp.set_price('EURUSD', 1.1000);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-02b', s.status = 'AKTIF' and (v_r->>'activated')::int = 1,
    format('harga 1,1000 = entry (stop BUY): status=%s', s.status));

  -- R35-SET-03: SELL limit — harga 1,0999 (di bawah entry) TIDAK aktif;
  -- harga 1,1000 AKTIF.
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'SELL', 1.1000, 1.1050, 1.0950, 0.02, 'limit');
  perform pg_temp.set_price('EURUSD', 1.0999);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-03a', s.status = 'PENDING' and (v_r->>'activated')::int = 0,
    format('harga 1,0999 < entry 1,1000 (limit SELL): status=%s', s.status));
  perform pg_temp.set_price('EURUSD', 1.1000);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-03b', s.status = 'AKTIF' and (v_r->>'activated')::int = 1,
    format('harga 1,1000 = entry (limit SELL): status=%s', s.status));

  -- R35-SET-04: SELL stop — harga 1,1001 (di atas entry) TIDAK aktif;
  -- harga 1,1000 AKTIF.
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'SELL', 1.1000, 1.1050, 1.0950, 0.02, 'stop');
  perform pg_temp.set_price('EURUSD', 1.1001);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-04a', s.status = 'PENDING' and (v_r->>'activated')::int = 0,
    format('harga 1,1001 > entry 1,1000 (stop SELL): status=%s', s.status));
  perform pg_temp.set_price('EURUSD', 1.1000);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-04b', s.status = 'AKTIF' and (v_r->>'activated')::int = 1,
    format('harga 1,1000 = entry (stop SELL): status=%s', s.status));

  -- R35-SET-05: BUY stop SATU PUTARAN via gap — harga lompat ke 1,1060
  -- (>= entry DAN >= TP) -> WIN, tutup di TP 1,1050, +$10/+1R, holding 0.
  -- (Untuk limit ini mustahil: satu harga tidak bisa <= entry DAN >= TP.)
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'stop');
  perform pg_temp.set_price('EURUSD', 1.1060);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  select * into p from public.trader_progress where trader_id = v_t3;
  perform pg_temp.check('R35-SET-05', s.status = 'WIN' and s.close_price = 1.1050
    and s.profit_usd = 10.00 and s.r_value = 1.0 and s.holding_minutes = 0
    and s.activated_at is not null and s.closed_at is not null
    and (v_r->>'wins')::int = 1,
    format('status=%s close=%s profit=%s R=%s hold=%s wins=%s', s.status, s.close_price, s.profit_usd, s.r_value, s.holding_minutes, v_r->>'wins'));

  -- R35-SET-06: BUY limit SATU PUTARAN via gap — harga jatuh ke 1,0940
  -- (<= entry DAN <= SL) -> LOSS, tutup di SL 1,0950, -$10/-1R, holding 0.
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02, 'limit');
  perform pg_temp.set_price('EURUSD', 1.0940);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-06', s.status = 'LOSS' and s.close_price = 1.0950
    and s.profit_usd = -10.00 and s.r_value = -1.0 and s.holding_minutes = 0
    and (v_r->>'losses')::int = 1,
    format('status=%s close=%s profit=%s R=%s losses=%s', s.status, s.close_price, s.profit_usd, s.r_value, v_r->>'losses'));

  -- R35-SET-07: SELL stop SATU PUTARAN via gap — harga jatuh ke 1,0940
  -- (<= entry DAN <= TP) -> WIN, tutup di TP 1,0950, +$10/+1R.
  perform pg_temp.clean_open();
  v_sig := pg_temp.mk_pending(v_t3, 'EURUSD', 'SELL', 1.1000, 1.1050, 1.0950, 0.02, 'stop');
  perform pg_temp.set_price('EURUSD', 1.0940);
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-07', s.status = 'WIN' and s.close_price = 1.0950
    and s.profit_usd = 10.00 and s.r_value = 1.0
    and (v_r->>'wins')::int = 1,
    format('status=%s close=%s profit=%s R=%s', s.status, s.close_price, s.profit_usd, s.r_value));

  -- R35-SET-08: sinyal lama (insert tanpa entry_type) -> default 'limit'.
  perform pg_temp.clean_open();
  insert into public.signals
    (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size,
     status, created_at, expires_at, version)
  values
    (v_t3, 'EURUSD', 'BUY', 1.1000, 1.0950, 1.1050, 0.02,
     'PENDING', now(), now() + interval '3 days', 1)
  returning id into v_sig;
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('R35-SET-08', s.entry_type = 'limit',
    format('insert tanpa entry_type -> %s (grandfather sinyal lama)', s.entry_type));
  delete from public.signals where id = v_sig;
exception when others then
  perform pg_temp.check('R35-SET', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- RINGKASAN
-- ---------------------------------------------------------------------------
select test, status, detail from test_results order by test;
select (select count(*) from test_results where status = 'PASS') as pass,
       (select count(*) from test_results where status = 'FAIL') as fail,
       (select count(*) from test_results) as total;
