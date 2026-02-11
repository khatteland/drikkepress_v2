import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VIPPS_CLIENT_ID = Deno.env.get("VIPPS_CLIENT_ID")!;
const VIPPS_CLIENT_SECRET = Deno.env.get("VIPPS_CLIENT_SECRET")!;
const VIPPS_SUBSCRIPTION_KEY = Deno.env.get("VIPPS_SUBSCRIPTION_KEY")!;
const VIPPS_API_BASE = Deno.env.get("VIPPS_API_BASE") || "https://apitest.vipps.no";
const VIPPS_LOGIN_REDIRECT_URI = Deno.env.get("VIPPS_LOGIN_REDIRECT_URI")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = Deno.env.get("APP_URL") || "http://localhost:5173";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    if (action === "init") {
      return handleInit(url);
    } else if (action === "callback") {
      return await handleCallback(url);
    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (err) {
    console.error("vipps-auth error:", err);
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", "auth_failed");
    return Response.redirect(redirectUrl.toString(), 302);
  }
});

function handleInit(url: URL) {
  const returnTo = url.searchParams.get("return_to") || "/discover";

  const state = btoa(JSON.stringify({ return_to: returnTo, ts: Date.now() }));

  const authUrl = new URL(`${VIPPS_API_BASE}/access-management-1.0/access/oauth2/auth`);
  authUrl.searchParams.set("client_id", VIPPS_CLIENT_ID);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid name email phoneNumber birthDate");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("redirect_uri", VIPPS_LOGIN_REDIRECT_URI);

  return Response.redirect(authUrl.toString(), 302);
}

async function handleCallback(url: URL) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code) {
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", error || "no_code");
    return Response.redirect(redirectUrl.toString(), 302);
  }

  // Parse state to get return_to
  let returnTo = "/discover";
  try {
    const stateData = JSON.parse(atob(state || ""));
    returnTo = stateData.return_to || "/discover";
  } catch {}

  // Exchange code for tokens
  const tokenRes = await fetch(`${VIPPS_API_BASE}/access-management-1.0/access/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${btoa(`${VIPPS_CLIENT_ID}:${VIPPS_CLIENT_SECRET}`)}`,
      "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
      "Merchant-Serial-Number": Deno.env.get("VIPPS_MERCHANT_SERIAL_NUMBER") || "",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: VIPPS_LOGIN_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", "token_exchange_failed");
    return Response.redirect(redirectUrl.toString(), 302);
  }

  const tokens = await tokenRes.json();

  // Get user info from Vipps
  const userinfoRes = await fetch(`${VIPPS_API_BASE}/vipps-userinfo-api/userinfo`, {
    headers: {
      "Authorization": `Bearer ${tokens.access_token}`,
      "Ocp-Apim-Subscription-Key": VIPPS_SUBSCRIPTION_KEY,
    },
  });

  if (!userinfoRes.ok) {
    console.error("Userinfo failed:", await userinfoRes.text());
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", "userinfo_failed");
    return Response.redirect(redirectUrl.toString(), 302);
  }

  const userinfo = await userinfoRes.json();
  const vippsSub = userinfo.sub;
  const email = userinfo.email;
  const name = userinfo.name || `${userinfo.given_name || ""} ${userinfo.family_name || ""}`.trim();
  const phone = userinfo.phone_number;
  const birthdate = userinfo.birthdate; // YYYY-MM-DD

  if (!email || !vippsSub) {
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", "missing_user_data");
    return Response.redirect(redirectUrl.toString(), 302);
  }

  // Check if user exists by vipps_sub
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("vipps_sub", vippsSub)
    .maybeSingle();

  let userId: string;

  if (existingProfile) {
    // Returning user — update profile info
    userId = existingProfile.id;
    await supabaseAdmin.from("profiles").update({
      name: name || undefined,
      phone: phone || undefined,
      birthdate: birthdate || undefined,
    }).eq("id", userId);
  } else {
    // Check if user exists by email (migration case)
    const { data: emailUser } = await supabaseAdmin.auth.admin.listUsers();
    const existingAuthUser = emailUser?.users?.find(u => u.email === email);

    if (existingAuthUser) {
      // Link Vipps to existing user
      userId = existingAuthUser.id;
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { name, phone, birthdate, vipps_sub: vippsSub },
      });
      await supabaseAdmin.from("profiles").update({
        name, phone, birthdate, vipps_sub: vippsSub,
      }).eq("id", userId);
    } else {
      // Create new user
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { name, phone, birthdate, vipps_sub: vippsSub },
      });

      if (createErr || !newUser.user) {
        console.error("Create user failed:", createErr);
        const redirectUrl = new URL("/login", APP_URL);
        redirectUrl.searchParams.set("error", "create_user_failed");
        return Response.redirect(redirectUrl.toString(), 302);
      }

      userId = newUser.user.id;
    }
  }

  // Generate magic link for session
  const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${APP_URL}${returnTo}`,
    },
  });

  if (linkErr || !linkData) {
    console.error("Generate link failed:", linkErr);
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", "session_failed");
    return Response.redirect(redirectUrl.toString(), 302);
  }

  // Redirect to the verify URL — Supabase will process it and redirect to frontend with tokens
  const verifyUrl = linkData.properties?.action_link;
  if (!verifyUrl) {
    const redirectUrl = new URL("/login", APP_URL);
    redirectUrl.searchParams.set("error", "no_verify_url");
    return Response.redirect(redirectUrl.toString(), 302);
  }

  return Response.redirect(verifyUrl, 302);
}
