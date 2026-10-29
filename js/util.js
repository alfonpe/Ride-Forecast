// Small shared helpers: DOM lookup, theme tokens, maths and formatting primitives.
export const $ = s => document.querySelector(s);

// CSS custom properties are read once per render instead of once per marker/bar;
// resetTokens() is called whenever the theme may have changed.
const tokens = new Map();
export function css(n) {
  let v = tokens.get(n);
  if (v === undefined) { v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); tokens.set(n, v); }
  return v;
}
export const resetTokens = () => tokens.clear();

export const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const DAY = 864e5, HOUR = 36e5;
export const r0 = v => Math.round(v), r1 = v => Math.round(v * 10) / 10;
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const minOf = (S, k) => Math.min(...S.map(s => s[k]).filter(isFinite)), maxOf = (S, k) => Math.max(...S.map(s => s[k]).filter(isFinite));
export function alpha(c, a) {
  if (c.startsWith("#")) { const n = c.slice(1).match(/\w\w/g).map(h => parseInt(h, 16)); return `rgba(${n.join(",")},${a})`; }
  return c;
}
