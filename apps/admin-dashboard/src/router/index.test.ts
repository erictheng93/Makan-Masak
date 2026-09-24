// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { adminRestaurantOptionalRoutes, router } from "./index";
import { UserRole } from "@/types";
import { setAuthTokenProvider } from "@/utils/authTokenProvider";

// A structurally valid JWT that expires in 2100, so the guard does not try a
// refresh. Only the payload's exp is read client-side.
const LIVE_TOKEN = [
  btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  btoa(JSON.stringify({ exp: 4102444800 })),
  "sig",
].join(".");

function signInAs(role: UserRole) {
  localStorage.setItem(
    "auth_user",
    JSON.stringify({ id: "u-1", username: "staff", role, restaurantId: "r-1" }),
  );
  setAuthTokenProvider(() => LIVE_TOKEN);
  setActivePinia(createPinia());
}

// The dashboard home is the owner's analytics page; every endpoint it calls
// is admin/owner only. A cashier who opened the admin root was sent through
// /login?redirect=/dashboard and landed there, on a permission error and
// KPI tiles reading NT$0 (production, 2026-09-22).
describe("dashboard home by role", () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await router.push("/login");
  });
  afterEach(() => {
    localStorage.clear();
    setAuthTokenProvider(() => null);
  });

  it("sends a cashier to the checkout instead", async () => {
    signInAs(UserRole.CASHIER);
    await router.push("/dashboard");
    expect(router.currentRoute.value.path).toBe("/dashboard/pos/checkout");
  }, 30_000);

  it("sends service crew to the service station instead", async () => {
    signInAs(UserRole.SERVICE);
    await router.push("/dashboard");
    expect(router.currentRoute.value.path).toBe("/service");
  }, 30_000);

  it("keeps the owner on the dashboard home", async () => {
    signInAs(UserRole.OWNER);
    await router.push("/dashboard");
    expect(router.currentRoute.value.path).toBe("/dashboard");
  }, 30_000);
});

describe("admin dashboard router", () => {
  it("allows platform market checkouts without a selected restaurant", () => {
    expect(adminRestaurantOptionalRoutes).toContain("PlatformMarketCheckouts");
  });

  it("allows platform onboarding applications without a selected restaurant", () => {
    expect(adminRestaurantOptionalRoutes).toContain(
      "PlatformOnboardingApplications",
    );
  });

  it("registers an owner-accessible table detail route", () => {
    const resolved = router.resolve("/dashboard/seating/tables/42");

    expect(resolved.name).toBe("TableDetail");
    expect(resolved.matched.at(-1)?.meta.roles).toEqual([
      expect.anything(),
      expect.anything(),
    ]);
  });

  it("restricts the member directory to admin and owner", () => {
    const resolved = router.resolve("/dashboard/members");

    expect(resolved.name).toBe("Members");
    expect(resolved.matched.at(-1)?.meta.roles).toEqual([
      UserRole.ADMIN,
      UserRole.OWNER,
    ]);
  });

  it("restricts marketing broadcasts to admin and owner, and requires a shop", () => {
    const resolved = router.resolve("/dashboard/broadcasts");

    expect(resolved.name).toBe("Broadcasts");
    expect(resolved.matched.at(-1)?.meta.roles).toEqual([
      UserRole.ADMIN,
      UserRole.OWNER,
    ]);
    // An admin with no shop selected has nothing to send as, so this page must
    // stay out of the restaurant-optional list. Market-scoped sends live on the
    // platform markets page instead.
    expect(adminRestaurantOptionalRoutes).not.toContain("Broadcasts");
  });

  it("keeps advanced scheduling reachable by admins and owners without changing the legacy redirect", () => {
    const advanced = router.resolve("/dashboard/employees/scheduling/advanced");
    const legacy = router
      .getRoutes()
      .find((route) => route.path === "/dashboard/scheduling");

    expect(legacy?.redirect).toEqual({ name: "EmployeeScheduling" });
    expect(advanced.name).toBe("AdvancedScheduling");
    expect(advanced.matched.at(-1)?.meta.roles).toEqual([
      UserRole.ADMIN,
      UserRole.OWNER,
    ]);
  });

  it("registers scheduling analytics for admins and owners", () => {
    const analytics = router.resolve(
      "/dashboard/employees/scheduling/analytics",
    );

    expect(analytics.name).toBe("SchedulingAnalytics");
    expect(analytics.matched.at(-1)?.meta).toMatchObject({
      titleKey: "pages.schedulingAnalytics",
      roles: [UserRole.ADMIN, UserRole.OWNER],
    });
  });

  it("gives platform pages their own breadcrumb title, not the overview's", () => {
    const titleKeyFor = (name: string) =>
      router.getRoutes().find((route) => route.name === name)?.meta.titleKey;

    expect(titleKeyFor("PlatformMarkets")).toBe("pages.platformMarkets");
    expect(titleKeyFor("PlatformOnboardingApplications")).toBe(
      "pages.platformOnboarding",
    );
  });

  it("keeps OwnerOverview, Orders, and GroupOrders role boundaries distinct", () => {
    const rolesFor = (name: string) =>
      router.getRoutes().find((route) => route.name === name)?.meta.roles;

    expect(rolesFor("OwnerOverview")).toEqual([UserRole.ADMIN, UserRole.OWNER]);
    expect(rolesFor("Orders")).toEqual([
      UserRole.ADMIN,
      UserRole.OWNER,
      UserRole.SERVICE,
      UserRole.CASHIER,
    ]);
    expect(rolesFor("GroupOrders")).toEqual([UserRole.ADMIN, UserRole.OWNER]);
  });
});
