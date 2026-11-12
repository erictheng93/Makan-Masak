/**
 * Permanently deleting a restaurant (platform administrators only).
 *
 * Deactivating (`DELETE /restaurants/:id`) stays the everyday action: it takes
 * a shop offline and keeps its history. This is the irreversible step after
 * it, for test tenants and for shops that have left and asked to be removed.
 */
import {
  auditLogs,
  countRestaurantData,
  createDatabase,
  deleteRestaurantData,
  eq,
  ephemeralKv,
  images,
  restaurants,
  sql,
  users,
  type RestaurantDeletionCount,
} from "@makanmasak/database";
import { ConsoleLogger } from "../../../core/monitoring";
import type { Env } from "../../../shared/types";
import {
  badRequest,
  conflict,
  notFound,
} from "../../../shared/utils/api-error";

/** Rows in any of these mean the shop has taken or refunded money. */
const FINANCIAL_TABLES = new Set([
  "payment_transactions",
  "refund_transactions",
  "refunds",
  "receipts",
  "payment_audit_log",
]);

// shortcut: scans the cache namespace page by page, fine while it holds a few
// thousand keys; switch to tag-based invalidation if deletes ever time out.
const MAX_CACHE_LIST_PAGES = 20;

export interface RestaurantDeletionPreview {
  restaurant: { id: string; name: string; isActive: boolean; isDemo: boolean };
  tables: RestaurantDeletionCount[];
  totalRows: number;
  hasFinancialRecords: boolean;
  /** Why a delete would be refused right now; empty when it would proceed. */
  blockers: Array<"RESTAURANT_STILL_ACTIVE" | "DEMO_RESTAURANT">;
}

export interface RestaurantDeletionResult {
  restaurant: { id: string; name: string };
  tables: RestaurantDeletionCount[];
  totalRows: number;
  imagesRemoved: number;
  cacheKeysRemoved: number;
}

export class RestaurantDeletionService {
  private readonly db;
  private readonly logger = new ConsoleLogger("RestaurantDeletionService");

  constructor(private readonly env: Env) {
    this.db = createDatabase(env.DB);
  }

  async preview(restaurantId: string): Promise<RestaurantDeletionPreview> {
    const restaurant = await this.db.query.restaurants.findFirst({
      where: eq(restaurants.id, restaurantId),
      columns: { id: true, name: true, isActive: true, isDemo: true },
    });
    if (!restaurant) throw notFound("Restaurant not found");

    const tables = await countRestaurantData(this.db, restaurantId);
    const blockers: RestaurantDeletionPreview["blockers"] = [];
    if (restaurant.isActive) blockers.push("RESTAURANT_STILL_ACTIVE");
    if (restaurant.isDemo) blockers.push("DEMO_RESTAURANT");

    return {
      restaurant,
      tables,
      totalRows: tables.reduce((sum, entry) => sum + entry.rows, 0),
      hasFinancialRecords: tables.some((entry) =>
        FINANCIAL_TABLES.has(entry.table),
      ),
      blockers,
    };
  }

