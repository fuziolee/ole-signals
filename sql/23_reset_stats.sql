-- ============================================================================
-- OLE Signals — 23_reset_stats.sql
-- Ronde 35 (2026-11-26): reset statistik trader (mekanisme prototipe) +
-- penegakan masa jeda.
--
-- ATURAN (blueprint §5 + prototipe ronde 10/36, diputuskan user 22 Nov 2026
-- 17:42 WIB; scope DIBATALKAN jadi reset-saldo-terpisah oleh user
-- 26 Nov 2026 13:36 WIB — yang dibangun HANYA reset statistik di sini;
-- saldo kembali $10.000 terjadi SEBAGAI BAGIAN dari reset statistik,
-- bukan fitur terpisah; tidak ada tombol reset di panel kanan):
--  * Reset DIIZINKAN maks 1x sebulan; akun demo dibebaskan dari cooldown
--    (cerminkan migrasi 13/16 — demo boleh reset kapan saja, tanpa jeda).
--  * Yang terjadi: SEMUA sinyal trader dihapus (aktif, pending, riwayat);
--    statistik ke nol (saldo $10.000, level 1, R 0, max DD 0);
--    pelanggan dijeda + diberi tahu; trader masuk masa jeda 1 bulan
--    (tidak bisa posting/ubah sinyal, tidak bisa ubah harga langganan,
--    tidak bisa terima pelanggan baru); reset berikutnya tersedia 1 bulan
--    setelah reset terakhir. WAJIB ada dialog konfirmasi di UI (tindakan
--    destruktif; catatan R25).
--  * Salinan follower TIDAK dihapus: sebelum sinyal dihapus, tiap salinan
--    mendapat snapshot JSON sinyalnya (kolom copies.signal_snapshot) dan
--    FK salinan diubah jadi ON DELETE SET NULL — riwayat Jurnal follower
--    tetap tampil (janji Panduan). Salinan yang masih PENDING/AKTIF saat
--    reset tetap tampil di "Salinan aktif" (tidak akan pernah tertutup;
--    follower bisa menghapus salinannya seperti biasa).
--  * Pengembalian dana prorata ke pelanggan DITUNDA bersama fase
--    pembayaran (belum ada dompet/pembayaran di MVP): RPC mengembalikan
--    refund_pending = true dan TIDAK menulis apa pun ke dompet — JANGAN
--    anggap refund sudah terjadi. Panduan menyebut refund "menyusul".
--  * "Terima pelanggan baru" saat jeda: belum ada RPC subscribe di MVP
--    (tabel subscriptions tidak dipakai); helper
--    trader_in_reset_cooldown() disediakan untuk dipakai RPC subscribe
--    nanti — penegakannya dicatat di sini, bukan dipalsukan.
--
-- ISI FILE INI (terapkan SETELAH 22):
--  * trader_progress.last_reset_at + reset_cooldown_until
--  * helper public.trader_in_reset_cooldown(trader_id)
--  * RPC public.reset_trader_stats() (authenticated, SECURITY DEFINER)
--  * subscriptions.status += 'paused'
--  * copies.signal_snapshot jsonb + FK signal_id ON DELETE SET NULL
--    (kolom jadi nullable)
--  * trigger trg_guard_trader_reset_cooldown pada traders (tolak ubah
--    harga langganan selama jeda; 42501; demo bebas; bypass sistem
--    auth.uid() NULL seperti migrasi 16)
--  * create_signal + update_signal versi 22 + penegakan jeda reset
--    (kode 'resetcooldown') — versi TERBARU kedua fungsi ini.
--
-- TIDAK ADA data seed, TIDAK ADA kunci/password di file ini.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Kolom reset di trader_progress (cerminkan resetState prototipe:
-- lastResetAt + cooldownUntil; last_reset_at juga menjadi dasar
-- "reset berikutnya tersedia" = last_reset_at + 1 bulan).
-- ---------------------------------------------------------------------------
alter table public.trader_progress
  add column if not exists last_reset_at timestamptz,
  add column if not exists reset_cooldown_until timestamptz;

comment on column public.trader_progress.last_reset_at is
  'Reset statistik terakhir (Ronde 35). NULL = belum pernah reset.';
comment on column public.trader_progress.reset_cooldown_until is
  'Akhir masa jeda reset (Ronde 35) = last_reset_at + 1 bulan; NULL untuk akun demo (bebas jeda) atau belum pernah reset.';

-- ---------------------------------------------------------------------------
-- Helper: apakah trader sedang dalam masa jeda reset?
-- Dipakai create/update_signal, trigger harga, dan (nanti) RPC subscribe.
-- ---------------------------------------------------------------------------
create or replace function public.trader_in_reset_cooldown(p_trader_id uuid)
returns boolean
language sql
stable
as $func$
  select exists (
    select 1
    from public.trader_progress
    where trader_id = p_trader_id
      and reset_cooldown_until is not null
      and reset_cooldown_until > now()
  );
