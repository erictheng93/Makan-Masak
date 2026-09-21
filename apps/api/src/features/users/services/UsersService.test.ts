import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersService } from "./UsersService";
import type { Env } from "../../../types/env";

const dbMocks = vi.hoisted(() => ({
  userServiceFns: {
    getUserById: vi.fn(),
    getAllUsers: vi.fn(),
    getRestaurantUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    changeUserRole: vi.fn(),
    verifyUser: vi.fn(),
    resetPassword: vi.fn(),
    getUserStats: vi.fn(),
    searchUsers: vi.fn(),
  },
  authServiceFns: {
    changePassword: vi.fn(),
  },
  UserServiceCtor: vi.fn(),
  AuthServiceCtor: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  USER_ROLES: {
    ADMIN: 0,
    OWNER: 1,
    CHEF: 2,
    SERVICE: 3,
    CASHIER: 4,
    CUSTOMER: 5,
  },
  UserService: vi.fn(function UserService(...args: unknown[]) {
    dbMocks.UserServiceCtor(...args);
    return dbMocks.userServiceFns;
  }),
  AuthService: vi.fn(function AuthService(...args: unknown[]) {
    dbMocks.AuthServiceCtor(...args);
    return dbMocks.authServiceFns;
  }),
}));

const env = {
  DB: { binding: "db" },
  INTERNAL_API_TOKEN: "internal-token",
  MANAGEMENT_API: {
    fetch: vi.fn(),
  },
} as unknown as Env;

const admin = { id: "user-1", role: 0 };
const owner = { id: "user-10", role: 1, restaurantId: "restaurant-1" };
const cashier = { id: "user-42", role: 4, restaurantId: "restaurant-1" };

