import { apiClient } from "./api";
import type { StoredMarketCheckout } from "@/utils/marketCheckouts";
import {
  getMarketCheckoutGuestToken,
  recordMarketCheckoutGuestTokens,
  recordRecentMarketCheckout,
  recordRecoveredMarketCheckoutGuestToken,
} from "@/utils/marketCheckouts";
import { isRecord } from "@/utils/unknown";
import type {
  GuestRealtimeTokenResponse,
  Order,
  OrderItem,
  CreateOrderRequest,
  OrderStatus,
  OrderPaymentStatus,
} from "@makanmasak/shared-types";

export interface OrderSummary {
  subtotal: number;
  serviceCharge: number;
  tax: number;
  discount: number;
  total: number;
}

/**
 * Order receipt response — mirrors the server `OrderReceipt` shape returned by
 * `GET /orders/:id/receipt` (apps/api OrdersService.generateReceipt).
 */
export interface OrderReceiptResponse {
  orderNumber: string;
  restaurantInfo: {
    id: number;
    name: string;
    address?: string;
    phone?: string;
    email?: string;
  };
  customerInfo: Record<string, unknown>;
  tableInfo?: {
    id: number;
    number: string;
    seats: number;
  };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    customizations?: string[];
    notes?: string;
  }>;
  summary: {
    subtotal: number;
    tax: number;
    serviceCharge: number;
    discount: number;
    total: number;
  };
  paymentInfo: {
    method: string;
    status: string;
    transactionId?: string;
    paidAt?: string;
  };
  timestamps: {
    orderedAt: string;
    confirmedAt?: string;
    readyAt?: string;
    deliveredAt?: string;
  };
  qrCode?: string;
  footerMessage?: string;
}

export interface OrderTrackingInfo {
  order: Order;
  timeline: Array<{
    status: OrderStatus;
    timestamp: string;
    note?: string;
    estimatedTime?: string;
  }>;
  estimatedReadyTime?: string;
  currentWaitTime?: number;
  queuePosition?: number;
}

/**
 * Reviews (#286). The shapes mirror `apps/api/src/contracts/schemas/reviews.ts`
 * exactly; timestamps are Unix milliseconds, as everywhere else on an order.
 */
export interface OrderReviewItemRating {
  menuItemId: number;
  menuItemName: string | null;
  rating: number;
}

export interface OrderReviewReply {
  content: string;
  repliedBy: string | null;
  repliedAt: number | null;
}

/** What the diner who wrote the review reads back. */
export interface OrderReview {
  id: string;
  orderId: string;
  restaurantId: string;
  rating: number;
  content: string | null;
  createdAt: number;
  updatedAt: number;
  reply: OrderReviewReply | null;
  items: OrderReviewItemRating[];
}

export interface SubmitOrderReviewInput {
  /** 1-5, required. */
  rating: number;
  /** Free text, at most 1000 characters. */
  content?: string | null;
  /** Per-dish ratings, keyed on `menu_items.id`, at most 50. */
  items?: Array<{ menuItemId: number; rating: number }>;
}

/** One row of the public list. Carries no customer or order identifier. */
export interface PublicReview {
  id: string;
  rating: number;
  content: string | null;
  createdAt: number;
  authorName: string | null;
  reply: { content: string; repliedAt: number | null } | null;
}

