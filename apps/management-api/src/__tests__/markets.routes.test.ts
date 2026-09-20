import Database from "better-sqlite3";
import { sign } from "hono/jwt";
import { describe, expect, it } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import app from "../index";
import type { ManagementEnv } from "../types";

function createPlatformDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE markets (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      city TEXT NOT NULL,
      district TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      deleted_at_ms INTEGER
    );
  `);
  return new D1DatabaseAdapter(sqlite);
}

function createEnv(): ManagementEnv {
  return {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "http://localhost:3010",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: {} as D1Database,
    PLATFORM_DB: createPlatformDb() as unknown as D1Database,
    CACHE_KV: {} as KVNamespace,
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
  };
}

async function managementToken() {
  return sign(
    {
      id: "workflow-admin",
      email: "workflow-admin@example.test",
      role: "admin",
      aud: "management",
      iss: "makanmakan-management",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "test-secret",
    "HS256",
  );
}

async function managementTokenWithoutRole() {
  return sign(
    {
      id: "workflow-admin",
      email: "workflow-admin@example.test",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "test-secret",
    "HS256",
  );
}

describe("management market routes", () => {
  it("serves portal market list and join request reads", async () => {
    const env = createEnv();
    const token = await managementToken();

    const marketsResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/markets?city=台中市&limit=50",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    expect(marketsResponse.status).toBe(200);
    await expect(marketsResponse.json()).resolves.toMatchObject({
      success: true,
      data: {
        markets: [],
        total: 0,
        page: 1,
        limit: 50,
      },
    });

    const joinRequestsResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/admin/markets/join-requests?status=pending",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      env,
    );

    expect(joinRequestsResponse.status).toBe(200);
    await expect(joinRequestsResponse.json()).resolves.toMatchObject({
      success: true,
      data: { requests: [] },
    });
  });

  it("keeps market administration reads protected", async () => {
    const response = await app.fetch(
      new Request("https://management.test/api/v1/admin/markets/join-requests"),
      createEnv(),
    );

    expect(response.status).toBe(401);
  });

  it("keeps tenant health reads and reports protected", async () => {
    let response = await app.fetch(
      new Request("https://management.test/api/v1/health/tenants"),
      createEnv(),
    );

    expect(response.status).toBe(401);

    response = await app.fetch(
      new Request("https://management.test/api/v1/health/report", {
        method: "POST",
        body: JSON.stringify({ tenantId: "tenant-1", status: "healthy" }),
        headers: { "Content-Type": "application/json" },
      }),
      createEnv(),
    );

    expect(response.status).toBe(401);
  });

  it("rejects management tokens without explicit platform admin claims", async () => {
    const token = await managementTokenWithoutRole();

    const response = await app.fetch(
      new Request(
        "https://management.test/api/v1/admin/markets/join-requests",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
      createEnv(),
    );

    expect(response.status).toBe(401);
  });

  it("does not reflect arbitrary origins when credentialed CORS is enabled", async () => {
    const response = await app.fetch(
      new Request("https://management.test/health", {
        headers: { Origin: "https://evil.example" },
      }),
      createEnv(),
    );

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
