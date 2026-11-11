import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { afterEach, expect, it } from "vitest";
import NotFoundView from "./NotFoundView.vue";

afterEach(() => window.history.replaceState({}, ""));

it("offers back navigation only for a valid local previous route", () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:pathMatch(.*)*", component: NotFoundView }],
  });
  window.history.replaceState({ back: "/tenants" }, "");
  const wrapper = mount(NotFoundView, { global: { plugins: [router] } });
  expect(wrapper.find('[data-testid="portal-back"]').exists()).toBe(true);
  wrapper.unmount();
  window.history.replaceState({ back: "//other.example/" }, "");
  const direct = mount(NotFoundView, { global: { plugins: [router] } });
  expect(direct.find('[data-testid="portal-back"]').exists()).toBe(false);
  direct.unmount();
});
