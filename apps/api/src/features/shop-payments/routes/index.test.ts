/**
 * Route-level behaviour: who may touch whose credentials, and what comes back.
 *
 * The service is mocked so these tests say something about the routes rather
 * than about D1 — `ShopPaymentCredentialService.test.ts` owns storage. The one
 * thing deliberately *not* mocked away is the response shape: every assertion
 * about secrets is made against the serialized body, so a future field that
 * leaks one fails here rather than in production.
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";

const auth = vi.hoisted(() => ({
  user: {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  } as AuthUser,
}));

vi.mock("../../../shared/middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../shared/middleware")>();
  return {
    ...actual,
    authMiddleware: vi.fn(async (c: never, next: () => Promise<void>) => {
      (c as { set: (k: string, v: unknown) => void }).set("user", auth.user);
      await next();
    }),
    requireRole: vi.fn(
      () => async (_c: unknown, next: () => Promise<void>) => next(),
    ),
  };
});

const serviceMock = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  connect: vi.fn(),
  update: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../services/ShopPaymentCredentialService", () => ({
  // A plain arrow is not constructible, and `validateBody` wraps `next()` in
  // its own try/catch — so a TypeError from `new Service()` would come back as
  // a 400 "invalid JSON" rather than as the failure it is.
  ShopPaymentCredentialService: class {
    constructor() {
      return serviceMock;
    }
  },
}));

const { default: routes } = await import("./index");

/** What the service returns: masked, secret-free, never the raw merchant id. */
function buildView(overrides: Record<string, unknown> = {}) {
  return {
    id: "cred-1",
    restaurantId: "rest-1",
    provider: "tng",
    status: "connected",
    merchantIdMasked: "••••7788",
    displayName: "Jalan Alor stall",
    environment: "sandbox",
    config: {},
    secretConfigured: true,
    secretUpdatedAtMs: 1_700_000_000_000,
    connectedAtMs: 1_700_000_000_000,
    disabledAtMs: null,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/shop-payments", routes as never);
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(
        { success: false, error: { code: error.code, message: error.message } },
        error.status as 400,
      );
    }
    throw error;
  });
  return app;
}

async function call(path: string, init?: RequestInit) {
  const response = await buildApp().fetch(
    new Request(`https://test/shop-payments${path}`, init),
  );
  return { response, body: await response.text() };
}

function jsonBody(payload: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

const CONNECT_BODY = {
  merchantId: "TNG-MERCHANT-7788",
  displayName: "Jalan Alor stall",
  environment: "sandbox",
  secret: { merchantKey: "super-secret-key", webhookSecret: "hook-secret" },
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  } as AuthUser;
  serviceMock.list.mockResolvedValue([buildView()]);
  serviceMock.get.mockResolvedValue(buildView());
  serviceMock.connect.mockResolvedValue(buildView());
  serviceMock.update.mockResolvedValue(buildView());
  serviceMock.disconnect.mockResolvedValue(undefined);
});

describe("tenancy", () => {
  it.each([
    ["GET", "/rest-2", undefined],
    ["GET", "/rest-2/tng", undefined],
    ["POST", "/rest-2/tng/connect", jsonBody(CONNECT_BODY)],
    [
      "PUT",
      "/rest-2/tng",
      { method: "PUT", headers: {}, body: "{}" } as RequestInit,
    ],
    ["DELETE", "/rest-2/tng", { method: "DELETE" } as RequestInit],
  ])(
    "refuses an owner reaching another restaurant with %s %s",
    async (_method, path, init) => {
      const { response, body } = await call(path, init);

      expect(response.status).toBe(403);
      expect(JSON.parse(body).error.code).toBe(
        "SHOP_PAYMENT_CREDENTIAL_FORBIDDEN",
      );
      // The guard runs before the service, so nothing about the other
      // restaurant is read, not even to decide the status code.
      expect(serviceMock.list).not.toHaveBeenCalled();
      expect(serviceMock.get).not.toHaveBeenCalled();
      expect(serviceMock.connect).not.toHaveBeenCalled();
      expect(serviceMock.update).not.toHaveBeenCalled();
      expect(serviceMock.disconnect).not.toHaveBeenCalled();
    },
  );

  it("refuses an owner with no restaurant of their own", async () => {
    auth.user = { id: "user-9", role: 1, restaurantId: null } as AuthUser;
    const { response } = await call("/rest-1");
    expect(response.status).toBe(403);
  });

  it("lets a platform admin act for any restaurant", async () => {
    auth.user = { id: "1", role: 0, restaurantId: null } as AuthUser;
    const { response } = await call("/rest-2");

    expect(response.status).toBe(200);
    expect(serviceMock.list).toHaveBeenCalledWith("rest-2");
  });

  it("lets an owner act on their own restaurant", async () => {
    const { response } = await call("/rest-1");
    expect(response.status).toBe(200);
    expect(serviceMock.list).toHaveBeenCalledWith("rest-1");
  });
});

