-- ============================================================================
-- OLE Signals — 17_profiles_public_view.sql
-- Ronde 27 (perbaikan audit pra-Fase 3, temuan T-1).
--
-- APA YANG DIJAGA
--   Sebelum file ini, policy `profiles_select_public` (02_rls.sql)
--   mengizinkan SIAPA PUN — termasuk anon — membaca SELURUH kolom tabel
--   `profiles`, termasuk `is_admin` dan semua kolom `kyc_*`
--   (kyc_status, kyc_full_name, kyc_provider, kyc_reference,
--   kyc_submitted_at, kyc_verified_at, kyc_reject_reason). Audit
--   pra-Fase 3 (T-1) menandai itu sebagai kebocoran: kolom-kolom itu
--   tidak pernah dibutuhkan permukaan publik mana pun.
--   Setelah file ini:
--     * Tabel dasar `profiles` HANYA bisa dibaca pemiliknya
--       (authenticated, id = auth.uid()).
--     * Anon TIDAK LAGI bisa SELECT dari tabel dasar `profiles`
--       (grant dicabut — fail-closed: query anon langsung ke `profiles`
--       gagal/kosong).
--     * Direktori publik pindah ke VIEW `public.profiles_public` yang
--       HANYA berisi kolom publik: id, username, display_name,
--       avatar_url, region, created_at. TIDAK ADA is_admin, kyc_*,
--       updated_at, atau kolom *_changed_at di view ini.
--
-- KENAPA AMAN — FRONTEND TIDAK BERGANTUNG PADA BACA PUBLIK profiles
--   Diverifikasi (Ronde 27, T-1) dengan grep + baca tiap call site:
--   seluruh akses `profiles` di frontend HANYA 4 titik, semuanya baris
--   MILIK SENDIRI dan semuanya tetap jalan lewat policy
--   `profiles_select_own`:
--     1. api.js getMyProfile (~l.53)  — SELECT baris sendiri
--        (eq id = S.user.id), dipanggil hanya dari app.js ~l.955
--        refreshIdentity(). Hasilnya (S.profile) hanya dipakai untuk
--        menampilkan Profil akun / Pengaturan / Dompet MILIK SENDIRI
--        (app.js ~l.3256, 3538, 4093, 4136, 4198, 4281, 4541, 4583).
--     2. api.js uploadAvatar (~l.333) — UPDATE avatar_url baris sendiri.
--     3. api.js deleteAvatar (~l.388) — SELECT avatar_url baris sendiri.
--     4. api.js deleteAvatar (~l.405) — UPDATE avatar_url=null baris
--        sendiri.
--   TIDAK ADA satu pun bacaan profiles baris ORANG LAIN di frontend:
--   tidak ada `.from('profiles')` di js/app.js; permukaan publik trader
--   (kartu Cari/Peringkat, feed, profil trader, /v/) memakai tabel
--   `traders` (traders.username dkk.), bukan `profiles`. Karena itu
--   TIDAK ADA call site frontend yang perlu pindah ke view dan TIDAK
--   ADA perubahan file js/ di Ronde 27 ini.
--
-- URUTAN PENERAPAN
--   Terapkan SETELAH migrasi 16 (guards Ronde 27) dan SETELAH 02/03/13.
--   Keduanya (16 + 17) diterapkan SEBELUM frontend yang bergantung —
--   dalam hal ini frontend TIDAK bergantung pada file ini sama sekali
--   (lihat di atas), jadi urutan terhadap deploy frontend bebas; yang
--   mengikat hanya urutan antar-migrasi SQL.
--   File ini idempotent (CREATE OR REPLACE / DROP IF EXISTS) sehingga
--   aman dijalankan ulang. Bila 02_rls.sql diterapkan ulang kapan pun
--   SETELAH file ini, terapkan ulang file ini sesudahnya — 02 akan
--   menghidupkan kembali `profiles_select_public` dan grant anon.
--
-- CATATAN VIEW vs RLS (BY DESIGN)
--   View ini dibuat dengan security_invoker = false (default Postgres
--   15+ di Supabase): view berjalan sebagai OWNER-nya (postgres) dan
--   karena itu MELEWATI RLS tabel dasar `profiles`. Itu disengaja dan
--   aman DI SINI karena view hanya memproyeksikan kolom publik —
--   tidak ada baris/kolom sensitif yang bisa lolos lewat view ini,
--   apa pun isi tabel dasarnya. Jangan pernah menambahkan kolom
--   is_admin / kyc_* / *_changed_at / updated_at ke view ini tanpa
--   meninjau ulang keamanan. PostgREST mengekspos view di skema
--   public secara otomatis (GET /rest/v1/profiles_public), sama
--   seperti tabel — itu jalur publik yang benar setelah file ini.
--
-- TIDAK ADA rahasia/kunci/password di file ini.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. View direktori publik — kolom publik SAJA.
-- ---------------------------------------------------------------------------
create or replace view public.profiles_public
with (security_invoker = false)
as
select
  id,
  username,
  display_name,
  avatar_url,
  region,
  created_at
from public.profiles;

comment on view public.profiles_public is
  'Direktori publik pengguna (Ronde 27, T-1). HANYA kolom publik: id, username, display_name, avatar_url, region, created_at. TIDAK ADA is_admin / kyc_* / updated_at / *_changed_at. View berjalan sebagai owner sehingga melewati RLS tabel dasar BY DESIGN — aman karena hanya kolom publik yang diproyeksikan. JANGAN tambah kolom sensitif tanpa tinjauan keamanan.';

-- ---------------------------------------------------------------------------
-- 2. Grant SELECT pada view ke anon + authenticated (jalur publik baru).
-- ---------------------------------------------------------------------------
grant select on public.profiles_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Ganti policy baca tabel dasar: publik -> pemilik saja.
--    Setelah ini TIDAK ADA lagi kebutuhan membaca baris orang lain dari
--    tabel dasar `profiles`; bacaan pemilik (getMyProfile, deleteAvatar,
--    uploadAvatar) tetap jalan lewat policy ini.
-- ---------------------------------------------------------------------------
drop policy if exists "profiles_select_public" on public.profiles;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Cabut SELECT anon dari tabel dasar (fail-closed). Grant SELECT untuk
--    authenticated TETAP (dipakai policy profiles_select_own di atas).
--    Anon yang query `profiles` langsung akan gagal/empty; jalur publik
--    yang benar adalah view `profiles_public`.
--    Policy profiles_update_own TIDAK DIUBAH (tetap dibutuhkan upload +
--    hapus avatar).
-- ---------------------------------------------------------------------------
revoke select on public.profiles from anon;
grant select on public.profiles to authenticated;
