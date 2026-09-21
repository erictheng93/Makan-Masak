import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { normalizeE164Phone, type CurrencyCode } from "@makanmasak/utils";
import {
  AUDIT_ACTIONS,
  auditLogs,
  customers,
  restaurantCustomers,
  restaurants,
} from "../schema";
import { BaseService } from "./base";
import type { AuditActor } from "./TenantMemberDirectoryService";
import { maskEmail, maskPhone } from "./pii-masking";
import { displayRestaurantCurrencySql } from "../utils/market-currency";

/**
 * Platform-side (role 0) customer directory — spec §7.2, stage A4.
 *
 * The mirror image of `TenantMemberDirectoryService`, and the difference is
 * the whole point of both. A tenant may only ever address a customer through
 * `restaurant_customers.id`, because handing a shop owner a platform
 * `customers.id` is what turns #293's shape of bug from theoretical into
 * exploitable. This service is keyed on `customers.id` instead, and that is
 * safe only because every route mounting it is `requireRole([0])` behind the
 * `/admin/*` prefix. Do not reuse it from a tenant-scoped route.
 */

export interface PlatformCustomerListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: "active" | "deleted";
  sort?: "recent" | "orders" | "restaurants" | "name";
}

export interface PlatformCustomerListItem {
  customerId: string;
  displayName: string | null;
  maskedPhone: string | null;
  maskedEmail: string | null;
  locale: string | null;
  status: "active" | "deleted";
  /** Distinct shops this customer has a membership row at. */
  restaurantCount: number;
  /** Summed across every shop, so it is not any one tenant's figure. */
  orderCount: number;
  /** Never add entries in this array: they are distinct currencies. */
  totalSpentByCurrency: MoneyByCurrency;
  lastOrderAt: Date | null;
  createdAt: Date | null;
}

export interface PlatformCustomerListResult {
  customers: PlatformCustomerListItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

/**
 * One shop's slice of a customer's history, for the platform detail drawer
 * (spec §12.3, the cross-shop spending card).
 *
 * Spend facts only. `restaurant_customers` also carries `tags`, `note` and
 * `blockedReason` — a shop's private notes about a person — and those are
 * deliberately absent: §12.3 asks for cross-shop spend, nothing in platform
 * support needs one tenant's free-text opinion of a customer, and copying it
 * here would put it in front of everyone with role 0 for no stated purpose.
 */
export interface PlatformCustomerRestaurantSlice {
  restaurantId: string;
  restaurantName: string | null;
  orderCount: number;
  cancelledOrderCount: number;
  totalSpentCents: number;
  currency: CurrencyCode;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

export type MoneyByCurrency = Array<{
  currency: CurrencyCode;
  amountCents: number;
}>;

// D1 caps a query at 100 bound parameters. The currency expression binds 4
// each time it appears, and it appears three times in the spend query (select,
// groupBy, orderBy), so a full page of 100 ids does not fit in one query.
const CUSTOMER_IDS_PER_SPEND_QUERY = 80;

const CURRENCY_SORT_ORDER: Record<CurrencyCode, number> = {
  TWD: 0,
  MYR: 1,
  VND: 2,
};

type CustomerRollup = {
  customerId: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  locale: string | null;
  customerStatus: string;
  createdAt: Date | null;
  restaurantCount: number;
  orderCount: number;
  lastOrderAt: number | null;
};

export interface PlatformCustomerContact {
  customerId: string;
  phone: string | null;
  email: string | null;
}

/**
 * Same three outcomes, same reasons, as the tenant reveal: a missing customer
 * is `not-found`, and a soft-deleted one is `deleted` (spec §9.4) — deletion
 * means the PII stops being disclosable, and role 0 is not an exception.
 */
export type PlatformContactRevealOutcome =
  | { outcome: "revealed"; contact: PlatformCustomerContact }
  | { outcome: "not-found" }
  | { outcome: "deleted" };

/** See `TenantMemberDirectoryService`; same reasoning, same looseness. */
const LOOKS_LIKE_PHONE = /^\+?[\d\s\-().]{6,}$/;

export class PlatformCustomerDirectoryService extends BaseService {
  /**
   * Cross-shop rollup per customer, as a grouped LEFT JOIN.
   *
   * Not correlated subqueries, which is what this was first written as and
   * which silently returned zeros: on a single-table select drizzle renders a
   * column with no table prefix, so `where ${restaurantCustomers.customerId} =
   * ${customers.id}` came out as `where "customer_id" = "id"` and both names
   * resolved to the subquery's own table. The statement was valid, the
   * response was 200, and every number was 0. A join puts two tables in scope,
   * which makes drizzle qualify every reference -- and is the cheaper plan
   * anyway.
   *
   * Summed from `restaurant_customers` rather than from `orders`, so the
   * platform view can never disagree with the tenant views it aggregates: if a
   * projection is stale, both are stale the same way, and
   * `POST /members/recompute` repairs both at once.
   */
  private aggregates() {
    return {
      // Counts the joined column, not rows: a customer with no membership row
      // still produces one LEFT JOIN row, and count(*) would call that 1.
      restaurantCount: sql<number>`count(${restaurantCustomers.restaurantId})`,
      orderCount: sql<number>`coalesce(sum(${restaurantCustomers.orderCount}), 0)`,
      lastOrderAt: sql<number | null>`max(${restaurantCustomers.lastOrderAt})`,
    };
  }

