#!/usr/bin/env node

/**
 * API Contract Breaking Change Detection
 *
 * Loads every Zod schema exported from apps/api/src/contracts/schemas/*.ts,
 * walks it at runtime, and records one entry per field path together with that
 * field's type. The result is compared against .api-contracts-snapshot.json.
 *
 * What it detects:
 *   - a field added or removed, at any nesting depth
 *   - a field's TYPE changing (ISO string -> Unix millisecond number, etc.)
 *   - optional / nullable gained or lost
 *   - enum members and literal values added or removed
 *   - array element types, and object catchall (`.loose()`) gained or lost
 *
 * What it still does NOT detect:
 *   - refinements and checks — `.int()`, `.min()`, `.max()`, `.regex()` are not
 *     part of the label, so `z.number()` and `z.number().int()` look identical
 *   - a rename, which is still reported as one removal plus one addition
 *   - anything not exported from apps/api/src/contracts/schemas/*.ts
 *
 * The schemas are imported for real (via tsx), so a field that arrives through
 * a spread (`...TimestampFields`) or an envelope helper (`successEnvelope(X)`)
 * is covered like any other. The pre-2026-09-06 extractor read the source text
 * with a regex and saw neither.
 *
 * Usage:
 *   node scripts/check-api-contracts.cjs              # Check for changes (CI mode)
 *   node scripts/check-api-contracts.cjs --update     # Update the snapshot
 *   node scripts/check-api-contracts.cjs --report     # Print current schema shapes
 *
 * Exit codes:
 *   0 — No breaking changes detected (or --update/--report mode)
 *   1 — Breaking changes detected, or the snapshot predates the current format
 */

const fs = require("fs");
const path = require("path");

const SNAPSHOT_FILE = path.resolve(
  __dirname,
  "..",
  ".api-contracts-snapshot.json",
);
const CONTRACTS_DIR = path.resolve(
  __dirname,
  "..",
  "apps",
  "api",
  "src",
  "contracts",
  "schemas",
);

/** Bumped whenever the snapshot entry format changes. */
const SNAPSHOT_VERSION = 2;

/** Root key for the schema itself, so its own modifiers are recorded. */
const ROOT = "$";

/** Guard against a self-referential schema that dodges the identity check. */
const MAX_DEPTH = 20;

/** Zod types that carry no sub-schema — anything else must be walked into. */
const SCALARS = new Set([
  "any",
  "bigint",
  "boolean",
  "date",
  "file",
  "nan",
  "never",
  "null",
  "number",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
]);

// ---------------------------------------------------------------------------
// Schema Shape Extraction (runtime — the schemas are imported and walked)
// ---------------------------------------------------------------------------

function zodDef(value) {
  return value && value._zod && value._zod.def ? value._zod.def : null;
}

/**
 * Peel optional/nullable/default/readonly/catch wrappers off a schema and
 * return the schema underneath plus the suffix that describes them.
 */
function unwrap(schema) {
  let node = schema;
  let nullable = false;
  let optional = false;
  let hasDefault = false;

  for (;;) {
    const def = zodDef(node);
    if (!def || !def.innerType) break;

    if (def.type === "optional") optional = true;
    else if (def.type === "nullable") nullable = true;
    else if (def.type === "default" || def.type === "prefault")
      hasDefault = true;
    else if (
      def.type !== "readonly" &&
      def.type !== "catch" &&
      def.type !== "nonoptional"
    )
      break;

    node = def.innerType;
  }

  const suffix =
    (nullable ? "|null" : "") + (hasDefault ? "=" : "") + (optional ? "?" : "");
  return { node, suffix };
}

/**
 * Write one entry per field path of `schema` into `out`.
 * Containers get an entry of their own so that `.loose()`, `?` and `|null` on
 * the container are visible, not just on its leaves.
 */
