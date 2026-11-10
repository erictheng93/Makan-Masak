import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { signQRPayload } from "../../packages/utils/src/qr-signing";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../..", import.meta.url));

const provision = require("../../scripts/staging/provision.cjs") as {
  RESOURCES: {
    d1: { name: string; placeholder: string }[];
    kv: { name: string; placeholder: string }[];
    r2: string[];
    queues: string[];
    vectorize: { name: string }[];
    pages: string[];
  };
  CONFIG_FILES: string[];
  assertSafeCommand: (argv: string[]) => string[];
  planCommands: (o?: { skipMigrations?: boolean }) => string[][];
  parseArgs: (argv: string[]) => { apply: boolean; subdomain?: string };
};
const common = require("../../scripts/staging/common.cjs") as {
  assertStagingName: (name: string) => string;
  substitutePlaceholders: (text: string, map: Record<string, string>) => string;
  findPlaceholders: (text: string) => string[];
};
const seed = require("../../scripts/staging/seed.cjs") as {
  buildSeed: (o: {
    qrSigningKey: string;
    customerUrl?: string;
    passwords?: Record<string, string>;
    hash?: (p: string) => string;
  }) => { sql: string; credentials: Record<string, { password: string }> };
  signTableQr: (
    p: {
      restaurantId: string;
      tableId: number;
      identifier: string;
      version: number;
    },
    key: string,
  ) => string;
  RESTAURANTS: { id: string; slug: string }[];
};
const { checkProductionConfig } =
  require("../../scripts/check-production-config.cjs") as {
    checkProductionConfig: (o: {
      root: string;
      env: Record<string, string>;
      requireDeploymentSecrets: boolean;
    }) => { violations: { text: string }[] };
  };

const readRepo = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("staging provision safety rules", () => {
  it("refuses any resource name that does not end in -staging", () => {
    for (const name of [
      "makanmasak-prod",
      "makanmasak-staging-old",
      "staging",
      "",
      "x_staging",
    ]) {
      expect(() => common.assertStagingName(name)).toThrow(/-staging/);
    }
    expect(common.assertStagingName("makanmasak-staging")).toBe(
      "makanmasak-staging",
    );
  });

  it("refuses production-scoped or unrecognised commands", () => {
    const bad = [
      ["d1", "create", "makanmasak-prod"],
      [
        "d1",
        "migrations",
        "apply",
        "makanmasak-prod",
        "--remote",
        "--env",
        "staging",
      ],
      [
        "d1",
        "migrations",
        "apply",
        "makanmasak-staging",
        "--remote",
        "--env",
        "production",
      ],
      ["d1", "migrations", "apply", "makanmasak-staging", "--remote"],
      ["kv", "namespace", "create", "makanmasak-cache-prod"],
      ["r2", "bucket", "create", "makanmasak-backups-prod"],
      ["secret", "put", "JWT_SECRET", "--env", "production"],
      ["secret", "put", "JWT_SECRET"],
      ["d1", "execute", "makanmasak-prod", "--remote"],
    ];
    for (const argv of bad) {
      expect(() => provision.assertSafeCommand(argv), argv.join(" ")).toThrow();
    }
  });

  it("plans only -staging resources and never a destructive command", () => {
    const cmds = provision.planCommands();
    expect(cmds.length).toBeGreaterThan(15);
    for (const argv of cmds) {
      expect(argv.join(" ")).not.toMatch(
        /\b(delete|time-travel)\b|--env production/,
      );
    }
    const created = cmds
      .filter((c) => c[1] !== "migrations")
      .map((c) =>
        c[0] === "kv" ? c[3] : c[0] === "r2" || c[0] === "pages" ? c[3] : c[2],
      );
    expect(created.every((n) => n.endsWith("-staging"))).toBe(true);
    expect(
      provision
        .planCommands({ skipMigrations: true })
        .some((c) => c[1] === "migrations"),
    ).toBe(false);
  });

  it("is a dry run by default and runs no wrangler", () => {
    expect(provision.parseArgs([]).apply).toBe(false);
    expect(provision.parseArgs(["--apply"]).apply).toBe(true);
    const run = spawnSync(
      process.execPath,
      [join(root, "scripts/staging/provision.cjs")],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "" }, // no pnpm on PATH: any attempt to run wrangler would fail
      },
    );
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("DRY RUN");
    expect(run.stdout).toContain("wrangler d1 create makanmasak-staging");
  });

  it("rejects an unknown flag and a malformed subdomain", () => {
    expect(() => provision.parseArgs(["--nope"])).toThrow();
    expect(() =>
      provision.parseArgs(["--workers-subdomain", "Bad Domain"]),
    ).toThrow();
    expect(
      provision.parseArgs(["--workers-subdomain", "eric-dev"]).subdomain,
    ).toBe("eric-dev");
  });
});

