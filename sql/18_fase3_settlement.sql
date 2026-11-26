-- ============================================================================
-- OLE Signals — 18_fase3_settlement.sql
-- Fase 3: settlement otomatis (PENDING -> AKTIF -> WIN/LOSS) + recalc level.
--
-- Jalankan di SQL Editor SETELAH 01..17. TIDAK ADA data seed, TIDAK ADA
-- kunci/password di file ini. Fungsi di sini SECURITY DEFINER dan HANYA
-- bisa dipanggil service_role (Edge Function settle-signals) — TIDAK ADA
-- grant ke anon/authenticated. Frontend tidak pernah memanggil fungsi ini.
--
-- Desain (keputusan builder, didokumentasikan di laporan Fase 3):
--  * Sentuhan level (polling 15 menit, satu harga fetch per pair per
--    putaran): level dianggap TERSENTUH bila harga hasil fetch SUDAH
--    mencapai/melewatinya — SAMA PERSIS dengan aturan edit AC-EDIT-07
--    (migrasi 14): BUY aktif bila harga <= entry; SELL aktif bila harga
--    >= entry. AKTIF: BUY WIN bila harga >= TP, LOSS bila harga <= SL;
--    SELL WIN bila harga <= TP, LOSS bila harga >= SL. Satu harga tidak
--    bisa menyentuh TP dan SL sekaligus (SL < entry < TP untuk BUY,
--    TP < entry < SL untuk SELL), jadi tidak ada ambiguitas.
--  * Aktivasi + penutupan dalam SATU putaran: bila harga fetch sudah
--    melewati entry DAN TP/SL sekaligus (gap), sinyal diaktifkan lalu
--    langsung ditutup di putaran yang sama (activated_at = closed_at =
--    now(), holding_minutes = 0) — harga terbukti melewati kedua level.
--    Dalam praktik ini SELALU sisi SL (satu harga tidak bisa sekaligus
--    <= entry DAN >= TP untuk BUY, atau >= entry DAN <= TP untuk SELL)
--    — jadi penutupan satu putaran selalu LOSS. Diuji F3-13 (gap-down)
--    dan F3-12 (varian SELL).
--  * close_price = level TP (WIN) / SL (LOSS) — bukan harga fetch.
--    Alasan: TP adalah limit order (terisi di TP), SL adalah stop;
--    dan aturan §5 menetapkan win R = rasio TP:SL. Memakai harga fetch
--    akan membuat r_value menyimpang dari rasio yang direncanakan.
--  * profit_usd = |close - entry| x lot x ukuran_kontrak x quote_to_usd
--    (bertanda + WIN / - LOSS), dibulatkan 2 desimal. profit_pips =
--    pips bertanda / pip_size (XAUUSD 0,1; JPY 0,01; lain 0,0001 —
--    sama persis dengan js/stats.js). r_value = +reward/risk (WIN)
--    atau -1 (LOSS). holding_minutes = menit activated_at -> closed_at.
--  * Harga BASI tidak pernah menutup sinyal: settle hanya memakai baris
--    prices dengan fetched_at <= 30 menit (2x siklus fetch terlewat).
--    Bila XAUS gagal, fetch-prices TIDAK menyentuh baris XAUUSD sehingga
--    fetched_at-nya menua dan pair itu dilewati settle sampai harga segar
--    masuk. TIDAK ADA kolom `stale` — umur fetched_at adalah penandanya.
--  * PENDING kedaluwarsa (expires_at lewat) diubah jadi EXPIRED di
--    putaran settle yang sama dan TIDAK PERNAH diaktifkan — tapi TANPA
--    notifikasi (notifikasi kedaluwarsa adalah Fase 5, di luar cakupan).
--  * recalc_trader_progress bersifat INKREMENTAL untuk state level:
--    baris trader_progress ADALAH state latch (level, r_since_level,
--    trades_since_level). Satu sinyal tertutup menambah R (+rasio / -1)
--    dan +1 trade, lalu cek naik/turun. Saldo + puncak + max DD dihitung
--    ulang PENUH dari semua sinyal tertutup (bukan duplikat) — sama persis
--    dengan js/stats.js (strict >, mulai $10.000) — sehingga saldo
--    selalu = $10.000 + jumlah profit sinyal tertutup. Alasan tidak
--    replay penuh untuk level: replay akan menulis ulang level trader
--    demo yang nilainya diisi manual (ilustratif, sql/10) — state yang
--    tersimpan harus dihormati. Idempotensi: settle hanya memproses
--    sinyal PENDING/AKTIF, jadi satu sinyal hanya bisa tertutup sekali,
--    dalam SATU transaksi dengan pemanggilan recalc-nya. JANGAN panggil
--    recalc manual dua kali untuk sinyal yang sama.
--  * Naik level: saldo >= ref(level+1) DAN R >= +5 DAN trade >= 5.
--    Turun: saldo <= ref(level) x 0,95 DAN R <= -5 (level minimal 1;
--    di lantai 1 kondisi turun yang terpenuhi TIDAK mereset penghitung —
--    reset hanya terjadi saat level BERUBAH, sesuai §5). R direset ke 0
--    tiap kali level berubah, jadi satu close maksimal 1 tingkat.
--  * Sinyal duplicate_flagged TETAP ditutup (tradenya nyata) tapi TIDAK
--    dihitung ke saldo/level (aturan §5). Deteksi duplikasi sendiri
--    adalah Fase 5 — hari ini belum ada sinyal yang bisa tertandai,
--    jadi cabang ini dormant; frontend (computeStats) juga belum
--    menyaringnya — dicatat sebagai item integrasi Fase 5.
--  * Satu sinyal bermasalah tidak boleh menggagalkan seluruh putaran:
--    tiap sinyal diproses dalam blok BEGIN..EXCEPTION sendiri — gagal
--    berarti sinyal itu tetap AKTIF untuk putaran berikut + tercatat di
--    ringkasan failures. Kegagalan yang SUDAH diantisipasi (harga
--    konversi belum ada) dilewati lewat kondisi, bukan exception.
--  * Notifikasi hasil (tipe 'tp_sl' — sudah dipetakan frontend di
--    notifTypeLabel): ke TRADER pemilik + follower yang MENYALIN sinyal
--    itu (bukan semua follower — yang tidak menyalin tidak terdampak).
--    Salinan (copies) sinyal yang tertutup ditandai status='closed'.
--    Frontend membagi salinan aktif/riwayat dari STATUS SINYAL, bukan
--    status salinan — jadi penanda ini aman.
--  * Jejak audit: 'signal_activate' / 'signal_close' / 'signal_expire'
--    (actor = trader pemilik).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pembantu: pip_size (cermin js/stats.js) + level_ref (cermin js/levels.js).
-- ---------------------------------------------------------------------------
create or replace function public.pip_size(p_pair text)
returns numeric
language sql
immutable
as $func$
  select case
    when p_pair = 'XAUUSD' then 0.1::numeric
    when right(p_pair, 3) = 'JPY' then 0.01::numeric
    else 0.0001::numeric
  end;
