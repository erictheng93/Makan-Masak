#!/usr/bin/env node
/**
 * Seeds the staging platform D1 (makanmasak-staging) with two real, non-demo
 * restaurants, their staff, a menu and signed table QR codes.
 *
 *   node scripts/staging/seed.cjs                 dry run: prints a summary, writes nothing
 *   node scripts/staging/seed.cjs --out seed.sql  writes the SQL (and credentials) locally, no remote call
 *   node scripts/staging/seed.cjs --apply         writes both, then runs the SQL against makanmasak-staging
 *   --rotate                                      generate new passwords (default: reuse the credentials file)
 *   --customer-url <url>                          base URL baked into table QR codes
 *
 * Plaintext passwords go ONLY to .wrangler/staging-credentials.json (gitignored,
 * mode 0600). Only bcrypt hashes (cost 10) appear in the SQL. Idempotent:
 * everything is an upsert on a fixed id, so re-running repairs drift and
 * re-signs the table QR codes after QR_SIGNING_KEY changes.
 */
"use strict";

const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  ROOT,
  CREDENTIALS_FILE,
  assertStagingName,
  loadOrCreateSecrets,
  writePrivate,
} = require("./common.cjs");

const DEFAULT_CUSTOMER_URL = "https://customer-staging.makanmasak.com";
// Fixed so the shop QR code (a public identifier) is stable across re-seeds.
const SHOP_QR_TS = 1767225600000;

const RESTAURANTS = [
  {
    id: "019469b0-5a01-7000-8000-000000000a01",
    name: "Staging 測試餐廳",
    slug: "staging-a",
    phone: "+886900000a01",
    staff: [
      { key: "owner", role: 1, fullName: "Staging A 店主" },
      { key: "chef", role: 2, fullName: "Staging A 廚師" },
      { key: "cashier", role: 4, fullName: "Staging A 收銀" },
    ],
    categories: [
      { id: 8001, name: "主食", sort: 0 },
      { id: 8002, name: "飲料", sort: 1 },
    ],
    // price_cents: major units x 100, TWD (NT$180 = 18000).
    items: [
      { id: 8001, cat: 8001, name: "紅燒牛肉麵", cents: 18000, prep: 10 },
      { id: 8002, cat: 8001, name: "滷肉飯", cents: 6000, prep: 5 },
      { id: 8003, cat: 8001, name: "小籠包", cents: 12000, prep: 12 },
      { id: 8004, cat: 8001, name: "燙青菜", cents: 5000, prep: 5 },
      { id: 8005, cat: 8002, name: "珍珠奶茶", cents: 6500, prep: 3 },
      { id: 8006, cat: 8002, name: "冬瓜茶", cents: 4000, prep: 2 },
    ],
    tables: [
      { id: 8001, number: "1", name: "桌 1" },
      { id: 8002, number: "2", name: "桌 2" },
      { id: 8003, number: "3", name: "桌 3" },
    ],
  },
  {
    id: "019469b0-5b01-7000-8000-000000000b01",
    name: "Staging 測試餐廳 B",
    slug: "staging-b",
    phone: "+886900000b01",
    // Same `chef` username as shop A: exercises per-shop usernames (0042).
    staff: [
      { key: "owner", role: 1, fullName: "Staging B 店主" },
      { key: "chef", role: 2, fullName: "Staging B 廚師" },
    ],
    categories: [{ id: 8101, name: "主食", sort: 0 }],
    items: [
      { id: 8101, cat: 8101, name: "炒飯", cents: 9000, prep: 8 },
      { id: 8102, cat: 8101, name: "餛飩湯", cents: 7000, prep: 6 },
    ],
    tables: [],
  },
];

const PLATFORM_ADMIN = {
  id: "019469b1-5000-7000-8000-000000000001",
  username: "staging-admin",
  fullName: "Staging Administrator",
};

const userId = (r, key) =>
  `019469b1-${r.slug === "staging-a" ? "5a01" : "5b01"}-7000-8000-${Buffer.from(
    key,
  )
    .toString("hex")
    .padStart(12, "0")
    .slice(-12)}`;

const q = (v) => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`non-finite SQL number: ${v}`);
    return String(v);
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};

function bcryptHash(password) {
  const bcrypt = require(
    require.resolve("bcryptjs", { paths: [path.join(ROOT, "apps", "api")] }),
  );
  return bcrypt.hashSync(password, 10);
}

// Same canonical string and 8-byte truncation as packages/utils/src/qr-signing.ts
// (the unit test checks the two agree).
function signTableQr({ restaurantId, tableId, identifier, version }, key) {
  const canonical = `v2|table|${restaurantId}|${tableId}|${identifier}|${version}`;
  return nodeCrypto
    .createHmac("sha256", key)
    .update(canonical)
    .digest("hex")
    .slice(0, 16);
}

