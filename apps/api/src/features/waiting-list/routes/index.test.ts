import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";

const auth = vi.hoisted(() => {
  // Admins (role 0) carry no restaurant scope, matching AuthUser.restaurantId
  // being optional in production.
  const user: AuthUser = {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  };
  return {
    user,
    customer: undefined as undefined | { id: string },
  };
});

vi.mock("../../../middleware/auth", () => ({
  optionalCanonicalCustomerAuthMiddleware: vi.fn(async (c, next) => {
    if (auth.customer) c.set("customer", auth.customer);
    await next();
  }),
  optionalAuth: vi.fn(async (_c, next) => {
    await next();
  }),
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", auth.user);
    await next();
  }),
  requireRole: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("../../../middleware/rateLimit", () => ({
  strictRateLimit: vi.fn(async (_c, next) => next()),
}));

const serviceFns = vi.hoisted(() => ({
  joinWaitingList: vi.fn(),
  findActiveTicketByPhone: vi.fn(),
  listWaitingListHistoryByPhone: vi.fn(),
  getWaitingListEntryById: vi.fn(),
  getQueueStatus: vi.fn(),
  estimateWaitTime: vi.fn(),
  cancelWaiting: vi.fn(),
  confirmWaiting: vi.fn(),
  listWaitingList: vi.fn(),
  callWaiting: vi.fn(),
  markSeated: vi.fn(),
  expireWaiting: vi.fn(),
  getWaitingStats: vi.fn(),
  batchCallNext: vi.fn(),
  drainBackgroundTasks: vi.fn(),
}));

vi.mock("@makanmasak/database", () => ({
  WaitingListService: class {
    joinWaitingList = serviceFns.joinWaitingList;
    findActiveTicketByPhone = serviceFns.findActiveTicketByPhone;
    listWaitingListHistoryByPhone = serviceFns.listWaitingListHistoryByPhone;
    getWaitingListEntryById = serviceFns.getWaitingListEntryById;
    getQueueStatus = serviceFns.getQueueStatus;
    estimateWaitTime = serviceFns.estimateWaitTime;
    cancelWaiting = serviceFns.cancelWaiting;
    confirmWaiting = serviceFns.confirmWaiting;
    listWaitingList = serviceFns.listWaitingList;
    callWaiting = serviceFns.callWaiting;
    markSeated = serviceFns.markSeated;
    expireWaiting = serviceFns.expireWaiting;
    getWaitingStats = serviceFns.getWaitingStats;
    batchCallNext = serviceFns.batchCallNext;
    drainBackgroundTasks = serviceFns.drainBackgroundTasks;
  },
}));

import routes from "./index";
import { ApiError } from "../../../shared/utils/api-error";

routes.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(
      { success: false, error: { code: err.code, message: err.message } },
      err.status as 400 | 401 | 403 | 404 | 409,
    );
  }
  return c.json({ success: false, error: { message: String(err) } }, 500);
});

function request(path: string, method = "GET", body?: unknown, token?: string) {
  return routes.request(
    path,
    {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Waiting-Ticket-Token": token } : {}),
      },
    },
    {
      JWT_SECRET: "test-waiting-secret-with-32-characters",
      DB: {
        prepare: () => ({
          bind: () => ({ first: async () => ({ verified: 1 }) }),
        }),
      },
      CACHE_KV: {},
    } as never,
  );
}

