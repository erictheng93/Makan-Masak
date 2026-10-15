import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const db = {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
  };

  return { db };
});

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => mocks.db),
}));

import {
  backupAlerts,
  backupAuditLogs,
  backupConfigurations,
  backupRecords,
  restoreOperations,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { BackupService } from "./BackupService";
import type {
  BackupRecord,
  ListBackupsQuery,
} from "@makanmasak/shared-types";
import type { BackupStorageService } from "./BackupStorageService";
import type { BackupConfigService } from "./BackupConfigService";
import type { BackupValidationService } from "./BackupValidationService";

/** The metadata block a record carries before any manifest is written. */
function emptyBackupMetadata(): BackupRecord["metadata"] {
  return {
    tables_info: [],
    performance_metrics: {
      backup_duration_ms: 0,
      compression_ratio: 0,
      upload_speed_mbps: 0,
    },
    database_snapshot: {
      version: "1",
      schema_hash: "hash",
      total_tables: 0,
      total_records: 0,
    },
  };
}

/**
 * The list route reads sort_by straight off the query string, so a value
 * outside the union really can reach the service — that is what its identifier
 * guard is for.
 */
function untypedSortBy(value: string): ListBackupsQuery["sort_by"] {
  return value as ListBackupsQuery["sort_by"];
}

function buildBackupRecord(
  overrides: Partial<BackupRecord> = {},
): BackupRecord {
  return {
    id: "backup-1",
    restaurant_id: "restaurant-1",
    configuration_id: "config-1",
    name: "backup",
    backup_type: "full",
    status: "completed",
    file_size: 0,
    compressed_size: 0,
    records_count: 0,
    tables_included: [],
    storage_provider: "r2",
    storage_path: "backups/backup-1.json",
    encryption_enabled: false,
    compression_enabled: false,
    checksum: "",
    started_at: "2026-06-07T00:00:00.000Z",
    created_by: "user-1",
    metadata: emptyBackupMetadata(),
    ...overrides,
  };
}

function createService(
  d1: D1Database = {} as D1Database,
  encryptionKey?: string,
) {
  const storageService = {
    generateDownloadResponse: vi.fn(),
    deleteBackup: vi.fn(),
    backupExists: vi.fn(),
    retrieveBackup: vi.fn(),
    storeBackup: vi.fn(),
    // Default pass-through: no compression/encryption transform applied.
    processDataForStorage: vi.fn(
      async (data: string, _c?: boolean, _e?: boolean, _k?: string) => ({
        processedData: data,
        originalSize: data.length,
        processedSize: data.length,
      }),
    ),
    processDataFromStorage: vi.fn(async (data: string) => data),
  };
  const configService = {
    getConfigurationById: vi.fn(),
    getDefaultConfiguration: vi.fn(),
  };
  const validationService = {
    validateCreateBackupRequest: vi.fn(),
    checkBackupLimits: vi.fn(),
    checkStorageQuota: vi.fn(),
    validateTableNames: vi.fn(),
    validateRestoreRequest: vi.fn(),
  };
  const service = new BackupService(
    d1,
    storageService as unknown as BackupStorageService,
    configService as unknown as BackupConfigService,
    validationService as unknown as BackupValidationService,
    encryptionKey,
  );

  return { service, storageService, configService, validationService };
}

/**
 * Select fixtures are keyed by table, not by call order: `from(table)` decides
 * which queue a query draws from, so adding a query against one table can no
 * longer shift another table's results out from under it.
 *
 * Two things still need care when the code under test grows a new query:
 *
 * - Within a single table the queue is positional. The Nth read of a table
 *   takes that table's Nth fixture, so a new query means inserting a fixture
 *   at the matching index rather than appending one at the end.
 * - A table has to be listed in `fixtureTables` before it can be declared. An
 *   unregistered table matches no queue, so every read of it throws.
 *
 * Missing and exhausted fixtures both throw and name the table. Nothing falls
 * back to `[]`; a silent empty result is what made the previous positional
 * queue so hard to trace back to its cause.
 *
 * Every public method on `BackupService` wraps its body in try/catch and
 * rethrows a wrapped `Error` (e.g. "Failed to list backups: <message>"). A
 * harness throw from a missing/exhausted fixture therefore never surfaces
 * verbatim from `rejects.toThrow()` on those methods — it comes back wrapped
 * in that method's own error message, so match on the wrapper text (as the
 * existing "wraps ... failures" tests already do) rather than the raw
 * "Missing/No select fixtures..." string. The regression test below calls
 * `mocks.db.select().from(table)` directly, bypassing the service, so it
 * still sees the raw message.
 *
 * `backupAuditLogs` is written to (via `createAuditLog`) but never selected
 * from, so it deliberately stays out of `fixtureTables` — it is the
 * unregistered-table case exercised by the regression test below.
 */
const fixtureTables = {
  backupRecords,
  backupConfigurations,
  backupAlerts,
  restoreOperations,
};
type SelectFixtureName = keyof typeof fixtureTables;


function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName> = {}) {
  const fixtureDb = createSelectFixtureDb(fixtureTables, fixtures);
  mocks.db.select.mockImplementation(fixtureDb.select);
}

function mockMutations() {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const deleted: unknown[] = [];

  mocks.db.insert.mockImplementation(() => ({
    values: vi.fn(async (payload: unknown) => {
      inserted.push(payload);
      return payload;
    }),
  }));
  mocks.db.update.mockImplementation(() => {
    const builder = {
      set: vi.fn((payload: unknown) => {
        updated.push(payload);
        return builder;
      }),
      where: vi.fn(async () => undefined),
    };
    return builder;
  });
  mocks.db.delete.mockImplementation((table: unknown) => ({
    where: vi.fn(async () => {
      deleted.push(table);
    }),
  }));

  return { inserted, updated, deleted };
}

