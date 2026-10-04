import { beforeEach, describe, expect, it, vi } from "vitest";
import axios, { type InternalAxiosRequestConfig } from "axios";
import { WaitingStatus } from "@makanmasak/shared-types";

const ticket = {
  id: "ticket-1",
  restaurantId: "rest-1",
  customerName: "Diner",
  customerPhone: "0912345678",
  partySize: 2,
  queueNumber: 1,
  queueDisplay: "A001",
  priority: 0,
  partiesAhead: 0,
  status: WaitingStatus.WAITING,
  createdAt: 1,
  updatedAt: 1,
  waitingToken: "private-ticket-capability",
};

describe("guest waiting ticket credentials", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.test");
  });

  it("stores the join credential and sends it for polling, mutation, and both preorder paths", async () => {
    const requests: InternalAxiosRequestConfig[] = [];
    axios.defaults.adapter = async (config) => {
      requests.push(config);
      return {
        status: 200,
        statusText: "OK",
        headers: {},
        config,
        data: {
          success: true,
          data: config.url?.includes("/history?") ? [ticket] : ticket,
        },
      };
    };
    vi.resetModules();
    const { waitingListApi } = await import("@/services/waitingListApi");
    const { apiClient } = await import("@/services/api");
    await waitingListApi.join({
      restaurantId: "rest-1",
      customerName: "Diner",
      customerPhone: "0912345678",
      partySize: 2,
    });
    expect(localStorage.getItem("wl:token:ticket-1")).toBe(
      "private-ticket-capability",
    );
    await waitingListApi.getById(ticket.id);
    await waitingListApi.cancel(ticket.id, ticket.customerPhone);
    await waitingListApi.confirmArrival(ticket.id, ticket.customerPhone);
    await apiClient.post("/guest-orders", { waitingListId: ticket.id });
    await apiClient.post("/orders", { waitingListId: ticket.id });
    expect(requests[0].headers.get("X-Waiting-Ticket-Token")).toBeUndefined();
    for (const config of requests.slice(1)) {
      expect(config.headers.get("X-Waiting-Ticket-Token")).toBe(
        "private-ticket-capability",
      );
    }
    localStorage.setItem(
      "wl:lastTicket",
      JSON.stringify({
        ticketId: ticket.id,
        restaurantId: ticket.restaurantId,
        customerPhone: ticket.customerPhone,
      }),
    );
    await waitingListApi.join({
      restaurantId: "rest-1",
      customerName: "Diner",
      customerPhone: "0912345678",
      partySize: 2,
    });
    expect(requests.at(-1)?.headers.get("X-Waiting-Ticket-Token")).toBe(
      "private-ticket-capability",
    );
    localStorage.removeItem("wl:token:ticket-1");
    await waitingListApi.history("rest-1", ticket.customerPhone);
    expect(localStorage.getItem("wl:token:ticket-1")).toBe(
      "private-ticket-capability",
    );
    await waitingListApi.getById("ticket-2");
    expect(
      requests.at(-1)?.headers.get("X-Waiting-Ticket-Token"),
    ).toBeUndefined();
  });
});
