import { describe, expect, it, vi } from "vitest";
import { ImageService } from "./image-service";
import type { Env } from "../types/env";

const database = vi.hoisted(() => ({
  getImage: vi.fn(),
  getProcessingJob: vi.fn(),
  getImageAnalyticsSummary: vi.fn(),
  getCategoryStats: vi.fn(),
  getJobStats: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  ImageService: vi.fn().mockImplementation(function ImageService() {
    return database;
  }),
}));

function buildEnv(imageBaseUrl: string): Env {
  return {
    DB: {},
    IMAGE_CACHE: {},
    IMAGES_BUCKET: {},
    IMAGE_API_BASE_URL: imageBaseUrl,
  } as unknown as Env;
}

describe("ImageService", () => {
  it("builds image URLs after stripping trailing base URL slashes", () => {
    const service = new ImageService(buildEnv("https://images.test///"));

    expect(service.generateImageUrl("image/1", "medium/large")).toBe(
      "https://images.test/images/image%2F1/medium%2Flarge",
    );
  });

  it("preserves a base URL that has no trailing slash", () => {
    const service = new ImageService(buildEnv("https://images.test"));

    expect(service.generateImageUrl("image-1", "medium")).toBe(
      "https://images.test/images/image-1/medium",
    );
  });

  it("handles long runs of trailing slashes without regular expression backtracking", () => {
    const service = new ImageService(
      buildEnv(`https://images.test${"/".repeat(50_000)}`),
    );

    expect(service.generateImageUrl("image-1", "medium")).toBe(
      "https://images.test/images/image-1/medium",
    );
  });
});

describe("image job ownership", () => {
  const user = {
    id: "owner-a",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-a",
  };
  it.each(["cache", "database"])(
    "rejects another tenant's %s job, including a public image",
    async (source) => {
      const job = {
        id: "1",
        imageId: "image-b",
        status: "failed",
        createdAt: new Date().toISOString(),
      };
      const env = buildEnv("https://images.test");
      env.IMAGE_CACHE = {
        get: vi
          .fn()
          .mockResolvedValue(source === "cache" ? JSON.stringify(job) : null),
      } as never;
      database.getProcessingJob.mockResolvedValue({
        ...job,
        createdAt: new Date(),
        inputParams: null,
        outputData: null,
      });
      const service = new ImageService(env);
      for (const restaurantId of ["restaurant-b", null]) {
        database.getImage.mockResolvedValue({
          id: "image-b",
          uploadedBy: "owner-b",
          restaurantId,
          isActive: true,
        });
        expect(await service.getJobStatus("1", user)).toMatchObject({
          success: false,
        });
      }
    },
  );

  it.each(["cache", "database"])(
    "allows current tenant, uploader and platform admin on the %s path",
    async (source) => {
      const job = {
        id: "1",
        imageId: "image-a",
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      const env = buildEnv("https://images.test");
      env.IMAGE_CACHE = {
        get: vi
          .fn()
          .mockResolvedValue(source === "cache" ? JSON.stringify(job) : null),
      } as never;
      database.getProcessingJob.mockResolvedValue({
        ...job,
        createdAt: new Date(),
        inputParams: null,
        outputData: null,
      });
      database.getImage.mockResolvedValue({
        id: "image-a",
        uploadedBy: "uploader",
        restaurantId: "restaurant-a",
        isActive: true,
      });
      const service = new ImageService(env);
      for (const caller of [
        user,
        { ...user, id: "uploader", restaurantId: "restaurant-b" },
        { ...user, role: 0, restaurantId: undefined },
      ]) {
        expect(await service.getJobStatus("1", caller)).toMatchObject({
          success: true,
          job: { id: "1" },
        });
      }
    },
  );
});

describe("dashboard aggregate filters", () => {
  it("passes tenant and date filters to every aggregate", async () => {
    const options = {
      restaurantId: "restaurant-a",
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
    };
    database.getImageAnalyticsSummary.mockImplementation(async (received) => ({
      total_images: received?.restaurantId === "restaurant-a" ? 2 : 99,
      total_storage: 2048,
    }));
    database.getCategoryStats.mockImplementation(async (received) => [
      { category: "menu", count: received?.dateFrom === "2026-06-01" ? 2 : 99 },
    ]);
    database.getJobStats.mockImplementation(async (received) => [
      {
        status: "completed",
        count: 1,
        avg_duration: received?.dateTo === "2026-06-30" ? 10 : 99,
      },
    ]);
    const result = await new ImageService(
      buildEnv("https://images.test"),
    ).getImageAnalytics(options);
    expect(result).toMatchObject({
      success: true,
      analytics: {
        totalImages: 2,
        totalSize: 2048,
        uploadsByCategory: [{ category: "menu", count: 2 }],
        avgProcessingTime: 10,
      },
    });
  });
});
