import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { formatDate } from "../utils/helpers";
import { QRCodeSVG } from "qrcode.react";

const SUPABASE_FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

// ============================================================
// PURCHASE MODAL
// ============================================================

function PurchaseModal({ timeslot, venue, user, onClose, onSuccess, onNavigate }) {
  const { t, lang } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const formatPrice = (ore) => ore === 0 ? "Gratis" : `${(ore / 100).toFixed(0)} kr`;
  const isFree = timeslot.price === 0;

  const handlePurchase = async () => {
    setSubmitting(true);
    setError("");

    if (isFree) {
      // Free ticket — use RPC directly
      const { data, error: err } = await supabase.rpc("reserve_timeslot", { p_timeslot_id: timeslot.id });
      setSubmitting(false);
      if (err) { setError(err.message); return; }
      if (data.status === "error") {
        if (data.code === "too_young") { setError(t("booking.tooYoung").replace("{age}", data.min_age)); return; }
        setError(data.code === "already_booked" ? t("booking.alreadyBooked") : data.code === "sold_out" ? t("timeslot.soldOut") : data.code);
        return;
      }
      setResult(data);
    } else {
      // Paid ticket — use Vipps payment edge function
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setError("Not authenticated"); setSubmitting(false); return; }

        const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/vipps-payment?action=create`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ timeslot_id: timeslot.id }),
        });

        const data = await res.json();
        setSubmitting(false);

        if (!res.ok || data.status === "error") {
          if (data.code === "too_young") { setError(t("booking.tooYoung").replace("{age}", data.min_age)); return; }
          setError(data.code === "already_booked" ? t("booking.alreadyBooked") : data.code === "sold_out" ? t("timeslot.soldOut") : data.error || data.code || "Error");
          return;
        }

        if (data.redirect_url) {
          // Redirect to Vipps
          window.location.href = data.redirect_url;
          return;
        }

        // Shouldn't happen for paid, but handle gracefully
        setResult(data);
      } catch (err) {
        setSubmitting(false);
        setError(err.message || "Network error");
      }
    }
  };

  const qrValue = result ? `${window.location.origin}/venue/${venue.id}/scan?token=${result.qr_token}` : "";

  return (
    <div className="purchase-modal-overlay" onClick={onClose}>
      <div className="purchase-modal" onClick={(e) => e.stopPropagation()}>
        <button className="purchase-modal-close" onClick={onClose}>&times;</button>

        {result ? (
          <div className="purchase-modal-success">
            <h3>{t("booking.success")}</h3>
            <p>{t("booking.yourTicket")}</p>
            <div className="booking-ticket">
              <div className="booking-ticket-details">
                <p><strong>{venue.name}</strong></p>
                <p>{formatDate(timeslot.date, lang)}</p>
                <p>{timeslot.start_time?.slice(0, 5)} – {timeslot.end_time?.slice(0, 5)}</p>
                <p>{formatPrice(timeslot.price)}</p>
              </div>
              <div className="booking-ticket-qr">
                <QRCodeSVG value={qrValue} size={180} />
              </div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onSuccess}>OK</button>
          </div>
        ) : (
          <>
            <h2>{t("booking.confirm")}</h2>
            <div className="purchase-modal-summary">
              <p><strong>{venue.name}</strong></p>
              {timeslot.type && <p><span className={`type-badge type-${timeslot.type}`}>{t(`type.${timeslot.type}`)}</span></p>}
              {timeslot.type === "table" && timeslot.label && <p><strong>{timeslot.label}</strong></p>}
              <p>{formatDate(timeslot.date, lang)}</p>
              <p>{timeslot.start_time?.slice(0, 5)} – {timeslot.end_time?.slice(0, 5)}</p>
              {timeslot.description && <p>{timeslot.description}</p>}
              <p className="price-line">{formatPrice(timeslot.price)}</p>
            </div>
            {venue.min_age && (
              <div className="age-notice">
                {t("booking.ageRequired").replace("{age}", venue.min_age)}
              </div>
            )}
            {error && <div className="form-error">{error}</div>}
            <button
              className={isFree ? "btn btn-primary" : "vipps-btn"}
              style={{ width: "100%" }}
              onClick={handlePurchase}
              disabled={submitting}
            >
              {submitting ? t("loading") : isFree
                ? `${t("booking.confirm")} — ${formatPrice(timeslot.price)}`
                : `${t("booking.payWithVipps")} — ${formatPrice(timeslot.price)}`
              }
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// VENUE DETAIL PAGE
// ============================================================

export function VenueDetailPage({ venueId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const [venue, setVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchaseTimeslot, setPurchaseTimeslot] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  const loadVenue = useCallback(() => {
    supabase.rpc("get_venue_detail", { p_venue_id: venueId }).then(({ data }) => {
      setVenue(data);
      if (data) {
        setIsFollowing(data.is_following || false);
        setFollowerCount(data.follower_count || 0);
      }
      // Auto-select first available date
      if (data && data.timeslots && data.timeslots.length > 0) {
        const dates = [...new Set(data.timeslots.map((ts) => ts.date))].sort();
        setSelectedDate((prev) => prev && dates.includes(prev) ? prev : dates[0]);
      }
      setLoading(false);
    });
  }, [venueId]);

  const handleToggleFollow = async () => {
    if (!user) { onNavigate("login"); return; }
    setFollowLoading(true);
    const { data } = await supabase.rpc("toggle_venue_follow", { p_venue_id: venueId });
    if (data && data.status === "ok") {
      if (data.action === "followed") {
        setIsFollowing(true);
        setFollowerCount((c) => c + 1);
      } else {
        setIsFollowing(false);
        setFollowerCount((c) => Math.max(0, c - 1));
      }
    }
    setFollowLoading(false);
  };

  useEffect(() => { loadVenue(); }, [loadVenue]);

  if (loading) return <div className="loading">{t("loading")}</div>;
  if (!venue) return <div className="container"><p>{t("detail.notFound")}</p></div>;

  const formatPrice = (ore) => ore === 0 ? "Gratis" : `${(ore / 100).toFixed(0)} kr`;

  // Get unique dates
  const allDates = venue.timeslots ? [...new Set(venue.timeslots.map((ts) => ts.date))].sort() : [];

  // Filter and group by type for selected date
  const dateTimeslots = venue.timeslots ? venue.timeslots.filter((ts) => ts.date === selectedDate) : [];
  const ticketSlots = dateTimeslots.filter((ts) => ts.type === "ticket");
  const tableSlots = dateTimeslots.filter((ts) => ts.type === "table");
  const queueSlots = dateTimeslots.filter((ts) => ts.type === "queue" || !ts.type);

  const renderTimeslotCard = (ts) => {
    const spotsLeft = ts.capacity - (ts.booked_count || 0);
    const isSoldOut = spotsLeft <= 0;
    const hasBooking = ts.my_booking && ts.my_booking.id;
    return (
      <div key={ts.id} className={`timeslot-card-v2 ${isSoldOut ? "sold-out" : ""} ${hasBooking ? "booked" : ""}`}
        onClick={() => {
          if (hasBooking || isSoldOut) return;
          if (!user) return onNavigate("login");
          setPurchaseTimeslot(ts);
        }}
        style={{ cursor: hasBooking || isSoldOut ? "default" : "pointer" }}
      >
        {ts.type === "table" && ts.label && <div className="timeslot-card-label">{ts.label}</div>}
        <div className="timeslot-card-time">{ts.start_time?.slice(0, 5)} – {ts.end_time?.slice(0, 5)}</div>
        {ts.description && <div className="timeslot-card-desc">{ts.description}</div>}
        <div className="timeslot-card-footer">
          <span className="timeslot-card-price">{formatPrice(ts.price)}</span>
          <span className={`timeslot-card-spots ${isSoldOut ? "sold-out" : ""}`}>
            {hasBooking ? t("booking.alreadyBooked") : isSoldOut ? t("timeslot.soldOut") : `${spotsLeft} ${t("timeslot.spotsLeft")}`}
          </span>
        </div>
      </div>
    );
  };

  const formatDateStrip = (dateStr) => {
    const d = new Date(dateStr + "T00:00:00");
    const locale = lang === "no" ? "nb-NO" : "en-US";
    return {
      weekday: d.toLocaleDateString(locale, { weekday: "short" }).slice(0, 3),
      day: d.getDate(),
      month: d.toLocaleDateString(locale, { month: "short" }),
    };
  };

  return (
    <div className="venue-detail-page">
      <button className="back-button" onClick={() => onNavigate("venues")}>{t("detail.back")}</button>

      <div className="venue-detail-header">
        {venue.image_url ? (
          <img src={venue.image_url} alt={venue.name} />
        ) : (
          <div className="venue-detail-header-placeholder">🏢</div>
        )}
      </div>

      <div className="venue-detail-info">
        <h1>
          {venue.name}
          {venue.verified && <span className="venue-badge verified">{t("venue.verified")}</span>}
          {venue.min_age && <span className="age-badge">{venue.min_age}+</span>}
        </h1>
        <div className="venue-detail-meta">
          <span>📍 {venue.address}</span>
          {venue.opening_hours && <span>🕐 {venue.opening_hours}</span>}
          {venue.contact_email && <span>✉️ {venue.contact_email}</span>}
          {venue.contact_phone && <span>📞 {venue.contact_phone}</span>}
        </div>
        {venue.description && <p>{venue.description}</p>}
      </div>

      <div className="venue-follow-section">
        <button
          className={`btn ${isFollowing ? "btn-secondary" : "btn-primary"}`}
          onClick={handleToggleFollow}
          disabled={followLoading}
        >
          {isFollowing ? t("venue.unfollow") : t("venue.follow")}
        </button>
        <span className="venue-follower-count">
          <strong>{followerCount}</strong> {t("venue.followers")}
        </span>
      </div>

      {venue.is_staff && (
        <div className="venue-detail-actions">
          <button className="btn btn-primary" onClick={() => onNavigate("venue-manage", { venueId: venue.id })}>
            {t("venue.manage")}
          </button>
          <button className="btn btn-secondary" onClick={() => onNavigate("venue-scan", { venueId: venue.id })}>
            {t("scanner.title")}
          </button>
        </div>
      )}

      <h2>{t("venue.availability")}</h2>

      {allDates.length > 0 ? (
        <>
          <div className="date-strip">
            {allDates.map((dateStr) => {
              const d = formatDateStrip(dateStr);
              return (
                <button
                  key={dateStr}
                  className={`date-strip-item ${selectedDate === dateStr ? "selected" : ""}`}
                  onClick={() => setSelectedDate(dateStr)}
                >
                  <span className="date-strip-weekday">{d.weekday}</span>
                  <span className="date-strip-day">{d.day}</span>
                  <span className="date-strip-month">{d.month}</span>
                </button>
              );
            })}
          </div>

          {dateTimeslots.length > 0 ? (
            <>
              {ticketSlots.length > 0 && (
                <div className="venue-product-section">
                  <div className="venue-product-title">
                    <span className="venue-product-icon">🎫</span> {t("type.ticket.plural")}
                  </div>
                  <div className="timeslot-list">{ticketSlots.map(renderTimeslotCard)}</div>
                </div>
              )}
              {tableSlots.length > 0 && (
                <div className="venue-product-section">
                  <div className="venue-product-title">
                    <span className="venue-product-icon">🪑</span> {t("type.table.plural")}
                  </div>
                  <div className="timeslot-list">{tableSlots.map(renderTimeslotCard)}</div>
                </div>
              )}
              {queueSlots.length > 0 && (
                <div className="venue-product-section">
                  <div className="venue-product-title">
                    <span className="venue-product-icon">⏰</span> {t("type.queue.plural")}
                  </div>
                  <div className="timeslot-list">{queueSlots.map(renderTimeslotCard)}</div>
                </div>
              )}
            </>
          ) : (
            <p style={{ color: "var(--text-secondary)" }}>{t("venue.noTimeslotsDate")}</p>
          )}
        </>
      ) : (
        <p style={{ color: "var(--text-secondary)" }}>{t("venue.noTimeslots")}</p>
      )}

      {purchaseTimeslot && (
        <PurchaseModal
          timeslot={purchaseTimeslot}
          venue={venue}
          user={user}
          onClose={() => setPurchaseTimeslot(null)}
          onSuccess={() => { setPurchaseTimeslot(null); loadVenue(); }}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}
