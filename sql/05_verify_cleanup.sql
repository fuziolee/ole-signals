-- ============================================================================
-- OLE Signals — 05_verify_cleanup.sql
-- Hapus SEMUA data uji setelah 04_verify_tests.sql + T-08 selesai.
-- Jalankan di Supabase SQL Editor (project ole-signals) SETELAH semua tes.
-- Hapus auth.users ikut menghapus profiles/traders/signals via CASCADE;
-- audit_log dihapus manual (actor_id tanpa FK); prices dihapus manual.
-- Hasil akhir yang diharapkan: semua hitungan = 0 (database kembali kosong).
-- ============================================================================

delete from public.audit_log where actor_id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');
delete from public.prices where pair in ('USDJPY','XAUUSD');
delete from auth.users where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222');

select 'signals' as tabel, count(*) as sisa from public.signals
union all select 'traders', count(*) from public.traders
union all select 'profiles', count(*) from public.profiles
union all select 'audit_log', count(*) from public.audit_log
union all select 'prices', count(*) from public.prices
union all select 'auth_users_test', count(*) from auth.users where email like '%@ole-signals.local';
