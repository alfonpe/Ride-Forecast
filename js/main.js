import { compareReversed, scoreStarts } from "./best.js";
import { cardFile, drawCard } from "./card.js";
import { renderCharts } from "./charts.js";
import { demoGPX } from "./demo.js";
import { parseRouteFile, readRouteBytes, routesToGPX } from "./files.js";
import { buildTrack, fetchElevation, locate, makeSamples, routeKey } from "./geo.js";
import { detectHazards } from "./hazards.js";
import { nearestSample, setHover } from "./hover.js";
import { handleLink } from "./links.js";
import { drawMap, initMap, map } from "./map.js";
import { parseStops, riderFeels, simulate, startForArrival } from "./pacing.js";
import { renderAll, renderDirection, renderNotes, renderReadout, renderSummary, renderTable, setStatus, showTZ, updateTimeHint } from "./render.js";
import { isLoop, orientTrack, remapKm } from "./orient.js";
import { store, stored } from "./net.js";
import { fetchPlaces } from "./places.js";
import { fetchPOIs, placePOIs } from "./pois.js";
import { planFromHash, shareURL } from "./share.js";
import { state } from "./state.js";
import { fmtDay, fmtTime, msToWall, nextSaturday8, wallToMs, zone } from "./time.js";
import { $, DAY, HOUR, deg, esc, r1, rad } from "./util.js";
import { closest, dataWindow, fetchAir, fetchEnsemble, fetchWeather, resolveTZ, wxAt } from "./weather.js";

let runSeq = 0, loadSeq = 0;
function setTimeMode(mode) {
  state.timeMode = mode;
  $("#timeMode").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  updateTimeHint();
}
function useStart(ms) { setTimeMode("start"); $("#start").value = msToWall(ms); run(false); }

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
  const wallMs = wallToMs($("#start").value), arrive = state.timeMode === "arrive";
  if (!isFinite(wallMs)) { setStatus(arrive ? "Pick when you need to be home." : "Pick a start date and time.", true); return; }
  if (!state.base || state.base.tr !== tr) state.base = { tr, S: makeSamples(tr) };
  const S = state.base.S.map(s => ({ ...s }));
  // still-air estimate sizes the request (and seeds the start in "Home by" mode); the window also covers the whole day for the best-start planner
  const est = simulate(tr, S, null, wallMs, o, false);
  let startMs = arrive ? wallMs - est.dur * 1000 : wallMs;
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
    if (arrive) startMs = startForArrival(wallMs, ms => simulate(tr, S, locs, ms, o, false).dur, startMs);
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
    Object.assign(state, { samples: S, samplesFor: tr, startMs, endMs, sim, locs, opts: o, ens: undefined, air: undefined, hazards: detectHazards(S, tr) });
    state.sun = { rise: closest(locs[0].daily && locs[0].daily.sunrise, startMs), set: closest(locs[locs.length - 1].daily && locs[locs.length - 1].daily.sunset, endMs) };
    state.best = scoreStarts(tr, S, locs, o, dayWall, win);
    // the same ride the other way round, on the weather already downloaded
    state.dirCompare = null;
    try { const alt = altTrack(); state.dirCompare = compareReversed(tr, S, alt, makeSamples(alt), locs, startMs, o); } catch (e) { /* comparison is optional */ }
    state.hoverKm = null;
    renderAll(fit);
    redrawCard();
    setStatus(arrive ? `Leave at ${fmtTime(startMs)} (${fmtDay(startMs)}) to be home by ${fmtTime(endMs)}. Forecast for ${S.length} checkpoints.`
      : `Forecast for ${S.length} checkpoints, ${fmtDay(startMs)} ${fmtTime(startMs)} → ${fmtTime(endMs)}.`);
    updateTimeHint();
    saveSettings();
    state.shareUrl = null;
    shareURL().then(u => { if (id === runSeq) state.shareUrl = u; }).catch(() => {}); // ready before the tap: phones only allow sharing straight from a gesture
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

