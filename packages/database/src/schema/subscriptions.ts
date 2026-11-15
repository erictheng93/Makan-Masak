import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { restaurants } from "./restaurants";

// ─── Module definitions ──────────────────────────────────────────────────────

/**
 * All available feature modules in the platform.
 * Add new modules here — the type system will propagate everywhere.
 */
export const MODULES = {
  // Core (always included in every plan)
  MENU_MANAGEMENT: "menu_management",
  TABLE_MANAGEMENT: "table_management",
  ONLINE_ORDERING: "online_ordering",

  // Pro
  POS: "pos",
  KITCHEN_DISPLAY: "kitchen_display",
  RECEIPT_PRINTING: "receipt_printing",
  COUPONS: "coupons",
  RESERVATIONS: "reservations",
  ANALYTICS: "analytics",

  // Enterprise
  //
  // NOTE: `multi_branch` was removed. It was advertised on the Enterprise plan
  // but no multi-branch product exists to gate: `users.restaurantId` is a
  // single column, `restaurants` has no parent/branch relationship, restaurant
  // creation is platform-admin-only rather than an owner-driven branch flow,
  // and no route ever checked the module. Re-introducing it needs an
  // organization/branch data model, one owner spanning several restaurants,
  // a branch creation + invitation flow, and cross-branch reporting first.
  AI_ANALYTICS: "ai_analytics",
  PLATFORM_INTEGRATION: "platform_integration", // Uber Eats, Foodpanda, etc.
  LOYALTY: "loyalty",
  INVENTORY: "inventory",
  STAFF_MANAGEMENT: "staff_management",
} as const;

export type ModuleKey = (typeof MODULES)[keyof typeof MODULES];

export type ModuleMap = Partial<Record<ModuleKey, boolean>>;

// ─── Plan tiers ──────────────────────────────────────────────────────────────

export const PLAN_TIERS = {
  TRIAL: "trial",
  BASIC: "basic",
  PRO: "pro",
  ENTERPRISE: "enterprise",
} as const;

export type PlanTier = (typeof PLAN_TIERS)[keyof typeof PLAN_TIERS];

/** Default module set granted per plan tier */
export const PLAN_DEFAULT_MODULES: Record<PlanTier, ModuleMap> = {
  trial: {
    menu_management: true,
    table_management: true,
    online_ordering: true,
    kitchen_display: true,
    receipt_printing: true,
    coupons: true,
    reservations: true,
    analytics: true,
    ai_analytics: true,
    platform_integration: true,
    loyalty: true,
    pos: true,
    inventory: true,
    staff_management: true,
  },
  basic: {
    menu_management: true,
    table_management: true,
    online_ordering: true,
  },
  pro: {
    menu_management: true,
    table_management: true,
    online_ordering: true,
    pos: true,
    kitchen_display: true,
    receipt_printing: true,
    coupons: true,
    reservations: true,
    analytics: true,
  },
  enterprise: {
    menu_management: true,
    table_management: true,
    online_ordering: true,
    kitchen_display: true,
    receipt_printing: true,
    coupons: true,
    reservations: true,
    analytics: true,
    ai_analytics: true,
    platform_integration: true,
    loyalty: true,
    pos: true,
    inventory: true,
    staff_management: true,
  },
};

// ─── Schema ──────────────────────────────────────────────────────────────────

export const shopSubscriptions = sqliteTable("shop_subscriptions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7()),

  // One subscription per restaurant
  restaurantId: text("restaurant_id")
    .notNull()
    .unique()
    .references(() => restaurants.id),

  // Plan tier controls the default module set
  planTier: text("plan_tier")
    .notNull()
    .$type<PlanTier>()
    .default(PLAN_TIERS.TRIAL),

  /**
   * Module overrides — merged on top of the plan defaults.
   * { "kitchen_display": true } grants the module even if the plan doesn't include it.
   * { "online_ordering": false } revokes a module even if the plan includes it.
   * Null/missing key = use plan default.
   */
  moduleOverrides: text("module_overrides", { mode: "json" })
    .$type<ModuleMap>()
    .default(sql`'{}'`),

  // Master kill switch — set false to immediately lock out the shop
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  // Trial window
  trialEndsAt: integer("trial_ends_at_ms", { mode: "timestamp_ms" }),

  // Billing cycle
  billingCycleStartAt: integer("billing_cycle_start_at_ms", {
    mode: "timestamp_ms",
  }),
  billingCycleEndAt: integer("billing_cycle_end_at_ms", {
    mode: "timestamp_ms",
  }),

  // Owner-scheduled downgrade, applied at pendingEffectiveAt (migration 0049).
  // All four are set together or all NULL.
  pendingPlanTier: text("pending_plan_tier").$type<PlanTier>(),
  pendingEffectiveAt: integer("pending_effective_at_ms", {
    mode: "timestamp_ms",
  }),
  pendingRequestedBy: text("pending_requested_by"),
  pendingRequestedAt: integer("pending_requested_at_ms", {
    mode: "timestamp_ms",
  }),

  // Internal admin notes (not visible to shop owner)
  notes: text("notes"),

  createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`),
  updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('now') * 1000)`)
    .$onUpdate(() => new Date()),
});

export const shopSubscriptionsRelations = relations(
  shopSubscriptions,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [shopSubscriptions.restaurantId],
      references: [restaurants.id],
    }),
  }),
);
