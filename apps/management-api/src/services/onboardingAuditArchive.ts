import { asc, getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  onboardingApplicationAuditEvents,
  onboardingApplications,
} from "../db/onboarding-tables";
import type { ManagementEnv } from "../types";

/**
 * D1 Time Travel only reaches back 30 days, and rejected applications must
 * outlive that for audits (#419). Each run writes a full snapshot of the
 * applications and their audit events, keyed by UTC day, so a rerun on the same
 * day overwrites instead of duplicating.
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

  const key = onboardingAuditArchiveKey(now);
  await env.AUDIT_ARCHIVE.put(
    key,
    JSON.stringify({
      exportedAt: now.toISOString(),
      applications,
      auditEvents,
    }),
    { httpMetadata: { contentType: "application/json" } },
  );
  return key;
}
