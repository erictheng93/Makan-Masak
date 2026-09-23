-- Older rejected applications predate rejected_at_ms. Their status update is
-- the best available proxy for the rejection time and starts the retention
-- clock without inventing an earlier date.
UPDATE onboarding_applications
SET rejected_at_ms = CAST(
  ROUND((julianday(updated_at) - 2440587.5) * 86400000) AS INTEGER
)
WHERE status = 'rejected'
  AND rejected_at_ms IS NULL
  AND julianday(updated_at) IS NOT NULL;
