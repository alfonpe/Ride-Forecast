import { test } from "node:test";
import assert from "node:assert/strict";
import { wallToMs, msToWall, fmtDur } from "../js/time.js";

test("route-local wall time converts to the right instant, across DST", () => {
  assert.equal(wallToMs("2026-07-01T08:00", "Europe/Madrid"), Date.UTC(2026, 6, 1, 6, 0));   // CEST, UTC+2
  assert.equal(wallToMs("2026-01-15T08:00", "Europe/Madrid"), Date.UTC(2026, 0, 15, 7, 0));  // CET, UTC+1
  assert.equal(wallToMs("2026-03-10T12:00", "America/New_York"), Date.UTC(2026, 2, 10, 16, 0)); // EDT, UTC−4
  assert.ok(Number.isNaN(wallToMs("not a date", "Europe/Madrid")));
});

test("msToWall is the inverse of wallToMs", () => {
  for (const tz of ["Europe/Madrid", "Asia/Tokyo", "America/Los_Angeles", "Australia/Adelaide"]) {
    for (const w of ["2026-02-03T05:30", "2026-08-20T21:15"]) assert.equal(msToWall(wallToMs(w, tz), tz), w, tz);
  }
});

test("fmtDur rounds minutes and never prints 60", () => {
  assert.equal(fmtDur(2 * 3600 + 5 * 60), "2h 05");
  assert.equal(fmtDur(3599.9), "1h 00");
  assert.equal(fmtDur(0), "0h 00");
});