describe("staging placeholders", () => {
  it("substitutes tokens on code lines and leaves comments alone", () => {
    const text =
      '# STAGING_D1_PLATFORM_ID is explained here\ndatabase_id = "STAGING_D1_PLATFORM_ID"\nurl = "https://a.__WORKERS_SUBDOMAIN__.workers.dev"';
    const out = common.substitutePlaceholders(text, {
      STAGING_D1_PLATFORM_ID: "uuid-1",
      __WORKERS_SUBDOMAIN__: "me",
    });
    expect(out).toBe(
      '# STAGING_D1_PLATFORM_ID is explained here\ndatabase_id = "uuid-1"\nurl = "https://a.me.workers.dev"',
    );
    expect(common.findPlaceholders(out)).toEqual([]);
  });

  it("only uses placeholders that provision knows how to fill (none left once provisioned)", () => {
    const known = new Set([
      ...provision.RESOURCES.d1.map((r) => r.placeholder),
      ...provision.RESOURCES.kv.map((r) => r.placeholder),
      "__WORKERS_SUBDOMAIN__",
    ]);
    const used = new Set<string>();
    for (const rel of provision.CONFIG_FILES) {
      for (const p of common.findPlaceholders(readRepo(rel))) used.add(p);
    }
    for (const p of used) expect(known.has(p), p).toBe(true);
  });

  it("names every provisioned resource in a staging wrangler section", () => {
    const tomls = ["api", "realtime", "management-api", "image-processor"]
      .map((a) => readRepo(`apps/${a}/wrangler.toml`))
      .join("\n");
    const { RESOURCES } = provision;
    const names = [
      ...RESOURCES.d1.map((r) => r.name),
      ...RESOURCES.r2,
      ...RESOURCES.queues,
      ...RESOURCES.vectorize.map((r) => r.name),
    ];
    for (const n of names) expect(tomls, n).toContain(`"${n}"`);
  });

  it("deploy:staging refuses to run while placeholders remain", () => {
    const run = spawnSync(
      process.execPath,
      [
        join(root, "scripts/staging/assert-ready.cjs"),
        join(root, "apps/api/wrangler.toml"),
      ],
      { encoding: "utf8" },
    );
    // Passes only once provision has filled the file in; before that it must fail.
    const hasPlaceholders =
      common.findPlaceholders(readRepo("apps/api/wrangler.toml")).length > 0;
    expect(run.status).toBe(hasPlaceholders ? 1 : 0);
  });
});

