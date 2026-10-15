import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceState = vi.hoisted(() => ({
  shouldThrow: false,
  instances: [] as unknown[],
}));

vi.mock("./routes", async () => {
  const { Hono } = await import("hono");
  const routes = new Hono();
  routes.get("/ping", (c) => c.json({ ok: true }));
  routes.get("/fail", () => {
    throw new Error("route failed");
  });
  return { default: routes };
});

vi.mock("./services/OrdersService", () => ({
  OrdersService: vi.fn(function OrdersService(this: { env: unknown }, env) {
    if (serviceState.shouldThrow) {
      throw new Error("service unavailable");
    }
    this.env = env;
    serviceState.instances.push(this);
  }),
}));

import ordersFeature, {
  createOrdersModule,
  OrdersModule,
  OrdersService,
} from "./index";

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    DB: {},
    CACHE_KV: {},
    API_BASE_URL: "https://api.example.test",
    INTERNAL_API_TOKEN: "internal-token",
    NODE_ENV: "test",
    ...overrides,
  };
}

describe("orders feature module", () => {
  // The module logs each failure it reports; several tests drive those on purpose.
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await ordersFeature.cleanup();
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    serviceState.shouldThrow = false;
    serviceState.instances.length = 0;
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  const expectErrorLogged = (text: string) =>
    expect(
      errorSpy.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes(text),
      ),
    ).toBe(true);

  it("creates a singleton module with mounted routes and metadata", async () => {
    const first = createOrdersModule();
    const second = createOrdersModule();

    expect(first).toBe(second);
    expect(first).toBeInstanceOf(OrdersModule);
    expect(first.name).toBe("orders");
    expect(first.version).toBe("1.0.0");

    first.routes.get("/instrumented", (c) => c.json({ instrumented: true }));

    const response = await first.routes.request("/ping", {
      headers: { "User-Agent": "vitest" },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const instrumented = await first.routes.request("/instrumented", {
      headers: { "User-Agent": "vitest" },
    });
    expect(instrumented.status).toBe(200);
    expect(instrumented.headers.get("X-Feature-Module")).toBe("orders");
    expect(instrumented.headers.get("X-Feature-Version")).toBe("1.0.0");
    expect(instrumented.headers.get("X-Response-Time")).toMatch(/ms$/);
  });

  it("reuses the OrdersService instance until cleanup resets it", async () => {
    const module = createOrdersModule();
    const env = createEnv();

    const first = module.getService(env as never);
    const second = module.getService(
      createEnv({ DB: { other: true } }) as never,
    );

    expect(first).toBe(second);
    expect(OrdersService).toHaveBeenCalledTimes(1);

    await module.cleanup();
    const third = module.getService(env as never);
    expect(third).not.toBe(first);
    expect(OrdersService).toHaveBeenCalledTimes(2);
  });

  it("reports health with dependency state and service instantiation failures", () => {
    expect(createOrdersModule().getHealthStatus()).toMatchObject({
      name: "orders",
      version: "1.0.0",
      status: "healthy",
      dependencies: {
        database: "unknown",
        cache: "unknown",
        orderService: "available",
      },
      features: {
        orderCreation: true,
        couponIntegration: true,
        permissionSystem: true,
      },
    });

    expect(
      createOrdersModule().getHealthStatus(createEnv() as never),
    ).toMatchObject({
      status: "healthy",
      dependencies: {
        database: "connected",
        cache: "connected",
        orderService: "healthy",
      },
    });

    createOrdersModule().cleanup();
    serviceState.shouldThrow = true;
    expect(
      createOrdersModule().getHealthStatus(createEnv() as never),
    ).toMatchObject({
      status: "unhealthy",
      dependencies: { orderService: "failed" },
    });
    expectErrorLogged("Health check failed for OrdersService");
  });

  it("returns empty metrics structure and propagates service creation errors", async () => {
    await expect(
      createOrdersModule().getFeatureMetrics(createEnv() as never),
    ).resolves.toEqual({
      performance: {
        averageResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        requestsPerSecond: 0,
        errorRate: 0,
      },
      usage: {
        totalOrders: 0,
        ordersToday: 0,
        activeOrders: 0,
        popularOrderTypes: [],
        topRestaurants: [],
      },
      errors: {
        totalErrors: 0,
        errorsByType: {},
        recentErrors: [],
      },
    });

    await createOrdersModule().cleanup();
    serviceState.shouldThrow = true;
    await expect(
      createOrdersModule().getFeatureMetrics(createEnv() as never),
    ).rejects.toThrow("service unavailable");
    expectErrorLogged("Failed to get feature metrics");
  });

  it("validates required configuration and initializes only valid environments", async () => {
    const module = createOrdersModule();

    expect(
      module.validateConfiguration(
        createEnv({ DB: undefined, CACHE_KV: undefined }) as never,
      ),
    ).toEqual({
      valid: false,
      issues: [
        "Database (DB) binding is required",
        "Cache KV namespace is required",
      ],
    });

    await expect(
      module.initialize(createEnv({ DB: undefined }) as never),
    ).rejects.toThrow(
      "Orders feature configuration validation failed: Database (DB) binding is required",
    );
    expectErrorLogged("configuration validation failed");

    await expect(
      module.initialize(createEnv() as never),
    ).resolves.toBeUndefined();
    expect(OrdersService).toHaveBeenCalledTimes(1);
  });

  it("default export proxies module operations", async () => {
    const env = createEnv();

    expect(ordersFeature.routes).toBe(createOrdersModule().routes);
    expect(ordersFeature.validateConfiguration(env as never)).toEqual({
      valid: true,
      issues: [],
    });
    expect(ordersFeature.getHealthStatus()).toMatchObject({
      name: "orders",
      status: "healthy",
    });
    await expect(
      ordersFeature.getFeatureMetrics(env as never),
    ).resolves.toMatchObject({
      usage: { totalOrders: 0 },
    });
    await expect(
      ordersFeature.initialize(env as never),
    ).resolves.toBeUndefined();
    expect(ordersFeature.getService(env as never)).toBe(
      createOrdersModule().getService(env as never),
    );
    await expect(ordersFeature.cleanup()).resolves.toBeUndefined();
  });

  it("logs and rethrows route middleware failures", async () => {
    const response = await createOrdersModule().routes.request("/fail", {
      headers: { "User-Agent": "vitest" },
    });

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalled();
  });
});
