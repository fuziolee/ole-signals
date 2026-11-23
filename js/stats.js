// OLE Signals — mesin statistik client-side (baca saja, tanpa tulis).
// Menghitung metrik trader dari sinyal TERTUTUP yang nyata di database:
// WR, total profit USD, total R, profit factor, streak, max drawdown,
// recovery factor, rata-rata R/SL/TP, statistik per pair, per bulan, dan
// deret hasil untuk grafik. Nilai yang belum bisa dihitung tampil null
// (dirender "—" oleh pemanggil), bukan angka contoh.
// R satu trade: menang = rasio TP:SL, kalah selalu -1R (aturan §5).
// Drawdown: penurunan kumulatif dari puncak saldo (awal $10.000).

import { START_BALANCE_USD } from './levels.js';

export function pipSize(pair) {
  if (pair === 'XAUUSD') return 0.1;
  if (pair && pair.endsWith('JPY')) return 0.01;
  return 0.0001;
}

export function pipsPnl(pair, dir, entry, exit) {
  if (entry == null || exit == null) return null;
  const diff = Number(exit) - Number(entry);
  const signed = dir === 'SELL' ? -diff : diff;
  return signed / pipSize(pair);
}

function contractSize(pair) {
  return pair === 'XAUUSD' ? 100 : 100000;
}

// Profit USD dari harga tutup (cadangan bila profit_usd belum diisi
// settlement Fase 3). Hanya pair ber-quote USD (konversi = 1) yang bisa
// dihitung tanpa tabel harga; pair lain mengembalikan null.
export function usdPnl(pair, dir, entry, exit, lot) {
  if (entry == null || exit == null || lot == null) return null;
  if (!String(pair).endsWith('USD')) return null;
  const diff = Number(exit) - Number(entry);
  const signed = dir === 'SELL' ? -diff : diff;
  return signed * Number(lot) * contractSize(pair);
}

export function rOfSignal(sig) {
  if (sig.r_value !== null && sig.r_value !== undefined) return Number(sig.r_value);
  if (sig.status === 'WIN') {
    const risk = Math.abs(Number(sig.entry) - Number(sig.stop_loss));
    const reward = Math.abs(Number(sig.take_profit) - Number(sig.entry));
    if (!(risk > 0)) return null;
    return reward / risk;
  }
  if (sig.status === 'LOSS') return -1;
  return null;
}

function profitOf(sig) {
  if (sig.profit_usd !== null && sig.profit_usd !== undefined) return Number(sig.profit_usd);
  if (sig.status === 'WIN' || sig.status === 'LOSS') {
    return usdPnl(sig.pair, sig.direction, sig.entry, sig.close_price, sig.lot_size);
  }
  return null;
}

function pipsOf(sig) {
  if (sig.profit_pips !== null && sig.profit_pips !== undefined) return Number(sig.profit_pips);
  if (sig.status === 'WIN' || sig.status === 'LOSS') {
    return pipsPnl(sig.pair, sig.direction, sig.entry, sig.close_price);
  }
  return null;
}

// Statistik dari SATU daftar sinyal tertutup (sudah terurut kronologis).
function statsFromClosed(closed) {
  const wins = closed.filter((s) => s.status === 'WIN').length;
  const losses = closed.filter((s) => s.status === 'LOSS').length;
  let totalUSD = 0;
  let totalPips = 0;
  let totalR = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let slSum = 0;
  let tpSum = 0;
  let slN = 0;
  let tpN = 0;
  let longestWin = 0;
  let longestLose = 0;
  let runWin = 0;
  let runLose = 0;
  // Drawdown dari kurva saldo kumulatif (awal $10.000).
  let bal = START_BALANCE_USD;
  let peak = START_BALANCE_USD;
  let maxDdUsd = 0;
  let maxDdPct = 0;
  for (const s of closed) {
    const p = profitOf(s);
    if (p !== null && Number.isFinite(p)) {
      totalUSD += p;
      if (p > 0) grossWin += p;
      else if (p < 0) grossLoss += -p;
      bal += p;
      if (bal > peak) peak = bal;
      const dd = peak - bal;
      if (dd > maxDdUsd) {
        maxDdUsd = dd;
        maxDdPct = peak > 0 ? (dd / peak) * 100 : 0;
      }
    }
    const pp = pipsOf(s);
    if (pp !== null && Number.isFinite(pp)) totalPips += pp;
    const r = rOfSignal(s);
    if (r !== null && Number.isFinite(r)) totalR += r;
    const slD = Math.abs(Number(s.entry) - Number(s.stop_loss)) / pipSize(s.pair);
    const tpD = Math.abs(Number(s.take_profit) - Number(s.entry)) / pipSize(s.pair);
    if (Number.isFinite(slD)) { slSum += slD; slN++; }
    if (Number.isFinite(tpD)) { tpSum += tpD; tpN++; }
    if (s.status === 'WIN') { runWin++; runLose = 0; longestWin = Math.max(longestWin, runWin); }
    if (s.status === 'LOSS') { runLose++; runWin = 0; longestLose = Math.max(longestLose, runLose); }
  }
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null);
  const recovery = maxDdUsd > 0 ? totalUSD / maxDdUsd : (totalUSD > 0 ? Infinity : null);
  // Rata-rata R:R = rata-rata rasio TP:SL dari sinyal tertutup.
  let rrSum = 0;
  let rrN = 0;
  for (const s of closed) {
    const risk = Math.abs(Number(s.entry) - Number(s.stop_loss));
    const reward = Math.abs(Number(s.take_profit) - Number(s.entry));
    if (risk > 0 && Number.isFinite(reward / risk)) { rrSum += reward / risk; rrN++; }
  }
  return {
    closed: closed.length,
    wins,
    losses,
    wr: closed.length ? (wins / closed.length) * 100 : null,
    totalUSD,
    totalPips,
    totalR,
    avgR: closed.length ? totalR / closed.length : null,
    pf,
    avgSL: slN ? slSum / slN : null,
    avgTP: tpN ? tpSum / tpN : null,
    rr: rrN ? rrSum / rrN : null,
    streaks: { longestWin, longestLose },
    drawdown: { usd: maxDdUsd, pct: maxDdPct },
    recovery,
    // Holding period belum bisa dihitung: settlement Fase 3 belum menulis
    // activated_at/closed_at yang andal untuk semua sinyal.
    avgHold: null,
  };
}

