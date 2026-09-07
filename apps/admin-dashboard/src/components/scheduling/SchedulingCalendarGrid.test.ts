// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SchedulingCalendarGrid from "./SchedulingCalendarGrid.vue";
import type { EmployeeSchedule, ShiftTemplate } from "@/types/scheduling";

// Identity `t`, matching the other component tests here. It means the assertion
// below sees the key rather than "已離職" — enough to prove the suffix is
// appended and to which name, which is what this component decides. Whether the
// key resolves in all six locales is the i18n coverage check's job, not this
// test's.
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const shiftTemplate = {
  id: 1,
  restaurantId: "restaurant-1",
  name: "Morning",
  startTime: "09:00",
  endTime: "17:00",
  colorCode: "#007AFF",
};

const schedule = (overrides = {}) => ({
  id: 1,
  restaurantId: "restaurant-1",
  employeeId: "user-1",
  shiftTemplateId: 1,
  workDate: "2026-06-10",
  startTime: "09:00",
  endTime: "17:00",
  scheduledHours: 8,
  status: "completed",
  ...overrides,
});

/**
 * `ShiftTemplate` carries 21 columns and `EmployeeSchedule` a similar number;
 * the grid reads a handful of each. The fixtures above name only those, and the
 * cast is kept here so there is one place to look rather than a `as never` on
 * every literal.
 */
function mountGrid(schedules: ReturnType<typeof schedule>[]) {
  return mount(SchedulingCalendarGrid, {
    props: {
      schedules: schedules as unknown as EmployeeSchedule[],
      shiftTemplates: [shiftTemplate] as unknown as ShiftTemplate[],
      dateRange: {
        start: new Date("2026-06-10T00:00:00"),
        end: new Date("2026-06-10T00:00:00"),
      },
      viewMode: "week",
    },
  });
}

describe("SchedulingCalendarGrid departed employees (#337)", () => {
  it("marks a shift worked by someone who has since left", () => {
    // A past shift still resolves its employee after they are archived — the
    // roster hides them, the history does not. Without the marker the cell is
    // indistinguishable from one belonging to current staff (#337).
    const wrapper = mountGrid([
      schedule({
        employee: {
          id: "user-1",
          fullName: "Chen Departing",
          isArchived: true,
        },
      }),
    ]);

    expect(wrapper.text()).toContain("Chen Departing（users.roster.archived）");
  });

  it("leaves a current employee's name alone", () => {
    const wrapper = mountGrid([
      schedule({
        employee: { id: "user-2", fullName: "Lin Staying", isArchived: false },
      }),
    ]);

    expect(wrapper.text()).toContain("Lin Staying");
    expect(wrapper.text()).not.toContain("users.roster.archived");
  });

  it("falls back to the flat employeeName the list endpoint also sends", () => {
    // Older rows carry `employeeName` instead of the joined object, and those
    // say nothing about the archive — they must render as a plain name rather
    // than as an empty cell.
    const wrapper = mountGrid([
      schedule({ employee: undefined, employeeName: "Wong Legacy" }),
    ]);

    expect(wrapper.text()).toContain("Wong Legacy");
    expect(wrapper.text()).not.toContain("users.roster.archived");
  });
});
