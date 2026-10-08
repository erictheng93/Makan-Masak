// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmployeeManagementView from "./EmployeeManagementView.vue";
import {
  leavesService,
  notifyLeaveRequestsChanged,
} from "@/services/leavesService";

const routeState = reactive({ path: "/dashboard/employees" });

vi.mock("vue-router", () => ({ useRoute: () => routeState }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));

vi.mock("@/composables/useEmployeeList", () => ({
  useEmployeeList: () => ({
    fetchAll: vi.fn(),
    fetchArchivedUsers: vi.fn(),
    usersWithStatus: ref([]),
    archivedUsers: ref([]),
    isLoading: ref(false),
    archivedLoading: ref(false),
    stats: ref({
      owner: 0,
      chef: 0,
      service: 0,
      cashier: 0,
      total: 0,
      currentlyWorking: 0,
      onLeaveToday: 0,
    }),
  }),
}));

vi.mock("@/services/leavesService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/leavesService")>();
  return { ...actual, leavesService: { getRequests: vi.fn() } };
});

function pending(count: number) {
  return Array.from({ length: count }, (_, id) => ({ id, status: "pending" }));
}

describe("EmployeeManagementView pending-leave badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recounts after an approval and on its poll, until the page is left", async () => {
    vi.mocked(leavesService.getRequests).mockResolvedValue(pending(2) as never);
    const wrapper = mount(EmployeeManagementView, {
      global: {
        stubs: {
          RouterLink: { template: "<a><slot /></a>" },
          RouterView: true,
          EmployeeFormModal: true,
        },
      },
    });
    await flushPromises();
    const badge = () => wrapper.find('[data-testid="tab-badge-leaves"]');
    expect(badge().text()).toBe("2");

    vi.mocked(leavesService.getRequests).mockResolvedValue(pending(1) as never);
    notifyLeaveRequestsChanged();
    await flushPromises();
    expect(leavesService.getRequests).toHaveBeenCalledTimes(2);
    expect(leavesService.getRequests).toHaveBeenLastCalledWith("restaurant-1", {
      status: "pending",
    });
    expect(badge().text()).toBe("1");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(leavesService.getRequests).toHaveBeenCalledTimes(3);

    wrapper.unmount();
    notifyLeaveRequestsChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(leavesService.getRequests).toHaveBeenCalledTimes(3);
  });
});
