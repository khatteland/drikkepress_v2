import React from "react";
import { useI18n } from "../contexts/I18nContext";
import { FriendsActivityFeed } from "../components/FriendsActivityFeed";

export function FriendsActivityPage({ user, onNavigate }) {
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
