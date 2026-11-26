// OLE Signals — Edge Function fetch-prices (Fase 3).
// Dipanggil pg_cron tiap 15 menit (anon key). Mengambil harga live dari
// UniRateAPI (fiat) + XAUS (emas), menulis ke tabel prices, lalu memanggil
// settle-signals. Kunci UniRateAPI dibaca dari secret UNIRATE_API_KEY —
// TIDAK PERNAH ditulis di kode/repo/chat.
//
// CATATAN AUTH UniRateAPI (terbukti 2026-11-26): dokumentasi UniRateAPI
// bilang kunci bisa dikirim lewat header `Authorization: Bearer` ATAU
// query param `api_key` — tapi untuk akun ini, Bearer SELALU ditolak
// HTTP 401 (tiga kunci berbeda, termasuk kunci baru), sedangkan
// `api_key` sebagai query param mengembalikan 200 di konsol Swagger
// UniRateAPI. Karena itu kunci dikirim sebagai query param.
// PENTING: fetchJson menyamarkan nilai api_key di pesan error, supaya
// kunci TIDAK PERNAH bocor ke respons / log.
//
// Aturan tulis (lihat laporan Fase 3):
//  * Satu sumber gagal TIDAK menggagalkan sumber lain — yang berhasil tetap
//    ditulis; yang gagal dilaporkan di respons.
//  * Harga di luar pita kewajaran DITOLAK (baris lama dibiarkan).
//  * Bila XAUS gagal/basi, baris XAUUSD TIDAK disentuh — fetched_at-nya
//    menua dan settle-signals akan melewati pair itu (tidak pernah menutup
//    sinyal dari harga basi).
//  * Bila UniRateAPI gagal total, tidak ada baris fiat yang ditulis.
//  * settle-signals dipanggil setelah tulis (awaited); bila pemanggilan
//    gagal, dicatat di respons tapi TIDAK menggagalkan fetch — settle akan
//    jalan di putaran berikut (harga masih segar saat itu).

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  PAIRS,
  parseXausResponse,
  ratesToPairPrices,
  validateUniRateResponse,
  withinBand,
} from "../_shared/prices.ts";

const UNIRATE_URL = "https://api.unirateapi.com/api/rates?from=USD";
const XAUS_URL = "https://xaus.com/api/v1/spot";
const FETCH_TIMEOUT_MS = 10_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Samarkan api_key bila ada di URL — kunci tidak boleh bocor ke
    // pesan error (pesan ini masuk ke respons invoke + log).
    const safeUrl = url.replace(/([?&])api_key=[^&]*/g, "$1api_key=***");
    throw new Error(`HTTP ${res.status} dari ${safeUrl}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method harus POST" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const unirateKey = Deno.env.get("UNIRATE_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ ok: false, error: "secret Supabase belum tersedia" }, 500);
  }
  if (!unirateKey) {
    return json({ ok: false, error: "secret UNIRATE_API_KEY belum tersedia" }, 500);
  }

  const written: Record<string, number> = {};
  const skipped: Array<{ pair: string; reason: string }> = [];
  const sourceErrors: string[] = [];

  // (a) UniRateAPI — semua pair fiat dalam 1 request.
  // Kunci dikirim sebagai query param api_key (bukan header Bearer —
  // lihat catatan auth di atas: Bearer ditolak 401 untuk akun ini).
  try {
    const unirateUrl =
      `${UNIRATE_URL}&api_key=${encodeURIComponent(unirateKey)}`;
    const data = await fetchJson(unirateUrl, { Accept: "application/json" });
    const valid = validateUniRateResponse(data);
    if (!valid.ok) {
      sourceErrors.push(`UniRateAPI: ${valid.error}`);
    } else {
      const prices = ratesToPairPrices(valid.rates);
      for (const [pair, price] of Object.entries(prices)) {
        if (!withinBand(pair, price)) {
          skipped.push({ pair, reason: `di luar pita kewajaran (${price})` });
          continue;
        }
        written[pair] = price;
      }
    }
  } catch (e) {
    sourceErrors.push(`UniRateAPI: ${e instanceof Error ? e.message : String(e)}`);
  }

  // (b) XAUS — XAU/USD. Gagal/basi = baris lama dibiarkan (bukan ditulis).
  try {
    const data = await fetchJson(XAUS_URL, { Accept: "application/json" });
    const parsed = parseXausResponse(data);
    if (!parsed.ok) {
      sourceErrors.push(`XAUS: ${parsed.error}`);
    } else if (!withinBand("XAUUSD", parsed.price)) {
      skipped.push({ pair: "XAUUSD", reason: `di luar pita kewajaran (${parsed.price})` });
    } else {
      written["XAUUSD"] = parsed.price;
    }
  } catch (e) {
    sourceErrors.push(`XAUS: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Tulis yang berhasil ke tabel prices (upsert per pair + fetched_at baru).
  const nowIso = new Date().toISOString();
  if (Object.keys(written).length > 0) {
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const rows = Object.entries(written).map(([pair, price]) => ({
      pair,
      price,
      fetched_at: nowIso,
    }));
    const { error } = await supabase.from("prices").upsert(rows, {
      onConflict: "pair",
    });
    if (error) {
      return json({ ok: false, error: `gagal menulis prices: ${error.message}` }, 500);
    }
  }

  // Panggil settle-signals (awaited; gagal = dicatat, bukan digagalkan).
  let settle: Record<string, unknown> = { invoked: false };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/settle-signals`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    settle = { invoked: true, http_status: res.status, result: body };
  } catch (e) {
    settle = {
      invoked: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return json({
    ok: true,
    fetched_at: nowIso,
    written,
    skipped,
    missing_pairs: PAIRS.filter((p) => !(p in written)),
    source_errors: sourceErrors,
    settle,
  });
});
