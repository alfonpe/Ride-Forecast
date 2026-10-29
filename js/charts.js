import { compass, locate } from "./geo.js";
import { setHover } from "./hover.js";
import { catColor } from "./render.js";
import { state } from "./state.js";
import { fmtDay, fmtDur, fmtTime } from "./time.js";
import { $, HOUR, alpha, css, r0, r1 } from "./util.js";

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
    ...band("t10", "t90", css("--warm"), "Ensemble 10–90%"),
    lineDs("Air temperature", xy("temp"), css("--warm")),
    lineDs("On the bike", xy("bike"), css("--cool"), { borderDash: [5, 4] })
  ] }, options: opts({ y: yAx({ ticks: { callback: v => v + "°" } }) }, " °C") });

  mk("#cWind", { type: "bar", data: { datasets: [
    ...band("w10", "w90", ink, "Ensemble 10–90% (10 m)"),
    { type: "bar", label: "Head(+)/tail(−) for you", data: xy("head"), backgroundColor: S.map(s => alpha(s.head >= 0 ? css("--head") : css("--tail"), .6)), borderWidth: 0, borderRadius: 3, barPercentage: 1, categoryPercentage: .85, order: 5, pointStyle: "rect" },
    lineDs("Wind (10 m)", xy("ws"), ink),
    lineDs("Gusts", xy("gust"), muted, { borderDash: [4, 4], borderWidth: 1.5 })
  ] }, options: opts({ y: yAx({ ticks: { callback: v => v } }) }, " km/h") });

  mk("#cRain", { type: "bar", data: { datasets: [
    { type: "bar", label: "Rain chance", data: xy("pop"), backgroundColor: alpha(css("--cool"), .75), borderWidth: 0, borderRadius: 3, barPercentage: 1, categoryPercentage: .85, pointStyle: "rect" },
    ...(E && E.some(e => e && e.rain != null) ? [lineDs("Ensemble members with rain", S.map((s, k) => ({ x: s.km, y: E[k] ? E[k].rain : null })), ink, { stepped: "middle", tension: 0, spanGaps: true })] : []),
    lineDs("Cloud cover", xy("cloud"), muted, { fill: "origin", backgroundColor: alpha(css("--elev"), .35), borderWidth: 1.5, order: 10 })
  ] }, options: opts({ y: yAx({ min: 0, max: 100, ticks: { callback: v => v + "%" } }) }, "%") });

  mk("#cSpeed", { type: "line", data: { datasets: [
    lineDs("With wind", xy("spd"), css("--accent")),
    lineDs("Still air", xy("spd0"), muted, { borderDash: [4, 4], borderWidth: 1.5 })
  ] }, options: opts({ y: yAx({ suggestedMin: 0, ticks: { callback: v => v } }) }, " km/h") });

  const card = { 0: "N", 90: "E", 180: "S", 270: "W", 360: "N" };
  const dir = mk("#cDir", { type: "scatter", data: { datasets: [
    { label: "Wind from", data: xy("wdir"), pointRadius: 4.5, pointHoverRadius: 6, backgroundColor: S.map(s => catColor(s.cat)), borderColor: css("--surface"), borderWidth: 1, pointStyle: "circle" },
    { label: "Your heading", data: xy("brg"), pointRadius: 2.2, backgroundColor: muted, borderWidth: 0, pointStyle: "circle" }
  ] }, options: opts({ y: yAx({ min: 0, max: 360, ticks: { stepSize: 45, callback: v => card[v] || compass(v) } }) }, "°") });
  if (dir) dir.options.plugins.tooltip.callbacks.label = i => ` ${i.dataset.label}: ${compass(i.parsed.y)} (${r0(i.parsed.y)}°)`;

  mk("#cUV", { type: "line", data: { datasets: [lineDs("UV index", xy("uv"), css("--warm"), { fill: "origin", backgroundColor: alpha(css("--warm"), .16), tension: .3 })] },
    options: opts({ y: yAx({ min: 0, suggestedMax: 8, ticks: { stepSize: 2 } }) }, "", false) });

  const A = state.air, hasAir = A && A.some(Boolean);
  mk("#cAir", { type: "line", data: { datasets: hasAir ? [lineDs("European AQI", S.map((s, k) => ({ x: s.km, y: A[k] ? A[k].aqi : null })), css("--accent"), { spanGaps: true, fill: "origin", backgroundColor: alpha(css("--accent"), .12) })] : [] },
    options: opts({ y: yAx({ min: 0, suggestedMax: 60, ticks: { stepSize: 20 } }) }, "", false) });
  $("#airSub").textContent = A === undefined ? "European AQI · loading…" : hasAir ? "European AQI · under 20 good, 20–40 fair, 40–60 moderate, 60+ poor" : "No air-quality forecast for this date (it covers about the next 5 days)";

  // exposure by relative direction, time-weighted over every track point
  const sectors = state.sim.sectors;
  const secCol = ["--head", "--head", "--cross", "--tail", "--tail", "--tail", "--cross", "--head"].map(css);
  if (want("cPolar")) charts.push(new Chart($("#cPolar"), { type: "polarArea", data: {
    labels: ["Head", "Front-right", "Right", "Rear-right", "Tail", "Rear-left", "Left", "Front-left"],
    datasets: [{ data: sectors.map(v => Math.round(v)), backgroundColor: secCol.map((c, i) => alpha(c, [0, 4].includes(i) ? .85 : .5)), borderColor: css("--surface"), borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: Object.assign({}, tooltip, { callbacks: { label: c => ` ${c.raw} min` } }) },
      scales: { r: { startAngle: -22.5, grid: { color: line }, angleLines: { color: line }, ticks: { display: false }, pointLabels: { display: true, centerPointLabels: true, color: ink, font: { size: 12 } } } } } }));
}

