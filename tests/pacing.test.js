import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, parseStops, riderFeels } from "../js/pacing.js";
import { makeSamples } from "../js/geo.js";
import { northTrack, loc } from "./helpers.js";

const T0 = Date.UTC(2026, 5, 6, 6) / 1000;
const opts = o => ({ speed: 30, hills: true, wf: 1, stops: [], ...o });
const run = (tr, o, wind) => {
  const S = makeSamples(tr);
  const locs = wind ? S.map(() => loc(T0, 48, wind)) : null;
  return simulate(tr, S, locs, T0 * 1000, opts(o), true);
};

test("still air on the flat: time = distance / speed", () => {
  const tr = northTrack(30);
  assert.ok(Math.abs(run(tr).dur - tr.total / (30 / 3.6)) < 1);
});

test("hill pacing keeps the still-air average speed", () => {
  const tr = northTrack(30, 10, m => 300 * Math.sin(m / 3000));
  const sim = run(tr);
  assert.ok(Math.abs(sim.dur - tr.total / (30 / 3.6)) < 1);
  assert.ok(Math.max(...sim.spd) > Math.min(...sim.spd.slice(1)) * 1.5, "faster downhill than up");
});

test("headwind slows you more than the same tailwind speeds you up", () => {
  const tr = northTrack(30), still = run(tr).dur;
  const head = run(tr, {}, { wind_speed_10m: 20, wind_direction_10m: 0 });   // from the north, riding north
  const tail = run(tr, {}, { wind_speed_10m: 20, wind_direction_10m: 180 });
  assert.ok(head.dur > still && tail.dur < still);
  assert.ok(head.dur - still > still - tail.dur);
  assert.ok(head.sectors[0] > 0 && head.sectors[4] === 0, "exposure lands in the head sector");
});

test("the rider-height factor scales the wind effect", () => {
  const tr = northTrack(30), w = { wind_speed_10m: 20, wind_direction_10m: 0 };
  assert.ok(run(tr, { wf: 0.6 }, w).dur < run(tr, { wf: 1 }, w).dur);
});

test("stops add their time once the rider passes them", () => {
  const tr = northTrack(30), base = run(tr);
  const sim = run(tr, { stops: [{ m: 10000, km: 10, min: 20 }] });
  assert.ok(Math.abs(sim.dur - base.dur - 1200) < 1e-6);
  assert.equal(sim.stopSec, 1200);
});

test("parseStops accepts km@min and reports the rest", () => {
  const { stops, bad } = parseStops("45@20, 90 x 10; 12,5@5, nonsense, 500@10", 100000);
  assert.deepEqual(stops.map(s => [s.km, s.min]), [[12.5, 5], [45, 20], [90, 10]]);
  assert.deepEqual(bad.sort(), ["500@10", "nonsense"]);
});

test("on-bike feel: wind chill from airspeed, heat index when hot", () => {
  assert.ok(riderFeels(5, 30, 5) < 1);
  assert.ok(riderFeels(5, 40, 5) < riderFeels(5, 20, 5), "faster feels colder");
  assert.ok(riderFeels(15, 30, 15) < 15 && riderFeels(15, 30, 15) > riderFeels(10, 30, 10));
  assert.equal(riderFeels(30, 30, 33), 33);
  assert.equal(riderFeels(30, 30, 28), 30);
});

test("parseStops: separators and units", () => {
  assert.deepEqual(parseStops("45@20,90@10", 1e6).stops.map(s => s.km), [45, 90]);
  assert.deepEqual(parseStops("30 km @ 15 min; 60:5", 1e6).stops.map(s => [s.km, s.min]), [[30, 15], [60, 5]]);
  assert.deepEqual(parseStops("", 1e6), { stops: [], bad: [] });
});
