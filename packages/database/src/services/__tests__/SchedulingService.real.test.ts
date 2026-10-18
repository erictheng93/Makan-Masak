import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "../../testing/create-test-database";
import { SchedulingService } from "../SchedulingService";

let testDb: TestDatabase;
const ownerId = "018f0000-0000-7000-8000-000000000001";
const employeeId = "018f0000-0000-7000-8000-000000000002";

beforeAll(async () => {
  testDb = await createTestDatabase();
}, REAL_D1_SETUP_TIMEOUT_MS);

afterAll(async () => {
  await testDb?.dispose();
});

beforeEach(async () => {
  await testDb.truncateAll();
  await testDb.db
    .prepare(
      `INSERT INTO restaurants
         (id, name, type, category, address, district, phone, created_at_ms, updated_at_ms)
       VALUES
         ('sched-rest', 'Schedule Test', 'street_food', 'snack', '1 Test Rd', 'West', '0900000000', 1735689600000, 1735689600000)`,
    )
    .run();
  await testDb.db
    .prepare(
      `INSERT INTO users
         (id, username, full_name, password_hash, role, restaurant_id, is_active, is_verified, total_orders, total_spent, token_version, created_at_ms, updated_at_ms)
       VALUES
         ('${ownerId}', 'sched-owner', 'Schedule Owner', 'test', 1, 'sched-rest', 1, 1, 0, 0, 1, 1735689600000, 1735689600000),
         ('${employeeId}', 'sched-employee', 'Schedule Employee', 'test', 3, 'sched-rest', 1, 1, 0, 0, 1, 1735689600000, 1735689600000)`,
    )
    .run();
});

describe("employee_schedules active slot uniqueness", () => {
  async function insertSchedule(status = "scheduled") {
    await testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (restaurant_id, employee_id, work_date, start_time, end_time,
            break_duration_minutes, scheduled_hours, status, created_by,
            created_at_ms, updated_at_ms)
         VALUES
           ('sched-rest', '${employeeId}', '2026-06-05', '14:00', '18:00',
            0, 4, ?, '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .bind(status)
      .run();
  }

  it("rejects duplicate active schedules for the same employee, date, and time", async () => {
    await insertSchedule("scheduled");

    await expect(insertSchedule("scheduled")).rejects.toThrow(
      /duplicate active employee schedule slot/,
    );
  });

  it("allows reusing a slot after the prior schedule is cancelled", async () => {
    await insertSchedule("cancelled");

    await expect(insertSchedule("scheduled")).resolves.toBeUndefined();
  });
});

describe("SchedulingService.cancelSchedulesByDateRange", () => {
  it("cancels matching schedules without interactive D1 transactions", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (id, restaurant_id, employee_id, work_date, start_time, end_time,
            break_duration_minutes, scheduled_hours, status, created_by,
            created_at_ms, updated_at_ms)
         VALUES
           (10, 'sched-rest', '${employeeId}', '2026-06-10', '09:00', '13:00',
            0, 4, 'scheduled', '${ownerId}', 1735689600000, 1735689600000),
           (11, 'sched-rest', '${employeeId}', '2026-06-11', '09:00', '13:00',
            0, 4, 'confirmed', '${ownerId}', 1735689600000, 1735689600000),
           (12, 'sched-rest', '${employeeId}', '2026-06-12', '09:00', '13:00',
            0, 4, 'cancelled', '${ownerId}', 1735689600000, 1735689600000),
           (13, 'sched-rest', '${ownerId}', '2026-06-10', '09:00', '13:00',
            0, 4, 'scheduled', '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .run();
    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });

    await expect(
      service.cancelSchedulesByDateRange({
        employeeId,
        startDate: "2026-06-10",
        endDate: "2026-06-12",
        reason: "leave approved",
        cancelledBy: ownerId,
      }),
    ).resolves.toEqual({ cancelledCount: 2, scheduleIds: [10, 11] });

    const rows = await testDb.db
      .prepare(
        `SELECT id, status, manager_notes, updated_by
           FROM employee_schedules
          WHERE id IN (10, 11, 12, 13)
          ORDER BY id`,
      )
      .all<{
        id: number;
        status: string;
        manager_notes: string | null;
        updated_by: string | null;
      }>();

    expect(rows.results).toEqual([
      {
        id: 10,
        status: "cancelled",
        manager_notes: "leave approved",
        updated_by: ownerId,
      },
      {
        id: 11,
        status: "cancelled",
        manager_notes: "leave approved",
        updated_by: ownerId,
      },
      {
        id: 12,
        status: "cancelled",
        manager_notes: null,
        updated_by: null,
      },
      {
        id: 13,
        status: "scheduled",
        manager_notes: null,
        updated_by: null,
      },
    ]);
  });
});

