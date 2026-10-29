import { fetchJSON } from "./net.js";
import { DEVICE_TZ, isoDay } from "./time.js";
import { DAY, HOUR, clamp, deg, rad } from "./util.js";

export const API = "https://api.open-meteo.com/v1/forecast";
export const ENS_API = "https://ensemble-api.open-meteo.com/v1/ensemble";
export const AIR_API = "https://air-quality-api.open-meteo.com/v1/air-quality";
export const HOURLY = ["temperature_2m","apparent_temperature","relative_humidity_2m","precipitation_probability","precipitation","weather_code","cloud_cover","wind_speed_10m","wind_direction_10m","wind_gusts_10m","visibility","cape","uv_index"];

export async function resolveTZ(p) {
  const url = `${API}?latitude=${p.lat.toFixed(2)}&longitude=${p.lon.toFixed(2)}&timezone=auto&forecast_days=1&daily=sunrise`;
  try {
    const j = await fetchJSON(url, { timeout: 8000 });
    if (!j.timezone) throw 0;
    new Intl.DateTimeFormat("en", { timeZone: j.timezone });
    return j.timezone;
  } catch (e) { return DEVICE_TZ; }
}
export async function fetchWeather(samples, fromMs, toMs) {
  const maxDay = isoDay(Date.now() + 15 * DAY), minDay = isoDay(Date.now() - 90 * DAY);
  let d0 = isoDay(fromMs), d1 = isoDay(toMs);
  if (d1 > maxDay) d1 = maxDay;
  if (d0 < minDay) d0 = minDay;
  if (d0 > d1) throw new Error("That start is past the end of the forecast. Pick a time within the next 15 days.");
  const chunks = [];
  for (let c = 0; c < samples.length; c += 50) chunks.push(samples.slice(c, c + 50));
  const res = await Promise.all(chunks.map(async ch => {
    const q = new URLSearchParams({
      latitude: ch.map(s => s.lat.toFixed(3)).join(","), longitude: ch.map(s => s.lon.toFixed(3)).join(","),
      hourly: HOURLY.join(","), daily: "sunrise,sunset", wind_speed_unit: "kmh",
      timeformat: "unixtime", timezone: "GMT", start_date: d0, end_date: d1
    });
    const url = API + "?" + q;
    const j = await fetchJSON(url);
    return Array.isArray(j) ? j : [j];
  }));
  return res.flat();
}

// hourly series are evenly spaced, so the bracketing hour is a direct index
export function hourIdx(T, ts) {
  const i = clamp(Math.floor((ts - T[0]) / 3600), 0, T.length - 2);
  return [i, clamp((ts - T[i]) / ((T[i + 1] - T[i]) || 1), 0, 1)];
}
export const lerp = (arr, i, f) => { const a = arr[i], b = arr[i + 1]; return a == null ? b : b == null ? a : a + (b - a) * f; };
// wind as a "from" vector so 350°→10° doesn't swing through south
export function windUV(loc, ms) {
  const H = loc.hourly, [i, f] = hourIdx(H.time, ms / 1000);
  const uv = j => { const s = H.wind_speed_10m[j], d = H.wind_direction_10m[j]; return s == null || d == null ? null : [s * Math.sin(rad(d)), s * Math.cos(rad(d))]; };
  let a = uv(i), b = uv(i + 1); a = a || b; b = b || a;
  return a ? [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] : [0, 0];
}
export function wxAt(loc, ms) {
  const H = loc.hourly, [i, f] = hourIdx(H.time, ms / 1000), L = (k, d = 0) => (H[k] ? lerp(H[k], i, f) : null) ?? d;
  const [u, v] = windUV(loc, ms), near = f < 0.5 ? i : i + 1;
  const temp = L("temperature_2m");
  return {
    temp, feels: L("apparent_temperature", temp), rh: L("relative_humidity_2m"),
    pop: L("precipitation_probability"), precip: H.precipitation[i + 1] ?? H.precipitation[i] ?? 0,
    code: H.weather_code[near] ?? H.weather_code[i], cloud: L("cloud_cover"),
    ws: L("wind_speed_10m"), gust: L("wind_gusts_10m", L("wind_speed_10m")),
    wdir: (deg(Math.atan2(u, v)) + 360) % 360,
    vis: L("visibility", 1e5), cape: L("cape"), uv: Math.max(0, L("uv_index")), wet12: rainBefore(H, i, 12)
  };
}
// rain in the hours before (wet roads linger after the rain stops)
export function rainBefore(H, i, n) {
  let sum = 0;
  for (let j = Math.max(0, i - n + 1); j <= i + 1 && j < H.time.length; j++) sum += H.precipitation[j] || 0;
  return sum;
}
// last instant every location still has data for
export function dataWindow(locs) {
  let a = -Infinity, b = Infinity;
  for (const l of locs) {
    const T = l.hourly.time, tt = l.hourly.temperature_2m, ww = l.hourly.wind_speed_10m;
    let lo = 0, hi = T.length - 1;
    while (lo < hi && (tt[lo] == null || ww[lo] == null)) lo++;
    while (hi > lo && (tt[hi] == null || ww[hi] == null)) hi--;
    a = Math.max(a, T[lo] * 1000); b = Math.min(b, T[hi] * 1000);
  }
  return [a, b];
}

