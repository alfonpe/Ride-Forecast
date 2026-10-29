import { scoreStarts } from "./best.js";
import { renderCharts } from "./charts.js";
import { demoGPX } from "./demo.js";
import { parseRouteFile, readRouteBytes, routesToGPX } from "./files.js";
import { buildTrack, fetchElevation, locate, makeSamples } from "./geo.js";
import { detectHazards } from "./hazards.js";
import { nearestSample, setHover } from "./hover.js";
import { handleLink } from "./links.js";
import { drawMap, initMap, map } from "./map.js";
import { parseStops, riderFeels, simulate } from "./pacing.js";
import { renderAll, renderNotes, renderReadout, renderSummary, renderTable, setStatus, showTZ } from "./render.js";
import { routeFromHash, shareURL } from "./share.js";
import { state } from "./state.js";
import { fmtDay, fmtTime, msToWall, nextSaturday8, wallToMs, zone } from "./time.js";
import { $, DAY, HOUR, deg, esc, r1, rad } from "./util.js";
import { closest, dataWindow, fetchAir, fetchEnsemble, fetchWeather, resolveTZ, wxAt } from "./weather.js";

let runSeq = 0, loadSeq = 0;
function useStart(ms) { $("#start").value = msToWall(ms); run(false); }

function readOpts() {
  const tr = state.track, { stops, bad } = parseStops($("#stops").value, tr.total);
  $("#stopsHint").textContent = bad.length ? `ignored: ${bad.join(", ")} (use km@minutes within the route)` : stops.length ? `${stops.length} stop${stops.length > 1 ? "s" : ""}, ${stops.reduce((a, s) => a + s.min, 0)} min` : "café or refill stops along the way";
  return { speed: parseFloat($("#speed").value), hills: $("#hills").checked, wf: parseFloat($("#wf").value) || 1, stops };
}

async function run(fit) {
  const id = ++runSeq;
  if (!state.track) { setStatus("Choose a GPX or TCX file first.", true); return; }
  const o = readOpts(), tr = state.track;
  if (!(o.speed >= 5 && o.speed <= 60)) { setStatus("Enter an average speed between 5 and 60 km/h.", true); return; }
  const startMs = wallToMs($("#start").value);
  if (!isFinite(startMs)) { setStatus("Pick a start date and time.", true); return; }
  if (!state.base || state.base.tr !== tr) state.base = { tr, S: makeSamples(tr) };
  const S = state.base.S.map(s => ({ ...s }));
  // still-air estimate sizes the request; the window also covers the whole day for the best-start planner
  const est = simulate(tr, S, null, startMs, o, false);
  if (startMs > Date.now() + 15.5 * DAY) { setStatus("Forecasts only reach 16 days ahead. Pick a start time within that window.", true); return; }
  if (startMs + est.dur * 1000 < Date.now() - 90 * DAY) { setStatus("That date is more than 3 months ago. Pick a recent or upcoming start time.", true); return; }
  const dayWall = msToWall(startMs).slice(0, 10), d4 = wallToMs(dayWall + "T04:00"), d21 = wallToMs(dayWall + "T21:00");
  const fromMs = Math.min(startMs, d4) - 2 * HOUR, toMs = Math.max(startMs, d21) + est.dur * 1000 * 1.7 + 2 * HOUR;
  const btn = $("#go"); btn.disabled = true; btn.textContent = "Fetching…";
  setStatus("Getting the forecast for each checkpoint…");
  try {
    const locs = await fetchWeather(S, fromMs, toMs);
    if (id !== runSeq) return;
    const win = dataWindow(locs);
    if (startMs < win[0]) throw new Error("There's no forecast data that far back. Pick a later start time.");
    const sim = simulate(tr, S, locs, startMs, o, true), endMs = startMs + sim.dur * 1000;
    if (endMs > win[1]) throw new Error(`At this pace you'd finish ${fmtDay(endMs)} ${fmtTime(endMs)}, past the end of the forecast (${fmtDay(win[1])} ${fmtTime(win[1])}). Start earlier, ride faster or shorten the route.`);
    const still = simulate(tr, S, null, startMs, o, false);
    tr.time = sim.t; tr.spd = sim.spd;
    sim.windMin = (sim.dur - still.dur) / 60;
    S.forEach((s, k) => {
      const a = sim.acc[k], a0 = still.acc[k];
      s.t = locate(tr, s.m).t; s.eta = startMs + s.t * 1000;
      Object.assign(s, wxAt(locs[k], s.eta));
      if (a.w > 0) { s.head = a.h / a.w; s.cross = a.c / a.w; }
      else { const rel = rad(s.wdir - s.brg); s.head = s.ws * o.wf * Math.cos(rel); s.cross = s.ws * o.wf * Math.sin(rel); }
      s.rel = deg(Math.atan2(s.cross, s.head)); // + means wind from your right
      s.cat = Math.abs(s.rel) <= 45 ? "head" : Math.abs(s.rel) >= 135 ? "tail" : "cross";
      s.side = s.rel > 0 ? "right" : "left";
      s.dt = a.w;
      s.spd = a.w ? a.d / a.w * 3.6 : o.speed; s.spd0 = a0.w ? a0.d / a0.w * 3.6 : o.speed;
      s.air = Math.max(0, s.spd + s.head);
      s.bike = riderFeels(s.temp, s.air, s.feels);
    });
    Object.assign(state, { samples: S, startMs, endMs, sim, locs, opts: o, ens: undefined, air: undefined, hazards: detectHazards(S, tr) });
    state.sun = { rise: closest(locs[0].daily && locs[0].daily.sunrise, startMs), set: closest(locs[locs.length - 1].daily && locs[locs.length - 1].daily.sunset, endMs) };
    state.best = scoreStarts(tr, S, locs, o, dayWall, win);
    state.hoverKm = null;
    renderAll(fit);
    setStatus(`Forecast for ${S.length} checkpoints, ${fmtDay(startMs)} ${fmtTime(startMs)} → ${fmtTime(endMs)}.`);
    saveSettings();
    fetchEnsemble(S, startMs, endMs).catch(() => null).then(ens => {
      if (id !== runSeq) return;
      state.ens = ens || null;
      renderSummary(); renderCharts(["cTemp", "cWind", "cRain"]); renderReadout();
    });
    fetchAir(S, startMs, endMs).catch(() => null).then(air => {
      if (id !== runSeq) return;
      state.air = air || null;
      renderSummary(); renderNotes(); renderCharts(["cAir"]); renderTable(); renderReadout();
    });
  } catch (e) {
    if (id === runSeq) setStatus(e.message || "Couldn't reach the weather service. Check your connection and try again.", true);
  } finally { if (id === runSeq) { btn.disabled = false; btn.textContent = "Get forecast"; } }
}

