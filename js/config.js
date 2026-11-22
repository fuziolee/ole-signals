// OLE Signals — konfigurasi publik aplikasi web.
//
// Anon key BOLEH ada di file ini: ini kunci PUBLIK by design untuk
// dipakai browser. Yang melindungi data adalah RLS di database Supabase,
// bukan kunci ini. Kunci ini hanya mengidentifikasi project dan
// membatasi akses ke peran anon/authenticated.
//
// JANGAN PERNAH menaruh service_role key di file mana pun di repo ini.
// Service role hanya ada di dashboard Supabase / Supabase Secrets.
export const SUPABASE_URL = 'https://hhukbtpcsepjkszveejx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhodWtidHBjc2VwamtzenZlZWp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNjk0OTYsImV4cCI6MjExMDk0NTQ5Nn0.82T2y3F4k1oIvCcSqESN6WXtoP88AN-rS5_-433KUN4';
export const APP_NAME = 'OLE Signals';
