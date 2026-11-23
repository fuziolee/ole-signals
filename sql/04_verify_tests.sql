-- ============================================================================
-- OLE Signals — 04_verify_tests.sql
-- Tes verifikasi T-01..T-07, T-09..T-12 + RLS terhadap database live.
-- Jalankan di Supabase SQL Editor (project ole-signals) SETELAH 03_functions.
-- T-11/T-12 (23 Nov 2026): validasi lot (§12 bug #4) dan kode 'pair'
-- untuk pair tidak dikenal (§12 bug #5).
--
-- User uji A/B dibuat langsung di auth.users (akun uji, dihapus di
-- 05_verify_cleanup.sql). Autentikasi ditiru lewat request.jwt.claims
-- (pola standar Supabase untuk menguji auth.uid() dari SQL Editor).
-- Setiap tes mencatat PASS/FAIL ke tabel temp test_results; satu tes gagal
-- TIDAK menghentikan tes lain. Hasil dibaca di SELECT terakhir.
-- T-08 (konkurensi) TIDAK di sini — dijalankan dari dua tab SQL Editor
-- terpisah (lihat instruksi tugas browser); file ini hanya menyiapkan
-- 1 sinyal GBPJPY untuk T-08.
-- ============================================================================

create extension if not exists pgcrypto;

drop table if exists test_results;
create temp table test_results (
  test text primary key,
  status text not null,
  detail text not null default ''
);

create or replace function pg_temp.check(p_test text, p_ok boolean, p_detail text)
returns void
language plpgsql
as $func$
begin
  insert into test_results values (p_test, case when p_ok then 'PASS' else 'FAIL' end, p_detail)
  on conflict (test) do update set status = excluded.status, detail = excluded.detail;
end;
$func$;

-- ---------------------------------------------------------------------------
-- SETUP: bersihkan sisa run sebelumnya, buat user uji A + B, harga, identitas
-- (hapus auth.users ikut menghapus profiles/traders/signals via CASCADE;
-- audit_log harus dihapus manual karena actor_id tanpa FK)
-- ---------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
begin
  delete from public.audit_log where actor_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
  delete from public.prices where pair in ('USDJPY','XAUUSD');
  delete from auth.users where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

  insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role, created_at, updated_at)
  values
    ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','test-a@ole-signals.local', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now()),
    ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','test-b@ole-signals.local', crypt('Test1234!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated', now(), now());

  insert into public.prices (pair, price) values ('USDJPY', 150.00), ('XAUUSD', 3000.00);

  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  v_r := public.setup_trader_identity('trader_a', 'Trader A');
  if (v_r->>'ok') <> 'true' then raise exception 'setup A gagal: %', v_r::text; end if;
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}', false);
  v_r := public.setup_trader_identity('trader_b', 'Trader B');
  if (v_r->>'ok') <> 'true' then raise exception 'setup B gagal: %', v_r::text; end if;

  perform pg_temp.check('SETUP', true, 'user A+B + harga USDJPY 150 + XAUUSD 3000 + identitas trader dibuat');
