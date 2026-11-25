-- ============================================================================
-- OLE Signals — 16_audit_guards.sql
-- Ronde 27 (perbaikan temuan audit pra-Fase 3, 25 Nov 2026).
--
-- APA YANG DIJAGA (dan kenapa):
--   K-1  (KRITIS, audit): policy "profiles_update_own" (02_rls.sql)
--        mengizinkan pemilik mengubah baris profiles-nya sendiri, dan
--        trigger guard_profile_kyc_columns() hanya menjaga kolom kyc_*.
--        Akibatnya pengguna login bisa PATCH `is_admin: true` sendiri
--        dan mengangkat dirinya jadi admin. File ini memperluas penjaga
--        yang sama agar juga menjaga `is_admin`.
--   T-1  (sebagian — baca profiles, BUKAN di file ini): pembatasan baca
--        kolom profiles dikerjakan di migrasi 17 (view profiles_public).
--        File ini TIDAK menyentuh policy SELECT.
--   T-3  (TINGGI, audit): cooldown username 1x/bulan, cooldown nama
--        profil 1x/bulan, dan aturan harga langganan (rentang + gerbang
--        Level 5 + cooldown 1x/bulan) selama ini hanya ditegakkan di
--        RPC (13_follower_username.sql) dan di form klien. PATCH
--        langsung ke REST (melewati RPC) bisa melanggar semuanya.
--        File ini menegakkannya di level trigger, jadi berlaku untuk
--        jalur tulis mana pun dari pengguna login.
--   T-2  (paywall server-side): TIDAK termasuk — gerbang fase pembayaran.
--
-- URUTAN PENERAPAN: jalankan SETELAH 01–15 + r8-notif-fix.sql.
-- File ini HANYA menambah / memperluas trigger:
--   * memperluas guard_profile_kyc_columns() (02) — nama fungsi dan nama
--     trigger trg_guard_profile_kyc_columns TETAP;
--   * fungsi + trigger BARU guard_profile_cooldown_columns() dan
--     guard_trader_guards().
-- File ini TIDAK mendefinisikan ulang RPC apa pun dari 03/13/14/15
-- (set_follower_username, set_profile_name, setup_trader_identity,
--  check_username, dst. tetap seperti sediakala).
--
-- KENAPA RPC RESMI TETAP BERFUNGSI:
-- Trigger menegakkan ATURAN YANG SAMA dengan RPC (bukan aturan berbeda)
-- — cooldown interval '1 month' yang sama, pengecualian demo yang sama,
-- semantik "penetapan pertama tidak memulai cooldown" yang sama, dan
-- pesan galat yang sama. RPC yang menolak (cooldown berjalan, KYC
-- terverifikasi, di bawah Level 5) tidak akan pernah sampai ke trigger;
-- RPC yang mengizinkan (cooldown lewat, demo, penetapan pertama) juga
-- lolos trigger, karena trigger menghitung hal yang sama dari baris yang
-- sama. Trigger tidak bisa — dan tidak perlu — membedakan panggilan RPC
-- vs PATCH langsung: keduanya tunduk pada aturan yang sama.
--
-- BYPASS SISTEM (auth.uid() IS NULL -> RETURN NEW):
-- auth.uid() NULL untuk service_role (Edge Functions / webhook Zyphe)
-- dan postgres (SQL Editor / dashboard) — keduanya tidak punya JWT
-- pengguna. Mereka TETAP BISA menulis kolom-kolom yang dijaga (mis. Zyphe
-- menulis kyc_*, admin menandai is_demo / is_admin lewat dashboard).
-- Pengguna login biasa selalu punya auth.uid() NOT NULL, jadi selalu
-- dijaga. Perhatikan: di dalam RPC SECURITY DEFINER, auth.uid() tetap
-- mengembalikan UID pemanggil (JWT tidak berubah), jadi RPC resmi tetap
-- melewati penjaga ini — lihat "KENAPA RPC RESMI TETAP BERFUNGSI".
--
-- SEMANTIK COOLDOWN (disalin dari 13, bukan aturan baru):
-- "1x sebulan" = interval '1 month' Postgres dari *_changed_at terakhir.
-- Penetapan PERTAMA (nilai lama NULL) TIDAK memulai cooldown dan
-- changed_at tetap NULL. Akun demo (baris traders dengan is_demo = true)
-- dibebaskan dari cooldown DAN changed_at tidak ditulis untuk demo.
-- Bila aturan mengizinkan perubahan, trigger MENSTEMPEL PAKSA
-- new.*_changed_at := now() — nilai kiriman klien diabaikan. Bila aturan
-- bilang "jangan stempel", trigger MEMAKSA new.*_changed_at kembali ke
-- nilai lama — supaya klien tidak bisa menyelundupkan stempel palsu
-- lewat PATCH yang sama.
--
-- KEPUTUSAN DESAIN (dicatat eksplisit, bukan diam-diam):
-- 1. KYC-LOCK di trigger (penegakan aturan LAMA, bukan aturan baru):
--    13 keputusan 8 sudah memutuskan set_profile_name menolak bila
--    kyc_status = 'verified' ("nama profil mengikuti nama KYC"). Trigger
--    di sini menegakkan hal yang sama untuk PATCH langsung. Kunci ini
--    berlaku bahkan untuk penetapan pertama bila kyc sudah verified.
--    CATATAN INTERAKSI: setup_trader_identity (13) ikut meng-upsert
--    display_name ke profiles — bila pengguna KYC-verified / masih
--    cooldown memanggilnya dengan nama yang berbeda, trigger kini akan
--    menolak seluruh RPC. Itu penegakan aturan yang dimaksud; bila
--    nanti RPC-nya perlu diselaraskan (mis. memakai nama KYC), itu
--    pekerjaan file RPC, bukan file ini.
-- 2. is_demo TIDAK BOLEH DIANGKAT SENDIRI: pengguna login yang INSERT
--    traders dengan is_demo = true, atau UPDATE yang mengubah is_demo,
--    ditolak. Tanpa ini, siapa pun bisa menjadikan dirinya demo dan
--    membebaskan diri dari SEMUA cooldown di atas. Penanda demo hanya
--    boleh ditulis sistem (SQL Editor / skrip demo 09–11, yang jalan
--    sebagai postgres sehingga lolos bypass sistem).
-- 3. HARGA NULL = GRATIS, stempel DIPERTAHANKAN: bila harga diubah
--    menjadi NULL, trigger memaksa new.subscription_price_changed_at
--    kembali ke nilai lama (bukan membiarkan nilai kiriman klien).
--    Supaya trik "set harga -> gratiskan -> set lagi" tidak mereset
--    cooldown. Di INSERT tanpa harga, stempel dipaksa NULL (belum ada
--    harga yang pernah dipasang).
-- 4. INSERT traders: username_changed_at dipaksa NULL (penetapan pertama
--    bukan perubahan), dan bila INSERT membawa harga, berlaku rentang +
--    gerbang Level 5 + stempel yang sama seperti UPDATE (tidak ada
--    cooldown di INSERT karena tidak ada harga lama).
-- 5. Level dibaca dari trader_progress.level; bila tidak ada baris,
--    dianggap Level 1 (coalesce ..., 1). Policy SELECT trader_progress
--    adalah using(true) untuk anon+authenticated, jadi SELECT di dalam
--    trigger berfungsi di bawah role pemanggil.
-- 6. avatar_url / region (profiles) dan trader_display_name /
--    trader_avatar_url (traders) TIDAK disentuh trigger ini — jalur
--    uploadAvatar (js/api.js) yang update avatar_url langsung HARUS
--    tetap jalan.
-- 7. Trigger ini TIDAK menyentuh updated_at — itu urusan trigger
--    set_updated_at (01) yang juga berjalan di UPDATE.
--
-- PERINGATAN — AMBIGUITAS USD vs IDR (SUDAH ADA, diputuskan di FASE
-- PEMBAYARAN, bukan ronde ini):
-- Kolom bernama `subscription_price_usd` (USD), sedangkan aturan produk
-- menyebut rentang harga langganan dalam IDR (Rp100.000–Rp10.000.000,
-- kurs tetap Rp16.000/$). Trigger di file ini memakai batas USD
-- 6.25–625 (= Rp100.000–Rp10.000.000 / 16.000). NAMUN display frontend
-- (`fmtIdr` di js/app.js) menampilkan nilai mentah kolom ini sebagai
-- "Rp" TANPA konversi (Rp + angka mentah) — bila kolom berisi USD,
-- tampilannya salah 16000x (mis. $6.25 tampil "Rp6", $625 tampil
-- "Rp625"). Ini inkonsistensi display/penyimpanan yang SUDAH ADA dan
-- belum berdampak karena harga belum pernah diisi (semua NULL hari
-- ini). JANGAN ubah display dan JANGAN ubah nama kolom di ronde ini —
-- diputuskan di fase pembayaran (apakah kolom diisi IDR, atau display
-- dikonversi USD->IDR, atau keduanya).
--
-- Idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). TIDAK ADA
-- kunci, password, atau rahasia apa pun di file ini.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. K-1: perluas guard_profile_kyc_columns() — jaga juga is_admin.
--    Nama fungsi + nama trigger TETAP (02_rls.sql). Penjaga kyc_* yang
--    lama dipertahankan utuh, baris demi baris.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_kyc_columns()
returns trigger
language plpgsql
as $func$
begin
  -- K-1: is_admin hanya boleh diubah sistem (dashboard / SQL sebagai
  -- postgres, atau service_role). Pengguna login tidak boleh mengangkat
  -- dirinya sendiri menjadi admin lewat PATCH langsung.
  if auth.uid() is not null
     and new.is_admin is distinct from old.is_admin then
    raise exception 'Kolom is_admin hanya boleh diubah oleh sistem.'
      using errcode = '42501';
  end if;

  -- Penjaga lama (02): kolom kyc_* hanya boleh diubah sistem (webhook Zyphe).
  if auth.uid() is not null
     and (new.kyc_status, new.kyc_full_name, new.kyc_provider, new.kyc_reference,
          new.kyc_submitted_at, new.kyc_verified_at, new.kyc_reject_reason)
         is distinct from
         (old.kyc_status, old.kyc_full_name, old.kyc_provider, old.kyc_reference,
          old.kyc_submitted_at, old.kyc_verified_at, old.kyc_reject_reason) then
    raise exception 'Kolom KYC hanya boleh diubah oleh sistem (Zyphe webhook).'
      using errcode = '42501';
  end if;
  return new;
