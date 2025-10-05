
export const googleMapsUrl = (q:string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
export const appleMapsUrl = (q:string) => `http://maps.apple.com/?q=${encodeURIComponent(q)}`