function buildTableQrUrl(baseUrl, table, restaurantId, key, ts = SHOP_QR_TS) {
  const sig = signTableQr(
    { restaurantId, tableId: table.id, identifier: table.number, version: 1 },
    key,
  );
  const url = new URL("/order", baseUrl);
  url.searchParams.set("t", "table");
  url.searchParams.set("r", restaurantId);
  url.searchParams.set("d", String(table.id));
  url.searchParams.set("f", "2");
  url.searchParams.set("n", table.number);
  url.searchParams.set("v", "1");
  url.searchParams.set("ts", String(ts));
  url.searchParams.set("sig", sig);
  return url.toString();
}

function newPassword() {
  return nodeCrypto.randomBytes(12).toString("base64url");
}

/** Pure given its inputs. Returns the SQL and the plaintext credentials. */
function buildSeed({
  qrSigningKey,
  customerUrl = DEFAULT_CUSTOMER_URL,
  passwords = {},
  now = Date.now(),
  hash = bcryptHash,
}) {
  if (!qrSigningKey || qrSigningKey.length < 32) {
    throw new Error("QR_SIGNING_KEY must be at least 32 characters");
  }
  const credentials = {};
  const tableQrUrls = [];
  const sql = [
    "-- Staging seed. Generated by scripts/staging/seed.cjs. Idempotent upserts only.",
    "-- Contains bcrypt hashes, never plaintext passwords.",
  ];
  const passwordFor = (id, label) => {
    const pw = passwords[id] || newPassword();
    credentials[id] = { label, password: pw };
    return pw;
  };

  const upsertUser = (u) =>
    sql.push(
      `INSERT INTO users (id, username, full_name, password_hash, role, restaurant_id, admin_tier, is_active, is_verified, token_version, created_at_ms, updated_at_ms) VALUES (${[
        q(u.id),
        q(u.username),
        q(u.fullName),
        q(u.hash),
        u.role,
        q(u.restaurantId),
        q(u.adminTier),
        1,
        1,
        1,
        now,
        now,
      ].join(
        ", ",
      )}) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, role = excluded.role, is_active = 1, token_version = users.token_version + 1, updated_at_ms = excluded.updated_at_ms;`,
    );

  // Platform administrator (management portal / admin tooling).
  upsertUser({
    ...PLATFORM_ADMIN,
    role: 0,
    restaurantId: null,
    adminTier: "administrator",
    hash: hash(passwordFor(PLATFORM_ADMIN.id, "platform administrator")),
  });

  for (const r of RESTAURANTS) {
    const settings = JSON.stringify({
      currency: "TWD",
      language: "zh-Hant",
      allowGuestOrders: true,
    });
    sql.push(
      // is_demo = 0: a demo shop refuses orders (DEMO_RESTAURANT). enable_shop_mode
      // lets guest takeaway orders through; the shop QR is a public identifier.
      `INSERT INTO restaurants (id, name, type, category, description, address, district, city, phone, email, settings, is_available, is_active, enable_shop_mode, shop_qr_code, supports_takeaway, country_code, is_demo, login_slug, created_at_ms, updated_at_ms) VALUES (${[
        q(r.id),
        q(r.name),
        q("中式"),
        q("快餐"),
        q("Staging walkthrough restaurant. Not a demo shop; accepts orders."),
        q("1 Staging Road"),
        q("信義區"),
        q("台北市"),
        q(r.phone),
        q(`${r.slug}@staging.invalid`),
        q(settings),
        1,
        1,
        1,
        q(`SHOP-${r.id}-${SHOP_QR_TS}`),
        1,
        q("TW"),
        0,
        q(r.slug),
        now,
        now,
      ].join(
        ", ",
      )}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_demo = 0, is_available = 1, is_active = 1, enable_shop_mode = 1, login_slug = excluded.login_slug, settings = excluded.settings, updated_at_ms = excluded.updated_at_ms;`,
      // Without a subscription row every module-gated route (kitchen, POS)
      // answers 403 SUBSCRIPTION_NOT_FOUND. Same module set as seed-local.sql.
      `INSERT INTO shop_subscriptions (id, restaurant_id, plan_tier, module_overrides, is_active, trial_ends_at_ms, billing_cycle_start_at_ms, billing_cycle_end_at_ms, notes, created_at_ms, updated_at_ms) VALUES (${[
        q(r.id.replace(/^019469b0/, "019469b2")),
        q(r.id),
        q("trial"),
        q(
          JSON.stringify({
            online_ordering: true,
            analytics: true,
            menu_management: true,
            table_management: true,
            staff_management: true,
            pos: true,
            kitchen_display: true,
          }),
        ),
        1,
        now + 365 * 24 * 60 * 60 * 1000,
        now,
        now + 365 * 24 * 60 * 60 * 1000,
        q("staging walkthrough subscription"),
        now,
        now,
      ].join(
        ", ",
      )}) ON CONFLICT(restaurant_id) DO UPDATE SET plan_tier = excluded.plan_tier, module_overrides = excluded.module_overrides, is_active = 1, trial_ends_at_ms = excluded.trial_ends_at_ms, updated_at_ms = excluded.updated_at_ms;`,
    );

    for (const s of r.staff) {
      const id = userId(r, s.key);
      upsertUser({
        id,
        username: s.key,
        fullName: s.fullName,
        role: s.role,
        restaurantId: r.id,
        adminTier: null,
        hash: hash(passwordFor(id, `${r.slug} ${s.key}`)),
      });
    }

    for (const c of r.categories) {
      sql.push(
        `INSERT INTO categories (id, restaurant_id, name, sort_order, is_active, is_visible, created_at_ms, updated_at_ms) VALUES (${[
          c.id,
          q(r.id),
          q(c.name),
          c.sort,
          1,
          1,
          now,
          now,
        ].join(
          ", ",
        )}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, is_active = 1, is_visible = 1, deleted_at_ms = NULL;`,
      );
    }

    r.items.forEach((it, index) => {
      if (it.cents % 100 !== 0) {
        throw new Error(
          `${it.name}: TWD has no sub-dollar unit, got ${it.cents}`,
        );
      }
      sql.push(
        `INSERT INTO menu_items (id, restaurant_id, category_id, name, price_cents, is_available, sort_order, preparation_time, created_at_ms, updated_at_ms) VALUES (${[
          it.id,
          q(r.id),
          it.cat,
          q(it.name),
          it.cents,
          1,
          index,
          it.prep,
          now,
          now,
        ].join(
          ", ",
        )}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, price_cents = excluded.price_cents, is_available = 1, deleted_at_ms = NULL;`,
      );
    });

    for (const t of r.tables) {
      const qr = buildTableQrUrl(customerUrl, t, r.id, qrSigningKey);
      tableQrUrls.push({ shop: r.slug, number: t.number, url: qr });
      sql.push(
        `INSERT INTO tables (id, restaurant_id, number, name, capacity, qr_code, qr_code_version, is_active, is_occupied, created_at_ms, updated_at_ms) VALUES (${[
          t.id,
          q(r.id),
          q(t.number),
          q(t.name),
          4,
          q(qr),
          1,
          1,
          0,
          now,
          now,
        ].join(
          ", ",
        )}) ON CONFLICT(id) DO UPDATE SET qr_code = excluded.qr_code, qr_code_version = 1, is_active = 1, deleted_at_ms = NULL;`,
      );
    }
  }

  return { sql: sql.join("\n") + "\n", credentials, tableQrUrls };
}