function createD1Mock(
  handlers: Record<
    string,
    Array<Record<string, unknown>> | ((values: unknown[]) => Array<Record<string, unknown>>)
  > = {},
) {
  const calls: Array<{ statement: string; values: unknown[]; kind: string }> =
    [];
  return {
    calls,
    d1: {
      prepare: vi.fn((statement: string) => {
        const prepared = {
          bind: vi.fn((...values: unknown[]) => ({
            all: vi.fn(async () => {
              calls.push({ statement, values, kind: "all" });
              const handler = Object.entries(handlers).find(([pattern]) =>
                statement.includes(pattern),
              )?.[1];
              const results =
                typeof handler === "function"
                  ? handler(values)
                  : handler ?? [];
              return { results };
            }),
            run: vi.fn(async () => {
              calls.push({ statement, values, kind: "run" });
              return { meta: { changes: 1 } };
            }),
          })),
          all: vi.fn(async () => {
            calls.push({ statement, values: [], kind: "all" });
            const handler = Object.entries(handlers).find(([pattern]) =>
              statement.includes(pattern),
            )?.[1];
            const results =
              typeof handler === "function" ? handler([]) : handler ?? [];
            return { results };
          }),
          run: vi.fn(async () => {
            calls.push({ statement, values: [], kind: "run" });
            return { meta: { changes: 1 } };
          }),
        };
        return prepared;
      }),
    } as unknown as D1Database,
  };
}

