import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManualInputModal from "@/components/ManualInputModal.vue";
import { menuApi } from "@/services/menuApi";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: { searchRestaurants: vi.fn() },
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("ManualInputModal", () => {
  it("does not expose onboarding placeholders in restaurant search results", async () => {
    vi.useFakeTimers();
    vi.mocked(menuApi.searchRestaurants).mockResolvedValue([
      {
        restaurantId: "restaurant-1",
        name: "Demo Noodles",
        type: "onboarding",
        district: "onboarding-demo-noodles",
        imageUrl: null,
      },
    ]);
    const wrapper = mount(ManualInputModal, { props: { show: true } });

    await wrapper
      .get('[data-testid="restaurant-search-input"]')
      .setValue("Demo");
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(wrapper.text()).toContain("Demo Noodles");
    expect(wrapper.text()).not.toContain("onboarding");

    await wrapper
      .get('[data-testid="restaurant-search-result"]')
      .trigger("click");

    expect(wrapper.text()).toContain("Demo Noodles");
    expect(wrapper.text()).not.toContain("onboarding");
  });
});
