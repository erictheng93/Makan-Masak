// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CashierView from "./CashierView.vue";
import {
  clearRestaurantCurrency,
  setRestaurantCurrency,
} from "@/composables/useCurrency";
import { api } from "@/services/api";

// Pinned so the calendar-day test below means the same thing on a UTC CI runner
// as on a machine in Taipei; without it the UTC bug and the fix agree in UTC.
process.env.TZ = "Asia/Taipei";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && "amount" in params ? `${key}:${String(params.amount)}` : key,
    locale: ref("zh-TW"),
  }),
}));

vi.mock("@/composables/useCurrency", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/composables/useCurrency")>();
  return {
    ...actual,
    useCurrency: () => ({
      ...actual.useCurrency(),
      currencySymbol: "$",
      formatPrice: String,
    }),
  };
});

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
      if (url === "/pos/registers") {
        return {
          data: {
            success: true,
            data: [{ id: "register-1", isActive: true }],
          },
        } as never;
      }
      if (url === "/pos/shifts/current/register-1") {
        return {
          data: {
            success: true,
            data: {
              id: "shift-1",
              startedAt: "2026-08-18T08:00:00.000Z",
            },
          },
        } as never;
      }
      return { data: { success: true, data: [] } } as never;
    });
  });

  it("shows the active shift id returned by the POS API", async () => {
    const wrapper = mount(CashierView);
    await flushPromises();

    expect(wrapper.text()).toContain("cashier.shift: shift-1");
    wrapper.unmount();
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

  it("picks up newly payable orders without a reload, and stops when left", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mount(CashierView);
      await flushPromises();
      const orderLoads = () =>
        vi.mocked(api.get).mock.calls.filter(([url]) => url === "/orders")
          .length;
      expect(orderLoads()).toBe(1);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(orderLoads()).toBe(2);

      wrapper.unmount();
      await vi.advanceTimersByTimeAsync(15_000);
      expect(orderLoads()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits a string order number for a refund and displays a failure", async () => {
    // The shape axios rejects with: its own message is the HTTP status line,
    // and the reason the cashier needs is the API error underneath it.
    vi.mocked(api.post).mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 400"), {
        response: {
          status: 400,
          data: {
            success: false,
            error: { code: "BAD_REQUEST", message: "退款金額超過可退款額度" },
          },
        },
      }),
    );
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
    expect(wrapper.get('[data-testid="refund-error"]').text()).toBe(
      "退款金額超過可退款額度",
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

  describe("cash tendered", () => {
    async function selectOrder() {
      const wrapper = mount(CashierView);
      await flushPromises();
      await wrapper.find(".cursor-pointer").trigger("click");
      return wrapper;
    }

    it("computes change in cents, not floats", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrder();
      await wrapper.get('[data-testid="received-amount"]').setValue(100.1);

      // 100.1 - 100 is 0.09999999999999432 in floating point.
      expect(wrapper.get('[data-testid="cash-change"]').text()).toBe("0.1");
      expect(
        wrapper.get('[data-testid="pay-btn"]').attributes("disabled"),
      ).toBeUndefined();
      clearRestaurantCurrency();
    });

    it("says why a short cash payment cannot be confirmed", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrder();
      await wrapper.get('[data-testid="received-amount"]').setValue(99.5);

      expect(
        wrapper.get('[data-testid="pay-btn"]').attributes("disabled"),
      ).toBeDefined();
      expect(wrapper.get('[data-testid="cash-insufficient"]').text()).toBe(
        "cashier.cashInsufficient:0.5",
      );
      clearRestaurantCurrency();
    });

    it("asks for the cash before confirming, instead of a silent disabled button", async () => {
      const wrapper = await selectOrder();

      expect(
        wrapper.get('[data-testid="pay-btn"]').attributes("disabled"),
      ).toBeDefined();
      expect(wrapper.get('[data-testid="cash-insufficient"]').text()).toBe(
        "cashier.cashNotEntered",
      );
    });

    it("never shows a negative zero when a TWD shortfall is below one dollar", async () => {
      clearRestaurantCurrency();
      const wrapper = await selectOrder();
      await wrapper.get('[data-testid="received-amount"]').setValue(99.8);

      // Rounded to whole NT$, 99.8 covers a NT$100 bill.
      expect(wrapper.get('[data-testid="cash-change"]').text()).toBe("0");
      expect(wrapper.find('[data-testid="cash-insufficient"]').exists()).toBe(
        false,
      );
    });

    it("steps the cash input by the shop currency's unit", async () => {
      clearRestaurantCurrency();
      const twd = await selectOrder();
      const received = twd.get('[data-testid="received-amount"]');
      expect(received.attributes("step")).toBe("1");
      expect(received.attributes("placeholder")).toBe("0");
      twd.unmount();

      setRestaurantCurrency("MYR");
      const myr = await selectOrder();
      expect(
        myr.get('[data-testid="received-amount"]').attributes("step"),
      ).toBe("0.01");
      myr.unmount();
      clearRestaurantCurrency();
    });
  });

  // Malaysia's 1 and 2 sen coins are out of circulation, so a cash bill is
  // collected to the nearest 5 sen (#405). The till has to show the figure it
  // is asking for, and give change against it.
  describe("MYR cash rounding", () => {
    async function selectOrderTotalling(total: number) {
      vi.mocked(api.get).mockImplementation(async (url: string) => {
        if (url === "/orders") {
          return {
            data: {
              success: true,
              data: [
                {
                  id: "019fc320-c159-700c-a66c-39c9b98ed964",
                  orderNumber: "ORD-405",
                  status: "ready",
                  paymentStatus: "pending",
                  createdAt: Date.parse("2026-08-18T12:00:00.000Z"),
                  subtotal: total,
                  totalAmount: total,
                  items: [],
                },
              ],
            },
          } as never;
        }
        if (url === "/pos/registers") {
          return {
            data: {
              success: true,
              data: [{ id: "register-1", isActive: true }],
            },
          } as never;
        }
        if (url === "/pos/shifts/current/register-1") {
          return {
            data: {
              success: true,
              data: {
                id: "shift-1",
                startedAt: "2026-08-18T08:00:00.000Z",
              },
            },
          } as never;
        }
        return { data: { success: true, data: [] } } as never;
      });
      const wrapper = mount(CashierView);
      await flushPromises();
      await wrapper.find(".cursor-pointer").trigger("click");
      return wrapper;
    }

    it("asks for the rounded figure and shows where the 2 sen came from", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrderTotalling(10.33);
      await wrapper.get('[data-testid="received-amount"]').setValue(20);

      expect(
        wrapper.get('[data-testid="cash-rounding-adjustment"]').text(),
      ).toBe("+0.02");
      expect(wrapper.get('[data-testid="cash-amount-due"]').text()).toBe(
        "10.35",
      );
      // Change is against what is collected, not against the order total.
      expect(wrapper.get('[data-testid="cash-change"]').text()).toBe("9.65");
      clearRestaurantCurrency();
    });

    it("rounds down and signs the adjustment when the total ends in 2 sen", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrderTotalling(10.32);
      await wrapper.get('[data-testid="received-amount"]').setValue(20);

      expect(
        wrapper.get('[data-testid="cash-rounding-adjustment"]').text(),
      ).toBe("-0.02");
      expect(wrapper.get('[data-testid="cash-amount-due"]').text()).toBe(
        "10.3",
      );
      clearRestaurantCurrency();
    });

    it("blocks a payment short of the rounded figure with the existing message", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrderTotalling(10.33);
      await wrapper.get('[data-testid="received-amount"]').setValue(10.34);

      expect(
        wrapper.get('[data-testid="pay-btn"]').attributes("disabled"),
      ).toBeDefined();
      expect(wrapper.get('[data-testid="cash-insufficient"]').text()).toBe(
        "cashier.cashInsufficient:0.01",
      );
      clearRestaurantCurrency();
    });

    it("shows no rounding line for a total already on the 5 sen step", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrderTotalling(10.35);
      await wrapper.get('[data-testid="received-amount"]').setValue(20);

      expect(
        wrapper.find('[data-testid="cash-rounding-adjustment"]').exists(),
      ).toBe(false);
      expect(wrapper.get('[data-testid="cash-amount-due"]').text()).toBe(
        "10.35",
      );
      clearRestaurantCurrency();
    });

    it("shows no rounding line once a card is selected", async () => {
      setRestaurantCurrency("MYR");
      const wrapper = await selectOrderTotalling(10.33);
      await wrapper.get('[data-selected="false"]').trigger("click");
      await wrapper.vm.$nextTick();

      expect(
        wrapper.find('[data-testid="cash-rounding-adjustment"]').exists(),
      ).toBe(false);
      clearRestaurantCurrency();
    });

    it("leaves a TWD till untouched", async () => {
      clearRestaurantCurrency();
      const wrapper = await selectOrderTotalling(350);
      await wrapper.get('[data-testid="received-amount"]').setValue(400);

      expect(
        wrapper.find('[data-testid="cash-rounding-adjustment"]').exists(),
      ).toBe(false);
      expect(wrapper.get('[data-testid="cash-amount-due"]').text()).toBe("350");
      expect(wrapper.get('[data-testid="cash-change"]').text()).toBe("50");
    });

    it("sends the collected amount and the unrounded order total", async () => {
      setRestaurantCurrency("MYR");
      vi.mocked(api.post).mockResolvedValue({
        data: { success: true, data: { transactionId: "txn-405" } },
      } as never);
      const wrapper = await selectOrderTotalling(10.33);
      await wrapper.get('[data-testid="received-amount"]').setValue(20);
      await wrapper.get('[data-testid="pay-btn"]').trigger("click");
      await flushPromises();

      expect(api.post).toHaveBeenCalledWith(
        "/payments",
        expect.objectContaining({ amount: 10.35, expectedTotal: 10.33 }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Idempotency-Key": expect.any(String),
          }),
        }),
      );
      clearRestaurantCurrency();
    });
  });

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
        registerId: "register-1",
        shiftId: "shift-1",
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

  it("requires a physical count before ending a shift and never defaults it to zero", async () => {
    const wrapper = mount(CashierView);
    await flushPromises();

    await wrapper
      .get('[data-testid="cashier-open-shift-report"]')
      .trigger("click");
    await flushPromises();
    await wrapper
      .get('[data-testid="cashier-open-end-shift"]')
      .trigger("click");
    expect(
      wrapper
        .get('[data-testid="cashier-confirm-end-shift"]')
        .attributes("disabled"),
    ).toBeDefined();

    await wrapper
      .get('[data-testid="cashier-ending-cash-amount"]')
      .setValue(250);
    await wrapper
      .get('[data-testid="cashier-confirm-end-shift"]')
      .trigger("click");
    await flushPromises();

    expect(api.post).toHaveBeenCalledWith("/pos/shifts/shift-1/end", {
      actualAmount: 250,
    });
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

  it("shows unavailable rather than zero when the daily report fails", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/pos/reports/daily") throw new Error("Forbidden");
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
    const wrapper = mount(CashierView);
    await flushPromises();

    expect(wrapper.get('[data-testid="cashier-today-revenue"]').text()).toBe(
      "—",
    );
    expect(
      wrapper.get('[data-testid="cashier-today-revenue"]').attributes(),
    ).toMatchObject({
      "aria-label": "cashier.revenueUnavailable",
      title: "cashier.revenueUnavailable",
    });

    vi.mocked(api.post).mockResolvedValueOnce({
      data: { success: true, data: { transactionId: "txn-9" } },
    } as never);
    await checkout(wrapper);

    // A payment cannot make an unavailable report look authoritative.
    expect(wrapper.get('[data-testid="cashier-today-revenue"]').text()).toBe(
      "—",
    );
  });

  it("still shows zero when the daily report confirms no sales", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/pos/reports/daily") {
        return {
          data: { success: true, data: { summary: { totalSales: 0 } } },
        } as never;
      }
      return { data: { success: true, data: [] } } as never;
    });
    const wrapper = mount(CashierView);
    await flushPromises();

    expect(wrapper.get('[data-testid="cashier-today-revenue"]').text()).toBe(
      "0",
    );
    expect(
      wrapper
        .get('[data-testid="cashier-today-revenue"]')
        .attributes("aria-label"),
    ).toBeUndefined();
  });

  it("uses an active register from the API for refunds without altering unavailable revenue", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/pos/registers") {
        return {
          data: { success: true, data: [{ id: "register-1", isActive: true }] },
        } as never;
      }
      if (url === "/pos/shifts/current/register-1") {
        return {
          data: { success: true, data: { id: "shift-1" } },
        } as never;
      }
      if (url === "/pos/reports/daily") throw new Error("Forbidden");
      return { data: { success: true, data: [] } } as never;
    });
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } } as never);
    const wrapper = mount(CashierView);
    await flushPromises();

    await wrapper.get('[data-testid="cashier-open-refund"]').trigger("click");
    await wrapper
      .get('[data-testid="cashier-refund-order-number"]')
      .setValue("order-1");
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
      expect.any(Object),
      expect.objectContaining({
        headers: { "X-Register-Id": "register-1", "X-Shift-Id": "shift-1" },
      }),
    );
    expect(wrapper.get('[data-testid="cashier-today-revenue"]').text()).toBe(
      "—",
    );
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

  // The receipt route reads the till from X-Register-Id (and the shift from
  // X-Shift-Id), exactly like refunds. Both print buttons put registerId in
  // the body instead, so every receipt came back 400 "需要指定收銀機ID" and
  // the catch only logged it: on production the cashier saw nothing at all.
  describe("receipt printing", () => {
    function withOpenShift() {
      const orders = vi.mocked(api.get).getMockImplementation()!;
      vi.mocked(api.get).mockImplementation(async (url: string, ...rest) => {
        if (url === "/pos/registers") {
          return {
            data: {
              success: true,
              data: [{ id: "register-1", isActive: true }],
            },
          } as never;
        }
        if (url === "/pos/shifts/current/register-1") {
          return { data: { success: true, data: { id: "shift-1" } } } as never;
        }
        return orders(url, ...rest);
      });
    }

    it("names the till and shift in headers, as the receipt route requires", async () => {
      withOpenShift();
      vi.mocked(api.post).mockResolvedValue({
        data: { success: true, data: { transactionId: "txn-9" } },
      } as never);
      const wrapper = mount(CashierView);
      await flushPromises();
      await checkout(wrapper);

      await wrapper.get('[data-testid="print-final-receipt"]').trigger("click");
      await flushPromises();

      expect(api.post).toHaveBeenCalledWith(
        "/pos/receipts/print",
        expect.objectContaining({
          orderId: "019fc320-c159-700c-a66c-39c9b98ed964",
        }),
        expect.objectContaining({
          headers: { "X-Register-Id": "register-1", "X-Shift-Id": "shift-1" },
        }),
      );
      expect(wrapper.find('[data-testid="payment-success"]').exists()).toBe(
        false,
      );
    });

    it("keeps the success dialog open and says why when the receipt fails", async () => {
      withOpenShift();
      vi.mocked(api.post).mockImplementation(async (url: string) => {
        if (url === "/pos/receipts/print") {
          throw {
            response: {
              status: 400,
              data: {
                success: false,
                error: { code: "BAD_REQUEST", message: "需要指定收銀機ID" },
              },
            },
          };
        }
        return {
          data: { success: true, data: { transactionId: "txn-9" } },
        } as never;
      });
      const wrapper = mount(CashierView);
      await flushPromises();
      await checkout(wrapper);

      await wrapper.get('[data-testid="print-final-receipt"]').trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-testid="payment-success"]').exists()).toBe(
        true,
      );
      expect(wrapper.get('[data-testid="receipt-error"]').text()).toContain(
        "需要指定收銀機ID",
      );
    });
  });
});
