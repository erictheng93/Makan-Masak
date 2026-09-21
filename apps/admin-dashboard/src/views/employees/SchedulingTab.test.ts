// @vitest-environment jsdom

import { flushPromises, shallowMount } from "@vue/test-utils";
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import SchedulingTab from "./SchedulingTab.vue";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));

vi.mock("@/composables/useEmployeeList", () => ({
  useEmployeeList: () => ({ users: ref([]), fetchUsers: vi.fn() }),
}));

vi.mock("@/services/schedulingService", () => ({
  schedulingService: {
    getShiftTemplates: vi.fn().mockResolvedValue([]),
    getSchedules: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock("@/services/leavesService", () => ({
  leavesService: { getRequests: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn() }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

describe("SchedulingTab", () => {
  it("offers a visible keyboard-accessible link to advanced scheduling", async () => {
    const wrapper = shallowMount(SchedulingTab, {
      global: {
        stubs: {
          RouterLink: {
            props: ["to"],
            template:
              '<a v-bind="$attrs" :data-route-name="to.name"><slot /></a>',
          },
        },
      },
    });
    await flushPromises();

    const link = wrapper.get('[data-testid="advanced-scheduling-link"]');
    expect(link.text()).toBe("employees.scheduling.advancedScheduling");
    expect(link.attributes("data-route-name")).toBe("AdvancedScheduling");

    const analytics = wrapper.get('[data-testid="scheduling-analytics-link"]');
    expect(analytics.text()).toBe("pages.schedulingAnalytics");
    expect(analytics.attributes("data-route-name")).toBe("SchedulingAnalytics");
  });
});
