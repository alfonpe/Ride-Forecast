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

// Every top along the route worth a name: a point you climb at least `minClimb` metres into from one side, and that
// stands apart from any higher ground (the road drops at least `sep` m between them), so a bump on the way up to a
// bigger summit doesn't count. A top at the start or finish counts too. Indices into tr.pts, in riding order.
export function climbTops(tr, minClimb = 200, sep = 60) {
  if (!tr.hasEle) return [];
  const idx = [];
  for (let i = 0, next = 0; i < tr.pts.length; i++) if (tr.cum[i] >= next) { idx.push(i); next = tr.cum[i] + 100; } // every ~100 m
  if (idx[idx.length - 1] !== tr.pts.length - 1) idx.push(tr.pts.length - 1);
  const e = idx.map(i => tr.ele[i]), n = e.length, tops = [];
  for (let j = 0; j < n; j++) {
    if ((j > 0 && e[j - 1] > e[j]) || (j < n - 1 && e[j + 1] > e[j])) continue; // not a local top
    let lowL = e[j], lowR = e[j], k = j - 1, m = j + 1;
    for (; k >= 0 && e[k] < e[j]; k--) lowL = Math.min(lowL, e[k]); // stops at ground as high (the first of equal tops wins)
    for (; m < n && e[m] <= e[j]; m++) lowR = Math.min(lowR, e[m]);
    const dropL = e[j] - lowL, dropR = e[j] - lowR;
    if (Math.max(dropL, dropR) < minClimb) continue;
    if ((k >= 0 && dropL < sep) || (m < n && dropR < sep)) continue;
    // the real highest track point between the neighbouring samples
    let best = idx[j];
    for (let i = idx[Math.max(0, j - 1)]; i <= idx[Math.min(n - 1, j + 1)]; i++) if (tr.ele[i] > tr.ele[best]) best = i;
    tops.push(best);
  }
  return tops;
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
  // every top of a real climb that has a name (a pass, col or peak there); unnamed tops aren't labelled
  for (const i of climbTops(tr, climb)) {
    const name = summitName(tr, i, summits);
    if (name) out.push({ type: "high", lat: tr.pts[i].lat, lon: tr.pts[i].lon, text: `${name} · ${Math.round(tr.ele[i])} m`, name, ele: Math.round(tr.ele[i]), km: tr.cum[i] / 1000 });
  }
  return out.sort((a, b) => a.km - b.km);
}

// the named tops on this track, in riding order: { name, ele, km, lat, lon }
export const namedTops = (tr, summits = []) => pickLabels(tr, [], summits).filter(l => l.type === "high");
