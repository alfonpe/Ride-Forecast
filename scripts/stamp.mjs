// Stamps a content hash into index.html: the stylesheet, the entry script and (via an import map) every
// module it imports are loaded as file?v=<hash>. A release changes every URL at once, so a browser or CDN
// can never pair a new page with an old cached script. Run `npm run stamp` after changing js/ or styles.css;
// `npm test` fails if the stamp is stale.
import fs from "node:fs";
import crypto from "node:crypto";

const root = new URL("../", import.meta.url), read = f => fs.readFileSync(new URL(f, root), "utf8");

export function assets() {
  return ["styles.css", ...fs.readdirSync(new URL("js/", root)).filter(f => f.endsWith(".js")).sort().map(f => "js/" + f)];
}
export function version(files = assets()) {
  const h = crypto.createHash("sha1");
  for (const f of files) h.update(f + "\0" + read(f));
  return h.digest("hex").slice(0, 10);
}
export function stamp(html, v = version(), files = assets()) {
  const map = { imports: Object.fromEntries(files.filter(f => f.endsWith(".js")).map(f => ["./" + f, `./${f}?v=${v}`])) };
  return html
    .replace(/<!-- version:start -->[\s\S]*?<!-- version:end -->/, `<!-- version:start --><script type="importmap">${JSON.stringify(map)}</script><!-- version:end -->`)
    .replace(/href="styles\.css(\?v=\w+)?"/, `href="styles.css?v=${v}"`)
    .replace(/src="js\/main\.js(\?v=\w+)?"/, `src="js/main.js?v=${v}"`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const html = read("index.html"), out = stamp(html);
  if (out === html) console.log(`index.html already stamped (${version()})`);
  else { fs.writeFileSync(new URL("index.html", root), out); console.log(`stamped index.html with ${version()}`); }
}
