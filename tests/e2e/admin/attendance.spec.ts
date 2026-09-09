/**
 * 人事流程 → 出勤紀錄 (and the 員工列表 read it feeds), against a real API and a
 * real D1.
 *
 * #308 was that `ClockInOutPanel.vue` had zero importers. The component
 * existed, the endpoints existed, and nothing anywhere in the product rendered
 * it — so there was no way to clock in, and every figure downstream (attendance
 * rate, absences, currently-on-shift, the staff activity feed) was a dead value
 * computed from an empty table. It is wired up now; this holds it wired.
 *
 * The panel only mounts when there is a schedule for *today*, so the fixture is
 * a shift template plus a schedule dated today, both created through the real
 * API and both removed afterwards. Without that row the panel renders its
 * "no schedule" card and the clock button never exists — which is a seed gap
 * rather than a defect, and worth knowing before reading a failure here.
 */
import { expect, test } from "@playwright/test";
import {
  apiCleanup,
  apiRequest,
  assertAuthenticated,
  assertNoOverlayError,
  getOwnerContext,
  gotoAdmin,
  installAdminSession,
  POLL_TIMEOUT,
  requireStack,
  suffix,
} from "./admin-e2e";

interface ShiftTemplate {
  id?: number;
  name?: string;
}

interface EmployeeSchedule {
  id?: number;
  employeeId?: string;
  workDate?: string;
  clockInTime?: string | number | null;
  clockOutTime?: string | number | null;
}

interface UserRow {
  id?: string;
  username?: string;
}

