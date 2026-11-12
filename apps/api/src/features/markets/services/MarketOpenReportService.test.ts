import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm/d1", () => ({ drizzle: vi.fn(() => ({})) }));

import {
  marketCheckoutChildOrders,
  marketVendorOpenEvents,
  markets,
  restaurantMarketMemberships,
  users,
} from "@makanmasak/database";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";
import { MarketOpenReportService } from "./MarketOpenReportService";

const fixtureTables = {
  markets,
  restaurantMarketMemberships,
  marketVendorOpenEvents,
  marketCheckoutChildOrders,
  users,
};

function createService(fixtures: SelectFixtures<keyof typeof fixtureTables>) {
  const db = createSelectFixtureDb(fixtureTables, fixtures);
  const service = new MarketOpenReportService({} as never);
  (service as unknown as { db: unknown }).db = db;
  return { service, db };
}

function buildMembership(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: "rest-1",
    name: "Noodle Stall",
    stallNumber: "A1",
    membershipId: 1,
    joinedAt: new Date("2026-01-01T00:00:00Z"),
    leftAt: null,
    timezone: "Asia/Taipei",
    settings: null,
    ...overrides,
  };
}

const market = {
  id: "market-1",
  name: "Night Market",
  cutoffMinutes: null,
  openingHours: null,
};

describe("MarketOpenReportService.getReport", () => {
  it("returns null for a missing or deleted market without further reads", async () => {
    const { service, db } = createService({ markets: [[]] });

    await expect(
      service.getReport({
        marketId: "nope",
        from: "2026-03-01",
        to: "2026-03-02",
      }),
    ).resolves.toBeNull();
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default cutoff and builds rows per vendor and day", async () => {
    const { service } = createService({
      markets: [[market]],
      restaurantMarketMemberships: [[buildMembership()]],
      marketVendorOpenEvents: [
        [
          {
            restaurantId: "rest-1",
            action: "open",
            businessDate: "2026-03-01",
            occurredAt: new Date("2026-03-01T10:00:00Z"),
            actorUserId: "user-1",
          },
          {
            restaurantId: "rest-1",
            action: "close",
            businessDate: "2026-03-01",
            occurredAt: new Date("2026-03-01T12:00:00Z"),
            actorUserId: null,
          },
        ],
      ],
      marketCheckoutChildOrders: [
        [
          {
            restaurantId: "rest-1",
            createdAt: new Date("2026-03-01T11:00:00Z"),
            amountCents: 15000,
          },
        ],
      ],
      users: [[{ id: "user-1", fullName: "", username: "alice" }]],
    });

    const report = await service.getReport({
      marketId: "market-1",
      from: "2026-03-01",
      to: "2026-03-01",
      now: new Date("2026-03-05T00:00:00Z"),
    });

    expect(report).toMatchObject({
      market: { id: "market-1", name: "Night Market" },
      from: "2026-03-01",
      to: "2026-03-01",
    });
    expect(report?.market.businessDayCutoffMinutes).toEqual(expect.any(Number));
    expect(report?.daily).toEqual([
      expect.objectContaining({
        restaurantId: "rest-1",
        vendorName: "Noodle Stall",
        openedBy: "alice", // falls back to username when fullName is empty
        openMinutes: 120,
        currency: "TWD",
      }),
    ]);
    expect(report?.summary[0]).toEqual(
      expect.objectContaining({
        restaurantId: "rest-1",
        orderCount: 1,
        revenueCents: 15000,
      }),
    );
  });

  it("keeps the active membership when a vendor also has a former one", async () => {
    const { service } = createService({
      markets: [[{ ...market, cutoffMinutes: 240 }]],
      restaurantMarketMemberships: [
        [
          buildMembership({
            membershipId: 9,
            name: "Old Name",
            joinedAt: new Date("2026-02-01T00:00:00Z"),
            leftAt: new Date("2026-02-10T00:00:00Z"),
          }),
          buildMembership({ membershipId: 3, name: "Current Name" }),
        ],
      ],
      marketVendorOpenEvents: [[]],
      marketCheckoutChildOrders: [[]],
    });

    const report = await service.getReport({
      marketId: "market-1",
      restaurantId: "rest-1",
      from: "2026-03-01",
      to: "2026-03-01",
      now: new Date("2026-03-05T00:00:00Z"),
    });

    expect(report?.market.businessDayCutoffMinutes).toBe(240);
    expect(report?.summary).toHaveLength(1);
    expect(report?.summary[0].vendorName).toBe("Current Name");
  });

  it("skips the actor lookup when no event carries an actor", async () => {
    const { service, db } = createService({
      markets: [[market]],
      restaurantMarketMemberships: [[buildMembership()]],
      marketVendorOpenEvents: [[]],
      marketCheckoutChildOrders: [[]],
    });

    await service.getReport({
      marketId: "market-1",
      from: "2026-03-01",
      to: "2026-03-01",
    });

    // markets, memberships, events, orders -- and no users read
    expect(db.select).toHaveBeenCalledTimes(4);
  });
});
