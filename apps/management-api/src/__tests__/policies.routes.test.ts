import Database from "better-sqlite3";
import { sign } from "hono/jwt";
import { describe, expect, it, vi } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import app from "../index";
import type { ManagementEnv } from "../types";

function createEnv(
  options: { unknownRestaurants?: number; seedSql?: string } = {},
) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
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
    CREATE UNIQUE INDEX policies_scope_key_idx
      ON policies (scope_type, scope_id, policy_key);
    CREATE TABLE markets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country_code TEXT,
      platform_fee_rate_bps INTEGER NOT NULL DEFAULT 0,
      deleted_at_ms INTEGER
    );
    CREATE TABLE restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country_code TEXT,
      deleted_at_ms INTEGER
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, on_behalf_of_user_id TEXT, restaurant_id TEXT,
      action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT,
      description TEXT NOT NULL, changes TEXT, ip_address TEXT,
      user_agent TEXT, success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT, execution_time_ms INTEGER,
      created_at_ms INTEGER NOT NULL
    );
    INSERT INTO markets (id, name, city, country_code, platform_fee_rate_bps)
      VALUES ('m-tw', '逢甲夜市', '台中市', 'TW', 900),
             ('m-my', 'Jalan Alor', 'Kuala Lumpur', 'MY', 0);
    INSERT INTO restaurants (id, name, country_code) VALUES ('r1', 'Known', 'TW');
  `);
  for (let i = 0; i < (options.unknownRestaurants ?? 0); i += 1) {
    sqlite
      .prepare(
        "INSERT INTO restaurants (id, name, country_code) VALUES (?, ?, NULL)",
      )
      .run(`unknown-${i}`, `Unknown ${i}`);
  }
  if (options.seedSql) sqlite.exec(options.seedSql);

  const kv = { delete: vi.fn(async () => {}) };
  const env: ManagementEnv = {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "http://localhost:3010",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: {} as D1Database,
    PLATFORM_DB: new D1DatabaseAdapter(sqlite) as unknown as D1Database,
    CACHE_KV: kv as unknown as KVNamespace,
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
  };
  return { env, kv, sqlite };
}

async function token() {
  return sign(
    {
      id: "admin-1",
      email: "admin@example.test",
      role: "admin",
      aud: "management",
      iss: "makanmakan-management",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "test-secret",
    "HS256",
  );
}

async function call(
  env: ManagementEnv,
  method: string,
  path: string,
  body?: unknown,
) {
  return app.fetch(
    new Request(`https://management.test/api/v1/admin/policies${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const lastAudit = (sqlite: Database.Database) => {
  const row = sqlite
    .prepare(
      "SELECT action, resource, resource_id, changes FROM audit_logs ORDER BY id DESC",
    )
    .get() as {
    action: string;
    resource: string;
    resource_id: string;
    changes: string;
  };
  return { ...row, changes: JSON.parse(row.changes) };
};

