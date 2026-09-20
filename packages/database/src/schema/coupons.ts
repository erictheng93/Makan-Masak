import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { restaurants } from "./restaurants";
import { users } from "./users";
import { orders } from "./orders";

// 優惠券折扣類型定義
export const DISCOUNT_TYPE = {
  PERCENTAGE: "percentage", // 百分比折扣
  FIXED: "fixed", // 固定金額折扣
} as const;

export type DiscountType = (typeof DISCOUNT_TYPE)[keyof typeof DISCOUNT_TYPE];

// 優惠券發放類型定義
export const DISTRIBUTION_TYPE = {
  MANUAL: "manual", // 手動發放
  AUTO: "auto", // 自動發放
  BULK: "bulk", // 批量發放
  PROMOTION: "promotion", // 促銷活動
} as const;

export type DistributionType =
  (typeof DISTRIBUTION_TYPE)[keyof typeof DISTRIBUTION_TYPE];

// 目標類型定義
export const TARGET_TYPE = {
  ALL: "all", // 所有用戶
  USER: "user", // 特定用戶
  GROUP: "group", // 用戶群組
  NEW_USER: "new_user", // 新用戶
  VIP: "vip", // VIP用戶
} as const;

export type TargetType = (typeof TARGET_TYPE)[keyof typeof TARGET_TYPE];

// 使用狀態定義
export const USAGE_STATUS = {
  ACTIVE: "active", // 正常使用
  REFUNDED: "refunded", // 已退款
  CANCELLED: "cancelled", // 已取消
} as const;

export type UsageStatus = (typeof USAGE_STATUS)[keyof typeof USAGE_STATUS];

