import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import routes from "./index";

const currentUser: AuthUser = {
  id: "user-7",
  username: "admin",
  role: 0,
  restaurantId: "restaurant-1",
};
const serviceMethods = vi.hoisted(() => ({
  getUsers: vi.fn(),
  getUserStats: vi.fn(),
  searchUsers: vi.fn(),
  getUserById: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  changeUserRole: vi.fn(),
  changePassword: vi.fn(),
  updateUserStatus: vi.fn(),
  verifyUser: vi.fn(),
  resetPassword: vi.fn(),
}));
const usersService = vi.hoisted(() =>
  vi.fn(function UsersService() {
    return serviceMethods;
  }),
);

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (key: "user", value: typeof currentUser) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", currentUser);
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

vi.mock("../services/UsersService", () => ({
  UsersService: usersService,
}));

function createEnv() {
  const kv = new Map<string, string>();
  return {
    CACHE_KV: {
      get: vi.fn(async (key: string, type?: string) => {
        const value = kv.get(key) ?? null;
        return type === "json" && value ? JSON.parse(value) : value;
      }),
      put: vi.fn(async (key: string, value: string) => {
        kv.set(key, value);
      }),
    },
  };
}

const strongPassword = "Newpass1!";

describe("users routes", () => {
  beforeEach(() => {
    usersService.mockClear();
    for (const method of Object.values(serviceMethods)) {
      method.mockReset();
    }
  });

  it("lists users with normalized filters", async () => {
    serviceMethods.getUsers.mockResolvedValue({
      data: [{ id: 1, username: "owner" }],
      pagination: { page: 2, limit: 5, total: 1 },
    });

    const response = await routes.fetch(
      new Request(
        "https://test/?restaurantId=123&role=1&isActive=true&page=2&limit=5",
      ),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 1, username: "owner" }],
    });
    expect(serviceMethods.getUsers).toHaveBeenCalledWith(currentUser, {
      restaurantId: "123",
      role: 1,
      isActive: true,
      page: 2,
      limit: 5,
    });
  });

  it("returns user stats and search results", async () => {
    serviceMethods.getUserStats.mockResolvedValue({
      summary: { total_users: 3 },
      by_role: {},
    });
    const statsResponse = await routes.fetch(
      new Request("https://test/stats?restaurantId=456"),
      createEnv() as never,
    );
    expect(statsResponse.status).toBe(200);
    expect(serviceMethods.getUserStats).toHaveBeenCalledWith(
      currentUser,
      "456",
    );

    serviceMethods.searchUsers.mockResolvedValue([
      { id: 2, username: "cashier" },
    ]);
    const searchResponse = await routes.fetch(
      new Request("https://test/search?query=cas&restaurantId=456&limit=3"),
      createEnv() as never,
    );
    expect(searchResponse.status).toBe(200);
    await expect(searchResponse.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 2, username: "cashier" }],
    });
    expect(serviceMethods.searchUsers).toHaveBeenCalledWith(
      currentUser,
      "cas",
      "456",
      3,
    );
  });

  it("reads and writes notification settings in KV", async () => {
    const env = createEnv();
    await env.CACHE_KV.put(
      "customer:notification-settings:user-7",
      JSON.stringify({ settings: { email: true } }),
    );

    const getResponse = await routes.fetch(
      new Request("https://test/notification-settings"),
      env as never,
    );
    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toMatchObject({
      success: true,
      data: { email: true },
    });

    const putResponse = await routes.fetch(
      new Request("https://test/notification-settings", {
        method: "PUT",
        body: JSON.stringify({ sms: false }),
      }),
      env as never,
    );
    expect(putResponse.status).toBe(200);
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "customer:notification-settings:user-7",
      expect.stringContaining('"sms":false'),
    );
  });

  it("stores user sync payloads with stable and latest keys", async () => {
    const env = createEnv();

    const response = await routes.fetch(
      new Request("https://test/favorites/sync", {
        method: "POST",
        body: JSON.stringify({ sync_id: "device 1", favorites: [1, 2] }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        syncId: "device%201",
        synced: true,
        syncType: "favorites-sync",
      },
    });
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "customer:favorites-sync:user-7:device%201",
      expect.stringContaining('"favorites":[1,2]'),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      "customer:favorites-sync:user-7:latest",
      expect.any(String),
      { expirationTtl: 60 * 60 * 24 * 30 },
    );
  });

  it("fetches, creates, and updates users through the service", async () => {
    serviceMethods.getUserById.mockResolvedValue({ id: 42, username: "chef" });
    const getResponse = await routes.fetch(
      new Request("https://test/42"),
      createEnv() as never,
    );
    expect(getResponse.status).toBe(200);
    expect(serviceMethods.getUserById).toHaveBeenCalledWith(currentUser, "42");

    serviceMethods.createUser.mockResolvedValue({
      id: 43,
      username: "new-owner",
    });
    const createResponse = await routes.fetch(
      new Request("https://test/", {
        method: "POST",
        body: JSON.stringify({
          username: "new-owner",
          fullName: "New Owner",
          password: strongPassword,
          role: 1,
          restaurantId: 123,
        }),
      }),
      createEnv() as never,
    );
    expect(createResponse.status).toBe(201);
    expect(serviceMethods.createUser).toHaveBeenCalledWith(
      currentUser,
      expect.objectContaining({
        username: "new-owner",
        restaurantId: "123",
      }),
    );

    serviceMethods.updateUser.mockResolvedValue({
      id: 42,
      fullName: "Updated Name",
    });
    const updateResponse = await routes.fetch(
      new Request("https://test/42", {
        method: "PUT",
        body: JSON.stringify({ fullName: "Updated Name" }),
      }),
      createEnv() as never,
    );
    expect(updateResponse.status).toBe(200);
    expect(serviceMethods.updateUser).toHaveBeenCalledWith(currentUser, "42", {
      fullName: "Updated Name",
    });
  });

  it("changes and resets passwords through the service", async () => {
    serviceMethods.changePassword.mockResolvedValue(undefined);
    const changeResponse = await routes.fetch(
      new Request("https://test/42/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: "Oldpass1!",
          newPassword: strongPassword,
          confirmPassword: strongPassword,
        }),
      }),
      createEnv() as never,
    );
    expect(changeResponse.status).toBe(200);
    expect(serviceMethods.changePassword).toHaveBeenCalledWith(
      currentUser,
      "42",
      "Oldpass1!",
      strongPassword,
    );

    serviceMethods.resetPassword.mockResolvedValue(undefined);
    const resetResponse = await routes.fetch(
      new Request("https://test/42/reset-password", {
        method: "POST",
        body: JSON.stringify({
          newPassword: strongPassword,
          confirmPassword: strongPassword,
        }),
      }),
      createEnv() as never,
    );
    expect(resetResponse.status).toBe(200);
    expect(serviceMethods.resetPassword).toHaveBeenCalledWith(
      currentUser,
      "42",
      strongPassword,
    );
  });

  it("delegates a privileged role change to the service", async () => {
    serviceMethods.changeUserRole.mockResolvedValue({
      id: "42",
      role: 4,
      role_name: "Cashier",
    });

    const response = await routes.fetch(
      new Request("https://test/42/role", {
        method: "PATCH",
        body: JSON.stringify({ role: 4 }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { id: "42", role: 4 },
    });
    expect(serviceMethods.changeUserRole).toHaveBeenCalledWith(
      currentUser,
      "42",
      4,
    );
  });

  it("updates status and verifies users", async () => {
    serviceMethods.updateUserStatus.mockResolvedValue("User deactivated");
    const statusResponse = await routes.fetch(
      new Request("https://test/42/status", {
        method: "PATCH",
        body: JSON.stringify({ isActive: false }),
      }),
      createEnv() as never,
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      success: true,
      message: "User deactivated",
    });
    expect(serviceMethods.updateUserStatus).toHaveBeenCalledWith(
      currentUser,
      "42",
      false,
    );

    serviceMethods.verifyUser.mockResolvedValue(undefined);
    const verifyResponse = await routes.fetch(
      new Request("https://test/42/verify", {
        method: "PATCH",
      }),
      createEnv() as never,
    );
    expect(verifyResponse.status).toBe(200);
    expect(serviceMethods.verifyUser).toHaveBeenCalledWith(currentUser, "42");
  });
});
