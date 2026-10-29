import { renderBest, renderCharts } from "./charts.js";
import { compass, locate } from "./geo.js";
import { HAZ } from "./hazards.js";
import { nearestSample, setHover } from "./hover.js";
import { arrowSvg, icon, wmo } from "./icons.js";
import { drawMap, map } from "./map.js";
import { state } from "./state.js";
import { DEVICE_TZ, fmtDay, fmtDur, fmtTime, zone } from "./time.js";
import { $, DAY, css, maxOf, minOf, r0, r1, resetTokens } from "./util.js";
import { aqiLevel, uvLevel } from "./weather.js";

export function showTZ() {
  const abbr = new Intl.DateTimeFormat("en", { timeZone: zone.name, timeZoneName: "short" }).formatToParts(Date.now()).find(x => x.type === "timeZoneName");
  $("#tzName").textContent = zone.name.replace(/_/g, " ") + (abbr ? " · " + abbr.value : "");
  $("#tzHint").textContent = zone.name === DEVICE_TZ ? "route local time (same as this device)" : `route local time · ${zone.name.split("/").pop().replace(/_/g, " ")}, not this device`;
}
export const hazWhere = z => { const S = state.samples, a = S[z.k0], b = S[z.k1]; return z.k0 === z.k1 ? `around km ${r0(a.km)} (${fmtTime(a.eta)})` : `km ${r0(a.km)}–${r0(b.km)} (${fmtTime(a.eta)}–${fmtTime(b.eta)})`; };
export function windLabel(s) {
  const h = Math.abs(s.head) < 1 ? 0 : s.head;
  if (s.cat === "head") return `<span class="chip head">Head ${r0(h)}</span>`;
  if (s.cat === "tail") return `<span class="chip tail">Tail ${r0(-h)}</span>`;
  return `<span class="chip cross">Cross ${s.side === "right" ? "R" : "L"} ${r0(Math.abs(s.cross))}</span>`;
}
export const catColor = c => css(c === "head" ? "--head" : c === "tail" ? "--tail" : "--cross");

/* ---------- rendering ---------- */
export function renderSummary() {
  const S = state.samples, tr = state.track, sim = state.sim, dur = sim.dur;
  const avgHead = S.reduce((a, s) => a + s.head * s.dt, 0) / (sim.moving || 1);
  const maxPop = maxOf(S, "pop"), rain = S.reduce((a, s) => a + s.precip * s.dt / 3600, 0);
  const ens = state.ens, E = ens ? S.map((s, k) => ens[k]).filter(Boolean) : [];
  let conf;
  if (ens === undefined) conf = ["Confidence", "…", "loading ensemble"];
  else if (!E.length) conf = ["Confidence", "—", "no ensemble for this date"];
  else {
    const tSp = E.reduce((a, e) => a + (e.t90 - e.t10), 0) / E.length, wSp = E.reduce((a, e) => a + (e.w90 - e.w10), 0) / E.length;
    const lvl = tSp < 2.5 && wSp < 8 ? "High" : tSp > 5 || wSp > 15 ? "Low" : "Medium";
    conf = ["Confidence", lvl, `±${r1(tSp / 2)} °C · ±${r0(wSp / 2)} km/h wind`];
  }
  const tiles = [
    ["dist", "Distance", `${r1(tr.total / 1000)} <small>km</small>`, tr.hasEle ? `${r0(tr.gain)} m climbing${tr.eleSrc === "dem" ? " (terrain model)" : ""}` : "No elevation available"],
    ["clock", "Ride time", fmtDur(dur), `${fmtTime(state.startMs)} → ${fmtTime(state.endMs)}${sim.stopSec ? ` · ${r0(sim.stopSec / 60)} min stops` : ""}`],
    ["therm", "On the bike", `${r0(minOf(S, "bike"))}–${r0(maxOf(S, "bike"))} <small>°C</small>`, `Air ${r0(minOf(S, "temp"))}–${r0(maxOf(S, "temp"))} °C`],
    ["wind", "Net wind", `${avgHead >= 0 ? "+" : "−"}${r1(Math.abs(avgHead))} <small>km/h</small>`, `${avgHead >= 0.5 ? "Headwind" : avgHead <= -0.5 ? "Tailwind" : "Neutral"} · ${sim.windMin >= 0 ? "+" : "−"}${r0(Math.abs(sim.windMin))} min vs still air`],
    ["gust", "Strongest gust", `${r0(maxOf(S, "gust"))} <small>km/h</small>`, `Max sustained ${r0(maxOf(S, "ws"))} km/h at 10 m`],
    ["drop", "Rain", `${r0(maxPop)} <small>% max</small>`, rain > 0.05 ? `~${r1(rain)} mm on the way` : "Dry forecast"],
    ["shield", ...conf],
    ["sun", "Sun & air", `UV ${r0(maxOf(S, "uv"))}`, `${uvLevel(maxOf(S, "uv"))} UV · ${airTile()}`]
  ];
  $("#summary").innerHTML = tiles.map(([ic, l, v, d]) => `<div class="tile"><div class="th"><span class="ic">${icon(ic, 15)}</span><span class="label">${l}</span></div><span class="v">${v}</span><span class="d">${d}</span></div>`).join("");
}

