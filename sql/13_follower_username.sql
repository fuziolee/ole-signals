-- ============================================================================
-- OLE Signals — 13_follower_username.sql
-- Username follower + nama profil + cooldown username trader (Ronde 7, D05).
--
-- Jalankan di Supabase SQL Editor SETELAH 12_traders_username_split.sql
-- (dan setelah 03_functions.sql, karena file ini MEREDEFINISI
-- setup_trader_identity dari 03 dengan tambahan cooldown — lihat bawah).
-- Idempotent (CREATE OR REPLACE + ADD COLUMN IF NOT EXISTS).
-- TIDAK mengubah data yang sudah ada: kolom baru NULL = belum pernah diubah
-- = tidak ada cooldown yang berjalan.
--
-- KEPUTUSAN DESAIN (didokumentasikan, bukan diam-diam):
-- 1. Penyimpanan cooldown = KOLOM baru (bukan tabel baru): satu stempel
--    waktu per baris (profiles.username_changed_at,
--    profiles.display_name_changed_at, traders.username_changed_at).
--    Alasan: cooldown melekat pada satu baris pemiliknya, dibaca dalam
--    satu SELECT yang sama dengan pengecekan taken — tanpa join/tabel
--    tambahan, tanpa migrasi data.
-- 2. "1× sebulan" = interval '1 month' Postgres dari perubahan terakhir
--    (bukan 30 hari tetap, bukan bulan kalender). Pesan galat menyertakan
--    tanggal bisa-diubah-lagi (YYYY-MM-DD) supaya klien bisa menampilkannya.
-- 3. Penetapan PERTAMA tidak memulai cooldown (changed_at tetap NULL):
--    cooldown hanya berjalan bila ada username/nama LAMA yang berbeda yang
--    diganti. Alasan: "username sekali + cooldown 1×/bulan" mengatur
--    PERUBAHAN, bukan penetapan awal.
-- 4. Regex format SAMA dengan setup_trader_identity
--    ('^[A-Za-z0-9_][A-Za-z0-9_.]{2,29}$') — konsisten dengan CHECK yang
--    sudah ada di 12; sedikit berbeda dari prototipe (prototipe melarang
--    titik dan memakai /^[a-z0-9_]{3,30}$/i). Perbedaan ini disengaja
--    supaya aturan live tidak bertabrakan dengan data yang sudah ada.
-- 5. Taken dicek case-SENSITIVE (username = v), sama seperti
--    setup_trader_identity dan unique index live. Prototipe case-insensitive;
--    bila mau disamakan, tambah unique index lower() di KEDUA tabel
--    (catatan ronde 6b) — bukan di file ini.
-- 6. Pembebasan akun demo (ronde 34): bila pemanggil punya baris traders
--    dengan is_demo = true, cooldown TIDAK berlaku dan changed_at TIDAK
--    ditulis — akun demo 'kamu' bisa mengubah username/nama berkali-kali.
--    Pembebasan ini HANYA untuk cooldown; validasi format/banned/
--    reserved/taken tetap berlaku untuk semua orang termasuk demo.
-- 7. Daftar kata terlarang (BAD_PARTS/BAD_TOKENS) dan nama dilindungi
--    (RESERVED_PARTS/RESERVED_NAMES) di-port dari prototipe
--    (Signal_Marketplace__34.html baris 2252-2280), termasuk normalisasi
--    leet (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b) dan pemadatan huruf ganda.
--    is_reserved_username() dari 01 tetap dipakai juga (mencakup 'ole',
--    'olesignals', 'signals', 'system', dst. yang tidak ada di prototipe).
-- 8. set_profile_name menolak bila kyc_status = 'verified' (nama profil
--    mengikuti nama KYC — aturan 2026-11-22 17:50 WIB).
-- 9. check_username mengembalikan jsonb (BUKAN TABLE) supaya jawaban RPC
--    PostgREST berupa satu objek {ok, code, message, value} — sama seperti
--    fungsi lain (api_error) dan sesuai ekspektasi js/api.js.
-- ============================================================================

alter table public.profiles
  add column if not exists username_changed_at timestamptz,
  add column if not exists display_name_changed_at timestamptz;

alter table public.traders
  add column if not exists username_changed_at timestamptz;

