#!/usr/bin/env node
// Blocks production deploys while production Cloudflare resources or runtime
// URLs are missing or still point at local development targets.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ROOT = path.resolve(__dirname, "..");
const PLACEHOLDER = "REPLACE_ME__PRODUCTION__";
const BINDING_TABLES = new Map([
  ["d1_databases", "binding"],
  ["kv_namespaces", "binding"],
  ["r2_buckets", "binding"],
  ["analytics_engine_datasets", "binding"],
  ["durable_objects.bindings", "name"],
  ["send_email", "name"],
]);

const REQUIRED_PRODUCTION_RUNTIME_VARS = new Map([
  ["apps/api/wrangler.toml", ["API_BASE_URL", "CORS_ORIGIN"]],
  ["apps/image-processor/wrangler.toml", ["CORS_ORIGIN", "IMAGE_API_BASE_URL"]],
  ["apps/management-portal/wrangler.toml", ["VITE_MANAGEMENT_API_URL"]],
  [
    "apps/onboarding-app/wrangler.toml",
    ["VITE_API_URL", "VITE_CUSTOMER_APP_URL"],
  ],
]);

// Secrets that have to exist on the deployed Worker before a production deploy.
//
// The source of truth is the LIVE Cloudflare secret list
// (`wrangler secret list --env production`), not `process.env`: `wrangler deploy`
// never uploads the operator's shell environment, so a locally exported
// JWT_SECRET was never evidence that the Worker has one. That gap is why
// `makanmasak-api-prod` ran with three secrets and a green deploy for months
// while customer registration was dead in production.
//
// Shape: wrangler.toml path -> array of requirements, each one of
//   { name, level, why }
//       a single secret that must be present.
//   { anyOf: [[...names], ...], level, label, why }
//       alternatives, not additions: at least ONE of the inner groups must be
//       complete. Needed because the SMS vendors are mutually exclusive — a
//       deploy with Mitake credentials must not be nagged about Twilio.
//       `anyOf` is the minimal extension to the original `[name, ...]` form.
// level:
//   "required"    -> violation; blocks the deploy (exit 1). Core auth/signing:
//                    without it the Worker is broken for everyone.
//   "recommended" -> warning; printed loudly, exit stays 0. One feature is dead
//                    (a delivery channel, a credential store), the rest of the
//                    system still serves.
//
// The level decides block-vs-warn, NOT reported-vs-silent: printResult() prints
// every "recommended" gap in a loud WARNING block on every deploy, before the
// blocking section. So promoting a secret to "required" buys a hard stop, not
// visibility — visibility is already there. Weigh that against the cost: the
// escape hatch (CHECK_PRODUCTION_CONFIG_REQUIRE_DEPLOYMENT_SECRETS=false) is
// all-or-nothing, so every deploy blocked over a confined feature raises the
// odds someone sets it and disables the JWT_SECRET/QR_SIGNING_KEY checks too.
const REQUIRED_DEPLOYMENT_SECRETS = new Map([
  [
    "apps/api/wrangler.toml",
    [
      {
        name: "JWT_SECRET",
        level: "required",
        why: "signs and verifies every staff/customer session token",
      },
      {
        name: "QR_SIGNING_KEY",
        level: "required",
        why: "HMAC key for table/seat QR URLs; SignedQrVerificationService throws without it, so QR ordering stops",
      },
      {
        // Reachable through ai-analytics (AIAnalyticsService), platform
        // integrations (PlatformIntegrationService, whose webhook route
        // decrypts without auth), forecast provider credentials, and encrypted
        // backups.
        //
        // This entry used to carry the silent-downgrade problem: PBKDF2/SHA-256
        // over the empty string is still a valid AES-256 key, so an absent
        // secret did not fail — it stored LLM and Uber Eats credentials under a
        // key anyone could rederive. #300 closed that in the crypto helpers:
        // in production an absent key now throws instead of deriving one.
        //
        // Deliberately still "recommended" after that fix, and the reason
        // changed. It is no longer "there is no ciphertext in production yet"
        // (true when measured 2026-08-30, but a fact that expires the first
        // time someone connects an integration). It is that the failure is now
        // fail-fast and confined: the crypto-touching routes 500, every other
        // route serves. That is the same shape as an unconfigured SMS vendor —
        // one feature refuses up front and the rest of the system is untouched
        // — and it must carry the same level, or "required" stops
        // meaning "the Worker is broken for everyone".
        //
        // The missing key is still reported loudly on every production deploy;
        // see the level legend above for why that, not the block, is the part
        // doing the work here.
        name: "ENCRYPTION_KEY",
        level: "recommended",
        why: "encrypts stored third-party credentials (ai-analytics, platform integrations, forecast providers, encrypted backups); absent, those routes fail closed in production while the rest of the Worker serves",
      },
      {
        anyOf: [
          ["MITAKE_USERNAME", "MITAKE_PASSWORD"],
          ["EVERY8D_UID", "EVERY8D_PWD"],
          ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
        ],
        level: "recommended",
        label: "SMS vendor credentials",
        why: "with no complete vendor set the provider resolves to noop and phone OTP answers 503 in production; vendors are alternatives, cost order mitake -> every8d -> twilio",
      },
    ],
  ],
]);

