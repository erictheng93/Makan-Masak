// Leave and schedule dates are business days (UTC+8), and archiving is asserted
// against them. Pin TZ to something that is neither +8 nor UTC so a local green
// does not turn into a different result on a UTC CI box.
process.env.TZ = "America/Los_Angeles";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcryptjs";
import {
  employeeLeaveBalances,
  employeeSchedules,
  leaveTypes,
  restaurants,
  users,
} from "../schema";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../testing/create-test-database";
import { AuthService } from "./auth";
import { LeaveService } from "./LeaveService";
import { SchedulingService } from "./SchedulingService";
import { UserService } from "./user";

const restaurantId = "archive-restaurant";
const jwtSecret = "0123456789abcdefghijklmnopqrstuvwxyz";
const env = { JWT_SECRET: jwtSecret, NODE_ENV: "test" };
const password = "CorrectHorse123!";
const seededAt = new Date("2026-06-07T12:00:00.000Z");
const workDate = "2026-06-10";
const year = 2026;

/**
 * Hashed once for the whole file, and at the lowest cost bcrypt accepts.
 *
 * Production hashes at cost 10 (see CLAUDE.md); that is a deliberate ~2.5s per
 * operation in bcryptjs, and `bcrypt.compare` inherits the cost recorded in the
 * hash it is checking against. Seeding three users and then logging in four
 * times would spend ~17s of pure key stretching against a 5s test budget. What
 * these tests assert is which accounts the archive lets through, not how
 * expensive the hash is, so the fixture uses cost 4. Do not copy this into
 * anything that writes a real password.
 */
const FIXTURE_BCRYPT_COST = 4;
let passwordHash: string;

interface Roster {
  ownerId: string;
  departingId: string;
  stayingId: string;
  leaveTypeId: number;
  scheduleId: number;
}

/**
 * A restaurant with three staff and one worked shift.
 *
 * `departing` is the one every test archives; `staying` is the control that has
 * to survive each exclusion, so a query that drops everyone reads as a failure
 * rather than a pass. The shift belongs to `departing` because the point of
 * archiving instead of deleting is that this row still resolves a name (#337).
 */
async function seedRoster(testDb: TestDatabase): Promise<Roster> {
  await testDb.drizzle.insert(restaurants).values({
    id: restaurantId,
    name: "Archive Restaurant",
    type: "restaurant",
    category: "casual",
    address: "1 Archive St",
    district: "Central",
    city: "Taipei",
    phone: "0200000002",
    settings: {},
    isAvailable: true,
    isActive: true,
    createdAt: seededAt,
    updatedAt: seededAt,
  } as never);

  const insertStaff = async (
    username: string,
    fullName: string,
    role: number,
  ) => {
    const [row] = await testDb.drizzle
      .insert(users)
      .values({
        username,
        fullName,
        passwordHash,
        role,
        restaurantId,
        isActive: true,
        isVerified: true,
        tokenVersion: 1,
        createdAt: seededAt,
        updatedAt: seededAt,
      } as never)
      .returning({ id: users.id });
    return row.id;
  };

  const ownerId = await insertStaff("archive-owner", "Archive Owner", 1);
  const departingId = await insertStaff("archive-leaver", "Chen Departing", 2);
  const stayingId = await insertStaff("archive-stayer", "Lin Staying", 2);

  const [leaveType] = await testDb.drizzle
    .insert(leaveTypes)
    .values({
      restaurantId,
      code: "AL",
      name: "Annual Leave",
      accrualType: "yearly",
      accrualAmount: 10,
      requiredApprovalLevels: 1,
      createdAt: seededAt,
      updatedAt: seededAt,
    } as never)
    .returning({ id: leaveTypes.id });

  const [schedule] = await testDb.drizzle
    .insert(employeeSchedules)
    .values({
      restaurantId,
      employeeId: departingId,
      workDate,
      startTime: "09:00",
      endTime: "17:00",
      scheduledHours: 8,
      status: "completed",
      createdBy: ownerId,
      createdAt: seededAt,
      updatedAt: seededAt,
    } as never)
    .returning({ id: employeeSchedules.id });

  return {
    ownerId,
    departingId,
    stayingId,
    leaveTypeId: leaveType.id,
    scheduleId: schedule.id,
  };
}

/**
 * Archive someone, then put `is_active` back to true.
 *
 * `archiveUser` deactivates as well, so a picker that still filters only on
 * `is_active` excludes a departed employee for the wrong reason — and a test
 * that just archives and asserts the exclusion stays green when the archive
 * check is deleted. Verified: reverting the three guards below and running this
 * file left the plain-archive assertions passing. Re-activating the row strips
 * the second signal, so these can only pass if `deleted_at` is what excludes
 * them.
 */
async function archiveButReactivate(
  testDb: TestDatabase,
  userService: UserService,
  id: string,
): Promise<void> {
  await userService.archiveUser(id);
  await testDb.drizzle
    .update(users)
    .set({ isActive: true })
    .where(eq(users.id, id));
}

