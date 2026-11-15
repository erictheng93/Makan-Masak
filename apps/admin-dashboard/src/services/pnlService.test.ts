import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { pnlService } from "./pnlService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
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

  it("reads a date range", async () => {
    const range = { from: "2026-11-01", to: "2026-11-07", days: [] };
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { success: true, data: range },
    } as never);

    await expect(
      pnlService.getRange("shop-1", "2026-11-01", "2026-11-07"),
    ).resolves.toEqual(range);
    expect(api.get).toHaveBeenCalledWith("/pnl/shop-1/range", {
      from: "2026-11-01",
      to: "2026-11-07",
    });
  });

  it("reads the fee rates", async () => {
    const rates = { paymentFeeBps: { cash: 0 }, paymentMethods: ["cash"] };
    vi.mocked(api.get).mockResolvedValueOnce({
      data: { success: true, data: rates },
    } as never);

    await expect(pnlService.getRates("shop-1")).resolves.toEqual(rates);
    expect(api.get).toHaveBeenCalledWith("/pnl/shop-1/rates");
  });

  it("puts the fee rates in basis points and returns the saved shape", async () => {
    const saved = { paymentFeeBps: { ecpay: 275 }, platformCommissionBps: {} };
    vi.mocked(api.put).mockResolvedValueOnce({
      data: { success: true, data: saved },
    } as never);

    await expect(
      pnlService.saveRates("shop-1", {
        paymentFeeBps: { ecpay: 275 },
        platformCommissionBps: {},
      }),
    ).resolves.toEqual(saved);
    expect(api.put).toHaveBeenCalledWith("/pnl/shop-1/rates", {
      paymentFeeBps: { ecpay: 275 },
      platformCommissionBps: {},
    });
  });

  it("sends the effective date with the rates", async () => {
    vi.mocked(api.put).mockResolvedValueOnce({
      data: { success: true, data: { history: [] } },
    } as never);

    await pnlService.saveRates("shop-1", {
      paymentFeeBps: {},
      platformCommissionBps: {},
      effectiveFrom: "2026-11-10",
    });
    expect(api.put).toHaveBeenCalledWith("/pnl/shop-1/rates", {
      paymentFeeBps: {},
      platformCommissionBps: {},
      effectiveFrom: "2026-11-10",
    });
  });
});
