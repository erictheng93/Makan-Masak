/**
 * Backup Routes - Modular route definitions
 */

import { Hono } from "hono";
import { z } from "zod";
import { BackupController } from "../controllers/BackupController";
import { BackupService } from "../services/BackupService";
import { BackupConfigService } from "../services/BackupConfigService";
import { BackupStorageService } from "../services/BackupStorageService";
import { BackupValidationService } from "../services/BackupValidationService";
import type {
  D1Database,
  R2Bucket,
  KVNamespace,
} from "@cloudflare/workers-types";
import { validateBody, validateQuery } from "../../../middleware/validation";
import { generateUUID } from "@makanmasak/utils";

// Define proper Hono context with backup services
type ContextVariableMap = {
  user: {
    id: string;
    role: number;
    restaurant_id?: string;
  };
  backupController: BackupController;
};

type Context = {
  Bindings: {
    DB: D1Database;
    BACKUP_STORAGE: R2Bucket;
    BACKUP_KV: KVNamespace;
    ENCRYPTION_KEY: string;
  };
  Variables: ContextVariableMap;
};

// Validation schemas
const createBackupSchema = z.lazy(() => z.object({
  restaurant_id: z.uuid("Invalid restaurant ID"),
  configuration_id: z.uuid().optional(),
  name: z.string().min(1, "Backup name is required").max(100),
  description: z.string().max(500).optional(),
  backup_type: z.enum(["full", "incremental", "differential"]).default("full"),
  include_tables: z.array(z.string()).optional(),
  exclude_tables: z.array(z.string()).optional(),
  force_immediate: z.boolean().default(false),
}));

const uploadBackupSchema = z.lazy(() => z
  .object({
    backup_id: z.string().min(1).max(200).optional(),
    restaurant_id: z.union([z.string(), z.number()]).optional(),
  })
  .loose());

