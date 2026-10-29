import { clamp, deg } from "./util.js";
import { windUV } from "./weather.js";

/* ---------- pacing: hills, wind and stops ---------- */
// Walks the track once, so wind is looked up at the moment you actually reach each point.
// Hill factors are normalised so that, in still air, the moving average equals the chosen speed.
// Wind (at rider height) costs ~0.45× a headwind and gives back ~0.35× a tailwind.
export function simulate(tr, S, locs, startMs, o, collect) {
  const n = tr.pts.length, cum = tr.cum, v = o.speed / 3.6;
  const hf = new Float64Array(n);
  let T0 = 0;
  for (let i = 1; i < n; i++) {
    const d = cum[i] - cum[i - 1];
    let f = 1;
    if (o.hills && tr.hasEle && d > 0) {
      const g = clamp((tr.ele[i] - tr.ele[i - 1]) / d, -0.15, 0.15);
      f = g > 0 ? 1 / (1 + 9 * g) : Math.min(1.4, 1 - 4 * g);
    }
    hf[i] = f; T0 += d / f;
  }
  const norm = T0 / (tr.total || 1);
  const t = new Float64Array(n), spd = new Float32Array(n);
  const nS = S.length, acc = S.map(() => ({ w: 0, d: 0, h: 0, c: 0 })), sectors = new Array(8).fill(0);
  let si = 0, stopSec = 0;
  for (let i = 1; i < n; i++) {
    const d = cum[i] - cum[i - 1];
    let vs = v * hf[i] * norm, h = 0, c = 0;
    const k = Math.round(cum[i] / (tr.total || 1) * (nS - 1));
    if (locs) {
      const [u, w] = windUV(locs[k], startMs + t[i - 1] * 1000);
      h = (u * tr.sinB[i] + w * tr.cosB[i]) * o.wf;  // + = into your face
      c = (u * tr.cosB[i] - w * tr.sinB[i]) * o.wf;  // + = from your right
      vs = clamp(vs - (h > 0 ? 0.45 : 0.35) * h / 3.6, Math.max(1.2, vs * 0.35), vs * 1.6);
    }
    const dt = d / vs;
    t[i] = t[i - 1] + dt; spd[i] = vs;
    const a = acc[k]; a.w += dt; a.d += d; a.h += h * dt; a.c += c * dt;
    if (collect && locs && (h || c)) sectors[Math.round(((deg(Math.atan2(c, h)) + 360) % 360) / 45) % 8] += dt / 60;
    while (si < o.stops.length && o.stops[si].m <= cum[i]) { t[i] += o.stops[si].min * 60; stopSec += o.stops[si].min * 60; si++; }
  }
  return { t, spd, acc, sectors, dur: t[n - 1], stopSec, moving: t[n - 1] - stopSec };
}

// "45@20, 90@10" → stops. Entries are matched whole rather than split on commas, so a decimal
// comma ("12,5@5") reads as km 12.5. Minutes are whole numbers.
export function parseStops(str, total) {
  const out = [], bad = [], re = /(\d+(?:[.,]\d+)?)\s*(?:km)?\s*(?:[@x×:]|\s)\s*(\d+)\s*(?:min\b|m\b|')?/gi;
  let rest = str || "", m;
  while ((m = re.exec(str || ""))) {
    rest = rest.replace(m[0], " ".repeat(m[0].length));
    const km = parseFloat(m[1].replace(",", ".")), min = parseFloat(m[2]);
    if (km * 1000 > total || min <= 0) { bad.push(m[0].trim()); continue; }
    out.push({ m: km * 1000, km, min });
  }
  bad.push(...rest.split(/[,;]+/).map(x => x.trim()).filter(Boolean));
  return { stops: out.sort((x, y) => x.m - y.m), bad };
}

// how cold it actually feels on the bike: wind chill from your airspeed (ride speed + headwind),
// faded out as it warms up; above 24 °C the forecast's heat-and-humidity "feels like" takes over
export function riderFeels(T, air, apparent) {
  if (T >= 24) return Math.max(T, apparent);
  const v = Math.max(5, air) ** 0.16;
  const chill = t => 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v;
  if (T <= 10) return Math.min(T, chill(T));
  return T + (chill(10) - 10) * (24 - T) / 14;
}
