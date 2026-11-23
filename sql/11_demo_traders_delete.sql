-- ============================================================================
-- OLE Signals — 11_demo_traders_delete.sql
-- Menghapus SEMUA data trader demo (dibuat 10_demo_traders_insert.sql)
-- dalam sekali jalan, TANPA menyentuh data lain.
-- Jalankan di Supabase SQL Editor kapan pun demo sudah tidak dibutuhkan.
--
-- Yang dihapus (berurutan, sesuai dependensi):
--   audit_log (jejak demo) -> copies -> notifications -> follows ->
--   subscriptions -> signals -> trader_progress -> traders -> profiles
--   -> auth.users (akun demo).
-- Pengaman:
--   * Akun dicari BERDASARKAN EMAIL demo (demo-alpha/beta/gamma@
--     ole-signals.demo). Bila tidak ada akun demo sama sekali, file
--     berhenti dengan pesan (tidak menghapus apa pun).
--   * Setiap penghapusan memakai daftar UUID yang sama (v_ids) — tidak
--     ada pola LIKE / tanpa filter yang bisa menyapu data lain.
--   * Bila akun auth demo TIDAK ditemukan (mis. sudah dihapus via
--     dashboard), baris profil/trader/sinyal demo tetap dihapus
--     berdasarkan email profil — lihat blok kedua di bawah.
-- Alternatif hapus akun auth: Dashboard → Authentication → Users → pilih
-- akun demo → Delete user. (Menghapus auth.users ikut menghapus profil
-- via CASCADE, tapi TIDAK menghapus traders/signals — tetap jalankan
-- file ini dulu untuk data turunannya.)
-- ============================================================================

do $$
declare
  v_ids uuid[];
begin
  -- Kumpulkan UUID akun demo berdasarkan email.
  select array_agg(id) into v_ids
  from auth.users
  where email in (
    'demo-alpha@ole-signals.demo',
    'demo-beta@ole-signals.demo',
    'demo-gamma@ole-signals.demo'
  );

  if v_ids is null or array_length(v_ids, 1) is null then
    raise notice 'Tidak ada akun demo ditemukan (email demo-*@ole-signals.demo). Tidak ada yang dihapus. Periksa blok kedua bila baris demo yatim masih ada.';
    return;
  end if;

  -- Jejak audit demo (actor_id tanpa FK — hapus manual).
  delete from public.audit_log where actor_id = any (v_ids);
  -- Salinan sinyal oleh / dari akun demo.
  delete from public.copies
   where follower_id = any (v_ids)
      or signal_id in (select id from public.signals where trader_id = any (v_ids));
  -- Notifikasi untuk akun demo / tentang sinyal demo.
  delete from public.notifications
   where user_id = any (v_ids)
      or signal_id in (select id from public.signals where trader_id = any (v_ids));
  -- Follow / langganan yang melibatkan akun demo.
  delete from public.follows where follower_id = any (v_ids) or trader_id = any (v_ids);
  delete from public.subscriptions where follower_id = any (v_ids) or trader_id = any (v_ids);
  -- Sinyal, progress, identitas trader, profil, lalu akun auth.
  delete from public.signals where trader_id = any (v_ids);
  delete from public.trader_progress where trader_id = any (v_ids);
  delete from public.traders where profile_id = any (v_ids);
  delete from public.profiles where id = any (v_ids);
  delete from auth.users where id = any (v_ids);

  raise notice 'Akun demo dihapus: % akun.', array_length(v_ids, 1);
end $$;

-- ---------------------------------------------------------------------------
-- Blok kedua (pengaman): bila akun auth demo sudah dihapus duluan via
-- dashboard, baris demo yatim (trader/profil/sinyal tanpa auth.users)
-- dibersihkan berdasarkan penanda is_demo + username demo.
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[];
begin
  select array_agg(profile_id) into v_ids
  from public.traders
  where is_demo
     or profile_id in (
       select id from public.profiles
       where username in ('demo_alpha', 'demo_beta', 'demo_gamma')
     );
  if v_ids is null or array_length(v_ids, 1) is null then
    raise notice 'Tidak ada baris demo yatim.';
    return;
  end if;
  delete from public.audit_log where actor_id = any (v_ids);
  delete from public.copies
   where follower_id = any (v_ids)
      or signal_id in (select id from public.signals where trader_id = any (v_ids));
  delete from public.notifications
   where user_id = any (v_ids)
      or signal_id in (select id from public.signals where trader_id = any (v_ids));
  delete from public.follows where follower_id = any (v_ids) or trader_id = any (v_ids);
  delete from public.subscriptions where follower_id = any (v_ids) or trader_id = any (v_ids);
  delete from public.signals where trader_id = any (v_ids);
  delete from public.trader_progress where trader_id = any (v_ids);
  delete from public.traders where profile_id = any (v_ids);
  delete from public.profiles where id = any (v_ids);
  raise notice 'Baris demo yatim dibersihkan: % trader.', array_length(v_ids, 1);
end $$;

-- ---------------------------------------------------------------------------
-- Verifikasi (baca panel Results): semua angka harus 0.
-- ---------------------------------------------------------------------------
select
  (select count(*) from auth.users where email like 'demo-%@ole-signals.demo') as akun_auth_demo,
  (select count(*) from public.profiles where username in ('demo_alpha','demo_beta','demo_gamma')) as profil_demo,
  (select count(*) from public.traders where is_demo) as trader_demo,
  (select count(*) from public.signals where trader_id not in (select profile_id from public.traders)) as sinyal_yatim;
