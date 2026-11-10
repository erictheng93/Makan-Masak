#!/usr/bin/env node
/**
 * Run first in a Pages app's `deploy:prod` (cwd is the app directory).
 *
 * `wrangler pages deploy` ships whatever the build produced from the working
 * tree, and Codex edits the main checkout live, so a production deploy from a
 * dirty tree can carry uncommitted, unreviewed changes. Same rule as
 * scripts/api-deploy.cjs: refuse while the app or anything it builds from has
 * modified or untracked files. `--allow-dirty` overrides.
 */
const path = require("path");
const { execFileSync } = require("child_process");
const { dirtyBuildInputs } = require("./api-deploy.cjs");

const ROOT = path.resolve(__dirname, "..");
const app = path.relative(ROOT, process.cwd()).split(path.sep).join("/");
if (!app.startsWith("apps/")) {
  console.error(
    `require-clean-build: run from an app directory (got ${app || "."})`,
  );
  process.exit(2);
}
const inputs = [app, "packages", "package.json", "pnpm-lock.yaml"];
const dirty = dirtyBuildInputs(
  execFileSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all", "--", ...inputs],
    { cwd: ROOT, encoding: "utf8" },
  ),
);

if (dirty.length > 0 && !process.argv.includes("--allow-dirty")) {
  console.error(
    `✗ Refusing to deploy ${app}: these build inputs have uncommitted or untracked changes, and the build would ship them:`,
  );
  for (const file of dirty.slice(0, 20)) console.error(`    ${file}`);
  if (dirty.length > 20) console.error(`    … and ${dirty.length - 20} more`);
  console.error(
    "\nCommit them, or deploy from a clean worktree (scripts/session-worktree.sh).",
  );
  process.exit(1);
}
