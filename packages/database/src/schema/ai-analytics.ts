import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { restaurants } from "./restaurants";

// --- AI Configurations ---
export const aiConfigurations = sqliteTable(
  "ai_configurations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id")
      .notNull()
      .unique()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // 'openai' | 'anthropic' | 'google' | 'openrouter'
    apiKeyEncrypted: text("api_key_encrypted").notNull(),
    model: text("model"),
    customBaseUrl: text("custom_base_url"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    restaurantIdx: uniqueIndex("ai_configurations_restaurant_idx").on(
      table.restaurantId,
    ),
  }),
);

export const aiConfigurationsRelations = relations(
  aiConfigurations,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [aiConfigurations.restaurantId],
      references: [restaurants.id],
    }),
  }),
);

// --- AI Usage Logs ---
export const aiUsageLogs = sqliteTable(
  "ai_usage_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    operation: text("operation").notNull(), // 'generate_report' | 'analyze_products' etc.
    tokensUsed: integer("tokens_used").notNull().default(0),
    latencyMs: integer("latency_ms"),
    success: integer("success", { mode: "boolean" }).notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
  },
  (table) => ({
    restaurantIdx: index("ai_usage_logs_restaurant_idx").on(table.restaurantId),
    providerModelIdx: index("ai_usage_logs_provider_model_idx").on(
      table.provider,
      table.model,
    ),
    createdAtIdx: index("ai_usage_logs_created_at_idx").on(table.createdAt),
  }),
);

export const aiUsageLogsRelations = relations(aiUsageLogs, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [aiUsageLogs.restaurantId],
    references: [restaurants.id],
  }),
}));

/**
 * Cache for generated AI insight reports.
 *
 * This table had no DDL in the live migration track at all. `AIInsightsService`
 * has always written to it — `cacheReport()` runs unconditionally at the end of
 * `generateReport()`, outside any try/catch — so every attempt to generate an
 * AI report threw `no such table: ai_insights_cache`, in production included.
 * The only CREATE TABLE lived in `packages/database/migrations/` and
 * `migrations_v2/`, neither of which is referenced by any wrangler.toml.
 *
 * Timestamps are INTEGER ms rather than the legacy DDL's DATETIME. The old
 * shape stored ISO strings and compared them with `expires_at > ?`, i.e.
 * lexicographically — the same defect #271 removed from `coupons`.
 */
export const aiInsightsCache = sqliteTable(
  "ai_insights_cache",
  {
    id: text("id").primaryKey(),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    insightType: text("insight_type").notNull(),
    timeRange: text("time_range").notNull(),
    data: text("data").notNull(),
    confidenceScore: real("confidence_score"),
    tokensUsed: integer("tokens_used"),
    latencyMs: integer("latency_ms"),
    generatedAtMs: integer("generated_at_ms", {
      mode: "timestamp_ms",
    }).notNull(),
    expiresAtMs: integer("expires_at_ms", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => ({
    restaurantIdx: index("ai_insights_cache_restaurant_idx").on(
      table.restaurantId,
    ),
    expiresIdx: index("ai_insights_cache_expires_idx").on(table.expiresAtMs),
    lookupUnique: uniqueIndex("ai_insights_cache_lookup_unique").on(
      table.restaurantId,
      table.insightType,
      table.timeRange,
    ),
  }),
);

export const aiInsightsCacheRelations = relations(
  aiInsightsCache,
  ({ one }) => ({
    restaurant: one(restaurants, {
      fields: [aiInsightsCache.restaurantId],
      references: [restaurants.id],
    }),
  }),
);
