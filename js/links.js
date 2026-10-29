import { $ } from "./util.js";

/* ---------- Garmin Connect links ---------- */
// Garmin has no public API for personal accounts and blocks cross-site downloads,
// so a pasted link becomes a guided export: open it in Garmin Connect, export, drop the file here.
export function parseLink(str) {
  const u = (str || "").trim();
  const m = /connect\.garmin\.com\/(?:app|modern)\/(course|activity)\/(\d+)/i.exec(u);
  if (m) return { src: "garmin", kind: m[1].toLowerCase(), id: m[2] };
  if (/strava\.(?:com|app\.link)/i.test(u)) return { src: "strava" };
  return null;
}
export function handleLink(str) {
  const hint = $("#linkHint"), box = $("#importHelp"), L = parseLink(str);
  hint.className = "hint";
  if (!str.trim()) { hint.textContent = "paste a course or activity link"; box.hidden = true; return; }
  if (!L) { hint.textContent = "not a Garmin Connect course or activity link"; hint.classList.add("link-bad"); box.hidden = true; return; }
  if (L.src === "strava") {
    hint.textContent = "Strava link: export the GPX from Strava instead"; hint.classList.add("link-bad");
    box.innerHTML = `<div class="panel-head"><div><h2>Strava links can't be imported directly</h2><div class="sub">Open it on Strava, use ⋯ → <b>Export GPX</b> (only on your own routes and activities), then drop the file here.</div></div><button class="btn" type="button" data-close>Close</button></div>`;
    box.hidden = false; return;
  }
  const G = "https://connect.garmin.com/modern", course = L.kind === "course";
  const open = `${G}/${L.kind}/${L.id}`;
  const direct = course ? `${G}/proxy/course-service/course/gpx/${L.id}` : `${G}/proxy/download-service/export/gpx/activity/${L.id}`;
  hint.textContent = `Garmin ${L.kind} ${L.id}`; hint.classList.add("link-ok");
  box.innerHTML = `<div class="panel-head"><div><h2>Bring in Garmin ${L.kind} ${L.id}</h2><div class="sub">Garmin doesn't let other sites download your data directly, so it takes one export.</div></div><button class="btn" type="button" data-close>Close</button></div>
    <ol class="steps">
      <li>Open it in Garmin Connect (sign in if asked), then ${course ? "open the <b>⋯</b> menu and choose <b>Export GPX</b> (or Export FIT)" : "open the <b>⚙</b> menu and choose <b>Export to GPX</b> (Export Original's .zip works too)"}.
        <div class="row"><a class="btn primary" href="${open}" target="_blank" rel="noopener">Open in Garmin Connect ↗</a><a class="btn" href="${direct}" target="_blank" rel="noopener" title="Works on some accounts; if you see an error, use the menu instead">Try direct GPX download ↗</a></div></li>
      <li>Drop the downloaded file anywhere on this page, or <label for="file" style="color:var(--accent);cursor:pointer;text-decoration:underline">choose it</label>.</li>
    </ol>`;
  box.hidden = false;
}