describe("production-config guard: staging isolation", () => {
  function check(toml: string) {
    const dir = mkdtempSync(join(tmpdir(), "staging-guard-"));
    mkdirSync(join(dir, "apps", "api"), { recursive: true });
    writeFileSync(
      join(dir, "apps", "api", "wrangler.toml"),
      [
        "[env.production]",
        'name = "makanmasak-api-prod"',
        "[env.production.vars]",
        'API_BASE_URL = "https://api.makanmasak.com"',
        'CORS_ORIGIN = "https://makanmasak.com"',
        "[[env.production.d1_databases]]",
        'binding = "DB"',
        'database_name = "makanmasak-prod"',
        'database_id = "prod-d1-id"',
        toml,
      ].join("\n"),
    );
    return checkProductionConfig({
      root: dir,
      env: {},
      requireDeploymentSecrets: false,
    })
      .violations.map((v) => v.text)
      .join("\n");
  }

  it("accepts a properly isolated staging section", () => {
    expect(
      check(
        [
          "[env.staging]",
          'name = "makanmasak-api-staging"',
          "[[env.staging.d1_databases]]",
          'binding = "DB"',
          'database_name = "makanmasak-staging"',
          'database_id = "STAGING_D1_PLATFORM_ID"',
          "[env.staging.vars]",
          'API_BASE_URL = "https://x.workers.dev"',
        ].join("\n"),
      ),
    ).toBe("");
  });

  it("rejects a staging section that reuses a production id or name", () => {
    const out = check(
      [
        "[env.staging]",
        'name = "makanmasak-api-staging"',
        "[[env.staging.d1_databases]]",
        'binding = "DB"',
        'database_name = "makanmasak-prod"',
        'database_id = "prod-d1-id"',
      ].join("\n"),
    );
    expect(out).toContain("production resource id");
    expect(out).toContain("must end in -staging");
  });

  it("rejects staging routes, production domains in staging vars, and staging values in production", () => {
    const out = check(
      [
        "[env.staging]",
        'name = "makanmasak-api-staging"',
        "[[env.staging.routes]]",
        'pattern = "x.makanmasak.com"',
        "[env.staging.vars]",
        'API_BASE_URL = "https://api.makanmasak.com"',
      ].join("\n"),
    );
    expect(out).toContain("staging routes may only use");
    expect(out).toContain("production domain");

    // <name>-staging.makanmasak.com is staging's own host, in routes and vars.
    const own = check(
      [
        "[env.staging]",
        'name = "makanmasak-api-staging"',
        "[[env.staging.routes]]",
        'pattern = "api-staging.makanmasak.com"',
        "custom_domain = true",
        "[env.staging.vars]",
        'CORS_ORIGIN = "https://admin-staging.makanmasak.com,https://kitchen-staging.makanmasak.com"',
      ].join("\n"),
    );
    expect(own).not.toContain("staging routes may only use");
    expect(own).not.toContain("production domain");

    const mixed = check(
      [
        "[env.staging]",
        'name = "makanmasak-api-staging"',
        "[env.staging.vars]",
        'CORS_ORIGIN = "https://admin-staging.makanmasak.com,https://admin.makanmasak.com"',
      ].join("\n"),
    );
    expect(mixed).toContain("production domain");

    const leaked = check(
      [
        "[[env.production.kv_namespaces]]",
        'binding = "CACHE_KV"',
        'id = "STAGING_KV_CACHE_ID"',
      ].join("\n"),
    );
    expect(leaked).toContain("staging value in a production section");
  });

  it("rejects a production host in a staging frontend env file", () => {
    const dir = mkdtempSync(join(tmpdir(), "staging-env-"));
    mkdirSync(join(dir, "apps", "customer-app"), { recursive: true });
    writeFileSync(
      join(dir, "apps", "customer-app", ".env.staging"),
      "VITE_API_BASE_URL=https://api.makanmasak.com/api/v1\n",
    );
    const { violations } = checkProductionConfig({
      root: dir,
      env: {},
      requireDeploymentSecrets: false,
    });
    expect(violations.map((v) => v.text).join("\n")).toContain(
      "production domain",
    );
  });

  it("passes on the checked-in wrangler files", () => {
    const result = checkProductionConfig({
      root,
      env: {},
      requireDeploymentSecrets: false,
    });
    expect(result.violations).toEqual([]);
  });
});

