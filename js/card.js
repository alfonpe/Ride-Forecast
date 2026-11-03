import { compass } from "./geo.js";
import { HAZ } from "./hazards.js";
import { pickLabels } from "./labels.js";
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
const FONT = '"Inter Tight","Inter",system-ui,sans-serif', BODY = '"Inter",system-ui,sans-serif';
const plain = html => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

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
  g.fillStyle = surface; g.beginPath(); g.roundRect(24, 24, W - 48, H - 48, 36); g.fill();
  g.textBaseline = "alphabetic";

  // header
  let y = PAD + 44;
  g.fillStyle = accent; g.font = `700 24px ${BODY}`; g.fillText("RIDE PLAN", PAD, y);
  y += 58; g.fillStyle = ink; g.font = `700 52px ${FONT}`;
  const name = state.name + (state.orient.rev ? " (reversed)" : "");
  wrap(g, name, W - 2 * PAD).slice(0, 2).forEach((l, i) => g.fillText(l, PAD, y + i * 60));
  y += (wrap(g, name, W - 2 * PAD).length > 1 ? 60 : 0) + 48;
  g.fillStyle = muted; g.font = `500 30px ${BODY}`;
  g.fillText(`${fmtDay(state.startMs)} · ${fmtTime(state.startMs)} → ${fmtTime(state.endMs)} · ${r1(tr.total / 1000)} km${tr.hasEle ? ` · ${r0(tr.gain)} m up` : ""}`, PAD, y);

  // route outline: colour = head/cross/tailwind, thickness = how strong the wind is there
  const box = { x: PAD, y: y + 30, w: W - 2 * PAD, h: 480 };
  const labels = pickLabels(tr, state.places ? state.places.places : [], state.places ? state.places.summits : []);
  const lat0 = rad(tr.pts[0].lat), kx = Math.cos(lat0);
  const xs = tr.pts.map(p => p.lon * kx), ys = tr.pts.map(p => p.lat);
  // the frame also takes in the labelled towns, which can sit a few km off the route
  const allX = [...xs, ...labels.map(l => l.lon * kx)], allY = [...ys, ...labels.map(l => l.lat)];
  const x0 = Math.min(...allX), x1 = Math.max(...allX), y0 = Math.min(...allY), y1 = Math.max(...allY);
  const inner = { l: 36, r: 112, t: 36, b: 64 }; // room for the wind badge (top right) and the key (bottom)
  const sc = Math.min((box.w - inner.l - inner.r) / ((x1 - x0) || 1e-6), (box.h - inner.t - inner.b) / ((y1 - y0) || 1e-6));
  const ox = box.x + inner.l + (box.w - inner.l - inner.r - (x1 - x0) * sc) / 2, oy = box.y + inner.t + (box.h - inner.t - inner.b + (y1 - y0) * sc) / 2;
  const XY = (lat, lon) => [ox + (lon * kx - x0) * sc, oy - (lat - y0) * sc];
  const P = i => XY(tr.pts[i].lat, tr.pts[i].lon);
  const bg2 = css("--surface-2");
  g.fillStyle = bg2; g.beginPath(); g.roundRect(box.x, box.y, box.w, box.h, 24); g.fill();
  g.lineCap = "round"; g.lineJoin = "round";
  const width = s => 3 + Math.min(Math.max(s.ws, 0), 40) / 40 * 19; // 3 px when calm … 22 px at 40+ km/h
  const seg = (k, fn) => { g.beginPath(); for (let i = S[k].i; i <= Math.min(S[k + 1].i + 1, tr.pts.length - 1); i++) { const [a, b] = P(i); i === S[k].i ? g.moveTo(a, b) : g.lineTo(a, b); } fn(); };
  for (let k = 0; k < S.length - 1; k++) seg(k, () => { g.strokeStyle = "rgba(0,0,0,.16)"; g.lineWidth = width(S[k]) + 6; g.stroke(); });
  for (let k = 0; k < S.length - 1; k++) seg(k, () => { g.strokeStyle = catColor(S[k].cat); g.lineWidth = width(S[k]); g.stroke(); });

  // wind badge: the overall direction (averaged as vectors) and the speed range along the ride
  const u = S.reduce((a, s) => a + s.ws * Math.sin(rad(s.wdir)), 0), v = S.reduce((a, s) => a + s.ws * Math.cos(rad(s.wdir)), 0);
  const from = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360, cx = box.x + box.w - 72, cy = box.y + 70;
  g.fillStyle = surface; g.beginPath(); g.arc(cx, cy, 38, 0, 7); g.fill();
  g.save(); g.translate(cx, cy); g.rotate(rad(from + 180)); g.fillStyle = ink;
  g.beginPath(); g.moveTo(0, -24); g.lineTo(12, -2); g.lineTo(4, -2); g.lineTo(4, 22); g.lineTo(-4, 22); g.lineTo(-4, -2); g.lineTo(-12, -2); g.closePath(); g.fill(); g.restore();
  g.textAlign = "center"; g.fillStyle = ink; g.font = `600 22px ${BODY}`;
  g.fillText(`from ${compass(from)}`, cx, cy + 66);
  g.fillStyle = muted; g.font = `500 20px ${BODY}`; g.fillText(`${r0(minOf(S, "ws"))}–${r0(maxOf(S, "ws"))} km/h`, cx, cy + 92);
  g.textAlign = "left";

  // reference labels: towns, the furthest point, the high point. A label goes where it touches neither the route
  // (at its drawn thickness), other labels, the wind badge nor the key; tried at growing distances, else skipped.
  const taken = [[cx - 70, cy - 42, 140, 145], [box.x, box.y + box.h - 52, box.w, 52]];
  for (const i of [0, tr.pts.length - 1]) { const [a, b] = P(i); taken.push([a - 21, b - 21, 42, 42]); } // the S and F markers
  const routePx = [];
  for (let k = 0; k < S.length - 1; k++) {
    const hw = width(S[k]) / 2 + 5;
    for (let i = S[k].i; i <= Math.min(S[k + 1].i, tr.pts.length - 1); i++) { const [a, b] = P(i); routePx.push([a, b, hw]); }
  }
  const hitsLine = ([x, yy, w, h]) => routePx.some(([a, b, hw]) => a > x - hw && a < x + w + hw && b > yy - hw && b < yy + h + hw);
  const free = r => { const [x, yy, w, h] = r; return x >= box.x + 8 && x + w <= box.x + box.w - 8 && yy >= box.y + 8 && yy + h <= box.y + box.h - 8 &&
    !taken.some(([a, b, c, d]) => x < a + c && a < x + w && yy < b + d && b < yy + h) && !hitsLine(r); };
  g.font = `600 23px ${BODY}`;
  for (const l of labels) {
    const [px, py] = XY(l.lat, l.lon), tw = g.measureText(l.text).width, th = 26;
    let spot = null;
    for (const d of [12, 30, 52]) {
      spot = [[px + d, py - th / 2], [px - d - tw, py - th / 2], [px - tw / 2, py - d - th], [px - tw / 2, py + d],
        [px + d * .7, py - d * .7 - th], [px - d * .7 - tw, py - d * .7 - th], [px + d * .7, py + d * .7], [px - d * .7 - tw, py + d * .7]]
        .map(([x, yy]) => [x, yy, tw, th]).find(free);
      if (spot) break;
    }
    if (!spot) continue;
    taken.push(spot);
    g.fillStyle = ink; g.strokeStyle = bg2; g.lineWidth = 3;
    g.beginPath();
    if (l.type === "high" || l.type === "pass") { g.moveTo(px, py - 9); g.lineTo(px + 9, py + 7); g.lineTo(px - 9, py + 7); g.closePath(); } else g.arc(px, py, 6, 0, 7);
    if (l.type === "pass") { g.fillStyle = bg2; g.fill(); g.strokeStyle = ink; g.lineWidth = 2.5; g.stroke(); } else { g.fill(); g.stroke(); }
    // a hairline from the dot when the label had to move away from it
    const [sx, sy] = [Math.max(spot[0], Math.min(px, spot[0] + tw)), Math.max(spot[1], Math.min(py, spot[1] + th))];
    if (Math.hypot(sx - px, sy - py) > 22) { g.strokeStyle = muted; g.lineWidth = 1.5; g.beginPath(); g.moveTo(px, py); g.lineTo(sx, sy); g.stroke(); }
    g.fillStyle = ink; g.strokeStyle = bg2; g.lineWidth = 6; g.lineJoin = "round";
    g.strokeText(l.text, spot[0], spot[1] + 20); g.fillText(l.text, spot[0], spot[1] + 20);
  }

  const dot = (i, col, label) => {
    const [a, b] = P(i); g.fillStyle = col; g.beginPath(); g.arc(a, b, 17, 0, 7); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 4; g.stroke(); g.fillStyle = "#fff"; g.font = `700 18px ${FONT}`; g.textAlign = "center"; g.fillText(label, a, b + 6); g.textAlign = "left";
  };
  dot(tr.pts.length - 1, css("--head"), "F"); dot(0, css("--tail"), "S");
  // key: colours, and thickness for strength
  g.font = `500 22px ${BODY}`; let kx2 = box.x + 22;
  for (const [cat, lbl] of [["head", "headwind"], ["cross", "crosswind"], ["tail", "tailwind"]]) {
    g.fillStyle = catColor(cat); g.fillRect(kx2, box.y + box.h - 34, 22, 8); g.fillStyle = muted; g.fillText(lbl, kx2 + 30, box.y + box.h - 24); kx2 += g.measureText(lbl).width + 56;
  }
  g.fillStyle = muted; g.fillRect(kx2, box.y + box.h - 33, 26, 4); g.fillRect(kx2 + 34, box.y + box.h - 37, 26, 14);
  g.fillText("calm → strong", kx2 + 70, box.y + box.h - 24);

  // elevation profile
  y = box.y + box.h + 26;
  if (tr.hasEle) {
    const eh = 76, emin = Math.min(...tr.ele), emax = Math.max(...tr.ele), ex = i => PAD + tr.cum[i] / tr.total * (W - 2 * PAD), ey = i => y + eh - (tr.ele[i] - emin) / ((emax - emin) || 1) * eh;
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
  const tw = (W - 2 * PAD - 2 * 20) / 3, th = 124;
  tiles.forEach(([l, v, d], k) => {
    const tx = PAD + (k % 3) * (tw + 20), ty = y + Math.floor(k / 3) * (th + 20);
    g.fillStyle = css("--surface-2"); g.beginPath(); g.roundRect(tx, ty, tw, th, 20); g.fill();
    g.fillStyle = muted; g.font = `600 20px ${BODY}`; g.fillText(l.toUpperCase(), tx + 22, ty + 38);
    g.fillStyle = ink; g.font = `600 40px ${FONT}`; g.fillText(v, tx + 22, ty + 86);
    g.fillStyle = muted; g.font = `500 21px ${BODY}`; g.fillText(d, tx + 22, ty + 116);
  });
  y += 2 * th + 20 + 46;

  // what matters most: hazards first, then rain and kit advice
  const lines = [
    ...state.hazards.slice(0, 2).map(z => ({ col: css(z.sev === "bad" ? "--head" : "--cross"), text: `${HAZ[z.type]} ${plain(hazWhere(z))}` })),
    ...(state.notes || []).filter(([, t]) => /^(Light|Moderate|Heavy|Violent|Drizzle|Showers|Kit)/.test(t)).map(([cls, t]) => ({ col: css(cls === "bad" ? "--head" : cls === "warn" ? "--cross" : "--accent"), text: plain(t) }))
  ].slice(0, 3);
  g.font = `500 27px ${BODY}`;
  for (const l of lines) {
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
    g.fillStyle = l.col; g.beginPath(); g.arc(PAD + 8, y - 9, 8, 0, 7); g.fill();
    g.fillStyle = ink; rows.forEach((r, i) => g.fillText(r, PAD + 34, y + i * 36));
    y += rows.length * 36 + 18;
  }

  // footer
  g.strokeStyle = line; g.lineWidth = 2; g.beginPath(); g.moveTo(PAD, H - 108); g.lineTo(W - PAD, H - 108); g.stroke();
  g.fillStyle = muted; g.font = `500 24px ${BODY}`;
  g.fillText("Ride Forecast · weather along your route, when you ride it", PAD, H - 66);
  return c;
}

// a PNG File built synchronously, so navigator.share still counts as part of the tap
export function cardFile(dataUrl, name) {
  const bin = atob(dataUrl.split(",")[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}