describe("BackupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.db.insert.mockReset();
    mocks.db.update.mockReset();
    mocks.db.delete.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes select fixtures by table and reports missing fixtures", async () => {
    mockSelectResults({
      backupRecords: [[{ id: "backup-1" }]],
      backupAlerts: [[{ id: "alert-1" }]],
    });

    // backupAlerts is declared after backupRecords but read first: routing
    // follows the table passed to from(), not declaration order.
    await expect(mocks.db.select().from(backupAlerts)).resolves.toEqual([
      { id: "alert-1" },
    ]);
    await expect(mocks.db.select().from(backupRecords)).resolves.toEqual([
      { id: "backup-1" },
    ]);
    await expect(mocks.db.select().from(backupRecords)).rejects.toThrow(
      "No select fixtures remaining for backupRecords",
    );
    // backupAuditLogs is written to but never selected from, so it is
    // deliberately absent from fixtureTables — an unregistered table can
    // never match a fixture.
    await expect(mocks.db.select().from(backupAuditLogs)).rejects.toThrow(
      "Missing select fixture for <unknown table>",
    );
  });

  it("normalizes backup records from camel and snake case database rows", () => {
    const { service } = createService();

    expect(
      service["parseBackupRecord"]({
        id: "backup-1",
        restaurantId: "restaurant-1",
        configuration_id: "config-1",
        backupType: "full",
        fileSize: 1000,
        compressed_size: 500,
        recordsCount: 20,
        tablesIncluded: ["orders"],
        storageProvider: "r2",
        storage_path: "backups/backup-1.json",
        encryptionEnabled: 1,
        startedAt: "2026-06-07T00:00:00.000Z",
        completed_at: "2026-06-07T00:01:00.000Z",
        errorMessage: null,
        created_by: "user-1",
      }),
    ).toMatchObject({
      id: "backup-1",
      restaurant_id: "restaurant-1",
      configuration_id: "config-1",
      backup_type: "full",
      file_size: 1000,
      compressed_size: 500,
      records_count: 20,
      tables_included: ["orders"],
      storage_provider: "r2",
      storage_path: "backups/backup-1.json",
      encryption_enabled: true,
      started_at: "2026-06-07T00:00:00.000Z",
      completed_at: "2026-06-07T00:01:00.000Z",
      created_by: "user-1",
      metadata: {},
    });
  });

  it("derives manifests from metadata or backup payload row counts", () => {
    const { service } = createService();
    const backup = buildBackupRecord({
      tables_included: ["orders", "payments"],
      completed_at: "2026-06-07T00:01:00.000Z",
      checksum: "backup-checksum",
    });

    expect(
      service["getManifestFromBackup"](
        {
          ...backup,
          metadata: {
            ...emptyBackupMetadata(),
            manifest: {
              row_counts: { orders: 2 },
              tables: ["orders"],
              created_at: "2026-06-07T00:00:00.000Z",
              checksum: "manifest-checksum",
            },
          },
        },
        { orders: [{ id: 1 }], payments: [{ id: 2 }] },
      ),
    ).toEqual({
      rowCounts: { orders: 2 },
      tables: ["orders"],
      createdAt: "2026-06-07T00:00:00.000Z",
      checksum: "manifest-checksum",
    });
    expect(
      service["getManifestFromBackup"](
        buildBackupRecord({ ...backup, metadata: emptyBackupMetadata() }),
        { orders: [{ id: 1 }, { id: 2 }], payments: [] },
      ),
    ).toEqual({
      rowCounts: { orders: 2, payments: 0 },
      tables: ["orders", "payments"],
      createdAt: "2026-06-07T00:01:00.000Z",
      checksum: "backup-checksum",
    });
  });

  it("parses alert details, titles, summaries, and optional fields", () => {
    const { service } = createService();

    expect(
      service["parseBackupAlerts"]([
        {
          id: "alert-1",
          restaurantId: "restaurant-1",
          alertType: "backup_failed",
          severity: "critical",
          message: "Backup failed",
          details: JSON.stringify({
            title: "Custom failure",
            related_backup_id: "backup-1",
          }),
          triggeredAt: "2026-06-07T00:00:00.000Z",
          acknowledged: 1,
          acknowledgedBy: "user-1",
          resolved: 0,
        },
        {
          id: "alert-2",
          restaurant_id: "restaurant-1",
          alert_type: "storage_quota_exceeded",
          severity: "high",
          message: "Quota exceeded",
          details: "not json",
          triggered_at: "2026-06-07T01:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        id: "alert-1",
        restaurant_id: "restaurant-1",
        alert_type: "backup_failed",
        severity: "critical",
        title: "Custom failure",
        message: "Backup failed",
        related_backup_id: "backup-1",
        triggered_at: "2026-06-07T00:00:00.000Z",
        acknowledged: true,
        acknowledged_by: "user-1",
        acknowledged_at: undefined,
        resolved: false,
        resolved_at: undefined,
      },
      {
        id: "alert-2",
        restaurant_id: "restaurant-1",
        alert_type: "storage_quota_exceeded",
        severity: "high",
        title: "Storage Quota Exceeded",
        message: "Quota exceeded",
        related_backup_id: undefined,
        triggered_at: "2026-06-07T01:00:00.000Z",
        acknowledged: false,
        acknowledged_by: undefined,
        acknowledged_at: undefined,
        resolved: false,
        resolved_at: undefined,
      },
    ]);
    expect(
      service["buildAlertSummary"]([
        { severity: "critical", total: 2 },
        { severity: "high" },
        { severity: "unknown", total: 10 },
      ]),
    ).toEqual({ critical: 2, high: 1, medium: 0, low: 0 });
  });

  it("guards SQL identifiers and converts values for D1 bindings", () => {
    const { service } = createService();

    expect(() =>
      service["assertSafeIdentifier"]("orders_2026"),
    ).not.toThrow();
    expect(() => service["assertSafeIdentifier"]("orders;drop")).toThrow(
      "Unsafe SQL identifier: orders;drop",
    );
    expect(service["resolvePhysicalTableName"]("menus")).toBe(
      "menu_items",
    );
    expect(service["resolvePhysicalTableName"]("orders")).toBe("orders");
    expect(service["toD1Value"](undefined)).toBeNull();
    expect(service["toD1Value"](false)).toBe(0);
    expect(service["toD1Value"](true)).toBe(1);
    expect(service["toD1Value"](42)).toBe(42);
    expect(service["toD1Value"]({ nested: true })).toBe(
      JSON.stringify({ nested: true }),
    );
  });

  it("downloads backups through storage and wraps storage failures", async () => {
    const { service, storageService } = createService();
    const response = new Response("backup data");
    storageService.generateDownloadResponse.mockResolvedValue(response);

    await expect(service.downloadBackup(buildBackupRecord())).resolves
      .toBe(response);

    storageService.generateDownloadResponse.mockRejectedValue(
      new Error("storage offline"),
    );
    await expect(service.downloadBackup(buildBackupRecord())).rejects
      .toThrow("Failed to download backup");
  });

  it("writes audit logs with request context fallbacks", async () => {
    const { service } = createService();
    const values = vi.fn();
    mocks.db.insert.mockReturnValue({ values });
    service.setRequestContext({
      ipAddress: "203.0.113.10",
      userAgent: "Vitest",
    });

    await service["createAuditLog"]({
      restaurant_id: "restaurant-1",
      action: "backup_deleted",
      details: { backup_id: "backup-1" },
      performed_by: "user-1",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        action: "backup_deleted",
        details: { backup_id: "backup-1" },
        performedBy: "user-1",
        ipAddress: "203.0.113.10",
        userAgent: "Vitest",
        timestamp: expect.any(Date),
      }),
    );
  });

  it("lists and fetches backups with parsed records and total counts", async () => {
    const { service } = createService();
    const backupRow = {
      id: "backup-1",
      restaurantId: "restaurant-1",
      configurationId: "config-1",
      backupType: "full",
      status: "completed",
      fileSize: 2048,
      compressedSize: 1024,
      recordsCount: 12,
      tablesIncluded: ["orders"],
      storageProvider: "r2",
      storagePath: "backups/backup-1.json",
      encryptionEnabled: true,
      startedAt: "2026-06-07T00:00:00.000Z",
      completedAt: "2026-06-07T00:01:00.000Z",
      createdBy: "user-1",
      metadata: { manifest: { tables: ["orders"] } },
    };
    mockSelectResults({
      backupRecords: [[backupRow], [{ total: 1 }], [backupRow]],
    });

    await expect(
      service.listBackups({
        restaurant_id: "restaurant-1",
        status: "completed",
        backup_type: "full",
        date_from: "2026-06-01T00:00:00.000Z",
        date_to: "2026-06-08T00:00:00.000Z",
        page: 2,
        limit: 5,
        sort_by: "file_size",
        sort_order: "asc",
      }),
    ).resolves.toMatchObject({
      total: 1,
      backups: [
        {
          id: "backup-1",
          restaurant_id: "restaurant-1",
          backup_type: "full",
          file_size: 2048,
          storage_path: "backups/backup-1.json",
        },
      ],
    });
    await expect(service.getBackupById("backup-1")).resolves.toMatchObject({
      id: "backup-1",
      restaurant_id: "restaurant-1",
    });
    expect(mocks.db.select).toHaveBeenCalledTimes(3);
  });

  it("deletes backups from storage, database, and audit log", async () => {
    const { service, storageService } = createService();
    const mutations = mockMutations();
    mockSelectResults({
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            name: "Nightly backup",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
          },
        ],
      ],
    });

    await expect(service.deleteBackup("backup-1", "user-1")).resolves
      .toBeUndefined();
    expect(storageService.deleteBackup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "backup-1", restaurant_id: "restaurant-1" }),
    );
    expect(mutations.deleted).toHaveLength(1);
    expect(mutations.inserted[0]).toMatchObject({
      restaurantId: "restaurant-1",
      action: "backup_deleted",
      performedBy: "user-1",
      details: {
        backup_id: "backup-1",
        backup_name: "Nightly backup",
      },
    });
  });

  it("reports system health and restaurant metrics from aggregate rows", async () => {
    const { service } = createService();
    mockSelectResults({
      backupRecords: [
        [
          {
            totalRestaurants: 3,
            totalBackups: 20,
            runningBackups: 2,
            failedBackups24h: 6,
            avgSize: 2048,
            avgDurationMs: 180000,
            avgCompressionRatio: 2.5,
          },
        ],
        [{ totalBytes: 4096, totalFiles: 2 }],
        [
          {
            total_backups: 5,
            successful_backups: 4,
            failed_backups: 1,
            avg_backup_size: 1024,
            total_storage_used: 5120,
          },
        ],
      ],
      backupConfigurations: [[{ total: 4 }]],
      backupAlerts: [[{ severity: "critical" }, { severity: "high" }]],
    });

    await expect(service.getSystemHealth()).resolves.toEqual({
      overall_status: "warning",
      total_restaurants: 3,
      active_configurations: 4,
      running_backups: 2,
      failed_backups_24h: 6,
      storage_usage: {
        total_bytes: 4096,
        available_bytes: 0,
        usage_percentage: 0,
      },
      performance_metrics: {
        average_backup_duration_minutes: 3,
        average_success_rate_percentage: 70,
        average_compression_ratio: 2.5,
      },
      alerts_summary: { critical: 1, high: 1, medium: 0, low: 0 },
    });
    await expect(
      service.getRestaurantMetrics("restaurant-1", "month"),
    ).resolves.toEqual({
      total_backups: 5,
      successful_backups: 4,
      failed_backups: 1,
      avg_backup_size: 1024,
      total_storage_used: 5120,
    });
  });

  it("lists, acknowledges, and resolves backup alerts with audit records", async () => {
    const { service } = createService();
    const mutations = mockMutations();
    const alertRow = {
      id: "alert-1",
      restaurantId: "restaurant-1",
      alertType: "backup_failed",
      severity: "critical",
      message: "Backup failed",
      details: { title: "Failed backup", related_backup_id: "backup-1" },
      triggeredAt: "2026-06-07T00:00:00.000Z",
      acknowledged: false,
      resolved: false,
    };
    mockSelectResults({
      backupAlerts: [[alertRow], [alertRow], [alertRow], [alertRow]],
    });

    await expect(
      service.getRestaurantAlerts("restaurant-1", true),
    ).resolves.toMatchObject([
      {
        id: "alert-1",
        title: "Failed backup",
        related_backup_id: "backup-1",
      },
    ]);
    await expect(service.getAlertById("alert-1")).resolves.toMatchObject({
      id: "alert-1",
      restaurant_id: "restaurant-1",
    });
    await expect(service.acknowledgeAlert("alert-1", "user-1")).resolves
      .toMatchObject({
        id: "alert-1",
        acknowledged: true,
        acknowledged_by: "user-1",
      });
    await expect(service.resolveAlert("alert-1", "user-2")).resolves
      .toMatchObject({
        id: "alert-1",
        resolved: true,
      });

    expect(mutations.updated).toEqual([
      { acknowledged: true },
      expect.objectContaining({ resolved: true }),
    ]);
    expect(mutations.inserted).toEqual([
      expect.objectContaining({
        action: "backup_alert_acknowledged",
        performedBy: "user-1",
      }),
      expect.objectContaining({
        action: "backup_alert_resolved",
        performedBy: "user-2",
      }),
    ]);
  });

  it("creates scheduled backups with configuration defaults and manifest counts", async () => {
    const mutations = mockMutations();
    const { d1 } = createD1Mock({
      "PRAGMA table_info": [{ name: "restaurant_id" }],
      "SELECT COUNT": [{ total: 3 }],
    });
    const { service, configService, validationService } = createService(d1);
    configService.getDefaultConfiguration.mockResolvedValue({
      id: "config-1",
      restaurant_id: "restaurant-1",
      backup_type: "incremental",
      include_tables: ["orders", "menus"],
      exclude_tables: ["menus"],
      storage_provider: "r2",
      encryption_enabled: true,
      compression_enabled: false,
    });

    const response = await service.createBackup(
      {
        restaurant_id: "restaurant-1",
        name: "Nightly",
        force_immediate: false,
      },
      "user-1",
    );

    expect(response).toMatchObject({
      status: "pending",
      message: "Backup has been scheduled successfully",
      manifest: {
        rowCounts: { orders: 3 },
        tables: ["orders"],
      },
    });
    expect(validationService.validateCreateBackupRequest).toHaveBeenCalled();
    expect(validationService.checkBackupLimits).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(validationService.checkStorageQuota).toHaveBeenCalledWith(
      "restaurant-1",
    );
    expect(validationService.validateTableNames).toHaveBeenCalledWith([
      "orders",
    ]);
    expect(mutations.inserted[0]).toMatchObject({
      restaurantId: "restaurant-1",
      configurationId: "config-1",
      name: "Nightly",
      backupType: "incremental",
      status: "pending",
      tablesIncluded: ["orders"],
      storageProvider: "r2",
      encryptionEnabled: true,
      createdBy: "user-1",
      metadata: {
        manifest: expect.objectContaining({
          rowCounts: { orders: 3 },
          tables: ["orders"],
        }),
      },
    });
  });

  it("creates immediate backups by extracting scoped table data and storing the payload", async () => {
    const mutations = mockMutations();
    const { d1, calls } = createD1Mock({
      "PRAGMA table_info": [{ name: "restaurant_id" }, { name: "id" }],
      "SELECT COUNT": [{ total: 2 }],
      "SELECT *": [
        { id: 1, restaurant_id: "restaurant-1", total: 120 },
        { id: 2, restaurant_id: "restaurant-1", total: 80 },
      ],
    });
    const { service, configService, storageService } = createService(d1);
    configService.getConfigurationById.mockResolvedValue({
      id: "config-1",
      restaurant_id: "restaurant-1",
      backup_type: "full",
      include_tables: ["orders"],
      exclude_tables: [],
      storage_provider: "r2",
      encryption_enabled: false,
      compression_enabled: false,
    });
    storageService.storeBackup.mockResolvedValue({
      storage_path: "backups/backup.json",
      checksum: "checksum-1",
    });

    const response = await service.createBackup(
      {
        restaurant_id: "restaurant-1",
        configuration_id: "config-1",
        name: "Immediate",
        backup_type: "full",
        include_tables: ["orders"],
        force_immediate: true,
      },
      "user-1",
    );

    expect(response).toMatchObject({
      status: "completed",
      message: "Backup completed successfully",
      checksum: "checksum-1",
      manifest: {
        rowCounts: { orders: 2 },
        tables: ["orders"],
      },
    });
    expect(storageService.storeBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        id: response.backup_id,
        restaurant_id: "restaurant-1",
        tables_included: ["orders"],
      }),
      expect.stringContaining('"total": 120'),
      "r2",
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: expect.stringContaining('SELECT * FROM "orders"'),
          values: ["restaurant-1"],
        }),
        expect.objectContaining({
          statement: expect.stringContaining(
            'SELECT COUNT(*) as total FROM "orders"',
          ),
          values: ["restaurant-1"],
        }),
      ]),
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "in_progress" }),
        expect.objectContaining({
          status: "completed",
          storagePath: "backups/backup.json",
          checksum: "checksum-1",
          recordsCount: 2,
        }),
      ]),
    );
    expect(mutations.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "pending" }),
        expect.objectContaining({
          action: "backup_created",
          performedBy: "user-1",
          details: expect.objectContaining({
            records_count: 2,
            tables_count: 1,
          }),
        }),
      ]),
    );
  });

  it("restores completed backups selectively after integrity and schema checks", async () => {
    const mutations = mockMutations();
    const backupData = JSON.stringify({
      orders: [{ id: 1, restaurant_id: "restaurant-1", total: 120 }],
    });
    const { d1 } = createD1Mock({
      "PRAGMA table_info": [
        { name: "id" },
        { name: "restaurant_id" },
        { name: "total" },
      ],
    });
    const { service, storageService, validationService } = createService(d1);
    mockSelectResults({
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
            checksum: "",
            completedAt: "2026-06-07T00:01:00.000Z",
            metadata: {
              manifest: {
                row_counts: { orders: 1 },
                tables: ["orders"],
                created_at: "2026-06-07T00:01:00.000Z",
              },
            },
          },
        ],
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
            checksum: "",
            completedAt: "2026-06-07T00:01:00.000Z",
            metadata: {
              manifest: {
                row_counts: { orders: 1 },
                tables: ["orders"],
                created_at: "2026-06-07T00:01:00.000Z",
              },
            },
          },
        ],
      ],
      restoreOperations: [
        [
          {
            id: "restore-1",
            restaurantId: "restaurant-1",
            backupId: "backup-1",
            restoreType: "selective",
            targetTables: ["orders"],
            overwriteExisting: false,
            performedBy: "user-1",
          },
        ],
      ],
    });
    storageService.backupExists.mockResolvedValue(true);
    storageService.retrieveBackup.mockResolvedValue(backupData);

    const result = await service.restoreFromBackup(
      {
        restaurant_id: "restaurant-1",
        backup_id: "backup-1",
        restore_type: "selective" as const,
        target_tables: ["orders"],
        overwrite_existing: false,
        safety_confirmation: {
          backup_integrity_verified: true,
          data_loss_risk_acknowledged: true,
          confirmation_phrase: "I understand the risks",
        },
      },
      "user-1",
    );

    expect(result).toMatchObject({
      restore_id: expect.any(String),
      checksum: "",
      rowCounts: { orders: 1 },
    });
    expect(validationService.validateRestoreRequest).toHaveBeenCalled();
    expect(validationService.validateTableNames).toHaveBeenCalledWith([
      "orders",
    ]);
    expect(storageService.retrieveBackup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "backup-1" }),
    );
    expect(mutations.inserted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          restaurantId: "restaurant-1",
          backupId: "backup-1",
          status: "pending",
          targetTables: ["orders"],
          performedBy: "user-1",
        }),
        expect.objectContaining({
          action: "backup_restored",
          performedBy: "user-1",
          details: expect.objectContaining({
            backup_id: "backup-1",
            tables_restored: 1,
            records_restored: 1,
          }),
        }),
      ]),
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "in_progress" }),
        expect.objectContaining({
          status: "completed",
          tablesRestored: 1,
          recordsRestored: 1,
        }),
      ]),
    );
  });

  it("wraps create backup failures when configuration is missing or mismatched", async () => {
    mockMutations();
    const { service, configService } = createService();

    configService.getDefaultConfiguration.mockResolvedValueOnce(null);
    await expect(
      service.createBackup(
        { restaurant_id: "restaurant-1", name: "Missing config" },
        "user-1",
      ),
    ).rejects.toThrow(
      "Failed to create backup: Backup configuration not found",
    );

    configService.getConfigurationById.mockResolvedValueOnce({
      id: "config-2",
      restaurant_id: "restaurant-2",
      include_tables: ["orders"],
      exclude_tables: [],
      backup_type: "full",
      storage_provider: "r2",
      encryption_enabled: false,
      compression_enabled: false,
    });
    await expect(
      service.createBackup(
        {
          restaurant_id: "restaurant-1",
          configuration_id: "config-2",
          name: "Wrong config",
        },
        "user-1",
      ),
    ).rejects.toThrow(
      "Failed to create backup: Backup configuration not found",
    );
  });

  it("marks backups failed when execution cannot load or store a backup", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService();

    mockSelectResults({ backupRecords: [[]] });
    await expect(service.executeBackup("missing-backup")).rejects.toThrow(
      "Backup record not found",
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "in_progress" }),
        expect.objectContaining({ status: "failed" }),
        expect.objectContaining({ errorMessage: "Backup record not found" }),
      ]),
    );

    mutations.updated.length = 0;
    storageService.storeBackup.mockRejectedValueOnce(new Error("r2 down"));
    await expect(
      service.executeBackup(
        "backup-1",
        buildBackupRecord({
          tables_included: [],
          started_at: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow("r2 down");
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
        expect.objectContaining({ errorMessage: "r2 down" }),
      ]),
    );
  });

  it("covers low-level table scoping, prepared queries, schema validation, and restore inserts", async () => {
    const { d1, calls } = createD1Mock({
      "PRAGMA table_info": (values) => {
        const statement = calls.at(-1)?.statement ?? "";
        if (statement.includes('"restaurants"')) return [{ name: "public_id" }];
        if (statement.includes('"missing"')) return [];
        if (statement.includes('"orders"')) {
          return [{ name: "id" }, { name: "restaurant_id" }, { name: "total" }];
        }
        return [];
      },
      "SELECT *": [{ id: 1, restaurant_id: "restaurant-1" }],
      "SELECT COUNT": [{ total: 4 }],
    });
    const { service } = createService(d1);

    await expect(
      service["getRestaurantScopeClause"]("restaurants", "public-1"),
    ).resolves.toEqual({ clause: "public_id = ?", values: ["public-1"] });
    await expect(
      service["getRestaurantScopeClause"]("missing", "restaurant-1"),
    ).resolves.toBeNull();
    await expect(
      service["extractTableData"]("restaurant-1", "orders"),
    ).resolves.toEqual([{ id: 1, restaurant_id: "restaurant-1" }]);
    await expect(
      service["countTableRows"]("restaurant-1", "orders"),
    ).resolves.toBe(4);

    await expect(
      service["validateRestoreSchemaCompatibility"](
        ["orders"],
        { orders: [{ id: 1, missing_column: true }] },
      ),
    ).rejects.toThrow("Restore schema mismatch for orders: missing_column");

    const inserted = await service["restoreTableData"]({
      tableName: "orders",
      restaurantId: "restaurant-1",
      rows: [
        { id: 1, restaurant_id: "restaurant-1", total: 12, ignored: undefined },
        {},
      ],
      overwriteExisting: true,
    });
    expect(inserted).toBe(1);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: 'DELETE FROM "orders" WHERE restaurant_id = ?',
          values: ["restaurant-1"],
          kind: "run",
        }),
        expect.objectContaining({
          statement:
            'INSERT INTO "orders" ("id", "restaurant_id", "total") VALUES (?, ?, ?)',
          values: [1, "restaurant-1", 12],
          kind: "run",
        }),
      ]),
    );

    const noPrepare = createService({} as D1Database).service;
    await expect(
      noPrepare["runPreparedAll"]("SELECT 1"),
    ).resolves.toEqual([]);
  });

  it("wraps list, delete, metrics, health, and alert failures", async () => {
    const { service } = createService();
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error("select down");
    });
    await expect(
      service.listBackups({ restaurant_id: "restaurant-1" }),
    ).rejects.toThrow("Failed to list backups: select down");

    mockSelectResults({ backupRecords: [[]] });
    await expect(service.deleteBackup("missing", "user-1")).rejects.toThrow(
      "Failed to delete backup: Backup not found",
    );

    mocks.db.select.mockImplementationOnce(() => {
      throw new Error("health down");
    });
    await expect(service.getSystemHealth()).rejects.toThrow(
      "Failed to get system health",
    );

    mocks.db.select.mockImplementationOnce(() => {
      throw new Error("metrics down");
    });
    await expect(
      service.getRestaurantMetrics("restaurant-1", "week"),
    ).rejects.toThrow("Failed to get restaurant metrics");

    mocks.db.select.mockImplementationOnce(() => {
      throw new Error("alerts down");
    });
    await expect(
      service.getRestaurantAlerts("restaurant-1"),
    ).rejects.toThrow("Failed to get restaurant alerts");

    mocks.db.select.mockImplementationOnce(() => {
      throw new Error("alert down");
    });
    await expect(service.getAlertById("alert-1")).rejects.toThrow(
      "Failed to get backup alert",
    );

    mockSelectResults({ backupAlerts: [[]] });
    await expect(service.acknowledgeAlert("missing", "user-1")).rejects.toThrow(
      "Failed to acknowledge backup alert: Alert not found",
    );
    mockSelectResults({ backupAlerts: [[]] });
    await expect(service.resolveAlert("missing", "user-1")).rejects.toThrow(
      "Failed to resolve backup alert: Alert not found",
    );
  });

  it("returns critical and default health/metric states from aggregate edge rows", async () => {
    const { service } = createService();
    mockSelectResults({
      backupRecords: [
        [
          {
            totalRestaurants: 0,
            totalBackups: 0,
            runningBackups: 0,
            failedBackups24h: 11,
            avgSize: 0,
            avgDurationMs: 0,
            avgCompressionRatio: null,
          },
        ],
        [{}],
        [],
      ],
      backupConfigurations: [[]],
      backupAlerts: [[{ severity: "low", total: 3 }]],
    });

    await expect(service.getSystemHealth()).resolves.toMatchObject({
      overall_status: "critical",
      active_configurations: 0,
      storage_usage: { total_bytes: 0 },
      performance_metrics: {
        average_success_rate_percentage: 100,
        average_compression_ratio: 1,
      },
      alerts_summary: { critical: 0, high: 0, medium: 0, low: 3 },
    });
    await expect(
      service.getRestaurantMetrics("restaurant-1", "day"),
    ).resolves.toEqual({
      total_backups: 0,
      successful_backups: 0,
      failed_backups: 0,
      avg_backup_size: 0,
      total_storage_used: 0,
    });
  });

  it("initiates background restores and logs asynchronous restore failures", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService();
    mockSelectResults({
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
            checksum: "",
          },
        ],
      ],
    });
    storageService.backupExists.mockResolvedValue(true);
    const executeRestore = vi
      .spyOn(
        service as unknown as { executeRestore: (id: string) => Promise<void> },
        "executeRestore",
      )
      .mockRejectedValue(new Error("restore worker down"));

    const operationId = await service.restoreFromBackup(
      {
        restaurant_id: "restaurant-1",
        backup_id: "backup-1",
        restore_type: "full",
        target_tables: ["orders"],
        overwrite_existing: false,
        safety_confirmation: {
          backup_integrity_verified: true,
          data_loss_risk_acknowledged: true,
          confirmation_phrase: "I understand the risks",
        },
      },
      "user-1",
    );
    await Promise.resolve();

    expect(operationId).toEqual(expect.any(String));
    expect(executeRestore).toHaveBeenCalledWith(operationId);
    expect(console.error).toHaveBeenCalledWith(
      `Background restore failed for ${operationId}:`,
      expect.any(Error),
    );
    expect(mutations.inserted[0]).toMatchObject({
      restaurantId: "restaurant-1",
      backupId: "backup-1",
      status: "pending",
      restoreType: "full",
    });
  });

  it("wraps restore initiation failures for missing, incomplete, and absent backup files", async () => {
    const { service, storageService } = createService();
    const request = {
      restaurant_id: "restaurant-1",
      backup_id: "backup-1",
      restore_type: "selective" as const,
      overwrite_existing: false,
      safety_confirmation: {
        backup_integrity_verified: true,
        data_loss_risk_acknowledged: true,
        confirmation_phrase: "I understand the risks",
      },
    };

    mockSelectResults({ backupRecords: [[]] });
    await expect(service.restoreFromBackup(request, "user-1")).rejects.toThrow(
      "Failed to initiate restore: Backup not found or access denied",
    );

    mockSelectResults({
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            status: "failed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
          },
        ],
      ],
    });
    await expect(service.restoreFromBackup(request, "user-1")).rejects.toThrow(
      "Failed to initiate restore: Cannot restore from incomplete backup",
    );

    mockSelectResults({
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
          },
        ],
      ],
    });
    storageService.backupExists.mockResolvedValueOnce(false);
    await expect(service.restoreFromBackup(request, "user-1")).rejects.toThrow(
      "Failed to initiate restore: Backup file not found in storage",
    );
  });

  it("fails restore execution on checksum mismatch and missing operation state", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService();

    mockSelectResults({ restoreOperations: [[]] });
    await expect(service["executeRestore"]("missing")).rejects.toThrow(
      "Restore operation not found",
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          errorMessage: "Restore operation not found",
        }),
      ]),
    );

    mutations.updated.length = 0;
    mockSelectResults({
      restoreOperations: [
        [
          {
            id: "restore-1",
            restaurantId: "restaurant-1",
            backupId: "backup-1",
            restoreType: "selective",
            targetTables: ["orders"],
            overwriteExisting: false,
            performedBy: "user-1",
          },
        ],
      ],
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: false,
            checksum: "not-the-real-checksum",
          },
        ],
      ],
    });
    storageService.retrieveBackup.mockResolvedValue('{"orders":[]}');

    await expect(service["executeRestore"]("restore-1")).rejects.toThrow(
      "Backup checksum verification failed",
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "failed",
          errorMessage: "Backup checksum verification failed",
        }),
      ]),
    );
  });

  it("creates pre-restore safety backups before overwrite restores", async () => {
    const { service } = createService();
    const createBackup = vi.spyOn(service, "createBackup").mockResolvedValue({
      backup_id: "safety-backup-1",
      backup: { id: "safety-backup-1" },
      status: "pending",
      estimated_duration_minutes: 5,
      message: "scheduled",
      manifest: { rowCounts: {}, tables: [], createdAt: "" },
    });
    const executeBackup = vi
      .spyOn(service, "executeBackup")
      .mockResolvedValue({
        checksum: "",
        manifest: { rowCounts: {}, tables: [], createdAt: "" },
        backup: buildBackupRecord(),
      });

    await expect(
      service["createPreRestoreSafetyBackup"]({
        restaurantId: "restaurant-1",
        targetTables: ["orders"],
        userId: "user-1",
      }),
    ).resolves.toBe("safety-backup-1");
    expect(createBackup).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurant_id: "restaurant-1",
        backup_type: "full",
        include_tables: ["orders"],
        force_immediate: false,
      }),
      "user-1",
    );
    expect(executeBackup).toHaveBeenCalledWith("safety-backup-1");
  });

  it("covers create/list/health fallback branches and low-level restore helpers", async () => {
    const mutations = mockMutations();
    const { d1, calls } = createD1Mock({
      "PRAGMA table_info": (values) => {
        const statement = calls.at(-1)?.statement ?? "";
        if (statement.includes('"restaurants"')) return [{ name: "id" }];
        if (statement.includes('"orders"')) {
          return [{ name: "id" }, { name: "restaurant_id" }, { name: "total" }];
        }
        return [];
      },
      "SELECT COUNT": [{ total: 0 }],
    });
    const { service, configService, validationService } = createService(d1);
    configService.getDefaultConfiguration.mockResolvedValue({
      id: "config-empty",
      restaurant_id: "restaurant-1",
      backup_type: "full",
      include_tables: ["menus"],
      exclude_tables: ["menus"],
      storage_provider: "r2",
      encryption_enabled: false,
      compression_enabled: false,
    });

    const scheduled = await service.createBackup(
      {
        restaurant_id: "restaurant-1",
        name: "Empty",
        force_immediate: false,
      },
      "user-1",
    );

    expect(scheduled).toMatchObject({
      status: "pending",
      estimated_duration_minutes: 5,
      manifest: { rowCounts: {}, tables: [] },
    });
    expect(validationService.validateTableNames).not.toHaveBeenCalled();
    expect(mutations.inserted[0]).toMatchObject({
      tablesIncluded: [],
      backupType: "full",
    });

    mockSelectResults({
      backupRecords: [
        [
          {
            id: "backup-1",
            restaurantId: "restaurant-1",
            backupType: "full",
            fileSize: 10,
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            startedAt: "2026-06-07T00:00:00.000Z",
          },
        ],
        [{}],
      ],
    });
    await expect(
      service.listBackups({
        restaurant_id: "restaurant-1",
        sort_by: untypedSortBy("unsafe_column"),
        sort_order: "asc",
      }),
    ).resolves.toMatchObject({
      total: 0,
      backups: [{ id: "backup-1", backup_type: "full" }],
    });

    mockSelectResults({
      backupRecords: [
        [
          {
            totalRestaurants: 2,
            totalBackups: 10,
            runningBackups: 21,
            failedBackups24h: 6,
            avgDurationMs: 120000,
            avgCompressionRatio: "2.5",
          },
        ],
        [{ totalBytes: 2048 }],
      ],
      backupConfigurations: [[{ total: 3 }]],
      backupAlerts: [[{ severity: "medium" }]],
    });
    await expect(service.getSystemHealth()).resolves.toMatchObject({
      overall_status: "warning",
      total_restaurants: 2,
      active_configurations: 3,
      running_backups: 21,
      failed_backups_24h: 6,
      storage_usage: { total_bytes: 2048 },
      performance_metrics: {
        average_backup_duration_minutes: 2,
        average_success_rate_percentage: 40,
        average_compression_ratio: 2.5,
      },
      alerts_summary: { critical: 0, high: 0, medium: 1, low: 0 },
    });

    await expect(
      service["getRestaurantScopeClause"]("restaurants", "restaurant-1"),
    ).resolves.toEqual({ clause: "id = ?", values: ["restaurant-1"] });

    const inserted = await service["restoreTableData"]({
      tableName: "orders",
      restaurantId: "restaurant-1",
      rows: [
        {
          id: 1,
          restaurant_id: "restaurant-1",
          total: 12,
          note: undefined,
        },
      ],
      overwriteExisting: false,
    });
    expect(inserted).toBe(1);
    expect(calls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement: 'DELETE FROM "orders" WHERE restaurant_id = ?',
        }),
      ]),
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statement:
            'INSERT INTO "orders" ("id", "restaurant_id", "total") VALUES (?, ?, ?)',
          values: [1, "restaurant-1", 12],
          kind: "run",
        }),
      ]),
    );
  });

  it("covers backup execution and parser fallback branches", async () => {
    const mutations = mockMutations();
    const { d1 } = createD1Mock({
      "PRAGMA table_info": [{ name: "restaurant_id" }],
      "SELECT *": [],
      "SELECT COUNT": [{ total: 0 }],
    });
    const { service, storageService } = createService(d1);

    mockSelectResults({ backupRecords: [[]] });
    await expect(service.executeBackup("missing")).rejects.toThrow(
      "Backup record not found",
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
        expect.objectContaining({ errorMessage: "Backup record not found" }),
      ]),
    );

    mutations.updated.length = 0;
    storageService.storeBackup.mockResolvedValue({
      storage_path: "backups/compressed.json",
      checksum: "checksum-compressed",
    });
    await expect(
      service.executeBackup("backup-compressed", {
        id: "backup-compressed",
        restaurant_id: "restaurant-1",
        configuration_id: "config-1",
        name: "Compressed",
        backup_type: "full",
        status: "pending",
        file_size: 0,
        compressed_size: 0,
        compression_enabled: true,
        records_count: 0,
        tables_included: ["orders"],
        storage_provider: "r2",
        storage_path: "",
        encryption_enabled: false,
        checksum: "",
        started_at: new Date().toISOString(),
        created_by: "user-1",
        metadata: emptyBackupMetadata(),
      }),
    ).resolves.toMatchObject({
      checksum: "checksum-compressed",
      manifest: { rowCounts: { orders: 0 }, tables: ["orders"] },
      backup: { status: "completed" },
    });
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "completed",
          compressedSize: expect.any(Number),
          metadata: expect.objectContaining({
            performance_metrics: expect.objectContaining({
              compression_ratio: expect.any(Number),
            }),
          }),
        }),
      ]),
    );

    await expect(
      service["getRestaurantTables"]("restaurant-1", undefined, [
        "orders",
        "users",
      ]),
    ).resolves.toEqual(["order_items", "menu_items", "categories", "tables"]);
    expect(
      service["getManifestFromBackup"](
        buildBackupRecord({
          tables_included: ["orders"],
          checksum: "",
          completed_at: undefined,
          metadata: {
            ...emptyBackupMetadata(),
            manifest: { createdAt: "2026-06-07T00:00:00.000Z" },
          },
        }),
        { orders: [{ id: 1 }] },
      ),
    ).toEqual({
      rowCounts: { orders: 1 },
      tables: ["orders"],
      createdAt: "2026-06-07T00:00:00.000Z",
      // BackupRecord.checksum is a required string, so a record with no
      // manifest checksum falls back to the record's own empty one.
      checksum: "",
    });

    mockSelectResults({
      restoreOperations: [
        [
          {
            restaurant_id: "restaurant-1",
            backup_id: "backup-1",
            restore_type: "full",
            target_tables: null,
            overwrite_existing: 0,
            performed_by: "user-1",
          },
        ],
      ],
    });
    await expect(
      service["getRestoreOperation"]("restore-1"),
    ).resolves.toMatchObject({
      restaurantId: "restaurant-1",
      backupId: "backup-1",
      restoreType: "full",
      targetTables: [],
      overwriteExisting: false,
      performedBy: "user-1",
    });

    expect(
      service["parseBackupAlerts"]([
        {
          id: "alert-1",
          restaurantId: "restaurant-1",
          message: undefined,
          title: "Explicit title",
          relatedBackupId: "backup-1",
          acknowledgedAt: "2026-06-07T01:00:00.000Z",
          resolvedAt: "2026-06-07T02:00:00.000Z",
          details: { ignored: true },
        },
        {
          id: "alert-2",
          restaurant_id: "restaurant-1",
          alert_type: undefined,
          severity: undefined,
          details: "",
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        title: "Explicit title",
        message: "",
        related_backup_id: "backup-1",
        acknowledged_at: "2026-06-07T01:00:00.000Z",
        resolved_at: "2026-06-07T02:00:00.000Z",
      }),
      expect.objectContaining({
        alert_type: "backup_failed",
        severity: "medium",
        title: "Backup Failed",
      }),
    ]);
  });
});

