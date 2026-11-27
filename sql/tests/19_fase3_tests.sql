-- ============================================================================
-- OLE Signals — 19_fase3_tests.sql
-- Tes verifikasi Fase 3 (settlement + recalc level) terhadap database live.
-- Jalankan di Supabase SQL Editor (project ole-signals) SETELAH 18.
-- Pola mengikuti 04_verify_tests.sql: user uji dibuat di auth.users,
-- hasil dicatat ke tabel temp test_results, satu tes gagal TIDAK
-- menghentikan tes lain. Bersihkan dengan blok CLEANUP di akhir file
-- (atau jalankan ulang file ini — SETUP menghapus sisa run sebelumnya).
--
-- Yang diuji (F3-01..F3-13):
--   F3-01 aktivasi lalu WIN (dua putaran), profit/R/pips/holding benar
--   F3-02 level naik (AND 3 syarat) setelah 5 trade
--   F3-03 level turun (AND 2 syarat) setelah 5 kekalahan
--   F3-04 anti-tembak: satu trade +5R TIDAK menaikkan level (trade < 5)
--   F3-05 PENDING kedaluwarsa -> EXPIRED, tidak pernah aktif
--   F3-06 harga basi (fetched_at > 30 menit) tidak memproses sinyal
--   F3-07 harga konversi hilang -> close dilewati, dicoba lagi nanti
--   F3-08 sinyal duplicate_flagged ditutup tapi TIDAK dihitung ke level
--   F3-09 notifikasi TP/SL ke trader + penyalin; salinan jadi 'closed'
--   F3-10 idempotensi: putaran kedua tanpa perubahan = 0/0/0
--   F3-11 oracle data demo: replay Alpha/Beta/Gamma (saldo + DD + level)
--   F3-12 SELL: aktivasi + LOSS satu putaran (arah berlawanan)
--   F3-13 gap-down: PENDING BUY langsung LOSS satu putaran (tembus SL)
--
-- CATATAN (temuan saat pengujian lokal 2026-11-26, scratch Postgres):
--  * SEMANTIK SENTUHAN (keputusan D, diputuskan 2026-11-26): entry adalah
--    level LIMIT — BUY aktif saat harga <= entry, SELL saat harga >=
--    entry (sama seperti aturan edit AC-EDIT-07 migrasi 14). Akibatnya
--    satu harga TIDAK BISA sekaligus menyentuh entry dan TP: WIN selalu
--    butuh minimal dua putaran. Satu-satunya penutupan satu putaran
--    adalah LOSS saat harga melompat menembus entry DAN SL sekaligus
--    (BUY gap-down / SELL gap-up) — diuji F3-13; F3-12 menguji varian
--    SELL-nya (aktivasi + LOSS satu putaran di harga SL).
--  * Replay Gamma memberi Level 2, BUKAN Level 3 yang tersimpan di baris
--    demo (sql/10). Itu BENAR: baris demo diisi manual (ilustratif) dan
--    recalc bersifat inkremental — ia menghormati state tersimpan, bukan
--    menulis ulang lewat replay. Tes ini menegaskan level replay = 2.
--  * Max DD Alpha versi stats.js = 0,9615% (strict >), sedangkan baris
--    demo menulis 0,95% — selisih 0,01 poin dari pembulatan penulis demo.
--    recalc mengikuti stats.js (yang tampil di panel) — tes menegaskan
--    0,9615. Tampilan membulatkan ke 1 desimal ("1,0%") jadi sama.
--  * JANGAN jalankan file ini bila ada sinyal PENDING/AKTIF milik trader
--    sungguhan yang harganya sedang tersentuh — settle_signals() memproses
--    SEMUA sinyal terbuka, bukan hanya milik user uji. Di live saat ini
--    hanya ada sinyal tes + demo; demo Gamma punya 1 AKTIF + 1 PENDING
--    yang HARUS dibiarkan: sebelum menjalankan, pastikan harga live TIDAK
--    menyentuh entry/TP/SL sinyal demo (XAUUSD AKTIF 4060/4050/4080,
--    GBPUSD PENDING 1.2750/1.2730/1.2790) — atau jalankan saat pasar tutup.
-- ============================================================================

-- (Tidak butuh pgcrypto: kata sandi user uji diisi dummy — tes ini tidak
-- pernah login sebagai user uji, fungsinya dipanggil langsung sebagai
-- postgres seperti di SQL Editor. File 04 memakai crypt(); di sini dummy
-- supaya file tetap jalan di Postgres mana pun.)
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

