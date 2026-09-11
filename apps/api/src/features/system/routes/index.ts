/**
 * System Routes
 * All system-level endpoints including error reporting, health checks, and maintenance
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { validateBody, validateQuery } from "../../../middleware/validation";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import { SystemService } from "../services/SystemService";
import {
  errorReportSchema,
  errorStatsQuerySchema,
  cleanupQuerySchema,
} from "../schemas/validation";
import type { Env } from "../../../shared/types";
import type { ISystemService } from "../types";
import { isDeepHealthRequest, probeCache } from "../../../core/health/probe";

// Create feature router
const routes = new Hono<{ Bindings: Env }>();
const systemTelemetrySchema = z.lazy(() => z.object({}).loose());

function createTelemetryId(payload: Record<string, unknown>): string {
  for (const key of ["report_id", "reportId", "sync_id", "syncId", "id"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      return encodeURIComponent(value);
    }
  }
  return `${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getOptionalPrimitive(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function toSystemErrorType(value: unknown) {
  switch (value) {
    case "network":
    case "validation":
      return value;
    case "api":
    case "sse":
    case "permission":
      return value;
    case "authentication":
      return "permission";
    default:
      return "unknown";
  }
}

function toSystemErrorSeverity(value: unknown) {
  switch (value) {
    case "low":
    case "medium":
    case "high":
    case "critical":
      return value;
    default:
      return "low";
  }
}

function toIsoTimestamp(value: unknown): string {
  const date =
    typeof value === "number" || typeof value === "string"
      ? new Date(value)
      : new Date();

  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

/**
 * Map a loosely-shaped client error payload onto the strict
 * ErrorReportItem shape stored by SystemService. Field names that
 * differ between in-browser trackers and the server schema (category vs
 * type, name fallback for message, numeric timestamp) are reconciled
 * here so the loose POST /system/errors endpoint can keep accepting
 * whatever shape the customer-app / kitchen-display trackers happen
 * to emit.
 */
function normalizeClientError(
  raw: unknown,
  fallbackUserAgent?: string,
): z.infer<typeof errorReportSchema>["errors"][number] {
  const input = isRecord(raw) ? raw : {};
  const context = isRecord(input.context) ? input.context : {};
  const contextUser = isRecord(context.user) ? context.user : {};
  const contextExtra = isRecord(context.extra) ? context.extra : {};

  return {
    type: toSystemErrorType(input.category ?? input.type),
    severity: toSystemErrorSeverity(input.severity),
    code: getOptionalPrimitive(input.code),
    message:
      getString(input.message) ??
      getString(input.name) ??
      "Unknown client error",
    originalError: input,
    context,
    timestamp: toIsoTimestamp(input.timestamp),
    userAgent: getString(input.userAgent) ?? fallbackUserAgent,
    url: getString(input.url) ?? getString(context.url) ?? "",
    userId:
      getOptionalPrimitive(input.userId) ??
      getOptionalPrimitive(contextUser.id),
    restaurantId:
      getOptionalPrimitive(input.restaurantId) ??
      getOptionalPrimitive(contextExtra.restaurantId),
  };
}

/**
 * POST /api/v1/system/error-report
 *
 * Strict error-reporting endpoint. Body must satisfy errorReportSchema
 * (`{ errors: ErrorReportItem[] }`). Use this from server-side or
 * structured callers that already produce the canonical shape; for
 * loose client-tracker payloads see POST /api/v1/system/errors.
 */
routes.post(
  "/error-report",
  authMiddleware,
  validateBody(errorReportSchema),
  async (c) => {
    const { errors } = c.get("validatedBody");
    const user = c.get("user");
    const userAgent = c.req.header("User-Agent");

    const systemService: ISystemService = new SystemService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const result = await systemService.createErrorReport(
      { errors } as Parameters<typeof systemService.createErrorReport>[0],
      user.id,
      user.restaurantId == null ? null : String(user.restaurantId),
      userAgent,
    );

    return c.json(result);
  },
);

/**
 * POST /api/v1/system/errors
 *
 * Loose error-reporting endpoint for browser-side trackers. Accepts
 * either a single error object or `{ errors: [...] }`, in whatever
 * field shape the client tracker emits (category/type, numeric or
 * ISO timestamp, name-as-message fallback). Each entry is funnelled
 * through normalizeClientError to land in the strict ErrorReportItem
 * shape the server stores.
 *
 * For server-shaped reports that already conform to errorReportSchema,
 * use POST /api/v1/system/error-report instead.
 */
