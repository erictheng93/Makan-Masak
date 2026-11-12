/**
 * Permanently removing a restaurant and everything that belongs to it.
 *
 * The set of tables is derived from the schema's foreign keys rather than
 * listed by hand: a hand-kept list is correct on the day it is written and
 * silently short one table after the next migration. `restaurant-deletion.test.ts`
 * pins the derived plan, so a new table shows up there as a diff to review.
 *
 * Safety comes from the database, not from this file being complete. All
 * statements run in one D1 batch (one transaction) with foreign keys enforced,
 * so a row this plan does not know about that still points at the restaurant
 * aborts the whole batch and nothing is deleted. Production was built from the
 * legacy migration track and its foreign keys are not guaranteed to match the
 * Drizzle schema; where they are stricter the delete refuses, it never
 * half-completes.
 */
import {
  and,
  count,
  eq,
  getTableColumns,
  inArray,
  is,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import {
  getTableConfig,
  SQLiteTable,
  type SQLiteColumn,
} from "drizzle-orm/sqlite-core";
import * as schema from "../schema";

type Db = DrizzleD1Database<typeof schema>;

const ROOT = "restaurants";
const TENANT_COLUMN = "restaurant_id";

interface Reference {
  column: SQLiteColumn;
  parent: string;
  parentColumn: SQLiteColumn;
  cascades: boolean;
}

interface PlannedTable {
  name: string;
  table: SQLiteTable;
  /** Set when the table carries its own `restaurant_id`. */
  tenantColumn?: SQLiteColumn;
  /** How rows are found when the table has no `restaurant_id` of its own. */
  via: Reference[];
}

interface PlannedNullify {
  name: string;
  table: SQLiteTable;
  columnKey: string;
  reference: Reference;
  tenantColumn?: SQLiteColumn;
}

export interface RestaurantDeletionPlan {
  /** Children first, `restaurants` last. */
  deletes: PlannedTable[];
  /** Optional references from rows that survive, cleared before the deletes. */
  nullifies: PlannedNullify[];
  /** Tables left in a foreign-key cycle; empty unless the schema grows one. */
  cyclic: string[];
}

function allTables(): Map<string, SQLiteTable> {
  const tables = new Map<string, SQLiteTable>();
  for (const value of Object.values(schema)) {
    if (is(value, SQLiteTable)) tables.set(getTableConfig(value).name, value);
  }
  return tables;
}

function referencesOf(table: SQLiteTable, self: string): Reference[] {
  const references: Reference[] = [];
  for (const foreignKey of getTableConfig(table).foreignKeys) {
    const reference = foreignKey.reference();
    const parent = getTableConfig(reference.foreignTable).name;
    if (parent === self) continue;
    if (reference.columns.length !== 1) {
      // No such key exists today. Guessing at how to match one would be worse
      // than stopping, so a composite key has to be handled here on purpose.
      throw new Error(
        `restaurant deletion: composite foreign key on ${self} is not supported`,
      );
    }
    references.push({
      column: reference.columns[0],
      parent,
      parentColumn: reference.foreignColumns[0],
      cascades: foreignKey.onDelete === "cascade",
    });
  }
  return references;
}

let cachedPlan: RestaurantDeletionPlan | undefined;

export function getRestaurantDeletionPlan(): RestaurantDeletionPlan {
  if (cachedPlan) return cachedPlan;

  const tables = allTables();
  const references = new Map<string, Reference[]>();
  const planned = new Map<string, PlannedTable>();

  for (const [name, table] of tables) {
    references.set(name, referencesOf(table, name));
    const tenantColumn =
      name === ROOT
        ? undefined
        : getTableConfig(table).columns.find(
            (column) => column.name === TENANT_COLUMN,
          );
    if (name === ROOT || tenantColumn) {
      planned.set(name, { name, table, tenantColumn, via: [] });
    }
  }

  // A row that must point at something being deleted cannot outlive it, so the
  // table joins the plan. An optional pointer is cleared instead (below): the
  // row belongs to someone else and only mentions this restaurant.
  const owns = (reference: Reference) =>
    planned.has(reference.parent) &&
    (reference.column.notNull || reference.cascades);

  for (let grew = true; grew; ) {
    grew = false;
    for (const [name, table] of tables) {
      if (planned.has(name)) continue;
      if ((references.get(name) ?? []).some(owns)) {
        planned.set(name, { name, table, via: [] });
        grew = true;
      }
    }
  }
  for (const entry of planned.values()) {
    if (entry.name === ROOT || entry.tenantColumn) continue;
    entry.via = (references.get(entry.name) ?? []).filter(owns);
  }

  const nullifies: PlannedNullify[] = [];
  for (const [name, table] of tables) {
    if (name === ROOT) continue;
    const entry = planned.get(name);
    const columns = Object.entries(getTableColumns(table));
    for (const reference of references.get(name) ?? []) {
      if (!planned.has(reference.parent)) continue;
      if (reference.column.notNull || reference.cascades) continue;
      if (reference.column.name === TENANT_COLUMN) continue;
      const columnKey = columns.find(
        ([, column]) => column === reference.column,
      )?.[0];
      if (!columnKey) continue;
      nullifies.push({
        name,
        table,
        columnKey,
        reference,
        tenantColumn: entry?.tenantColumn,
      });
    }
  }

  // Children before parents: ON DELETE RESTRICT fires immediately and cannot
  // be deferred, and the lookups for tables without a `restaurant_id` read
  // their parents, which therefore have to still be there.
  const pending = new Map<string, Set<string>>();
  for (const name of planned.keys()) {
    pending.set(
      name,
      new Set(
        [...planned.keys()].filter(
          (child) =>
            child !== name &&
            (references.get(child) ?? []).some((ref) => ref.parent === name),
        ),
      ),
    );
  }
  const order: string[] = [];
  for (let progressed = true; progressed && pending.size > 0; ) {
    progressed = false;
    for (const name of [...pending.keys()].sort()) {
      if (name === ROOT && pending.size > 1) continue;
      if ((pending.get(name)?.size ?? 0) > 0) continue;
      order.push(name);
      pending.delete(name);
      for (const children of pending.values()) children.delete(name);
      progressed = true;
    }
  }
  const cyclic = [...pending.keys()].filter((name) => name !== ROOT).sort();
  order.push(...cyclic);
  if (pending.has(ROOT)) order.push(ROOT);

  cachedPlan = {
    deletes: order.map((name) => planned.get(name) as PlannedTable),
    nullifies,
    cyclic,
  };
  return cachedPlan;
}

function selectorFor(
  db: Db,
  plan: RestaurantDeletionPlan,
  name: string,
  restaurantId: string,
  seen: readonly string[] = [],
): SQL {
  if (seen.includes(name)) {
    throw new Error(
      `restaurant deletion: ${[...seen, name].join(" -> ")} is a cycle`,
    );
  }
  if (name === ROOT) return eq(schema.restaurants.id, restaurantId);
  const entry = plan.deletes.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`restaurant deletion: ${name} is not planned`);
  if (entry.tenantColumn) return eq(entry.tenantColumn, restaurantId);

  const paths = entry.via.map((reference) =>
    inArray(
      reference.column,
      parentRows(db, plan, reference, restaurantId, [...seen, name]),
    ),
  );
  return paths.length === 1 ? paths[0] : (or(...paths) as SQL);
}

