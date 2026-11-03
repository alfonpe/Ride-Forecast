import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { stamp, version, assets } from "../scripts/stamp.mjs";

test("index.html carries the current version stamp (run `npm run stamp`)", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.equal(html, stamp(html), `stamp is stale: expected ?v=${version()}`);
});

test("the import map covers every module", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const map = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/)[1]).imports;
  for (const f of assets().filter(f => f.endsWith(".js"))) assert.ok(map["./" + f], f);
});
