// Fixtures shared by the unit tests.
import { buildTrack } from "../js/geo.js";

// a straight route due north from Valencia, one point every `step` metres
export function northTrack(km, step = 10, ele = () => 0) {
  const n = Math.round(km * 1000 / step), pts = [];
  for (let i = 0; i <= n; i++) pts.push({ lat: 39.47 + (i * step) / 111195, lon: -0.38, ele: ele(i * step) });
  return buildTrack(pts);
}

// an Open-Meteo-shaped location with constant (or per-hour) values
export function loc(startSec, hours, v = {}) {
  const time = Array.from({ length: hours }, (_, i) => startSec + i * 3600);
  const col = (k, d) => time.map((t, i) => typeof v[k] === "function" ? v[k](i) : v[k] ?? d);
  return {
    hourly: {
      time, temperature_2m: col("temperature_2m", 15), apparent_temperature: col("apparent_temperature", 15),
      relative_humidity_2m: col("relative_humidity_2m", 60), precipitation_probability: col("precipitation_probability", 0),
      precipitation: col("precipitation", 0), weather_code: col("weather_code", 0), cloud_cover: col("cloud_cover", 20),
      wind_speed_10m: col("wind_speed_10m", 0), wind_direction_10m: col("wind_direction_10m", 0), wind_gusts_10m: col("wind_gusts_10m", 0)
    },
    daily: { sunrise: [startSec + 6 * 3600], sunset: [startSec + 18 * 3600] }
  };
}
