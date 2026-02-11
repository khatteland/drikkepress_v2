import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { formatDate } from "../utils/helpers";
import { QRCodeSVG } from "qrcode.react";

export function MyTicketsPage({ user, onNavigate }) {
  const { t, lang } = useI18n();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("upcoming");
  const [expandedQr, setExpandedQr] = useState(null);

  useEffect(() => {
    if (!user) return;
    supabase.rpc("get_my_bookings").then(({ data }) => {
      setBookings(data || []);
      setLoading(false);
    });
  }, [user]);

  if (!user) { onNavigate("login"); return null; }
  if (loading) return <div className="loading">{t("loading")}</div>;

  const formatPrice = (ore) => ore === 0 ? "Gratis" : `${(ore / 100).toFixed(0)} kr`;
  const today = new Date().toISOString().slice(0, 10);

  const upcoming = bookings.filter((b) => b.status === "confirmed" && b.timeslot.date >= today);
  const past = bookings.filter((b) => b.status !== "confirmed" || b.timeslot.date < today);

  const handleCancel = async (bookingId) => {
    await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
    const { data } = await supabase.rpc("get_my_bookings");
    setBookings(data || []);
  };

  const visibleBookings = activeTab === "upcoming" ? upcoming : past;

  return (
    <div className="my-tickets-page">
      <h1>{t("tickets.title")}</h1>

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab-btn ${activeTab === "upcoming" ? "active" : ""}`} onClick={() => setActiveTab("upcoming")}>
          {t("tickets.upcoming")} ({upcoming.length})
        </button>
        <button className={`tab-btn ${activeTab === "past" ? "active" : ""}`} onClick={() => setActiveTab("past")}>
          {t("tickets.past")} ({past.length})
        </button>
      </div>

      {visibleBookings.length === 0 ? (
        <div className="empty-state">
          <p>{t("tickets.empty")}</p>
          <p style={{ color: "var(--text-secondary)" }}>{t("tickets.emptyHint")}</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => onNavigate("venues")}>
            {t("nav.venues")}
          </button>
        </div>
      ) : (
        visibleBookings.map((b) => (
          <div key={b.booking_id} className="ticket-card">
            <div className="ticket-card-header">
              <span className="ticket-card-venue" onClick={() => onNavigate("venue-detail", { venueId: b.venue.id })}>
                {b.venue.name}
              </span>
              <span className={`ticket-card-status ${b.status}`}>
                {b.status === "confirmed" ? t("booking.notCheckedIn") : b.status === "checked_in" ? t("booking.checkedIn") : t("booking.cancelled")}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              {b.timeslot.type && <span className={`type-badge type-${b.timeslot.type}`}>{t(`type.${b.timeslot.type}`)}</span>}
              {b.timeslot.type === "table" && b.timeslot.label && <span className="timeslot-card-label" style={{ marginBottom: 0 }}>{b.timeslot.label}</span>}
            </div>
            <div className="ticket-card-meta">
              {formatDate(b.timeslot.date, lang)} &middot; {b.timeslot.start_time?.slice(0, 5)}–{b.timeslot.end_time?.slice(0, 5)}
            </div>
            <div className="ticket-card-price">{formatPrice(b.timeslot.price)}</div>

            {b.status === "confirmed" && (
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setExpandedQr(expandedQr === b.booking_id ? null : b.booking_id)}>
                  {expandedQr === b.booking_id ? t("booking.hideQr") : t("booking.showQr")}
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleCancel(b.booking_id)}>
                  {t("booking.cancel")}
                </button>
              </div>
            )}

            {expandedQr === b.booking_id && (
              <div className="booking-ticket-qr" style={{ marginTop: 12 }}>
                <QRCodeSVG value={`${window.location.origin}/venue/${b.venue.id}/scan?token=${b.qr_token}`} size={180} />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
