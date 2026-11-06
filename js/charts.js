import { compass, locate } from "./geo.js";
import { setHover } from "./hover.js";
import { catColor } from "./render.js";
import { state } from "./state.js";
import { fmtDay, fmtDur, fmtTime, msToWall } from "./time.js";
import { $, HOUR, alpha, css, r0, r1 } from "./util.js";
import { rainLevel } from "./weather.js";

export let charts = [], bestChart = null;

// dashed crosshair at the hovered km, plus faint lines at planned stops
export const crosshair = {
  id: "crosshair",
  afterDatasetsDraw(c, _, o) {
    if (o.off || !c.scales.x || c.config.type === "polarArea" || !state.opts) return;
    const { top, bottom, left, right } = c.chartArea, g = c.ctx;
    const vline = (km, alpha, dash) => {
      const x = c.scales.x.getPixelForValue(km);
      if (x < left || x > right) return;
      g.save(); g.strokeStyle = css("--ink"); g.globalAlpha = alpha; g.setLineDash(dash); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke(); g.restore();
    };
    if (c.canvas.id === "cElev" && state.hazards) {
      const S = state.samples, half = S[1] ? (S[1].km - S[0].km) / 2 : 0;
      state.hazards.forEach(z => {
        const x0 = Math.max(left, c.scales.x.getPixelForValue(S[z.k0].km - half)), x1 = Math.min(right, c.scales.x.getPixelForValue(S[z.k1].km + half));
        g.save(); g.fillStyle = css(z.sev === "bad" ? "--head" : "--cross"); g.globalAlpha = .14; g.fillRect(x0, top, x1 - x0, bottom - top); g.restore();
      });
    }
    state.opts.stops.forEach(st => vline(st.km, .22, [2, 3]));
    if (state.hoverKm != null) vline(state.hoverKm, .55, [4, 3]);
  }
};
Chart.register(crosshair);

export function chartTheme() {
  const ink = css("--ink"), muted = css("--muted"), line = css("--line");
  Chart.defaults.font.family = css("--body"); Chart.defaults.font.size = 12; Chart.defaults.color = muted;
  return { ink, muted, line, tooltip: { backgroundColor: css("--surface"), titleColor: ink, bodyColor: ink, borderColor: line, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true, titleFont: { weight: "600" } } };
}

