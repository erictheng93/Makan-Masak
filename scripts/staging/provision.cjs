#!/usr/bin/env node
/**
 * Provisions the isolated STAGING copy of the stack in the production
 * Cloudflare account. See docs/runbooks/staging.md.
 *
 *   node scripts/staging/provision.cjs                       dry run (default): prints the commands, touches nothing
 *   node scripts/staging/provision.cjs --apply --workers-subdomain <name>
 *   node scripts/staging/provision.cjs --apply --secrets     also `wrangler secret put` the generated secrets
 *   node scripts/staging/provision.cjs --apply --skip-migrations
 *
 * Safe to re-run: existing resources are reused, placeholders already
 * substituted are left alone, applied migrations are skipped by wrangler.
 *
 * Safety rule, enforced in assertSafeCommand() for every command it runs: no
 * resource whose name does not end in -staging is ever created or written to,
 * and `--env` may only be `staging`. This file deliberately has no delete
 * command of any kind; teardown is a manual, interactive step.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  ROOT,
  SUBDOMAIN_TOKEN,
  WORKER_SECRETS,
  assertStagingName,
  substitutePlaceholders,
  findPlaceholders,
  loadOrCreateSecrets,
} = require("./common.cjs");

const RESOURCES = {
  d1: [
    { name: "makanmasak-staging", placeholder: "STAGING_D1_PLATFORM_ID" },
    {
      name: "makanmasak-management-staging",
      placeholder: "STAGING_D1_MANAGEMENT_ID",
    },
  ],
  kv: [
    { name: "makanmasak-cache-staging", placeholder: "STAGING_KV_CACHE_ID" },
    {
      name: "makanmasak-ratelimit-staging",
      placeholder: "STAGING_KV_RATELIMIT_ID",
    },
    { name: "makanmasak-backup-staging", placeholder: "STAGING_KV_BACKUP_ID" },
    {
      name: "makanmasak-tokenblacklist-staging",
      placeholder: "STAGING_KV_TOKEN_BLACKLIST_ID",
    },
    {
      name: "makanmasak-deployment-status-staging",
      placeholder: "STAGING_KV_DEPLOYMENT_STATUS_ID",
    },
    {
      name: "makanmasak-image-cache-staging",
      placeholder: "STAGING_KV_IMAGE_CACHE_ID",
    },
  ],
  r2: [
    "makanmasak-backups-staging",
    "makanmasak-images-staging",
    "makanmasak-management-bundles-staging",
  ],
  queues: [
    "makanmasak-search-sync-staging",
    "makanmasak-search-sync-dlq-staging",
  ],
  // bge-m3 embeddings: 1024 dimensions, cosine (matches the production index).
  vectorize: [{ name: "makanmasak-discovery-staging", dimensions: 1024 }],
  pages: [
    "makanmasak-customer-staging",
    "makanmasak-admin-staging",
    "makanmasak-kitchen-staging",
  ],
};

const CONFIG_FILES = [
  "apps/api/wrangler.toml",
  "apps/realtime/wrangler.toml",
  "apps/management-api/wrangler.toml",
  "apps/image-processor/wrangler.toml",
  "apps/customer-app/.env.staging",
  "apps/admin-dashboard/.env.staging",
  "apps/kitchen-display/.env.staging",
];

const READ_ONLY = [
  ["whoami"],
  ["d1", "list"],
  ["kv", "namespace", "list"],
  ["r2", "bucket", "list"],
  ["queues", "list"],
  ["vectorize", "list"],
  ["pages", "project", "list"],
];

const startsWith = (argv, prefix) => prefix.every((p, i) => argv[i] === p);

// The resource a create/migrate command acts on, or undefined if unrecognised.
function resourceTarget(argv) {
  const two = argv.slice(0, 2).join(" ");
  const three = argv.slice(0, 3).join(" ");
  if (two === "d1 create") return argv[2];
  if (three === "d1 migrations apply") return argv[3];
  if (three === "kv namespace create") return argv[3];
  if (three === "r2 bucket create") return argv[3];
  if (two === "queues create") return argv[2];
  if (two === "vectorize create") return argv[2];
  if (three === "pages project create") return argv[3];
  return undefined;
}

/** Throws unless `argv` (wrangler arguments) is read-only or targets a *-staging resource. */
function assertSafeCommand(argv) {
  if (argv.some((a) => /(^|=)production$/.test(a))) {
    throw new Error(`refusing a production-scoped command: ${argv.join(" ")}`);
  }
  const envAt = argv.indexOf("--env");
  if (envAt !== -1 && argv[envAt + 1] !== "staging") {
    throw new Error(
      `refusing --env ${argv[envAt + 1]}: only staging is allowed`,
    );
  }
  if (READ_ONLY.some((p) => startsWith(argv, p))) return argv;

  if (argv[0] === "secret") {
    // `secret put NAME --env staging --config apps/<x>/wrangler.toml`
    if (argv[1] !== "put" || envAt === -1) {
      throw new Error(`refusing unscoped secret command: ${argv.join(" ")}`);
    }
    return argv;
  }
  const target = resourceTarget(argv);
  if (target === undefined) {
    throw new Error(
      `refusing unrecognised wrangler command: ${argv.join(" ")}`,
    );
  }
  assertStagingName(target);
  if (argv[0] === "d1" && argv[1] === "migrations" && envAt === -1) {
    throw new Error("d1 migrations apply must carry --env staging");
  }
  return argv;
}

