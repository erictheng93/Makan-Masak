import { beforeEach, describe, expect, it, vi } from "vitest";

const uuidState = vi.hoisted(() => ({ next: 1 }));

vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => `uuid-${uuidState.next++}`),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

import {
  groupActivityLogs,
  groupCartItems,
  groupMembers,
  groupOrders,
  menuItems,
  orders,
  restaurants,
  splitBills,
} from "@makanmasak/database";
import {
  createMutationFixtureDb,
  type MutationFixtures,
} from "@makanmasak/database/testing";
import { ApiError } from "@makanmasak/utils";
import { GroupOrdersService } from "./GroupOrdersService";
import type { SplitBillRequest } from "../types";

function createKV() {
  const values = new Map<string, string>();

  return {
    values,
    kv: {
      get: vi.fn(async (key: string, type?: "json") => {
        const value = values.get(key);
        if (value == null) return null;
        return type === "json" ? JSON.parse(value) : value;
      }),
      put: vi.fn(
        async (
          key: string,
          value: string,
          _options?: { expirationTtl?: number },
        ) => {
          values.set(key, value);
        },
      ),
      delete: vi.fn(async (key: string) => {
        values.delete(key);
      }),
    } as unknown as KVNamespace,
  };
}

/**
 * `splitBill` types its payload optional because the failure branch omits it.
 * These tests are all on the success path, so unwrap it once with a readable
 * failure rather than reading through undefined at each assertion.
 */
type SplitBills = NonNullable<
  Awaited<ReturnType<GroupOrdersService["splitBill"]>>["data"]
>;

function billsOf(
  result: Awaited<ReturnType<GroupOrdersService["splitBill"]>>,
): SplitBills {
  if (!result.success || !result.data) {
    throw new Error(`expected a split result, got ${JSON.stringify(result)}`);
  }
  return result.data;
}

function createService() {
  return new GroupOrdersService({} as D1Database);
}

/**
 * Both error sinks end at `console.error`. Replacing them keeps a run that
 * deliberately fails readable, and lets a test say which sink a failure
 * reached — the distinction between an incident and a rejected request.
 */
function silenceServiceErrors(service: GroupOrdersService) {
  return {
    logError: vi
      .spyOn(service["logger"], "error")
      .mockImplementation(() => undefined),
    trackError: vi
      .spyOn(service["errorTracker"], "logError")
      .mockImplementation(() => undefined),
  };
}

type SelectFixtureName =
  | "groupActivityLogs"
  | "groupCartItems"
  | "groupMembers"
  | "groupOrders"
  | "menuItems"
  | "orders"
  | "restaurants"
  | "rawSqlSubquery"
  | "splitBills";

type SelectFixtures = Partial<Record<SelectFixtureName, unknown[][]>>;

const rawSqlSubquery = Symbol("rawSqlSubquery");
const unselectedTable = Symbol("unselectedTable");

const fixtureTables: Record<SelectFixtureName, unknown> = {
  groupActivityLogs,
  groupCartItems,
  groupMembers,
  groupOrders,
  menuItems,
  orders,
  restaurants,
  rawSqlSubquery,
  splitBills,
};

const fixtureTableNames = new Map<unknown, SelectFixtureName>(
  Object.entries(fixtureTables).map(([name, table]) => [
    table,
    name as SelectFixtureName,
  ]),
);

function tableName(table: unknown) {
  return fixtureTableNames.get(table) ?? "<unknown table>";
}

function conditionContainsBoundValue(
  condition: unknown,
  expected: string,
): boolean {
  function visit(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    if ("value" in value && value.value === expected) return true;
    return "queryChunks" in value && visit(value.queryChunks);
  }

  return visit(condition);
}

function createQuery(
  nextResultFor: (table: unknown) => unknown,
  onWhere?: (table: unknown, condition: unknown) => void,
) {
  let selectedTable: unknown = unselectedTable;
  const builder = {
    from: vi.fn((table: unknown) => {
      selectedTable = fixtureTableNames.has(table) ? table : rawSqlSubquery;
      return builder;
    }),
    innerJoin: vi.fn(() => builder),
    where: vi.fn((condition: unknown) => {
      onWhere?.(selectedTable, condition);
      return builder;
    }),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    set: vi.fn(() => builder),
    values: vi.fn(async (payload: unknown) => payload),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => {
      if (selectedTable === unselectedTable) {
        return Promise.reject(
          new Error("Select fixture query never called from(table)"),
        ).then(resolve, reject);
      }
      return Promise.resolve(nextResultFor(selectedTable)).then(
        resolve,
        reject,
      );
    },
  };
  return builder;
}

/**
 * Builds a db mock whose select fixtures are dispatched by the table passed to
 * `.from()`, not by global call order. Adding a query against a *different*
 * table therefore cannot shift another table's results.
 *
 * Two things to know before adding a query to the service:
 *
 * - Within a single table the fixtures are still a positional queue. A second
 *   `.from(groupOrders)` consumes the second `groupOrders` entry, so a new
 *   query against an already-declared table means every test that declares
 *   that table needs another entry.
 * - An undeclared or exhausted table throws and names the table, rather than
 *   returning `[]` and letting the service take a wrong branch. That is the
 *   intended failure mode — the message is the diagnosis.
 *
 * A `.from()` argument that is not one of the registered tables (a raw SQL
 * subquery) falls into the shared `rawSqlSubquery` bucket. New tables must be
 * added to `fixtureTables` or they land there too and silently share its queue.
 * That bucket is why the reads here are not on the shared
 * `createSelectFixtureDb`: it has no catch-all, and an unregistered `from()`
 * argument throws there rather than routing anywhere.
 *
 * Writes: only `.returning()` draws a fixture, declared per table and
 * operation through `createMutationFixtureDb`. Every other write in this
 * service is fire-and-forget — the D1 result is never read — so there is no
 * queue for it to misfeed, and `inserts`/`updates`/`deletes` below stay plain
 * recorders of what was written.
 */
function createDb(
  fixtures: SelectFixtures = {},
  mutationFixtures: MutationFixtures<SelectFixtureName> = {},
) {
  const selectResults = new Map<unknown, unknown[][]>(
    Object.entries(fixtures).map(([name, results]) => [
      fixtureTables[name as SelectFixtureName],
      results ?? [],
    ]),
  );
  const inserts: Array<{ table: unknown; payload: unknown }> = [];
  const updates: Array<{ table: unknown; payload: unknown }> = [];
  const deletes: unknown[] = [];
  const selectWhereClauses: Array<{ table: unknown; condition: unknown }> = [];
  const mutationDb = createMutationFixtureDb(fixtureTables, mutationFixtures);

  const nextResultFor = (table: unknown) => {
    const name = tableName(table);
    const queue = selectResults.get(table);

    if (!queue) {
      throw new Error(`Missing select fixture for ${name}`);
    }

    const result = queue.shift();
    if (result === undefined) {
      throw new Error(`No select fixtures remaining for ${name}`);
    }

    return result;
  };

  const db = {
    inserts,
    updates,
    deletes,
    selectWhereClauses,
    select: vi.fn(() =>
      createQuery(nextResultFor, (table, condition) => {
        selectWhereClauses.push({ table, condition });
      }),
    ),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (payload: unknown) => {
        inserts.push({ table, payload });
        return payload;
      }),
    })),
    update: vi.fn((table: unknown) => {
      // Only `.returning()` draws a fixture. This service ignores the D1
      // result of every other update — it never reads a change count — so
      // those have no queue to misfeed. The one update that does read rows
      // back (the finalizing-mutex claim) is declared per table and
      // operation, and an undeclared or exhausted queue throws there and
      // names both.
      const fixtures = mutationDb.update(table);
      const builder = {
        set: vi.fn((payload: unknown) => {
          updates.push({ table, payload });
          return builder;
        }),
        where: vi.fn(() => builder),
        returning: vi.fn(() => {
          // Most cart-write tests only care about the subsequent totals. Give
          // their conditional write a successful row unless a test explicitly
          // supplies a fixture for the guard result.
          if (
            table === groupCartItems &&
            !mutationFixtures.groupCartItems?.update
          ) {
            return [{}];
          }
          return fixtures.returning();
        }),
      };
      return builder;
    }),
    delete: vi.fn((table: unknown) => {
      const builder = {
        where: vi.fn(() => {
          deletes.push(table);
          return builder;
        }),
        returning: vi.fn(() => {
          if (
            table === groupCartItems &&
            !mutationFixtures.groupCartItems?.delete
          ) {
            return [{}];
          }
          return mutationDb.delete(table).returning();
        }),
      };
      return builder;
    }),
  };

  return db;
}

const baseGroupOrder: typeof groupOrders.$inferSelect = {
  id: "group-1",
  restaurantId: "restaurant-1",
  masterOrderId: null,
  tableId: null,
  shareCode: "ABC12345",
  // group_orders.created_by is TEXT (a user UUID), not an integer.
  createdBy: "7",
  recoveryCode: "recovery-1",
  status: "active",
  // group_orders.split_type defaults to "individual".
  splitType: "individual",
  notes: null,
  expiresAt: new Date("2026-06-08T00:00:00.000Z"),
  lockedAt: null,
  completedAt: null,
  settings: { maxMembers: 4 },
  // group_orders has no `total_amount` column — money is cents-only.
  totalAmountCents: 0,
  taxAmountCents: null,
  serviceChargeCents: null,
  finalAmountCents: null,
  createdAt: new Date("2026-06-07T00:00:00.000Z"),
  updatedAt: new Date("2026-06-07T00:00:00.000Z"),
};

const hostMember: typeof groupMembers.$inferSelect = {
  id: "member-1",
  groupOrderId: "group-1",
  userId: null,
  sessionId: "session-1",
  name: "Host",
  phone: null,
  email: null,
  avatarUrl: null,
  role: "creator",
  permissions: {},
  isActive: true,
  joinedAt: new Date("2026-06-07T00:00:00.000Z"),
  lastActiveAt: new Date("2026-06-07T00:00:00.000Z"),
  leftAt: null,
};

const secondMember = { ...hostMember, id: "member-2", role: "member" };
const thirdMember = { ...hostMember, id: "member-3", role: "member" };

const finalizedOrder = {
  id: "order-1",
  subtotal: 30,
  serviceCharge: 6,
  taxAmount: 3,
  totalAmount: 39,
  status: "pending",
  paymentStatus: "pending",
};

function cartItem(
  id: string,
  memberId: string,
  totalPriceCents: number,
  quantity = 1,
) {
  return {
    id,
    groupOrderId: "group-1",
    memberId,
    menuItemId: Number(id.replace(/\D/g, "")) || 10,
    quantity,
    unitPriceCents: Math.round(totalPriceCents / quantity),
    totalPriceCents,
    status: "active",
    customizations: {},
  };
}

function createSplitDb({
  groupOrder = baseGroupOrder,
  members,
  items = [],
  existingBills = [],
}: {
  groupOrder?: unknown;
  members: unknown[];
  items?: unknown[];
  existingBills?: unknown[][];
}) {
  return createDb({
    groupOrders: [[groupOrder]],
    groupMembers: [members],
    groupCartItems: [items],
    // splitBill checks existing split bills once per member before inserting
    // replacements, so splitBills keeps a table-local result queue.
    splitBills: members.map((_, index) => existingBills[index] ?? []),
  });
}

function totalCents(result: { totalAmount: number }[]) {
  return result.reduce(
    (sum, bill) => sum + Math.round(bill.totalAmount * 100),
    0,
  );
}

/**
 * `service["db"]` is the drizzle instance; these fixtures stand in for it and
 * implement only the reads and writes each test drives.
 */
function useDb(service: GroupOrdersService, db: unknown): void {
  (service as unknown as { db: unknown }).db = db;
}

