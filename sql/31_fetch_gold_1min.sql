-- ============================================================================
-- OLE Signals: 31_fetch_gold_1min.sql
-- Ronde 65: jadwal pg_cron untuk jalur emas 1 menit, panggil Edge Function
-- fetch-gold tiap 1 menit. HANYA emas (XAUS); forex tetap jalur
-- fetch-prices tiap 15 menit (sql/20, job fetch-prices-15min, TIDAK
-- disentuh file ini).
-- Jalankan di Supabase SQL Editor (project ole-signals) SETELAH Edge
-- Function fetch-gold di-deploy (tanpanya cron memanggil URL yang belum
-- ada, gagal 404 di pg_net, tidak merusak apa pun, tapi tidak berguna).
--
-- Cara kerja: pg_cron -> pg_net http_post -> fetch-gold (anon key) ->
--   fetch-gold menulis HANYA baris XAUUSD di tabel prices lalu memanggil
--   settle-signals, supaya sinyal emas (entry/TP/SL) dinilai tiap menit.
--   TIDAK ADA job cron terpisah untuk settle: bila pemanggilan settle
--   dari fetch-gold gagal, putaran fetch berikutnya (1 menit kemudian)
--   akan memanggil settle lagi selagi harga masih segar.
--
-- Batas yang dipakai (terverifikasi dari dokumentasi sumber):
--  * XAUS /spot: 60 req/menit/IP, data di-cache 60 detik di edge
--    ("Poll no faster than the data changes"), 1/menit sudah secepat
--    data sumbernya; di bawah 1 menit percuma.
--  * Edge Function invocations: ~43.200/bulan (1/menit) dari jatah gratis
--    500.000/bulan. Ditambah settle-signals yang ikut tiap menit, total
--    tetap di bawah 20% jatah.
--  * UniRateAPI TIDAK tersentuh jalur ini (tetap 96/hari dari 200).
--
-- CATATAN operasional: tiap putaran settle menulis 1 baris ke
-- public.settlement_runs (sql/18, tanpa retensi/pembersihan). Jalur ini
-- menambah ~43.200 baris/bulan ke tabel itu (~200-300 byte/baris,
-- ~9-13 MB/bulan dari kuota DB gratis 500 MB). Bila suatu hari tabel itu
-- membengkak, putuskan retensi/pembersihan TERPISAH, jangan di sini.
--
-- Keamanan:
--  * Yang dipakai di sini hanya ANON KEY, kunci publik yang memang sudah
--    ada di repo (js/config.js) dan dijaga oleh RLS. Anon key cukup untuk
--    MEMANGGIL function; penulisan ke tabel prices dilakukan function
--    dengan SUPABASE_SERVICE_ROLE_KEY yang disuntikkan otomatis oleh
--    Supabase, kunci itu TIDAK PERNAH ditulis di file ini/repo/chat.
--  * GANTI '<ANON_KEY>' di bawah dengan nilai SUPABASE_ANON_KEY dari
--    js/config.js (atau Dashboard -> Settings -> API -> anon public).
--  * Bila anon key suatu hari di-rotate, perbarui job ini (lihat bawah).
--
-- Prasyarat ekstensi (sekali saja; bila gagal, aktifkan dari Dashboard ->
-- Database -> Extensions, lalu jalankan ulang file ini):
--   pg_cron: penjadwal (sudah tersedia di Supabase)
--   pg_net: http_post dari dalam Postgres (sudah tersedia di Supabase)
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Job: fetch-gold tiap 1 menit.
-- Nama job harus unik; bila sudah ada job bernama sama, hapus dulu
-- (lihat perintah unschedule di bawah).
select cron.schedule(
  'fetch-gold-1min',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://hhukbtpcsepjkszveejx.supabase.co/functions/v1/fetch-gold',
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
-- where jobname = 'fetch-gold-1min';

-- Uji manual sekali (tanpa menunggu 1 menit): panggil function langsung
-- dari Dashboard -> Edge Functions -> fetch-gold -> Invoke, atau curl:
--   curl -X POST https://hhukbtpcsepjkszveejx.supabase.co/functions/v1/fetch-gold \
--     -H "Authorization: Bearer <ANON_KEY>" -H "Content-Type: application/json" -d '{}'
-- Lalu periksa: select pair, price, fetched_at from public.prices where pair = 'XAUUSD';
-- (fetched_at XAUUSD harus < 1 menit lalu) dan baris forex lain TIDAK
-- berubah fetched_at-nya; lalu
-- select * from public.settlement_runs order by run_at desc limit 1;
-- (harus ada entri baru tiap menit setelah job aktif).

-- --- Menghapus / memperbarui job (bila diperlukan) -------------------------
-- select cron.unschedule('fetch-gold-1min');
-- (Lalu jalankan ulang file ini dengan anon key yang baru.)
