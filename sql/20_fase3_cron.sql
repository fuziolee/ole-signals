-- ============================================================================
-- OLE Signals — 20_fase3_cron.sql
-- Jadwal pg_cron Fase 3: panggil Edge Function fetch-prices tiap 15 menit.
-- Jalankan di Supabase SQL Editor (project ole-signals) SETELAH 18 dan
-- SETELAH kedua Edge Function di-deploy (lihat laporan Fase 3).
--
-- Cara kerja: pg_cron -> pg_net http_post -> fetch-prices (anon key) ->
--   fetch-prices menulis tabel prices lalu memanggil settle-signals.
--   TIDAK ADA job cron terpisah untuk settle: bila pemanggilan settle
--   dari fetch-prices gagal, putaran fetch berikutnya (15 menit kemudian)
--   akan memanggil settle lagi selagi harga masih segar.
--
-- Keamanan:
--  * Yang dipakai di sini hanya ANON KEY — kunci publik yang memang sudah
--    ada di repo (js/config.js) dan dijaga oleh RLS. Anon key cukup untuk
--    MEMANGGIL function; penulisan ke tabel prices dilakukan function
--    dengan SUPABASE_SERVICE_ROLE_KEY yang disuntikkan otomatis oleh
--    Supabase — kunci itu TIDAK PERNAH ditulis di file ini/repo/chat.
--  * GANTI '<ANON_KEY>' di bawah dengan nilai SUPABASE_ANON_KEY dari
--    js/config.js (atau Dashboard -> Settings -> API -> anon public).
--  * Bila anon key suatu hari di-rotate, perbarui job ini (lihat bawah).
--
-- Prasyarat ekstensi (sekali saja; bila gagal, aktifkan dari Dashboard ->
-- Database -> Extensions, lalu jalankan ulang file ini):
--   pg_cron  — penjadwal (sudah tersedia di Supabase)
--   pg_net   — http_post dari dalam Postgres (sudah tersedia di Supabase)
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Job: fetch-prices tiap 15 menit (menit 0, 15, 30, 45 setiap jam).
-- Nama job harus unik; bila sudah ada job bernama sama, hapus dulu
-- (lihat perintah unschedule di bawah).
select cron.schedule(
  'fetch-prices-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://hhukbtpcsepjkszveejx.supabase.co/functions/v1/fetch-prices',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <ANON_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Verifikasi (jalankan terpisah): job terdaftar + jadwalnya.
-- select jobid, jobname, schedule, active from cron.job
-- where jobname = 'fetch-prices-15min';

-- Uji manual sekali (tanpa menunggu 15 menit): panggil function langsung
-- dari Dashboard -> Edge Functions -> fetch-prices -> Invoke, atau curl:
--   curl -X POST https://hhukbtpcsepjkszveejx.supabase.co/functions/v1/fetch-prices \
--     -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{}'
-- Lalu periksa: select pair, price, fetched_at from public.prices order by pair;
-- (ke-11 pair harus punya fetched_at < 15 menit lalu) dan
-- select * from public.settlement_runs order by run_at desc limit 1;

-- --- Menghapus / memperbarui job (bila diperlukan) -------------------------
-- select cron.unschedule('fetch-prices-15min');
-- (Lalu jalankan ulang file ini dengan anon key yang baru.)
