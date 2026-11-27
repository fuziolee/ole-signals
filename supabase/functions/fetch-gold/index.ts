// OLE Signals: Edge Function fetch-gold (Ronde 65).
// Dipanggil pg_cron tiap 1 menit (anon key). Mengambil harga emas live dari
// XAUS SAJA, menulis HANYA baris XAUUSD ke tabel prices, lalu memanggil
// settle-signals supaya sinyal emas (entry/TP/SL) dinilai tiap menit.
// Forex TIDAK disentuh di sini, tetap jalur fetch-prices tiap 15 menit.
// TIDAK ADA panggilan UniRateAPI dan TIDAK ADA pembacaan secret
// UNIRATE_API_KEY: fungsi ini harus jalan walau secret itu tidak ada.
//
// Aturan tulis (sama seperti fetch-prices (b)):
//  * Bila XAUS gagal/basi/di luar pita, baris XAUUSD TIDAK disentuh:
//    harga + fetched_at lama dibiarkan; settle-signals akan melewati
//    XAUUSD bila fetched_at-nya sudah lebih tua dari 30 menit (tidak
//    pernah menutup sinyal dari harga basi).
//  * Harga di luar pita kewajaran DITOLAK (baris lama dibiarkan).
//  * settle-signals dipanggil setelah tulis (awaited); bila pemanggilan
//    gagal, dicatat di respons tapi TIDAK menggagalkan fetch, settle akan
//    jalan di putaran berikut (harga masih segar saat itu).
//  * HANYA harga spot emas yang dipakai (xau.price / spot_usd_oz via
//    parseXausResponse). Tabel fx_rates di respons XAUS JANGAN PERNAH
//    dipakai, tabel itu di-cache 12 jam.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { parseXausResponse, withinBand } from "../_shared/prices.ts";

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
    throw new Error(`HTTP ${res.status} dari ${url}`);
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
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ ok: false, error: "secret Supabase belum tersedia" }, 500);
  }

  const written: Record<string, number> = {};
  const skipped: Array<{ pair: string; reason: string }> = [];
  const sourceErrors: string[] = [];

  // XAUS, XAU/USD saja. Gagal/basi = baris lama dibiarkan (bukan ditulis).
  try {
    const data = await fetchJson(XAUS_URL, { Accept: "application/json" });
    const parsed = parseXausResponse(data);
    // Perbandingan eksplisit (=== false), bukan !parsed.ok: tsc tanpa
    // --strict tidak menyempitkan union diskriminan lewat !, sedangkan
    // === false menyempitkan (fetch-prices memakai ! dan lolos di runtime
    // karena esbuild tidak type-check, tapi di sini ditulis bersih).
    if (parsed.ok === false) {
      sourceErrors.push(`XAUS: ${parsed.error}`);
    } else if (!withinBand("XAUUSD", parsed.price)) {
      skipped.push({ pair: "XAUUSD", reason: `di luar pita kewajaran (${parsed.price})` });
    } else {
      written["XAUUSD"] = parsed.price;
    }
  } catch (e) {
    sourceErrors.push(`XAUS: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Tulis HANYA baris XAUUSD ke tabel prices (upsert + fetched_at baru).
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
    source_errors: sourceErrors,
    settle,
  });
});