function checkProductionConfig(options = {}) {
  const root = path.resolve(options.root || DEFAULT_ROOT);
  const env = options.env || process.env;
  const requireDeploymentSecrets =
    options.requireDeploymentSecrets ??
    env.CHECK_PRODUCTION_CONFIG_REQUIRE_DEPLOYMENT_SECRETS !== "false";
  const appsDir = path.join(root, "apps");
  const wranglerFiles = [];
  walk(appsDir, wranglerFiles);

  // Injectable so the unit tests never shell out to wrangler.
  const readDeployedSecrets =
    options.readDeployedSecrets ||
    ((relativeFile) => readDeployedProductionSecrets(root, relativeFile));

  const violations = [];
  const warnings = [];
  for (const file of wranglerFiles) {
    const relativeFile = path.relative(root, file).split(path.sep).join("/");
    const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.includes(PLACEHOLDER)) {
        violations.push({
          file: relativeFile,
          line: index + 1,
          text: line.trim(),
        });
      }
    });

    const bindings = collectBindings(lines);
    const productionBindings = bindings.production ?? new Set();
    const expectedBindings = new Set();

    for (const [envName, envBindings] of Object.entries(bindings)) {
      if (envName === "production") {
        continue;
      }

      for (const binding of envBindings) {
        expectedBindings.add(binding);
      }
    }

    for (const binding of expectedBindings) {
      if (!productionBindings.has(binding)) {
        violations.push({
          file: relativeFile,
          line: 1,
          text: `missing production binding: ${binding}`,
        });
      }
    }

    validateProductionRuntimeVars(relativeFile, lines, violations);
    validateDeploymentSecrets(
      relativeFile,
      lines,
      requireDeploymentSecrets,
      readDeployedSecrets,
      violations,
      warnings,
    );
  }

  return { violations, warnings, checkedFiles: wranglerFiles.length };
}

function walk(dir, hits) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, hits);
    } else if (entry.name === "wrangler.toml") {
      hits.push(fullPath);
    }
  }
}

function validateProductionRuntimeVars(relativeFile, lines, violations) {
  const requiredVars = REQUIRED_PRODUCTION_RUNTIME_VARS.get(relativeFile);
  if (!requiredVars) {
    return;
  }

  const productionVars = collectProductionVars(lines);
  for (const varName of requiredVars) {
    const value = productionVars.get(varName);
    if (!value) {
      violations.push({
        file: relativeFile,
        line: 1,
        text: `missing production runtime var: ${varName}`,
      });
      continue;
    }

    const invalidUrl = invalidPublicHttpsUrl(value);
    if (invalidUrl) {
      violations.push({
        file: relativeFile,
        line: 1,
        text: `invalid production runtime var ${varName}: ${invalidUrl}`,
      });
    }
  }
}

