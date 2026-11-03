import { locate, routeKey } from "./geo.js";
import { fetchJSON, store, stored } from "./net.js";

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
export async function fetchPlaces(tr, onUpdate = () => {}, { capMs = 20000 } = {}) {
  const id = routeKey(tr), hit = stored("rf-places", 30), had = hit && hit.id === id ? hit.res : null;
  if (had) { onUpdate(had); if (!had.partial) return had; } // shown at once; a partial one is completed below
  const at = [];
  // every 14 km, 12 km around: any town within 5 km of the road is within 7 + 5 km of a lookup point
  for (let m = 0; m < tr.total; m += 14000) at.push(locate(tr, m, null));
  at.push(locate(tr, tr.total, null));
  const seen = new Set(), places = [];
  let summits = [], answered = 0, failed = 0, complete = false;
  const get = url => fetchJSON(url, { timeout: 8000, what: "The place-name service", retries: 1 }).then(j => { answered++; return j; }, () => { failed++; return null; });
  const update = () => onUpdate({ places: places.slice(), summits });
  const towns = pool(at, 2, p => get(`${PHOTON}?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&radius=12&limit=20${KINDS}`).then(r => {
    for (const q of photonFeatures(r, f => f.osm_key === "place")) {
      const k = `${q.name}|${q.lat.toFixed(2)}|${q.lon.toFixed(2)}`;
      if (!seen.has(k)) { seen.add(k); places.push(q); }
    }
    if (r) update();
  }));
  // passes, saddles and peaks around the high point (8 km): the card names the high point after the pass it belongs to
  let peaks = Promise.resolve();
  if (tr.hasEle) {
    let hi = 0;
    for (let i = 1; i < tr.ele.length; i++) if (tr.ele[i] > tr.ele[hi]) hi = i;
    const p = tr.pts[hi];
    peaks = get(`${PHOTON}?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&radius=8&limit=25&osm_tag=natural:peak&osm_tag=natural:saddle&osm_tag=mountain_pass`).then(r => {
      summits = photonFeatures(r, q => q.osm_key === "natural" || q.osm_key === "mountain_pass")
        .map(q => ({ ...q, kind: q.key === "mountain_pass" || q.place === "saddle" ? "pass" : "peak" }));
      if (r) update();
    });
  }
  await Promise.race([Promise.all([towns, peaks]).then(() => { complete = true; }), new Promise(r => setTimeout(r, capMs))]);
  if (!answered) return had;
  const res = { places: places.slice(), summits, partial: !complete || failed > 0 };
  if (had && res.partial && res.places.length < had.places.length) return had; // keep the better of the two
  store("rf-places", { id, res });
  return res;
}
