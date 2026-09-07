#!/usr/bin/env node
/**
 * UI reachability guard — finds Vue views and components that nothing renders.
 *
 * The recurring bug this exists for: a component and its API both get built,
 * the two are never wired together, and the result is dead UI nobody can reach
 * from the running app. It reads as working code during maintenance and
 * silently absorbs effort. #285, #307, #309, #313, #344 were all this shape;
 * #308 was found only because someone happened to grep for the importer.
 *
 * Nothing else in the repo detects it. A component's own unit test passes
 * perfectly well on a component nobody renders — `ClockInOutPanel.test.ts`
 * mounted the panel green for months while the product had no path to it. That
 * is why test files are excluded from the importer graph here: counting them is
 * precisely what hid #308.
 *
 * ---------------------------------------------------------------------------
 * How it decides
 *
 * Reachability is the transitive closure of *import edges* starting from each
 * app's entry points (`src/main.ts`, `src/App.vue`, `src/router/index.ts` —
 * every index.html in this repo loads `/src/main.ts`). Anything under `src/`
 * that the closure never touches is unreachable.
 *
 * Working on import edges rather than on route tables is what makes the router
 * cases fall out for free:
 *
 *   - `component: () => import("@/views/Foo.vue")` is the normal case here, not
 *     the exception, and it is just a dynamic import like any other.
 *   - `children:` nesting does not matter; the edge exists at whatever depth.
 *   - `{ path: "leaves", redirect: { name: "EmployeeLeaves" } }` names no
 *     component, so there is simply no edge to find — nothing to special-case.
 *   - `defineAsyncComponent(() => import("@/components/X.vue"))` and the
 *     `useAsyncModals()` loader table are ordinary dynamic imports too.
 *
 * ---------------------------------------------------------------------------
 * Why a false positive is the failure that matters
 *
 * A checker that calls live code dead gets ignored, then disabled. Every
 * judgement call below is therefore biased toward "reachable":
 *
 *   - The extension probe includes `.vue`, which Vite's own default
 *     `resolve.extensions` does not. Guessing wide costs nothing; a missed
 *     resolution turns a live component into a false accusation.
 *   - A file with no import edge is only reported as dead if its basename
 *     appears *nowhere* in the app's non-test source. Anything mentioned but
 *     not imported goes to a separate "needs review" bucket instead of the
 *     dead list. That second pass is a deliberate net under the resolver: if
 *     the import scanner ever misses an edge shape, the file lands in the soft
 *     bucket rather than being asserted dead.
 *   - Comments are stripped before scanning for imports, because
 *     `useDynamicComponents.ts` carries `@example` blocks containing real
 *     `import("@/components/…")` calls that would otherwise resurrect dead
 *     components. Regex literals are consumed properly so that a `/"/` cannot
 *     desynchronise the string scanner and eat a real import.
 *   - Import paths are compared by `fs.existsSync`, never by regex. The one
 *     regex that touches a path is the quoted-string matcher, and it captures
 *     the literal contents rather than testing them.
 *
 * ---------------------------------------------------------------------------
 * What it cannot decide
 *
 * A component reached only through a runtime string lookup is live and will
 * look dead. Those sites are located and reported separately rather than being
 * folded into either verdict — see `findDynamicSites`.
 *
 * Run: node scripts/check-ui-reachability.cjs [--update-baseline]
 */

const fs = require("node:fs");
const path = require("node:path");

const BASELINE_PATH = "scripts/ui-reachability-baseline.json";

/** Every Vite app in the repo. All five share the `@` -> `src` alias. */
const APPS = [
  "apps/admin-dashboard",
  "apps/customer-app",
  "apps/kitchen-display",
  "apps/management-portal",
  "apps/onboarding-app",
];

/**
 * Roots of the reachability closure. `main.ts` alone would nearly do — it
 * imports both of the others — but naming all three keeps the closure standing
 * if an app ever mounts without going through its entry module.
 */
const ENTRY_FILES = ["src/main.ts", "src/App.vue", "src/router/index.ts"];

/**
 * Extension probe order for an extensionless specifier. `.vue` is included on
 * purpose even though Vite would not resolve `./Foo` to `Foo.vue`: over-
 * resolving only ever hides a dead file, while under-resolving invents one.
 */
const EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".vue",
  ".json",
];

