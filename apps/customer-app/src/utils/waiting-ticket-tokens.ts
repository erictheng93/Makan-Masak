import type { WaitingListResponse } from "@makanmasak/shared-types";

export function getWaitingTicketToken(id: string): string | null {
  return localStorage.getItem(`wl:token:${id}`);
}

export function storeWaitingTicketToken(ticket: WaitingListResponse): void {
  if (ticket.waitingToken) {
    localStorage.setItem(`wl:token:${ticket.id}`, ticket.waitingToken);
  }
}
