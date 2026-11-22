// OLE Signals — semua akses data lewat klien Supabase.
// TULIS sinyal HANYA lewat RPC (create/update/cancel_signal,
// setup_trader_identity). Tidak ada insert/update/delete langsung ke
// signals / trader_progress / audit_log dari client mana pun.

import { supabase } from './supabase.js';

// ---------------------------------------------------------------- auth ---
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data; // data.session null bila konfirmasi email diwajibkan
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ---------------------------------------------------------------- profil ---
export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, region, kyc_status, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyTrader(userId) {
  const { data, error } = await supabase
    .from('traders')
    .select('profile_id, trader_display_name, trader_avatar_url, trader_progress(level, balance_usd, level_ref_balance, r_since_level, trades_since_level, max_drawdown_usd, max_drawdown_pct, updated_at)')
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------- identitas trader ---
// Jawaban RPC: {ok, code, message, ...}. Bila ok=false, kembalikan apa adanya
// supaya UI menampilkan pesan server (bukan menebak).
export async function setupTraderIdentity(username, displayName) {
  const { data, error } = await supabase.rpc('setup_trader_identity', {
    p_username: username,
    p_display_name: displayName,
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- sinyal ---
function signalSelect() {
  return '*, traders(trader_display_name, trader_progress(level, balance_usd))';
}

export async function listPublicSignals(limit = 50) {
  const { data, error } = await supabase
    .from('signals')
    .select(signalSelect())
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function listMySignals(userId) {
  const { data, error } = await supabase
    .from('signals')
    .select(signalSelect())
    .eq('trader_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listTraderSignals(traderId, limit = 50) {
  const { data, error } = await supabase
    .from('signals')
    .select(signalSelect())
    .eq('trader_id', traderId)
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function createSignal({ pair, direction, entry, sl, tp, lot }) {
  const { data, error } = await supabase.rpc('create_signal', {
    p_pair: pair,
    p_direction: direction,
    p_entry: entry,
    p_stop_loss: sl,
    p_take_profit: tp,
    p_lot: lot,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error) throw error;
  return data;
}

export async function updateSignal({ id, pair, direction, entry, sl, tp, lot, version }) {
  const { data, error } = await supabase.rpc('update_signal', {
    p_signal_id: id,
    p_pair: pair,
    p_direction: direction,
    p_entry: entry,
    p_stop_loss: sl,
    p_take_profit: tp,
    p_lot: lot,
    p_version: version,
  });
  if (error) throw error;
  return data;
}

export async function cancelSignal(id) {
  const { data, error } = await supabase.rpc('cancel_signal', { p_signal_id: id });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- trader ---
export async function listTraders() {
  const { data, error } = await supabase
    .from('traders')
    .select('profile_id, trader_display_name, trader_avatar_url, created_at, trader_progress(level, balance_usd, r_since_level, trades_since_level), profiles(username)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ----------------------------------------------------------------- harga ---
// Tabel prices dibaca publik (cache harga live; saat ini masih kosong
// karena fetcher Fase 3 belum jalan). Dipakai kalkulasi risiko client.
export async function getPrices() {
  const { data, error } = await supabase.from('prices').select('pair, price');
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) map.set(row.pair, Number(row.price));
  return map;
}
