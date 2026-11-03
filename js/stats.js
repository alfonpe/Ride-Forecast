/* ---------- usage counts (GoatCounter: no cookies, no personal data) ----------
   The page view is counted by count.js itself, without the #… part of the address, so a shared plan never
   leaves the device. Here: which features get used, at most once per visit each. Nothing about the route is sent;
   if the counter is blocked or offline, nothing happens. */

const sent = new Set(), waiting = [];

function send(name) {
  try { window.goatcounter.count({ path: name, title: name, event: true }); } catch (e) { /* blocked or offline */ }
}

export function track(name) {
  if (sent.has(name)) return;
  sent.add(name);
  if (window.goatcounter && window.goatcounter.count) send(name);
  else waiting.push(name); // count.js loads after the app starts: send once the page has loaded
}

if (typeof window !== "undefined" && typeof addEventListener === "function") {
  addEventListener("load", () => { if (window.goatcounter && window.goatcounter.count) waiting.splice(0).forEach(send); });
}
