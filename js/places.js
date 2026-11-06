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

/* ---------- the same names from OpenFreeMap's map data ----------
   The vector tiles behind the share image carry towns, villages, peaks and cols. Read them with a hidden MapLibre
   map at zoom 11 (where villages are included) over the route: no rate limit, nothing for a privacy blocker to
   stop, so it's the fallback when Photon gives nothing. No population and no road passes, but the same places the
   map shows. Resolves to { places, summits } or null (no MapLibre / WebGL, or no answer within `timeout`). */
export function placesFromTiles(tr, timeout = 12000) {
  const gl = typeof window !== "undefined" && window.maplibregl;
  if (!gl || (gl.supported && !gl.supported())) return Promise.resolve(null);
  const lats = tr.pts.map(p => p.lat), lons = tr.pts.map(p => p.lon), m = 0.06;
  const w = Math.min(...lons) - m, e = Math.max(...lons) + m, s = Math.min(...lats) - m, n = Math.max(...lats) + m;
  const merc = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
  let z = 11, px = d => d / 360 * 512 * 2 ** z;
  while (z > 8 && Math.max(px(e - w), px(merc(n) - merc(s))) > 4096) { z--; px = d => d / 360 * 512 * 2 ** z; }
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:-20000px;top:0;width:${Math.ceil(px(e - w))}px;height:${Math.ceil(px(merc(n) - merc(s)))}px;pointer-events:none`;
  document.body.appendChild(el);
  return new Promise(resolve => {
    let map, done = false;
    const finish = res => { if (done) return; done = true; try { map && map.remove(); } catch (er) { /* gone */ } el.remove(); resolve(res); };
    try {
      map = new gl.Map({ container: el, interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: 1, center: [(w + e) / 2, (s + n) / 2], zoom: z,
        style: { version: 8, sources: { omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" } }, layers: [
          { id: "place", type: "circle", source: "omt", "source-layer": "place", paint: { "circle-opacity": 0 } },
          { id: "peak", type: "circle", source: "omt", "source-layer": "mountain_peak", paint: { "circle-opacity": 0 } }] } });
      map.on("error", () => {});
      map.once("idle", () => {
        try {
          const seen = new Set(), pick = (layer, ok) => map.querySourceFeatures("omt", { sourceLayer: layer }).filter(f => f.properties.name && ok(f.properties.class)).map(f => {
            const [lon, lat] = f.geometry.coordinates, name = short(String(f.properties.name)), k = `${name}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
            if (seen.has(k)) return null; seen.add(k);
            return { name, place: f.properties.class, key: layer === "place" ? "place" : "natural", pop: null, lat, lon };
          }).filter(Boolean);
          const places = pick("place", c => c === "city" || c === "town" || c === "village");
          const summits = pick("mountain_peak", c => c === "peak" || c === "saddle").map(q => ({ ...q, kind: q.place === "saddle" ? "pass" : "peak" }));
          finish(places.length || summits.length ? { places, summits } : null);
        } catch (er) { finish(null); }
      });
      setTimeout(() => finish(null), timeout);
    } catch (er) { finish(null); }
  });
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
  // Photon can be unreachable from some browsers (blocked by a privacy extension, or throttled): read the names from
  // the map's own data, and only if that fails too, ask Overpass
  if (!places.length) {
    const t = await placesFromTiles(tr);
    if (t && t.places.length) {
      places.push(...t.places);
      if (!summits.length) summits = t.summits;
      answered++; complete = true; failed = 0;
      update();
    }
  }
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
