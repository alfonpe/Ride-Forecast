import { buildTrack, hav } from "./geo.js";

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
