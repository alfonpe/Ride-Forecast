import { simplify } from "./share.js";
import { rad } from "./util.js";

/* ---------- drinking water, cafés and shops near the route, from OpenStreetMap (Overpass API) ----------
   One query along a simplified copy of the route, in the background; if both servers are busy the
   feature quietly stays off. Results are placed on whichever direction/start is being ridden. */

const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
export const POI = { water: "Drinking water", cafe: "Café or bakery", shop: "Shop or petrol station" };

export function poiKind(t = {}) {
  const a = t.amenity, s = t.shop;
  if (a === "drinking_water" || a === "water_point") return "water";
  if ((a === "fountain" || t.man_made === "water_tap") && t.drinking_water === "yes") return "water";
  if (a === "cafe" || s === "bakery") return "cafe";
  if (s === "convenience" || a === "fuel") return "shop";
  return null;
}

// Water/cafés/shops within `radius` of the route line (simplified to ≤ ~300 vertices). Exact tag filters only:
// a key-pattern filter makes the server scan every object in the area and time out on long routes.
export function overpassQuery(pts, radius = 150) {
  const flat = pts.map(p => ({ lat: p.lat, lon: p.lon, ele: 0 }));
  let tol = 30, l = simplify(flat, tol, 1e9);
  while (l.length > 300) { tol *= 1.6; l = simplify(flat, tol, 1e9); }
  const near = `around:${radius},${l.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(",")}`;
  return `[out:json][timeout:25];(nwr(${near})[amenity~"^(drinking_water|water_point|fountain|cafe|fuel)$"];` +
    `nwr(${near})[shop~"^(bakery|convenience)$"];node(${near})[man_made=water_tap];);out center tags qt;`;
}

export function parsePOIs(elements) {
  return elements.map(e => {
    const kind = poiKind(e.tags), lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
    return kind && isFinite(lat) && isFinite(lon) ? { kind, lat, lon, name: (e.tags.name || e.tags.brand || "").trim(), hours: e.tags.opening_hours || "" } : null;
  }).filter(Boolean);
}

// towns (with population where mapped) and named summits/passes, for the share card's reference labels
export function parseOverpass(elements) {
  const pos = e => ({ lat: e.lat ?? (e.center && e.center.lat), lon: e.lon ?? (e.center && e.center.lon) });
  const places = [], summits = [];
  for (const e of elements) {
    const t = e.tags || {}, p = pos(e);
    if (!t.name || !isFinite(p.lat) || !isFinite(p.lon)) continue;
    if (/^(city|town|village)$/.test(t.place)) places.push({ name: t.name, place: t.place, pop: parseInt(String(t.population || "").replace(/\D/g, ""), 10) || null, ...p });
    else if (/^(peak|saddle)$/.test(t.natural) || t.mountain_pass === "yes") summits.push({ name: t.name, ele: parseFloat(t.ele) || null, ...p });
  }
  return { pois: parsePOIs(elements), places, summits };
}

export async function fetchPOIs(pts, retryAfter = 20000) {
  const body = "data=" + encodeURIComponent(overpassQuery(pts));
  for (const url of OVERPASS) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 30000);
    try {
      // form-encoded POST is a "simple" request: no CORS preflight
      const r = await fetch(url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl.signal });
      if (r.ok) return parseOverpass((await r.json()).elements || []);
    } catch (e) { /* busy or offline: try the next server */ } finally { clearTimeout(timer); }
  }
  // public Overpass servers are often saturated for a minute or two: one more round, a little later
  if (retryAfter) { await new Promise(r => setTimeout(r, retryAfter)); return fetchPOIs(pts, 0); }
  return null;
}

// km along the track and distance off it; keeps places within `maxOff` m, one per kind per ~300 m
export function placePOIs(list, tr, maxOff = 200) {
  if (!list) return null;
  const P = tr.pts, step = Math.max(1, Math.floor(P.length / 4000)), out = [];
  for (const q of list) {
    // a place on a road ridden twice (out-and-back, shared start and finish) is passed twice: one entry per pass
    const k = Math.cos(rad(q.lat));
    let cur = null;
    const flush = () => { if (cur) out.push({ ...q, km: cur.km, off: cur.off }); cur = null; };
    for (let i = 0; i < P.length; i += step) {
      const off = Math.sqrt((P[i].lat - q.lat) ** 2 + ((P[i].lon - q.lon) * k) ** 2) * 111195;
      if (off > maxOff) continue;
      const km = tr.cum[i] / 1000;
      if (cur && km - cur.last > 1) flush();
      if (!cur || off < cur.off) cur = { km, off, last: km }; else cur.last = km;
    }
    flush();
  }
  out.sort((a, b) => a.km - b.km);
  // the same tap or café is often mapped twice: keep one, preferring the entry with a name
  const kept = [];
  for (const p of out) {
    const j = kept.findIndex(o => o.kind === p.kind && Math.abs(o.km - p.km) < 0.3);
    if (j < 0) kept.push(p); else if (!kept[j].name && p.name) kept[j] = p;
  }
  return kept;
}

// the longest stretch without drinking water, counting the start and finish as refill points
export function waterGap(pois, totalKm) {
  const marks = [0, ...pois.filter(p => p.kind === "water").map(p => p.km), totalKm];
  let g = { from: 0, to: 0, len: -1 };
  for (let i = 1; i < marks.length; i++) if (marks[i] - marks[i - 1] > g.len) g = { from: marks[i - 1], to: marks[i], len: marks[i] - marks[i - 1] };
  return g;
}
