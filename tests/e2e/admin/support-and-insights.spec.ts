/**
 * 平台支援工單, 需求預測 and 營運分析, against a real API and a real D1.
 *
 * Three nodes in one file because they share a shape: an owner can read all
 * three, and only one of them has an owner-writable action.
 *
 * 平台支援工單 is the shop raising a ticket with the platform — `shop_feedback`,
 * with category/priority/related_module/resolved_by. It is deliberately not
 * customer reviews; #266 established the product has no reviews table at all.
 * Note the lifecycle needs two roles: creating is `requireRole([1])` and moving
 * status is `requireRole([0])`, so an owner-only spec can cover the opening
 * half and no more. That is stated rather than worked around.
 *
 * 需求預測 and 營運分析 have no owner-writable state to speak of — the analytics
 * export is a client-side Blob, not a request — so those tests assert the reads
 * the pages depend on, plus two specific regressions worth keeping nailed down.
 */
import { expect, test } from "@playwright/test";
import {
  apiRequest,
  getAdminContext,
  requireAdmin,
  assertAuthenticated,
  assertNoOverlayError,
  getOwnerContext,
  gotoAdmin,
  installAdminSession,
  POLL_TIMEOUT,
  requireStack,
  suffix,
} from "./admin-e2e";

interface FeedbackRow {
  id?: number;
  subject?: string;
  status?: string;
  category?: string;
}

interface FeedbackListBody {
  success?: boolean;
  feedback?: FeedbackRow[];
  pagination?: { total?: number };
}

/** Local calendar date, so the window matches the shop's day rather than UTC's. */
function todayLocalIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

test.describe.configure({ mode: "serial" });

test.describe("平台支援工單 (real API)", () => {
  test("owner raises a ticket through the form and it lands in the list", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token } = await getOwnerContext();
    const subject = `E2E Support ${suffix()}`;

    await installAdminSession(page, login);

    await gotoAdmin(page, "/dashboard/feedback", {
      expectApi: "/api/v1/feedback",
    });
    await assertAuthenticated(page);

    await page.getByTestId("open-feedback-form").click();
    await page.getByTestId("feedback-category-bug_report").click();
    await page.getByTestId("feedback-subject").fill(subject);
    await page
      .getByTestId("feedback-description")
      .fill("Raised by the admin E2E suite to prove the ticket path works.");

    const created = page.waitForResponse(
      (response) =>
        response.url().includes("/api/v1/feedback") &&
        response.request().method() === "POST",
    );
    await page.getByTestId("feedback-submit").click();
    const response = await created;
    expect(response.ok(), `feedback create returned ${response.status()}`).toBe(
      true,
    );

    // This endpoint returns the rows under `feedback`, not `data` — an envelope
    // inconsistency worth encoding rather than tripping over twice.
    await expect
      .poll(
        async () => {
          const list = await apiRequest<never>("/api/v1/feedback", { token });
          const body = list.body as unknown as FeedbackListBody;
          return (body.feedback ?? []).some((row) => row.subject === subject);
        },
        { timeout: POLL_TIMEOUT },
      )
      .toBe(true);

    await assertNoOverlayError(page);
  });

  test("a ticket goes 開單 → 回覆 → 結案 across both roles", async () => {
    test.setTimeout(180_000);
    await requireStack();
    await requireAdmin();

    const { token: ownerToken } = await getOwnerContext();
    const { token: adminToken } = await getAdminContext();
    const subject = `E2E Lifecycle ${suffix()}`;

    // Opening is requireRole([1]) — the shop's own action.
    const opened = await apiRequest<FeedbackRow>("/api/v1/feedback", {
      token: ownerToken,
      method: "POST",
      body: {
        subject,
        description:
          "Raised by the admin E2E suite to walk the full ticket lifecycle.",
        category: "other",
        priority: "low",
      },
    });
    expect(opened.ok, `ticket create returned ${opened.status}`).toBe(true);
    const ticketId = opened.body.data?.id;
    expect(ticketId, "created ticket id").toBeTruthy();

    // The owner cannot close their own ticket. Asserting the refusal is what
    // makes the admin half below meaningful rather than incidental.
    const ownerAttempt = await apiRequest(
      `/api/v1/feedback/${ticketId}/status`,
      { token: ownerToken, method: "PUT", body: { status: "resolved" } },
    );
    expect(
      ownerAttempt.status,
      "an owner must not be able to resolve their own ticket",
    ).toBe(403);

    // Platform side: reply, then close.
    const replied = await apiRequest(`/api/v1/feedback/${ticketId}/responses`, {
      token: adminToken,
      method: "POST",
      // The field is `message`, not `content` — the two are easy to confuse
      // because the ticket itself uses `description`.
      body: { message: "Looked at by the platform team." },
    });
    expect(replied.ok, `ticket reply returned ${replied.status}`).toBe(true);

    const resolved = await apiRequest<FeedbackRow>(
      `/api/v1/feedback/${ticketId}/status`,
      { token: adminToken, method: "PUT", body: { status: "resolved" } },
    );
    expect(resolved.ok, `ticket resolve returned ${resolved.status}`).toBe(
      true,
    );

    // Closing has to record who closed it and when — a status flip on its own
    // leaves no audit trail on a customer-facing support record.
    const record = resolved.body.data as unknown as Record<string, unknown>;
    expect(record.resolvedAt, "resolvedAt must be stamped").toBeTruthy();
    expect(record.resolvedBy, "resolvedBy must be recorded").toBeTruthy();

    // And the shop sees the outcome, read back through its own token.
    await expect
      .poll(
        async () => {
          const fresh = await apiRequest<FeedbackRow>(
            `/api/v1/feedback/${ticketId}`,
            { token: ownerToken },
          );
          return fresh.body.data?.status;
        },
        { timeout: POLL_TIMEOUT },
      )
      .toBe("resolved");
  });
});