describe("secrets are write-only", () => {
  it("does not echo the submitted secret back on connect", async () => {
    const { response, body } = await call(
      "/rest-1/tng/connect",
      jsonBody(CONNECT_BODY),
    );

    expect(response.status).toBe(201);
    expect(body).not.toContain("super-secret-key");
    expect(body).not.toContain("hook-secret");
    expect(body).not.toContain("TNG-MERCHANT-7788");
    expect(JSON.parse(body).data).toEqual(
      expect.objectContaining({
        merchantIdMasked: "••••7788",
        secretConfigured: true,
      }),
    );
  });

  it("passes the secret to the service and records who wrote it", async () => {
    await call("/rest-1/tng/connect", jsonBody(CONNECT_BODY));

    expect(serviceMock.connect).toHaveBeenCalledOnce();
    expect(serviceMock.connect).toHaveBeenCalledWith(
      "rest-1",
      "tng",
      expect.objectContaining({
        merchantId: "TNG-MERCHANT-7788",
        secret: expect.objectContaining({ merchantKey: "super-secret-key" }),
      }),
      "user-7",
    );
  });

  it.each([
    ["GET", "/rest-1", undefined],
    ["GET", "/rest-1/tng", undefined],
  ])("returns no secret material from %s %s", async (_m, path, init) => {
    const { body } = await call(path, init);
    expect(body).not.toMatch(
      /secretPayload|merchantKey|clientSecret|webhookSecret/,
    );
  });
});

describe("validation", () => {
  it("404s an unknown provider rather than storing it", async () => {
    const { response, body } = await call(
      "/rest-1/paypal/connect",
      jsonBody(CONNECT_BODY),
    );

    expect(response.status).toBe(404);
    expect(JSON.parse(body).error.code).toBe(
      "SHOP_PAYMENT_PROVIDER_UNSUPPORTED",
    );
    expect(serviceMock.connect).not.toHaveBeenCalled();
  });

  it("rejects a connect with no merchant id", async () => {
    const { response } = await call(
      "/rest-1/tng/connect",
      jsonBody({ ...CONNECT_BODY, merchantId: "" }),
    );
    expect(response.status).toBe(400);
    expect(serviceMock.connect).not.toHaveBeenCalled();
  });

  it("rejects an empty update instead of writing an empty patch", async () => {
    const { response, body } = await call("/rest-1/tng", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(400);
    expect(JSON.parse(body).error.code).toBe("NO_CHANGES");
    expect(serviceMock.update).not.toHaveBeenCalled();
  });

  it("lists the providers a shop may connect", async () => {
    const { body } = await call("/rest-1");
    expect(JSON.parse(body).data.supportedProviders).toEqual([
      "tng",
      "grabpay",
    ]);
  });

  it("404s a provider the shop has not connected", async () => {
    serviceMock.get.mockResolvedValue(null);
    const { response, body } = await call("/rest-1/grabpay");

    expect(response.status).toBe(404);
    expect(JSON.parse(body).error.code).toBe(
      "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
    );
  });

  it("disconnects and says so", async () => {
    const { response, body } = await call("/rest-1/tng", { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(JSON.parse(body).data).toEqual({
      provider: "tng",
      status: "disconnected",
    });
    expect(serviceMock.disconnect).toHaveBeenCalledWith("rest-1", "tng");
  });

  it("records no actor when the token carries no user id", async () => {
    auth.user = { role: 0, restaurantId: null } as unknown as AuthUser;
    await call("/rest-1/tng/connect", jsonBody(CONNECT_BODY));

    expect(serviceMock.connect).toHaveBeenCalledWith(
      "rest-1",
      "tng",
      expect.any(Object),
      null,
    );
  });

  it("treats an omitted display name as none rather than dropping the field", async () => {
    const { merchantId, secret } = CONNECT_BODY;
    await call("/rest-1/grabpay/connect", jsonBody({ merchantId, secret }));

    expect(serviceMock.connect).toHaveBeenCalledWith(
      "rest-1",
      "grabpay",
      expect.objectContaining({ displayName: null, environment: undefined }),
      "user-7",
    );
  });

  it("passes every editable field through on an update", async () => {
    await call("/rest-1/tng", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        merchantId: "TNG-MERCHANT-9900",
        displayName: null,
        environment: "production",
        secret: { clientSecret: "rotated" },
        config: { note: "second outlet" },
        status: "connected",
      }),
    });

    expect(serviceMock.update).toHaveBeenCalledWith(
      "rest-1",
      "tng",
      {
        merchantId: "TNG-MERCHANT-9900",
        displayName: null,
        environment: "production",
        secret: { clientSecret: "rotated" },
        config: { note: "second outlet" },
        status: "connected",
      },
      "user-7",
    );
  });

  it("updates only the fields that were sent", async () => {
    await call("/rest-1/tng", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "disabled" }),
    });

    expect(serviceMock.update).toHaveBeenCalledWith(
      "rest-1",
      "tng",
      { status: "disabled" },
      "user-7",
    );
  });
});
