/**
 * Partner organizations and verified members have no restaurant column: they
 * span every restaurant, so only platform admins may read or change them.
 * Uses the real requireRole (index.test.ts mocks it as a pass-through).
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const currentUser = vi.hoisted(() => ({
  value: {
    id: "user-1",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  } as AuthUser,
}));

vi.mock("../../../middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../middleware/auth")>();
  return {
    ...actual,
    authMiddleware: vi.fn(async (c: Context, next: Next) => {
      c.set("user", currentUser.value);
      await next();
    }),
  };
});

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

const listMembers = vi.hoisted(() => vi.fn());

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@makanmasak/database")>();
  return {
    ...actual,
    PartnershipService: class {
      listMembers = listMembers;
    },
  };
});

let routes: typeof import("./index").default;

beforeAll(async () => {
  routes = (await import("./index")).default;
  const { ApiError } = await import("../../../shared/utils/api-error");
  routes.onError((err, c) =>
    err instanceof ApiError
      ? c.json({ error: { code: err.code } }, err.status as 403)
      : c.json({ error: String(err) }, 500),
  );
}, 30_000);

const id = "0192f000-0000-7000-8000-000000000001";
const ownerForbidden: Array<[string, string]> = [
  ["POST", "/"],
  ["GET", "/"],
  ["GET", `/${id}`],
  ["GET", `/${id}/statistics`],
  ["PUT", `/${id}`],
  ["GET", "/members"],
  ["GET", `/members/${id}`],
  ["POST", `/members/${id}/approve`],
  ["POST", `/members/${id}/reject`],
  ["PUT", `/members/${id}`],
];

describe("partnership admin-only routes", () => {
  it.each(ownerForbidden)(
    "%s %s refuses a shop owner",
    async (method, path) => {
      currentUser.value = {
        id: "user-1",
        username: "owner",
        role: 1,
        restaurantId: "rest-1",
      } as AuthUser;

      const response = await routes.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "INSUFFICIENT_ROLE" },
      });
    },
  );

  it("lets a platform admin list members", async () => {
    currentUser.value = {
      id: "user-0",
      username: "admin",
      role: 0,
    } as AuthUser;
    listMembers.mockResolvedValue({ data: [], pagination: {} });

    const response = await routes.request("/members", undefined, {
      DB: {},
    } as never);

    expect(response.status, await response.clone().text()).toBe(200);
    expect(listMembers).toHaveBeenCalledOnce();
  });
});
