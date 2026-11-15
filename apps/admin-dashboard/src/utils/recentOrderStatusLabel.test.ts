import { describe, expect, it } from "vitest";
import zhTW from "@/i18n/locales/zh-TW";
import { recentOrderStatusLabel } from "./recentOrderStatusLabel";

const panel = (
  zhTW as unknown as {
    dashboard: { recentOrdersPanel: { status: Record<string, string> } };
  }
).dashboard.recentOrdersPanel.status;
const t = (key: string) =>
  key.startsWith("dashboard.recentOrdersPanel.status.")
    ? (panel[key.split(".").pop() as string] ?? key)
    : key;

describe("recentOrderStatusLabel", () => {
  it.each([
    "pending",
    "confirmed",
    "preparing",
    "ready",
    "delivered",
    "paid",
    "cancelled",
    "refunded",
  ])("has a translation for %s", (status) => {
    const label = recentOrderStatusLabel(status, t);
    expect(label).toBe(panel[status]);
    expect(label).not.toContain("dashboard.");
  });

  it("degrades an unknown status to the unknown label, not a raw key", () => {
    expect(recentOrderStatusLabel("teleported", t)).toBe(panel.unknown);
  });
});
