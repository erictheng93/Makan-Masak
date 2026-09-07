// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";

/**
 * #308 was "ClockInOutPanel has no importer, so nobody can clock in". The panel
 * later reached /dashboard/employees/attendance, which is ADMIN/OWNER-only — so
 * a test that imported this view directly would pass just as happily on a page
 * no chef, service crew or cashier can reach. These pull the view out of the
 * real router by path, which is what a click on the sidebar link does, and pin
 * the role list. Drop the route and this file fails.
 */

vi.mock("@/i18n", async () => {
  const { ref } = await import("vue");
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: ref("zh-TW") }), t };
});

const session = {
  restaurantId: "restaurant-1" as string | null,
  user: { id: "user-chef-2", role: 2 } as { id: string; role: number } | null,
};

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => session,
}));

/**
 * The real panel fetches its own schedule on mount; ClockInOutPanel.test.ts
 * owns that. What matters here is that this page mounts it, and mounts it
 * against the signed-in employee. Mocked by module path rather than stubbed by
 * name so the panel's own graph is never transformed (#211) — and the path is
 * then part of what is asserted: import it from somewhere else and the mock
 * stops applying, so `clock-panel` disappears.
 */
vi.mock("@/components/scheduling/ClockInOutPanel.vue", async () => {
  const { defineComponent } = await import("vue");
  return {
    default: defineComponent({
      name: "ClockInOutPanel",
      props: {
        restaurantId: { type: String, required: true },
        employeeId: { type: String, default: undefined },
      },
      template: '<div data-testid="clock-panel" />',
    }),
  };
});

/** The route's own lazy loader. #211: pay the router graph once, in beforeAll. */
let MyAttendanceView: Component;

beforeAll(async () => {
  const { router } = await import("@/router");
  const resolved = router.resolve("/dashboard/my-attendance");

  expect(resolved.name).toBe("MyAttendance");
  // Every staff role, not just managers: that is the whole point of #308.
  expect(resolved.meta.roles).toEqual([0, 1, 2, 3, 4]);

  const record = resolved.matched[resolved.matched.length - 1];
  const loader = record.components?.default as () => Promise<{
    default: Component;
  }>;
  MyAttendanceView = (await loader()).default;
}, 30_000);

function mountView() {
  return mount(MyAttendanceView);
}

beforeEach(() => {
  session.restaurantId = "restaurant-1";
  session.user = { id: "user-chef-2", role: 2 };
});

describe("MyAttendanceView (admin dashboard)", () => {
  it("is what /dashboard/my-attendance loads, and clocks the signed-in employee", () => {
    const wrapper = mountView();

    expect(wrapper.find('[data-testid="clock-panel"]').exists()).toBe(true);
    expect(wrapper.findComponent({ name: "ClockInOutPanel" }).props()).toEqual(
      expect.objectContaining({
        restaurantId: "restaurant-1",
        // Not the panel's internal fallback: a manager opening this page
        // clocks themselves, never whoever the panel would resolve.
        employeeId: "user-chef-2",
      }),
    );
    expect(wrapper.find('[data-testid="my-attendance-error"]').exists()).toBe(
      false,
    );
  });

  it("says so instead of rendering a panel that cannot load a shift", () => {
    session.restaurantId = null;
    const wrapper = mountView();

    expect(wrapper.find('[data-testid="my-attendance-error"]').exists()).toBe(
      true,
    );
    // An empty panel here would read as "no shift today" rather than "no
    // restaurant on this session".
    expect(wrapper.find('[data-testid="clock-panel"]').exists()).toBe(false);
  });
});
