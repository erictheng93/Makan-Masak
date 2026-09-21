/**
 * Analytics Routes
 * All analytics endpoints including dashboard, revenue, performance, and real-time data
 */

import { Hono } from "hono";
import { validateQuery } from "../../../middleware/validation";
import {
  authMiddleware,
  requireRole,
  type AuthUser,
} from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import { AnalyticsService } from "../services/AnalyticsService";
import { forbidden } from "../../../shared/utils/api-error";
import {
  analyticsQuerySchema,
  dashboardQuerySchema,
  revenueQuerySchema,
  performanceQuerySchema,
  exportQuerySchema,
  realtimeDashboardQuerySchema,
  ownerDashboardQuerySchema,
  financialReportQuerySchema,
  sseQuerySchema,
} from "../schemas/validation";
import type { Env } from "../../../shared/types";
import type { IAnalyticsService, SSEAnalyticsEvent } from "../types";

// Create feature router
const routes = new Hono<{ Bindings: Env }>();

routes.use("*", authMiddleware, moduleGate("analytics"));

routes.post("/batch-sync", async (c) => {
  const user = c.get("user");

  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: {
          code: "INVALID_JSON",
          message: "Invalid JSON body",
        },
      },
      400,
    );
  }

  const restaurantId =
    user.restaurantId == null ? "global" : String(user.restaurantId);
  const now = new Date().toISOString();
  const syncId = createAnalyticsSyncId(payload);
  const key = `analytics:batch-sync:${encodeURIComponent(restaurantId)}:${user.id}:${syncId}`;
  const record = {
    restaurantId: user.restaurantId == null ? null : String(user.restaurantId),
    userId: user.id,
    payload,
    syncedAt: now,
  };

  await c.env.CACHE_KV.put(key, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  await c.env.CACHE_KV.put(
    `analytics:batch-sync:${encodeURIComponent(restaurantId)}:${user.id}:latest`,
    JSON.stringify(record),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );

  if (record.restaurantId) {
    const analyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );
    await analyticsService.clearCache(record.restaurantId);
  }

  return c.json({
    success: true,
    data: {
      syncId,
      synced: true,
      itemCount:
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { events?: unknown }).events)
          ? (payload as { events: unknown[] }).events.length
          : 0,
      restaurantId: record.restaurantId,
      syncedAt: now,
    },
  });
});

routes.post(
  "/:restaurantId/sync",
  authMiddleware,
  requireRole([0, 1]),
  async (c) => {
    const restaurantId = c.req.param("restaurantId");
    if (!restaurantId) {
      return c.json(
        {
          success: false,
          error: {
            code: "MISSING_PARAM",
            message: "Missing restaurantId parameter",
          },
        },
        400,
      );
    }
    const user = c.get("user");

    if (
      user.role !== 0 &&
      (user.restaurantId === undefined ||
        String(user.restaurantId) !== restaurantId)
    ) {
      return c.json(
        {
          success: false,
          error: {
            code: "ANALYTICS_SYNC_FORBIDDEN",
            message: "Cannot sync analytics for another restaurant",
          },
        },
        403,
      );
    }

    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON body",
          },
        },
        400,
      );
    }

    const now = new Date().toISOString();
    const syncId = createAnalyticsSyncId(payload);
    const key = `analytics:sync:${encodeURIComponent(restaurantId)}:${syncId}`;
    const record = {
      restaurantId,
      userId: user.id,
      payload,
      syncedAt: now,
    };

    await c.env.CACHE_KV.put(key, JSON.stringify(record), {
      expirationTtl: 60 * 60 * 24 * 30,
    });
    await c.env.CACHE_KV.put(
      `analytics:sync:${encodeURIComponent(restaurantId)}:latest`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );

    const analyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );
    await analyticsService.clearCache(restaurantId);

    return c.json({
      success: true,
      data: {
        syncId,
        synced: true,
        restaurantId,
        syncedAt: now,
      },
    });
  },
);

/**
 * Dashboard analytics endpoint
 * GET /api/v1/analytics/dashboard
 */
