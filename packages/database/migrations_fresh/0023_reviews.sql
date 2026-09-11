-- Customer reviews (issue #286).
--
-- `restaurants.rating` / `review_count` and `menu_items.rating` /
-- `review_count` have existed since the baseline and were never written by
-- anything: `MenuService.updateItemRating` had no callers, and discovery's
-- `sortBy=rating` ordered every restaurant by a column stuck at 0. This is the
-- table those aggregates are recomputed from.
--
-- One table, two kinds of row, told apart by `menu_item_id`:
--   * `menu_item_id IS NULL` — the order-level review. At most one per order;
--     the only row carrying `content` and an owner reply.
--   * `menu_item_id` set — a per-item rating submitted alongside it. At most
--     one per (order, item).
--
-- `menu_item_id` is INTEGER because `menu_items.id` is an integer
-- autoincrement key; every other reference here is a TEXT UUID.
CREATE TABLE `reviews` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `order_id` TEXT NOT NULL,
  `menu_item_id` INTEGER,
  `customer_id` TEXT,
  `rating` INTEGER NOT NULL,
  `content` TEXT,
  `reply_content` TEXT,
  `replied_by` TEXT,
  `replied_at_ms` INTEGER,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`replied_by`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  -- The API validates 1-5 as well. This is the half that survives a raw
  -- `env.DB.prepare(...)` write, which is the only kind the type system misses.
  CHECK (`rating` BETWEEN 1 AND 5)
) STRICT;
--> statement-breakpoint
-- The owner list: one restaurant, newest first.
CREATE INDEX `reviews_restaurant_created_idx`
  ON `reviews` (`restaurant_id`, `created_at_ms`);
--> statement-breakpoint
-- The per-item aggregate recompute.
CREATE INDEX `reviews_menu_item_idx` ON `reviews` (`menu_item_id`);
--> statement-breakpoint
-- "Has this order been reviewed", and the item rows belonging to one review.
CREATE INDEX `reviews_order_idx` ON `reviews` (`order_id`);
--> statement-breakpoint
-- SQLite treats NULLs as distinct in a UNIQUE index, so a single
-- `UNIQUE (order_id, menu_item_id)` would reject duplicate item rows while
-- happily allowing an order to be reviewed twice at the order level. The two
-- rules therefore need two partial indexes.
CREATE UNIQUE INDEX `reviews_order_level_unique`
  ON `reviews` (`order_id`)
  WHERE `menu_item_id` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_order_item_unique`
  ON `reviews` (`order_id`, `menu_item_id`)
  WHERE `menu_item_id` IS NOT NULL;
