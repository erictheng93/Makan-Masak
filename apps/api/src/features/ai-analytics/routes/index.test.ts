import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import routes from "./index";

const currentUser = vi.hoisted(() => ({
  value: {
    id: "user-42",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
}));
const serviceMethods = vi.hoisted(() => ({
  getConfig: vi.fn(),
  testProvider: vi.fn(),
  saveConfig: vi.fn(),
  generateReport: vi.fn(),
  getTrafficDrivers: vi.fn(),
  getBestsellers: vi.fn(),
  getProfitLeaders: vi.fn(),
  analyzeProducts: vi.fn(),
  getUsageStats: vi.fn(),
}));
const aiAnalyticsService = vi.hoisted(() => {
  const constructor = vi.fn(function AIAnalyticsService() {
    return serviceMethods;
  });
  Object.assign(constructor, {
    getAvailableModels: vi.fn((provider: string) => [`${provider}-model`]),
    getDefaultModel: vi.fn((provider: string) => `${provider}-default`),
  });
  return constructor;
});
const meterEmit = vi.hoisted(() => vi.fn());

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate:
    () =>
    async (
      c: {
        set: (key: "user", value: typeof currentUser.value) => void;
      },
      next: () => Promise<void>,
    ) => {
      c.set("user", currentUser.value);
      await next();
    },
}));

vi.mock("../../../middleware/quotaGate", () => ({
  quotaGate: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../../../shared/utils/meter", () => ({
  meterEmit,
}));

vi.mock("../services/AIAnalyticsService", () => ({
  AIAnalyticsService: aiAnalyticsService,
}));

