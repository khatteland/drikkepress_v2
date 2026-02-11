import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { supabase } from "./lib/supabase";
import { translations } from "./translations";
import { I18nContext } from "./contexts/I18nContext";
import { parseUrl, pageToUrl } from "./utils/routes";
import { Navbar, BottomTabBar } from "./components/shared";

// Lazy-loaded pages (code splitting)
const DiscoverPage = lazy(() => import("./pages/DiscoverPage").then(m => ({ default: m.DiscoverPage })));
const SearchBrowsePage = lazy(() => import("./pages/SearchBrowsePage"));
const EventDetailPage = lazy(() => import("./pages/EventDetailPage").then(m => ({ default: m.EventDetailPage })));
const CheckinPage = lazy(() => import("./pages/CheckinPage").then(m => ({ default: m.CheckinPage })));
const EventFormPage = lazy(() => import("./pages/EventFormPage").then(m => ({ default: m.EventFormPage })));
const LoginPage = lazy(() => import("./pages/AuthPages").then(m => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("./pages/AuthPages").then(m => ({ default: m.RegisterPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then(m => ({ default: m.ProfilePage })));
const FriendsActivityPage = lazy(() => import("./pages/FriendsActivityPage").then(m => ({ default: m.FriendsActivityPage })));
const UserProfilePage = lazy(() => import("./pages/UserProfilePage").then(m => ({ default: m.UserProfilePage })));
const VenuesPage = lazy(() => import("./pages/VenuesPage").then(m => ({ default: m.VenuesPage })));
const VenueDetailPage = lazy(() => import("./pages/VenueDetailPage").then(m => ({ default: m.VenueDetailPage })));
const VenueRegisterPage = lazy(() => import("./pages/VenueRegisterPage").then(m => ({ default: m.VenueRegisterPage })));
const VenueManagePage = lazy(() => import("./pages/VenueManagePage").then(m => ({ default: m.VenueManagePage })));
const VenueScannerPage = lazy(() => import("./pages/VenueScannerPage").then(m => ({ default: m.VenueScannerPage })));
const MyTicketsPage = lazy(() => import("./pages/MyTicketsPage").then(m => ({ default: m.MyTicketsPage })));

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

        <Suspense fallback={<div className="loading">{t("loading")}</div>}>
          {page === "discover" && <DiscoverPage user={user} onNavigate={navigate} />}
          {page === "search" && <SearchBrowsePage user={user} onNavigate={navigate} initialView={pageData.view} />}
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
        </Suspense>

        <BottomTabBar user={user} currentPage={page} onNavigate={navigate} />
      </div>
    </I18nContext.Provider>
  );
}