/* ---------- loading routes ---------- */
async function useRoute(route, label) {
  const id = ++loadSeq;
  let tr;
  try { tr = buildTrack(route.pts); } catch (e) { setStatus(e.message, true); return; }
  state.track = tr; state.name = route.name; state.base = null;
  $("#routeName").textContent = route.name || "Route";
  if (label) $("#fileLabel").textContent = label;
  setStatus("Preparing the route…");
  const [tz] = await Promise.all([
    resolveTZ(tr.pts[0]),
    tr.hasEle ? null : fetchElevation(tr).catch(() => null)
  ]);
  if (id !== loadSeq) return;
  zone.name = tz; showTZ();
  $("#eleHint").textContent = `${r1(tr.total / 1000)} km · ` + (tr.eleSrc === "file" ? "elevation from file" : tr.eleSrc === "dem" ? "elevation from terrain model" : "no elevation available (flat pacing)");
  run(true);
}

function loadFile(text, filename, remember = true) {
  try {
    const routes = parseRouteFile(text, filename);
    if (remember) rememberRoute(text, filename);
    useRoutes(routes, filename);
  } catch (e) { setStatus(e.message, true); }
}

function useRoutes(routes, filename) {
  state.routes = routes;
  $("#trackSel").innerHTML = routes.map((r, k) => `<option value="${k}">${esc(r.name)} (${r.pts.length} pts)</option>`).join("");
  $("#trackField").hidden = routes.length < 2;
  $("#importHelp").hidden = true;
  useRoute(routes[0], filename);
}
function rememberRoute(text, filename) {
  try { if (text.length < 2.5e6) localStorage.setItem("rf-route", JSON.stringify({ text, filename })); } catch (e) {}
}

// any dropped/chosen file: GPX/TCX text, Garmin FIT, a Garmin "Export Original" .zip, or gzip
async function openFile(f) {
  try {
    setStatus(`Reading ${f.name}…`);
    const r = await readRouteBytes(new Uint8Array(await f.arrayBuffer()), f.name);
    rememberRoute(r.text || routesToGPX(r.routes), r.text ? r.name : r.name.replace(/\.fit$/i, "") + ".gpx");
    useRoutes(r.routes, r.name);
  } catch (e) { setStatus(e.message || "Couldn't read that file.", true); }
}

