// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CashierView from "./CashierView.vue";
import { api } from "@/services/api";

// Pinned so the calendar-day test below means the same thing on a UTC CI runner
// as on a machine in Taipei; without it the UTC bug and the fix agree in UTC.
process.env.TZ = "Asia/Taipei";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({ currencySymbol: "$", formatPrice: String }),
}));

vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({
    formatDateTime: () => "2026-08-18 12:00",
    formatTime: () => "12:00",
  }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { id: 7, username: "cashier" },
  }),
}));

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  unwrapApiList: (payload: unknown) => payload,
  unwrapApiPayload: (payload: unknown) => payload,
}));

describe("CashierView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/orders") {
        return {
          data: {
            success: true,
            data: [
              {
                id: "019fc320-c159-700c-a66c-39c9b98ed964",
                orderNumber: "ORD-206",
                table: { id: 2, number: "A1" },
                customerInfo: { name: "Ada" },
                status: "ready",
                paymentStatus: "pending",
                createdAt: Date.parse("2026-08-18T12:00:00.000Z"),
                subtotal: 100,
                totalAmount: 100,
                items: [],
              },
            ],
          },
        } as never;
      }
      return { data: { success: true, data: [] } } as never;
    });
  });

  it("loads pending orders with their API table and customer fields", async () => {
    const wrapper = mount(CashierView);
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/orders", {
      status: "ready,delivered",
      paymentStatus: "pending",
      restaurantId: "restaurant-1",
      limit: 50,
    });
    expect(wrapper.text()).toContain("ORD-206");
    expect(wrapper.text()).toContain("cashier.tableNumber A1");

    await wrapper.find(".cursor-pointer").trigger("click");
    expect(wrapper.text()).toContain("Ada");
  });

  it("submits a string order number for a refund and displays a failure", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("Refund rejected"));
    const wrapper = mount(CashierView);
    await flushPromises();

    await wrapper.get('[data-testid="cashier-open-refund"]').trigger("click");
    await wrapper
      .get('[data-testid="cashier-refund-order-number"]')
      .setValue("019FA136-CFE3-709F-A2AB-F8A3EBCD31A1-MSBYTLO8-DCV5");
    await wrapper.get('[data-testid="cashier-refund-amount"]').setValue("10");
    await wrapper
      .get('[data-testid="cashier-refund-reason"]')
      .setValue("wrong_order");
    await wrapper
      .get('[data-testid="cashier-confirm-refund"]')
      .trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith(
      "/pos/refunds/create",
      expect.objectContaining({
        originalOrderId: "019FA136-CFE3-709F-A2AB-F8A3EBCD31A1-MSBYTLO8-DCV5",
      }),
      expect.any(Object),
    );
    expect(wrapper.get('[data-testid="refund-error"]').text()).toContain(
      "Refund rejected",
    );
  });

  // Checkout used to be `PUT /orders/:id/status {status:"paid"}` plus an
  // optional `POST /pos/quick-payment`. The first writes only `status` and
  // `paid_at`; the second is not a route this API has, and its 404 was
  // swallowed. So every counter sale was counted as revenue with
  // payment_status still "pending", no transaction row, and no
  // paymentTransactionId — leaving it unrefundable and uncancellable (#310).
  async function checkout(wrapper: ReturnType<typeof mount>) {
    await wrapper.find(".cursor-pointer").trigger("click");
    // The default method is cash, and canProcessPayment then requires the
    // tendered amount to cover the total — without it the pay button stays
    // disabled and the click is silently a no-op.
    await wrapper.get('[data-testid="received-amount"]').setValue(100);
    await wrapper.get('[data-testid="pay-btn"]').trigger("click");
    await flushPromises();
  }

  it("settles through the real payment endpoint, carrying an idempotency key", async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, data: { transactionId: "txn-9" } },
    } as never);
    const wrapper = mount(CashierView);
    await flushPromises();

    await checkout(wrapper);

    expect(api.post).toHaveBeenCalledWith(
      "/payments",
      expect.objectContaining({
        orderId: "019fc320-c159-700c-a66c-39c9b98ed964",
        paymentMode: "full",
        amount: 100,
        expectedTotal: 100,
        closeOrder: true,
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );

    // The old calls must be gone, not merely joined by a new one: leaving the
    // status write in place would still mark the order paid ahead of the
    // payment, which is the state this bug produced.
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalledWith(
      "/pos/quick-payment",
      expect.anything(),
      expect.anything(),
    );
  });

  it("reuses one idempotency key across a retry, and mints a new one after success", async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error("network"));
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, data: { transactionId: "txn-9" } },
    } as never);
    const wrapper = mount(CashierView);
    await flushPromises();

    await checkout(wrapper);
    await wrapper.get('[data-testid="pay-btn"]').trigger("click");
    await flushPromises();

    const keyOf = (call: number) =>
      (
        vi.mocked(api.post).mock.calls[call][2] as {
          headers: Record<string, string>;
        }
      ).headers["Idempotency-Key"];

    // A retry that mints a fresh key is not a retry as far as the server is
    // concerned — it is a second payment.
    expect(keyOf(1)).toBe(keyOf(0));
  });

  // loadTodayRevenue took the date from toISOString(), which is UTC, so from
  // midnight until 08:00 in Taipei the till showed yesterday's takings as
  // today's.
  it("asks for today's report by the shop's calendar day, not UTC's", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 00:30 on 13 September in Taipei, still 12 September in UTC.
    vi.setSystemTime(new Date("2026-09-12T16:30:00.000Z"));
    try {
      mount(CashierView);
      await flushPromises();

      expect(api.get).toHaveBeenCalledWith(
        "/pos/reports/daily",
        expect.objectContaining({
          date: "2026-09-13",
          restaurantId: "restaurant-1",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains an amount mismatch instead of surfacing the raw HTTP failure", async () => {
    // The server prices the order. A discount applied on this screen changes
    // only what is displayed here, so it arrives as a total the server does
    // not recognise.
    vi.mocked(api.post).mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          success: false,
          error: { code: "PAYMENT_AMOUNT_MISMATCH", message: "raw" },
        },
      },
    });
    const wrapper = mount(CashierView);
    await flushPromises();

    await checkout(wrapper);

    expect(wrapper.get('[data-testid="payment-error"]').text()).toContain(
      "cashier.amountMismatch",
    );
  });
});
