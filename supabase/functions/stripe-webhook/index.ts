// supabase/functions/stripe-webhook/index.ts
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

Deno.serve(async (req) => {
  try {
    const sig = req.headers.get("stripe-signature");
    const body = await req.text();

    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
    if (!sig) return new Response("Missing signature", { status: 400 });

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature invalid:", err)
      return new Response(`Webhook signature invalid: ${String(err)}`, {
        status: 400,
      });
    }

    console.log("✅ Webhook event:", event.type)

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ✅ Idempotencia
    try {
      await supabaseAdmin
        .from("stripe_webhook_events")
        .insert({ id: event.id, type: event.type });
    } catch {
      console.log("Event already processed or table doesn't exist")
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const promotion_id = session.metadata?.promotion_id;
      const audio_id = session.metadata?.audio_id;
      const plan = session.metadata?.plan || "basic";

      if (!promotion_id || !audio_id) {
        console.error("Missing metadata:", { promotion_id, audio_id })
        return new Response("Missing metadata (promotion_id/audio_id)", {
          status: 400,
        });
      }

      console.log("📦 Processing promotion:", { promotion_id, audio_id, plan })

      const now = new Date();

      // ✅ 1) Leer la promoción (por si existe) pero NO dependemos de expires_at
      const { data: promo, error: promoError } = await supabaseAdmin
        .from("promotions")
        .select("id")
        .eq("id", promotion_id)
        .single();

      if (promoError || !promo) {
        console.error("Promotion not found:", promoError)
        return new Response("Promotion not found", { status: 404 });
      }

      // ✅ 2) Leer el promoted_until actual del audio (para extender si ya estaba promocionado)
      const { data: audioRow } = await supabaseAdmin
        .from("audios")
        .select("promoted_until")
        .eq("id", audio_id)
        .single();

      const currentUntil = audioRow?.promoted_until
        ? new Date(audioRow.promoted_until)
        : null;

      // Si ya estaba promocionado en el futuro, extendemos desde ahí
      const startsAt = currentUntil && currentUntil.getTime() > now.getTime()
        ? currentUntil
        : now;

      // Calculamos la nueva fecha de expiración (1 mes desde startsAt)
      const endsAt = new Date(startsAt);
      endsAt.setMonth(endsAt.getMonth() + 1);

      console.log("📅 Dates:", { 
        startsAt: startsAt.toISOString(), 
        endsAt: endsAt.toISOString() 
      })

      // ✅ 3) Marcar promotion como active
      const { error: updatePromoError } = await supabaseAdmin
        .from("promotions")
        .update({
          status: "active",
          paid_at: now.toISOString(),
          stripe_payment_intent_id: (session.payment_intent as string) ?? null,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          expires_at: endsAt.toISOString(),
        })
        .eq("id", promotion_id);

      if (updatePromoError) {
        console.error("Failed to update promotion:", updatePromoError)
      } else {
        console.log("✅ Promotion updated to active")
      }

      // ✅ 4) Marcar audio como promocionado
      const { error: updateAudioError } = await supabaseAdmin
        .from("audios")
        .update({
          promoted_until: endsAt.toISOString(),
          promoted_at: startsAt.toISOString(),
          promoted_plan: plan,
        })
        .eq("id", audio_id);

      if (updateAudioError) {
        console.error("Failed to update audio:", updateAudioError)
      } else {
        console.log("✅ Audio marked as promoted")
      }
    }

    return new Response("OK", { status: 200 });
  } catch (e) {
    console.error("Webhook error:", e)
    return new Response(`Webhook error: ${String(e)}`, { status: 500 });
  }
});