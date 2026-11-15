// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";

const apiGet = vi.hoisted(() => vi.fn());
const apiDelete = vi.hoisted(() => vi.fn());
const access = vi.hoisted(() => ({
  isLoaded: true,
  effectiveModules: {} as Record<string, boolean>,
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "shop-1" }),
}));
vi.mock("@makanmasak/shared/stores/moduleAccess", () => ({
  useModuleAccessStore: () => access,
}));
vi.mock("@/services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/api")>()),
  apiClient: { get: apiGet, delete: apiDelete, post: vi.fn(), put: vi.fn() },
}));

let IntegrationsSettings: Component;

const connected = (enabled: boolean) => ({
  data: {
    data: {
      enabled,
      config: enabled ? { autoAcceptOrders: true } : null,
      lastMenuSyncAt: null,
      menuSyncStatus: null,
    },
  },
});

async function mountIt() {
  const wrapper = mount(IntegrationsSettings);
  await flushPromises();
  return wrapper;
}

describe("IntegrationsSettings without the platform_integration module", () => {
  beforeAll(async () => {
    apiGet.mockResolvedValue(connected(false));
    IntegrationsSettings = (await import("./IntegrationsSettings.vue")).default;
    (await mountIt()).unmount();
  }, 30_000);

  beforeEach(() => {
    vi.clearAllMocks();
    access.isLoaded = true;
    access.effectiveModules = {};
    apiDelete.mockResolvedValue({});
  });

  it("shows a connected platform with a note and disconnect, and nothing to configure", async () => {
    apiGet.mockResolvedValue(connected(true));
    const wrapper = await mountIt();

    // Probes the supported platform with the ungated GET, not the list.
    expect(apiGet).toHaveBeenCalledWith("/integrations/shop-1/uber_eats");
    expect(
      wrapper.get('[data-testid="integrations-limited-title"]').text(),
    ).toBe("已連線的外送平台");
    expect(
      wrapper.get('[data-testid="integration-orders-continue"]').text(),
    ).toContain("訂單仍會持續送進來");
    expect(wrapper.text()).toContain("斷開連接");
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("立即同步");
    expect(wrapper.text()).not.toContain("Foodpanda");
    expect(wrapper.text()).not.toContain("Webhook");

    const button = wrapper
      .findAll("button")
      .find((b) => b.text() === "斷開連接")!;
    await button.trigger("click");
    await flushPromises();
    const confirm = wrapper
      .findAll("button")
      .find((b) => b.text() === "確認斷開")!;
    await confirm.trigger("click");
    await flushPromises();

    expect(apiDelete).toHaveBeenCalledOnce();
    expect(apiDelete).toHaveBeenCalledWith("/integrations/shop-1/uber_eats");
  });

  it("shows nothing when nothing is connected", async () => {
    apiGet.mockResolvedValue(connected(false));
    const wrapper = await mountIt();

    expect(wrapper.find('[data-testid="integration-uber-eats"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-testid="integrations-limited-title"]').exists(),
    ).toBe(false);
    expect(wrapper.text()).not.toContain("連接 Uber Eats");
  });

  it("is unchanged when the module is on", async () => {
    access.effectiveModules = { platform_integration: true };
    apiGet.mockResolvedValue(connected(false));
    const wrapper = await mountIt();

    expect(wrapper.find('[data-testid="integration-uber-eats"]').exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain("連接 Uber Eats");
    expect(wrapper.text()).toContain("Foodpanda");
    expect(
      wrapper.find('[data-testid="integration-orders-continue"]').exists(),
    ).toBe(false);
  });
});