test.describe("需求預測 (real API)", () => {
  test("the forecast page loads and the ingredient tab reflects the plan's modules", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const today = todayLocalIso();

    // The endpoint requires either `date` or both `startDate` and `endDate`;
    // omitting them is a 400 whose message the page never surfaces.
    const forecast = await apiRequest<unknown>(
      `/api/v1/forecast/${restaurantId}?startDate=${today}&endDate=${today}`,
      { token },
    );
    expect(forecast.ok, `forecast returned ${forecast.status}`).toBe(true);

    await installAdminSession(page, login);
    await gotoAdmin(page, "/dashboard/forecast", {
      expectApi: "/api/v1/me/modules",
    });
    await assertAuthenticated(page);

    // The ingredient tab is gated on the `inventory` module while the page
    // itself is gated on `analytics`; the trial tier grants both, so its
    // presence is the cleanest module-gate assertion in the whole flow.
    await expect(page.getByTestId("forecast-ingredient-tab")).toBeVisible();

    await assertNoOverlayError(page);
  });
});

test.describe("營運分析 (real API)", () => {
  test("the page issues the analytics reads it renders from", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login } = await getOwnerContext();

    await installAdminSession(page, login);

    // Registered before navigating: these all fire during mount.
    const seen = new Set<string>();
    page.on("response", (response) => {
      const url = response.url();
      if (!url.includes("/api/v1/analytics/")) return;
      if (response.status() >= 400) return;
      for (const name of ["dashboard", "performance", "products", "revenue"]) {
        if (url.includes(`/analytics/${name}`)) seen.add(name);
      }
    });

    await gotoAdmin(page, "/dashboard/analytics", {
      expectApi: "/api/v1/analytics/",
    });
    await assertAuthenticated(page);

    await expect
      .poll(() => seen.size, { timeout: POLL_TIMEOUT })
      .toBeGreaterThan(0);

    await assertNoOverlayError(page);
  });

  test("the two revenue endpoints disagree by design, and both answer", async () => {
    test.setTimeout(120_000);
    await requireStack();

    const { token } = await getOwnerContext();
    const today = todayLocalIso();

    // Worth pinning because it looks like a bug and is not. The 總營收 card
    // reads /performance, which counts only paid|delivered|served; the report
    // table reads /revenue, which counts everything except cancelled. A pending
    // order is therefore a row in one and nothing in the other. Anyone
    // "fixing" that disagreement breaks a deliberate distinction.
    const performance = await apiRequest<unknown>(
      `/api/v1/analytics/performance?dateFrom=${today}T00:00:00.000Z&dateTo=${today}T23:59:59.000Z&groupBy=day`,
      { token },
    );
    const revenue = await apiRequest<unknown>(
      `/api/v1/analytics/revenue?dateFrom=${today}T00:00:00.000Z&dateTo=${today}T23:59:59.000Z`,
      { token },
    );

    expect(
      performance.ok,
      `analytics/performance returned ${performance.status}`,
    ).toBe(true);
    expect(revenue.ok, `analytics/revenue returned ${revenue.status}`).toBe(
      true,
    );

    // And the date contract: these take full ISO datetimes. A bare YYYY-MM-DD
    // is a 400, which is easy to write by accident and hard to read once the
    // page swallows it.
    const bareDate = await apiRequest<unknown>(
      `/api/v1/analytics/revenue?dateFrom=${today}&dateTo=${today}`,
      { token },
    );
    expect(
      bareDate.status,
      "analytics date params must be full ISO datetimes",
    ).toBe(400);
  });
});
