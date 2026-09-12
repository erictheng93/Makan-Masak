/**
 * `useFollowing` exists for one reason: a discovery page renders twenty
 * restaurant cards, and twenty follow buttons must not mean twenty GETs. The
 * first case is therefore the load-once contract, not an implementation detail.
 *
 * The revert cases matter just as much. An optimistic toggle that fails without
 * reverting leaves the button claiming a follow the server never recorded, and
 * the next tap would try to DELETE a row id that does not exist.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/customerIdentityApi", () => ({
  customerIdentityApi: {
    listFavorites: vi.fn(),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
  },
}));

import { customerIdentityApi } from "@/services/customerIdentityApi";
import type { CustomerFavorite } from "@/services/customerIdentityApi";
import { resetFollowing, useFollowing } from "@/composables/useFollowing";

function buildFavorite(
  overrides: Partial<CustomerFavorite> = {},
): CustomerFavorite {
  return {
    id: 41,
    targetType: "market",
    targetId: "market-1",
    createdAtMs: 1_764_000_000_000,
    ...overrides,
  };
}

function mockFavorites(rows: CustomerFavorite[]) {
  vi.mocked(customerIdentityApi.listFavorites).mockResolvedValue(rows);
}

describe("useFollowing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFollowing();
    mockFavorites([]);
    vi.mocked(customerIdentityApi.removeFavorite).mockResolvedValue(
      undefined as never,
    );
  });

  it("loads the favorites list once however many callers ask", async () => {
    mockFavorites([buildFavorite()]);

    const first = useFollowing();
    const second = useFollowing();
    const third = useFollowing();

    await Promise.all([
      first.ensureLoaded(),
      second.ensureLoaded(),
      third.ensureLoaded(),
    ]);
    // A caller mounting after the load has settled must not refetch either.
    await third.ensureLoaded();

    expect(customerIdentityApi.listFavorites).toHaveBeenCalledOnce();
    // No targetType argument: one unfiltered request covers markets and
    // restaurants, which is what makes a mixed page cost one round trip.
    expect(customerIdentityApi.listFavorites).toHaveBeenCalledWith();
  });

  it("reports whether a target is followed, keyed by type and id together", async () => {
    mockFavorites([
      buildFavorite({ id: 41, targetType: "market", targetId: "shared-id" }),
      buildFavorite({ id: 42, targetType: "restaurant", targetId: "rest-9" }),
    ]);

    const following = useFollowing();
    await following.ensureLoaded();

    expect(following.isFollowing("market", "shared-id")).toBe(true);
    expect(following.isFollowing("restaurant", "rest-9")).toBe(true);
    expect(following.isFollowing("restaurant", "shared-id")).toBe(false);
    expect(following.isFollowing("market", "rest-404")).toBe(false);
  });

  it("adds a follow through POST and reuses the returned row id to remove it", async () => {
    const following = useFollowing();
    await following.ensureLoaded();
    vi.mocked(customerIdentityApi.addFavorite).mockResolvedValue(
      buildFavorite({ id: 77, targetType: "restaurant", targetId: "rest-9" }),
    );

    await following.toggle("restaurant", "rest-9");

    expect(customerIdentityApi.addFavorite).toHaveBeenCalledOnce();
    expect(customerIdentityApi.addFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ targetType: "restaurant", targetId: "rest-9" }),
    );
    expect(following.isFollowing("restaurant", "rest-9")).toBe(true);

    await following.toggle("restaurant", "rest-9");

    expect(customerIdentityApi.removeFavorite).toHaveBeenCalledOnce();
    expect(customerIdentityApi.removeFavorite).toHaveBeenCalledWith(77);
    expect(following.isFollowing("restaurant", "rest-9")).toBe(false);
  });

  it("shows the follow immediately and reverts it when the POST fails", async () => {
    const following = useFollowing();
    await following.ensureLoaded();

    let fail: () => void = () => {};
    vi.mocked(customerIdentityApi.addFavorite).mockReturnValue(
      new Promise<CustomerFavorite>((_resolve, reject) => {
        fail = () => reject(new Error("offline"));
      }),
    );

    const pending = following.toggle("market", "market-1");
    expect(following.isFollowing("market", "market-1")).toBe(true);

    fail();
    await expect(pending).rejects.toThrow();

    expect(following.isFollowing("market", "market-1")).toBe(false);
  });

  it("restores the row when the unfollow DELETE fails", async () => {
    mockFavorites([buildFavorite({ id: 41, targetId: "market-1" })]);
    vi.mocked(customerIdentityApi.removeFavorite).mockRejectedValue(
      new Error("offline"),
    );

    const following = useFollowing();
    await following.ensureLoaded();

    await expect(following.toggle("market", "market-1")).rejects.toThrow();

    expect(customerIdentityApi.removeFavorite).toHaveBeenCalledWith(41);
    expect(following.isFollowing("market", "market-1")).toBe(true);
  });

  it("separates followed markets from followed restaurants, newest first", async () => {
    mockFavorites([
      buildFavorite({
        id: 1,
        targetType: "market",
        targetId: "m-old",
        createdAtMs: 1_000,
      }),
      buildFavorite({
        id: 2,
        targetType: "restaurant",
        targetId: "r-1",
        createdAtMs: 3_000,
      }),
      buildFavorite({
        id: 3,
        targetType: "market",
        targetId: "m-new",
        createdAtMs: 2_000,
      }),
      // Dish favorites are a different feature and must not leak into the
      // follow lists the broadcast audience is built from.
      buildFavorite({
        id: 4,
        targetType: "dish",
        targetId: "12",
        createdAtMs: 4_000,
      }),
    ]);

    const following = useFollowing();
    await following.ensureLoaded();

    expect(following.followedMarkets.value.map((row) => row.targetId)).toEqual([
      "m-new",
      "m-old",
    ]);
    expect(
      following.followedRestaurants.value.map((row) => row.targetId),
    ).toEqual(["r-1"]);
  });
});
