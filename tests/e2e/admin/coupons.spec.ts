/**
 * 營運管理流程 → 優惠券, against a real API and a real D1.
 *
 * Mostly this file exists to stop two things being re-litigated.
 *
 * The money units are correct and have been checked against production: a 10%
 * coupon capped at NT$50 with a NT$200 minimum is stored as
 * `discount_percentage_bps = 1000`, `max_discount_amount_cents = 5000`,
 * `min_order_amount_cents = 20000`. That has been suspected of a 100x error
 * more than once. Asserting it here means the next person gets an answer from
 * a test run instead of another investigation.
 *
 * The validity window moved from lexicographic TEXT to INTEGER ms in
 * `a9743a7d` (#271). A round-trip assertion is the cheap way to keep it there:
 * the failure mode of the old shape was not an error, it was a coupon that
 * silently sorted and compared wrong.
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

interface Coupon {
  id?: number;
  code?: string;
  name?: string;
  discountType?: string;
  discountPercentageBps?: number | null;
  maxDiscountAmountCents?: number | null;
  minOrderAmountCents?: number | null;
  validFrom?: string;
  validTo?: string;
  isActive?: boolean;
  usedCount?: number;
}

/** Uppercase letters and digits only, and unique per run. */
function e2eCouponCode(): string {
  return `E2E${suffix().toUpperCase()}`.slice(0, 12);
}

async function listCoupons(restaurantId: string, token: string) {
  const result = await apiRequest<Coupon[]>(
    `/api/v1/coupons?restaurantId=${restaurantId}`,
    { token },
  );
  expect(result.ok, `coupon list returned ${result.status}`).toBe(true);
  return result.body.data ?? [];
}

test.describe.configure({ mode: "serial" });

