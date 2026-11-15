import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { pnlService } from "./pnlService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  unwrapApiPayload: vi.fn((payload) => payload.data ?? payload),
}));

describe("pnlService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads one day's statement and unwraps the envelope", async () => {
    const statement = { date: "2026-11-12", currency: "TWD" };
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { success: true, data: statement },
    } as never);

    await expect(pnlService.getDaily("shop-1", "2026-11-12")).resolves.toEqual(
      statement,
    );
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith("/pnl/shop-1/daily", {
      date: "2026-11-12",
    });
  });

  it("posts an expense in cents and returns the created entry", async () => {
    const created = { id: "exp-1", category: "rent", amountCents: 500000 };
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: true, data: created },
    } as never);

    await expect(
      pnlService.addExpense("shop-1", {
        date: "2026-11-12",
        category: "rent",
        amountCents: 500000,
        note: "11 月",
      }),
    ).resolves.toEqual(created);
    expect(api.post).toHaveBeenCalledWith("/pnl/shop-1/expenses", {
      date: "2026-11-12",
      category: "rent",
      amountCents: 500000,
      note: "11 月",
    });
  });

  it("deletes an expense by id", async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ data: {} } as never);

    await pnlService.deleteExpense("shop-1", "exp-1");

    expect(api.delete).toHaveBeenCalledWith("/pnl/shop-1/expenses/exp-1");
  });

  it("escapes ids so they cannot forge a path segment", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: {} } } as never);
    vi.mocked(api.delete).mockResolvedValue({ data: {} } as never);

    await pnlService.getDaily("shop/1", "2026-11-12");
    expect(api.get).toHaveBeenLastCalledWith("/pnl/shop%2F1/daily", {
      date: "2026-11-12",
    });

    await pnlService.deleteExpense("shop-1", "e/1");
    expect(api.delete).toHaveBeenLastCalledWith("/pnl/shop-1/expenses/e%2F1");
  });
});
