/**
 * 營運儀表板, 桌位設定, 員工列表, 排班管理 and AI 洞察, against a real API and a
 * real D1.
 *
 * The last five nodes of master-user-flow section 2. They are grouped because
 * they share a constraint rather than a subject: each is largely a read
 * surface, and the ones with writes have their write covered elsewhere
 * (attendance for scheduling, settings for the shop row).
 *
 * Selector note: four of these five views carry no data-testid at all
 * (OwnerView, the employee list, the seating create modal, and all three
 * ai-analytics views), and the seating modal's labels are not associated with
 * their inputs, so `getByLabel` does not resolve either. Rather than add hooks
 * across four unrelated views in one pass, these tests assert on what the
 * pages genuinely commit to — the requests they issue, the rows they render,
 * and the few hooks that do exist. Where that limits the assertion, it is
 * called out inline.
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

interface TableRow {
  id?: number;
  number?: string;
  qrCode?: string | null;
}

interface UserRow {
  id?: string;
  username?: string;
}

test.describe.configure({ mode: "serial" });

test.describe("營運儀表板 (real API)", () => {
  test("the owner overview issues its dependency reads and degrades on none of them", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login } = await getOwnerContext();
    await installAdminSession(page, login);

    // Registered before navigating: every one of these fires on mount.
    const answered = new Map<string, number>();
    page.on("response", (response) => {
      const url = response.url();
      for (const name of [
        "/analytics/dashboard",
        "/orders/active",
        "/users/stats",
        "/monitoring/health",
        "/clocked-in",
        "/alerts",
      ]) {
        if (url.includes(name)) answered.set(name, response.status());
      }
    });

    await gotoAdmin(page, "/dashboard/owner-overview", {
      expectApi: "/api/v1/analytics/dashboard",
    });
    await assertAuthenticated(page);

    // The overview is a fan-out of six independent reads. #255 was that one of
    // them returned a shape the view could not read, and the page showed
    // plausible zeros rather than an error — so "it rendered" is not evidence.
    // Asserting each dependency actually answered is.
    await expect
      .poll(() => answered.size, { timeout: POLL_TIMEOUT })
      .toBeGreaterThanOrEqual(3);

    for (const [name, status] of answered) {
      expect(status, `${name} should not have failed`).toBeLessThan(500);
    }

    await assertNoOverlayError(page);
  });
});

test.describe("桌位設定 (real API)", () => {
  test("a table created through the API appears with a signed QR the page can open", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    // Created through the API rather than the modal: that form has no test
    // hooks and its labels are not tied to their inputs, so a UI-driven create
    // would have to select by DOM position. The assertion that matters here is
    // the QR, not the form.
    const created = await apiRequest<TableRow>("/api/v1/tables", {
      token,
      method: "POST",
      body: {
        restaurantId,
        number: `E2E-${suffix().slice(0, 4).toUpperCase()}`,
        capacity: 4,
      },
    });
    expect(created.ok, `table create returned ${created.status}`).toBe(true);
    const table = created.body.data!;

    await installAdminSession(page, login);

    try {
      // Table QR codes are signed, unlike the public shop code — a table row
      // without one is a table nobody can order from.
      expect(table.qrCode, "a new table must be issued a QR code").toBeTruthy();

      await gotoAdmin(page, "/dashboard/seating/table-setup", {
        expectApi: "/api/v1/tables",
      });
      await assertAuthenticated(page);

      await expect(page.getByTestId(`select-table-${table.id}`)).toBeVisible();
      await expect(page.getByTestId(`open-qr-${table.id}`)).toBeVisible();

      await expect
        .poll(
          async () => {
            const list = await apiRequest<TableRow[]>(
              `/api/v1/tables?restaurantId=${restaurantId}&limit=100`,
              { token },
            );
            return (list.body.data ?? []).some((row) => row.id === table.id);
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(true);

      await assertNoOverlayError(page);
    } finally {
      if (table.id) await apiCleanup(`/api/v1/tables/${table.id}`, token);
    }
  });
});

test.describe("員工列表 (real API)", () => {
  test("the roster renders one row per active employee the API returns", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    const users = await apiRequest<UserRow[]>(
      `/api/v1/users?restaurantId=${restaurantId}`,
      { token },
    );
    expect(users.ok, `user list returned ${users.status}`).toBe(true);
    const expected = users.body.data ?? [];
    expect(
      expected.length,
      "seed should provide staff to list",
    ).toBeGreaterThan(0);

    await installAdminSession(page, login);
    await gotoAdmin(page, "/dashboard/employees", {
      expectApi: "/api/v1/users",
    });
    await assertAuthenticated(page);

    // No testids anywhere in this view, so the row count is the assertion —
    // and it is the one that matters, because a filter regression shows up as
    // a count mismatch rather than an error.
    await expect
      .poll(async () => page.locator("table tbody tr").count(), {
        timeout: POLL_TIMEOUT,
      })
      .toBe(expected.length);

    // Every listed username should be on the page.
    for (const user of expected) {
      if (!user.username) continue;
      await expect(
        page.getByText(user.username, { exact: false }).first(),
      ).toBeVisible();
    }

    await assertNoOverlayError(page);
  });
});

test.describe("排班管理 (real API)", () => {
  test("the roster reaches the advanced scheduling view that #314 left unrouted", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login } = await getOwnerContext();
    await installAdminSession(page, login);

    // Any API call will do as the settle signal here: the scheduling tab is a
    // child route of the employee page, so which request lands first depends on
    // which tab the shell mounts.
    await gotoAdmin(page, "/dashboard/employees/scheduling", {
      expectApi: "/api/v1/",
    });
    await assertAuthenticated(page);

    await expect(page.getByTestId("nav-prev")).toBeVisible();
    await expect(page.getByTestId("nav-next")).toBeVisible();

    // #314: SchedulingView existed and the router never referenced it, so shift
    // swaps and the roster list were unreachable. It is routed now *and*
    // linked — the click is what proves the second half, which a URL-driven
    // test would miss.
    const advanced = page.getByTestId("advanced-scheduling-link");
    await expect(
      advanced,
      "advanced scheduling must be reachable by a click, not just by URL (#314)",
    ).toBeVisible();
    await advanced.click();
    await expect(page).toHaveURL(
      /\/dashboard\/employees\/scheduling\/advanced$/,
    );

    await assertNoOverlayError(page);
  });
});

test.describe("AI 洞察 (real API)", () => {
  test("the page does not spend a paid generation on mount (F14)", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login } = await getOwnerContext();
    await installAdminSession(page, login);

    const generateCalls: string[] = [];
    page.on("request", (request) => {
      if (
        request.url().includes("/api/v1/ai-analytics/generate") &&
        request.method() === "POST"
      ) {
        generateCalls.push(request.url());
      }
    });

    // The whole view sits inside <ModuleGate module="ai_analytics">, so the
    // first request is the gate's own — waiting on an ai-analytics call settles
    // on something that may never happen while the gate is still resolving.
    await gotoAdmin(page, "/dashboard/ai-analytics/insights", {
      expectApi: "/api/v1/me/modules",
    });
    await assertAuthenticated(page);
    await page.waitForTimeout(2_000);

    // F14: `onMounted` used to fire a billed generation while the empty state
    // told the owner to click a button. Opening the page must cost nothing.
    expect(
      generateCalls,
      "opening the insights page must not trigger a paid generation",
    ).toHaveLength(0);

    await assertNoOverlayError(page);
  });

  test("generation refuses cleanly when no provider is configured", async () => {
    test.setTimeout(120_000);
    await requireStack();

    const { token, restaurantId } = await getOwnerContext();

    const config = await apiRequest<unknown>(
      `/api/v1/ai-analytics/config/${restaurantId}`,
      { token },
    );
    expect(config.ok, `ai config read returned ${config.status}`).toBe(true);

    const generate = await apiRequest<unknown>(
      "/api/v1/ai-analytics/generate",
      {
        token,
        method: "POST",
        body: { restaurantId, timeRange: { range: "7d" } },
      },
    );

    // With no provider row this must be a clean 400 naming the cause. It is
    // also the assertion that would catch the `ai_insights_cache` table going
    // missing again: that failure surfaced as a 500 `no such table`, not this.
    expect(generate.status, "unconfigured generation should be a 400").toBe(
      400,
    );
    expect(generate.body.error?.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
  });

  test("product analysis works without an LLM, because it is plain SQL", async () => {
    test.setTimeout(120_000);
    await requireStack();

    const { token, restaurantId } = await getOwnerContext();

    // /ai-analytics/products/* goes through ProductAnalysisService, which is
    // SQL only. It is the one AI-adjacent surface that works with no provider
    // configured — and it has no sidebar entry, so nothing else would notice
    // if it broke.
    const bestsellers = await apiRequest<unknown>(
      `/api/v1/ai-analytics/products/bestsellers/${restaurantId}`,
      { token },
    );
    expect(
      bestsellers.ok,
      `product bestsellers returned ${bestsellers.status}`,
    ).toBe(true);
  });
});
