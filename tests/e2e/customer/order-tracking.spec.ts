/**
 * master-user-flow 1. 顧客端 → 訂單追蹤流程, against a real API, a real realtime
 * worker and a real D1.
 *
 * The orders are placed through the real guest endpoint and their session is
 * put where the cart leaves it (the ordering UI itself is covered by
 * ordering.spec.ts). Every staff action is a real API call; what is under test
 * is that the open tracking page follows it **without a reload** — which is why
 * each test plants a marker in the document and checks it survived, and records
 * the realtime frames so a failure says whether the server sent the event or
 * the page dropped it.
 */
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  Cleanup,
  apiData,
  assertNoOverlayError,
  cancelOnCleanup,
  createGuestTableOrder,
  createMenuFixture,
  createTable,
  expectNoReload,
  getCashier,
  getOwner,
  installGuestOrderSession,
  LIVE_TIMEOUT,
  markDocument,
  NAV_TIMEOUT,
  newDinerContext,
  readOrder,
  recordRealtimeEvents,
  requireStack,
  staffSetStatus,
  toasts,
  trackingPath,
  waitForRealtimeAck,
  type GuestOrderFixture,
  type MenuFixture,
  type TableFixture,
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

interface TrackedOrder {
  page: Page;
  events: string[];
  table: TableFixture;
  fixture: GuestOrderFixture;
  close: () => Promise<void>;
}

/**
 * One diner, one order, its tracking page open and subscribed. The order is
 * cancelled on cleanup if a test leaves it active, which is what keeps the
 * guest active-order lock from leaking into the next test.
 */
async function openTrackedOrder(
  browser: Parameters<typeof newDinerContext>[0],
  localCleanup: Cleanup,
  quantity = 1,
): Promise<TrackedOrder> {
  const owner = await getOwner();
  const table = await createTable(localCleanup);
  const fixture = await createGuestTableOrder({
    table,
    items: [{ menuItemId: menu.plainItem.id, quantity }],
  });
  cancelOnCleanup(localCleanup, () => fixture.order.id);

  const { context, page } = await newDinerContext(browser);
  const events = recordRealtimeEvents(page);
  await installGuestOrderSession(context, {
    guestToken: fixture.guestToken,
    restaurantId: owner.restaurantId,
    tableId: table.id,
    qrCode: table.qrCode,
  });
  await page.goto(trackingPath(owner.restaurantId, table.id, fixture.order.id));
  await expect(page.getByTestId("order-status-title")).toHaveText("待確認", {
    timeout: NAV_TIMEOUT,
  });
  await waitForRealtimeAck(events);
  await markDocument(page);
  return { page, events, table, fixture, close: () => context.close() };
}

function timelineStep(page: Page, title: string) {
  return page
    .getByTestId("order-timeline")
    .locator("[data-status]")
    .filter({ hasText: title });
}

