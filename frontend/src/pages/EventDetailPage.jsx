import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { formatDate, formatShortDate, timeAgo, uploadImage } from "../utils/helpers";
import { generateIcsFile } from "../utils/calendar";
import { Avatar, ImageGallery } from "../components/shared";
import { QRCodeSVG } from "qrcode.react";

// ============================================================
// INVITATION MANAGER
// ============================================================

function InvitationManager({ eventId }) {
  const { t } = useI18n();
  const [invitations, setInvitations] = useState([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(() => {
    supabase.from("invitations").select("*").eq("event_id", eventId).then(({ data }) => setInvitations(data || []));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!email.trim()) return;
    const { error: err } = await supabase.from("invitations").insert({ event_id: eventId, user_email: email.trim(), invited_by: (await supabase.auth.getUser()).data.user.id });
    if (err) { setError(err.message); return; }
    setSuccess(`${t("inv.sent")} ${email.trim()}`);
    setEmail("");
    load();
    setTimeout(() => setSuccess(""), 3000);
  };

  const handleRemove = async (id) => {
    await supabase.from("invitations").delete().eq("id", id);
    load();
  };

  return (
    <div className="invitation-section">
      <h3>{t("inv.title")}</h3>
      <form className="invite-form" onSubmit={handleInvite}>
        <input type="email" placeholder={t("inv.placeholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm">{t("inv.submit")}</button>
      </form>
      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      {success && <div style={{ color: "#16a34a", fontSize: 14, marginTop: 8 }}>{success}</div>}
      {invitations.length > 0 && (
        <div className="invitation-list">
          {invitations.map((inv) => (
            <div key={inv.id} className="invitation-item">
              <span>{inv.user_email}</span>
              <button className="btn btn-danger btn-sm" onClick={() => handleRemove(inv.id)}>{t("inv.remove")}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ACCESS REQUEST MANAGER
// ============================================================

function AccessRequestManager({ eventId }) {
  const { t } = useI18n();
  const [requests, setRequests] = useState([]);

  const load = useCallback(() => {
    supabase
      .from("access_requests")
      .select("*, profiles(name, email)")
      .eq("event_id", eventId)
      .then(({ data }) => setRequests(data || []));
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleDecision = async (requestId, status) => {
    await supabase.from("access_requests").update({ status }).eq("id", requestId);
    load();
  };

  const pending = requests.filter((r) => r.status === "pending");
  const handled = requests.filter((r) => r.status !== "pending");
  if (requests.length === 0) return null;

  return (
    <div className="access-requests-section">
      <h3>{t("ar.title")}</h3>
      {pending.length > 0 && (
        <div>
          {pending.map((r) => (
            <div key={r.id} className="access-request-item">
              <div>
                <strong>{r.profiles?.name}</strong> ({r.profiles?.email})
                {r.message && <p style={{ margin: "4px 0 0", fontSize: 14, color: "#666" }}>{r.message}</p>}
              </div>
              <div className="access-request-actions">
                <button className="btn btn-primary btn-sm" onClick={() => handleDecision(r.id, "approved")}>{t("ar.approve")}</button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDecision(r.id, "denied")}>{t("ar.deny")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {handled.length > 0 && (
        <div className="access-requests-handled">
          <h4>{t("ar.handled")}</h4>
          {handled.map((r) => (
            <div key={r.id} className="access-request-item">
              <span>{r.profiles?.name} ({r.profiles?.email})</span>
              <span className={`access-request-status ${r.status}`}>
                {r.status === "approved" ? t("ar.approved") : t("ar.denied")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// ADMIN MANAGER (Creator only — manage co-admins)
// ============================================================

function AdminManager({ eventId }) {
  const { t } = useI18n();
  const [admins, setAdmins] = useState([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("event_admins")
      .select("*, profiles(name, email, avatar_url)")
      .eq("event_id", eventId);
    setAdmins(data || []);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!email.trim()) return;

    // Look up user by email
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, name, email")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (!profile) {
      setError(t("admin.notFound"));
      return;
    }

    // Check if already admin
    const existing = admins.find(a => a.user_id === profile.id);
    if (existing) {
      setError(t("admin.alreadyAdmin"));
      return;
    }

    const { error: err } = await supabase
      .from("event_admins")
      .insert({ event_id: eventId, user_id: profile.id });

    if (err) { setError(err.message); return; }
    setSuccess(t("admin.added"));
    setEmail("");
    load();
    setTimeout(() => setSuccess(""), 3000);
  };

  const handleRemove = async (id) => {
    await supabase.from("event_admins").delete().eq("id", id);
    load();
  };

  return (
    <div className="admin-section">
      <h3>{t("admin.title")}</h3>
      <form className="invite-form" onSubmit={handleAdd}>
        <input type="email" placeholder={t("admin.placeholder")} value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm">{t("admin.submit")}</button>
      </form>
      {error && <div className="form-error" style={{ marginTop: 8 }}>{error}</div>}
      {success && <div style={{ color: "#16a34a", fontSize: 14, marginTop: 8 }}>{success}</div>}
      {admins.length > 0 ? (
        <div className="invitation-list">
          {admins.map((a) => (
            <div key={a.id} className="invitation-item">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar name={a.profiles?.name} avatarUrl={a.profiles?.avatar_url} size={24} />
                <span>{a.profiles?.name} ({a.profiles?.email})</span>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => handleRemove(a.id)}>{t("admin.remove")}</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="no-invitations">{t("admin.empty")}</div>
      )}
    </div>
  );
}

// ============================================================
// QR TOGGLE SECTION (Creator only)
// ============================================================

function QrToggleSection({ eventId, qrEnabled, onToggle }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    await supabase.rpc("toggle_qr_enabled", { p_event_id: eventId });
    onToggle();
    setLoading(false);
  };

  return (
    <div className="qr-toggle-section">
      <div>
        <div className="qr-toggle-label">{qrEnabled ? t("qr.disableToggle") : t("qr.enableToggle")}</div>
        <div className="qr-toggle-status">{qrEnabled ? t("qr.enabled") : t("qr.disabled")}</div>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={qrEnabled} onChange={handleToggle} disabled={loading} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

// ============================================================
// QR TICKET SECTION (Attendee — going + qr_enabled + not kicked)
// ============================================================

function QrTicketSection({ event }) {
  const { t } = useI18n();
  const [showQr, setShowQr] = useState(false);

  if (!event.qr_enabled || !event.my_qr_token || event.my_kicked) return null;

  const qrValue = `${window.location.origin}/event/${event.id}/checkin?token=${event.my_qr_token}`;

  return (
    <div className="qr-ticket-section">
      <h3>{t("qr.myTicket")}</h3>
      <button className="btn btn-secondary btn-sm" onClick={() => setShowQr(!showQr)}>
        {showQr ? t("qr.hideMyQr") : t("qr.showMyQr")}
      </button>
      {showQr && (
        <div className="qr-code-wrapper qr-code-animate">
          <QRCodeSVG value={qrValue} size={240} level="M" />
        </div>
      )}
      {event.my_checked_in_at ? (
        <div className="qr-checked-in-badge">&#10003; {t("qr.checkedIn")}</div>
      ) : (
        <div className="qr-not-checked-in">&#9675; {t("qr.notCheckedIn")}</div>
      )}
    </div>
  );
}

// ============================================================
// EVENT DETAIL PAGE
// ============================================================

export function EventDetailPage({ eventId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [commentImageUrl, setCommentImageUrl] = useState("");
  const [commentUploading, setCommentUploading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const commentFileRef = useRef(null);
  const [accessMessage, setAccessMessage] = useState("");
  const [accessSubmitting, setAccessSubmitting] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [venueData, setVenueData] = useState(null);

  const loadEvent = useCallback(() => {
    supabase.rpc("get_event_detail", { p_event_id: eventId }).then(({ data, error }) => {
      setEvent(data);
      setLoading(false);
      // Load venue data if event has venue_id
      if (data && data.venue_id) {
        supabase.from("venues").select("id, name, address, image_url").eq("id", data.venue_id).single().then(({ data: vd }) => {
          setVenueData(vd);
        });
      }
    });
  }, [eventId]);

  useEffect(() => { loadEvent(); }, [loadEvent]);

  const handleRSVP = async (status) => {
    if (!user) return onNavigate("login");
    if (event.my_rsvp === status) {
      await supabase.from("rsvps").delete().eq("user_id", user.id).eq("event_id", eventId);
    } else {
      await supabase.from("rsvps").upsert({ user_id: user.id, event_id: eventId, status }, { onConflict: "user_id,event_id" });
    }
    loadEvent();
  };

  const handleComment = async (e) => {
    e.preventDefault();
    if (!commentText.trim() || !user) return;
    await supabase.from("comments").insert({
      event_id: eventId, user_id: user.id, text: commentText,
      image_url: commentImageUrl || null,
    });
    setCommentText("");
    setCommentImageUrl("");
    loadEvent();
  };

  const handleCommentImage = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setCommentUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/comments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const url = await uploadImage(file, path);
      setCommentImageUrl(url);
    } catch (err) {
      console.error("Comment image upload error:", err);
    }
    setCommentUploading(false);
    if (commentFileRef.current) commentFileRef.current.value = "";
  };

  const handleDeleteComment = async (commentId) => {
    await supabase.from("comments").delete().eq("id", commentId);
    loadEvent();
  };

  const handleDelete = async () => {
    if (!confirm(t("detail.deleteConfirm"))) return;
    await supabase.from("events").delete().eq("id", eventId);
    onNavigate("discover");
  };

  const handleAccessRequest = async (e) => {
    e.preventDefault();
    setAccessSubmitting(true);
    setAccessError("");
    const { error: err } = await supabase.from("access_requests").insert({
      event_id: eventId, user_id: user.id, message: accessMessage,
    });
    if (err) setAccessError(err.message);
    setAccessSubmitting(false);
    loadEvent();
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/event/${eventId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: event.title, url });
      } catch {}
    } else {
      navigator.clipboard.writeText(url).then(
        () => alert(t("detail.linkCopied")),
        () => prompt(t("detail.copyLink"), url)
      );
    }
  };

  if (loading) return <div className="loading">{t("loading")}</div>;
  if (!event) return <div className="loading">{t("detail.notFound")}</div>;

  // RESTRICTED VIEW
  if (event.has_access === false) {
    return (
      <div className="container">
        <div className="restricted-event">
          <button className="back-button" onClick={() => onNavigate("discover")}>{t("detail.back")}</button>
          <div className="restricted-icon">🔒</div>
          <h1>{event.title}</h1>
          <span className="visibility-badge semi-public">{t("restricted.badge")}</span>
          <p className="restricted-message">{t("restricted.message")}</p>

          {!user ? (
            <div style={{ marginTop: 24 }}>
              <p style={{ color: "#666", marginBottom: 12 }}>{t("restricted.loginHint")}</p>
              <button className="btn btn-primary" onClick={() => onNavigate("login")}>{t("nav.login")}</button>
            </div>
          ) : event.access_request_status === "pending" ? (
            <div className="access-request-status pending">{t("restricted.pending")}</div>
          ) : event.access_request_status === "denied" ? (
            <div className="access-request-status denied">{t("restricted.denied")}</div>
          ) : (
            <form className="access-request-form" onSubmit={handleAccessRequest}>
              <h3>{t("restricted.requestTitle")}</h3>
              <textarea placeholder={t("restricted.requestPlaceholder")} value={accessMessage} onChange={(e) => setAccessMessage(e.target.value)} />
              {accessError && <div className="form-error">{accessError}</div>}
              <button className="btn btn-primary" type="submit" disabled={accessSubmitting}>
                {accessSubmitting ? t("restricted.requesting") : t("restricted.requestSubmit")}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // FULL VIEW
  const isCreator = user && user.id === event.creator_id;
  const isAdmin = event.is_admin || isCreator;

  const handleKick = async (userId) => {
    if (!confirm(t("kick.confirm"))) return;
    await supabase.rpc("kick_user_from_event", { p_event_id: eventId, p_user_id: userId });
    loadEvent();
  };

  return (
    <div className="container">
      <div className="event-detail">
        <button className="back-button" onClick={() => onNavigate("discover")}>{t("detail.back")}</button>

        {event.my_kicked && (
          <div className="kicked-notice">{t("kick.notice")}</div>
        )}

        {event.images && event.images.length > 0 ? (
          <ImageGallery images={event.images} />
        ) : event.image_url ? (
          <img className="event-detail-image" src={event.image_url} alt={event.title} />
        ) : null}

        <div className="event-detail-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="event-detail-category">{t(`cat.${event.category}`)}</span>
            {event.visibility === "semi_public" && <span className="visibility-badge semi-public">{t("restricted.badge")}</span>}
            {event.event_mode === "online" && <span className="event-mode-badge online">{t("events.online")}</span>}
            {event.event_mode === "hybrid" && <span className="event-mode-badge hybrid">{t("events.hybrid")}</span>}
          </div>
          <h1 className="event-detail-title">{event.title}</h1>
          <div className="event-detail-meta">
            <span>
              {event.end_date && event.end_date !== event.date
                ? <span className="event-date-range">{formatShortDate(event.date, lang)} – {formatShortDate(event.end_date, lang)}</span>
                : formatDate(event.date, lang)
              }
            </span>
            <span>
              {event.time?.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ""}
              {!event.end_date && event.end_time && event.time && event.end_time < event.time && (
                <span className="event-mode-badge next-day">{t("events.endsNextDay")}</span>
              )}
            </span>
            {event.event_mode !== "online" && (
              event.location_hidden ? (
                <span style={{ color: "#d97706" }}>📍 {event.area_name} — <em>{t("discover.addressHidden")}</em></span>
              ) : event.location ? (
                <span>{event.location}</span>
              ) : null
            )}
            {event.event_mode !== "physical" && event.online_url && (
              <span>
                <a href={event.online_url} target="_blank" rel="noopener noreferrer" className="online-link" onClick={(e) => e.stopPropagation()}>
                  {t("events.online")} ↗
                </a>
              </span>
            )}
          </div>
        </div>

        <div className="event-detail-creator">
          {t("detail.organizedBy")} <strong>{event.creator_name}</strong>
        </div>

        {venueData && (
          <div className="venue-link-card" onClick={() => onNavigate("venue-detail", { venueId: venueData.id })}>
            {venueData.image_url ? (
              <img src={venueData.image_url} alt={venueData.name} />
            ) : (
              <div style={{ width: 48, height: 48, borderRadius: 8, background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center" }}>🏢</div>
            )}
            <div className="venue-link-card-info">
              <h4>{venueData.name}</h4>
              <p>{venueData.address}</p>
            </div>
          </div>
        )}

        <div className="event-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleShare}>{t("detail.share")}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => generateIcsFile(event)}>{t("cal.ics")}</button>
        </div>

        {!event.my_kicked && (
        <div className="rsvp-section">
          <h3>{t("detail.attend")}</h3>
          <div className="rsvp-buttons">
            <button className={`rsvp-btn going ${event.my_rsvp === "going" ? "active" : ""}`} onClick={() => handleRSVP("going")}>
              {t("detail.going")}
            </button>
            <button className={`rsvp-btn interested ${event.my_rsvp === "interested" ? "active" : ""}`} onClick={() => handleRSVP("interested")}>
              {t("detail.interested")}
            </button>
            {event.my_rsvp && <button className="rsvp-btn cancel" onClick={() => handleRSVP(event.my_rsvp)}>{t("detail.cancel")}</button>}
          </div>
          <div className="rsvp-stats">
            <span><strong>{event.going_count}</strong> {t("detail.goingCount")}</span>
            <span><strong>{event.interested_count}</strong> {t("detail.interestedCount")}</span>
            {(event.waitlisted_count || 0) > 0 && (
              <span><strong>{event.waitlisted_count}</strong> {t("detail.waitlistedCount")}</span>
            )}
            {event.qr_enabled && (event.checked_in_count || 0) > 0 && (
              <span><strong>{event.checked_in_count}</strong> {t("qr.checkedInCount")}</span>
            )}
          </div>
          {event.max_attendees && (
            <div className="capacity-bar-wrapper">
              <div className="capacity-bar">
                <div
                  className="capacity-bar-fill"
                  style={{
                    width: `${Math.min((event.going_count / event.max_attendees) * 100, 100)}%`,
                    background: event.going_count >= event.max_attendees ? "#ef4444" : event.going_count >= event.max_attendees * 0.8 ? "#f59e0b" : "#22c55e",
                  }}
                />
              </div>
              <div className="capacity-text">
                <span>{event.going_count} / {event.max_attendees} {t("detail.spots")}</span>
                {event.going_count >= event.max_attendees && <span className="capacity-full">{t("detail.full")}</span>}
              </div>
            </div>
          )}
          {event.my_rsvp === "waitlisted" && (
            <div className="waitlist-notice">
              <strong>{t("detail.waitlisted")}</strong>
              {event.waitlisted_users && event.waitlisted_users.length > 0 && (
                <span>{t("detail.waitlistPosition")} {event.waitlisted_users.findIndex((u) => u.id === user?.id) + 1}</span>
              )}
            </div>
          )}
        </div>
        )}

        <p className="event-detail-description">{event.description}</p>

        <QrTicketSection event={event} />

        {(event.going_users?.length > 0 || event.interested_users?.length > 0) && (
          <details className="detail-attendees-collapsible">
            <summary className="detail-section-toggle">
              {t("detail.showAttendees")} ({(event.going_users?.length || 0) + (event.interested_users?.length || 0)})
            </summary>
            <div className="attendees-section">
              {event.going_users?.length > 0 && (
                <>
                  <h3>{t("detail.goingTitle")} ({event.going_users.length})</h3>
                  <div className="attendees-list">
                    {event.going_users.map((u) => (
                      isAdmin && u.id !== user.id ? (
                        <span key={u.id} className="attendee-chip-with-action clickable" onClick={() => onNavigate("user-profile", { userId: u.id })}>
                          <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                          {u.name}
                          {u.checked_in_at && event.qr_enabled && <span style={{ color: "#16a34a", fontSize: 11 }}>&#10003;</span>}
                          <button className="attendee-kick-btn" onClick={(e) => { e.stopPropagation(); handleKick(u.id); }}>{t("kick.button")}</button>
                        </span>
                      ) : (
                        <span key={u.id} className="attendee-chip clickable" onClick={() => onNavigate("user-profile", { userId: u.id })}>
                          <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                          {u.name}
                          {u.checked_in_at && event.qr_enabled && <span style={{ color: "#16a34a", fontSize: 11 }}>&#10003;</span>}
                        </span>
                      )
                    ))}
                  </div>
                </>
              )}
              {event.interested_users?.length > 0 && (
                <>
                  <h3 style={{ marginTop: 16 }}>{t("detail.interestedTitle")} ({event.interested_users.length})</h3>
                  <div className="attendees-list">
                    {event.interested_users.map((u) => (
                      isAdmin && u.id !== user.id ? (
                        <span key={u.id} className="attendee-chip-with-action clickable" onClick={() => onNavigate("user-profile", { userId: u.id })}>
                          <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                          {u.name}
                          <button className="attendee-kick-btn" onClick={(e) => { e.stopPropagation(); handleKick(u.id); }}>{t("kick.button")}</button>
                        </span>
                      ) : (
                        <span key={u.id} className="attendee-chip clickable" onClick={() => onNavigate("user-profile", { userId: u.id })}>
                          <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                          {u.name}
                        </span>
                      )
                    ))}
                  </div>
                </>
              )}
              {event.waitlisted_users?.length > 0 && (
                <>
                  <h3 style={{ marginTop: 16 }}>{t("detail.waitlistTitle")} ({event.waitlisted_users.length})</h3>
                  <div className="attendees-list">
                    {event.waitlisted_users.map((u) => (
                      <span key={u.id} className="attendee-chip waitlisted clickable" onClick={() => onNavigate("user-profile", { userId: u.id })}>
                        <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                        {u.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </details>
        )}

        {isAdmin && (
          <details className="detail-admin-section">
            <summary className="detail-section-toggle">{t("detail.adminTools")}</summary>
            <div className="detail-admin-content">
              <div className="event-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("edit-event", { eventId: event.id })}>{t("detail.edit")}</button>
                {isCreator && (
                  <button className="btn btn-danger btn-sm" onClick={handleDelete}>{t("detail.delete")}</button>
                )}
                {event.qr_enabled && (
                  <button className="btn btn-primary btn-sm" onClick={() => onNavigate("checkin", { eventId: event.id })}>{t("qr.openScanner")}</button>
                )}
              </div>
              <QrToggleSection eventId={eventId} qrEnabled={event.qr_enabled} onToggle={loadEvent} />
              {event.visibility === "semi_public" && (
                <>
                  <InvitationManager eventId={eventId} />
                  <AccessRequestManager eventId={eventId} />
                </>
              )}
              {isCreator && <AdminManager eventId={eventId} />}
            </div>
          </details>
        )}

        <div className="comments-section">
          <h3>{t("detail.comments")} ({event.comments?.length || 0})</h3>
          {user && (
            <div>
              <form className="comment-form" onSubmit={handleComment}>
                <input type="text" placeholder={t("detail.writeComment")} value={commentText} onChange={(e) => setCommentText(e.target.value)} />
                <button type="button" className="comment-image-upload" onClick={() => commentFileRef.current?.click()} disabled={commentUploading}>
                  {commentUploading ? t("form.uploading") : t("comment.addImage")}
                </button>
                <button type="submit">{t("detail.send")}</button>
              </form>
              <input ref={commentFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleCommentImage} />
              {commentImageUrl && (
                <div className="comment-image-preview">
                  <img src={commentImageUrl} alt="" />
                  <button className="remove-btn" onClick={() => setCommentImageUrl("")}>×</button>
                </div>
              )}
            </div>
          )}
          {event.comments?.length > 0 ? (
            event.comments.map((c) => (
              <div key={c.id} className="comment">
                <div className="comment-header">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar name={c.user_name} avatarUrl={c.user_avatar_url} size={24} />
                    <span className="comment-author">{c.user_name}</span>
                    <span className="comment-time"> · {timeAgo(c.created_at, lang)}</span>
                  </div>
                  {user && user.id === c.user_id && (
                    <button className="comment-delete" onClick={() => handleDeleteComment(c.id)}>{t("detail.deleteComment")}</button>
                  )}
                </div>
                <div className="comment-text">{c.text}</div>
                {c.image_url && (
                  <img className="comment-image" src={c.image_url} alt="" onClick={() => setLightboxUrl(c.image_url)} />
                )}
              </div>
            ))
          ) : (
            <div className="no-comments">{t("detail.noComments")}</div>
          )}
        </div>

        {lightboxUrl && (
          <div className="lightbox" onClick={() => setLightboxUrl(null)}>
            <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>×</button>
            <img src={lightboxUrl} alt="" onClick={(e) => e.stopPropagation()} />
          </div>
        )}
      </div>
    </div>
  );
}
