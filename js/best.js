import { locate } from "./geo.js";
import { STORM } from "./hazards.js";
import { riderFeels, simulate } from "./pacing.js";
import { wallToMs } from "./time.js";
import { daylight, isDark, wxAt } from "./weather.js";

/* ---------- best time to leave ---------- */
export function scoreStarts(tr, S, locs, o, dayWall, win) {
  const days = daylight(locs[0]), out = [];
  for (let h = 4; h <= 21; h += 0.5) {
    const ms = wallToMs(`${dayWall}T${String(Math.floor(h)).padStart(2, "0")}:${h % 1 ? "30" : "00"}`);
    if (!isFinite(ms) || ms < win[0]) continue;
    const sim = simulate(tr, S, locs, ms, o, false), end = ms + sim.dur * 1000;
    if (end > win[1]) break;
    let wet = 0, mm = 0, dark = 0, storm = 0, minBike = Infinity, head = 0;
    S.forEach((s, k) => {
      const a = sim.acc[k], eta = ms + locate(tr, s.m, sim.t).t * 1000, w = wxAt(locs[k], eta), dt = a.w / 60;
      const spd = a.w ? a.d / a.w * 3.6 : o.speed, hd = a.w ? a.h / a.w : 0;
      wet += (w.pop / 100) * dt; mm += w.precip * dt / 60; head += hd * dt;
      if (isDark(eta, days)) dark += dt;
      if (STORM.includes(w.code) || (w.cape >= 1500 && w.pop >= 40)) storm += dt;
      minBike = Math.min(minBike, riderFeels(w.temp, spd + hd, w.feels));
    });
    // "effective minutes": ride time plus penalties for getting wet, storms, riding in the dark and the cold
    const score = sim.dur / 60 + 0.8 * wet + 2 * storm + 0.5 * dark + 3 * Math.max(0, 4 - minBike);
    out.push({ ms, dur: sim.dur, wet, mm, dark, storm, minBike, head: head / (sim.moving / 60 || 1), score, rainy: wet / (sim.moving / 60) >= 0.4 });
  }
  return out;
}
