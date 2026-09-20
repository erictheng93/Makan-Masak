import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: () => ({ get: mocks.get, post: mocks.post }),
    isAxiosError: () => false,
  },
}));

import { onboardingApi } from "./api";

describe("onboardingApi.getMarkets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads every page so a city does not silently lose market choices", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `market-${index}`,
      name: `Market ${index}`,
    }));
    mocks.get
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: { markets: firstPage, total: 101, page: 1, limit: 100 },
        },
      })
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: {
            markets: [{ id: "market-100", name: "Market 100" }],
            total: 101,
            page: 2,
            limit: 100,
          },
        },
      });

    const result = await onboardingApi.getMarkets({
      country: "MY",
      city: "Kuala Lumpur",
    });

    expect(result).toHaveLength(101);
    expect(result.at(-1)).toEqual({
      id: "market-100",
      name: "Market 100",
    });
    expect(mocks.get).toHaveBeenNthCalledWith(1, "/markets", {
      params: {
        country: "MY",
        city: "Kuala Lumpur",
        limit: 100,
        page: 1,
      },
    });
    expect(mocks.get).toHaveBeenNthCalledWith(2, "/markets", {
      params: {
        country: "MY",
        city: "Kuala Lumpur",
        limit: 100,
        page: 2,
      },
    });
  });
});