routes.post(
  "/errors",
  authMiddleware,
  validateBody(systemTelemetrySchema),
  async (c) => {
    const payload = c.get("validatedBody") as Record<string, unknown>;
    const user = c.get("user");
    const userAgent = c.req.header("User-Agent");
    const rawErrors = Array.isArray(payload.errors)
      ? payload.errors
      : [payload];
    const errors = rawErrors.map((error) =>
      normalizeClientError(error, userAgent),
    );

    const systemService: ISystemService = new SystemService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const result = await systemService.createErrorReport(
      { errors },
      user.id,
      user.restaurantId == null ? null : String(user.restaurantId),
      userAgent,
    );

    return c.json(result);
  },
);

/**
 * Client performance telemetry compatibility endpoint
 * POST /api/v1/system/performance
 */
routes.post(
  "/performance",
  authMiddleware,
  validateBody(systemTelemetrySchema),
  async (c) => {
    const payload = c.get("validatedBody") as Record<string, unknown>;
    const user = c.get("user");
    const now = new Date().toISOString();
    const reportId = createTelemetryId(payload);
    const restaurantId =
      user.restaurantId == null ? "global" : String(user.restaurantId);
    const scope = encodeURIComponent(restaurantId);
    const record = {
      userId: user.id,
      restaurantId:
        user.restaurantId == null ? null : String(user.restaurantId),
      payload,
      userAgent: c.req.header("User-Agent") ?? null,
      receivedAt: now,
    };

    await c.env.CACHE_KV.put(
      `system:performance:${scope}:${user.id}:${reportId}`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    await c.env.CACHE_KV.put(
      `system:performance:${scope}:${user.id}:latest`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );

    return c.json({
      success: true,
      data: {
        reportId,
        stored: true,
        restaurantId: record.restaurantId,
        receivedAt: now,
      },
    });
  },
);

// 健康檢查狀態接口
interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
}

interface ServiceCheck {
  name: string;
  status: "healthy" | "degraded" | "unhealthy";
  responseTime?: number;
  error?: string;
  lastCheck: string;
  /**
   * Which D1 instance answered the probe, straight out of `D1Result.meta`.
   * Present only on the database check, and only where D1 reports it —
   * miniflare returns neither field locally.
   *
   * This is the one signal that proves read replication is doing anything
   * (#321): the config toggle and the Sessions API calls are both silent, so
   * without this the only way to tell a working replica from a no-op is to
   * time queries and guess.
   */
  servedByPrimary?: boolean;
  servedByRegion?: string;
  /**
   * Which probe produced this check. Present only on the KV check, where the
   * two depths cost very different things and answer different questions —
   * see `CacheProbeDepth`. Reading a latency without knowing which one ran is
   * how #324 came to compare a three-round-trip write probe against a
   * one-statement `SELECT 1` and conclude KV was three times slower than D1.
   */
  probe?: CacheProbeDepth;
}

/**
 * How hard the KV check works.
 *
 * - `read` — one `get` of a sentinel key. Proves KV is reachable and spends no
 *   write quota. This is the default, including on the public endpoint.
 * - `read-write` — `put`, then `get`, then a background `delete`. Additionally
 *   proves the write path, at the price of two write-class round trips.
 *
 * Measured against production on 2026-09-05, with the Worker already back in
 * APAC (#322): a KV read costs ~210ms and each KV write ~420ms, against ~95ms
 * for the D1 `SELECT 1`. The write probe was by a wide margin the most
 * expensive thing this endpoint did, and it ran on every anonymous call.
 */
type CacheProbeDepth = "read" | "read-write";

interface EndpointHealth {
  name: string;
  path: string;
  status: "healthy" | "degraded" | "unhealthy";
  responseTime: number;
  statusCode?: number;
  error?: string;
}