const entry = {
  id: "ticket-1",
  restaurantId: "rest-1",
  customerName: "Amy",
  customerPhone: "0912345678",
  partySize: 2,
  queueDisplay: "A001",
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = {
    id: "user-7",
    username: "owner",
    role: 1,
    restaurantId: "rest-1",
  };
  auth.customer = undefined;

  serviceFns.joinWaitingList.mockResolvedValue(entry);
  serviceFns.findActiveTicketByPhone.mockResolvedValue(entry);
  serviceFns.listWaitingListHistoryByPhone.mockResolvedValue([entry]);
  serviceFns.getWaitingListEntryById.mockResolvedValue(entry);
  serviceFns.getQueueStatus.mockResolvedValue({ waiting: 3 });
  serviceFns.estimateWaitTime.mockResolvedValue({ estimatedMinutes: 20 });
  serviceFns.cancelWaiting.mockResolvedValue({ ...entry, status: "cancelled" });
  serviceFns.confirmWaiting.mockResolvedValue({
    ...entry,
    status: "confirmed",
  });
  serviceFns.listWaitingList.mockResolvedValue({ data: [entry], total: 1 });
  serviceFns.callWaiting.mockResolvedValue({ ...entry, status: "called" });
  serviceFns.markSeated.mockResolvedValue({ ...entry, status: "seated" });
  serviceFns.expireWaiting.mockResolvedValue({ ...entry, status: "expired" });
  serviceFns.getWaitingStats.mockResolvedValue({ total: 4 });
  serviceFns.batchCallNext.mockResolvedValue([
    { success: true, id: "ticket-1" },
  ]);
  serviceFns.drainBackgroundTasks.mockReturnValue([]);
});

