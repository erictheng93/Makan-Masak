import { describe, expect, it, vi } from "vitest";
import type { Env } from "./types/env";

const mocks = vi.hoisted(() => ({
  sweep: vi.fn(),
  overdue: vi.fn(),
  reconcile: vi.fn(),
  systemError: vi.fn(),
}));

vi.mock("./app-factory", () => ({ createApp: () => ({ fetch: vi.fn() }) }));
vi.mock("./scheduled/cleanup-tokens", () => ({
  cleanupExpiredTokens: vi.fn(),
  cleanupOldLogs: vi.fn(),
  cleanupExpiredIdempotencyKeys: vi.fn(),
}));
vi.mock("./workers/group-order-expiry", () => ({
  GROUP_ORDER_EXPIRY_CRON: "*/5 * * * *",
  sweepExpiringGroupOrders: mocks.sweep,
}));
vi.mock("./workers/overdue-order-alerts", () => ({
  raiseOverdueOrderAlerts: mocks.overdue,
}));
vi.mock("./workers/market-checkout-reconciliation", () => ({
  reconcilePendingMarketCheckoutPayments: mocks.reconcile,
}));
vi.mock("./services/AlertService", () => ({
  AlertService: class {
    systemError = mocks.systemError;
  },
}));

describe("scheduled handler", () => {
  it("runs the remaining jobs in a tick after one of them fails", async () => {
    const { default: worker } = await import("./index");
    mocks.reconcile.mockResolvedValue({});
    mocks.sweep.mockRejectedValue(new Error("Failed query: select ..."));
    mocks.overdue.mockResolvedValue({});

    await worker.scheduled(
      { cron: "*/5 * * * *" } as ScheduledEvent,
      {} as Env,
      {} as ExecutionContext,
    );

    expect(mocks.overdue).toHaveBeenCalledOnce();
    expect(mocks.systemError).toHaveBeenCalledOnce();
    expect(mocks.systemError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Failed query: select ..." }),
      "Cron Job Execution: group order expiry sweep",
    );
  });
});