export function airTile() {
  const A = state.air, Aq = A ? A.filter(Boolean) : [];
  if (A === undefined) return "air quality loading";
  if (!Aq.length) return "no air forecast this far out";
  const worst = Math.max(...Aq.map(a => a.aqi));
  return `AQI ${r0(worst)} ${aqiLevel(worst).toLowerCase()}`;
}

export function renderHazards() {
  const Z = state.hazards;
  $("#hazards").innerHTML = Z.length
    ? Z.map(z => `<li class="${z.sev}"><button type="button" class="hz" data-km="${state.samples[z.k0].km}"><b>${HAZ[z.type]}</b> ${hazWhere(z)}<span class="sub"> · ${z.detail}</span></button></li>`).join("")
    : `<li class="good">No weather hazards flagged along the route.</li>`;
}

export function renderReadout() {
  const km = state.hoverKm == null ? 0 : state.hoverKm, k = state.samples.indexOf(nearestSample(km)), s = state.samples[k], p = locate(state.track, km * 1000);
  const [lbl, ic] = wmo(s.code), e = state.ens && state.ens[k], a = state.air && state.air[k];
  const pol = a && a.pollen.filter(p => p.v >= p.hi / 5).sort((x, y) => y.v / y.hi - x.v / x.hi)[0];
  $("#readout").innerHTML = `
    <div><div class="when">km ${r1(km)} · ${fmtTime(state.startMs + p.t * 1000)}</div>
    <div class="wx" style="margin-top:4px">${icon(ic, 20)} ${lbl}${state.track.hasEle ? ` · ${r0(p.ele)} m` : ""}</div></div>
    <dl>
      <dt>Temperature</dt><dd>${r1(s.temp)} °C${e ? ` <span class="sub">(${r0(e.t10)}–${r0(e.t90)})</span>` : ""}</dd>
      <dt>On the bike</dt><dd>${r1(s.bike)} °C <span class="sub">at ${r0(s.air)} km/h airspeed</span></dd>
      <dt>Wind</dt><dd><span class="dir">${arrowSvg((s.wdir + 180) % 360, catColor(s.cat), 14)} ${r0(s.ws)} km/h from ${compass(s.wdir)}</span>, gusts ${r0(s.gust)}</dd>
      <dt>For you</dt><dd>${windLabel(s)} <span class="sub">heading ${compass(s.brg)}</span></dd>
      <dt>Speed here</dt><dd>${r1(s.spd)} km/h <span class="sub">(${r1(s.spd0)} in still air)</span></dd>
      <dt>Rain</dt><dd>${r0(s.pop)}% chance${s.precip > 0.05 ? `, ${r1(s.precip)} mm/h` : ""}${e && e.rain != null ? ` <span class="sub">· ${r0(e.rain)}% of members wet</span>` : ""}</dd>
      <dt>Sky</dt><dd>${r0(s.cloud)}% cloud · ${r0(s.rh)}% humidity</dd>
      <dt>Sun &amp; air</dt><dd>UV ${r1(s.uv)}${a ? ` · AQI ${r0(a.aqi)} <span class="sub">${aqiLevel(a.aqi).toLowerCase()}</span>` : ""}${pol ? ` · ${pol.name} pollen ${pol.v >= pol.hi ? "high" : "moderate"}` : ""}</dd>
    </dl>`;
}