function validateDeploymentSecrets(
  relativeFile,
  lines,
  requireDeploymentSecrets,
  readDeployedSecrets,
  violations,
  warnings,
) {
  const requirements = REQUIRED_DEPLOYMENT_SECRETS.get(relativeFile);
  if (!requirements) {
    return;
  }

  // Static half: needs no network, so it runs even in the CI pipeline where
  // CHECK_PRODUCTION_CONFIG_REQUIRE_DEPLOYMENT_SECRETS=false.
  const productionVars = collectProductionVars(lines);
  for (const secretName of requirements.flatMap(secretNames)) {
    if (productionVars.has(secretName)) {
      violations.push({
        file: relativeFile,
        line: 1,
        text: `production secret must not be committed as a wrangler var: ${secretName}`,
      });
    }
  }

  if (!requireDeploymentSecrets) {
    return;
  }

  const deployed = readDeployedSecrets(relativeFile);
  if (!deployed) {
    // Never downgrade this to a skip. A silent skip when the secret list cannot
    // be read is the same green-on-nothing failure the empty requirement list
    // used to produce.
    violations.push({
      file: relativeFile,
      line: 1,
      text:
        "could not read the deployed production secret list " +
        "(`wrangler secret list --env production`) — log in with `pnpm wrangler login`, " +
        "or set CHECK_PRODUCTION_CONFIG_REQUIRE_DEPLOYMENT_SECRETS=false for a non-deploy run",
    });
    return;
  }

  for (const requirement of requirements) {
    const missing = describeMissingSecret(requirement, deployed);
    if (!missing) {
      continue;
    }

    const finding = {
      file: relativeFile,
      line: 1,
      text: `${missing} — ${requirement.why}`,
    };

    if (requirement.level === "required") {
      violations.push(finding);
    } else {
      warnings.push(finding);
    }
  }
}

function secretNames(requirement) {
  return requirement.anyOf ? requirement.anyOf.flat() : [requirement.name];
}

function describeMissingSecret(requirement, deployed) {
  if (!requirement.anyOf) {
    return deployed.has(requirement.name)
      ? null
      : `missing production secret: ${requirement.name}`;
  }

  const complete = requirement.anyOf.some((group) =>
    group.every((name) => deployed.has(name)),
  );
  if (complete) {
    return null;
  }

  const options = requirement.anyOf
    .map((group) => group.join(" + "))
    .join(" | ");
  return `no complete set of ${requirement.label} on the deployed Worker; need one of: ${options}`;
}

// Reads the names (never the values — the API does not expose them) of the
// secrets actually bound to the production Worker. Read-only.
function readDeployedProductionSecrets(root, relativeFile) {
  const appDir = path.dirname(path.join(root, relativeFile));
  const wrangler = resolveWranglerBin(root, appDir);
  if (!wrangler) {
    return null;
  }

  const run = spawnSync(wrangler, ["secret", "list", "--env", "production"], {
    cwd: appDir,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  });

  if (run.error || run.status !== 0 || typeof run.stdout !== "string") {
    return null;
  }

  // wrangler prefixes the JSON array with a banner, so slice to the brackets.
  const start = run.stdout.indexOf("[");
  const end = run.stdout.lastIndexOf("]");
  if (start === -1 || end < start) {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(run.stdout.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  return new Set(
    parsed
      .map((entry) => (typeof entry === "string" ? entry : entry?.name))
      .filter(Boolean),
  );
}

function resolveWranglerBin(root, appDir) {
  const binName = process.platform === "win32" ? "wrangler.CMD" : "wrangler";
  const candidates = [
    path.join(appDir, "node_modules", ".bin", binName),
    path.join(root, "node_modules", ".bin", binName),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function invalidPublicHttpsUrl(value) {
  const urls = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return "empty value";
  }

  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return `${url} is not a valid URL`;
    }

    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") {
      return `${url} must use https`;
    }
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return `${url} is a local development URL`;
    }
  }

  return null;
}

