// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import PlatformMarketCheckoutsView from "./PlatformMarketCheckoutsView.vue";
import { marketCheckoutsService } from "@/services/marketCheckoutsService";

vi.mock("@/services/marketCheckoutsService", () => ({
  marketCheckoutsService: {
    list: vi.fn(),
    get: vi.fn(),
    summary: vi.fn(),
    vendors: vi.fn(),
    providerStatus: vi.fn(),
    checkProviderConnectivity: vi.fn(),
    reconcile: vi.fn(),
    exportCsv: vi.fn(),
    exportVendorsCsv: vi.fn(),
    exportAccountingCsv: vi.fn(),
    refund: vi.fn(),
  },
}));

describe("PlatformMarketCheckoutsView", () => {
  function configureServiceMocks() {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:market-checkouts"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(vi.fn());
    vi.mocked(marketCheckoutsService.list).mockResolvedValue({
      checkouts: [
        {
          id: "checkout-1",
          market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
          status: "submitted",
          paymentStatus: "partial_paid",
          subtotal: 24000,
          childOrderCount: 2,
          createdAt: "2026-06-01T10:00:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
          operationAlerts: [
            {
              type: "provider_pending_stale",
              label: "待對帳",
              severity: "warning",
            },
            {
              type: "provider_webhook_missing",
              label: "未收到 webhook",
              severity: "warning",
            },
          ],
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    vi.mocked(marketCheckoutsService.summary).mockResolvedValue({
      totalCheckouts: 2,
      totalSubtotalCents: 32000,
      paidAmountCents: 16000,
      refundedAmountCents: 8000,
      netPaidAmountCents: 8000,
      averageCheckoutCents: 16000,
      childOrderCount: 3,
      paymentStatusCounts: {
        pending: 0,
        partial_paid: 1,
        paid: 0,
        failed: 1,
        refunded: 0,
        partial_refunded: 0,
      },
      topMarkets: [
        {
          id: "market-1",
          slug: "fengjia",
          name: "逢甲夜市",
          checkoutCount: 2,
          subtotalCents: 32000,
          paidAmountCents: 16000,
          refundedAmountCents: 8000,
        },
      ],
    });
    vi.mocked(marketCheckoutsService.vendors).mockResolvedValue({
      vendors: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          checkoutCount: 2,
          childOrderCount: 2,
          subtotalCents: 24000,
          paidAmountCents: 24000,
          refundedAmountCents: 8000,
          netPaidAmountCents: 16000,
          platformFeeCents: 840,
          vendorNetAmountCents: 15160,
          refundedPaymentCount: 1,
          failedPaymentCount: 0,
        },
      ],
    });
    vi.mocked(marketCheckoutsService.providerStatus).mockResolvedValue({
      splitMode: "provider_split",
      readiness: "not_configured",
      providerKind: "http_provider_split",
      providerSplitUrlConfigured: false,
      providerSplitHealthUrlConfigured: false,
      providerStatusUrlConfigured: false,
      providerRefundUrlConfigured: false,
      providerSplitTokenConfigured: false,
      providerSplitSigningConfigured: false,
      providerWebhookSecretConfigured: false,
      capabilities: ["webhook_status_sync", "refunds"],
      missingConfiguration: ["MARKET_CHECKOUT_PROVIDER_SPLIT_URL"],
      notes: [
        "Provider split mode is enabled but no HTTP gateway URL is configured.",
      ],
    });
    vi.mocked(
      marketCheckoutsService.checkProviderConnectivity,
    ).mockResolvedValue({
      status: "skipped",
      checkedAt: "2026-06-01T10:10:00.000Z",
      splitMode: "provider_split",
      message:
        "Provider split gateway URL is configured, but no health check URL is configured.",
    });
    vi.mocked(marketCheckoutsService.reconcile).mockResolvedValue({
      provider: "mock_market_provider",
      checkoutId: "checkout-1",
      paymentId: "market_pay_checkout-1",
      status: "paid",
      providerTransactionId: "intent-market-checkout-1",
      eventId: "reconcile-market-checkout-1",
      eventType: "market_checkout.payment_paid",
    });
    vi.mocked(marketCheckoutsService.get).mockResolvedValue({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      paymentStatus: "partial_paid",
      subtotal: 24000,
      childOrderCount: 2,
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:05:00.000Z",
      childOrders: [
        {
          restaurantId: "restaurant-1",
          restaurantName: "雞排攤",
          orderId: 1001,
          orderNumber: "A001",
          totalAmount: 160,
          tokenExpiresAt: "2026-06-01T14:00:00.000Z",
          status: "preparing",
          paymentStatus: "paid",
        },
        {
          restaurantId: "restaurant-2",
          restaurantName: "甜點攤",
          orderId: 1002,
          orderNumber: "A002",
          totalAmount: 80,
          tokenExpiresAt: "2026-06-01T14:00:00.000Z",
          status: "confirmed",
          paymentStatus: "pending",
        },
      ],
      payment: {
        status: "partial_paid",
        method: "line_pay",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 160,
        paidAmountCents: 16000,
        childPayments: [
          {
            restaurantId: "restaurant-1",
            restaurantName: "雞排攤",
            orderId: 1001,
            orderNumber: "A001",
            paymentId: "pay-1",
            status: "paid",
            amount: 160,
            amountCents: 16000,
          },
          {
            restaurantId: "restaurant-2",
            restaurantName: "甜點攤",
            orderId: 1002,
            orderNumber: "A002",
            status: "failed",
            amount: 80,
            amountCents: 8000,
            errorMessage: "Gateway declined",
          },
        ],
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
          lastWebhook: {
            provider: "mock_market_provider",
            eventId: "evt-market-checkout-failed-1",
            eventType: "market_checkout.payment_failed",
            status: "failed",
            receivedAt: "2026-06-01T10:09:00.000Z",
            payloadSummary: {
              objectId: "intent-market-checkout-1",
              status: "failed",
              amountReceivedCents: 16000,
              currency: "TWD",
              metadataKeys: ["marketCheckoutId", "customerPhone"],
              failureCode: "card_declined",
              failureReason: "Card was declined by issuer",
            },
          },
          lastReconciliation: {
            provider: "mock_market_provider",
            eventId: "reconcile-market-checkout-1",
            eventType: "market_checkout.payment_pending",
            status: "pending",
            receivedAt: "2026-06-01T10:11:00.000Z",
            payloadSummary: {
              providerTransactionId: "intent-market-checkout-1",
              status: "pending",
              amountCents: 24000,
              currency: "TWD",
              metadataKeys: ["marketCheckoutId"],
              failureCode: "provider_pending_timeout",
              failureReason: "Provider status remained pending",
            },
          },
          lastRefund: {
            provider: "mock_market_provider",
            eventId: "refund-pending-1",
            eventType: "market_checkout.refund_pending",
            status: "pending",
            receivedAt: "2026-06-01T10:12:00.000Z",
            payloadSummary: {
              providerTransactionId: "intent-market-checkout-1",
              status: "pending",
              amountRefundedCents: 0,
              currency: "TWD",
            },
          },
          amountCents: 24000,
          paidAmountCents: 16000,
          refundedAmountCents: 0,
          childPaymentIds: ["pay-1"],
          createdAt: "2026-06-01T10:05:00.000Z",
          updatedAt: "2026-06-01T10:05:00.000Z",
        },
        settlement: {
          platformFeeRateBps: 350,
          platformFeeCents: 560,
          vendorNetAmountCents: 15440,
          vendorAllocations: [
            {
              restaurantId: "restaurant-1",
              restaurantName: "雞排攤",
              orderId: 1001,
              orderNumber: "A001",
              grossAmountCents: 16000,
              refundedAmountCents: 0,
              platformFeeCents: 560,
              netAmountCents: 15440,
            },
            {
              restaurantId: "restaurant-2",
              restaurantName: "甜點攤",
              orderId: 1002,
              orderNumber: "A002",
              grossAmountCents: 0,
              refundedAmountCents: 0,
              platformFeeCents: 0,
              netAmountCents: 0,
            },
          ],
        },
      },
    });
    vi.mocked(marketCheckoutsService.exportCsv).mockResolvedValue(
      new Blob(["checkout_id\ncheckout-1"], { type: "text/csv" }),
    );
    vi.mocked(marketCheckoutsService.exportVendorsCsv).mockResolvedValue(
      new Blob(["restaurant_id\nrestaurant-1"], { type: "text/csv" }),
    );
    vi.mocked(marketCheckoutsService.exportAccountingCsv).mockResolvedValue(
      new Blob(["account_code\n1100"], { type: "text/csv" }),
    );
    vi.mocked(marketCheckoutsService.refund).mockResolvedValue({
      id: "checkout-1",
      market: { id: "market-1", slug: "fengjia", name: "逢甲夜市" },
      status: "submitted",
      paymentStatus: "refunded",
      subtotal: 24000,
      childOrderCount: 2,
      createdAt: "2026-06-01T10:00:00.000Z",
      updatedAt: "2026-06-01T10:05:00.000Z",
      childOrders: [],
      payment: {
        status: "refunded",
        method: "line_pay",
        currency: "TWD",
        country: "TW",
        totalAmount: 240,
        totalAmountCents: 24000,
        paidAmount: 160,
        paidAmountCents: 16000,
        refundedAmount: 160,
        refundedAmountCents: 16000,
        childPayments: [],
      },
    });
  }

  beforeEach(configureServiceMocks);

  // The first mount of this view in a worker costs ~740ms against a loaded
  // machine; later mounts cost ~250ms. That one-off is Vue render warm-up
  // plus jsdom's first DOM build for this tree -- re-usable state, not
  // per-test work -- so pay it here under the hook budget rather than inside
  // whichever timed body happens to run first.
  beforeAll(async () => {
    configureServiceMocks();
    const warmup = mount(PlatformMarketCheckoutsView);
    await flushPromises();
    warmup.unmount();
  }, 30_000);

  async function mountView() {
    const wrapper = mount(PlatformMarketCheckoutsView);
    await flushPromises();
    return wrapper;
  }

  async function applyDateAndAlertFilters(
    wrapper: Awaited<ReturnType<typeof mountView>>,
  ) {
    await wrapper
      .get('[data-testid="market-checkout-date-from"]')
      .setValue("2026-06-01");
    await wrapper
      .get('[data-testid="market-checkout-date-to"]')
      .setValue("2026-06-02");
    await wrapper
      .get('[data-testid="market-checkout-operation-alert"]')
      .setValue("provider_webhook_failed");
    await wrapper
      .get('[data-testid="market-checkout-filter"]')
      .trigger("click");
    await flushPromises();
  }

  async function openCheckoutDetail(
    wrapper: Awaited<ReturnType<typeof mountView>>,
  ) {
    await wrapper
      .get('[data-testid="open-checkout-checkout-1"]')
      .trigger("click");
    await flushPromises();
  }

  // Every one of these used to be one stage of a single 341-line `it` that
  // burned ~3.7s of the 5s testTimeout on a loaded machine -- eight
  // interaction rounds in one body, which is what made it fail under
  // `turbo run test` and pass on its own (#351). They assert about separate
  // panels, so they are separate tests; each re-mounts, which the warm-up
  // above keeps cheap.
  it("lists market checkouts with their operation alerts, summary and provider status", async () => {
    const wrapper = await mountView();

    expect(marketCheckoutsService.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      marketSlug: "",
      paymentStatus: "",
      operationAlert: "",
      dateFrom: "",
      dateTo: "",
    });
    expect(marketCheckoutsService.summary).toHaveBeenCalledWith({
      marketSlug: "",
      paymentStatus: "",
      dateFrom: "",
      dateTo: "",
    });
    expect(marketCheckoutsService.vendors).toHaveBeenCalledWith({
      marketSlug: "",
      paymentStatus: "",
      dateFrom: "",
      dateTo: "",
    });
    expect(marketCheckoutsService.providerStatus).toHaveBeenCalled();
    expect(wrapper.text()).toContain("逢甲夜市");
    expect(wrapper.text()).toContain("部分付款");
    expect(wrapper.text()).toContain("2 攤");
    expect(
      wrapper.get('[data-testid="checkout-operation-alerts"]').text(),
    ).toContain("待對帳");
    expect(
      wrapper.get('[data-testid="checkout-operation-alerts"]').text(),
    ).toContain("未收到 webhook");
    expect(wrapper.get('[data-testid="provider-status"]').text()).toContain(
      "Provider 統一授權拆帳",
    );
    expect(wrapper.get('[data-testid="provider-status"]').text()).toContain(
      "未設定",
    );
    expect(wrapper.get('[data-testid="provider-status"]').text()).toContain(
      "MARKET_CHECKOUT_PROVIDER_SPLIT_URL",
    );
    expect(wrapper.get('[data-testid="provider-status"]').text()).toContain(
      "Webhook 驗簽 secret",
    );
    expect(wrapper.get('[data-testid="provider-status"]').text()).toContain(
      "Provider status lookup URL",
    );
    expect(wrapper.get('[data-testid="provider-status"]').text()).toContain(
      "Provider refund URL",
    );

    expect(wrapper.get('[data-testid="checkout-summary"]').text()).toContain(
      "GMV",
    );
    expect(wrapper.get('[data-testid="checkout-summary"]').text()).toContain(
      "$320",
    );
    expect(wrapper.get('[data-testid="checkout-summary"]').text()).toContain(
      "異常",
    );
    expect(wrapper.get('[data-testid="vendor-settlements"]').text()).toContain(
      "雞排攤",
    );
    expect(wrapper.get('[data-testid="vendor-settlements"]').text()).toContain(
      "$160",
    );
    expect(wrapper.get('[data-testid="vendor-settlements"]').text()).toContain(
      "平台費",
    );
    expect(wrapper.get('[data-testid="vendor-settlements"]').text()).toContain(
      "淨撥款",
    );
    expect(wrapper.get('[data-testid="vendor-settlements"]').text()).toContain(
      "$8",
    );
    expect(wrapper.get('[data-testid="vendor-settlements"]').text()).toContain(
      "$152",
    );
  });

  it("checks provider connectivity on demand", async () => {
    const wrapper = await mountView();

    await wrapper
      .get('[data-testid="check-provider-connectivity"]')
      .trigger("click");
    await flushPromises();

    expect(marketCheckoutsService.checkProviderConnectivity).toHaveBeenCalled();
    expect(
      wrapper.get('[data-testid="provider-connectivity-check"]').text(),
    ).toContain("未檢查");
    expect(
      wrapper.get('[data-testid="provider-connectivity-check"]').text(),
    ).toContain("Provider split gateway URL is configured");
  });

  it("applies the date and alert filters to the list, summary and vendor queries", async () => {
    const wrapper = await mountView();
    await applyDateAndAlertFilters(wrapper);

    expect(marketCheckoutsService.list).toHaveBeenLastCalledWith({
      page: 1,
      limit: 20,
      marketSlug: "",
      paymentStatus: "",
      operationAlert: "provider_webhook_failed",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
    });
    expect(marketCheckoutsService.summary).toHaveBeenLastCalledWith({
      marketSlug: "",
      paymentStatus: "",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
    });
    expect(marketCheckoutsService.vendors).toHaveBeenLastCalledWith({
      marketSlug: "",
      paymentStatus: "",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
    });
  });

  it("exports checkouts, vendor settlements and the accounting ledger under the active filters", async () => {
    const wrapper = await mountView();
    await applyDateAndAlertFilters(wrapper);

    await wrapper.get('[data-testid="export-checkouts"]').trigger("click");
    await flushPromises();

    expect(marketCheckoutsService.exportCsv).toHaveBeenCalledWith({
      marketSlug: "",
      paymentStatus: "",
      operationAlert: "provider_webhook_failed",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
    });

    await wrapper
      .get('[data-testid="export-vendor-settlements"]')
      .trigger("click");
    await flushPromises();

    expect(marketCheckoutsService.exportVendorsCsv).toHaveBeenCalledWith({
      marketSlug: "",
      paymentStatus: "",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
    });

    await wrapper
      .get('[data-testid="export-accounting-ledger"]')
      .trigger("click");
    await flushPromises();

    expect(marketCheckoutsService.exportAccountingCsv).toHaveBeenCalledWith({
      marketSlug: "",
      paymentStatus: "",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-02",
    });
  });

  it("opens child order details with the parent payment timeline", async () => {
    const wrapper = await mountView();
    await openCheckoutDetail(wrapper);

    expect(marketCheckoutsService.get).toHaveBeenCalledWith("checkout-1");
    expect(wrapper.get('[data-testid="checkout-detail"]').text()).toContain(
      "雞排攤",
    );
    expect(wrapper.get('[data-testid="checkout-detail"]').text()).toContain(
      "A001",
    );
    expect(wrapper.get('[data-testid="checkout-detail"]').text()).toContain(
      "已付款 160 / 240",
    );
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("market_pay_checkout-1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("付款商拆帳");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("mock_market_provider");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("intent-market-checkout-1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("redirect");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("payments.example.test");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("最後 webhook");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("evt-market-checkout-failed-1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("market_checkout.payment_failed");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("付款失敗");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
      // The date half is now produced by useDateFormatter rather than a local
      // Intl call, so zh-TW renders "6月1日" instead of "06/01" and the
      // separator is a plain space rather than Intl's narrow no-break space.
      // The hour stays loose so the assertion does not pin a timezone.
    ).toMatch(/6月1日 \d{2}:09/);
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("Webhook 摘要");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("intent-market-checkout-1 · failed · TWD 160");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("metadata: customerPhone, marketCheckoutId");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("card_declined · Card was declined by issuer");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("最後查單");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("reconcile-market-checkout-1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("market_checkout.payment_pending");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("待付款");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toMatch(/6月1日 \d{2}:11/);
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("查單摘要");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("intent-market-checkout-1 · pending · TWD 240");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("provider_pending_timeout · Provider status remained pending");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("最後退款");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("refund-pending-1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("market_checkout.refund_pending");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("退款摘要");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("intent-market-checkout-1 · pending · TWD 0");
    expect(
      wrapper.get('[data-testid="checkout-provider-alerts"]').text(),
    ).toContain("Provider 付款仍待處理超過 30 分鐘");
    expect(
      wrapper.get('[data-testid="checkout-provider-alerts"]').text(),
    ).toContain("最後 webhook 回報付款失敗");
    expect(
      wrapper.get('[data-testid="checkout-provider-alerts"]').text(),
    ).toContain("Provider 退款仍在處理中");
  });

  it("reconciles an open checkout and refreshes its settlement panel", async () => {
    const wrapper = await mountView();
    await openCheckoutDetail(wrapper);

    await wrapper.get('[data-testid="reconcile-checkout"]').trigger("click");
    await flushPromises();

    expect(marketCheckoutsService.reconcile).toHaveBeenCalledWith("checkout-1");
    expect(marketCheckoutsService.get).toHaveBeenCalledWith("checkout-1");
    expect(marketCheckoutsService.list).toHaveBeenCalledTimes(2);
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("子交易 1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toContain("冪等鍵 market-checkout:checkout-1");
    expect(
      wrapper.get('[data-testid="checkout-parent-payment"]').text(),
    ).toMatch(/更新 6月1日 \d{2}:05/);
    expect(wrapper.get('[data-testid="checkout-settlement"]').text()).toContain(
      "對帳分配",
    );
    expect(wrapper.get('[data-testid="checkout-settlement"]').text()).toContain(
      "平台費率 3.50%",
    );
    // NT$ rather than $: these amounts now come from the shared currency
    // helper, which uses the app-wide TWD symbol. The rest of this panel
    // already rendered NT$ via formatPrice, so the panel was inconsistent
    // with itself before and is uniform now.
    expect(wrapper.get('[data-testid="checkout-settlement"]').text()).toContain(
      "攤位淨收 NT$154",
    );
    expect(wrapper.get('[data-testid="checkout-settlement"]').text()).toContain(
      "平台費 NT$6",
    );
    expect(wrapper.get('[data-testid="checkout-settlement"]').text()).toContain(
      "甜點攤",
    );
    expect(wrapper.get('[data-testid="checkout-settlement"]').text()).toContain(
      "$0",
    );
    expect(
      wrapper.get('[data-testid="checkout-child-payments"]').text(),
    ).toContain("付款子交易");
    expect(
      wrapper.get('[data-testid="checkout-child-payments"]').text(),
    ).toContain("1 筆失敗");
    expect(
      wrapper.get('[data-testid="checkout-child-payments"]').text(),
    ).toContain("甜點攤");
    expect(
      wrapper.get('[data-testid="checkout-child-payments"]').text(),
    ).toContain("付款失敗");
    expect(
      wrapper.get('[data-testid="checkout-child-payments"]').text(),
    ).toContain("Gateway declined");
    expect(
      wrapper.get('[data-testid="checkout-child-payments"]').text(),
    ).toContain("pay-1");
  });

  it("refunds an open checkout through the admin reason code", async () => {
    const wrapper = await mountView();
    await openCheckoutDetail(wrapper);

    await wrapper.get('[data-testid="refund-checkout"]').trigger("click");
    await flushPromises();

    expect(marketCheckoutsService.refund).toHaveBeenCalledWith(
      "checkout-1",
      "admin_market_checkout_refund",
    );
  });
});
