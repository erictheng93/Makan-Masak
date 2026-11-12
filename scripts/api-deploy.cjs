#!/usr/bin/env node
/**
 * `pnpm run deploy:prod` in apps/api.
 *
 * Refuses to deploy while anything the API bundle is built from has
 * uncommitted or untracked changes. `wrangler deploy` bundles the working
 * tree, and other tools (Codex) edit the main checkout live, so a deploy from a
 * dirty tree would ship changes nobody committed or reviewed. Deploy from a
 * clean checkout or a dedicated worktree (scripts/session-worktree.sh).
 * `--allow-dirty` overrides, and such a version is tagged `<sha>-dirty`, which
 * the rollback guard (scripts/api-rollback.cjs) will not roll back to.
 *
 * Otherwise the version is tagged with its commit so the rollback guard can
 * check it against apps/api/rollback-floor.json.
 *
 * Despite the name it serves every production Worker (api, management-api,
 * realtime, image-processor, backup-scheduler): the app is the cwd's
 * `apps/<name>`, so each version carries the commit in its message and
 * `pnpm deploy:status` can read it back. The tag only matters to api's
 * rollback guard.
 *
 * A script rather than `--tag "$(git ...)"` in package.json because pnpm runs
 * scripts through cmd on Windows.
 */

const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const cwdApp = path.relative(ROOT, process.cwd()).split(path.sep).join("/");
const APP = /^apps\/[^/]+$/.test(cwdApp) ? cwdApp : "apps/api";
/** Everything `wrangler deploy` in the app bundles or resolves from. */
const BUILD_INPUTS = [APP, "packages", "package.json", "pnpm-lock.yaml"];
/** Workers whose deploy should be followed by the production smoke check. */
const SMOKE_APPS = new Set(["apps/api", "apps/realtime"]);

/**
 * Paths with uncommitted or untracked changes among the build inputs, parsed
 * from `git status --porcelain` output. Exported for tests.
 * @param {string} porcelain
 * @returns {string[]}
 */
function dirtyBuildInputs(porcelain) {
  return porcelain
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => line.slice(3).split(" -> ").pop());
}

function main() {
  // The environment is spelled out by the caller (`deploy:prod` passes
  // `--env production`, which tests/unit/package-test-scripts.test.ts
  // checks), so this script never publishes a config nobody named.
  const envIndex = process.argv.indexOf("--env");
  const env = envIndex === -1 ? undefined : process.argv[envIndex + 1];
  if (env !== "production") {
    console.error(
      "Usage: node scripts/api-deploy.cjs --env production [--allow-dirty]",
    );
    process.exit(2);
  }
  const allowDirty = process.argv.includes("--allow-dirty");

  const git = (...args) =>
    execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

  const dirty = dirtyBuildInputs(
    execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all", "--", ...BUILD_INPUTS],
      { cwd: ROOT, encoding: "utf8" },
    ),
  );
  if (dirty.length > 0 && !allowDirty) {
    console.error(
      `✗ Refusing to deploy ${APP}: these build inputs have uncommitted or untracked changes, and wrangler would ship them:`,
    );
    for (const file of dirty.slice(0, 20)) console.error(`    ${file}`);
    if (dirty.length > 20) console.error(`    … and ${dirty.length - 20} more`);
    console.error(
      "\nCommit them, or deploy from a clean worktree (scripts/session-worktree.sh). --allow-dirty overrides; that version cannot be rolled back to.",
    );
    process.exit(1);
  }

  const sha = git("rev-parse", "--short=12", "HEAD");
  const tag = dirty.length > 0 ? `${sha}-dirty` : sha;
  const subject = git("log", "-1", "--format=%s").slice(0, 80);
  if (dirty.length > 0) {
    console.warn(
      `⚠️  --allow-dirty: deploying uncommitted changes as ${tag}. A rollback to it will be refused unless its id is added to apps/api/rollback-floor.json.`,
    );
  }

  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "deploy",
      "--env",
      env,
      "--tag",
      tag,
      "--message",
      `${tag} ${subject}`,
    ],
    { stdio: "inherit", shell: process.platform === "win32" },
  );
  if (result.status === 0 && SMOKE_APPS.has(APP)) {
    console.log("\n→ Now run: pnpm smoke:order-flow");
  }
  process.exit(result.status ?? 1);
}

if (require.main === module) main();

module.exports = { dirtyBuildInputs, BUILD_INPUTS };
