import { charts } from "./charts.js";
import { locate } from "./geo.js";
import { hoverMarker, map } from "./map.js";
import { renderReadout } from "./render.js";
import { state } from "./state.js";
import { $, r1 } from "./util.js";

/* ---------- hover sync (map, charts, scrubber, table) ---------- */
export let raf = 0;
export function setHover(km) {
  state.hoverKm = km;
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    charts.forEach(c => c.config.type !== "polarArea" && c.draw());
    renderReadout();
    const kmv = state.hoverKm == null ? 0 : state.hoverKm;
    $("#scrub").value = kmv; $("#scrubKm").textContent = `${r1(kmv).toFixed(1)} km`;
    if (state.hoverKm == null) { hoverMarker && hoverMarker.remove(); return; }
    const p = locate(state.track, state.hoverKm * 1000);
    hoverMarker.setLatLng([p.lat, p.lon]).addTo(map);
    const s = nearestSample(state.hoverKm);
    document.querySelectorAll("#rows tr").forEach((tr, i) => { const on = state.samples[i] === s; tr.classList.toggle("on", on); tr.setAttribute("aria-selected", on); });
  });
}
export const nearestSample = km => state.samples.reduce((a, b) => Math.abs(b.km - km) < Math.abs(a.km - km) ? b : a);