end;
$func$;

drop trigger if exists trg_guard_profile_kyc_columns on public.profiles;
create trigger trg_guard_profile_kyc_columns
  before update on public.profiles
  for each row execute function public.guard_profile_kyc_columns();

-- ---------------------------------------------------------------------------
-- 2. T-3 (profiles): cooldown username + nama profil, anti-utak-atik
--    stempel, dan KYC-lock nama profil.
--    Demo = pemanggil punya baris traders dengan is_demo = true
--    (kondisi yang sama seperti 13: select coalesce(is_demo, false)
--    from traders where profile_id = actor).
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_cooldown_columns()
returns trigger
language plpgsql
as $func$
declare
  v_actor uuid := auth.uid();
  v_is_demo boolean := false;
  v_next date;
begin
  -- Bypass sistem: service_role / postgres tidak punya JWT (auth.uid() NULL).
  if v_actor is null then
    return new;
  end if;

  select exists (
    select 1 from public.traders
    where profile_id = v_actor and is_demo
  ) into v_is_demo;

  -- -- Username follower (profiles.username) --
  if new.username is distinct from old.username then
    -- Cooldown 1x/bulan — hanya bila ada username LAMA yang diganti
    -- (old NOT NULL) dan stempel terakhir masih dalam 1 bulan.
    if old.username is not null
       and old.username_changed_at is not null
       and old.username_changed_at > now() - interval '1 month'
       and not v_is_demo then
      v_next := (old.username_changed_at + interval '1 month')::date;
      raise exception 'Username hanya bisa diubah 1× sebulan. Bisa diubah lagi pada '
        || to_char(v_next, 'YYYY-MM-DD') || '.'
        using errcode = '42501';
    end if;
    if old.username is not null and not v_is_demo then
      -- Perubahan sungguhan oleh non-demo: stempel paksa (abaikan kiriman klien).
      new.username_changed_at := now();
    else
      -- Penetapan pertama (old NULL) atau demo: JANGAN stempel — paksa
      -- kembali ke nilai lama supaya stempel palsu tidak bisa diselundupkan.
      new.username_changed_at := old.username_changed_at;
    end if;
  elsif new.username_changed_at is distinct from old.username_changed_at then
    -- Username tidak berubah tapi stempel diubah: utak-atik langsung.
    raise exception 'Stempel cooldown tidak boleh diubah langsung.'
      using errcode = '42501';
  end if;

  -- -- Nama profil (profiles.display_name) --
  if new.display_name is distinct from old.display_name then
    -- KYC-lock (penegakan 13 keputusan 8): nama profil mengikuti nama
    -- KYC dan tidak bisa diubah bila kyc_status sudah 'verified'.
    if old.kyc_status = 'verified' then
      raise exception 'Nama profil mengikuti nama KYC dan tidak bisa diubah.'
        using errcode = '42501';
    end if;
    -- Cooldown 1x/bulan — pola yang sama seperti username.
    if old.display_name is not null
       and old.display_name_changed_at is not null
       and old.display_name_changed_at > now() - interval '1 month'
       and not v_is_demo then
      v_next := (old.display_name_changed_at + interval '1 month')::date;
      raise exception 'Nama profil hanya bisa diubah 1× sebulan. Bisa diubah lagi pada '
        || to_char(v_next, 'YYYY-MM-DD') || '.'
        using errcode = '42501';
    end if;
    if old.display_name is not null and not v_is_demo then
      new.display_name_changed_at := now();
    else
      new.display_name_changed_at := old.display_name_changed_at;
    end if;
  elsif new.display_name_changed_at is distinct from old.display_name_changed_at then
    raise exception 'Stempel cooldown tidak boleh diubah langsung.'
      using errcode = '42501';
  end if;

  -- avatar_url / region / kolom lain: SENGAJA tidak disentuh (jalur
  -- uploadAvatar menulis avatar_url langsung dan harus tetap jalan).
  return new;