/* ---------- settings & theme ---------- */
function saveSettings() {
  try {
    localStorage.setItem("rf-speed", $("#speed").value); localStorage.setItem("rf-hills", $("#hills").checked ? "1" : "0");
    localStorage.setItem("rf-wf", $("#wf").value); localStorage.setItem("rf-stops", $("#stops").value);
  } catch (e) {}
}
const THEMES = ["auto", "light", "dark"];
function applyTheme(t) {
  if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  $("#theme").setAttribute("aria-label", `Theme: ${t} (click to change)`); $("#theme").title = `Theme: ${t}`;
  if (state.samples) { renderAll(false); }
}

/* ---------- wiring ---------- */
$("#start").value = nextSaturday8();
try {
  const sp = localStorage.getItem("rf-speed"); if (sp) $("#speed").value = sp;
  const h = localStorage.getItem("rf-hills"); if (h) $("#hills").checked = h === "1";
  const wf = localStorage.getItem("rf-wf"); if (wf && [...$("#wf").options].some(x => x.value === wf)) $("#wf").value = wf;
  const st = localStorage.getItem("rf-stops"); if (st) $("#stops").value = st;
  const th = localStorage.getItem("rf-theme"); if (THEMES.includes(th) && th !== "auto") document.documentElement.dataset.theme = th;
} catch (e) {}

$("#form").addEventListener("submit", e => { e.preventDefault(); run(false); });
$("#file").addEventListener("change", e => {
  const f = e.target.files[0]; if (!f) return;
  openFile(f);
  e.target.value = ""; // so choosing the same file again still fires "change"
});
$("#trackSel").addEventListener("change", e => { const r = state.routes[+e.target.value]; if (r) useRoute(r); });
const drop = $("#drop");
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) openFile(f); });
// also accept a drop anywhere on the page
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => {
  if (e.target.closest("#drop")) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) { openFile(f); return; }
  // a link dragged in from a Garmin Connect tab
  const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
  if (url) { $("#link").value = url.trim(); handleLink(url); }
});
$("#link").addEventListener("input", e => handleLink(e.target.value));
$("#link").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); handleLink(e.target.value); } });
$("#importHelp").addEventListener("click", e => { if (e.target.closest("[data-close]")) $("#importHelp").hidden = true; });

$("#metric").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.metric = b.dataset.m;
  $("#metric").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
  if (state.samples) drawMap(false);
});
$("#scrub").addEventListener("input", e => { if (state.samples) setHover(parseFloat(e.target.value)); });
$("#hazards").addEventListener("click", e => {
  const b = e.target.closest(".hz"); if (!b) return;
  const km = +b.dataset.km, s = nearestSample(km); setHover(km); map.panTo([s.lat, s.lon]);
});
document.addEventListener("rf:start", e => useStart(e.detail)); // from the best-start chart
$("#picks").addEventListener("click", e => { const b = e.target.closest("button[data-ms]"); if (b) useStart(+b.dataset.ms); });
$("#stops").addEventListener("change", () => { if (state.track) run(false); });
$("#wf").addEventListener("change", () => { if (state.track) run(false); });
$("#hills").addEventListener("change", () => { if (state.track) run(false); });
$("#share").addEventListener("click", async () => {
  if (!state.track) return;
  const url = shareURL();
  history.replaceState(null, "", url);
  try { await navigator.clipboard.writeText(url); setStatus("Share link copied. It includes the route, start time, speed and stops."); }
  catch (e) { setStatus("Share link is now in the address bar; copy it from there."); }
});
$("#theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || "auto", next = THEMES[(THEMES.indexOf(cur) + 1) % 3];
  try { localStorage.setItem("rf-theme", next); } catch (e) {}
  applyTheme(next);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.samples) renderAll(false); });

initMap();
{
  const th = document.documentElement.dataset.theme || "auto";
  $("#theme").setAttribute("aria-label", `Theme: ${th} (click to change)`); $("#theme").title = `Theme: ${th}`;
  const shared = (() => { try { return routeFromHash(); } catch (e) { return null; } })();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("rf-route") || "null"); } catch (e) {}
  if (shared) { state.routes = [shared]; useRoute(shared, "Shared link"); }
  else if (saved && saved.text) { loadFile(saved.text, saved.filename || "route.gpx", false); }
  else { loadFile(demoGPX(), "demo-valencia-loop.gpx", false); $("#fileLabel").textContent = "Drop a GPX, TCX or FIT file, or Garmin .zip"; }
}
