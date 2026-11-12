#!/usr/bin/env node
/**
 * Every interactive control in the admin dashboard and kitchen display needs an
 * accessible name. A `title` alone does not count: it is not exposed reliably
 * and is invisible on touch. Flags native <button>/<a> and any native element
 * with @click / role="button" whose content is only icons/svg (no text, no
 * {{ }}, no <slot>, no <img alt>) and which has no aria-label(ledby).
 *
 * Conservative: components (PascalCase / kebab) are never flagged themselves.
 * Known leftovers live in scripts/accessible-names-baseline.json as
 * { "<file>": allowedCount }; the guard fails only when a file exceeds it.
 */
const fs = require("node:fs");
const path = require("node:path");

const APP_DIRS = ["apps/admin-dashboard/src", "apps/kitchen-display/src"];
const OPEN = /<([a-z][a-z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const NAMED_ATTR =
  /(^|\s)(?::|v-bind:)?aria-label(?:ledby)?\s*=|(^|\s)v-(?:text|html)\b/;
const INTERACTIVE = /(^|\s)(?:@click|v-on:click)\b|\brole\s*=\s*["']button["']/;

function templateOf(source) {
  // Blank comments and script/style blocks, keeping offsets for line numbers.
  return source.replace(
    /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    (b) => b.replace(/[^\r\n]/g, " "),
  );
}

function innerOf(tpl, tag, from) {
  const re = new RegExp(`<(/?)${tag}\\b(?:"[^"]*"|'[^']*'|[^>"'])*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (let m; (m = re.exec(tpl)); ) {
    if (m[0].endsWith("/>")) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return tpl.slice(from, m.index);
  }
  return null;
}

function hasName(inner) {
  if (/\{\{|<slot\b|(?:^|\s)(?::|v-bind:)?(?:alt|aria-label)\s*=/.test(inner))
    return true;
  // Strip tags until nothing changes: one pass over "<<b>i>" leaves "<i>",
  // which would count as text. This only decides "is there visible text";
  // the result is never written out as HTML.
  let text = inner;
  for (let prev; prev !== text; ) {
    prev = text;
    text = text.replace(/<[^>]*>/g, "");
  }
  return text.trim() !== "";
}

function findUnnamed(source) {
  const tpl = templateOf(source);
  const out = [];
  OPEN.lastIndex = 0;
  for (let m; (m = OPEN.exec(tpl)); ) {
    const [whole, tag, attrs] = m;
    if (whole.endsWith("/>")) continue;
    if (!(tag === "button" || tag === "a" || INTERACTIVE.test(attrs))) continue;
    if (
      tag === "a" &&
      !/(^|\s)(?::|v-bind:)?href\b|@click|v-on:click/.test(attrs)
    )
      continue;
    if (NAMED_ATTR.test(attrs)) continue;
    if (/(^|\s)aria-hidden\s*=\s*["']true["']/.test(attrs)) continue;
    const inner = innerOf(tpl, tag, m.index + whole.length);
    // Empty elements are click-away backdrops, not controls a user can name.
    if (inner === null || inner.trim() === "" || hasName(inner)) continue;
    out.push({
      line: tpl.slice(0, m.index).split("\n").length,
      index: m.index,
      open: whole,
    });
  }
  return out;
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, files);
    else if (e.name.endsWith(".vue")) files.push(p);
  }
  return files;
}

function checkAccessibleNames({
  root = path.resolve(__dirname, ".."),
  baselinePath = path.join(__dirname, "accessible-names-baseline.json"),
} = {}) {
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
    : {};
  const violations = [];
  const found = {};
  for (const dir of APP_DIRS) {
    for (const file of walk(path.join(root, dir))) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const lines = findUnnamed(fs.readFileSync(file, "utf8")).map(
        (f) => f.line,
      );
      if (lines.length) found[rel] = lines;
      if (lines.length > (baseline[rel] || 0)) {
        for (const line of lines) violations.push({ file: rel, line });
      }
    }
  }
  const stale = Object.keys(baseline).filter(
    (f) => (found[f]?.length || 0) < baseline[f],
  );
  return { violations, found, stale };
}

if (require.main === module) {
  if (process.argv.includes("--write-baseline")) {
    const { found } = checkAccessibleNames({ baselinePath: "/nonexistent" });
    const b = Object.fromEntries(
      Object.entries(found).map(([f, l]) => [f, l.length]),
    );
    fs.writeFileSync(
      path.join(__dirname, "accessible-names-baseline.json"),
      JSON.stringify(b, null, 2) + "\n",
    );
    console.log(`baseline written: ${Object.keys(b).length} files`);
    process.exit(0);
  }
  const { violations, stale } = checkAccessibleNames();
  for (const s of stale)
    console.warn(`note: baseline for ${s} can shrink (fixed controls)`);
  if (violations.length) {
    console.error(
      "Controls without an accessible name (add aria-label; title is not enough):",
    );
    for (const v of violations) console.error(`  ${v.file}:${v.line}`);
    process.exit(1);
  }
  console.log("check-accessible-names: ok");
}

module.exports = { checkAccessibleNames, findUnnamed };
