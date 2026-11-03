import { state } from "./state.js";
import { msToWall, zone } from "./time.js";
import { $, rad } from "./util.js";

/* ---------- share links: the whole ride plan in the URL hash ----------
   v2 links carry the route (+elevation), start time, speed, stops, wind setting, hill pacing,
   time zone and map view. The route is simplified to within a few metres, packed as varint deltas,
   deflated and base64url-encoded: short, and only characters that chat apps never escape or cut at.
   A checksum turns a truncated link into a clear message instead of a broken forecast. */

export class ShareLinkError extends Error {}

// Douglas–Peucker in 3D: keeps every point needed to stay within tolH metres sideways and tolV metres in height
export function simplify(pts, tolH = 5, tolV = 3) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const lat0 = rad(pts[0].lat), kx = 111320 * Math.cos(lat0), ky = 110574;
  const x = pts.map(p => p.lon * kx), y = pts.map(p => p.lat * ky), z = pts.map(p => p.ele ?? 0);
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(), dx = x[b] - x[a], dy = y[b] - y[a], L2 = dx * dx + dy * dy || 1e-9;
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((x[i] - x[a]) * dx + (y[i] - y[a]) * dy) / L2));
      const h = Math.hypot(x[i] - (x[a] + t * dx), y[i] - (y[a] + t * dy)) / tolH;
      const v = Math.abs(z[i] - (z[a] + t * (z[b] - z[a]))) / tolV;
      const d = Math.max(h, v);
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > 1) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const fnv = bytes => { let h = 0x811c9dc5; for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0; return h; };
function pushVar(out, v) { v = v < 0 ? -2 * v - 1 : 2 * v; while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); }
function readVar(b, pos) {
  let v = 0, mul = 1, x;
  do { if (pos.i >= b.length) throw new ShareLinkError("cut"); x = b[pos.i++]; v += (x & 127) * mul; mul *= 128; } while (x & 128);
  return v % 2 ? -(v + 1) / 2 : v / 2;
}
const toB64url = b => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

// layout: [format, flags] ++ deflate?( varint count, then per point Δlat Δlon [Δele] (1e-5° and metres) ++ fnv32 )
export async function encodeRoute(pts, withEle) {
  const body = [];
  pushVar(body, pts.length);
  let la = 0, lo = 0, el = 0;
  for (const p of pts) {
    const a = Math.round(p.lat * 1e5), o = Math.round(p.lon * 1e5);
    pushVar(body, a - la); pushVar(body, o - lo); la = a; lo = o;
    if (withEle) { const e = Math.round(p.ele ?? 0); pushVar(body, e - el); el = e; }
  }
  const raw = Uint8Array.from(body), h = fnv(raw), sum = [h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
  const plain = Uint8Array.from([...raw, ...sum]);
  const deflate = typeof CompressionStream !== "undefined";
  const packed = deflate ? await pipe(plain, new CompressionStream("deflate-raw")) : plain;
  return toB64url(Uint8Array.from([1, (withEle ? 1 : 0) | (deflate ? 2 : 0), ...packed]));
}

export async function decodeRoute(str) {
  const cut = new ShareLinkError("This share link arrived incomplete, probably cut off when it was sent. Ask for it to be shared again.");
  let b;
  try { b = fromB64url(str); } catch (e) { throw cut; }
  if (b.length < 3 || b[0] !== 1) throw cut;
  const withEle = b[1] & 1;
  let plain;
  try { plain = b[1] & 2 ? await pipe(b.subarray(2), new DecompressionStream("deflate-raw")) : b.subarray(2); }
  catch (e) { throw typeof DecompressionStream === "undefined" ? new ShareLinkError("This browser is too old to open share links. Try a recent Chrome, Safari or Firefox.") : cut; }
  if (plain.length < 5) throw cut;
  const raw = plain.subarray(0, plain.length - 4), s = plain.subarray(plain.length - 4);
  if (fnv(raw) !== ((s[0] << 24) | (s[1] << 16) | (s[2] << 8) | s[3]) >>> 0) throw cut;
  const pos = { i: 0 }, n = readVar(raw, pos), pts = [];
  let la = 0, lo = 0, el = 0;
  for (let k = 0; k < n; k++) {
    la += readVar(raw, pos); lo += readVar(raw, pos);
    if (withEle) el += readVar(raw, pos);
    pts.push({ lat: la / 1e5, lon: lo / 1e5, ele: withEle ? el : null });
  }
  if (pts.length < 2 || pts.some(p => !(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180))) throw cut;
  return pts;
}

// legacy v1 links (polyline-style text in `r` / `e`) still open
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

export async function shareURL() {
  const tr = state.track;
  const pts = simplify(tr.pts.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: tr.hasEle ? tr.ele[i] : null })));
  const p = new URLSearchParams({
    v: 2, n: state.name, s: $("#speed").value, t: state.samples ? msToWall(state.startMs) : $("#start").value, h: $("#hills").checked ? 1 : 0,
    w: $("#wf").value, z: zone.name, m: state.metric
  });
  if ($("#stops").value.trim()) p.set("st", $("#stops").value.trim());
  p.set("r", await encodeRoute(pts, tr.hasEle));
  return location.href.split("#")[0] + "#" + p;
}

// Reads a shared plan from the hash, fills in the form, and returns { route, tz, start } (or null if there is none).
export async function planFromHash(hash = location.hash) {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (!p.get("r")) return null;
  let pts;
  if (p.get("v") === "2") pts = await decodeRoute(p.get("r"));
  else {
    const ll = decInts(p.get("r")), e = p.get("e") ? decInts(p.get("e")) : null;
    pts = [];
    for (let k = 0; k + 1 < ll.length; k += 2) pts.push({ lat: ll[k] / 1e5, lon: ll[k + 1] / 1e5, ele: e ? e[k / 2] ?? null : null });
    if (pts.length < 2 || pts.some(q => !(Math.abs(q.lat) <= 90 && Math.abs(q.lon) <= 180))) throw new ShareLinkError("This share link arrived incomplete, probably cut off when it was sent. Ask for it to be shared again.");
  }
  if (p.get("s")) $("#speed").value = p.get("s");
  if (p.get("t")) $("#start").value = p.get("t");
  if (p.has("h")) $("#hills").checked = p.get("h") === "1";
  if (p.get("w") && [...$("#wf").options].some(x => x.value === p.get("w"))) $("#wf").value = p.get("w");
  $("#stops").value = p.get("st") || "";
  const tz = p.get("z");
  let validTz = null;
  try { if (tz) { new Intl.DateTimeFormat("en", { timeZone: tz }); validTz = tz; } } catch (e) {}
  return { route: { name: p.get("n") || "Shared route", pts }, tz: validTz, metric: p.get("m"), start: p.get("t") };
}