function readExistingPasswords(file = CREDENTIALS_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Object.fromEntries(
      Object.entries(parsed.byId || {}).map(([id, v]) => [id, v.password]),
    );
  } catch {
    return {};
  }
}

function writeCredentials(credentials, tableQrUrls, file = CREDENTIALS_FILE) {
  const accounts = RESTAURANTS.flatMap((r) =>
    r.staff.map((s) => ({
      shop: r.slug,
      username: s.key,
      role: s.role,
      password: credentials[userId(r, s.key)].password,
    })),
  );
  accounts.push({
    shop: null,
    username: PLATFORM_ADMIN.username,
    role: 0,
    password: credentials[PLATFORM_ADMIN.id].password,
  });
  writePrivate(
    file,
    JSON.stringify({ accounts, tableQrUrls, byId: credentials }, null, 2),
  );
}

function parseArgs(argv) {
  const args = { apply: false, rotate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--rotate") args.rotate = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--customer-url") args.customerUrl = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const secrets = loadOrCreateSecrets(undefined, { write: false });
  const { sql, credentials, tableQrUrls } = buildSeed({
    qrSigningKey: secrets.QR_SIGNING_KEY,
    customerUrl: args.customerUrl || DEFAULT_CUSTOMER_URL,
    passwords: args.rotate ? {} : readExistingPasswords(),
  });

  const statements = sql.split("\n").filter((l) => /^INSERT/.test(l)).length;
  if (!args.apply && !args.out) {
    console.log(
      `DRY RUN: ${statements} upserts for ${RESTAURANTS.map((r) => r.slug).join(", ")} + a platform admin. Nothing written.`,
    );
    console.log("Use --out <file> to write SQL locally or --apply to run it.");
    return;
  }

  // The QR key must be the one the Workers hold; the file is created by provision.
  if (!fs.existsSync(path.join(ROOT, ".wrangler", "staging-secrets.json"))) {
    throw new Error(
      "run provision.cjs --apply first (it generates the secrets)",
    );
  }
  const target = args.out || path.join(ROOT, ".wrangler", "staging-seed.sql");
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, sql);
  writeCredentials(credentials, tableQrUrls);
  console.log(`SQL written to ${target}`);
  console.log(
    `Credentials written to ${CREDENTIALS_FILE} (gitignored). Not printed.`,
  );

  if (args.apply) {
    const db = assertStagingName("makanmasak-staging");
    const run = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        db,
        "--remote",
        "--env",
        "staging",
        "--config",
        "apps/api/wrangler.toml",
        "--file",
        target,
      ],
      { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
    );
    if (run.status !== 0) throw new Error("d1 execute failed");
  }
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
  RESTAURANTS,
  buildSeed,
  buildTableQrUrl,
  signTableQr,
  userId,
};
