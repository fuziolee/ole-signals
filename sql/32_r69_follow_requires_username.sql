-- Ronde 69: follow mensyaratkan username follower (server-side).
--
-- UI (js/app.js bindFollowSubscribe + ensureFollowerUsername) membuka
-- alur buat username follower sebelum follow; trigger ini menutup jalur
-- REST langsung (INSERT follows tanpa username follower ditolak 42501).
-- Aturan ini sudah tertulis di Panduan (username follower dibuat sebelum
-- mengikuti pertama kali); yang hilang selama ini adalah penegakannya.
--
-- Grandfathered: baris follows yang SUDAH ADA (termasuk tanpa username,
-- mis. follow akun admin) TIDAK disentuh — trigger hanya berjalan pada
-- INSERT. Unfollow (DELETE) TIDAK digerbankan. Subscribe TIDAK
-- digerbankan ronde ini (butir terbuka untuk user).
--
-- Pola: guard_copy_locked (sql/30) — BEFORE INSERT, SECURITY DEFINER
-- (anon/authenticated tidak punya SELECT ke profiles setelah sql/17,
-- jadi evaluasi harus sebagai definer), 42501. BUKAN WITH CHECK policy,
-- karena pola guard baris di codebase ini adalah trigger dan mengubah
-- policy follows_insert_own di sql/02 akan menyentuh file acuan RLS.
-- CHECK format profiles_username_format menjamin non-null = format
-- valid, jadi tidak perlu cek <> ''.
--
-- Idempotent. TERAPKAN SETELAH 30, SEBELUM deploy frontend Ronde 69
-- (frontend Ronde 69 yang jalan sebelum migrasi ini tetap berfungsi —
-- gerbang UI menahan dulu; yang belum aktif hanya penolakan server).

create or replace function public.guard_follow_requires_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.follower_id
      and p.username is not null
  ) then
    raise exception 'Username follower wajib dibuat sebelum mengikuti.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
comment on function public.guard_follow_requires_username() is
  'Ronde 69: INSERT follows tanpa username follower ditolak server (42501). Sebelum R69 hanya ada cek kepemilikan (RLS follows_insert_own) + larangan follow diri sendiri (CHECK follows_not_self); INSERT langsung lewat REST lolos tanpa username.';

drop trigger if exists trg_guard_follow_requires_username on public.follows;
create trigger trg_guard_follow_requires_username
  before insert on public.follows
  for each row execute function public.guard_follow_requires_username();
