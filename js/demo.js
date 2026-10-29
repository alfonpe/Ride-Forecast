import { hav } from "./geo.js";

/* ---------- demo route: a loop north-west of Valencia ---------- */
export function demoGPX() {
  const W = [[39.4699,-0.3763,15],[39.4977,-0.4239,40],[39.5025,-0.4406,60],[39.5913,-0.4617,120],[39.6578,-0.4250,200],[39.6845,-0.4290,320],
    [39.6920,-0.4740,450],[39.6990,-0.5290,330],[39.6253,-0.5966,170],[39.5880,-0.5530,110],[39.5660,-0.5280,90],[39.5025,-0.4406,60],[39.4977,-0.4239,40],[39.4699,-0.3763,15]];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let out = "";
  for (let k = 0; k < W.length - 1; k++) {
    const [a0, o0, e0] = W[k], [a1, o1, e1] = W[k + 1];
    const d = hav({ lat: a0, lon: o0 }, { lat: a1, lon: o1 }), n = Math.max(2, Math.round(d / 100));
    const amp = (rnd() - .5) * 0.006, freq = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const f = i / n, wig = Math.sin(Math.PI * f * freq) * amp;
      const lat = a0 + (a1 - a0) * f + wig * (o1 - o0 > 0 ? 1 : -1) * .6, lon = o0 + (o1 - o0) * f + wig;
      const ele = e0 + (e1 - e0) * (0.5 - 0.5 * Math.cos(Math.PI * f)) + Math.sin(f * 9 + k) * 6;
      out += `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`;
    }
  }
  out += `<trkpt lat="39.4699" lon="-0.3763"><ele>15</ele></trkpt>`;
  return `<?xml version="1.0"?><gpx version="1.1" creator="Ride Forecast" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Demo · Valencia – Serra – Llíria loop</name><trkseg>${out}</trkseg></trk></gpx>`;
}