// Statistik lengkap satu trader dari SEMUA sinyalnya (terbuka + tertutup).
// Sinyal terbuka (PENDING/AKTIF) hanya dihitung sebagai jumlah aktif.
export function computeStats(allSignals) {
  const list = (allSignals || []).slice().sort((a, b) =>
    new Date(a.closed_at || a.created_at) - new Date(b.closed_at || b.created_at));
  const closed = list.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
  const active = list.filter((s) => s.status === 'PENDING' || s.status === 'AKTIF').length;
  const base = statsFromClosed(closed);
  // Statistik per pair (hanya pair yang punya trade tertutup).
  const byPair = {};
  for (const s of closed) {
    (byPair[s.pair] = byPair[s.pair] || []).push(s);
  }
  const perPair = Object.keys(byPair).sort().map((pair) => {
    const st = statsFromClosed(byPair[pair]);
    return { pair, trades: st.closed, ...st };
  });
  // Statistik per bulan (dari closed_at, jatuh ke created_at).
  const byMonth = {};
  for (const s of closed) {
    const d = new Date(s.closed_at || s.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    (byMonth[key] = byMonth[key] || []).push(s);
  }
  const months = Object.keys(byMonth).sort().map((key) => {
    const [year, month] = key.split('-').map(Number);
    const st = statsFromClosed(byMonth[key]);
    return { year, month: month - 1, trades: st.closed, profit: st.totalUSD, pips: st.totalPips, wr: st.wr };
  });
  // Deret hasil (profit USD tiap trade tertutup, kronologis) untuk grafik.
  const results = closed.map((s) => profitOf(s)).filter((v) => v !== null && Number.isFinite(v));
  return {
    ...base,
    active,
    totalSignals: closed.length + active,
    perPair,
    months,
    results,
  };
}

// Peringkat KOMPOSIT 5 metrik (aturan §5, tanpa WR): tiap trader diranking
// 1..N pada profit, total R, drawdown terendah, profit factor, recovery
// factor; kelima peringkat dijumlahkan, total terkecil = #1; seri dipecah
// total profit lalu total R. Trader tanpa sinyal selesai dinilai terburuk.
export function rankedTraders(traders, statsByTrader) {
  const rows = traders.map((tr) => {
    const s = statsByTrader[tr.profile_id] || { closed: 0, totalUSD: 0, totalR: 0, drawdown: { usd: 0 }, pf: null, recovery: null };
    const has = s.closed > 0;
    return {
      tr,
      stats: s,
      profit: has ? s.totalUSD : -Infinity,
      totalR: has ? s.totalR : -Infinity,
      dd: has ? s.drawdown.usd : Infinity,
      pf: has && s.pf !== null && s.pf !== undefined ? s.pf : -Infinity,
      rf: has && s.recovery !== null && s.recovery !== undefined ? s.recovery : -Infinity,
      score: 0,
    };
  });
  function addRanks(key, lowerBetter) {
    for (const r of rows) {
      let better = 0;
      for (const o of rows) {
        if (o !== r && (lowerBetter ? o[key] < r[key] : o[key] > r[key])) better++;
      }
      r.score += better + 1;
    }
  }
  addRanks('profit', false);
  addRanks('totalR', false);
  addRanks('dd', true);
  addRanks('pf', false);
  addRanks('rf', false);
  rows.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (b.profit !== a.profit) return b.profit - a.profit;
    return b.totalR - a.totalR;
  });
  return rows;
}

// Sparkline SVG kumulatif profit (kosong bila <2 hasil — pemanggil yang
// menampilkan keadaan kosong yang jujur).
export function sparklineSVG(results, width = 520, height = 90) {
  if (!results || results.length < 2) return '';
  let cum = 0;
  const pts = [0];
  for (const v of results) { cum += v; pts.push(cum); }
  const min = Math.min(...pts, 0);
  const max = Math.max(...pts, 0);
  const span = (max - min) || 1;
  const px = (i) => (i / (pts.length - 1)) * width;
  const py = (v) => height - 8 - ((v - min) / span) * (height - 16);
  const line = pts.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const area = `0,${height} ${line} ${width},${height}`;
  const up = pts[pts.length - 1] >= 0;
  const color = up ? 'var(--buy)' : 'var(--sell)';
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" aria-hidden="true">`
    + `<polygon points="${area}" fill="${color}" opacity="0.12"/>`
    + `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
    + `</svg>`;
}
