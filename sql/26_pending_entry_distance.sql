-- ============================================================================
-- OLE Signals — 26_pending_entry_distance.sql
-- Ronde 59 (diputuskan user 2026-11-27 18:56 WIB, "Bangun sekarang,
-- ronde sendiri"): jarak maks entry sinyal PENDING dari harga saat
-- posting = $2, dihitung dengan LOT ACUAN TETAP 0,01 (tidak tergantung
-- lot yang dipasang trader). Berlaku STOP + LIMIT. Sinyal XAUUSD user
-- 26 Nov (entry $17 dan $36 dari harga) di bawah aturan ini ketolak —
-- user sudah setuju.
--
-- RUMUS (cermin rumus risiko): distance_usd = |entry - harga_live|
--   x 0,01 x contract_size(pair) x quote_to_usd(pair).
-- Hasil kira-kira pada harga live saat ini: emas 20 pips ($2,00),
-- EURUSD/GBPUSD/AUDUSD/NZDUSD 20 pips, JPY ~32 pips, USDCAD ~28 pips,
-- USDCHF ~18 pips, EURGBP ~15 pips (tergantung harga live — dihitung
-- dinamis dari tabel prices, bukan tabel statis).
--
-- ISI FILE INI (terapkan SETELAH 01..25):
--  * helper public.pending_entry_distance_usd(pair, entry, price)
--  * create_signal + update_signal versi Ronde 59 (salinan persis dari
--    sql/23 dengan tambahan langkah 7c di masing-masing).
--
-- SUMBER KEBENARAN — BACA INI DULU SEBELUM MENYUNTING FILE INI:
--   Badan fungsi di sini disalin dari sql/23_reset_stats.sql, BUKAN
--   dari sql/03_functions.sql. sql/03 TIDAK memuat blok 2b penegakan
--   jeda reset (kode 'resetcooldown'); membangun dari 03 akan
--   MENGHAPUS penegakan jeda dari live secara diam-diam. JANGAN
--   terapkan ulang sql/03 atau sql/22 setelah file ini — 26 menggantikan
--   versi create/update dari 23 (seperti 23 menggantikan 22).
--
-- PERILAKU EDGE-CASE (diputuskan saat penulisan, dicatat di laporan R59):
--  * Harga pair TIDAK ADA di tabel prices -> posting/ubah DITOLAK
--    fail-closed kode 'invalid' ("Harga ... belum tersedia. Coba lagi
--    sebentar."), cermin pola cek risiko (v_risk_usd null -> 'invalid').
--    Konsekuensi: ekspektasi R35-ENTRY-06 (EURGBP tanpa harga lolos
--    dengan fallback 'limit') DIGANTIKAN R59 — tanpa harga, posting
--    sekarang ditolak. Fallback 'limit' di infer_entry_type tetap ada
--    sebagai pertahanan di helper itu sendiri.
--  * Harga BASI (fetched_at tua karena fetcher telat) tetap dipakai
--    apa adanya, sama seperti inferensi entry_type — gate basi 30 menit
--    hanya ada di settlement (sql/18). Di operasional normal fetcher
--    jalan tiap 15 menit, jadi harga acuan berumur <= ~15 menit.
--  * Sinyal PENDING LAMA tidak dibatalkan/diedit retroaktif — file ini
--    tidak mengandung UPDATE ke tabel signals; aturan hanya berjalan
--    di dalam create_signal / update_signal untuk posting + edit baru.
--  * Edit yang langsung mengaktifkan sinyal (entry baru == harga persis)
--    tidak pernah terblokir cek jarak: di titik itu jarak = $0.
--  * Urutan cek di create/update: RR (6) -> risiko 1% (7) -> jarak (7c).
--    Sinyal yang melanggar RR/risiko DAN jarak melaporkan kode RR/risiko.
--  * Kode galat baru 'distance' -> HTTP 422 (seperti 'rr'/'risk').
--    Pesan server berbahasa Indonesia, siap tampil (AC-GEN-07).
--
-- TIDAK ADA data seed, TIDAK ADA kunci/password di file ini.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- pending_entry_distance_usd — jarak entry dari harga live, dalam USD.
-- Lot acuan TETAP 0,01 (keputusan user): batas $2 tidak tergantung lot
-- sinyal. Rumus cermin calcRisk: |entry - harga| x 0,01 x contract_size
-- x quote_to_usd. NULL bila harga pair atau harga konversi belum ada.
-- STABLE (bukan immutable) karena quote_to_usd membaca tabel prices.
-- ---------------------------------------------------------------------------
create or replace function public.pending_entry_distance_usd(
  p_pair text,
  p_entry numeric,
  p_price numeric
)
returns numeric
language sql
stable
as $func$
  select case
    when p_price is null then null::numeric
    else abs(p_entry - p_price) * 0.01::numeric
      * public.contract_size(p_pair) * public.quote_to_usd(p_pair)
  end;
$func$;

create or replace function public.create_signal(
  p_pair text,
  p_direction text,
  p_entry numeric,
  p_stop_loss numeric,
  p_take_profit numeric,
  p_lot numeric,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_trader public.traders%rowtype;
  v_progress public.trader_progress%rowtype;
  v_existing public.signals%rowtype;
  v_signal public.signals%rowtype;
  v_open_count integer;
  v_rr numeric;
  v_risk_usd numeric;
  v_ref_balance numeric;
  v_entry_type text;
  v_price numeric;
  v_dist_usd numeric;
begin
  -- 0. Harus login.
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  -- 1. Identitas trader harus sudah dibuat.
  select * into v_trader from public.traders where profile_id = v_actor;
  if not found then
    return public.api_error(
      'needusername',
      'Buat username trader terlebih dahulu sebelum memposting sinyal.'
    );
  end if;

  -- 2. Kunci per-trader (serialisasi tulis sinyal trader ini).
  select * into v_progress from public.lock_trader_progress(v_actor);
  -- Ronde 35: penyebut risiko adalah SALDO ACUAN LEVEL ref(level),
  -- bukan saldo simulasi aktual. ref tidak pernah turun (hanya naik
  -- ikut level); saldo simulasi yang naik/turun tidak memengaruhi
  -- batas risiko per trade.
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

  -- 3. Idempotensi (AC-GEN-05 / T-09): kunci yang sama mengembalikan
  --    sinyal yang sudah dibuat, bukan membuat duplikat.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.signals
    where trader_id = v_actor and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'ok', true, 'code', 'ok', 'duplicate', true,
        'signal', public.signal_to_jsonb(v_existing)
      );
    end if;
  end if;

  -- 4. Validasi field (urutan mengikuti prototipe).
  --    §12 bug #5: pair tidak dikenal mengembalikan kode 'pair' (bukan
  --    'invalid' generik) supaya UI bisa menampilkan pesan yang tepat.
  if not public.is_allowed_pair(p_pair) then
    return public.api_error('pair', 'Pair tidak dikenal: ' || p_pair || '.');
  end if;
  if p_direction not in ('BUY', 'SELL') then
    return public.api_error('invalid', 'Arah harus BUY atau SELL.');
  end if;
  --    §12 bug #4: NaN lolos dari perbandingan `<= 0` di Postgres (NaN
  --    diurutkan di atas semua angka). PERHATIAN: untuk tipe numeric,
  --    NaN SAMA DENGAN dirinya sendiri ('NaN'::numeric =
  --    'NaN'::numeric adalah true), jadi uji `x <> x` TIDAK menangkap
  --    NaN — terbukti T-11 gagal 23 Nov 2026. Uji yang benar:
  --    `x = 'NaN'::numeric`. (Lewat API REST JSON NaN tidak bisa
  --    sampai ke sini — JSON mengubahnya jadi null — tapi pertahanan
  --    ini menutup jalur SQL langsung.)
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

  -- 5. Batas 2 sinyal terbuka per pair (AC-PAIR-01 / T-01).
  select count(*) into v_open_count
  from public.signals
  where trader_id = v_actor
    and pair = p_pair
    and status in ('PENDING', 'AKTIF');
  if v_open_count >= 2 then
    return public.api_error(
      'pairlimit',
      'Pair ' || p_pair || ' sudah memiliki 2 sinyal terbuka. '
      || 'Batalkan atau tunggu salah satunya selesai.'
    );
  end if;

  -- 6. Rasio risk:reward minimal 1:1 (AC-EDIT-03).
  v_rr := abs(p_take_profit - p_entry) / abs(p_entry - p_stop_loss);
  if v_rr < 1 then
    return public.api_error(
      'rr',
      'Rasio risk:reward minimal 1:1. Perbesar target profit atau perketat stop loss.'
    );
  end if;

  -- 7. Risiko maksimal 1% SALDO ACUAN LEVEL per trade (AC-EDIT-03,
  --    diubah Ronde 35 — dulu 1% saldo simulasi aktual).
  --    Risiko > 1% adalah LARANGAN posting (§5), bukan penurunan level.
  if v_ref_balance is null or v_ref_balance <= 0 then
    return public.api_error(
      'risk', 'Saldo acuan level tidak tersedia untuk memposting sinyal.'
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

  -- 7b. Jenis entry (Ronde 35): disimpulkan dari entry vs harga live
  --     saat posting — BUY di atas harga = stop, di bawah = limit
  --     (sama persis = limit); SELL sebaliknya. Tanpa harga di tabel
  --     prices, fallback 'limit' (settlement mengaktifkan saat harga
  --     masuk, dengan cabang limit).
  select price into v_price from public.prices where pair = p_pair;
  v_entry_type := public.infer_entry_type(p_direction, p_entry, v_price);

  -- 7c. Jarak entry PENDING maks $2 (Ronde 59, keputusan user 27 Nov
  --     2026): entry tidak boleh lebih dari $2 (lot acuan TETAP 0,01)
  --     dari harga live saat posting — STOP maupun LIMIT. Batas
  --     <= $2,00 lolos; > $2,00 ditolak (kode 'distance' -> 422).
  --     Tanpa harga di tabel prices, posting DITOLAK (fail-closed,
  --     cermin pola cek risiko di langkah 7: v_risk_usd null ->
  --     'invalid') — jarak tidak bisa diverifikasi tanpa harga. Harga
  --     BASI (fetcher telat) tetap dipakai apa adanya, sama seperti
  --     inferensi entry_type di 7b; gate basi 30 menit hanya berlaku
  --     di settlement (sql/18), bukan di posting. Sinyal PENDING yang
  --     sudah ada TIDAK disentuh aturan ini (tidak ada UPDATE ke
  --     signals di file ini) — aturan hanya berjalan di create/update.
  v_dist_usd := public.pending_entry_distance_usd(p_pair, p_entry, v_price);
  if v_dist_usd is null then
    return public.api_error(
      'invalid',
      'Harga ' || p_pair || ' belum tersedia. Coba lagi sebentar.'
    );
  end if;
  if v_dist_usd > 2.00 then
    return public.api_error(
      'distance',
      'Entry terlalu jauh dari harga sekarang (maks $2). Dekatkan entry ke harga saat ini.'
    );
  end if;

  -- 8. Simpan. Jam server (created_at/expires_at default now() + 3 hari).
  --    Deteksi duplikasi dua lapis (§5) BELUM di sini: kolom duplicate_of /
  --    duplicate_flagged sudah siap; deteksi jalan di langkah lanjutan
  --    Fase 2 (butuh tabel pip per pair) — lihat README.
  insert into public.signals
    (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size,
     entry_type, idempotency_key)
  values
    (v_actor, p_pair, p_direction, p_entry, p_stop_loss, p_take_profit,
     p_lot, v_entry_type, p_idempotency_key)
  returning * into v_signal;

  -- 9. Log audit (AC-GEN-06).
  insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
  values (v_actor, 'signal_create', v_signal.id, null, to_jsonb(v_signal));

  -- 10. Beri tahu follower trader ini (§6 blueprint).
  -- B4-03: jangan bocorkan entry sinyal berbayar yang terkunci — follower
  -- non-subscriber hanya mendapat pesan generik (prototipe
  -- notifNewSigLocked). B4-04: pakai @username (bukan nama tampilan).
  insert into public.notifications (user_id, type, title, message, signal_id)
  select
    f.follower_id,
    'new_signal',
    'Sinyal baru dari trader yang Anda ikuti',
    case
      when coalesce((select level from public.trader_progress where trader_id = v_actor), 1) >= 5
        and coalesce(v_trader.subscription_price_usd, 0) > 0
        and not exists (
          select 1 from public.subscriptions s
          where s.follower_id = f.follower_id
            and s.trader_id = v_actor
            and s.status = 'active'
        )
      then '@' || coalesce(v_trader.username, 'trader') || ' memposting sinyal baru (berlangganan untuk melihat detailnya).'
      else '@' || coalesce(v_trader.username, 'trader') || ' memposting sinyal '
        || p_pair || ' ' || p_direction || ' @ ' || p_entry::text || '.'
    end,
    v_signal.id
  from public.follows f
  where f.trader_id = v_actor;

  return jsonb_build_object(
    'ok', true, 'code', 'ok', 'signal', public.signal_to_jsonb(v_signal)
  );
exception
  when unique_violation then
    -- Balapan dua permintaan dengan kunci idempotensi yang sama: kembalikan
    -- baris yang sudah dibuat (T-09), bukan galat.
    if p_idempotency_key is not null then
      select * into v_existing
      from public.signals
      where trader_id = v_actor and idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object(
          'ok', true, 'code', 'ok', 'duplicate', true,
          'signal', public.signal_to_jsonb(v_existing)
        );
      end if;
    end if;
    raise;
end;
$func$;
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

  -- Kunci per-trader dulu (serialisasi), lalu kunci baris sinyal.
  select * into v_progress from public.lock_trader_progress(v_actor);
  -- Ronde 35: penyebut risiko adalah SALDO ACUAN LEVEL ref(level)
  -- (bukan saldo simulasi aktual) — lihat create_signal.
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
  -- permintaan masuk, di bawah kunci — aktivasi/pembatalan yang terjadi
  -- di antara buka-form dan simpan akan menolak di sini.
  if v_old.status <> 'PENDING' then
    return public.api_error(
      'notpending',
      'Sinyal sudah tidak dapat diubah (status: ' || v_old.status
      || '). Buka ulang sinyal dari daftar.'
    );
  end if;

  -- R9-4: sinyal yang sudah dibagikan terkunci dari edit — isi yang
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
  -- §12 bug #4: tolak NaN (uji `x = 'NaN'::numeric` — `x <> x` tidak
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
  -- ini (infer_entry_type) dan cabang sentuhan mengikuti jenisnya —
  -- LIMIT: BUY harga <= entry, SELL harga >= entry; STOP: BUY harga
  -- >= entry, SELL harga <= entry. Bila tidak ada harga di tabel prices,
  -- sinyal tetap PENDING dan settlement akan mengaktifkannya saat harga
  -- masuk.
  select price into v_price from public.prices where pair = p_pair;
  v_entry_type := public.infer_entry_type(p_direction, p_entry, v_price);

  -- 7c. Jarak entry PENDING maks $2 (Ronde 59, keputusan user 27 Nov
  --     2026): edit entry PENDING dicek ulang terhadap harga saat edit,
  --     aturan yang sama seperti create (lot acuan tetap 0,01;
  --     <= $2,00 lolos; > $2,00 ditolak kode 'distance' -> 422; tanpa
  --     harga DITOLAK fail-closed seperti di create). Pengecekan ini
  --     diletakkan SEBELUM blok sentuhan AC-EDIT-07 — dan itu aman:
  --     dengan inferensi entry_type dari harga yang sama, sentuhan
  --     hanya terjadi bila harga == entry persis (BUY limit: harga <=
  --     entry padahal entry <= harga; BUY stop: harga >= entry padahal
  --     entry > harga; SELL simetris), dan di titik itu jarak = $0,
  --     jadi cek jarak tidak pernah memblokir aktivasi langsung.
  --     Sinyal PENDING lama (dibuat sebelum aturan ini) tetap bisa
  --     diedit, tapi editnya harus memenuhi jarak $2.
  v_dist_usd := public.pending_entry_distance_usd(p_pair, p_entry, v_price);
  if v_dist_usd is null then
    return public.api_error(
      'invalid',
      'Harga ' || p_pair || ' belum tersedia. Coba lagi sebentar.'
    );
  end if;
  if v_dist_usd > 2.00 then
    return public.api_error(
      'distance',
      'Entry terlalu jauh dari harga sekarang (maks $2). Dekatkan entry ke harga saat ini.'
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
  insert into public.notifications (user_id, type, title, message, signal_id)
  select
    c.follower_id,
    'signal_edited',
    'Sinyal yang Anda salin diubah',
    'Sinyal ' || p_pair || ' ' || p_direction || ' diubah oleh @'
      || coalesce((select username from public.traders where profile_id = v_actor), 'trader') || '.'
      || case when v_new_status = 'AKTIF'
              then ' Sinyal kini AKTIF dan terkunci.'
              else '' end,
    v_new.id
  from public.copies c
  where c.signal_id = v_new.id and c.follower_id <> v_actor;

  return jsonb_build_object(
    'ok', true, 'code', 'ok', 'signal', public.signal_to_jsonb(v_new)
  );
end;
$func$;
