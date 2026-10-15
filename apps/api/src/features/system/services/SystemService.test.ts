import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorReportItem } from "../types";

const errorReportingFns = vi.hoisted(() => ({
  createBulkErrorReports: vi.fn(),
  getErrorStats: vi.fn(),
  getCommonErrors: vi.fn(),
  cleanupOldErrorReports: vi.fn(),
}));

const databaseState = vi.hoisted(() => ({
  selectResult: [{ test: 1 }] as unknown[],
  selectReject: null as Error | null,
  createDatabase: vi.fn(),
}));

vi.mock("@makanmasak/database", () => {
  function createQuery(result: unknown[], rejection: Error | null) {
    const promise = rejection
      ? Promise.reject(rejection)
      : Promise.resolve(result);
    const query = {
      from: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return query;
  }

  return {
    ErrorReportingService: vi.fn(function ErrorReportingService() {
      return errorReportingFns;
    }),
    createDatabase: databaseState.createDatabase.mockImplementation(() => ({
      select: vi.fn(() =>
        createQuery(databaseState.selectResult, databaseState.selectReject),
      ),
    })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
      String.raw({ raw: strings }, ...values.map(String)),
    ),
  };
});

import { SystemService } from "./SystemService";

function createKv(initial: Record<string, unknown> = {}) {
  const values = new Map<string, string>(
    Object.entries(initial).map(([key, value]) => [
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    ]),
  );

  return {
    values,
    get: vi.fn(async (key: string, type?: "json") => {
      const value = values.get(key) ?? null;
      if (type === "json" && value !== null) {
        return JSON.parse(value);
      }
      return value;
    }),
    put: vi.fn(
      async (
        key: string,
        value: string,
        _options?: { expirationTtl?: number },
      ) => {
        values.set(key, value);
      },
    ),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix?: string } = {}) => ({
      keys: Array.from(values.keys())
        .filter((key) => !prefix || key.startsWith(prefix))
        .map((name) => ({ name })),
    })),
  };
}

function createService(
  envOverrides: Record<string, unknown> = {},
  kv = createKv(),
) {
  const env = {
    DB: {},
    CACHE_KV: kv,
    SLACK_WEBHOOK_URL: undefined,
    ...envOverrides,
  };

  return {
    service: new SystemService(
      env.DB as never,
      env as never,
      env.CACHE_KV as never,
    ),
    env,
    kv,
  };
}

function createError(
  overrides: Partial<ErrorReportItem> = {},
): ErrorReportItem {
  return {
    type: "api",
    severity: "medium",
    message: "Request failed",
    context: { route: "/orders" },
    timestamp: "2026-06-07T00:00:00.000Z",
    url: "https://app.example.test/orders",
    ...overrides,
  };
}

