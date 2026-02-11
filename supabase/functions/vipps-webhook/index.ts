import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VIPPS_WEBHOOK_SECRET = Deno.env.get("VIPPS_WEBHOOK_SECRET") || "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Verify webhook authorization
    const authHeader = req.headers.get("authorization") || "";
    if (VIPPS_WEBHOOK_SECRET && authHeader !== VIPPS_WEBHOOK_SECRET) {
      console.error("Invalid webhook authorization");
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = await req.json();
    console.log("Vipps webhook received:", JSON.stringify(payload));

    const reference = payload.reference;
    const pspReference = payload.pspReference;
    const eventName = payload.name; // AUTHORIZED, CANCELLED, EXPIRED, FAILED, etc.

    if (!reference) {
      return new Response(JSON.stringify({ error: "Missing reference" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (eventName === "AUTHORIZED") {
      // Payment authorized — confirm booking
      const { data, error } = await supabaseAdmin.rpc("confirm_vipps_payment", {
        p_vipps_reference: reference,
        p_psp_reference: pspReference || null,
      });

      if (error) {
        console.error("confirm_vipps_payment error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      console.log("Payment confirmed:", data);
    } else if (["CANCELLED", "EXPIRED", "FAILED", "REJECTED"].includes(eventName)) {
      // Payment failed — cancel booking
      const { data: tx } = await supabaseAdmin
        .from("transactions")
        .select("booking_id")
        .eq("vipps_reference", reference)
        .maybeSingle();

      if (tx) {
        await supabaseAdmin
          .from("bookings")
          .update({ status: "cancelled" })
          .eq("id", tx.booking_id)
          .eq("status", "pending_payment");

        await supabaseAdmin
          .from("transactions")
          .update({ status: "cancelled" })
          .eq("vipps_reference", reference)
          .eq("status", "pending");
      }

      console.log(`Payment ${eventName} for ref:`, reference);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
