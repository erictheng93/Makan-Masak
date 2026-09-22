-- New service bookings are settled at the venue unless the application
-- explicitly asks for a deposit or prepayment. ServiceBookingService already
-- writes that value on every normal create, but the table default must express
-- the same invariant for direct SQL/Drizzle writes and fresh D1 databases.
--
-- SQLite cannot ALTER a column default. Recreate the booking table instead.
-- `service_booking_waitlist.converted_booking_id` is an inbound SET NULL
-- foreign key, so its rows are staged before the old parent table is dropped;
-- otherwise DROP TABLE would erase converted-booking references. Both staging
-- and final tables remain STRICT, and every index/trigger is restored.
CREATE TABLE `__new_service_bookings` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `service_item_id` INTEGER NOT NULL,
  `service_name_snapshot` TEXT NOT NULL,
  `duration_minutes_snapshot` INTEGER,
  `price_cents_snapshot` INTEGER NOT NULL DEFAULT 0,
  `customer_id` TEXT,
  `customer_name` TEXT NOT NULL,
  `customer_phone` TEXT NOT NULL,
  `customer_email` TEXT,
  `booking_date` TEXT NOT NULL,
  `booking_time` TEXT NOT NULL,
  `party_size` INTEGER NOT NULL DEFAULT 1,
  `employee_id` TEXT,
  `status` TEXT NOT NULL DEFAULT 'pending',
  `confirmation_code` TEXT NOT NULL,
  `special_requests` TEXT,
  `notes` TEXT,
  `coupon_id` INTEGER,
  `voucher_discount_cents` INTEGER NOT NULL DEFAULT 0,
  `amount_due_cents` INTEGER NOT NULL DEFAULT 0,
  `amount_paid_cents` INTEGER NOT NULL DEFAULT 0,
  `payment_method` TEXT NOT NULL DEFAULT 'none',
  `payment_status` TEXT NOT NULL DEFAULT 'unpaid',
  `payment_ref` TEXT,
  `confirmed_at_ms` INTEGER,
  `completed_at_ms` INTEGER,
  `cancelled_at_ms` INTEGER,
  `no_show_at_ms` INTEGER,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `payment_requirement` TEXT NOT NULL DEFAULT 'pay_at_venue',
  `deposit_required_cents` INTEGER NOT NULL DEFAULT 0,
  `balance_due_cents` INTEGER NOT NULL DEFAULT 0,
  `reminder_opt_in` INTEGER NOT NULL DEFAULT 0,
  `reminder_minutes_before` INTEGER,
  `reminder_scheduled_at_ms` INTEGER,
  `reminder_sent_at_ms` INTEGER,
  `calendar_uid` TEXT NOT NULL DEFAULT '',
  `recurrence_group_id` TEXT,
  `recurrence_index` INTEGER,
  `recurrence_count` INTEGER,
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`service_item_id`) REFERENCES `restaurant_service_items`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`employee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON DELETE SET NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_service_bookings` (
  `id`, `restaurant_id`, `service_item_id`, `service_name_snapshot`,
  `duration_minutes_snapshot`, `price_cents_snapshot`, `customer_id`,
  `customer_name`, `customer_phone`, `customer_email`, `booking_date`,
  `booking_time`, `party_size`, `employee_id`, `status`, `confirmation_code`,
  `special_requests`, `notes`, `coupon_id`, `voucher_discount_cents`,
  `amount_due_cents`, `amount_paid_cents`, `payment_method`, `payment_status`,
  `payment_ref`, `confirmed_at_ms`, `completed_at_ms`, `cancelled_at_ms`,
  `no_show_at_ms`, `created_at_ms`, `updated_at_ms`, `payment_requirement`,
  `deposit_required_cents`, `balance_due_cents`, `reminder_opt_in`,
  `reminder_minutes_before`, `reminder_scheduled_at_ms`,
  `reminder_sent_at_ms`, `calendar_uid`, `recurrence_group_id`,
  `recurrence_index`, `recurrence_count`
)
SELECT
  `id`, `restaurant_id`, `service_item_id`, `service_name_snapshot`,
  `duration_minutes_snapshot`, `price_cents_snapshot`, `customer_id`,
  `customer_name`, `customer_phone`, `customer_email`, `booking_date`,
  `booking_time`, `party_size`, `employee_id`, `status`, `confirmation_code`,
  `special_requests`, `notes`, `coupon_id`, `voucher_discount_cents`,
  `amount_due_cents`, `amount_paid_cents`, `payment_method`, `payment_status`,
  `payment_ref`, `confirmed_at_ms`, `completed_at_ms`, `cancelled_at_ms`,
  `no_show_at_ms`, `created_at_ms`, `updated_at_ms`, `payment_requirement`,
  `deposit_required_cents`, `balance_due_cents`, `reminder_opt_in`,
  `reminder_minutes_before`, `reminder_scheduled_at_ms`,
  `reminder_sent_at_ms`, `calendar_uid`, `recurrence_group_id`,
  `recurrence_index`, `recurrence_count`
FROM `service_bookings`;
--> statement-breakpoint
CREATE TABLE `__service_booking_waitlist_backup` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `service_item_id` INTEGER NOT NULL,
  `customer_id` TEXT,
  `customer_name` TEXT NOT NULL,
  `customer_phone` TEXT NOT NULL,
  `customer_email` TEXT,
  `booking_date` TEXT NOT NULL,
  `booking_time` TEXT NOT NULL,
  `party_size` INTEGER NOT NULL DEFAULT 1,
  `employee_id` TEXT,
  `status` TEXT NOT NULL DEFAULT 'waiting',
  `special_requests` TEXT,
  `notes` TEXT,
  `notified_at_ms` INTEGER,
  `converted_booking_id` TEXT,
  `created_at_ms` INTEGER NOT NULL,
  `updated_at_ms` INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `__service_booking_waitlist_backup`
