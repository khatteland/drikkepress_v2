import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { Avatar } from "../components/shared";
import { EventCard } from "../components/EventCard";

export function UserProfilePage({ userId, user, onNavigate }) {
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