/** The commands --apply would run, in order. Pure; used for the dry run and the tests. */
function planCommands({ skipMigrations = false } = {}) {
  const cmds = [];
  for (const d of RESOURCES.d1) cmds.push(["d1", "create", d.name]);
  for (const k of RESOURCES.kv)
    cmds.push(["kv", "namespace", "create", k.name]);
  for (const b of RESOURCES.r2) cmds.push(["r2", "bucket", "create", b]);
  for (const q of RESOURCES.queues) cmds.push(["queues", "create", q]);
  for (const v of RESOURCES.vectorize) {
    cmds.push([
      "vectorize",
      "create",
      v.name,
      `--dimensions=${v.dimensions}`,
      "--metric=cosine",
    ]);
  }
  for (const p of RESOURCES.pages) {
    cmds.push(["pages", "project", "create", p, "--production-branch=main"]);
  }
  if (!skipMigrations) {
    cmds.push([
      "d1",
      "migrations",
      "apply",
      "makanmasak-staging",
      "--remote",
      "--env",
      "staging",
      "--config",
      "apps/api/wrangler.toml",
    ]);
    cmds.push([
      "d1",
      "migrations",
      "apply",
      "makanmasak-management-staging",
      "--remote",
      "--env",
      "staging",
      "--config",
      "apps/management-api/wrangler.toml",
    ]);
  }
  for (const c of cmds) assertSafeCommand(c);
  return cmds;
}

function wrangler(argv, { input } = {}) {
  assertSafeCommand(argv);
  const run = spawnSync("pnpm", ["exec", "wrangler", ...argv], {
    cwd: ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    shell: process.platform === "win32",
  });
  return {
    status: run.status ?? 1,
    out: `${run.stdout ?? ""}${run.stderr ?? ""}`,
  };
}

const ALREADY =
  /already[ _]exists?|already (taken|in use)|name is already|\b(10004|10014|11009|7502|800000\d)\b/i;

function listJson(argv) {
  const r = wrangler(argv);
  const start = r.out.indexOf("[");
  const end = r.out.lastIndexOf("]");
  if (r.status !== 0 || start === -1) {
    throw new Error(`could not list resources (${argv.join(" ")}):\n${r.out}`);
  }
  return JSON.parse(r.out.slice(start, end + 1));
}

function ensure(argv) {
  const r = wrangler(argv);
  if (r.status === 0) {
    console.log(`  created: ${argv.slice(0, 4).join(" ")}`);
  } else if (ALREADY.test(r.out)) {
    console.log(`  exists:  ${argv.slice(0, 4).join(" ")}`);
  } else {
    throw new Error(`${argv.join(" ")} failed:\n${r.out}`);
  }
}

function resolveIds() {
  const map = {};
  const d1 = listJson(["d1", "list", "--json"]);
  for (const r of RESOURCES.d1) {
    const hit = d1.find((x) => x.name === r.name);
    if (!hit) throw new Error(`D1 database ${r.name} not found after create`);
    map[r.placeholder] = hit.uuid || hit.id;
  }
  const kv = listJson(["kv", "namespace", "list"]);
  for (const r of RESOURCES.kv) {
    const hit = kv.find((x) => x.title === r.name);
    if (!hit) throw new Error(`KV namespace ${r.name} not found after create`);
    map[r.placeholder] = hit.id;
  }
  return map;
}

function applySubstitutions(map) {
  for (const rel of CONFIG_FILES) {
    const file = path.join(ROOT, rel);
    const before = fs.readFileSync(file, "utf8");
    const after = substitutePlaceholders(before, map);
    if (after !== before) {
      fs.writeFileSync(file, after);
      console.log(`  updated: ${rel}`);
    }
  }
}

