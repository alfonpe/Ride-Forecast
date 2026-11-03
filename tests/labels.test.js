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
