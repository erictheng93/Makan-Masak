/**
 * Group the analytics API's per-hour order counts into the 2-hour slots the
 * 營業時段分析 panel renders.
 *
 * Extracted from AnalyticsView so it can be tested without mounting the view.
 * The logic is worth pinning: it previously started at 06:00 and skipped every
 * earlier hour, so a shop's midnight-to-06:00 trade was dropped on the floor.
 * That was invisible while the API bucketed in UTC (#290) — a Taipei shop's
 * 01:34 order arrived as hour 17 and was rendered in 16:00-18:00 — and would
 * have become a visible regression the moment the API started reporting the
 * true local hour. A night market is precisely the tenant whose orders land in
 * the hours that were being discarded.
 */

export interface HourlyOrderCount {
  hour: number | null | undefined;
  orderCount: number;
}

export interface BusinessHourSlot {
  time: string;
  orders: number;
  percentage: number;
}

const SLOT_SIZE_HOURS = 2;

export function slotLabel(startHour: number): string {
  const end = startHour + SLOT_SIZE_HOURS;
  return `${String(startHour).padStart(2, "0")}:00 - ${String(end).padStart(2, "0")}:00`;
}

/**
 * @param keepEmptySlots render slots with no orders — the view passes true for
 * the "today" period so the panel does not collapse to nothing early in a day.
 */
export function buildBusinessHourSlots(
  slots: readonly HourlyOrderCount[],
  keepEmptySlots = false,
): BusinessHourSlot[] {
  if (slots.length === 0) return [];

  const counts = new Map<string, number>();
  const order: string[] = [];
  for (let startHour = 0; startHour < 24; startHour += SLOT_SIZE_HOURS) {
    const label = slotLabel(startHour);
    counts.set(label, 0);
    order.push(label);
  }

  for (const slot of slots) {
    if (slot.hour == null) continue;
    // A malformed hour must not invent a slot outside the day.
    if (!Number.isFinite(slot.hour) || slot.hour < 0 || slot.hour > 23) {
      continue;
    }
    const label = slotLabel(
      Math.floor(slot.hour / SLOT_SIZE_HOURS) * SLOT_SIZE_HOURS,
    );
    counts.set(label, (counts.get(label) ?? 0) + slot.orderCount);
  }

  const maxOrders = Math.max(...counts.values(), 1);

  return order
    .map((label) => {
      const orders = counts.get(label) ?? 0;
      return {
        time: label,
        orders,
        percentage: Math.round((orders / maxOrders) * 100),
      };
    })
    .filter((slot) => slot.orders > 0 || keepEmptySlots);
}
