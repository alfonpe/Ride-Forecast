import { compass, locate } from "./geo.js";
import { HAZ } from "./hazards.js";
import { pickLabels } from "./labels.js";
import { outAndBack } from "./orient.js";
import { waterGap } from "./pois.js";
import { catColor, hazWhere } from "./render.js";
import { state } from "./state.js";
import { fmtDay, fmtDur, fmtTime } from "./time.js";
import { css, maxOf, minOf, r0, r1, rad, span } from "./util.js";
import { rainLevel } from "./weather.js";

/* ---------- the ride plan as one picture, for chats ----------
   Drawn on a canvas, synchronously, so it can be shared straight from the tap (phones require that).
   No map tiles behind the route: browsers refuse to export a canvas that contains another site's images. */

const W = 1080, H = 1350, PAD = 64;
const FONT = '"IBM Plex Sans",system-ui,sans-serif', BODY = '"IBM Plex Sans",system-ui,sans-serif', MONO = '"IBM Plex Mono",ui-monospace,monospace';
const plain = html => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/* ---------- the map behind the route: Route Library's route map ----------
   A soft shaded relief of the land (open elevation tiles on AWS, terrarium encoding), the sea and coastline, rivers
   and reservoirs with their names, faint main roads, named peaks, nearby towns in light grey, the big cities, and
   the card's own towns and passes, all placed by MapLibre so no name touches another, the route, the start/finish
   and hazard markers, the wind badge or the key. Drawn once per route, names and theme on a hidden canvas
   (OpenFreeMap and the elevation tiles allow it, so the canvas stays exportable), kept as a picture with its bounds:
   drawCard() stays synchronous. Until it's ready, or without WebGL, the card draws its own names on a plain panel. */
