#!/usr/bin/env node
// Pre-fetch better-sqlite3's prebuilt binary into a directory that
// prebuild-install reads via npm_config_better_sqlite3_local_prebuilds, so
// `pnpm install` never touches github.com/<repo>/releases/download/ -- that
// path 504s for minutes at a time. This goes through the api.github.com asset
// endpoint instead. Never fails the job: on any error prebuild-install just
// downloads (and, failing that, compiles) as it would have anyway.
//
// usage: node scripts/fetch-better-sqlite3-prebuilt.mjs <dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: fetch-better-sqlite3-prebuilt.mjs <dir>");
  process.exit(1);
}

const lock = readFileSync("pnpm-lock.yaml", "utf8");
const versions = [
  ...new Set(
    [...lock.matchAll(/^ {2}better-sqlite3@([\d.]+):/gm)].map((m) => m[1]),
  ),
];
const headers = {
  "User-Agent": "makanmasak-ci",
  ...(process.env.GH_TOKEN && {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
  }),
};

mkdirSync(dir, { recursive: true });
for (const version of versions) {
  const name = `better-sqlite3-v${version}-node-v${process.versions.modules}-${process.platform}-${process.arch}.tar.gz`;
  try {
    const release = await fetch(
      `https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v${version}`,
      { headers },
    );
    if (!release.ok) throw new Error(`release lookup HTTP ${release.status}`);
    const asset = (await release.json()).assets?.find((a) => a.name === name);
    if (!asset) throw new Error("no such asset in the release");
    const file = await fetch(asset.url, {
      headers: { ...headers, Accept: "application/octet-stream" },
    });
    if (!file.ok) throw new Error(`asset download HTTP ${file.status}`);
    const body = Buffer.from(await file.arrayBuffer());
    if (body.length !== asset.size) {
      throw new Error(`got ${body.length} bytes, expected ${asset.size}`);
    }
    writeFileSync(path.join(dir, name), body);
    console.log(`fetched ${name} (${body.length} bytes)`);
  } catch (error) {
    console.warn(
      `::warning::could not pre-fetch ${name}: ${error.message}; pnpm install will download or build it`,
    );
  }
}