function parentRows(
  db: Db,
  plan: RestaurantDeletionPlan,
  reference: Reference,
  restaurantId: string,
  seen: readonly string[],
) {
  const parent = plan.deletes.find(
    (candidate) => candidate.name === reference.parent,
  ) as PlannedTable;
  return db
    .select({ value: reference.parentColumn })
    .from(parent.table)
    .where(selectorFor(db, plan, reference.parent, restaurantId, seen));
}

export interface RestaurantDeletionCount {
  table: string;
  rows: number;
}

/** How many rows a delete would remove, per table. Reads only. */
export async function countRestaurantData(
  db: Db,
  restaurantId: string,
): Promise<RestaurantDeletionCount[]> {
  const plan = getRestaurantDeletionPlan();
  const queries = plan.deletes.map((entry) =>
    db
      .select({ rows: count() })
      .from(entry.table)
      .where(selectorFor(db, plan, entry.name, restaurantId)),
  );
  const results = (await db.batch(queries as never)) as unknown as Array<
    Array<{ rows: number }>
  >;
  return plan.deletes
    .map((entry, index) => ({
      table: entry.name,
      rows: Number(results[index]?.[0]?.rows ?? 0),
    }))
    .filter((entry) => entry.rows > 0);
}

/**
 * Delete the restaurant and every row that belongs to it, atomically. Callers
 * decide whether the delete is allowed; this function only carries it out.
 *
 * Returns nothing on purpose. D1's `meta.changes` is not a row count for the
 * statement it comes back with: on production it reported 38 rows deleted from
 * a table that has only ever held one, and it includes rows touched by
 * triggers. Use `countRestaurantData` beforehand for numbers to show anyone.
 */
export async function deleteRestaurantData(
  db: Db,
  restaurantId: string,
): Promise<void> {
  const plan = getRestaurantDeletionPlan();

  const nullifies = plan.nullifies.map((entry) => {
    const pointsAtDeleted = inArray(
      entry.reference.column,
      parentRows(db, plan, entry.reference, restaurantId, []),
    );
    return db
      .update(entry.table)
      .set({ [entry.columnKey]: null } as never)
      .where(
        entry.tenantColumn
          ? and(
              pointsAtDeleted,
              or(
                isNull(entry.tenantColumn),
                ne(entry.tenantColumn, restaurantId),
              ),
            )
          : pointsAtDeleted,
      );
  });
  const deletes = plan.deletes.map((entry) =>
    db
      .delete(entry.table)
      .where(selectorFor(db, plan, entry.name, restaurantId)),
  );

  await db.batch([
    // Lets a foreign-key cycle be emptied in either order; the check still
    // runs at commit, so it never lets an orphan through.
    db.run(sql`PRAGMA defer_foreign_keys = ON`),
    ...nullifies,
    ...deletes,
  ] as never);
}
