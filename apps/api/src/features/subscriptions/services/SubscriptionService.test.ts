import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm/d1", () => ({ drizzle: vi.fn(() => ({})) }));

import { shopSubscriptions, TRIAL_DURATION_DAYS } from "@makanmasak/database";
import {
  createMutationFixtureDb,
  createSelectFixtureDb,
  type MutationFixtures,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { SubscriptionService } from "./SubscriptionService";

const fixtureTables = { shopSubscriptions };
type Row = typeof shopSubscriptions.$inferSelect;

function buildSub(overrides: Partial<Row> = {}): Row {
  return {
    id: "sub-1",
    restaurantId: "rest-1",
    planTier: "basic",
    moduleOverrides: {},
    isActive: true,
    ...overrides,
  } as Row;
}

function createService(input: {
  select?: SelectFixtures<"shopSubscriptions">;
  mutate?: MutationFixtures<"shopSubscriptions">;
}) {
  const selectDb = createSelectFixtureDb(fixtureTables, input.select);
  const mutationDb = createMutationFixtureDb(fixtureTables, input.mutate);
  const service = new SubscriptionService({} as never);
  (service as unknown as { db: unknown }).db = {
    select: selectDb.select,
    insert: mutationDb.insert,
    update: mutationDb.update,
  };
  return { service, selectDb, mutationDb };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SubscriptionService reads", () => {
  it("returns null when the restaurant has no subscription", async () => {
    const { service } = createService({ select: { shopSubscriptions: [[]] } });
    await expect(service.getByRestaurantId("rest-1")).resolves.toBeNull();
  });

  it("returns the subscription row when present", async () => {
    const sub = buildSub();
    const { service } = createService({
      select: { shopSubscriptions: [[sub]] },
    });
    await expect(service.getByRestaurantId("rest-1")).resolves.toBe(sub);
  });

  it("lists every subscription", async () => {
    const rows = [
      buildSub(),
      buildSub({ id: "sub-2", restaurantId: "rest-2" }),
    ];
    const { service } = createService({
      select: { shopSubscriptions: [rows] },
    });
    await expect(service.listAll()).resolves.toEqual(rows);
  });
});

describe("SubscriptionService.create", () => {
  it("refuses a second subscription for the same restaurant", async () => {
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[buildSub()]] },
    });

    await expect(
      service.create({ restaurantId: "rest-1", planTier: "pro" }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_EXISTS", status: 409 });
    expect(mutationDb.insert).not.toHaveBeenCalled();
  });

  it("inserts an active subscription with empty overrides", async () => {
    const created = buildSub({ planTier: "pro" });
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[]] },
      mutate: { shopSubscriptions: { insert: [[created]] } },
    });

    await expect(
      service.create({ restaurantId: "rest-1", planTier: "pro", notes: "n" }),
    ).resolves.toBe(created);
    expect(mutationDb.inserted).toEqual([
      expect.objectContaining({
        restaurantId: "rest-1",
        planTier: "pro",
        moduleOverrides: {},
        isActive: true,
        notes: "n",
      }),
    ]);
  });
});

describe("SubscriptionService.provisionDefaultForRestaurant", () => {
  it("returns the existing subscription without writing", async () => {
    const existing = buildSub();
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[existing]] },
    });

    await expect(
      service.provisionDefaultForRestaurant({ restaurantId: "rest-1" }),
    ).resolves.toBe(existing);
    expect(mutationDb.insert).not.toHaveBeenCalled();
  });

  it("starts a trial of the default length when none exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[], []] },
      mutate: {
        shopSubscriptions: { insert: [[buildSub({ planTier: "trial" })]] },
      },
    });

    await service.provisionDefaultForRestaurant({ restaurantId: "rest-1" });

    const [values] = mutationDb.inserted as {
      trialEndsAt: Date;
      planTier: string;
    }[];
    expect(values.planTier).toBe("trial");
    expect(values.trialEndsAt.getTime()).toBe(
      Date.parse("2026-01-01T00:00:00Z") + TRIAL_DURATION_DAYS * 86_400_000,
    );
  });

  it("honours an explicit trial length", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[], []] },
      mutate: { shopSubscriptions: { insert: [[buildSub()]] } },
    });

    await service.provisionDefaultForRestaurant({
      restaurantId: "rest-1",
      trialDays: 3,
    });

    const [values] = mutationDb.inserted as { trialEndsAt: Date }[];
    expect(values.trialEndsAt.getTime()).toBe(
      Date.parse("2026-01-04T00:00:00Z"),
    );
  });
});

