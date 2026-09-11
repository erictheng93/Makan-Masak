import { Hono, type Context, type Next } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { timing } from "hono/timing";
import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import { authMiddleware, optionalAuth } from "./middleware/auth";
import { isDeepHealthRequest } from "./core/health/probe";
import { corsMiddleware } from "./middleware/cors";
import { csrfProtection, attachCSRFToken } from "./middleware/csrf";
// import { rateLimitMiddleware } from './middleware/rateLimit'
import {
  securityHeadersMiddleware,
  requestIdMiddleware,
  inputSanitizationMiddleware,
  securityMonitoringMiddleware,
} from "./middleware/security";
import {
  smartCacheMiddleware,
  isPublicApiCacheableRequest,
  getRestaurantIdForCacheScope,
} from "./middleware/edge-cache";
import { advancedAnalyticsMiddleware } from "./middleware/analytics";
import { geoIntelligentRateLimitMiddleware } from "./middleware/geo-rate-limiting";
import type { CustomRateLimit } from "./middleware/geo-rate-limiting";
import {
  metricsMiddleware,
  errorMonitoringMiddleware,
  healthCheckMiddleware,
  monitoringStatsMiddleware,
} from "./middleware/monitoring";
import { moduleGate } from "./middleware/moduleGate";
import { usageTracker } from "./middleware/usageTracker";
// import restaurantsRouter from './routes/restaurants' // Replaced with modular Restaurants feature
import restaurantsFeature from "./features/restaurants";
// import menuRouter from './routes/menu' // Replaced with modular Menu feature
// import authRouter from './routes/auth' // Replaced with modular Authentication feature
import authFeature from "./features/authentication";
import menuFeature from "./features/menu";
// import kitchenRouter from './routes/kitchen' // Replaced with modular Kitchen feature
import { default as kitchenFeature } from "./features/kitchen";
import ordersFeature from "./features/orders"; // New modular architecture
// import groupOrdersRouter from './routes/groupOrders' // Replaced with modular Group Orders feature
import groupOrdersFeature from "./features/group-orders";
// import posRouter from './routes/pos' // Replaced with modular POS feature
import posFeature from "./features/pos";
import printRoutes from "./features/print/routes";
// import queueRouter from './routes/queue' // Replaced with unified Queue feature
// import queueModularRouter from './routes/queue-modular' // Replaced with unified Queue feature
import queueFeature from "./features/queue";
import paymentsFeature from "./features/payments";
import managerFeature from "./features/manager";
// import printRouter from './routes/print' // Disabled
// import tablesRouter from './routes/tables' // Replaced with modular Tables feature
import tablesFeature from "./features/tables";
// import usersRouter from './routes/users' // Replaced with modular Users feature
import usersFeature from "./features/users";
// import analyticsRouter from './routes/analytics' // Replaced with modular Analytics feature
import analyticsFeature from "./features/analytics";
// import qrcodeRouter from './routes/qrcode' // Replaced with modular QR codes feature
import qrCodesFeature from "./features/qr-codes";
// import systemRouter from './routes/system' // Replaced with modular System feature
import systemFeature from "./features/system";
// Modular backup feature
import { BackupRoutes } from "./features/backup";
// import healthRouter from './routes/health' // Replaced with modular System feature (/system/health)
// import sseRouter from './routes/sse' // Replaced with modular SSE feature
import sseFeature from "./features/sse";
// import cacheRouter from './routes/cache' // Replaced with modular Cache feature
import cacheFeature from "./features/cache";
// import monitoringRouter from './routes/monitoring' // Replaced with modular Monitoring feature
import monitoringFeature from "./features/monitoring";
// import couponsRouter from './routes/coupons' // Replaced with modular Coupons feature
import couponsFeature from "./features/coupons";
// import printRouter from './routes/print' // Disabled - incomplete feature
// import { printApp } from './features/print' // Disabled - incomplete feature
// import aiAnalyticsRouter from './routes/ai-analytics' // Replaced with modular AI Analytics feature
import aiAnalyticsFeature from "./features/ai-analytics";
// import seatsRouter from './routes/seats' // Replaced with modular Seats feature
import seatsFeature from "./features/seats";
import customersRouter from "./features/customers/routes";
import customerRouter from "./features/customer/routes";
// import leavesRouter from './routes/leaves' // Replaced with modular Leaves feature
import leavesFeature from "./features/leaves";
// Employee scheduling and shift management feature
import schedulingFeature from "./features/scheduling";
// Reservation and waiting list features
import reservationsFeature from "./features/reservations";
import serviceBookingsFeature from "./features/service-bookings";
import waitingListFeature from "./features/waiting-list";
// Realtime authentication feature
import realtimeRoutes from "./features/realtime/routes";
// Notification system feature
import notificationsRoutes from "./features/notifications/routes";
import pushRoutes from "./features/push/routes";
import adminSettingsRoutes from "./features/admin-settings/routes";
import auditRoutes from "./features/audit/routes";
// Verification system (password reset, email/phone verification)
// import verificationRoutes from './routes/verification' // Replaced with modular Verification feature
import verificationFeature from "./features/verification";
// Partnership system feature
import partnershipsRoutes from "./features/partnerships/routes";
import guestOrdersRoutes from "./features/guest-orders";
import integrationsFeature from "./features/integrations";
import forecastFeature from "./features/forecast";
import ingredientsFeature from "./features/ingredients";
import discoveryFeature from "./features/discovery";
import marketsFeature from "./features/markets";
import marketCheckoutsFeature from "./features/market-checkouts";
import creditsFeature from "./features/credits";
import {
  disabledFeatures,
  isFeatureEnabled,
  type UnlaunchedFeatureKey,
} from "./shared/feature-adoption";
import feedbackFeature from "./features/feedback";
import alertsFeature from "./features/alerts";
import reviewsFeature from "./features/reviews";
import billingFeature from "./features/billing";
import subscriptionsFeature from "./features/subscriptions";
import meFeature from "./features/me";
import membersFeature from "./features/members";
import { ErrorSanitizer } from "./utils/errorSanitizer";
import { ApiError, sanitizeApiErrorDetails } from "./shared/utils/api-error";
import type { Env } from "./types/env";

