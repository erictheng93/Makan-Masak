#!/usr/bin/env node
// Usage: node assert-ready.cjs <file>...
// Exits 1 if a staging config still holds a provisioning placeholder, so a
// deploy:staging script fails before wrangler sends `STAGING_D1_PLATFORM_ID`
// to Cloudflare as if it were a database id.
"use strict";

const fs = require("node:fs");
const { findPlaceholders } = require("./common.cjs");

let bad = false;
for (const file of process.argv.slice(2)) {
  const hits = findPlaceholders(fs.readFileSync(file, "utf8"));
  if (hits.length > 0) {
    bad = true;
    console.error(
      `[staging] ${file} still has placeholders: ${hits.join(", ")}\n` +
        "Run: node scripts/staging/provision.cjs --apply --workers-subdomain <name>",
    );
  }
}
process.exit(bad ? 1 : 0);
