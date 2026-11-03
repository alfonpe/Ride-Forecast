import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLabels } from "../js/labels.js";
import { parseOverpass } from "../js/pois.js";
import { northTrack } from "./helpers.js";

const at = km => 39.47 + km * 1000 / 111195;
const east = (km, offKm) => ({ lat: at(km), lon: -0.38 + offKm * 1000 / (111195 * Math.cos(39.7 * Math.PI / 180)) });

test("biggest town per 25 km, within 10 km of the route", () => {
  const tr = northTrack(60);
  const places = [
    { name: "Hamlet", place: "village", pop: 300, ...east(5, 1) },
    { name: "Bigtown", place: "town", pop: 20000, ...east(12, 6) },
    { name: "Faraway City", place: "city", pop: 900000, ...east(15, 25) },   // > 10 km off: ignored
    { name: "Midvillage", place: "village", ...east(33, 2) },
    { name: "Northtown", place: "town", ...east(58, 3) }
  ];
  const L = pickLabels(tr, places, []);
  assert.deepEqual(L.map(l => l.text), ["Bigtown", "Midvillage", "Northtown"]);
});

test("the furthest point gets its nearest town; no duplicates", () => {
  const tr = northTrack(40);
  const L = pickLabels(tr, [{ name: "Start", place: "town", ...east(1, 1) }, { name: "Top", place: "village", ...east(39, 1) }, { name: "Top", place: "village", ...east(39.2, 1) }], []);
  assert.deepEqual(L.map(l => l.text), ["Start", "Top"]);
});

test("high point only when it climbs 200 m above the start, named after a pass there", () => {
  const flat = northTrack(30, 10, m => 100 + 150 * Math.sin(m / 30000 * Math.PI));
  assert.equal(pickLabels(flat, [], []).filter(l => l.type === "high").length, 0, "150 m isn't a climb");
  const hilly = northTrack(30, 10, m => 100 + 500 * Math.sin(m / 30000 * Math.PI));
  const [h] = pickLabels(hilly, [], [{ name: "Coll de Prova", ...east(15, 0.1) }]).filter(l => l.type === "high");
  assert.match(h.text, /^Coll de Prova · 6\d\d m$/);
  assert.ok(Math.abs(h.km - 15) < 1);
});

test("Overpass places, summits and POIs are separated", () => {
  const r = parseOverpass([
    { type: "node", lat: 1, lon: 1, tags: { place: "town", name: "Llíria", population: "23.000" } },
    { type: "node", lat: 2, lon: 2, tags: { natural: "peak", name: "Garbí", ele: "593" } },
    { type: "node", lat: 3, lon: 3, tags: { mountain_pass: "yes", name: "Coll" } },
    { type: "node", lat: 4, lon: 4, tags: { amenity: "drinking_water" } },
    { type: "node", lat: 5, lon: 5, tags: { place: "hamlet", name: "Tiny" } }
  ]);
  assert.deepEqual(r.places.map(p => [p.name, p.pop]), [["Llíria", 23000]]);
  assert.deepEqual(r.summits.map(p => [p.name, p.ele]), [["Garbí", 593], ["Coll", null]]);
  assert.equal(r.pois.length, 1);
});

test("Photon results become places (bilingual names shortened) or summits", async () => {
  const { photonFeatures } = await import("../js/places.js");
  const json = { features: [
    { geometry: { coordinates: [-0.45, 39.6] }, properties: { name: "Nàquera / Náquera", osm_key: "place", osm_value: "village" } },
    { geometry: { coordinates: [-0.5, 39.7] }, properties: { name: "Garbí", osm_key: "natural", osm_value: "peak" } },
    { geometry: { coordinates: [] }, properties: { name: "Broken" } }
  ] };
  assert.deepEqual(photonFeatures(json, p => p.osm_key === "place").map(p => [p.name, p.place]), [["Nàquera", "village"]]);
  assert.deepEqual(photonFeatures(json, p => p.osm_key === "natural").map(p => p.name), ["Garbí"]);
  assert.deepEqual(photonFeatures(null), []);
});

test("summit named after the road pass on its climb, even ~1.6 km off the road", () => {
  const tr = northTrack(30, 10, m => 100 + 600 * Math.sin(m / 30000 * Math.PI)); // climb km 0–15, summit at km 15
  const name = (summits) => pickLabels(tr, [], summits).filter(l => l.type === "high").map(l => l.text.replace(/\d+ m$/, "N m"));
  assert.deepEqual(name([{ name: "Puerto Alto", key: "mountain_pass", kind: "pass", ...east(11, 1.6) }]), ["Puerto Alto · N m"]);
  assert.deepEqual(name([{ name: "Port Baixada", key: "mountain_pass", kind: "pass", ...east(25, 1.6) }]), ["N m"], "on the descent: not this climb");
  assert.deepEqual(name([{ name: "Port Lluny", key: "mountain_pass", kind: "pass", ...east(11, 3) }]), ["N m"], "3 km off: another road");
  assert.deepEqual(name([{ name: "Collado", place: "saddle", kind: "pass", ...east(12, 1) }]), ["N m"], "a terrain saddle 1 km off doesn't count");
  assert.deepEqual(name([{ name: "Coll del Cim", place: "saddle", kind: "pass", ...east(14.5, 0.1) }]), ["Coll del Cim · N m"], "crossed saddle near the top");
  assert.deepEqual(name([{ name: "Port A", key: "mountain_pass", ...east(9, 1.8) }, { name: "Port B", key: "mountain_pass", ...east(13, 0.6) }]), ["Port B · N m"], "closest to the road wins");
});

test("only one label at the high point (no separate pass label)", () => {
  const tr = northTrack(30, 10, m => 100 + 600 * Math.sin(m / 30000 * Math.PI));
  const L = pickLabels(tr, [], [{ name: "Coll Baix", kind: "pass", place: "saddle", ...east(5, 0.1) }]);
  assert.deepEqual(L.map(l => l.type), ["high"]);
});

test("the climb starts at the last low point before the summit", async () => {
  const { climbStart } = await import("../js/labels.js");
  // hill to 400 m at km 5, valley 150 m at km 10, summit 900 m at km 20
  const tr = northTrack(25, 10, m => m < 5000 ? 100 + m * 0.06 : m < 10000 ? 400 - (m - 5000) * 0.05 : m < 20000 ? 150 + (m - 10000) * 0.075 : 900 - (m - 20000) * 0.1);
  let hi = 0; tr.ele.forEach((e, i) => { if (e > tr.ele[hi]) hi = i; });
  assert.ok(Math.abs(tr.cum[climbStart(tr, hi)] / 1000 - 10) < 0.3);
});