function collectProductionVars(lines) {
  const vars = new Map();
  let section = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      continue;
    }

    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTable) {
      section = arrayTable[1];
      continue;
    }

    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      section = table[1];
      continue;
    }

    if (section === "env.production.vars") {
      const match = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/);
      if (match) {
        vars.set(match[1], match[2]);
      }
    }
  }

  return vars;
}

function collectBindings(lines) {
  const envBindings = {};
  let sectionEnv = "default";
  let currentBinding = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      continue;
    }

    const arrayTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrayTable) {
      const parsed = parseSection(arrayTable[1]);
      sectionEnv = parsed.env;
      currentBinding = parsed.bindingType;
      ensureEnv(envBindings, sectionEnv);
      continue;
    }

    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      const parsed = parseSection(table[1]);
      sectionEnv = parsed.env;
      currentBinding = parsed.bindingType;
      ensureEnv(envBindings, sectionEnv);
      continue;
    }

    if (currentBinding && BINDING_TABLES.has(currentBinding)) {
      const key = BINDING_TABLES.get(currentBinding);
      const value = readStringAssignment(line, key);
      if (value) {
        envBindings[sectionEnv].add(`${currentBinding}:${value}`);
      }
    }

    collectInlineDurableObjectBindings(
      envBindings,
      sectionEnv,
      currentBinding,
      line,
    );
  }

  return envBindings;
}

function parseSection(section) {
  const parts = section.split(".");
  if (parts[0] === "env") {
    return {
      env: parts[1],
      bindingType: parts.slice(2).join("."),
    };
  }

  return {
    env: "default",
    bindingType: parts.join("."),
  };
}

function ensureEnv(envBindings, envName) {
  if (!envBindings[envName]) {
    envBindings[envName] = new Set();
  }
}

function readStringAssignment(line, key) {
  const match = line.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`));
  return match?.[1];
}

function collectInlineDurableObjectBindings(
  envBindings,
  envName,
  bindingType,
  line,
) {
  if (bindingType !== "durable_objects") {
    return;
  }

  const assignment = line.match(/^bindings\s*=\s*\[(.*)\]\s*$/);
  if (!assignment) {
    return;
  }

  ensureEnv(envBindings, envName);
  const names = assignment[1].matchAll(/name\s*=\s*"([^"]+)"/g);
  for (const name of names) {
    envBindings[envName].add(`durable_objects.bindings:${name[1]}`);
  }
}

function printResult(result) {
  // Printed before the blocking section so it survives even when the run fails,
  // and printed at all so a dead delivery channel is visible on every deploy
  // instead of being discovered by customers.
  if (result.warnings.length > 0) {
    console.error("");
    console.error(
      "[check-production-config] ⚠️  WARNING — production is missing optional secrets.",
    );
    console.error(
      "These do not block the deploy, but the features below are dead in production until they are set:",
    );
    console.error("");

    for (const warning of result.warnings) {
      console.error(`  ${warning.file}:${warning.line} ${warning.text}`);
    }

    console.error("");
    console.error(
      "  Set one with: wrangler secret put <NAME> --env production",
    );
    console.error("");
  }

  if (result.violations.length > 0) {
    console.error("[check-production-config] Production deploy blocked.");
    console.error(
      "Fix production Cloudflare resources, runtime URLs, and required secrets before deploying.",
    );
    console.error("");

    for (const violation of result.violations) {
      console.error(`  ${violation.file}:${violation.line} ${violation.text}`);
    }

    console.error("");
    console.error(
      "Create production resources, configure production vars/secrets, then rerun this check before deploy.",
    );
    return false;
  }

  console.log(
    `[check-production-config] OK: checked ${result.checkedFiles} wrangler.toml files.`,
  );
  return true;
}

function main() {
  const result = checkProductionConfig();
  if (!printResult(result)) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  checkProductionConfig,
  REQUIRED_DEPLOYMENT_SECRETS,
  collectBindings,
  collectProductionVars,
};