// Rebuilds all charts, or only the ids in `only` (e.g. when ensemble or air-quality data arrive later).
export function renderCharts(only) {
  const want = id => !only || only.includes(id);
  charts = charts.filter(c => { if (want(c.canvas.id)) { c.destroy(); return false; } return true; });
  const S = state.samples, tr = state.track, maxKm = tr.total / 1000, E = state.ens;
  const { ink, muted, line, tooltip } = chartTheme();
  const xy = k => S.map(s => ({ x: s.km, y: s[k] }));
  const hover = (e, _, c) => { const km = c.scales.x.getValueForPixel(e.x); if (km >= 0 && km <= maxKm) setHover(km); };
  const xAxis = { type: "linear", min: 0, max: maxKm, offset: false, grid: { color: line }, border: { color: line }, ticks: { maxTicksLimit: 8, callback: v => r0(v) + " km" } };
  const yAx = extra => Object.assign({ grid: { color: line }, border: { display: false } }, extra);
  const opts = (scales, unit, legend = true) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "nearest", axis: "x", intersect: false }, onHover: hover,
    plugins: {
      legend: { display: legend, position: "bottom", labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, color: ink, filter: i => !i.text.startsWith("_") } },
      tooltip: Object.assign({}, tooltip, { mode: "nearest", axis: "x", intersect: false, filter: i => !i.dataset.label.startsWith("_") && !i.dataset.band,
        callbacks: { title: it => it.length ? `km ${r1(it[0].parsed.x)} · ${fmtTime(state.startMs + locate(tr, it[0].parsed.x * 1000).t * 1000)}` : "", label: i => ` ${i.dataset.label}: ${r1(i.parsed.y)}${unit}` } })
    },
    scales: Object.assign({ x: xAxis }, scales)
  });
  const lineDs = (label, data, color, extra) => Object.assign({ type: "line", label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .35, pointStyle: "line" }, extra);
  // ensemble 10–90% band: invisible lower edge plus an upper edge filled down to it
  const band = (lo, hi, color, label) => E && E.some(Boolean) ? [
    lineDs("_lo", S.map((s, k) => ({ x: s.km, y: E[k] ? E[k][lo] : null })), "transparent", { borderWidth: 0, pointHoverRadius: 0, spanGaps: true }),
    lineDs(label, S.map((s, k) => ({ x: s.km, y: E[k] ? E[k][hi] : null })), "transparent", { borderWidth: 0, pointHoverRadius: 0, fill: "-1", backgroundColor: alpha(color, .16), spanGaps: true, pointStyle: "rect", band: true })
  ] : [];
  const mk = (id, cfg) => { if (!want(id.slice(1))) return null; const c = new Chart($(id), cfg); c.canvas.addEventListener("mouseleave", () => setHover(null)); charts.push(c); return c; };

  // elevation strip under the map
  const step = Math.max(1, Math.floor(tr.pts.length / 500)), prof = [];
  for (let i = 0; i < tr.pts.length; i += step) prof.push({ x: tr.cum[i] / 1000, y: tr.ele[i] });
  prof.push({ x: maxKm, y: tr.ele[tr.ele.length - 1] });
  const eo = opts({ y: yAx({ ticks: { maxTicksLimit: 3, callback: v => v + " m" } }) }, " m", false);
  eo.scales.x.ticks.maxTicksLimit = 10;
  mk("#cElev", { type: "line", data: { datasets: [lineDs("Elevation", tr.hasEle ? prof : [], muted, { fill: "origin", backgroundColor: alpha(css("--elev"), .7), borderWidth: 1.25, tension: .2 })] }, options: eo });

  mk("#cTemp", { type: "line", data: { datasets: [
    ...band("t10", "t90", css("--warm"), "Likely range"),
    lineDs("Air temperature", xy("temp"), css("--warm")),
    lineDs("On the bike", xy("bike"), css("--cool"), { borderDash: [5, 4] })
  ] }, options: opts({ y: yAx({ ticks: { callback: v => v + "°" } }) }, " °C") });

  mk("#cWind", { type: "bar", data: { datasets: [
    ...band("w10", "w90", ink, "Likely range (10 m)"),
    { type: "bar", label: "Head(+)/tail(−) for you", data: xy("head"), backgroundColor: S.map(s => alpha(s.head >= 0 ? css("--head") : css("--tail"), .6)), borderWidth: 0, borderRadius: 3, barPercentage: 1, categoryPercentage: .85, order: 5, pointStyle: "rect" },
    lineDs("Wind (10 m)", xy("ws"), ink),
    lineDs("Gusts", xy("gust"), muted, { borderDash: [4, 4], borderWidth: 1.5 })
  ] }, options: opts({ y: yAx({ ticks: { callback: v => v } }) }, " km/h") });

  mk("#cRain", { type: "bar", data: { datasets: [
    { type: "bar", label: "Rain chance", data: xy("pop"), backgroundColor: alpha(css("--cool"), .75), borderWidth: 0, borderRadius: 3, barPercentage: 1, categoryPercentage: .85, pointStyle: "rect" },
    ...(E && E.some(e => e && e.rain != null) ? [lineDs("Second opinion: % of forecast runs with rain", S.map((s, k) => ({ x: s.km, y: E[k] ? E[k].rain : null })), ink, { stepped: "middle", tension: 0, spanGaps: true })] : []),
    lineDs("Cloud cover", xy("cloud"), muted, { fill: "origin", backgroundColor: alpha(css("--elev"), .35), borderWidth: 1.5, order: 10 })
  ] }, options: opts({ y: yAx({ min: 0, max: 100, ticks: { callback: v => v + "%" } }) }, "%") });

  // how hard it rains when you pass; bars shade darker with intensity. On a dry ride the empty chart folds to one line.
  const wet = S.some(s => s.precip >= 0.1);
  if (want("cRainAmt")) { $(".rain-amt").hidden = !wet; $("#rainAmtNone").hidden = wet; }
  const lvlAlpha = { dry: 0, drizzle: .3, light: .55, moderate: .8, heavy: 1, violent: 1 };
  mk("#cRainAmt", { type: "bar", data: { datasets: [
    { type: "bar", label: "Rain", data: xy("precip"), backgroundColor: S.map(s => alpha(css("--cool"), lvlAlpha[rainLevel(s.precip)[1]] || .3)), borderWidth: 0, borderRadius: 3, barPercentage: 1, categoryPercentage: .85 }
  ] }, options: opts({ y: yAx({ min: 0, suggestedMax: 2.5, ticks: { maxTicksLimit: 4, callback: v => v + " mm" } }) }, " mm/h", false) });
  const ra = charts.find(c => c.canvas.id === "cRainAmt");
  if (ra) ra.options.plugins.tooltip.callbacks.label = i => ` ${rainLevel(i.parsed.y)[2]}: ${r1(i.parsed.y)} mm/h`;

  mk("#cSpeed", { type: "line", data: { datasets: [
    lineDs("With wind", xy("spd"), css("--accent")),
    lineDs("Still air", xy("spd0"), muted, { borderDash: [4, 4], borderWidth: 1.5 })
  ] }, options: opts({ y: yAx({ suggestedMin: 0, ticks: { callback: v => v } }) }, " km/h") });

  mk("#cUV", { type: "line", data: { datasets: [lineDs("UV index", xy("uv"), css("--warm"), { fill: "origin", backgroundColor: alpha(css("--warm"), .16), tension: .3 })] },
    options: opts({ y: yAx({ min: 0, suggestedMax: 8, ticks: { stepSize: 2 } }) }, "", false) });

  const A = state.air, hasAir = A && A.some(Boolean);
  // no air-quality forecast (yet, or this far ahead): its chart folds to one line and UV takes the room
  if (want("cAir")) {
    $(".air-part").hidden = !hasAir; $("#airNone").hidden = hasAir;
    $("#airNone").textContent = A === undefined ? "Air quality: loading…" : "Air quality: no forecast for this date (it covers about the next 5 days).";
  }
  mk("#cAir", { type: "line", data: { datasets: hasAir ? [lineDs("European AQI", S.map((s, k) => ({ x: s.km, y: A[k] ? A[k].aqi : null })), css("--accent"), { spanGaps: true, fill: "origin", backgroundColor: alpha(css("--accent"), .12) })] : [] },
    options: opts({ y: yAx({ min: 0, suggestedMax: 60, ticks: { stepSize: 20 } }) }, "", false) });
  $("#airSub").textContent = "European AQI · under 20 good, 20–40 fair, 40–60 moderate, 60+ poor";
}