/** File kinds worth opening for further import edges. */
const TRAVERSABLE = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".vue",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".wrangler",
]);

/**
 * Test and fixture material. Excluded both as importers (a test importing a
 * component proves nothing about the product) and as candidates (a mock SFC is
 * not dead UI).
 */
const TEST_DIR_RE =
  /(^|\/)(__tests__|__mocks__|tests|test|e2e|fixtures|stories|mocks)(\/|$)/;
const TEST_FILE_RE = /\.(test|spec|stories|story|bench|mock)\.[cm]?[jt]sx?$/;

const QUOTED = `"((?:[^"\\\\\\n]|\\\\.)*)"|'((?:[^'\\\\\\n]|\\\\.)*)'`;

const IMPORT_PATTERNS = [
  // import x from "y" / export * from "y" / export { a } from "y"
  new RegExp(String.raw`\bfrom\s*(?:${QUOTED})`, "g"),
  // import("y") — the router's lazy loader, defineAsyncComponent, everything
  new RegExp(String.raw`\bimport\s*\(\s*(?:${QUOTED})`, "g"),
  // import "y" — side effects (css, polyfills)
  new RegExp(String.raw`\bimport\s+(?:${QUOTED})`, "g"),
  // require("y")
  new RegExp(String.raw`\brequire\s*\(\s*(?:${QUOTED})`, "g"),
];

const toPosix = (p) => p.split(path.sep).join("/");

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does `text` reference a component called `stem` in a way that could be a real
 * render site the import graph failed to see?
 *
 * Deliberately narrower than `text.includes(stem)`. A bare substring test reads
 * `ref<BackupAlert[]>` in a store, `Partial<AudioSettings>` in a service and the
 * i18n key `revenueTrendChart` as evidence that BackupAlert.vue,
 * AudioSettings.vue and TrendChart.vue are alive — three separate coincidences
 * in this repo alone, all of them the same shape as matching `data-testid=
 * "leaves-apply"` against the key `leaves.apply`. So: a path-shaped mention, a
 * PascalCase tag in an SFC (where templates actually live), or the name as a
 * whole quoted string.
 *
 * Every one of the three is anchored at both ends. `TrendChart.vue` as a plain
 * substring is a suffix of `MetricTrendChart.vue`, which is a live component in
 * a different directory — so an unanchored path test lets any component vouch
 * for a dead one whose name it happens to end with.
 */
function referencesComponent(text, stem, isSfc) {
  const escaped = escapeRegExp(stem);
  if (new RegExp(`(^|[^A-Za-z0-9_$])${escaped}\\.vue`).test(text)) return true;
  if (new RegExp(`["']${escaped}["']`).test(text)) return true;
  return isSfc && new RegExp(`<${escaped}[\\s/>]`).test(text);
}

/* -------------------------------------------------------------------------- */
/* Source scanning                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Characters after which a `/` opens a regex literal rather than dividing.
 * Without this the scanner reads `/"/ ` as the start of a string and swallows
 * whatever follows, including any import statement below it.
 */
const REGEX_PRECEDERS = new Set([
  "(",
  "{",
  "[",
  ",",
  ";",
  ":",
  "!",
  "&",
  "|",
  "?",
  "+",
  "-",
  "*",
  "/",
  "%",
  "~",
  "^",
  "=",
  "<",
  ">",
  "\n",
  undefined,
]);

/**
 * Blank out comments while leaving string literals, regex literals and line
 * numbering intact. Written as a scanner rather than a regex because the three
 * constructs nest into each other: `// "` and `/"/` and `` `//` `` all mean
 * different things, and getting one wrong drops a real import edge.
 */
