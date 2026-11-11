import {
  DOMWrapper,
  enableAutoUnmount,
  flushPromises,
  mount,
} from "@vue/test-utils";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import ManualInputModal from "@/components/ManualInputModal.vue";
import { menuApi } from "@/services/menuApi";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/menuApi", () => ({
  menuApi: { searchRestaurants: vi.fn() },
}));

// Headless UI observes dialog visibility; jsdom has no layout observer.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterAll(() => vi.unstubAllGlobals());
enableAutoUnmount(afterEach);

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("ManualInputModal", () => {
  it("names the dialog, focuses search, dismisses with Escape and returns focus", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Manual Input";
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mount(ManualInputModal, {
      props: { show: true },
      attachTo: document.body,
    });
    try {
      await flushPromises();
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(
        document
          .getElementById(dialog!.getAttribute("aria-labelledby")!)
          ?.textContent?.trim(),
      ).toBe("manualInput.title");
      const input = document.querySelector(
        '[data-testid="restaurant-search-input"]',
      );
      await vi.waitFor(() => expect(document.activeElement).toBe(input));
      expect(
        dialog!.querySelector('[aria-label="common.close"]'),
      ).not.toBeNull();
      input!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flushPromises();
      expect(wrapper.emitted("update:show")).toContainEqual([false]);
      await wrapper.setProps({ show: false });
      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      wrapper.unmount();
      trigger.remove();
    }
  });

  it("returns focus to the opener when a mounted closed dialog is opened later", async () => {
    const trigger = document.createElement("button");
    trigger.innerHTML = "<span>Manual Input</span>";
    document.body.append(trigger);
    const wrapper = mount(ManualInputModal, {
      props: { show: false },
      attachTo: document.body,
    });
    try {
      await flushPromises();
      trigger.focus();
      const label = new DOMWrapper(trigger.firstElementChild!);
      await label.trigger("mousedown");
      await label.trigger("click");
      await wrapper.setProps({ show: true });
      await flushPromises();
      await vi.waitFor(() =>
        expect(document.activeElement?.id).toBe("restaurant-name"),
      );
      const dialog = new DOMWrapper(document.querySelector('[role="dialog"]')!);
      await dialog
        .findAll("button")
        .at(-1)!
        .trigger("keydown", { key: "Escape" });
      await flushPromises();
      expect(wrapper.emitted("update:show")).toContainEqual([false]);
      await wrapper.setProps({ show: false });
      await flushPromises();
      expect(document.activeElement).toBe(trigger);
    } finally {
      wrapper.unmount();
      trigger.remove();
    }
  });

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
    const wrapper = mount(ManualInputModal, {
      props: { show: true },
      attachTo: document.body,
    });
    await flushPromises();
    const dialog = new DOMWrapper(document.body);

    await dialog
      .get('[data-testid="restaurant-search-input"]')
      .setValue("Demo");
    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    expect(dialog.text()).toContain("Demo Noodles");
    expect(dialog.text()).not.toContain("onboarding");

    await dialog
      .get('[data-testid="restaurant-search-result"]')
      .trigger("click");

    expect(dialog.text()).toContain("Demo Noodles");
    expect(dialog.text()).not.toContain("onboarding");
    await dialog
      .get('[data-testid="confirm-manual-input-btn"]')
      .trigger("click");
    expect(wrapper.emitted("restaurant-selected")).toEqual([
      [{ restaurantId: "restaurant-1" }],
    ]);
  });
});
