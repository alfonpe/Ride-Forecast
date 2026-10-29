import { compass, hav, locate } from "./geo.js";
import { HAZ } from "./hazards.js";
import { setHover } from "./hover.js";
import { ICON, arrowSvg } from "./icons.js";
import { catColor, hazWhere } from "./render.js";
import { state } from "./state.js";
import { fmtTime } from "./time.js";
import { $, clamp, css, r0, r1, rad } from "./util.js";

/* ---------- colour ramps for the map ---------- */
// stops are positions 0–1 along the bar; the value range is fitted to each ride (see rampRange)
export const RAMPS = {
  temp: { stops: [[0,"#3b4cc0"],[.25,"#5fa8d3"],[.45,"#62c2a2"],[.62,"#e9cf5b"],[.8,"#f0954a"],[1,"#c8364a"]], unit: "°C", label: "Temperature" },
  head: { stops: [[0,"#1e8c5c"],[.33,"#7fc79f"],[.5,"#b9bdb7"],[.67,"#f0a37c"],[1,"#c8364a"]], unit: "km/h at rider height", label: "Tailwind / headwind" },
  pop:  { stops: [[0,"#c4d3e2"],[.3,"#7fa6d6"],[.6,"#3e6fc4"],[1,"#1b2f84"]], unit: "%", label: "Rain chance" },
  ws:   { stops: [[0,"#d4d0e6"],[.33,"#9a8fd0"],[.67,"#6046b0"],[1,"#2e1a6e"]], unit: "km/h at 10 m", label: "Wind speed" }
};
export function rampRange(key) {
  const v = state.samples.map(s => s[key]).filter(isFinite);
  const lo = Math.min(...v), hi = Math.max(...v);
  if (key === "head") { const m = Math.max(5, Math.ceil(Math.max(Math.abs(lo), Math.abs(hi)))); return [-m, m]; }
  if (key === "pop") return [0, Math.max(20, Math.ceil(hi / 10) * 10)];
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
export function initMap() {
  // wheel-zoom only after the map is clicked, so scrolling the page doesn't hijack it
  map = L.map("map", { zoomControl: true, scrollWheelZoom: false });
  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());
  const osm = cls => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, className: cls, attribution: "© OpenStreetMap contributors" });
  const layers = {
    "Muted": osm("muted-tiles"),
    "OpenStreetMap": osm(""),
    "Cycling (CyclOSM)": L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc", attribution: "© OpenStreetMap contributors | CyclOSM" }),
    "Topographic": L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap" })
  };
  layers.Muted.addTo(map);
  L.control.layers(layers, null, { position: "topright" }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  arrowLayer = L.layerGroup().addTo(map);
  pinLayer = L.layerGroup().addTo(map);
  map.setView([39.55, -0.45], 10);
}

export function drawMap(fit) {
  const tr = state.track, S = state.samples;
  routeLayer.clearLayers(); arrowLayer.clearLayers(); pinLayer.clearLayers();
  const ll = tr.pts.map(p => [p.lat, p.lon]);
  L.polyline(ll, { color: "#000", weight: 8, opacity: .25, interactive: false }).addTo(routeLayer);
  const range = rampRange(state.metric);
  for (let k = 0; k < S.length - 1; k++) {
    const a = S[k], b = S[k + 1];
    const seg = ll.slice(a.i, b.i + 2);
    if (seg.length < 2) continue;
    const v = (a[state.metric] + b[state.metric]) / 2;
    L.polyline(seg, { color: rampColor(state.metric, v, range), weight: 5, opacity: 1, lineCap: "round" })
      .on("mousemove", e => setHover(nearestKm(e.latlng)))
      .addTo(routeLayer);
  }
  const every = Math.max(1, Math.ceil(S.length / 28));
  S.forEach((s, k) => {
    if (k % every) return;
    const html = `<div class="warrow">${arrowSvg((s.wdir + 180) % 360, catColor(s.cat), 26)}<span>${r0(s.ws)}</span></div>`;
    L.marker([s.lat, s.lon], { icon: L.divIcon({ html, className: "", iconSize: [34, 34], iconAnchor: [17, 17] }), keyboard: false })
      .bindTooltip(`km ${r1(s.km)} · ${fmtTime(s.eta)}<br>Wind ${r0(s.ws)} km/h from ${compass(s.wdir)}, gusts ${r0(s.gust)}`, { direction: "top", offset: [0, -14] })
      .on("mouseover", () => setHover(s.km))
      .addTo(arrowLayer);
  });
  const pin = (p, html, col, tip) => {
    const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ html: `<div class="pin" style="background:${col}">${html}</div>`, className: "", iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 1000 }).addTo(pinLayer);
    if (tip) m.bindTooltip(tip, { direction: "top", offset: [0, -12] });
  };
  const first = tr.pts[0], last = tr.pts[tr.pts.length - 1];
  pin(first, "S", css("--tail"), `Start · ${fmtTime(state.startMs)}`);
  if (hav(first, last) > 150) pin(last, "F", css("--head"), `Finish · ${fmtTime(state.endMs)}`);
  state.opts.stops.forEach(st => {
    const p = locate(tr, st.m);
    pin(p, `<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON.cup}</svg>`, css("--accent"),
      `Stop at km ${r1(st.km)} · ${st.min} min<br>arrive ${fmtTime(state.startMs + (p.t - st.min * 60) * 1000)}`);
  });
  state.hazards.forEach(z => pin(S[z.k0], "!", css(z.sev === "bad" ? "--head" : "--cross"), `<b>${HAZ[z.type]}</b> ${hazWhere(z)}<br>${z.detail}`));
  if (!hoverMarker) hoverMarker = L.circleMarker([0, 0], { radius: 8, color: "#fff", weight: 3, fillColor: css("--accent"), fillOpacity: 1, interactive: false });
  hoverMarker.setStyle({ fillColor: css("--accent") });
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
    `<span>Arrows point where the wind blows, number is forecast km/h at 10 m:</span>` +
    `<span class="key"><b style="background:var(--head)"></b>headwind</span><span class="key"><b style="background:var(--cross)"></b>crosswind</span><span class="key"><b style="background:var(--tail)"></b>tailwind</span>`;
}
