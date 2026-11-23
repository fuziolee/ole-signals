// OLE Signals — aplikasi web (Fase 1).
// Semua data dari database Supabase; tidak ada data seed, tidak ada
// localStorage sebagai sumber kebenaran (hanya preferensi tema/bahasa).
// Tulis sinyal HANYA lewat RPC (lihat js/api.js).

import { supabase } from './supabase.js';
import { t, setLang, getLang } from './i18n.js';
import { levelName, levelRef, nextLevelRef, downLevelRef, PAY_GATE_LEVEL, START_BALANCE_USD } from './levels.js';
import { PAIRS, calcRr, calcRisk, quoteToUsd, contractSize, validateSignal, decimalsForPair } from './risk.js';
import { computeStats, rankedTraders, sparklineSVG, pipSize, pipsPnl } from './stats.js';
import * as api from './api.js';

// ---------------------------------------------------------------- state ---
const S = {
  session: null,
  user: null,
  profile: null,
  trader: null, // baris traders + trader_progress (null bila belum ada)
  prices: new Map(),
  view: 'home',
  officeTab: 'PENDING',
  officeRole: 'trader',
  officeTraderTab: 'sinyal',
  officeFollowerTab: 'sinyal',
  officeFollowedTab: 'traders',
  traderProfileTab: 'sinyal',
  traderProfileFilter: 'ALL',
  searchQuery: '',
  searchSort: 'level',
  searchTab: 'traders',
  searchFilters: { q: '', pair: 'ALL', topPair: 'ALL', sort: 'level', wrMin: '0', rrMin: '0', pfMin: '0', levelMin: '0', price: 'all', rfMin: '0' },
  searchDraft: null,
  searchPfHidden: 0,
  feedFilter: { pair: 'ALL', status: 'ALL', followed: false },
  guideOpen: loadGuideOpen(),
  editingId: null,
  editingVersion: null,
  homeSignals: [],
  mySignals: [],
  traderSignals: [],
  traders: [],
  allSignals: [],
  allSignalsLoaded: false,
  demoIds: new Set(),
  notifs: [],
  notifOpen: false,
  myFollows: [],
  myCopies: [],
  mySubs: [],
  boardPage: 1,
  settingsSub: null,
  authMode: 'login',
};

// ---------------------------------------------------------------- util ---
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function fmtUsd(n) { return usdFmt.format(Number(n) || 0); }
export function fmtNum(n, d = 2) {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtR(n) {
  const v = Number(n) || 0;
  return (v > 0 ? '+' : '') + v.toFixed(1) + 'R';
}
export function fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'id-ID', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch (e) { return String(iso || ''); }
}
export function fmtExpiry(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return t('expired');
  const mins = Math.floor(ms / 60000);
  if (mins >= 1440) return t('expiresIn', { txt: t('days', { n: Math.floor(mins / 1440) }) });
  if (mins >= 60) return t('expiresIn', { txt: t('hours', { n: Math.floor(mins / 60) }) });
  return t('expiresIn', { txt: t('mins', { n: Math.max(1, mins) }) });
}

// Embed PostgREST bisa objek (relasi to-one) — normalisasi defensif.
// Bila sinyal datang tanpa embed traders (mis. dari listAllSignals),
// cari namanya di daftar trader yang sudah dimuat.
function one(x) { return Array.isArray(x) ? x[0] : x; }
function traderOf(sig) {
  const emb = one(sig.traders);
  if (emb && (emb.trader_display_name || emb.trader_progress)) return emb;
  const fromList = S.traders.find((x) => x.profile_id === sig.trader_id);
  if (fromList) return fromList;
  return emb || {};
}
function progressOf(trader) { return one(trader?.trader_progress) || null; }
function levelOfSignal(sig) {
  const p = progressOf(traderOf(sig));
  return p ? Number(p.level) || 1 : 1;
}
function isLockedForMe(sig) {
  if (!sig) return false;
  if (S.user && sig.trader_id === S.user.id) return false; // sinyal sendiri
  return levelOfSignal(sig) >= PAY_GATE_LEVEL;
}

// ------------------------------------------------------- avatar & demo ---
// Palet avatar prototipe — warna deterministik dari id (bukan data palsu).
const AVATAR_COLORS = ['#444f55', '#0c6e63', '#7c4dbd', '#b3541e', '#2b5ea7', '#8a6d1d', '#5b7a3a', '#c2185b'];
function avatarColor(id) {
  const s = String(id || '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initialOf(name) {
  return (String(name || '?').trim().charAt(0) || '?').toUpperCase();
}
function avatarHtml(name, id, sizeCls = 'avatar-sm') {
  return `<span class="avatar ${sizeCls}" style="background:${avatarColor(id)}" aria-hidden="true">${esc(initialOf(name))}</span>`;
}
function isDemo(traderId) {
  return S.demoIds.has(traderId);
}
function demoBadge(traderId) {
  return isDemo(traderId) ? ` <span class="pill demo">${esc(t('demoBadge'))}</span>` : '';
}

// ------------------------------------------------------------- statistik ---
// Cache sinyal ringan untuk semua perhitungan statistik client-side.
async function ensureAllSignals() {
  if (S.allSignalsLoaded) return S.allSignals;
  try {
    S.allSignals = await api.listAllSignals();
    S.allSignalsLoaded = true;
  } catch (e) {
    S.allSignals = [];
  }
  return S.allSignals;
}
function signalsOfTrader(traderId) {
  return S.allSignals.filter((s) => s.trader_id === traderId);
}
function statsForTrader(traderId) {
  return computeStats(signalsOfTrader(traderId));
}
function topPairOf(traderId) {
  const counts = {};
  for (const s of signalsOfTrader(traderId)) counts[s.pair] = (counts[s.pair] || 0) + 1;
  let best = null;
  let bestN = 0;
  for (const [pair, n] of Object.entries(counts)) {
    if (n > bestN) { best = pair; bestN = n; }
  }
  return best;
}
function fmtRf(v) {
  if (v === null || v === undefined) return '—';
  if (v === Infinity) return '∞';
  return Number(v).toFixed(1) + 'x';
}
function fmtPf(v) {
  if (v === null || v === undefined) return '—';
  if (v === Infinity) return '∞';
  return Number(v).toFixed(2);
}
function fmtHold(v) {
  if (v === null || v === undefined) return '—';
  return String(v);
}

// ---------------------------------------------------------- notifikasi ---
function getNotifPrefs() {
  try {
    const v = JSON.parse(localStorage.getItem('ole-notif-prefs') || '{}');
    return {
      newSignal: v.newSignal !== false,
      tpSl: v.tpSl !== false,
      edited: v.edited !== false,
      expired: v.expired !== false,
      dup: v.dup !== false,
      sub: v.sub !== false,
    };
  } catch (e) {
    return { newSignal: true, tpSl: true, edited: true, expired: true, dup: true, sub: true };
  }
}
function saveNotifPrefs(prefs) {
  try { localStorage.setItem('ole-notif-prefs', JSON.stringify(prefs)); } catch (e) { /* abaikan */ }
}
async function loadNotifications() {
  if (!S.user) { S.notifs = []; return; }
  try {
    S.notifs = await api.listMyNotifications(S.user.id);
  } catch (e) {
    S.notifs = [];
  }
  paintNotifBadge();
}
function paintNotifBadge() {
  const badge = $('#notif-badge');
  if (!badge) return;
  const unread = S.notifs.filter((n) => !n.is_read).length;
  badge.hidden = unread === 0;
  badge.textContent = String(unread);
}
function renderNotifPanel() {
  const panel = $('#notif-panel');
  if (!panel) return;
  const unread = S.notifs.filter((n) => !n.is_read).length;
  let html = `<div class="notif-head"><h3>${esc(t('notifTitle'))}</h3>`
    + (unread > 0 ? `<button class="btn ghost" id="notif-mark-all" type="button" style="min-height:34px;padding:6px 12px;font-size:12.5px;">${esc(t('notifMarkAll'))}</button>` : '')
    + `</div>`;
  if (!S.notifs.length) {
    html += `<div class="empty" style="padding:24px 12px;"><strong>${esc(t('notifEmpty'))}</strong>${esc(t('notifEmptyHint'))}</div>`;
  } else {
    html += S.notifs.map((n) => `<div class="notif-item${n.is_read ? '' : ' unread'}" data-notif="${esc(n.id)}" data-sig="${esc(n.signal_id || '')}" tabindex="0" role="button">`
      + `<div class="nt">${esc(n.title)}</div>`
      + `<div class="nm">${esc(n.message)}</div>`
      + `<div class="ntime">${esc(fmtDate(n.created_at))}</div></div>`).join('');
  }
  html += `<p class="notif-foot">${esc(t('notifSettingsHint'))}</p>`;
  panel.innerHTML = html;
  const markAll = $('#notif-mark-all');
  if (markAll) {
    markAll.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await api.markAllNotificationsRead(S.user.id);
        await loadNotifications();
        renderNotifPanel();
        toast(t('toastNotifRead'));
      } catch (err) {
        toast(t('errNetwork'), true);
      }
    });
  }
  $$('[data-notif]', panel).forEach((el) => {
    const open = () => {
      setNotifPanel(false);
      if (el.dataset.sig) openSignalDetail(el.dataset.sig);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}
function setNotifPanel(open) {
  S.notifOpen = open;
  const panel = $('#notif-panel');
  if (!panel) return;
  panel.hidden = !open;
  if (open) renderNotifPanel();
}

// ---------------------------------------------------------------- toast ---
export function toast(msg, isErr = false) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function rpcErrorMessage(res) {
  if (!res) return t('errNetwork');
  if (res.ok) return '';
  const map = {
    pairlimit: 'errPairlimit', notpending: 'errNotpending', conflict: 'errConflict',
    needusername: 'errNeedusername', rr: 'errRr', risk: 'errRisk', invalid: 'errInvalid',
    pair: 'errPair',
  };
  if (res.code && map[res.code]) return t(map[res.code]);
  return res.message || t('errInvalid');
}

function authErrorMessage(err) {
  const m = String(err?.message || '');
  if (/invalid login credentials/i.test(m)) return t('authErrInvalid');
  if (/already registered|already exists/i.test(m)) return t('authErrRegistered');
  if (/password.*(6|short|weak)|weak/i.test(m)) return t('authErrWeak');
  if (/failed to fetch|network/i.test(m)) return t('errNetwork');
  return t('authErrGeneric');
}

// -------------------------------------------------------------- overlay ---
function openOverlay(html) {
  const sheet = $('#overlay-sheet');
  sheet.innerHTML = html;
  $('#overlay').classList.add('open');
}
function closeOverlay() {
  $('#overlay').classList.remove('open');
  $('#overlay-sheet').innerHTML = '';
}
$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeOverlay();
});

// Dialog konfirmasi kecil. Mengembalikan Promise<boolean>.
export function confirmDialog(title, body, yesLabel) {
  return new Promise((resolve) => {
    openOverlay(`
      <h2>${esc(title)}</h2>
      <p style="color:var(--muted); font-size:14px;">${esc(body)}</p>
      <div class="row" style="margin-top:16px;">
        <button class="btn danger" id="cf-yes" type="button">${esc(yesLabel)}</button>
        <button class="btn" id="cf-no" type="button">${esc(t('cancel'))}</button>
      </div>`);
    $('#cf-yes').onclick = () => { closeOverlay(); resolve(true); };
    $('#cf-no').onclick = () => { closeOverlay(); resolve(false); };
  });
}

// --------------------------------------------------------- tema & bahasa ---
function getThemePref() {
  try { return localStorage.getItem('ole-theme') || 'auto'; } catch (e) { return 'auto'; }
}
function applyTheme() {
  const pref = getThemePref();
  document.documentElement.setAttribute('data-theme', pref === 'auto' ? 'auto' : pref);
}
function setThemePref(pref) {
  try { localStorage.setItem('ole-theme', pref); } catch (e) { /* abaikan */ }
  applyTheme();
}

function applyI18n() {
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.documentElement.lang = getLang();
  $('#auth-submit').textContent = S.authMode === 'login' ? t('login') : t('signup');
  $('#auth-toggle').textContent = S.authMode === 'login' ? t('noAccount') : t('haveAccount');
  // Auth: petunjuk sandi + konfirmasi hanya saat daftar, bukan saat masuk.
  const signup = S.authMode === 'signup';
  $('#password-hint').hidden = !signup;
  $('#auth-confirm-field').hidden = !signup;
  const pw = $('#auth-password');
  pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  if (signup) pw.setAttribute('minlength', '8'); else pw.removeAttribute('minlength');
  if (!signup) { $('#auth-password-confirm').value = ''; setMatchHint(''); }
}

// Aturan kata sandi saat daftar: minimal 8 karakter, ada angka + huruf kapital.
function passwordValid(pw) {
  return pw.length >= 8 && /[0-9]/.test(pw) && /[A-Z]/.test(pw);
}
function setMatchHint(state) {
  const el = $('#password-match-hint');
  el.classList.remove('ok', 'bad');
  if (state === 'match') { el.textContent = t('passwordMatch'); el.classList.add('ok'); }
  else if (state === 'mismatch') { el.textContent = t('passwordMismatch'); el.classList.add('bad'); }
  else { el.textContent = ''; }
}
function refreshMatchHint() {
  if (S.authMode !== 'signup') return;
  const pw = $('#auth-password').value;
  const cf = $('#auth-password-confirm').value;
  if (!cf) { setMatchHint(''); return; }
  setMatchHint(pw === cf ? 'match' : 'mismatch');
}
$('#auth-password').addEventListener('input', refreshMatchHint);
$('#auth-password-confirm').addEventListener('input', refreshMatchHint);

// ------------------------------------------------------------------ nav ---
const VIEWS = ['home', 'search', 'office', 'profile', 'guide', 'settings', 'help'];
function showView(name) {
  S.view = name;
  VIEWS.forEach((v) => $('#view-' + v).classList.toggle('active', v === name));
  $$('.bottom-nav [data-nav]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.nav === name));
  });
  window.scrollTo({ top: 0 });
  if (name === 'home') renderHome();
  if (name === 'search') renderSearch();
  if (name === 'office') renderOffice();
  if (name === 'profile') renderProfile();
  if (name === 'guide') renderGuide();
  if (name === 'settings') renderSettings();
  if (name === 'help') renderHelp();
}
$$('.bottom-nav [data-nav]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.nav));
});
$$('#search-tabs [data-stab]').forEach((b) => {
  b.addEventListener('click', () => {
    S.searchTab = b.dataset.stab;
    renderSearch();
  });
});
$('#btn-guide-back').addEventListener('click', () => showView('profile'));
$('#btn-settings-back').addEventListener('click', () => showView('profile'));
$('#btn-help-back').addEventListener('click', () => showView('profile'));
$('#btn-refresh-home').addEventListener('click', () => renderHome(true));
$('#btn-hero-search').addEventListener('click', () => showView('search'));
$('#btn-hero-guide').addEventListener('click', () => showView('guide'));
$('#notif-bell').addEventListener('click', (e) => {
  e.stopPropagation();
  setNotifPanel(!S.notifOpen);
});
document.addEventListener('click', (e) => {
  if (S.notifOpen && !e.target.closest('.notif-wrap')) setNotifPanel(false);
});

// ----------------------------------------------------------------- auth ---
function showAuth() {
  $('#app').hidden = true;
  $('#auth-view').hidden = false;
  applyI18n();
}
function showApp() {
  $('#auth-view').hidden = true;
  $('#app').hidden = false;
  applyI18n();
}

async function refreshIdentity() {
  if (!S.user) { S.profile = null; S.trader = null; return; }
  try {
    const [profile, trader] = await Promise.all([
      api.getMyProfile(S.user.id),
      api.getMyTrader(S.user.id),
    ]);
    S.profile = profile;
    S.trader = trader;
  } catch (e) {
    console.error('refreshIdentity', e);
    toast(t('errNetwork'), true);
  }
}