-- ---------------------------------------------------------------------------
-- SETUP: user uji F3 (UUID tetap supaya rerun membersihkan dirinya sendiri)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    'a0000000-0000-0000-0000-000000000001', -- A: aktivasi lalu WIN
    'a0000000-0000-0000-0000-000000000002', -- C: level naik
    'a0000000-0000-0000-0000-000000000003', -- D: level turun
    'a0000000-0000-0000-0000-000000000004', -- E: anti-tembak
    'a0000000-0000-0000-0000-000000000005', -- F: kedaluwarsa
    'a0000000-0000-0000-0000-000000000006', -- G: harga basi
    'a0000000-0000-0000-0000-000000000007', -- H: tanpa konversi
    'a0000000-0000-0000-0000-000000000008', -- I: duplikat
    'a0000000-0000-0000-0000-000000000009', -- J: notifikasi (trader)
    'a0000000-0000-0000-0000-00000000000a', -- K: penyalin
    'a0000000-0000-0000-0000-00000000000b', -- L: replay Alpha
    'a0000000-0000-0000-0000-00000000000c', -- M: replay Beta
    'a0000000-0000-0000-0000-00000000000d', -- N: replay Gamma
    'a0000000-0000-0000-0000-00000000000e', -- O: SELL loss
    'a0000000-0000-0000-0000-000000000012'  -- P: gap-down satu putaran
  ];
  v_id uuid;
begin
  delete from public.audit_log where actor_id = any(v_ids);
  delete from public.settlement_runs where run_at >= now() - interval '1 hour';
  delete from public.prices;
  delete from auth.users where id = any(v_ids);

  foreach v_id in array v_ids loop
    insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
    values (v_id, '00000000-0000-0000-0000-000000000000', 'f3-' || substr(v_id::text, 33, 4) || '@ole-signals.local', 'dummy-hash-tidak-untuk-login', now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now());
    insert into public.profiles (id, username, display_name)
    values (v_id, 'f3_' || substr(v_id::text, 33, 4), 'F3 ' || substr(v_id::text, 33, 4))
    on conflict (id) do update set username = excluded.username;
    insert into public.traders (profile_id, username, trader_display_name)
    values (v_id, 'f3_' || substr(v_id::text, 33, 4), 'F3 ' || substr(v_id::text, 33, 4))
    on conflict (profile_id) do update set username = excluded.username;
  end loop;
  perform pg_temp.check('SETUP', true, '15 user uji F3 + profil + identitas trader dibuat');
exception when others then
  perform pg_temp.check('SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- Pembantu: sinyal PENDING sekali-pakai (langsung insert — create_signal
-- tidak dipakai di sini karena tes ini menguji settle, bukan create).
create or replace function pg_temp.mk_pending(
  p_trader uuid, p_pair text, p_dir text,
  p_entry numeric, p_sl numeric, p_tp numeric, p_lot numeric,
  p_expires timestamptz default now() + interval '3 days'
) returns uuid
language plpgsql
as $func$
declare
  v_id uuid;
begin
  insert into public.signals
    (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size,
     status, created_at, expires_at, version)
  values
    (p_trader, p_pair, p_dir, p_entry, p_sl, p_tp, p_lot,
     'PENDING', now(), p_expires, 1)
  returning id into v_id;
  return v_id;
end;
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
-- F3-01: aktivasi lalu WIN dalam DUA putaran (XAUUSD BUY 4000/3990/4020,
-- lot 0.10). Putaran 1 harga 4000 (entry) -> AKTIF; putaran 2 harga 4025
-- -> WIN: profit +$200, +200 pips, +2R, holding 0, saldo $10.200.
-- (Satu harga tidak bisa sekaligus <= entry DAN >= TP, jadi WIN selalu
-- butuh minimal dua putaran — lihat catatan F3-13 untuk kasus satu
-- putaran, yang selalu berakhir LOSS di sisi SL.)
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := 'a0000000-0000-0000-0000-000000000001';
  v_sig uuid;
  v_r1 jsonb;
  v_r2 jsonb;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
  v_notif int;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  v_sig := pg_temp.mk_pending(v_a, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10);
  perform pg_temp.set_price('XAUUSD', 4000);
  v_r1 := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  perform pg_temp.check('F3-01a', s.status = 'AKTIF'
    and s.activated_at is not null and (v_r1->>'activated')::int = 1
    and (v_r1->>'wins')::int = 0,
    format('status=%s activated=%s wins=%s', s.status, v_r1->>'activated', v_r1->>'wins'));
  perform pg_temp.set_price('XAUUSD', 4025);
  v_r2 := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  select * into p from public.trader_progress where trader_id = v_a;
  select count(*) into v_notif from public.notifications
  where user_id = v_a and type = 'tp_sl' and signal_id = v_sig;
  perform pg_temp.check('F3-01b', s.status = 'WIN'
    and s.close_price = 4020 and s.profit_usd = 200.00 and s.profit_pips = 200
    and s.r_value = 2.0 and s.holding_minutes = 0
    and s.activated_at is not null and s.closed_at is not null
    and p.balance_usd = 10200.00 and p.level = 1 and p.r_since_level = 2.0
    and p.trades_since_level = 1 and p.peak_balance_usd = 10200.00
    and p.max_drawdown_usd = 0 and v_notif = 1
    and (v_r2->>'wins')::int = 1,
    format('status=%s close=%s profit=%s pips=%s R=%s hold=%s saldo=%s L%s R%s n%s notif=%s ringkasan=%s',
      s.status, s.close_price, s.profit_usd, s.profit_pips, s.r_value, s.holding_minutes,
      p.balance_usd, p.level, p.r_since_level, p.trades_since_level, v_notif, v_r2::text));
