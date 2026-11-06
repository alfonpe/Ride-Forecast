import { hav } from "./geo.js";

/* ---------- reference labels for the share card ----------
   Without a map behind the route, a few names make it readable: the biggest town within 5 km of each
   25 km of route, the town nearest the furthest point, and the high point when the ride really climbs. */

const SIZE = { city: 100000, town: 10000, village: 1000 };
const size = p => p.pop || SIZE[p.place] || 0;

// km along the track and metres off it, for a point near the route
export function onTrack(tr, q) {
  const P = tr.pts, step = Math.max(1, Math.floor(P.length / 2000));
  let best = 0, bd = Infinity;
  for (let i = 0; i < P.length; i += step) { const d = hav(P[i], q); if (d < bd) { bd = d; best = i; } }
  return { km: tr.cum[best] / 1000, off: bd, i: best };
}

// Where the climb to point `hi` starts: walking back from the top, the lowest point before the road rises
// again by more than 150 m (i.e. before the previous hill).
export function climbStart(tr, hi) {
  let lo = hi;
  for (let i = hi - 1; i >= 0; i--) {
    if (tr.ele[i] < tr.ele[lo]) lo = i;
    else if (tr.ele[i] - tr.ele[lo] > 150) break;
  }
  return lo;
}

// A name for the high point, most certain first:
// 1. a peak, saddle or pass within 500 m of it: it's really there
// 2. a road pass (mountain_pass=yes) within 2 km of the route on the climb up to it: the road's summit often lies
//    beyond the mapped pass point (ski station, viewpoint), as on the Puerto de Valdelinares
// 3. a saddle the road crosses (within 250 m) within 1.5 km of the top
export function summitName(tr, hi, summits = []) {
  const p = tr.pts[hi], hiKm = tr.cum[hi] / 1000, fromKm = tr.cum[climbStart(tr, hi)] / 1000;
  const here = summits.filter(q => hav(q, p) <= 500).sort((a, b) => hav(a, p) - hav(b, p))[0];
  if (here) return here.name;
  const placed = summits.map(q => ({ ...q, ...onTrack(tr, q) }));
  const road = placed.filter(q => q.key === "mountain_pass" && q.off <= 2000 && q.km >= fromKm - 0.5 && q.km <= hiKm + 2).sort((a, b) => a.off - b.off)[0];
  if (road) return road.name;
  const saddle = placed.filter(q => q.off <= 250 && Math.abs(q.km - hiKm) <= 1.5 && (q.kind === "pass" || q.place === "saddle")).sort((a, b) => Math.abs(a.km - hiKm) - Math.abs(b.km - hiKm))[0];
  return saddle ? saddle.name : "";
}

export function pickLabels(tr, places = [], summits = [], { every = 25, within = 5, climb = 200 } = {}) {
  const out = [], clash = q => out.some(o => o.text === q.name || hav(o, q) < 4000);
  const near = places.map(q => ({ ...q, ...onTrack(tr, q) })).filter(q => q.off <= within * 1000);
  const totalKm = tr.total / 1000;
  for (let w = 0; w * every < totalKm; w++) {
    const pick = near.filter(q => q.km >= w * every && q.km < (w + 1) * every).sort((a, b) => size(b) - size(a)).find(q => !clash(q));
    if (pick) out.push({ type: "place", place: pick.place, pop: pick.pop, lat: pick.lat, lon: pick.lon, text: pick.name, km: pick.km });
  }
  // the turnaround / furthest point from the start
  let fi = 0, fd = 0;
  tr.pts.forEach((p, i) => { const d = hav(tr.pts[0], p); if (d > fd) { fd = d; fi = i; } });
  const far = tr.pts[fi];
  if (fd > 3000 && !out.some(o => hav(o, far) < 4000)) {
    const q = near.filter(c => hav(c, far) <= within * 1000).sort((a, b) => hav(a, far) - hav(b, far))[0];
    if (q && !out.some(o => o.text === q.name)) out.push({ type: "place", far: true, place: q.place, pop: q.pop, lat: q.lat, lon: q.lon, text: q.name, km: q.km });
  }
  // the high point, only when it's a real climb above the start, named after the pass it belongs to
  if (tr.hasEle) {
    let hi = 0;
    for (let i = 1; i < tr.ele.length; i++) if (tr.ele[i] > tr.ele[hi]) hi = i;
    if (tr.ele[hi] - tr.ele[0] >= climb) {
      const p = tr.pts[hi], hiKm = tr.cum[hi] / 1000, name = summitName(tr, hi, summits);
      out.push({ type: "high", lat: p.lat, lon: p.lon, text: `${name ? name + " · " : ""}${Math.round(tr.ele[hi])} m`, km: hiKm });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}