describe("BackupService compression/encryption wiring (#20)", () => {
  function encBackupOverride(overrides: Partial<BackupRecord> = {}) {
    return buildBackupRecord({
      id: "enc-backup",
      name: "Enc",
      tables_included: ["orders"],
      encryption_enabled: true,
      started_at: new Date().toISOString(),
      ...overrides,
    });
  }

  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("rejects backup creation when encryption is enabled without a key", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService();

    await expect(
      service.executeBackup("enc-backup", encBackupOverride()),
    ).rejects.toThrow(/encryption key/i);
    expect(errorSpy).toHaveBeenCalledWith(
      "Backup execution failed for enc-backup:",
      expect.any(Error),
    );

    // Never reached storage when the key is missing.
    expect(storageService.storeBackup).not.toHaveBeenCalled();
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
      ]),
    );
  });

  it("processes (encrypts) the payload before storing and records storage flags", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService(
      {} as D1Database,
      "secret-key",
    );
    storageService.processDataForStorage.mockResolvedValueOnce({
      processedData: "ENCRYPTED-BLOB",
      originalSize: 100,
      processedSize: 40,
    });
    storageService.storeBackup.mockResolvedValue({
      storage_path: "backups/enc.json",
      checksum: "chk-enc",
    });

    await service.executeBackup(
      "enc-backup",
      encBackupOverride({ compression_enabled: true, encryption_enabled: true }),
    );

    // Both the compression and encryption flags flow through with the key.
    expect(storageService.processDataForStorage).toHaveBeenCalledWith(
      expect.any(String),
      true,
      true,
      "secret-key",
    );
    // The processed (encrypted) bytes — not the raw JSON — are stored.
    expect(storageService.storeBackup).toHaveBeenCalledWith(
      expect.objectContaining({ id: "enc-backup" }),
      "ENCRYPTED-BLOB",
      "r2",
    );
    // Storage flags persisted in metadata so restore knows how to read it back.
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "completed",
          metadata: expect.objectContaining({
            storage: { compressed: true, encrypted: true },
          }),
        }),
      ]),
    );
  });

  it("decrypts on restore using the configured key and persisted storage flags", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService(
      {} as D1Database,
      "secret-key",
    );

    mockSelectResults({
      restoreOperations: [
        [
          {
            id: "restore-1",
            restaurantId: "restaurant-1",
            backupId: "backup-enc",
            restoreType: "selective",
            targetTables: ["orders"],
            overwriteExisting: false,
            performedBy: "user-1",
          },
        ],
      ],
      backupRecords: [
        [
          {
            id: "backup-enc",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: true,
            checksum: "",
            metadata: { storage: { compressed: false, encrypted: true } },
          },
        ],
      ],
    });
    storageService.retrieveBackup.mockResolvedValue("ENCRYPTED-BLOB");
    // Decrypted payload with no matching tables -> restore completes trivially.
    storageService.processDataFromStorage.mockResolvedValueOnce("{}");

    await service["executeRestore"]("restore-1");

    expect(storageService.processDataFromStorage).toHaveBeenCalledWith(
      "ENCRYPTED-BLOB",
      false,
      true,
      "secret-key",
    );
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed" }),
      ]),
    );
  });

  it("fails restore of an encrypted backup when no key is configured", async () => {
    const mutations = mockMutations();
    const { service, storageService } = createService();

    mockSelectResults({
      restoreOperations: [
        [
          {
            id: "restore-2",
            restaurantId: "restaurant-1",
            backupId: "backup-enc",
            restoreType: "selective",
            targetTables: ["orders"],
            overwriteExisting: false,
            performedBy: "user-1",
          },
        ],
      ],
      backupRecords: [
        [
          {
            id: "backup-enc",
            restaurantId: "restaurant-1",
            status: "completed",
            tablesIncluded: ["orders"],
            storageProvider: "r2",
            storagePath: "backup.json",
            encryptionEnabled: true,
            checksum: "",
            metadata: { storage: { compressed: false, encrypted: true } },
          },
        ],
      ],
    });
    storageService.retrieveBackup.mockResolvedValue("ENCRYPTED-BLOB");

    await expect(
      service["executeRestore"]("restore-2"),
    ).rejects.toThrow(/encryption key/i);
    expect(storageService.processDataFromStorage).not.toHaveBeenCalled();
    expect(mutations.updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "failed" }),
      ]),
    );
  });
});
