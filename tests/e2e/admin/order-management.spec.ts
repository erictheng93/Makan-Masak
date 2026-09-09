/**
 * 店務主流程 → 訂單管理, against a real API and a real D1.
 *
 * Orders are created here through the real guest-order endpoint rather than
 * seeded, because `scripts/seed-local.sql` creates none and because a
 * hand-written row cannot exercise pricing, the active-order dedup, or the
 * table occupancy side effects that the rest of the flow depends on.
 *
 * The payment-status test asserts an invariant rather than a mechanism. How
 * `orders.payment_status` gets written is being reworked (#310/#311) — the dead
 * `OrdersService.updatePaymentStatus` stub has been removed and reads now
 * normalise legacy values through an alias map — so a test naming a specific
 * route or method would pin one design in place. What must hold either way is
 * that the value the API hands back is one the rest of the system recognises.
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

interface OrderPayload {
  id?: string;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentTransactionId?: string;
  paidAt?: number | string | null;
}

interface GuestOrderPayload {
  order?: OrderPayload;
  guestToken?: string;
}

interface TableRow {
  id?: number;
}

interface MenuPayload {
  categories?: Array<{ items?: Array<{ id?: number; isAvailable?: boolean }> }>;
  menuItems?: Array<{ id?: number; isAvailable?: boolean }>;
  items?: Array<{ id?: number; isAvailable?: boolean }>;
}

/**
 * Mirrors ORDER_PAYMENT_STATUSES in packages/shared-types. Restated rather than
 * imported so the assertion fails if the canonical set is widened without a
 * deliberate decision here — importing it would make the test agree with any
 * change automatically, which is the opposite of a guard.
 */
const CANONICAL_PAYMENT_STATUSES = [
  "pending",
  "completed",
  "failed",
  "refunded",
  "partial_refunded",
];

function fourDigits(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0");
}

async function resolveOrderFixtures(restaurantId: string, token: string) {
  const tables = await apiRequest<TableRow[]>(
    `/api/v1/tables?restaurantId=${restaurantId}&limit=100`,
    { token },
  );
  expect(tables.ok, `tables lookup returned ${tables.status}`).toBe(true);
  const tableId = tables.body.data?.[0]?.id;

  const menu = await apiRequest<MenuPayload>(`/api/v1/menu/${restaurantId}`);
  const items = [
    ...(menu.body.data?.menuItems ?? []),
    ...(menu.body.data?.items ?? []),
    ...(menu.body.data?.categories ?? []).flatMap(
      (category) => category.items ?? [],
    ),
  ];
  const menuItemId = items.find((item) => item.isAvailable !== false)?.id;

  expect(
    tableId,
    "a seeded table is required to place a table order",
  ).toBeTruthy();
  expect(
    menuItemId,
    "an available menu item is required to place an order",
  ).toBeTruthy();

  return { tableId: tableId!, menuItemId: menuItemId! };
}

/** Places a real order through the public guest endpoint. */
async function createOrder(
  restaurantId: string,
  tableId: number,
  menuItemId: number,
) {
  const result = await apiRequest<GuestOrderPayload>("/api/v1/guest-orders", {
    method: "POST",
    body: {
      restaurantId,
      orderType: "table",
      tableId,
      items: [{ menuItemId, quantity: 1 }],
      guestName: `E2E ${suffix()}`,
      phoneLastDigits: fourDigits(),
    },
  });
  expect(result.ok, `guest order create returned ${result.status}`).toBe(true);
  const order = result.body.data?.order;
  expect(order?.id, "created order id").toBeTruthy();
  return order!;
}

test.describe.configure({ mode: "serial" });

test.describe("訂單管理 (real API)", () => {
  test("a real order reaches the orders page and can be searched by number", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const { tableId, menuItemId } = await resolveOrderFixtures(
      restaurantId,
      token,
    );
    const order = await createOrder(restaurantId, tableId, menuItemId);

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/orders", {
        expectApi: "/api/v1/orders",
      });
      await assertAuthenticated(page);
      await expect(page.getByTestId("admin-orders-page")).toBeVisible();

      // The desktop and mobile lists both render, and both emit the same
      // testids, so every row locator here has to be scoped with .first().
      await expect(
        page.getByTestId(`admin-order-update-${order.id}`).first(),
      ).toBeVisible();

      const searched = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/orders") &&
          response.url().includes("search=") &&
          response.request().method() === "GET",
      );
      await page
        .getByTestId("admin-orders-search")
        .first()
        .fill(order.orderNumber ?? "");
      await searched;

      await expect(
        page.getByTestId(`admin-order-update-${order.id}`).first(),
      ).toBeVisible();

      await assertNoOverlayError(page);
    } finally {
      await apiCleanup(`/api/v1/orders/${order.id}`, token, {
        body: { reason: "e2e cleanup" },
      });
    }
  });

  test("owner advances a pending order and the server agrees", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const { tableId, menuItemId } = await resolveOrderFixtures(
      restaurantId,
      token,
    );
    const order = await createOrder(restaurantId, tableId, menuItemId);

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/orders", {
        expectApi: "/api/v1/orders",
      });
      await assertAuthenticated(page);

      const updateButton = page
        .getByTestId(`admin-order-update-${order.id}`)
        .first();
      await expect(updateButton).toBeVisible();

      const updated = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/orders/${order.id}/status`) &&
          response.request().method() === "PUT",
      );
      await updateButton.click();
      const response = await updated;
      expect(
        response.ok(),
        `order status update returned ${response.status()}`,
      ).toBe(true);

      await expect
        .poll(
          async () => {
            const fresh = await apiRequest<OrderPayload>(
              `/api/v1/orders/${order.id}`,
              { token },
            );
            return fresh.body.data?.status;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe("confirmed");

      await assertNoOverlayError(page);
    } finally {
      await apiCleanup(`/api/v1/orders/${order.id}`, token, {
        body: { reason: "e2e cleanup" },
      });
    }
  });

  test("a new order reports a canonical, unpaid payment status (#311)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const { tableId, menuItemId } = await resolveOrderFixtures(
      restaurantId,
      token,
    );
    const order = await createOrder(restaurantId, tableId, menuItemId);

    try {
      const fresh = await apiRequest<OrderPayload>(
        `/api/v1/orders/${order.id}`,
        { token },
      );

      // The invariant, deliberately stated without reference to any particular
      // write path: whatever sets payment status, what the API hands back must
      // be a value the rest of the system recognises.
      //
      // #311 was the opposite of that. PaymentService wrote "paid", which is
      // not in ORDER_PAYMENT_STATUSES, and `toOrderPaymentStatus` silently
      // rewrote it to "pending" on read — so an order that had genuinely been
      // paid reported itself unpaid, and filtering by "completed" never matched
      // it. A non-canonical value here is that bug returning.
      expect(CANONICAL_PAYMENT_STATUSES).toContain(
        fresh.body.data?.paymentStatus,
      );
      expect(fresh.body.data?.paymentStatus).toBe("pending");
      expect(fresh.body.data?.paymentTransactionId).toBeFalsy();

      // And the same order, read through the dashboard rather than the API.
      await installAdminSession(page, login);
      await gotoAdmin(page, "/dashboard/orders", {
        expectApi: "/api/v1/orders",
      });
      await assertAuthenticated(page);
      await expect(
        page.getByTestId(`admin-order-update-${order.id}`).first(),
      ).toBeVisible();
      await assertNoOverlayError(page);
    } finally {
      await apiCleanup(`/api/v1/orders/${order.id}`, token, {
        body: { reason: "e2e cleanup" },
      });
    }
  });
});
