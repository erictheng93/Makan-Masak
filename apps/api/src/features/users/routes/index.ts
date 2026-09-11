import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { USER_ROLES } from "@makanmasak/database";
import type { Env } from "../../../types/env";
import { UsersService } from "../services/UsersService";
import {
  createUserSchema,
  updateUserSchema,
  updatePasswordSchema,
  userFilterSchema,
  userStatusSchema,
  resetPasswordSchema,
  userStatsSchema,
  userSearchSchema,
  type CreateUserInput,
  type ResetPasswordInput,
  type UpdatePasswordInput,
  type UpdateUserInput,
  type UserFilterInput,
  type UserSearchInput,
  type UserStatsInput,
  type UserStatusInput,
} from "../schemas/validation";
import type { CreateUserData, UserFilters } from "../types";

const app = new Hono<{ Bindings: Env }>();
type IdParamInput = { id: string };
const userIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1),
  }),
);
const notificationSettingsSchema = z.lazy(() => z.object({}).loose());
const userSyncSchema = z.lazy(() => z.object({}).loose());
type NotificationSettings = Record<string, unknown>;
interface NotificationSettingsRecord {
  settings?: NotificationSettings;
}

function toUserFilters(input: UserFilterInput): UserFilters {
  return {
    ...input,
    restaurantId:
      input.restaurantId === undefined ? undefined : String(input.restaurantId),
  };
}

function toCreateUserData(input: CreateUserInput): CreateUserData {
  return {
    ...input,
    restaurantId:
      input.restaurantId === undefined ? undefined : String(input.restaurantId),
  };
}

function createNotificationSettingsKey(userId: string): string {
  return `customer:notification-settings:${userId}`;
}

function createUserSyncKey(
  userId: string,
  syncType: string,
  syncId: string,
): string {
  return `customer:${syncType}:${userId}:${syncId}`;
}

function createUserSyncId(payload: Record<string, unknown>): string {
  if (typeof payload.sync_id === "string" && payload.sync_id.trim()) {
    return encodeURIComponent(payload.sync_id);
  }
  return `${Date.now()}`;
}

async function storeUserSyncPayload<E extends { Bindings: Env }>(
  c: Context<E>,
  syncType: string,
  payload: Record<string, unknown>,
) {
  const user = c.get("user");
  const now = new Date().toISOString();
  const syncId = createUserSyncId(payload);
  const record = {
    userId: user.id,
    payload,
    syncedAt: now,
  };

  await c.env.CACHE_KV.put(
    createUserSyncKey(user.id, syncType, syncId),
    JSON.stringify(record),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );
  await c.env.CACHE_KV.put(
    createUserSyncKey(user.id, syncType, "latest"),
    JSON.stringify(record),
    { expirationTtl: 60 * 60 * 24 * 30 },
  );

  return c.json({
    success: true,
    data: {
      syncId,
      synced: true,
      syncType,
      syncedAt: now,
    },
  });
}

/**
 * GET /api/v1/users
 */
app.get(
  "/",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateQuery(userFilterSchema),
  async (c) => {
    const query = c.get("validatedQuery") as UserFilterInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const result = await usersService.getUsers(
      currentUser,
      toUserFilters(query),
    );

    return c.json({ success: true, ...result });
  },
);

/**
 * GET /api/v1/users/stats
 */
app.get(
  "/stats",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateQuery(userStatsSchema),
  async (c) => {
    const { restaurantId } = c.get("validatedQuery") as UserStatsInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const stats = await usersService.getUserStats(
      currentUser,
      restaurantId === undefined ? undefined : String(restaurantId),
    );

    return c.json({ success: true, data: stats });
  },
);

/**
 * GET /api/v1/users/search
 */
app.get(
  "/search",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateQuery(userSearchSchema),
  async (c) => {
    const { query, restaurantId, limit } = c.get(
      "validatedQuery",
    ) as UserSearchInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const results = await usersService.searchUsers(
      currentUser,
      query,
      restaurantId === undefined ? undefined : String(restaurantId),
      limit,
    );

    return c.json({ success: true, data: results });
  },
);

/**
 * GET /api/v1/users/notification-settings
 */
app.get("/notification-settings", authMiddleware, async (c) => {
  const user = c.get("user");
  const stored = (await c.env.CACHE_KV.get(
    createNotificationSettingsKey(user.id),
    "json",
  )) as NotificationSettingsRecord | null;

  return c.json({
    success: true,
    data: stored?.settings ?? {},
  });
});

/**
 * PUT /api/v1/users/notification-settings
 */
