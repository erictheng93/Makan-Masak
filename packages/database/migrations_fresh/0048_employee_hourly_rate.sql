-- Per-employee hourly wage, and the rate in force when a shift was clocked out.
--
-- users.hourly_rate_cents: the employee's own wage (integer cents/hour). NULL
-- means "no own wage", and the daily P&L falls back to the shift template's
-- rate. It is salary data: only owners/admins of the shop may read or set it.
--
-- employee_schedules.hourly_rate_cents: snapshot taken at clock-out (employee
-- wage, else template rate, else NULL), so a later wage change does not
-- rewrite past days' labor cost. Existing rows are deliberately not
-- backfilled; the P&L falls back to the current wage/template rate for NULL.
--
-- Both nullable with no default. ALTER TABLE ADD COLUMN keeps a STRICT table
-- STRICT; no recreation is involved.
ALTER TABLE `users` ADD COLUMN `hourly_rate_cents` INTEGER;
ALTER TABLE `employee_schedules` ADD COLUMN `hourly_rate_cents` INTEGER;