end;
$func$;

drop trigger if exists trg_guard_profile_cooldown_columns on public.profiles;
create trigger trg_guard_profile_cooldown_columns
  before update on public.profiles
  for each row execute function public.guard_profile_cooldown_columns();

-- ---------------------------------------------------------------------------
-- 3. T-3 (traders): jaga is_demo, cooldown username trader, dan aturan
--    harga langganan (rentang + gerbang Level 5 + cooldown + stempel).
--    Baris yang diubah ADALAH baris actor (RLS traders_update_own /
--    traders_insert_own membatasi ke profile_id = auth.uid()), jadi
--    penanda demo dibaca dari OLD.is_demo (UPDATE) / NEW.is_demo (INSERT).
--    Format + nama dilindungi sudah dijaga CHECK + guard_trader_username
--    dari 12 — tidak diduplikasi di sini.
-- ---------------------------------------------------------------------------
create or replace function public.guard_trader_guards()
returns trigger
language plpgsql
as $func$
declare
  v_actor uuid := auth.uid();
  v_is_demo boolean := false;
  v_level integer;
  v_next date;
  v_price_changed boolean := false;
begin
  -- Bypass sistem: service_role / postgres tidak punya JWT (auth.uid() NULL).
  if v_actor is null then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    v_is_demo := coalesce(new.is_demo, false);
  else
    v_is_demo := coalesce(old.is_demo, false);
  end if;

  -- -- Status demo: tidak boleh diangkat sendiri --
  -- (Mengangkat diri jadi demo akan membebaskan diri dari semua cooldown
  -- di atas, jadi gerbang ini harus berdiri SEBELUM aturan lain.)
  if TG_OP = 'INSERT' then
    if coalesce(new.is_demo, false) then
      raise exception 'Status demo hanya bisa diubah oleh sistem.'
        using errcode = '42501';
    end if;
    -- Penetapan pertama: username_changed_at dipaksa NULL (penetapan
    -- pertama bukan perubahan — cerminkan 13; stempel palsu dari klien
    -- tidak bisa diselundupkan lewat INSERT).
    new.username_changed_at := null;
  elsif new.is_demo is distinct from old.is_demo then
    raise exception 'Status demo hanya bisa diubah oleh sistem.'
      using errcode = '42501';
  end if;

  -- -- Username trader (UPDATE saja; INSERT adalah penetapan pertama) --
  if TG_OP = 'UPDATE' then
    if new.username is distinct from old.username then
      if old.username is not null
         and old.username_changed_at is not null
         and old.username_changed_at > now() - interval '1 month'
         and not v_is_demo then
        v_next := (old.username_changed_at + interval '1 month')::date;
        raise exception 'Username hanya bisa diubah 1× sebulan. Bisa diubah lagi pada '
          || to_char(v_next, 'YYYY-MM-DD') || '.'
          using errcode = '42501';
      end if;
      if old.username is not null and not v_is_demo then
        new.username_changed_at := now();
      else
        new.username_changed_at := old.username_changed_at;
      end if;
    elsif new.username_changed_at is distinct from old.username_changed_at then
      raise exception 'Stempel cooldown tidak boleh diubah langsung.'
        using errcode = '42501';
    end if;
  end if;

  -- -- Harga langganan (INSERT dan UPDATE) --
  -- TIDAK ADA RPC atau jalur UI yang menulis subscription_price_usd hari
  -- ini (hanya dibaca untuk display) — trigger ini adalah SATU-SATUNYA
  -- penegakan harga. Ia menegakkan aturan yang sama untuk RPC maupun
  -- PATCH langsung, jadi tidak perlu membedakan keduanya.
  if TG_OP = 'INSERT' then
    v_price_changed := new.subscription_price_usd is not null;
  else
    v_price_changed := new.subscription_price_usd is distinct from old.subscription_price_usd;
  end if;

  if v_price_changed then
    if new.subscription_price_usd is null then
      -- Hanya mungkin di UPDATE (INSERT dengan harga NULL tidak masuk
      -- cabang ini): jadi gratis, diizinkan bebas. Stempel DIPAKSA
      -- kembali ke nilai lama supaya trik set-harga -> gratiskan ->
      -- set-lagi tidak mereset cooldown.
      new.subscription_price_changed_at := old.subscription_price_changed_at;
    else
      -- (a) RENTANG: Rp100.000–Rp10.000.000 dengan kurs tetap Rp16.000/$
      --     = USD 6.25–625. (Lihat PERINGATAN USD vs IDR di header.)
      if new.subscription_price_usd < 6.25
         or new.subscription_price_usd > 625 then
        raise exception 'Harga langganan Rp100.000–Rp10.000.000.'
          using errcode = '42501';
      end if;
      -- (b) GERBANG LEVEL 5: hanya trader Level 5+ boleh memasang harga.
      --     Tanpa baris trader_progress, dianggap Level 1.
      v_level := coalesce(
        (select level from public.trader_progress where trader_id = v_actor), 1);
      if v_level < 5 and not v_is_demo then
        raise exception 'Harga langganan hanya untuk trader Level 5+.'
          using errcode = '42501';
      end if;
      -- (c) COOLDOWN 1x/bulan (hanya UPDATE; INSERT tidak punya harga lama).
      if TG_OP = 'UPDATE'
         and old.subscription_price_changed_at is not null
         and old.subscription_price_changed_at > now() - interval '1 month'
         and not v_is_demo then
        v_next := (old.subscription_price_changed_at + interval '1 month')::date;
        raise exception 'Harga langganan hanya bisa diubah 1× sebulan. Bisa diubah lagi pada '
          || to_char(v_next, 'YYYY-MM-DD') || '.'
          using errcode = '42501';
      end if;
      -- (d) STEMPEL: lolos + non-demo -> stempel paksa now().
      if not v_is_demo then
        new.subscription_price_changed_at := now();
      elsif TG_OP = 'UPDATE' then
        new.subscription_price_changed_at := old.subscription_price_changed_at;
      else
        new.subscription_price_changed_at := null;
      end if;
    end if;
  elsif TG_OP = 'INSERT' then
    -- INSERT tanpa harga: tidak ada stempel cooldown (harga belum pernah dipasang).
    new.subscription_price_changed_at := null;
  elsif new.subscription_price_changed_at is distinct from old.subscription_price_changed_at then
    -- Harga tidak berubah tapi stempel diubah: utak-atik langsung.
    raise exception 'Stempel cooldown tidak boleh diubah langsung.'
      using errcode = '42501';
  end if;

  -- trader_display_name / trader_avatar_url: SENGAJA tidak disentuh
  -- (tidak ada aturan cooldown untuk keduanya).
  return new;
