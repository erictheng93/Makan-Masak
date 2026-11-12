#!/usr/bin/env node
/**
 * `pnpm deploy:status` -- which commit is each production service running, and
 * how far behind origin/main is it? Read-only: lists deployments, deploys
 * nothing. Needs wrangler to be authenticated.
 *
 * Workers carry `<sha> <subject>` in the deployment message and Pages carries
 * the commit as `Source`, both set by the deploy:prod scripts. Deployments made
 * before that have no commit and show as "unknown".
 */
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const run = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const SHARED = ["packages", "package.json", "pnpm-lock.yaml"];

const WORKERS = [
  "api",
  "management-api",
  "realtime",
  "image-processor",
  "backup-scheduler",
];
const PAGES = {
  "customer-app": "makanmasak-customer",
  "admin-dashboard": "makanmasak-admin",
  "kitchen-display": "makanmasak-kitchen",
  "management-portal": "makanmasak-management",
  "onboarding-app": "makanmasak-onboarding",
};

const COMMIT_RE = /^[0-9a-f]{7,40}$/;

/** Newest Worker deployment from `wrangler deployments list --json`. */
function parseWorkerDeployment(list) {
  const latest = [...list].sort((a, b) =>
    a.created_on < b.created_on ? 1 : -1,
  )[0];
  if (!latest) return { commit: null, at: null };
  const first = (latest.annotations?.["workers/message"] ?? "").split(" ")[0];
  const m = /^([0-9a-f]{7,40})(-dirty)?$/.exec(first);
  return { commit: m ? m[1] : null, dirty: !!m?.[2], at: latest.created_on };
}

/** Newest production deployment from `wrangler pages deployment list --json` (newest first). */
function parsePagesDeployment(list) {
  const latest = list.find((d) => d.Environment === "Production");
  if (!latest) return { commit: null, at: null };
  return {
    commit: COMMIT_RE.test(latest.Source ?? "") ? latest.Source : null,
    at: latest.Status ?? null, // Pages only reports a relative age ("2 hours ago")
  };
}

/** Number of lines of `git log --oneline` output. */
function behindCount(logOutput) {
  return logOutput.split("\n").filter((l) => l.trim() !== "").length;
}

const git = (...a) => run("git", a, { cwd: ROOT }).then((r) => r.stdout);
const wrangler = async (dir, args) => {
  try {
    const { stdout } = await run(
      "pnpm",
      ["exec", "wrangler", ...args, "--json"],
      {
        cwd: path.join(ROOT, "apps", dir),
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout.slice(stdout.indexOf("[")));
  } catch (e) {
    const msg = `${e.stderr ?? ""}${e.stdout ?? ""}${e.message}`;
    const line =
      msg.split("\n").find((l) => /auth|login|token|credential/i.test(l)) ??
      msg.split("\n").find((l) => l.trim());
    throw new Error(line.trim());
  }
};

async function row(dir, kind) {
  const dep =
    kind === "worker"
      ? parseWorkerDeployment(
          await wrangler(dir, ["deployments", "list", "--env", "production"]),
        )
      : parsePagesDeployment(
          await wrangler(dir, [
            "pages",
            "deployment",
            "list",
            `--project-name=${PAGES[dir]}`,
            "--environment",
            "production",
          ]),
        );
  let behind = "?";
  if (dep.commit) {
    try {
      behind = String(
        behindCount(
          await git(
            "log",
            "--oneline",
            `${dep.commit}..origin/main`,
            "--",
            `apps/${dir}`,
            ...SHARED,
          ),
        ),
      );
    } catch {
      /* commit not in this clone: leave "?" */
    }
  }
  return {
    service: dir,
    commit: dep.commit
      ? dep.commit.slice(0, 9) + (dep.dirty ? "-dirty" : "")
      : "unknown",
    at: dep.at ?? "-",
    behind,
  };
}

async function main() {
  const json = process.argv.includes("--json");
  await git("fetch", "--quiet", "origin", "main").catch(() =>
    console.error(
      "warning: git fetch failed, comparing against a stale origin/main",
    ),
  );
  const jobs = [
    ...WORKERS.map((d) => [d, "worker"]),
    ...Object.keys(PAGES).map((d) => [d, "pages"]),
  ];
  const rows = await Promise.all(
    jobs.map(([d, k]) =>
      row(d, k).catch((e) => ({ service: d, error: e.message })),
    ),
  );
  const failed = rows.filter((r) => r.error);
  if (json) console.log(JSON.stringify(rows, null, 2));
  else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      `${pad("SERVICE", 18)}${pad("COMMIT", 16)}${pad("DEPLOYED", 32)}BEHIND origin/main`,
    );
    for (const r of rows) {
      if (r.error) console.log(`${pad(r.service, 18)}error: ${r.error}`);
      else
        console.log(
          `${pad(r.service, 18)}${pad(r.commit, 16)}${pad(r.at, 32)}${r.behind}${r.commit === "unknown" ? "  (deployed before commits were recorded; redeploy to fix)" : ""}`,
        );
    }
  }
  if (failed.length) {
    console.error(
      `\n${failed.length} service(s) could not be read. If wrangler is not logged in: pnpm wrangler login`,
    );
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { parseWorkerDeployment, parsePagesDeployment, behindCount };
