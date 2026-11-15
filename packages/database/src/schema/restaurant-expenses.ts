import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import { restaurants } from "./restaurants";

export const EXPENSE_CATEGORIES = [
  "labor",
  "rent",
  "utilities",
  "purchase",
  "misc",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * Owner-entered operating expenses for the daily P&L. `businessDate` is a
 * calendar date in the restaurant's timezone (YYYY-MM-DD), not a timestamp.
 * Soft-deleted via `deletedAt`; the CHECKs and STRICT live in the migration.
 */
export const restaurantExpenses = sqliteTable(
  "restaurant_expenses",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id),
    businessDate: text("business_date").notNull(),
    category: text("category").$type<ExpenseCategory>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at_ms", { mode: "timestamp_ms" }),
  },
  (table) => ({
    restaurantDateIdx: index("restaurant_expenses_restaurant_date_idx").on(
      table.restaurantId,
      table.businessDate,
    ),
  }),
);

export type RestaurantExpense = typeof restaurantExpenses.$inferSelect;
