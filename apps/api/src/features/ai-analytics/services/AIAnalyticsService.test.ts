import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  testProvider: vi.fn(),
  getDefaultModel: vi.fn((p: string) => `default-${p}`),
  getAvailableModels: vi.fn(() => ["m1"]),
  generateReport: vi.fn(),
  productAnalysis: {
    getTrafficDrivers: vi.fn(),
    getBestsellers: vi.fn(),
    getProfitLeaders: vi.fn(),
    analyzeProducts: vi.fn(),
  },
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  createDatabase: vi.fn(),
}));

vi.mock("@makanmasak/ai-analytics", () => ({
  AIInsightsService: vi.fn(function () {
    return { generateReport: mocks.generateReport };
  }),
  ProductAnalysisService: vi.fn(function () {
    return mocks.productAnalysis;
  }),
  testProvider: mocks.testProvider,
  getDefaultModel: mocks.getDefaultModel,
  getAvailableModels: mocks.getAvailableModels,
}));
vi.mock("@makanmasak/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@makanmasak/utils")>()),
  encrypt: mocks.encrypt,
  decrypt: mocks.decrypt,
}));
vi.mock("@makanmasak/database", () => ({
  aiConfigurations: {
    restaurantId: "ai_configurations.restaurant_id",
    enabled: "ai_configurations.enabled",
  },
  aiUsageLogs: {
    restaurantId: "ai_usage_logs.restaurant_id",
    createdAt: "ai_usage_logs.created_at",
    provider: "provider",
    model: "model",
    operation: "operation",
    tokensUsed: "tokens_used",
    latencyMs: "latency_ms",
    success: "success",
  },
  createDatabase: mocks.createDatabase,
}));

import { AIAnalyticsService } from "./AIAnalyticsService";

