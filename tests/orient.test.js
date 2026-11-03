import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoop, orientTrack, remapKm, toBase, fromBase } from "../js/orient.js";
import { buildTrack, makeSamples, hav } from "../js/geo.js";
import { compareReversed } from "../js/best.js";
import { northTrack, loc } from "./helpers.js";

// a 31.4 km circle with a hill on one side
const circle = buildTrack(Array.from({ length: 1257 }, (_, i) => {
  const a = i / 1256 * 2 * Math.PI;
  return { lat: 39.5 + 0.045 * Math.sin(a), lon: -0.4 + 0.058 * (1 - Math.cos(a)), ele: 100 + 80 * Math.sin(a) };
}));

test("loops are recognised; out-and-back lines are not", () => {
  assert.ok(isLoop(circle));
  assert.ok(!isLoop(northTrack(20)));
});

test("reversing keeps length and elevation, mirrored", () => {
  const r = orientTrack(circle, { rev: true });
  assert.ok(Math.abs(r.total - circle.total) < 5);
  assert.ok(Math.abs(r.ele[0] - circle.ele.at(-1)) < 1e-9);
  assert.ok(Math.abs(r.gain - circle.loss) < 2, "climbing becomes descending");
});

test("a loop can start anywhere and still closes", () => {
  const s = 300, r = orientTrack(circle, { s });
  assert.ok(hav(r.pts[0], circle.pts[s]) < 1);
  assert.ok(hav(r.pts.at(-1), circle.pts[s]) < 1);
  assert.ok(Math.abs(r.total - circle.total) < 30);
});

test("reversed checkpoints land on the same spots, so weather can be reused", () => {
  const tr = northTrack(37.3), alt = orientTrack(tr, { rev: true }), S = makeSamples(tr), A = makeSamples(alt);
  assert.equal(A.length, S.length);
  A.forEach((a, k) => assert.ok(hav(a, S[S.length - 1 - k]) < 2));
});

test("stops keep their spot on the road", () => {
  const T = 100000;
  const line = { loop: false, s0: 0, rev: false }, lineRev = { ...line, rev: true };
  assert.equal(remapKm(30, line, lineRev, T), 70);
  assert.equal(remapKm(70, lineRev, line, T), 30);
  const loopA = { loop: true, s0: 0, rev: false }, loopB = { loop: true, s0: 25000, rev: false }, loopBrev = { ...loopB, rev: true };
  assert.equal(remapKm(30, loopA, loopB, T), 5, "start moved 25 km forward");
  assert.equal(remapKm(10, loopA, loopB, T), 85, "wraps around the loop");
  assert.equal(remapKm(30, loopA, loopBrev, T), 95, "the other way from the new start");
  for (const o of [line, lineRev, loopB, loopBrev]) assert.ok(Math.abs(fromBase(toBase(12345, o, T), o, T) - 12345) < 1e-6);
});

test("compareReversed: a north wind favours riding south", () => {
  const tr = northTrack(30), alt = orientTrack(tr, { rev: true }), S = makeSamples(tr), A = makeSamples(alt);
  const T0 = Date.UTC(2026, 5, 6, 0) / 1000, locs = S.map(() => loc(T0, 48, { wind_speed_10m: 25, wind_direction_10m: 0 }));
  const c = compareReversed(tr, S, alt, A, locs, (T0 + 8 * 3600) * 1000, { speed: 30, hills: true, wf: 0.6, stops: [{ m: 10000, km: 10, min: 15 }] });
  assert.ok(c.alt.dur < c.cur.dur && c.alt.head < 0 && c.cur.head > 0);
  assert.ok(c.alt.score < c.cur.score);
});

test("out-and-back routes are told apart from loops", async () => {
  const { outAndBack } = await import("../js/orient.js");
  const step = 10 / 111195;
  // 20 km north and back on (nearly) the same road
  const out = Array.from({ length: 2001 }, (_, i) => ({ lat: 39.47 + i * step, lon: -0.38 }));
  const back = out.slice(0, -1).reverse().map(p => ({ lat: p.lat, lon: p.lon + 0.00012 })); // ~10 m to the side
  const ob = outAndBack(buildTrack([...out, ...back]));
  assert.ok(ob && ob.shared > 0.9, `shared ${ob && ob.shared}`);
  assert.ok(Math.abs(buildTrack([...out, ...back]).cum[ob.turn] / 1000 - 20) < 0.2, "turns at the far end");
  assert.equal(outAndBack(circle), null, "a loop isn't");
  // a lollipop: 10 km out, a 10 km loop, 10 km back → about two thirds ridden twice, still counted at a lower bar
  const stem = out.slice(0, 1001), loopPts = Array.from({ length: 1000 }, (_, i) => { const a = i / 1000 * 2 * Math.PI; return { lat: stem.at(-1).lat + 0.0143 * Math.sin(a), lon: -0.38 + 0.0187 * (1 - Math.cos(a)) }; });
  const lolli = buildTrack([...stem, ...loopPts, ...stem.slice().reverse().map(p => ({ lat: p.lat, lon: p.lon + 0.0001 }))]);
  assert.equal(outAndBack(lolli), null, "below 70 %");
  assert.ok(outAndBack(lolli, { share: 0.6 }), "but out-and-back at 60 %");
});
