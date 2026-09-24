import type {
  CallWaitingRequest,
  JoinWaitingListRequest,
  NewOrderEvent,
  Order,
  QueueStatus,
  TableAssignmentResult,
  WaitingListEntry,
  WaitingListEvent,
  WaitingListFilters,
  WaitingListResponse,
  WaitingStats,
  WaitTimeEstimateRequest,
  WaitTimeEstimateResult,
} from "@makanmasak/shared-types";
import type { D1Database } from "@cloudflare/workers-types";
import { RealtimeEventType, WaitingStatus } from "@makanmasak/shared-types";
import { sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { forbidden } from "@makanmasak/utils";
import { restaurants } from "../schema/restaurants";
import { tables as restaurantTables } from "../schema/tables";
import { waitingList } from "../schema/waiting-list";
import {
  businessDateFromUnixMsSql,
  businessDateSql,
} from "../utils/business-day";
import {
  BusinessTimezoneResolver,
  PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES,
} from "../utils/business-timezone";
import { CustomerWebPushService } from "./CustomerWebPushService";
import { RealtimeBroadcastService } from "./RealtimeBroadcastService";
import { BaseService, type CloudflareEnv } from "./base";
import { OrderService } from "./order";
import { DEFAULT_TABLE_OCCUPANCY_MS } from "./table-state";
import { assertWaitingTransition } from "./ticket-primitives";

/** Call timeout: 5 minutes */
const CALL_TIMEOUT_MS = 5 * 60 * 1000;
/** Default turnover estimate when no data: 45 minutes */
const DEFAULT_TURNOVER_MINUTES = 45;
/** Default wait estimate on error: 30 minutes */
const DEFAULT_WAIT_MINUTES = 30;

const WAITING_LIST_REALTIME_EVENT = {
  JOINED: "waiting_list_joined" as WaitingListEvent["type"],
  CALLED: "waiting_list_called" as WaitingListEvent["type"],
  CONFIRMED: "waiting_list_confirmed" as WaitingListEvent["type"],
  SEATED: "waiting_list_seated" as WaitingListEvent["type"],
  CANCELLED: "waiting_list_cancelled" as WaitingListEvent["type"],
  EXPIRED: "waiting_list_expired" as WaitingListEvent["type"],
} as const;

type TableStatusAction = "reserved" | "occupied" | "available";

interface WaitingListDbRow {
  id: string;
  restaurant_id: string;
  customer_id?: string | null;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  preferred_table_type?: string | null;
  queue_number: number;
  queue_letter?: string | null;
  queue_date?: string | null;
  priority: number;
  estimated_wait_minutes?: number | null;
  table_id?: number | null;
  status: WaitingStatus;
  notes?: string | null;
  created_at: number;
  called_at?: number | null;
  notified_at?: number | null;
  confirmed_at?: number | null;
  seated_at?: number | null;
  cancelled_at?: number | null;
  expired_at?: number | null;
  timeout_at?: number | null;
  updated_at: number;
  table?: string | null;
  table_json?: string | null;
}

interface AvailableTableRow {
  id: number;
  table_number?: string | null;
  capacity: number;
}

interface WaitingStatsRow {
  total_waiting?: number | null;
  seated_count?: number | null;
  expired_count?: number | null;
  cancelled_count?: number | null;
  avg_wait_minutes?: number | null;
  expire_rate?: number | null;
}

interface QueueNumberRow {
  max_number?: number | null;
}

interface CountRow {
  count?: number | null;
}

interface WaitingPartySizeRow {
  id: string;
  party_size: number;
}

interface TurnoverEstimateRow {
  avg_turnover_minutes?: number | null;
}

interface OccupiedTableCountRow {
  occupied_count?: number | null;
  earliest_available?: number | null;
}

interface QueueStatusCountRow {
  total?: number | null;
  wait_2?: number | null;
  wait_4?: number | null;
  wait_6?: number | null;
}

const getMutationChanges = (result: unknown): number => {
  if (typeof result !== "object" || result === null || !("meta" in result)) {
    return 0;
  }

  const meta = (result as { meta?: { changes?: unknown } }).meta;
  return typeof meta?.changes === "number" ? meta.changes : 0;
};

export class WaitingListService extends BaseService {
  private readonly businessTimezone = new BusinessTimezoneResolver(this.db);

  /**
   * `queue_date` is a business day, so it has to be cut at the restaurant's
   * own midnight (#329): on a hardcoded +8 a GMT+9 shop's 00:30 walk-in was
   * filed under yesterday's queue and then invisible to every "today" lookup
   * that follows -- including the duplicate check and the queue numbering.
   */
  private async queueDateSql(restaurantId: string) {
    return businessDateSql(
      await this.businessTimezone.offsetMinutes(restaurantId),
    );
  }

  private backgroundTasks: Promise<void>[] = [];

  constructor(d1: D1Database, env: CloudflareEnv) {
    super(d1, env);
  }

  drainBackgroundTasks(): Promise<void>[] {
    const tasks = this.backgroundTasks;
    this.backgroundTasks = [];
    return tasks;
  }

  /**
   * 非阻塞發送候位通知（失敗不影響主流程）
   */
  private async sendWaitingNotification(
    phone: string,
    category:
      | "waiting_list_confirmed"
      | "waiting_list_called"
      | "waiting_list_expired",
    data: Record<string, string>,
  ): Promise<void> {
    try {
      const { createSmsProvider } = await import("./sms");
      const provider = createSmsProvider(this.env);
      if (provider.name === "noop") return; // SMS not configured, skip

      const { notificationTemplates } = await import("./NotificationService");
      const template = notificationTemplates[category];
      if (!template?.body) return;

      let body = template.body;
      for (const [key, value] of Object.entries(data)) {
        body = body.split(`{{${key}}}`).join(value);
      }

      await provider.sendSMS({ to: phone, body });
    } catch (error) {
      console.error(`Waiting list notification failed (${category}):`, error);
      // Intentionally swallowed — notification failure must not block operation
    }
  }

  /**
   * G1: Broadcast a waiting-list lifecycle event to admin-dashboard
   * via the realtime DO. Failures are swallowed by the broadcaster
   * itself; this never fails the originating mutation.
   *
   * Room: `admin:${restaurantId}` — that's where useRealtimeOrderStatus
   * already connects, so the dashboard receives it without any new
   * subscription wiring.
   */
  private async broadcastWaitingListEvent(
    eventType: WaitingListEvent["type"],
    entry: WaitingListResponse,
  ): Promise<void> {
    // Cast: CloudflareEnv (BaseService) is a superset of BroadcastEnv;
    // RealtimeBroadcastService only reads REALTIME_SESSION at runtime.
    const broadcaster = new RealtimeBroadcastService(
      this.env as unknown as ConstructorParameters<
        typeof RealtimeBroadcastService
      >[0],
    );
    const event: WaitingListEvent = {
      type: eventType,
      eventId: broadcaster.generateEventId(),
      timestamp: Date.now(),
      restaurantId: entry.restaurantId,
      data: {
        entryId: entry.id,
        queueDisplay: entry.queueDisplay,
        status: entry.status,
        partiesAhead: entry.partiesAhead,
        tableId: entry.tableId ?? null,
        customerName: entry.customerName,
      },
    };
    await broadcaster.broadcastEvent("admin", entry.restaurantId, event);
  }

  private async broadcastSeatedPreOrders(orders: Order[]): Promise<void> {
    if (orders.length === 0) {
      return;
    }

    const broadcaster = new RealtimeBroadcastService(
      this.env as unknown as ConstructorParameters<
        typeof RealtimeBroadcastService
      >[0],
    );

    await Promise.all(
      orders.map((order) => {
        const event: NewOrderEvent = {
          type: RealtimeEventType.NEW_ORDER,
          eventId: broadcaster.generateEventId(),
          timestamp: Date.now(),
          restaurantId: order.restaurantId,
          data: {
            orderId: order.id,
            orderNumber: order.orderNumber || `#${order.id}`,
            tableId: order.tableId ? String(order.tableId) : undefined,
            items: (order.items || []).map((item) => ({
              orderItemId: Number(item.id),
              menuItemId: item.menuItemId,
              menuItemName:
                item.menuItem?.name || item.itemSnapshot?.name || "",
              quantity: item.quantity,
              price: item.unitPrice,
              notes: item.notes,
            })),
            totalAmount: order.totalAmount,
            notes: order.notes,
            customer: order.customerInfo
              ? {
                  name: order.customerInfo.name,
                  phone: order.customerInfo.phone,
                }
              : undefined,
          },
        };
        return broadcaster.broadcastNewOrder(event);
      }),
    );
  }

  /**
   * 加入候位列表
   */
  async joinWaitingList(
    data: JoinWaitingListRequest,
  ): Promise<WaitingListResponse> {
    try {
      const now = Date.now();

      // 1. 驗證輸入
      this.validateWaitingListData(data);

      // 平台示範店（0033）不收候位：潛在店家可以逛，但不能真的排進隊伍。
      const demo = await this.db.get<{ isDemo: number }>(sql`
        SELECT ${restaurants.isDemo} AS isDemo FROM ${restaurants}
        WHERE ${restaurants.id} = ${data.restaurantId}
      `);
      if (demo?.isDemo) {
        throw forbidden(
          "This is a demo restaurant. Orders and bookings are not accepted.",
          "DEMO_RESTAURANT",
        );
      }

      const offsetMinutes = await this.businessTimezone.offsetMinutes(
        data.restaurantId,
      );
      const queueDate = businessDateSql(offsetMinutes);

      // 2. 檢查是否已在候位中——idempotent: 同手機同餐廳同日已有 active 票就回傳現有票
      const existingEntry = await this.db.get<{ id: string }>(sql`
        SELECT id FROM waiting_list
        WHERE restaurant_id = ${data.restaurantId}
          AND customer_phone = ${data.customerPhone}
          AND status IN ('waiting', 'called', 'confirmed')
          AND queue_date = ${queueDate}
      `);

      if (existingEntry) {
        const existing = await this.getWaitingListEntryById(existingEntry.id);
        if (existing) {
          // G4: don't reject — let the client see the ticket they already
          // own. `alreadyJoined: true` lets the UI distinguish "first
          // time" from "you already had a ticket open".
          return { ...existing, alreadyJoined: true };
        }
        // Race: dedup query saw it but full lookup didn't (cancelled/
        // expired between the two reads). Fall through and create a
        // fresh ticket.
      }

      // 3. 生成排隊號碼
      const queueInfo = await this.generateQueueNumber(
        data.restaurantId,
        data.partySize,
      );

      // 4. 預估等待時間
      const waitEstimate = await this.estimateWaitTime({
        restaurantId: data.restaurantId,
        partySize: data.partySize,
      });

      // 5. 建立候位記錄
      const id = this.generateUUID();
      const entry: Partial<WaitingListEntry> = {
        id,
        restaurantId: data.restaurantId,
        customerId: data.customerId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        partySize: data.partySize,
        preferredTableType: data.preferredTableType,
        queueNumber: queueInfo.number,
        queueLetter: queueInfo.letter,
        priority: 0, // 默認優先級
        estimatedWaitMinutes: waitEstimate.estimatedWaitMinutes,
        status: "waiting" as WaitingStatus,
        notes: data.notes,
        createdAt: now,
        updatedAt: now,
      };

      await this.db.run(sql`
        INSERT INTO waiting_list (
          id, restaurant_id, customer_id, customer_name, customer_phone,
          party_size, preferred_table_type, queue_number, queue_letter,
          queue_date, priority, estimated_wait_minutes, status, notes,
          created_at, updated_at
        ) VALUES (
          ${entry.id}, ${entry.restaurantId}, ${entry.customerId ?? null}, ${entry.customerName},
          ${entry.customerPhone}, ${entry.partySize}, ${entry.preferredTableType ?? null},
          ${entry.queueNumber}, ${entry.queueLetter},
          ${businessDateFromUnixMsSql(entry.createdAt!, offsetMinutes)},
          ${entry.priority},
          ${entry.estimatedWaitMinutes}, ${entry.status}, ${entry.notes ?? null},
          ${entry.createdAt}, ${entry.updatedAt}
        )
      `);

      // 發送候位確認通知（非阻塞）
      this.queueBackgroundTask(
        this.sendWaitingNotification(
          data.customerPhone,
          "waiting_list_confirmed",
          {
            customerName: data.customerName,
            queueNumber: `${entry.queueLetter}${entry.queueNumber}`,
            estimatedWait: String(
              entry.estimatedWaitMinutes || DEFAULT_WAIT_MINUTES,
            ),
          },
        ),
      );

      // Construct response from local data to avoid a redundant DB round-trip
      const response: WaitingListResponse = {
        id: entry.id!,
        restaurantId: entry.restaurantId!,
        customerId: entry.customerId ?? undefined,
        customerName: entry.customerName!,
        customerPhone: entry.customerPhone!,
        partySize: entry.partySize!,
        preferredTableType: entry.preferredTableType ?? undefined,
        queueNumber: entry.queueNumber!,
        queueLetter: entry.queueLetter,
        queueDisplay: `${entry.queueLetter || ""}${String(entry.queueNumber).padStart(3, "0")}`,
        priority: entry.priority!,
        estimatedWaitMinutes: entry.estimatedWaitMinutes,
        status: entry.status!,
        notes: entry.notes ?? undefined,
        createdAt: entry.createdAt!,
        updatedAt: entry.updatedAt!,
        partiesAhead: waitEstimate.partiesAhead,
      } as WaitingListResponse;

      await this.broadcastWaitingListEvent(
        WAITING_LIST_REALTIME_EVENT.JOINED,
        response,
      );

      return response;
    } catch (error) {
      console.error("Error joining waiting list:", error);
      throw error;
    }
  }

  /**
   * G3: 依手機號碼找回當日 active 票（為客戶遺失 ticketId 後的 fallback）。
   * 只回傳 status in (waiting | called | confirmed)；終態票（cancelled /
   * seated / expired / no_show）一律視為「無 active 票」回 null，避免
   * 洩漏歷史資訊。配合 G4 冪等保證：同手機 + 同日 active 唯一。
   */
  async findActiveTicketByPhone(
    restaurantId: string,
    customerPhone: string,
  ): Promise<WaitingListResponse | null> {
    try {
      const result = await this.db.get<WaitingListDbRow>(sql`
        SELECT
          w.*,
          json_object(
            'id', t.id,
            'number', t.number,
            'capacity', t.capacity
          ) as table_json
        FROM waiting_list w
        LEFT JOIN tables t ON w.table_id = t.id
        WHERE w.restaurant_id = ${restaurantId}
          AND w.customer_phone = ${customerPhone}
          AND w.status IN ('waiting', 'called', 'confirmed')
          AND w.queue_date = ${await this.queueDateSql(restaurantId)}
        LIMIT 1
      `);

      if (!result) return null;

      const partiesAhead = await this.getPartiesAhead(
        result.restaurant_id,
        result.queue_number,
        result.party_size,
      );

      return this.formatWaitingListResponse(result, partiesAhead);
    } catch (error) {
      console.error("Error finding active ticket by phone:", error);
      throw error;
    }
  }

  async listWaitingListHistoryByPhone(
    restaurantId: string,
    customerPhone: string,
    limit = 20,
  ): Promise<WaitingListResponse[]> {
    try {
      const safeLimit = Math.min(Math.max(limit, 1), 50);
      const results = await this.db.all<WaitingListDbRow>(sql`
        SELECT
          w.*,
          json_object(
            'id', t.id,
            'number', t.number,
            'capacity', t.capacity
          ) as table_json
        FROM waiting_list w
        LEFT JOIN tables t ON w.table_id = t.id
        WHERE w.restaurant_id = ${restaurantId}
          AND w.customer_phone = ${customerPhone}
        ORDER BY w.created_at DESC
        LIMIT ${safeLimit}
      `);

      return Promise.all(
        results.map(async (result) => {
          const partiesAhead =
            result.status === WaitingStatus.WAITING
              ? await this.getPartiesAhead(
                  result.restaurant_id,
                  result.queue_number,
                  result.party_size,
                )
              : 0;
          return this.formatWaitingListResponse(result, partiesAhead);
        }),
      );
    } catch (error) {
      console.error("Error listing waiting list history by phone:", error);
      throw error;
    }
  }

  /**
   * 根據 ID 查詢候位記錄
   */
  async getWaitingListEntryById(
    id: string,
  ): Promise<WaitingListResponse | null> {
    try {
      const result = await this.db.get<WaitingListDbRow>(sql`
        SELECT
          w.*,
          json_object(
            'id', t.id,
            'number', t.number,
            'capacity', t.capacity
          ) as table_json
        FROM waiting_list w
        LEFT JOIN tables t ON w.table_id = t.id
        WHERE w.id = ${id}
      `);

      if (!result) return null;

      // 計算前方還有幾組
      const partiesAhead = await this.getPartiesAhead(
        result.restaurant_id,
        result.queue_number,
        result.party_size,
      );

      return this.formatWaitingListResponse(result, partiesAhead);
    } catch (error) {
      console.error("Error getting waiting list entry:", error);
      throw error;
    }
  }

  /**
   * 查詢候位列表
   */
  async listWaitingList(
    filters: WaitingListFilters,
  ): Promise<{ data: WaitingListResponse[]; total: number }> {
    try {
      const conditions: SQL[] = [];

      if (filters.restaurantId) {
        conditions.push(
          sql`${waitingList.restaurantId} = ${filters.restaurantId}`,
        );
      }

      if (filters.status) {
        if (Array.isArray(filters.status)) {
          const statusList = sql.join(
            filters.status.map((status) => sql`${status}`),
            sql`, `,
          );
          conditions.push(sql`${waitingList.status} IN (${statusList})`);
        } else {
          conditions.push(sql`${waitingList.status} = ${filters.status}`);
        }
      }

      if (filters.customerPhone) {
        conditions.push(
          sql`${waitingList.customerPhone} = ${filters.customerPhone}`,
        );
      }

      if (filters.date) {
        conditions.push(sql`${waitingList.queueDate} = ${filters.date}`);
      } else {
        // 默認只顯示今天的。沒有指定餐廳時這份清單橫跨全平台，沒有哪一家店的
        // 午夜可以套用，所以用平台偏移量 (#329)。
        const today = filters.restaurantId
          ? await this.queueDateSql(filters.restaurantId)
          : businessDateSql(PLATFORM_BUSINESS_TIMEZONE_OFFSET_MINUTES);
        conditions.push(sql`${waitingList.queueDate} = ${today}`);
      }

      // 分頁
      const page = filters.page || 1;
      const limit = filters.limit || 50;
      const offset = (page - 1) * limit;
      const whereExpr =
        conditions.length > 0 ? sql.join(conditions, sql` AND `) : sql`1 = 1`;

      const countResult = await this.db.get<{ total: number }>(sql`
        SELECT COUNT(*) as total
        FROM ${waitingList}
        WHERE ${whereExpr}
      `);

      const total = countResult?.total || 0;

      const results = await this.db.all<WaitingListDbRow>(sql`
        SELECT
          ${waitingList}.*,
          json_object(
            'id', ${restaurantTables.id},
            'number', ${restaurantTables.number},
            'capacity', ${restaurantTables.capacity}
          ) as "table"
        FROM ${waitingList}
        LEFT JOIN ${restaurantTables}
          ON ${waitingList.tableId} = ${restaurantTables.id}
        WHERE ${whereExpr}
        ORDER BY
          CASE ${waitingList.status}
            WHEN 'waiting' THEN 1
            WHEN 'called' THEN 2
            ELSE 3
          END,
          ${waitingList.queueNumber} ASC
        LIMIT ${limit} OFFSET ${offset}
      `);

      const data = await Promise.all(
        results.map(async (r) => {
          const partiesAhead = await this.getPartiesAhead(
            r.restaurant_id,
            r.queue_number,
            r.party_size,
          );
          return this.formatWaitingListResponse(r, partiesAhead);
        }),
      );

      return { data, total };
    } catch (error) {
      console.error("Error listing waiting list:", error);
      throw error;
    }
  }

  /**
   * 叫號
   */
  async callWaiting(
    id: string,
    request: CallWaitingRequest,
  ): Promise<WaitingListResponse> {
    try {
      const now = Date.now();
      const entry = await this.getWaitingListEntryById(id);

      if (!entry) {
        throw new Error("候位記錄不存在");
      }

      assertWaitingTransition(entry.status, WaitingStatus.CALLED);

      // 驗證桌位
      const table = await this.db.get<AvailableTableRow>(sql`
        SELECT
          ${restaurantTables.id} as id,
          ${restaurantTables.number} as table_number,
          ${restaurantTables.capacity} as capacity
        FROM ${restaurantTables}
        WHERE ${restaurantTables.id} = ${request.tableId}
          AND ${restaurantTables.restaurantId} = ${entry.restaurantId}
          AND ${restaurantTables.isActive} = 1
          AND ${restaurantTables.isOccupied} = 0
          AND NOT EXISTS (
            SELECT 1
            FROM ${waitingList}
            WHERE ${waitingList.restaurantId} = ${entry.restaurantId}
              AND ${waitingList.tableId} = ${restaurantTables.id}
              AND ${waitingList.id} != ${id}
              AND ${waitingList.status} IN ('called', 'confirmed')
          )
      `);

      if (!table) {
        throw new Error("桌位不可用");
      }

      if (table.capacity < entry.partySize) {
        throw new Error("桌位容量不足");
      }

      const timeoutAt = now + CALL_TIMEOUT_MS;

      // 更新候位記錄（樂觀鎖：WHERE 包含狀態條件防止並發衝突）
      const callResult = await this.db.run(sql`
        UPDATE waiting_list
        SET status = 'called',
            table_id = ${request.tableId},
            called_at = ${now},
            timeout_at = ${timeoutAt},
            updated_at = ${now}
        WHERE id = ${id} AND status = 'waiting'
      `);
      if (getMutationChanges(callResult) === 0) {
        throw new Error("叫號失敗：狀態已被其他操作更新，請刷新");
      }

      // 更新桌位狀態為預留
      await this.updateTableStatus(request.tableId, "reserved", null, id);

      // 發送叫號通知（非阻塞）
      if (entry.customerPhone) {
        this.queueBackgroundTask(
          this.sendWaitingNotification(
            entry.customerPhone,
            "waiting_list_called",
            {
              customerName: entry.customerName,
              tableNumber: table.table_number || `桌${request.tableId}`,
            },
          ),
        );
      }

      const updated = (await this.getWaitingListEntryById(
        id,
      )) as WaitingListResponse;
      const pushResult = await new CustomerWebPushService(
        this.d1,
        this.env,
      ).sendWaitingCalled(updated);
      if (pushResult.sent > 0) {
        const notifiedAt = Date.now();
        await this.db.run(sql`
          UPDATE waiting_list
          SET notified_at = ${notifiedAt},
              updated_at = ${notifiedAt}
          WHERE id = ${id}
        `);
        updated.notifiedAt = notifiedAt;
        updated.updatedAt = notifiedAt;
      }
      await this.broadcastWaitingListEvent(
        WAITING_LIST_REALTIME_EVENT.CALLED,
        updated,
      );
      return updated;
    } catch (error) {
      console.error("Error calling waiting:", error);
      throw error;
    }
  }

  /**
   * 顧客確認（回應叫號）
   */
  async confirmWaiting(id: string): Promise<WaitingListResponse> {
    try {
      const now = Date.now();
      const entry = await this.getWaitingListEntryById(id);

      if (!entry) {
        throw new Error("候位記錄不存在");
      }

      assertWaitingTransition(entry.status, WaitingStatus.CONFIRMED);

      // 檢查是否超時
      if (entry.timeoutAt && now > entry.timeoutAt) {
        await this.expireWaiting(id);
        throw new Error("叫號已超時，請重新排隊");
      }

      const confirmResult = await this.db.run(sql`
        UPDATE waiting_list
        SET status = 'confirmed',
            confirmed_at = ${now},
            updated_at = ${now}
        WHERE id = ${id} AND status = 'called'
      `);
      if (getMutationChanges(confirmResult) === 0) {
        throw new Error("確認失敗：狀態已被其他操作更新，請刷新");
      }

      const updated = (await this.getWaitingListEntryById(
        id,
      )) as WaitingListResponse;
      await this.broadcastWaitingListEvent(
        WAITING_LIST_REALTIME_EVENT.CONFIRMED,
        updated,
      );
      return updated;
    } catch (error) {
      console.error("Error confirming waiting:", error);
      throw error;
    }
  }

  /**
   * 標記入座
   */
  async markSeated(id: string): Promise<WaitingListResponse> {
    try {
      const now = Date.now();
      const entry = await this.getWaitingListEntryById(id);

      if (!entry) {
        throw new Error("候位記錄不存在");
      }

      assertWaitingTransition(entry.status, WaitingStatus.SEATED);

      const seatResult = await this.db.run(sql`
        UPDATE waiting_list
        SET status = 'seated',
            seated_at = ${now},
            updated_at = ${now}
        WHERE id = ${id} AND (status = 'called' OR status = 'confirmed')
      `);
      if (getMutationChanges(seatResult) === 0) {
        throw new Error("入座失敗：狀態已被其他操作更新，請刷新");
      }

      // 更新桌位狀態為佔用
      if (entry.tableId) {
        await this.updateTableStatus(entry.tableId, "occupied");
        const orderService = new OrderService(this.d1, this.env);
        const confirmedOrders = await orderService.confirmWaitingListPreOrders(
          id,
          entry.tableId,
        );
        await this.broadcastSeatedPreOrders(confirmedOrders);
      }

      // 更新後續候位的等待時間
      await this.recalculateWaitTimes(entry.restaurantId);

      const updated = (await this.getWaitingListEntryById(
        id,
      )) as WaitingListResponse;
      await this.broadcastWaitingListEvent(
        WAITING_LIST_REALTIME_EVENT.SEATED,
        updated,
      );
      return updated;
    } catch (error) {
      console.error("Error marking seated:", error);
      throw error;
    }
  }

  /**
   * 取消候位
   */
  async cancelWaiting(id: string): Promise<WaitingListResponse> {
    try {
      const now = Date.now();
      const entry = await this.getWaitingListEntryById(id);

      if (!entry) {
        throw new Error("候位記錄不存在");
      }

      assertWaitingTransition(entry.status, WaitingStatus.CANCELLED);

      const cancelResult = await this.db.run(sql`
        UPDATE waiting_list
        SET status = 'cancelled',
            cancelled_at = ${now},
            updated_at = ${now}
        WHERE id = ${id} AND status IN ('waiting', 'called', 'confirmed')
      `);
      if (getMutationChanges(cancelResult) === 0) {
        throw new Error("取消失敗：狀態已被其他操作更新，請刷新");
      }

      // 如果已分配桌位，釋放桌位
      if (entry.tableId) {
        await this.updateTableStatus(entry.tableId, "available");
      }
      const orderService = new OrderService(this.d1, this.env);
      await orderService.cancelWaitingListPreOrders(id);

      // 更新後續候位的等待時間
      await this.recalculateWaitTimes(entry.restaurantId);

      const updated = (await this.getWaitingListEntryById(
        id,
      )) as WaitingListResponse;
      await this.broadcastWaitingListEvent(
        WAITING_LIST_REALTIME_EVENT.CANCELLED,
        updated,
      );
      return updated;
    } catch (error) {
      console.error("Error cancelling waiting:", error);
      throw error;
    }
  }

  /**
   * 標記過號
   */
  async expireWaiting(id: string): Promise<WaitingListResponse> {
    try {
      const now = Date.now();
      const entry = await this.getWaitingListEntryById(id);

      if (!entry) {
        throw new Error("候位記錄不存在");
      }

      assertWaitingTransition(entry.status, WaitingStatus.EXPIRED);

      const expireResult = await this.db.run(sql`
        UPDATE waiting_list
        SET status = 'expired',
            expired_at = ${now},
            updated_at = ${now}
        WHERE id = ${id} AND status IN ('waiting', 'called', 'confirmed')
      `);
      if (getMutationChanges(expireResult) === 0) {
        throw new Error("過期標記失敗：狀態已被其他操作更新，請刷新");
      }

      // 釋放預留的桌位
      if (entry.tableId) {
        await this.updateTableStatus(entry.tableId, "available");
      }
      const orderService = new OrderService(this.d1, this.env);
      await orderService.cancelWaitingListPreOrders(id);

      // 發送過號通知（非阻塞）
      if (entry.customerPhone) {
        this.queueBackgroundTask(
          this.sendWaitingNotification(
            entry.customerPhone,
            "waiting_list_expired",
            {
              customerName: entry.customerName,
              queueNumber: entry.queueLetter
                ? `${entry.queueLetter}${entry.queueNumber}`
                : String(entry.queueNumber),
            },
          ),
        );
      }

      // 更新後續候位的等待時間
      await this.recalculateWaitTimes(entry.restaurantId);

      const updated = (await this.getWaitingListEntryById(
        id,
      )) as WaitingListResponse;
      await this.broadcastWaitingListEvent(
        WAITING_LIST_REALTIME_EVENT.EXPIRED,
        updated,
      );
      return updated;
    } catch (error) {
      console.error("Error expiring waiting:", error);
      throw error;
    }
  }

  /**
   * 自動尋找最適合的可用桌位（best-fit: 容量最小且 >= partySize）
   * 排除不可預約或已占用的桌位
   */
  async findAvailableTable(
    restaurantId: string,
    partySize: number,
    excludeTableIds: number[] = [],
  ): Promise<TableAssignmentResult | null> {
    const table = await this.db.get<AvailableTableRow>(sql`
      SELECT
        ${restaurantTables.id} as id,
        ${restaurantTables.number} as table_number,
        ${restaurantTables.capacity} as capacity
      FROM ${restaurantTables}
      WHERE ${restaurantTables.restaurantId} = ${restaurantId}
        AND ${restaurantTables.isActive} = 1
        AND ${restaurantTables.isOccupied} = 0
        AND ${restaurantTables.capacity} >= ${partySize}
        AND NOT EXISTS (
          SELECT 1
          FROM ${waitingList}
          WHERE ${waitingList.restaurantId} = ${restaurantId}
            AND ${waitingList.tableId} = ${restaurantTables.id}
            AND ${waitingList.status} IN ('called', 'confirmed')
        )
      ORDER BY ${restaurantTables.capacity} ASC, ${restaurantTables.id} ASC
      LIMIT 1
    `);

    if (!table) return null;

    // 排除已在本次批次中分配的桌位
    if (excludeTableIds.includes(table.id)) return null;

    return {
      tableId: table.id,
      tableNumber: table.table_number || `T${table.id}`,
      confidence:
        table.capacity === partySize
          ? 1.0
          : Math.max(0.5, 1.0 - (table.capacity - partySize) * 0.1),
      reason: `自動分配：${table.capacity}人桌 (最佳匹配)`,
    };
  }

  /**
   * 批次叫號：自動為排隊中的客人分配桌位
   */
  async batchCallNext(
    restaurantId: string,
    count: number = 1,
  ): Promise<
    Array<{
      id: string;
      success: boolean;
      tableId?: number;
      message: string;
    }>
  > {
    const { data: waitingList } = await this.listWaitingList({
      restaurantId,
      status: WaitingStatus.WAITING,
      limit: count,
    });

    const results = [];
    const assignedTableIds: number[] = [];

    for (const entry of waitingList) {
      const table = await this.findAvailableTable(
        restaurantId,
        entry.partySize,
        assignedTableIds,
      );
      if (!table) {
        results.push({ id: entry.id, success: false, message: "無可用桌位" });
        continue;
      }

      try {
        await this.callWaiting(entry.id, { tableId: table.tableId });
        assignedTableIds.push(table.tableId);
        results.push({
          id: entry.id,
          success: true,
          tableId: table.tableId,
          message: `已叫號，分配桌位 ${table.tableNumber}`,
        });
      } catch (error) {
        results.push({
          id: entry.id,
          success: false,
          message: error instanceof Error ? error.message : "叫號失敗",
        });
      }
    }

    return results;
  }

  /**
   * 預估等待時間
   */
  async estimateWaitTime(
    request: WaitTimeEstimateRequest,
  ): Promise<WaitTimeEstimateResult> {
    try {
      const { restaurantId, partySize } = request;

      // Run all 4 independent queries in parallel
      const [
        avgTurnoverResult,
        suitableTablesResult,
        aheadResult,
        occupiedResult,
      ] = await Promise.all([
        this.db.get<TurnoverEstimateRow>(sql`
            SELECT AVG(
              CASE
                WHEN COALESCE(o.paid_at_ms, o.delivered_at_ms) IS NOT NULL
                  AND o.created_at_ms IS NOT NULL
                THEN (COALESCE(o.paid_at_ms, o.delivered_at_ms) - o.created_at_ms) / 60000.0
                ELSE NULL
              END
            ) as avg_turnover_minutes
            FROM orders o
            WHERE o.restaurant_id = ${restaurantId}
              AND COALESCE(o.paid_at_ms, o.delivered_at_ms) > ${Date.now() - 2 * 60 * 60 * 1000}
              AND o.status IN ('delivered', 'paid')
          `),
        this.db.get<CountRow>(sql`
            SELECT COUNT(*) as count
            FROM tables
            WHERE restaurant_id = ${restaurantId}
              AND is_active = 1
              AND capacity >= ${partySize}
              AND capacity <= ${partySize + 2}
          `),
        this.db.get<CountRow>(sql`
            SELECT COUNT(*) as count
            FROM waiting_list
            WHERE restaurant_id = ${restaurantId}
              AND status = 'waiting'
              AND party_size <= ${partySize + 2}
              AND queue_date = ${await this.queueDateSql(restaurantId)}
          `),
        this.db.get<OccupiedTableCountRow>(sql`
            SELECT
              COUNT(*) as occupied_count,
              MIN(estimated_free_at_ms) as earliest_available
            FROM tables
            WHERE restaurant_id = ${restaurantId}
              AND is_occupied = 1
              AND capacity >= ${partySize}
              AND capacity <= ${partySize + 2}
          `),
      ]);

      const avgTurnover =
        avgTurnoverResult?.avg_turnover_minutes || DEFAULT_TURNOVER_MINUTES;
      const suitableTables = suitableTablesResult?.count || 1;
      const partiesAhead = aheadResult?.count || 0;
      const occupiedTables = occupiedResult?.occupied_count || 0;
      const availableTables = Math.max(0, suitableTables - occupiedTables);

      // 5. 綜合計算
      let estimatedWaitMinutes = 0;

      if (availableTables > 0 && partiesAhead === 0) {
        // 有空桌且沒人排隊 -> 立即可用
        estimatedWaitMinutes = 5;
      } else {
        // 基礎等待時間 = (前方人數 × 平均翻桌時間) / 適合桌位數
        estimatedWaitMinutes =
          (partiesAhead * avgTurnover) / Math.max(suitableTables, 1);

        // 時段調整因子
        const currentHour = new Date().getHours();
        if (currentHour >= 18 && currentHour <= 20) {
          // 尖峰時段 +20%
          estimatedWaitMinutes *= 1.2;
        } else if (currentHour >= 14 && currentHour <= 17) {
          // 離峰時段 -10%
          estimatedWaitMinutes *= 0.9;
        }

        // 如果有桌位即將釋放，減少5分鐘
        if (occupiedResult?.earliest_available) {
          const timeUntilAvailable =
            (occupiedResult.earliest_available - Date.now()) / 60000;
          if (
            timeUntilAvailable > 0 &&
            timeUntilAvailable < estimatedWaitMinutes
          ) {
            estimatedWaitMinutes = Math.max(estimatedWaitMinutes - 5, 10);
          }
        }

        // 確保最少10分鐘
        estimatedWaitMinutes = Math.max(estimatedWaitMinutes, 10);
      }

      // 四捨五入到5的倍數
      estimatedWaitMinutes = Math.round(estimatedWaitMinutes / 5) * 5;

      // 6. 計算信心度
      const confidence = this.calculateConfidence(
        partiesAhead,
        availableTables,
        avgTurnover,
      );

      return {
        estimatedWaitMinutes: Math.round(estimatedWaitMinutes),
        partiesAhead,
        availableTables,
        confidence,
      };
    } catch (error) {
      console.error("Error estimating wait time:", error);
      return {
        estimatedWaitMinutes: DEFAULT_WAIT_MINUTES,
        partiesAhead: 0,
        availableTables: 0,
        confidence: 0.5,
      };
    }
  }

  /**
   * 取得排隊狀態
   */
  async getQueueStatus(restaurantId: string): Promise<QueueStatus> {
    try {
      // Run counts + all estimates in parallel (was 21 sequential queries)
      const [
        totalWaitingResult,
        availableTablesResult,
        estimate,
        ...sizeEstimates
      ] = await Promise.all([
        this.db.get<QueueStatusCountRow>(sql`
            SELECT
              COUNT(*) as total,
              SUM(CASE WHEN party_size <= 2 THEN 1 ELSE 0 END) as wait_2,
              SUM(CASE WHEN party_size <= 4 THEN 1 ELSE 0 END) as wait_4,
              SUM(CASE WHEN party_size <= 6 THEN 1 ELSE 0 END) as wait_6
            FROM waiting_list
            WHERE restaurant_id = ${restaurantId}
              AND status = 'waiting'
              AND queue_date = ${await this.queueDateSql(restaurantId)}
          `),
        this.db.get<CountRow>(sql`
            SELECT COUNT(*) as count
            FROM tables
            WHERE restaurant_id = ${restaurantId}
              AND is_active = 1
              AND is_occupied = 0
          `),
        this.estimateWaitTime({ restaurantId, partySize: 4 }),
        this.estimateWaitTime({ restaurantId, partySize: 2 }),
        this.estimateWaitTime({ restaurantId, partySize: 4 }),
        this.estimateWaitTime({ restaurantId, partySize: 6 }),
      ]);

      const totalWaiting = totalWaitingResult?.total || 0;
      const availableTables = availableTablesResult?.count || 0;

      const sizes = [2, 4, 6] as const;
      const waitCounts = [
        totalWaitingResult?.wait_2 || 0,
        totalWaitingResult?.wait_4 || 0,
        totalWaitingResult?.wait_6 || 0,
      ];
      const byTableType = sizes.map((size, i) => ({
        type: `${size}-person`,
        waiting: waitCounts[i],
        averageWait: sizeEstimates[i].estimatedWaitMinutes,
      }));

      return {
        restaurantId,
        totalWaiting,
        averageWaitMinutes: estimate.estimatedWaitMinutes,
        availableTables,
        byTableType,
      };
    } catch (error) {
      console.error("Error getting queue status:", error);
      throw error;
    }
  }

  /**
   * 取得候位統計
   */
  async getWaitingStats(
    restaurantId: string,
    date?: string,
  ): Promise<WaitingStats> {
    try {
      const conditions: SQL[] = [
        sql`${waitingList.restaurantId} = ${restaurantId}`,
      ];

      if (date) {
        conditions.push(sql`${waitingList.queueDate} = ${date}`);
      } else {
        conditions.push(
          sql`${waitingList.queueDate} = ${await this.queueDateSql(restaurantId)}`,
        );
      }

      const whereExpr = sql.join(conditions, sql` AND `);
      const result = await this.db.get<WaitingStatsRow>(sql`
        SELECT
          COUNT(*) as total_waiting,
          SUM(CASE WHEN ${waitingList.status} = 'seated' THEN 1 ELSE 0 END) as seated_count,
          SUM(CASE WHEN ${waitingList.status} = 'expired' THEN 1 ELSE 0 END) as expired_count,
          SUM(CASE WHEN ${waitingList.status} = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
          AVG(CASE
            WHEN ${waitingList.seatedAt} IS NOT NULL
              AND ${waitingList.createdAt} IS NOT NULL
            THEN (${waitingList.seatedAt} - ${waitingList.createdAt}) / 60000.0
            ELSE NULL
          END) as avg_wait_minutes,
          ROUND(CAST(SUM(CASE WHEN ${waitingList.status} = 'expired' THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(*), 0) * 100, 2) as expire_rate
        FROM ${waitingList}
        WHERE ${whereExpr}
      `);

      return {
        restaurantId,
        date,
        totalWaiting: result?.total_waiting || 0,
        seatedCount: result?.seated_count || 0,
        expiredCount: result?.expired_count || 0,
        cancelledCount: result?.cancelled_count || 0,
        avgWaitMinutes: Math.round(result?.avg_wait_minutes || 0),
        expireRate: result?.expire_rate || 0,
      };
    } catch (error) {
      console.error("Error getting waiting stats:", error);
      throw error;
    }
  }

  /**
   * 驗證候位資料
   */
  private validateWaitingListData(data: JoinWaitingListRequest): void {
    if (!data.customerName || data.customerName.trim().length === 0) {
      throw new Error("顧客姓名為必填");
    }

    if (
      !data.customerPhone ||
      !/^09\d{8}$/.test(data.customerPhone.replace(/[-\s]/g, ""))
    ) {
      throw new Error("請提供有效的手機號碼");
    }

    if (data.partySize < 1 || data.partySize > 20) {
      throw new Error("用餐人數必須在 1-20 人之間");
    }
  }

  /**
   * 生成排隊號碼
   */
  private async generateQueueNumber(
    restaurantId: string,
    partySize: number,
  ): Promise<{ number: number; letter: string }> {
    try {
      // 根據人數決定前綴
      let letter = "A"; // 2人桌
      if (partySize >= 6) {
        letter = "C"; // 6人+桌
      } else if (partySize >= 4) {
        letter = "B"; // 4人桌
      }

      // 查詢今日該類型最大號碼
      const result = await this.db.get<QueueNumberRow>(sql`
        SELECT MAX(queue_number) as max_number
        FROM waiting_list
        WHERE restaurant_id = ${restaurantId}
          AND queue_letter = ${letter}
          AND queue_date = ${await this.queueDateSql(restaurantId)}
      `);

      const maxNumber = result?.max_number || 0;
      const nextNumber = maxNumber + 1;

      return { number: nextNumber, letter };
    } catch (error) {
      console.error("Error generating queue number:", error);
      return { number: 1, letter: "A" };
    }
  }

  /**
   * 計算前方還有幾組
   */
  private async getPartiesAhead(
    restaurantId: string,
    queueNumber: number,
    partySize: number,
  ): Promise<number> {
    try {
      const result = await this.db.get<CountRow>(sql`
        SELECT COUNT(*) as count
        FROM waiting_list
        WHERE restaurant_id = ${restaurantId}
          AND status = 'waiting'
          AND queue_number < ${queueNumber}
          AND party_size <= ${partySize + 2}
          AND queue_date = ${await this.queueDateSql(restaurantId)}
      `);

      return result?.count || 0;
    } catch (error) {
      console.error("Error getting parties ahead:", error);
      return 0;
    }
  }

  /**
   * 重新計算等待時間（當有人入座或取消時）
   */
  private async recalculateWaitTimes(restaurantId: string): Promise<void> {
    try {
      // 取得所有等待中的候位
      const waitingEntries = await this.db.all<WaitingPartySizeRow>(sql`
        SELECT id, party_size
        FROM waiting_list
        WHERE restaurant_id = ${restaurantId}
          AND status = 'waiting'
          AND queue_date = ${await this.queueDateSql(restaurantId)}
        ORDER BY queue_number ASC
      `);

      // 更新每個候位的預估時間
      for (const entry of waitingEntries) {
        const estimate = await this.estimateWaitTime({
          restaurantId,
          partySize: entry.party_size,
        });

        await this.db.run(sql`
          UPDATE waiting_list
          SET estimated_wait_minutes = ${estimate.estimatedWaitMinutes},
              updated_at = ${Date.now()}
          WHERE id = ${entry.id}
        `);
      }
    } catch (error) {
      console.error("Error recalculating wait times:", error);
    }
  }

  /**
   * 計算預估信心度
   */
  private calculateConfidence(
    partiesAhead: number,
    availableTables: number,
    avgTurnover: number,
  ): number {
    // 基礎信心度
    let confidence = 0.8;

    // 前方人數越多，信心度越低
    if (partiesAhead > 5) {
      confidence -= 0.1;
    }
    if (partiesAhead > 10) {
      confidence -= 0.1;
    }

    // 沒有可用桌位，信心度降低
    if (availableTables === 0) {
      confidence -= 0.2;
    }

    // 平均翻桌時間異常，信心度降低
    if (avgTurnover < 20 || avgTurnover > 90) {
      confidence -= 0.1;
    }

    return Math.max(0.3, Math.min(1.0, confidence));
  }

  /**
   * 更新桌位狀態
   */
  private async updateTableStatus(
    tableId: number,
    status: TableStatusAction,
    reservationId?: string | null,
    waitingListId?: string,
  ): Promise<void> {
    void reservationId;
    void waitingListId;
    const now = new Date();

    if (status === "reserved") {
      await this.db
        .update(restaurantTables)
        .set({
          isOccupied: false,
          updatedAt: now,
        })
        .where(sql`${restaurantTables.id} = ${tableId}`);
    } else if (status === "occupied") {
      await this.db
        .update(restaurantTables)
        .set({
          isOccupied: true,
          occupiedAt: now,
          estimatedFreeAt: new Date(now.getTime() + DEFAULT_TABLE_OCCUPANCY_MS),
          updatedAt: now,
        })
        .where(sql`${restaurantTables.id} = ${tableId}`);
    } else if (status === "available") {
      await this.db
        .update(restaurantTables)
        .set({
          isOccupied: false,
          occupiedAt: null,
          estimatedFreeAt: null,
          updatedAt: now,
        })
        .where(sql`${restaurantTables.id} = ${tableId}`);
    }
  }

  /**
   * 生成 UUID
   */
  private generateUUID(): string {
    return `wait_${uuidv7()}`;
  }

  private queueBackgroundTask(task: Promise<void>): void {
    this.backgroundTasks.push(task);
  }

  /**
   * 格式化候位回應
   */
  private formatWaitingListResponse(
    data: WaitingListDbRow,
    partiesAhead: number,
  ): WaitingListResponse {
    return {
      id: data.id,
      restaurantId: data.restaurant_id,
      customerId: data.customer_id ?? undefined,
      customerName: data.customer_name,
      customerPhone: data.customer_phone,
      partySize: data.party_size,
      preferredTableType: data.preferred_table_type ?? undefined,
      queueNumber: data.queue_number,
      queueLetter: data.queue_letter ?? undefined,
      queueDisplay: `${data.queue_letter || ""}${String(data.queue_number).padStart(3, "0")}`,
      priority: data.priority,
      estimatedWaitMinutes: data.estimated_wait_minutes ?? undefined,
      tableId: data.table_id ?? undefined,
      status: data.status,
      notes: data.notes ?? undefined,
      createdAt: data.created_at,
      calledAt: data.called_at ?? undefined,
      notifiedAt: data.notified_at ?? undefined,
      confirmedAt: data.confirmed_at ?? undefined,
      seatedAt: data.seated_at ?? undefined,
      cancelledAt: data.cancelled_at ?? undefined,
      expiredAt: data.expired_at ?? undefined,
      timeoutAt: data.timeout_at ?? undefined,
      updatedAt: data.updated_at,
      partiesAhead,
      table: data.table_json ? JSON.parse(data.table_json) : undefined,
    };
  }
}
