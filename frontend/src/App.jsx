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
// TIMESLOT GENERATOR HELPER
// ============================================================

function generateSlots(from, to, durationMin) {
  const slots = [];
  if (!from || !to || !durationMin) return slots;
  let [h, m] = from.split(":").map(Number);
  const [endH, endM] = to.split(":").map(Number);
  const endMinutes = endH * 60 + endM;
  while (h * 60 + m + durationMin <= endMinutes) {
    const startStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    m += durationMin;
    if (m >= 60) { h += Math.floor(m / 60); m = m % 60; }
    const endStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    slots.push({ start: startStr, end: endStr });
  }
  return slots;
}

// ============================================================
// ADDRESS AUTOCOMPLETE COMPONENT
// ============================================================

function AddressAutocomplete({ value, onChange, onSelect, placeholder, lang }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const timerRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    clearTimeout(timerRef.current);
    if (val.length < 3) { setSuggestions([]); setShowDropdown(false); return; }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5`,
          { headers: { "Accept-Language": lang === "no" ? "nb" : "en" } }
        );
        const data = await res.json();
        setSuggestions(data || []);
        setShowDropdown(true);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  };

  const handleSelect = (item) => {
    onChange(item.display_name);
    onSelect({ lat: parseFloat(item.lat), lng: parseFloat(item.lon), display_name: item.display_name });
    setShowDropdown(false);
    setSuggestions([]);
  };

  return (
    <div className="address-autocomplete" ref={wrapperRef}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true); }}
      />
      {showDropdown && suggestions.length > 0 && (
        <div className="address-suggestions">
          {suggestions.map((item, i) => (
            <div key={i} className="address-suggestion-item" onClick={() => handleSelect(item)}>
              {item.display_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const uid = `${event.id}-${startDate}@hapn`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hapn//Event//EN",
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
  if (pathname === "/" || pathname === "") return { page: "discover", data: {} };
  if (pathname === "/discover") return { page: "discover", data: {} };
  if (pathname === "/search") return { page: "search", data: {} };
  if (pathname === "/events") return { page: "search", data: {} };
  if (pathname === "/map") return { page: "search", data: { view: "map" } };
  if (pathname === "/create") return { page: "create-event", data: {} };
  if (pathname === "/login") return { page: "login", data: {} };
  if (pathname === "/register") return { page: "register", data: {} };
  if (pathname === "/profile") return { page: "profile", data: {} };

  if (pathname === "/friends") return { page: "friends", data: {} };

  if (pathname === "/venues") return { page: "venues", data: {} };
  if (pathname === "/venue/register") return { page: "venue-register", data: {} };
  if (pathname === "/my-tickets") return { page: "my-tickets", data: {} };

  const venueScanMatch = pathname.match(/^\/venue\/(\d+)\/scan$/);
  if (venueScanMatch) return { page: "venue-scan", data: { venueId: parseInt(venueScanMatch[1]) } };

  const venueManageMatch = pathname.match(/^\/venue\/(\d+)\/manage$/);
  if (venueManageMatch) return { page: "venue-manage", data: { venueId: parseInt(venueManageMatch[1]) } };

  const venueMatch = pathname.match(/^\/venue\/(\d+)$/);
  if (venueMatch) return { page: "venue-detail", data: { venueId: parseInt(venueMatch[1]) } };

  const userMatch = pathname.match(/^\/user\/([a-f0-9-]+)$/);
  if (userMatch) return { page: "user-profile", data: { userId: userMatch[1] } };

  const checkinMatch = pathname.match(/^\/event\/(\d+)\/checkin$/);
  if (checkinMatch) return { page: "checkin", data: { eventId: parseInt(checkinMatch[1]) } };

  const eventMatch = pathname.match(/^\/event\/(\d+)$/);
  if (eventMatch) return { page: "event-detail", data: { eventId: parseInt(eventMatch[1]) } };

  const editMatch = pathname.match(/^\/edit\/(\d+)$/);
  if (editMatch) return { page: "edit-event", data: { eventId: parseInt(editMatch[1]) } };

  return { page: "discover", data: {} };
}

function pageToUrl(page, data = {}) {
  switch (page) {
    case "discover": return "/";
    case "search": return "/search";
    case "events": return "/search";
    case "create-event": return "/create";
    case "login": return "/login";
    case "register": return "/register";
    case "profile": return "/profile";
    case "event-detail": return `/event/${data.eventId}`;
    case "edit-event": return `/edit/${data.eventId}`;
    case "checkin": return `/event/${data.eventId}/checkin`;
    case "friends": return "/friends";
    case "user-profile": return `/user/${data.userId}`;
    case "venues": return "/venues";
    case "venue-detail": return `/venue/${data.venueId}`;
    case "venue-register": return "/venue/register";
    case "venue-manage": return `/venue/${data.venueId}/manage`;
    case "venue-scan": return `/venue/${data.venueId}/scan`;
    case "my-tickets": return "/my-tickets";
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
    if (notif.type === "follow_request" || notif.type === "follow_accepted") {
      onNavigate("user-profile", { userId: notif.actor_id });
    } else {
      onNavigate("event-detail", { eventId: notif.event_id });
    }
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
      case "follow_request": return <><strong>{actor}</strong> {t("notif.follow_request")}</>;
      case "follow_accepted": return <><strong>{actor}</strong> {t("notif.follow_accepted")}</>;
      default: return notif.type;
    }
  };

  return (
    <div className="notification-bell" ref={bellRef}>
      <button className="notification-bell-btn" onClick={() => setOpen(!open)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
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
// BOTTOM TAB BAR (mobile only, SAS-style)
// ============================================================

function BottomTabBar({ user, currentPage, onNavigate }) {
  const { t } = useI18n();

  const isActive = (tabPage) => currentPage === tabPage;
  const handleNav = (page) => onNavigate(page);

  return (
    <div className="bottom-tab-bar">
      {/* Discover (Compass) */}
      <button className={`bottom-tab ${isActive("discover") ? "active" : ""}`} onClick={() => handleNav("discover")}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
        </svg>
        <span>{t("nav.discover")}</span>
      </button>

      {/* Search (Magnifying glass) */}
      <button className={`bottom-tab ${isActive("search") ? "active" : ""}`} onClick={() => handleNav("search")}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <span>{t("nav.search")}</span>
      </button>

      {/* Tickets (always visible, login-gate on tap) */}
      <button className={`bottom-tab ${isActive("my-tickets") ? "active" : ""}`} onClick={() => handleNav(user ? "my-tickets" : "login")}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>
          <path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>
        </svg>
        <span>{t("nav.myTickets")}</span>
      </button>

      {/* Profile (always visible, login-gate on tap) */}
      <button className={`bottom-tab ${isActive("profile") ? "active" : ""}`} onClick={() => handleNav(user ? "profile" : "login")}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <span>{t("nav.profile")}</span>
      </button>
    </div>
  );
}

// Shared notification dropdown used by both BottomTabBar and NotificationBell
function NotificationDropdown({ notifications, unreadCount, onNavigate, onMarkAllRead, onRefresh }) {
  const { t, lang } = useI18n();

  const handleClick = async (notif) => {
    if (!notif.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
    }
    if (notif.type === "follow_request" || notif.type === "follow_accepted") {
      onNavigate("user-profile", { userId: notif.actor_id });
    } else if (notif.type === "booking_confirmed" || notif.type === "booking_cancelled") {
      onNavigate("my-tickets");
    } else {
      onNavigate("event-detail", { eventId: notif.event_id });
    }
    onRefresh();
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
      case "follow_request": return <><strong>{actor}</strong> {t("notif.follow_request")}</>;
      case "follow_accepted": return <><strong>{actor}</strong> {t("notif.follow_accepted")}</>;
      case "booking_confirmed": return t("notif.booking_confirmed");
      case "booking_cancelled": return t("notif.booking_cancelled");
      default: return notif.type;
    }
  };

  return (
    <div className="notification-dropdown bottom-tab-dropdown">
      <div className="notification-dropdown-header">
        <h3>{t("notif.title")}</h3>
        {unreadCount > 0 && <button onClick={onMarkAllRead}>{t("notif.markAllRead")}</button>}
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
  );
}

// ============================================================
// NAVBAR
// ============================================================

function Navbar({ user, currentPage, onNavigate, onLogout }) {
  const { t } = useI18n();

  const nav = (page, data) => { onNavigate(page, data); };

  return (
    <nav className="navbar">
      <div className="navbar-brand" onClick={() => nav("discover")}>
        <img src="/logo.png" alt="Hapn" className="navbar-logo" />
      </div>

      {/* Desktop links — simplified */}
      <div className="navbar-links navbar-desktop">
        <button className={currentPage === "discover" ? "active" : ""} onClick={() => nav("discover")}>
          {t("nav.discover")}
        </button>
        <button className={currentPage === "search" ? "active" : ""} onClick={() => nav("search")}>
          {t("nav.search")}
        </button>
        <button className={currentPage === "venues" ? "active" : ""} onClick={() => nav("venues")}>
          {t("nav.venues")}
        </button>
        {user && (
          <button className={currentPage === "my-tickets" ? "active" : ""} onClick={() => nav("my-tickets")}>
            {t("nav.myTickets")}
          </button>
        )}
        {user ? (
          <div className="navbar-user">
            <NotificationBell user={user} onNavigate={(p, d) => nav(p, d)} />
            <button className={currentPage === "profile" ? "active" : ""} onClick={() => nav("profile")}>
              {t("nav.profile")}
            </button>
            {user.avatar_url ? (
              <img className="navbar-avatar" src={user.avatar_url} alt={user.name} onClick={() => nav("profile")} />
            ) : (
              <span className="navbar-user-name">{user.name}</span>
            )}
          </div>
        ) : (
          <>
            <button onClick={() => nav("login")}>{t("nav.login")}</button>
            <button className="btn-primary" onClick={() => nav("register")}>{t("nav.register")}</button>
          </>
        )}
        <LanguagePicker />
      </div>

      {/* Mobile: notification bell + language picker */}
      <div className="navbar-mobile-actions">
        {user && <NotificationBell user={user} onNavigate={(p, d) => nav(p, d)} />}
        <LanguagePicker />
      </div>
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
        <div className="event-card-title">{event.title}</div>
        <div className="event-card-meta">
          <span>{formatDate(event.date, lang)}</span>
          <span>{event.time?.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ""} · {event.location}</span>
        </div>
        <div className="event-card-footer">
          <div className="event-card-attendees">
            <strong>{event.going_count || 0}</strong> {t("events.attending")}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SEARCH & BROWSE PAGE (replaces Events + Map)
// ============================================================

function SearchBrowsePage({ onNavigate, initialView }) {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState([]);
  const [venues, setVenues] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(initialView || "list");
  const [tab, setTab] = useState("events");
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);

  // Fetch events
  useEffect(() => {
    if (tab !== "events") return;
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    let query = supabase
      .from("events")
      .select("*, creator:profiles!creator_id(name), rsvps(status)")
      .eq("visibility", "public")
      .gte("date", today)
      .order("date", { ascending: true });

    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location.ilike.%${search}%`);
    }
    if (category) {
      query = query.eq("category", category);
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
  }, [search, category, tab]);

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
          <div className="events-grid">
            {events.map((e) => (
              <EventCard key={e.id} event={e} onClick={() => onNavigate("event-detail", { eventId: e.id })} />
            ))}
          </div>
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
          </div>
          <h1 className="event-detail-title">{event.title}</h1>
          <div className="event-detail-meta">
            <span>{formatDate(event.date, lang)}</span>
            <span>{event.time?.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ""}</span>
            {event.location_hidden ? (
              <span style={{ color: "#d97706" }}>📍 {event.area_name} — <em>{t("discover.addressHidden")}</em></span>
            ) : (
              <span>{event.location}</span>
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

// ============================================================
// DISCOVER PAGE (Tinder-style swipe)
// ============================================================

function DiscoverPage({ user, onNavigate }) {
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

  // Pointer state refs (no re-render needed)
  const dragRef = useRef({ startX: 0, startY: 0, currentX: 0, isDragging: false });
  const cardRef = useRef(null);
  const indicatorRightRef = useRef(null);
  const indicatorLeftRef = useRef(null);

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
      // Fallback: fetch events without location
      const today = new Date().toISOString().split("T")[0];
      let q = supabase.from("events").select("id, title, date, time, location, category, image_url").eq("visibility", "public").gte("date", today).order("date").limit(20);
      if (category) q = q.eq("category", category);
      q.then(({ data }) => {
        setCards((data || []).map((e) => ({ ...e, going_count: 0, attendee_preview: [] })));
        setCurrentIndex(0);
        setLoading(false);
      });
    }
  }, [userLocation, locationDenied, radius, dateFrom, dateTo, category]);

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

  const renderCard = (card, className, ref) => (
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
          {card.join_mode === "approval_required" && (
            <span className="discover-approval-badge">{t("discover.approvalRequired")}</span>
          )}
          {card.distance_km != null && (
            <span className="discover-card-distance">{card.distance_km} {t("discover.km")}</span>
          )}
        </div>
        <div className="discover-card-title">{card.title}</div>
        <div className="discover-card-meta">
          <span>{formatDate(card.date, lang)}</span>
          <span>{card.time?.slice(0, 5)} · {card.area_name}</span>
        </div>
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
      </div>
    </div>
  );

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
                  {currentCard.join_mode === "approval_required" && (
                    <span className="discover-approval-badge">{t("discover.approvalRequired")}</span>
                  )}
                  {currentCard.distance_km != null && (
                    <span className="discover-card-distance">{currentCard.distance_km} {t("discover.km")}</span>
                  )}
                </div>
                <div className="discover-card-title">{currentCard.title}</div>
                <div className="discover-card-meta">
                  <span>{formatDate(currentCard.date, lang)}</span>
                  <span>{currentCard.time?.slice(0, 5)} · {currentCard.area_name}</span>
                </div>
                <div className="discover-card-footer">
                  <div className="discover-card-attendees">
                    {currentCard.attendee_preview && currentCard.attendee_preview.length > 0 && (
                      <div className="avatar-stack">
                        {currentCard.attendee_preview.slice(0, 5).map((a, i) => (
                          <Avatar key={i} name={a.name} avatarUrl={a.avatar_url} size={24} />
                        ))}
                      </div>
                    )}
                    <div className="discover-card-stats">
                      <strong>{currentCard.going_count || 0}</strong> {t("discover.going")}
                    </div>
                  </div>
                </div>
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

