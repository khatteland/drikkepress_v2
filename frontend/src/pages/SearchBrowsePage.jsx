import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { formatShortDate } from "../utils/helpers";
import { CATEGORIES } from "../translations";
import { EventCard, VenueCard } from "../components/EventCard";

export default function SearchBrowsePage({ user, onNavigate, initialView }) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(initialView || "list");
  const [tab, setTab] = useState("events");
  const [hasMore, setHasMore] = useState(false);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  // Fetch events via server-side RPC (pagination + server-side friend computation)
  useEffect(() => {
    if (tab !== "events") return;
    setLoading(true);
    supabase.rpc("search_events", {
      p_search: search || null,
      p_category: category || null,
      p_limit: 30,
      p_offset: 0,
    }).then(({ data }) => {
      setEvents(data || []);
      setHasMore((data || []).length === 30);
      setLoading(false);
    });
  }, [search, category, tab]);

  const loadMore = () => {
    supabase.rpc("search_events", {
      p_search: search || null,
      p_category: category || null,
      p_limit: 30,
      p_offset: events.length,
    }).then(({ data }) => {
      const newEvents = data || [];
      setEvents((prev) => [...prev, ...newEvents]);
      setHasMore(newEvents.length === 30);
    });
  };

  // Fetch venues
  useEffect(() => {
    if (tab !== "venues") return;
    setLoading(true);
    let query = supabase.from("venues").select("*").order("created_at", { ascending: false });
    if (search) {
      query = query.or(`name.ilike.%${search}%,address.ilike.%${search}%`);
    }
    query.then(({ data }) => {
      setVenues(data || []);
      setLoading(false);
    });
  }, [search, tab]);

  // Map rendering
  useEffect(() => {
    if (view !== "map" || loading || !mapRef.current) return;
    if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    const L = window.L;
    if (!L) return;

    const map = L.map(mapRef.current).setView([20, 0], 2);
    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const markers = [];

    if (tab === "events") {
      const mapEvents = events.filter((e) => e.latitude && e.longitude);
      mapEvents.forEach((ev) => {
        const popupHtml = `
          <div class="map-popup">
            ${ev.image_url ? `<img class="map-popup-image" src="${ev.image_url}" alt="" />` : ""}
            <div class="map-popup-body">
              <strong>${ev.title}</strong>
              <div style="font-size:12px;color:#666;margin-top:4px;">
                ${formatShortDate(ev.date, lang)} ${ev.time?.slice(0, 5) || ""}
              </div>
              <div style="font-size:12px;color:#666;">${ev.location}</div>
              <div style="font-size:12px;margin-top:4px;">
                <strong>${ev.going_count}</strong> ${t("map.attending")}
              </div>
              <div style="margin-top:8px;">
                <a href="/event/${ev.id}" class="map-popup-link" data-id="${ev.id}" data-type="event">${t("map.details")} →</a>
              </div>
            </div>
          </div>
        `;
        const marker = L.marker([ev.latitude, ev.longitude]).addTo(map);
        marker.bindPopup(popupHtml, { maxWidth: 250, minWidth: 200 });
        markers.push([ev.latitude, ev.longitude]);
      });
    } else {
      const mapVenues = venues.filter((v) => v.latitude && v.longitude);
      mapVenues.forEach((v) => {
        const popupHtml = `
          <div class="map-popup">
            ${v.image_url ? `<img class="map-popup-image" src="${v.image_url}" alt="" />` : ""}
            <div class="map-popup-body">
              <strong>${v.name}</strong>
              <div style="font-size:12px;color:#666;margin-top:4px;">${v.address || ""}</div>
              <div style="margin-top:8px;">
                <a href="/venue/${v.id}" class="map-popup-link" data-id="${v.id}" data-type="venue">${t("map.details")} →</a>
              </div>
            </div>
          </div>
        `;
        const marker = L.marker([v.latitude, v.longitude]).addTo(map);
        marker.bindPopup(popupHtml, { maxWidth: 250, minWidth: 200 });
        markers.push([v.latitude, v.longitude]);
      });
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 12),
        () => { if (markers.length > 0) map.fitBounds(markers, { padding: [50, 50] }); }
      );
    } else if (markers.length > 0) {
      map.fitBounds(markers, { padding: [50, 50] });
    }

    map.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".map-popup-link");
      if (link) {
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          const id = parseInt(link.getAttribute("data-id"));
          const type = link.getAttribute("data-type");
          onNavigate(type === "venue" ? "venue-detail" : "event-detail", type === "venue" ? { venueId: id } : { eventId: id });
        });
      }
    });

    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  }, [view, loading, events, venues, tab, onNavigate, lang, t]);

  return (
    <div className="container">
      <div className="search-browse-header">
        <div className="search-browse-tabs">
          <button className={`search-tab ${tab === "events" ? "active" : ""}`} onClick={() => setTab("events")}>
            {t("nav.events")}
          </button>
          <button className={`search-tab ${tab === "venues" ? "active" : ""}`} onClick={() => setTab("venues")}>
            {t("nav.venues")}
          </button>
        </div>
        <div className="search-browse-controls">
          <input className="search-input" type="text" placeholder={tab === "events" ? t("events.search") : t("venue.search")}
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {tab === "events" && (
            <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t("events.allCategories")}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
            </select>
          )}
          <div className="view-toggle">
            <button className={`view-toggle-btn ${view === "list" ? "active" : ""}`} onClick={() => setView("list")}>
              {t("search.viewList")}
            </button>
            <button className={`view-toggle-btn ${view === "map" ? "active" : ""}`} onClick={() => setView("map")}>
              {t("search.viewMap")}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading">{t("events.loading")}</div>
      ) : view === "map" ? (
        <div className="map-container" ref={mapRef}></div>
      ) : tab === "events" ? (
        events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🎉</div>
            <h3>{t("events.empty")}</h3>
            <p>{t("events.emptyHint")}</p>
          </div>
        ) : (
          <>
            <div className="events-grid">
              {events.map((e) => (
                <EventCard key={e.id} event={e} onClick={() => onNavigate("event-detail", { eventId: e.id })} />
              ))}
            </div>
            {hasMore && (
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={loadMore}>{t("friends.loadMore")}</button>
              </div>
            )}
          </>
        )
      ) : (
        venues.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏢</div>
            <h3>{t("venue.noVenues")}</h3>
          </div>
        ) : (
          <div className="venue-grid">
            {venues.map((v) => (
              <VenueCard key={v.id} venue={v} onClick={() => onNavigate("venue-detail", { venueId: v.id })} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