describe("SystemService", () => {
  // Several tests drive failing dependencies on purpose; the service and the
  // cache layer log each one. afterEach's restoreAllMocks puts console back.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
    vi.clearAllMocks();
    databaseState.selectResult = [{ test: 1 }];
    databaseState.selectReject = null;
    errorReportingFns.createBulkErrorReports.mockResolvedValue(undefined);
    errorReportingFns.getErrorStats.mockResolvedValue({
      totalErrors: 5,
      uniqueUsers: 2,
      errorsByType: { api: 3, network: 2 },
      errorTrend: [{ date: "2026-06-07", count: 5 }],
    });
    errorReportingFns.getCommonErrors.mockResolvedValue([
      {
        errorMessage: "Request failed",
        count: 4,
        latestOccurrence: "2026-06-07T11:00:00.000Z",
      },
    ]);
    errorReportingFns.cleanupOldErrorReports.mockResolvedValue(7);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const expectErrorLogged = (text: string) =>
    expect(
      errorSpy.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes(text),
      ),
    ).toBe(true);

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("creates error reports, notifies on significant errors, and returns counts", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    const { service } = createService({
      SLACK_WEBHOOK_URL: "https://slack.example.test/hook",
    });

    const response = await service.createErrorReport(
      {
        errors: [
          createError({ severity: "low", code: 400 }),
          createError({
            severity: "critical",
            type: "network",
            message: "Socket closed",
            userAgent: "browser-agent",
          }),
        ],
      },
      "user-42",
      "restaurant-1",
      "route-agent",
    );

    expect(response).toEqual({
      success: true,
      message: "Successfully received 2 error reports",
      data: {
        total_errors: 2,
        significant_errors: 1,
        report_id: String(new Date("2026-06-07T12:00:00.000Z").getTime()),
      },
    });
    expect(errorReportingFns.createBulkErrorReports).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: "user-42",
        restaurantId: "restaurant-1",
        errorType: "api",
        severity: "low",
        errorCode: "400",
        userAgent: "route-agent",
        timestamp: new Date("2026-06-07T00:00:00.000Z"),
      }),
      expect.objectContaining({
        errorType: "network",
        severity: "critical",
        errorMessage: "Socket closed",
        userAgent: "browser-agent",
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.example.test/hook",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("Socket closed"),
      }),
    );
  });

  it("wraps create error report failures without sending notifications", async () => {
    errorReportingFns.createBulkErrorReports.mockRejectedValue(
      new Error("db unavailable"),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { service } = createService({
      SLACK_WEBHOOK_URL: "https://slack.example.test/hook",
    });

    await expect(
      service.createErrorReport(
        { errors: [createError({ severity: "critical" })] },
        "user-42",
        null,
      ),
    ).rejects.toThrow("Failed to submit error report");
    expect(fetchMock).not.toHaveBeenCalled();
    expectErrorLogged("Failed to create error report");
  });

  it("returns cached health without running dependency checks", async () => {
    const cached = {
      success: true,
      status: "healthy",
      timestamp: "cached",
      checks: {
        database: { status: "healthy", latency: "N/A" },
        cache: { status: "healthy", latency: "N/A" },
        memory: { status: "healthy", usage: "N/A" },
      },
      version: "1.0.0",
      uptime: "N/A",
    };
    const { service, kv } = createService(
      {},
      createKv({ "system:health": cached }),
    );

    await expect(service.getSystemHealth()).resolves.toEqual(cached);
    expect(kv.get).toHaveBeenCalledWith("system:health", "json");
    expect(databaseState.createDatabase).not.toHaveBeenCalled();
  });

  it("computes and caches healthy and degraded system health", async () => {
    const { service, kv } = createService();

    await expect(service.getSystemHealth()).resolves.toMatchObject({
      success: true,
      status: "healthy",
      checks: {
        database: { status: "healthy" },
        cache: { status: "healthy" },
        memory: { status: "healthy" },
      },
    });
    expect(kv.put).toHaveBeenCalledWith(
      "system:health",
      expect.stringContaining('"status":"healthy"'),
      { expirationTtl: expect.any(Number) },
    );

    const failingKv = createKv();
    failingKv.get.mockRejectedValue(new Error("kv unavailable"));
    databaseState.selectReject = new Error("db unavailable");
    const degraded = await createService(
      {},
      failingKv,
    ).service.getSystemHealth();

    expect(degraded).toMatchObject({
      success: true,
      status: "degraded",
      checks: {
        database: { status: "unhealthy" },
        cache: { status: "unhealthy" },
      },
    });
    expectErrorLogged("system:health");
  });

  it("maps and caches error statistics", async () => {
    const { service, kv } = createService();

    const stats = await service.getErrorStats("restaurant-1");

    expect(stats).toEqual({
      summary: {
        total_errors_24h: 5,
        unique_users_affected: 2,
        error_rate: 0,
      },
      stats_24h: [
        { error_type: "api", error_count: 3 },
        { error_type: "network", error_count: 2 },
      ],
      weekly_trend: [{ date: "2026-06-07", count: 5 }],
      common_errors: [
        {
          id: 1,
          message: "Request failed",
          count: 4,
          lastOccurred: "2026-06-07T11:00:00.000Z",
        },
      ],
    });
    expect(errorReportingFns.getErrorStats).toHaveBeenCalledWith(
      "restaurant-1",
      [
        new Date("2026-06-06T12:00:00.000Z"),
        new Date("2026-06-07T12:00:00.000Z"),
      ],
    );
    expect(errorReportingFns.getCommonErrors).toHaveBeenCalledWith(
      "restaurant-1",
      10,
    );
    expect(kv.put).toHaveBeenCalledWith(
      "system:error-stats:restaurant-1",
      expect.stringContaining('"total_errors_24h":5'),
      { expirationTtl: expect.any(Number) },
    );
  });

  it("returns cached stats and wraps stats lookup failures", async () => {
    const cached = {
      summary: { total_errors_24h: 1, unique_users_affected: 1, error_rate: 0 },
      stats_24h: [],
      weekly_trend: [],
      common_errors: [],
    };
    await expect(
      createService(
        {},
        createKv({ "system:error-stats:all": cached }),
      ).service.getErrorStats(),
    ).resolves.toEqual(cached);
    expect(errorReportingFns.getErrorStats).not.toHaveBeenCalled();

    errorReportingFns.getErrorStats.mockRejectedValue(new Error("db down"));
    await expect(createService().service.getErrorStats()).rejects.toThrow(
      "Failed to get error statistics",
    );
    expectErrorLogged("Failed to get error statistics");
  });

  it("cleans old reports and clears related caches", async () => {
    const kv = createKv({
      "system:error-stats:all": { cached: true },
      "other:key": { cached: true },
    });
    const { service } = createService({}, kv);

    await expect(service.cleanupOldErrorReports(45)).resolves.toEqual({
      success: true,
      message: "Cleaned up 7 old error reports",
      data: { deleted_count: 7 },
    });
    expect(errorReportingFns.cleanupOldErrorReports).toHaveBeenCalledWith(45);
    expect(kv.list).toHaveBeenCalledWith({
      prefix: "system:error-stats:",
      cursor: undefined,
    });
    expect(kv.delete).toHaveBeenCalledWith("system:error-stats:all");
  });

  it("swallows Slack notification failures and skips missing webhook URLs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("slack down"));
    const { service } = createService();
    const errors = [createError({ severity: "critical" })];

    await expect(
      service.sendCriticalErrorNotification(errors, {
        id: "user-1",
        restaurantId: "restaurant-1",
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      service.sendCriticalErrorNotification(
        errors,
        { id: "user-1", restaurantId: "restaurant-1" },
        "https://slack.example.test/hook",
      ),
    ).resolves.toBeUndefined();
    expectErrorLogged("Failed to send critical error notification");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://slack.example.test/hook",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Request failed"),
      }),
    );
  });
});
