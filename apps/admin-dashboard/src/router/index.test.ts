// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { adminRestaurantOptionalRoutes, router } from "./index";
import { UserRole } from "@/types";

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
