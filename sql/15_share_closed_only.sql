-- ============================================================================
-- Ronde 19 — hanya sinyal selesai (WIN/LOSS) yang bisa dibagikan.
-- DITERAPKAN VIA SUPABASE DASHBOARD SQL EDITOR (seperti migrasi 14),
-- SEBELUM frontend ronde 19 di-upload (urutan deploy kritis).
-- JANGAN terapkan ulang sql/03_functions.sql secara utuh tanpa menerapkan
-- ulang migrasi 13 sesudahnya (setup_trader_identity di 03 sudah usang).
--
-- Isi:
--   1. RPC mark_signal_shared (versi baru) — menolak sinyal yang belum
--      selesai (status bukan WIN/LOSS) dengan kode 'notclosed'.
--      - Sinyal yang SUDAH dibagikan sebelumnya tetap mengembalikan ok
--        (idempotent + grandfathered): sinyal PENDING yang dibagikan
--        sebelum ronde 19 — mis. XAUUSD akun tes (16:30 WIB, ronde 9b) —
--        tetap "Sudah dibagikan · terkunci", tidak dibuka lagi.
--      - Selain itu logika TIDAK berubah: owner-only, idempotent,
--        set shared_at.
--   2. Grant mark_signal_shared untuk authenticated (dipertahankan).
-- Frontend (js/app.js) menyembunyikan tombol Bagikan untuk PENDING/AKTIF
-- dan menangani kode 'notclosed' dengan toast jujur.
-- ============================================================================

create or replace function public.mark_signal_shared(p_signal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_actor uuid := auth.uid();
  v_old public.signals%rowtype;
begin
  if v_actor is null then
    return public.api_error('invalid', 'Anda harus masuk terlebih dahulu.');
  end if;

  select * into v_old
  from public.signals
  where id = p_signal_id
  for update;
  if not found then
    return public.api_error('invalid', 'Sinyal tidak ditemukan.');
  end if;
  if v_old.trader_id <> v_actor then
    return public.api_error('invalid', 'Sinyal tidak ditemukan.');
  end if;

  -- R19: sinyal yang sudah dibagikan sebelumnya tetap ok (idempotent +
  -- grandfathered) — tanpa ini, penanda-ulang sinyal PENDING yang
  -- dibagikan sebelum ronde 19 akan gagal, padahal status terkuncinya
  -- harus dipertahankan.
  if v_old.shared_at is not null then
    return jsonb_build_object('ok', true, 'code', 'ok');
  end if;

  -- R19: hanya sinyal selesai (WIN/LOSS) yang bisa dibagikan — sinyal
  -- yang dibagikan adalah bukti hasil akhir; PENDING/AKTIF belum punya
  -- hasil. CANCELLED/EXPIRED juga ditolak (bukan hasil trade).
  if v_old.status not in ('WIN', 'LOSS') then
    return public.api_error(
      'notclosed',
      'Hanya sinyal yang sudah selesai (WIN/LOSS) yang bisa dibagikan.'
    );
  end if;

  update public.signals set shared_at = now() where id = p_signal_id;

  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$func$;

revoke execute on function public.mark_signal_shared(uuid) from public;
grant execute on function public.mark_signal_shared(uuid) to authenticated;
