import {
  getMarketBusinessDate,
  marketBusinessDayEndMs,
} from "@makanmasak/database";
import { toCsv } from "../../../shared/utils/csv";

export interface OpenReportVendor {
  restaurantId: string;
  name: string;
  stallNumber: string | null;
  offsetMinutes: number;
  currency: string;
}

export interface OpenReportEvent {
  restaurantId: string;
  action: "open" | "close";
  businessDate: string;
  occurredAtMs: number;
  actorUserId: string | null;
}

export interface OpenReportOrder {
  restaurantId: string;
  createdAtMs: number;
  amountCents: number;
}

export interface OpenReportInput {
  from: string;
  to: string;
  cutoffMinutes: number;
  openingHours: Record<string, { closed?: boolean }> | null;
  vendors: OpenReportVendor[];
  events: OpenReportEvent[];
  orders: OpenReportOrder[];
  actorNames: Record<string, string>;
  nowMs: number;
}

export interface OpenReportDailyRow {
  businessDate: string;
  restaurantId: string;
  vendorName: string;
  stallNumber: string | null;
  firstOpenedAtMs: number | null;
  lastClosedAtMs: number | null;
  autoClosed: boolean;
  openMinutes: number;
  openedBy: string | null;
  orderCount: number;
  revenueCents: number;
  currency: string;
  offsetMinutes: number;
}

export interface OpenReportSummaryRow {
  restaurantId: string;
  vendorName: string;
  stallNumber: string | null;
  openDays: number;
  expectedDays: number;
  attendanceRate: number | null;
  avgOpenMinutes: number;
  orderCount: number;
  revenueCents: number;
  currency: string;
}

export interface OpenReport {
  daily: OpenReportDailyRow[];
  summary: OpenReportSummaryRow[];
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const DAY_MS = 86_400_000;

export function listBusinessDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let time = Date.parse(`${from}T00:00:00Z`);
    time <= Date.parse(`${to}T00:00:00Z`);
    time += DAY_MS
  ) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  return dates;
}

function countExpectedDays(input: OpenReportInput): number {
  const dates = listBusinessDates(input.from, input.to);
  if (!input.openingHours || Object.keys(input.openingHours).length === 0) {
    return dates.length;
  }
  return dates.filter((date) => {
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const hours = input.openingHours?.[weekday];
    return hours !== undefined && !hours.closed;
  }).length;
}

interface DayBucket {
  vendor: OpenReportVendor;
  businessDate: string;
  events: OpenReportEvent[];
  orderCount: number;
  revenueCents: number;
}

function toDailyRow(
  bucket: DayBucket,
  input: OpenReportInput,
): OpenReportDailyRow {
  const events = [...bucket.events].sort(
    (a, b) => a.occurredAtMs - b.occurredAtMs,
  );
  const dayEndMs = marketBusinessDayEndMs(
    bucket.businessDate,
    bucket.vendor.offsetMinutes,
    input.cutoffMinutes,
  );
  let openSince: number | null = null;
  let openMs = 0;
  let firstOpen: OpenReportEvent | null = null;
  let lastClosedAtMs: number | null = null;

  for (const event of events) {
    if (event.action === "open") {
      firstOpen ??= event;
      openSince ??= event.occurredAtMs;
    } else if (openSince !== null) {
      openMs += event.occurredAtMs - openSince;
      openSince = null;
      lastClosedAtMs = event.occurredAtMs;
    }
  }

  let autoClosed = false;
  if (openSince !== null) {
    if (input.nowMs >= dayEndMs) {
      openMs += dayEndMs - openSince;
      lastClosedAtMs = dayEndMs;
      autoClosed = true;
    } else {
      openMs += input.nowMs - openSince;
      lastClosedAtMs = null;
    }
  }

  return {
    businessDate: bucket.businessDate,
    restaurantId: bucket.vendor.restaurantId,
    vendorName: bucket.vendor.name,
    stallNumber: bucket.vendor.stallNumber,
    firstOpenedAtMs: firstOpen?.occurredAtMs ?? null,
    lastClosedAtMs,
    autoClosed,
    openMinutes: Math.round(openMs / 60_000),
    openedBy: firstOpen?.actorUserId
      ? (input.actorNames[firstOpen.actorUserId] ?? null)
      : null,
    orderCount: bucket.orderCount,
    revenueCents: bucket.revenueCents,
    currency: bucket.vendor.currency,
    offsetMinutes: bucket.vendor.offsetMinutes,
  };
}

