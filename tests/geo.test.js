import { test } from "node:test";
import assert from "node:assert/strict";
import { hav, bearing, compass, thin, buildTrack, locate } from "../js/geo.js";
import { northTrack } from "./helpers.js";

test("haversine and bearing", () => {
  assert.ok(Math.abs(hav({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 111195) < 10);
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })) < 1e-9);
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) - 90) < 1e-6);
  assert.equal(compass(350), "N");
  assert.equal(compass(22.5), "NNE");
  assert.equal(compass(-90), "W");
});

test("dense tracks are thinned to ~25 m without losing length", () => {
  const pts = Array.from({ length: 10001 }, (_, i) => ({ lat: 39 + i * 2 / 111195, lon: 0, ele: null }));
  const out = thin(pts);
  assert.ok(out.length > 700 && out.length < 900, `got ${out.length}`);
  assert.deepEqual(out[0], pts[0]);
  assert.deepEqual(out.at(-1), pts.at(-1));
  const len = P => P.slice(1).reduce((a, p, i) => a + hav(P[i], p), 0);
  assert.ok(Math.abs(len(out) - len(pts)) / len(pts) < 0.001);
});

test("very long routes are capped at ~20k points", () => {
  const pts = Array.from({ length: 200001 }, (_, i) => ({ lat: 39 + i * 3 / 111195, lon: 0, ele: null })); // 600 km
  assert.ok(thin(pts).length <= 20002);
});

test("buildTrack measures distance, heading and elevation", () => {
  const tr = northTrack(10, 10, m => m / 100); // steady 1% climb
  assert.ok(Math.abs(tr.total - 10000) < 15);
  assert.ok(tr.hasEle && tr.eleSrc === "file");
  assert.ok(Math.abs(tr.gain - 100) < 6, `gain ${tr.gain}`);
  assert.ok(Math.abs(tr.cosB[5] - 1) < 1e-6, "heading north");
  const mid = locate(tr, 5000, null);
  assert.ok(Math.abs(mid.lat - (39.47 + 5000 / 111195)) < 1e-4);
});

test("buildTrack rejects a route with one distinct point", () => {
  assert.throws(() => buildTrack([{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }]), /too short/);
});
