import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useI18n } from "../contexts/I18nContext";
import { formatShortDate } from "../utils/helpers";
import { Avatar } from "./shared";

export function FriendsActivityFeed({ user, onNavigate }) {
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
