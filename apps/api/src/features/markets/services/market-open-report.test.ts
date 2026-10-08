import { describe, expect, it } from "vitest";
import {
  buildOpenReport,
  openReportToCsv,
  type OpenReportInput,
} from "./market-open-report";

const ms = (iso: string) => Date.parse(iso);

function input(overrides: Partial<OpenReportInput> = {}): OpenReportInput {
  return {
    from: "2026-09-25",
    to: "2026-09-27",
    cutoffMinutes: 300,
    openingHours: {
      friday: { closed: false },
      saturday: { closed: false },
    },
    vendors: [
      {
        restaurantId: "a",
        name: "雞排攤",
        stallNumber: "A01",
        offsetMinutes: 480,
        currency: "TWD",
      },
      {
        restaurantId: "b",
        name: "甜點攤",
        stallNumber: "B02",
        offsetMinutes: 480,
        currency: "TWD",
      },
    ],
    events: [
      {
        restaurantId: "a",
        action: "open",
        businessDate: "2026-09-25",
        occurredAtMs: ms("2026-09-25T09:00:00Z"),
        actorUserId: "u1",
      },
      {
        restaurantId: "a",
        action: "close",
        businessDate: "2026-09-25",
        occurredAtMs: ms("2026-09-25T11:00:00Z"),
        actorUserId: "u1",
      },
      {
        restaurantId: "a",
        action: "open",
        businessDate: "2026-09-25",
        occurredAtMs: ms("2026-09-25T12:00:00Z"),
        actorUserId: "u1",
      },
      {
        restaurantId: "b",
        action: "open",
        businessDate: "2026-09-26",
        occurredAtMs: ms("2026-09-26T10:00:00Z"),
        actorUserId: null,
      },
      {
        restaurantId: "b",
        action: "close",
        businessDate: "2026-09-26",
        occurredAtMs: ms("2026-09-26T12:00:00Z"),
        actorUserId: null,
      },
    ],
    orders: [
      {
        restaurantId: "a",
        createdAtMs: ms("2026-09-25T10:00:00Z"),
        amountCents: 12000,
      },
      {
        restaurantId: "a",
        createdAtMs: ms("2026-09-25T17:00:00Z"),
        amountCents: 8000,
      },
    ],
    actorNames: { u1: "王老闆" },
    nowMs: ms("2026-09-28T00:00:00Z"),
    ...overrides,
  };
}

describe("buildOpenReport", () => {
  it("sums every open session and ends an unclosed one at the cutoff", () => {
    const friday = buildOpenReport(input()).daily.find(
      (row) => row.restaurantId === "a" && row.businessDate === "2026-09-25",
    );
    expect(friday).toEqual(
      expect.objectContaining({
        firstOpenedAtMs: ms("2026-09-25T09:00:00Z"),
        lastClosedAtMs: ms("2026-09-25T21:00:00Z"),
        autoClosed: true,
        openMinutes: 660,
        openedBy: "王老闆",
        orderCount: 2,
        revenueCents: 20000,
      }),
    );
  });

  it("counts an ongoing session up to now without marking it closed", () => {
    const friday = buildOpenReport(
      input({ nowMs: ms("2026-09-25T13:00:00Z") }),
    ).daily.find((row) => row.restaurantId === "a");
    expect(friday).toEqual(
      expect.objectContaining({
        lastClosedAtMs: null,
        autoClosed: false,
        openMinutes: 180,
      }),
    );
  });

  it("summarises attendance against the market's trading days", () => {
    expect(buildOpenReport(input()).summary).toEqual([
      expect.objectContaining({
        restaurantId: "a",
        openDays: 1,
        expectedDays: 2,
        attendanceRate: 0.5,
        avgOpenMinutes: 660,
        orderCount: 2,
        revenueCents: 20000,
      }),
      expect.objectContaining({
        restaurantId: "b",
        openDays: 1,
        expectedDays: 2,
        attendanceRate: 0.5,
        avgOpenMinutes: 120,
        orderCount: 0,
      }),
    ]);
  });

  it("counts all days when the market has no opening hours", () => {
    expect(buildOpenReport(input({ openingHours: null })).summary[0]).toEqual(
      expect.objectContaining({ expectedDays: 3 }),
    );
    expect(buildOpenReport(input({ openingHours: {} })).summary[0]).toEqual(
      expect.objectContaining({ expectedDays: 3 }),
    );
  });

  it("reports no attendance rate when there are no trading days", () => {
    expect(
      buildOpenReport(input({ openingHours: { monday: { closed: false } } }))
        .summary[0],
    ).toEqual(
      expect.objectContaining({ expectedDays: 0, attendanceRate: null }),
    );
  });

  it("keeps a day with orders but no open event", () => {
    const report = buildOpenReport(input({ events: [] }));
    expect(report.daily).toEqual([
      expect.objectContaining({
        restaurantId: "a",
        businessDate: "2026-09-25",
        firstOpenedAtMs: null,
        openMinutes: 0,
        orderCount: 2,
      }),
    ]);
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ openDays: 0, orderCount: 2 }),
    );
  });

  it("omits a day with only a close event and no orders", () => {
    const report = buildOpenReport(
      input({
        events: [
          {
            restaurantId: "a",
            action: "close",
            businessDate: "2026-09-25",
            occurredAtMs: ms("2026-09-25T11:00:00Z"),
            actorUserId: "u1",
          },
        ],
        orders: [],
      }),
    );
    expect(report.daily).toEqual([]);
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ openDays: 0, orderCount: 0 }),
    );
  });
});

describe("openReportToCsv", () => {
  it("writes local times and integer cents", () => {
    const [header, first] = openReportToCsv(
      buildOpenReport(input()),
      "daily",
    ).split("\n");
    expect(header).toBe(
      "business_date,restaurant_id,vendor_name,stall_number,first_opened_at,last_closed_at,auto_closed,open_minutes,opened_by,order_count,revenue_cents,currency",
    );
    expect(first).toBe(
      "2026-09-25,a,雞排攤,A01,2026-09-25 17:00,2026-09-26 05:00,true,660,王老闆,2,20000,TWD",
    );
  });

  it("writes the summary view", () => {
    const [header, first] = openReportToCsv(
      buildOpenReport(input()),
      "summary",
    ).split("\n");
    expect(header).toBe(
      "restaurant_id,vendor_name,stall_number,open_days,expected_days,attendance_rate,avg_open_minutes,order_count,revenue_cents,currency",
    );
    expect(first).toBe("a,雞排攤,A01,1,2,0.5000,660,2,20000,TWD");
  });
});
