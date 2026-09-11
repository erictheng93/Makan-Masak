/**
 * Group Orders Routes
 * HTTP routes for group ordering functionality
 */

import { Hono } from "hono";
import {
  authMiddleware,
  optionalAuth,
  requireRole,
} from "../../../middleware/auth";
import { moduleGate } from "../../../middleware/moduleGate";
import { quotaGate } from "../../../middleware/quotaGate";
import {
  publicRateLimit,
  strictRateLimit,
} from "../../../middleware/rateLimit";
import { meterEmit } from "../../../shared/utils/meter";
import { toCsvRow } from "../../../shared/utils/csv";
import {
  validateBody,
  validateOptionalBody,
  validateQuery,
  validateParams,
} from "../../../middleware/validation";
import { GroupOrdersService } from "../services/GroupOrdersService";
import { groupOrderSchemas } from "../schemas/validation";
import type { Env } from "../../../types/env";
import { RealtimeBroadcastService } from "@makanmasak/database";
import {
  isValidRealtimeEvent,
  RealtimeEventType,
} from "@makanmasak/shared-types";
import type { GroupOrderEvent } from "@makanmasak/shared-types";
import {
  notFound,
  forbidden,
  badRequest,
  conflict,
} from "../../../shared/utils/api-error";

const app = new Hono<{ Bindings: Env }>();

type GroupOrderRealtimePayload = Record<string, unknown> & {
  groupOrderId?: string;
  restaurantId?: string;
};