export interface AppRuntimeOptions {
  disableEdgeCache?: boolean;
  disableObservability?: boolean;
}

type ErrorResponseStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;
type HonoRoute = {
  method: string;
  path: string;
};

const ROUTE_REGEX_CACHE = new Map<string, RegExp>();

const ERROR_RESPONSE_STATUS_CODES = new Set<number>([
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500,
  501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);

function toErrorResponseStatusCode(status: number): ErrorResponseStatusCode {
  return ERROR_RESPONSE_STATUS_CODES.has(status)
    ? (status as ErrorResponseStatusCode)
    : 500;
}

function normalizeRoutePath(path: string): string {
  if (path === "") return "/";
  const withoutTrailingSlash =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return withoutTrailingSlash || "/";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routePathToRegex(path: string): RegExp {
  const normalized = normalizeRoutePath(path);
  const cached = ROUTE_REGEX_CACHE.get(normalized);
  if (cached) return cached;

  if (normalized === "/") return /^\/$/;

  const pattern = normalized
    .split("/")
    .map((segment) => {
      if (segment === "*") return ".*";
      if (segment.startsWith(":")) return "[^/]+";
      return escapeRegex(segment);
    })
    .join("/");

  const regex = new RegExp(`^${pattern}$`);
  ROUTE_REGEX_CACHE.set(normalized, regex);
  return regex;
}

function routeCanHandleMethod(routeMethod: string, requestMethod: string) {
  if (routeMethod === "ALL") return true;
  if (requestMethod === "HEAD" && routeMethod === "GET") return true;
  return routeMethod === requestMethod;
}

function hasConcreteApiRoute(
  routes: HonoRoute[],
  requestPath: string,
  requestMethod: string,
) {
  const path = normalizeRoutePath(
    requestPath.startsWith("/api/v1")
      ? requestPath.slice("/api/v1".length)
      : requestPath,
  );

  return routes.some((route) => {
    if (route.method === "ALL") return false;
    return (
      routeCanHandleMethod(route.method, requestMethod) &&
      routePathToRegex(route.path).test(path)
    );
  });
}

function apiV1RouteNotFound(method: string, path: string) {
  return {
    success: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `API endpoint not found: ${method} ${path}`,
    },
  };
}

/**
 * Blocks an unlaunched feature's routes.
 *
 * Has to be middleware rather than a conditional mount: createApp() runs at
 * module scope, before any request supplies c.env, so the flag cannot be read
 * while the router is being assembled.
 *
 * Answers 404 rather than 503. A feature nobody has launched does not exist
 * from a caller's point of view, and 503 would advertise it as temporarily
 * broken -- inviting retries against something that is never coming back up
 * until someone sets the flag.
 */
function featureGate(key: UnlaunchedFeatureKey) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!isFeatureEnabled(c.env as unknown as Record<string, unknown>, key)) {
      return c.json(apiV1RouteNotFound(c.req.method, c.req.path), 404);
    }
    await next();
  };
}

