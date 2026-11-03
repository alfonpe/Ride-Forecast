import { locate, routeKey } from "./geo.js";
import { fetchJSON, store, stored } from "./net.js";
import { overpass, parseOverpass } from "./pois.js";
import { simplify } from "./share.js";

/* ---------- town and pass names for the share card (Photon, OpenStreetMap-based search) ----------
   A few small "what's near here" lookups along the route are faster and far more reliable than one big
   Overpass query: every 14 km, the cities, towns and villages within 12 km, two at a time (it's a free shared
   service); around the high point, passes and peaks. Photon returns no population, so size is judged by kind (city > town > village). */

const PHOTON = "https://photon.komoot.io/reverse";
const KINDS = "&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village";

// "Nàquera / Náquera" → "Nàquera": bilingual names are too long for a label
const short = n => n.split(" / ")[0].trim();

export function photonFeatures(json, keep = () => true) {
  return ((json && json.features) || []).map(f => {
    const p = f.properties || {}, [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    return p.name && isFinite(lat) && isFinite(lon) && keep(p) ? { name: short(p.name), place: p.osm_value, key: p.osm_key, pop: null, lat, lon } : null;
  }).filter(Boolean);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

// Calls onUpdate as each answer arrives (the card redraws progressively). Each lookup gives up after 8 s and
// the whole job after `capMs`; whatever arrived is used. Results are kept on the device for 30 days: a complete
// one is reused as is, a partial one is shown at once and completed in the background.
// Overpass version of the same lookup: towns within 5 km of the road (with population, so the biggest is known),
// road passes within 2 km and peaks/saddles within 600 m, along a simplified line
export function overpassPlacesQuery(pts) {
  const flat = pts.map(p => ({ lat: p.lat, lon: p.lon, ele: 0 }));
  let tol = 80, l = simplify(flat, tol, 1e9);
  while (l.length > 150) { tol *= 1.6; l = simplify(flat, tol, 1e9); }
  const line = l.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(",");
  return `[out:json][timeout:25];(node(around:5000,${line})[place~"^(city|town|village)$"][name];` +
    `node(around:2000,${line})[mountain_pass=yes][name];node(around:600,${line})[natural~"^(peak|saddle)$"][name];);out tags qt;`;
}

export async function fetchPlaces(tr, onUpdate = () => {}, { capMs = 12000, eleReady = null } = {}) {
  const id = routeKey(tr), hit = stored("rf-places", 30), had = hit && hit.id === id ? hit.res : null;
  if (had) { onUpdate(had); if (!had.partial) return had; } // shown at once; a partial one is completed below
  const at = [];
  // every 14 km, 12 km around: any town within 5 km of the road is within 7 + 5 km of a lookup point
  for (let m = 0; m < tr.total; m += 14000) at.push(locate(tr, m, null));
  at.push(locate(tr, tr.total, null));
  const seen = new Set(), places = had ? had.places.slice() : [];
  for (const q of places) seen.add(`${q.name}|${q.lat.toFixed(2)}|${q.lon.toFixed(2)}`);
  let summits = had ? had.summits : [], answered = 0, failed = 0, complete = false, finished = false, result = null;
  const get = url => fetchJSON(url, { timeout: 8000, what: "The place-name service", retries: 1 }).then(j => { answered++; return j; }, () => { failed++; return null; });
  const update = () => onUpdate({ places: places.slice(), summits });
  const keep = () => { if (result && !result.partial || places.length > (had ? had.places.length : 0)) store("rf-places", { id, res: { places: places.slice(), summits, partial: !result || result.partial } }); };
  const towns = pool(at, 3, p => get(`${PHOTON}?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&radius=12&limit=20${KINDS}`).then(r => {
    for (const q of photonFeatures(r, f => f.osm_key === "place")) {
      const k = `${q.name}|${q.lat.toFixed(2)}|${q.lon.toFixed(2)}`;
      if (!seen.has(k)) { seen.add(k); places.push(q); }
    }
    if (r) update();
  }));
  // the summit's pass name is a bonus: it updates the card whenever it lands and never holds up "done"
  (async () => {
    await eleReady;
    if (!tr.hasEle) return;
    let hi = 0;
    for (let i = 1; i < tr.ele.length; i++) if (tr.ele[i] > tr.ele[hi]) hi = i;
    const p = tr.pts[hi];
    const r = await get(`${PHOTON}?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&radius=8&limit=25&osm_tag=natural:peak&osm_tag=natural:saddle&osm_tag=mountain_pass`);
    if (!r) return;
    summits = photonFeatures(r, q => q.osm_key === "natural" || q.osm_key === "mountain_pass")
      .map(q => ({ ...q, kind: q.key === "mountain_pass" || q.place === "saddle" ? "pass" : "peak" }));
    update();
    if (finished) keep();
  })();
  await Promise.race([towns.then(() => { complete = true; }), new Promise(r => setTimeout(r, capMs))]);
  // Photon can be unreachable from some browsers (blocked by a privacy extension, or throttled): ask Overpass instead
  if (!places.length) {
    const els = await overpass(overpassPlacesQuery(tr.pts), 25000);
    if (els) {
      const r = parseOverpass(els);
      places.push(...r.places);
      if (r.summits.length) summits = r.summits;
      answered++; complete = true; failed = 0;
      update();
    }
  }
  finished = true;
  if (!answered && !had) return null;
  result = { places: places.slice(), summits, partial: !complete || failed > 0 };
  keep();
  return result;
}
