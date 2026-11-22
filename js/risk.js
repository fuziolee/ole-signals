// OLE Signals — kalkulasi risiko client-side.
// Rumus SAMA dengan server (03_functions.sql) supaya yang tampil di form
// cocok dengan yang ditegakkan server. Server tetap yang memutuskan:
// form hanya memberi gambaran sebelum submit.

export const PAIRS = [
  'XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD',
  'USDCHF', 'NZDUSD', 'USDCAD', 'EURJPY', 'EURGBP',
];

export function contractSize(pair) {
  return pair === 'XAUUSD' ? 100 : 100000;
}

// Nilai USD dari 1 unit mata uang quote pair, dari tabel prices.
// Sama dengan quote_to_usd() di database. NULL bila harga belum tersedia.
export function quoteToUsd(pair, prices) {
  const q = pair.slice(-3);
  if (q === 'USD') return 1;
  const get = (p) => {
    const v = prices ? prices.get(p) : undefined;
    return typeof v === 'number' && v > 0 ? v : null;
  };
  if (q === 'JPY') { const p = get('USDJPY'); return p ? 1 / p : null; }
  if (q === 'GBP') return get('GBPUSD');
  if (q === 'EUR') return get('EURUSD');
  if (q === 'AUD') return get('AUDUSD');
  if (q === 'CHF') { const p = get('USDCHF'); return p ? 1 / p : null; }
  if (q === 'NZD') return get('NZDUSD');
  if (q === 'CAD') { const p = get('USDCAD'); return p ? 1 / p : null; }
  return null;
}

export function calcRr(entry, sl, tp) {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  if (!(risk > 0)) return null;
  return reward / risk;
}

// { riskUsd, riskPct } atau { error: 'no-price' } bila konversi belum ada.
export function calcRisk({ pair, entry, sl, lot, balanceUsd, prices }) {
  const conv = quoteToUsd(pair, prices);
  if (conv === null || conv === undefined) return { error: 'no-price' };
  const riskUsd = Math.abs(entry - sl) * lot * contractSize(pair) * conv;
  const riskPct = balanceUsd > 0 ? (riskUsd / balanceUsd) * 100 : null;
  return { riskUsd, riskPct };
}

// Validasi client meniru aturan server. Kembalikan kode error pertama
// yang kena, atau null bila lolos. Server tetap memeriksa ulang semuanya.
export function validateSignal({ pair, direction, entry, sl, tp, lot, balanceUsd, prices }) {
  if (!PAIRS.includes(pair)) return 'invalid';
  if (direction !== 'BUY' && direction !== 'SELL') return 'invalid';
  if (![entry, sl, tp].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) {
    return 'invalid';
  }
  if (!(typeof lot === 'number' && Number.isFinite(lot) && lot > 0)) return 'invalid';
  const orderOk = direction === 'BUY'
    ? (sl < entry && entry < tp)
    : (tp < entry && entry < sl);
  if (!orderOk) return 'invalid-order';
  const rr = calcRr(entry, sl, tp);
  if (rr === null || rr < 1) return 'rr';
  const risk = calcRisk({ pair, entry, sl, lot, balanceUsd, prices });
  if (risk.error) return null; // tidak bisa dihitung di client; server yang menilai
  if (balanceUsd > 0 && risk.riskUsd / balanceUsd > 0.01) return 'risk';
  return null;
}

// Desimal tampil per pair (mengikuti angka yang dipakai di tes/latihan).
export function decimalsForPair(pair) {
  if (pair === 'XAUUSD') return 2;
  if (pair.endsWith('JPY')) return 2;
  return 4;
}