comment on column public.profiles.username_changed_at is
  'Terakhir kali username follower diubah (cooldown 1×/bulan, Ronde 7). NULL = belum pernah diubah = tidak ada cooldown.';
comment on column public.profiles.display_name_changed_at is
  'Terakhir kali nama profil diubah (cooldown 1×/bulan, Ronde 7). NULL = belum pernah diubah.';
comment on column public.traders.username_changed_at is
  'Terakhir kali username trader diubah (cooldown 1×/bulan, Ronde 7). NULL = belum pernah diubah.';

-- ---------------------------------------------------------------------------
-- username_banned — kata kasar/terlarang (port prototipe, leet-aware).
-- BAD_PARTS: dicari sebagai potongan (setelah '_' dihapus + huruf ganda
-- dipadatkan). BAD_TOKENS: hanya bila berdiri sendiri sebagai satu bagian
-- username (dipisah '_' / angka). Dicek pada bentuk asli + bentuk leet.
-- ---------------------------------------------------------------------------
create or replace function public.username_banned(p_username text)
returns boolean
language plpgsql
immutable
as $func$
declare
  v_low text := lower(p_username);
  v_leet text := translate(lower(p_username), '0134578', 'oieastb');
  bad_parts text[] := array[
    'anjing','anjrit','bangsat','bajingan','brengsek','keparat','sialan',
    'kampret','kontol','memek','ngentot','ngewe','jembut','pantek',
    'pelacur','lonte','jablay','bispak','tolol','goblok','bodoh','dungu',
    'monyet','banci','jancok','jancuk','cebong','kadrun','kampungan',
    'kafir','fuck','shit','bitch','asshole','bastard','pussy','whore',
    'slut','cunt','nigger','nigga','faggot','retard','tranny','chink',
    'motherfucker','nazi','hitler','teroris'
  ];
  bad_tokens text[] := array[
    'asu','babi','bego','tai','tae','cuk','goblog','kimak','pepek',
    'titit','anj','anjg','bgst','kntl','mmk','dick','coon','kike',
    'spic','gook','fag','isis'
  ];
  x text;
  compact text;
  collapsed text;
  w text;
  tk text;
begin
  foreach x in array array[v_low, v_leet] loop
    compact := replace(x, '_', '');
    collapsed := regexp_replace(compact, '(.)\1+', '\1', 'g');
    foreach w in array bad_parts loop
      if position(w in compact) > 0
         or position(regexp_replace(w, '(.)\1+', '\1', 'g') in collapsed) > 0 then
        return true;
      end if;
    end loop;
    foreach tk in array regexp_split_to_array(x, '[_0-9]+') loop
      if tk <> '' and tk = any (bad_tokens) then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$func$;

-- ---------------------------------------------------------------------------
-- username_reserved — nama yang menyerupai admin/support resmi (port prototipe).
-- RESERVED_NAMES: dilarang bila username persis sama (setelah '_' dihapus).
-- RESERVED_PARTS: dilarang bila muncul di bagian mana pun. Dicek pada
-- bentuk asli + bentuk leet. (is_reserved_username() dari 01 tetap dipakai
-- juga di check_username untuk nama 'ole'/'olesignals'/'signals'/dst.)
-- ---------------------------------------------------------------------------
create or replace function public.username_reserved(p_username text)
returns boolean
language sql
immutable
as $func$
  select
    replace(lower(p_username), '_', '') in (
      'administrator','helpdesk','staff','manager','owner','system','root',
      'cs','help','info','service','team','webmaster','signalmarketplace',
      'founder','ceo','security'
    )
    or replace(translate(lower(p_username), '0134578', 'oieastb'), '_', '') in (
      'administrator','helpdesk','staff','manager','owner','system','root',
      'cs','help','info','service','team','webmaster','signalmarketplace',
      'founder','ceo','security'
    )
    or replace(lower(p_username), '_', '') ~ '(admin|support|moderator|official)'
    or replace(translate(lower(p_username), '0134578', 'oieastb'), '_', '') ~ '(admin|support|moderator|official)';
$func$;

