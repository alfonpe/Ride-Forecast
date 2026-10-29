import { locate } from "./geo.js";
import { state } from "./state.js";
import { $ } from "./util.js";

/* ---------- share links: route as an encoded polyline (+elevation) in the URL hash ---------- */
export function encInts(vals) {
  let out = "", prev = 0;
  for (const x of vals) {
    let v = x - prev; prev = x; v = v < 0 ? ~(v << 1) : v << 1;
    while (v >= 0x20) { out += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    out += String.fromCharCode(v + 63);
  }
  return out;
}
export function decInts(str) {
  const out = []; let i = 0, cur = 0;
  while (i < str.length) {
    let r = 0, s = 0, b;
    do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20 && i < str.length);
    cur += r & 1 ? ~(r >> 1) : r >> 1; out.push(cur);
  }
  return out;
}
export function shareURL() {
  const tr = state.track, step = Math.max(40, tr.total / 600), pts = [];
  for (let m = 0; m < tr.total; m += step) pts.push(locate(tr, m));
  pts.push(locate(tr, tr.total));
  const p = new URLSearchParams({
    n: state.name, s: $("#speed").value, t: $("#start").value, h: $("#hills").checked ? 1 : 0, w: $("#wf").value,
    r: encInts(pts.flatMap(q => [Math.round(q.lat * 1e5), Math.round(q.lon * 1e5)]))
  });
  if ($("#stops").value.trim()) p.set("st", $("#stops").value.trim());
  if (tr.hasEle) p.set("e", encInts(pts.map(q => Math.round(q.ele))));
  return location.href.split("#")[0] + "#" + p;
}
export function routeFromHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.get("r")) return null;
  const ll = decInts(p.get("r")), e = p.get("e") ? decInts(p.get("e")) : null, pts = [];
  for (let k = 0; k + 1 < ll.length; k += 2) pts.push({ lat: ll[k] / 1e5, lon: ll[k + 1] / 1e5, ele: e ? e[k / 2] ?? null : null });
  if (p.get("s")) $("#speed").value = p.get("s");
  if (p.get("t")) $("#start").value = p.get("t");
  if (p.has("h")) $("#hills").checked = p.get("h") === "1";
  if (p.get("w") && [...$("#wf").options].some(x => x.value === p.get("w"))) $("#wf").value = p.get("w");
  if (p.has("st")) $("#stops").value = p.get("st");
  return pts.length >= 2 ? { name: p.get("n") || "Shared route", pts } : null;
}
