-- ============================================================================
-- OLE Signals — 09_demo_traders_migration.sql
-- Penanda trader demo (izin user 23 Nov 2026 14:54 WIB): trader demo BOLEH
-- ditambahkan ke build nyata, jumlah kecil (3), JELAS berlabel "Demo" di UI,
-- dan harus bisa dihapus bersih (lihat 11_demo_traders_delete.sql).
-- Jalankan di Supabase SQL Editor SEBELUM 10_demo_traders_insert.sql.
-- Idempotent. TIDAK mengubah data yang sudah ada (default false).
-- ============================================================================

alter table public.traders
  add column if not exists is_demo boolean not null default false;

comment on column public.traders.is_demo is
  'Trader demo (data contoh berlabel, bukan trader sungguhan). Ditampilkan dengan lencana "Demo" di UI dan bisa dihapus bersih via 11_demo_traders_delete.sql.';