/* ---------- which way round ---------- */
function altTrack() {
  const o = state.orient, c = state.altCache, key = `${o.s}|${!o.rev}`;
  if (c && c.base === state.baseTrack && c.key === key) return c.track;
  const track = orientTrack(state.baseTrack, { s: o.s, rev: !o.rev });
  state.altCache = { base: state.baseTrack, key, track };
  return track;
}
// switch direction / start; typed stops move with their spot on the road
function applyOrientation(next) {
  const base = state.baseTrack, T = base.total, loop = isLoop(base), cur = state.orient;
  const ctx = o => ({ loop, s0: base.cum[o.s], rev: o.rev });
  const track = orientTrack(base, next), maxKm = track.total / 1000 - 0.01;
  const { stops, bad } = parseStops($("#stops").value, state.track.total);
  if (stops.length) {
    const moved = stops.map(st => ({ km: Math.max(0, Math.min(maxKm, remapKm(st.km, ctx(cur), ctx(next), T))), min: st.min })).sort((a, b) => a.km - b.km);
    $("#stops").value = [...moved.map(x => `${r1(x.km)}@${x.min}`), ...bad].join(", ");
  }
  Object.assign(state, { orient: next, track, base: null, shareUrl: null, pickingStart: false });
  if (state.poisRaw !== undefined) state.pois = placePOIs(state.poisRaw, track);
  $("#map").classList.remove("picking");
  run(false);
}
function nearestBaseIdx(latlng) {
  const P = state.baseTrack.pts, k = Math.cos(rad(latlng.lat));
  let best = 0, bd = Infinity;
  for (let i = 0; i < P.length; i++) { const d = (P[i].lat - latlng.lat) ** 2 + ((P[i].lon - latlng.lng) * k) ** 2; if (d < bd) { bd = d; best = i; } }
  return { i: best, metres: Math.sqrt(bd) * 111195 };
}

/* ---------- route name: editable, remembered per route on this device ---------- */
function savedName(tr) {
  try { return (JSON.parse(localStorage.getItem("rf-names") || "{}"))[routeKey(tr)] || ""; } catch (e) { return ""; }
}
function renameRoute(name) {
  name = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name || name === state.name || !state.baseTrack) return;
  state.name = name;
  try { const all = JSON.parse(localStorage.getItem("rf-names") || "{}"); all[routeKey(state.baseTrack)] = name; localStorage.setItem("rf-names", JSON.stringify(all)); } catch (e) { /* not remembered */ }
  renderDirection(); // refreshes the name shown in the top bar
  state.shareUrl = null;
  shareURL().then(u => { state.shareUrl = u; }).catch(() => {});
}
function editName() {
  const btn = $("#nameBtn"), inp = $("#nameInput");
  inp.value = state.name || ""; btn.hidden = true; inp.hidden = false; inp.focus(); inp.select();
}
function endEditName(save) {
  const btn = $("#nameBtn"), inp = $("#nameInput");
  if (inp.hidden) return;
  if (save) renameRoute(inp.value);
  inp.hidden = true; btn.hidden = false;
}
$("#nameBtn").addEventListener("click", editName);
$("#nameInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); endEditName(true); } else if (e.key === "Escape") endEditName(false); });
$("#nameInput").addEventListener("blur", () => endEditName(true));

/* ---------- shared ride plans ---------- */
async function openShared() {
  let plan;
  try { plan = await planFromHash(); }
  catch (e) {
    // keep the reason on screen: the fallback route's own status message would otherwise replace it
    const box = $("#sharedBanner");
    box.innerHTML = `<div class="panel-head"><div><h2>This shared ride plan couldn't be opened</h2><div class="sub" style="color:var(--head)">${esc(e.message || "The link is damaged.")}</div></div><button class="btn" type="button" data-close>Close</button></div>`;
    box.hidden = false;
    return false;
  }
  if (!plan) return false;
  if (plan.metric && $(`#metric button[data-m="${plan.metric}"]`)) {
    state.metric = plan.metric;
    $("#metric").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x.dataset.m === plan.metric));
  }
  setTimeMode("start");
  state.routes = [plan.route];
  $("#trackField").hidden = true;
  showSharedBanner(plan);
  useRoute(plan.route, "Shared link", plan.tz, { keepName: true }); // the sender's name for the ride
  return true;
}
function showSharedBanner(plan) {
  const box = $("#sharedBanner"), tz = plan.tz || zone.name, ms = wallToMs(plan.start || "", tz);
  const when = isFinite(ms) ? new Date(ms).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }) : "";
  const { stops } = parseStops($("#stops").value, Infinity);
  const past = isFinite(ms) && ms < Date.now() - HOUR;
  box.innerHTML = `<div class="panel-head"><div><h2>Shared ride plan: ${esc(plan.route.name)}</h2>
    <div class="sub">${[when && `Start ${esc(when)}`, `${esc($("#speed").value)} km/h`, stops.length ? `stops at ${stops.map(x => `km ${r1(x.km)} (${x.min} min)`).join(", ")}` : "no stops", $("#wf").selectedOptions[0].textContent.replace(/ \(.*\)/, "").toLowerCase() + " wind"].filter(Boolean).join(" · ")}</div>
    ${past ? `<div class="sub" style="color:var(--cross)">That start time has passed. Pick a new one above to see the forecast for your ride.</div>` : ""}</div>
    <button class="btn" type="button" data-close>Close</button></div>`;
  box.hidden = false;
}