function createService() {
  return new UsersService(env);
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-42",
    username: "cashier",
    role: 4,
    restaurantId: "restaurant-1",
    email: "cashier@example.test",
    fullName: "Casey Cashier",
    phone: "+60123456789",
    address: "1 Test Street",
    dateOfBirth: "1990-01-01",
    profileImageUrl: "https://cdn.example.test/profile.jpg",
    isActive: true,
    isVerified: false,
    preferences: { language: "en-MY" },
    totalOrders: 12,
    totalSpent: 3450,
    lastLoginAt: "2026-06-07T01:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("UsersService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(env.MANAGEMENT_API!.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            tenant: {
              id: "T-20260630-ABC12345",
              platformRestaurantId: "restaurant-1",
              ownerUserId: "owner-1",
              ownerUsername: "owner",
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  it("constructs database services with the API database binding", () => {
    createService();

    expect(dbMocks.UserServiceCtor).toHaveBeenCalledWith(env.DB, env);
    expect(dbMocks.AuthServiceCtor).toHaveBeenCalledWith(env.DB, env);
  });

  it("evaluates management, viewing, and update permissions by role and restaurant", () => {
    const service = createService();

    expect(service.canManageUser(admin, 1, "any")).toBe(true);
    expect(service.canManageUser(owner, 2, "restaurant-1")).toBe(true);
    expect(service.canManageUser(owner, 4, "restaurant-1")).toBe(true);
    expect(service.canManageUser(owner, 5, "restaurant-1")).toBe(false);
    expect(service.canManageUser(owner, 2, "restaurant-2")).toBe(false);
    expect(service.canManageUser(cashier, 4, "restaurant-1")).toBe(false);

    expect(
      service.canViewUser(owner, {
        id: "user-99",
        restaurantId: "restaurant-1",
      }),
    ).toBe(true);
    expect(service.canViewUser(cashier, { id: "user-42" })).toBe(true);
    expect(
      service.canViewUser(cashier, {
        id: "user-99",
        restaurantId: "restaurant-1",
      }),
    ).toBe(false);

    expect(service.canUpdateUser(cashier, { id: "user-42", role: 4 })).toBe(
      true,
    );
    expect(
      service.canUpdateUser(owner, {
        id: "user-43",
        role: 4,
        restaurantId: "restaurant-1",
      }),
    ).toBe(true);
    expect(
      service.canUpdateUser(owner, {
        id: "user-44",
        role: 4,
        restaurantId: "restaurant-2",
      }),
    ).toBe(false);
  });

  it("formats users with role names and preserves optional profile fields", () => {
    expect(createService().formatUser(user())).toEqual({
      id: "user-42",
      username: "cashier",
      role: 4,
      role_name: "Cashier",
      restaurantId: "restaurant-1",
      email: "cashier@example.test",
      fullName: "Casey Cashier",
      phone: "+60123456789",
      address: "1 Test Street",
      dateOfBirth: "1990-01-01",
      profileImageUrl: "https://cdn.example.test/profile.jpg",
      isActive: true,
      isVerified: false,
      preferences: { language: "en-MY" },
      totalOrders: 12,
      totalSpent: 3450,
      lastLoginAt: "2026-06-07T01:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-06-07T00:00:00.000Z",
      // Archive state is part of the response shape now. A user the fixture
      // says nothing about is not archived -- `formatUser` normalises the
      // absent flag to `false` and the absent timestamp to `null` rather than
      // letting `undefined` reach the client.
      isArchived: false,
      archivedAt: null,
    });
    expect(createService().formatUser(user({ role: 99 })).role_name).toBe(
      "Unknown",
    );
  });

  it("reports the archive state of a departed employee", () => {
    // The removal/rehire feature added these two fields to `formatUser` but
    // nothing asserted them, so the only signal that they existed was this
    // suite's exact-match failing on two unexpected keys. Pin the populated
    // direction too: normalising an absent flag to `false` is worthless if a
    // present one does not survive.
    const archived = createService().formatUser(
      user({ isArchived: true, archivedAt: "2026-09-01T00:00:00.000Z" }),
    );

    expect(archived).toMatchObject({
      isArchived: true,
      archivedAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("lists all users for admins and constrains owners to their restaurant", async () => {
    dbMocks.userServiceFns.getAllUsers.mockResolvedValueOnce({
      users: [user({ id: "user-1", role: 1, username: "owner" })],
      pagination: { page: 1, limit: 20, total: 1 },
    });
    dbMocks.userServiceFns.getRestaurantUsers.mockResolvedValueOnce({
      users: [user()],
      pagination: { page: 2, limit: 5, total: 1 },
    });
    const service = createService();

    await expect(
      service.getUsers(admin, {
        restaurantId: "restaurant-2",
        role: 1,
        page: 1,
        limit: 20,
      }),
    ).resolves.toMatchObject({
      data: [{ id: "user-1", role_name: "Shop Owner" }],
      pagination: { total: 1 },
    });
    expect(dbMocks.userServiceFns.getAllUsers).toHaveBeenCalledWith({
      restaurantId: "restaurant-2",
      role: 1,
      page: 1,
      limit: 20,
    });

    await expect(
      service.getUsers(owner, {
        restaurantId: "restaurant-2",
        page: 2,
        limit: 5,
      }),
    ).resolves.toMatchObject({
      data: [{ id: "user-42", role_name: "Cashier" }],
    });
    expect(dbMocks.userServiceFns.getRestaurantUsers).toHaveBeenCalledWith(
      "restaurant-1",
      { restaurantId: "restaurant-1", page: 2, limit: 5 },
    );
  });

  it("reads user detail only when the caller can view the target", async () => {
    dbMocks.userServiceFns.getUserById
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(user({ restaurantId: "restaurant-2" }))
      .mockResolvedValueOnce(null);
    const service = createService();

    await expect(service.getUserById(owner, "user-42")).resolves.toMatchObject({
      id: "user-42",
      role_name: "Cashier",
    });
    await expect(service.getUserById(owner, "user-43")).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Access denied",
    });
    await expect(service.getUserById(admin, "user-404")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "User not found",
    });
  });

  it("creates users with effective restaurant scope and rejects forbidden roles", async () => {
    dbMocks.userServiceFns.createUser.mockResolvedValueOnce(
      user({ id: "user-50", username: "chef", role: 2 }),
    );
    const service = createService();

    await expect(
      service.createUser(owner, {
        username: "chef",
        fullName: "Chef",
        password: "Secret1!",
        role: 2,
      }),
    ).resolves.toMatchObject({
      id: "user-50",
      role_name: "Chef",
    });
    expect(dbMocks.userServiceFns.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "chef",
        role: 2,
        restaurantId: "restaurant-1",
      }),
    );

    await expect(
      service.createUser(owner, {
        username: "customer",
        fullName: "Customer",
        password: "Secret1!",
        role: 5,
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Insufficient permissions to create this type of user",
    });
  });

  // #67: canManageUser waves an admin through unconditionally, so an admin
  // creating a restaurant-scoped user with no restaurant produced a row with a
  // NULL restaurant_id — an account nobody can administer, because ownership is
  // decided by that column. POST /auth/register-staff enforces this; this entry
  // point has to as well, or the orphan just moves here.
  it("refuses to create restaurant-scoped users with no restaurant", async () => {
    const service = createService();

    await expect(
      service.createUser(admin, {
        username: "cashier",
        fullName: "Cashier",
        password: "Secret1!",
        role: 4,
      }),
    ).rejects.toMatchObject({
      code: "RESTAURANT_ID_REQUIRED",
      message: "Restaurant ID is required for restaurant-scoped roles",
    });
    expect(dbMocks.userServiceFns.createUser).not.toHaveBeenCalled();
  });

  it("keeps a platform admin unbound to any restaurant", async () => {
    dbMocks.userServiceFns.createUser.mockResolvedValueOnce(
      user({ id: "user-51", username: "admin2", role: 0 }),
    );
    const service = createService();

    await service.createUser(admin, {
      username: "admin2",
      fullName: "Admin Two",
      password: "Secret1!",
      role: 0,
      restaurantId: "restaurant-1",
    });

    expect(dbMocks.userServiceFns.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 0, restaurantId: undefined }),
    );
  });

  it("links newly created owner users back to the management tenant", async () => {
    dbMocks.userServiceFns.createUser.mockResolvedValueOnce(
      user({
        id: "owner-1",
        username: "owner",
        role: 1,
        restaurantId: "restaurant-1",
        fullName: "Owner User",
      }),
    );

    await expect(
      createService().createUser(admin, {
        username: "owner",
        fullName: "Owner User",
        password: "Secret1!",
        role: 1,
        restaurantId: "restaurant-1",
      }),
    ).resolves.toMatchObject({
      id: "owner-1",
      role_name: "Shop Owner",
      restaurantId: "restaurant-1",
    });

    expect(env.MANAGEMENT_API!.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "https://management.internal/api/v1/internal/platform-restaurants/restaurant-1/owner",
      }),
    );
    const request = vi.mocked(env.MANAGEMENT_API!.fetch).mock.calls[0][0] as
      | Request
      | URL
      | string;
    expect(request).toBeInstanceOf(Request);
    await expect((request as Request).json()).resolves.toEqual({
      ownerUserId: "owner-1",
      ownerUsername: "owner",
    });
  });

  it("deactivates a newly created owner when management owner linking fails", async () => {
    dbMocks.userServiceFns.createUser.mockResolvedValueOnce(
      user({
        id: "owner-1",
        username: "owner",
        role: 1,
        restaurantId: "restaurant-1",
        fullName: "Owner User",
      }),
    );
    dbMocks.userServiceFns.updateUser.mockResolvedValueOnce(
      user({
        id: "owner-1",
        username: "owner",
        role: 1,
        restaurantId: "restaurant-1",
        isActive: false,
      }),
    );
    vi.mocked(env.MANAGEMENT_API!.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          error: "Failed to link owner",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createService().createUser(admin, {
        username: "owner",
        fullName: "Owner User",
        password: "Secret1!",
        role: 1,
        restaurantId: "restaurant-1",
      }),
    ).rejects.toThrow("Failed to link owner");

    expect(dbMocks.userServiceFns.updateUser).toHaveBeenCalledWith("owner-1", {
      isActive: false,
    });
  });

  it("updates users and changes passwords with permission checks", async () => {
    dbMocks.userServiceFns.getUserById
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(user({ restaurantId: "restaurant-2" }));
    dbMocks.userServiceFns.updateUser.mockResolvedValueOnce(
      user({ fullName: "Updated Cashier" }),
    );
    dbMocks.authServiceFns.changePassword
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: "Wrong password" });
    const service = createService();

    await expect(
      service.updateUser(owner, "user-42", { fullName: "Updated Cashier" }),
    ).resolves.toMatchObject({ fullName: "Updated Cashier" });
    expect(dbMocks.userServiceFns.updateUser).toHaveBeenCalledWith("user-42", {
      fullName: "Updated Cashier",
    });

    await expect(
      service.updateUser(owner, "user-43", { fullName: "Nope" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access denied" });
    await expect(
      service.changePassword(cashier, "user-42", "Oldpass1!", "Newpass1!"),
    ).resolves.toBeUndefined();
    expect(dbMocks.authServiceFns.changePassword).toHaveBeenCalledWith(
      "user-42",
      "Oldpass1!",
      "Newpass1!",
    );
    await expect(
      service.changePassword(cashier, "user-99", "Oldpass1!", "Newpass1!"),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access denied" });
    await expect(
      service.changePassword(admin, "user-99", "wrong", "Newpass1!"),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Wrong password",
    });
  });

  it("changes managed restaurant roles, revokes old tokens, and rejects unsafe changes", async () => {
    dbMocks.userServiceFns.getUserById
      .mockResolvedValueOnce(user({ role: 2 }))
      .mockResolvedValueOnce(user({ restaurantId: "restaurant-2" }))
      .mockResolvedValueOnce(user({ role: 2 }))
      .mockResolvedValueOnce(user({ role: 2 }));
    dbMocks.userServiceFns.changeUserRole.mockResolvedValueOnce(
      user({ role: 4 }),
    );
    const service = createService();

    await expect(
      service.changeUserRole(owner, "user-42", 4),
    ).resolves.toMatchObject({
      role: 4,
      role_name: "Cashier",
    });
    expect(dbMocks.userServiceFns.changeUserRole).toHaveBeenCalledWith(
      "user-42",
      4,
      {
        actorId: "user-10",
        restaurantId: "restaurant-1",
        previousRole: 2,
      },
    );

    await expect(
      service.changeUserRole(owner, "user-43", 4),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.changeUserRole(owner, "user-42", 0),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      service.changeUserRole(admin, "user-42", 0),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot change a user between platform and restaurant roles",
    });
    await expect(
      service.changeUserRole(owner, "user-10", 4),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot change your own role",
    });
  });

  it("updates status, verifies users, and resets passwords through managed-user checks", async () => {
    dbMocks.userServiceFns.getUserById
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(user({ id: "user-10", role: 1 }))
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(user())
      .mockResolvedValueOnce(user());
    dbMocks.userServiceFns.updateUser.mockResolvedValueOnce(user());
    dbMocks.userServiceFns.verifyUser
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    dbMocks.userServiceFns.resetPassword.mockResolvedValueOnce(true);
    const service = createService();

    await expect(
      service.updateUserStatus(owner, "user-42", false),
    ).resolves.toBe("User deactivated successfully");
    expect(dbMocks.userServiceFns.updateUser).toHaveBeenCalledWith("user-42", {
      isActive: false,
    });
    await expect(
      service.updateUserStatus({ id: "user-10", role: 0 }, "user-10", false),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot deactivate your own account",
    });
    await expect(service.verifyUser(owner, "user-42")).resolves.toBeUndefined();
    await expect(service.verifyUser(owner, "user-42")).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "Failed to verify user",
    });
  });

  it("rejects password resets outside the manager's restaurant", async () => {
    dbMocks.userServiceFns.getUserById.mockReset();
    dbMocks.userServiceFns.getUserById.mockResolvedValueOnce(
      user({ restaurantId: "restaurant-2" }),
    );

    await expect(
      createService().resetPassword(owner, "user-42", "Newpass1!"),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Insufficient permissions",
    });
  });

  it("formats stats and constrains stats/search restaurant scopes", async () => {
    dbMocks.userServiceFns.getUserStats
      .mockResolvedValueOnce({
        totalUsers: 6,
        activeUsers: 4,
        recentRegistrations: 2,
        byRole: { 1: 1, 4: 3, 99: 2 },
      })
      .mockResolvedValueOnce({
        totalUsers: 1,
        activeUsers: 1,
        recentRegistrations: 0,
        byRole: { 4: 1 },
      });
    dbMocks.userServiceFns.searchUsers
      .mockResolvedValueOnce([user()])
      .mockResolvedValueOnce([user({ restaurantId: "restaurant-2" })]);
    const service = createService();

    await expect(service.getUserStats(admin, "restaurant-2")).resolves.toEqual({
      summary: {
        total_users: 6,
        active_users: 4,
        inactive_users: 2,
        new_users_month: 2,
      },
      by_role: {
        1: { count: 1, role_name: "Shop Owner" },
        4: { count: 3, role_name: "Cashier" },
        99: { count: 2, role_name: "Unknown" },
      },
    });
    expect(dbMocks.userServiceFns.getUserStats).toHaveBeenCalledWith(
      "restaurant-2",
    );

    await service.getUserStats(owner, "restaurant-2");
    expect(dbMocks.userServiceFns.getUserStats).toHaveBeenLastCalledWith(
      "restaurant-1",
    );

    await expect(
      service.searchUsers(admin, "cash", "restaurant-2", 3),
    ).resolves.toMatchObject([{ id: "user-42", role_name: "Cashier" }]);
    expect(dbMocks.userServiceFns.searchUsers).toHaveBeenCalledWith(
      "cash",
      "restaurant-2",
      3,
    );

    await service.searchUsers(owner, "cash", "restaurant-2", 5);
    expect(dbMocks.userServiceFns.searchUsers).toHaveBeenLastCalledWith(
      "cash",
      "restaurant-1",
      5,
    );
  });
});