describe("admin policy routes", () => {
  it("requires a management token", async () => {
    const { env } = createEnv();
    const res = await app.fetch(
      new Request("https://management.test/api/v1/admin/policies/registry"),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("serves the registry", async () => {
    const { env } = createEnv();
    const body = (await (await call(env, "GET", "/registry")).json()) as {
      data: { definitions: { key: string }[] };
    };
    expect(body.data.definitions.map((d) => d.key)).toContain(
      "modules.disabled",
    );
  });

  it("sets a policy, audits it and clears the scope cache", async () => {
    const { env, kv, sqlite } = createEnv();
    const res = await call(env, "PUT", "/country/MY/modules.disabled", {
      value: ["pos"],
    });

    expect(res.status).toBe(200);
    expect(
      sqlite.prepare("SELECT value, updated_by FROM policies").get(),
    ).toEqual({
      value: '["pos"]',
      updated_by: "admin@example.test",
    });
    expect(lastAudit(sqlite)).toMatchObject({
      action: "system_config",
      resource: "policies",
      resource_id: "country:MY:modules.disabled",
      changes: { after: { value: ["pos"] }, metadata: { adminId: "admin-1" } },
    });
    expect(kv.delete).toHaveBeenCalledWith("policy:v1:country:MY");
  });

  it("updates in place and records the previous value", async () => {
    const { env, sqlite } = createEnv();
    await call(env, "PUT", "/country/MY/modules.disabled", { value: ["pos"] });
    await call(env, "PUT", "/country/MY/modules.disabled", { value: [] });

    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM policies").get()).toEqual({
      n: 1,
    });
    expect(lastAudit(sqlite).changes).toMatchObject({
      before: { value: ["pos"] },
      after: { value: [] },
    });
  });

  it.each([
    [
      "/country/SG/modules.disabled",
      { value: [] },
      400,
      "POLICY_SCOPE_INVALID",
    ],
    [
      "/market/nope/payments.allowed_providers",
      { value: [] },
      404,
      "POLICY_SCOPE_NOT_FOUND",
    ],
    ["/country/MY/nope", { value: 1 }, 404, "POLICY_KEY_UNKNOWN"],
    [
      "/market/m-my/modules.disabled",
      { value: ["pos"] },
      400,
      "POLICY_SCOPE_NOT_ALLOWED",
    ],
    [
      "/country/MY/plans.allowed_tiers",
      { value: ["trial"] },
      400,
      "POLICY_VALUE_INVALID",
    ],
    [
      "/country/MY/modules.disabled",
      { value: ["pos", "pos"] },
      400,
      "POLICY_VALUE_INVALID",
    ],
  ])("rejects PUT %s", async (path, body, status, code) => {
    const { env, kv } = createEnv();
    const res = await call(env, "PUT", path, body);
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: { code } });
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("allows payment providers at market scope", async () => {
    const { env, kv } = createEnv();
    const res = await call(
      env,
      "PUT",
      "/market/m-my/payments.allowed_providers",
      {
        value: ["tng"],
      },
    );
    expect(res.status).toBe(200);
    expect(kv.delete).toHaveBeenCalledWith("policy:v1:market:m-my");
  });

  describe("unknown-country gate", () => {
    it("blocks a country ceiling while shops have no country", async () => {
      const { env, sqlite } = createEnv({ unknownRestaurants: 2 });
      const res = await call(env, "PUT", "/country/MY/modules.disabled", {
        value: ["pos"],
      });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
          details: {
            count: 2,
            restaurants: [
              expect.objectContaining({ id: "unknown-0" }),
              expect.objectContaining({ id: "unknown-1" }),
            ],
          },
        },
      });
      expect(
        sqlite.prepare("SELECT COUNT(*) AS n FROM policies").get(),
      ).toEqual({ n: 0 });
    });

    it("accepts an acknowledgment that matches the current count", async () => {
      const { env, sqlite } = createEnv({ unknownRestaurants: 2 });
      const res = await call(env, "PUT", "/country/MY/modules.disabled", {
        value: ["pos"],
        acknowledgeRestaurantsWithoutCountry: 2,
      });
      expect(res.status).toBe(200);
      expect(lastAudit(sqlite).changes).toMatchObject({
        metadata: { acknowledgedRestaurantsWithoutCountry: 2 },
      });
    });

    it("re-counts when a new shop appears after the admin saw the count", async () => {
      const { env, sqlite } = createEnv({ unknownRestaurants: 2 });
      const listing = await call(env, "GET", "?scope_type=country&scope_id=MY");
      await expect(listing.json()).resolves.toMatchObject({
        data: { restaurantsWithoutCountry: 2 },
      });

      sqlite
        .prepare(
          "INSERT INTO restaurants (id, name, country_code) VALUES (?, ?, NULL)",
        )
        .run("unknown-2", "Unknown 2");

      const res = await call(
        env,
        "PUT",
        "/country/MY/payments.allowed_providers",
        {
          value: ["tng"],
          acknowledgeRestaurantsWithoutCountry: 2,
        },
      );
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
          details: { count: 3 },
        },
      });
    });

    it("does not gate defaults or market scopes", async () => {
      const { env } = createEnv({ unknownRestaurants: 1 });
      expect(
        (
          await call(env, "PUT", "/country/MY/pricing.default_tax_rate_bps", {
            value: 600,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await call(env, "PUT", "/market/m-my/payments.allowed_providers", {
            value: ["tng"],
          })
        ).status,
      ).toBe(200);
    });
  });

  describe("fee cap gate", () => {
    it("refuses a cap below an existing market's fee", async () => {
      const { env } = createEnv();
      const res = await call(
        env,
        "PUT",
        "/country/TW/platform.max_fee_rate_bps",
        {
          value: 800,
        },
      );
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "POLICY_CAP_BELOW_EXISTING_MARKET_FEES",
          details: { markets: [expect.objectContaining({ id: "m-tw" })] },
        },
      });
    });

    it("refuses any cap while a fee-charging market has no country", async () => {
      const { env } = createEnv({
        seedSql: `INSERT INTO markets (id, name, city, country_code, platform_fee_rate_bps)
                  VALUES ('m-null', 'Mystery', 'Taichung', NULL, 100);`,
      });
      const res = await call(
        env,
        "PUT",
        "/country/MY/platform.max_fee_rate_bps",
        {
          value: 5000,
        },
      );
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          details: {
            marketsWithoutCountry: [expect.objectContaining({ id: "m-null" })],
          },
        },
      });
    });

    it("accepts a cap that covers every market", async () => {
      const { env } = createEnv();
      const res = await call(
        env,
        "PUT",
        "/country/TW/platform.max_fee_rate_bps",
        {
          value: 900,
        },
      );
      expect(res.status).toBe(200);
    });
  });

  it("lists a country's policies with the unknown-country count", async () => {
    const { env } = createEnv({ unknownRestaurants: 1 });
    await call(env, "PUT", "/country/MY/pricing.default_tax_rate_bps", {
      value: 600,
    });
    // Hono mounts a child route's "/" at the exact mount path (without a
    // trailing slash).
    const res = await call(env, "GET", "?scope_type=country&scope_id=MY");
    await expect(res.json()).resolves.toMatchObject({
      data: {
        scopeType: "country",
        scopeId: "MY",
        policies: { "pricing.default_tax_rate_bps": { value: 600 } },
        restaurantsWithoutCountry: 1,
      },
    });
  });

  it("deletes a policy idempotently", async () => {
    const { env, kv, sqlite } = createEnv();
    await call(env, "PUT", "/country/MY/modules.disabled", { value: ["pos"] });
    const first = await call(env, "DELETE", "/country/MY/modules.disabled");
    const second = await call(env, "DELETE", "/country/MY/modules.disabled");

    await expect(first.json()).resolves.toMatchObject({
      data: { deleted: true },
    });
    await expect(second.json()).resolves.toMatchObject({
      data: { deleted: false },
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM policies").get()).toEqual({
      n: 0,
    });
    expect(kv.delete).toHaveBeenCalledTimes(2); // PUT + first DELETE
  });

  it("rejects deletion of an unknown policy key", async () => {
    const { env, kv } = createEnv();
    const res = await call(env, "DELETE", "/country/MY/nope");

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "POLICY_KEY_UNKNOWN" },
    });
    expect(kv.delete).not.toHaveBeenCalled();
  });
});
