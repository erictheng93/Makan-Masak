#!/usr/bin/env node
/**
 * A failure the owner never sees is worse than one shown twice. Flags `catch`
 * blocks in the admin dashboard and kitchen display that log to the console
 * but give the user nothing: no toast/notification, no markErrorHandled, no
 * rethrow, no error state the view renders, no emitted event.
 *
 * Such catches still get the interceptor's deferred, generic toast when the
 * error came from an API call (see apps/admin-dashboard/src/utils/errorHandler.ts),
 * but the message cannot say what went wrong, and non-API failures get nothing.
 * New code should surface the failure, normally through useAsyncAction.
 *
 * Deliberately silent catches (best-effort storage, optional telemetry) opt out
 * with a `silent-catch-ok: <reason>` comment inside the block.
 *
 * Existing ones are tolerated per file in scripts/silent-catches-baseline.json
 * ({ "<file>": allowedCount }); the guard fails only when a file exceeds it,
 * and prints a note when a count can shrink. `--write-baseline` regenerates it.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const APP_DIRS = ["apps/admin-dashboard/src", "apps/kitchen-display/src"];
const BASELINE = path.join(__dirname, "silent-catches-baseline.json");

/** Anything in the catch body that lets the user (or a caller) see the failure. */
const SURFACES = [
  /\btoast\b|\btoast\./, // vue-toastification and wrappers
  /\bnotif(?:y|ication)/i,
  /\bmarkErrorHandled\b/,
  /\bthrow\b/,
  /\bemit\s*\(/,
  /\breject\s*\(/,
  /\balert\s*\(/,
  /\bshow\w*(?:Error|Message|Toast|Alert)\s*\(/,
  /\bhandle\w*Error\s*\(/,
  /\breport\w*Error\s*\(/,
  // error state the template renders: errorMessage.value = …, error = …
  /\b\w*(?:error|Error|message|Message|warning|Warning)\w*(?:\.value)?\s*=(?!=)/,
];

/** Blank out string/template literals and comments, keeping offsets. */
function stripCode(source) {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g,
    (m) =>
      m.startsWith("//") || m.startsWith("/*")
        ? m.replace(/[^\n]/g, " ")
        : m[0] + m.slice(1, -1).replace(/[^\n]/g, " ") + m[m.length - 1],
  );
}

/**
 * @param {string} source file contents (.ts or .vue)
 * @returns {number[]} 1-based line numbers of silent catch blocks
 */
function findSilentCatches(source) {
  const code = stripCode(source);
  const lines = [];
  const re = /\bcatch\s*(?:\(\s*([A-Za-z_$][\w$]*)[^)]*\))?\s*\{/g;
  for (let m; (m = re.exec(code)); ) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) {
        close = i;
        break;
      }
    }
    if (close === -1) continue;
    const strippedBody = code.slice(open + 1, close);
    const rawBody = source.slice(open + 1, close); // comments kept for the opt-out
    if (!/\bconsole\.\w+\s*\(/.test(strippedBody)) continue;
    // Strings and comments are blanked for the surface checks, so a word like
    // "toast" inside a log message does not count; only the opt-out comment is
    // read from the raw text.
    if (/\bsilent-catch-ok\b/.test(rawBody)) continue;
    if (SURFACES.some((p) => p.test(strippedBody))) continue;
    // Handing the caught error back to the caller (`return loginFailure(error)`)
    // makes the caller responsible for showing it.
    const param = m[1];
    if (
      param &&
      new RegExp(`\\breturn\\b[^;]*\\b${param}\\b`).test(strippedBody)
    )
      continue;
    lines.push(code.slice(0, m.index).split("\n").length);
  }
  return lines;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__")
        out.push(...listFiles(full));
    } else if (
      /\.(ts|vue)$/.test(entry.name) &&
      !/\.(test|spec)\.ts$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

function scan(root = ROOT) {
  const found = {};
  for (const dir of APP_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of listFiles(abs)) {
      const hits = findSilentCatches(fs.readFileSync(file, "utf8"));
      if (hits.length)
        found[path.relative(root, file).split(path.sep).join("/")] = hits;
    }
  }
  return found;
}

function main() {
  const found = scan();
  if (process.argv.includes("--write-baseline")) {
    const counts = Object.fromEntries(
      Object.entries(found)
        .sort()
        .map(([f, l]) => [f, l.length]),
    );
    fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
    console.log(
      `Wrote ${Object.keys(counts).length} files to ${path.relative(ROOT, BASELINE)}`,
    );
    return;
  }
  const baseline = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    : {};
  let failed = false;
  for (const [file, lines] of Object.entries(found)) {
    const allowed = baseline[file] ?? 0;
    if (lines.length > allowed) {
      failed = true;
      console.error(
        `${file}: ${lines.length} silent catch block(s), baseline allows ${allowed}`,
      );
      for (const line of lines) console.error(`  ${file}:${line}`);
    }
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const now = found[file]?.length ?? 0;
    if (now < allowed)
      console.log(
        `note: baseline for ${file} can shrink (${allowed} → ${now})`,
      );
  }
  if (failed) {
    console.error(
      "\nA catch block that only logs leaves the owner with no idea the action failed. Surface it (useAsyncAction, a toast, an error the view renders, or rethrow), or mark a deliberately silent one with `// silent-catch-ok: <reason>`.",
    );
    process.exit(1);
  }
  console.log("check-silent-catches: ok");
}

if (require.main === module) main();

module.exports = { findSilentCatches, scan };
