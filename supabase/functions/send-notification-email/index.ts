import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Hapn <noreply@hapn.no>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PREF_MAP: Record<string, string> = {
  rsvp: "email_rsvp",
  comment: "email_comment",
  access_request: "email_access_request",
  invitation: "email_invitation",
  reminder: "email_reminder",
  waitlist_promoted: "email_rsvp", // reuse rsvp pref for waitlist
};

serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record) {
      return new Response(JSON.stringify({ error: "No record" }), { status: 400 });
    }

    const { user_id, type, event_id, actor_id, message } = record;

    // Check user's notification preferences
    const prefColumn = PREF_MAP[type];
    if (prefColumn) {
      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select(prefColumn)
        .eq("user_id", user_id)
        .single();

      if (prefs && prefs[prefColumn] === false) {
        return new Response(JSON.stringify({ skipped: "User opted out" }), { status: 200 });
      }
    }

    // Get user email
    const { data: profile } = await supabase
      .from("profiles")
      .select("email, name")
      .eq("id", user_id)
      .single();

    if (!profile?.email) {
      return new Response(JSON.stringify({ error: "No email" }), { status: 200 });
    }

    // Get event title
    const { data: event } = await supabase
      .from("events")
      .select("title")
      .eq("id", event_id)
      .single();

    const eventTitle = event?.title || "et event";

    // Get actor name
    let actorName = "";
    if (actor_id) {
      const { data: actor } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", actor_id)
        .single();
      actorName = actor?.name || "Noen";
    }

    // Build email content
    let subject = "";
    let body = "";

    switch (type) {
      case "rsvp":
        subject = `${actorName} meldte seg på ${eventTitle}`;
        body = `<p><strong>${actorName}</strong> har meldt seg på eventet ditt <strong>${eventTitle}</strong>.</p>`;
        break;
      case "comment":
        subject = `${actorName} kommenterte på ${eventTitle}`;
        body = `<p><strong>${actorName}</strong> kommenterte på eventet ditt <strong>${eventTitle}</strong>:</p><blockquote>${message || ""}</blockquote>`;
        break;
      case "access_request":
        subject = `${actorName} ber om tilgang til ${eventTitle}`;
        body = `<p><strong>${actorName}</strong> har bedt om tilgang til eventet ditt <strong>${eventTitle}</strong>.</p>`;
        break;
      case "invitation":
        subject = `Du er invitert til ${eventTitle}`;
        body = `<p><strong>${actorName}</strong> har invitert deg til eventet <strong>${eventTitle}</strong>.</p>`;
        break;
      case "reminder":
        subject = `Påminnelse: ${eventTitle} starter i morgen`;
        body = `<p>Eventet <strong>${eventTitle}</strong> som du deltar på starter i morgen!</p>`;
        break;
      case "waitlist_promoted":
        subject = `Du har fått plass på ${eventTitle}!`;
        body = `<p>En plass har blitt ledig på eventet <strong>${eventTitle}</strong>, og du har blitt flyttet fra ventelisten!</p>`;
        break;
      default:
        return new Response(JSON.stringify({ error: "Unknown type" }), { status: 200 });
    }

    // Send via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [profile.email],
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a2e; margin-bottom: 16px;">Hapn</h2>
            ${body}
            <p style="color: #888; font-size: 13px; margin-top: 24px;">Du kan endre varslingsinnstillingene dine i profilen din på Hapn.</p>
          </div>
        `,
      }),
    });

    const result = await res.json();
    return new Response(JSON.stringify(result), { status: res.ok ? 200 : 500 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
