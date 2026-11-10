"use strict";
// Shared helpers for scripts/staging/*. Everything here is pure or touches only
// gitignored files under .wrangler/; nothing talks to Cloudflare.

const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SECRETS_FILE = path.join(ROOT, ".wrangler", "staging-secrets.json");
const CREDENTIALS_FILE = path.join(
  ROOT,
  ".wrangler",
  "staging-credentials.json",
);
const SUBDOMAIN_TOKEN = "__WORKERS_SUBDOMAIN__";

// The only names this tooling may create or write to.
function assertStagingName(name) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*-staging$/.test(name)) {
    throw new Error(
      `refusing to touch "${name}": staging resources must be named *-staging`,
    );
  }
  return name;
}

// Replaces whole-token placeholders on non-comment lines only, so the
// explanatory comments in wrangler.toml keep their literal text.
function substitutePlaceholders(text, map) {
  return text
    .split("\n")
    .map((line) => {
      if (line.trimStart().startsWith("#")) return line;
      let out = line;
      for (const [token, value] of Object.entries(map)) {
        out = out.split(token).join(value);
      }
      return out;
    })
    .join("\n");
}

// Placeholders still present outside comments.
function findPlaceholders(text) {
  const hits = new Set();
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    for (const m of line.matchAll(
      /STAGING_[A-Z0-9_]+_ID|__WORKERS_SUBDOMAIN__/g,
    )) {
      hits.add(m[0]);
    }
  }
  return [...hits];
}

const GENERATED_SECRETS = [
  "JWT_SECRET",
  "QR_SIGNING_KEY",
  "ENCRYPTION_KEY",
  "INTERNAL_API_TOKEN",
];

// Which generated secrets each Worker needs. JWT_SECRET is one shared value:
// the realtime Worker and the image processor verify tokens the API signs.
const WORKER_SECRETS = {
  api: ["JWT_SECRET", "QR_SIGNING_KEY", "ENCRYPTION_KEY", "INTERNAL_API_TOKEN"],
  realtime: ["JWT_SECRET"],
  "management-api": ["JWT_SECRET", "INTERNAL_API_TOKEN"],
  "image-processor": ["JWT_SECRET"],
};

function randomSecret() {
  return nodeCrypto.randomBytes(32).toString("hex");
}

// Reuses what is on disk so a re-run never rotates a secret the deployed
// Workers already hold (that would invalidate every staging session and every
// printed table QR).
function loadOrCreateSecrets(file = SECRETS_FILE, { write = true } = {}) {
  let secrets = {};
  try {
    secrets = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // first run
  }
  let changed = false;
  for (const name of GENERATED_SECRETS) {
    if (typeof secrets[name] !== "string" || secrets[name].length < 32) {
      secrets[name] = randomSecret();
      changed = true;
    }
  }
  if (changed && write) writePrivate(file, JSON.stringify(secrets, null, 2));
  return secrets;
}

function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content + "\n", { mode: 0o600 });
}

module.exports = {
  ROOT,
  SECRETS_FILE,
  CREDENTIALS_FILE,
  SUBDOMAIN_TOKEN,
  GENERATED_SECRETS,
  WORKER_SECRETS,
  assertStagingName,
  substitutePlaceholders,
  findPlaceholders,
  loadOrCreateSecrets,
  writePrivate,
};
