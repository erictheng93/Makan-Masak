// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SeatingManagementView from "./SeatingManagementView.vue";
import { notifySeatingChanged } from "./seatingEvents";
import { ReservationService } from "@/services/reservationService";
import { WaitingListService } from "@/services/waitingListService";

const routeState = reactive({ path: "/dashboard/seating" });

vi.mock("vue-router", () => ({ useRoute: () => routeState }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    canAccessAdminFeatures: true,
  }),
}));

vi.mock("@/services/reservationService", () => ({
  ReservationService: { getStats: vi.fn() },
}));

vi.mock("@/services/waitingListService", () => ({
  WaitingListService: { getQueueStatus: vi.fn(), getStats: vi.fn() },
}));

function mountView() {
  return mount(SeatingManagementView, {
    global: { stubs: { RouterLink: true, RouterView: true } },
  });
}

describe("SeatingManagementView stat cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    routeState.path = "/dashboard/seating";
    vi.mocked(ReservationService.getStats).mockResolvedValue({
      totalReservations: 4,
      confirmedCount: 2,
      completedCount: 0,
      noShowRate: 0,
    } as never);
    vi.mocked(WaitingListService.getQueueStatus).mockResolvedValue({
      totalWaiting: 3,
      averageWaitMinutes: 10,
      availableTables: 1,
    } as never);
    vi.mocked(WaitingListService.getStats).mockResolvedValue({
      seatedCount: 5,
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recounts on a timer, on a tab switch and when a tab reports a change", async () => {
    const wrapper = mountView();
    await flushPromises();
    const loads = () =>
      vi.mocked(ReservationService.getStats).mock.calls.length;
    expect(loads()).toBe(1);

    vi.mocked(WaitingListService.getQueueStatus).mockResolvedValue({
      totalWaiting: 7,
      averageWaitMinutes: 10,
      availableTables: 1,
    } as never);
    notifySeatingChanged();
    await flushPromises();
    expect(loads()).toBe(2);
    expect(wrapper.text()).toContain("7");

    routeState.path = "/dashboard/seating/waiting-list";
    await nextTick();
    await flushPromises();
    expect(loads()).toBe(3);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(loads()).toBe(4);

    wrapper.unmount();
    notifySeatingChanged();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loads()).toBe(4);
  });
});
