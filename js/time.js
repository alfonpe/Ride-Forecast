
/* ---------- time zones: the start time and all clock times are in the route's local zone ---------- */
export const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
// the route's IANA time zone; start time and all clock times use it
export const zone = { name: DEVICE_TZ };
export const dtfCache = new Map();
export function tzParts(ms, tz = zone.name) {
  let f = dtfCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }); dtfCache.set(tz, f); }
  const p = {}; f.formatToParts(ms).forEach(x => p[x.type] = x.value); return p;
}
export const tzOffset = (ms, tz = zone.name) => { const p = tzParts(ms, tz); return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; };
export function wallToMs(str, tz = zone.name) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(str || ""); if (!m) return NaN;
  const g = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]);
  return g - tzOffset(g - tzOffset(g, tz), tz);
}
export const msToWall = (ms, tz = zone.name) => { const p = tzParts(ms, tz); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };

/* ---------- weather ---------- */
export const isoDay = ms => new Date(ms).toISOString().slice(0, 10);

/* ---------- formatting (always in the route's time zone) ---------- */
export const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: zone.name });
export const fmtDay = ms => new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", timeZone: zone.name });
export const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return m === 60 ? (h + 1) + "h 00" : h + "h " + String(m).padStart(2, "0"); };

export function nextSaturday8() {
  const d = new Date(); d.setSeconds(0, 0);
  const add = (6 - d.getDay() + 7) % 7 || (d.getHours() < 8 ? 0 : 7);
  d.setDate(d.getDate() + add); d.setHours(8, 0);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
