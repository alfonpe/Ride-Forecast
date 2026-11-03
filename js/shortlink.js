/* ---------- short share links (is.gd) ----------
   Real routes make share links of ~4,000 characters, and some apps cut long links. When the user shares, the app asks
   is.gd (free, no account, permanent links, allows browser requests) for a short link that redirects to the full one.
   Each link is shortened once and remembered on the device; if is.gd is unavailable the full link is used. */

const API = "https://is.gd/create.php", KEY = "rf-short", KEEP = 30;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
export function cachedShort(long) { const hit = load().find(([l]) => l === long); return hit ? hit[1] : null; }

export async function shorten(long, { timeout = 8000 } = {}) {
  const hit = cachedShort(long);
  if (hit) return hit;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    // form-encoded POST: a "simple" request (no preflight), and no length limit from the address
    const r = await fetch(API, { method: "POST", body: new URLSearchParams({ format: "json", url: long }), signal: ctl.signal });
    const j = await r.json();
    if (!j || !/^https:\/\/is\.gd\/\w+$/.test(j.shorturl || "")) throw new Error((j && j.errormessage) || "no short link");
    try { localStorage.setItem(KEY, JSON.stringify([[long, j.shorturl], ...load().filter(([l]) => l !== long)].slice(0, KEEP))); } catch (e) { /* not remembered */ }
    return j.shorturl;
  } finally { clearTimeout(timer); }
}
