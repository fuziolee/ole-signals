// OLE Signals — klien Supabase (Auth + PostgREST + RPC).
// Satu-satunya jalan tulis sinyal dari client adalah RPC SECURITY DEFINER
// (create/update/cancel_signal, setup_trader_identity). Client TIDAK PERNAH
// menulis langsung ke tabel signals / trader_progress / audit_log.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
