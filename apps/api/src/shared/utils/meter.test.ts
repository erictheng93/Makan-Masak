import { beforeEach, describe, expect, it, vi } from "vitest";

const recordUsageBucketDelta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
);

vi.mock("./usage-buckets", () => ({ recordUsageBucketDelta }));

import { meterEmit } from "./meter";

function buildContext({
  tenantId = "tenant-restaurant-1",
  user,
  waitUntil,
}: {
  tenantId?: string | null;
  user?: { role?: number | null; restaurantId?: string | number | null };
  waitUntil?: (promise: Promise<unknown>) => void;
} = {}) {
  return {
    env: { DB: { marker: "d1" } },
    get: vi.fn((key: string) => {
      if (key === "tenant" && tenantId != null) {
        return { mode: "saas", tenantId, enforceSingleTenant: false };
      }
      if (key === "user") return user;
      return undefined;
    }),
    executionCtx: waitUntil ? { waitUntil } : undefined,
  };
}

describe("meterEmit", () => {
  beforeEach(() => {
    recordUsageBucketDelta.mockClear();
    recordUsageBucketDelta.mockResolvedValue(undefined);
  });

  it("uses tenant context when no explicit restaurant or user restaurant is present", async () => {
    const ctx = buildContext();

    await meterEmit(ctx as never, "api.requests");

    expect(recordUsageBucketDelta).toHaveBeenCalledOnce();
    expect(recordUsageBucketDelta).toHaveBeenCalledWith(
      ctx.env.DB,
      expect.objectContaining({
        restaurantId: "tenant-restaurant-1",
        meterKey: "api.requests",
        quantity: 1,
      }),
    );
  });

  it("does not implicitly meter admin requests without tenant context", async () => {
    const ctx = buildContext({
      tenantId: null,
      user: { role: 0, restaurantId: "1" },
    });

    await meterEmit(ctx as never, "api.requests");

    expect(recordUsageBucketDelta).not.toHaveBeenCalled();
  });

  it("falls back to the authenticated user's restaurant when there is no tenant", async () => {
    const ctx = buildContext({
      tenantId: null,
      user: { role: 1, restaurantId: 42 },
    });

    await meterEmit(ctx as never, "print.jobs", { quantity: 3 });

    expect(recordUsageBucketDelta).toHaveBeenCalledWith(
      ctx.env.DB,
      expect.objectContaining({
        restaurantId: "42",
        meterKey: "print.jobs",
        quantity: 3,
      }),
    );
  });

  it("prefers an explicitly supplied restaurant over tenant and user context", async () => {
    const ctx = buildContext({ user: { role: 1, restaurantId: "user-rest" } });

    await meterEmit(ctx as never, "orders.created", {
      restaurantId: "explicit-rest",
    });

    expect(recordUsageBucketDelta).toHaveBeenCalledWith(
      ctx.env.DB,
      expect.objectContaining({ restaurantId: "explicit-rest" }),
    );
  });

  it("defers the write to waitUntil so the response is not held open", async () => {
    const deferred: Array<Promise<unknown>> = [];
    let settle: (() => void) | undefined;
    recordUsageBucketDelta.mockReturnValue(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );

    const ctx = buildContext({
      waitUntil: (promise) => {
        deferred.push(promise);
      },
    });

    // Resolves while the metering write is still outstanding.
    await meterEmit(ctx as never, "api.requests");

    expect(deferred).toHaveLength(1);
    settle?.();
    await Promise.all(deferred);
  });

  it("swallows and logs a metering failure instead of failing the request", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    recordUsageBucketDelta.mockRejectedValue(new Error("D1 unavailable"));

    const ctx = buildContext();

    await expect(
      meterEmit(ctx as never, "api.requests"),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      "meterEmit.failed",
      expect.objectContaining({
        meterKey: "api.requests",
        restaurantId: "tenant-restaurant-1",
      }),
    );

    consoleError.mockRestore();
  });
});
