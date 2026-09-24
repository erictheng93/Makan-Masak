// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TableDetailView from "./TableDetailView.vue";
import { api } from "@/services/api";

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ params: { id: "11" }, query: {} }),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock("@/services/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  unwrapApiList: (data: unknown) => (Array.isArray(data) ? data : []),
  unwrapApiPayload: (data: unknown) => data,
}));

function tableResponse(isOccupied: boolean) {
  return {
    data: {
      success: true,
      data: {
        id: 11,
        number: "A1",
        capacity: 4,
        isActive: true,
        isOccupied,
        qrMode: "table",
      },
    },
  } as never;
}

describe("TableDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows occupancy, holding off while the mode switch is open", async () => {
    vi.mocked(api.get).mockResolvedValue(tableResponse(false));
    const wrapper = mount(TableDetailView, {
      global: {
        stubs: {
          SeatManagement: true,
          QRModeSelector: true,
          QRCodeRenderer: true,
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("tableDetail.status.available");

    vi.mocked(api.get).mockResolvedValue(tableResponse(true));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(wrapper.text()).toContain("tableDetail.status.occupied");
    expect(api.get).toHaveBeenCalledTimes(2);

    await wrapper
      .get('[data-testid="table-detail-switch-mode"]')
      .trigger("click");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.get).toHaveBeenCalledTimes(2);

    wrapper.unmount();
  });
});
