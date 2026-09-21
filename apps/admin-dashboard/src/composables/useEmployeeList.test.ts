import { beforeEach, describe, expect, it, vi } from "vitest";

// users.id is a TEXT UUID v7 (#331). These fixtures are deliberately
// UUID-shaped rather than "1"/"2": a numeric-looking string survives
// Number()/parseInt intact, so it would not catch the bug this guards.
const CHEF = "019469a1-0001-7000-8000-000000000001";
const OWNER = "019469a1-0002-7000-8000-000000000002";
const CASHIER = "019469a1-0003-7000-8000-000000000003";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiPatch = vi.fn();
vi.mock("@/services/api", () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}));

const getClockedInEmployees = vi.fn();
vi.mock("@/services/schedulingService", () => ({
  schedulingService: {
    getClockedInEmployees: (...args: unknown[]) =>
      getClockedInEmployees(...args),
    getSchedules: vi.fn(),
  },
}));

import { useEmployeeList } from "./useEmployeeList";

const apiUser = (id: string, username: string) => ({
  id,
  username,
  fullName: username,
  role: 2,
  isActive: true,
  createdAt: "2026-09-05T00:00:00.000Z",
});

describe("useEmployeeList status lookup", () => {
  beforeEach(async () => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiPatch.mockReset();
    getClockedInEmployees.mockReset();

    // Module-level state is shared across callers, so every test reseeds it.
    apiGet.mockImplementation((url: string) => {
      if (url.startsWith("/users")) {
        return Promise.resolve({
          data: {
            success: true,
            data: [
              apiUser(CHEF, "chef"),
              apiUser(OWNER, "owner"),
              apiUser(CASHIER, "cashier"),
            ],
          },
        });
      }
      // /leaves/:id/requests
      return Promise.resolve({
        data: {
          data: [
            {
              employeeId: CASHIER,
              leaveType: { name: "Annual" },
              endDate: "2026-09-06",
            },
          ],
        },
      });
    });

    getClockedInEmployees.mockResolvedValue([
      {
        id: 41,
        employeeId: CHEF,
        clockInTime: "2026-09-05T01:00:00.000Z",
      },
    ]);

    const list = useEmployeeList();
    await list.fetchUsers();
    await list.fetchClockedIn();
    await list.fetchTodayLeaves();
  });

  it("matches a clocked-in schedule to its user by UUID id", () => {
    const { usersWithStatus } = useEmployeeList();
    const byId = new Map(usersWithStatus.value.map((u) => [u.id, u]));

    expect(byId.get(CHEF)?.clockInStatus).toEqual({
      isClockedIn: true,
      clockInTime: "2026-09-05T01:00:00.000Z",
      scheduleId: 41,
    });
    expect(byId.get(OWNER)?.clockInStatus).toEqual({ isClockedIn: false });
  });

  it("matches an approved leave request to its user by UUID id", () => {
    const { usersWithStatus } = useEmployeeList();
    const byId = new Map(usersWithStatus.value.map((u) => [u.id, u]));

    expect(byId.get(CASHIER)?.leaveStatus).toEqual({
      isOnLeave: true,
      leaveType: "Annual",
      endDate: "2026-09-06",
    });
    expect(byId.get(CHEF)?.leaveStatus).toEqual({ isOnLeave: false });
  });

  it("keeps ids as strings, so Number()-ing either side cannot match", () => {
    const { users, clockedInList } = useEmployeeList();

    // The regression guard: the moment anything coerces one side of the
    // lookup to a number, Number(uuid) is NaN and parseInt(uuid) is a
    // truncated integer — either way the map lookup silently misses and the
    // UI just reports "nobody on shift".
    expect(typeof users.value[0].id).toBe("string");
    expect(typeof clockedInList.value[0].employeeId).toBe("string");
    expect(Number(CHEF)).toBeNaN();
    expect(parseInt(CHEF, 10)).not.toBe(CHEF);
  });

  it("verifies the clocked-in fetch was scoped to the restaurant", () => {
    expect(getClockedInEmployees).toHaveBeenCalledWith("restaurant-1");
  });

  it("updates profile, role, and active state through their distinct endpoints", async () => {
    const list = useEmployeeList();
    const employee = list.users.value.find((user) => user.id === CHEF)!;

    await list.updateUser(employee, {
      username: employee.username,
      password: "",
      fullName: "Updated Chef",
      email: "updated-chef@example.test",
      role: 4,
      status: "inactive",
    });

    expect(apiPut).toHaveBeenCalledWith(`/users/${CHEF}`, {
      fullName: "Updated Chef",
      email: "updated-chef@example.test",
    });
    expect(apiPut).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: expect.anything() }),
    );
    expect(apiPatch).toHaveBeenCalledWith(`/users/${CHEF}/role`, { role: 4 });
    expect(apiPatch).toHaveBeenCalledWith(`/users/${CHEF}/status`, {
      isActive: false,
    });
  });
});
