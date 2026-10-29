// JSON fetches with an in-memory cache, a timeout, and readable errors.
export const cache = new Map();

export async function fetchJSON(url, { timeout = 20000, what = "The weather service" } = {}) {
  if (cache.has(url)) return cache.get(url);
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  let r, j;
  try {
    r = await fetch(url, { signal: ctl.signal });
    j = await r.json().catch(() => null);
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${what} didn't answer within ${timeout / 1000} s. Check your connection and try again.`);
    throw new Error(`Couldn't reach ${what.toLowerCase()}. Check your connection and try again.`);
  } finally { clearTimeout(timer); }
  if (r.status === 429) throw new Error("Open-Meteo's free daily request limit has been reached from your network. It resets every day; try again later.");
  if (!r.ok || !j || j.error) throw new Error(j && j.reason ? "Open-Meteo: " + j.reason : `${what} returned an error (${r.status}). Try again in a minute.`);
  cache.set(url, j);
  return j;
}
