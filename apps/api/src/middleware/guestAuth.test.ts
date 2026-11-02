import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  GUEST_DEVICE_ID_HEADER,
  getGuestDeviceId,
  guestActiveOrderKey,
  guestSessionAuth,
  guestTokenAuth,
  resolveGuestLockIdentity,
} from "./guestAuth";
import { ApiError } from "../shared/utils/api-error";

/**
 * The middleware throws ApiError and leaves rendering to the app-wide handler
 * that app-factory installs. A bare `new Hono()` has none, so Hono's default
 * answers with plain-text "Internal Server Error" and every assertion on the
 * JSON body fails. Each test app gets the same handler instead.
 */
function appWithErrorHandler(): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { success: false, error: { code: err.code, message: err.message } },
        err.status as 400 | 401 | 403 | 404 | 409 | 500,
      );
    }
    return c.json({ success: false, error: { message: String(err) } }, 500);
  });
  return app;
}

function createKv(value: unknown) {
  return {
    get: vi.fn(async () => value),
  };
}

describe("guestTokenAuth", () => {
  it("rejects missing guest bearer tokens", async () => {
    const app = appWithErrorHandler();
    app.use("/orders/:id", guestTokenAuth);
    app.get("/orders/:id", (c) => c.json({ guest: c.get("guestOrder") }));

    const response = await app.fetch(
      new Request("https://api.test/orders/order-1"),
      { CACHE_KV: createKv(null) } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "MISSING_AUTH_TOKEN",
        message: "Missing or invalid guest token",
      },
    });
    expect(response.status).toBe(401);
  });

  it("rejects guest tokens bound to a different order id", async () => {
    const app = appWithErrorHandler();
    app.use("/orders/:id", guestTokenAuth);
    app.get("/orders/:id", (c) => c.json({ guest: c.get("guestOrder") }));

    const response = await app.fetch(
      new Request("https://api.test/orders/order-2", {
        headers: { Authorization: "Bearer gt_abc" },
      }),
      {
        CACHE_KV: createKv({
          orderId: "order-1",
          restaurantId: "rest-1",
          guestName: "Ada",
          phoneLastDigits: "1234",
          createdAt: Date.now(),
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {
        code: "ACCESS_DENIED",
        message: "Token does not match this order",
      },
    });
    expect(response.status).toBe(403);
  });

  it("leaves unexpected downstream errors for the app error handler", async () => {
    const app = appWithErrorHandler();
    app.use("/orders/:id", guestTokenAuth);
    app.get("/orders/:id", () => {
      throw new Error("D1 exploded");
    });

    const response = await app.fetch(
      new Request("https://api.test/orders/order-1", {
        headers: { Authorization: "Bearer gt_abc" },
      }),
      {
        CACHE_KV: createKv({
          orderId: "order-1",
          restaurantId: "rest-1",
          guestName: "Ada",
          createdAt: Date.now(),
        }),
      } as never,
    );

    const body = await response.json<{
      success: boolean;
      error: { code?: string; message: string };
    }>();
    expect(body).toMatchObject({
      success: false,
      error: { message: "Error: D1 exploded" },
    });
    expect(body.error.code).not.toBe("AUTH_FAILED");
    expect(response.status).toBe(500);
  });

  it("does not turn a rejected downstream chain into an authentication error", async () => {
    const downstreamError = new Error("D1 exploded");
    const context = {
      req: {
        header: vi.fn(() => "Bearer gt_abc"),
        param: vi.fn(() => "order-1"),
      },
      env: {
        CACHE_KV: createKv({
          orderId: "order-1",
          restaurantId: "rest-1",
          guestName: "Ada",
          createdAt: Date.now(),
        }),
      },
      set: vi.fn(),
    };

    await expect(
      guestTokenAuth(context as never, async () => {
        throw downstreamError;
      }),
    ).rejects.toBe(downstreamError);
  });
});

