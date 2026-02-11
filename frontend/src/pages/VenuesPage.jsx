import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { VenueCard } from "../components/EventCard";

export function VenuesPage({ user, onNavigate }) {
  const { t } = useI18n();
  const [venues, setVenues] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("venues").select("*").order("created_at", { ascending: false }).then(({ data }) => {
      setVenues(data || []);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">{t("loading")}</div>;

  return (
    <div className="venues-page">
      <div className="venues-page-header">
        <h1>{t("venue.title")}</h1>
        {user && (
          <button className="btn btn-primary" onClick={() => onNavigate("venue-register")}>
            {t("venue.register")}
          </button>
        )}
      </div>
      {venues.length === 0 ? (
        <div className="empty-state">
          <p>{t("venue.noVenues")}</p>
        </div>
      ) : (
        <div className="venue-grid">
          {venues.map((v) => (
            <VenueCard key={v.id} venue={v} onClick={() => onNavigate("venue-detail", { venueId: v.id })} />
          ))}
        </div>
      )}
    </div>
  );
}
