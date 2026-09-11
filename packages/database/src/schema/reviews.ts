import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import { restaurants } from "./restaurants";
import { orders } from "./orders";
import { menuItems } from "./menu-items";
import { customers } from "./customers";
import { users } from "./users";

/**
 * Customer reviews (issue #286).
 *
 * One table carries two kinds of row, told apart by `menuItemId`:
 *
 *   * the order-level review — `menu_item_id IS NULL`, at most one per order,
 *     the only row that carries `content` and an owner `reply_*`;
 *   * per-item ratings — `menu_item_id` set, at most one per (order, item),
 *     submitted in the same request as the order-level review.
 *
 * Keeping both in one table is what makes the aggregate recompute a single
 * expression per target: `restaurants.rating` averages the `menu_item_id IS
 * NULL` rows, `menu_items.rating` averages the rows for that item. Those four
 * aggregate columns (`restaurants.rating` / `review_count`, `menu_items.rating`
 * / `review_count`) have existed since the baseline and were never written by
 * anything; this table is their source.
 *
 * `restaurantId` is denormalised from the order so the owner list and the
 * restaurant aggregate never have to join `orders`.
 */
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // NULL marks the order-level row. `menu_items.id` is an integer
    // autoincrement key, unlike every other reference here.
    menuItemId: integer("menu_item_id").references(() => menuItems.id, {
      onDelete: "cascade",
    }),
    // NULL for a guest review: an order placed without an account has no
    // customer to attribute. Never exposed on the public endpoint.
    customerId: text("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    rating: integer("rating").notNull(),
    content: text("content"),
    // Owner reply. Only ever set on an order-level row.
    replyContent: text("reply_content"),
    repliedBy: text("replied_by").references(() => users.id, {
      onDelete: "set null",
    }),
    repliedAt: integer("replied_at_ms", { mode: "timestamp_ms" }),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('now') * 1000)`),
  },
  (table) => ({
    // The owner list: one restaurant, newest first.
    restaurantCreatedIdx: index("reviews_restaurant_created_idx").on(
      table.restaurantId,
      table.createdAt,
    ),
    // The per-item aggregate recompute.
    menuItemIdx: index("reviews_menu_item_idx").on(table.menuItemId),
    // "has this order been reviewed", and the item rows for one review.
    orderIdx: index("reviews_order_idx").on(table.orderId),

    // SQLite treats NULLs as distinct in a UNIQUE index, so a single
    // `UNIQUE (order_id, menu_item_id)` would let an order be reviewed twice
    // at the order level while still rejecting duplicate item rows. Two
    // partial indexes state the two rules separately.
    orderLevelUnique: uniqueIndex("reviews_order_level_unique")
      .on(table.orderId)
      .where(sql`${table.menuItemId} IS NULL`),
    orderItemUnique: uniqueIndex("reviews_order_item_unique")
      .on(table.orderId, table.menuItemId)
      .where(sql`${table.menuItemId} IS NOT NULL`),
  }),
);

export const reviewsRelations = relations(reviews, ({ one }) => ({
  restaurant: one(restaurants, {
    fields: [reviews.restaurantId],
    references: [restaurants.id],
  }),
  order: one(orders, {
    fields: [reviews.orderId],
    references: [orders.id],
  }),
  menuItem: one(menuItems, {
    fields: [reviews.menuItemId],
    references: [menuItems.id],
  }),
  customer: one(customers, {
    fields: [reviews.customerId],
    references: [customers.id],
  }),
}));

export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
