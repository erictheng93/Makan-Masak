import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Next } from "hono";
import type { AuthUser } from "../../../middleware/auth";

const currentUser = vi.hoisted(() => ({ value: null as unknown as AuthUser }));
const getDaily = vi.hoisted(() => vi.fn());
const createExpense = vi.hoisted(() => vi.fn());
const deleteExpense = vi.hoisted(() => vi.fn());

vi.mock("../../../middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middleware/auth")>()),
  authMiddleware: vi.fn(async (c: Context, next: Next) => {
    c.set("user", currentUser.value);
    await next();
  }),
}));

// The module gate has its own test; let everything through here.
vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: () => async (_c: Context, next: Next) => next(),
}));

vi.mock("../services/PnlService", () => ({
  PnlService: vi.fn(function PnlService() {
    return { getDaily, createExpense, deleteExpense };
  }),
}));

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) =>
  err instanceof ApiError
    ? c.json(
        { success: false, error: { code: err.code, message: err.message } },
        err.status as 400 | 403 | 404,
      )
    : c.json({ success: false, error: { message: String(err) } }, 500),
);

const SHOP = "rest-1";
const user = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: "u1",
  username: "owner",
  role: 1,
  restaurantId: SHOP,
  ...overrides,
});

const call = (path: string, init?: RequestInit) =>
  routes.fetch(new Request(`https://api.test${path}`, init), {
    DB: {},
  } as never);

const post = (body: unknown, shop = SHOP) =>
  call(`/${shop}/expenses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const valid = { date: "2026-03-10", category: "rent", amountCents: 200000 };

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.value = user();
  getDaily.mockResolvedValue({ date: "2026-03-10" });
  createExpense.mockResolvedValue({ id: "e1" });
  deleteExpense.mockResolvedValue(true);
});

describe("pnl routes access", () => {
  it("rejects a cashier (role 4) on every endpoint", async () => {
    currentUser.value = user({ role: 4 });

    expect((await call(`/${SHOP}/daily`)).status).toBe(403);
    expect((await post(valid)).status).toBe(403);
    expect(
      (await call(`/${SHOP}/expenses/e1`, { method: "DELETE" })).status,
    ).toBe(403);
    expect(getDaily).not.toHaveBeenCalled();
    expect(createExpense).not.toHaveBeenCalled();
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  it("rejects an owner of another restaurant", async () => {
    currentUser.value = user({ restaurantId: "rest-2" });

    expect((await call(`/${SHOP}/daily`)).status).toBe(403);
    expect((await post(valid)).status).toBe(403);
    expect(
      (await call(`/${SHOP}/expenses/e1`, { method: "DELETE" })).status,
    ).toBe(403);
    expect(getDaily).not.toHaveBeenCalled();
    expect(deleteExpense).not.toHaveBeenCalled();
  });
});

describe("pnl routes behaviour", () => {
  it("returns the statement for the requested date", async () => {
    const response = await call(`/${SHOP}/daily?date=2026-03-10`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { date: "2026-03-10" },
    });
    expect(getDaily).toHaveBeenCalledWith(SHOP, "2026-03-10");
  });

  it("rejects an impossible date", async () => {
    expect((await call(`/${SHOP}/daily?date=2026-02-31`)).status).toBe(400);
    expect((await post({ ...valid, date: "2026-02-31" })).status).toBe(400);
    expect(getDaily).not.toHaveBeenCalled();
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("rejects bad category and non-positive or fractional amounts", async () => {
    for (const bad of [
      { category: "gifts" },
      { amountCents: 0 },
      { amountCents: -5 },
      { amountCents: 10.5 },
    ]) {
      expect((await post({ ...valid, ...bad })).status).toBe(400);
    }
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("creates an expense as 201 with the acting user", async () => {
    const response = await post({ ...valid, note: "May rent" });

    expect(response.status).toBe(201);
    expect(createExpense).toHaveBeenCalledOnce();
    expect(createExpense).toHaveBeenCalledWith(
      SHOP,
      "u1",
      expect.objectContaining({ category: "rent", note: "May rent" }),
    );
  });

  it("answers EXPENSE_NOT_FOUND when nothing was deleted", async () => {
    deleteExpense.mockResolvedValue(false);

    const response = await call(`/${SHOP}/expenses/other-shop-expense`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "EXPENSE_NOT_FOUND" },
    });
    expect(deleteExpense).toHaveBeenCalledWith(SHOP, "other-shop-expense");
  });
});
