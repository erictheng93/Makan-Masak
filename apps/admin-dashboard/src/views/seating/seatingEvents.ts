/**
 * Fired by a seating tab after it reloads on the user's behalf, so the stat
 * cards in SeatingManagementView recount instead of waiting for their poll.
 */
export const SEATING_CHANGED = "seating:changed";

export function notifySeatingChanged() {
  window.dispatchEvent(new Event(SEATING_CHANGED));
}
