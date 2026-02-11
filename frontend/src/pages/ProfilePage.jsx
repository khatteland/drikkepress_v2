import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { uploadImage } from "../utils/helpers";
import { Avatar, NotificationPreferences } from "../components/shared";
import { EventCard } from "../components/EventCard";
import { FriendsActivityFeed } from "../components/FriendsActivityFeed";

export function ProfilePage({ user, onNavigate, onAvatarChange }) {
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
          <button className="btn btn-secondary btn-sm" onClick={() => onNavigate("venue-register")}>+ {t("venue.register")}</button>
        </div>
        {createdEvents.length > 0 && (
          <div className="organizer-list">
            <h4>{t("profile.myEventsTab")} ({createdEvents.length})</h4>
            {createdEvents.map((e) => (
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
