import { buildTrack, hav } from "./geo.js";
import { rad } from "./util.js";

/* ---------- which way round: reversing a route, and starting a loop anywhere along it ----------
   The route as loaded is the "base" track; an orientation is { s, rev }: the base point index the ride
   starts from (loops only) and whether it's ridden backwards. */

// a loop ends within 300 m of where it starts
export const isLoop = tr => tr.total > 2000 && hav(tr.pts[0], tr.pts[tr.pts.length - 1]) < 300;

// the base track ridden from point `s` and/or backwards; elevations carry over as they are (already smoothed)
export function orientTrack(base, { s = 0, rev = false } = {}) {
  if (!s && !rev) return base;
  let P = base.pts.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: base.hasEle ? base.ele[i] : null }));
  if (s > 0) P = [...P.slice(s), ...P.slice(0, s + 1)];
  if (rev) P.reverse();
  return buildTrack(P, { eleSrc: base.eleSrc, smooth: false });
}

// Stops are typed as km in the direction ridden. To keep a stop at the same café when the direction or
// start changes, go through its distance along the base track. `o` = { loop, s0: base metres of the start, rev }.
const mod = (x, T) => ((x % T) + T) % T;
export const toBase = (m, o, T) => o.loop ? mod(o.rev ? o.s0 - m : o.s0 + m, T) : (o.rev ? T - m : m);
export const fromBase = (d, o, T) => o.loop ? mod(o.rev ? o.s0 - d : d - o.s0, T) : (o.rev ? T - d : d);
export const remapKm = (km, from, to, T) => fromBase(toBase(km * 1000, from, T), to, T) / 1000;

// Out-and-back: the share of the distance ridden twice, i.e. where the route passes within `near` m of itself again at
// least `apart` m further along. At `share` or more, returns { turn, shared } with the turnaround (the point furthest
// from the start, which also leaves any loop at the far end on the way out); otherwise null.
export function outAndBack(tr, { near = 40, apart = 1000, share = 0.7 } = {}) {
  const P = tr.pts, n = P.length, cum = tr.cum, k = Math.cos(rad(P[0].lat));
  const x = P.map(p => p.lon * 111195 * k), y = P.map(p => p.lat * 111195), cell = c => Math.floor(c / near);
  const grid = new Map();
  for (let i = 0; i < n; i++) { const key = cell(x[i]) + "," + cell(y[i]); (grid.get(key) || grid.set(key, []).get(key)).push(i); }
  let twice = 0;
  for (let i = 1; i < n; i++) {
    const cx = cell(x[i]), cy = cell(y[i]);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++)
      for (const j of grid.get((cx + dx) + "," + (cy + dy)) || []) if (Math.abs(cum[j] - cum[i]) > apart && Math.hypot(x[j] - x[i], y[j] - y[i]) <= near) { hit = true; break; }
    if (hit) twice += cum[i] - cum[i - 1];
  }
  if (twice / tr.total < share) return null;
  let turn = 0, fd = 0;
  for (let i = 0; i < n; i++) { const d = hav(P[0], P[i]); if (d > fd) { fd = d; turn = i; } }
  return { turn, shared: twice / tr.total };
}