// 優惠券主表
export const coupons = sqliteTable(
  "coupons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id"), // 引用 restaurants.public_id (TEXT)

    // 優惠券基本資訊
    code: text("code").notNull(), // 優惠券代碼（唯一性見下方 partial unique index）
    name: text("name").notNull(), // 優惠券名稱
    description: text("description"), // 優惠券描述

    // 折扣設定
    discountType: text("discount_type").$type<DiscountType>().notNull(), // 折扣類型
    discountPercentageBps: integer("discount_percentage_bps"),
    discountValueCents: integer("discount_value_cents"),
    maxDiscountAmountCents: integer("max_discount_amount_cents"),

    // 使用條件
    minOrderAmountCents: integer("min_order_amount_cents"),
    applicableMenuItems: text("applicable_menu_items", { mode: "json" }).$type<
      number[]
    >(), // 適用商品
    applicableCategories: text("applicable_categories", { mode: "json" }).$type<
      number[]
    >(), // 適用分類

    // 使用限制
    usageLimit: integer("usage_limit"), // 總使用次數限制
    usageLimitPerUser: integer("usage_limit_per_user"), // 每用戶使用次數限制
    usedCount: integer("used_count").default(0), // 已使用次數

    // 有效期設定 - 標準化為 INTEGER (Unix milliseconds)，與 partnership_plans
    // 的 valid_from_ms / valid_to_ms 對齊。曾是 TEXT，靠「每一列都是 Z 結尾定寬
    // ISO-8601」這個沒人強制的不變式撐住 SQL 的字典序比較（#271）。
    validFrom: integer("valid_from_ms", { mode: "timestamp_ms" }).notNull(),
    validTo: integer("valid_to_ms", { mode: "timestamp_ms" }).notNull(),

    // 狀態控制
    isActive: integer("is_active", { mode: "boolean" }).default(true), // 是否啟用
    isVisible: integer("is_visible", { mode: "boolean" }).default(true), // 是否對用戶可見

    // 時間戳 - 標準化為 INTEGER (Unix milliseconds)
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }), // 創建者

    // 軟刪除
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    codeIdx: index("idx_coupons_code").on(table.code),
    restaurantIdIdx: index("idx_coupons_restaurant_id").on(table.restaurantId),
    validPeriodIdx: index("idx_coupons_valid_period").on(
      table.validFrom,
      table.validTo,
    ),
    statusIdx: index("idx_coupons_status").on(table.isActive, table.isVisible),
    discountTypeIdx: index("idx_coupons_discount_type").on(table.discountType),

    // Codes are unique per tenant, not platform-wide. The old single-column
    // `coupons_code_unique` let the first restaurant to claim WELCOME10 lock
    // every other restaurant out of it. SQLite treats NULLs as distinct in a
    // unique index, so platform coupons (restaurant_id IS NULL) need their own
    // partial index rather than riding along on the composite one.
    //
    // Both exclude soft-deleted rows: deleteCoupon sets deleted_at_ms rather
    // than removing the row, and without this a deleted coupon would hold its
    // code hostage forever.
    restaurantCodeUniqueIdx: uniqueIndex("coupons_restaurant_code_unique")
      .on(table.restaurantId, table.code)
      .where(
        sql`${table.restaurantId} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
    platformCodeUniqueIdx: uniqueIndex("coupons_platform_code_unique")
      .on(table.code)
      .where(sql`${table.restaurantId} IS NULL AND ${table.deletedAt} IS NULL`),
  }),
);

// 優惠券使用記錄表
export const couponUsage = sqliteTable(
  "coupon_usage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    couponId: integer("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }), // 使用者ID

    // Guest identities are hashes, separate from the users foreign key.
    guestIdentity: text("guest_identity"),

    // 使用詳情
    discountAmountCents: integer("discount_amount_cents"),
    originalAmountCents: integer("original_amount_cents"),
    finalAmountCents: integer("final_amount_cents"),

    // 使用狀態
    status: text("status").$type<UsageStatus>().default("active"), // 使用狀態

    // 時間戳 - 標準化為 INTEGER (Unix milliseconds)
    usedAt: integer("used_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    refundCountReleasedAt: integer("refund_count_released_at_ms", {
      mode: "timestamp_ms",
    }),
  },
  (table) => ({
    couponIdIdx: index("idx_coupon_usage_coupon_id").on(table.couponId),
    orderIdIdx: index("idx_coupon_usage_order_id").on(table.orderId),
    userIdIdx: index("idx_coupon_usage_user_id").on(table.userId),
    guestIdentityIdx: index("idx_coupon_usage_guest_identity")
      .on(table.couponId, table.guestIdentity)
      .where(
        sql`${table.guestIdentity} IS NOT NULL AND ${table.status} = 'active'`,
      ),
    usedAtIdx: index("idx_coupon_usage_used_at").on(table.usedAt),
    statusIdx: index("idx_coupon_usage_status").on(table.status),
    uniqueUsageIdx: index("idx_coupon_usage_unique").on(
      table.couponId,
      table.orderId,
    ),
    activeCouponOrderUniqueIdx: uniqueIndex(
      "coupon_usage_coupon_order_active_unique",
    )
      .on(table.couponId, table.orderId)
      .where(sql`${table.status} IS NULL OR ${table.status} != 'cancelled'`),
  }),
);

// 優惠券發放記錄表
export const couponDistributions = sqliteTable(
  "coupon_distributions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    couponId: integer("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),

    // 發放資訊
    distributionType: text("distribution_type")
      .$type<DistributionType>()
      .notNull(), // 發放類型
    targetType: text("target_type").$type<TargetType>(), // 目標類型
    targetCriteria: text("target_criteria", { mode: "json" }), // 目標條件

    // 發放統計
    totalDistributed: integer("total_distributed").default(0), // 總發放數量
    totalUsed: integer("total_used").default(0), // 總使用數量

    // 時間戳 - 標準化為 INTEGER (Unix milliseconds)
    distributedAt: integer("distributed_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    expiresAt: integer("expires_at_ms", { mode: "timestamp_ms" }), // 發放過期時間
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),

    // 元數據
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }), // 發放者
    notes: text("notes"), // 發放備註
  },
  (table) => ({
    couponIdIdx: index("idx_coupon_distributions_coupon_id").on(table.couponId),
    distributionTypeIdx: index("idx_coupon_distributions_type").on(
      table.distributionType,
    ),
    distributedAtIdx: index("idx_coupon_distributions_distributed_at").on(
      table.distributedAt,
    ),
  }),
);

// 優惠券模板表
export const couponTemplates = sqliteTable(
  "coupon_templates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id"), // 引用 restaurants.public_id (TEXT)

    // 模板資訊
    name: text("name").notNull(), // 模板名稱
    description: text("description"), // 模板描述
    templateData: text("template_data", { mode: "json" }).notNull(), // 模板配置

    // 使用統計
    usageCount: integer("usage_count").default(0), // 使用次數

    // 狀態控制
    isActive: integer("is_active", { mode: "boolean" }).default(true), // 是否啟用
    isSystemTemplate: integer("is_system_template", {
      mode: "boolean",
    }).default(false), // 是否為系統模板

    // 時間戳 - 標準化為 INTEGER (Unix milliseconds)
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }), // 創建者
  },
  (table) => ({
    restaurantIdIdx: index("idx_coupon_templates_restaurant_id").on(
      table.restaurantId,
    ),
    activeIdx: index("idx_coupon_templates_active").on(table.isActive),
    systemTemplateIdx: index("idx_coupon_templates_system").on(
      table.isSystemTemplate,
    ),
  }),
);

// 關聯定義
export const couponsRelations = relations(coupons, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [coupons.restaurantId],
    references: [restaurants.id],
  }),
  creator: one(users, {
    fields: [coupons.createdBy],
    references: [users.id],
  }),
  usages: many(couponUsage),
  distributions: many(couponDistributions),
}));

export const couponUsageRelations = relations(couponUsage, ({ one }) => ({
  coupon: one(coupons, {
    fields: [couponUsage.couponId],
    references: [coupons.id],
  }),
  order: one(orders, {
    fields: [couponUsage.orderId],
    references: [orders.id],
  }),
  user: one(users, {
    fields: [couponUsage.userId],
    references: [users.id],
  }),
}));

export const couponDistributionsRelations = relations(
  couponDistributions,
  ({ one }) => ({
    coupon: one(coupons, {
      fields: [couponDistributions.couponId],
      references: [coupons.id],
    }),
    creator: one(users, {
      fields: [couponDistributions.createdBy],
      references: [users.id],
    }),
  }),
);

export const couponTemplatesRelations = relations(
  couponTemplates,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [couponTemplates.restaurantId],
      references: [restaurants.id],
    }),
    creator: one(users, {
      fields: [couponTemplates.createdBy],
      references: [users.id],
    }),
  }),
);
