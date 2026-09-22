import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: { delete: vi.fn() },
  drizzle: vi.fn(),
}));

vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  inArray: vi.fn((column: unknown, values: unknown) => ({
    op: "inArray",
    column,
    values,
  })),
  lt: vi.fn((column: unknown, value: unknown) => ({ op: "lt", column, value })),
}));

vi.mock("@makanmasak/database", () => ({
  VerificationService: vi.fn(),
  idempotencyKeys: { scope: "scope", expiresAt: "expiresAt" },
  IDEMPOTENCY_SCOPES: {
    PAYMENT: "payment",
    WEBHOOK: "webhook",
    PUBLIC_RESERVATION_CREATE: "public-reservation-create",
    PUBLIC_RESERVATION_CANCEL: "public-reservation-cancel",
    STAFF_RESERVATION_CREATE: "staff-reservation-create",
  },
}));

vi.mock("../services/AlertService", () => ({ AlertService: vi.fn() }));

import { cleanupExpiredIdempotencyKeys } from "./cleanup-tokens";
import { inArray, lt } from "drizzle-orm";
import { idempotencyKeys } from "@makanmasak/database";

/** The cron only ever gets the D1 binding; nothing else is read. */
function buildEnv() {
  return { DB: { binding: "d1" } } as never;
}

function mockDelete(result: unknown) {
  const where = vi.fn(() => Promise.resolve(result));
  mocks.db.delete.mockReturnValue({ where });
  return where;
}

describe("cleanupExpiredIdempotencyKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drizzle.mockReturnValue(mocks.db);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cuts off in milliseconds, not seconds", async () => {
    // The column is a bare `integer` named `expires_at` with no `_ms` suffix,
    // and the neighbouring password_change_logs cleanup in the same file works
    // in seconds. Getting this wrong by 1000x either deletes live reservations
    // or never deletes anything, and neither would fail loudly.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00.000Z"));
    const nowMs = Date.now();
    mockDelete({ meta: { changes: 3 } });

    await cleanupExpiredIdempotencyKeys(buildEnv());

    expect(lt).toHaveBeenCalledWith(idempotencyKeys.expiresAt, nowMs);
    // Guard the magnitude explicitly: a seconds cutoff would be ~1.7e9 while a
    // millisecond one is ~1.7e12, so this fails loudly if the unit ever slips.
    expect(vi.mocked(lt).mock.calls[0][1]).toBeGreaterThan(1e12);
  });

  it("narrows by scope so the composite index can serve the delete", async () => {
    // The only index covering expires_at is (scope, expires_at). Dropping the
    // scope predicate still returns the right rows, so no assertion on the
    // result would catch it — but it turns a daily index range scan into a full
    // scan of the table this job exists to keep small.
    mockDelete({ meta: { changes: 0 } });

    await cleanupExpiredIdempotencyKeys(buildEnv());

    expect(inArray).toHaveBeenCalledWith(
      idempotencyKeys.scope,
      expect.arrayContaining([
        "payment",
        "webhook",
        "public-reservation-create",
        "public-reservation-cancel",
        "staff-reservation-create",
      ]),
    );
  });

  it("reports the deleted row count from the driver", async () => {
    mockDelete({ meta: { changes: 42 } });

    await expect(cleanupExpiredIdempotencyKeys(buildEnv())).resolves.toEqual({
      deleted: 42,
    });
  });

  it("reports an unavailable count as null rather than zero", async () => {
    // A driver that stops reporting `meta.changes` must not read as "there was
    // nothing to delete" — that would hide the table growing again.
    mockDelete({});

    await expect(cleanupExpiredIdempotencyKeys(buildEnv())).resolves.toEqual({
      deleted: null,
    });
  });

  it("does not throw when the delete fails", async () => {
    // It shares a cron tick with the token cleanup; throwing here would take
    // that down with it.
    const where = vi.fn(() => Promise.reject(new Error("D1 unavailable")));
    mocks.db.delete.mockReturnValue({ where });

    await expect(cleanupExpiredIdempotencyKeys(buildEnv())).resolves.toEqual({
      deleted: null,
    });
  });
});
