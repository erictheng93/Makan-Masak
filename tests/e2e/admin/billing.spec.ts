/**
 * 分析與設定 → 訂閱與帳務, against a real API and a real D1.
 *
 * This node was the one genuine blocker in master-user-flow section 2: a shop
 * owner had no billing or subscription interface at all. `/dashboard/
 * subscriptions` is the platform-operator console — role 0 only, it lists every
 * tenant and creates subscriptions for arbitrary restaurants from a free-text
 * field — and there was no sidebar entry for it even for admins. Meanwhile
 * `GET /me/modules` and `GET /me/usage` had been serving exactly the owner's
 * own plan, trial window and metered usage, with zero frontend consumers
 * (#315 / F20).
 *
 * So these tests are less about a workflow than about the gap staying closed:
 * the page exists, the sidebar reaches it, and it renders data that came from
 * the owner-scoped endpoints rather than from fixtures.
 */
import { expect, test } from "@playwright/test";
import {
  apiRequest,
  assertAuthenticated,
  assertNoOverlayError,
  getOwnerContext,
  gotoAdmin,
  installAdminSession,
  requireStack,
} from "./admin-e2e";

interface ModulesPayload {
  planTier?: string;
  isActive?: boolean;
  trialEndsAt?: number | null;
  effectiveModules?: Record<string, boolean>;
}

interface UsagePayload {
  cycleStartAt?: number | null;
  cycleEndAt?: number | null;
  meters?: Array<{
    meterKey: string;
    total: number;
    hardLimit?: number | null;
  }>;
}

test.describe.configure({ mode: "serial" });

test.describe("訂閱與帳務 (real API)", () => {
  test("owner reaches plan & usage from the sidebar (F20)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login } = await getOwnerContext();
    await installAdminSession(page, login);

    await gotoAdmin(page, "/dashboard/settings", {
      expectApi: "/api/v1/restaurants/",
    });
    await assertAuthenticated(page);

    const navEntry = page.getByTestId("nav-item-billing");
    await expect(
      navEntry,
      "an owner must be able to reach their own plan without typing a URL (F20)",
    ).toBeVisible();

    await Promise.all([
      page.waitForResponse(
        (response) => response.url().includes("/api/v1/me/usage"),
        { timeout: 60_000 },
      ),
      navEntry.click(),
    ]);

    await expect(page.getByTestId("billing-page")).toBeVisible();
    await assertNoOverlayError(page);
  });

  test("the page renders the owner's real plan, meters and modules", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token } = await getOwnerContext();

    const modules = await apiRequest<ModulesPayload>("/api/v1/me/modules", {
      token,
    });
    const usage = await apiRequest<UsagePayload>("/api/v1/me/usage", { token });
    expect(modules.ok, `me/modules returned ${modules.status}`).toBe(true);
    expect(usage.ok, `me/usage returned ${usage.status}`).toBe(true);

    await installAdminSession(page, login);
    await gotoAdmin(page, "/dashboard/billing", {
      expectApi: "/api/v1/me/usage",
    });
    await assertAuthenticated(page);

    // Plan status comes from the subscription row, not from a hardcoded label.
    await expect(page.getByTestId("billing-plan-status")).toHaveAttribute(
      "data-status",
      modules.body.data?.isActive ? "active" : "inactive",
    );

    // Every meter the API reported has to be on the page. Asserting the set
    // rather than one row is what would catch a silently dropped meter.
    for (const meter of usage.body.data?.meters ?? []) {
      await expect(
        page.getByTestId(`billing-meter-${meter.meterKey}`),
        `meter ${meter.meterKey} should be rendered`,
      ).toBeVisible();
    }

    // Same for modules, including the disabled ones — an owner needs to see
    // what their plan does *not* include, which is the half a marketing page
    // would omit.
    const moduleEntries = Object.entries(
      modules.body.data?.effectiveModules ?? {},
    );
    expect(moduleEntries.length).toBeGreaterThan(0);
    for (const [key, enabled] of moduleEntries) {
      await expect(page.getByTestId(`billing-module-${key}`)).toHaveAttribute(
        "data-enabled",
        String(enabled),
      );
    }

    await assertNoOverlayError(page);
  });

  test("plan changes route to the support channel that actually exists", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login } = await getOwnerContext();
    await installAdminSession(page, login);
    await gotoAdmin(page, "/dashboard/billing", {
      expectApi: "/api/v1/me/usage",
    });
    await assertAuthenticated(page);

    // Deliberately not an "upgrade" button: no self-serve plan change exists
    // anywhere in the product, so one would be a dead end. This asserts the
    // link goes somewhere real instead.
    const cta = page.getByTestId("billing-contact-support");
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/dashboard\/feedback$/);

    await assertNoOverlayError(page);
  });
});
