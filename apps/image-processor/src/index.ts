import { Hono } from "hono";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { timing } from "hono/timing";
import { corsMiddleware } from "./middleware/auth";
import imagesRouter from "./routes/images";
import analyticsRouter from "./routes/analytics";
import type { Env } from "./types/env";
import {
  createDatabase,
  sql,
  count,
  PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES,
  dateFromUnixMs,
  images,
  imageViews,
  imageProcessingJobs,
  menuItems,
} from "@makanmasak/database";
import { inArray, or } from "drizzle-orm";
import { cronMatches } from "./utils/cron";
import { ImageService } from "./services/image-service";
import type { StoredImageObject } from "./types/env";

type SlackTextObject = {
  type: "mrkdwn";
  text: string;
};

type SlackSectionBlock =
  | {
      type: "section";
      text: SlackTextObject;
    }
  | {
      type: "section";
      fields: SlackTextObject[];
    };

type SlackMessage = {
  text: string;
  blocks: SlackSectionBlock[];
};

// 創建主應用
const app = new Hono<{ Bindings: Env }>();

// 全域中間件
app.use("*", corsMiddleware);
app.use("*", logger());
app.use("*", timing());
app.use("*", prettyJSON());

// 錯誤處理中間件
app.onError((err, c) => {
  console.error("Global error handler:", err);

  // 發送錯誤通知到 Slack (如果配置了)
  if (c.env.SLACK_WEBHOOK_URL) {
    c.executionCtx.waitUntil(
      sendErrorNotification(c.env.SLACK_WEBHOOK_URL, err, c),
    );
  }

  // 開發環境顯示詳細錯誤
  if (c.env.NODE_ENV === "development") {
    return c.json(
      {
        success: false,
        error: err.message,
        stack: err.stack,
      },
      500,
    );
  }

  // 生產環境隱藏詳細錯誤
  return c.json(
    {
      success: false,
      error: "Internal server error",
    },
    500,
  );
});

// 404 處理
app.notFound((c) => {
  return c.json(
    {
      success: false,
      error: "API endpoint not found",
      path: c.req.path,
    },
    404,
  );
});

// 根路徑 - API 資訊
app.get("/", (c) => {
  return c.json({
    name: "MakanMasak Image Processing Service",
    version: c.env.API_VERSION || "v1",
    description:
      "Cloudflare Workers-based image processing and optimization service",
    environment: c.env.NODE_ENV || "development",
    features: [
      "Image upload and storage",
      "Automatic optimization",
      "Multiple format variants",
      "Real-time transformations",
      "Advanced analytics",
      "Bulk operations",
      "Security scanning",
      "Access control",
    ],
    endpoints: {
      images: "/images",
      upload: "/images/upload",
      analytics: "/analytics",
      health: "/health",
      docs: "/docs",
    },
    limits: {
      maxFileSize: `${c.env.MAX_IMAGE_SIZE_MB || 10}MB`,
      allowedFormats: c.env.ALLOWED_MIME_TYPES?.split(",") || [
        "image/jpeg",
        "image/png",
        "image/webp",
      ],
      maxUploadsPerMinute: c.env.MAX_UPLOADS_PER_MINUTE || 20,
      maxTransformsPerMinute: c.env.MAX_TRANSFORMS_PER_MINUTE || 100,
    },
  });
});

