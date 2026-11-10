#!/usr/bin/env node
/**
 * `pnpm rollback:api <version-id> [--yes]` -- the only supported way to roll the
 * production API Worker back.
 *
 * A plain `wrangler rollback` will happily restore a version that predates a
 * data change it cannot read correctly. After migration 0042 that is real:
 * pre-0042 API code finds staff by username alone and keys the login lockout on
 * the username, so with two shops sharing a username it logs the wrong account
 * in or locks one shop's staff out for another's mistakes.
 *
 * apps/api/rollback-floor.json records the oldest commit whose API is safe
 * against the current data. A target is allowed when its id is listed there, or
 * when it was deployed through scripts/api-deploy.cjs with a clean commit tag
 * that has the floor commit as an ancestor. Everything else is refused.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "apps", "api");
const FLOOR_FILE = path.join(API_DIR, "rollback-floor.json");

/**
 * Pure decision, exported for tests.
 * @param {{ floor: { commit: string, versions?: string[] }, versionId: string,
 *   tag: string | undefined, isAncestor: (floor: string, commit: string) => boolean }} input
 * @returns {{ allowed: boolean, reason: string }}
 */
function decideRollback({ floor, versionId, tag, isAncestor }) {
  if ((floor.versions ?? []).includes(versionId)) {
    return { allowed: true, reason: "listed in rollback-floor.json" };
  }
  if (!tag) {
    return {
      allowed: false,
      reason:
        "this version carries no commit tag (deployed before scripts/api-deploy.cjs), so it cannot be shown to be at or after the rollback floor",
    };
  }
  if (!/^[0-9a-f]{7,40}$/.test(tag)) {
    return {
      allowed: false,
      reason: `tag "${tag}" is not a clean commit (dirty or hand-made deploy)`,
    };
  }
  if (!isAncestor(floor.commit, tag)) {
    return {
      allowed: false,
      reason: `commit ${tag} is older than the rollback floor ${floor.commit.slice(0, 12)}`,
    };
  }
  return { allowed: true, reason: `commit ${tag} is at or after the floor` };
}

function main() {
  const args = process.argv.slice(2);
  const versionId = args.find((a) => !a.startsWith("-"));
  const yes = args.includes("--yes");
  const dryRun = args.includes("--dry-run");
  // An unknown flag must stop the run: a mistyped "check only" option once
  // fell through to a real production rollback.
  const unknown = args.filter(
    (a) => a.startsWith("-") && !["--yes", "--dry-run"].includes(a),
  );
  if (!versionId || unknown.length > 0) {
    if (unknown.length > 0)
      console.error(`Unknown option: ${unknown.join(" ")}`);
    console.error("Usage: pnpm rollback:api <version-id> [--dry-run] [--yes]");
    process.exit(2);
  }

  const floor = JSON.parse(fs.readFileSync(FLOOR_FILE, "utf8"));
  const view = execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "versions",
      "view",
      versionId,
      "--env",
      "production",
      "--json",
    ],
    { cwd: API_DIR, encoding: "utf8", shell: process.platform === "win32" },
  );
  const tag = JSON.parse(view)?.annotations?.["workers/tag"];

  const isAncestor = (ancestor, commit) =>
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, commit], {
      cwd: ROOT,
    }).status === 0;

  const decision = decideRollback({ floor, versionId, tag, isAncestor });
  if (!decision.allowed) {
    console.error(
      `✗ Refusing to roll the API back to ${versionId}: ${decision.reason}.`,
    );
    console.error(`\n${floor.reason}\n`);
    console.error(
      "Roll forward with a fix instead, or pick a version at or after the floor (`wrangler versions list --env production`).",
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log(
      `✓ ${versionId}: ${decision.reason}. Dry run, nothing rolled back.`,
    );
    process.exit(0);
  }
  console.log(`✓ ${versionId}: ${decision.reason}. Rolling back…`);
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "rollback",
      versionId,
      "--env",
      "production",
      "--message",
      `rollback to ${tag ?? versionId}`,
      ...(yes ? ["--yes"] : []),
    ],
    { cwd: API_DIR, stdio: "inherit", shell: process.platform === "win32" },
  );
  process.exit(result.status ?? 1);
}

if (require.main === module) main();

module.exports = { decideRollback };
