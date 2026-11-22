// OLE Signals — aplikasi web (Fase 1).
// Semua data dari database Supabase; tidak ada data seed, tidak ada
// localStorage sebagai sumber kebenaran (hanya preferensi tema/bahasa).
// Tulis sinyal HANYA lewat RPC (lihat js/api.js).

import { supabase } from './supabase.js';
import { t, setLang, getLang } from './i18n.js';
import { levelName, levelRef, nextLevelRef, PAY_GATE_LEVEL, START_BALANCE_USD } from './levels.js';
import { PAIRS, calcRr, calcRisk, validateSignal, decimalsForPair } from './risk.js';
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
  editingId: null,
  editingVersion: null,
  homeSignals: [],
  mySignals: [],
  traderSignals: [],
  traders: [],
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
function one(x) { return Array.isArray(x) ? x[0] : x; }
function traderOf(sig) { return one(sig.traders) || {}; }
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
}

// ------------------------------------------------------------------ nav ---
const VIEWS = ['home', 'search', 'office', 'profile', 'guide'];
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
}
$$('.bottom-nav [data-nav]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.nav));
});
$('#btn-guide-back').addEventListener('click', () => showView('profile'));
$('#btn-refresh-home').addEventListener('click', () => renderHome(true));

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
  btn.disabled = true;
  try {
    if (S.authMode === 'signup') {
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
  showApp();
  showView('home');
}

// ---------------------------------------------------------- kartu sinyal ---
function statusPill(status) {
  const cls = { PENDING: '', AKTIF: 'green', WIN: 'green', LOSS: 'red', CANCELLED: '', EXPIRED: '' }[status] || '';
  const label = { PENDING: 'pending', AKTIF: 'active', WIN: 'win', LOSS: 'loss', CANCELLED: 'cancelled', EXPIRED: 'expired' }[status] || status;
  return `<span class="pill ${cls}">${esc(t(label))}</span>`;
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
  const profitHtml = (sig.status === 'WIN' || sig.status === 'LOSS') && sig.profit_usd !== null && sig.profit_usd !== undefined
    ? `<div class="sig-meta">${esc(fmtUsd(sig.profit_usd))}${sig.r_value !== null && sig.r_value !== undefined ? ` · ${esc(fmtR(sig.r_value))}` : ''}</div>`
    : '';
  const expiryHtml = sig.status === 'PENDING'
    ? `<div class="sig-meta">${esc(fmtExpiry(sig.expires_at))}</div>` : '';
  return `<article class="sig ${dirCls}" data-sig="${esc(sig.id)}" tabindex="0" role="button">
    <div class="sig-head">
      <span class="sig-pair">${esc(sig.pair)}</span>
      <span class="dir ${dirCls}">${esc(sig.direction)}</span>
      ${statusPill(sig.status)}
      <span class="spacer"></span>
      <span class="pill">${esc(fmtNum(sig.lot_size, 2))} lot</span>
    </div>
    <div class="sig-trader">${mine ? esc(t('you')) + ' · ' : ''}${esc(name)} · Lv.${level} ${esc(levelName(level, getLang()))}${verified}</div>
    ${levelsHtml}
    ${profitHtml}
    ${expiryHtml}
    <div class="sig-meta">${esc(fmtDate(sig.created_at))}</div>
  </article>`;
}

function bindSignalCards(root) {
  $$('[data-sig]', root).forEach((el) => {
    const open = () => openSignalDetail(el.dataset.sig);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

function findSignal(id) {
  return S.homeSignals.find((s) => s.id === id)
    || S.mySignals.find((s) => s.id === id)
    || S.traderSignals.find((s) => s.id === id)
    || null;
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
  const profitHtml = (sig.status === 'WIN' || sig.status === 'LOSS')
    ? `<dl class="kv" style="margin-top:12px;">
        <dt>${esc(t('win'))}/${esc(t('loss'))}</dt><dd>${esc(fmtUsd(sig.profit_usd))}${sig.r_value !== null && sig.r_value !== undefined ? ` (${esc(fmtR(sig.r_value))})` : ''}</dd>
      </dl>` : '';
  const actions = [];
  if (mine && sig.status === 'PENDING') {
    actions.push(`<button class="btn" id="ov-edit" type="button">${esc(t('editSignal'))}</button>`);
    actions.push(`<button class="btn danger" id="ov-cancel" type="button">${esc(t('cancelSignal'))}</button>`);
  }
  if (!locked && !mine) {
    actions.push(`<button class="btn" id="ov-copy" type="button">⧉ ${esc(t('copySignal'))}</button>`);
  }
  openOverlay(`
    <button class="btn ghost close-x" id="ov-close" type="button">✕</button>
    <div class="sig-head">
      <span class="sig-pair">${esc(sig.pair)}</span>
      <span class="dir ${dirCls}">${esc(sig.direction)}</span>
      ${statusPill(sig.status)}
    </div>
    <div class="sig-trader">${esc(name)} · Lv.${level} ${esc(levelName(level, getLang()))}${verified}</div>
    ${levelsHtml}
    <dl class="kv" style="margin-top:12px;">
      <dt>${esc(t('lot'))}</dt><dd>${esc(fmtNum(sig.lot_size, 2))}</dd>
      <dt>${esc(t('createdAt'))}</dt><dd>${esc(fmtDate(sig.created_at))}</dd>
      ${sig.status === 'PENDING' ? `<dt></dt><dd>${esc(fmtExpiry(sig.expires_at))}</dd>` : ''}
    </dl>
    ${profitHtml}
    ${actions.length ? `<div class="sig-actions">${actions.join('')}</div>` : ''}`);
  $('#ov-close').onclick = closeOverlay;
  const copyBtn = $('#ov-copy');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = `${sig.pair} ${sig.direction} @ ${sig.entry} | SL ${sig.stop_loss} | TP ${sig.take_profit} | ${sig.lot_size} lot — OLE Signals`;
      try { await navigator.clipboard.writeText(text); } catch (e) { /* abaikan */ }
      toast(t('toastCopied'));
    };
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
}

// -------------------------------------------------------------- Beranda ---
async function renderHome(force = false) {
  const list = $('#home-list');
  if (!force && S.homeSignals.length === 0) list.innerHTML = `<p class="sub">${esc(t('loading'))}</p>`;
  try {
    S.homeSignals = await api.listPublicSignals();
  } catch (e) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  if (S.homeSignals.length === 0) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('feedEmpty'))}</strong>${esc(t('feedEmptyHint'))}</div>`;
    return;
  }
  list.innerHTML = S.homeSignals.map(signalCardHtml).join('');
  bindSignalCards(list);
}

// ------------------------------------------------------------------ Cari ---
async function renderSearch() {
  const list = $('#search-list');
  list.innerHTML = `<p class="sub">${esc(t('loading'))}</p>`;
  try {
    S.traders = await api.listTraders();
  } catch (e) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  if (S.traders.length === 0) {
    list.innerHTML = `<div class="empty"><strong>${esc(t('searchEmpty'))}</strong>${esc(t('searchHint'))}</div>`;
    return;
  }
  list.innerHTML = S.traders.map((tr) => {
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
  }).join('');
  $$('[data-trader]', list).forEach((el) => {
    const open = () => openTraderProfile(el.dataset.trader);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}

async function openTraderProfile(traderId) {
  const tr = S.traders.find((x) => x.profile_id === traderId);
  if (!tr) return;
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">✓ ${esc(t('verified'))}</span>` : '';
  const username = one(tr.profiles)?.username;
  openOverlay(`
    <button class="btn ghost close-x" id="ov-close" type="button">✕</button>
    <h2>${esc(tr.trader_display_name || t('noName'))} ${verified}</h2>
    <p style="color:var(--muted); font-size:13.5px;">${username ? '@' + esc(username) + ' · ' : ''}Lv.${level} ${esc(levelName(level, getLang()))}</p>
    <dl class="kv">
      <dt>${esc(t('balance'))}</dt><dd>${esc(fmtUsd(p ? p.balance_usd : START_BALANCE_USD))}</dd>
      <dt>${esc(t('rSince'))}</dt><dd>${esc(fmtR(p ? p.r_since_level : 0))}</dd>
      <dt>${esc(t('tradesSince'))}</dt><dd>${p ? Number(p.trades_since_level) || 0 : 0} / 5</dd>
    </dl>
    <h2 style="margin-top:16px;">${esc(t('traderSignals'))}</h2>
    <div id="ov-trader-signals"><p class="sub">${esc(t('loading'))}</p></div>`);
  $('#ov-close').onclick = closeOverlay;
  try {
    const sigs = await api.listTraderSignals(traderId);
    S.traderSignals = sigs;
    const box = $('#ov-trader-signals');
    if (!sigs.length) {
      box.innerHTML = `<div class="empty"><strong>${esc(t('feedEmpty'))}</strong></div>`;
      return;
    }
    box.innerHTML = sigs.map(signalCardHtml).join('');
    bindSignalCards(box);
  } catch (e) {
    $('#ov-trader-signals').innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
  }
}

// ----------------------------------------------------------- Ruang Kerja ---
function balanceCardHtml() {
  const p = progressOf(S.trader);
  const level = p ? Number(p.level) || 1 : 1;
  const balance = p ? Number(p.balance_usd) : START_BALANCE_USD;
  const r = p ? Number(p.r_since_level) || 0 : 0;
  const trades = p ? Number(p.trades_since_level) || 0 : 0;
  const ref = nextLevelRef(level);
  const pctBal = Math.min(100, Math.max(0, (balance / ref) * 100));
  const pctR = Math.min(100, Math.max(0, (r / 5) * 100));
  const pctTr = Math.min(100, (trades / 5) * 100);
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
    <div class="cond">
      <div class="rowline"><span>${esc(t('nextLevel', { ref: fmtUsd(ref) }))}</span></div>
      <div class="progress" style="margin-top:8px;">
        <div class="track"><div class="fill" style="width:${pctBal.toFixed(0)}%"></div></div>
        <small>${esc(t('balance'))} ${esc(fmtUsd(balance))} / ${esc(fmtUsd(ref))}</small>
      </div>
      <div class="progress" style="margin-top:8px;">
        <div class="track"><div class="fill" style="width:${pctR.toFixed(0)}%"></div></div>
        <small>${esc(t('rSince'))}: ${esc(fmtR(r))} / +5R</small>
      </div>
      <div class="progress" style="margin-top:8px;">
        <div class="track"><div class="fill" style="width:${pctTr.toFixed(0)}%"></div></div>
        <small>${esc(t('tradesSince'))}: ${trades} / 5</small>
      </div>
    </div>
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
          <input id="sf-entry" type="number" step="any" min="0" required value="${sig ? esc(sig.entry) : ''}" placeholder="3000" />
        </div>
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-lot">${esc(t('lot'))}</label>
          <input id="sf-lot" type="number" step="0.01" min="0.01" required value="${sig ? esc(sig.lot_size) : '0.01'}" />
        </div>
      </div>
      <div class="row">
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-sl">${esc(t('stopLoss'))}</label>
          <input id="sf-sl" type="number" step="any" min="0" required value="${sig ? esc(sig.stop_loss) : ''}" placeholder="2990" />
        </div>
        <div class="field" style="flex:1; min-width:120px;">
          <label for="sf-tp">${esc(t('takeProfit'))}</label>
          <input id="sf-tp" type="number" step="any" min="0" required value="${sig ? esc(sig.take_profit) : ''}" placeholder="3020" />
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

  const editing = S.editingId
    ? S.mySignals.find((s) => s.id === S.editingId) || null
    : null;

  let html = balanceCardHtml();
  html += signalFormHtml(editing);
  html += `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('mySignals'))}</h2>`;
  html += `<div class="tabs" role="tablist">
    <button class="tab" role="tab" data-tab="PENDING" aria-selected="${S.officeTab === 'PENDING'}">${esc(t('tabPending'))}</button>
    <button class="tab" role="tab" data-tab="AKTIF" aria-selected="${S.officeTab === 'AKTIF'}">${esc(t('tabActive'))}</button>
    <button class="tab" role="tab" data-tab="HISTORY" aria-selected="${S.officeTab === 'HISTORY'}">${esc(t('tabHistory'))}</button>
  </div>`;
  html += `<div id="office-list"><p class="sub">${esc(t('loading'))}</p></div>`;
  body.innerHTML = html;

  bindSignalForm(editing);
  $$('#office-body [data-tab]').forEach((b) => {
    b.addEventListener('click', () => { S.officeTab = b.dataset.tab; renderOfficeList(); });
  });
  await renderOfficeList();
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
    list.innerHTML = `<div class="empty"><strong>${esc(t('feedEmpty'))}</strong>${esc(t('feedEmptyHint'))}</div>`;
    return;
  }
  list.innerHTML = filtered.map(signalCardHtml).join('');
  bindSignalCards(list);
}

