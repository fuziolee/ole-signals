-- ============================================================================
-- OLE Signals — 22_entry_type.sql
-- Ronde 35 (2026-11-26): jenis entry STOP + LIMIT + risiko 1% saldo acuan
-- level.
--
-- KEPUTUSAN USER (dicatat di MEMORY.md + blueprint §5):
--  1. RISIKO = 1% dari SALDO ACUAN LEVEL ref(L) = $10.000 x 1,05^(L-1),
--     BUKAN saldo simulasi aktual. ref tidak pernah turun (hanya naik ikut
--     level). Konsekuensi: di L1 risiko maks selalu $100/trade walau saldo
--     simulasi jatuh (mis. saldo simulasi $5.000 -> $100 = 2% saldo
--     simulasi). Pengaman 2%-dari-saldo-aktual TIDAK diimplementasikan
--     (ditawarkan, tidak diputuskan).
--  2. ENTRY harus bisa STOP dan LIMIT. Sisi disimpulkan dari entry vs harga
--     live saat posting (tanpa selector manual): BUY entry > harga -> stop
--     (aktif saat harga NAIK menyentuh entry); BUY entry <= harga -> limit
--     (aktif saat harga TURUN menyentuh entry); SELL entry < harga -> stop;
--     SELL entry >= harga -> limit; sama persis -> limit. Sinyal LAMA
--     (semua baris yang sudah ada) di-grandfather sebagai 'limit' —
--     termasuk sinyal C EURUSD yang sudah AKTIF; statusnya tidak berubah.
--     Mesin Fase 3 (Desain D, sql/18) sebelumnya hanya LIMIT — itu sebabnya
--     dua sinyal XAUUSD user 12:51 WIB (BUY 3607.09, SELL 3554.27, emas
--     ~3590) langsung aktif + kena SL di fetch 13:00.
--
-- ISI FILE INI (terapkan SETELAH 01..21, SEBELUM 23):
--  * kolom signals.entry_type (limit/stop, default 'limit')
--  * helper public.infer_entry_type(direction, entry, price)
--  * signal_to_jsonb + create_signal + update_signal + settle_signals
--    versi Ronde 35 (salinan persis dari sql/03 + sql/18 dengan edit di
--    atas; file sumber sql/03 + sql/18 diperbarui ke versi yang sama).
--    Pola ini mengikuti migrasi 14/15: versi terbaru fungsi tinggal di
--    file migrasi; JANGAN terapkan ulang sql/03 atau sql/18 versi lama
--    setelah file ini (akan mengembalikan risiko saldo-aktual + aktivasi
--    limit-saja). Penegakan jeda reset saat posting/ubah ada di 23.
--
-- TIDAK ADA data seed, TIDAK ADA kunci/password di file ini.
-- ============================================================================

alter table public.signals
  add column if not exists entry_type text not null default 'limit'
  check (entry_type in ('limit', 'stop'));

comment on column public.signals.entry_type is
  'Jenis entry Ronde 35: limit (aktif saat harga bergerak KE entry dari sisi limit) atau stop (aktif saat harga bergerak KE entry dari sisi breakout). Disimpulkan server dari entry vs harga live saat posting/ubah; sinyal lama = limit.';

-- ---------------------------------------------------------------------------
-- infer_entry_type — sisi entry dari posisi entry vs harga live.
-- Sama persis -> limit (keputusan user). Tanpa harga -> limit (fallback).
-- ---------------------------------------------------------------------------
create or replace function public.infer_entry_type(
  p_direction text,
  p_entry numeric,
  p_price numeric
)
returns text
language sql
immutable
as $func$
  select case
    when p_price is null then 'limit'
    when p_direction = 'BUY' and p_entry > p_price then 'stop'
    when p_direction = 'BUY' then 'limit'
    when p_direction = 'SELL' and p_entry < p_price then 'stop'
    else 'limit'
  end;
$func$;

create or replace function public.signal_to_jsonb(s public.signals)
returns jsonb
language sql
immutable
as $func$
  select jsonb_build_object(
    'id', s.id, 'trader_id', s.trader_id, 'pair', s.pair,
    'direction', s.direction, 'entry', s.entry,
    'stop_loss', s.stop_loss, 'take_profit', s.take_profit,
    'lot_size', s.lot_size, 'status', s.status,
    'entry_type', s.entry_type,
    'version', s.version,
    'created_at', s.created_at, 'expires_at', s.expires_at,
    'activated_at', s.activated_at, 'closed_at', s.closed_at,
    'close_price', s.close_price, 'profit_usd', s.profit_usd,
    'profit_pips', s.profit_pips, 'r_value', s.r_value,
    'holding_minutes', s.holding_minutes,
    'duplicate_of', s.duplicate_of, 'duplicate_flagged', s.duplicate_flagged
  );
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

