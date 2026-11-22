-- ============================================================================
-- OLE Signals — 07_smoke_cleanup.sql
-- Bersihkan data uji smoke test frontend Fase 1 (23 Nov 2026).
--
-- STATUS RUN 23 NOV 2026: smoke test TERBLOKIR di langkah signup —
-- percobaan @example.com ditolak 400 (email_address_invalid, domain
-- contoh ditolak GoTrue), lalu percobaan @gmail.com kena 429 (rate
-- limit Auth). TIDAK ADA akun uji yang berhasil dibuat, TIDAK ADA
-- sinyal/audit yang tercipta. Diverifikasi via REST anon:
--   GET /rest/v1/signals  -> 200 []
--   GET /rest/v1/profiles -> 200 []
-- Jadi file ini TIDAK PERLU dijalankan untuk run 23 Nov 2026 — database
-- sudah kosong. Disimpan sebagai pola cleanup untuk run smoke test
-- berikutnya (bila signup berhasil dan data uji tercipta).
--
-- Cara pakai (bila ada data uji): jalankan di Supabase SQL Editor,
-- ganti pola email bila akun uji memakai email lain. Hapus auth.users
-- ikut menghapus profiles/traders/signals via CASCADE; audit_log
-- dihapus manual (actor_id tanpa FK).
-- ============================================================================

-- 1. Hapus audit_log milik akun uji (berdasarkan email -> id).
delete from public.audit_log
where actor_id in (select id from auth.users where email like 'ole-smoke-%@gmail.com');

-- 2. Hapus akun uji (CASCADE: profiles, traders, signals, trader_progress).
delete from auth.users where email like 'ole-smoke-%@gmail.com';

-- 3. Verifikasi: semua harus 0.
select 'signals' as tabel, count(*) as sisa from public.signals
union all select 'traders', count(*) from public.traders
union all select 'profiles', count(*) from public.profiles
union all select 'audit_log', count(*) from public.audit_log
union all select 'trader_progress', count(*) from public.trader_progress
union all select 'auth_users_smoke', count(*) from auth.users where email like 'ole-smoke-%@gmail.com';