// ============================================================
// EVENT FORM
// ============================================================

function EventFormPage({ eventId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const isEdit = !!eventId;
  const [form, setForm] = useState({
    title: "", description: "", date: "", time: "", end_time: "",
    location: "", category: "Technology", visibility: "public",
    join_mode: "open", max_attendees: "", venue_id: "",
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
            location: data.location, category: data.category,
            visibility: data.visibility || "public",
            join_mode: data.join_mode || "open",
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
      join_mode: form.join_mode,
      latitude: geo ? geo.lat : null,
      longitude: geo ? geo.lng : null,
      max_attendees: parseInt(form.max_attendees) || null,
      venue_id: form.venue_id ? parseInt(form.venue_id) : null,
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

// ============================================================
// LOGIN
// ============================================================

function SocialLoginButtons({ t }) {
  const [loading, setLoading] = useState(null);

  const handleSocial = async (provider) => {
    setLoading(provider);
    await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
  };

  return (
    <div className="social-login">
      <div className="social-divider"><span>{t("auth.orSocial")}</span></div>
      <div className="social-buttons">
        <button className="social-btn google" onClick={() => handleSocial("google")} disabled={!!loading}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A11.96 11.96 0 0 0 1 12c0 1.94.46 3.77 1.18 5.07l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Google
        </button>
      </div>
      {loading && <div className="social-loading">{t("auth.submitting")}</div>}
    </div>
  );
}

function LoginPage({ onNavigate }) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) { setError(err.message); setSubmitting(false); return; }
    onNavigate("discover");
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
            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner" />{t("auth.submitting")}</> : t("auth.loginSubmit")}
            </button>
          </form>
          <SocialLoginButtons t={t} />
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
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!name || !email || !password) { setError(t("auth.fillAll")); return; }
    setSubmitting(true);
    const { error: err } = await supabase.auth.signUp({
      email, password,
      options: { data: { name } },
    });
    if (err) { setError(err.message); setSubmitting(false); return; }
    onNavigate("discover");
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
            <button className="btn btn-primary btn-full" type="submit" disabled={submitting}>
              {submitting ? <><span className="spinner" />{t("auth.submitting")}</> : t("auth.registerSubmit")}
            </button>
          </form>
          <SocialLoginButtons t={t} />
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

// ============================================================
// FRIENDS ACTIVITY FEED (reusable)
// ============================================================

function FriendsActivityFeed({ user, onNavigate }) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadFeed = useCallback(async (reset = false) => {
    const newOffset = reset ? 0 : offset;
    const { data } = await supabase.rpc("get_friends_activity", { p_limit: 20, p_offset: newOffset });
    const results = data || [];
    if (reset) {
      setItems(results);
      setOffset(results.length);
    } else {
      setItems((prev) => [...prev, ...results]);
      setOffset((prev) => prev + results.length);
    }
    setHasMore(results.length === 20);
    setLoading(false);
  }, [offset]);

  useEffect(() => {
    if (user) loadFeed(true);
  }, [user]);

  if (loading) return <div className="loading">{t("loading")}</div>;

  if (items.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">👥</div>
        <h3>{t("friends.empty")}</h3>
        <p>{t("friends.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="friends-feed">
      {items.map((item, i) => (
        <div key={i} className="friends-feed-item" onClick={() => onNavigate("event-detail", { eventId: item.event_id })}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="friends-feed-action">
              <span className="friends-feed-user" onClick={(e) => { e.stopPropagation(); onNavigate("user-profile", { userId: item.user_id }); }} style={{ cursor: "pointer", display: "inline-flex" }}>
                <Avatar name={item.user_name} avatarUrl={item.user_avatar_url} size={28} />
                <strong>{item.user_name}</strong>
              </span>
              {" "}
              {item.rsvp_status === "going" ? t("friends.isGoing") : t("friends.isInterested")}
            </div>
            <div className="friends-feed-event-title">{item.event_title}</div>
            <div className="friends-feed-event-meta">
              {formatShortDate(item.event_date, lang)} · {item.event_time?.slice(0, 5)} · {item.event_location}
            </div>
          </div>
          {item.event_image_url && (
            <img className="friends-feed-event-image" src={item.event_image_url} alt="" />
          )}
        </div>
      ))}
      {hasMore && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={() => loadFeed(false)}>{t("friends.loadMore")}</button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// FRIENDS ACTIVITY PAGE (/friends)
// ============================================================

function FriendsActivityPage({ user, onNavigate }) {
  const { t } = useI18n();

  if (!user) { onNavigate("login"); return null; }

  return (
    <div className="container">
      <div className="page-header">
        <h1>{t("friends.title")}</h1>
        <p>{t("friends.subtitle")}</p>
      </div>
      <FriendsActivityFeed user={user} onNavigate={onNavigate} />
    </div>
  );
}

// ============================================================
// USER PROFILE PAGE (/user/:userId)
// ============================================================

function UserProfilePage({ userId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [followLoading, setFollowLoading] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [activeTab, setActiveTab] = useState("going");

  const loadProfile = useCallback(async () => {
    const { data } = await supabase.rpc("get_user_profile", { target_user_id: userId });
    setProfile(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  useEffect(() => {
    if (profile && profile.is_own_profile) {
      onNavigate("profile");
    }
  }, [profile, onNavigate]);

  const handleFollow = async () => {
    if (!user) return onNavigate("login");
    setFollowLoading(true);
    await supabase.rpc("toggle_follow", { target_user_id: userId });
    await loadProfile();
    setFollowLoading(false);
  };

  if (loading) return <div className="loading">{t("loading")}</div>;
  if (!profile) return <div className="loading">{t("detail.notFound")}</div>;

  const followBtn = () => {
    if (profile.follow_status === "active") {
      return <button className="follow-btn following" onClick={handleFollow} disabled={followLoading}>{t("profile.unfollowButton")}</button>;
    } else if (profile.follow_status === "pending") {
      return <button className="follow-btn requested" disabled>{t("profile.followRequested")}</button>;
    }
    return <button className="follow-btn follow" onClick={handleFollow} disabled={followLoading}>{t("profile.followButton")}</button>;
  };

  const tabEvents = activeTab === "going" ? (profile.going_events || []) : (profile.created_events || []);

  return (
    <div className="container">
      <button className="back-button" onClick={() => window.history.back()}>{t("detail.back")}</button>

      <div className="profile-header">
        <div className="profile-avatar">
          {profile.avatar_url ? (
            <img className="avatar-img" src={profile.avatar_url} alt={profile.name} />
          ) : (
            profile.name?.[0] || "?"
          )}
        </div>
        <div className="profile-info">
          <h2>
            {profile.name}
            {profile.is_plus && <span className="profile-plus-badge">{t("plus.badge")}</span>}
          </h2>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          <div className="profile-stats">
            <div className="profile-stat-item">
              <span className="profile-stat-number">{profile.follower_count || 0}</span>
              <span className="profile-stat-label">{t("profile.stats.followers")}</span>
            </div>
            <div className="profile-stat-item">
              <span className="profile-stat-number">{profile.following_count || 0}</span>
              <span className="profile-stat-label">{t("profile.stats.following")}</span>
            </div>
          </div>
          {user && profile.follow_status !== "own" && (
            <div style={{ marginTop: 12 }}>{followBtn()}</div>
          )}
        </div>
      </div>

      {/* Photo gallery */}
      {profile.photos && profile.photos.length > 0 && (
        <div className="user-profile-gallery">
          {profile.photos.map((p) => (
            <img key={p.id} src={p.image_url} alt="" onClick={() => setLightboxUrl(p.image_url)} />
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="profile-tabs">
        <div className="filter-tabs">
          {profile.can_see_activity && (
            <button className={`filter-tab${activeTab === "going" ? " active" : ""}`} onClick={() => setActiveTab("going")}>
              {t("profile.goingTab")} ({(profile.going_events || []).length})
            </button>
          )}
          <button className={`filter-tab${activeTab === "created" ? " active" : ""}`} onClick={() => setActiveTab("created")}>
            {t("profile.createdTab")} ({(profile.created_events || []).length})
          </button>
        </div>
      </div>

      {!profile.can_see_activity && activeTab === "going" ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <p>{t("profile.activityPrivate")}</p>
        </div>
      ) : (
        <div className="profile-section">
          {tabEvents.length > 0 ? (
            <div className="profile-events-grid">
              {tabEvents.map((e) => (
                <EventCard key={e.id} event={{ ...e, going_count: 0, interested_count: 0, creator_name: "" }}
                  onClick={() => onNavigate("event-detail", { eventId: e.id })} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">{activeTab === "going" ? "🎟️" : "🎪"}</div>
              <p>{activeTab === "going" ? t("profile.noAttending") : t("profile.noEvents")}</p>
            </div>
          )}
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
// PROFILE PAGE (own profile — enhanced with social features)
// ============================================================

function ProfilePage({ user, onNavigate, onAvatarChange }) {
  const { t, lang } = useI18n();
  const [createdEvents, setCreatedEvents] = useState([]);
  const [attendingEvents, setAttendingEvents] = useState([]);
  const [interestedEvents, setInterestedEvents] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [pendingFollows, setPendingFollows] = useState([]);
  const [userVenues, setUserVenues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [activeTab, setActiveTab] = useState("going");
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [bio, setBio] = useState("");
  const [editingBio, setEditingBio] = useState(false);
  const [bioText, setBioText] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [photoUploading, setPhotoUploading] = useState(false);
  const avatarFileRef = useRef(null);
  const photoFileRef = useRef(null);

  const loadData = useCallback(async () => {
    if (!user) return;
    const [created, attending, interested, photosRes, profileRes, followersRes, followingRes, pendingRes, venuesRes] = await Promise.all([
      supabase.from("events").select("*").eq("creator_id", user.id),
      supabase.from("rsvps").select("events(*)").eq("user_id", user.id).eq("status", "going"),
      supabase.from("rsvps").select("events(*)").eq("user_id", user.id).eq("status", "interested"),
      supabase.from("profile_photos").select("*").eq("user_id", user.id).order("position"),
      supabase.from("profiles").select("bio, activity_visibility").eq("id", user.id).single(),
      supabase.from("follows").select("id", { count: "exact" }).eq("following_id", user.id).eq("status", "active"),
      supabase.from("follows").select("id", { count: "exact" }).eq("follower_id", user.id).eq("status", "active"),
      supabase.from("follows").select("*, follower:profiles!follower_id(id, name, avatar_url)").eq("following_id", user.id).eq("status", "pending"),
      supabase.from("venue_staff").select("venue:venues(*)").eq("user_id", user.id),
    ]);
    setCreatedEvents(created.data || []);
    setAttendingEvents((attending.data || []).map((r) => r.events).filter(Boolean));
    setInterestedEvents((interested.data || []).map((r) => r.events).filter(Boolean));
    setPhotos(photosRes.data || []);
    setBio(profileRes.data?.bio || "");
    setBioText(profileRes.data?.bio || "");
    setVisibility(profileRes.data?.activity_visibility || "public");
    setFollowerCount(followersRes.count || 0);
    setFollowingCount(followingRes.count || 0);
    setPendingFollows(pendingRes.data || []);
    setUserVenues((venuesRes.data || []).map((d) => d.venue).filter(Boolean));
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

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

  const handleBioSave = async () => {
    await supabase.from("profiles").update({ bio: bioText }).eq("id", user.id);
    setBio(bioText);
    setEditingBio(false);
  };

  const handleVisibilityChange = async (val) => {
    setVisibility(val);
    await supabase.from("profiles").update({ activity_visibility: val }).eq("id", user.id);
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || photos.length >= 6) return;
    setPhotoUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `${user.id}/photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const url = await uploadImage(file, path);
      await supabase.from("profile_photos").insert({ user_id: user.id, image_url: url, position: photos.length });
      loadData();
    } catch (err) {
      console.error("Photo upload error:", err);
    }
    setPhotoUploading(false);
    if (photoFileRef.current) photoFileRef.current.value = "";
  };

  const handlePhotoDelete = async (photoId) => {
    await supabase.from("profile_photos").delete().eq("id", photoId);
    loadData();
  };

  const handleFollowAction = async (followerId, action) => {
    await supabase.rpc("handle_follow_request", { p_follower_id: followerId, p_action: action });
    loadData();
  };

  if (!user) { onNavigate("login"); return null; }
  if (loading) return <div className="loading">{t("profile.loading")}</div>;

  const tabEvents = activeTab === "going" ? attendingEvents : activeTab === "interested" ? interestedEvents : activeTab === "created" ? createdEvents : null;

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
          <h2>
            {user.name}
            {user.is_plus && <span className="profile-plus-badge">{t("plus.badge")}</span>}
          </h2>
          <p>{user.email}</p>

          {/* Bio */}
          {editingBio ? (
            <div className="profile-bio-edit">
              <textarea value={bioText} onChange={(e) => setBioText(e.target.value)} placeholder={t("profile.bioPlaceholder")} maxLength={300} />
              <div className="bio-actions">
                <button className="btn btn-primary btn-sm" onClick={handleBioSave}>{t("profile.bioSave")}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditingBio(false); setBioText(bio); }}>{t("detail.cancel")}</button>
              </div>
            </div>
          ) : (
            <p className="profile-bio" style={{ cursor: "pointer" }} onClick={() => setEditingBio(true)}>
              {bio || <span style={{ color: "#bbb" }}>{t("profile.bioPlaceholder")}</span>}
            </p>
          )}

          <div className="profile-stats">
            <div className="profile-stat-item">
              <span className="profile-stat-number">{createdEvents.length}</span>
              <span className="profile-stat-label">{t("profile.stats.created")}</span>
            </div>
            <div className="profile-stat-item">
              <span className="profile-stat-number">{attendingEvents.length}</span>
              <span className="profile-stat-label">{t("profile.stats.going")}</span>
            </div>
            <div className="profile-stat-item">
              <span className="profile-stat-number">{interestedEvents.length}</span>
              <span className="profile-stat-label">{t("profile.stats.interested")}</span>
            </div>
            <div className="profile-stat-item">
              <span className="profile-stat-number">{followerCount}</span>
              <span className="profile-stat-label">{t("profile.stats.followers")}</span>
            </div>
            <div className="profile-stat-item">
              <span className="profile-stat-number">{followingCount}</span>
              <span className="profile-stat-label">{t("profile.stats.following")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pending follow requests */}
      {pendingFollows.length > 0 && (
        <div className="follow-requests-section">
          <h3>{t("profile.followRequests")} ({pendingFollows.length})</h3>
          {pendingFollows.map((f) => (
            <div key={f.id} className="follow-request-item">
              <div className="follow-request-user" onClick={() => onNavigate("user-profile", { userId: f.follower.id })} style={{ cursor: "pointer" }}>
                <Avatar name={f.follower.name} avatarUrl={f.follower.avatar_url} size={32} />
                {f.follower.name}
              </div>
              <div className="follow-request-actions">
                <button className="btn btn-primary btn-sm" onClick={() => handleFollowAction(f.follower_id, "accept")}>{t("profile.acceptFollow")}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => handleFollowAction(f.follower_id, "deny")}>{t("profile.denyFollow")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Profile photos */}
      <div className="profile-photos-section">
        <h3>{t("profile.photos")}</h3>
        <div className="profile-photos-grid">
          {photos.map((p) => (
            <div key={p.id} className="profile-photo-item">
              <img src={p.image_url} alt="" />
              <button className="remove-btn" onClick={() => handlePhotoDelete(p.id)}>×</button>
            </div>
          ))}
          {photos.length < 6 && (
            <button className="add-photo-btn" onClick={() => photoFileRef.current?.click()} disabled={photoUploading}>
              {photoUploading ? <span>{t("form.uploading")}</span> : <><span>+</span>{t("form.addImage")}</>}
            </button>
          )}
        </div>
        <input ref={photoFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhotoUpload} />
      </div>

      {/* Privacy setting */}
      <div className="profile-privacy-section">
        <h3>{t("profile.activityVisibility")}</h3>
        <select value={visibility} onChange={(e) => handleVisibilityChange(e.target.value)}>
          <option value="public">{t("profile.visibility.public")}</option>
          <option value="followers">{t("profile.visibility.followers")}</option>
          <option value="private">{t("profile.visibility.private")}</option>
        </select>
      </div>

      {/* Organizer tools */}
      <div className="profile-organizer-section">
        <h3>{t("profile.organizerTools")}</h3>
        <div className="organizer-actions">
          <button className="btn btn-primary btn-sm" onClick={() => onNavigate("create-event")}>+ {t("nav.newEvent")}</button>
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("venue-register")}>+ {t("nav.registerVenue")}</button>
        </div>
        {createdEvents.length > 0 && (
          <div className="organizer-list">
            <h4>{t("profile.myEventsTab")} ({createdEvents.length})</h4>
            {createdEvents.slice(0, 5).map((e) => (
              <div key={e.id} className="organizer-list-item" onClick={() => onNavigate("event-detail", { eventId: e.id })}>
                <span>{e.title}</span>
                <button className="btn btn-secondary btn-sm" onClick={(ev) => { ev.stopPropagation(); onNavigate("edit-event", { eventId: e.id }); }}>{t("detail.edit")}</button>
              </div>
            ))}
          </div>
        )}
        {userVenues.length > 0 && (
          <div className="organizer-list">
            <h4>{t("nav.venues")} ({userVenues.length})</h4>
            {userVenues.map((v) => (
              <div key={v.id} className="organizer-list-item" onClick={() => onNavigate("venue-detail", { venueId: v.id })}>
                <span>{v.name}</span>
                <button className="btn btn-secondary btn-sm" onClick={(ev) => { ev.stopPropagation(); onNavigate("venue-manage", { venueId: v.id }); }}>{t("profile.manageVenue")}</button>
              </div>
            ))}
          </div>
        )}
        {createdEvents.length === 0 && userVenues.length === 0 && (
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 8 }}>{t("profile.getStarted")}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="profile-tabs">
        <div className="filter-tabs">
          <button className={`filter-tab${activeTab === "going" ? " active" : ""}`} onClick={() => setActiveTab("going")}>
            {t("profile.goingTab")} ({attendingEvents.length})
          </button>
          <button className={`filter-tab${activeTab === "interested" ? " active" : ""}`} onClick={() => setActiveTab("interested")}>
            {t("profile.interestedTab")} ({interestedEvents.length})
          </button>
          <button className={`filter-tab${activeTab === "created" ? " active" : ""}`} onClick={() => setActiveTab("created")}>
            {t("profile.myEventsTab")} ({createdEvents.length})
          </button>
          <button className={`filter-tab${activeTab === "friends" ? " active" : ""}`} onClick={() => setActiveTab("friends")}>
            {t("profile.friendsTab")}
          </button>
        </div>
      </div>

      {activeTab === "friends" ? (
        <FriendsActivityFeed user={user} onNavigate={onNavigate} />
      ) : (
        <div className="profile-section">
          {tabEvents && tabEvents.length > 0 ? (
            <div className="profile-events-grid">
              {tabEvents.map((e) => (
                <EventCard key={e.id} event={{ ...e, going_count: e.going_count || 0, interested_count: e.interested_count || 0, creator_name: activeTab === "created" ? user.name : (e.creator_name || "") }}
                  onClick={() => onNavigate("event-detail", { eventId: e.id })} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">
                {activeTab === "going" ? "🎟️" : activeTab === "interested" ? "💫" : "🎪"}
              </div>
              <p>{activeTab === "going" ? t("profile.noAttending") : activeTab === "interested" ? t("profile.noInterested") : t("profile.noEvents")}</p>
              <button className="btn btn-primary" onClick={() => onNavigate(activeTab === "created" ? "create-event" : "discover")}>
                {activeTab === "going" ? t("profile.findEvents") : activeTab === "interested" ? t("profile.discoverEvents") : t("profile.createFirst")}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="profile-prefs-collapsible">
        <button className="profile-prefs-toggle" onClick={() => setPrefsOpen(!prefsOpen)}>
          <span>{t("prefs.title")}</span>
          <span className={`profile-prefs-toggle-icon${prefsOpen ? " open" : ""}`}>▼</span>
        </button>
        {prefsOpen && <NotificationPreferences user={user} />}
      </div>

      <button className="btn btn-secondary btn-full" style={{ marginTop: 24 }} onClick={async () => {
        await supabase.auth.signOut();
        onNavigate("discover");
        window.location.reload();
      }}>
        {t("profile.logout")}
      </button>
    </div>
  );
}

// ============================================================
// VENUE CARD
// ============================================================

function VenueCard({ venue, onClick }) {
  const { t } = useI18n();
  return (
    <div className="venue-card" onClick={onClick}>
      {venue.image_url ? (
        <img className="venue-card-image" src={venue.image_url} alt={venue.name} />
      ) : (
        <div className="venue-card-image-placeholder">🏢</div>
      )}
      <div className="venue-card-body">
        <h3>
          {venue.name}
          {venue.verified && <span className="venue-badge verified">{t("venue.verified")}</span>}
        </h3>
        <p>{venue.address}</p>
      </div>
    </div>
  );
}

// ============================================================
// VENUES PAGE
// ============================================================

function VenuesPage({ user, onNavigate }) {
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

// ============================================================
// VENUE DETAIL PAGE
// ============================================================

function VenueDetailPage({ venueId, user, onNavigate }) {
  const { t, lang } = useI18n();
  const [venue, setVenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [purchaseTimeslot, setPurchaseTimeslot] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  const loadVenue = useCallback(() => {
    supabase.rpc("get_venue_detail", { p_venue_id: venueId }).then(({ data }) => {
      setVenue(data);
      // Auto-select first available date
      if (data && data.timeslots && data.timeslots.length > 0) {
        const dates = [...new Set(data.timeslots.map((ts) => ts.date))].sort();
        setSelectedDate((prev) => prev && dates.includes(prev) ? prev : dates[0]);
      }
      setLoading(false);
    });
  }, [venueId]);

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
        </h1>
        <div className="venue-detail-meta">
          <span>📍 {venue.address}</span>
          {venue.opening_hours && <span>🕐 {venue.opening_hours}</span>}
          {venue.contact_email && <span>✉️ {venue.contact_email}</span>}
          {venue.contact_phone && <span>📞 {venue.contact_phone}</span>}
        </div>
        {venue.description && <p>{venue.description}</p>}
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
        />
      )}
    </div>
  );
}

// ============================================================
// PURCHASE MODAL
// ============================================================

function PurchaseModal({ timeslot, venue, user, onClose, onSuccess }) {
  const { t, lang } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const formatPrice = (ore) => ore === 0 ? "Gratis" : `${(ore / 100).toFixed(0)} kr`;

  const handlePurchase = async () => {
    setSubmitting(true);
    setError("");
    const { data, error: err } = await supabase.rpc("purchase_timeslot", { p_timeslot_id: timeslot.id });
    setSubmitting(false);
    if (err) { setError(err.message); return; }
    if (data.status === "error") {
      setError(data.code === "already_booked" ? t("booking.alreadyBooked") : data.code === "sold_out" ? t("timeslot.soldOut") : data.code);
      return;
    }
    setResult(data);
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
            <div className="mock-payment-badge">
              ⚠️ {t("booking.mockPayment")} — {t("booking.mockPaymentDesc")}
            </div>
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handlePurchase} disabled={submitting}>
              {submitting ? t("loading") : `${t("booking.confirm")} — ${formatPrice(timeslot.price)}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// VENUE REGISTER PAGE
// ============================================================

function VenueRegisterPage({ user, onNavigate }) {
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

    // Use geo from autocomplete selection, or fall back to geocoding
    const resolvedGeo = geo || await geocodeAddress(form.address, lang);

    const { data, error: err } = await supabase.from("venues").insert({
      name: form.name, description: form.description, address: form.address,
      opening_hours: form.opening_hours, contact_email: form.contact_email,
      contact_phone: form.contact_phone, image_url,
      latitude: resolvedGeo ? resolvedGeo.lat : null, longitude: resolvedGeo ? resolvedGeo.lng : null,
      owner_id: user.id,
    }).select().single();

    if (err) { setError(err.message); setSubmitting(false); return; }

    // Add owner as staff
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

// ============================================================
// VENUE MANAGE PAGE (DASHBOARD)
// ============================================================

function VenueManagePage({ venueId, user, onNavigate }) {
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

  const loadDashboard = useCallback(() => {
    supabase.rpc("get_venue_dashboard", { p_venue_id: venueId }).then(({ data }) => {
      setDashboard(data);
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

// ============================================================
// VENUE SCANNER PAGE
// ============================================================

function VenueScannerPage({ venueId, user, onNavigate }) {
  const { t } = useI18n();
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [checkinDone, setCheckinDone] = useState(false);
  const [scannerError, setScannerError] = useState(null);
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);

  const handleScan = async (decodedText) => {
    try {
      const url = new URL(decodedText);
      const tokenParam = url.searchParams.get("token");
      if (!tokenParam) { setScanResult({ status: "error", code: "invalid_ticket" }); return; }

      const { data } = await supabase.rpc("verify_queue_ticket", { p_venue_id: venueId, p_qr_token: tokenParam });
      setScanResult(data);
      setCheckinDone(false);
      // Stop scanning after reading
      if (html5QrRef.current) {
        try { await html5QrRef.current.stop(); } catch {}
        html5QrRef.current = null;
      }
      setScanning(false);
    } catch {
      setScanResult({ status: "error", code: "invalid_ticket" });
    }
  };

  const startScanning = async () => {
    if (!scannerRef.current) return;
    setScanResult(null);
    setCheckinDone(false);
    setScannerError(null);
    const html5Qr = new Html5Qrcode(scannerRef.current.id);
    html5QrRef.current = html5Qr;
    try {
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => { handleScan(decodedText); },
        () => {}
      );
      setScanning(true);
    } catch (err) {
      console.error("Scanner error:", err);
      html5QrRef.current = null;
      if (err?.toString().includes("NotAllowedError") || err?.toString().includes("Permission")) {
        setScannerError(t("scanner.cameraPermission"));
      } else if (err?.toString().includes("NotFoundError") || err?.toString().includes("no camera")) {
        setScannerError(t("scanner.noCamera"));
      } else {
        setScannerError(t("scanner.cameraError"));
      }
    }
  };

  const stopScanning = async () => {
    if (html5QrRef.current) {
      try { await html5QrRef.current.stop(); } catch {}
      html5QrRef.current = null;
    }
    setScanning(false);
  };

  const handleCheckin = async () => {
    if (!scanResult || !scanResult.booking_id) return;
    const { data } = await supabase.rpc("checkin_queue_ticket", { p_booking_id: scanResult.booking_id });
    if (data && data.status === "success") {
      setCheckinDone(true);
    } else if (data && data.code === "already_checked_in") {
      setCheckinDone(true);
    }
  };

  useEffect(() => {
    return () => {
      if (html5QrRef.current) {
        try { html5QrRef.current.stop(); } catch {}
      }
    };
  }, []);

  return (
    <div className="venue-scanner">
      <button className="back-button" onClick={() => onNavigate("venue-manage", { venueId })}>{t("detail.back")}</button>
      <h1>{t("scanner.title")}</h1>

      <div ref={scannerRef} id="venue-qr-reader" style={{ marginBottom: 16 }} />

      {scannerError && (
        <div className="scan-result-card invalid" style={{ marginBottom: 16 }}>
          <div className="scan-result-status error">{scannerError}</div>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>{t("scanner.cameraHint")}</p>
        </div>
      )}

      {!scanning ? (
        <button className="btn btn-primary" onClick={startScanning}>{t("scanner.scan")}</button>
      ) : (
        <button className="btn btn-secondary" onClick={stopScanning}>{t("scanner.stop")}</button>
      )}

      {scanResult && scanResult.status === "success" && !checkinDone && (
        <div className="scan-result-card valid">
          <div className="scan-result-status success">✓ {t("scanner.verify")}</div>
          <p><strong>{t("scanner.guestName")}:</strong> {scanResult.user_name}</p>
          <p><strong>{t("scanner.timeslot")}:</strong> {scanResult.date} {scanResult.start_time?.slice(0, 5)}–{scanResult.end_time?.slice(0, 5)}</p>
          <p><strong>{t("scanner.status")}:</strong> {scanResult.booking_status === "checked_in" ? t("scanner.alreadyCheckedIn") : scanResult.booking_status}</p>
          {scanResult.booking_status === "confirmed" && (
            <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={handleCheckin}>
              {t("scanner.confirmCheckin")}
            </button>
          )}
          {scanResult.booking_status === "checked_in" && (
            <div className="scan-result-status warning" style={{ marginTop: 12 }}>⚠️ {t("scanner.alreadyCheckedIn")}</div>
          )}
        </div>
      )}

      {scanResult && scanResult.status === "success" && checkinDone && (
        <div className="scan-result-card valid">
          <div className="scan-result-status success">✓ {t("scanner.success")}</div>
          <p><strong>{scanResult.user_name}</strong></p>
          <button className="btn btn-primary" style={{ marginTop: 16, width: "100%" }} onClick={() => { setScanResult(null); setCheckinDone(false); }}>
            {t("scanner.scan")}
          </button>
        </div>
      )}

      {scanResult && scanResult.status === "error" && (
        <div className="scan-result-card invalid">
          <div className="scan-result-status error">✗ {scanResult.code === "not_staff" ? t("scanner.notStaff") : t("scanner.invalidTicket")}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// MY TICKETS PAGE
// ============================================================

function MyTicketsPage({ user, onNavigate }) {
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
    navigate("discover");
  };

  if (loading) return <div className="loading">{t("loading")}</div>;

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      <div>
        <Navbar user={user} currentPage={page} onNavigate={navigate} onLogout={logout} />

        {page === "discover" && <DiscoverPage user={user} onNavigate={navigate} />}
        {page === "search" && <SearchBrowsePage onNavigate={navigate} initialView={pageData.view} />}
        {page === "event-detail" && <EventDetailPage eventId={pageData.eventId} user={user} onNavigate={navigate} />}
        {page === "checkin" && <CheckinPage eventId={pageData.eventId} user={user} onNavigate={navigate} />}
        {page === "create-event" && <EventFormPage user={user} onNavigate={navigate} />}
        {page === "edit-event" && <EventFormPage eventId={pageData.eventId} user={user} onNavigate={navigate} />}
        {page === "login" && <LoginPage onNavigate={navigate} />}
        {page === "register" && <RegisterPage onNavigate={navigate} />}
        {page === "profile" && <ProfilePage user={user} onNavigate={navigate} onAvatarChange={(url) => setUser({ ...user, avatar_url: url })} />}
        {page === "friends" && <FriendsActivityPage user={user} onNavigate={navigate} />}
        {page === "user-profile" && <UserProfilePage userId={pageData.userId} user={user} onNavigate={navigate} />}
        {page === "venues" && <VenuesPage user={user} onNavigate={navigate} />}
        {page === "venue-detail" && <VenueDetailPage venueId={pageData.venueId} user={user} onNavigate={navigate} />}
        {page === "venue-register" && <VenueRegisterPage user={user} onNavigate={navigate} />}
        {page === "venue-manage" && <VenueManagePage venueId={pageData.venueId} user={user} onNavigate={navigate} />}
        {page === "venue-scan" && <VenueScannerPage venueId={pageData.venueId} user={user} onNavigate={navigate} />}
        {page === "my-tickets" && <MyTicketsPage user={user} onNavigate={navigate} />}

        <BottomTabBar user={user} currentPage={page} onNavigate={navigate} />
      </div>
    </I18nContext.Provider>
  );
}
