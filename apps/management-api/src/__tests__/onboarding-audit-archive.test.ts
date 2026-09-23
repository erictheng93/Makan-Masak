import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/d1";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import worker from "../index";
import {
  onboardingApplicationAuditEvents,
  onboardingApplications,
} from "../db/onboarding-tables";
import {
  archiveOnboardingAudit,
  redactExpiredRejectedApplications,
} from "../services/onboardingAuditArchive";
import { OnboardingService } from "../services/OnboardingService";
import type { ManagementEnv } from "../types";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

function createManagementDb(stopBefore?: string) {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF");
  for (const file of fs.readdirSync(migrationsDir).sort()) {
    if (file.endsWith(".sql")) {
      if (stopBefore && file >= `${stopBefore}_`) break;
      sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  }
  return new D1DatabaseAdapter(sqlite) as unknown as D1Database;
}

function buildApplication(
  overrides: Partial<typeof onboardingApplications.$inferInsert> = {},
): typeof onboardingApplications.$inferInsert {
  return {
    id: "APP-1",
    businessName: "Laksa Stall",
    contactName: "Aisha",
    contactEmail: "aisha@example.test",
    contactPhone: "0123456789",
    countryCode: "MY",
    // NOT NULL in the migration even though the Drizzle column is optional.
    planId: "trial",
    status: "submitted",
    applicationSecretHash: "$2a$10$secret-hash",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

async function seed(db: D1Database) {
  const orm = drizzle(db);
  await orm.insert(onboardingApplications).values([
    buildApplication({
      id: "APP-2",
      status: "rejected",
      rejectionReason: "Duplicate stall",
      rejectedAtMs: 1_790_000_000_000,
      address: "12 Test Street",
      city: "Kuala Lumpur",
      latitude: 3.139,
      longitude: 101.686,
      ipAddress: "203.0.113.4",
      userAgent: "Applicant Browser",
    }),
    buildApplication({ id: "APP-1" }),
  ]);
  await orm.insert(onboardingApplicationAuditEvents).values([
    {
      id: "evt-2",
      applicationId: "APP-2",
      eventType: "rejected",
      actorId: "admin-1",
      actorEmail: "ops@example.test",
      metadata: JSON.stringify({ reason: "Duplicate stall" }),
      createdAtMs: 1_790_000_000_000,
    },
    {
      id: "evt-1",
      applicationId: "APP-2",
      eventType: "submitted",
      createdAtMs: 1_789_000_000_000,
    },
  ]);
}

function createArchive() {
  const objects = new Map<string, string>();
  return {
    objects,
    head: vi.fn(async (key: string) =>
      objects.has(key) ? ({} as R2Object) : null,
    ),
    put: vi.fn(async (key: string, value: string) => {
      if (objects.has(key)) return null;
      objects.set(key, value);
      return {} as R2Object;
    }),
  };
}

describe("onboarding audit archive", () => {
  afterEach(() => vi.restoreAllMocks());

  it("snapshots every application and audit event without the secret hash", async () => {
    const db = createManagementDb();
    await seed(db);
    const archive = createArchive();

    const key = await archiveOnboardingAudit(
      {
        MANAGEMENT_DB: db,
        AUDIT_ARCHIVE: archive as unknown as R2Bucket,
      } as ManagementEnv,
      new Date("2026-09-22T18:30:00.000Z"),
    );

    expect(key).toBe("management-audit/onboarding/2026-09-22.json");
    expect(archive.put).toHaveBeenCalledOnce();
    expect(archive.put).toHaveBeenCalledWith(
      key,
      expect.any(String),
      expect.objectContaining({
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      }),
    );
    const body = JSON.parse(
      (archive.put.mock.calls[0] as unknown as [string, string])[1],
    );
    expect(body.exportedAt).toBe("2026-09-22T18:30:00.000Z");
    expect(body.applications.map((a: { id: string }) => a.id)).toEqual([
      "APP-1",
      "APP-2",
    ]);
    expect(body.applications[1]).toMatchObject({
      status: "rejected",
      rejectionReason: "Duplicate stall",
      rejectedAtMs: 1_790_000_000_000,
      contactEmail: "[redacted after 12-month retention]",
      contactPhone: "[redacted after 12-month retention]",
      address: null,
      city: null,
      latitude: null,
      longitude: null,
      ipAddress: null,
      userAgent: null,
    });
    for (const application of body.applications) {
      expect(application).not.toHaveProperty("applicationSecretHash");
    }
    expect(JSON.stringify(body)).not.toContain("secret-hash");
    expect(
      body.auditEvents.map((e: { eventType: string }) => e.eventType),
    ).toEqual(["submitted", "rejected"]);
    expect(body.auditEvents[1]).toMatchObject({
      actorEmail: "ops@example.test",
      metadata: JSON.stringify({ reason: "Duplicate stall" }),
    });
  });

  it("keeps the first snapshot when the same UTC day is archived again", async () => {
    const db = createManagementDb();
    await seed(db);
    const archive = createArchive();
    const env = {
      MANAGEMENT_DB: db,
      AUDIT_ARCHIVE: archive as unknown as R2Bucket,
    } as ManagementEnv;
    const day = new Date("2026-09-22T18:30:00.000Z");

    await archiveOnboardingAudit(env, day);
    const archivedContent = archive.objects.values().next().value;
    await archiveOnboardingAudit(env, day);

    expect(archive.put).toHaveBeenCalledOnce();
    expect(archive.objects.values().next().value).toBe(archivedContent);
  });

  it("redacts expired rejected applicants while preserving audit rows", async () => {
    const db = createManagementDb();
    const orm = drizzle(db);
    const cutoff = Date.parse("2025-09-23T00:00:00.000Z");
    await orm.insert(onboardingApplications).values([
      buildApplication({
        id: "APP-EXPIRED",
        status: "rejected",
        rejectedAtMs: cutoff - 1,
        address: "12 Test Street",
        district: "Bukit Bintang",
        city: "Kuala Lumpur",
        countryCode: "MY",
        stallNumber: "A-12",
        requestedSubdomain: "aisha-laksa",
        ipAddress: "203.0.113.4",
        userAgent: "Applicant Browser",
      }),
      buildApplication({
        id: "APP-RECENT",
        status: "rejected",
        rejectedAtMs: cutoff + 1,
        contactEmail: "recent@example.test",
      }),
      buildApplication({
        id: "APP-PENDING",
        status: "submitted",
        rejectedAtMs: cutoff - 1,
      }),
    ]);
    await orm.insert(onboardingApplicationAuditEvents).values({
      id: "evt-expired",
      applicationId: "APP-EXPIRED",
      eventType: "rejected",
      createdAtMs: cutoff,
    });

    const changed = await redactExpiredRejectedApplications(
      { MANAGEMENT_DB: db } as ManagementEnv,
      new Date("2026-09-23T00:00:00.000Z"),
    );
    const rows = (db as unknown as D1DatabaseAdapter)
      .raw()
      .prepare(
        `SELECT id, business_name, contact_name, contact_email, contact_phone,
                address, district, city, country_code, stall_number,
                requested_subdomain, ip_address, user_agent, status,
                application_secret_hash
         FROM onboarding_applications ORDER BY id`,
      )
      .all();

    expect(changed).toBe(1);
    expect(rows[0]).toMatchObject({
      id: "APP-EXPIRED",
      business_name: "[redacted after 12-month retention]",
      contact_email: "[redacted after 12-month retention]",
      contact_phone: "[redacted after 12-month retention]",
      address: null,
      district: null,
      city: null,
      country_code: "ZZ",
      stall_number: null,
      requested_subdomain: null,
      ip_address: null,
      user_agent: null,
      status: "rejected",
      application_secret_hash: null,
    });
    expect(rows[1]).toMatchObject({
      id: "APP-PENDING",
      contact_email: "aisha@example.test",
      status: "submitted",
    });
    expect(rows[2]).toMatchObject({
      id: "APP-RECENT",
      contact_email: "recent@example.test",
      status: "rejected",
    });
    expect(
      (db as unknown as D1DatabaseAdapter)
        .raw()
        .prepare(
          "SELECT COUNT(*) AS count FROM onboarding_application_audit_events",
        )
        .get(),
    ).toMatchObject({ count: 1 });
  });

  it("fails the scheduled run when the archive bucket is not bound", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await expect(
      worker.scheduled(
        {} as ScheduledController,
        { MANAGEMENT_DB: createManagementDb() } as ManagementEnv,
      ),
    ).rejects.toThrow("AUDIT_ARCHIVE R2 binding is not configured");
    expect(consoleError).toHaveBeenCalledWith(
      "[AuditArchive] onboarding audit snapshot failed:",
      expect.any(Error),
    );
  });

  it("returns selected audit events in stable chronological order", async () => {
    const db = createManagementDb();
    await seed(db);
    const service = new OnboardingService({
      MANAGEMENT_DB: db,
    } as ManagementEnv);

    const result = await service.listApplicationAuditEvents("APP-2");
    expect(result.found).toBe(true);
    expect(result.events).toEqual([
      expect.objectContaining({
        id: "evt-1",
        eventType: "submitted",
        createdAtMs: 1_789_000_000_000,
      }),
      expect.objectContaining({
        id: "evt-2",
        eventType: "rejected",
        actorEmail: "ops@example.test",
        metadata: { reason: "Duplicate stall" },
        createdAtMs: 1_790_000_000_000,
      }),
    ]);
    await expect(
      service.listApplicationAuditEvents("missing"),
    ).resolves.toEqual({
      found: false,
      events: [],
    });
  });

  it("prevents audit event updates and deletions at the database layer", async () => {
    const db = createManagementDb();
    await seed(db);
    const sqlite = (db as unknown as D1DatabaseAdapter).raw();

    expect(() =>
      sqlite
        .prepare(
          `UPDATE onboarding_application_audit_events
           SET event_type = 'edited' WHERE id = ?`,
        )
        .run("evt-2"),
    ).toThrow("onboarding audit events are append-only");
    expect(() =>
      sqlite
        .prepare("DELETE FROM onboarding_application_audit_events WHERE id = ?")
        .run("evt-2"),
    ).toThrow("onboarding audit events are append-only");
  });

  it("backfills old submissions and completed approvals without inventing actors", async () => {
    const db = createManagementDb("0016");
    const orm = drizzle(db);
    await orm.insert(onboardingApplications).values([
      buildApplication({
        id: "APP-OLD-REJECTED",
        status: "rejected",
        submittedAt: "2025-01-02T03:04:05.000Z",
      }),
      buildApplication({
        id: "APP-OLD-APPROVED",
        status: "completed",
        submittedAt: "2025-02-02T03:04:05.000Z",
        completedAt: "2025-02-03T04:05:06.000Z",
      }),
    ]);

    const migration = fs.readFileSync(
      path.join(migrationsDir, "0016_backfill_onboarding_audit_events.sql"),
      "utf8",
    );
    (db as unknown as D1DatabaseAdapter).raw().exec(migration);

    const events = (db as unknown as D1DatabaseAdapter)
      .raw()
      .prepare(
        `SELECT application_id, event_type, actor_id, actor_email, metadata,
                created_at_ms
         FROM onboarding_application_audit_events
         ORDER BY application_id, event_type`,
      )
      .all();
    expect(events).toEqual([
      {
        application_id: "APP-OLD-APPROVED",
        event_type: "approved",
        actor_id: null,
        actor_email: null,
        metadata: JSON.stringify({ source: "backfill", actor: "unknown" }),
        created_at_ms: Date.parse("2025-02-03T04:05:06.000Z"),
      },
      {
        application_id: "APP-OLD-APPROVED",
        event_type: "submitted",
        actor_id: null,
        actor_email: null,
        metadata: JSON.stringify({ source: "backfill" }),
        created_at_ms: Date.parse("2025-02-02T03:04:05.000Z"),
      },
      {
        application_id: "APP-OLD-REJECTED",
        event_type: "submitted",
        actor_id: null,
        actor_email: null,
        metadata: JSON.stringify({ source: "backfill" }),
        created_at_ms: Date.parse("2025-01-02T03:04:05.000Z"),
      },
    ]);
  });

  it("backfills a rejected application's retention start from its last update", async () => {
    const db = createManagementDb("0017");
    await drizzle(db)
      .insert(onboardingApplications)
      .values(
        buildApplication({
          id: "APP-LEGACY-REJECTED",
          status: "rejected",
          rejectedAtMs: null,
          updatedAt: "2024-03-04T05:06:07.000Z",
        }),
      );
    const migration = fs.readFileSync(
      path.join(migrationsDir, "0017_backfill_onboarding_rejection_times.sql"),
      "utf8",
    );

    (db as unknown as D1DatabaseAdapter).raw().exec(migration);

    expect(
      (db as unknown as D1DatabaseAdapter)
        .raw()
        .prepare(
          "SELECT rejected_at_ms FROM onboarding_applications WHERE id = ?",
        )
        .get("APP-LEGACY-REJECTED"),
    ).toEqual({ rejected_at_ms: Date.parse("2024-03-04T05:06:07.000Z") });
  });
});