describe("guestSessionAuth", () => {
  it("attaches valid guest sessions", async () => {
    const app = appWithErrorHandler();
    app.use("/guest-orders", guestSessionAuth);
    app.post("/guest-orders", (c) =>
      c.json({ guestSession: c.get("guestSession") }),
    );

    const response = await app.fetch(
      new Request("https://api.test/guest-orders", {
        method: "POST",
        headers: { Authorization: "Bearer gt_abc" },
      }),
      {
        CACHE_KV: createKv({
          restaurantId: "rest-1",
          phoneLastDigits: "1234",
          createdAt: Date.now(),
        }),
      } as never,
    );

    await expect(response.json()).resolves.toMatchObject({
      guestSession: { restaurantId: "rest-1", phoneLastDigits: "1234" },
    });
    expect(response.status).toBe(200);
  });

  it("leaves unexpected downstream errors for the app error handler", async () => {
    const app = appWithErrorHandler();
    app.use("/guest-orders", guestSessionAuth);
    app.post("/guest-orders", () => {
      throw new Error("D1 exploded");
    });

    const response = await app.fetch(
      new Request("https://api.test/guest-orders", {
        method: "POST",
        headers: { Authorization: "Bearer gt_abc" },
      }),
      {
        CACHE_KV: createKv({
          restaurantId: "rest-1",
          phoneLastDigits: "1234",
          createdAt: Date.now(),
        }),
      } as never,
    );

    const body = await response.json<{
      success: boolean;
      error: { code?: string; message: string };
    }>();
    expect(body).toMatchObject({
      success: false,
      error: { message: "Error: D1 exploded" },
    });
    expect(body.error.code).not.toBe("AUTH_FAILED");
    expect(response.status).toBe(500);
  });

  it("does not turn a rejected downstream chain into an authentication error", async () => {
    const downstreamError = new Error("D1 exploded");
    const context = {
      req: {
        header: vi.fn(() => "Bearer gt_abc"),
      },
      env: {
        CACHE_KV: createKv({
          restaurantId: "rest-1",
          phoneLastDigits: "1234",
          createdAt: Date.now(),
        }),
      },
      set: vi.fn(),
    };

    await expect(
      guestSessionAuth(context as never, async () => {
        throw downstreamError;
      }),
    ).rejects.toBe(downstreamError);
  });
});

describe("guest auth KV failures", () => {
  it.each([
    ["guestTokenAuth", guestTokenAuth],
    ["guestSessionAuth", guestSessionAuth],
  ] as const)(
    "%s returns 503 and does not call next when the KV lookup throws",
    async (_name, middleware) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const handler = vi.fn();
      const kv = {
        get: vi.fn(async () => {
          throw new Error("KV GET failed: 503");
        }),
      };
      const app = appWithErrorHandler();
      app.use("/orders/:id", middleware);
      app.get("/orders/:id", (c) => {
        handler();
        return c.json({ ok: true });
      });

      const response = await app.fetch(
        new Request("https://api.test/orders/order-1", {
          headers: { Authorization: "Bearer gt_abc" },
        }),
        { CACHE_KV: kv } as never,
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        success: false,
        error: {
          code: "AUTH_BACKEND_UNAVAILABLE",
          message: "Authentication service temporarily unavailable",
        },
      });
      expect(kv.get).toHaveBeenCalledWith("guest_token:gt_abc", "json");
      expect(handler).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );
});

describe("guest lock identity", () => {
  function reqWith(headers: Record<string, string>) {
    return { header: (name: string) => headers[name] };
  }

  const guestToken = `gt_${"a".repeat(64)}`;
  const deviceId = "0197f0b2-4b2c-7c11-9f3a-6b1d0c9e4d55";

  it("prefers the device id over the guest token", () => {
    expect(
      resolveGuestLockIdentity(
        reqWith({
          [GUEST_DEVICE_ID_HEADER]: deviceId,
          Authorization: `Bearer ${guestToken}`,
        }),
      ),
    ).toEqual({ kind: "device", value: deviceId });
  });

  it("keeps a signed-in shopper's device identity, which the customer JWT would otherwise shadow", () => {
    // The customer app sends the customer JWT in Authorization once the shopper
    // has an account, and market checkout still runs through the guest route.
    expect(
      resolveGuestLockIdentity(
        reqWith({
          [GUEST_DEVICE_ID_HEADER]: deviceId,
          Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.e30.signature",
        }),
      ),
    ).toEqual({ kind: "device", value: deviceId });
  });

  it("falls back to the guest token for a device that predates the device id", () => {
    expect(
      resolveGuestLockIdentity(
        reqWith({ Authorization: `Bearer ${guestToken}` }),
      ),
    ).toEqual({ kind: "token", value: guestToken });
  });

  it("returns null for a shopper carrying neither", () => {
    expect(resolveGuestLockIdentity(reqWith({}))).toBeNull();
  });

  it("rejects device ids that are absent, malformed, or unbounded", () => {
    // The value lands in a KV key, so anything outside the accepted charset or
    // length is treated as no identity at all rather than being sanitised.
    expect(getGuestDeviceId(undefined)).toBeNull();
    expect(getGuestDeviceId("   ")).toBeNull();
    expect(getGuestDeviceId("short")).toBeNull();
    expect(getGuestDeviceId("a".repeat(65))).toBeNull();
    expect(getGuestDeviceId("has:colon:and:more")).toBeNull();
    expect(getGuestDeviceId(` ${deviceId} `)).toBe(deviceId);
  });

  it("keeps device and token locks in separate key namespaces", () => {
    expect(
      guestActiveOrderKey("restaurant-1", { kind: "device", value: deviceId }),
    ).toBe(`guest_active:restaurant-1:device:${deviceId}`);
    expect(
      guestActiveOrderKey("restaurant-1", { kind: "token", value: guestToken }),
    ).toBe(`guest_active:restaurant-1:token:${guestToken}`);
  });
});
