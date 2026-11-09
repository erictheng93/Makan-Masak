import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { useCategoryScrollSpy } from "./useCategoryScrollSpy";

// Production shape for this bug: 招牌主食 / 手工點心 / 飲料, the last one
// a single dish so its header can never reach a third of the viewport.
const tops: Record<number, number> = { 16: -900, 17: 100, 18: 500 };

function mountSpy() {
  let api!: ReturnType<typeof useCategoryScrollSpy>;
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useCategoryScrollSpy(
          () => [16, 17, 18],
          (id) => `category-${id}`,
        );
        return () => h("div");
      },
    }),
  );
  return { wrapper, api };
}

describe("useCategoryScrollSpy", () => {
  let wrapper: VueWrapper | undefined;
  let scrollIntoView: ReturnType<
    typeof vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>
  >;

  beforeEach(() => {
    scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    for (const id of [16, 17, 18]) {
      const el = document.createElement("section");
      el.id = `category-${id}`;
      el.getBoundingClientRect = () => ({ top: tops[id] }) as DOMRect;
      el.scrollIntoView = scrollIntoView;
      document.body.appendChild(el);
    }
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 5000,
      configurable: true,
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  it("keeps a tapped short trailing category active while the smooth scroll runs", () => {
    const mounted = mountSpy();
    wrapper = mounted.wrapper;

    mounted.api.scrollToCategory(18);
    window.dispatchEvent(new Event("scroll"));

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: "start" }),
    );
    expect(mounted.api.activeCategoryId.value).toBe(18);
  });

  it("follows the viewport again once the user scrolls by hand", () => {
    const mounted = mountSpy();
    wrapper = mounted.wrapper;

    mounted.api.scrollToCategory(18);
    window.dispatchEvent(new Event("touchstart"));
    window.dispatchEvent(new Event("scroll"));

    expect(mounted.api.activeCategoryId.value).toBe(17);
  });

  it("selects the last category at the bottom of the page", () => {
    const mounted = mountSpy();
    wrapper = mounted.wrapper;
    Object.defineProperty(window, "scrollY", {
      value: 4200,
      configurable: true,
    });

    window.dispatchEvent(new Event("scroll"));

    expect(mounted.api.activeCategoryId.value).toBe(18);
  });
});
