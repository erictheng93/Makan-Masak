import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import app from "../index";
import { applicationSchema } from "../routes/onboarding";
import type { ManagementEnv } from "../types";

const onboardingMocks = vi.hoisted(() => ({
  consumeApplicationRateLimit: vi.fn(async () => true),
  createApplication: vi.fn(),
  notifyPlatformOfNewApplication: vi.fn(async () => undefined),
  sendApplicationReceivedEmail: vi.fn(async () => undefined),
}));

vi.mock("../services/OnboardingService", () => ({
  OnboardingService: vi.fn(function OnboardingService() {
    return onboardingMocks;
  }),
}));

const base = {
  businessName: "Test Stall",
  contactName: "Tan Mei",
  contactEmail: "owner@example.test",
  contactPhone: "0123456789",
  address: "1 Jalan Test",
  district: "Brickfields",
  latitude: 3.134,
  longitude: 101.686,
};

function createPlatformDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE markets (
      id TEXT PRIMARY KEY,
      city TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      deleted_at_ms INTEGER
    );
    INSERT INTO markets VALUES
      ('active-kl', 'Kuala Lumpur', 1, NULL),
      ('inactive-kl', 'Kuala Lumpur', 0, NULL),
      ('deleted-kl', 'Kuala Lumpur', 1, 1),
      ('active-penang', 'Penang', 1, NULL);
  `);
  return new D1DatabaseAdapter(sqlite);
}

function createEnv(): ManagementEnv {
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

async function submit(overrides: Record<string, unknown>) {
  return app.fetch(
    new Request("https://management.test/api/v1/onboarding/applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...base,
        countryCode: "MY",
        city: "Kuala Lumpur",
        ...overrides,
      }),
    }),
    createEnv(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  onboardingMocks.createApplication.mockResolvedValue({
    id: "app-1",
    applicationSecret: "secret",
    assignedSubdomain: "test-stall",
    status: "submitted",
  });
});

describe("applicationSchema country and city", () => {
  it("requires a supported country and a city in that country", () => {
    expect(
      applicationSchema.safeParse({ ...base, city: "台中市" }).success,
    ).toBe(false);
    expect(
      applicationSchema.safeParse({
        ...base,
        countryCode: "VN",
        city: "Hà Nội",
      }).success,
    ).toBe(false);
    const mismatch = applicationSchema.safeParse({
      ...base,
      countryCode: "MY",
      city: "台中市",
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success)
      expect(mismatch.error.issues[0]?.path).toEqual(["city"]);
  });

  it("normalizes a lowercase supported country", () => {
    const result = applicationSchema.safeParse({
      ...base,
      countryCode: "tw",
      city: "台中市",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe("TW");
  });
});

describe("onboarding application locale and market route", () => {
  it("returns CITY_NOT_IN_COUNTRY without creating an application", async () => {
    const response = await submit({ city: "台中市" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "CITY_NOT_IN_COUNTRY" },
    });
    expect(onboardingMocks.createApplication).not.toHaveBeenCalled();
  });

  it.each(["missing", "inactive-kl", "deleted-kl"])(
    "rejects unavailable market %s without creating an application",
    async (marketId) => {
      const response = await submit({ marketId });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "MARKET_NOT_FOUND" },
      });
      expect(onboardingMocks.createApplication).not.toHaveBeenCalled();
    },
  );

  it("rejects a market in another city without creating an application", async () => {
    const response = await submit({ marketId: "active-penang" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MARKET_NOT_IN_CITY" },
    });
    expect(onboardingMocks.createApplication).not.toHaveBeenCalled();
  });

  it("persists only validated locale and market input", async () => {
    const response = await submit({
      countryCode: "my",
      marketId: "active-kl",
      stallNumber: "A-12",
      currency: "USD",
      timezone: "UTC",
    });
    expect(response.status).toBe(201);
    expect(onboardingMocks.createApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        countryCode: "MY",
        city: "Kuala Lumpur",
        marketId: "active-kl",
        stallNumber: "A-12",
      }),
      expect.any(Object),
    );
    const input = onboardingMocks.createApplication.mock.calls[0]?.[0];
    expect(input).not.toHaveProperty("currency");
    expect(input).not.toHaveProperty("timezone");
  });
});
