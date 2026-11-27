-- Scratch-only bootstrap (BUKAN migrasi — jangan terapkan di live):
-- stub minimal Supabase auth + roles supaya migrasi 01/02 bisa jalan
-- di Postgres lokal. auth.uid() membaca klaim JWT sesi (teknik R27):
--   select set_config('request.jwt.claims',
--     '{"sub":"<uid>","role":"authenticated","aud":"authenticated"}', false);
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  instance_id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  aud text,
  role text,
  created_at timestamptz,
  updated_at timestamptz
);
create or replace function auth.uid() returns uuid
language sql stable
as $func$
  select case
    when nullif(current_setting('request.jwt.claims', true), '') is null then null
    else ((current_setting('request.jwt.claims', true))::jsonb ->> 'sub')::uuid
  end;
$func$;
-- R61: di Supabase asli, anon/authenticated BOLEH memanggil auth.uid()
-- (dipakai semua policy RLS + trigger penjaga). Tanpa GRANT ini, stub
-- TIDAK SETIA: pemanggilan pertama auth.uid() sebagai authenticated
-- gagal 'permission denied for schema auth'. Efeknya menipu: trigger
-- yang sempat jalan sebagai postgres saat SETUP (mis. guard_trader_guards
-- lewat INSERT) memakai plan cache sesi sehingga lolos, sementara trigger
-- yang HANYA jalan saat UPDATE (guard_trader_reset_cooldown) gagal di
-- pemanggilan pertamanya — hasil tes jadi artefak plan cache, bukan
-- perilaku trigger yang sebenarnya.
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
