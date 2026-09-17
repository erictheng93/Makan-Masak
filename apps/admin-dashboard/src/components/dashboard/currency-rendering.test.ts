// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  setRestaurantCurrency,
  clearRestaurantCurrency,
} from "@/composables/useCurrency";
import RecentOrders from "./RecentOrders.vue";
import TopMenuItems from "./TopMenuItems.vue";
import ProcurementList from "../forecast/ProcurementList.vue";
import en from "@/i18n/locales/en-US";
import zhTW from "@/i18n/locales/zh-TW";
import zhCN from "@/i18n/locales/zh-CN";
import ja from "@/i18n/locales/ja-JP";
import viVN from "@/i18n/locales/vi-VN";
import id from "@/i18n/locales/id-ID";

vi.mock("@/i18n", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === "charts.topMenuItems.totalValue"
        ? en.charts?.topMenuItems?.totalValue
            ?.replace("{quantity}", String(params?.quantity))
            .replace("{revenue}", String(params?.revenue))
        : key,
  }),
}));
vi.mock("@/composables/useDateFormatter", () => ({
  useDateFormatter: () => ({
    formatTime: () => "12:00",
    formatRelativeTime: () => "now",
  }),
}));
afterEach(clearRestaurantCurrency);

describe("restaurant currency in dashboard and procurement", () => {
  it("reactively formats item costs, subtotals, totals, orders and revenues", async () => {
    const recent = mount(RecentOrders, {
      props: {
        orders: [
          {
            id: "1",
            orderNumber: "A1",
            tableNumber: "A1",
            status: "pending",
            total: 1234.56,
            createdAt: "2026-09-17T00:00:00Z",
          },
        ],
      },
    });
    const top = mount(TopMenuItems, {
      props: {
        items: [
          {
            id: "1",
            name: "Noodles",
            quantity: 2,
            revenue: 1234.56,
          },
        ],
      },
    });
    const procurement = mount(ProcurementList, {
      props: {
        items: [
          { ingredientId: 1, ingredientName: "Rice", unit: "kg", gap: 2 },
        ] as never,
        ingredientDetails: new Map([
          [1, { supplier: "Supplier", costPerUnit: 617.28 }],
        ]),
      },
    });
    for (const [code, expected] of [
      ["TWD", "NT$1,235"],
      ["MYR", "RM 1,234.56"],
      ["VND", "1.235 ₫"],
    ] as const) {
      setRestaurantCurrency(code);
      await nextTick();
      expect(recent.text()).toContain(expected);
      expect(top.text().split(expected)).toHaveLength(3); // row and translated total
      expect(procurement.text().split(expected)).toHaveLength(4); // item, subtotal, total
      expect(top.text()).not.toContain("$" + expected);
    }
    recent.unmount();
    top.unmount();
    procurement.unmount();
  });
  it.each([en, zhTW, zhCN, ja, viVN, id])(
    "keeps currency symbols out of the translated total",
    (messages) => {
      expect(messages.charts?.topMenuItems?.totalValue).toContain("{revenue}");
      expect(messages.charts?.topMenuItems?.totalValue).not.toContain(
        "${revenue}",
      );
    },
  );
});
