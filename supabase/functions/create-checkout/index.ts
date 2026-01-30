import { serve } from "https://deno.land/std/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")
    const APP_URL = Deno.env.get("APP_URL") || "http://localhost:5173"

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization")

    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const match = authHeader.trim().match(/^Bearer\s+(.+)$/i)
    const jwt = match?.[1]?.trim()
    
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Invalid Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: userData, error: userError } = await supabase.auth.getUser(jwt)

    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const user = userData.user

    const body = await req.json().catch(() => ({}))
    const audio_id = body?.audio_id
    const planRaw = body?.plan
    const plan = String(planRaw || "").trim().toLowerCase()

    if (!audio_id || !plan) {
      return new Response(JSON.stringify({ error: "Faltan campos: audio_id o plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const priceMap = {
      basic: 100,
      pro: 300,
      max: 500,
    }

    const amount = priceMap[plan]
    if (!amount) {
      return new Response(JSON.stringify({ error: "Plan inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const { data: audioRow, error: audioErr } = await supabase
      .from("audios")
      .select("id, user_id")
      .eq("id", audio_id)
      .single()

    if (audioErr || !audioRow) {
      return new Response(JSON.stringify({ error: "Audio no existe" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (audioRow.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Ese audio no es tuyo" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const nowIso = new Date().toISOString()

    const { data: activePromo, error: activePromoErr } = await supabase
      .from("promotions")
      .select("id, ends_at, status")
      .eq("user_id", user.id)
      .eq("audio_id", audio_id)
      .in("status", ["active", "paid"])
      .gt("ends_at", nowIso)
      .limit(1)
      .maybeSingle()

    if (activePromoErr) {
      console.log("⚠️ active promo check error:", activePromoErr)
    }

    if (activePromo?.id) {
      return new Response(
        JSON.stringify({
          error: "Este audio ya tiene una promoción activa",
          promotion_id: activePromo.id,
          ends_at: activePromo.ends_at,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setMonth(expiresAt.getMonth() + 1)

    const { data: pendingPromo, error: pendingPromoErr } = await supabase
      .from("promotions")
      .select("id, stripe_session_id, status, ends_at")
      .eq("user_id", user.id)
      .eq("audio_id", audio_id)
      .eq("status", "pending")
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pendingPromoErr) {
      console.log("⚠️ pending promo check error:", pendingPromoErr)
    }

    if (pendingPromo?.stripe_session_id) {
      const existingSessionRes = await fetch(
        `https://api.stripe.com/v1/checkout/sessions/${pendingPromo.stripe_session_id}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
          },
        }
      )

      const existingSessionJson = await existingSessionRes.json()

      if (existingSessionRes.ok && existingSessionJson?.status === "open" && existingSessionJson?.url) {
        return new Response(
          JSON.stringify({ url: existingSessionJson.url, promotion_id: pendingPromo.id, reused: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }
    }

    let promoId = pendingPromo?.id || null

    if (!promoId) {
      const { data: promo, error: promoError } = await supabase
        .from("promotions")
        .insert({
          user_id: user.id,
          audio_id,
          plan,
          amount,
          currency: "eur",
          status: "pending",
          ends_at: expiresAt.toISOString(),
        })
        .select("id")
        .single()

      if (promoError || !promo?.id) {
        console.error("Promotion failed:", promoError)
        return new Response(
          JSON.stringify({ error: "Failed to create promotion", details: promoError }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        )
      }

      promoId = promo.id
    } else {
      await supabase
        .from("promotions")
        .update({
          plan,
          amount,
          currency: "eur",
          status: "pending",
          ends_at: expiresAt.toISOString(),
          stripe_session_id: null,
        })
        .eq("id", promoId)
    }

    const params = new URLSearchParams()
    params.append("mode", "payment")
    
    params.append(
      "success_url",
      `${APP_URL}/#/app?promosuccess=true&audio_id=${audio_id}&plan=${plan}&promotion_id=${promoId}`,
    )
    params.append(
      "cancel_url",
      `${APP_URL}/#/app?promocancel=true`,
    )

    params.append("line_items[0][price_data][currency]", "eur")
    params.append(
      "line_items[0][price_data][product_data][name]",
      `Promoción ${plan.toUpperCase()} - 1 mes`,
    )
    params.append("line_items[0][price_data][unit_amount]", String(amount))
    params.append("line_items[0][quantity]", "1")

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

    const stripeJson = await stripeRes.json()

    if (!stripeRes.ok) {
      console.error("Stripe error:", stripeJson)
      return new Response(JSON.stringify({ error: "Stripe error", details: stripeJson }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    await supabase
      .from("promotions")
      .update({ stripe_session_id: stripeJson.id })
      .eq("id", promoId)

    return new Response(
      JSON.stringify({ url: stripeJson.url, promotion_id: promoId, reused: false }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (e) {
    console.error("Function crash:", e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})