  /**
   * The FROM every rollup read shares. Callers add their own `where` and then
   * `groupBy(customers.id)` -- drizzle's builder fixes that order, so the
   * grouping cannot live in here.
   */
  private rollupQuery() {
    return this.db
      .select(this.projection())
      .from(customers)
      .leftJoin(
        restaurantCustomers,
        eq(restaurantCustomers.customerId, customers.id),
      );
  }

  private projection() {
    return {
      customerId: customers.id,
      displayName: customers.displayName,
      phone: customers.primaryPhone,
      email: customers.primaryEmail,
      locale: customers.locale,
      customerStatus: customers.status,
      createdAt: customers.createdAt,
      ...this.aggregates(),
    };
  }

  /**
   * Explicit allow-list, same discipline as the tenant projection: a column
   * added to `customers` has to be named here before it can reach a response,
   * so a future sensitive column cannot arrive by spread.
   */
  private toPublicCustomer(
    row: CustomerRollup | undefined,
    totalSpentByCurrency: MoneyByCurrency,
  ): PlatformCustomerListItem | null {
    if (!row) return null;
    const deleted = row.customerStatus === "deleted";
    return {
      customerId: row.customerId,
      displayName: deleted ? null : row.displayName,
      maskedPhone: deleted ? null : maskPhone(row.phone),
      maskedEmail: deleted ? null : maskEmail(row.email),
      locale: row.locale,
      status: deleted ? "deleted" : "active",
      restaurantCount: row.restaurantCount,
      orderCount: row.orderCount,
      totalSpentByCurrency,
      lastOrderAt: row.lastOrderAt == null ? null : new Date(row.lastOrderAt),
      createdAt: row.createdAt,
    };
  }

  async resolve(customerId: string) {
    const [row] = await this.rollupQuery()
      .where(eq(customers.id, customerId))
      .groupBy(customers.id)
      .limit(1);
    return row ?? null;
  }

  async get(customerId: string) {
    const row = await this.resolve(customerId);
    if (!row) return null;
    const amounts = await this.totalSpentByCustomerIds([customerId]);
    return this.toPublicCustomer(row, amounts.get(customerId) ?? []);
  }

