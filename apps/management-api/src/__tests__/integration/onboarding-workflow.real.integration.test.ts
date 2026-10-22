import {
  MANAGEMENT_ADMIN_ID,
  MANAGEMENT_SESSION_ID,
  seedManagementAdmin,
} from "../management-auth-fixture";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sign } from "hono/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { D1DatabaseAdapter } from "../../../../../tests/helpers/d1-adapter";
import app from "../../index";
import type { ManagementEnv } from "../../types";
import { readData, readEnvelope, readError } from "../helpers/read-json";
import type { OnboardingService } from "../../services/OnboardingService";
import type { TenantService } from "../../services/TenantService";

type ServiceData<T> = T extends (...args: never[]) => Promise<infer R>
  ? NonNullable<R>
  : never;

// POST /onboarding/applications and GET /applications/:id both project a
// subset of the stored application, so those two shapes are stated here.
interface CreatedApplication {
  applicationId: string;
  applicationSecret: string;
  assignedSubdomain?: string;
  status: string;
}

type PublicApplication = ServiceData<OnboardingService["getApplication"]> & {
  cfApiTokenEnc?: never;
};

type ApplicationList = {
  applications: PublicApplication[];
  total: number;
  page: number;
  limit: number;
};

type ApproveResult = ServiceData<OnboardingService["approveApplication"]>;

/**
 * The HTTP layer returns the one-time link but not the bare setup token, so
 * tests that need the token read it back out of the link the operator gets.
 */
function tokenFromLink(setupPasswordLink: string): string {
  const token = new URL(setupPasswordLink).searchParams.get("token");
  if (!token) throw new Error(`no token in setup link: ${setupPasswordLink}`);
  return token;
}

type ProvisionedTenant = {
  tenant: ServiceData<TenantService["provisionPlatformRestaurantTenant"]>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "../../../migrations");

function createManagementDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF");

  for (const file of fs.readdirSync(migrationsDir).sort()) {
    if (!file.endsWith(".sql")) continue;
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
  }

  return new D1DatabaseAdapter(sqlite);
}

function createPlatformDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE restaurants (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      address TEXT NOT NULL,
      district TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '台中市',
      country_code TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      website TEXT,
      messaging_channels TEXT,
      business_hours TEXT,
      latitude REAL,
      longitude REAL,
      is_available INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      logo_url TEXT,
      banner_url TEXT,
      image_urls TEXT,
      shop_qr_code TEXT UNIQUE,
      shop_qr_code_image_url TEXT,
      enable_shop_mode INTEGER NOT NULL DEFAULT 0,
      shop_qr_settings TEXT,
      shop_qr_version INTEGER NOT NULL DEFAULT 1,
      is_demo INTEGER NOT NULL DEFAULT 0,
      settings TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
      rating REAL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      total_orders INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      deleted_at_ms INTEGER,
      cuisine_tags TEXT,
      price_range INTEGER,
      supports_takeaway INTEGER NOT NULL DEFAULT 0,
      supports_delivery INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      phone TEXT,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role INTEGER NOT NULL DEFAULT 4,
      restaurant_id TEXT,
      address TEXT,
      date_of_birth TEXT,
      profile_image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_verified INTEGER NOT NULL DEFAULT 0,
      preferences TEXT,
      total_orders INTEGER NOT NULL DEFAULT 0,
      total_spent INTEGER NOT NULL DEFAULT 0,
      last_login_at_ms INTEGER,
      password_changed_at_ms INTEGER,
      token_version INTEGER NOT NULL DEFAULT 1,
      email_verified_at_ms INTEGER,
      phone_verified_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      deleted_at_ms INTEGER
    );

    CREATE TABLE password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      token_type TEXT NOT NULL DEFAULT 'email',
      otp_code TEXT,
      expires_at_ms INTEGER NOT NULL,
      used_at_ms INTEGER,
      ip_address TEXT,
      user_agent TEXT,
      created_at_ms INTEGER NOT NULL
    );

    -- Mirrors packages/database/migrations_fresh/0015_shop-subscriptions.sql.
    -- apps/api moduleGate reads this table; onboarding must populate it or every
    -- module-gated endpoint 403s with SUBSCRIPTION_NOT_FOUND.
    CREATE TABLE shop_subscriptions (
      id TEXT PRIMARY KEY NOT NULL,
      restaurant_id TEXT NOT NULL UNIQUE,
      plan_tier TEXT NOT NULL DEFAULT 'trial',
      module_overrides TEXT DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      trial_ends_at_ms INTEGER,
      billing_cycle_start_at_ms INTEGER,
      billing_cycle_end_at_ms INTEGER,
      notes TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id)
    );

    CREATE TABLE policies (
      id TEXT PRIMARY KEY NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      policy_key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_by TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE onboarding_credential_deliveries (
      id TEXT PRIMARY KEY NOT NULL,
      application_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      username TEXT NOT NULL,
      setup_password_expires_at_ms INTEGER NOT NULL,
      delivery_channel TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE markets (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      boundary_geojson TEXT,
      opening_hours TEXT,
      map_layout TEXT,
      banner_url TEXT,
      logo_url TEXT,
      image_urls TEXT,
      tags TEXT,
      platform_fee_rate_bps INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      deleted_at_ms INTEGER
    );

    CREATE TABLE restaurant_market_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      stall_number TEXT,
      location_label TEXT,
      map_position TEXT,
      market_hours TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      joined_at_ms INTEGER NOT NULL,
      left_at_ms INTEGER
    );
    CREATE UNIQUE INDEX restaurant_market_active_pair_idx
      ON restaurant_market_memberships(restaurant_id, market_id)
      WHERE left_at_ms IS NULL;

    CREATE TABLE market_join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      restaurant_id TEXT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
      market_id TEXT NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      requested_at_ms INTEGER NOT NULL,
      resolved_at_ms INTEGER
    );
    CREATE UNIQUE INDEX market_join_requests_pending_pair_idx
      ON market_join_requests(restaurant_id, market_id)
      WHERE status = 'pending';
  `);

  seedManagementAdmin(sqlite);
  return new D1DatabaseAdapter(sqlite);
}

function createEnv(
  db: D1DatabaseAdapter,
  platformDb: D1DatabaseAdapter = createPlatformDb(),
  overrides: Partial<ManagementEnv> = {},
): ManagementEnv {
  return {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "http://localhost:5177,http://localhost:3004",
    ADMIN_APP_URL: "http://localhost:3004",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    INTERNAL_API_TOKEN: "internal-token",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: db as unknown as D1Database,
    PLATFORM_DB: platformDb as unknown as D1Database,
    CACHE_KV: {
      list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
      delete: async () => undefined,
    } as unknown as KVNamespace,
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

function createApplicationBody() {
  return {
    businessName: "Workflow Laksa",
    contactName: "Tan Mei",
    contactEmail: "tan.mei@example.com",
    contactPhone: "0912345678",
    address: "12 Jalan Tun Sambanthan, Brickfields",
    district: "Brickfields",
    city: "Kuala Lumpur",
    countryCode: "MY",
    planId: "standard",
    latitude: 24.147736,
    longitude: 120.673648,
  };
}

async function managementToken() {
  return sign(
    {
      id: MANAGEMENT_ADMIN_ID,
      email: "workflow-admin@example.test",
      role: "admin",
      tv: 1,
      sid: MANAGEMENT_SESSION_ID,
      aud: "management",
      iss: "makanmakan-management",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "test-secret",
    "HS256",
  );
}

describe("Onboarding public API workflow — real integration", () => {
  it("blocks a paid tier disabled for the application country before provisioning", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    platformDb
      .raw()
      .prepare(
        `INSERT INTO policies
         (id, scope_type, scope_id, policy_key, value, created_at_ms, updated_at_ms)
         VALUES (?, 'country', 'MY', 'plans.allowed_tiers', ?, ?, ?)`,
      )
      .run("my-plans", '["pro"]', Date.now(), Date.now());

    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const { applicationId } = await readData<CreatedApplication>(created);
    const approvalUrl = `https://management.test/api/v1/admin/onboarding/applications/${applicationId}/approve`;
    const token = await managementToken();
    const approve = () =>
      app.fetch(
        new Request(approvalUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }),
        env,
      );

    const blocked = await approve();
    expect(blocked.status).toBe(400);
    await expect(readError(blocked)).resolves.toMatchObject({
      code: "PLAN_NOT_AVAILABLE_IN_REGION",
    });
    expect(
      db.raw().prepare("SELECT COUNT(*) AS count FROM tenants").get(),
    ).toEqual({
      count: 0,
    });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM restaurants")
        .get(),
    ).toEqual({ count: 0 });

    platformDb
      .raw()
      .prepare("UPDATE policies SET value = ? WHERE id = ?")
      .run("not-json", "my-plans");
    const unavailable = await approve();
    expect(unavailable.status).toBe(503);
    await expect(readError(unavailable)).resolves.toMatchObject({
      code: "POLICY_UNAVAILABLE",
    });
    expect(
      db.raw().prepare("SELECT COUNT(*) AS count FROM tenants").get(),
    ).toEqual({
      count: 0,
    });

    platformDb
      .raw()
      .prepare("UPDATE policies SET value = ? WHERE id = ?")
      .run('["basic","pro"]', "my-plans");
    const allowed = await approve();
    expect(allowed.status).toBe(200);
    const result = await readData<ApproveResult>(allowed);
    expect(
      platformDb
        .raw()
        .prepare(
          "SELECT plan_tier FROM shop_subscriptions WHERE restaurant_id = ?",
        )
        .get(result.restaurantId),
    ).toEqual({ plan_tier: "basic" });
  });

  it("creates a pending market request without granting membership", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    platformDb
      .raw()
      .prepare(
        `INSERT INTO markets (
        id, slug, name, type, city, district, address, latitude, longitude,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "market-kl",
        "market-kl",
        "KL Market",
        "night_market",
        "Kuala Lumpur",
        "Brickfields",
        "Market Road",
        3.1,
        101.7,
        Date.now(),
        Date.now(),
      );

    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createApplicationBody(),
          marketId: "market-kl",
          stallNumber: "A12",
        }),
      }),
      env,
    );
    const createdData = await readData<CreatedApplication>(created);
    const list = await app.fetch(
      new Request(
        "https://management.test/api/v1/admin/onboarding/applications",
        {
          headers: { Authorization: `Bearer ${await managementToken()}` },
        },
      ),
      env,
    );
    expect(
      (await readData<ApplicationList>(list)).applications[0],
    ).toMatchObject({
      countryCode: "MY",
      city: "Kuala Lumpur",
      marketId: "market-kl",
      marketName: "KL Market",
      stallNumber: "A12",
    });

    const approved = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await managementToken()}` },
        },
      ),
      env,
    );

    expect(approved.status).toBe(200);
    const approvedData = await readData<ApproveResult>(approved);
    expect(approvedData).toMatchObject({
      restaurantId: approvedData.ownerAccount!.restaurantId,
      marketId: "market-kl",
      stallNumber: "A12",
    });
    // Retrying placement approval must work even after the owner used the link.
    platformDb
      .raw()
      .prepare("UPDATE password_reset_tokens SET used_at_ms = ?")
      .run(Date.now());
    const retried = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await managementToken()}` },
        },
      ),
      env,
    );
    expect(await readData<ApproveResult>(retried)).toMatchObject({
      restaurantId: approvedData.ownerAccount!.restaurantId,
      marketId: "market-kl",
      stallNumber: "A12",
      status: "completed",
    });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM password_reset_tokens")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM restaurants")
        .get(),
    ).toEqual({ count: 1 });

    expect(
      platformDb
        .raw()
        .prepare(
          `SELECT restaurant_id, market_id, status, message, requested_at_ms
           FROM market_join_requests WHERE restaurant_id = ?`,
        )
        .get(approvedData.ownerAccount!.restaurantId),
    ).toMatchObject({
      restaurant_id: approvedData.ownerAccount!.restaurantId,
      market_id: "market-kl",
      status: "pending",
      message: "攤位 A12",
      requested_at_ms: expect.any(Number),
    });
    expect(
      platformDb
        .raw()
        .prepare(
          "SELECT COUNT(*) AS count FROM restaurant_market_memberships WHERE restaurant_id = ?",
        )
        .get(approvedData.ownerAccount!.restaurantId),
    ).toMatchObject({ count: 0 });
  });

  it("creates no market request or membership for an independent shop", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const createdData = await readData<CreatedApplication>(created);
    const approved = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await managementToken()}` },
        },
      ),
      env,
    );

    expect(approved.status).toBe(200);
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM market_join_requests")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM restaurant_market_memberships")
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("persists Taiwanese locale fields when provisioning a restaurant", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createApplicationBody(),
          countryCode: "TW",
          city: "台中市",
        }),
      }),
      env,
    );
    const createdData = await readData<CreatedApplication>(created);

    const approved = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await managementToken()}` },
        },
      ),
      env,
    );
    expect(approved.status).toBe(200);
    const approvedData = await readData<ApproveResult>(approved);
    const row = platformDb
      .raw()
      .prepare(
        `SELECT country_code, timezone, settings, city
         FROM restaurants WHERE id = ?`,
      )
      .get(approvedData.ownerAccount!.restaurantId);

    expect(row).toMatchObject({
      country_code: "TW",
      timezone: "Asia/Taipei",
      settings: JSON.stringify({ currency: "TWD" }),
      city: "台中市",
    });
  });

  it.each([null, "SG"])(
    "rejects stored country %s before provisioning writes",
    async (storedCountry) => {
      const db = createManagementDb();
      const platformDb = createPlatformDb();
      const env = createEnv(db, platformDb);
      const created = await app.fetch(
        new Request("https://management.test/api/v1/onboarding/applications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createApplicationBody()),
        }),
        env,
      );
      const createdData = await readData<CreatedApplication>(created);
      db.raw()
        .prepare(
          "UPDATE onboarding_applications SET country_code = ? WHERE id = ?",
        )
        .run(storedCountry, createdData.applicationId);

      const approved = await app.fetch(
        new Request(
          `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${await managementToken()}` },
          },
        ),
        env,
      );

      expect(approved.status).toBe(400);
      await expect(readError(approved)).resolves.toMatchObject({
        message: "Unsupported onboarding country",
      });
      expect(
        db.raw().prepare("SELECT COUNT(*) AS count FROM tenants").get(),
      ).toMatchObject({ count: 0 });
      expect(
        platformDb
          .raw()
          .prepare("SELECT COUNT(*) AS count FROM restaurants")
          .get(),
      ).toMatchObject({ count: 0 });
    },
  );

  it("accepts an application without address and preserves its selected city", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const { address, district, ...legacyBody } = createApplicationBody();
    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacyBody),
      }),
      env,
    );
    expect(created.status).toBe(202);
    const createdData = await readData<CreatedApplication>(created);
    const approved = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${await managementToken()}` },
        },
      ),
      env,
    );
    expect(approved.status).toBe(200);
    const approvedData = await readData<ApproveResult>(approved);
    const row = platformDb
      .raw()
      .prepare("SELECT address, district, city FROM restaurants WHERE id = ?")
      .get(approvedData.ownerAccount!.restaurantId) as {
      address: string;
      district: string;
      city: string;
    };
    expect(row.address).toMatch(/^Onboarding GPS /);
    expect(row.district).toMatch(/^onboarding-/);
    expect(row.city).toBe("Kuala Lumpur");
  });

  it("rotates an expired setup token and appends a credential delivery audit trail", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const adminToken = await managementToken();
    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const createdData = await readData<CreatedApplication>(created);
    const approveUrl = `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`;
    const approved = await app.fetch(
      new Request(approveUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env,
    );
    const approvedData = await readData<ApproveResult>(approved);
    const oldLink = approvedData.ownerAccount!.setupPasswordLink;
    const oldToken = tokenFromLink(oldLink);
    platformDb
      .raw()
      .prepare(
        "UPDATE password_reset_tokens SET expires_at_ms = ? WHERE token = ?",
      )
      .run(Date.now() - 1_000, oldToken);

    const repeated = await app.fetch(
      new Request(approveUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
      env,
    );
    expect(
      (await readData<ApproveResult>(repeated)).ownerAccount,
    ).toBeUndefined();

    const regenerated = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/setup-link`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      ),
      env,
    );
    expect(regenerated.status).toBe(200);
    const result = await readData<{
      ownerAccount: NonNullable<ApproveResult["ownerAccount"]>;
      credentialDelivery: NonNullable<ApproveResult["credentialDelivery"]>;
    }>(regenerated);
    expect(result.ownerAccount.setupPasswordLink).not.toBe(oldLink);
    expect(result.ownerAccount.setupPasswordExpiresAt).toBeTruthy();
    // The delivery row records the handoff, not the credential: no link, no
    // token, just who was told and when it lapses.
    expect(result.credentialDelivery).not.toHaveProperty("setupPasswordLink");
    expect(result.credentialDelivery.setupPasswordExpiresAt).toBe(
      result.ownerAccount.setupPasswordExpiresAt,
    );
    const oldRow = platformDb
      .raw()
      .prepare("SELECT used_at_ms FROM password_reset_tokens WHERE token = ?")
      .get(oldToken) as { used_at_ms: number };
    expect(oldRow.used_at_ms).toBeGreaterThan(0);
    const newRow = platformDb
      .raw()
      .prepare(
        "SELECT used_at_ms, expires_at_ms FROM password_reset_tokens WHERE token = ?",
      )
      .get(tokenFromLink(result.ownerAccount.setupPasswordLink)) as {
      used_at_ms: number | null;
      expires_at_ms: number;
    };
    expect(newRow.used_at_ms).toBeNull();
    expect(newRow.expires_at_ms).toBeGreaterThan(Date.now());
    expect(
      db
        .raw()
        .prepare(
          "SELECT COUNT(*) AS count FROM onboarding_credential_deliveries WHERE application_id = ?",
        )
        .get(createdData.applicationId),
    ).toMatchObject({ count: 2 });
    expect(
      db
        .raw()
        .prepare(
          "SELECT actor_id, created_at_ms FROM onboarding_application_audit_events WHERE application_id = ? AND event_type = 'setup_link_regenerated'",
        )
        .get(createdData.applicationId),
    ).toMatchObject({
      actor_id: MANAGEMENT_ADMIN_ID,
      created_at_ms: expect.any(Number),
    });
  });

  it("completes approval and records failed setup-link delivery when the email binding fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("Cloudflare email send failed");
    });
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb, {
      ONBOARDING_EMAIL_ENABLED: "true",
      ONBOARDING_EMAIL_FROM: "onboarding@makanmasak.com",
      ONBOARDING_NOTIFICATION_EMAIL: { send } as unknown as SendEmail,
    });
    const token = await managementToken();
    const created = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    expect(created.status).toBe(202);
    // With email on, the status link only goes out by email, so the id is
    // not in the response.
    const createdData = db
      .raw()
      .prepare("SELECT id AS applicationId FROM onboarding_applications")
      .get() as { applicationId: string };
    const approved = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createdData.applicationId}/approve`,
        { method: "POST", headers: { Authorization: `Bearer ${token}` } },
      ),
      env,
    );

    expect(approved.status).toBe(200);
    expect(
      db
        .raw()
        .prepare(
          "SELECT status, error_message FROM onboarding_credential_deliveries WHERE application_id = ?",
        )
        .get(createdData.applicationId),
    ).toMatchObject({
      status: "failed",
      error_message: "Cloudflare email send failed",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: createApplicationBody().contactEmail,
        from: "onboarding@makanmasak.com",
      }),
    );
  });

  it("rate limits concurrent application submissions from one Cloudflare IP", async () => {
    const db = createManagementDb();
    const env = createEnv(db);
    const submit = (index: number) =>
      app.fetch(
        new Request("https://management.test/api/v1/onboarding/applications", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "cf-connecting-ip": "203.0.113.9",
          },
          body: JSON.stringify({
            ...createApplicationBody(),
            contactEmail: `rate-limit-${index}@example.com`,
          }),
        }),
        env,
      );

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) => submit(index)),
    );

    expect(
      responses.filter((response) => response.status === 202),
    ).toHaveLength(5);
    const rejected = responses.find((response) => response.status === 429);
    expect(rejected).toBeDefined();
    await expect(readError(rejected!)).resolves.toMatchObject({
      code: "RATE_LIMITED",
    });
  });

  it("does not expose the legacy public subdomain check endpoint", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);

    const response = await app.fetch(
      new Request(
        "https://management.test/api/v1/onboarding/subdomain/check?subdomain=workflow-laksa",
      ),
      env,
    );

    expect(response.status).not.toBe(200);
  });

  it("creates an application with an auto-generated subdomain and reads it back", async () => {
    const db = createManagementDb();
    const env = createEnv(db);

    const createResponse = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:3004",
          "User-Agent": "onboarding-workflow-test",
        },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );

    expect(createResponse.status).toBe(202);
    const createJson = await readData<CreatedApplication>(createResponse);
    expect(createJson).toMatchObject({
      status: "received",
    });
    expect(createJson.assignedSubdomain).toMatch(/^workflow-laksa-/);
    expect(typeof createJson.applicationId).toBe("string");
    expect(typeof createJson.applicationSecret).toBe("string");

    const getResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/onboarding/applications/${createJson.applicationId}`,
        {
          headers: {
            "X-Onboarding-Secret": createJson.applicationSecret,
          },
        },
      ),
      env,
    );

    expect(getResponse.status).toBe(200);
    const getJson = await readData<PublicApplication>(getResponse);
    expect(getJson).toMatchObject({
      id: createJson.applicationId,
      businessName: "Workflow Laksa",
      contactName: "Tan Mei",
      contactEmail: "tan.mei@example.com",
      address: "12 Jalan Tun Sambanthan, Brickfields",
      district: "Brickfields",
      city: "Kuala Lumpur",
      latitude: 24.147736,
      longitude: 120.673648,
      planId: "standard",
      assignedSubdomain: createJson.assignedSubdomain,
      status: "submitted",
    });
    expect(getJson.cfApiTokenEnc).toBeUndefined();
  });

  it("rejects invalid application payloads with onboarding-app compatible errors", async () => {
    const db = createManagementDb();
    const env = createEnv(db);

    const response = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createApplicationBody(),
          contactEmail: "not-an-email",
          latitude: 200,
        }),
      }),
      env,
    );

    expect(response.status).toBe(400);
    const error = await readError(response);
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(typeof error.message).toBe("string");
    expect(Array.isArray(error.details)).toBe(true);
    expect(error.details as unknown[]).not.toHaveLength(0);
  });

  it("lets platform admins list, approve, and reject onboarding applications", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const token = await managementToken();

    const createApprovedCandidate = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const approvedCandidateJson = await readData<CreatedApplication>(
      createApprovedCandidate,
    );
    const approvedCandidateId = approvedCandidateJson.applicationId;
    const approvedSubdomain = approvedCandidateJson.assignedSubdomain;

    const createRejectedCandidate = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A second pending application for one email is refused (409).
        body: JSON.stringify({
          ...createApplicationBody(),
          contactEmail: "rejected.candidate@example.com",
        }),
      }),
      env,
    );
    const rejectedCandidateJson = await readData<CreatedApplication>(
      createRejectedCandidate,
    );
    const rejectedCandidateId = rejectedCandidateJson.applicationId;
    const rejectedSubdomain = rejectedCandidateJson.assignedSubdomain;

    const listResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/admin/onboarding/applications?limit=10",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    expect(listResponse.status).toBe(200);
    const listJson = await readData<ApplicationList>(listResponse);
    expect(listJson.total).toBe(2);
    expect(listJson.applications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approvedCandidateId,
          status: "submitted",
          assignedSubdomain: approvedSubdomain,
        }),
        expect.objectContaining({
          id: rejectedCandidateId,
          status: "submitted",
          assignedSubdomain: rejectedSubdomain,
        }),
      ]),
    );
    expect(listJson.applications[0].cfApiTokenEnc).toBeUndefined();

    const approveResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${approvedCandidateId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    expect(approveResponse.status).toBe(200);
    const approveJson = await readData<ApproveResult>(approveResponse);
    const { ownerAccount, credentialDelivery } = approveJson;
    if (!ownerAccount || !credentialDelivery) {
      throw new Error(
        `approve returned no owner account: ${JSON.stringify(approveJson)}`,
      );
    }
    expect(approveJson).toMatchObject({
      status: "completed",
      subdomain: approvedSubdomain,
      ownerAccount: {
        username: "tan-mei",
      },
    });
    expect(
      db
        .raw()
        .prepare(
          `SELECT event_type, actor_id, actor_email
           FROM onboarding_application_audit_events
           WHERE application_id = ? ORDER BY created_at_ms, id`,
        )
        .all(approvedCandidateId),
    ).toEqual([
      {
        event_type: "submitted",
        actor_id: null,
        actor_email: null,
      },
      {
        event_type: "approved",
        actor_id: MANAGEMENT_ADMIN_ID,
        actor_email: "workflow-admin@example.test",
      },
    ]);
    // The owner logs in through apps/api, whose login schema only accepts this
    // pattern (USERNAME_REGEX in features/authentication/schemas/validation.ts).
    // A contact email of "tan.mei@…" used to yield "tan.mei", which login
    // rejects before it ever checks the password.
    expect(ownerAccount.username).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(typeof approveJson.tenantId).toBe("string");
    expect(typeof ownerAccount.restaurantId).toBe("string");
    expect(typeof ownerAccount.userId).toBe("string");
    // The link is what an operator hands over; the bare token is not part of
    // the response at all.
    expect(ownerAccount.setupPasswordLink).toBe(
      `http://localhost:3004/reset-password?token=${tokenFromLink(
        ownerAccount.setupPasswordLink,
      )}`,
    );
    expect("setupPasswordToken" in ownerAccount).toBe(false);
    expect("initialPassword" in ownerAccount).toBe(false);
    expect(credentialDelivery).toMatchObject({
      channel: "manual",
      status: "pending",
      recipientEmail: "tan.mei@example.com",
      recipientName: "Tan Mei",
    });
    expect(credentialDelivery).not.toHaveProperty("setupPasswordLink");
    expect(credentialDelivery.setupPasswordExpiresAt).toBe(
      ownerAccount.setupPasswordExpiresAt,
    );

    const tenantRow = db
      .raw()
      .prepare(
        `SELECT status, platform_restaurant_id, owner_user_id, owner_username
         FROM tenants WHERE id = ?`,
      )
      .get(approveJson.tenantId);
    expect(tenantRow).toMatchObject({
      status: "active",
      platform_restaurant_id: ownerAccount.restaurantId,
      owner_user_id: ownerAccount.userId,
      owner_username: "tan-mei",
    });

    const restaurantRow = platformDb
      .raw()
      .prepare(
        `SELECT id, name, email, country_code, timezone, settings,
                is_available, is_active
         FROM restaurants WHERE id = ?`,
      )
      .get(ownerAccount.restaurantId);
    expect(restaurantRow).toMatchObject({
      id: ownerAccount.restaurantId,
      name: "Workflow Laksa",
      email: "tan.mei@example.com",
      country_code: "MY",
      timezone: "Asia/Kuala_Lumpur",
      settings: JSON.stringify({ currency: "MYR" }),
      is_available: 0,
      is_active: 1,
    });

    const userRow = platformDb
      .raw()
      .prepare(
        `SELECT id, username, email, full_name, password_hash, role,
                restaurant_id, is_active
         FROM users WHERE id = ?`,
      )
      .get(ownerAccount.userId) as {
      password_hash: string;
    } & Record<string, unknown>;
    expect(userRow).toMatchObject({
      id: ownerAccount.userId,
      username: "tan-mei",
      email: "tan.mei@example.com",
      full_name: "Tan Mei",
      role: 1,
      restaurant_id: ownerAccount.restaurantId,
      is_active: 1,
    });
    await expect(
      bcrypt.compare("Mkm-ABCDEF-GHIJKL!", userRow.password_hash),
    ).resolves.toBe(false);

    const resetTokenRow = platformDb
      .raw()
      .prepare(
        `SELECT user_id, token, token_type, expires_at_ms, used_at_ms
         FROM password_reset_tokens WHERE user_id = ?`,
      )
      .get(ownerAccount.userId);
    expect(resetTokenRow).toMatchObject({
      user_id: ownerAccount.userId,
      token: tokenFromLink(ownerAccount.setupPasswordLink),
      token_type: "email",
      used_at_ms: null,
    });

    // Regression: without this row apps/api moduleGate throws
    // forbidden(SUBSCRIPTION_NOT_FOUND) for the freshly-onboarded owner on every
    // module-gated endpoint. planId "standard" maps to the "basic" tier, matching
    // the management-side row written by TenantService.
    const platformSubscriptionRow = platformDb
      .raw()
      .prepare(
        `SELECT restaurant_id, plan_tier, module_overrides, is_active,
                trial_ends_at_ms, billing_cycle_start_at_ms
         FROM shop_subscriptions WHERE restaurant_id = ?`,
      )
      .get(ownerAccount.restaurantId);
    expect(platformSubscriptionRow).toMatchObject({
      restaurant_id: ownerAccount.restaurantId,
      plan_tier: "basic",
      module_overrides: "{}",
      is_active: 1,
      trial_ends_at_ms: null,
    });
    expect(
      (platformSubscriptionRow as { billing_cycle_start_at_ms: number })
        .billing_cycle_start_at_ms,
    ).toEqual(expect.any(Number));

    const deliveryRow = db
      .raw()
      .prepare(
        `SELECT application_id, tenant_id, restaurant_id, user_id,
                recipient_email, recipient_name, username,
                setup_password_expires_at_ms, delivery_channel, status,
                created_at_ms
         FROM onboarding_credential_deliveries
         WHERE application_id = ?`,
      )
      .get(approvedCandidateId);
    expect(deliveryRow).toMatchObject({
      application_id: approvedCandidateId,
      tenant_id: approveJson.tenantId,
      restaurant_id: ownerAccount.restaurantId,
      user_id: ownerAccount.userId,
      recipient_email: "tan.mei@example.com",
      recipient_name: "Tan Mei",
      username: "tan-mei",
      setup_password_expires_at_ms: Date.parse(
        ownerAccount.setupPasswordExpiresAt,
      ),
      delivery_channel: "manual",
      status: "pending",
      created_at_ms: expect.any(Number),
    });
    // A stored link would be a live credential sitting in the control plane.
    expect(
      db
        .raw()
        .prepare("SELECT * FROM onboarding_credential_deliveries LIMIT 1")
        .get(),
    ).not.toHaveProperty("setup_password_link");

    const onboardingRestaurant = platformDb
      .raw()
      .prepare("SELECT address, district, city FROM restaurants WHERE id = ?")
      .get(ownerAccount.restaurantId);
    expect(onboardingRestaurant).toMatchObject({
      address: "12 Jalan Tun Sambanthan, Brickfields",
      district: "Brickfields",
      city: "Kuala Lumpur",
    });

    const missingReason = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${rejectedCandidateId}/reject`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );
    expect(missingReason.status).toBe(400);
    await expect(readError(missingReason)).resolves.toMatchObject({
      code: "VALIDATION_ERROR",
    });

    const rejectResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${rejectedCandidateId}/reject`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: "Service area is not supported yet" }),
        },
      ),
      env,
    );

    expect(rejectResponse.status).toBe(200);
    await expect(rejectResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        status: "rejected",
        rejectionReason: "Service area is not supported yet",
      },
    });
    const repeatReject = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${rejectedCandidateId}/reject`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: "A different reason" }),
        },
      ),
      env,
    );
    expect(repeatReject.status).toBe(400);
    const rejectedStatusResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/onboarding/applications/${rejectedCandidateId}`,
        {
          headers: {
            "X-Onboarding-Secret": rejectedCandidateJson.applicationSecret,
          },
        },
      ),
      env,
    );
    await expect(
      readData<PublicApplication>(rejectedStatusResponse),
    ).resolves.toMatchObject({
      status: "rejected",
      rejectionReason: "Service area is not supported yet",
    });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM users WHERE id <> ?")
        .get(MANAGEMENT_ADMIN_ID),
    ).toMatchObject({ count: 1 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM restaurants")
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it("provisions and links tenants for platform restaurants through the internal API", async () => {
    const db = createManagementDb();
    const env = createEnv(db);

    const provisionResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/internal/platform-restaurants/restaurant-jp-1/tenant",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-API-Token": "internal-token",
          },
          body: JSON.stringify({
            businessName: "日式料理",
            contactEmail: "owner@example.test",
            contactPhone: "0912345678",
            planId: "trial",
          }),
        },
      ),
      env,
    );

    expect(provisionResponse.status).toBe(201);
    const provisionJson = await readData<ProvisionedTenant>(provisionResponse);
    expect(provisionJson.tenant).toMatchObject({
      businessName: "日式料理",
      contactEmail: "owner@example.test",
      status: "active",
      platformRestaurantId: "restaurant-jp-1",
    });

    const tenantRow = db
      .raw()
      .prepare(
        `SELECT id, status, platform_restaurant_id, owner_user_id, owner_username
         FROM tenants WHERE platform_restaurant_id = ?`,
      )
      .get("restaurant-jp-1");
    expect(tenantRow).toMatchObject({
      id: provisionJson.tenant.id,
      status: "active",
      platform_restaurant_id: "restaurant-jp-1",
      owner_user_id: null,
      owner_username: null,
    });

    expect(
      db
        .raw()
        .prepare(
          `SELECT restaurant_id, plan_tier, is_active
           FROM shop_subscriptions WHERE restaurant_id = ?`,
        )
        .get(provisionJson.tenant.id),
    ).toMatchObject({
      restaurant_id: provisionJson.tenant.id,
      plan_tier: "trial",
      is_active: 1,
    });

    const retryResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/internal/platform-restaurants/restaurant-jp-1/tenant",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-API-Token": "internal-token",
          },
          body: JSON.stringify({
            businessName: "日式料理",
            contactEmail: "owner@example.test",
            contactPhone: "0912345678",
            planId: "trial",
          }),
        },
      ),
      env,
    );
    const retryJson = await readData<ProvisionedTenant>(retryResponse);
    expect(retryResponse.status).toBe(201);
    expect(retryJson.tenant.id).toBe(provisionJson.tenant.id);
    expect(
      db.raw().prepare("SELECT COUNT(*) AS count FROM tenants").get(),
    ).toMatchObject({ count: 1 });
    expect(
      db
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM shop_subscriptions")
        .get(),
    ).toMatchObject({ count: 1 });

    const linkResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/internal/platform-restaurants/restaurant-jp-1/owner",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-API-Token": "internal-token",
          },
          body: JSON.stringify({
            ownerUserId: "owner-jp-1",
            ownerUsername: "sushi-owner",
          }),
        },
      ),
      env,
    );

    expect(linkResponse.status).toBe(200);
    await expect(linkResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        tenant: {
          id: provisionJson.tenant.id,
          ownerUserId: "owner-jp-1",
          ownerUsername: "sushi-owner",
        },
      },
    });
    expect(
      db
        .raw()
        .prepare(
          `SELECT owner_user_id, owner_username
           FROM tenants WHERE platform_restaurant_id = ?`,
        )
        .get("restaurant-jp-1"),
    ).toMatchObject({
      owner_user_id: "owner-jp-1",
      owner_username: "sushi-owner",
    });
  });

  it("keeps approve idempotent after completion without creating duplicate platform records", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const token = await managementToken();

    const createResponse = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const createJson = await readData<CreatedApplication>(createResponse);
    const approveUrl = `https://management.test/api/v1/admin/onboarding/applications/${createJson.applicationId}/approve`;

    const firstApprove = await app.fetch(
      new Request(approveUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    const firstJson = await readData<ApproveResult>(firstApprove);
    const firstOwnerAccount = firstJson.ownerAccount;
    if (!firstOwnerAccount) {
      throw new Error(
        `approve returned no owner account: ${JSON.stringify(firstJson)}`,
      );
    }

    const secondApprove = await app.fetch(
      new Request(approveUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
    );
    const secondJson = await readEnvelope<ApproveResult>(secondApprove);

    expect(secondApprove.status).toBe(200);
    expect(secondJson.data).toMatchObject({
      status: "completed",
      tenantId: firstJson.tenantId,
      ownerAccount: {
        userId: firstOwnerAccount.userId,
        restaurantId: firstOwnerAccount.restaurantId,
        username: firstOwnerAccount.username,
        setupPasswordLink: firstOwnerAccount.setupPasswordLink,
      },
      credentialDelivery: {
        status: "pending",
        channel: "manual",
      },
    });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM users WHERE id <> ?")
        .get(MANAGEMENT_ADMIN_ID),
    ).toMatchObject({ count: 1 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM restaurants")
        .get(),
    ).toMatchObject({ count: 1 });
    expect(
      db.raw().prepare("SELECT COUNT(*) AS count FROM tenants").get(),
    ).toMatchObject({ count: 1 });
    expect(
      db
        .raw()
        .prepare(
          "SELECT COUNT(*) AS count FROM onboarding_credential_deliveries",
        )
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it("rolls back a market request on failure and creates it once on retry", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    platformDb
      .raw()
      .prepare(
        `INSERT INTO markets (
        id, slug, name, type, city, district, address, latitude, longitude,
        created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "market-retry",
        "market-retry",
        "Retry Market",
        "night_market",
        "Kuala Lumpur",
        "Brickfields",
        "Retry Road",
        3.1,
        101.7,
        Date.now(),
        Date.now(),
      );
    platformDb.raw().prepare("DROP TABLE password_reset_tokens").run();
    const env = createEnv(db, platformDb);
    const token = await managementToken();

    const createResponse = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createApplicationBody(),
          marketId: "market-retry",
          stallNumber: "R8",
        }),
      }),
      env,
    );
    const createJson = await readData<CreatedApplication>(createResponse);

    const approveResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createJson.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    expect(approveResponse.status).toBe(400);
    expect(
      db.raw().prepare("SELECT status FROM onboarding_applications").get(),
    ).toMatchObject({ status: "submitted" });
    expect(
      db.raw().prepare("SELECT COUNT(*) AS count FROM tenants").get(),
    ).toMatchObject({ count: 0 });
    expect(
      db
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM shop_subscriptions")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM users WHERE id <> ?")
        .get(MANAGEMENT_ADMIN_ID),
    ).toMatchObject({ count: 0 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM restaurants")
        .get(),
    ).toMatchObject({ count: 0 });
    expect(
      platformDb
        .raw()
        .prepare("SELECT COUNT(*) AS count FROM market_join_requests")
        .get(),
    ).toMatchObject({ count: 0 });

    platformDb.raw().exec(`
      CREATE TABLE password_reset_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        token_type TEXT NOT NULL DEFAULT 'email',
        otp_code TEXT,
        expires_at_ms INTEGER NOT NULL,
        used_at_ms INTEGER,
        ip_address TEXT,
        user_agent TEXT,
        created_at_ms INTEGER NOT NULL
      );
    `);
    const retryResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createJson.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    expect(retryResponse.status).toBe(200);
    expect(
      platformDb
        .raw()
        .prepare(
          `SELECT COUNT(*) AS count FROM market_join_requests
           WHERE market_id = 'market-retry' AND status = 'pending'`,
        )
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it("does not let applicants complete applications without platform approval", async () => {
    const db = createManagementDb();
    const env = createEnv(db);

    const createResponse = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const createJson = await readData<CreatedApplication>(createResponse);

    const completeResponse = await app.fetch(
      new Request(
        `https://management.test/api/v1/onboarding/applications/${createJson.applicationId}/complete`,
        {
          method: "POST",
          headers: { "X-Onboarding-Secret": createJson.applicationSecret },
        },
      ),
      env,
    );

    // No public completion route exists — 404 (was 401 via catch-all auth
    // before auth middleware was scoped to known protected prefixes).
    expect(completeResponse.status).toBe(404);
    const tenantCount = db
      .raw()
      .prepare("SELECT COUNT(*) AS count FROM tenants")
      .get();
    expect(tenantCount).toMatchObject({ count: 0 });
  });

  it("rejects completed applications from admin rejection", async () => {
    const db = createManagementDb();
    const env = createEnv(db);
    const token = await managementToken();

    const createResponse = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );
    const createJson = await readData<CreatedApplication>(createResponse);

    await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createJson.applicationId}/approve`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    const response = await app.fetch(
      new Request(
        `https://management.test/api/v1/admin/onboarding/applications/${createJson.applicationId}/reject`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason: "Already approved" }),
        },
      ),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "INVALID_STATUS",
      },
    });
  });
});