  async delete(
    restaurantId: string,
    input: { confirmName: string; acknowledgeFinancialRecords?: boolean },
    actor: { id: string },
  ): Promise<RestaurantDeletionResult> {
    const preview = await this.preview(restaurantId);
    const { restaurant } = preview;

    // A live shop is never deleted in one step: deactivating first is the
    // pause in which a wrong id gets noticed.
    if (restaurant.isActive) {
      throw conflict(
        "Deactivate the restaurant before deleting it",
        "RESTAURANT_STILL_ACTIVE",
      );
    }
    if (restaurant.isDemo) {
      throw conflict(
        "The demo restaurant cannot be deleted",
        "DEMO_RESTAURANT",
      );
    }
    if (input.confirmName.trim() !== restaurant.name.trim()) {
      throw badRequest(
        "The confirmation does not match the restaurant's name",
        "CONFIRMATION_MISMATCH",
      );
    }
    if (preview.hasFinancialRecords && !input.acknowledgeFinancialRecords) {
      throw conflict(
        "This restaurant has payment or receipt records; deleting them must be acknowledged",
        "FINANCIAL_RECORDS_NOT_ACKNOWLEDGED",
      );
    }

    // Read before the delete: afterwards nothing says which objects and cache
    // entries were this shop's.
    const [imageRows, staff] = await Promise.all([
      this.db
        .select({ id: images.id })
        .from(images)
        .where(eq(images.restaurantId, restaurantId)),
      this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.restaurantId, restaurantId)),
    ]);

    const tables = await deleteRestaurantData(this.db, restaurantId);
    const totalRows = tables.reduce((sum, entry) => sum + entry.rows, 0);

    // The restaurant is gone from here on. What follows is tidying, and a
    // failure in it must not be reported as a failed delete.
    const [imagesRemoved, cacheKeysRemoved] = await Promise.all([
      this.removeImages(imageRows.map((row) => row.id)),
      this.removeCacheKeys([restaurantId, ...staff.map((row) => row.id)]),
      this.removeEphemeralState(restaurantId),
      this.recordDeletion(restaurant, actor, tables, totalRows),
    ]);

    this.logger.info("Restaurant deleted", {
      restaurantId,
      totalRows,
      imagesRemoved,
      cacheKeysRemoved,
    });
    return {
      restaurant: { id: restaurant.id, name: restaurant.name },
      tables,
      totalRows,
      imagesRemoved,
      cacheKeysRemoved,
    };
  }

  /** Image objects are stored as `{imageId}/{variant}`. */
  private async removeImages(imageIds: string[]): Promise<number> {
    const bucket = this.env.IMAGES_BUCKET;
    if (!bucket || imageIds.length === 0) return 0;
    let removed = 0;
    for (const imageId of imageIds) {
      try {
        const listed = await bucket.list({ prefix: `${imageId}/` });
        const keys = listed.objects.map((object) => object.key);
        if (keys.length > 0) await bucket.delete(keys);
        removed += keys.length;
      } catch (error) {
        this.logger.warn("Could not remove a deleted restaurant's image", {
          imageId,
          error: String(error),
        });
      }
    }
    return removed;
  }

  private async removeCacheKeys(ids: string[]): Promise<number> {
    const kv = this.env.CACHE_KV;
    if (!kv) return 0;
    let removed = 0;
    try {
      let cursor: string | undefined;
      for (let page = 0; page < MAX_CACHE_LIST_PAGES; page += 1) {
        const listed = await kv.list({ cursor });
        const mine = listed.keys
          .map((key) => key.name)
          .filter((name) => ids.some((id) => name.includes(id)));
        await Promise.all(mine.map((name) => kv.delete(name)));
        removed += mine.length;
        if (listed.list_complete) break;
        cursor = listed.cursor;
      }
    } catch (error) {
      this.logger.warn("Could not clear a deleted restaurant's cache", {
        error: String(error),
      });
    }
    return removed;
  }

  /** Guest tokens and rate-limit counters; they would expire on their own. */
  private async removeEphemeralState(restaurantId: string): Promise<void> {
    try {
      await this.db
        .delete(ephemeralKv)
        .where(
          sql`instr(${ephemeralKv.key}, ${restaurantId}) > 0 OR instr(${ephemeralKv.value}, ${restaurantId}) > 0`,
        );
    } catch (error) {
      this.logger.warn("Could not clear a deleted restaurant's guest state", {
        error: String(error),
      });
    }
  }

  private async recordDeletion(
    restaurant: { id: string; name: string },
    actor: { id: string },
    tables: RestaurantDeletionCount[],
    totalRows: number,
  ): Promise<void> {
    try {
      // No restaurant_id: the row has to outlive the restaurant it describes.
      await this.db.insert(auditLogs).values({
        userId: actor.id,
        restaurantId: null,
        action: "restaurant_delete",
        resource: "restaurants",
        resourceId: restaurant.id,
        description: `Permanently deleted restaurant "${restaurant.name}" (${totalRows} rows)`,
        changes: { metadata: { name: restaurant.name, totalRows, tables } },
        success: true,
      } as never);
    } catch (error) {
      this.logger.error(
        "Restaurant deleted but the audit entry could not be written",
        error as Error,
        { restaurantId: restaurant.id },
      );
    }
  }
}
