-- ============================================================================
-- OLE Signals — 10_demo_traders_insert.sql
-- Trader DEMO (izin user 23 Nov 2026 14:54 WIB): 3 trader contoh berlabel
-- "Demo" untuk memperlihatkan susunan Cari / profil trader / peringkat /
-- feed. BUKAN trader sungguhan, BUKAN 15 seed prototipe (nama & angka
-- prototipe TIDAK dipakai). Semua angka di sini adalah DATA DEMO — hasil
-- trade yang tercatat di sinyal demo konsisten dengan saldo & levelnya
-- (saldo = $10.000 + jumlah profit sinyal tertutup), supaya statistik
-- yang dihitung aplikasi dari sinyal-sinyal ini masuk akal.
--
-- LANGKAH PAKAI (JANGAN jalankan file ini sebelum langkah 1–2):
--   1. Buat 3 akun auth via Supabase Dashboard → Authentication → Users
--      → "Add user", centang Auto Confirm (tanpa email konfirmasi):
--        demo-alpha@ole-signals.demo
--        demo-beta@ole-signals.demo
--        demo-gamma@ole-signals.demo
--      (Kata sandi diisi di dashboard; TIDAK dicatat di file ini. Akun
--      demo tidak perlu dipakai masuk — hanya untuk menampilkan trader.)
--   2. Jalankan 09_demo_traders_migration.sql dulu (kolom traders.is_demo).
--   3. Jalankan file ini di SQL Editor. File mencari UUID akun demo
--      BERDASARKAN EMAIL — tidak perlu menempel UUID manual. Bila ada
--      akun yang belum dibuat, file berhenti dengan galat yang jelas.
--   4. Verifikasi: buka Cari di aplikasi — 3 trader muncul dengan
--      lencana "Demo"; profilnya menampilkan statistik, tabel per pair,
--      dan grafik dari sinyal demo; feed menampilkan sinyal terbukanya.
--   5. Menghapus: jalankan 11_demo_traders_delete.sql (menghapus trader,
--      progress, sinyal, follows/subscriptions/copies/notifikasi terkait,
--      profil, DAN akun auth demo — tanpa menyentuh data lain).
--
-- Isi demo:
--   Demo Alpha (Lv 2, saldo $10.600): 6 trade tertutup (+$600, +6R,
--     WR 66,7%) + 1 PENDING.
--   Demo Beta  (Lv 1, saldo $10.150): 3 trade tertutup (+$150, +3R,
--     WR 66,7%) + 1 PENDING.
--   Demo Gamma (Lv 3, saldo $11.200): 8 trade tertutup (+$1.200, +13R,
--     WR 87,5%) + 1 AKTIF + 1 PENDING.
-- Catatan: r_since_level / trades_since_level diisi nilai tengah level
-- (ilustratif, supaya bilah progres terlihat). Di settlement nyata nilai
-- ini direset tiap kali level berubah (Fase 4) — untuk demo, nilai di
-- bawah ini dipilih agar tampilannya terisi, bukan klaim urutan level-up.
-- ============================================================================

do $$
declare
  v_alpha uuid;
  v_beta uuid;
  v_gamma uuid;