-- ---------------------------------------------------------------------------
-- check_username — cek ketersediaan username (dipanggil klien dengan debounce
-- 250 ms dari form username). Mengembalikan jsonb:
--   {ok, code, message, value}
-- code: ok | empty | format | banned | reserved | taken | cooldown | invalid
-- Cooldown hanya bila username LAMA berbeda dan diubah < 1 bulan lalu
-- (kecuali akun demo). Pesan 'cooldown' menyertakan tanggal bisa-diubah-lagi.
-- ---------------------------------------------------------------------------
create or replace function public.check_username(p_kind text, p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v text := regexp_replace(btrim(coalesce(p_username, '')), '^@+', '');
  v_old text;
  v_changed timestamptz;
  v_is_demo boolean := false;
  v_next date;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;
  if p_kind not in ('trader', 'follower') then
    return public.api_error('invalid', 'Jenis username tidak dikenal.');
  end if;
  if v = '' then
    return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'Username belum diisi.', 'value', null);
  end if;
  if v !~ '^[A-Za-z0-9_][A-Za-z0-9_.]{2,29}$' then
    return jsonb_build_object('ok', false, 'code', 'format', 'message', 'Username 3–30 karakter: huruf, angka, garis bawah, dan titik.', 'value', null);
  end if;
  if public.username_banned(v) then
    return jsonb_build_object('ok', false, 'code', 'banned', 'message', 'Username mengandung kata yang tidak diperbolehkan.', 'value', null);
  end if;
  if public.is_reserved_username(v) or public.username_reserved(v) then
    return jsonb_build_object('ok', false, 'code', 'reserved', 'message', 'Username tidak boleh dipakai (nama yang dilindungi).', 'value', null);
  end if;

  if p_kind = 'trader' then
    if exists (select 1 from public.traders where username = v and profile_id <> v_actor) then
      return jsonb_build_object('ok', false, 'code', 'taken', 'message', 'Username sudah dipakai. Pilih username lain.', 'value', null);
    end if;
    select username, username_changed_at into v_old, v_changed
      from public.traders where profile_id = v_actor;
  else
    if exists (select 1 from public.profiles where username = v and id <> v_actor) then
      return jsonb_build_object('ok', false, 'code', 'taken', 'message', 'Username sudah dipakai. Pilih username lain.', 'value', null);
    end if;
    select username, username_changed_at into v_old, v_changed
      from public.profiles where id = v_actor;
  end if;

  select coalesce(is_demo, false) into v_is_demo
    from public.traders where profile_id = v_actor;

  if v_old is not null and v_old <> v
     and v_changed is not null
     and v_changed > now() - interval '1 month'
     and not v_is_demo then
    v_next := (v_changed + interval '1 month')::date;
    return jsonb_build_object('ok', false, 'code', 'cooldown',
      'message', 'Username hanya bisa diubah 1× sebulan. Bisa diubah lagi pada ' || to_char(v_next, 'YYYY-MM-DD') || '.',
      'value', null);
  end if;

  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '', 'value', v);
end;
$func$;

-- ---------------------------------------------------------------------------
-- set_follower_username — tetapkan/ubah username FOLLOWER (profiles.username).
-- Validasi penuh diulang server-side lewat check_username (jangan percaya
-- hasil cek klien). Cooldown 1×/bulan kecuali akun demo (ronde 34).
-- ---------------------------------------------------------------------------
create or replace function public.set_follower_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_chk jsonb;
  v text;
  v_is_demo boolean := false;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;
  v_chk := public.check_username('follower', p_username);
  if (v_chk ->> 'ok') <> 'true' then
    return v_chk;
  end if;
  v := v_chk ->> 'value';

  select coalesce(is_demo, false) into v_is_demo
    from public.traders where profile_id = v_actor;

  insert into public.profiles (id, username)
    values (v_actor, v)
  on conflict (id) do update set
    username = excluded.username,
    username_changed_at = case
      when public.profiles.username is not null
       and public.profiles.username is distinct from excluded.username
       and not v_is_demo
      then now()
      else public.profiles.username_changed_at
    end;

  return jsonb_build_object('ok', true, 'code', 'ok', 'username', v);
exception
  when unique_violation then
    return public.api_error('taken', 'Username sudah dipakai. Pilih username lain.');
end;
$func$;

