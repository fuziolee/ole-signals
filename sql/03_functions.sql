-- ============================================================================
-- OLE Signals — 03_functions.sql
-- Fungsi keamanan (SECURITY DEFINER, dipanggil via RPC). Jalankan SETELAH
-- 02_rls.sql. TIDAK ADA tulis langsung dari klien ke tabel — semua tulis
-- sinyal lewat fungsi di file ini.
--
-- Model keamanan (perintah user: "keamanan yang utama"):
--   * Setiap fungsi memeriksa auth.uid() dan kepemilikan sebelum apa pun.
--   * Semua validasi bisnis ditegakkan DI SINI (server-side), bukan di form.
--   * Aturan berbasis jumlah (batas 2 per pair) diperiksa + ditulis dalam
--     SATU transaksi, dengan kunci baris trader_progress (SELECT ... FOR
--     UPDATE) yang menyerikan semua tulis sinyal SATU trader — dua
--     permintaan bersamaan tidak bisa menghasilkan sinyal ke-3 (T-02/T-08).
--   * Jam server saja (now()) — tidak pernah memakai jam klien (AC-GEN-02).
--   * Setiap create/update/cancel menulis baris audit_log (AC-GEN-06).
--   * Kunci idempotensi pada create (AC-GEN-05 / T-09).
--   * Kode galat stabil + pesan Indonesia siap tampil (AC-GEN-07).
--     Bentuk kembalian: {"ok": true|false, "code": "...",
--                        "message": "...", "signal": {...} | null}
--     Pemetaan HTTP (Edge Function / frontend): pairlimit/notpending/
--     conflict/taken -> 409; rr/risk/invalid/needusername -> 422.
--   * "Batal ubah" tetap di Ruang Kerja (keputusan user) — urusan frontend,
--     bukan SQL; dicatat di sini supaya tidak dicari di database.
--
-- Panggil dari frontend (Supabase JS):
--   supabase.rpc('create_signal', { p_pair, p_direction, p_entry,
--     p_stop_loss, p_take_profit, p_lot, p_idempotency_key })
--   supabase.rpc('update_signal', { p_signal_id, p_pair, p_direction,
--     p_entry, p_stop_loss, p_take_profit, p_lot, p_version })
--   supabase.rpc('cancel_signal', { p_signal_id })
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pembantu kecil
-- ---------------------------------------------------------------------------

-- Bangun jawaban galat standar.
create or replace function public.api_error(p_code text, p_message text)
returns jsonb
language sql
immutable
as $func$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message);
$func$;

-- Ringkasan sinyal untuk jawaban RPC (tanpa kolom internal yang tidak perlu).
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

-- Daftar pair yang didukung (§6 blueprint). XAGUSD belum masuk: ukuran
-- kontraknya belum diputuskan — tambahkan setelah diputuskan produk.
create or replace function public.is_allowed_pair(p_pair text)
returns boolean
language sql
immutable
as $func$
  select p_pair in (
    'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD',
    'USDCHF', 'NZDUSD', 'USDCAD', 'EURJPY', 'EURGBP'
  );
$func$;

-- Ukuran kontrak (§5): XAUUSD 100 oz, forex 100.000 unit.
create or replace function public.contract_size(p_pair text)
returns numeric
language sql
immutable
as $func$
  select case when p_pair = 'XAUUSD' then 100::numeric else 100000::numeric end;
$func$;

-- Nilai USD dari 1 unit mata uang quote pair, dari tabel prices.
-- Contoh: EURUSD -> 1 (quote USD); USDJPY -> 1 / harga USDJPY;
-- GBPJPY -> 1 / harga USDJPY; EURGBP -> harga GBPUSD.
-- NULL bila harga konversi belum tersedia (fetcher belum jalan).
create or replace function public.quote_to_usd(p_pair text)
returns numeric
language sql
stable
as $func$
  select case right(p_pair, 3)
    when 'USD' then 1::numeric
    when 'JPY' then 1::numeric / nullif((select price from public.prices where pair = 'USDJPY'), 0)
    when 'GBP' then (select price from public.prices where pair = 'GBPUSD')
    when 'EUR' then (select price from public.prices where pair = 'EURUSD')
    when 'AUD' then (select price from public.prices where pair = 'AUDUSD')
    when 'CHF' then 1::numeric / nullif((select price from public.prices where pair = 'USDCHF'), 0)
    when 'NZD' then (select price from public.prices where pair = 'NZDUSD')
    when 'CAD' then 1::numeric / nullif((select price from public.prices where pair = 'USDCAD'), 0)
    else null
  end;
$func$;

