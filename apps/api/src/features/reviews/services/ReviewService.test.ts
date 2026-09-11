import { describe, it, expect } from "vitest";
import { maskDisplayName } from "./ReviewService";

/**
 * The rest of ReviewService is SQL and is covered against real D1 in
 * `src/__tests__/integration/reviews.real.integration.test.ts` — a mocked
 * drizzle cannot tell a correctly scoped aggregate from an unscoped one. This
 * is the one piece that is pure string handling.
 */
describe("maskDisplayName", () => {
  it("keeps the first character and hides the rest at a fixed width", () => {
    expect(maskDisplayName("王小明")).toBe("王**");
    // Fixed width on purpose: a mask whose length tracks the value leaks it.
    expect(maskDisplayName("Alexandra")).toBe("A**");
  });

  it("counts by code point, not UTF-16 unit", () => {
    expect(maskDisplayName("😀顧客")).toBe("😀**");
  });

  it("returns null when there is nothing to attribute", () => {
    expect(maskDisplayName(null)).toBeNull();
    expect(maskDisplayName(undefined)).toBeNull();
    expect(maskDisplayName("")).toBeNull();
    expect(maskDisplayName("   ")).toBeNull();
  });
});
