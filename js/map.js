import { compass, hav, locate } from "./geo.js";
import { HAZ } from "./hazards.js";
import { setHover } from "./hover.js";
import { ICON, arrowSvg } from "./icons.js";
import { POI } from "./pois.js";
import { catColor, hazWhere } from "./render.js";
import { state } from "./state.js";
import { fmtTime } from "./time.js";
import { $, clamp, css, esc, r0, r1, rad } from "./util.js";

/* ---------- colour ramps for the map ---------- */
// stops are positions 0–1 along the bar; the value range is fitted to each ride (see rampRange)
export const RAMPS = {
  temp: { stops: [[0,"#3b4cc0"],[.25,"#5fa8d3"],[.45,"#62c2a2"],[.62,"#e9cf5b"],[.8,"#f0954a"],[1,"#c8364a"]], unit: "°C", label: "Temperature" },
  head: { stops: [[0,"#4f5e12"],[.33,"#9aa86a"],[.5,"#c9c8c0"],[.67,"#d9946a"],[1,"#a2441a"]], unit: "km/h at rider height", label: "Tailwind / headwind" },
  pop:  { stops: [[0,"#c4d3e2"],[.3,"#7fa6d6"],[.6,"#3e6fc4"],[1,"#1b2f84"]], unit: "%", label: "Rain chance" },
  precip: { stops: [[0,"#d5e3f0"],[.2,"#8fb8e3"],[.5,"#3e7fd0"],[1,"#14307a"]], unit: "mm/h", label: "Rain amount" },
  ws:   { stops: [[0,"#d4d0e6"],[.33,"#9a8fd0"],[.67,"#6046b0"],[1,"#2e1a6e"]], unit: "km/h at 10 m", label: "Wind speed" }
};
export function rampRange(key) {
  const v = state.samples.map(s => s[key]).filter(isFinite);
  const lo = Math.min(...v), hi = Math.max(...v);
  if (key === "head") { const m = Math.max(5, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi)))); return [-m, m]; }
  if (key === "pop") return [0, Math.max(20, Math.ceil(hi / 10) * 10)];
  if (key === "precip") return [0, Math.max(2.5, Math.ceil(hi))];
  if (key === "ws") return [0, Math.max(10, Math.ceil(hi / 5) * 5)];
  // temperature: whole degrees, at least a 6° span so small changes don't look dramatic
  let a = Math.floor(lo), b = Math.ceil(hi);
  if (b - a < 6) { const mid = (a + b) / 2; a = Math.floor(mid - 3); b = a + 6; }
  return [a, b];
}
export function rampColor(key, v, [lo, hi]) {
  const s = RAMPS[key].stops, t = clamp((v - lo) / ((hi - lo) || 1), 0, 1);
  for (let i = 0; i < s.length - 1; i++) if (t <= s[i + 1][0]) {
    const f = (t - s[i][0]) / (s[i + 1][0] - s[i][0]);
    const a = s[i][1].match(/\w\w/g).map(h => parseInt(h, 16)), b = s[i + 1][1].match(/\w\w/g).map(h => parseInt(h, 16));
    return "rgb(" + a.map((x, j) => Math.round(x + (b[j] - x) * f)).join(",") + ")";
  }
  return s[s.length - 1][1];
}

