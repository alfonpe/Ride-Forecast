
/* ---------- WMO weather codes ---------- */
export const ICON = {
  sun: '<circle cx="10" cy="10" r="3.6"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  part: '<path d="M7 4.2v1.3M3.2 8H2M4.3 5.3l.9.9M10.1 5.3l-.9.9"/><path d="M4.6 9.6A2.8 2.8 0 0 1 9.4 7"/><path d="M7 16h7.5a3 3 0 0 0 .3-6 4.2 4.2 0 0 0-8 1.2A2.4 2.4 0 0 0 7 16z"/>',
  cloud: '<path d="M6 15.5h8.5a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8 1.4A2.5 2.5 0 0 0 6 15.5z"/>',
  fog: '<path d="M3 8h14M5 11h12M3 14h11M6 17h8"/>',
  rain: '<path d="M6 12.5h8.5a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8 1.4A2.5 2.5 0 0 0 6 12.5z"/><path d="M7 15l-1 2.5M10.5 15l-1 2.5M14 15l-1 2.5"/>',
  snow: '<path d="M6 12.5h8.5a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8 1.4A2.5 2.5 0 0 0 6 12.5z"/><path d="M7 15.5h.01M10.5 16.5h.01M14 15.5h.01"/>',
  storm: '<path d="M6 12h8.5a3.2 3.2 0 0 0 .3-6.4 4.6 4.6 0 0 0-8.8 1.4A2.5 2.5 0 0 0 6 12z"/><path d="M10.5 12.5L8.5 15.5h3l-2 3"/>',
  // KPI tile glyphs
  dist: '<path d="M4 15c3 0 3-4 6-4s3-5 6-5"/><circle cx="4" cy="15" r="1.6"/><circle cx="16" cy="6" r="1.6"/>',
  clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 1.5"/>',
  therm: '<path d="M8 11.5V4a2 2 0 0 1 4 0v7.5a3.5 3.5 0 1 1-4 0z"/><path d="M10 8v5"/>',
  wind: '<path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5M3 12h12a2.5 2.5 0 1 1-2.5 2.5"/>',
  gust: '<path d="M3 7h7a2 2 0 1 0-2-2M3 11h11M3 15h7a2 2 0 1 1-2 2"/>',
  drop: '<path d="M10 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/>',
  shield: '<path d="M10 2.8l6 2.4v4.6c0 3.7-2.6 6.2-6 7.4-3.4-1.2-6-3.7-6-7.4V5.2z"/><path d="M7.5 10l1.8 1.8L13 8"/>',
  cup: '<path d="M4 8h10v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM14 9h1.5a2 2 0 0 1 0 4H14M7 3.5v2M10 3.5v2"/>'
};
export function wmo(c) {
  const m = {0:["Clear","sun"],1:["Mainly clear","sun"],2:["Partly cloudy","part"],3:["Overcast","cloud"],45:["Fog","fog"],48:["Rime fog","fog"],
    51:["Light drizzle","rain"],53:["Drizzle","rain"],55:["Heavy drizzle","rain"],56:["Freezing drizzle","rain"],57:["Freezing drizzle","rain"],
    61:["Light rain","rain"],63:["Rain","rain"],65:["Heavy rain","rain"],66:["Freezing rain","rain"],67:["Freezing rain","rain"],
    71:["Light snow","snow"],73:["Snow","snow"],75:["Heavy snow","snow"],77:["Snow grains","snow"],80:["Light showers","rain"],81:["Showers","rain"],82:["Violent showers","rain"],
    85:["Snow showers","snow"],86:["Snow showers","snow"],95:["Thunderstorm","storm"],96:["Storm, hail","storm"],99:["Storm, hail","storm"]};
  return m[c] || ["—","cloud"];
}
export const icon = (k, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
export const arrowSvg = (rot, color, s = 16) => `<svg width="${s}" height="${s}" viewBox="0 0 20 20" style="transform:rotate(${rot}deg)" aria-hidden="true"><path d="M10 2l5 9h-3.5v7h-3v-7H5z" fill="${color}"/></svg>`;
