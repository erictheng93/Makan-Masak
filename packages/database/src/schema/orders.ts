import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { restaurants } from "./restaurants";
import { tables } from "./tables";
import { customers } from "./customers";
import { orderItems } from "./order-items";
import { waitingList } from "./waiting-list";

// 訂單狀態定義
export const ORDER_STATUS = {
  PENDING: "pending", // 待確認
  CONFIRMED: "confirmed", // 已確認
  PREPARING: "preparing", // 準備中
  READY: "ready", // 已完成
  DELIVERED: "delivered", // 已送達
  PAID: "paid", // 已付款
  CANCELLED: "cancelled", // 已取消
  REFUNDED: "refunded", // 已退款
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

// 付款方式定義
export const PAYMENT_METHODS = {
  CASH: "cash", // 現金
  CARD: "card", // 信用卡
  DIGITAL_WALLET: "digital_wallet", // 數位錢包
  BANK_TRANSFER: "bank_transfer", // 銀行轉帳
  OTHER: "other", // 其他
} as const;

export type PaymentMethod =
  (typeof PAYMENT_METHODS)[keyof typeof PAYMENT_METHODS];

export const orders = sqliteTable(
  "orders",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 關聯資訊
    restaurantId: text("restaurant_id").notNull(), // 引用 restaurants.public_id (TEXT)
    tableId: integer("table_id").references(() => tables.id, {
      onDelete: "restrict",
    }), // 可空：支援店家級別訂單
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }), // 可選：註冊顧客
    waitingListId: text("waiting_list_id").references(() => waitingList.id, {
      onDelete: "set null",
    }), // 可選：候位預點餐綁定

    // 訂單基本資訊
    orderNumber: text("order_number").notNull().unique(), // 訂單編號
    clientMutationId: text("client_mutation_id"),
    status: text("status").notNull().default(ORDER_STATUS.PENDING),
    version: integer("version").notNull().default(0),
    orderType: text("order_type")
      .$type<"shop" | "table" | "seat">()
      .default("table"), // 訂單來源類型

    // 外送平台來源
    orderSource: text("order_source")
      .$type<
        "direct" | "market_checkout" | "uber_eats" | "foodpanda" | "grabfood"
      >()
      .default("direct"),

    // 金額資訊
    subtotalCents: integer("subtotal_cents"),
    taxAmountCents: integer("tax_amount_cents"),
    serviceChargeCents: integer("service_charge_cents"),
    discountAmountCents: integer("discount_amount_cents"),
    totalAmountCents: integer("total_amount_cents"),

    // 顧客資訊
    customerInfo: text("customer_info", { mode: "json" }).$type<{
      name?: string;
      phone?: string;
      email?: string;
      peopleCount?: number; // 用餐人數
      specialRequests?: string[]; // 特殊需求
      orderType?: "shop" | "table" | "seat"; // 訂單來源類型
    }>(),

    // 時間資訊
    estimatedPrepTime: integer("estimated_prep_time"), // 預估準備時間（分鐘）
    actualPrepTime: integer("actual_prep_time"), // 實際準備時間（分鐘）

    // 狀態時間戳記
    confirmedAt: integer("confirmed_at_ms", { mode: "timestamp_ms" }),
    preparingAt: integer("preparing_at_ms", { mode: "timestamp_ms" }),
    readyAt: integer("ready_at_ms", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at_ms", { mode: "timestamp_ms" }),
    // A service-crew claim is independent from the canonical order status.
    deliveryAssignedTo: text("delivery_assigned_to"),
    deliveryStartTime: integer("delivery_start_time_ms", {
      mode: "timestamp_ms",
    }),
    paidAt: integer("paid_at_ms", { mode: "timestamp_ms" }),
    cancelledAt: integer("cancelled_at_ms", { mode: "timestamp_ms" }),

    // 付款資訊
    paymentMethod: text("payment_method"),
    paymentStatus: text("payment_status").default("pending"), // pending, completed, failed, refunded
    paymentTransactionId: text("payment_transaction_id"),

    // 優惠券和促銷
    couponCode: text("coupon_code"),
    appliedCoupons: text("applied_coupons", { mode: "json" }).$type<
      Array<{
        couponId: number;
        code: string;
        name: string;
        discountAmountCents: number;
      }>
    >(),
    promotionIds: text("promotion_ids", { mode: "json" }).$type<string[]>(),

    // 評價資訊
    rating: integer("rating"), // 1-5 星評分
    reviewComment: text("review_comment"),
    reviewedAt: integer("reviewed_at_ms", { mode: "timestamp_ms" }),

    // 訂單備註
    notes: text("notes"), // 顧客備註
    internalNotes: text("internal_notes"), // 內部備註

    // 取消資訊
    cancellationReason: text("cancellation_reason"),
    refundAmountCents: integer("refund_amount_cents"),

    // 配送資訊（外送使用）
    deliveryInfo: text("delivery_info", { mode: "json" }).$type<{
      type?: "dine_in" | "takeaway" | "delivery";
      address?: string;
      phone?: string;
      instructions?: string;
      deliveryFee?: number;
      estimatedDeliveryTime?: number;
    }>(),

    // 時間戳記
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    // 關鍵索引優化
    restaurantStatusIdx: index("orders_restaurant_status_idx").on(
      table.restaurantId,
      table.status,
      table.createdAt,
    ),
    restaurantTableIdx: index("orders_restaurant_table_idx").on(
      table.restaurantId,
      table.tableId,
      table.status,
    ),
    orderNumberIdx: index("orders_order_number_idx").on(table.orderNumber),
    clientMutationIdx: uniqueIndex("orders_client_mutation_unique").on(
      table.restaurantId,
      table.clientMutationId,
    ),
    customerIdx: index("orders_customer_idx").on(
      table.customerId,
      table.createdAt,
    ),
    waitingListIdx: index("orders_waiting_list_idx").on(table.waitingListId),
    waitingListUniqueIdx: uniqueIndex("orders_waiting_list_unique")
      .on(table.waitingListId)
      .where(
        sql`${table.waitingListId} IS NOT NULL AND ${table.status} NOT IN ('cancelled', 'refunded')`,
      ),
    statusTimeIdx: index("orders_status_time_idx").on(
      table.status,
      table.createdAt,
    ),
    paymentStatusIdx: index("orders_payment_status_idx").on(
      table.paymentStatus,
      table.paidAt,
    ),
    restaurantPaymentTxIdx: index("orders_restaurant_payment_tx_idx").on(
      table.restaurantId,
      table.paymentTransactionId,
    ),
    paymentTransactionUniqueIdx: uniqueIndex(
      "orders_payment_transaction_unique",
    )
      .on(table.paymentTransactionId)
      .where(sql`${table.paymentTransactionId} IS NOT NULL`),
    orderSourceIdx: index("orders_order_source_idx").on(
      table.restaurantId,
      table.orderSource,
      table.createdAt,
    ),
  }),
);

export const orderRelations = relations(orders, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [orders.restaurantId],
    references: [restaurants.id], // UUID v7 關聯
  }),
  table: one(tables, {
    fields: [orders.tableId],
    references: [tables.id],
  }),
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  waitingListEntry: one(waitingList, {
    fields: [orders.waitingListId],
    references: [waitingList.id],
  }),
  items: many(orderItems),
}));