function describe(schema, keyPath, out, depth, stack) {
  const { node, suffix } = unwrap(schema);
  const def = zodDef(node);

  if (!def) {
    out[keyPath] = "unknown-schema" + suffix;
    return;
  }

  if (depth > MAX_DEPTH || stack.has(node)) {
    out[keyPath] = def.type + suffix + " <circular>";
    return;
  }

  const child = (segment) => (keyPath === ROOT ? segment : keyPath + segment);
  stack.add(node);

  switch (def.type) {
    case "object": {
      out[keyPath] = "object" + (def.catchall ? "+catchall" : "") + suffix;
      for (const key of Object.keys(def.shape).sort()) {
        describe(
          def.shape[key],
          keyPath === ROOT ? key : keyPath + "." + key,
          out,
          depth + 1,
          stack,
        );
      }
      break;
    }

    case "array":
      out[keyPath] = "array" + suffix;
      describe(def.element, child("[]"), out, depth + 1, stack);
      break;

    case "union": {
      // A union of plain scalars collapses to one label; a union that contains
      // an object or an array is expanded member by member instead.
      const rendered = def.options.map((option) => {
        const scratch = {};
        describe(option, ROOT, scratch, depth + 1, new Set(stack));
        return scratch;
      });

      if (rendered.every((entry) => Object.keys(entry).length === 1)) {
        const labels = rendered.map((entry) => entry[ROOT]).sort();
        out[keyPath] = `union(${labels.join("|")})` + suffix;
      } else {
        out[keyPath] = "union" + suffix;
        def.options.forEach((option, i) =>
          describe(option, child(`|${i}`), out, depth + 1, stack),
        );
      }
      break;
    }

    case "intersection":
      out[keyPath] = "intersection" + suffix;
      describe(def.left, child("&0"), out, depth + 1, stack);
      describe(def.right, child("&1"), out, depth + 1, stack);
      break;

    case "tuple":
      out[keyPath] = "tuple" + suffix;
      (def.items || []).forEach((item, i) =>
        describe(item, child(`[${i}]`), out, depth + 1, stack),
      );
      if (def.rest) describe(def.rest, child("[...]"), out, depth + 1, stack);
      break;

    case "record":
    case "map":
      out[keyPath] = def.type + suffix;
      describe(def.valueType, child("[*]"), out, depth + 1, stack);
      break;

    case "set":
      out[keyPath] = "set" + suffix;
      describe(def.valueType, child("[]"), out, depth + 1, stack);
      break;

    case "enum":
      out[keyPath] =
        `enum(${Object.values(def.entries).map(String).sort().join("|")})` +
        suffix;
      break;

    case "literal":
      out[keyPath] =
        `literal(${def.values.map((v) => JSON.stringify(v)).join("|")})` +
        suffix;
      break;

    case "lazy":
      describe(def.getter(), keyPath, out, depth + 1, stack);
      break;

    case "pipe":
      // A transform hides its output shape; record the input side and say so.
      out[keyPath] = "pipe" + suffix;
      describe(def.in, child("<in>"), out, depth + 1, stack);
      break;

    default:
      // An unhandled composite would silently drop its children — the exact
      // failure mode this script exists to prevent, so flag it loudly.
      out[keyPath] =
        def.type + suffix + (SCALARS.has(def.type) ? "" : " <unmodelled>");
  }

  stack.delete(node);
}

function sortKeys(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
  return sorted;
}

function describeSchema(schema) {
  const out = {};
  describe(schema, ROOT, out, 0, new Set());
  return sortKeys(out);
}

/** A `*_SENSITIVE_FIELDS` array — a name list, not a Zod schema. */
function describeNameList(names) {
  const out = {};
  for (const name of [...names].sort()) out[name] = "sensitive-field";
  return out;
}

function extractSchemasFromFile(filePath) {
  const moduleName = path.basename(filePath, ".ts");
  const exports = require(filePath);
  const schemas = {};

  for (const name of Object.keys(exports).sort()) {
    const value = exports[name];
    if (zodDef(value)) {
      schemas[name] = describeSchema(value);
    } else if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((v) => typeof v === "string")
    ) {
      schemas[name] = describeNameList(value);
    }
  }

  return { module: moduleName, schemas };
}

// ---------------------------------------------------------------------------
// Snapshot Management
// ---------------------------------------------------------------------------

function loadSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) return null;
  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf-8"));
}

function saveSnapshot(modules) {
  const payload = {
    $schemaVersion: SNAPSHOT_VERSION,
    $generatedBy: "scripts/check-api-contracts.cjs",
    modules,
  };
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload, null, 2) + "\n");
}

function buildCurrentSnapshot() {
  // Registered here rather than at module load so that requiring this file for
  // its exported helpers (the unit test does) installs no global require hook.
  require("tsx/cjs");

  const modules = {};
  const files = fs
    .readdirSync(CONTRACTS_DIR)
    .filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
    )
    .sort();

  for (const file of files) {
    const { module, schemas } = extractSchemasFromFile(
      path.join(CONTRACTS_DIR, file),
    );
    if (Object.keys(schemas).length > 0) modules[module] = schemas;
  }

  return modules;
}