export const listBackupsSchema = z.lazy(() => z.object({
  restaurant_id: z.uuid("Invalid restaurant ID"),
  status: z
    .enum(["pending", "in_progress", "completed", "failed", "cancelled"])
    .optional(),
  backup_type: z.enum(["full", "incremental", "differential"]).optional(),
  date_from: z.iso.datetime().optional(),
  date_to: z.iso.datetime().optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort_by: z
    .enum(["started_at", "completed_at", "file_size", "name"])
    .default("started_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
}));

const restoreBackupSchema = z.lazy(() => z.object({
  restaurant_id: z.uuid("Invalid restaurant ID"),
  backup_id: z.uuid("Invalid backup ID"),
  restore_type: z.enum(["full", "selective"]),
  target_tables: z.array(z.string()).optional(),
  overwrite_existing: z.boolean().default(false),
  safety_confirmation: z.object({
    backup_integrity_verified: z.boolean(),
    data_loss_risk_acknowledged: z.boolean(),
    confirmation_phrase: z.literal("I understand the risks"),
  }),
}));

const configurationSchema = z.lazy(() => z.object({
  restaurant_id: z.uuid("Invalid restaurant ID"),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  backup_type: z.enum(["full", "incremental", "differential"]).default("full"),
  schedule_enabled: z.boolean().default(false),
  schedule_cron: z.string().optional(),
  retention_days: z.number().min(1).max(365).default(30),
  include_tables: z.array(z.string()).optional(),
  exclude_tables: z.array(z.string()).optional(),
  compression_enabled: z.boolean().default(true),
  encryption_enabled: z.boolean().default(true),
  max_parallel_backups: z.number().min(1).max(10).default(3),
  notifications_enabled: z.boolean().default(true),
  notification_channels: z.array(z.string()).default(["email"]),
}));

export function createBackupRoutes(): Hono<Context> {
  const backup = new Hono<Context>();

  // Middleware for service initialization
  backup.use("*", async (c, next) => {
    // Initialize services with dependency injection
    const storageService = new BackupStorageService(
      c.env.BACKUP_STORAGE,
      c.env.BACKUP_KV,
    );

    const configService = new BackupConfigService(c.env.DB);
    const validationService = new BackupValidationService(c.env.DB);

    const backupService = new BackupService(
      c.env.DB,
      storageService,
      configService,
      validationService,
      c.env.ENCRYPTION_KEY,
    );
    backupService.setRequestContext({
      ipAddress:
        c.req.header("cf-connecting-ip") ||
        c.req.header("x-forwarded-for") ||
        "0.0.0.0",
      userAgent: c.req.header("user-agent") || "Unknown",
    });

    const backupController = new BackupController(
      backupService,
      configService,
      validationService,
    );

    c.set("backupController", backupController);
    await next();
  });

  // ============================================================================
  // BACKUP OPERATIONS
  // ============================================================================

  /**
   * POST /api/v1/backup/create
   * Create a new backup for a restaurant
   */
  backup.post("/create", validateBody(createBackupSchema), async (c) => {
    const controller = c.get("backupController");
    return await controller.createBackup(c);
  });

  /**
   * POST /api/v1/backup/upload
   * Persist an offline backup payload produced by the admin background sync.
   */
  backup.post("/upload", validateBody(uploadBackupSchema), async (c) => {
    const body = c.get("validatedBody");
    const user = c.get("user") as
      | { id?: string | number; restaurantId?: string | number }
      | undefined;
    const restaurantId =
      body.restaurant_id !== undefined
        ? String(body.restaurant_id)
        : user?.restaurantId !== undefined
          ? String(user.restaurantId)
          : "global";

    if (!canWriteRestaurantScope(user, restaurantId)) {
      return c.json(
        {
          success: false,
          error: {
            code: "BACKUP_UPLOAD_FORBIDDEN",
            message: "Cannot upload backups for another restaurant",
          },
        },
        403,
      );
    }

    const backupId = body.backup_id ?? createBackupUploadId();
    const now = new Date().toISOString();
    const storageKey = [
      "offline-uploads",
      encodeURIComponent(restaurantId),
      `${encodeURIComponent(backupId)}.json`,
    ].join("/");
    const record = {
      backupId,
      restaurantId,
      userId: user?.id ?? null,
      payload: body,
      uploadedAt: now,
    };

    await c.env.BACKUP_STORAGE.put(storageKey, JSON.stringify(record), {
      httpMetadata: { contentType: "application/json" },
    });
    await c.env.BACKUP_KV.put(
      `backup:offline-upload:${encodeURIComponent(backupId)}`,
      JSON.stringify({
        backupId,
        restaurantId,
        storageKey,
        uploadedAt: now,
        userId: user?.id ?? null,
      }),
      { expirationTtl: 60 * 60 * 24 * 90 },
    );

    return c.json({
      success: true,
      data: {
        backup_id: backupId,
        uploaded: true,
        restaurant_id: restaurantId,
        storage_key: storageKey,
        uploaded_at: now,
      },
    });
  });

  /**
   * GET /api/v1/backup/list
   * List backups for a restaurant with filtering and pagination
   */
  backup.get("/list", validateQuery(listBackupsSchema), async (c) => {
    const controller = c.get("backupController");
    return await controller.listBackups(c);
  });

  /**
   * GET /api/v1/backup/:id
   * Get detailed information about a specific backup
   */
  backup.get("/:id", async (c) => {
    const controller = c.get("backupController");
    return await controller.getBackup(c);
  });

  /**
   * GET /api/v1/backup/:id/download
   * Download a backup file
   */
  backup.get("/:id/download", async (c) => {
    const controller = c.get("backupController");
    return await controller.downloadBackup(c);
  });

  /**
   * POST /api/v1/backup/:id/restore
   * Restore from a backup
   */
  backup.post("/:id/restore", validateBody(restoreBackupSchema), async (c) => {
    const controller = c.get("backupController");
    return await controller.restoreBackup(c);
  });

  /**
   * DELETE /api/v1/backup/:id
   * Delete a backup
   */
  backup.delete("/:id", async (c) => {
    const controller = c.get("backupController");
    return await controller.deleteBackup(c);
  });

  // ============================================================================
  // BACKUP CONFIGURATIONS
  // ============================================================================

  /**
   * GET /api/v1/backup/configurations/:restaurant_id
   * Get backup configurations for a restaurant
   */
  backup.get("/configurations/:restaurant_id", async (c) => {
    const controller = c.get("backupController");
    return await controller.getConfigurations(c);
  });

  /**
   * POST /api/v1/backup/configurations
   * Create or update backup configuration
   */
  backup.post(
    "/configurations",
    validateBody(configurationSchema),
    async (c) => {
      const controller = c.get("backupController");
      return await controller.saveConfiguration(c);
    },
  );

  // ============================================================================
  // SYSTEM MONITORING
  // ============================================================================

  /**
   * GET /api/v1/backup/system/health
   * Get overall backup system health (admin only)
   */
  backup.get("/system/health", async (c) => {
    const controller = c.get("backupController");
    return await controller.getSystemHealth(c);
  });

  /**
   * GET /api/v1/backup/restaurants/:restaurant_id/metrics
   * Get backup metrics for a specific restaurant
   */
  backup.get("/restaurants/:restaurant_id/metrics", async (c) => {
    const controller = c.get("backupController");
    return await controller.getRestaurantMetrics(c);
  });

  /**
   * GET /api/v1/backup/alerts/:restaurant_id
   * Get alerts for a restaurant
   */
  backup.get("/alerts/:restaurant_id", async (c) => {
    const controller = c.get("backupController");
    return await controller.getRestaurantAlerts(c);
  });

  /**
   * PATCH /api/v1/backup/alerts/:id/acknowledge
   * Acknowledge a backup alert after restaurant access is verified.
   */
  backup.patch("/alerts/:id/acknowledge", async (c) => {
    const controller = c.get("backupController");
    return await controller.acknowledgeAlert(c);
  });

  /**
   * PATCH /api/v1/backup/alerts/:id/resolve
   * Resolve a backup alert after restaurant access is verified.
   */
  backup.patch("/alerts/:id/resolve", async (c) => {
    const controller = c.get("backupController");
    return await controller.resolveAlert(c);
  });

  return backup;
}

// Export the configured routes
export const BackupRoutes = createBackupRoutes();

function createBackupUploadId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return generateUUID();
  }
  return `offline-${Date.now()}`;
}

function canWriteRestaurantScope(
  user:
    | { role?: number; restaurantId?: string | number | null }
    | undefined,
  restaurantId: string,
): boolean {
  if (user?.role === 0 || restaurantId === "global") return true;
  if (user?.restaurantId === undefined || user.restaurantId === null) {
    return false;
  }
  return String(user.restaurantId) === restaurantId;
}
