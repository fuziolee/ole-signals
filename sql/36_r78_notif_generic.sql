-- ============================================================================
-- OLE Signals: 36_r78_notif_generic.sql
-- Ronde 78 (diputuskan user 2026-11-28 19:19 WIB, "A + B (disarankan)"):
-- notifikasi baru SELALU generik. create_signal tidak lagi menulis
-- detail sinyal (pair/arah/entry) ke notifikasi new_signal; detail
-- hanya ada di sinyal itu sendiri. A (notifikasi lama dibiarkan apa
-- adanya) TIDAK butuh kode. Yang berubah di sini hanya B:
--   * trader berbayar (L5+ dengan harga > 0): semua follower mendapat
--     '@username memposting sinyal baru (berlangganan untuk melihat
--     detailnya).' (teks yang sama seperti sebelumnya untuk
--     non-pelanggan; kini juga untuk pelanggan).
--   * trader gratis: semua follower mendapat '@username memposting
--     sinyal baru.' (sebelumnya berisi pair + arah + entry).
--   * cek langganan per-follower (subquery subscriptions) DIHAPUS:
--     pesan tidak lagi bergantung pada status langganan pembaca.
--
-- ISI FILE INI: CREATE OR REPLACE FUNCTION create_signal(...) SAJA.
-- Body disalin dari sql/28_r60_min_distance.sql, kecuali blok
-- notifikasi langkah 10. Catatan: em dash di komentar body sql/28
-- diganti koma di file ini supaya file baru bebas em dash (aturan
-- R-02); hanya komentar yang berubah, kode sama persis kecuali
-- langkah 10. update_signal TIDAK disentuh (tetap versi sql/34);
-- notifikasi 'signal_edited' di update_signal TIDAK disentuh
-- (jenis notifikasi lain, di luar keputusan B).
--
-- SUMBER KEBENARAN: badan fungsi di sini disalin dari sql/28 (yang
-- dibangun dari sql/26 ← sql/23). sql/03 TIDAK memuat blok jeda reset
-- 2b; membangun dari 03 akan MENGHAPUS penegakan jeda dari live.
-- JANGAN terapkan ulang sql/03, sql/22, sql/23, atau sql/26 setelah
-- file ini. **36 menggantikan create_signal dari 28** (update_signal
-- tetap dari 34).
--
-- TIDAK ADA data seed, TIDAK ADA kunci/password di file ini.
-- ============================================================================

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
  --    NaN, terbukti T-11 gagal 23 Nov 2026. Uji yang benar:
  --    `x = 'NaN'::numeric`. (Lewat API REST JSON NaN tidak bisa
  --    sampai ke sini, JSON mengubahnya jadi null, tapi pertahanan
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
  --    diubah Ronde 35, dulu 1% saldo simulasi aktual).
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
  --     saat posting, BUY di atas harga = stop, di bawah = limit
  --     (sama persis = limit); SELL sebaliknya. Tanpa harga di tabel
  --     prices, fallback 'limit' (settlement mengaktifkan saat harga
  --     masuk, dengan cabang limit).
  select price into v_price from public.prices where pair = p_pair;
  v_entry_type := public.infer_entry_type(p_direction, p_entry, v_price);

  -- 7c. Jarak entry PENDING MIN $2 (Ronde 60, koreksi user 27 Nov 2026,
  --     pembalikan R59): entry tidak boleh KURANG dari $2 (lot acuan
  --     TETAP 0,01) dari harga live saat posting, STOP maupun LIMIT.
  --     Batas >= $2,00 lolos; < $2,00 ditolak (kode 'distance' -> 422).
  --     Tanpa harga di tabel prices, posting DITOLAK (fail-closed,
  --     cermin pola cek risiko di langkah 7: v_risk_usd null ->
  --     'invalid'), jarak tidak bisa diverifikasi tanpa harga. Harga
  --     BASI (fetcher telat) tetap dipakai apa adanya, sama seperti
  --     inferensi entry_type di 7b; gate basi 30 menit hanya berlaku
  --     di settlement (sql/18), bukan di posting. Sinyal PENDING yang
  --     sudah ada TIDAK disentuh aturan ini (tidak ada UPDATE ke
  --     signals di file ini), aturan hanya berjalan di create/update.
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

  -- 8. Simpan. Jam server (created_at/expires_at default now() + 3 hari).
  --    Deteksi duplikasi dua lapis (§5) BELUM di sini: kolom duplicate_of /
  --    duplicate_flagged sudah siap; deteksi jalan di langkah lanjutan
  --    Fase 2 (butuh tabel pip per pair), lihat README.
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
  -- Ronde 78 (keputusan user A+B): notifikasi baru SELALU generik,
  -- tanpa pair, arah, atau entry. Detail hanya ada di sinyal itu
  -- sendiri. Trader berbayar (L5+ dengan harga) memakai pesan
  -- terkunci untuk semua follower; trader gratis memakai pesan
  -- generik biasa. Notifikasi lama TIDAK diubah (opsi A).
  insert into public.notifications (user_id, type, title, message, signal_id)
  select
    f.follower_id,
    'new_signal',
    'Sinyal baru dari trader yang Anda ikuti',
    case
      when coalesce((select level from public.trader_progress where trader_id = v_actor), 1) >= 5
        and coalesce(v_trader.subscription_price_usd, 0) > 0
      then '@' || coalesce(v_trader.username, 'trader') || ' memposting sinyal baru (berlangganan untuk melihat detailnya).'
      else '@' || coalesce(v_trader.username, 'trader') || ' memposting sinyal baru.'
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
