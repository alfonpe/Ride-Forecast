// The one mutable app state shared by all modules (ES module bindings can't be reassigned by importers).
export const state = {
  routes: [], track: null, name: "", samples: null, startMs: 0, endMs: 0, sun: null, locs: null,
  ens: null, air: null, best: null, hazards: [], opts: null, sim: null, base: null,
  hoverKm: null, metric: "head", shareUrl: null, timeMode: "start", tzText: "",
  baseTrack: null, orient: { s: 0, rev: false }, dirCompare: null, pickingStart: false, poisRaw: undefined, pois: undefined, places: null
};