// 健康檢查端點
app.get("/health", async (c) => {
  try {
    const startTime = Date.now();

    // 檢查資料庫連接
    let dbStatus = "healthy";
    let dbResponseTime = 0;

    try {
      const dbStart = Date.now();
      // Use Drizzle ORM for health check
      const db = createDatabase(c.env.DB);
      const healthResult = await db.select({ test: sql<number>`1` });
      const firstResult =
        Array.isArray(healthResult) && healthResult.length > 0
          ? healthResult[0]
          : null;
      const _isHealthy = firstResult?.test === 1;
      dbResponseTime = Date.now() - dbStart;
    } catch (error) {
      dbStatus = "unhealthy";
      console.error("Database health check failed:", error);
    }

    // 檢查 KV 存儲
    let kvStatus = "healthy";
    let kvResponseTime = 0;

    try {
      const kvStart = Date.now();
      // Read-only probe of a key that is never written: this route is public,
      // and a put per call let anyone drain the account's daily KV writes.
      await c.env.IMAGE_CACHE.get("health:sentinel");
      kvResponseTime = Date.now() - kvStart;
    } catch (error) {
      kvStatus = "unhealthy";
      console.error("KV health check failed:", error);
    }

    const overallStatus =
      dbStatus === "unhealthy" || kvStatus === "unhealthy"
        ? "unhealthy"
        : dbStatus === "degraded" || kvStatus === "degraded"
          ? "degraded"
          : "healthy";

    const totalResponseTime = Date.now() - startTime;
    const statusCode = overallStatus === "unhealthy" ? 503 : 200;

    return c.json(
      {
        success: overallStatus !== "unhealthy",
        status: overallStatus,
        timestamp: new Date().toISOString(),
        version: c.env.API_VERSION || "v1",
        environment: c.env.NODE_ENV || "development",
        services: {
          database: {
            status: dbStatus,
            responseTime: `${dbResponseTime}ms`,
          },
          cache: {
            status: kvStatus,
            responseTime: `${kvResponseTime}ms`,
          },
        },
        performance: {
          totalCheckTime: `${totalResponseTime}ms`,
          uptime: Date.now() - startTime, // Simplified uptime
        },
      },
      statusCode,
    );
  } catch (error) {
    console.error("Health check error:", error);
    return c.json(
      {
        success: false,
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Health check failed",
      },
      503,
    );
  }
});

// API 版本資訊端點
app.get("/info", (c) => {
  return c.json({
    service: "MakanMasak Image Processor",
    version: c.env.API_VERSION || "v1",
    environment: c.env.NODE_ENV || "development",
    buildTime: new Date().toISOString(),
    capabilities: {
      upload: true,
      transformation: true,
      optimization: true,
      variants: true,
      analytics: true,
      bulkOperations: true,
      securityScanning: true,
    },
    supportedFormats: {
      input: c.env.ALLOWED_MIME_TYPES?.split(",") || [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
      ],
      output: ["image/webp", "image/jpeg", "image/png", "image/avif"],
    },
    variants: {
      predefined: c.env.DEFAULT_VARIANTS?.split(",") || [
        "thumbnail",
        "small",
        "medium",
        "large",
        "original",
      ],
      sizes: {
        thumbnail: c.env.THUMBNAIL_SIZE || "150x150",
        small: c.env.SMALL_SIZE || "300x300",
        medium: c.env.MEDIUM_SIZE || "600x600",
        large: c.env.LARGE_SIZE || "1200x1200",
      },
    },
    rateLimits: {
      uploads: `${c.env.MAX_UPLOADS_PER_MINUTE || 20}/minute`,
      transforms: `${c.env.MAX_TRANSFORMS_PER_MINUTE || 100}/minute`,
    },
  });
});

// 路由註冊
app.route("/images", imagesRouter);
app.route("/analytics", analyticsRouter);

// 計畫任務處理器（用於清理和維護）
export default {
  fetch: app.fetch,

  // 計畫任務處理器
  scheduled: async (
    event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext,
  ) => {
    console.log("Scheduled task triggered:", event.cron);

    try {
      // 清理過期的處理作業記錄
      await cleanupExpiredJobs(env);

      // 清理舊的視圖記錄
      await cleanupOldViews(env);

      // 清理過期的快取
      await cleanupExpiredCache(env);

      // 掃描並刪除孤兒 Cloudflare Images（上傳成功但未寫回選單的殘留圖片）
      await sweepOrphanedImages(env);

      // 發送每日使用統計（cron 為 UTC；01:00 UTC = 台灣時間上午 9 點）
      if (cronMatches(event.cron, "0 1 * * *")) {
        await sendDailyStats(env);
      }
    } catch (error) {
      console.error("Scheduled task error:", error);

      if (env.SLACK_WEBHOOK_URL) {
        await sendErrorNotification(
          env.SLACK_WEBHOOK_URL,
          error as Error,
          null,
        );
      }
    }
  },
};

