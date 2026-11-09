import { describe, expect, it, vi } from "vitest";
import { api } from "@/services/api";
import { restaurantServiceItemsService } from "./restaurantServiceItemsService";

vi.mock("@/services/api", () => ({
  api: { get: vi.fn() },
  unwrapApiPayload: (payload: { data?: unknown }) => payload.data ?? payload,
}));

describe("restaurantServiceItemsService.list coalescing", () => {
  it("shares one request between concurrent callers, then refetches", async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { data: [] } } as never);

    await Promise.all([
      restaurantServiceItemsService.list("r-1"),
      restaurantServiceItemsService.list("r-1"),
    ]);
    expect(api.get).toHaveBeenCalledTimes(1);

    await restaurantServiceItemsService.list("r-1");
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
