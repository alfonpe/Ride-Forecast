import { locate } from "./geo.js";
import { fetchJSON } from "./net.js";

/* ---------- town and pass names for the share card (Photon, OpenStreetMap-based search) ----------
   A few small "what's near here" lookups along the route are faster and far more reliable than one big
   Overpass query: every ~10 km, the cities, towns and villages within 10 km; at the high point, a peak or
   pass. Photon returns no population, so size is judged by kind (city > town > village). */

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

export async function fetchPlaces(tr) {
  const at = [];
  for (let m = 0; m < tr.total; m += 10000) at.push(locate(tr, m, null));
  at.push(locate(tr, tr.total, null));
  const get = url => fetchJSON(url, { timeout: 15000, what: "The place-name service", retries: 1 }).catch(() => null);
  const res = await pool(at, 4, p => get(`${PHOTON}?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}&radius=10&limit=15${KINDS}`));
  if (res.every(r => !r)) return null;
  const seen = new Set(), places = [];
  for (const r of res) for (const q of photonFeatures(r, p => p.osm_key === "place")) {
    const k = `${q.name}|${q.lat.toFixed(2)}|${q.lon.toFixed(2)}`;
    if (!seen.has(k)) { seen.add(k); places.push(q); }
  }
  // passes, saddles and peaks around the high point (8 km): the card names the high point after one that's
  // really there, and labels the highest pass the road actually goes over
  let summits = [];
  if (tr.hasEle) {
    let hi = 0;
    for (let i = 1; i < tr.ele.length; i++) if (tr.ele[i] > tr.ele[hi]) hi = i;
    const p = tr.pts[hi];
    summits = photonFeatures(await get(`${PHOTON}?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}&radius=8&limit=25&osm_tag=natural:peak&osm_tag=natural:saddle&osm_tag=mountain_pass`),
      q => q.osm_key === "natural" || q.osm_key === "mountain_pass")
      .map(q => ({ ...q, kind: q.key === "mountain_pass" || q.place === "saddle" ? "pass" : "peak" }));
  }
  return { places, summits };
}