// ---------------------------------------------------------------------------
// Diff & Report
// ---------------------------------------------------------------------------

function diffSnapshots(previous, current) {
  const changes = {
    addedModules: [],
    removedModules: [],
    addedSchemas: [],
    removedSchemas: [],
    changedSchemas: [],
  };

  const prevModules = new Set(Object.keys(previous));
  const currModules = new Set(Object.keys(current));

  for (const mod of currModules)
    if (!prevModules.has(mod)) changes.addedModules.push(mod);
  for (const mod of prevModules)
    if (!currModules.has(mod)) changes.removedModules.push(mod);

  for (const mod of currModules) {
    if (!prevModules.has(mod)) continue;

    const prevSchemas = previous[mod] || {};
    const currSchemas = current[mod] || {};
    const prevNames = new Set(Object.keys(prevSchemas));
    const currNames = new Set(Object.keys(currSchemas));

    for (const name of currNames)
      if (!prevNames.has(name)) changes.addedSchemas.push(`${mod}.${name}`);
    for (const name of prevNames)
      if (!currNames.has(name)) changes.removedSchemas.push(`${mod}.${name}`);

    for (const name of currNames) {
      if (!prevNames.has(name)) continue;

      const prevFields = prevSchemas[name] || {};
      const currFields = currSchemas[name] || {};

      const added = Object.keys(currFields).filter((f) => !(f in prevFields));
      const removed = Object.keys(prevFields).filter((f) => !(f in currFields));
      const retyped = Object.keys(currFields)
        .filter((f) => f in prevFields && prevFields[f] !== currFields[f])
        .map((f) => ({ field: f, from: prevFields[f], to: currFields[f] }));

      if (added.length || removed.length || retyped.length) {
        changes.changedSchemas.push({
          schema: `${mod}.${name}`,
          addedFields: added.sort(),
          removedFields: removed.sort(),
          retypedFields: retyped,
        });
      }
    }
  }

  return changes;
}

function hasBreakingChanges(changes) {
  return (
    changes.removedModules.length > 0 ||
    changes.removedSchemas.length > 0 ||
    changes.changedSchemas.some(
      (c) => c.removedFields.length > 0 || c.retypedFields.length > 0,
    )
  );
}