describe("employee archive (#337)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    [testDb, passwordHash] = await Promise.all([
      createTestDatabase(),
      bcrypt.hash(password, FIXTURE_BCRYPT_COST),
    ]);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  it("takes a departed employee off the roster, the pickers and the counts", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const scheduling = new SchedulingService(testDb.bindings.DB, env);

    expect(await userService.archiveUser(roster.departingId)).toBe(true);

    // Default list — current staff only, which is what the roster and the
    // counts above it render.
    const current = await userService.getRestaurantUsers(restaurantId);
    expect(current!.users.map((u) => u.id).sort()).toEqual(
      [roster.ownerId, roster.stayingId].sort(),
    );
    expect(current!.total).toBe(2);

    // The departed tab asks for the other side of the archive.
    const departed = await userService.getRestaurantUsers(restaurantId, {
      archived: "only",
    });
    expect(departed!.users).toHaveLength(1);
    expect(departed!.users[0]).toMatchObject({
      id: roster.departingId,
      isArchived: true,
      isActive: false,
    });
    expect(departed!.users[0].archivedAt).toEqual(expect.any(String));

    // "Total staff" counts people who currently work here.
    const stats = await userService.getUserStats(restaurantId);
    expect(stats.totalUsers).toBe(2);
    expect(stats.activeUsers).toBe(2);
    expect(stats.byRole[2]).toBe(1);

    // Search must not offer them back.
    const found = await userService.searchUsers("Chen", restaurantId);
    expect(found).toEqual([]);

    // Neither may the scheduling picker. The date is deliberately not the one
    // they worked: on that date they would drop out for being already
    // scheduled, which would pass whether or not the archive is read.
    const available = await scheduling.getAvailableEmployees({
      restaurantId,
      date: "2026-06-11",
    });
    expect(available.map((e) => e.id).sort()).toEqual(
      [roster.ownerId, roster.stayingId].sort(),
    );
  });

  it("refuses to put a departed employee on a shift", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const scheduling = new SchedulingService(testDb.bindings.DB, env);

    await userService.archiveUser(roster.departingId);

    // A stale client still holding the id is the only way to reach this.
    await expect(
      scheduling.createSchedule({
        restaurantId,
        employeeId: roster.departingId,
        workDate: "2026-06-12",
        startTime: "09:00",
        endTime: "17:00",
        scheduledHours: 8,
        createdBy: roster.ownerId,
      } as never),
    ).rejects.toThrow("Employee not found in restaurant");

    // The control still schedules, so the guard is rejecting the archive and
    // not simply everything.
    await expect(
      scheduling.createSchedule({
        restaurantId,
        employeeId: roster.stayingId,
        workDate: "2026-06-12",
        startTime: "09:00",
        endTime: "17:00",
        scheduledHours: 8,
        createdBy: roster.ownerId,
      } as never),
    ).resolves.toMatchObject({ employeeId: roster.stayingId });
  });

  it("stops leave accruing and refuses new requests for a departed employee", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const leave = new LeaveService(testDb.bindings.DB, env);

    await userService.archiveUser(roster.departingId);

    await leave.accrueLeaveBalances(restaurantId, year);
    const balances = await testDb.drizzle
      .select({ employeeId: employeeLeaveBalances.employeeId })
      .from(employeeLeaveBalances);
    expect(balances.map((b) => b.employeeId).sort()).toEqual(
      [roster.ownerId, roster.stayingId].sort(),
    );

    await expect(
      leave.createLeaveRequest({
        restaurantId,
        employeeId: roster.departingId,
        leaveTypeId: roster.leaveTypeId,
        startDate: "2026-06-20",
        endDate: "2026-06-21",
        startPeriod: "full",
        endPeriod: "full",
        totalDays: 2,
        reason: "filed after departure",
      } as never),
    ).rejects.toThrow("Employee not found in restaurant");
  });

  it("keeps a departed employee resolvable, flagged, wherever history names them", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const scheduling = new SchedulingService(testDb.bindings.DB, env);

    await userService.archiveUser(roster.departingId);

    // The shift they worked is still there — a delete would have cascaded it
    // away, which is the whole reason removal is an archive.
    const shifts = await testDb.drizzle
      .select({ id: employeeSchedules.id })
      .from(employeeSchedules)
      .where(eq(employeeSchedules.employeeId, roster.departingId));
    expect(shifts).toHaveLength(1);

    const byId = await userService.getUserById(roster.departingId);
    expect(byId).toMatchObject({
      id: roster.departingId,
      fullName: "Chen Departing",
      isArchived: true,
    });

    const names = await scheduling.getEmployeeNames([
      roster.departingId,
      roster.stayingId,
    ]);
    expect(names.get(roster.departingId)).toBe("Chen Departing（已離職）");
    expect(names.get(roster.stayingId)).toBe("Lin Staying");

    // The roster grid reads the schedule list, which still resolves the name
    // and now says which side of the archive it came from, so the cell can be
    // labelled instead of silently reading as current staff.
    const { items } = await scheduling.getSchedules({ restaurantId });
    expect(items).toHaveLength(1);
    expect(items[0].employee).toMatchObject({
      id: roster.departingId,
      fullName: "Chen Departing",
      isArchived: true,
    });
    // The raw timestamp is not part of the payload — only the flag is.
    expect(items[0].employee).not.toHaveProperty("deletedAt");

    const single = await scheduling.getSchedule(roster.scheduleId);
    expect(single!.employee).toMatchObject({ isArchived: true });
  });

  it("closes the departed employee out of login, and reopens it on rehire", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const auth = new AuthService(testDb.bindings.DB, env);

    await expect(
      auth.login({ username: "archive-leaver", password }),
    ).resolves.toMatchObject({ success: true });

    await userService.archiveUser(roster.departingId);

    // Not "wrong password" — the account is no longer a login at all.
    await expect(
      auth.login({ username: "archive-leaver", password }),
    ).resolves.toMatchObject({ success: false });

    // Any session they still hold stops validating: archiving bumps the token
    // version, so a token minted before the departure no longer matches.
    const [row] = await testDb.drizzle
      .select({ tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, roster.departingId));
    expect(row.tokenVersion).toBe(2);

    // Prove it is deleted_at doing the work, not is_active riding along with
    // it. Reactivating the row without clearing the archive is not a state the
    // service can produce, which is exactly why the login query must not
    // assume the two columns move together (#337).
    await testDb.drizzle
      .update(users)
      .set({ isActive: true })
      .where(eq(users.id, roster.departingId));
    await expect(
      auth.login({ username: "archive-leaver", password }),
    ).resolves.toMatchObject({ success: false });

    expect(await userService.restoreUser(roster.departingId)).toBe(true);

    await expect(
      auth.login({ username: "archive-leaver", password }),
    ).resolves.toMatchObject({ success: true });

    const current = await userService.getRestaurantUsers(restaurantId);
    expect(current!.users.map((u) => u.id)).toContain(roster.departingId);
    expect(
      (await userService.getRestaurantUsers(restaurantId, {
        archived: "only",
      }))!.users,
    ).toEqual([]);
  });

  it("excludes a departed employee on the archive alone, not on is_active", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const scheduling = new SchedulingService(testDb.bindings.DB, env);
    const leave = new LeaveService(testDb.bindings.DB, env);

    await archiveButReactivate(testDb, userService, roster.departingId);

    // Scheduling picker.
    const available = await scheduling.getAvailableEmployees({
      restaurantId,
      date: "2026-06-11",
    });
    expect(available.map((e) => e.id)).not.toContain(roster.departingId);
    expect(available.map((e) => e.id)).toContain(roster.stayingId);

    // Shift assignment.
    await expect(
      scheduling.createSchedule({
        restaurantId,
        employeeId: roster.departingId,
        workDate: "2026-06-12",
        startTime: "09:00",
        endTime: "17:00",
        scheduledHours: 8,
        createdBy: roster.ownerId,
      } as never),
    ).rejects.toThrow("Employee not found in restaurant");

    // Annual leave accrual.
    await leave.accrueLeaveBalances(restaurantId, year);
    const accrued = await testDb.drizzle
      .select({ employeeId: employeeLeaveBalances.employeeId })
      .from(employeeLeaveBalances);
    expect(accrued.map((b) => b.employeeId)).not.toContain(roster.departingId);
    expect(accrued.map((b) => b.employeeId)).toContain(roster.stayingId);

    // Filing leave.
    await expect(
      leave.createLeaveRequest({
        restaurantId,
        employeeId: roster.departingId,
        leaveTypeId: roster.leaveTypeId,
        startDate: "2026-06-20",
        endDate: "2026-06-21",
        startPeriod: "full",
        endPeriod: "full",
        totalDays: 2,
        reason: "filed after departure",
      } as never),
    ).rejects.toThrow("Employee not found in restaurant");
  });

  it("strips approval authority from a departed owner", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);
    const leave = new LeaveService(testDb.bindings.DB, env);

    const request = await leave.createLeaveRequest({
      restaurantId,
      employeeId: roster.stayingId,
      leaveTypeId: roster.leaveTypeId,
      startDate: "2026-06-20",
      endDate: "2026-06-21",
      startPeriod: "full",
      endPeriod: "full",
      totalDays: 2,
      reason: "annual leave",
    } as never);

    await archiveButReactivate(testDb, userService, roster.ownerId);

    await expect(
      leave.approveLeaveRequest(
        request.id,
        roster.ownerId,
        undefined,
        restaurantId,
      ),
    ).rejects.toThrow("Approver is not authorized");
  });

  it("archives and restores once, so a repeated call is not silently a success", async () => {
    const roster = await seedRoster(testDb);
    const userService = new UserService(testDb.bindings.DB, env);

    expect(await userService.archiveUser(roster.departingId)).toBe(true);
    expect(await userService.archiveUser(roster.departingId)).toBe(false);

    expect(await userService.restoreUser(roster.departingId)).toBe(true);
    expect(await userService.restoreUser(roster.departingId)).toBe(false);
  });
});