describe("waiting list routes", () => {
  it("rejects phone-only reads and mutations and duplicate-join recovery", async () => {
    for (const path of [
      "/ticket-1",
      "/lookup?restaurantId=rest-1&phone=0912345678",
      "/history?restaurantId=rest-1&phone=0912345678",
    ]) {
      expect((await request(path)).status).toBe(403);
    }
    expect(
      (
        await request("/ticket-1", "DELETE", {
          customerPhone: entry.customerPhone,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/ticket-1/confirm", "POST", {
          customerPhone: entry.customerPhone,
        })
      ).status,
    ).toBe(403);
    serviceFns.joinWaitingList.mockResolvedValueOnce({
      ...entry,
      alreadyJoined: true,
    });
    expect((await request("/", "POST", entry)).status).toBe(403);
  });

  it("joins the waiting list with optional customer identity", async () => {
    auth.customer = { id: "customer-1" };

    const response = await request("/", "POST", {
      restaurantId: "rest-1",
      customerName: "Amy",
      customerPhone: "0912345678",
      partySize: 2,
    });

    expect(response.status).toBe(201);
    expect(serviceFns.joinWaitingList).toHaveBeenCalledWith({
      restaurantId: "rest-1",
      customerName: "Amy",
      customerPhone: "0912345678",
      partySize: 2,
      customerId: "customer-1",
    });

    const invalid = await request("/", "POST", {
      restaurantId: "rest-1",
      customerName: "Amy",
    });
    expect(invalid.status).toBe(400);
  });

  it("looks up tickets after verified phone recovery", async () => {
    auth.customer = { id: "customer-1" };
    let response = await request(
      "/lookup?restaurantId=rest-1&phone=0912-345-678",
    );

    expect(response.status).toBe(200);
    expect(serviceFns.findActiveTicketByPhone).toHaveBeenCalledWith(
      "rest-1",
      "0912345678",
    );

    response = await request("/lookup?restaurantId=rest-1&phone=123");
    expect(response.status).toBe(400);

    serviceFns.findActiveTicketByPhone.mockResolvedValueOnce(null);
    response = await request("/lookup?restaurantId=rest-1&phone=0912345678");
    expect(response.status).toBe(404);
  });

  it("returns owner ticket history and detail, public queue status and wait estimates", async () => {
    auth.customer = { id: "customer-1" };
    let response = await request(
      "/history?restaurantId=rest-1&phone=0912 345 678&limit=5",
    );

    expect(response.status).toBe(200);
    expect(serviceFns.listWaitingListHistoryByPhone).toHaveBeenCalledWith(
      "rest-1",
      "0912345678",
      5,
    );

    response = await request("/ticket-1");
    expect(response.status).toBe(200);
    expect(serviceFns.getWaitingListEntryById).toHaveBeenCalledWith("ticket-1");

    response = await request("/queue-status/rest-1");
    expect(response.status).toBe(200);
    expect(serviceFns.getQueueStatus).toHaveBeenCalledWith("rest-1");

    response = await request("/estimate-wait/rest-1?partySize=4");
    expect(response.status).toBe(200);
    expect(serviceFns.estimateWaitTime).toHaveBeenCalledWith({
      restaurantId: "rest-1",
      partySize: 4,
    });

    serviceFns.getWaitingListEntryById.mockResolvedValueOnce(null);
    response = await request("/missing");
    expect(response.status).toBe(404);
  });

  it("cancels and confirms tickets with a scoped guest capability", async () => {
    const joined = await request("/", "POST", entry);
    const joinedBody = (await joined.json()) as {
      data: { waitingToken: string };
    };
    const token = joinedBody.data.waitingToken;
    let response = await request(
      "/ticket-1",
      "DELETE",
      {
        customerPhone: "0912345678",
      },
      token,
    );

    expect(response.status).toBe(200);
    expect(serviceFns.cancelWaiting).toHaveBeenCalledWith("ticket-1");

    response = await request(
      "/ticket-1/confirm",
      "POST",
      {
        customerPhone: "0912345678",
      },
      token,
    );
    expect(response.status).toBe(200);
    expect(serviceFns.confirmWaiting).toHaveBeenCalledWith("ticket-1");

    serviceFns.getWaitingListEntryById.mockResolvedValueOnce({
      ...entry,
      customerPhone: "0999999999",
    });
    response = await request("/ticket-1/confirm", "POST", {
      customerPhone: "0912345678",
    });
    expect(response.status).toBe(403);
  });

  it("lists protected waiting entries with role-scoped filters", async () => {
    let response = await request("/?status=waiting&page=2&limit=10");

    expect(response.status).toBe(200);
    expect(serviceFns.listWaitingList).toHaveBeenCalledWith({
      restaurantId: "rest-1",
      status: "waiting",
      customerPhone: undefined,
      date: undefined,
      page: 2,
      limit: 10,
    });

    auth.user = { id: "user-1", username: "admin", role: 0 };
    response = await request("/?restaurantId=rest-2");

    expect(response.status).toBe(200);
    expect(serviceFns.listWaitingList).toHaveBeenLastCalledWith(
      expect.objectContaining({ restaurantId: "rest-2" }),
    );
  });

  it("calls, seats, and expires entries after restaurant access checks", async () => {
    let response = await request("/ticket-1/call", "POST", {
      tableId: "table-1",
    });

    expect(response.status).toBe(200);
    expect(serviceFns.callWaiting).toHaveBeenCalledWith("ticket-1", {
      tableId: "table-1",
    });

    response = await request("/ticket-1/seat", "POST");
    expect(response.status).toBe(200);
    expect(serviceFns.markSeated).toHaveBeenCalledWith("ticket-1");

    response = await request("/ticket-1/expire", "POST");
    expect(response.status).toBe(200);
    expect(serviceFns.expireWaiting).toHaveBeenCalledWith("ticket-1");

    serviceFns.getWaitingListEntryById.mockResolvedValueOnce({
      ...entry,
      restaurantId: "other",
    });
    response = await request("/ticket-1/call", "POST", {
      tableId: "table-1",
    });
    expect(response.status).toBe(403);

    response = await request("/ticket-1/call", "POST", {});
    expect(response.status).toBe(400);
  });

  it("returns waiting stats with owner restaurant checks", async () => {
    let response = await request("/stats/rest-1?date=2026-06-07");

    expect(response.status).toBe(200);
    expect(serviceFns.getWaitingStats).toHaveBeenCalledWith(
      "rest-1",
      "2026-06-07",
    );

    response = await request("/stats/other");
    expect(response.status).toBe(403);
  });

  it("batch-calls next entries using admin or owner target restaurants", async () => {
    let response = await request("/batch-call", "POST", {
      count: 2,
    });

    expect(response.status).toBe(200);
    expect(serviceFns.batchCallNext).toHaveBeenCalledWith("rest-1", 2);

    auth.user = { id: "user-1", username: "admin", role: 0 };
    response = await request("/batch-call", "POST", {
      restaurantId: "rest-2",
      count: 3,
    });

    expect(response.status).toBe(200);
    expect(serviceFns.batchCallNext).toHaveBeenLastCalledWith("rest-2", 3);

    response = await request("/batch-call", "POST", {});
    expect(response.status).toBe(400);
  });
});
