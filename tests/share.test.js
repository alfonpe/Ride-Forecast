import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRoute, decodeRoute, simplify, ShareLinkError } from "../js/share.js";

// a wiggly 60 km loop with hills, one point every ~25 m
const route = Array.from({ length: 2400 }, (_, i) => ({
  lat: 39.47 + 0.15 * Math.sin(i / 380) + 0.0004 * Math.sin(i / 7), lon: -0.38 + 0.2 * (1 - Math.cos(i / 380)),
  ele: 50 + 300 * Math.sin(i / 500) + 4 * Math.sin(i / 3)
}));

test("simplify stays within 5 m sideways and 3 m in height of the original", () => {
  const s = simplify(route), idx = s.map(p => route.indexOf(p));
  assert.ok(s.length < route.length * 0.75, `kept ${s.length} of ${route.length}`);
  const kx = 111320 * Math.cos(39.47 * Math.PI / 180), ky = 110574;
  let worstH = 0, worstV = 0;
  for (let k = 0; k < idx.length - 1; k++) {
    const A = route[idx[k]], B = route[idx[k + 1]], dx = (B.lon - A.lon) * kx, dy = (B.lat - A.lat) * ky, L2 = dx * dx + dy * dy || 1e-9;
    for (let i = idx[k] + 1; i < idx[k + 1]; i++) {
      const P = route[i], px = (P.lon - A.lon) * kx, py = (P.lat - A.lat) * ky, t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
      worstH = Math.max(worstH, Math.hypot(px - t * dx, py - t * dy));
      worstV = Math.max(worstV, Math.abs(P.ele - (A.ele + t * (B.ele - A.ele))));
    }
  }
  assert.ok(worstH <= 5.01 && worstV <= 3.01, `worst ${worstH.toFixed(2)} m sideways, ${worstV.toFixed(2)} m height`);
});

test("route codec round-trips to 1e-5° and 1 m, URL-safe and compact", async () => {
  const pts = simplify(route), enc = await encodeRoute(pts, true);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  assert.ok(enc.length < 4000, `length ${enc.length}`);
  const back = await decodeRoute(enc);
  assert.equal(back.length, pts.length);
  back.forEach((q, k) => {
    assert.ok(Math.abs(q.lat - pts[k].lat) <= 6e-6 && Math.abs(q.lon - pts[k].lon) <= 6e-6);
    assert.ok(Math.abs(q.ele - pts[k].ele) <= 0.5);
  });
});

test("routes without elevation decode with ele = null", async () => {
  const back = await decodeRoute(await encodeRoute(route.slice(0, 50), false));
  assert.equal(back[0].ele, null);
});

test("a truncated or altered link is reported, not decoded into garbage", async () => {
  const enc = await encodeRoute(simplify(route), true);
  for (const bad of [enc.slice(0, enc.length - 7), enc.slice(0, 40), enc.replace(/.(?=.{30}$)/, c => c === "A" ? "B" : "A"), "", "%%%"]) {
    await assert.rejects(decodeRoute(bad), ShareLinkError, `should reject ${bad.slice(-10)}`);
  }
});
