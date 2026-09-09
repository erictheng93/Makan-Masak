/**
 * 分析與設定 → 系統設定, against a real API and a real D1.
 *
 * This is the regression guard for #309 (F16), which was the largest silent
 * failure the 2026-09-01 production pass found: `SettingsView` bound 28 leaf
 * fields and `saveSettings` sent 8. The other 20 could be edited, showed a
 * success toast, and were gone on reload — restaurant name, business hours,
 * timezone, auto-confirm, and the minimum order amount that the checkout path
 * genuinely enforces.
 *
 * Two things follow from how that bug hid, and both shape this file:
 *
 * 1. **Assert the outgoing request body, not the page after a reload.** A
 *    reload is confounded by caching and load order, and the success banner
 *    fires unconditionally regardless of what was sent. The request is the only
 *    place the truth is visible at the moment it matters.
 * 2. **Exercise one field per persistence path.** The settings object is written
 *    three different ways — a top-level restaurants column, a key inside the
 *    `settings` JSON the server reads, and a key inside the `settings.
 *    adminConsole` bucket that survives only because the zod schema is
 *    `.loose()` and the update shallow-merges. A test touching one path would
 *    have passed throughout the bug.
 *
 * The suite mutates the restaurant row every other spec depends on, so the
 * original values are captured first and restored in `finally`, and
 * `allowGuestOrders` is never touched — the order specs place real guest
 * orders and would start failing in a way that pointed nowhere near here.
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
} from "./admin-e2e";

interface RestaurantSettings {
  currency?: string;
  language?: string;
  timezone?: string;
  allowGuestOrders?: boolean;
  taxRate?: number;
  serviceChargeRate?: number;
  adminConsole?: {
    security?: { password?: { minLength?: number } };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface Restaurant {
  id?: string;
  name?: string;
  timezone?: string;
  settings?: RestaurantSettings | null;
}

async function readRestaurant(restaurantId: string, token: string) {
  const result = await apiRequest<Restaurant>(
    `/api/v1/restaurants/${restaurantId}`,
    { token },
  );
  expect(result.ok, `restaurant read returned ${result.status}`).toBe(true);
  return result.body.data!;
}

test.describe.configure({ mode: "serial" });

test.describe("系統設定 (real API)", () => {
  test("one field from each persistence path survives a save and a reload (#309)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const original = await readRestaurant(restaurantId, token);

    // Values chosen to differ from whatever is there now, so "unchanged" can
    // never read as "saved".
    const nextTimezone =
      original.timezone === "Asia/Singapore" ? "Asia/Taipei" : "Asia/Singapore";
    // The input is a percentage and the column is a fraction:
    // `calculateOrderTotal` does `subtotalCents * taxRate`, so 7% must arrive
    // as 0.07. Typing the percent and asserting the fraction is the point —
    // a test that asserted the same number on both sides would pass while the
    // conversion was missing, and every order would be taxed 100x.
    const nextTaxPercent = original.settings?.taxRate === 0.07 ? 5 : 7;
    const nextTaxRate = nextTaxPercent / 100;
    const currentMinLength =
      original.settings?.adminConsole?.security?.password?.minLength;
    const nextMinLength = currentMinLength === 12 ? 10 : 12;

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/settings", {
        expectApi: `/api/v1/restaurants/${restaurantId}`,
      });
      await assertAuthenticated(page);

      // The three fields live on three different tabs, which is part of why a
      // partial save went unnoticed: nobody sees all of them at once.

      // Path 1 (general tab): a top-level restaurants column.
      await page.getByTestId("settings-tab-general").click();

      // Wait for the form to actually hold the server's value before changing
      // it. The settings fetch is still in flight right after navigation, and
      // when it lands it repopulates every field — silently discarding an
      // edit made a moment too early, which surfaces much later as "the value
      // I typed was not in the PUT body".
      await expect(page.getByTestId("settings-timezone")).toHaveValue(
        original.timezone ?? "",
      );
      await page.getByTestId("settings-timezone").selectOption(nextTimezone);

      // Path 2 (orders tab): a key the server reads out of the settings JSON.
      await page.getByTestId("settings-tab-orders").click();
      await page.getByTestId("settings-tax-rate").fill(String(nextTaxPercent));

      // Path 3 (security tab): the adminConsole bucket, which persists only
      // because the schema is `.loose()` and updateRestaurant shallow-merges
      // the JSON column rather than replacing it.
      await page.getByTestId("settings-tab-security").click();
      await page
        .getByTestId("settings-password-min-length")
        .fill(String(nextMinLength));

      const saved = page.waitForRequest(
        (request) =>
          request.url().includes(`/api/v1/restaurants/${restaurantId}`) &&
          request.method() === "PUT",
      );
      await page.getByTestId("settings-save").click();
      const request = await saved;

      // The assertion #309 needed. The banner says "saved" either way; the
      // body is where a dropped field is visible.
      const body = JSON.parse(request.postData() ?? "{}") as Restaurant;
      expect(body.timezone, "timezone must be in the PUT body").toBe(
        nextTimezone,
      );
      expect(
        body.settings?.taxRate,
        `taxRate must be in the PUT body as a fraction (${nextTaxPercent}% -> ${nextTaxRate})`,
      ).toBeCloseTo(nextTaxRate, 6);
      expect(
        body.settings?.adminConsole?.security?.password?.minLength,
        "adminConsole security settings must be in the PUT body",
      ).toBe(nextMinLength);

      // And all three actually landed, read back through the API.
      await expect
        .poll(
          async () => {
            const fresh = await readRestaurant(restaurantId, token);
            return {
              timezone: fresh.timezone,
              taxRate: fresh.settings?.taxRate,
              minLength:
                fresh.settings?.adminConsole?.security?.password?.minLength,
            };
          },
          { timeout: POLL_TIMEOUT },
        )
        .toEqual({
          timezone: nextTimezone,
          taxRate: nextTaxRate,
          minLength: nextMinLength,
        });
      // Guard the direction of the conversion explicitly: 0.07, never 7.
      const stored = await readRestaurant(restaurantId, token);
      expect(stored.settings?.taxRate).toBeLessThan(1);

      await assertNoOverlayError(page);
    } finally {
      // Put the restaurant back exactly as it was. Every other spec in this
      // project reads this row.
      await apiRequest(`/api/v1/restaurants/${restaurantId}`, {
        token,
        method: "PUT",
        body: {
          name: original.name,
          timezone: original.timezone,
          settings: original.settings ?? {},
        },
      }).catch(() => {
        /* best-effort restore */
      });
    }
  });

  test("guest ordering stays enabled, because the order specs depend on it", async () => {
    test.setTimeout(60_000);
    await requireStack();

    const { token, restaurantId } = await getOwnerContext();
    const restaurant = await readRestaurant(restaurantId, token);

    // Not a settings-page assertion so much as a guard on this file: if the
    // save/restore above ever drops `allowGuestOrders`, the order specs start
    // failing for a reason that points nowhere near here.
    expect(
      restaurant.settings?.allowGuestOrders,
      "allowGuestOrders must survive the settings round trip",
    ).toBe(true);
  });
});
