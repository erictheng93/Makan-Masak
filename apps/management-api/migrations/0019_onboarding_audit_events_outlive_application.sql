-- Audit events are evidence that must outlive the application they describe:
-- purgeApplication removes the application row, keeps its events, and then adds
-- a "purged" event. The foreign key from 0013 forbids all of that, so every
-- purge failed with SQLITE_CONSTRAINT_FOREIGNKEY. application_id stays NOT NULL
-- and becomes a plain identifier.
--
-- DROP TABLE does not fire the append-only DELETE trigger; it drops it, so both
-- triggers from 0015 and the index from 0013 are recreated here.
CREATE TABLE __new_onboarding_application_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  application_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  actor_email TEXT,
  metadata TEXT,
  created_at_ms INTEGER NOT NULL
) STRICT;

INSERT INTO __new_onboarding_application_audit_events
  (id, application_id, event_type, actor_id, actor_email, metadata, created_at_ms)
SELECT id, application_id, event_type, actor_id, actor_email, metadata, created_at_ms
FROM onboarding_application_audit_events;

DROP TABLE onboarding_application_audit_events;

ALTER TABLE __new_onboarding_application_audit_events
  RENAME TO onboarding_application_audit_events;

CREATE INDEX IF NOT EXISTS idx_onboarding_application_audit_events_application
  ON onboarding_application_audit_events(application_id, created_at_ms);

CREATE TRIGGER IF NOT EXISTS onboarding_application_audit_events_no_update
BEFORE UPDATE ON onboarding_application_audit_events
BEGIN
  SELECT RAISE(ABORT, 'onboarding audit events are append-only');
END;

CREATE TRIGGER IF NOT EXISTS onboarding_application_audit_events_no_delete
BEFORE DELETE ON onboarding_application_audit_events
BEGIN
  SELECT RAISE(ABORT, 'onboarding audit events are append-only');
END;
