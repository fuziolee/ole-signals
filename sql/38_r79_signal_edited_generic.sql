-- ============================================================================
-- OLE Signals: 38_r79_signal_edited_generic.sql
-- Ronde 79 (keputusan user 2026-11-28 20:38 WIB, "B + hapus sufiks
-- (disarankan)"): notifikasi signal_edited di update_signal DIGENERIKKAN
-- seperti R78 menggenerikkan new_signal. Notifikasi baru SELALU generik,
-- tanpa pair, arah, atau entry. Detail hanya ada di sinyal itu sendiri.
-- Yang berubah di sini hanya blok notifikasi AC-EDIT-08:
--   * trader berbayar (L5+ dengan harga > 0): semua penyalin mendapat
--     '@username mengubah sinyal yang Anda salin (berlangganan untuk
--     melihat detailnya).' (cermin R78).
--   * trader gratis: semua penyalin mendapat '@username mengubah sinyal
--     yang Anda salin.'
--   * predikat berbayar memakai v_progress.level (sudah dikunci/dimuat)
--     DAN v_trader.subscription_price_usd > 0, tanpa cek langganan
--     per-penyalin: pesan tidak bergantung pada status langganan pembaca.
--   * sufiks "Sinyal kini AKTIF dan terkunci." DIHAPUS total (C1):
--     cabang mati sejak R60 (cek jarak langkah 7c berjalan sebelum blok
--     sentuhan, edit tidak pernah lagi mengaktifkan langsung; bukti di
--     komentar langkah 7c sql/34), sekaligus jalur bocor laten status
--     AKTIF yang disembunyikan UI terkunci.
--   * judul ('Sinyal yang Anda salin diubah') dan penerima (penyalin
--     saja) TIDAK berubah. Notifikasi lama TIDAK diubah (cermin opsi A
--     R78).
--
-- ISI FILE INI: CREATE OR REPLACE FUNCTION update_signal(...) SAJA.
-- Body disalin dari sql/34_r72_update_signal_needusername.sql, kecuali
-- blok notifikasi AC-EDIT-08. Kode lain sama persis.
--
-- SUMBER KEBENARAN: badan fungsi di sini disalin dari sql/34 (yang
-- dibangun dari sql/28 <- sql/26 <- sql/23). sql/03 TIDAK memuat blok
-- jeda reset 2b; membangun dari 03 akan MENGHAPUS penegakan jeda dari
-- live. JANGAN terapkan ulang sql/03, sql/22, sql/23, atau sql/26
-- setelah file ini. **38 menggantikan update_signal dari 34**
-- (create_signal tetap dari 36, copy_signal tetap dari 35, view
-- tetap dari 37).
--
-- TIDAK ADA data seed, TIDAK ADA kunci/password di file ini.
-- ============================================================================

