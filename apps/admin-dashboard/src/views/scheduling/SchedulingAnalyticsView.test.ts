// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingAnalyticsView from "./SchedulingAnalyticsView.vue";

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ info: vi.fn() }),
}));

vi.mock("@/stores/auth", () => ({
  // Platform admins deliberately have no own restaurant. The selected
  // restaurant is the tenant whose analytics must be requested.
  useAuthStore: () => ({
    restaurantId: "restaurant-selected-in-dashboard",
    user: { restaurantId: null },
  }),
}));

const getDailyStats = vi.fn();
const getWeeklySummary = vi.fn();
vi.mock("@/services/schedulingService", () => ({
  schedulingService: {
    getDailyStats: (...args: unknown[]) => getDailyStats(...args),
    getWeeklySummary: (...args: unknown[]) => getWeeklySummary(...args),
  },
}));

vi.mock("@/components/charts/WorkHoursChart.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/charts/ShiftDistributionChart.vue", () => ({
  default: { template: "<div />" },
}));
vi.mock("@/components/charts/TrendChart.vue", () => ({
  default: { template: "<div />" },
}));

describe("SchedulingAnalyticsView", () => {
  beforeEach(() => {
    getDailyStats.mockReset();
    getWeeklySummary.mockReset();
    getDailyStats.mockResolvedValue({
      totalEmployees: 3,
      totalHours: 12,
      currentlyWorking: 1,
      statusBreakdown: {},
      totalOvertimeHours: 0,
    });
    getWeeklySummary.mockResolvedValue({ totalSchedules: 5 });
  });

  it("loads the dashboard-selected restaurant for a platform admin", async () => {
    const wrapper = mount(SchedulingAnalyticsView);
    await flushPromises();

    expect(wrapper.text()).toContain("schedulingAnalytics.title");
    expect(getDailyStats).toHaveBeenCalledWith(
      "restaurant-selected-in-dashboard",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(getWeeklySummary).toHaveBeenCalledWith(
      "restaurant-selected-in-dashboard",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });
});