$('#auth-toggle').addEventListener('click', () => {
  S.authMode = S.authMode === 'login' ? 'signup' : 'login';
  $('#auth-error').hidden = true;
  $('#auth-notice').hidden = true;
  applyI18n();
});

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const errBox = $('#auth-error');
  const noteBox = $('#auth-notice');
  errBox.hidden = true;
  noteBox.hidden = true;
  const btn = $('#auth-submit');
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('loading') + '…';
  try {
    if (S.authMode === 'signup') {
      if (!passwordValid(password)) {
        errBox.textContent = t('authErrWeak');
        errBox.hidden = false;
        return;
      }
      if (password !== $('#auth-password-confirm').value) {
        errBox.textContent = t('passwordMismatch');
        errBox.hidden = false;
        return;
      }
      const data = await api.signUp(email, password);
      if (!data.session) {
        noteBox.textContent = t('authCheckEmail');
        noteBox.hidden = false;
      }
      // Bila ada sesi langsung, onAuthStateChange yang mengurus sisanya.
    } else {
      await api.signIn(email, password);
    }
  } catch (err) {
    errBox.textContent = authErrorMessage(err);
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = btnLabel;
  }
});

async function handleSession(session) {
  S.session = session;
  S.user = session?.user || null;
  if (!S.user) {
    showAuth();
    return;
  }
  await refreshIdentity();
  try { S.prices = await api.getPrices(); } catch (e) { S.prices = new Map(); }
  try { S.demoIds = new Set(await api.listDemoTraderIds()); } catch (e) { S.demoIds = new Set(); }
  await loadNotifications();
  showApp();
  showView('home');
}

// ---------------------------------------------------------- kartu sinyal ---
function statusPill(status) {
  const cls = { PENDING: '', AKTIF: 'green', WIN: 'green', LOSS: 'red', CANCELLED: '', EXPIRED: '' }[status] || '';
  const label = { PENDING: 'pending', AKTIF: 'active', WIN: 'win', LOSS: 'loss', CANCELLED: 'cancelled', EXPIRED: 'expired' }[status] || status;
  return `<span class="pill ${cls}">${esc(t(label))}</span>`;
}

function priceOf(pair) {
  const v = S.prices.get(pair);
  return typeof v === 'number' && v > 0 ? v : null;
}
function floatingUsd(sig) {
  const now = priceOf(sig.pair);
  if (now === null) return null;
  const conv = quoteToUsd(sig.pair, S.prices);
  if (conv === null || conv === undefined) return null;
  const diff = now - Number(sig.entry);
  const signed = sig.direction === 'SELL' ? -diff : diff;
  return signed * Number(sig.lot_size) * contractSize(sig.pair) * conv;
}
function riskTargetUsd(sig) {
  const rr = calcRr(Number(sig.entry), Number(sig.stop_loss), Number(sig.take_profit));
  const risk = calcRisk({ pair: sig.pair, entry: Number(sig.entry), sl: Number(sig.stop_loss), lot: Number(sig.lot_size), balanceUsd: 0, prices: S.prices });
  if (risk.error || rr === null) return { riskUsd: null, targetUsd: null, rr };
  return { riskUsd: risk.riskUsd, targetUsd: risk.riskUsd * rr, rr };
}

function signalCardHtml(sig) {
  const tr = traderOf(sig);
  const name = tr.trader_display_name || t('noName');
  const level = levelOfSignal(sig);
  const verified = level >= PAY_GATE_LEVEL
    ? ` <span class="pill gold">✓ ${esc(t('verified'))}</span>` : '';
  const mine = S.user && sig.trader_id === S.user.id;
  const locked = isLockedForMe(sig);
  const d = decimalsForPair(sig.pair);
  const dirCls = sig.direction === 'BUY' ? 'buy' : 'sell';
  const wr = statsForTrader(sig.trader_id).wr;
  let levelsHtml;
  if (locked) {
    levelsHtml = `<div class="locked-box"><strong>🔒 ${esc(t('lockedTitle'))}</strong><br>${esc(t('lockedDesc'))}</div>`;
  } else {
    levelsHtml = `<div class="sig-levels">
      <div class="lv"><small>${esc(t('entry'))}</small><b class="mono">${fmtNum(sig.entry, d)}</b></div>
      <div class="lv"><small>${esc(t('stopLoss'))}</small><b class="mono">${fmtNum(sig.stop_loss, d)}</b></div>
      <div class="lv"><small>${esc(t('takeProfit'))}</small><b class="mono">${fmtNum(sig.take_profit, d)}</b></div>
    </div>`;
  }
  // Fakta kaki kartu: lot · risiko USD (pips) · target USD (pips) · R:R.
  const rt = riskTargetUsd(sig);
  const riskPips = Math.abs(Number(sig.entry) - Number(sig.stop_loss)) / pipSize(sig.pair);
  const targetPips = Math.abs(Number(sig.take_profit) - Number(sig.entry)) / pipSize(sig.pair);
  const factsHtml = locked ? '' : `<div class="sig-facts"><span>${esc(fmtNum(sig.lot_size, 2))} lot</span>`
    + `<span>${esc(t('riskUsd'))}: <b>${rt.riskUsd !== null ? esc(fmtUsd(rt.riskUsd)) : '—'}</b> (${Math.round(riskPips)} pips)</span>`
    + `<span>${esc(t('sigTarget'))}: <b>${rt.targetUsd !== null ? esc(fmtUsd(rt.targetUsd)) : '—'}</b> (${Math.round(targetPips)} pips)</span>`
    + `<span>${esc(t('riskReward'))}: <b>1:${rt.rr !== null ? rt.rr.toFixed(2) : '—'}</b></span></div>`;
  // Bilah progres untuk AKTIF (SL—floating—TP); tanpa harga live, bilah
  // tampil tanpa isi dan floating "—" (jujur, bukan posisi palsu).
  let progHtml = '';
  if (sig.status === 'AKTIF' && !locked) {
    const now = priceOf(sig.pair);
    const fl = floatingUsd(sig);
    const denom = Number(sig.take_profit) - Number(sig.stop_loss);
    const pct = now !== null && denom !== 0
      ? Math.min(100, Math.max(0, ((now - Number(sig.stop_loss)) / denom) * 100))
      : 0;
    progHtml = `<div class="sig-prog"><div class="progress"><div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div>`
      + `<small>${esc(t('sigFloating'))}: <b>${fl !== null ? esc(fmtUsd(fl)) : '—'}</b>${now !== null ? ` · ${esc(t('sigNow'))} ${esc(fmtNum(now, d))}` : ` · ${esc(t('sigNoPrice'))}`}</small></div>`
      + `<div class="ends"><span>SL ${esc(fmtNum(sig.stop_loss, d))}</span><span>TP ${esc(fmtNum(sig.take_profit, d))}</span></div></div>`;
  }
  // Catatan PENDING: jarak ke entry bila harga tersedia.
  let pendHtml = '';
  if (sig.status === 'PENDING' && !locked) {
    const now = priceOf(sig.pair);
    if (now !== null) {
      const distPips = Math.abs(now - Number(sig.entry)) / pipSize(sig.pair);
      pendHtml = `<div class="sig-meta">${esc(t('sigDistEntry'))}: ${Math.round(distPips)} pips · ${esc(t('sigNow'))} ${esc(fmtNum(now, d))}</div>`;
    }
  }
  const profitHtml = (sig.status === 'WIN' || sig.status === 'LOSS') && sig.profit_usd !== null && sig.profit_usd !== undefined
    ? `<div class="sig-meta">${esc(fmtUsd(sig.profit_usd))}${sig.r_value !== null && sig.r_value !== undefined ? ` · ${esc(fmtR(sig.r_value))}` : ''}${sig.profit_pips !== null && sig.profit_pips !== undefined ? ` · ${Math.round(Number(sig.profit_pips))} pips` : ''}</div>`
    : '';
  const createdHtml = sig.status === 'PENDING'
    ? `<div class="sig-meta">${esc(t('createdAt'))} ${esc(fmtDate(sig.created_at))} · ${esc(fmtExpiry(sig.expires_at))}</div>`
    : `<div class="sig-meta">${esc(t('createdAt'))} ${esc(fmtDate(sig.created_at))}</div>`;
  const actions = [];
  actions.push(`<button class="btn" type="button" data-act="detail" data-sig="${esc(sig.id)}">${esc(t('sigDetail'))}</button>`);
  if (!locked && !mine) {
    actions.push(`<button class="btn" type="button" data-act="copy" data-sig="${esc(sig.id)}">⧉ ${esc(t('copySignal'))}</button>`);
  }
  if (mine && sig.status === 'PENDING') {
    actions.push(`<button class="btn" type="button" data-act="edit" data-sig="${esc(sig.id)}">${esc(t('editSignal'))}</button>`);
    actions.push(`<button class="btn danger" type="button" data-act="cancel" data-sig="${esc(sig.id)}">${esc(t('cancelSignal'))}</button>`);
  }
  return `<article class="sig ${dirCls}" data-sig="${esc(sig.id)}" tabindex="0" role="button">
    <div class="sig-head">
      <span class="sig-pair sig-pair-lg">${esc(sig.pair)}</span>
      <span class="dir ${dirCls}">${esc(sig.direction)}</span>
      ${statusPill(sig.status)}
      <span class="spacer"></span>
      <span class="pill">${esc(fmtNum(sig.lot_size, 2))} lot</span>
    </div>
    <div class="sig-top">${avatarHtml(name, sig.trader_id, 'avatar-sm')}<div class="who"><div class="nm">${mine ? esc(t('you')) + ' · ' : ''}${esc(name)}${demoBadge(sig.trader_id)}</div><div class="mt">Lv.${level} ${esc(levelName(level, getLang()))}${wr !== null ? ` · WR ${wr.toFixed(1)}%` : ''}${verified}</div></div></div>
    ${levelsHtml}
    ${progHtml}
    ${pendHtml}
    ${factsHtml}
    ${profitHtml}
    ${createdHtml}
    <div class="sig-actions">${actions.join('')}</div>
  </article>`;
}

function bindSignalCards(root) {
  $$('[data-sig]', root).forEach((el) => {
    const open = () => openSignalDetail(el.dataset.sig);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-act]')) return;
      open();
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
  $$('[data-act]', root).forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.sig;
      const act = btn.dataset.act;
      if (act === 'detail') { openSignalDetail(id); return; }
      if (act === 'copy') { await copySignalText(id); return; }
      if (act === 'edit') {
        const sig = findSignal(id);
        if (sig) startEditSignal(sig);
        return;
      }
      if (act === 'cancel') {
        const sig = findSignal(id);
        if (!sig) return;
        const yes = await confirmDialog(t('confirmCancelTitle'), t('confirmCancelBody'), t('yesCancel'));
        if (!yes) return;
        try {
          const res = await api.cancelSignal(sig.id);
          if (!res.ok) { toast(rpcErrorMessage(res), true); return; }
          toast(t('toastCancelled'));
          await renderOffice();
          await renderHome();
        } catch (err) {
          toast(t('errNetwork'), true);
        }
      }
    });
  });
}

async function copySignalText(id) {
  const sig = findSignal(id);
  if (!sig) return;
  const text = `${sig.pair} ${sig.direction} @ ${sig.entry} | SL ${sig.stop_loss} | TP ${sig.take_profit} | ${sig.lot_size} lot — OLE Signals`;
  try { await navigator.clipboard.writeText(text); } catch (e) { /* abaikan */ }
  toast(t('toastCopied'));
}

function findSignal(id) {
  return S.homeSignals.find((s) => s.id === id)
    || S.mySignals.find((s) => s.id === id)
    || S.traderSignals.find((s) => s.id === id)
    || S.allSignals.find((s) => s.id === id)
    || null;
}

