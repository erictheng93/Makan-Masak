import { and, desc, eq } from "drizzle-orm";
import { restaurantAlerts } from "../schema";
import {
  RESTAURANT_ALERT_SEVERITY,
  RESTAURANT_ALERT_STATUS,
  type RestaurantAlert,
  type RestaurantAlertSeverity,
} from "../schema/restaurant-alerts";
import { BaseService } from "./base";

export interface RaiseAlertInput {
  restaurantId: string;
  alertType: string;
  title: string;
  description: string;
  severity?: RestaurantAlertSeverity;
  details?: Record<string, unknown>;
  /**
   * Set this when the producer re-checks a standing condition (a poller, a
   * cron, a retried webhook). While an alert with the same key is open the
   * repeat is collapsed onto it instead of creating a second row.
   */
  dedupeKey?: string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
  );
}

/**
 * Owner-facing operational alerts (issue #285).
 *
 * Every mutation is tenant-scoped: the restaurant id is part of the WHERE
 * clause rather than something the caller is trusted to have checked, so a
 * role-1 owner holding another tenant's alert id gets a miss, not a write.
 */
export class RestaurantAlertService extends BaseService {
  /** Open alerts for one restaurant, newest first. The panel's only read. */
  async listOpen(restaurantId: string): Promise<RestaurantAlert[]> {
    return this.db
      .select()
      .from(restaurantAlerts)
      .where(
        and(
          eq(restaurantAlerts.restaurantId, restaurantId),
          eq(restaurantAlerts.status, RESTAURANT_ALERT_STATUS.OPEN),
        ),
      )
      .orderBy(desc(restaurantAlerts.createdAt))
      .all();
  }

  async getById(
    id: string,
    restaurantId: string,
  ): Promise<RestaurantAlert | null> {
    const row = await this.db
      .select()
      .from(restaurantAlerts)
      .where(
        and(
          eq(restaurantAlerts.id, id),
          eq(restaurantAlerts.restaurantId, restaurantId),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Producer entry point. Modules that detect an actionable condition call this;
   * nothing else in the alert path needs to know they exist.
   */
  async raise(input: RaiseAlertInput): Promise<RestaurantAlert> {
    if (input.dedupeKey) {
      const open = await this.findOpenByDedupeKey(
        input.restaurantId,
        input.dedupeKey,
      );
      if (open) return open;
    }

    const values = {
      restaurantId: input.restaurantId,
      alertType: input.alertType,
      title: input.title,
      description: input.description,
      severity: input.severity ?? RESTAURANT_ALERT_SEVERITY.MEDIUM,
      status: RESTAURANT_ALERT_STATUS.OPEN,
      details: input.details,
      dedupeKey: input.dedupeKey,
    };

    try {
      const [row] = await this.db
        .insert(restaurantAlerts)
        .values(values)
        .returning();
      return row;
    } catch (error) {
      // The partial unique index — not the read above — is what actually keeps
      // duplicates out, so a concurrent producer losing this race is expected.
      if (input.dedupeKey && isUniqueConstraintError(error)) {
        const open = await this.findOpenByDedupeKey(
          input.restaurantId,
          input.dedupeKey,
        );
        if (open) return open;
      }
      throw error;
    }
  }

  async resolve(
    id: string,
    restaurantId: string,
    userId: string,
  ): Promise<RestaurantAlert | null> {
    return this.close(id, restaurantId, {
      status: RESTAURANT_ALERT_STATUS.RESOLVED,
      resolvedAt: new Date(),
      resolvedBy: userId,
    });
  }

  async escalate(
    id: string,
    restaurantId: string,
    userId: string,
  ): Promise<RestaurantAlert | null> {
    return this.close(id, restaurantId, {
      status: RESTAURANT_ALERT_STATUS.ESCALATED,
      escalatedAt: new Date(),
      escalatedBy: userId,
    });
  }

  private async findOpenByDedupeKey(
    restaurantId: string,
    dedupeKey: string,
  ): Promise<RestaurantAlert | null> {
    const row = await this.db
      .select()
      .from(restaurantAlerts)
      .where(
        and(
          eq(restaurantAlerts.restaurantId, restaurantId),
          eq(restaurantAlerts.dedupeKey, dedupeKey),
          eq(restaurantAlerts.status, RESTAURANT_ALERT_STATUS.OPEN),
        ),
      )
      .get();
    return row ?? null;
  }

  /**
   * Only an open alert transitions. Re-resolving a closed one returns null so
   * the route answers 404 instead of silently rewriting who closed it.
   */
  private async close(
    id: string,
    restaurantId: string,
    patch: Partial<RestaurantAlert>,
  ): Promise<RestaurantAlert | null> {
    const [row] = await this.db
      .update(restaurantAlerts)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(restaurantAlerts.id, id),
          eq(restaurantAlerts.restaurantId, restaurantId),
          eq(restaurantAlerts.status, RESTAURANT_ALERT_STATUS.OPEN),
        ),
      )
      .returning();
    return row ?? null;
  }
}