exception when others then
  perform pg_temp.check('SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-01: A buat 2 sinyal XAUUSD PENDING -> ok; sinyal ke-3 -> pairlimit
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; r3 jsonb; n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  r1 := public.create_signal('XAUUSD','BUY',3000,2990,3020,0.01,'t01-a');
  r2 := public.create_signal('XAUUSD','BUY',3010,3000,3030,0.01,'t01-b');
  r3 := public.create_signal('XAUUSD','SELL',2990,3000,2970,0.01,'t01-c');
  select count(*) into n from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status in ('PENDING','AKTIF');
  perform pg_temp.check('T-01', (r1->>'ok')='true' and (r2->>'ok')='true' and (r3->>'code')='pairlimit' and n=2,
    'r1='||coalesce(r1->>'code','?')||' r2='||coalesce(r2->>'code','?')||' r3='||coalesce(r3->>'code','?')||' open='||n);
exception when others then
  perform pg_temp.check('T-01', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-02: A buat 1 EURUSD, lalu pindah ke XAUUSD (sudah 2) -> pairlimit
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; n int; v_id uuid; v_ver int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  r1 := public.create_signal('EURUSD','BUY',1.1000,1.0950,1.1100,0.1,'t02-a');
  select id, version into v_id, v_ver from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='EURUSD' and status='PENDING' order by created_at desc limit 1;
  r2 := public.update_signal(v_id,'XAUUSD','BUY',3000,2990,3020,0.01,v_ver);
  select count(*) into n from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status in ('PENDING','AKTIF');
  perform pg_temp.check('T-02', (r1->>'ok')='true' and (r2->>'code')='pairlimit' and n=2,
    'buat EURUSD='||coalesce(r1->>'code','?')||' pindah ke XAUUSD='||coalesce(r2->>'code','?')||' open XAUUSD='||n);
exception when others then
  perform pg_temp.check('T-02', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-03: ubah sinyal di pair yang sudah berisi 2 TANPA ganti pair -> ok
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; v_id uuid; v_ver int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  -- Nilai edit DIPILIH supaya sinyal TETAP PENDING: harga XAUUSD saat ini
  -- 3000; untuk BUY, entry harus DI BAWAH harga (3000 > entry) agar belum
  -- tersentuh (AC-EDIT-07). Nilai lama (entry 3005) membuat harga 3000 <=
  -- entry sehingga sinyal langsung AKTIF — itu bug SKRIP TES, bukan produk.
  select id, version into v_id, v_ver from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='PENDING' and entry=3010 limit 1;
  r := public.update_signal(v_id,'XAUUSD','BUY',2990,2980,3010,0.01,v_ver);
  perform pg_temp.check('T-03', (r->>'ok')='true',
    'edit tanpa ganti pair: '||coalesce(r->>'code','?')||' '||coalesce(r->>'message',''));
exception when others then
  perform pg_temp.check('T-03', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-04: ubah sinyal ke pair yang berisi 1 sinyal -> ok
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; n_gbp int; n_eur int; v_id uuid; v_ver int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  r1 := public.create_signal('GBPUSD','BUY',1.2700,1.2650,1.2800,0.1,'t04-a');
  select id, version into v_id, v_ver from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='EURUSD' and status='PENDING' order by created_at desc limit 1;
  r2 := public.update_signal(v_id,'GBPUSD','BUY',1.2700,1.2650,1.2800,0.1,v_ver);
  select count(*) into n_gbp from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='GBPUSD' and status in ('PENDING','AKTIF');
  select count(*) into n_eur from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='EURUSD' and status in ('PENDING','AKTIF');
  perform pg_temp.check('T-04', (r1->>'ok')='true' and (r2->>'ok')='true' and n_gbp=2 and n_eur=0,
    'buat GBPUSD='||coalesce(r1->>'code','?')||' pindah EURUSD->GBPUSD='||coalesce(r2->>'code','?')||' open GBPUSD='||n_gbp||' open EURUSD='||n_eur);
exception when others then
  perform pg_temp.check('T-04', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-05: sinyal jadi AKTIF (entry tersentuh harga) lalu update/cancel -> notpending
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; r3 jsonb; v_id uuid; v_ver int; v_st text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  select id, version into v_id, v_ver from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='PENDING' and entry=3000 limit 1;
  r1 := public.update_signal(v_id,'XAUUSD','BUY',3000,2990,3020,0.01,v_ver);
  select status into v_st from public.signals where id=v_id;
  r2 := public.update_signal(v_id,'XAUUSD','BUY',3000,2990,3020,0.01,v_ver+1);
  r3 := public.cancel_signal(v_id);
  perform pg_temp.check('T-05', (r1->>'ok')='true' and v_st='AKTIF' and (r2->>'code')='notpending' and (r3->>'code')='notpending',
    'aktivasi='||coalesce(r1->>'code','?')||' status='||coalesce(v_st,'?')||' update AKTIF='||coalesce(r2->>'code','?')||' cancel AKTIF='||coalesce(r3->>'code','?'));
exception when others then
  perform pg_temp.check('T-05', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-06: batalkan satu PENDING -> ok; buat baru di pair itu -> ok (kuota pulih);
-- sinyal batal tidak terlihat B, tapi barisnya tetap ada (CANCELLED)
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; v_id uuid; n_b int; v_st text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  select id into v_id from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='PENDING' limit 1;
  if v_id is null then
    perform pg_temp.check('T-06', false, 'tidak ada sinyal XAUUSD PENDING — prasyarat gagal (cek T-03/T-05)');
    return;
  end if;
  r1 := public.cancel_signal(v_id);
  r2 := public.create_signal('XAUUSD','BUY',3010,3000,3030,0.01,'t06-new');
  execute 'set role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}', false);
  select count(*) into n_b from public.signals where id = v_id;
  execute 'reset role';
  select status into v_st from public.signals where id = v_id;
  perform pg_temp.check('T-06', (r1->>'ok')='true' and (r2->>'ok')='true' and n_b=0 and v_st='CANCELLED',
    'cancel='||coalesce(r1->>'code','?')||' buat baru='||coalesce(r2->>'code','?')||' B melihat batal='||n_b||' status baris='||coalesce(v_st,'?'));
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.check('T-06', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-07: update dengan p_version basi -> conflict; versi tidak berubah
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; v_id uuid; v_ver int; v_ver_after int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  select id, version into v_id, v_ver from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='PENDING' limit 1;
  if v_id is null then
    perform pg_temp.check('T-07', false, 'tidak ada sinyal XAUUSD PENDING — prasyarat gagal (cek T-03/T-05)');
    return;
  end if;
  r := public.update_signal(v_id,'XAUUSD','BUY',3010,3000,3030,0.01,99);
  select version into v_ver_after from public.signals where id = v_id;
  perform pg_temp.check('T-07', (r->>'code')='conflict' and v_ver_after=v_ver,
    'versi basi='||coalesce(r->>'code','?')||' versi sebelum='||coalesce(v_ver::text,'?')||' sesudah='||coalesce(v_ver_after::text,'?'));
exception when others then
  perform pg_temp.check('T-07', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R-6: B tidak boleh update/cancel sinyal A (cek kepemilikan di RPC)
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; v_id uuid;
begin
  select id into v_id from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='PENDING' limit 1;
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}', false);
  r1 := public.update_signal(v_id,'XAUUSD','BUY',3010,3000,3030,0.01,1);
  r2 := public.cancel_signal(v_id);
  perform pg_temp.check('R-6', (r1->>'code')='invalid' and (r2->>'code')='invalid',
    'B update sinyal A='||coalesce(r1->>'code','?')||' B cancel sinyal A='||coalesce(r2->>'code','?'));
exception when others then
  perform pg_temp.check('R-6', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-08 SETUP: 1 sinyal GBPJPY terbuka; dua tab akan berebut sinyal ke-2
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  r := public.create_signal('GBPJPY','BUY',190.00,189.50,191.00,0.1,'t08-setup');
  perform pg_temp.check('T-08-SETUP', (r->>'ok')='true',
    'sinyal GBPJPY pertama: '||coalesce(r->>'code','?')||' — lanjutkan T-08 dari dua tab');
exception when others then
  perform pg_temp.check('T-08-SETUP', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-09: create dua kali dengan idempotency key sama -> duplicate:true, 1 baris
-- ---------------------------------------------------------------------------
do $$
declare
  r1 jsonb; r2 jsonb; n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  r1 := public.create_signal('EURUSD','BUY',1.1000,1.0950,1.1100,0.1,'t09-key');
  r2 := public.create_signal('EURUSD','BUY',1.1000,1.0950,1.1100,0.1,'t09-key');
  select count(*) into n from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='EURUSD' and status in ('PENDING','AKTIF');
  perform pg_temp.check('T-09', (r1->>'ok')='true' and (r2->>'duplicate')='true' and n=1,
    'panggilan 1='||coalesce(r1->>'code','?')||' panggilan 2 duplicate='||coalesce(r2->>'duplicate','?')||' baris EURUSD='||n);
exception when others then
  perform pg_temp.check('T-09', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-10: audit_log mencatat create/update/cancel dengan before/after data
-- ---------------------------------------------------------------------------
do $$
declare
  v_new uuid; v_upd uuid; v_can uuid; n1 int; n2 int; n3 int;
begin
  select id into v_new from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and idempotency_key='t06-new';
  select id into v_upd from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='AKTIF' limit 1;
  select id into v_can from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and pair='XAUUSD' and status='CANCELLED' limit 1;
  select count(*) into n1 from public.audit_log where signal_id=v_new and action='signal_create' and after_data is not null;
  select count(*) into n2 from public.audit_log where signal_id=v_upd and action='signal_update' and before_data is not null and after_data is not null;
  select count(*) into n3 from public.audit_log where signal_id=v_can and action='signal_cancel' and before_data is not null and after_data is not null;
  perform pg_temp.check('T-10', n1>=1 and n2>=1 and n3>=1,
    'audit create='||n1||' update='||n2||' cancel='||n3);
exception when others then
  perform pg_temp.check('T-10', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-11 (§12 bug #4): lot 0, negatif, dan NaN ditolak create DAN update;
-- tidak ada sinyal yang tersimpan dari percobaan itu.
-- ---------------------------------------------------------------------------
do $$
declare
  r0 jsonb; rn jsonb; rneg jsonb; rnan jsonb; ru jsonb;
  v_id uuid; v_tmp uuid; n_before int; n_after int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  select count(*) into n_before from public.signals where trader_id='11111111-1111-1111-1111-111111111111';
  r0   := public.create_signal('XAUUSD','BUY',3000,2990,3020,0,'t11-lot0');
  rneg := public.create_signal('XAUUSD','BUY',3000,2990,3020,-0.5,'t11-lotneg');
  rnan := public.create_signal('XAUUSD','BUY',3000,2990,3020,'NaN'::numeric,'t11-lotnan');
  -- Batalkan dulu sinyal GBPUSD yang masih terbuka dari tes sebelumnya,
  -- supaya batas 2/pair tidak memblokir pembuatan sinyal dasar di bawah.
  for v_tmp in
    select id from public.signals
    where trader_id='11111111-1111-1111-1111-111111111111'
      and pair='GBPUSD' and status in ('PENDING','ACTIVE')
  loop
    perform public.cancel_signal(v_tmp);
  end loop;
  -- Update: buat satu PENDING GBPUSD dulu, lalu coba ubah lot-nya jadi 0.
  ru := public.create_signal('GBPUSD','BUY',1.2700,1.2680,1.2740,0.05,'t11-base');
  select id into v_id from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and idempotency_key='t11-base';
  if v_id is not null then
    ru := public.update_signal(v_id,'GBPUSD','BUY',1.2700,1.2680,1.2740,0,1);
    perform public.cancel_signal(v_id);
  end if;
  select count(*) into n_after from public.signals where trader_id='11111111-1111-1111-1111-111111111111';
  -- n_after = n_before + 1 (sinyal dasar, kini CANCELLED) — tiga create
  -- yang ditolak tidak menambah baris.
  perform pg_temp.check('T-11',
    (r0->>'code')='invalid' and (rneg->>'code')='invalid' and (rnan->>'code')='invalid'
    and (ru->>'code')='invalid' and n_after = n_before + 1,
    'lot0='||coalesce(r0->>'code','?')||' lotneg='||coalesce(rneg->>'code','?')
    ||' lotNaN='||coalesce(rnan->>'code','?')||' updLot0='||coalesce(ru->>'code','?')
    ||' rows '||n_before||'->'||n_after);
exception when others then
  perform pg_temp.check('T-11', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- T-12 (§12 bug #5): pair tidak dikenal mengembalikan kode 'pair'
-- (bukan 'invalid') pada create DAN update.
-- ---------------------------------------------------------------------------
do $$
declare
  rc jsonb; ru jsonb; v_id uuid; v_tmp uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  rc := public.create_signal('XXXYYY','BUY',3000,2990,3020,0.01,'t12-badpair');
  -- Batalkan dulu sinyal GBPUSD yang masih terbuka dari tes sebelumnya,
  -- supaya batas 2/pair tidak memblokir pembuatan sinyal dasar di bawah.
  for v_tmp in
    select id from public.signals
    where trader_id='11111111-1111-1111-1111-111111111111'
      and pair='GBPUSD' and status in ('PENDING','ACTIVE')
  loop
    perform public.cancel_signal(v_tmp);
  end loop;
  perform public.create_signal('GBPUSD','BUY',1.2700,1.2680,1.2740,0.05,'t12-base');
  select id into v_id from public.signals where trader_id='11111111-1111-1111-1111-111111111111' and idempotency_key='t12-base';
  if v_id is not null then
    ru := public.update_signal(v_id,'XXXYYY','BUY',1.2700,1.2680,1.2740,0.05,1);
    perform public.cancel_signal(v_id);
  end if;
  perform pg_temp.check('T-12',
    (rc->>'code')='pair' and (ru->>'code')='pair',
    'create='||coalesce(rc->>'code','?')||' update='||coalesce(ru->>'code','?'));
exception when others then
  perform pg_temp.check('T-12', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R-1: anon TIDAK boleh insert langsung ke signals (RLS / tanpa grant)
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean := false; v_err text := '';
begin
  -- Anon SEJATI seperti PostgREST: klaim role=anon TANPA sub, supaya
  -- auth.uid() = NULL. Klaim user dari tes sebelumnya TIDAK boleh
  -- tertinggal — "anon" dengan klaim A akan melihat data milik A.
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
  begin
    insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size)
    values ('11111111-1111-1111-1111-111111111111','XAUUSD','BUY',3000,2990,3020,0.01);
  exception when others then
    v_blocked := (sqlstate = '42501');
    v_err := sqlstate || ': ' || left(sqlerrm, 140);
  end;
  execute 'reset role';
  perform pg_temp.check('R-1', v_blocked, 'anon insert signals -> ' || coalesce(v_err, 'LOLOS (tidak diblokir!)'));
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.check('R-1', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R-2: authenticated A TIDAK boleh update trader_progress langsung
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean := false; v_err text := '';
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  begin
    update public.trader_progress set balance_usd = 999999 where trader_id = '11111111-1111-1111-1111-111111111111';
  exception when others then
    v_blocked := (sqlstate = '42501');
    v_err := sqlstate || ': ' || left(sqlerrm, 140);
  end;
  execute 'reset role';
  perform pg_temp.check('R-2', v_blocked, 'A update trader_progress -> ' || coalesce(v_err, 'LOLOS (tidak diblokir!)'));
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.check('R-2', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R-3: audit_log hanya terlihat pemiliknya (B melihat 0, A melihat >0)
-- ---------------------------------------------------------------------------
do $$
declare
  n_b int; n_a int;
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}', false);
  select count(*) into n_b from public.audit_log;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  select count(*) into n_a from public.audit_log;
  execute 'reset role';
  perform pg_temp.check('R-3', n_b = 0 and n_a > 0, 'audit_log: B melihat '||n_b||' baris, A melihat '||n_a);
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.check('R-3', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R-4: authenticated A TIDAK boleh insert langsung ke signals
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked boolean := false; v_err text := '';
begin
  execute 'set role authenticated';
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  begin
    insert into public.signals (trader_id, pair, direction, entry, stop_loss, take_profit, lot_size)
    values ('11111111-1111-1111-1111-111111111111','XAUUSD','BUY',3000,2990,3020,0.01);
  exception when others then
    v_blocked := (sqlstate = '42501');
    v_err := sqlstate || ': ' || left(sqlerrm, 140);
  end;
  execute 'reset role';
  perform pg_temp.check('R-4', v_blocked, 'A insert signals langsung -> ' || coalesce(v_err, 'LOLOS (tidak diblokir!)'));
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.check('R-4', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R-5: anon bisa membaca sinyal publik, tapi TIDAK melihat yang CANCELLED
-- ---------------------------------------------------------------------------
do $$
declare
  n_can int; n_tot int;
begin
  -- Anon SEJATI seperti PostgREST: klaim role=anon TANPA sub, supaya
  -- auth.uid() = NULL. Versi lama memakai `set role anon` dengan klaim
  -- JWT user A masih terpasang — "anon" itu melihat sinyal CANCELLED
  -- milik A (bug HARNESS, bukan produk).
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
  select count(*) into n_can from public.signals where status='CANCELLED';
  select count(*) into n_tot from public.signals;
  execute 'reset role';
  perform pg_temp.check('R-5', n_can=0 and n_tot>0, 'anon melihat '||n_tot||' sinyal, '||n_can||' CANCELLED');
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  perform pg_temp.check('R-5', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- R6B: username trader terpisah dari username follower (ronde 6b).
-- Harus jalan SETELAH migrasi 12 + 03_functions.sql yang baru diterapkan.
-- Ditempatkan di akhir supaya perubahan username B di sini tidak
-- mengganggu tes sinyal di atas (cleanup 05 menghapus akun uji A/B).
-- ---------------------------------------------------------------------------
do $$
declare
  v_r jsonb;
  v_tu text; v_fu text;
begin
  -- 1-2. Username trader A/B tersimpan di traders.username ...
  select username into v_tu from public.traders where profile_id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.check('R6B-1', v_tu='trader_a', 'traders.username A='||coalesce(v_tu,'NULL'));
  select username into v_tu from public.traders where profile_id='22222222-2222-2222-2222-222222222222';
  perform pg_temp.check('R6B-2', v_tu='trader_b', 'traders.username B='||coalesce(v_tu,'NULL'));

  -- 3. ... dan setup TIDAK menyentuh profiles.username (follower).
  select username into v_fu from public.profiles where id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.check('R6B-3', v_fu is null, 'profiles.username A='||coalesce(v_fu,'NULL'));

  -- 4-5. B mengambil username trader A -> 'taken', username B tidak berubah.
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","aud":"authenticated"}', false);
  v_r := public.setup_trader_identity('trader_a', 'Trader B');
  perform pg_temp.check('R6B-4', (v_r->>'code')='taken', 'B ambil trader_a -> '||coalesce(v_r->>'code','?'));
  select username into v_tu from public.traders where profile_id='22222222-2222-2222-2222-222222222222';
  perform pg_temp.check('R6B-5', v_tu='trader_b', 'traders.username B tetap '||coalesce(v_tu,'NULL'));

  -- 6-8. Tapi string yang sama dengan username FOLLOWER boleh dipakai
  -- sebagai username trader (keunikan per-jenis, aturan prototipe).
  update public.profiles set username='pengikut_a' where id='11111111-1111-1111-1111-111111111111';
  v_r := public.setup_trader_identity('pengikut_a', 'Trader B');
  perform pg_temp.check('R6B-6', (v_r->>'ok')='true', 'B ambil pengikut_a (username follower A) -> '||coalesce(v_r->>'code','?'));
  select username into v_tu from public.traders where profile_id='22222222-2222-2222-2222-222222222222';
  perform pg_temp.check('R6B-7', v_tu='pengikut_a', 'traders.username B='||coalesce(v_tu,'NULL'));
  select username into v_fu from public.profiles where id='11111111-1111-1111-1111-111111111111';
  perform pg_temp.check('R6B-8', v_fu='pengikut_a', 'profiles.username A tetap '||coalesce(v_fu,'NULL'));
exception when others then
  perform pg_temp.check('R6B', false, 'exception: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- HASIL — baca panel Results: semua baris harus PASS kecuali T-08-SETUP
-- yang hanya menyiapkan (T-08 sendiri jalan dari dua tab terpisah)
-- ---------------------------------------------------------------------------
select test, status, detail from test_results order by test;
select count(*) filter (where status = 'PASS') as lolos,
       count(*) filter (where status = 'FAIL') as gagal,
       count(*) as total from test_results;
