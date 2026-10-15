/**
 * Subscription-gate wiring for pos/routes/receipts.ts POST /print and
 * POST /:receiptId/reprint.
 *
 * Regression coverage for the bug where these routes only inherited the
 * app-factory blanket moduleGate("pos") (applied to all of /pos/*) and had
 * no route-level moduleGate("receipt_printing"). "pos" and "receipt_printing"
 * happen to be granted together on every plan tier today, so this bug was
 * invisible under default plans — but it meant an admin who used a
 * moduleOverride to disable receipt_printing specifically (while keeping the
 * rest of the POS terminal working) could not actually stop a cashier from
 * printing through this endpoint. This file mounts receipts.ts standalone
 * (without the outer /pos/* blanket) so only the route-level gate is under
 * test, and exercises the real moduleGate — it does NOT mock
 * "../../../middleware/moduleGate".
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const currentUser = vi.hoisted(() => {
  const value: AuthUser = {
    id: "user-10",
    username: "cashier",
    role: 4,
    restaurantId: "rest-pro",
  };
  return { value };
});

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", currentUser.value);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

// Metering writes to D1, which this file fakes as `{ binding: "db" }`; stub
// the emit so the allowed paths do not log a swallowed meterEmit.failed.
const meterEmit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../shared/utils/meter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/utils/meter")>()),
  meterEmit,
}));

const receiptServiceFns = vi.hoisted(() => ({
  printReceipt: vi.fn(),
  reprintReceipt: vi.fn(),
}));

vi.mock("../services/ReceiptService", () => ({
  ReceiptService: vi.fn(function ReceiptService() {
    return receiptServiceFns;
  }),
}));

vi.mock("../services/PosTenantAccessService", () => ({
  PosTenantAccessService: vi.fn(function PosTenantAccessService() {
    return {
      requireReceipt: vi.fn(),
      requireRegisterAndShift: vi.fn(),
    };
  }),
}));

vi.mock("../../../shared/services/order-identity", () => ({
  resolveOrderIdentity: vi.fn(async (_db: unknown, orderId: unknown) => ({
    id: typeof orderId === "number" ? orderId : 101,
    publicId: "018f0000-0000-7000-8000-000000000101",
    orderNumber: "ORD-101",
    restaurantId: "rest-pro",
  })),
}));

import routes from "./receipts";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

interface CachedSubscription {
  isActive: boolean;
  planTier: "trial" | "basic" | "pro" | "enterprise";
  moduleOverrides: Record<string, boolean>;
  trialEndsAt: number | null;
}

class FakeKv {
  constructor(private readonly data: Record<string, CachedSubscription>) {}
  async get<T>(key: string): Promise<T | null> {
    const restaurantId = key.replace(/^subscription:/, "");
    return (this.data[restaurantId] as unknown as T) ?? null;
  }
  async put(): Promise<void> {}
  async delete(): Promise<void> {}
}

function subscription(
  planTier: CachedSubscription["planTier"],
  overrides: Record<string, boolean> = {},
): CachedSubscription {
  return {
    isActive: true,
    planTier,
    moduleOverrides: overrides,
    trialEndsAt: null,
  };
}

function envWithSubscription(
  restaurantId: string,
  planTier: CachedSubscription["planTier"],
  overrides: Record<string, boolean> = {},
) {
  return {
    DB: { binding: "db" },
    CACHE_KV: new FakeKv({ [restaurantId]: subscription(planTier, overrides) }),
  } as unknown as Record<string, unknown>;
}

function printPayload() {
  return {
    orderId: 101,
    templateName: "standard",
    receiptType: "customer",
    copies: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.value = {
    id: "user-10",
    username: "cashier",
    role: 4,
    restaurantId: "rest-pro",
  };
  receiptServiceFns.printReceipt.mockResolvedValue({
    success: true,
    data: { id: "r1" },
  });
  receiptServiceFns.reprintReceipt.mockResolvedValue({ success: true });
});

describe("POST /print is gated on receipt_printing", () => {
  it("denies a pro-tier cashier with receipt_printing explicitly disabled (403 MODULE_NOT_ENABLED)", async () => {
    const res = await routes.request(
      "/print",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Register-Id": "reg-1",
        },
        body: JSON.stringify(printPayload()),
      },
      envWithSubscription("rest-pro", "pro", {
        receipt_printing: false,
      }) as never,
    );
    const json = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };

    expect(res.status).toBe(403);
    expect(json.error.code).toBe("MODULE_NOT_ENABLED");
    expect(receiptServiceFns.printReceipt).not.toHaveBeenCalled();
  });

  it("allows a default pro-tier cashier through", async () => {
    const res = await routes.request(
      "/print",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Register-Id": "reg-1",
        },
        body: JSON.stringify(printPayload()),
      },
      envWithSubscription("rest-pro", "pro") as never,
    );

    expect(res.status).toBe(200);
    expect(receiptServiceFns.printReceipt).toHaveBeenCalledOnce();
    expect(meterEmit).toHaveBeenCalledWith(expect.anything(), "print.jobs");
  });

  it("denies a basic-tier cashier (receipt_printing is pro-tier+)", async () => {
    const res = await routes.request(
      "/print",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Register-Id": "reg-1",
        },
        body: JSON.stringify(printPayload()),
      },
      envWithSubscription("rest-pro", "basic") as never,
    );

    expect(res.status).toBe(403);
    expect(receiptServiceFns.printReceipt).not.toHaveBeenCalled();
  });
});

describe("POST /:receiptId/reprint is gated on receipt_printing", () => {
  it("denies with receipt_printing explicitly disabled", async () => {
    const res = await routes.request(
      "/550e8400-e29b-41d4-a716-446655440020/reprint",
      { method: "POST" },
      envWithSubscription("rest-pro", "pro", {
        receipt_printing: false,
      }) as never,
    );

    expect(res.status).toBe(403);
    expect(receiptServiceFns.reprintReceipt).not.toHaveBeenCalled();
  });

  it("allows a default pro-tier cashier through", async () => {
    const res = await routes.request(
      "/550e8400-e29b-41d4-a716-446655440020/reprint",
      { method: "POST" },
      envWithSubscription("rest-pro", "pro") as never,
    );

    expect(res.status).toBe(200);
    expect(receiptServiceFns.reprintReceipt).toHaveBeenCalledOnce();
    expect(meterEmit).toHaveBeenCalledWith(expect.anything(), "print.jobs");
  });
});
