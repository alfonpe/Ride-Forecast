import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPlaces } from "../js/places.js";
import { cache } from "../js/net.js";
import { northTrack } from "./helpers.js";

const at = km => 39.47 + km * 1000 / 111195;
const town = (name, km) => ({ geometry: { coordinates: [-0.37, at(km)] }, properties: { name, osm_key: "place", osm_value: "village" } });

test("names arrive progressively; a slow lookup can't hold the card up past the time limit", async () => {
  const tr = northTrack(25);
  const realFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async url => {
    const n = call++, lat = +new URL(url).searchParams.get("lat");
    await new Promise(r => setTimeout(r, n === 1 ? 900 : 20 * n)); // the second lookup is slower than the limit
    return new Response(JSON.stringify({ features: [town(`T${Math.round((lat - 39.47) * 111.195)}`, (lat - 39.47) * 111.195)] }), { status: 200 });
  };
  try {
    const updates = [];
    const t0 = Date.now();
    const res = await fetchPlaces(tr, u => updates.push(u.places.length), { capMs: 400 });
    assert.ok(Date.now() - t0 < 800, "returned at the time limit");
    assert.ok(updates.length >= 2 && updates.at(-1) >= 2, `progressive: ${updates}`);
    assert.ok(res.partial, "marked partial: one lookup hadn't answered");
    assert.ok(res.places.length >= 2);
  } finally { globalThis.fetch = realFetch; await new Promise(r => setTimeout(r, 600)); }
});

test("all lookups failing gives null (no names), not an error", async () => {
  const realFetch = globalThis.fetch;
  cache.clear(); // answers from the previous test would otherwise be reused
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  try { assert.equal(await fetchPlaces(northTrack(12), () => {}, { capMs: 5000 }), null); }
  finally { globalThis.fetch = realFetch; }
});

test("remembered names: complete ones are reused without asking again", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => { calls++; const lat = +new URL(url).searchParams.get("lat"); return new Response(JSON.stringify({ features: [town("Here", (lat - 39.47) * 111.195)] }), { status: 200 }); };
  try {
    cache.clear();
    const tr = northTrack(18);
    const first = await fetchPlaces(tr, () => {}, { capMs: 5000 });
    assert.ok(first && !first.partial && calls > 0);
    const before = calls; cache.clear();
    const again = await fetchPlaces(tr, () => {}, { capMs: 5000 });
    assert.equal(calls, before, "no new lookups");
    assert.deepEqual(again.places.map(p => p.name), first.places.map(p => p.name));
  } finally { globalThis.fetch = realFetch; delete globalThis.localStorage; }
});

test("when Photon is unreachable, town and pass names come from Overpass", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("photon")) throw new TypeError("blocked by an extension");
    assert.match(decodeURIComponent(opts.body), /around:5000,/);
    return new Response(JSON.stringify({ elements: [
      { type: "node", lat: at(3), lon: -0.37, tags: { place: "town", name: "Popular", population: "12000" } },
      { type: "node", lat: at(6), lon: -0.36, tags: { mountain_pass: "yes", name: "Port Test" } }
    ] }), { status: 200 });
  };
  try {
    cache.clear();
    const updates = [];
    const res = await fetchPlaces(northTrack(9.5), u => updates.push(u.places.length), { capMs: 3000 });
    assert.deepEqual(res.places.map(p => [p.name, p.pop]), [["Popular", 12000]]);
    assert.deepEqual(res.summits.map(s => [s.name, s.key, s.kind]), [["Port Test", "mountain_pass", "pass"]]);
    assert.ok(!res.partial && updates.at(-1) === 1);
  } finally { globalThis.fetch = realFetch; }
});