/* ---------- best time to leave ----------
   Every start on the day, as Route Library's Weather view scores a route: the weather cost is how much worse than
   the same ride in still, dry air, split into what causes it. Dots use the same bands (●●●●● under 5%). */
export const STARS = [[0.05, 5], [0.12, 4], [0.25, 3], [0.45, 2], [Infinity, 1]];
export const starsFor = cost => STARS.find(([max]) => cost < max)[1];
export const dotsHtml = n => `<span class="dots" aria-label="${n} of 5">${"●".repeat(n)}<span>${"●".repeat(5 - n)}</span></span>`;
// evaluate()'s score is ride minutes plus penalties; take away the still-air ride and what's left is the weather
export function costParts(c, stillMin) {
  return { wind: c.dur / 60 - stillMin, rain: 0.8 * c.wet + 2 * c.storm + 0.2 * c.wetRd, cold: 3 * Math.max(0, 4 - c.minBike), dark: 0.5 * c.dark };
}
const PARTS = [["wind", "Wind", "--head"], ["rain", "Rain, wet roads", "--cool"], ["cold", "Cold", "--cold"], ["dark", "Dark", "--dark"]];

// draws the five-dot rating under each bar (when the bars are wide enough) and shades the chosen start
const bestMarks = {
  id: "bestMarks",
  beforeDatasetsDraw(c, _, o) {
    if (!o || o.cur == null) return;
    const meta = c.getDatasetMeta(0), el = meta.data[o.cur]; if (!el) return;
    const w = (c.chartArea.right - c.chartArea.left) / meta.data.length, g = c.ctx;
    g.save(); g.fillStyle = css("--selected"); g.fillRect(el.x - w / 2, c.chartArea.top, w, c.chartArea.bottom - c.chartArea.top); g.restore();
  },
  afterDatasetsDraw(c, _, o) {
    if (!o || !o.stars) return;
    const meta = c.getDatasetMeta(0), w = (c.chartArea.right - c.chartArea.left) / meta.data.length, g = c.ctx;
    if (w < 13) return;
    const size = Math.min(7, Math.max(5, w / 6)), y0 = c.chartArea.bottom + 30;
    g.save(); g.fillStyle = css("--ink");
    meta.data.forEach((el, i) => {
      const n = o.stars[i];
      if (w >= size * 5.2) { for (let k = 0; k < n; k++) { g.beginPath(); g.arc(el.x + (k - (n - 1) / 2) * size, y0, size * 0.32, 0, 2 * Math.PI); g.fill(); } }
      else { g.font = `500 10px ${css("--mono")}`; g.textAlign = "center"; g.fillText(String(n), el.x, y0 + 3); }
    });
    g.restore();
  }
};
Chart.register(bestMarks);

