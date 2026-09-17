/**
 * master-user-flow 1. 顧客端 → 揪團 (建立揪團 → 分享碼邀請 → 同桌合單), against a
 * real API, a real realtime worker and a real D1.
 *
 * Two browser contexts, because a group order is two devices by definition:
 * the host starts it from the table's menu, and the second diner arrives only
 * through the invite link the host's page shows. That link is the thing the
 * 09-15 walk found missing (C2) — every part of the join flow worked and there
 * was no way to reach it — so the guest here opens exactly the URL the host's
 * invite panel renders, never one assembled by the test.
 *
 * The second test is the one place in this suite that calls `page.route()`,
 * and it never answers a request itself: it holds the real response to one
 * real GET for a moment, to open a race window a real phone opens on its own.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  Cleanup,
  apiData,
  assertNoOverlayError,
  cancelOnCleanup,
  createMenuFixture,
  createTable,
  e2eName,
  LIVE_TIMEOUT,
  NAV_TIMEOUT,
  newDinerContext,
  qrPath,
  readOrder,
  requireStack,
  type MenuFixture,
} from "./customer-e2e";

test.describe.configure({ mode: "serial" });

const cleanup = new Cleanup();
let menu: MenuFixture;

test.beforeAll(async () => {
  await requireStack();
  menu = await createMenuFixture(cleanup);
});

test.afterAll(async () => {
  await cleanup.run();
});

interface GroupSummary {
  groupOrder: { id: string; status: string };
  cartItems: Array<{ menuItemId: number | string; quantity: number }>;
}

/** The group order as the API holds it. Public, like the page's own read. */
function readGroup(groupOrderId: string): Promise<GroupSummary> {
  return apiData<GroupSummary>(
    "read group order",
    `/api/v1/orders/group/${groupOrderId}`,
  );
}

/** Scans the table, starts a group from its menu, lands on the group page. */
async function startGroupFromMenu(
  page: Page,
  qrCode: string,
): Promise<{ groupOrderId: string; shareCode: string }> {
  await page.goto(qrPath(qrCode));
  await page.getByTestId("start-group-order-button").click({
    timeout: NAV_TIMEOUT,
  });
  await page.getByTestId("group-host-name-input").fill(e2eName("主揪"));
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/orders/group/create") &&
      response.request().method() === "POST",
  );
  await page.getByTestId("group-create-submit").click();
  const response = await created;
  expect(response.status(), "group create").toBeLessThan(300);
  const group = (
    (await response.json()) as {
      data: { groupOrderId: string; shareCode: string };
    }
  ).data;
  await expect(page).toHaveURL(
    new RegExp(`/group/order/${group.groupOrderId}$`),
  );
  return group;
}

