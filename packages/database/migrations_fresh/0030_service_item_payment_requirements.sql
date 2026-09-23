-- Payment requirements belong to the merchant's service definition. Rebuild
-- restaurant_service_items as STRICT. Its three inbound booking tables are
-- staged first so dropping the old parent cannot cascade away bookings, slots,
-- or waitlist entries. JSON staging tables are STRICT as well.
CREATE TABLE `__backup_service_bookings` (
  `row_json` TEXT NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `__backup_service_bookings` (`row_json`)
SELECT json_object(
  'id', `id`, 'restaurant_id', `restaurant_id`,
  'service_item_id', `service_item_id`,
  'service_name_snapshot', `service_name_snapshot`,
  'duration_minutes_snapshot', `duration_minutes_snapshot`,
  'price_cents_snapshot', `price_cents_snapshot`,
  'customer_id', `customer_id`, 'customer_name', `customer_name`,
  'customer_phone', `customer_phone`, 'customer_email', `customer_email`,
  'booking_date', `booking_date`, 'booking_time', `booking_time`,
  'party_size', `party_size`, 'employee_id', `employee_id`,
  'status', `status`, 'confirmation_code', `confirmation_code`,
  'special_requests', `special_requests`, 'notes', `notes`,
  'coupon_id', `coupon_id`, 'voucher_discount_cents', `voucher_discount_cents`,
  'amount_due_cents', `amount_due_cents`, 'amount_paid_cents', `amount_paid_cents`,
  'payment_method', `payment_method`, 'payment_status', `payment_status`,
  'payment_ref', `payment_ref`, 'confirmed_at_ms', `confirmed_at_ms`,
  'completed_at_ms', `completed_at_ms`, 'cancelled_at_ms', `cancelled_at_ms`,
  'no_show_at_ms', `no_show_at_ms`, 'created_at_ms', `created_at_ms`,
  'updated_at_ms', `updated_at_ms`, 'payment_requirement', `payment_requirement`,
  'deposit_required_cents', `deposit_required_cents`,
  'balance_due_cents', `balance_due_cents`, 'reminder_opt_in', `reminder_opt_in`,
  'reminder_minutes_before', `reminder_minutes_before`,
  'reminder_scheduled_at_ms', `reminder_scheduled_at_ms`,
  'reminder_sent_at_ms', `reminder_sent_at_ms`, 'calendar_uid', `calendar_uid`,
  'recurrence_group_id', `recurrence_group_id`,
  'recurrence_index', `recurrence_index`, 'recurrence_count', `recurrence_count`
)
FROM `service_bookings`;
--> statement-breakpoint
CREATE TABLE `__backup_service_booking_slots` (
  `row_json` TEXT NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `__backup_service_booking_slots` (`row_json`)
SELECT json_object(
  'id', `id`, 'restaurant_id', `restaurant_id`,
  'service_item_id', `service_item_id`, 'date', `date`,
  'time_slot', `time_slot`, 'max_capacity', `max_capacity`,
  'current_bookings', `current_bookings`, 'is_available', `is_available`,
  'block_reason', `block_reason`, 'created_at_ms', `created_at_ms`,
  'updated_at_ms', `updated_at_ms`
)
FROM `service_booking_slots`;
--> statement-breakpoint
CREATE TABLE `__backup_service_booking_waitlist` (
  `row_json` TEXT NOT NULL
) STRICT;
--> statement-breakpoint
INSERT INTO `__backup_service_booking_waitlist` (`row_json`)
SELECT json_object(
  'id', `id`, 'restaurant_id', `restaurant_id`,
  'service_item_id', `service_item_id`, 'customer_id', `customer_id`,
  'customer_name', `customer_name`, 'customer_phone', `customer_phone`,
  'customer_email', `customer_email`, 'booking_date', `booking_date`,
  'booking_time', `booking_time`, 'party_size', `party_size`,
  'employee_id', `employee_id`, 'status', `status`,
  'special_requests', `special_requests`, 'notes', `notes`,
  'notified_at_ms', `notified_at_ms`,
  'converted_booking_id', `converted_booking_id`,
  'created_at_ms', `created_at_ms`, 'updated_at_ms', `updated_at_ms`
)
FROM `service_booking_waitlist`;
--> statement-breakpoint
DROP TABLE `service_booking_waitlist`;
--> statement-breakpoint
DROP TABLE `service_booking_slots`;
--> statement-breakpoint
DROP TABLE `service_bookings`;
--> statement-breakpoint
CREATE TABLE `__new_restaurant_service_items` (
  `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `name` TEXT NOT NULL,
  `description` TEXT,
  `service_type` TEXT NOT NULL DEFAULT 'general',
  `price_cents` INTEGER,
  `payment_requirement` TEXT NOT NULL DEFAULT 'pay_at_venue'
    CHECK (`payment_requirement` IN ('none', 'deposit', 'prepay', 'pay_at_venue')),
  `deposit_amount_cents` INTEGER NOT NULL DEFAULT 0
    CHECK (`deposit_amount_cents` >= 0),
  `price_label` TEXT,
  `duration_minutes` INTEGER,
  `requires_booking` INTEGER NOT NULL DEFAULT 0,
  `booking_url` TEXT,
  `available_hours` TEXT,
  `tags` TEXT,
  `keywords` TEXT,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` INTEGER NOT NULL DEFAULT 1,
  `is_public` INTEGER NOT NULL DEFAULT 1,
  `created_at_ms` INTEGER NOT NULL,
  `updated_at_ms` INTEGER NOT NULL,
  `deleted_at_ms` INTEGER,
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
INSERT INTO `__new_restaurant_service_items` (
  `id`, `restaurant_id`, `name`, `description`, `service_type`, `price_cents`,
  `payment_requirement`, `deposit_amount_cents`, `price_label`,
  `duration_minutes`, `requires_booking`, `booking_url`, `available_hours`,
  `tags`, `keywords`, `sort_order`, `is_active`, `is_public`,
  `created_at_ms`, `updated_at_ms`, `deleted_at_ms`
)
SELECT
  `id`, `restaurant_id`, `name`, `description`, `service_type`, `price_cents`,
  'pay_at_venue', 0, `price_label`, `duration_minutes`, `requires_booking`,
  `booking_url`, `available_hours`, `tags`, `keywords`, `sort_order`,
  `is_active`, `is_public`, `created_at_ms`, `updated_at_ms`, `deleted_at_ms`
FROM `restaurant_service_items`;
--> statement-breakpoint
DROP TABLE `restaurant_service_items`;
--> statement-breakpoint
ALTER TABLE `__new_restaurant_service_items`
  RENAME TO `restaurant_service_items`;
--> statement-breakpoint
CREATE INDEX `restaurant_service_items_public_idx`
  ON `restaurant_service_items` (`restaurant_id`, `is_active`, `is_public`, `sort_order`);
--> statement-breakpoint
CREATE INDEX `restaurant_service_items_type_idx`
  ON `restaurant_service_items` (`restaurant_id`, `service_type`, `is_active`);
--> statement-breakpoint
CREATE TABLE `service_bookings` (
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
CREATE TABLE `service_booking_slots` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `service_item_id` INTEGER NOT NULL,
  `date` TEXT NOT NULL,
  `time_slot` TEXT NOT NULL,
  `max_capacity` INTEGER NOT NULL,
  `current_bookings` INTEGER NOT NULL DEFAULT 0,
  `is_available` INTEGER NOT NULL DEFAULT 1,
  `block_reason` TEXT,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`service_item_id`) REFERENCES `restaurant_service_items`(`id`) ON DELETE CASCADE
) STRICT;
--> statement-breakpoint
CREATE TABLE `service_booking_waitlist` (
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
INSERT INTO `service_bookings` (
  `id`, `restaurant_id`, `service_item_id`, `service_name_snapshot`,
  `duration_minutes_snapshot`, `price_cents_snapshot`, `customer_id`,
  `customer_name`, `customer_phone`, `customer_email`, `booking_date`,
  `booking_time`, `party_size`, `employee_id`, `status`, `confirmation_code`,
  `special_requests`, `notes`, `coupon_id`, `voucher_discount_cents`,
  `amount_due_cents`, `amount_paid_cents`, `payment_method`, `payment_status`,
  `payment_ref`, `confirmed_at_ms`, `completed_at_ms`, `cancelled_at_ms`,
  `no_show_at_ms`, `created_at_ms`, `updated_at_ms`, `payment_requirement`,
  `deposit_required_cents`, `balance_due_cents`, `reminder_opt_in`,
  `reminder_minutes_before`, `reminder_scheduled_at_ms`, `reminder_sent_at_ms`,
  `calendar_uid`, `recurrence_group_id`, `recurrence_index`, `recurrence_count`
)
SELECT
  json_extract(`row_json`, '$.id'),
  json_extract(`row_json`, '$.restaurant_id'),
  json_extract(`row_json`, '$.service_item_id'),
  json_extract(`row_json`, '$.service_name_snapshot'),
  json_extract(`row_json`, '$.duration_minutes_snapshot'),
  json_extract(`row_json`, '$.price_cents_snapshot'),
  json_extract(`row_json`, '$.customer_id'),
  json_extract(`row_json`, '$.customer_name'),
  json_extract(`row_json`, '$.customer_phone'),
  json_extract(`row_json`, '$.customer_email'),
  json_extract(`row_json`, '$.booking_date'),
  json_extract(`row_json`, '$.booking_time'),
  json_extract(`row_json`, '$.party_size'),
  json_extract(`row_json`, '$.employee_id'),
  json_extract(`row_json`, '$.status'),
  json_extract(`row_json`, '$.confirmation_code'),
  json_extract(`row_json`, '$.special_requests'),
  json_extract(`row_json`, '$.notes'),
  json_extract(`row_json`, '$.coupon_id'),
  json_extract(`row_json`, '$.voucher_discount_cents'),
  json_extract(`row_json`, '$.amount_due_cents'),
  json_extract(`row_json`, '$.amount_paid_cents'),
  json_extract(`row_json`, '$.payment_method'),
  json_extract(`row_json`, '$.payment_status'),
  json_extract(`row_json`, '$.payment_ref'),
  json_extract(`row_json`, '$.confirmed_at_ms'),
  json_extract(`row_json`, '$.completed_at_ms'),
  json_extract(`row_json`, '$.cancelled_at_ms'),
  json_extract(`row_json`, '$.no_show_at_ms'),
  json_extract(`row_json`, '$.created_at_ms'),
  json_extract(`row_json`, '$.updated_at_ms'),
  json_extract(`row_json`, '$.payment_requirement'),
  json_extract(`row_json`, '$.deposit_required_cents'),
  json_extract(`row_json`, '$.balance_due_cents'),
  json_extract(`row_json`, '$.reminder_opt_in'),
  json_extract(`row_json`, '$.reminder_minutes_before'),
  json_extract(`row_json`, '$.reminder_scheduled_at_ms'),
  json_extract(`row_json`, '$.reminder_sent_at_ms'),
  json_extract(`row_json`, '$.calendar_uid'),
  json_extract(`row_json`, '$.recurrence_group_id'),
  json_extract(`row_json`, '$.recurrence_index'),
  json_extract(`row_json`, '$.recurrence_count')
FROM `__backup_service_bookings`;
--> statement-breakpoint
INSERT INTO `service_booking_slots` (
  `id`, `restaurant_id`, `service_item_id`, `date`, `time_slot`,
  `max_capacity`, `current_bookings`, `is_available`, `block_reason`,
  `created_at_ms`, `updated_at_ms`
)
SELECT
  json_extract(`row_json`, '$.id'),
  json_extract(`row_json`, '$.restaurant_id'),
  json_extract(`row_json`, '$.service_item_id'),
  json_extract(`row_json`, '$.date'),
  json_extract(`row_json`, '$.time_slot'),
  json_extract(`row_json`, '$.max_capacity'),
  json_extract(`row_json`, '$.current_bookings'),
  json_extract(`row_json`, '$.is_available'),
  json_extract(`row_json`, '$.block_reason'),
  json_extract(`row_json`, '$.created_at_ms'),
  json_extract(`row_json`, '$.updated_at_ms')
FROM `__backup_service_booking_slots`;
--> statement-breakpoint
INSERT INTO `service_booking_waitlist` (
  `id`, `restaurant_id`, `service_item_id`, `customer_id`, `customer_name`,
  `customer_phone`, `customer_email`, `booking_date`, `booking_time`,
  `party_size`, `employee_id`, `status`, `special_requests`, `notes`,
  `notified_at_ms`, `converted_booking_id`, `created_at_ms`, `updated_at_ms`
)
SELECT
  json_extract(`row_json`, '$.id'),
  json_extract(`row_json`, '$.restaurant_id'),
  json_extract(`row_json`, '$.service_item_id'),
  json_extract(`row_json`, '$.customer_id'),
  json_extract(`row_json`, '$.customer_name'),
  json_extract(`row_json`, '$.customer_phone'),
  json_extract(`row_json`, '$.customer_email'),
  json_extract(`row_json`, '$.booking_date'),
  json_extract(`row_json`, '$.booking_time'),
  json_extract(`row_json`, '$.party_size'),
  json_extract(`row_json`, '$.employee_id'),
  json_extract(`row_json`, '$.status'),
  json_extract(`row_json`, '$.special_requests'),
  json_extract(`row_json`, '$.notes'),
  json_extract(`row_json`, '$.notified_at_ms'),
  json_extract(`row_json`, '$.converted_booking_id'),
  json_extract(`row_json`, '$.created_at_ms'),
  json_extract(`row_json`, '$.updated_at_ms')
FROM `__backup_service_booking_waitlist`;
--> statement-breakpoint
DROP TABLE `__backup_service_bookings`;
--> statement-breakpoint
DROP TABLE `__backup_service_booking_slots`;
--> statement-breakpoint
DROP TABLE `__backup_service_booking_waitlist`;
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
    SELECT 1 FROM `service_bookings` AS `existing`
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
    SELECT 1 FROM `service_bookings` AS `existing`
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
CREATE UNIQUE INDEX `service_booking_slots_unique_idx`
  ON `service_booking_slots` (`service_item_id`, `date`, `time_slot`);
--> statement-breakpoint
CREATE INDEX `service_booking_slots_restaurant_date_idx`
  ON `service_booking_slots` (`restaurant_id`, `date`);
--> statement-breakpoint
CREATE INDEX `service_booking_waitlist_service_time_idx`
  ON `service_booking_waitlist` (`service_item_id`, `booking_date`, `booking_time`, `status`);
--> statement-breakpoint
CREATE INDEX `service_booking_waitlist_restaurant_status_idx`
  ON `service_booking_waitlist` (`restaurant_id`, `status`, `created_at_ms`);
--> statement-breakpoint
CREATE INDEX `service_booking_waitlist_customer_phone_idx`
  ON `service_booking_waitlist` (`customer_phone`);
