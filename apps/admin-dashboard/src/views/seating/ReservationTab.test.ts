// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ReservationTab from "./ReservationTab.vue";
import { ReservationService } from "@/services/reservationService";

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("vue-toastification", () => ({ useToast: () => toast }));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));

vi.mock("@/services/reservationService", () => ({
  ReservationService: { listReservations: vi.fn() },
}));

function buildReservation(overrides = {}) {
  return {
    id: "reservation-1",
    restaurantId: "restaurant-1",
    customerName: "林小姐",
    customerPhone: "0911000111",
    partySize: 2,
    reservationDate: "2026-09-25",
    reservationTime: "18:00",
    status: "pending",
    ...overrides,
  };
}

describe("ReservationTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(ReservationService.listReservations).mockResolvedValue({
      success: true,
      data: [buildReservation()],
      meta: { total: 1 },
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks up new bookings in the background, quietly, until it is left", async () => {
    const onSeatingChanged = vi.fn();
    window.addEventListener("seating:changed", onSeatingChanged);
    const wrapper = mount(ReservationTab);
    await flushPromises();
    expect(ReservationService.listReservations).toHaveBeenCalledOnce();
    // A load on the user's behalf tells the stat cards to recount...
    expect(onSeatingChanged).toHaveBeenCalledOnce();

    vi.mocked(ReservationService.listReservations).mockResolvedValueOnce({
      success: true,
      data: [
        buildReservation(),
        buildReservation({ id: "reservation-2", customerName: "陳先生" }),
      ],
      meta: { total: 2 },
    } as never);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ReservationService.listReservations).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("陳先生");
    // ...a background tick does not; the cards have their own poll.
    expect(onSeatingChanged).toHaveBeenCalledOnce();
    window.removeEventListener("seating:changed", onSeatingChanged);

    // A failed background tick must not toast every 30 seconds.
    vi.mocked(ReservationService.listReservations).mockRejectedValueOnce(
      new Error("network"),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    consoleError.mockRestore();
    expect(toast.error).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("陳先生");

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ReservationService.listReservations).toHaveBeenCalledTimes(3);
  });
});