export interface PublicReviewList {
  reviews: PublicReview[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateGuestOrderRequest {
  restaurantId: string;
  guestName: string;
  /**
   * Idempotency key for this submission. The server has enforced it all along
   * -- `orders` carries a unique index on (restaurant_id, client_mutation_id)
   * in production, and a violation surfaces as CLIENT_MUTATION_DUPLICATE / 409
   * -- but no caller was sending one, so the whole mechanism was dead code.
   *
   * Without it, a connection dropped between the order committing and the KV
   * active-order lock being written (that write is measured at ~380ms) leaves
   * the guest looking at "please try again", and a second tap creates a second
   * order. The KV lock is the only other guard and it is not durable yet in
   * that window.
   */
  clientMutationId?: string;
  orderType: "shop" | "table" | "seat";
  waitingListId?: string;
  customerPhone?: string;
  tableId?: number;
  seatId?: number;
  items: Array<{
    menuItemId: number;
    quantity: number;
    customizations?: unknown;
    notes?: string;
  }>;
  notes?: string;
}

export interface GuestOrderResponse {
  order: Order;
  guestToken: string;
  tokenExpiresAt: string;
}

export interface CreateMarketCheckoutRequest {
  marketSlug: string;
  guestName: string;
  phoneLastDigits: string;
  notes?: string;
  vendors: Array<{
    restaurantId: string;
    items: Array<{
      menuItemId: number;
      quantity: number;
      customizations?: unknown;
      notes?: string;
    }>;
    notes?: string;
    clientMutationId?: string;
  }>;
}

export interface MarketCheckoutResponse {
  checkout: {
    id: string;
    market: {
      id: string;
      slug: string;
      name: string;
    };
    status: "submitted";
    childOrders: Array<{
      restaurantId: string;
      restaurantName: string;
      orderId: number;
      orderNumber: string;
      totalAmount: number;
      totalAmountCents?: number | null;
      tokenExpiresAt: string;
      status?: OrderStatus;
      paymentStatus?: OrderPaymentStatus;
      updatedAt?: number;
    }>;
    payment?: MarketCheckoutPaymentSummary;
    appliedVoucher?: AppliedMarketCheckoutVoucher;
    subtotal: number;
    createdAt: string;
  };
  childOrders: Array<{
    restaurantId: string;
    restaurantName: string;
    order: Order;
    guestToken: string;
    tokenExpiresAt: string;
  }>;
}

export type MarketCheckoutSummary = MarketCheckoutResponse["checkout"];

export interface AppliedMarketCheckoutVoucher {
  couponId: number;
  code: string;
  name: string;
  discountCents: number;
  allocations: Array<{
    orderId: number;
    amountCents: number;
    discountCents: number;
  }>;
}

export interface MarketCheckoutVoucherEnvelope {
  checkout: MarketCheckoutSummary;
  voucher?: AppliedMarketCheckoutVoucher;
  subtotalCents?: number;
  discountCents?: number;
  payableCents?: number;
}

export interface MarketCheckoutPaymentSummary {
  status:
    | "pending"
    | "partial_paid"
    | "paid"
    | "failed"
    | "refunded"
    | "partial_refunded";
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
    status: MarketCheckoutPaymentSummary["status"];
    provider: string;
    splitMode: "child_transactions" | "provider_split";
    idempotencyKey: string;
    providerTransactionId?: string;
    nextAction?: MarketCheckoutProviderNextAction;
    amountCents: number;
    paidAmountCents: number;
    refundedAmountCents: number;
    childPaymentIds: string[];
    createdAt: string;
    updatedAt: string;
  };
}

export interface MarketCheckoutProviderNextAction {
  type: "redirect" | "client_secret" | "sdk_confirmation";
  redirectUrl?: string;
  clientSecret?: string;
  expiresAt?: string;
  providerPayload?: Record<string, unknown>;
}

interface MarketCheckoutEnvelope {
  checkout: MarketCheckoutSummary;
}

interface MarketCheckoutPaymentEnvelope {
  checkout: MarketCheckoutSummary;
  payment: MarketCheckoutPaymentSummary;
}

interface RecoverMarketCheckoutGuestTokenEnvelope {
  orderId: number;
  restaurantId: string;
  guestToken: string;
  tokenExpiresAt: string;
}

interface GuestOrderEnvelope {
  order: Order;
}

export interface GuestRealtimeTokenRequest {
  restaurantId: string;
  tableId: string;
  orderId?: string;
  qrCode: string;
}

// The mutating market checkout endpoints require proof the caller holds the
// checkout. `Authorization` is already spoken for by whichever of the customer
// JWT / guest token the interceptor picked, so the guest token rides along in
// its own header when one is stored for this checkout.
function marketCheckoutHolderConfig(checkoutId: string) {
  const guestToken = getMarketCheckoutGuestToken(checkoutId);
  return guestToken ? { headers: { "X-Guest-Token": guestToken } } : undefined;
}

export const orderApi = {
  /**
   * 創建新訂單（需要登入）
   */
  async createOrder(orderData: CreateOrderRequest): Promise<Order> {
    const response = await apiClient.post<Order>("/orders", orderData);
    return response;
  },

  /**
   * 創建訪客訂單（內用掃碼，不需要登入）
   */
  async createGuestOrder(
    orderData: CreateGuestOrderRequest,
  ): Promise<GuestOrderResponse> {
    const response = await apiClient.post<GuestOrderResponse>(
      "/guest-orders",
      orderData,
    );
    // Store guest token for subsequent requests (order tracking, etc.)
    if (response.guestToken) {
      localStorage.setItem("guest_auth_token", response.guestToken);
    }
    return response;
  },
  async createMarketCheckout(
    checkoutData: CreateMarketCheckoutRequest,
  ): Promise<MarketCheckoutResponse> {
    const response = await apiClient.post<MarketCheckoutResponse>(
      "/market-checkouts",
      checkoutData,
    );
    localStorage.setItem("market_guest_checkout", JSON.stringify(response));
    recordRecentMarketCheckout(response.checkout, checkoutData.phoneLastDigits);
    recordMarketCheckoutGuestTokens(response);
    if (response.childOrders[0]?.guestToken) {
      localStorage.setItem(
        "guest_auth_token",
        response.childOrders[0].guestToken,
      );
    }
    return response;
  },

  async getMarketCheckout(checkoutId: string): Promise<MarketCheckoutSummary> {
    const response = await apiClient.get<MarketCheckoutEnvelope>(
      `/market-checkouts/${checkoutId}`,
      marketCheckoutHolderConfig(checkoutId),
    );
    return response.checkout;
  },

  async recoverMarketCheckoutGuestToken(
    checkoutId: string,
    payload: {
      orderId: number;
      phoneLastDigits?: string;
    },
  ): Promise<RecoverMarketCheckoutGuestTokenEnvelope> {
    const response =
      await apiClient.post<RecoverMarketCheckoutGuestTokenEnvelope>(
        `/market-checkouts/${checkoutId}/guest-token`,
        payload,
      );
    recordRecoveredMarketCheckoutGuestToken({
      checkoutId,
      orderId: response.orderId,
      restaurantId: response.restaurantId,
      guestToken: response.guestToken,
      tokenExpiresAt: response.tokenExpiresAt,
    });
    return response;
  },

  // apiClient already unwraps `{ success, data }`, so the type parameter is the
  // payload itself — typing it as `{ data: … }` would compile and then hand back
  // undefined at runtime.
  listMyMarketCheckouts() {
    return apiClient.get<
      Array<{
        id: string;
        market: { slug: string; name: string };
        paymentStatus: StoredMarketCheckout["paymentStatus"];
        childOrderCount: number;
        subtotal: number;
        createdAt: string;
      }>
    >("/customers/me/market-checkouts");
  },

  async payMarketCheckout(
    checkoutId: string,
    paymentData: {
      method: string;
      country?: "TW" | "MY" | "VN";
      currency?: "TWD" | "MYR" | "VND";
      customerInfo?: {
        name?: string;
        email?: string;
        phone?: string;
      };
      providerInput?: Record<string, unknown>;
    },
  ): Promise<MarketCheckoutPaymentEnvelope> {
    return apiClient.post<MarketCheckoutPaymentEnvelope>(
      `/market-checkouts/${checkoutId}/pay`,
      paymentData,
      marketCheckoutHolderConfig(checkoutId),
    );
  },

  async applyMarketCheckoutVoucher(
    checkoutId: string,
    code: string,
  ): Promise<MarketCheckoutVoucherEnvelope> {
    return apiClient.post<MarketCheckoutVoucherEnvelope>(
      `/market-checkouts/${checkoutId}/voucher`,
      { code },
      marketCheckoutHolderConfig(checkoutId),
    );
  },

  async removeMarketCheckoutVoucher(
    checkoutId: string,
  ): Promise<MarketCheckoutVoucherEnvelope> {
    return apiClient.delete<MarketCheckoutVoucherEnvelope>(
      `/market-checkouts/${checkoutId}/voucher`,
      undefined,
      marketCheckoutHolderConfig(checkoutId),
    );
  },

  /**
   * 獲取訂單詳情
   */
  async getOrder(orderId: string): Promise<Order> {
    const response = await apiClient.get<Order>(`/orders/${orderId}`);
    return response;
  },

  /**
   * 獲取訪客訂單詳情 (uses guest token from localStorage)
   */
  async getGuestOrder(orderId: string): Promise<Order> {
    const response = await apiClient.get<Order | GuestOrderEnvelope>(
      `/guest-orders/${orderId}`,
    );
    // API wraps in { order }, unwrap it
    return "order" in response ? response.order : response;
  },

  async getGuestRealtimeToken(
    payload: GuestRealtimeTokenRequest,
  ): Promise<GuestRealtimeTokenResponse> {
    return apiClient.post<GuestRealtimeTokenResponse>(
      "/realtime/auth/guest-token",
      payload,
    );
  },

  /**
   * 獲取訂單追蹤資訊
   */
  async getOrderTracking(orderId: string): Promise<OrderTrackingInfo> {
    const response = await apiClient.get<OrderTrackingInfo>(
      `/orders/${orderId}/tracking`,
    );
    return response;
  },

  /**
   * 取消訂單
   */
  async cancelOrder(orderId: string, reason?: string): Promise<Order> {
    const response = await apiClient.post<Order>(`/orders/${orderId}/cancel`, {
      reason,
    });
    return response;
  },

  /**
   * 修改訂單項目
   */
  async updateOrderItem(
    orderId: number,
    orderItemId: number,
    updates: {
      quantity?: number;
      notes?: string;
    },
  ): Promise<OrderItem> {
    const response = await apiClient.patch<OrderItem>(
      `/orders/${orderId}/items/${orderItemId}`,
      updates,
    );
    return response;
  },

  /**
   * 添加訂單項目
   */
  async addOrderItem(
    orderId: number,
    itemData: {
      menuItemId: number;
      quantity: number;
      customizations?: unknown;
      notes?: string;
    },
  ): Promise<OrderItem> {
    const response = await apiClient.post<OrderItem>(
      `/orders/${orderId}/items`,
      itemData,
    );
    return response;
  },

  /**
   * 移除訂單項目
   */
  async removeOrderItem(orderId: number, orderItemId: number): Promise<void> {
    await apiClient.delete(`/orders/${orderId}/items/${orderItemId}`);
  },

  /**
   * 計算訂單價格摘要
   */
  async calculateOrderSummary(
    restaurantId: string,
    items: Array<{
      menuItemId: number;
      quantity: number;
      customizations?: unknown;
    }>,
  ): Promise<OrderSummary> {
    const response = await apiClient.post<OrderSummary>(
      `/restaurants/${restaurantId}/orders/calculate`,
      { items },
    );
    return response;
  },

  /**
   * 獲取餐廳訂單歷史（針對桌號）
   */
  async getTableOrderHistory(
    restaurantId: string,
    tableId: number,
    options?: {
      limit?: number;
      offset?: number;
      status?: OrderStatus[];
      dateFrom?: string;
      dateTo?: string;
    },
  ): Promise<{
    orders: Order[];
    total: number;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams();

    if (options?.limit) {
      params.append("limit", options.limit.toString());
    }
    if (options?.offset) {
      params.append("offset", options.offset.toString());
    }
    if (options?.status?.length) {
      options.status.forEach((status) =>
        params.append("status", status.toString()),
      );
    }
    if (options?.dateFrom) {
      params.append("dateFrom", options.dateFrom);
    }
    if (options?.dateTo) {
      params.append("dateTo", options.dateTo);
    }

    const response = await apiClient.get<{
      orders: Order[];
      total: number;
      hasMore: boolean;
    }>(
      `/restaurants/${restaurantId}/tables/${tableId}/orders${params.toString() ? `?${params.toString()}` : ""}`,
    );
    return response;
  },

  /**
   * 請求服務（呼叫服務員）
   */
  async requestService(
    restaurantId: string,
    tableId: number,
    request: {
      type: "water" | "napkins" | "utensils" | "assistance" | "bill" | "other";
      message?: string;
      priority?: "low" | "normal" | "high" | "urgent";
    },
  ): Promise<{
    id: number;
    estimatedResponseTime: number;
    queuePosition: number;
  }> {
    const response = await apiClient.post<{
      id: number;
      estimatedResponseTime: number;
      queuePosition: number;
    }>(
      `/restaurants/${restaurantId}/tables/${tableId}/service-requests`,
      request,
    );
    return response;
  },

  /**
   * 提交訂單評價 (#286)
   *
   * `orderId` is the order's UUID (an order number or client mutation id also
   * resolves server-side). The body is the canonical `content` + `items`
   * shape; the server still accepts the older `comment` + `itemRatings` this
   * method used to send, but nothing should add callers to that path.
   *
   * Empty text and an empty rating list are omitted rather than sent as null:
   * an absent optional field and an explicitly-null one mean the same thing
   * here, and the shorter body is the one the contract documents.
   */
  async submitOrderReview(
    orderId: string,
    input: SubmitOrderReviewInput,
  ): Promise<OrderReview> {
    const content = input.content?.trim();
    const body: Record<string, unknown> = { rating: input.rating };
    if (content) {
      body.content = content;
    }
    if (input.items?.length) {
      body.items = input.items.map((item) => ({
        menuItemId: item.menuItemId,
        rating: item.rating,
      }));
    }

    return apiClient.post<OrderReview>(`/orders/${orderId}/review`, body);
  },

  /**
   * 讀取此訂單的評價；尚未評價時回傳 null
   *
   * Not-yet-reviewed is the ordinary state of every completed order, so the
   * server's 404 is translated to `null` here. Any other failure still
   * rejects — a 403 means the token does not own this order, which is a real
   * problem the caller has to see.
   */
  async getOrderReview(orderId: string): Promise<OrderReview | null> {
    try {
      return await apiClient.get<OrderReview>(`/orders/${orderId}/review`);
    } catch (error: unknown) {
      if (isRecord(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * 店家公開評價列表（免登入）
   */
  async getRestaurantReviews(
    restaurantId: string,
    options?: { page?: number; limit?: number },
  ): Promise<PublicReviewList> {
    return apiClient.get<PublicReviewList>(
      `/restaurants/${restaurantId}/reviews`,
      { page: options?.page ?? 1, limit: options?.limit ?? 10 },
    );
  },

  /**
   * 獲取訂單收據
   */
  async getOrderReceipt(orderId: string): Promise<OrderReceiptResponse> {
    const response = await apiClient.get<OrderReceiptResponse>(
      `/orders/${orderId}/receipt`,
    );
    return response;
  },

  /**
   * 檢查桌子當前訂單狀態
   */
  async getTableCurrentOrder(
    restaurantId: string,
    tableId: number,
  ): Promise<Order | null> {
    try {
      const response = await apiClient.get<Order | null>(
        `/restaurants/${restaurantId}/tables/${tableId}/current-order`,
      );
      return response;
    } catch (error: unknown) {
      // 404 表示沒有進行中的訂單
      if (isRecord(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  },

  /**
   * 獲取餐廳等待時間估算
   */
  async getRestaurantWaitTime(restaurantId: string): Promise<{
    averageWaitTime: number; // 分鐘
    currentOrderCount: number;
    kitchenStatus: "normal" | "busy" | "very_busy";
    estimatedPrepTime: number;
  }> {
    const response = await apiClient.get<{
      averageWaitTime: number;
      currentOrderCount: number;
      kitchenStatus: "normal" | "busy" | "very_busy";
      estimatedPrepTime: number;
    }>(`/restaurants/${restaurantId}/wait-time`);
    return response;
  },
};

export default orderApi;
