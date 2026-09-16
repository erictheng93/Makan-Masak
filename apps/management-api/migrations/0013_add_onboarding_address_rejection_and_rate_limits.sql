-- Capture the address supplied during onboarding rather than provisioning a
-- customer-facing restaurant with a synthetic placeholder address.
ALTER TABLE onboarding_applications ADD COLUMN address TEXT;
ALTER TABLE onboarding_applications ADD COLUMN district TEXT;
ALTER TABLE onboarding_applications ADD COLUMN city TEXT;
ALTER TABLE onboarding_applications ADD COLUMN rejection_reason TEXT;
ALTER TABLE onboarding_applications ADD COLUMN rejected_at_ms INTEGER;

-- The public application endpoint needs a concurrency-safe counter. This is
-- deliberately in D1 rather than KV: a single UPSERT can atomically admit or
-- reject a request within one fixed window.
CREATE TABLE IF NOT EXISTS onboarding_application_rate_limits (
  client_ip TEXT NOT NULL,
  window_started_at_ms INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  PRIMARY KEY (client_ip, window_started_at_ms)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_onboarding_application_rate_limits_window
  ON onboarding_application_rate_limits(window_started_at_ms);

CREATE TABLE IF NOT EXISTS onboarding_application_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL REFERENCES onboarding_applications(id),
  event_type TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  metadata TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_onboarding_application_audit_events_application
  ON onboarding_application_audit_events(application_id, created_at_ms);

-- Setup links can be regenerated. Migration 0012's unique constraint limited
-- each owner to one delivery row, so preserve the existing handoff and rebuild
-- the table without that obsolete constraint before recording future attempts.
--
-- Two other things change with the rebuild:
--   * setup_password_link is gone. It embedded a live password-reset token, so
--     every delivery row was a plaintext credential that outlived its use. The
--     token lives in the platform password_reset_tokens table; the link is
--     rebuilt from there when an operator asks for it.
--   * the timestamps become INTEGER Unix milliseconds, per the repo's timestamp
--     rule. Existing TEXT values are converted rather than dropped.
CREATE TABLE __new_onboarding_credential_deliveries (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES onboarding_applications(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  restaurant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  username TEXT NOT NULL,
  setup_password_expires_at_ms INTEGER NOT NULL,
  delivery_channel TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO __new_onboarding_credential_deliveries (
  id, application_id, tenant_id, restaurant_id, user_id, recipient_email,
  recipient_name, username, setup_password_expires_at_ms,
  delivery_channel, status, error_message, created_at_ms, updated_at_ms
)
SELECT
  id, application_id, tenant_id, restaurant_id, user_id, recipient_email,
  recipient_name, username,
  COALESCE(CAST(strftime('%s', setup_password_expires_at) AS INTEGER) * 1000, 0),
  delivery_channel, status, error_message,
  COALESCE(CAST(strftime('%s', created_at) AS INTEGER) * 1000, 0),
  COALESCE(CAST(strftime('%s', updated_at) AS INTEGER) * 1000, 0)
FROM onboarding_credential_deliveries;

DROP TABLE onboarding_credential_deliveries;
ALTER TABLE __new_onboarding_credential_deliveries
  RENAME TO onboarding_credential_deliveries;

CREATE INDEX idx_onboarding_credential_deliveries_application
  ON onboarding_credential_deliveries(application_id, created_at_ms);
CREATE INDEX idx_onboarding_credential_deliveries_status
  ON onboarding_credential_deliveries(status);
CREATE INDEX idx_onboarding_credential_deliveries_recipient
  ON onboarding_credential_deliveries(recipient_email);