/* ---------- loading routes ---------- */
async function useRoute(route, label, knownTz, { keepName = false } = {}) {
  const id = ++loadSeq;
  let tr;
  try { tr = buildTrack(route.pts); } catch (e) { setStatus(e.message, true); return; }
  state.track = state.baseTrack = tr; state.name = (!keepName && savedName(tr)) || route.name; state.base = null;
  state.orient = { s: 0, rev: false }; state.pickingStart = false; state.altCache = null; $("#map").classList.remove("picking");
  $("#routeName").textContent = state.name || "Route";
  if (label) $("#fileLabel").textContent = label;
  setStatus("Preparing the route…");
  // town names and water points start right away: they need only the route, not the time zone or the weather
  const dem = tr.hasEle ? null : fetchElevation(tr).catch(() => null);
  state.poisRaw = state.pois = undefined;
  state.places = undefined; state.placesDone = false; // loading
  fetchPlaces(tr, partial => { if (id === loadSeq) { state.places = partial; redrawCard(); } }, { eleReady: dem }).catch(() => null).then(res => {
    if (id !== loadSeq) return;
    state.places = res; state.placesDone = true;
    redrawCard();
  });
  const useWater = res => {
    state.poisRaw = res ? res.pois : null; state.pois = placePOIs(state.poisRaw, state.track);
    if (state.samples && state.samplesFor === state.track) { drawMap(false); renderNotes(); renderTable(); }
  };
  const kept = stored("rf-pois", 30), rk = routeKey(tr);
  if (kept && kept.id === rk) useWater(kept.res);
  else fetchPOIs(tr.pts).then(res => {
    if (id !== loadSeq) return;
    if (res) store("rf-pois", { id: rk, res });
    useWater(res);
  });
  const [tz] = await Promise.all([knownTz || resolveTZ(tr.pts[0]), dem]);
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
// the user picked their own route: drop any shared plan (and its link, so a reload doesn't bring it back)
function clearShared() {
  $("#sharedBanner").hidden = true;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

async function openFile(f) {
  clearShared();
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
    localStorage.setItem("rf-mode", state.timeMode);
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
  if (localStorage.getItem("rf-mode") === "arrive") setTimeMode("arrive");
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
$("#sharedBanner").addEventListener("click", e => { if (e.target.closest("[data-close]")) $("#sharedBanner").hidden = true; });

$("#metric").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.metric = b.dataset.m;
  $("#metric").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
  if (state.samples) drawMap(false);
});
$("#dirBar").addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b || !state.baseTrack) return;
  if (b.dataset.act === "reverse") applyOrientation({ ...state.orient, rev: !state.orient.rev });
  else if (b.dataset.act === "resetStart") applyOrientation({ ...state.orient, s: 0 });
  else if (b.dataset.act === "pick") {
    state.pickingStart = !state.pickingStart;
    $("#map").classList.toggle("picking", state.pickingStart);
    if (state.pickingStart) setStatus("Tap the route on the map where you'll start the loop.");
    renderDirection();
  }
});
// switching keeps the same plan: "Start at" shows the start, "Home by" the arrival
$("#timeMode").addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]"); if (!b || b.dataset.mode === state.timeMode) return;
  if (state.samples) $("#start").value = msToWall(Math.round((b.dataset.mode === "arrive" ? state.endMs : state.startMs) / 6e4) * 6e4);
  setTimeMode(b.dataset.mode);
  if (state.track) run(false);
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
let editTimer = 0;
for (const id of ["#start", "#speed"]) $(id).addEventListener("change", () => { clearTimeout(editTimer); editTimer = setTimeout(() => { if (state.track) run(false); }, 600); });
function planSummary() {
  const st = state.opts ? state.opts.stops : [];
  return `${state.name}, ${fmtDay(state.startMs)} ${fmtTime(state.startMs)}, ${$("#speed").value} km/h` +
    (st.length ? `, stops at ${st.map(x => `km ${r1(x.km)} (${x.min} min)`).join(", ")}` : "");
}
$("#share").addEventListener("click", async () => {
  if (!state.track) return;
  const url = state.shareUrl || await shareURL();
  history.replaceState(null, "", url);
  // phones: the native share sheet (WhatsApp, Messages…); desktop: copy to the clipboard
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    try { await navigator.share({ title: `Ride plan: ${state.name}`, text: `Ride plan: ${planSummary()}`, url }); setStatus("Ride plan shared."); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); setStatus(`Link copied. It opens the full plan: ${planSummary()}.`); }
  catch (e) { setStatus("The share link is now in the address bar; copy it from there."); }
});
// "Share image" opens a preview first, then offers what this browser can do: share sheet, copy, download.
// (Each action is its own tap, so the share sheet's "must come from a gesture" rule always holds.)
let card = null;
function hideImage() { $("#imgView").hidden = true; if (card) URL.revokeObjectURL(card.url); card = null; }
// the open preview follows late data (names, a finished forecast); a failed redraw must not leave it stuck
function redrawCard() {
  if (!card || $("#imgView").hidden) return;
  if (state.samplesFor !== state.track) { $("#imgHint").textContent = "Updating the forecast for this route…"; return; }
  try { drawPreview(); } catch (e) { $("#imgHint").textContent = cardHint(); }
}
function cardHint() {
  const base = $("#imgHint").dataset.base || "";
  if (!state.placesDone) return "Adding town names… (the picture updates by itself)";
  if (!state.places) return `${base} Town names couldn't be loaded right now.`;
  return state.places.partial ? `${base} Some town names couldn't be loaded right now.` : base;
}
function drawPreview() {
  const canvas = drawCard(), slug = (state.name || "ride").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "ride";
  const dataUrl = canvas.toDataURL("image/png"), file = cardFile(dataUrl, `ride-plan-${slug}.png`);
  if (card) URL.revokeObjectURL(card.url);
  card = { file, url: URL.createObjectURL(file), text: `Ride plan: ${planSummary()}` + (state.shareUrl ? `\n${state.shareUrl}` : "") };
  const v = $("#imgView"), dl = v.querySelector('[data-act="download"]');
  v.querySelector("img").src = dataUrl;
  dl.href = card.url; dl.setAttribute("download", file.name);
  $("#imgHint").textContent = cardHint();
  return file;
}
$("#shareImg").addEventListener("click", () => {
  if (!state.samples) return;
  if (state.samplesFor !== state.track) { setStatus("One moment: the forecast for this route is still being worked out."); return; }
  const file = drawPreview();
  let canFiles = false;
  try { canFiles = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { /* unsupported */ }
  const canCopy = !!(navigator.clipboard && navigator.clipboard.write && window.ClipboardItem), phone = matchMedia("(pointer: coarse)").matches;
  const v = $("#imgView"), act = n => v.querySelector(`[data-act="${n}"]`);
  act("share").hidden = !canFiles;
  act("copy").hidden = !canCopy || phone;
  act("download").hidden = phone && canFiles;
  $("#cardTitle").value = state.name || "";
  $("#imgHint").dataset.base = canFiles ? "Share it to a chat, or save it." : phone ? "Press and hold the image to save or share it." : "Copy it and paste into a chat (e.g. WhatsApp Web), or download it.";
  $("#imgHint").textContent = cardHint();
  v.hidden = false;
  (canFiles ? act("share") : v.querySelector("[data-close]")).focus();
});
// retitling in the preview renames the route everywhere and redraws the picture
let titleTimer = 0;
$("#cardTitle").addEventListener("input", e => {
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => { renameRoute(e.target.value); if (card) drawPreview(); }, 250);
});
$("#imgView").addEventListener("click", e => {
  if (e.target === e.currentTarget || e.target.closest("[data-close]")) { hideImage(); return; }
  const b = e.target.closest("[data-act]"); if (!b || !card) return;
  if (b.dataset.act === "share") {
    navigator.share({ files: [card.file], title: `Ride plan: ${state.name}`, text: card.text })
      .then(() => { hideImage(); setStatus("Ride plan image shared."); }, e2 => { if (e2.name !== "AbortError") $("#imgHint").textContent = "Couldn't open the share sheet; press and hold the image, or download it."; });
  } else if (b.dataset.act === "copy") {
    navigator.clipboard.write([new ClipboardItem({ "image/png": card.file })])
      .then(() => { $("#imgHint").textContent = "Copied. Paste it into a chat."; }, () => { $("#imgHint").textContent = "This browser wouldn't copy the image; use Download instead."; });
  } else if (b.dataset.act === "download") setTimeout(() => { $("#imgHint").textContent = `Saved ${card ? card.file.name : "the image"} to your downloads.`; }, 300);
});
addEventListener("keydown", e => { if (e.key === "Escape" && !$("#imgView").hidden) hideImage(); });
$("#theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || "auto", next = THEMES[(THEMES.indexOf(cur) + 1) % 3];
  try { localStorage.setItem("rf-theme", next); } catch (e) {}
  applyTheme(next);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.samples) renderAll(false); });

