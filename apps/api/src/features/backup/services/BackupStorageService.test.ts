import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackupStorageService } from "./BackupStorageService";
import type { BackupRecord } from "@makanmasak/shared-types";

function createR2() {
  const objects = new Map<
    string,
    { data: string; customMetadata?: Record<string, string> }
  >();

  return {
    objects,
    put: vi.fn(
      async (key: string, data: string, options?: R2PutOptions) => {
        objects.set(key, {
          data,
          customMetadata: options?.customMetadata,
        });
      },
    ),
    get: vi.fn(async (key: string) => {
      const object = objects.get(key);
      return object ? { text: vi.fn(async () => object.data) } : null;
    }),
    head: vi.fn(async (key: string) =>
      objects.has(key) ? { key } : null,
    ),
    delete: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, object]) => ({
          key,
          size: new Blob([object.data]).size,
        })),
    })),
  };
}

function createKv() {
  const values = new Map<
    string,
    { value: string; metadata?: Record<string, unknown> }
  >();

  return {
    values,
    put: vi.fn(
      async (
        key: string,
        value: string,
        options?: KVNamespacePutOptions,
      ) => {
        values.set(key, { value, metadata: options?.metadata ?? undefined });
      },
    ),
    get: vi.fn(async (key: string) => values.get(key)?.value ?? null),
    getWithMetadata: vi.fn(async (key: string) => ({
      value: values.get(key)?.value ?? null,
      metadata: values.get(key)?.metadata ?? null,
    })),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

function createService() {
  const r2 = createR2();
  const kv = createKv();
  const service = new BackupStorageService(r2 as never, kv as never);
  return { service, r2, kv };
}

function backup(overrides: Partial<BackupRecord> = {}): BackupRecord {
  return {
    id: "backup-1",
    restaurant_id: "restaurant-1",
    name: "daily-backup",
    storage_provider: "r2",
    storage_path: "backups/restaurant-1/2026-06-07/backup-1.json",
    checksum: null,
    compression_enabled: false,
    encryption_enabled: false,
    started_at: "2026-06-07T00:00:00.000Z",
    ...overrides,
  } as BackupRecord;
}

describe("BackupStorageService", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The service logs every failure it wraps; several tests drive those on purpose.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    errorSpy.mockRestore();
  });

  it("stores, retrieves, checks, and deletes R2 backups with metadata", async () => {
    const { service, r2 } = createService();

    const stored = await service.storeBackup(
      backup({ compression_enabled: true, encryption_enabled: true }),
      "{\"orders\":[]}",
      "r2",
    );

    expect(stored.storage_path).toBe(
      "backups/restaurant-1/2026-06-07/backup-1.json",
    );
    expect(stored.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(r2.put).toHaveBeenCalledWith(
      stored.storage_path,
      "{\"orders\":[]}",
      {
        customMetadata: expect.objectContaining({
          "backup-id": "backup-1",
          "restaurant-id": "restaurant-1",
          "file-size": "13",
          checksum: stored.checksum,
          "compression-enabled": "true",
          "encryption-enabled": "true",
        }),
      },
    );

    const storedBackup = backup({
      storage_path: stored.storage_path,
      checksum: stored.checksum,
    });
    await expect(service.retrieveBackup(storedBackup)).resolves.toBe(
      "{\"orders\":[]}",
    );
    await expect(service.backupExists(storedBackup)).resolves.toBe(true);

    await service.deleteBackup(storedBackup);
    expect(r2.delete).toHaveBeenCalledWith(stored.storage_path);
    await expect(service.backupExists(storedBackup)).resolves.toBe(false);
  });

  it("stores and retrieves KV backups and reports missing records", async () => {
    const { service, kv } = createService();

    const stored = await service.storeBackup(
      backup({ id: "backup-kv", storage_provider: "kv" }),
      "kv-data",
      "kv",
    );

    expect(kv.put).toHaveBeenCalledWith(
      "backup:backup-kv",
      "kv-data",
      {
        metadata: expect.objectContaining({
          backup_id: "backup-kv",
          restaurant_id: "restaurant-1",
          file_size: 7,
          checksum: stored.checksum,
        }),
      },
    );

    const storedBackup = backup({
      id: "backup-kv",
      storage_provider: "kv",
      checksum: stored.checksum,
    });
    await expect(service.retrieveBackup(storedBackup)).resolves.toBe("kv-data");
    await expect(service.backupExists(storedBackup)).resolves.toBe(true);

    await service.deleteBackup(storedBackup);
    await expect(service.retrieveBackup(storedBackup)).rejects.toThrow(
      "Failed to retrieve backup: Backup file not found in KV storage",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Error retrieving backup:",
      expect.any(Error),
    );
  });

  it("wraps unsupported providers and checksum mismatches", async () => {
    const { service } = createService();

    await expect(
      service.storeBackup(backup(), "data", "unknown" as never),
    ).rejects.toThrow("Failed to store backup: Unsupported storage provider");
    await expect(
      service.retrieveBackup(
        backup({ storage_provider: "unknown" as never }),
      ),
    ).rejects.toThrow(
      "Failed to retrieve backup: Unsupported storage provider",
    );
    await expect(
      service.deleteBackup(backup({ storage_provider: "unknown" as never })),
    ).rejects.toThrow("Failed to delete backup: Unsupported storage provider");
    await expect(
      service.backupExists(backup({ storage_provider: "unknown" as never })),
    ).resolves.toBe(false);

    const stored = await service.storeBackup(backup(), "original", "r2");
    await expect(
      service.retrieveBackup(
        backup({ storage_path: stored.storage_path, checksum: "bad" }),
      ),
    ).rejects.toThrow("checksum mismatch");
    expect(errorSpy).toHaveBeenCalledWith(
      "Error storing backup:",
      expect.any(Error),
    );
  });

  it("summarizes R2 usage and continues cleanup after delete failures", async () => {
    const { service, r2 } = createService();
    const first = await service.storeBackup(
      backup({ id: "backup-1" }),
      "first",
      "r2",
    );
    await service.storeBackup(backup({ id: "backup-2" }), "second", "r2");
    r2.delete.mockRejectedValueOnce(new Error("r2 down"));

    await expect(service.getStorageUsage("restaurant-1")).resolves.toEqual({
      total_files: 2,
      total_size_bytes: 11,
      r2_files: 2,
      r2_size_bytes: 11,
      kv_files: 0,
      kv_size_bytes: 0,
    });

    await expect(
      service.cleanupExpiredBackups("restaurant-1", [
        backup({ id: "backup-1", storage_path: first.storage_path }),
        backup({
          id: "backup-2",
          storage_path: "backups/restaurant-1/2026-06-07/backup-2.json",
        }),
      ]),
    ).resolves.toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to cleanup backup backup-1:",
      expect.any(Error),
    );
  });

  it("compresses, encrypts, restores, and validates encryption keys", async () => {
    const { service } = createService();
    const raw = JSON.stringify({ orders: [{ id: 1, total: 100 }] });
    const key = "test-encryption-key";

    const compressed = await service.processDataForStorage(
      raw,
      true,
      false,
    );
    expect(compressed.originalSize).toBe(new Blob([raw]).size);
    expect(compressed.processedData).not.toBe(raw);
    await expect(
      service.processDataFromStorage(compressed.processedData, true, false),
    ).resolves.toBe(raw);

    const encrypted = await service.processDataForStorage(raw, false, true, key);
    expect(encrypted.processedData).not.toBe(raw);
    await expect(
      service.processDataFromStorage(encrypted.processedData, false, true, key),
    ).resolves.toBe(raw);

    await expect(service.processDataForStorage(raw, false, true)).rejects.toThrow(
      "Encryption key is required",
    );
    await expect(
      service.processDataFromStorage(encrypted.processedData, false, true),
    ).rejects.toThrow("Encryption key is required");
  });

  it("generates download responses from stored backup data", async () => {
    const { service } = createService();
    const stored = await service.storeBackup(backup(), "{\"ok\":true}", "r2");

    const response = await service.generateDownloadResponse(
      backup({
        storage_path: stored.storage_path,
        checksum: stored.checksum,
        name: "daily",
        started_at: "2026-06-07T01:02:03.004Z",
      }),
    );

    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"daily_2026-06-07T01-02-03-004Z.json\"",
    );
    expect(response.headers.get("Content-Length")).toBe("11");
    await expect(response.text()).resolves.toBe("{\"ok\":true}");
  });
});
