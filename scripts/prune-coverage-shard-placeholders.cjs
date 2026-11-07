#!/usr/bin/env node
//
// Drop zero-hit "uncovered file" placeholders from Vitest shard blobs when
// another shard really executed that file.
//
// Each `--shard=i/n --coverage --reporter=blob` run adds every
// `coverage.include` file it never loaded as a zero-hit placeholder. That
// placeholder comes from a different transform than the one the file gets when
// a test imports it -- for a .vue SFC the statement maps differ (169 vs 134
// statements for CouponStatsModal.vue) -- and `--merge-reports` merges by
// location, so the placeholder's extra statements stay uncovered forever. On
// the 2026-11-07 run that took the merged total from 62.50% to 59.1% with the
// identical commit and identical 7383 tests. A single run never has a
// placeholder for a loaded file, so removing them restores the single-run
// numbers (simulated: 62.51%). Files no shard loaded keep one placeholder.
//
// Usage: prune-coverage-shard-placeholders.cjs <dir-with-blob-*.json>

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

// flatted is what the blob reporter serialises with; resolve vitest's copy.
const { parse, stringify } = createRequire(
  require.resolve("vitest/package.json"),
)("flatted");

// The blob layout is a Vitest internal, not a public contract (4.1.x:
// [version, files, errors, coverage, ...]). If an upgrade moves it, this
// script must fail loudly: pruning nothing would drop merged coverage ~3.4
// points under the whole-suite floor and read as "someone deleted tests".
const COVERAGE_INDEX = 3;
const UPGRADE_HINT =
  "Vitest's blob format may have changed (upgrade?). Re-check this script " +
  "before trusting the merged coverage.";

const fileData = (entry) => (entry && entry.data ? entry.data : entry);
const hasHits = (entry) => Object.values(fileData(entry).s).some((n) => n > 0);

function assertCoverageShape(coverage, label) {
  const fail = (why) => {
    throw new Error(`${label}: ${why}. ${UPGRADE_HINT}`);
  };
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) {
    fail("no coverage map at the expected position (was --coverage on?)");
  }
  const files = Object.keys(coverage);
  if (files.length === 0) fail("coverage map is empty");
  for (const file of files) {
    const data = fileData(coverage[file]);
    if (!path.isAbsolute(file) || !data || typeof data.s !== "object") {
      fail(`entry "${file}" is not an istanbul file coverage`);
    }
  }
}

function prunePlaceholders(coverages) {
  const files = new Set(coverages.flatMap((c) => (c ? Object.keys(c) : [])));
  let removed = 0;
  for (const file of files) {
    const holders = coverages.filter((c) => c && c[file]);
    const executed = holders.filter((c) => hasHits(c[file]));
    // Nothing ran it anywhere: keep exactly one placeholder, as a single run would.
    const drop = executed.length
      ? holders.filter((c) => !hasHits(c[file]))
      : holders.slice(1);
    for (const c of drop) {
      delete c[file];
      removed++;
    }
  }
  return removed;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: prune-coverage-shard-placeholders.cjs <blob-dir>");
    process.exit(2);
  }
  const blobPaths = fs
    .readdirSync(dir)
    .filter((name) => /^blob-.*\.json$/.test(name))
    .map((name) => path.join(dir, name));
  const blobs = blobPaths.map((p) => parse(fs.readFileSync(p, "utf8")));
  const coverages = blobs.map((b) => b[COVERAGE_INDEX]);
  try {
    coverages.forEach((c, i) => assertCoverageShape(c, blobPaths[i]));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const removed = prunePlaceholders(coverages);
  // Several shards with `coverage.include` always produce placeholders
  // (2026-11: ~2,200 across 4 blobs). Zero means the format or Vitest's
  // placeholder behaviour changed, and the merged numbers can't be trusted.
  if (blobPaths.length > 1 && removed === 0) {
    console.error(
      `Pruned 0 placeholders across ${blobPaths.length} blobs. ${UPGRADE_HINT}`,
    );
    process.exit(1);
  }
  blobPaths.forEach((p, i) => fs.writeFileSync(p, stringify(blobs[i])));
  console.log(
    `Pruned ${removed} placeholder entries across ${blobPaths.length} blobs.`,
  );
}

module.exports = { prunePlaceholders, assertCoverageShape };