export function closest(arr, ms) {
  let best = null;
  for (const s of arr || []) if (best == null || Math.abs(s * 1000 - ms) < Math.abs(best - ms)) best = s * 1000;
  return best;
}
export function daylight(loc) {
  const d = loc.daily || {}, rise = d.sunrise || [], set = d.sunset || [];
  return rise.map((r, k) => [r * 1000, (set[k] || 0) * 1000]).filter(([a, b]) => a && b);
}
export const isDark = (ms, days) => !days.some(([a, b]) => ms >= a && ms <= b);

/* ---------- secondary forecasts fetched for ~10 checkpoints and applied to the nearest ---------- */
export const spreadIdx = (n, max) => [...new Set(Array.from({ length: Math.min(max, n) }, (_, k) => Math.round(k * (n - 1) / Math.max(1, Math.min(max, n) - 1))))];
export function nearestOf(S, idx, s) {
  let best = 0;
  idx.forEach((k, q) => { if (Math.abs(S[k].m - s.m) < Math.abs(S[idx[best]].m - s.m)) best = q; });
  return best;
}

/* ---------- ensemble uncertainty (non-blocking) ---------- */
export const ENS_VARS = ["temperature_2m", "wind_speed_10m", "precipitation"];
export async function fetchEnsemble(S, startMs, endMs) {
  const idx = spreadIdx(S.length, 10);
  const maxDay = isoDay(Date.now() + 14 * DAY);
  const d0 = isoDay(startMs - 2 * HOUR), d1 = isoDay(endMs + 2 * HOUR);
  if (d0 > maxDay || endMs < Date.now() - 2 * DAY) return null;
  const q = new URLSearchParams({
    latitude: idx.map(k => S[k].lat.toFixed(2)).join(","), longitude: idx.map(k => S[k].lon.toFixed(2)).join(","),
    hourly: ENS_VARS.join(","), models: "ecmwf_ifs025", wind_speed_unit: "kmh", timeformat: "unixtime", timezone: "GMT",
    start_date: d0 < isoDay(Date.now()) ? isoDay(Date.now()) : d0, end_date: d1 > maxDay ? maxDay : d1
  });
  const url = ENS_API + "?" + q;
  const j = await fetchJSON(url).catch(() => null);
  if (!j) return null;
  const locs = Array.isArray(j) ? j : [j];
  return S.map(s => {
    const H = locs[nearestOf(S, idx, s)].hourly, ts = s.eta / 1000;
    if (ts < H.time[0] || ts > H.time[H.time.length - 1]) return null;
    const [i, f] = hourIdx(H.time, ts), out = {};
    for (const v of ENS_VARS) {
      const keys = Object.keys(H).filter(k => k === v || k.startsWith(v + "_member"));
      out[v] = keys.map(k => v === "precipitation" ? H[k][i + 1] : lerp(H[k], i, f)).filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
    }
    if (out.temperature_2m.length < 5) return null;
    const q10 = a => a[Math.floor((a.length - 1) * 0.1)], q90 = a => a[Math.ceil((a.length - 1) * 0.9)];
    return {
      t10: q10(out.temperature_2m), t90: q90(out.temperature_2m),
      w10: q10(out.wind_speed_10m), w90: q90(out.wind_speed_10m),
      rain: out.precipitation.length ? 100 * out.precipitation.filter(x => x >= 0.1).length / out.precipitation.length : null,
      members: out.temperature_2m.length
    };
  });
}

/* ---------- air quality and pollen (non-blocking; CAMS covers ~5 days, pollen Europe only) ---------- */
// grains/m³ at which each pollen counts as "high"; a fifth of that is "moderate"
export const POLLEN = { alder_pollen: ["alder", 100], birch_pollen: ["birch", 100], grass_pollen: ["grass", 50], mugwort_pollen: ["mugwort", 50], olive_pollen: ["olive", 200], ragweed_pollen: ["ragweed", 50] };
export async function fetchAir(S, startMs, endMs) {
  const idx = spreadIdx(S.length, 10);
  const q = new URLSearchParams({
    latitude: idx.map(k => S[k].lat.toFixed(2)).join(","), longitude: idx.map(k => S[k].lon.toFixed(2)).join(","),
    hourly: ["european_aqi", "pm2_5", "ozone", ...Object.keys(POLLEN)].join(","), timeformat: "unixtime", timezone: "GMT",
    start_date: isoDay(startMs - 2 * HOUR), end_date: isoDay(endMs + 2 * HOUR)
  });
  const url = AIR_API + "?" + q;
  const j = await fetchJSON(url).catch(() => null);
  if (!j) return null;
  const locs = Array.isArray(j) ? j : [j];
  return S.map(s => {
    const H = locs[nearestOf(S, idx, s)].hourly, ts = s.eta / 1000;
    if (!H || ts < H.time[0] || ts > H.time[H.time.length - 1]) return null;
    const [i, f] = hourIdx(H.time, ts), v = k => H[k] ? lerp(H[k], i, f) : null;
    const aqi = v("european_aqi");
    if (aqi == null) return null;
    return { aqi, pm25: v("pm2_5"), o3: v("ozone"), pollen: Object.entries(POLLEN).map(([k, [name, hi]]) => ({ name, v: v(k), hi })).filter(p => p.v != null) };
  });
}
export const uvLevel = u => u < 3 ? "Low" : u < 6 ? "Moderate" : u < 8 ? "High" : u < 11 ? "Very high" : "Extreme";
export const aqiLevel = a => a < 20 ? "Good" : a < 40 ? "Fair" : a < 60 ? "Moderate" : a < 80 ? "Poor" : a < 100 ? "Very poor" : "Extremely poor";