describe("staging seed", () => {
  const key = "k".repeat(64);
  const stubHash = (p: string) => `$2a$10$stub${p.length}`;

  function migrated() {
    const db = new Database(":memory:");
    const dir = join(root, "packages/database/migrations_fresh");
    for (const f of readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      db.exec(readFileSync(join(dir, f), "utf8"));
    }
    return db;
  }

  it("creates two non-demo restaurants with staff, menu and signed tables, idempotently", () => {
    const db = migrated();
    const { sql } = seed.buildSeed({ qrSigningKey: key, hash: stubHash });
    db.exec(sql);
    db.exec(sql); // upserts: a second run must not fail or duplicate

    const shops = db
      .prepare(
        "SELECT login_slug, is_demo, enable_shop_mode, name FROM restaurants ORDER BY login_slug",
      )
      .all();
    expect(shops).toEqual([
      {
        login_slug: "staging-a",
        is_demo: 0,
        enable_shop_mode: 1,
        name: "Staging 測試餐廳",
      },
      {
        login_slug: "staging-b",
        is_demo: 0,
        enable_shop_mode: 1,
        name: "Staging 測試餐廳 B",
      },
    ]);

    const a = seed.RESTAURANTS[0].id;
    const b = seed.RESTAURANTS[1].id;
    const count = (table: string, id: string) =>
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE restaurant_id = ?`)
          .get(id) as { n: number }
      ).n;
    expect(count("menu_items", a)).toBe(6);
    expect(count("categories", a)).toBeGreaterThanOrEqual(2);
    expect(count("tables", a)).toBe(3);
    expect(count("users", a)).toBe(3);
    expect(count("users", b)).toBe(2);

    const prices = db.prepare("SELECT price_cents FROM menu_items").all() as {
      price_cents: number;
    }[];
    expect(prices.every((p) => p.price_cents % 100 === 0)).toBe(true);

    const chefs = db
      .prepare(
        "SELECT restaurant_id FROM users WHERE username = 'chef' ORDER BY restaurant_id",
      )
      .all();
    expect(chefs).toHaveLength(2);
    const roles = db
      .prepare(
        "SELECT username, role FROM users WHERE restaurant_id = ? ORDER BY role",
      )
      .all(a);
    expect(roles).toEqual([
      { username: "owner", role: 1 },
      { username: "chef", role: 2 },
      { username: "cashier", role: 4 },
    ]);
    const admin = db
      .prepare(
        "SELECT role, admin_tier, restaurant_id FROM users WHERE username = 'staging-admin'",
      )
      .get();
    expect(admin).toEqual({
      role: 0,
      admin_tier: "administrator",
      restaurant_id: null,
    });
    db.close();
  });

  it("signs table QR codes exactly like packages/utils buildSignedQRUrl", async () => {
    const db = migrated();
    db.exec(seed.buildSeed({ qrSigningKey: key, hash: stubHash }).sql);
    const row = db
      .prepare("SELECT id, number, qr_code FROM tables WHERE number = '2'")
      .get() as { id: number; number: string; qr_code: string };
    const url = new URL(row.qr_code);
    expect(url.pathname).toBe("/order");
    expect(url.searchParams.get("t")).toBe("table");
    expect(url.searchParams.get("f")).toBe("2");
    const expected = await signQRPayload(
      {
        type: "table",
        restaurantId: seed.RESTAURANTS[0].id,
        tableId: row.id,
        identifier: row.number,
        version: 1,
      },
      key,
    );
    expect(url.searchParams.get("sig")).toBe(expected);
    db.close();
  });

  it("emits bcrypt hashes only, never the plaintext passwords", () => {
    const { sql, credentials } = seed.buildSeed({ qrSigningKey: key });
    const passwords = Object.values(credentials).map((c) => c.password);
    expect(passwords).toHaveLength(6);
    expect(new Set(passwords).size).toBe(6);
    for (const p of passwords) expect(sql).not.toContain(p);
    expect(sql.match(/\$2[aby]\$10\$/g)).toHaveLength(6);
  });

  it("reuses supplied passwords so a re-seed does not change credentials", () => {
    const first = seed.buildSeed({ qrSigningKey: key, hash: stubHash });
    const passwords = Object.fromEntries(
      Object.entries(first.credentials).map(([id, c]) => [id, c.password]),
    );
    const second = seed.buildSeed({
      qrSigningKey: key,
      hash: stubHash,
      passwords,
    });
    expect(second.credentials).toEqual(first.credentials);
  });

  it("rejects a QR signing key shorter than the API accepts", () => {
    expect(() => seed.buildSeed({ qrSigningKey: "short" })).toThrow(/32/);
  });
});
