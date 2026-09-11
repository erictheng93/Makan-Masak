import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../../../middleware/auth";
import routes from "./index";
import { RealtimeEventType } from "@makanmasak/shared-types";
import { ApiError } from "@makanmasak/utils";

routes.onError((error, c) => {
  if (error instanceof ApiError) {
    // Mirrors app-factory's ApiError branch, `details` included: a service
    // failure that names the item and the shortfall is only worth
    // propagating if the envelope carries it all the way out.
    return c.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined && { details: error.details }),
        },
      },
      error.status as 400 | 401 | 403 | 404 | 409,
    );
  }

  return c.json({ success: false, error: { message: String(error) } }, 500);
});

const currentUser = vi.hoisted(() => ({
  value: {
    id: "user-10",
    username: "owner",
    role: 1,
    restaurantId: "restaurant-1",
  } as AuthUser,
}));
const listGroupOrders = vi.hoisted(() => vi.fn());
const createGroupOrder = vi.hoisted(() => vi.fn());
const joinGroup = vi.hoisted(() => vi.fn());
const previewGroupByShareCode = vi.hoisted(() => vi.fn());
const recoverHost = vi.hoisted(() => vi.fn());
const getStatistics = vi.hoisted(() => vi.fn());
const getGroupOrder = vi.hoisted(() => vi.fn());
const getGroupOrderStatus = vi.hoisted(() => vi.fn());
const addCartItem = vi.hoisted(() => vi.fn());
const updateCartItem = vi.hoisted(() => vi.fn());
const removeCartItem = vi.hoisted(() => vi.fn());
const splitBill = vi.hoisted(() => vi.fn());
const setSplitType = vi.hoisted(() => vi.fn());
const processPayment = vi.hoisted(() => vi.fn());
const leaveGroup = vi.hoisted(() => vi.fn());
const getActivities = vi.hoisted(() => vi.fn());
const cleanupExpiredGroups = vi.hoisted(() => vi.fn());
const isHostSession = vi.hoisted(() => vi.fn());
const isMemberSession = vi.hoisted(() => vi.fn());
const finalizeGroupOrder = vi.hoisted(() => vi.fn());
const recoverFinalization = vi.hoisted(() => vi.fn());
const meterEmit = vi.hoisted(() => vi.fn());
const broadcastEvent = vi.hoisted(() => vi.fn());
const generateEventId = vi.hoisted(() => vi.fn());

interface MockAuthContext {
  get(key: "user"): AuthUser;
  json(body: { success: false }, status: 403): Response;
}

vi.mock("../../../middleware/auth", () => ({
  authMiddleware: vi.fn(async (c, next) => {
    c.set("user", currentUser.value);
    await next();
  }),
  optionalAuth: vi.fn(async (c, next) => {
    c.set("user", currentUser.value);
    await next();
  }),
  requireRole: vi.fn(
    (allowedRoles: number[]) =>
      async (c: MockAuthContext, next: () => Promise<void>) => {
        if (!allowedRoles.includes(c.get("user").role)) {
          return c.json({ success: false }, 403);
        }
        await next();
      },
  ),
}));