function printReport(modules) {
  console.log("\n API Contract Schema Report");
  console.log("=".repeat(60));

  let totalSchemas = 0;
  let totalFields = 0;

  for (const [mod, schemas] of Object.entries(modules)) {
    const count = Object.keys(schemas).length;
    totalSchemas += count;
    console.log(`\n  ${mod} (${count} schemas)`);

    for (const [name, fields] of Object.entries(schemas)) {
      const paths = Object.keys(fields);
      totalFields += paths.length;
      console.log(`  -- ${name} (${paths.length} paths)`);
      for (const p of paths) console.log(`       ${p}: ${fields[p]}`);
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(
    `Total: ${Object.keys(modules).length} modules, ${totalSchemas} schemas, ${totalFields} field paths`,
  );
}

function printDiff(changes) {
  const breaking = hasBreakingChanges(changes);
  console.log(
    `\n${breaking ? "BREAKING CHANGES DETECTED" : "No breaking changes"}`,
  );
  console.log("=".repeat(60));

  if (changes.addedModules.length > 0) {
    console.log("\n[NEW] New modules:");
    changes.addedModules.forEach((m) => console.log(`  + ${m}`));
  }

  if (changes.removedModules.length > 0) {
    console.log("\n[BREAKING] REMOVED modules:");
    changes.removedModules.forEach((m) => console.log(`  - ${m}`));
  }

  if (changes.addedSchemas.length > 0) {
    console.log("\n[NEW] New schemas:");
    changes.addedSchemas.forEach((s) => console.log(`  + ${s}`));
  }

  if (changes.removedSchemas.length > 0) {
    console.log("\n[BREAKING] REMOVED schemas:");
    changes.removedSchemas.forEach((s) => console.log(`  - ${s}`));
  }

  if (changes.changedSchemas.length > 0) {
    console.log("\n[CHANGED] Changed schemas:");
    for (const c of changes.changedSchemas) {
      const isBreaking =
        c.removedFields.length > 0 || c.retypedFields.length > 0;
      console.log(`  ${isBreaking ? "[BREAKING]" : "[NEW]"} ${c.schema}`);
      c.addedFields.forEach((f) => console.log(`    + ${f} (new field)`));
      c.removedFields.forEach((f) =>
        console.log(`    - ${f} (REMOVED — BREAKING)`),
      );
      c.retypedFields.forEach((r) =>
        console.log(
          `    ~ ${r.field}: ${r.from} -> ${r.to} (TYPE CHANGED — BREAKING)`,
        ),
      );
    }
  }

  const noChanges =
    changes.addedModules.length +
      changes.removedModules.length +
      changes.addedSchemas.length +
      changes.removedSchemas.length +
      changes.changedSchemas.length ===
    0;

  if (noChanges) console.log("\nNo contract changes detected.");
  console.log("");

  return breaking;
}

/**
 * One-off aid for the v1 -> v2 snapshot upgrade. v1 stored a bare array of
 * top-level field names; v2 stores every field path with its type, so the
 * regenerated file is far too large to review line by line. This reduces it to
 * the only question that matters: did the new extractor LOSE any name the old
 * one knew about? It should not — it should only gain (spreads, envelope
 * contents, nested objects).
 */
function printMigrationDelta(previousV1, currentModules) {
  console.log(
    "\nSnapshot format upgraded: v1 (names only) -> v2 (names + types)",
  );
  console.log("=".repeat(60));
  console.log(
    "Reviewing the regenerated file line by line is not useful. Check the\n" +
      "name-level delta below instead: additions are the fix working, and any\n" +
      "removal is a bug in the new extractor.\n",
  );

  let lost = 0;
  let gained = 0;

  for (const [mod, schemas] of Object.entries(previousV1)) {
    for (const [name, oldFields] of Object.entries(schemas)) {
      const newFields = currentModules[mod] && currentModules[mod][name];
      if (!newFields) {
        console.log(`  [LOST SCHEMA] ${mod}.${name}`);
        lost++;
        continue;
      }

      // v1 recorded top-level names; compare against v2's top-level segments.
      const topLevel = new Set(
        Object.keys(newFields)
          .filter((p) => p !== ROOT && !p.includes("."))
          .map((p) => p.replace(/[[|].*$/, "")),
      );
      const missing = oldFields.filter((f) => !topLevel.has(f));
      const extra = [...topLevel].filter((f) => !oldFields.includes(f));

      if (missing.length) {
        console.log(`  [LOST] ${mod}.${name}: ${missing.join(", ")}`);
        lost += missing.length;
      }
      if (extra.length) {
        console.log(`  [GAINED] ${mod}.${name}: ${extra.join(", ")}`);
        gained += extra.length;
      }
    }
  }

  console.log(
    `\nv1 -> v2: ${gained} field names gained, ${lost} lost.` +
      (lost > 0 ? "  <-- investigate every loss before committing." : ""),
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--update")
    ? "update"
    : args.includes("--report")
      ? "report"
      : "check";

  const current = buildCurrentSnapshot();

  if (mode === "report") {
    printReport(current);
    return 0;
  }

  const stored = loadSnapshot();
  const storedVersion = stored ? stored.$schemaVersion || 1 : null;

  if (mode === "update") {
    if (storedVersion === 1) printMigrationDelta(stored, current);
    saveSnapshot(current);
    console.log(`\nSnapshot updated: ${SNAPSHOT_FILE}`);
    return 0;
  }

  if (!stored) {
    console.log("No snapshot found. Creating initial snapshot...");
    saveSnapshot(current);
    printReport(current);
    console.log(`\nInitial snapshot created: ${SNAPSHOT_FILE}`);
    console.log("   Future runs will detect changes against this baseline.");
    return 0;
  }

  if (storedVersion !== SNAPSHOT_VERSION) {
    console.log(
      `\nSnapshot is format v${storedVersion}; this script writes v${SNAPSHOT_VERSION}.\n` +
        "Regenerate it in its own commit: pnpm contract:update\n",
    );
    return 1;
  }

  if (printDiff(diffSnapshots(stored.modules || {}, current))) {
    console.log("Breaking changes detected! Review carefully before merging.");
    console.log("   If intentional, run: pnpm contract:update");
    return 1;
  }

  return 0;
}

module.exports = {
  SNAPSHOT_VERSION,
  buildCurrentSnapshot,
  describeSchema,
  diffSnapshots,
  hasBreakingChanges,
};

if (require.main === module) {
  process.exit(main());
}
