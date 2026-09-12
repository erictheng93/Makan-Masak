/**
 * Group Orders Service
 * Business logic for group ordering functionality
 *
 * Migrated to Drizzle ORM from raw D1 SQL
 */

import { randomUUID } from "crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { drizzle } from "drizzle-orm/d1";
import {
  eq,
  and,
  sql,
  count,
  desc,
  asc,
  isNull,
  gte,
  inArray,
} from "drizzle-orm";
import {
  groupOrders,
  groupMembers,
  groupCartItems,
  splitBills,
  groupActivityLogs,
  orders,
  restaurants,
  OrderService as DatabaseOrderService,
} from "@makanmasak/database";
import { menuItems } from "@makanmasak/database";
import type { SettledBy } from "@makanmasak/database";
import { isRevenueRecognisedSettlement } from "@makanmasak/database";
import type {
  CartItemCustomizations,
  GroupActivityMetadata,
  GroupOrderFeeMode,
  GroupOrderFinalizeFailure,
  GroupOrderSettings,
  SplitBillItem,
} from "@makanmasak/shared-types";
import { ApiError } from "../../../shared/utils/api-error";
import { fromCents, toRequiredCents } from "../../../shared/utils/money";

class ConsoleLogger {
  constructor(
    private context: string,
    private level: string = "info",
  ) {}
  info(message: string, data?: unknown) {
    console.log(`[${this.context}] ${message}`, data);
  }
  error(message: string, error: unknown) {
    console.error(`[${this.context}] ${message}`, error);
  }
}

class KVCacheService {
  constructor(private kv?: KVNamespace) {}
  async get(key: string) {
    return this.kv ? await this.kv.get(key, "json") : null;
  }
  async set(key: string, value: unknown, ttl?: number) {
    if (this.kv)
      await this.kv.put(
        key,
        JSON.stringify(value),
        ttl ? { expirationTtl: ttl } : undefined,
      );
  }
  async delete(key: string) {
    if (this.kv) await this.kv.delete(key);
  }
}

class PerformanceMonitor {
  constructor(private context: string) {}
  startTimer(name: string) {
    return { name, start: Date.now() };
  }
  endTimer(timer: { name: string; start: number }) {
    console.log(
      `[${this.context}] ${timer.name} took ${Date.now() - timer.start}ms`,
    );
  }
}

class ErrorTracker {
  constructor(private context: string) {}
  logError(operation: string, error: Error, data?: unknown) {
    console.error(`[${this.context}] Error in ${operation}:`, error, data);
  }
}

function amountFromCents(cents: number | null | undefined): number | null {
  return cents == null ? null : fromCents(cents);
}

function moneyAmount(cents: number | null | undefined): number {
  return amountFromCents(cents) ?? 0;
}

function cartItemUnitAmount(item: { unitPriceCents?: number | null }): number {
  return moneyAmount(item.unitPriceCents);
}

function cartItemTotalAmount(item: {
  totalPriceCents?: number | null;
}): number {
  return moneyAmount(item.totalPriceCents);
}

// A cart item is inserted under this status and published by a conditional
// UPDATE. Every reader — including a finalizer's snapshot — selects only
// "active" rows, so a staged row is invisible until that write proves the
// group still accepts changes.
const STAGED_CART_ITEM_STATUS = "staging";

function groupOrderIsActive(groupOrderId: string) {
  return sql`(
    SELECT ${groupOrders.status}
    FROM ${groupOrders}
    WHERE ${groupOrders.id} = ${groupOrderId}
  ) = 'active'`;
}

import type {
  IGroupOrderService,
  GroupOrder,
  GroupOrderMember,
  GroupOrderCartItem,
  GroupOrderCartItemWithMenu,
  GroupOrderActivity,
  GroupOrderSummary,
  GroupOrderStatistics,
  CreateGroupOrderRequest,
  CreateGroupOrderResponse,
  JoinGroupRequest,
  JoinGroupResponse,
  AddCartItemRequest,
  UpdateCartItemRequest,
  SplitBillRequest,
  ProcessPaymentRequest,
  GroupOrderStatus,
  PaymentStatus,
  ActivityType,
  GroupOrderPermissions,
  GroupOrderJoinPreview,
} from "../types";
import { parseGroupOrderStatus } from "../types";

/**
 * Returned when finalization is asked to build an order out of nothing. The
 * expiry sweep matches on it to tell an abandoned group apart from a genuine
 * finalization failure, so it is a shared constant rather than a literal.
 */
export const EMPTY_GROUP_ORDER_ERROR = "Cannot finalize an empty group order";

/**
 * Default member permissions applied to a new group order and used as the
 * baseline when formatting a stored group order whose settings only carry a
 * partial permissions object.
 */
const DEFAULT_GROUP_ORDER_PERMISSIONS: GroupOrderPermissions = {
  canInviteMembers: true,
  canModifyOthersCart: false,
  canFinalizeOrder: true,
  canSplitBill: true,
  canProcessPayment: true,
};

interface SplitBillData {
  memberId: string;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  totalAmount: number;
  items: SplitBillItem[];
}

interface SplitBillFailureDetails {
  code?: string;
  expectedTotalCents?: number;
  roundedTotalCents?: number;
}

interface SplitBillResult {
  success: boolean;
  data?: SplitBillData[];
  error?: string;
  errorDetails?: SplitBillFailureDetails;
}

interface GroupOrderListItem {
  id: string;
  shareCode: string;
  masterOrderId: string | null;
  finalizeFailure?: GroupOrderFinalizeFailure;
  tableNumber: string | null;
  status: GroupOrderStatus;
  hostName: string;
  memberCount: number;
  totalAmount: number;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  itemCount: number;
  members: GroupOrderMember[];
  createdAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}

/**
 * The formatters below all defend against a timestamp arriving as epoch
 * seconds rather than as the `Date` Drizzle's `timestamp_ms` mode produces.
 * Stating that tolerance in the signature keeps the branch reachable on paper
 * instead of leaving it as code the types say can never run.
 */
type WithLegacyTimestamps<TRow, TKeys extends keyof TRow> = Omit<
  TRow,
  TKeys
> & {
  [K in TKeys]: null extends TRow[K] ? Date | number | null : Date | number;
};

export class GroupOrdersService implements IGroupOrderService {
  private db;
  private rawDb: D1Database;
  private rawCacheKV?: KVNamespace;
  private cache: KVCacheService;
  private logger: ConsoleLogger;
  private performance: PerformanceMonitor;
  private errorTracker: ErrorTracker;

  constructor(
    database: D1Database,
    cacheKV?: KVNamespace,
    logLevel: string = "info",
  ) {
    this.rawDb = database;
    this.rawCacheKV = cacheKV;
    this.db = drizzle(database);
    this.cache = new KVCacheService(cacheKV);
    this.logger = new ConsoleLogger("group-orders", logLevel);
    this.performance = new PerformanceMonitor("group-orders");
    this.errorTracker = new ErrorTracker("group-orders");
  }

  private createOrderService() {
    return new DatabaseOrderService(this.rawDb, {
      JWT_SECRET: "",
      NODE_ENV: "production",
      CACHE_KV: this.rawCacheKV,
    });
  }

  private centsFromOrderValue(
    order: Record<string, unknown>,
    centsKey: string,
    amountKey: string,
  ): number {
    const cents = order[centsKey];
    if (typeof cents === "number") return cents;

    const amount = order[amountKey];
    return typeof amount === "number" ? toRequiredCents(amount) : 0;
  }

  private splitTypeFromStoredValue(
    value: string,
  ): SplitBillRequest["splitType"] {
    return value === "equal" ||
      value === "proportional" ||
      value === "individual" ||
      value === "by_item" ||
      value === "custom"
      ? value
      : "individual";
  }

  /**
   * List group orders for a restaurant
   */
  async listGroupOrders(
    restaurantId: string,
    status?: string,
  ): Promise<GroupOrderListItem[]> {
    try {
      const conditions = [eq(groupOrders.restaurantId, restaurantId)];
      if (status) {
        conditions.push(eq(groupOrders.status, status));
      }

      const rows = await this.db
        .select()
        .from(groupOrders)
        .where(and(...conditions))
        .orderBy(desc(groupOrders.createdAt))
        .limit(100);

      if (rows.length === 0) return [];

      // Batch-fetch relation data (4 queries total, never N+1).
      const orderIds = rows.map((r) => r.id);
      const [allMembers, allCartItems, allSplitBills] = await Promise.all([
        this.db
          .select()
          .from(groupMembers)
          .where(inArray(groupMembers.groupOrderId, orderIds)),
        this.db
          .select()
          .from(groupCartItems)
          .where(
            and(
              inArray(groupCartItems.groupOrderId, orderIds),
              eq(groupCartItems.status, "active"),
            ),
          ),
        this.db
          .select()
          .from(splitBills)
          .where(inArray(splitBills.groupOrderId, orderIds)),
      ]);

      // Group by order ID before returning the response.
      const membersByOrder = new Map<string, typeof allMembers>();
      for (const m of allMembers) {
        const list = membersByOrder.get(m.groupOrderId) || [];
        list.push(m);
        membersByOrder.set(m.groupOrderId, list);
      }
      const billsByMember = new Map<string, (typeof allSplitBills)[number]>();
      for (const bill of allSplitBills) {
        billsByMember.set(bill.memberId, bill);
      }
      const itemQuantitiesByMember = new Map<string, number>();
      const itemQuantitiesByOrder = new Map<string, number>();
      for (const item of allCartItems) {
        const quantity = item.quantity ?? 0;
        itemQuantitiesByMember.set(
          item.memberId,
          (itemQuantitiesByMember.get(item.memberId) ?? 0) + quantity,
        );
        itemQuantitiesByOrder.set(
          item.groupOrderId,
          (itemQuantitiesByOrder.get(item.groupOrderId) ?? 0) + quantity,
        );
      }

      return rows.map((row) => {
        const memberRows = membersByOrder.get(row.id) || [];
        const settings = (row.settings || {}) as GroupOrderSettings;
        const subtotal = moneyAmount(row.totalAmountCents);
        const serviceCharge = moneyAmount(row.serviceChargeCents);
        const taxAmount = moneyAmount(row.taxAmountCents);
        const totalAmount =
          row.finalAmountCents != null
            ? moneyAmount(row.finalAmountCents)
            : subtotal + serviceCharge + taxAmount;
        return {
          id: row.id,
          shareCode: row.shareCode,
          masterOrderId: row.masterOrderId,
          finalizeFailure: settings.finalizeFailure,
          tableNumber:
            settings?.tableNumber || (row.tableId ? String(row.tableId) : null),
          status: this.narrowStatus(row.status, row.id),
          hostName:
            memberRows.find((m) => m.role === "creator")?.name || "Host",
          memberCount: memberRows.length,
          totalAmount,
          subtotal,
          serviceCharge,
          taxAmount,
          itemCount: itemQuantitiesByOrder.get(row.id) ?? 0,
          members: memberRows.map((m) => {
            const bill = billsByMember.get(m.id);
            const formatted = this.formatMember(m);
            const recognised = bill
              ? isRevenueRecognisedSettlement(bill)
              : false;
            return {
              ...formatted,
              itemCount: itemQuantitiesByMember.get(m.id) ?? 0,
              totalAmount: moneyAmount(bill?.totalAmountCents),
              paidAmount: recognised ? moneyAmount(bill?.totalAmountCents) : 0,
              paymentStatus: (bill?.paymentStatus ?? "unpaid") as PaymentStatus,
              settledBy: bill?.settledBy ?? null,
              revenueRecognised: recognised,
            };
          }),
          createdAt: row.createdAt?.toISOString() || null,
          completedAt: null,
          expiresAt: row.expiresAt?.toISOString() || null,
        };
      });
    } catch (error) {
      this.errorTracker.logError("listGroupOrders", error as Error, {
        restaurantId,
        status,
      });
      return [];
    }
  }

