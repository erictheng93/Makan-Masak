-- Owner-entered operating expenses for the daily profit & loss statement.
--
-- `business_date` is a calendar date (YYYY-MM-DD) in the restaurant's own
-- timezone, like `market_*.business_date`: an expense belongs to a day on the
-- owner's books, not to an instant. Amounts are integer cents like every
-- other money column. Rows are soft-deleted so the ledger stays traceable.
--
-- STRICT is written by hand: drizzle-kit cannot emit the keyword.
CREATE TABLE `restaurant_expenses` (
  id TEXT PRIMARY KEY NOT NULL,
  restaurant_id TEXT NOT NULL,
  business_date TEXT NOT NULL
    CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(business_date) = business_date),
  category TEXT NOT NULL CHECK (category IN ('labor', 'rent', 'utilities', 'purchase', 'misc')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT,
  created_by TEXT,
  created_at_ms INTEGER NOT NULL,
  deleted_at_ms INTEGER,
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX restaurant_expenses_restaurant_date_idx
  ON restaurant_expenses (restaurant_id, business_date);
--> statement-breakpoint
CREATE TRIGGER `restaurant_expenses_restaurant_guard_bi`
BEFORE INSERT ON `restaurant_expenses`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'restaurant_expenses.restaurant_id references missing restaurants.id');
END;
--> statement-breakpoint
CREATE TRIGGER `restaurant_expenses_restaurant_guard_bu`
BEFORE UPDATE OF `restaurant_id` ON `restaurant_expenses`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'restaurant_expenses.restaurant_id references missing restaurants.id');
END;
