import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLink } from "../js/links.js";
import { encInts, decInts } from "../js/share.js";

test("Garmin Connect links are recognised", () => {
  assert.deepEqual(parseLink("https://connect.garmin.com/app/course/516073332"), { src: "garmin", kind: "course", id: "516073332" });
  assert.deepEqual(parseLink(" https://connect.garmin.com/modern/activity/987654?share=1 "), { src: "garmin", kind: "activity", id: "987654" });
  assert.deepEqual(parseLink("https://strava.app.link/NzQF5vjXl6b"), { src: "strava" });
  assert.equal(parseLink("https://example.com/course/1"), null);
});

test("share-link integer encoding round-trips", () => {
  const v = [3947000, -38000, 3947010, -37990, 0, 123456789, -123456789, 5];
  assert.deepEqual(decInts(encInts(v)), v);
  assert.deepEqual(decInts(encInts([])), []);
});
