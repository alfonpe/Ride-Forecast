import { fetchJSON } from "./net.js";
import { R, clamp, deg, rad } from "./util.js";

export const ELEV_API = "https://api.open-meteo.com/v1/elevation";

/* ---------- geometry ---------- */
export function hav(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
export const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export const compass = d => COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

// Dense GPS files (a point every 1–5 m) are thinned to roughly one original point per 25 m
// (coarser on very long routes, capping the track at ~20k points). Every later pass — pacing,
// the best-start planner's ~35 simulations, map drawing — scales with point count.
export function thin(P, maxPts = 20000) {
  let total = 0;
  for (let i = 1; i < P.length; i++) total += hav(P[i - 1], P[i]);
  const step = Math.max(25, total / maxPts), out = [P[0]];
  let acc = 0;
  for (let i = 1; i < P.length - 1; i++) {
    acc += hav(P[i - 1], P[i]);
    if (acc >= step) { out.push(P[i]); acc = 0; }
  }
  out.push(P[P.length - 1]);
  return out;
}

export function buildTrack(raw) {
  const D = [raw[0]];
  for (let i = 1; i < raw.length; i++) if (hav(D[D.length - 1], raw[i]) > 1) D.push(raw[i]);
  if (D.length < 2) throw new Error("This route is too short to forecast.");
  const P = thin(D), n = P.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + hav(P[i - 1], P[i]);
  // heading at each point, taken ~20 m ahead so GPS jitter doesn't flip it
  const sinB = new Float64Array(n), cosB = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    if (j <= i) j = Math.min(i + 1, n - 1);
    while (j < n - 1 && cum[j] - cum[i] < 20) j++;
    const b = i < n - 1 ? rad(bearing(P[i], P[j])) : Math.atan2(sinB[i - 1], cosB[i - 1]);
    sinB[i] = Math.sin(b); cosB[i] = Math.cos(b);
  }
  const tr = { pts: P, cum, sinB, cosB, total: cum[n - 1], ele: new Float64Array(n), hasEle: false, eleSrc: null, gain: 0, loss: 0, time: null, spd: null };
  if (P.filter(p => p.ele != null && isFinite(p.ele)).length > n * 0.8) setElevation(tr, P.map(p => p.ele), "file");
  return tr;
}

export function setElevation(tr, e, src) {
  const n = tr.pts.length, cum = tr.cum;
  let last = e.find(v => v != null && isFinite(v));
  if (last == null) return;
  e = e.slice();
  for (let i = 0; i < n; i++) { if (e[i] == null || !isFinite(e[i])) e[i] = last; else last = e[i]; }
  // smooth over a ±60 m distance window to tame GPS/DEM noise
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + e[i];
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (cum[i] - cum[lo] > 60) lo++;
    if (hi < i) hi = i;
    while (hi + 1 < n && cum[hi + 1] - cum[i] <= 60) hi++;
    tr.ele[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
  }
  let ref = tr.ele[0], gain = 0, loss = 0;
  for (let i = 1; i < n; i++) {
    const d = tr.ele[i] - ref;
    if (d >= 3) { gain += d; ref = tr.ele[i]; } else if (d <= -3) { loss -= d; ref = tr.ele[i]; }
  }
  Object.assign(tr, { hasEle: true, eleSrc: src, gain, loss });
}

// fill in elevation from a terrain model when the file has none
export async function fetchElevation(tr) {
  const step = Math.max(100, tr.total / 800), ms = [];
  for (let m = 0; m < tr.total; m += step) ms.push(m);
  ms.push(tr.total);
  const pts = ms.map(m => locate(tr, m)), heights = [];
  for (let c = 0; c < pts.length; c += 100) {
    const ch = pts.slice(c, c + 100);
    const url = `${ELEV_API}?latitude=${ch.map(p => p.lat.toFixed(5)).join(",")}&longitude=${ch.map(p => p.lon.toFixed(5)).join(",")}`;
    const j = await fetchJSON(url, { what: "The elevation service" });
    if (!Array.isArray(j.elevation)) throw new Error("elevation lookup failed");
    heights.push(...j.elevation);
  }
  const e = new Array(tr.pts.length);
  for (let i = 0, k = 0; i < e.length; i++) {
    while (k < ms.length - 2 && ms[k + 1] < tr.cum[i]) k++;
    const f = clamp((tr.cum[i] - ms[k]) / ((ms[k + 1] - ms[k]) || 1), 0, 1);
    e[i] = heights[k] + (heights[k + 1] - heights[k]) * f;
  }
  setElevation(tr, e, "dem");
}

export function locate(tr, m, time = tr.time) {
  const { cum, pts } = tr;
  m = clamp(m, 0, tr.total);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= m) lo = mid; else hi = mid; }
  const f = (m - cum[lo]) / ((cum[hi] - cum[lo]) || 1), a = pts[lo], b = pts[hi];
  return {
    lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
    ele: tr.ele[lo] + (tr.ele[hi] - tr.ele[lo]) * f,
    t: time ? time[lo] + (time[hi] - time[lo]) * f : 0, i: lo
  };
}

// checkpoints are evenly spaced by distance; times are attached per run
export function makeSamples(tr) {
  const step = Math.min(10000, Math.max(1500, tr.total / 60));
  const n = Math.max(1, Math.round(tr.total / step)), out = [];
  for (let k = 0; k <= n; k++) {
    const m = tr.total * k / n, p = locate(tr, m, null);
    out.push({ m, km: m / 1000, lat: p.lat, lon: p.lon, ele: p.ele, i: p.i, brg: bearing(locate(tr, m - 250, null), locate(tr, m + 250, null)),
      grade: tr.hasEle ? (locate(tr, m + 300, null).ele - locate(tr, m - 300, null).ele) / ((Math.min(tr.total, m + 300) - Math.max(0, m - 300)) || 1) : 0 });
  }
  return out;
}