/* ---------- map ---------- */
export let map, routeLayer, arrowLayer, pinLayer, hoverMarker;
let quiet;
const isDark = () => { const c = (css("--bg").match(/\w\w/g) || ["ff"]).map(h => parseInt(h, 16)); return c.reduce((a, b) => a + b, 0) < 3 * 128; };
const quietStyle = () => `https://tiles.openfreemap.org/styles/${isDark() ? "dark" : "positron"}`;
export function initMap() {
  // wheel-zoom only after the map is clicked, so scrolling the page doesn't hijack it
  map = L.map("map", { zoomControl: true, scrollWheelZoom: false });
  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());
  const osm = cls => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: cls, attribution: "© OpenStreetMap contributors" });
  // the default: OpenFreeMap's quiet Positron (dark with the theme), the basemap Route Library uses; raster "Muted" if MapLibre didn't load
  const ofm = L.maplibreGL && window.maplibregl && maplibregl.supported?.() !== false;
  quiet = ofm ? L.maplibreGL({ style: quietStyle(), attribution: '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }) : null;
  quiet && (quiet.styleFor = quietStyle());
  const muted = osm("muted-tiles");
  const layers = {
    ...(quiet ? { "Quiet": quiet } : {}),
    "Muted": muted,
    "OpenStreetMap": osm(""),
    "Cycling (CyclOSM)": L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc", attribution: "© OpenStreetMap contributors | CyclOSM" }),
    "Topographic": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap" })
  };
  (quiet || muted).addTo(map);
  map.attributionControl.setPrefix(false);
  L.control.layers(layers, null, { position: "topright" }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  arrowLayer = L.layerGroup().addTo(map);
  pinLayer = L.layerGroup().addTo(map);
  map.setView([39.55, -0.45], 10);
}

export function drawMap(fit) {
  const tr = state.track, S = state.samples;
  routeLayer.clearLayers(); arrowLayer.clearLayers(); pinLayer.clearLayers();
  if (quiet && quiet.styleFor !== quietStyle() && quiet.getMaplibreMap()) { quiet.styleFor = quietStyle(); quiet.getMaplibreMap().setStyle(quiet.styleFor); } // theme changed
  const ll = tr.pts.map(p => [p.lat, p.lon]);
  L.polyline(ll, { color: css("--bg"), weight: 8, opacity: 1, interactive: false, lineCap: "round", lineJoin: "round" }).addTo(routeLayer);
  const range = rampRange(state.metric);
  for (let k = 0; k < S.length - 1; k++) {
    const a = S[k], b = S[k + 1];
    const seg = ll.slice(a.i, b.i + 2);
    if (seg.length < 2) continue;
    const v = (a[state.metric] + b[state.metric]) / 2;
    L.polyline(seg, { color: rampColor(state.metric, v, range), weight: 4, opacity: 1, lineCap: "round", lineJoin: "round" })
      .on("mousemove", e => setHover(nearestKm(e.latlng)))
      .addTo(routeLayer);
  }
  const every = Math.max(1, Math.ceil(S.length / 22));
  S.forEach((s, k) => {
    if (k % every) return;
    const html = `<div class="warrow">${arrowSvg((s.wdir + 180) % 360, catColor(s.cat), 20)}<span>${r0(s.ws)}</span></div>`;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ html, className: "", iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: false })
      .bindTooltip(`km ${r1(s.km)} · ${fmtTime(s.eta)}<br>Wind ${r0(s.ws)} km/h from ${compass(s.wdir)}, gusts ${r0(s.gust)}`, { direction: "top", offset: [0, -14] })
      .on("mouseover", () => setHover(s.km))
      .addTo(arrowLayer);
  });
  const pin = (p, html, col, tip) => {
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ html: `<div class="pin" style="background:${col}">${html}</div>`, className: "", iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 1000 }).addTo(pinLayer);
    if (tip) m.bindTooltip(tip, { direction: "top", offset: [0, -12] });
  };
  const first = tr.pts[0], last = tr.pts[tr.pts.length - 1];
  pin(first, "S", css("--ink"), `Start · ${fmtTime(state.startMs)}`);
  if (hav(first, last) > 150) pin(last, "F", css("--ink"), `Finish · ${fmtTime(state.endMs)}`);
  state.opts.stops.forEach(st => {
    const p = locate(tr, st.m);
    pin(p, `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON.cup}</svg>`, css("--accent"),
      `Stop at km ${r1(st.km)} · ${st.min} min<br>arrive ${fmtTime(state.startMs + (p.t - st.min * 60) * 1000)}`);
  });
  (state.pois || []).forEach(q => {
    const ic = { water: "drop", cafe: "cup", shop: "bag" }[q.kind];
    L.marker([q.lat, q.lon], { icon: L.divIcon({ html: `<div class="poi ${q.kind}"><svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON[ic]}</svg></div>`, className: "", iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 500, keyboard: false })
      .bindTooltip(`<b>${esc(q.name || POI[q.kind])}</b><br>${POI[q.kind]} · km ${r1(q.km)}${q.off > 40 ? ` · ${r0(q.off / 10) * 10} m off route` : ""}${q.hours ? `<br>${esc(q.hours)}` : ""}`, { direction: "top", offset: [0, -10] })
      .addTo(pinLayer);
  });
  state.hazards.forEach(z => pin(S[z.k0], "!", css(z.sev === "bad" ? "--head" : "--cross"), `<b>${HAZ[z.type]}</b> ${hazWhere(z)}<br>${z.detail}`));
  if (!hoverMarker) hoverMarker = L.circleMarker([0, 0], { radius: 7, color: css("--bg"), weight: 3, fillColor: css("--accent"), fillOpacity: 1, interactive: false });
  hoverMarker.setStyle({ fillColor: css("--accent"), color: css("--bg") });
  if (fit) map.fitBounds(L.latLngBounds(ll), { padding: [24, 24] });
  drawLegend(range);
}

export function nearestKm(latlng) {
  const tr = state.track; let best = 0, bd = Infinity;
  const step = Math.max(1, Math.floor(tr.pts.length / 3000));
  for (let i = 0; i < tr.pts.length; i += step) {
    const p = tr.pts[i], d = (p.lat - latlng.lat) ** 2 + ((p.lon - latlng.lng) * Math.cos(rad(p.lat))) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return tr.cum[best] / 1000;
}

export function drawLegend([lo, hi]) {
  const r = RAMPS[state.metric];
  const grad = r.stops.map(([t, c]) => `${c} ${Math.round(t * 100)}%`).join(",");
  const lbl = v => state.metric === "head" ? (v < 0 ? `${-v} tail` : v > 0 ? `${v} head` : "0") : `${v}`;
  const ticks = [0, .5, 1].map(f => `<span style="left:${f * 100}%">${lbl(Math.round(lo + (hi - lo) * f))}</span>`).join("");
  $("#legend").innerHTML =
    `<div class="cbar"><span class="cbar-title">${r.label} (${r.unit})</span><i style="background:linear-gradient(90deg,${grad})"></i><div class="cbar-ticks num">${ticks}</div></div>` +
    `<span class="key" title="Arrows point where the wind blows; the number is the forecast wind in km/h at 10 m">${arrowSvg(135, css("--muted"), 13)}wind, km/h</span>` +
    `<span class="key"><b style="background:var(--head)"></b>head</span><span class="key"><b style="background:var(--cross)"></b>cross</span><span class="key"><b style="background:var(--tail)"></b>tail</span>` +
    (state.pois && state.pois.length ? `<span class="key" title="Drinking water from OpenStreetMap"><b class="dot" style="border-color:var(--cool)"></b>water</span><span class="key" title="Cafés and bakeries from OpenStreetMap"><b class="dot" style="border-color:var(--cafe)"></b>café</span><span class="key" title="Shops and petrol stations from OpenStreetMap"><b class="dot" style="border-color:var(--muted)"></b>shop</span>` : "");
}