export function renderBest() {
  const B = state.best, cur = state.startMs;
  if (bestChart) { bestChart.destroy(); bestChart = null; }
  if (!B || B.length < 2) {
    $("#picks").innerHTML = `<p class="hint" style="margin:0">Not enough forecast data on this day to compare start times.</p>`;
    $("#bestLegend").innerHTML = ""; return;
  }
  // top three, at least an hour apart
  const ranked = [...B].sort((a, b) => a.score - b.score), top = [];
  for (const c of ranked) { if (top.every(t => Math.abs(t.ms - c.ms) >= HOUR)) top.push(c); if (top.length === 3) break; }
  const mine = B.reduce((a, b) => Math.abs(b.ms - cur) < Math.abs(a.ms - cur) ? b : a);
  const why = c => [fmtDur(c.dur), c.wet / (c.dur / 60) < 0.1 ? "dry" : `${r0(100 * c.wet / (c.dur / 60))}% rain risk`, c.dark > 1 ? `${r0(c.dark)} min dark` : "daylight", ...(c.storm > 1 ? ["storm risk"] : []), `${c.head >= 0 ? "head" : "tail"} ${r0(Math.abs(c.head))}`].join(" · ");
  $("#picks").innerHTML = top.map((c, i) => `<div class="pick${i ? "" : " top"}"><span class="t">${fmtTime(c.ms)}</span><span>${i ? `Option ${i + 1}` : "Best start"}</span><button class="btn" type="button" data-ms="${c.ms}"${Math.abs(c.ms - cur) < 6e4 ? " disabled" : ""}>${Math.abs(c.ms - cur) < 6e4 ? "Selected" : "Use"}</button><span class="m">${why(c)}</span></div>`).join("") +
    (Math.abs(mine.ms - top[0].ms) >= 6e4 && mine.score - top[0].score >= 5 ? `<p class="hint" style="margin:0">Leaving at ${fmtTime(top[0].ms)} instead of ${fmtTime(mine.ms)} scores ${r0(mine.score - top[0].score)} effective minutes better.</p>` : `<p class="hint" style="margin:0">Your chosen start is among the best on this day.</p>`);
  $("#bestSub").textContent = `${fmtDay(cur)} · every half hour, scored as ride time with this wind plus penalties for rain risk, storms, darkness and cold; shorter bars are better`;

  const { ink, line, tooltip } = chartTheme();
  const topSet = new Set(top.map(t => t.ms)), best = top[0].score;
  const floor = Math.max(0.5, (ranked[ranked.length - 1].score - best) * 0.025); // keep near-zero bars visible
  const col = c => topSet.has(c.ms) ? css("--accent") : c.rainy ? alpha(css("--cool"), .75) : c.dark > 1 ? alpha(css("--muted"), .45) : alpha(css("--muted"), .8);
  bestChart = new Chart($("#cBest"), { type: "bar", data: {
    labels: B.map(c => fmtTime(c.ms)),
    datasets: [{ label: "Worse than best", data: B.map(c => Math.max(floor, r1(c.score - best))), backgroundColor: B.map(col), borderColor: B.map(c => Math.abs(c.ms - cur) < 6e4 ? ink : "transparent"), borderWidth: B.map(c => Math.abs(c.ms - cur) < 6e4 ? 2 : 0), borderRadius: 4, borderSkipped: false, categoryPercentage: .9, barPercentage: .9 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, crosshair: { off: true }, tooltip: Object.assign({}, tooltip, { callbacks: { title: it => `Start ${it[0].label}`, label: it => " " + why(B[it.dataIndex]), afterLabel: it => ` score ${r0(B[it.dataIndex].score)} effective min` } }) },
      scales: { x: { grid: { display: false }, border: { color: line }, ticks: { autoSkip: true, maxRotation: 0, color: ink } },
        y: { grid: { color: line }, border: { display: false }, suggestedMin: 0, title: { display: true, text: "Effective min worse than best", color: css("--muted") }, ticks: { callback: v => "+" + v } } },
      onClick: (_, els) => { if (els.length) document.dispatchEvent(new CustomEvent("rf:start", { detail: B[els[0].index].ms })); } } });
  $("#bestLegend").innerHTML = `<span class="key"><b class="sq" style="background:var(--accent)"></b>top picks</span><span class="key"><b class="sq" style="background:${alpha(css("--cool"), .75)}"></b>rain risk</span><span class="key"><b class="sq" style="background:${alpha(css("--muted"), .45)}"></b>partly in the dark</span><span class="key"><b class="sq" style="background:${alpha(css("--muted"), .8)}"></b>other</span><span class="key"><b class="sq" style="border:2px solid var(--ink)"></b>your start</span><span>Click a bar to use that start.</span>`;
}