// -------------------------------------------------------------- Profil ---
async function renderProfile() {
  const body = $('#profile-body');
  const p = S.profile || {};
  const username = p.username ? '@' + esc(p.username) : '—';
  body.innerHTML = `
    <div class="card">
      <h2>${esc(t('accountInfo'))}</h2>
      <dl class="kv">
        <dt>${esc(t('email'))}</dt><dd>${esc(S.user?.email || '—')}</dd>
        <dt>${esc(t('username'))}</dt><dd>${username}</dd>
        <dt>${esc(t('displayName'))}</dt><dd>${esc(p.display_name || '—')}</dd>
      </dl>
    </div>
    <div class="card">
      <h2>${esc(t('settings'))}</h2>
      <div class="settings-row">
        <span>${esc(t('theme'))}</span>
        <select id="set-theme">
          <option value="auto">${esc(t('themeAuto'))}</option>
          <option value="light">${esc(t('themeLight'))}</option>
          <option value="dark">${esc(t('themeDark'))}</option>
        </select>
      </div>
      <div class="settings-row">
        <span>${esc(t('language'))}</span>
        <select id="set-lang">
          <option value="id">Bahasa Indonesia</option>
          <option value="en">English</option>
        </select>
      </div>
      <div class="settings-row">
        <span>${esc(t('guide'))}</span>
        <button class="btn" id="btn-guide" type="button">${esc(t('guide'))} →</button>
      </div>
    </div>
    <button class="btn danger" id="btn-logout" type="button" style="width:100%; justify-content:center;">${esc(t('logout'))}</button>
    <p class="foot">OLE Signals — ${esc(t('riskWarn'))}</p>`;
  const themeSel = $('#set-theme');
  themeSel.value = getThemePref();
  themeSel.addEventListener('change', () => setThemePref(themeSel.value));
  const langSel = $('#set-lang');
  langSel.value = getLang();
  langSel.addEventListener('change', async () => {
    setLang(langSel.value);
    applyI18n();
    showView(S.view); // render ulang tampilan aktif dalam bahasa baru
  });
  $('#btn-guide').addEventListener('click', () => showView('guide'));
  $('#btn-logout').addEventListener('click', async () => {
    const yes = await confirmDialog(t('confirmLogoutTitle'), '', t('yesLogout'));
    if (!yes) return;
    try { await api.signOut(); } catch (e) { /* tetap lanjut */ }
    toast(t('toastSignedOut'));
  });
}

// -------------------------------------------------------------- Panduan ---
function renderGuide() {
  const list = $('#guide-list');
  list.innerHTML = ['guideR1', 'guideR2', 'guideR3', 'guideR4', 'guideR5', 'guideR6', 'guideR7']
    .map((k) => `<li>${esc(t(k))}</li>`)
    .join('');
}

// ------------------------------------------------------------------ init ---
applyTheme();
applyI18n();
api.onAuthChange((session) => { handleSession(session); });
handleSession(await api.getSession()).catch((e) => {
  console.error('init session', e);
  showAuth();
});
