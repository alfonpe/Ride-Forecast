import { test } from "node:test";
import assert from "node:assert/strict";
import { shorten, cachedShort } from "../js/shortlink.js";

test("short links: made once, remembered, errors and odd replies rejected", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const realFetch = globalThis.fetch;
  const sent = [];
  let reply = { shorturl: "https://is.gd/Ab12_x" };
  globalThis.fetch = async (url, opts) => { sent.push({ url, body: String(opts.body), method: opts.method }); return new Response(JSON.stringify(reply)); };
  try {
    const long = "https://alfonpe.github.io/Ride-Forecast/#v=2&n=Test&r=" + "A".repeat(3900);
    assert.equal(await shorten(long), "https://is.gd/Ab12_x");
    assert.equal(sent[0].method, "POST");
    assert.match(sent[0].body, /^format=json&url=https%3A%2F%2Falfonpe/, "long link sent in the body, encoded");
    assert.equal(await shorten(long), "https://is.gd/Ab12_x");
    assert.equal(sent.length, 1, "second time comes from the device");
    assert.equal(cachedShort(long), "https://is.gd/Ab12_x");
    reply = { errorcode: 3, errormessage: "Rate limit exceeded" };
    await assert.rejects(shorten(long + "x"), /Rate limit/);
    reply = { shorturl: "https://evil.example/x" };
    await assert.rejects(shorten(long + "y"), /no short link/, "only is.gd links are accepted");
  } finally { globalThis.fetch = realFetch; delete globalThis.localStorage; }
});
