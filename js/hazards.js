import { wmo } from "./icons.js";
import { r0, r1, rad } from "./util.js";

/* ---------- hazards: storms, freezing rain/snow, ice, fog, crosswind gusts, heat ---------- */
export const HAZ = { storm: "Thunderstorm risk", frz: "Freezing rain", snow: "Snow", ice: "Ice risk", fog: "Fog", xwind: "Strong crosswind gusts", heat: "Heat stress" };
export const STORM = [95, 96, 99], FRZ = [56, 57, 66, 67], SNOW = [71, 73, 75, 77, 85, 86];
export function detectHazards(S, tr) {
  const eles = S.map(s => s.ele).sort((a, b) => a - b), high = eles[Math.floor(eles.length * 0.85)];
  const at = S.map(s => {
    const h = [], desc = s.grade <= -0.04, exposed = tr.hasEle && s.ele >= high && s.ele - eles[0] > 100;
    if (STORM.includes(s.code) || (s.cape >= 1500 && s.pop >= 40)) h.push(["storm", "bad", STORM.includes(s.code) ? wmo(s.code)[0] : `unstable air (CAPE ${r0(s.cape)} J/kg) and ${r0(s.pop)}% rain chance`]);
    if (FRZ.includes(s.code)) h.push(["frz", "bad", wmo(s.code)[0]]);
    else if (SNOW.includes(s.code)) h.push(["snow", "bad", wmo(s.code)[0]]);
    if (s.temp <= 2 && (s.precip > 0 || s.wet12 >= 0.5 || s.rh >= 92))
      h.push(["ice", desc || s.temp <= 0 ? "bad" : "warn", `${r1(s.temp)} °C${s.precip > 0 || s.wet12 >= 0.5 ? `, ${r1(s.wet12)} mm of rain in the last 12 h` : `, ${r0(s.rh)}% humidity`}${desc ? `, on a ${r0(-s.grade * 100)}% descent` : ""}`]);
    if ([45, 48].includes(s.code) || s.vis < 1000)
      h.push(["fog", s.vis < 200 ? "bad" : "warn", s.vis < 1e4 ? `visibility about ${s.vis >= 1000 ? r1(s.vis / 1000) + " km" : r0(s.vis / 10) * 10 + " m"}; lights on` : `${wmo(s.code)[0]}; lights on`]);
    const xg = s.gust * Math.abs(Math.sin(rad(s.rel)));  // side-on part of the 10 m gusts
    if (xg >= 40) h.push(["xwind", xg >= 55 || (desc && xg >= 45) ? "bad" : "warn", `${r0(xg)} km/h side-on gusts from the ${s.side}${exposed ? " on exposed high ground" : ""}${desc ? " while descending" : ""}`]);
    if (s.feels >= 35) h.push(["heat", s.feels >= 40 ? "bad" : "warn", `feels like ${r0(s.feels)} °C`]);
    return h;
  });
  // merge checkpoints with the same hazard into stretches (bridging gaps of up to two checkpoints), keeping the worst detail
  const out = [];
  Object.keys(HAZ).forEach(type => {
    let cur = null;
    at.forEach((h, k) => {
      const x = h.find(z => z[0] === type);
      if (!x) return;
      if (cur && cur.k1 >= k - 3) { cur.k1 = k; if (x[1] === "bad" && cur.sev !== "bad") { cur.sev = "bad"; cur.detail = x[2]; } }
      else { cur = { type, sev: x[1], k0: k, k1: k, detail: x[2] }; out.push(cur); }
    });
  });
  return out.sort((a, b) => a.k0 - b.k0 || (a.sev === "bad" ? -1 : 1));
}
