// OLE Signals — aplikasi web (Fase 1).
// Semua data dari database Supabase; tidak ada data seed, tidak ada
// localStorage sebagai sumber kebenaran (hanya preferensi tema/bahasa).
// Tulis sinyal HANYA lewat RPC (lihat js/api.js).

import { supabase } from './supabase.js';
import { SUPABASE_URL } from './config.js';
import { t, setLang, getLang } from './i18n.js';
import { levelName, levelRef, nextLevelRef, downLevelRef, PAY_GATE_LEVEL, START_BALANCE_USD } from './levels.js';
import { PAIRS, calcRr, calcRisk, inferEntryType, quoteToUsd, contractSize, validateSignal, decimalsForPair } from './risk.js';
import { computeStats, rankedTraders, pipSize, pipsPnl } from './stats.js';
import * as api from './api.js';

// Pendaftaran DITUTUP (keputusan user 24 Nov 2026): jangan terima
// pendaftaran baru sampai web benar-benar jadi. Penegakan server-side
// ada di pengaturan Auth Supabase ("Allow new users to sign up" OFF);
// flag ini hanya menyembunyikan alur daftar di UI + memblokir submit.
const REGISTRATION_OPEN = false;

// Ikon SVG garis tipis, satu set (stroke currentColor, viewBox 24) —
// pengganti glyph Unicode/emoji (R-04). Satu set yang koheren, bukan
// campuran glyph. Ukuran diatur di CSS per konteks pemakaian.
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
  wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  chevD: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  // R24: ikon baris Profil (SVG dari file preview yang disetujui).
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7.5h9"/><path d="M17.5 7.5H20"/><circle cx="15" cy="7.5" r="2.2"/><path d="M4 16.5h3.5"/><path d="M12 16.5h8"/><circle cx="9.5" cy="16.5" r="2.2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Z"/><path d="M4 18V5.5"/><path d="M20 18H6.5A2.5 2.5 0 0 0 4 20.5"/></svg>',
  // R41: ikon baris Profil Tampilan + Bahasa (gaya feather, sama seperti ikon lain).
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3"/><path d="m16 16.5 5-4.5-5-4.5"/><path d="M21 12H9.5"/></svg>',
};

// ---------------------------------------------------------------- state ---
// R9-1: user id yang sudah diarahkan ke Beranda oleh handleSession. Dipakai
// membedakan login baru (arah ke Beranda) dari SIGNED_IN/INITIAL_SESSION
// ulang untuk user yang sama (jangan sentuh tampilan). Direset saat keluar.
let __oleHomeNavDoneFor = null;
const S = {
  session: null,
  user: null,
  profile: null,
  trader: null, // baris traders + trader_progress (null bila belum ada)
  prices: new Map(),
  prevPrices: new Map(), // R37b: harga SEBELUM gerakan terakhir per pair (sticky; pembanding panah ticker; kosong = tanpa panah)
  view: 'home',
  officeTab: 'ALL',
  officeTraderTab: 'sinyal',
  traderProfileTab: 'sinyal',
  traderProfileFilter: 'ALL',
  traderProfileId: null,
  traderProfileFrom: 'search',
  traderProfileRange: 'ALL',
  traderProfileCustom: { from: '', to: '' },
  monthYear: null, // R29: tahun terpilih tabel Profit Per Month (null = default: tahun terbaru berdata)
  chartYear: null, // R51: tahun terpilih grafik Akumulasi profit (null = default: tahun terbaru berdata)
  chartPoint: null, // R51: indeks titik terpilih di grafik tahun berjalan (null = titik terakhir)
  officeRange: 'ALL',
  officeCustom: { from: '', to: '' },
  walletTab: 'tx',
  walletRange: 'ALL',
  walletCustom: { from: '', to: '' },
  secPage: null, // sub-halaman Kata sandi: null | 'pw' | 'email'
  acctPage: null, // R41: sub-halaman Akun: null | 'name' | 'follower' | 'trader'
  profileSub: null, // R25: sub-halaman Profil: null | 'kyc' | 'detail'
  wdAdd: false, // form tambah Akun Penarikan sedang dibuka
  followFilter: 'ALL',
  followerTab: 'signals', // R39: sub-menu Follower — 'signals' | 'copies'
  followerRange: 'ALL', // filter tanggal Riwayat follower (Sinyal)
  followerCustom: { from: '', to: '' },
  dateFilterOpen: '',
  dateFilterDraft: null,
  searchQuery: '',
  searchSort: 'wr',
  searchTab: 'traders',
  searchFilters: { q: '', pair: 'ALL', topPair: 'ALL', sort: 'wr', wrMin: '0', rrMin: '0', pfMin: '0', levelMin: '1', price: 'all', rfMin: '0' },
  searchDraft: null,
  searchPfHidden: 0,
  feedFilter: { pair: 'ALL', status: 'ALL' },
  guideSub: null, // R30: sub-halaman Panduan: null = daftar, id = detail seksi
  helpGuideTab: 'guide', // sub-tab tampilan gabungan: 'guide' | 'help'
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
  // R41: wadah pemilik sub-halaman Pengaturan yang sedang terbuka:
  // 'settings' (daftar Pengaturan) atau 'profile' (menu Profil, tempat
  // Tampilan/Notifikasi/Bahasa pindah). Menentukan tujuan tombol kembali.
  settingsOrigin: 'settings',
  authMode: 'login',
  authScreen: 'login', // Ronde 63: layar auth ('login' | 'forgot' | 'sent' | 'reset' | 'resetDone')
  recoveryExchangePending: false, // Ronde 67: boot sedang menukar token recovery jadi sesi (setSession/exchangeCodeForSession); handleSession menunda enterRecovery(null) selama flag ini true supaya layar reset tidak sempat dirender tidak valid.
  resetEmail: '', // Ronde 63 (amandemen): email yang dikirimi link reset (layar sent + backoff)
  followerCounts: {},
  copiedIds: new Set(),
  usernameUI: { trader: { draft: '', res: null, pending: null, timer: null }, follower: { draft: '', res: null, pending: null, timer: null } },
  photoDraft: { profile: false, trader: false },
  photoUploadDraft: { profile: null, trader: null }, // File foto yang di-stage (belum diunggah)
  photoUploadPreview: { profile: '', trader: '' }, // object URL pratinjau foto staged
  kycFlow: { step: 1, name: '', ktpAttached: false },
  secFlow: { email: '', code: '' },
  reports: loadReports(),
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
  // B1-15: buang nol di belakang koma + pemisah desimal sesuai bahasa
  // (prototipe): ID "+2R" / "+2,5R", EN "+2R" / "+2.5R".
  const v = Number(n) || 0;
  const s = v.toFixed(1).replace(/\.0$/, '');
  return (v > 0 ? '+' : '') + ds(s) + 'R';
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
// Waktu relatif seperti prototipe ("9 mnt lalu" / "2 jam lalu" / "3 hari lalu").
export function fmtRel(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return t('agoMin', { n: Math.max(1, mins) });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('agoHour', { n: hours });
  return t('agoDay', { n: Math.floor(hours / 24) });
}
// R ringkas seperti prototipe: +2R, -1R, +2,5R (tanpa nol di belakang).
function fmtRShort(r) {
  const v = Number(r) || 0;
  const s = Math.abs(v).toFixed(2).replace(/\.?0+$/, '');
  return (v > 0 ? '+' : v < 0 ? '-' : '') + ds(s) + 'R';
}
// Pemisah desimal sesuai bahasa (D38): ID memakai koma, EN titik.
function ds(x) {
  const str = String(x);
  return getLang() === 'en' ? str : str.replace('.', ',');
}
// USD bulat bertanda seperti prototipe: +$31, -$31.
function fmtUsd0(n) {
  const v = Number(n) || 0;
  const s = '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
  return (v > 0 ? '+' : v < 0 ? '-' : '') + s;
}
// USD tabel pangkat seperti prototipe: tanpa desimal, pemisah ribuan
// mengikuti bahasa — "$10.000" (ID) / "$10,000" (EN).
function fmtUsdTable(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString(getLang() === 'en' ? 'en-US' : 'id-ID');
}
// Rupiah bulat seperti prototipe: "Rp844.000" (ID) / "Rp844,000" (EN).
function fmtIdr(n) {
  return 'Rp' + Math.round(Number(n) || 0).toLocaleString(getLang() === 'en' ? 'en-US' : 'id-ID');
}
// Pips bertanda seperti prototipe: +428 pips, -31 pips.
function fmtPipsSigned(n) {
  const v = Math.round(Number(n) || 0);
  return (v > 0 ? '+' : v < 0 ? '-' : '') + Math.abs(v) + ' pips';
}
// ---- filter tanggal (Riwayat): preset + rentang kustom -----------------
function withinHistRange(ts, key, custom) {
  if (!key || key === 'ALL') return true;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const startOf = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const endOf = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
  const today = startOf(now);
  let from = null, to = null;
  if (key === 'TODAY') { from = today; to = endOf(now); }
  else if (key === 'YESTERDAY') { from = new Date(today.getTime() - 86400000); to = new Date(today.getTime() - 1); }
  else if (key === 'LAST7') { from = new Date(today.getTime() - 6 * 86400000); to = endOf(now); }
  else if (key === 'LAST30') { from = new Date(today.getTime() - 29 * 86400000); to = endOf(now); }
  else if (key === 'THISMONTH') { from = new Date(now.getFullYear(), now.getMonth(), 1); to = endOf(now); }
  else if (key === 'LASTMONTH') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, -1); }
  else if (key === 'CUSTOM' && custom?.from && custom?.to) {
    from = startOf(new Date(custom.from + 'T00:00:00'));
    to = endOf(new Date(custom.to + 'T00:00:00'));
  } else return true;
  return d >= from && d <= to;
}
function rangeLabel(range, key) {
  const map = { TODAY: 'dfPresetToday', YESTERDAY: 'dfPresetYesterday', LAST7: 'dfPresetLast7', LAST30: 'dfPresetLast30', THISMONTH: 'dfPresetThisMonth', LASTMONTH: 'dfPresetLastMonth', CUSTOM: 'dfPresetCustom' };
  if (range === 'CUSTOM') {
    const c = key === 'office' ? S.officeCustom : key === 'wallet' ? S.walletCustom : key === 'follower' ? S.followerCustom : S.traderProfileCustom;
    return `${c.from || '…'} – ${c.to || '…'}`;
  }
  return t(map[range] || 'dfPresetAll');
}
function dateFilterBarHtml(key) {
  const range = key === 'office' ? S.officeRange : key === 'wallet' ? S.walletRange : key === 'follower' ? S.followerRange : S.traderProfileRange;
  const open = S.dateFilterOpen === key;
  const label = range === 'ALL' ? t('dateFilterBtn') : rangeLabel(range, key);
  return `<span class="df-wrap"><button class="date-filter-btn" type="button" data-df="${key}">${esc(label)} ${ICONS.chevD}</button>`
    + (open ? dateFilterPopupHtml(key) : '') + `</span>`;
}
function monthGridHtml(y, m, from, to) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // Senin pertama
  const daysIn = new Date(y, m + 1, 0).getDate();
  const wd = getLang() === 'id'
    ? ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthName = first.toLocaleDateString(getLang() === 'id' ? 'id-ID' : 'en-US', { month: 'long', year: 'numeric' });
  let cells = wd.map((w) => `<span class="df-wd">${w}</span>`).join('');
  for (let i = 0; i < offset; i++) cells += '<span class="df-day empty"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const future = iso > todayStr;
    const cls = ['df-day'];
    if (iso === from) cls.push('start');
    if (iso === to) cls.push('end');
    if (from && to && iso > from && iso < to) cls.push('inrange');
    if (iso === todayStr) cls.push('today');
    if (future) cls.push('future');
    cells += future
      ? `<span class="${cls.join(' ')}" aria-disabled="true">${d}</span>`
      : `<button class="${cls.join(' ')}" type="button" data-df-day="${iso}">${d}</button>`;
  }
  return `<div class="df-cal"><div class="df-cal-head"><button class="btn" type="button" data-df-nav="-1" aria-label="${esc(t('dfPrevMonth'))}">${ICONS.chevL}</button><span>${esc(monthName)}</span><button class="btn" type="button" data-df-nav="1" aria-label="${esc(t('dfNextMonth'))}">${ICONS.chevR}</button></div><div class="df-grid">${cells}</div></div>`;
}
function dateFilterPopupHtml(key) {
  const range = key === 'office' ? S.officeRange : key === 'wallet' ? S.walletRange : key === 'follower' ? S.followerRange : S.traderProfileRange;
  const custom = key === 'office' ? S.officeCustom : key === 'wallet' ? S.walletCustom : key === 'follower' ? S.followerCustom : S.traderProfileCustom;
  const draft = S.dateFilterDraft || { range, from: custom.from || '', to: custom.to || '' };
  const presets = ['ALL', 'TODAY', 'YESTERDAY', 'LAST7', 'LAST30', 'THISMONTH', 'LASTMONTH', 'CUSTOM'];
  const presetKey = { ALL: 'dfPresetAll', TODAY: 'dfPresetToday', YESTERDAY: 'dfPresetYesterday', LAST7: 'dfPresetLast7', LAST30: 'dfPresetLast30', THISMONTH: 'dfPresetThisMonth', LASTMONTH: 'dfPresetLastMonth', CUSTOM: 'dfPresetCustom' };
  const chips = presets.map((p) => `<button class="df-preset${draft.range === p ? ' on' : ''}" type="button" data-df-preset="${p}" data-df-key="${key}">${esc(t(presetKey[p]))}</button>`).join('');
  const cal = draft.range === 'CUSTOM'
    ? monthGridHtml(draft.viewY, draft.viewM, draft.from, draft.to) : '';
  return `<div class="df-popup"><div class="df-presets">${chips}</div>${cal}`
    + `<div class="df-foot"><button class="btn primary" type="button" data-df-apply="${key}">${esc(t('dateFilterApply'))}</button>`
    + `<button class="btn" type="button" data-df-cancel="${key}">${esc(t('dateFilterCancel'))}</button></div></div>`;
}
function bindDateFilter(root, key, onChange) {
  $$('[data-df]', root).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (S.dateFilterOpen === key) { S.dateFilterOpen = ''; S.dateFilterDraft = null; }
      else {
        S.dateFilterOpen = key;
        const range = key === 'office' ? S.officeRange : key === 'wallet' ? S.walletRange : key === 'follower' ? S.followerRange : S.traderProfileRange;
        const custom = key === 'office' ? S.officeCustom : key === 'wallet' ? S.walletCustom : key === 'follower' ? S.followerCustom : S.traderProfileCustom;
        const base = custom.from ? new Date(custom.from + 'T00:00:00') : new Date();
        S.dateFilterDraft = { range, from: custom.from || '', to: custom.to || '', viewY: base.getFullYear(), viewM: base.getMonth() };
      }
      onChange();
    });
  });
  $$('[data-df-preset]', root).forEach((b) => {
    b.addEventListener('click', () => {
      if (S.dateFilterDraft) S.dateFilterDraft.range = b.dataset.dfPreset;
      onChange();
    });
  });
  $$('[data-df-day]', root).forEach((b) => {
    b.addEventListener('click', () => {
      const d = S.dateFilterDraft;
      if (!d) return;
      const iso = b.dataset.dfDay;
      if (!d.from || (d.from && d.to)) { d.from = iso; d.to = ''; }
      else if (iso >= d.from) { d.to = iso; }
      else { d.from = iso; }
      onChange();
    });
  });
  $$('[data-df-nav]', root).forEach((b) => {
    b.addEventListener('click', () => {
      const d = S.dateFilterDraft;
      if (!d) return;
      const n = new Date(d.viewY, d.viewM + Number(b.dataset.dfNav), 1);
      d.viewY = n.getFullYear();
      d.viewM = n.getMonth();
      onChange();
    });
  });
  $$('[data-df-apply]', root).forEach((b) => {
    b.addEventListener('click', () => {
      const d = S.dateFilterDraft;
      if (d) {
        if (key === 'office') { S.officeRange = d.range; if (d.range === 'CUSTOM') S.officeCustom = { from: d.from, to: d.to }; }
        else if (key === 'wallet') { S.walletRange = d.range; if (d.range === 'CUSTOM') S.walletCustom = { from: d.from, to: d.to }; }
        else if (key === 'follower') { S.followerRange = d.range; if (d.range === 'CUSTOM') S.followerCustom = { from: d.from, to: d.to }; }
        else { S.traderProfileRange = d.range; if (d.range === 'CUSTOM') S.traderProfileCustom = { from: d.from, to: d.to }; }
      }
      S.dateFilterOpen = ''; S.dateFilterDraft = null;
      onChange();
    });
  });
  $$('[data-df-cancel]', root).forEach((b) => {
    b.addEventListener('click', () => { S.dateFilterOpen = ''; S.dateFilterDraft = null; onChange(); });
  });
}

// Embed PostgREST bisa objek (relasi to-one) — normalisasi defensif.
// Bila sinyal datang tanpa embed traders (mis. dari listAllSignals),
// cari namanya di daftar trader yang sudah dimuat.
function one(x) { return Array.isArray(x) ? x[0] : x; }
function traderOf(sig) {
  // S.traders diutamakan: data segar (diperbarui refreshTraders() setelah
  // ganti foto/identitas) dan memuat trader_avatar_url. Embed dipakai
  // hanya bila trader belum ada di S.traders (mis. jalur /v/).
  const fromList = S.traders.find((x) => x.profile_id === sig.trader_id);
  if (fromList) return fromList;
  const emb = one(sig.traders);
  return emb || {};
}
function progressOf(trader) { return one(trader?.trader_progress) || null; }
// Aturan ronde 5: di permukaan PUBLIK hanya tampil @username, bukan nama
// profil/display name. Username TRADER diambil dari tr.username
// (kolom traders.username, ronde 6b) — BUKAN dari profiles.username
// (itu username follower). Fallback ke display name hanya bila data
// benar-benar tanpa username (tidak boleh terjadi — migrasi 12 membuat
// traders.username NOT NULL).
function traderHandle(tr) {
  const un = tr?.username;
  if (un) return '@' + un;
  return tr?.trader_display_name || t('noName');
}
function levelOfSignal(sig) {
  const p = progressOf(traderOf(sig));
  return p ? Number(p.level) || 1 : 1;
}
// Harga langganan trader (USD; null/0 = gratis). Diambil dari daftar
// trader yang dimuat (bukan embed sinyal — embed tidak membawa harga).
function subPriceOfTrader(traderId) {
  const tr = S.traders.find((x) => x.profile_id === traderId);
  if (!tr) return null;
  const v = tr.subscription_price_usd;
  return (v === null || v === undefined) ? 0 : Number(v);
}
function isSubscribedTo(traderId) {
  return S.mySubs.some((x) => x.trader_id === traderId && x.status === 'active');
}
// D02: hanya PENDING/AKTIF yang berbayar yang terkunci — WIN/LOSS selalu
// publik, trader gratis tidak pernah terkunci, pelanggan tidak terkunci.
function isLockedForMe(sig) {
  if (!sig) return false;
  if (S.user && sig.trader_id === S.user.id) return false; // sinyal sendiri
  if (sig.status === 'WIN' || sig.status === 'LOSS') return false;
  if (levelOfSignal(sig) < PAY_GATE_LEVEL) return false;
  const price = subPriceOfTrader(sig.trader_id);
  if (price === null) return false; // harga belum diketahui — jangan kunci
  if (!(price > 0)) return false;
  return !isSubscribedTo(sig.trader_id);
}
// R61: jaring pengaman server — view signals_public mengembalikan entry
// NULL untuk sinyal terkunci. Entry NULL pada sinyal terbuka = terkunci
// menurut server, jadi perlakukan sebagai terkunci walau isLockedForMe
// belum bisa memutuskan (mis. S.traders belum termuat saat feed pertama
// dirender — tanpa ini kartu sempat menampilkan "0.00" karena fmtNum(null)).
function isLockedOrHidden(sig) {
  if (isLockedForMe(sig)) return true;
  return !!sig && sig.entry == null
    && (sig.status === 'PENDING' || sig.status === 'AKTIF');
}
function lockedDescFor(traderId) {
  const price = subPriceOfTrader(traderId);
  return t('lockedSignalDesc', { price: price ? fmtIdr(price) + t('perMonth') : t('profFree') });
}
// D08: tombol Ikuti / Langganan (struktur prototipe). Ikuti = Fase 5 dan
// Langganan = fase pembayaran — keduanya menampilkan aksi jujur "menyusul",
// bukan fungsi palsu.
function isFollowing(traderId) {
  return S.myFollows.some((x) => x.trader_id === traderId);
}
function followBtnHtml(traderId) {
  if (S.user && traderId === S.user.id) return '';
  const followed = isFollowing(traderId);
  return `<button class="btn${followed ? ' active' : ''}" type="button" data-follow="${esc(traderId)}" aria-pressed="${followed}">${esc(followed ? t('followed') : t('follow'))}</button>`;
}
function subscribeBtnHtml(traderId) {
  if (S.user && traderId === S.user.id) return '';
  const price = subPriceOfTrader(traderId);
  const label = price > 0
    ? `${esc(t('subscribe'))} · ${esc(fmtIdr(price))}${esc(t('perMonth'))}`
    : `${esc(t('subscribe'))} · ${esc(t('profFree'))}`;
  return `<button class="btn" type="button" data-subscribe="${esc(traderId)}">${label}</button>`;
}
function subBadgeHtml(traderId) {
  const price = subPriceOfTrader(traderId);
  return price > 0
    ? `<span class="subbadge">${esc(t('subscribe'))} ${esc(fmtIdr(price))}${esc(t('perMonth'))}</span>`
    : `<span class="subbadge free">${esc(t('profFree'))}</span>`;
}
// Ronde 8b (a): perbarui SEMUA tombol Ikuti untuk trader yang sama di
// seluruh tampilan (feed, Cari, Peringkat, profil trader, Diikuti) —
// bukan hanya tombol yang diklik — supaya label tidak basi.
function paintFollowButtons(traderId) {
  const followed = isFollowing(traderId);
  $$(`[data-follow="${CSS.escape(traderId)}"]`).forEach((b) => {
    b.classList.toggle('active', followed);
    b.textContent = followed ? t('followed') : t('follow');
    b.setAttribute('aria-pressed', String(followed));
  });
}
// Ronde 8b (b): muat ulang jumlah pengikut trader dari DB lalu perbarui
// semua tampilannya (kartu Cari .fol + halaman profil #tp-followers).
async function paintFollowerCount(traderId) {
  try { S.followerCounts[traderId] = await api.countFollowers(traderId); } catch (e) { return; }
  const txt = t('followersCount', { n: S.followerCounts[traderId] });
  $$(`.tcard[data-trader="${CSS.escape(traderId)}"] .fol`).forEach((el) => { el.textContent = txt; });
  const tp = $('#tp-followers');
  if (tp) tp.textContent = txt;
}

// Ronde 26: tulis ulang SEMUA angka pengikut yang sedang tampil dari
// S.followerCounts (tanpa query baru) — dipakai sesudah hitungan dimuat
// ulang, supaya kartu yang ter-paint dari cache lama ikut benar. Kunci yang
// tidak ada (gagal dimuat) tampil "—", bukan angka basi.
function paintAllFollowerCounts() {
  $$('.tcard[data-trader] .fol').forEach((el) => {
    const card = el.closest('.tcard');
    const id = card && card.dataset.trader;
    const n = id ? S.followerCounts[id] : undefined;
    el.textContent = n === undefined ? '—' : t('followersCount', { n });
  });
}

// Ronde 26: muat ulang hitungan dari DB lalu cat ulang tampilannya. Dipanggil
// otomatis bila daftar menampilkan "—" (hitungan belum diketahui) — mis.
// sesudah kegagalan sesaat — supaya angka pulih sendiri tanpa perlu
// buka-tutup menu. Dibatasi 1×/10 detik supaya tidak membanjiri DB saat
// filter sering berubah; paintAll hanya mengubah teks, bukan re-render.
let __folRefreshLast = 0;
let __folRefreshRunning = false;
async function refreshFollowerCounts() {
  if (__folRefreshRunning) return;
  const now = Date.now();
  if (now - __folRefreshLast < 10000) return;
  __folRefreshLast = now;
  __folRefreshRunning = true;
  try {
    const counts = await Promise.all(S.traders.map((tr) => api.countFollowers(tr.profile_id).catch(() => null)));
    S.traders.forEach((tr, i) => { if (counts[i] !== null && counts[i] !== undefined) S.followerCounts[tr.profile_id] = counts[i]; });
    paintAllFollowerCounts();
  } finally { __folRefreshRunning = false; }
}
// Ronde 8b (a): perbarui SEMUA tombol Salin untuk sinyal yang sama di
// seluruh tampilan (feed, Trader/Follower) — bukan hanya yang diklik.
function paintCopyButtons(signalId) {
  const copied = S.copiedIds.has(signalId);
  $$(`[data-act="copy"][data-sig="${CSS.escape(signalId)}"]`).forEach((b) => {
    b.innerHTML = (copied ? ICONS.check + ' ' : ICONS.copy + ' ') + t(copied ? 'copied' : 'copySignal');
  });
}
function bindFollowSubscribe(root) {
  $$('[data-follow]', root).forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const traderId = b.dataset.follow;
      const followed = isFollowing(traderId);
      b.disabled = true;
      try {
        if (followed) {
          await api.unfollowTrader(S.user.id, traderId);
        } else {
          await api.followTrader(S.user.id, traderId);
        }
        // Muat ulang daftar ikutan agar semua tampilan (tab Diikuti di
        // Cari, tombol) konsisten.
        try { S.myFollows = await api.listMyFollows(S.user.id); } catch (err) { /* abaikan */ }
        const nowFollowed = isFollowing(traderId);
        paintFollowButtons(traderId);
        await paintFollowerCount(traderId);
        const name = traderHandle(traderOf({ trader_id: traderId }));
        toast(t(nowFollowed ? 'toastFollowed' : 'toastUnfollowed', { name }));
        // R25: segarkan "Sinyal dari trader yang kamu ikuti" bila halaman
        // menu Follower sedang dibuka (tanpa reload).
        if (S.view === 'office-follower') renderOfficeFollowerTab();
      } catch (err) {
        toast(t('errNetwork'), true);
      } finally {
        b.disabled = false;
      }
    });
  });
  $$('[data-subscribe]', root).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      toast(t('subscribeSoon'));
    });
  });
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
  // Abaikan '@' di depan handle supaya avatar "@demo_gamma" berhuruf "D".
  const s = String(name || '?').trim().replace(/^@/, '');
  return (s.charAt(0) || '?').toUpperCase();
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
// R12/F2: cache S.allSignals hanya dimuat sekali (ensureAllSignals).
// Setelah sinyal dibuat/diubah/dibatalkan, daftar (S.mySignals) dimuat
// ulang tapi cache ini TIDAK — statistik profil (statsForTrader) jadi
// basi (pernah tampil "2 TERBUKA" padahal daftar tinggal 1). Panggil
// helper ini di semua jalur mutasi sinyal agar muatan berikutnya segar.
function invalidateAllSignals() {
  S.allSignalsLoaded = false;
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
  // R38: DUA lonceng (sidebar web + strip atas HP) — kedua badge memakai
  // angka unread yang sama; selector #notif-badge saja akan membuat badge
  // HP tertinggal.
  const unread = S.notifs.filter((n) => !n.is_read).length;
  $$('.bellbadge').forEach((badge) => {
    badge.hidden = unread === 0;
    badge.textContent = String(unread);
  });
}
function notifTypeLabel(type) {
  const map = {
    newsig: 'notifTypeNewsig', new_signal: 'notifTypeNewsig',
    tpsl: 'notifTypeTpsl', tp_sl: 'notifTypeTpsl',
    subs: 'notifTypeSubs', sub: 'notifTypeSubs',
    reset: 'notifTypeReset',
    editsig: 'notifTypeEditsig', edited: 'notifTypeEditsig',
    signal_edited: 'notifTypeEditsig',
    signal_cancelled: 'notifTypeCancelled',
    dupflag: 'notifTypeDupflag', dup: 'notifTypeDupflag',
    expiry: 'notifTypeExpiry', expired: 'notifTypeExpiry',
  };
  return t(map[type] || 'notifGeneric');
}
function renderNotifPanel() {
  // D24: teks tunggal + tag jenis + waktu relatif + dot belum dibaca.
  // Template teks notifikasi Fase 5 (server-side) belum ada — panel hanya
  // menampilkan title/message dari database.
  const panel = $('#notif-panel');
  if (!panel) return;
  const unread = S.notifs.filter((n) => !n.is_read).length;
  let html = `<div class="notif-head"><h3>${esc(t('notifTitle'))}</h3>`
    + `<button class="btn ghost" id="notif-mark-all" type="button" style="min-height:34px;padding:6px 12px;font-size:12.5px;">${esc(t('notifMarkAll'))}</button>`
    + `</div>`;
  if (!S.notifs.length) {
    html += `<div class="empty" style="padding:24px 12px;">${t('notifEmpty')}</div>`;
  } else {
    html += S.notifs.map((n) => `<div class="notif-item${n.is_read ? '' : ' unread'}" data-notif="${esc(n.id)}" data-sig="${esc(n.signal_id || '')}" tabindex="0" role="button">`
      + (n.is_read ? '' : '<span class="ndot" aria-hidden="true"></span>')
      + `<div class="nt"><span class="tag">${esc(notifTypeLabel(n.type))}</span>${esc(n.title)}</div>`
      + `<div class="nm">${esc(n.message)}</div>`
      + `<div class="ntime">${esc(fmtRel(n.created_at))}</div></div>`).join('');
  }
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
    const open = async () => {
      // B4-05: klik notifikasi menandainya sebagai dibaca (seperti prototipe).
      const id = el.dataset.notif;
      const item = S.notifs.find((n) => String(n.id) === String(id));
      if (item && !item.is_read) {
        item.is_read = true;
        try { await api.markNotificationRead(id); } catch (e) { /* abaikan */ }
        paintNotifBadge();
      }
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
  const bell = $('#notif-bell');
  const bellHp = $('#notif-bell-hp');
  // B4-09: aria-expanded pada lonceng (prototipe) — kedua lonceng.
  if (bell) bell.setAttribute('aria-expanded', String(open));
  if (bellHp) bellHp.setAttribute('aria-expanded', String(open));
  if (!panel) return;
  panel.hidden = !open;
  if (open) {
    positionNotifPanel();
    renderNotifPanel();
  }
}
// R38: panel notifikasi SATU, position:fixed, anak langsung #app —
// posisinya dihitung dari lonceng yang sedang terlihat (sidebar di web,
// strip atas di HP) supaya panel membuka di bawah lonceng itu, tidak
// terpotong tepi kiri (desktop: membuka ke kanan dari sidebar) dan tidak
// keluar viewport (HP: lebar panel dijepit ke dalam layar).
function positionNotifPanel() {
  const panel = $('#notif-panel');
  if (!panel) return;
  const desk = $('#notif-bell');
  const hp = $('#notif-bell-hp');
  const anchor = (desk && desk.offsetParent !== null) ? desk : hp;
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(window.innerWidth * 0.92, 360);
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (left < 8) left = 8;
  panel.style.left = left + 'px';
  panel.style.top = (r.bottom + 8) + 'px';
  panel.style.right = 'auto';
}

// Laporan trader lokal (D22): backend moderasi belum ada (Fase 5), jadi
// laporan disimpan di perangkat ini saja dan ditampilkan di "Laporan kamu".
function loadReports() {
  try {
    const v = JSON.parse(localStorage.getItem('ole-reports') || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function saveReports() {
  try { localStorage.setItem('ole-reports', JSON.stringify(S.reports)); } catch (e) { /* abaikan */ }
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
    pair: 'errPair', taken: 'errTaken', shared: 'errShared', notclosed: 'errNotclosed',
    distance: 'errDistance',
  };
  if (res.code && map[res.code]) return t(map[res.code]);
  // Ronde 35: kode jeda reset — tampilkan pesan server (tanggal akhir jeda).
  if (res.code === 'resetcooldown' || res.code === 'resettoosoon') return res.message || t('errResetCooldown');
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
  // B4-09: simpan fokus pemicu agar bisa dikembalikan saat overlay ditutup.
  S.lastFocus = document.activeElement;
  sheet.innerHTML = html;
  const ov = $('#overlay');
  ov.classList.remove('closing'); // R21: batalkan animasi tutup bila dibuka lagi cepat.
  ov.classList.add('open');
  // Fokus ke tombol Tutup agar keyboard langsung bisa menutup overlay.
  const closeBtn = sheet.querySelector('#ov-close, #ov-close2, #cf-no, button');
  if (closeBtn) closeBtn.focus();
}
function closeOverlay() {
  const ov = $('#overlay');
  if (!ov.classList.contains('open')) return;
  // R21: animasi tutup (kebalikan animasi buka) — backdrop + kartu memudar
  // dan mengecil 180ms, baru overlay disembunyikan dan isinya dibersihkan.
  ov.classList.add('closing');
  setTimeout(() => {
    if (!ov.classList.contains('closing')) return; // sudah dibuka lagi.
    ov.classList.remove('open', 'closing');
    $('#overlay-sheet').innerHTML = '';
  }, 180);
  // B4-09: kembalikan fokus ke pemicu (prototipe).
  if (S.lastFocus && S.lastFocus.focus) { try { S.lastFocus.focus(); } catch (e) { /* abaikan */ } }
  S.lastFocus = null;
}
$('#overlay').addEventListener('click', (e) => {
  if (e.target.id === 'overlay') closeOverlay();
});
// B4-09: Escape menutup overlay, lalu panel notifikasi (prototipe).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const overlayOpen = $('#overlay') && $('#overlay').classList.contains('open');
  if (overlayOpen) { closeOverlay(); return; }
  if (S.notifOpen) setNotifPanel(false);
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

// Ronde 22: satu jalur keluar dipakai sidebar dan Profil (HP).
// (R25: jalur keluar dari dalam Pengaturan dihapus.)
async function doLogout() {
  const yes = await confirmDialog(t('confirmLogoutTitle'), '', t('yesLogout'));
  if (!yes) return;
  try { await api.signOut(); } catch (e) { /* tetap lanjut */ }
  toast(t('toastSignedOut'));
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
  $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.documentElement.lang = getLang();
  // Pendaftaran ditutup: paksa mode masuk, sembunyikan tombol daftar,
  // dan beri tahu pengunjung bahwa pendaftaran dibuka lagi nanti.
  if (!REGISTRATION_OPEN) S.authMode = 'login';
  $('#auth-submit').textContent = S.authMode === 'login' ? t('login') : t('signup');
  $('#auth-toggle').hidden = !REGISTRATION_OPEN;
  $('#auth-toggle').textContent = S.authMode === 'login' ? t('noAccount') : t('haveAccount');
  if (!REGISTRATION_OPEN) {
    const note = $('#auth-notice');
    note.textContent = t('authSignupClosed');
    note.hidden = false;
  }
  // Auth: petunjuk sandi + konfirmasi hanya saat daftar, bukan saat masuk.
  const signup = S.authMode === 'signup';
  $('#password-hint').hidden = !signup;
  $('#auth-forgot-row').hidden = signup; // Ronde 63: lupa kata sandi hanya di layar masuk.
  $('#auth-confirm-field').hidden = !signup;
  const pw = $('#auth-password');
  pw.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
  if (signup) pw.setAttribute('minlength', '8'); else pw.removeAttribute('minlength');
  if (!signup) { $('#auth-password-confirm').value = ''; setMatchHint(''); }
  // Ronde 63 (amandemen): ganti bahasa jangan menghapus hitungan mundur.
  if (S.authScreen === 'sent') refreshResendLock();
  if (S.authScreen === 'login') refreshLoginLock();
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
// Ronde 63 (amandemen): kunci login mengikuti email yang diketik.
$('#auth-email').addEventListener('input', () => { if (S.authScreen === 'login') refreshLoginLock(); });

// ------------------------------------------------------------------ nav ---
const VIEWS = ['home', 'search', 'trader', 'office-trader', 'office-follower', 'wallet', 'profile', 'helpguide', 'settings'];
function showView(name) {
  S.view = name;
  VIEWS.forEach((v) => $('#view-' + v).classList.toggle('active', v === name));
  $$('.bottom-nav [data-nav]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.nav === name));
  });
  $$('.side-nav [data-nav]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.nav === name));
  });
  window.scrollTo({ top: 0 });
  const mn = document.querySelector('#app main');
  if (mn) mn.scrollTop = 0;
  if (name === 'home') renderHome();
  if (name === 'search') renderSearch();
  if (name === 'trader') renderTraderProfile();
  if (name === 'office-trader') renderTraderWork();
  if (name === 'office-follower') renderFollowerWork();
  if (name === 'wallet') renderWallet();
  if (name === 'profile') { S.profileSub = null; renderProfile(); }
  if (name === 'helpguide') renderHelpGuide();
  if (name === 'settings') renderSettings();
}
$$('.bottom-nav [data-nav]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.nav));
});
// Ronde 15 (#3): sidebar web memakai showView yang sama.
$$('.side-nav [data-nav]').forEach((b) => {
  b.addEventListener('click', () => showView(b.dataset.nav));
});
$$('#search-tabs [data-stab]').forEach((b) => {
  b.addEventListener('click', () => {
    S.searchTab = b.dataset.stab;
    renderSearch();
  });
});
$('#btn-helpguide-back').addEventListener('click', () => {
  // R30: di halaman detail Panduan, tombol kembali mengarah ke daftar
  // Panduan dulu; di daftar, kembali ke Profil.
  if (S.view === 'helpguide' && S.helpGuideTab === 'guide' && S.guideSub) {
    S.guideSub = null;
    renderHelpGuide();
    return;
  }
  showView('profile');
});
// R38: DUA lonceng (sidebar web + strip atas HP) — keduanya membuka
// panel yang sama; badge juga ada dua dan mengikat kliknya sendiri.
// R37b (D-R37b-1b): badge di luar tombol (anak .notif-wrap) — ketukan di
// badge TIDAK tembus ke tombol (tengah badge di luar lingkaran tombol
// r=18px), jadi badge mengikat kliknya sendiri.
$$('#notif-bell, #notif-bell-hp').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    setNotifPanel(!S.notifOpen);
  });
});
$$('#notif-badge, #notif-badge-hp').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    setNotifPanel(!S.notifOpen);
  });
});
$('#side-logout').addEventListener('click', () => doLogout());
// Ronde 22: ripple saat ditekan (preview) — satu span .ripple yang
// mengembang dari titik tekan, lalu dihapus; tanpa setPointerCapture.
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.btn:not(:disabled), .fchip, .chip, .tab, .subtab, .seg button, .menurow, .side-nav button, .bottom-nav button, .iconbtn, .bellbtn, .avatar-btn');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const s = document.createElement('span');
  s.className = 'ripple';
  s.style.width = s.style.height = d + 'px';
  s.style.left = (e.clientX - r.left - d / 2) + 'px';
  s.style.top = (e.clientY - r.top - d / 2) + 'px';
  el.appendChild(s);
  setTimeout(() => s.remove(), 480);
});
document.addEventListener('click', (e) => {
  // R38: panel tidak lagi di dalam .notif-wrap (anak langsung #app),
  // jadi klik di dalam panel juga harus diizinkan agar tidak menutupnya.
  if (S.notifOpen && !e.target.closest('.notif-wrap, .notif-panel')) setNotifPanel(false);
  const guideBtn = e.target.closest('[data-guide]');
  if (guideBtn) { openGuideSection(guideBtn.dataset.guide); }
});
// R37: tab kembali terlihat setelah lama disembunyikan — segarkan harga
// bila fetch terakhir sudah lebih dari satu interval (GoTrue juga
// memancarkan SIGNED_IN ulang di sini, tapi refresh ini deterministik dan
// tidak bergantung pada perilaku itu). Timer interval sendiri tidak
// menumpuk saat tab disembunyikan (browser membatasi interval latar).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user && Date.now() - __lastPriceFetchAt > PRICE_POLL_MS) refreshPrices();
});

// ----------------------------------------------------------------- auth ---
function hideSplash() {
  const sp = $('#boot-splash');
  if (sp) sp.hidden = true;
}
function showAuth() {
  hideSplash();
  $('#app').hidden = true;
  $('#auth-view').hidden = false;
  applyI18n();
  showAuthScreen('login'); // Ronde 63: keluar / gagal boot selalu kembali ke layar masuk.
}
function showApp() {
  hideSplash();
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
  // Pendaftaran ditutup: tolak submit daftar walau mode diubah manual.
  if (S.authMode === 'signup' && !REGISTRATION_OPEN) {
    const noteBox = $('#auth-notice');
    noteBox.textContent = t('authSignupClosed');
    noteBox.hidden = false;
    return;
  }
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const errBox = $('#auth-error');
  const noteBox = $('#auth-notice');
  errBox.hidden = true;
  noteBox.hidden = true;
  // Ronde 63 (amandemen): kunci login yang masih berjalan tidak bisa
  // dilewati lewat Enter (tombol nonaktif saja tidak cukup).
  if (S.authMode === 'login') {
    const st = readBackoff('login', email);
    if (Date.now() < st.nextAllowedAt) { refreshLoginLock(); return; }
  }
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
    // Ronde 63 (amandemen): hanya gagal KREDENSIAL yang dihitung; galat
    // jaringan tidak dihitung. Login berhasil me-reset (di handleSession).
    if (S.authMode === 'login' && /invalid login credentials/i.test(String(err?.message || ''))) {
      const st = readBackoff('login', email);
      const attempts = st.attempts + 1;
      writeBackoff('login', email, { attempts, nextAllowedAt: Date.now() + lockSeconds(LOGIN_LADDER, attempts) * 1000, lastAt: Date.now() });
    }
  } finally {
    btn.disabled = false;
    btn.textContent = btnLabel;
  }
  // Ronde 63 (amandemen): kunci (bila ada) diterapkan SETELAH finally
  // mengembalikan tombol.
  if (S.authMode === 'login') refreshLoginLock();
});

// --------------------------- backoff bertingkat (Ronde 63 amandemen) -----
// Penahan spam/brute-force sisi klien untuk tombol kirim ulang dan login
// gagal. BUKAN pengganti rate limit server: Supabase tetap penegak
// akhirnya. Kunci di localStorage per email, bertahan saat reload;
// hitungan direset setelah 1 jam tanpa percobaan.
const RESEND_LADDER = [60, 120, 300, 600]; // detik; kirim ulang, cap 600
const LOGIN_LADDER = [5, 15, 30, 60, 120, 300]; // detik; login gagal, cap 300
const BACKOFF_IDLE_MS = 3600000; // 1 jam
function backoffKey(prefix, email) {
  return 'ole-' + prefix + '-backoff:' + String(email || '').trim().toLowerCase();
}
function readBackoff(prefix, email) {
  try {
    const raw = localStorage.getItem(backoffKey(prefix, email));
    if (!raw) return { attempts: 0, nextAllowedAt: 0, lastAt: 0 };
    const st = JSON.parse(raw);
    if (!st || typeof st.attempts !== 'number' || typeof st.nextAllowedAt !== 'number') return { attempts: 0, nextAllowedAt: 0, lastAt: 0 };
    if (Date.now() - (st.lastAt || 0) > BACKOFF_IDLE_MS) return { attempts: 0, nextAllowedAt: 0, lastAt: 0 };
    return st;
  } catch (e) { return { attempts: 0, nextAllowedAt: 0, lastAt: 0 }; }
}
function writeBackoff(prefix, email, st) {
  try { localStorage.setItem(backoffKey(prefix, email), JSON.stringify(st)); } catch (e) { /* abaikan */ }
}
function clearBackoff(prefix, email) {
  try { localStorage.removeItem(backoffKey(prefix, email)); } catch (e) { /* abaikan */ }
}
function lockSeconds(ladder, attempts) {
  return ladder[Math.min(Math.max(attempts - 1, 0), ladder.length - 1)];
}
function fmtBackoff(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function recordResend(email) {
  const st = readBackoff('reset', email);
  const attempts = st.attempts + 1;
  writeBackoff('reset', email, { attempts, nextAllowedAt: Date.now() + lockSeconds(RESEND_LADDER, attempts) * 1000, lastAt: Date.now() });
}
let resendTimer = null;
let loginTimer = null;
function stopTimer(which) {
  if (which === 'resend' && resendTimer) { clearInterval(resendTimer); resendTimer = null; }
  if (which === 'login' && loginTimer) { clearInterval(loginTimer); loginTimer = null; }
}
function refreshResendLock() {
  const btn = $('#sent-resend'); if (!btn) return;
  stopTimer('resend');
  const st = readBackoff('reset', S.resetEmail);
  const remain = Math.ceil((st.nextAllowedAt - Date.now()) / 1000);
  if (remain > 0) {
    btn.disabled = true;
    btn.textContent = t('resendIn', { time: fmtBackoff(remain) });
    resendTimer = setInterval(() => {
      const left = Math.ceil((readBackoff('reset', S.resetEmail).nextAllowedAt - Date.now()) / 1000);
      if (left <= 0) { stopTimer('resend'); btn.disabled = false; btn.textContent = t('resend'); }
      else btn.textContent = t('resendIn', { time: fmtBackoff(left) });
    }, 1000);
  } else {
    btn.disabled = false;
    btn.textContent = t('resend');
  }
}
function refreshLoginLock() {
  const btn = $('#auth-submit'); if (!btn) return;
  stopTimer('login');
  const email = $('#auth-email').value.trim();
  const st = readBackoff('login', email);
  const remain = Math.ceil((st.nextAllowedAt - Date.now()) / 1000);
  if (remain > 0) {
    btn.disabled = true;
    btn.textContent = t('loginRetryIn', { time: fmtBackoff(remain) });
    loginTimer = setInterval(() => {
      const left = Math.ceil((readBackoff('login', $('#auth-email').value.trim()).nextAllowedAt - Date.now()) / 1000);
      if (left <= 0) { stopTimer('login'); btn.disabled = false; btn.textContent = t('login'); }
      else btn.textContent = t('loginRetryIn', { time: fmtBackoff(left) });
    }, 1000);
  } else {
    btn.disabled = false;
    btn.textContent = t('login');
  }
}

// Meter kekuatan kata sandi (amandemen pratinjau): aturan SAMA dengan
// passwordValid (min 8 + angka + huruf kapital); panjang >= 12 hanya
// bonus skor, tidak pernah menggagalkan submit.
function refreshPwMeter() {
  const pw = $('#reset-password').value || '';
  const lenOk = pw.length >= 8;
  const numOk = /[0-9]/.test(pw);
  const upOk = /[A-Z]/.test(pw);
  const score = (lenOk ? 1 : 0) + (numOk ? 1 : 0) + (upOk ? 1 : 0) + (pw.length >= 12 ? 1 : 0);
  const fill = $('#reset-meter-fill');
  if (fill) {
    fill.style.width = (score * 25) + '%';
    fill.className = 'pw-meter-fill' + (score <= 1 ? ' weak' : score === 2 ? ' mid' : ' strong');
  }
  document.querySelectorAll('#reset-rules li').forEach((li) => {
    const rule = li.dataset.rule;
    li.classList.toggle('ok', rule === 'len' ? lenOk : rule === 'num' ? numOk : upOk);
  });
}

// ------------------------------------------------------- lupa kata sandi ---
// Ronde 63: layar-layar auth (login / lupa kata sandi / atur ulang /
// berhasil). Satu tempat kebenaran, hanya satu layar yang tampil.
function showAuthScreen(name) {
  S.authScreen = name;
  const errBox = $('#auth-error');
  const noteBox = $('#auth-notice');
  errBox.hidden = true;
  noteBox.hidden = true;
  $('#auth-form').hidden = name !== 'login';
  $('#forgot-form').hidden = name !== 'forgot';
  $('#sent-screen').hidden = name !== 'sent';
  $('#reset-form').hidden = name !== 'reset';
  $('#reset-done').hidden = name !== 'resetDone';
  $('#auth-toggle-row').hidden = name !== 'login';
  if (name !== 'sent') stopTimer('resend');
  if (name !== 'login') stopTimer('login');
  // Layar masuk tetap memberi tahu pendaftaran belum dibuka, seperti
  // sebelum ronde ini (applyI18n menampilkannya, lalu dibersihkan di atas).
  if (name === 'login' && !REGISTRATION_OPEN) {
    noteBox.textContent = t('authSignupClosed');
    noteBox.hidden = false;
    refreshLoginLock();
  }
  if (name === 'sent') {
    $('#sent-email').textContent = S.resetEmail || '';
    refreshResendLock();
  }
  if (name === 'reset') {
    // Tanpa sesi recovery, form tidak bisa menyimpan apa-apa: nonaktifkan
    // + jelaskan linknya tidak valid (bukan form yang rusak).
    const ok = !!S.session;
    $('#reset-password').disabled = !ok;
    $('#reset-confirm').disabled = !ok;
    $('#reset-submit').disabled = !ok;
    if (!ok) { errBox.textContent = t('resetLinkInvalid'); errBox.hidden = false; }
    refreshResetHint();
    refreshPwMeter();
  }
}

// Link reset email memakai hash #access_token=...&type=recovery (implicit
// flow) atau query ?code=... (PKCE). Periksa hash langsung, karena event
// PASSWORD_RECOVERY bisa terpancar sebelum listener terdaftar.
function isRecoveryHash(hash) {
  const h = String(hash === undefined ? window.location.hash : hash || '');
  return /(?:^|[&#?])type=recovery(?:&|$)/.test(h);
}

// Ronde 64: baca parameter recovery dari URL SENDIRI, sebelum penanganan
// sesi apa pun. Dengan detectSessionInUrl:false, GoTrue tidak lagi
// mengonsumsi hash (dulu: hash dibersihkan saat init klien, sebelum app.js
// sempat membaca isRecoveryHash, link reset malah masuk ke aplikasi).
// Bentuk yang dikenali: hash implicit (#access_token=...&refresh_token=...
// &type=recovery) dan query PKCE (?code=...). Hash recovery tanpa token
// tetap dianggap recovery yang tidak valid (bukan masuk biasa).
function readRecoveryParams() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (hashParams.get('type') === 'recovery') {
    const access_token = hashParams.get('access_token');
    const refresh_token = hashParams.get('refresh_token');
    if (access_token && refresh_token) return { kind: 'hash', access_token, refresh_token };
    return { kind: 'invalid' };
  }
  const query = new URLSearchParams(window.location.search);
  const code = query.get('code');
  if (code) return { kind: 'pkce', code };
  return null;
}

// Ronde 66: daftar id sesi recovery yang tidak boleh masuk aplikasi.
// Sesi recovery dibuat tab reset (setSession) lalu tersimpan di
// localStorage yang dibagi semua tab origin yang sama; tanpa daftar ini,
// tab lain tanpa hash menemukannya lewat getSession / storage event lalu
// masuk aplikasi (bug yang dilaporkan user: tab yang tidak login jadi
// login sendiri). Id diambil dari klaim session_id di payload JWT
// access_token (stabil saat refresh; token mentah berputar). Tanpa TTL:
// sesi recovery tidak boleh masuk aplikasi selamanya; entri yatim (tab
// ditutup di tengah reset) tidak berbahaya.
const RECOVERY_SESSIONS_KEY = 'ole_recovery_sessions';
const RECOVERY_SESSIONS_MAX = 10;
function decodeJwtPayload(token) {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2 || !parts[1]) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch (e) {
    console.error('jwt payload', e);
    return null;
  }
}
function recoverySessionId(session) {
  const json = decodeJwtPayload(session?.access_token);
  if (!json) return null;
  return typeof json?.session_id === 'string' && json.session_id ? json.session_id : null;
}
// Ronde 66 (item 9): pertahanan lapis kedua, menangkap sesi recovery
// yang tidak tertandai di daftar blokir (mis. sesi yang sudah bocor
// sebelum ronde ini). Login normal di aplikasi ini HANYA email+password
// (tidak ada OTP/magic-link/OAuth), jadi sesi yang amr-nya ada dan
// ter-parse tetapi tanpa method password pasti berasal dari link
// recovery (token recovery diverifikasi GoTrue sebagai OTP). Nilai
// amr=otp untuk sesi recovery asli adalah HIPOTESIS, belum terbukti
// live; verifikasi saat user klik link asli lagi setelah deploy.
// Fail-open: amr tidak ada / tidak ter-parse / decode gagal -> jangan
// blokir lewat amr (daftar blokir tetap jalan sebagai mekanisme utama).
// Kembali true bila amr berisi password, false bila amr ada tetapi tanpa
// password (blokir), null bila tidak dapat diputuskan (jangan blokir).
function recoveryAmrHasPassword(session) {
  const json = decodeJwtPayload(session?.access_token);
  if (!json) return null;
  const amr = json?.amr;
  if (!Array.isArray(amr)) return null;
  return amr.some((e) => e && e.method === 'password');
}
function readRecoverySessions() {
  try {
    const v = JSON.parse(localStorage.getItem(RECOVERY_SESSIONS_KEY) || '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string') : [];
  } catch (e) { return []; }
}
function markRecoverySession(session) {
  const id = recoverySessionId(session);
  if (!id) return;
  const list = readRecoverySessions().filter((e) => e.id !== id);
  list.unshift({ id, at: Date.now() });
  try { localStorage.setItem(RECOVERY_SESSIONS_KEY, JSON.stringify(list.slice(0, RECOVERY_SESSIONS_MAX))); } catch (e) { /* abaikan */ }
}
function unmarkRecoverySession(session) {
  const id = recoverySessionId(session);
  if (!id) return;
  const list = readRecoverySessions().filter((e) => e.id !== id);
  try { localStorage.setItem(RECOVERY_SESSIONS_KEY, JSON.stringify(list)); } catch (e) { /* abaikan */ }
}
function isRecoverySession(session) {
  const id = recoverySessionId(session);
  if (!id) return false;
  return readRecoverySessions().some((e) => e.id === id);
}

// Ronde 66 (item 7): bersihkan sesi recovery saat alur reset
// ditinggalkan (tab ditutup / reload / navigasi pergi). Daftar blokir
// saja tidak cukup: sesi yang ditinggalkan tetap hidup di localStorage
// dan bisa dipakai tab lain. Pembersihan di sini sinkron (localStorage
// saja, tanpa network), karena pagehide belum tentu memberi waktu
// signOut async selesai.
function goTrueStorageKey() {
  try {
    const host = new URL(SUPABASE_URL).hostname;
    const ref = host.split('.')[0];
    return ref ? 'sb-' + ref + '-auth-token' : null;
  } catch (e) { return null; }
}
function storedRecoverySessionId() {
  try {
    const key = goTrueStorageKey();
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return recoverySessionId(JSON.parse(raw));
  } catch (e) { return null; }
}
function onRecoveryPagehide(e) {
  // bfcache: halaman mungkin dipulihkan dengan sesi in-memory yang
  // masih dipakai; jangan bersihkan, daftar blokir tetap mencegahnya
  // masuk aplikasi.
  if (e && e.persisted) return;
  if (S.authScreen !== 'reset' && S.authScreen !== 'resetDone') return;
  const session = S.session;
  if (!session) return;
  const id = recoverySessionId(session);
  if (!id || !isRecoverySession(session)) return;
  // Hanya hapus kunci storage bila isinya memang sesi recovery ini.
  // Tab lain mungkin sudah login normal dan menimpa kunci itu dengan
  // sesi baru (id beda); sesi itu tidak boleh ikut terhapus.
  let removed = false;
  try {
    if (storedRecoverySessionId() === id) {
      localStorage.removeItem(goTrueStorageKey());
      removed = true;
    }
  } catch (err) { /* abaikan */ }
  if (removed) unmarkRecoverySession(session);
}
function armRecoveryPagehide() {
  window.removeEventListener('pagehide', onRecoveryPagehide);
  window.addEventListener('pagehide', onRecoveryPagehide);
}
function disarmRecoveryPagehide() {
  window.removeEventListener('pagehide', onRecoveryPagehide);
}

function resetErrorMessage(err) {
  const m = String(err?.message || '');
  if (/session missing|no session|invalid.*(token|jwt)|expired|jwt expired/i.test(m)) return t('resetLinkInvalid');
  if (/password.*(6|short|weak)|weak/i.test(m)) return t('authErrWeak');
  if (/failed to fetch|network/i.test(m)) return t('errNetwork');
  return t('authErrGeneric');
}

function setResetHint(state) {
  const el = $('#reset-match-hint');
  el.classList.remove('ok', 'bad');
  if (state === 'match') { el.textContent = t('passwordMatch'); el.classList.add('ok'); }
  else if (state === 'mismatch') { el.textContent = t('passwordMismatch'); el.classList.add('bad'); }
  else { el.textContent = ''; }
}
function refreshResetHint() {
  const pw = $('#reset-password').value;
  const cf = $('#reset-confirm').value;
  if (!cf) { setResetHint(''); return; }
  setResetHint(pw === cf ? 'match' : 'mismatch');
}
$('#reset-password').addEventListener('input', refreshResetHint);
$('#reset-confirm').addEventListener('input', refreshResetHint);
// Ronde 63 (amandemen): meter kekuatan mengikuti aturan passwordValid.
$('#reset-password').addEventListener('input', refreshPwMeter);

// Masuk ke layar atur ulang dari link email. Sesi recovery dibuat boot
// secara eksplisit (setSession / exchangeCodeForSession), bukan oleh klien.
// Parameter recovery dibersihkan dari URL supaya reload tidak memproses
// ulang link yang sama dan token tidak tertinggal di address bar/riwayat;
// ?code= dibuang beserta seluruh query (link reset tidak membawa query lain
// yang bermakna bagi aplikasi).
function enterRecovery(session, opts = {}) {
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    if (opts.dropQuery) url.search = '';
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch (e) { /* abaikan */ }
  S.session = session || null;
  S.user = session?.user || null;
  showAuth();
  showAuthScreen('reset');
  // Ronde 66: persenjatai pembersihan bila tab reset ditinggalkan
  // (ditutup / reload / navigasi pergi) sebelum reset selesai.
  armRecoveryPagehide();
}

// Kembali ke layar masuk dari layar reset/berhasil: hapus dulu sesi
// recovery yang tersimpan, supaya sesi itu tidak langsung memasukkan
// pengguna saat boot berikutnya.
async function exitRecoveryToLogin() {
  // Ronde 66: simpan dulu sesi recovery saat ini. signOut memancarkan
  // SIGNED_OUT dan handleSession men-null-kan S.session sebelum baris
  // unmark tercapai; bila unmark memakai S.session sesudah signOut, id
  // sesi tidak pernah terhapus dari daftar blokir (terbukti harness).
  const session = S.session;
  let signedOut = false;
  try { await api.signOut(); signedOut = true; } catch (e) { /* tetap lanjut ke login */ }
  // Ronde 66: hapus id sesi recovery dari daftar blokir, tapi hanya bila
  // signOut berhasil. Bila signOut gagal, sesi mungkin masih hidup di
  // localStorage; daftar tetap memblokirnya supaya tab lain tidak ikut
  // masuk aplikasi.
  if (signedOut) unmarkRecoverySession(session);
  // Ronde 66: keluar dari alur reset dengan benar (signOut sudah jalan),
  // jadi handler pagehide tidak perlu lagi.
  disarmRecoveryPagehide();
  S.session = null;
  S.user = null;
  showAuthScreen('login');
}

$('#auth-forgot').addEventListener('click', () => { showAuthScreen('forgot'); });
$('#forgot-back').addEventListener('click', () => { showAuthScreen('login'); });
$('#sent-back').addEventListener('click', () => { showAuthScreen('login'); });
$('#sent-resend').addEventListener('click', async () => {
  // Ronde 63 (amandemen): kirim ulang bertingkat. Sukses maupun galat
  // generik (anti-enumerasi) menaikkan kunci berikutnya; galat jaringan
  // tidak dihitung.
  const email = S.resetEmail;
  if (!email) { showAuthScreen('login'); return; }
  const st = readBackoff('reset', email);
  if (Date.now() < st.nextAllowedAt) { refreshResendLock(); return; } // pengaman ganda
  const btn = $('#sent-resend');
  btn.disabled = true;
  try {
    await api.requestPasswordReset(email);
    recordResend(email);
    toast(t('resendToast'));
    refreshResendLock();
  } catch (err) {
    const m = String(err?.message || '');
    if (/failed to fetch|network/i.test(m)) {
      const errBox = $('#auth-error');
      errBox.textContent = t('errNetwork');
      errBox.hidden = false;
      refreshResendLock();
    } else {
      recordResend(email);
      toast(t('resendToast'));
      refreshResendLock();
    }
  }
});
$('#reset-back').addEventListener('click', () => { exitRecoveryToLogin(); });
$('#reset-done-back').addEventListener('click', () => { exitRecoveryToLogin(); });

$('#forgot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#forgot-email').value.trim();
  const errBox = $('#auth-error');
  const noteBox = $('#auth-notice');
  errBox.hidden = true;
  noteBox.hidden = true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errBox.textContent = t('authErrEmail');
    errBox.hidden = false;
    return;
  }
  // Ronde 63 (amandemen): bila link untuk email ini baru saja dikirim dan
  // kuncinya masih berjalan, tampilkan layar sent dengan hitungan mundur
  // tanpa mengirim ulang (menutup celah reload-lalu-kirim-ulang).
  if (Date.now() < readBackoff('reset', email).nextAllowedAt) {
    S.resetEmail = email;
    showAuthScreen('sent');
    return;
  }
  const btn = $('#forgot-submit');
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('loading') + '…';
  try {
    await api.requestPasswordReset(email);
    recordResend(email); // percobaan #1, kunci 60 detik
    S.resetEmail = email;
    showAuthScreen('sent');
  } catch (err) {
    // Anti-enumerasi: galat apa pun (termasuk email tidak terdaftar)
    // menampilkan pesan yang sama, kecuali jaringan mati, yang harus jujur.
    const m = String(err?.message || '');
    if (/failed to fetch|network/i.test(m)) {
      errBox.textContent = t('errNetwork');
      errBox.hidden = false;
    } else {
      recordResend(email);
      S.resetEmail = email;
      showAuthScreen('sent');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = btnLabel;
  }
});

$('#reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = $('#auth-error');
  const noteBox = $('#auth-notice');
  errBox.hidden = true;
  noteBox.hidden = true;
  const pw = $('#reset-password').value;
  if (!passwordValid(pw)) { errBox.textContent = t('authErrWeak'); errBox.hidden = false; return; }
  if (pw !== $('#reset-confirm').value) { errBox.textContent = t('passwordMismatch'); errBox.hidden = false; return; }
  if (!S.session) { errBox.textContent = t('resetLinkInvalid'); errBox.hidden = false; return; }
  const btn = $('#reset-submit');
  const btnLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('loading') + '…';
  try {
    await api.updatePassword(pw);
    showAuthScreen('resetDone');
  } catch (err) {
    errBox.textContent = resetErrorMessage(err);
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = btnLabel;
  }
});

async function handleSession(session, event = 'INITIAL_SESSION') {
  // Ronde 63: hash recovery di URL berarti pengguna sedang mereset, bukan
  // masuk biasa. Jangan jalankan jalur normal (showApp) walau sesi ada;
  // serahkan ke layar atur ulang. Ini menutup balapan antara event
  // INITIAL_SESSION klien dan getSession manual di init.
  // Ronde 67: boot masih menukar token recovery jadi sesi (flag true)
  // dan event ini membawa session null (INITIAL_SESSION dari profil
  // bersih). JANGAN panggil enterRecovery(null): itu merender layar
  // reset tidak valid sesaat sebelum setSession selesai. Tunggu saja:
  // boot memanggil enterRecovery(session) begitu penukaran selesai.
  if (isRecoveryHash()) {
    if (!session && S.recoveryExchangePending) return;
    enterRecovery(session);
    return;
  }
  // Ronde 63: sedang di layar atur ulang / berhasil, event sesi (mis.
  // TOKEN_REFRESHED pada sesi recovery) tidak boleh memindahkan pengguna
  // ke aplikasi sebelum reset selesai. Sesi null dari klien (mis. event
  // INITIAL_SESSION yang datang terlambat) DIABAIKAN, jangan timpa sesi
  // recovery yang sudah ada; bila sesi justru datang terlambat saat form
  // masih nonaktif, aktifkan form. Submit tetap fail-closed bila sesi
  // memang tidak ada (resetLinkInvalid).
  if (S.authScreen === 'reset' || S.authScreen === 'resetDone') {
    if (session) {
      const wasDisabled = S.authScreen === 'reset' && !S.session;
      S.session = session;
      S.user = session.user || null;
      if (wasDisabled) showAuthScreen('reset');
    }
    return;
  }
  // Ronde 66: sesi recovery tidak boleh masuk aplikasi di tab lain.
  // Sesi itu dibuat tab reset dan tersimpan di localStorage yang dibagi
  // semua tab; tab tanpa hash yang menemukannya lewat getSession /
  // storage event harus tetap di layar masuk. Syarat !S.session
  // melindungi login normal (id sesi beda, tidak ada di daftar) dan tab
  // yang sudah di aplikasi (sesi normal, tidak ditendang keluar).
  // Cabang ini SENGAJA tidak assign S.session, supaya event berikutnya
  // tetap terblokir. Gagal decode JWT -> fail-open (isRecoverySession
  // false, jalur normal tetap jalan).
  // Lapis kedua (item 9): cek amr. Sesi yang amr-nya ada tetapi tanpa
  // method password (recoveryAmrHasPassword false) juga diblokir, untuk
  // menangkap sesi recovery yang tidak tertandai di daftar blokir
  // (mis. yang sudah bocor sebelum ronde ini). amr=otp untuk sesi
  // recovery asli adalah hipotesis, belum terbukti live.
  if (session && !S.session && (isRecoverySession(session) || recoveryAmrHasPassword(session) === false)) {
    showAuth();
    return;
  }
  // R9-1: putuskan navigasi DI AWAL (sebelum await) + hanya untuk login yang
  // benar-benar baru. Supabase (GoTrue) memancarkan SIGNED_IN ulang setiap
  // kali tab kembali aktif (listener visibilitychange internal →
  // _recoverAndRefresh → notify SIGNED_IN bila sesi masih valid), dan
  // INITIAL_SESSION bisa datang dua kali saat boot (listener onAuthChange +
  // getSession manual). Tanpa guard, setiap event itu memaksa showView('home')
  // dan menimpa navigasi pengguna — inilah "lompat ke Beranda" yang tersisa
  // setelah C-01 (ronde 8 hanya menggerbang TOKEN_REFRESHED/USER_UPDATED).
  const prevUserId = S.user?.id || null;
  const newUserId = session?.user?.id || null;
  const isFreshLogin = Boolean(newUserId) && (newUserId !== prevUserId || __oleHomeNavDoneFor !== newUserId);
  S.session = session;
  S.user = session?.user || null;
  // Ronde 63 (amandemen): masuk berhasil me-reset hitungan gagal login.
  if (S.user?.email) clearBackoff('login', S.user.email);
  if (!S.user) {
    __oleHomeNavDoneFor = null;
    stopPricePolling(); // R37: jangan ambil harga lagi setelah keluar.
    showAuth();
    return;
  }
  if (isFreshLogin) __oleHomeNavDoneFor = newUserId;
  await refreshIdentity();
  try { S.traders = await api.listTraders(); } catch (e) { S.traders = []; }
  try { S.mySubs = await api.listMySubscriptions(S.user.id); } catch (e) { S.mySubs = []; }
  try {
    // R26: kegagalan hitungan BUKAN 0. `.catch(() => 0)` lama menelan error
    // lalu meng-cache "0 Pengikut" palsu (terbukti probe r26: sekali gagal,
    // kartu menampilkan "0 Pengikut" sampai siklus follow). Nilai lama yang
    // baik dipertahankan; kunci yang gagal tetap tidak ada sehingga kartu
    // menampilkan "—" (jujur: belum diketahui, bukan 0).
    const counts = await Promise.all(S.traders.map((tr) => api.countFollowers(tr.profile_id).catch(() => null)));
    S.traders.forEach((tr, i) => { if (counts[i] !== null && counts[i] !== undefined) S.followerCounts[tr.profile_id] = counts[i]; });
    paintAllFollowerCounts();
  } catch (e) { /* abaikan — nilai lama dipertahankan */ }
  // R37: harga dimuat di sini (boot / SIGNED_IN ulang) lalu di-poll tiap
  // 1 menit (startPricePolling), sebelumnya hanya sekali saat boot. Gagal
  // ambil = nilai lama dipertahankan (bukan Map kosong); applyPrices
  // menyimpan fetch sebelumnya sebagai pembanding panah ticker.
  try { applyPrices(await api.getPrices()); } catch (e) { /* nilai lama dipertahankan */ }
  startPricePolling();
  try { S.demoIds = new Set(await api.listDemoTraderIds()); } catch (e) { S.demoIds = new Set(); }
  await loadNotifications();
  // B2-01 + B2-05: muat salinan + ikutan dari DB agar "Sudah disalin" dan
  // "Diikuti" di kartu sinyal bertahan setelah reload.
  try {
    S.myCopies = await api.listMyCopies(S.user.id);
    S.copiedIds = new Set(S.myCopies.map((c) => c.signal_id));
  } catch (e) { /* salinan dimuat ulang saat membuka menu Follower */ }
  try {
    S.myFollows = await api.listMyFollows(S.user.id);
  } catch (e) { /* ikutan dimuat ulang saat membuka Cari / Trader */ }
  // Ronde 64: periksa ulang SETELAH semua await. Pengguna bisa masuk ke
  // layar reset di tengah boot (event PASSWORD_RECOVERY saat refreshIdentity
  // / listTraders menunggu jaringan). Tanpa pemeriksaan ini, showApp() di
  // akhir akan menimpa layar reset (inilah yang terjadi pada link asli:
  // event sempat memanggil enterRecovery, lalu ekor handleSession tetap
  // memanggil showApp()).
  if (S.authScreen === 'reset' || S.authScreen === 'resetDone') return;
  showApp();
  // C-01 + R9-1: hanya pindah ke Beranda saat pertama kali masuk / sesi awal
  // untuk user ini. SIGNED_IN ulang (tab kembali aktif, refresh lintas-tab)
  // dan INITIAL_SESSION kedua hanya memuat ulang data — jangan sentuh
  // tampilan yang sedang dibuka pengguna.
  if (isFreshLogin && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
    showView('home');
    // B-01/B4-02: tautan bagikan profil (#trader/<id>) dibuka setelah masuk.
    openTraderFromHash();
  }
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
// ------------------------------------------------------- harga live (R37) ---
// D-R37-1: harga HANYA dimuat sekali saat boot (handleSession) — "Harga
// sekarang" + floating di kartu sinyal beku selama halaman terbuka. Perbaikan:
// polling tiap 1 menit (emas berubah tiap 1 menit via cron fetch-gold
// Ronde 65; forex tetap tiap 15 menit via cron Fase 3; 1 menit menangkap
// tiap update emas tanpa membanjiri) + repaint murah
// dari cache. Satu timer saja (guard __priceTimer), dihentikan saat keluar.
const PRICE_POLL_MS = 1 * 60 * 1000;
let __priceTimer = null;
let __priceRefreshing = false;
let __lastPriceFetchAt = 0;
function paintTicker() {
  const box = $('#ticker');
  const track = $('#ticker-track');
  if (!box || !track) return;
  // Hanya pair yang punya harga live — tidak pernah diisi angka karangan.
  const pairs = PAIRS.filter((p) => priceOf(p) !== null);
  if (pairs.length === 0) { box.hidden = true; track.innerHTML = ''; return; }
  box.hidden = false;
  const half = pairs.map((p) => {
    const now = priceOf(p);
    const prev = S.prevPrices.get(p);
    const dir = (typeof prev === 'number' && prev > 0)
      ? (now > prev ? 'up' : (now < prev ? 'down' : 'same')) : 'none';
    const arrow = dir === 'up' ? '<span class="tk-arrow up" aria-hidden="true">▲</span>'
      : dir === 'down' ? '<span class="tk-arrow down" aria-hidden="true">▼</span>' : '';
    return `<span class="tk-item" data-pair="${esc(p)}"><b class="tk-pair">${esc(p)}</b><span class="tk-price mono">${fmtNum(now, decimalsForPair(p))}</span>${arrow}</span>`;
  }).join('');
  // Track digandakan (paruh kedua aria-hidden): animasi translateX(-50%)
  // berputar mulus tanpa lompat. Mengganti isi track TIDAK me-restart
  // animasi CSS pada track itu sendiri, jadi marquee tidak meloncat tiap poll.
  track.innerHTML = `<span class="tk-half">${half}</span><span class="tk-half" aria-hidden="true">${half}</span>`;
}
function applyPrices(next) {
  if (!(next instanceof Map)) return false;
  // R37b (D-R37-10): prevPrices STICKY per pair — pembanding hanya maju
  // bila harga pair itu BENAR-BENAR berubah. Bila sama, prev dipertahankan
  // supaya panah arah gerakan terakhir TIDAK hilang di poll berikutnya
  // (sebelumnya S.prevPrices = S.prices menimpa di setiap poll, jadi panah
  // hanya hidup ≤5 menit lalu lenyap). Boot tetap tanpa panah: harga baru
  // yang belum pernah ada di S.prices tidak mengisi prev (cur bukan number).
  for (const [p, v] of next) {
    const cur = S.prices.get(p);
    if (typeof cur === 'number' && cur > 0 && v !== cur) S.prevPrices.set(p, cur);
  }
  S.prices = next;
  __lastPriceFetchAt = Date.now();
  paintTicker();
  return true;
}
async function refreshPrices() {
  if (!S.user || __priceRefreshing) return;
  __priceRefreshing = true;
  try {
    const next = await api.getPrices();
    if (applyPrices(next)) repaintVisibleSignalLists();
  } catch (e) { /* gagal: nilai lama dipertahankan, bukan 0 (pola R26) */ }
  finally { __priceRefreshing = false; }
}
function repaintVisibleSignalLists() {
  // Repaint murah dari cache — JANGAN renderHome() (refetch sinyal tiap
  // 1 menit + reset daftar) dan JANGAN renderOffice (refetch sinyal +
  // form edit tab Trader bisa terhapus); kartu office diperbarui saat
  // navigasi (showView) seperti sebelumnya.
  if (S.view === 'home') { renderHomeList(); return; }
  if (S.view === 'trader' && S.traderProfileId) { renderTraderProfileBody(S.traderProfileId); }
}
function startPricePolling() {
  // Idempotent: handleSession bisa jalan berulang (GoTrue memancarkan
  // SIGNED_IN ulang saat tab kembali aktif) — timer kedua tidak dibuat.
  if (__priceTimer !== null) return;
  __priceTimer = setInterval(() => { refreshPrices(); }, PRICE_POLL_MS);
}
function stopPricePolling() {
  if (__priceTimer !== null) { clearInterval(__priceTimer); __priceTimer = null; }
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
  const risk = calcRisk({ pair: sig.pair, entry: Number(sig.entry), sl: Number(sig.stop_loss), lot: Number(sig.lot_size), refBalanceUsd: 0, prices: S.prices });
  if (risk.error || rr === null) return { riskUsd: null, targetUsd: null, rr };
  return { riskUsd: risk.riskUsd, targetUsd: risk.riskUsd * rr, rr };
}

function pairHtml(pair) {
  // D58: XAUUSD memakai tag emas seperti prototipe.
  return pair === 'XAUUSD' ? `<span class="goldtag">${esc(pair)}</span>` : esc(pair);
}
function signalCardHtml(sig) {
  const tr = traderOf(sig);
  const name = traderHandle(tr); // publik: hanya @username (ronde 5)
  const level = levelOfSignal(sig);
  const verified = level >= PAY_GATE_LEVEL
    ? ` <span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : '';
  const mine = S.user && sig.trader_id === S.user.id;
  const locked = isLockedOrHidden(sig);
  const d = decimalsForPair(sig.pair);
  const dirCls = sig.direction === 'BUY' ? 'buy' : 'sell';
  // D10: flag duplikat — dihitung sebelum cabang terkunci supaya tampil
  // juga di kartu terkunci (tidak membocorkan pair/arah).
  let dupHtml = '';
  if (sig.duplicate_flagged && sig.duplicate_of) {
    const orig = findSignal(sig.duplicate_of);
    const origName = orig ? traderHandle(traderOf(orig)) : '';
    dupHtml = `<div class="dup-flag">${esc(t('dupFlag', { name: origName }))}</div>`;
  }
  // D02: kartu terkunci prototipe (lockedCardHTML) — pair, arah, entry,
  // SL, TP, hasil disembunyikan total; hanya nama/meta + judul terkunci +
  // tombol Langganan/Ikuti.
  if (locked) {
    return `<article class="sig ${dirCls}" data-sig="${esc(sig.id)}">
    <div class="sig-top"><button class="avatar-btn" data-profile="${esc(sig.trader_id)}" aria-label="${esc(name)}">${avatarImg(name, sig.trader_id, tr.trader_avatar_url, 'avatar-sm')}</button><div class="who"><button class="name" data-profile="${esc(sig.trader_id)}">${esc(name)}${demoBadge(sig.trader_id)}</button><div class="mt">${esc(fmtRel(sig.created_at))}</div></div><div class="right"><span class="lvlbadge">Level ${level} · ${esc(levelName(level, getLang()))}</span>${verified} ${subBadgeHtml(sig.trader_id)}<span class="pill">${ICONS.lock} ${esc(t('locked'))}</span></div></div>
    <div class="locked-body"><span aria-hidden="true">${ICONS.lock}</span><div><div class="lt">${esc(t('lockedTitle'))}</div><div class="ld">${esc(lockedDescFor(sig.trader_id))}</div></div></div>
    ${dupHtml}
    <div class="sig-foot"><span class="facts">${esc(t('lockedTitle'))}</span>${subscribeBtnHtml(sig.trader_id)}${followBtnHtml(sig.trader_id)}</div>
  </article>`;
  }
  let levelsHtml;
  {
    // R54: sel ke-4 DIHAPUS dari kartu (dulu: Harga sekarang untuk sinyal
    // terbuka, Harga keluar untuk WIN/LOSS). Keduanya duplikat: harga
    // sekarang sudah tampil di baris status kartu (pendDist / floating)
    // + Detail + ticker; harga keluar tetap di Detail. Tersisa 3 sel.
    levelsHtml = `<div class="sig-levels">
      <div class="lv"><small>${esc(t('entry'))}</small><b class="mono">${fmtNum(sig.entry, d)}</b></div>
      <div class="lv"><small>${esc(t('stopLoss'))}</small><b class="mono">${fmtNum(sig.stop_loss, d)}</b></div>
      <div class="lv"><small>${esc(t('takeProfit'))}</small><b class="mono">${fmtNum(sig.take_profit, d)}</b></div>
    </div>`;
  }
  // Fakta kaki kartu — satu span seperti prototipe (D36): "Lot 0.10 ·
  // Risiko $X (N pips) · Target $X (N pips) · R:R 1:X.XX".
  const rt = riskTargetUsd(sig);
  const riskPips = Math.abs(Number(sig.entry) - Number(sig.stop_loss)) / pipSize(sig.pair);
  const targetPips = Math.abs(Number(sig.take_profit) - Number(sig.entry)) / pipSize(sig.pair);
  const factsHtml = `<div class="sig-facts"><span>${esc(t('lot'))} ${esc(ds(Number(sig.lot_size).toFixed(2)))} · ${esc(t('riskUsd'))} <b>${rt.riskUsd !== null ? esc(fmtUsd(rt.riskUsd)) : '—'}</b> (${Math.round(riskPips)} pips) · ${esc(t('sigTarget'))} <b>${rt.targetUsd !== null ? esc(fmtUsd(rt.targetUsd)) : '—'}</b> (${Math.round(targetPips)} pips) · R:R <b>1:${rt.rr !== null ? ds(rt.rr.toFixed(2)) : '—'}</b></span></div>`;
  // Bilah progres untuk AKTIF (D30): floating "$X · ±pips" + ends
  // "SL X · ke TP Np · ke SL Np · TP X".
  let progHtml = '';
  if (sig.status === 'AKTIF') {
    const now = priceOf(sig.pair);
    const fl = floatingUsd(sig);
    const denom = Number(sig.take_profit) - Number(sig.stop_loss);
    const pct = now !== null && denom !== 0
      ? Math.min(100, Math.max(0, ((now - Number(sig.stop_loss)) / denom) * 100))
      : 0;
    const flPips = now !== null ? ((sig.direction === 'SELL' ? -1 : 1) * (now - Number(sig.entry))) / pipSize(sig.pair) : null;
    const toTp = now !== null ? Math.abs(Number(sig.take_profit) - now) / pipSize(sig.pair) : null;
    const toSl = now !== null ? Math.abs(now - Number(sig.stop_loss)) / pipSize(sig.pair) : null;
    progHtml = `<div class="sig-prog"><div class="progress"><div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div>`
      + `<small>${esc(t('sigFloating'))}: <b>${fl !== null ? esc(fmtUsd(fl)) : '—'}</b>${flPips !== null ? ` · ${esc(fmtPipsSigned(flPips))}` : ''}${now !== null ? ` · ${esc(t('sigNow'))} ${esc(fmtNum(now, d))}` : ` · ${esc(t('sigNoPrice'))}`}</small></div>`
      + `<div class="ends"><span>SL ${esc(fmtNum(sig.stop_loss, d))}</span><span>${toTp !== null ? `${esc(t('toTP'))} ${Math.round(toTp)}p · ` : ''}${toSl !== null ? `${esc(t('toSL'))} ${Math.round(toSl)}p · ` : ''}TP ${esc(fmtNum(sig.take_profit, d))}</span></div></div>`;
  }
  // Catatan PENDING (D50): sisa waktu kedaluwarsa.
  let pendHtml = '';
  if (sig.status === 'PENDING') {
    const now = priceOf(sig.pair);
    const nowTxt = now !== null ? fmtNum(now, d) : '—';
    const dist = now !== null ? fmtNum(Math.abs(now - Number(sig.entry)), d) : '—';
    pendHtml = `<div class="pend-note">${esc(t('pendDist', { price: nowTxt, dist }))} · ${esc(fmtExpiry(sig.expires_at))}</div>`;
  }
  // Angka hasil di kanan baris pair (sinyal tertutup saja, bertanda — D13).
  const resultHtml = (sig.status === 'WIN' || sig.status === 'LOSS') && sig.profit_usd !== null && sig.profit_usd !== undefined
    ? `<span class="sig-result ${sig.status === 'WIN' ? 'win' : 'loss'}">${esc(fmtUsd0(sig.profit_usd))} <span>(${sig.profit_pips !== null && sig.profit_pips !== undefined ? `${fmtPipsSigned(sig.profit_pips)} · ` : ''}${sig.r_value !== null && sig.r_value !== undefined ? esc(fmtRShort(sig.r_value)) : ''})</span></span>`
    : '';
  // B1-06: urutan aksi prototipe — Ubah → Batalkan → [ikon bagikan] →
  // Detail → Salin (PENDING) → Ikuti.
  // R9-4: sinyal PENDING yang sudah dibagikan tidak bisa diubah lagi —
  // tombol Ubah disembunyikan (server juga menolak, update_signal 'shared').
  // Batalkan tetap ada: membatalkan menarik sinyal, bukan mengubah isinya.
  const actions = [];
  if (mine && sig.status === 'PENDING') {
    if (!sig.shared_at) {
      actions.push(`<button class="btn" type="button" data-act="edit" data-sig="${esc(sig.id)}">${esc(t('editSignal'))}</button>`);
    }
    actions.push(`<button class="btn danger" type="button" data-act="cancel" data-sig="${esc(sig.id)}">${esc(t('cancelSignal'))}</button>`);
  }
  if (mine) {
    // R19: HANYA sinyal selesai (WIN/LOSS) yang bisa dibagikan — sinyal
    // yang dibagikan adalah bukti hasil akhir; PENDING/AKTIF belum punya
    // hasil. Tombol DISEMBUNYIKAN (bukan disabled yang membingungkan).
    // Sinyal PENDING yang sudah dibagikan SEBELUM R19 tetap terkunci
    // (grandfathered) — tombolnya juga hilang, bukan dibuka lagi.
    if (sig.status === 'WIN' || sig.status === 'LOSS') {
      // R9b: ikon + teks "Bagikan" (bukan ikon saja). Sebelumnya tombol ini
      // hanya ikon tanpa teks dan aria-label "Unduh kartu (PNG)" — tidak bisa
      // ditemukan lewat pencarian teks dan tidak jelas fungsinya (cacat live
      // ronde 9+10: pencarian "Bagikan" tidak menemukan apa-apa).
      actions.push(`<button class="btn" type="button" data-act="share" data-sig="${esc(sig.id)}" aria-label="${esc(t('sigShare'))}">${ICONS.share} ${esc(t('sigShare'))}</button>`);
    }
  }
  actions.push(`<button class="btn" type="button" data-act="detail" data-sig="${esc(sig.id)}">${esc(t('sigDetail'))}</button>`);
  // D29: Salin hanya bila PENDING; label berubah "Sudah disalin" bila sudah.
  const copied = S.copiedIds.has(sig.id);
  if (sig.status === 'PENDING') {
    actions.push(`<button class="btn" type="button" data-act="copy" data-sig="${esc(sig.id)}">${copied ? ICONS.check + ' ' : ICONS.copy + ' '}${esc(copied ? t('copied') : t('copySignal'))}</button>`);
  }
  if (!mine) actions.push(followBtnHtml(sig.trader_id));
  const editedBadge = (sig.version && Number(sig.version) > 1)
    ? ` <span class="pill edited">${esc(t('editedBadge'))}</span>` : '';
  return `<article class="sig ${dirCls}" data-sig="${esc(sig.id)}" tabindex="0" role="button">
    <div class="sig-top"><button class="avatar-btn" data-profile="${esc(sig.trader_id)}" aria-label="${esc(name)}">${avatarImg(name, sig.trader_id, tr.trader_avatar_url, 'avatar-sm')}</button><div class="who"><button class="name" data-profile="${esc(sig.trader_id)}">${esc(name)}${demoBadge(sig.trader_id)}</button><div class="mt">${esc(fmtRel(sig.created_at))}</div></div><div class="right"><span class="lvlbadge">Level ${level} · ${esc(levelName(level, getLang()))}</span>${verified} ${subBadgeHtml(sig.trader_id)}${statusPill(sig.status)}${editedBadge}</div></div>
    ${dupHtml}
    <div class="sig-head">
      <span class="sig-pair sig-pair-lg">${pairHtml(sig.pair)}</span>
      <span class="dir ${dirCls}">${esc(sig.direction)}</span>
      <span class="pill">${esc(t(sig.entry_type === 'stop' ? 'entryStop' : 'entryLimit'))}</span>
      <span class="spacer"></span>
      ${resultHtml}
    </div>
    ${levelsHtml}
    ${progHtml}
    ${pendHtml}
    ${factsHtml}
    <div class="sig-actions">${actions.join('')}</div>
  </article>`;
}

function bindSignalCards(root) {
  $$('[data-profile]', root).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openTraderProfile(b.dataset.profile);
    });
  });
  bindFollowSubscribe(root);
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
      if (act === 'share') { const sg = findSignal(id); if (sg) downloadShareCard(sg); return; }
      if (act === 'copy') {
        if (await copySignalText(id)) paintCopyButtons(id);
        return;
      }
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
          invalidateAllSignals();
          await renderTraderWork();
          await renderHome();
        } catch (err) {
          toast(t('errNetwork'), true);
        }
      }
    });
  });
}

// Salin sinyal (B2-01 + B4-07): salin teks lengkap (format prototipe) ke
// clipboard DAN catat salinan ke tabel copies (lot = lot sinyal sumber).
// Salinan ganda tidak dicatat dua kali (unique DB) — toast membedakan
// "baru tercatat" vs "sudah ada di Jurnal". Mengembalikan true bila
// berhasil (pemanggil memperbarui tombolnya).
async function copySignalText(id) {
  const sig = findSignal(id);
  if (!sig) return false;
  if (sig.status !== 'PENDING') return false;
  // Paywall tetap berlaku (prototipe): sinyal terkunci tidak bisa disalin.
  if (isLockedOrHidden(sig)) { toast(lockedDescFor(sig.trader_id), true); return false; }
  const tr = traderOf(sig);
  const level = levelOfSignal(sig);
  const rt = riskTargetUsd(sig);
  const d = decimalsForPair(sig.pair);
  const riskPips = Math.abs(Number(sig.entry) - Number(sig.stop_loss)) / pipSize(sig.pair);
  const targetPips = Math.abs(Number(sig.take_profit) - Number(sig.entry)) / pipSize(sig.pair);
  const rr = calcRr(Number(sig.entry), Number(sig.stop_loss), Number(sig.take_profit));
  const text = t('copyTextHead', { pair: sig.pair, dir: sig.direction, status: sig.status }) + '\n'
    + t('copyTraderLine', { handle: traderHandle(tr), lvl: `Level ${level} · ${levelName(level, getLang())}` }) + '\n'
    + `Entry: ${fmtNum(sig.entry, d)}\n`
    + `Stop Loss: ${fmtNum(sig.stop_loss, d)}\n`
    + `Take Profit: ${fmtNum(sig.take_profit, d)}\n`
    + t('copyRiskLine', { lot: ds(Number(sig.lot_size).toFixed(2)), risk: rt.riskUsd !== null ? fmtUsd(rt.riskUsd) : '—', target: rt.targetUsd !== null ? fmtUsd(rt.targetUsd) : '—' }) + '\n'
    + t('copyDistLine', { sl: Math.round(riskPips), tp: Math.round(targetPips) }) + '\n'
    + `R:R 1:${rr !== null ? ds(rr.toFixed(2)) : '—'}\n`
    + t('copyRLine', { r: t('copyNotDone') });
  try { await navigator.clipboard.writeText(text); } catch (e) { /* clipboard tidak tersedia — salinan tetap dicatat */ }
  // Catat salinan (lot sinyal sumber); abaikan bila sudah tercatat.
  let already = S.copiedIds.has(id);
  if (!already) {
    try {
      const row = await api.copySignal(S.user.id, id, Number(sig.lot_size));
      S.myCopies.unshift({ id: row.id, signal_id: id, lot_size: Number(sig.lot_size), status: 'copied', created_at: new Date().toISOString(), signals: sig });
      S.copiedIds.add(id);
    } catch (e) {
      // 23505 = unique violation → sudah disalin sebelumnya.
      if (String(e?.message || '').includes('23505') || String(e?.code || '') === '23505') {
        already = true;
        S.copiedIds.add(id);
      } else {
        toast(t('errNetwork'), true);
        return false;
      }
    }
  }
  toast(t('toastCopied', { pair: sig.pair }) + (already ? t('toastCopiedAlready') : t('toastCopiedNew')));
  // R25: bila halaman Follower sedang dibuka,
  // segarkan daftar Salinan aktif dari state lokal (tanpa reload).
  if (S.view === 'office-follower') renderOfficeFollowerTab();
  return true;
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
  const name = traderHandle(tr); // publik: hanya @username (ronde 5)
  return `OLE Signals — ${sig.pair} ${sig.direction}\n`
    + `Trader: ${name} (Level ${levelOfSignal(sig)} · ${levelName(levelOfSignal(sig), getLang())})\n`
    + `Entry ${sig.entry} | SL ${sig.stop_loss} | TP ${sig.take_profit} | ${sig.lot_size} lot\n`
    + `${t('sigShareId')}: ${shareCardId(sig)} | ${t('sigShareCode')}: ${verifyCode(sig)}\n`
    + `${shareVerifyUrl(sig)}`;
}
// B-04: teks bagikan profil trader (format portfolioShareText prototipe:
// nama + level + win rate + total profit + total R + recovery factor) +
// tautan deep link #trader/<id> (kini berfungsi, B-01/B4-02).
function traderShareText(tr) {
  const st = statsForTrader(tr.profile_id);
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const wr = st.wr === null ? '—' : ds(st.wr.toFixed(1)) + '%';
  return `${t('portfolioShareTitle')} ${traderHandle(tr)}\n`
    + `Level ${level} · ${levelName(level, getLang())}\n`
    + `Win rate: ${wr}\n`
    + `${t('stProfitUSD')}: ${fmtUsd(st.totalUSD)}\n`
    + `Total R: ${fmtR(st.totalR)}\n`
    + `Recovery factor: ${fmtRf(st.recovery)}\n`
    + `${t('portfolioShareSuffix')}\n`
    + `${window.location.origin}/#trader/${tr.profile_id}`;
}
// Buang tag HTML dari string i18n sebelum digambar di canvas — canvas tidak
// me-render markup, tag akan tampil literal (bug ronde 5b: <strong> tampil
// di PNG kartu bagikan). Spasi ganda hasil penghapusan ikut dirapikan.
function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
// Bungkus teks ke beberapa baris sesuai lebar maksimum (diukur dengan font
// canvas yang sedang aktif). Kata tunggal yang melebihi lebar maksimum
// dipotong per karakter supaya tidak meluber keluar canvas.
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  const pushLine = () => { if (line) { lines.push(line); line = ''; } };
  for (const word of String(text).split(' ').filter(Boolean)) {
    let w = word;
    while (ctx.measureText(w).width > maxWidth) {
      pushLine();
      let cut = w.length;
      while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxWidth) cut--;
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
      if (!w) break;
    }
    if (!w) continue;
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) line = test;
    else { pushLine(); line = w; }
  }
  pushLine();
  return lines.length ? lines : [''];
}
// ---- kartu bagikan: port drawSignalCard prototipe (D01) ----------------
// Latar foto (assets/share-bg.webp, diambil dari prototipe) + brand emas
// "OLE SIGNALS" + pil BUY/SELL + pil status + blok jarak-ke-entry +
// sparkline + garis TP/ENTRY/SL + ENTRY/SL/TP 3 kolom + QR + footer.
// Pil "DATA CONTOH" dan catatan kaki "DATA CONTOH" prototipe TIDAK
// dipasang (data live nyata) — catatan kaki memakai teks peringatan
// risiko (ronde 5b). Sparkline dibuat dari jalan acak ber-seed dari ID
// sinyal (seperti prototipe: 48 titik entry -> harga akhir) karena belum
// ada riwayat harga tersimpan — BUKAN harga historis nyata.
let shareBgImg = null;
let shareBgTried = false;
function loadShareBg() {
  if (shareBgTried) return Promise.resolve(shareBgImg);
  shareBgTried = true;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { shareBgImg = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = '/assets/share-bg.webp';
  });
}
function cardSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function cardRand(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}
function cardRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const CARD_MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const CARD_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function cardDateStr(d) {
  const months = getLang() === 'en' ? CARD_MONTHS_EN : CARD_MONTHS_ID;
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${p2(d.getHours())}.${p2(d.getMinutes())}`;
}
function cardBg(ctx) {
  if (shareBgImg && shareBgImg.complete && shareBgImg.naturalWidth) {
    ctx.drawImage(shareBgImg, 0, 0, 1080, 1080);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, '#111A2E'); g.addColorStop(0.55, '#0D1526'); g.addColorStop(1, '#0A1128');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1080);
    const glow = ctx.createRadialGradient(950, 90, 10, 950, 90, 520);
    glow.addColorStop(0, 'rgba(56,189,248,0.16)'); glow.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 1080, 1080);
    const glow2 = ctx.createRadialGradient(80, 1020, 10, 80, 1020, 480);
    glow2.addColorStop(0, 'rgba(255,196,0,0.10)'); glow2.addColorStop(1, 'rgba(255,196,0,0)');
    ctx.fillStyle = glow2; ctx.fillRect(0, 0, 1080, 1080);
  }
  const ov = ctx.createLinearGradient(0, 0, 1080, 0);
  ov.addColorStop(0, 'rgba(10,17,40,0.82)');
  ov.addColorStop(0.55, 'rgba(10,17,40,0.55)');
  ov.addColorStop(1, 'rgba(10,17,40,0.15)');
  ctx.fillStyle = ov; ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = '#FFC400';
  ctx.fillRect(72, 128, 120, 4);
}
function cardStatusPill(ctx, text, bg, x, yCenter) {
  ctx.font = '800 30px Inter, sans-serif';
  const w = ctx.measureText(text).width + 48;
  const h = 52;
  cardRoundRect(ctx, x, yCenter - h / 2, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = '#0A1128';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, yCenter + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return w;
}
function cardSpark(ctx, sig, x, y, w, h, levels) {
  const n = 48;
  const rnd = cardRand(cardSeed(sig.id + '|' + sig.status));
  const cur = priceOf(sig.pair);
  const start = Number(sig.entry);
  const end = (sig.close_price !== null && sig.close_price !== undefined)
    ? Number(sig.close_price) : (cur !== null ? cur : start);
  const lo = Math.min(start, end, Number(sig.stop_loss), Number(sig.take_profit));
  const hi = Math.max(start, end, Number(sig.stop_loss), Number(sig.take_profit));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const base = start + (end - start) * f;
    const amp = (hi - lo) * 0.22;
    const noise = (rnd() - 0.5) * 2 * amp * Math.sin(f * Math.PI);
    pts.push(base + noise);
  }
  let pmin = Math.min(...pts);
  let pmax = Math.max(...pts);
  if (pmax - pmin < 1e-12) { pmin -= 1; pmax += 1; }
  if (levels) {
    pmin = Math.min(pmin, Number(sig.stop_loss), Number(sig.take_profit), start, cur !== null ? cur : start);
    pmax = Math.max(pmax, Number(sig.stop_loss), Number(sig.take_profit), start, cur !== null ? cur : start);
    const pad = (pmax - pmin) * 0.04;
    pmin -= pad; pmax += pad;
  }
  const Yv = (v) => y + h - ((v - pmin) / (pmax - pmin)) * h;
  const X = [];
  const Y = [];
  for (let i = 0; i < n; i++) { X.push(x + (i / (n - 1)) * w); Y.push(Yv(pts[i])); }
  const fuv = levels && cur !== null ? floatingUsd(sig) : 0;
  const col = sig.status === 'LOSS' ? '#FF1744'
    : (sig.status === 'WIN' ? '#00E676'
      : (sig.status === 'PENDING' ? '#FFC400' : ((fuv !== null && fuv >= 0) ? '#00E676' : '#FF1744')));
  ctx.beginPath();
  ctx.moveTo(X[0], y + h);
  for (let i = 0; i < n; i++) ctx.lineTo(X[i], Y[i]);
  ctx.lineTo(X[n - 1], y + h);
  ctx.closePath();
  const fg = ctx.createLinearGradient(0, y, 0, y + h);
  fg.addColorStop(0, col + '33');
  fg.addColorStop(1, col + '00');
  ctx.fillStyle = fg;
  ctx.fill();
  if (levels) {
    const lvls = [
      { v: Number(sig.take_profit), col: '#00E676', lbl: 'TP' },
      { v: start, col: sig.status === 'PENDING' ? '#FFC400' : '#94A3B8', lbl: 'ENTRY' },
      { v: Number(sig.stop_loss), col: '#FF1744', lbl: 'SL' },
    ];
    if (ctx.setLineDash) ctx.setLineDash([9, 9]);
    ctx.lineWidth = 2.5;
    ctx.font = '700 22px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const lv of lvls) {
      const ly = Yv(lv.v);
      ctx.beginPath();
      ctx.moveTo(x, ly);
      ctx.lineTo(x + w, ly);
      ctx.strokeStyle = lv.col;
      ctx.stroke();
      ctx.fillStyle = lv.col;
      ctx.fillText(lv.lbl, x + w + 10, ly + 8);
    }
    if (ctx.setLineDash) ctx.setLineDash([]);
  }
  ctx.beginPath();
  ctx.moveTo(X[0], Y[0]);
  for (let i = 1; i < n; i++) ctx.lineTo(X[i], Y[i]);
  ctx.strokeStyle = col;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X[n - 1], Y[n - 1], 9, 0, Math.PI * 2);
  ctx.fillStyle = col;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#0A1128';
  ctx.stroke();
  if (levels && cur !== null) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 24px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fmtNum(cur, decimalsForPair(sig.pair)), X[n - 1] - 12, Y[n - 1] + 8);
    ctx.textAlign = 'left';
  }
}
function cardHero(ctx, sig, y) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const open = sig.status === 'PENDING' || sig.status === 'AKTIF';
  const subY = open ? y + 82 : y + 72;
  const d = decimalsForPair(sig.pair);
  if (sig.status === 'WIN' || sig.status === 'LOSS') {
    const uv = Number(sig.profit_usd) || 0;
    ctx.fillStyle = sig.status === 'WIN' ? '#00E676' : '#FF1744';
    ctx.font = '800 150px Inter, sans-serif';
    ctx.fillText(fmtUsd0(uv), 72, y);
    const sub = fmtPipsSigned(sig.profit_pips) + '  ·  ' + fmtRShort(sig.r_value);
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 42px Inter, sans-serif';
    ctx.fillText(sub, 72, subY);
    cardStatusPill(ctx, statusPillLabel(sig.status), sig.status === 'WIN' ? '#00E676' : '#FF1744', 72 + ctx.measureText(sub).width + 20, subY - 15);
    return subY;
  }
  if (sig.status === 'AKTIF') {
    const cur = priceOf(sig.pair);
    const fuv = floatingUsd(sig);
    const fpips = cur !== null ? ((sig.direction === 'SELL' ? -1 : 1) * (cur - Number(sig.entry))) / pipSize(sig.pair) : null;
    const rt = riskTargetUsd(sig);
    const frv = (fuv !== null && rt.riskUsd) ? fuv / rt.riskUsd : 0;
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 24px Inter, sans-serif';
    try { ctx.letterSpacing = '3px'; } catch (e) { /* abaikan */ }
    ctx.fillText(fuv !== null && fuv >= 0 ? t('cardFloatProfit') : t('cardFloatLoss'), 72, y - 137);
    try { ctx.letterSpacing = '0px'; } catch (e) { /* abaikan */ }
    ctx.fillStyle = fuv !== null && fuv >= 0 ? '#00E676' : '#FF1744';
    ctx.font = '800 150px Inter, sans-serif';
    ctx.fillText(fuv !== null ? fmtUsd0(fuv) : '—', 72, y);
    const subA = fuv !== null
      ? fmtPipsSigned(fpips) + '  ·  ' + fmtRShort(frv)
      : t('sigNoPrice');
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 42px Inter, sans-serif';
    ctx.fillText(subA, 72, subY);
    cardStatusPill(ctx, statusPillLabel(sig.status), '#38BDF8', 72 + ctx.measureText(subA).width + 20, subY - 15);
    return subY;
  }
  // PENDING: jarak harga sekarang ke entry + harga sekarang.
  const curP = priceOf(sig.pair);
  const dist = curP !== null ? Math.abs(curP - Number(sig.entry)) / pipSize(sig.pair) : null;
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 24px Inter, sans-serif';
  try { ctx.letterSpacing = '3px'; } catch (e) { /* abaikan */ }
  ctx.fillText(t('cardDistToEntry'), 72, y - 137);
  try { ctx.letterSpacing = '0px'; } catch (e) { /* abaikan */ }
  ctx.fillStyle = '#FFC400';
  ctx.font = '800 150px Inter, sans-serif';
  ctx.fillText(dist !== null ? `${Math.round(dist)} pips` : '—', 72, y);
  const subP = curP !== null
    ? t('cardNowPrice') + fmtNum(curP, d)
    : t('sigNoPrice');
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 42px Inter, sans-serif';
  ctx.fillText(subP, 72, subY);
  cardStatusPill(ctx, statusPillLabel(sig.status), '#FFC400', 72 + ctx.measureText(subP).width + 20, subY - 15);
  return subY;
}
function cardFooter(ctx, sig) {
  const cardId = shareCardId(sig);
  const code = verifyCode(sig);
  const qx = 72;
  const qy = 896;
  const qs = 100;
  cardRoundRect(ctx, qx, qy, qs, qs, 14);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  let qr = null;
  try {
    const qlib = window.qrcode;
    if (qlib) { qr = qlib(0, 'M'); qr.addData(shareVerifyUrl(sig)); qr.make(); }
  } catch (e) { qr = null; }
  if (qr) {
    const n = qr.getModuleCount();
    const m = (qs - 12) / (n + 4);
    const ox = qx + (qs - m * n) / 2;
    const oy = qy + (qs - m * n) / 2;
    ctx.fillStyle = '#0A1128';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(ox + c * m, oy + r * m, m + 0.5, m + 0.5);
      }
    }
  } else {
    ctx.fillStyle = '#0A1128';
    ctx.font = '700 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QR', qx + qs / 2, qy + qs / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  const tx = qx + qs + 24;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText('OLE Signals', tx, 912);
  const w1 = ctx.measureText('OLE Signals').width;
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 30px Inter, sans-serif';
  ctx.fillText(`  ·  ID ${cardId}`, tx + w1, 912);
  ctx.fillText(t('cardVerifyCode'), tx, 946);
  const w2 = ctx.measureText(t('cardVerifyCode')).width;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText(code, tx + w2 + 12, 946);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 28px Inter, sans-serif';
  const open = sig.status === 'PENDING' || sig.status === 'AKTIF';
  ctx.fillText(open ? `${t('cardPriceAsOf')}${cardDateStr(new Date())}  ·  ${t('cardNotFinal')}` : cardDateStr(new Date()), tx, 974);
  // Catatan kaki: teks peringatan risiko (bukan "DATA CONTOH" — data live
  // nyata). Dibungkus maks. 3 baris, font adaptif 18→14px.
  // B4-08 (lanjutan): teks digambar top-down MULAI DI BAWAH kotak QR
  // (QR berakhir y=996) agar tidak menumpuk garis tanggal (y=974) dan
  // tidak menabrak kotak QR putih — sebelumnya baseline 1072 bottom-up
  // menaruh baris pertama di y=1024, tepat di atas garis tanggal dan
  // di dalam area QR.
  const riskText = stripTags(t('riskWarn'));
  const riskMaxW = 1080 - 72 * 2;
  let riskFont = 14;
  let riskLines = [];
  for (const px of [18, 16, 14]) {
    ctx.font = `500 ${px}px Inter, sans-serif`;
    riskLines = wrapText(ctx, riskText, riskMaxW);
    riskFont = px;
    if (riskLines.length <= 3) break;
  }
  const riskLH = riskFont + 8;
  ctx.fillStyle = '#94A3B8';
  ctx.font = `500 ${riskFont}px Inter, sans-serif`;
  riskLines.slice(0, 3).forEach((ln, i) => {
    ctx.fillText(ln, 72, 1016 + i * riskLH);
  });
}
async function drawShareCard(sig) {
  await loadShareBg();
  const cv = document.createElement('canvas');
  cv.width = 1080;
  cv.height = 1080;
  const ctx = cv.getContext('2d');
  const tr = traderOf(sig);
  const name = traderHandle(tr); // publik: hanya @username (ronde 5)
  const level = levelOfSignal(sig);
  const d = decimalsForPair(sig.pair);
  const open = sig.status === 'PENDING' || sig.status === 'AKTIF';
  cardBg(ctx);
  // Brand emas (nama live tetap "OLE SIGNALS", gaya prototipe).
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFC400';
  ctx.font = '700 30px Inter, sans-serif';
  try { ctx.letterSpacing = '6px'; } catch (e) { /* abaikan */ }
  ctx.fillText('OLE SIGNALS', 72, 96);
  try { ctx.letterSpacing = '0px'; } catch (e) { /* abaikan */ }
  // Baris trader: avatar + ring cyan, username, "Level N · Pangkat".
  ctx.beginPath();
  ctx.arc(116, 200, 44, 0, Math.PI * 2);
  ctx.fillStyle = '#111A2E';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#38BDF8';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initialOf(name), 116, 202);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 46px Inter, sans-serif';
  ctx.fillText(name, 184, 208);
  const folN = S.followerCounts ? (S.followerCounts[sig.trader_id] || 0) : 0;
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 30px Inter, sans-serif';
  ctx.fillText(`Level ${level} · ${levelName(level, getLang())}${folN > 0 ? `  ·  ${folN} ${getLang() === 'en' ? 'followers' : 'pengikut'}` : ''}${isDemo(sig.trader_id) ? ' · Demo' : ''}`, 184, 252);
  // Pair + pil BUY/SELL.
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 96px Inter, sans-serif';
  const pairY = open ? 330 : 350;
  ctx.fillText(sig.pair, 72, pairY);
  const pw = ctx.measureText(sig.pair).width;
  const isBuy = sig.direction === 'BUY';
  ctx.font = '800 30px Inter, sans-serif';
  const dw = ctx.measureText(sig.direction).width + 56;
  const px = 72 + pw + 28;
  cardRoundRect(ctx, px, pairY - 55, dw, 40, 20);
  ctx.fillStyle = isBuy ? '#00E676' : '#FF1744';
  ctx.fill();
  ctx.fillStyle = '#0A1128';
  ctx.textAlign = 'center';
  ctx.fillText(sig.direction, px + dw / 2, pairY - 24);
  ctx.textAlign = 'left';
  // Angka hero + sparkline + detail 3 kolom + footer.
  cardHero(ctx, sig, open ? 500 : 510);
  cardSpark(ctx, sig, 72, 632, 540, 138, open);
  ctx.fillStyle = 'rgba(148,163,184,0.25)';
  ctx.fillRect(72, 800, 1080 - 144, 2);
  const cols = [
    ['ENTRY', fmtNum(sig.entry, d)],
    ['STOP LOSS', fmtNum(sig.stop_loss, d)],
    ['TAKE PROFIT', fmtNum(sig.take_profit, d)],
  ];
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  cols.forEach(([label, val], i) => {
    const cx = 72 + i * 216;
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 26px Inter, sans-serif';
    ctx.fillText(label, cx, 836);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 38px Inter, sans-serif';
    ctx.fillText(val, cx, 884);
  });
  cardFooter(ctx, sig);
  return cv;
}
function statusPillLabel(status) {
  return { PENDING: t('pending'), AKTIF: t('active'), WIN: t('win'), LOSS: t('loss'), CANCELLED: t('cancelled'), EXPIRED: t('expired') }[status] || status;
}
// B-03: urutan bagikan seperti prototipe (shareCardPNG) — lembar bagikan
// native dulu (navigator.share + file, di HP), lalu salin gambar ke
// clipboard, lalu unduh. Sebelumnya hanya mengunduh.
// R9-4: tandai sinyal sebagai sudah dibagikan (best-effort — kegagalan RPC
// tidak boleh merusak alur bagikan; kunci server ditegakkan update_signal,
// kunci UI dari shared_at di objek lokal). Kembalikan true bila berhasil
// ditandai, agar tampilan bisa diperbarui (tombol Ubah hilang, label kunci).
// R9b: urutan prototipe DIHAPUS — unduh LANGSUNG. Alasan: `await
// navigator.share(...)` menggantungkan seluruh alur di browser desktop yang
// mendukung berbagi file (lembar bagikan OS terbuka, fungsi tertahan sampai
// pengguna menyelesaikan/menutupnya; selama itu tidak ada toast, unduhan,
// atau kunci — cacat live ronde 9+10). Harness tidak menangkapnya karena
// headless-shell TIDAK punya navigator.share sehingga cabang itu tidak
// pernah terpicu lokal. Tombolnya pun berlabel "Unduh kartu (PNG)" —
// unduhan langsung adalah perilaku yang dijanjikan dan terverifikasi di
// semua platform. Berbagi native bisa ditambah lagi nanti sebagai opsi
// eksplisit bila user minta (bukan sebagai langkah pertama yang menggantung).
async function markSharedBestEffort(sig) {
  try {
    // R19: RPC bisa menolak dengan { ok:false } TANPA throw (pola
    // api_error) — hasil HARUS diperiksa. Sebelumnya hasil diabaikan:
    // RPC menolak 'notclosed' tapi shared_at lokal tetap diisi (cacat
    // yang ditangkap harness r19). 'notclosed' diberi toast jujur;
    // kegagalan lain tetap diam (best-effort seperti sebelumnya).
    const res = await api.markSignalShared(sig.id);
    if (res && res.ok === false) {
      if (res.code === 'notclosed') toast(t('errNotclosed'), true);
      return false;
    }
    sig.shared_at = new Date().toISOString();
    return true;
  } catch (e) { return false; }
}
// R9-4: perbarui tampilan setelah sinyal ditandai dibagikan — daftar feed +
// menu Trader dirender ulang dari state (objek lokal sudah punya shared_at).
async function refreshAfterShare() {
  try { renderHomeList(); } catch (e) { /* abaikan */ }
  try { await renderTraderWork(); } catch (e) { /* abaikan */ }
}
async function downloadShareCard(sig) {
  // R19: hanya sinyal selesai (WIN/LOSS) yang bisa dibagikan. Tolak DI
  // SINI, sebelum menggambar/mengunduh — jangan sampai PNG terlanjur
  // diunduh lalu RPC menolak (toast jadi bertentangan dengan unduhan).
  // Jalur normal sudah tidak menampilkan tombolnya; gerbang ini untuk
  // panggilan langsung (mis. konsol) dan kondisi balap.
  if (sig.status !== 'WIN' && sig.status !== 'LOSS') {
    toast(t('errNotclosed'), true);
    return;
  }
  try {
    const cv = await drawShareCard(sig);
    const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no-blob');
    const fileName = `${shareCardId(sig)}.png`;
    // R9b: unduh langsung (lihat catatan di atas markSharedBestEffort).
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t('toastShareSaved'));
    if (await markSharedBestEffort(sig)) await refreshAfterShare();
  } catch (e) {
    toast(t('errNetwork'), true);
  }
}

// R9-5 (B-05): kartu PNG portofolio untuk share profil — mengikuti
// drawPortfolioCard prototipe (baris 7952-7990): nama + level + total profit
// + total R + WR + grid 2×2 (win rate, recovery factor, profit factor, max
// drawdown) + QR/kode verifikasi. Palet live (navy/sky/amber), geometri
// prototipe. QR = deep link profil #trader/<id> (router sudah jalan) — /v/
// belum bisa memverifikasi kartu portofolio, jadi QR tidak menunjuk /v/
// (perluasan /v/ adalah tindak lanjut terpisah). Foto avatar TIDAK digambar
// (huruf awal seperti prototipe; menggambar URL Storage ke canvas berisiko
// taint → toBlob gagal dan seluruh share rusak).
function portfolioCardId(tr) {
  const u = String(tr.username || tr.profile_id || '').replace(/^@/, '').toUpperCase();
  return 'SM-P-' + u;
}
function portfolioVerifyCode(tr) {
  const s = portfolioCardId(tr);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  const hex = ('0000000' + (h >>> 0).toString(16).toUpperCase()).slice(-8);
  return hex.slice(0, 4) + '-' + hex.slice(4);
}
function portfolioVerifyUrl(tr) {
  return `https://olesignals.onrender.com/#trader/${tr.profile_id}`;
}
// Footer kartu portofolio — geometri SAMA dengan cardFooter sinyal (QR
// 100×100 di y=896, teks 912/946/974, risiko dari y=1016; hasil perbaikan
// B4-08). Fungsi terpisah agar cardFooter sinyal tidak tersentuh.
function cardPortfolioFooter(ctx, tr) {
  const cardId = portfolioCardId(tr);
  const code = portfolioVerifyCode(tr);
  const qx = 72;
  const qy = 896;
  const qs = 100;
  cardRoundRect(ctx, qx, qy, qs, qs, 14);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  let qr = null;
  try {
    const qlib = window.qrcode;
    if (qlib) { qr = qlib(0, 'M'); qr.addData(portfolioVerifyUrl(tr)); qr.make(); }
  } catch (e) { qr = null; }
  if (qr) {
    const n = qr.getModuleCount();
    const m = (qs - 12) / (n + 4);
    const ox = qx + (qs - m * n) / 2;
    const oy = qy + (qs - m * n) / 2;
    ctx.fillStyle = '#0A1128';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(ox + c * m, oy + r * m, m + 0.5, m + 0.5);
      }
    }
  } else {
    ctx.fillStyle = '#0A1128';
    ctx.font = '700 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QR', qx + qs / 2, qy + qs / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  const tx = qx + qs + 24;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText('OLE Signals', tx, 912);
  const w1 = ctx.measureText('OLE Signals').width;
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 30px Inter, sans-serif';
  ctx.fillText(`  ·  ID ${cardId}`, tx + w1, 912);
  ctx.fillText(t('cardVerifyCode'), tx, 946);
  const w2 = ctx.measureText(t('cardVerifyCode')).width;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 30px Inter, sans-serif';
  ctx.fillText(code, tx + w2 + 12, 946);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 28px Inter, sans-serif';
  ctx.fillText(cardDateStr(new Date()), tx, 974);
  const riskText = stripTags(t('riskWarn'));
  const riskMaxW = 1080 - 72 * 2;
  let riskFont = 14;
  let riskLines = [];
  for (const px of [18, 16, 14]) {
    ctx.font = `500 ${px}px Inter, sans-serif`;
    riskLines = wrapText(ctx, riskText, riskMaxW);
    riskFont = px;
    if (riskLines.length <= 3) break;
  }
  const riskLH = riskFont + 8;
  ctx.fillStyle = '#94A3B8';
  ctx.font = `500 ${riskFont}px Inter, sans-serif`;
  riskLines.slice(0, 3).forEach((ln, i) => {
    ctx.fillText(ln, 72, 1016 + i * riskLH);
  });
}
async function drawPortfolioCard(tr) {
  await loadShareBg();
  const cv = document.createElement('canvas');
  cv.width = 1080;
  cv.height = 1080;
  const ctx = cv.getContext('2d');
  const st = statsForTrader(tr.profile_id);
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const name = traderHandle(tr);
  cardBg(ctx);
  // Brand emas (nama live tetap "OLE SIGNALS", gaya prototipe).
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFC400';
  ctx.font = '700 30px Inter, sans-serif';
  try { ctx.letterSpacing = '6px'; } catch (e) { /* abaikan */ }
  ctx.fillText('OLE SIGNALS', 72, 96);
  try { ctx.letterSpacing = '0px'; } catch (e) { /* abaikan */ }
  // Baris trader: avatar huruf awal + ring sky, username, "Level N · Pangkat".
  ctx.beginPath();
  ctx.arc(116, 200, 44, 0, Math.PI * 2);
  ctx.fillStyle = '#111A2E';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#38BDF8';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 44px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initialOf(name), 116, 202);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const folN = S.followerCounts ? (S.followerCounts[tr.profile_id] || 0) : 0;
  let nameFont = 46;
  ctx.font = `700 ${nameFont}px Inter, sans-serif`;
  while (nameFont > 30 && ctx.measureText(name).width > 800) {
    nameFont -= 2;
    ctx.font = `700 ${nameFont}px Inter, sans-serif`;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(name, 184, 208);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 30px Inter, sans-serif';
  ctx.fillText(`Level ${level} · ${levelName(level, getLang())}${folN > 0 ? `  ·  ${folN} ${getLang() === 'en' ? 'followers' : 'pengikut'}` : ''}${isDemo(tr.profile_id) ? ' · Demo' : ''}`, 184, 252);
  // Total profit (hero) + R + WR.
  ctx.fillStyle = '#94A3B8';
  ctx.font = '600 30px Inter, sans-serif';
  ctx.fillText('TOTAL PROFIT', 72, 330);
  const heroText = fmtUsd0(st.totalUSD);
  let heroFont = 150;
  ctx.font = `800 ${heroFont}px Inter, sans-serif`;
  while (heroFont > 100 && ctx.measureText(heroText).width > 936) {
    heroFont -= 10;
    ctx.font = `800 ${heroFont}px Inter, sans-serif`;
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(heroText, 72, 480);
  ctx.fillStyle = '#FFC400';
  ctx.font = '700 52px Inter, sans-serif';
  ctx.fillText(`${fmtRShort(st.totalR)}  ·  ${st.wr === null ? '—' : ds(st.wr.toFixed(1)) + '% WR'}`, 72, 560);
  // Grid 2×2: win rate, recovery factor, profit factor, max drawdown.
  const grid = [
    ['WIN RATE', st.wr === null ? '—' : ds(st.wr.toFixed(1)) + '%'],
    ['RECOVERY FACTOR', fmtRf(st.recovery)],
    ['PROFIT FACTOR', fmtPf(st.pf)],
    ['MAX DRAWDOWN', fmtUsd0(-(st.drawdown ? st.drawdown.usd : 0))],
  ];
  grid.forEach(([label, val], i) => {
    const cx = 72 + (i % 2) * 300;
    const cy = 688 + Math.floor(i / 2) * 122;
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 26px Inter, sans-serif';
    ctx.fillText(label, cx, cy);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 48px Inter, sans-serif';
    ctx.fillText(val, cx, cy + 56);
  });
  // Pembatas di atas footer (di bawah grid yang berakhir y=866, di atas QR y=896).
  ctx.fillStyle = 'rgba(148,163,184,0.25)';
  ctx.fillRect(72, 884, 1080 - 144, 2);
  cardPortfolioFooter(ctx, tr);
  return cv;
}
// R9-5: kartu PNG portofolio untuk share profil.
// R9b: unduh LANGSUNG (tanpa navigator.share / clipboard) — alasan sama
// seperti downloadShareCard: `await navigator.share(...)` menggantungkan
// alur di browser desktop (lembar bagikan OS), sehingga klik "Bagikan
// profil trader" tidak menghasilkan apa-apa yang terlihat (cacat live
// ronde 9+10). Unduhan langsung deterministik di semua platform.
async function downloadPortfolioCard(tr) {
  try {
    await ensureAllSignals();
    const cv = await drawPortfolioCard(tr);
    const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('no-blob');
    const fileName = `portofolio-${String(tr.username || tr.profile_id || '').replace(/^@/, '')}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(t('toastShareSaved'));
  } catch (e) {
    toast(t('errNetwork'), true);
  }
}

function fmtHoldMin(mins) {
  if (mins === null || mins === undefined) return '—';
  const m = Math.round(Number(mins) || 0);
  if (m < 60) return `${m} mnt`;
  const h = m / 60;
  if (h < 24) return `${h.toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`;
  return `${(h / 24).toLocaleString('id-ID', { maximumFractionDigits: 1 })} hari`;
}

function openSignalDetail(id) {
  const sig = findSignal(id);
  if (!sig) return;
  // B4-11: panel notifikasi ditutup saat membuka detail sinyal (prototipe).
  setNotifPanel(false);
  const tr = traderOf(sig);
  const name = traderHandle(tr); // publik: hanya @username (ronde 5)
  const level = levelOfSignal(sig);
  const verified = level >= PAY_GATE_LEVEL
    ? ` <span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : '';
  const mine = S.user && sig.trader_id === S.user.id;
  const locked = isLockedOrHidden(sig);
  const d = decimalsForPair(sig.pair);
  const dirCls = sig.direction === 'BUY' ? 'buy' : 'sell';
  const editedBadge = (sig.version && Number(sig.version) > 1)
    ? ` <span class="pill edited">${esc(t('editedBadge'))}</span>` : '';
  let dupHtml = '';
  if (sig.duplicate_flagged && sig.duplicate_of) {
    const orig = findSignal(sig.duplicate_of);
    const origName = orig ? traderHandle(traderOf(orig)) : '';
    dupHtml = `<div class="dup-flag">${esc(t('dupFlag', { name: origName }))}</div>`;
  }
  // D02: overlay terkunci — tanpa pair/arah/entry/SL/TP; hanya nama/meta +
  // judul terkunci + tombol Langganan (prototipe: subscribe + Tutup).
  if (locked) {
    openOverlay(`
    <div class="sig-top"><button class="avatar-btn" data-profile="${esc(sig.trader_id)}" aria-label="${esc(name)}">${avatarImg(name, sig.trader_id, tr.trader_avatar_url, 'avatar-sm')}</button><div class="who"><button class="name" data-profile="${esc(sig.trader_id)}">${esc(name)}${demoBadge(sig.trader_id)}</button><div class="mt">${esc(fmtRel(sig.created_at))}</div></div><span class="spacer"></span><span class="pill">Level ${level} · ${esc(levelName(level, getLang()))}</span>${verified}<span class="pill">${ICONS.lock} ${esc(t('locked'))}</span></div>
    <div class="locked-body" style="margin-top:14px;"><span aria-hidden="true">${ICONS.lock}</span><div><div class="lt">${esc(t('lockedTitle'))}</div><div class="ld">${esc(lockedDescFor(sig.trader_id))}</div></div></div>
    ${dupHtml}
    <div class="detail-actions">${subscribeBtnHtml(sig.trader_id)}<button class="btn" id="ov-close2" type="button">${esc(t('close'))}</button></div>`);
    $('#ov-close2').onclick = closeOverlay;
    bindFollowSubscribe($('#overlay-sheet'));
    $$('#overlay-sheet [data-profile]').forEach((b) => {
      b.addEventListener('click', () => { closeOverlay(); openTraderProfile(b.dataset.profile); });
    });
    return;
  }
  // Bilah progres AKTIF (D30): dirender SETELAH detail-rows; ends
  // "SL X · Floating $Y · TP Z".
  let progHtml = '';
  if (sig.status === 'AKTIF') {
    const now = priceOf(sig.pair);
    const fl = floatingUsd(sig);
    const denom = Number(sig.take_profit) - Number(sig.stop_loss);
    const pct = now !== null && denom !== 0
      ? Math.min(100, Math.max(0, ((now - Number(sig.stop_loss)) / denom) * 100))
      : 0;
    progHtml = `<div class="sig-prog"><div class="progress"><div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div>`
      + `<small>${esc(t('sigFloating'))}: <b>${fl !== null ? esc(fmtUsd(fl)) : '—'}</b>${now !== null ? ` · ${esc(t('sigNow'))} ${esc(fmtNum(now, d))}` : ` · ${esc(t('sigNoPrice'))}`}</small></div>`
      + `<div class="ends"><span>SL ${esc(fmtNum(sig.stop_loss, d))}</span><span>${esc(t('sigFloating'))} ${fl !== null ? esc(fmtUsd(fl)) : '—'}</span><span>TP ${esc(fmtNum(sig.take_profit, d))}</span></div></div>`;
  }
  const rt = riskTargetUsd(sig);
  // Ronde 35: % risiko dihitung dari saldo acuan level pemilik sinyal.
  const ownerProg = progressOf(tr);
  const ownerRef = ownerProg && Number(ownerProg.level_ref_balance) > 0 ? Number(ownerProg.level_ref_balance) : START_BALANCE_USD;
  const riskPct = rt.riskUsd !== null && ownerRef > 0 ? (rt.riskUsd / ownerRef) * 100 : null;
  const riskPips = Math.abs(Number(sig.entry) - Number(sig.stop_loss)) / pipSize(sig.pair);
  const targetPips = Math.abs(Number(sig.take_profit) - Number(sig.entry)) / pipSize(sig.pair);
  const now = priceOf(sig.pair);
  const done = sig.status === 'WIN' || sig.status === 'LOSS';
  let holdTxt;
  if (done) {
    holdTxt = sig.holding_minutes !== null && sig.holding_minutes !== undefined ? fmtHoldMin(sig.holding_minutes) : '—';
  } else if (sig.status === 'AKTIF' && sig.activated_at) {
    holdTxt = fmtHoldMin((Date.now() - new Date(sig.activated_at).getTime()) / 60000);
  } else {
    holdTxt = t('detHoldPending');
  }
  const drow = (k, v) => `<div class="lv"><span class="k">${esc(k)}</span><span class="v mono">${v}</span></div>`;
  let rowsHtml = `<div class="detail-rows">`;
  rowsHtml += drow(t('entry'), esc(fmtNum(sig.entry, d)))
    + drow(t('stopLoss'), esc(fmtNum(sig.stop_loss, d)))
    + drow(t('takeProfit'), esc(fmtNum(sig.take_profit, d)))
    + drow(done ? t('sigExit') : t('sigNow'), done
      ? ((sig.close_price !== null && sig.close_price !== undefined) ? esc(fmtNum(sig.close_price, d)) : '—')
      : (now !== null ? esc(fmtNum(now, d)) : '—'));
  rowsHtml += drow(t('lot'), esc(fmtNum(sig.lot_size, 2)));
  // Ronde 35: jenis entry sinyal (Stop/Limit; sinyal lama = Limit).
  rowsHtml += drow(t('detEntryType'), esc(t(sig.entry_type === 'stop' ? 'entryStop' : 'entryLimit')));
  rowsHtml += drow(t('riskUsd'), rt.riskUsd !== null ? esc(fmtUsd(rt.riskUsd)) : '—')
    + drow(t('detRiskBal'), riskPct !== null ? esc(t('detRiskBalVal', { pct: riskPct.toFixed(2), bal: fmtUsd(ownerRef) })) : '—')
    + drow(t('detFullTP'), rt.targetUsd !== null ? esc(fmtUsd(rt.targetUsd)) : '—')
    + drow(t('riskReward'), '1:' + (rt.rr !== null ? ds(rt.rr.toFixed(2)) : '—'))
    + drow(t('detDist'), `${Math.round(riskPips)} pips / ${Math.round(targetPips)} pips`);
  rowsHtml += drow(t('detHold'), esc(holdTxt))
    + drow(t('detPosted'), `${esc(fmtRel(sig.created_at))} · ${esc(fmtDate(sig.created_at))}`);
  if (sig.activated_at) rowsHtml += drow(t('dtEntry'), esc(fmtDate(sig.activated_at)));
  if (sig.closed_at) rowsHtml += drow(sig.status === 'WIN' ? t('dtTP') : t('dtSL'), esc(fmtDate(sig.closed_at)));
  if (done) {
    // D49: hasil akhir datar "$X · +Np · +R" (bukan "$X (Np · R)").
    const finalParts = [];
    if (sig.profit_pips !== null && sig.profit_pips !== undefined) finalParts.push(fmtPipsSigned(sig.profit_pips));
    if (sig.r_value !== null && sig.r_value !== undefined) finalParts.push(fmtRShort(sig.r_value));
    rowsHtml += drow(t('detFinal'), esc(fmtUsd0(sig.profit_usd)) + (finalParts.length ? ` · ${esc(finalParts.join(' · '))}` : ''));
  }
  rowsHtml += `</div>`;
  // D37 (r12/F1, r30b): PENDING tidak lagi menampilkan catatan apa pun —
  // status PENDING sudah ada di pill. AKTIF/WIN/LOSS tetap menampilkan
  // "Entry tersentuh · dinilai sistem dari harga" (penjelasan cara sistem
  // menilai hasil, bukan label kunci).
  const lockNote = sig.status === 'PENDING' ? '' : esc(t('detLockedNote'));
  const actions = [];
  // R19: "Unduh kartu (PNG)" hanya untuk sinyal selesai (WIN/LOSS) —
  // `done` sudah didefinisikan di atas (status WIN/LOSS). PENDING/AKTIF
  // tidak menampilkan tombol ini.
  if (mine && done) {
    actions.push(`<button class="btn" id="ov-share" type="button" aria-label="${esc(t('sigShareDownload'))}">${ICONS.download} ${esc(t('sigShareDownload'))}</button>`);
  }
  if (sig.status === 'PENDING') {
    actions.push(`<button class="btn primary" id="ov-copy" type="button">${ICONS.copy} ${esc(t('copySignal'))}</button>`);
  }
  actions.push(`<button class="btn" id="ov-trader" type="button">${esc(t('sigViewTrader'))}</button>`);
  actions.push(`<button class="btn" id="ov-close2" type="button">${esc(t('close'))}</button>`);
  openOverlay(`
    <div class="sig-top"><button class="avatar-btn" data-profile="${esc(sig.trader_id)}" aria-label="${esc(name)}">${avatarImg(name, sig.trader_id, tr.trader_avatar_url, 'avatar-sm')}</button><div class="who"><button class="name" data-profile="${esc(sig.trader_id)}">${esc(name)}${demoBadge(sig.trader_id)}</button><div class="mt">${esc(fmtRel(sig.created_at))}</div></div><span class="spacer"></span><span class="pill">Level ${level} · ${esc(levelName(level, getLang()))}</span>${verified}${statusPill(sig.status)}${editedBadge}</div>
    ${dupHtml}
    <div class="sig-main"><span class="sig-pair sig-pair-lg">${pairHtml(sig.pair)}</span><span class="dir ${dirCls}">${esc(sig.direction)}</span><span class="spacer"></span>${lockNote ? `<span class="det-lock-note">${lockNote}</span>` : ''}</div>
    ${rowsHtml}
    ${progHtml}
    ${actions.length ? `<div class="detail-actions">${actions.join('')}</div>` : ''}`);
  const closeBtn2 = $('#ov-close2');
  if (closeBtn2) closeBtn2.onclick = closeOverlay;
  const copyBtn = $('#ov-copy');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      if (await copySignalText(sig.id)) { copyBtn.innerHTML = ICONS.check + ' ' + t('copied'); paintCopyButtons(sig.id); }
    };
  }
  const shareBtn = $('#ov-share');
  if (shareBtn) shareBtn.onclick = () => downloadShareCard(sig);
  const traderBtn = $('#ov-trader');
  if (traderBtn) {
    traderBtn.onclick = () => {
      closeOverlay();
      openTraderProfile(sig.trader_id);
    };
  }
  $$('#overlay-sheet [data-profile]').forEach((b) => {
    b.addEventListener('click', () => { closeOverlay(); openTraderProfile(b.dataset.profile); });
  });
}

// ------------------------------------------------- renderer statistik ---
// Dipakai profil trader, statistik Trader, dan jurnal follower.
// Semua angka dari sinyal tertutup nyata (js/stats.js); yang belum bisa
// dihitung tampil "—".
function statsGridHtml(s) {
  const wr = s.wr === null ? '—' : ds(s.wr.toFixed(1)) + '%';
  const sk = s.streaks;
  // R26: definisi "ada trade tertutup" sama dengan statistik Trader
  // (has = st.closed > 0). Tanpa trade tertutup, Total
  // Profit + Total R menampilkan "—" netral, bukan 0 hijau.
  // R34 (audit B-2): sufiks jumlah pips ("+20 pips" / "0 pips") hanya
  // tampil bila ada trade tertutup — di bawah sel "—", "0 pips" adalah
  // angka yang mengada-ada; labelnya saja yang tersisa.
  const has = (s.closed || 0) > 0;
  return `<div class="pstats">`
    + `<div class="stat-cell"><div class="num mono">${wr}</div><div class="lbl">${esc(t('stWinRate'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.totalSignals}</div><div class="lbl">${esc(t('stTotalSignalsOpen', { n: s.active }))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${has && s.totalUSD > 0 ? 'pips-pos' : has && s.totalUSD < 0 ? 'pips-neg' : ''}">${has ? esc(fmtUsd(s.totalUSD, true)) : '—'}</div><div class="lbl">${esc(t('stTotalProfit'))}${has ? ' ' + esc(fmtPipsSigned(s.totalPips)) : ''}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${fmtPf(s.pf)}</div><div class="lbl">${esc(t('stProfitFactor'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${has && s.totalR > 0 ? 'pips-pos' : has && s.totalR < 0 ? 'pips-neg' : ''}">${has ? esc(fmtR(s.totalR)) : '—'}</div><div class="lbl">${esc(t('stTotalR'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.avgR === null ? '—' : esc(fmtR(s.avgR))}</div><div class="lbl">${esc(t('stAvgR'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${sk.longestWin ? 'pips-pos' : ''}">${sk.longestWin || '—'}</div><div class="lbl">${esc(t('stStreakWinLong'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${sk.longestLose ? 'pips-neg' : ''}">${sk.longestLose || '—'}</div><div class="lbl">${esc(t('stStreakLoseLong'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono ${s.drawdown.usd > 0 ? 'pips-neg' : ''}">${s.drawdown.usd > 0 ? '-' + esc(fmtUsd(s.drawdown.usd)) : '—'}</div><div class="lbl">${esc(t('stMaxDD'))}${s.drawdown.usd > 0 ? ` (${s.drawdown.pct.toFixed(1)}%)` : ''}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${fmtRf(s.recovery)}</div><div class="lbl">${esc(t('stRecovery'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${fmtHold(s.avgHold)}</div><div class="lbl">${esc(t('stHoldAvg'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.rr === null ? '—' : '1:' + s.rr.toFixed(1)}</div><div class="lbl">${esc(t('stRRAvg'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.avgSL === null ? '—' : s.avgSL.toFixed(1)}</div><div class="lbl">${esc(t('stAvgSL'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.avgTP === null ? '—' : s.avgTP.toFixed(1)}</div><div class="lbl">${esc(t('stAvgTP'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono">${s.wins}W / ${s.losses}L</div><div class="lbl">${esc(t('stWinLose'))}</div></div>`
    + `<div class="stat-cell"><div class="num mono" style="font-size:14px">${s.perPair.filter((e) => e.trades > 0).map((e) => e.pair).join(', ') || '—'}</div><div class="lbl">${esc(t('stPostedPairs'))}</div></div>`
    + `</div>`;
}
// R51: grafik Akumulasi profit Arah A — garis kumulatif + label sumbu Y ($),
// label tanggal sumbu X (tanggal sama dikelompokkan), titik per trade yang
// bisa diklik, label nilai akhir, filter tahunan. Teks dibuat sebagai HTML
// (bukan di dalam SVG) supaya tidak terdistorsi saat kartu melebar/menyempit;
// SVG hanya garis + area. points = [{profit, date}] kronologis SATU tahun.
function chartDateLabel(iso) {
  try {
    return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'id-ID', {
      day: 'numeric', month: 'short',
    }).format(new Date(iso));
  } catch (e) { return ''; }
}
function chartYearOf(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}
function resolveChartYear(points) {
  const years = [...new Set((points || []).map((p) => chartYearOf(p.date)).filter((y) => y !== null))].sort((a, b) => a - b);
  const nowYear = new Date().getFullYear();
  if (years.length === 0) { S.chartYear = nowYear; return { years: [], year: nowYear }; }
  if (S.chartYear === null || !years.includes(S.chartYear)) S.chartYear = years[years.length - 1];
  return { years, year: S.chartYear };
}
function accumChartSVG(points, selIdx) {
  const n = points.length;
  const cum = [0];
  for (const p of points) cum.push(cum[cum.length - 1] + p.profit);
  const min = Math.min(...cum, 0);
  const max = Math.max(...cum, 0);
  const span = (max - min) || 1;
  const PLOT_W = 480, PLOT_H = 114;
  const px = (i) => (i / n) * PLOT_W;
  const py = (v) => (1 - (v - min) / span) * PLOT_H;
  const up = cum[n] >= 0;
  const color = up ? 'var(--buy)' : 'var(--sell)';
  const line = cum.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `0,${PLOT_H} ${line} ${PLOT_W},${PLOT_H}`;
  // Label sumbu Y: max / 0 / min — dedup bila dua label berhimpit (<9px).
  const yRows = [];
  for (const v of [max, 0, min]) {
    const y = py(v);
    if (yRows.some((r) => Math.abs(r.y - y) < 9)) continue;
    yRows.push({ v, y });
  }
  const grid = yRows.map((r) => `<line x1="0" x2="${PLOT_W}" y1="${r.y.toFixed(1)}" y2="${r.y.toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`).join('');
  const yLabels = yRows.map((r) => `<div style="position:absolute;left:0;top:${(r.y / PLOT_H * 100).toFixed(2)}%;transform:translateY(-50%);width:62px;text-align:right;font-size:11px;color:var(--muted)" class="mono">${esc(fmtUsd(r.v))}</div>`).join('');
  // Label sumbu X: trade berurutan dengan tanggal sama jadi SATU label di
  // tengah kelompok; bila kelompok > 6, tipiskan merata jadi ≤6 label.
  const groups = [];
  for (let j = 0; j < n; j++) {
    const lbl = chartDateLabel(points[j].date);
    const g = groups[groups.length - 1];
    if (g && g.label === lbl) g.end = j; else groups.push({ label: lbl, start: j, end: j });
  }
  let shown = groups;
  if (shown.length > 6) { const step = Math.ceil(shown.length / 6); shown = shown.filter((_, i) => i % step === 0); }
  const xLabels = shown.map((g) => {
    const mid = (px(g.start + 1) + px(g.end + 1)) / 2;
    const pct = Math.max(3, Math.min(97, (mid / PLOT_W) * 100));
    return `<div style="position:absolute;left:${pct.toFixed(2)}%;bottom:0;transform:translateX(-50%);font-size:11px;color:var(--muted);white-space:nowrap">${esc(g.label)}</div>`;
  }).join('');
  // Titik per trade: tombol asli (bisa diklik + keyboard) di atas plot.
  const dots = points.map((p, j) => {
    const cx = (px(j + 1) / PLOT_W) * 100;
    const cy = (py(cum[j + 1]) / PLOT_H) * 100;
    const sel = j === selIdx;
    return `<button type="button" class="chart-dot${sel ? ' sel' : ''}" data-chart-idx="${j}" style="left:${cx.toFixed(2)}%;top:${cy.toFixed(2)}%;background:${color}" aria-label="${esc(fmtDateShort(p.date))} · ${esc(fmtUsd(p.profit))}"></button>`;
  }).join('');
  // Label nilai akhir di dekat titik terakhir (di bawah bila terlalu dekat
  // ke atas, di atas bila tidak).
  const endY = py(cum[n]);
  const endTop = Math.max(3, Math.min(97, ((endY < 24 ? endY + 16 : endY - 16) / PLOT_H) * 100));
  const endLabel = `<div style="position:absolute;right:0;top:${endTop.toFixed(2)}%;transform:translateY(-50%);font-size:12px;font-weight:700;color:${color}" class="mono">${esc(fmtUsd(cum[n]))}</div>`;
  return `<div class="chart-plot" style="position:relative;height:150px;margin-top:10px">`
    + `<div style="position:absolute;left:68px;right:12px;top:14px;bottom:22px">`
    + `<svg width="100%" height="100%" viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" aria-hidden="true">${grid}<polygon points="${area}" fill="${color}" opacity="0.12"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`
    + dots + endLabel
    + `</div>`
    + `<div style="position:absolute;left:0;width:62px;top:14px;bottom:22px">${yLabels}</div>`
    + `<div style="position:absolute;left:68px;right:12px;bottom:0;height:18px">${xLabels}</div>`
    + `</div>`;
}
function chartDetailHtml(points, selIdx) {
  const p = points[selIdx];
  let cum = 0;
  for (let j = 0; j <= selIdx; j++) cum += points[j].profit;
  const cls = (v) => (v > 0 ? 'pips-pos' : v < 0 ? 'pips-neg' : '');
  const cell = (label, val, c) => `<div class="stat-cell"><div class="num mono ${c}">${val}</div><div class="lbl">${esc(label)}</div></div>`;
  return `<div class="pstats" style="margin-top:12px">`
    + cell(t('stChartDate'), esc(fmtDateShort(p.date)), '')
    + cell(t('stChartTradeProfit'), esc(fmtUsd(p.profit)), cls(p.profit))
    + cell(t('stChartCum'), esc(fmtUsd(cum)), cls(cum))
    + `</div>`;
}
function chartCardHtml(s, surface) {
  const points = s.chartPoints || [];
  const { years, year } = resolveChartYear(points);
  const yearPts = points.filter((p) => chartYearOf(p.date) === year);
  const total = yearPts.reduce((a, p) => a + p.profit, 0);
  const unit = yearPts.length === 1 ? 'trade' : t('stThTrades').toLowerCase();
  const totalCls = total > 0 ? 'pips-pos' : total < 0 ? 'pips-neg' : '';
  const yearOpts = years.length ? years.map((y) => [y, String(y)]) : [[year, String(year)]];
  const yearField = `<div class="field" style="max-width:180px;margin:12px 0 0"><label>${esc(t('ppmYearLabel'))}</label>${dropdownHtml('chart-year-' + surface, yearOpts, year)}</div>`;
  const totalLine = `<div style="margin-top:12px;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap"><span style="font-size:15px;font-weight:700">${esc(t('stChartTotal', { year }))}:</span><b class="mono ${totalCls}" style="font-size:22px">${esc(fmtUsd(total))}</b><span style="color:var(--muted);font-size:13px">· ${yearPts.length} ${unit}</span></div>`;
  let inner;
  if (yearPts.length < 2) {
    inner = `<div class="empty" style="padding:24px 12px;"><strong>${esc(t('stChartEmpty'))}</strong></div>`;
  } else {
    const sel = Math.max(0, Math.min(S.chartPoint ?? yearPts.length - 1, yearPts.length - 1));
    inner = accumChartSVG(yearPts, sel) + chartDetailHtml(yearPts, sel);
  }
  return `<div class="chart-card" id="chart-card-${surface}"><h3>${esc(t('stChartTitle'))}</h3><div class="sub">${esc(t('stChartSub'))}</div>${yearField}${totalLine}${inner}</div>`;
}
// R51: ikat dropdown tahun grafik + klik/keyboard titik; ganti tahun →
// render ulang permukaan (akumulasi mulai dari 0 di tahun baru, titik
// terpilih direset ke titik terakhir).
function bindChartYear(surface, rerender) {
  bindDropdown('chart-year-' + surface);
  const hidden = document.getElementById('chart-year-' + surface);
  if (hidden) hidden.addEventListener('change', () => {
    S.chartYear = Number(hidden.value) || null;
    S.chartPoint = null;
    rerender();
  });
  const card = document.getElementById('chart-card-' + surface);
  if (card) {
    card.addEventListener('click', (e) => {
      const dot = e.target.closest('[data-chart-idx]');
      if (!dot) return;
      S.chartPoint = Number(dot.dataset.chartIdx);
      rerender();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const dot = e.target.closest('[data-chart-idx]');
      if (!dot) return;
      e.preventDefault();
      S.chartPoint = Number(dot.dataset.chartIdx);
      rerender();
    });
  }
}
// R29: tahun terpilih untuk tabel Profit Per Month (state global S.monthYear).
// Daftar tahun = tahun-tahun yang ada di s.months (urut naik). Default =
// tahun terbaru yang ada datanya; bila tidak ada data sama sekali, tahun
// berjalan. Bila tahun yang tersimpan tidak ada di data (mis. pindah
// permukaan ke trader lain), dijepit ke tahun terbaru yang ada.
function resolveMonthYear(months) {
  const years = [...new Set((months || []).map((e) => e.year))].sort((a, b) => a - b);
  const nowYear = new Date().getFullYear();
  if (years.length === 0) { S.monthYear = nowYear; return { years: [], year: nowYear }; }
  if (S.monthYear === null || !years.includes(S.monthYear)) S.monthYear = years[years.length - 1];
  return { years, year: S.monthYear };
}
function monthNameShort(year, month) {
  return new Date(year, month, 1).toLocaleString(getLang() === 'en' ? 'en-US' : 'id-ID', { month: 'short' });
}
function monthTableHtml(months, surface) {
  const { years, year } = resolveMonthYear(months);
  const now = new Date();
  // Tahun lampau: Januari s.d. Desember. Tahun berjalan: Januari s.d.
  // bulan berjalan (bulan depan tidak tampil).
  const lastMonth = year < now.getFullYear() ? 11 : now.getMonth();
  const byKey = {};
  for (const e of months || []) byKey[e.year + '-' + e.month] = e;
  const rows = [];
  for (let m = 0; m <= lastMonth; m++) rows.push(byKey[year + '-' + m] || null);
  // Ringkasan tahunan: total, rata-rata per bulan yang ditampilkan, bulan
  // terbaik/terburuk di antara bulan yang ada trade-nya. Tanpa trade: "—".
  const withTrades = rows.filter(Boolean);
  const has = withTrades.length > 0;
  const total = withTrades.reduce((a, e) => a + e.profit, 0);
  const avg = has ? total / rows.length : null;
  let best = null, worst = null;
  for (const e of withTrades) {
    if (!best || e.profit > best.profit) best = e;
    if (!worst || e.profit < worst.profit) worst = e;
  }
  const profitCls = (v) => (v > 0 ? 'pips-pos' : v < 0 ? 'pips-neg' : '');
  const sumCell = (label, val, cls) => `<div class="stat-cell"><div class="num mono ${cls}">${val}</div><div class="lbl">${esc(label)}</div></div>`;
  const summary = `<div class="pstats" style="margin-top:12px">`
    + sumCell(t('ppmSumTotal'), has ? esc(fmtUsd(total)) : '—', has ? profitCls(total) : '')
    + sumCell(t('ppmSumAvg'), has ? esc(fmtUsd(avg)) : '—', has ? profitCls(avg) : '')
    + sumCell(t('ppmSumBest') + (best ? ' · ' + monthNameShort(best.year, best.month) : ''), best ? esc(fmtUsd(best.profit)) : '—', best ? profitCls(best.profit) : '')
    + sumCell(t('ppmSumWorst') + (worst ? ' · ' + monthNameShort(worst.year, worst.month) : ''), worst ? esc(fmtUsd(worst.profit)) : '—', worst ? profitCls(worst.profit) : '')
    + `</div>`;
  const body = (months || []).length === 0
    ? `<tr><td colspan="5" style="color:var(--muted)">${esc(t('ppmNoTrades'))}</td></tr>`
    : rows.map((e, m) => {
        const mName = new Date(year, m, 1).toLocaleString(getLang() === 'en' ? 'en-US' : 'id-ID', { month: 'long', year: 'numeric' });
        // R26: bulan tanpa trade tertutup tampil "—" (bukan $0.00).
        if (!e) return `<tr><td class="mono" style="font-weight:700">${esc(mName)}</td><td class="num mono">—</td><td class="num mono">—</td><td class="num mono">0</td><td class="num mono">—</td></tr>`;
        return `<tr><td class="mono" style="font-weight:700">${esc(mName)}</td>`
          + `<td class="num mono ${e.profit >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtUsd(e.profit))}</td>`
          + `<td class="num mono ${e.pips >= 0 ? 'pips-pos' : 'pips-neg'}">${e.pips >= 0 ? '+' : ''}${Math.round(e.pips)}</td>`
          + `<td class="num mono">${e.trades}</td>`
          + `<td class="num mono">${e.wr === null ? '—' : ds(e.wr.toFixed(1)) + '%'}</td></tr>`;
      }).join('');
  const yearOpts = years.length ? years.map((y) => [y, String(y)]) : [[year, String(year)]];
  return `<div class="chart-card"><h3>${esc(t('stMonthTitle'))}</h3><div class="sub">${esc(t('stMonthSub'))}</div>`
    + `<div class="field" style="max-width:180px;margin:12px 0 0"><label>${esc(t('ppmYearLabel'))}</label>${dropdownHtml('month-year-' + surface, yearOpts, year)}</div>`
    + summary
    + `<div class="board-wrap" style="box-shadow:none"><table class="board"><thead><tr><th>${esc(t('stThMonth'))}</th><th class="num">${esc(t('stThProfit'))}</th><th class="num">${esc(t('stThPips'))}</th><th class="num">${esc(t('stThTrades'))}</th><th class="num">${esc(t('stThWR'))}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
// R29: ikat pemilih tahun tabel Profit Per Month; ganti tahun → render ulang permukaan.
function bindMonthYear(surface, rerender) {
  bindDropdown('month-year-' + surface);
  const hidden = document.getElementById('month-year-' + surface);
  if (hidden) hidden.addEventListener('change', () => {
    S.monthYear = Number(hidden.value) || null;
    rerender();
  });
}
function pairTableHtml(s, subKey = 'stPairSub') {
  const rows = s.perPair.filter((e) => e.trades > 0);
  const body = rows.length ? rows.map((e) => {
    const sk = e.streaks;
    const longTxt = (sk.longestWin || sk.longestLose) ? `${sk.longestWin}W / ${sk.longestLose}L` : '—';
    return `<tr><td class="mono" style="font-weight:700">${esc(e.pair)}</td>`
      + `<td class="num mono">${e.trades}</td>`
      + `<td class="num mono">${e.wr === null ? '—' : ds(e.wr.toFixed(1)) + '%'}</td>`
      + `<td class="num mono ${e.totalUSD >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtUsd(e.totalUSD, true))}</td>`
      + `<td class="num mono">${fmtPf(e.pf)}</td>`
      + `<td class="num mono ${e.totalR >= 0 ? 'pips-pos' : 'pips-neg'}">${esc(fmtR(e.totalR))}</td>`
      + `<td class="num mono">${e.avgR === null ? '—' : esc(fmtR(e.avgR))}</td>`
      + `<td class="num mono">${e.avgSL === null ? '—' : ds(e.avgSL.toFixed(1))}</td>`
      + `<td class="num mono">${e.avgTP === null ? '—' : ds(e.avgTP.toFixed(1))}</td>`
      + `<td class="num mono">${longTxt}</td>`
      + `<td class="num mono pips-neg">${e.drawdown.usd > 0 ? '-' + esc(fmtUsd(e.drawdown.usd)) + ` (${e.drawdown.pct.toFixed(1)}%)` : '—'}</td>`
      + `<td class="num mono">${fmtRf(e.recovery)}</td>`
      + `<td class="num mono">${fmtHold(e.avgHold)}</td></tr>`;
  }).join('') : `<tr><td colspan="13" style="color:var(--muted)">${esc(t('ppNoTrades'))}</td></tr>`;
  return `<div class="chart-card"><h3>${esc(t('stPairTitle'))}</h3><div class="sub">${esc(t(subKey))}<span class="estbadge">${esc(t('estBadge'))}</span> <button class="guidelink" type="button" data-guide="risk">${esc(t('sigDetail'))} ${ICONS.arrow}</button></div>`
    + `<div class="board-wrap pair-board" style="box-shadow:none"><table class="board"><thead><tr><th>${esc(t('stThPair'))}</th><th class="num">${esc(t('stThTrades'))}</th><th class="num">${esc(t('stThWR'))}</th><th class="num">${esc(t('stThProfit'))}</th><th class="num">${esc(t('stThPF'))}</th><th class="num">${esc(t('stThTotalR'))}</th><th class="num">${esc(t('stThAvgR'))}</th><th class="num">${esc(t('stThAvgSL'))}</th><th class="num">${esc(t('stThAvgTP'))}</th><th class="num">${esc(t('stThStreak'))}</th><th class="num">${esc(t('stThMaxDD'))}</th><th class="num">${esc(t('stThRecovery'))}</th><th class="num">${esc(t('stThHold'))}</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}
// Ronde 36: parameter monthSurface wajib diisi pemanggil (dulu default
// 'jurnal' — permukaan itu dihapus bersama tab Jurnal follower).
function statsSectionHtml(s, titleKey, subKey = null, afterGridHtml = '', monthSurface) {
  return `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t(titleKey))}</h2>`
    + (subKey ? `<p class="sub">${esc(t(subKey))}</p>` : '')
    + (s.closed === 0 ? `<div class="empty"><strong>${esc(t('stNoTrades'))}</strong></div>` : '')
    + statsGridHtml(s)
    + afterGridHtml
    + chartCardHtml(s, monthSurface)
    + monthTableHtml(s.months, monthSurface)
    + pairTableHtml(s);
}
export function fmtDateShort(iso) {
  try {
    return new Intl.DateTimeFormat(getLang() === 'en' ? 'en-US' : 'id-ID', {
      day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(iso));
  } catch (e) { return String(iso || ''); }
}
// Baris jurnal 2 baris (seperti prototipe): baris 1 "diposting {rel} · lot
// {lot}", baris 2 timeline tanggal absolut (Diposting / Entry tersentuh /
// TP-SL tersentuh).
function journalRowHtml(sig, opts = {}) {
  const d = decimalsForPair(sig.pair);
  const dirCls = sig.direction === 'BUY' ? 'buy' : 'sell';
  const resCls = sig.status === 'WIN' ? 'pips-pos' : 'pips-neg';
  // D14 (r30b): salinan follower — AKTIF menampilkan floating, PENDING
  // "—" (belum ada hasil, pola Ronde 26); hasil tertutup bertanda (D13).
  let res;
  if (opts.isCopy && sig.status === 'PENDING') {
    res = '—';
  } else if (opts.isCopy && sig.status === 'AKTIF') {
    // R61: salinan sinyal terkunci (entry NULL dari view) — floating tidak
    // bisa dihitung (entry 0 akan menghasilkan angka palsu); tampil '—'.
    const fl = sig.entry == null ? null : floatingUsd(sig);
    res = esc(t('jrnlFloating', { amt: fl !== null ? fmtUsd0(fl) : '—' }));
  } else {
    res = `${sig.profit_usd !== null && sig.profit_usd !== undefined ? fmtUsd0(sig.profit_usd) : '—'}`
      + `${sig.profit_pips !== null && sig.profit_pips !== undefined ? ` · ${fmtPipsSigned(sig.profit_pips)}` : ''}`
      + `${sig.r_value !== null && sig.r_value !== undefined ? ` · ${fmtRShort(sig.r_value)}` : ''}`;
  }
  const traderName = opts.showTrader ? (() => { const tr = traderOf(sig); return esc(traderHandle(tr)) + ' · '; })() : '';
  // D13: timeline tanggal + jam (bukan tanggal saja).
  const timeline = `${esc(t('detPosted'))} ${esc(fmtDate(sig.created_at))}`
    + (sig.activated_at ? ` · ${esc(t('dtEntry'))} ${esc(fmtDate(sig.activated_at))}` : '')
    + (sig.closed_at ? ` · ${esc(sig.status === 'WIN' ? t('dtTP') : t('dtSL'))} ${esc(fmtDate(sig.closed_at))}` : '');
  // Ronde 8b (c): waktu "disalin" memakai created_at baris copies (waktu
  // salin), bukan created_at sinyal — seperti prototipe journalRow
  // (myCopies[s.id].ago).
  // R61: lot NULL (salinan sinyal terkunci) tampil '—', bukan "0.00".
  const lotTxt = sig.lot_size == null ? '—' : fmtNum(sig.lot_size, 2);
  const postedTxt = opts.isCopy
    ? t('jrnlCopiedAgo', { ago: fmtRel(opts.copyCreatedAt || sig.created_at), lot: lotTxt })
    : t('myJrnlPosted', { ago: fmtRel(sig.created_at), lot: lotTxt });
  // D13: tombol Bagikan untuk sinyal sendiri. D14: tombol hapus salinan
  // (non-AKTIF saja; AKTIF menampilkan ikon nonaktif + catatan).
  // R19: tombol Bagikan hanya untuk sinyal selesai (WIN/LOSS). Riwayat
  // profil memang sudah hanya berisi WIN/LOSS — gerbang ini pertahanan
  // berlapis bila pemanggil berubah.
  let extraBtns = '';
  if (opts.mine && (sig.status === 'WIN' || sig.status === 'LOSS')) {
    extraBtns += `<button class="iconbtn" type="button" data-jshare="${esc(sig.id)}" aria-label="${esc(t('sigShareDownload'))}" style="width:34px;height:34px;font-size:14px;">${ICONS.download}</button>`;
  }
  if (opts.isCopy && opts.copyId) {
    if (sig.status === 'AKTIF') {
      extraBtns += `<button class="iconbtn" type="button" disabled title="${esc(t('jrnlNoDeleteActive'))}" style="width:34px;height:34px;font-size:14px;">${ICONS.trash}</button>`;
    } else {
      extraBtns += `<button class="iconbtn trashbtn" type="button" data-uncopy="${esc(opts.copyId)}" aria-label="${esc(t('uncopyBtn'))}" style="width:34px;height:34px;font-size:14px;">${ICONS.trash}</button>`;
    }
  }
  return `<div class="hist-row"><span class="p mono">${esc(sig.pair)}</span>`
    + `<span class="dir ${dirCls}" style="font-size:11px;padding:3px 9px">${esc(sig.direction)}</span>`
    + `<span style="color:var(--muted)">${traderName}${esc(postedTxt)}</span>`
    + `<span class="pill ${sig.status === 'WIN' ? 'green' : sig.status === 'LOSS' ? 'red' : ''}">${esc(sig.status)}</span>`
    + `<span class="res mono ${resCls}">${res}</span>`
    + `<button class="btn" type="button" data-jdetail="${esc(sig.id)}" style="min-height:34px;padding:6px 12px;font-size:12.5px;">${esc(t('sigDetail'))}</button>`
    + extraBtns
    + `<div class="hist-detail">${timeline}</div>`
    + `</div>`;
}
function bindJournalRows(root) {
  $$('[data-jdetail]', root).forEach((b) => {
    b.addEventListener('click', () => openSignalDetail(b.dataset.jdetail));
  });
  $$('[data-jshare]', root).forEach((b) => {
    b.addEventListener('click', () => {
      const sg = findSignal(b.dataset.jshare);
      if (sg) downloadShareCard(sg);
    });
  });
  $$('[data-uncopy]', root).forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        const copyId = b.dataset.uncopy;
        // R24 item 5: konfirmasi dulu sebelum hapus — penghapusan langsung
        // tanpa dialog pernah jadi laporan user (09:05 WIB).
        const copy = S.myCopies.find((c) => c.id === copyId);
        const sig = copy ? findSignal(copy.signal_id) : null;
        const yes = await confirmDialog(t('confirmUncopyTitle'), t('confirmUncopyBody', { sig: sig ? `${sig.pair} ${sig.direction} ${sig.entry ?? '—'}` : '—' }), t('yesDelete'));
        if (!yes) return;
        // Ronde 8b (a): hapus salinan dari state lokal SEBELUM render
        // ulang — kalau tidak, kartu sinyal tetap menampilkan
        // "Sudah disalin" karena S.copiedIds masih berisi id sinyalnya.
        await api.uncopy(copyId);
        if (copy) S.copiedIds.delete(copy.signal_id);
        S.myCopies = S.myCopies.filter((c) => c.id !== copyId);
        toast(t('jrnlDeleted'));
        if (S.view === 'office-trader') await renderTraderWork();
        else if (S.view === 'office-follower') await renderFollowerWork();
        renderHomeList(); // kartu feed ikut diperbarui tanpa reload
      } catch (e) {
        toast(t('errNetwork'), true);
      }
    });
  });
}

// -------------------------------------------------------------- Beranda ---
function renderHomeFilters() {
  const box = $('#home-filters');
  if (!box) return;
  // Strip pair sendiri (scroll horizontal, tanpa tombol geser) lalu
  // baris status terpisah di bawahnya — seperti prototipe.
  // Daftar pair = PAIR_LIST prototipe (8 pair + "Semua pair" = 9 chip).
  const pairs = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD', 'USDCHF', 'NZDUSD', 'USDCAD', 'EURJPY', 'EURGBP']; // B2-09: 11 pair (sama dengan form + is_allowed_pair)
  const f = S.feedFilter;
  const strip = box.querySelector('#pair-strip');
  const keepX = strip ? strip.scrollLeft : 0;
  let html = '<div class="feed-filters">';
  html += '<div class="pair-strip" id="pair-strip">';
  html += `<button class="fchip" type="button" data-fpair="ALL" aria-pressed="${f.pair === 'ALL'}">${esc(t('feedAllPairs'))}</button>`;
  for (const p of pairs) {
    html += `<button class="fchip" type="button" data-fpair="${esc(p)}" aria-pressed="${f.pair === p}">${esc(p)}</button>`;
  }
  html += '</div>';
  html += '<span class="filter-break" aria-hidden="true"></span>';
  // Ronde 22: status jadi segmented control ala preview (wadah abu-abu,
  // yang terpilih kartu putih) + opsi Selesai (WIN/LOSS) seperti preview.
  html += '<div class="seg" role="group">';
  html += `<button class="fchip" type="button" data-fstatus="ALL" aria-pressed="${f.status === 'ALL'}">${esc(t('feedAllStatus'))}</button>`;
  html += `<button class="fchip" type="button" data-fstatus="AKTIF" aria-pressed="${f.status === 'AKTIF'}">${esc(t('tabActive'))}</button>`;
  html += `<button class="fchip" type="button" data-fstatus="PENDING" aria-pressed="${f.status === 'PENDING'}">${esc(t('tabPending'))}</button>`;
  html += `<button class="fchip" type="button" data-fstatus="SELESAI" aria-pressed="${f.status === 'SELESAI'}">${esc(t('feedDone'))}</button>`;
  html += '</div>';
  html += '</div>';
  box.innerHTML = html;
  const strip2 = box.querySelector('#pair-strip');
  if (strip2) {
    strip2.scrollLeft = keepX;
    // R9-3: roda mouse vertikal digeser ke scroll horizontal strip. Tanpa
    // handler ini roda hanya menggeser halaman, strip diam (scrollbar
    // disembunyikan, tidak ada affordance lain). Bila strip sudah di ujung
    // arah gulir, event dibiarkan lolos agar halaman tetap bisa di-scroll.
    // (Geser jari sudah bekerja lewat overflow-x: auto.)
    strip2.addEventListener('wheel', (ev) => {
      if (!ev.deltaY) return; // gulir horizontal murni — ditangani native
      const canLeft = strip2.scrollLeft > 0;
      const canRight = strip2.scrollLeft + strip2.clientWidth < strip2.scrollWidth - 1;
      if ((ev.deltaY > 0 && canRight) || (ev.deltaY < 0 && canLeft)) {
        ev.preventDefault();
        strip2.scrollLeft += ev.deltaY;
      }
    }, { passive: false });
    // R20: seret mouse (drag) untuk menggeser strip. Roda saja tidak
    // cukup — pengguna desktop yang mencoba menyeret strip sebelumnya
    // tidak terjadi apa-apa (tidak ada handler drag). Hanya pointer mouse;
    // sentuh tetap memakai scroll native (overflow-x: auto).
    // R20b: JANGAN setPointerCapture di sini — capture me-retarget event
    // click ke strip sehingga handler klik chip tidak pernah jalan (klik
    // chip pair mati; terbukti probe: pointerdown menarget chip, lalu
    // pointerup + click menarget div#pair-strip). Sebagai gantinya,
    // pointermove/pointerup dipasang di window selama drag (pola standar):
    // event click tetap menarget chip, dan drag tetap berlanjut walau
    // pointer keluar strip.
    let dragX = null, dragScroll = 0, dragged = false;
    const onDragMove = (ev) => {
      if (dragX === null || ev.pointerType !== 'mouse') return;
      const dx = ev.clientX - dragX;
      if (Math.abs(dx) > 5) dragged = true;
      strip2.scrollLeft = dragScroll - dx;
    };
    const endDrag = () => {
      dragX = null;
      strip2.classList.remove('dragging');
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      // Bila seret berakhir tanpa click yang menelan flag (mis. dilepas
      // di luar strip), bersihkan flag setelah jeda singkat agar klik chip
      // berikutnya tidak ikut tertelan.
      if (dragged) setTimeout(() => { dragged = false; }, 150);
    };
    strip2.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'mouse') return;
      dragX = ev.clientX; dragScroll = strip2.scrollLeft; dragged = false;
      strip2.classList.add('dragging');
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    });
    // Bila habis diseret, klik chip yang terpicu di bawah pointer harus
    // dibatalkan (kalau tidak, seret malah memfilter pair).
    strip2.addEventListener('click', (ev) => {
      if (dragged) { ev.preventDefault(); ev.stopPropagation(); dragged = false; }
    }, true);
  }
  $$('[data-fpair]', box).forEach((b) => {
    b.addEventListener('click', () => { S.feedFilter.pair = b.dataset.fpair; renderHomeList(); renderHomeFilters(); });
  });
  $$('[data-fstatus]', box).forEach((b) => {
    b.addEventListener('click', () => { S.feedFilter.status = b.dataset.fstatus; renderHomeList(); renderHomeFilters(); });
  });
}
function homeFilteredSignals() {
  const f = S.feedFilter;
  const rank = (st) => (st === 'PENDING' ? 0 : st === 'AKTIF' ? 1 : 2);
  return S.homeSignals
    // B1-03: saat filter pair aktif, sinyal terkunci disembunyikan — pair
    // sinyal terkunci memang tidak ditampilkan, jadi tidak boleh ikut filter.
    .filter((s) => (f.pair === 'ALL' || (s.pair === f.pair && !isLockedForMe(s)))
      && (f.status === 'ALL' || s.status === f.status
        || (f.status === 'SELESAI' && (s.status === 'WIN' || s.status === 'LOSS'))))
    .sort((a, b) => (rank(a.status) - rank(b.status))
      || (new Date(b.created_at) - new Date(a.created_at)));
}
function renderHomeList() {
  const list = $('#home-list');
  if (!list) return;
  const rows = homeFilteredSignals();
  if (rows.length === 0) {
    list.innerHTML = `<div class="empty">${t('feedEmpty')}</div>`;
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
function traderCardHtml(tr, rank, badge) {
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : '';
  const st = statsForTrader(tr.profile_id);
  const ddUsd = (st.drawdown && st.drawdown.usd) || 0; // R16: Max DD kartu Cari
  const price = tr.subscription_price_usd;
  // D34: lencana langganan dalam IDR (fmtIDR prototipe).
  const subBadge = price !== null && price !== undefined && Number(price) > 0
    ? `${esc(t('subscribe'))} ${esc(fmtIdr(price))}${esc(t('perMonth'))}`
    : esc(t('profFree'));
  // R17: lencana tab — HANYA di tab Diikuti/Langganan (kartu Traders
  // tidak berubah, sesuai Ronde 16).
  const badgeHtml = badge === 'followed' ? `<span class="pill">${esc(t('followed'))}</span>`
    : badge === 'subscribed' ? `<span class="pill gold">${esc(t('subscribed'))}</span>` : '';
  const handle = traderHandle(tr); // publik: hanya @username (ronde 5)
  const folN = S.followerCounts[tr.profile_id];
  // R34 (audit B-1/S-3): pola "—" Ronde 26 — trader tanpa trade tertutup
  // tidak menampilkan "$0.00" / "0R" mentah di kartu (WR + Max DD sudah
  // "—" sejak dulu; Total Profit + Total R disamakan di sini).
  const has = st.closed > 0;
  return `<article class="tcard" data-trader="${esc(tr.profile_id)}" tabindex="0" role="button">
    <div class="head">
      <span class="rank-num${rank <= 3 ? ' top' : ''}">${rank}</span>
      ${avatarImg(handle, tr.profile_id, tr.trader_avatar_url, 'avatar')}
      <div style="min-width:0; flex:1;">
        <div class="n">${esc(handle)}${verified}${demoBadge(tr.profile_id)}</div>
      </div>
      <span class="lvlbadge">Level ${level} · ${esc(levelName(level, getLang()))}</span>
    </div>
    <div class="mini">
      <div class="mini-row r1">
        <div class="cell hero"><div class="v">${has ? esc(fmtUsd(st.totalUSD)) : '—'}</div><div class="k">${esc(t('stTotalProfitUSD'))}</div></div>
        <div class="cell"><div class="v">${st.totalSignals}</div><div class="k">${esc(t('stSignals'))}</div></div>
        <div class="cell"><div class="v">${st.wr === null ? '—' : st.wr.toFixed(0) + '%'}</div><div class="k">${esc(t('stWinRate'))}</div></div>
      </div>
      <div class="mini-row r2">
        <div class="cell"><div class="v ${has && st.totalR > 0 ? 'pips-pos' : has && st.totalR < 0 ? 'pips-neg' : ''}">${has ? esc(fmtR(st.totalR)) : '—'}</div><div class="k">${esc(t('stTotalRNet'))}</div></div>
        <div class="cell"><div class="v ${ddUsd > 0 ? 'pips-neg' : ''}">${ddUsd > 0 ? '-' + esc(fmtUsd(ddUsd)) : '—'}</div><div class="k">${esc(t('stMaxDDShort'))}</div></div>
      </div>
    </div>
    <div class="meta">${badgeHtml}<span class="pill">${subBadge}</span><span class="fol">${folN === undefined ? '—' : esc(t('followersCount', { n: folN }))}</span></div>
    <div class="actions"><button class="btn" type="button" data-act="view" data-trader="${esc(tr.profile_id)}">${esc(t('sigViewTrader'))}</button>${subscribeBtnHtml(tr.profile_id)}${followBtnHtml(tr.profile_id)}</div>
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
    list.innerHTML = `<div class="empty"><strong>${esc(t('searchEmpty'))}</strong></div>`;
    return;
  }
  const f = S.searchFilters;
  const stats = traderStatsMap();
  const q = (f.q || '').trim().toLowerCase();
  let pfHidden = 0;
  // R17: tab Diikuti/Langganan membatasi daftar ke trader yang diikuti /
  // dilanggan (data dimuat renderSearch). Di kedua tab ini hanya pencarian
  // nama (q) + pengurutan yang berlaku — filter pair/WR/dll hanya di tab
  // Traders (kontrolnya hanya tampil di sana).
  const tabScope = S.searchTab === 'followed'
    ? new Set(S.myFollows.map((x) => x.trader_id))
    : S.searchTab === 'subs'
      ? new Set(S.mySubs.filter((x) => x.status === 'active').map((x) => x.trader_id))
      : null;
  let rows = S.traders.filter((tr) => {
    if (tabScope && !tabScope.has(tr.profile_id)) return false;
    const st = stats[tr.profile_id];
    const p = progressOf(tr);
    const level = p ? Number(p.level) || 1 : 1;
    if (q) {
      // B1-11b: prototipe hanya mencocokkan handle (@ diabaikan) — nama
      // tampilan bukan identitas publik, jadi tidak dicari.
      const username = (tr.username || '').toLowerCase();
      if (!(username.includes(q) || ('@' + username).includes(q))) return false;
    }
    if (S.searchTab !== 'traders') return true;
    if (f.pair !== 'ALL' && !signalsOfTrader(tr.profile_id).some((s) => s.pair === f.pair)) return false;
    if (f.topPair !== 'ALL' && topPairOf(tr.profile_id) !== f.topPair) return false;
    if (Number(f.wrMin) > 0 && !(st.wr !== null && st.wr >= Number(f.wrMin))) return false;
    // B1-11a: prototipe — trader tanpa R (null) LOLOS filter R:R minimal
    // (null < 1,5 bernilai false); hanya R yang ada dan di bawah batas
    // yang disaring keluar.
    if (Number(f.rrMin) > 0 && st.rr !== null && st.rr !== undefined && st.rr < Number(f.rrMin)) return false;
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
  // Urutan deterministik: kriteria pilihan, lalu total R, lalu profit,
  // lalu nama — tidak bergantung pada urutan baris dari database.
  const sortKey = (tr) => {
    const st = stats[tr.profile_id];
    const p = progressOf(tr);
    let primary;
    if (S.searchFilters.sort === 'profit') primary = st.totalUSD;
    else if (S.searchFilters.sort === 'totalr') primary = st.totalR;
    else if (S.searchFilters.sort === 'wr') primary = st.wr === null ? -1 : st.wr;
    else if (S.searchFilters.sort === 'rf') primary = st.recovery === null || st.recovery === undefined ? -1 : (st.recovery === Infinity ? 999 : st.recovery);
    else if (S.searchFilters.sort === 'followers') primary = S.followerCounts[tr.profile_id] || 0;
    else primary = p ? Number(p.level) || 1 : 1;
    return [primary, st.totalR, st.totalUSD, (tr.trader_display_name || '').toLowerCase()];
  };
  rows = [...rows].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    for (let i = 0; i < 3; i++) {
      if (kb[i] !== ka[i]) return kb[i] - ka[i];
    }
    return ka[3] < kb[3] ? -1 : ka[3] > kb[3] ? 1 : 0;
  });
  S.searchPfHidden = pfHidden;
  S.searchLastCount = rows.length;
  let html = `<p class="sub">${esc(t('searchCount', { n: rows.length, total: S.traders.length }))}</p>`;
  if (rows.length === 0) {
    // R17: pesan kosong khusus per tab — bila belum mengikuti / belum
    // berlangganan siapa pun. Bila hanya pencarian nama (q) yang
    // menyaring habis, pakai searchNoMatch seperti biasa.
    // (officeFollowedEmpty tidak dipakai: kalimat keduanya ("Cari trader
    // di menu Cari...") + <br />-nya tidak cocok di konteks tab Cari.)
    let key = 'searchNoMatch';
    if (S.searchTab === 'followed' && S.myFollows.length === 0) key = 'searchFollowedEmpty';
    if (S.searchTab === 'subs' && !S.mySubs.some((x) => x.status === 'active')) key = 'searchSubsEmpty';
    html += `<div class="empty"><strong>${esc(t(key))}</strong></div>`;
    list.innerHTML = html;
    return;
  }
  // Rank = peringkat komposit (papan Peringkat), bukan urutan sort aktif.
  const ranked = rankedTraders(S.traders, stats);
  const rankOf = {};
  ranked.forEach((r, i) => { rankOf[r.tr.profile_id] = i + 1; });
  // R17: lencana tab di kartu (hanya di tab Diikuti/Langganan).
  const badge = S.searchTab === 'followed' ? 'followed' : S.searchTab === 'subs' ? 'subscribed' : null;
  html += `<div class="traders">` + rows.map((tr) => traderCardHtml(tr, rankOf[tr.profile_id] || '—', badge)).join('') + `</div>`;
  list.innerHTML = html;
  $$('[data-trader]', list).forEach((el) => {
    const open = () => openTraderProfile(el.dataset.trader);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
  bindFollowSubscribe(list);
  // R26: bila ada kartu yang hitungannya belum diketahui ("—"), coba muat
  // ulang di latar belakang (dibatasi 1×/10 detik) lalu cat ulang.
  if ([...list.querySelectorAll('.tcard .fol')].some((el) => el.textContent.trim() === '—')) refreshFollowerCounts();
}

// R24: dropdown kustom pengganti <select> native — picker OS tidak bisa
// di-style, jadi nilai disimpan di <input type="hidden" id> yang sama dan
// tampilannya dirender sebagai tombol pil + popup opsi (bahasa R22/R23).
// Kode lama yang membaca $('#id').value tetap bekerja; saat opsi dipilih,
// dropdown mengeset hidden value lalu me-dispatch event change + input,
// sehingga listener lama (filter Cari, refreshRiskBox form) tetap menyala.
function dropdownHtml(id, options, current) {
  const cur = options.find(([v]) => String(v) === String(current)) || options[0] || ['', ''];
  const curV = String(cur[0]);
  return `<input type="hidden" id="${id}" value="${esc(curV)}">`
    + `<div class="dd" data-dd="${id}"><button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false"><span class="dd-val">${esc(cur[1])}</span><span class="dd-chev">${ICONS.chevD}</span></button>`
    + `<div class="dd-pop" role="listbox" hidden>${options.map(([v, l, dis]) => `<button type="button" class="dd-opt" role="option" data-v="${esc(String(v))}" data-lbl="${esc(l)}" aria-selected="${String(v) === curV}"${dis ? ' disabled' : ''}><span>${esc(l)}</span><span class="dd-check">${ICONS.check}</span></button>`).join('')}</div></div>`;
}
function closeAllDropdowns() {
  document.querySelectorAll('.dd-pop').forEach((p) => { p.hidden = true; });
  document.querySelectorAll('.dd-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}
function bindDropdown(id) {
  const wrap = document.querySelector(`[data-dd="${id}"]`);
  if (!wrap) return;
  const btn = wrap.querySelector('.dd-btn');
  const pop = wrap.querySelector('.dd-pop');
  const hidden = document.getElementById(id);
  if (!btn || !pop || !hidden) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = pop.hidden;
    closeAllDropdowns();
    if (willOpen) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  });
  pop.querySelectorAll('.dd-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      const v = opt.dataset.v;
      hidden.value = v;
      wrap.querySelector('.dd-val').textContent = opt.dataset.lbl;
      pop.querySelectorAll('.dd-opt').forEach((o) => o.setAttribute('aria-selected', String(o === opt)));
      closeAllDropdowns();
      hidden.dispatchEvent(new Event('input', { bubbles: true }));
      hidden.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}
// Sekali saja (di boot): klik di luar / Escape menutup popup dropdown.
if (!window.__ddGlobalBound) {
  window.__ddGlobalBound = true;
  document.addEventListener('click', (e) => { if (!e.target.closest('.dd')) closeAllDropdowns(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllDropdowns(); });
}
function renderSearchControls() {
  const controls = $('#search-controls');
  if (!controls) return;
  controls.style.display = S.searchTab === 'traders' ? '' : 'none';
  if (S.searchTab !== 'traders') { controls.innerHTML = ''; return; }
  if (!S.searchDraft) S.searchDraft = { ...S.searchFilters };
  const d = S.searchDraft;
  // B2-09: 11 pair (sama dengan form + is_allowed_pair + strip feed).
  const pairs = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD', 'USDCHF', 'NZDUSD', 'USDCAD', 'EURJPY', 'EURGBP'];
  const pairOptions = [['ALL', t('optAllPairs')], ...pairs.map((p) => [p, p])];
  controls.innerHTML = `<div class="search-grid">
    <div class="field"><label>${esc(t('searchNameLabel'))}</label><input id="search-q" type="search" placeholder="${esc(t('searchPh'))}" value="${esc(d.q)}" aria-label="${esc(t('searchPh'))}" /></div>
    <div class="field"><label>${esc(t('searchFilterPair'))}</label>${dropdownHtml('search-pair', pairOptions, d.pair)}</div>
    <div class="field"><label>${esc(t('searchFilterTopPair'))}</label>${dropdownHtml('search-top-pair', pairOptions, d.topPair)}</div>
    <div class="field"><label>${esc(t('sortBy'))}</label>${dropdownHtml('search-sort', [
      ['wr', t('sortWr')], ['profit', t('sortProfit')], ['followers', t('sortFollowers')], ['rf', t('sortRf')],
      ['totalr', t('sortTotalR')], ['level', t('sortLevel')],
    ], d.sort)}</div>
    <div class="field"><label>${esc(t('searchFilterWrMin'))}</label>${dropdownHtml('search-wr-min', [[0, t('feedFilterAll')], [50, '≥ 50%'], [55, '≥ 55%'], [60, '≥ 60%'], [65, '≥ 65%']], d.wrMin)}</div>
    <div class="field"><label>${esc(t('searchFilterRrMin'))}</label>${dropdownHtml('search-rr-min', [[0, t('feedFilterAll')], [1.5, '≥ 1:1,5'], [2, '≥ 1:2'], [2.5, '≥ 1:2,5']], d.rrMin)}</div>
    <div class="field"><label>${esc(t('searchFilterPfMin'))}</label>${dropdownHtml('search-pf-min', [[0, t('feedFilterAll')], [1, '≥ 1,0'], [1.5, '≥ 1,5'], [2, '≥ 2,0'], [3, '≥ 3,0']], d.pfMin)}</div>
    <div class="field"><label>${esc(t('searchFilterLevelMin'))}</label>${dropdownHtml('search-level-min', [[1, t('optAllLevels')], [2, `≥ Level 2 · ${levelName(2, getLang())}`], [3, `≥ Level 3 · ${levelName(3, getLang())}`], [4, `≥ Level 4 · ${levelName(4, getLang())}`], [5, `≥ Level 5 · ${levelName(5, getLang())}`]], d.levelMin)}</div>
    <div class="field"><label>${esc(t('searchFilterPrice'))}</label>${dropdownHtml('search-price', [['all', t('feedFilterAll')], ['free', t('searchPriceFree')], ['paid', t('searchPricePaid')]], d.price)}</div>
    <div class="field"><label>${esc(t('searchFilterRfMin'))}</label>${dropdownHtml('search-rf-min', [[0, t('feedFilterAll')], [3, '≥ 3x'], [5, '≥ 5x'], [8, '≥ 8x']], d.rfMin)}</div>
  </div>
  <div class="search-actions">
    <button class="btn primary btn-go" id="search-apply" type="button"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg> ${esc(t('searchBtn'))}</button>
    <button class="btn btn-reset" id="search-reset" type="button">${esc(t('searchReset'))}</button>
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
  // B1-02: filter menyaring LANGSUNG saat diubah (prototipe) — tombol
  // "Cari" tetap ada untuk membaca ulang + toast konfirmasi.
  ['search-pair', 'search-top-pair', 'search-sort', 'search-wr-min', 'search-rr-min', 'search-pf-min', 'search-level-min', 'search-price', 'search-rf-min'].forEach((id) => {
    $('#' + id).addEventListener('change', () => { readDraft(); applySearchDraft(); });
  });
  // R24: dropdown kustom — klik opsi me-dispatch 'change' pada hidden input
  // di atas, jadi filter tetap menyaring langsung seperti select lama.
  ['search-pair', 'search-top-pair', 'search-sort', 'search-wr-min', 'search-rr-min', 'search-pf-min', 'search-level-min', 'search-price', 'search-rf-min'].forEach(bindDropdown);
  let searchDebounce = null;
  $('#search-q').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { readDraft(); applySearchDraft(); }, 250);
  });
  $('#search-q').addEventListener('change', readDraft);
  $('#search-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); readDraft(); applySearchDraft(); }
  });
  $('#search-apply').addEventListener('click', () => {
    readDraft();
    applySearchDraft();
    // B1-12: toast konfirmasi + gulir ke hitungan hasil (prototipe).
    toast(t('toastSearchRun', { n: S.searchLastCount ?? 0, total: S.traders.length }));
    const list = $('#search-list');
    if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#search-reset').addEventListener('click', () => {
    S.searchFilters = { q: '', pair: 'ALL', topPair: 'ALL', sort: 'wr', wrMin: '0', rrMin: '0', pfMin: '0', levelMin: '1', price: 'all', rfMin: '0' };
    S.searchDraft = { ...S.searchFilters };
    renderSearchControls();
    renderSearchList();
    toast(t('toastSearchReset'));
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
    // Ronde 15 (#2) + Ronde 17: muat daftar ikutan dan langganan juga —
    // tab Diikuti / Langganan butuh S.myFollows / S.mySubs walau pengguna
    // langsung membuka Cari.
    const [traders, follows, subs] = await Promise.all([
      api.listTraders(),
      S.user ? api.listMyFollows(S.user.id).catch(() => []) : Promise.resolve([]),
      S.user ? api.listMySubscriptions(S.user.id).catch(() => []) : Promise.resolve([]),
      ensureAllSignals(),
    ]);
    S.traders = traders;
    S.myFollows = follows;
    S.mySubs = subs;
    try {
      // R26: lihat catatan di handleSession — kegagalan bukan 0.
      const counts = await Promise.all(S.traders.map((tr) => api.countFollowers(tr.profile_id).catch(() => null)));
      S.traders.forEach((tr, i) => { if (counts[i] !== null && counts[i] !== undefined) S.followerCounts[tr.profile_id] = counts[i]; });
      paintAllFollowerCounts();
    } catch (e) { /* abaikan */ }
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
  const st = row.stats;
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : '';
  const name = traderHandle(tr); // publik: hanya @username (ronde 5)
  // R34 (audit B-1/S-3): pola "—" Ronde 26 — trader tanpa trade tertutup
  // tidak menampilkan "$0.00" hijau / "0R" mentah (Max DD, PF, RF sudah
  // "—" lewat guard/fmt null; Total Profit + Total R disamakan di sini).
  const has = st.closed > 0;
  return `<article class="board-card" data-trader="${esc(tr.profile_id)}" tabindex="0" role="button">
    <div class="board-top">
      <span class="board-rank${rank <= 3 ? ' top' : ''}">${rank}</span>
      <button class="avatar-btn" data-profile="${esc(tr.profile_id)}" aria-label="${esc(name)}">${avatarImg(name, tr.profile_id, tr.trader_avatar_url, 'avatar-md')}</button>
      <div style="min-width:0; flex:1;">
        <div style="font-weight:800; font-size:15.5px;">${esc(name)}${verified}${demoBadge(tr.profile_id)}</div>
      </div>
      <span class="lvlbadge">Level ${level} · ${esc(levelName(level, getLang()))}</span>
      ${followBtnHtml(tr.profile_id)}
    </div>
    <div class="board-stats">
      <div class="bs"><b class="${has ? (st.totalUSD >= 0 ? 'pips-pos' : 'pips-neg') : ''}">${has ? esc(fmtUsd(st.totalUSD, true)) : '—'}</b><small>${esc(t('thProfit'))}</small></div>
      <div class="bs"><b>${has ? esc(fmtR(st.totalR)) : '—'}</b><small>${esc(t('stTotalRNet'))}</small></div>
      <div class="bs"><b class="${st.drawdown.usd > 0 ? 'pips-neg' : ''}">${st.drawdown.usd > 0 ? '-' + esc(fmtUsd(st.drawdown.usd)) + ` (${ds(st.drawdown.pct.toFixed(1))}%)` : '—'}</b><small>${esc(t('thMaxDD'))}</small></div>
      <div class="bs"><b>${fmtPf(st.pf)}</b><small>${esc(t('thPF'))}</small></div>
      <div class="bs"><b>${fmtRf(st.recovery)}</b><small>${esc(t('thRecovery'))}</small></div>
      <div class="bs"><b>${st.totalSignals}</b><small>${esc(t('thSignals'))}</small></div>
    </div>
  </article>`;
}
function renderBoardList() {
  const list = $('#search-list');
  if (!list) return;
  const stats = traderStatsMap();
  const ranked = rankedTraders(S.traders, stats);
  const hasClosed = ranked.some((r) => r.stats.closed > 0);
  let html = `<div class="board-intro">`
    + `<button class="guidelink" id="board-guide-link" type="button">${esc(t('guideCta'))}<span aria-hidden="true"> ${ICONS.arrow}</span></button></div>`;
  // D55: prototipe tidak menampilkan pesan apa pun bila daftar kosong.
  const perPage = 10;
  const pages = Math.max(1, Math.ceil(ranked.length / perPage));
  S.boardPage = Math.min(S.boardPage, pages);
  const start = (S.boardPage - 1) * perPage;
  const shown = ranked.slice(start, start + perPage);
  // R39: kartu Peringkat ikut aturan kolom global (.board-grid: 2 kolom
  // web, 1 kolom HP) — bukan tumpuk vertikal lagi.
  html += `<div class="board-grid" style="margin-top:14px;">` + shown.map((r, i) => boardCardHtml(r, start + i + 1)).join('') + `</div>`;
  // D32: catatan risiko di bawah board.
  html += `<div class="risk-note">${t('boardRiskNote')}</div>`;
  if (pages > 1 || ranked.length > 0) {
    const from = ranked.length ? start + 1 : 0;
    const to = Math.min(start + perPage, ranked.length);
    let btns = '';
    for (let pg = 1; pg <= pages; pg++) {
      btns += `<button class="btn${pg === S.boardPage ? ' cur' : ''}" type="button" data-boardpage="${pg}"${pg === S.boardPage ? ' aria-current="page"' : ''}>${pg}</button>`;
    }
    html += `<div class="board-pager"><span class="pinfo">${esc(t('boardPageOf', { page: S.boardPage, pages, from, to, total: ranked.length }))}</span>`
      + `<button class="btn" id="board-prev" type="button" ${S.boardPage <= 1 ? 'disabled' : ''}>${esc(t('boardPrev'))}</button>`
      + btns
      + `<button class="btn" id="board-next" type="button" ${S.boardPage >= pages ? 'disabled' : ''}>${esc(t('boardNext'))}</button></div>`;
  }
  list.innerHTML = html;
  $('#board-guide-link').addEventListener('click', () => openGuideSection('board'));
  const prev = $('#board-prev');
  if (prev) prev.addEventListener('click', () => { S.boardPage--; renderBoardList(); });
  const next = $('#board-next');
  if (next) next.addEventListener('click', () => { S.boardPage++; renderBoardList(); });
  $$('[data-boardpage]', list).forEach((b) => {
    b.addEventListener('click', () => {
      S.boardPage = Number(b.dataset.boardpage);
      renderBoardList();
    });
  });
  bindFollowSubscribe(list);
  $$('[data-profile]', list).forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      openTraderProfile(b.dataset.profile);
    });
  });
  $$('[data-trader]', list).forEach((el) => {
    const open = () => openTraderProfile(el.dataset.trader);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}
function openGuideSection(id) {
  // R30: Panduan drill-in — buka langsung halaman detail seksi itu.
  // Id tidak dikenal -> renderGuide jatuh kembali ke daftar.
  S.guideSub = id || null;
  S.helpGuideTab = 'guide';
  showView('helpguide');
}

// Profil trader sebagai HALAMAN PENUH (seperti prototipe), bukan modal.
// Tombol kembali mengarah ke tempat asal (Cari/Beranda); nav asal tetap
// ditandai aktif. Tombol Ikuti/Langganan TIDAK dibangun (Fase 5).
// B-01/B4-02: deep link profil trader (#trader/<id>) — tautan yang
// dibagikan lewat "Bagikan profil trader" harus membuka profil trader itu,
// bukan Beranda. Dipanggil setelah sesi siap + saat hash berubah.
function openTraderFromHash() {
  const m = String(window.location.hash || '').match(/^#trader\/([0-9a-f-]{36})$/i);
  if (!m) return false;
  openTraderProfile(m[1]);
  return true;
}
window.addEventListener('hashchange', () => {
  // Hanya saat sudah masuk; bila belum masuk, handleSession yang membuka
  // tautan itu setelah login (hash masih ada).
  if (S.user) openTraderFromHash();
});
function openTraderProfile(traderId) {
  S.traderProfileId = traderId;
  S.traderProfileFrom = S.view;
  S.traderProfileTab = 'sinyal';
  S.traderProfileFilter = 'ALL';
  S.traderProfileRange = 'ALL';
  S.traderProfileCustom = { from: '', to: '' };
  S.dateFilterOpen = '';
  S.dateFilterDraft = null;
  showView('trader');
}
async function renderTraderProfile() {
  const box = $('#trader-profile');
  if (!box) return;
  const traderId = S.traderProfileId;
  const tr = S.traders.find((x) => x.profile_id === traderId);
  if (!tr) {
    box.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
    return;
  }
  // Nav asal tetap ditandai aktif selama di halaman profil trader.
  $$('.bottom-nav [data-nav]').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.nav === S.traderProfileFrom));
  });
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : '';
  const name = traderHandle(tr); // publik: hanya @username (ronde 5)
  const mine = S.user && traderId === S.user.id;
  box.innerHTML = `
    <button class="btn backbtn" id="tp-back" type="button">← ${esc(t('back'))}</button>
    <div class="profile-head">
      ${avatarImg(name, traderId, tr.trader_avatar_url, 'avatar-lg')}
      <div style="min-width:0; flex:1;">
        <h2>${esc(name)}${verified}${demoBadge(traderId)}</h2>
        <div class="sub">Level ${level} · ${esc(levelName(level, getLang()))}</div>
      </div>
      <div class="followbox">${followBtnHtml(traderId)}${subscribeBtnHtml(traderId)}<button class="iconbtn" id="tp-share" type="button" aria-label="${esc(t('shareTrader'))}">${ICONS.share}</button><div class="followers" id="tp-followers">—</div></div>
    </div>
    ${!mine ? `<div class="risk-note">${t('riskNote')}</div>` : ''}
    <div class="subtabs" role="tablist" style="margin-top:14px;">
      <button class="subtab" role="tab" data-ptab="sinyal" aria-selected="${S.traderProfileTab === 'sinyal'}">${esc(t('profTabSignals'))}</button>
      <button class="subtab" role="tab" data-ptab="profil" aria-selected="${S.traderProfileTab === 'profil'}">${esc(t('profTabProfile'))}</button>
    </div>
    <div id="trader-profile-body"><p class="sub">${esc(t('loading'))}</p></div>`;
  $('#tp-back').addEventListener('click', () => {
    showView(['home', 'office-trader', 'office-follower', 'search'].includes(S.traderProfileFrom) ? S.traderProfileFrom : 'search');
  });
  bindFollowSubscribe(box);
  const tpShare = $('#tp-share');
  if (tpShare) {
    // R9-5 (B-05): bagikan kartu PNG portofolio (dulu hanya teks).
    tpShare.addEventListener('click', async () => { await downloadPortfolioCard(tr); });
  }
  $$('#trader-profile [data-ptab]').forEach((b) => {
    b.addEventListener('click', () => {
      S.traderProfileTab = b.dataset.ptab;
      $$('#trader-profile [data-ptab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.ptab === S.traderProfileTab)));
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
    const fTxt = followers === null ? '—' : t('followersCount', { n: followers });
    const fEl = $('#tp-followers');
    if (fEl) fEl.textContent = fTxt;
    renderTraderProfileBody(traderId);
  } catch (e) {
    const b = $('#trader-profile-body');
    if (b) b.innerHTML = `<div class="empty"><strong>${esc(t('errNetwork'))}</strong></div>`;
  }
}
function renderTraderProfileBody(traderId) {
  const box = $('#trader-profile-body');
  if (!box) return;
  const sigs = S.traderSignals.filter((s) => s.trader_id === traderId);
  if (S.traderProfileTab === 'profil') {
    const st = statsForTrader(traderId);
    box.innerHTML = (st.closed === 0 ? `<div class="empty"><strong>${esc(t('stNoTrades'))}</strong></div>` : '')
      + statsGridHtml(st)
      + chartCardHtml(st, 'profile')
      + monthTableHtml(st.months, 'profile')
      + pairTableHtml(st, 'stPairSubAbove');
    bindMonthYear('profile', () => renderTraderProfileBody(traderId));
    bindChartYear('profile', () => renderTraderProfileBody(traderId));
    updateBoardScrollHints(box);
    return;
  }
  const open = sigs.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF');
  // D11: Riwayat hanya sinyal kena TP/SL (WIN/LOSS).
  const done = sigs.filter((s) => ['WIN', 'LOSS'].includes(s.status));
  const f = S.traderProfileFilter;
  const chip = (val, label, n) => `<button class="chip" type="button" data-pfilter="${val}" aria-pressed="${f === val}">${esc(label)}${n !== undefined ? ` (${n})` : ''}</button>`;
  const traderName = traderHandle(S.traders.find((x) => x.profile_id === traderId) || {}); // publik: hanya @username (ronde 5)
  let html = `<h3 class="section">${esc(t('profSignalsAll'))}</h3>`
    + `<p class="sub">${esc(t('profSignalsAllSub', { name: traderName }))}</p>`
    + `<div class="pfilters">${chip('ALL', t('pfAll', { n: open.length }))}${chip('PENDING', t('pfPending'))}${chip('AKTIF', t('pfActive'))}<button class="chip hist-tab" type="button" data-pfilter="HISTORY" aria-pressed="${f === 'HISTORY'}">${esc(t('tabHistory'))} (${done.length})</button></div>`;
  if (f === 'HISTORY') {
    const range = S.traderProfileRange;
    const shown = done.filter((s) => withinHistRange(s.closed_at || s.created_at, range, S.traderProfileCustom));
    html += `<div class="pfilters"><button class="chip" type="button" data-prange="ALL" aria-pressed="${range === 'ALL'}">${esc(t('rangeAll'))}</button>${dateFilterBarHtml('trader')}</div>`;
    const mineHere = S.user && traderId === S.user.id;
    html += shown.length
      ? `<div class="hist journal-scroll tall" tabindex="0">` + shown.map((x) => journalRowHtml(x, { mine: mineHere })).join('') + `</div>`
      : `<div class="empty"><strong>${esc(range === 'ALL' ? t('profJournalEmpty') : t('histEmptyRange'))}</strong></div>`;
  } else {
    const shown = f === 'ALL' ? open : open.filter((s) => s.status === f);
    // R20: feed profil trader 2 kolom di web (seperti Beranda) — bungkus
    // .feed-grid; Riwayat (jurnal) tidak disentuh.
    html += shown.length
      ? `<div class="feed-grid">` + shown.map(signalCardHtml).join('') + `</div>`
      : `<div class="empty"><strong>${esc(sigs.length === 0 ? t('profNoSignals') : t('profNoFilter'))}</strong></div>`;
  }
  box.innerHTML = html;
  $$('[data-pfilter]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.traderProfileFilter = b.dataset.pfilter;
      renderTraderProfileBody(traderId);
    });
  });
  $$('[data-prange]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.traderProfileRange = b.dataset.prange;
      renderTraderProfileBody(traderId);
    });
  });
  bindDateFilter(box, 'trader', () => renderTraderProfileBody(traderId));
  bindSignalCards(box);
  bindJournalRows(box);
}

// ------------------------------------------------- Trader: saldo & statistik ---
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
  // R45: progres Syarat 1 diukur DARI acuan level ref(L) KE ambang naik
  // ref(L+1) — bukan saldo/ambang. Saldo di bawah acuan = 0% (kosong),
  // seperti Syarat 2 yang kosong saat R negatif.
  const pctBal = Math.min(100, Math.max(0, ((balance - ref) / (nextRef - ref)) * 100));
  const pctR = Math.min(100, Math.max(0, (r / 5) * 100));
  const pctTr = Math.min(100, (trades / 5) * 100);
  const pctDownBal = ref > downRef ? Math.min(100, Math.max(0, ((ref - balance) / (ref - downRef)) * 100)) : 0;
  const pctDownR = r < 0 ? Math.min(100, (-r / 5) * 100) : 0;
  // R48: bar turun BEKU 0% selama Level 1 (baris statis, revisi R46).
  // Turun level tidak bisa jalan di lantai (engine: while v_level > 1),
  // jadi bar tidak bergerak; mulai L2 bar memakai nilai terhitung.
  const pctDownBalShown = level > 1 ? pctDownBal : 0;
  const pctDownRShown = level > 1 ? pctDownR : 0;
  const upCount = (balance >= nextRef ? 1 : 0) + (r >= 5 ? 1 : 0) + (trades >= 5 ? 1 : 0);
  const downCount = (balance <= downRef ? 1 : 0) + (r <= -5 ? 1 : 0);
  const rShort = (thr) => Math.abs(thr - r).toFixed(2).replace(/\.?0+$/, '');
  // Kotak syarat seperti prototipe: label + pill, bilah, lalu detail
  // (angka acuan + "kurang $X"). Nilai i18n mengandung <span class="mono">
  // sehingga detail dirender mentah (tanpa esc) — isinya angka/format aman.
  const condBox = (met, label, detail, pct) => `<div class="cond">
      <div class="cond-head"><span>${esc(label)}</span><span class="stchip ${met ? 'ok' : 'no'}">${esc(met ? t('balCondMet') : t('balCondUnmet'))}</span></div>
      <div class="progress"><div class="track"><div class="fill" style="width:${pct.toFixed(0)}%"></div></div></div>
      <div class="cval">${detail}</div>
    </div>`;
  const balUpMet = balance >= nextRef;
  const rUpMet = r >= 5;
  const balDownMet = balance <= downRef;
  const rDownMet = r <= -5;
  // R49: badge turun BEKU "BELUM TERPENUHI" selama Level 1 (sejajar bar beku
  // R48) — mulai L2 badge memakai nilai terhitung.
  const balDownMetShown = level > 1 ? balDownMet : false;
  const rDownMetShown = level > 1 ? rDownMet : false;
  const balUpDetail = t('condBalDetail', { bal: fmtUsd(balance), ref: fmtUsd(ref), thr: fmtUsd(nextRef) })
    + (balUpMet ? t('condReached') : t('condShort', { amt: fmtUsd(nextRef - balance) }));
  const rUpDetail = t('condRDetail', { r: fmtRShort(r), thr: '+5R' })
    + (rUpMet ? t('condRReached') : t('condRShort', { amt: rShort(5) }));
  const balDownBase = t('condBalDetailDown', { bal: fmtUsd(balance), ref: fmtUsd(ref), thr: fmtUsd(downRef) });
  const balDownDetail = balDownBase
    + (balDownMet ? t('condReached') : t('condAbove', { amt: fmtUsd(balance - downRef) }));
  const rDownBase = t('condRDetail', { r: fmtRShort(r), thr: '−5R' });
  const rDownDetail = rDownBase
    + (rDownMet ? t('condRReached') : t('condRShort', { amt: rShort(-5) }));
  // R50: teks detail turun BEKU di Level 1 — suffix penilaian ("— tercapai" /
  // "— kurang ... lagi" / "— masih di atas ambang ...") dihilangkan, hanya
  // angka (saldo, R, ambang) yang tampil; mulai L2 detail terhitung normal.
  // Suffix "belum terpenuhi" tidak dipakai apa adanya: condRShort untuk
  // R −7 akan menulis "kurang 2R lagi" (arah salah, ambang sudah dilewati)
  // dan condAbove untuk saldo di bawah ambang menulis jumlah negatif —
  // menghilangkan suffix adalah fallback yang jujur.
  const balDownDetailShown = level > 1 ? balDownDetail : balDownBase;
  const rDownDetailShown = level > 1 ? rDownDetail : rDownBase;
  return `<div class="balance-card">
    <div class="balance-top">
      <div>
        <div style="font-size:12.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;">${esc(t('balanceCard'))}</div>
        <div class="amt">${esc(fmtUsd(balance))}</div>
      </div>
    </div>
    <div class="sig-facts" style="margin-top:0;">
      <span>${esc(t('balStartPrefix'))}${esc(t('balCumProfit'))}: <b>${esc(fmtUsd(cumProfit))}</b> (${pctStart >= 0 ? '+' : ''}${ds(pctStart.toFixed(1))}% ${esc(t('balPctStart'))})</span>
      <span>${esc(t('balEquity'))}: <b>${equity !== null ? esc(fmtUsd(equity)) : '—'}</b></span>
      <span>${esc(t('balFloating'))}: <b>${floating !== null ? esc(fmtUsd(floating)) : '—'}</b>${esc(t('balFloatingFrom'))}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="pill gold">Level ${level} · ${esc(levelName(level, getLang()))}</span>
      ${level >= PAY_GATE_LEVEL ? `<span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : ''}
      <span style="font-size:13px;color:var(--muted);">${level > 1 ? t('lvlProgress', { up: upCount, down: downCount }) : t('lvlProgressUp', { up: upCount })}</span>
    </div>
    <div>
      <div style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);">${esc(t('balUpTitle'))}</div>
      <div class="conds">
        ${condBox(balUpMet, t('condBalUp'), balUpDetail, pctBal)}
        ${condBox(rUpMet, t('condRUp'), rUpDetail, pctR)}
        ${condBox(trades >= 5, t('condTradesUp'), t('condTradesDetail', { n: trades }), pctTr)}
      </div>
    </div>
    <div>
      <div style="font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);">${esc(t('balDownTitle'))}</div>
      <div class="conds">
        ${condBox(balDownMetShown, t('condBalDown'), balDownDetailShown, pctDownBalShown)}
        ${condBox(rDownMetShown, t('condRDown'), rDownDetailShown, pctDownRShown)}
      </div>
    </div>
    <button class="guidelink" id="bal-guide-link" type="button" style="padding-top:0;">${esc(t('balGuide'))}<span aria-hidden="true"> ${ICONS.arrow}</span></button>
  </div>`;
}

// ------------------------------------------------------------- form sinyal ---
function signalFormHtml(editing) {
  const sig = editing || null;
  // R9-6: username trader wajib dibuat sebelum posting (prototipe
  // paintPostUsernameWarn) — banner + tombol submit dinonaktifkan supaya
  // pengguna tidak mengisi form dengan sia-sia.
  const needUsername = !S.trader?.username;
  return `<div class="card">
    <h2>${esc(editing ? t('formTitleEdit') : t('formTitleNew'))}</h2>
    <div class="risk-note"><span>${t('formRisk')}</span></div>
    ${needUsername ? `<div class="risk-note" role="alert"><span><strong>${esc(t('postUsernameWarnTitle'))}</strong> ${esc(t('postUsernameWarn'))} <button type="button" class="linkbtn" id="sf-username-cta">${esc(t('postUsernameWarnCta'))}</button></span></div>` : ''}
    <form id="sig-form">
      <div class="fgrid">
        <div class="field">
          <label for="sf-pair">${esc(t('formPairLbl'))}</label>
          ${dropdownHtml('sf-pair', PAIRS.map((p) => [p, p]), sig ? sig.pair : null)}
        </div>
        <div class="field">
          <label>${esc(t('direction'))}</label>
          <div class="dir-toggle" role="group">
            <button type="button" class="buy" id="sf-buy" aria-pressed="${sig ? String(sig.direction === 'BUY') : 'true'}">${esc(t('buy'))}</button>
            <button type="button" class="sell" id="sf-sell" aria-pressed="${sig ? String(sig.direction === 'SELL') : 'false'}">${esc(t('sell'))}</button>
          </div>
        </div>
      </div>
      <div class="fgrid">
        <div class="field">
          <label for="sf-entry">${esc(t('formEntryLbl'))}</label>
          <input id="sf-entry" type="number" step="any" min="0" required value="${sig ? esc(sig.entry) : ''}" />
          <span class="hint">${esc(t('formEntryDistHint'))}</span>
        </div>
        <div class="field">
          <label for="sf-tp">${esc(t('takeProfit'))}</label>
          <input id="sf-tp" type="number" step="any" min="0" required value="${sig ? esc(sig.take_profit) : ''}" />
        </div>
      </div>
      <div class="fgrid">
        <div class="field">
          <label for="sf-sl">${esc(t('stopLoss'))}</label>
          <input id="sf-sl" type="number" step="any" min="0" required value="${sig ? esc(sig.stop_loss) : ''}" />
        </div>
        <div class="field">
          <label for="sf-lot">${esc(t('lot'))}</label>
          <input id="sf-lot" type="number" step="0.01" min="0.01" required value="${sig ? esc(sig.lot_size) : '0.10'}" />
        </div>
      </div>
      <div id="sf-risk"></div>
      <div class="err" id="sf-err" style="color:var(--sell); font-size:13px; min-height:1.2em; margin-bottom:8px;"></div>
      <div class="row">
        <button class="btn primary compact" type="submit" id="sf-submit"${needUsername ? ' disabled' : ''}><span aria-hidden="true">${ICONS.lock}</span>${editing ? esc(t('submitEdit')) : esc(t('postSignal'))}</button>
      </div>
      ${editing ? `<div class="row"><button class="btn compact" type="button" id="sf-cancel-edit">${esc(t('cancelEdit'))}</button></div>` : ''}
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
  // Ronde 35: risiko dihitung dari SALDO ACUAN LEVEL ref(level), bukan
  // saldo simulasi aktual. level_ref_balance dirawat recalc/reset;
  // fallback $10.000 = ref(1) bila progress belum ada.
  const prog = progressOf(S.trader);
  const refBalance = prog && Number(prog.level_ref_balance) > 0
    ? Number(prog.level_ref_balance) : START_BALANCE_USD;
  // Ronde 35: masa jeda reset — tombol posting ikut nonaktif di UI
  // (server tetap menegakkan; ini cerminan, bukan pengganti).
  const inResetCd = !!(prog && prog.reset_cooldown_until
    && new Date(prog.reset_cooldown_until).getTime() > Date.now());
  // B2-08: nonaktifkan tombol posting saat pair sudah penuh (2 terbuka).
  // Sinyal yang sedang diedit tidak dihitung — mengedit salah satu dari
  // 2 sinyal itu tetap diizinkan (server tetap menegakkan batasnya).
  // (R10: teks catatan kuota dihapus; batas tetap ditegakkan di sini.)
  const nExcl = S.mySignals.filter((s) => s.pair === v.pair && (s.status === 'PENDING' || s.status === 'AKTIF') && s.id !== S.editingId).length;
  const full = nExcl >= 2;
  const submitBtn = $('#sf-submit');
  // R9-6: tombol juga nonaktif bila username trader belum dibuat
  // (banner postUsernameWarn) — jangan timpa disabled itu dengan `full`
  // saja; kedua kondisi digabung.
  if (submitBtn) submitBtn.disabled = full || !S.trader?.username || inResetCd;
  const err = validateSignal({ ...v, refBalanceUsd: refBalance, prices: S.prices });
  const rr = calcRr(v.entry, v.sl, v.tp);
  const slPips = (Number.isFinite(v.entry) && Number.isFinite(v.sl)) ? Math.abs(v.entry - v.sl) / pipSize(v.pair) : null;
  const tpPips = (Number.isFinite(v.entry) && Number.isFinite(v.tp)) ? Math.abs(v.tp - v.entry) / pipSize(v.pair) : null;
  const risk = ([v.entry, v.sl, v.lot].every((x) => Number.isFinite(x) && x > 0))
    ? calcRisk({ pair: v.pair, entry: v.entry, sl: v.sl, lot: v.lot, refBalanceUsd: refBalance, prices: S.prices })
    : null;
  let html = '';
  if (risk && !risk.error && slPips !== null && tpPips !== null && rr !== null && Number.isFinite(rr)) {
    const profit = risk.riskUsd * rr;
    html = `<div class="calc"><span>${t('calcLot', { v: fmtNum(v.lot, 2) })}</span><span class="sep">·</span>`
      + `<span>${t('calcRisk', { amt: fmtUsd(risk.riskUsd), pct: risk.riskPct !== null ? risk.riskPct.toFixed(2) : '—', bal: fmtUsd(refBalance), pips: Math.round(slPips) })}</span><span class="sep">·</span>`
      + `<span>${t('calcProfit', { amt: fmtUsd(profit), pips: Math.round(tpPips) })}</span><span class="sep">·</span>`
      + `<span>R:R <b>1:${rr.toFixed(2)}</b></span></div>`
      + `<div class="note">${esc(rr >= 5 ? t('calcRR5') : t('calcRRN', { rr: rr.toFixed(2) }))}</div>`;
  }
  // Ronde 35: jenis entry live — disimpulkan dari entry vs harga sekarang
  // (sama seperti server). Tanpa harga live, jenis tidak ditampilkan.
  const livePrice = priceOf(v.pair);
  const et = inferEntryType(v.direction, v.entry, livePrice);
  if (et && Number.isFinite(v.entry)) {
    // BUY stop + SELL limit: harga harus NAIK ke entry; selainnya TURUN.
    const verb = (v.direction === 'BUY') === (et === 'stop') ? t('entryVerbRise') : t('entryVerbFall');
    html += `<div class="note">${esc(t('entryTypeNote', { type: t(et === 'stop' ? 'entryStop' : 'entryLimit'), verb, entry: fmtNum(v.entry, decimalsForPair(v.pair)) }))}</div>`;
  }
  if (inResetCd) {
    html += `<div style="color:var(--sell);">${esc(t('resetCooldownWarn', { date: fmtDate(prog.reset_cooldown_until) }))}</div>`;
  }
  if (err === 'invalid-order') html += `<div style="color:var(--sell);">${esc(t('errOrder'))}</div>`;
  if (err === 'rr') html += `<div style="color:var(--sell);">${esc(t('errRr'))}</div>`;
  if (err === 'risk') html += `<div style="color:var(--sell);">${esc(t('errRisk'))}</div>`;
  if (err === 'distance') html += `<div style="color:var(--sell);">${esc(t('errDistance'))}</div>`;
  box.innerHTML = html;
}

function bindSignalForm(editing) {
  const buyBtn = $('#sf-buy');
  const sellBtn = $('#sf-sell');
  const guideLink = $('#sf-guide-link');
  if (guideLink) guideLink.addEventListener('click', () => openGuideSection('signal'));
  // R9-6: tombol banner username → Trader → Profil (Akun Trader).
  const usernameCta = $('#sf-username-cta');
  if (usernameCta) {
    usernameCta.addEventListener('click', () => {
      S.officeTraderTab = 'profil';
      showView('office-trader');
    });
  }
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
  bindDropdown('sf-pair'); // R24: klik opsi me-dispatch 'input' → refreshRiskBox
  refreshRiskBox();
  const cancelEdit = $('#sf-cancel-edit');
  if (cancelEdit) {
    // "Batal ubah" tetap di menu Trader — tidak pindah halaman.
    cancelEdit.addEventListener('click', () => {
      S.editingId = null;
      S.editingVersion = null;
      renderTraderWork();
    });
  }
  $('#sig-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#sf-err');
    errBox.textContent = '';
    const v = readSignalForm();
    // Ronde 35: validasi client memakai saldo acuan level (server yang memutuskan).
    const prog = progressOf(S.trader);
    const refBalance = prog && Number(prog.level_ref_balance) > 0 ? Number(prog.level_ref_balance) : START_BALANCE_USD;
    const code = validateSignal({ ...v, refBalanceUsd: refBalance, prices: S.prices });
    // Ronde 59: kode yang sudah ditampilkan di kotak risiko (#sf-risk)
    // JANGAN diulang di #sf-err — kalimat yang sama dua kali berurutan
    // adalah cacat (prinsip tanpa-teks-berulang, R57). refreshRiskBox()
    // dipanggil ulang supaya pesannya sinkron dengan harga terbaru.
    if (code === 'invalid-order' || code === 'rr' || code === 'risk' || code === 'distance') {
      refreshRiskBox();
      return;
    }
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
          await renderTraderWork();
        }
        return;
      }
      toast(editing ? t('toastUpdated') : t('toastPosted'));
      S.editingId = null;
      S.editingVersion = null;
      invalidateAllSignals();
      await refreshIdentity();
      await renderTraderWork();
      await renderHome();
    } catch (err) {
      errBox.textContent = t('errNetwork');
    } finally {
      btn.disabled = false;
    }
  });
}

function startEditSignal(sig) {
  // R9-4: pertahanan lapis kedua — tombol Ubah sudah disembunyikan untuk
  // sinyal yang dibagikan, tapi jangan buka form edit bila dipanggil langsung
  // (mis. DOM basi). Server juga menolak simpan (update_signal 'shared').
  if (sig.shared_at) {
    toast(t('errShared'), true);
    return;
  }
  S.editingId = sig.id;
  S.editingVersion = sig.version;
  showView('office-trader');
  // Form edit dirender di atas daftar sinyal, tetap di menu Trader.
  setTimeout(() => {
    const form = $('#sig-form');
    if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}


// ------------------------------------------------------- form username ---
// D05: satu komponen untuk kedua peran (prototipe usernameFormHTML):
// input + cek ketersediaan debounce 250 ms + langkah konfirmasi
// ("Ya, ubah/tetapkan username" + "Kembali") sebelum menyimpan.
// Validasi + cooldown 1x/bulan ditegakkan server-side (RPC check_username
// / setup_trader_identity / set_follower_username, sql/13); klien hanya
// menampilkan hasil server.
function usernameStatusMsg(res) {
  if (!res) return '';
  if (res.ok) return { txt: t('usernameAvailable'), cls: 'ok' };
  if (res.code === 'cooldown') return { txt: res.message || t('usernameCheckCooldown', { date: '—' }), cls: 'bad' };
  const map = { format: 'usernameCheckFormat', banned: 'usernameCheckBanned', reserved: 'usernameCheckReserved', taken: 'usernameCheckTaken', empty: 'usernameCheckEmpty' };
  return { txt: t(map[res.code] || 'usernameCheckEmpty'), cls: 'bad' };
}
// R12/F3: tombol submit username hanya aktif bila (a) cek ketersediaan
// lolos DAN (b) draft BERBEDA dari username saat ini. Sebelumnya hanya
// (a) — mengembalikan field ke username saat ini (yang lolos cek karena
// bukan milik orang lain) tetap mengaktifkan tombol padahal tidak ada
// perubahan untuk disubmit.
function usernameCanSubmit(kind) {
  const ui = S.usernameUI[kind];
  if (!ui || !ui.res || !ui.res.ok) return false;
  const cur = kind === 'trader' ? (S.trader?.username || '') : (S.profile?.username || '');
  return (ui.draft || '') !== cur;
}
// Ronde 68 (Arah C): cek format username client-side untuk centang
// aturan (cermin regex server sql/13:
// ^[A-Za-z0-9_][A-Za-z0-9_.]{2,29}$). len = panjang 3-30; chars =
// karakter diizinkan + tanpa titik di awal. Kedua centang hijau berarti
// lolos cek format server. Draft kosong = kedua centang netral.
function usernameFormatChecks(v) {
  const s = String(v || '');
  return {
    len: s.length >= 3 && s.length <= 30,
    chars: /^[A-Za-z0-9_][A-Za-z0-9_.]*$/.test(s),
  };
}
function usernameFormHtml(kind, opts = {}) {
  const ui = S.usernameUI[kind];
  const isTrader = kind === 'trader';
  const set = isTrader ? !!S.trader : !!(S.profile && S.profile.username);
  const cur = isTrader ? (S.trader?.username || '') : (S.profile?.username || '');
  if (!ui.draft && set) { ui.draft = cur; }
  const warn = isTrader ? t('usernameWarnTrader') : t('usernameWarnFollower');
  // R28: peringatan "wajib dibuat" hanya bila username BELUM ada. Bila
  // sudah ada (form ubah), peringatan itu sudah tidak berlaku.
  // Ronde 68: cabang kosong Trader (Arah C) menyembunyikan peringatan ini
  // (opts.hideWarn), karena warnbar di atas sudah menyatakan syarat sekali;
  // tanpa pengulangan.
  const note = (set || opts.hideWarn) ? '' : `<div class="risk-note"><span>${esc(warn)}</span></div>`;
  if (ui.pending) {
    return note + `<p class="lead-sm"><b>@${esc(ui.pending)}</b> — ${esc(set ? t('usernameChangeTo') : t('usernameSetTo'))}</p>`
      + `<div class="detail-actions"><button type="button" class="btn primary" data-uconfirm="${kind}">${esc(set ? t('usernameYesChange') : t('usernameYesSet'))}</button><button type="button" class="btn" data-uback="${kind}">${esc(t('back'))}</button></div>`;
  }
  const st = usernameStatusMsg(ui.res);
  // Ronde 68 (Arah C): baris hint diganti dua centang aturan format
  // (pola .pw-rules form reset R63); baris status server tetap ada.
  const fc = usernameFormatChecks(ui.draft || '');
  const rules = opts.checks
    ? `<ul class="pw-rules"><li data-uname-rule="len"${fc.len ? ' class="ok"' : ''}><span class="rule-dot"></span><span>${esc(t('usernameRuleLen'))}</span></li><li data-uname-rule="chars"${fc.chars ? ' class="ok"' : ''}><span class="rule-dot"></span><span>${esc(t('usernameRuleChars'))}</span></li></ul>`
    : `<div class="hint">${esc(t('usernameHint'))}</div>`;
  return note + `<form class="wal-panel" data-username-form="${kind}" novalidate><div class="field"><label for="uname-${kind}">${esc(isTrader ? t('usernameTraderLbl') : t('usernameFollowerLbl'))}</label><input id="uname-${kind}" data-username-input="${kind}" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(ui.draft || '')}">${rules}<div class="hint${st.cls ? ' ' + st.cls : ''}" data-username-status="${kind}">${esc(st.txt)}</div></div>`
    + `<div class="form-err" data-username-err="${kind}" role="alert"></div><div class="detail-actions"><button type="submit" class="btn primary" data-username-submit="${kind}"${usernameCanSubmit(kind) ? '' : ' disabled'}>${esc(set ? t('usernameChangeBtn') : t('usernameCreateBtn'))}</button></div></form>`;
}
function paintUsernameStatus(kind, root = document) {
  const ui = S.usernameUI[kind];
  const st = usernameStatusMsg(ui.res);
  const el = root.querySelector(`[data-username-status="${kind}"]`);
  if (el) {
    el.textContent = st.txt;
    el.classList.remove('ok', 'bad');
    if (st.cls) el.classList.add(st.cls);
  }
  const b = root.querySelector(`[data-username-submit="${kind}"]`);
  if (b) b.disabled = !usernameCanSubmit(kind);
  // Ronde 68 (Arah C): perbarui centang aturan format dari draft
  // (client-side, tanpa menunggu cek server). No-op bila form ini tidak
  // punya baris centang (alur lain: Akun, follower).
  const fc = usernameFormatChecks(ui.draft || '');
  const lenEl = root.querySelector('[data-uname-rule="len"]');
  if (lenEl) lenEl.classList.toggle('ok', fc.len);
  const chEl = root.querySelector('[data-uname-rule="chars"]');
  if (chEl) chEl.classList.toggle('ok', fc.chars);
}
function bindUsernameForm(root, kind, onDone) {
  const ui = S.usernameUI[kind];
  const input = root.querySelector(`[data-username-input="${kind}"]`);
  if (input) {
    input.addEventListener('input', () => {
      const v = input.value.trim().replace(/^@+/, '');
      ui.draft = v;
      ui.res = null;
      paintUsernameStatus(kind, root);
      clearTimeout(ui.timer);
      if (!v) return;
      // R28: nama yang sama dengan username saat ini TIDAK dicek
      // ketersediaannya — server memang menjawab "tersedia" untuk nama
      // sendiri (taken check mengecualikan diri), tapi menampilkan itu
      // menyesatkan: tidak ada yang berubah untuk diubah. Status dibiarkan
      // kosong dan tombol tetap nonaktif (usernameCanSubmit).
      const cur = kind === 'trader' ? (S.trader?.username || '') : (S.profile?.username || '');
      if (v === cur) return;
      ui.timer = setTimeout(async () => {
        try {
          const r = await api.checkUsername(kind, v);
          if (ui.draft !== v) return;
          ui.res = r;
        } catch (e) {
          ui.res = null;
        }
        paintUsernameStatus(kind, root);
      }, 250);
    });
  }
  const form = root.querySelector(`[data-username-form="${kind}"]`);
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!ui.draft) return;
      // R28: jangan tampilkan langkah konfirmasi untuk nama yang sama
      // dengan username saat ini (tombol sudah nonaktif, ini jaring
      // pengaman bila form tersubmit lewat jalan lain).
      const cur = kind === 'trader' ? (S.trader?.username || '') : (S.profile?.username || '');
      if (ui.draft === cur) return;
      try {
        const r = await api.checkUsername(kind, ui.draft);
        if (!r.ok) {
          ui.res = r;
          paintUsernameStatus(kind, root);
          const er = root.querySelector(`[data-username-err="${kind}"]`);
          if (er) er.textContent = usernameStatusMsg(r).txt;
          return;
        }
        ui.pending = r.value || ui.draft;
        onDone();
      } catch (err) {
        toast(t('errNetwork'), true);
      }
    });
  }
  const confirmBtn = root.querySelector(`[data-uconfirm="${kind}"]`);
  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      const value = ui.pending;
      ui.pending = null;
      confirmBtn.disabled = true;
      try {
        let res;
        if (kind === 'trader') {
          // Ronde 68 (Arah C): field nama tampilan dihapus dari halaman
          // Trader (user 2026-11-28: ubah nama sudah ada di menu Akun).
          // Display name yang dikirim = nama profil saat ini, fallback
          // username bila kosong. TANPA perubahan server.
          // BUTIR TERBUKA: apakah ubah nama profil di Akun harus ikut
          // mengubah display name trader? Belum diputuskan user.
          const displayName = S.trader?.trader_display_name
            || S.profile?.display_name?.trim()
            || value;
          res = await api.setupTraderIdentity(value, displayName);
        } else {
          res = await api.setFollowerUsername(value);
        }
        if (!res.ok) {
          toast(rpcErrorMessage(res), true);
          onDone();
          return;
        }
        ui.draft = '';
        ui.res = null;
        toast(t('usernameSet') + '@' + value);
        await refreshIdentity();
        onDone();
      } catch (err) {
        toast(t('errNetwork'), true);
        onDone();
      }
    });
  }
  const backBtn = root.querySelector(`[data-uback="${kind}"]`);
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      ui.pending = null;
      onDone();
    });
  }
}

// ------------------------------------------- Trader & Follower (R38) ---
// R38: Ruang Kerja dipecah jadi dua menu (Trader + Follower) —
// role-toggle dihapus; tiap menu merender cabangnya sendiri.
async function renderTraderWork() {
  const body = $('#trader-work-body');
  if (!body) return;
  if (!S.trader) {
    // D04: belum ada identitas trader — tampilkan banner + form penyiapan
    // username (komponen D05). Ronde 68 (Arah C): kartu sempit di tengah,
    // hanya field username. Field nama tampilan dihapus (ubah nama sudah
    // ada di menu Akun) dan banner merah muda dihapus (warnbar di atas
    // sudah menyatakan syarat sekali).
    body.innerHTML = `<div class="warnbar" role="alert">${esc(t('officeNeedUsernameBanner'))}</div>`
      + `<div class="subcard narrow-card" style="margin-top:14px;"><h3>${esc(t('officeIdentityTitle'))}</h3>`
      // R11/D3: pembungkus LUAR sengaja <div>, bukan <form> — usernameFormHtml
      // me-render <form> sendiri; form bersarang dibuang parser HTML sehingga
      // tombol "Buat username" dulu mati (submit native ke /?).
      + `<div id="id-username-wrap">${usernameFormHtml('trader', { hideWarn: true, checks: true })}</div></div>`;
    bindUsernameForm(body, 'trader', () => renderTraderWork());
    return;
  }
  await renderOfficeTrader(body);
}

async function renderFollowerWork() {
  const body = $('#follower-work-body');
  if (!body) return;
  await renderOfficeFollower(body);
}

function traderIdentityCardHtml() {
  const tr = S.trader;
  const p = progressOf(tr);
  const level = p ? Number(p.level) || 1 : 1;
  const verified = level >= PAY_GATE_LEVEL ? ` <span class="pill gold">${ICONS.check} ${esc(t('verified'))}</span>` : '';
  const username = tr.username ? '@' + tr.username : '—';
  const price = tr.subscription_price_usd;
  const subLabel = price !== null && price !== undefined && Number(price) > 0
    ? `${esc(t('subscribe'))} ${esc(fmtIdr(price))}${esc(t('perMonth'))}` : esc(t('profFree'));
  const draftDel = !!S.photoDraft.trader;
  const uploadDraft = !!S.photoUploadDraft.trader;
  const avUrl = draftDel ? null : (S.photoUploadPreview.trader || tr.trader_avatar_url);
  return `<div class="card">
    <div class="board-top">
      ${avatarImg(username, tr.profile_id, avUrl, 'avatar-md')}
      <div style="min-width:0; flex:1;">
        <div style="font-weight:800; font-size:16px;">${esc(username)}${verified}${demoBadge(tr.profile_id)}</div>
        <div style="font-size:13px; color:var(--muted);">Level ${level} · ${esc(levelName(level, getLang()))} · ${subLabel}</div>
      </div>
      <button class="iconbtn" id="trader-share-btn" type="button" aria-label="${esc(t('shareTrader'))}">${ICONS.share}</button>
      <input type="file" id="trader-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
      <label class="iconbtn" for="trader-photo-input" title="${esc(t('photoChangeTrader'))}" style="cursor:pointer;">${ICONS.camera}</label>
      ${avUrl && !uploadDraft ? `<button class="iconbtn trashbtn" id="trader-photo-del" type="button" aria-label="${esc(t('photoRemoveTrader'))}" title="${esc(t('photoRemoveTrader'))}">${ICONS.trash}</button>` : ''}
    </div>
    ${draftDel || uploadDraft ? `<div class="avatar-edit">
      ${draftDel ? `<span class="note">${esc(t('photoRemoveDraft'))}</span>` : ''}
      <button class="btn primary compact" id="trader-photo-done" type="button">${esc(t('doneBtn'))}</button><button class="btn compact" id="trader-photo-cancel" type="button">${esc(t('cancel'))}</button>
    </div>` : ''}
  </div>`;
}

function avatarImg(name, id, url, sizeCls) {
  if (url) return `<img class="avatar ${sizeCls}" src="${esc(url)}" alt="" style="object-fit:cover;" />`;
  return avatarHtml(name, id, sizeCls);
}
// B3-06: pilih foto hanya men-stage draft (pratinjau) — foto baru
// diterapkan HANYA saat pengguna menekan "Selesai", seperti alur hapus
// foto dan seperti prototipe (memilih foto yang salah masih bisa dibatalkan).
function bindPhotoInput(inputId, target) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast(t('photoError'), true); input.value = ''; return; }
    if (S.photoUploadPreview[target]) URL.revokeObjectURL(S.photoUploadPreview[target]);
    S.photoUploadDraft[target] = file;
    S.photoUploadPreview[target] = URL.createObjectURL(file);
    S.photoDraft[target] = false; // foto baru membatalkan draft hapus
    if (S.view === 'office-trader') renderOfficeTraderTab();
    if (S.view === 'profile') renderProfile();
    input.value = '';
  });
}

// A-01: muat ulang daftar trader agar foto baru/hapus foto langsung tampil
// di feed, Cari, dan Peringkat (bukan hanya di Profil/Ruang Kerja).
async function refreshTraders() {
  try { S.traders = await api.listTraders(); } catch (e) { /* abaikan */ }
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
  // Kartu identitas + saldo/level HANYA di sub-tab Profil (prototipe);
  // sub-tab Sinyal langsung menampilkan form posting.
  let html = `<div class="subtabs" role="tablist">
    <button class="subtab" role="tab" data-otab="sinyal" aria-selected="${S.officeTraderTab === 'sinyal'}">${esc(t('profTabSignals'))}</button>
    <button class="subtab" role="tab" data-otab="profil" aria-selected="${S.officeTraderTab === 'profil'}">${esc(t('profTabProfile'))}</button>
    <button class="subtab" role="tab" data-otab="langganan" aria-selected="${S.officeTraderTab === 'langganan'}">${esc(t('officeTraderTabSubs'))}</button>
  </div><div id="office-trader-body"></div>`;
  box.innerHTML = html;
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
    const tr = S.trader;
    const resetRow = (k, v) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line);"><span style="color:var(--muted);">${esc(k)}</span><b>${esc(v)}</b></div>`;
    // Ronde 35: kartu Reset statistik — data live dari trader_progress.
    // _addMonth mengikuti prototipe (jepit ke hari terakhir bulan).
    const addMonth = (d) => { const e = new Date(d); const day = e.getDate(); e.setDate(1); e.setMonth(e.getMonth() + 1); e.setDate(Math.min(day, new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate())); return e; };
    const rprog = progressOf(S.trader);
    const rLast = rprog?.last_reset_at ? new Date(rprog.last_reset_at) : null;
    const rCdUntil = rprog?.reset_cooldown_until ? new Date(rprog.reset_cooldown_until) : null;
    const rInCd = !!(rCdUntil && rCdUntil.getTime() > Date.now());
    const rNext = rLast ? addMonth(rLast) : null;
    const rIsDemo = !!S.trader?.is_demo;
    const rCanReset = !rInCd && (rIsDemo || !rLast || (rNext && Date.now() >= rNext.getTime()));
    const rNextTxt = rCanReset ? t('resetNow') : (rNext ? fmtDate(rNext.toISOString()) : t('resetNow'));
    box.innerHTML = `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('officeIdentityTitle'))}</h2>`
      + `<p class="sub">${esc(t('officeIdentitySub'))}</p>`
      + traderIdentityCardHtml()
      + balanceCardHtml()
      + `<div class="subcard" style="margin-top:14px;">
          <h3>${esc(t('resetTitle'))}</h3>
          <p>${esc(t('resetDesc'))}</p>
          ${resetRow(t('resetRule'), t('resetOnceMonth'))}
          ${resetRow(t('resetLast'), rLast ? fmtDate(rLast.toISOString()) : '—')}
          ${resetRow(t('resetNext'), rNextTxt)}
          ${rInCd ? `<p class="note" style="color:var(--sell);">${esc(t('resetInCooldown', { date: fmtDate(rCdUntil.toISOString()) }))}</p>` : ''}
          <div style="margin-top:12px;"><button class="btn primary compact" type="button" id="reset-btn"${rCanReset ? '' : ' disabled'}>${esc(t('resetBtn'))}</button></div>
          ${(!rCanReset && !rInCd) ? `<p class="note">${esc(t('resetNotYet'))}</p>` : ''}
        </div>`
      + statsSectionHtml(st, 'officeStatsTitle', null, '', 'office');
    bindPhotoInput('trader-photo-input', 'trader');
    // Ronde 35: reset butuh dialog konfirmasi (tindakan destruktif).
    const resetBtn = $('#reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const yes = await confirmDialog(t('resetConfirmTitle'), t('resetConfirmBody'), t('resetConfirmYes'));
        if (!yes) return;
        resetBtn.disabled = true;
        try {
          const res = await api.resetTraderStats();
          if (!res.ok) { toast(rpcErrorMessage(res), true); return; }
          toast(t('toastResetDone', { n: res.deleted ?? 0, subs: res.paused ?? 0 }));
          invalidateAllSignals();
          await refreshIdentity();
          await renderTraderWork();
        } catch (err) {
          toast(t('errNetwork'), true);
        } finally {
          resetBtn.disabled = false;
        }
      });
    }
    const trShare = $('#trader-share-btn');
    if (trShare) {
      // R9-5 (B-05): bagikan kartu PNG portofolio (dulu hanya teks).
      trShare.addEventListener('click', async () => { await downloadPortfolioCard(tr); });
    }
    const trDel = $('#trader-photo-del');
    if (trDel) {
      trDel.addEventListener('click', () => {
        S.photoDraft.trader = true;
        renderOfficeTraderTab();
      });
    }
    const trDone = $('#trader-photo-done');
    if (trDone) {
      trDone.addEventListener('click', async () => {
        try {
          if (S.photoUploadDraft.trader) {
            // Terapkan foto yang di-stage (hapus file lama setelah
            // unggahan baru berhasil — A-05).
            const oldUrl = S.trader?.trader_avatar_url || null;
            await api.uploadAvatar(S.photoUploadDraft.trader, S.user.id, { target: 'trader', oldUrl });
            S.photoUploadDraft.trader = null;
            if (S.photoUploadPreview.trader) { URL.revokeObjectURL(S.photoUploadPreview.trader); S.photoUploadPreview.trader = ''; }
            toast(t('photoUploaded'));
          } else if (S.photoDraft.trader) {
            await api.deleteAvatar(S.user.id, { target: 'trader' });
            S.photoDraft.trader = false;
            toast(t('photoRemoveTrader'));
          }
          await refreshIdentity();
          await refreshTraders(); // A-01: foto baru tampil di feed/Cari/Peringkat
          renderOfficeTraderTab();
        } catch (e) {
          toast(t('photoError'), true);
        }
      });
    }
    // A-04: draft (upload maupun hapus) bisa dibatalkan.
    const trCancel = $('#trader-photo-cancel');
    if (trCancel) {
      trCancel.addEventListener('click', () => {
        if (S.photoUploadPreview.trader) { URL.revokeObjectURL(S.photoUploadPreview.trader); S.photoUploadPreview.trader = ''; }
        S.photoUploadDraft.trader = null;
        S.photoDraft.trader = false;
        renderOfficeTraderTab();
      });
    }
    const balGuide = $('#bal-guide-link');
    if (balGuide) balGuide.addEventListener('click', () => openGuideSection('level'));
    bindMonthYear('office', () => renderOfficeTraderTab());
    bindChartYear('office', () => renderOfficeTraderTab());
    updateBoardScrollHints(box);
    return;
  }
  if (S.officeTraderTab === 'langganan') {
    box.innerHTML = `<div class="empty"><strong>${esc(t('officeSubsEmpty'))}</strong>${esc(t('officeSubsNote'))}</div>`;
    return;
  }
  const ed = editing !== null ? editing : (S.editingId ? S.mySignals.find((s) => s.id === S.editingId) || null : null);
  const openCount = S.mySignals.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF').length;
  const doneCount = S.mySignals.filter((s) => ['WIN', 'LOSS'].includes(s.status)).length; // B2-07: hanya WIN/LOSS (daftar Riwayat tidak menampilkan CANCELLED/EXPIRED)
  const lastPost = S.mySignals.length
    ? S.mySignals.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b))
    : null;
  const daysSincePost = lastPost ? Math.floor((Date.now() - new Date(lastPost.created_at).getTime()) / 86400000) : null;
  const lastPostTxt = !lastPost ? t('lastPostNever')
    : (daysSincePost === 0 ? t('lastPostToday') : t('lastPostDays', { n: daysSincePost }));
  const inactWarnHtml = daysSincePost !== null && daysSincePost >= 23
    ? ` <span class="inact-warn">${esc(t('inactWarn', { d: 30 - daysSincePost }))}</span>` : '';
  const chip = (val, label, n) => `<button class="chip" type="button" data-olist="${val}" aria-pressed="${S.officeTab === val}">${esc(label)}${n !== undefined ? ` (${n})` : ''}</button>`;
  let html = signalFormHtml(ed);
  html += `<h2 style="font-size:16px; margin: 18px 0 10px;">${esc(t('officeMySignalsTitle'))}</h2>`;
  html += `<p class="sub">${esc(t('lastPostLabel'))}: ${esc(lastPostTxt)}${inactWarnHtml}</p>`;
  html += `<div class="pfilters">${chip('ALL', t('pfAll', { n: openCount }))}${chip('PENDING', t('pfPending'))}${chip('AKTIF', t('pfActive'))}<button class="chip hist-tab" type="button" data-olist="HISTORY" aria-pressed="${S.officeTab === 'HISTORY'}">${esc(t('tabHistory'))} (${doneCount})</button></div>`;
  html += `<div id="office-list"><p class="sub">${esc(t('loading'))}</p></div>`;
  box.innerHTML = html;
  bindSignalForm(ed);
  $$('#office-trader-body [data-olist]').forEach((b) => {
    b.addEventListener('click', () => {
      S.officeTab = b.dataset.olist;
      $$('#office-trader-body [data-olist]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.olist === S.officeTab)));
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
    if (S.officeTab === 'HISTORY') return ['WIN', 'LOSS'].includes(s.status);
    return s.status === 'PENDING' || s.status === 'AKTIF'; // ALL = sinyal terbuka
  });
  if (S.officeTab === 'HISTORY') {
    // Riwayat sebagai jurnal (tanpa judul tambahan) + chip rentang tanggal.
    const range = S.officeRange;
    const sorted = filtered.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const shown = sorted.filter((s) => withinHistRange(s.closed_at || s.created_at, range, S.officeCustom));
    list.innerHTML = `<div class="pfilters"><button class="chip" type="button" data-orng="ALL" aria-pressed="${range === 'ALL'}">${esc(t('rangeAll'))}</button>${dateFilterBarHtml('office')}</div>`
      + (shown.length
        ? `<div class="hist journal-scroll tall" tabindex="0">` + shown.map((s) => journalRowHtml(s)).join('') + `</div>`
        : `<div class="empty"><strong>${esc(range === 'ALL' ? t('officeEmptyHistory') : t('histEmptyRange'))}</strong></div>`);
    $$('[data-orng]', list).forEach((b) => {
      b.addEventListener('click', () => {
        S.officeRange = b.dataset.orng;
        renderOfficeList();
      });
    });
    bindDateFilter(list, 'office', () => renderOfficeList());
    bindJournalRows(list);
    return;
  }
  if (filtered.length === 0) {
    // D44: kosong tanpa sinyal sama sekali -> officeNoSignals; ada sinyal
    // tapi tidak ada yang terbuka -> officeNoOpenSignals; ada sinyal terbuka
    // tapi tidak cocok filter -> profNoFilter.
    const anyOpen = S.mySignals.some((s) => s.status === 'PENDING' || s.status === 'AKTIF');
    const emptyKey = S.mySignals.length === 0 ? 'officeNoSignals'
      : !anyOpen ? 'officeNoOpenSignals' : 'profNoFilter';
    list.innerHTML = `<div class="empty"><strong>${t(emptyKey)}</strong></div>`;
    return;
  }
  // R20: feed Trader 2 kolom di web (seperti Beranda) — bungkus
  // .feed-grid; Riwayat (jurnal) tidak disentuh.
  list.innerHTML = `<div class="feed-grid">` + filtered.map(signalCardHtml).join('') + `</div>`;
  bindSignalCards(list);
}

// ---------------------------------------------------------- Follower ---
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
  // Ronde 39: ruang kerja follower jadi 2 sub-menu (gaya tab Ruang Kerja
  // Trader): Sinyal (default) + Salinan aktif (berisi Riwayat salinan).
  // Tab Jurnal sudah dihapus Ronde 36 — tidak kembali.
  const html = `<div class="subtabs" role="tablist">
    <button class="subtab" role="tab" data-ftab="signals" aria-selected="${S.followerTab === 'signals'}">${esc(t('profTabSignals'))}</button>
    <button class="subtab" role="tab" data-ftab="copies" aria-selected="${S.followerTab === 'copies'}">${esc(t('officeActiveCopies'))}</button>
  </div><div id="office-follower-body"></div>`;
  box.innerHTML = html;
  $$('[data-ftab]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.followerTab = b.dataset.ftab;
      renderOfficeFollowerTab();
    });
  });
  renderOfficeFollowerTab();
}
function renderOfficeFollowerTab() {
  const box = $('#office-follower-body');
  if (!box) return;
  // Perbarui aria-selected subtab.
  $$('[data-ftab]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.ftab === S.followerTab)));
  const followedIds = new Set(S.myFollows.map((x) => x.trader_id));
  const followedSignals = S.allSignals
    .filter((s) => followedIds.has(s.trader_id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (S.followerTab === 'copies') {
    // R39: tab Salinan aktif — HANYA daftar salinan aktif. Riwayat tetap
    // di tab Sinyal (koreksi user: jangan pindah).
    // D14: salinan aktif memakai journalRowHtml(isCopy) — floating/waiting
    // + hapus salinan (non-AKTIF).
    const activeCopies = S.myCopies
      .map((c) => ({ sig: one(c.signals) || c.signal_snapshot, copyId: c.id, copyCreatedAt: c.created_at }))
      .filter((x) => x.sig && (x.sig.status === 'PENDING' || x.sig.status === 'AKTIF'));
    const html = `<h2 style="font-size:16px; margin: 6px 0 10px;">${esc(t('officeActiveCopies'))} (${activeCopies.length})</h2>`
      + (activeCopies.length
        ? `<div class="hist journal-scroll" tabindex="0">` + activeCopies.map((x) => journalRowHtml(x.sig, { showTrader: true, isCopy: true, copyId: x.copyId, copyCreatedAt: x.copyCreatedAt })).join('') + `</div>`
        : `<div class="empty"><strong>${S.myCopies.length === 0 ? t('jrnlEmpty') : t('jrnlNoActive')}</strong></div>`);
    box.innerHTML = html;
    bindJournalRows(box);
    return;
  }
  // R39: tab Sinyal (default) — sinyal terbuka dari trader yang diikuti
  // (chip Semua/Pending/Aktif) + Riwayat salinan selesai (chip Riwayat +
  // filter tanggal). Persis bagian Sinyal lama, hanya menjadi tab sendiri.
  // (Ronde 15 #2: sub-tab "Diikuti" dihapus — daftar trader yang diikuti
  // kini di Cari lewat filter "Diikuti saja"; daftar langganan tidak
  // lagi punya tampilan sendiri, data/fungsi langganan tetap utuh.)
  const f = S.followFilter;
  const openSigs = followedSignals.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF');
  // B2-02: Riwayat pengikut hanya salinan yang SUDAH selesai (WIN/LOSS),
  // bukan semua sinyal dari trader yang diikuti (prototipe).
  const doneCopies = S.myCopies
    .map((c) => ({ sig: one(c.signals) || c.signal_snapshot, copy: c }))
    .filter((x) => x.sig && ['WIN', 'LOSS'].includes(x.sig.status));
  const doneSigs = doneCopies.map((x) => x.sig);
  const fchip = (val, label, n) => `<button class="chip" type="button" data-ffilter="${val}" aria-pressed="${f === val}">${esc(label)}${n !== undefined ? ` (${n})` : ''}</button>`;
  const filtersHtml = `<div class="pfilters">${fchip('ALL', t('pfAll', { n: openSigs.length }))}${fchip('PENDING', t('pfPending'))}${fchip('AKTIF', t('pfActive'))}<button class="chip hist-tab" type="button" data-ffilter="HISTORY" aria-pressed="${f === 'HISTORY'}">${esc(t('tabHistory'))} (${doneSigs.length})</button></div>`;
  let html = `<h2 style="font-size:16px; margin: 6px 0 10px;">${esc(t('officeFollowSignals'))}</h2>`;
  html += filtersHtml;
  if (f === 'HISTORY') {
    // B2-03: baris terpisah — chip "Semua" + Filter tanggal (seperti
    // Riwayat trader); rentang memakai waktu salin (prototipe).
    const range = S.followerRange;
    const shown = doneCopies.filter((x) => withinHistRange(x.copy.created_at, range, S.followerCustom));
    html += `<div class="pfilters"><button class="chip" type="button" data-frng="ALL" aria-pressed="${range === 'ALL'}">${esc(t('rangeAll'))}</button>${dateFilterBarHtml('follower')}</div>`;
    html += shown.length
      ? `<div class="hist journal-scroll tall" tabindex="0">` + shown.map((x) => journalRowHtml(x.sig, { showTrader: true, isCopy: true, copyCreatedAt: x.copy.created_at })).join('') + `</div>`
      : `<div class="empty"><strong>${esc(range === 'ALL' ? t('officeCopyHistoryEmpty') : t('histEmptyRange'))}</strong></div>`;
  } else {
    const shown = f === 'ALL' ? openSigs : openSigs.filter((s) => s.status === f);
    if (!S.myFollows.length) {
      html += `<div class="empty"><strong>${t('officeFollowedEmpty')}</strong></div>`;
    } else if (!shown.length) {
      html += `<div class="empty"><strong>${esc(t('officeFollowSignalsEmpty'))}</strong></div>`;
    } else {
      // Ronde 15 (#4): daftar sinyal diikuti sebagai grid 2 kolom di web.
      html += `<div class="feed-grid">` + shown.map(signalCardHtml).join('') + `</div>`;
    }
  }
  box.innerHTML = html;
  $$('[data-ffilter]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.followFilter = b.dataset.ffilter;
      renderOfficeFollowerTab();
    });
  });
  $$('[data-frng]', box).forEach((b) => {
    b.addEventListener('click', () => {
      S.followerRange = b.dataset.frng;
      renderOfficeFollowerTab();
    });
  });
  bindDateFilter(box, 'follower', () => renderOfficeFollowerTab());
  bindSignalCards(box);
  bindJournalRows(box);
}

// ------------------------------------------------------------- KYC (Zyphe) ---
// D20: struktur alur 4 langkah prototipe (dokumen → KTP → selfie/liveness
// → memverifikasi). Backend verifikasi Zyphe belum ada — langkah terakhir
// menampilkan pesan "menyusul" yang jujur; TIDAK ada keberhasilan palsu.
function openKycFlow() {
  const f = S.kycFlow;
  const step = f.step;
  const steps = [t('kycStepDoc'), t('kycStepKtp'), t('kycStepSelfie'), t('kycStepVerify')];
  // R57 arah C (pilihan user 2026-11-27): daftar 4 nama langkah dihapus, yang
  // tampil hanya nama langkah SAAT INI (besar, = penjelasan langkah itu) +
  // 4 titik progres. Nama besar tanpa awalan nomor: pill di header sudah
  // membawa "Langkah n dari 4".
  let body = `<div class="kyc-current"><div class="kyc-cur-name">${esc(steps[step - 1])}</div><div class="kyc-dots" aria-hidden="true">${steps.map((_, i) => `<span class="kyc-dot${i + 1 < step ? ' done' : i + 1 === step ? ' cur' : ''}"></span>`).join('')}</div></div>`;
  if (step === 1) {
    body += `<div class="field"><label for="kyc-name">${esc(t('kycNameLbl'))}</label><input id="kyc-name" maxlength="80" value="${esc(f.name || S.profile?.display_name || '')}" placeholder="${esc(t('kycNamePh'))}"></div>`;
    body += `<div class="detail-actions"><button class="btn primary" id="kyc-next" type="button">${esc(t('kycNext'))}</button></div>`;
  } else if (step === 2) {
    // R57: lead-sm dihapus, teksnya identik dengan nama besar di atas
    // (t('kycStepKtp')); nama besar kini menjadi penjelasannya. Isi lain tetap.
    body += `<div class="detail-actions"><button class="btn" id="kyc-demo-ktp" type="button">${esc(t('kycDemoKtp'))}</button></div>`
      + (f.ktpAttached ? `<p class="note ok">${esc(t('kycKtpAttached'))}</p>` : '')
      + `<div class="detail-actions"><button class="btn" id="kyc-back" type="button">${esc(t('back'))}</button><button class="btn primary" id="kyc-next" type="button" ${f.ktpAttached ? '' : 'disabled'}>${esc(t('kycNext'))}</button></div>`;
  } else if (step === 3) {
    // R57: lead-sm dihapus, identik dengan nama besar (t('kycStepSelfie')).
    body += `<div class="detail-actions"><button class="btn" id="kyc-back" type="button">${esc(t('back'))}</button><button class="btn primary" id="kyc-next" type="button">${esc(t('kycNext'))}</button></div>`;
  } else {
    body += `<p class="lead-sm">${esc(t('kycSoon'))}</p>`
      + `<p class="note">${esc(t('kycDocsNote'))}</p>`
      + `<div class="detail-actions"><button class="btn primary" id="kyc-close" type="button">${esc(t('close'))}</button></div>`;
  }
  openOverlay(`<div class="overlay-head"><h2>${esc(t('kycTitle'))}</h2><span class="spacer"></span><span class="pill">${esc(t('kycStepLbl', { step, total: 4 }))}</span></div>${body}`);
  const next = $('#kyc-next');
  if (next) {
    next.addEventListener('click', () => {
      if (f.step === 1) f.name = $('#kyc-name')?.value?.trim() || f.name;
      f.step = Math.min(4, f.step + 1);
      openKycFlow();
    });
  }
  const back = $('#kyc-back');
  if (back) back.addEventListener('click', () => { f.step = Math.max(1, f.step - 1); openKycFlow(); });
  const demo = $('#kyc-demo-ktp');
  if (demo) demo.addEventListener('click', () => { f.ktpAttached = true; openKycFlow(); });
  const close = $('#kyc-close');
  if (close) close.addEventListener('click', () => { f.step = 1; f.ktpAttached = false; closeOverlay(); });
}

// -------------------------------------------------------------- Profil ---
// R24: susunan mengikuti preview yang disetujui (Pratinjau_Klik_Hidup.html):
// kepala profil (avatar + nama + "@username · Wilayah") lalu baris-baris
// menu (.prow): Verifikasi KYC + Detail akun, Pengaturan, Bantuan & Panduan.
// Status KYC TIDAK hilang — jadi baris pertama. Baris Keluar tetap
// hanya <900px (class logout-mobile). Pengaturan adalah sub-halaman sendiri
// (view-settings), bukan tumpukan kartu di sini.
// R25: Verifikasi KYC + Detail akun juga sub-halaman (S.profileSub),
// bukan panel lipat — klik baris masuk ke dalam, tombol kembali ke Profil.
async function renderProfile() {
  const body = $('#profile-body');
  const p = S.profile || {};
  const username = p.username ? '@' + esc(p.username) : esc(t('usernameNotSet'));
  const displayName = p.display_name || p.username || S.user?.email || '—';
  const kycStatus = p.kyc_status || 'none';
  const kycVerified = kycStatus === 'verified';
  const kycSub = kycVerified ? t('kycVerified') : kycStatus === 'rejected' ? t('kycRejected') : t('kycNotVerified');
  // D63: ID akun SM-XXXX-XXXX (4 + 4 karakter dari UUID tanpa tanda hubung).
  const uidHex = String(S.user?.id || '').replace(/-/g, '').toUpperCase();
  const uid = 'SM-' + uidHex.slice(0, 4) + '-' + uidHex.slice(4, 8);
  // R25: sub-halaman Profil — klik baris KYC / Detail akun masuk ke dalam
  // (seperti Pengaturan), bukan membuka panel ke bawah.
  if (S.profileSub === 'kyc' || S.profileSub === 'detail') {
    const isKyc = S.profileSub === 'kyc';
    const kycBody = `<div class="kyc-row">${kycVerified
      ? `<span class="stchip ok">${esc(t('kycVerified'))}</span>${p.kyc_full_name ? `<span>${esc(p.kyc_full_name)}</span>` : ''}${p.kyc_reference ? `<span class="kyc-ref mono">${esc(t('kycRef'))} ${esc(p.kyc_reference)}</span>` : ''}`
      : kycStatus === 'rejected'
        ? `<span class="stchip bad">${esc(t('kycRejected'))}</span>${p.kyc_reject_reason ? `<span>${esc(t('kycRejectReason', { reason: p.kyc_reject_reason }))}</span>` : ''}<button class="btn" type="button" id="kyc-start-btn">${esc(t('kycRetry'))}</button>`
        : `<span style="color:var(--muted);">${esc(t('kycNotVerified'))}</span><button class="btn" type="button" id="kyc-start-btn">${esc(t('kycVerifyBtn'))}</button>`}</div>`
      + (kycVerified ? `<p>${esc(t('kycNameLocked'))}</p><p class="note">${esc(t('kycDocsNote'))}</p>` : '');
    const detailBody = `<div class="menurow"><span class="grow"><span class="t">${esc(t('uid'))}</span><span class="d">${esc(uid)}</span></span></div>`
      + `<div class="menurow"><span class="grow"><span class="t">${esc(t('profileName'))}</span><span class="d">${esc(p.display_name || '—')}</span></span></div>`
      + `<div class="menurow"><span class="grow"><span class="t">${esc(t('username'))}</span><span class="d">${username}</span></span></div>`
      + `<div class="menurow"><span class="grow"><span class="t">${esc(t('region'))}</span><span class="d">Indonesia</span></span></div>`;
    body.innerHTML = `<button class="btn backbtn" id="profile-sub-back" type="button">${esc(t('backProfile'))}</button>`
      + `<div class="page-head"><h2>${esc(isKyc ? t('kycTitle') : t('accountDetail'))}</h2></div>`
      + `<div class="subcard">${isKyc ? kycBody : detailBody}</div>`;
    $('#profile-sub-back').addEventListener('click', () => { S.profileSub = null; renderProfile(); });
    const kycBtn = $('#kyc-start-btn');
    if (kycBtn) kycBtn.addEventListener('click', () => openKycFlow());
    return;
  }
  // R41: Tampilan / Notifikasi / Bahasa pindah dari Pengaturan ke Profil:
  // pakai ulang renderer Pengaturan yang sama; kembali ke Profil (bukan
  // Pengaturan). State Pengaturan dibersihkan supaya tombol kembali tidak
  // salah lompat ke sub-halaman Pengaturan yang sudah ditinggalkan.
  if (S.profileSub === 'appearance' || S.profileSub === 'notifications' || S.profileSub === 'language') {
    S.settingsOrigin = 'profile';
    S.settingsSub = null; S.acctPage = null; S.secPage = null;
    if (S.profileSub === 'appearance') renderSettingsAppearance(body);
    else if (S.profileSub === 'notifications') renderSettingsNotifications(body);
    else renderSettingsLanguage(body);
    return;
  }
  body.innerHTML = `
    <div class="profile-head">
      ${avatarImg(displayName, S.user.id, S.photoDraft.profile ? null : (S.photoUploadPreview.profile || p.avatar_url), 'avatar-lg')}
      <div class="profile-id">
        <div class="profile-name">${esc(displayName)}</div>
        <div class="profile-user">${username} · Indonesia</div>
      </div>
      <button class="iconbtn" id="profile-photo-btn" type="button" aria-label="${esc(t('photoChange'))}">${ICONS.camera}</button>
      <input type="file" id="profile-photo-input" accept="image/jpeg,image/png,image/webp,image/gif" hidden />
      ${p.avatar_url && !S.photoDraft.profile && !S.photoUploadDraft.profile ? `<button class="iconbtn trashbtn" id="profile-photo-del" type="button" aria-label="${esc(t('photoRemove'))}" title="${esc(t('photoRemove'))}">${ICONS.trash}</button>` : ''}
    </div>
    ${S.photoUploadDraft.profile || S.photoDraft.profile ? `<div class="avatar-edit" style="margin-top:10px;">${S.photoDraft.profile ? `<span class="note">${esc(t('photoRemoveDraft'))}</span>` : ''}<button class="btn primary compact" id="profile-photo-done" type="button">${esc(t('doneBtn'))}</button><button class="btn compact" id="profile-photo-cancel" type="button">${esc(t('cancel'))}</button></div>` : ''}
    <button type="button" class="prow" id="prow-kyc"><span class="ic">${ICONS.lock}</span><span class="lbl">${esc(t('kycTitle'))}<span class="sub">${esc(kycSub)}</span></span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow" id="prow-detail"><span class="ic">${ICONS.user}</span><span class="lbl">${esc(t('accountDetail'))}</span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow" id="prow-appearance"><span class="ic">${ICONS.sun}</span><span class="lbl">${esc(t('theme'))}</span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow" id="prow-notifications"><span class="ic">${ICONS.bell}</span><span class="lbl">${esc(t('setNotif'))}</span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow" id="prow-language"><span class="ic">${ICONS.globe}</span><span class="lbl">${esc(t('language'))}</span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow" id="menu-settings"><span class="ic">${ICONS.sliders}</span><span class="lbl">${esc(t('settings'))}</span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow" id="menu-helpguide"><span class="ic">${ICONS.book}</span><span class="lbl">${esc(t('menuHelpGuide'))}</span><span class="ch">${ICONS.chevR}</span></button>
    <button type="button" class="prow danger logout-mobile" id="menu-logout"><span class="ic">${ICONS.logout}</span><span class="lbl">${esc(t('logout'))}</span></button>`;
  bindPhotoInput('profile-photo-input', 'profile');
  const photoDel = $('#profile-photo-del');
  if (photoDel) {
    photoDel.addEventListener('click', () => {
      S.photoDraft.profile = true;
      renderProfile();
    });
  }
  const photoDone = $('#profile-photo-done');
  if (photoDone) {
    photoDone.addEventListener('click', async () => {
      try {
        if (S.photoUploadDraft.profile) {
          const oldUrl = S.profile?.avatar_url || null;
          await api.uploadAvatar(S.photoUploadDraft.profile, S.user.id, { target: 'profile', oldUrl });
          S.photoUploadDraft.profile = null;
          if (S.photoUploadPreview.profile) { URL.revokeObjectURL(S.photoUploadPreview.profile); S.photoUploadPreview.profile = ''; }
          toast(t('photoUploaded'));
        } else if (S.photoDraft.profile) {
          await api.deleteAvatar(S.user.id, { target: 'profile' });
          S.photoDraft.profile = false;
          toast(t('photoRemoved'));
        }
        await refreshIdentity();
        await refreshTraders(); // A-01
        renderProfile();
      } catch (e) {
        toast(t('photoError'), true);
      }
    });
  }
  // A-04: draft (upload maupun hapus) bisa dibatalkan.
  const photoCancel = $('#profile-photo-cancel');
  if (photoCancel) {
    photoCancel.addEventListener('click', () => {
      if (S.photoUploadPreview.profile) { URL.revokeObjectURL(S.photoUploadPreview.profile); S.photoUploadPreview.profile = ''; }
      S.photoUploadDraft.profile = null;
      S.photoDraft.profile = false;
      renderProfile();
    });
  }
  const photoBtn = $('#profile-photo-btn');
  if (photoBtn) photoBtn.addEventListener('click', () => { const inp = $('#profile-photo-input'); if (inp) inp.click(); });
  $('#menu-settings').addEventListener('click', () => { S.settingsSub = null; S.settingsOrigin = 'settings'; showView('settings'); });
  $('#menu-helpguide').addEventListener('click', () => { S.guideSub = null; S.helpGuideTab = 'guide'; showView('helpguide'); });
  $('#menu-logout').addEventListener('click', doLogout);
  const prowKyc = $('#prow-kyc');
  if (prowKyc) prowKyc.addEventListener('click', () => { S.profileSub = 'kyc'; renderProfile(); });
  const prowDetail = $('#prow-detail');
  if (prowDetail) prowDetail.addEventListener('click', () => { S.profileSub = 'detail'; renderProfile(); });
  const prowAppearance = $('#prow-appearance');
  if (prowAppearance) prowAppearance.addEventListener('click', () => { S.profileSub = 'appearance'; renderProfile(); });
  const prowNotifications = $('#prow-notifications');
  if (prowNotifications) prowNotifications.addEventListener('click', () => { S.profileSub = 'notifications'; renderProfile(); });
  const prowLanguage = $('#prow-language');
  if (prowLanguage) prowLanguage.addEventListener('click', () => { S.profileSub = 'language'; renderProfile(); });
}

// ----------------------------------------------------------- Pengaturan ---
// Sub-halaman Pengaturan: Akun, Akun Penarikan, Kata sandi dan keamanan.
// R41: Tampilan / Notifikasi / Bahasa PINDAH ke menu Profil (S.profileSub);
// renderer ketiganya tetap di sini dan dipakai ulang dari Profil.
function renderSettings() {
  const body = $('#settings-body');
  if (!body) return;
  if (S.settingsSub !== 'account') S.acctPage = null; // R41: keluar Akun menutup halaman ubahnya
  if (S.settingsSub === 'account') { renderSettingsAccount(body); return; }
  if (S.settingsSub === 'security') { renderSettingsSecurity(body); return; }
  if (S.settingsSub === 'appearance') { renderSettingsAppearance(body); return; }
  if (S.settingsSub === 'notifications') { renderSettingsNotifications(body); return; }
  if (S.settingsSub === 'language') { renderSettingsLanguage(body); return; }
  if (S.settingsSub === 'withdraw') { renderSettingsWithdraw(body); return; }
  const rows = [
    ['account', t('setAccount')],
    ['withdraw', t('setWithdraw')],
    ['security', t('securityTitle')],
  ];
  body.innerHTML = `<button class="btn backbtn" id="set-back-profile" type="button">${esc(t('backProfile'))}</button>`
    + `<div class="page-head"><h2>${esc(t('settings'))}</h2></div>`
    // R41: daftar polos gaya Panduan (.prow: judul kiri + chevron kanan,
    // dipisah garis tipis), tanpa kartu .subcard, tanpa subjudul.
    + rows.map(([key, title]) =>
    `<button type="button" class="prow" data-setsub="${key}"><span class="lbl">${esc(title)}</span><span class="ch">${ICONS.chevR}</span></button>`
  ).join('');
  $('#set-back-profile').addEventListener('click', () => showView('profile'));
  $$('[data-setsub]', body).forEach((b) => {
    b.addEventListener('click', () => { S.settingsSub = b.dataset.setsub; S.settingsOrigin = 'settings'; S.secPage = null; S.acctPage = null; S.wdAdd = false; renderSettings(); });
  });
}
function settingsBackButton() {
  return `<button class="btn backbtn" id="set-sub-back" type="button">${esc(t('backShort'))}</button>`;
}
function bindSettingsBack() {
  const b = $('#set-sub-back');
  if (!b) return;
  // Di sub-halaman Kata sandi, tombol kembali menutup halaman Ubah
  // (Kata Sandi / Email) dulu; di sub-halaman lain kembali ke daftar.
  b.addEventListener('click', () => {
    if (S.settingsSub === 'security' && S.secPage) { S.secPage = null; renderSettings(); return; }
    if (S.settingsSub === 'account' && S.acctPage) { S.acctPage = null; renderSettings(); return; }
    // R41: sub-halaman yang dibuka dari Profil (Tampilan / Notifikasi /
    // Bahasa) kembali ke Profil, bukan ke daftar Pengaturan.
    if (S.settingsOrigin === 'profile') { S.profileSub = null; S.settingsOrigin = 'settings'; renderProfile(); return; }
    S.settingsSub = null; renderSettings();
  });
}
// R41: render ulang sub-halaman Pengaturan yang sedang terbuka, di wadah
// asalnya: Profil bila dibuka dari Profil, Pengaturan bila dari Pengaturan.
function rerenderSettingsSub() {
  if (S.settingsOrigin === 'profile') { renderProfile(); return; }
  renderSettings();
}
// R41: +1 bulan kalender (sama seperti interval '1 month' server di RPC).
function addOneMonth(iso) {
  const d = new Date(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}
function acctTitleKey(kind) {
  return kind === 'name' ? 'acctChangeName' : kind === 'trader' ? 'acctChangeTrader' : 'acctChangeFollower';
}
function acctUsernameChangedAt(kind) {
  if (kind === 'trader') return S.trader ? S.trader.username_changed_at || null : null;
  return S.profile ? S.profile.username_changed_at || null : null;
}
function renderSettingsAccount(body) {
  if (S.acctPage) { renderSettingsAcctEdit(body, S.acctPage); return; }
  const p = S.profile || {};
  // R41: daftar TEPAT 3 baris (nama, username follower, username trader),
  // nilai sebagai teks polos + SATU tombol pensil per baris, pola yang
  // sama seperti daftar Kata sandi dan keamanan. Tanpa baris foto (ganti
  // foto tetap hanya di menu Profil), tanpa subjudul, tanpa catatan KYC
  // (aturan KYC tetap, penjelasannya sudah ada di Panduan).
  const rows = [
    ['name', t('profileName'), p.display_name || '—'],
    ['follower', t('usernameFollowerLbl'), p.username ? '@' + p.username : '—'],
  ];
  if (S.trader) rows.push(['trader', t('usernameTraderLbl'), S.trader.username ? '@' + S.trader.username : '—']);
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('setAccount'))}</h2></div>`
    + `<div class="subcard">`
    + rows.map(([kind, label, value]) =>
      `<div class="menurow" style="cursor:default;"><span class="grow"><span class="t">${esc(label)}</span><span class="d">${esc(value)}</span></span><button type="button" class="iconbtn" id="acct-open-${kind}" aria-label="${esc(t(acctTitleKey(kind)))}">${ICONS.edit}</button></div>`
    ).join('')
    + `</div>`;
  bindSettingsBack();
  rows.forEach(([kind]) => {
    const b = $('#acct-open-' + kind);
    if (b) b.addEventListener('click', () => { openAcctEdit(kind); S.acctPage = kind; renderSettings(); });
  });
}
// R41: siapkan state edit (draft = nilai saat ini, tanpa konfirmasi pending).
function openAcctEdit(kind) {
  if (kind === 'name') return;
  const ui = S.usernameUI[kind];
  const cur = kind === 'trader' ? (S.trader?.username || '') : (S.profile?.username || '');
  clearTimeout(ui.timer);
  ui.draft = cur;
  ui.res = null;
  ui.pending = null;
}
function renderSettingsAcctEdit(body, kind) {
  if (kind === 'name') { renderSettingsAcctNameEdit(body); return; }
  renderSettingsAcctUsernameEdit(body, kind);
}
function renderSettingsAcctNameEdit(body) {
  const p = S.profile || {};
  const kycVerified = p.kyc_status === 'verified';
  const cur = p.display_name || '';
  const nextChange = p.display_name_changed_at ? addOneMonth(p.display_name_changed_at) : null;
  const inCooldown = !!nextChange && nextChange > new Date();
  // Terkunci (cooldown/KYC): input nonaktif; tombol Simpan TIDAK dirender
  // saat KYC (kunci permanen) dan nonaktif saat cooldown, tanggal alasan
  // tampil di baris yang sama, jadi tidak ada tombol yang tampak bisa
  // diklik tapi mati.
  const locked = kycVerified || inCooldown;
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('acctChangeName'))}</h2></div>`
    + `<div class="subcard"><form id="acct-name-form" novalidate><div class="field"><label for="acct-name-input">${esc(t('profileName'))}</label><input id="acct-name-input" type="text" maxlength="80" value="${esc(cur)}"${locked ? ' disabled' : ''} />${inCooldown ? `<div class="hint">${esc(t('nameCooldown', { date: fmtDateShort(nextChange.toISOString()) }))}</div>` : ''}</div><div class="form-err" id="acct-name-err" role="alert"></div><div class="detail-actions">${kycVerified ? '' : `<button class="btn primary" type="submit" id="acct-name-save" disabled>${esc(t('save'))}</button>`}<button class="btn" type="button" id="acct-name-cancel">${esc(t('cancel'))}</button></div></form></div>`;
  bindSettingsBack();
  const input = $('#acct-name-input');
  const saveBtn = $('#acct-name-save');
  const cancel = () => { S.acctPage = null; renderSettings(); };
  $('#acct-name-cancel').addEventListener('click', cancel);
  $('#acct-name-form').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
  if (locked || !input || !saveBtn) return;
  const refresh = () => { saveBtn.disabled = !input.value.trim() || input.value.trim() === cur; };
  input.addEventListener('input', refresh);
  $('#acct-name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v || v === cur) return;
    const errBox = $('#acct-name-err');
    errBox.textContent = '';
    saveBtn.disabled = true;
    try {
      const res = await api.setProfileName(v);
      if (!res.ok) {
        errBox.textContent = (res && res.message) || rpcErrorMessage(res) || t('errNetwork');
        saveBtn.disabled = false;
        return;
      }
      toast(t('nameSaved'));
      await refreshIdentity();
      S.acctPage = null;
      renderSettings();
    } catch (err) {
      errBox.textContent = t('errNetwork');
      saveBtn.disabled = false;
    }
  });
}
function renderSettingsAcctUsernameEdit(body, kind) {
  const isTrader = kind === 'trader';
  const cur = isTrader ? (S.trader?.username || '') : (S.profile?.username || '');
  const label = isTrader ? t('usernameTraderLbl') : t('usernameFollowerLbl');
  const changedAt = acctUsernameChangedAt(kind);
  const nextChange = changedAt ? addOneMonth(changedAt) : null;
  const inCooldown = !!nextChange && nextChange > new Date();
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t(acctTitleKey(kind)))}</h2></div>`
    + `<div class="subcard"><form class="wal-panel" data-username-form="${kind}" novalidate><div class="field"><label for="acct-uname-input">${esc(label)}</label><input id="acct-uname-input" data-username-input="${kind}" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(cur)}"><div class="hint">${esc(t('usernameHint'))}</div>${inCooldown ? `<div class="hint">${esc(t('usernameCheckCooldown', { date: fmtDateShort(nextChange.toISOString()) }))}</div>` : ''}<div class="hint" data-username-status="${kind}"></div></div><div id="acct-uname-suggest" style="display:flex;gap:8px;flex-wrap:wrap;"></div><div class="form-err" data-username-err="${kind}" role="alert"></div><div class="detail-actions"><button type="submit" class="btn primary" data-username-submit="${kind}" disabled>${esc(t('save'))}</button><button type="button" class="btn" id="acct-uname-cancel">${esc(t('cancel'))}</button></div></form></div>`;
  bindSettingsBack();
  bindAcctUsernameEdit(body, kind, inCooldown);
}
// R41: binder halaman ubah username di Akun: cek ketersediaan langsung
// (debounce seperti bindUsernameForm) + simpan SATU langkah (tanpa
// konfirmasi ui.pending). Dipakai HANYA di halaman Akun; alur setup
// pertama kali di renderTraderWork tetap memakai bindUsernameForm.
function bindAcctUsernameEdit(root, kind, inCooldown) {
  const ui = S.usernameUI[kind];
  const input = root.querySelector('[data-username-input]');
  const statusEl = root.querySelector('[data-username-status]');
  const suggestEl = root.querySelector('#acct-uname-suggest');
  const curOf = () => (kind === 'trader' ? (S.trader?.username || '') : (S.profile?.username || ''));
  const paint = () => {
    paintUsernameStatus(kind, root);
    // Cooldown: tanggal sudah tampil sebagai baris statis di atas, jangan
    // ulangi pesan yang sama di baris status.
    if (ui.res && ui.res.code === 'cooldown' && inCooldown && statusEl) { statusEl.textContent = ''; statusEl.classList.remove('ok', 'bad'); }
    if (suggestEl) {
      if (ui.res && ui.res.code === 'taken') {
        const v = (ui.draft || '').trim().replace(/^@+/, '');
        const cands = [v + '1', v + '2', v + '_id'].filter((c) => c.length <= 30 && c !== curOf() && c !== v);
        suggestEl.innerHTML = cands.map((c) => `<button type="button" class="btn" data-suggest="${esc(c)}">@${esc(c)}</button>`).join('');
        suggestEl.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => {
          input.value = b.dataset.suggest;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        }));
      } else {
        suggestEl.innerHTML = '';
      }
    }
  };
  const cancel = () => { clearTimeout(ui.timer); ui.draft = ''; ui.res = null; ui.pending = null; S.acctPage = null; renderSettings(); };
  const cancelBtn = root.querySelector('#acct-uname-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', cancel);
  const form = root.querySelector('[data-username-form]');
  if (form) form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
  if (input) {
    input.addEventListener('input', () => {
      const v = input.value.trim().replace(/^@+/, '');
      ui.draft = v;
      ui.res = null;
      paint();
      clearTimeout(ui.timer);
      if (!v) return;
      if (v === curOf()) return;
      if (statusEl) { statusEl.textContent = t('usernameChecking'); statusEl.classList.remove('ok', 'bad'); }
      ui.timer = setTimeout(async () => {
        try {
          const r = await api.checkUsername(kind, v);
          if (ui.draft !== v) return;
          ui.res = r;
        } catch (e) {
          ui.res = null;
        }
        paint();
      }, 250);
    });
  }
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cur = curOf();
      if (!ui.draft || ui.draft === cur) return;
      const errBox = root.querySelector('[data-username-err]');
      try {
        const r = await api.checkUsername(kind, ui.draft);
        if (!r.ok) {
          ui.res = r;
          paint();
          if (errBox) errBox.textContent = usernameStatusMsg(r).txt;
          return;
        }
        const value = r.value || ui.draft;
        let res;
        if (kind === 'trader') res = await api.setupTraderIdentity(value, S.trader.trader_display_name || value);
        else res = await api.setFollowerUsername(value);
        if (!res.ok) {
          if (errBox) errBox.textContent = (res && res.message) || rpcErrorMessage(res) || t('errNetwork');
          return;
        }
        ui.draft = '';
        ui.res = null;
        ui.pending = null;
        toast((cur ? t('usernameChanged') : t('usernameSet')) + '@' + value);
        await refreshIdentity();
        S.acctPage = null;
        renderSettings();
      } catch (err) {
        if (errBox) errBox.textContent = t('errNetwork');
      }
    });
  }
}
function renderSettingsSecurity(body) {
  // Sub-halaman "Ubah Kata Sandi" / "Ubah Email" — judul halaman berubah.
  // D21: struktur OTP 2 langkah prototipe. Pengiriman kode (email OTP)
  // adalah backend yang belum ada — tombol verifikasi menampilkan pesan
  // "menyusul" yang jujur. Tombol "Simpan tanpa kode" DIHAPUS (keputusan
  // user 24 Nov 2026: opsi teraman) — ganti kata sandi menunggu OTP.
  if (S.secPage === 'pw') { renderSettingsPwForm(body); return; }
  if (S.secPage === 'pw2') { renderSettingsPwVerify(body); return; }
  if (S.secPage === 'email') { renderSettingsEmailForm(body); return; }
  if (S.secPage === 'email2') { renderSettingsEmailVerify(body); return; }
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('securityTitle'))}</h2></div>`
    + `<div class="subcard">
      <div class="menurow" style="cursor:default;"><span class="grow"><span class="t">${esc(t('email'))}</span><span class="d">${esc(S.user?.email || '—')}</span></span><button type="button" class="iconbtn" id="sec-open-email" aria-label="${esc(t('secChangeEmail'))}">${ICONS.edit}</button></div>
      <div class="menurow" style="cursor:default;"><span class="grow"><span class="t">${esc(t('password'))}</span><span class="d">••••••••</span></span><button type="button" class="iconbtn" id="sec-open-pw" aria-label="${esc(t('secChangePw'))}">${ICONS.edit}</button></div>
    </div>`;
  bindSettingsBack();
  $('#sec-open-pw').addEventListener('click', () => { S.secPage = 'pw'; renderSettings(); });
  $('#sec-open-email').addEventListener('click', () => { S.secPage = 'email'; renderSettings(); });
}
function renderSettingsPwForm(body) {
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('secChangePw'))}</h2></div>`
    + `<div class="subcard">
      <form id="pw-form">
        <div class="wal-grid">
          <div class="field">
            <label for="pw-new">${esc(t('newPassword'))}</label>
            <input id="pw-new" type="password" required autocomplete="new-password" minlength="8" />
          </div>
          <div class="field">
            <label for="pw-confirm">${esc(t('passwordConfirm'))}</label>
            <input id="pw-confirm" type="password" required autocomplete="new-password" />
          </div>
        </div>
        <div class="hint" id="pw-match-hint"></div>
        <div class="notice err" id="pw-err" hidden></div>
        <div class="detail-actions"><button class="btn primary" type="submit" id="pw-submit">${esc(t('secContinueVerify'))}</button><button class="btn" type="button" id="pw-cancel">${esc(t('cancel'))}</button></div>
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
  $('#pw-cancel').addEventListener('click', () => { S.secPage = null; renderSettings(); });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#pw-err');
    errBox.hidden = true;
    const pw = pwNew.value;
    if (!passwordValid(pw)) { errBox.textContent = t('authErrWeak'); errBox.hidden = false; return; }
    if (pw !== pwCf.value) { errBox.textContent = t('passwordMismatch'); errBox.hidden = false; return; }
    S.secFlow.password = pw;
    S.secPage = 'pw2';
    renderSettings();
  });
}
function renderSettingsPwVerify(body) {
  // Langkah 2 kata sandi: kode verifikasi belum bisa dikirim (backend
  // OTP belum ada). "Verifikasi & simpan" menampilkan pesan menyusul.
  // Tombol "Simpan tanpa kode" dihapus (24 Nov 2026) — tidak ada jalan
  // simpan langsung; ganti kata sandi menunggu backend OTP.
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('secChangePw'))}</h2></div>`
    + `<div class="subcard">
      <div class="field"><label for="pw-code">${esc(t('secVerifyCode'))}</label><input id="pw-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" /><span class="hint">${esc(t('secOtpSoon'))}</span></div>
      <div class="notice err" id="pw2-err" hidden></div>
      <div class="detail-actions"><button class="btn primary" type="button" id="pw2-verify">${esc(t('secVerifySavePw'))}</button><button class="btn" type="button" id="pw2-resend">${esc(t('secResendCode'))}</button><button class="btn" type="button" id="pw2-cancel">${esc(t('cancel'))}</button></div>
    </div>`;
  bindSettingsBack();
  $('#pw2-verify').addEventListener('click', () => toast(t('secOtpSoon')));
  $('#pw2-resend').addEventListener('click', () => toast(t('secOtpSoon')));
  $('#pw2-cancel').addEventListener('click', () => { S.secPage = null; S.secFlow.password = ''; renderSettings(); });
}
function renderSettingsEmailForm(body) {
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('secChangeEmail'))}</h2></div>`
    + `<div class="subcard">
      <form id="email-form" novalidate>
        <div class="field">
          <label for="em-new">${esc(t('secEmailNew'))}</label>
          <input id="em-new" type="email" maxlength="80" autocomplete="email" />
        </div>
        <p class="lead-sm" style="margin-top:0">${esc(t('secEmailHint'))}</p>
        <div class="notice err" id="em-err" hidden></div>
        <div class="detail-actions"><button class="btn primary" type="submit" id="em-send">${esc(t('secSendCode'))}</button><button class="btn" type="button" id="em-cancel">${esc(t('cancel'))}</button></div>
      </form></div>`;
  bindSettingsBack();
  $('#em-cancel').addEventListener('click', () => { S.secPage = null; renderSettings(); });
  $('#email-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const errBox = $('#em-err');
    errBox.hidden = true;
    const em = $('#em-new').value.trim();
    // B3-02: validasi format + tolak email yang sama dengan saat ini
    // (prototipe) — sebelumnya email tidak valid diam-diam tidak berbuat
    // apa-apa, dan kolom kata sandi diabaikan. Kolom kata sandi dihapus:
    // tanpa backend OTP ia tidak bisa diverifikasi dan hanya berpura-pura
    // mengautentikasi perubahan email.
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      errBox.textContent = t('authErrEmail');
      errBox.hidden = false;
      return;
    }
    if (S.user && em.toLowerCase() === String(S.user.email || '').toLowerCase()) {
      errBox.textContent = t('secEmailSame');
      errBox.hidden = false;
      return;
    }
    S.secFlow.email = em;
    S.secPage = 'email2';
    renderSettings();
  });
}
function renderSettingsEmailVerify(body) {
  // Langkah 2 email: kode belum bisa dikirim (backend OTP belum ada).
  // B3-01: TIDAK ada klaim "kode dikirim" — sebelumnya halaman mengklaim
  // kode sudah dikirim + berlaku 10 menit, padahal tidak ada kode yang
  // dikirim; pengguna akan menunggu kode yang tidak pernah datang.
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('secChangeEmail'))}</h2></div>`
    + `<div class="subcard">
      <p class="lead-sm">${esc(t('secCodeSoonTo', { email: S.secFlow.email || '' }))}</p>
      <div class="field"><label for="em-code">${esc(t('secVerifyCode'))}</label><input id="em-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" /><span class="hint">${esc(t('secOtpSoon'))}</span></div>
      <div class="detail-actions"><button class="btn primary" type="button" id="em-verify">${esc(t('secVerifySave'))}</button><button class="btn" type="button" id="em-resend">${esc(t('secResendCode'))}</button><button class="btn" type="button" id="em-cancel2">${esc(t('cancel'))}</button></div>
    </div>`;
  bindSettingsBack();
  $('#em-verify').addEventListener('click', () => toast(t('secOtpSoon')));
  $('#em-resend').addEventListener('click', () => toast(t('secOtpSoon')));
  $('#em-cancel2').addEventListener('click', () => { S.secPage = null; S.secFlow.email = ''; renderSettings(); });
}
function renderSettingsAppearance(body) {
  const pref = getThemePref();
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('theme'))}</h2></div>`
    + `<div class="subcard"><p>${esc(t('setAppearanceSub'))}</p>
      <div class="seg" role="group">
        <button type="button" data-theme-opt="auto" aria-pressed="${pref === 'auto'}">${esc(t('themeAuto'))}</button>
        <button type="button" data-theme-opt="light" aria-pressed="${pref === 'light'}">${esc(t('themeLight'))}</button>
        <button type="button" data-theme-opt="dark" aria-pressed="${pref === 'dark'}">${esc(t('themeDark'))}</button>
      </div></div>`;
  bindSettingsBack();
  $$('[data-theme-opt]', body).forEach((b) => {
    b.addEventListener('click', () => {
      setThemePref(b.dataset.themeOpt);
      rerenderSettingsSub();
    });
  });
}
function renderSettingsNotifications(body) {
  const prefs = getNotifPrefs();
  const items = [
    ['newSignal', t('notifToggleNew')],
    ['tpSl', t('notifToggleTpSl')],
    ['sub', t('notifToggleSub')],
    ['edited', t('notifToggleEdited')],
    ['dup', t('notifToggleDup')],
  ];
  // Baris izin sistem: mengikuti izin browser (default / granted / denied).
  const sysPerm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const sysDesc = sysPerm === 'granted' ? t('notifSysAllowed')
    : sysPerm === 'denied' ? t('notifSysDenied')
    : sysPerm === 'unsupported' ? t('notifSysUnsupported') : t('notifSysDesc');
  body.innerHTML = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('setNotif'))}</h2></div>`
    + `<div class="subcard">`
    + `<div class="setrow"><span class="grow"><span class="t">${esc(t('notifSysTitle'))}</span><span class="d">${esc(sysDesc)}</span></span><label class="switch"><input type="checkbox" id="sys-notif-cb" ${sysPerm === 'granted' ? 'checked' : ''} ${sysPerm === 'granted' || sysPerm === 'unsupported' ? 'disabled' : ''} aria-label="${esc(t('notifSysTitle'))}"><span class="slider"></span></label></div>`
    + items.map(([key, label]) => `<div class="setrow"><span class="grow"><span class="t">${esc(label)}</span></span><label class="switch"><input type="checkbox" data-notif-pref="${key}" ${prefs[key] ? 'checked' : ''} aria-label="${esc(label)}"><span class="slider"></span></label></div>`).join('')
    + `</div>`;
  bindSettingsBack();
  const sysCb = $('#sys-notif-cb');
  if (sysCb) sysCb.addEventListener('change', async () => {
    try { await Notification.requestPermission(); } catch (e) { /* abaikan */ }
    rerenderSettingsSub();
  });
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
    + `<div class="page-head"><h2>${esc(t('language'))}</h2></div>`
    + `<div class="subcard"><p>${esc(t('setLangSub'))}</p>
      <div class="seg" role="group">
        <button type="button" data-lang-opt="id" aria-pressed="${getLang() === 'id'}">Indonesia</button>
        <button type="button" data-lang-opt="en" aria-pressed="${getLang() === 'en'}">English</button>
      </div></div>`;
  bindSettingsBack();
  $$('[data-lang-opt]', body).forEach((b) => {
    b.addEventListener('click', async () => {
      setLang(b.dataset.langOpt);
      applyI18n();
      // R41: showView('profile') mereset S.profileSub, dari Profil render
      // ulang langsung supaya tetap di sub-halaman Bahasa.
      if (S.settingsOrigin === 'profile') { renderProfile(); return; }
      showView('settings');
    });
  });
}
function renderSettingsWithdraw(body) {
  const p = S.profile || {};
  const holder = p.display_name || p.username || S.user?.email || '';
  let html = settingsBackButton()
    + `<div class="page-head"><h2>${esc(t('setWithdraw'))}</h2></div>`
    + `<div class="subcard"><p>${esc(t('setWithdrawDesc'))}</p>`
    + `<div class="empty" style="margin-top:10px">${esc(t('setWithdrawEmpty'))}</div>`;
  if (!S.wdAdd) {
    html += `<button type="button" class="menurow" id="wd-add"><span class="grow"><span class="t">${esc(t('setWithdrawAdd'))}</span></span><span class="marrow" aria-hidden="true">${ICONS.arrow}</span></button>`;
  } else {
    html += `<form id="wd-form" novalidate>
      <div class="wal-grid">
        <div class="field"><label for="wd-bank">${esc(t('wdBank'))}</label><input id="wd-bank" maxlength="30" autocomplete="off" placeholder="${esc(t('wdBankPh'))}" /></div>
        <div class="field"><label for="wd-no">${esc(t('wdAccNo'))}</label><input id="wd-no" inputmode="numeric" maxlength="24" autocomplete="off" /></div>
      </div>
      <div class="field"><label for="wd-name">${esc(t('wdHolder'))} <span class="stchip ok">${esc(t('locked'))}</span></label><input id="wd-name" maxlength="60" autocomplete="off" disabled value="${esc(holder)}" /><span class="hint">${esc(t('wdLockedHint'))}</span></div>
      <p class="note">${esc(t('wdSaveSoon'))}</p>
      <div class="detail-actions"><button type="submit" class="btn primary" disabled>${esc(t('save'))}</button><button type="button" class="btn" id="wd-cancel">${esc(t('cancel'))}</button></div>
    </form>`;
  }
  html += `</div>`;
  body.innerHTML = html;
  bindSettingsBack();
  const addBtn = $('#wd-add');
  if (addBtn) addBtn.addEventListener('click', () => { S.wdAdd = true; renderSettings(); });
  const form = $('#wd-form');
  if (form) {
    // Tombol Simpan nonaktif — cegah submit implisit (Enter di input).
    form.addEventListener('submit', (e) => e.preventDefault());
    $('#wd-cancel').addEventListener('click', () => { S.wdAdd = false; renderSettings(); });
  }
}

// ------------------------------------------------------------- Dompet ---
// Struktur mengikuti prototipe: hero saldo, strip akun penarikan, lead,
// teks kunci KYC, tab riwayat penarikan/langganan. Semua aksi pembayaran
// NONAKTIF (fase pembayaran terakhir) — saldo nyata akun = Rp0 karena
// belum ada penghasilan langganan di database; riwayat selalu kosong.
function renderWallet() {
  const body = $('#wallet-body');
  if (!body) return;
  const tab = S.walletTab === 'subs' ? 'subs' : 'tx';
  const range = S.walletRange;
  const kycVerified = (S.profile?.kyc_status) === 'verified';
  // B3-12: prototipe — tab penarikan: histEmptyRange hanya untuk rentang
  // kustom, preset lain histEmptyMonth; tab langganan: selama belum ada
  // langganan sama sekali, pesannya "Belum ada langganan" apa pun filternya.
  const emptyKey = tab === 'subs' ? 'walletSubsEmpty' : (range === 'CUSTOM' ? 'histEmptyRange' : 'histEmptyMonth');
  body.innerHTML = `<div class="wal-hero"><span class="demo-badge">${esc(t('walletHeroBadge'))}</span>`
    + `<div class="wal-bal-label">${esc(t('walletBalLabel'))}</div><div class="wal-bal-value mono">${esc(fmtIdr(0))}</div>`
    + `<div class="wal-actions"><button type="button" class="btn" disabled>${esc(t('walletWithdraw'))}</button></div></div>`
    + `<div class="risk-note"><span><b>${esc(t('walletNoAcc'))}</b> <button type="button" class="linkbtn" id="wallet-add-acc">${esc(t('walletAddAcc'))}</button> ${esc(t('walletNoAccSuffix'))}</span></div>`
    + `<p class="lead-sm">${esc(t('walletSoon'))}</p>`
    + `<p class="lead-sm">${esc(t('walletLead'))}</p>`
    + (kycVerified ? '' : `<p class="lead-sm kyc-note">${esc(t('walletKycLock'))}</p>`)
    + `<div class="subtabs" role="tablist" aria-label="${esc(t('walletTitle'))}">`
    + `<button type="button" class="subtab" role="tab" data-waltab="tx" aria-selected="${tab === 'tx'}">${esc(t('walletHistTx'))}</button>`
    + `<button type="button" class="subtab" role="tab" data-waltab="subs" aria-selected="${tab === 'subs'}">${esc(t('walletHistSubs'))}</button></div>`
    + `<h3 class="section">${esc(tab === 'tx' ? t('walletHistTx') : t('walletHistSubs'))}</h3>`
    + `<div class="row" style="margin-bottom:12px;"><button type="button" class="chip" data-waltx="all" aria-pressed="${range === 'ALL'}">${esc(t('rangeAll'))}</button>${dateFilterBarHtml('wallet')}</div>`
    + `<div class="empty"><strong>${esc(t(emptyKey))}</strong></div>`;
  $('#wallet-add-acc').addEventListener('click', () => { S.settingsSub = 'withdraw'; S.secPage = null; S.wdAdd = false; showView('settings'); });
  const waltxAll = $('[data-waltx="all"]', body);
  if (waltxAll) waltxAll.addEventListener('click', () => { S.walletRange = 'ALL'; renderWallet(); });
  $$('[data-waltab]', body).forEach((b) => {
    b.addEventListener('click', () => { S.walletTab = b.dataset.waltab; renderWallet(); });
  });
  bindDateFilter(body, 'wallet', () => renderWallet());
}

// Ronde 15 (#3): tampilan gabungan "Bantuan & Panduan" — satu baris menu
// Profil membuka satu view dengan dua sub-tab (Panduan | Bantuan). Kedua
// isi dirender utuh oleh renderGuide()/renderHelp() yang sudah ada; di
// sini hanya sub-tab + visibilitas yang diatur.
function renderHelpGuide() {
  const tabs = $('#helpguide-tabs');
  if (tabs) {
    tabs.innerHTML = `<div class="subtabs" role="tablist">
      <button class="subtab" role="tab" data-hgtab="guide" aria-selected="${S.helpGuideTab === 'guide'}">${esc(t('guide'))}</button>
      <button class="subtab" role="tab" data-hgtab="help" aria-selected="${S.helpGuideTab === 'help'}">${esc(t('helpGuideTabHelp'))}</button>
    </div>`;
    $$('[data-hgtab]', tabs).forEach((b) => {
      b.addEventListener('click', () => { S.helpGuideTab = b.dataset.hgtab; renderHelpGuide(); });
    });
  }
  // R30: label tombol kembali mengikuti konteks — di halaman detail
  // Panduan, tombol kembali mengarah ke daftar Panduan.
  syncHelpGuideBack();
  const g = $('#helpguide-guide');
  if (g) g.hidden = S.helpGuideTab !== 'guide';
  const h = $('#helpguide-help');
  if (h) h.hidden = S.helpGuideTab !== 'help';
  // Render keduanya (yang tersembunyi tetap dirender supaya isi lengkap
  // saat tab dibuka); petunjuk scroll tabel dihitung saat tab terlihat.
  renderGuide();
  renderHelp();
}

// R30: label tombol kembali tampilan Bantuan & Panduan mengikuti konteks
// (daftar -> "Kembali ke Profil", detail seksi -> "Kembali ke Panduan").
// Dipanggil dari renderHelpGuide() DAN renderGuide() — perubahan guideSub
// terjadi lewat renderGuide() (klik baris / tombol kembali detail), jadi
// sinkronisasi hanya di renderHelpGuide() tidak cukup.
function syncHelpGuideBack() {
  const hgBack = $('#btn-helpguide-back span');
  if (hgBack) hgBack.textContent = (S.helpGuideTab === 'guide' && S.guideSub) ? t('backGuide') : t('backProfile');
}

function renderHelp() {
  const body = $('#help-body');
  if (!body) return;
  // Daftar trader untuk select laporan: muat bila belum ada (pola yang
  // sama seperti Office Follower) lalu render ulang saat sudah dimuat.
  if (!(S.traders || []).length) {
    api.listTraders().then((rows) => {
      S.traders = rows || [];
      if (S.view === 'helpguide') renderHelp();
    }).catch(() => {});
  }
  const faqs = [1, 2, 3, 4, 5].map((n) => `<details class="more"><summary>${esc(t('helpFaq' + n + 'Q'))}<span aria-hidden="true">${ICONS.chevD}</span></summary><div class="more-body"><p>${esc(t('helpFaq' + n + 'A'))}</p></div></details>`).join('');
  // D22: diri sendiri dikeluarkan dari select laporan.
  const traderOpts = (S.traders || []).filter((tr) => tr.profile_id !== S.user?.id).map((tr) => {
    // Publik: opsi laporan hanya @username, tanpa nama profil (ronde 5).
    return [tr.profile_id, traderHandle(tr)];
  });
  const reasonOpts = [1, 2, 3, 4].map((n) => { const l = t('helpReportReason' + n); return [l, l]; });
  body.innerHTML = `<div class="risk-note"><span><b>${esc(t('helpScamTitle'))}</b> ${esc(t('helpScamBody'))}</span></div>`
    + `<h3 class="section">${esc(t('helpFaqTitle'))}</h3>${faqs}`
    + `<h3 class="section">${esc(t('helpReportTitle'))}</h3>`
    + `<p class="note" style="margin-bottom:10px;">${esc(t('helpReportLocalNote'))}</p>`
    + `<form class="subcard" id="help-report-form" novalidate><div class="wal-grid">
        <div class="field"><label for="rp-trader">${esc(t('helpReportTrader'))}</label>${dropdownHtml('rp-trader', traderOpts.length ? traderOpts : [['', t('helpReportPick'), true]], traderOpts.length ? traderOpts[0][0] : '')}</div>
        <div class="field"><label for="rp-reason">${esc(t('helpReportReason'))}</label>${dropdownHtml('rp-reason', reasonOpts, reasonOpts[0][0])}</div>
      </div>
      <div class="field"><label for="rp-desc">${esc(t('helpReportDesc'))}</label><textarea id="rp-desc" maxlength="500" rows="3"></textarea></div>
      <div class="form-err" id="rp-err" role="alert"></div>
      <div class="detail-actions"><button type="submit" class="btn primary">${esc(t('helpReportSubmit'))}</button></div>
    </form>`
    + (S.reports.length
      ? `<h3 class="section">${esc(t('helpMyReports'))}</h3><div class="subcard">` + S.reports.map((r) => {
        const tr = (S.traders || []).find((x) => x.profile_id === r.trader_id);
        const label = tr ? traderHandle(tr) : r.trader_id;
        return `<div class="hist-row"><span class="p mono">${esc(label)}</span><span class="pill">${esc(r.reason)}</span><span style="color:var(--muted)">${esc(fmtDate(r.created_at))}</span><span class="pill ok">${esc(t('helpReportReceived'))}</span></div>`;
      }).join('') + `</div>`
      : `<p class="note" style="margin-top:10px;">${esc(t('helpReportEmpty'))}</p>`)
    + `<h3 class="section">${esc(t('helpRulesTitle'))}</h3>`
    + `<details class="more"><summary>${esc(t('helpRuleTos'))}<span aria-hidden="true">${ICONS.chevD}</span></summary><div class="more-body"><p>${esc(t('helpRuleTosBody'))}</p></div></details>`
    + `<details class="more"><summary>${esc(t('helpRulePrivacy'))}<span aria-hidden="true">${ICONS.chevD}</span></summary><div class="more-body"><p>${esc(t('helpRulePrivacyBody'))}</p></div></details>`
    + `<details class="more"><summary>${esc(t('helpRuleRefund'))}<span aria-hidden="true">${ICONS.chevD}</span></summary><div class="more-body"><p>${esc(t('helpRuleRefundBody'))}</p></div></details>`;
  const form = $('#help-report-form');
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const errBox = $('#rp-err');
    const traderId = $('#rp-trader')?.value;
    if (!traderId) { errBox.textContent = t('helpReportPick'); return; }
    const reason = $('#rp-reason')?.value || '';
    const desc = $('#rp-desc')?.value?.trim() || '';
    // B3-05: penjelasan wajib minimal 10 karakter (prototipe).
    if (desc.length < 10) { errBox.textContent = t('helpReportDescMin'); return; }
    // Backend laporan belum ada (Fase 5) — laporan disimpan lokal di
    // perangkat ini saja dan tampil di "Laporan kamu".
    S.reports.unshift({ trader_id: traderId, reason, desc, created_at: new Date().toISOString() });
    saveReports();
    toast(t('helpReportSaved'));
    renderHelp();
  });
  bindDropdown('rp-trader'); // R24
  bindDropdown('rp-reason');
}

// -------------------------------------------------------------- Panduan ---
// R30: Panduan drill-in (pola R25 S.profileSub) — daftar 9 baris seksi;
// klik baris masuk ke halaman detail seksi itu, tombol kembali ke daftar.
// Kartu "Aturan inti" dihapus (U1) — aturan lengkap sudah ada di dalam
// seksi-seksi Panduan.
// Isi yang mengandung HTML (<p>, <strong>, <ul>) dirender via innerHTML
// dari kamus tepercaya (BUKAN esc()) — pola yang sama seperti prototipe.
const GUIDE_GLOSS = [['Entry', 'entry'], ['Stop Loss (SL)', 'sl'], ['Take Profit (TP)', 'tp'], ['Status sinyal', 'status'], ['Level', 'level'], ['Risiko', 'risk'], ['Saldo simulasi', 'balance'], ['Ikuti vs Langganan', 'sub'], ['Terverifikasi', 'verified'], ['Peringkat', 'board'], ['R-multiple (R)', 'r'], ['Recovery Factor', 'rf'], ['Drawdown', 'dd'], ['Compounding', 'comp'], ['Profit Factor', 'pf'], ['Win rate', 'wr'], ['R:R (risk : reward)', 'rr'], ['Pips', 'pips'], ['Streak', 'streak'], ['Holding period', 'hold'], ['Lot', 'lot'], ['Floating', 'floating']];

// R30: daftar 9 seksi Panduan (urutan sama seperti accordion lama).
const GUIDE_SECS = [
  { id: 'signal', titleKey: 'guideSecSignal' },
  { id: 'level', titleKey: 'guideSecLevel' },
  { id: 'board', titleKey: 'guideSecBoard' },
  { id: 'risk', titleKey: 'guideSecRisk' },
  { id: 'subs', titleKey: 'guideSecSubs' },
  { id: 'share', titleKey: 'guideSecShare' },
  { id: 'reset', titleKey: 'guideSecReset' },
  { id: 'acct', titleKey: 'guideSecAcct' },
  { id: 'gloss', titleKey: 'guideSecGloss' },
];

// R30: isi tiap seksi Panduan — pindah utuh dari accordion ke halaman
// detail. Key isi yang berupa HTML mandiri (<p>/<ul>/<ol>) dirender tanpa
// pembungkus <p> tambahan; key teks polos dibungkus <p> di sini.
function guideSectionBody(id) {
  if (id === 'signal') {
    const flow = `<div class="flow" role="img" aria-label="PENDING → ${esc(t('flowLocked'))} → WIN / LOSS">`
      + `<span class="fstep"><b>PENDING</b><i>${esc(t('flowPendingSub'))}</i></span><span class="farr" aria-hidden="true">${ICONS.arrow}</span>`
      + `<span class="fstep"><b>${esc(t('flowLocked'))}</b><i>${esc(t('flowLockedSub'))}</i></span><span class="farr" aria-hidden="true">${ICONS.arrow}</span>`
      + `<span class="fstep win"><b>WIN / LOSS</b><i>${esc(t('flowResultSub'))}</i></span></div>`;
    return flow + `<p>${t('heroDetail1')}</p><p>${t('heroDetail2')}</p><p>${t('formLockDetail')}</p><p>${t('guideRRRule')}</p><p>${t('guideExpiry')}</p>` + t('guideDupRule');
  }
  if (id === 'level') {
    // Tangga pangkat lengkap (dihitung dari rumus tangga tetap $10.000).
    let ladderRows = '';
    for (let ln = 1; ln <= 24; ln++) {
      const refLn = levelRef(ln);
      ladderRows += `<tr><td class="lvlcell mono">L${ln}</td><td class="rankname">${esc(levelName(ln, getLang()))}</td>`
        + `<td class="num mono">${esc(fmtUsdTable(refLn))}</td><td class="num mono">${esc(fmtUsdTable(refLn - START_BALANCE_USD))}</td>`
        + `<td>${ln === 1 ? esc(t('ladStart')) : esc(t('ladRStep'))}</td></tr>`;
    }
    const ladder = `<p>${t('ladIntro')}</p>`
      + `<div class="lvltable-wrap"><table class="lvltable"><thead><tr><th>${esc(t('ladColLevel'))}</th><th>${esc(t('ladColRank'))}</th><th class="num">${esc(t('ladColRef'))}</th><th class="num">${esc(t('ladColProfit'))}</th><th>${esc(t('ladColR'))}</th></tr></thead><tbody>${ladderRows}</tbody></table></div>`
      + `<p>${t('ladBeyond', { a: levelName(25, getLang()), b: levelName(26, getLang()) })}</p>`;
    return ladder + t('boardD2') + t('boardD3') + t('boardD4') + t('lvlRulesDetail') + t('lvlRulesDetail2')
      + `<p>${t('guideOverRiskRule')}</p>` + t('boardD7') + `<p>${t('guideRefFixed')}</p><p>${t('guideMinTrades')}</p>`;
  }
  if (id === 'board') return t('boardD1');
  if (id === 'risk') return t('guideRisk1') + t('guideRisk2') + t('guideRisk3');
  if (id === 'subs') {
    return t('boardD6') + t('boardD5') + t('guideVerified') + t('guideShareSplit')
      + `<p>${t('guidePriceChange')}</p><p>${t('guideWithdrawName')}</p>` + t('guideWithdraw') + `<p>${t('guideKycWithdraw')}</p>`;
  }
  if (id === 'share') return t('guideShareBody');
  if (id === 'reset') return t('guideResetBody') + `<p>${t('guideInactivity')}</p>`;
  if (id === 'acct') return t('guideAcctRules') + t('guideKycRules');
  if (id === 'gloss') {
    return `<p style="margin:0 0 10px;">${esc(t('guideGlossSub'))}</p><div class="gloss-grid">`
      + GUIDE_GLOSS.map(([label, g]) => `<div class="gloss-item"><b>${esc(label)}</b><span>${esc(t('gloss_' + g))}</span></div>`).join('') + '</div>';
  }
  return '';
}

// Petunjuk scroll tabel pangkat di layar kecil: bayangan tepi kanan hanya
// bila tabel benar-benar lebih lebar dari wadahnya (di layar lebar tidak muncul).
function updateLvlTableScrollHint() {
  const wrap = document.querySelector('#guide-sections .lvltable-wrap');
  if (!wrap) return;
  wrap.classList.toggle('scrollable', wrap.scrollWidth > wrap.clientWidth + 1);
}
// Pola yang sama untuk tabel statistik (bulan + per pair): bayangan tepi
// kanan hanya bila tabel lebih lebar dari wadahnya.
function updateBoardScrollHints(root = document) {
  root.querySelectorAll('.board-wrap').forEach((wrap) => {
    wrap.classList.toggle('scrollable', wrap.scrollWidth > wrap.clientWidth + 1);
  });
}
window.addEventListener('resize', () => {
  updateLvlTableScrollHint();
  updateBoardScrollHints();
});

function renderGuide() {
  const secs = $('#guide-sections');
  if (!secs) return;
  syncHelpGuideBack();
  // R30: halaman detail — isi seksi pindah utuh ke sini.
  if (S.guideSub) {
    const sec = GUIDE_SECS.find((s) => s.id === S.guideSub);
    if (sec) {
      secs.innerHTML = `<div class="page-head"><h2>${esc(t(sec.titleKey))}</h2></div>`
        + `<div class="card guide-sec"><div class="more-body">${guideSectionBody(sec.id)}</div></div>`;
      updateLvlTableScrollHint();
      return;
    }
    S.guideSub = null;
  }
  // Daftar 9 baris seksi (gaya .prow seperti menu Profil).
  secs.innerHTML = GUIDE_SECS.map((s) => `<button type="button" class="prow" data-guide-sec="${s.id}"><span class="lbl">${esc(t(s.titleKey))}</span><span class="ch">${ICONS.chevR}</span></button>`).join('');
  $$('#guide-sections [data-guide-sec]').forEach((b) => {
    b.addEventListener('click', () => { S.guideSub = b.dataset.guideSec; renderGuide(); });
  });
}

// ------------------------------------------------------- verifikasi /v/ ---
// D03: tampilan verifikasi client-side untuk /v/SM-…?code=… — dibaca dari
// database (cocokkan kode FNV-1a sinyal yang ID kartunya sama). Langkah
// deploy Render yang WAJIB dilakukan terpisah (bukan kode): di dashboard
// Render → service olesignals → Redirects/Rewrites, tambah aturan
// Rewrite  /v/*  →  /index.html  (200). Tanpa aturan itu Render tetap
// mengembalikan 404 sebelum JavaScript sempat jalan.
function isVerifyPath() {
  return window.location.pathname.startsWith('/v/');
}
async function renderVerifyView() {
  const box = $('#verify-view');
  hideSplash();
  $('#app').hidden = true;
  $('#auth-view').hidden = true;
  box.hidden = false;
  window.__oleBooted = true;
  const m = window.location.pathname.match(/^\/v\/(SM-[A-Za-z0-9]+)/i);
  const code = new URLSearchParams(window.location.search).get('code') || '';
  const head = `<div class="logo" style="text-align:center; margin-bottom: 4px;">OLE <em>Signals</em></div>`
    + `<h1 style="text-align:center;">${esc(t('verifyTitle'))}</h1>`;
  const openBtn = `<div class="row" style="justify-content:center; margin-top:16px;"><button class="btn primary" type="button" id="verify-home" style="width:auto; min-width:200px;">${esc(t('verifyOpenApp'))}</button></div>`;
  const bindHome = () => {
    const b = $('#verify-home');
    if (b) b.addEventListener('click', () => { window.location.href = '/'; });
  };
  if (!m) {
    box.innerHTML = head + `<div class="verify-card"><p class="verify-bad">${esc(t('verifyInvalid'))}</p></div>` + openBtn;
    bindHome();
    return;
  }
  const cardId = m[1].toUpperCase();
  box.innerHTML = head + `<div class="verify-card"><p class="sub">${esc(t('verifyLoading'))}</p></div>` + openBtn;
  bindHome();
  let sig = null;
  let failed = false;
  try {
    const all = await api.listAllSignals();
    sig = all.find((x) => shareCardId(x) === cardId) || null;
  } catch (e) {
    failed = true;
  }
  const ok = sig && verifyCode(sig).toUpperCase() === code.toUpperCase();
  let body;
  if (failed) {
    body = `<p class="verify-bad">${esc(t('verifyCheckFailed'))}</p>`;
  } else if (ok) {
    const tr = traderOf(sig);
    const d = decimalsForPair(sig.pair);
    const level = levelOfSignal(sig);
    const done = (sig.status === 'WIN' || sig.status === 'LOSS') && sig.profit_usd !== null && sig.profit_usd !== undefined;
    body = `<p class="verify-ok">${ICONS.check} ${esc(t('verifyValid'))}</p>`
      + `<dl class="kv"><dt>${esc(t('sigShareId'))}</dt><dd class="share-id">${esc(cardId)}</dd>`
      + `<dt>${esc(t('sigShareCode'))}</dt><dd class="share-id">${esc(verifyCode(sig))}</dd>`
      + `<dt>${esc(t('pair'))}</dt><dd><b>${esc(sig.pair)}</b> ${esc(sig.direction)} — ${esc(statusPillLabel(sig.status))}</dd>`
      + `<dt>${esc(t('username'))}</dt><dd>${esc(traderHandle(tr))}</dd>`
      + `<dt>${esc(t('level'))}</dt><dd>Level ${level} · ${esc(levelName(level, getLang()))}</dd>`
      + `<dt>${esc(t('entry'))}</dt><dd class="mono">${esc(fmtNum(sig.entry, d))}</dd>`
      + `<dt>${esc(t('stopLoss'))}</dt><dd class="mono">${esc(fmtNum(sig.stop_loss, d))}</dd>`
      + `<dt>${esc(t('takeProfit'))}</dt><dd class="mono">${esc(fmtNum(sig.take_profit, d))}</dd>`
      + `<dt>${esc(t('lot'))}</dt><dd class="mono">${esc(ds(Number(sig.lot_size).toFixed(2)))}</dd>`
      + (done ? `<dt>${esc(t('verifyResult'))}</dt><dd>${esc(fmtUsd0(sig.profit_usd))} <span>(${sig.profit_pips !== null && sig.profit_pips !== undefined ? `${fmtPipsSigned(sig.profit_pips)} · ` : ''}${sig.r_value !== null && sig.r_value !== undefined ? esc(fmtRShort(sig.r_value)) : ''})</span></dd>` : '')
      + `<dt>${esc(t('detPosted'))}</dt><dd>${esc(fmtDate(sig.created_at))}</dd></dl>`
      + `<p class="note">${t('riskNote')}</p>`;
  } else {
    body = `<p class="verify-bad">${esc(t('verifyInvalid'))}</p>`
      + `<dl class="kv"><dt>${esc(t('sigShareId'))}</dt><dd class="share-id">${esc(cardId)}</dd>`
      + `<dt>${esc(t('sigShareCode'))}</dt><dd class="share-id">${esc(code) || '—'}</dd></dl>`;
  }
  box.innerHTML = head + `<div class="verify-card">${body}</div>` + openBtn;
  bindHome();
}
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('session-timeout')), ms)),
  ]);
}

// ------------------------------------------------------------------ init ---
applyTheme();
applyI18n();
if (isVerifyPath()) {
  renderVerifyView();
} else {
  api.onAuthChange((event, session) => {
    // Ronde 63: jalur kedua deteksi recovery (jalur utama: baca URL di boot
    // di bawah). Dengan detectSessionInUrl:false (Ronde 64) klien tidak
    // lagi memancarkan event ini dari URL, tapi handler tetap dipertahankan
    // sebagai cadangan.
    if (event === 'PASSWORD_RECOVERY') { enterRecovery(session); return; }
    handleSession(session, event);
  });
  // Ronde 64: recovery DIBACA DULU dari URL sendiri, SEBELUM getSession /
  // handleSession apa pun. Dulu GoTrue mengonsumsi hash saat init klien
  // (hash dibersihkan sebelum app.js jalan) sehingga isRecoveryHash()
  // selalu false dan sesi recovery menempuh jalur normal → showApp().
  // Sekarang klien tidak memproses URL (detectSessionInUrl:false) dan boot
  // yang menukar token menjadi sesi secara eksplisit; gagal tukar = layar
  // reset dalam keadaan tidak valid, bukan layar masuk biasa.
  const recovery = readRecoveryParams();
  if (recovery) {
    try {
      let session = null;
      if (recovery.kind === 'hash') {
        // Ronde 66: tandai id sesi DARI TOKEN DI URL, SEBELUM setSession
        // menulis sesi ke localStorage. Bila ditandai sesudah setSession,
        // tab lain bisa memproses storage event lebih dulu: harness
        // membuktikan tab lain layarnya tetap login tetapi S.session
        // mereka terlanjur terisi sesi recovery (balapan mark vs event).
        // Menandai dulu menutup balapan itu: saat tab lain melihat sesi
        // ini, id-nya sudah ada di daftar blokir.
        markRecoverySession({ access_token: recovery.access_token });
        // Ronde 67: kunci kilasan invalid. Event INITIAL_SESSION bisa
        // datang sebelum penukaran ini selesai; selama flag true,
        // handleSession menunda enterRecovery(null).
        S.recoveryExchangePending = true;
        const { session: s } = await withTimeout(api.setSession({ access_token: recovery.access_token, refresh_token: recovery.refresh_token }), 10000);
        session = s;
      } else if (recovery.kind === 'pkce') {
        // Ronde 67: sama seperti hash (lihat di atas).
        S.recoveryExchangePending = true;
        const { session: s } = await withTimeout(api.exchangeCodeForSession(recovery.code), 10000);
        session = s;
      }
      // kind 'invalid' -> session tetap null (link tidak valid).
      // Ronde 66: tandai sesi recovery supaya tab lain tidak ikut masuk
      // aplikasi lewat sesi yang dibagi localStorage ini.
      if (session) markRecoverySession(session);
      enterRecovery(session, recovery.kind === 'pkce' ? { dropQuery: true } : undefined);
    } catch (e) {
      console.error('init recovery', e);
      enterRecovery(null, recovery.kind === 'pkce' ? { dropQuery: true } : undefined);
    } finally {
      // Ronde 67: bersihkan flag SESUDAH enterRecovery dipanggil di
      // try/catch di atas, supaya event yang datang terlambat tetap
      // melihat state yang benar.
      S.recoveryExchangePending = false;
      window.__oleBooted = true;
    }
  } else {
    try {
      // D07: getSession() yang menggantung tidak boleh membiarkan halaman
      // blank tanpa batas. Batas 10 detik, lalu tampilkan layar masuk
      // dengan pesan + tombol muat ulang di splash.
      const session = await withTimeout(api.getSession(), 10000);
      await handleSession(session, 'INITIAL_SESSION');
    } catch (e) {
      console.error('init session', e);
      showAuth();
      const errBox = $('#auth-error');
      if (errBox) {
        errBox.textContent = t('errSessionTimeout');
        errBox.hidden = false;
      }
    } finally {
      window.__oleBooted = true;
    }
  }
}