// 清理過期的處理作業記錄（保留 7 天）
async function cleanupExpiredJobs(env: Env) {
  try {
    // Use Drizzle ORM for cleanup
    const db = createDatabase(env.DB);
    const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const _result = await db
      .delete(imageProcessingJobs)
      .where(sql`${imageProcessingJobs.createdAt} < ${cutoffMs}`);

    console.log(`Cleaned up expired processing jobs`);
  } catch (error) {
    console.error("Failed to cleanup expired jobs:", error);
  }
}

// 清理舊的視圖記錄（保留 30 天）
async function cleanupOldViews(_env: Env) {
  try {
    // Use Drizzle ORM for cleanup
    const db = createDatabase(_env.DB);
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const _viewsResult = await db
      .delete(imageViews)
      .where(sql`${imageViews.viewedAt} < ${cutoffMs}`);

    console.log(`Cleaned up old view records`);
  } catch (error) {
    console.error("Failed to cleanup old views:", error);
  }
}

// 清理過期的快取項目
async function cleanupExpiredCache(env: Env) {
  try {
    // KV 會自動清理過期項目，但我們可以主動清理一些測試數據
    const keys = await env.IMAGE_CACHE.list({ prefix: "health-" });

    for (const key of keys.keys) {
      if (key.name.startsWith("health-")) {
        await env.IMAGE_CACHE.delete(key.name);
      }
    }

    console.log(`Cleaned up ${keys.keys.length} temporary cache items`);
  } catch (error) {
    console.error("Failed to cleanup cache:", error);
  }
}

// 孤兒圖片掃描：每次執行最多刪除的張數上限，用於限制 cron 執行時間
const ORPHAN_SWEEP_MAX_DELETIONS = 100;
// 只清理上傳超過 48 小時的圖片，避免刪到剛上傳、選單寫回尚未完成的圖片
const ORPHAN_SWEEP_MIN_AGE_MS = 48 * 60 * 60 * 1000;
const ORPHAN_SWEEP_PAGE_SIZE = 100;

// 給定一批 image id，回傳其中「有被引用」的 id 集合。
// 引用來源有二：
//   1. menu_items.image_id 直接指向該 id
//   2. 本 worker images 表以 cloudflare_image_id 對應到一筆 images.id，
//      而該 images.id 又被 menu_items.image_id 引用（正常上傳→寫回選單流程）
async function findReferencedImageIds(
  db: ReturnType<typeof createDatabase>,
  imageIds: string[],
): Promise<Set<string>> {
  const referenced = new Set<string>();
  if (imageIds.length === 0) return referenced;

  // 1. menu_items.image_id 直接引用 image id
  const directRefs = await db
    .select({ imageId: menuItems.imageId })
    .from(menuItems)
    .where(inArray(menuItems.imageId, imageIds));
  for (const row of directRefs) {
    if (row.imageId) referenced.add(row.imageId);
  }

  // 2. 透過本 worker images 表把舊 cloudflare_image_id 對應到 images.id
  const imageRows = await db
    .select({ id: images.id, cloudflareImageId: images.cloudflareImageId })
    .from(images)
    .where(inArray(images.cloudflareImageId, imageIds));

  const imageIdToCloudflareId = new Map<string, string>();
  const workerImageIds: string[] = [];
  for (const row of imageRows) {
    if (row.id && row.cloudflareImageId) {
      imageIdToCloudflareId.set(row.id, row.cloudflareImageId);
      workerImageIds.push(row.id);
    }
  }

  // 3. 檢查這些 images.id 是否被 menu_items.image_id 引用
  if (workerImageIds.length > 0) {
    const menuRefs = await db
      .select({ imageId: menuItems.imageId })
      .from(menuItems)
      .where(inArray(menuItems.imageId, workerImageIds));
    for (const row of menuRefs) {
      const cfId = row.imageId
        ? imageIdToCloudflareId.get(row.imageId)
        : undefined;
      if (cfId) referenced.add(cfId);
    }
  }

  return referenced;
}