$func$;

-- ---------------------------------------------------------------------------
-- Langganan bisa dijeda ('paused') — sebelumnya hanya active/cancelled.
-- (Tabel subscriptions belum dipakai di MVP, tapi reset harus bisa
-- menjeda baris yang ada; penambahan nilai ini tidak mengubah perilaku
-- lain.)
-- ---------------------------------------------------------------------------
alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('active', 'paused', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Salinan follower bertahan dari reset (janji Panduan):
--  * copies.signal_snapshot: JSON sinyal apa adanya saat reset
--    (format signal_to_jsonb) — dipakai frontend bila signal_id NULL.
--  * FK signal_id: CASCADE -> SET NULL + kolom jadi nullable.
-- ---------------------------------------------------------------------------
alter table public.copies
  add column if not exists signal_snapshot jsonb;

comment on column public.copies.signal_snapshot is
  'Snapshot sinyal saat trader mereset statistik (Ronde 35). Diisi reset_trader_stats sebelum sinyal dihapus; frontend memakai ini bila signal_id sudah NULL.';

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'copies_signal_id_fkey'
      and conrelid = 'public.copies'::regclass
  ) then
    alter table public.copies drop constraint copies_signal_id_fkey;
  end if;
end $$;
alter table public.copies alter column signal_id drop not null;
alter table public.copies
  add constraint copies_signal_id_fkey
  foreign key (signal_id) references public.signals (id) on delete set null;

-- ============================================================================
-- reset_trader_stats — POST reset statistik (Ronde 35).
-- SECURITY DEFINER; grant ke authenticated (pemilik akun sendiri).
-- Seluruh reset berjalan dalam SATU transaksi: gagal di tengah berarti
-- tidak ada yang berubah.
-- ============================================================================
create or replace function public.reset_trader_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_trader public.traders%rowtype;
  v_progress public.trader_progress%rowtype;
  v_is_demo boolean := false;
  v_deleted integer := 0;
  v_paused integer := 0;
  v_sub_ids uuid[] := '{}';
  v_follower_ids uuid[] := '{}';
  v_cd timestamptz;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  -- Identitas trader harus sudah dibuat.
  select * into v_trader from public.traders where profile_id = v_actor;
  if not found then
    return public.api_error(
      'needusername',
      'Buat username trader terlebih dahulu sebelum mereset statistik.'
    );
  end if;

  -- Kunci per-trader (serialisasi; buat baris progress bila belum ada).
  select * into v_progress from public.lock_trader_progress(v_actor);
  v_is_demo := coalesce(v_trader.is_demo, false);

  -- Batas 1x sebulan (demo dibebaskan — cerminkan 13/16).
  -- Dua kode seperti prototipe: 'resetcooldown' (jeda berjalan) dan
  -- 'resettoosoon' (jeda sudah lewat tapi belum 1 bulan sejak reset
  -- terakhir — backstop bila cooldown_until kosong).
  if not v_is_demo then
    if v_progress.reset_cooldown_until is not null
       and v_progress.reset_cooldown_until > now() then
      return public.api_error(
        'resetcooldown',
        'Anda sedang dalam masa jeda reset sampai '
        || to_char(v_progress.reset_cooldown_until, 'DD Mon YYYY HH24:MI')
        || '.'
      );
    end if;
    if v_progress.last_reset_at is not null
       and v_progress.last_reset_at > now() - interval '1 month' then
      return public.api_error(
        'resettoosoon',
        'Reset berikutnya tersedia '
        || to_char(v_progress.last_reset_at + interval '1 month', 'DD Mon YYYY HH24:MI')
        || '.'
      );
    end if;
  end if;

  -- Kumpulkan pelanggan aktif + follower penyalin SEBELUM sinyal dihapus
  -- (untuk notifikasi; setelah delete, tautannya hilang).
  select coalesce(array_agg(distinct follower_id), '{}')
    into v_sub_ids
  from public.subscriptions
  where trader_id = v_actor and status = 'active';

  select coalesce(array_agg(distinct c.follower_id), '{}')
    into v_follower_ids
  from public.copies c
  join public.signals s on s.id = c.signal_id
  where s.trader_id = v_actor;

  -- Snapshot salinan (supaya riwayat Jurnal follower tetap tampil),
  -- lalu hapus SEMUA sinyal trader (aktif, pending, riwayat).
  -- Salinan TIDAK ikut terhapus (FK SET NULL) — janji Panduan.
  update public.copies c
  set signal_snapshot = public.signal_to_jsonb(s)
  from public.signals s
  where c.signal_id = s.id and s.trader_id = v_actor;

  delete from public.signals where trader_id = v_actor;
  get diagnostics v_deleted = row_count;

  -- Pelanggan aktif -> dijeda. Pengembalian dana prorata DITUNDA bersama
  -- fase pembayaran (belum ada dompet): TIDAK ada penulisan refund di
  -- sini; refund_pending = true di jawaban menandai itu secara jujur.
  update public.subscriptions
  set status = 'paused', updated_at = now()
  where trader_id = v_actor and status = 'active';
  get diagnostics v_paused = row_count;

  -- Statistik ke nol + stempel reset. Demo: cooldown_until NULL (bebas).
  v_cd := case when v_is_demo then null else now() + interval '1 month' end;
  update public.trader_progress set
    level = 1,
    balance_usd = 10000.00,
    level_ref_balance = 10000.00,
    r_since_level = 0,
    trades_since_level = 0,
    peak_balance_usd = 10000.00,
    max_drawdown_usd = 0,
    max_drawdown_pct = 0,
    last_reset_at = now(),
    reset_cooldown_until = v_cd,
    updated_at = now()
  where trader_id = v_actor;

  -- Beri tahu: trader sendiri + pelanggan yang dijeda + penyalin.
  insert into public.notifications (user_id, type, title, message, signal_id)
  values (
    v_actor, 'reset', 'Statistik direset',
    'Statistik Anda direset: ' || v_deleted || ' sinyal dihapus, '
    || v_paused || ' pelanggan dijeda. Masa jeda 1 bulan dimulai.',
    null
  );

  insert into public.notifications (user_id, type, title, message, signal_id)
  select unnest(v_sub_ids), 'reset', 'Trader yang Anda ikuti mereset statistik',
    'Trader yang Anda ikuti mereset statistiknya. Langganan Anda dijeda.',
    null;

  insert into public.notifications (user_id, type, title, message, signal_id)
  select unnest(v_follower_ids), 'reset', 'Trader mereset statistik',
    'Trader yang sinyalnya Anda salin mereset statistiknya. Salinan Anda tetap tersimpan di Jurnal.',
    null;

  -- Jejak audit (signal_id NULL — reset bukan tentang satu sinyal).
  insert into public.audit_log (actor_id, action, signal_id, before_data, after_data)
  values (
    v_actor, 'trader_reset', null,
    jsonb_build_object('deleted_signals', v_deleted, 'paused_subscriptions', v_paused),
    jsonb_build_object('level', 1, 'balance_usd', 10000, 'cooldown_until', v_cd)
  );

  return jsonb_build_object(
    'ok', true, 'code', 'ok',
    'deleted', v_deleted,
    'paused', v_paused,
    'cooldown_until', v_cd,
    'refund_pending', true
  );
