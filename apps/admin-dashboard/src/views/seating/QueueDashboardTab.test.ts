// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QueueDashboardTab from "./QueueDashboardTab.vue";
import { queueService } from "@/services/queueService";

vi.mock("@/services/queueService", () => ({
  queueService: { getQueue: vi.fn(), getQueueStatus: vi.fn() },
}));

vi.mock("@/services/api", () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { data: [] } }) },
  unwrapApiData: () => [],
}));

vi.mock("@/composables/useRealtimeQueue", () => ({
  useRealtimeQueue: () => ({}),
}));

vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatTime: () => "" }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { restaurantId: "restaurant-1" } }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

describe("QueueDashboardTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(queueService.getQueue).mockResolvedValue([]);
    vi.mocked(queueService.getQueueStatus).mockResolvedValue({} as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling once the tab is left, instead of stacking timers", async () => {
    const first = mount(QueueDashboardTab);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(queueService.getQueue).toHaveBeenCalledTimes(2);
    first.unmount();

    // Coming back must run exactly one poll again, not the old one as well.
    const second = mount(QueueDashboardTab);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(queueService.getQueue).toHaveBeenCalledTimes(4);
    second.unmount();

    await vi.advanceTimersByTimeAsync(90_000);
    expect(queueService.getQueue).toHaveBeenCalledTimes(4);
  });
});
