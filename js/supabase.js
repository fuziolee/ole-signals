// OLE Signals — klien Supabase (Auth + PostgREST + RPC).
// Satu-satunya jalan tulis sinyal dari client adalah RPC SECURITY DEFINER
// (create/update/cancel_signal, setup_trader_identity). Client TIDAK PERNAH
// menulis langsung ke tabel signals / trader_progress / audit_log.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Ronde 64: GoTrue TIDAK BOLEH memproses URL otomatis. Dulu (default
// detectSessionInUrl:true) klien mengonsumsi hash recovery saat init.
// Hash dibersihkan SEBELUM app.js sempat membacanya, sehingga sesi
// recovery menempuh jalur masuk normal (showApp) dan link reset malah
// masuk ke aplikasi. Sekarang boot app.js yang membaca URL recovery
// sendiri SEBELUM penanganan sesi apa pun (readRecoveryParams di app.js).
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { detectSessionInUrl: false },
});