export function renderNotes() {
  const S = state.samples, tr = state.track, sim = state.sim, notes = [], end = state.endMs;
  const minBike = minOf(S, "bike"), maxT = maxOf(S, "temp");
  // time-weighted wind shares, from every track point
  const share = { head: 0, tail: 0, cross: 0 };
  S.forEach(s => share[s.cat] += s.dt);
  const pct = c => r0(share[c] / (sim.moving || 1) * 100);
  // worst headwind stretch: best 15%-of-route window by mean headwind
  const w = Math.max(1, Math.round(S.length * 0.15));
  let bi = 0, bv = -Infinity;
  for (let i = 0; i + w <= S.length; i++) { const v = S.slice(i, i + w).reduce((a, s) => a + s.head, 0) / w; if (v > bv) { bv = v; bi = i; } }
  if (bv > 4) notes.push(["bad", `Toughest headwind from km ${r0(S[bi].km)} to ${r0(S[bi + w - 1].km)} (around ${fmtTime(S[bi].eta)}), about ${r0(bv)} km/h in your face.`]);
  notes.push([pct("tail") > pct("head") ? "good" : "info", `Wind mix: ${pct("head")}% headwind, ${pct("cross")}% crosswind, ${pct("tail")}% tailwind.`]);
  if (Math.abs(sim.windMin) >= 3) notes.push([sim.windMin > 0 ? "warn" : "good", `The wind ${sim.windMin > 0 ? "costs you" : "saves you"} about ${r0(Math.abs(sim.windMin))} min compared with a still day.`]);
  const lastHalf = S.filter(s => s.km > tr.total / 2000), lh = lastHalf.reduce((a, s) => a + s.head, 0) / (lastHalf.length || 1);
  if (lh < -3) notes.push(["good", `Tailwind on the way home: about ${r0(-lh)} km/h behind you in the second half.`]);
  else if (lh > 4) notes.push(["warn", `Second half is into the wind (≈${r0(lh)} km/h). Save something for it.`]);
  const gusty = S.filter(s => s.gust >= 45);
  if (gusty.length) notes.push(["bad", `Gusts up to ${r0(Math.max(...gusty.map(s => s.gust)))} km/h from km ${r0(gusty[0].km)}. Careful on exposed descents and with deep-section wheels.`]);
  const wet = S.find(s => s.pop >= 50 || s.precip >= 0.3);
  if (wet) notes.push(["bad", `Rain likely from around km ${r0(wet.km)} (${fmtTime(wet.eta)}, ${r0(wet.pop)}% chance). Pack a rain jacket.`]);
  else if (maxOf(S, "pop") >= 25) notes.push(["warn", `Some chance of showers (up to ${r0(maxOf(S, "pop"))}%). A packable jacket is worth it.`]);
  else notes.push(["good", "Dry ride expected."]);
  if (maxT >= 30) notes.push(["warn", `Hot: up to ${r0(maxT)} °C. Carry extra bottles and plan a refill.`]);
  // kit suggestion from the coldest on-bike temperature (wind chill at riding speed)
  let kit;
  if (minBike >= 21) kit = "Short sleeves and shorts.";
  else if (minBike >= 16) kit = "Short sleeves; a gilet for the start or descents.";
  else if (minBike >= 11) kit = "Arm warmers, gilet, maybe knee warmers.";
  else if (minBike >= 6) kit = "Long sleeves or jacket, knee/leg warmers, light gloves.";
  else if (minBike >= 1) kit = "Winter jacket, tights, full gloves, overshoes.";
  else kit = "Full winter kit and watch for ice.";
  notes.push(["info", `Kit (feels as low as ${r0(minBike)} °C on the bike): ${kit}`]);
  if (state.opts.stops.length) notes.push(["info", `Stops: ${state.opts.stops.map(st => `km ${r1(st.km)} (${st.min} min)`).join(", ")}, ${r0(sim.stopSec / 60)} min in total.`]);
  if (state.sun && state.sun.set && end > state.sun.set) notes.push(["bad", `You finish at ${fmtTime(end)}, after sunset (${fmtTime(state.sun.set)}). Bring lights.`]);
  else if (state.sun && state.sun.rise && state.startMs < state.sun.rise) notes.push(["warn", `You start before sunrise (${fmtTime(state.sun.rise)}). Bring lights.`]);
  else if (state.sun && state.sun.set) notes.push(["info", `Sunset ${fmtTime(state.sun.set)}; you finish ${fmtDur((state.sun.set - end) / 1000)} before.`]);
  const ahead = (state.startMs - Date.now()) / DAY;
  if (ahead > 5) notes.push(["warn", `This ride is ${r0(ahead)} days out. Treat it as a trend and check again closer to the day.`]);
  const uvMax = maxOf(S, "uv");
  if (uvMax >= 3) notes.push([uvMax >= 6 ? "warn" : "info", `UV peaks at ${r1(uvMax)} (${uvLevel(uvMax).toLowerCase()}) around ${fmtTime(S.find(x => x.uv === uvMax).eta)}. ${uvMax >= 6 ? "Suncream, and cover arms and neck." : "Suncream on exposed skin."}`]);
  const Aq = state.air ? S.map((s, k) => [s, state.air[k]]).filter(x => x[1]) : [];
  if (Aq.length) {
    const [ws, wa] = Aq.reduce((x, y) => y[1].aqi > x[1].aqi ? y : x);
    if (wa.aqi >= 60) notes.push([wa.aqi >= 80 ? "bad" : "warn", `Air quality ${aqiLevel(wa.aqi).toLowerCase()} (AQI ${r0(wa.aqi)}) around km ${r0(ws.km)}. Keep the effort easy if you're sensitive to it.`]);
    const pol = {};
    Aq.forEach(([, a]) => a.pollen.forEach(p => { if (!pol[p.name] || p.v > pol[p.name].v) pol[p.name] = p; }));
    const hi = Object.values(pol).filter(p => p.v >= p.hi), mid = Object.values(pol).filter(p => p.v >= p.hi / 5 && p.v < p.hi);
    if (hi.length) notes.push(["warn", `High ${hi.map(p => p.name).join(" and ")} pollen. If you get hay fever, take your antihistamine before you go.`]);
    else if (mid.length) notes.push(["info", `Moderate ${mid.map(p => p.name).join(", ")} pollen.`]);
  }
  if (zone.name !== DEVICE_TZ) notes.push(["info", `Times are local to the route (${zone.name.replace(/_/g, " ")}), not this device.`]);
  if (tr.eleSrc === "dem") notes.push(["info", "Your file had no elevation, so climbs come from a 90 m terrain model."]);
  $("#notes").innerHTML = notes.map(([c, t]) => `<li class="${c}">${t}</li>`).join("");
}

