// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import AttendanceOverviewTab from "./AttendanceOverviewTab.vue";

vi.mock("@/i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    restaurantId: "restaurant-1",
    user: { id: "user-2" },
  }),
}));

vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({ formatTime: (d: Date) => d.toISOString() }),
}));

const users = ref([
  { id: "user-1", username: "chef", fullName: "Demo Chef", isActive: true },
  { id: "user-2", username: "owner", fullName: "Demo Owner", isActive: true },
  { id: "user-3", username: "gone", fullName: "Retired", isActive: false },
  { id: "user-4", username: "server", fullName: "Demo Server", isActive: true },
  { id: "user-5", username: "cash", fullName: "Demo Cashier", isActive: true },
]);
const usersWithStatus = ref<Array<Record<string, unknown>>>([]);
const todaySchedules = ref<Array<Record<string, unknown>>>([]);
const fetchClockedIn = vi.fn();
const fetchTodaySchedules = vi.fn();

vi.mock("@/composables/useEmployeeList", () => ({
  useEmployeeList: () => ({
    users,
    usersWithStatus,
    stats: ref({ currentlyWorking: 0, onLeaveToday: 0 }),
    clockedInList: ref([]),
    todaySchedules,
    clockedInLoading: ref(false),
    schedulesLoading: ref(false),
    leaveLoading: ref(false),
    fetchClockedIn,
    fetchTodaySchedules,
    fetchTodayLeaves: vi.fn(),
  }),
}));

const rosterRow = (employeeId: string, overrides = {}) => ({
  id: Number(employeeId.slice(-1)),
  employeeId,
  workDate: "2026-09-05",
  status: "scheduled",
  clockInTime: null,
  clockOutTime: null,
  ...overrides,
});

function statTiles(wrapper: ReturnType<typeof mountTab>) {
  return wrapper
    .findAll(".grid > div")
    .map((tile) => tile.findAll("p").map((p) => p.text()));
}

// Stubbed so the assertions are about the mount and its wiring, not about the
// panel's own fetching, which ClockInOutPanel.test.ts covers.
const ClockInOutPanelStub = {
  name: "ClockInOutPanel",
  props: ["restaurantId", "employeeId"],
  emits: ["clockIn", "clockOut"],
  template: `<div data-testid="clock-panel-stub" :data-employee="String(employeeId)"
    @click="$emit('clockIn', {})"></div>`,
};

function mountTab() {
  return mount(AttendanceOverviewTab, {
    global: {
      stubs: {
        ClockInOutPanel: ClockInOutPanelStub,
        Clock: true,
        CalendarOff: true,
      },
    },
  });
}

// The first mount of this tab in a worker is a one-off that used to land in
// whichever timed body reached it first -- here the very first `it`, which is
// why that one test was the file's slowest under `turbo run test` while the
// nine after it were ordinary (#360, continuing #351). Instrumented alone on a
// loaded 4-core box, "gives the attendance tab a clock-in entry point" spent
// mount 244ms, flush 1ms, assert 24ms of its 279ms; the nine bodies after it
// cost 49-147ms each because the warm-up was already paid.
//
// Vue render warm-up plus jsdom's first DOM build for this tree is re-usable
// state, not per-test work, so pay it once here under the hook's own budget.
// Do not replace this with a raised testTimeout: the point is that the timed
// bodies stop containing one-off costs at all.
beforeAll(async () => {
  const warmup = mountTab();
  await flushPromises();
  warmup.unmount();
}, 30_000);