// Workers 無法取得 memory/CPU/RPS 等執行環境指標 — 健康端點只回報
// 真實可量測的數據（DB/KV 探測延遲、端點探測、業務指標），絕不憑空捏造。
const UPTIME_EVIDENCE_KEY = "system:uptime:last-check";
const UPTIME_EVIDENCE_TTL_SECONDS = 60 * 60 * 24 * 7;
const UPTIME_MONITOR_TARGETS = [
  {
    name: "public_liveness",
    method: "GET",
    path: "/api/v1/system/health/live",
    expected_status: 200,
    interval_seconds: 60,
    timeout_seconds: 10,
    critical: true,
  },
  {
    name: "dependency_readiness",
    method: "GET",
    path: "/api/v1/system/health/ready",
    expected_status: 200,
    interval_seconds: 60,
    timeout_seconds: 10,
    critical: true,
  },
  {
    name: "dependency_health",
    method: "GET",
    path: "/api/v1/system/health",
    expected_status: 200,
    interval_seconds: 300,
    timeout_seconds: 15,
    critical: true,
  },
] as const;

function toUptimeStatus(
  status: HealthStatus["status"],
): "operational" | "degraded" | "down" {
  if (status === "unhealthy") return "down";
  if (status === "degraded") return "degraded";
  return "operational";
}

function getRequestOrigin(c: Context<{ Bindings: Env }>): string {
  try {
    return new URL(c.req.url).origin;
  } catch {
    return c.env.API_BASE_URL ?? "";
  }
}

