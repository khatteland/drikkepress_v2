import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { timeAgo, uploadImage } from "../utils/helpers";

// ============================================================
// ADDRESS AUTOCOMPLETE
// ============================================================

export function AddressAutocomplete({ value, onChange, onSelect, placeholder, lang }) {
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
// LANGUAGE PICKER
// ============================================================

export function LanguagePicker() {
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

export function MultiImageUpload({ images, onImagesChange, userId }) {
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

export function ImageGallery({ images }) {
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

export function Avatar({ name, avatarUrl, size = 24, className = "avatar" }) {
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
// NOTIFICATION BELL (with debounced realtime callback)
// ============================================================

export function NotificationBell({ user, onNavigate }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const bellRef = useRef(null);
  const debounceRef = useRef(null);

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

  // Realtime subscription (debounced)
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => { loadNotifications(); }, 500);
        }
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
    } else if (notif.type === "venue_new_timeslot") {
      onNavigate("venue-detail", { venueId: notif.venue_id });
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
      case "venue_new_timeslot": return <><strong>{notif.message}</strong> {t("notif.venue_new_timeslot")}</>;
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

export function NotificationPreferences({ user }) {
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

export function BottomTabBar({ user, currentPage, onNavigate }) {
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

// ============================================================
// NOTIFICATION DROPDOWN (shared by BottomTabBar and NotificationBell)
// ============================================================

export function NotificationDropdown({ notifications, unreadCount, onNavigate, onMarkAllRead, onRefresh }) {
  const { t, lang } = useI18n();

  const handleClick = async (notif) => {
    if (!notif.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", notif.id);
    }
    if (notif.type === "follow_request" || notif.type === "follow_accepted") {
      onNavigate("user-profile", { userId: notif.actor_id });
    } else if (notif.type === "booking_confirmed" || notif.type === "booking_cancelled") {
      onNavigate("my-tickets");
    } else if (notif.type === "venue_new_timeslot") {
      onNavigate("venue-detail", { venueId: notif.venue_id });
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
      case "venue_new_timeslot": return <><strong>{notif.message}</strong> {t("notif.venue_new_timeslot")}</>;
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

export function Footer({ onNavigate }) {
  const { t } = useI18n();
  return (
    <footer className="site-footer">
      <div className="footer-content">
        <div className="footer-company">
          <strong>Hatteland AS</strong>
          <span>Org.nr: 928 256 545</span>
          <span>Herslebs gate 17 B, 0561 Oslo</span>
          <span><a href="mailto:kristian.hatteland@gmail.com">kristian.hatteland@gmail.com</a></span>
        </div>
        <div className="footer-links">
          <button className="link-button" onClick={() => onNavigate("terms")}>{t("footer.terms")}</button>
        </div>
      </div>
    </footer>
  );
}

export function Navbar({ user, currentPage, onNavigate, onLogout }) {
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
