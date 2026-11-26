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
  // Teruskan jenis event ke pemanggil: TOKEN_REFRESHED (refresh token
  // otomatis) tidak boleh memindahkan tampilan pengguna (C-01).
  return supabase.auth.onAuthStateChange((event, session) => cb(event, session));
}

export async function signUp(email, password) {
  // Arahkan link konfirmasi kembali ke asal pendaftaran (produksi maupun
  // localhost) — tanpa ini Supabase selalu memakai Site URL.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
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

export async function updatePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- profil ---
export async function getMyProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, region, kyc_status, kyc_full_name, kyc_reference, kyc_reject_reason, display_name_changed_at, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyTrader(userId) {
  const { data, error } = await supabase
    .from('traders')
    .select('profile_id, username, trader_display_name, trader_avatar_url, is_demo, trader_progress(level, balance_usd, level_ref_balance, r_since_level, trades_since_level, max_drawdown_usd, max_drawdown_pct, last_reset_at, reset_cooldown_until, updated_at)')
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
  // Embed username TRADER (traders.username, ronde 6b) supaya kartu sinyal
  // publik bisa tampil @username tanpa menunggu S.traders dimuat (ronde 5).
  // Username follower (profiles.username) TIDAK diambil di sini — tidak
  // dipakai permukaan trader mana pun.
  return '*, traders(username, trader_display_name, trader_avatar_url, trader_progress(level, balance_usd))';
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

// Ronde 35: reset statistik trader (sql/23). Jawaban RPC:
// {ok, deleted, paused, cooldown_until, refund_pending: true}.
// Pengembalian prorata DITUNDA bersama fase pembayaran (refund_pending
// hanya penanda jujur — tidak ada dana yang ditulis ke dompet mana pun).
export async function resetTraderStats() {
  const { data, error } = await supabase.rpc('reset_trader_stats');
  if (error) throw error;
  return data;
}

// R9-4: tandai sinyal sebagai sudah dibagikan (set shared_at). Dipanggil
// best-effort dari downloadShareCard — kegagalan RPC tidak merusak bagikan.
export async function markSignalShared(signalId) {
  const { data, error } = await supabase.rpc('mark_signal_shared', { p_signal_id: signalId });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- trader ---
export async function listTraders() {
  const { data, error } = await supabase
    .from('traders')
    .select('profile_id, username, trader_display_name, trader_avatar_url, subscription_price_usd, created_at, trader_progress(level, balance_usd, r_since_level, trades_since_level)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ID trader demo (kolom traders.is_demo, migrasi 09_demo_traders_migration).
// Best-effort: bila kolom belum diterapkan, kembalikan [] (bukan gagal).
export async function listDemoTraderIds() {
  try {
    const { data, error } = await supabase
      .from('traders')
      .select('profile_id')
      .eq('is_demo', true);
    if (error) throw error;
    return (data || []).map((r) => r.profile_id);
  } catch (e) {
    return [];
  }
}

// Jumlah pengikut satu trader (follows dibaca publik).
export async function countFollowers(traderId) {
  const { count, error } = await supabase
    .from('follows')
    .select('*', { count: 'exact', head: true })
    .eq('trader_id', traderId);
  if (error) throw error;
  return count || 0;
}

// ------------------------------------------------------- sinyal (statistik) ---
// Semua sinyal (kolom ringan) untuk statistik client-side: filter/urutan
// Cari, profil trader, statistik Ruang Kerja, dan peringkat komposit.
export async function listAllSignals(limit = 500) {
  const { data, error } = await supabase
    .from('signals')
    // B4-01: join traders agar halaman verifikasi /v/ bisa menampilkan
    // @username + level trader (sebelumnya S.traders kosong di jalur /v/).
    .select('id, trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, version, shared_at, created_at, expires_at, activated_at, closed_at, close_price, profit_usd, profit_pips, r_value, holding_minutes, traders(username, trader_display_name, trader_avatar_url, trader_progress(level, balance_usd))')
    .neq('status', 'CANCELLED')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ------------------------------------------------------------- pengikut ---
// Follows / salinan / langganan milik pemanggil (RLS owner-only). Semua
// dibaca nyata dari database; kosong sampai Fase 5 / pembayaran dibangun.
export async function listMyFollows(userId) {
  const { data, error } = await supabase
    .from('follows')
    .select('trader_id, created_at, traders!follows_trader_id_fkey(username, trader_display_name, trader_avatar_url, trader_progress(level, balance_usd))')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Ikuti / berhenti mengikuti trader (B2-05). RLS follows_insert_own /
// follows_delete_own mengizinkan pemilik; follows_not_self melarang
// mengikuti diri sendiri.
export async function followTrader(userId, traderId) {
  const { error } = await supabase
    .from('follows')
    .insert({ follower_id: userId, trader_id: traderId });
  if (error) throw error;
}

export async function unfollowTrader(userId, traderId) {
  const { error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', userId)
    .eq('trader_id', traderId);
  if (error) throw error;
}

export async function listMyCopies(userId) {
  const { data, error } = await supabase
    .from('copies')
    .select('id, signal_id, lot_size, status, created_at, signal_snapshot, signals!copies_signal_id_fkey(id, trader_id, pair, direction, entry, stop_loss, take_profit, lot_size, entry_type, status, created_at, closed_at, close_price, profit_usd, profit_pips, r_value, traders(username, trader_display_name))')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listMySubscriptions(userId) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, trader_id, price_usd, status, started_at, ends_at, traders!subscriptions_trader_id_fkey(username, trader_display_name)')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ---------------------------------------------------------- notifikasi ---
export async function listMyNotifications(userId, limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, title, message, signal_id, is_read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function markAllNotificationsRead(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false)
    .select('id');
  if (error) throw error;
  return data || [];
}

// B4-05: tandai SATU notifikasi sebagai dibaca saat diklik.
export async function markNotificationRead(notifId) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notifId);
  if (error) throw error;
}

// ----------------------------------------------------------------- foto ---
// Upload avatar ke bucket Storage 'avatars' (migrasi 08_storage_avatars).
// target 'profile' -> profiles.avatar_url; 'trader' -> traders.trader_avatar_url.
// Gagal dengan pesan jelas bila bucket belum diterapkan di dashboard.
// Jalur file Storage dari URL publik avatar
// (.../storage/v1/object/public/avatars/<userId>/avatar-<ts>.<ext>).
function avatarPathFromUrl(url) {
  const m = String(url || '').match(/\/avatars\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function uploadAvatar(file, userId, { target = 'profile', oldUrl = null } = {}) {
  if (!file || !userId) throw new Error('avatar-missing');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type || undefined });
  if (upErr) throw new Error('avatar-upload:' + (upErr.message || 'gagal'));
  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = pub?.publicUrl;
  if (!url) throw new Error('avatar-url');
  if (target === 'trader') {
    const { error: trErr } = await supabase
      .from('traders')
      .update({ trader_avatar_url: url })
      .eq('profile_id', userId);
    if (trErr) throw trErr;
  } else {
    const { error: profErr } = await supabase
      .from('profiles')
      .update({ avatar_url: url })
      .eq('id', userId);
    if (profErr) throw profErr;
  }
  // A-05: hapus file avatar lama (best effort) agar tidak yatim di
  // Storage — baru dihapus SETELAH unggahan + DB berhasil, supaya foto
  // lama tetap ada bila unggahan gagal.
  const oldPath = avatarPathFromUrl(oldUrl);
  if (oldPath && oldPath !== path) {
    try { await supabase.storage.from('avatars').remove([oldPath]); } catch (e) { /* abaikan */ }
  }
  return url;
}


// ------------------------------------------------------- username (D05) ---
// Cek ketersediaan username (dipakai debounce 250 ms di form). RPC
// check_username mengembalikan {ok, code} — code: ok|empty|format|
// banned|reserved|taken|cooldown. Validasi format/reserved/taken
// ditegakkan server-side; klien hanya menampilkan hasilnya.
export async function checkUsername(kind, username) {
  const { data, error } = await supabase.rpc('check_username', {
    p_kind: kind,
    p_username: username,
  });
  if (error) throw error;
  return data;
}

// Ubah/tetapkan username FOLLOWER (profiles.username). Cooldown 1x/bulan
// ditegakkan server-side (kecuali akun demo — lihat sql/13).
export async function setFollowerUsername(username) {
  const { data, error } = await supabase.rpc('set_follower_username', {
    p_username: username,
  });
  if (error) throw error;
  return data;
}

// Ubah nama profil (profiles.display_name). Cooldown 1x/bulan ditegakkan
// server-side via RPC yang sama polanya (kecuali akun demo).
export async function setProfileName(displayName) {
  const { data, error } = await supabase.rpc('set_profile_name', {
    p_display_name: displayName,
  });
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------- foto ---
// Hapus avatar (D06): hapus file dari Storage 'avatars' lalu null-kan URL.
// Path file dipulihkan dari URL publik (…/avatars/<path>).
export async function deleteAvatar(userId, { target = 'profile' } = {}) {
  const { data: row, error: readErr } = await supabase
    .from(target === 'trader' ? 'traders' : 'profiles')
    .select(target === 'trader' ? 'trader_avatar_url' : 'avatar_url')
    .eq(target === 'trader' ? 'profile_id' : 'id', userId)
    .maybeSingle();
  if (readErr) throw readErr;
  const url = row ? (row.trader_avatar_url || row.avatar_url) : null;
  if (url) {
    const m = String(url).match(/\/avatars\/(.+)$/);
    if (m) {
      const { error: rmErr } = await supabase.storage.from('avatars').remove([decodeURIComponent(m[1])]);
      if (rmErr) throw new Error('avatar-delete:' + (rmErr.message || 'gagal'));
    }
  }
  if (target === 'trader') {
    const { error } = await supabase.from('traders').update({ trader_avatar_url: null }).eq('profile_id', userId);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
    if (error) throw error;
  }
}

// -------------------------------------------------------------- salinan ---
// Hapus salinan follower (D14). RLS copies_delete_own mengizinkan pemilik.
export async function uncopy(copyId) {
  const { error } = await supabase.from('copies').delete().eq('id', copyId);
  if (error) throw error;
}

// Catat salinan sinyal follower (B2-01). Lot = lot sinyal sumber (prototipe).
// unique (follower_id, signal_id) mencegah salinan ganda di DB.
export async function copySignal(userId, signalId, lotSize) {
  const { data, error } = await supabase
    .from('copies')
    .insert({ follower_id: userId, signal_id: signalId, lot_size: lotSize })
    .select('id')
    .single();
  if (error) throw error;
  return data;
}

// ----------------------------------------------------------------- harga ---
// Tabel prices dibaca publik (cache harga live, diisi cron Fase 3 tiap
// 15 menit). Dipakai kalkulasi risiko client + ticker Beranda (R37).
export async function getPrices() {
  const { data, error } = await supabase.from('prices').select('pair, price');
  if (error) throw error;
  const map = new Map();
  for (const row of data || []) map.set(row.pair, Number(row.price));
  return map;
}
