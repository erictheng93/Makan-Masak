// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SchedulingView from "./SchedulingView.vue";

// SchedulingView sat in the tree with zero importers until #314 mounted it at
// /dashboard/employees/scheduling/advanced. Resolving the route only proves the
// router knows the path — it never evaluates the component. These tests mount it
// for real so the five advanced tabs (and the three components this view is the
// only importer of) are exercised by CI instead of by a store owner clicking the
// new link in production.

vi.mock("@/i18n", async () => {
  const { ref } = await import("vue");
  return {
    // useDateFormatter reads `locale`, so a t-only stub makes the swap-request
    // tab throw on render rather than exercising it.
    useI18n: () => ({ t: (key: string) => key, locale: ref("zh-TW") }),
  };
});

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/composables/useConfirmModal", () => ({
  useConfirmModal: () => ({ confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ restaurantId: "restaurant-1" }),
}));

const getSchedules = vi.fn();
const getShiftTemplates = vi.fn();
const getConflicts = vi.fn();
const getSwapRequests = vi.fn();
const getClockedInEmployees = vi.fn();

vi.mock("@/services/schedulingService", () => ({
  schedulingService: {
    getSchedules: (...args: unknown[]) => getSchedules(...args),
    getShiftTemplates: (...args: unknown[]) => getShiftTemplates(...args),
    getConflicts: (...args: unknown[]) => getConflicts(...args),
    getSwapRequests: (...args: unknown[]) => getSwapRequests(...args),
    getClockedInEmployees: (...args: unknown[]) =>
      getClockedInEmployees(...args),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    createShiftTemplate: vi.fn(),
    updateShiftTemplate: vi.fn(),
    deleteShiftTemplate: vi.fn(),
    approveSwapRequest: vi.fn(),
    rejectSwapRequest: vi.fn(),
    resolveConflict: vi.fn(),
  },
}));

function buildSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: "schedule-1",
    restaurantId: "restaurant-1",
    userId: "user-1",
    employeeName: "陳小明",
    shiftDate: "2026-09-02",
    startTime: "09:00",
    endTime: "17:00",
    status: "scheduled",
    ...overrides,
  };
}

function buildSwapRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "swap-1",
    restaurantId: "restaurant-1",
    requesterId: "user-1",
    requesterName: "陳小明",
    scheduleId: "schedule-1",
    status: "pending",
    reason: "家中有事",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildConflict(overrides: Record<string, unknown> = {}) {
  return {
    id: "conflict-1",
    restaurantId: "restaurant-1",
    conflictType: "overlap",
    severity: "error",
    status: "unresolved",
    description: "班次重疊",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSchedules.mockResolvedValue({ data: [buildSchedule()] });
  getShiftTemplates.mockResolvedValue([]);
  getConflicts.mockResolvedValue({ data: [buildConflict()] });
  getSwapRequests.mockResolvedValue({ data: [buildSwapRequest()] });
  getClockedInEmployees.mockResolvedValue([]);
});

describe("SchedulingView", () => {
  it("mounts and loads every advanced-scheduling section", async () => {
    const wrapper = mount(SchedulingView);
    await flushPromises();

    expect(wrapper.text()).toContain("scheduling.managementTitle");
    expect(getSchedules).toHaveBeenCalledOnce();
    expect(getSchedules).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "restaurant-1" }),
    );
    expect(getShiftTemplates).toHaveBeenCalledWith("restaurant-1");
    expect(getConflicts).toHaveBeenCalledOnce();
    expect(getSwapRequests).toHaveBeenCalledOnce();
    expect(getClockedInEmployees).toHaveBeenCalledOnce();
  });

  it("offers the tabs SchedulingTab does not have", async () => {
    const wrapper = mount(SchedulingView);
    await flushPromises();

    const tabLabels = wrapper
      .findAll("nav button")
      .map((button) => button.text());

    // 清單檢視、排班衝突、換班申請 are the three #314 said were unreachable.
    expect(tabLabels.join(" ")).toContain("scheduling.list");
    expect(tabLabels.join(" ")).toContain("scheduling.conflictWarnings");
    expect(tabLabels.join(" ")).toContain("swapRequests.title");
  });

  it("keeps scheduling actions and tabs reachable at narrow widths", async () => {
    const wrapper = mount(SchedulingView);
    await flushPromises();

    const actions = wrapper
      .findAll(".users-view > div > div")
      .find((element) => element.findAll("button").length === 3);
    const tabs = wrapper.get('nav[aria-label="Tabs"]');

    expect(actions).toBeDefined();
    expect(actions!.classes()).toContain("flex-wrap");
    expect(tabs.classes()).toContain("overflow-x-auto");
    expect(tabs.attributes("tabindex")).toBe("0");
  });

  it("renders the swap-request tab, whose component this view is the only importer of", async () => {
    const wrapper = mount(SchedulingView);
    await flushPromises();

    const swapTab = wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("swapRequests.title"));
    expect(swapTab).toBeDefined();

    await swapTab!.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("陳小明");
  });
});
