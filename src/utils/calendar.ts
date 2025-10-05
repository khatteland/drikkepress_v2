
export function googleCalendarUrl({ title, details, location, start, end }:
  { title:string; details?:string; location?:string; start:Date; end:Date }) {
  const fmt = (d:Date) => d.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z'
  const params = new URLSearchParams({action:'TEMPLATE',text:title,details:details||'',location:location||'',dates:`${fmt(start)}/${fmt(end)}`})
  return `https://www.google.com/calendar/render?${params.toString()}`
}
export function icsFile({ title, description, location, start, end }:
  { title:string; description?:string; location?:string; start:Date; end:Date }) {
  const dt = (d:Date) => d.toISOString().replace(/[-:]/g,'').split('.')[0]+'Z'
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//drikkepress//events//NO','BEGIN:VEVENT',`UID:${crypto.randomUUID()}@drikkepress.com`,
  `DTSTAMP:${dt(new Date())}`,`DTSTART:${dt(start)}`,`DTEND:${dt(end)}`,`SUMMARY:${escapeICal(title)}`,
  description?`DESCRIPTION:${escapeICal(description)}`:'',location?`LOCATION:${escapeICal(location)}`:'','END:VEVENT','END:VCALENDAR'].filter(Boolean).join('\r\n')
}
function escapeICal(t:string){return t.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;')}
