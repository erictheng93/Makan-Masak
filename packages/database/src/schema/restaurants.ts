import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import type { SupportedCountryCode } from "@makanmasak/shared-types";
import { v7 as uuidv7 } from "uuid";
import { categories } from "./categories";
import { menuItems } from "./menu-items";
import { restaurantServiceItems } from "./restaurant-service-items";
import { tables } from "./tables";
import { orders } from "./orders";
import { users } from "./users";

export const restaurants = sqliteTable(
  "restaurants",
  {
    // Primary key: UUID v7 (time-sortable, globally unique)
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    name: text("name").notNull(),
    type: text("type").notNull(), // 餐廳類型：中式、西式、日式等
    category: text("category").notNull(), // 餐廳分類：火鍋、燒烤、快餐等
    description: text("description"),
    address: text("address").notNull(),
    district: text("district").notNull(),
    city: text("city").notNull().default("台中市"),
    phone: text("phone").notNull(),
    email: text("email"),
    website: text("website"),
    messagingChannels: text("messaging_channels", { mode: "json" }).$type<{
      line?: string;
      whatsapp?: string;
      instagram?: string;
      telegram?: string;
    }>(),

    // 營業資訊
    businessHours: text("business_hours", { mode: "json" }).$type<
      Record<string, { open: string; close: string; isOpen: boolean }>
    >(),

    // IANA name of the timezone this restaurant's business day is cut in.
    // Every revenue and report bucket derives its SQL offset from here, so it
    // is a column rather than a `settings` key: two copies of the day boundary
    // is how a shop ends up reconciling against a report it cannot explain.
    // Constrained to the fixed-offset zones in utils/business-timezone.ts.
    timezone: text("timezone").notNull().default("Asia/Taipei"),

    // 營業所在國（ISO 3166-1 alpha-2）。開通時由申請表寫入，是政策鎖定的
    // 查詢維度；幣別與時區的權威仍分別是 settings.currency 與 timezone。
    countryCode: text("country_code").$type<SupportedCountryCode>(),

    // 狀態和設定
    isAvailable: integer("is_available", { mode: "boolean" })
      .notNull()
      .default(true),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    // 媒體檔案
    logoUrl: text("logo_url"),
    bannerUrl: text("banner_url"),
    imageUrls: text("image_urls", { mode: "json" }).$type<string[]>(),

    // 店家级别 QR Code（用于无桌号的外带/自取订单）
    shopQrCode: text("shop_qr_code").unique(),
    shopQrCodeImageUrl: text("shop_qr_code_image_url"),
    enableShopMode: integer("enable_shop_mode", { mode: "boolean" })
      .notNull()
      .default(false),
    shopQrSettings: text("shop_qr_settings", { mode: "json" }).$type<{
      displayName?: string;
      instructions?: string;
    }>(),
    shopQrVersion: integer("shop_qr_version").notNull().default(1),

    // 設定
    settings: text("settings", { mode: "json" }).$type<{
      allowOnlineOrdering?: boolean;
      allowTableReservation?: boolean;
      allowGuestOrders?: boolean;
      requireCustomerInfo?: boolean;
      autoAcceptOrders?: boolean;
      currency?: string;
      taxRate?: number;
      serviceChargeRate?: number;
      minOrderAmount?: number;
      maxOrderAmount?: number;
      orderTimeoutMinutes?: number;
      enableTakeaway?: boolean;
      enableDelivery?: boolean;
      deliveryFee?: number;
      estimatedPrepTimeMin?: number;
      estimatedPrepTimeMax?: number;
    }>(),

    // 評分和統計
    rating: real("rating").default(0),
    reviewCount: integer("review_count").notNull().default(0),
    totalOrders: integer("total_orders").notNull().default(0),

    // 時間戳記
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),

    // 軟刪除
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),

    // GPS (reserved for future)
    latitude: real("latitude"),
    longitude: real("longitude"),
    // Discovery fields
    cuisineTags: text("cuisine_tags", { mode: "json" }).$type<string[]>(),
    priceRange: integer("price_range"), // 1=budget, 2=mid, 3=premium
    supportsTakeaway: integer("supports_takeaway", { mode: "boolean" })
      .notNull()
      .default(false),
    supportsDelivery: integer("supports_delivery", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => ({
    activeDeletedIdx: index("restaurants_active_deleted_idx").on(
      table.isActive,
      table.deletedAt,
    ),
    countryCodeIdx: index("restaurants_country_code_idx").on(table.countryCode),
  }),
);

export const restaurantRelations = relations(restaurants, ({ many }) => ({
  categories: many(categories),
  menuItems: many(menuItems),
  serviceItems: many(restaurantServiceItems),
  tables: many(tables),
  orders: many(orders),
  users: many(users), // 餐廳員工
  faqs: many(restaurantFaqs),
}));

export const restaurantFaqs = sqliteTable(
  "restaurant_faqs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    keywords: text("keywords", { mode: "json" }).$type<string[]>(),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    restaurantActiveOrderIdx: index("restaurant_faqs_restaurant_active_idx").on(
      table.restaurantId,
      table.isActive,
      table.displayOrder,
    ),
  }),
);

export const restaurantFaqRelations = relations(restaurantFaqs, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [restaurantFaqs.restaurantId],
    references: [restaurants.id],
  }),
}));