vi.mock("../../../middleware/moduleGate", () => ({
  moduleGate: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("../../../middleware/quotaGate", () => ({
  quotaGate: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

vi.mock("../../../shared/utils/meter", () => ({
  meterEmit,
}));

vi.mock("../services/GroupOrdersService", () => ({
  GroupOrdersService: class {
    listGroupOrders = listGroupOrders;
    createGroupOrder = createGroupOrder;
    previewGroupByShareCode = previewGroupByShareCode;
    joinGroup = joinGroup;
    recoverHost = recoverHost;
    getStatistics = getStatistics;
    getGroupOrder = getGroupOrder;
    getGroupOrderStatus = getGroupOrderStatus;
    addCartItem = addCartItem;
    updateCartItem = updateCartItem;
    removeCartItem = removeCartItem;
    splitBill = splitBill;
    setSplitType = setSplitType;
    processPayment = processPayment;
    leaveGroup = leaveGroup;
    getActivities = getActivities;
    cleanupExpiredGroups = cleanupExpiredGroups;
    isHostSession = isHostSession;
    isMemberSession = isMemberSession;
    finalizeGroupOrder = finalizeGroupOrder;
    recoverFinalization = recoverFinalization;
  },
}));

vi.mock("@makanmasak/database", () => ({
  RealtimeBroadcastService: class {
    generateEventId = generateEventId;
    broadcastEvent = broadcastEvent;
  },
}));

const groupOrderId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";

function createEnv() {
  return {
    DB: {},
    CACHE_KV: {},
  };
}

function createRateLimitEnv() {
  const kv = new Map<string, string>();
  return {
    DB: {},
    CACHE_KV: {
      get: vi.fn(async (key: string) => kv.get(key) ?? null),
      put: vi.fn(
        async (
          key: string,
          value: string,
          _options?: { expirationTtl?: number },
        ) => {
          kv.set(key, value);
        },
      ),
      delete: vi.fn(async (key: string) => {
        kv.delete(key);
      }),
    },
  };
}

async function withSilencedRouteError<T>(
  action: () => T | Promise<T>,
): Promise<Awaited<T>> {
  const consoleError = vi
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    return await action();
  } finally {
    consoleError.mockRestore();
  }
}

describe("group orders routes", () => {
  beforeEach(() => {
    currentUser.value = {
      id: "user-10",
      username: "owner",
      role: 1,
      restaurantId: "restaurant-1",
    };
    listGroupOrders.mockReset();
    createGroupOrder.mockReset();
    joinGroup.mockReset();
    previewGroupByShareCode.mockReset();
    recoverHost.mockReset();
    getStatistics.mockReset();
    getGroupOrder.mockReset();
    getGroupOrderStatus.mockReset();
    addCartItem.mockReset();
    updateCartItem.mockReset();
    removeCartItem.mockReset();
    splitBill.mockReset();
    setSplitType.mockReset();
    processPayment.mockReset();
    leaveGroup.mockReset();
    getActivities.mockReset();
    cleanupExpiredGroups.mockReset();
    isHostSession.mockReset();
    isMemberSession.mockReset();
    finalizeGroupOrder.mockReset();
    recoverFinalization.mockReset();
    meterEmit.mockReset();
    meterEmit.mockResolvedValue(undefined);
    broadcastEvent.mockReset();
    broadcastEvent.mockResolvedValue(undefined);
    generateEventId.mockReset();
    generateEventId.mockReturnValue("evt-group-1");
  });

  it("lists and exports group orders for the owner restaurant", async () => {
    listGroupOrders.mockResolvedValue([
      {
        id: groupOrderId,
        shareCode: "ABC123",
        status: "active",
        hostName: "Ada",
        memberCount: 3,
        itemCount: 5,
        totalAmount: 880,
        createdAt: "2026-06-07T01:00:00.000Z",
      },
    ]);
    const env = createEnv();

    const listResponse = await routes.fetch(
      new Request("https://test/?status=active"),
      env as never,
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: groupOrderId, shareCode: "ABC123" }],
    });
    expect(listGroupOrders).toHaveBeenCalledWith("restaurant-1", "active");

    const exportResponse = await routes.fetch(
      new Request("https://test/export?restaurantId=restaurant-1"),
      env as never,
    );

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("Content-Type")).toBe("text/csv");
    const csv = await exportResponse.text();
    expect(csv).toContain(`${groupOrderId},active,Ada,3,5,880`);
    // share code 是還能用的憑證：拿到就能匿名加入並改動共用購物車，
    // 所以它不進匯出檔，連標題列都不留。
    expect(csv).not.toContain("ABC123");
    expect(csv).not.toContain("Share Code");
  });

  it("blocks owners from listing another restaurant's group orders", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/?restaurantId=restaurant-2"),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(403);
    expect(listGroupOrders).not.toHaveBeenCalled();
  });

  it("blocks owners from exporting another restaurant's group orders", async () => {
    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request("https://test/export?restaurantId=restaurant-2"),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(403);
    expect(listGroupOrders).not.toHaveBeenCalled();
  });

  // 開團會把 orders.created 記到 body 指定的那家店上。少了這道比對，A 店的
  // 員工可以拿 B 店的額度開團，在 enforce 模式下把 B 店推過硬上限。
  it.each<[string, number]>([
    ["owner", 1],
    ["chef", 2],
    ["service crew", 3],
    ["cashier", 4],
  ])(
    "blocks a %s from generating a share code for another restaurant",
    async (_label, role) => {
      currentUser.value = {
        id: "user-10",
        username: "staff",
        role,
        restaurantId: "restaurant-1",
      };

      const response = await withSilencedRouteError(() =>
        routes.fetch(
          new Request("https://test/generate-code", {
            method: "POST",
            body: JSON.stringify({ restaurantId: "restaurant-2" }),
          }),
          createEnv() as never,
        ),
      );

      expect(response.status).toBe(403);
      expect(createGroupOrder).not.toHaveBeenCalled();
      expect(meterEmit).not.toHaveBeenCalled();
    },
  );

  it("lets the platform admin generate a share code for any restaurant", async () => {
    currentUser.value = {
      id: "user-0",
      username: "admin",
      role: 0,
      restaurantId: "restaurant-1",
    };
    createGroupOrder.mockResolvedValue({
      success: true,
      data: {
        groupOrderId,
        shareCode: "ADMIN1",
        expiresAt: "2026-06-08T01:00:00.000Z",
        recoveryCode: "recovery-admin",
      },
    });

    const response = await routes.fetch(
      new Request("https://test/generate-code", {
        method: "POST",
        body: JSON.stringify({ restaurantId: "restaurant-2" }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(createGroupOrder).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: "restaurant-2" }),
      "user-0",
    );
    expect(meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "orders.created",
      expect.objectContaining({ restaurantId: "restaurant-2" }),
    );
  });

  it("generates share codes and creates group orders with metering and realtime events", async () => {
    createGroupOrder
      .mockResolvedValueOnce({
        success: true,
        data: {
          groupOrderId,
          shareCode: "ABC123",
          expiresAt: "2026-06-08T01:00:00.000Z",
          recoveryCode: "recovery-abc",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          groupOrderId,
          shareCode: "CREATE1",
          expiresAt: "2026-06-08T01:00:00.000Z",
        },
      });
    const env = createEnv();

    const generateResponse = await routes.fetch(
      new Request("https://test/generate-code", {
        method: "POST",
        body: JSON.stringify({ restaurantId: "restaurant-1" }),
      }),
      env as never,
    );

    expect(generateResponse.status).toBe(200);
    await expect(generateResponse.json()).resolves.toMatchObject({
      data: {
        shareCode: "ABC123",
        shareUrl: "/group/ABC123",
        // Same authenticated staff audience as POST /create. Dropping it here
        // left a staff-generated group with no way to hand host control to a
        // diner, and submitting is host-only.
        recoveryCode: "recovery-abc",
      },
    });
    expect(meterEmit).toHaveBeenCalledWith(
      expect.anything(),
      "orders.created",
      expect.objectContaining({ restaurantId: "restaurant-1" }),
    );

    const createResponse = await routes.fetch(
      new Request("https://test/create", {
        method: "POST",
        body: JSON.stringify({
          restaurantId: "restaurant-1",
          tableId: 7,
          hostName: "Ada",
        }),
      }),
      env as never,
    );

    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toMatchObject({
      data: { groupOrderId, shareCode: "CREATE1" },
    });
    expect(createGroupOrder).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        restaurantId: "restaurant-1",
        tableId: 7,
        hostName: "Ada",
      }),
      "user-10",
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      "customer",
      groupOrderId,
      expect.objectContaining({
        type: RealtimeEventType.GROUP_ORDER_CREATED,
        eventId: "evt-group-1",
      }),
    );
  });

  it("joins a group and broadcasts the joined member", async () => {
    joinGroup.mockResolvedValue({
      success: true,
      data: {
        groupOrder: { groupOrderId, restaurantId: "restaurant-1" },
        member: { id: memberId, memberName: "Ben" },
      },
    });

    const response = await routes.fetch(
      new Request("https://test/join/ABC123", {
        method: "POST",
        body: JSON.stringify({
          memberName: "Ben",
          phone: "+886912345678",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { member: { id: memberId, memberName: "Ben" } },
    });
    expect(joinGroup).toHaveBeenCalledWith("ABC123", {
      memberName: "Ben",
      phone: "+886912345678",
    });
    expect(broadcastEvent).toHaveBeenCalledWith(
      "customer",
      groupOrderId,
      expect.objectContaining({
        type: RealtimeEventType.GROUP_MEMBER_JOINED,
      }),
    );
  });

  it("rate limits public join previews and strict host recovery", async () => {
    previewGroupByShareCode.mockResolvedValue({
      found: true,
      data: {
        groupOrderId,
        restaurantId: "restaurant-1",
        hostName: "Ada",
        memberCount: 1,
        fulfillmentType: "dine_in",
        expiresAt: "2026-06-08T01:00:00.000Z",
        status: "active",
      },
    });
    recoverHost.mockResolvedValue({
      success: true,
      data: { memberToken: "new-session" },
    });
    const env = createRateLimitEnv();

    const previewResponse = await routes.fetch(
      new Request("https://test/join/ABC12345", {
        headers: { "cf-connecting-ip": "203.0.113.10" },
      }),
      env as never,
    );

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("X-RateLimit-Limit")).toBe("500");

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push(
        (
          await routes.fetch(
            new Request(`https://test/${groupOrderId}/recover`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "cf-connecting-ip": "203.0.113.11",
              },
              body: JSON.stringify({ recoveryCode: "correct-code" }),
            }),
            env as never,
          )
        ).status,
      );
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("returns statistics, details, activities, and cleanup responses", async () => {
    currentUser.value = {
      id: "user-1",
      username: "admin",
      role: 0,
      restaurantId: "admin",
    };
    getStatistics.mockResolvedValue({ totalGroups: 4, activeGroups: 2 });
    getGroupOrder.mockResolvedValue({
      groupOrderId,
      restaurantId: "restaurant-1",
      shareCode: "ABC123",
    });
    getActivities.mockResolvedValue([{ id: "act-1", type: "group_created" }]);
    cleanupExpiredGroups.mockResolvedValue({ cleaned: 3, errors: [] });
    const env = createEnv();

    const statsResponse = await routes.fetch(
      new Request(
        "https://test/statistics?restaurantId=restaurant-2&timeRange=week",
      ),
      env as never,
    );
    expect(statsResponse.status).toBe(200);
    await expect(statsResponse.json()).resolves.toMatchObject({
      data: { totalGroups: 4, activeGroups: 2 },
    });
    expect(getStatistics).toHaveBeenCalledWith("restaurant-2", "week");

    const detailResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}`),
      env as never,
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      data: { groupOrderId, shareCode: "ABC123" },
    });

    const activitiesResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/activities?limit=10`),
      env as never,
    );
    expect(activitiesResponse.status).toBe(200);
    await expect(activitiesResponse.json()).resolves.toMatchObject({
      data: [{ id: "act-1", type: "group_created" }],
    });

    const cleanupResponse = await routes.fetch(
      new Request("https://test/cleanup/expired", { method: "POST" }),
      env as never,
    );
    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toMatchObject({
      data: { cleaned: 3, errors: [] },
    });
  });

  it("locks group orders only for the creator member token", async () => {
    isHostSession.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    finalizeGroupOrder.mockResolvedValue({
      success: true,
      data: { masterOrderId: "order-1", status: "completed" },
    });
    const env = createRateLimitEnv();

    const lockResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/lock`, {
        method: "POST",
        body: JSON.stringify({ memberToken: "host-session" }),
      }),
      env as never,
    );

    expect(lockResponse.status).toBe(200);
    await expect(lockResponse.json()).resolves.toEqual({
      success: true,
      data: { masterOrderId: "order-1", status: "completed" },
    });
    expect(isHostSession).toHaveBeenCalledWith(groupOrderId, "host-session");
    expect(finalizeGroupOrder).toHaveBeenCalledWith(groupOrderId);

    const forbiddenResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(`https://test/${groupOrderId}/lock`, {
          method: "POST",
          body: JSON.stringify({ memberToken: "member-session" }),
        }),
        env as never,
      ),
    );

    expect(forbiddenResponse.status).toBe(403);
    expect(finalizeGroupOrder).toHaveBeenCalledTimes(1);
  });

  /**
   * The host's cart is the one place these codes can be acted on — a name and
   * a remaining count tell them what to remove (#359).
   */
  it("answers a lock with createOrder's own status, code and details", async () => {
    isHostSession.mockResolvedValue(true);
    finalizeGroupOrder.mockRejectedValue(
      new ApiError(
        "INSUFFICIENT_INVENTORY",
        "Insufficient inventory for 滷肉飯",
        409,
        { menuItemId: 7, name: "滷肉飯", requested: 3, available: 1 },
      ),
    );

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(`https://test/${groupOrderId}/lock`, {
          method: "POST",
          body: JSON.stringify({ memberToken: "host-session" }),
        }),
        createRateLimitEnv() as never,
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "INSUFFICIENT_INVENTORY",
          details: expect.objectContaining({ menuItemId: 7 }),
        }),
      }),
    );
  });

  it("lets an owner finalize an own-restaurant group without a diner token", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
    });
    finalizeGroupOrder.mockResolvedValue({
      success: true,
      data: { masterOrderId: "order-1", status: "completed" },
    });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/staff`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(finalizeGroupOrder).toHaveBeenCalledWith(groupOrderId);
    expect(isHostSession).not.toHaveBeenCalled();
  });

  it("blocks an owner from staff-finalizing another restaurant's group", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-2" },
    });

    const response = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(`https://test/${groupOrderId}/finalize/staff`, {
          method: "POST",
        }),
        createEnv() as never,
      ),
    );

    expect(response.status).toBe(403);
    expect(finalizeGroupOrder).not.toHaveBeenCalled();
  });

  it("lets admins and the owning restaurant recover but blocks other roles and restaurants", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
    });
    recoverFinalization.mockResolvedValue({
      success: true,
      data: { masterOrderId: "order-1", status: "checkout" },
    });
    const env = createEnv();

    currentUser.value = { ...currentUser.value, role: 0 };
    const recoveredResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
      }),
      env as never,
    );

    expect(recoveredResponse.status).toBe(200);
    expect(recoverFinalization).toHaveBeenCalledWith(groupOrderId);

    currentUser.value = { ...currentUser.value, role: 1 };
    const ownerResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
      }),
      env as never,
    );

    expect(ownerResponse.status).toBe(200);
    expect(recoverFinalization).toHaveBeenCalledTimes(2);

    currentUser.value = {
      ...currentUser.value,
      role: 1,
      restaurantId: "restaurant-2",
    };
    const otherRestaurantResponse = await withSilencedRouteError(() =>
      routes.fetch(
        new Request(`https://test/${groupOrderId}/finalize/recover`, {
          method: "POST",
        }),
        env as never,
      ),
    );

    expect(otherRestaurantResponse.status).toBe(403);
    expect(recoverFinalization).toHaveBeenCalledTimes(2);

    currentUser.value = { ...currentUser.value, role: 2 };
    const forbiddenResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
      }),
      env as never,
    );

    expect(forbiddenResponse.status).toBe(403);
    expect(recoverFinalization).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      "in progress",
      "Group order finalization recovery is already in progress",
      "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
    ],
    [
      "reclaimed",
      "Group order finalization recovery was reclaimed before it completed",
      "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED",
    ],
  ])(
    "returns a conflict when finalization recovery is %s",
    async (_outcome, error, errorCode) => {
      getGroupOrder.mockResolvedValue({
        groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
      });
      recoverFinalization.mockResolvedValue({
        success: false,
        error,
        errorCode,
      });

      const response = await routes.fetch(
        new Request(`https://test/${groupOrderId}/finalize/recover`, {
          method: "POST",
        }),
        createEnv() as never,
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: errorCode },
      });
    },
  );

  it("passes an optional bearer member to finalization recovery", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
    });
    recoverFinalization.mockResolvedValue({
      success: true,
      data: { masterOrderId: "order-1", status: "checkout" },
    });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
        body: JSON.stringify({ bearerMemberId: memberId }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(recoverFinalization).toHaveBeenCalledWith(groupOrderId, {
      bearerMemberId: memberId,
    });
  });

  it("rejects an invalid bearer member before recovery starts", async () => {
    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
        body: JSON.stringify({ bearerMemberId: "not-a-uuid" }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    expect(recoverFinalization).not.toHaveBeenCalled();
  });

  it.each([
    "finalizing",
    "finalizing_failed",
    "checkout",
    "completed",
    "cancelled",
  ] as const)("rejects split when the group is %s", async (status) => {
    getGroupOrderStatus.mockResolvedValue(status);
    isHostSession.mockResolvedValue(true);

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split`, {
        method: "POST",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GROUP_ORDER_SPLIT_NOT_ACTIVE" },
    });
    expect(splitBill).not.toHaveBeenCalled();
  });

  it.each([
    "finalizing",
    "finalizing_failed",
    "checkout",
    "completed",
    "cancelled",
  ] as const)(
    "rejects a split type change when the group is %s",
    async (status) => {
      getGroupOrderStatus.mockResolvedValue(status);
      isHostSession.mockResolvedValue(true);

      const response = await routes.fetch(
        new Request(`https://test/${groupOrderId}/split-type`, {
          method: "PUT",
          body: JSON.stringify({
            splitType: "equal",
            memberToken: "host-session",
          }),
        }),
        createEnv() as never,
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "GROUP_ORDER_SPLIT_TYPE_NOT_ACTIVE" },
      });
      expect(setSplitType).not.toHaveBeenCalled();
    },
  );

  it("updates the split type for an active group", async () => {
    getGroupOrderStatus.mockResolvedValue("active");
    isHostSession.mockResolvedValue(true);
    setSplitType.mockResolvedValue({
      success: true,
      data: { splitType: "equal" },
    });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split-type`, {
        method: "PUT",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    expect(setSplitType).toHaveBeenCalledWith(groupOrderId, "equal");
  });

  it("returns not found when splitting a group order that does not exist", async () => {
    getGroupOrderStatus.mockResolvedValue(null);
    isHostSession.mockResolvedValue(true);

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split`, {
        method: "POST",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      createEnv() as never,
    );

    // A missing group is 404, not the 409 an inactive one gets — otherwise a
    // typo in the id reads as "someone else is mid-checkout".
    expect(response.status).toBe(404);
    expect(splitBill).not.toHaveBeenCalled();
  });

  it("surfaces a split failure from an active group as a bad request", async () => {
    getGroupOrderStatus.mockResolvedValue("active");
    isHostSession.mockResolvedValue(true);
    splitBill.mockResolvedValue({
      success: false,
      error: "No active members found",
    });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split`, {
        method: "POST",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "No active members found" },
    });
  });

  it("names the conflict even when recovery reports no message", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
    });
    recoverFinalization.mockResolvedValue({
      success: false,
      errorCode: "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
    });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    // The code is what the admin panel branches on, so a missing message must
    // not turn the response body into `undefined`.
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
        message: "Finalization recovery cannot be completed",
      },
    });
  });

  it("falls back to a generic message when the split fails without one", async () => {
    getGroupOrderStatus.mockResolvedValue("active");
    isHostSession.mockResolvedValue(true);
    splitBill.mockResolvedValue({ success: false });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split`, {
        method: "POST",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Failed to split bill" },
    });
  });

  it("returns not found when recovering a group order that does not exist", async () => {
    getGroupOrder.mockResolvedValue(null);

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(404);
    expect(recoverFinalization).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when recovery fails without one", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
    });
    recoverFinalization.mockResolvedValue({ success: false });

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/finalize/recover`, {
        method: "POST",
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { message: "Failed to recover finalization" },
    });
  });

  it("rejects a split using fresh status when the cached summary is stale", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: {
        id: groupOrderId,
        restaurantId: "restaurant-1",
        status: "active",
      },
    });
    getGroupOrderStatus.mockResolvedValue("checkout");
    isHostSession.mockResolvedValue(true);

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split`, {
        method: "POST",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "GROUP_ORDER_SPLIT_NOT_ACTIVE" },
    });
    expect(getGroupOrderStatus).toHaveBeenCalledWith(groupOrderId);
    expect(getGroupOrder).not.toHaveBeenCalled();
    expect(splitBill).not.toHaveBeenCalled();
  });

  it("runs cart, split, payment, and leave workflows", async () => {
    getGroupOrderStatus.mockResolvedValue("active");
    getGroupOrder.mockResolvedValue({
      groupOrder: {
        id: groupOrderId,
        restaurantId: "restaurant-1",
        status: "active",
      },
    });
    addCartItem.mockResolvedValue({
      success: true,
      data: { id: itemId, menuItemId: 101, quantity: 2 },
    });
    updateCartItem.mockResolvedValue({
      success: true,
      data: { id: itemId, quantity: 3 },
    });
    removeCartItem.mockResolvedValue({ success: true });
    splitBill.mockResolvedValue({
      success: true,
      data: { splitType: "equal", perMemberAmount: 120 },
    });
    processPayment.mockResolvedValue({
      success: true,
      data: { memberId, paymentStatus: "paid" },
    });
    leaveGroup.mockResolvedValue({ success: true });
    isHostSession.mockResolvedValue(true);
    isMemberSession.mockResolvedValue(true);
    const env = createEnv();

    const addResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/cart`, {
        method: "POST",
        body: JSON.stringify({
          memberId,
          memberToken: "member-session",
          menuItemId: 101,
          quantity: 2,
          specialInstructions: "less ice",
        }),
      }),
      env as never,
    );
    expect(addResponse.status).toBe(200);
    await expect(addResponse.json()).resolves.toMatchObject({
      data: { id: itemId, quantity: 2 },
    });

    const updateResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/cart/${itemId}`, {
        method: "PUT",
        body: JSON.stringify({
          quantity: 3,
          memberId,
          memberToken: "member-session",
        }),
      }),
      env as never,
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      data: { id: itemId, quantity: 3 },
    });

    const removeResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/cart/${itemId}`, {
        method: "DELETE",
        body: JSON.stringify({ memberId, memberToken: "member-session" }),
      }),
      env as never,
    );
    expect(removeResponse.status).toBe(200);
    await expect(removeResponse.json()).resolves.toMatchObject({
      message: "Cart item removed successfully",
    });

    const splitResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/split`, {
        method: "POST",
        body: JSON.stringify({
          splitType: "equal",
          memberToken: "host-session",
        }),
      }),
      env as never,
    );
    expect(splitResponse.status).toBe(200);
    await expect(splitResponse.json()).resolves.toMatchObject({
      data: { splitType: "equal", perMemberAmount: 120 },
    });

    const paymentResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/payment/${memberId}`, {
        method: "POST",
        body: JSON.stringify({
          memberToken: "host-session",
          paymentMethod: "cash",
          amount: 120,
          transactionId: "txn-1",
        }),
      }),
      env as never,
    );
    expect(paymentResponse.status).toBe(200);
    await expect(paymentResponse.json()).resolves.toMatchObject({
      data: { memberId, paymentStatus: "paid" },
    });

    const leaveResponse = await routes.fetch(
      new Request(`https://test/${groupOrderId}/leave/${memberId}`, {
        method: "POST",
        body: JSON.stringify({ memberToken: "member-session" }),
      }),
      env as never,
    );
    expect(leaveResponse.status).toBe(200);
    await expect(leaveResponse.json()).resolves.toMatchObject({
      message: "Left group successfully",
    });

    expect(addCartItem).toHaveBeenCalledWith(
      groupOrderId,
      expect.objectContaining({ memberId, menuItemId: 101, quantity: 2 }),
    );
    expect(updateCartItem).toHaveBeenCalledWith(groupOrderId, itemId, {
      quantity: 3,
    });
    expect(removeCartItem).toHaveBeenCalledWith(groupOrderId, itemId, memberId);
    expect(splitBill).toHaveBeenCalledWith(groupOrderId, {
      splitType: "equal",
      serviceChargeRate: 0,
      taxRate: 0,
    });
    expect(isHostSession).toHaveBeenCalledWith(groupOrderId, "host-session");
    // The trust level comes from who authenticated, not from the body: every
    // caller this route accepts is someone at the table.
    expect(processPayment).toHaveBeenCalledWith(
      groupOrderId,
      memberId,
      expect.objectContaining({ paymentMethod: "cash", amount: 120 }),
      "self",
    );
    expect(isMemberSession).toHaveBeenCalledWith(
      groupOrderId,
      memberId,
      "member-session",
    );
    expect(leaveGroup).toHaveBeenCalledWith(groupOrderId, memberId);
    expect(broadcastEvent).toHaveBeenCalledWith(
      "customer",
      groupOrderId,
      expect.objectContaining({
        type: RealtimeEventType.GROUP_CART_ITEM_ADDED,
      }),
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      "customer",
      groupOrderId,
      expect.objectContaining({
        type: RealtimeEventType.GROUP_CART_ITEM_UPDATED,
      }),
    );
    expect(broadcastEvent).toHaveBeenCalledWith(
      "customer",
      groupOrderId,
      expect.objectContaining({
        type: RealtimeEventType.GROUP_CART_ITEM_REMOVED,
      }),
    );
  });

  it("keeps successful cart writes successful when realtime delivery fails", async () => {
    getGroupOrder.mockResolvedValue({
      groupOrder: { id: groupOrderId, restaurantId: "restaurant-1" },
    });
    addCartItem.mockResolvedValue({
      success: true,
      data: { id: itemId, menuItemId: 101, quantity: 2 },
    });
    broadcastEvent.mockRejectedValueOnce(new Error("realtime unavailable"));
    isMemberSession.mockResolvedValue(true);

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/cart`, {
        method: "POST",
        body: JSON.stringify({
          memberId,
          memberToken: "member-session",
          menuItemId: 101,
          quantity: 2,
        }),
      }),
      createEnv() as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: itemId, quantity: 2 },
    });
    expect(addCartItem).toHaveBeenCalledWith(
      groupOrderId,
      expect.objectContaining({ memberId, menuItemId: 101, quantity: 2 }),
    );
    expect(broadcastEvent).toHaveBeenCalledOnce();
  });

  /**
   * The list route resolves its tenant as `restaurantId || user.restaurantId`,
   * so it is always scoped. The statistics route passes the query parameter
   * straight through, and the schema turns a missing one into `undefined` —
   * which `getStatistics` reads as "no restaurant filter", i.e. every
   * restaurant on the platform.
   *
   * The owner guard does not catch this: it reads
   * `user.role === 1 && restaurantId && ...`, so omitting the parameter
   * short-circuits it. An owner who simply leaves it out is handed
   * platform-wide order counts, group sizes, and average order value.
   *
   * These pin the rule: the route resolves a tenant for every caller, exactly
   * as the list route does, so no request reaches `getStatistics` without one.
   * The unscoped view has no caller — the only consumer is the admin
   * dashboard, which always asks about one restaurant — so nothing is left
   * able to request it.
   */
  describe("GET /statistics tenant scoping", () => {
    it("scopes an owner to their own restaurant when the query omits one", async () => {
      currentUser.value = {
        id: "user-10",
        username: "owner",
        role: 1,
        restaurantId: "restaurant-1",
      };
      getStatistics.mockResolvedValue({ totalGroupOrders: 0 });

      const response = await routes.fetch(
        new Request("https://test/statistics?timeRange=week"),
        createEnv() as never,
      );

      expect(response.status).toBe(200);
      expect(getStatistics).toHaveBeenCalledWith("restaurant-1", "week");
    });

    it("still refuses an owner who names someone else's restaurant", async () => {
      currentUser.value = {
        id: "user-10",
        username: "owner",
        role: 1,
        restaurantId: "restaurant-1",
      };
      getStatistics.mockResolvedValue({ totalGroupOrders: 0 });

      const response = await withSilencedRouteError(() =>
        routes.fetch(
          new Request("https://test/statistics?restaurantId=restaurant-2"),
          createEnv() as never,
        ),
      );

      expect(response.status).toBe(403);
      expect(getStatistics).not.toHaveBeenCalled();
    });

    it("scopes a platform admin to the restaurant they asked about", async () => {
      currentUser.value = {
        id: "user-1",
        username: "admin",
        role: 0,
        restaurantId: "admin",
      };
      getStatistics.mockResolvedValue({ totalGroupOrders: 12 });

      const response = await routes.fetch(
        new Request("https://test/statistics?restaurantId=restaurant-2"),
        createEnv() as never,
      );

      expect(response.status).toBe(200);
      expect(getStatistics).toHaveBeenCalledWith("restaurant-2", "month");
    });

    it("never asks the service for every restaurant at once", async () => {
      // Role 0 has no restaurant of its own to fall back to, so this is the
      // caller most likely to slip through as an unscoped query.
      currentUser.value = {
        id: "user-1",
        username: "admin",
        role: 0,
        restaurantId: "admin",
      };
      getStatistics.mockResolvedValue({ totalGroupOrders: 0 });

      await routes.fetch(
        new Request("https://test/statistics?timeRange=week"),
        createEnv() as never,
      );

      expect(getStatistics).toHaveBeenCalledOnce();
      expect(getStatistics.mock.calls[0][0]).toBeTruthy();
    });
  });
  // The column exists to say whose word a settlement is. If a diner could set
  // it, it would say nothing: anyone could label their own claim as a
  // restaurant confirmation and have it counted as takings later.
  it("ignores a settledBy claimed in the request body", async () => {
    const groupOrderId = "018ffb9a-7b8a-7c3d-9f23-000000000001";
    const memberId = "018ffb9a-7b8a-7c3d-9f23-000000000002";
    isMemberSession.mockResolvedValue(true);
    isHostSession.mockResolvedValue(false);
    processPayment.mockResolvedValue({ success: true, data: {} });
    const env = createEnv();

    const response = await routes.fetch(
      new Request(`https://test/${groupOrderId}/payment/${memberId}`, {
        method: "POST",
        body: JSON.stringify({
          memberToken: "member-session",
          paymentMethod: "cash",
          settledBy: "staff",
        }),
      }),
      env as never,
    );

    expect(response.status).toBe(200);
    expect(processPayment).toHaveBeenCalledWith(
      groupOrderId,
      memberId,
      expect.not.objectContaining({ settledBy: "staff" }),
      "self",
    );
  });
});
