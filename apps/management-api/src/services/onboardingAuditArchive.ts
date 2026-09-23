import { asc, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  onboardingApplicationAuditEvents,
  onboardingApplications,
} from "../db/onboarding-tables";
import type { ManagementEnv } from "../types";

/** Rejected applications retain contact and request data for one year. */
export const REJECTED_APPLICATION_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

const REDACTED_VALUE = "[redacted after 12-month retention]";

/**
 * Keep the application row and its append-only audit events for traceability,
 * but remove applicant contact, location, and request metadata after the
 * retention window. A row without rejected_at_ms is deliberately left alone;
 * migration 0017 backfills that timestamp from the rejection update.
 */
export async function redactExpiredRejectedApplications(
  env: ManagementEnv,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = now.getTime() - REJECTED_APPLICATION_RETENTION_MS;
  const result = await env.MANAGEMENT_DB.prepare(
    `UPDATE onboarding_applications
     SET business_name = ?,
         contact_name = ?,
         contact_email = ?,
         contact_phone = ?,
         address = NULL,
         district = NULL,
         city = NULL,
         latitude = NULL,
         longitude = NULL,
         country_code = 'ZZ',
         stall_number = NULL,
         requested_subdomain = NULL,
         assigned_subdomain = NULL,
         application_secret_hash = NULL,
         ip_address = NULL,
         user_agent = NULL,
         updated_at = ?
     WHERE status = 'rejected'
       AND rejected_at_ms IS NOT NULL
       AND rejected_at_ms <= ?`,
  )
    .bind(
      REDACTED_VALUE,
      REDACTED_VALUE,
      REDACTED_VALUE,
      REDACTED_VALUE,
      now.toISOString(),
      cutoff,
    )
    .run();
  return Number(result.meta.changes ?? 0);
}

/**
 * D1 Time Travel only reaches back 30 days, and rejected applications must
 * outlive that for audits (#419). Each run writes a full snapshot of the
 * applications and their audit events, keyed by UTC day. The first successful
 * run owns that day's key; later runs leave it untouched.
 *
 * ponytail: full-table reads, fine at hundreds of rows; page through both
 * tables once they reach tens of thousands.
 */
export function onboardingAuditArchiveKey(now: Date): string {
  return `management-audit/onboarding/${now.toISOString().slice(0, 10)}.json`;
}

export async function archiveOnboardingAudit(
  env: ManagementEnv,
  now: Date = new Date(),
): Promise<string> {
  if (!env.AUDIT_ARCHIVE) {
    throw new Error("AUDIT_ARCHIVE R2 binding is not configured");
  }

  const key = onboardingAuditArchiveKey(now);
  if (await env.AUDIT_ARCHIVE.head(key)) return key;

  // The secret hash lets whoever holds it read the application; an archive
  // kept for years must not become a second place to steal it from.
  const { applicationSecretHash: _secretHash, ...archivedColumns } =
    getTableColumns(onboardingApplications);
  const db = drizzle(env.MANAGEMENT_DB);
  const [applications, auditEvents] = await Promise.all([
    db
      .select(archivedColumns)
      .from(onboardingApplications)
      .orderBy(asc(onboardingApplications.id)),
    db
      .select()
      .from(onboardingApplicationAuditEvents)
      .orderBy(
        asc(onboardingApplicationAuditEvents.createdAtMs),
        asc(onboardingApplicationAuditEvents.id),
      ),
  ]);

  // Do not copy rejected applicants' contact or request metadata into new
  // archives. Older daily objects are covered by the R2 365-day lifecycle.
  const redactedApplications = applications.map((application) =>
    application.status === "rejected"
      ? {
          ...application,
          businessName: REDACTED_VALUE,
          contactName: REDACTED_VALUE,
          contactEmail: REDACTED_VALUE,
          contactPhone: REDACTED_VALUE,
          address: null,
          district: null,
          city: null,
          latitude: null,
          longitude: null,
          countryCode: "ZZ",
          stallNumber: null,
          requestedSubdomain: null,
          assignedSubdomain: null,
          ipAddress: null,
          userAgent: null,
        }
      : application,
  );

  const archived = await env.AUDIT_ARCHIVE.put(
    key,
    JSON.stringify({
      exportedAt: now.toISOString(),
      applications: redactedApplications,
      auditEvents,
    }),
    {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
    },
  );
  // A same-day run can race the initial head() check. This conditional write
  // makes that race idempotent and never overwrites the first snapshot.
  if (!archived && !(await env.AUDIT_ARCHIVE.head(key))) {
    throw new Error(`Failed to create onboarding audit archive: ${key}`);
  }
  return key;
}
