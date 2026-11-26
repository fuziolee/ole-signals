// OLE Signals — Edge Function settle-signals (Fase 3).
// Dipanggil fetch-prices tiap harga baru masuk (anon key) — dan bisa
// dipanggil manual untuk pengujian. Seluruh logika ada di fungsi database
// settle_signals() (SECURITY DEFINER, hanya service_role): kedaluwarsa,
// aktivasi, penutupan, notifikasi, audit, recalc level. Function ini hanya
// jembatan tipis: panggil RPC, kembalikan ringkasannya.

import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ ok: false, error: "secret Supabase belum tersedia" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.rpc("settle_signals");
  if (error) {
    return json({ ok: false, error: `settle_signals gagal: ${error.message}` }, 500);
  }
  return json(data ?? { ok: false, error: "settle_signals tanpa hasil" });
});