describe("SchedulingService.approveSwapRequest", () => {
  const employee2Id = "018f0000-0000-7000-8000-000000000003";

  async function insertEmployee2() {
    await testDb.db
      .prepare(
        `INSERT INTO users
           (id, username, full_name, password_hash, role, restaurant_id, is_active, is_verified, total_orders, total_spent, token_version, created_at_ms, updated_at_ms)
         VALUES
           ('${employee2Id}', 'sched-employee2', 'Schedule Employee Two', 'test', 3, 'sched-rest', 1, 1, 0, 0, 1, 1735689600000, 1735689600000)`,
      )
      .run();
  }

  async function insertSchedule(
    id: number,
    employeeId: string,
    workDate: string,
    startTime: string,
    endTime: string,
    status = "scheduled",
  ) {
    await testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (id, restaurant_id, employee_id, work_date, start_time, end_time,
            break_duration_minutes, scheduled_hours, status, created_by,
            created_at_ms, updated_at_ms)
         VALUES
           (?, 'sched-rest', ?, ?, ?, ?, 0, 4, ?, '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .bind(id, employeeId, workDate, startTime, endTime, status)
      .run();
  }

  async function insertSwapRequest(opts: {
    id: number;
    requestType: "swap" | "cover" | "drop";
    requesterScheduleId: number;
    targetEmployeeId?: string | null;
    targetScheduleId?: number | null;
    status?: string;
  }) {
    await testDb.db
      .prepare(
        `INSERT INTO schedule_swap_requests
           (id, restaurant_id, requester_employee_id, requester_schedule_id,
            target_employee_id, target_schedule_id, request_type, reason,
            urgency, status, created_at_ms, updated_at_ms)
         VALUES
           (?, 'sched-rest', ?, ?, ?, ?, ?, 'test reason', 'normal', ?, 1735689600000, 1735689600000)`,
      )
      .bind(
        opts.id,
        employeeId,
        opts.requesterScheduleId,
        opts.targetEmployeeId ?? null,
        opts.targetScheduleId ?? null,
        opts.requestType,
        opts.status ?? "pending",
      )
      .run();
  }

  async function scheduleRow(id: number) {
    const rows = await testDb.db
      .prepare(
        `SELECT id, employee_id, status FROM employee_schedules WHERE id = ?`,
      )
      .bind(id)
      .all<{ id: number; employee_id: string; status: string }>();
    return rows.results[0];
  }

  it("swap: exchanges the assigned employee between both schedule rows", async () => {
    await insertEmployee2();
    await insertSchedule(30, employeeId, "2026-07-01", "09:00", "13:00");
    await insertSchedule(31, employee2Id, "2026-07-02", "09:00", "13:00");
    await insertSwapRequest({
      id: 100,
      requestType: "swap",
      requesterScheduleId: 30,
      targetEmployeeId: employee2Id,
      targetScheduleId: 31,
    });

    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    const result = await service.approveSwapRequest(100, ownerId);

    expect(result.status).toBe("approved");
    expect((await scheduleRow(30)).employee_id).toBe(employee2Id);
    expect((await scheduleRow(31)).employee_id).toBe(employeeId);
  });

  it("cover: reassigns the requester's shift to the target employee", async () => {
    await insertEmployee2();
    await insertSchedule(40, employeeId, "2026-07-03", "09:00", "13:00");
    await insertSwapRequest({
      id: 101,
      requestType: "cover",
      requesterScheduleId: 40,
      targetEmployeeId: employee2Id,
    });

    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await service.approveSwapRequest(101, ownerId);

    const row = await scheduleRow(40);
    expect(row.employee_id).toBe(employee2Id);
    expect(row.status).toBe("scheduled");
  });

  it("drop: cancels the requester's schedule row", async () => {
    await insertSchedule(50, employeeId, "2026-07-04", "09:00", "13:00");
    await insertSwapRequest({
      id: 102,
      requestType: "drop",
      requesterScheduleId: 50,
    });

    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await service.approveSwapRequest(102, ownerId);

    const row = await scheduleRow(50);
    expect(row.employee_id).toBe(employeeId);
    expect(row.status).toBe("cancelled");
  });

  it("rejects approving a request that is not pending", async () => {
    await insertSchedule(60, employeeId, "2026-07-05", "09:00", "13:00");
    await insertSwapRequest({
      id: 103,
      requestType: "drop",
      requesterScheduleId: 60,
      status: "approved",
    });

    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });
    await expect(service.approveSwapRequest(103, ownerId)).rejects.toThrow(
      /cannot be approved/,
    );
  });
});

