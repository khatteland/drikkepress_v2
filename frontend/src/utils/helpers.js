import { supabase } from "../lib/supabase";

export function formatDate(dateStr, lang) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const locale = lang === "no" ? "nb-NO" : "en-US";
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function formatShortDate(dateStr, lang) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const locale = lang === "no" ? "nb-NO" : "en-US";
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

export function timeAgo(isoStr, lang) {
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

export async function uploadImage(file, path) {
  const { error } = await supabase.storage.from("media").upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

export async function geocodeAddress(address, lang) {
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

export function generateSlots(from, to, durationMin) {
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
