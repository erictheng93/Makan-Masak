/**
 * Group Order Composable
 * 群組點餐功能 - 處理即時購物車同步和分帳
 */

import { computed, getCurrentInstance, onUnmounted, ref } from "vue";
import { useWebSocket } from "./useWebSocket";
import { apiClient } from "@/services/api";
import {
  RealtimeEventType,
  type GroupOrderFeeMode,
  type GroupOrderStatus,
} from "@makanmasak/shared-types";
import {
  clearHostCredentials,
  clearMemberCredentials,
  readHostCredentials,
  readMemberCredentials,
  saveActiveGroupOrder,
  saveHostCredentials,
  saveMemberCredentials,
  updateHostMemberToken,
} from "@/utils/groupOrderSession";
import {
  getGroupOrderErrorI18nKey,
  groupOrderError,
} from "@/utils/group-order-error";

// ============================================================================
// Types
// ============================================================================

export interface GroupMember {
  id: string;
  name: string;
  phone?: string;
  isHost: boolean;
  isOnline: boolean;
  joinedAt: number;
  lastActivity: number;
}

export interface GroupCartItem {
  id: string;
  menuItemId: string;
  menuItemName: string;
  menuItemPrice: number;
  quantity: number;
  options?: Record<string, unknown>;
  notes?: string;
  addedBy: string;
  addedByName: string;
  addedAt: number;
}

/**
 * Only the methods the server can carry out at finalize on its own. `custom`
 * and `single_payer` need per-member amounts that a group order has nowhere to
 * store, so they are not offered as a preference.
 */
export interface SplitBillConfig {
  mode: "equal" | "by_item" | "proportional";
}

/** One diner's share, written by the server when the bill is split. */
export interface GroupSplitBill {
  id: string;
  memberId: string;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  totalAmount: number;
  isSettled: boolean;
  /**
   * Whose word the settlement is. Always "self" today — the restaurant has no
   * path to confirm one. Carried so the contract matches the database rather
   * than growing a second source of truth later.
   */
  settledBy: "self" | "staff" | "provider" | null;
}

export interface GroupOrder {
  id: string;
  restaurantId: string;
  tableId?: string;
  shareCode?: string;
  hostId: string;
  hostName: string;
  status: GroupOrderStatus;
  members: GroupMember[];
  cartItems: GroupCartItem[];
  splitBillConfig: SplitBillConfig;
  /** Who carries the service charge and tax. Host-controlled. */
  feeMode: GroupOrderFeeMode;
  /** Empty while the table is still ordering. */
  splitBills: GroupSplitBill[];
  /** Set once the group cart is finalized into a real order. */
  masterOrderId?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
}

export interface GroupOrderEvent {
  type: string;
  groupOrderId: string;
  data: unknown;
  senderId: string;
  senderName: string;
  timestamp: number;
}

interface CreateGroupOrderOptions {
  hostName?: string;
  tableId?: string;
}

interface CreateGroupOrderResponse {
  groupOrderId: string;
  shareCode: string;
  expiresAt: string;
  host: BackendGroupMember;
  memberToken: string;
  recoveryCode: string;
}

interface BackendGroupOrder {
  id: string;
  restaurantId: string;
  tableId?: number | string | null;
  shareCode?: string;
  createdBy?: string | null;
  status: GroupOrderStatus;
  masterOrderId?: string | null;
  splitType?: "equal" | "proportional" | "individual" | "by_item" | "custom";
  autoSubmitOnExpiry?: boolean;
  feeMode?: GroupOrderFeeMode;
  expiresAt?: string | Date | number | null;
  createdAt?: string | Date | number;
  updatedAt?: string | Date | number;
}

interface BackendGroupMember {
  id: string;
  memberId?: string;
  memberName: string;
  phone?: string;
  isHost: boolean;
  joinedAt: string | Date | number;
  lastActiveAt?: string | Date | number | null;
}

interface JoinGroupOrderResponse {
  member: BackendGroupMember;
  groupOrder: BackendGroupOrder;
  memberToken: string;
}

interface RecoverHostResponse {
  memberToken: string;
}

interface SubmitGroupOrderResponse {
  masterOrderId?: string;
  status?: GroupOrderStatus;
}

interface GroupOrderTrackingTokenResponse {
  orderId: string;
  restaurantId: string;
  tableId?: number | string;
  guestToken: string;
  tokenExpiresAt: string;
}

interface GroupOrderRealtimeTokenResponse {
  token: string;
  expiresAt?: string;
}