function createEnv() {
  return { DB: {}, ENCRYPTION_KEY: "test-key" };
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("ai analytics routes", () => {
  beforeEach(() => {
    currentUser.value = {
      id: "user-42",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    aiAnalyticsService.mockClear();
    meterEmit.mockReset();
    for (const method of Object.values(serviceMethods)) {
      method.mockReset();
    }
  });

  it("returns masked AI configuration and emits usage metering", async () => {
    serviceMethods.getConfig.mockResolvedValue({
      id: 1,
      restaurantId: "restaurant-1",
      provider: "openai",
      apiKeyEncrypted: "secret-ciphertext",
      model: "gpt-test",
      enabled: true,
    });

    const response = await routes.fetch(
      new Request("https://test/config/restaurant-1"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      config: {
        restaurantId: "restaurant-1",
        provider: "openai",
        apiKeyEncrypted: "***",
      },
    });
    expect(serviceMethods.getConfig).toHaveBeenCalledWith("restaurant-1");
    // The route hands the service the key *and* the weak-key policy, so an
    // absent ENCRYPTION_KEY cannot silently derive a reproducible key (#300).
    // This env has no NODE_ENV, so the guard stays off — production-only.
    expect(aiAnalyticsService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ key: "test-key", requireStrongKey: false }),
    );
    expect(meterEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        req: expect.objectContaining({ path: "/config/restaurant-1" }),
      }),
      "ai.requests",
    );
  });

  it("arms the weak-key guard when the worker runs in production", async () => {
    serviceMethods.getConfig.mockResolvedValue(null);

    const response = await routes.fetch(
      new Request("https://test/config/restaurant-1"),
      { ...createEnv(), NODE_ENV: "production" } as never,
    );

    expect(response.status).toBe(200);
    expect(aiAnalyticsService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requireStrongKey: true }),
    );
  });

  it("returns provider choices when no AI configuration exists", async () => {
    serviceMethods.getConfig.mockResolvedValue(null);

    const response = await routes.fetch(
      new Request("https://test/config/restaurant-1"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      config: null,
      availableProviders: [
        "anthropic",
        "openai",
        "google",
        "deepseek",
        "custom",
      ],
    });
  });

  it("allows admins to read AI configuration", async () => {
    currentUser.value = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: "platform",
    };
    serviceMethods.getConfig.mockResolvedValue({
      id: 1,
      restaurantId: "restaurant-1",
      provider: "anthropic",
      apiKeyEncrypted: "secret-ciphertext",
      model: "claude-test",
      enabled: true,
    });

    const response = await routes.fetch(
      new Request("https://test/config/restaurant-1"),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      config: {
        restaurantId: "restaurant-1",
        provider: "anthropic",
        apiKeyEncrypted: "***",
      },
    });
  });

  it("rejects owner access to AI configuration for another restaurant", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/config/restaurant-2"),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(serviceMethods.getConfig).not.toHaveBeenCalled();
  });

  it("rejects protected AI configuration access for non-owner roles", async () => {
    currentUser.value = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "restaurant-1",
    };

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/config/restaurant-1"),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(serviceMethods.getConfig).not.toHaveBeenCalled();
  });

  it("saves AI configuration only after a successful provider test", async () => {
    serviceMethods.testProvider.mockResolvedValue({
      success: true,
      latencyMs: 123,
      model: "gpt-test",
    });
    serviceMethods.saveConfig.mockResolvedValue(undefined);

    const response = await routes.fetch(
      new Request("https://test/config", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          provider: "openai",
          apiKey: "sk-test-key",
          model: "gpt-test",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      testResult: { latency: 123, model: "gpt-test" },
    });
    expect(serviceMethods.testProvider).toHaveBeenCalledWith({
      provider: "openai",
      apiKey: "sk-test-key",
      model: "gpt-test",
      baseUrl: undefined,
    });
    expect(serviceMethods.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        provider: "openai",
      }),
    );
  });

  it("rejects owner AI configuration writes for another restaurant", async () => {
    serviceMethods.testProvider.mockResolvedValue({
      success: true,
      latencyMs: 123,
      model: "gpt-test",
    });

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/config", {
          method: "POST",
          body: JSON.stringify({
            restaurantId: "restaurant-2",
            provider: "openai",
            apiKey: "sk-test-key",
            model: "gpt-test",
          }),
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(serviceMethods.testProvider).not.toHaveBeenCalled();
    expect(serviceMethods.saveConfig).not.toHaveBeenCalled();
  });

  it("rejects invalid AI configuration and failed provider tests", async () => {
    const invalidResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/config", {
          method: "POST",
          body: JSON.stringify({
            restaurantId: "restaurant-1",
            provider: "openai",
            apiKey: "short",
          }),
        }),
        createEnv() as never,
      ),
    );
    expect(invalidResponse.status).toBe(500);
    expect(serviceMethods.testProvider).not.toHaveBeenCalled();

    serviceMethods.testProvider.mockResolvedValue({
      success: false,
      error: "invalid key",
    });
    const failedTestResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/config", {
          method: "POST",
          body: JSON.stringify({
            restaurantId: "restaurant-1",
            provider: "openai",
            apiKey: "sk-test-key",
          }),
        }),
        createEnv() as never,
      ),
    );

    expect(failedTestResponse.status).toBe(500);
    expect(serviceMethods.saveConfig).not.toHaveBeenCalled();
  });

  it("tests providers and lists provider models", async () => {
    serviceMethods.testProvider.mockResolvedValue({
      success: true,
      latencyMs: 50,
      model: "claude-test",
    });

    const testResponse = await routes.fetch(
      new Request("https://test/test-provider", {
        method: "POST",
        body: JSON.stringify({
          provider: "anthropic",
          apiKey: "anthropic-key",
          model: "claude-test",
        }),
      }),
      createEnv() as never,
    );
    expect(testResponse.status).toBe(200);
    expect(serviceMethods.testProvider).toHaveBeenCalledWith({
      provider: "anthropic",
      apiKey: "anthropic-key",
      model: "claude-test",
    });

    const modelsResponse = await routes.fetch(
      new Request("https://test/models/openai"),
      createEnv() as never,
    );
    expect(modelsResponse.status).toBe(200);
    await expect(modelsResponse.json()).resolves.toMatchObject({
      success: true,
      provider: "openai",
      models: ["openai-model"],
      defaultModel: "openai-default",
    });
  });

  it("generates AI analytics reports for owners", async () => {
    serviceMethods.generateReport.mockResolvedValue({
      summary: "sales improved",
    });

    const response = await routes.fetch(
      new Request("https://test/generate", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          timeRange: { range: "30d" },
          includeForecasting: true,
          refreshCache: true,
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      report: { summary: "sales improved" },
      cached: false,
    });
    expect(serviceMethods.generateReport).toHaveBeenCalledWith(
      "restaurant-1",
      { range: "30d" },
      { includeForecasting: true, refreshCache: true },
    );
  });

  it("rejects owner AI report generation for another restaurant", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/generate", {
          method: "POST",
          body: JSON.stringify({
            restaurantId: "restaurant-2",
            timeRange: { range: "30d" },
          }),
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(serviceMethods.generateReport).not.toHaveBeenCalled();
  });

  it("rejects AI report generation for non-owner roles", async () => {
    currentUser.value = {
      id: "user-42",
      username: "chef",
      role: 2,
      restaurantId: "restaurant-1",
    };

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/generate", {
          method: "POST",
          body: JSON.stringify({
            restaurantId: "restaurant-1",
            timeRange: { range: "30d" },
          }),
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(serviceMethods.generateReport).not.toHaveBeenCalled();
  });

  it("returns product analytics for each product endpoint", async () => {
    serviceMethods.getTrafficDrivers.mockResolvedValue([{ id: "traffic" }]);
    serviceMethods.getBestsellers.mockResolvedValue([{ id: "best" }]);
    serviceMethods.getProfitLeaders.mockResolvedValue([{ id: "profit" }]);
    serviceMethods.analyzeProducts.mockResolvedValue([{ id: "analysis" }]);

    const env = createEnv();
    const traffic = await routes.fetch(
      new Request(
        "https://test/products/traffic-drivers/restaurant-1?timeRange=7d&limit=3",
      ),
      env as never,
    );
    const best = await routes.fetch(
      new Request(
        "https://test/products/bestsellers/restaurant-1?timeRange=14d&limit=4",
      ),
      env as never,
    );
    const profit = await routes.fetch(
      new Request(
        "https://test/products/profit-leaders/restaurant-1?timeRange=90d&limit=5",
      ),
      env as never,
    );
    const analysis = await routes.fetch(
      new Request("https://test/products/analysis/restaurant-1?timeRange=180d"),
      env as never,
    );

    expect(traffic.status).toBe(200);
    expect(best.status).toBe(200);
    expect(profit.status).toBe(200);
    expect(analysis.status).toBe(200);
    expect(serviceMethods.getTrafficDrivers).toHaveBeenCalledWith(
      "restaurant-1",
      { range: "7d" },
      3,
    );
    expect(serviceMethods.getBestsellers).toHaveBeenCalledWith(
      "restaurant-1",
      { range: "14d" },
      4,
    );
    expect(serviceMethods.getProfitLeaders).toHaveBeenCalledWith(
      "restaurant-1",
      { range: "90d" },
      5,
    );
    expect(serviceMethods.analyzeProducts).toHaveBeenCalledWith(
      "restaurant-1",
      { range: "180d" },
    );
  });

  it("rejects owner product analytics for another restaurant", async () => {
    const env = createEnv();
    const traffic = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(
          "https://test/products/traffic-drivers/restaurant-2?timeRange=7d&limit=3",
        ),
        env as never,
      ),
    );
    const best = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(
          "https://test/products/bestsellers/restaurant-2?timeRange=14d&limit=4",
        ),
        env as never,
      ),
    );
    const profit = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(
          "https://test/products/profit-leaders/restaurant-2?timeRange=90d&limit=5",
        ),
        env as never,
      ),
    );
    const analysis = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(
          "https://test/products/analysis/restaurant-2?timeRange=180d",
        ),
        env as never,
      ),
    );

    expect(traffic.status).toBe(500);
    expect(best.status).toBe(500);
    expect(profit.status).toBe(500);
    expect(analysis.status).toBe(500);
    expect(serviceMethods.getTrafficDrivers).not.toHaveBeenCalled();
    expect(serviceMethods.getBestsellers).not.toHaveBeenCalled();
    expect(serviceMethods.getProfitLeaders).not.toHaveBeenCalled();
    expect(serviceMethods.analyzeProducts).not.toHaveBeenCalled();
  });

  it("returns AI usage statistics for a restaurant", async () => {
    serviceMethods.getUsageStats.mockResolvedValue({
      totalRequests: 5,
      totalTokens: 100,
    });

    const response = await routes.fetch(
      new Request(
        "https://test/usage/restaurant-1?startDate=2026-06-01&endDate=2026-06-07",
      ),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      usage: { totalRequests: 5, totalTokens: 100 },
    });
    expect(serviceMethods.getUsageStats).toHaveBeenCalledWith(
      "restaurant-1",
      "2026-06-01",
      "2026-06-07",
    );
  });

  it("rejects owner AI usage reads for another restaurant", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(
          "https://test/usage/restaurant-2?startDate=2026-06-01&endDate=2026-06-07",
        ),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(500);
    expect(serviceMethods.getUsageStats).not.toHaveBeenCalled();
  });
});