/** Local calendar date — the panel matches on the shop's today, not UTC's. */
function todayLocalIso(): string {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

async function createTodaySchedule(
  restaurantId: string,
  token: string,
  employeeId: string,
) {
  const template = await apiRequest<ShiftTemplate>(
    `/api/v1/scheduling/${restaurantId}/templates`,
    {
      token,
      method: "POST",
      body: {
        name: `E2E Shift ${suffix()}`,
        // A full-day window on purpose. `clocked-in` only counts a shift that
        // is in progress right now, so a fixed 09:00-17:00 fixture passes when
        // the suite runs in the afternoon and fails at night — a flake that
        // depends on the wall clock rather than on the code under test.
        startTime: "00:00",
        endTime: "23:59",
        durationMinutes: 1439,
      },
    },
  );
  expect(
    template.ok,
    `shift template fixture returned ${template.status}`,
  ).toBe(true);

  const schedule = await apiRequest<EmployeeSchedule>(
    `/api/v1/scheduling/${restaurantId}/schedules`,
    {
      token,
      method: "POST",
      body: {
        employeeId,
        shiftTemplateId: template.body.data?.id,
        workDate: todayLocalIso(),
        startTime: "00:00",
        endTime: "23:59",
        // Required, and not derived from start/end — omitting it is a 400 that
        // names a field the UI never shows.
        scheduledHours: 24,
      },
    },
  );
  expect(schedule.ok, `schedule fixture returned ${schedule.status}`).toBe(
    true,
  );

  return {
    templateId: template.body.data?.id,
    scheduleId: schedule.body.data?.id,
  };
}

async function readSchedule(
  restaurantId: string,
  token: string,
  scheduleId: number,
): Promise<EmployeeSchedule | undefined> {
  const today = todayLocalIso();
  const list = await apiRequest<EmployeeSchedule[]>(
    `/api/v1/scheduling/${restaurantId}/schedules?startDate=${today}&endDate=${today}`,
    { token },
  );
  const rows = Array.isArray(list.body.data) ? list.body.data : [];
  return rows.find((row) => row.id === scheduleId);
}

test.describe.configure({ mode: "serial" });

test.describe("出勤紀錄 (real API)", () => {
  test("clocking in through the panel records it, and clocking out completes the shift (#308)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const employeeId = login.user?.id as string;
    const { templateId, scheduleId } = await createTodaySchedule(
      restaurantId,
      token,
      employeeId,
    );

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/employees/attendance", {
        expectApi: "/api/v1/scheduling/",
      });
      await assertAuthenticated(page);

      // The button's existence is the #308 assertion: it was unreachable from
      // anywhere in the product, not merely hard to find.
      const clockIn = page.getByTestId("clock-in-button");
      await expect(
        clockIn,
        "there must be a way to clock in (#308)",
      ).toBeVisible();

      const clockedIn = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/scheduling/schedules/${scheduleId}/clock-in`) &&
          response.request().method() === "POST",
      );
      await clockIn.click();
      await page.getByTestId("clock-notes-confirm").click();
      const inResponse = await clockedIn;
      expect(inResponse.ok(), `clock-in returned ${inResponse.status()}`).toBe(
        true,
      );

      await expect(page.getByTestId("clock-in-time")).not.toBeEmpty();
      await expect(page.getByTestId("clock-out-button")).toBeVisible();

      // Server-side: attendance lives on employee_schedules.clock_in_time_ms —
      // there is no attendance_records table — so this is the row every
      // downstream figure reads.
      await expect
        .poll(
          async () =>
            Boolean(
              (await readSchedule(restaurantId, token, scheduleId!))
                ?.clockInTime,
            ),
          { timeout: POLL_TIMEOUT },
        )
        .toBe(true);

      const clockedOut = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/scheduling/schedules/${scheduleId}/clock-out`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("clock-out-button").click();
      await page.getByTestId("clock-notes-confirm").click();
      const outResponse = await clockedOut;
      expect(
        outResponse.ok(),
        `clock-out returned ${outResponse.status()}`,
      ).toBe(true);

      await expect(page.getByTestId("shift-completed")).toBeVisible();

      await expect
        .poll(
          async () =>
            Boolean(
              (await readSchedule(restaurantId, token, scheduleId!))
                ?.clockOutTime,
            ),
          { timeout: POLL_TIMEOUT },
        )
        .toBe(true);

      await assertNoOverlayError(page);
    } finally {
      if (scheduleId) {
        await apiCleanup(`/api/v1/scheduling/schedules/${scheduleId}`, token);
      }
      if (templateId) {
        await apiCleanup(`/api/v1/scheduling/templates/${templateId}`, token);
      }
    }
  });

  test("the currently-on-shift figure counts a real clock-in", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const employeeId = login.user?.id as string;
    const { templateId, scheduleId } = await createTodaySchedule(
      restaurantId,
      token,
      employeeId,
    );

    try {
      const before = await apiRequest<unknown[]>(
        `/api/v1/scheduling/${restaurantId}/clocked-in`,
        { token },
      );
      const beforeCount = Array.isArray(before.body.data)
        ? before.body.data.length
        : 0;

      const clockIn = await apiRequest(
        `/api/v1/scheduling/schedules/${scheduleId}/clock-in`,
        { token, method: "POST", body: { scheduleId } },
      );
      expect(clockIn.ok, `clock-in returned ${clockIn.status}`).toBe(true);

      // This endpoint is what the dashboard's 目前在班 tile reads. Before #308
      // it could only ever return an empty list, because nothing could clock
      // anyone in — so the tile was structurally a zero, not a measurement.
      await expect
        .poll(
          async () => {
            const after = await apiRequest<unknown[]>(
              `/api/v1/scheduling/${restaurantId}/clocked-in`,
              { token },
            );
            return Array.isArray(after.body.data) ? after.body.data.length : 0;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(beforeCount + 1);

      // The employee list is the other consumer; assert the person we clocked
      // in is someone it actually knows about.
      const users = await apiRequest<UserRow[]>(
        `/api/v1/users?restaurantId=${restaurantId}`,
        { token },
      );
      expect(users.ok, `user list returned ${users.status}`).toBe(true);
      expect(
        (users.body.data ?? []).some((user) => user.id === employeeId),
      ).toBe(true);

      await installAdminSession(page, login);
      await gotoAdmin(page, "/dashboard/employees", {
        expectApi: "/api/v1/users",
      });
      await assertAuthenticated(page);
      await expect(page.locator("table tbody tr").first()).toBeVisible();
      await assertNoOverlayError(page);
    } finally {
      if (scheduleId) {
        await apiCleanup(
          `/api/v1/scheduling/schedules/${scheduleId}/clock-out`,
          token,
          { method: "POST", body: { scheduleId } },
        );
        await apiCleanup(`/api/v1/scheduling/schedules/${scheduleId}`, token);
      }
      if (templateId) {
        await apiCleanup(`/api/v1/scheduling/templates/${templateId}`, token);
      }
    }
  });
});