  async list(
    filters: PlatformCustomerListFilters,
  ): Promise<PlatformCustomerListResult> {
    const conditions = [];
    if (filters.status) conditions.push(eq(customers.status, filters.status));
    if (filters.search?.trim()) {
      const search = filters.search.trim();
      // Full-value equality for phone and email, substring only for the
      // display name — identical to the tenant list, and for the identical
      // reason: a prefix match on a phone number turns this into an
      // enumeration tool, and role 0 is not a reason to hand out one.
      const terms = [like(customers.displayName, `%${search}%`)];
      if (LOOKS_LIKE_PHONE.test(search)) {
        terms.push(eq(customers.primaryPhone, normalizeE164Phone(search)));
      }
      if (search.includes("@")) {
        terms.push(eq(customers.primaryEmail, search.toLowerCase()));
      }
      conditions.push(or(...terms)!);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const aggregates = this.aggregates();
    const orderBy =
      filters.sort === "orders"
        ? desc(aggregates.orderCount)
        : filters.sort === "restaurants"
          ? desc(aggregates.restaurantCount)
          : filters.sort === "name"
            ? customers.displayName
            : desc(customers.createdAt);

    const [rows, totalRows] = await Promise.all([
      this.rollupQuery()
        .where(where)
        .groupBy(customers.id)
        .orderBy(orderBy)
        .limit(filters.limit)
        .offset((filters.page - 1) * filters.limit),
      // No join here: the total counts customers matching the filter, and
      // joining memberships in would count one row per shop instead.
      this.db.select({ total: count() }).from(customers).where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;
    const amounts = await this.totalSpentByCustomerIds(
      rows.map((row) => row.customerId),
    );
    return {
      customers: rows.map(
        (row) => this.toPublicCustomer(row, amounts.get(row.customerId) ?? [])!,
      ),
      total,
      page: filters.page,
      limit: filters.limit,
      pages: Math.max(1, Math.ceil(total / filters.limit)),
    };
  }

  /**
   * Every shop this customer has spent at (spec §7.2, §12.3). Returns null —
   * not an empty list — for a customer that does not exist, so the route can
   * 404 instead of implying an empty history.
   */
  async listRestaurants(
    customerId: string,
  ): Promise<PlatformCustomerRestaurantSlice[] | null> {
    if (!(await this.resolve(customerId))) return null;
    return this.db
      .select({
        restaurantId: restaurantCustomers.restaurantId,
        restaurantName: restaurants.name,
        orderCount: restaurantCustomers.orderCount,
        cancelledOrderCount: restaurantCustomers.cancelledOrderCount,
        totalSpentCents: restaurantCustomers.totalSpentCents,
        currency: displayRestaurantCurrencySql(restaurants.settings),
        firstOrderAt: restaurantCustomers.firstOrderAt,
        lastOrderAt: restaurantCustomers.lastOrderAt,
      })
      .from(restaurantCustomers)
      .leftJoin(
        restaurants,
        eq(restaurants.id, restaurantCustomers.restaurantId),
      )
      .where(eq(restaurantCustomers.customerId, customerId))
      .orderBy(desc(restaurantCustomers.totalSpentCents));
  }

  /**
   * The sole cross-shop money aggregate in this service. Query it separately
   * from the customer rollup so pagination remains per customer, not per
   * (customer, currency) group.
   */
  private async totalSpentByCustomerIds(
    customerIds: readonly string[],
  ): Promise<Map<string, MoneyByCurrency>> {
    if (customerIds.length === 0) return new Map();

    const currency = displayRestaurantCurrencySql(restaurants.settings);
    const rows: Array<{
      customerId: string;
      currency: CurrencyCode;
      amountCents: number;
    }> = [];
    // A customer id lands in exactly one slice, so no (customer, currency)
    // group is ever split across two queries.
    for (
      let start = 0;
      start < customerIds.length;
      start += CUSTOMER_IDS_PER_SPEND_QUERY
    ) {
      rows.push(
        ...(await this.db
          .select({
            customerId: restaurantCustomers.customerId,
            currency,
            amountCents: sql<number>`coalesce(sum(${restaurantCustomers.totalSpentCents}), 0)`,
          })
          .from(restaurantCustomers)
          .innerJoin(
            restaurants,
            eq(restaurants.id, restaurantCustomers.restaurantId),
          )
          .where(
            inArray(
              restaurantCustomers.customerId,
              customerIds.slice(start, start + CUSTOMER_IDS_PER_SPEND_QUERY),
            ),
          )
          .groupBy(restaurantCustomers.customerId, currency)
          .orderBy(restaurantCustomers.customerId, currency)),
      );
    }

    const amounts = rows.reduce<Map<string, MoneyByCurrency>>(
      (byCustomer, row) => {
        const customerAmounts = byCustomer.get(row.customerId) ?? [];
        customerAmounts.push({
          currency: row.currency,
          amountCents: Number(row.amountCents) || 0,
        });
        byCustomer.set(row.customerId, customerAmounts);
        return byCustomer;
      },
      new Map(),
    );
    for (const customerAmounts of amounts.values()) {
      customerAmounts.sort(
        (left, right) =>
          CURRENCY_SORT_ORDER[left.currency] -
          CURRENCY_SORT_ORDER[right.currency],
      );
    }
    return amounts;
  }

  /**
   * Unmasked contact for one customer. The audit row is written here and the
   * values are returned only if that write succeeded — the same rule as the
   * tenant reveal, and it matters more here rather than less: this is the one
   * place in the product where a single actor can read any customer's details.
   */
  async revealContact(
    customerId: string,
    actor: AuditActor,
    reason?: string,
  ): Promise<PlatformContactRevealOutcome> {
    const row = await this.resolve(customerId);
    if (!row) return { outcome: "not-found" };

    const deleted = row.customerStatus === "deleted";
    await this.writeRevealAudit(customerId, actor, !deleted, reason);
    if (deleted) return { outcome: "deleted" };

    return {
      outcome: "revealed",
      contact: { customerId, phone: row.phone, email: row.email },
    };
  }

  /**
   * Records that a platform-level disclosure happened, never what was
   * disclosed. `restaurantId` is null because no tenant performed this — a
   * tenant id here would file a platform action inside a shop's audit trail.
   */
  private async writeRevealAudit(
    customerId: string,
    actor: AuditActor,
    success: boolean,
    reason?: string,
  ) {
    await this.db.insert(auditLogs).values({
      userId: actor.userId,
      restaurantId: null,
      action: AUDIT_ACTIONS.CUSTOMER_PII_REVEAL,
      resource: "customers",
      resourceId: customerId,
      description: success
        ? `Revealed contact details for customer ${customerId} (platform)`
        : `Refused contact reveal for deleted customer ${customerId} (platform)`,
      changes: {
        metadata: reason
          ? { fields: ["phone", "email"], scope: "platform", reason }
          : { fields: ["phone", "email"], scope: "platform" },
      },
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      success,
      errorMessage: success ? null : "CUSTOMER_DELETED",
    });
  }
}
