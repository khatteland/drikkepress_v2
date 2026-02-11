import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { translations, CATEGORIES } from "../translations";
import { formatDate, formatShortDate } from "../utils/helpers";
import { Avatar } from "../components/shared";

export function DiscoverPage({ user, onNavigate }) {
  const { t, lang } = useI18n();
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [radius, setRadius] = useState(25);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState("");
  const [category, setCategory] = useState("");
  const [userLocation, setUserLocation] = useState(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [swipeDir, setSwipeDir] = useState(null);
  const [followingSet, setFollowingSet] = useState(new Set());

  // Pointer state refs (no re-render needed)
  const dragRef = useRef({ startX: 0, startY: 0, currentX: 0, isDragging: false });
  const cardRef = useRef(null);
  const indicatorRightRef = useRef(null);
  const indicatorLeftRef = useRef(null);

  // Fetch user's following list for friend display
  useEffect(() => {
    if (!user) { setFollowingSet(new Set()); return; }
    supabase.from("follows").select("following_id").eq("follower_id", user.id).eq("status", "active")
      .then(({ data }) => { setFollowingSet(new Set((data || []).map((f) => f.following_id))); });
  }, [user]);

  // Request geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) { setLocationDenied(true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { setLocationDenied(true); }
    );
  }, []);

  // Fetch cards when location/filters change — fallback without geo
  useEffect(() => {
    setLoading(true);
    if (userLocation) {
      // RPC returns friend_count + friend_preview from server
      supabase.rpc("get_discover_events", {
        p_lat: userLocation.lat,
        p_lng: userLocation.lng,
        p_radius_km: radius,
        p_date_from: dateFrom,
        p_date_to: dateTo || null,
        p_category: category || null,
        p_limit: 20,
      }).then(({ data }) => {
        setCards(data || []);
        setCurrentIndex(0);
        setLoading(false);
      });
    } else if (locationDenied) {
      // Fallback: fetch events without location, compute friends client-side
      const today = new Date().toISOString().split("T")[0];
      let q = supabase.from("events").select("id, title, date, end_date, time, end_time, location, category, image_url, event_mode, online_url, rsvps(status, user_id)").eq("visibility", "public").gte("effective_end_date", today).order("date").limit(20);
      if (category) q = q.eq("category", category);
      q.then(async ({ data }) => {
        const evts = data || [];
        // Collect friend user IDs
        const friendUserIds = new Set();
        evts.forEach((e) => {
          (e.rsvps || []).forEach((r) => { if (followingSet.has(r.user_id)) friendUserIds.add(r.user_id); });
        });
        let friendProfiles = {};
        if (friendUserIds.size > 0) {
          const { data: profiles } = await supabase.from("profiles").select("id, name, avatar_url").in("id", [...friendUserIds]);
          (profiles || []).forEach((p) => { friendProfiles[p.id] = p; });
        }
        setCards(evts.map((e) => {
          const rsvps = e.rsvps || [];
          const friendRsvps = rsvps.filter((r) => followingSet.has(r.user_id) && (r.status === "going" || r.status === "interested"));
          return {
            ...e,
            going_count: rsvps.filter((r) => r.status === "going").length,
            attendee_preview: [],
            friend_count: friendRsvps.length,
            friend_preview: friendRsvps.slice(0, 3).map((r) => friendProfiles[r.user_id]).filter(Boolean),
          };
        }));
        setCurrentIndex(0);
        setLoading(false);
      });
    }
  }, [userLocation, locationDenied, radius, dateFrom, dateTo, category, followingSet]);

  const currentCard = cards[currentIndex];
  const behindCard1 = cards[currentIndex + 1];
  const behindCard2 = cards[currentIndex + 2];

  const handleSwipe = async (direction) => {
    if (!currentCard) return;
    if (!user) { onNavigate("login"); return; }
    setSwipeDir(direction);
    await supabase.rpc("handle_swipe", { p_event_id: currentCard.id, p_direction: direction });
    setTimeout(() => {
      setSwipeDir(null);
      setCurrentIndex((prev) => prev + 1);
    }, 350);
  };

  // Pointer handlers for swipe gesture
  const onPointerDown = (e) => {
    if (swipeDir) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, currentX: 0, isDragging: true };
    if (cardRef.current) cardRef.current.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!dragRef.current.isDragging || swipeDir) return;
    const dx = e.clientX - dragRef.current.startX;
    dragRef.current.currentX = dx;
    if (cardRef.current) {
      const rotate = dx * 0.05;
      cardRef.current.style.transform = `translate(${dx}px, 0) rotate(${rotate}deg)`;
    }
    // Swipe indicators
    const opacity = Math.min(Math.abs(dx) / 100, 1);
    if (indicatorRightRef.current) indicatorRightRef.current.style.opacity = dx > 30 ? opacity : 0;
    if (indicatorLeftRef.current) indicatorLeftRef.current.style.opacity = dx < -30 ? opacity : 0;
  };

  const onPointerUp = () => {
    if (!dragRef.current.isDragging) return;
    dragRef.current.isDragging = false;
    const dx = dragRef.current.currentX;

    // Reset indicators
    if (indicatorRightRef.current) indicatorRightRef.current.style.opacity = 0;
    if (indicatorLeftRef.current) indicatorLeftRef.current.style.opacity = 0;

    if (Math.abs(dx) > 100) {
      handleSwipe(dx > 0 ? "right" : "left");
    } else {
      // Spring back
      if (cardRef.current) {
        cardRef.current.style.transition = "transform 0.3s ease";
        cardRef.current.style.transform = "";
        setTimeout(() => { if (cardRef.current) cardRef.current.style.transition = ""; }, 300);
      }
    }
  };

  const renderCardFooter = (card) => {
    const fc = card.friend_count || 0;
    const oc = Math.max(0, (card.going_count || 0) - fc);
    const fp = card.friend_preview || [];
    if (fc > 0) {
      return (
        <div className="discover-card-footer">
          <div className="discover-card-attendees">
            {fp.length > 0 && (
              <div className="avatar-stack">
                {fp.slice(0, 3).map((a, i) => (
                  <Avatar key={i} name={a.name} avatarUrl={a.avatar_url} size={24} />
                ))}
              </div>
            )}
            <div className="discover-card-stats">
              <strong>{fc}</strong> {t("events.friendsGoing")}
              {oc > 0 && <> + <strong>{oc}</strong> {t("events.others")}</>}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="discover-card-footer">
        <div className="discover-card-attendees">
          {card.attendee_preview && card.attendee_preview.length > 0 && (
            <div className="avatar-stack">
              {card.attendee_preview.slice(0, 5).map((a, i) => (
                <Avatar key={i} name={a.name} avatarUrl={a.avatar_url} size={24} />
              ))}
            </div>
          )}
          <div className="discover-card-stats">
            <strong>{card.going_count || 0}</strong> {t("discover.going")}
          </div>
        </div>
      </div>
    );
  };

  const renderCard = (card, className, ref) => {
    const cardIsMultiDay = card.end_date && card.end_date !== card.date;
    const cardIsOverMidnight = !card.end_date && card.end_time && card.time && card.end_time < card.time;
    return (
      <div className={`discover-card ${className}`} ref={ref} key={card.id}>
        {card.image_url ? (
          <img className="discover-card-image" src={card.image_url} alt="" draggable="false" />
        ) : (
          <div className="discover-card-image-placeholder">
            {t(`cat.${card.category}`)?.[0] || "?"}
          </div>
        )}
        <div className="discover-card-body">
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span className="event-card-category">{t(`cat.${card.category}`)}</span>
            {card.event_mode === "online" && <span className="event-mode-badge online">{t("events.online")}</span>}
            {card.event_mode === "hybrid" && <span className="event-mode-badge hybrid">{t("events.hybrid")}</span>}
            {card.join_mode === "approval_required" && (
              <span className="discover-approval-badge">{t("discover.approvalRequired")}</span>
            )}
            {card.distance_km != null && (
              <span className="discover-card-distance">{card.distance_km} {t("discover.km")}</span>
            )}
          </div>
          <div className="discover-card-title">{card.title}</div>
          <div className="discover-card-meta">
            <span>
              {cardIsMultiDay
                ? <span className="event-date-range">{formatShortDate(card.date, lang)} – {formatShortDate(card.end_date, lang)}</span>
                : formatDate(card.date, lang)
              }
            </span>
            <span>
              {card.time?.slice(0, 5)}
              {card.end_time ? ` – ${card.end_time.slice(0, 5)}` : ""}
              {cardIsOverMidnight && <span className="event-mode-badge next-day">{t("events.endsNextDay")}</span>}
              {card.area_name ? ` · ${card.area_name}` : card.event_mode === "online" ? ` · ${t("events.online")}` : ""}
            </span>
          </div>
          {renderCardFooter(card)}
        </div>
      </div>
    );
  };

  return (
    <div className="discover-page">
      {locationDenied && (
        <div className="discover-location-banner" onClick={() => {
          navigator.geolocation?.getCurrentPosition(
            (pos) => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationDenied(false); },
            () => {}
          );
        }}>
          📍 {t("discover.locationBanner")}
        </div>
      )}

      {/* Filter toggle */}
      <div className="discover-filter-toggle">
        <button onClick={() => setFiltersOpen(!filtersOpen)}>
          ⚙ {t("discover.filters")} ({radius} km)
        </button>
      </div>

      {/* Filter panel */}
      {filtersOpen && (
        <div className="discover-filter-panel">
          <div className="discover-filter-group">
            <label>{t("discover.radius")}: <span className="discover-radius-value">{radius} km</span></label>
            <input type="range" className="discover-radius-slider" min="1" max="100" value={radius} onChange={(e) => setRadius(parseInt(e.target.value))} />
          </div>
          <div className="discover-filter-row">
            <div className="discover-filter-group">
              <label>{t("discover.dateFrom")}</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="filter-select" />
            </div>
            <div className="discover-filter-group">
              <label>{t("discover.dateTo")}</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="filter-select" />
            </div>
          </div>
          <div className="discover-filter-group">
            <label>{t("form.category")}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="filter-select">
              <option value="">{t("events.allCategories")}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">{t("events.loading")}</div>
      ) : !currentCard ? (
        <div className="discover-empty">
          <div className="discover-empty-icon">🔍</div>
          <h3>{t("discover.noMore")}</h3>
          <p>{t("discover.noMoreHint")}</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => onNavigate("search")}>{t("discover.browseAll")}</button>
        </div>
      ) : (
        <>
          <div className="discover-card-stack">
            {behindCard2 && renderCard(behindCard2, "behind-2", null)}
            {behindCard1 && renderCard(behindCard1, "behind-1", null)}
            <div
              className={`discover-card top ${swipeDir === "right" ? "swiping-right" : swipeDir === "left" ? "swiping-left" : ""}`}
              ref={cardRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              key={currentCard.id}
            >
              <div className="swipe-indicator right" ref={indicatorRightRef}>{t("discover.interested")}</div>
              <div className="swipe-indicator left" ref={indicatorLeftRef}>{t("discover.pass")}</div>
              {currentCard.image_url ? (
                <img className="discover-card-image" src={currentCard.image_url} alt="" draggable="false" />
              ) : (
                <div className="discover-card-image-placeholder">
                  {t(`cat.${currentCard.category}`)?.[0] || "?"}
                </div>
              )}
              <div className="discover-card-body">
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="event-card-category">{t(`cat.${currentCard.category}`)}</span>
                  {currentCard.event_mode === "online" && <span className="event-mode-badge online">{t("events.online")}</span>}
                  {currentCard.event_mode === "hybrid" && <span className="event-mode-badge hybrid">{t("events.hybrid")}</span>}
                  {currentCard.join_mode === "approval_required" && (
                    <span className="discover-approval-badge">{t("discover.approvalRequired")}</span>
                  )}
                  {currentCard.distance_km != null && (
                    <span className="discover-card-distance">{currentCard.distance_km} {t("discover.km")}</span>
                  )}
                </div>
                <div className="discover-card-title">{currentCard.title}</div>
                <div className="discover-card-meta">
                  <span>
                    {currentCard.end_date && currentCard.end_date !== currentCard.date
                      ? <span className="event-date-range">{formatShortDate(currentCard.date, lang)} – {formatShortDate(currentCard.end_date, lang)}</span>
                      : formatDate(currentCard.date, lang)
                    }
                  </span>
                  <span>
                    {currentCard.time?.slice(0, 5)}
                    {currentCard.end_time ? ` – ${currentCard.end_time.slice(0, 5)}` : ""}
                    {!currentCard.end_date && currentCard.end_time && currentCard.time && currentCard.end_time < currentCard.time && (
                      <span className="event-mode-badge next-day">{t("events.endsNextDay")}</span>
                    )}
                    {currentCard.area_name ? ` · ${currentCard.area_name}` : currentCard.event_mode === "online" ? ` · ${t("events.online")}` : ""}
                  </span>
                </div>
                {renderCardFooter(currentCard)}
              </div>
            </div>
          </div>

          <div className="discover-actions">
            <button className="discover-btn pass" onClick={() => handleSwipe("left")} title={t("discover.pass")}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <button className="discover-btn details" onClick={() => onNavigate("event-detail", { eventId: currentCard.id })} title="Details">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
            </button>
            <button className="discover-btn interested" onClick={() => handleSwipe("right")} title={t("discover.interested")}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
