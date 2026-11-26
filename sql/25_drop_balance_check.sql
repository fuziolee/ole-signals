-- ============================================================================
-- OLE Signals — 25_drop_balance_check.sql
-- Ronde 35 susulan (diputuskan user 2026-11-26 17:18 WIB "Kerjakan 1,3,4"):
-- cabut CHECK balance_usd >= 0 di trader_progress.
--
-- ALASAN (keputusan user 2026-11-26 13:54 WIB): saldo simulasi adalah angka
-- jurnal/statistik — boleh minus, ditampilkan apa adanya. Selama CHECK ini
-- ada, saldo tidak bisa tersimpan di bawah $0: settlement gagal di CHECK
-- dan sinyalnya nyangkut AKTIF sampai trader reset statistik. Setelah
-- dicabut, saldo negatif bisa tersimpan; reset statistik tetap jadi jalan
-- keluar kalau saldo terlalu minus. TIDAK ada aturan lain yang berubah:
-- risiko tetap max 1% dari saldo acuan level ref(L), level tetap pakai
-- tangga tetap +5%/+5R.
--
-- CARA: cari nama constraint-nya secara dinamis (di sql/01 CHECK ini
-- ditulis inline tanpa nama, jadi Postgres menamainya otomatis — biasanya
-- trader_progress_balance_usd_check). Dicocokkan dua cara: nama standar
-- ATAU definisi mengandung 'balance_usd >= (0)' (di pg_get_constraintdef
-- tertulis 'CHECK ((balance_usd >= (0)::numeric))' — 0 dalam kurung +
-- cast, jadi pola tanpa kurung TIDAK cocok). Hanya constraint itu yang
-- dicabut; CHECK lain di tabel yang sama (level >= 1, trades >= 0,
-- max_drawdown >= 0) TIDAK disentuh.
-- Idempotent: bila constraint sudah tidak ada, blok ini no-op.
-- ============================================================================

do $$
declare
  v_con text;
begin
  -- Nama standar Postgres untuk CHECK inline adalah
  -- trader_progress_balance_usd_check; definisinya di pg_get_constraintdef
  -- tertulis 'CHECK ((balance_usd >= (0)::numeric))' (0 dalam kurung +
  -- cast) — karena itu dicocokkan dua cara (nama ATAU definisi).
  select c.conname into v_con
  from pg_constraint c
  where c.conrelid = 'public.trader_progress'::regclass
    and c.contype = 'c'
    and (c.conname = 'trader_progress_balance_usd_check'
         or pg_get_constraintdef(c.oid) like '%balance_usd >= (0)%');

  if v_con is not null then
    execute 'alter table public.trader_progress drop constraint ' || quote_ident(v_con);
    raise notice 'dropped constraint % on trader_progress', v_con;
  else
    raise notice 'no balance_usd >= 0 check constraint found on trader_progress (already dropped?)';
  end if;
end $$;

-- Verifikasi (baca saja, jalankan terpisah bila perlu):
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid = 'public.trader_progress'::regclass and contype = 'c';
-- Hasil yang diharapkan: TIDAK ada lagi baris dengan 'balance_usd >= 0'.