exception when others then
  perform pg_temp.check('F3-01', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-02: level NAIK — 5 WIN (RR 1:2, +2R tiap trade) -> saldo $11.800,
-- +10R, 5 trade -> L2, R/n direset 0, ref $10.500.
-- (EURUSD/GBPUSD/AUDUSD/NZDUSD lot 1.00 = +$400; XAUUSD lot 0.10 = +$200.)
-- ---------------------------------------------------------------------------
do $$
declare
  v_c uuid := 'a0000000-0000-0000-0000-000000000002';
  v_r1 jsonb;
  v_r2 jsonb;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  perform pg_temp.mk_pending(v_c, 'EURUSD', 'BUY', 1.1000, 1.0980, 1.1040, 1.00);
  perform pg_temp.mk_pending(v_c, 'GBPUSD', 'BUY', 1.3000, 1.2980, 1.3040, 1.00);
  perform pg_temp.mk_pending(v_c, 'AUDUSD', 'BUY', 0.6600, 0.6580, 0.6640, 1.00);
  perform pg_temp.mk_pending(v_c, 'NZDUSD', 'BUY', 0.5500, 0.5480, 0.5540, 1.00);
  perform pg_temp.mk_pending(v_c, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10);
  -- Putaran 1: harga di entry -> 5 aktivasi.
  perform pg_temp.set_price('EURUSD', 1.1000);
  perform pg_temp.set_price('GBPUSD', 1.3000);
  perform pg_temp.set_price('AUDUSD', 0.6600);
  perform pg_temp.set_price('NZDUSD', 0.5500);
  perform pg_temp.set_price('XAUUSD', 4000);
  v_r1 := public.settle_signals();
  -- Putaran 2: harga di TP -> 5 WIN.
  perform pg_temp.set_price('EURUSD', 1.1040);
  perform pg_temp.set_price('GBPUSD', 1.3040);
  perform pg_temp.set_price('AUDUSD', 0.6640);
  perform pg_temp.set_price('NZDUSD', 0.5540);
  perform pg_temp.set_price('XAUUSD', 4020);
  v_r2 := public.settle_signals();
  select * into p from public.trader_progress where trader_id = v_c;
  perform pg_temp.check('F3-02', p.level = 2 and p.balance_usd = 11800.00
    and p.level_ref_balance = 10500.00 and p.r_since_level = 0
    and p.trades_since_level = 0 and (v_r1->>'activated')::int = 5
    and (v_r2->>'wins')::int = 5,
    format('level=%s saldo=%s ref=%s R=%s n=%s activated=%s wins=%s',
      p.level, p.balance_usd, p.level_ref_balance, p.r_since_level, p.trades_since_level, v_r1->>'activated', v_r2->>'wins'));
exception when others then
  perform pg_temp.check('F3-02', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-03: level TURUN — trader D sudah L3 lewat 6 WIN lama (+$200 tiap
-- trade, R-nya sudah dikonsumsi naik level: r_since 0, n 0, saldo $11.200,
-- ref $11.025, peak $11.200). Lalu 5 LOSS XAUUSD lot 0.20 (-$200 tiap
-- trade) -> saldo $10.200 (<= 11025 x 0,95 = 10473,75), R -5 -> L2,
-- ref $10.500, max DD $1.000 (8,9286%).
-- ---------------------------------------------------------------------------
do $$
declare
  v_d uuid := 'a0000000-0000-0000-0000-000000000003';
  v_r jsonb;
  p public.trader_progress%rowtype;
  i int;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  -- 6 WIN lama (+$200 tiap trade) — riwayat yang membuat saldo $11.200.
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, status, created_at, activated_at, closed_at, close_price, profit_usd, profit_pips, r_value, holding_minutes, version)
  values
    (v_d, 'XAUUSD', 'BUY', 3990, 3980, 4010, 0.10, 'WIN', now() - interval '19 days', now() - interval '19 days', now() - interval '19 days' + interval '90 minutes', 4010, 200.00, 200, 2.0, 90, 1),
    (v_d, 'EURUSD', 'BUY', 1.0900, 1.0880, 1.0940, 0.50, 'WIN', now() - interval '17 days', now() - interval '17 days', now() - interval '17 days' + interval '120 minutes', 1.0940, 200.00, 40, 2.0, 120, 1),
    (v_d, 'GBPUSD', 'BUY', 1.2680, 1.2660, 1.2720, 0.50, 'WIN', now() - interval '15 days', now() - interval '15 days', now() - interval '15 days' + interval '150 minutes', 1.2720, 200.00, 40, 2.0, 150, 1),
    (v_d, 'AUDUSD', 'BUY', 0.6600, 0.6580, 0.6640, 0.50, 'WIN', now() - interval '13 days', now() - interval '13 days', now() - interval '13 days' + interval '120 minutes', 0.6640, 200.00, 40, 2.0, 120, 1),
    (v_d, 'EURUSD', 'SELL', 1.0920, 1.0940, 1.0880, 0.50, 'WIN', now() - interval '11 days', now() - interval '11 days', now() - interval '11 days' + interval '90 minutes', 1.0880, 200.00, 40, 2.0, 90, 1),
    (v_d, 'XAUUSD', 'BUY', 4040, 4030, 4060, 0.10, 'WIN', now() - interval '9 days', now() - interval '9 days', now() - interval '9 days' + interval '90 minutes', 4060, 200.00, 200, 2.0, 90, 1);
  update public.trader_progress set level = 3, balance_usd = 11200.00,
    level_ref_balance = 11025.00, r_since_level = 0, trades_since_level = 0,
    peak_balance_usd = 11200.00, max_drawdown_usd = 0, max_drawdown_pct = 0
  where trader_id = v_d;
  for i in 1..5 loop
    perform pg_temp.mk_pending(v_d, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.20);
  end loop;
  -- Harga menyentuh SL (3990) — tapi AKTIF dulu butuh harga <= entry:
  -- harga 3990 <= 4000 (aktif) dan <= 3990 (SL) -> tutup LOSS satu putaran.
  perform pg_temp.set_price('XAUUSD', 3990);
  v_r := public.settle_signals();
  select * into p from public.trader_progress where trader_id = v_d;
  perform pg_temp.check('F3-03', p.level = 2 and p.balance_usd = 10200.00
    and p.level_ref_balance = 10500.00 and p.r_since_level = 0
    and p.trades_since_level = 0 and p.max_drawdown_usd = 1000.00
    and p.max_drawdown_pct = 8.9286 and (v_r->>'losses')::int = 5,
    format('level=%s saldo=%s ref=%s R=%s n=%s DD=%s (%s%%) losses=%s',
      p.level, p.balance_usd, p.level_ref_balance, p.r_since_level,
      p.trades_since_level, p.max_drawdown_usd, p.max_drawdown_pct, v_r->>'losses'));
exception when others then
  perform pg_temp.check('F3-03', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-04: anti-tembak — satu WIN RR 1:5 (+5R, +$1.000) -> saldo $11.000,
-- R +5, TAPI trade 1 < 5 -> tetap L1.
-- ---------------------------------------------------------------------------
do $$
declare
  v_e uuid := 'a0000000-0000-0000-0000-000000000004';
  v_r jsonb;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  perform pg_temp.mk_pending(v_e, 'EURUSD', 'BUY', 1.1000, 1.0980, 1.1100, 1.00);
  perform pg_temp.set_price('EURUSD', 1.1000); -- aktifkan dulu
  v_r := public.settle_signals();
  perform pg_temp.set_price('EURUSD', 1.1100); -- sentuh TP (RR 1:5)
  v_r := public.settle_signals();
  select * into p from public.trader_progress where trader_id = v_e;
  perform pg_temp.check('F3-04', p.level = 1 and p.balance_usd = 11000.00
    and p.r_since_level = 5.0 and p.trades_since_level = 1,
    format('level=%s saldo=%s R=%s n=%s', p.level, p.balance_usd, p.r_since_level, p.trades_since_level));
exception when others then
  perform pg_temp.check('F3-04', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-05: kedaluwarsa — PENDING expires_at lewat + harga menyentuh entry
-- -> EXPIRED (bukan AKTIF), saldo tetap $10.000.
-- ---------------------------------------------------------------------------
do $$
declare
  v_f uuid := 'a0000000-0000-0000-0000-000000000005';
  v_r jsonb;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  perform pg_temp.mk_pending(v_f, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10, now() - interval '1 hour');
  perform pg_temp.set_price('XAUUSD', 4000);
  v_r := public.settle_signals();
  select * into s from public.signals where trader_id = v_f order by created_at desc limit 1;
  select * into p from public.trader_progress where trader_id = v_f;
  perform pg_temp.check('F3-05', s.status = 'EXPIRED' and (v_r->>'expired')::int = 1
    and (v_r->>'activated')::int = 0 and p.balance_usd = 10000.00,
    format('status=%s expired=%s activated=%s saldo=%s', s.status, v_r->>'expired', v_r->>'activated', p.balance_usd));
exception when others then
  perform pg_temp.check('F3-05', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-06: harga basi — XAUUSD fetched_at 2 jam lalu, harga menyentuh entry
-- -> tetap PENDING; segarkan harga -> AKTIF.
-- ---------------------------------------------------------------------------
do $$
declare
  v_g uuid := 'a0000000-0000-0000-0000-000000000006';
  v_r jsonb;
  s public.signals%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  perform pg_temp.mk_pending(v_g, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10);
  perform pg_temp.set_price('XAUUSD', 4000, interval '2 hours');
  v_r := public.settle_signals();
  select * into s from public.signals where trader_id = v_g order by created_at desc limit 1;
  perform pg_temp.check('F3-06a', s.status = 'PENDING' and (v_r->>'activated')::int = 0
    and (v_r->>'stale_pairs')::jsonb @> '["XAUUSD"]'::jsonb,
    format('status=%s activated=%s stale=%s', s.status, v_r->>'activated', v_r->>'stale_pairs'));
  perform pg_temp.set_price('XAUUSD', 4000);
  v_r := public.settle_signals();
  select * into s from public.signals where trader_id = v_g order by created_at desc limit 1;
  perform pg_temp.check('F3-06b', s.status = 'AKTIF' and (v_r->>'activated')::int = 1,
    format('status=%s activated=%s', s.status, v_r->>'activated'));
  -- Bersihkan: batalkan sinyal G supaya tidak ikut tertutup di skenario
  -- berikut (harga XAUUSD 4025 di F3-08/F3-09 akan menyentuh TP-nya).
  update public.signals set status = 'CANCELLED', closed_at = now()
  where trader_id = v_g and status = 'AKTIF';
exception when others then
  perform pg_temp.check('F3-06a', false, 'exception: ' || sqlerrm);
  perform pg_temp.check('F3-06b', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-07: tanpa harga konversi — AKTIF EURGBP (butuh GBPUSD untuk
-- quote_to_usd), harga menyentuh TP, tapi TIDAK ADA baris GBPUSD ->
-- tetap AKTIF + skipped 1; tambah GBPUSD -> WIN +$524,00.
-- (EURGBP BUY 0.8500/0.8480/0.8540 lot 1.00: 0.0040 x 100000 x 1.31.)
-- ---------------------------------------------------------------------------
do $$
declare
  v_h uuid := 'a0000000-0000-0000-0000-000000000007';
  v_r jsonb;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  perform pg_temp.mk_pending(v_h, 'EURGBP', 'BUY', 0.8500, 0.8480, 0.8540, 1.00);
  perform pg_temp.set_price('EURGBP', 0.8500); -- aktifkan dulu
  v_r := public.settle_signals();
  perform pg_temp.set_price('EURGBP', 0.8540); -- sentuh TP, tanpa GBPUSD
  v_r := public.settle_signals();
  select * into s from public.signals where trader_id = v_h order by created_at desc limit 1;
  perform pg_temp.check('F3-07a', s.status = 'AKTIF' and (v_r->>'skipped_no_conversion')::int = 1,
    format('status=%s skipped=%s', s.status, v_r->>'skipped_no_conversion'));
  perform pg_temp.set_price('GBPUSD', 1.3100);
  v_r := public.settle_signals();
  select * into s from public.signals where trader_id = v_h order by created_at desc limit 1;
  select * into p from public.trader_progress where trader_id = v_h;
  perform pg_temp.check('F3-07b', s.status = 'WIN' and s.profit_usd = 524.00
    and s.r_value = 2.0 and p.balance_usd = 10524.00,
    format('status=%s profit=%s R=%s saldo=%s', s.status, s.profit_usd, s.r_value, p.balance_usd));
exception when others then
  perform pg_temp.check('F3-07a', false, 'exception: ' || sqlerrm);
  perform pg_temp.check('F3-07b', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-08: duplikat — sinyal duplicate_flagged ditutup WIN (+$200) tapi
-- saldo tetap $10.000 dan R tetap 0 (tidak dihitung ke level).
-- ---------------------------------------------------------------------------
do $$
declare
  v_i uuid := 'a0000000-0000-0000-0000-000000000008';
  v_r jsonb;
  v_sig uuid;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  v_sig := pg_temp.mk_pending(v_i, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10);
  update public.signals set duplicate_flagged = true where id = v_sig;
  perform pg_temp.set_price('XAUUSD', 4000); -- aktifkan dulu
  v_r := public.settle_signals();
  perform pg_temp.set_price('XAUUSD', 4025); -- sentuh TP -> WIN
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  select * into p from public.trader_progress where trader_id = v_i;
  perform pg_temp.check('F3-08', s.status = 'WIN' and s.profit_usd = 200.00
    and p.balance_usd = 10000.00 and p.r_since_level = 0 and p.trades_since_level = 0,
    format('status=%s profit=%s saldo=%s R=%s n=%s', s.status, s.profit_usd, p.balance_usd, p.r_since_level, p.trades_since_level));
exception when others then
  perform pg_temp.check('F3-08', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-09: notifikasi + salinan — J posting XAUUSD BUY, K menyalin; harga
-- sentuh TP -> J dan K masing-masing 1 notifikasi 'tp_sl'; salinan 'closed'.
-- ---------------------------------------------------------------------------
do $$
declare
  v_j uuid := 'a0000000-0000-0000-0000-000000000009';
  v_k uuid := 'a0000000-0000-0000-0000-00000000000a';
  v_r jsonb;
  v_sig uuid;
  v_nj int; v_nk int; v_copy text;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  v_sig := pg_temp.mk_pending(v_j, 'XAUUSD', 'BUY', 4000, 3990, 4020, 0.10);
  insert into public.copies (follower_id, signal_id, lot_size, status)
  values (v_k, v_sig, 0.10, 'copied');
  perform pg_temp.set_price('XAUUSD', 4000); -- aktifkan dulu
  v_r := public.settle_signals();
  perform pg_temp.set_price('XAUUSD', 4025); -- sentuh TP -> WIN
  v_r := public.settle_signals();
  select count(*) into v_nj from public.notifications
  where user_id = v_j and type = 'tp_sl' and signal_id = v_sig;
  select count(*) into v_nk from public.notifications
  where user_id = v_k and type = 'tp_sl' and signal_id = v_sig;
  select status into v_copy from public.copies where follower_id = v_k and signal_id = v_sig;
  perform pg_temp.check('F3-09', v_nj = 1 and v_nk = 1 and v_copy = 'closed',
    format('notif_trader=%s notif_penyalin=%s salinan=%s', v_nj, v_nk, v_copy));
exception when others then
  perform pg_temp.check('F3-09', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-10: idempotensi — putaran kedua langsung setelah F3-09 (tidak ada
-- sinyal terbuka yang tersentuh) -> 0/0/0 dan tidak ada notifikasi baru.
-- ---------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
  v_n int;
begin
  select count(*) into v_n from public.notifications where type = 'tp_sl';
  v_r := public.settle_signals();
  perform pg_temp.check('F3-10', (v_r->>'activated')::int = 0 and (v_r->>'wins')::int = 0
    and (v_r->>'losses')::int = 0 and (v_r->>'expired')::int = 0
    and (select count(*) from public.notifications where type = 'tp_sl') = v_n,
    format('ringkasan=%s notif_sebelum=%s', v_r::text, v_n));
exception when others then
  perform pg_temp.check('F3-10', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-11: oracle data demo — replay sinyal tertutup Alpha/Beta/Gamma
-- (sql/10) lewat recalc satu per satu, urutan closed_at.
-- Alpha: saldo $10.600, L2, DD $100 / 0,9615%.
-- Beta:  saldo $10.150, L1, DD $50 / 0,4902%.
-- Gamma: saldo $11.200, DD $100 / 0,9434%, level replay = 2 (lihat catatan
-- di header file — baris demo L3 adalah nilai ilustratif manual).
-- ---------------------------------------------------------------------------
do $$
declare
  v_l uuid := 'a0000000-0000-0000-0000-00000000000b';
  v_m uuid := 'a0000000-0000-0000-0000-00000000000c';
  v_n uuid := 'a0000000-0000-0000-0000-00000000000d';
  p public.trader_progress%rowtype;
  s record;
begin
  -- Alpha: 6 tertutup (+200,+200,-100,+200,-100,+200).
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, status, created_at, activated_at, closed_at, close_price, profit_usd, profit_pips, r_value, holding_minutes, version)
  values
    (v_l, 'XAUUSD', 'BUY',  4000, 3990, 4020, 0.10, 'WIN',  now() - interval '18 days', now() - interval '18 days', now() - interval '18 days' + interval '60 minutes',  4020,  200.00,  200,  2.0,  60, 1),
    (v_l, 'EURUSD', 'BUY',  1.0850, 1.0830, 1.0890, 0.50, 'WIN',  now() - interval '16 days', now() - interval '16 days', now() - interval '16 days' + interval '120 minutes', 1.0890,  200.00,   40,  2.0, 120, 1),
    (v_l, 'XAUUSD', 'SELL', 4050, 4060, 4030, 0.10, 'LOSS', now() - interval '14 days', now() - interval '14 days', now() - interval '14 days' + interval '30 minutes',  4060, -100.00, -100, -1.0,  30, 1),
    (v_l, 'GBPUSD', 'BUY',  1.2700, 1.2680, 1.2740, 0.50, 'WIN',  now() - interval '11 days', now() - interval '11 days', now() - interval '11 days' + interval '180 minutes', 1.2740,  200.00,   40,  2.0, 180, 1),
    (v_l, 'XAUUSD', 'BUY',  3980, 3970, 4000, 0.10, 'LOSS', now() - interval '8 days',  now() - interval '8 days',  now() - interval '8 days' + interval '45 minutes',  3970, -100.00, -100, -1.0,  45, 1),
    (v_l, 'EURUSD', 'SELL', 1.0920, 1.0940, 1.0880, 0.50, 'WIN',  now() - interval '5 days',  now() - interval '5 days',  now() - interval '5 days' + interval '90 minutes',  1.0880,  200.00,   40,  2.0,  90, 1);
  for s in select id from public.signals where trader_id = v_l order by closed_at loop
    perform public.recalc_trader_progress(v_l, s.id);
  end loop;
  select * into p from public.trader_progress where trader_id = v_l;
  perform pg_temp.check('F3-11a', p.level = 2 and p.balance_usd = 10600.00
    and p.max_drawdown_usd = 100.00 and p.max_drawdown_pct = 0.9615,
    format('Alpha level=%s saldo=%s DD=%s (%s%%)', p.level, p.balance_usd, p.max_drawdown_usd, p.max_drawdown_pct));

  -- Beta: 3 tertutup (+100,+100,-50).
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, status, created_at, activated_at, closed_at, close_price, profit_usd, profit_pips, r_value, holding_minutes, version)
  values
    (v_m, 'XAUUSD', 'BUY',  4010, 4000, 4030, 0.05, 'WIN',  now() - interval '15 days', now() - interval '15 days', now() - interval '15 days' + interval '120 minutes', 4030,  100.00,  200,  2.0, 120, 1),
    (v_m, 'EURUSD', 'BUY',  1.0860, 1.0840, 1.0900, 0.25, 'WIN',  now() - interval '10 days', now() - interval '10 days', now() - interval '10 days' + interval '150 minutes', 1.0900,  100.00,   40,  2.0, 150, 1),
    (v_m, 'GBPUSD', 'SELL', 1.2750, 1.2770, 1.2710, 0.25, 'LOSS', now() - interval '6 days',  now() - interval '6 days',  now() - interval '6 days' + interval '60 minutes',  1.2770,  -50.00,  -20, -1.0,  60, 1);
  for s in select id from public.signals where trader_id = v_m order by closed_at loop
    perform public.recalc_trader_progress(v_m, s.id);
  end loop;
  select * into p from public.trader_progress where trader_id = v_m;
  perform pg_temp.check('F3-11b', p.level = 1 and p.balance_usd = 10150.00
    and p.max_drawdown_usd = 50.00 and p.max_drawdown_pct = 0.4902,
    format('Beta level=%s saldo=%s DD=%s (%s%%)', p.level, p.balance_usd, p.max_drawdown_usd, p.max_drawdown_pct));

  -- Gamma: 8 tertutup (+200 x3, -100, +200 x3, +100) = +$1.200, +13R.
  insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, status, created_at, activated_at, closed_at, close_price, profit_usd, profit_pips, r_value, holding_minutes, version)
  values
    (v_n, 'XAUUSD', 'BUY',  3990, 3980, 4010, 0.10, 'WIN',  now() - interval '19 days', now() - interval '19 days', now() - interval '19 days' + interval '90 minutes',  4010,  200.00,  200,  2.0,  90, 1),
    (v_n, 'EURUSD', 'SELL', 1.0900, 1.0920, 1.0860, 0.50, 'WIN',  now() - interval '17 days', now() - interval '17 days', now() - interval '17 days' + interval '120 minutes', 1.0860,  200.00,   40,  2.0, 120, 1),
    (v_n, 'GBPUSD', 'BUY',  1.2680, 1.2660, 1.2720, 0.50, 'WIN',  now() - interval '15 days', now() - interval '15 days', now() - interval '15 days' + interval '150 minutes', 1.2720,  200.00,   40,  2.0, 150, 1),
    (v_n, 'XAUUSD', 'SELL', 4020, 4030, 4000, 0.10, 'LOSS', now() - interval '13 days', now() - interval '13 days', now() - interval '13 days' + interval '60 minutes',  4030, -100.00, -100, -1.0,  60, 1),
    (v_n, 'AUDUSD', 'BUY',  0.6600, 0.6580, 0.6640, 0.50, 'WIN',  now() - interval '10 days', now() - interval '10 days', now() - interval '10 days' + interval '120 minutes', 0.6640,  200.00,   40,  2.0, 120, 1),
    (v_n, 'EURUSD', 'BUY',  1.0840, 1.0820, 1.0880, 0.50, 'WIN',  now() - interval '7 days',  now() - interval '7 days',  now() - interval '7 days' + interval '180 minutes',  1.0880,  200.00,   40,  2.0, 180, 1),
    (v_n, 'XAUUSD', 'BUY',  4040, 4030, 4060, 0.10, 'WIN',  now() - interval '4 days',  now() - interval '4 days',  now() - interval '4 days' + interval '90 minutes',  4060,  200.00,  200,  2.0,  90, 1),
    (v_n, 'GBPUSD', 'SELL', 1.2720, 1.2740, 1.2680, 0.25, 'WIN',  now() - interval '2 days',  now() - interval '2 days',  now() - interval '2 days' + interval '120 minutes', 1.2680,  100.00,   40,  1.0, 120, 1);
  for s in select id from public.signals where trader_id = v_n order by closed_at loop
    perform public.recalc_trader_progress(v_n, s.id);
  end loop;
  select * into p from public.trader_progress where trader_id = v_n;
  perform pg_temp.check('F3-11c', p.level = 2 and p.balance_usd = 11200.00
    and p.max_drawdown_usd = 100.00 and p.max_drawdown_pct = 0.9434,
    format('Gamma level=%s saldo=%s DD=%s (%s%%)', p.level, p.balance_usd, p.max_drawdown_usd, p.max_drawdown_pct));
exception when others then
  perform pg_temp.check('F3-11a', false, 'exception: ' || sqlerrm);
  perform pg_temp.check('F3-11b', false, 'exception: ' || sqlerrm);
  perform pg_temp.check('F3-11c', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- F3-12: SELL — EURUSD SELL 1.1000/1.1020/1.0960 lot 0.50, harga 1.1020
-- -> aktif (harga >= entry) + LOSS (harga >= SL) satu putaran:
-- profit -$100, -20 pips, -1R, saldo $9.900.
-- ---------------------------------------------------------------------------
do $$
declare
  v_o uuid := 'a0000000-0000-0000-0000-00000000000e';
  v_r jsonb;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  perform pg_temp.mk_pending(v_o, 'EURUSD', 'SELL', 1.1000, 1.1020, 1.0960, 0.50);
  perform pg_temp.set_price('EURUSD', 1.1020);
  v_r := public.settle_signals();
  select * into s from public.signals where trader_id = v_o order by created_at desc limit 1;
  select * into p from public.trader_progress where trader_id = v_o;
  perform pg_temp.check('F3-12', s.status = 'LOSS' and s.close_price = 1.1020
    and s.profit_usd = -100.00 and s.profit_pips = -20 and s.r_value = -1
    and p.balance_usd = 9900.00 and p.level = 1,
    format('status=%s close=%s profit=%s pips=%s R=%s saldo=%s L%s',
      s.status, s.close_price, s.profit_usd, s.profit_pips, s.r_value, p.balance_usd, p.level));
exception when others then
  perform pg_temp.check('F3-12', false, 'exception: ' || sqlerrm);
end $$;

-- F3-13: gap-down: PENDING BUY langsung LOSS dalam SATU putaran
-- (harga jatuh menembus entry DAN SL sekaligus) — satu-satunya bentuk
-- penutupan satu putaran yang mungkin: satu harga tidak bisa sekaligus
-- <= entry DAN >= TP (BUY) atau >= entry DAN <= TP (SELL), jadi
-- aktivasi+penutupan satu putaran SELALU berakhir LOSS di sisi SL.
-- XAUUSD BUY 4000/3990/4050 lot 0.10, harga 3985 -> LOSS -$100, -100
-- pips, -1R, holding 0 (activated_at = closed_at), saldo $9.900, DD $100.
-- ---------------------------------------------------------------------------
do $$
declare
  v_p uuid := 'a0000000-0000-0000-0000-000000000012';
  v_r jsonb;
  v_sig uuid;
  s public.signals%rowtype;
  p public.trader_progress%rowtype;
begin
  delete from public.prices;
  delete from public.signals
  where trader_id in (select id from public.traders where username like 'f3%')
    and status in ('PENDING', 'AKTIF');
  v_sig := pg_temp.mk_pending(v_p, 'XAUUSD', 'BUY', 4000, 3990, 4050, 0.10);
  perform pg_temp.set_price('XAUUSD', 3985); -- di bawah SL: tembus entry + SL
  v_r := public.settle_signals();
  select * into s from public.signals where id = v_sig;
  select * into p from public.trader_progress where trader_id = v_p;
  perform pg_temp.check('F3-13', s.status = 'LOSS' and s.close_price = 3990
    and s.profit_usd = -100.00 and s.profit_pips = -100 and s.r_value = -1
    and s.holding_minutes = 0 and s.activated_at = s.closed_at
    and p.balance_usd = 9900.00 and p.level = 1 and p.r_since_level = -1
    and p.trades_since_level = 1 and p.max_drawdown_usd = 100.00
    and (v_r->>'activated')::int = 1 and (v_r->>'losses')::int = 1,
    format('status=%s close=%s profit=%s pips=%s R=%s hold=%s saldo=%s L%s R%s n%s DD=%s ringkasan=%s',
      s.status, s.close_price, s.profit_usd, s.profit_pips, s.r_value, s.holding_minutes,
      p.balance_usd, p.level, p.r_since_level, p.trades_since_level, p.max_drawdown_usd, v_r::text));
exception when others then
  perform pg_temp.check('F3-13', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- CLEANUP: hapus semua user uji (CASCADE menghapus profil/trader/sinyal/
-- progress/notifikasi/salinan). Audit log dibersihkan manual (tanpa FK).
-- Harga uji + settlement_runs dari tes ini juga dibersihkan.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004',
    'a0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-00000000000a',
    'a0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000c',
    'a0000000-0000-0000-0000-00000000000d','a0000000-0000-0000-0000-00000000000e',
    'a0000000-0000-0000-0000-000000000012'];
begin
  delete from public.audit_log where actor_id = any(v_ids);
  delete from public.settlement_runs where run_at >= now() - interval '1 hour';
  delete from public.prices;
  delete from auth.users where id = any(v_ids);
end $$;

-- Hasil.
select * from test_results order by test;
