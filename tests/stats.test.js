import { test } from "node:test";
import assert from "node:assert/strict";

test("feature counts: once per visit, nothing about the route, silent when blocked", async () => {
  const calls = [];
  globalThis.window = globalThis;
  const { track } = await import("../js/stats.js");
  window.goatcounter = { count: v => calls.push(v) };
  track("share-link"); track("share-link"); track("share-image");
  assert.deepEqual(calls, [{ path: "share-link", title: "share-link", event: true }, { path: "share-image", title: "share-image", event: true }]);
  window.goatcounter = { count: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => track("home-by"));
  delete window.goatcounter;
  assert.doesNotThrow(() => track("file-imported"));
});
