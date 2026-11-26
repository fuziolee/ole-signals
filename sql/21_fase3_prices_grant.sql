-- ============================================================================
-- OLE Signals — 21_fase3_prices_grant.sql
-- Fase 3 FIX (2026-11-26): invoke pertama fetch-prices gagal HTTP 500
-- "gagal menulis prices: permission denied for table prices".
--
-- Akar masalah: sql/02_rls.sql hanya memberi `grant select on
-- public.prices to anon, authenticated` (baris 263) — service_role TIDAK
-- PERNAH diberi INSERT/UPDATE atas tabel prices, padahal komentar di
-- sql/02:187 sudah menetapkan "ditulis HANYA fetcher (service_role)".
-- RLS bukan penyebabnya: service_role melewati RLS (BYPASSRLS); yang
-- kurang adalah GRANT tingkat tabel.
--
-- Perbaikan minimal: beri service_role hak tulis atas prices. Anon /
-- authenticated TETAP hanya bisa baca (SELECT) — tidak ada hak tulis
-- baru untuk peran publik.
-- ============================================================================

grant select, insert, update on public.prices to service_role;

-- Verifikasi (jalankan terpisah):
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_name = 'prices' and grantee = 'service_role'
--   order by privilege_type;
-- Harus ada: INSERT, SELECT, UPDATE (3 baris).
