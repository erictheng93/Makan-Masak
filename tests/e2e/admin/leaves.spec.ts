/**
 * 人事流程 → 請假審核, against a real API and a real D1.
 *
 * The centrepiece is the approve path. Until this suite existed, approving a
 * leave request failed 100% of the time with `400 INVALID_JSON`:
 * `leavesService.approveRequest` posted no body, and `validateBody` calls
 * `await c.req.json()` before it ever reaches the schema, which throws on an
 * absent body. `approveLeaveRequestSchema` is `{ comments?: string }`, so `{}`
 * would always have passed — the request simply never carried one.
 *
 * Nothing caught it. The route's own test always serialises a body, and
 * `LeavesTab.test.ts` mocks the service, so both sides were green while the
 * pair was broken. That is the exact gap this suite exists to close: only a
 * test that drives the real client against the real route sees it.
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

interface LeaveType {
  id?: number;
  code?: string;
  name?: string;
}

interface LeaveRequest {
  id?: number;
  status?: string;
  leaveTypeId?: number;
}

/**
 * Leave type codes are uppercase letters and underscores only. Two layers
 * enforce that and they do different things: the server rejects a bad code
 * outright, while the client first rewrites it —
 * `.replace(/[^A-Z_]+/g, "_")` — so a digit does not fail, it silently becomes
 * an underscore. A code of "E2E_..." arrives as "E_E_...". Hence the
 * digit-free prefix: the value asserted on has to be the value that lands.
 */
function e2eLeaveCode(): string {
  const letters = suffix().replace(/[0-9]/g, "X").toUpperCase();
  return `EEE_${letters}`;
}

async function createLeaveType(restaurantId: string, token: string) {
  const result = await apiRequest<LeaveType>(
    `/api/v1/leaves/${restaurantId}/types`,
    {
      token,
      method: "POST",
      body: {
        code: e2eLeaveCode(),
        name: `E2E Leave ${suffix()}`,
        accrualType: "yearly",
        accrualAmount: 5,
      },
    },
  );
  expect(result.ok, `leave type fixture returned ${result.status}`).toBe(true);
  return result.body.data!;
}

async function createLeaveRequest(
  restaurantId: string,
  token: string,
  leaveTypeId: number,
  employeeId: string,
) {
  const result = await apiRequest<LeaveRequest>(
    `/api/v1/leaves/${restaurantId}/requests`,
    {
      token,
      method: "POST",
      body: {
        leaveTypeId,
        userId: employeeId,
        // TEXT YYYY-MM-DD, not epoch ms — the leave tables predate the
        // timestamp_ms convention.
        startDate: "2026-11-02",
        endDate: "2026-11-03",
        reason: `E2E ${suffix()}`,
      },
    },
  );
  expect(result.ok, `leave request fixture returned ${result.status}`).toBe(
    true,
  );
  return result.body.data!;
}

test.describe.configure({ mode: "serial" });

