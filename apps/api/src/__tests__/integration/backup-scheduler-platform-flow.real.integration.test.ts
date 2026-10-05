import { afterAll, beforeAll, expect, it } from "vitest";
import { BackupService } from "../../services/BackupService";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";

let testApp: RealIntegrationTestApp;

beforeAll(async () => {
  testApp = await createRealIntegrationTestApp();
});

afterAll(async () => {
  await testApp?.dispose();
});

// Known gap: the scheduler imports this legacy service, whose record writer
// only logs. Remove .fails once scheduled requests survive process restart.
it.fails("persists a scheduled backup before acknowledging it", async () => {
  const restaurant = await buildSeedHelpers(testApp.testDb).restaurant();
  const service = new BackupService(
    testApp.env.DB,
    testApp.env.BACKUP_STORAGE,
    testApp.env.CACHE_KV,
  );

  const result = await service.createBackup(
    {
      restaurant_id: restaurant.id,
      name: "Master flow scheduled backup verification",
      backup_type: "full",
      include_tables: ["orders"],
      force_immediate: false,
    },
    "system",
  );

  const persisted = await testApp.env.DB.prepare(
    "SELECT id, status FROM backup_records WHERE id = ?",
  )
    .bind(result.backup_id)
    .first();

  expect(persisted).toEqual({ id: result.backup_id, status: "pending" });
});
