// supabase/functions/verify-turnstile/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type VerifyRequest = {
  token?: string;
  action?: string; // opcional: para validar que el token corresponde a la acción esperada
};

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("CORS_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...headers },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    // Soporta JSON; si falla el parseo, devolvemos 400
    let payload: VerifyRequest;
    try {
      payload = (await req.json()) as VerifyRequest;
    } catch {
      return json(400, { success: false, error: "Invalid JSON body" });
    }

    const token = payload?.token;
    const expectedAction = payload?.action;

    if (!token) {
      return json(400, { success: false, error: "Missing token" });
    }

    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!secret) {
      return json(500, { success: false, error: "TURNSTILE_SECRET_KEY not set" });
    }

    // (Opcional) Envía la IP del cliente si Cloudflare/Proxy la manda
    const ip =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for") ??
      undefined;

    // Cloudflare recomienda application/x-www-form-urlencoded
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);

    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    const data = (await r.json()) as Record<string, unknown>;

    // Validación opcional por hostname (si defines TURNSTILE_ALLOWED_HOSTNAMES)
    const allowedHostnamesRaw = Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES");
    if (allowedHostnamesRaw && data.hostname) {
      const allowed = allowedHostnamesRaw
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(String(data.hostname))) {
        return json(200, {
          success: false,
          error: "Hostname not allowed",
          hostname: data.hostname,
        });
      }
    }

    // Validación opcional por action (si tu front envía action)
    if (expectedAction && data.action && String(data.action) !== expectedAction) {
      return json(200, {
        success: false,
        error: "Action mismatch",
        expectedAction,
        action: data.action,
      });
    }

    // Respuesta normalizada (no dependas de nombres raros en el front)
    return json(200, {
      success: data.success === true,
      challenge_ts: data.challenge_ts ?? null,
      hostname: data.hostname ?? null,
      action: data.action ?? null,
      cdata: data.cdata ?? null,
      error_codes: (data["error-codes"] as unknown) ?? [],
    });
  } catch (e) {
    return json(500, { success: false, error: String(e) });
  }
});