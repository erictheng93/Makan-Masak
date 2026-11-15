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
  netProfitCents: number;
}

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
