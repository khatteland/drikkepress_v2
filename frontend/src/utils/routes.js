export function parseUrl(pathname) {
  if (pathname === "/" || pathname === "") return { page: "discover", data: {} };
  if (pathname === "/discover") return { page: "discover", data: {} };
  if (pathname === "/search") return { page: "search", data: {} };
  if (pathname === "/events") return { page: "search", data: {} };
  if (pathname === "/map") return { page: "search", data: { view: "map" } };
  if (pathname === "/create") return { page: "create-event", data: {} };
  if (pathname === "/login") return { page: "login", data: {} };
  if (pathname === "/register") return { page: "register", data: {} };
  if (pathname === "/payment-callback") return { page: "payment-callback", data: {} };
  if (pathname === "/terms") return { page: "terms", data: {} };
  if (pathname === "/profile") return { page: "profile", data: {} };

  if (pathname === "/friends") return { page: "friends", data: {} };

  if (pathname === "/venues") return { page: "venues", data: {} };
  if (pathname === "/venue/register") return { page: "venue-register", data: {} };
  if (pathname === "/my-tickets") return { page: "my-tickets", data: {} };

  const eventMatch = pathname.match(/^\/event\/(\d+)$/);
  if (eventMatch) return { page: "event-detail", data: { eventId: parseInt(eventMatch[1]) } };

  const editMatch = pathname.match(/^\/event\/(\d+)\/edit$/);
  if (editMatch) return { page: "edit-event", data: { eventId: parseInt(editMatch[1]) } };

  const checkinMatch = pathname.match(/^\/event\/(\d+)\/checkin$/);
  if (checkinMatch) return { page: "checkin", data: { eventId: parseInt(checkinMatch[1]) } };

  const userMatch = pathname.match(/^\/user\/(.+)$/);
  if (userMatch) return { page: "user-profile", data: { userId: userMatch[1] } };

  const venueMatch = pathname.match(/^\/venue\/(\d+)$/);
  if (venueMatch) return { page: "venue-detail", data: { venueId: parseInt(venueMatch[1]) } };

  const venueManageMatch = pathname.match(/^\/venue\/(\d+)\/manage$/);
  if (venueManageMatch) return { page: "venue-manage", data: { venueId: parseInt(venueManageMatch[1]) } };

  const venueScanMatch = pathname.match(/^\/venue\/(\d+)\/scan$/);
  if (venueScanMatch) return { page: "venue-scan", data: { venueId: parseInt(venueScanMatch[1]) } };

  return { page: "discover", data: {} };
}

export function pageToUrl(page, data = {}) {
  switch (page) {
    case "discover": return "/discover";
    case "search": return data.view === "map" ? "/map" : "/search";
    case "event-detail": return `/event/${data.eventId}`;
    case "edit-event": return `/event/${data.eventId}/edit`;
    case "checkin": return `/event/${data.eventId}/checkin`;
    case "create-event": return "/create";
    case "login": return "/login";
    case "register": return "/register";
    case "profile": return "/profile";
    case "friends": return "/friends";
    case "user-profile": return `/user/${data.userId}`;
    case "venues": return "/venues";
    case "venue-detail": return `/venue/${data.venueId}`;
    case "venue-register": return "/venue/register";
    case "venue-manage": return `/venue/${data.venueId}/manage`;
    case "venue-scan": return `/venue/${data.venueId}/scan`;
    case "my-tickets": return "/my-tickets";
    case "payment-callback": return "/payment-callback";
    case "terms": return "/terms";
    default: return "/";
  }
}