describe("SchedulingService tenant scoping", () => {
  const outsiderId = "018f0000-0000-7000-8000-000000000009";

  function service() {
    return new SchedulingService(testDb.bindings.DB, { JWT_SECRET: "test" });
  }

  beforeEach(async () => {
    await testDb.db
      .prepare(
        `INSERT INTO restaurants
           (id, name, type, category, address, district, phone, created_at_ms, updated_at_ms)
         VALUES
           ('other-rest', 'Other Restaurant', 'street_food', 'snack', '2 Test Rd', 'East', '0900000001', 1735689600000, 1735689600000)`,
      )
      .run();
    await testDb.db
      .prepare(
        `INSERT INTO users
           (id, username, full_name, password_hash, role, restaurant_id, is_active, is_verified, total_orders, total_spent, token_version, created_at_ms, updated_at_ms)
         VALUES
           ('${outsiderId}', 'other-employee', 'Other Employee', 'test', 3, 'other-rest', 1, 1, 0, 0, 1, 1735689600000, 1735689600000)`,
      )
      .run();
    await testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (id, restaurant_id, employee_id, work_date, start_time, end_time,
            break_duration_minutes, scheduled_hours, status, created_by,
            created_at_ms, updated_at_ms)
         VALUES
           (70, 'sched-rest', '${employeeId}', '2026-08-01', '09:00', '13:00',
            0, 4, 'scheduled', '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .run();
  });

  it("hides ID-addressed rows from other tenants but returns them in scope", async () => {
    const svc = service();

    await expect(svc.getScheduleById(70, "other-rest")).resolves.toBeNull();
    await expect(svc.getSchedule(70, "other-rest")).resolves.toBeNull();
    await expect(svc.getScheduleById(70, "sched-rest")).resolves.toMatchObject({
      id: 70,
    });
    // Unscoped (platform admin) still resolves.
    await expect(svc.getScheduleById(70)).resolves.toMatchObject({ id: 70 });

    await expect(svc.deleteSchedule(70, "other-rest")).resolves.toBe(false);
    const row = await testDb.db
      .prepare(`SELECT status FROM employee_schedules WHERE id = 70`)
      .all<{ status: string }>();
    expect(row.results[0].status).toBe("scheduled");
  });

  it("rejects schedule creation for cross-tenant employees and templates", async () => {
    const svc = service();

    await expect(
      svc.createSchedule({
        restaurantId: "sched-rest",
        employeeId: outsiderId,
        workDate: "2026-08-02",
        startTime: "09:00",
        endTime: "13:00",
        scheduledHours: 4,
        createdBy: ownerId,
      }),
    ).rejects.toThrow(/Employee not found in restaurant/);

    await testDb.db
      .prepare(
        `INSERT INTO shift_templates
           (id, restaurant_id, name, start_time, end_time, duration_minutes,
            break_duration_minutes, created_by, created_at_ms, updated_at_ms)
         VALUES
           (700, 'other-rest', 'Other Morning', '09:00', '13:00', 240,
            0, '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .run();

    await expect(
      svc.bulkCreateSchedules({
        restaurantId: "sched-rest",
        shiftTemplateId: 700,
        employeeIds: [employeeId],
        dateRange: { startDate: "2026-08-03", endDate: "2026-08-03" },
        daysOfWeek: [1],
        createdBy: ownerId,
      }),
    ).rejects.toThrow(/Shift template not found/);

    const schedules = await testDb.db
      .prepare(
        `SELECT id FROM employee_schedules WHERE shift_template_id = 700`,
      )
      .all<{ id: number }>();
    expect(schedules.results).toEqual([]);
  });

  it("rejects updating a schedule to another tenant's shift template", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO shift_templates
           (id, restaurant_id, name, start_time, end_time, duration_minutes,
            break_duration_minutes, created_by, created_at_ms, updated_at_ms)
         VALUES
           (701, 'other-rest', 'Other Evening', '18:00', '22:00', 240,
            0, '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .run();
    const svc = service();

    await expect(
      svc.updateSchedule(70, { shiftTemplateId: 701 }, "sched-rest"),
    ).rejects.toThrow(/Shift template not found/);
    // Unscoped (platform admin) callers are held to the schedule's restaurant.
    await expect(
      svc.updateSchedule(70, { shiftTemplateId: 701 }),
    ).rejects.toThrow(/Shift template not found/);

    const row = await testDb.db
      .prepare(`SELECT shift_template_id FROM employee_schedules WHERE id = 70`)
      .all<{ shift_template_id: number | null }>();
    expect(row.results[0].shift_template_id).toBeNull();
  });

  it("rejects swap request creation with a forged requester identity", async () => {
    const svc = service();

    // ownerId does not own schedule 70 — impersonation attempt.
    await expect(
      svc.createSwapRequest({
        restaurantId: "sched-rest",
        requesterEmployeeId: ownerId,
        requesterScheduleId: 70,
        requestType: "drop",
        reason: "forged",
        urgency: "normal",
        isOpenRequest: false,
      }),
    ).rejects.toThrow(/does not belong to the requesting employee/);

    // Schedule 70 is not visible from other-rest at all.
    await expect(
      svc.createSwapRequest({
        restaurantId: "other-rest",
        requesterEmployeeId: outsiderId,
        requesterScheduleId: 70,
        requestType: "drop",
        reason: "cross-tenant",
        urgency: "normal",
        isOpenRequest: false,
      }),
    ).rejects.toThrow(/Requester schedule not found/);

    // A target employee from another restaurant is rejected.
    await expect(
      svc.createSwapRequest({
        restaurantId: "sched-rest",
        requesterEmployeeId: employeeId,
        requesterScheduleId: 70,
        targetEmployeeId: outsiderId,
        requestType: "cover",
        reason: "cross-tenant target",
        urgency: "normal",
        isOpenRequest: false,
      }),
    ).rejects.toThrow(/Target employee not found in this restaurant/);
  });

  it("lets only the named target accept a directed swap request", async () => {
    // Directed at employeeId; ownerId is in the same restaurant, so the tenant
    // predicate cannot be what stops them.
    await testDb.db
      .prepare(
        `INSERT INTO schedule_swap_requests
           (id, restaurant_id, requester_employee_id, requester_schedule_id,
            target_employee_id, target_schedule_id, request_type, reason,
            urgency, is_open_request, status, created_at_ms, updated_at_ms)
         VALUES
           (210, 'sched-rest', '${ownerId}', 70, '${employeeId}', NULL, 'cover',
            'test reason', 'normal', 0, 'pending', 1735689600000, 1735689600000)`,
      )
      .run();
    const svc = service();

    await expect(
      svc.acceptSwapRequest(210, ownerId, "sched-rest"),
    ).rejects.toThrow(/Only the target employee/);

    // Still pending, so the real target has not lost their chance to accept.
    const accepted = await svc.acceptSwapRequest(210, employeeId, "sched-rest");
    expect(accepted.status).toBe("accepted");
    expect(accepted.acceptedBy).toBe(employeeId);
  });

  it("lets anyone in the tenant accept an open swap request", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO schedule_swap_requests
           (id, restaurant_id, requester_employee_id, requester_schedule_id,
            target_employee_id, target_schedule_id, request_type, reason,
            urgency, is_open_request, status, created_at_ms, updated_at_ms)
         VALUES
           (211, 'sched-rest', '${employeeId}', 70, NULL, NULL, 'cover',
            'test reason', 'normal', 1, 'pending', 1735689600000, 1735689600000)`,
      )
      .run();

    const accepted = await service().acceptSwapRequest(
      211,
      ownerId,
      "sched-rest",
    );

    expect(accepted.status).toBe("accepted");
  });

  it("scopes swap request approval and cancellation to the tenant", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO schedule_swap_requests
           (id, restaurant_id, requester_employee_id, requester_schedule_id,
            target_employee_id, target_schedule_id, request_type, reason,
            urgency, status, created_at_ms, updated_at_ms)
         VALUES
           (200, 'sched-rest', '${employeeId}', 70, NULL, NULL, 'drop',
            'test reason', 'normal', 'pending', 1735689600000, 1735689600000)`,
      )
      .run();
    const svc = service();

    await expect(svc.getSwapRequest(200, "other-rest")).resolves.toBeNull();
    await expect(
      svc.approveSwapRequest(200, outsiderId, "other-rest"),
    ).rejects.toThrow(/Swap request not found/);
    await expect(
      svc.cancelSwapRequest(200, employeeId, "other-rest"),
    ).rejects.toThrow(/Swap request not found/);

    // In-scope approval still works.
    const approved = await svc.approveSwapRequest(200, ownerId, "sched-rest");
    expect(approved.status).toBe("approved");
  });

  it("refuses swap request writes when a stale read bypasses tenant scoping", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO schedule_swap_requests
           (id, restaurant_id, requester_employee_id, requester_schedule_id,
            target_employee_id, target_schedule_id, request_type, reason,
            urgency, status, created_at_ms, updated_at_ms)
         VALUES
           (201, 'sched-rest', '${employeeId}', 70, NULL, NULL, 'drop',
            'test reason', 'normal', 'pending', 1735689600000, 1735689600000)`,
      )
      .run();
    const svc = service();
    const request = await svc.getSwapRequest(201, "sched-rest");
    vi.spyOn(svc, "getSwapRequest").mockResolvedValue(request);

    await expect(
      svc.approveSwapRequest(201, outsiderId, "other-rest"),
    ).rejects.toThrow(/Swap request not found/);
    await expect(
      svc.rejectSwapRequest(201, outsiderId, "Not authorized", "other-rest"),
    ).rejects.toThrow(/Failed to reject swap request/);
    await expect(
      svc.cancelSwapRequest(201, employeeId, "other-rest"),
    ).rejects.toThrow(/Failed to cancel swap request/);

    const row = await testDb.db
      .prepare("SELECT status FROM schedule_swap_requests WHERE id = 201")
      .first<{ status: string }>();
    expect(row?.status).toBe("pending");

    // Approval's roster writes are the reason this path matters, and they are
    // a separate set of statements from the request update above. Request 201
    // is a 'drop', so an unscoped roster write would cancel schedule 70 —
    // and it would do so *before* the zero-row request update makes
    // approveSwapRequest throw, because db.batch commits either way.
    // Asserting only on schedule_swap_requests cannot see that.
    const schedule = await testDb.db
      .prepare("SELECT status FROM employee_schedules WHERE id = 70")
      .first<{ status: string }>();
    expect(schedule?.status).toBe("scheduled");
  });
});