routes.get(
  "/dashboard",
  authMiddleware,
  requireRole([0, 1]), // Admin and Owner only
  validateQuery(dashboardQuerySchema),
  async (c) => {
    const { restaurantId, period } = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const targetRestaurantId = scopedAnalyticsRestaurantId(user, restaurantId);

    const dashboardData = await analyticsService.getDashboardData(
      targetRestaurantId,
      period,
    );

    return c.json({
      success: true,
      data: dashboardData,
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * Revenue analytics endpoint
 * GET /api/v1/analytics/revenue
 */
routes.get(
  "/revenue",
  authMiddleware,
  requireRole([0, 1]),
  validateQuery(revenueQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const filters = {
      ...query,
      restaurantId: scopedAnalyticsRestaurantId(user, query.restaurantId),
    };

    const revenueData = await analyticsService.getRevenueAnalytics(filters);

    return c.json({
      success: true,
      data: revenueData,
    });
  },
);

/**
 * Product analytics endpoint
 * GET /api/v1/analytics/products
 */
routes.get(
  "/products",
  authMiddleware,
  requireRole([0, 1]),
  validateQuery(analyticsQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const filters = {
      ...query,
      restaurantId: scopedAnalyticsRestaurantId(user, query.restaurantId),
    };

    const productData = await analyticsService.getProductAnalytics(filters);

    return c.json({
      success: true,
      data: productData,
    });
  },
);

/**
 * Customer analytics endpoint
 * GET /api/v1/analytics/customers
 */
routes.get(
  "/customers",
  authMiddleware,
  requireRole([0, 1]),
  validateQuery(analyticsQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const filters = {
      ...query,
      restaurantId: scopedAnalyticsRestaurantId(user, query.restaurantId),
    };

    const customerData = await analyticsService.getCustomerAnalytics(filters);

    return c.json({
      success: true,
      data: customerData,
    });
  },
);

/**
 * Performance analytics endpoint
 * GET /api/v1/analytics/performance
 */
routes.get(
  "/performance",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  validateQuery(performanceQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const filters = {
      ...query,
      restaurantId: scopedAnalyticsRestaurantId(user, query.restaurantId),
    };

    const performanceData =
      await analyticsService.getPerformanceAnalytics(filters);

    return c.json({
      success: true,
      data: performanceData,
    });
  },
);

/**
 * Export analytics endpoint
 * GET /api/v1/analytics/export
 */
routes.get(
  "/export",
  authMiddleware,
  requireRole([0, 1]),
  validateQuery(exportQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const exportRequest = {
      ...query,
      restaurantId: scopedAnalyticsRestaurantId(user, query.restaurantId),
    };

    const exportResult = await analyticsService.generateExport(exportRequest);

    return c.json(exportResult);
  },
);

/**
 * Real-time dashboard endpoint
 * GET /api/v1/analytics/realtime-dashboard
 */
routes.get(
  "/realtime-dashboard",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  validateQuery(realtimeDashboardQuerySchema),
  async (c) => {
    const { restaurantId } = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const targetRestaurantId = scopedAnalyticsRestaurantId(user, restaurantId);

    const realtimeData =
      await analyticsService.getRealtimeData(targetRestaurantId);

    return c.json({
      success: true,
      data: realtimeData,
      timestamp: realtimeData.timestamp,
    });
  },
);

/**
 * Owner dashboard endpoint
 * GET /api/v1/analytics/owner-dashboard
 */
routes.get(
  "/owner-dashboard",
  authMiddleware,
  requireRole([0, 1]), // Admin, Owner
  validateQuery(ownerDashboardQuerySchema),
  async (c) => {
    const { restaurantId } = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const targetRestaurantId = scopedAnalyticsRestaurantId(user, restaurantId);

    const ownerDashboardData =
      await analyticsService.getDashboardData(targetRestaurantId);

    return c.json({
      success: true,
      data: ownerDashboardData,
      timestamp: new Date().toISOString(),
    });
  },
);

/**
 * Financial report endpoint
 * GET /api/v1/analytics/financial-report
 */
routes.get(
  "/financial-report",
  authMiddleware,
  requireRole([0, 1]),
  validateQuery(financialReportQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const user = c.get("user");

    const analyticsService: IAnalyticsService = new AnalyticsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );

    const filters = {
      ...query,
      restaurantId: scopedAnalyticsRestaurantId(user, query.restaurantId),
    };

    const financialReportData =
      await analyticsService.getFinancialReport(filters);

    return c.json({
      success: true,
      data: financialReportData,
    });
  },
);

/**
 * Server-Sent Events (SSE) endpoint for real-time analytics
 * GET /api/v1/analytics/sse
 */
routes.get(
  "/sse",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  validateQuery(sseQuerySchema),
  async (c) => {
    const user = c.get("user");
    const { lastEventId: _lastEventId } = c.get("validatedQuery");
    const targetRestaurantId = scopedAnalyticsRestaurantId(user);

    // Set SSE headers
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Cache-Control");

    // Create ReadableStream for SSE
    const stream = new ReadableStream({
      start(controller) {
        const analyticsService = new AnalyticsService(
          c.env.DB,
          c.env,
          c.env.CACHE_KV,
        );

        // Send initial connection confirmation
        const welcomeEvent: SSEAnalyticsEvent = {
          id: Date.now().toString(),
          event: "heartbeat",
          data: {
            message: "SSE connected",
            timestamp: new Date().toISOString(),
          },
        };
        const welcomeData = `id: ${welcomeEvent.id}\nevent: ${welcomeEvent.event}\ndata: ${JSON.stringify(welcomeEvent.data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(welcomeData));

        // Set up heartbeat interval
        const heartbeatInterval = setInterval(() => {
          try {
            const heartbeatEvent: SSEAnalyticsEvent = {
              id: Date.now().toString(),
              event: "heartbeat",
              data: {
                message: "heartbeat",
                timestamp: new Date().toISOString(),
              },
            };
            const heartbeatData = `id: ${heartbeatEvent.id}\nevent: ${heartbeatEvent.event}\ndata: ${JSON.stringify(heartbeatEvent.data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(heartbeatData));
          } catch {
            clearInterval(heartbeatInterval);
          }
        }, 30000); // Every 30 seconds

        // Set up statistics push interval
        const statsInterval = setInterval(async () => {
          try {
            // Get real-time analytics data
            const realtimeData =
              await analyticsService.getRealtimeData(targetRestaurantId);

            const statisticsEvent: SSEAnalyticsEvent = {
              id: Date.now().toString(),
              event: "statistics_update",
              data: realtimeData,
            };
            const eventData = `id: ${statisticsEvent.id}\nevent: ${statisticsEvent.event}\ndata: ${JSON.stringify(statisticsEvent.data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(eventData));
          } catch {
            const errorEvent: SSEAnalyticsEvent = {
              id: Date.now().toString(),
              event: "error",
              data: {
                error: "Failed to fetch statistics",
                timestamp: new Date().toISOString(),
              },
            };
            const errorData = `id: ${errorEvent.id}\nevent: ${errorEvent.event}\ndata: ${JSON.stringify(errorEvent.data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(errorData));
          }
        }, 10000); // Every 10 seconds

        // Cleanup function
        const cleanup = () => {
          clearInterval(heartbeatInterval);
          clearInterval(statsInterval);
          try {
            controller.close();
          } catch {
            // ignore close errors
          }
        };

        // Listen for abort signal
        c.req.raw.signal?.addEventListener("abort", cleanup);

        // Set timeout cleanup (prevent connection leaks)
        setTimeout(cleanup, 3600000); // 1 hour
      },

      cancel() {
        // stream cancelled by client
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
      },
    });
  },
);

function createAnalyticsSyncId(payload: unknown): string {
  if (
    payload &&
    typeof payload === "object" &&
    "sync_id" in payload &&
    typeof (payload as { sync_id?: unknown }).sync_id === "string" &&
    (payload as { sync_id: string }).sync_id.trim()
  ) {
    return encodeURIComponent((payload as { sync_id: string }).sync_id);
  }

  return `${Date.now()}`;
}

/**
 * Analytics is the one feature where an unscoped query intentionally means
 * platform-wide data for administrators. For every other role, an absent
 * restaurant is an authorization error — it must never silently turn into
 * that platform-wide query.
 */
function scopedAnalyticsRestaurantId(
  user: AuthUser,
  requestedRestaurantId?: string,
): string | undefined {
  if (user.role === 0) return requestedRestaurantId;
  if (user.restaurantId == null) {
    throw forbidden(
      "Restaurant context is required for analytics",
      "ANALYTICS_RESTAURANT_CONTEXT_REQUIRED",
    );
  }
  return String(user.restaurantId);
}

export default routes;
