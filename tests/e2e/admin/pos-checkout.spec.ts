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

  const { token, restaurantId, login } = await getOwnerContext();
  const menu = await apiRequest<{
    menuItems: Array<{ id: number; isAvailable?: boolean }>;
  }>(`/api/v1/menu/${restaurantId}`);
  expect(menu.ok).toBe(true);
  const item = menu.body.data?.menuItems.find(
    (candidate) => candidate.isAvailable !== false,
  );
  expect(item?.id).toBeTruthy();

  // CashierView selects the first active register (the API sorts by name).
  // Reuse that ledger on repeat local runs, or create one on a fresh CI D1.
  const registersResponse = await apiRequest<
    Array<{ id: string; isActive: boolean }>
  >(`/api/v1/pos/registers?restaurantId=${restaurantId}`, { token });
  expect(registersResponse.ok).toBe(true);
  let registerId = registersResponse.body.data?.find((r) => r.isActive)?.id;
  if (!registerId) {
    const registerResponse = await apiRequest<{ id: string }>(
      "/api/v1/pos/registers",
      {
        token,
        method: "POST",
        body: {
          name: `E2E Refund Register ${suffix()}`,
          restaurantId,
        },
      },
    );
    expect(
      registerResponse.ok,
      `register creation returned ${registerResponse.status}`,
    ).toBe(true);
    registerId = registerResponse.body.data?.id;
  }
  expect(registerId).toBeTruthy();
  expect(
    login.user?.id,
    "owner login should return an operator id",
  ).toBeTruthy();
  const currentShift = await apiRequest<{ id: string } | null>(
    `/api/v1/pos/shifts/current/${registerId}`,
    { token },
  );
  expect(currentShift.ok).toBe(true);
  let shiftId = currentShift.body.data?.id;
  if (!shiftId) {
    const shiftResponse = await apiRequest<{ id: string }>(
      "/api/v1/pos/shifts/start",
      {
        token,
        method: "POST",
        body: {
          registerId,
          operatorId: login.user!.id,
          startAmount: 0,
        },
      },
    );
    expect(
      shiftResponse.ok,
      `shift creation returned ${shiftResponse.status}`,
    ).toBe(true);
    shiftId = shiftResponse.body.data?.id;
  }
  expect(shiftId).toBeTruthy();

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
  const cashPayment = page
    .locator("button[data-selected]")
    .filter({ hasText: /Cash|現金/ });
  await cashPayment.click();
  await expect(cashPayment).toHaveAttribute("data-selected", "true");
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
  await page.getByTestId("payment-success").getByRole("button").nth(1).click();

  await page.getByTestId("cashier-open-refund").click();
  await page.getByTestId("cashier-refund-order-number").fill(orderNumber);
  await page
    .getByTestId("cashier-refund-amount")
    .fill(String(freshBefore.body.data!.totalAmount));
  await page.getByTestId("cashier-refund-reason").selectOption("quality_issue");

  const refundResponse = page.waitForResponse(
    (response) =>
      response.url() === `${API_URL}/api/v1/pos/refunds/create` &&
      response.request().method() === "POST",
  );
  await page.getByTestId("cashier-confirm-refund").click();
  const refund = await refundResponse;
  expect(refund.ok(), `refund returned ${refund.status()}`).toBe(true);
  const refundHeaders = await refund.request().allHeaders();
  expect(refundHeaders["origin"]).toBe(new URL(ADMIN_URL).origin);
  expect(refundHeaders["x-register-id"]).toBe(registerId);
  expect(refundHeaders["x-shift-id"]).toBe(shiftId);
  expect(refundHeaders.cookie?.includes("__Host-mm_staff_refresh=")).toBe(true);
  await expect(page.getByTestId("cashier-refund-order-number")).toHaveCount(0);
  await assertNoOverlayError(page);

  // The browser login retired the setup token. Re-authenticate only after
  // the UI assertions, then inspect the actual D1-backed payment and refund.
  const inspectionLogin = await smokeLogin(
    API_URL,
    OWNER_USERNAME,
    OWNER_PASSWORD,
  );
  const fresh = await apiRequest<{
    status: string;
    paymentStatus: string;
    paymentTransactionId?: string;
  }>(`/api/v1/orders/${order!.id}`, { token: inspectionLogin.token });
  // A completed POS refund writes the order back the same way the payments
  // refund path does (ff90d086): the full refund above leaves it refunded,
  // not still reading as a settled payment. The collected payment's
  // transaction id stays on the order.
  expect(fresh.body.data).toEqual(
    expect.objectContaining({ status: "refunded", paymentStatus: "refunded" }),
  );
  expect(fresh.body.data?.paymentTransactionId).toBeTruthy();
  const refunds = await apiRequest<{
    refunds: Array<{
      originalOrderId: string;
      refundAmountCents: number;
      status: string;
    }>;
  }>(`/api/v1/pos/refunds/registers/${registerId}/refunds`, {
    token: inspectionLogin.token,
  });
  expect(refunds.ok, `refund inspection returned ${refunds.status}`).toBe(true);
  expect(refunds.body.data?.refunds).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        originalOrderId: order!.id,
        refundAmountCents: Math.round(freshBefore.body.data!.totalAmount * 100),
        status: "completed",
      }),
    ]),
  );
});
