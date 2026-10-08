#!/usr/bin/env node
/**
 * check-handbook-locales.cjs
 *
 * docs/user-manuals/system-handbook.html (zh-TW) is the master; the five
 * <locale>/system-handbook.html files are hand-translated copies of it, and
 * apps/onboarding-app/public/guide/ ships byte-identical copies of all six.
 *
 * This guard reports drift without judging the translation itself:
 *   - structure: a translated chapter must keep the master's tag/attribute
 *     skeleton (translatable attributes aside), so a chapter that was edited,
 *     added or removed in the master shows up here until it is re-translated;
 *   - shared parts: the CSS, the script (minus its I18N block) and the two
 *     untranslated appendices must match the master;
 *   - published copies: public/guide/ must equal docs/user-manuals/.
 *
 * Fix drift by re-translating the named chapter in each locale file, then
 * copying the six files into apps/onboarding-app/public/guide/.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MANUALS = path.join(ROOT, "docs/user-manuals");
const PUBLISHED = path.join(ROOT, "apps/onboarding-app/public/guide");
const LOCALES = ["en-US", "ja-JP", "id-ID", "vi-VN", "fil-PH"];
const APPENDICES = new Set(["api-catalog", "schema-catalog"]);
const TRANSLATED_ATTRS = new Set([
  "aria-label",
  "placeholder",
  "alt",
  "title",
  "content",
]);

const read = (file) => fs.readFileSync(file, "utf8");

// Locale files sit one directory deeper, so their repo links gain one "../".
const normalizeHrefs = (html) =>
  html.replace(/href="(?:\.\.\/)+/g, 'href="../');

function skeleton(html) {
  const tags = [];
  const tagPattern =
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/gs;
  for (const match of normalizeHrefs(html).matchAll(tagPattern)) {
    const attrs = [...match[3].matchAll(/([a-zA-Z:-]+)(?:="([^"]*)")?/g)]
      .filter(([, name]) => !TRANSLATED_ATTRS.has(name))
      .map(([, name, value]) => `${name}=${value ?? ""}`);
    tags.push(`${match[1]}${match[2]}[${attrs.join(",")}]`);
  }
  return tags;
}

function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return `tag #${i}: ${a[i]} vs ${b[i]}`;
  }
  return `tag count ${a.length} vs ${b.length}`;
}

/** Split a handbook into named chunks: chrome, each article, footer, rest. */
function parts(html) {
  const chrome = html.slice(
    html.indexOf('<a class="skip"'),
    html.indexOf("<article "),
  );
  const articles = new Map();
  for (const match of html.matchAll(
    /<article id="([^"]+)"[\s\S]*?<\/article>/g,
  )) {
    articles.set(match[1], match[0]);
  }
  const footer = html.slice(
    html.indexOf("<footer>"),
    html.indexOf("</footer>") + 9,
  );
  // Everything that is neither translated nor an appendix: head, CSS, script.
  let rest = html
    .replace(chrome, "")
    .replace(footer, "")
    .replace(/<html [^>]*>/, "")
    .replace(/<title>[\s\S]*?<\/title>/, "")
    .replace(/<meta\s+name="description"[\s\S]*?\/>/, "")
    .replace(/const I18N = \{[\s\S]*?\n {6}\};/, "")
    .replace(/<p class="note">[^<]*<\/p>\s*(?=<article id="api-catalog")/, "");
  for (const [id, body] of articles) {
    if (!APPENDICES.has(id)) rest = rest.replace(body, "");
  }
  // Blank lines between chapters are layout, not content.
  return {
    chrome,
    articles,
    footer,
    rest: normalizeHrefs(rest).replace(/\s+/g, " "),
  };
}

const problems = [];
const master = parts(read(path.join(MANUALS, "system-handbook.html")));

for (const locale of LOCALES) {
  const file = path.join(MANUALS, locale, "system-handbook.html");
  if (!fs.existsSync(file)) {
    problems.push(`${locale}: system-handbook.html is missing`);
    continue;
  }
  const copy = parts(read(file));

  const compare = (label, a, b) => {
    const sa = skeleton(a);
    const sb = skeleton(b);
    if (sa.length !== sb.length || sa.some((tag, i) => tag !== sb[i])) {
      problems.push(`${locale}: ${label} drifted (${firstDifference(sa, sb)})`);
    }
  };
  compare("chrome", master.chrome, copy.chrome);
  compare("footer", master.footer, copy.footer);

  for (const [id, body] of master.articles) {
    const other = copy.articles.get(id);
    if (!other) {
      problems.push(`${locale}: article "${id}" is missing`);
    } else if (APPENDICES.has(id)) {
      if (normalizeHrefs(body) !== normalizeHrefs(other)) {
        problems.push(`${locale}: appendix "${id}" differs from the master`);
      }
    } else {
      compare(`article "${id}"`, body, other);
    }
  }
  for (const id of copy.articles.keys()) {
    if (!master.articles.has(id)) {
      problems.push(`${locale}: article "${id}" does not exist in the master`);
    }
  }
  if (master.rest !== copy.rest) {
    problems.push(
      `${locale}: shared CSS/script/appendix text differs from the master`,
    );
  }
}

const published = [
  ["system-handbook.html", "system-handbook.html"],
  ...LOCALES.map((l) => [
    `${l}/system-handbook.html`,
    `${l}/system-handbook.html`,
  ]),
];
for (const [src, dest] of published) {
  const target = path.join(PUBLISHED, dest);
  if (!fs.existsSync(target)) {
    problems.push(
      `published: ${dest} is missing from onboarding-app/public/guide`,
    );
  } else if (read(target) !== read(path.join(MANUALS, src))) {
    problems.push(
      `published: ${dest} is stale; copy it from docs/user-manuals/${src}`,
    );
  }
}

if (problems.length > 0) {
  console.error("[check-handbook-locales] drift found:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `[check-handbook-locales] OK: ${LOCALES.length} locales match the master; published copies are current.`,
);
