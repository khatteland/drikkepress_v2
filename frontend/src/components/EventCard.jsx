import React from "react";
import { useI18n } from "../contexts/I18nContext";
import { formatDate, formatShortDate } from "../utils/helpers";
import { Avatar } from "./shared";

export function EventCard({ event, onClick }) {
  const { t, lang } = useI18n();
  const friendCount = event.friend_count || 0;
  const otherCount = Math.max(0, (event.going_count || 0) - friendCount);
  const friendAvatars = event.friend_preview || [];
  const isMultiDay = event.end_date && event.end_date !== event.date;
  const isOverMidnight = !event.end_date && event.end_time && event.time && event.end_time < event.time;

  return (
    <div className="event-card" onClick={onClick}>
      {event.image_url && <img className="event-card-image" src={event.image_url} alt={event.title} />}
      <div className="event-card-body">
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          <span className="event-card-title" style={{ marginBottom: 0 }}>{event.title}</span>
          {event.event_mode === "online" && <span className="event-mode-badge online">{t("events.online")}</span>}
          {event.event_mode === "hybrid" && <span className="event-mode-badge hybrid">{t("events.hybrid")}</span>}
        </div>
        <div className="event-card-meta">
          <span>
            {isMultiDay
              ? <span className="event-date-range">{formatShortDate(event.date, lang)} – {formatShortDate(event.end_date, lang)}</span>
              : formatDate(event.date, lang)
            }
          </span>
          <span>
            {event.time?.slice(0, 5)}{event.end_time ? ` – ${event.end_time.slice(0, 5)}` : ""}
            {isOverMidnight && <span className="event-mode-badge next-day">{t("events.endsNextDay")}</span>}
            {event.event_mode === "online"
              ? <> · {t("events.online")}</>
              : event.event_mode === "hybrid"
                ? <> · {event.location} · {t("events.online")}</>
                : event.location ? <> · {event.location}</> : ""
            }
          </span>
        </div>
        <div className="event-card-footer">
          {friendCount > 0 ? (
            <div className="event-card-friends">
              {friendAvatars.length > 0 && (
                <div className="avatar-stack">
                  {friendAvatars.slice(0, 3).map((a, i) => (
                    <Avatar key={i} name={a.name} avatarUrl={a.avatar_url} size={22} />
                  ))}
                </div>
              )}
              <span>
                <strong>{friendCount}</strong> {t("events.friendsGoing")}
                {otherCount > 0 && <> + <strong>{otherCount}</strong> {t("events.others")}</>}
              </span>
            </div>
          ) : (
            <div className="event-card-attendees">
              <strong>{event.going_count || 0}</strong> {t("events.attending")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VenueCard({ venue, onClick }) {
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
