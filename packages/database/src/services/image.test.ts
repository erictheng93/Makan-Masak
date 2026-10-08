import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/d1";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import { images, imageProcessingJobs, imageViews } from "../schema";
import type { TestDatabase } from "../testing/create-test-database";
import { ImageService } from "./image";

const restaurantId = "image-analytics-restaurant";
const imageId = "image-analytics-1";

describe("ImageService analytics timestamp handling", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE restaurants (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, category TEXT,
        address TEXT, district TEXT, city TEXT, phone TEXT, settings TEXT,
        is_available INTEGER, is_active INTEGER,
        timezone TEXT DEFAULT 'Asia/Taipei', created_at_ms INTEGER, updated_at_ms INTEGER
      );
      CREATE TABLE images (
        id TEXT PRIMARY KEY, filename TEXT, original_filename TEXT, mime_type TEXT,
        size INTEGER, width INTEGER, height INTEGER, category TEXT,
        restaurant_id TEXT, uploaded_by TEXT, cloudflare_image_id TEXT,
        variants TEXT, metadata TEXT, is_active INTEGER DEFAULT 1,
        uploaded_at_ms INTEGER, updated_at_ms INTEGER
      );
      CREATE TABLE image_views (
        id INTEGER PRIMARY KEY, image_id TEXT, variant TEXT,
        ip_address TEXT, user_agent TEXT, referer TEXT, viewed_at_ms INTEGER
      );
      CREATE TABLE image_processing_jobs (
        id INTEGER PRIMARY KEY, image_id TEXT, job_type TEXT, status TEXT DEFAULT 'pending',
        input_params TEXT, output_data TEXT, error TEXT, priority INTEGER DEFAULT 5,
        attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 3,
        created_at_ms INTEGER, started_at_ms INTEGER, completed_at_ms INTEGER
      );
    `);
    const db = new D1DatabaseAdapter(sqlite);
    testDb = {
      bindings: { DB: db },
      drizzle: drizzle(db as never),
      truncateAll: async () => {
        sqlite.exec(
          "DELETE FROM images; DELETE FROM image_views; DELETE FROM image_processing_jobs; DELETE FROM restaurants;",
        );
      },
      dispose: async () => db.close(),
    } as unknown as TestDatabase;
  });

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  it("groups image views by local hour from Unix millisecond timestamps", async () => {
    const service = new ImageService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await seedImage(testDb);
    await testDb.drizzle.insert(imageViews).values([
      {
        imageId,
        variant: "thumbnail",
        viewedAt: new Date("2026-06-07T03:15:00.000Z"),
      },
      {
        imageId,
        variant: "thumbnail",
        viewedAt: new Date("2026-06-07T03:45:00.000Z"),
      },
    ] as never);

    const analytics = await service.getUsageAnalytics({ restaurantId });

    expect(analytics.hourly_distribution).toEqual([
      {
        hour: "11",
        view_count: 2,
        avg_hourly_views: 2,
      },
    ]);
  });

  it("calculates image processing job duration from Unix millisecond timestamps", async () => {
    const service = new ImageService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await seedImage(testDb);
    await testDb.drizzle.insert(imageProcessingJobs).values({
      imageId,
      jobType: "resize",
      status: "completed",
      startedAt: new Date("2026-06-07T03:00:00.000Z"),
      completedAt: new Date("2026-06-07T03:02:30.000Z"),
      createdAt: new Date("2026-06-07T02:59:00.000Z"),
    } as never);

    const stats = await service.getJobStats();

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({
      status: "completed",
      count: 1,
    });
    expect(stats[0].avg_duration).toBeCloseTo(150);
  });
  it("scopes every dashboard aggregate and today's count to the tenant and dates", async () => {
    const service = new ImageService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await seedImage(testDb);
    const old = new Date("2020-01-01T00:00:00.000Z");
    const today = new Date();
    await testDb.drizzle.insert(images).values([
      {
        id: "other-tenant-image",
        restaurantId: "other-restaurant",
        filename: "other.jpg",
        originalFilename: "other.jpg",
        mimeType: "image/jpeg",
        size: 9999,
        category: "other",
        isActive: true,
        uploadedAt: today,
        updatedAt: today,
      },
      {
        id: "own-today-image",
        restaurantId,
        filename: "today.jpg",
        originalFilename: "today.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        category: "today",
        isActive: true,
        uploadedAt: today,
        updatedAt: today,
      },
      {
        id: "own-old-image",
        restaurantId,
        filename: "old.jpg",
        originalFilename: "old.jpg",
        mimeType: "image/jpeg",
        size: 8192,
        category: "old",
        isActive: true,
        uploadedAt: old,
        updatedAt: old,
      },
    ] as never);
    await testDb.drizzle.insert(imageProcessingJobs).values([
      {
        imageId,
        jobType: "resize",
        status: "completed",
        createdAt: new Date("2026-06-07T03:00:00.000Z"),
      },
      {
        imageId: "other-tenant-image",
        jobType: "resize",
        status: "failed",
        createdAt: today,
      },
      {
        imageId: "own-old-image",
        jobType: "resize",
        status: "failed",
        createdAt: old,
      },
    ] as never);
    const options = {
      restaurantId,
      dateFrom: "2026-06-01T00:00:00.000Z",
      dateTo: "2026-06-30T23:59:59.999Z",
    };
    expect(await service.getImageAnalyticsSummary(options)).toMatchObject({
      total_images: 1,
      total_storage: 1024,
      processed_today: 0,
    });
    expect(await service.getCategoryStats(options)).toEqual([
      { category: "menu", count: 1 },
    ]);
    expect(await service.getJobStats(options)).toMatchObject([
      { status: "completed", count: 1 },
    ]);
    expect(
      await service.getImageAnalyticsSummary({ restaurantId }),
    ).toMatchObject({ total_images: 3, processed_today: 1 });
  });
});

async function seedImage(testDb: TestDatabase) {
  await testDb.bindings.DB.prepare(
    "INSERT INTO restaurants (id, name, timezone) VALUES (?, ?, ?)",
  )
    .bind(restaurantId, "Image Analytics Restaurant", "Asia/Taipei")
    .run();

  await testDb.drizzle.insert(images).values({
    id: imageId,
    restaurantId,
    filename: "image.jpg",
    originalFilename: "image.jpg",
    mimeType: "image/jpeg",
    size: 1024,
    category: "menu",
    isActive: true,
    uploadedAt: new Date("2026-06-07T03:00:00.000Z"),
    updatedAt: new Date("2026-06-07T03:00:00.000Z"),
  } as never);

  const [image] = await testDb.drizzle
    .select()
    .from(images)
    .where(eq(images.id, imageId));
  expect(image).toBeTruthy();
}
