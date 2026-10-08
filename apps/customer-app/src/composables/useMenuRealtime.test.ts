import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { useMenuRealtime } from "./useMenuRealtime";
import { apiClient } from "../services/api";
const ws = vi.hoisted(() => ({
  options: null as null | {
    getUrl: () => Promise<string>;
    onMessage: (event: unknown) => void;
    onOpen: () => void;
    onAuthFailure: () => void;
  },
  connect: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("./useWebSocket", () => ({
  useWebSocket: (options: typeof ws.options) => {
    ws.options = options;
    return ws;
  },
}));
vi.mock("../services/api", () => ({ apiClient: { post: vi.fn() } }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_REALTIME_URL", "ws://realtime.test");
  vi.mocked(apiClient.post).mockResolvedValue({
    wsUrl: "ws://realtime.test/menu/rest-1?token=test",
    expiresIn: 300,
  });
});
function setup(refresh = vi.fn(async () => {})) {
  const restaurant = ref("rest-1");
  const wrapper = mount(
    defineComponent({
      setup() {
        useMenuRealtime(() => restaurant.value, refresh);
        return () => null;
      },
    }),
  );
  return { wrapper, restaurant, refresh };
}
describe("menu refresh subscription", () => {
  it("refreshes on open and same-restaurant menu events only", async () => {
    const { wrapper, refresh } = setup();
    ws.options!.onOpen();
    await flushPromises();
    ws.options!.onMessage({ type: "menu_item_update", restaurantId: "other" });
    ws.options!.onMessage({ type: "new_order", restaurantId: "rest-1" });
    ws.options!.onMessage({ type: "menu_item_update", restaurantId: "rest-1" });
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect(ws.disconnect).toHaveBeenCalled();
  });
  it("coalesces events during refresh and reads once more after it finishes", async () => {
    let finish!: () => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { wrapper } = setup(refresh);
    ws.options!.onOpen();
    ws.options!.onOpen();
    ws.options!.onOpen();
    expect(refresh).toHaveBeenCalledOnce();
    finish();
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it("reuses a token until auth rejection and discards it on restaurant change", async () => {
    const { wrapper, restaurant } = setup();
    await ws.options!.getUrl();
    await ws.options!.getUrl();
    expect(apiClient.post).toHaveBeenCalledOnce();
    expect(apiClient.post).toHaveBeenCalledWith("/realtime/auth/menu-token", {
      restaurantId: "rest-1",
    });
    ws.options!.onAuthFailure();
    await ws.options!.getUrl();
    expect(apiClient.post).toHaveBeenCalledTimes(2);
    restaurant.value = "rest-2";
    await flushPromises();
    await ws.options!.getUrl();
    expect(apiClient.post).toHaveBeenLastCalledWith(
      "/realtime/auth/menu-token",
      { restaurantId: "rest-2" },
    );
    wrapper.unmount();
  });
});
