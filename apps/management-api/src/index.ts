/**
 * MakanMasak Management API
 *
 * Central management platform for hybrid deployment strategy.
 * Handles tenant management, resource provisioning, and health monitoring.
 */

import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import { timing } from "hono/timing";
import { ApiError, sanitizeApiErrorDetails } from "@makanmasak/utils";

import type { ManagementEnv } from "./types";
import { managementAuthMiddleware } from "./middleware/auth";
import tenantsRouter from "./routes/tenants";
import deploymentsRouter from "./routes/deployments";
import licensesRouter, { publicLicensesRouter } from "./routes/licenses";
import healthRouter from "./routes/health";
import monitoringRouter from "./routes/monitoring";
import updatesRouter from "./routes/updates";
import onboardingRouter from "./routes/onboarding";
import authRouter from "./routes/auth";
import adminOnboardingRouter from "./routes/admin-onboarding";
import { adminMarketsRouter, marketsRouter } from "./routes/markets";
import internalRouter from "./routes/internal";

// Create main application
const app = new Hono<{ Bindings: ManagementEnv }>();

function resolveCorsOrigin(
  origin: string,
  allowedOrigins: string,
): string | null {
  if (!origin) return null;
  if (!allowedOrigins || allowedOrigins.trim() === "*") return null;

  const allowlist = allowedOrigins
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return allowlist.includes(origin) ? origin : null;
}

// ============================================================
// Global Middleware
// ============================================================

// CORS configuration
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      return resolveCorsOrigin(origin, c.env.CORS_ORIGIN);
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Onboarding-Secret",
    ],
    exposeHeaders: ["X-Request-ID", "X-Response-Time"],
    credentials: true,
    maxAge: 86400,
  }),
);

app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.get("Access-Control-Allow-Origin")) {
    c.res.headers.delete("Access-Control-Allow-Credentials");
  }
});

// Logging and timing
app.use("*", logger());
app.use("*", timing());
app.use("*", prettyJSON());

// Request ID middleware
app.use("*", async (c, next) => {
  const requestId = c.req.header("X-Request-ID") || crypto.randomUUID();
  c.header("X-Request-ID", requestId);
  await next();
});

// ============================================================
// Error Handling
// ============================================================

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details:
            err.details === undefined
              ? undefined
              : sanitizeApiErrorDetails(err.details),
        },
      },
      err.status as 400 | 401 | 403 | 404 | 409 | 429 | 500,
    );
  }

  console.error("[ManagementAPI] Error:", err);

  const isDev = c.env.NODE_ENV === "development";

  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: isDev ? err.message : "Internal server error",
      },
    },
    500,
  );
});

app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Endpoint not found",
      },
    },
    404,
  );
});

// ============================================================
// Root Endpoints
// ============================================================

// Health check (public)
app.get("/health", (c) => {
  return c.json({
    success: true,
    data: {
      status: "healthy",
      service: "management-api",
      version: c.env.API_VERSION,
      timestamp: new Date().toISOString(),
    },
  });
});

// API info (public)
app.get("/info", (c) => {
  return c.json({
    name: "MakanMasak Management API",
    version: c.env.API_VERSION || "v1",
    description: "Central management platform for MakanMasak hybrid deployment",
    environment: c.env.NODE_ENV || "development",
    features: [
      "Tenant management",
      "Resource provisioning",
      "License management",
      "Health monitoring",
      "Deployment automation",
      "Batch version updates",
      "Alert system",
      "Self-service onboarding",
    ],
    endpoints: {
      tenants: "/api/v1/tenants",
      deployments: "/api/v1/deployments",
      licenses: "/api/v1/licenses",
      health: "/api/v1/health",
      monitoring: "/api/v1/monitoring",
      updates: "/api/v1/updates",
      onboarding: "/api/v1/onboarding",
    },
  });
});

// Root redirect
app.get("/", (c) => c.redirect("/info"));

// ============================================================
// API Routes
// ============================================================

// Public routes (no auth required)
const publicApi = new Hono<{ Bindings: ManagementEnv }>();
publicApi.route("/auth", authRouter);
publicApi.route("/onboarding", onboardingRouter);
publicApi.route("/markets", marketsRouter);
// POST /licenses/verify is designed for cross-service calls that authenticate
// via the licenseKey payload itself. Mounting it on the public API (registered
// before the Bearer-protected /licenses/* block below) keeps it reachable while
// every other /licenses/* route stays protected.
publicApi.route("/licenses", publicLicensesRouter);

// Protected routes (auth required)
const protectedApi = new Hono<{ Bindings: ManagementEnv }>();
// Auth is scoped to the known protected prefixes (not use("*")) so that
// unmatched /api/v1/* paths fall through to the 404 handler instead of 401.
// Unknown subpaths UNDER a protected prefix still 401 before 404.
// Hono's "/prefix/*" does not match "/prefix" itself, hence both forms.
const PROTECTED_PREFIXES = [
  "/health",
  "/tenants",
  "/deployments",
  "/licenses",
  "/monitoring",
  "/updates",
  "/admin",
];
for (const prefix of PROTECTED_PREFIXES) {
  protectedApi.use(prefix, managementAuthMiddleware);
  protectedApi.use(`${prefix}/*`, managementAuthMiddleware);
}
protectedApi.route("/health", healthRouter);
protectedApi.route("/tenants", tenantsRouter);
protectedApi.route("/deployments", deploymentsRouter);
protectedApi.route("/licenses", licensesRouter);
protectedApi.route("/monitoring", monitoringRouter);
protectedApi.route("/updates", updatesRouter);
protectedApi.route("/admin/markets", adminMarketsRouter);
protectedApi.route("/admin/onboarding", adminOnboardingRouter);

// Mount API versions
app.route("/api/v1", publicApi);
app.route("/api/v1/internal", internalRouter);
app.route("/api/v1", protectedApi);

// ============================================================
// Export
// ============================================================

export default app;
