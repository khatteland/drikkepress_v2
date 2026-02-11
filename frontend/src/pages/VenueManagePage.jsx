import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { formatDate, generateSlots } from "../utils/helpers";

export function VenueManagePage({ venueId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCreateTab, setActiveCreateTab] = useState("queue");
  const [tsForm, setTsForm] = useState({
    date: "", from_time: "", to_time: "",
    slot_duration: "15", price: "", capacity: "10", description: "",
  });
  const [ticketForm, setTicketForm] = useState({
    date: "", start_time: "", end_time: "", price: "", capacity: "100", description: "",
  });
  const [tableForm, setTableForm] = useState({
    date: "", start_time: "", end_time: "", price: "", capacity: "1", label: "", description: "",
  });
  const [tsSubmitting, setTsSubmitting] = useState(false);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffRole, setStaffRole] = useState("bouncer");
  const [staffError, setStaffError] = useState("");
  const [minAge, setMinAge] = useState("");

  const loadDashboard = useCallback(() => {
    supabase.rpc("get_venue_dashboard", { p_venue_id: venueId }).then(({ data }) => {
      setDashboard(data);
      if (data && data.venue) {
        setMinAge(data.venue.min_age != null ? String(data.venue.min_age) : "");
      }
      setLoading(false);
    });
  }, [venueId]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  if (loading) return <div className="loading">{t("loading")}</div>;
  if (!dashboard || dashboard.status === "error") {
    return <div className="container"><p>{t("scanner.notStaff")}</p></div>;
  }

  const formatPrice = (ore) => ore === 0 ? "Gratis" : `${(ore / 100).toFixed(0)} kr`;

  const previewSlots = generateSlots(tsForm.from_time, tsForm.to_time, parseInt(tsForm.slot_duration) || 15);

  const handleCreateQueueSlots = async (e) => {
    e.preventDefault();
    if (!tsForm.date || !tsForm.from_time || !tsForm.to_time || previewSlots.length === 0) return;
    setTsSubmitting(true);
    const priceOre = Math.round((parseFloat(tsForm.price) || 0) * 100);
    const rows = previewSlots.map((slot) => ({
      venue_id: venueId,
      date: tsForm.date,
      start_time: slot.start,
      end_time: slot.end,
      price: priceOre,
      capacity: parseInt(tsForm.capacity) || 10,
      description: tsForm.description,
      type: "queue",
    }));
    await supabase.from("timeslots").insert(rows);
    setTsForm({ date: "", from_time: "", to_time: "", slot_duration: "15", price: "", capacity: "10", description: "" });
    setTsSubmitting(false);
    loadDashboard();
  };

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (!ticketForm.date || !ticketForm.start_time || !ticketForm.end_time) return;
    setTsSubmitting(true);
    const priceOre = Math.round((parseFloat(ticketForm.price) || 0) * 100);
    await supabase.from("timeslots").insert({
      venue_id: venueId,
      date: ticketForm.date,
      start_time: ticketForm.start_time,
      end_time: ticketForm.end_time,
      price: priceOre,
      capacity: parseInt(ticketForm.capacity) || 100,
      description: ticketForm.description,
      type: "ticket",
    });
    setTicketForm({ date: "", start_time: "", end_time: "", price: "", capacity: "100", description: "" });
    setTsSubmitting(false);
    loadDashboard();
  };

  const handleCreateTable = async (e) => {
    e.preventDefault();
    if (!tableForm.date || !tableForm.start_time || !tableForm.end_time || !tableForm.label) return;
    setTsSubmitting(true);
    const priceOre = Math.round((parseFloat(tableForm.price) || 0) * 100);
    await supabase.from("timeslots").insert({
      venue_id: venueId,
      date: tableForm.date,
      start_time: tableForm.start_time,
      end_time: tableForm.end_time,
      price: priceOre,
      capacity: parseInt(tableForm.capacity) || 1,
      description: tableForm.description,
      type: "table",
      label: tableForm.label,
    });
    setTableForm({ date: "", start_time: "", end_time: "", price: "", capacity: "1", label: "", description: "" });
    setTsSubmitting(false);
    loadDashboard();
  };

  const handleDeactivateTimeslot = async (tsId) => {
    await supabase.from("timeslots").update({ active: false }).eq("id", tsId);
    loadDashboard();
  };

  const handleAddStaff = async () => {
    setStaffError("");
    if (!staffEmail) return;
    const { data: profiles } = await supabase.from("profiles").select("id").eq("email", staffEmail).limit(1);
    if (!profiles || profiles.length === 0) { setStaffError(t("admin.notFound")); return; }
    const { error } = await supabase.from("venue_staff").insert({ venue_id: venueId, user_id: profiles[0].id, role: staffRole });
    if (error) { setStaffError(error.message); return; }
    setStaffEmail("");
    loadDashboard();
  };

  const handleRemoveStaff = async (staffId) => {
    await supabase.from("venue_staff").delete().eq("id", staffId);
    loadDashboard();
  };

  return (
    <div className="venue-dashboard">
      <button className="back-button" onClick={() => onNavigate("venue-detail", { venueId })}>{t("detail.back")}</button>
      <h1>{dashboard.venue.name} — {t("venue.dashboard")}</h1>

      <div className="venue-stats-row">
        <div className="venue-stat">
          <div className="venue-stat-value">{formatPrice(dashboard.stats.total_revenue)}</div>
          <div className="venue-stat-label">Total revenue</div>
        </div>
        <div className="venue-stat">
          <div className="venue-stat-value">{dashboard.stats.bookings_today}</div>
          <div className="venue-stat-label">Bookings today</div>
        </div>
        <div className="venue-stat">
          <div className="venue-stat-value">{dashboard.stats.sold_out_count}</div>
          <div className="venue-stat-label">Sold out</div>
        </div>
      </div>

      <div className="venue-dashboard-section">
        <h2>{t("timeslot.create")}</h2>

        <div className="create-type-tabs">
          <button className={`create-type-tab ${activeCreateTab === "queue" ? "active" : ""}`} onClick={() => setActiveCreateTab("queue")}>
            ⏰ {t("type.queue")}
          </button>
          <button className={`create-type-tab ${activeCreateTab === "ticket" ? "active" : ""}`} onClick={() => setActiveCreateTab("ticket")}>
            🎫 {t("type.ticket")}
          </button>
          <button className={`create-type-tab ${activeCreateTab === "table" ? "active" : ""}`} onClick={() => setActiveCreateTab("table")}>
            🪑 {t("type.table")}
          </button>
        </div>

        {activeCreateTab === "queue" && (
          <form className="timeslot-form" onSubmit={handleCreateQueueSlots}>
            <div className="form-row">
              <div className="form-group">
                <label>{t("timeslot.date")} *</label>
                <input type="date" value={tsForm.date} onChange={(e) => setTsForm({ ...tsForm, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("timeslot.capacity")}</label>
                <input type="number" value={tsForm.capacity} onChange={(e) => setTsForm({ ...tsForm, capacity: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("timeslot.fromTime")} *</label>
                <input type="time" value={tsForm.from_time} onChange={(e) => setTsForm({ ...tsForm, from_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("timeslot.toTime")} *</label>
                <input type="time" value={tsForm.to_time} onChange={(e) => setTsForm({ ...tsForm, to_time: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("timeslot.slotDuration")}</label>
                <select value={tsForm.slot_duration} onChange={(e) => setTsForm({ ...tsForm, slot_duration: e.target.value })}>
                  <option value="15">15 {t("timeslot.minutes")}</option>
                  <option value="30">30 {t("timeslot.minutes")}</option>
                  <option value="45">45 {t("timeslot.minutes")}</option>
                  <option value="60">60 {t("timeslot.minutes")}</option>
                </select>
              </div>
              <div className="form-group">
                <label>{t("timeslot.priceKr")}</label>
                <input type="number" value={tsForm.price} onChange={(e) => setTsForm({ ...tsForm, price: e.target.value })} placeholder="0" step="1" min="0" />
              </div>
            </div>
            <div className="form-group">
              <label>{t("timeslot.description")}</label>
              <input type="text" value={tsForm.description} onChange={(e) => setTsForm({ ...tsForm, description: e.target.value })} />
            </div>

            <div className="form-group">
              <label>{t("timeslot.preview")}</label>
              {previewSlots.length > 0 ? (
                <>
                  <div className="slot-preview">
                    {previewSlots.map((slot, i) => (
                      <div key={i} className="slot-preview-item">{slot.start}–{slot.end}</div>
                    ))}
                  </div>
                  <div className="slot-preview-count">
                    {t("timeslot.generateCount").replace("{n}", previewSlots.length)}
                  </div>
                </>
              ) : (
                <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>{t("timeslot.noSlots")}</p>
              )}
            </div>

            <button className="btn btn-primary" type="submit" disabled={tsSubmitting || previewSlots.length === 0}>
              {tsSubmitting ? t("loading") : t("timeslot.generateCount").replace("{n}", previewSlots.length)}
            </button>
          </form>
        )}

        {activeCreateTab === "ticket" && (
          <form className="timeslot-form" onSubmit={handleCreateTicket}>
            <div className="form-row">
              <div className="form-group">
                <label>{t("timeslot.date")} *</label>
                <input type="date" value={ticketForm.date} onChange={(e) => setTicketForm({ ...ticketForm, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("timeslot.capacity")}</label>
                <input type="number" value={ticketForm.capacity} onChange={(e) => setTicketForm({ ...ticketForm, capacity: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("ticket.doorOpen")} *</label>
                <input type="time" value={ticketForm.start_time} onChange={(e) => setTicketForm({ ...ticketForm, start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("ticket.doorClose")} *</label>
                <input type="time" value={ticketForm.end_time} onChange={(e) => setTicketForm({ ...ticketForm, end_time: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>{t("timeslot.priceKr")}</label>
              <input type="number" value={ticketForm.price} onChange={(e) => setTicketForm({ ...ticketForm, price: e.target.value })} placeholder="0" step="1" min="0" />
            </div>
            <div className="form-group">
              <label>{t("timeslot.description")}</label>
              <input type="text" value={ticketForm.description} onChange={(e) => setTicketForm({ ...ticketForm, description: e.target.value })} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={tsSubmitting || !ticketForm.date || !ticketForm.start_time || !ticketForm.end_time}>
              {tsSubmitting ? t("loading") : t("ticket.create")}
            </button>
          </form>
        )}

        {activeCreateTab === "table" && (
          <form className="timeslot-form" onSubmit={handleCreateTable}>
            <div className="form-group">
              <label>{t("table.label")} *</label>
              <input type="text" value={tableForm.label} onChange={(e) => setTableForm({ ...tableForm, label: e.target.value })} placeholder={t("table.labelPlaceholder")} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("timeslot.date")} *</label>
                <input type="date" value={tableForm.date} onChange={(e) => setTableForm({ ...tableForm, date: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("timeslot.capacity")}</label>
                <input type="number" value={tableForm.capacity} onChange={(e) => setTableForm({ ...tableForm, capacity: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("timeslot.fromTime")} *</label>
                <input type="time" value={tableForm.start_time} onChange={(e) => setTableForm({ ...tableForm, start_time: e.target.value })} />
              </div>
              <div className="form-group">
                <label>{t("timeslot.toTime")} *</label>
                <input type="time" value={tableForm.end_time} onChange={(e) => setTableForm({ ...tableForm, end_time: e.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label>{t("timeslot.priceKr")}</label>
              <input type="number" value={tableForm.price} onChange={(e) => setTableForm({ ...tableForm, price: e.target.value })} placeholder="0" step="1" min="0" />
            </div>
            <div className="form-group">
              <label>{t("timeslot.description")}</label>
              <input type="text" value={tableForm.description} onChange={(e) => setTableForm({ ...tableForm, description: e.target.value })} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={tsSubmitting || !tableForm.date || !tableForm.start_time || !tableForm.end_time || !tableForm.label}>
              {tsSubmitting ? t("loading") : t("table.create")}
            </button>
          </form>
        )}
      </div>

      <div className="venue-dashboard-section">
        <h2>Timeslots</h2>
        {dashboard.timeslots && dashboard.timeslots.length > 0 ? (
          dashboard.timeslots.map((ts) => (
            <div key={ts.id} className="timeslot-dashboard-item">
              <div className="timeslot-dashboard-header">
                <h3>
                  <span className={`type-badge type-${ts.type || "queue"}`}>{t(`type.${ts.type || "queue"}`)}</span>
                  {" "}{ts.label ? `${ts.label} — ` : ""}{formatDate(ts.date, lang)} {ts.start_time?.slice(0, 5)}–{ts.end_time?.slice(0, 5)}
                </h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span>{formatPrice(ts.price)}</span>
                  <span>{ts.bookings?.length || 0}/{ts.capacity}</span>
                  {ts.active ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => handleDeactivateTimeslot(ts.id)}>
                      {t("timeslot.deactivate")}
                    </button>
                  ) : (
                    <span style={{ color: "var(--text-secondary)" }}>Inactive</span>
                  )}
                </div>
              </div>
              {ts.description && <p style={{ color: "var(--text-secondary)", marginBottom: 8 }}>{ts.description}</p>}
              {ts.bookings && ts.bookings.length > 0 && (
                <table className="bookings-table">
                  <thead>
                    <tr><th>{t("scanner.guestName")}</th><th>{t("scanner.status")}</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {ts.bookings.map((b) => (
                      <tr key={b.id}>
                        <td>{b.user_name}</td>
                        <td>
                          <span className={`ticket-card-status ${b.status}`}>
                            {b.status === "checked_in" ? t("booking.checkedIn") : b.status}
                          </span>
                        </td>
                        <td>{b.checked_in_at ? new Date(b.checked_in_at).toLocaleTimeString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
        ) : (
          <p style={{ color: "var(--text-secondary)" }}>{t("venue.noTimeslots")}</p>
        )}
      </div>

      <div className="venue-dashboard-section">
        <h2>{t("form.minAge")}</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={minAge}
            onChange={async (e) => {
              const val = e.target.value;
              setMinAge(val);
              await supabase.from("venues").update({ min_age: val ? parseInt(val) : null }).eq("id", venueId);
            }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}
          >
            <option value="">{t("form.noAgeLimit")}</option>
            <option value="18">18+</option>
            <option value="20">20+</option>
            <option value="23">23+</option>
          </select>
          {minAge && <span className="age-badge">{minAge}+</span>}
        </div>
      </div>

      <div className="venue-dashboard-section">
        <h2>{t("venue.staff")}</h2>
        <div className="staff-list">
          {dashboard.staff && dashboard.staff.map((s) => (
            <div key={s.id} className="staff-item">
              {s.avatar_url ? (
                <img src={s.avatar_url} alt={s.name} />
              ) : (
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-secondary)", display: "flex", alignItems: "center", justifyContent: "center" }}>👤</div>
              )}
              <div className="staff-item-info">
                <strong>{s.name}</strong>
                <span>{s.email}</span>
              </div>
              <span className={`staff-role-badge ${s.role}`}>{t(`venue.role.${s.role}`)}</span>
              {s.role !== "owner" && (
                <button className="btn btn-secondary btn-sm" onClick={() => handleRemoveStaff(s.id)}>
                  {t("venue.removeStaff")}
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label>{t("venue.addStaff")}</label>
            <input type="email" value={staffEmail} onChange={(e) => setStaffEmail(e.target.value)} placeholder="email@example.com" />
          </div>
          <select value={staffRole} onChange={(e) => setStaffRole(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)" }}>
            <option value="bouncer">{t("venue.role.bouncer")}</option>
            <option value="manager">{t("venue.role.manager")}</option>
          </select>
          <button className="btn btn-primary" onClick={handleAddStaff}>{t("admin.submit")}</button>
        </div>
        {staffError && <div className="form-error" style={{ marginTop: 8 }}>{staffError}</div>}
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={() => onNavigate("venue-scan", { venueId })}>
          {t("scanner.title")}
        </button>
      </div>
    </div>
  );
}
