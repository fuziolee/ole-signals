-- ============================================================================
-- OLE Signals: 39_r80_signal_cancelled_generic.sql
-- Ronde 80 (keputusan user 2026-11-28 21:48 WIB, "buat aja seperti nomor
-- 2" = Opsi B, dua varian cermin R78/R79): notifikasi signal_cancelled
-- di cancel_signal DIGENERIKKAN seperti R78 menggenerikkan new_signal
-- dan R79 menggenerikkan signal_edited. Notifikasi baru SELALU generik,
-- tanpa pair atau arah. Detail hanya ada di sinyal itu sendiri.
-- Yang berubah di sini hanya blok notifikasi:
--   * trader berbayar (L5+ dengan harga > 0): semua penyalin mendapat
--     '@username membatalkan sinyal yang Anda salin (berlangganan untuk
--     melihat detailnya). Jangan eksekusi sinyal ini.' (cermin R78/R79).
--   * trader gratis: semua penyalin mendapat '@username membatalkan
--     sinyal yang Anda salin. Jangan eksekusi sinyal ini.'
--   * predikat berbayar memakai subquery cermin sql/36 (level dari
--     trader_progress >= 5 DAN subscription_price_usd dari traders > 0,
--     tanpa cek langganan per-penyalin): pesan tidak bergantung pada
--     status langganan pembaca. cancel_signal TIDAK memuat v_trader
--     maupun v_progress, jadi keduanya diambil lewat subquery.
--   * kalimat peringatan "Jangan eksekusi sinyal ini." dipertahankan:
--     itu seluruh fungsi notifikasi ini.
--   * judul ('Sinyal yang Anda salin dibatalkan') dan penerima (penyalin
--     saja) TIDAK berubah. Notifikasi lama TIDAK diubah (cermin opsi A
--     R78).
--   * Catatan jujur (keberatan plan R80 pasal 2b, diterima user secara
--     sadar saat memilih B): sufiks berlangganan adalah instruksi yang
--     tidak membuka apa pun untuk sinyal yang sudah dibatalkan, karena
--     sinyalnya sudah hilang dari view dan klik notifikasi tidak
--     membuka overlay. Dipilih demi konsistensi dua varian dengan
--     R78/R79, bukan karena fungsinya.
--
-- ISI FILE INI: CREATE OR REPLACE FUNCTION cancel_signal(...) SAJA.
-- Body disalin dari sql/03_functions.sql (baris 775-848), kecuali
-- blok notifikasi. Kode lain sama persis.
--
-- SUMBER KEBENARAN: badan fungsi di sini disalin dari sql/03.
-- PERINGATAN KERAS: JANGAN terapkan ulang sql/03 sesudah file ini.
-- File 03 memuat create_signal, update_signal, dan cancel_signal
-- versi lama; menerapkan ulang 03 akan MENGHAPUS perbaikan R78
-- (create_signal sql/36), R79 (update_signal sql/38), dan R73
-- (copy_signal sql/35) dari live. **39 menggantikan cancel_signal
-- dari 03** (create_signal tetap dari 36, update_signal tetap dari
-- 38, copy_signal tetap dari 35, view tetap dari 37).
--
-- TIDAK ADA perubahan grant (CREATE OR REPLACE mempertahankan grant
-- yang sudah ada: revoke dari public, grant ke authenticated).
-- TIDAK ADA data seed, TIDAK ADA kunci/password di file ini.
-- ============================================================================

create or replace function public.cancel_signal(p_signal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_old public.signals%rowtype;
  v_new public.signals%rowtype;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  -- Kunci per-trader (serialisasi), lalu kunci baris sinyal.
  perform public.lock_trader_progress(v_actor);

  select * into v_old
  from public.signals
  where id = p_signal_id
  for update;
  if not found then
    return public.api_error('invalid', 'Sinyal tidak ditemukan.');
  end if;
  if v_old.trader_id <> v_actor then
    return public.api_error('invalid', 'Sinyal tidak ditemukan.');
  end if;

  -- AC-CANCEL-01/04: hanya PENDING, hanya pemilik. Status dicek ULANG saat
  -- permintaan masuk, di bawah kunci, bila entry tersentuh di antara
  -- buka-dialog dan klik "Ya", sinyal sudah AKTIF dan ditolak di sini.
  if v_old.status <> 'PENDING' then
    return public.api_error(
      'notpending',
      'Sinyal sudah tidak dapat dibatalkan (status: ' || v_old.status || ').'
    );
  end if;

  update public.signals set
    status = 'CANCELLED',
    closed_at = now(),
    version = v_old.version + 1,
    updated_at = now()
  where id = p_signal_id
  returning * into v_new;

  -- Audit (AC-GEN-06). Baris sinyal TETAP tersimpan dengan status
  -- CANCELLED (catatan internal, AC-CANCEL-06); RLS menyembunyikannya
  -- dari publik (AC-CANCEL-05). Kuota pair pulih otomatis karena
  -- CANCELLED tidak dihitung sebagai sinyal terbuka (T-06).
  insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
  values (v_actor, 'signal_cancel', v_new.id, to_jsonb(v_old), to_jsonb(v_new));

  -- Beri tahu follower yang sudah menyalin sinyal ini.
  -- Ronde 80 (Opsi B, dua varian cermin R78/R79): notifikasi baru SELALU
  -- generik, tanpa pair atau arah. Trader berbayar (L5+ dengan harga)
  -- memakai pesan terkunci untuk semua penyalin; trader gratis memakai
  -- pesan generik biasa. Kalimat peringatan "Jangan eksekusi sinyal
  -- ini." dipertahankan. Notifikasi lama TIDAK diubah.
  insert into public.notifications (user_id, type, title, message, signal_id)
  select
    c.follower_id,
    'signal_cancelled',
    'Sinyal yang Anda salin dibatalkan',
    case
      when coalesce((select level from public.trader_progress where trader_id = v_actor), 1) >= 5
        and coalesce((select subscription_price_usd from public.traders where profile_id = v_actor), 0) > 0
      then '@' || coalesce((select username from public.traders where profile_id = v_actor), 'trader') || ' membatalkan sinyal yang Anda salin (berlangganan untuk melihat detailnya). Jangan eksekusi sinyal ini.'
      else '@' || coalesce((select username from public.traders where profile_id = v_actor), 'trader') || ' membatalkan sinyal yang Anda salin. Jangan eksekusi sinyal ini.'
    end,
    v_new.id
  from public.copies c
  where c.signal_id = v_new.id and c.follower_id <> v_actor;

  return jsonb_build_object(
    'ok', true, 'code', 'ok', 'signal', public.signal_to_jsonb(v_new)
  );
end;
$func$;
