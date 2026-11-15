import { describe, expect, it } from "vitest";
import { PLAN_QUOTAS } from "./plan-quotas";

describe("PLAN_QUOTAS", () => {
  it("gives trial shops 3000 orders and 3000 print jobs", () => {
    expect(PLAN_QUOTAS.trial["orders.created"]).toEqual({
      soft: 2_400,
      hard: 3_000,
    });
    expect(PLAN_QUOTAS.trial["print.jobs"]).toEqual({
      soft: 2_400,
      hard: 3_000,
    });
  });

  it("gives basic shops 5000 orders, more than the 3000 trial", () => {
    expect(PLAN_QUOTAS.basic["orders.created"]).toEqual({
      soft: 4_000,
      hard: 5_000,
    });
  });

  it("keeps the soft limit at 80% of the hard limit for every quota", () => {
    for (const quotas of Object.values(PLAN_QUOTAS)) {
      for (const quota of Object.values(quotas)) {
        expect(quota.soft).toBe(quota.hard * 0.8);
      }
    }
  });
});
