import { api, unwrapApiPayload } from "@/services/api";

export type MarketCheckoutPaymentStatus =
  | "pending"
  | "partial_paid"
  | "paid"
  | "failed"
  | "refunded"
  | "partial_refunded";

export type MarketCheckoutSplitMode = "child_transactions" | "provider_split";
export type MarketCheckoutPaymentProviderReadiness =
  | "ready"
  | "warning"
  | "not_configured";

export interface MarketCheckoutProviderNextAction {
  type: "redirect" | "client_secret" | "sdk_confirmation";
  redirectUrl?: string;
  clientSecret?: string;
  expiresAt?: string;
  providerPayload?: Record<string, unknown>;
}

export interface MarketCheckoutProviderLastWebhook {
  provider: string;
  eventId?: string | null;
  eventType: string;
  status: string;
  receivedAt: string;
  payloadSummary?: MarketCheckoutProviderPayloadSummary;
}

export interface MarketCheckoutProviderPayloadSummary {
  objectId?: string;
  providerTransactionId?: string;
  status?: string;
  amountCents?: number;
  amountReceivedCents?: number;
  amountRefundedCents?: number;
  currency?: string;
  metadataKeys?: string[];
  failureCode?: string;
  failureReason?: string;
}

export interface MarketCheckoutListItem {
  id: string;
  market: {
    id: string;
    slug: string;
    name: string;
  };
  status: "submitted";
  paymentStatus: MarketCheckoutPaymentStatus;
  subtotal: number;
  childOrderCount: number;
  operationAlerts?: MarketCheckoutOperationAlert[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketCheckoutOperationAlert {
  type:
    | "provider_pending_stale"
    | "provider_webhook_missing"
    | "provider_webhook_failed"
    | "provider_status_mismatch"
    | "provider_refund_pending"
    | "provider_refund_failed"
    | "provider_amount_mismatch";
  label: string;
  severity: "warning" | "critical";
}

export type MarketCheckoutOperationAlertType =
  MarketCheckoutOperationAlert["type"];

export interface MarketCheckoutChildOrder {
  restaurantId: string;
  restaurantName: string;
  orderId: number;
  orderNumber: string;
  totalAmount: number;
  totalAmountCents?: number | null;
  tokenExpiresAt: string;
  status?: string;
  paymentStatus?: string;
  updatedAt?: number;
}

export interface MarketCheckoutDetail extends MarketCheckoutListItem {
  childOrders: MarketCheckoutChildOrder[];
  payment?: {
    status: MarketCheckoutPaymentStatus;
    method: string;
    currency: "TWD" | "MYR" | "VND";
    country: "TW" | "MY" | "VN";
    totalAmount: number;
    totalAmountCents: number;
    paidAmount: number;
    paidAmountCents: number;
    refundedAmount?: number;
    refundedAmountCents?: number;
    paidAt?: string;
    failedAt?: string;
    refundedAt?: string;
    childPayments: Array<{
      restaurantId: string;
      restaurantName: string;
      orderId: number;
      orderNumber: string;
      paymentId?: string;
      refundId?: string;
      status: "paid" | "failed" | "refunded";
      amount: number;
      amountCents: number;
      errorMessage?: string;
    }>;
    parentPayment?: {
      paymentId: string;
      status: MarketCheckoutPaymentStatus;
      provider: string;
      splitMode: MarketCheckoutSplitMode;
      idempotencyKey: string;
      providerTransactionId?: string;
      nextAction?: MarketCheckoutProviderNextAction;
      lastWebhook?: MarketCheckoutProviderLastWebhook;
      lastReconciliation?: MarketCheckoutProviderLastWebhook;
      lastRefund?: MarketCheckoutProviderLastWebhook;
      amountCents: number;
      paidAmountCents: number;
      refundedAmountCents: number;
      childPaymentIds: string[];
      createdAt: string;
      updatedAt: string;
    };
    settlement?: {
      platformFeeRateBps: number;
      platformFeeCents: number;
      vendorNetAmountCents: number;
      vendorAllocations: Array<{
        restaurantId: string;
        restaurantName: string;
        orderId: number;
        orderNumber: string;
        grossAmountCents: number;
        refundedAmountCents: number;
        platformFeeCents: number;
        netAmountCents: number;
      }>;
    };
  };
}

export interface MarketCheckoutListResult {
  checkouts: MarketCheckoutListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface MarketCheckoutSummary {
  totalCheckouts: number;
  totalSubtotalCents: number;
  paidAmountCents: number;
  refundedAmountCents: number;
  netPaidAmountCents: number;
  averageCheckoutCents: number;
  childOrderCount: number;
  paymentStatusCounts: Record<MarketCheckoutPaymentStatus | string, number>;
  topMarkets: Array<{
    id: string;
    slug: string;
    name: string;
    checkoutCount: number;
    subtotalCents: number;
    paidAmountCents: number;
    refundedAmountCents: number;
  }>;
}

export interface MarketCheckoutVendorSettlement {
  restaurantId: string;
  restaurantName: string;
  checkoutCount: number;
  childOrderCount: number;
  subtotalCents: number;
  paidAmountCents: number;
  refundedAmountCents: number;
  netPaidAmountCents: number;
  platformFeeCents: number;
  vendorNetAmountCents: number;
  refundedPaymentCount: number;
  failedPaymentCount: number;
}

export interface MarketCheckoutVendorSettlementResult {
  vendors: MarketCheckoutVendorSettlement[];
}

export interface MarketCheckoutPaymentProviderStatus {
  splitMode: MarketCheckoutSplitMode;
  readiness: MarketCheckoutPaymentProviderReadiness;
  providerKind: "internal_child_transactions" | "http_provider_split";
  providerSplitUrlConfigured: boolean;
  providerSplitHealthUrlConfigured: boolean;
  providerStatusUrlConfigured: boolean;
  providerRefundUrlConfigured: boolean;
  providerSplitTokenConfigured: boolean;
  providerSplitSigningConfigured: boolean;
  providerWebhookSecretConfigured: boolean;
  capabilities: string[];
  missingConfiguration: string[];
  notes: string[];
}

export interface MarketCheckoutPaymentProviderConnectivityCheck {
  status: "passed" | "skipped" | "failed";
  checkedAt: string;
  splitMode: MarketCheckoutSplitMode;
  target?: string;
  message: string;
  responseStatus?: number;
  capabilities?: string[];
}

export interface MarketCheckoutPaymentReconciliationResult {
  provider: string;
  checkoutId: string;
  paymentId: string;
  status: MarketCheckoutPaymentStatus;
  providerTransactionId?: string;
  eventId?: string;
  eventType: string;
}

export const marketCheckoutsService = {
  async list(
    input: {
      page?: number;
      limit?: number;
      marketSlug?: string;
      paymentStatus?: MarketCheckoutPaymentStatus | "";
      operationAlert?: MarketCheckoutOperationAlertType | "";
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<MarketCheckoutListResult> {
    const response = await api.get<MarketCheckoutListResult>(
      "/market-checkouts/admin",
      {
        page: input.page ?? 1,
        limit: input.limit ?? 20,
        marketSlug: input.marketSlug || undefined,
        paymentStatus: input.paymentStatus || undefined,
        operationAlert: input.operationAlert || undefined,
        dateFrom: input.dateFrom || undefined,
        dateTo: input.dateTo || undefined,
      },
    );
    return unwrapApiPayload<MarketCheckoutListResult>(response.data);
  },

  async get(id: string): Promise<MarketCheckoutDetail> {
    const response = await api.get<{ checkout: MarketCheckoutDetail }>(
      `/market-checkouts/admin/${id}`,
    );
    return unwrapApiPayload<{ checkout: MarketCheckoutDetail }>(response.data)
      .checkout;
  },

  async summary(
    input: {
      marketSlug?: string;
      paymentStatus?: MarketCheckoutPaymentStatus | "";
      operationAlert?: MarketCheckoutOperationAlertType | "";
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<MarketCheckoutSummary> {
    const response = await api.get<MarketCheckoutSummary>(
      "/market-checkouts/admin/summary",
      {
        marketSlug: input.marketSlug || undefined,
        paymentStatus: input.paymentStatus || undefined,
        dateFrom: input.dateFrom || undefined,
        dateTo: input.dateTo || undefined,
      },
    );
    return unwrapApiPayload<MarketCheckoutSummary>(response.data);
  },

  async vendors(
    input: {
      marketSlug?: string;
      paymentStatus?: MarketCheckoutPaymentStatus | "";
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<MarketCheckoutVendorSettlementResult> {
    const response = await api.get<MarketCheckoutVendorSettlementResult>(
      "/market-checkouts/admin/vendors",
      {
        marketSlug: input.marketSlug || undefined,
        paymentStatus: input.paymentStatus || undefined,
        dateFrom: input.dateFrom || undefined,
        dateTo: input.dateTo || undefined,
      },
    );
    return unwrapApiPayload<MarketCheckoutVendorSettlementResult>(
      response.data,
    );
  },

  async providerStatus(): Promise<MarketCheckoutPaymentProviderStatus> {
    const response = await api.get<MarketCheckoutPaymentProviderStatus>(
      "/market-checkouts/admin/provider-status",
    );
    return unwrapApiPayload<MarketCheckoutPaymentProviderStatus>(response.data);
  },

  async checkProviderConnectivity(): Promise<MarketCheckoutPaymentProviderConnectivityCheck> {
    const response =
      await api.post<MarketCheckoutPaymentProviderConnectivityCheck>(
        "/market-checkouts/admin/provider-status/check",
        {},
      );
    return unwrapApiPayload<MarketCheckoutPaymentProviderConnectivityCheck>(
      response.data,
    );
  },

  async reconcile(
    id: string,
  ): Promise<MarketCheckoutPaymentReconciliationResult> {
    const response = await api.post<{
      reconciliation: MarketCheckoutPaymentReconciliationResult;
    }>(`/market-checkouts/admin/${id}/reconcile`, {});
    return unwrapApiPayload<{
      reconciliation: MarketCheckoutPaymentReconciliationResult;
    }>(response.data).reconciliation;
  },

  async exportCsv(
    input: {
      marketSlug?: string;
      paymentStatus?: MarketCheckoutPaymentStatus | "";
      operationAlert?: MarketCheckoutOperationAlertType | "";
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<Blob> {
    const response = await api.instance.get<Blob>(
      "/market-checkouts/admin/export",
      {
        params: {
          marketSlug: input.marketSlug || undefined,
          paymentStatus: input.paymentStatus || undefined,
          operationAlert: input.operationAlert || undefined,
          dateFrom: input.dateFrom || undefined,
          dateTo: input.dateTo || undefined,
        },
        responseType: "blob",
      },
    );
    return response.data;
  },

  async exportVendorsCsv(
    input: {
      marketSlug?: string;
      paymentStatus?: MarketCheckoutPaymentStatus | "";
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<Blob> {
    const response = await api.instance.get<Blob>(
      "/market-checkouts/admin/vendors/export",
      {
        params: {
          marketSlug: input.marketSlug || undefined,
          paymentStatus: input.paymentStatus || undefined,
          dateFrom: input.dateFrom || undefined,
          dateTo: input.dateTo || undefined,
        },
        responseType: "blob",
      },
    );
    return response.data;
  },

  async exportAccountingCsv(
    input: {
      marketSlug?: string;
      paymentStatus?: MarketCheckoutPaymentStatus | "";
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<Blob> {
    const response = await api.instance.get<Blob>(
      "/market-checkouts/admin/accounting/export",
      {
        params: {
          marketSlug: input.marketSlug || undefined,
          paymentStatus: input.paymentStatus || undefined,
          dateFrom: input.dateFrom || undefined,
          dateTo: input.dateTo || undefined,
        },
        responseType: "blob",
      },
    );
    return response.data;
  },

  async refund(id: string, reason?: string): Promise<MarketCheckoutDetail> {
    const response = await api.post<{ checkout: MarketCheckoutDetail }>(
      `/market-checkouts/${id}/refund`,
      { reason },
    );
    return unwrapApiPayload<{ checkout: MarketCheckoutDetail }>(response.data)
      .checkout;
  },
};