type OrphanSweepDeps = {
  imageStorage?: Pick<ImageService, "listStoredImages" | "deleteImageVariants">;
  // 引用解析：給定一批 image id 回傳已被引用的 id 集合，測試時可注入避免依賴真實 D1
  resolveReferenced?: (imageIds: string[]) => Promise<Set<string>>;
  deleteMetadata?: (cloudflareImageIds: string[]) => Promise<void>;
};

async function deleteOrphanedImageMetadata(
  env: Env,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return;

  await createDatabase(env.DB)
    .update(images)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(
      or(
        inArray(images.id, imageIds),
        inArray(images.cloudflareImageId, imageIds),
      ),
    );
}

// 掃描 R2 圖片，刪除「超過 48h 且未被任何選單引用」的孤兒圖片。
// 每個步驟都獨立 try/catch，任何失敗都不應影響其他 cron 步驟。
export async function sweepOrphanedImages(
  env: Env,
  deps: OrphanSweepDeps = {},
) {
  try {
    const imageStorage = deps.imageStorage ?? new ImageService(env);
    const resolveReferenced =
      deps.resolveReferenced ??
      ((imageIds: string[]) =>
        findReferencedImageIds(createDatabase(env.DB), imageIds));
    const deleteMetadata =
      deps.deleteMetadata ??
      ((imageIds: string[]) => deleteOrphanedImageMetadata(env, imageIds));
    const cutoffMs = Date.now() - ORPHAN_SWEEP_MIN_AGE_MS;

    let deleted = 0;
    let cursor: string | undefined;

    while (deleted < ORPHAN_SWEEP_MAX_DELETIONS) {
      const listResult = await imageStorage.listStoredImages({
        cursor,
        limit: ORPHAN_SWEEP_PAGE_SIZE,
        prefix: "",
      });

      if (!listResult.success) {
        console.error(
          "Orphan sweep: failed to list R2 images:",
          listResult.error,
        );
        break;
      }

      const pageImages = listResult.result?.images ?? [];
      if (pageImages.length === 0) break;

      // 只保留上傳超過 48h 的候選圖片
      const oldEnough = pageImages.filter((img) => {
        if (!img.uploaded) return false;
        const uploadedMs = Date.parse(img.uploaded);
        return Number.isFinite(uploadedMs) && uploadedMs < cutoffMs;
      });

      if (oldEnough.length > 0) {
        const deletedMetadataIds: string[] = [];
        let referenced: Set<string>;
        try {
          referenced = await resolveReferenced(oldEnough.map((img) => img.id));
        } catch (error) {
          console.error(
            "Orphan sweep: reference lookup failed, skipping page to stay safe:",
            error,
          );
          // 查不到引用關係時，寧可不刪，避免誤刪使用中的圖片
          if (!listResult.result?.cursor) break;
          cursor = listResult.result.cursor;
          continue;
        }

        for (const img of oldEnough as StoredImageObject[]) {
          if (deleted >= ORPHAN_SWEEP_MAX_DELETIONS) break;
          if (referenced.has(img.id)) continue;

          try {
            const deleteResult = await imageStorage.deleteImageVariants(
              img.id,
              [img.variant],
            );
            if (deleteResult.success) {
              deleted++;
              deletedMetadataIds.push(img.id);
              console.log(
                `Orphan sweep: deleted unreferenced R2 image ${img.key} (uploaded ${img.uploaded})`,
              );
            } else {
              console.error(
                `Orphan sweep: failed to delete image ${img.key}: ${deleteResult.error}`,
              );
            }
          } catch (error) {
            console.error(
              `Orphan sweep: error deleting image ${img.key}:`,
              error,
            );
          }
        }

        if (deletedMetadataIds.length > 0) {
          try {
            await deleteMetadata(deletedMetadataIds);
          } catch (error) {
            console.error(
              "Orphan sweep: failed to delete image metadata:",
              error,
            );
          }
        }
      }

      // 最後一頁
      if (!listResult.result?.cursor) break;
      cursor = listResult.result.cursor;
    }

    console.log(`Orphan sweep complete: ${deleted} image(s) deleted`);
  } catch (error) {
    console.error("Orphan sweep failed:", error);
  }
}