/** Chainable, awaitable query stub that resolves to `rows`. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit", "groupBy", "orderBy"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = (resolve: (v: unknown) => void) => resolve(rows);
  return chain;
}

function buildDb() {
  const insertChain = {
    values: vi.fn(() => insertChain),
    onConflictDoUpdate: vi.fn(async () => undefined),
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  };
  return {
    select: vi.fn(),
    insert: vi.fn(() => insertChain),
    insertChain,
  };
}

const timeRange = { startDate: "2026-01-01", endDate: "2026-01-31" } as never;

describe("AIAnalyticsService", () => {
  let db: ReturnType<typeof buildDb>;
  let service: AIAnalyticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = buildDb();
    mocks.createDatabase.mockReturnValue(db);
    service = new AIAnalyticsService(
      {} as never,
      {
        key: "enc-key",
        requireStrongKey: true,
      } as never,
    );
  });

  describe("getConfig", () => {
    it("returns null when the shop has no configuration", async () => {
      db.select.mockReturnValue(selectChain([]));
      await expect(service.getConfig("rest-1")).resolves.toBeNull();
    });

    it("maps the row and defaults missing timestamps to empty strings", async () => {
      db.select.mockReturnValue(
        selectChain([
          {
            id: 1,
            restaurantId: "rest-1",
            provider: "openai",
            apiKeyEncrypted: "cipher",
            model: null,
            customBaseUrl: null,
            enabled: true,
            createdAt: null,
            updatedAt: "2026-01-01",
          },
        ]),
      );
      await expect(service.getConfig("rest-1")).resolves.toEqual({
        id: 1,
        restaurantId: "rest-1",
        provider: "openai",
        apiKeyEncrypted: "cipher",
        model: null,
        customBaseUrl: null,
        enabled: true,
        createdAt: "",
        updatedAt: "2026-01-01",
      });
    });
  });

  describe("getLLMConfig", () => {
    it("returns null when no enabled configuration exists", async () => {
      db.select.mockReturnValue(selectChain([]));
      await expect(service.getLLMConfig("rest-1")).resolves.toBeNull();
      expect(mocks.decrypt).not.toHaveBeenCalled();
    });

    it("decrypts the key and turns empty model/baseUrl into undefined", async () => {
      db.select.mockReturnValue(
        selectChain([
          {
            provider: "openai",
            apiKeyEncrypted: "cipher",
            model: "",
            customBaseUrl: "",
          },
        ]),
      );
      mocks.decrypt.mockResolvedValue("sk-plain");

      await expect(service.getLLMConfig("rest-1")).resolves.toEqual({
        provider: "openai",
        apiKey: "sk-plain",
        model: undefined,
        baseUrl: undefined,
      });
      expect(mocks.decrypt).toHaveBeenCalledWith(
        "cipher",
        "enc-key",
        expect.objectContaining({ requireStrongKey: true }),
      );
    });
  });

  describe("testProvider", () => {
    it("passes the provider result through", async () => {
      mocks.testProvider.mockResolvedValue({ success: true, latencyMs: 12 });
      await expect(
        service.testProvider({ provider: "openai", apiKey: "k" } as never),
      ).resolves.toEqual({ success: true, latencyMs: 12 });
    });

    it("converts a thrown Error into a failed result", async () => {
      mocks.testProvider.mockRejectedValue(new Error("network down"));
      await expect(
        service.testProvider({ provider: "openai", apiKey: "k" } as never),
      ).resolves.toEqual({ success: false, error: "network down" });
    });

    it("uses a generic message for a non-Error rejection", async () => {
      mocks.testProvider.mockRejectedValue("boom");
      await expect(
        service.testProvider({ provider: "openai", apiKey: "k" } as never),
      ).resolves.toEqual({ success: false, error: "Test failed" });
    });
  });

  describe("saveConfig", () => {
    const input = {
      restaurantId: "rest-1",
      provider: "openai",
      apiKey: "sk-plain",
      model: "",
      customBaseUrl: "",
    } as never;

    it("never persists a key the provider rejected", async () => {
      mocks.encrypt.mockResolvedValue("cipher");
      mocks.testProvider.mockResolvedValue({ success: false, error: "401" });

      await expect(service.saveConfig(input)).rejects.toThrow(
        "Provider test failed: 401",
      );
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("stores only the encrypted key after a successful provider test", async () => {
      mocks.encrypt.mockResolvedValue("cipher");
      mocks.testProvider.mockResolvedValue({ success: true });

      await service.saveConfig(input);

      expect(db.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: "rest-1",
          apiKeyEncrypted: "cipher",
          model: null,
          customBaseUrl: null,
          enabled: true,
        }),
      );
      expect(JSON.stringify(db.insertChain.values.mock.calls)).not.toContain(
        "sk-plain",
      );
      expect(db.insertChain.onConflictDoUpdate).toHaveBeenCalledOnce();
    });
  });

  describe("generateReport", () => {
    it("refuses with AI_PROVIDER_NOT_CONFIGURED when no provider is enabled", async () => {
      db.select.mockReturnValue(selectChain([]));
      await expect(
        service.generateReport("rest-1", timeRange),
      ).rejects.toMatchObject({ code: "AI_PROVIDER_NOT_CONFIGURED" });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("logs usage with the provider default model when none is configured", async () => {
      db.select.mockReturnValue(
        selectChain([
          {
            provider: "openai",
            apiKeyEncrypted: "cipher",
            model: null,
            customBaseUrl: null,
          },
        ]),
      );
      mocks.decrypt.mockResolvedValue("sk-plain");
      mocks.generateReport.mockResolvedValue({
        metadata: { tokensUsed: undefined, processingTimeMs: 55 },
      });

      const report = await service.generateReport("rest-1", timeRange, {
        refreshCache: true,
      });

      expect(report.metadata.processingTimeMs).toBe(55);
      expect(mocks.generateReport).toHaveBeenCalledWith(
        "rest-1",
        expect.objectContaining({ apiKey: "sk-plain" }),
        timeRange,
        { includeForecasting: undefined, refreshCache: true },
      );
      expect(db.insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: "rest-1",
          model: "default-openai",
          operation: "generate_report",
          tokensUsed: 0,
          latencyMs: 55,
          success: true,
        }),
      );
    });
  });

  describe("product analysis delegation", () => {
    it.each([
      ["getTrafficDrivers", "getTrafficDrivers"],
      ["getBestsellers", "getBestsellers"],
      ["getProfitLeaders", "getProfitLeaders"],
    ] as const)("%s defaults the limit to 10", async (method, target) => {
      mocks.productAnalysis[target].mockResolvedValue(["x"]);
      await expect(service[method]("rest-1", timeRange)).resolves.toEqual([
        "x",
      ]);
      expect(mocks.productAnalysis[target]).toHaveBeenCalledWith(
        "rest-1",
        timeRange,
        10,
      );
    });

    it("forwards an explicit limit and analyzeProducts", async () => {
      mocks.productAnalysis.getBestsellers.mockResolvedValue([]);
      await service.getBestsellers("rest-1", timeRange, 3);
      expect(mocks.productAnalysis.getBestsellers).toHaveBeenCalledWith(
        "rest-1",
        timeRange,
        3,
      );

      mocks.productAnalysis.analyzeProducts.mockResolvedValue(["a"]);
      await expect(
        service.analyzeProducts("rest-1", timeRange),
      ).resolves.toEqual(["a"]);
    });
  });

  describe("getUsageStats", () => {
    it("maps aggregate rows, with and without a date window", async () => {
      const row = {
        provider: "openai",
        model: "m",
        operation: "generate_report",
        requestCount: 2,
        totalTokens: 30,
        avgLatencyMs: 10,
        successfulRequests: 2,
      };
      const chain = selectChain([row]);
      db.select.mockReturnValue(chain);

      await expect(service.getUsageStats("rest-1")).resolves.toEqual([row]);
      await expect(
        service.getUsageStats("rest-1", "2026-01-01", "2026-01-31"),
      ).resolves.toEqual([row]);
      expect(chain.where).toHaveBeenCalledTimes(2);
    });
  });

  it("static helpers delegate to the package", () => {
    expect(AIAnalyticsService.getAvailableModels("openai")).toEqual(["m1"]);
    expect(AIAnalyticsService.getDefaultModel("openai")).toBe("default-openai");
  });
});