SELECT * FROM `service_booking_waitlist`;
--> statement-breakpoint
DROP TABLE `service_booking_waitlist`;
--> statement-breakpoint
DROP TABLE `service_bookings`;
--> statement-breakpoint
ALTER TABLE `__new_service_bookings` RENAME TO `service_bookings`;
--> statement-breakpoint
CREATE INDEX `service_bookings_restaurant_status_date_idx`
  ON `service_bookings` (`restaurant_id`, `status`, `booking_date`);
--> statement-breakpoint
CREATE INDEX `service_bookings_service_date_time_idx`
  ON `service_bookings` (`service_item_id`, `booking_date`, `booking_time`);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_bookings_confirmation_code_idx`
  ON `service_bookings` (`confirmation_code`);
--> statement-breakpoint
CREATE INDEX `service_bookings_customer_phone_idx`
  ON `service_bookings` (`customer_phone`);
--> statement-breakpoint
CREATE INDEX `service_bookings_reminder_due_idx`
  ON `service_bookings` (`reminder_scheduled_at_ms`, `reminder_sent_at_ms`, `status`);
--> statement-breakpoint
CREATE INDEX `service_bookings_recurrence_group_idx`
  ON `service_bookings` (`recurrence_group_id`);
--> statement-breakpoint
CREATE TRIGGER `service_bookings_employee_overlap_guard_bi`
BEFORE INSERT ON `service_bookings`
WHEN NEW.`employee_id` IS NOT NULL
  AND NEW.`status` IN ('pending', 'confirmed')
  AND EXISTS (
    SELECT 1
      FROM `service_bookings` AS `existing`
     WHERE `existing`.`employee_id` = NEW.`employee_id`
       AND `existing`.`booking_date` = NEW.`booking_date`
       AND `existing`.`status` IN ('pending', 'confirmed')
       AND time(NEW.`booking_time`) < time(
             `existing`.`booking_time`,
             '+' || coalesce(`existing`.`duration_minutes_snapshot`, 0) || ' minutes'
           )
       AND time(`existing`.`booking_time`) < time(
             NEW.`booking_time`,
             '+' || coalesce(NEW.`duration_minutes_snapshot`, 0) || ' minutes'
           )
  )
BEGIN
  SELECT RAISE(ABORT, 'overlapping active employee service booking');
END;
--> statement-breakpoint
CREATE TRIGGER `service_bookings_employee_overlap_guard_bu`
BEFORE UPDATE OF `employee_id`, `booking_date`, `booking_time`, `duration_minutes_snapshot`, `status`
ON `service_bookings`
WHEN NEW.`employee_id` IS NOT NULL
  AND NEW.`status` IN ('pending', 'confirmed')
  AND EXISTS (
    SELECT 1
      FROM `service_bookings` AS `existing`
     WHERE `existing`.`id` != NEW.`id`
       AND `existing`.`employee_id` = NEW.`employee_id`
       AND `existing`.`booking_date` = NEW.`booking_date`
       AND `existing`.`status` IN ('pending', 'confirmed')
       AND time(NEW.`booking_time`) < time(
             `existing`.`booking_time`,
             '+' || coalesce(`existing`.`duration_minutes_snapshot`, 0) || ' minutes'
           )
       AND time(`existing`.`booking_time`) < time(
             NEW.`booking_time`,
             '+' || coalesce(NEW.`duration_minutes_snapshot`, 0) || ' minutes'
           )
  )
BEGIN
  SELECT RAISE(ABORT, 'overlapping active employee service booking');
END;
--> statement-breakpoint
CREATE TABLE `__new_service_booking_waitlist` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `service_item_id` INTEGER NOT NULL,
  `customer_id` TEXT,
  `customer_name` TEXT NOT NULL,
  `customer_phone` TEXT NOT NULL,
  `customer_email` TEXT,
  `booking_date` TEXT NOT NULL,
  `booking_time` TEXT NOT NULL,
  `party_size` INTEGER NOT NULL DEFAULT 1,
  `employee_id` TEXT,
  `status` TEXT NOT NULL DEFAULT 'waiting',
  `special_requests` TEXT,
  `notes` TEXT,
  `notified_at_ms` INTEGER,
  `converted_booking_id` TEXT,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`service_item_id`) REFERENCES `restaurant_service_items`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`employee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`converted_booking_id`) REFERENCES `service_bookings`(`id`) ON DELETE SET NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_service_booking_waitlist`
SELECT * FROM `__service_booking_waitlist_backup`;
--> statement-breakpoint
DROP TABLE `__service_booking_waitlist_backup`;
--> statement-breakpoint
ALTER TABLE `__new_service_booking_waitlist` RENAME TO `service_booking_waitlist`;
--> statement-breakpoint
CREATE INDEX `service_booking_waitlist_service_time_idx`
  ON `service_booking_waitlist` (`service_item_id`, `booking_date`, `booking_time`, `status`);
--> statement-breakpoint
CREATE INDEX `service_booking_waitlist_restaurant_status_idx`
  ON `service_booking_waitlist` (`restaurant_id`, `status`, `created_at_ms`);
--> statement-breakpoint
CREATE INDEX `service_booking_waitlist_customer_phone_idx`
  ON `service_booking_waitlist` (`customer_phone`);
