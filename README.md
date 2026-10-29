# Ride Forecast

Weather along a cycling route, at the moment you ride through it: wind for and against you, on-bike temperature, rain, hazards, UV and air quality, and the best time to leave.

Live: https://alfonpe.github.io/Ride-Forecast/

## Run locally

It's a static site with no build step. The JavaScript uses ES modules, which browsers won't load from `file://`, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Tests

```bash
npm test
```

Node 22's built-in test runner; no dependencies to install. CI runs the same on every push.

## Layout

| File | What it does |
|---|---|
| `index.html`, `styles.css` | Markup and styles |
| `js/main.js` | Startup, event wiring, the forecast run |
| `js/state.js` | Shared app state |
| `js/geo.js` | Distances, bearings, track building and thinning, elevation lookup |
| `js/files.js` | GPX, TCX, FIT, zip and gzip reading |
| `js/pacing.js` | Riding simulation (hills, wind, stops), stop parsing, on-bike temperature |
| `js/weather.js` | Forecast, ensemble and air-quality requests; interpolation |
| `js/hazards.js` | Storms, ice, fog, crosswind, heat detection |
| `js/best.js` | Best-time-to-leave scoring |
| `js/map.js`, `js/charts.js`, `js/render.js`, `js/hover.js` | Map, charts, panels and hover sync |
| `js/links.js`, `js/share.js`, `js/demo.js` | Garmin links, share links, demo route |
| `js/net.js`, `js/time.js`, `js/util.js`, `js/icons.js` | Fetching, time zones and formatting, helpers, icons |

Data: [Open-Meteo](https://open-meteo.com/) (forecast, ECMWF ensemble, CAMS air quality, Copernicus DEM elevation). Map © OpenStreetMap contributors.