-- ---------------------------------------------------------------------------
-- set_profile_name — ubah nama profil (profiles.display_name).
-- Cooldown 1×/bulan kecuali akun demo (ronde 34). Ditolak bila KYC sudah
-- terverifikasi (nama profil mengikuti nama KYC).
-- ---------------------------------------------------------------------------
create or replace function public.set_profile_name(p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v text := btrim(coalesce(p_display_name, ''));
  v_old text;
  v_changed timestamptz;
  v_kyc text;
  v_is_demo boolean := false;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;
  if v = '' or length(v) > 80 then
    return public.api_error('invalid', 'Nama profil 1–80 karakter.');
  end if;

  select display_name, display_name_changed_at, kyc_status
    into v_old, v_changed, v_kyc
    from public.profiles where id = v_actor;

  if v_kyc = 'verified' then
    return public.api_error('kyc_locked', 'Nama profil mengikuti nama KYC dan tidak bisa diubah.');
  end if;

  select coalesce(is_demo, false) into v_is_demo
    from public.traders where profile_id = v_actor;

  if v_old is not null and v_old <> v
     and v_changed is not null
     and v_changed > now() - interval '1 month'
     and not v_is_demo then
    return public.api_error('cooldown',
      'Nama profil hanya bisa diubah 1× sebulan. Bisa diubah lagi pada '
      || to_char((v_changed + interval '1 month')::date, 'YYYY-MM-DD') || '.');
  end if;

  insert into public.profiles (id, display_name)
    values (v_actor, v)
  on conflict (id) do update set
    display_name = excluded.display_name,
    display_name_changed_at = case
      when public.profiles.display_name is not null
       and public.profiles.display_name is distinct from excluded.display_name
       and not v_is_demo
      then now()
      else public.profiles.display_name_changed_at
    end;

  return jsonb_build_object('ok', true, 'code', 'ok', 'display_name', v);
end;
$func$;

-- ---------------------------------------------------------------------------
-- setup_trader_identity — REDEFINISI dari 03_functions.sql dengan tambahan
-- cooldown username trader 1×/bulan (Ronde 7, D05). Seluruh isi 03
-- disalin utuh; yang berubah hanya: (a) deklarasi v_old_username /
-- v_old_changed / v_is_demo, (b) blok cooldown setelah cek 'taken',
-- (c) username_changed_at di ON CONFLICT DO UPDATE.
-- Alasan redefinisi di sini (bukan edit 03): 03 SUDAH diterapkan di live;
-- file 13 diterapkan setelah 03 tanpa perlu menerapkan ulang seluruh 03.
-- Bila 03 diterapkan ulang SETELAH 13, cooldown ini HILANG — terapkan
-- ulang 13 sesudahnya (lihat README).
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
  v_old_username text;
  v_old_changed timestamptz;
  v_is_demo boolean := false;
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

  -- Cooldown username trader 1×/bulan (Ronde 7, D05) — kecuali akun demo.
  select username, username_changed_at, coalesce(is_demo, false)
    into v_old_username, v_old_changed, v_is_demo
    from public.traders where profile_id = v_actor;
  if v_old_username is not null and v_old_username <> v_username
     and v_old_changed is not null
     and v_old_changed > now() - interval '1 month'
     and not v_is_demo then
    return public.api_error('cooldown',
      'Username hanya bisa diubah 1× sebulan. Bisa diubah lagi pada '
      || to_char((v_old_changed + interval '1 month')::date, 'YYYY-MM-DD') || '.');
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
    trader_avatar_url = coalesce(excluded.trader_avatar_url, public.traders.trader_avatar_url),
    username_changed_at = case
      when v_old_username is not null
       and v_old_username <> excluded.username
       and not v_is_demo
      then now()
      else public.traders.username_changed_at
    end;

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
-- Hak akses: hanya pengguna masuk yang boleh memanggil RPC ini.
-- (CREATE OR REPLACE mempertahankan grant lama; revoke+grant di sini
-- memastikan state yang benar walau fungsi dibuat baru.)
-- ---------------------------------------------------------------------------
revoke execute on function public.check_username(text, text) from public;
grant execute on function public.check_username(text, text) to authenticated;

revoke execute on function public.set_follower_username(text) from public;
grant execute on function public.set_follower_username(text) to authenticated;

revoke execute on function public.set_profile_name(text) from public;
grant execute on function public.set_profile_name(text) to authenticated;
