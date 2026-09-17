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
 */
import { expect, test, type Page } from "@playwright/test";
import {
  Cleanup,
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
      await host.page.goto(qrPath(table.qrCode));
      await host.page.getByTestId("start-group-order-button").click({
        timeout: NAV_TIMEOUT,
      });
      const hostName = e2eName("主揪");
      await host.page.getByTestId("group-host-name-input").fill(hostName);
      const created = host.page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/orders/group/create") &&
          response.request().method() === "POST",
      );
      await host.page.getByTestId("group-create-submit").click();
      const createResponse = await created;
      expect(createResponse.status(), "group create").toBeLessThan(300);
      const group = (
        (await createResponse.json()) as {
          data: { groupOrderId: string; shareCode: string };
        }
      ).data;
      await expect(host.page).toHaveURL(
        new RegExp(`/group/order/${group.groupOrderId}$`),
      );

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
});