function parseArgs(argv) {
  const args = { apply: false, secrets: false, skipMigrations: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--secrets") args.secrets = true;
    else if (a === "--skip-migrations") args.skipMigrations = true;
    else if (a === "--workers-subdomain") args.subdomain = argv[++i];
    else if (a.startsWith("--workers-subdomain="))
      args.subdomain = a.split("=")[1];
    else throw new Error(`unknown argument: ${a}`);
  }
  args.subdomain = args.subdomain || process.env.STAGING_WORKERS_SUBDOMAIN;
  if (args.subdomain && !/^[a-z0-9][a-z0-9-]*$/.test(args.subdomain)) {
    throw new Error(`invalid workers.dev subdomain: ${args.subdomain}`);
  }
  return args;
}

function printRemainingSecrets() {
  console.log(
    "\nSecrets (names only; values live in .wrangler/staging-secrets.json):",
  );
  for (const [app, names] of Object.entries(WORKER_SECRETS)) {
    for (const name of names) {
      console.log(
        `  pnpm exec wrangler secret put ${name} --env staging --config apps/${app}/wrangler.toml`,
      );
    }
  }
  console.log(
    "  or let this script do it from the generated values: node scripts/staging/provision.cjs --apply --secrets",
  );
  console.log(
    "\nOptional, need REAL third-party values (not needed for the cash order -> kitchen -> POS flow):",
  );
  console.log(
    "  SMS vendor (MITAKE_* | EVERY8D_* | TWILIO_*), STRIPE_*, LINEPAY_WEBHOOK_SECRET, MARKET_CHECKOUT_*,",
  );
  console.log(
    "  WEB_PUSH_VAPID_*, CLOUDFLARE_API_TOKEN (analytics reads), CF_API_TOKEN/CF_ACCOUNT_ID (management provisioning)",
  );
}

function putSecrets(secrets) {
  for (const [app, names] of Object.entries(WORKER_SECRETS)) {
    for (const name of names) {
      const r = wrangler(
        [
          "secret",
          "put",
          name,
          "--env",
          "staging",
          "--config",
          `apps/${app}/wrangler.toml`,
        ],
        { input: `${secrets[name]}\n` },
      );
      if (r.status !== 0) {
        throw new Error(`secret put ${name} (${app}) failed:\n${r.out}`);
      }
      console.log(`  set: ${app} ${name}`);
    }
  }
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmds = planCommands({ skipMigrations: args.skipMigrations });

  if (!args.apply) {
    console.log(
      "DRY RUN (default). Nothing below was executed. Pass --apply to run it.\n",
    );
    for (const c of cmds) console.log(`pnpm exec wrangler ${c.join(" ")}`);
    console.log(
      `\nThen: substitute the created ids and ${SUBDOMAIN_TOKEN}=${args.subdomain || "<--workers-subdomain>"} into:\n  ${CONFIG_FILES.join("\n  ")}`,
    );
    console.log(
      "Create-commands are skipped for resources that already exist.",
    );
    printRemainingSecrets();
    return;
  }

  console.log("Provisioning staging resources...");
  wrangler(["whoami"]);
  const migrations = cmds.filter((c) => c[0] === "d1" && c[1] === "migrations");
  for (const c of cmds) {
    if (c[0] === "d1" && c[1] === "migrations") continue;
    // d1 / kv are checked by listing first so a re-run prints "exists".
    ensure(c);
  }

  const map = resolveIds();
  if (args.subdomain) map[SUBDOMAIN_TOKEN] = args.subdomain;
  else
    console.warn(
      `\nNo --workers-subdomain given: ${SUBDOMAIN_TOKEN} left in place. Re-run with --workers-subdomain <name> before deploying.`,
    );
  applySubstitutions(map);

  const secrets = loadOrCreateSecrets();
  for (const c of migrations) {
    console.log(`\n${c.slice(0, 5).join(" ")}`);
    const r = wrangler(c);
    process.stdout.write(r.out);
    if (r.status !== 0) throw new Error("migration failed");
  }

  if (args.secrets) putSecrets(secrets);
  else printRemainingSecrets();

  const left = CONFIG_FILES.flatMap((rel) =>
    findPlaceholders(fs.readFileSync(path.join(ROOT, rel), "utf8")).map(
      (p) => `${rel}: ${p}`,
    ),
  );
  if (left.length > 0)
    console.log(`\nStill unresolved:\n  ${left.join("\n  ")}`);
  console.log(
    "\nNext: deploy (docs/runbooks/staging.md), then node scripts/staging/seed.cjs --apply",
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[staging] ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  RESOURCES,
  CONFIG_FILES,
  assertSafeCommand,
  planCommands,
  parseArgs,
};