describe("AttendanceOverviewTab clock-in mount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersWithStatus.value = [];
    todaySchedules.value = [];
  });

  it("gives the attendance tab a clock-in entry point", async () => {
    const wrapper = mountTab();
    await flushPromises();

    // ClockInOutPanel had zero imports repo-wide, so nothing in the product
    // could reach clock-in at all — every downstream attendance number was
    // structurally stuck at zero (#308).
    expect(wrapper.find('[data-testid="clock-panel-stub"]').exists()).toBe(
      true,
    );
  });

  it("defaults the target to the signed-in user, not the first row", async () => {
    const wrapper = mountTab();
    await flushPromises();

    // Demo Chef is first in the roster; the signed-in user is Demo Owner.
    expect(
      wrapper
        .find('[data-testid="clock-panel-stub"]')
        .attributes("data-employee"),
    ).toBe("user-2");
  });

  it("lists only active staff as clock targets", async () => {
    const wrapper = mountTab();
    await flushPromises();

    const options = wrapper
      .find('[data-testid="clock-target-select"]')
      .findAll("option")
      .map((o) => o.text());

    expect(options).toEqual([
      "Demo Chef",
      "Demo Owner",
      "Demo Server",
      "Demo Cashier",
    ]);
  });

  it("retargets the panel when a manager picks another employee", async () => {
    const wrapper = mountTab();
    await flushPromises();

    const select = wrapper.find('[data-testid="clock-target-select"]');
    await select.setValue("user-1");
    await flushPromises();

    expect(
      wrapper
        .find('[data-testid="clock-panel-stub"]')
        .attributes("data-employee"),
    ).toBe("user-1");
  });

  it("refetches the clocked-in list after a clock action", async () => {
    const wrapper = mountTab();
    await flushPromises();
    fetchClockedIn.mockClear();
    fetchTodaySchedules.mockClear();

    await wrapper.find('[data-testid="clock-panel-stub"]').trigger("click");
    await flushPromises();

    // Without this the stats directly above the panel keep showing the
    // pre-clock-in numbers until the tab is reloaded.
    expect(fetchClockedIn).toHaveBeenCalledOnce();
    // The present/absent counts come from clockInTime on the roster rows, so
    // refetching only the clocked-in list would leave them stale.
    expect(fetchTodaySchedules).toHaveBeenCalledOnce();
  });
});

describe("AttendanceOverviewTab stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usersWithStatus.value = [];
    todaySchedules.value = [];
  });

  it("measures the rate against today's roster, not headcount", async () => {
    // Four active staff, two rostered, one of them clocked in.
    todaySchedules.value = [
      rosterRow("user-1", { clockInTime: "2026-09-05T01:00:00.000Z" }),
      rosterRow("user-2"),
    ];

    const wrapper = mountTab();
    await flushPromises();

    // Headcount as the denominator capped this at 1/4 = 25%; the honest
    // answer is 1 of the 2 people who were due in (#308).
    expect(statTiles(wrapper)).toEqual([
      ["employees.attendance.totalActive", "4"],
      ["employees.attendance.scheduled", "2"],
      ["employees.attendance.present", "1"],
      ["employees.attendance.onLeave", "0"],
      ["employees.attendance.absent", "1"],
      ["employees.attendance.rate", "50%"],
    ]);
  });

  it("still counts someone who has already clocked out as present", async () => {
    todaySchedules.value = [
      rosterRow("user-1", {
        status: "completed",
        clockInTime: "2026-09-05T01:00:00.000Z",
        clockOutTime: "2026-09-05T09:00:00.000Z",
      }),
    ];

    const wrapper = mountTab();
    await flushPromises();

    // currentlyWorking is "clocked in and not out", so it drops to zero at
    // closing time — which is why it cannot be the attendance numerator.
    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.rate",
      "100%",
    ]);
    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.present",
      "1",
    ]);
  });

  it("does not count unrostered or on-leave staff as absent", async () => {
    todaySchedules.value = [rosterRow("user-1"), rosterRow("user-2")];
    usersWithStatus.value = [
      { id: "user-1", leaveStatus: { isOnLeave: true, leaveType: "Annual" } },
    ];

    const wrapper = mountTab();
    await flushPromises();

    // user-1 is on approved leave, user-2 is a genuine no-show, and user-4 /
    // user-5 were never due in. Only user-2 is absent.
    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.absent",
      "1",
    ]);
    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.onLeave",
      "1",
    ]);
  });

  it("leaves a cancelled shift out of the denominator", async () => {
    todaySchedules.value = [
      rosterRow("user-1", { clockInTime: "2026-09-05T01:00:00.000Z" }),
      rosterRow("user-2", { status: "cancelled" }),
    ];

    const wrapper = mountTab();
    await flushPromises();

    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.scheduled",
      "1",
    ]);
    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.rate",
      "100%",
    ]);
  });

  it("reports no rate at all when nobody is rostered", async () => {
    const wrapper = mountTab();
    await flushPromises();

    // 0% would read as a failed day rather than as "no shifts today".
    expect(statTiles(wrapper)).toContainEqual([
      "employees.attendance.rate",
      "—",
    ]);
  });
});