describe("SubscriptionService.updateModules", () => {
  it("404s when the restaurant has no subscription", async () => {
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[]] },
    });
    await expect(
      service.updateModules("rest-1", { overrides: { pos: true } }),
    ).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_FOUND",
      status: 404,
    });
    expect(mutationDb.update).not.toHaveBeenCalled();
  });

  it("grants, revokes and resets keys while keeping untouched ones", async () => {
    const sub = buildSub({
      moduleOverrides: { pos: true, coupons: false, analytics: true },
    });
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[sub]] },
      mutate: { shopSubscriptions: { update: [[sub]] } },
    });

    await service.updateModules("rest-1", {
      overrides: { coupons: true, pos: null, loyalty: false },
    });

    expect(mutationDb.updated).toEqual([
      { moduleOverrides: { coupons: true, analytics: true, loyalty: false } },
    ]);
    // the stored row must not be mutated in place
    expect(sub.moduleOverrides).toEqual({
      pos: true,
      coupons: false,
      analytics: true,
    });
  });

  it("tolerates a null overrides column", async () => {
    const sub = buildSub({ moduleOverrides: null as never });
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[sub]] },
      mutate: { shopSubscriptions: { update: [[sub]] } },
    });
    await service.updateModules("rest-1", { overrides: { pos: true } });
    expect(mutationDb.updated).toEqual([{ moduleOverrides: { pos: true } }]);
  });
});

describe("SubscriptionService.changePlan and setActive", () => {
  it("changePlan resets overrides to the new plan defaults", async () => {
    const sub = buildSub({ moduleOverrides: { pos: true } });
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[sub]] },
      mutate: { shopSubscriptions: { update: [[sub]] } },
    });
    await service.changePlan("rest-1", "enterprise");
    expect(mutationDb.updated).toEqual([
      { planTier: "enterprise", moduleOverrides: {} },
    ]);
  });

  it("changePlan 404s for an unknown restaurant", async () => {
    const { service } = createService({ select: { shopSubscriptions: [[]] } });
    await expect(service.changePlan("x", "pro")).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_FOUND",
    });
  });

  it("setActive flips the kill switch", async () => {
    const sub = buildSub();
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[sub]] },
      mutate: { shopSubscriptions: { update: [[sub]] } },
    });
    await service.setActive("rest-1", false);
    expect(mutationDb.updated).toEqual([{ isActive: false }]);
  });

  it("setActive 404s for an unknown restaurant", async () => {
    const { service, mutationDb } = createService({
      select: { shopSubscriptions: [[]] },
    });
    await expect(service.setActive("x", false)).rejects.toMatchObject({
      code: "SUBSCRIPTION_NOT_FOUND",
    });
    expect(mutationDb.update).not.toHaveBeenCalled();
  });
});

describe("SubscriptionService.getEffectiveModules", () => {
  const { service } = createService({});

  it("uses plan defaults when there are no overrides", () => {
    const modules = service.getEffectiveModules(
      buildSub({ planTier: "basic" }),
    );
    expect(modules).toEqual({
      menu_management: true,
      table_management: true,
      online_ordering: true,
    });
  });

  it("lets overrides both revoke plan modules and grant extra ones", () => {
    const modules = service.getEffectiveModules(
      buildSub({
        planTier: "basic",
        moduleOverrides: { online_ordering: false, pos: true },
      }),
    );
    expect(modules.online_ordering).toBe(false);
    expect(modules.pos).toBe(true);
    expect(modules.menu_management).toBe(true);
  });

  it("falls back to overrides only for an unknown plan tier", () => {
    const modules = service.getEffectiveModules(
      buildSub({ planTier: "legacy" as never, moduleOverrides: { pos: true } }),
    );
    expect(modules).toEqual({ pos: true });
  });
});