describe("SchedulingService.createSchedule", () => {
  it("rejects overlapping schedules instead of inserting with a warning conflict", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (id, restaurant_id, employee_id, work_date, start_time, end_time,
            break_duration_minutes, scheduled_hours, status, created_by,
            created_at_ms, updated_at_ms)
         VALUES
           (20, 'sched-rest', '${employeeId}', '2026-06-15', '09:00', '13:00',
            0, 4, 'scheduled', '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .run();
    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });

    await expect(
      service.createSchedule({
        restaurantId: "sched-rest",
        employeeId,
        workDate: "2026-06-15",
        startTime: "12:00",
        endTime: "16:00",
        scheduledHours: 4,
        createdBy: ownerId,
      }),
    ).rejects.toThrow("Overlapping shift detected");

    const schedules = await testDb.db
      .prepare(
        `SELECT id, start_time, end_time
           FROM employee_schedules
          WHERE employee_id = '${employeeId}' AND work_date = '2026-06-15'
          ORDER BY id`,
      )
      .all<{ id: number; start_time: string; end_time: string }>();
    expect(schedules.results).toEqual([
      { id: 20, start_time: "09:00", end_time: "13:00" },
    ]);

    const conflicts = await testDb.db
      .prepare(
        `SELECT conflict_type, severity
           FROM scheduling_conflicts
          WHERE restaurant_id = 'sched-rest'`,
      )
      .all<{ conflict_type: string; severity: string }>();
    expect(conflicts.results).toEqual([]);
  });
});

