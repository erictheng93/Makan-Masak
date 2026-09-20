import { describe, expect, it } from "vitest";
import { buildMarketJoinRequestWrites } from "../services/OnboardingService";

describe("buildMarketJoinRequestWrites", () => {
  it("creates a pending request with the stall number, never a membership", () => {
    const requestedAt = new Date(1_780_000_000_000);

    const writes = buildMarketJoinRequestWrites({
      restaurantId: "rest-1",
      marketId: "market-1",
      stallNumber: "A12",
      requestedAt,
    });

    expect(writes).toEqual([
      {
        table: "market_join_requests",
        values: {
          restaurantId: "rest-1",
          marketId: "market-1",
          status: "pending",
          message: "攤位 A12",
          requestedAt,
        },
      },
    ]);
    expect(JSON.stringify(writes)).not.toContain(
      "restaurant_market_memberships",
    );
  });

  it("writes nothing when the shop said it is independent", () => {
    expect(
      buildMarketJoinRequestWrites({
        restaurantId: "rest-1",
        marketId: null,
        stallNumber: null,
        requestedAt: new Date(1_780_000_000_000),
      }),
    ).toEqual([]);
  });
});