end;
$func$;

drop trigger if exists trg_guard_trader_guards on public.traders;
create trigger trg_guard_trader_guards
  before insert or update on public.traders
  for each row execute function public.guard_trader_guards();

-- ============================================================================
-- LANGKAH UJI NEGATIF — untuk parent, JALANKAN DI LIVE (bukan perintah aktif).
-- Prasyarat: snapshot baseline akun tes dulu (saldo/level, username +
-- *_changed_at, harga + subscription_price_changed_at), lalu kembalikan
-- baseline itu setelah uji — JANGAN kembalikan ke 0/0/0 asumsi.
-- TIDAK ADA Postgres lokal untuk uji eksekusi; file ini hanya direview
-- statis. Semua uji di bawah HARUS dijalankan parent sebelum deploy.
--
-- 1. K-1 — PATCH is_admin sebagai akun tes (authenticated, BUKAN admin):
--      update profiles set is_admin = true where id = <uid tes>;
--    HARUS ditolak: ERROR 42501 'Kolom is_admin hanya boleh diubah oleh sistem.'
--    (Jalankan sebagai role authenticated via PostgREST / Supabase client
--    dengan JWT akun tes — BUKAN sebagai postgres di SQL Editor, karena
--    SQL Editor bypasses trigger lewat auth.uid() NULL.)
-- 2. T-3 profiles — PATCH username langsung saat cooldown berjalan:
--      (a) ubah username sekali lewat RPC set_follower_username (lolos,
--          stempel terisi), lalu (b) PATCH profiles.username langsung ke
--          nilai lain sebelum 1 bulan. HARUS ditolak 42501 + tanggal.
--    PATCH username_changed_at langsung (tanpa ubah username):
--    HARUS ditolak 42501 'Stempel cooldown tidak boleh diubah langsung.'
-- 3. T-3 profiles — PATCH display_name langsung saat kyc_status =
--    'verified': HARUS ditolak 42501 'Nama profil mengikuti nama KYC...'.
--    (Butuh akun tes dengan kyc_status verified — set via SQL Editor
--    sebagai postgres, lalu kembalikan ke unverified setelah uji.)
-- 4. T-3 traders — PATCH subscription_price_usd sebagai trader di bawah
--    Level 5 (akun tes, Level 1): HARUS ditolak 42501 'Harga langganan
--    hanya untuk trader Level 5+.'. Ulangi dengan harga di luar rentang
--    (mis. 1.00 dan 1000.00): HARUS ditolak 42501 rentang — pakai akun
--    Level 5+ / demo untuk uji rentang murni (supaya gerbang level tidak
--    menutupi gerbang rentang).
-- 5. T-3 traders — PATCH is_demo = true sebagai akun tes:
--    HARUS ditolak 42501 'Status demo hanya bisa diubah oleh sistem.'
-- 6. RPC RESMI TETAP LOLOS (regresi — semua harus berhasil seperti semula):
--    set_follower_username (penetapan pertama + perubahan setelah cooldown
--    lewat), set_profile_name (non-KYC), setup_trader_identity (buat +
--    ubah username trader setelah cooldown lewat), upload avatar
--    (PATCH avatar_url langsung via uploadAvatar HARUS tetap jalan),
--    PATCH region langsung HARUS tetap jalan.
-- 7. AKUN DEMO TETAP BEBAS (regresi): sebagai akun demo, ubah username
--    follower + username trader + display_name dua kali berturut-turut —
--    HARUS lolos dan *_changed_at HARUS tetap NULL / tidak berubah.
-- 8. HARGA -> NULL -> HARGA (anti-reset cooldown): sebagai trader Level 5+
--    (atau demo? TIDAK — demo bebas cooldown, jadi pakai akun Level 5+
--    non-demo), pasang harga (stempel terisi), gratiskan (NULL), lalu
--    pasang harga lagi sebelum 1 bulan — HARUS ditolak 42501 cooldown.
--    Periksa subscription_price_changed_at TIDAK berubah saat digratiskan.
-- ============================================================================