app.put(
  "/notification-settings",
  authMiddleware,
  validateBody(notificationSettingsSchema),
  async (c) => {
    const user = c.get("user");
    const settings = c.get("validatedBody");
    const now = new Date().toISOString();
    const record = {
      userId: user.id,
      settings,
      updatedAt: now,
    };

    await c.env.CACHE_KV.put(
      createNotificationSettingsKey(user.id),
      JSON.stringify(record),
    );

    return c.json({
      success: true,
      data: {
        settings,
        updatedAt: now,
      },
    });
  },
);

/**
 * POST /api/v1/users/favorites/sync
 */
app.post(
  "/favorites/sync",
  authMiddleware,
  validateBody(userSyncSchema),
  async (c) => {
    return storeUserSyncPayload(c, "favorites-sync", c.get("validatedBody"));
  },
);

/**
 * POST /api/v1/users/settings/sync
 */
app.post(
  "/settings/sync",
  authMiddleware,
  validateBody(userSyncSchema),
  async (c) => {
    return storeUserSyncPayload(c, "settings-sync", c.get("validatedBody"));
  },
);

/**
 * POST /api/v1/users/preferences/batch-sync
 */
app.post(
  "/preferences/batch-sync",
  authMiddleware,
  validateBody(userSyncSchema),
  async (c) => {
    return storeUserSyncPayload(
      c,
      "preferences-batch-sync",
      c.get("validatedBody"),
    );
  },
);

/**
 * GET /api/v1/users/:id
 */
app.get(
  "/:id",
  authMiddleware,
  validateParams(userIdParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const user = await usersService.getUserById(currentUser, id);

    return c.json({ success: true, data: user });
  },
);

/**
 * POST /api/v1/users
 */
app.post(
  "/",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateBody(createUserSchema),
  async (c) => {
    const data = c.get("validatedBody");
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const user = await usersService.createUser(
      currentUser,
      toCreateUserData(data as CreateUserInput),
    );

    return c.json({ success: true, data: user }, 201);
  },
);

/**
 * PUT /api/v1/users/:id
 */
app.put(
  "/:id",
  authMiddleware,
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const data = c.get("validatedBody") as UpdateUserInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const user = await usersService.updateUser(currentUser, id, data);

    return c.json({ success: true, data: user });
  },
);

/**
 * POST /api/v1/users/:id/password
 */
app.post(
  "/:id/password",
  authMiddleware,
  validateParams(userIdParamSchema),
  validateBody(updatePasswordSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const { currentPassword, newPassword } = c.get(
      "validatedBody",
    ) as UpdatePasswordInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    await usersService.changePassword(
      currentUser,
      id,
      currentPassword,
      newPassword,
    );

    return c.json({ success: true, message: "Password updated successfully" });
  },
);

/**
 * PATCH /api/v1/users/:id/status
 */
app.patch(
  "/:id/status",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(userIdParamSchema),
  validateBody(userStatusSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const { isActive } = c.get("validatedBody") as UserStatusInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const message = await usersService.updateUserStatus(
      currentUser,
      id,
      isActive,
    );

    return c.json({ success: true, message });
  },
);

/**
 * DELETE /api/v1/users/:id
 *
 * Removes a departed employee from the roster. Archival, not a row delete --
 * see UserService.archiveUser for the foreign keys that make a real delete
 * either impossible or destructive (#337).
 */
app.delete(
  "/:id",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(userIdParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const message = await usersService.archiveUser(currentUser, id);

    return c.json({ success: true, message });
  },
);

/**
 * POST /api/v1/users/:id/restore
 *
 * Rehire: puts an archived employee back on the active roster.
 */
app.post(
  "/:id/restore",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(userIdParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    const message = await usersService.restoreUser(currentUser, id);

    return c.json({ success: true, message });
  },
);

/**
 * PATCH /api/v1/users/:id/verify
 */
app.patch(
  "/:id/verify",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(userIdParamSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    await usersService.verifyUser(currentUser, id);

    return c.json({ success: true, message: "User verified successfully" });
  },
);

/**
 * POST /api/v1/users/:id/reset-password
 */
app.post(
  "/:id/reset-password",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(userIdParamSchema),
  validateBody(resetPasswordSchema),
  async (c) => {
    const { id } = c.get("validatedParams") as IdParamInput;
    const { newPassword } = c.get("validatedBody") as ResetPasswordInput;
    const currentUser = c.get("user");
    const usersService = new UsersService(c.env);

    await usersService.resetPassword(currentUser, id, newPassword);

    return c.json({ success: true, message: "Password reset successfully" });
  },
);

export default app;
