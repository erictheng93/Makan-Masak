import { describe, expect, it } from "vitest";
import { isLoginSlugConflict } from "./login-slug";

describe("isLoginSlugConflict", () => {
  it.each([
    "D1_ERROR: UNIQUE constraint failed: restaurants.login_slug: SQLITE_CONSTRAINT",
    "unique constraint failed: restaurants.login_slug",
    "index restaurants_login_slug_unique",
  ])("recognises %s", (message) => {
    expect(isLoginSlugConflict(new Error(message))).toBe(true);
  });

  it("looks through the cause chain", () => {
    const cause = new Error("UNIQUE constraint failed: restaurants.login_slug");
    expect(isLoginSlugConflict(new Error("insert failed", { cause }))).toBe(
      true,
    );
  });

  it.each([
    "UNIQUE constraint failed: users.username",
    // login_slug mentioned before the constraint text is some other failure.
    "login_slug lookup timed out; UNIQUE constraint failed: users.email",
    "network error",
  ])("ignores %s", (message) => {
    expect(isLoginSlugConflict(new Error(message))).toBe(false);
  });

  it("stays fast on a message that repeats the constraint prefix", () => {
    // The old regex took quadratic time here (seconds); the bound is loose so
    // a loaded CI machine cannot fail a linear scan.
    const hostile = "unique constraint failed".repeat(50_000);
    const started = performance.now();
    expect(isLoginSlugConflict(new Error(hostile))).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