test.describe("訂單追蹤流程 (real API + realtime)", () => {
  test("staff push pending → delivered and the open page follows every step, times included", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const tracked = await openTrackedOrder(browser, localCleanup);
    const { page, events } = tracked;
    try {
      const steps = [
        { status: "confirmed", title: "已確認", timeline: "訂單已確認" },
        { status: "preparing", title: "製作中", timeline: "正在製作" },
        { status: "ready", title: "準備完成", timeline: "準備完成" },
        { status: "delivered", title: "已送達", timeline: "已送達" },
      ];

      for (const step of steps) {
        await staffSetStatus(tracked.fixture.order.id, step.status);

        await expect(
          page.getByTestId("order-status-title"),
          `after staff set ${step.status}; realtime events so far: ${events.join(", ")}`,
        ).toHaveText(step.title, { timeout: LIVE_TIMEOUT });

        // C11/C12 (09-15): the step is marked done *and* carries its time.
        // 正在製作 used to be hard-coded to no time, and every time arrived
        // only after a reload because the live patch carried status alone.
        const row = timelineStep(page, step.timeline);
        await expect(row).toHaveAttribute("data-status", "completed");
        await expect(
          row,
          `timeline step ${step.timeline} should show when it happened`,
        ).toContainText(/\d{2}:\d{2}/, { timeout: LIVE_TIMEOUT });
      }

      expect(
        events.filter((type) => type === "order_status_update").length,
        "one status broadcast per transition",
      ).toBeGreaterThanOrEqual(steps.length);
      await expectNoReload(page);

      const order = await readOrder(tracked.fixture.order.id);
      expect(order.status).toBe("delivered");
      await assertNoOverlayError(page);
    } finally {
      await tracked.close();
      await localCleanup.run();
    }
  });

  test("a staff quantity change and a staff cancellation both reach the open page", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const owner = await getOwner();
    const edited = await openTrackedOrder(browser, localCleanup, 2);
    const cancelled = await openTrackedOrder(browser, localCleanup, 1);
    try {
      // --- quantity change on the first diner's order ----------------------
      const before = await readOrder(edited.fixture.order.id);
      const line = before.items[0];
      await apiData(
        "staff changes quantity",
        `/api/v1/orders/${edited.fixture.order.id}/items/${line.id}`,
        {
          token: owner.token,
          method: "PATCH",
          body: { quantity: 3 },
        },
      );

      const expectedTotal = menu.plainItem.price * 3;
      await expect(
        edited.page.getByTestId("order-total"),
        `realtime events: ${edited.events.join(", ")}`,
      ).toHaveText(`NT$${expectedTotal}`, { timeout: LIVE_TIMEOUT });
      await expect(edited.page.getByText("× 3")).toBeVisible();
      await expect
        .poll(() => toasts(edited.page), { timeout: LIVE_TIMEOUT })
        .toContain("店家已更新您的訂單內容");
      await expectNoReload(edited.page);
      expect((await readOrder(edited.fixture.order.id)).totalAmount).toBe(
        expectedTotal,
      );

      // --- staff cancellation of the second diner's order ------------------
      await apiData(
        "staff cancels order",
        `/api/v1/orders/${cancelled.fixture.order.id}`,
        { token: owner.token, method: "DELETE" },
      );
      await expect(
        cancelled.page.getByTestId("order-status-title"),
        `realtime events: ${cancelled.events.join(", ")}`,
      ).toHaveText("已取消", { timeout: LIVE_TIMEOUT });
      await expect
        .poll(() => toasts(cancelled.page), { timeout: LIVE_TIMEOUT })
        .toContain("店家已取消這筆訂單");
      expect(cancelled.events).toContain("order_cancelled");
      await expectNoReload(cancelled.page);

      // The edit reached only the order it was made to.
      await expect(edited.page.getByTestId("order-status-title")).toHaveText(
        "待確認",
      );
    } finally {
      await edited.close();
      await cancelled.close();
      await localCleanup.run();
    }
  });

  test("a guest cancels from the page: 已取消, one toast, and no auth error on the refetch", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const tracked = await openTrackedOrder(browser, localCleanup);
    const { page } = tracked;
    const failedResponses: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/v1/") && response.status() >= 400) {
        failedResponses.push(`${response.status()} ${response.url()}`);
      }
    });
    try {
      await page.getByRole("button", { name: "取消訂單" }).click();
      const cancelled = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(
              `/api/v1/guest-orders/${tracked.fixture.order.id}/cancel`,
            ) && response.request().method() === "POST",
      );
      await page.getByTestId("confirmation-confirm").click();
      expect((await cancelled).status(), "guest cancel").toBe(200);

      await expect(page.getByTestId("order-status-title")).toHaveText(
        "已取消",
        { timeout: LIVE_TIMEOUT },
      );
      // The refetch after the cancel, and the realtime echo of the same
      // cancellation, both have to settle before counting toasts.
      await expect
        .poll(() => tracked.events.includes("order_cancelled"), {
          timeout: LIVE_TIMEOUT,
        })
        .toBe(true);
      await page.waitForTimeout(1_500);

      const shown = await toasts(page);
      expect(
        shown.filter((text) => text === "訂單已取消"),
        `toasts shown: ${JSON.stringify(shown)}`,
      ).toHaveLength(1);
      // The diner's own cancel must not also be announced as the shop's.
      expect(shown).not.toContain("店家已取消這筆訂單");
      expect(failedResponses, "no 401/403 on the post-cancel refetch").toEqual(
        [],
      );
      await expect(page.getByText("載入失敗")).toHaveCount(0);

      expect((await readOrder(tracked.fixture.order.id)).status).toBe(
        "cancelled",
      );
    } finally {
      await tracked.close();
      await localCleanup.run();
    }
  });

  test("delivered → paid: a cashier settles the order and the page shows it paid", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const tracked = await openTrackedOrder(browser, localCleanup);
    const { page, events } = tracked;
    try {
      const cashier = await getCashier();
      for (const status of ["confirmed", "preparing", "ready", "delivered"]) {
        await staffSetStatus(tracked.fixture.order.id, status);
      }
      await expect(page.getByTestId("order-status-title")).toHaveText(
        "已送達",
        { timeout: LIVE_TIMEOUT },
      );

      const order = await readOrder(tracked.fixture.order.id);
      await apiData("cashier settles order", "/api/v1/payments", {
        token: cashier.token,
        method: "POST",
        headers: { "Idempotency-Key": randomUUID() },
        body: {
          orderId: order.id,
          amount: order.totalAmount,
          method: "cash",
        },
      });

      await expect(
        page.getByTestId("order-status-title"),
        `realtime events: ${events.join(", ")}`,
      ).toHaveText("已完成", { timeout: LIVE_TIMEOUT });
      await expectNoReload(page);

      const paid = await readOrder(tracked.fixture.order.id);
      expect({
        status: paid.status,
        paymentStatus: paid.paymentStatus,
      }).toEqual({ status: "paid", paymentStatus: "completed" });
    } finally {
      await tracked.close();
      await localCleanup.run();
    }
  });

  test("繼續點餐 places a second order, and the first order's page still opens (#383)", async ({
    browser,
  }) => {
    const localCleanup = new Cleanup();
    const owner = await getOwner();
    const first = await openTrackedOrder(browser, localCleanup);
    const { page } = first;
    let secondOrderId: string | undefined;
    cancelOnCleanup(localCleanup, () => secondOrderId);
    try {
      // Delivered releases the one-active-order lock, which is what lets the
      // same device order again — the natural moment to 繼續點餐.
      for (const status of ["confirmed", "preparing", "ready", "delivered"]) {
        await staffSetStatus(first.fixture.order.id, status);
      }
      await expect(page.getByTestId("order-status-title")).toHaveText(
        "已送達",
        { timeout: LIVE_TIMEOUT },
      );

      await page.getByRole("button", { name: "繼續點餐" }).click();
      await expect(
        page.getByTestId(`menu-item-add-${menu.plainItem.id}`),
      ).toBeVisible({ timeout: NAV_TIMEOUT });
      await page.getByTestId(`menu-item-add-${menu.plainItem.id}`).click();
      await page.getByTestId("cart-btn").click();
      await page.getByTestId("submit-order-btn").click();
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/guest-orders") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("confirmation-confirm").click();
      const response = await created;
      expect(response.status(), "second order").toBe(201);
      secondOrderId = (
        (await response.json()) as { data: { order: { id: string } } }
      ).data.order.id;
      await expect(page.getByTestId("order-status-title")).toHaveText(
        "待確認",
        { timeout: NAV_TIMEOUT },
      );

      // Everything up to here works. Going back to the first order is the
      // open bug: the customer app keeps ONE guest_auth_token, the second
      // order overwrote it, and guestTokenAuth rejects a token minted for a
      // different order with 403 ACCESS_DENIED.
      test.fail(
        true,
        "#383: after a second order, the first order's tracking page answers 403",
      );
      const reread = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/v1/guest-orders/${first.fixture.order.id}`) &&
          response.request().method() === "GET",
      );
      await page.goto(
        trackingPath(
          owner.restaurantId,
          first.table.id,
          first.fixture.order.id,
        ),
      );
      const rereadResponse = await reread;
      expect(
        {
          status: rereadResponse.status(),
          body: rereadResponse.ok() ? "ok" : await rereadResponse.text(),
        },
        "GET /guest-orders/<first order> with the device's current guest token",
      ).toEqual({ status: 200, body: "ok" });
      await expect(
        page.getByTestId("order-status-title"),
        "the first order's tracking page should still load",
      ).toHaveText("已送達", { timeout: 20_000 });
    } finally {
      await first.close();
      await localCleanup.run();
    }
  });
});
