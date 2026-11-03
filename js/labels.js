import { hav } from "./geo.js";

/* ---------- reference labels for the share card ----------
   Without a map behind the route, a few names make it readable: the biggest town within 10 km of each
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

export function pickLabels(tr, places = [], summits = [], { every = 25, within = 10, climb = 200 } = {}) {
  const out = [], clash = q => out.some(o => o.text === q.name || hav(o, q) < 4000);
  const near = places.map(q => ({ ...q, ...onTrack(tr, q) })).filter(q => q.off <= within * 1000);
  const totalKm = tr.total / 1000;
  for (let w = 0; w * every < totalKm; w++) {
    const pick = near.filter(q => q.km >= w * every && q.km < (w + 1) * every).sort((a, b) => size(b) - size(a)).find(q => !clash(q));
    if (pick) out.push({ type: "place", lat: pick.lat, lon: pick.lon, text: pick.name, km: pick.km });
  }
  // the turnaround / furthest point from the start
  let fi = 0, fd = 0;
  tr.pts.forEach((p, i) => { const d = hav(tr.pts[0], p); if (d > fd) { fd = d; fi = i; } });
  const far = tr.pts[fi];
  if (fd > 3000 && !out.some(o => hav(o, far) < 4000)) {
    const q = near.filter(c => hav(c, far) <= within * 1000).sort((a, b) => hav(a, far) - hav(b, far))[0];
    if (q && !out.some(o => o.text === q.name)) out.push({ type: "place", lat: q.lat, lon: q.lon, text: q.name, km: q.km });
  }
  // the high point, only when it's a real climb above the start; named after a peak or pass right there
  if (tr.hasEle) {
    let hi = 0;
    for (let i = 1; i < tr.ele.length; i++) if (tr.ele[i] > tr.ele[hi]) hi = i;
    if (tr.ele[hi] - tr.ele[0] >= climb) {
      const p = tr.pts[hi], s = summits.filter(q => hav(q, p) <= 500).sort((a, b) => hav(a, p) - hav(b, p))[0];
      out.push({ type: "high", lat: p.lat, lon: p.lon, text: `${s ? s.name + " · " : ""}${Math.round(tr.ele[hi])} m`, km: tr.cum[hi] / 1000 });
    }
  }
  return out.sort((a, b) => a.km - b.km);
}