// ------------------------------------------------------- kartu bagikan ---
// ID kartu + kode verifikasi deterministik dari UUID sinyal (FNV-1a),
// pola yang sama seperti prototipe. Tautan verifikasi tampil sebagai teks;
// kode QR menyusul (butuh pustaka QR).
function shareCardId(sig) {
  return 'SM-' + String(sig.id).replace(/-/g, '').slice(0, 8).toUpperCase();
}
function verifyCode(sig) {
  const s = String(sig.id);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ('0000000' + (h >>> 0).toString(16).toUpperCase()).slice(-8);
}
function shareVerifyUrl(sig) {
  return `https://olesignals.onrender.com/v/${shareCardId(sig)}?code=${verifyCode(sig)}`;
}
function shareCardText(sig) {
  const tr = traderOf(sig);
  const name = tr.trader_display_name || t('noName');
  return `OLE Signals — ${sig.pair} ${sig.direction}\n`
    + `Trader: ${name} (Lv.${levelOfSignal(sig)} ${levelName(levelOfSignal(sig), getLang())})\n`
    + `Entry ${sig.entry} | SL ${sig.stop_loss} | TP ${sig.take_profit} | ${sig.lot_size} lot\n`
    + `${t('sigShareId')}: ${shareCardId(sig)} | ${t('sigShareCode')}: ${verifyCode(sig)}\n`
    + `${shareVerifyUrl(sig)}`;
}
function drawShareCard(sig) {
  const cv = document.createElement('canvas');
  cv.width = 1080;
  cv.height = 1080;
  const ctx = cv.getContext('2d');
  const tr = traderOf(sig);
  const name = tr.trader_display_name || t('noName');
  const level = levelOfSignal(sig);
  const d = decimalsForPair(sig.pair);
  const dirColor = sig.direction === 'BUY' ? '#16A34A' : '#DC2626';
  // Latar + merek.
  ctx.fillStyle = '#0B1220';
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = '#0891B2';
  ctx.fillRect(0, 0, 1080, 10);
  ctx.fillStyle = '#F5F7FA';
  ctx.font = '800 44px Inter, sans-serif';
  ctx.fillText('OLE Signals', 72, 110);
  ctx.fillStyle = '#8A94A6';
  ctx.font = '500 26px Inter, sans-serif';
  ctx.fillText(t('appTagline'), 72, 152);
  // Trader.
  ctx.fillStyle = avatarColor(sig.trader_id);
  ctx.beginPath();
  ctx.arc(108, 240, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '800 40px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(initialOf(name), 108, 254);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#F5F7FA';
  ctx.font = '700 38px Inter, sans-serif';
  ctx.fillText(name, 176, 232);
  ctx.fillStyle = '#8A94A6';
  ctx.font = '500 28px Inter, sans-serif';
  ctx.fillText(`Lv.${level} ${levelName(level, getLang())}${isDemo(sig.trader_id) ? ' · Demo' : ''}`, 176, 272);
  // Pair + arah.
  ctx.fillStyle = '#F5F7FA';
  ctx.font = '800 92px Inter, sans-serif';
  ctx.fillText(sig.pair, 72, 420);
  ctx.fillStyle = dirColor;
  ctx.font = '800 52px Inter, sans-serif';
  ctx.fillText(sig.direction, 72, 490);
  ctx.fillStyle = '#8A94A6';
  ctx.font = '600 30px Inter, sans-serif';
  ctx.fillText(statusPillLabel(sig.status), 72, 540);
  // Entry / SL / TP.
  const rows = [
    [t('entry'), fmtNum(sig.entry, d)],
    [t('stopLoss'), fmtNum(sig.stop_loss, d)],
    [t('takeProfit'), fmtNum(sig.take_profit, d)],
  ];
  ctx.font = '500 30px Inter, sans-serif';
  rows.forEach(([label, val], i) => {
    const y = 640 + i * 72;
    ctx.fillStyle = '#8A94A6';
    ctx.fillText(label, 72, y);
    ctx.fillStyle = '#F5F7FA';
    ctx.font = '700 34px "IBM Plex Mono", monospace';
    ctx.fillText(val, 420, y);
    ctx.font = '500 30px Inter, sans-serif';
  });
  ctx.fillStyle = '#8A94A6';
  ctx.font = '500 28px Inter, sans-serif';
  ctx.fillText(`${fmtNum(sig.lot_size, 2)} lot · ${t('sigShareId')}: ${shareCardId(sig)}`, 72, 880);
  ctx.fillText(`${t('sigShareCode')}: ${verifyCode(sig)}`, 72, 924);
  ctx.fillText(shareVerifyUrl(sig), 72, 968);
  ctx.fillStyle = '#64748B';
  ctx.font = '500 24px Inter, sans-serif';
  ctx.fillText(t('riskWarn'), 72, 1030);
  return cv;
}
function statusPillLabel(status) {
  return { PENDING: t('pending'), AKTIF: t('active'), WIN: t('win'), LOSS: t('loss'), CANCELLED: t('cancelled'), EXPIRED: t('expired') }[status] || status;
}
async function downloadShareCard(sig) {
  try {
    const cv = drawShareCard(sig);
    const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no-blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${shareCardId(sig)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t('toastShareSaved'));
  } catch (e) {
    toast(t('errNetwork'), true);
  }
}

function openSignalDetail(id) {
  const sig = findSignal(id);
  if (!sig) return;
  const tr = traderOf(sig);
  const name = tr.trader_display_name || t('noName');
  const level = levelOfSignal(sig);
  const verified = level >= PAY_GATE_LEVEL
    ? ` <span class="pill gold">✓ ${esc(t('verified'))}</span>` : '';
  const mine = S.user && sig.trader_id === S.user.id;
  const locked = isLockedForMe(sig);
  const d = decimalsForPair(sig.pair);
  const dirCls = sig.direction === 'BUY' ? 'buy' : 'sell';
  const levelsHtml = locked
    ? `<div class="locked-box"><strong>🔒 ${esc(t('lockedTitle'))}</strong><br>${esc(t('lockedDesc'))}</div>`
    : `<div class="sig-levels">
        <div class="lv"><small>${esc(t('entry'))}</small><b class="mono">${fmtNum(sig.entry, d)}</b></div>
        <div class="lv"><small>${esc(t('stopLoss'))}</small><b class="mono">${fmtNum(sig.stop_loss, d)}</b></div>
        <div class="lv"><small>${esc(t('takeProfit'))}</small><b class="mono">${fmtNum(sig.take_profit, d)}</b></div>
      </div>`;
  // Bilah progres AKTIF + harga saat ini (bila tersedia).
  let progHtml = '';
  if (sig.status === 'AKTIF' && !locked) {
    const now = priceOf(sig.pair);
    const fl = floatingUsd(sig);
    const denom = Number(sig.take_profit) - Number(sig.stop_loss);
    const pct = now !== null && denom !== 0
      ? Math.min(100, Math.max(0, ((now - Number(sig.stop_loss)) / denom) * 100))
      : 0;
    progHtml = `<div class="sig-prog"><div class="progress"><div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div>`
      + `<small>${esc(t('sigFloating'))}: <b>${fl !== null ? esc(fmtUsd(fl)) : '—'}</b>${now !== null ? ` · ${esc(t('sigNow'))} ${esc(fmtNum(now, d))}` : ` · ${esc(t('sigNoPrice'))}`}</small></div>`
      + `<div class="ends"><span>SL ${esc(fmtNum(sig.stop_loss, d))}</span><span>TP ${esc(fmtNum(sig.take_profit, d))}</span></div></div>`;
  }
  // Baris detail lengkap (prototipe): lot, risiko USD + % saldo, target,
  // R:R, jarak SL/TP (pips), waktu posting/entry/tutup, hasil akhir.
  const rt = riskTargetUsd(sig);
  const balance = progressOf(S.trader) ? Number(progressOf(S.trader).balance_usd) : START_BALANCE_USD;
  const riskPct = rt.riskUsd !== null && balance > 0 ? (rt.riskUsd / balance) * 100 : null;
  const riskPips = Math.abs(Number(sig.entry) - Number(sig.stop_loss)) / pipSize(sig.pair);
  const targetPips = Math.abs(Number(sig.take_profit) - Number(sig.entry)) / pipSize(sig.pair);
  const now = priceOf(sig.pair);
  const rows = [];
  rows.push(`<dt>${esc(t('lot'))}</dt><dd>${esc(fmtNum(sig.lot_size, 2))}</dd>`);
  if (!locked) {
    rows.push(`<dt>${esc(t('riskUsd'))}</dt><dd>${rt.riskUsd !== null ? esc(fmtUsd(rt.riskUsd)) : '—'}${riskPct !== null ? ` (${riskPct.toFixed(2)}% ${esc(t('riskPct'))})` : ''} · ${Math.round(riskPips)} pips</dd>`);
    rows.push(`<dt>${esc(t('sigTarget'))}</dt><dd>${rt.targetUsd !== null ? esc(fmtUsd(rt.targetUsd)) : '—'} · ${Math.round(targetPips)} pips</dd>`);
    rows.push(`<dt>${esc(t('riskReward'))}</dt><dd>1:${rt.rr !== null ? rt.rr.toFixed(2) : '—'}</dd>`);
    if (now !== null) rows.push(`<dt>${esc(t('sigNow'))}</dt><dd>${esc(fmtNum(now, d))}</dd>`);
  }
  rows.push(`<dt>${esc(t('createdAt'))}</dt><dd>${esc(fmtDate(sig.created_at))}</dd>`);
  if (sig.status === 'PENDING') rows.push(`<dt>${esc(t('expires'))}</dt><dd>${esc(fmtExpiry(sig.expires_at))}</dd>`);
  if (sig.activated_at) rows.push(`<dt>${esc(t('sigEntryTime'))}</dt><dd>${esc(fmtDate(sig.activated_at))}</dd>`);
  if (sig.closed_at) rows.push(`<dt>${esc(t('sigCloseTime'))}</dt><dd>${esc(fmtDate(sig.closed_at))}</dd>`);
  if (sig.holding_minutes !== null && sig.holding_minutes !== undefined) {
    rows.push(`<dt>${esc(t('sigHoldPeriod'))}</dt><dd>${esc(fmtHold(sig.holding_minutes))} mnt</dd>`);
  }
  if (sig.status === 'WIN' || sig.status === 'LOSS') {
    rows.push(`<dt>${esc(t('sigExit'))}</dt><dd>${sig.close_price !== null && sig.close_price !== undefined ? esc(fmtNum(sig.close_price, d)) : '—'}</dd>`);
    rows.push(`<dt>${esc(t('sigResult'))}</dt><dd>${esc(fmtUsd(sig.profit_usd))}${sig.r_value !== null && sig.r_value !== undefined ? ` (${esc(fmtR(sig.r_value))})` : ''}${sig.profit_pips !== null && sig.profit_pips !== undefined ? ` · ${Math.round(Number(sig.profit_pips))} pips` : ''}</dd>`);
  }
  const profitHtml = '';
  const actions = [];
  if (mine && sig.status === 'PENDING') {
    actions.push(`<button class="btn" id="ov-edit" type="button">${esc(t('editSignal'))}</button>`);
    actions.push(`<button class="btn danger" id="ov-cancel" type="button">${esc(t('cancelSignal'))}</button>`);
  }
  if (!locked && !mine) {
    actions.push(`<button class="btn" id="ov-copy" type="button">⧉ ${esc(t('copySignal'))}</button>`);
  }
  actions.push(`<button class="btn" id="ov-trader" type="button">${esc(t('sigViewTrader'))}</button>`);
  // Kartu bagikan (hanya sinyal sendiri — sesuai prototipe).
  const shareHtml = mine ? `<div class="share-card"><h3>${esc(t('sigShareTitle'))}</h3>`
    + `<dl class="kv"><dt>${esc(t('sigShareId'))}</dt><dd class="share-id">${esc(shareCardId(sig))}</dd>`
    + `<dt>${esc(t('sigShareCode'))}</dt><dd class="share-id">${esc(verifyCode(sig))}</dd>`
    + `<dt>${esc(t('sigShareUrl'))}</dt><dd style="word-break:break-all;">${esc(shareVerifyUrl(sig))}</dd></dl>`
    + `<p class="note">${esc(t('sigShareNote'))}</p>`
    + `<div class="sig-actions"><button class="btn" id="ov-share-dl" type="button">⬇ ${esc(t('sigShareDownload'))}</button>`
    + `<button class="btn" id="ov-share-copy" type="button">⧉ ${esc(t('sigShareCopy'))}</button></div></div>` : '';
  openOverlay(`
    <button class="btn ghost close-x" id="ov-close" type="button">✕</button>
    <div class="sig-head">
      <span class="sig-pair sig-pair-lg">${esc(sig.pair)}</span>
      <span class="dir ${dirCls}">${esc(sig.direction)}</span>
      ${statusPill(sig.status)}
    </div>
    <div class="sig-top">${avatarHtml(name, sig.trader_id, 'avatar-sm')}<div class="who"><div class="nm">${esc(name)}${demoBadge(sig.trader_id)}</div><div class="mt">Lv.${level} ${esc(levelName(level, getLang()))}${verified}</div></div></div>
    ${levelsHtml}
    ${progHtml}
    <dl class="kv" style="margin-top:12px;">${rows.join('')}</dl>
    ${profitHtml}
    ${!mine ? `<p class="note" style="margin-top:12px;">${esc(t('sigRiskNote'))}</p>` : ''}
    ${shareHtml}
    ${actions.length ? `<div class="sig-actions">${actions.join('')}</div>` : ''}`);
  $('#ov-close').onclick = closeOverlay;
  const copyBtn = $('#ov-copy');
  if (copyBtn) {
    copyBtn.onclick = async () => { await copySignalText(sig.id); };
  }
  const editBtn = $('#ov-edit');
  if (editBtn) {
    editBtn.onclick = () => {
      closeOverlay();
      startEditSignal(sig);
    };
  }
  const cancelBtn = $('#ov-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      const yes = await confirmDialog(t('confirmCancelTitle'), t('confirmCancelBody'), t('yesCancel'));
      if (!yes) return;
      closeOverlay();
      try {
        const res = await api.cancelSignal(sig.id);
        if (!res.ok) { toast(rpcErrorMessage(res), true); return; }
        toast(t('toastCancelled'));
        await renderOffice();
        await renderHome();
      } catch (e) {
        toast(t('errNetwork'), true);
      }
    };
  }
  const traderBtn = $('#ov-trader');
  if (traderBtn) {
    traderBtn.onclick = () => {
      closeOverlay();
      openTraderProfile(sig.trader_id);
    };
  }
  const shareDl = $('#ov-share-dl');
  if (shareDl) shareDl.onclick = () => downloadShareCard(sig);
  const shareCopy = $('#ov-share-copy');
  if (shareCopy) {
    shareCopy.onclick = async () => {
      try { await navigator.clipboard.writeText(shareCardText(sig)); } catch (e) { /* abaikan */ }
      toast(t('toastShareCopied'));
    };
  }
}

