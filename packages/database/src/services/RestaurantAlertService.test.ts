import { describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { RestaurantAlertService } from "./RestaurantAlertService";

const EXISTING = {
  id: "0198c3a4-5b6c-7d8e-9f01-234567890abc",
  restaurantId: "restaurant-1",
  alertType: "inventory_depleted",
  status: "open",
};

/**
 * Minimal stand-in for the drizzle query builder: every chain step returns
 * itself, and the terminal `get`/`all`/`returning` resolve to what the test
 * queued. Enough to exercise raise()'s conflict branch without a live D1.
 */
function fakeDb({
  get,
  insert,
}: {
  get: () => Promise<unknown>;
  insert: () => Promise<unknown[]>;
}) {
  const chain: Record<string, unknown> = {};
  for (const step of ["from", "where", "orderBy", "values", "set"]) {
    chain[step] = () => chain;
  }
  chain.get = get;
  chain.all = async () => [];
  chain.returning = insert;
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
  };
}

function serviceWith(db: unknown): RestaurantAlertService {
  const service = new RestaurantAlertService({} as D1Database, {
    JWT_SECRET: "test",
  });
  // `db` is protected; the test replaces it rather than standing up real D1.
  (service as unknown as { db: unknown }).db = db;
  return service;
}

describe("RestaurantAlertService.raise", () => {
  it("returns the open alert instead of inserting a duplicate", async () => {
    const insert = vi.fn();
    const service = serviceWith(fakeDb({ get: async () => EXISTING, insert }));

    const alert = await service.raise({
      restaurantId: "restaurant-1",
      alertType: "inventory_depleted",
      title: "Stock out",
      description: "Nasi lemak is out of stock.",
      dedupeKey: "inventory:nasi-lemak",
    });

    expect(alert).toEqual(EXISTING);
    expect(insert).not.toHaveBeenCalled();
  });

  it("falls back to the winner's row when a concurrent raise wins the index", async () => {
    // The pre-read misses, so both producers try to insert and one loses to the
    // partial unique index. Losing must not surface as an error to the caller.
    const get = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(EXISTING);
    const insert = vi.fn(async () => {
      throw new Error("D1_ERROR: UNIQUE constraint failed: restaurant_alerts");
    });

    const service = serviceWith(fakeDb({ get, insert }));

    await expect(
      service.raise({
        restaurantId: "restaurant-1",
        alertType: "inventory_depleted",
        title: "Stock out",
        description: "Nasi lemak is out of stock.",
        dedupeKey: "inventory:nasi-lemak",
      }),
    ).resolves.toEqual(EXISTING);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("rethrows an insert failure that is not a duplicate", async () => {
    const service = serviceWith(
      fakeDb({
        get: async () => null,
        insert: async () => {
          throw new Error("D1_ERROR: no such table: restaurant_alerts");
        },
      }),
    );

    await expect(
      service.raise({
        restaurantId: "restaurant-1",
        alertType: "inventory_depleted",
        title: "Stock out",
        description: "Nasi lemak is out of stock.",
        dedupeKey: "inventory:nasi-lemak",
      }),
    ).rejects.toThrow("no such table");
  });

  it("does not pre-read when the producer sets no dedupe key", async () => {
    const get = vi.fn(async () => null);
    const service = serviceWith(
      fakeDb({ get, insert: async () => [EXISTING] }),
    );

    await service.raise({
      restaurantId: "restaurant-1",
      alertType: "payment_failed",
      title: "Payment failed",
      description: "A card payment was declined.",
    });

    expect(get).not.toHaveBeenCalled();
  });
});
