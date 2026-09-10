import { describe, expect, it, vi } from "vitest";
import { FULFILLED_ORDER_STATUSES } from "@makanmasak/database";
import { ProductAnalysisService } from "./ProductAnalysisService";

function createQuery(result: unknown) {
  const builder = {
    from: vi.fn(() => builder),
    leftJoin: vi.fn(() => builder),
    innerJoin: vi.fn(() => builder),
    where: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    then: (
      resolve: (value: unknown) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function collectSqlColumns(input: unknown): string[] {
  const columns: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const maybeSql = value as {
      columnType?: unknown;
      name?: unknown;
      queryChunks?: unknown[];
    };
    if (
      typeof maybeSql.columnType === "string" &&
      typeof maybeSql.name === "string"
    ) {
      columns.push(maybeSql.name);
      return;
    }
    if (Array.isArray(maybeSql.queryChunks)) {
      maybeSql.queryChunks.forEach(visit);
    }
  };
  visit(input);
  return columns;
}

describe("ProductAnalysisService money reads", () => {
  it("builds product metric queries from authoritative cents columns", async () => {
    const selectedFields: Array<Record<string, unknown>> = [];
    const results = [
      [
        {
          menu_item_id: 1,
          menu_item_name: "Laksa",
          category: "Noodles",
          unit_price: 10,
          unit_cost: 4,
          total_orders: 2,
          total_revenue: 20,
          first_item_count: 0,
          view_count: 0,
          cart_addition_count: 0,
        },
      ],
      [{ date: "2026-06-01", orders: 2, revenue: 20 }],
    ];
    const db = {
      select: vi.fn((fields: Record<string, unknown>) => {
        selectedFields.push(fields);
        return createQuery(results.shift() ?? []);
      }),
    };
    const service = new ProductAnalysisService(db);

    await service.analyzeProducts("restaurant-1", {
      range: "custom",
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });

    expect(collectSqlColumns(selectedFields[0].unit_price)).toContain(
      "price_cents",
    );
    expect(collectSqlColumns(selectedFields[0].unit_price)).not.toContain(
      "price",
    );
    expect(collectSqlColumns(selectedFields[0].unit_cost)).toContain(
      "cost_price_cents",
    );
    expect(collectSqlColumns(selectedFields[0].unit_cost)).not.toContain(
      "cost_price",
    );
    expect(collectSqlColumns(selectedFields[0].total_revenue)).toContain(
      "total_price_cents",
    );
    expect(collectSqlColumns(selectedFields[0].total_revenue)).toContain(
      "payment_status",
    );
    expect(collectSqlColumns(selectedFields[0].total_revenue)).not.toContain(
      "total_price",
    );
    expect(collectSqlColumns(selectedFields[1].revenue)).toContain(
      "total_price_cents",
    );
    expect(collectSqlColumns(selectedFields[1].revenue)).toContain(
      "payment_status",
    );
    expect(collectSqlColumns(selectedFields[1].revenue)).not.toContain(
      "total_price",
    );
    expect(FULFILLED_ORDER_STATUSES).toContain("delivered");
    expect(collectSqlColumns(selectedFields[0].total_orders)).not.toContain(
      "payment_status",
    );
  });
});
