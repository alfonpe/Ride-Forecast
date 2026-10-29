import { test } from "node:test";
import assert from "node:assert/strict";
import { wxAt, windUV, hourIdx, dataWindow, daylight, isDark, uvLevel, aqiLevel } from "../js/weather.js";
import { loc } from "./helpers.js";

const T0 = Date.UTC(2026, 5, 6, 0) / 1000;

test("hourly values are interpolated to the exact minute", () => {
  const L = loc(T0, 6, { temperature_2m: i => 10 + i });
  assert.equal(wxAt(L, (T0 + 1.5 * 3600) * 1000).temp, 11.5);
  assert.equal(wxAt(L, (T0 - 3600) * 1000).temp, 10, "clamped before the data");
});

test("wind direction is interpolated as a vector (350° → 10° passes north)", () => {
  const L = loc(T0, 3, { wind_speed_10m: 10, wind_direction_10m: i => [350, 10, 10][i] });
  const d = wxAt(L, (T0 + 1800) * 1000).wdir;
  assert.ok(d > 355 || d < 5, `got ${d}`);
  const [u, v] = windUV(L, (T0 + 1800) * 1000);
  assert.ok(v > 9.8 && Math.abs(u) < 0.1);
});

test("missing optional variables fall back instead of breaking", () => {
  const L = loc(T0, 3); L.hourly.wind_gusts_10m = [null, null, null];
  const w = wxAt(L, (T0 + 600) * 1000);
  assert.equal(w.gust, 0);
  assert.equal(w.vis, 1e5);
  assert.equal(w.uv, 0);
});

test("hourIdx clamps to the series", () => {
  const T = [0, 3600, 7200];
  assert.deepEqual(hourIdx(T, 5400), [1, 0.5]);
  assert.deepEqual(hourIdx(T, 99999), [1, 1]);
});

test("dataWindow trims hours with missing values", () => {
  const L = loc(T0, 5, { temperature_2m: i => i === 4 ? null : 10 });
  assert.deepEqual(dataWindow([L]), [T0 * 1000, (T0 + 3 * 3600) * 1000]);
});

test("daylight and levels", () => {
  const days = daylight(loc(T0, 24));
  assert.equal(isDark((T0 + 12 * 3600) * 1000, days), false);
  assert.equal(isDark((T0 + 3 * 3600) * 1000, days), true);
  assert.equal(uvLevel(7), "High");
  assert.equal(aqiLevel(65), "Poor");
});
