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
import { archiveOnboardingAudit } from "../services/onboardingAuditArchive";
import { OnboardingService } from "../services/OnboardingService";
import type { ManagementEnv } from "../types";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

function createManagementDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF");
  for (const file of fs.readdirSync(migrationsDir).sort()) {
    if (file.endsWith(".sql")) {
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
  return { put: vi.fn(async () => ({}) as R2Object) };
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
      contactEmail: "aisha@example.test",
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
});
