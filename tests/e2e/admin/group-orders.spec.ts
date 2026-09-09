/**
 * 營運管理流程 → 揪團訂單, against a real API and a real D1.
 *
 * Two things worth stating about what this does and does not cover.
 *
 * The create flow is driven through the UI, because the bug #270 recorded was
 * on that seam: the view keyed the resulting row off `created.id` rather than
 * the `groupOrderId` the API returns, so the group appeared to vanish the
 * moment it was made. The assertion here is that the row keyed by the id in
 * the response actually renders.
 *
 * Finalisation is not covered. #270 also recorded that a group created from
 * the admin can never be finalised — `finalize/staff` needs the host's member
 * token and the creation flow discards it — so a test for it would either fail
 * or encode a workaround for a defect. That is a real gap, deliberately left
 * visible rather than papered over.
 */
import { expect, test } from "@playwright/test";
import {
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

interface GroupOrderCreated {
  groupOrderId?: string;
  shareCode?: string;
  host?: { memberId?: string };
}

interface GroupOrderRow {
  id?: string;
  hostName?: string;
  status?: string;
}

test.describe.configure({ mode: "serial" });

test.describe("揪團訂單 (real API)", () => {
  test("owner creates a group order and the row it renders is keyed by the returned id", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const hostName = `E2E Host ${suffix()}`;

    await installAdminSession(page, login);

    await gotoAdmin(page, "/dashboard/group-orders", {
      expectApi: "/api/v1/orders/group",
    });
    await assertAuthenticated(page);

    await page.getByTestId("open-create-group-order").click();
    await page.getByTestId("create-host-name").fill(hostName);
    // Submit is client-gated on expectedMembers >= 2; leaving it at the default
    // silently disables the button rather than failing validation.
    await page.getByTestId("create-expected-members").fill("3");

    const created = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/orders/group/create") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("submit-create-group-order").click();
    const response = await created;
    expect(
      response.ok(),
      `group order create returned ${response.status()}`,
    ).toBe(true);

    const body = (await response.json()) as { data?: GroupOrderCreated };
    const groupOrderId = body.data?.groupOrderId;
    const shareCode = body.data?.shareCode;
    expect(groupOrderId, "created group order id").toBeTruthy();
    expect(shareCode, "share code").toBeTruthy();

    // #270: the list row must be keyed by groupOrderId. Keying it off a
    // different field made a freshly created group look like it had failed.
    await expect(
      page.getByTestId(`group-order-details-${groupOrderId}`),
    ).toBeVisible();

    // The recovery code is the only way back into a group whose host token is
    // lost, so it has to be surfaced, not merely returned. Note it is a
    // separate value from the share code — and it is rendered into a readonly
    // <input>, so the assertion is on the value, not the text.
    await expect(page.getByTestId("host-recovery-code")).not.toHaveValue("");

    await expect
      .poll(
        async () => {
          const list = await apiRequest<GroupOrderRow[]>(
            `/api/v1/orders/group?restaurantId=${restaurantId}`,
            { token },
          );
          return list.body.data?.some((row) => row.id === groupOrderId);
        },
        { timeout: POLL_TIMEOUT },
      )
      .toBe(true);

    await assertNoOverlayError(page);
  });

  test("the statistics tiles come from the real statistics endpoint", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    const stats = await apiRequest<Record<string, unknown>>(
      `/api/v1/orders/group/statistics?restaurantId=${restaurantId}`,
      { token },
    );
    expect(stats.ok, `statistics returned ${stats.status}`).toBe(true);

    await installAdminSession(page, login);

    // Registered before navigating: the statistics call fires during mount, so
    // arming a waitForResponse afterwards races it and usually loses.
    const statsCalls: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/v1/orders/group/statistics")) {
        statsCalls.push(response.status());
      }
    });

    await gotoAdmin(page, "/dashboard/group-orders", {
      expectApi: "/api/v1/orders/group",
    });
    await assertAuthenticated(page);

    // The page must issue the statistics call itself rather than deriving the
    // tiles from the list it already has — those two disagree the moment the
    // list is paginated.
    await expect
      .poll(() => statsCalls.length, { timeout: POLL_TIMEOUT })
      .toBeGreaterThan(0);
    expect(statsCalls.every((status) => status < 400)).toBe(true);

    await assertNoOverlayError(page);
  });
});
