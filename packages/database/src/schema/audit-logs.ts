import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { restaurants } from "./restaurants";

// 操作類型定義
export const AUDIT_ACTIONS = {
  // 認證相關
  LOGIN: "login",
  LOGOUT: "logout",
  REGISTER: "register",
  PASSWORD_CHANGE: "password_change",
  USER_ROLE_CHANGE: "user_role_change",

  // 訂單相關
  ORDER_CREATE: "order_create",
  ORDER_UPDATE: "order_update",
  ORDER_CANCEL: "order_cancel",
  ORDER_CONFIRM: "order_confirm",
  ORDER_COMPLETE: "order_complete",

  // 菜單相關
  MENU_CREATE: "menu_create",
  MENU_UPDATE: "menu_update",
  MENU_DELETE: "menu_delete",
  MENU_VIEW: "menu_view",

  // 會員相關（issue #299 §9.2）
  // 揭露顧客完整聯絡資料（PII）：resource 為 restaurant_customers，
  // resourceId 一律是租戶端的 member id，永不寫入 customers.id 或原始 PII。
  CUSTOMER_PII_REVEAL: "customer_pii_reveal",
  // 匯出會員名單。與下方的 DATA_EXPORT 分開，因為那個太籠統，
  // 會把備份匯出混進顧客資料匯出的稽核查詢裡。
  CUSTOMER_DATA_EXPORT: "customer_data_export",
  // 會員封鎖標記的切換（issue #299 A3, spec Q-2）：resource 仍是
  // restaurant_customers、resourceId 仍是 member id。只有 isBlocked 的
  // 切換會寫這個動作 —— tags/note 編輯故意不稽核，見
  // TenantMemberDirectoryService.update() 的註解。這是「標記」動作本身
  // 被記錄，不是訂單／訂位的強制阻擋（本規格明確不做那個）。
  MEMBER_BLOCK_STATUS_CHANGE: "member_block_status_change",

  // 系統相關
  SYSTEM_CONFIG: "system_config",
  DATA_EXPORT: "data_export",
  DATA_IMPORT: "data_import",

  // 其他
  OTHER: "other",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    // 關聯資訊
    userId: text("user_id").references(() => users.id), // 可為空（系統操作）
    // Manager-delegation gate (M1): when a proxy actor (e.g. a manager
    // standing in for the owner) performs the action, userId records the
    // actual actor and onBehalfOfUserId records the delegating user.
    onBehalfOfUserId: text("on_behalf_of_user_id").references(() => users.id),
    restaurantId: text("restaurant_id"), // 引用 restaurants.public_id (TEXT)，可為空（全局操作）

    // 操作資訊
    action: text("action").notNull(),
    resource: text("resource").notNull(), // 操作的資源類型 (orders, menu_items, users 等)
    resourceId: text("resource_id"), // 操作的資源 ID

    // 操作詳情
    description: text("description").notNull(), // 操作描述
    changes: text("changes", { mode: "json" }).$type<{
      before?: Record<string, unknown>; // 變更前的值
      after?: Record<string, unknown>; // 變更後的值
      metadata?: Record<string, unknown>; // 額外的元數據
    }>(),

    // 請求資訊
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    // 結果資訊
    success: integer("success", { mode: "boolean" }).notNull().default(true),
    errorMessage: text("error_message"),

    // 效能資訊
    executionTimeMs: integer("execution_time_ms"), // 執行時間（毫秒）

    // 時間戳記
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    // 索引優化
    userActionIdx: index("audit_logs_user_action_idx").on(
      table.userId,
      table.action,
      table.createdAt,
    ),
    restaurantActionIdx: index("audit_logs_restaurant_action_idx").on(
      table.restaurantId,
      table.action,
      table.createdAt,
    ),
    resourceIdx: index("audit_logs_resource_idx").on(
      table.resource,
      table.resourceId,
      table.createdAt,
    ),
    timeIdx: index("audit_logs_time_idx").on(table.createdAt),
    onBehalfOfIdx: index("audit_logs_on_behalf_of_idx").on(
      table.onBehalfOfUserId,
      table.createdAt,
    ),
  }),
);

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
  restaurant: one(restaurants, {
    fields: [auditLogs.restaurantId],
    references: [restaurants.id], // UUID v7 關聯
  }),
}));
