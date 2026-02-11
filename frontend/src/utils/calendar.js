export function generateGoogleCalendarUrl(event) {
  const startDate = event.date.replace(/-/g, "");
  const startTime = (event.time || "00:00").replace(/:/g, "").slice(0, 4) + "00";
  let endTime;
  if (event.end_time) {
    endTime = event.end_time.replace(/:/g, "").slice(0, 4) + "00";
  } else {
    const h = parseInt(startTime.slice(0, 2)) + 2;
    endTime = String(h).padStart(2, "0") + startTime.slice(2);
  }
  let endDateStr = startDate;
  if (event.end_date) {
    endDateStr = event.end_date.replace(/-/g, "");
  } else if (event.end_time && event.end_time < event.time) {
    const d = new Date(event.date + "T00:00:00");
    d.setDate(d.getDate() + 1);
    endDateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  const dates = `${startDate}T${startTime}/${endDateStr}T${endTime}`;
  const location = event.event_mode === "online" ? (event.online_url || "") : (event.location || "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates,
    location,
    details: event.description || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function generateIcsFile(event) {
  const startDate = event.date.replace(/-/g, "");
  const startTime = (event.time || "00:00").replace(/:/g, "").slice(0, 4) + "00";
  let endTime;
  if (event.end_time) {
    endTime = event.end_time.replace(/:/g, "").slice(0, 4) + "00";
  } else {
    const h = parseInt(startTime.slice(0, 2)) + 2;
    endTime = String(h).padStart(2, "0") + startTime.slice(2);
  }
  let endDateStr = startDate;
  if (event.end_date) {
    endDateStr = event.end_date.replace(/-/g, "");
  } else if (event.end_time && event.end_time < event.time) {
    const d = new Date(event.date + "T00:00:00");
    d.setDate(d.getDate() + 1);
    endDateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  }
  const location = event.event_mode === "online" ? (event.online_url || "") : (event.location || "");
  const uid = `${event.id}-${startDate}@hapn`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hapn//Event//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${startDate}T${startTime}`,
    `DTEND:${endDateStr}T${endTime}`,
    `SUMMARY:${event.title}`,
    `LOCATION:${location}`,
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