  /**
   * Create a new group order
   */
  async createGroupOrder(
    data: CreateGroupOrderRequest,
    hostId: string | null,
  ): Promise<{
    success: boolean;
    data?: CreateGroupOrderResponse;
    error?: string;
  }> {
    const timer = this.performance.startTimer("createGroupOrder");

    try {
      this.logger.info("Creating group order", {
        restaurantId: data.restaurantId,
        hostId,
      });

      // Generate unique identifiers
      const groupOrderId = randomUUID();
      const shareCode = this.generateShareCode();
      const recoveryCode = randomUUID();
      const expirationSeconds = data.expirationMinutes
        ? data.expirationMinutes * 60
        : (data.expirationHours ?? 45 / 60) * 3600;
      const expiresAt = Math.floor(Date.now() / 1000) + expirationSeconds;

      // Default permissions
      const defaultPermissions = {
        ...DEFAULT_GROUP_ORDER_PERMISSIONS,
        ...data.permissions,
      };

      const effectiveMaxMembers = data.maxMembers || data.expectedMembers || 30;

      const now = new Date();

      // Create group order
      await this.db.insert(groupOrders).values({
        id: groupOrderId,
        restaurantId: data.restaurantId,
        tableId: data.tableId || null,
        shareCode,
        createdBy: hostId,
        recoveryCode,
        status: "active",
        expiresAt: new Date(expiresAt * 1000),
        settings: {
          maxMembers: effectiveMaxMembers,
          permissions: defaultPermissions,
          notes: data.notes || null,
          tableNumber: data.tableNumber || null,
          fulfillmentType: data.fulfillmentType || "dine_in",
          deliveryAddress: data.deliveryAddress,
          pickupAt: data.pickupAt,
          // Off unless the host asks for it. A group that expires without
          // anyone pressing submit is an abandoned table, not an order — the
          // restaurant should not receive a bill nobody confirmed.
          autoSubmitOnExpiry: data.autoSubmitOnExpiry ?? false,
          feeMode: data.feeMode ?? "proportional",
        },
        totalAmountCents: 0,
        taxAmountCents: 0,
        serviceChargeCents: 0,
        finalAmountCents: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Create host member
      const hostMemberId = randomUUID();
      const sessionId = randomUUID();
      await this.db.insert(groupMembers).values({
        id: hostMemberId,
        groupOrderId: groupOrderId,
        sessionId,
        name: data.hostName || "Host",
        role: "creator",
        joinedAt: now,
        lastActiveAt: now,
        isActive: true,
      });

      // Log activity
      await this.logActivity(
        groupOrderId,
        hostMemberId,
        "group_created",
        "Group order created",
        {
          shareCode,
          expiresAt,
          maxMembers: effectiveMaxMembers,
        },
      );

      // Get host member data
      const hostMemberRows = await this.db
        .select()
        .from(groupMembers)
        .where(eq(groupMembers.id, hostMemberId));

      const hostMember = hostMemberRows[0];

      const response: CreateGroupOrderResponse = {
        groupOrderId,
        shareCode,
        expiresAt: new Date(expiresAt * 1000),
        host: this.formatMember(hostMember),
        memberToken: sessionId,
        recoveryCode,
      };

      // Cache the group order without host-only secrets.
      const {
        memberToken: _hostToken,
        recoveryCode: _recoveryCode,
        ...cacheableResponse
      } = response;
      await this.cache.set(
        `group_order:${groupOrderId}`,
        cacheableResponse,
        3600,
      );
      await this.cache.set(`share_code:${shareCode}`, groupOrderId, 3600);

      this.logger.info("Group order created successfully", {
        groupOrderId,
        shareCode,
      });
      return { success: true, data: response };
    } catch (error) {
      this.errorTracker.logError("createGroupOrder", error as Error, {
        data,
        hostId,
      });
      this.logger.error("Failed to create group order", error);
      return { success: false, error: "Failed to create group order" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  async previewGroupByShareCode(
    shareCode: string,
  ): Promise<{ found: boolean; data?: GroupOrderJoinPreview }> {
    try {
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(
          and(
            eq(groupOrders.shareCode, shareCode),
            eq(groupOrders.status, "active"),
            gte(groupOrders.expiresAt, new Date()),
          ),
        );

      const groupOrder = groupOrderRows[0];
      if (!groupOrder) return { found: false };

      const memberRows = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrder.id),
            isNull(groupMembers.leftAt),
          ),
        );

      const host = memberRows.find((member) => member.role === "creator");
      const settings = (groupOrder.settings || {}) as GroupOrderSettings;

      return {
        found: true,
        data: {
          groupOrderId: groupOrder.id,
          restaurantId: groupOrder.restaurantId,
          hostName: host?.name || "Host",
          memberCount: memberRows.length,
          fulfillmentType: settings.fulfillmentType || "dine_in",
          expiresAt: groupOrder.expiresAt,
          status: this.narrowStatus(groupOrder.status, groupOrder.id),
        },
      };
    } catch (error) {
      this.errorTracker.logError("previewGroupByShareCode", error as Error, {
        shareCode,
      });
      // Rethrow instead of returning { found: false }. The route turns a
      // not-found result into 404 "Group order not found or expired", which
      // would disguise a database outage as a perfectly normal empty preview —
      // wrong for the member staring at it, and invisible to alerting.
      throw error;
    }
  }

  async recoverHost(
    groupOrderId: string,
    recoveryCode: string,
  ): Promise<{
    success: boolean;
    data?: { memberToken: string };
    error?: string;
  }> {
    try {
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(
          and(
            eq(groupOrders.id, groupOrderId),
            eq(groupOrders.recoveryCode, recoveryCode),
            eq(groupOrders.status, "active"),
            gte(groupOrders.expiresAt, new Date()),
          ),
        );

      const groupOrder = groupOrderRows[0];
      if (!groupOrder) {
        return { success: false, error: "Invalid recovery code" };
      }

      const creatorRows = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            eq(groupMembers.role, "creator"),
          ),
        );

      const creator = creatorRows[0];
      if (!creator) {
        return { success: false, error: "Invalid recovery code" };
      }

      const newSessionId = randomUUID();
      await this.db
        .update(groupMembers)
        .set({ sessionId: newSessionId, lastActiveAt: new Date() })
        .where(eq(groupMembers.id, creator.id));

      await this.logActivity(
        groupOrderId,
        creator.id,
        "member_joined",
        "Host reconnected from a new device",
        { recovered: true },
      );

      return { success: true, data: { memberToken: newSessionId } };
    } catch (error) {
      this.errorTracker.logError("recoverHost", error as Error, {
        groupOrderId,
      });
      return { success: false, error: "Failed to recover host session" };
    }
  }

