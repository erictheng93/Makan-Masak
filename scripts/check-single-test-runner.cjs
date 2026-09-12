#!/usr/bin/env node
/**
 * One vitest, one vite, across the whole workspace.
 *
 * pnpm keys a package instance by its entire resolved peer set, so two
 * packages that disagree about any peer of vite/vitest do not share the
 * runner -- they each get their own copy. The root workspace runner
 * (`pnpm exec vitest run`, which is what CI runs) loads every project's
 * config through Promise.all, and two vite copies mid-load trip a Node race:
 *
 *   Cannot require() ES Module .../vite/dist/node/index.js because it is not
 *   yet fully loaded.   code: 'ERR_INTERNAL_ASSERTION'
 *
 * That fails the whole suite at startup with zero tests run, roughly one run
 * in six -- the kind of red that gets waved through as "just re-run it". The
 * repo has been split this way twice: once on @types/node / jsdom / terser,
 * and once on `supports-color`, which `debug` declares as an optional peer and
 * pnpm bubbles up to every importer (#366).
 *
 * This is the readlink check CLAUDE.md documents, run by a gate instead of by
 * hand. It reads what is *linked*, never what is left lying in the virtual
 * store: pnpm does not remove pre-consolidation directories, so counting
 * `node_modules/.pnpm/vitest@*` reports a permanent false alarm.
 *
 * Needs an installed workspace; it skips cleanly when there is none, because
 * a missing node_modules is "nothing to check", not "the invariant broke".
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WATCHED = ["vitest", "vite"];

/** Every place pnpm links workspace dependencies into. */
function nodeModulesDirs() {
  const dirs = [path.join(ROOT, "node_modules")];
  for (const group of ["apps", "packages"]) {
    const base = path.join(ROOT, group);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      dirs.push(path.join(base, entry.name, "node_modules"));
    }
  }
  return dirs.filter((d) => fs.existsSync(d));
}

/** The .pnpm instance a link points at, e.g. "vitest@4.1.9_@types+node@25...". */
function instanceOf(link) {
  const target = fs.readlinkSync(link);
  const m = target.match(/\.pnpm[/\\](.+?)[/\\]node_modules[/\\]/);
  return m ? m[1] : target;
}

const dirs = nodeModulesDirs();
if (dirs.length === 0) {
  console.log("[check-single-test-runner] SKIP: workspace is not installed.");
  process.exit(0);
}

const problems = [];
for (const pkg of WATCHED) {
  const byInstance = new Map();
  for (const dir of dirs) {
    const link = path.join(dir, pkg);
    let stat;
    try {
      stat = fs.lstatSync(link);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;
    const instance = instanceOf(link);
    if (!byInstance.has(instance)) byInstance.set(instance, []);
    byInstance.get(instance).push(path.relative(ROOT, dir));
  }

  if (byInstance.size <= 1) {
    const only = [...byInstance.keys()][0];
    console.log(
      byInstance.size === 0
        ? `${pkg}: not linked anywhere`
        : `${pkg}: 1 instance (${only.slice(0, 60)}…)`,
    );
    continue;
  }

  problems.push(
    [
      `${pkg}: ${byInstance.size} instances linked — the peer set is split.`,
      ...[...byInstance.entries()].map(
        ([instance, consumers]) =>
          `    ${instance}\n      ← ${consumers.join(", ")}`,
      ),
    ].join("\n"),
  );
}

if (problems.length === 0) {
  console.log("[check-single-test-runner] OK: one runner instance each.");
  process.exit(0);
}

console.error("\n[check-single-test-runner] split test runner detected:\n");
for (const p of problems) console.error(`  - ${p}\n`);
console.error(
  "Compare the instance names: the segment that differs names the peer that\n" +
    "split them. Fix it by making that peer resolve to one version for every\n" +
    "importer — an `overrides` entry in pnpm-workspace.yaml for a declared\n" +
    "dependency, or a workspace-root devDependency for a peer pnpm resolves on\n" +
    "its own (see CLAUDE.md, `supports-color`). Then re-run `pnpm install`.",
);
process.exit(1);
