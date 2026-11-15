import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersService } from "./UsersService";
import type { Env } from "../../../types/env";

const mocks = vi.hoisted(() => ({
  fns: {
    getUserById: vi.fn(),
    getAllUsers: vi.fn(),
    getRestaurantUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    searchUsers: vi.fn(),
  },
  resolveRestaurantCurrency: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  USER_ROLES: { ADMIN: 0, OWNER: 1, CHEF: 2, SERVICE: 3, CASHIER: 4 },
  UserService: vi.fn(function UserService() {
    return mocks.fns;
  }),
  AuthService: vi.fn(function AuthService() {
    return {};
  }),
}));
vi.mock("../../../shared/utils/restaurant-currency", () => ({
  resolveRestaurantCurrency: mocks.resolveRestaurantCurrency,
}));

const env = { DB: {}, CACHE_KV: { delete: vi.fn() } } as unknown as Env;
const admin = { id: "a", role: 0, adminTier: "administrator" };
const owner = { id: "o1", role: 1, restaurantId: "shop-1" };
const otherOwner = { id: "o2", role: 1, restaurantId: "shop-2" };
const cashier = { id: "c1", role: 4, restaurantId: "shop-1" };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    username: "cashier",
    role: 4,
    restaurantId: "shop-1",
    isActive: true,
    isVerified: true,
    hourlyRateCents: 15000,
    ...overrides,
  };
}

describe("UsersService hourly wage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRestaurantCurrency.mockResolvedValue("TWD");
    mocks.fns.getUserById.mockResolvedValue(row());
    mocks.fns.updateUser.mockImplementation((_id, data) =>
      Promise.resolve(row(data)),
    );
  });

  it("owner sets a wage and sees it in the response", async () => {
    const result = await new UsersService(env).updateUser(owner, "c1", {
      hourlyRateCents: 20000,
    });

    expect(mocks.fns.updateUser).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ hourlyRateCents: 20000 }),
    );
    expect(result.hourlyRateCents).toBe(20000);
  });

  it("owner reads the wage in detail and list responses", async () => {
    const svc = new UsersService(env);
    expect((await svc.getUserById(owner, "c1")).hourlyRateCents).toBe(15000);

    mocks.fns.getRestaurantUsers.mockResolvedValue({
      users: [row()],
      pagination: {},
    });
    const list = await svc.getUsers({ ...owner }, {});
    expect(list.data[0]).toEqual(
      expect.objectContaining({ hourlyRateCents: 15000 }),
    );
  });

  it("owner creates an employee with a wage", async () => {
    mocks.fns.createUser.mockResolvedValue(row({ id: "new" }));
    await new UsersService(env).createUser(owner, {
      username: "newbie",
      fullName: "N",
      password: "x",
      role: 4,
      hourlyRateCents: 20000,
    });
    expect(mocks.fns.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        hourlyRateCents: 20000,
        restaurantId: "shop-1",
      }),
    );
  });

  it("null clears the wage; omitted leaves it out of the write", async () => {
    const svc = new UsersService(env);
    await svc.updateUser(owner, "c1", { hourlyRateCents: null });
    expect(mocks.fns.updateUser).toHaveBeenLastCalledWith(
      "c1",
      expect.objectContaining({ hourlyRateCents: null }),
    );

    await svc.updateUser(owner, "c1", { fullName: "X" });
    expect(mocks.fns.updateUser.mock.calls.at(-1)?.[1]).not.toHaveProperty(
      "hourlyRateCents",
    );
  });

  it("rejects a TWD wage that is not a whole dollar with CURRENCY_PRECISION", async () => {
    await expect(
      new UsersService(env).updateUser(owner, "c1", {
        hourlyRateCents: 15550,
      }),
    ).rejects.toMatchObject({ code: "CURRENCY_PRECISION", status: 400 });
    expect(mocks.fns.updateUser).not.toHaveBeenCalled();
  });

  it("a cashier cannot read the wage, even on their own row", async () => {
    const svc = new UsersService(env);
    expect(await svc.getUserById(cashier, "c1")).not.toHaveProperty(
      "hourlyRateCents",
    );

    mocks.fns.searchUsers.mockResolvedValue([row()]);
    const found = await svc.searchUsers(cashier, "c");
    expect(found[0]).not.toHaveProperty("hourlyRateCents");
  });

  it("a cashier cannot set a wage on themselves or anyone else", async () => {
    const svc = new UsersService(env);
    await expect(
      svc.updateUser(cashier, "c1", { hourlyRateCents: 1 }),
    ).rejects.toMatchObject({ status: 403, code: "WAGE_FORBIDDEN" });
    expect(mocks.fns.updateUser).not.toHaveBeenCalled();

    // A self-update without a wage still works and returns no wage.
    const result = await svc.updateUser(cashier, "c1", { fullName: "Me" });
    expect(result).not.toHaveProperty("hourlyRateCents");
  });

  it("another shop's owner can neither read nor set the wage", async () => {
    const svc = new UsersService(env);
    await expect(svc.getUserById(otherOwner, "c1")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      svc.updateUser(otherOwner, "c1", { hourlyRateCents: 20000 }),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.fns.updateUser).not.toHaveBeenCalled();
  });

  it("an admin can read and set a wage", async () => {
    const svc = new UsersService(env);
    const result = await svc.updateUser(admin, "c1", {
      hourlyRateCents: 30000,
    });
    expect(result.hourlyRateCents).toBe(30000);
  });
});