  /**
   * Join an existing group order
   */
  async joinGroup(
    shareCode: string,
    memberData: JoinGroupRequest,
  ): Promise<{ success: boolean; data?: JoinGroupResponse; error?: string }> {
    const timer = this.performance.startTimer("joinGroup");

    try {
      this.logger.info("Member joining group", {
        shareCode,
        memberName: memberData.memberName,
      });

      // Get group order by share code
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(
          and(
            eq(groupOrders.shareCode, shareCode),
            eq(groupOrders.status, "active"),
            gte(groupOrders.expiresAt, new Date()),
          ),
        );

      const groupOrder = groupOrderRows[0];

      if (!groupOrder) {
        return { success: false, error: "Group order not found or expired" };
      }

      // Parse settings to get maxMembers
      const settings = groupOrder.settings || {};
      const maxMembers = settings.maxMembers || 8;

      // Check if group is full
      const memberCountResult = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrder.id),
            isNull(groupMembers.leftAt),
          ),
        );

      if (memberCountResult[0].count >= maxMembers) {
        return { success: false, error: "Group order is full" };
      }

      // Check if member name already exists in this group
      const existingMemberRows = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrder.id),
            eq(groupMembers.name, memberData.memberName),
            isNull(groupMembers.leftAt),
          ),
        );

      if (existingMemberRows.length > 0) {
        return {
          success: false,
          error: "Member name already exists in this group",
        };
      }

      // Create new member
      const memberId = randomUUID();
      const sessionId = randomUUID();
      const now = new Date();
      await this.db.insert(groupMembers).values({
        id: memberId,
        groupOrderId: groupOrder.id,
        sessionId,
        name: memberData.memberName,
        phone: memberData.phone || null,
        email: memberData.email || null,
        role: "member",
        joinedAt: now,
        lastActiveAt: now,
        isActive: true,
      });

      // Log activity
      await this.logActivity(
        groupOrder.id,
        memberId,
        "member_joined",
        `${memberData.memberName} joined the group`,
        { memberName: memberData.memberName },
      );

      // Get the created member
      const newMemberRows = await this.db
        .select()
        .from(groupMembers)
        .where(eq(groupMembers.id, memberId));

      const newMember = newMemberRows[0];

      const response: JoinGroupResponse = {
        member: this.formatMember(newMember),
        groupOrder: this.formatGroupOrder(groupOrder),
        memberToken: sessionId,
      };

      // Invalidate cache
      await this.cache.delete(`group_order:${groupOrder.id}`);

      this.logger.info("Member joined group successfully", {
        groupOrderId: groupOrder.id,
        memberId,
        memberName: memberData.memberName,
      });

      return { success: true, data: response };
    } catch (error) {
      this.errorTracker.logError("joinGroup", error as Error, {
        shareCode,
        memberData,
      });
      this.logger.error("Failed to join group", error);
      return { success: false, error: "Failed to join group" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Get group order details with members and cart items
   */
  async getGroupOrder(groupOrderId: string): Promise<GroupOrderSummary | null> {
    const timer = this.performance.startTimer("getGroupOrder");

    try {
      // Try cache first
      const cached = await this.cache.get(
        `group_order_summary:${groupOrderId}`,
      );
      if (cached) {
        return cached as GroupOrderSummary;
      }

      // Get group order
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId));

      const groupOrder = groupOrderRows[0];

      if (!groupOrder) {
        return null;
      }

      // Get members
      const members = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            isNull(groupMembers.leftAt),
          ),
        )
        .orderBy(desc(groupMembers.role), asc(groupMembers.joinedAt));

      // Get cart items with menu item details
      const cartItemsWithMenu = await this.db
        .select({
          cartItem: groupCartItems,
          menuItemName: menuItems.name,
          menuItemPriceCents: menuItems.priceCents,
          menuItemImageUrl: menuItems.imageUrl,
        })
        .from(groupCartItems)
        .innerJoin(menuItems, eq(groupCartItems.menuItemId, menuItems.id))
        .where(
          and(
            eq(groupCartItems.groupOrderId, groupOrderId),
            eq(groupCartItems.status, "active"),
          ),
        )
        .orderBy(asc(groupCartItems.addedAt));

      // Get recent activities
      const activities = await this.db
        .select()
        .from(groupActivityLogs)
        .where(eq(groupActivityLogs.groupOrderId, groupOrderId))
        .orderBy(desc(groupActivityLogs.createdAt))
        .limit(20);

      // Empty until the host splits the bill.
      const splitBillRows = await this.db
        .select()
        .from(splitBills)
        .where(eq(splitBills.groupOrderId, groupOrderId));

      const summary: GroupOrderSummary = {
        groupOrder: this.formatGroupOrder(groupOrder),
        members: members.map((m) => this.formatMember(m)),
        cartItems: cartItemsWithMenu.map((row) =>
          this.formatCartItemWithMenu(row.cartItem, {
            id: row.cartItem.menuItemId,
            name: row.menuItemName,
            priceCents: row.menuItemPriceCents,
            imageUrl: row.menuItemImageUrl,
          }),
        ),
        totalAmount: moneyAmount(groupOrder.totalAmountCents),
        activities: activities.map((a) => this.formatActivity(a)),
        splitBills: splitBillRows.map((row) => ({
          id: row.id,
          memberId: row.memberId,
          subtotal: moneyAmount(row.subtotalCents),
          serviceCharge: moneyAmount(row.serviceChargeCents),
          taxAmount: moneyAmount(row.taxAmountCents),
          totalAmount: moneyAmount(row.totalAmountCents),
          paymentStatus: row.paymentStatus,
          settledBy: row.settledBy ?? null,
          paidAt: row.paidAt ?? undefined,
        })),
      };

      // Cache for 5 minutes
      await this.cache.set(`group_order_summary:${groupOrderId}`, summary, 300);

      return summary;
    } catch (error) {
      this.errorTracker.logError("getGroupOrder", error as Error, {
        groupOrderId,
      });
      this.logger.error("Failed to get group order", error);
      return null;
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Reads the lifecycle from D1 for mutation guards. Unlike getGroupOrder,
   * this deliberately bypasses the five-minute summary cache.
   */
  async getGroupOrderStatus(
    groupOrderId: string,
  ): Promise<GroupOrderStatus | null> {
    const groupOrderRows = await this.db
      .select({ status: groupOrders.status })
      .from(groupOrders)
      .where(eq(groupOrders.id, groupOrderId));

    const rawStatus = groupOrderRows[0]?.status;
    if (!rawStatus) return null;

    const status = parseGroupOrderStatus(rawStatus);
    if (!status) {
      this.errorTracker.logError(
        "getGroupOrderStatus",
        new Error("UNKNOWN_GROUP_ORDER_STATUS"),
        { groupOrderId, status: rawStatus },
      );
      throw new Error("UNKNOWN_GROUP_ORDER_STATUS");
    }

    return status;
  }

  /**
   * Add item to cart
   */
  async addCartItem(
    groupOrderId: string,
    itemData: AddCartItemRequest,
  ): Promise<{
    success: boolean;
    data?: GroupOrderCartItem;
    restaurantId?: string;
    error?: string;
  }> {
    const timer = this.performance.startTimer("addCartItem");

    try {
      // Validate group order and member
      const validation = await this.validateGroupOrderAndMember(
        groupOrderId,
        itemData.memberId,
      );
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Get menu item details
      const restaurantId = validation.groupOrder!.restaurantId;
      const menuItemRows = await this.db
        .select()
        .from(menuItems)
        .where(
          and(
            eq(menuItems.id, itemData.menuItemId),
            eq(menuItems.restaurantId, restaurantId),
          ),
        );

      const menuItem = menuItemRows[0];

      if (!menuItem) {
        return { success: false, error: "Menu item not found" };
      }

      // Calculate prices
      if (menuItem.priceCents == null) {
        return { success: false, error: "Menu item price is unavailable" };
      }

      const unitPriceCents = menuItem.priceCents;
      const totalPriceCents = unitPriceCents * itemData.quantity;
      const unitPrice = fromCents(unitPriceCents);
      const totalPrice = fromCents(totalPriceCents);

      // Create the cart item staged, so nothing can observe it yet.
      const itemId = randomUUID();
      const now = new Date();
      await this.db.insert(groupCartItems).values({
        id: itemId,
        groupOrderId,
        memberId: itemData.memberId,
        menuItemId: itemData.menuItemId,
        quantity: itemData.quantity,
        unitPriceCents,
        totalPriceCents,
        customizations: (itemData.customizations ||
          {}) as CartItemCustomizations,
        specialInstructions: itemData.specialInstructions || null,
        status: STAGED_CART_ITEM_STATUS,
        addedAt: now,
        updatedAt: now,
      });

      // Publish it only while the group still accepts cart changes. The status
      // check has to be this write's own predicate: `validateGroupOrderAndMember`
      // above read the status, and a finalizer can claim between that read and
      // here. Because the row only becomes visible when this UPDATE succeeds,
      // a claim that wins the race leaves the item out of the finalizer's
      // snapshot and out of the bill, rather than stranding it on a closed group.
      const publishedRows = await this.db
        .update(groupCartItems)
        .set({ status: "active", updatedAt: now })
        .where(
          and(eq(groupCartItems.id, itemId), groupOrderIsActive(groupOrderId)),
        )
        .returning({ id: groupCartItems.id });

      if (publishedRows.length === 0) {
        await this.db
          .delete(groupCartItems)
          .where(eq(groupCartItems.id, itemId));
        return { success: false, error: "Group order is no longer active" };
      }

      // Update member's total amount (via split_bills)
      await this.updateMemberTotal(groupOrderId, itemData.memberId);

      // Update group order total
      await this.updateGroupOrderTotal(groupOrderId);

      // Log activity
      await this.logActivity(
        groupOrderId,
        itemData.memberId,
        "item_added",
        `Added ${itemData.quantity}x ${menuItem.name}`,
        {
          menuItemId: itemData.menuItemId,
          quantity: itemData.quantity,
          totalPrice,
        },
      );

      // Get the created item
      const cartItemRows = await this.db
        .select()
        .from(groupCartItems)
        .where(eq(groupCartItems.id, itemId));

      const cartItem = cartItemRows[0];

      if (!cartItem) {
        // Fallback: construct the response from the inserted data
        this.logger.error(
          "Failed to query inserted cart item, using fallback",
          { itemId },
        );
        const fallbackItem: GroupOrderCartItem = {
          id: itemId,
          itemId: itemId,
          groupOrderId,
          memberId: itemData.memberId,
          menuItemId: itemData.menuItemId,
          quantity: itemData.quantity,
          unitPrice,
          totalPrice,
          unitPriceCents,
          totalPriceCents,
          customizations: itemData.customizations || {},
          specialInstructions: itemData.specialInstructions || undefined,
          menuItem: {
            id: menuItem.id,
            name: menuItem.name,
            price: moneyAmount(menuItem.priceCents),
            imageUrl: menuItem.imageUrl ?? undefined,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Invalidate cache
        await this.cache.delete(`group_order_summary:${groupOrderId}`);

        return { success: true, data: fallbackItem, restaurantId };
      }

      // Invalidate cache
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return {
        success: true,
        data: this.formatCartItemWithMenu(cartItem, menuItem),
        restaurantId,
      };
    } catch (error) {
      this.errorTracker.logError("addCartItem", error as Error, {
        groupOrderId,
        itemData,
      });
      this.logger.error("Failed to add cart item", error);
      return { success: false, error: "Failed to add cart item" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Update cart item
   */
  async updateCartItem(
    groupOrderId: string,
    itemId: string,
    updateData: UpdateCartItemRequest,
  ): Promise<{ success: boolean; data?: GroupOrderCartItem; error?: string }> {
    const timer = this.performance.startTimer("updateCartItem");

    try {
      // Get existing cart item
      const existingItemRows = await this.db
        .select()
        .from(groupCartItems)
        .where(
          and(
            eq(groupCartItems.id, itemId),
            eq(groupCartItems.groupOrderId, groupOrderId),
          ),
        );

      const existingItem = existingItemRows[0];

      if (!existingItem) {
        return { success: false, error: "Cart item not found" };
      }

      // Build update object dynamically
      const updateObj: Partial<typeof groupCartItems.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (updateData.quantity !== undefined) {
        const unitPriceCents = existingItem.unitPriceCents ?? 0;
        updateObj.quantity = updateData.quantity;
        updateObj.totalPriceCents = unitPriceCents * updateData.quantity;
      }

      if (updateData.customizations !== undefined) {
        updateObj.customizations = updateData.customizations;
      }

      if (updateData.specialInstructions !== undefined) {
        updateObj.specialInstructions = updateData.specialInstructions;
      }

      const updatedRows = await this.db
        .update(groupCartItems)
        .set(updateObj)
        .where(
          and(
            eq(groupCartItems.id, itemId),
            eq(groupCartItems.groupOrderId, groupOrderId),
            groupOrderIsActive(groupOrderId),
          ),
        )
        .returning({ id: groupCartItems.id });

      if (updatedRows.length === 0) {
        return { success: false, error: "Group order is no longer active" };
      }

      // Update totals
      await this.updateMemberTotal(groupOrderId, existingItem.memberId);
      await this.updateGroupOrderTotal(groupOrderId);

      // Log activity
      await this.logActivity(
        groupOrderId,
        existingItem.memberId,
        "item_updated",
        "Updated cart item",
        { itemId, changes: updateData },
      );

      // Get updated item
      const updatedItemRows = await this.db
        .select()
        .from(groupCartItems)
        .where(eq(groupCartItems.id, itemId));

      const updatedItem = updatedItemRows[0];

      if (!updatedItem) {
        throw new Error("Failed to query updated cart item");
      }

      const menuItemRows = await this.db
        .select()
        .from(menuItems)
        .where(eq(menuItems.id, updatedItem.menuItemId));

      const menuItem = menuItemRows[0];

      // Invalidate cache
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return {
        success: true,
        data: menuItem
          ? this.formatCartItemWithMenu(updatedItem, menuItem)
          : this.formatCartItem(updatedItem),
      };
    } catch (error) {
      this.errorTracker.logError("updateCartItem", error as Error, {
        groupOrderId,
        itemId,
        updateData,
      });
      this.logger.error("Failed to update cart item", error);
      return { success: false, error: "Failed to update cart item" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Remove cart item
   *
   * The cart is shared, so `memberId` is the member doing the removing, not a
   * claim of ownership — any member may clear any dish. Everything written
   * afterwards therefore follows `cartItem.memberId`: the total belongs to
   * whoever was being charged for the dish, and crediting the caller instead
   * would move the cost onto them while leaving the owner still charged.
   */
  async removeCartItem(
    groupOrderId: string,
    itemId: string,
    memberId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const timer = this.performance.startTimer("removeCartItem");

    try {
      const cartItemRows = await this.db
        .select()
        .from(groupCartItems)
        .where(
          and(
            eq(groupCartItems.id, itemId),
            eq(groupCartItems.groupOrderId, groupOrderId),
          ),
        );

      const cartItem = cartItemRows[0];

      if (!cartItem) {
        return {
          success: false,
          error: "Cart item not found",
        };
      }

      const ownerId = cartItem.memberId;

      // Delete only while the group is still accepting cart changes. The
      // status predicate is part of the write so a finalizer claim cannot be
      // raced between a read and this mutation.
      const deletedRows = await this.db
        .delete(groupCartItems)
        .where(
          and(
            eq(groupCartItems.id, itemId),
            eq(groupCartItems.groupOrderId, groupOrderId),
            groupOrderIsActive(groupOrderId),
          ),
        )
        .returning({ id: groupCartItems.id });

      if (deletedRows.length === 0) {
        return { success: false, error: "Group order is no longer active" };
      }

      // Update totals
      await this.updateMemberTotal(groupOrderId, ownerId);
      await this.updateGroupOrderTotal(groupOrderId);

      // Log activity
      await this.logActivity(
        groupOrderId,
        ownerId,
        "item_removed",
        "Removed cart item",
        { itemId },
      );

      // Invalidate cache
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return { success: true };
    } catch (error) {
      this.errorTracker.logError("removeCartItem", error as Error, {
        groupOrderId,
        itemId,
        memberId,
      });
      this.logger.error("Failed to remove cart item", error);
      return { success: false, error: "Failed to remove cart item" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Finalize a group order into the canonical orders flow.
   *
   * This method deliberately stays thin: it claims the group-order mutex, maps
   * the group cart into `OrderService.createOrder`, records the master order,
   * then delegates member allocation to `splitBill`.
   *
   * Group-order states resolve to `{ success: false, error }`; a business-rule
   * rejection from `createOrder` is rethrown as the `ApiError` it already is,
   * so the route's global handler answers with its own code, status and
   * details (#359).
   */
  async finalizeGroupOrder(groupOrderId: string): Promise<{
    success: boolean;
    data?: { masterOrderId: string; status: "completed" };
    error?: string;
  }> {
    const timer = this.performance.startTimer("finalizeGroupOrder");
    let claimed = false;

    try {
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId));
      const groupOrder = groupOrderRows[0];

      if (!groupOrder) {
        return { success: false, error: "Group order not found" };
      }

      // `masterOrderId` alone does not mean the group finalized. It is written
      // three times: on claim (`finalizing`), on split-bill failure
      // (`finalizing_failed`, with a real order already created), and on
      // success (`completed`). Only the last is idempotently repeatable —
      // reporting the other two as completed would hide a split that never
      // happened behind a success the caller has no reason to re-check.
      if (groupOrder.masterOrderId && groupOrder.status === "completed") {
        return {
          success: true,
          data: {
            masterOrderId: groupOrder.masterOrderId,
            status: "completed",
          },
        };
      }

      if (groupOrder.status === "cancelled") {
        return {
          success: false,
          error: "Group order is cancelled, cannot finalize",
        };
      }
      if (groupOrder.status === "completed") {
        return {
          success: false,
          error: "Group order is completed, cannot finalize",
        };
      }
      if (
        groupOrder.status === "finalizing" ||
        groupOrder.status === "checkout"
      ) {
        return {
          success: false,
          error: "Group order is already being finalized",
        };
      }
      if (groupOrder.status === "finalizing_failed") {
        return {
          success: false,
          error: "Group order finalization previously failed",
        };
      }
      if (groupOrder.status !== "active") {
        return {
          success: false,
          error: `Group order is ${groupOrder.status}, cannot finalize`,
        };
      }

      const now = new Date();
      const claimedRows = await this.db
        .update(groupOrders)
        .set({ status: "finalizing", lockedAt: now, updatedAt: now })
        .where(
          and(
            eq(groupOrders.id, groupOrderId),
            eq(groupOrders.status, "active"),
            isNull(groupOrders.masterOrderId),
          ),
        )
        .returning({ id: groupOrders.id });

      if (claimedRows.length === 0) {
        const currentRows = await this.db
          .select()
          .from(groupOrders)
          .where(eq(groupOrders.id, groupOrderId));
        const current = currentRows[0];

        // Same rule as the pre-claim check above: the racing finalizer may
        // have recorded a master order and then failed its split.
        if (current?.masterOrderId && current.status === "completed") {
          return {
            success: true,
            data: {
              masterOrderId: current.masterOrderId,
              status: "completed",
            },
          };
        }

        if (
          current?.status === "finalizing" ||
          current?.status === "checkout"
        ) {
          return {
            success: false,
            error: "Group order is already being finalized",
          };
        }

        return {
          success: false,
          error: current
            ? `Group order is ${current.status}, cannot finalize`
            : "Group order not found",
        };
      }
      claimed = true;

      // Claim before taking the cart snapshot. Cart writes include the group
      // status in their SQL predicate, so every item used for the canonical
      // order and split bills now comes from one immutable view.
      const cartItems = await this.db
        .select()
        .from(groupCartItems)
        .where(
          and(
            eq(groupCartItems.groupOrderId, groupOrderId),
            eq(groupCartItems.status, "active"),
          ),
        );

      if (cartItems.length === 0) {
        await this.db
          .update(groupOrders)
          .set({ status: "active", lockedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(groupOrders.id, groupOrderId),
              eq(groupOrders.status, "finalizing"),
              isNull(groupOrders.masterOrderId),
            ),
          );
        claimed = false;
        return { success: false, error: EMPTY_GROUP_ORDER_ERROR };
      }

      const settings = (groupOrder.settings || {}) as GroupOrderSettings;
      const fulfillmentType = settings.fulfillmentType || "dine_in";
      const deliveryInfo =
        fulfillmentType === "dine_in"
          ? undefined
          : {
              type:
                fulfillmentType === "pickup"
                  ? ("takeaway" as const)
                  : ("delivery" as const),
              address: settings.deliveryAddress
                ? [
                    settings.deliveryAddress.line1,
                    settings.deliveryAddress.line2,
                  ]
                    .filter(Boolean)
                    .join(", ")
                : undefined,
              phone: settings.deliveryAddress?.contactPhone,
              instructions:
                fulfillmentType === "pickup" && settings.pickupAt
                  ? `Pickup requested at ${settings.pickupAt}${
                      settings.deliveryAddress?.notes
                        ? ` - ${settings.deliveryAddress.notes}`
                        : ""
                    }`
                  : settings.deliveryAddress?.notes,
            };
      const clientMutationId = `group-order:${groupOrderId}`;
      const createOrderData = {
        restaurantId: groupOrder.restaurantId,
        tableId:
          fulfillmentType === "dine_in"
            ? (groupOrder.tableId ?? undefined)
            : undefined,
        orderType:
          fulfillmentType === "dine_in" && groupOrder.tableId
            ? ("table" as const)
            : ("shop" as const),
        items: cartItems.map((item) => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          notes: item.specialInstructions ?? undefined,
        })),
        notes: settings.notes ?? undefined,
        clientMutationId,
        deliveryInfo,
      };

      let order: Record<string, unknown>;
      try {
        order = (await this.createOrderService().createOrder(
          createOrderData,
        )) as unknown as Record<string, unknown>;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "CLIENT_MUTATION_DUPLICATE"
        ) {
          throw error;
        }

        const existingRows = await this.db
          .select({
            id: orders.id,
            serviceChargeCents: orders.serviceChargeCents,
            taxAmountCents: orders.taxAmountCents,
            totalAmountCents: orders.totalAmountCents,
          })
          .from(orders)
          .where(
            and(
              eq(orders.restaurantId, groupOrder.restaurantId),
              eq(orders.clientMutationId, clientMutationId),
            ),
          );
        const existing = existingRows[0];
        if (!existing) throw error;

        order = {
          id: existing.id,
          serviceChargeCents: existing.serviceChargeCents ?? 0,
          taxAmountCents: existing.taxAmountCents ?? 0,
          totalAmountCents: existing.totalAmountCents ?? 0,
        };
      }

      if (!order.id || typeof order.id !== "string") {
        throw new Error("FINALIZE_ORDER_ID_MISSING");
      }

      const masterOrderId = order.id;
      const serviceChargeCents = this.centsFromOrderValue(
        order,
        "serviceChargeCents",
        "serviceCharge",
      );
      const taxAmountCents = this.centsFromOrderValue(
        order,
        "taxAmountCents",
        "taxAmount",
      );
      const orderTotalCents =
        this.centsFromOrderValue(order, "finalAmountCents", "finalAmount") ||
        this.centsFromOrderValue(order, "totalAmountCents", "totalAmount");

      await this.db
        .update(groupOrders)
        .set({
          masterOrderId,
          status: "finalizing",
          serviceChargeCents,
          taxAmountCents,
          finalAmountCents: orderTotalCents,
          updatedAt: new Date(),
        })
        .where(eq(groupOrders.id, groupOrderId));

      const splitResult = await this.splitBill(
        groupOrderId,
        {
          splitType: this.splitTypeFromStoredValue(groupOrder.splitType),
          sharedServiceChargeCents: serviceChargeCents,
          sharedTaxCents: taxAmountCents,
          orderTotalCents,
        },
        cartItems,
      );

      if (!splitResult.success) {
        const failure: GroupOrderFinalizeFailure = {
          code: splitResult.errorDetails?.code ?? "SPLIT_BILL_FAILED",
          masterOrderId,
          orderTotalCents,
          serviceChargeCents,
          taxAmountCents,
          expectedTotalCents: splitResult.errorDetails?.expectedTotalCents,
          roundedTotalCents: splitResult.errorDetails?.roundedTotalCents,
          splitError: splitResult.error ?? "Failed to split bill",
          failedAt: new Date().toISOString(),
        };

        await this.db
          .update(groupOrders)
          .set({
            masterOrderId,
            status: "finalizing_failed",
            settings: {
              ...settings,
              finalizeFailure: failure,
            },
            updatedAt: new Date(),
          })
          .where(eq(groupOrders.id, groupOrderId));

        this.errorTracker.logError(
          "finalizeGroupOrder:splitBill",
          new Error(failure.code),
          { groupOrderId, ...failure },
        );

        return {
          success: false,
          error: splitResult.error ?? "Failed to split bill",
        };
      }

      const completedAt = new Date();
      await this.db
        .update(groupOrders)
        .set({
          masterOrderId,
          status: "completed",
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(groupOrders.id, groupOrderId));

      await this.logActivity(
        groupOrderId,
        null,
        "order_finalized",
        "Group order finalized into a real order",
        { masterOrderId, orderTotalCents },
      );

      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return { success: true, data: { masterOrderId, status: "completed" } };
    } catch (error) {
      if (claimed) {
        await this.db
          .update(groupOrders)
          .set({ status: "active", updatedAt: new Date() })
          .where(
            and(
              eq(groupOrders.id, groupOrderId),
              eq(groupOrders.status, "finalizing"),
              isNull(groupOrders.masterOrderId),
            ),
          );
      }

      // `createOrder` 的業務規則拒絕本來就是 ApiError（來自 @makanmasak/utils，
      // 與 API 層 re-export 的是同一個類別），已經帶著 code、status 與 details
      // ——缺貨是哪一道菜、還剩幾份，低消差多少（#352）。原封不動往上丟，
      // app-factory 的 `err instanceof ApiError` 分支就會照原樣回給揪團主人；
      // 壓成一句通用字串等於把他唯一能動手修的資訊丟掉（#359）。也不記進
      // errorTracker：購物車不符規則是點餐的人要處理的事，不是故障。
      if (error instanceof ApiError) throw error;

      // 外送守門（#295）在 createOrder 裡仍然是普通 Error，所以留在這裡翻譯。
      // 同樣不記進 errorTracker：這是設定問題，不是故障。
      if (error instanceof Error && error.message === "DELIVERY_NOT_ENABLED") {
        return { success: false, error: "此店家未開放外送" };
      }

      this.errorTracker.logError("finalizeGroupOrder", error as Error, {
        groupOrderId,
      });
      this.logger.error("Failed to finalize group order", error);
      return { success: false, error: "Failed to finalize group order" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Re-run a split that failed after the real order was already created.
   * The order totals are immutable at this point, so recovery only reuses the
   * recorded amounts and moves the group into the normal settlement state.
   */
  async recoverFinalization(
    groupOrderId: string,
    options?: { bearerMemberId?: string },
  ): Promise<{
    success: boolean;
    data?: { masterOrderId: string; status: "checkout" };
    error?: string;
    errorCode?:
      | "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS"
      | "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED";
  }> {
    const groupOrderRows = await this.db
      .select()
      .from(groupOrders)
      .where(eq(groupOrders.id, groupOrderId));
    const groupOrder = groupOrderRows[0];

    if (!groupOrder) {
      return { success: false, error: "Group order not found" };
    }
    if (
      groupOrder.status !== "finalizing_failed" ||
      !groupOrder.masterOrderId
    ) {
      return {
        success: false,
        error: "Group order is not awaiting finalization recovery",
      };
    }

    const settings = (groupOrder.settings || {}) as GroupOrderSettings;
    const failure = settings.finalizeFailure;
    if (!failure) {
      return {
        success: false,
        error: "Missing finalization failure diagnostics",
      };
    }

    if (options?.bearerMemberId) {
      const activeBearer = await this.db
        .select({ id: groupMembers.id, leftAt: groupMembers.leftAt })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            eq(groupMembers.id, options.bearerMemberId),
            isNull(groupMembers.leftAt),
          ),
        );

      if (activeBearer.length === 0 || activeBearer[0]?.leftAt) {
        return {
          success: false,
          error: "Bearer member is not an active member of this group order",
        };
      }
    }

    // Claim recovery before splitBill performs its read-then-write bill
    // upserts. Without this conditional transition, concurrent admin retries
    // can both observe no existing bill and insert duplicates for a member.
    //
    // `lockedAt` is re-stamped rather than left alone: the expiry sweep decides
    // a claim is abandoned by how old `lockedAt` is, and the value already on
    // the row belongs to the original finalize attempt — minutes or hours
    // earlier. Leaving it would make every recovery look abandoned the instant
    // it started.
    const claimedAt = new Date();
    const claimedRows = await this.db
      .update(groupOrders)
      .set({ status: "finalizing", lockedAt: claimedAt, updatedAt: claimedAt })
      .where(
        and(
          eq(groupOrders.id, groupOrderId),
          eq(groupOrders.status, "finalizing_failed"),
          eq(groupOrders.masterOrderId, groupOrder.masterOrderId),
        ),
      )
      .returning({ id: groupOrders.id });

    if (claimedRows.length === 0) {
      return {
        success: false,
        error: "Group order finalization recovery is already in progress",
        errorCode: "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
      };
    }

    const splitResult = await this.splitBill(
      groupOrderId,
      options?.bearerMemberId
        ? {
            splitType: "custom",
            customAmounts: [
              {
                memberId: options.bearerMemberId,
                amount: fromCents(
                  failure.orderTotalCents -
                    failure.serviceChargeCents -
                    failure.taxAmountCents,
                ),
              },
            ],
            sharedServiceChargeCents: failure.serviceChargeCents,
            sharedTaxCents: failure.taxAmountCents,
            orderTotalCents: failure.orderTotalCents,
          }
        : {
            splitType: this.splitTypeFromStoredValue(groupOrder.splitType),
            sharedServiceChargeCents: failure.serviceChargeCents,
            sharedTaxCents: failure.taxAmountCents,
            orderTotalCents: failure.orderTotalCents,
          },
    );

    if (!splitResult.success) {
      const attemptedAt = new Date().toISOString();
      const recoveryErrorDetails = [
        ...(failure.recoveryErrorDetails ?? []),
        {
          code: splitResult.errorDetails?.code ?? "SPLIT_BILL_FAILED",
          splitError: splitResult.error ?? "Failed to split bill",
          expectedTotalCents: splitResult.errorDetails?.expectedTotalCents,
          roundedTotalCents: splitResult.errorDetails?.roundedTotalCents,
          attemptedAt,
        },
      ];

      await this.db
        .update(groupOrders)
        .set({
          status: "finalizing_failed",
          settings: {
            ...settings,
            finalizeFailure: { ...failure, recoveryErrorDetails },
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(groupOrders.id, groupOrderId),
            eq(groupOrders.status, "finalizing"),
            eq(groupOrders.masterOrderId, groupOrder.masterOrderId),
          ),
        );

      return {
        success: false,
        error: splitResult.error ?? "Failed to split bill",
      };
    }

    const { finalizeFailure: _finalizeFailure, ...recoveredSettings } =
      settings;
    const now = new Date();
    const settledRows = await this.db
      .update(groupOrders)
      .set({
        status: "checkout",
        settings: recoveredSettings,
        lockedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(groupOrders.id, groupOrderId),
          eq(groupOrders.status, "finalizing"),
          eq(groupOrders.masterOrderId, groupOrder.masterOrderId),
        ),
      )
      .returning({ id: groupOrders.id });

    // The claim was taken from us — the expiry sweep decided this attempt had
    // been abandoned and moved the group back to `finalizing_failed`. The
    // bills are written and splitBill upserts by member, so re-running is
    // safe; what is not safe is telling the caller this settled when the row
    // says otherwise.
    if (settledRows.length === 0) {
      return {
        success: false,
        error:
          "Group order finalization recovery was reclaimed before it completed",
        errorCode: "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED",
      };
    }

    await this.logActivity(
      groupOrderId,
      null,
      "bill_split",
      "Finalization recovery split the bill",
      { masterOrderId: groupOrder.masterOrderId },
    );
    await this.cache.delete(`group_order:${groupOrderId}`);
    await this.cache.delete(`group_order_summary:${groupOrderId}`);

    return {
      success: true,
      data: { masterOrderId: groupOrder.masterOrderId, status: "checkout" },
    };
  }

  /**
   * Split bill among members
   */
  async splitBill(
    groupOrderId: string,
    splitData: SplitBillRequest,
    cartSnapshot?: Array<typeof groupCartItems.$inferSelect>,
  ): Promise<SplitBillResult> {
    const timer = this.performance.startTimer("splitBill");

    try {
      this.logger.info("Splitting bill", {
        groupOrderId,
        splitType: splitData.splitType,
      });

      // Validate group order exists and has not been cancelled
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId));

      const groupOrder = groupOrderRows[0];

      if (!groupOrder) {
        return { success: false, error: "Group order not found" };
      }

      if (groupOrder.status === "cancelled") {
        return { success: false, error: "Group order is already finalized" };
      }

      // Get all active members
      const members = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            isNull(groupMembers.leftAt),
          ),
        )
        .orderBy(asc(groupMembers.joinedAt));

      if (!members || members.length === 0) {
        return { success: false, error: "No active members found" };
      }

      // Get all active cart items
      const cartItems =
        cartSnapshot ??
        (await this.db
          .select()
          .from(groupCartItems)
          .where(
            and(
              eq(groupCartItems.groupOrderId, groupOrderId),
              eq(groupCartItems.status, "active"),
            ),
          ));

      const totalCartAmount = cartItems.reduce(
        (sum, item) => sum + cartItemTotalAmount(item),
        0,
      );

      const hasSharedAmounts =
        splitData.sharedServiceChargeCents !== undefined ||
        splitData.sharedTaxCents !== undefined;
      const sharedServiceCharge = hasSharedAmounts
        ? fromCents(splitData.sharedServiceChargeCents ?? 0)
        : 0;
      const sharedTax = hasSharedAmounts
        ? fromCents(splitData.sharedTaxCents ?? 0)
        : 0;
      const serviceChargeRate = hasSharedAmounts
        ? 0
        : (splitData.serviceChargeRate ?? 0);
      const taxRate = hasSharedAmounts ? 0 : (splitData.taxRate ?? 0);

      const splitBillsData: SplitBillData[] = [];
      // `recipientCount` is the number of bills this branch will actually
      // produce, which is not always members.length — a custom split covers
      // only the members named in customAmounts. Dividing the fallback by the
      // wrong population under-distributes the shared cost.
      const allocateSharedAmount = (
        amount: number,
        baseAmount: number,
        totalBaseAmount: number,
        recipientCount: number,
      ) =>
        totalBaseAmount > 0
          ? (amount * baseAmount) / totalBaseAmount
          : amount / recipientCount;
      /**
       * Who carries the shared fees, chosen by the host when the group was
       * opened. Both branches below have to honour it: the rate branch runs
       * while the table is still ordering, the shared-amount branch runs when
       * finalize hands over the real order's charges. Applying it to only one
       * would make the choice stop mattering at the moment it matters most.
       */
      const storedSettings =
        groupOrder.settings && typeof groupOrder.settings === "object"
          ? (groupOrder.settings as GroupOrderSettings)
          : {};
      const feeMode: GroupOrderFeeMode =
        splitData.feeMode ?? storedSettings.feeMode ?? "proportional";
      const hostMemberId = members.find(
        (member) => member.role === "creator",
      )?.id;

      /**
       * The whole fee, before deciding whose bill it lands on.
       *
       * `feeBaseTotal` is money — the amount a rate applies to. It is not
       * `totalBaseAmount`, which is whatever unit the proportional allocation
       * happens to divide by: the equal-split branch passes a head count
       * there, so using it here would multiply the rate by the number of
       * diners.
       */
      const wholeFee = (
        sharedAmount: number,
        rate: number,
        feeBaseTotal: number,
      ) => (hasSharedAmounts ? sharedAmount : feeBaseTotal * rate);

      const allocateByMode = (
        memberId: string,
        sharedAmount: number,
        rate: number,
        subtotal: number,
        baseAmount: number,
        totalBaseAmount: number,
        feeBaseTotal: number,
        recipientCount: number,
      ) => {
        if (feeMode === "host") {
          // Nobody but the host sees a fee; the host sees all of it.
          return memberId === hostMemberId
            ? wholeFee(sharedAmount, rate, feeBaseTotal)
            : 0;
        }

        if (feeMode === "equal") {
          return (
            wholeFee(sharedAmount, rate, feeBaseTotal) /
            Math.max(recipientCount, 1)
          );
        }

        return hasSharedAmounts
          ? allocateSharedAmount(
              sharedAmount,
              baseAmount,
              totalBaseAmount,
              recipientCount,
            )
          : subtotal * rate;
      };

      const calculateCharges = (
        subtotal: number,
        baseAmount: number,
        totalBaseAmount: number,
        recipientCount: number,
        memberId: string,
        feeBaseTotal: number,
      ) => ({
        serviceCharge: allocateByMode(
          memberId,
          sharedServiceCharge,
          serviceChargeRate,
          subtotal,
          baseAmount,
          totalBaseAmount,
          feeBaseTotal,
          recipientCount,
        ),
        taxAmount: allocateByMode(
          memberId,
          sharedTax,
          taxRate,
          subtotal,
          baseAmount,
          totalBaseAmount,
          feeBaseTotal,
          recipientCount,
        ),
      });

      // Calculate splits based on splitType.
      //
      // "proportional" shares this branch with "individual"/"by_item" on
      // purpose: every shared cost the system can currently produce (tax,
      // service charge) is itself proportional to subtotal, so distributing it
      // by subtotal share and charging each member their own rate give the
      // same number. Merging them keeps the two from drifting apart while they
      // are genuinely the same calculation.
      //
      // IF YOU ADD A SHARED COST THAT IS NOT PROPORTIONAL TO SUBTOTAL — a flat
      // delivery fee is the expected first one — the two stop being the same
      // calculation and this branch must be split: "proportional" distributes
      // it by each member's share of the total, "individual" does not. The
      // equivalence test in GroupOrdersService.test.ts cannot warn you about
      // this, because once merged it compares one code path against itself.
      if (
        splitData.splitType === "by_item" ||
        splitData.splitType === "individual" ||
        splitData.splitType === "proportional"
      ) {
        // Each member pays for their own items
        for (const member of members) {
          const memberItems = cartItems.filter(
            (item) => item.memberId === member.id,
          );
          const subtotal = memberItems.reduce(
            (sum, item) => sum + cartItemTotalAmount(item),
            0,
          );
          const { serviceCharge, taxAmount } = calculateCharges(
            subtotal,
            subtotal,
            totalCartAmount,
            members.length,
            member.id,
            totalCartAmount,
          );
          const totalAmount = subtotal + serviceCharge + taxAmount;

          splitBillsData.push({
            memberId: member.id,
            subtotal,
            serviceCharge,
            taxAmount,
            totalAmount,
            items: memberItems.map((item) => ({
              cartItemId: item.id,
              menuItemId: item.menuItemId,
              name: "",
              quantity: item.quantity,
              unitPrice: cartItemUnitAmount(item),
              totalPrice: cartItemTotalAmount(item),
            })),
          });
        }
      } else if (splitData.splitType === "equal") {
        // Split equally among all members
        const memberCount = members.length;
        const subtotalPerMember = totalCartAmount / memberCount;

        for (const member of members) {
          // Computed per member: under the `host` fee mode these differ, so a
          // single shared figure would hand everyone the host's bill.
          const {
            serviceCharge: serviceChargePerMember,
            taxAmount: taxPerMember,
          } = calculateCharges(
            subtotalPerMember,
            1,
            memberCount,
            memberCount,
            member.id,
            totalCartAmount,
          );
          const totalPerMember =
            subtotalPerMember + serviceChargePerMember + taxPerMember;

          splitBillsData.push({
            memberId: member.id,
            subtotal: subtotalPerMember,
            serviceCharge: serviceChargePerMember,
            taxAmount: taxPerMember,
            totalAmount: totalPerMember,
            items: [], // Equal split doesn't track individual items
          });
        }
      } else if (splitData.splitType === "custom") {
        // Use custom amounts
        if (!splitData.customAmounts || splitData.customAmounts.length === 0) {
          return {
            success: false,
            error: "Custom amounts are required for custom split type",
          };
        }

        for (const customAmount of splitData.customAmounts) {
          const member = members.find((m) => m.id === customAmount.memberId);
          if (!member) {
            return {
              success: false,
              error: `Member ${customAmount.memberId} not found in group`,
            };
          }

          const subtotal = customAmount.amount;
          const totalCustomAmount = splitData.customAmounts.reduce(
            (sum, amount) => sum + amount.amount,
            0,
          );
          const { serviceCharge, taxAmount } = calculateCharges(
            subtotal,
            subtotal,
            totalCustomAmount,
            splitData.customAmounts.length,
            member.id,
            totalCustomAmount,
          );
          const totalAmount = subtotal + serviceCharge + taxAmount;

          splitBillsData.push({
            memberId: member.id,
            subtotal,
            serviceCharge,
            taxAmount,
            totalAmount,
            items: [], // Custom split doesn't track individual items
          });
        }
      } else {
        return {
          success: false,
          error: `Unsupported split type: ${splitData.splitType}`,
        };
      }

      const targetTotalCents =
        splitData.orderTotalCents ??
        toRequiredCents(
          splitBillsData.reduce((sum, bill) => sum + bill.totalAmount, 0),
        );
      const roundedTotalCents = splitBillsData.reduce(
        (sum, bill) => sum + toRequiredCents(bill.totalAmount),
        0,
      );
      const remainderCents = targetTotalCents - roundedTotalCents;

      if (Math.abs(remainderCents) > splitBillsData.length) {
        this.errorTracker.logError(
          "splitBill",
          new Error("SPLIT_TOTAL_MISMATCH"),
          {
            code: "SPLIT_TOTAL_MISMATCH",
            groupOrderId,
            expectedTotalCents: targetTotalCents,
            roundedTotalCents,
          },
        );
        return {
          success: false,
          error: "Split total does not match order total",
          errorDetails: {
            code: "SPLIT_TOTAL_MISMATCH",
            expectedTotalCents: targetTotalCents,
            roundedTotalCents,
          },
        };
      }

      if (remainderCents !== 0) {
        const creatorId = members.find(
          (member) => member.role === "creator",
        )?.id;
        const creatorBill =
          splitBillsData.find((bill) => bill.memberId === creatorId) ??
          splitBillsData[0];
        // The remainder lands on the subtotal as well as the total. split_bills
        // stores subtotal, service charge and tax as separate columns, so
        // moving only the total would leave the creator holding a bill whose
        // own line items do not add up to what they are asked to pay.
        //
        // Subtotal is the component that absorbs it: service charge and tax
        // are the real order's absolute amounts, and adjusting either would
        // make the split disagree with what the restaurant actually charged.
        creatorBill.subtotal = fromCents(
          toRequiredCents(creatorBill.subtotal) + remainderCents,
        );
        creatorBill.totalAmount = fromCents(
          toRequiredCents(creatorBill.totalAmount) + remainderCents,
        );
      }

      // Insert split bills into database
      const now = new Date();
      for (const bill of splitBillsData) {
        const billId = randomUUID();
        const billPayload = {
          groupOrderId,
          memberId: bill.memberId,
          subtotalCents: toRequiredCents(bill.subtotal),
          taxAmountCents: toRequiredCents(bill.taxAmount),
          serviceChargeCents: toRequiredCents(bill.serviceCharge),
          discountAmountCents: 0,
          tipAmountCents: 0,
          totalAmountCents: toRequiredCents(bill.totalAmount),
          items: bill.items,
          updatedAt: now,
        } satisfies Partial<typeof splitBills.$inferInsert>;

        const existingRows = await this.db
          .select()
          .from(splitBills)
          .where(
            and(
              eq(splitBills.groupOrderId, groupOrderId),
              eq(splitBills.memberId, bill.memberId),
            ),
          );

        if (existingRows.length > 0) {
          await this.db
            .update(splitBills)
            .set(billPayload)
            .where(eq(splitBills.id, existingRows[0].id));
        } else {
          await this.db.insert(splitBills).values({
            id: billId,
            ...billPayload,
            paymentStatus: "pending",
            createdAt: now,
          } as typeof splitBills.$inferInsert);
        }
      }

      // Calculate final amounts for group order
      const totalServiceCharge = splitBillsData.reduce(
        (sum, bill) => sum + bill.serviceCharge,
        0,
      );
      const totalTax = splitBillsData.reduce(
        (sum, bill) => sum + bill.taxAmount,
        0,
      );
      const finalAmountCents = splitBillsData.reduce(
        (sum, bill) => sum + toRequiredCents(bill.totalAmount),
        0,
      );

      // Map split types to database values ('by_item' -> 'individual')
      const dbSplitType =
        splitData.splitType === "by_item" ? "individual" : splitData.splitType;

      // Update group order with split totals. The group order status describes
      // ordering/finalization only; settlement progress lives in split_bills.
      await this.db
        .update(groupOrders)
        .set({
          splitType: dbSplitType,
          totalAmountCents: toRequiredCents(totalCartAmount),
          taxAmountCents: toRequiredCents(totalTax),
          serviceChargeCents: toRequiredCents(totalServiceCharge),
          finalAmountCents,
          updatedAt: now,
        })
        .where(eq(groupOrders.id, groupOrderId));

      // Log activity
      await this.logActivity(
        groupOrderId,
        null,
        "bill_split",
        `Bill split using ${splitData.splitType} method`,
        {
          splitType: splitData.splitType,
          memberCount: members.length,
          totalAmount: fromCents(finalAmountCents),
        },
      );

      // Invalidate cache
      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      this.logger.info("Bill split successfully", {
        groupOrderId,
        splitType: splitData.splitType,
        billCount: splitBillsData.length,
        finalAmount: fromCents(finalAmountCents),
      });

      return {
        success: true,
        data: splitBillsData.map((bill) => ({
          memberId: bill.memberId,
          subtotal: bill.subtotal,
          serviceCharge: bill.serviceCharge,
          taxAmount: bill.taxAmount,
          totalAmount: bill.totalAmount,
          items: bill.items,
        })),
      };
    } catch (error) {
      this.errorTracker.logError("splitBill", error as Error, {
        groupOrderId,
        splitData,
      });
      this.logger.error("Failed to split bill", error);
      return { success: false, error: "Failed to split bill" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Process payment for a member
   */
  /**
   * Records that a member's share is settled.
   *
   * `settledBy` is passed in rather than defaulted because it says whose word
   * this is, and the only caller who knows that is the one that authenticated
   * the request. A default would let a call site quietly claim a trust level
   * it never established.
   */
  async processPayment(
    groupOrderId: string,
    memberId: string,
    paymentData: ProcessPaymentRequest,
    settledBy: SettledBy,
  ): Promise<{
    success: boolean;
    data?: {
      memberId: string;
      amount: number;
      paymentMethod: string;
      transactionId: string;
      paidAt: Date;
      groupOrderStatus: string;
    };
    error?: string;
  }> {
    const timer = this.performance.startTimer("processPayment");

    try {
      this.logger.info("Processing payment", { groupOrderId, memberId });

      // Validate group order exists
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId));

      const groupOrder = groupOrderRows[0];

      if (!groupOrder) {
        return { success: false, error: "Group order not found" };
      }

      // Validate member exists
      const memberRows = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.id, memberId),
            eq(groupMembers.groupOrderId, groupOrderId),
            isNull(groupMembers.leftAt),
          ),
        );

      const member = memberRows[0];

      if (!member) {
        return { success: false, error: "Member not found in group" };
      }

      // Get the split bill for this member
      const splitBillRows = await this.db
        .select()
        .from(splitBills)
        .where(
          and(
            eq(splitBills.groupOrderId, groupOrderId),
            eq(splitBills.memberId, memberId),
          ),
        );

      const splitBill = splitBillRows[0];

      if (!splitBill) {
        return {
          success: false,
          error:
            "Split bill not found for member. Please split the bill first.",
        };
      }

      // Check if already paid
      if (splitBill.paymentStatus === "paid") {
        return {
          success: false,
          error: "Payment already processed for this member",
        };
      }

      // Use provided amount or the split bill total
      const splitBillTotal = moneyAmount(splitBill.totalAmountCents);
      const amount = paymentData.amount || splitBillTotal;

      // Validate amount matches split bill (with small tolerance for rounding)
      if (Math.abs(amount - splitBillTotal) > 0.01) {
        return {
          success: false,
          error: `Payment amount (${amount}) does not match split bill amount (${splitBillTotal})`,
        };
      }

      // Generate transaction reference if not provided
      const transactionId =
        paymentData.transactionId ||
        `TXN-${Date.now()}-${randomUUID().substring(0, 8)}`;

      // Store payment details as JSON
      const paymentReference = JSON.stringify({
        transactionId,
        method: paymentData.paymentMethod,
        details: paymentData.paymentDetails || {},
        processedAt: new Date().toISOString(),
      });

      const now = new Date();

      // Update split bill with payment info
      await this.db
        .update(splitBills)
        .set({
          paymentStatus: "paid",
          settledBy,
          paymentMethod: paymentData.paymentMethod,
          paymentReference,
          paidAt: now,
          updatedAt: now,
        })
        .where(eq(splitBills.id, splitBill.id));

      // Log activity
      await this.logActivity(
        groupOrderId,
        memberId,
        "payment_made",
        `${member.name} completed payment of ${amount}`,
        {
          amount,
          paymentMethod: paymentData.paymentMethod,
          transactionId,
        },
      );

      // Invalidate cache
      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      this.logger.info("Payment processed successfully", {
        groupOrderId,
        memberId,
        amount,
        transactionId,
      });

      return {
        success: true,
        data: {
          memberId,
          amount,
          paymentMethod: paymentData.paymentMethod,
          transactionId,
          paidAt: new Date(),
          groupOrderStatus: groupOrder.status,
        },
      };
    } catch (error) {
      this.errorTracker.logError("processPayment", error as Error, {
        groupOrderId,
        memberId,
        paymentData,
      });
      this.logger.error("Failed to process payment", error);
      return { success: false, error: "Failed to process payment" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Leave group
   */
  async leaveGroup(
    groupOrderId: string,
    memberId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const timer = this.performance.startTimer("leaveGroup");

    try {
      const groupOrderRows = await this.db
        .select()
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId));
      const groupOrder = groupOrderRows[0];

      if (!groupOrder) {
        return { success: false, error: "Group order not found" };
      }

      if (groupOrder.status !== "active") {
        return {
          success: false,
          error: "Cannot leave a group order after checkout has started",
        };
      }

      const memberRows = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.id, memberId),
            eq(groupMembers.groupOrderId, groupOrderId),
            isNull(groupMembers.leftAt),
          ),
        );
      const member = memberRows[0];

      if (!member) {
        return { success: false, error: "Member not found in group" };
      }

      const activeMemberRows = await this.db
        .select()
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            isNull(groupMembers.leftAt),
          ),
        );

      if (member.role === "creator" && activeMemberRows.length > 1) {
        return {
          success: false,
          error: "Host cannot leave while other members are still active",
        };
      }

      const now = new Date();
      await this.db
        .update(groupMembers)
        .set({
          isActive: false,
          leftAt: now,
          lastActiveAt: now,
        })
        .where(eq(groupMembers.id, memberId));

      await this.db
        .update(groupCartItems)
        .set({
          status: "removed",
          updatedAt: now,
        })
        .where(
          and(
            eq(groupCartItems.groupOrderId, groupOrderId),
            eq(groupCartItems.memberId, memberId),
            eq(groupCartItems.status, "active"),
          ),
        );

      await this.updateMemberTotal(groupOrderId, memberId);
      await this.updateGroupOrderTotal(groupOrderId);

      await this.logActivity(
        groupOrderId,
        memberId,
        "member_left",
        `${member.name} left the group`,
        { memberName: member.name },
      );

      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return { success: true };
    } catch (error) {
      this.errorTracker.logError("leaveGroup", error as Error, {
        groupOrderId,
        memberId,
      });
      this.logger.error("Failed to leave group", error);
      return { success: false, error: "Failed to leave group" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Get group activities
   */
  async getActivities(groupOrderId: string): Promise<GroupOrderActivity[]> {
    const activities = await this.db
      .select()
      .from(groupActivityLogs)
      .where(eq(groupActivityLogs.groupOrderId, groupOrderId))
      .orderBy(desc(groupActivityLogs.createdAt))
      .limit(50);

    return activities.map((a) => this.formatActivity(a));
  }

  /**
   * Cleanup expired groups
   */
  async cleanupExpiredGroups(): Promise<{ cleaned: number; errors: string[] }> {
    const timer = this.performance.startTimer("cleanupExpiredGroups");
    const errors: string[] = [];
    const nowMs = Date.now();
    const now = new Date(nowMs);

    try {
      const expiredGroups = await this.db
        .select()
        .from(groupOrders)
        .where(
          and(
            inArray(groupOrders.status, ["active", "checkout"]),
            sql`${groupOrders.expiresAt} < ${nowMs}`,
          ),
        )
        .limit(500);

      let cleaned = 0;

      for (const groupOrder of expiredGroups) {
        try {
          await this.db
            .update(groupOrders)
            .set({
              status: "cancelled",
              updatedAt: now,
            })
            .where(eq(groupOrders.id, groupOrder.id));

          await this.logActivity(
            groupOrder.id,
            null,
            "group_expired",
            "Group order expired and was cancelled",
            { expiredAt: groupOrder.expiresAt },
          );

          await this.cache.delete(`group_order:${groupOrder.id}`);
          await this.cache.delete(`group_order_summary:${groupOrder.id}`);
          await this.cache.delete(`share_code:${groupOrder.shareCode}`);
          cleaned++;
        } catch (error) {
          errors.push(`${groupOrder.id}: ${(error as Error).message}`);
        }
      }

      return { cleaned, errors };
    } catch (error) {
      this.errorTracker.logError("cleanupExpiredGroups", error as Error);
      this.logger.error("Failed to cleanup expired groups", error);
      return { cleaned: 0, errors: [(error as Error).message] };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  async isHostSession(
    groupOrderId: string,
    memberToken: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            eq(groupMembers.sessionId, memberToken),
            eq(groupMembers.role, "creator"),
            eq(groupMembers.isActive, true),
            isNull(groupMembers.leftAt),
          ),
        )
        .limit(1);

      return rows.length > 0;
    } catch (error) {
      this.errorTracker.logError("isHostSession", error as Error, {
        groupOrderId,
      });
      this.logger.error("Failed to validate host session", error);
      return false;
    }
  }

  /**
   * Record how the bill should be divided when this group is finalized.
   *
   * Deliberately not `splitBill`: that one performs the split, sets the group
   * to `checkout` and stamps `lockedAt`, which ends ordering for everyone.
   * This only stores the choice, so the table keeps ordering until someone
   * actually submits.
   *
   * Only the methods finalize can carry out unaided are accepted — `custom`
   * needs per-member amounts and a group order has nowhere to keep them.
   */
  async setSplitType(
    groupOrderId: string,
    splitType: "equal" | "by_item" | "proportional",
  ): Promise<{
    success: boolean;
    data?: { splitType: string };
    error?: string;
  }> {
    const timer = this.performance.startTimer("setSplitType");

    try {
      const rows = await this.db
        .select({ id: groupOrders.id })
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId))
        .limit(1);

      if (!rows[0]) {
        return { success: false, error: "Group order not found" };
      }

      // The column's vocabulary, which `splitBill` also maps onto.
      const storedValue = splitType === "by_item" ? "individual" : splitType;

      await this.db
        .update(groupOrders)
        .set({ splitType: storedValue, updatedAt: new Date() })
        .where(eq(groupOrders.id, groupOrderId));

      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return { success: true, data: { splitType } };
    } catch (error) {
      this.errorTracker.logError("setSplitType", error as Error, {
        groupOrderId,
      });
      this.logger.error("Failed to update split type", error);
      return { success: false, error: "Failed to update split type" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Record who carries the service charge and tax.
   *
   * Same shape as `setSplitType`: a preference, not an action. It rewrites one
   * key of the `settings` JSON and leaves status and lockedAt alone, so the
   * table keeps ordering.
   */
  async setFeeMode(
    groupOrderId: string,
    feeMode: GroupOrderFeeMode,
  ): Promise<{
    success: boolean;
    data?: { feeMode: GroupOrderFeeMode };
    error?: string;
  }> {
    const timer = this.performance.startTimer("setFeeMode");

    try {
      const rows = await this.db
        .select({ settings: groupOrders.settings })
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId))
        .limit(1);

      const existing = rows[0];
      if (!existing) {
        return { success: false, error: "Group order not found" };
      }

      const settings =
        existing.settings && typeof existing.settings === "object"
          ? existing.settings
          : {};

      await this.db
        .update(groupOrders)
        .set({ settings: { ...settings, feeMode }, updatedAt: new Date() })
        .where(eq(groupOrders.id, groupOrderId));

      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return { success: true, data: { feeMode } };
    } catch (error) {
      this.errorTracker.logError("setFeeMode", error as Error, {
        groupOrderId,
      });
      this.logger.error("Failed to update fee mode", error);
      return { success: false, error: "Failed to update fee mode" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  /**
   * Turn expiry auto-submit on or off for one group order.
   *
   * `settings` is a single JSON column, so this reads it back and rewrites the
   * whole object with one key changed. Writing a bare `{ autoSubmitOnExpiry }`
   * would drop the member cap, the permissions and the delivery address with
   * it.
   */
  async setAutoSubmitOnExpiry(
    groupOrderId: string,
    enabled: boolean,
  ): Promise<{
    success: boolean;
    data?: { autoSubmitOnExpiry: boolean };
    error?: string;
  }> {
    const timer = this.performance.startTimer("setAutoSubmitOnExpiry");

    try {
      const rows = await this.db
        .select({ settings: groupOrders.settings })
        .from(groupOrders)
        .where(eq(groupOrders.id, groupOrderId))
        .limit(1);

      const existing = rows[0];
      if (!existing) {
        return { success: false, error: "Group order not found" };
      }

      const settings =
        existing.settings && typeof existing.settings === "object"
          ? existing.settings
          : {};

      await this.db
        .update(groupOrders)
        .set({
          settings: { ...settings, autoSubmitOnExpiry: enabled },
          updatedAt: new Date(),
        })
        .where(eq(groupOrders.id, groupOrderId));

      await this.cache.delete(`group_order:${groupOrderId}`);
      await this.cache.delete(`group_order_summary:${groupOrderId}`);

      return { success: true, data: { autoSubmitOnExpiry: enabled } };
    } catch (error) {
      this.errorTracker.logError("setAutoSubmitOnExpiry", error as Error, {
        groupOrderId,
      });
      this.logger.error("Failed to update auto-submit setting", error);
      return { success: false, error: "Failed to update auto-submit setting" };
    } finally {
      this.performance.endTimer(timer);
    }
  }

  async isMemberSession(
    groupOrderId: string,
    memberId: string,
    memberToken: string,
  ): Promise<boolean> {
    try {
      const rows = await this.db
        .select({ id: groupMembers.id })
        .from(groupMembers)
        .where(
          and(
            eq(groupMembers.groupOrderId, groupOrderId),
            eq(groupMembers.id, memberId),
            eq(groupMembers.sessionId, memberToken),
            eq(groupMembers.isActive, true),
            isNull(groupMembers.leftAt),
          ),
        )
        .limit(1);

      return rows.length > 0;
    } catch (error) {
      this.errorTracker.logError("isMemberSession", error as Error, {
        groupOrderId,
        memberId,
      });
      this.logger.error("Failed to validate member session", error);
      return false;
    }
  }

  /**
   * Get statistics
   */
  async getStatistics(
    restaurantId?: string,
    timeRange?: string,
  ): Promise<GroupOrderStatistics> {
    // Calculate time range
    const nowMs = Date.now();
    let startMs = 0;

    switch (timeRange) {
      case "day":
        startMs = nowMs - 24 * 60 * 60 * 1000;
        break;
      case "week":
        startMs = nowMs - 7 * 24 * 60 * 60 * 1000;
        break;
      case "month":
        startMs = nowMs - 30 * 24 * 60 * 60 * 1000;
        break;
      case "quarter":
        startMs = nowMs - 90 * 24 * 60 * 60 * 1000;
        break;
      case "year":
        startMs = nowMs - 365 * 24 * 60 * 60 * 1000;
        break;
      default:
        startMs = nowMs - 30 * 24 * 60 * 60 * 1000; // Default to month
    }

    const startDate = new Date(startMs);

    // Build dynamic conditions
    const conditions = [gte(groupOrders.createdAt, startDate)];
    if (restaurantId) {
      conditions.push(eq(groupOrders.restaurantId, restaurantId));
    }

    const activeConditions = [...conditions, eq(groupOrders.status, "active")];
    const avgValueConditions = [
      ...conditions,
      sql`COALESCE(${groupOrders.finalAmountCents}, 0) > 0`,
    ];

    // One row per group inside the window, carrying its member count, so the
    // outer query can average them.
    //
    // This used to be a raw `sql` subquery with `${startDate}` interpolated
    // into it. A `sql` fragment carries no column context, so the
    // `{ mode: "timestamp_ms" }` mapper on `created_at_ms` never ran and the
    // `Date` reached D1 as an object — `D1_TYPE_ERROR` on every call, caught
    // by `allSettled` below and turned into a silent `0` on the owner
    // dashboard's "average group size" tile (#365). Built through the query
    // builder the mapper applies, and `conditions` — the window and the
    // restaurant filter — reaches it by construction instead of through a
    // second hand-written copy that can drift from the one above it.
    const groupSizes = this.db
      .select({
        groupOrderId: groupMembers.groupOrderId,
        memberCount: count().as("member_count"),
      })
      .from(groupMembers)
      .innerJoin(groupOrders, eq(groupMembers.groupOrderId, groupOrders.id))
      .where(and(...conditions))
      .groupBy(groupMembers.groupOrderId)
      .as("group_sizes");

    // Run all independent queries in parallel
    const [countsResult, avgSizeResult, avgValueResult] =
      await Promise.allSettled([
        // Total + active counts
        Promise.all([
          this.db
            .select({ total: sql<number>`COUNT(*)` })
            .from(groupOrders)
            .where(and(...conditions)),
          this.db
            .select({ active: sql<number>`COUNT(*)` })
            .from(groupOrders)
            .where(and(...activeConditions)),
        ]),
        // Average group size
        this.db
          .select({ avgSize: sql<number>`AVG(${groupSizes.memberCount})` })
          .from(groupSizes),
        // Average order value
        this.db
          .select({
            avgValue: sql<number>`AVG(COALESCE(${groupOrders.finalAmountCents}, 0)) / 100.0`,
          })
          .from(groupOrders)
          .where(and(...avgValueConditions)),
      ]);

    let totalCount = 0;
    let activeCount = 0;
    if (countsResult.status === "fulfilled") {
      totalCount = countsResult.value[0][0]?.total || 0;
      activeCount = countsResult.value[1][0]?.active || 0;
    } else {
      this.errorTracker.logError("getStatistics:counts", countsResult.reason, {
        restaurantId,
      });
    }

    // A rejection still reads as 0, which is indistinguishable from "no groups
    // in the window" and is exactly how #365 hid for as long as it did. The
    // honest answer would be `null` rendered as "—", but the tile's whole chain
    // would have to move with it — `avgGroupSize` is a `ref(0)` the admin view
    // feeds through `?? 0` and then calls `.toFixed(1)` on in two places and
    // multiplies for a progress-bar width — so a server-side `null` alone would
    // be erased at that boundary and change nothing on screen. The guard is
    // instead in `GroupOrdersService.statistics.test.ts`, which asserts against
    // a real D1 that nothing was logged here at all.
    const avgSize =
      avgSizeResult.status === "fulfilled"
        ? avgSizeResult.value[0]?.avgSize || 0
        : 0;
    if (avgSizeResult.status === "rejected") {
      this.errorTracker.logError("getStatistics:avgSize", avgSizeResult.reason);
    }

    const avgValue =
      avgValueResult.status === "fulfilled"
        ? avgValueResult.value[0]?.avgValue || 0
        : 0;
    if (avgValueResult.status === "rejected") {
      this.errorTracker.logError(
        "getStatistics:avgValue",
        avgValueResult.reason,
      );
    }

    return {
      totalGroupOrders: totalCount,
      activeGroupOrders: activeCount,
      averageGroupSize: Math.round(avgSize * 10) / 10,
      averageOrderValue: Math.round(avgValue * 100) / 100,
      popularTimeSlots: [],
      conversionRate:
        totalCount > 0
          ? Math.round(((totalCount - activeCount) / totalCount) * 100)
          : 0,
      paymentMethodDistribution: {},
    };
  }

  // Helper methods
  private generateShareCode(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async validateGroupOrderAndMember(
    groupOrderId: string,
    memberId: string,
  ) {
    const groupOrderRows = await this.db
      .select()
      .from(groupOrders)
      .where(eq(groupOrders.id, groupOrderId));

    const groupOrder = groupOrderRows[0];

    if (!groupOrder) {
      return { valid: false as const, error: "Group order not found" };
    }

    if (groupOrder.status !== "active") {
      return { valid: false as const, error: "Group order is not active" };
    }

    const now = new Date();
    if (groupOrder.expiresAt < now) {
      return { valid: false as const, error: "Group order has expired" };
    }

    const memberRows = await this.db
      .select()
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.id, memberId),
          eq(groupMembers.groupOrderId, groupOrderId),
          isNull(groupMembers.leftAt),
        ),
      );

    const member = memberRows[0];

    if (!member) {
      return { valid: false as const, error: "Member not found in group" };
    }

    return { valid: true as const, groupOrder, member };
  }

  private async updateMemberTotal(groupOrderId: string, memberId: string) {
    const [groupOrder] = await this.db
      .select({ restaurantId: groupOrders.restaurantId })
      .from(groupOrders)
      .where(eq(groupOrders.id, groupOrderId));
    const [restaurant] = groupOrder
      ? await this.db
          .select({ settings: restaurants.settings })
          .from(restaurants)
          .where(eq(restaurants.id, groupOrder.restaurantId))
      : [];
    const taxRate = restaurant?.settings?.taxRate ?? 0;
    const serviceChargeRate = restaurant?.settings?.serviceChargeRate ?? 0;
    const totalResult = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(COALESCE(${groupCartItems.totalPriceCents}, 0)), 0) / 100.0`,
      })
      .from(groupCartItems)
      .where(
        and(
          eq(groupCartItems.groupOrderId, groupOrderId),
          eq(groupCartItems.memberId, memberId),
          eq(groupCartItems.status, "active"),
        ),
      );

    const total = totalResult[0]?.total || 0;
    const subtotalCents = toRequiredCents(total);
    const taxAmountCents = toRequiredCents(total * taxRate);
    const serviceChargeCents = toRequiredCents(total * serviceChargeRate);
    const now = new Date();

    // Update or create split_bill record for this member
    // Using raw SQL for ON CONFLICT since Drizzle's onConflictDoUpdate needs a unique index target
    // The split_bills table has a unique constraint on (group_order_id, member_id) in the original SQL
    // We'll use delete + insert pattern instead
    const existing = await this.db
      .select()
      .from(splitBills)
      .where(
        and(
          eq(splitBills.groupOrderId, groupOrderId),
          eq(splitBills.memberId, memberId),
        ),
      );

    if (existing.length > 0) {
      await this.db
        .update(splitBills)
        .set({
          subtotalCents,
          taxAmountCents,
          serviceChargeCents,
          discountAmountCents: 0,
          tipAmountCents: 0,
          totalAmountCents: subtotalCents + taxAmountCents + serviceChargeCents,
          updatedAt: now,
        })
        .where(
          and(
            eq(splitBills.groupOrderId, groupOrderId),
            eq(splitBills.memberId, memberId),
          ),
        );
    } else {
      await this.db.insert(splitBills).values({
        id: randomUUID(),
        groupOrderId,
        memberId,
        subtotalCents,
        taxAmountCents,
        serviceChargeCents,
        discountAmountCents: 0,
        tipAmountCents: 0,
        totalAmountCents: subtotalCents + taxAmountCents + serviceChargeCents,
        paymentStatus: "pending",
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  private async updateGroupOrderTotal(groupOrderId: string) {
    const totalResult = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(COALESCE(${groupCartItems.totalPriceCents}, 0)), 0) / 100.0`,
      })
      .from(groupCartItems)
      .where(
        and(
          eq(groupCartItems.groupOrderId, groupOrderId),
          eq(groupCartItems.status, "active"),
        ),
      );

    const total = totalResult[0]?.total || 0;

    await this.db
      .update(groupOrders)
      .set({
        totalAmountCents: toRequiredCents(total),
        updatedAt: new Date(),
      })
      .where(eq(groupOrders.id, groupOrderId));
  }

  private async logActivity(
    groupOrderId: string,
    memberId: string | null,
    type: ActivityType,
    description: string,
    metadata?: Record<string, unknown>,
  ) {
    const activityId = randomUUID();
    await this.db.insert(groupActivityLogs).values({
      id: activityId,
      groupOrderId,
      memberId,
      action: type,
      description,
      metadata: (metadata || {}) as GroupActivityMetadata,
      createdAt: new Date(),
    });
  }

  /**
   * `group_orders.status` is a plain TEXT column, so Drizzle types it as
   * `string`. Asserting it into `GroupOrderStatus` would compile against any
   * value the row happens to hold, including one this service never writes.
   * Check instead, and make an unexpected value loud rather than letting it
   * travel onward wearing a type it doesn't satisfy.
   */
  private narrowStatus(value: string, groupOrderId: string): GroupOrderStatus {
    const status = parseGroupOrderStatus(value);
    if (status) return status;

    this.errorTracker.logError(
      "formatGroupOrder",
      new Error("UNKNOWN_GROUP_ORDER_STATUS"),
      { groupOrderId, status: value },
    );
    // "active" is the safest fallback: it is the most restrictive state for
    // reads and the default the column itself carries.
    return "active";
  }

  private formatGroupOrder(
    data: WithLegacyTimestamps<
      typeof groupOrders.$inferSelect,
      "expiresAt" | "lockedAt" | "completedAt" | "createdAt" | "updatedAt"
    >,
  ): GroupOrder {
    // Drizzle returns camelCase properties and handles JSON/timestamp_ms automatically
    const settings = (data.settings || {}) as GroupOrderSettings;
    // expiresAt is a Date object from Drizzle timestamp_ms mode
    const expiresAt =
      data.expiresAt instanceof Date
        ? data.expiresAt
        : new Date(data.expiresAt * 1000);
    const lockedAt =
      data.lockedAt instanceof Date
        ? data.lockedAt
        : data.lockedAt
          ? new Date(data.lockedAt * 1000)
          : undefined;
    const completedAt =
      data.completedAt instanceof Date
        ? data.completedAt
        : data.completedAt
          ? new Date(data.completedAt * 1000)
          : undefined;
    const createdAt =
      data.createdAt instanceof Date
        ? data.createdAt
        : new Date(data.createdAt * 1000);
    const updatedAt =
      data.updatedAt instanceof Date
        ? data.updatedAt
        : new Date(data.updatedAt * 1000);

    return {
      id: data.id,
      groupOrderId: data.id, // Keep for backward compatibility
      restaurantId: data.restaurantId,
      tableId: data.tableId ?? undefined,
      shareCode: data.shareCode,
      createdBy: data.createdBy,
      status: this.narrowStatus(data.status, data.id),
      expiresAt,
      maxMembers: settings.maxMembers || 8,
      // The column stores `individual`; every client calls it `by_item`, and
      // `splitBill` already translates between them. Without this the client
      // sees `undefined` and falls back to a mode nobody chose.
      splitType: data.splitType === "individual" ? "by_item" : data.splitType,
      // Absent means the mode every group used before the host could choose.
      feeMode: settings.feeMode ?? "proportional",
      // Surfaced because the host's toggle has to render the current state.
      // Rows written before the setting existed read as off, which matches the
      // default the service now applies.
      autoSubmitOnExpiry: settings.autoSubmitOnExpiry === true,
      permissions: {
        ...DEFAULT_GROUP_ORDER_PERMISSIONS,
        ...settings.permissions,
      },
      totalAmount: moneyAmount(data.totalAmountCents),
      finalizedAt: lockedAt,
      paidAt: completedAt,
      finalizeFailure: settings.finalizeFailure,
      createdAt,
      updatedAt,
    };
  }

  private formatMember(
    data: WithLegacyTimestamps<
      typeof groupMembers.$inferSelect,
      "joinedAt" | "lastActiveAt" | "leftAt"
    >,
  ): GroupOrderMember {
    const joinedAt =
      data.joinedAt instanceof Date
        ? data.joinedAt
        : new Date(data.joinedAt * 1000);
    const lastActiveAt =
      data.lastActiveAt instanceof Date
        ? data.lastActiveAt
        : new Date(data.lastActiveAt * 1000);
    const leftAt =
      data.leftAt instanceof Date
        ? data.leftAt
        : data.leftAt
          ? new Date(data.leftAt * 1000)
          : undefined;

    return {
      id: data.id,
      memberId: data.id, // Keep for backward compatibility
      groupOrderId: data.groupOrderId,
      memberName: data.name,
      phone: data.phone ?? undefined,
      email: data.email ?? undefined,
      isHost: data.role === "creator", // Convert role to isHost
      joinedAt,
      leftAt,
      totalAmount: 0, // Will be calculated from split_bills
      paidAmount: 0, // Will be calculated from split_bills
      paymentStatus: "pending" as PaymentStatus,
      createdAt: joinedAt,
      updatedAt: lastActiveAt,
    };
  }

  private formatCartItem(
    data: WithLegacyTimestamps<
      typeof groupCartItems.$inferSelect,
      "addedAt" | "updatedAt"
    >,
  ): GroupOrderCartItem {
    // Drizzle handles JSON columns automatically (no JSON.parse needed)
    const customizations = data.customizations || {};
    const addedAt =
      data.addedAt instanceof Date
        ? data.addedAt
        : new Date(data.addedAt * 1000);
    const updatedAt =
      data.updatedAt instanceof Date
        ? data.updatedAt
        : new Date(data.updatedAt * 1000);

    return {
      id: data.id,
      itemId: data.id, // Keep for backward compatibility
      groupOrderId: data.groupOrderId,
      memberId: data.memberId,
      menuItemId: data.menuItemId,
      quantity: data.quantity,
      unitPrice: cartItemUnitAmount(data),
      totalPrice: cartItemTotalAmount(data),
      customizations,
      specialInstructions: data.specialInstructions ?? undefined,
      createdAt: addedAt,
      updatedAt,
    };
  }

  private formatCartItemWithMenu(
    cartItem: typeof groupCartItems.$inferSelect,
    menuItem: {
      id: number;
      name: string;
      priceCents?: number | null;
      imageUrl?: string | null;
    },
  ): GroupOrderCartItemWithMenu {
    return {
      ...this.formatCartItem(cartItem),
      menuItem: {
        id: menuItem.id,
        name: menuItem.name,
        price: moneyAmount(menuItem.priceCents),
        imageUrl: menuItem.imageUrl ?? undefined,
      },
    };
  }

  private formatActivity(
    data: WithLegacyTimestamps<
      typeof groupActivityLogs.$inferSelect,
      "createdAt"
    >,
  ): GroupOrderActivity {
    // Drizzle handles JSON columns automatically (no JSON.parse needed)
    const metadata = data.metadata || {};
    const createdAt =
      data.createdAt instanceof Date
        ? data.createdAt
        : new Date(data.createdAt * 1000);

    return {
      id: data.id,
      activityId: data.id, // Keep for backward compatibility
      groupOrderId: data.groupOrderId,
      memberId: data.memberId ?? undefined,
      memberName: "", // Not stored in activity logs
      type: data.action as ActivityType,
      description: data.description,
      metadata,
      timestamp: createdAt,
      createdAt,
      updatedAt: createdAt,
    };
  }
}