export function renderBest() {
  const B = state.best, cur = state.startMs, sim = state.sim;
  if (bestChart) { bestChart.destroy(); bestChart = null; }
  if (!B || B.length < 2) {
    $("#picks").innerHTML = `<li class="hint">Not enough forecast data on this day to compare start times.</li>`;
    $("#bestLegend").innerHTML = ""; $("#dayPick").innerHTML = ""; return;
  }
  const stillMin = sim.dur / 60 - sim.windMin, stillMoving = Math.max(1, stillMin - sim.stopSec / 60);
  const info = c => { const parts = costParts(c, stillMin), min = Object.values(parts).reduce((a, b) => a + b, 0), cost = min / stillMoving; return { parts, min, cost, stars: starsFor(cost) }; };
  const I = B.map(info);
  // top three, at least an hour apart
  const ranked = [...B].sort((a, b) => a.score - b.score), top = [];
  for (const c of ranked) { if (top.every(t => Math.abs(t.ms - c.ms) >= HOUR)) top.push(c); if (top.length === 3) break; }
  const curIdx = B.reduce((a, b, i) => Math.abs(b.ms - cur) < Math.abs(B[a].ms - cur) ? i : a, 0), mine = B[curIdx];
  const why = c => [fmtDur(c.dur), c.wet / (c.dur / 60) < 0.1 ? "dry" : `${r0(100 * c.wet / (c.dur / 60))}% rain risk${c.mm >= 0.5 ? `, ~${r1(c.mm)} mm` : ""}`, c.dark > 1 ? `${r0(c.dark)} min dark` : "daylight", ...(c.storm > 1 ? ["storm risk"] : []), ...(c.wetRd > 10 ? ["wet roads"] : []), `${c.head >= 0 ? "head" : "tail"} ${r0(Math.abs(c.head))}`].join(" · ");
  const pct = x => `${x >= 0 ? "+" : "−"}${r0(Math.abs(x) * 100)}%`;
  const same = c => Math.abs(c.ms - cur) < 6e4;
  $("#picks").innerHTML = top.map(c => { const i = B.indexOf(c), it = I[i];
    return `<li class="pick${same(c) ? " selected" : ""}" data-ms="${c.ms}" tabindex="0" role="button" aria-label="Start at ${fmtTime(c.ms)}"><span class="t">${fmtTime(c.ms)}</span><span class="m">${why(c)}</span><span class="cost">${pct(it.cost)}</span>${dotsHtml(it.stars)}</li>`; }).join("");

  // the start you picked, broken down
  const mi = I[curIdx], parts = PARTS.map(([k, name]) => Math.abs(mi.parts[k]) >= 0.5 ? `${name.split(",")[0].toLowerCase()} ${mi.parts[k] >= 0 ? "+" : "−"}${r0(Math.abs(mi.parts[k]))} min` : null).filter(Boolean);
  const sun = state.sun || {}, flags = [mine.end > sun.set && sun.set ? "home after sunset" : null, mine.ms < sun.rise && sun.rise ? "starts before sunrise" : null].filter(Boolean);
  const better = top[0] && !same(top[0]) && mine.score - top[0].score >= 5;
  $("#dayPick").innerHTML = `<span class="t">${fmtTime(mine.ms)}</span><span>home ${fmtTime(mine.end)}${flags.length ? `, <span class="late">${flags.join(", ")}</span>` : ""}</span><span class="cost">${pct(mi.cost)}</span>${dotsHtml(mi.stars)}<span class="parts">${parts.join(" · ") || "as good as a still, dry day"}</span>` +
    (better ? `<button class="btn" type="button" data-ms="${top[0].ms}">Leave at ${fmtTime(top[0].ms)} instead: ${r0(mine.score - top[0].score)} effective min better</button>` : "");
  $("#bestSub").textContent = `${fmtDay(cur)} · every half hour, scored like Route Library's Weather view: how much worse than the same ride in still, dry air. Shorter bars are better.`;

  const { ink, line, tooltip } = chartTheme();
  const datasets = PARTS.map(([k, label, tok]) => ({
    label, data: I.map(it => r1(it.parts[k] / stillMoving * 100)),
    backgroundColor: k === "wind" ? I.map(it => it.parts.wind < 0 ? css("--tail") : css(tok)) : css(tok),
    borderWidth: 0, borderRadius: 2, borderSkipped: false, stack: "cost", categoryPercentage: .86, barPercentage: .9
  }));
  bestChart = new Chart($("#cBest"), { type: "bar", data: { labels: B.map(c => fmtTime(c.ms)), datasets },
    options: { responsive: true, maintainAspectRatio: false, animation: false, layout: { padding: { bottom: 20, right: 14 } },
      plugins: { legend: { display: false }, crosshair: { off: true }, bestMarks: { cur: curIdx, stars: I.map(it => it.stars) },
        tooltip: Object.assign({}, tooltip, { mode: "index", intersect: false, filter: i => Math.abs(i.parsed.y) >= 0.05,
          callbacks: { title: it => `Start ${it[0].label} · ${pct(I[it[0].dataIndex].cost)} · ${"●".repeat(I[it[0].dataIndex].stars)}`, label: i => ` ${i.dataset.label}: ${i.parsed.y >= 0 ? "+" : "−"}${r0(Math.abs(I[i.dataIndex].parts[PARTS[i.datasetIndex][0]]))} min`, footer: it => why(B[it[0].dataIndex]) } }) },
      scales: { x: { stacked: true, grid: { display: false }, border: { color: line }, ticks: { autoSkip: false, maxRotation: 0, color: ink, padding: 6, font: { family: css("--mono"), size: 11 }, callback: function (v, i) { const every = this.chart.width < 560 ? 4 : this.chart.width < 1500 ? 2 : 1; return B[i] && msToWall(B[i].ms).endsWith(":00") && +msToWall(B[i].ms).slice(11, 13) % every === 0 ? fmtTime(B[i].ms) : ""; } } },
        y: { stacked: true, grid: { color: line }, border: { display: false }, suggestedMin: 0, ticks: { font: { family: css("--mono"), size: 11 }, callback: v => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + "%" } } },
      onClick: (_, els) => { if (els.length) document.dispatchEvent(new CustomEvent("rf:start", { detail: B[els[0].index].ms })); } } });
  $("#bestLegend").innerHTML = PARTS.map(([, label, tok]) => `<span class="key"><b class="sq" style="background:var(${tok})"></b>${label}</span>`).join("") +
    `<span class="key"><b class="sq" style="background:var(--tail)"></b>Wind helps</span><span>Click a bar to use that start.</span>`;
}