/**
 * Per-endpoint rate limits for the geo middleware's **KV** path.
 *
 * Only two entries remain, and that is deliberate (#341). These values bind
 * only when `shouldUseKvRateLimiter` sends a request down the KV path — the
 * credential endpoints, where a durable cross-isolate counter is the point.
 * Every other path is enforced by a native rate limit binding, which applies
 * the limit declared in wrangler.toml and reports nothing back, so an entry
 * here for such a path sets a limit nobody honours.
 *
 * Before adding one, pick the mechanism you actually want:
 *
 * - **A different number on a native path** → add a `[[ratelimits]]` binding in
 *   wrangler.toml and a path to `STRICT_NATIVE_RATE_LIMIT_PATHS`. No KV cost,
 *   no added latency. `/realtime/auth/token` uses this.
 * - **A per-route limit with its own key** → `rateLimitMiddleware` from
 *   `middleware/rateLimiter`, applied on the route; eight features already do.
 *   Costs 3 KV reads + 1 write per request (~$6.50/million) and a few hundred
 *   ms, so it earns its place only where a durable counter is the point.
 * - **A durable counter for a credential endpoint** → add the path to
 *   `SENSITIVE_KV_RATE_LIMIT_PATHS` and give it an entry here.
 *
 * Seven entries were deleted in #341 rather than wired up: they named paths
 * already authenticated, throttled (`enforceGuestOrderThrottle`), quota-gated,
 * or HMAC-verified, with the native 100 req/60s as an adequate floor beneath
 * them. The webhooks entry was itself 100/60 — the number the binding already
 * applies — so removing it changed nothing at all.
 *
 * Covered by a test that fails if an entry names no registered route, or names
 * a path the KV limiter never sees.
 */
export const API_CUSTOM_RATE_LIMITS = {
  "/api/v1/auth/login": {
    requests: 100,
    windowSeconds: 60,
    burstMultiplier: 1.2,
    blockDuration: 60,
  }, // Increased for testing
  "/api/v1/auth/register": {
    requests: 50,
    windowSeconds: 60,
    burstMultiplier: 1.0,
    blockDuration: 60,
  },
} satisfies Record<string, CustomRateLimit>;

