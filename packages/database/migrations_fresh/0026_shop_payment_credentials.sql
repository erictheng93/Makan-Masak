-- Per-shop e-wallet payment credentials.
--
-- A Malaysian shop connects its own Touch 'n Go eWallet or GrabPay merchant
-- account so customers pay that shop directly. One row per (restaurant,
-- provider).
--
-- Secret storage: every value that can pay or sign — merchant key, client
-- secret, webhook secret — lives only inside `secret_payload_encrypted`
-- (AES-256-GCM). `config` is for non-secret flags and holds no credential
-- material. `merchant_id` is plaintext on purpose: it is the identifier a
-- provider prints on its dashboard and echoes in a webhook body, so a callback
-- can resolve the account without first decrypting every tenant's secrets —
-- the same trade `platform_integrations.store_id` makes (#338).
--
-- No CHECK on `provider`: a wallet needs an adapter before a row for it does
-- anything and the route rejects an unknown provider on write, so a CHECK
-- would only add a recreate-table migration to every future wallet. `status`
-- and `environment` are CHECKed — those sets are closed and a bad value there
-- changes behaviour.
CREATE TABLE `shop_payment_credentials` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `restaurant_id` TEXT NOT NULL,
  `provider` TEXT NOT NULL,
  `status` TEXT NOT NULL DEFAULT 'connected',
  `merchant_id` TEXT NOT NULL,
  `display_name` TEXT,
  `environment` TEXT NOT NULL DEFAULT 'sandbox',
  `secret_payload_encrypted` TEXT NOT NULL,
  `config` TEXT NOT NULL DEFAULT '{}',
  `secret_updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `connected_at_ms` INTEGER,
  `disabled_at_ms` INTEGER,
  `updated_by` TEXT,
  `created_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  `updated_at_ms` INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  CHECK (`status` IN ('connected', 'disabled')),
  CHECK (`environment` IN ('sandbox', 'production')),
  CHECK (length(`merchant_id`) > 0),
  CHECK (length(`secret_payload_encrypted`) > 0)
) STRICT;
--> statement-breakpoint
-- A shop has at most one account per wallet. Reconnecting overwrites.
CREATE UNIQUE INDEX `shop_payment_credentials_restaurant_provider_idx`
  ON `shop_payment_credentials` (`restaurant_id`, `provider`);
--> statement-breakpoint
-- "Which shops can be charged through this wallet right now?"
CREATE INDEX `shop_payment_credentials_active_idx`
  ON `shop_payment_credentials` (`provider`, `status`);
--> statement-breakpoint
-- D1 does not enforce foreign keys on every path, and this row decides where
-- a customer's money lands. A credential for a restaurant that does not exist
-- is unroutable at best and a misdirected payout at worst, so the guard is a
-- trigger as well — the shape `restaurant_alerts` uses (0020).
CREATE TRIGGER `shop_payment_credentials_restaurant_guard_bi`
BEFORE INSERT ON `shop_payment_credentials`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'shop_payment_credentials.restaurant_id references missing restaurants.id');
END;
--> statement-breakpoint
CREATE TRIGGER `shop_payment_credentials_restaurant_guard_bu`
BEFORE UPDATE OF `restaurant_id` ON `shop_payment_credentials`
FOR EACH ROW
WHEN NOT EXISTS (SELECT 1 FROM `restaurants` WHERE `id` = NEW.`restaurant_id`)
BEGIN
  SELECT RAISE(ABORT, 'shop_payment_credentials.restaurant_id references missing restaurants.id');
END;
