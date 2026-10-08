-- Backfill lifecycle events for applications created before the service began
-- recording submission and approval events. Unknown historical actors stay
-- NULL; the metadata marks these timestamps as derived from application rows.
INSERT INTO onboarding_application_audit_events (
  id, application_id, event_type, actor_id, actor_email, metadata, created_at_ms
)
SELECT
  'backfill-submitted:' || app.id,
  app.id,
  'submitted',
  NULL,
  NULL,
  '{"source":"backfill"}',
  CAST(strftime('%s', COALESCE(NULLIF(app.submitted_at, ''), app.created_at)) AS INTEGER) * 1000
FROM onboarding_applications AS app
WHERE NOT EXISTS (
  SELECT 1
  FROM onboarding_application_audit_events AS event
  WHERE event.application_id = app.id AND event.event_type = 'submitted'
);

INSERT INTO onboarding_application_audit_events (
  id, application_id, event_type, actor_id, actor_email, metadata, created_at_ms
)
SELECT
  'backfill-approved:' || app.id,
  app.id,
  'approved',
  NULL,
  NULL,
  '{"source":"backfill","actor":"unknown"}',
  CAST(strftime('%s', COALESCE(NULLIF(app.completed_at, ''), app.updated_at)) AS INTEGER) * 1000
FROM onboarding_applications AS app
WHERE app.status = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM onboarding_application_audit_events AS event
    WHERE event.application_id = app.id AND event.event_type = 'approved'
  );
