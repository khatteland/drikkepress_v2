import React, { useState } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { uploadImage, geocodeAddress } from "../utils/helpers";
import { AddressAutocomplete } from "../components/shared";

export function VenueRegisterPage({ user, onNavigate }) {
  const { t, lang } = useI18n();
  const [form, setForm] = useState({
    name: "", description: "", address: "", opening_hours: "",
    contact_email: "", contact_phone: "",
  });
  const [geo, setGeo] = useState(null);
  const [imageFile, setImageFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!user) { onNavigate("login"); return null; }

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.address) { setError(t("form.required")); return; }
    setSubmitting(true);
    setError("");

    let image_url = null;
    if (imageFile) {
      try {
        image_url = await uploadImage(imageFile, `venues/${user.id}/${Date.now()}-${imageFile.name}`);
      } catch (err) { setError(err.message); setSubmitting(false); return; }
    }

    const resolvedGeo = geo || await geocodeAddress(form.address, lang);

    const { data, error: err } = await supabase.from("venues").insert({
      name: form.name, description: form.description, address: form.address,
      opening_hours: form.opening_hours, contact_email: form.contact_email,
      contact_phone: form.contact_phone, image_url,
      latitude: resolvedGeo ? resolvedGeo.lat : null, longitude: resolvedGeo ? resolvedGeo.lng : null,
      owner_id: user.id,
    }).select().single();

    if (err) { setError(err.message); setSubmitting(false); return; }

    await supabase.from("venue_staff").insert({ venue_id: data.id, user_id: user.id, role: "owner" });

    setSubmitting(false);
    onNavigate("venue-manage", { venueId: data.id });
  };

  return (
    <div className="venue-register-page">
      <button className="back-button" onClick={() => onNavigate("venues")}>{t("detail.back")}</button>
      <h1>{t("venue.register")}</h1>
      {error && <div className="form-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>{t("venue.name")} *</label>
          <input type="text" value={form.name} onChange={update("name")} />
        </div>
        <div className="form-group">
          <label>{t("venue.description")}</label>
          <textarea value={form.description} onChange={update("description")} />
        </div>
        <div className="form-group">
          <label>{t("venue.address")} *</label>
          <AddressAutocomplete
            value={form.address}
            onChange={(val) => { setForm({ ...form, address: val }); setGeo(null); }}
            onSelect={(g) => { setGeo(g); }}
            placeholder={t("address.placeholder")}
            lang={lang}
          />
        </div>
        <div className="form-group">
          <label>{t("venue.openingHours")}</label>
          <input type="text" value={form.opening_hours} onChange={update("opening_hours")} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>{t("venue.contactEmail")}</label>
            <input type="email" value={form.contact_email} onChange={update("contact_email")} />
          </div>
          <div className="form-group">
            <label>{t("venue.contactPhone")}</label>
            <input type="tel" value={form.contact_phone} onChange={update("contact_phone")} />
          </div>
        </div>
        <div className="form-group">
          <label>{t("venue.image")}</label>
          <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files[0])} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? t("loading") : t("venue.create")}
        </button>
      </form>
    </div>
  );
}
