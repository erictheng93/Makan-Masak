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
 * Finalisation IS covered, contrary to what #270 says. That issue recorded that
 * a group created from the admin could never be finalised because
 * `finalize/staff` needs the host's member token and the creation flow discarded
 * it. That premise is stale: the create response now returns `memberToken` and
 * `recoveryCode` at the top level, and the whole path completes — create, add a
 * cart item, finalise, and a real master order comes back. Verified before this
 * test was written, rather than inferred from the issue text.
 *
 * It is the highest-value assertion in this file: finalising is the step that
 * turns a group into actual orders, i.e. the one that moves money.
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
  /** The host's own member token — the thing #270 said was discarded. */
  memberToken?: string;
  recoveryCode?: string;
  host?: { memberId?: string };
}

interface GroupOrderRow {
  id?: string;
  hostName?: string;
  status?: string;
}

interface CartItem {
  id?: string;
  itemId?: string;
}

interface FinalizeResult {
  masterOrderId?: string;
  status?: string;
}

async function firstAvailableMenuItem(restaurantId: string): Promise<number> {
  const menu = await apiRequest<{
    categories?: Array<{
      items?: Array<{ id?: number; isAvailable?: boolean }>;
    }>;
    menuItems?: Array<{ id?: number; isAvailable?: boolean }>;
    items?: Array<{ id?: number; isAvailable?: boolean }>;
  }>(`/api/v1/menu/${restaurantId}`);
  const all = [
    ...(menu.body.data?.menuItems ?? []),
    ...(menu.body.data?.items ?? []),
    ...(menu.body.data?.categories ?? []).flatMap((c) => c.items ?? []),
  ];
  const id = all.find((item) => item.isAvailable !== false)?.id;
  expect(
    id,
    "an available menu item is required to fill a group cart",
  ).toBeTruthy();
  return id!;
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

  test("a group with items finalises into a real master order (#270)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    // Fixtures through the API: creating the group and filling a member's cart
    // are covered elsewhere / belong to the customer surface. What is under
    // test here is the staff action on the admin page.
    const created = await apiRequest<GroupOrderCreated>(
      "/api/v1/orders/group/create",
      {
        token,
        method: "POST",
        body: {
          restaurantId,
          hostName: `E2E Finalize ${suffix()}`,
          expectedMembers: 2,
        },
      },
    );
    expect(created.ok, `group create returned ${created.status}`).toBe(true);
    const groupOrderId = created.body.data?.groupOrderId;
    const memberToken = created.body.data?.memberToken;
    const memberId = created.body.data?.host?.memberId;

    // The three things #270 said were unavailable. Asserting them explicitly
    // means a regression reads as "the token stopped coming back", not as a
    // confusing failure four steps later.
    expect(groupOrderId, "created group order id").toBeTruthy();
    expect(
      memberToken,
      "the host member token must be returned (#270)",
    ).toBeTruthy();
    expect(memberId, "the host member id must be returned").toBeTruthy();

    const menuItemId = await firstAvailableMenuItem(restaurantId);
    const cartItem = await apiRequest<CartItem>(
      `/api/v1/orders/group/${groupOrderId}/cart`,
      {
        token,
        method: "POST",
        body: { memberId, memberToken, menuItemId, quantity: 2 },
      },
    );
    expect(cartItem.ok, `cart add returned ${cartItem.status}`).toBe(true);

    await installAdminSession(page, login);

    await gotoAdmin(page, "/dashboard/group-orders", {
      expectApi: "/api/v1/orders/group",
    });
    await assertAuthenticated(page);

    await page.getByTestId(`group-order-details-${groupOrderId}`).click();

    // The staff finalise button guards with window.confirm, so the dialog has
    // to be answered or the click does nothing at all.
    page.once("dialog", (dialog) => {
      void dialog.accept();
    });

    const finalized = page.waitForResponse(
      (response) =>
        response
          .url()
          .includes(`/api/v1/orders/group/${groupOrderId}/finalize/staff`) &&
        response.request().method() === "POST",
    );
    await page.getByTestId(`staff-finalize-${groupOrderId}`).click();
    const response = await finalized;
    expect(response.ok(), `staff finalize returned ${response.status()}`).toBe(
      true,
    );

    // The point of finalising: a real order exists afterwards. A status flip
    // with no master order would be the failure #270 described.
    const body = (await response.json()) as { data?: FinalizeResult };
    const masterOrderId = body.data?.masterOrderId;
    expect(
      masterOrderId,
      "finalising must produce a master order",
    ).toBeTruthy();

    await expect
      .poll(
        async () => {
          const order = await apiRequest<{ id?: string; status?: string }>(
            `/api/v1/orders/${masterOrderId}`,
            { token },
          );
          return order.body.data?.id;
        },
        { timeout: POLL_TIMEOUT },
      )
      .toBe(masterOrderId);

    await assertNoOverlayError(page);
  });
});
