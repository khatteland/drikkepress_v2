import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VIPPS_CLIENT_ID = Deno.env.get("VIPPS_CLIENT_ID")!;
const VIPPS_CLIENT_SECRET = Deno.env.get("VIPPS_CLIENT_SECRET")!;
const VIPPS_SUBSCRIPTION_KEY = Deno.env.get("VIPPS_SUBSCRIPTION_KEY")!;
const VIPPS_MERCHANT_SERIAL_NUMBER = Deno.env.get("VIPPS_MERCHANT_SERIAL_NUMBER")!;
const VIPPS_API_BASE = Deno.env.get("VIPPS_API_BASE") || "https://apitest.vipps.no";
const VIPPS_PAYMENT_REDIRECT_URI = Deno.env.get("VIPPS_PAYMENT_REDIRECT_URI")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function getVippsAccessToken(): Promise<string> {
  const res = await fetch(`${VIPPS_API_BASE}/accesstoken/get`, {
    method: "POST",
    headers: {
      "client_id": VIPPS_CLIENT_ID,
      "client_secret": VIPPS_CLIENT_SECRET,
      "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
      "Merchant-Serial-Number": VIPPS_MERCHANT_SERIAL_NUMBER,
    },
  });
  if (!res.ok) throw new Error(`Vipps token error: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

function getUserFromAuth(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "create") {
      return await handleCreate(req);
    } else if (action === "status") {
      return await handleStatus(req, url);
    } else if (action === "refund") {
      return await handleRefund(req);
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("vipps-payment error:", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function handleCreate(req: Request) {
  const userClient = getUserFromAuth(req);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { timeslot_id } = body;

  if (!timeslot_id) {
    return new Response(JSON.stringify({ error: "Missing timeslot_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Generate Vipps reference
  const vippsReference = `hapn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Call reserve_timeslot as the user
  const { data, error } = await userClient.rpc("reserve_timeslot", {
    p_timeslot_id: timeslot_id,
    p_vipps_reference: vippsReference,
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (data.status === "error") {
    return new Response(JSON.stringify(data), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Free ticket — no Vipps needed
  if (!data.payment_required) {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Create Vipps ePayment
  const vippsToken = await getVippsAccessToken();
  const amountInOre = data.amount;

  const paymentBody = {
    amount: {
      currency: "NOK",
      value: amountInOre,
    },
    paymentMethod: { type: "WALLET" },
    reference: vippsReference,
    userFlow: "WEB_REDIRECT",
    returnUrl: `${VIPPS_PAYMENT_REDIRECT_URI}?ref=${vippsReference}`,
    paymentDescription: `Hapn billett #${data.booking_id}`,
  };

  const paymentRes = await fetch(`${VIPPS_API_BASE}/epayment/v1/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${vippsToken}`,
      "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
      "Merchant-Serial-Number": VIPPS_MERCHANT_SERIAL_NUMBER,
      "Idempotency-Key": vippsReference,
    },
    body: JSON.stringify(paymentBody),
  });

  if (!paymentRes.ok) {
    const errText = await paymentRes.text();
    console.error("Vipps create payment failed:", errText);
    // Clean up the pending booking
    await supabaseAdmin.from("bookings").update({ status: "cancelled" }).eq("id", data.booking_id);
    await supabaseAdmin.from("transactions").update({ status: "cancelled" }).eq("vipps_reference", vippsReference);
    return new Response(JSON.stringify({ error: "Payment creation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const paymentData = await paymentRes.json();

  return new Response(JSON.stringify({
    status: "success",
    payment_required: true,
    redirect_url: paymentData.redirectUrl,
    vipps_reference: vippsReference,
    booking_id: data.booking_id,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleStatus(req: Request, url: URL) {
  const userClient = getUserFromAuth(req);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ref = url.searchParams.get("ref");
  if (!ref) {
    return new Response(JSON.stringify({ error: "Missing ref" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Look up transaction and booking
  const { data: tx } = await supabaseAdmin
    .from("transactions")
    .select("*, bookings(id, status, qr_token)")
    .eq("vipps_reference", ref)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!tx) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const booking = tx.bookings;

  return new Response(JSON.stringify({
    status: tx.status,
    booking_status: booking?.status,
    booking_id: booking?.id,
    qr_token: booking?.status === "confirmed" ? booking.qr_token : null,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleRefund(req: Request) {
  const userClient = getUserFromAuth(req);
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json();
  const { booking_id } = body;

  if (!booking_id) {
    return new Response(JSON.stringify({ error: "Missing booking_id" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cancel booking via RPC (as user)
  const { data: cancelData, error: cancelErr } = await userClient.rpc("cancel_booking", {
    p_booking_id: booking_id,
  });

  if (cancelErr) {
    return new Response(JSON.stringify({ error: cancelErr.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (cancelData.status === "error") {
    return new Response(JSON.stringify(cancelData), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // If Vipps refund needed
  if (cancelData.needs_refund && cancelData.vipps_reference) {
    try {
      const vippsToken = await getVippsAccessToken();

      // Get payment amount for refund
      const { data: tx } = await supabaseAdmin
        .from("transactions")
        .select("amount")
        .eq("vipps_reference", cancelData.vipps_reference)
        .single();

      const refundRes = await fetch(
        `${VIPPS_API_BASE}/epayment/v1/payments/${cancelData.vipps_reference}/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${vippsToken}`,
            "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
            "Merchant-Serial-Number": VIPPS_MERCHANT_SERIAL_NUMBER,
            "Idempotency-Key": `refund-${cancelData.vipps_reference}`,
          },
          body: JSON.stringify({
            modificationAmount: {
              currency: "NOK",
              value: tx?.amount || 0,
            },
          }),
        }
      );

      if (!refundRes.ok) {
        console.error("Vipps refund failed:", await refundRes.text());
      }
    } catch (refundErr) {
      console.error("Vipps refund error:", refundErr);
    }
  }

  return new Response(JSON.stringify({
    status: "success",
    refunded: cancelData.needs_refund || false,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