interface BackendGroupCartItem {
  id: string;
  itemId?: string;
  memberId: string;
  menuItemId: number;
  quantity: number;
  unitPrice?: number;
  totalPrice?: number;
  customizations?: Record<string, unknown>;
  specialInstructions?: string;
  addedAt?: string | Date | number;
  menuItem?: {
    id: number;
    name: string;
    price: number;
  };
}

interface BackendSplitBill {
  id: string;
  memberId: string;
  subtotal?: number;
  serviceCharge?: number;
  taxAmount?: number;
  totalAmount?: number;
  paymentStatus?: string;
  settledBy?: "self" | "staff" | "provider" | null;
}

interface GroupOrderSummary {
  groupOrder: BackendGroupOrder;
  members: BackendGroupMember[];
  cartItems: BackendGroupCartItem[];
  splitBills?: BackendSplitBill[];
}

interface GroupOrderRealtimeMessage {
  type?: unknown;
  data?: unknown;
}

interface GroupOrderRealtimePayload {
  groupOrderId?: unknown;
  item?: unknown;
  itemId?: unknown;
  member?: unknown;
}

interface MemberSession {
  groupOrderId: string;
  memberId: string;
  memberToken: string;
}

const memberSessions = new Map<string, MemberSession>();

interface CachedRealtimeToken {
  token: string;
  expiresAt: number;
}

const realtimeTokenCache = new Map<string, CachedRealtimeToken>();
const realtimeTokenRequests = new Map<string, Promise<CachedRealtimeToken>>();

function realtimeTokenCacheKey(
  groupOrderId: string,
  memberToken: string,
): string {
  // A token belongs to one member, not merely one cart. Sharing it between
  // different member credentials would turn a page-local optimisation into an
  // authorization bypass.
  return `${groupOrderId}:${memberToken}`;
}

function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(decoded) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function realtimeTokenExpiryMs(
  response: GroupOrderRealtimeTokenResponse,
): number | null {
  const expiresAt = response.expiresAt ? Date.parse(response.expiresAt) : NaN;
  return Number.isFinite(expiresAt) ? expiresAt : jwtExpiryMs(response.token);
}

/** Test-only reset keeps independently mocked composables from sharing state. */
export function clearGroupRealtimeTokenCacheForTest(): void {
  realtimeTokenCache.clear();
  realtimeTokenRequests.clear();
}

function saveMemberSession(session: MemberSession): void {
  memberSessions.set(session.groupOrderId, session);
  saveMemberCredentials(session);
}

function readMemberSession(groupOrderId: string): MemberSession | null {
  const session = memberSessions.get(groupOrderId);
  if (session) return session;

  const stored = readMemberCredentials(groupOrderId);
  if (!stored) return null;

  const restored = {
    groupOrderId: stored.groupOrderId,
    memberId: stored.memberId,
    memberToken: stored.memberToken,
  };
  memberSessions.set(groupOrderId, restored);
  return restored;
}

function clearMemberSession(groupOrderId: string): void {
  memberSessions.delete(groupOrderId);
  clearMemberCredentials(groupOrderId);
}