-- ---------------------------------------------------------------------------
-- Kunci per-trader.
-- Memastikan baris trader_progress ada, lalu menguncinya (FOR UPDATE)
-- sampai transaksi RPC selesai. Semua fungsi tulis sinyal memanggil ini
-- DULU, sehingga dua permintaan bersamaan untuk trader yang sama antre
-- dan tidak bisa sama-sama lolos cek batas pair (AC-PAIR-06 / T-08).
-- ---------------------------------------------------------------------------
create or replace function public.lock_trader_progress(p_trader_id uuid)
returns public.trader_progress
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row public.trader_progress%rowtype;
begin
  insert into public.trader_progress (trader_id)
  values (p_trader_id)
  on conflict (trader_id) do nothing;

  select * into v_row
  from public.trader_progress
  where trader_id = p_trader_id
  for update;

  return v_row;
end;
$func$;

-- ---------------------------------------------------------------------------
-- Trigger: profil otomatis saat akun Auth dibuat (pola standar Supabase).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'trader'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$func$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Trigger: baris trader_progress dibuat otomatis saat identitas trader dibuat
-- (level 1, saldo $10.000, acuan $10.000 — §5).
-- ---------------------------------------------------------------------------
create or replace function public.ensure_trader_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
begin
  insert into public.trader_progress (trader_id)
  values (new.profile_id)
  on conflict (trader_id) do nothing;
  return new;
end;
$func$;

drop trigger if exists trg_ensure_trader_progress on public.traders;
create trigger trg_ensure_trader_progress
  after insert on public.traders
  for each row execute function public.ensure_trader_progress();

