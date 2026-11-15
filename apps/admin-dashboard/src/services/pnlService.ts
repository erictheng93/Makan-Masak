import { api, unwrapApiPayload } from "@/services/api";

/**
 * Owner-facing daily profit & loss statement, mounted server-side at
 * `/api/v1/pnl`. Every amount is integer cents (major × 100, for every
 * currency, TWD included); `currency` says how to format them.
 */

export type ExpenseCategory =
  | "labor"
  | "rent"
  | "utilities"
  | "purchase"
  | "misc";

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  "labor",
  "rent",
  "utilities",
  "purchase",
  "misc",
];

export interface DailyExpense {
  id: string;
  category: ExpenseCategory;
  amountCents: number;
  note: string | null;
  createdAtMs: number;
}

export interface DailyPnl {
  date: string;
  currency: string;
  revenue: {
    grossSalesCents: number;
    discountCents: number;
    refundCents: number;
    /** Gross − discount − refund: the figure the analytics revenue report shows. */
    collectedCents: number;
    /** Collected − tax, i.e. revenue excluding collected tax. */
    netRevenueCents: number;
    taxCents: number;
    serviceChargeCents: number;
    orderCount: number;
  };
  cogs: { totalCents: number; itemsMissingCost: number };
  grossProfitCents: number;
  expenses: {
    totalCents: number;
    byCategory: { category: ExpenseCategory; amountCents: number }[];
    items: DailyExpense[];
  };
  fees: {
    paymentFeeCents: number;
    platformCommissionCents: number;
    configured: boolean;
  };
  labor: { costCents: number; shifts: number; shiftsMissingRate: number };
  netProfitCents: number;
}

/** Basis points (0–10000) per payment method / delivery platform key. */
export interface PnlRates {
  paymentFeeBps: Record<string, number>;
  platformCommissionBps: Record<string, number>;
  /** Allowed keys; a missing key counts as 0. */
  paymentMethods: string[];
  platforms: string[];
  /** Start of the version in force today; "1970-01-01" = the legacy version. */
  effectiveFrom: string | null;
  /** Every version, newest first. */
  history: PnlRatesVersion[];
}

export interface PnlRatesVersion {
  effectiveFrom: string;
  paymentFeeBps: Record<string, number>;
  platformCommissionBps: Record<string, number>;
}

export type PnlRatesInput = Pick<
  PnlRates,
  "paymentFeeBps" | "platformCommissionBps"
> & {
  /** YYYY-MM-DD, not in the future; defaults to today server-side. */
  effectiveFrom?: string;
};

export interface PnlRangeRow {
  date: string;
  orderCount: number;
  netRevenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  feesCents: number;
  laborCents: number;
  expensesCents: number;
  netProfitCents: number;
}

export interface PnlRange {
  from: string;
  to: string;
  currency: string;
  days: PnlRangeRow[];
  totals: Omit<PnlRangeRow, "date">;
}

/** Longest range the server accepts, inclusive of both ends. */
export const PNL_MAX_RANGE_DAYS = 92;

export interface NewExpense {
  /** YYYY-MM-DD, the day the statement is for. */
  date: string;
  category: ExpenseCategory;
  amountCents: number;
  note?: string;
}

function pnlPath(restaurantId: string): string {
  return `/pnl/${encodeURIComponent(restaurantId)}`;
}

export const pnlService = {
  /** GET /api/v1/pnl/:restaurantId/daily?date=YYYY-MM-DD */
  async getDaily(restaurantId: string, date: string): Promise<DailyPnl> {
    const response = await api.get<DailyPnl>(`${pnlPath(restaurantId)}/daily`, {
      date,
    });
    return unwrapApiPayload<DailyPnl>(response.data);
  },

  /** GET /api/v1/pnl/:restaurantId/range?from=&to= (≤ 92 days, else 400 PNL_RANGE_INVALID) */
  async getRange(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<PnlRange> {
    const response = await api.get<PnlRange>(`${pnlPath(restaurantId)}/range`, {
      from,
      to,
    });
    return unwrapApiPayload<PnlRange>(response.data);
  },

  /** GET /api/v1/pnl/:restaurantId/rates */
  async getRates(restaurantId: string): Promise<PnlRates> {
    const response = await api.get<PnlRates>(`${pnlPath(restaurantId)}/rates`);
    return unwrapApiPayload<PnlRates>(response.data);
  },

  /** PUT /api/v1/pnl/:restaurantId/rates — 400 on validation (PNL_RATES_DATE_INVALID, PNL_RATES_TOO_MANY_VERSIONS). */
  async saveRates(
    restaurantId: string,
    rates: PnlRatesInput,
  ): Promise<PnlRates> {
    const response = await api.put<PnlRates>(
      `${pnlPath(restaurantId)}/rates`,
      rates,
    );
    return unwrapApiPayload<PnlRates>(response.data);
  },

  /** POST /api/v1/pnl/:restaurantId/expenses — 201, returns the new entry. */
  async addExpense(
    restaurantId: string,
    expense: NewExpense,
  ): Promise<DailyExpense> {
    const response = await api.post<DailyExpense>(
      `${pnlPath(restaurantId)}/expenses`,
      expense,
    );
    return unwrapApiPayload<DailyExpense>(response.data);
  },

  /** DELETE /api/v1/pnl/:restaurantId/expenses/:expenseId */
  async deleteExpense(restaurantId: string, expenseId: string): Promise<void> {
    await api.delete(
      `${pnlPath(restaurantId)}/expenses/${encodeURIComponent(expenseId)}`,
    );
  },
};
