import { describe, expect, it } from "vitest";
import { buildBusinessHourSlots } from "./businessHourSlots";

describe("buildBusinessHourSlots", () => {
  it("keeps late-night trade instead of dropping everything before 06:00", () => {
    // The regression this guards: the panel used to start its slots at 06:00
    // and skip earlier hours, so a night market's 01:34 order vanished. It only
    // looked fine while the API bucketed in UTC and reported that order as
    // hour 17 (#290).
    const slots = buildBusinessHourSlots([
      { hour: 1, orderCount: 2 },
      { hour: 23, orderCount: 3 },
    ]);

    expect(slots).toEqual([
      { time: "00:00 - 02:00", orders: 2, percentage: 67 },
      { time: "22:00 - 24:00", orders: 3, percentage: 100 },
    ]);
  });

  it("folds both hours of a slot into one bucket", () => {
    const slots = buildBusinessHourSlots([
      { hour: 20, orderCount: 2 },
      { hour: 21, orderCount: 1 },
    ]);

    expect(slots).toEqual([
      { time: "20:00 - 22:00", orders: 3, percentage: 100 },
    ]);
  });

  it("hides empty slots unless the caller asks for them", () => {
    const input = [{ hour: 12, orderCount: 1 }];

    expect(buildBusinessHourSlots(input)).toHaveLength(1);
    // "today" keeps them, so the panel does not read as broken at 09:00.
    expect(buildBusinessHourSlots(input, true)).toHaveLength(12);
  });

  it("returns nothing for no data rather than twelve zeroes", () => {
    expect(buildBusinessHourSlots([])).toEqual([]);
    expect(buildBusinessHourSlots([], true)).toEqual([]);
  });

  it("ignores hours that are absent or out of range", () => {
    const slots = buildBusinessHourSlots([
      { hour: null, orderCount: 5 },
      { hour: undefined, orderCount: 5 },
      { hour: 24, orderCount: 5 },
      { hour: -1, orderCount: 5 },
      { hour: Number.NaN, orderCount: 5 },
      { hour: 8, orderCount: 1 },
    ]);

    expect(slots).toEqual([
      { time: "08:00 - 10:00", orders: 1, percentage: 100 },
    ]);
  });
});