// ------------------------------------------------- renderer statistik ---
// Dipakai profil trader, statistik Ruang Kerja, dan jurnal follower.
// Semua angka dari sinyal tertutup nyata (js/stats.js); yang belum bisa
// dihitung tampil "—".
function statsGridHtml(s) {
  const wr = s.wr === null ? '—' : s.wr.toFixed(1) + '%';
  const sk = s.streaks;
  return `<div class="pstats">`
    + `<div class="stat-cell"><div class="num mono">${wr}</div><div class="lbl">${esc(t('stWinRate'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.totalSignals}</div><div class="lbl">${esc(t('stTotalSignalsOpen', { n: s.active }))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${s.totalUSD >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtUsd(s.totalUSD, true))}</div><div class="lbl">${esc(t('stTotalProfit'))} · ${Math.round(s.totalPips)} pips</div></div>`
    + `<div class="stat-cell"><div class="num mono">${fmtPf(s.pf)}</div><div class="lbl">${esc(t('stProfitFactor'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${s.totalR >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtR(s.totalR))}</div><div class="lbl">${esc(t('stTotalR'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.avgR === null ? '—' : esc(fmtR(s.avgR))}</div><div class="lbl">${esc(t('stAvgR'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${sk.longestWin ? 'pips-pos' : ''}">${sk.longestWin || '—'}</div><div class="lbl">${esc(t('stStreakWinLong'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${sk.longestLose ? 'pips-neg' : ''}">${sk.longestLose || '—'}</div><div class="lbl">${esc(t('stStreakLoseLong'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono pips-neg">${s.drawdown.usd > 0 ? '-' + esc(fmtUsd(s.drawdown.usd)) : '—'}</div><div class="lbl">${esc(t('stMaxDD'))}${s.drawdown.usd > 0 ? ` (${s.drawdown.pct.toFixed(1)}%)` : ''}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${fmtRf(s.recovery)}</div><div class="lbl">${esc(t('stRecovery'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${fmtHold(s.avgHold)}</div><div class="lbl">${esc(t('stHoldAvg'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.rr === null ? '—' : '1:' + s.rr.toFixed(1)}</div><div class="lbl">${esc(t('stRRAvg'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.avgSL === null ? '—' : s.avgSL.toFixed(1)}</div><div class="lbl">${esc(t('stAvgSL'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.avgTP === null ? '—' : s.avgTP.toFixed(1)}</div><div class="lbl">${esc(t('stAvgTP'))}</div></div>`
    + `</div>`;
}
function chartCardHtml(s) {
  const inner = s.results.length >= 2
    ? sparklineSVG(s.results)
    : `<div class="empty" style="padding:24px 12px;"><strong>${esc(t('stChartEmpty'))}</strong></div>`;
  return `<div class="chart-card"><h3>${esc(t('stChartTitle'))}</h3><div class="sub">${esc(t('stChartSub'))}</div>${inner}</div>`;
}
function monthTableHtml(months) {
  const body = months.length ? months.map((e) => {
    const mName = new Date(e.year, e.month, 1).toLocaleString(getLang() === 'en' ? 'en-US' : 'id-ID', { month: 'long', year: 'numeric' });
    return `<tr><td class="mono" style="font-weight:700">${esc(mName)}</td>`
      + `<td class="num mono ${e.profit >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtUsd(e.profit, true))}</td>`
      + `<td class="num mono ${e.pips >= 0 ? 'pips-pos' : 'pips-neg'}">${e.pips >= 0 ? '+' : ''}${Math.round(e.pips)}</td>`
      + `<td class="num mono">${e.trades}</td>`
      + `<td class="num mono">${e.wr === null ? '—' : e.wr.toFixed(1) + '%'}</td></tr>`;
  }).join('') : `<tr><td colspan="5" style="color:var(--muted)">${esc(t('stNoTrades'))}</td></tr>`;
  return `<div class="chart-card"><h3>${esc(t('stMonthTitle'))}</h3><div class="sub">${esc(t('stMonthSub'))}</div>`
    + `<div class="board-wrap" style="box-shadow:none"><table class="board"><thead><tr><th>${esc(t('stThMonth'))}</th><th class="num">${esc(t('stThProfit'))}</th><th class="num">${esc(t('stThPips'))}</th><th class="num">${esc(t('stThTrades'))}</th><th class="num">${esc(t('stThWR'))}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
function pairTableHtml(s) {
  const rows = s.perPair.filter((e) => e.trades > 0);
  const body = rows.length ? rows.map((e) => {
    const sk = e.streaks;
    const longTxt = (sk.longestWin || sk.longestLose) ? `${sk.longestWin}W / ${sk.longestLose}L` : '—';
    return `<tr><td class="mono" style="font-weight:700">${esc(e.pair)}</td>`
      + `<td class="num mono">${e.trades}</td>`
      + `<td class="num mono">${e.wr === null ? '—' : e.wr.toFixed(1) + '%'}</td>`
      + `<td class="num mono ${e.totalUSD >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtUsd(e.totalUSD, true))}</td>`
      + `<td class="num mono">${fmtPf(e.pf)}</td>`
      + `<td class="num mono ${e.totalR >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtR(e.totalR))}</td>`
      + `<td class="num mono">${e.avgR === null ? '—' : esc(fmtR(e.avgR))}</td>`
      + `<td class="num mono">${e.avgSL === null ? '—' : e.avgSL.toFixed(1)}</td>`
      + `<td class="num mono">${e.avgTP === null ? '—' : e.avgTP.toFixed(1)}</td>`
      + `<td class="num mono">${longTxt}</td>`
      + `<td class="num mono pips-neg">${e.drawdown.usd > 0 ? '-' + esc(fmtUsd(e.drawdown.usd)) + ` (${e.drawdown.pct.toFixed(1)}%)` : '—'}</td>`
      + `<td class="num mono">${fmtRf(e.recovery)}</td>`
      + `<td class="num mono">${fmtHold(e.avgHold)}</td></tr>`;
  }).join('') : `<tr><td colspan="13" style="color:var(--muted)">${esc(t('stPairEmpty'))}</td></tr>`;
  return `<div class="chart-card"><h3>${esc(t('stPairTitle'))}</h3><div class="sub">${esc(t('stPairSub'))}</div>`
    + `<div class="board-wrap" style="box-shadow:none"><table class="board"><thead><tr><th>${esc(t('stThPair'))}</th><th class="num">${esc(t('stThTrades'))}</th><th class="num">${esc(t('stThWR'))}</th><th class="num">${esc(t('stThProfit'))}</th><th class="num">${esc(t('stThPF'))}</th><th class="num">${esc(t('stThTotalR'))}</th><th class="num">${esc(t('stThAvgR'))}</th><th class="num">${esc(t('stThAvgSL'))}</th><th class="num">${esc(t('stThAvgTP'))}</th><th class="num">${esc(t('stThStreak'))}</th><th class="num">${esc(t('stThMaxDD'))}</th><th class="num">${esc(t('stThRecovery'))}</th><th class="num">${esc(t('stThHold'))}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
function statsSectionHtml(s, titleKey) {
  return `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t(titleKey))}</h2>`
    + (s.closed === 0 ? `<div class="empty"><strong>${esc(t('stNoTrades'))}</strong></div>` : '')
    + statsGridHtml(s)
    + chartCardHtml(s)
    + monthTableHtml(s.months)
    + pairTableHtml(s);
}
// Baris jurnal ringkas (riwayat sinyal selesai): pair, arah, kapan
// diposting, lot, hasil USD · pips · R, tombol Detail.
function journalRowHtml(sig, opts = {}) {
  const d = decimalsForPair(sig.pair);
  const dirCls = sig.direction === 'BUY' ? 'buy' : 'sell';
  const resCls = sig.status === 'WIN' ? 'pips-pos' : 'pips-neg';
  const res = `${sig.profit_usd !== null && sig.profit_usd !== undefined ? fmtUsd(sig.profit_usd) : '—'}`
    + `${sig.profit_pips !== null && sig.profit_pips !== undefined ? ` · ${Math.round(Number(sig.profit_pips))} pips` : ''}`
    + `${sig.r_value !== null && sig.r_value !== undefined ? ` · ${fmtR(sig.r_value)}` : ''}`;
  const traderName = opts.showTrader ? (() => { const tr = traderOf(sig); return esc(tr.trader_display_name || t('noName')) + ' · '; })() : '';
  return `<div class="hist-row"><span class="p mono">${esc(sig.pair)}</span>`
    + `<span class="dir ${dirCls}" style="font-size:11px;padding:3px 9px">${esc(sig.direction)}</span>`
    + `<span style="color:var(--muted)">${traderName}${esc(fmtDate(sig.created_at))} · ${esc(fmtNum(sig.lot_size, 2))} lot</span>`
    + `<span class="pill ${sig.status === 'WIN' ? 'green' : 'red'}">${esc(sig.status)}</span>`
    + `<span class="res mono ${resCls}">${esc(res)}</span>`
    + `<button class="btn" type="button" data-jdetail="${esc(sig.id)}" style="min-height:34px;padding:6px 12px;font-size:12.5px;">${esc(t('sigDetail'))}</button>`
    + `</div>`;
}
function bindJournalRows(root) {
  $$('[data-jdetail]', root).forEach((b) => {
    b.addEventListener('click', () => openSignalDetail(b.dataset.jdetail));
  });
}

// -------------------------------------------------------------- Beranda ---
function renderHomeFilters() {
  const box = $('#home-filters');
  if (!box) return;
  const pairs = [...new Set(S.homeSignals.map((s) => s.pair))].sort((a, b) => PAIRS.indexOf(a) - PAIRS.indexOf(b));
  const f = S.feedFilter;
  let html = '<div class="feed-filters">';
  html += `<button class="fchip" type="button" data-fpair="ALL" aria-pressed="${f.pair === 'ALL'}">${esc(t('feedFilterAll'))}</button>`;
  for (const p of pairs) {
    html += `<button class="fchip" type="button" data-fpair="${esc(p)}" aria-pressed="${f.pair === p}">${esc(p)}</button>`;
  }
  html += `<span style="width:8px;"></span>`;
  html += `<button class="fchip" type="button" data-fstatus="ALL" aria-pressed="${f.status === 'ALL'}">${esc(t('feedFilterAll'))}</button>`;
  html += `<button class="fchip" type="button" data-fstatus="PENDING" aria-pressed="${f.status === 'PENDING'}">${esc(t('tabPending'))}</button>`;
  html += `<button class="fchip" type="button" data-fstatus="AKTIF" aria-pressed="${f.status === 'AKTIF'}">${esc(t('tabActive'))}</button>`;
  html += `<button class="fchip" type="button" data-ffollowed="1" aria-pressed="${f.followed}">${esc(t('feedFollowedOnly'))}</button>`;
  html += '</div>';
  box.innerHTML = html;
  $$('[data-fpair]', box).forEach((b) => {
    b.addEventListener('click', () => { S.feedFilter.pair = b.dataset.fpair; renderHomeList(); renderHomeFilters(); });
  });
  $$('[data-fstatus]', box).forEach((b) => {
    b.addEventListener('click', () => { S.feedFilter.status = b.dataset.fstatus; renderHomeList(); renderHomeFilters(); });
  });
  $$('[data-ffollowed]', box).forEach((b) => {
    b.addEventListener('click', () => { S.feedFilter.followed = !S.feedFilter.followed; renderHomeList(); renderHomeFilters(); });
  });
}
function homeFilteredSignals() {
  const f = S.feedFilter;
  const followedIds = new Set(S.myFollows.map((x) => x.trader_id));
  const rank = (st) => (st === 'PENDING' ? 0 : st === 'AKTIF' ? 1 : 2);
  return S.homeSignals
    .filter((s) => (f.pair === 'ALL' || s.pair === f.pair)
      && (f.status === 'ALL' || s.status === f.status)
      && (!f.followed || followedIds.has(s.trader_id)))
    .sort((a, b) => (rank(a.status) - rank(b.status))
      || (new Date(b.created_at) - new Date(a.created_at)));
}
function renderHomeList() {
  const list = $('#home-list');
  if (!list) return;
  if (S.homeSignals.length === 0) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('feedEmpty'))}</strong>${esc(t('feedEmptyHint'))}</div>`;
    return;
  }
  const rows = homeFilteredSignals();
  if (rows.length === 0) {
    const msg = S.feedFilter.followed && S.myFollows.length === 0
      ? `<strong>${esc(t('feedFollowedEmpty'))}</strong>${esc(t('feedFollowedHint'))}`
      : `<strong>${esc(t('feedNoMatch'))}</strong>`;
    list.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }
  list.innerHTML = rows.map(signalCardHtml).join('');
  bindSignalCards(list);
}
async function renderHome(force = false) {
  const list = $('#home-list');
  if (!force && S.homeSignals.length === 0) list.innerHTML = `<p class="sub">${esc(t('loading'))}</p>`;
  try {
    const [sigs, follows] = await Promise.all([
      api.listPublicSignals(),
      S.user ? api.listMyFollows(S.user.id).catch(() => []) : Promise.resolve([]),
    ]);
    S.homeSignals = sigs;
    S.myFollows = follows;
    await ensureAllSignals();
  } catch (e) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  renderHomeFilters();
  renderHomeList();
}

// ------------------------------------------------------------------ Cari ---
function traderCardHtml(tr) {
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">✓ ${esc(t('verified'))}</span>` : '';
  const username = one(tr.profiles)?.username;
  return `<article class="sig" data-trader="${esc(tr.profile_id)}" tabindex="0" role="button">
    <div class="sig-head">
      <span class="sig-pair">${esc(tr.trader_display_name || t('noName'))}</span>
      ${verified}
    </div>
    <div class="sig-trader">${username ? '@' + esc(username) + ' · ' : ''}Lv.${level} ${esc(levelName(level, getLang()))}</div>
    <div class="sig-meta">${esc(t('balance'))}: ${esc(fmtUsd(p ? p.balance_usd : START_BALANCE_USD))}${p ? ` · ${esc(fmtR(p.r_since_level))}` : ''}</div>
  </article>`;
}

function traderStatsMap() {
  const map = {};
  for (const tr of S.traders) map[tr.profile_id] = statsForTrader(tr.profile_id);
  return map;
}