describe("GroupOrdersService formatting and cache behavior", () => {
  it("routes select fixtures by table instead of global query order", async () => {
    const db = createDb({
      groupOrders: [[baseGroupOrder]],
      restaurants: [[{ id: "restaurant-1", settings: { taxRate: 0.05 } }]],
    });

    await expect(db.select().from(restaurants)).resolves.toEqual([
      { id: "restaurant-1", settings: { taxRate: 0.05 } },
    ]);
    await expect(db.select().from(groupOrders)).resolves.toEqual([
      baseGroupOrder,
    ]);
    await expect(db.select().from(groupOrders)).rejects.toThrow(
      "No select fixtures remaining for groupOrders",
    );
  });

  beforeEach(() => {
    uuidState.next = 1;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
    vi.useRealTimers();
  });

  it("reports the missing table fixture instead of shifting select results", async () => {
    const db = createDb({
      groupOrders: [[baseGroupOrder]],
    });

    await expect(db.select().from(groupOrders)).resolves.toEqual([
      baseGroupOrder,
    ]);
    await expect(db.select().from(restaurants)).rejects.toThrow("restaurants");
  });

  it("reads split eligibility status directly from the database without consulting the summary cache", async () => {
    const { kv } = createKV();
    const service = new GroupOrdersService({} as D1Database, kv);
    useDb(service, createDb({ groupOrders: [[{ status: "checkout" }]] }));

    await expect(service.getGroupOrderStatus("group-1")).resolves.toBe(
      "checkout",
    );
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("returns null for a group order that does not exist", async () => {
    const { kv } = createKV();
    const service = new GroupOrdersService({} as D1Database, kv);
    useDb(service, createDb({ groupOrders: [[]] }));

    // The split guard turns this into a 404; a bare `null` status must not be
    // mistaken for "not active" and reported as a conflict.
    await expect(service.getGroupOrderStatus("missing")).resolves.toBeNull();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("fails closed when D1 contains an unknown group-order status", async () => {
    const { kv } = createKV();
    const service = new GroupOrdersService({} as D1Database, kv);
    useDb(
      service,
      createDb({ groupOrders: [[{ status: "unexpected_status" }]] }),
    );

    await expect(service.getGroupOrderStatus("group-1")).rejects.toThrow(
      "UNKNOWN_GROUP_ORDER_STATUS",
    );
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("formats group orders with defaults, cents-first money, and timestamp compatibility", () => {
    const service = createService();

    expect(
      service["formatGroupOrder"]({
        ...baseGroupOrder,
        tableId: 12,
        shareCode: "ABC123",
        createdBy: "7",
        settings: {
          permissions: { canModifyOthersCart: true },
        },
        totalAmountCents: 12345,
        // epoch seconds rather than Date — the legacy tolerance under test
        expiresAt: 1780876800,
        lockedAt: 1780880400,
        createdAt: 1780790400,
        updatedAt: 1780794000,
      }),
    ).toMatchObject({
      id: "group-1",
      groupOrderId: "group-1",
      restaurantId: "restaurant-1",
      tableId: 12,
      shareCode: "ABC123",
      maxMembers: 8,
      permissions: {
        canInviteMembers: true,
        canModifyOthersCart: true,
        canFinalizeOrder: true,
        canSplitBill: true,
        canProcessPayment: true,
      },
      totalAmount: 123.45,
      expiresAt: new Date(1780876800 * 1000),
      finalizedAt: new Date(1780880400 * 1000),
    });
  });

  it("formats members, cart items, and activities for API compatibility", () => {
    const service = createService();
    const now = new Date("2026-06-07T00:00:00.000Z");

    expect(
      service["formatMember"]({
        ...hostMember,
        email: "host@example.test",
        joinedAt: now,
        lastActiveAt: now,
      }),
    ).toMatchObject({
      id: "member-1",
      memberId: "member-1",
      memberName: "Host",
      email: "host@example.test",
      isHost: true,
      paymentStatus: "pending",
    });

    expect(
      service["formatCartItem"]({
        id: "item-1",
        groupOrderId: "group-1",
        memberId: "member-1",
        menuItemId: 10,
        quantity: 2,
        unitPriceCents: 1250,
        totalPriceCents: 2500,
        customizations: { spiceLevel: "mild" },
        specialInstructions: null,
        status: "active",
        addedAt: 1780790400,
        updatedAt: 1780794000,
      }),
    ).toMatchObject({
      id: "item-1",
      unitPrice: 12.5,
      totalPrice: 25,
      customizations: { spiceLevel: "mild" },
      createdAt: new Date(1780790400 * 1000),
    });

    expect(
      service["formatActivity"]({
        id: "activity-1",
        groupOrderId: "group-1",
        memberId: "member-1",
        action: "item_added",
        description: "Added item",
        metadata: { itemId: "item-1", quantity: 2 },
        createdAt: 1780790400,
      }),
    ).toMatchObject({
      id: "activity-1",
      activityId: "activity-1",
      type: "item_added",
      metadata: { itemId: "item-1", quantity: 2 },
      timestamp: new Date(1780790400 * 1000),
    });
  });

  it("lists group orders with cents-first totals", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupOrders: [[{ ...baseGroupOrder, totalAmountCents: 12345 }]],
        groupMembers: [[hostMember]],
        groupCartItems: [[]],
        splitBills: [[]],
      }),
    );

    await expect(service.listGroupOrders("restaurant-1")).resolves.toEqual([
      expect.objectContaining({
        id: "group-1",
        hostName: "Host",
        memberCount: 1,
        totalAmount: 123.45,
        subtotal: 123.45,
      }),
    ]);
  });

  it("preserves an explicit zero final total and marks members without bills unpaid", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupOrders: [
          [
            {
              ...baseGroupOrder,
              totalAmountCents: 1200,
              serviceChargeCents: 100,
              taxAmountCents: 100,
              finalAmountCents: 0,
            },
          ],
        ],
        groupMembers: [[hostMember]],
        groupCartItems: [[]],
        splitBills: [[]],
      }),
    );

    await expect(
      service.listGroupOrders("restaurant-1"),
    ).resolves.toMatchObject([
      {
        totalAmount: 0,
        members: [
          expect.objectContaining({
            paymentStatus: "unpaid",
            revenueRecognised: false,
          }),
        ],
      },
    ]);
  });

  it("returns cached group order summaries before querying the database", async () => {
    const { kv, values } = createKV();
    const cached = {
      groupOrder: { id: "group-1" },
      members: [],
      cartItems: [],
      totalAmount: 0,
      activities: [],
    };
    values.set("group_order_summary:group-1", JSON.stringify(cached));
    const service = new GroupOrdersService({} as D1Database, kv);
    useDb(service, {
      select: vi.fn(() => {
        throw new Error("db should not be queried");
      }),
    });

    await expect(service.getGroupOrder("group-1")).resolves.toEqual(cached);
  });

  it("assembles and caches group order summaries from query results", async () => {
    const { kv, values } = createKV();
    const service = new GroupOrdersService({} as D1Database, kv);
    const groupOrder = {
      id: "group-1",
      restaurantId: "restaurant-1",
      tableId: null,
      shareCode: "ABC123",
      createdBy: 7,
      status: "active",
      expiresAt: new Date("2026-06-08T00:00:00.000Z"),
      lockedAt: null,
      completedAt: null,
      settings: { maxMembers: 4 },
      totalAmount: 99,
      totalAmountCents: 12345,
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
      updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    };

    useDb(
      service,
      createDb({
        groupOrders: [[groupOrder]],
        groupMembers: [
          [
            {
              id: "member-1",
              groupOrderId: "group-1",
              name: "Host",
              phone: null,
              email: null,
              role: "creator",
              joinedAt: new Date("2026-06-07T00:00:00.000Z"),
              lastActiveAt: new Date("2026-06-07T00:00:00.000Z"),
              leftAt: null,
            },
          ],
        ],
        groupCartItems: [
          [
            {
              cartItem: {
                id: "item-1",
                groupOrderId: "group-1",
                memberId: "member-1",
                menuItemId: 10,
                quantity: 2,
                unitPrice: 9,
                totalPrice: 18,
                unitPriceCents: 1250,
                totalPriceCents: 2500,
                customizations: {},
                specialInstructions: "Less spicy",
                addedAt: new Date("2026-06-07T00:00:00.000Z"),
                updatedAt: new Date("2026-06-07T00:00:00.000Z"),
              },
              menuItemName: "Nasi Lemak",
              menuItemPrice: 999,
              menuItemPriceCents: 1250,
              menuItemImageUrl: null,
            },
          ],
        ],
        groupActivityLogs: [
          [
            {
              id: "activity-1",
              groupOrderId: "group-1",
              memberId: "member-1",
              action: "item_added",
              description: "Added item",
              metadata: {},
              createdAt: new Date("2026-06-07T00:00:00.000Z"),
            },
          ],
        ],
        // Empty until the host splits, which is the normal state for a group
        // still ordering.
        splitBills: [[]],
      }),
    );

    const result = await service.getGroupOrder("group-1");

    expect(result).toMatchObject({
      groupOrder: {
        id: "group-1",
        totalAmount: 123.45,
      },
      members: [{ id: "member-1", isHost: true }],
      cartItems: [
        {
          id: "item-1",
          totalPrice: 25,
          menuItem: {
            id: 10,
            name: "Nasi Lemak",
            price: 12.5,
          },
        },
      ],
      totalAmount: 123.45,
      activities: [{ id: "activity-1", type: "item_added" }],
      splitBills: [],
    });
    expect(
      JSON.parse(values.get("group_order_summary:group-1") ?? "{}"),
    ).toMatchObject({ totalAmount: 123.45 });
  });

  it("lists group orders with truthful batched bill and quantity data", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [
        [
          {
            ...baseGroupOrder,
            tableId: 12,
            settings: { tableNumber: "A5" },
            totalAmount: 45,
            totalAmountCents: 4500,
          },
        ],
      ],
      groupMembers: [
        [hostMember, { ...hostMember, id: "member-2", role: "member" }],
      ],
      groupCartItems: [
        [
          {
            id: "cart-1",
            groupOrderId: "group-1",
            memberId: "member-1",
            quantity: 2,
          },
          {
            id: "cart-2",
            groupOrderId: "group-1",
            memberId: "member-2",
            quantity: 3,
          },
        ],
      ],
      splitBills: [
        [
          {
            groupOrderId: "group-1",
            memberId: "member-1",
            totalAmountCents: 3000,
            paymentStatus: "paid",
            settledBy: "self",
          },
          {
            groupOrderId: "group-1",
            memberId: "member-2",
            totalAmountCents: 2000,
            paymentStatus: "paid",
            settledBy: "provider",
          },
        ],
      ],
    });
    useDb(service, db);

    await expect(
      service.listGroupOrders("restaurant-1", "active"),
    ).resolves.toMatchObject([
      {
        id: "group-1",
        tableNumber: "A5",
        hostName: "Host",
        memberCount: 2,
        itemCount: 5,
        totalAmount: 45,
        members: [
          expect.objectContaining({
            memberName: "Host",
            itemCount: 2,
            totalAmount: 30,
            paidAmount: 0,
            paymentStatus: "paid",
            settledBy: "self",
            revenueRecognised: false,
          }),
          expect.objectContaining({
            itemCount: 3,
            totalAmount: 20,
            paidAmount: 20,
            paymentStatus: "paid",
            settledBy: "provider",
            revenueRecognised: true,
          }),
        ],
      },
    ]);
    expect(db.select).toHaveBeenCalledTimes(4);
  });

  it("only includes published cart items in group summaries and list counts", async () => {
    const summaryService = createService();
    const summaryDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[hostMember]],
      groupCartItems: [[]],
      groupActivityLogs: [[]],
      splitBills: [[]],
    });
    useDb(summaryService, summaryDb);

    await summaryService.getGroupOrder("group-1");

    const listService = createService();
    const listDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[hostMember]],
      groupCartItems: [[]],
    });
    useDb(listService, listDb);

    await listService.listGroupOrders("restaurant-1");

    for (const db of [summaryDb, listDb]) {
      const cartItemWhere = db.selectWhereClauses.find(
        ({ table }) => table === groupCartItems,
      );
      expect(
        conditionContainsBoundValue(cartItemWhere?.condition, "active"),
      ).toBe(true);
    }
  });

  it("returns empty lists when no rows exist or list queries fail", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(service.listGroupOrders("restaurant-1")).resolves.toEqual([]);

    useDb(service, {
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    });
    await expect(
      service.listGroupOrders("restaurant-1", "active"),
    ).resolves.toEqual([]);
  });

  it("creates a group order with host member, activity log, and cache aliases", async () => {
    const { kv, values } = createKV();
    const service = new GroupOrdersService({} as D1Database, kv);
    const db = createDb({ groupMembers: [[{ ...hostMember, id: "uuid-2" }]] });
    useDb(service, db);
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await service.createGroupOrder(
      {
        restaurantId: "restaurant-1",
        hostName: "Ada",
        tableNumber: "T1",
        expectedMembers: 6,
        permissions: { canModifyOthersCart: true },
      },
      "7",
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        groupOrderId: "uuid-1",
        shareCode: "AAAAAAAA",
        recoveryCode: "uuid-2",
        host: { id: "uuid-2", memberName: "Host" },
      },
    });
    expect(db.inserts[0].payload).toMatchObject({
      id: "uuid-1",
      restaurantId: "restaurant-1",
      recoveryCode: "uuid-2",
      settings: {
        maxMembers: 6,
        tableNumber: "T1",
        permissions: { canModifyOthersCart: true },
        fulfillmentType: "dine_in",
        // A table that never pressed submit should not have an order placed
        // for it. Expiry cancels by default; the host opts in to the opposite.
        autoSubmitOnExpiry: false,
      },
    });
    expect(db.inserts[1].payload).toMatchObject({
      id: "uuid-3",
      name: "Ada",
      role: "creator",
    });
    expect(db.inserts[2].payload).toMatchObject({
      id: "uuid-5",
      action: "group_created",
    });
    const cached = JSON.parse(values.get("group_order:uuid-1") ?? "{}");
    expect(cached).toMatchObject({ shareCode: "AAAAAAAA" });
    expect(cached).not.toHaveProperty("memberToken");
    expect(cached).not.toHaveProperty("recoveryCode");
    expect(values.get("share_code:AAAAAAAA")).toBe('"uuid-1"');
    vi.mocked(Math.random).mockRestore();
  });

  it("creates guest-hosted group orders with nullable createdBy and fulfillment settings", async () => {
    const service = createService();
    const db = createDb({ groupMembers: [[{ ...hostMember, id: "uuid-3" }]] });
    useDb(service, db);

    const result = await service.createGroupOrder(
      {
        restaurantId: "restaurant-1",
        fulfillmentType: "delivery",
        deliveryAddress: { line1: "1 Example Rd" },
        autoSubmitOnExpiry: false,
      },
      null,
    );

    expect(result.success).toBe(true);
    expect(result.data?.recoveryCode).toBe("uuid-2");
    expect(db.inserts[0].payload).toMatchObject({
      createdBy: null,
      recoveryCode: "uuid-2",
      settings: expect.objectContaining({
        maxMembers: 30,
        fulfillmentType: "delivery",
        deliveryAddress: { line1: "1 Example Rd" },
        autoSubmitOnExpiry: false,
      }),
    });
  });

  /**
   * The toggle rewrites one key inside a JSON column. Everything else in
   * `settings` — the member cap, the permission flags, the delivery address —
   * has to survive, because losing any of it silently changes how the group
   * behaves in ways nobody asked for.
   */
  it("flips auto-submit without disturbing the rest of the settings", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [
        [
          {
            id: "group-1",
            settings: {
              maxMembers: 8,
              fulfillmentType: "delivery",
              deliveryAddress: { line1: "1 Example Rd" },
              autoSubmitOnExpiry: false,
            },
          },
        ],
      ],
    });
    useDb(service, db);

    await expect(
      service.setAutoSubmitOnExpiry("group-1", true),
    ).resolves.toMatchObject({ success: true });

    expect(db.updates.at(-1)?.payload).toMatchObject({
      settings: {
        maxMembers: 8,
        fulfillmentType: "delivery",
        deliveryAddress: { line1: "1 Example Rd" },
        autoSubmitOnExpiry: true,
      },
    });
  });

  /**
   * Choosing how the bill will be split is a preference, not an action.
   * Setting the preference must not touch the order lifecycle, or picking
   * "split equally" would silently stop everyone from adding food.
   */
  it("stores the split preference without locking the group", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [[{ id: "group-1", status: "active" }]],
    });
    useDb(service, db);

    await expect(
      service.setSplitType("group-1", "equal"),
    ).resolves.toMatchObject({ success: true });

    const written = db.updates.at(-1)?.payload as Record<string, unknown>;
    expect(written).toMatchObject({ splitType: "equal" });
    expect(written).not.toHaveProperty("status");
    expect(written).not.toHaveProperty("lockedAt");
  });

  /**
   * The column stores `individual`; the client calls the same thing `by_item`.
   * `splitBill` already maps one to the other, so the preference has to be
   * written in the same vocabulary or finalize would split by a mode the host
   * never chose.
   */
  it("stores by_item using the value the column expects", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [[{ id: "group-1", status: "active" }]],
    });
    useDb(service, db);

    await service.setSplitType("group-1", "by_item");

    expect(db.updates.at(-1)?.payload).toMatchObject({
      splitType: "individual",
    });
  });

  it("refuses to set a split preference on a group order that is gone", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(
      service.setSplitType("missing", "equal"),
    ).resolves.toMatchObject({ success: false });
  });

  /**
   * The stored preference has to reach the client, or the selector renders
   * whatever its fallback is and the host sees a mode they never picked. The
   * column speaks `individual`; the client speaks `by_item`.
   */
  it("carries the split preference out to the client as by_item", () => {
    const service = createService();

    expect(
      service["formatGroupOrder"]({
        ...baseGroupOrder,
        id: "group-1",
        splitType: "individual",
      }),
    ).toMatchObject({ splitType: "by_item" });
  });

  it("carries equal and proportional through unchanged", () => {
    const service = createService();

    expect(
      service["formatGroupOrder"]({ ...baseGroupOrder, splitType: "equal" }),
    ).toMatchObject({ splitType: "equal" });
    expect(
      service["formatGroupOrder"]({
        ...baseGroupOrder,
        splitType: "proportional",
      }),
    ).toMatchObject({ splitType: "proportional" });
  });

  it("refuses to flip auto-submit on a group order that is gone", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(
      service.setAutoSubmitOnExpiry("missing", true),
    ).resolves.toMatchObject({ success: false });
  });

  it("defaults expiresAt to 45 minutes when no expiration is provided", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupMembers: [[{ ...hostMember, id: "uuid-3" }]],
      }),
    );

    const result = await service.createGroupOrder(
      { restaurantId: "restaurant-1" },
      null,
    );

    expect(result.success).toBe(true);
    expect(result.data?.expiresAt.getTime()).toBe(
      new Date("2026-06-07T00:45:00.000Z").getTime(),
    );
  });

  it("previews a group order without write, cache, or activity side effects", async () => {
    const { kv } = createKV();
    const service = new GroupOrdersService({} as D1Database, kv);
    const db = createDb({
      groupOrders: [
        [
          {
            ...baseGroupOrder,
            settings: { fulfillmentType: "pickup" },
          },
        ],
      ],
      groupMembers: [
        [hostMember, { ...hostMember, id: "member-2", role: "member" }],
      ],
    });
    useDb(service, db);

    await expect(service.previewGroupByShareCode("ABC12345")).resolves.toEqual({
      found: true,
      data: expect.objectContaining({
        groupOrderId: "group-1",
        hostName: "Host",
        memberCount: 2,
        fulfillmentType: "pickup",
      }),
    });

    expect(db.inserts).toEqual([]);
    expect(db.updates).toEqual([]);
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("returns found false for missing join previews", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(service.previewGroupByShareCode("NOPE0000")).resolves.toEqual({
      found: false,
    });
  });

  it("surfaces database failures instead of reporting the group order as missing", async () => {
    const service = createService();
    const db = createDb();
    db.select = vi.fn(() => {
      throw new Error("D1_UNAVAILABLE");
    });
    useDb(service, db);
    const logError = vi.fn();
    service["errorTracker"] = Object.assign(service["errorTracker"], {
      logError,
    });

    // Resolving to { found: false } here would make the route answer 404
    // "not found or expired" during an outage — wrong for the member reading
    // it, and invisible to alerting.
    await expect(service.previewGroupByShareCode("ABC12345")).rejects.toThrow(
      "D1_UNAVAILABLE",
    );

    expect(logError).toHaveBeenCalledWith(
      "previewGroupByShareCode",
      expect.any(Error),
      expect.objectContaining({ shareCode: "ABC12345" }),
    );
  });

  it("narrows a known group order status straight through", () => {
    const service = createService();
    for (const status of ["active", "checkout", "completed", "cancelled"]) {
      expect(service["narrowStatus"](status, "go-1")).toBe(status);
    }
  });

  it("falls back to active and reports a status the service never writes", () => {
    const service = createService();
    const logError = vi.fn();
    service["errorTracker"] = Object.assign(service["errorTracker"], {
      logError,
    });

    // "ordering" was a valid value under the legacy CHECK constraint. The
    // column is plain TEXT, so a bare `as GroupOrderStatus` would have let it
    // through wearing a type it does not satisfy.
    expect(service["narrowStatus"]("ordering", "go-1")).toBe("active");

    expect(logError).toHaveBeenCalledWith(
      "formatGroupOrder",
      expect.any(Error),
      expect.objectContaining({ groupOrderId: "go-1", status: "ordering" }),
    );
  });

  it("narrows raw statuses returned by list and join preview endpoints", async () => {
    const service = createService();
    const logError = vi.fn();
    service["errorTracker"] = Object.assign(service["errorTracker"], {
      logError,
    });
    useDb(
      service,
      createDb({
        groupOrders: [[{ ...baseGroupOrder, status: "ordering" }]],
        groupMembers: [[hostMember]],
        groupCartItems: [[]],
        splitBills: [[]],
      }),
    );

    await expect(service.listGroupOrders("restaurant-1")).resolves.toEqual([
      expect.objectContaining({ id: "group-1", status: "active" }),
    ]);

    const previewService = createService();
    previewService["errorTracker"] = Object.assign(
      previewService["errorTracker"],
      { logError },
    );
    useDb(
      previewService,
      createDb({
        groupOrders: [[{ ...baseGroupOrder, status: "ordering" }]],
        groupMembers: [[hostMember]],
      }),
    );

    await expect(
      previewService.previewGroupByShareCode("ABC12345"),
    ).resolves.toEqual({
      found: true,
      data: expect.objectContaining({ status: "active" }),
    });
    expect(logError).toHaveBeenCalledWith(
      "formatGroupOrder",
      expect.any(Error),
      expect.objectContaining({ groupOrderId: "group-1", status: "ordering" }),
    );
  });

  it("recovers the host session and replaces the previous member token", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[{ ...hostMember, id: "member-1" }]],
    });
    useDb(service, db);

    await expect(
      service.recoverHost("group-1", "recovery-1"),
    ).resolves.toMatchObject({
      success: true,
      data: { memberToken: "uuid-1" },
    });

    expect(db.updates[0].payload).toMatchObject({ sessionId: "uuid-1" });
    expect(db.inserts[0].payload).toMatchObject({
      action: "member_joined",
      metadata: { recovered: true },
    });
  });

  it("uses the same recovery failure for wrong code, missing group, and missing creator", async () => {
    const service = createService();

    useDb(service, createDb({ groupOrders: [[]] }));
    await expect(service.recoverHost("group-1", "wrong")).resolves.toEqual({
      success: false,
      error: "Invalid recovery code",
    });

    useDb(service, createDb({ groupOrders: [[]] }));
    await expect(service.recoverHost("missing", "recovery-1")).resolves.toEqual(
      {
        success: false,
        error: "Invalid recovery code",
      },
    );

    useDb(
      service,
      createDb({
        groupOrders: [[baseGroupOrder]],
        groupMembers: [[]],
      }),
    );
    await expect(service.recoverHost("group-1", "recovery-1")).resolves.toEqual(
      {
        success: false,
        error: "Invalid recovery code",
      },
    );
  });

  it("does not recover inactive or expired group orders", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(
      service.recoverHost("completed-group", "recovery-1"),
    ).resolves.toEqual({
      success: false,
      error: "Invalid recovery code",
    });
  });

  it("joins active groups and rejects full or duplicate-member groups", async () => {
    const service = createService();
    const fullDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[{ count: 4 }]],
    });
    useDb(service, fullDb);

    await expect(
      service.joinGroup("ABC12345", { memberName: "Lin" }),
    ).resolves.toEqual({
      success: false,
      error: "Group order is full",
    });

    const duplicateDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[{ count: 1 }], [hostMember]],
    });
    useDb(service, duplicateDb);
    await expect(
      service.joinGroup("ABC12345", { memberName: "Host" }),
    ).resolves.toEqual({
      success: false,
      error: "Member name already exists in this group",
    });

    const { kv, values } = createKV();
    values.set("group_order:group-1", JSON.stringify({ stale: true }));
    const joinService = new GroupOrdersService({} as D1Database, kv);
    const joinDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [
        [{ count: 1 }],
        [],
        [{ ...hostMember, id: "uuid-1", name: "Lin", role: "member" }],
      ],
    });
    useDb(joinService, joinDb);

    await expect(
      joinService.joinGroup("ABC12345", {
        memberName: "Lin",
        phone: "0912",
        email: "lin@example.test",
      }),
    ).resolves.toMatchObject({
      success: true,
      data: {
        member: { id: "uuid-1", memberName: "Lin", isHost: false },
        groupOrder: { id: "group-1" },
      },
    });
    expect(joinDb.inserts[0].payload).toMatchObject({
      id: "uuid-1",
      name: "Lin",
      phone: "0912",
      email: "lin@example.test",
    });
    expect(values.has("group_order:group-1")).toBe(false);
  });

  it("returns join errors for missing groups and database failures", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(
      service.joinGroup("MISSING", { memberName: "Lin" }),
    ).resolves.toEqual({
      success: false,
      error: "Group order not found or expired",
    });

    useDb(service, {
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    });
    await expect(
      service.joinGroup("ABC12345", { memberName: "Lin" }),
    ).resolves.toEqual({
      success: false,
      error: "Failed to join group",
    });
  });

  it("adds and updates cart items while recalculating member and group totals", async () => {
    const { kv, values } = createKV();
    values.set("group_order_summary:group-1", JSON.stringify({ stale: true }));
    const service = new GroupOrdersService({} as D1Database, kv);
    const cartItem = {
      id: "uuid-1",
      groupOrderId: "group-1",
      memberId: "member-1",
      menuItemId: 10,
      quantity: 2,
      unitPrice: 12.5,
      totalPrice: 25,
      unitPriceCents: 1250,
      totalPriceCents: 2500,
      customizations: { spice: "hot" },
      specialInstructions: "No peanuts",
      addedAt: new Date("2026-06-07T00:00:00.000Z"),
      updatedAt: new Date("2026-06-07T00:00:00.000Z"),
    };
    useDb(
      service,
      createDb({
        groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
        groupMembers: [[hostMember]],
        menuItems: [
          [
            {
              id: 10,
              restaurantId: "restaurant-1",
              name: "Laksa",
              price: 9,
              priceCents: 1250,
            },
          ],
        ],
        restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
        groupCartItems: [[{ total: 25 }], [{ total: 25 }], [cartItem]],
        splitBills: [[]],
      }),
    );

    await expect(
      service.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 2,
        customizations: { spice: "hot" },
        specialInstructions: "No peanuts",
      }),
    ).resolves.toMatchObject({
      success: true,
      data: { id: "uuid-1", totalPrice: 25 },
    });
    expect(values.has("group_order_summary:group-1")).toBe(false);

    const updateService = createService();
    const updateDb = createDb({
      groupCartItems: [
        [cartItem],
        [{ total: 37.5 }],
        [{ total: 37.5 }],
        [{ ...cartItem, quantity: 3, totalPriceCents: 3750 }],
      ],
      groupOrders: [[{ restaurantId: "restaurant-1" }]],
      restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
      splitBills: [[]],
      menuItems: [[]],
    });
    useDb(updateService, updateDb);

    await expect(
      updateService.updateCartItem("group-1", "uuid-1", {
        quantity: 3,
        specialInstructions: "Extra soup",
      }),
    ).resolves.toMatchObject({
      success: true,
      data: { quantity: 3, totalPrice: 37.5 },
    });
    expect(updateDb.updates[0].payload).toMatchObject({
      quantity: 3,
      totalPriceCents: 3750,
      specialInstructions: "Extra soup",
    });
  });

  it("handles cart add validation, fallback response, and update errors", async () => {
    const missingGroupService = createService();
    useDb(missingGroupService, createDb({ groupOrders: [[]] }));
    await expect(
      missingGroupService.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toEqual({ success: false, error: "Group order not found" });

    const inactiveGroupService = createService();
    useDb(
      inactiveGroupService,
      createDb({
        groupOrders: [[{ ...baseGroupOrder, status: "checkout" }]],
      }),
    );
    await expect(
      inactiveGroupService.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toEqual({
      success: false,
      error: "Group order is not active",
    });

    const expiredGroupService = createService();
    useDb(
      expiredGroupService,
      createDb({
        groupOrders: [
          [{ ...baseGroupOrder, expiresAt: new Date("2026-06-06T00:00:00Z") }],
        ],
      }),
    );
    await expect(
      expiredGroupService.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toEqual({
      success: false,
      error: "Group order has expired",
    });

    const missingMemberService = createService();
    useDb(
      missingMemberService,
      createDb({
        groupOrders: [[baseGroupOrder]],
        groupMembers: [[]],
      }),
    );
    await expect(
      missingMemberService.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toEqual({
      success: false,
      error: "Member not found in group",
    });

    const missingMenuService = createService();
    useDb(
      missingMenuService,
      createDb({
        groupOrders: [[baseGroupOrder]],
        groupMembers: [[hostMember]],
        menuItems: [[]],
      }),
    );
    await expect(
      missingMenuService.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toEqual({ success: false, error: "Menu item not found" });

    const fallbackService = createService();
    const fallbackDb = createDb({
      groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
      groupMembers: [[hostMember]],
      menuItems: [
        [
          {
            id: 10,
            restaurantId: "restaurant-1",
            name: "Laksa",
            price: 999,
            priceCents: 900,
          },
        ],
      ],
      restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
      groupCartItems: [[{ total: 9 }], [{ total: 9 }], []],
      splitBills: [[]],
    });
    useDb(fallbackService, fallbackDb);
    await expect(
      fallbackService.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: { id: "uuid-1", totalPrice: 9 },
    });

    const updateMissingService = createService();
    useDb(updateMissingService, createDb({ groupCartItems: [[]] }));
    await expect(
      updateMissingService.updateCartItem("group-1", "item-1", {
        quantity: 2,
      }),
    ).resolves.toEqual({ success: false, error: "Cart item not found" });

    const updateFailureService = createService();
    useDb(
      updateFailureService,
      createDb({
        groupCartItems: [
          [
            {
              id: "item-1",
              groupOrderId: "group-1",
              memberId: "member-1",
              unitPrice: 9,
            },
          ],
          [{ total: 18 }],
          [{ total: 18 }],
          [],
        ],
        splitBills: [[]],
      }),
    );
    await expect(
      updateFailureService.updateCartItem("group-1", "item-1", {
        quantity: 2,
        customizations: { spice: "mild" },
      }),
    ).resolves.toEqual({
      success: false,
      error: "Failed to update cart item",
    });
  });

  it("removes cart items and reports missing or failed removals", async () => {
    const missingService = createService();
    useDb(missingService, createDb({ groupCartItems: [[]] }));
    await expect(
      missingService.removeCartItem("group-1", "item-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Cart item not found",
    });

    const service = createService();
    const db = createDb({
      groupCartItems: [
        [
          {
            id: "item-1",
            groupOrderId: "group-1",
            memberId: "member-1",
          },
        ],
        [{ total: 0 }],
        [{ total: 0 }],
      ],
      groupOrders: [[{ restaurantId: "restaurant-1" }]],
      restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
      splitBills: [[]],
    });
    useDb(service, db);
    await expect(
      service.removeCartItem("group-1", "item-1", "member-1"),
    ).resolves.toEqual({ success: true });
    expect(db.deletes).toHaveLength(1);
    expect(db.inserts.at(-1)?.payload).toMatchObject({
      action: "item_removed",
      metadata: { itemId: "item-1" },
    });

    const failingService = createService();
    useDb(failingService, {
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    });
    await expect(
      failingService.removeCartItem("group-1", "item-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Failed to remove cart item",
    });
  });

  // `validateGroupOrderAndMember` reads the group's status, and a finalizer can
  // claim between that read and the insert. The item therefore lands staged and
  // is published by a conditional write; losing that race must leave nothing
  // behind, not an active row on a group that has already been billed.
  it("discards a staged cart item when the group is claimed before it is published", async () => {
    const service = createService();
    const db = createDb(
      {
        groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
        groupMembers: [[hostMember]],
        menuItems: [
          [
            {
              id: 10,
              restaurantId: "restaurant-1",
              name: "Laksa",
              price: 9,
              priceCents: 900,
            },
          ],
        ],
      },
      { groupCartItems: { update: [[]] } },
    );
    useDb(service, db);

    await expect(
      service.addCartItem("group-1", {
        memberId: "member-1",
        menuItemId: 10,
        quantity: 1,
      }),
    ).resolves.toEqual({
      success: false,
      error: "Group order is no longer active",
    });

    // Staged, never published, and cleaned up.
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].payload).toMatchObject({ status: "staging" });
    expect(db.deletes).toContain(groupCartItems);
  });

  it("rejects cart updates and removals once the group is no longer active", async () => {
    const storedItem = {
      id: "item-1",
      groupOrderId: "group-1",
      memberId: "member-1",
      menuItemId: 10,
      unitPriceCents: 900,
      totalPriceCents: 900,
      quantity: 1,
    };

    const updateService = createService();
    useDb(
      updateService,
      createDb(
        { groupCartItems: [[storedItem]] },
        { groupCartItems: { update: [[]] } },
      ),
    );
    await expect(
      updateService.updateCartItem("group-1", "item-1", { quantity: 2 }),
    ).resolves.toEqual({
      success: false,
      error: "Group order is no longer active",
    });

    const removeService = createService();
    useDb(
      removeService,
      createDb(
        { groupCartItems: [[storedItem]] },
        { groupCartItems: { delete: [[]] } },
      ),
    );
    await expect(
      removeService.removeCartItem("group-1", "item-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Group order is no longer active",
    });
  });

  /**
   * Members may clear each other's dishes off the shared cart, so the caller
   * and the item's owner are no longer the same person. Everything the
   * removal writes afterwards — the activity log, and the member total that
   * decides who owes what — has to follow the item, not whoever pressed the
   * button. Crediting the caller would quietly move a dish's cost onto them
   * and leave the real owner still charged for it.
   */
  it("credits a removal to the member whose item it was", async () => {
    const service = createService();
    const db = createDb({
      groupCartItems: [
        [
          {
            id: "item-1",
            groupOrderId: "group-1",
            memberId: "member-1",
          },
        ],
        [{ total: 0 }],
        [{ total: 0 }],
      ],
      groupOrders: [[{ restaurantId: "restaurant-1" }]],
      restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
      splitBills: [[]],
    });
    useDb(service, db);

    await expect(
      service.removeCartItem("group-1", "item-1", "member-2"),
    ).resolves.toEqual({ success: true });

    expect(db.inserts.at(-1)?.payload).toMatchObject({
      action: "item_removed",
      memberId: "member-1",
    });
  });

  /**
   * `calculateOrderTotal` in the shared base service is what every ordinary
   * order goes through, so it defines what a rate means and what tax applies
   * to for this restaurant:
   *
   *   serviceCharge = subtotal * rate      (0.1 is 10%)
   *   tax           = subtotal * rate      (the subtotal, not subtotal + fee)
   *
   * splitBill used to read the same stored rate as a percentage and charge tax
   * on subtotal + service charge, so the identical cart cost more when ordered
   * as a group — and a restaurant that set serviceChargeRate to 0.1 for its
   * normal orders would have billed group members 0.1% instead of 10%.
   */
  /**
   * Who carries the service charge and tax is a separate question from how the
   * food is divided, and the host answers it when opening the group:
   *
   *   proportional — each member pays fees on what they ordered (the default,
   *                  and what every group order did before there was a choice)
   *   equal        — the fees are divided by headcount, so a light eater
   *                  subsidises a heavy one
   *   host         — the host picks up all of it and nobody else sees a fee
   *
   * Same cart in all three: member-1 (the host) ordered 10, member-2 ordered
   * 30, and a 10% service charge means 4 to place somewhere.
   */
  /**
   * The host can change their mind while the table is still ordering, the same
   * way they can change the split method. Like that one it records a choice —
   * it must not lock the group, and it must not lose the rest of `settings`.
   */
  it("changes the fee choice without locking the group or losing settings", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [
        [
          {
            id: "group-1",
            settings: { maxMembers: 8, autoSubmitOnExpiry: true },
          },
        ],
      ],
    });
    useDb(service, db);

    await expect(service.setFeeMode("group-1", "equal")).resolves.toMatchObject(
      { success: true },
    );

    const written = db.updates.at(-1)?.payload as Record<string, unknown>;
    expect(written).toMatchObject({
      settings: {
        maxMembers: 8,
        autoSubmitOnExpiry: true,
        feeMode: "equal",
      },
    });
    expect(written).not.toHaveProperty("status");
    expect(written).not.toHaveProperty("lockedAt");
  });

  it("refuses to change the fee choice on a group order that is gone", async () => {
    const service = createService();
    useDb(service, createDb({ groupOrders: [[]] }));

    await expect(service.setFeeMode("missing", "host")).resolves.toMatchObject({
      success: false,
    });
  });

  it("carries the fee choice out to the client", () => {
    const service = createService();

    expect(
      service["formatGroupOrder"]({
        ...baseGroupOrder,
        settings: { feeMode: "host" },
      }),
    ).toMatchObject({ feeMode: "host" });

    // Absence means the mode every older group was charged under.
    expect(service["formatGroupOrder"](baseGroupOrder)).toMatchObject({
      feeMode: "proportional",
    });
  });

  it("keeps the host's fee choice from the moment the group is opened", async () => {
    const service = createService();
    const db = createDb({ groupMembers: [[{ ...hostMember, id: "uuid-3" }]] });
    useDb(service, db);

    await service.createGroupOrder(
      { restaurantId: "restaurant-1", feeMode: "host" },
      null,
    );

    expect(db.inserts[0].payload).toMatchObject({
      settings: expect.objectContaining({ feeMode: "host" }),
    });
  });

  it("defaults to charging each member on their own items", async () => {
    const service = createService();
    const db = createDb({ groupMembers: [[{ ...hostMember, id: "uuid-3" }]] });
    useDb(service, db);

    await service.createGroupOrder({ restaurantId: "restaurant-1" }, null);

    // Groups opened before the choice existed have no feeMode at all, and they
    // were all charged this way — so this is what absence has to mean.
    expect(db.inserts[0].payload).toMatchObject({
      settings: expect.objectContaining({ feeMode: "proportional" }),
    });
  });

  describe("who carries the service charge", () => {
    function feeSplitDb() {
      return createSplitDb({
        members: [hostMember, secondMember],
        items: [
          cartItem("cart-1", "member-1", 1000),
          cartItem("cart-2", "member-2", 3000),
        ],
      });
    }

    it("charges each member on their own items by default", async () => {
      const service = createService();
      useDb(service, feeSplitDb());

      await expect(
        service.splitBill("group-1", {
          splitType: "by_item",
          serviceChargeRate: 0.1,
        }),
      ).resolves.toMatchObject({
        success: true,
        data: [
          { memberId: "member-1", subtotal: 10, serviceCharge: 1 },
          { memberId: "member-2", subtotal: 30, serviceCharge: 3 },
        ],
      });
    });

    it("divides the fee by headcount when the host chose equal", async () => {
      const service = createService();
      useDb(service, feeSplitDb());

      await expect(
        service.splitBill("group-1", {
          splitType: "by_item",
          serviceChargeRate: 0.1,
          feeMode: "equal",
        }),
      ).resolves.toMatchObject({
        success: true,
        data: [
          { memberId: "member-1", subtotal: 10, serviceCharge: 2 },
          { memberId: "member-2", subtotal: 30, serviceCharge: 2 },
        ],
      });
    });

    it("puts the whole fee on the host when the host chose to absorb it", async () => {
      const service = createService();
      useDb(service, feeSplitDb());

      await expect(
        service.splitBill("group-1", {
          splitType: "by_item",
          serviceChargeRate: 0.1,
          feeMode: "host",
        }),
      ).resolves.toMatchObject({
        success: true,
        data: [
          { memberId: "member-1", subtotal: 10, serviceCharge: 4 },
          // Nothing beyond what they ate — this is the point of the mode.
          { memberId: "member-2", subtotal: 30, serviceCharge: 0 },
        ],
      });
    });

    /**
     * Finalize hands `splitBill` the real order's charges as absolute cents
     * rather than rates, so the same three answers have to come out of that
     * path too — otherwise the mode the host picked would apply right up until
     * the order was actually placed, and then quietly stop.
     */
    it("applies the same choice to the amounts finalize passes in", async () => {
      const service = createService();
      useDb(service, feeSplitDb());

      await expect(
        service.splitBill("group-1", {
          splitType: "by_item",
          feeMode: "host",
          sharedServiceChargeCents: 400,
          orderTotalCents: 4400,
        }),
      ).resolves.toMatchObject({
        success: true,
        data: [
          { memberId: "member-1", serviceCharge: 4 },
          { memberId: "member-2", serviceCharge: 0 },
        ],
      });
    });
  });

  it("reads rates and charges tax the way an ordinary order does", async () => {
    const service = createService();
    useDb(
      service,
      createSplitDb({
        members: [hostMember],
        items: [cartItem("cart-1", "member-1", 10000)],
      }),
    );

    await expect(
      service.splitBill("group-1", {
        splitType: "equal",
        serviceChargeRate: 0.1,
        taxRate: 0.05,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          memberId: "member-1",
          subtotal: 100,
          serviceCharge: 10,
          // 5 — not 5.5, which is what taxing the service charge too gives.
          taxAmount: 5,
          totalAmount: 115,
        },
      ],
    });
  });

  it("allows splitting after the group order has been submitted", async () => {
    const service = createService();
    useDb(
      service,
      createSplitDb({
        groupOrder: { ...baseGroupOrder, status: "completed" },
        members: [hostMember],
        items: [cartItem("cart-1", "member-1", 1200)],
      }),
    );

    await expect(
      service.splitBill("group-1", { splitType: "by_item" }),
    ).resolves.toMatchObject({
      success: true,
      data: [{ memberId: "member-1", totalAmount: 12 }],
    });
  });

  it("splits bills equally and completes a member payment", async () => {
    const { kv, values } = createKV();
    values.set("group_order_summary:group-1", JSON.stringify({ stale: true }));
    const service = new GroupOrdersService({} as D1Database, kv);
    const secondMember = { ...hostMember, id: "member-2", role: "member" };
    const splitDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[hostMember, secondMember]],
      groupCartItems: [
        [
          {
            id: "cart-1",
            groupOrderId: "group-1",
            memberId: "member-1",
            menuItemId: 10,
            quantity: 1,
            unitPriceCents: 1000,
            totalPriceCents: 1000,
            customizations: {},
          },
          {
            id: "cart-2",
            groupOrderId: "group-1",
            memberId: "member-2",
            menuItemId: 20,
            quantity: 1,
            unitPriceCents: 3000,
            totalPriceCents: 3000,
            customizations: {},
          },
        ],
      ],
      splitBills: [[], []],
    });
    useDb(service, splitDb);

    await expect(
      service.splitBill("group-1", {
        splitType: "equal",
        serviceChargeRate: 0.1,
        taxRate: 0.05,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          memberId: "member-1",
          subtotal: 20,
          serviceCharge: 2,
          taxAmount: 1,
          totalAmount: 23,
        },
        {
          memberId: "member-2",
          totalAmount: 23,
        },
      ],
    });
    expect(splitDb.inserts).toHaveLength(3);
    expect(splitDb.updates[0].payload).toMatchObject({
      splitType: "equal",
      finalAmountCents: 4600,
    });
    expect(splitDb.updates[0].payload).not.toHaveProperty("status");
    expect(splitDb.updates[0].payload).not.toHaveProperty("lockedAt");
    expect(values.has("group_order_summary:group-1")).toBe(false);

    const paymentService = createService();
    const paymentDb = createDb({
      groupOrders: [[{ ...baseGroupOrder, status: "checkout" }]],
      groupMembers: [[hostMember]],
      splitBills: [
        [
          {
            id: "split-1",
            groupOrderId: "group-1",
            memberId: "member-1",
            totalAmount: 23,
            totalAmountCents: 2300,
            paymentStatus: "pending",
          },
        ],
        [{ count: 0 }],
      ],
    });
    useDb(paymentService, paymentDb);

    await expect(
      paymentService.processPayment(
        "group-1",
        "member-1",
        { paymentMethod: "cash", transactionId: "txn-1" },
        "staff",
      ),
    ).resolves.toMatchObject({
      success: true,
      data: {
        memberId: "member-1",
        amount: 23,
        transactionId: "txn-1",
        groupOrderStatus: "checkout",
      },
    });
    expect(paymentDb.updates[0].payload).toMatchObject({
      paymentStatus: "paid",
      paymentMethod: "cash",
    });
    expect(paymentDb.updates).toHaveLength(1);
  });

  it("splits bills by item or custom amounts and validates split inputs", async () => {
    const byItemService = createService();
    const byItemDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [
        [hostMember, { ...hostMember, id: "member-2", role: "member" }],
      ],
      groupCartItems: [
        [
          {
            id: "cart-1",
            groupOrderId: "group-1",
            memberId: "member-1",
            menuItemId: 10,
            quantity: 2,
            unitPrice: 999,
            unitPriceCents: 900,
            totalPrice: 999,
            totalPriceCents: 1800,
            status: "active",
          },
        ],
      ],
      splitBills: [
        [
          {
            id: "split-1",
            memberId: "member-1",
            paymentStatus: "paid",
            paymentMethod: "cash",
            transactionId: "settled-transaction",
            paidAt: new Date("2026-06-07T00:00:00.000Z"),
            settledBy: "staff",
          },
        ],
        [],
      ],
    });
    useDb(byItemService, byItemDb);
    await expect(
      byItemService.splitBill("group-1", {
        splitType: "by_item",
        serviceChargeRate: 0.1,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          memberId: "member-1",
          subtotal: 18,
          serviceCharge: 1.8,
          items: [{ cartItemId: "cart-1", quantity: 2 }],
        },
        { memberId: "member-2", subtotal: 0 },
      ],
    });
    expect(byItemDb.updates[1].payload).toMatchObject({
      splitType: "individual",
      finalAmountCents: 1980,
    });
    expect(byItemDb.updates[0].payload).not.toHaveProperty("paymentStatus");

    const customService = createService();
    const customDb = createDb({
      groupOrders: [[baseGroupOrder]],
      groupMembers: [[hostMember]],
      groupCartItems: [[]],
      splitBills: [[]],
    });
    useDb(customService, customDb);
    await expect(
      customService.splitBill("group-1", {
        splitType: "custom",
        customAmounts: [{ memberId: "member-1", amount: 12.34 }],
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [{ memberId: "member-1", totalAmount: 12.34 }],
    });

    // The route parses `splitType` off the request body, so a value outside
    // the union really can reach the guard under test.
    const untypedSplitType = (value: string): SplitBillRequest["splitType"] =>
      value as SplitBillRequest["splitType"];

    const guards: Array<{
      db: ReturnType<typeof createDb>;
      body?: SplitBillRequest;
      error: string;
    }> = [
      { db: createDb({ groupOrders: [[]] }), error: "Group order not found" },
      {
        db: createDb({
          groupOrders: [[{ ...baseGroupOrder, status: "cancelled" }]],
        }),
        error: "Group order is already finalized",
      },
      {
        db: createDb({ groupOrders: [[baseGroupOrder]], groupMembers: [[]] }),
        error: "No active members found",
      },
      {
        db: createDb({
          groupOrders: [[baseGroupOrder]],
          groupMembers: [[hostMember]],
          groupCartItems: [[]],
        }),
        body: { splitType: "custom" },
        error: "Custom amounts are required for custom split type",
      },
      {
        db: createDb({
          groupOrders: [[baseGroupOrder]],
          groupMembers: [[hostMember]],
          groupCartItems: [[]],
        }),
        body: {
          splitType: "custom",
          customAmounts: [{ memberId: "missing", amount: 1 }],
        },
        error: "Member missing not found in group",
      },
      {
        db: createDb({
          groupOrders: [[baseGroupOrder]],
          groupMembers: [[hostMember]],
          groupCartItems: [[]],
        }),
        body: { splitType: untypedSplitType("unsupported") },
        error: "Unsupported split type: unsupported",
      },
    ];

    for (const guard of guards) {
      const service = createService();
      useDb(service, guard.db);
      await expect(
        service.splitBill("group-1", guard.body ?? { splitType: "equal" }),
      ).resolves.toEqual({ success: false, error: guard.error });
    }
  });

  it.each<{
    splitType: SplitBillRequest["splitType"];
    expected: Array<{
      memberId: string;
      subtotal: number;
      serviceCharge: number;
      taxAmount: number;
      totalAmount: number;
    }>;
  }>([
    {
      splitType: "individual",
      expected: [
        {
          memberId: "member-1",
          subtotal: 10,
          serviceCharge: 2,
          taxAmount: 1,
          totalAmount: 13,
        },
        {
          memberId: "member-2",
          subtotal: 20,
          serviceCharge: 4,
          taxAmount: 2,
          totalAmount: 26,
        },
      ],
    },
    {
      splitType: "proportional",
      expected: [
        {
          memberId: "member-1",
          subtotal: 10,
          serviceCharge: 2,
          taxAmount: 1,
          totalAmount: 13,
        },
        {
          memberId: "member-2",
          subtotal: 20,
          serviceCharge: 4,
          taxAmount: 2,
          totalAmount: 26,
        },
      ],
    },
    {
      splitType: "equal",
      expected: [
        {
          memberId: "member-1",
          subtotal: 15,
          serviceCharge: 3,
          taxAmount: 1.5,
          totalAmount: 19.5,
        },
        {
          memberId: "member-2",
          subtotal: 15,
          serviceCharge: 3,
          taxAmount: 1.5,
          totalAmount: 19.5,
        },
      ],
    },
  ])(
    "allocates non-zero shared fees for $splitType split",
    async ({ splitType, expected }) => {
      const service = createService();
      const db = createSplitDb({
        members: [hostMember, secondMember],
        items: [
          cartItem("cart-1", "member-1", 1000),
          cartItem("cart-2", "member-2", 2000),
        ],
      });
      useDb(service, db);

      await expect(
        service.splitBill("group-1", {
          splitType,
          sharedServiceChargeCents: 600,
          sharedTaxCents: 300,
          orderTotalCents: 3900,
        }),
      ).resolves.toMatchObject({
        success: true,
        data: expected,
      });
      expect(db.updates[0].payload).toMatchObject({
        finalAmountCents: 3900,
        serviceChargeCents: 600,
        taxAmountCents: 300,
      });
    },
  );

  it("allocates non-zero shared fees for custom split by custom amount ratio", async () => {
    const service = createService();
    const db = createSplitDb({
      members: [hostMember, secondMember],
      items: [
        cartItem("cart-1", "member-1", 1000),
        cartItem("cart-2", "member-2", 2000),
      ],
    });
    useDb(service, db);

    await expect(
      service.splitBill("group-1", {
        splitType: "custom",
        customAmounts: [
          { memberId: "member-1", amount: 5 },
          { memberId: "member-2", amount: 25 },
        ],
        sharedServiceChargeCents: 600,
        sharedTaxCents: 300,
        orderTotalCents: 3900,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          memberId: "member-1",
          subtotal: 5,
          serviceCharge: 1,
          taxAmount: 0.5,
          totalAmount: 6.5,
        },
        {
          memberId: "member-2",
          subtotal: 25,
          serviceCharge: 5,
          taxAmount: 2.5,
          totalAmount: 32.5,
        },
      ],
    });
  });

  it("falls back to per-head shared fee allocation when ratio totals are zero", async () => {
    const emptyCartService = createService();
    useDb(
      emptyCartService,
      createSplitDb({
        members: [hostMember, secondMember],
      }),
    );

    await expect(
      emptyCartService.splitBill("group-1", {
        splitType: "proportional",
        sharedServiceChargeCents: 100,
        sharedTaxCents: 100,
        orderTotalCents: 200,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        {
          memberId: "member-1",
          subtotal: 0,
          serviceCharge: 0.5,
          taxAmount: 0.5,
          totalAmount: 1,
        },
        {
          memberId: "member-2",
          subtotal: 0,
          serviceCharge: 0.5,
          taxAmount: 0.5,
          totalAmount: 1,
        },
      ],
    });

    const zeroCustomService = createService();
    useDb(
      zeroCustomService,
      createSplitDb({
        members: [hostMember, secondMember],
      }),
    );

    await expect(
      zeroCustomService.splitBill("group-1", {
        splitType: "custom",
        customAmounts: [
          { memberId: "member-1", amount: 0 },
          { memberId: "member-2", amount: 0 },
        ],
        sharedServiceChargeCents: 100,
        sharedTaxCents: 100,
        orderTotalCents: 200,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        { memberId: "member-1", totalAmount: 1 },
        { memberId: "member-2", totalAmount: 1 },
      ],
    });
  });

  it("keeps proportional and individual equivalent while there are no fixed shared fees", async () => {
    const individualService = createService();
    useDb(
      individualService,
      createSplitDb({
        members: [hostMember, secondMember],
        items: [
          cartItem("cart-1", "member-1", 1000),
          cartItem("cart-2", "member-2", 2000),
        ],
      }),
    );
    const individual = await individualService.splitBill("group-1", {
      splitType: "individual",
      serviceChargeRate: 0.1,
      taxRate: 0.05,
    });

    const proportionalService = createService();
    useDb(
      proportionalService,
      createSplitDb({
        members: [hostMember, secondMember],
        items: [
          cartItem("cart-1", "member-1", 1000),
          cartItem("cart-2", "member-2", 2000),
        ],
      }),
    );
    const proportional = await proportionalService.splitBill("group-1", {
      splitType: "proportional",
      serviceChargeRate: 0.1,
      taxRate: 0.05,
    });

    // This equivalence only holds while every shared fee is proportional to
    // subtotal. A flat fee (delivery) would require the two to diverge.
    //
    // Read this as documentation, not as a tripwire: both split types now
    // route through the same branch in splitBill, so the assertion compares
    // one code path against itself and cannot fail. The warning that actually
    // has to be seen lives at that branch condition, next to the code someone
    // would be editing.
    expect(proportional.data).toEqual(individual.data);
  });

  it.each([
    {
      name: "three people evenly split $100",
      members: [hostMember, secondMember, thirdMember],
      items: [cartItem("cart-1", "member-1", 10000)],
      expectedTotalCents: 10000,
    },
    {
      name: "two people evenly split $0.01",
      members: [hostMember, secondMember],
      items: [cartItem("cart-1", "member-1", 1)],
      expectedTotalCents: 1,
    },
    {
      name: "member count greater than total cents",
      members: [hostMember, secondMember, thirdMember],
      items: [cartItem("cart-1", "member-1", 2)],
      expectedTotalCents: 2,
    },
  ])("reconciles rounding remainders for $name", async (scenario) => {
    const service = createService();
    const db = createSplitDb({
      members: scenario.members,
      items: scenario.items,
    });
    useDb(service, db);

    const result = await service.splitBill("group-1", {
      splitType: "equal",
    });

    expect(result.success).toBe(true);
    expect(totalCents(billsOf(result))).toBe(scenario.expectedTotalCents);
    expect(
      db.inserts
        .filter((insert) => "totalAmountCents" in (insert.payload as object))
        .reduce(
          (sum, insert) =>
            sum +
            (insert.payload as { totalAmountCents: number }).totalAmountCents,
          0,
        ),
    ).toBe(scenario.expectedTotalCents);
  });

  it("applies positive and negative rounding remainders to the creator member", async () => {
    const positiveService = createService();
    useDb(
      positiveService,
      createSplitDb({
        members: [hostMember, secondMember, thirdMember],
      }),
    );
    const positive = await positiveService.splitBill("group-1", {
      splitType: "equal",
      sharedTaxCents: 10000,
      orderTotalCents: 10000,
    });
    expect(
      billsOf(positive).find((bill) => bill.memberId === "member-1"),
    ).toEqual(expect.objectContaining({ totalAmount: 33.34 }));

    const negativeService = createService();
    useDb(
      negativeService,
      createSplitDb({
        members: [hostMember, secondMember],
      }),
    );
    const negative = await negativeService.splitBill("group-1", {
      splitType: "equal",
      sharedTaxCents: 1,
      orderTotalCents: 1,
    });
    expect(
      billsOf(negative).find((bill) => bill.memberId === "member-1"),
    ).toEqual(expect.objectContaining({ totalAmount: 0 }));
  });

  it("keeps every split bill internally consistent after absorbing a remainder", async () => {
    const service = createService();
    useDb(
      service,
      createSplitDb({
        members: [hostMember, secondMember, thirdMember],
      }),
    );

    // $100 across three members does not divide evenly, so the creator absorbs
    // the leftover cent. split_bills stores subtotal, service charge and tax
    // as separate columns, so the adjustment has to reach a component too —
    // otherwise the creator receives a bill whose lines do not sum to what
    // they are charged.
    const result = await service.splitBill("group-1", {
      splitType: "equal",
      sharedTaxCents: 10000,
      orderTotalCents: 10000,
    });

    expect(result.success).toBe(true);
    for (const bill of billsOf(result)) {
      expect(
        Math.round((bill.subtotal + bill.serviceCharge + bill.taxAmount) * 100),
      ).toBe(Math.round(bill.totalAmount * 100));
    }
    expect(totalCents(billsOf(result))).toBe(10000);
  });

  it("uses the external order total as the reconciliation baseline", async () => {
    const service = createService();
    const db = createSplitDb({
      members: [hostMember, secondMember],
      items: [
        cartItem("cart-1", "member-1", 1000),
        cartItem("cart-2", "member-2", 2000),
      ],
    });
    useDb(service, db);

    const result = await service.splitBill("group-1", {
      splitType: "proportional",
      sharedServiceChargeCents: 600,
      sharedTaxCents: 301,
      orderTotalCents: 3901,
    });

    expect(result.success).toBe(true);
    expect(totalCents(billsOf(result))).toBe(3901);
    expect(db.updates[0].payload).toMatchObject({ finalAmountCents: 3901 });
  });

  it("rejects reconciliation mismatches beyond one cent per member", async () => {
    const service = createService();
    const logError = vi.fn();
    service["errorTracker"] = Object.assign(service["errorTracker"], {
      logError,
    });
    useDb(
      service,
      createSplitDb({
        members: [hostMember, secondMember],
        items: [
          cartItem("cart-1", "member-1", 1000),
          cartItem("cart-2", "member-2", 2000),
        ],
      }),
    );

    await expect(
      service.splitBill("group-1", {
        splitType: "proportional",
        orderTotalCents: 3900,
      }),
    ).resolves.toMatchObject({
      success: false,
      error: "Split total does not match order total",
      errorDetails: {
        code: "SPLIT_TOTAL_MISMATCH",
        expectedTotalCents: 3900,
        roundedTotalCents: 3000,
      },
    });
    expect(logError).toHaveBeenCalledWith(
      "splitBill",
      expect.any(Error),
      expect.objectContaining({
        code: "SPLIT_TOTAL_MISMATCH",
        expectedTotalCents: 3900,
      }),
    );
  });

  it("uses absolute shared cents instead of rates when both are provided", async () => {
    const service = createService();
    useDb(
      service,
      createSplitDb({
        members: [hostMember, secondMember],
        items: [
          cartItem("cart-1", "member-1", 1000),
          cartItem("cart-2", "member-2", 2000),
        ],
      }),
    );

    await expect(
      service.splitBill("group-1", {
        splitType: "individual",
        serviceChargeRate: 100,
        taxRate: 100,
        sharedServiceChargeCents: 600,
        sharedTaxCents: 300,
        orderTotalCents: 3900,
      }),
    ).resolves.toMatchObject({
      success: true,
      data: [
        { memberId: "member-1", serviceCharge: 2, taxAmount: 1 },
        { memberId: "member-2", serviceCharge: 4, taxAmount: 2 },
      ],
    });
  });

  describe("finalizeGroupOrder", () => {
    function createFinalizeService({
      groupOrder = baseGroupOrder,
      cartItems = [
        {
          ...cartItem("cart-10", "member-1", 1000, 2),
          specialInstructions: "No chili",
          customizations: { spice: "mild" },
        },
      ],
      claimQueue = [[{ id: "group-1" }]],
      order = finalizedOrder,
      existingOrderRows = [],
    }: {
      groupOrder?: unknown;
      cartItems?: unknown[];
      claimQueue?: unknown[][];
      order?: Record<string, unknown>;
      existingOrderRows?: unknown[];
    } = {}) {
      const service = createService();
      const createOrder = vi.fn(
        async (_data: { items: Array<Record<string, unknown>> }) => order,
      );
      service["createOrderService"] = vi.fn(
        () =>
          ({ createOrder }) as unknown as ReturnType<
            GroupOrdersService["createOrderService"]
          >,
      );
      service.splitBill = vi.fn(async () => ({ success: true, data: [] }));
      const db = createDb(
        {
          groupOrders: [[groupOrder]],
          groupCartItems: [cartItems],
          orders: [existingOrderRows],
        },
        { groupOrders: { update: claimQueue } },
      );
      useDb(service, db);
      return { service, createOrder, db };
    }

    it("claims the finalizing mutex, creates a real order, records masterOrderId, and splits with real amounts", async () => {
      const { service, createOrder, db } = createFinalizeService({
        groupOrder: {
          ...baseGroupOrder,
          tableId: 5,
          splitType: "proportional",
          settings: { fulfillmentType: "dine_in", notes: "Table note" },
        },
      });

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "completed" },
      });

      expect(createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          restaurantId: "restaurant-1",
          tableId: 5,
          orderType: "table",
          notes: "Table note",
          clientMutationId: "group-order:group-1",
          items: [
            {
              menuItemId: 10,
              quantity: 2,
              notes: "No chili",
            },
          ],
        }),
      );
      expect(createOrder.mock.calls[0][0].items[0]).not.toHaveProperty(
        "customizations",
      );
      expect(service.splitBill).toHaveBeenCalledWith(
        "group-1",
        {
          splitType: "proportional",
          sharedServiceChargeCents: 600,
          sharedTaxCents: 300,
          orderTotalCents: 3900,
        },
        [expect.objectContaining({ id: "cart-10", quantity: 2 })],
      );
      expect(db.updates.map((update) => update.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: "finalizing" }),
          expect.objectContaining({
            masterOrderId: "order-1",
            status: "finalizing",
          }),
          expect.objectContaining({
            masterOrderId: "order-1",
            status: "completed",
          }),
        ]),
      );
    });

    it("is idempotent across sequential calls and duplicate client mutations", async () => {
      const { service, createOrder, db } = createFinalizeService({
        groupOrder: { ...baseGroupOrder, splitType: "individual" },
      });

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "completed" },
      });

      useDb(
        service,
        createDb({
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "completed",
                masterOrderId: "order-1",
              },
            ],
          ],
        }),
      );

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "completed" },
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(db.updates[0].payload).toEqual(
        expect.objectContaining({ status: "finalizing" }),
      );

      const duplicate = createFinalizeService({
        existingOrderRows: [
          {
            id: "order-1",
            serviceChargeCents: 600,
            taxAmountCents: 300,
            totalAmountCents: 3900,
          },
        ],
      });
      duplicate.createOrder.mockRejectedValueOnce(
        new Error("CLIENT_MUTATION_DUPLICATE"),
      );

      await expect(
        duplicate.service.finalizeGroupOrder("group-1"),
      ).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "completed" },
      });
      expect(duplicate.service.splitBill).toHaveBeenCalledWith(
        "group-1",
        {
          splitType: "individual",
          sharedServiceChargeCents: 600,
          sharedTaxCents: 300,
          orderTotalCents: 3900,
        },
        [expect.objectContaining({ id: "cart-10", quantity: 2 })],
      );
    });

    it("prevents concurrent finalizers from creating a second real order", async () => {
      const service = createService();
      const createOrder = vi.fn(async () => finalizedOrder);
      service["createOrderService"] = vi.fn(
        () =>
          ({ createOrder }) as unknown as ReturnType<
            GroupOrdersService["createOrderService"]
          >,
      );
      service.splitBill = vi.fn(async () => ({ success: true, data: [] }));
      useDb(
        service,
        createDb(
          {
            groupOrders: [
              [baseGroupOrder],
              [baseGroupOrder],
              [{ ...baseGroupOrder, status: "finalizing" }],
            ],
            groupCartItems: [
              [cartItem("cart-1", "member-1", 1000)],
              [cartItem("cart-1", "member-1", 1000)],
            ],
            orders: [[]],
          },
          // The loser's claim matches no row.
          { groupOrders: { update: [[{ id: "group-1" }], []] } },
        ),
      );

      const [first, second] = await Promise.all([
        service.finalizeGroupOrder("group-1"),
        service.finalizeGroupOrder("group-1"),
      ]);

      expect(first).toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "completed" },
      });
      expect(second).toEqual({
        success: false,
        error: "Group order is already being finalized",
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    it("defines finalize boundaries for empty, completed, and cancelled groups", async () => {
      // An empty cart can only be known after the finalizing claim, which is
      // then released without creating an order.
      const empty = createFinalizeService({ cartItems: [] });
      await expect(
        empty.service.finalizeGroupOrder("group-1"),
      ).resolves.toEqual({
        success: false,
        error: "Cannot finalize an empty group order",
      });
      expect(empty.createOrder).not.toHaveBeenCalled();
      expect(empty.db.updates.map((update) => update.payload)).toContainEqual(
        expect.objectContaining({ status: "active", lockedAt: null }),
      );

      const completed = createFinalizeService({
        groupOrder: {
          ...baseGroupOrder,
          status: "completed",
          masterOrderId: "order-1",
        },
        claimQueue: [],
      });
      await expect(
        completed.service.finalizeGroupOrder("group-1"),
      ).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "completed" },
      });
      expect(completed.createOrder).not.toHaveBeenCalled();

      const cancelled = createFinalizeService({
        groupOrder: { ...baseGroupOrder, status: "cancelled" },
        claimQueue: [],
      });
      await expect(
        cancelled.service.finalizeGroupOrder("group-1"),
      ).resolves.toEqual({
        success: false,
        error: "Group order is cancelled, cannot finalize",
      });
      expect(cancelled.createOrder).not.toHaveBeenCalled();
    });

    it.each([
      {
        fulfillmentType: "pickup",
        expectedOrderType: "shop",
        expectedDeliveryType: "takeaway",
      },
      {
        fulfillmentType: "delivery",
        expectedOrderType: "shop",
        expectedDeliveryType: "delivery",
      },
    ])(
      "maps $fulfillmentType fulfillment when creating the real order",
      async ({ fulfillmentType, expectedOrderType, expectedDeliveryType }) => {
        const { service, createOrder } = createFinalizeService({
          groupOrder: {
            ...baseGroupOrder,
            tableId: null,
            settings: {
              fulfillmentType,
              pickupAt: "2026-06-07T12:30:00.000Z",
              deliveryAddress: {
                line1: "1 Main St",
                line2: "Unit 2",
                contactPhone: "+886912345678",
                notes: "Ring bell",
              },
            },
          },
        });

        await service.finalizeGroupOrder("group-1");

        expect(createOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            orderType: expectedOrderType,
            deliveryInfo: expect.objectContaining({
              type: expectedDeliveryType,
              address: "1 Main St, Unit 2",
              phone: "+886912345678",
            }),
          }),
        );
      },
    );

    it("keeps the master order id and marks finalizing_failed when split billing fails after order creation", async () => {
      const { service, db } = createFinalizeService();
      service.splitBill = vi.fn(async () => ({
        success: false,
        error: "Split total does not match order total",
        errorDetails: {
          code: "SPLIT_TOTAL_MISMATCH",
          expectedTotalCents: 3900,
          roundedTotalCents: 3000,
        },
      }));

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: false,
        error: "Split total does not match order total",
      });

      expect(db.updates.map((update) => update.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            masterOrderId: "order-1",
            status: "finalizing_failed",
            settings: expect.objectContaining({
              finalizeFailure: expect.objectContaining({
                masterOrderId: "order-1",
                orderTotalCents: 3900,
                expectedTotalCents: 3900,
                roundedTotalCents: 3000,
                splitError: "Split total does not match order total",
              }),
            }),
          }),
        ]),
      );
    });

    it("refuses to retry a group whose split failed, rather than reporting its recorded master order as completed", async () => {
      const { service, createOrder } = createFinalizeService({
        groupOrder: {
          ...baseGroupOrder,
          status: "finalizing_failed",
          masterOrderId: "order-1",
        },
      });

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: false,
        error: "Group order finalization previously failed",
      });
      expect(createOrder).not.toHaveBeenCalled();
    });

    it("refuses to retry while a master order exists but the claim is still in flight", async () => {
      const { service, createOrder } = createFinalizeService({
        groupOrder: {
          ...baseGroupOrder,
          status: "finalizing",
          masterOrderId: "order-1",
        },
      });

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: false,
        error: "Group order is already being finalized",
      });
      expect(createOrder).not.toHaveBeenCalled();
    });

    /**
     * `createOrder` rejects its own business-rule failures as an `ApiError`
     * carrying the code, status and figures the host needs to fix the cart
     * (#352). Flattening all of that into one generic string left a host
     * reading "Failed to finalize group order" with nothing to act on (#359).
     */
    it("rethrows createOrder's ApiError so the host keeps its code, status and details", async () => {
      const { service, createOrder, db } = createFinalizeService();
      const inventoryError = new ApiError(
        "INSUFFICIENT_INVENTORY",
        "Insufficient inventory for 滷肉飯",
        409,
        { menuItemId: 7, name: "滷肉飯", requested: 3, available: 1 },
      );
      createOrder.mockRejectedValueOnce(inventoryError);
      const { logError, trackError } = silenceServiceErrors(service);

      await expect(service.finalizeGroupOrder("group-1")).rejects.toBe(
        inventoryError,
      );

      // A refused cart never became an order, so the claim is handed back and
      // the host can retry the moment the cart is fixed.
      expect(db.updates.map((update) => update.payload)).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: "active" })]),
      );
      // A cart the restaurant cannot fill is the diner's problem to fix, not
      // an incident to page anyone about.
      expect(trackError).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });

    it("keeps translating the delivery gate, which createOrder still raises as a plain Error", async () => {
      const { service, createOrder } = createFinalizeService();
      createOrder.mockRejectedValueOnce(new Error("DELIVERY_NOT_ENABLED"));
      const { trackError } = silenceServiceErrors(service);

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: false,
        error: "此店家未開放外送",
      });
      expect(trackError).not.toHaveBeenCalled();
    });

    it("still answers an unexpected failure generically, and logs it as one", async () => {
      const { service, createOrder } = createFinalizeService();
      createOrder.mockRejectedValueOnce(new Error("D1_ERROR: network failure"));
      const { logError, trackError } = silenceServiceErrors(service);

      await expect(service.finalizeGroupOrder("group-1")).resolves.toEqual({
        success: false,
        error: "Failed to finalize group order",
      });
      expect(trackError).toHaveBeenCalledWith(
        "finalizeGroupOrder",
        expect.any(Error),
        expect.objectContaining({ groupOrderId: "group-1" }),
      );
      expect(logError).toHaveBeenCalledOnce();
    });
  });

  describe("recoverFinalization", () => {
    const failure = {
      code: "SPLIT_TOTAL_MISMATCH",
      masterOrderId: "order-1",
      orderTotalCents: 3900,
      serviceChargeCents: 600,
      taxAmountCents: 300,
      expectedTotalCents: 3900,
      roundedTotalCents: 3000,
      splitError: "Split total does not match order total",
      failedAt: "2026-06-07T01:00:00.000Z",
    };

    it("uses the current stored split type when recovering a failed finalization", async () => {
      const service = createService();
      service.splitBill = vi.fn(async () => ({ success: true, data: [] }));
      const db = createDb(
        {
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                splitType: "individual",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
        },
        // Two conditional writes: the claim, then the settle. Both report the
        // row they matched, and both have to match for recovery to succeed.
        {
          groupOrders: {
            update: [[{ id: "group-1" }], [{ id: "group-1" }]],
          },
        },
      );
      useDb(service, db);

      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "checkout" },
      });
      expect(db.updates.map((update) => update.payload)).toContainEqual(
        expect.objectContaining({ status: "finalizing" }),
      );
      // Recovery deliberately maps the value currently stored on the group,
      // rather than reconstructing a split type from failure diagnostics.
      expect(service.splitBill).toHaveBeenCalledWith("group-1", {
        splitType: "individual",
        sharedServiceChargeCents: 600,
        sharedTaxCents: 300,
        orderTotalCents: 3900,
      });
      expect(db.updates.map((update) => update.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "checkout",
            settings: {},
          }),
        ]),
      );
    });

    it("charges a selected active member the full recorded order total", async () => {
      const service = createService();
      service.splitBill = vi.fn(async () => ({ success: true, data: [] }));
      const bearerMemberId = "22222222-2222-4222-8222-222222222222";
      const db = createDb(
        {
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
          groupMembers: [[{ ...hostMember, id: bearerMemberId }]],
        },
        { groupOrders: { update: [[{ id: "group-1" }], [{ id: "group-1" }]] } },
      );
      useDb(service, db);

      await expect(
        service.recoverFinalization("group-1", { bearerMemberId }),
      ).resolves.toEqual({
        success: true,
        data: { masterOrderId: "order-1", status: "checkout" },
      });
      expect(service.splitBill).toHaveBeenCalledWith("group-1", {
        splitType: "custom",
        customAmounts: [{ memberId: bearerMemberId, amount: 30 }],
        sharedServiceChargeCents: 600,
        sharedTaxCents: 300,
        orderTotalCents: 3900,
      });
    });

    it.each(["missing", "departed"])(
      "rejects a %s bearer without replacing the finalization diagnostics",
      async (kind) => {
        const service = createService();
        service.splitBill = vi.fn();
        const bearerMemberId = "22222222-2222-4222-8222-222222222222";
        const db = createDb({
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
          groupMembers:
            kind === "departed"
              ? [[{ ...hostMember, id: bearerMemberId, leftAt: new Date() }]]
              : [[]],
        });
        useDb(service, db);

        await expect(
          service.recoverFinalization("group-1", { bearerMemberId }),
        ).resolves.toEqual({
          success: false,
          error: "Bearer member is not an active member of this group order",
        });
        expect(service.splitBill).not.toHaveBeenCalled();
        expect(db.updates).toHaveLength(0);
      },
    );

    it("preserves the original failure timestamp and appends retry diagnostics when recovery fails", async () => {
      const service = createService();
      service.splitBill = vi.fn(async () => ({
        success: false,
        error: "No active members found",
        errorDetails: { code: "NO_ACTIVE_MEMBERS" },
      }));
      const db = createDb(
        {
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
        },
        { groupOrders: { update: [[{ id: "group-1" }]] } },
      );
      useDb(service, db);

      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: false,
        error: "No active members found",
      });

      expect(db.updates.map((update) => update.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "finalizing_failed",
            settings: expect.objectContaining({
              finalizeFailure: expect.objectContaining({
                failedAt: "2026-06-07T01:00:00.000Z",
                recoveryErrorDetails: [
                  expect.objectContaining({
                    code: "NO_ACTIVE_MEMBERS",
                    splitError: "No active members found",
                  }),
                ],
              }),
            }),
          }),
        ]),
      );
    });

    it("reports a missing group order without claiming anything", async () => {
      const service = createService();
      service.splitBill = vi.fn();
      const db = createDb({ groupOrders: [[]] });
      useDb(service, db);

      await expect(service.recoverFinalization("missing")).resolves.toEqual({
        success: false,
        error: "Group order not found",
      });
      expect(service.splitBill).not.toHaveBeenCalled();
      expect(db.updates).toHaveLength(0);
    });

    it("refuses a group that is not awaiting finalization recovery", async () => {
      const service = createService();
      service.splitBill = vi.fn();
      const db = createDb({
        groupOrders: [
          [{ ...baseGroupOrder, status: "active", masterOrderId: null }],
        ],
      });
      useDb(service, db);

      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: false,
        error: "Group order is not awaiting finalization recovery",
      });
      expect(service.splitBill).not.toHaveBeenCalled();
      expect(db.updates).toHaveLength(0);
    });

    it("refuses to guess the amounts when the failure diagnostics are gone", async () => {
      const service = createService();
      service.splitBill = vi.fn();
      const db = createDb({
        groupOrders: [
          [
            {
              ...baseGroupOrder,
              status: "finalizing_failed",
              masterOrderId: "order-1",
              settings: null,
            },
          ],
        ],
      });
      useDb(service, db);

      // The stored amounts are the only record of what the real order charged.
      // Without them a retry would invent a split, so it must not run at all.
      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: false,
        error: "Missing finalization failure diagnostics",
      });
      expect(service.splitBill).not.toHaveBeenCalled();
      expect(db.updates).toHaveLength(0);
    });

    it("still records a retry attempt when the split reports no details", async () => {
      const service = createService();
      service.splitBill = vi.fn(async () => ({ success: false }));
      const db = createDb(
        {
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
        },
        { groupOrders: { update: [[{ id: "group-1" }]] } },
      );
      useDb(service, db);

      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: false,
        error: "Failed to split bill",
      });
      expect(db.updates.map((update) => update.payload)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "finalizing_failed",
            settings: expect.objectContaining({
              finalizeFailure: expect.objectContaining({
                failedAt: failure.failedAt,
                recoveryErrorDetails: [
                  expect.objectContaining({
                    code: "SPLIT_BILL_FAILED",
                    splitError: "Failed to split bill",
                    attemptedAt: expect.any(String),
                  }),
                ],
              }),
            }),
          }),
        ]),
      );
    });

    it("refuses to report success when the expiry sweep reclaimed the attempt", async () => {
      const service = createService();
      service.splitBill = vi.fn(async () => ({ success: true, data: [] }));
      const db = createDb(
        {
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
        },
        // The claim wins, but by the time the settle runs the sweep has decided
        // this attempt was abandoned and moved the row back — so it matches
        // nothing.
        { groupOrders: { update: [[{ id: "group-1" }], []] } },
      );
      useDb(service, db);

      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: false,
        error:
          "Group order finalization recovery was reclaimed before it completed",
        errorCode: "GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED",
      });
    });

    it("allows only one recovery attempt to claim a failed finalization", async () => {
      const service = createService();
      service.splitBill = vi.fn(async () => ({ success: true, data: [] }));
      const db = createDb(
        {
          groupOrders: [
            [
              {
                ...baseGroupOrder,
                status: "finalizing_failed",
                masterOrderId: "order-1",
                settings: { finalizeFailure: failure },
              },
            ],
          ],
        },
        { groupOrders: { update: [[]] } },
      );
      useDb(service, db);

      await expect(service.recoverFinalization("group-1")).resolves.toEqual({
        success: false,
        error: "Group order finalization recovery is already in progress",
        errorCode: "GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS",
      });
      expect(service.splitBill).not.toHaveBeenCalled();
    });
  });

  describe("processPayment — Plan A manual settlement", () => {
    it("marks a member's split bill paid with paymentMethod cash and no real gateway involved", async () => {
      const service = createService();
      const db = createDb({
        groupOrders: [[{ ...baseGroupOrder, status: "checkout" }]],
        groupMembers: [[hostMember]],
        splitBills: [
          [
            {
              id: "split-1",
              groupOrderId: "group-1",
              memberId: "member-1",
              totalAmountCents: 3300,
              paymentStatus: "pending",
            },
          ],
          [{ count: 1 }],
        ],
      });
      useDb(service, db);

      await expect(
        service.processPayment(
          "group-1",
          "member-1",
          { paymentMethod: "cash" },
          "staff",
        ),
      ).resolves.toMatchObject({
        success: true,
        data: { paymentMethod: "cash", amount: 33 },
      });
      expect(db.updates[0].payload).toMatchObject({
        paymentStatus: "paid",
        paymentMethod: "cash",
      });
      expect(db.updates).toHaveLength(1);
    });

    it("leaves the group order status unchanged once every member's split bill is paid", async () => {
      const service = createService();
      const db = createDb({
        groupOrders: [[{ ...baseGroupOrder, status: "completed" }]],
        groupMembers: [[hostMember]],
        splitBills: [
          [
            {
              id: "split-1",
              groupOrderId: "group-1",
              memberId: "member-1",
              totalAmountCents: 3300,
              paymentStatus: "pending",
            },
          ],
          [{ count: 0 }],
        ],
      });
      useDb(service, db);

      await expect(
        service.processPayment(
          "group-1",
          "member-1",
          { paymentMethod: "cash" },
          "staff",
        ),
      ).resolves.toMatchObject({
        success: true,
        data: { groupOrderStatus: "completed" },
      });
      expect(db.updates).toHaveLength(1);
    });
  });

  it("validates payment guards and leaves checkout open while others owe", async () => {
    const guards = [
      { db: createDb({ groupOrders: [[]] }), error: "Group order not found" },
      {
        db: createDb({ groupOrders: [[baseGroupOrder]], groupMembers: [[]] }),
        error: "Member not found in group",
      },
      {
        db: createDb({
          groupOrders: [[baseGroupOrder]],
          groupMembers: [[hostMember]],
          splitBills: [[]],
        }),
        error: "Split bill not found for member. Please split the bill first.",
      },
      {
        db: createDb({
          groupOrders: [[baseGroupOrder]],
          groupMembers: [[hostMember]],
          splitBills: [[{ id: "split-1", paymentStatus: "paid" }]],
        }),
        error: "Payment already processed for this member",
      },
      {
        db: createDb({
          groupOrders: [[baseGroupOrder]],
          groupMembers: [[hostMember]],
          splitBills: [
            [
              {
                id: "split-1",
                totalAmount: 10,
                totalAmountCents: 1000,
                paymentStatus: "pending",
              },
            ],
          ],
        }),
        amount: 9,
        error: "Payment amount (9) does not match split bill amount (10)",
      },
    ];

    for (const guard of guards) {
      const service = createService();
      useDb(service, guard.db);
      await expect(
        service.processPayment(
          "group-1",
          "member-1",
          { paymentMethod: "cash", amount: guard.amount },
          "staff",
        ),
      ).resolves.toEqual({ success: false, error: guard.error });
    }

    const service = createService();
    const db = createDb({
      groupOrders: [[{ ...baseGroupOrder, status: "checkout" }]],
      groupMembers: [[hostMember]],
      splitBills: [
        [
          {
            id: "split-1",
            groupOrderId: "group-1",
            memberId: "member-1",
            totalAmount: 23.1,
            totalAmountCents: 2310,
            paymentStatus: "pending",
          },
        ],
        [{ count: 1 }],
      ],
    });
    useDb(service, db);

    await expect(
      service.processPayment(
        "group-1",
        "member-1",
        { paymentMethod: "card", paymentDetails: { terminalId: "pos-1" } },
        "staff",
      ),
    ).resolves.toMatchObject({
      success: true,
      data: {
        transactionId: "TXN-1780790400000-uuid-1",
        groupOrderStatus: "checkout",
      },
    });
    expect(db.updates).toHaveLength(1);
    const paymentPayload = db.updates[0].payload as {
      paymentReference: string;
    };
    expect(JSON.parse(paymentPayload.paymentReference)).toMatchObject({
      transactionId: "TXN-1780790400000-uuid-1",
      method: "card",
      details: { terminalId: "pos-1" },
    });
  });

  it("handles leave guards, expired cleanup, activities, and statistics aggregation", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupOrders: [[{ ...baseGroupOrder, status: "checkout" }]],
      }),
    );

    await expect(service.leaveGroup("group-1", "member-1")).resolves.toEqual({
      success: false,
      error: "Cannot leave a group order after checkout has started",
    });

    const cleanupService = createService();
    const cleanupDb = createDb({
      groupOrders: [
        [
          { id: "group-1", shareCode: "ABC12345", expiresAt: new Date() },
          { id: "group-2", shareCode: "XYZ12345", expiresAt: new Date() },
        ],
      ],
    });
    useDb(cleanupService, cleanupDb);
    await expect(cleanupService.cleanupExpiredGroups()).resolves.toEqual({
      cleaned: 2,
      errors: [],
    });
    expect(cleanupDb.updates).toHaveLength(2);
    expect(cleanupDb.inserts).toHaveLength(2);

    const activityService = createService();
    useDb(
      activityService,
      createDb({
        groupActivityLogs: [
          [
            {
              id: "activity-1",
              groupOrderId: "group-1",
              memberId: null,
              action: "bill_split",
              description: "Split",
              metadata: { splitType: "equal" },
              createdAt: new Date("2026-06-07T00:00:00.000Z"),
            },
          ],
        ],
      }),
    );
    await expect(
      activityService.getActivities("group-1"),
    ).resolves.toMatchObject([{ id: "activity-1", type: "bill_split" }]);

    const statsService = createService();
    useDb(
      statsService,
      createDb({
        groupOrders: [[{ total: 10 }], [{ active: 4 }], [{ avgValue: 31.678 }]],
        rawSqlSubquery: [[{ avgSize: 2.25 }]],
      }),
    );
    await expect(
      statsService.getStatistics("restaurant-1", "week"),
    ).resolves.toEqual({
      totalGroupOrders: 10,
      activeGroupOrders: 4,
      averageGroupSize: 2.3,
      averageOrderValue: 31.68,
      popularTimeSlots: [],
      conversionRate: 60,
      paymentMethodDistribution: {},
    });
  });

  it("allows members to leave active groups and validates leave edge cases", async () => {
    const missingGroupService = createService();
    useDb(missingGroupService, createDb({ groupOrders: [[]] }));
    await expect(
      missingGroupService.leaveGroup("group-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Group order not found",
    });

    const missingMemberService = createService();
    useDb(
      missingMemberService,
      createDb({
        groupOrders: [[baseGroupOrder]],
        groupMembers: [[]],
      }),
    );
    await expect(
      missingMemberService.leaveGroup("group-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Member not found in group",
    });

    const hostBlockedService = createService();
    useDb(
      hostBlockedService,
      createDb({
        groupOrders: [[baseGroupOrder]],
        groupMembers: [
          [hostMember],
          [hostMember, { ...hostMember, id: "member-2", role: "member" }],
        ],
      }),
    );
    await expect(
      hostBlockedService.leaveGroup("group-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Host cannot leave while other members are still active",
    });

    const service = createService();
    const db = createDb({
      groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
      groupMembers: [
        [{ ...hostMember, id: "member-2", role: "member", name: "Lin" }],
        [hostMember, { ...hostMember, id: "member-2", role: "member" }],
      ],
      restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
      groupCartItems: [[{ total: 0 }], [{ total: 0 }]],
      splitBills: [[]],
    });
    useDb(service, db);
    await expect(service.leaveGroup("group-1", "member-2")).resolves.toEqual({
      success: true,
    });
    expect(db.updates[0].payload).toMatchObject({
      isActive: false,
      leftAt: new Date("2026-06-07T00:00:00.000Z"),
    });
    expect(db.updates[1].payload).toMatchObject({ status: "removed" });
    expect(db.inserts[1].payload).toMatchObject({
      action: "member_left",
      description: "Lin left the group",
    });

    const failingService = createService();
    useDb(failingService, {
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    });
    await expect(
      failingService.leaveGroup("group-1", "member-1"),
    ).resolves.toEqual({
      success: false,
      error: "Failed to leave group",
    });
  });

  it("reports cleanup item errors and top-level cleanup failures", async () => {
    const service = createService();
    const db = createDb({
      groupOrders: [
        [
          { id: "group-1", shareCode: "ABC12345", expiresAt: new Date() },
          { id: "group-2", shareCode: "XYZ12345", expiresAt: new Date() },
        ],
      ],
    });
    const originalUpdate = db.update;
    let updateAttempts = 0;
    db.update = vi.fn((table: unknown) => {
      updateAttempts += 1;
      if (updateAttempts === 1) {
        return {
          set: vi.fn(() => ({
            where: vi.fn(async () => {
              throw new Error("update failed");
            }),
          })),
        };
      }
      return originalUpdate(table);
    }) as typeof db.update;
    useDb(service, db);

    await expect(service.cleanupExpiredGroups()).resolves.toEqual({
      cleaned: 1,
      errors: ["group-1: update failed"],
    });

    const failingService = createService();
    useDb(failingService, {
      select: vi.fn(() => {
        throw new Error("select failed");
      }),
    });
    await expect(failingService.cleanupExpiredGroups()).resolves.toEqual({
      cleaned: 0,
      errors: ["select failed"],
    });
  });

  it("keeps statistics usable when independent aggregate queries reject", async () => {
    const service = createService();
    const rejectQuery = (message: string) => {
      const builder = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        then: (
          resolve: (value: unknown) => void,
          reject?: (reason: unknown) => void,
        ) => Promise.reject(new Error(message)).then(resolve, reject),
      };
      return builder;
    };
    useDb(service, {
      select: vi
        .fn()
        .mockImplementationOnce(() => rejectQuery("counts failed"))
        .mockImplementationOnce(() => rejectQuery("active failed"))
        .mockImplementationOnce(() => rejectQuery("avg size failed"))
        .mockImplementationOnce(() => rejectQuery("avg value failed")),
    });

    await expect(service.getStatistics(undefined, "quarter")).resolves.toEqual({
      totalGroupOrders: 0,
      activeGroupOrders: 0,
      averageGroupSize: 0,
      averageOrderValue: 0,
      popularTimeSlots: [],
      conversionRate: 0,
      paymentMethodDistribution: {},
    });
  });

  it("validates host sessions by creator member token and fails closed on lookup errors", async () => {
    const service = createService();
    useDb(service, createDb({ groupMembers: [[{ id: "member-1" }]] }));

    await expect(
      service["isHostSession"]("group-1", "host-session"),
    ).resolves.toBe(true);

    const memberService = createService();
    useDb(memberService, createDb({ groupMembers: [[]] }));
    await expect(
      memberService.isHostSession("group-1", "member-session"),
    ).resolves.toBe(false);

    const failingService = createService();
    useDb(failingService, {
      select: vi.fn(() => {
        throw new Error("db down");
      }),
    });
    await expect(
      failingService.isHostSession("group-1", "host-session"),
    ).resolves.toBe(false);
  });
});

