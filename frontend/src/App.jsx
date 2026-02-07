import React, { useState, useEffect, useCallback, useRef, useContext, createContext } from "react";
import { supabase } from "./lib/supabase";
import { translations, CATEGORIES } from "./translations";
import { Html5Qrcode } from "html5-qrcode";
import { QRCodeSVG } from "qrcode.react";

// ============================================================
// I18N CONTEXT
// ============================================================

const I18nContext = createContext();

function useI18n() {
  return useContext(I18nContext);
}

function formatDate(dateStr, lang) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const locale = lang === "no" ? "nb-NO" : "en-US";
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatShortDate(dateStr, lang) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const locale = lang === "no" ? "nb-NO" : "en-US";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

function timeAgo(isoStr, lang) {
  if (!isoStr) return "";
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (lang === "no") {
    if (mins < 1) return "akkurat nå";
    if (mins < 60) return `${mins} min siden`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}t siden`;
    return `${Math.floor(hours / 24)}d siden`;
  }
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ============================================================
// IMAGE UPLOAD HELPER
// ============================================================

async function uploadImage(file, path) {
  const { error } = await supabase.storage.from("media").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

// ============================================================
// GEOCODE ADDRESS HELPER
// ============================================================

async function geocodeAddress(address, lang) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      { headers: { "Accept-Language": lang === "no" ? "nb" : "en" } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display_name: data[0].display_name };
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// CALENDAR HELPERS
// ============================================================

function generateGoogleCalendarUrl(event) {
  const startDate = event.date.replace(/-/g, "");
  const startTime = (event.time || "00:00").replace(/:/g, "").slice(0, 4) + "00";
  let endTime;
  if (event.end_time) {
    endTime = event.end_time.replace(/:/g, "").slice(0, 4) + "00";
  } else {
    const h = parseInt(startTime.slice(0, 2)) + 2;
    endTime = String(h).padStart(2, "0") + startTime.slice(2);
  }
  const dates = `${startDate}T${startTime}/${startDate}T${endTime}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    location: event.location || "",
    details: event.description || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function generateIcsFile(event) {
  const startDate = event.date.replace(/-/g, "");
  const startTime = (event.time || "00:00").replace(/:/g, "").slice(0, 4) + "00";
  let endTime;
  if (event.end_time) {
    endTime = event.end_time.replace(/:/g, "").slice(0, 4) + "00";
  } else {
    const h = parseInt(startTime.slice(0, 2)) + 2;
    endTime = String(h).padStart(2, "0") + startTime.slice(2);
  }
  const uid = `${event.id}-${startDate}@drikkepress`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Drikkepress//Event//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${startDate}T${startTime}`,
    `DTEND:${startDate}T${endTime}`,
    `SUMMARY:${event.title}`,
    `LOCATION:${event.location || ""}`,
    `DESCRIPTION:${(event.description || "").replace(/\n/g, "\\n")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${event.title.replace(/[^a-zA-Z0-9]/g, "_")}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// URL ROUTING (History API)
// ============================================================

function parseUrl(pathname) {
  if (pathname === "/" || pathname === "") return { page: "events", data: {} };
  if (pathname === "/map") return { page: "map", data: {} };
  if (pathname === "/create") return { page: "create-event", data: {} };
  if (pathname === "/login") return { page: "login", data: {} };
  if (pathname === "/register") return { page: "register", data: {} };
  if (pathname === "/profile") return { page: "profile", data: {} };

  const checkinMatch = pathname.match(/^\/event\/(\d+)\/checkin$/);
  if (checkinMatch) return { page: "checkin", data: { eventId: parseInt(checkinMatch[1]) } };

  const eventMatch = pathname.match(/^\/event\/(\d+)$/);
  if (eventMatch) return { page: "event-detail", data: { eventId: parseInt(eventMatch[1]) } };

  const editMatch = pathname.match(/^\/edit\/(\d+)$/);
  if (editMatch) return { page: "edit-event", data: { eventId: parseInt(editMatch[1]) } };

  return { page: "events", data: {} };
}

function pageToUrl(page, data = {}) {
  switch (page) {
    case "events": return "/";
    case "map": return "/map";
    case "create-event": return "/create";
    case "login": return "/login";
    case "register": return "/register";
    case "profile": return "/profile";
    case "event-detail": return `/event/${data.eventId}`;
    case "edit-event": return `/edit/${data.eventId}`;
    case "checkin": return `/event/${data.eventId}/checkin`;
    default: return "/";
  }
}

// ============================================================
// LANGUAGE PICKER
// ============================================================

function LanguagePicker() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-picker">
      <button className={lang === "no" ? "active" : ""} onClick={() => setLang("no")}>NO</button>
      <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}

// ============================================================
// MULTI IMAGE UPLOAD
// ============================================================

function MultiImageUpload({ images, onImagesChange, userId }) {
  const { t } = useI18n();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const newUrls = [];
      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `${userId}/events/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const url = await uploadImage(file, path);
        newUrls.push(url);
      }
      onImagesChange([...images, ...newUrls]);
    } catch (err) {
      console.error("Upload error:", err);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleRemove = (index) => {
    onImagesChange(images.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="multi-image-grid">
        {images.map((url, i) => (
          <div key={i} className="multi-image-item">
            <img src={url} alt="" />
            <button type="button" className="remove-btn" onClick={() => handleRemove(i)}>×</button>
          </div>
        ))}
        <button type="button" className="add-image-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <span>{t("form.uploading")}</span> : <><span>+</span>{t("form.addImage")}</>}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
    </div>
  );
}

// ============================================================
// IMAGE GALLERY
// ============================================================

function ImageGallery({ images }) {
  const [lightboxUrl, setLightboxUrl] = useState(null);

  if (!images || images.length === 0) return null;

  return (
    <div className="image-gallery">
      <img
        className="image-gallery-cover"
        src={images[0].image_url}
        alt=""
        onClick={() => setLightboxUrl(images[0].image_url)}
      />
      {images.length > 1 && (
        <div className="image-gallery-grid">
          {images.slice(1).map((img) => (
            <img
              key={img.id}
              className="image-gallery-thumb"
              src={img.image_url}
              alt=""
              onClick={() => setLightboxUrl(img.image_url)}
            />
          ))}
        </div>
      )}
      {lightboxUrl && (
        <div className="lightbox" onClick={() => setLightboxUrl(null)}>
          <button className="lightbox-close" onClick={() => setLightboxUrl(null)}>×</button>
          <img src={lightboxUrl} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// AVATAR (reusable)
// ============================================================

function Avatar({ name, avatarUrl, size = 24, className = "avatar" }) {
  if (avatarUrl) {
    return <img className="avatar-img" src={avatarUrl} alt={name} style={{ width: size, height: size }} />;
  }
  return (
    <span className={className} style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {name?.[0] || "?"}
    </span>
  );
}

// ============================================================
// NOTIFICATION BELL
// ============================================================

function NotificationBell({ user, onNavigate }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const bellRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("*, actor:profiles!actor_id(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setNotifications(data || []);
    setUnreadCount((data || []).filter((n) => !n.is_read).length);
  }, [user]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { loadNotifications(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, loadNotifications]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleClick = async (notif) => {
    if (!notif.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
    }
    setOpen(false);
    onNavigate("event-detail", { eventId: notif.event_id });
    loadNotifications();
  };

  const markAllRead = async () => {
    await supabase.rpc("mark_all_notifications_read");
    loadNotifications();
  };

  const getNotifText = (notif) => {
    const actor = notif.actor?.name || "";
    switch (notif.type) {
      case "rsvp": return <><strong>{actor}</strong> {t("notif.rsvp")}</>;
      case "comment": return <><strong>{actor}</strong> {t("notif.comment")}</>;
      case "access_request": return <><strong>{actor}</strong> {t("notif.access_request")}</>;
      case "invitation": return <><strong>{actor}</strong> {t("notif.invitation")}</>;
      case "reminder": return t("notif.reminder");
      case "waitlist_promoted": return t("notif.waitlist_promoted");
      case "kicked": return <><strong>{actor}</strong> {t("notif.kicked")}</>;
      default: return notif.type;
    }
  };

  return (
    <div className="notification-bell" ref={bellRef}>
      <button className="notification-bell-btn" onClick={() => setOpen(!open)}>
        &#128276;
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>
      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <h3>{t("notif.title")}</h3>
            {unreadCount > 0 && <button onClick={markAllRead}>{t("notif.markAllRead")}</button>}
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">{t("notif.empty")}</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`notification-item ${n.is_read ? "" : "unread"}`} onClick={() => handleClick(n)}>
                  <div className="notification-item-dot" />
                  <div className="notification-item-content">
                    <p>{getNotifText(n)}</p>
                    <div className="notification-item-time">{timeAgo(n.created_at, lang)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// NOTIFICATION PREFERENCES
// ============================================================

function NotificationPreferences({ user }) {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setPrefs(data);
      });
  }, [user]);

  const togglePref = async (key) => {
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    await supabase
      .from("notification_preferences")
      .update({ [key]: updated[key] })
      .eq("user_id", user.id);
  };

  if (!prefs) return null;

  const items = [
    { key: "email_rsvp", label: t("prefs.emailRsvp") },
    { key: "email_comment", label: t("prefs.emailComment") },
    { key: "email_access_request", label: t("prefs.emailAccessRequest") },
    { key: "email_invitation", label: t("prefs.emailInvitation") },
    { key: "email_reminder", label: t("prefs.emailReminder") },
  ];

  return (
    <div className="notification-prefs">
      <h3>{t("prefs.title")}</h3>
      <p>{t("prefs.subtitle")}</p>
      {items.map((item) => (
        <div key={item.key} className="pref-item">
          <span>{item.label}</span>
          <label className="toggle-switch">
            <input type="checkbox" checked={prefs[item.key]} onChange={() => togglePref(item.key)} />
            <span className="toggle-slider" />
          </label>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// NAVBAR
// ============================================================

function Navbar({ user, currentPage, onNavigate, onLogout }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const nav = (page, data) => { setMenuOpen(false); onNavigate(page, data); };

  return (
    <nav className="navbar" ref={menuRef}>
      <div className="navbar-brand" onClick={() => nav("events")}>
        {t("nav.brand")}
      </div>

      {/* Desktop links */}
      <div className="navbar-links navbar-desktop">
        <button className={currentPage === "events" ? "active" : ""} onClick={() => nav("events")}>
          {t("nav.events")}
        </button>
        <button className={currentPage === "map" ? "active" : ""} onClick={() => nav("map")}>
          {t("nav.map")}
        </button>
        {user ? (
          <div className="navbar-user">
            <button className="btn-primary" onClick={() => nav("create-event")}>
              {t("nav.newEvent")}
            </button>
            <NotificationBell user={user} onNavigate={(p, d) => nav(p, d)} />
            <button className={currentPage === "profile" ? "active" : ""} onClick={() => nav("profile")}>
              {t("nav.profile")}
            </button>
            {user.avatar_url ? (
              <img className="navbar-avatar" src={user.avatar_url} alt={user.name} onClick={() => nav("profile")} />
            ) : (
              <span className="navbar-user-name">{user.name}</span>
            )}
            <button onClick={() => { setMenuOpen(false); onLogout(); }}>{t("nav.logout")}</button>
          </div>
        ) : (
          <>
            <button onClick={() => nav("login")}>{t("nav.login")}</button>
            <button className="btn-primary" onClick={() => nav("register")}>{t("nav.register")}</button>
          </>
        )}
        <LanguagePicker />
      </div>

      {/* Mobile: notification + hamburger */}
      <div className="navbar-mobile-actions">
        {user && <NotificationBell user={user} onNavigate={(p, d) => nav(p, d)} />}
        <button className="navbar-hamburger" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? "\u2715" : "\u2630"}
        </button>
      </div>

      {/* Mobile dropdown menu */}
      {menuOpen && (
        <div className="navbar-mobile-menu">
          <button className={currentPage === "events" ? "active" : ""} onClick={() => nav("events")}>
            {t("nav.events")}
          </button>
          <button className={currentPage === "map" ? "active" : ""} onClick={() => nav("map")}>
            {t("nav.map")}
          </button>
          {user ? (
            <>
              <button className="btn-primary" onClick={() => nav("create-event")}>
                {t("nav.newEvent")}
              </button>
              <button className={currentPage === "profile" ? "active" : ""} onClick={() => nav("profile")}>
                {t("nav.profile")}
              </button>
              <button onClick={() => { setMenuOpen(false); onLogout(); }}>{t("nav.logout")}</button>
            </>
          ) : (
            <>
              <button onClick={() => nav("login")}>{t("nav.login")}</button>
              <button className="btn-primary" onClick={() => nav("register")}>{t("nav.register")}</button>
            </>
          )}
          <LanguagePicker />
        </div>
      )}
    </nav>
  );
}

// ============================================================
// EVENT CARD
// ============================================================

function EventCard({ event, onClick }) {
  const { t, lang } = useI18n();
  return (
    <div className="event-card" onClick={onClick}>
      {event.image_url && <img className="event-card-image" src={event.image_url} alt={event.title} />}
      <div className="event-card-body">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="event-card-category">{t(`cat.${event.category}`)}</span>
          {event.visibility === "semi_public" && (
            <span className="visibility-badge semi-public">{t("restricted.badge")}</span>
          )}
        </div>
        <div className="event-card-title">{event.title}</div>
        <div className="event-card-meta">
          <span>{formatDate(event.date, lang)}</span>
          <span>{event.time?.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ""} · {event.location}</span>
        </div>
        <div className="event-card-footer">
          <div className="event-card-attendees">
            <strong>{event.going_count || 0}</strong> {t("events.attending")}
            {event.max_attendees && (
              <span className="event-card-capacity"> / {event.max_attendees} {t("detail.spots")}</span>
            )}
            {event.max_attendees && (event.going_count || 0) >= event.max_attendees && (
              <span className="event-card-full-badge">{t("events.full")}</span>
            )}
            {(event.interested_count || 0) > 0 && (
              <> · <strong>{event.interested_count}</strong> {t("events.interested")}</>
            )}
          </div>
          <div className="event-card-creator">{t("events.by")} {event.creator_name}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EVENTS LIST PAGE
// ============================================================

function EventsPage({ onNavigate }) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [timeFilter, setTimeFilter] = useState("upcoming");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    let query = supabase
      .from("events")
      .select("*, creator:profiles!creator_id(name), rsvps(status)")
      .eq("visibility", "public");

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`);
    }
    if (category) {
      query = query.eq("category", category);
    }
    if (timeFilter === "upcoming") {
      query = query.gte("date", today).order("date", { ascending: true });
    } else if (timeFilter === "past") {
      query = query.lt("date", today).order("date", { ascending: false });
    } else {
      query = query.order("date", { ascending: true });
    }

    query.then(({ data, error }) => {
      if (error) { setEvents([]); setLoading(false); return; }
      const enriched = (data || []).map((e) => ({
        ...e,
        creator_name: e.creator?.name || "?",
        going_count: e.rsvps?.filter((r) => r.status === "going").length || 0,
        interested_count: e.rsvps?.filter((r) => r.status === "interested").length || 0,
      }));
      setEvents(enriched);
      setLoading(false);
    });
  }, [search, category, timeFilter]);

  return (
    <div className="container">
      <div className="page-header">
        <h1>{t("events.title")}</h1>
        <p>{t("events.subtitle")}</p>
      </div>

      <div className="filters-bar">
        <input className="search-input" type="text" placeholder={t("events.search")}
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t("events.allCategories")}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(`cat.${c}`)}</option>)}
        </select>
        <div className="filter-tabs">
          <button className={`filter-tab ${timeFilter === "upcoming" ? "active" : ""}`} onClick={() => setTimeFilter("upcoming")}>
            {t("events.upcoming")}
          </button>
          <button className={`filter-tab ${timeFilter === "past" ? "active" : ""}`} onClick={() => setTimeFilter("past")}>
            {t("events.past")}
          </button>
          <button className={`filter-tab ${timeFilter === "" ? "active" : ""}`} onClick={() => setTimeFilter("")}>
            {t("events.all")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading">{t("events.loading")}</div>
      ) : events.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎉</div>
          <h3>{t("events.empty")}</h3>
          <p>{t("events.emptyHint")}</p>
        </div>
      ) : (
        <div className="events-grid">
          {events.map((e) => (
            <EventCard key={e.id} event={e} onClick={() => onNavigate("event-detail", { eventId: e.id })} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAP PAGE (Leaflet + Geolocation)
// ============================================================

function MapPage({ onNavigate }) {
  const { t, lang } = useI18n();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("events")
      .select("id, title, date, time, location, category, latitude, longitude, image_url, rsvps(status)")
      .eq("visibility", "public")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .then(({ data }) => {
        const enriched = (data || []).map((e) => ({
          ...e,
          going_count: e.rsvps?.filter((r) => r.status === "going").length || 0,
        }));
        setEvents(enriched);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (loading || !mapRef.current || mapInstanceRef.current) return;
    const L = window.L;
    if (!L) return;

    // Default: world view
    const map = L.map(mapRef.current).setView([20, 0], 2);
    mapInstanceRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    // Try geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 12),
        () => {
          // If events exist, fit to their bounds
          if (events.length > 0) {
            const bounds = events.map((e) => [e.latitude, e.longitude]);
            map.fitBounds(bounds, { padding: [50, 50] });
          }
        }
      );
    } else if (events.length > 0) {
      const bounds = events.map((e) => [e.latitude, e.longitude]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }

    events.forEach((ev) => {
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
              <a href="/event/${ev.id}" class="map-popup-link" data-event-id="${ev.id}">${t("map.details")} →</a>
            </div>
          </div>
        </div>
      `;
      const marker = L.marker([ev.latitude, ev.longitude]).addTo(map);
      marker.bindPopup(popupHtml, { maxWidth: 250, minWidth: 200 });
    });

    map.on("popupopen", (e) => {
      const link = e.popup.getElement().querySelector(".map-popup-link");
      if (link) {
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          const eventId = parseInt(link.getAttribute("data-event-id"));
          onNavigate("event-detail", { eventId });
        });
      }
    });

    return () => { map.remove(); mapInstanceRef.current = null; };
  }, [loading, events, onNavigate, lang, t]);

  return (
    <div className="container">
      <div className="page-header">
        <h1>{t("map.title")}</h1>
        <p>{t("map.subtitle")}</p>
      </div>
      {loading ? <div className="loading">{t("map.loading")}</div> : <div className="map-container" ref={mapRef}></div>}
    </div>
  );
}

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
// CHECK-IN PAGE (Creator only — scanner + list)
// ============================================================

function CheckinPage({ eventId, user, onNavigate }) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const [checkinData, setCheckinData] = useState(null);
  const [eventTitle, setEventTitle] = useState("");
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const loadCheckinList = useCallback(async () => {
    const { data } = await supabase.rpc("get_checkin_list", { p_event_id: eventId });
    if (data && data.status === "success") setCheckinData(data);
  }, [eventId]);

  useEffect(() => {
    supabase.rpc("get_event_detail", { p_event_id: eventId }).then(({ data }) => {
      if (data) setEventTitle(data.title);
      if (data && !data.is_admin) onNavigate("event-detail", { eventId });
    });
    loadCheckinList();
  }, [eventId, user, onNavigate, loadCheckinList]);

  // Auto-refresh checkin list every 5 seconds
  useEffect(() => {
    const interval = setInterval(loadCheckinList, 5000);
    return () => clearInterval(interval);
  }, [loadCheckinList]);

  const handleScan = async (decodedText) => {
    try {
      const url = new URL(decodedText);
      const tokenParam = url.searchParams.get("token");
      if (!tokenParam) { setResult({ status: "error", code: "invalid_token" }); return; }

      const { data } = await supabase.rpc("checkin_by_qr_token", { p_event_id: eventId, p_qr_token: tokenParam });
      setResult(data);
      loadCheckinList();
    } catch {
      setResult({ status: "error", code: "invalid_token" });
    }
  };

  const startScanning = async () => {
    if (!scannerRef.current) return;
    setResult(null);
    const html5Qr = new Html5Qrcode(scannerRef.current.id);
    html5QrRef.current = html5Qr;
    try {
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleScan(decodedText);
        },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      console.error("Scanner error:", err);
    }
  };

  const stopScanning = async () => {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
    }
    setScanning(false);
  };

  // Cleanup on unmount
  useEffect(() => { return () => { if (html5QrRef.current) { try { html5QrRef.current.stop(); } catch {} } }; }, []);

  const getResultMessage = () => {
    if (!result) return null;
    if (result.status === "success") return { className: "success", icon: "\u2705", text: t("qr.scanSuccess"), name: result.user_name };
    if (result.status === "already") return { className: "already", icon: "\u26a0\ufe0f", text: t("qr.scanAlready"), name: result.user_name };
    if (result.code === "kicked") return { className: "error", icon: "\u274c", text: t("qr.scanKicked") };
    return { className: "error", icon: "\u274c", text: t("qr.scanInvalid") };
  };

  const resultMsg = getResultMessage();

  return (
    <div className="container">
      <div className="checkin-page">
        <button className="back-button" onClick={() => onNavigate("event-detail", { eventId })}>
          ← {eventTitle}
        </button>
        <h1>{t("qr.scanTitle")}</h1>

        <div className="checkin-scanner">
          <div id="checkin-reader" ref={scannerRef} className="checkin-scanner-reader" />
          <div style={{ display: "flex", gap: 8 }}>
            {!scanning ? (
              <button className="btn btn-primary" onClick={startScanning}>{t("qr.openScanner")}</button>
            ) : (
              <button className="btn btn-danger" onClick={stopScanning}>{t("qr.stopScanning")}</button>
            )}
          </div>
        </div>

        {resultMsg && (
          <div className={`checkin-result ${resultMsg.className}`}>
            <span className="checkin-result-icon">{resultMsg.icon}</span>
            <div className="checkin-result-info">
              <strong>{resultMsg.text}</strong>
              {resultMsg.name && <span>{resultMsg.name}</span>}
            </div>
          </div>
        )}

        {checkinData && (
          <div className="checkin-list">
            <h3>{t("qr.checkinList")}</h3>
            <div className="checkin-list-stats">
              <strong>{checkinData.total_checked_in}</strong> {t("qr.checkedInCount")} {t("qr.of")} <strong>{checkinData.total_going}</strong>
            </div>
            {checkinData.total_going > 0 && (
              <div className="checkin-progress-bar">
                <div className="checkin-progress-fill" style={{ width: `${(checkinData.total_checked_in / checkinData.total_going) * 100}%` }} />
              </div>
            )}
            {(checkinData.attendees || []).map((a) => (
              <div key={a.user_id} className="checkin-attendee">
                <Avatar name={a.name} avatarUrl={a.avatar_url} size={32} />
                <div className="checkin-attendee-info">{a.name}</div>
                <span className={`checkin-attendee-status ${a.checked_in_at ? "checked-in" : "not-checked-in"}`}>
                  {a.checked_in_at ? t("qr.checkedIn") : t("qr.notCheckedIn")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// EVENT DETAIL PAGE
// ============================================================

function EventDetailPage({ eventId, user, onNavigate }) {
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

  const loadEvent = useCallback(() => {
    supabase.rpc("get_event_detail", { p_event_id: eventId }).then(({ data, error }) => {
      setEvent(data);
      setLoading(false);
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
    onNavigate("events");
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

  const handleShare = () => {
    const url = `${window.location.origin}/event/${eventId}`;
    navigator.clipboard.writeText(url).then(
      () => alert(t("detail.linkCopied")),
      () => prompt(t("detail.copyLink"), url)
    );
  };

  if (loading) return <div className="loading">{t("loading")}</div>;
  if (!event) return <div className="loading">{t("detail.notFound")}</div>;

  // RESTRICTED VIEW
  if (event.has_access === false) {
    return (
      <div className="container">
        <div className="restricted-event">
          <button className="back-button" onClick={() => onNavigate("events")}>{t("detail.back")}</button>
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
        <button className="back-button" onClick={() => onNavigate("events")}>{t("detail.back")}</button>

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
          </div>
          <h1 className="event-detail-title">{event.title}</h1>
          <div className="event-detail-meta">
            <span>{formatDate(event.date, lang)}</span>
            <span>{event.time?.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ""}</span>
            <span>{event.location}</span>
          </div>
        </div>

        <div className="event-detail-creator">
          {t("detail.organizedBy")} <strong>{event.creator_name}</strong>
        </div>

        <div className="event-actions">
          <button className="btn btn-secondary btn-sm" onClick={handleShare}>{t("detail.share")}</button>
          <a className="btn btn-secondary btn-sm" href={generateGoogleCalendarUrl(event)} target="_blank" rel="noopener noreferrer">{t("cal.google")}</a>
          <button className="btn btn-secondary btn-sm" onClick={() => generateIcsFile(event)}>{t("cal.ics")}</button>
          {isAdmin && (
            <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("edit-event", { eventId: event.id })}>{t("detail.edit")}</button>
          )}
          {isCreator && (
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>{t("detail.delete")}</button>
          )}
          {isAdmin && event.qr_enabled && (
            <button className="btn btn-primary btn-sm" onClick={() => onNavigate("checkin", { eventId: event.id })}>{t("qr.openScanner")}</button>
          )}
        </div>

        {isAdmin && (
          <QrToggleSection eventId={eventId} qrEnabled={event.qr_enabled} onToggle={loadEvent} />
        )}

        <p className="event-detail-description">{event.description}</p>

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

        <QrTicketSection event={event} />

        {(event.going_users?.length > 0 || event.interested_users?.length > 0) && (
          <div className="attendees-section">
            {event.going_users?.length > 0 && (
              <>
                <h3>{t("detail.goingTitle")} ({event.going_users.length})</h3>
                <div className="attendees-list">
                  {event.going_users.map((u) => (
                    isAdmin && u.id !== user.id ? (
                      <span key={u.id} className="attendee-chip-with-action">
                        <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                        {u.name}
                        {u.checked_in_at && event.qr_enabled && <span style={{ color: "#16a34a", fontSize: 11 }}>&#10003;</span>}
                        <button className="attendee-kick-btn" onClick={() => handleKick(u.id)}>{t("kick.button")}</button>
                      </span>
                    ) : (
                      <span key={u.id} className="attendee-chip">
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
                      <span key={u.id} className="attendee-chip-with-action">
                        <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                        {u.name}
                        <button className="attendee-kick-btn" onClick={() => handleKick(u.id)}>{t("kick.button")}</button>
                      </span>
                    ) : (
                      <span key={u.id} className="attendee-chip">
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
                    <span key={u.id} className="attendee-chip waitlisted">
                      <Avatar name={u.name} avatarUrl={u.avatar_url} size={24} />
                      {u.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {isAdmin && event.visibility === "semi_public" && (
          <>
            <InvitationManager eventId={eventId} />
            <AccessRequestManager eventId={eventId} />
          </>
        )}

        {isCreator && (
          <AdminManager eventId={eventId} />
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

// ============================================================
// EVENT FORM
// ============================================================

function EventFormPage({ eventId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const isEdit = !!eventId;
  const [form, setForm] = useState({
    title: "", description: "", date: "", time: "", end_time: "",
    location: "", category: "Technology", visibility: "public",
    max_attendees: "",
  });
  const [images, setImages] = useState([]);
  const [error, setError] = useState("");
  const [geocodeError, setGeocodeError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (isEdit) {
      supabase.rpc("get_event_detail", { p_event_id: eventId }).then(({ data }) => {
        if (data && data.has_access) {
          setForm({
            title: data.title, description: data.description || "", date: data.date,
            time: data.time?.slice(0, 5) || "", end_time: data.end_time?.slice(0, 5) || "",
            location: data.location, category: data.category,
            visibility: data.visibility || "public",
            max_attendees: data.max_attendees != null ? String(data.max_attendees) : "",
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
    if (!form.title || !form.date || !form.time || !form.location || !form.description) {
      setError(t("form.required"));
      return;
    }

    setSubmitting(true);

    // Geocode the address
    const geo = await geocodeAddress(form.location, lang);
    if (!geo) {
      setGeocodeError(t("form.geocodeError"));
    }

    const payload = {
      title: form.title, description: form.description, date: form.date,
      time: form.time, end_time: form.end_time || null, location: form.location,
      image_url: images.length > 0 ? images[0] : null, category: form.category,
      visibility: form.visibility,
      latitude: geo ? geo.lat : null,
      longitude: geo ? geo.lng : null,
      max_attendees: parseInt(form.max_attendees) || null,
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
              <label>{t("form.address")} *</label>
              <input type="text" value={form.location} onChange={update("location")} placeholder={t("form.addressPlaceholder")} />
              <small style={{ color: "#888", fontSize: 12, marginTop: 4, display: "block" }}>{t("form.addressHint")}</small>
              {geocodeError && <small style={{ color: "#ef4444", fontSize: 12, marginTop: 4, display: "block" }}>{geocodeError}</small>}
            </div>
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
              <label>{t("form.maxAttendees")}</label>
              <input type="number" min="1" value={form.max_attendees} onChange={update("max_attendees")} placeholder={t("form.maxAttendeesPlaceholder")} />
              <small style={{ color: "#888", fontSize: 12, marginTop: 4, display: "block" }}>{t("form.maxAttendeesHint")}</small>
            </div>
            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? t("form.geocoding") : isEdit ? t("form.save") : t("form.create")}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LOGIN
// ============================================================

function LoginPage({ onNavigate }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); return; }
    onNavigate("events");
  };

  return (
    <div className="container">
      <div className="form-page">
        <div className="form-card">
          <h2>{t("auth.loginTitle")}</h2>
          {error && <div className="form-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t("auth.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("auth.password")}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} />
            </div>
            <button className="btn btn-primary btn-full" type="submit">{t("auth.loginSubmit")}</button>
          </form>
          <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#888" }}>
            {t("auth.noAccount")}{" "}
            <button className="link-button" onClick={() => onNavigate("register")}>{t("nav.register")}</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// REGISTER
// ============================================================

function RegisterPage({ onNavigate }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name || !email || !password) { setError(t("auth.fillAll")); return; }
    const { error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { name } },
    });
    if (err) { setError(err.message); return; }
    onNavigate("events");
  };

  return (
    <div className="container">
      <div className="form-page">
        <div className="form-card">
          <h2>{t("auth.registerTitle")}</h2>
          {error && <div className="form-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{t("auth.name")}</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("auth.namePlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("auth.email")}</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("auth.emailPlaceholder")} />
            </div>
            <div className="form-group">
              <label>{t("auth.password")}</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} />
            </div>
            <button className="btn btn-primary btn-full" type="submit">{t("auth.registerSubmit")}</button>
          </form>
          <p style={{ textAlign: "center", marginTop: 16, fontSize: 14, color: "#888" }}>
            {t("auth.hasAccount")}{" "}
            <button className="link-button" onClick={() => onNavigate("login")}>{t("nav.login")}</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PROFILE PAGE
// ============================================================

function ProfilePage({ user, onNavigate, onAvatarChange }) {
  const { t, lang } = useI18n();
  const [createdEvents, setCreatedEvents] = useState([]);
  const [attendingEvents, setAttendingEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarFileRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase.from("events").select("*").eq("creator_id", user.id),
      supabase.from("rsvps").select("events(*)").eq("user_id", user.id).eq("status", "going"),
    ]).then(([created, attending]) => {
      setCreatedEvents(created.data || []);
      setAttendingEvents((attending.data || []).map((r) => r.events).filter(Boolean));
      setLoading(false);
    });
  }, [user]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const url = await uploadImage(file, path);
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      if (onAvatarChange) onAvatarChange(url);
    } catch (err) {
      console.error("Avatar upload error:", err);
    }
    setAvatarUploading(false);
    if (avatarFileRef.current) avatarFileRef.current.value = "";
  };

  if (!user) { onNavigate("login"); return null; }
  if (loading) return <div className="loading">{t("profile.loading")}</div>;

  return (
    <div className="container">
      <div className="profile-header">
        <div className="profile-avatar-upload" onClick={() => avatarFileRef.current?.click()}>
          <div className="profile-avatar">
            {user.avatar_url ? (
              <img className="avatar-img" src={user.avatar_url} alt={user.name} />
            ) : (
              user.name[0]
            )}
          </div>
          <div className="profile-avatar-overlay">
            {avatarUploading ? t("form.uploading") : t("profile.changeAvatar")}
          </div>
        </div>
        <input ref={avatarFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleAvatarUpload} />
        <div className="profile-info">
          <h2>{user.name}</h2>
          <p>{user.email}</p>
        </div>
      </div>

      <NotificationPreferences user={user} />

      <div className="profile-section">
        <h3>{t("profile.myEvents")} ({createdEvents.length})</h3>
        {createdEvents.length > 0 ? (
          <div className="profile-events-grid">
            {createdEvents.map((e) => (
              <EventCard key={e.id} event={{ ...e, going_count: 0, interested_count: 0, creator_name: user.name }}
                onClick={() => onNavigate("event-detail", { eventId: e.id })} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>{t("profile.noEvents")}</p>
            <button className="btn btn-primary" onClick={() => onNavigate("create-event")}>{t("profile.createFirst")}</button>
          </div>
        )}
      </div>

      <div className="profile-section">
        <h3>{t("profile.attending")} ({attendingEvents.length})</h3>
        {attendingEvents.length > 0 ? (
          <div className="profile-events-grid">
            {attendingEvents.map((e) => (
              <EventCard key={e.id} event={{ ...e, going_count: 0, interested_count: 0, creator_name: "" }}
                onClick={() => onNavigate("event-detail", { eventId: e.id })} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>{t("profile.noAttending")}</p>
            <button className="btn btn-primary" onClick={() => onNavigate("events")}>{t("profile.findEvents")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

export default function App() {
  const initialRoute = parseUrl(window.location.pathname);
  const [page, setPage] = useState(initialRoute.page);
  const [pageData, setPageData] = useState(initialRoute.data);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // I18n state
  const [lang, setLangState] = useState(localStorage.getItem("lang") || "no");
  const t = useCallback((key) => translations[lang]?.[key] || translations["en"]?.[key] || key, [lang]);
  const setLang = useCallback((l) => { localStorage.setItem("lang", l); setLangState(l); }, []);

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadProfile(session.user);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        loadProfile(session.user);
      } else {
        setUser(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(authUser) {
    const { data } = await supabase.from("profiles").select("*").eq("id", authUser.id).single();
    if (data) {
      setUser({ ...data, email: authUser.email });
    }
    setLoading(false);
  }

  // Browser navigation
  useEffect(() => {
    const handlePopState = () => {
      const route = parseUrl(window.location.pathname);
      setPage(route.page);
      setPageData(route.data);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (p, data = {}) => {
    const url = pageToUrl(p, data);
    window.history.pushState({}, "", url);
    setPage(p);
    setPageData(data);
    window.scrollTo(0, 0);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    navigate("events");
  };

  if (loading) return <div className="loading">{t("loading")}</div>;

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      <div>
        <Navbar user={user} currentPage={page} onNavigate={navigate} onLogout={logout} />

        {page === "events" && <EventsPage onNavigate={navigate} />}
        {page === "map" && <MapPage onNavigate={navigate} />}
        {page === "event-detail" && <EventDetailPage eventId={pageData.eventId} user={user} onNavigate={navigate} />}
        {page === "checkin" && <CheckinPage eventId={pageData.eventId} user={user} onNavigate={navigate} />}
        {page === "create-event" && <EventFormPage user={user} onNavigate={navigate} />}
        {page === "edit-event" && <EventFormPage eventId={pageData.eventId} user={user} onNavigate={navigate} />}
        {page === "login" && <LoginPage onNavigate={navigate} />}
        {page === "register" && <RegisterPage onNavigate={navigate} />}
        {page === "profile" && <ProfilePage user={user} onNavigate={navigate} onAvatarChange={(url) => setUser({ ...user, avatar_url: url })} />}
      </div>
    </I18nContext.Provider>
  );
}
