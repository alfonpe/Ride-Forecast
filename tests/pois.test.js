import { test } from "node:test";
import assert from "node:assert/strict";
import { poiKind, parsePOIs, placePOIs, waterGap, overpassQuery } from "../js/pois.js";
import { northTrack } from "./helpers.js";

const at = km => 39.47 + km * 1000 / 111195;

test("only drinkable water counts as water", () => {
  assert.equal(poiKind({ amenity: "drinking_water" }), "water");
  assert.equal(poiKind({ amenity: "fountain" }), null, "decorative fountain");
  assert.equal(poiKind({ amenity: "fountain", drinking_water: "yes" }), "water");
  assert.equal(poiKind({ man_made: "water_tap", drinking_water: "yes" }), "water");
  assert.equal(poiKind({ shop: "bakery" }), "cafe");
  assert.equal(poiKind({ amenity: "fuel" }), "shop");
  assert.equal(poiKind({ amenity: "bench" }), null);
});

test("Overpass nodes and ways (via their centre) are parsed", () => {
  const list = parsePOIs([
    { type: "node", lat: 1, lon: 2, tags: { amenity: "cafe", name: " Bar Pepe " } },
    { type: "way", center: { lat: 3, lon: 4 }, tags: { shop: "convenience", opening_hours: "Mo-Su 08:00-22:00" } },
    { type: "node", lat: 5, lon: 6, tags: { amenity: "fountain" } }
  ]);
  assert.deepEqual(list.map(p => [p.kind, p.name, p.lat]), [["cafe", "Bar Pepe", 1], ["shop", "", 3]]);
  assert.equal(list[1].hours, "Mo-Su 08:00-22:00");
});

test("places are put at their km, far ones and near-duplicates dropped", () => {
  const tr = northTrack(30);
  const off = m => -0.38 + m / (111195 * Math.cos(39.6 * Math.PI / 180));
  const placed = placePOIs([
    { kind: "water", lat: at(12), lon: off(50), name: "" },
    { kind: "water", lat: at(12.1), lon: off(20), name: "Font del poble" },   // same tap, mapped twice
    { kind: "cafe", lat: at(20), lon: off(120), name: "Café" },
    { kind: "cafe", lat: at(25), lon: off(900), name: "Too far" }
  ], tr);
  assert.deepEqual(placed.map(p => [p.kind, Math.round(p.km), p.name]), [["water", 12, "Font del poble"], ["cafe", 20, "Café"]]);
  assert.ok(Math.abs(placed[1].off - 120) < 10);
  assert.equal(placePOIs(null, tr), null);
});

test("longest stretch without water counts start and finish", () => {
  assert.deepEqual(waterGap([{ kind: "water", km: 20 }, { kind: "cafe", km: 50 }, { kind: "water", km: 70 }], 100), { from: 20, to: 70, len: 50 });
  assert.deepEqual(waterGap([], 40), { from: 0, to: 40, len: 40 });
});

test("the query stays small on long, wiggly routes", () => {
  const pts = Array.from({ length: 20000 }, (_, i) => ({ lat: 39 + i * 1e-4, lon: 0.01 * Math.sin(i / 15) }));
  const q = overpassQuery(pts), n = q.match(/around:150,([^)]*)\)/)[1].split(",").length / 2;
  assert.ok(n <= 350 && n >= 2, `${n} vertices`);
  assert.match(q, /^\[out:json\]/);
});

test("a place on an out-and-back road is listed for both passes", async () => {
  const { buildTrack } = await import("../js/geo.js");
  // 10 km north and back on the same road
  const pts = [];
  for (let i = 0; i <= 1000; i++) pts.push({ lat: at(i / 100), lon: -0.38 + (i === 500 ? 0 : 0) });
  for (let i = 999; i >= 0; i--) pts.push({ lat: at(i / 100), lon: -0.38 + 0.00002 });
  const placed = placePOIs([{ kind: "water", lat: at(3), lon: -0.3797, name: "Font" }], buildTrack(pts));
  assert.deepEqual(placed.map(p => Math.round(p.km)), [3, 17]);
});