async function broadcastGroupOrderEvent(
  env: Env,
  eventType: GroupOrderEvent["type"],
  payload: GroupOrderRealtimePayload,
): Promise<void> {
  const groupOrderId = requireNonEmptyString(
    payload.groupOrderId,
    "groupOrderId",
  );
  const restaurantId = requireNonEmptyString(
    payload.restaurantId,
    "restaurantId",
  );

  const broadcaster = new RealtimeBroadcastService(env);
  const event: GroupOrderEvent = {
    type: eventType,
    eventId: broadcaster.generateEventId(),
    timestamp: Date.now(),
    restaurantId,
    data: { ...payload, groupOrderId, restaurantId },
  };

  if (!isValidRealtimeEvent(event)) {
    throw new Error(`Invalid realtime event produced for ${eventType}`);
  }

  // Clients join a group order through the `customer:{groupOrderId}` room
  // (see apps/customer-app useGroupOrder). Broadcasting to a `group_order`
  // room nobody connects to dropped every event (bug-inventory #2).
  try {
    await broadcaster.broadcastEvent("customer", groupOrderId, event);
  } catch (broadcastError) {
    console.warn(`Failed to broadcast ${eventType}:`, broadcastError);
  }
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Cannot broadcast group order event without ${field}`);
  }
  return value;
}

async function resolveRestaurantIdFromJsonBody(c: {
  req: { raw: Request };
}): Promise<string | undefined> {
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => {
      throw badRequest("Invalid JSON body", "INVALID_JSON");
    });
  if (!body || typeof body !== "object") return undefined;
  const restaurantId = (body as Record<string, unknown>).restaurantId;
  return typeof restaurantId === "string" || typeof restaurantId === "number"
    ? String(restaurantId)
    : undefined;
}

async function resolveGroupOrderRestaurantId(
  groupOrderService: GroupOrdersService,
  groupOrderId: string,
): Promise<string> {
  const summary = await groupOrderService.getGroupOrder(groupOrderId);
  const restaurantId =
    summary?.groupOrder?.restaurantId ??
    (
      summary as
        | {
            data?: { groupOrder?: { restaurantId?: unknown } };
          }
        | undefined
    )?.data?.groupOrder?.restaurantId;

  return requireNonEmptyString(restaurantId, "restaurantId");
}

async function resolveCartMutationRestaurantId(
  groupOrderService: GroupOrdersService,
  groupOrderId: string,
  result: { success: boolean; restaurantId?: unknown },
): Promise<string> {
  if (typeof result.restaurantId === "string") {
    return requireNonEmptyString(result.restaurantId, "restaurantId");
  }
  return resolveGroupOrderRestaurantId(groupOrderService, groupOrderId);
}

function requireMemberToken(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw forbidden("Access denied");
  }
  return value;
}

async function readMemberTokenFromBody(c: {
  req: { json: () => Promise<unknown> };
}): Promise<string> {
  const body = await c.req.json().catch(() => undefined);
  const token =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).memberToken
      : undefined;
  return requireMemberToken(token);
}

async function requireHostSession(
  groupOrderService: GroupOrdersService,
  groupOrderId: string,
  memberToken: unknown,
): Promise<void> {
  const token = requireMemberToken(memberToken);
  const isHost = await groupOrderService.isHostSession(groupOrderId, token);
  if (!isHost) {
    throw forbidden("Access denied");
  }
}

async function requireMemberOrHostSession(
  groupOrderService: GroupOrdersService,
  groupOrderId: string,
  memberId: string,
  memberToken: unknown,
): Promise<void> {
  const token = requireMemberToken(memberToken);
  const [isMember, isHost] = await Promise.all([
    groupOrderService.isMemberSession(groupOrderId, memberId, token),
    groupOrderService.isHostSession(groupOrderId, token),
  ]);
  if (!isMember && !isHost) {
    throw forbidden("Access denied");
  }
}

/**
 * Cart writes name the member they belong to, and that name decides who pays
 * for the dish. So the caller has to be that member — the host gets no bypass
 * here, because a host acting under someone else's name would falsify the
 * same thing. Which items a member may touch is a separate question: the cart
 * is shared, so any member may change or remove any item.
 */
async function requireMemberIdentity(
  groupOrderService: GroupOrdersService,
  groupOrderId: string,
  memberId: unknown,
  memberToken: unknown,
): Promise<void> {
  const token = requireMemberToken(memberToken);
  if (typeof memberId !== "string" || memberId.length === 0) {
    throw forbidden("Access denied");
  }
  const isMember = await groupOrderService.isMemberSession(
    groupOrderId,
    memberId,
    token,
  );
  if (!isMember) {
    throw forbidden("Access denied");
  }
}

/**
 * List group orders
 * GET /api/v1/orders/group
 */
app.get(
  "/",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner
  moduleGate("online_ordering"),
  async (c) => {
    const restaurantId = c.req.query("restaurantId");
    const status = c.req.query("status");
    const user = c.get("user");

    const targetRestaurantId = restaurantId || String(user.restaurantId);

    // Permission check for owners
    if (
      user.role === 1 &&
      restaurantId &&
      String(user.restaurantId) !== String(restaurantId)
    ) {
      throw forbidden("Access denied: can only view own restaurant orders");
    }

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const orders = await groupOrderService.listGroupOrders(
      targetRestaurantId,
      status || undefined,
    );

    return c.json({
      success: true,
      data: orders,
    });
  },
);

/**
 * Generate share code (creates a group order and returns the share code)
 * POST /api/v1/orders/group/generate-code
 */
app.post(
  "/generate-code",
  authMiddleware,
  requireRole([0, 1, 2, 3, 4]),
  moduleGate("online_ordering"),
  quotaGate("orders.created"),
  async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const user = c.get("user");
    const rawRestaurantId = (body as { restaurantId?: unknown } | null)
      ?.restaurantId;
    const requestedRestaurantId =
      typeof rawRestaurantId === "string" || typeof rawRestaurantId === "number"
        ? String(rawRestaurantId)
        : undefined;

    // 這條路開給角色 0-4，而 body 的 restaurantId 從來沒有跟呼叫者自己的店比對過。
    // 少了這道比對，A 店的員工可以替 B 店開團：orders.created 記到 B 店的用量上，
    // 在 QUOTA_ENFORCEMENT_MODE=enforce 之下把 B 店推過硬上限，B 店真正的
    // POST /orders 就開始回 429。只有平台管理員（角色 0）可以指定別家店。
    if (
      user.role !== 0 &&
      requestedRestaurantId &&
      String(user.restaurantId) !== requestedRestaurantId
    ) {
      throw forbidden(
        "Access denied: can only create group orders for own restaurant",
      );
    }

    const restaurantId = requestedRestaurantId || String(user.restaurantId);

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const result = await groupOrderService.createGroupOrder(
      { restaurantId },
      user.id,
    );

    if (!result.success || !result.data) {
      throw badRequest(result.error ?? "Failed to generate share code");
    }
    await meterEmit(c, "orders.created", { restaurantId });

    return c.json({
      success: true,
      data: {
        shareCode: result.data.shareCode,
        shareUrl: `/group/${result.data.shareCode}`,
        expiresAt: result.data.expiresAt,
        // Same authenticated staff audience as POST /create, which does return
        // this. Filtering it out here left the group with no reachable host:
        // submitting and choosing the expiry behaviour are both host-only.
        recoveryCode: result.data.recoveryCode,
      },
    });
  },
);

/**
 * Export group orders
 * GET /api/v1/orders/group/export
 */
app.get(
  "/export",
  authMiddleware,
  requireRole([0, 1]),
  moduleGate("online_ordering"),
  async (c) => {
    const restaurantId = c.req.query("restaurantId");
    const status = c.req.query("status");
    const user = c.get("user");

    // 同 GET / 與 GET /statistics：查詢字串的 restaurantId 必須是自己的店，
    // 否則店主可以匯出別家店的進行中團購（含主揪、金額）。
    if (
      user.role === 1 &&
      restaurantId &&
      String(user.restaurantId) !== String(restaurantId)
    ) {
      throw forbidden("Access denied: can only export own restaurant orders");
    }

    const targetRestaurantId = restaurantId || String(user.restaurantId);

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const orders = await groupOrderService.listGroupOrders(
      targetRestaurantId,
      status || undefined,
    );

    // Generate CSV
    //
    // shareCode 不進報表：它是還能用的憑證，不是欄位。任何人拿到進行中團購的
    // share code 就能匿名加入並改動共用購物車，所以匯出檔一旦外流（信箱、
    // 試算表、雲端硬碟）等於把那些團的控制權一起送出去。
    const headers = [
      "ID",
      "Status",
      "Host",
      "Members",
      "Items",
      "Total Amount",
      "Created At",
    ];
    const csvRows = [toCsvRow(headers)];
    for (const order of orders) {
      csvRows.push(
        toCsvRow([
          order.id,
          order.status,
          order.hostName,
          order.memberCount,
          order.itemCount,
          order.totalAmount,
          order.createdAt,
        ]),
      );
    }

    return new Response(csvRows.join("\n"), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="group-orders-export.csv"',
      },
    });
  },
);

/**
 * Create group order
 * POST /api/v1/orders/group/create
 */
app.post(
  "/create",
  optionalAuth,
  moduleGate("online_ordering", resolveRestaurantIdFromJsonBody),
  quotaGate("orders.created", resolveRestaurantIdFromJsonBody),
  validateBody(groupOrderSchemas.createGroupOrder),
  async (c) => {
    const data = c.get("validatedBody");
    const user = c.get("user");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const result = await groupOrderService.createGroupOrder(
      data,
      user?.id ?? null,
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to create group order");
    }
    await meterEmit(c, "orders.created", {
      restaurantId: data.restaurantId,
    });

    await broadcastGroupOrderEvent(
      c.env,
      RealtimeEventType.GROUP_ORDER_CREATED,
      {
        groupOrderId: result.data?.groupOrderId,
        restaurantId: data.restaurantId,
        tableId: data.tableId,
        shareCode: result.data?.shareCode,
      },
    );

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Preview a group order before joining (no side effects)
 * GET /api/v1/orders/group/join/{shareCode}
 */
app.get(
  "/join/:shareCode",
  publicRateLimit,
  validateParams(groupOrderSchemas.shareCodeParam),
  async (c) => {
    const { shareCode } = c.get("validatedParams");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const result = await groupOrderService.previewGroupByShareCode(shareCode);

    if (!result.found) {
      throw notFound(
        "Group order not found or expired",
        "GROUP_ORDER_NOT_FOUND",
      );
    }

    return c.json({ success: true, data: result.data });
  },
);

/**
 * Join group order
 * POST /api/v1/orders/group/join/{shareCode}
 */
app.post(
  "/join/:shareCode",
  validateParams(groupOrderSchemas.shareCodeParam),
  validateBody(groupOrderSchemas.joinGroup),
  async (c) => {
    const { shareCode } = c.get("validatedParams");
    const memberData = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const result = await groupOrderService.joinGroup(shareCode, memberData);

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to join group");
    }

    await broadcastGroupOrderEvent(
      c.env,
      RealtimeEventType.GROUP_MEMBER_JOINED,
      {
        groupOrderId: result.data?.groupOrder.groupOrderId,
        restaurantId: result.data?.groupOrder.restaurantId,
        member: result.data?.member,
      },
    );

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Recover host control of a group order using the recovery code
 * POST /api/v1/orders/group/{groupOrderId}/recover
 */
app.post(
  "/:groupOrderId/recover",
  strictRateLimit,
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.recoverHost),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { recoveryCode } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const result = await groupOrderService.recoverHost(
      groupOrderId,
      recoveryCode,
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to recover host session");
    }

    return c.json({ success: true, data: result.data });
  },
);

/**
 * Choose how the bill will be divided at finalize
 * PUT /api/v1/orders/group/{groupOrderId}/split-type
 *
 * Host only, and deliberately separate from POST /split: that one performs the
 * split. This only records the choice used later by finalization.
 */
app.put(
  "/:groupOrderId/split-type",
  publicRateLimit,
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.splitTypePreference),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { splitType, memberToken } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireHostSession(groupOrderService, groupOrderId, memberToken);
    const status = await groupOrderService.getGroupOrderStatus(groupOrderId);

    if (!status) {
      throw notFound("Group order not found");
    }
    if (status !== "active") {
      throw conflict(
        "Only active group orders can change split type",
        "GROUP_ORDER_SPLIT_TYPE_NOT_ACTIVE",
      );
    }

    const result = await groupOrderService.setSplitType(
      groupOrderId,
      splitType,
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to update split type");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Choose who carries the service charge and tax
 * PUT /api/v1/orders/group/{groupOrderId}/fee-mode
 *
 * Host only, and a preference like /split-type — it records the choice the
 * split will use, it does not perform one.
 */
app.put(
  "/:groupOrderId/fee-mode",
  publicRateLimit,
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.feeModePreference),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { feeMode, memberToken } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireHostSession(groupOrderService, groupOrderId, memberToken);

    const result = await groupOrderService.setFeeMode(groupOrderId, feeMode);

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to update fee mode");
    }

    return c.json({ success: true, data: result.data });
  },
);

/**
 * Turn expiry auto-submit on or off
 * PUT /api/v1/orders/group/{groupOrderId}/auto-submit
 *
 * Host only. Whether an unattended table ends up with a real order is the same
 * kind of decision as pressing submit, so it belongs to whoever owns the group.
 */
app.put(
  "/:groupOrderId/auto-submit",
  publicRateLimit,
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.autoSubmitOnExpiry),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { enabled, memberToken } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireHostSession(groupOrderService, groupOrderId, memberToken);

    const result = await groupOrderService.setAutoSubmitOnExpiry(
      groupOrderId,
      enabled,
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to update auto-submit setting");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Lock and finalize a group order
 * POST /api/v1/orders/group/{groupOrderId}/lock
 */
app.post(
  "/:groupOrderId/lock",
  publicRateLimit,
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.lockGroupOrder),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { memberToken } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const isHost = await groupOrderService.isHostSession(
      groupOrderId,
      memberToken,
    );

    if (!isHost) {
      throw forbidden("Only the group host can lock this order");
    }

    const result = await groupOrderService.finalizeGroupOrder(groupOrderId);

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to finalize group order");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Finalize a group order from the authenticated back office.
 *
 * This intentionally does not accept a diner member token: staff-created
 * groups do not have a browser-held host credential. The usual public host
 * route above remains the only route available to diners.
 */
app.post(
  "/:groupOrderId/finalize/staff",
  authMiddleware,
  requireRole([0, 1]),
  moduleGate("online_ordering"),
  validateParams(groupOrderSchemas.groupOrderIdParam),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const user = c.get("user");
    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const summary = await groupOrderService.getGroupOrder(groupOrderId);

    if (!summary) {
      throw notFound("Group order not found");
    }
    if (
      user.role === 1 &&
      String(summary.groupOrder.restaurantId) !== String(user.restaurantId)
    ) {
      throw forbidden("Access denied: can only finalize own restaurant orders");
    }

    const result = await groupOrderService.finalizeGroupOrder(groupOrderId);
    if (!result.success) {
      throw badRequest(result.error ?? "Failed to finalize group order");
    }
    return c.json({ success: true, data: result.data });
  },
);

/**
 * Recover a split that failed after the real order was created.
 * POST /api/v1/orders/group/{groupOrderId}/finalize/recover
 */
app.post(
  "/:groupOrderId/finalize/recover",
  authMiddleware,
  requireRole([0, 1]),
  moduleGate("online_ordering"),
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateOptionalBody(groupOrderSchemas.recoverFinalization),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { bearerMemberId } = c.get("validatedBody");
    const user = c.get("user");
    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const summary = await groupOrderService.getGroupOrder(groupOrderId);

    if (!summary) {
      throw notFound("Group order not found");
    }
    if (
      user.role === 1 &&
      String(summary.groupOrder.restaurantId) !== String(user.restaurantId)
    ) {
      throw forbidden("Access denied: can only recover own restaurant orders");
    }

    const result = bearerMemberId
      ? await groupOrderService.recoverFinalization(groupOrderId, {
          bearerMemberId,
        })
      : await groupOrderService.recoverFinalization(groupOrderId);
    if (!result.success) {
      if (
        result.errorCode === "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS" ||
        result.errorCode === "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED"
      ) {
        throw conflict(
          result.error ?? "Finalization recovery cannot be completed",
          result.errorCode,
        );
      }
      throw badRequest(result.error ?? "Failed to recover finalization");
    }

    return c.json({ success: true, data: result.data });
  },
);

/**
 * Get group order statistics
 * GET /api/v1/orders/group/statistics
 * NOTE: This route MUST be defined BEFORE /:groupOrderId to avoid matching 'statistics' as a groupOrderId
 */
app.get(
  "/statistics",
  authMiddleware,
  requireRole([0, 1]), // Admin or Owner
  moduleGate("online_ordering"),
  validateQuery(groupOrderSchemas.statisticsQuery),
  async (c) => {
    const { restaurantId, timeRange } = c.get("validatedQuery");
    const user = c.get("user");

    // Permission check for owners
    if (
      user.role === 1 &&
      restaurantId &&
      String(user.restaurantId) !== String(restaurantId)
    ) {
      throw forbidden("Access denied: can only view own restaurant statistics");
    }

    // `getStatistics` treats an undefined restaurant as "every restaurant on
    // the platform", and the query parameter is optional — so passing it
    // straight through hands anyone who simply omits it another tenant's order
    // counts and average order value. Resolve the tenant the same way the list
    // route above does, so the two can never disagree about whose data this is.
    const targetRestaurantId = restaurantId || String(user.restaurantId);

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const statistics = await groupOrderService.getStatistics(
      targetRestaurantId,
      timeRange,
    );

    return c.json({
      success: true,
      data: statistics,
    });
  },
);

/**
 * Get group order details
 * GET /api/v1/orders/group/{groupOrderId}
 */
app.get(
  "/:groupOrderId",
  validateParams(groupOrderSchemas.groupOrderIdParam),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const groupOrder = await groupOrderService.getGroupOrder(groupOrderId);

    if (!groupOrder) {
      throw notFound("Group order not found");
    }

    return c.json({
      success: true,
      data: groupOrder,
    });
  },
);

/**
 * Add cart item
 * POST /api/v1/orders/group/{groupOrderId}/cart
 */
app.post(
  "/:groupOrderId/cart",
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.addCartItem),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { memberToken, ...itemData } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireMemberIdentity(
      groupOrderService,
      groupOrderId,
      itemData.memberId,
      memberToken,
    );
    const result = await groupOrderService.addCartItem(groupOrderId, itemData);

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to add cart item");
    }

    await broadcastGroupOrderEvent(
      c.env,
      RealtimeEventType.GROUP_CART_ITEM_ADDED,
      {
        groupOrderId,
        restaurantId: await resolveCartMutationRestaurantId(
          groupOrderService,
          groupOrderId,
          result,
        ),
        action: "added",
        item: result.data,
      },
    );

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Update cart item
 * PUT /api/v1/orders/group/{groupOrderId}/cart/{itemId}
 */
app.put(
  "/:groupOrderId/cart/:itemId",
  validateParams(
    groupOrderSchemas.groupOrderIdParam.merge(groupOrderSchemas.itemIdParam),
  ),
  validateBody(groupOrderSchemas.updateCartItem),
  async (c) => {
    const { groupOrderId, itemId } = c.get("validatedParams");
    const { memberId, memberToken, ...updateData } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireMemberIdentity(
      groupOrderService,
      groupOrderId,
      memberId,
      memberToken,
    );
    const result = await groupOrderService.updateCartItem(
      groupOrderId,
      itemId,
      updateData,
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to update cart item");
    }

    await broadcastGroupOrderEvent(
      c.env,
      RealtimeEventType.GROUP_CART_ITEM_UPDATED,
      {
        groupOrderId,
        restaurantId: await resolveCartMutationRestaurantId(
          groupOrderService,
          groupOrderId,
          result,
        ),
        action: "updated",
        item: result.data,
      },
    );

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Remove cart item
 * DELETE /api/v1/orders/group/{groupOrderId}/cart/{itemId}
 */
app.delete(
  "/:groupOrderId/cart/:itemId",
  validateParams(
    groupOrderSchemas.groupOrderIdParam.merge(groupOrderSchemas.itemIdParam),
  ),
  validateBody(groupOrderSchemas.removeCartItem),
  async (c) => {
    const { groupOrderId, itemId } = c.get("validatedParams");
    const { memberId, memberToken } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireMemberIdentity(
      groupOrderService,
      groupOrderId,
      memberId,
      memberToken,
    );
    const result = await groupOrderService.removeCartItem(
      groupOrderId,
      itemId,
      memberId,
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to remove cart item");
    }

    await broadcastGroupOrderEvent(
      c.env,
      RealtimeEventType.GROUP_CART_ITEM_REMOVED,
      {
        groupOrderId,
        restaurantId: await resolveCartMutationRestaurantId(
          groupOrderService,
          groupOrderId,
          result,
        ),
        action: "removed",
        itemId,
      },
    );

    return c.json({
      success: true,
      message: "Cart item removed successfully",
    });
  },
);

/**
 * Split bill
 * POST /api/v1/orders/group/{groupOrderId}/split
 *
 * No customer client calls this endpoint. Finalization owns the live split
 * after locking the order; active-only prevents a host from overwriting those
 * finalized bills with stale client-side rates.
 */
app.post(
  "/:groupOrderId/split",
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateBody(groupOrderSchemas.splitBill),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");
    const { memberToken, ...splitData } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireHostSession(groupOrderService, groupOrderId, memberToken);
    const status = await groupOrderService.getGroupOrderStatus(groupOrderId);

    if (!status) {
      throw notFound("Group order not found");
    }
    if (status !== "active") {
      throw conflict(
        "Only active group orders can be split",
        "GROUP_ORDER_SPLIT_NOT_ACTIVE",
      );
    }

    const result = await groupOrderService.splitBill(groupOrderId, splitData);

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to split bill");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Process payment
 * POST /api/v1/orders/group/{groupOrderId}/payment/{memberId}
 */
app.post(
  "/:groupOrderId/payment/:memberId",
  validateParams(
    groupOrderSchemas.groupOrderIdParam.merge(groupOrderSchemas.memberIdParam),
  ),
  validateBody(groupOrderSchemas.processPayment),
  async (c) => {
    const { groupOrderId, memberId } = c.get("validatedParams");
    const { memberToken, ...paymentData } = c.get("validatedBody");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    // Each diner settles their own share, which is the whole point of
    // splitting; the host may also settle for someone whose phone died.
    // Neither can settle in a way that changes what anyone owes — the amount
    // is checked against the split bill the server already wrote.
    await requireMemberOrHostSession(
      groupOrderService,
      groupOrderId,
      memberId,
      memberToken,
    );
    // Always "self": every caller this route accepts is someone at the table.
    // A staff or provider confirmation would come through its own
    // authenticated path, never from a body field a diner can set.
    const result = await groupOrderService.processPayment(
      groupOrderId,
      memberId,
      paymentData,
      "self",
    );

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to process payment");
    }

    return c.json({
      success: true,
      data: result.data,
    });
  },
);

/**
 * Leave group
 * POST /api/v1/orders/group/{groupOrderId}/leave/{memberId}
 */
app.post(
  "/:groupOrderId/leave/:memberId",
  validateParams(
    groupOrderSchemas.groupOrderIdParam.merge(groupOrderSchemas.memberIdParam),
  ),
  async (c) => {
    const { groupOrderId, memberId } = c.get("validatedParams");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    await requireMemberOrHostSession(
      groupOrderService,
      groupOrderId,
      memberId,
      await readMemberTokenFromBody(c),
    );
    const result = await groupOrderService.leaveGroup(groupOrderId, memberId);

    if (!result.success) {
      throw badRequest(result.error ?? "Failed to leave group");
    }

    return c.json({
      success: true,
      message: "Left group successfully",
    });
  },
);

/**
 * Get group activities
 * GET /api/v1/orders/group/{groupOrderId}/activities
 */
app.get(
  "/:groupOrderId/activities",
  validateParams(groupOrderSchemas.groupOrderIdParam),
  validateQuery(groupOrderSchemas.activitiesQuery),
  async (c) => {
    const { groupOrderId } = c.get("validatedParams");

    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const activities = await groupOrderService.getActivities(groupOrderId);

    return c.json({
      success: true,
      data: activities,
    });
  },
);

/**
 * Cleanup expired groups
 * POST /api/v1/orders/group/cleanup/expired
 */
app.post(
  "/cleanup/expired",
  authMiddleware,
  requireRole([0]), // Admin only
  moduleGate("online_ordering"),
  async (c) => {
    const groupOrderService = new GroupOrdersService(c.env.DB, c.env.CACHE_KV);
    const result = await groupOrderService.cleanupExpiredGroups();

    return c.json({
      success: true,
      data: {
        cleaned: result.cleaned,
        errors: result.errors,
      },
    });
  },
);

export default app;
