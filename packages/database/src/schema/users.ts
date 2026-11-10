import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { UserPreferences } from "@makanmasak/shared-types";
import { restaurants } from "./restaurants";

// 用戶角色定義
export const USER_ROLES = {
  ADMIN: 0, // 系統管理員
  OWNER: 1, // 店主
  CHEF: 2, // 廚師
  SERVICE: 3, // 送菜員
  CASHIER: 4, // 收銀員
  /** @deprecated Customer identity now lives in the customers table. */
  CUSTOMER: 5, // 顧客（可選）
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/**
 * Platform admin (role 0) tiers. Only an administrator may manage other admin
 * accounts; support is read-only except for resetting shop-account passwords.
 * NULL on every other role; a role-0 NULL is read as operator.
 */
export const ADMIN_TIERS = ["administrator", "operator", "support"] as const;
export type AdminTier = (typeof ADMIN_TIERS)[number];

export const users = sqliteTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 基本資訊
    username: text("username").notNull(),
    email: text("email"),
    phone: text("phone"),
    fullName: text("full_name").notNull(),

    // 認證資訊
    passwordHash: text("password_hash").notNull(),

    // 角色和權限
    role: integer("role").notNull().default(USER_ROLES.CASHIER), // 預設為收銀員，顧客應使用 customers 表
    restaurantId: text("restaurant_id"), // 引用 restaurants.public_id (TEXT)
    adminTier: text("admin_tier", { enum: ADMIN_TIERS }),

    // 個人資訊
    address: text("address"),
    dateOfBirth: text("date_of_birth"), // ISO date string
    profileImageUrl: text("profile_image_url"),

    // 狀態
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    isVerified: integer("is_verified", { mode: "boolean" })
      .notNull()
      .default(false),

    // 偏好設定
    preferences: text("preferences", { mode: "json" }).$type<UserPreferences>(),

    // 統計資訊
    totalOrders: integer("total_orders").notNull().default(0),
    totalSpent: integer("total_spent").notNull().default(0), // 以分為單位

    // 安全資訊
    lastLoginAt: integer("last_login_at_ms", { mode: "timestamp_ms" }),
    passwordChangedAt: integer("password_changed_at_ms", {
      mode: "timestamp_ms",
    }),
    tokenVersion: integer("token_version").notNull().default(1),

    // 驗證時間戳
    emailVerifiedAt: integer("email_verified_at_ms", { mode: "timestamp_ms" }),
    phoneVerifiedAt: integer("phone_verified_at_ms", { mode: "timestamp_ms" }),

    // 時間戳記
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$onUpdate(() => new Date()),

    // 軟刪除
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    // Staff usernames are unique per restaurant; platform admins
    // (restaurant_id NULL) are unique among themselves. Migration 0042.
    restaurantUsernameUnique: uniqueIndex("users_restaurant_username_unique")
      .on(table.restaurantId, table.username)
      .where(sql`${table.restaurantId} IS NOT NULL`),
    platformUsernameUnique: uniqueIndex("users_platform_username_unique")
      .on(table.username)
      .where(sql`${table.restaurantId} IS NULL`),
    usernameIdx: index("users_username_idx").on(table.username),
    restaurantRoleActiveIdx: index("users_restaurant_role_active_idx").on(
      table.restaurantId,
      table.role,
      table.isActive,
    ),
  }),
);

export const userRelations = relations(users, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [users.restaurantId],
    references: [restaurants.id], // UUID v7 關聯
  }),
}));
