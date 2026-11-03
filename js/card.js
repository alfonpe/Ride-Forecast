import { HAZ } from "./hazards.js";
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

  // route outline, coloured by the wind you get on each stretch
  const box = { x: PAD, y: y + 30, w: W - 2 * PAD, h: 430 };
  const lat0 = rad(tr.pts[0].lat), kx = Math.cos(lat0);
  const xs = tr.pts.map(p => p.lon * kx), ys = tr.pts.map(p => p.lat);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((box.w - 40) / ((x1 - x0) || 1e-6), (box.h - 40) / ((y1 - y0) || 1e-6));
  const ox = box.x + (box.w - (x1 - x0) * sc) / 2, oy = box.y + (box.h + (y1 - y0) * sc) / 2;
  const P = i => [ox + (xs[i] - x0) * sc, oy - (ys[i] - y0) * sc];
  g.fillStyle = css("--surface-2"); g.beginPath(); g.roundRect(box.x, box.y, box.w, box.h, 24); g.fill();
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 16; g.beginPath(); tr.pts.forEach((_, i) => { const [a, b] = P(i); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.stroke();
  g.lineWidth = 9;
  for (let k = 0; k < S.length - 1; k++) {
    g.strokeStyle = catColor(S[k].cat); g.beginPath();
    for (let i = S[k].i; i <= Math.min(S[k + 1].i + 1, tr.pts.length - 1); i++) { const [a, b] = P(i); i === S[k].i ? g.moveTo(a, b) : g.lineTo(a, b); }
    g.stroke();
  }
  const dot = (i, col, label) => {
    const [a, b] = P(i); g.fillStyle = col; g.beginPath(); g.arc(a, b, 17, 0, 7); g.fill();
    g.strokeStyle = "#fff"; g.lineWidth = 4; g.stroke(); g.fillStyle = "#fff"; g.font = `700 18px ${FONT}`; g.textAlign = "center"; g.fillText(label, a, b + 6); g.textAlign = "left";
  };
  dot(tr.pts.length - 1, css("--head"), "F"); dot(0, css("--tail"), "S");
  // key
  g.font = `500 22px ${BODY}`; let kx2 = box.x + 22;
  for (const [cat, lbl] of [["head", "headwind"], ["cross", "crosswind"], ["tail", "tailwind"]]) {
    g.fillStyle = catColor(cat); g.fillRect(kx2, box.y + box.h - 34, 22, 8); g.fillStyle = muted; g.fillText(lbl, kx2 + 30, box.y + box.h - 24); kx2 += g.measureText(lbl).width + 64;
  }

  // elevation profile
  y = box.y + box.h + 26;
  if (tr.hasEle) {
    const eh = 96, emin = Math.min(...tr.ele), emax = Math.max(...tr.ele), ex = i => PAD + tr.cum[i] / tr.total * (W - 2 * PAD), ey = i => y + eh - (tr.ele[i] - emin) / ((emax - emin) || 1) * eh;
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
  const tw = (W - 2 * PAD - 2 * 20) / 3, th = 132;
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
export function cardFile(canvas, name) {
  const bin = atob(canvas.toDataURL("image/png").split(",")[1]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}
