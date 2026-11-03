import { test } from "node:test";
import assert from "node:assert/strict";
import { encInts, decInts } from "../js/share.js";

test("share-link integer encoding round-trips", () => {
  const v = [3947000, -38000, 3947010, -37990, 0, 123456789, -123456789, 5];
  assert.deepEqual(decInts(encInts(v)), v);
  assert.deepEqual(decInts(encInts([])), []);
});