async function storeUptimeEvidence(
  c: Context<{ Bindings: Env }>,
  health: {
    status: HealthStatus["status"];
    dbStatus: ServiceCheck;
    kvStatus: ServiceCheck;
    responseTimeMs: number;
  },
): Promise<{ stored: boolean; error?: string }> {
  try {
    await c.env.CACHE_KV.put(
      UPTIME_EVIDENCE_KEY,
      JSON.stringify({
        status: health.status,
        checked_at: new Date().toISOString(),
        response_time_ms: health.responseTimeMs,
        services: [health.dbStatus, health.kvStatus],
        checks: {
          database: health.dbStatus.status === "healthy",
          cache: health.kvStatus.status === "healthy",
        },
      }),
      { expirationTtl: UPTIME_EVIDENCE_TTL_SECONDS },
    );

    return { stored: true };
  } catch (error) {
    return {
      stored: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Hands `work` to the runtime to finish after the response, and otherwise lets
 * it run unobserved. Only optional cleanup belongs here — nothing reads the
 * result, and without an execution context nothing keeps the isolate alive for
 * it either.
 *
 * The try/catch mirrors `middleware/quotaGate.ts`: `executionCtx` throws rather
 * than returning undefined when there is no execution context, which is what
 * `app.request()` gives you in tests.
 */
function runAfterResponse(
  c: Context<{ Bindings: Env }>,
  work: Promise<unknown>,
): void {
  const settled = work.catch(() => undefined);

  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
  } catch {
    waitUntil = undefined;
  }

  waitUntil?.(settled);
}

async function checkDatabase(
  c: Context<{ Bindings: Env }>,
): Promise<ServiceCheck> {
  const startedAt = Date.now();

  try {
    // Deliberately the raw binding rather than the Drizzle builder this used to
    // call: `meta` is where served_by_primary/served_by_region live, and the
    // builder does not surface it. The Layer-3 ban exists because raw column
    // names drift when the schema migrates — `SELECT 1` names no columns, so
    // there is nothing here to drift.
    //
    // Probing through a session means this reports what a replica-eligible read
    // actually got, not what a primary-pinned one would have.
    const probe = await c.env.DB.withSession("first-unconstrained")
      .prepare("SELECT 1 AS test")
      .all<{ test: number }>();
    const meta = probe.meta as {
      served_by_primary?: boolean;
      served_by_region?: string;
    };

    return {
      name: "database",
      status: probe.results?.[0]?.test === 1 ? "healthy" : "degraded",
      responseTime: Date.now() - startedAt,
      lastCheck: new Date().toISOString(),
      servedByPrimary: meta?.served_by_primary,
      servedByRegion: meta?.served_by_region,
    };
  } catch (error) {
    return {
      name: "database",
      status: "unhealthy",
      responseTime: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error",
      lastCheck: new Date().toISOString(),
    };
  }
}

async function checkCache(
  c: Context<{ Bindings: Env }>,
  depth: CacheProbeDepth,
): Promise<ServiceCheck> {
  if (depth === "read") {
    // The same sentinel read `/api/v1/monitoring/health` uses, so the two
    // public health endpoints now report a comparable number.
    const probe = await probeCache(c.env.CACHE_KV);

    return {
      name: "kv_storage",
      status: probe.healthy ? "healthy" : "unhealthy",
      responseTime: probe.latencyMs,
      lastCheck: new Date().toISOString(),
      probe: depth,
      ...(probe.error ? { error: probe.error } : {}),
    };
  }

  const startedAt = Date.now();

  try {
    const testKey = `health-check-${Date.now()}`;
    await c.env.CACHE_KV.put(testKey, "test", { expirationTtl: 60 });
    const testValue = await c.env.CACHE_KV.get(testKey);
    const responseTime = Date.now() - startedAt;

    // The cleanup delete is a third write-class round trip (~420ms in
    // production) whose result nothing reads, and the key already carries a
    // 60s TTL, so KV reclaims it with or without this. Off the response path
    // it stays tidy without being paid for.
    runAfterResponse(c, c.env.CACHE_KV.delete(testKey));

    return {
      name: "kv_storage",
      status: testValue === "test" ? "healthy" : "degraded",
      responseTime,
      lastCheck: new Date().toISOString(),
      probe: depth,
    };
  } catch (error) {
    return {
      name: "kv_storage",
      status: "unhealthy",
      responseTime: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown error",
      lastCheck: new Date().toISOString(),
      probe: depth,
    };
  }
}

async function runBasicHealthCheck(
  c: Context<{ Bindings: Env }>,
  cacheProbeDepth: CacheProbeDepth = "read",
): Promise<{
  overallStatus: HealthStatus["status"];
  dbStatus: ServiceCheck;
  kvStatus: ServiceCheck;
  responseTimeMs: number;
}> {
  const startTime = Date.now();

  // Concurrent, and each probe times itself from its own start. Both matter.
  //
  // Sequentially, the two round trips added up: on the public endpoint that
  // was the D1 probe plus a three-round-trip KV probe, one after another. And
  // because both checks reported `Date.now() - startTime` against a single
  // clock started before the D1 query, whatever D1 had just spent was counted
  // a second time inside the KV number. That is what #324 measured as "KV is
  // three times D1" — of the 356-421ms it recorded for KV, 115-169ms of it was
  // the D1 probe, reported twice.
  const [dbStatus, kvStatus] = await Promise.all([
    checkDatabase(c),
    checkCache(c, cacheProbeDepth),
  ]);

  const services = [dbStatus, kvStatus];
  const unhealthyServices = services.filter((s) => s.status === "unhealthy");
  const degradedServices = services.filter((s) => s.status === "degraded");

  let overallStatus: HealthStatus["status"] = "healthy";
  if (unhealthyServices.length > 0) {
    overallStatus = "unhealthy";
  } else if (degradedServices.length > 0) {
    overallStatus = "degraded";
  }

  return {
    overallStatus,
    dbStatus,
    kvStatus,
    responseTimeMs: Date.now() - startTime,
  };
}

/**
 * 基本健康檢查 (公開端點)
 * GET /api/v1/system/health
 */
routes.get("/health", async (c) => {
  // `?deep=1` swaps the sentinel read for the write-path probe and records
  // uptime evidence. It is not reachable anonymously: `app-factory.ts` routes
  // deep requests through `authMiddleware` while leaving the plain path public,
  // because both of those extras spend KV writes and this endpoint is the one
  // external monitors poll (#324).
  const deep = isDeepHealthRequest(c.req.url);
  const {
    overallStatus: baseHealthStatus,
    dbStatus,
    kvStatus,
    responseTimeMs,
  } = await runBasicHealthCheck(c, deep ? "read-write" : "read");

  const services = [dbStatus, kvStatus];
  const health: HealthStatus = {
    status: baseHealthStatus,
    timestamp: new Date().toISOString(),
    uptime: responseTimeMs,
    version: c.env.API_VERSION || "v1",
    environment: c.env.NODE_ENV || "development",
  };
  // Evidence is a fixed KV key, so writing it here used to mean every
  // anonymous caller wrote the same key — a second KV write per request on top
  // of the probe's, and against KV's one-write-per-second-per-key ceiling.
  // `/health/uptime` is the endpoint whose contract is to leave evidence, and
  // it still does so on every call; here it follows the deliberate deep check.
  if (deep) {
    await storeUptimeEvidence(c, {
      status: baseHealthStatus,
      dbStatus,
      kvStatus,
      responseTimeMs,
    });
  }

  const statusCode =
    baseHealthStatus === "healthy"
      ? 200
      : baseHealthStatus === "degraded"
        ? 200
        : 503;

  return c.json(
    {
      success: baseHealthStatus !== "unhealthy",
      ...health,
      services,
      checks: {
        database: dbStatus.status === "healthy",
        cache: kvStatus.status === "healthy",
      },
    },
    statusCode,
  );
});

/**
 * GET /api/v1/system/health/uptime
 *
 * Public uptime monitor configuration and evidence hook. External monitors
 * should alert on non-2xx responses from this endpoint and keep the returned
 * target list in their monitor configuration.
 */
routes.get("/health/uptime", async (c) => {
  const {
    overallStatus: baseHealthStatus,
    dbStatus,
    kvStatus,
    responseTimeMs,
  } = await runBasicHealthCheck(c);
  const evidenceWrite = await storeUptimeEvidence(c, {
    status: baseHealthStatus,
    dbStatus,
    kvStatus,
    responseTimeMs,
  });
  const origin = getRequestOrigin(c);
  const statusCode = baseHealthStatus === "unhealthy" ? 503 : 200;

  return c.json(
    {
      success: baseHealthStatus !== "unhealthy",
      status: toUptimeStatus(baseHealthStatus),
      version: c.env.API_VERSION || "v1",
      environment: c.env.NODE_ENV || "development",
      checked_at: new Date().toISOString(),
      response_time_ms: responseTimeMs,
      evidence: {
        kv_key: UPTIME_EVIDENCE_KEY,
        stored: evidenceWrite.stored,
        error: evidenceWrite.error,
        retention_seconds: UPTIME_EVIDENCE_TTL_SECONDS,
      },
      targets: UPTIME_MONITOR_TARGETS.map((target) => ({
        ...target,
        url: `${origin}${target.path}`,
      })),
      services: [dbStatus, kvStatus],
      checks: {
        database: dbStatus.status === "healthy",
        cache: kvStatus.status === "healthy",
      },
    },
    statusCode,
  );
});

/**
 * Error statistics endpoint
 * GET /api/v1/system/error-stats
 */
routes.get(
  "/error-stats",
  authMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  validateQuery(errorStatsQuerySchema),
  async (c) => {
    const user = c.get("user");
    const query = c.get("validatedQuery");

    const systemService: ISystemService = new SystemService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    // For owners, only show their restaurant data
    const restaurantId =
      user.role === 1
        ? user.restaurantId == null
          ? undefined
          : String(user.restaurantId)
        : query.restaurantId;

    const result = await systemService.getErrorStats(restaurantId);

    return c.json({
      success: true,
      data: result,
    });
  },
);

/**
 * Cleanup old error reports endpoint
 * DELETE /api/v1/system/error-reports/cleanup
 */
routes.delete(
  "/error-reports/cleanup",
  authMiddleware,
  requireRole([0]), // Admin only
  validateQuery(cleanupQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");

    const systemService: ISystemService = new SystemService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const result = await systemService.cleanupOldErrorReports(query.daysOld);

    return c.json(result);
  },
);

/**
 * 詳細系統健康檢查 (需要管理員權限)
 * GET /api/v1/system/health/detailed
 */
routes.get(
  "/health/detailed",
  authMiddleware,
  requireRole([0]), // 僅管理員
  async (c) => {
    const startTime = Date.now();

    // 執行基本健康檢查
    // Admin-only, and explicitly the deep endpoint — the write-path probe
    // belongs here, where the caller is authenticated and the cadence is a
    // human clicking rather than a monitor polling.
    const basicHealth = await runBasicHealthCheck(c, "read-write");
    const basicData = { status: basicHealth.overallStatus };

    // 檢查資料庫性能
    const dbPerformanceStart = Date.now();
    const {
      createDatabase,
      count,
      gte,
      orders,
      users,
      restaurants,
      auditLogs,
      avgMoneyAmount,
      sql,
    } = await import("@makanmasak/database");
    const db = createDatabase(c.env.DB);

    // 獲取表統計
    const ordersCount = await db.select({ count: count() }).from(orders);
    const usersCount = await db.select({ count: count() }).from(users);
    const restaurantsCount = await db
      .select({ count: count() })
      .from(restaurants);

    const tableStats = [
      { table_name: "orders", row_count: ordersCount[0]?.count || 0 },
      { table_name: "users", row_count: usersCount[0]?.count || 0 },
      {
        table_name: "restaurants",
        row_count: restaurantsCount[0]?.count || 0,
      },
    ];

    const dbPerformanceTime = Date.now() - dbPerformanceStart;

    // 檢查最近的錯誤日誌
    const recentErrors = await db
      .select({
        action: auditLogs.action,
        resource: auditLogs.resource,
        description: auditLogs.description,
        created_at: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        sql`${auditLogs.action} LIKE '%error%' OR ${auditLogs.action} LIKE '%fail%'`,
      )
      .orderBy(sql`${auditLogs.createdAt} DESC`)
      .limit(10);

    // 檢查系統負載
    const currentTime = new Date();
    const oneHourAgo = new Date(currentTime.getTime() - 60 * 60 * 1000);

    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const systemLoad = await db
      .select({
        total_requests: count(),
        recent_requests: sql<number>`COUNT(CASE WHEN ${orders.createdAt} >= ${oneHourAgo.toISOString()} THEN 1 END)`,
        active_restaurants: sql<number>`COUNT(DISTINCT ${orders.restaurantId})`,
        avg_order_value: avgMoneyAmount(orders.totalAmountCents),
      })
      .from(orders)
      .where(gte(orders.createdAt, twentyFourHoursAgo))
      .then((result) => result[0]);

    // API端點響應時間測試
    const endpointTests = [
      { name: "restaurants", path: "/api/v1/restaurants?limit=1" },
      { name: "menu", path: "/api/v1/menu/1" },
      { name: "orders", path: "/api/v1/orders?limit=1" },
    ];

    const endpointHealth: EndpointHealth[] = [];
    for (const endpoint of endpointTests) {
      const testStart = Date.now();
      try {
        const response = await fetch(
          `${c.req.url.split("/api")[0]}${endpoint.path}`,
          {
            method: "GET",
            headers: {
              Authorization: c.req.header("Authorization") || "",
              "Content-Type": "application/json",
            },
          },
        );

        const responseTime = Date.now() - testStart;
        endpointHealth.push({
          ...endpoint,
          status: response.ok ? "healthy" : "degraded",
          responseTime,
          statusCode: response.status,
        });
      } catch (error) {
        endpointHealth.push({
          ...endpoint,
          status: "unhealthy",
          responseTime: Date.now() - testStart,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // 計算整體系統健康分數 (0-100)
    let healthScore = 100;

    // 基於各項指標扣分
    if (basicData.status === "degraded") healthScore -= 20;
    if (basicData.status === "unhealthy") healthScore -= 50;

    if (dbPerformanceTime > 1000) healthScore -= 10; // 資料庫響應超過1秒

    const unhealthyEndpoints = endpointHealth.filter(
      (e) => e.status === "unhealthy",
    ).length;
    healthScore -= unhealthyEndpoints * 10;

    healthScore = Math.max(0, Math.min(100, healthScore));

    return c.json({
      success: true,
      overview: basicData,
      performance: {
        database_response_time: dbPerformanceTime,
        table_statistics: tableStats,
        endpoint_health: endpointHealth,
      },
      system_load: systemLoad,
      recent_errors: recentErrors.slice(0, 5),
      health_score: Math.round(healthScore),
      recommendations: generateRecommendations(healthScore, endpointHealth),
      timestamp: new Date().toISOString(),
      total_check_time: Date.now() - startTime,
    });
  },
);

/**
 * 系統指標端點 (需要管理員權限)
 * GET /api/v1/system/health/metrics
 */
routes.get(
  "/health/metrics",
  authMiddleware,
  requireRole([0]), // 僅管理員
  validateQuery(
    z.lazy(() =>
      z.object({
        format: z.enum(["json", "prometheus"]).optional().default("json"),
      }),
    ),
  ),
  async (c) => {
    const { format } = c.get("validatedQuery");

    const { createDatabase, count, gte, orders, sql } =
      await import("@makanmasak/database");
    const db = createDatabase(c.env.DB);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    // 獲取業務指標
    const businessMetrics = await db
      .select({
        orders_last_hour: sql<number>`COUNT(CASE WHEN ${orders.createdAt} >= ${oneHourAgo.toISOString()} THEN 1 END)`,
        orders_last_24h: sql<number>`COUNT(CASE WHEN ${orders.createdAt} >= ${twentyFourHoursAgo.toISOString()} THEN 1 END)`,
        pending_orders: sql<number>`COUNT(CASE WHEN ${orders.status} = 'pending' THEN 1 END)`,
        preparing_orders: sql<number>`COUNT(CASE WHEN ${orders.status} = 'preparing' THEN 1 END)`,
        total_orders: count(),
      })
      .from(orders)
      .where(gte(orders.createdAt, sevenDaysAgo))
      .then((result) => result[0]);

    if (format === "prometheus") {
      // Prometheus格式輸出
      const prometheusMetrics = `
# HELP makanmakan_orders_total Total number of orders
# TYPE makanmakan_orders_total counter
makanmakan_orders_total ${businessMetrics?.total_orders || 0}

# HELP makanmakan_orders_pending Number of pending orders
# TYPE makanmakan_orders_pending gauge
makanmakan_orders_pending ${businessMetrics?.pending_orders || 0}

# HELP makanmakan_orders_preparing Number of orders being prepared
# TYPE makanmakan_orders_preparing gauge
makanmakan_orders_preparing ${businessMetrics?.preparing_orders || 0}
      `.trim();

      c.header("Content-Type", "text/plain; charset=utf-8");
      return c.text(prometheusMetrics);
    }

    // JSON格式輸出
    return c.json({
      success: true,
      timestamp: new Date().toISOString(),
      business_metrics: businessMetrics,
      alert_thresholds: {
        response_time_warning: 1000,
        response_time_critical: 3000,
      },
    });
  },
);

/**
 * 就緒檢查 (Kubernetes readiness probe)
 * GET /api/v1/system/health/ready
 */
routes.get("/health/ready", async (c) => {
  try {
    // 檢查關鍵服務是否就緒
    const { createDatabase, sql, users } = await import("@makanmasak/database");
    const db = createDatabase(c.env.DB);
    const readyResult = await db
      .select({ test: sql<number>`1` })
      .from(users)
      .limit(1);
    const dbReady = readyResult[0]?.test === 1;
    // Same read-only probe as /monitoring/health and /system/health. This used
    // to compare `get()` against `undefined`, which KV never returns — `kvReady`
    // was a constant and the `put` fallback behind it was dead code (#332).
    const kvProbe = await probeCache(c.env.CACHE_KV);

    if (dbReady && kvProbe.healthy) {
      return c.json({
        success: true,
        status: "ready",
        timestamp: new Date().toISOString(),
      });
    }

    return c.json(
      {
        success: false,
        status: "not_ready",
        // Which dependency failed. A 60s critical probe that only says
        // "not_ready" makes the on-call read logs to find out which one.
        checks: { database: dbReady, cache: kvProbe.healthy },
        ...(kvProbe.error ? { error: kvProbe.error } : {}),
        timestamp: new Date().toISOString(),
      },
      503,
    );
  } catch (error) {
    return c.json(
      {
        success: false,
        status: "not_ready",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
});

/**
 * 存活檢查 (Kubernetes liveness probe)
 * GET /api/v1/system/health/live
 */
routes.get("/health/live", (c) => {
  // 簡單的存活檢查 - 如果能回應就表示存活
  return c.json({
    success: true,
    status: "alive",
    timestamp: new Date().toISOString(),
    uptime:
      typeof process !== "undefined" && process.uptime
        ? Math.floor(process.uptime())
        : 0,
  });
});

// 生成系統建議
function generateRecommendations(
  healthScore: number,
  endpointHealth: EndpointHealth[],
): string[] {
  const recommendations: string[] = [];

  if (healthScore < 80) {
    recommendations.push(
      "System health score is below optimal. Consider investigating issues.",
    );
  }

  const slowEndpoints = endpointHealth.filter(
    (e) => e.responseTime && e.responseTime > 1000,
  );
  if (slowEndpoints.length > 0) {
    recommendations.push(
      `Slow response times detected on: ${slowEndpoints.map((e) => e.name).join(", ")}`,
    );
  }

  const unhealthyEndpoints = endpointHealth.filter(
    (e) => e.status === "unhealthy",
  );
  if (unhealthyEndpoints.length > 0) {
    recommendations.push(
      `Unhealthy endpoints detected: ${unhealthyEndpoints.map((e) => e.name).join(", ")}`,
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "System is operating normally. No immediate action required.",
    );
  }

  return recommendations;
}

export default routes;