-- ---------------------------------------------------------------------------
-- setup_trader_identity — buat/lengkapi identitas trader pemanggil.
-- Dipanggil sekali setelah daftar (sebelum posting pertama). Mengembalikan
-- 'needusername' di create_signal bila belum dipanggil.
-- Ronde 6b: menulis traders.username (username TRADER) dan TIDAK PERNAH
-- menyentuh profiles.username (username FOLLOWER). Keunikan ditegakkan
-- per-jenis: username trader yang sudah dipakai trader LAIN ditolak
-- (kode 'taken' -> 409); string yang sama dengan username follower
-- (milik siapa pun) BOLEH dipakai sebagai username trader (prototipe).
-- ---------------------------------------------------------------------------
create or replace function public.setup_trader_identity(
  p_username text,
  p_display_name text,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_username text := nullif(btrim(p_username), '');
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  if v_username is null
     or v_username !~ '^[A-Za-z0-9_][A-Za-z0-9_.]{2,29}$' then
    return public.api_error(
      'invalid',
      'Username 3–30 karakter: huruf, angka, garis bawah, dan titik.'
    );
  end if;

  if public.is_reserved_username(v_username) then
    return public.api_error(
      'invalid',
      'Username tidak boleh dipakai (nama yang dilindungi).'
    );
  end if;

  -- Keunikan PER-JENIS (ronde 6b): hanya traders.username yang diperiksa.
  -- Username follower (profiles.username) tidak diperiksa di sini — string
  -- yang sama dengan username follower siapa pun BOLEH dipakai sebagai
  -- username trader. Pengecekan ini hanya menentukan apakah stringnya
  -- sudah dipakai sebagai username trader; tidak membocorkan data lain.
  if exists (
    select 1 from public.traders
    where username = v_username and profile_id <> v_actor
  ) then
    return public.api_error('taken', 'Username trader sudah dipakai. Pilih username lain.');
  end if;

  -- Profil follower TIDAK disentuh: username follower (profiles.username)
  -- bukan urusan fungsi ini. Upsert di bawah hanya melengkapi baris profil
  -- (display name / avatar) bila belum ada; tidak pernah menulis username.
  insert into public.profiles (id, display_name, avatar_url)
  values (v_actor, nullif(btrim(p_display_name), ''), p_avatar_url)
  on conflict (id) do update set
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  insert into public.traders (profile_id, username, trader_display_name, trader_avatar_url)
  values (
    v_actor,
    v_username,
    coalesce(nullif(btrim(p_display_name), ''), v_username),
    p_avatar_url
  )
  on conflict (profile_id) do update set
    username = excluded.username,
    trader_display_name = excluded.trader_display_name,
    trader_avatar_url = coalesce(excluded.trader_avatar_url, public.traders.trader_avatar_url);

  return jsonb_build_object(
    'ok', true, 'code', 'ok', 'trader_id', v_actor, 'username', v_username
  );
exception
  when unique_violation then
    -- Balapan dua pengguna mengambil username trader yang sama: kembalikan
    -- jawaban bersih, bukan galat Postgres. Satu-satunya unique yang bisa
    -- terlanggar di sini adalah traders_username_uidx (profiles.username
    -- tidak lagi ditulis fungsi ini).
    return public.api_error('taken', 'Username trader sudah dipakai. Pilih username lain.');
end;
$func$;

-- ---------------------------------------------------------------------------
-- get_my_kyc_status — status KYC pemanggil (dipakai Profil akun).
-- CATATAN: kolom kyc_* JUGA bisa dibaca lewat SELECT publik pada profiles
-- (kebijakan RLS di 02_rls.sql). Itu disengaja untuk kyc_status /
-- kyc_full_name (badge Terverifikasi + nama profil memang tampil publik).
-- kyc_reference hanyalah ID sesi Zyphe (bukan kredensial — tanpa kunci API
-- Zyphe tidak bisa dipakai untuk apa pun) dan kyc_reject_reason hanya teks
-- alasan penolakan. Bila nanti diputuskan kedua kolom itu harus rahasia,
-- pindahkan ke tabel terpisah dengan RLS owner-only (lihat README).
-- ---------------------------------------------------------------------------
create or replace function public.get_my_kyc_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_p public.profiles%rowtype;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  select * into v_p from public.profiles where id = v_actor;
  if not found then
    return public.api_error('invalid', 'Profil tidak ditemukan.');
  end if;

  return jsonb_build_object(
    'ok', true,
    'kyc_status', v_p.kyc_status,
    'kyc_full_name', v_p.kyc_full_name,
    'kyc_provider', v_p.kyc_provider,
    'kyc_reference', v_p.kyc_reference,
    'kyc_reject_reason', v_p.kyc_reject_reason,
    'kyc_submitted_at', v_p.kyc_submitted_at,
    'kyc_verified_at', v_p.kyc_verified_at
  );
end;
$func$;

-- ============================================================================
-- create_signal — POST /signals (AC-PAIR-01, AC-EDIT-03, AC-GEN-04/05/06)
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

-- ============================================================================
-- update_signal — PATCH /signals/{id} (AC-PAIR-02/03, AC-EDIT-01..09)
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

-- ============================================================================
-- cancel_signal — POST /signals/{id}/cancel (AC-CANCEL-01..06)
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
  -- permintaan masuk, di bawah kunci — bila entry tersentuh di antara
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
  insert into public.notifications (user_id, type, title, message, signal_id)
  select
    c.follower_id,
    'signal_cancelled',
    'Sinyal yang Anda salin dibatalkan',
    'Sinyal ' || v_new.pair || ' ' || v_new.direction
      || ' dibatalkan oleh @'
      || coalesce((select username from public.traders where profile_id = v_actor), 'trader')
      || '. Jangan eksekusi sinyal ini.',
    v_new.id
  from public.copies c
  where c.signal_id = v_new.id and c.follower_id <> v_actor;

  return jsonb_build_object(
    'ok', true, 'code', 'ok', 'signal', public.signal_to_jsonb(v_new)
  );
end;
$func$;

-- ============================================================================
-- mark_signal_shared — POST /signals/{id}/share (R9-4)
-- Menandai sinyal sebagai sudah dibagikan (set shared_at). Setelah ditandai,
-- update_signal menolak edit (kode 'shared') — isi yang dibagikan tidak
-- boleh diganti setelah dibagikan. Idempotent: memanggil dua kali tetap
-- sukses. Hanya pemilik sinyal yang boleh menandai.
-- ============================================================================
create or replace function public.mark_signal_shared(p_signal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_old public.signals%rowtype;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
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

  if v_old.shared_at is null then
    update public.signals set shared_at = now() where id = p_signal_id;
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$func$;

-- ---------------------------------------------------------------------------
-- Hak eksekusi RPC: hanya pengguna login (authenticated). Publik anon
-- tidak boleh memanggil fungsi tulis. Fungsi bantu (api_error,
-- signal_to_jsonb, quote_to_usd, dst.) sengaja TIDAK diberi grant —
-- hanya bisa dipanggil dari dalam fungsi SECURITY DEFINER di atas.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_signal(text, text, numeric, numeric, numeric, numeric, text) from public;
grant execute on function public.create_signal(text, text, numeric, numeric, numeric, numeric, text) to authenticated;

revoke execute on function public.update_signal(uuid, text, text, numeric, numeric, numeric, numeric, integer) from public;
grant execute on function public.update_signal(uuid, text, text, numeric, numeric, numeric, numeric, integer) to authenticated;

revoke execute on function public.cancel_signal(uuid) from public;
grant execute on function public.cancel_signal(uuid) to authenticated;

revoke execute on function public.mark_signal_shared(uuid) from public;
grant execute on function public.mark_signal_shared(uuid) to authenticated;

revoke execute on function public.setup_trader_identity(text, text, text) from public;
grant execute on function public.setup_trader_identity(text, text, text) to authenticated;

revoke execute on function public.get_my_kyc_status() from public;
grant execute on function public.get_my_kyc_status() to authenticated;