function stripComments(code) {
  let out = "";
  let last;
  let i = 0;
  const n = code.length;

  while (i < n) {
    const c = code[i];

    if (c === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && code[i + 1] === "*") {
      i += 2;
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) {
        if (code[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < n) {
        if (code[i] === "\\") {
          out += code.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += code[i];
        if (code[i] === c) {
          i++;
          break;
        }
        i++;
      }
      last = c;
      continue;
    }

    if (c === "/" && REGEX_PRECEDERS.has(last)) {
      out += c;
      i++;
      let inClass = false;
      while (i < n && code[i] !== "\n") {
        if (code[i] === "\\") {
          out += code.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (code[i] === "[") inClass = true;
        else if (code[i] === "]") inClass = false;
        out += code[i];
        if (code[i] === "/" && !inClass) {
          i++;
          break;
        }
        i++;
      }
      last = "/";
      continue;
    }

    out += c;
    i++;
    if (!/\s/.test(c) || c === "\n") last = c;
  }

  return out;
}

/**
 * Return the script text of a file: for an SFC, only the `<script>` blocks.
 *
 * Running the JS comment stripper over a whole `.vue` file would be wrong in a
 * way that produces false accusations — a `/*` inside a template string or a
 * `//` inside a URL in the template would blank out arbitrary spans, and if one
 * of those spans reached a `<script>` block below it the imports there would
 * vanish and every component that block loads would be reported dead.
 */
function scriptText(file, source) {
  if (!file.endsWith(".vue")) return source;
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = source.indexOf("<script", cursor);
    if (open === -1) break;
    const bodyStart = source.indexOf(">", open);
    if (bodyStart === -1) break;
    const close = source.indexOf("</script>", bodyStart);
    if (close === -1) break;
    // Keep the leading newlines so reported line numbers stay honest.
    out += "\n".repeat(countNewlines(source, cursor, bodyStart + 1));
    out += source.slice(bodyStart + 1, close);
    cursor = close;
  }
  return out;
}

function countNewlines(text, from, to) {
  let count = 0;
  for (let i = from; i < to; i++) if (text[i] === "\n") count++;
  return count;
}

/** Every import/require specifier in a file, comments excluded. */
function extractSpecifiers(file, source) {
  const code = stripComments(scriptText(file, source));
  const found = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const spec = match[1] ?? match[2];
      if (spec) found.add(spec);
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Default file probe. `analyseApp` passes an in-memory index instead: the
 * probe order tries up to 17 candidates per specifier, and paying two Windows
 * syscalls for each of them took the whole run from under a second to minutes.
 */
function fsProbe(candidate) {
  const stat = fs.statSync(candidate, { throwIfNoEntry: false });
  return stat && stat.isFile() ? candidate : null;
}

function firstExisting(candidates, probe) {
  for (const candidate of candidates) {
    const hit = probe(candidate);
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve one specifier to an absolute file inside the app's `src/`, or null.
 *
 * `@makanmasak/*` and bare package specifiers deliberately resolve to null: no
 * workspace package can import an app's own views, so the closure has no reason
 * to leave the app.
 */
function resolveSpecifier(spec, importerFile, srcDir, probe = fsProbe) {
  const clean = spec.split("?")[0].split("#")[0];
  if (!clean) return null;

  let base;
  if (clean === "@" || clean.startsWith("@/")) {
    base = path.join(srcDir, clean.slice(2));
  } else if (clean.startsWith("./") || clean.startsWith("../")) {
    base = path.resolve(path.dirname(importerFile), clean);
  } else {
    return null; // bare specifier, workspace package, virtual module
  }

  return (
    firstExisting([base], probe) ??
    firstExisting(
      EXTENSIONS.map((ext) => base + ext),
      probe,
    ) ??
    firstExisting(
      EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
      probe,
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                  */
/* -------------------------------------------------------------------------- */

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function isTestPath(relPosix) {
  return TEST_DIR_RE.test(relPosix) || TEST_FILE_RE.test(relPosix);
}

/** views / components / other, keyed off the first segment under `src/`. */
function categorise(relFromSrc) {
  const top = relFromSrc.split("/")[0];
  if (top === "views") return "views";
  if (top === "components") return "components";
  return "other";
}

/* -------------------------------------------------------------------------- */
/* Undecidable sites                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Sites where a component is chosen at runtime from something other than an
 * import. A component reached only this way is live but has no import edge, so
 * the honest answer is "cannot be decided statically" rather than "dead".
 *
 * `<component :is="expr">` is *not* on this list when `expr` is a JavaScript
 * expression: whatever it evaluates to still had to be imported somewhere, so
 * the ordinary graph already covers it. Only a name *string* — resolved against
 * globally registered components at runtime — escapes the graph.
 */
const SCRIPT_SITE_PATTERNS = [
  {
    kind: "computed dynamic import",
    re: /\bimport\s*\(\s*(?![`"'])[^)\s]/g,
    note: "import() with a non-literal path — the target cannot be named",
  },
  {
    kind: "template-literal dynamic import",
    re: /\bimport\s*\(\s*`/g,
    note: "import() with a template literal — the target cannot be named",
  },
  {
    kind: "glob import",
    re: /\bimport\s*\.\s*meta\s*\.\s*glob\s*\(|\brequire\s*\.\s*context\s*\(/g,
    note: "matches files by pattern; everything it matches is live",
  },
  {
    kind: "name-based component lookup",
    re: /\bresolveComponent\s*\(|\bresolveDynamicComponent\s*\(/g,
    note: "resolves a globally registered component by string name",
  },
  {
    kind: "global registration",
    re: /\bapp\s*\.\s*component\s*\(\s*["'][^"']+["']/g,
    note: "registers a name usable in any template without an import",
  },
];

/**
 * `<component is="Foo">` / `<component :is="'Foo'">` — a name string resolved
 * at runtime. `:is` bound to an *expression* is not here on purpose: whatever
 * that expression evaluates to still had to be imported, so the import graph
 * already accounts for it.
 */
const TEMPLATE_SITE_PATTERNS = [
  {
    // `is="Foo"` — unbound, so the attribute value is the name itself. The
    // leading \s is load-bearing: it is what keeps `:is` and `v-bind:is` out.
    kind: "literal <component is>",
    re: /<component\b[^>]*?\sis\s*=\s*"[^"]*"/g,
    note: "renders a component named by an unbound string name",
  },
  {
    // `:is="'Foo'"` — bound, but to a string literal rather than to a value
    // that had to be imported.
    kind: "literal <component :is>",
    re: /<component\b[^>]*?\s(?::|v-bind:)is\s*=\s*"\s*'[^']*'\s*"/g,
    note: "renders a component named by a string literal",
  },
];

function findDynamicSites(file, source, repoRel) {
  const hits = [];
  const push = (kind, note, text, index) =>
    hits.push({
      file: repoRel,
      line: countNewlines(text, 0, index) + 1,
      kind,
      note,
    });

  // Script patterns run against comment-free script text only. Running the JS
  // comment stripper over a whole SFC would let a `/*` in the template blank
  // out an arbitrary span of the file.
  const code = stripComments(scriptText(file, source));
  for (const { kind, re, note } of SCRIPT_SITE_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(code)) !== null)
      push(kind, note, code, match.index);
  }

  if (file.endsWith(".vue")) {
    for (const { re, kind, note } of TEMPLATE_SITE_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(source)) !== null)
        push(kind, note, source, match.index);
    }
  }

  return hits;
}

/* -------------------------------------------------------------------------- */
/* Per-app analysis                                                           */
/* -------------------------------------------------------------------------- */

function analyseApp(root, appDir) {
  const appAbs = path.resolve(root, appDir);
  const srcDir = path.join(appAbs, "src");
  if (!fs.existsSync(srcDir)) return null;

  /** absolute path -> { abs, ext, relFromSrc, repoRel, isTest } */
  const files = new Map();
  for (const abs of walk(srcDir)) {
    const relFromSrc = toPosix(path.relative(srcDir, abs));
    const ext = path.extname(abs);
    files.set(abs, {
      abs,
      ext,
      relFromSrc,
      repoRel: `${appDir}/src/${relFromSrc}`,
      isTest: isTestPath(relFromSrc),
    });
  }

  // Case-folded index of everything under `src/`. Resolution never needs to
  // leave that tree — a workspace package cannot import an app's views — so
  // membership here answers the probe without touching the filesystem again.
  // Folding case keeps a mis-cased specifier resolving (the build is the thing
  // that should complain about that, not this checker).
  const index = new Map();
  for (const abs of files.keys()) index.set(abs.toLowerCase(), abs);
  const probe = (candidate) => index.get(candidate.toLowerCase()) ?? null;

  const sourceCache = new Map();
  const read = (abs) => {
    let cached = sourceCache.get(abs);
    if (cached === undefined) {
      cached = fs.readFileSync(abs, "utf8");
      sourceCache.set(abs, cached);
    }
    return cached;
  };

  // ---- closure -----------------------------------------------------------
  const reachable = new Set();
  const queue = [];
  for (const entry of ENTRY_FILES) {
    const abs = path.join(appAbs, entry);
    if (fs.existsSync(abs)) {
      reachable.add(abs);
      queue.push(abs);
    }
  }

  while (queue.length > 0) {
    const current = queue.pop();
    if (!TRAVERSABLE.has(path.extname(current))) continue;
    let source;
    try {
      source = read(current);
    } catch {
      continue;
    }
    for (const spec of extractSpecifiers(current, source)) {
      const target = resolveSpecifier(spec, current, srcDir, probe);
      if (!target || reachable.has(target)) continue;
      const meta = files.get(target);
      // A production module importing a test file would be a bug of its own;
      // either way it must not launder that file's dependencies into the
      // reachable set.
      if (!meta || meta.isTest) continue;
      reachable.add(target);
      queue.push(target);
    }
  }

  // ---- routed views, for context ----------------------------------------
  const routerAbs = path.join(srcDir, "router", "index.ts");
  const routedViews = new Set();
  if (fs.existsSync(routerAbs)) {
    for (const spec of extractSpecifiers(routerAbs, read(routerAbs))) {
      const target = resolveSpecifier(spec, routerAbs, srcDir, probe);
      if (!target) continue;
      const rel = toPosix(path.relative(srcDir, target));
      if (rel.startsWith("views/") || rel.startsWith("layouts/")) {
        routedViews.add(target);
      }
    }
  }

  // ---- candidates --------------------------------------------------------
  const candidates = [...files.values()].filter(
    (f) => f.ext === ".vue" && !f.isTest,
  );

  // Safety net under the resolver: the basename of a genuinely dead file
  // should appear nowhere in the *live* source. Anything that is mentioned but
  // has no import edge goes to a softer bucket instead — if the import scanner
  // ever misses an edge shape, the file lands there rather than being asserted
  // dead.
  //
  // Only reachable files count as mentions, for the same reason tests do not.
  // #344 was a whole cluster: `LeaveView.vue` was dead and took four components
  // with it, and every one of those four is named in the dead parent. Letting
  // dead code vouch for dead code would have hidden the four.
  const productionText = [...files.values()]
    .filter((f) => !f.isTest && TRAVERSABLE.has(f.ext) && reachable.has(f.abs))
    .map((f) => ({
      abs: f.abs,
      repoRel: f.repoRel,
      text: read(f.abs),
      isSfc: f.ext === ".vue",
    }));

  const unreachable = { views: [], components: [], other: [] };
  const mentioned = [];

  for (const file of candidates) {
    if (reachable.has(file.abs)) continue;
    const stem = path.basename(file.abs, ".vue");
    const mentionedIn = productionText.filter(
      (other) =>
        other.abs !== file.abs &&
        referencesComponent(other.text, stem, other.isSfc),
    );
    if (mentionedIn.length > 0) {
      mentioned.push({
        path: file.repoRel,
        mentionedIn: mentionedIn.map((m) => m.repoRel).slice(0, 3),
      });
      continue;
    }
    unreachable[categorise(file.relFromSrc)].push(file.repoRel);
  }

  for (const list of Object.values(unreachable)) list.sort();
  mentioned.sort((a, b) => a.path.localeCompare(b.path));

  // ---- dynamic sites, from reachable production code only ----------------
  const dynamicSites = [];
  for (const file of files.values()) {
    if (!reachable.has(file.abs) || !TRAVERSABLE.has(file.ext)) continue;
    dynamicSites.push(
      ...findDynamicSites(file.abs, read(file.abs), file.repoRel),
    );
  }
  dynamicSites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  const counts = { views: 0, components: 0, other: 0 };
  for (const file of candidates) counts[categorise(file.relFromSrc)]++;

  return {
    app: appDir,
    counts,
    routedViews: routedViews.size,
    reachableModules: reachable.size,
    unreachable,
    mentioned,
    dynamicSites,
  };
}

/* -------------------------------------------------------------------------- */
/* Baseline + reporting                                                       */
/* -------------------------------------------------------------------------- */

function baselineFor(results) {
  const apps = {};
  for (const result of results) {
    apps[result.app] = {
      unreachableViews: result.unreachable.views,
      unreachableComponents: result.unreachable.components,
      unreachableOther: result.unreachable.other,
      needsReview: result.mentioned.map((m) => m.path),
    };
  }
  return apps;
}

const BASELINE_NOTE =
  "Accepted-unreachable Vue files, per app. Every path here is dead UI that " +
  "check-ui-reachability.cjs found and a human has not yet ruled on — the file " +
  "is not endorsed, only recorded, so the check fails on NEW dead UI instead of " +
  "on the existing backlog. `needsReview` is the softer bucket: no import edge, " +
  "but the name appears somewhere in production source, so the tool declines to " +
  "call it dead. See the UI reachability section of docs/TODOS.md for the " +
  "per-file findings. Regenerate with `node scripts/check-ui-reachability.cjs " +
  "--update-baseline` and review the diff; entries should only ever be removed.";

function checkUiReachability(options = {}) {
  const root = options.root ?? process.cwd();
  const baselinePath = path.resolve(
    root,
    options.baselinePath ?? BASELINE_PATH,
  );

  const results = [];
  for (const appDir of options.apps ?? APPS) {
    const result = analyseApp(root, appDir);
    if (result) results.push(result);
  }

  const current = baselineFor(results);
  let baseline = { apps: {} };
  if (fs.existsSync(baselinePath)) {
    baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  }

  const added = [];
  const stale = [];
  for (const [app, buckets] of Object.entries(current)) {
    const known = baseline.apps?.[app] ?? {};
    for (const [bucket, paths] of Object.entries(buckets)) {
      const accepted = new Set(known[bucket] ?? []);
      for (const p of paths)
        if (!accepted.has(p)) added.push({ app, bucket, path: p });
      const now = new Set(paths);
      for (const p of accepted)
        if (!now.has(p)) stale.push({ app, bucket, path: p });
    }
  }

  return { results, current, baseline, added, stale, baselinePath };
}

function writeBaseline(baselinePath, current) {
  const payload = {
    note: BASELINE_NOTE,
    generatedBy: "node scripts/check-ui-reachability.cjs --update-baseline",
    apps: current,
  };
  fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + "\n");
}

function report(state) {
  const { results, added, stale } = state;

  for (const r of results) {
    const dead =
      r.unreachable.views.length +
      r.unreachable.components.length +
      r.unreachable.other.length;
    console.log(`\n${r.app}`);
    console.log(
      `  scanned ${r.counts.views} views, ${r.counts.components} components, ` +
        `${r.counts.other} other SFC(s); ${r.reachableModules} modules reachable`,
    );
    console.log(`  routed view/layout modules: ${r.routedViews}`);
    console.log(
      `  unreachable: ${r.unreachable.views.length} view(s), ` +
        `${r.unreachable.components.length} component(s), ` +
        `${r.unreachable.other.length} other  (total ${dead})`,
    );
    console.log(
      `  needs review (named in source, never imported): ${r.mentioned.length}`,
    );
    for (const m of r.mentioned) {
      console.log(`    ? ${m.path}  <- named by ${m.mentionedIn.join(", ")}`);
    }
    console.log(`  undecidable dispatch sites: ${r.dynamicSites.length}`);
    for (const site of r.dynamicSites) {
      console.log(
        `    ! ${site.file}:${site.line}  ${site.kind} — ${site.note}`,
      );
    }
  }

  if (stale.length > 0) {
    console.log(
      `\nBaseline has ${stale.length} stale entr${stale.length === 1 ? "y" : "ies"} ` +
        `(now reachable or deleted) — refresh with --update-baseline:`,
    );
    for (const s of stale) console.log(`  - ${s.path}`);
  }

  if (added.length > 0) {
    console.error(
      `\nUI reachability check FAILED: ${added.length} newly unreachable file(s).`,
    );
    for (const a of added) {
      console.error(`  - ${a.path}  [${a.app}, ${a.bucket}]`);
    }
    console.error(
      "\nNothing in the running app imports these. Either wire them up (a route, " +
        "a parent component) or delete them. If the file is genuinely reached in a " +
        "way this tool cannot see, record it with --update-baseline and say why in " +
        "the commit message.",
    );
    return false;
  }

  console.log("\nUI reachability check passed — no new dead UI.");
  return true;
}

if (require.main === module) {
  const update = process.argv.includes("--update-baseline");
  const state = checkUiReachability();
  if (update) {
    writeBaseline(state.baselinePath, state.current);
    console.log(`Wrote ${BASELINE_PATH}`);
    report({ ...state, added: [], stale: [] });
    process.exit(0);
  }
  process.exit(report(state) ? 0 : 1);
}

module.exports = {
  checkUiReachability,
  analyseApp,
  stripComments,
  extractSpecifiers,
  resolveSpecifier,
  scriptText,
  APPS,
};
