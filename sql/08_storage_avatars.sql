-- ============================================================================
-- OLE Signals — 08_storage_avatars.sql
-- Bucket Storage 'avatars' untuk foto profil + foto trader (upload galeri).
-- Jalankan di Supabase SQL Editor (project ole-signals). Idempotent.
--
-- Aturan:
--   * Baca PUBLIK (foto tampil di kartu/profil siapa pun).
--   * Tulis HANYA pemilik: tiap pengguna hanya boleh upload/ubah/hapus
--     file di foldernya sendiri (folder = auth.uid()).
--   * Batas 2 MB, hanya gambar (jpg/png/webp/gif) — dijaga juga di client.
--   * TIDAK ADA kredensial di file ini.
-- Verifikasi setelah jalan: upload foto dari Profil akun; bila gagal,
-- periksa pesan galat — bucket yang belum diterapkan memberi galat jelas
-- di aplikasi ("bucket belum tersedia"), bukan tombol mati.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Baca publik: foto avatar tampil untuk siapa pun (termasuk anon).
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

-- Upload hanya ke folder sendiri (nama file diawali auth.uid() + '/').
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Ganti foto sendiri (upload ulang path yang sama / ganti file).
drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Hapus foto sendiri.
drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
