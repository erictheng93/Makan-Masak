import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketCheckoutTrackingView from "@/views/MarketCheckoutTrackingView.vue";

const routerPush = vi.hoisted(() => vi.fn());
const getMarketCheckout = vi.hoisted(() => vi.fn());
const payMarketCheckout = vi.hoisted(() => vi.fn());
const applyMarketCheckoutVoucher = vi.hoisted(() => vi.fn());
const removeMarketCheckoutVoucher = vi.hoisted(() => vi.fn());
const recoverMarketCheckoutGuestToken = vi.hoisted(() => vi.fn());
const windowOpen = vi.hoisted(() => vi.fn());

vi.stubGlobal("open", windowOpen);

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${Object.values(params).join(",")}`,
    currentLanguage: ref("zh-TW"),
    hasTranslation: (key: string) => !key.endsWith(".undefined"),
  }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerPush,
  }),
}));

vi.mock("@/services/orderApi", () => ({
  orderApi: {
    getMarketCheckout,
    payMarketCheckout,
    applyMarketCheckoutVoucher,
    removeMarketCheckoutVoucher,
    recoverMarketCheckoutGuestToken,
  },
}));

vi.mock("@/composables/useCurrency", () => ({
  useCurrency: () => ({
    formatPrice: (amount: number) => `NT$${amount}`,
  }),
}));

function mountView() {
  return mount(MarketCheckoutTrackingView, {
    props: {
      slug: "fengjia",
      checkoutId: "checkout-1",
    },
  });
}

describe("MarketCheckoutTrackingView", () => {
  beforeEach(() => {
    localStorage.clear();
    routerPush.mockReset();
    getMarketCheckout.mockReset();
    payMarketCheckout.mockReset();
    applyMarketCheckoutVoucher.mockReset();
    removeMarketCheckoutVoucher.mockReset();
    recoverMarketCheckoutGuestToken.mockReset();
    windowOpen.mockReset();
  });

  it("loads and renders a market checkout summary", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          status: "preparing",
          paymentStatus: "pending",
          updatedAt: 1780308300000,
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "甜點攤",
          orderId: 102,
          orderNumber: "A002",
          totalAmount: 80,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          status: "ready",
          paymentStatus: "completed",
          updatedAt: 1780308400000,
        },
      ],
      // The API sends subtotal in cents, like totalAmountCents and
      // discountCents beside it (see orderApi.test.ts).
      subtotal: 24000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    const wrapper = mountView();
    await flushPromises();

    expect(getMarketCheckout).toHaveBeenCalledWith("checkout-1");
    const summary = wrapper.get('[data-testid="market-checkout-summary"]');
    expect(summary.text()).toContain("逢甲夜市");
    expect(summary.text()).toContain("markets.checkout.statusSubmitted");
    expect(summary.text()).toContain("markets.common.stallCount:2");
    // Not toContain("NT$240"): a subtotal rendered as cents reads "NT$24000",
    // which contains it -- exactly how a NT$110 checkout showed NT$11,000.
    expect(summary.text()).toMatch(/NT\$240(?!\d)/);

    const childOrders = wrapper.findAll(
      '[data-testid="market-checkout-child-order"]',
    );
    expect(childOrders).toHaveLength(2);
    expect(childOrders[0].text()).toContain("雞排攤");
    expect(childOrders[0].text()).toContain("A001");
    expect(childOrders[0].text()).toContain(
      "markets.checkout.orderStatus.preparing",
    );
    expect(childOrders[0].text()).toContain(
      "markets.checkout.paymentStatus.pending",
    );
    expect(childOrders[0].text()).toContain("NT$160");
    expect(childOrders[1].text()).toContain(
      "markets.checkout.orderStatus.ready",
    );
    expect(childOrders[1].text()).toContain(
      "markets.checkout.paymentStatus.paid",
    );
    expect(
      localStorage.getItem("makanmakan_recent_market_checkouts"),
    ).toContain('"paymentStatus":"pending"');
  });

  it("returns to the market page", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [],
      subtotal: 0,
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="market-checkout-return"]')
      .trigger("click");

    expect(routerPush).toHaveBeenCalledWith("/markets/fengjia");
  });

  it("opens a child vendor order with the matching guest token", async () => {
    localStorage.setItem(
      "makanmakan_market_checkout_guest_tokens",
      JSON.stringify({
        "checkout-1": {
          "101": {
            restaurantId: "restaurant-1",
            guestToken: "guest-token-101",
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        },
      }),
    );
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      subtotal: 16000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="market-checkout-child-track"]')
      .trigger("click");

    expect(localStorage.getItem("guest_auth_token")).toBe("guest-token-101");
    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopOrderTracking",
      params: {
        restaurantId: "restaurant-1",
        orderId: "101",
      },
    });
  });

  it("shows an access error when a child order guest token is missing", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      subtotal: 16000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="market-checkout-child-track"]')
      .trigger("click");

    expect(routerPush).not.toHaveBeenCalled();
    expect(
      wrapper.get('[data-testid="market-checkout-child-access-error"]').text(),
    ).toContain("markets.checkout.childOrderAccessFailed");
  });

  it("recovers a missing child order guest token before opening the order", async () => {
    localStorage.setItem(
      "makanmakan_recent_market_checkouts",
      JSON.stringify([
        {
          id: "checkout-1",
          marketSlug: "fengjia",
          marketName: "逢甲夜市",
          childOrderCount: 1,
          totalAmount: 160,
          paymentStatus: "pending",
          phoneLastDigits: "789",
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: Date.now(),
        },
      ]),
    );
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      subtotal: 16000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    recoverMarketCheckoutGuestToken.mockResolvedValueOnce({
      orderId: 101,
      restaurantId: "restaurant-1",
      guestToken: "recovered-token-101",
      tokenExpiresAt: "2026-06-01T14:00:00.000Z",
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="market-checkout-child-track"]')
      .trigger("click");
    await flushPromises();

    expect(recoverMarketCheckoutGuestToken).toHaveBeenCalledWith("checkout-1", {
      orderId: 101,
      phoneLastDigits: "789",
    });
    expect(routerPush).toHaveBeenCalledWith({
      name: "ShopOrderTracking",
      params: {
        restaurantId: "restaurant-1",
        orderId: "101",
      },
    });
  });

  it("starts an aggregate market payment and renders the payment summary", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "甜點攤",
          orderId: 102,
          orderNumber: "A002",
          totalAmount: 80,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      subtotal: 24000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    payMarketCheckout.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "paid",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 240,
          paidAmountCents: 24000,
          paidAt: "2026-06-01T10:10:00.000Z",
          childPayments: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 101,
              orderNumber: "A001",
              paymentId: "pay-101",
              status: "paid",
              amount: 160,
              amountCents: 16000,
            },
            {
              restaurantId: "restaurant-2",
              restaurantName: "甜點攤",
              orderId: 102,
              orderNumber: "A002",
              paymentId: "pay-102",
              status: "paid",
              amount: 80,
              amountCents: 8000,
            },
          ],
        },
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      payment: {
        status: "paid",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 240,
        paidAmountCents: 24000,
        paidAt: "2026-06-01T10:10:00.000Z",
        childPayments: [],
      },
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('[data-testid="market-checkout-pay"]').trigger("click");
    await flushPromises();

    expect(payMarketCheckout).toHaveBeenCalledWith("checkout-1", {
      method: "market_online",
      country: "TW",
      currency: "TWD",
    });
    const paymentSummary = wrapper.get(
      '[data-testid="market-checkout-payment-summary"]',
    );
    expect(paymentSummary.text()).toContain(
      "markets.checkout.marketPaymentStatus.paid",
    );
    expect(paymentSummary.text()).toContain("NT$240");
    expect(paymentSummary.text()).toContain(
      "markets.checkout.paymentProgress:2,2",
    );
    expect(
      localStorage.getItem("makanmakan_recent_market_checkouts"),
    ).toContain('"paymentStatus":"paid"');
  });

  it("applies and removes a platform voucher before payment", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "甜點攤",
          orderId: 102,
          orderNumber: "A002",
          totalAmount: 80,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      subtotal: 24000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    applyMarketCheckoutVoucher.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 24000,
        appliedVoucher: {
          couponId: 5,
          code: "MARKET10",
          name: "市場 9 折",
          discountCents: 2400,
          allocations: [
            { orderId: 101, amountCents: 16000, discountCents: 1600 },
            { orderId: 102, amountCents: 8000, discountCents: 800 },
          ],
        },
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      discountCents: 2400,
      payableCents: 21600,
    });
    removeMarketCheckoutVoucher.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [],
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      },
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="market-checkout-voucher-code"]')
      .setValue("MARKET10");
    await wrapper
      .get('[data-testid="market-checkout-voucher-apply"]')
      .trigger("submit");
    await flushPromises();

    expect(applyMarketCheckoutVoucher).toHaveBeenCalledWith(
      "checkout-1",
      "MARKET10",
    );
    expect(
      wrapper.get('[data-testid="market-checkout-voucher-discount"]').text(),
    ).toContain("NT$24");
    expect(
      wrapper.get('[data-testid="market-checkout-payable"]').text(),
    ).toContain("NT$216");
    expect(wrapper.text()).toContain("市場 9 折");

    await wrapper
      .get('[data-testid="market-checkout-voucher-remove"]')
      .trigger("click");
    await flushPromises();

    expect(removeMarketCheckoutVoucher).toHaveBeenCalledWith("checkout-1");
    expect(
      wrapper.find('[data-testid="market-checkout-voucher-discount"]').exists(),
    ).toBe(false);
    expect(
      wrapper.get('[data-testid="market-checkout-payable"]').text(),
    ).toMatch(/NT\$240(?!\d)/);
  });

  it("shows voucher-specific error messages", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [],
      subtotal: 24000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    applyMarketCheckoutVoucher.mockRejectedValueOnce(
      Object.assign(new Error("min order"), {
        code: "VOUCHER_MIN_ORDER_NOT_MET",
      }),
    );

    const wrapper = mountView();
    await flushPromises();

    await wrapper
      .get('[data-testid="market-checkout-voucher-code"]')
      .setValue("MARKET500");
    await wrapper
      .get('[data-testid="market-checkout-voucher-apply"]')
      .trigger("submit");
    await flushPromises();

    expect(
      wrapper.get('[data-testid="market-checkout-voucher-error"]').text(),
    ).toContain("markets.checkout.voucherError.VOUCHER_MIN_ORDER_NOT_MET");
  });

  it("redirects users when a provider payment requires an external action", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      subtotal: 16000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    payMarketCheckout.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "pending",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 160,
          totalAmountCents: 16000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "pending",
            provider: "future_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-1",
            nextAction: {
              type: "redirect",
              redirectUrl:
                "https://payments.example.test/confirm/intent-market-1",
            },
            amountCents: 16000,
            paidAmountCents: 0,
            refundedAmountCents: 0,
            childPaymentIds: [],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:10:00.000Z",
          },
        },
        subtotal: 16000,
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      payment: {
        status: "pending",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 160,
        totalAmountCents: 16000,
        paidAmount: 0,
        paidAmountCents: 0,
        childPayments: [],
        parentPayment: {
          paymentId: "market_pay_checkout-1",
          status: "pending",
          provider: "future_provider",
          splitMode: "provider_split",
          idempotencyKey: "market-checkout:checkout-1",
          providerTransactionId: "intent-market-1",
          nextAction: {
            type: "redirect",
            redirectUrl:
              "https://payments.example.test/confirm/intent-market-1",
          },
          amountCents: 16000,
          paidAmountCents: 0,
          refundedAmountCents: 0,
          childPaymentIds: [],
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:10:00.000Z",
        },
      },
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('[data-testid="market-checkout-pay"]').trigger("click");
    await flushPromises();

    expect(windowOpen).toHaveBeenCalledWith(
      "https://payments.example.test/confirm/intent-market-1",
      "_self",
    );
    expect(
      wrapper.get('[data-testid="market-checkout-payment-action"]').text(),
    ).toContain("markets.checkout.payRedirecting");
  });

  it.each([
    {
      nextAction: {
        type: "client_secret",
        clientSecret: "pi_secret_market_1",
      },
      expectedMessage: "markets.checkout.payAwaitingElement",
    },
    {
      nextAction: {
        type: "sdk_confirmation",
        providerPayload: {
          confirmationToken: "confirm-market-1",
          publishableKey: "pk_test_market",
        },
      },
      expectedMessage: "markets.checkout.payAwaitingSdk",
    },
  ])(
    "keeps provider $nextAction.type payments pending without redirecting",
    async ({ nextAction, expectedMessage }) => {
      getMarketCheckout.mockResolvedValueOnce({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 16000,
        createdAt: "2026-06-01T10:00:00.000Z",
      });
      payMarketCheckout.mockResolvedValueOnce({
        checkout: {
          id: "checkout-1",
          market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
          status: "submitted",
          childOrders: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 101,
              orderNumber: "A001",
              totalAmount: 160,
              tokenExpiresAt: "2026-06-01T12:00:00.000Z",
            },
          ],
          payment: {
            status: "pending",
            method: "market_online",
            currency: "TWD",
            country: "TW",
            totalAmount: 160,
            totalAmountCents: 16000,
            paidAmount: 0,
            paidAmountCents: 0,
            childPayments: [],
            parentPayment: {
              paymentId: "market_pay_checkout-1",
              status: "pending",
              provider: "future_provider",
              splitMode: "provider_split",
              idempotencyKey: "market-checkout:checkout-1",
              providerTransactionId: "intent-market-1",
              nextAction,
              amountCents: 16000,
              paidAmountCents: 0,
              refundedAmountCents: 0,
              childPaymentIds: [],
              createdAt: "2026-06-01T10:00:00.000Z",
              updatedAt: "2026-06-01T10:10:00.000Z",
            },
          },
          subtotal: 16000,
          createdAt: "2026-06-01T10:00:00.000Z",
        },
        payment: {
          status: "pending",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 160,
          totalAmountCents: 16000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "pending",
            provider: "future_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-1",
            nextAction,
            amountCents: 16000,
            paidAmountCents: 0,
            refundedAmountCents: 0,
            childPaymentIds: [],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:10:00.000Z",
          },
        },
      });

      const wrapper = mountView();
      await flushPromises();

      await wrapper.get('[data-testid="market-checkout-pay"]').trigger("click");
      await flushPromises();

      expect(windowOpen).not.toHaveBeenCalled();
      expect(
        wrapper.get('[data-testid="market-checkout-payment-action"]').text(),
      ).toContain(expectedMessage);
      expect(
        wrapper.get('[data-testid="market-checkout-payment-summary"]').text(),
      ).toContain("markets.checkout.marketPaymentStatus.pending");
      expect(
        localStorage.getItem("makanmakan_recent_market_checkouts"),
      ).toContain('"paymentStatus":"pending"');
    },
  );

  it("renders the webhook-paid checkout after returning from provider redirect", async () => {
    getMarketCheckout
      .mockResolvedValueOnce({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
            paymentStatus: "completed",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
            paymentStatus: "completed",
          },
        ],
        payment: {
          status: "paid",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 240,
          paidAmountCents: 24000,
          paidAt: "2026-06-01T10:15:00.000Z",
          childPayments: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 101,
              orderNumber: "A001",
              paymentId: "mock-pay-101",
              status: "paid",
              amount: 160,
              amountCents: 16000,
            },
            {
              restaurantId: "restaurant-2",
              restaurantName: "甜點攤",
              orderId: 102,
              orderNumber: "A002",
              paymentId: "mock-pay-102",
              status: "paid",
              amount: 80,
              amountCents: 8000,
            },
          ],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "paid",
            provider: "mock_market_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-checkout-1",
            amountCents: 24000,
            paidAmountCents: 24000,
            refundedAmountCents: 0,
            childPaymentIds: [],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:15:00.000Z",
          },
        },
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      });
    payMarketCheckout.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "pending",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 0,
          paidAmountCents: 0,
          childPayments: [],
          parentPayment: {
            paymentId: "market_pay_checkout-1",
            status: "pending",
            provider: "mock_market_provider",
            splitMode: "provider_split",
            idempotencyKey: "market-checkout:checkout-1",
            providerTransactionId: "intent-market-checkout-1",
            nextAction: {
              type: "redirect",
              redirectUrl:
                "https://payments.example.test/confirm/intent-market-checkout-1",
            },
            amountCents: 24000,
            paidAmountCents: 0,
            refundedAmountCents: 0,
            childPaymentIds: [],
            createdAt: "2026-06-01T10:00:00.000Z",
            updatedAt: "2026-06-01T10:10:00.000Z",
          },
        },
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      payment: {
        status: "pending",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 0,
        paidAmountCents: 0,
        childPayments: [],
        parentPayment: {
          paymentId: "market_pay_checkout-1",
          status: "pending",
          provider: "mock_market_provider",
          splitMode: "provider_split",
          idempotencyKey: "market-checkout:checkout-1",
          providerTransactionId: "intent-market-checkout-1",
          nextAction: {
            type: "redirect",
            redirectUrl:
              "https://payments.example.test/confirm/intent-market-checkout-1",
          },
          amountCents: 24000,
          paidAmountCents: 0,
          refundedAmountCents: 0,
          childPaymentIds: [],
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:10:00.000Z",
        },
      },
    });

    const wrapper = mountView();
    await flushPromises();

    await wrapper.get('[data-testid="market-checkout-pay"]').trigger("click");
    await flushPromises();
    expect(windowOpen).toHaveBeenCalledWith(
      "https://payments.example.test/confirm/intent-market-checkout-1",
      "_self",
    );

    wrapper.unmount();
    const returnedWrapper = mountView();
    await flushPromises();

    expect(getMarketCheckout).toHaveBeenCalledTimes(2);
    const paymentSummary = returnedWrapper.get(
      '[data-testid="market-checkout-payment-summary"]',
    );
    expect(paymentSummary.text()).toContain(
      "markets.checkout.marketPaymentStatus.paid",
    );
    expect(paymentSummary.text()).toContain("NT$240 / NT$240");
    expect(paymentSummary.text()).toContain(
      "markets.checkout.paymentProgress:2,2",
    );
    expect(
      returnedWrapper.find('[data-testid="market-checkout-pay"]').exists(),
    ).toBe(false);
    expect(
      localStorage.getItem("makanmakan_recent_market_checkouts"),
    ).toContain('"paymentStatus":"paid"');
  });

  it("shows partial payment failures and lets users retry unpaid vendors", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "甜點攤",
          orderId: 102,
          orderNumber: "A002",
          totalAmount: 80,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      payment: {
        status: "partial_paid",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 160,
        paidAmountCents: 16000,
        failedAt: "2026-06-01T10:10:00.000Z",
        childPayments: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            paymentId: "pay-101",
            status: "paid",
            amount: 160,
            amountCents: 16000,
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            status: "failed",
            amount: 80,
            amountCents: 8000,
            errorMessage: "Gateway declined",
          },
        ],
      },
      subtotal: 24000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });
    payMarketCheckout.mockResolvedValueOnce({
      checkout: {
        id: "checkout-1",
        market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
        status: "submitted",
        childOrders: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            totalAmount: 160,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 102,
            orderNumber: "A002",
            totalAmount: 80,
            tokenExpiresAt: "2026-06-01T12:00:00.000Z",
          },
        ],
        payment: {
          status: "paid",
          method: "market_online",
          currency: "TWD",
          country: "TW",
          totalAmount: 240,
          totalAmountCents: 24000,
          paidAmount: 240,
          paidAmountCents: 24000,
          paidAt: "2026-06-01T10:12:00.000Z",
          childPayments: [],
        },
        subtotal: 24000,
        createdAt: "2026-06-01T10:00:00.000Z",
      },
      payment: {
        status: "paid",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 240,
        paidAmountCents: 24000,
        childPayments: [],
      },
    });

    const wrapper = mountView();
    await flushPromises();

    const paymentSummary = wrapper.get(
      '[data-testid="market-checkout-payment-summary"]',
    );
    expect(paymentSummary.text()).toContain(
      "markets.checkout.marketPaymentStatus.partial_paid",
    );
    expect(paymentSummary.text()).toContain("NT$160 / NT$240");
    expect(
      wrapper.get('[data-testid="market-checkout-payment-failures"]').text(),
    ).toContain("markets.checkout.childPaymentFailure:甜點攤,Gateway declined");
    expect(
      wrapper.get('[data-testid="market-checkout-payment-summary"]').classes(),
    ).toContain("bg-amber-50");
    expect(wrapper.get('[data-testid="market-checkout-pay"]').text()).toContain(
      "markets.checkout.payRetryUnpaid",
    );

    await wrapper.get('[data-testid="market-checkout-pay"]').trigger("click");
    await flushPromises();

    expect(payMarketCheckout).toHaveBeenCalledWith("checkout-1", {
      method: "market_online",
      country: "TW",
      currency: "TWD",
    });
    expect(
      localStorage.getItem("makanmakan_recent_market_checkouts"),
    ).toContain('"paymentStatus":"paid"');
  });

  it("shows a failed payment retry hint and records the failed recent status", async () => {
    getMarketCheckout.mockResolvedValueOnce({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 101,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      payment: {
        status: "failed",
        method: "market_online",
        currency: "TWD",
        country: "TW",
        totalAmount: 160,
        totalAmountCents: 16000,
        paidAmount: 0,
        paidAmountCents: 0,
        failedAt: "2026-06-01T10:10:00.000Z",
        childPayments: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 101,
            orderNumber: "A001",
            status: "failed",
            amount: 160,
            amountCents: 16000,
            errorMessage: "Payment gateway failed",
          },
        ],
      },
      subtotal: 16000,
      createdAt: "2026-06-01T10:00:00.000Z",
    });

    const wrapper = mountView();
    await flushPromises();

    const paymentSummary = wrapper.get(
      '[data-testid="market-checkout-payment-summary"]',
    );
    expect(paymentSummary.text()).toContain(
      "markets.checkout.marketPaymentStatus.failed",
    );
    expect(paymentSummary.classes()).toContain("bg-red-50");
    expect(
      wrapper.get('[data-testid="market-checkout-payment-retry-hint"]').text(),
    ).toContain("markets.checkout.paymentRetryHint");
    expect(wrapper.get('[data-testid="market-checkout-pay"]').text()).toContain(
      "markets.checkout.payAgain",
    );
    expect(
      localStorage.getItem("makanmakan_recent_market_checkouts"),
    ).toContain('"paymentStatus":"failed"');
  });

  it("shows a retry state when checkout loading fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    getMarketCheckout.mockRejectedValueOnce(new Error("Not found"));

    const wrapper = mountView();
    await flushPromises();

    // The server's own words no longer reach the page; the reader gets the
    // translated failure and the detail goes to the console.
    expect(
      wrapper.get('[data-testid="market-checkout-error"]').text(),
    ).toContain("markets.checkout.loadFailed");
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to load market checkout:",
      expect.objectContaining({ message: "Not found" }),
    );
    consoleError.mockRestore();
  });
});