function timestamp(value: string | Date | number | null | undefined): number {
  if (value == null) return Date.now();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

function mapMember(member: BackendGroupMember): GroupMember {
  return {
    id: member.memberId ?? member.id,
    name: member.memberName,
    phone: member.phone,
    isHost: member.isHost,
    isOnline: true,
    joinedAt: timestamp(member.joinedAt),
    lastActivity: timestamp(member.lastActiveAt ?? member.joinedAt),
  };
}

/**
 * Tables are an integer-keyed table, so the create endpoint wants a number and
 * refuses a string. Anything that is not a usable table id is dropped rather
 * than sent as NaN — a group order without a table is valid, one with a broken
 * table reference is not.
 */
function toTableId(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function mapCartItem(
  item: BackendGroupCartItem,
  members: GroupMember[],
): GroupCartItem {
  const member = members.find((candidate) => candidate.id === item.memberId);

  return {
    id: item.itemId ?? item.id,
    menuItemId: String(item.menuItem?.id ?? item.menuItemId),
    menuItemName: item.menuItem?.name ?? "",
    menuItemPrice: item.menuItem?.price ?? item.unitPrice ?? 0,
    quantity: item.quantity,
    options: item.customizations,
    notes: item.specialInstructions,
    addedBy: item.memberId,
    addedByName: member?.name ?? "",
    addedAt: timestamp(item.addedAt),
  };
}

function mapSummary(summary: GroupOrderSummary): GroupOrder {
  const members = summary.members.map(mapMember);
  const host = members.find((member) => member.isHost);
  // `by_item` is the fallback for anything unrecognised, including the older
  // stored values this app no longer offers — never for a mode the host did
  // pick, which is why every offered mode is listed here.
  const splitMode: SplitBillConfig["mode"] =
    summary.groupOrder.splitType === "equal" ||
    summary.groupOrder.splitType === "proportional" ||
    summary.groupOrder.splitType === "by_item"
      ? summary.groupOrder.splitType
      : "by_item";

  return {
    id: summary.groupOrder.id,
    restaurantId: summary.groupOrder.restaurantId,
    tableId:
      summary.groupOrder.tableId == null
        ? undefined
        : String(summary.groupOrder.tableId),
    shareCode: summary.groupOrder.shareCode,
    hostId: host?.id ?? "",
    hostName: host?.name ?? "",
    status: summary.groupOrder.status,
    members,
    cartItems: summary.cartItems.map((item) => mapCartItem(item, members)),
    splitBillConfig: { mode: splitMode },
    feeMode: summary.groupOrder.feeMode ?? "proportional",
    // Empty until the host splits; that emptiness is what the UI keys off to
    // decide whether the table is still ordering or already settling.
    splitBills: (summary.splitBills ?? []).map((bill) => ({
      id: bill.id,
      memberId: bill.memberId,
      subtotal: bill.subtotal ?? 0,
      serviceCharge: bill.serviceCharge ?? 0,
      taxAmount: bill.taxAmount ?? 0,
      totalAmount: bill.totalAmount ?? 0,
      isSettled: bill.paymentStatus === "paid",
      settledBy: bill.settledBy ?? null,
    })),
    masterOrderId: summary.groupOrder.masterOrderId ?? undefined,
    createdAt: timestamp(summary.groupOrder.createdAt),
    updatedAt: timestamp(summary.groupOrder.updatedAt),
    expiresAt: timestamp(summary.groupOrder.expiresAt),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function asRealtimePayload(data: unknown): GroupOrderRealtimePayload {
  return isObject(data) ? data : {};
}

// ============================================================================
// Composable
// ============================================================================

export function useGroupOrder(options: {
  restaurantId: string;
  tableId?: string;
  userId?: string;
  userName?: string;
}) {
  const { restaurantId, tableId, userId = "", userName = "" } = options;

  // State
  const groupOrder = ref<GroupOrder | null>(null);
  const isLoading = ref(false);
  /**
   * An i18n key, never prose — whatever lands here is shown to a diner, and a
   * message baked in at the throw site can only ever be in one language.
   */
  const error = ref<string | null>(null);
  const isConnected = ref(false);
  const sessionExpired = ref(false);
  const currentMemberId = ref(userId);
  /**
   * This member's group order credential (`memberToken`), returned exactly once
   * by create/join. It is what buys a realtime token — keep it in memory only.
   */
  const memberToken = ref<string | null>(null);
  const recoveryCode = ref<string | null>(null);
  /**
   * Whether expiry turns the shared cart into a real order. Off unless the
   * host turns it on — see the toggle in GroupOrderView.
   */
  const autoSubmitOnExpiry = ref(false);
  let realtimeGroupOrderId: string | null = null;
  let realtimeUrl = "";

  function handleRealtimeMessage(message: GroupOrderRealtimeMessage): void {
    if (!groupOrder.value || typeof message.type !== "string") return;

    const payload = asRealtimePayload(message.data);
    if (payload.groupOrderId !== groupOrder.value.id) return;

    switch (message.type) {
      case RealtimeEventType.GROUP_CART_ITEM_ADDED:
        if (isObject(payload.item)) {
          handleCartItemAdded(
            mapCartItem(
              payload.item as unknown as BackendGroupCartItem,
              groupOrder.value.members,
            ),
          );
        }
        break;

      case RealtimeEventType.GROUP_CART_ITEM_UPDATED:
        if (isObject(payload.item)) {
          handleCartItemUpdated(
            mapCartItem(
              payload.item as unknown as BackendGroupCartItem,
              groupOrder.value.members,
            ),
          );
        }
        break;

      case RealtimeEventType.GROUP_CART_ITEM_REMOVED:
        if (typeof payload.itemId === "string") {
          handleCartItemRemoved({ itemId: payload.itemId });
        }
        break;

      case RealtimeEventType.GROUP_MEMBER_JOINED:
        if (isObject(payload.member)) {
          handleMemberJoined(
            mapMember(payload.member as unknown as BackendGroupMember),
          );
        }
        break;

      case RealtimeEventType.GROUP_ORDER_CREATED:
      default:
        break;
    }
  }

  // WebSocket connection
  const {
    connect,
    disconnect,
    connectionStatus: _connectionStatus,
  } = useWebSocket({
    getUrl: async () => realtimeUrl,
    onMessage: handleRealtimeMessage,
    onClose: () => {
      isConnected.value = false;
    },
    onAuthFailure: async () => {
      if (!realtimeGroupOrderId || !memberToken.value) return;
      realtimeTokenCache.delete(
        realtimeTokenCacheKey(realtimeGroupOrderId, memberToken.value),
      );
      realtimeUrl = await buildGroupRealtimeUrl(realtimeGroupOrderId);
    },
  });

  // Computed
  const isHost = computed(
    () => groupOrder.value?.hostId === currentMemberId.value,
  );

  const myItems = computed(
    () =>
      groupOrder.value?.cartItems.filter(
        (item) => item.addedBy === currentMemberId.value,
      ) || [],
  );

  const totalAmount = computed(
    () =>
      groupOrder.value?.cartItems.reduce(
        (sum, item) => sum + item.menuItemPrice * item.quantity,
        0,
      ) || 0,
  );

  /**
   * The restaurant's own rates, fed in by the view from the same endpoint the
   * ordinary cart reads. Never hardcode them: a preview built on guessed rates
   * shows a number the kitchen will not charge.
   */
  const chargeRates = ref({ serviceChargeRate: 0, taxRate: 0 });

  function setChargeRates(rates: {
    serviceChargeRate?: number;
    taxRate?: number;
  }): void {
    chargeRates.value = {
      serviceChargeRate: Number.isFinite(rates.serviceChargeRate)
        ? (rates.serviceChargeRate as number)
        : 0,
      taxRate: Number.isFinite(rates.taxRate) ? (rates.taxRate as number) : 0,
    };
  }

  /** My food, before any fee — the part that depends on the split method. */
  const mySubtotal = computed(() => {
    if (!groupOrder.value) return 0;

    if (groupOrder.value.splitBillConfig.mode === "equal") {
      const memberCount = groupOrder.value.members.length;
      return memberCount > 0 ? totalAmount.value / memberCount : 0;
    }

    return myItems.value.reduce(
      (sum, item) => sum + item.menuItemPrice * item.quantity,
      0,
    );
  });

  /**
   * Mirrors the server's fee allocation (GroupOrdersService.splitBill). It has
   * to be duplicated because the server only divides the bill at checkout, and
   * a diner deciding what to order needs the number now — but the two are
   * pinned to the same cases and the same figures in their tests.
   */
  function myShareOfFee(rate: number): number {
    if (!groupOrder.value || rate === 0) return 0;

    const wholeFee = totalAmount.value * rate;
    const feeMode = groupOrder.value.feeMode;

    if (feeMode === "host") {
      return isHost.value ? wholeFee : 0;
    }

    if (feeMode === "equal") {
      const memberCount = groupOrder.value.members.length;
      return memberCount > 0 ? wholeFee / memberCount : 0;
    }

    return mySubtotal.value * rate;
  }

  const myServiceCharge = computed(() =>
    myShareOfFee(chargeRates.value.serviceChargeRate),
  );
  const myTax = computed(() => myShareOfFee(chargeRates.value.taxRate));

  const myShare = computed(
    () => mySubtotal.value + myServiceCharge.value + myTax.value,
  );

  const onlineMembers = computed(
    () => groupOrder.value?.members.filter((m) => m.isOnline) || [],
  );

  // Methods
  async function createGroupOrder(
    createOptions: CreateGroupOrderOptions = {},
  ): Promise<string | null> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.post<CreateGroupOrderResponse>(
        "/orders/group/create",
        {
          restaurantId,
          // Route params are strings, but `table_id` is an integer column and
          // the create schema rejects a string outright — the same coercion
          // `addToCart` already does for `menuItemId`.
          tableId: toTableId(createOptions.tableId ?? tableId),
          hostName: createOptions.hostName ?? userName,
        },
      );

      if (response?.groupOrderId) {
        memberToken.value = response.memberToken;
        recoveryCode.value = response.recoveryCode;
        currentMemberId.value = response.host.memberId ?? response.host.id;
        const groupOrderId = response.groupOrderId;
        saveHostCredentials({
          groupOrderId,
          memberToken: response.memberToken,
          memberId: currentMemberId.value,
          recoveryCode: response.recoveryCode,
        });
        await loadGroupOrder(groupOrderId, response);
        return groupOrderId;
      } else {
        throw groupOrderError("GROUP_CREATE_FAILED");
      }
    } catch (err) {
      error.value = getGroupOrderErrorI18nKey(err, "group.createFailed");
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Join via share code. This is the only way a non-host obtains a
   * memberToken, so it must run before any realtime connection is attempted.
   */
  async function joinGroupOrder(
    shareCode: string,
    memberName = userName,
  ): Promise<boolean> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.post<JoinGroupOrderResponse>(
        `/orders/group/join/${shareCode}`,
        {
          memberName,
        },
      );

      if (!response?.memberToken) {
        throw groupOrderError("GROUP_JOIN_FAILED");
      }

      memberToken.value = response.memberToken;
      currentMemberId.value = response.member.memberId ?? response.member.id;
      saveMemberSession({
        groupOrderId: response.groupOrder.id,
        memberId: currentMemberId.value,
        memberToken: response.memberToken,
      });
      await loadGroupOrder(response.groupOrder.id);

      return true;
    } catch (err) {
      error.value = getGroupOrderErrorI18nKey(err, "groupJoin.joinFailed");
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  async function loadGroupOrder(
    groupOrderId: string,
    createResponse?: CreateGroupOrderResponse,
  ): Promise<void> {
    const summary = await apiClient.get<GroupOrderSummary>(
      `/orders/group/${groupOrderId}`,
    );
    if (summary) {
      groupOrder.value = {
        ...mapSummary(summary),
        shareCode: summary.groupOrder.shareCode ?? createResponse?.shareCode,
      };
      autoSubmitOnExpiry.value = summary.groupOrder.autoSubmitOnExpiry === true;
      hydrateMemberSession(groupOrderId);
      hydrateHostCredentials(groupOrderId);
      if (memberToken.value) {
        saveActiveGroupOrder({
          groupOrderId,
          restaurantId: groupOrder.value.restaurantId,
          tableId: groupOrder.value.tableId,
        });
      }
    }
  }

  async function connectToGroupOrder(groupOrderId: string): Promise<void> {
    try {
      hydrateMemberSession(groupOrderId);
      hydrateHostCredentials(groupOrderId);
      if (!memberToken.value) {
        // Without a membership credential there is no way to prove this client
        // belongs in the room. The public token endpoint deliberately refuses
        // customer rooms — it could not verify the caller, so anyone could read
        // every member's name, phone, and cart (issue #96).
        throw groupOrderError("GROUP_NOT_A_MEMBER");
      }

      // A single view can initialise twice while routing settles. More
      // importantly, a restored cart should not exchange another credential
      // just because Vue remounted it.
      if (isConnected.value) return;

      realtimeGroupOrderId = groupOrderId;
      realtimeUrl = await buildGroupRealtimeUrl(groupOrderId);
      connect(realtimeUrl);

      isConnected.value = true;
      sessionExpired.value = false;
      console.log("Connected to group order WebSocket");
    } catch (err: unknown) {
      console.error("Failed to connect to group order:", err);
      if (isAuthError(err)) {
        sessionExpired.value = true;
        // The status already says exactly what happened, so name the key
        // outright rather than resolving one off the thrown error.
        error.value = "group.sessionExpiredNotice";
      } else {
        error.value = getGroupOrderErrorI18nKey(err, "group.connectionError");
      }
      throw err;
    }
  }

  async function buildGroupRealtimeUrl(groupOrderId: string): Promise<string> {
    const realtimeBaseUrl = import.meta.env.VITE_REALTIME_URL;
    if (!realtimeBaseUrl) {
      throw new Error(
        "[Config Error] VITE_REALTIME_URL is required for group order WebSocket. " +
          "Please set this environment variable in your .env file.",
      );
    }
    if (!memberToken.value) {
      throw groupOrderError("GROUP_NOT_A_MEMBER");
    }

    const token = await getGroupRealtimeToken(groupOrderId, memberToken.value);
    return `${realtimeBaseUrl}/customer/${groupOrderId}?token=${token}`;
  }

  async function getGroupRealtimeToken(
    groupOrderId: string,
    currentMemberToken: string,
  ): Promise<string> {
    const key = realtimeTokenCacheKey(groupOrderId, currentMemberToken);
    const cached = realtimeTokenCache.get(key);
    if (cached && cached.expiresAt - Date.now() > 60_000) {
      return cached.token;
    }

    const pending = realtimeTokenRequests.get(key);
    if (pending) {
      return (await pending).token;
    }

    const request = apiClient
      .post<GroupOrderRealtimeTokenResponse>("/realtime/auth/group-token", {
        groupOrderId,
        memberToken: currentMemberToken,
      })
      .then((response) => {
        if (!response?.token) {
          throw groupOrderError("GROUP_REALTIME_TOKEN_FAILED");
        }

        const cachedToken = {
          token: response.token,
          // The API supplies `expiresAt`. A malformed response remains usable
          // once, but gets an immediately stale value and is never reused.
          expiresAt: realtimeTokenExpiryMs(response) ?? 0,
        };
        if (cachedToken.expiresAt > Date.now()) {
          realtimeTokenCache.set(key, cachedToken);
        }
        return cachedToken;
      })
      .finally(() => {
        realtimeTokenRequests.delete(key);
      });
    realtimeTokenRequests.set(key, request);

    return (await request).token;
  }

  function hydrateHostCredentials(groupOrderId: string): void {
    if (memberToken.value) return;

    const credentials = readHostCredentials(groupOrderId);
    if (!credentials) return;

    memberToken.value = credentials.memberToken;
    recoveryCode.value = credentials.recoveryCode;
    if (credentials.memberId) {
      currentMemberId.value = credentials.memberId;
    } else if (
      groupOrder.value?.id === groupOrderId &&
      groupOrder.value.hostId
    ) {
      currentMemberId.value = groupOrder.value.hostId;
    }
  }

  function hydrateMemberSession(groupOrderId: string): void {
    if (memberToken.value) return;

    const session = readMemberSession(groupOrderId);
    if (!session) return;

    memberToken.value = session.memberToken;
    currentMemberId.value = session.memberId;
  }

  function isAuthError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const status = (err as { status?: unknown }).status;
    return status === 401 || status === 403;
  }

  function handleCartItemAdded(item: GroupCartItem): void {
    if (!groupOrder.value) return;
    if (
      groupOrder.value.cartItems.some((existing) => existing.id === item.id)
    ) {
      handleCartItemUpdated(item);
      return;
    }
    groupOrder.value.cartItems.push(item);
    groupOrder.value.updatedAt = Date.now();
  }

  function handleCartItemUpdated(updatedItem: GroupCartItem): void {
    if (!groupOrder.value) return;
    const index = groupOrder.value.cartItems.findIndex(
      (i) => i.id === updatedItem.id,
    );
    if (index !== -1) {
      const existingItem = groupOrder.value.cartItems[index];
      groupOrder.value.cartItems[index] = {
        ...existingItem,
        ...updatedItem,
        menuItemName: updatedItem.menuItemName || existingItem.menuItemName,
        addedByName: updatedItem.addedByName || existingItem.addedByName,
      };
      groupOrder.value.updatedAt = Date.now();
    }
  }

  function handleCartItemRemoved(data: { itemId: string }): void {
    if (!groupOrder.value) return;
    groupOrder.value.cartItems = groupOrder.value.cartItems.filter(
      (i) => i.id !== data.itemId,
    );
    groupOrder.value.updatedAt = Date.now();
  }

  function handleMemberJoined(member: GroupMember): void {
    if (!groupOrder.value) return;
    if (!groupOrder.value.members.find((m) => m.id === member.id)) {
      groupOrder.value.members.push(member);
    }
  }

  // Cart operations
  async function addToCart(
    item: Omit<GroupCartItem, "id" | "addedBy" | "addedByName" | "addedAt">,
  ): Promise<void> {
    if (!groupOrder.value) return;

    const cartItem = await apiClient.post<BackendGroupCartItem>(
      `/orders/group/${groupOrder.value.id}/cart`,
      {
        memberId: currentMemberId.value || groupOrder.value.hostId,
        memberToken: memberToken.value,
        menuItemId: Number(item.menuItemId),
        quantity: item.quantity,
        customizations: item.options ?? {},
        specialInstructions: item.notes,
      },
    );

    handleCartItemAdded(mapCartItem(cartItem, groupOrder.value.members));
  }

  async function updateCartItem(
    itemId: string,
    updates: Partial<GroupCartItem>,
  ): Promise<void> {
    if (!groupOrder.value) return;

    const updatedItem = await apiClient.put<BackendGroupCartItem>(
      `/orders/group/${groupOrder.value.id}/cart/${itemId}`,
      {
        memberId: currentMemberId.value || groupOrder.value.hostId,
        memberToken: memberToken.value,
        quantity: updates.quantity,
        customizations: updates.options,
        specialInstructions: updates.notes,
      },
    );

    handleCartItemUpdated(mapCartItem(updatedItem, groupOrder.value.members));
  }

  async function removeFromCart(itemId: string): Promise<void> {
    if (!groupOrder.value) return;

    await apiClient.delete(
      `/orders/group/${groupOrder.value.id}/cart/${itemId}`,
      {
        memberId: currentMemberId.value || groupOrder.value.hostId,
        memberToken: memberToken.value,
      },
    );
    handleCartItemRemoved({ itemId });
  }

  // Split bill operations
  /**
   * Host only. Records who carries the service charge and tax — the food is
   * divided by `setSplitBillMode`, this is the fee on top of it.
   */
  async function setFeeMode(mode: GroupOrderFeeMode): Promise<void> {
    if (!groupOrder.value) {
      throw groupOrderError("GROUP_NOT_LOADED");
    }

    const groupOrderId = groupOrder.value.id;
    hydrateHostCredentials(groupOrderId);
    if (!memberToken.value) {
      throw groupOrderError("GROUP_HOST_CREDENTIAL_REQUIRED");
    }

    await apiClient.put(`/orders/group/${groupOrderId}/fee-mode`, {
      feeMode: mode,
      memberToken: memberToken.value,
    });
    await loadGroupOrder(groupOrderId);
  }

  /**
   * Host only. Records how finalize should divide the bill — it does not
   * perform the split, so the table keeps ordering afterwards.
   */
  async function setSplitBillMode(
    mode: SplitBillConfig["mode"],
  ): Promise<void> {
    if (!groupOrder.value) {
      throw groupOrderError("GROUP_NOT_LOADED");
    }

    const groupOrderId = groupOrder.value.id;
    hydrateHostCredentials(groupOrderId);
    if (!memberToken.value) {
      throw groupOrderError("GROUP_HOST_CREDENTIAL_REQUIRED");
    }

    await apiClient.put(`/orders/group/${groupOrderId}/split-type`, {
      splitType: mode,
      memberToken: memberToken.value,
    });
    await loadGroupOrder(groupOrderId);
  }

  /**
   * Marks this diner's own share settled. No money moves — it tells the table
   * who has sorted themselves out.
   */
  async function settleMyShare(): Promise<void> {
    if (!groupOrder.value || !currentMemberId.value) return;

    const groupOrderId = groupOrder.value.id;
    await apiClient.post(
      `/orders/group/${groupOrderId}/payment/${currentMemberId.value}`,
      {
        paymentMethod: "cash",
        memberToken: memberToken.value,
      },
    );
    await loadGroupOrder(groupOrderId);
  }

  const splitBills = computed(() => groupOrder.value?.splitBills ?? []);
  const isSettling = computed(() => splitBills.value.length > 0);
  const mySplitBill = computed(() =>
    splitBills.value.find((bill) => bill.memberId === currentMemberId.value),
  );
  const settledCount = computed(
    () => splitBills.value.filter((bill) => bill.isSettled).length,
  );

  // Leave group order
  async function leaveGroupOrder(): Promise<void> {
    if (!groupOrder.value) return;

    const groupOrderId = groupOrder.value.id;
    await apiClient.post(
      `/orders/group/${groupOrderId}/leave/${currentMemberId.value}`,
      {
        memberToken: memberToken.value,
      },
    );
    disconnect();
    clearMemberSession(groupOrderId);
    if (isHost.value) {
      clearHostCredentials(groupOrderId);
    }
    groupOrder.value = null;
    isConnected.value = false;
    memberToken.value = null;
    recoveryCode.value = null;
  }

  function disconnectRealtime(): void {
    disconnect();
    isConnected.value = false;
    realtimeGroupOrderId = null;
    realtimeUrl = "";
  }

  /**
   * Host only. The local flag is set from the server's answer rather than
   * optimistically, so a refusal leaves the toggle showing what is actually
   * true — telling a host their table is covered when it is not is worse than
   * a slow toggle.
   */
  async function setAutoSubmitOnExpiry(enabled: boolean): Promise<void> {
    if (!groupOrder.value) {
      throw groupOrderError("GROUP_NOT_LOADED");
    }

    const groupOrderId = groupOrder.value.id;
    hydrateHostCredentials(groupOrderId);
    if (!memberToken.value) {
      throw groupOrderError("GROUP_HOST_CREDENTIAL_REQUIRED");
    }

    await apiClient.put(`/orders/group/${groupOrderId}/auto-submit`, {
      enabled,
      memberToken: memberToken.value,
    });
    autoSubmitOnExpiry.value = enabled;
  }

  // Submit order (host only)
  async function submitOrder(): Promise<void> {
    if (!groupOrder.value) {
      throw groupOrderError("GROUP_NOT_LOADED");
    }

    const groupOrderId = groupOrder.value.id;
    hydrateHostCredentials(groupOrderId);
    if (!memberToken.value) {
      throw groupOrderError("GROUP_HOST_CREDENTIAL_REQUIRED");
    }

    try {
      await apiClient.post<SubmitGroupOrderResponse>(
        `/orders/group/${groupOrderId}/lock`,
        {
          memberToken: memberToken.value,
        },
      );
      await loadGroupOrder(groupOrderId);
    } catch (submitError) {
      if (isForbiddenError(submitError)) {
        throw annotateError(submitError, { isHostOnly: true });
      }

      if (isBadRequestError(submitError)) {
        await loadGroupOrder(groupOrderId);
        if (groupOrder.value?.status === "finalizing_failed") {
          throw annotateError(submitError, { orderAlreadyPlaced: true });
        }
      }

      throw submitError;
    }
  }

  async function getOrderTrackingToken(): Promise<GroupOrderTrackingTokenResponse> {
    if (!groupOrder.value) {
      throw groupOrderError("GROUP_NOT_LOADED");
    }

    const groupOrderId = groupOrder.value.id;
    hydrateMemberSession(groupOrderId);
    hydrateHostCredentials(groupOrderId);
    if (!memberToken.value) {
      throw groupOrderError("GROUP_NOT_A_MEMBER");
    }

    const response = await apiClient.post<GroupOrderTrackingTokenResponse>(
      `/orders/group/${groupOrderId}/tracking-token`,
      { memberToken: memberToken.value },
    );
    if (!response?.orderId || !response.guestToken) {
      throw groupOrderError("GROUP_UNKNOWN");
    }
    return response;
  }

  function isForbiddenError(err: unknown): boolean {
    return getErrorStatus(err) === 403;
  }

  function isBadRequestError(err: unknown): boolean {
    return getErrorStatus(err) === 400;
  }

  function getErrorStatus(err: unknown): unknown {
    return err && typeof err === "object"
      ? (err as { status?: unknown }).status
      : undefined;
  }

  function annotateError<T extends Record<string, boolean>>(
    err: unknown,
    flags: T,
  ): Error & T {
    const error = err instanceof Error ? err : groupOrderError("GROUP_UNKNOWN");
    return Object.assign(error, flags);
  }

  async function recoverHost(
    groupOrderId: string,
    code: string,
  ): Promise<void> {
    const normalizedCode = code.trim().toLowerCase();
    if (!normalizedCode) {
      throw groupOrderError("GROUP_RECOVERY_CODE_REQUIRED");
    }

    const response = await apiClient.post<RecoverHostResponse>(
      `/orders/group/${groupOrderId}/recover`,
      {
        recoveryCode: normalizedCode,
      },
    );

    if (!response?.memberToken) {
      throw groupOrderError("GROUP_RECOVER_FAILED");
    }

    const storedRecoveryCode =
      readHostCredentials(groupOrderId)?.recoveryCode ?? normalizedCode;
    saveHostCredentials({
      groupOrderId,
      memberToken: response.memberToken,
      memberId: groupOrder.value?.hostId,
      recoveryCode: storedRecoveryCode,
    });
    updateHostMemberToken(groupOrderId, response.memberToken);

    disconnectRealtime();
    memberToken.value = response.memberToken;
    recoveryCode.value = storedRecoveryCode;
    sessionExpired.value = false;
    await loadGroupOrder(groupOrderId);
    if (groupOrder.value?.id === groupOrderId && groupOrder.value.hostId) {
      currentMemberId.value = groupOrder.value.hostId;
    }
    await connectToGroupOrder(groupOrderId);
  }

  // Generate share link/QR code
  function getShareLink(): string {
    if (!groupOrder.value) return "";
    const baseUrl = window.location.origin;
    return `${baseUrl}/group/${groupOrder.value.shareCode}`;
  }

  // Cleanup
  // The composable is also used by non-component consumers (for example,
  // route loaders and unit tests). Vue only permits lifecycle registration
  // while a component instance is active.
  if (getCurrentInstance()) {
    onUnmounted(() => {
      if (isConnected.value) {
        disconnectRealtime();
      }
    });
  }

  return {
    // State
    groupOrder,
    isLoading,
    error,
    isConnected,
    sessionExpired,
    currentMemberId,
    recoveryCode,
    autoSubmitOnExpiry,
    mySubtotal,
    myServiceCharge,
    myTax,

    // Computed
    isHost,
    myItems,
    totalAmount,
    myShare,
    onlineMembers,

    // Methods
    createGroupOrder,
    joinGroupOrder,
    loadGroupOrder,
    connectToGroupOrder,
    disconnectRealtime,
    leaveGroupOrder,
    addToCart,
    updateCartItem,
    removeFromCart,
    setSplitBillMode,
    setFeeMode,
    settleMyShare,
    splitBills,
    isSettling,
    mySplitBill,
    settledCount,
    submitOrder,
    getOrderTrackingToken,
    setAutoSubmitOnExpiry,
    setChargeRates,
    recoverHost,
    getShareLink,
  };
}