let cardMap = null, pending = null;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const darkTheme = () => (css("--bg").match(/\w\w/g) || ["ff"]).reduce((a, h) => a + parseInt(h, 16), 0) < 384;
const DEM_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const MAP_PR = 2; // the map is laid out at half the card's pixels and drawn at 2×, so its names have Route Library's proportions
const isCityLabel = l => l.type === "place" && (l.place === "city" || l.pop >= 100000);
// what the card shows: the labels, the out-and-back split, and the size and inner margins of each map panel
function layout() {
  const tr = state.track, S = state.samples;
  const labels = pickLabels(tr, state.places ? state.places.places : [], state.places ? state.places.summits : []);
  const ob = outAndBack(tr), kTurn = ob ? Math.max(1, Math.min(S.length - 2, Math.round(tr.cum[ob.turn] / tr.total * (S.length - 1)))) : null;
  const bw = W - 2 * PAD, bh = 480;
  const pane = ob ? { w: bw / 2, h: bh, inner: { l: 22, r: 22, t: 62, b: 62 } } : { w: bw, h: bh, inner: { l: 36, r: 112, t: 36, b: 64 } };
  const pts = [...tr.pts, ...labels];
  const b = { w: Math.min(...pts.map(p => p.lon)), e: Math.max(...pts.map(p => p.lon)), s: Math.min(...pts.map(p => p.lat)), n: Math.max(...pts.map(p => p.lat)) };
  // a named pass at the top or bottom edge of the frame gets room for its name beside it, instead of none at all
  const tops = labels.filter(l => l.type === "high"), span = (b.n - b.s) || 1e-6;
  if (tops.some(t => t.lat >= b.n - span * 0.06)) pane.inner.t += 60;
  if (tops.some(t => t.lat <= b.s + span * 0.06)) pane.inner.b += 60;
  const key = [tr.total, tr.pts.length, tr.pts[0].lat, tr.pts[0].lon, b.w, b.e, b.s, b.n, pane.w, pane.inner.t, pane.inner.b, darkTheme(),
    labels.map(l => l.text).join("/"), state.hazards.length].join("|");
  return { labels, ob, kTurn, pane, b, key };
}
// the map's colours: Route Library's in light, the same family in dark
function mapColours(dark) {
  return dark ? {
    bg: css("--surface-2"), water: "#20262a", coast: "#36414a", river: "#2e3b42", waterText: "#7f97a3", road: "rgba(255,255,255,0.10)",
    shadow: "#0a0a09", highlight: "#3a3a36", accent: "#262624", peak: "#9a9a90", nearby: "#8a8a84", city: "#e2e2dc", town: "#d0d0ca", pass: "#ecebe7"
  } : {
    bg: css("--surface-2"), water: "#e1e8ec", coast: "#bfcbd1", river: "#c9d6dc", waterText: "#7f939b", road: "rgba(255,255,255,0.85)",
    shadow: "#b9b9ae", highlight: "#ffffff", accent: "#cfcfc4", peak: "#7a7a70", nearby: "#8f8f88", city: "#3a3a3a", town: "#4a4a4a", pass: "#1a1a1a"
  };
}
function cardStyle(c, data) {
  const FONT = ["Noto Sans Regular"], BOLD = ["Noto Sans Bold"], ITALIC = ["Noto Sans Italic"];
  const notNamed = names => ["!", ["in", ["get", "name"], ["literal", names]]];
  const fc = features => ({ type: "geojson", data: { type: "FeatureCollection", features } });
  const pt = (lon, lat, props) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } });
  const anchors = ["right", "left", "bottom", "top", "bottom-right", "bottom-left", "top-right", "top-left"];
  return {
    version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      dem: { type: "raster-dem", tiles: [DEM_TILES], tileSize: 256, maxzoom: 13, encoding: "terrarium" },
      towns: fc(data.towns.map(l => pt(l.lon, l.lat, { name: isCityLabel(l) ? l.text.toUpperCase() : l.text, city: isCityLabel(l) }))),
      passes: fc(data.passes.map(l => pt(l.lon, l.lat, { name: l.text, ele: l.ele || 0 }))),
      guards: fc([])
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": c.bg } },
      { id: "hills", type: "hillshade", source: "dem", paint: { "hillshade-shadow-color": c.shadow, "hillshade-highlight-color": c.highlight, "hillshade-accent-color": c.accent, "hillshade-exaggeration": 0.55, "hillshade-illumination-direction": 315 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": c.water } },
      { id: "coast", type: "line", source: "omt", "source-layer": "water", paint: { "line-color": c.coast, "line-width": 0.7 } },
      { id: "rivers", type: "line", source: "omt", "source-layer": "waterway", filter: ["in", ["get", "class"], ["literal", ["river", "canal"]]], paint: { "line-color": c.river, "line-width": 1 } },
      { id: "roads", type: "line", source: "omt", "source-layer": "transportation", filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]], paint: { "line-color": c.road, "line-width": ["match", ["get", "class"], "motorway", 1.8, 1.2] } },
      // names are placed top layer first: the markers and the route every name keeps off, the passes, the towns the
      // route goes through, then the big cities, nearby towns, peaks and water names wherever there's room left
      { id: "river-names", type: "symbol", source: "omt", "source-layer": "waterway", filter: ["all", ["==", ["get", "class"], "river"], ["has", "name"]],
        layout: { "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ITALIC, "text-size": 10, "symbol-spacing": 220 },
        paint: { "text-color": c.waterText, "text-halo-color": c.bg, "text-halo-width": 1.2 } },
      { id: "water-names", type: "symbol", source: "omt", "source-layer": "water_name", filter: ["has", "name"],
        layout: { "text-field": ["get", "name"], "text-font": ITALIC, "text-size": 10.5, "text-max-width": 8 },
        paint: { "text-color": c.waterText, "text-halo-color": c.water, "text-halo-width": 1 } },
      { id: "peaks", type: "symbol", source: "omt", "source-layer": "mountain_peak", filter: ["all", ["has", "name"], notNamed(data.passNames)],
        layout: { "text-field": ["concat", "▲ ", ["get", "name"], ["case", ["has", "ele"], ["concat", " ", ["to-string", ["get", "ele"]]], ""]], "text-font": FONT, "text-size": 10, "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]], "text-padding": 6 },
        paint: { "text-color": c.peak, "text-halo-color": c.bg, "text-halo-width": 1.3 } },
      { id: "nearby", type: "symbol", source: "omt", "source-layer": "place", filter: ["all", ["in", ["get", "class"], ["literal", ["town", "village"]]], notNamed(data.townNames)],
        layout: { "text-field": ["get", "name"], "text-font": FONT, "text-size": 10.5, "symbol-sort-key": ["match", ["get", "class"], "town", 0, 1], "text-padding": 3 },
        paint: { "text-color": c.nearby, "text-halo-color": c.bg, "text-halo-width": 1.3 } },
      { id: "cities", type: "symbol", source: "omt", "source-layer": "place", filter: ["all", ["==", ["get", "class"], "city"], notNamed(data.townNames)],
        layout: { "text-field": ["upcase", ["get", "name"]], "text-font": BOLD, "text-size": 11, "text-letter-spacing": 0.14, "text-max-width": 9, "text-padding": 4 },
        paint: { "text-color": c.city, "text-halo-color": c.bg, "text-halo-width": 1.6 } },
      { id: "towns", type: "symbol", source: "towns",
        layout: { "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-image": "dot", "text-field": ["get", "name"], "text-font": ["case", ["get", "city"], ["literal", BOLD], ["literal", FONT]],
          "text-size": ["case", ["get", "city"], 11.5, 12], "text-letter-spacing": ["case", ["get", "city"], 0.12, 0],
          "text-variable-anchor": anchors, "text-radial-offset": 1.35, "text-max-width": 14, "text-padding": 2 },
        paint: { "text-color": c.town, "text-halo-color": c.bg, "text-halo-width": 1.6 } },
      { id: "passes", type: "symbol", source: "passes",
        layout: { "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-image": "peak", "text-field": ["get", "name"], "text-font": BOLD, "text-size": 12, "symbol-sort-key": ["-", 0, ["get", "ele"]],
          "text-variable-anchor": ["bottom", "top", "right", "left", "bottom-right", "bottom-left", "top-right", "top-left"], "text-radial-offset": 1.6, "text-max-width": data.narrow ? 10 : 18, "text-justify": "auto", "text-padding": 2 },
        paint: { "text-color": c.pass, "text-halo-color": c.bg, "text-halo-width": 1.8 } },
      { id: "guards", type: "symbol", source: "guards",
        layout: { "icon-image": ["get", "img"], "icon-anchor": ["coalesce", ["get", "anchor"], "center"], "icon-allow-overlap": true, "icon-padding": 0, "icon-rotation-alignment": "viewport" }, paint: { "icon-opacity": 0 } }
    ]
  };
}
export const cardMapReady = () => !!(state.track && cardMap && cardMap.key === layout().key);
export function prepareCardMap() {
  if (!state.track || !state.samples || !window.maplibregl || maplibregl.supported?.() === false) return Promise.resolve(false);
  const L = layout(), { pane, b, key, labels, ob } = L;
  if (cardMap && cardMap.key === key) return Promise.resolve(true);
  if (pending && pending.key === key) return pending.done;
  const tr = state.track, S = state.samples, c = mapColours(darkTheme());
  const cw = pane.w / MAP_PR, ch = pane.h / MAP_PR, towns = labels.filter(l => l.type === "place"), passes = labels.filter(l => l.type === "high");
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:-20000px;top:0;width:${cw}px;height:${ch}px;pointer-events:none`;
  document.body.appendChild(el);
  const done = new Promise(resolve => {
    let m, finished = false;
    const finish = ok => {
      if (finished) return; finished = true;
      try {
        if (ok) {
          const img = document.createElement("canvas"); img.width = pane.w; img.height = pane.h;
          img.getContext("2d").drawImage(m.getCanvas(), 0, 0, pane.w, pane.h);
          const bb = m.getBounds();
          // which of the card's towns and passes found room (the card draws their markers)
          const placed = new Set(m.queryRenderedFeatures({ layers: ["towns", "passes"] }).map(f => `${f.layer.id}|${f.properties.name}`));
          cardMap = { key, img, w: bb.getWest(), e: bb.getEast(), n: bb.getNorth(), s: bb.getSouth(), placed };
        }
      } catch (e) { ok = false; }
      try { m && m.remove(); } catch (e) { /* gone */ }
      el.remove(); if (pending && pending.key === key) pending = null;
      resolve(ok);
    };
    try {
      const style = cardStyle(c, {
        towns, passes, townNames: towns.map(l => l.text), passNames: passes.map(l => l.name), narrow: !!ob
      });
      m = new maplibregl.Map({ container: el, interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: MAP_PR, preserveDrawingBuffer: true,
        bounds: [[b.w, b.s], [b.e, b.n]], fitBoundsOptions: { padding: { top: pane.inner.t / MAP_PR, bottom: pane.inner.b / MAP_PR, left: pane.inner.l / MAP_PR, right: pane.inner.r / MAP_PR }, maxZoom: 14 },
        style });
      m.on("error", () => {});
      // the marker images, handed over the moment the map first asks for one (added later, names already laid out skip them)
      const blank = (w, h) => { const W2 = Math.max(1, Math.round(w * MAP_PR)), H2 = Math.max(1, Math.round(h * MAP_PR)); return { width: W2, height: H2, data: new Uint8Array(W2 * H2 * 4) }; };
      const IMAGES = {
        // the town dot and pass triangle only hold their spot here: the card draws them over its route
        dot: () => blank(9, 9), peak: () => blank(12, 12),
        // invisible markers that every name keeps off: along the route (as thick as the card draws it), on the start,
        // finish, turnaround and hazard markers, over the wind badge and the key, and along the edges (no name cut off)
        "g-pin": () => blank(24, 24), // the edges are wide bands reaching well outside the frame, so a name can't sit beyond an edge either
        "g-h": () => blank(cw + 240, 120), "g-v": () => blank(120, ch + 240),
        "g-key": () => blank(cw + 240, 146), "g-title": () => blank(cw, 30), "g-badge": () => blank(76, 78)
      };
      m.on("styleimagemissing", e => {
        const r = /^r(\d+)$/.exec(e.id), f = r ? () => blank(+r[1], +r[1]) : IMAGES[e.id]; // r12: a 12 px square along the route
        if (f && !m.hasImage(e.id)) m.addImage(e.id, f(), { pixelRatio: MAP_PR });
      });
      m.once("load", () => {
        try {
          const at = (x, y) => { const q = m.unproject([x, y]); return [q.lng, q.lat]; };
          const g = (lonlat, img, anchor) => ({ type: "Feature", properties: anchor ? { img, anchor } : { img }, geometry: { type: "Point", coordinates: lonlat } });
          const feats = [g(at(cw / 2, 5), "g-h", "bottom"), g(at(5, ch / 2), "g-v", "right"), g(at(cw - 5, ch / 2), "g-v", "left"), g(at(cw / 2, ch - 26), "g-key", "top")];
          if (ob) feats.push(g(at(cw / 2, 15), "g-title"));
          else feats.push(g(at(cw - 36, 50), "g-badge"));
          const P = p => [p.lon, p.lat];
          feats.push(g(P(tr.pts[0]), "g-pin"), g(P(tr.pts[tr.pts.length - 1]), "g-pin"));
          if (L.kTurn != null) feats.push(g(P(S[L.kTurn]), "g-pin"));
          state.hazards.forEach(z => feats.push(g(P(S[z.k0]), "g-pin")));
          // the route, every few pixels, as wide as the card draws it there (thicker where the wind is stronger)
          let last = null;
          for (let k = 0; k < S.length - 1; k++) {
            const size = 2 * Math.ceil(((3 + Math.min(Math.max(S[k].ws, 0), 40) / 40 * 19 + 7) / MAP_PR + 2) / 2);
            for (let i = S[k].i; i <= Math.min(S[k + 1].i, tr.pts.length - 1); i++) {
              const q = m.project([tr.pts[i].lon, tr.pts[i].lat]);
              if (last && Math.hypot(q.x - last.x, q.y - last.y) < 4) continue;
              last = q; feats.push(g(P(tr.pts[i]), `r${size}`));
            }
          }
          m.getSource("guards").setData({ type: "FeatureCollection", features: feats });
        } catch (e) { finish(false); return; }
        m.once("idle", () => finish(true));
      });
      setTimeout(() => finish(false), 15000);
    } catch (e) { finish(false); }
  });
  pending = { key, done };
  return done;
}

function wrap(g, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawCard() {
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d"), S = state.samples, tr = state.track, sim = state.sim;
  const ink = css("--ink"), muted = css("--muted"), line = css("--line"), surface = css("--surface"), accent = css("--accent");
  g.fillStyle = css("--bg"); g.fillRect(0, 0, W, H);
  g.textBaseline = "alphabetic";

  // header
  let y = PAD + 44;
  g.fillStyle = muted; g.font = `400 22px ${MONO}`; g.letterSpacing = "3px"; g.fillText("RIDE FORECAST", PAD, y); g.letterSpacing = "0px";
  y += 62; g.fillStyle = ink; g.font = `600 56px ${FONT}`;
  const name = state.name + (state.orient.rev ? " (reversed)" : "");
  wrap(g, name, W - 2 * PAD).slice(0, 2).forEach((l, i) => g.fillText(l, PAD, y + i * 60));
  y += (wrap(g, name, W - 2 * PAD).length > 1 ? 60 : 0) + 48;
  g.fillStyle = css("--faint") || muted; g.font = `400 30px ${BODY}`;
  g.fillText(`${fmtDay(state.startMs)} · ${fmtTime(state.startMs)} → ${fmtTime(state.endMs)} · ${r1(tr.total / 1000)} km${tr.hasEle ? ` · ${r0(tr.gain)} m up` : ""}`, PAD, y);

  // route map: colour = head/cross/tailwind, thickness = how strong the wind is there. An out-and-back ride gets two
  // maps side by side (out | back) at the same scale and position: drawn as one, the way back would cover the way out.
  const box = { x: PAD, y: y + 30, w: W - 2 * PAD, h: 480 };
  const L0 = layout(), labels = L0.labels, ob = L0.ob, kTurn = L0.kTurn, base = cardMap && cardMap.key === L0.key ? cardMap : null;
  const bg2 = css("--surface-2");
  g.fillStyle = bg2; g.beginPath(); g.roundRect(box.x, box.y, box.w, box.h, 16); g.fill();
  g.lineCap = "round"; g.lineJoin = "round";
  const width = s => 3 + Math.min(Math.max(s.ws, 0), 40) / 40 * 19; // 3 px when calm … 22 px at 40+ km/h
  // the overall wind: direction averaged as vectors, and the speed range along the ride
  const u = S.reduce((a, s) => a + s.ws * Math.sin(rad(s.wdir)), 0), v = S.reduce((a, s) => a + s.ws * Math.cos(rad(s.wdir)), 0);
  const from = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360, windRange = `${r0(minOf(S, "ws"))}–${r0(maxOf(S, "ws"))} km/h`;
  const arrow = (cx, cy, size) => {
    g.save(); g.translate(cx, cy); g.rotate(rad(from + 180)); g.scale(size, size); g.fillStyle = ink;
    g.beginPath(); g.moveTo(0, -24); g.lineTo(12, -2); g.lineTo(4, -2); g.lineTo(4, 22); g.lineTo(-4, 22); g.lineTo(-4, -2); g.lineTo(-12, -2); g.closePath(); g.fill(); g.restore();
  };
  // hazards: numbered markers matching the list under the stats, most severe first, at most three
  const shownHaz = [...state.hazards].sort((a, b) => (a.sev === "bad" ? 0 : 1) - (b.sev === "bad" ? 0 : 1) || a.k0 - b.k0).slice(0, 3);
  const badge = (x, yy, n, col, r = 14) => {
    g.fillStyle = col; g.beginPath(); g.arc(x, yy, r, 0, 7); g.fill();
    g.strokeStyle = css("--bg"); g.lineWidth = 3; g.stroke();
    g.fillStyle = css("--bg"); g.font = `600 ${r + 2}px ${MONO}`; g.textAlign = "center"; g.fillText(String(n), x, yy + (r + 2) * 0.36); g.textAlign = "left";
  };
  // one geographic frame for every panel (route + labelled towns, which can sit a few km off it)
  const kx = Math.cos(rad(tr.pts[0].lat));
  const allX = [...tr.pts.map(p => p.lon * kx), ...labels.map(l => l.lon * kx)], allY = [...tr.pts.map(p => p.lat), ...labels.map(l => l.lat)];
  const x0 = Math.min(...allX), x1 = Math.max(...allX), y0 = Math.min(...allY), y1 = Math.max(...allY);
  const last = S.length - 1, nPts = tr.pts.length;

  // one map panel showing checkpoints k0 … k1 of the ride (the whole ride, or one leg of an out-and-back)
  const panel = (pb, { k0 = 0, k1 = last, title = "", inner, windBadge = false }) => {
    const sc = Math.min((pb.w - inner.l - inner.r) / ((x1 - x0) || 1e-6), (pb.h - inner.t - inner.b) / ((y1 - y0) || 1e-6));
    const ox = pb.x + inner.l + (pb.w - inner.l - inner.r - (x1 - x0) * sc) / 2, oy = pb.y + inner.t + (pb.h - inner.t - inner.b + (y1 - y0) * sc) / 2;
    // with the map picture behind, place everything in its (Web Mercator) frame so the route sits on the coast
    const XY = base
      ? (lat, lon) => [pb.x + (lon - base.w) / (base.e - base.w) * pb.w, pb.y + (mercY(base.n) - mercY(lat)) / (mercY(base.n) - mercY(base.s)) * pb.h]
      : (lat, lon) => [ox + (lon * kx - x0) * sc, oy - (lat - y0) * sc];
    const P = i => XY(tr.pts[i].lat, tr.pts[i].lon);
    const split = k0 > 0 || k1 < last;
    g.save(); g.beginPath(); g.rect(pb.x, pb.y, pb.w, pb.h); g.clip();
    if (base) { g.save(); g.beginPath(); g.roundRect(box.x, box.y, box.w, box.h, 16); g.clip(); g.drawImage(base.img, pb.x, pb.y, pb.w, pb.h); g.restore(); }
    if (split) { // the other leg, faint, for context
      g.strokeStyle = muted; g.globalAlpha = .35; g.lineWidth = 3; g.beginPath();
      tr.pts.forEach((_, i) => { const [a, b] = P(i); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke(); g.globalAlpha = 1;
    }
    const seg = (k, fn) => { g.beginPath(); for (let i = S[k].i; i <= Math.min(S[k + 1].i + 1, nPts - 1); i++) { const [a, b] = P(i); i === S[k].i ? g.moveTo(a, b) : g.lineTo(a, b); } fn(); };
    for (let k = k0; k < k1; k++) seg(k, () => { g.strokeStyle = css("--bg"); g.lineWidth = width(S[k]) + 7; g.stroke(); });
    for (let k = k0; k < k1; k++) seg(k, () => { g.strokeStyle = catColor(S[k].cat); g.lineWidth = width(S[k]); g.stroke(); });

    let wb = null;
    if (windBadge) { // round wind badge in the top-right corner
      const cx = pb.x + pb.w - 72, cy = pb.y + 70;
      g.fillStyle = css("--bg"); g.beginPath(); g.arc(cx, cy, 38, 0, 7); g.fill(); g.strokeStyle = line; g.lineWidth = 2; g.stroke();
      arrow(cx, cy, 1);
      g.textAlign = "center"; g.fillStyle = ink; g.font = `600 22px ${BODY}`; g.fillText(`from ${compass(from)}`, cx, cy + 66);
      g.fillStyle = muted; g.font = `400 20px ${MONO}`; g.fillText(windRange, cx, cy + 92); g.textAlign = "left";
      wb = [cx - 70, cy - 42, 140, 145];
    }
    if (title) { g.fillStyle = ink; g.font = `600 21px ${BODY}`; g.fillText(title, pb.x + 22, pb.y + 38); }

    // reference labels: a label goes where it touches neither this panel's route (at its drawn thickness), other
    // labels, markers, the title, the wind badge nor the key; tried at growing distances, else skipped
    const taken = [[pb.x, pb.y + pb.h - 52, pb.w, 52], ...(wb ? [wb] : []), ...(title ? [[pb.x, pb.y, pb.w, 52]] : [])];
    const hasS = k0 === 0, hasF = k1 === last;
    if (hasS) { const [a, b] = P(0); taken.push([a - 21, b - 21, 42, 42]); }
    if (hasF) { const [a, b] = P(nPts - 1); taken.push([a - 21, b - 21, 42, 42]); }
    const routePx = [];
    for (let k = k0; k < k1; k++) {
      const hw = width(S[k]) / 2 + 5;
      for (let i = S[k].i; i <= Math.min(S[k + 1].i, nPts - 1); i++) { const [a, b] = P(i); routePx.push([a, b, hw]); }
    }
    const hitsLine = ([x, yy, w, h]) => routePx.some(([a, b, hw]) => a > x - hw && a < x + w + hw && b > yy - hw && b < yy + h + hw);
    const free = r => { const [x, yy, w, h] = r; return x >= pb.x + 8 && x + w <= pb.x + pb.w - 8 && yy >= pb.y + 8 && yy + h <= pb.y + pb.h - 8 &&
      !taken.some(([a, b, c, d]) => x < a + c && a < x + w && yy < b + d && b < yy + h) && !hitsLine(r); };
    // a hazard that starts at the start (or ends at the finish) sits just beside that marker, not under it
    const ends = [...(hasS ? [P(0)] : []), ...(hasF ? [P(nPts - 1)] : [])];
    const hazAt = z => { const [x, yy] = XY(S[z.k0].lat, S[z.k0].lon); return ends.some(([a, b]) => Math.hypot(a - x, b - yy) < 30) ? [x + 27, yy - 27] : [x, yy]; };
    const here = shownHaz.map((z, n) => ({ z, n: n + 1 })).filter(({ z }) => z.k0 >= k0 && z.k0 < Math.max(k1, k0 + 1) + (hasF ? 1 : 0));
    // every marker's spot is reserved before any text is placed, so no text covers another place's dot
    for (const l of labels) { const [px, py] = XY(l.lat, l.lon); taken.push([px - 9, py - 10, 18, 19]); }
    for (const { z } of here) { const [px, py] = hazAt(z); taken.push([px - 16, py - 16, 32, 32]); }
    const isCity = l => l.type === "place" && (l.place === "city" || l.pop >= 100000);
    const fontFor = l => l.type === "high" ? `600 23px ${BODY}` : isCity(l) ? `600 21px ${BODY}` : `400 23px ${BODY}`;
    const textFor = l => isCity(l) ? l.text.toUpperCase() : l.text;
    const spacing = l => isCity(l) ? "2.5px" : "0px";
    // most important first, so they get the best spots: the summit, then the turnaround, then towns
    const rank = l => l.type === "high" ? 0 : l.far ? 1 : 2;
    for (const l of base ? [] : [...labels].sort((a, b) => rank(a) - rank(b))) { // with the map picture, its names are already placed
      g.font = fontFor(l); g.letterSpacing = spacing(l);
      const [px, py] = XY(l.lat, l.lon), tw = g.measureText(textFor(l)).width, th = 26;
      let spot = null;
      for (const d of [12, 30, 52, 80, 115]) {
        spot = [[px + d, py - th / 2], [px - d - tw, py - th / 2], [px - tw / 2, py - d - th], [px - tw / 2, py + d],
          [px + d * .7, py - d * .7 - th], [px - d * .7 - tw, py - d * .7 - th], [px + d * .7, py + d * .7], [px - d * .7 - tw, py + d * .7]]
          .map(([x, yy]) => [x, yy, tw, th]).find(free);
        if (spot) break;
      }
      // a named pass is worth a longer look: every direction, further out (a hairline leads back to it); never across
      // the route. If there's no clean spot, it's left off the picture (it's still on the profile and in the notes).
      if (!spot && l.type === "high") {
        search: for (const d of [20, 40, 65, 95, 130, 170, 220]) for (let k = 0; k < 16; k++) {
          const a = k * Math.PI / 8, cx = Math.cos(a), cy = Math.sin(a);
          const r = [px + cx * (d + tw / 2 * Math.abs(cx)) - tw / 2, py + cy * (d + th / 2 * Math.abs(cy)) - th / 2, tw, th];
          if (free(r)) { spot = r; break search; }
        }
      }
      if (!spot) { g.letterSpacing = "0px"; continue; }
      taken.push(spot);
      g.fillStyle = ink; g.strokeStyle = bg2; g.lineWidth = 3;
      g.beginPath();
      if (l.type === "high") { g.moveTo(px, py - 9); g.lineTo(px + 9, py + 7); g.lineTo(px - 9, py + 7); g.closePath(); } else g.arc(px, py, isCity(l) ? 6 : 5, 0, 7);
      g.fill(); g.stroke();
      // a hairline from the dot when the label had to move away from it
      const [sx, sy] = [Math.max(spot[0], Math.min(px, spot[0] + tw)), Math.max(spot[1], Math.min(py, spot[1] + th))];
      if (Math.hypot(sx - px, sy - py) > 22) { g.strokeStyle = muted; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py); g.lineTo(sx, sy); g.stroke(); }
      g.fillStyle = ink; g.strokeStyle = bg2; g.lineWidth = 6; g.lineJoin = "round";
      g.fillStyle = l.type === "high" || isCity(l) ? ink : muted;
      g.font = fontFor(l); g.letterSpacing = spacing(l); g.strokeText(textFor(l), spot[0], spot[1] + 20); g.fillText(textFor(l), spot[0], spot[1] + 20); g.letterSpacing = "0px";
    }
    if (base) for (const l of labels) { // markers of the names the map placed, over the route
      const isPass = l.type === "high", name = isPass ? l.text : isCityLabel(l) ? l.text.toUpperCase() : l.text;
      if (!base.placed.has(`${isPass ? "passes" : "towns"}|${name}`)) continue;
      const [px, py] = XY(l.lat, l.lon);
      g.fillStyle = ink; g.strokeStyle = css("--bg"); g.lineWidth = 3; g.beginPath();
      if (isPass) { g.moveTo(px, py - 10); g.lineTo(px + 10, py + 8); g.lineTo(px - 10, py + 8); g.closePath(); } else g.arc(px, py, isCityLabel(l) ? 7 : 6, 0, 7);
      g.stroke(); g.fill();
    }
    here.forEach(({ z, n }) => { const [px, py] = hazAt(z); badge(px, py, n, css(z.sev === "bad" ? "--head" : "--cross")); });
    const dot = (i, col, label) => {
      const [a, b] = P(i); g.fillStyle = col; g.beginPath(); g.arc(a, b, 17, 0, 7); g.fill();
      g.strokeStyle = bg2; g.lineWidth = 4; g.stroke(); g.fillStyle = css("--bg"); g.font = `600 18px ${MONO}`; g.textAlign = "center"; g.fillText(label, a, b + 6); g.textAlign = "left";
    };
    if (split) { const [a, b] = P(S[kTurn].i); g.strokeStyle = ink; g.lineWidth = 3; g.fillStyle = bg2; g.beginPath(); g.arc(a, b, 9, 0, 7); g.fill(); g.stroke(); } // the turnaround
    if (hasF) dot(nPts - 1, ink, "F");
    if (hasS) dot(0, ink, "S");
    g.restore();
  };

  if (!ob) panel(box, { inner: L0.pane.inner, windBadge: true });
  else {
    const half = box.w / 2, tKm = tr.cum[S[kTurn].i] / 1000, tAt = state.startMs + locate(tr, tKm * 1000).t * 1000, inner = L0.pane.inner;
    panel({ x: box.x, y: box.y, w: half, h: box.h }, { k0: 0, k1: kTurn, inner, title: `→ Out · km 0–${r0(tKm)} · ${fmtTime(state.startMs)}–${fmtTime(tAt)}` });
    panel({ x: box.x + half, y: box.y, w: half, h: box.h }, { k0: kTurn, k1: last, inner, title: `← Back · km ${r0(tKm)}–${r0(tr.total / 1000)} · ${fmtTime(tAt)}–${fmtTime(state.endMs)}` });
    g.strokeStyle = css("--line"); g.lineWidth = 2; g.beginPath(); g.moveTo(box.x + half, box.y + 18); g.lineTo(box.x + half, box.y + box.h - 58); g.stroke();
  }
  // key: colours, and thickness for strength (plus the wind, compactly, when there are two maps)
  const ks = ob ? 20 : 22;
  g.font = `500 ${ks}px ${BODY}`; let kx2 = box.x + 22;
  for (const [cat, lbl] of [["head", "headwind"], ["cross", "crosswind"], ["tail", "tailwind"]]) {
    g.fillStyle = catColor(cat); g.fillRect(kx2, box.y + box.h - 34, 22, 8); g.fillStyle = muted; g.fillText(lbl, kx2 + 30, box.y + box.h - 24); kx2 += g.measureText(lbl).width + (ob ? 46 : 56);
  }
  g.fillStyle = muted; g.fillRect(kx2, box.y + box.h - 33, 26, 4); g.fillRect(kx2 + 34, box.y + box.h - 37, 26, 14);
  g.fillText("calm → strong", kx2 + 70, box.y + box.h - 24);
  if (ob) {
    g.textAlign = "right"; g.fillStyle = ink; g.font = `600 ${ks}px ${BODY}`;
    g.fillText(`from ${compass(from)} · ${windRange}`, box.x + box.w - 22, box.y + box.h - 24); g.textAlign = "left";
    arrow(box.x + box.w - 30 - g.measureText(`from ${compass(from)} · ${windRange}`).width - 18, box.y + box.h - 31, .55);
  }

  // elevation profile
  y = box.y + box.h + 26;
  if (tr.hasEle) {
    const eh = 58, emin = Math.min(...tr.ele), emax = Math.max(...tr.ele), ex = i => PAD + tr.cum[i] / tr.total * (W - 2 * PAD), ey = i => y + eh - (tr.ele[i] - emin) / ((emax - emin) || 1) * eh;
    g.fillStyle = css("--elev"); g.beginPath(); g.moveTo(PAD, y + eh);
    for (let i = 0; i < tr.pts.length; i += Math.max(1, Math.floor(tr.pts.length / 600))) g.lineTo(ex(i), ey(i));
    g.lineTo(W - PAD, y + eh); g.closePath(); g.fill();
    g.fillStyle = muted; g.font = `500 20px ${BODY}`; g.fillText(`${r0(emax)} m`, PAD, y - 6);
    y += eh + 30;
  }

  // six numbers
  const avgHead = S.reduce((a, s) => a + s.head * s.dt, 0) / (sim.moving || 1), peak = maxOf(S, "precip"), lvl = rainLevel(peak);
  const water = state.pois ? waterGap(state.pois.filter(p => p.kind === "water"), tr.total / 1000) : null;
  const tiles = [
    ["Ride time", fmtDur(sim.dur), sim.stopSec ? `incl. ${r0(sim.stopSec / 60)} min stops` : "moving"],
    ["On the bike", `${span(minOf(S, "bike"), maxOf(S, "bike"))} °C`, `air ${span(minOf(S, "temp"), maxOf(S, "temp"))} °C`],
    ["Wind for you", `${avgHead >= 0 ? "+" : "−"}${r1(Math.abs(avgHead))} km/h`, avgHead >= 0.5 ? "headwind on average" : avgHead <= -0.5 ? "tailwind on average" : "about neutral"],
    ["Rain", lvl[1] === "dry" ? "Dry" : lvl[2], lvl[1] === "dry" ? `${r0(maxOf(S, "pop"))}% max chance` : `up to ${r1(peak)} mm/h`],
    ["Gusts", `${r0(maxOf(S, "gust"))} km/h`, "strongest"],
    water ? ["Water", water.len > 0 ? `${r0(water.len)} km` : "—", "longest stretch without"] : ["Finish", fmtTime(state.endMs), fmtDay(state.endMs)]
  ];
  const tw = (W - 2 * PAD - 2 * 32) / 3, th = 112;
  g.strokeStyle = line; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, y); g.lineTo(W - PAD, y); g.stroke();
  tiles.forEach(([l, v, d], k) => {
    const tx = PAD + (k % 3) * (tw + 32), ty = y + 8 + Math.floor(k / 3) * (th + 8);
    g.fillStyle = muted; g.font = `400 21px ${BODY}`; g.fillText(l, tx, ty + 30);
    g.fillStyle = ink; g.font = `500 40px ${MONO}`; g.fillText(v, tx, ty + 76);
    g.fillStyle = muted; g.font = `400 21px ${BODY}`; g.fillText(d, tx, ty + 104);
  });
  const end = y + 8 + 2 * th + 8 + 14;
  g.strokeStyle = line; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, end); g.lineTo(W - PAD, end); g.stroke();
  y = end + 58;

  // what matters most: hazards first, then rain and kit advice
  const lines = [
    ...shownHaz.map((z, k) => ({ col: css(z.sev === "bad" ? "--head" : "--cross"), n: k + 1, text: `${HAZ[z.type]} ${plain(hazWhere(z))}` })),
    ...(state.notes || []).filter(([, t]) => /^(Light|Moderate|Heavy|Violent|Drizzle|Showers|Kit)/.test(t)).map(([cls, t]) => ({ col: css(cls === "bad" ? "--head" : cls === "warn" ? "--cross" : "--accent"), text: plain(t) }))
  ].slice(0, 3);
  g.font = `500 27px ${BODY}`;
  for (const l of lines) {
    g.font = `500 27px ${BODY}`; // (a number badge changes the font)
    // up to two lines each; whatever doesn't fit above the footer is shortened, not dropped
    const room = Math.min(2, Math.floor((H - 130 - y) / 36) + 1);
    if (room < 1) break;
    let rows = wrap(g, l.text, W - 2 * PAD - 34);
    if (rows.length > room) {
      rows = rows.slice(0, room);
      let last = rows[room - 1];
      while (last && g.measureText(last + "…").width > W - 2 * PAD - 34) last = last.replace(/\s*\S+$/, "");
      rows[room - 1] = last + "…";
    }
    if (l.n) badge(PAD + 11, y - 9, l.n, l.col, 13); // same number as on the outline
    else { g.fillStyle = l.col; g.beginPath(); g.arc(PAD + 8, y - 9, 8, 0, 7); g.fill(); }
    g.fillStyle = ink; g.font = `500 27px ${BODY}`; rows.forEach((r, i) => g.fillText(r, PAD + 38, y + i * 36));
    y += rows.length * 36 + 10;
  }

  // footer
  g.strokeStyle = line; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, H - 108); g.lineTo(W - PAD, H - 108); g.stroke();
  g.fillStyle = muted; g.font = `400 22px ${MONO}`;
  g.fillText("Ride Forecast · weather along your route, when you ride it", PAD, H - 66);
  return c;
}

// a PNG File built synchronously, so navigator.share still counts as part of the tap
export function cardFile(dataUrl, name) {
  const bin = atob(dataUrl.split(",")[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}
