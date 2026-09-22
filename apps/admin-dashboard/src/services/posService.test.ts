import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/api";
import { posService } from "./posService";

vi.mock("@/services/api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  unwrapApiData: (response: { data?: unknown }) => response.data,
}));

describe("posService", () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
    vi.mocked(apiClient.delete).mockReset();
  });

  it("pays a market checkout through the active POS shift", async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        checkout: {
          id: "checkout-1",
          paymentStatus: "paid",
        },
        payment: {
          status: "paid",
          method: "pos_cash",
          totalAmountCents: 20000,
        },
      },
    } as never);

    const result = await posService.payMarketCheckout({
      checkoutId: "checkout-1",
      registerId: "register-1",
      shiftId: "shift-1",
      paymentMethod: "cash",
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      "/pos/market-checkouts/checkout-1/pay",
      {
        registerId: "register-1",
        shiftId: "shift-1",
        paymentMethod: "cash",
      },
    );
    expect(result.payment).toMatchObject({
      status: "paid",
      method: "pos_cash",
    });
  });

  it("uses the shift API's startedAt/startAmount contract and requires an entered closing count", async () => {
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { id: "shift-1" } } as never)
      .mockResolvedValueOnce({
        data: { id: "shift-1", status: "closed" },
      } as never);
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        id: "shift-1",
        registerId: "register-1",
        startedAt: "2026-09-22T08:00:00.000Z",
        startAmount: 1000,
        totalTransactions: 3,
        status: "active",
      },
    } as never);

    await posService.startShift({
      registerId: "register-1",
      operatorId: "cashier-1" as never,
      startAmount: 1000,
    });
    await posService.endShift("shift-1", {
      actualAmount: 1130,
      closingNotes: "counted",
    });
    const shift = await posService.getCurrentShift("register-1");

    expect(apiClient.post).toHaveBeenNthCalledWith(1, "/pos/shifts/start", {
      registerId: "register-1",
      operatorId: "cashier-1",
      startAmount: 1000,
    });
    expect(apiClient.post).toHaveBeenNthCalledWith(
      2,
      "/pos/shifts/shift-1/end",
      {
        actualAmount: 1130,
        closingNotes: "counted",
      },
    );
    expect(apiClient.get).toHaveBeenCalledWith(
      "/pos/shifts/current/register-1",
    );
    expect(shift).toMatchObject({
      startedAt: "2026-09-22T08:00:00.000Z",
      startAmount: 1000,
      totalTransactions: 3,
    });
  });

  it("forwards the selected restaurant to every print-agent request", async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] } as never);
    vi.mocked(apiClient.post).mockResolvedValueOnce({ data: {} } as never);
    vi.mocked(apiClient.delete).mockResolvedValueOnce({} as never);

    await posService.getPrintAgents("restaurant-1");
    await posService.issuePrintAgent({ label: "Kitchen" }, "restaurant-1");
    await posService.revokePrintAgent("agent-1", "restaurant-1");

    expect(apiClient.get).toHaveBeenCalledWith("/pos/print-agents", {
      params: { restaurantId: "restaurant-1" },
    });
    expect(apiClient.post).toHaveBeenCalledWith(
      "/pos/print-agents",
      { label: "Kitchen" },
      { params: { restaurantId: "restaurant-1" } },
    );
    expect(apiClient.delete).toHaveBeenCalledWith("/pos/print-agents/agent-1", {
      params: { restaurantId: "restaurant-1" },
    });
  });
});
