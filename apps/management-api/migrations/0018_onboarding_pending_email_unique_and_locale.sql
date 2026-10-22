-- One email, one application in review. createApplication used to check for
-- a pending row and then insert, so two simultaneous submits could both pass.
-- lower() matches the COLLATE NOCASE the old pre-check used (ASCII folding).
-- Production had no violating rows when this was written (2026-10-22, 7 rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_applications_pending_email
  ON onboarding_applications(lower(contact_email))
  WHERE status NOT IN ('rejected', 'completed');

-- The language applicant emails are written in. NULL (every row before this
-- migration) falls back to zh-TW, which is what those emails always were.
ALTER TABLE onboarding_applications ADD COLUMN locale TEXT;

-- When a status link was last emailed. The duplicate-submit and recovery
-- paths each rotate the secret and mail a fresh link; this is their
-- per-application cooldown, so nobody can mail-bomb an applicant.
ALTER TABLE onboarding_applications ADD COLUMN status_link_sent_at_ms INTEGER;
