// OLE Signals — logika konversi harga murni (tanpa import Deno/Supabase).
// Dipakai fetch-prices; bisa dites langsung dengan Node (type stripping).
//
// SUMBER DATA (terverifikasi 2026-11-26):
//  * UniRateAPI GET /api/rates?from=USD -> { base: "USD", rates: { EUR, GBP,
//    JPY, ... } } dengan rates = unit mata uang per 1 USD. Contoh terverifikasi
//    terhadap quote yang diketahui benar (halaman forex UniRateAPI):
//    EUR 0.9129 -> EURUSD = 1/0.9129 = 1.0954 (halaman: 1.09536).
//    GBP 0.7633 -> GBPUSD = 1/0.7633 = 1.3102 (halaman: 1.30894).
//    JPY 159.24 -> USDJPY = 159.24 (halaman: 159.16527).
//    AUD 1.5073 -> AUDUSD = 1/1.5073 = 0.6635 (halaman: 0.66055).
//    CHF 0.8367 -> USDCHF = 0.8367 (halaman: 0.83589).
//    CAD 1.4291 -> USDCAD = 1.4291 (halaman: 1.42889).
//    EURGBP = EURUSD/GBPUSD = GBP/EUR = 0.8365.
//    EURJPY = EURUSD*USDJPY = JPY/EUR = 174.51.
//    GBPJPY = GBPUSD*USDJPY = JPY/GBP = 208.63.
//  * XAUS GET https://xaus.com/api/v1/spot -> { xau: { price }, spot_usd_oz,
//    stale: boolean, ... }. Terverifikasi live 2026-11-26 01:45 UTC:
//    xau.price = 3557, spot_usd_oz = 3557, stale = false, umur data 9 detik.
//    fx_rates di respons yang sama cocok dengan quote UniRateAPI di atas
//    (EUR 0.91245, GBP 0.763269, JPY 159.238818) — payload-nya segar.
//
// CATATAN: pita sanity di bawah adalah tripwire terhadap respons sampah
// (0, negatif, absurd) — BUKAN jaminan terhadap inversi (mis. EURUSD
// 0.9129 lolos pita 0.8-1.6). Inversi dicegah oleh rumus terverifikasi di
// atas + cek quote pasca-deploy (lihat laporan Fase 3).

export const PAIRS: string[] = [
  "XAUUSD",
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "GBPJPY",
  "AUDUSD",
  "USDCHF",
  "NZDUSD",
  "USDCAD",
  "EURJPY",
  "EURGBP",
];

// Mata uang yang wajib ada di respons UniRateAPI (base USD).
export const REQUIRED_CURRENCIES: string[] = [
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CHF",
  "NZD",
  "CAD",
];

// Pita kewajaran per pair (harga di luar pita = ditolak, baris lama dibiarkan).
export const SANITY_BANDS: Record<string, [number, number]> = {
  XAUUSD: [2000, 6000],
  EURUSD: [0.8, 1.6],
  GBPUSD: [1.0, 2.0],
  USDJPY: [100, 220],
  GBPJPY: [150, 280],
  AUDUSD: [0.5, 1.1],
  USDCHF: [0.7, 1.3],
  NZDUSD: [0.4, 1.0],
  USDCAD: [1.0, 1.8],
  EURJPY: [120, 220],
  EURGBP: [0.7, 1.0],
};

export type RatesMap = Record<string, number>;

export function isFinitePositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Validasi mentah respons UniRateAPI: base USD + semua mata uang wajib ada. */
export function validateUniRateResponse(
  data: unknown,
): { ok: true; rates: RatesMap } | { ok: false; error: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "respons UniRateAPI bukan objek" };
  }
  const d = data as Record<string, unknown>;
  if (d.base !== "USD") {
    return { ok: false, error: `base bukan USD: ${String(d.base)}` };
  }
  const rates = d.rates;
  if (!rates || typeof rates !== "object") {
    return { ok: false, error: "respons UniRateAPI tanpa rates" };
  }
  const r = rates as Record<string, unknown>;
  for (const cur of REQUIRED_CURRENCIES) {
    if (!isFinitePositive(r[cur])) {
      return { ok: false, error: `mata uang ${cur} hilang/tidak valid` };
    }
  }
  return { ok: true, rates: r as RatesMap };
}

/** Ubah rates UniRateAPI (base USD) menjadi harga 10 pair fiat. */
export function ratesToPairPrices(rates: RatesMap): Record<string, number> {
  const eur = rates.EUR;
  const gbp = rates.GBP;
  const jpy = rates.JPY;
  return {
    EURUSD: 1 / eur,
    GBPUSD: 1 / gbp,
    AUDUSD: 1 / rates.AUD,
    NZDUSD: 1 / rates.NZD,
    USDJPY: jpy,
    USDCHF: rates.CHF,
    USDCAD: rates.CAD,
    EURGBP: gbp / eur,
    EURJPY: jpy / eur,
    GBPJPY: jpy / gbp,
  };
}

/** Validasi mentah respons XAUS: ambil harga emas USD/oz, tolak bila basi. */
export function parseXausResponse(
  data: unknown,
): { ok: true; price: number } | { ok: false; error: string } {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "respons XAUS bukan objek" };
  }
  const d = data as Record<string, unknown>;
  if (d.stale === true) {
    return { ok: false, error: "XAUS menandai datanya basi (stale=true)" };
  }
  const ds = d.data_state as Record<string, unknown> | undefined;
  if (ds && ds.status && ds.status !== "fresh") {
    return { ok: false, error: `XAUS data_state=${String(ds.status)}` };
  }
  const xau = d.xau as Record<string, unknown> | undefined;
  const price = xau && typeof xau.price === "number"
    ? xau.price
    : typeof d.spot_usd_oz === "number"
    ? (d.spot_usd_oz as number)
    : NaN;
  if (!isFinitePositive(price)) {
    return { ok: false, error: "harga XAUUSD dari XAUS tidak valid" };
  }
  return { ok: true, price };
}

/** Cek satu harga terhadap pitanya. */
export function withinBand(pair: string, price: number): boolean {
  const band = SANITY_BANDS[pair];
  if (!band) return false;
  return price >= band[0] && price <= band[1];
}
