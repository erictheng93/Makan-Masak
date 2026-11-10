#!/usr/bin/env node
/**
 * `pnpm rollback:check <admin|kitchen> <deployment-id>` -- run BEFORE clicking
 * "Rollback" on a Cloudflare Pages deployment. Wrangler has no Pages rollback
 * command, so the dashboard cannot be gated; this check is the gate the
 * runbook requires.
 *
 * Each app's rollback-floor.json names the oldest commit whose build is safe
 * against current production data (see its `reason`). A deployment passes when
 * its id is listed there or its source commit has the floor as an ancestor.
 * Same decision as the API guard (scripts/api-rollback.cjs).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { decideRollback } = require("./api-rollback.cjs");

const ROOT = path.resolve(__dirname, "..");
const APPS = { admin: "admin-dashboard", kitchen: "kitchen-display" };

function main() {
  const [appKey, deploymentId, ...rest] = process.argv.slice(2);
  const appDir = APPS[appKey];
  if (!appDir || !deploymentId || rest.length > 0) {
    console.error("Usage: pnpm rollback:check <admin|kitchen> <deployment-id>");
    process.exit(2);
  }
  const cwd = path.join(ROOT, "apps", appDir);
  const floor = JSON.parse(
    fs.readFileSync(path.join(cwd, "rollback-floor.json"), "utf8"),
  );
  const list = JSON.parse(
    execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "pages",
        "deployment",
        "list",
        "--project-name",
        floor.project,
        "--environment",
        "production",
        "--json",
      ],
      { cwd, encoding: "utf8", shell: process.platform === "win32" },
    ),
  );
  const deployment = list.find((d) => d.Id === deploymentId);
  if (!deployment) {
    console.error(
      `✗ ${deploymentId} is not among the recent production deployments of ${floor.project}.`,
    );
    process.exit(1);
  }

  const isAncestor = (ancestor, commit) =>
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, commit], {
      cwd: ROOT,
    }).status === 0;
  const decision = decideRollback({
    floor: { commit: floor.commit, versions: floor.deployments },
    versionId: deploymentId,
    tag: deployment.Source,
    isAncestor,
  });

  if (!decision.allowed) {
    console.error(
      `✗ Do NOT roll ${floor.project} back to ${deploymentId}: ${decision.reason}.`,
    );
    console.error(`\n${floor.reason}\n`);
    console.error(
      "Roll forward with a fix, or pick a deployment at or after the floor.",
    );
    process.exit(1);
  }
  console.log(
    `✓ ${deploymentId}: ${decision.reason}. Safe to roll back in the dashboard:`,
  );
  console.log(`  ${deployment.Build}`);
}

if (require.main === module) main();
