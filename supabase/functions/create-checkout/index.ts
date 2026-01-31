import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization")
  if (!authHeader) return null
  const match = authHeader.trim().match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

function expectedLivemode(stripeSecretKey: string) {
  // Stripe: sk_live_... => livemode true, sk_test_... => livemode false
  if (stripeSecretKey.startsWith("sk_live_")) return true
  if (stripeSecretKey.startsWith("sk_test_")) return false
  // Si es raro, asumimos false para ser conservadores
  return false
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  try {
    // ✅ OJO: estas ENV son de SUPABASE (Edge Function), no de Vercel
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")

    const APP_URL = (Deno.env.get("APP_URL") || "http://localhost:5173").replace(/\/$/, "")

    const STRIPE_PRICE_ID_BASIC = Deno.env.get("STRIPE_PRICE_ID_BASIC")
    const STRIPE_PRICE_ID_PRO = Deno.env.get("STRIPE_PRICE_ID_PRO")
    const STRIPE_PRICE_ID_MAX = Deno.env.get("STRIPE_PRICE_ID_MAX")

    if (
      !SUPABASE_URL ||
      !SERVICE_ROLE_KEY ||
      !STRIPE_SECRET_KEY ||
      !STRIPE_PRICE_ID_BASIC ||
      !STRIPE_PRICE_ID_PRO ||
      !STRIPE_PRICE_ID_MAX
    ) {
      return json(
        {
          error: "Missing environment variables",
          required: [
            "SUPABASE_URL",
            "SERVICE_ROLE_KEY",
            "STRIPE_SECRET_KEY",
            "APP_URL",
            "STRIPE_PRICE_ID_BASIC",
            "STRIPE_PRICE_ID_PRO",
            "STRIPE_PRICE_ID_MAX",
          ],
        },
        500,
      )
    }

    const jwt = getBearerToken(req)
    if (!jwt) return json({ error: "No/Invalid Authorization header" }, 401)

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt)
    if (userError || !userData?.user) return json({ error: "Invalid JWT" }, 401)

    const user = userData.user

    const body = await req.json().catch(() => ({}))
    const audio_id = body?.audio_id
    const planRaw = body?.plan
    const plan = String(planRaw || "").trim().toLowerCase()

    if (!audio_id || !plan) {
      return json({ error: "Faltan campos: audio_id o plan" }, 400)
    }

    const priceIdMap: Record<string, string> = {
      basic: STRIPE_PRICE_ID_BASIC,
      pro: STRIPE_PRICE_ID_PRO,
      max: STRIPE_PRICE_ID_MAX,
    }

    const stripePriceId = priceIdMap[plan]
    if (!stripePriceId) return json({ error: "Plan inválido" }, 400)

    // Comprueba audio
    const { data: audioRow, error: audioErr } = await supabase
      .from("audios")
      .select("id, user_id")
      .eq("id", audio_id)
      .single()

    if (audioErr || !audioRow) return json({ error: "Audio no existe" }, 404)
    if (audioRow.user_id !== user.id) return json({ error: "Ese audio no es tuyo" }, 403)

    // Evitar promo activa
    const nowIso = new Date().toISOString()
    const { data: activePromo } = await supabase
      .from("promotions")
      .select("id, ends_at, status")
      .eq("user_id", user.id)
      .eq("audio_id", audio_id)
      .in("status", ["active", "paid"])
      .gt("ends_at", nowIso)
      .limit(1)
      .maybeSingle()

    if (activePromo?.id) {
      return json(
        {
          error: "Este audio ya tiene una promoción activa",
          promotion_id: activePromo.id,
          ends_at: activePromo.ends_at,
        },
        409,
      )
    }

    // Calcula expires (1 mes)
    const expiresAt = new Date()
    expiresAt.setMonth(expiresAt.getMonth() + 1)

    // Busca pending promo
    const { data: pendingPromo } = await supabase
      .from("promotions")
      .select("id, stripe_session_id, status, ends_at")
      .eq("user_id", user.id)
      .eq("audio_id", audio_id)
      .eq("status", "pending")
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // ✅ Reutiliza sesión SOLO si coincide livemode con tu key actual
    // (esto evita quedarte enganchado a una sesión vieja de TEST)
    const expLive = expectedLivemode(STRIPE_SECRET_KEY)

    if (pendingPromo?.stripe_session_id) {
      const existingSessionRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${pendingPromo.stripe_session_id}?expand[]=line_items`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        },
      )

      const existingSessionJson = await existingSessionRes.json().catch(() => null)

      if (
        existingSessionRes.ok &&
        existingSessionJson?.status === "open" &&
        typeof existingSessionJson?.livemode === "boolean" &&
        existingSessionJson.livemode === expLive &&
        existingSessionJson?.url
      ) {
        return json(
          { url: existingSessionJson.url, promotion_id: pendingPromo.id, reused: true },
          200,
        )
      }

      // Si no coincide (por ej. era test y ahora live), la invalidamos para que cree una nueva
      await supabase
        .from("promotions")
        .update({ stripe_session_id: null })
        .eq("id", pendingPromo.id)
    }

    // Crea/actualiza promo pending
    let promoId = pendingPromo?.id || null

    if (!promoId) {
      const { data: promo, error: promoError } = await supabase
        .from("promotions")
        .insert({
          user_id: user.id,
          audio_id,
          plan,
          currency: "eur",
          status: "pending",
          ends_at: expiresAt.toISOString(),
        })
        .select("id")
        .single()

      if (promoError || !promo?.id) {
        return json({ error: "Failed to create promotion", details: promoError }, 500)
      }
      promoId = promo.id
    } else {
      await supabase
        .from("promotions")
        .update({
          plan,
          currency: "eur",
          status: "pending",
          ends_at: expiresAt.toISOString(),
          stripe_session_id: null,
        })
        .eq("id", promoId)
    }

    // Crea Checkout Session (✅ con priceId)
    const params = new URLSearchParams()
    params.append("mode", "payment")

    params.append(
      "success_url",
      `${APP_URL}/#/app?promosuccess=true&audio_id=${encodeURIComponent(audio_id)}&plan=${encodeURIComponent(plan)}&promotion_id=${encodeURIComponent(promoId)}`,
    )
    params.append("cancel_url", `${APP_URL}/#/app?promocancel=true`)

    // ✅ aquí está el cambio clave: usamos priceId del catálogo
    params.append("line_items[0][price]", stripePriceId)
    params.append("line_items[0][quantity]", "1")

    // metadata
    params.append("metadata[promotion_id]", promoId)
    params.append("metadata[user_id]", user.id)
    params.append("metadata[audio_id]", audio_id)
    params.append("metadata[plan]", plan)

    params.append("payment_intent_data[metadata][promotion_id]", promoId)
    params.append("payment_intent_data[metadata][user_id]", user.id)
    params.append("payment_intent_data[metadata][audio_id]", audio_id)
    params.append("payment_intent_data[metadata][plan]", plan)

    params.append("client_reference_id", user.id)

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    const stripeJson = await stripeRes.json().catch(() => null)

    if (!stripeRes.ok || !stripeJson?.id || !stripeJson?.url) {
      return json({ error: "Stripe error", details: stripeJson }, 500)
    }

    await supabase
      .from("promotions")
      .update({ stripe_session_id: stripeJson.id })
      .eq("id", promoId)

    return json({ url: stripeJson.url, promotion_id: promoId, reused: false }, 200)
  } catch (e) {
    console.error("Function crash:", e)
    return json({ error: String(e) }, 500)
  }
})