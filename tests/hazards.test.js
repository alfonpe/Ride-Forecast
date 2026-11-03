import { test } from "node:test";
import assert from "node:assert/strict";
import { detectHazards } from "../js/hazards.js";

const calm = { code: 2, cape: 0, pop: 0, precip: 0, wet6: 0, wet12: 0, temp: 15, feels: 15, precip: 0, wet12: 0, rh: 60, vis: 24000, gust: 20, rel: 0, side: "right", grade: 0, ele: 100 };
const route = edits => edits.map(e => ({ ...calm, ...e }));
const tr = { hasEle: true };

test("a calm ride has no hazards", () => {
  assert.deepEqual(detectHazards(route([{}, {}, {}]), tr), []);
});

test("storms, fog, ice, crosswinds and heat are detected", () => {
  const Z = detectHazards(route([
    { code: 95 }, { vis: 150 }, { temp: 1, wet12: 2, grade: -0.06 }, { gust: 60, rel: 90 }, { feels: 41 }, { cape: 2000, pop: 50 }
  ]), tr);
  const by = Object.fromEntries(Z.map(z => [z.type + z.k0, z.sev]));
  assert.equal(by.storm0, "bad");
  assert.equal(by.fog1, "bad");
  assert.equal(by.ice2, "bad", "near-freezing, wet, on a descent");
  assert.equal(by.xwind3, "bad");
  assert.equal(by.heat4, "bad");
  assert.equal(by.storm5, "bad", "high CAPE with a likely shower");
});

test("headwind gusts are not crosswind hazards", () => {
  assert.deepEqual(detectHazards(route([{ gust: 70, rel: 0 }]), tr), []);
});

test("nearby checkpoints merge into one stretch; distant ones don't", () => {
  const Z = detectHazards(route([{ vis: 500 }, {}, {}, { vis: 500 }, {}, {}, {}, { vis: 500 }]), tr);
  assert.deepEqual(Z.map(z => [z.k0, z.k1]), [[0, 3], [7, 7]]);
});

test("heavy rain is a hazard, light rain is not", () => {
  assert.deepEqual(detectHazards(route([{ precip: 2 }]), tr), []);
  const [z] = detectHazards(route([{ precip: 9 }]), tr);
  assert.equal(z.type, "rain");
  assert.equal(z.sev, "warn");
  assert.equal(detectHazards(route([{ precip: 35 }]), tr)[0].sev, "bad");
});

test("wet roads: dry now but rain in the hours before", () => {
  assert.deepEqual(detectHazards(route([{ wet6: 0.2 }]), tr), [], "a trace of rain doesn't count");
  assert.equal(detectHazards(route([{ wet6: 1.2 }]), tr)[0].type, "wet");
  assert.equal(detectHazards(route([{ temp: 6, wet6: 0, wet12: 2 }]), tr)[0].type, "wet", "cold roads stay wet longer");
  assert.deepEqual(detectHazards(route([{ wet6: 3, precip: 1 }]), tr), [], "still raining: that's rain, not wet roads");
  assert.ok(!detectHazards(route([{ temp: 1, wet6: 3, wet12: 3 }]), tr).some(z => z.type === "wet"), "near freezing it's an ice risk instead");
});
