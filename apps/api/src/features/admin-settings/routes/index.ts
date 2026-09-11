import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../../types/env";
import { authMiddleware } from "../../../middleware/auth";
import { validateBody } from "../../../middleware/validation";

const timeOfDaySchema = z.lazy(() =>
  z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm in 24-hour time"),
);

const notificationSettingsSchema = z.lazy(() =>
  z
    .object({
      newOrders: z.boolean(),
      systemAlerts: z.boolean(),
      backupStatus: z.boolean(),
      performanceAlerts: z.boolean(),
      userActivity: z.boolean(),
      inventoryAlerts: z.boolean(),
      revenueUpdates: z.boolean(),
      sound: z.boolean(),
      vibration: z.boolean(),
      quietHours: z.object({
        enabled: z.boolean(),
        start: timeOfDaySchema,
        end: timeOfDaySchema,
      }),
    })
    .loose(),
);

const settingsSyncSchema = z.lazy(() =>
  z
    .object({
      sync_id: z.string().min(1).max(200).optional(),
      restaurant_id: z.union([z.string(), z.number()]).optional(),
    })
    .loose(),
);

type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
type SettingsSyncInput = z.infer<typeof settingsSyncSchema>;

type NotificationSettingsRecord = {
  userId: string;
  restaurantId: string | null;
  settings: NotificationSettings;
  updatedAt: string;
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  newOrders: true,
  systemAlerts: true,
  backupStatus: true,
  performanceAlerts: true,
  userActivity: false,
  inventoryAlerts: true,
  revenueUpdates: true,
  sound: true,
  vibration: true,
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
  },
};

const routes = new Hono<{ Bindings: Env }>();

routes.get("/notification-settings", authMiddleware, async (c) => {
  const key = createSettingsKey(c.get("user"));
  const stored = await c.env.CACHE_KV.get<NotificationSettingsRecord>(
    key,
    "json",
  );

  return c.json({
    success: true,
    data: stored?.settings ?? DEFAULT_NOTIFICATION_SETTINGS,
  });
});

routes.put(
  "/notification-settings",
  authMiddleware,
  validateBody(notificationSettingsSchema),
  async (c) => {
    const user = c.get("user");
    const settings = c.get("validatedBody");
    const now = new Date().toISOString();
    const record: NotificationSettingsRecord = {
      userId: user.id,
      restaurantId:
        user.restaurantId !== undefined ? String(user.restaurantId) : null,
      settings,
      updatedAt: now,
    };

    await c.env.CACHE_KV.put(createSettingsKey(user), JSON.stringify(record));

    return c.json({
      success: true,
      data: {
        settings,
        updatedAt: now,
      },
    });
  },
);

routes.post(
  "/settings/sync",
  authMiddleware,
  validateBody(settingsSyncSchema),
  async (c) => {
    const user = c.get("user");
    const settings = c.get("validatedBody");
    const now = new Date().toISOString();
    const syncId = createSyncId(settings);
    const restaurantId =
      settings.restaurant_id !== undefined
        ? String(settings.restaurant_id)
        : user.restaurantId !== undefined
          ? String(user.restaurantId)
          : null;

    if (!canWriteRestaurantScope(user, restaurantId)) {
      return c.json(
        {
          success: false,
          error: {
            code: "SETTINGS_SYNC_FORBIDDEN",
            message: "Cannot sync settings for another restaurant",
          },
        },
        403,
      );
    }

    const scope = restaurantId ? encodeURIComponent(restaurantId) : "global";
    const record = {
      userId: user.id,
      restaurantId,
      settings,
      syncedAt: now,
    };

    await c.env.CACHE_KV.put(
      `admin:settings-sync:${scope}:${user.id}:${syncId}`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    await c.env.CACHE_KV.put(
      `admin:settings-sync:${scope}:${user.id}:latest`,
      JSON.stringify(record),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );

    return c.json({
      success: true,
      data: {
        syncId,
        synced: true,
        restaurantId,
        syncedAt: now,
      },
    });
  },
);

function createSettingsKey(user: {
  id: string;
  restaurantId?: string | number | null;
}): string {
  const restaurantId =
    user.restaurantId == null ? "" : String(user.restaurantId).trim();
  const scope = restaurantId ? encodeURIComponent(restaurantId) : "global";
  return `admin:notification-settings:${scope}:${user.id}`;
}

function createSyncId(settings: SettingsSyncInput): string {
  if (settings.sync_id) return encodeURIComponent(settings.sync_id);
  return `${Date.now()}`;
}

function canWriteRestaurantScope(
  user: { role?: number; restaurantId?: string | number | null },
  restaurantId: string | null,
): boolean {
  if (user.role === 0 || restaurantId === null) return true;
  if (user.restaurantId === undefined || user.restaurantId === null) {
    return false;
  }
  return String(user.restaurantId) === restaurantId;
}

export default routes;
