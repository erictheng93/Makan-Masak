import { beforeEach, describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import JoinWaitingListView from "@/views/waiting-list/JoinWaitingListView.vue";
import { waitingListApi } from "@/services/waitingListApi";
import customerPushService from "@/utils/push-notifications";
import { WAITING_LIST_LAST_TICKET_KEY } from "@/composables/useWaitingTicket";
import { WaitingStatus } from "@makanmasak/shared-types";

vi.mock("@/composables/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    tWithParams: (key: string, params: Record<string, unknown>) =>
      `${key}:${JSON.stringify(params)}`,
  }),
}));

vi.mock("@/services/waitingListApi", () => ({
  waitingListApi: {
    join: vi.fn(),
    lookup: vi.fn(),
    history: vi.fn(),
    getById: vi.fn(),
    getQueueStatus: vi.fn(),
    estimateWait: vi.fn(),
    cancel: vi.fn(),
    confirmArrival: vi.fn(),
  },
}));

vi.mock("@/utils/push-notifications", () => ({
  default: {
    requestPermission: vi.fn(),
    subscribe: vi.fn(),
  },
}));

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: routerMocks.push,
    replace: routerMocks.replace,
  }),
}));

function buildTicket(overrides = {}) {
  return {
    id: "ticket-1",
    restaurantId: "restaurant-1",
    customerName: "Push Customer",
    customerPhone: "0912345678",
    partySize: 2,
    queueNumber: 1,
    queueLetter: "A",
    queueDisplay: "A001",
    priority: 0,
    status: WaitingStatus.WAITING,
    createdAt: 1,
    updatedAt: 1,
    partiesAhead: 0,
    ...overrides,
  };
}

async function joinQueue() {
  const wrapper = mount(JoinWaitingListView, {
    props: { restaurantId: "restaurant-1" },
    global: {
      stubs: {
        QueueListIcon: true,
      },
    },
  });

  await wrapper.find('[data-testid="customer-name-input"]').setValue("Push");
  await wrapper
    .find('[data-testid="customer-phone-input"]')
    .setValue("0912345678");
  await wrapper.find("form").trigger("submit.prevent");
  return wrapper;
}

describe("JoinWaitingListView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  /**
   * Production 2026-09-18: POST /waiting-list answered 201 with ticket A001,
   * and the page stayed on the form with every button disabled, because the
   * join awaited Notification.requestPermission() before routing and the
   * prompt had not been answered. The ticket was not even persisted, so a
   * reload showed the empty form again.
   */
  it("shows and remembers the ticket while the notification prompt is still unanswered", async () => {
    vi.mocked(waitingListApi.getQueueStatus).mockResolvedValue({
      restaurantId: "restaurant-1",
      totalWaiting: 0,
      averageWaitMinutes: 5,
      availableTables: 1,
      byTableType: [],
    });
    vi.mocked(waitingListApi.estimateWait).mockResolvedValue({
      estimatedWaitMinutes: 5,
      partiesAhead: 0,
      availableTables: 1,
      confidence: 1,
    });
    vi.mocked(waitingListApi.join).mockResolvedValue(buildTicket());
    vi.mocked(customerPushService.requestPermission).mockReturnValue(
      new Promise<NotificationPermission>(() => {}),
    );

    await joinQueue();

    await vi.waitFor(() => {
      expect(routerMocks.push).toHaveBeenCalledWith(
        "/r/restaurant-1/wait-list/ticket-1",
      );
    });
    expect(customerPushService.subscribe).not.toHaveBeenCalled();
    expect(
      JSON.parse(localStorage.getItem(WAITING_LIST_LAST_TICKET_KEY) ?? "null"),
    ).toEqual(expect.objectContaining({ ticketId: "ticket-1" }));
  });

  it("enrolls push notifications after a successful waiting-list join", async () => {
    vi.mocked(waitingListApi.getQueueStatus).mockResolvedValue({
      restaurantId: "restaurant-1",
      totalWaiting: 0,
      averageWaitMinutes: 5,
      availableTables: 1,
      byTableType: [],
    });
    vi.mocked(waitingListApi.estimateWait).mockResolvedValue({
      estimatedWaitMinutes: 5,
      partiesAhead: 0,
      availableTables: 1,
      confidence: 1,
    });
    vi.mocked(waitingListApi.join).mockResolvedValue({
      id: "ticket-1",
      restaurantId: "restaurant-1",
      customerName: "Push Customer",
      customerPhone: "0912345678",
      partySize: 2,
      queueNumber: 1,
      queueLetter: "A",
      queueDisplay: "A001",
      priority: 0,
      status: WaitingStatus.WAITING,
      createdAt: 1,
      updatedAt: 1,
      partiesAhead: 0,
    });
    vi.mocked(customerPushService.requestPermission).mockResolvedValue(
      "granted",
    );
    vi.mocked(customerPushService.subscribe).mockResolvedValue({
      endpoint: "https://push.example.test/sub",
      keys: {
        p256dh: "p256dh",
        auth: "auth",
      },
    });

    const wrapper = mount(JoinWaitingListView, {
      props: { restaurantId: "restaurant-1" },
      global: {
        stubs: {
          QueueListIcon: true,
        },
      },
    });

    await wrapper.find('[data-testid="customer-name-input"]').setValue("Push");
    await wrapper
      .find('[data-testid="customer-phone-input"]')
      .setValue("0912345678");
    await wrapper.find("form").trigger("submit.prevent");
    await vi.waitFor(() => {
      expect(waitingListApi.join).toHaveBeenCalled();
    });

    await vi.waitFor(() => {
      expect(customerPushService.requestPermission).toHaveBeenCalledTimes(1);
      expect(customerPushService.subscribe).toHaveBeenCalledTimes(1);
    });
    expect(routerMocks.push).toHaveBeenCalledWith(
      "/r/restaurant-1/wait-list/ticket-1",
    );
  });
});
