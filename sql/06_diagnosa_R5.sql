-- ============================================================================
-- OLE Signals — 06_diagnosa_R5.sql
-- Diagnosa kegagalan R-5 di run 04 yang diperbaiki (anon melihat 1 CANCELLED).
-- Dugaan: BUKAN bug produk, melainkan kebocoran klaim JWT di harness tes —
-- R-5 memakai `set role anon` sementara klaim JWT user A dari tes
-- sebelumnya masih terpasang di sesi, sehingga auth.uid() tetap = A dan
-- policy signals_select_public (status <> 'CANCELLED' OR trader_id =
-- auth.uid()) memperlihatkan sinyal CANCELLED milik A.
-- Skrip ini membuktikan dugaan itu pada data live saat ini (1 sinyal
-- CANCELLED milik A masih ada; cleanup 05 BELUM dijalankan):
--   LANGKAH 1 = ulangi kondisi R-5 yang gagal (anon + klaim A bocor)
--               -> CANCELLED terlihat harus = 1 (mereproduksi FAIL)
--   LANGKAH 2 = anon SEJATI seperti PostgREST (klaim role=anon tanpa sub,
--               auth.uid() = NULL) -> CANCELLED terlihat harus = 0
-- Jika LANGKAH 2 = 0, produk benar dan R-5 di 04 sudah diperbaiki dengan
-- simulasi anon ini. Jika LANGKAH 2 > 0, itu BUG PRODUK — STOP, jangan cleanup.
-- ============================================================================

drop table if exists r5_diag;
create temp table r5_diag (langkah text primary key, cancelled_terlihat int, total_terlihat int, keterangan text);

-- LANGKAH 1: reproduksi kondisi R-5 yang gagal
do $$
declare n_can int; n_tot int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aud":"authenticated"}', false);
  execute 'set role anon';
  select count(*) into n_can from public.signals where status='CANCELLED';
  select count(*) into n_tot from public.signals;
  execute 'reset role';
  insert into r5_diag values ('1: anon + klaim A bocor', n_can, n_tot, 'harusnya CANCELLED=1 (mereproduksi FAIL R-5)');
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  insert into r5_diag values ('1: anon + klaim A bocor', -1, -1, 'exception: ' || sqlerrm);
end $$;

-- LANGKAH 2: anon sejati
do $$
declare n_can int; n_tot int;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
  select count(*) into n_can from public.signals where status='CANCELLED';
  select count(*) into n_tot from public.signals;
  execute 'reset role';
  insert into r5_diag values ('2: anon sejati (klaim role=anon, tanpa sub)', n_can, n_tot, 'harusnya CANCELLED=0 bila produk benar');
exception when others then
  begin execute 'reset role'; exception when others then null; end;
  insert into r5_diag values ('2: anon sejati (klaim role=anon, tanpa sub)', -1, -1, 'exception: ' || sqlerrm);
end $$;

select * from r5_diag order by langkah;