describe("SchedulingService.getShiftTemplates", () => {
  // Issue #209: ShiftDistributionChart reads `assignedCount`, which this
  // projection must supply — distinct non-cancelled employees per template.
  it("returns assignedCount of distinct non-cancelled employees per template", async () => {
    await testDb.db
      .prepare(
        `INSERT INTO shift_templates
           (id, restaurant_id, name, start_time, end_time, duration_minutes,
            sort_order, created_at_ms, updated_at_ms)
         VALUES
           (1, 'sched-rest', 'Morning', '09:00', '13:00', 240, 1, 1735689600000, 1735689600000),
           (2, 'sched-rest', 'Evening', '18:00', '22:00', 240, 2, 1735689600000, 1735689600000)`,
      )
      .run();
    await testDb.db
      .prepare(
        `INSERT INTO employee_schedules
           (restaurant_id, employee_id, shift_template_id, work_date, start_time,
            end_time, break_duration_minutes, scheduled_hours, status, created_by,
            created_at_ms, updated_at_ms)
         VALUES
           ('sched-rest', '${employeeId}', 1, '2026-06-01', '09:00', '13:00', 0, 4, 'scheduled', '${ownerId}', 1735689600000, 1735689600000),
           ('sched-rest', '${employeeId}', 1, '2026-06-02', '09:00', '13:00', 0, 4, 'confirmed', '${ownerId}', 1735689600000, 1735689600000),
           ('sched-rest', '${ownerId}', 1, '2026-06-01', '09:00', '13:00', 0, 4, 'scheduled', '${ownerId}', 1735689600000, 1735689600000),
           ('sched-rest', '${employeeId}', 2, '2026-06-01', '18:00', '22:00', 0, 4, 'cancelled', '${ownerId}', 1735689600000, 1735689600000)`,
      )
      .run();
    const service = new SchedulingService(testDb.bindings.DB, {
      JWT_SECRET: "test",
    });

    const templates = await service.getShiftTemplates("sched-rest");

    expect(
      templates.map((t) => ({ id: t.id, assignedCount: t.assignedCount })),
    ).toEqual([
      { id: 1, assignedCount: 2 }, // employee counted once across 2 shifts, plus owner
      { id: 2, assignedCount: 0 }, // cancelled schedules do not count
    ]);
  });
});