// 發送每日統計報告
async function sendDailyStats(env: Env) {
  try {
    // 獲取昨天的統計數據
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    // Use Drizzle ORM for daily statistics
    const db = createDatabase(env.DB);
    const statsResult = await db
      .select({
        images_uploaded: count(),
        total_size: sql<number>`SUM(${images.size})`,
        active_restaurants: sql<number>`COUNT(DISTINCT ${images.restaurantId})`,
      })
      .from(images)
      // Platform-wide daily digest -- it spans every tenant, so there is no
      // one shop's midnight to cut it at (#329).
      .where(
        sql`${dateFromUnixMs(images.uploadedAt, PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES)} = ${dateStr}`,
      );

    const stats = statsResult[0];

    // Use Drizzle ORM for processing statistics
    const processingStatsResult = await db
      .select({
        jobs_processed: count(),
        jobs_completed: sql<number>`SUM(CASE WHEN ${imageProcessingJobs.status} = 'completed' THEN 1 ELSE 0 END)`,
        jobs_failed: sql<number>`SUM(CASE WHEN ${imageProcessingJobs.status} = 'failed' THEN 1 ELSE 0 END)`,
      })
      .from(imageProcessingJobs)
      .where(
        sql`${dateFromUnixMs(imageProcessingJobs.createdAt, PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES)} = ${dateStr}`,
      );

    const processingStats = processingStatsResult[0];

    if (env.SLACK_WEBHOOK_URL) {
      await sendSlackMessage(env.SLACK_WEBHOOK_URL, {
        text: `📊 MakanMasak Image Service Daily Report - ${dateStr}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Daily Image Processing Report*\n*Date:* ${dateStr}`,
            },
          },
          {
            type: "section",
            fields: [
              {
                type: "mrkdwn",
                text: `*Images Uploaded:*\n${stats?.images_uploaded || 0}`,
              },
              {
                type: "mrkdwn",
                text: `*Storage Used:*\n${formatBytes(stats?.total_size || 0)}`,
              },
              {
                type: "mrkdwn",
                text: `*Active Restaurants:*\n${stats?.active_restaurants || 0}`,
              },
              {
                type: "mrkdwn",
                text: `*Processing Success Rate:*\n${
                  processingStats?.jobs_processed > 0
                    ? Math.round(
                        ((processingStats.jobs_completed || 0) /
                          processingStats.jobs_processed) *
                          100,
                      )
                    : 0
                }%`,
              },
            ],
          },
        ],
      });
    }

    console.log("Daily stats report sent successfully");
  } catch (error) {
    console.error("Failed to send daily stats:", error);
  }
}

// 發送錯誤通知到 Slack
async function sendErrorNotification(
  webhookUrl: string,
  error: Error,
  _context: unknown,
) {
  try {
    const message: SlackMessage = {
      text: "🚨 MakanMasak Image Service Error",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Error in Image Processing Service*\n\`\`\`${error.message}\`\`\``,
          },
        },
      ],
    };

    if (error.stack) {
      message.blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Stack Trace:*\n\`\`\`${error.stack.substring(0, 500)}\`\`\``,
        },
      });
    }

    await sendSlackMessage(webhookUrl, message);
  } catch (notificationError) {
    console.error("Failed to send error notification:", notificationError);
  }
}

// 通用 Slack 消息發送函數
async function sendSlackMessage(webhookUrl: string, message: SlackMessage) {
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error("Failed to send Slack message:", error);
  }
}

// 格式化位元組大小
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
