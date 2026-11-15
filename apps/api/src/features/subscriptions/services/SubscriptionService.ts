import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { D1Database } from "@makanmasak/database";
import {
  shopSubscriptions,
  PLAN_DEFAULT_MODULES,
  TRIAL_DURATION_DAYS,
  type ModuleKey,
  type ModuleMap,
  type PlanTier,
} from "@makanmasak/database";
import { notFound, conflict } from "../../../shared/utils/api-error";

export interface CreateSubscriptionInput {
  restaurantId: string;
  planTier: PlanTier;
  trialEndsAt?: Date;
  billingCycleStartAt?: Date;
  billingCycleEndAt?: Date;
  notes?: string;
}

export interface ProvisionDefaultSubscriptionInput {
  restaurantId: string;
  trialDays?: number;
}

export interface UpdateModulesInput {
  /** `null` removes an override so the plan default takes effect. */
  overrides: Partial<Record<ModuleKey, boolean | null>>;
}

export class SubscriptionService {
  private db: ReturnType<typeof drizzle>;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getByRestaurantId(
    restaurantId: string,
  ): Promise<typeof shopSubscriptions.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(shopSubscriptions)
      .where(eq(shopSubscriptions.restaurantId, restaurantId))
      .limit(1);

    return row ?? null;
  }

  async listAll() {
    return this.db
      .select()
      .from(shopSubscriptions)
      .orderBy(shopSubscriptions.createdAt);
  }

  async create(input: CreateSubscriptionInput) {
    const existing = await this.getByRestaurantId(input.restaurantId);
    if (existing) {
      throw conflict(
        "Subscription already exists for this restaurant",
        "SUBSCRIPTION_EXISTS",
      );
    }

    const [created] = await this.db
      .insert(shopSubscriptions)
      .values({
        restaurantId: input.restaurantId,
        planTier: input.planTier,
        moduleOverrides: {},
        isActive: true,
        trialEndsAt: input.trialEndsAt,
        billingCycleStartAt: input.billingCycleStartAt,
        billingCycleEndAt: input.billingCycleEndAt,
        notes: input.notes,
      })
      .returning();

    return created;
  }

  async provisionDefaultForRestaurant(
    input: ProvisionDefaultSubscriptionInput,
  ) {
    const existing = await this.getByRestaurantId(input.restaurantId);
    if (existing) return existing;

    // Shared with management-api's onboarding path so a shop gets the same
    // trial regardless of which door it came through.
    const trialDays = input.trialDays ?? TRIAL_DURATION_DAYS;
    return this.create({
      restaurantId: input.restaurantId,
      planTier: "trial",
      trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
      notes: "auto-provisioned during restaurant onboarding",
    });
  }

  /**
   * Merge the provided overrides into the existing moduleOverrides map.
   * Set a key to `true` to grant, `false` to revoke, or `null` to reset to plan default.
   */
  async updateModules(restaurantId: string, input: UpdateModulesInput) {
    const sub = await this.getByRestaurantId(restaurantId);
    if (!sub)
      throw notFound("Subscription not found", "SUBSCRIPTION_NOT_FOUND");

    const merged: ModuleMap = { ...(sub.moduleOverrides ?? {}) };
    for (const [key, value] of Object.entries(input.overrides) as [
      ModuleKey,
      boolean | null | undefined,
    ][]) {
      if (value === null) {
        delete merged[key];
      } else if (typeof value === "boolean") {
        merged[key] = value;
      }
    }

    const [updated] = await this.db
      .update(shopSubscriptions)
      .set({ moduleOverrides: merged })
      .where(eq(shopSubscriptions.restaurantId, restaurantId))
      .returning();

    return updated;
  }

  /**
   * Admin tier switch: immediate, resets module overrides to the new plan
   * defaults, and drops any owner-scheduled downgrade — otherwise the stale
   * downgrade would apply at cycle end on top of the admin's choice.
   */
  async changePlan(restaurantId: string, planTier: PlanTier) {
    const sub = await this.getByRestaurantId(restaurantId);
    if (!sub)
      throw notFound("Subscription not found", "SUBSCRIPTION_NOT_FOUND");

    const [updated] = await this.db
      .update(shopSubscriptions)
      .set({
        planTier,
        moduleOverrides: {},
        pendingPlanTier: null,
        pendingEffectiveAt: null,
        pendingRequestedBy: null,
        pendingRequestedAt: null,
      })
      .where(eq(shopSubscriptions.restaurantId, restaurantId))
      .returning();

    return updated;
  }

  /** Kill switch — immediately locks or unlocks the entire shop */
  async setActive(restaurantId: string, isActive: boolean) {
    const sub = await this.getByRestaurantId(restaurantId);
    if (!sub)
      throw notFound("Subscription not found", "SUBSCRIPTION_NOT_FOUND");

    const [updated] = await this.db
      .update(shopSubscriptions)
      .set({ isActive })
      .where(eq(shopSubscriptions.restaurantId, restaurantId))
      .returning();

    return updated;
  }

  /** Compute the effective module list (plan defaults merged with overrides) */
  getEffectiveModules(
    sub: typeof shopSubscriptions.$inferSelect,
  ): Record<ModuleKey, boolean> {
    const planDefaults = PLAN_DEFAULT_MODULES[sub.planTier as PlanTier] ?? {};
    const overrides = (sub.moduleOverrides ?? {}) as ModuleMap;

    const allKeys = new Set([
      ...Object.keys(planDefaults),
      ...Object.keys(overrides),
    ]) as Set<ModuleKey>;

    const result = {} as Record<ModuleKey, boolean>;
    for (const key of allKeys) {
      result[key] = overrides[key] ?? planDefaults[key] ?? false;
    }
    return result;
  }
}