/**
 * The customer app renders a cart row from `menuItem.name`. `getGroupOrder`
 * supplies it, but `addCartItem` and `updateCartItem` did not — so an item
 * arriving over realtime, or the response to your own add, rendered as a price
 * with no dish beside it until the page was reloaded.
 *
 * Both methods already look the menu item up in order to price the row, so the
 * name is in hand; it was simply left out of the payload. These pin the shape
 * to the one `getGroupOrder` already returns, because two shapes for the same
 * row is how the mismatch started.
 */
describe("cart mutations return a renderable row", () => {
  beforeEach(() => {
    uuidState.next = 1;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.log).mockRestore();
    vi.mocked(console.error).mockRestore();
    vi.useRealTimers();
  });

  const menuItemRow = {
    id: 10,
    restaurantId: "restaurant-1",
    name: "Laksa",
    price: 9,
    priceCents: 1250,
    imageUrl: "https://cdn.test/laksa.jpg",
  };

  const storedCartItem = {
    id: "uuid-1",
    groupOrderId: "group-1",
    memberId: "member-1",
    menuItemId: 10,
    quantity: 2,
    unitPriceCents: 1250,
    totalPriceCents: 2500,
    customizations: { spice: "hot" },
    specialInstructions: "No peanuts",
    addedAt: new Date("2026-06-07T00:00:00.000Z"),
    updatedAt: new Date("2026-06-07T00:00:00.000Z"),
  };

  it("names the dish when an item is added", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
        groupMembers: [[hostMember]],
        menuItems: [[menuItemRow]],
        restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
        groupCartItems: [[{ total: 25 }], [{ total: 25 }], [storedCartItem]],
        splitBills: [[]],
      }),
    );

    const result = await service.addCartItem("group-1", {
      memberId: "member-1",
      menuItemId: 10,
      quantity: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      menuItem: { id: 10, name: "Laksa", price: 12.5 },
    });
  });

  it("names the dish when an item is updated", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupCartItems: [
          [storedCartItem],
          [{ total: 37.5 }],
          [{ total: 37.5 }],
          [{ ...storedCartItem, quantity: 3, totalPriceCents: 3750 }],
        ],
        groupOrders: [[{ restaurantId: "restaurant-1" }]],
        restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
        splitBills: [[]],
        menuItems: [[menuItemRow]],
      }),
    );

    const result = await service.updateCartItem("group-1", "uuid-1", {
      quantity: 3,
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ menuItem: { name: "Laksa" } });
  });

  it("keeps the same menu shape on the fallback path", async () => {
    // When the inserted row cannot be re-queried, addCartItem builds the item
    // by hand. That path copies the menuItem mapping rather than sharing it,
    // so it is one field away from drifting from every other caller.
    const service = createService();
    useDb(
      service,
      createDb({
        groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
        groupMembers: [[hostMember]],
        menuItems: [[menuItemRow]],
        restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
        groupCartItems: [
          [{ total: 25 }],
          [{ total: 25 }],
          [], // re-query of the inserted row returns nothing
        ],
        splitBills: [[]],
      }),
    );

    const result = await service.addCartItem("group-1", {
      memberId: "member-1",
      menuItemId: 10,
      quantity: 2,
    });

    expect(result.success).toBe(true);
    const menuItem = result.data?.menuItem;
    if (!menuItem) {
      throw new Error(
        `expected an added cart item, got ${JSON.stringify(result)}`,
      );
    }
    expect(Object.keys(menuItem).sort()).toEqual(
      ["id", "imageUrl", "name", "price"].sort(),
    );
    expect(menuItem).toMatchObject({ name: "Laksa", price: 12.5 });
  });

  it("uses the same row shape getGroupOrder already returns", async () => {
    const service = createService();
    useDb(
      service,
      createDb({
        groupOrders: [[baseGroupOrder], [{ restaurantId: "restaurant-1" }]],
        groupMembers: [[hostMember]],
        menuItems: [[menuItemRow]],
        restaurants: [[{ settings: { taxRate: 0, serviceChargeRate: 0 } }]],
        groupCartItems: [[{ total: 25 }], [{ total: 25 }], [storedCartItem]],
        splitBills: [[]],
      }),
    );

    const added = await service.addCartItem("group-1", {
      memberId: "member-1",
      menuItemId: 10,
      quantity: 2,
    });

    // getGroupOrder builds { ...formatCartItem(row), menuItem: { id, name,
    // price, imageUrl } }. A second, thinner shape for the same row is what
    // let the missing name through in the first place.
    const addedMenuItem = added.data?.menuItem;
    if (!addedMenuItem) {
      throw new Error(
        `expected an added cart item, got ${JSON.stringify(added)}`,
      );
    }
    expect(Object.keys(addedMenuItem).sort()).toEqual(
      ["id", "imageUrl", "name", "price"].sort(),
    );
  });
});