end;
$func$;

revoke execute on function public.reset_trader_stats() from public;
grant execute on function public.reset_trader_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: tolak ubah harga langganan selama masa jeda reset.
-- Terpisah dari guard_trader_guards (16) supaya tidak menyalin 150 baris
-- fungsi itu; kedua trigger sama-sama menolak (42501), urutan tidak penting.
-- Bypass sistem (auth.uid() NULL) seperti 16: service_role / postgres.
-- ---------------------------------------------------------------------------
create or replace function public.guard_trader_reset_cooldown()
returns trigger
language plpgsql
as $func$
declare
  v_actor uuid := auth.uid();
  v_is_demo boolean := false;
  v_cd timestamptz;
begin
  if v_actor is null then
    return new;
  end if;
  if TG_OP = 'UPDATE'
     and new.subscription_price_usd is distinct from old.subscription_price_usd
     and new.subscription_price_usd is not null then
    v_is_demo := coalesce(old.is_demo, false);
    if not v_is_demo then
      select reset_cooldown_until into v_cd
      from public.trader_progress
      where trader_id = new.profile_id;
      if v_cd is not null and v_cd > now() then
        raise exception 'Trader sedang dalam masa jeda reset sampai %. Harga langganan tidak bisa diubah.',
          to_char(v_cd, 'YYYY-MM-DD')
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_guard_trader_reset_cooldown on public.traders;
create trigger trg_guard_trader_reset_cooldown
  before update on public.traders
  for each row execute function public.guard_trader_reset_cooldown();

-- ============================================================================
-- create_signal + update_signal versi TERBARU (22 + penegakan jeda reset).
-- Seluruh isi disalin dari sql/22_entry_type.sql; satu-satunya tambahan
-- adalah blok "2b" penegakan jeda (kode 'resetcooldown') di masing-masing
-- fungsi. JANGAN terapkan ulang sql/03 atau sql/22 setelah file ini —
-- akan menghilangkan penegakan jeda.
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