export function createApp(
  _env?: Env,
  options: AppRuntimeOptions = {},
): Hono<{ Bindings: Env }> {
  // 創建主應用
  const app = new Hono<{ Bindings: Env }>();
  const edgeCacheEnabled = !options.disableEdgeCache;
  const observabilityEnabled = !options.disableObservability;

  // 🚀 ENHANCED 全域中間件 FOR 100/100 SCORE - CLOUDFLARE OPTIMIZATIONS
  app.use("*", requestIdMiddleware); // First: Generate request ID for tracking
  app.use("*", corsMiddleware); // Second: CORS headers must survive early error responses

  // 🔒 CRITICAL SECURITY: Advanced geo-intelligent rate limiting (+0.5 points)
  app.use(
    "*",
    geoIntelligentRateLimitMiddleware({
      skipPaths: ["/health", "/info"],
      customLimits: API_CUSTOM_RATE_LIMITS,
    }),
  );

  app.use("*", securityMonitoringMiddleware); // Third: Monitor security events
  app.use("*", securityHeadersMiddleware); // Fourth: Security headers
  app.use("*", inputSanitizationMiddleware); // Fifth: Sanitize inputs before processing

  // 📊 CRITICAL ANALYTICS: Workers Analytics integration (+1 point)
  if (observabilityEnabled) {
    app.use("*", advancedAnalyticsMiddleware());
  }

  // 🚀 CRITICAL PERFORMANCE: Multi-layer edge caching (+2.5 points)
  if (edgeCacheEnabled) {
    app.use(
      "*",
      smartCacheMiddleware({
        defaultTtl: 300, // 使用預設值，避免全域範圍的 process.env 存取
        // User-Agent was previously listed but it shards the cache per-client
        // (curl, each browser, etc.), making invalidation impossible — every
        // unique UA gets its own Cache API entry that the writer/invalidator
        // can't enumerate. Drop it. Authorization is handled by short-circuiting
        // the cache for authenticated requests, so it's redundant here too.
        varyHeaders: ["X-Restaurant-ID", "CF-IPCountry"],
        // One tag, not seven. `set()` pays a KV read plus a KV write per tag to
        // maintain its `tag:*` key list, and KV writes are the most expensive KV
        // op ($5.00/M, 1M/month free) — so each tag here is a recurring per-miss
        // cost, not a free label. `restaurant:{id}` is the only tag anything
        // ever invalidates by (see the `invalidate(..., "tag")` call in
        // smartCacheMiddleware), and it already reaches every cached public GET
        // for that restaurant, which is the coverage the tag sweep exists for.
        //
        // The tags that were dropped fell into two groups, both dead weight:
        //   - Global ones ("api", "menu", "orders", "analytics", "qr") named no
        //     restaurant, so their KV lists accumulated every key of that type
        //     across every tenant, without bound, and nothing invalidated by
        //     them.
        //   - Scoped ones ("menu:{id}", "orders:{id}", "payments:{id}") were
        //     already covered by `restaurant:{id}`. `menu:{id}` also stringified
        //     to the literal "menu:undefined" whenever the request had no
        //     restaurant scope.
        // Add a narrower tag back only alongside the invalidate() call that uses it.
        cacheTags: (c) => {
          const restaurantId = getRestaurantIdForCacheScope(c);
          return restaurantId ? [`restaurant:${restaurantId}`] : [];
        },
        shouldCache: (c) => {
          return isPublicApiCacheableRequest(c.req.method, c.req.path);
        },
      }),
    );
  }

  // Rate limiting is handled by geoIntelligentRateLimitMiddleware, registered above.

  app.use("*", logger()); // Seventh: Logging (after security checks)
  app.use("*", timing()); // Eighth: Performance timing
  app.use("*", prettyJSON()); // Ninth: JSON formatting
  if (observabilityEnabled) {
    app.use("*", metricsMiddleware()); // Tenth: Metrics collection
    app.use("*", errorMonitoringMiddleware()); // Eleventh: Error monitoring
    app.use("*", monitoringStatsMiddleware()); // Twelfth: Monitoring stats
  }

  // Unified error handler — single formatter for ALL thrown errors
  app.onError((err, c) => {
    // Log the original error server-side
    console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err);
    const requestId = c.get("requestId");

    if (err instanceof ApiError) {
      return c.json(
        {
          success: false,
          error: {
            code: err.code,
            message: ErrorSanitizer.sanitizeMessage(err.message),
            requestId,
            ...(err.details !== undefined && {
              details: sanitizeApiErrorDetails(err.details),
            }),
          },
        },
        toErrorResponseStatusCode(err.status),
      );
    }

    // Non-ApiError: auto-classify via ErrorSanitizer
    const sanitized = ErrorSanitizer.sanitizeError(err);

    const STATUS_MAP: Record<string, number> = {
      validation: 400,
      authentication: 401,
      authorization: 403,
      not_found: 404,
      rate_limit: 429,
      server_error: 500,
    };
    const status = STATUS_MAP[sanitized.type] ?? 500;

    return c.json(
      {
        success: false,
        error: {
          code: sanitized.code ?? "INTERNAL_ERROR",
          message: sanitized.message,
          requestId,
        },
      },
      toErrorResponseStatusCode(status),
    );
  });

  app.notFound((c) =>
    c.json(
      {
        success: false,
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `API endpoint not found: ${c.req.method} ${c.req.path}`,
        },
      },
      404,
    ),
  );

  // 基本健康檢查端點（向後兼容）
  app.get("/health", healthCheckMiddleware(), (c) =>
    c.redirect("/api/v1/monitoring/health"),
  );

  // API 資訊端點
  app.get("/info", (c) => {
    // Get deployment mode information
    const deploymentMode = c.env.DEPLOYMENT_MODE || "saas";
    const deploymentInfo =
      deploymentMode === "independent"
        ? {
            mode: deploymentMode,
            tenantId: c.env.TENANT_ID,
            tenantName: c.env.TENANT_NAME,
            platformVersion: c.env.PLATFORM_VERSION || "1.0.0",
          }
        : {
            mode: deploymentMode,
            platformVersion: c.env.PLATFORM_VERSION || "1.0.0",
          };

    return c.json({
      name: "MakanMasak API",
      version: c.env.API_VERSION || "v1",
      description: "RESTful API for MakanMasak restaurant management system",
      environment: c.env.NODE_ENV || "development",
      deployment: deploymentInfo,
      // Which built-but-unlaunched features are currently switched off. Served
      // here so "is this live?" is one public request instead of counting rows
      // in the production database. See shared/feature-adoption.ts.
      disabledFeatures: disabledFeatures(
        c.env as unknown as Record<string, unknown>,
      ),
      features: [
        "Restaurant management",
        "Menu management",
        "Order processing",
        "Real-time updates",
        "Multi-language support",
        "Role-based access control",
        "Coupon and discount management",
        "Comprehensive caching system",
        "Cache monitoring and management",
        "AI-powered business analytics",
        "Employee leave management",
        "Employee scheduling and shift management",
        "Table reservation management",
        "Waiting list and queue management",
        "Merchant partnership and institutional discount management",
      ],
      endpoints: {
        auth: "/api/v1/auth",
        restaurants: "/api/v1/restaurants",
        menu: "/api/v1/menu",
        orders: "/api/v1/orders",
        groupOrders: "/api/v1/orders/group",
        pos: "/api/v1/pos",
        queue: "/api/v1/queue",
        payments: "/api/v1/payments",
        // print: '/api/v1/print', // Disabled - incomplete feature
        tables: "/api/v1/tables",
        seats: "/api/v1/seats",
        users: "/api/v1/users",
        customers: "/api/v1/customers",
        analytics: "/api/v1/analytics",
        aiAnalytics: "/api/v1/ai-analytics",
        kitchen: "/api/v1/kitchen",
        sse: "/api/v1/sse",
        system: "/api/v1/system",
        qr: "/api/v1/qr",
        cache: "/api/v1/cache",
        monitoring: "/api/v1/monitoring",
        backup: "/api/v1/backup",
        coupons: "/api/v1/coupons",
        leaves: "/api/v1/leaves",
        scheduling: "/api/v1/scheduling",
        reservations: "/api/v1/reservations",
        serviceBookings: "/api/v1/service-bookings",
        waitingList: "/api/v1/waiting-list",
        realtime: "/api/v1/realtime",
        notifications: "/api/v1/notifications",
        push: "/api/v1/push",
        audit: "/api/v1/audit",
        partnerships: "/api/v1/partnerships",
        guestOrders: "/api/v1/guest-orders",
        marketCheckouts: "/api/v1/market-checkouts",
        credits: "/api/v1/credits",
        integrations: "/api/v1/integrations",
        ingredients: "/api/v1/ingredients",
        discovery: "/api/v1/discovery",
        markets: "/api/v1/markets",
        feedback: "/api/v1/feedback",
        billing: "/api/v1/billing",
        manager: "/api/v1/manager",
        auditLogs: "/api/v1/audit-logs",
        customer: "/api/v1/customer",
        me: "/api/v1/me",
        health: "/health",
        docs: "/docs",
      },
    });
  });

  // 路由註冊
  const apiV1 = new Hono<{ Bindings: Env }>();

  // These must be registered before every mounted feature route. Hono executes
  // matching middleware in registration order, so registering them later would
  // silently omit the early public-feature mounts below.
  apiV1.use("*", usageTracker);

  // Unlaunched features are refused here, ahead of every auth middleware, so
  // "this does not exist" does not depend on who is asking. Registered after
  // usageTracker only because Hono runs matching middleware in registration
  // order and these must precede the feature mounts below.
  //
  // A "/x/*" pattern also matches the bare "/x", which matters: the endpoint
  // that starts a market checkout is POST /api/v1/market-checkouts itself.
  for (const [prefix, key] of [
    ["/market-checkouts", "marketCheckouts"],
    // A market checkout can also be settled by a cashier through the POS
    // router, so the feature's public route prefix alone is not sufficient.
    ["/pos/market-checkouts/*/pay", "marketCheckouts"],
    ["/credits", "storedValueCredits"],
    // Service bookings use stored-value credits without going through /credits.
    ["/service-bookings/*/pay", "storedValueCredits"],
    ["/backup", "tenantBackups"],
    ["/push", "webPush"],
    // Not a prefix of its own feature: customer-app subscribes through the
    // customer router, so gating only /push would let a customer opt into
    // notifications that /push then refuses to deliver.
    ["/customer/push-subscriptions", "webPush"],
  ] as const) {
    apiV1.use(`${prefix}/*`, featureGate(key));
  }

  // Apply CSRF protection to state-changing operations. Protected endpoints
  // retain their route-level authentication middleware.
  apiV1.use(
    "*",
    csrfProtection({
      excludePaths: [
        "/api/v1/auth/login",
        "/api/v1/auth/register",
        "/api/v1/customer/auth",
        "/api/v1/monitoring/health",
        "/api/v1/sse", // SSE connections should not be CSRF protected
        "/api/v1/queue/public", // Public queue endpoints
        "/api/v1/qr/scan", // Public QR scanning
        "/api/v1/coupons/validate", // Public coupon validation
        "/api/v1/partnerships/members/verify", // Public member verification application
        "/api/v1/partnerships/plans/validate", // Public plan validation for cashiers
        "/api/v1/guest-orders", // Guest ordering (no session, uses KV tokens)
        // Customer self-service flows on features mounted before this
        // middleware used to bypass CSRF entirely; once the ordering was
        // fixed they started 403ing. None of them use a session cookie —
        // they authorise by possession (customer phone in the body, a verify
        // code, or an optional customer token) — so CSRF adds nothing.
        //
        // These are deliberately exact or single-segment patterns. A bare
        // prefix like "/api/v1/waiting-list" would also exempt the staff
        // routes under it (POST /:id/call), undoing the protection this
        // exclusion list exists to preserve.
        "/api/v1/waiting-list$", // exact: POST / (join)
        "/api/v1/waiting-list/*/confirm",
        "/api/v1/reservations$", // exact: POST / (create)
        "/api/v1/reservations/*/cancel",
        "/api/v1/service-bookings$", // exact: POST / (create)
        "/api/v1/service-bookings/recurring",
        "/api/v1/service-bookings/waitlist",
        "/api/v1/service-bookings/*/pay",
        "/api/v1/service-bookings/verify/*/cancel",
        "/api/v1/orders/group/create$", // exact: guest host creates a group order
        "/api/v1/orders/group/join/*", // members join by possession of a share code
        "/api/v1/orders/group/*/cart", // cart root and /cart/:itemId
        "/api/v1/orders/group/*/lock", // host submits with memberToken
        "/api/v1/orders/group/*/auto-submit", // host toggles expiry auto-submit
        "/api/v1/orders/group/*/fee-mode", // host chooses who carries the fees
        "/api/v1/orders/group/*/split-type", // host chooses the split method
        "/api/v1/orders/group/*/recover", // host recovers by recovery code
        "/api/v1/orders/group/*/split",
        "/api/v1/orders/group/*/payment/*",
        "/api/v1/orders/group/*/leave/*",
        // Local print agents are Node daemons, not browsers: they send no
        // cookie, no Origin and no Referer, so both CSRF layers reject them
        // outright and every acknowledgement 403s — leaving claimed receipts
        // stuck in "printing" forever. They authenticate by possession of the
        // print-agent key, same as the webhook entries below.
        //
        // Scoped to /jobs rather than the whole feature: anything added under
        // /print later that a browser drives does use a session, and a bare
        // "/api/v1/print" would exempt it silently.
        // A diner reviews an order by presenting the same bearer token that
        // tracked it — a customer JWT or a KV guest token. Neither is a
        // cookie, so the browser never attaches either one to a cross-site
        // request and there is nothing for CSRF to defend; requiring a token
        // here would simply lock guests out of reviewing, exactly as it did
        // for the customer self-service flows above.
        "/api/v1/orders/*/review",
        "/api/v1/print/jobs",
        "/api/v1/realtime/auth", // Public WebSocket token exchange; uses scoped tokens instead of session cookies
        "/api/v1/integrations/webhooks", // Platform webhooks (HMAC verified, no session)
        "/api/v1/billing/webhooks", // Billing provider webhooks (HMAC/idempotency verified)
        "/api/v1/payments", // Payment requests are protected by auth + idempotency
        // SECURITY: Removed testing exclusions for shop QR endpoints - all state-changing operations now require CSRF tokens
      ],
    }),
  );

  // 公開路由（無需認證）
  // Attach CSRF tokens to auth responses
  apiV1.use("/auth/*", attachCSRFToken());
  apiV1.route("/auth", authFeature.routes);
  apiV1.route("/auth", verificationFeature.routes); // Password reset, email/phone verification
  // apiV1.route('/health', healthRouter) // Replaced with modular System feature (/system/health)
  apiV1.route("/qr", qrCodesFeature.routes);
  apiV1.route("/queue", queueFeature.routes); // 統一候位系統 (public + protected endpoints)
  // apiV1.route('/payments/webhook', paymentsRouter) // Payment webhooks 無需認證 - Disabled
  apiV1.route("/coupons", couponsFeature.routes); // 優惠券驗證端點為公開，管理端點需要認證
  apiV1.route("/reservations", reservationsFeature); // 訂位系統 (public + protected endpoints)
  apiV1.route("/service-bookings", serviceBookingsFeature); // 預約服務 (public + protected endpoints)
  apiV1.route("/waiting-list", waitingListFeature); // 候位系統 (public + protected endpoints)
  apiV1.route("/realtime", realtimeRoutes); // WebSocket 認證端點為公開
  apiV1.route("/partnerships", partnershipsRoutes); // 特約商店體系 (部分公開端點 + 受保護端點)
  apiV1.route("/guest-orders", guestOrdersRoutes); // 訪客點餐 (KV-based guest token auth)
  apiV1.route("/market-checkouts", marketCheckoutsFeature.routes); // 市場多攤位訪客結帳
  apiV1.route("/credits", creditsFeature.routes); // 代幣儲值卡 (查餘額公開限流, 管理端點 admin)
  apiV1.route("/restaurants", membersFeature.routes);
  apiV1.route("/integrations", integrationsFeature.routes); // 外送平台串接 (webhooks 公開 HMAC 驗證, 管理端點內部驗證)

  apiV1.use("*", async (c, next) => {
    if (
      !hasConcreteApiRoute(
        apiV1.routes as HonoRoute[],
        c.req.path,
        c.req.method,
      )
    ) {
      return c.json(apiV1RouteNotFound(c.req.method, c.req.path), 404);
    }

    await next();
  });

  // 受保護的路由（需要認證）
  // Note: /restaurants/* uses optionalAuth globally because GET routes are public (list, details, popular, nearby)
  // Write operations (POST, PUT, DELETE) have route-level authMiddleware + requireRole guards
  apiV1.use("/restaurants/*", optionalAuth);
  // Note: /menu/* uses optionalAuth globally because GET routes are public (menu listing, featured, popular, search)
  // Write operations (POST, PUT, DELETE) have route-level authMiddleware + requireRole guards
  apiV1.use("/menu/*", optionalAuth);
  // Kitchen routes handle auth at the route level so the /events SSE endpoint
  // can use sseAuthMiddleware (token via query param — EventSource cannot send
  // Authorization headers). All /kitchen/* routes have per-route authMiddleware.
  //
  // Orders + group-orders handle auth at the route level too. A blanket
  // `use("/orders/*", staffOrUserCustomerAuthMiddleware)` here would run BEFORE
  // the mounted sub-apps (Hono executes matching middleware in registration
  // order, and this block precedes the `apiV1.route("/orders/...")` mounts
  // below), gating the intentionally-anonymous group-order share-code routes
  // (join/cart/split/payment/leave) that authenticate via share code instead of
  // a JWT. Every protected orders/group-orders route already carries its own
  // per-route customerAuthMiddleware/authMiddleware, so no blanket gate is
  // needed — mirroring the tables/seats/menu convention.
  apiV1.use("/pos/*", authMiddleware);
  apiV1.use("/pos/*", moduleGate("pos"));
  apiV1.use("/payments/*", authMiddleware);
  apiV1.use("/payments/*", moduleGate("online_ordering"));
  // apiV1.use('/print/*', authMiddleware) // Disabled - incomplete feature
  // Tables routes handle auth at the route level so public QR lookups
  // (`GET /tables/qr/:qrCode`) remain reachable without a bearer token.
  // Seats routes follow the same convention: every route carries its own
  // per-route authMiddleware + requireRole, and the designed-public
  // `GET /seats/qr/:qrCode` lookup is intentionally left unauthenticated.
  // A blanket `use("/seats/*", authMiddleware)` here would defeat that.
  apiV1.use("/users/*", authMiddleware);
  apiV1.use("/analytics/*", authMiddleware);
  apiV1.use("/ai-analytics/*", authMiddleware);
  // SSE auth is handled at route level (sseAuthMiddleware) to support token via query param
  apiV1.use("/system/*", async (c, next) => {
    // The exemption covers the cheap read-only health probe only. `?deep=1`
    // swaps in a KV write probe and records uptime evidence, so it goes
    // through auth like the rest of /system/*. `c.req.path` carries no query
    // string, so without the second clause the flag would hand anonymous
    // callers exactly the write-quota burn the default probe avoids (#324).
    if (
      c.req.path === "/api/v1/system/health" &&
      !isDeepHealthRequest(c.req.url)
    ) {
      await next();
      return;
    }
    await authMiddleware(c, next);
  });
  apiV1.use("/cache/*", authMiddleware);
  apiV1.use("/monitoring/*", async (c, next) => {
    if (c.req.path === "/api/v1/monitoring/health") {
      await next();
      return;
    }
    await authMiddleware(c, next);
  });
  apiV1.use("/backup/*", authMiddleware);
  apiV1.use("/leaves/*", authMiddleware);
  apiV1.use("/leaves/*", moduleGate("staff_management"));
  apiV1.use("/scheduling/*", authMiddleware);
  apiV1.use("/scheduling/*", moduleGate("staff_management"));
  apiV1.use("/forecast/*", authMiddleware);
  // /forecast/* is gated per route: demand forecasting is "analytics",
  // ingredient forecasting is "inventory" (see features/forecast/routes).
  apiV1.use("/ingredients/*", authMiddleware);
  apiV1.use("/ingredients/*", moduleGate("inventory"));
  // Feedback is the shop's support-ticket channel (see
  // features/feedback/routes/index.ts POST /). It must never be gated behind
  // a paid module — a shop that can't reach support because it's on the
  // basic plan is a worse failure than a shop reaching support for free.
  // (Previously gated on "analytics", which 403'd basic-tier owners out of
  // the only ticket-creation path.)
  apiV1.use("/feedback/*", authMiddleware);
  apiV1.use("/notifications/*", authMiddleware);
  apiV1.use("/partnerships/*", authMiddleware);
  // Note: /integrations/* auth is handled internally (webhooks are public with HMAC, admin routes use authMiddleware)

  apiV1.route("/restaurants", restaurantsFeature.routes);
  apiV1.route("/menu", menuFeature.routes);
  apiV1.route("/kitchen", kitchenFeature.routes);
  apiV1.route("/orders/group", groupOrdersFeature.routes);
  apiV1.route("/orders", ordersFeature.routes);
  // POST/GET /orders/:id/review (#286). Mounted after the orders feature so
  // the two routers share the prefix without either owning the other's paths;
  // both routes authorise through the order's own identity, not a role.
  apiV1.route("/orders", reviewsFeature.orderRoutes);
  apiV1.route("/pos", posFeature.routes);
  apiV1.route("/payments", paymentsFeature.routes);
  // Manager feature mounts on two independent paths — /manager hosts the
  // delegation-aware action endpoint and /audit-logs is the admin-only read
  // path for audit rows produced by that action.
  apiV1.route("/manager", managerFeature.actionsRoutes);
  apiV1.route("/audit-logs", managerFeature.auditLogsRoutes);
  apiV1.route("/print", printRoutes);
  apiV1.route("/tables", tablesFeature.routes);
  apiV1.route("/seats", seatsFeature.routes);
  apiV1.route("/users", usersFeature.routes);
  apiV1.route("/analytics", analyticsFeature.routes);
  apiV1.route("/ai-analytics", aiAnalyticsFeature.routes);
  apiV1.route("/sse", sseFeature.routes);
  apiV1.route("/system", systemFeature.routes);
  apiV1.route("/cache", cacheFeature);
  apiV1.route("/monitoring", monitoringFeature.routes);
  apiV1.route("/backup", BackupRoutes);
  apiV1.route("/customer", customerRouter);
  apiV1.route("/customers", customersRouter);
  apiV1.route("/leaves", leavesFeature.routes);
  apiV1.route("/scheduling", schedulingFeature.routes);
  apiV1.route("/forecast", forecastFeature.routes);
  apiV1.route("/ingredients", ingredientsFeature.routes);
  apiV1.route("/discovery", discoveryFeature.routes);
  apiV1.route("/markets", marketsFeature.routes);
  apiV1.route("/feedback", feedbackFeature.routes);
  apiV1.route("/alerts", alertsFeature.routes); // 店主營運告警 (#285) — admin/owner only
  apiV1.route("/billing", billingFeature.routes);
  apiV1.route("/me", meFeature.routes);
  apiV1.route("/notifications", notificationsRoutes);
  apiV1.route("/push", pushRoutes);
  apiV1.route("/audit", auditRoutes);

  // Admin-only routes — auth + role=0 enforced inside the feature module itself
  apiV1.use("/admin/*", authMiddleware);
  apiV1.route("/admin", adminSettingsRoutes);
  apiV1.route("/admin/markets", marketsFeature.adminRoutes);
  // Platform-side customer directory (#299 A4). Keyed on customers.id, which
  // only role 0 may ever see — the tenant router mounted on /restaurants above
  // deliberately cannot produce one.
  apiV1.route("/admin/customers", membersFeature.adminRoutes);
  apiV1.route("/admin/subscriptions", subscriptionsFeature.routes);

  // 掛載 API 路由
  app.route("/api/v1", apiV1);

  app.route("/", marketsFeature.seoRoutes);

  // 根路徑重定向到 API 資訊
  app.get("/", (c) => {
    return c.redirect("/info");
  });

  return app;
}