function renderSearchList() {
  const list = $('#search-list');
  if (!list) return;
  if (S.searchTab === 'board') {
    renderBoardList();
    return;
  }
  if (S.traders.length === 0) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('searchEmpty'))}</strong>${esc(t('searchHint'))}</div>`;
    return;
  }
  const f = S.searchFilters;
  const stats = traderStatsMap();
  const q = (f.q || '').trim().toLowerCase();
  let pfHidden = 0;
  let rows = S.traders.filter((tr) => {
    const st = stats[tr.profile_id];
    const p = progressOf(tr);
    const level = p ? Number(p.level) || 1 : 1;
    if (q) {
      const name = (tr.trader_display_name || '').toLowerCase();
      const username = (one(tr.profiles)?.username || '').toLowerCase();
      if (!(name.includes(q) || username.includes(q) || ('@' + username).includes(q))) return false;
    }
    if (f.pair !== 'ALL' && !signalsOfTrader(tr.profile_id).some((s) => s.pair === f.pair)) return false;
    if (f.topPair !== 'ALL' && topPairOf(tr.profile_id) !== f.topPair) return false;
    if (Number(f.wrMin) > 0 && !(st.wr !== null && st.wr >= Number(f.wrMin))) return false;
    if (Number(f.rrMin) > 0 && !(st.rr !== null && st.rr >= Number(f.rrMin))) return false;
    if (Number(f.pfMin) > 0) {
      if (st.pf === null || st.pf === undefined) { pfHidden++; return false; }
      if (st.pf < Number(f.pfMin)) return false;
    }
    if (Number(f.levelMin) > 0 && level < Number(f.levelMin)) return false;
    const price = tr.subscription_price_usd;
    if (f.price === 'free' && price !== null && price !== undefined && Number(price) > 0) return false;
    if (f.price === 'paid' && !(price !== null && price !== undefined && Number(price) > 0)) return false;
    if (Number(f.rfMin) > 0 && !(st.recovery !== null && st.recovery !== undefined && st.recovery >= Number(f.rfMin))) return false;
    return true;
  });
  const sortVal = (tr) => {
    const st = stats[tr.profile_id];
    const p = progressOf(tr);
    if (S.searchFilters.sort === 'profit') return st.totalUSD;
    if (S.searchFilters.sort === 'totalr') return st.totalR;
    if (S.searchFilters.sort === 'wr') return st.wr === null ? -1 : st.wr;
    if (S.searchFilters.sort === 'rf') return st.recovery === null || st.recovery === undefined ? -1 : (st.recovery === Infinity ? 999 : st.recovery);
    return p ? Number(p.level) || 1 : 1;
  };
  rows = [...rows].sort((a, b) => sortVal(b) - sortVal(a));
  S.searchPfHidden = pfHidden;
  let html = `<p class="sub">${esc(t('searchCount', { n: rows.length, total: S.traders.length }))}</p>`;
  if (pfHidden > 0) html += `<p class="note">${esc(t('searchPfNote', { n: pfHidden }))}</p>`;
  if (rows.length === 0) {
    html += `<div class="empty"><strong>${esc(t('searchNoMatch'))}</strong></div>`;
    list.innerHTML = html;
    return;
  }
  html += rows.map(traderCardHtml).join('');
  list.innerHTML = html;
  $$('[data-trader]', list).forEach((el) => {
    const open = () => openTraderProfile(el.dataset.trader);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function searchFilterOptions(values, current) {
  return values.map(([v, label]) => `<option value="${v}"${String(current) === String(v) ? ' selected' : ''}>${esc(label)}</option>`).join('');
}
function renderSearchControls() {
  const controls = $('#search-controls');
  if (!controls) return;
  controls.style.display = S.searchTab === 'traders' ? '' : 'none';
  if (S.searchTab !== 'traders') { controls.innerHTML = ''; return; }
  if (!S.searchDraft) S.searchDraft = { ...S.searchFilters };
  const d = S.searchDraft;
  const pairs = [...new Set(S.allSignals.map((s) => s.pair))].sort((a, b) => PAIRS.indexOf(a) - PAIRS.indexOf(b));
  const pairOpts = `<option value="ALL">${esc(t('feedFilterAll'))}</option>` + pairs.map((p) => `<option value="${p}"${d.pair === p ? ' selected' : ''}>${p}</option>`).join('');
  const topPairOpts = `<option value="ALL">${esc(t('feedFilterAll'))}</option>` + pairs.map((p) => `<option value="${p}"${d.topPair === p ? ' selected' : ''}>${p}</option>`).join('');
  controls.innerHTML = `<div class="search-grid">
    <div class="field"><label>${esc(t('searchPh'))}</label><input id="search-q" type="search" placeholder="${esc(t('searchPh'))}" value="${esc(d.q)}" aria-label="${esc(t('searchPh'))}" /></div>
    <div class="field"><label>${esc(t('pair'))}</label><select id="search-pair">${pairOpts}</select></div>
    <div class="field"><label>${esc(t('searchFilterTopPair'))}</label><select id="search-top-pair">${topPairOpts}</select></div>
    <div class="field"><label>${esc(t('sortBy'))}</label><select id="search-sort">${searchFilterOptions([
      ['level', t('sortLevel')], ['profit', t('sortProfit')], ['totalr', t('sortTotalR')],
      ['wr', t('sortWr')], ['rf', t('sortRf')],
    ], d.sort)}</select></div>
    <div class="field"><label>${esc(t('searchFilterWrMin'))}</label><select id="search-wr-min">${searchFilterOptions([[0, t('feedFilterAll')], [30, '≥ 30%'], [50, '≥ 50%'], [70, '≥ 70%'], [90, '≥ 90%']], d.wrMin)}</select></div>
    <div class="field"><label>${esc(t('searchFilterRrMin'))}</label><select id="search-rr-min">${searchFilterOptions([[0, t('feedFilterAll')], [1, '≥ 1:1'], [1.5, '≥ 1:1,5'], [2, '≥ 1:2'], [3, '≥ 1:3']], d.rrMin)}</select></div>
    <div class="field"><label>${esc(t('searchFilterPfMin'))}</label><select id="search-pf-min">${searchFilterOptions([[0, t('feedFilterAll')], [1, '≥ 1,0'], [1.5, '≥ 1,5'], [2, '≥ 2,0'], [3, '≥ 3,0']], d.pfMin)}</select></div>
    <div class="field"><label>${esc(t('searchFilterLevelMin'))}</label><select id="search-level-min">${searchFilterOptions([[0, t('feedFilterAll')], [2, '≥ Lv.2'], [3, '≥ Lv.3'], [5, '≥ Lv.5'], [10, '≥ Lv.10']], d.levelMin)}</select></div>
    <div class="field"><label>${esc(t('searchFilterPrice'))}</label><select id="search-price">${searchFilterOptions([['all', t('feedFilterAll')], ['free', t('profFree')], ['paid', t('searchPricePaid')]], d.price)}</select></div>
    <div class="field"><label>${esc(t('searchFilterRfMin'))}</label><select id="search-rf-min">${searchFilterOptions([[0, t('feedFilterAll')], [1, '≥ 1,0x'], [1.5, '≥ 1,5x'], [2, '≥ 2,0x'], [3, '≥ 3,0x']], d.rfMin)}</select></div>
  </div>
  <div class="search-actions">
    <button class="btn primary" id="search-apply" type="button">${esc(t('searchBtn'))}</button>
    <button class="btn" id="search-reset" type="button">${esc(t('searchReset'))}</button>
  </div>`;
  const readDraft = () => {
    S.searchDraft = {
      q: $('#search-q').value,
      pair: $('#search-pair').value,
      topPair: $('#search-top-pair').value,
      sort: $('#search-sort').value,
      wrMin: $('#search-wr-min').value,
      rrMin: $('#search-rr-min').value,
      pfMin: $('#search-pf-min').value,
      levelMin: $('#search-level-min').value,
      price: $('#search-price').value,
      rfMin: $('#search-rf-min').value,
    };
  };
  ['search-q', 'search-pair', 'search-top-pair', 'search-sort', 'search-wr-min', 'search-rr-min', 'search-pf-min', 'search-level-min', 'search-price', 'search-rf-min'].forEach((id) => {
    $('#' + id).addEventListener('change', readDraft);
  });
  $('#search-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); readDraft(); applySearchDraft(); }
  });
  $('#search-apply').addEventListener('click', () => { readDraft(); applySearchDraft(); });
  $('#search-reset').addEventListener('click', () => {
    S.searchFilters = { q: '', pair: 'ALL', topPair: 'ALL', sort: 'level', wrMin: '0', rrMin: '0', pfMin: '0', levelMin: '0', price: 'all', rfMin: '0' };
    S.searchDraft = { ...S.searchFilters };
    renderSearchControls();
    renderSearchList();
  });
}
function applySearchDraft() {
  S.searchFilters = { ...S.searchDraft };
  renderSearchList();
}

async function renderSearch() {
  const list = $('#search-list');
  $$('#search-tabs [data-stab]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.stab === S.searchTab));
  });
  list.innerHTML = `<p class="sub">${esc(t('loading'))}</p>`;
  try {
    const [traders] = await Promise.all([
      api.listTraders(),
      ensureAllSignals(),
    ]);
    S.traders = traders;
  } catch (e) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  renderSearchControls();
  renderSearchList();
}

// --------------------------------------------------------------- Peringkat ---
function boardCardHtml(row, rank) {
  const tr = row.tr;
  const s = row.stats;
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">✓ ${esc(t('verified'))}</span>` : '';
  const username = one(tr.profiles)?.username;
  const name = tr.trader_display_name || t('noName');
  return `<article class="board-card" data-trader="${esc(tr.profile_id)}" tabindex="0" role="button">
    <div class="board-top">
      <span class="board-rank${rank <= 3 ? ' top' : ''}">#${rank}</span>
      ${avatarHtml(name, tr.profile_id, 'avatar-md')}
      <div style="min-width:0; flex:1;">
        <div style="font-weight:800; font-size:15.5px;">${esc(name)}${verified}${demoBadge(tr.profile_id)}</div>
        <div style="font-size:12.5px; color:var(--muted);">${username ? '@' + esc(username) + ' · ' : ''}Lv.${level} ${esc(levelName(level, getLang()))}</div>
      </div>
    </div>
    <div class="board-stats">
      <div class="bs"><b class="${s.totalUSD >= 0 ? 'pips-pos' : 'pips-neg'}">${s.closed ? esc(fmtUsd(s.totalUSD, true)) : '—'}</b><small>${esc(t('stTotalProfit'))}</small></div>
      <div class="bs"><b>${s.closed ? esc(fmtR(s.totalR)) : '—'}</b><small>${esc(t('stTotalR'))}</small></div>
      <div class="bs"><b>${s.closed && s.drawdown.usd > 0 ? '-' + esc(fmtUsd(s.drawdown.usd)) : '—'}</b><small>${esc(t('stMaxDD'))}</small></div>
      <div class="bs"><b>${s.closed ? fmtPf(s.pf) : '—'}</b><small>${esc(t('stProfitFactor'))}</small></div>
      <div class="bs"><b>${s.closed ? fmtRf(s.recovery) : '—'}</b><small>${esc(t('stRecovery'))}</small></div>
      <div class="bs"><b>${esc(t('boardSignals', { n: s.totalSignals }))}</b><small>${esc(t('stTotalSignals'))}</small></div>
    </div>
  </article>`;
}
function renderBoardList() {
  const list = $('#search-list');
  if (!list) return;
  const stats = traderStatsMap();
  const ranked = rankedTraders(S.traders, stats);
  const hasClosed = ranked.some((r) => r.stats.closed > 0);
  let html = `<p class="lead-sm">${t('boardLead')}</p>`
    + `<p class="note">${esc(t('boardRules'))}</p>`
    + `<button class="guidelink" id="board-guide-link" type="button">${esc(t('guideCta'))}<span aria-hidden="true"> →</span></button>`;
  if (!hasClosed) {
    html += `<div class="empty" style="margin-top:14px;"><strong>${esc(t('boardEmptyTitle'))}</strong>${esc(t('boardEmptyBody'))}</div>`;
    list.innerHTML = html;
    $('#board-guide-link').addEventListener('click', () => openGuideSection('board'));
    return;
  }
  const perPage = 10;
  const pages = Math.max(1, Math.ceil(ranked.length / perPage));
  S.boardPage = Math.min(S.boardPage, pages);
  const start = (S.boardPage - 1) * perPage;
  const shown = ranked.slice(start, start + perPage);
  html += `<div style="margin-top:14px;">` + shown.map((r, i) => boardCardHtml(r, start + i + 1)).join('') + `</div>`;
  if (pages > 1) {
    html += `<div class="row" style="justify-content:center; margin-top:8px;">`
      + `<button class="btn" id="board-prev" type="button" ${S.boardPage <= 1 ? 'disabled' : ''}>←</button>`
      + `<span style="font-size:13px; color:var(--muted);">${S.boardPage} / ${pages}</span>`
      + `<button class="btn" id="board-next" type="button" ${S.boardPage >= pages ? 'disabled' : ''}>→</button></div>`;
  }
  list.innerHTML = html;
  $('#board-guide-link').addEventListener('click', () => openGuideSection('board'));
  const prev = $('#board-prev');
  if (prev) prev.addEventListener('click', () => { S.boardPage--; renderBoardList(); });
  const next = $('#board-next');
  if (next) next.addEventListener('click', () => { S.boardPage++; renderBoardList(); });
  $$('[data-trader]', list).forEach((el) => {
    const open = () => openTraderProfile(el.dataset.trader);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}
function openGuideSection(id) {
  if (!S.guideOpen.includes(id)) { S.guideOpen.push(id); saveGuideOpen(); }
  showView('guide');
  setTimeout(() => {
    const sec = document.getElementById('guide-' + id);
    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

async function openTraderProfile(traderId) {
  const tr = S.traders.find((x) => x.profile_id === traderId);
  if (!tr) return;
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">✓ ${esc(t('verified'))}</span>` : '';
  const username = one(tr.profiles)?.username;
  const name = tr.trader_display_name || t('noName');
  const price = tr.subscription_price_usd;
  const priceLabel = price !== null && price !== undefined && Number(price) > 0
    ? `${esc(fmtUsd(price))} / bln` : esc(t('profFree'));
  const mine = S.user && traderId === S.user.id;
  openOverlay(`
    <button class="btn ghost close-x" id="ov-close" type="button">✕</button>
    <div class="board-top">
      ${avatarHtml(name, traderId, 'avatar-md')}
      <div style="min-width:0; flex:1;">
        <h2 style="margin:0;">${esc(name)} ${verified}${demoBadge(traderId)}</h2>
        <p style="color:var(--muted); font-size:13.5px; margin:2px 0 0;">${username ? '@' + esc(username) + ' · ' : ''}Lv.${level} ${esc(levelName(level, getLang()))}</p>
      </div>
    </div>
    <dl class="kv" style="margin-top:12px;">
      <dt>${esc(t('balance'))}</dt><dd>${esc(fmtUsd(p ? p.balance_usd : START_BALANCE_USD))}</dd>
      <dt>${esc(t('profFollowers'))}</dt><dd id="ov-followers">—</dd>
      <dt>${esc(t('profSubPrice'))}</dt><dd>${priceLabel}</dd>
    </dl>
    ${isDemo(traderId) ? `<p class="note">${esc(t('demoNote'))}</p>` : ''}
    ${!mine ? `<p class="note">${esc(t('sigRiskNote'))}</p>` : ''}
    <div class="subtabs" role="tablist" style="margin-top:14px;">
      <button class="subtab" role="tab" data-ptab="sinyal" aria-selected="${S.traderProfileTab === 'sinyal'}">${esc(t('profTabSignals'))}</button>
      <button class="subtab" role="tab" data-ptab="profil" aria-selected="${S.traderProfileTab === 'profil'}">${esc(t('profTabProfile'))}</button>
    </div>
    <div id="ov-trader-body"><p class="sub">${esc(t('loading'))}</p></div>`);
  $('#ov-close').onclick = closeOverlay;
  $$('#overlay-sheet [data-ptab]').forEach((b) => {
    b.addEventListener('click', () => {
      S.traderProfileTab = b.dataset.ptab;
      $$('#overlay-sheet [data-ptab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.ptab === S.traderProfileTab)));
      renderTraderProfileBody(traderId);
    });
  });
  try {
    const [sigs, followers] = await Promise.all([
      api.listTraderSignals(traderId),
      api.countFollowers(traderId).catch(() => null),
    ]);
    S.traderSignals = sigs;
    await ensureAllSignals();
    const fEl = $('#ov-followers');
    if (fEl) fEl.textContent = followers === null ? '—' : String(followers);
    renderTraderProfileBody(traderId);
  } catch (e) {
    const box = $('#ov-trader-body');
    if (box) box.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
  }
}
function renderTraderProfileBody(traderId) {
  const box = $('#ov-trader-body');
  if (!box) return;
  const sigs = S.traderSignals.filter((s) => s.trader_id === traderId);
  if (S.traderProfileTab === 'profil') {
    const st = statsForTrader(traderId);
    box.innerHTML = `<h2 style="font-size:16px; margin: 6px 0 10px;">${esc(t('profStatsTitle'))}</h2>`
      + `<p class="sub">${esc(t('profStatsSub'))}</p>`
      + (st.closed === 0 ? `<div class="empty"><strong>${esc(t('stNoTrades'))}</strong></div>` : '')
      + statsGridHtml(st)
      + chartCardHtml(st)
      + monthTableHtml(st.months)
      + pairTableHtml(st);
    return;
  }
  const open = sigs.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF');
  const done = sigs.filter((s) => ['WIN', 'LOSS', 'CANCELLED', 'EXPIRED'].includes(s.status));
  const f = S.traderProfileFilter;
  const chip = (val, label, n) => `<button class="fchip" type="button" data-pfilter="${val}" aria-pressed="${f === val}">${esc(label)}${n !== undefined ? ` (${n})` : ''}</button>`;
  let html = `<h2 style="font-size:16px; margin: 6px 0 10px;">${esc(t('profSignalsAll'))}</h2>`
    + `<div class="feed-filters">${chip('ALL', t('feedFilterAll'), open.length)}${chip('PENDING', t('tabPending'), open.filter((s) => s.status === 'PENDING').length)}${chip('AKTIF', t('tabActive'), open.filter((s) => s.status === 'AKTIF').length)}${chip('HISTORY', t('tabHistory'), done.length)}</div>`;
  if (f === 'HISTORY') {
    html += done.length
      ? `<div class="hist journal-scroll tall" tabindex="0">` + done.map((s) => journalRowHtml(s)).join('') + `</div>`
      : `<div class="empty"><strong>${esc(t('profJournalEmpty'))}</strong></div>`;
  } else {
    const shown = f === 'ALL' ? open : open.filter((s) => s.status === f);
    html += shown.length
      ? shown.map(signalCardHtml).join('')
      : `<div class="empty"><strong>${esc(t('feedEmpty'))}</strong></div>`;
  }
  box.innerHTML = html;
  $$('[data-pfilter]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.traderProfileFilter = b.dataset.pfilter;
      renderTraderProfileBody(traderId);
    });
  });
  bindSignalCards(box);
  bindJournalRows(box);
}

// ----------------------------------------------------------- Ruang Kerja ---
function balanceCardHtml() {
  const p = progressOf(S.trader);
  const level = p ? Number(p.level) || 1 : 1;
  const balance = p ? Number(p.balance_usd) : START_BALANCE_USD;
  const r = p ? Number(p.r_since_level) || 0 : 0;
  const trades = p ? Number(p.trades_since_level) || 0 : 0;
  const ref = levelRef(level);
  const nextRef = nextLevelRef(level);
  const downRef = downLevelRef(level);
  const cumProfit = balance - START_BALANCE_USD;
  const pctStart = ((balance - START_BALANCE_USD) / START_BALANCE_USD) * 100;
  // Floating dari sinyal AKTIF saya (butuh harga live; "—" bila tak ada).
  const aktif = S.mySignals.filter((s) => s.status === 'AKTIF');
  let floating = null;
  if (aktif.length === 0) floating = 0;
  else {
    const vals = aktif.map((s) => floatingUsd(s));
    if (vals.every((v) => v !== null)) floating = vals.reduce((a, b) => a + b, 0);
  }
  const equity = floating === null ? null : balance + floating;
  const pctBal = Math.min(100, Math.max(0, (balance / nextRef) * 100));
  const pctR = Math.min(100, Math.max(0, (r / 5) * 100));
  const pctTr = Math.min(100, (trades / 5) * 100);
  const condUp = (met, label, detail, pct) => `<div class="cond" style="margin-top:8px;">
      <div class="rowline"><span>${esc(label)}</span><span class="stchip ${met ? 'ok' : 'no'}">${esc(met ? t('balCondMet') : t('balCondUnmet'))}</span></div>
      <div class="progress" style="margin-top:8px;">
        <div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div>
        <small>${esc(detail)}</small>
      </div>
    </div>`;
  const condDown = (met, label, detail) => `<div class="cond" style="margin-top:8px;">
      <div class="rowline"><span>${esc(label)}</span><span class="stchip ${met ? 'no' : 'ok'}">${esc(met ? t('balCondMet') : t('balCondUnmet'))}</span></div>
      <small style="color:var(--muted);">${esc(detail)}</small>
    </div>`;
  return `<div class="balance-card">
    <div class="balance-top">
      <div>
        <div style="font-size:12.5px;color:var(--muted);">${esc(t('balanceCard'))}</div>
        <div class="amt">${esc(fmtUsd(balance))}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:12.5px;color:var(--muted);">${esc(t('level'))}</div>
        <div style="font-weight:800;">Lv.${level} ${esc(levelName(level, getLang()))}</div>
        ${level >= PAY_GATE_LEVEL ? `<span class="pill gold">✓ ${esc(t('verified'))}</span>` : ''}
      </div>
    </div>
    <div class="sig-facts" style="margin-top:0;">
      <span>${esc(t('balCumProfit'))}: <b>${esc(fmtUsd(cumProfit))}</b> (${pctStart >= 0 ? '+' : ''}${pctStart.toFixed(1)}% ${esc(t('balPctStart'))})</span>
      <span>${esc(t('balEquity'))}: <b>${equity !== null ? esc(fmtUsd(equity)) : '—'}</b></span>
      <span>${esc(t('balFloating'))}: <b>${floating !== null ? esc(fmtUsd(floating)) : '—'}</b></span>
    </div>
    <div>
      <div style="font-weight:700; font-size:14px;">${esc(t('balUpTitle'))}</div>
      ${condUp(balance >= nextRef, `${t('balance')} ≥ ${fmtUsd(nextRef)}`, `${t('balance')} ${fmtUsd(balance)} / ${fmtUsd(nextRef)}`, pctBal)}
      ${condUp(r >= 5, `${t('rSince')} ≥ +5R`, `${t('rSince')}: ${fmtR(r)} / +5R`, pctR)}
      ${condUp(trades >= 5, `${t('tradesSince')} ≥ 5`, `${t('tradesSince')}: ${trades} / 5`, pctTr)}
    </div>
    <div>
      <div style="font-weight:700; font-size:14px;">${esc(t('balDownTitle'))}</div>
      ${condDown(balance <= downRef, `${t('balance')} ≤ ${fmtUsd(downRef)}`, `${t('balance')} ${fmtUsd(balance)} · ${t('level')} ${level} (${t('balance')} ${fmtUsd(ref)} × 0,95)`)}
      ${condDown(r <= -5, `${t('rSince')} ≤ −5R`, `${t('rSince')}: ${fmtR(r)} / −5R`)}
    </div>
    <p class="note">${esc(t('balLatch'))}</p>
    <button class="guidelink" id="bal-guide-link" type="button" style="padding-top:0;">${esc(t('balGuide'))}<span aria-hidden="true"> →</span></button>
  </div>`;
}

function signalFormHtml(editing) {
  const sig = editing || null;
  const pairOpts = PAIRS.map((p) => `<option value="${p}"${sig && sig.pair === p ? ' selected' : ''}>${p}</option>`).join('');
  return `<div class="card">
    <h2>${esc(editing ? t('editSignal') : t('postSignal'))}</h2>
    <form id="sig-form">
      <div class="field">
        <label>${esc(t('pair'))}</label>
        <select id="sf-pair">${pairOpts}</select>
      </div>
      <div class="field">
        <label>${esc(t('direction'))}</label>
        <div class="dir-toggle" role="group">
          <button type="button" class="buy" id="sf-buy" aria-pressed="${sig ? String(sig.direction === 'BUY') : 'true'}">▲ ${esc(t('buy'))}</button>
          <button type="button" class="sell" id="sf-sell" aria-pressed="${sig ? String(sig.direction === 'SELL') : 'false'}">▼ ${esc(t('sell'))}</button>
        </div>
      </div>
      <div class="row">
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-entry">${esc(t('entry'))}</label>
          <input id="sf-entry" type="number" step="any" min="0" required value="${sig ? esc(sig.entry) : ''}" placeholder="${esc(t('phEntry'))}" />
        </div>
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-lot">${esc(t('lot'))}</label>
          <input id="sf-lot" type="number" step="0.01" min="0.01" required value="${sig ? esc(sig.lot_size) : '0.01'}" />
        </div>
      </div>
      <div class="row">
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-sl">${esc(t('stopLoss'))}</label>
          <input id="sf-sl" type="number" step="any" min="0" required value="${sig ? esc(sig.stop_loss) : ''}" placeholder="${esc(t('phSl'))}" />
        </div>
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-tp">${esc(t('takeProfit'))}</label>
          <input id="sf-tp" type="number" step="any" min="0" required value="${sig ? esc(sig.take_profit) : ''}" placeholder="${esc(t('phTp'))}" />
        </div>
      </div>
      <div class="notice" id="sf-risk"></div>
      <div class="err" id="sf-err" style="color:var(--sell); font-size:13px; min-height:1.2em; margin-bottom:8px;"></div>
      <div class="row">
        <button class="btn primary" type="submit" id="sf-submit" style="flex:1;">${esc(editing ? t('save') : t('postSignal'))}</button>
        ${editing ? `<button class="btn" type="button" id="sf-cancel-edit">${esc(t('cancelEdit'))}</button>` : ''}
      </div>
    </form>
  </div>`;
}

function readSignalForm() {
  const direction = $('#sf-buy').getAttribute('aria-pressed') === 'true' ? 'BUY' : 'SELL';
  return {
    pair: $('#sf-pair').value,
    direction,
    entry: parseFloat($('#sf-entry').value),
    sl: parseFloat($('#sf-sl').value),
    tp: parseFloat($('#sf-tp').value),
    lot: parseFloat($('#sf-lot').value),
  };
}

function refreshRiskBox() {
  const box = $('#sf-risk');
  if (!box) return;
  const v = readSignalForm();
  const balance = progressOf(S.trader) ? Number(progressOf(S.trader).balance_usd) : START_BALANCE_USD;
  const err = validateSignal({ ...v, balanceUsd: balance, prices: S.prices });
  const rr = calcRr(v.entry, v.sl, v.tp);
  let html = '';
  if (rr !== null && Number.isFinite(rr)) {
    html += `<div>${esc(t('riskReward'))}: <b class="mono">1:${rr.toFixed(2)}</b></div>`;
  }
  const risk = ([v.entry, v.sl, v.lot].every((x) => Number.isFinite(x) && x > 0))
    ? calcRisk({ pair: v.pair, entry: v.entry, sl: v.sl, lot: v.lot, balanceUsd: balance, prices: S.prices })
    : null;
  if (risk && !risk.error) {
    html += `<div>${esc(t('riskUsd'))}: <b class="mono">${esc(fmtUsd(risk.riskUsd))}</b> (${risk.riskPct !== null ? risk.riskPct.toFixed(2) + '% ' + esc(t('riskPct')) : ''})</div>`;
  } else if (risk && risk.error === 'no-price') {
    html += `<div>${esc(t('riskUnavailable'))}</div>`;
  }
  if (err === 'invalid-order') html += `<div style="color:var(--sell);">${esc(t('errOrder'))}</div>`;
  if (err === 'rr') html += `<div style="color:var(--sell);">${esc(t('errRr'))}</div>`;
  if (err === 'risk') html += `<div style="color:var(--sell);">${esc(t('errRisk'))}</div>`;
  box.innerHTML = html || `<div>${esc(t('riskReward'))}: —</div>`;
}

function bindSignalForm(editing) {
  const buyBtn = $('#sf-buy');
  const sellBtn = $('#sf-sell');
  const setDir = (dir) => {
    buyBtn.setAttribute('aria-pressed', String(dir === 'BUY'));
    sellBtn.setAttribute('aria-pressed', String(dir === 'SELL'));
    refreshRiskBox();
  };
  buyBtn.addEventListener('click', () => setDir('BUY'));
  sellBtn.addEventListener('click', () => setDir('SELL'));
  ['sf-pair', 'sf-entry', 'sf-sl', 'sf-tp', 'sf-lot'].forEach((id) => {
    $('#' + id).addEventListener('input', refreshRiskBox);
  });
  refreshRiskBox();
  const cancelEdit = $('#sf-cancel-edit');
  if (cancelEdit) {
    // "Batal ubah" tetap di Ruang Kerja — tidak pindah halaman.
    cancelEdit.addEventListener('click', () => {
      S.editingId = null;
      S.editingVersion = null;
      renderOffice();
    });
  }
  $('#sig-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#sf-err');
    errBox.textContent = '';
    const v = readSignalForm();
    const balance = progressOf(S.trader) ? Number(progressOf(S.trader).balance_usd) : START_BALANCE_USD;
    const code = validateSignal({ ...v, balanceUsd: balance, prices: S.prices });
    if (code === 'invalid-order') { errBox.textContent = t('errOrder'); return; }
    if (code === 'rr') { errBox.textContent = t('errRr'); return; }
    if (code === 'risk') { errBox.textContent = t('errRisk'); return; }
    if (code === 'pair') { errBox.textContent = t('errPair'); return; }
    if (code === 'invalid') { errBox.textContent = t('errInvalid'); return; }
    const btn = $('#sf-submit');
    btn.disabled = true;
    try {
      let res;
      if (editing) {
        res = await api.updateSignal({ id: editing.id, ...v, version: S.editingVersion });
      } else {
        res = await api.createSignal(v);
      }
      if (!res.ok) {
        errBox.textContent = rpcErrorMessage(res);
        if (res.code === 'conflict') {
          // Data basi — muat ulang agar versi terbaru tampil.
          S.editingId = null;
          S.editingVersion = null;
          await renderOffice();
        }
        return;
      }
      toast(editing ? t('toastUpdated') : t('toastPosted'));
      S.editingId = null;
      S.editingVersion = null;
      await refreshIdentity();
      await renderOffice();
      await renderHome();
    } catch (err) {
      errBox.textContent = t('errNetwork');
    } finally {
      btn.disabled = false;
    }
  });
}

function startEditSignal(sig) {
  S.editingId = sig.id;
  S.editingVersion = sig.version;
  showView('office');
  // Form edit dirender di atas daftar sinyal, tetap di Ruang Kerja.
  setTimeout(() => {
    const form = $('#sig-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

async function renderOffice() {
  const body = $('#office-body');
  if (!S.trader) {
    body.innerHTML = `<div class="card">
      <h2>${esc(t('setupIdentityTitle'))}</h2>
      <p>${esc(t('setupIdentityDesc'))}</p>
      <div class="notice err" id="id-err" hidden></div>
      <form id="id-form">
        <div class="field">
          <label for="id-username">${esc(t('username'))}</label>
          <input id="id-username" required minlength="3" maxlength="30" pattern="[A-Za-z0-9_][A-Za-z0-9_.]{2,29}" placeholder="trader_jago" />
          <div class="hint">${esc(t('usernameHint'))}</div>
        </div>
        <div class="field">
          <label for="id-display">${esc(t('displayName'))}</label>
          <input id="id-display" required maxlength="60" placeholder="Trader Jago" />
        </div>
        <button class="btn primary" type="submit">${esc(t('save'))}</button>
      </form>
    </div>`;
    $('#id-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = $('#id-err');
      errBox.hidden = true;
      try {
        const res = await api.setupTraderIdentity($('#id-username').value.trim(), $('#id-display').value.trim());
        if (!res.ok) {
          errBox.textContent = rpcErrorMessage(res);
          errBox.hidden = false;
          return;
        }
        toast(t('toastIdentity'));
        await refreshIdentity();
        await renderOffice();
      } catch (err) {
        errBox.textContent = t('errNetwork');
        errBox.hidden = false;
      }
    });
    return;
  }

  // Role switcher (prototipe: di Office, bukan di Profil).
  body.innerHTML = `<div class="role-toggle" role="group" aria-label="${esc(t('officeTitle'))}">
      <button type="button" data-orole="trader" aria-pressed="${S.officeRole === 'trader'}">${esc(t('officeRoleTrader'))}</button>
      <button type="button" data-orole="follower" aria-pressed="${S.officeRole === 'follower'}">${esc(t('officeRoleFollower'))}</button>
    </div>
    <div id="office-role-body"><p class="sub">${esc(t('loading'))}</p></div>`;
  $$('#office-body [data-orole]').forEach((b) => {
    b.addEventListener('click', () => {
      S.officeRole = b.dataset.orole;
      renderOffice();
    });
  });
  await renderOfficeRole();
}

async function renderOfficeRole() {
  const box = $('#office-role-body');
  if (!box) return;
  if (S.officeRole === 'follower') {
    await renderOfficeFollower(box);
    return;
  }
  await renderOfficeTrader(box);
}

function traderIdentityCardHtml() {
  const tr = S.trader;
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const name = tr.trader_display_name || t('noName');
  const username = S.profile?.username ? '@' + S.profile.username : '—';
  return `<div class="card">
    <div class="board-top">
      ${avatarImg(name, tr.profile_id, tr.trader_avatar_url, 'avatar-md')}
      <div style="min-width:0; flex:1;">
        <div style="font-weight:800; font-size:16px;">${esc(name)}${demoBadge(tr.profile_id)}</div>
        <div style="font-size:13px; color:var(--muted);">${esc(username)} · Lv.${level} ${esc(levelName(level, getLang()))}</div>
      </div>
    </div>
    <p class="note">${esc(t('officeIdentityNote'))}</p>
    <div class="avatar-edit">
      <label class="btn" for="trader-photo-input">${esc(t('photoChangeTrader'))}</label>
      <input type="file" id="trader-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
      <span class="note">${esc(t('photoUploadHint'))}</span>
    </div>
  </div>`;
}
function avatarImg(name, id, url, sizeCls) {
  if (url) return `<img class="avatar ${sizeCls}" src="${esc(url)}" alt="" style="object-fit:cover;" />`;
  return avatarHtml(name, id, sizeCls);
}
function bindPhotoInput(inputId, target) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast(t('photoError'), true); input.value = ''; return; }
    try {
      await api.uploadAvatar(file, S.user.id, { target });
      toast(t('photoUploaded'));
      await refreshIdentity();
      if (S.view === 'office') await renderOffice();
      if (S.view === 'profile') await renderProfile();
    } catch (e) {
      toast(t('photoError'), true);
    } finally {
      input.value = '';
    }
  });
}

