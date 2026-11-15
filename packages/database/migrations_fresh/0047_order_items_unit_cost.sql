-- Snapshot the menu item's cost on each order line at sale time, so editing a
-- menu item's cost no longer rewrites past days' COGS in the daily P&L.
--
-- Nullable with no default: NULL means the cost was unknown when the line was
-- written (every pre-existing row, and items with no cost set), which is not
-- the same as a cost of 0. Existing rows are deliberately not backfilled; the
-- P&L falls back to the current menu cost for NULL.
--
-- ALTER TABLE ADD COLUMN keeps the table STRICT; no recreation is involved.
ALTER TABLE `order_items` ADD COLUMN `unit_cost_cents` INTEGER;