create or replace function public.update_signal(
  p_signal_id uuid,
  p_pair text,
  p_direction text,
  p_entry numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_lot numeric,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_trader public.traders%rowtype;
  v_old public.signals%rowtype;
  v_new public.signals%rowtype;
  v_progress public.trader_progress%rowtype;
  v_open_count integer;
  v_rr numeric;
  v_risk_usd numeric;
  v_ref_balance numeric;
  v_price numeric;
  v_dist_usd numeric;
  v_entry_type text;
  v_new_status text := 'PENDING';
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  -- Ronde 72 (temuan S12-MAP-E-19): identitas trader HARUS dicek dulu,
  -- SEBELUM lock_trader_progress. Lock itu INSERT ke trader_progress
  -- dan gagal FK bila baris traders tidak ada (eksepsi mentah tanpa
  -- kode). Cermin create_signal langkah 1.
  select * into v_trader from public.traders where profile_id = v_actor;
  if not found then
    return public.api_error(
      'needusername',
      'Buat username trader terlebih dahulu sebelum memposting sinyal.'
    );
  end if;

  -- Kunci per-trader dulu (serialisasi), lalu kunci baris sinyal.
  select * into v_progress from public.lock_trader_progress(v_actor);
  -- Ronde 35: penyebut risiko adalah SALDO ACUAN LEVEL ref(level)
  -- (bukan saldo simulasi aktual), lihat create_signal.
  v_ref_balance := public.level_ref(v_progress.level);
  -- 2b. Masa jeda reset (Ronde 35): selama jeda trader tidak bisa
  --     posting atau mengubah sinyal. Akun demo dibebaskan (helper
  --     memakai reset_cooldown_until; demo selalu NULL di sana).
  if public.trader_in_reset_cooldown(v_actor) then
    return public.api_error(
      'resetcooldown',
      'Anda sedang dalam masa jeda reset sampai '
      || to_char((select reset_cooldown_until
                    from public.trader_progress
                    where trader_id = v_actor),
                 'DD Mon YYYY HH24:MI')
      || '.'
    );
  end if;

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

  -- AC-EDIT-01: hanya PENDING yang bisa diubah. Status dicek ULANG saat
  -- permintaan masuk, di bawah kunci: aktivasi/pembatalan yang terjadi
  -- di antara buka-form dan simpan akan menolak di sini.
  if v_old.status <> 'PENDING' then
    return public.api_error(
      'notpending',
      'Sinyal sudah tidak dapat diubah (status: ' || v_old.status
      || '). Buka ulang sinyal dari daftar.'
    );
  end if;

  -- R9-4: sinyal yang sudah dibagikan terkunci dari edit, isi yang
  -- dibagikan tidak boleh diganti setelah dibagikan. (Batalkan tetap bisa
  -- lewat cancel_signal; itu menarik sinyal, bukan mengubah isinya.)
  if v_old.shared_at is not null then
    return public.api_error(
      'shared',
      'Sinyal ini sudah dibagikan, jadi tidak bisa diubah lagi.'
    );
  end if;

  -- AC-EDIT-06: perlindungan data basi (optimistic locking).
  if p_version is null or p_version <> v_old.version then
    return public.api_error(
      'conflict',
      'Sinyal sudah berubah sejak formulir dibuka. Buka ulang sinyal dari daftar.'
    );
  end if;

  -- Validasi field (sama seperti saat membuat).
  -- §12 bug #5: pair tidak dikenal -> kode 'pair'.
  if not public.is_allowed_pair(p_pair) then
    return public.api_error('pair', 'Pair tidak dikenal: ' || p_pair || '.');
  end if;
  if p_direction not in ('BUY', 'SELL') then
    return public.api_error('invalid', 'Arah harus BUY atau SELL.');
  end if;
  -- §12 bug #4: tolak NaN (uji `x = 'NaN'::numeric`, `x <> x` tidak
  -- berfungsi untuk numeric, lihat create_signal).
  if p_entry is null or p_entry = 'NaN'::numeric
     or p_stop_loss is null or p_stop_loss = 'NaN'::numeric
     or p_take_profit is null or p_take_profit = 'NaN'::numeric
     or p_entry <= 0 or p_stop_loss <= 0 or p_take_profit <= 0 then
    return public.api_error(
      'invalid', 'Entry, stop loss, dan take profit harus lebih dari 0.'
    );
  end if;
  if p_lot is null or p_lot = 'NaN'::numeric or p_lot <= 0 then
    return public.api_error('invalid', 'Lot harus lebih dari 0.');
  end if;
  if (p_direction = 'BUY'
      and not (p_stop_loss < p_entry and p_entry < p_take_profit))
     or (p_direction = 'SELL'
      and not (p_take_profit < p_entry and p_entry < p_stop_loss)) then
    return public.api_error(
      'invalid',
      'Untuk BUY berlaku SL < entry < TP; untuk SELL berlaku TP < entry < SL.'
    );
  end if;

  -- AC-PAIR-02/03: batas dihitung di pair TUJUAN, TIDAK menghitung sinyal
  -- yang sedang diubah. Edit tanpa ganti pair tidak pernah terblokir
  -- (T-03); pindah ke pair yang sudah berisi 2 ditolak (T-02 / BUG-1).
  select count(*) into v_open_count
  from public.signals
  where trader_id = v_actor
    and pair = p_pair
    and status in ('PENDING', 'AKTIF')
    and id <> p_signal_id;
  if v_open_count >= 2 then
    return public.api_error(
      'pairlimit',
      'Pair ' || p_pair || ' sudah memiliki 2 sinyal terbuka. '
      || 'Pilih pair lain atau batalkan salah satu sinyal di pair itu.'
    );
  end if;

  -- Rasio risk:reward minimal 1:1.
  v_rr := abs(p_take_profit - p_entry) / abs(p_entry - p_stop_loss);
  if v_rr < 1 then
    return public.api_error(
      'rr',
      'Rasio risk:reward minimal 1:1. Perbesar target profit atau perketat stop loss.'
    );
  end if;

  -- Risiko maksimal 1% SALDO ACUAN LEVEL per trade (Ronde 35).
  if v_ref_balance is null or v_ref_balance <= 0 then
    return public.api_error(
      'risk', 'Saldo acuan level tidak tersedia untuk mengubah sinyal.'
    );
  end if;
  v_risk_usd := abs(p_entry - p_stop_loss) * p_lot
    * public.contract_size(p_pair) * public.quote_to_usd(p_pair);
  if v_risk_usd is null then
    return public.api_error(
      'invalid',
      'Harga konversi untuk ' || p_pair || ' belum tersedia. Coba lagi sebentar.'
    );
  end if;
  if v_risk_usd / v_ref_balance > 0.01 then
    return public.api_error(
      'risk',
      'Risiko trade ini melebihi 1% saldo acuan level (maks. 1% per trade). '
      || 'Perkecil lot atau perketat stop loss.'
    );
  end if;

  -- AC-EDIT-07: bila entry baru sudah tersentuh harga saat ini, sinyal
  -- langsung menjadi AKTIF dan terkunci.
  -- Ronde 35: jenis entry disimpulkan ulang dari entry baru vs harga saat
  -- ini (infer_entry_type) dan cabang sentuhan mengikuti jenisnya:
  -- LIMIT: BUY harga <= entry, SELL harga >= entry; STOP: BUY harga
  -- >= entry, SELL harga <= entry. Bila tidak ada harga di tabel prices,
  -- sinyal tetap PENDING dan settlement akan mengaktifkannya saat harga
  -- masuk.
  select price into v_price from public.prices where pair = p_pair;
  v_entry_type := public.infer_entry_type(p_direction, p_entry, v_price);

  -- 7c. Jarak entry PENDING MIN $2 (Ronde 60, koreksi user 27 Nov 2026,
  --     pembalikan R59): edit entry PENDING dicek ulang terhadap harga
  --     saat edit, aturan yang sama seperti create (lot acuan tetap
  --     0,01; >= $2,00 lolos; < $2,00 ditolak kode 'distance' -> 422;
  --     tanpa harga DITOLAK fail-closed seperti di create). Pengecekan
  --     ini diletakkan SEBELUM blok sentuhan AC-EDIT-07. Konsekuensi
  --     pembalikan: edit ke entry == harga persis kini DITOLAK (jarak
  --     $0 < $2), jadi edit TIDAK PERNAH lagi mengaktifkan langsung.
  --     Blok sentuhan di bawah tetap ada di kode tapi tidak terjangkau
  --     lewat edit; settlement (sql/18) tetap mengaktifkan PENDING
  --     normal saat harga menyentuh entry. Sinyal PENDING lama (dibuat
  --     sebelum aturan ini) tetap bisa diedit, tapi editnya harus
  --     memenuhi jarak min $2.
  v_dist_usd := public.pending_entry_distance_usd(p_pair, p_entry, v_price);
  if v_dist_usd is null then
    return public.api_error(
      'invalid',
      'Harga ' || p_pair || ' belum tersedia. Coba lagi sebentar.'
    );
  end if;
  if v_dist_usd < 2.00 then
    return public.api_error(
      'distance',
      'Entry terlalu dekat dengan harga sekarang (min $2). Jauhkan entry dari harga saat ini.'
    );
  end if;
  if v_price is not null then
    if (v_entry_type = 'limit'
        and ((p_direction = 'BUY' and v_price <= p_entry)
          or (p_direction = 'SELL' and v_price >= p_entry)))
       or (v_entry_type = 'stop'
        and ((p_direction = 'BUY' and v_price >= p_entry)
          or (p_direction = 'SELL' and v_price <= p_entry))) then
      v_new_status := 'AKTIF';
    end if;
  end if;

  -- Simpan. created_at / expires_at TIDAK disentuh: masa kedaluwarsa 3 hari
  -- tetap dihitung sejak pertama diposting (AC-EDIT-05 / BUG-2).
  update public.signals set
    pair = p_pair,
    direction = p_direction,
    entry = p_entry,
    stop_loss = p_stop_loss,
    take_profit = p_take_profit,
    lot_size = p_lot,
    entry_type = v_entry_type,
    status = v_new_status,
    activated_at = case when v_new_status = 'AKTIF' then now()
                        else v_old.activated_at end,
    version = v_old.version + 1,
    updated_at = now()
  where id = p_signal_id
  returning * into v_new;

  -- Audit (AC-GEN-06): sebelum & sesudah.
  insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
  values (v_actor, 'signal_update', v_new.id, to_jsonb(v_old), to_jsonb(v_new));

  -- AC-EDIT-08: beri tahu follower yang sudah menyalin sinyal ini.
  -- Ronde 79 (keputusan user B + hapus sufiks): notifikasi baru SELALU
  -- generik, tanpa pair, arah, atau entry. Trader berbayar (L5+ dengan
  -- harga) memakai pesan terkunci untuk semua penyalin; trader gratis
  -- memakai pesan generik biasa. Sufiks AKTIF DIHAPUS total (cabang mati
  -- sejak R60, lihat langkah 7c). Notifikasi lama TIDAK diubah.
  insert into public.notifications (user_id, type, title, message, signal_id)
  select
    c.follower_id,
    'signal_edited',
    'Sinyal yang Anda salin diubah',
    case
      when coalesce(v_progress.level, 1) >= 5
        and coalesce(v_trader.subscription_price_usd, 0) > 0
      then '@' || coalesce(v_trader.username, 'trader') || ' mengubah sinyal yang Anda salin (berlangganan untuk melihat detailnya).'
      else '@' || coalesce(v_trader.username, 'trader') || ' mengubah sinyal yang Anda salin.'
    end,
    v_new.id
  from public.copies c
  where c.signal_id = v_new.id and c.follower_id <> v_actor;

  return jsonb_build_object(
    'ok', true, 'code', 'ok', 'signal', public.signal_to_jsonb(v_new)
  );
end;
$func$;
