/** Real browser -> real Worker -> local D1. The API must be on another origin. */
import { expect, test } from "@playwright/test";
import {
  ADMIN_URL,
  API_URL,
  OWNER_PASSWORD,
  OWNER_USERNAME,
  apiRequest,
  assertAuthenticated,
  assertNoOverlayError,
  getOwnerContext,
  gotoAdmin,
  requireStack,
  suffix,
} from "./admin-e2e";
import { smokeLogin } from "../smoke/smoke-env";

test("the counter settles a guest order across origins and makes it refundable", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await requireStack();
  expect(new URL(API_URL).origin).not.toBe(new URL(ADMIN_URL).origin);

  const { token, restaurantId } = await getOwnerContext();
  const menu = await apiRequest<{
    menuItems?: Array<{ id: number; isAvailable?: boolean }>;
    items?: Array<{ id: number; isAvailable?: boolean }>;
    categories?: Array<{
      items?: Array<{ id: number; isAvailable?: boolean }>;
    }>;
  }>(`/api/v1/menu/${restaurantId}`);
  expect(menu.ok).toBe(true);
  const items = [
    ...(menu.body.data?.menuItems ?? []),
    ...(menu.body.data?.items ?? []),
    ...(menu.body.data?.categories ?? []).flatMap(
      (category) => category.items ?? [],
    ),
  ];
  const item = items.find((candidate) => candidate.isAvailable !== false);
  expect(item?.id).toBeTruthy();

  const created = await apiRequest<{
    order: { id: string; totalAmount: number };
  }>("/api/v1/guest-orders", {
    method: "POST",
    body: {
      restaurantId,
      orderType: "shop",
      items: [{ menuItemId: item!.id, quantity: 1 }],
      guestName: `E2E Checkout ${suffix()}`,
      deliveryInfo: { type: "takeaway" },
    },
  });
  expect(created.ok, `guest order returned ${created.status}`).toBe(true);
  const order = created.body.data?.order;
  expect(order?.id).toBeTruthy();

  // The same transitions as the order-management screen uses to hand a
  // fulfilled order to the counter; payments must not manufacture fulfilment.
  for (const status of ["confirmed", "preparing", "ready", "delivered"]) {
    const updated = await apiRequest(`/api/v1/orders/${order!.id}/status`, {
      token,
      method: "PUT",
      body: { status },
    });
    expect(updated.ok, `${status} returned ${updated.status}`).toBe(true);
  }

  // The list presents the order number, not its id; use the API order number
  // so this click cannot accidentally settle a different pending order.
  const freshBefore = await apiRequest<{
    orderNumber: string;
    totalAmount: number;
  }>(`/api/v1/orders/${order!.id}`, { token });
  expect(freshBefore.ok).toBe(true);
  const orderNumber = freshBefore.body.data!.orderNumber;

  // A browser login exercises the cross-origin refresh/CSRF cookie setup too.
  // It invalidates the Node-side login above, so finish all authenticated
  // setup requests before this point.
  await gotoAdmin(page, "/login", { waitForApi: false });
  await page.getByLabel("Username").fill(OWNER_USERNAME);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).toHaveURL(/\/dashboard\//);
  await gotoAdmin(page, "/dashboard/pos/checkout", {
    expectApi: "/api/v1/orders",
  });
  await assertAuthenticated(page);
  await page.locator(".cursor-pointer", { hasText: orderNumber }).click();
  await page
    .getByTestId("received-amount")
    .fill(String(freshBefore.body.data!.totalAmount));

  const paymentResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/api/v1/payments` &&
      response.request().method() === "POST",
  );
  await page.getByTestId("pay-btn").click();
  const payment = await paymentResponse;
  expect(payment.ok(), `checkout returned ${payment.status()}`).toBe(true);
  expect(new URL(payment.url()).origin).not.toBe(new URL(page.url()).origin);
  const paymentHeaders = await payment.request().allHeaders();
  expect(paymentHeaders["origin"]).toBe(new URL(ADMIN_URL).origin);
  expect(paymentHeaders["idempotency-key"]).toBeTruthy();
  await expect(page.getByTestId("payment-success")).toBeVisible();

  await gotoAdmin(page, "/dashboard/orders", { expectApi: "/api/v1/orders" });
  await page.getByTestId("admin-orders-search").first().fill(orderNumber);
  await expect(
    page.getByTestId(`admin-order-refund-${order!.id}`).first(),
  ).toBeVisible();
  await assertNoOverlayError(page);

  // The browser login retired the setup token. Re-authenticate only after
  // the UI assertions, then inspect the actual D1-backed order fields.
  const inspectionLogin = await smokeLogin(
    API_URL,
    OWNER_USERNAME,
    OWNER_PASSWORD,
  );
  const fresh = await apiRequest<{
    paymentStatus: string;
    paymentTransactionId?: string;
  }>(`/api/v1/orders/${order!.id}`, { token: inspectionLogin.token });
  expect(fresh.body.data?.paymentStatus).toBe("completed");
  expect(fresh.body.data?.paymentTransactionId).toBeTruthy();
});

test("the cashier's register and shift headers survive a browser preflight", async ({
  page,
}) => {
  await requireStack();
  expect(new URL(API_URL).origin).not.toBe(new URL(ADMIN_URL).origin);
  await gotoAdmin(page, "/login", { waitForApi: false });

  const status = await page.evaluate(async (apiUrl) => {
    const response = await fetch(`${apiUrl}/api/v1/pos/registers`, {
      headers: { "X-Register-Id": "e2e", "X-Shift-Id": "e2e" },
    });
    return response.status;
  }, API_URL);

  // The unauthenticated route can refuse us; the browser must be allowed to
  // read that response rather than rejecting the preflight as a Network Error.
  expect(status).toBeGreaterThanOrEqual(400);
  expect(status).toBeLessThan(500);
});