/** From the group page to the table menu in group mode, then one dish in. */
async function addDishInGroupMode(
  page: Page,
  groupOrderId: string,
  menuItemId: number,
): Promise<void> {
  await page.getByTestId("group-order-menu-link").click();
  await expect(page.getByTestId("group-cart-link")).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  const added = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/orders/group/${groupOrderId}/cart`) &&
      response.request().method() === "POST",
  );
  await page.getByTestId(`menu-item-add-${menuItemId}`).click();
  expect((await added).status(), "group cart add").toBeLessThan(300);
  await page.getByTestId("group-cart-link").click();
  await expect(page).toHaveURL(new RegExp(`/group/order/${groupOrderId}$`));
}

test.describe("揪團 (real API + realtime)", () => {
  test("host starts a group from the menu, a second diner joins by the invite link, both order, host submits one order", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    let masterOrderId: string | undefined;
    cancelOnCleanup(localCleanup, () => masterOrderId);
    const host = await newDinerContext(browser);
    const guest = await newDinerContext(browser);
    try {
      const table = await createTable(localCleanup);

      // --- 建立揪團 from the scanned table's menu ---------------------------
      const group = await startGroupFromMenu(host.page, table.qrCode);

      // --- 分享碼邀請: C2 (09-15) put the invite panel on this page -----------
      const invite = host.page.getByTestId("group-order-invite");
      await expect(invite).toBeVisible({ timeout: NAV_TIMEOUT });
      await expect(invite.getByTestId("invite-share-code")).toHaveText(
        group.shareCode,
      );
      const inviteLink = (
        await invite.getByTestId("invite-link-value").innerText()
      ).trim();
      expect(inviteLink).toMatch(new RegExp(`/group/${group.shareCode}$`));

      // --- the second diner joins through that link ---------------------------
      await guest.page.goto(new URL(inviteLink).pathname);
      await guest.page.getByTestId("join-confirm-button").click({
        timeout: NAV_TIMEOUT,
      });
      const guestName = e2eName("團員");
      await guest.page.getByTestId("join-name-input").fill(guestName);
      const joined = guest.page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/v1/orders/group/join/${group.shareCode}`) &&
          response.request().method() === "POST",
      );
      await guest.page.getByTestId("join-submit-button").click();
      expect((await joined).status(), "group join").toBeLessThan(300);
      await expect(guest.page).toHaveURL(
        new RegExp(`/group/order/${group.groupOrderId}$`),
      );

      // --- 同桌合單: each diner adds a different dish -------------------------
      await addDishInGroupMode(
        guest.page,
        group.groupOrderId,
        menu.sideItem.id,
      );
      await addDishInGroupMode(
        host.page,
        group.groupOrderId,
        menu.plainItem.id,
      );

      // The host's shared cart holds both diners' lines before submitting.
      await expect(host.page.getByText(menu.plainItem.name)).toBeVisible({
        timeout: LIVE_TIMEOUT,
      });
      await expect(host.page.getByText(menu.sideItem.name)).toBeVisible({
        timeout: LIVE_TIMEOUT,
      });

      const locked = host.page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/v1/orders/group/${group.groupOrderId}/lock`) &&
          response.request().method() === "POST",
      );
      await host.page.getByTestId("group-order-submit").click();
      const lockResponse = await locked;
      const lockBody = (await lockResponse.json()) as {
        data?: { masterOrderId?: string; status?: string };
        error?: unknown;
      };
      expect(
        lockResponse.status(),
        `group submit: ${JSON.stringify(lockBody.error)}`,
      ).toBe(200);
      masterOrderId = lockBody.data?.masterOrderId;
      expect(masterOrderId, "submitting creates one real order").toBeTruthy();

      // --- read back: one order, both diners' dishes, on this table ----------
      const order = await readOrder(masterOrderId!);
      expect(order.tableId).toBe(table.id);
      expect(
        order.items
          .map((item) => ({
            menuItemId: item.menuItemId,
            quantity: item.quantity,
          }))
          .sort((a, b) => a.menuItemId - b.menuItemId),
      ).toEqual(
        [
          { menuItemId: menu.plainItem.id, quantity: 1 },
          { menuItemId: menu.sideItem.id, quantity: 1 },
        ].sort((a, b) => a.menuItemId - b.menuItemId),
      );
      expect(order.totalAmount).toBe(
        menu.plainItem.price + menu.sideItem.price,
      );

      await assertNoOverlayError(host.page);
      await assertNoOverlayError(guest.page);
    } finally {
      await host.context.close();
      await guest.context.close();
      await localCleanup.run();
    }
  });

  test("back from the shared cart, 加入 tapped at once still goes to the group cart, not the hidden personal cart", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const host = await newDinerContext(browser);
    try {
      const table = await createTable(localCleanup);
      const group = await startGroupFromMenu(host.page, table.qrCode);
      await expect(host.page.getByTestId("group-order-menu-link")).toBeVisible({
        timeout: NAV_TIMEOUT,
      });

      // The menu remounts with group mode off and only turns it on once its
      // read of the stored group (GET /orders/group/:id) answers. On a phone
      // that read takes as long as the network does; against a local worker
      // it is over before a test can tap. This holds the real response back
      // for 1.5s so the tap reliably lands inside that window. It does not
      // mock anything: the request still reaches the real Worker and the
      // page gets the Worker's real answer, only later.
      await host.page.route(
        (url) => url.pathname === `/api/v1/orders/group/${group.groupOrderId}`,
        async (route) => {
          if (route.request().method() !== "GET") {
            await route.fallback();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await route.continue();
        },
      );

      await host.page.getByTestId("group-order-menu-link").click();
      const add = host.page.getByTestId(`menu-item-add-${menu.plainItem.id}`);
      await expect(add).toBeVisible({ timeout: NAV_TIMEOUT });

      // Precondition: group mode is still off when the dish is tapped. If the
      // group had already loaded, this would be the ordinary path and the
      // test would prove nothing about the race.
      const groupModeAtTap = await host.page
        .getByTestId("group-cart-link")
        .count();
      await add.click();
      expect(
        groupModeAtTap,
        "the tap has to land before the stored group finished loading",
      ).toBe(0);

      // The dish reaches the group order the API holds…
      await expect
        .poll(
          async () =>
            (await readGroup(group.groupOrderId)).cartItems.map((item) =>
              Number(item.menuItemId),
            ),
          {
            timeout: LIVE_TIMEOUT,
            message:
              "the dish tapped during the group reload must reach the group cart",
          },
        )
        .toEqual([menu.plainItem.id]);

      // …and not the personal cart, which group mode hides from the diner.
      await expect(host.page.getByTestId("group-cart-link")).toBeVisible({
        timeout: LIVE_TIMEOUT,
      });
      await expect(host.page.getByTestId("personal-cart-hidden")).toHaveCount(
        0,
      );
      await assertNoOverlayError(host.page);
    } finally {
      await host.context.close();
      await localCleanup.run();
    }
  });
});