$func$;

-- Acuan saldo tangga TETAP: ref(L) = $10.000 x 1,05^(L-1).
create or replace function public.level_ref(p_level integer)
returns numeric
language sql
immutable
as $func$
  select round(10000::numeric * power(1.05::numeric, greatest(1, p_level) - 1), 2);
$func$;

-- ---------------------------------------------------------------------------
-- Log putaran settlement (operasional): kapan jalan, apa hasilnya.
-- Hanya service_role yang bisa baca/tulis (RLS aktif, tanpa policy).
-- ---------------------------------------------------------------------------
create table if not exists public.settlement_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  summary jsonb not null default '{}'::jsonb
);
comment on table public.settlement_runs is
  'Log putaran settle-signals (Fase 3). Ditulis fungsi settle_signals; dibaca saat debugging.';
alter table public.settlement_runs enable row level security;

-- ============================================================================
-- recalc_trader_progress — terapkan SATU sinyal tertutup ke state trader.
-- Dipanggil settle_signals() sekali per sinyal yang ditutup, dalam
-- transaksi yang sama. SECURITY DEFINER; hanya service_role.
-- ============================================================================
create or replace function public.recalc_trader_progress(
  p_trader_id uuid,
  p_signal_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_prog public.trader_progress%rowtype;
  v_sig public.signals%rowtype;
  v_sig_r numeric;
  v_bal numeric := 10000;
  v_pk numeric := 10000;
  v_dd numeric;
  v_maxdd numeric := 0;
  v_maxdd_pct numeric := 0;
  v_level integer;
  v_r numeric;
  v_n integer;
  v_balance numeric;
  v_closed record;
begin
  -- Kunci baris progress (buat bila belum ada) — menyerikan dengan
  -- create/update/cancel yang memakai lock_trader_progress yang sama.
  select * into v_prog from public.lock_trader_progress(p_trader_id);

  select * into v_sig from public.signals where id = p_signal_id;
  if not found then
    return public.api_error('invalid', 'Sinyal tidak ditemukan.');
  end if;
  if v_sig.trader_id <> p_trader_id then
    return public.api_error('invalid', 'Sinyal bukan milik trader ini.');
  end if;
  if v_sig.status not in ('WIN', 'LOSS') then
    return public.api_error('notclosed', 'Sinyal belum tertutup.');
  end if;

  -- R sinyal ini (fallback bila r_value kosong: WIN = reward/risk).
  v_sig_r := v_sig.r_value;
  if v_sig_r is null then
    if v_sig.status = 'WIN' then
      v_sig_r := abs(v_sig.take_profit - v_sig.entry)
        / nullif(abs(v_sig.entry - v_sig.stop_loss), 0);
    else
      v_sig_r := -1;
    end if;
  end if;

  -- Saldo + puncak + max DD: replay penuh kurva saldo dari sinyal
  -- tertutup (bukan duplikat), urutan closed_at — SAMA PERSIS dengan
  -- js/stats.js statsFromClosed (strict >, puncak mulai $10.000).
  for v_closed in
    select profit_usd
    from public.signals
    where trader_id = p_trader_id
      and status in ('WIN', 'LOSS')
      and not duplicate_flagged
      and profit_usd is not null
    order by coalesce(closed_at, created_at), created_at, id
  loop
    v_bal := v_bal + v_closed.profit_usd;
    if v_bal > v_pk then
      v_pk := v_bal;
    end if;
    v_dd := v_pk - v_bal;
    if v_dd > v_maxdd then
      v_maxdd := v_dd;
      v_maxdd_pct := v_dd / v_pk * 100;
    end if;
  end loop;
  v_balance := round(v_bal, 2);

  -- State level (inkremental — lihat header file untuk alasannya).
  v_level := v_prog.level;
  v_r := coalesce(v_prog.r_since_level, 0);
  v_n := coalesce(v_prog.trades_since_level, 0);
  if not v_sig.duplicate_flagged then
    v_r := v_r + coalesce(v_sig_r, 0);
    v_n := v_n + 1;

    -- Naik: AND 3 syarat (saldo, R, trade). R + trade direset tiap naik.
    while v_balance >= public.level_ref(v_level + 1)
      and v_r >= 5
      and v_n >= 5
    loop
      v_level := v_level + 1;
      v_r := 0;
      v_n := 0;
    end loop;

    -- Turun: AND 2 syarat (saldo, R). Level minimal 1.
    while v_level > 1
      and v_balance <= public.level_ref(v_level) * 0.95
      and v_r <= -5
    loop
      v_level := v_level - 1;
      v_r := 0;
      v_n := 0;
    end loop;
  end if;

  update public.trader_progress set
    level = v_level,
    balance_usd = v_balance,
    level_ref_balance = public.level_ref(v_level),
    r_since_level = round(v_r, 4),
    trades_since_level = v_n,
    peak_balance_usd = round(v_pk, 2),
    max_drawdown_usd = round(v_maxdd, 2),
    max_drawdown_pct = round(v_maxdd_pct, 4),
    updated_at = now()
  where trader_id = p_trader_id;

  return jsonb_build_object(
    'ok', true, 'code', 'ok',
    'trader_id', p_trader_id,
    'level', v_level,
    'balance_usd', v_balance,
    'r_since_level', round(v_r, 4),
    'trades_since_level', v_n,
    'max_drawdown_usd', round(v_maxdd, 2),
    'skipped_duplicate', v_sig.duplicate_flagged
  );
end;
$func$;

-- ============================================================================
-- settle_signals — satu putaran settlement (dipanggil Edge Function
-- settle-signals tiap harga baru masuk). Satu transaksi: kedaluwarsa,
-- aktivasi, penutupan, notifikasi, audit, salinan, recalc.
-- SECURITY DEFINER; hanya service_role (Edge Function).
-- ============================================================================
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
      and ((s.direction = 'BUY' and pr.price <= s.entry)
        or (s.direction = 'SELL' and pr.price >= s.entry))
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

-- ---------------------------------------------------------------------------
-- Hak eksekusi: HANYA service_role (Edge Function). JANGAN beri grant ke
-- anon/authenticated — fungsi ini menulis saldo/level semua trader.
-- (Service_role melewati RLS; grant eksplisit di bawah ini yang memberi
-- hak eksekusi RPC lewat PostgREST.)
-- ---------------------------------------------------------------------------
revoke execute on function public.pip_size(text) from public;
revoke execute on function public.level_ref(integer) from public;
revoke execute on function public.recalc_trader_progress(uuid, uuid) from public;
revoke execute on function public.settle_signals() from public;

grant execute on function public.recalc_trader_progress(uuid, uuid) to service_role;
grant execute on function public.settle_signals() to service_role;