test.describe("請假審核 (real API)", () => {
  test("owner creates a leave type and the apply button stops being disabled", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const code = e2eLeaveCode();
    const name = `E2E Leave ${suffix()}`;
    let typeId: number | undefined;

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/employees/leaves", {
        expectApi: "/api/v1/leaves/",
      });
      await assertAuthenticated(page);

      await page.getByTestId("leaves-tab-types").click();
      await page.getByTestId("leave-type-code").fill(code);
      await page.getByTestId("leave-type-name").fill(name);
      await page.getByTestId("leave-type-amount").fill("5");

      const created = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/leaves/${restaurantId}/types`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("leave-type-save").click();
      const response = await created;
      expect(
        response.ok(),
        `leave type create returned ${response.status()}`,
      ).toBe(true);

      const body = (await response.json()) as { data?: LeaveType };
      typeId = body.data?.id;
      expect(typeof typeId, "created leave type id").toBe("number");

      // Target the row by the id just created, not by text. `DELETE
      // /leaves/types/:id` only deactivates, and the list endpoint returns
      // inactive types too, so rows from previous runs stay on the page and a
      // text match would eventually assert against someone else's leftovers.
      await expect(
        page.getByTestId(`leave-type-delete-${typeId}`),
      ).toBeVisible();
      await expect(
        page.getByTestId("leave-type-row").filter({ hasText: name }),
      ).toBeVisible();

      // #307 was "no UI can create a leave type, and leave type is required,
      // so the submit button is permanently disabled — a new tenant deadlocks
      // on day one". The enabled button is the assertion that closes it.
      await expect(page.getByTestId("leaves-apply")).toBeEnabled();

      await expect
        .poll(
          async () => {
            const types = await apiRequest<LeaveType[]>(
              `/api/v1/leaves/${restaurantId}/types`,
              { token },
            );
            return types.body.data?.some((type) => type.id === typeId);
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(true);

      await assertNoOverlayError(page);
    } finally {
      if (typeId) await apiCleanup(`/api/v1/leaves/types/${typeId}`, token);
    }
  });

  test("owner approves a pending request and the server records it approved", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const employeeId = login.user?.id as string | undefined;
    expect(employeeId, "owner login should expose a user id").toBeTruthy();

    const leaveType = await createLeaveType(restaurantId, token);
    const request = await createLeaveRequest(
      restaurantId,
      token,
      leaveType.id!,
      employeeId!,
    );

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/employees/leaves", {
        expectApi: "/api/v1/leaves/",
      });
      await assertAuthenticated(page);

      const approveButton = page.getByTestId("leave-approve").first();
      await expect(approveButton).toBeVisible();

      const approved = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/leaves/requests/${request.id}/approve`) &&
          response.request().method() === "POST",
      );
      await approveButton.click();
      const response = await approved;

      // The regression guard. Before the fix this was 400 INVALID_JSON, every
      // single time, because the client sent no body at all.
      expect(
        response.ok(),
        `approve returned ${response.status()} — a 400 INVALID_JSON here means ` +
          `the client stopped sending a request body again (see #344 for the ` +
          `same bug on cancel)`,
      ).toBe(true);

      await expect
        .poll(
          async () => {
            const list = await apiRequest<LeaveRequest[]>(
              `/api/v1/leaves/${restaurantId}/requests?status=approved`,
              { token },
            );
            return list.body.data?.some((entry) => entry.id === request.id);
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(true);

      await assertNoOverlayError(page);
    } finally {
      if (leaveType.id) {
        await apiCleanup(`/api/v1/leaves/types/${leaveType.id}`, token);
      }
    }
  });

  test("owner rejects a pending request with a reason", async ({ page }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const employeeId = login.user?.id as string | undefined;

    const leaveType = await createLeaveType(restaurantId, token);
    const request = await createLeaveRequest(
      restaurantId,
      token,
      leaveType.id!,
      employeeId!,
    );

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/employees/leaves", {
        expectApi: "/api/v1/leaves/",
      });
      await assertAuthenticated(page);

      await page.getByTestId("leave-reject-open").first().click();
      await page
        .getByTestId("leave-reject-reason")
        .first()
        .fill(`E2E reject ${suffix()}`);

      const rejected = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/leaves/requests/${request.id}/reject`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("leave-reject-confirm").first().click();
      const response = await rejected;
      expect(response.ok(), `reject returned ${response.status()}`).toBe(true);

      await expect
        .poll(
          async () => {
            const list = await apiRequest<LeaveRequest[]>(
              `/api/v1/leaves/${restaurantId}/requests?status=rejected`,
              { token },
            );
            return list.body.data?.some((entry) => entry.id === request.id);
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(true);

      await assertNoOverlayError(page);
    } finally {
      if (leaveType.id) {
        await apiCleanup(`/api/v1/leaves/types/${leaveType.id}`, token);
      }
    }
  });
});