async function renderOfficeTrader(box) {
  try {
    const [mySigs] = await Promise.all([
      api.listMySignals(S.user.id),
      ensureAllSignals(),
    ]);
    S.mySignals = mySigs;
  } catch (e) {
    box.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  const editing = S.editingId
    ? S.mySignals.find((s) => s.id === S.editingId) || null
    : null;
  let html = traderIdentityCardHtml();
  html += balanceCardHtml();
  html += `<div class="subtabs" role="tablist">
    <button class="subtab" role="tab" data-otab="sinyal" aria-selected="${S.officeTraderTab === 'sinyal'}">${esc(t('profTabSignals'))}</button>
    <button class="subtab" role="tab" data-otab="profil" aria-selected="${S.officeTraderTab === 'profil'}">${esc(t('profTabProfile'))}</button>
    <button class="subtab" role="tab" data-otab="langganan" aria-selected="${S.officeTraderTab === 'langganan'}">${esc(t('officeTraderTabSubs'))}</button>
  </div><div id="office-trader-body"></div>`;
  box.innerHTML = html;
  bindPhotoInput('trader-photo-input', 'trader');
  const balGuide = $('#bal-guide-link');
  if (balGuide) balGuide.addEventListener('click', () => openGuideSection('level'));
  $$('[data-otab]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.officeTraderTab = b.dataset.otab;
      renderOfficeTraderTab();
    });
  });
  renderOfficeTraderTab(editing);
}
function renderOfficeTraderTab(editing = null) {
  const box = $('#office-trader-body');
  if (!box) return;
  // Perbarui aria-selected subtab.
  $$('[data-otab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.otab === S.officeTraderTab)));
  if (S.officeTraderTab === 'profil') {
    const st = statsForTrader(S.user.id);
    box.innerHTML = `<p class="sub">${esc(t('officeStatsSub'))}</p>` + statsSectionHtml(st, 'officeStatsTitle');
    return;
  }
  if (S.officeTraderTab === 'langganan') {
    box.innerHTML = `<div class="empty"><strong>${esc(t('officeSubsEmpty'))}</strong>${esc(t('officeSubsNote'))}</div>`;
    return;
  }
  const ed = editing !== null ? editing : (S.editingId ? S.mySignals.find((s) => s.id === S.editingId) || null : null);
  let html = signalFormHtml(ed);
  html += `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('mySignals'))}</h2>`;
  html += `<div class="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="PENDING" aria-selected="${S.officeTab === 'PENDING'}">${esc(t('tabPending'))}</button>
    <button class="tab" role="tab" data-tab="AKTIF" aria-selected="${S.officeTab === 'AKTIF'}">${esc(t('tabActive'))}</button>
    <button class="tab" role="tab" data-tab="HISTORY" aria-selected="${S.officeTab === 'HISTORY'}">${esc(t('tabHistory'))}</button>
  </div>`;
  html += `<div id="office-list"><p class="sub">${esc(t('loading'))}</p></div>`;
  box.innerHTML = html;
  bindSignalForm(ed);
  $$('#office-trader-body [data-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      S.officeTab = b.dataset.tab;
      $$('#office-trader-body [data-tab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.tab === S.officeTab)));
      renderOfficeList();
    });
  });
  renderOfficeList();
}

