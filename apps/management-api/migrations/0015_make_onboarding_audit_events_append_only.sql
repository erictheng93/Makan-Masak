-- Audit events are evidence, so application code and direct SQL must not be
-- able to rewrite or erase them after insertion.
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
