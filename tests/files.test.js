import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { parseFIT, readRouteBytes, routesToGPX, isFit, isZip, isGz } from "../js/files.js";

// build a small FIT course: name message + record messages (one with a compressed-timestamp header)
function fitFile({ name = "Test Course", n = 50 } = {}) {
  const parts = [], u8 = a => parts.push(Uint8Array.from(a));
  const le32 = v => { const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, v, true); return [...new Uint8Array(b.buffer)]; };
  const ule32 = v => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, v, true); return [...new Uint8Array(b.buffer)]; };
  const sc = d => Math.round(d * 2 ** 31 / 180);
  u8([0x40, 0, 0, 31, 0, 1, 5, 16, 7]);                       // definition: course(31) with name (16 bytes)
  u8([0x00, ...new TextEncoder().encode(name.padEnd(16, "\0")).slice(0, 16)]);
  u8([0x41, 0, 0, 20, 0, 4, 253, 4, 0x86, 0, 4, 0x85, 1, 4, 0x85, 78, 4, 0x86]); // record(20)
  for (let i = 0; i < n; i++) {
    const h = i === 10 ? 0x80 | (1 << 5) | 3 : 0x01;
    u8([h, ...ule32(1e9 + i), ...le32(sc(39.47 + i * 0.001)), ...le32(sc(-0.38)), ...ule32((100 + i + 500) * 5)]);
  }
  u8([0x01, ...ule32(2e9), ...le32(0x7fffffff), ...le32(0x7fffffff), ...ule32(0xffffffff)]); // no GPS: skipped
  const data = parts.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array());
  const hdr = new Uint8Array(14), dv = new DataView(hdr.buffer);
  hdr[0] = 14; hdr[1] = 0x10; dv.setUint32(4, data.length, true); hdr.set([0x2e, 0x46, 0x49, 0x54], 8);
  const out = new Uint8Array(14 + data.length + 2); out.set(hdr); out.set(data, 14);
  return out;
}

// a single-entry deflate zip, like Garmin's "Export Original"
function zipOf(name, bytes) {
  const comp = zlib.deflateRawSync(bytes), nm = new TextEncoder().encode(name);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(bytes.length, 22); loc.writeUInt16LE(nm.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(bytes.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(0, 42);
  const cdOff = 30 + nm.length + comp.length, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nm.length, 12); end.writeUInt32LE(cdOff, 16);
  return new Uint8Array(Buffer.concat([loc, nm, comp, cen, nm, end]));
}

test("FIT: positions, altitude, course name; invalid points skipped", () => {
  const f = fitFile();
  assert.ok(isFit(f));
  const [r] = parseFIT(f, "x.fit");
  assert.equal(r.name, "Test Course");
  assert.equal(r.pts.length, 50);
  assert.ok(Math.abs(r.pts[10].lat - 39.48) < 1e-6, "compressed-timestamp record read");
  assert.ok(Math.abs(r.pts[0].ele - 100) < 1e-9);
});

test("FIT without GPS explains itself", () => {
  assert.throws(() => parseFIT(fitFile({ n: 0 }), "indoor.fit"), /No GPS points/);
});

test("Garmin export .zip and .gz are unpacked", async () => {
  const f = fitFile();
  const z = zipOf("activity/123_ACTIVITY.fit", f);
  assert.ok(isZip(z));
  const a = await readRouteBytes(z, "123.zip");
  assert.equal(a.name, "123_ACTIVITY.fit");
  assert.equal(a.routes[0].pts.length, 50);
  const g = new Uint8Array(zlib.gzipSync(f));
  assert.ok(isGz(g));
  assert.equal((await readRouteBytes(g, "c.fit.gz")).routes[0].name, "Test Course");
});

test("routes round-trip to GPX text", () => {
  const gpx = routesToGPX([{ name: "A & B", pts: [{ lat: 1, lon: 2, ele: 3 }, { lat: 1.1, lon: 2, ele: null }] }]);
  assert.equal((gpx.match(/<trkpt /g) || []).length, 2);
  assert.match(gpx, /<name>A &amp; B<\/name>/);
});
