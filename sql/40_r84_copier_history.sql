-- Ronde 84: riwayat CANCELLED + EXPIRED untuk penyalin (Jurnal Follower).
-- Keputusan user FINAL 2026-11-29 01:26 WIB ("sinyalnya jangan
-- disembunyikan tapi terkunci"): Q1 = S1, Q2 = S1b.
--
-- Definisi view disalin lengkap dari sql/37, HANYA dua perubahan:
--   (a) WHERE ditambah pengecualian penyalin (plan pasal 4.2 opsi S1):
--       baris CANCELLED/EXPIRED ikut terlihat oleh penyalin yang
--       menyalin sinyal itu (selain pemilik yang sudah melihatnya).
--   (b) Redaksi S1b (plan pasal 4.3): untuk baris CANCELLED/EXPIRED,
--       entry/SL/TP/lot/entry_type di-NULL-kan bila trader L5+ berbayar
--       dan pembaca bukan pemilik dan bukan subscriber aktif saat ini.
--       Pemilik dan subscriber aktif tetap melihat penuh. Trader gratis
--       atau di bawah L5 tidak diredaksi. Kondisi ini ditulis inline dari
--       tabel yang sama dengan yang dipakai signal_locked_for (traders,
--       trader_progress, subscriptions) karena tidak ada helper yang
--       cocok: signal_locked_for hanya berlaku untuk status PENDING/AKTIF
--       dan TIDAK BOLEH diubah (dipakai trigger guard_copy_locked).
--
-- PENJAGA: pengecualian penyalin di WHERE hanya dimaksudkan untuk
-- listMyCopies (js/api.js). Pembaca view di masa depan yang tidak
-- memfilter status akan ikut melihat baris CANCELLED/EXPIRED milik
-- penyalin. Penyembunyian CANCELLED/EXPIRED di feed, Cari, dan /v/
-- (keputusan R77) TETAP: jalur itu memfilter status di client (.neq)
-- dan tidak berubah oleh migrasi ini.
--
-- TIDAK berisi salinan create_signal / update_signal / copy_signal /
-- cancel_signal / recalc_trader_progress. TIDAK mengubah
-- signal_locked_for, guard_copy_locked, atau grant. TIDAK menghapus
-- baris data. JANGAN terapkan ulang sql/30 sesudah 40: 30 akan
-- mengembalikan WHERE lama (tanpa pengecualian penyalin, tanpa redaksi
-- S1b) dan mengembalikan definisi view R61.

create or replace view public.signals_public
with (security_invoker = false) as
select
  s.id,
  s.trader_id,
  s.pair,
  s.direction,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true)
    or (
      s.status in ('CANCELLED', 'EXPIRED')
      and coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) <> s.trader_id
      and coalesce((select t.subscription_price_usd from public.traders t where t.profile_id = s.trader_id), 0) > 0
      and coalesce((select tp.level from public.trader_progress tp where tp.trader_id = s.trader_id), 1) >= 5
      and not exists (
        select 1 from public.subscriptions sub
        where sub.trader_id = s.trader_id
          and sub.follower_id = auth.uid()
          and sub.status = 'active'
      )
    )
    then null else s.entry end as entry,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true)
    or (
      s.status in ('CANCELLED', 'EXPIRED')
      and coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) <> s.trader_id
      and coalesce((select t.subscription_price_usd from public.traders t where t.profile_id = s.trader_id), 0) > 0
      and coalesce((select tp.level from public.trader_progress tp where tp.trader_id = s.trader_id), 1) >= 5
      and not exists (
        select 1 from public.subscriptions sub
        where sub.trader_id = s.trader_id
          and sub.follower_id = auth.uid()
          and sub.status = 'active'
      )
    )
    then null else s.stop_loss end as stop_loss,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true)
    or (
      s.status in ('CANCELLED', 'EXPIRED')
      and coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) <> s.trader_id
      and coalesce((select t.subscription_price_usd from public.traders t where t.profile_id = s.trader_id), 0) > 0
      and coalesce((select tp.level from public.trader_progress tp where tp.trader_id = s.trader_id), 1) >= 5
      and not exists (
        select 1 from public.subscriptions sub
        where sub.trader_id = s.trader_id
          and sub.follower_id = auth.uid()
          and sub.status = 'active'
      )
    )
    then null else s.take_profit end as take_profit,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true)
    or (
      s.status in ('CANCELLED', 'EXPIRED')
      and coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) <> s.trader_id
      and coalesce((select t.subscription_price_usd from public.traders t where t.profile_id = s.trader_id), 0) > 0
      and coalesce((select tp.level from public.trader_progress tp where tp.trader_id = s.trader_id), 1) >= 5
      and not exists (
        select 1 from public.subscriptions sub
        where sub.trader_id = s.trader_id
          and sub.follower_id = auth.uid()
          and sub.status = 'active'
      )
    )
    then null else s.lot_size end as lot_size,
  s.status,
  s.version,
  s.idempotency_key,
  s.created_at,
  s.expires_at,
  s.activated_at,
  s.closed_at,
  s.close_price,
  s.profit_usd,
  s.profit_pips,
  s.r_value,
  s.holding_minutes,
  s.duplicate_of,
  s.duplicate_flagged,
  s.updated_at,
  s.shared_at,
  case when coalesce(public.signal_locked_for(s.trader_id, s.status), true)
    or (
      s.status in ('CANCELLED', 'EXPIRED')
      and coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) <> s.trader_id
      and coalesce((select t.subscription_price_usd from public.traders t where t.profile_id = s.trader_id), 0) > 0
      and coalesce((select tp.level from public.trader_progress tp where tp.trader_id = s.trader_id), 1) >= 5
      and not exists (
        select 1 from public.subscriptions sub
        where sub.trader_id = s.trader_id
          and sub.follower_id = auth.uid()
          and sub.status = 'active'
      )
    )
    then null else s.entry_type end as entry_type
from public.signals s
where s.status not in ('CANCELLED', 'EXPIRED') or s.trader_id = auth.uid()
  or exists (select 1 from public.copies c where c.signal_id = s.id and c.follower_id = auth.uid());
comment on view public.signals_public is
  'R84: SATU-SATUNYA jalur baca sinyal untuk klien (anon + authenticated). Entry/SL/TP/lot/entry_type di-NULL-kan untuk sinyal terkunci L5+ (PENDING/AKTIF via signal_locked_for; CANCELLED/EXPIRED via redaksi S1b bila pembaca bukan pemilik/subscriber aktif); CANCELLED dan EXPIRED disembunyikan kecuali milik sendiri atau pernah disalin pembaca. Baca tabel mentah dicabut (revoke di sql/30).';