/* ---------- wind around you: time with the wind from each side ----------
   16 sectors whose edges sit on multiples of 22.5°, so the head (±45°) and tail (±135°) limits used everywhere
   else fall on wedge edges and each wedge is one colour. Radius ∝ √time, so a wedge's area reads as time. */
export function exposure(S, part = "all") {
  const half = S.length ? S[S.length - 1].km / 2 : 0, sec = new Array(16).fill(0), tot = { head: 0, cross: 0, tail: 0 };
  S.forEach(s => {
    if (!s.dt || (part === "first" && s.km > half) || (part === "second" && s.km <= half)) return;
    sec[Math.floor(((s.rel % 360) + 360) % 360 / 22.5) % 16] += s.dt / 60;
    tot[s.cat] += s.dt / 60;
  });
  return { sec, tot };
}
const secKind = i => { const a = i * 22.5 + 11.25, r = a > 180 ? 360 - a : a; return r < 45 ? "head" : r > 135 ? "tail" : "cross"; };
export function renderExposure() {
  const S = state.samples; if (!S) return;
  const part = state.expoPart || "all", { sec, tot } = exposure(S, part), whole = exposure(S, "all");
  const svg = $("#rose"), NS = "http://www.w3.org/2000/svg", RMAX = 112, MMAX = Math.max(1, ...whole.sec);
  const el = (tag, a, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; };
  const pt = (d, r) => { const t = (d - 90) * Math.PI / 180; return [r * Math.cos(t), r * Math.sin(t)]; };
  svg.replaceChildren();
  [0.25, 0.5, 1].forEach(f => el("circle", { class: "ring", r: RMAX * Math.sqrt(f) }));
  [0, 45, 90, 135].forEach(a => { const [x, y] = pt(a, RMAX); el("line", { class: "spoke", x1: x, y1: y, x2: -x, y2: -y }); });
  const col = { head: css("--head"), cross: css("--cross"), tail: css("--tail") };
  sec.forEach((m, i) => {
    if (m < 0.5) return;
    const R = RMAX * Math.sqrt(m / MMAX), a0 = i * 22.5 + 1, a1 = (i + 1) * 22.5 - 1, [x1, y1] = pt(a0, R), [x2, y2] = pt(a1, R);
    const w = el("path", { class: "wedge", d: `M0 0L${x1.toFixed(1)} ${y1.toFixed(1)}A${R.toFixed(1)} ${R.toFixed(1)} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}Z`, fill: col[secKind(i)] });
    const mid = i * 22.5 + 11.25, side = mid < 180 ? "right" : "left", off = r0(mid < 180 ? mid : 360 - mid);
    el("title", {}, w).textContent = `${r0(m)} min · wind ${off < 23 ? "from ahead" : off > 157 ? "from behind" : `${off}° from ${side === "right" ? "the right" : "the left"}`}`;
  });
  [["Head", 0, "middle", 20], ["Right", 90, "start", 8], ["Tail", 180, "middle", 20], ["Left", 270, "end", 8]].forEach(([n, a, anchor, gap]) => {
    const [x, y] = pt(a, RMAX + gap); el("text", { class: "lab", x, y: y + 4, "text-anchor": anchor }).textContent = n;
  });
  el("path", { d: "M0 -9L6 7L0 3L-6 7Z", fill: css("--ink") }); // you, riding up the page

  const all = tot.head + tot.cross + tot.tail || 1, fmt = m => m < 60 ? `${r0(m)} min` : fmtDur(m * 60);
  const K = [["head", "Headwind", "--head"], ["cross", "Crosswind", "--cross"], ["tail", "Tailwind", "--tail"]];
  $("#expoLabel").textContent = `Wind mix · ${fmt(all)} moving${part === "all" ? "" : ` in the ${part} half`}`;
  $("#expoBar").innerHTML = K.map(([k, , c]) => `<i style="flex:${tot[k]};background:var(${c})"></i>`).join("");
  $("#expoStats").innerHTML = K.map(([k, n, c]) => `<div><dt><b style="background:var(${c})"></b>${n}</dt><dd>${fmt(tot[k])} <small>${r0(100 * tot[k] / all)}%</small></dd></div>`).join("");
  const h1 = exposure(S, "first").tot.head, h2 = exposure(S, "second").tot.head, hShare = h1 + h2 ? h2 / (h1 + h2) : 0.5;
  $("#expoNote").textContent = part === "all"
    ? (h1 + h2 < 5 ? "Hardly any headwind on this ride." : hShare >= 0.65 ? `Most of the headwind (${r0(hShare * 100)}%) is in the second half: save something for it.` : hShare <= 0.35 ? `Most of the headwind (${r0((1 - hShare) * 100)}%) is in the first half; the way back is easier.` : "The headwind is spread over the whole ride.")
    : `${r0(100 * tot.head / all)}% of it into the wind.`;
}
