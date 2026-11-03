import { locate } from "./geo.js";
import { STORM, wetRoad } from "./hazards.js";
import { riderFeels, simulate } from "./pacing.js";
import { wallToMs } from "./time.js";
import { daylight, isDark, wxAt } from "./weather.js";

/* ---------- scoring a ride: shared by the best-start planner and the direction comparison ---------- */
export function evaluate(tr, S, locs, ms, o, days = daylight(locs[0])) {
  const sim = simulate(tr, S, locs, ms, o, false);
  let wet = 0, mm = 0, dark = 0, storm = 0, wetRd = 0, minBike = Infinity, head = 0;
  S.forEach((s, k) => {
    const a = sim.acc[k], eta = ms + locate(tr, s.m, sim.t).t * 1000, w = wxAt(locs[k], eta), dt = a.w / 60;
    const spd = a.w ? a.d / a.w * 3.6 : o.speed, hd = a.w ? a.h / a.w : 0;
    wet += (w.pop / 100) * dt; mm += w.precip * dt / 60; head += hd * dt;
    if (isDark(eta, days)) dark += dt;
    if (wetRoad(w)) wetRd += dt;
    if (STORM.includes(w.code) || (w.cape >= 1500 && w.pop >= 40)) storm += dt;
    minBike = Math.min(minBike, riderFeels(w.temp, spd + hd, w.feels));
  });
  // "effective minutes": ride time plus penalties for getting wet, storms, wet roads, riding in the dark and the cold
  const score = sim.dur / 60 + 0.8 * wet + 2 * storm + 0.2 * wetRd + 0.5 * dark + 3 * Math.max(0, 4 - minBike);
  const moving = sim.moving / 60 || 1;
  return { ms, dur: sim.dur, end: ms + sim.dur * 1000, wet, mm, dark, storm, wetRd, minBike, head: head / moving, score, rainy: wet / moving >= 0.4 };
}

/* ---------- best time to leave ---------- */
export function scoreStarts(tr, S, locs, o, dayWall, win) {
  const days = daylight(locs[0]), out = [];
  for (let h = 4; h <= 21; h += 0.5) {
    const ms = wallToMs(`${dayWall}T${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`);
    if (!isFinite(ms) || ms < win[0]) continue;
    const r = evaluate(tr, S, locs, ms, o, days);
    if (r.end > win[1]) break;
    out.push(r);
  }
  return out;
}

/* ---------- the same ride the other way round ----------
   Checkpoints are evenly spaced, so on the reversed track checkpoint k sits where checkpoint N−1−k was:
   the weather already downloaded is reused. Stops keep their spot on the road (km → total − km). */
export function compareReversed(tr, S, alt, altS, locs, ms, o) {
  const N = S.length;
  if (altS.length !== N || Math.abs(alt.total - tr.total) > 50) return null;
  const T = tr.total / 1000, altLocs = altS.map((_, k) => locs[N - 1 - k]);
  const altO = { ...o, stops: o.stops.map(st => ({ ...st, km: T - st.km, m: (T - st.km) * 1000 })).sort((a, b) => a.m - b.m) };
  const days = daylight(locs[0]);
  return { cur: evaluate(tr, S, locs, ms, o, days), alt: evaluate(alt, altS, altLocs, ms, altO, days) };
}