begin
  -- Cari akun demo berdasarkan email (dibuat di dashboard, langkah 1).
  select id into v_alpha from auth.users where email = 'demo-alpha@ole-signals.demo';
  select id into v_beta  from auth.users where email = 'demo-beta@ole-signals.demo';
  select id into v_gamma from auth.users where email = 'demo-gamma@ole-signals.demo';
  if v_alpha is null then
    raise exception 'Akun demo-alpha@ole-signals.demo belum dibuat. Buat dulu via Dashboard → Authentication → Users → Add user (Auto Confirm).';
  end if;
  if v_beta is null then
    raise exception 'Akun demo-beta@ole-signals.demo belum dibuat. Buat dulu via Dashboard → Authentication → Users → Add user (Auto Confirm).';
  end if;
  if v_gamma is null then
    raise exception 'Akun demo-gamma@ole-signals.demo belum dibuat. Buat dulu via Dashboard → Authentication → Users → Add user (Auto Confirm).';
  end if;

  -- Profil (baris sudah dibuat trigger handle_new_user saat akun dibuat):
  -- lengkapi username + nama tampilan demo.
  update public.profiles
     set username = 'demo_alpha', display_name = 'Demo Alpha'
   where id = v_alpha;
  update public.profiles
     set username = 'demo_beta', display_name = 'Demo Beta'
   where id = v_beta;
  update public.profiles
     set username = 'demo_gamma', display_name = 'Demo Gamma'
   where id = v_gamma;

  -- Identitas trader + penanda demo.
  -- Username trader = username follower demo (backfill migrasi 12 menyalin
  -- nilai yang sama; file ini ditulis eksplisit supaya tetap bisa
  -- dijalankan ulang setelah kolom traders.username NOT NULL).
  insert into public.traders (profile_id, username, trader_display_name, trader_avatar_url, subscription_price_usd, is_demo)
  values
    (v_alpha, 'demo_alpha', 'Demo Alpha', null, null, true),
    (v_beta,  'demo_beta',  'Demo Beta',  null, null, true),
    (v_gamma, 'demo_gamma', 'Demo Gamma', null, null, true)
  on conflict (profile_id) do update set
    username = excluded.username,
    trader_display_name = excluded.trader_display_name,
    is_demo = true;

  -- Progress demo (saldo = $10.000 + jumlah profit sinyal tertutup).
  -- Baris progress dibuat otomatis trigger saat identitas dibuat; di sini
  -- di-update ke nilai demo.
  insert into public.trader_progress
    (trader_id, level, balance_usd, level_ref_balance, r_since_level, trades_since_level, peak_balance_usd, max_drawdown_usd, max_drawdown_pct)
  values
    (v_alpha, 2, 10600.00, 10500.00, 2.0, 2, 10600.00, 100.00, 0.95),
    (v_beta,  1, 10150.00, 10000.00, 3.0, 3, 10200.00,  50.00, 0.49),
    (v_gamma, 3, 11200.00, 11025.00, 3.5, 4, 11200.00, 100.00, 0.94)
  on conflict (trader_id) do update set
    level = excluded.level,
    balance_usd = excluded.balance_usd,
    level_ref_balance = excluded.level_ref_balance,
    r_since_level = excluded.r_since_level,
    trades_since_level = excluded.trades_since_level,
    peak_balance_usd = excluded.peak_balance_usd,
    max_drawdown_usd = excluded.max_drawdown_usd,
    max_drawdown_pct = excluded.max_drawdown_pct;

  -- Sinyal demo. Hapus dulu sinyal demo lama (bila file dijalankan ulang)
  -- supaya tidak ganda.
  delete from public.signals where trader_id in (v_alpha, v_beta, v_gamma);

  insert into public.signals
    (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size,
     status, created_at, expires_at, activated_at, closed_at, close_price,
     profit_usd, profit_pips, r_value, holding_minutes, version)
  values
  -- Demo Alpha: 6 tertutup (+$600, +6R) + 1 PENDING.
  (v_alpha, 'XAUUSD', 'BUY',  4000, 3990, 4020, 0.10, 'WIN',  now() - interval '18 days', now() - interval '15 days', now() - interval '18 days', now() - interval '18 days' + interval '60 minutes', 4020,  200.00,  200,  2.0,  60, 1),
  (v_alpha, 'EURUSD', 'BUY',  1.0850, 1.0830, 1.0890, 0.50, 'WIN',  now() - interval '16 days', now() - interval '13 days', now() - interval '16 days', now() - interval '16 days' + interval '120 minutes', 1.0890,  200.00,   40,  2.0, 120, 1),
  (v_alpha, 'XAUUSD', 'SELL', 4050, 4060, 4030, 0.10, 'LOSS', now() - interval '14 days', now() - interval '11 days', now() - interval '14 days', now() - interval '14 days' + interval '30 minutes', 4060, -100.00, -100, -1.0,  30, 1),
  (v_alpha, 'GBPUSD', 'BUY',  1.2700, 1.2680, 1.2740, 0.50, 'WIN',  now() - interval '11 days', now() - interval '8 days',  now() - interval '11 days', now() - interval '11 days' + interval '180 minutes', 1.2740,  200.00,   40,  2.0, 180, 1),
  (v_alpha, 'XAUUSD', 'BUY',  3980, 3970, 4000, 0.10, 'LOSS', now() - interval '8 days',  now() - interval '5 days',  now() - interval '8 days',  now() - interval '8 days' + interval '45 minutes', 3970, -100.00, -100, -1.0,  45, 1),
  (v_alpha, 'EURUSD', 'SELL', 1.0920, 1.0940, 1.0880, 0.50, 'WIN',  now() - interval '5 days',  now() - interval '2 days',  now() - interval '5 days',  now() - interval '5 days' + interval '90 minutes', 1.0880,  200.00,   40,  2.0,  90, 1),
  (v_alpha, 'XAUUSD', 'BUY',  4080, 4070, 4100, 0.05, 'PENDING', now() - interval '1 day', now() + interval '2 days', null, null, null, null, null, null, null, 1),
  -- Demo Beta: 3 tertutup (+$150, +3R) + 1 PENDING.
  (v_beta, 'XAUUSD', 'BUY',  4010, 4000, 4030, 0.05, 'WIN',  now() - interval '15 days', now() - interval '12 days', now() - interval '15 days', now() - interval '15 days' + interval '120 minutes', 4030,  100.00,  200,  2.0, 120, 1),
  (v_beta, 'EURUSD', 'BUY',  1.0860, 1.0840, 1.0900, 0.25, 'WIN',  now() - interval '10 days', now() - interval '7 days',  now() - interval '10 days', now() - interval '10 days' + interval '150 minutes', 1.0900,  100.00,   40,  2.0, 150, 1),
  (v_beta, 'GBPUSD', 'SELL', 1.2750, 1.2770, 1.2710, 0.25, 'LOSS', now() - interval '6 days',  now() - interval '3 days',  now() - interval '6 days',  now() - interval '6 days' + interval '60 minutes', 1.2770,  -50.00,  -20, -1.0,  60, 1),
  (v_beta, 'EURUSD', 'SELL', 1.0950, 1.0970, 1.0910, 0.20, 'PENDING', now() - interval '12 hours', now() + interval '2 days 12 hours', null, null, null, null, null, null, null, 1),
  -- Demo Gamma: 8 tertutup (+$1.200, +13R) + 1 AKTIF + 1 PENDING.
  (v_gamma, 'XAUUSD', 'BUY',  3990, 3980, 4010, 0.10, 'WIN',  now() - interval '19 days', now() - interval '16 days', now() - interval '19 days', now() - interval '19 days' + interval '90 minutes', 4010,  200.00,  200,  2.0,  90, 1),
  (v_gamma, 'EURUSD', 'SELL', 1.0900, 1.0920, 1.0860, 0.50, 'WIN',  now() - interval '17 days', now() - interval '14 days', now() - interval '17 days', now() - interval '17 days' + interval '120 minutes', 1.0860,  200.00,   40,  2.0, 120, 1),
  (v_gamma, 'GBPUSD', 'BUY',  1.2680, 1.2660, 1.2720, 0.50, 'WIN',  now() - interval '15 days', now() - interval '12 days', now() - interval '15 days', now() - interval '15 days' + interval '150 minutes', 1.2720,  200.00,   40,  2.0, 150, 1),
  (v_gamma, 'XAUUSD', 'SELL', 4020, 4030, 4000, 0.10, 'LOSS', now() - interval '13 days', now() - interval '10 days', now() - interval '13 days', now() - interval '13 days' + interval '60 minutes', 4030, -100.00, -100, -1.0,  60, 1),
  (v_gamma, 'AUDUSD', 'BUY',  0.6600, 0.6580, 0.6640, 0.50, 'WIN',  now() - interval '10 days', now() - interval '7 days',  now() - interval '10 days', now() - interval '10 days' + interval '120 minutes', 0.6640,  200.00,   40,  2.0, 120, 1),
  (v_gamma, 'EURUSD', 'BUY',  1.0840, 1.0820, 1.0880, 0.50, 'WIN',  now() - interval '7 days',  now() - interval '4 days',  now() - interval '7 days',  now() - interval '7 days' + interval '180 minutes', 1.0880,  200.00,   40,  2.0, 180, 1),
  (v_gamma, 'XAUUSD', 'BUY',  4040, 4030, 4060, 0.10, 'WIN',  now() - interval '4 days',  now() - interval '1 day',   now() - interval '4 days',  now() - interval '4 days' + interval '90 minutes', 4060,  200.00,  200,  2.0,  90, 1),
  (v_gamma, 'GBPUSD', 'SELL', 1.2720, 1.2740, 1.2680, 0.25, 'WIN',  now() - interval '2 days',  now() + interval '1 day',   now() - interval '2 days',  now() - interval '2 days' + interval '120 minutes', 1.2680,  100.00,   40,  2.0, 120, 1),
  (v_gamma, 'XAUUSD', 'BUY',  4060, 4050, 4080, 0.05, 'AKTIF', now() - interval '2 days',  now() + interval '1 day',   now() - interval '1 day',  null, null, null, null, null, null, 1),
  (v_gamma, 'GBPUSD', 'BUY',  1.2750, 1.2730, 1.2790, 0.20, 'PENDING', now() - interval '6 hours', now() + interval '2 days 18 hours', null, null, null, null, null, null, null, 1);

  raise notice 'Demo traders dibuat: Alpha (Lv2, $10.600), Beta (Lv1, $10.150), Gamma (Lv3, $11.200).';
end $$;

-- ---------------------------------------------------------------------------
-- Verifikasi (baca panel Results): saldo harus = $10.000 + jumlah profit
-- sinyal tertutup, dan jumlah sinyal tertutup/terbuka harus sesuai.
-- ---------------------------------------------------------------------------
select
  t.trader_display_name as trader,
  p.level,
  p.balance_usd as saldo,
  coalesce(sum(s.profit_usd) filter (where s.status in ('WIN','LOSS')), 0) as jumlah_profit_sinyal,
  (10000 + coalesce(sum(s.profit_usd) filter (where s.status in ('WIN','LOSS')), 0)) as saldo_harapan,
  count(*) filter (where s.status in ('WIN','LOSS')) as trade_tertutup,
  count(*) filter (where s.status in ('PENDING','AKTIF')) as sinyal_terbuka
from public.traders t
join public.trader_progress p on p.trader_id = t.profile_id
left join public.signals s on s.trader_id = t.profile_id
where t.is_demo
group by t.trader_display_name, p.level, p.balance_usd
order by p.balance_usd desc;
