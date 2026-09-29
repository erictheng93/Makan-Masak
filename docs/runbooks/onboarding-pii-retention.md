# Onboarding audit and rejected applicant retention

Rejected applications retain identifying contact, location, and request data
for 365 days after rejection. The management API's daily scheduled job then
redacts those fields in place and keeps the application row and append-only
audit events for traceability. New audit snapshots redact rejected applicants
immediately. A scheduled archive run may apply the D1 redaction up to one
schedule interval after the 365-day cutoff.

This is an operating policy, not a statutory retention period. Review it with
the privacy owner before production rollout.

## Production R2 configuration

The audit archive bucket is `makanmasak-backups-prod`; these rules apply only to
the onboarding audit prefix. Configure both rules after reviewing the policy:

Before enabling the lock, review existing objects under this prefix. A
2026-09-29 read-only check found one unredacted rejected application in each
of the 2026-09-22 and 2026-09-23 daily objects; the 2026-09-24 through
2026-09-28 daily objects had none. Bucket locks also cover existing objects,
so resolve the two older snapshots under the approved retention policy first.
The lifecycle clock starts at object upload, not at application rejection.

```sh
pnpm exec wrangler r2 bucket lock add makanmasak-backups-prod \
  --name onboarding-audit-365d \
  --prefix management-audit/onboarding/ \
  --retention-days 365

pnpm exec wrangler r2 bucket lifecycle add makanmasak-backups-prod \
  --name onboarding-audit-expire-365d \
  --prefix management-audit/onboarding/ \
  --expire-days 365
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