create or replace function public.settle_signals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_now timestamptz := now();
  v_fresh interval := interval '30 minutes';
  v_activated integer := 0;
  v_wins integer := 0;
  v_losses integer := 0;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_failures jsonb := '[]'::jsonb;
  v_stale_pairs text[] := '{}';
  v_sig record;
  v_price numeric;
  v_is_win boolean;
  v_close_price numeric;
  v_conv numeric;
  v_profit numeric;
  v_pips numeric;
  v_r numeric;
  v_hold integer;
  v_recalc jsonb;
  v_ok boolean;
  v_username text;
  v_title text;
  v_msg_trader text;
  v_msg_copy text;
  v_new public.signals%rowtype;
begin
  -- -------------------------------------------------------------------------
  -- 0. PENDING kedaluwarsa -> EXPIRED (tanpa notifikasi — itu Fase 5).
  --    Audit dicatat; kuota pair pulih otomatis (EXPIRED bukan terbuka).
  -- -------------------------------------------------------------------------
  -- Data-modifying CTE (UPDATE hanya boleh di WITH, bukan di FROM).
  with expired as (
    update public.signals
    set status = 'EXPIRED',
        closed_at = v_now,
        version = version + 1,
        updated_at = v_now
    where status = 'PENDING'
      and expires_at <= v_now
    returning *
  )
  insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
  select
    trader_id,
    'signal_expire',
    id,
    jsonb_build_object('id', id, 'status', 'PENDING'),
    to_jsonb(expired)
  from expired;
  get diagnostics v_expired = row_count;

  -- -------------------------------------------------------------------------
  -- 1. Aktivasi PENDING -> AKTIF (hanya harga SEGAR; PENDING kedaluwarsa
  --    sudah diubah di langkah 0 sehingga tidak bisa aktif lagi).
  -- -------------------------------------------------------------------------
  for v_sig in
    select s.*
    from public.signals s
    join public.prices pr
      on pr.pair = s.pair
     and pr.fetched_at >= v_now - v_fresh
    where s.status = 'PENDING'
      and s.expires_at > v_now
      and (((s.entry_type = 'limit')
            and ((s.direction = 'BUY' and pr.price <= s.entry)
              or (s.direction = 'SELL' and pr.price >= s.entry)))
        or ((s.entry_type = 'stop')
            and ((s.direction = 'BUY' and pr.price >= s.entry)
              or (s.direction = 'SELL' and pr.price <= s.entry))))
    order by s.created_at
    for update of s skip locked
  loop
    v_ok := false;
    begin
      update public.signals
      set status = 'AKTIF',
          activated_at = v_now,
          version = version + 1,
          updated_at = v_now
      where id = v_sig.id
        and status = 'PENDING'
      returning * into v_new;
      if found then
        insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
        values (v_sig.trader_id, 'signal_activate', v_sig.id, to_jsonb(v_sig), to_jsonb(v_new));
        v_ok := true;
      end if;
    exception when others then
      v_failures := v_failures || jsonb_build_object(
        'signal_id', v_sig.id, 'stage', 'activate', 'error', sqlerrm);
    end;
    if v_ok then
      v_activated := v_activated + 1;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 2. Penutupan AKTIF -> WIN / LOSS (termasuk yang baru diaktifkan di
  --    langkah 1 — putaran ini membaca ulang tabel, jadi sinyal yang baru
  --    AKTIF ikut dievaluasi dengan harga yang sama).
  -- -------------------------------------------------------------------------
  for v_sig in
    select s.*, pr.price as live_price
    from public.signals s
    join public.prices pr
      on pr.pair = s.pair
     and pr.fetched_at >= v_now - v_fresh
    where s.status = 'AKTIF'
      and ((s.direction = 'BUY' and (pr.price >= s.take_profit or pr.price <= s.stop_loss))
        or (s.direction = 'SELL' and (pr.price <= s.take_profit or pr.price >= s.stop_loss)))
    order by s.created_at
    for update of s skip locked
  loop
    v_ok := false;
    begin
      -- Menang bila harga menyentuh TP ke arah trade; kalah bila SL.
      v_is_win := (v_sig.direction = 'BUY' and v_sig.live_price >= v_sig.take_profit)
        or (v_sig.direction = 'SELL' and v_sig.live_price <= v_sig.take_profit);
      v_close_price := case when v_is_win then v_sig.take_profit else v_sig.stop_loss end;

      -- Harga konversi HARUS ada — bila belum ada (fetcher belum menulis
      -- pair konversi), lewati sinyal ini; putaran berikut mencoba lagi.
      v_conv := public.quote_to_usd(v_sig.pair);
      if v_conv is null then
        v_skipped := v_skipped + 1;
        v_failures := v_failures || jsonb_build_object(
          'signal_id', v_sig.id, 'stage', 'close-skipped',
          'error', 'harga konversi untuk ' || v_sig.pair || ' belum tersedia');
      else
        v_profit := round(
          abs(v_close_price - v_sig.entry)
          * v_sig.lot_size
          * public.contract_size(v_sig.pair)
          * v_conv, 2);
        if not v_is_win then
          v_profit := -v_profit;
        end if;
        v_pips := round(
          (case when v_sig.direction = 'SELL' then -1 else 1 end)
          * (v_close_price - v_sig.entry)
          / public.pip_size(v_sig.pair), 2);
        v_r := case when v_is_win then
            round(
              abs(v_sig.take_profit - v_sig.entry)
              / nullif(abs(v_sig.entry - v_sig.stop_loss), 0), 4)
          else -1 end;
        v_hold := greatest(0,
          floor(extract(epoch from (v_now - coalesce(v_sig.activated_at, v_sig.created_at))) / 60)
        )::integer;

        update public.signals
        set status = case when v_is_win then 'WIN' else 'LOSS' end,
            close_price = v_close_price,
            profit_usd = v_profit,
            profit_pips = v_pips,
            r_value = v_r,
            holding_minutes = v_hold,
            closed_at = v_now,
            version = version + 1,
            updated_at = v_now
        where id = v_sig.id
          and status = 'AKTIF'
        returning * into v_new;

        if found then
          -- Salinan ikut tertutup (frontend membagi dari status sinyal).
          update public.copies
          set status = 'closed'
          where signal_id = v_sig.id and status = 'copied';

          insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
          values (v_sig.trader_id, 'signal_close', v_sig.id, to_jsonb(v_sig), to_jsonb(v_new));

          -- Notifikasi hasil ke trader + penyalin (tipe 'tp_sl' sudah
          -- dipetakan frontend). Pesan memakai @username, bukan nama.
          select username into v_username
          from public.traders where profile_id = v_sig.trader_id;
          v_username := coalesce(v_username, 'trader');
          v_title := case when v_is_win
            then 'Sinyal mencapai Take Profit'
            else 'Sinyal mencapai Stop Loss' end;
          v_msg_trader := '@' || v_username || ' ' || v_sig.pair || ' ' || v_sig.direction
            || case when v_is_win then ' mencapai Take Profit: +$' else ' mencapai Stop Loss: -$' end
            || to_char(abs(v_profit), 'FM999999990.00')
            || ' (' || case when v_is_win then '+' else '' end
            || to_char(v_r, 'FM999990.00') || 'R).';
          v_msg_copy := '@' || v_username || ' ' || v_sig.pair || ' ' || v_sig.direction
            || ' yang Anda salin'
            || case when v_is_win then ' mencapai Take Profit: +$' else ' mencapai Stop Loss: -$' end
            || to_char(abs(v_profit), 'FM999999990.00')
            || ' (' || case when v_is_win then '+' else '' end
            || to_char(v_r, 'FM999990.00') || 'R).';

          insert into public.notifications (user_id, type, title, message, signal_id)
          values (v_sig.trader_id, 'tp_sl', v_title, v_msg_trader, v_sig.id);

          insert into public.notifications (user_id, type, title, message, signal_id)
          select c.follower_id, 'tp_sl', v_title, v_msg_copy, v_sig.id
          from public.copies c
          where c.signal_id = v_sig.id
            and c.follower_id <> v_sig.trader_id;

          -- Terapkan ke saldo/level trader (gagal -> sinyal tetap AKTIF,
          -- blok exception di bawah mengembalikan subtransaksi ini).
          v_recalc := public.recalc_trader_progress(v_sig.trader_id, v_sig.id);
          if (v_recalc ->> 'ok') <> 'true' then
            raise exception 'recalc gagal: %', (v_recalc ->> 'code');
          end if;

          if v_is_win then
            v_wins := v_wins + 1;
          else
            v_losses := v_losses + 1;
          end if;
          v_ok := true;
        end if;
      end if;
    exception when others then
      v_failures := v_failures || jsonb_build_object(
        'signal_id', v_sig.id, 'stage', 'close', 'error', sqlerrm);
    end;
  end loop;

  -- -------------------------------------------------------------------------
  -- 3. Pair terbuka yang harganya hilang/basi (info, bukan galat).
  -- -------------------------------------------------------------------------
  select coalesce(array_agg(distinct s.pair), '{}'::text[])
  into v_stale_pairs
  from public.signals s
  left join public.prices pr
    on pr.pair = s.pair
   and pr.fetched_at >= v_now - v_fresh
  where s.status in ('PENDING', 'AKTIF')
    and pr.pair is null;

  insert into public.settlement_runs (summary)
  values (jsonb_build_object(
    'ok', true,
    'run_at', v_now,
    'activated', v_activated,
    'wins', v_wins,
    'losses', v_losses,
    'expired', v_expired,
    'skipped_no_conversion', v_skipped,
    'stale_pairs', to_jsonb(v_stale_pairs),
    'failures', v_failures
  ));

  return jsonb_build_object(
    'ok', true,
    'run_at', v_now,
    'activated', v_activated,
    'wins', v_wins,
    'losses', v_losses,
    'expired', v_expired,
    'skipped_no_conversion', v_skipped,
    'stale_pairs', to_jsonb(v_stale_pairs),
    'failures', v_failures
  );
end;
$func$;
