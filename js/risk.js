// OLE Signals — kalkulasi risiko client-side.
// Rumus SAMA dengan server (03_functions.sql) supaya yang tampil di form
// cocok dengan yang ditegakkan server. Server tetap yang memutuskan:
// form hanya memberi gambaran sebelum submit.
//
// Ronde 35: penyebut risiko adalah SALDO ACUAN LEVEL ref(L)
// ($10.000 x 1,05^(L-1)), BUKAN saldo simulasi aktual. ref tidak pernah
// turun (hanya naik ikut level); saldo simulasi yang naik/turun tidak
// memengaruhi batas risiko per trade.

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

// Jenis entry (Ronde 35) — cermin public.infer_entry_type di database.
// Disimpulkan dari entry vs harga live saat posting; sama persis = limit.
// null bila harga belum ada (server fallback 'limit').
export function inferEntryType(direction, entry, price) {
  if (price === null || price === undefined || !Number.isFinite(price)) return null;
  if (direction === 'BUY') return entry > price ? 'stop' : 'limit';
  if (direction === 'SELL') return entry < price ? 'stop' : 'limit';
  return null;
}

// { riskUsd, riskPct } atau { error: 'no-price' } bila konversi belum ada.
// riskPct dihitung terhadap saldo acuan level (refBalanceUsd).
export function calcRisk({ pair, entry, sl, lot, refBalanceUsd, prices }) {
  const conv = quoteToUsd(pair, prices);
  if (conv === null || conv === undefined) return { error: 'no-price' };
  const riskUsd = Math.abs(entry - sl) * lot * contractSize(pair) * conv;
  const riskPct = refBalanceUsd > 0 ? (riskUsd / refBalanceUsd) * 100 : null;
  return { riskUsd, riskPct };
}

// Validasi client meniru aturan server. Kembalikan kode error pertama
// yang kena, atau null bila lolos. Server tetap memeriksa ulang semuanya.
// §12 bug #5: pair tidak dikenal memakai kode 'pair' (bukan 'invalid').
export function validateSignal({ pair, direction, entry, sl, tp, lot, refBalanceUsd, prices }) {
  if (!PAIRS.includes(pair)) return 'pair';
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
  // D-R35-1: bandingkan RR dengan pembulatan 6 desimal. Aritmetika biner JS
  // membuat RR tepat 1:1 jadi 0,9999999999999556 sehingga ditolak keliru,
  // padahal server (numeric, desimal eksak) menerima 1:1. Tanpa ini,
  // form menolak trade yang servernya sendiri akan terima.
  if (rr === null || Math.round(rr * 1e6) / 1e6 < 1) return 'rr';
  const risk = calcRisk({ pair, entry, sl, lot, refBalanceUsd, prices });
  if (risk.error) return null; // tidak bisa dihitung di client; server yang menilai
  // D-R35-1: bulatkan risiko ke sen sebelum membandingkan — |1.1-1.095| di
  // JS = 0,0050000000000000044 sehingga risiko tepat $100 jadi
  // $100,00000000000232 dan ditolak keliru. Server menghitung dalam numeric.
  if (refBalanceUsd > 0 && (Math.round(risk.riskUsd * 100) / 100) / refBalanceUsd > 0.01) return 'risk';
  return null;
}

// Desimal tampil per pair (mengikuti angka yang dipakai di tes/latihan).
export function decimalsForPair(pair) {
  if (pair === 'XAUUSD') return 2;
  if (pair.endsWith('JPY')) return 2;
  return 4;
}
