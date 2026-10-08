import { describe, it, expect, vi } from "vitest";
import { menuApi } from "./menuApi";
import { apiClient } from "./api";
vi.mock("./api", () => ({ apiClient: { request: vi.fn(async () => ({})) } }));
describe("menu read freshness", () => {
  it("carries no-cache only for explicitly fresh reads and preserves table query", async () => {
    await menuApi.getMenu("rest-1", 12, { fresh: true });
    expect(apiClient.request).toHaveBeenLastCalledWith({
      method: "GET",
      url: "/menu/rest-1?tableId=12",
      headers: { "Cache-Control": "no-cache" },
    });
    await menuApi.getMenu("rest-1");
    expect(apiClient.request).toHaveBeenLastCalledWith({
      method: "GET",
      url: "/menu/rest-1",
    });
  });
});
