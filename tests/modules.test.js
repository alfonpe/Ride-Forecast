// Every `import { x } from "./y.js"` must name something y.js exports — a renamed function
// would otherwise only fail when the page loads in a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("../js/", import.meta.url), files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(new URL(f, dir), "utf8")]));
const exportsOf = text => {
  const names = new Set();
  for (const m of text.matchAll(/^export (?:async )?function (\w+)/gm)) names.add(m[1]);
  for (const m of text.matchAll(/^export (?:const|let) (.*)$/gm)) for (const n of m[1].matchAll(/(?:^|,\s*)([\w$]+)\s*(?=[=,;]|$)/g)) names.add(n[1]);
  return names;
};

test("every imported name is exported by its module", () => {
  const missing = [];
  for (const [f, text] of Object.entries(src)) {
    for (const m of text.matchAll(/^import \{([^}]+)\} from "\.\/([\w-]+\.js)";/gm)) {
      assert.ok(src[m[2]], `${f} imports missing file ${m[2]}`);
      const ex = exportsOf(src[m[2]]);
      for (const name of m[1].split(",").map(s => s.trim())) if (!ex.has(name)) missing.push(`${f}: ${name} from ${m[2]}`);
    }
  }
  assert.deepEqual(missing, []);
});
