#!/usr/bin/env node
/**
 * `deploy:prod` of a Pages app (cwd is the app directory).
 *
 *   node ../../scripts/pages-deploy.cjs --project <pages-project> [--build-only] [--allow-dirty]
 *
 * 1. refuses a dirty tree for the app's build inputs (require-clean-build.cjs);
 * 2. builds the app AND its workspace dependencies with turbo from the repo
 *    root, so a fresh worktree does not fail at vue-tsc with "Cannot find
 *    module '@makanmasak/...'" (the app's own `build` script assumes the
 *    packages were already built);
 * 3. uploads dist/ with the commit attached, which `pnpm deploy:status` reads.
 *
 * `--build-only` stops after step 2 (the proof that a fresh worktree builds).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
/** Apps whose deploy should be followed by the production smoke check. */
const SMOKE_APPS = new Set([
  "makanmasak-customer-app",
  "makanmasak-admin-dashboard",
  "makanmasak-kitchen-display",
]);

const sh = process.platform === "win32";
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: sh, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--project");
  const project = i === -1 ? undefined : argv[i + 1];
  if (!project) {
    console.error(
      "Usage: node ../../scripts/pages-deploy.cjs --project <name> [--build-only] [--allow-dirty]",
    );
    process.exit(2);
  }
  const allowDirty = argv.includes("--allow-dirty");
  const pkgName = JSON.parse(fs.readFileSync("package.json", "utf8")).name;

  run("node", [
    path.join(__dirname, "require-clean-build.cjs"),
    ...argv.filter((a) => a === "--allow-dirty"),
  ]);
  run("pnpm", ["exec", "turbo", "run", "build", `--filter=${pkgName}...`], {
    cwd: ROOT,
  });
  if (argv.includes("--build-only")) return;

  const git = (...a) =>
    execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
  const sha = git("rev-parse", "--short=12", "HEAD");
  const subject = git("log", "-1", "--format=%s").slice(0, 100);
  run("pnpm", [
    "exec",
    "wrangler",
    "pages",
    "deploy",
    "dist",
    `--project-name=${project}`,
    "--branch=main",
    `--commit-hash=${sha}`,
    `--commit-message=${subject}`,
    ...(allowDirty ? ["--commit-dirty=true"] : []),
  ]);
  if (SMOKE_APPS.has(pkgName))
    console.log("\n→ Now run: pnpm smoke:order-flow");
}

main();
