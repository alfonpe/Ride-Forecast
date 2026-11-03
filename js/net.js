// JSON fetches with an in-memory cache, a timeout, one retry on a dropped connection, and readable errors.
export const cache = new Map();
const wait = ms => new Promise(r => setTimeout(r, ms));

export async function fetchJSON(url, { timeout = 20000, what = "The weather service", retries = 1 } = {}) {
  if (cache.has(url)) return cache.get(url);
  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    let r, j;
    try {
      r = await fetch(url, { signal: ctl.signal });
      j = await r.json().catch(() => null);
    } catch (e) {
      clearTimeout(timer);
      if (e.name === "AbortError") throw new Error(`${what} didn't answer within ${timeout / 1000} s. Check your connection and try again.`);
      // mobile connections drop requests now and then: try once more before giving up
      if (attempt < retries) { await wait(1500); continue; }
      throw new Error(`Couldn't reach ${what.toLowerCase()}. Check your connection and try again.`);
    }
    clearTimeout(timer);
    if (r.status === 429) throw new Error("Open-Meteo's free request limit has been reached from your network. It resets within the hour (daily at most); try again later.");
    if (r.status >= 500 && attempt < retries) { await wait(1500); continue; }
    if (!r.ok || !j || j.error) throw new Error(j && j.reason ? "Open-Meteo: " + j.reason : `${what} returned an error (${r.status}). Try again in a minute.`);
    cache.set(url, j);
    return j;
  }
}

// Slow-changing lookups (town names, water points) kept on this device: one slot per kind, for the latest route.
export function stored(key, days) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); if (v && Date.now() - v.t < days * 864e5) return v.d; } catch (e) { /* none */ }
  return null;
}
export function store(key, d) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch (e) { /* full or blocked: just not kept */ }
}
