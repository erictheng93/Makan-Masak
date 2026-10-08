# Onboarding audit and rejected applicant retention

Rejected applications retain identifying contact, location, and request data
for **90 days** after rejection (decided 2026-09-29, #421). The management
API's daily scheduled job then redacts those fields, including the free-text
`rejection_reason`, in place and keeps the application row and append-only
audit events for traceability. New audit snapshots redact rejected applicants
immediately. A scheduled archive run may apply the D1 redaction up to one
schedule interval after the 90-day cutoff.

Why 90 days: appeals, duplicate-application and abuse checks. Neither TW PDPA
art. 11 nor MY PDPA s.10 sets a number; both require deletion once the purpose
ends, so the period needs a stated purpose. Extending it needs a written
reason from the privacy owner. The constant is
`REJECTED_APPLICATION_RETENTION_MS`.

Audit events never carry free text. `rejected` writes no reason (it lives on
the application row and is cleared with it); other events carry IDs only.
Events written before this change could hold a `reason`; new archive snapshots
strip it. The one production row (`測試用` on the 2026-09-22 QA application) was
cleared on 2026-09-29 by dropping `..._no_update`, updating that single id and
recreating the trigger in one `d1 execute --file`. Do the same, one reviewed
file per change, if another ever needs clearing, and record who and why.

## Production R2 configuration

The audit archive bucket is `makanmasak-backups-prod`; these rules apply only to
the onboarding audit prefix. Both rules were added on 2026-09-29 (`onboarding-audit-90d`,
`onboarding-audit-expire-90d`):

**Done 2026-09-29 (before the lock).** A 2026-09-29 read-only check found one unredacted
rejected application in each of the 2026-09-22 and 2026-09-23 daily objects;
the 2026-09-24 through 2026-09-28 objects had none. A lock also covers existing
objects and cannot be shortened, so those two must be cleaned first:

1. Download both objects.
2. Redact the rejected application (and any event `reason`) the same way
   `archiveOnboardingAudit` does; keep the rest of the JSON unchanged.
3. Upload over the same keys, then re-read to confirm.
4. Log the operator, time and reason in the ticket.

The lifecycle clock starts at object upload, not at application rejection.

```sh
pnpm exec wrangler r2 bucket lock add makanmasak-backups-prod \
  --name onboarding-audit-90d \
  --prefix management-audit/onboarding/ \
  --retention-days 90

pnpm exec wrangler r2 bucket lifecycle add makanmasak-backups-prod \
  --name onboarding-audit-expire-90d \
  --prefix management-audit/onboarding/ \
  --expire-days 90
```

The lock prevents overwrites and deletions during the retention window;
lifecycle removes objects after the window and the lock has expired. R2 applies
these rules to existing objects as well as future objects. Verify both rules
after configuration:

```sh
pnpm exec wrangler r2 bucket lock list makanmasak-backups-prod
pnpm exec wrangler r2 bucket lifecycle list makanmasak-backups-prod
```

The application also uses conditional `put` for each daily key, so concurrent
cron runs cannot replace that day's first successful snapshot.
