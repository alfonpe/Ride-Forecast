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

/* ---------- the map behind the route, in Route Library's quiet style ----------
   Land in the panel colour, the sea and the coastline, nothing else: the card adds its own towns and passes.
   Drawn once per route/theme with MapLibre on a hidden canvas (OpenFreeMap vector data, which doesn't taint the
   canvas), kept as a picture with its bounds, so drawCard() can stay synchronous. Until it's ready, or without
   WebGL, the card draws on the plain panel as before. */
let cardMap = null, pending = null;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const darkTheme = () => (css("--bg").match(/\w\w/g) || ["ff"]).reduce((a, h) => a + parseInt(h, 16), 0) < 384;
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
  if (tops.some(t => t.lat >= b.n - span * 0.06)) pane.inner.t += 34;
  if (tops.some(t => t.lat <= b.s + span * 0.06)) pane.inner.b += 34;
  const key = [tr.total, tr.pts.length, tr.pts[0].lat, tr.pts[0].lon, b.w, b.e, b.s, b.n, pane.w, pane.inner.t, pane.inner.b, darkTheme()].join("|");
  return { labels, ob, kTurn, pane, b, key };
}
export const cardMapReady = () => !!(state.track && cardMap && cardMap.key === layout().key);
export function prepareCardMap() {
  if (!state.track || !window.maplibregl || maplibregl.supported?.() === false) return Promise.resolve(false);
  const { pane, b, key } = layout();
  if (cardMap && cardMap.key === key) return Promise.resolve(true);
  if (pending && pending.key === key) return pending.done;
  const dark = darkTheme(), land = css("--surface-2");
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:-20000px;top:0;width:${pane.w}px;height:${pane.h}px;pointer-events:none`;
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
          cardMap = { key, img, w: bb.getWest(), e: bb.getEast(), n: bb.getNorth(), s: bb.getSouth() };
        }
      } catch (e) { ok = false; }
      try { m && m.remove(); } catch (e) { /* gone */ }
      el.remove(); if (pending && pending.key === key) pending = null;
      resolve(ok);
    };
    try {
      m = new maplibregl.Map({ container: el, interactive: false, attributionControl: false, fadeDuration: 0, pixelRatio: 1, preserveDrawingBuffer: true,
        bounds: [[b.w, b.s], [b.e, b.n]], fitBoundsOptions: { padding: { top: pane.inner.t, bottom: pane.inner.b, left: pane.inner.l, right: pane.inner.r }, maxZoom: 14 },
        style: { version: 8, sources: { omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" } }, layers: [
          { id: "land", type: "background", paint: { "background-color": land } },
          { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": dark ? "#20262a" : "#e3e9ec" } },
          { id: "coast", type: "line", source: "omt", "source-layer": "water", paint: { "line-color": dark ? "#36414a" : "#c3ced3", "line-width": 1.2 } }
        ] } });
      m.once("idle", () => finish(true));
      m.on("error", () => {});
      setTimeout(() => finish(false), 10000);
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
    for (const l of [...labels].sort((a, b) => rank(a) - rank(b))) {
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
