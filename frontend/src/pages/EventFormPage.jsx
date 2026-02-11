import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { CATEGORIES } from "../translations";
import { geocodeAddress } from "../utils/helpers";
import { MultiImageUpload } from "../components/shared";

export function EventFormPage({ eventId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const isEdit = !!eventId;
  const [form, setForm] = useState({
    title: "", description: "", date: "", time: "", end_time: "",
    location: "", category: "Technology", visibility: "public",
    join_mode: "open", max_attendees: "", venue_id: "",
    event_mode: "physical", end_date: "", online_url: "", min_age: "",
  });
  const [images, setImages] = useState([]);
  const [error, setError] = useState("");
  const [geocodeError, setGeocodeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [myVenues, setMyVenues] = useState([]);

  useEffect(() => {
    if (user) {
      supabase.from("venue_staff").select("venue_id, venues(id, name)").eq("user_id", user.id).in("role", ["owner", "manager"]).then(({ data }) => {
        setMyVenues((data || []).map((d) => d.venues).filter(Boolean));
      });
    }
  }, [user]);

  useEffect(() => {
    if (isEdit) {
      supabase.rpc("get_event_detail", { p_event_id: eventId }).then(({ data }) => {
        if (data && data.has_access) {
          setForm({
            title: data.title, description: data.description || "", date: data.date,
            time: data.time?.slice(0, 5) || "", end_time: data.end_time?.slice(0, 5) || "",
            location: data.location || "", category: data.category,
            visibility: data.visibility || "public",
            join_mode: data.join_mode || "open",
            max_attendees: data.max_attendees != null ? String(data.max_attendees) : "",
            event_mode: data.event_mode || "physical",
            end_date: data.end_date || "",
            online_url: data.online_url || "",
            min_age: data.min_age != null ? String(data.min_age) : "",
          });
          if (data.images && data.images.length > 0) {
            setImages(data.images.map((img) => img.image_url));
          } else if (data.image_url) {
            setImages([data.image_url]);
          }
        }
        setLoading(false);
      });
    }
  }, [isEdit, eventId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setGeocodeError("");
    const needsLocation = form.event_mode !== "online";
    const needsOnlineUrl = form.event_mode !== "physical";
    if (!form.title || !form.date || !form.time || !form.description) {
      setError(t("form.required"));
      return;
    }
    if (needsLocation && !form.location) {
      setError(t("form.required"));
      return;
    }
    if (needsOnlineUrl && !form.online_url) {
      setError(t("form.required"));
      return;
    }

    setSubmitting(true);

    // Geocode the address (only if location provided)
    let geo = null;
    if (form.location) {
      geo = await geocodeAddress(form.location, lang);
      if (!geo) {
        setGeocodeError(t("form.geocodeError"));
      }
    }

    const payload = {
      title: form.title, description: form.description, date: form.date,
      time: form.time, end_time: form.end_time || null,
      location: form.location || null,
      image_url: images.length > 0 ? images[0] : null, category: form.category,
      visibility: form.visibility,
      join_mode: form.join_mode,
      latitude: geo ? geo.lat : null,
      longitude: geo ? geo.lng : null,
      max_attendees: parseInt(form.max_attendees) || null,
      venue_id: form.venue_id ? parseInt(form.venue_id) : null,
      event_mode: form.event_mode,
      end_date: form.end_date || null,
      online_url: form.online_url || null,
      min_age: parseInt(form.min_age) || null,
    };

    let targetEventId = eventId;

    if (isEdit) {
      const { error: err } = await supabase.from("events").update(payload).eq("id", eventId);
      if (err) { setError(err.message); setSubmitting(false); return; }
    } else {
      payload.creator_id = user.id;
      const { data, error: err } = await supabase.from("events").insert(payload).select().single();
      if (err) { setError(err.message); setSubmitting(false); return; }
      targetEventId = data.id;
    }

    // Sync event_images: delete old, insert new
    await supabase.from("event_images").delete().eq("event_id", targetEventId);
    if (images.length > 0) {
      const imageRows = images.map((url, i) => ({
        event_id: targetEventId, image_url: url, position: i,
      }));
      await supabase.from("event_images").insert(imageRows);
    }

    setSubmitting(false);
    onNavigate("event-detail", { eventId: targetEventId });
  };

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  if (loading) return <div className="loading">{t("form.loading")}</div>;

  return (
    <div className="container">
      <div className="form-page">
        <div className="form-card">
          <h2>{isEdit ? t("form.editTitle") : t("form.createTitle")}</h2>
          {error && <div className="form-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t("form.title")} *</label>
              <input type="text" value={form.title} onChange={update("title")} placeholder={t("form.titlePlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("form.description")} *</label>
              <textarea value={form.description} onChange={update("description")} placeholder={t("form.descPlaceholder")} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("form.date")} *</label>
                <input type="date" value={form.date} onChange={update("date")} />
              </div>
              <div className="form-group">
                <label>{t("form.category")}</label>
                <select value={form.category} onChange={update("category")}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{t("form.startTime")} *</label>
                <input type="time" value={form.time} onChange={update("time")} />
              </div>
              <div className="form-group">
                <label>{t("form.endTime")}</label>
                <input type="time" value={form.end_time} onChange={update("end_time")} />
              </div>
            </div>
            <div className="form-group">
              <label>{t("form.endDate")}</label>
              <input type="date" value={form.end_date} onChange={update("end_date")} min={form.date || undefined} />
              <small style={{ color: "#888", fontSize: 12, marginTop: 4, display: "block" }}>{t("form.endDateHint")}</small>
            </div>
            <div className="form-group">
              <label>{t("form.eventMode")}</label>
              <select value={form.event_mode} onChange={update("event_mode")}>
                <option value="physical">{t("form.modePhysical")}</option>
                <option value="online">{t("form.modeOnline")}</option>
                <option value="hybrid">{t("form.modeHybrid")}</option>
              </select>
            </div>
            {form.event_mode !== "online" && (
              <div className="form-group">
                <label>{t("form.address")} *</label>
                <input type="text" value={form.location} onChange={update("location")} placeholder={t("form.addressPlaceholder")} />
                <small style={{ color: "#888", fontSize: 12, marginTop: 4, display: "block" }}>{t("form.addressHint")}</small>
                {geocodeError && <small style={{ color: "#ef4444", fontSize: 12, marginTop: 4, display: "block" }}>{geocodeError}</small>}
              </div>
            )}
            {form.event_mode !== "physical" && (
              <div className="form-group">
                <label>{t("form.onlineUrl")} *</label>
                <input type="url" value={form.online_url} onChange={update("online_url")} placeholder={t("form.onlineUrlPlaceholder")} />
              </div>
            )}
            <div className="form-group">
              <label>{t("form.images")}</label>
              <MultiImageUpload images={images} onImagesChange={setImages} userId={user.id} />
            </div>
            <div className="form-group">
              <label>{t("form.visibility")}</label>
              <select value={form.visibility} onChange={update("visibility")}>
                <option value="public">{t("form.public")}</option>
                <option value="semi_public">{t("form.semiPublic")}</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("form.minAge")}</label>
              <select value={form.min_age} onChange={update("min_age")}>
                <option value="">{t("form.noAgeLimit")}</option>
                <option value="18">18+</option>
                <option value="20">20+</option>
                <option value="23">23+</option>
              </select>
            </div>
            <div className="form-group">
              <label>{t("form.joinMode")}</label>
              <select value={form.join_mode} onChange={update("join_mode")}>
                <option value="open">{t("form.joinOpen")}</option>
                <option value="approval_required">{t("form.joinApproval")}</option>
              </select>
              <small style={{ color: "#888", fontSize: 12, marginTop: 4, display: "block" }}>{t("form.joinModeHint")}</small>
            </div>
            <div className="form-group">
              <label>{t("form.maxAttendees")}</label>
              <input type="number" min="1" value={form.max_attendees} onChange={update("max_attendees")} placeholder={t("form.maxAttendeesPlaceholder")} />
              <small style={{ color: "#888", fontSize: 12, marginTop: 4, display: "block" }}>{t("form.maxAttendeesHint")}</small>
            </div>
            {myVenues.length > 0 && (
              <div className="form-group">
                <label>{t("nav.venues")}</label>
                <select value={form.venue_id} onChange={update("venue_id")}>
                  <option value="">—</option>
                  {myVenues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}
            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? t("form.geocoding") : isEdit ? t("form.save") : t("form.create")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
