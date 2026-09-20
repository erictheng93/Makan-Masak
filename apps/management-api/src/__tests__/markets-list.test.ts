import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import app from "../index";
import { marketsRouter } from "../routes/markets";
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
    INSERT INTO markets VALUES
      ('m-1', 'fengjia', '逢甲夜市', 'night_market', '台中市', '西屯區', 1, NULL),
      ('m-2', 'kl-night', 'KL Night Market', 'night_market', 'Kuala Lumpur', 'Bukit Bintang', 1, NULL),
      ('m-3', 'kl-day', 'KL Day Market', 'day_market', 'Kuala Lumpur', 'Chow Kit', 1, NULL),
      ('m-4', 'penang', 'Penang Market', 'night_market', 'Penang', 'George Town', 1, NULL),
      ('m-5', 'inactive', 'Inactive Market', 'night_market', 'Kuala Lumpur', 'Sentul', 0, NULL),
      ('m-6', 'deleted', 'Deleted Market', 'night_market', 'Kuala Lumpur', 'Cheras', 1, 1);
  `);
  return new D1DatabaseAdapter(sqlite);
}

function routeEnv(platformDb = createPlatformDb()) {
  return { PLATFORM_DB: platformDb as unknown as D1Database };
}

function appEnv(): ManagementEnv {
  return {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "*",
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

describe("GET /markets", () => {
  it("returns active, non-deleted markets filtered by country, city, and type", async () => {
    const response = await marketsRouter.request(
      "/?country=MY&city=Kuala%20Lumpur&type=night_market",
      {},
      routeEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        markets: [
          {
            id: "m-2",
            slug: "kl-night",
            name: "KL Night Market",
            type: "night_market",
            city: "Kuala Lumpur",
            district: "Bukit Bintang",
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    });
  });

  it("returns the total before pagination", async () => {
    const response = await marketsRouter.request(
      "/?country=MY&city=Kuala%20Lumpur&page=2&limit=1",
      {},
      routeEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        markets: [{ id: "m-2" }],
        total: 2,
        page: 2,
        limit: 1,
      },
    });
  });

  it("rejects an unsupported country or a city outside that country", async () => {
    for (const [query, code] of [
      ["country=VN", "UNSUPPORTED_COUNTRY"],
      ["country=MY&city=台中市", "CITY_NOT_IN_COUNTRY"],
    ]) {
      const response = await app.fetch(
        new Request(`https://management.test/api/v1/markets?${query}`),
        appEnv(),
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    }
  });

  it.each([
    ["page=abc&limit=Infinity", 1, 50],
    ["page=-2&limit=0", 1, 1],
    ["page=2.9&limit=1000", 1, 100],
    ["page=2oops&limit=10oops", 1, 50],
  ])("bounds malformed pagination: %s", async (query, page, limit) => {
    const response = await marketsRouter.request(
      `/?country=MY&${query}`,
      {},
      routeEnv(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { page, limit },
    });
  });

  it("clamps the page before its SQL offset can exceed a safe integer", async () => {
    const response = await marketsRouter.request(
      `/?page=${Number.MAX_SAFE_INTEGER}&limit=100`,
      {},
      routeEnv(),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { page: number } };
    expect((body.data.page - 1) * 100).toBeLessThanOrEqual(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("is publicly available through the app while admin market routes stay protected", async () => {
    const publicResponse = await app.fetch(
      new Request(
        "https://management.test/api/v1/markets?country=MY&city=Kuala%20Lumpur",
      ),
      appEnv(),
    );
    expect(publicResponse.status).toBe(200);

    const adminResponse = await app.fetch(
      new Request("https://management.test/api/v1/admin/markets/join-requests"),
      appEnv(),
    );
    expect(adminResponse.status).toBe(401);
  });
});