type OperatorCreateResult = {
  application: PublicApplication;
  approval: ApproveResult | null;
  approvalError?: { code: string; message: string };
};

describe("Operator-created applications — real integration", () => {
  const operatorUrl =
    "https://management.test/api/v1/admin/onboarding/applications";

  async function operatorCreate(
    env: ManagementEnv,
    body: Record<string, unknown>,
    token?: string,
  ) {
    return app.fetch(
      new Request(operatorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token ?? (await managementToken())}`,
        },
        body: JSON.stringify(body),
      }),
      env,
    );
  }

  function count(db: D1DatabaseAdapter, table: string) {
    return (
      db.raw().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      }
    ).count;
  }

  it("creates without approving, records the operator, and sends no notifications", async () => {
    const db = createManagementDb();
    const env = createEnv(db, createPlatformDb(), {
      SLACK_WEBHOOK_URL: "https://hooks.slack.test/x",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await operatorCreate(env, {
      ...createApplicationBody(),
      approveImmediately: false,
    });

    expect(response.status).toBe(201);
    const data = await readData<OperatorCreateResult>(response);
    expect(data.approval).toBeNull();
    expect(data.approvalError).toBeUndefined();
    expect(data.application).toMatchObject({
      status: "submitted",
      contactEmail: "tan.mei@example.com",
    });
    expect(data.application).not.toHaveProperty("applicationSecret");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(count(db, "onboarding_application_rate_limits")).toBe(0);
    expect(
      db
        .raw()
        .prepare(
          `SELECT event_type, actor_id, actor_email, metadata
           FROM onboarding_application_audit_events WHERE application_id = ?`,
        )
        .get(data.application.id),
    ).toEqual({
      event_type: "submitted",
      actor_id: MANAGEMENT_ADMIN_ID,
      actor_email: "workflow-admin@example.test",
      metadata: JSON.stringify({ source: "operator" }),
    });
  });

  it("creates and approves in one call, returning the approve payload", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);

    const response = await operatorCreate(env, createApplicationBody());

    expect(response.status).toBe(201);
    const data = await readData<OperatorCreateResult>(response);
    expect(data.application.status).toBe("completed");
    expect(data.approval).toMatchObject({
      status: "completed",
      tenantId: expect.any(String),
      restaurantId: expect.any(String),
      ownerAccount: { setupPasswordLink: expect.any(String) },
      credentialDelivery: { channel: "manual" },
    });
    expect(data.approval?.ownerAccount).not.toHaveProperty(
      "setupPasswordToken",
    );
    expect(count(platformDb, "restaurants")).toBe(1);
  });

  it("keeps the application submitted and reports approvalError when approval fails", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    platformDb
      .raw()
      .prepare(
        `INSERT INTO policies
         (id, scope_type, scope_id, policy_key, value, created_at_ms, updated_at_ms)
         VALUES ('my-plans', 'country', 'MY', 'plans.allowed_tiers', '["pro"]', 0, 0)`,
      )
      .run();

    const response = await operatorCreate(env, createApplicationBody());

    expect(response.status).toBe(201);
    const data = await readData<OperatorCreateResult>(response);
    expect(data.approval).toBeNull();
    expect(data.approvalError).toMatchObject({
      code: "PLAN_NOT_AVAILABLE_IN_REGION",
    });
    expect(data.application.status).toBe("submitted");
    expect(count(db, "tenants")).toBe(0);
    expect(count(platformDb, "restaurants")).toBe(0);
  });

  it("rejects a second pending application for the same email without revealing it publicly", async () => {
    const db = createManagementDb();
    const env = createEnv(db);
    await operatorCreate(env, {
      ...createApplicationBody(),
      approveImmediately: false,
    });

    const viaOperator = await operatorCreate(env, {
      ...createApplicationBody(),
      contactEmail: "TAN.MEI@example.com",
      approveImmediately: false,
    });
    const viaPublic = await app.fetch(
      new Request("https://management.test/api/v1/onboarding/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createApplicationBody()),
      }),
      env,
    );

    expect(viaOperator.status).toBe(409);
    await expect(readError(viaOperator)).resolves.toMatchObject({
      code: "APPLICATION_ALREADY_PENDING",
    });
    // A duplicate gets the generic body that, with email on (production), a
    // fresh submission gets too, so the route cannot probe for applications.
    expect(viaPublic.status).toBe(202);
    await expect(readData(viaPublic)).resolves.toEqual({ status: "received" });
    expect(count(db, "onboarding_applications")).toBe(1);
  });

  it("applies the public route's market validation", async () => {
    const env = createEnv(createManagementDb());

    const response = await operatorCreate(env, {
      ...createApplicationBody(),
      marketId: "missing-market",
    });

    expect(response.status).toBe(400);
    await expect(readError(response)).resolves.toMatchObject({
      code: "MARKET_NOT_FOUND",
    });
  });

  it("rejects a non-admin platform user", async () => {
    const platformDb = createPlatformDb();
    const env = createEnv(createManagementDb(), platformDb);
    const ownerId = "018f0000-0000-7000-8000-000000000002";
    platformDb
      .raw()
      .prepare(
        `INSERT INTO users (id, username, full_name, password_hash, role,
           is_active, token_version, created_at_ms, updated_at_ms)
         VALUES (?, 'owner', 'Owner', 'unused', 1, 1, 1, 0, 0)`,
      )
      .run(ownerId);
    platformDb
      .raw()
      .prepare(
        "INSERT INTO sessions (id, user_id, is_active, expires_at_ms) VALUES ('owner-session', ?, 1, ?)",
      )
      .run(ownerId, Date.now() + 3600000);
    const ownerToken = await sign(
      {
        id: ownerId,
        email: "owner@example.test",
        role: "admin",
        tv: 1,
        sid: "owner-session",
        aud: "management",
        iss: "makanmakan-management",
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "test-secret",
      "HS256",
    );

    const response = await operatorCreate(
      env,
      createApplicationBody(),
      ownerToken,
    );

    expect(response.status).toBe(401);
    expect(
      count(
        env.MANAGEMENT_DB as unknown as D1DatabaseAdapter,
        "onboarding_applications",
      ),
    ).toBe(0);
  });

  it("lets only one of two concurrent approvals provision", async () => {
    const db = createManagementDb();
    const platformDb = createPlatformDb();
    const env = createEnv(db, platformDb);
    const created = await readData<OperatorCreateResult>(
      await operatorCreate(env, {
        ...createApplicationBody(),
        approveImmediately: false,
      }),
    );
    const id = created.application.id;
    // The loser read the row while it was still submitted, then the winner
    // claimed it: a stale snapshot is exactly what the CAS must defeat.
    db.raw()
      .prepare(
        "UPDATE onboarding_applications SET status = 'provisioning' WHERE id = ?",
      )
      .run(id);
    const { OnboardingService } =
      await import("../../services/OnboardingService");
    const stale = vi
      .spyOn(OnboardingService.prototype, "getApplication")
      .mockResolvedValue({ ...created.application, status: "submitted" });
    const token = await managementToken();
    const post = (action: string, body?: unknown) =>
      app.fetch(
        new Request(`${operatorUrl}/${id}/${action}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
      );

    const approve = await post("approve");
    const reject = await post("reject", { reason: "too late" });
    stale.mockRestore();

    for (const response of [approve, reject]) {
      expect(response.status).toBe(400);
      await expect(readError(response)).resolves.toMatchObject({
        code: "INVALID_STATUS",
        message: "Application is already being processed",
      });
    }
    expect(count(db, "tenants")).toBe(0);
    expect(count(platformDb, "restaurants")).toBe(0);
    expect(
      db
        .raw()
        .prepare("SELECT status FROM onboarding_applications WHERE id = ?")
        .get(id),
    ).toEqual({ status: "provisioning" });
  });

  describe("purge (撤銷代建)", () => {
    // The hand-written platform schema has no orders table; purge counts
    // orders, so these tests add the minimal shape it reads.
    function withOrdersTable(platformDb: D1DatabaseAdapter) {
      platformDb
        .raw()
        .exec(
          "CREATE TABLE orders (id TEXT PRIMARY KEY NOT NULL, restaurant_id TEXT NOT NULL REFERENCES restaurants(id))",
        );
      return platformDb;
    }

    async function purge(env: ManagementEnv, id: string) {
      return app.fetch(
        new Request(`${operatorUrl}/${id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${await managementToken()}` },
        }),
        env,
      );
    }

    async function createApproved(env: ManagementEnv) {
      const data = await readData<OperatorCreateResult>(
        await operatorCreate(env, createApplicationBody()),
      );
      expect(data.application.status).toBe("completed");
      return data;
    }

    // The platform DB seeds an admin user, so owners are counted by role.
    function owners(platformDb: D1DatabaseAdapter) {
      return (
        platformDb
          .raw()
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 1")
          .get() as { count: number }
      ).count;
    }

    const platformTables = [
      "restaurants",
      "shop_subscriptions",
      "password_reset_tokens",
      "market_join_requests",
    ];
    const managementTables = [
      "onboarding_applications",
      "tenants",
      "shop_subscriptions",
      "onboarding_credential_deliveries",
    ];

    it("removes everything approval provisioned and keeps the audit trail", async () => {
      const db = createManagementDb();
      const platformDb = withOrdersTable(createPlatformDb());
      const env = createEnv(db, platformDb);
      const created = await createApproved(env);

      const response = await purge(env, created.application.id);

      expect(response.status).toBe(200);
      for (const table of platformTables) {
        expect(count(platformDb, table), `platform ${table}`).toBe(0);
      }
      expect(owners(platformDb)).toBe(0);
      for (const table of managementTables) {
        expect(count(db, table), `management ${table}`).toBe(0);
      }
      const events = db
        .raw()
        .prepare(
          `SELECT event_type, actor_id FROM onboarding_application_audit_events
           WHERE application_id = ? ORDER BY created_at_ms, rowid`,
        )
        .all(created.application.id);
      expect(events).toEqual([
        { event_type: "submitted", actor_id: MANAGEMENT_ADMIN_ID },
        { event_type: "approved", actor_id: MANAGEMENT_ADMIN_ID },
        { event_type: "purged", actor_id: MANAGEMENT_ADMIN_ID },
      ]);
    });

    it("purges a submitted application that was never provisioned", async () => {
      const db = createManagementDb();
      const env = createEnv(db, withOrdersTable(createPlatformDb()));
      const created = await readData<OperatorCreateResult>(
        await operatorCreate(env, {
          ...createApplicationBody(),
          approveImmediately: false,
        }),
      );

      expect((await purge(env, created.application.id)).status).toBe(200);
      expect(count(db, "onboarding_applications")).toBe(0);
    });

    it("refuses once the restaurant has orders and deletes nothing", async () => {
      const db = createManagementDb();
      const platformDb = withOrdersTable(createPlatformDb());
      const env = createEnv(db, platformDb);
      const created = await createApproved(env);
      platformDb
        .raw()
        .prepare("INSERT INTO orders (id, restaurant_id) VALUES (?, ?)")
        .run("order-1", created.approval!.restaurantId);

      const response = await purge(env, created.application.id);

      expect(response.status).toBe(409);
      await expect(readError(response)).resolves.toMatchObject({
        code: "RESTAURANT_HAS_ORDERS",
      });
      expect(count(platformDb, "restaurants")).toBe(1);
      expect(owners(platformDb)).toBe(1);
      expect(count(db, "tenants")).toBe(1);
      expect(count(db, "onboarding_applications")).toBe(1);
    });

    it("leaves the restaurant whole when other rows still reference it", async () => {
      const db = createManagementDb();
      const platformDb = withOrdersTable(createPlatformDb());
      const env = createEnv(db, platformDb);
      const created = await createApproved(env);
      platformDb
        .raw()
        .exec(
          "CREATE TABLE menu_items (id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL REFERENCES restaurants(id))",
        );
      platformDb
        .raw()
        .prepare("INSERT INTO menu_items (id, restaurant_id) VALUES (?, ?)")
        .run("item-1", created.approval!.restaurantId);

      const response = await purge(env, created.application.id);

      expect(response.status).toBe(409);
      await expect(readError(response)).resolves.toMatchObject({
        code: "RESTAURANT_IN_USE",
      });
      // One batch: the owner and subscription survive with the restaurant.
      expect(count(platformDb, "restaurants")).toBe(1);
      expect(owners(platformDb)).toBe(1);
      expect(count(platformDb, "shop_subscriptions")).toBe(1);
      expect(count(db, "onboarding_applications")).toBe(1);
    });

    it("returns 404 for an unknown application", async () => {
      const env = createEnv(createManagementDb());
      expect((await purge(env, "missing")).status).toBe(404);
    });
  });
});