test.describe("優惠券 (real API)", () => {
  test("creating a coupon through the form stores bps and cents, not raw numbers", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const code = e2eCouponCode();
    let couponId: number | undefined;

    await installAdminSession(page, login);

    try {
      // The whole view is behind `v-if="hasCouponsModule"` and the list fetch
      // sits behind a watcher on it, so nothing renders until /me/modules has
      // answered. Waiting on the coupons call alone races that.
      await gotoAdmin(page, "/dashboard/coupons", {
        expectApi: "/api/v1/me/modules",
      });
      await assertAuthenticated(page);

      await page.getByTestId("open-create-coupon").click();
      await page.getByTestId("coupon-name").fill(`E2E Coupon ${suffix()}`);
      await page.getByTestId("coupon-code").fill(code);
      await page.getByTestId("coupon-discount-type").selectOption("percentage");
      await page.getByTestId("coupon-discount-value").fill("10");
      await page.getByTestId("coupon-max-discount").fill("50");
      await page.getByTestId("coupon-min-order").fill("200");
      await page.getByTestId("coupon-valid-from").fill("2026-10-01T00:00");
      await page.getByTestId("coupon-valid-to").fill("2026-12-31T23:59");

      const created = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/coupons") &&
          response.request().method() === "POST",
      );
      await page.getByTestId("coupon-submit").click();
      const response = await created;
      expect(response.ok(), `coupon create returned ${response.status()}`).toBe(
        true,
      );

      const body = (await response.json()) as { data?: Coupon };
      couponId = body.data?.id;
      expect(typeof couponId, "created coupon id").toBe("number");

      // The three units, read back from the server. 10% is 1000 basis points;
      // NT$50 and NT$200 are 5000 and 20000 cents.
      await expect
        .poll(
          async () => {
            const found = (await listCoupons(restaurantId, token)).find(
              (coupon) => coupon.id === couponId,
            );
            return found
              ? {
                  bps: found.discountPercentageBps,
                  maxCents: found.maxDiscountAmountCents,
                  minCents: found.minOrderAmountCents,
                }
              : undefined;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toEqual({ bps: 1000, maxCents: 5000, minCents: 20000 });

      await assertNoOverlayError(page);
    } finally {
      if (couponId) {
        // DELETE is requireRole([0]) — an owner gets 403, and the UI correctly
        // hides the button. Deactivating is the owner's disposal path.
        await apiCleanup(`/api/v1/coupons/${couponId}/deactivate`, token, {
          method: "POST",
          body: {},
        });
      }
    }
  });

  test("the validity window round-trips as an ordered instant, not lexicographic text", async () => {
    test.setTimeout(120_000);
    await requireStack();

    const { token, restaurantId } = await getOwnerContext();
    const code = e2eCouponCode();

    // Deliberately spans a year boundary and uses a non-midnight time. The old
    // TEXT column compared these lexicographically, which happens to work for
    // ISO-8601 UTC and stops working the moment anything else is stored — the
    // defect #271 removed.
    const validFrom = "2026-12-31T16:30:00.000Z";
    const validTo = "2027-01-02T08:15:00.000Z";

    const created = await apiRequest<Coupon>("/api/v1/coupons", {
      token,
      method: "POST",
      body: {
        restaurantId,
        code,
        name: `E2E Window ${suffix()}`,
        discountType: "percentage",
        discountValue: 5,
        validFrom,
        validTo,
      },
    });
    expect(created.ok, `coupon create returned ${created.status}`).toBe(true);
    const couponId = created.body.data?.id;

    try {
      const found = (await listCoupons(restaurantId, token)).find(
        (coupon) => coupon.id === couponId,
      );
      expect(found, "created coupon should be listed").toBeTruthy();

      // Compare as instants, not as strings: a value stored in the wrong unit
      // still round-trips as *a* string, just not as this moment in time.
      expect(new Date(found!.validFrom!).getTime()).toBe(
        new Date(validFrom).getTime(),
      );
      expect(new Date(found!.validTo!).getTime()).toBe(
        new Date(validTo).getTime(),
      );
      expect(new Date(found!.validTo!).getTime()).toBeGreaterThan(
        new Date(found!.validFrom!).getTime(),
      );
    } finally {
      if (couponId) {
        await apiCleanup(`/api/v1/coupons/${couponId}/deactivate`, token, {
          method: "POST",
          body: {},
        });
      }
    }
  });

  test("an owner is not offered a delete they are not allowed to perform", async () => {
    test.setTimeout(120_000);
    await requireStack();

    const { token, restaurantId } = await getOwnerContext();
    const created = await apiRequest<Coupon>("/api/v1/coupons", {
      token,
      method: "POST",
      body: {
        restaurantId,
        code: e2eCouponCode(),
        name: `E2E Delete ${suffix()}`,
        discountType: "percentage",
        discountValue: 5,
        validFrom: "2026-10-01T00:00:00.000Z",
        validTo: "2026-12-31T00:00:00.000Z",
      },
    });
    const couponId = created.body.data?.id;

    try {
      // Server-side: DELETE is admin-only. Worth asserting rather than
      // assuming, because the owner UI hides the button — which means a
      // regression in the route guard would be invisible from the dashboard.
      const attempt = await apiRequest(`/api/v1/coupons/${couponId}`, {
        token,
        method: "DELETE",
      });
      expect(attempt.status, "owner DELETE must be refused").toBe(403);

      // Deactivate is what an owner may do instead.
      const deactivated = await apiRequest(
        `/api/v1/coupons/${couponId}/deactivate`,
        { token, method: "POST", body: {} },
      );
      expect(deactivated.ok).toBe(true);

      const found = (await listCoupons(restaurantId, token)).find(
        (coupon) => coupon.id === couponId,
      );
      expect(found?.isActive).toBe(false);
    } finally {
      if (couponId) {
        await apiCleanup(`/api/v1/coupons/${couponId}/deactivate`, token, {
          method: "POST",
          body: {},
        });
      }
    }
  });
});
