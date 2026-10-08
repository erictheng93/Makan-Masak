import { beforeAll, describe, expect, it, vi } from "vitest";
import type routesType from "./index";
import { resolve } from "node:path";
// Runtime import keeps the browser-only client's DOM/Vite types out of the
// Workers typecheck while testing its actual emitted URLs, not a copied list.
let posService: Record<string, (...args: unknown[]) => Promise<unknown>>;

const requests = vi.hoisted(
  () => [] as Array<{ method: string; path: string }>,
);
vi.mock("../../../../../admin-dashboard/src/services/api", () => {
  const capture = (method: string) => async (path: string) => {
    requests.push({ method, path });
    return { data: { shifts: [], movements: [], summary: {} } };
  };
  return {
    apiClient: {
      get: capture("GET"),
      post: capture("POST"),
      put: capture("PUT"),
      delete: capture("DELETE"),
    },
    unwrapApiData: (response: { data: unknown }) => response.data,
  };
});

let routes: typeof routesType;
beforeAll(async () => {
  routes = (await import("./index")).default;
  const clientPath = resolve(
    import.meta.dirname,
    "../../../../../admin-dashboard/src/services/posService.ts",
  );
  posService = (await import(clientPath)).posService;
}, 30_000);

describe("POS frontend/backend route contract (#431)", () => {
  it("registers the paths actually emitted by the dashboard service", async () => {
    await posService.getRegisters();
    await posService.getCurrentShift("register-1");
    await posService.getDailyStats("register-1");
    await posService.getCashMovements("shift-1");
    await posService.getPromotions();
    await posService.createPromotion({
      code: "LUNCH10",
      name: "Lunch",
      description: "Lunch discount",
      discountType: "percentage",
      discountValue: 10,
      minOrderAmount: 0,
      isActive: true,
      isVisible: true,
      validFrom: "2026-09-30T00:00:00Z",
      validTo: "2026-10-30T00:00:00Z",
    });
    await posService.updatePromotion("1", { isActive: false });
    await posService.deletePromotion("1");
    for (const request of requests) {
      const path = request.path.replace(/^\/pos/, "");
      expect(
        routes.routes.some(
          (route) =>
            route.method === request.method &&
            new RegExp(`^${route.path.replace(/:[^/]+/g, "[^/]+")}$`).test(
              path,
            ),
        ),
        `${request.method} ${request.path}`,
      ).toBe(true);
    }
  });
});