async function renderOfficeList() {
  const list = $('#office-list');
  if (!list) return;
  try {
    S.mySignals = await api.listMySignals(S.user.id);
  } catch (e) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  const filtered = S.mySignals.filter((s) => {
    if (S.officeTab === 'PENDING') return s.status === 'PENDING';
    if (S.officeTab === 'AKTIF') return s.status === 'AKTIF';
    return ['WIN', 'LOSS', 'CANCELLED', 'EXPIRED'].includes(s.status);
  });
  if (filtered.length === 0) {
    const emptyKey = S.officeTab === 'PENDING' ? 'officeEmptyPending'
      : S.officeTab === 'AKTIF' ? 'officeEmptyActive' : 'officeEmptyHistory';
    const hint = S.officeTab === 'PENDING' ? esc(t('feedEmptyHint')) : '';
    list.innerHTML = `<div class="empty"><strong>${esc(t(emptyKey))}</strong>${hint}</div>`;
    return;
  }
  if (S.officeTab === 'HISTORY') {
    // Riwayat sebagai jurnal (baris ringkas), bukan kartu penuh.
    const sorted = filtered.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    list.innerHTML = `<h3 style="font-size:15px; margin: 4px 0 10px;">${esc(t('officeJournalTitle'))}</h3>`
      + `<div class="hist journal-scroll tall" tabindex="0">` + sorted.map((s) => journalRowHtml(s)).join('') + `</div>`;
    bindJournalRows(list);
    return;
  }
  list.innerHTML = filtered.map(signalCardHtml).join('');
  bindSignalCards(list);
}