// ponytail: JS bucketing is adequate for a 92-day report. Aggregate in SQL if
// a report must scan six-figure order counts.
export function buildOpenReport(input: OpenReportInput): OpenReport {
  const vendorsById = new Map(
    input.vendors.map((vendor) => [vendor.restaurantId, vendor]),
  );
  const buckets = new Map<string, DayBucket>();
  const bucketFor = (vendor: OpenReportVendor, businessDate: string) => {
    const key = `${vendor.restaurantId}|${businessDate}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        vendor,
        businessDate,
        events: [],
        orderCount: 0,
        revenueCents: 0,
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  const inRange = (date: string) => date >= input.from && date <= input.to;

  for (const event of input.events) {
    const vendor = vendorsById.get(event.restaurantId);
    if (vendor && inRange(event.businessDate)) {
      bucketFor(vendor, event.businessDate).events.push(event);
    }
  }
  for (const order of input.orders) {
    const vendor = vendorsById.get(order.restaurantId);
    if (!vendor) continue;
    const businessDate = getMarketBusinessDate(
      vendor.offsetMinutes,
      input.cutoffMinutes,
      new Date(order.createdAtMs),
    );
    if (!inRange(businessDate)) continue;
    const bucket = bucketFor(vendor, businessDate);
    bucket.orderCount += 1;
    bucket.revenueCents += order.amountCents;
  }

  const daily = [...buckets.values()]
    .filter(
      (bucket) =>
        bucket.orderCount > 0 ||
        bucket.events.some((event) => event.action === "open"),
    )
    .map((bucket) => toDailyRow(bucket, input))
    .sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) ||
        (a.stallNumber ?? "").localeCompare(b.stallNumber ?? "") ||
        a.vendorName.localeCompare(b.vendorName),
    );
  const expectedDays = countExpectedDays(input);
  const summary: OpenReportSummaryRow[] = input.vendors.map((vendor) => {
    const rows = daily.filter(
      (row) => row.restaurantId === vendor.restaurantId,
    );
    const openRows = rows.filter((row) => row.firstOpenedAtMs !== null);
    const totalOpenMinutes = openRows.reduce(
      (sum, row) => sum + row.openMinutes,
      0,
    );
    return {
      restaurantId: vendor.restaurantId,
      vendorName: vendor.name,
      stallNumber: vendor.stallNumber,
      openDays: openRows.length,
      expectedDays,
      attendanceRate:
        expectedDays > 0 ? Math.min(1, openRows.length / expectedDays) : null,
      avgOpenMinutes:
        openRows.length > 0
          ? Math.round(totalOpenMinutes / openRows.length)
          : 0,
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      revenueCents: rows.reduce((sum, row) => sum + row.revenueCents, 0),
      currency: vendor.currency,
    };
  });

  return { daily, summary };
}

function localTime(ms: number | null, offsetMinutes: number): string {
  if (ms === null) return "";
  return new Date(ms + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export function openReportToCsv(
  report: OpenReport,
  view: "daily" | "summary",
): string {
  if (view === "summary") {
    return toCsv([
      [
        "restaurant_id",
        "vendor_name",
        "stall_number",
        "open_days",
        "expected_days",
        "attendance_rate",
        "avg_open_minutes",
        "order_count",
        "revenue_cents",
        "currency",
      ],
      ...report.summary.map((row) => [
        row.restaurantId,
        row.vendorName,
        row.stallNumber,
        row.openDays,
        row.expectedDays,
        row.attendanceRate === null ? "" : row.attendanceRate.toFixed(4),
        row.avgOpenMinutes,
        row.orderCount,
        row.revenueCents,
        row.currency,
      ]),
    ]);
  }

  return toCsv([
    [
      "business_date",
      "restaurant_id",
      "vendor_name",
      "stall_number",
      "first_opened_at",
      "last_closed_at",
      "auto_closed",
      "open_minutes",
      "opened_by",
      "order_count",
      "revenue_cents",
      "currency",
    ],
    ...report.daily.map((row) => [
      row.businessDate,
      row.restaurantId,
      row.vendorName,
      row.stallNumber,
      localTime(row.firstOpenedAtMs, row.offsetMinutes),
      localTime(row.lastClosedAtMs, row.offsetMinutes),
      row.autoClosed,
      row.openMinutes,
      row.openedBy,
      row.orderCount,
      row.revenueCents,
      row.currency,
    ]),
  ]);
}