export function renderTable() {
  const S = state.samples, multiDay = fmtDay(S[0].eta) !== fmtDay(S[S.length - 1].eta);
  $("#spacingLabel").textContent = `every ${r1(S[1] ? S[1].km - S[0].km : 0)} km · ${fmtDay(state.startMs)} · times in ${zone.name.replace(/_/g, " ")}`;
  const stopAt = s => state.opts.stops.filter(st => nearestSample(st.km) === s);
  $("#rows").innerHTML = S.map((s, k) => {
    const [lbl, ic] = wmo(s.code), st = stopAt(s);
    return `<tr tabindex="0" aria-selected="false"><td class="mono lead" data-label="Km">${r1(s.km).toFixed(1)} km<span class="stopmark">${st.map(x => `· stop ${x.min}′`).join(" ")}</span></td><td data-label="Pass at">${multiDay ? fmtDay(s.eta) + " " : ""}${fmtTime(s.eta)}</td>
      <td data-label="Sky"><span class="wx">${icon(ic)}${lbl}</span></td><td data-label="Temp">${r1(s.temp)}°</td><td data-label="On bike">${r0(s.bike)}°</td>
      <td data-label="Wind (10 m)">${r0(s.ws)} km/h</td><td data-label="Gusts">${r0(s.gust)}</td>
      <td data-label="From"><span class="dir">${arrowSvg((s.wdir + 180) % 360, catColor(s.cat), 14)}${compass(s.wdir)}</span></td>
      <td data-label="For you">${windLabel(s)}</td>
      <td data-label="Rain"><span class="bar" style="width:${Math.max(2, s.pop * 0.4)}px"></span>${r0(s.pop)}%${s.precip > 0.05 ? ` · ${r1(s.precip)} mm` : ""}</td>
      <td data-label="Cloud">${r0(s.cloud)}%</td><td data-label="Humidity">${r0(s.rh)}%</td><td data-label="UV">${r0(s.uv)}</td><td data-label="AQI">${state.air && state.air[k] ? r0(state.air[k].aqi) : "—"}</td><td data-label="Elev.">${state.track.hasEle ? r0(s.ele) + " m" : "—"}</td></tr>`;
  }).join("");
  [...$("#rows").children].forEach((row, i) => {
    const pick = () => { setHover(S[i].km); map.panTo([S[i].lat, S[i].lon]); };
    row.addEventListener("click", pick);
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = row[e.key === "ArrowDown" ? "nextElementSibling" : "previousElementSibling"]; if (n) { n.focus(); n.click(); } }
    });
  });
}

export function renderAll(fit) {
  resetTokens(); // theme may have changed since the last render
  renderSummary(); renderHazards(); renderNotes(); drawMap(fit); renderCharts(); renderBest(); renderTable(); renderReadout();
  const sc = $("#scrub"); sc.max = r1(state.track.total / 1000);
}

/* ---------- run ---------- */
export function setStatus(msg, err) { const el = $("#status"); el.textContent = msg; el.classList.toggle("err", !!err); }
