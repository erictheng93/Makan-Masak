#!/usr/bin/env node
/**
 * `pnpm run deploy:prod` in apps/api.
 *
 * Tags the Worker version with the git commit it was built from, so
 * scripts/api-rollback.cjs can refuse a rollback below the floor recorded in
 * apps/api/rollback-floor.json. A deploy from uncommitted changes is tagged
 * `<sha>-dirty`: the rollback guard treats that as "unknown code" and only
 * accepts it if its version id is listed explicitly.
 *
 * A script rather than `--tag "$(git ...)"` in package.json because pnpm runs
 * scripts through cmd on Windows.
 */

const { execFileSync, spawnSync } = require("child_process");

// The environment is spelled out by the caller (`deploy:prod` passes
// `--env production`, which tests/unit/package-test-scripts.test.ts checks), so
// this script never publishes a config nobody named.
const envIndex = process.argv.indexOf("--env");
const env = envIndex === -1 ? undefined : process.argv[envIndex + 1];
if (env !== "production") {
  console.error("Usage: node scripts/api-deploy.cjs --env production");
  process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

const sha = git("rev-parse", "--short=12", "HEAD");
const dirty = git("status", "--porcelain", "--untracked-files=no") !== "";
const tag = dirty ? `${sha}-dirty` : sha;
const subject = git("log", "-1", "--format=%s").slice(0, 80);

if (dirty) {
  console.warn(
    `⚠️  Uncommitted changes: tagging this version ${tag}. A rollback to it will be refused unless its id is added to apps/api/rollback-floor.json.`,
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

process.exit(result.status ?? 1);
