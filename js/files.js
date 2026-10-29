import { esc, r1 } from "./util.js";

/* ---------- route files: GPX (every trk and rte) and TCX (courses, activities) ---------- */
export const byTag = (el, t) => [...el.getElementsByTagNameNS("*", t)];
export const child = (el, t) => [...el.children].find(c => c.localName === t);
export function parseRouteFile(text, filename) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("That file isn't valid GPX or TCX. Export the route again and retry.");
  const base = filename.replace(/\.(gpx|tcx)$/i, ""), routes = [];
  const add = (name, pts) => { pts = pts.filter(p => isFinite(p.lat) && isFinite(p.lon) && !(p.lat === 0 && p.lon === 0)); if (pts.length >= 2) routes.push({ name, pts }); };
  const num = el => { const v = el ? parseFloat(el.textContent) : NaN; return isFinite(v) ? v : null; };
  if (doc.documentElement.localName === "TrainingCenterDatabase") {
    [...byTag(doc, "Course"), ...byTag(doc, "Activity")].forEach((c, k) => {
      const nm = child(c, "Name") || child(c, "Id");
      add(nm ? nm.textContent.trim() : `${base} ${k + 1}`, byTag(c, "Trackpoint").map(tp => {
        const pos = byTag(tp, "Position")[0];
        return pos ? { lat: num(byTag(pos, "LatitudeDegrees")[0]), lon: num(byTag(pos, "LongitudeDegrees")[0]), ele: num(byTag(tp, "AltitudeMeters")[0]) } : { lat: NaN };
      }));
    });
  } else {
    const pt = n => ({ lat: parseFloat(n.getAttribute("lat")), lon: parseFloat(n.getAttribute("lon")), ele: num(child(n, "ele")) });
    const meta = byTag(doc, "metadata")[0], metaName = meta && child(meta, "name");
    byTag(doc, "trk").forEach((t, k) => { const nm = child(t, "name"); add(nm ? nm.textContent.trim() : "", byTag(t, "trkpt").map(pt)); });
    byTag(doc, "rte").forEach(t => { const nm = child(t, "name"); add(nm ? nm.textContent.trim() : "", byTag(t, "rtept").map(pt)); });
    const fallback = metaName ? metaName.textContent.trim() : base;
    routes.forEach((r, k) => { if (!r.name) r.name = routes.length > 1 ? `${fallback} · track ${k + 1}` : fallback; });
  }
  if (!routes.length) throw new Error("No track or route points found in this file.");
  return routes;
}

export const isZip = b => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
export const isGz = b => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
export const isFit = b => b.length > 14 && String.fromCharCode(b[8], b[9], b[10], b[11]) === ".FIT";
export async function readRouteBytes(b, name) {
  if (isZip(b)) {
    const e = await unzipFirst(b, /\.(fit|gpx|tcx)$/i);
    if (!e) throw new Error("There's no .fit, .gpx or .tcx file inside that zip.");
    return readRouteBytes(e.data, e.name);
  }
  if (isGz(b)) return readRouteBytes(await inflate(b, "gzip"), name.replace(/\.gz$/i, ""));
  if (isFit(b)) return { routes: parseFIT(b, name), name };
  const text = new TextDecoder().decode(b);
  return { routes: parseRouteFile(text, name), text, name };
}
export async function inflate(b, fmt) {
  if (typeof DecompressionStream === "undefined") throw new Error("This browser can't unpack compressed files. Unzip it first and drop the .fit or .gpx inside.");
  return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream(fmt))).arrayBuffer());
}
// minimal zip reader: walks the central directory and inflates the first matching entry
export async function unzipFirst(b, re) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That zip file looks damaged.");
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0, n = dv.getUint16(eocd + 10, true); k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const fname = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (!re.test(fname)) continue;
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = b.subarray(start, start + size);
    const name = fname.split("/").pop();
    if (method === 0) return { name, data: raw };
    if (method === 8) return { name, data: await inflate(raw, "deflate-raw") };
    throw new Error("That zip uses a compression method this app can't read. Unzip it first.");
  }
  return null;
}

// Garmin FIT: reads "record" messages (lat/lon in semicircles, altitude) and the course name
export function parseFIT(b, filename) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), defs = [], pts = [];
  const end = Math.min(b.length, b[0] + dv.getUint32(4, true));
  let p = b[0], name = "";
  while (p < end) {
    const h = b[p++];
    if (!(h & 0x80) && (h & 0x40)) { // definition message
      const le = b[p + 1] === 0, gnum = dv.getUint16(p + 2, le), nf = b[p + 4], fields = {};
      let size = 0; p += 5;
      for (let i = 0; i < nf; i++, p += 3) { fields[b[p]] = { off: size, size: b[p + 1] }; size += b[p + 1]; }
      if (h & 0x20) { const nd = b[p++]; for (let i = 0; i < nd; i++, p += 3) size += b[p + 1]; }
      defs[h & 0x0f] = { le, gnum, fields, size };
      continue;
    }
    const d = defs[h & 0x80 ? (h >> 5) & 3 : h & 0x0f];
    if (!d) throw new Error("This FIT file couldn't be read. Try exporting the route as GPX instead.");
    const F = d.fields;
    if (d.gnum === 20) {
      const lat = F[0] && F[0].size === 4 ? dv.getInt32(p + F[0].off, d.le) : 0x7fffffff;
      const lon = F[1] && F[1].size === 4 ? dv.getInt32(p + F[1].off, d.le) : 0x7fffffff;
      let ele = null;
      if (F[78] && F[78].size === 4) { const v = dv.getUint32(p + F[78].off, d.le); if (v !== 0xffffffff) ele = v / 5 - 500; }
      if (ele == null && F[2] && F[2].size === 2) { const v = dv.getUint16(p + F[2].off, d.le); if (v !== 0xffff) ele = v / 5 - 500; }
      if (lat !== 0x7fffffff && lon !== 0x7fffffff) pts.push({ lat: lat * 180 / 2 ** 31, lon: lon * 180 / 2 ** 31, ele });
    } else if (d.gnum === 31 && F[5]) {
      const raw = b.subarray(p + F[5].off, p + F[5].off + F[5].size), z = raw.indexOf(0);
      name = new TextDecoder().decode(z >= 0 ? raw.subarray(0, z) : raw).trim();
    }
    p += d.size;
  }
  if (pts.length < 2) throw new Error("No GPS points in this FIT file. Was it an indoor ride?");
  return [{ name: name || filename.replace(/\.fit$/i, ""), pts }];
}

export function routesToGPX(routes) {
  const trk = r => `<trk><name>${esc(r.name)}</name><trkseg>${r.pts.map(q => `<trkpt lat="${q.lat.toFixed(6)}" lon="${q.lon.toFixed(6)}">${q.ele != null ? `<ele>${r1(q.ele)}</ele>` : ""}</trkpt>`).join("")}</trkseg></trk>`;
  return `<?xml version="1.0"?><gpx version="1.1" creator="Ride Forecast" xmlns="http://www.topografix.com/GPX/1/1">${routes.map(trk).join("")}</gpx>`;
}