// ---------------------------------------------------------- Ruang Kerja: pengikut ---
async function renderOfficeFollower(box) {
  try {
    const [follows, copies, subs] = await Promise.all([
      api.listMyFollows(S.user.id),
      api.listMyCopies(S.user.id),
      api.listMySubscriptions(S.user.id),
      api.listTraders().then((rows) => { S.traders = rows; }).catch(() => {}),
      ensureAllSignals(),
    ]);
    S.myFollows = follows;
    S.myCopies = copies;
    S.mySubs = subs;
  } catch (e) {
    box.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  const p = S.profile || {};
  const displayName = p.display_name || p.username || S.user?.email || '—';
  const username = p.username ? '@' + p.username : esc(t('officeFollowerNoUser'));
  const followedIds = new Set(S.myFollows.map((x) => x.trader_id));
  const followedSignals = S.allSignals.filter((s) => followedIds.has(s.trader_id));
  const followedOpen = followedSignals.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF').length;
  const activeSubs = S.mySubs.filter((x) => x.status === 'active').length;
  let html = `<div class="card">
    <div class="board-top">
      ${avatarImg(displayName, S.user.id, p.avatar_url, 'avatar-md')}
      <div style="min-width:0; flex:1;">
        <div style="font-weight:800; font-size:16px;">${esc(displayName)}</div>
        <div style="font-size:13px; color:var(--muted);">${username} · Indonesia · ${esc(t('roleInfoFollower'))}</div>
      </div>
    </div>
    <div class="pstats" style="margin-top:12px;">
      <div class="stat-cell"><div class="num mono">${S.myFollows.length}</div><div class="lbl">${esc(t('officeFollowerStatsFollowed'))}</div></div>
      <div class="stat-cell"><div class="num mono">${activeSubs}</div><div class="lbl">${esc(t('officeFollowerStatsSubs'))}</div></div>
      <div class="stat-cell"><div class="num mono">${followedOpen}</div><div class="lbl">${esc(t('officeFollowerStatsOpen'))}</div></div>
      <div class="stat-cell"><div class="num mono">${followedSignals.length}</div><div class="lbl">${esc(t('officeFollowerStatsTotal'))}</div></div>
    </div>
  </div>`;
  html += `<div class="subtabs" role="tablist">
    <button class="subtab" role="tab" data-ftab="sinyal" aria-selected="${S.officeFollowerTab === 'sinyal'}">${esc(t('profTabSignals'))}</button>
    <button class="subtab" role="tab" data-ftab="jurnal" aria-selected="${S.officeFollowerTab === 'jurnal'}">${esc(t('officeFollowerTabJournal'))}</button>
    <button class="subtab" role="tab" data-ftab="diikuti" aria-selected="${S.officeFollowerTab === 'diikuti'}">${esc(t('officeFollowerTabFollowed'))}</button>
  </div><div id="office-follower-body"></div>`;
  box.innerHTML = html;
  $$('[data-ftab]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.officeFollowerTab = b.dataset.ftab;
      renderOfficeFollowerTab();
    });
  });
  renderOfficeFollowerTab();
}
function renderOfficeFollowerTab() {
  const box = $('#office-follower-body');
  if (!box) return;
  $$('[data-ftab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.ftab === S.officeFollowerTab)));
  if (S.officeFollowerTab === 'jurnal') {
    // Jurnal salinan: statistik dari sinyal yang disalin + riwayat.
    const copiedSignals = S.myCopies
      .map((c) => one(c.signals))
      .filter(Boolean)
      .map((s) => ({ ...s, traders: s.traders || {} }));
    const st = computeStats(copiedSignals);
    const done = copiedSignals.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
    const active = copiedSignals.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF');
    let html = statsSectionHtml(st, 'officeJournalStatsTitle');
    html += `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('officeActiveCopies'))} (${active.length})</h2>`;
    html += active.length
      ? `<div class="hist journal-scroll" tabindex="0">` + active.map((s) => journalRowHtml(s, { showTrader: true })).join('') + `</div>`
      : `<div class="empty"><strong>${esc(t('officeActiveCopiesEmpty'))}</strong></div>`;
    html += `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('officeCopyHistory'))} (${done.length})</h2>`;
    html += done.length
      ? `<div class="hist journal-scroll tall" tabindex="0">` + done.map((s) => journalRowHtml(s, { showTrader: true })).join('') + `</div>`
      : `<div class="empty"><strong>${esc(t('officeCopyHistoryEmpty'))}</strong></div>`;
    box.innerHTML = html;
    bindJournalRows(box);
    return;
  }
  if (S.officeFollowerTab === 'diikuti') {
    let html = `<div class="subtabs" role="tablist">
      <button class="subtab" role="tab" data-followedtab="traders" aria-selected="${S.officeFollowedTab === 'traders'}">${esc(t('officeFollowedTraders'))}</button>
      <button class="subtab" role="tab" data-followedtab="subs" aria-selected="${S.officeFollowedTab === 'subs'}">${esc(t('officeFollowedSubs'))}</button>
    </div><div id="office-followed-body"></div>`;
    box.innerHTML = html;
    $$('[data-followedtab]', box).forEach((b) => {
      b.addEventListener('click', () => {
        S.officeFollowedTab = b.dataset.followedtab;
        renderOfficeFollowedBody();
      });
    });
    renderOfficeFollowedBody();
    return;
  }
  // Tab Sinyal: salinan aktif + sinyal dari trader yang diikuti.
  const followedIds = new Set(S.myFollows.map((x) => x.trader_id));
  const followedSignals = S.allSignals
    .filter((s) => followedIds.has(s.trader_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const activeCopies = S.myCopies
    .map((c) => one(c.signals))
    .filter((s) => s && (s.status === 'PENDING' || s.status === 'AKTIF'));
  let html = `<h2 style="font-size:16px; margin: 6px 0 10px;">${esc(t('officeActiveCopies'))} (${activeCopies.length})</h2>`;
  html += activeCopies.length
    ? `<div class="hist journal-scroll" tabindex="0">` + activeCopies.map((s) => journalRowHtml(s, { showTrader: true })).join('') + `</div>`
    : `<div class="empty"><strong>${esc(t('officeActiveCopiesEmpty'))}</strong></div>`;
  html += `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('officeFollowSignals'))}</h2>`;
  if (!S.myFollows.length) {
    html += `<div class="empty"><strong>${esc(t('officeFollowedEmpty'))}</strong>${esc(t('officeFollowedHint'))}</div>`;
  } else if (!followedSignals.length) {
    html += `<div class="empty"><strong>${esc(t('officeFollowSignalsEmpty'))}</strong></div>`;
  } else {
    html += followedSignals.map(signalCardHtml).join('');
  }
  box.innerHTML = html;
  bindSignalCards(box);
  bindJournalRows(box);
}
function renderOfficeFollowedBody() {
  const box = $('#office-followed-body');
  if (!box) return;
  $$('[data-followedtab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.followedtab === S.officeFollowedTab)));
  if (S.officeFollowedTab === 'subs') {
    if (!S.mySubs.length) {
      box.innerHTML = `<div class="empty"><strong>${esc(t('officeSubsMyEmpty'))}</strong>${esc(t('officeSubsNote'))}</div>`;
      return;
    }
    box.innerHTML = S.mySubs.map((sub) => {
      const tr = one(sub.traders) || {};
      const name = tr.trader_display_name || t('noName');
      return `<div class="hist-row"><span class="p mono">${esc(name)}</span>`
        + `<span class="pill ${sub.status === 'active' ? 'green' : ''}">${esc(sub.status)}</span>`
        + `<span style="color:var(--muted)">${esc(fmtUsd(sub.price_usd))} · ${esc(fmtDate(sub.ends_at))}</span></div>`;
    }).join('');
    return;
  }
  if (!S.myFollows.length) {
    box.innerHTML = `<div class="empty"><strong>${esc(t('officeFollowedEmpty'))}</strong>${esc(t('officeFollowedHint'))}</div>`;
    return;
  }
  box.innerHTML = S.myFollows.map((f) => {
    const tr = one(f.traders) || {};
    const p = progressOf(tr);
    const level = p ? Number(p.level) || 1 : 1;
    const name = tr.trader_display_name || t('noName');
    return `<div class="hist-row">${avatarHtml(name, f.trader_id, 'avatar-sm')}<span class="p">${esc(name)}${demoBadge(f.trader_id)}</span>`
      + `<span style="color:var(--muted)">Lv.${level} ${esc(levelName(level, getLang()))}</span>`
      + `<button class="btn" type="button" data-ftrader="${esc(f.trader_id)}" style="min-height:34px;padding:6px 12px;font-size:12.5px;margin-left:auto;">${esc(t('sigDetail'))}</button></div>`;
  }).join('');
  $$('[data-ftrader]', box).forEach((b) => {
    b.addEventListener('click', () => openTraderProfile(b.dataset.ftrader));
  });
}

// -------------------------------------------------------------- Profil ---
// Struktur mengikuti prototipe: kepala profil + kartu KYC + Detail akun +
// baris menu (Pengaturan, Bantuan, Panduan, Keluar). Pengaturan adalah
// sub-halaman sendiri (view-settings), bukan tumpukan kartu di sini.
async function renderProfile() {
  const body = $('#profile-body');
  const p = S.profile || {};
  const username = p.username ? '@' + esc(p.username) : '—';
  const displayName = p.display_name || p.username || S.user?.email || '—';
  const kycStatus = p.kyc_status || 'none';
  const kycVerified = kycStatus === 'verified';
  const roleHtml = S.trader
    ? `<div class="subcard"><div class="board-top">${avatarImg(S.trader.trader_display_name, S.trader.profile_id, S.trader.trader_avatar_url, 'avatar-sm')}<div><div style="font-weight:700;">${esc(S.trader.trader_display_name || t('noName'))}</div><div style="font-size:12.5px; color:var(--muted);">${esc(t('roleInfoTrader'))} · Lv.${progressOf(S.trader) ? Number(progressOf(S.trader).level) || 1 : 1}</div></div></div></div>`
    : `<div class="subcard"><div style="padding:8px 0;"><div style="font-weight:700;">${esc(t('roleInfoFollower'))}</div><div style="font-size:12.5px; color:var(--muted);">${username} · Indonesia</div></div></div>`;
  body.innerHTML = `
    <div class="profile-head">
      ${avatarImg(displayName, S.user.id, p.avatar_url, 'avatar-lg')}
      <div class="profile-name">${esc(displayName)}</div>
      <div class="profile-user">${username}</div>
      <div class="avatar-edit">
        <label class="btn" for="profile-photo-input">${esc(t('photoChange'))}</label>
        <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
        <span class="note">${esc(t('photoUploadHint'))}</span>
      </div>
    </div>
    ${roleHtml}
    <div class="subcard kyc-card">
      <h3>${esc(t('kycTitle'))}</h3>
      <div class="kyc-row"><span class="stchip ${kycVerified ? 'ok' : 'no'}">${esc(kycVerified ? t('kycVerified') : t('kycNotVerified'))}</span>${kycVerified && p.kyc_full_name ? `<span>${esc(p.kyc_full_name)}</span>` : ''}</div>
      <p>${esc(t('kycHint'))}</p>
      ${kycVerified ? `<p>${esc(t('kycNameLocked'))}</p>` : ''}
    </div>
    <div class="subcard">
      <h3>${esc(t('accountDetail'))}</h3>
      <dl class="kv">
        <dt>${esc(t('profileName'))}</dt><dd>${esc(p.display_name || '—')}</dd>
        <dt>${esc(t('username'))}</dt><dd>${username}</dd>
        <dt>${esc(t('region'))}</dt><dd>Indonesia</dd>
      </dl>
      <p>${esc(t('accountEditNote'))}</p>
    </div>
    <div class="subcard">
      <button type="button" class="menurow" id="menu-settings"><span class="grow"><span class="t">${esc(t('settings'))}</span><span class="d">${esc(t('setAccountSub'))}</span></span><span class="marrow">→</span></button>
      <button type="button" class="menurow" id="menu-help"><span class="grow"><span class="t">${esc(t('menuHelp'))}</span><span class="d">${esc(t('helpSub'))}</span></span><span class="marrow">→</span></button>
      <button type="button" class="menurow" id="menu-guide"><span class="grow"><span class="t">${esc(t('guide'))}</span><span class="d">${esc(t('guideSub'))}</span></span><span class="marrow">→</span></button>
      <button type="button" class="menurow danger" id="menu-logout"><span class="grow"><span class="t">${esc(t('logout'))}</span></span><span class="marrow">→</span></button>
    </div>
    <p class="foot">OLE Signals — ${esc(t('riskWarn'))}</p>`;
  bindPhotoInput('profile-photo-input', 'profile');
  $('#menu-settings').addEventListener('click', () => { S.settingsSub = null; showView('settings'); });
  $('#menu-help').addEventListener('click', () => showView('help'));
  $('#menu-guide').addEventListener('click', () => showView('guide'));
  $('#menu-logout').addEventListener('click', async () => {
    const yes = await confirmDialog(t('confirmLogoutTitle'), '', t('yesLogout'));
    if (!yes) return;
    try { await api.signOut(); } catch (e) { /* tetap lanjut */ }
    toast(t('toastSignedOut'));
  });
}

// ----------------------------------------------------------- Pengaturan ---
// Sub-halaman Profil: Akun, Akun Penarikan, Kata sandi dan keamanan,
// Tampilan, Notifikasi, Bahasa — masing-masing sub-halaman sendiri.
function renderSettings() {
  const body = $('#settings-body');
  if (!body) return;
  if (S.settingsSub === 'account') { renderSettingsAccount(body); return; }
  if (S.settingsSub === 'security') { renderSettingsSecurity(body); return; }
  if (S.settingsSub === 'appearance') { renderSettingsAppearance(body); return; }
  if (S.settingsSub === 'notifications') { renderSettingsNotifications(body); return; }
  if (S.settingsSub === 'language') { renderSettingsLanguage(body); return; }
  if (S.settingsSub === 'withdraw') { renderSettingsWithdraw(body); return; }
  const rows = [
    ['account', t('setAccount'), t('setAccountSub')],
    ['withdraw', t('setWithdraw'), t('setWithdrawSub')],
    ['security', t('securityTitle'), t('email')],
    ['appearance', t('theme'), t('themeAuto')],
    ['notifications', t('setNotif'), t('setNotifSub')],
    ['language', t('language'), getLang() === 'en' ? 'English' : 'Bahasa Indonesia'],
  ];
  body.innerHTML = `<div class="subcard">` + rows.map(([key, title, desc]) =>
    `<button type="button" class="menurow" data-setsub="${key}"><span class="grow"><span class="t">${esc(title)}</span><span class="d">${esc(desc)}</span></span><span class="marrow">→</span></button>`
  ).join('') + `</div>`;
  $$('[data-setsub]', body).forEach((b) => {
    b.addEventListener('click', () => { S.settingsSub = b.dataset.setsub; renderSettings(); });
  });
}
function settingsBackButton() {
  return `<div class="row" style="margin-bottom:12px;"><button class="btn ghost" id="set-sub-back" type="button">← ${esc(t('back'))}</button></div>`;
}
function bindSettingsBack() {
  const b = $('#set-sub-back');
  if (b) b.addEventListener('click', () => { S.settingsSub = null; renderSettings(); });
}
function renderSettingsAccount(body) {
  const p = S.profile || {};
  body.innerHTML = settingsBackButton()
    + `<div class="subcard"><h3>${esc(t('setAccount'))}</h3>
      <dl class="kv">
        <dt>${esc(t('profileName'))}</dt><dd>${esc(p.display_name || '—')}</dd>
        <dt>${esc(t('username'))}</dt><dd>${p.username ? '@' + esc(p.username) : '—'}</dd>
        <dt>${esc(t('region'))}</dt><dd>Indonesia</dd>
      </dl>
      <p>${esc(t('accountEditNote'))}</p></div>`;
  bindSettingsBack();
}
function renderSettingsSecurity(body) {
  body.innerHTML = settingsBackButton()
    + `<div class="subcard"><h3>${esc(t('securityTitle'))}</h3>
      <dl class="kv"><dt>${esc(t('email'))}</dt><dd>${esc(S.user?.email || '—')}</dd></dl>
      <form id="pw-form">
        <div class="field">
          <label for="pw-new">${esc(t('newPassword'))}</label>
          <input id="pw-new" type="password" required autocomplete="new-password" minlength="8" />
          <div class="hint">${esc(t('passwordHint'))}</div>
        </div>
        <div class="field">
          <label for="pw-confirm">${esc(t('passwordConfirm'))}</label>
          <input id="pw-confirm" type="password" required autocomplete="new-password" />
          <div class="hint" id="pw-match-hint"></div>
        </div>
        <div class="notice err" id="pw-err" hidden></div>
        <button class="btn primary" type="submit" id="pw-submit">${esc(t('save'))}</button>
      </form></div>`;
  bindSettingsBack();
  const pwNew = $('#pw-new');
  const pwCf = $('#pw-confirm');
  const pwMatchHint = $('#pw-match-hint');
  const refreshPwHint = () => {
    pwMatchHint.classList.remove('ok', 'bad');
    if (!pwCf.value) { pwMatchHint.textContent = ''; return; }
    if (pwNew.value === pwCf.value) {
      pwMatchHint.textContent = t('passwordMatch');
      pwMatchHint.classList.add('ok');
    } else {
      pwMatchHint.textContent = t('passwordMismatch');
      pwMatchHint.classList.add('bad');
    }
  };
  pwNew.addEventListener('input', refreshPwHint);
  pwCf.addEventListener('input', refreshPwHint);
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#pw-err');
    errBox.hidden = true;
    const pw = pwNew.value;
    if (!passwordValid(pw)) { errBox.textContent = t('authErrWeak'); errBox.hidden = false; return; }
    if (pw !== pwCf.value) { errBox.textContent = t('passwordMismatch'); errBox.hidden = false; return; }
    const btn = $('#pw-submit');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('loading') + '…';
    try {
      await api.updatePassword(pw);
      toast(t('passwordChanged'));
      pwNew.value = '';
      pwCf.value = '';
      refreshPwHint();
    } catch (err) {
      errBox.textContent = authErrorMessage(err);
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
function renderSettingsAppearance(body) {
  const pref = getThemePref();
  body.innerHTML = settingsBackButton()
    + `<div class="subcard"><h3>${esc(t('theme'))}</h3>
      <div class="seg" role="group">
        <button type="button" data-theme-opt="auto" aria-pressed="${pref === 'auto'}">${esc(t('themeAuto'))}</button>
        <button type="button" data-theme-opt="light" aria-pressed="${pref === 'light'}">${esc(t('themeLight'))}</button>
        <button type="button" data-theme-opt="dark" aria-pressed="${pref === 'dark'}">${esc(t('themeDark'))}</button>
      </div></div>`;
  bindSettingsBack();
  $$('[data-theme-opt]', body).forEach((b) => {
    b.addEventListener('click', () => {
      setThemePref(b.dataset.themeOpt);
      renderSettings();
    });
  });
}
function renderSettingsNotifications(body) {
  const prefs = getNotifPrefs();
  const items = [
    ['newSignal', t('notifToggleNew')],
    ['tpSl', t('notifToggleTpSl')],
    ['edited', t('notifToggleEdited')],
    ['expired', t('notifToggleExpired')],
    ['dup', t('notifToggleDup')],
    ['sub', t('notifToggleSub')],
  ];
  body.innerHTML = settingsBackButton()
    + `<div class="subcard"><h3>${esc(t('setNotif'))}</h3>`
    + items.map(([key, label]) => `<div class="settings-row"><span>${esc(label)}</span><input type="checkbox" data-notif-pref="${key}" ${prefs[key] ? 'checked' : ''} /></div>`).join('')
    + `<p>${esc(t('notifSavedNote'))}</p></div>`;
  bindSettingsBack();
  $$('[data-notif-pref]', body).forEach((cb) => {
    cb.addEventListener('change', () => {
      const next = getNotifPrefs();
      next[cb.dataset.notifPref] = cb.checked;
      saveNotifPrefs(next);
    });
  });
}
function renderSettingsLanguage(body) {
  body.innerHTML = settingsBackButton()
    + `<div class="subcard"><h3>${esc(t('language'))}</h3>
      <div class="seg" role="group">
        <button type="button" data-lang-opt="id" aria-pressed="${getLang() === 'id'}">Bahasa Indonesia</button>
        <button type="button" data-lang-opt="en" aria-pressed="${getLang() === 'en'}">English</button>
      </div></div>`;
  bindSettingsBack();
  $$('[data-lang-opt]', body).forEach((b) => {
    b.addEventListener('click', async () => {
      setLang(b.dataset.langOpt);
      applyI18n();
      showView('settings');
    });
  });
}
function renderSettingsWithdraw(body) {
  body.innerHTML = settingsBackButton()
    + `<div class="subcard"><h3>${esc(t('setWithdraw'))}</h3>
      <div class="empty"><strong>${esc(t('setWithdrawEmpty'))}</strong>${esc(t('setWithdrawNote'))}</div></div>`;
  bindSettingsBack();
}

// ------------------------------------------------- Pusat Bantuan & Keamanan ---
function renderHelp() {
  const body = $('#help-body');
  if (!body) return;
  const faqs = [1, 2, 3, 4, 5].map((n) => `<div class="faq-item"><b>${esc(t('helpFaq' + n + 'Q'))}</b><span>${esc(t('helpFaq' + n + 'A'))}</span></div>`).join('');
  body.innerHTML = `<div class="card">${faqs}</div>`
    + `<div class="card"><h2>${esc(t('helpRulesTitle'))}</h2><p>${esc(t('helpRulesBody'))}</p>`
    + `<button class="guidelink" id="help-guide-link" type="button">${esc(t('guideCta'))}<span aria-hidden="true"> →</span></button></div>`
    + `<p class="foot">${esc(t('riskWarn'))}</p>`;
  $('#help-guide-link').addEventListener('click', () => showView('guide'));
}

// -------------------------------------------------------------- Panduan ---
// Struktur mengikuti prototipe: 7 aturan singkat tetap jadi seksi pertama,
// lalu seksi-seksi lengkap yang bisa dibuka-tutup (details/summary).
// Isi yang mengandung HTML (<p>, <strong>) dirender via innerHTML dari
// kamus tepercaya (BUKAN esc()) — pola yang sama seperti prototipe.
const GUIDE_GLOSS = [['Entry', 'entry'], ['Stop Loss (SL)', 'sl'], ['Take Profit (TP)', 'tp'], ['Status sinyal', 'status'], ['Level', 'level'], ['Risiko', 'risk'], ['Saldo simulasi', 'balance'], ['Ikuti vs Langganan', 'sub'], ['Terverifikasi', 'verified'], ['Peringkat', 'board'], ['R-multiple (R)', 'r'], ['Recovery Factor', 'rf'], ['Drawdown', 'dd'], ['Compounding', 'comp'], ['Profit Factor', 'pf'], ['Win rate', 'wr'], ['R:R (risk : reward)', 'rr'], ['Pips', 'pips'], ['Streak', 'streak'], ['Holding period', 'hold'], ['Lot', 'lot'], ['Floating', 'floating']];

// Seksi Panduan yang terbuka disimpan supaya tetap terbuka setelah reload.
function loadGuideOpen() {
  try {
    const v = JSON.parse(localStorage.getItem('ole-guide-open') || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch (e) { return []; }
}
function saveGuideOpen() {
  try { localStorage.setItem('ole-guide-open', JSON.stringify(S.guideOpen)); } catch (e) { /* abaikan */ }
}

function guideSectionHtml(id, title, bodyHtml) {
  const open = S.guideOpen.includes(id) ? ' open' : '';
  return `<details class="card guide-sec" id="guide-${id}"${open}><summary class="guide-sec-sum"><h3>${esc(title)}</h3><span class="guide-sec-chev" aria-hidden="true">▾</span></summary><div class="more-body">${bodyHtml}</div></details>`;
}

// Petunjuk scroll tabel pangkat di layar kecil: bayangan tepi kanan hanya
// bila tabel benar-benar lebih lebar dari wadahnya (di layar lebar tidak muncul).
function updateLvlTableScrollHint() {
  const wrap = document.querySelector('#guide-level .lvltable-wrap');
  if (!wrap) return;
  wrap.classList.toggle('scrollable', wrap.scrollWidth > wrap.clientWidth + 1);
}
window.addEventListener('resize', () => {
  const lvlSec = $('#guide-level');
  if (lvlSec && lvlSec.open) updateLvlTableScrollHint();
});

function renderGuide() {
  const list = $('#guide-list');
  if (list) {
    list.innerHTML = ['guideR1', 'guideR2', 'guideR3', 'guideR4', 'guideR5', 'guideR6', 'guideR7']
      .map((k) => `<li>${esc(t(k))}</li>`)
      .join('');
  }
  const secs = $('#guide-sections');
  if (!secs) return;
  const flow = `<div class="flow" role="img" aria-label="PENDING → ${esc(t('flowLocked'))} → WIN / LOSS">`
    + `<span class="fstep"><b>PENDING</b><i>${esc(t('flowPendingSub'))}</i></span><span class="farr" aria-hidden="true">→</span>`
    + `<span class="fstep"><b>${esc(t('flowLocked'))}</b><i>${esc(t('flowLockedSub'))}</i></span><span class="farr" aria-hidden="true">→</span>`
    + `<span class="fstep win"><b>WIN / LOSS</b><i>${esc(t('flowResultSub'))}</i></span></div>`;
  // Tangga pangkat lengkap (dihitung dari rumus tangga tetap $10.000).
  let ladderRows = '';
  for (let ln = 1; ln <= 24; ln++) {
    const refLn = levelRef(ln);
    ladderRows += `<tr><td class="lvlcell mono">L${ln}</td><td class="rankname">${esc(levelName(ln, getLang()))}</td>`
      + `<td class="num mono">${esc(fmtUsd(refLn))}</td><td class="num mono">${esc(fmtUsd(refLn - START_BALANCE_USD))}</td>`
      + `<td>${ln === 1 ? esc(t('ladStart')) : esc(t('ladRStep'))}</td></tr>`;
  }
  const ladder = `<p>${t('ladIntro')}</p>`
    + `<div class="lvltable-wrap"><table class="lvltable"><thead><tr><th>${esc(t('ladColLevel'))}</th><th>${esc(t('ladColRank'))}</th><th class="num">${esc(t('ladColRef'))}</th><th class="num">${esc(t('ladColProfit'))}</th><th>${esc(t('ladColR'))}</th></tr></thead><tbody>${ladderRows}</tbody></table></div>`
    + `<p>${t('ladBeyond', { a: levelName(25, getLang()), b: levelName(26, getLang()) })}</p>`;
  const glossGrid = `<p style="margin:0 0 10px;">${esc(t('guideGlossSub'))}</p><div class="gloss-grid">`
    + GUIDE_GLOSS.map(([label, g]) => `<div class="gloss-item"><b>${esc(label)}</b><span>${esc(t('gloss_' + g))}</span></div>`).join('') + '</div>';
  secs.innerHTML =
    guideSectionHtml('signal', t('guideSecSignal'),
      flow + `<p>${t('heroDetail1')}</p><p>${t('heroDetail2')}</p><p>${t('formLockDetail')}</p><p>${t('guideRRRule')}</p><p>${t('guideExpiry')}</p><p>${t('guideDupRule')}</p>`)
    + guideSectionHtml('level', t('guideSecLevel'),
      ladder + `<p>${t('boardD2')}</p><p>${t('guideRefFixed')}</p>` + t('lvlRulesDetail') + t('lvlRulesDetail2') + `<p>${t('guideMinTrades')}</p><p>${t('guideOverRiskRule')}</p>`)
    + guideSectionHtml('board', t('guideSecBoard'), `<p>${t('boardD1')}</p>`)
    + guideSectionHtml('risk', t('guideSecRisk'), t('guideRisk1') + t('guideRisk2') + t('guideRisk3'))
    + guideSectionHtml('subs', t('guideSecSubs'),
      `<p>${t('boardD6')}</p><p>${t('boardD5')}</p>` + t('guideVerified') + t('guideShareSplit')
      + `<p>${esc(t('guidePriceChange'))}</p><p>${esc(t('guideWithdrawName'))}</p>` + t('guideWithdraw') + `<p>${esc(t('guideKycWithdraw'))}</p>`)
    + guideSectionHtml('share', t('guideSecShare'), t('guideShareBody'))
    + guideSectionHtml('reset', t('guideSecReset'), `<p>${esc(t('guideResetBody'))}</p><p>${esc(t('guideInactivity'))}</p>`)
    + guideSectionHtml('acct', t('guideSecAcct'), `<p>${esc(t('acctFoot'))}</p><p>${esc(t('guideAcctRules'))}</p><p>${esc(t('guideKycRules'))}</p>`)
    + guideSectionHtml('gloss', t('guideSecGloss'), glossGrid);
  // Ingat seksi yang terbuka supaya tetap terbuka saat kembali ke Panduan.
  $$('#guide-sections details').forEach((d) => {
    d.addEventListener('toggle', () => {
      const id = d.id.replace('guide-', '');
      S.guideOpen = S.guideOpen.filter((x) => x !== id);
      if (d.open) S.guideOpen.push(id);
      saveGuideOpen();
      updateLvlTableScrollHint();
    });
  });
  updateLvlTableScrollHint();
}

// ------------------------------------------------------------------ init ---
applyTheme();
applyI18n();
api.onAuthChange((session) => { handleSession(session); });
handleSession(await api.getSession()).catch((e) => {
  console.error('init session', e);
  showAuth();
});