initMap();
// a DOM listener (not map.on): taps landing on a wind arrow or pin must count too, and markers don't pass clicks to the map
$("#map").addEventListener("click", e => {
  if (!state.pickingStart || e.target.closest(".leaflet-control")) return;
  const { i, metres } = nearestBaseIdx(map.mouseEventToLatLng(e)), n = state.baseTrack.pts.length;
  if (metres > 500) { setStatus("That's too far from the route; tap on the route itself.", true); return; }
  applyOrientation({ ...state.orient, s: i > 0 && i < n - 1 ? i : 0 });
});
addEventListener("keydown", e => { if (e.key === "Escape" && state.pickingStart) { state.pickingStart = false; $("#map").classList.remove("picking"); renderDirection(); } });
{
  const th = document.documentElement.dataset.theme || "auto";
  $("#theme").setAttribute("aria-label", `Theme: ${th} (click to change)`); $("#theme").title = `Theme: ${th}`;
  openShared().then(opened => {
    if (opened) return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("rf-route") || "null"); } catch (e) {}
    if (saved && saved.text) loadFile(saved.text, saved.filename || "route.gpx", false);
    else { loadFile(demoGPX(), "demo-valencia-loop.gpx", false); $("#fileLabel").textContent = "Drop a GPX, TCX or FIT file, or Garmin .zip"; }
  });
}
// a shared link opened while the app is already open in this tab
addEventListener("hashchange", () => openShared());
