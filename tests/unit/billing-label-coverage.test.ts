import { describe, expect, it } from "vitest";
import { METER_KEYS } from "../../packages/database/src/schema/usage-events";
import { MODULES } from "../../packages/database/src/schema/subscriptions";
import {
  meterMessagePath,
  moduleMessagePath,
} from "../../apps/admin-dashboard/src/utils/billingLabels";
import enUS from "../../apps/admin-dashboard/src/i18n/locales/en-US";
import idID from "../../apps/admin-dashboard/src/i18n/locales/id-ID";
import jaJP from "../../apps/admin-dashboard/src/i18n/locales/ja-JP";
import viVN from "../../apps/admin-dashboard/src/i18n/locales/vi-VN";
import zhCN from "../../apps/admin-dashboard/src/i18n/locales/zh-CN";
import zhTW from "../../apps/admin-dashboard/src/i18n/locales/zh-TW";

/**
 * The owner's 訂閱與用量 page printed `api.requests` and `menu_management`
 * instead of names. The meter labels existed, but under dotted keys that
 * vue-i18n splits into path segments, so no lookup could reach them; the module
 * labels did not exist at all. BillingView falls back to the raw key on a miss,
 * and the E2E only checks test ids, so nothing went red.
 *
 * This walks each real catalog the way vue-i18n does — one segment per dot —
 * for every meter and module the server can report.
 */
const catalogs: Record<string, unknown> = {
  "zh-TW": zhTW,
  "zh-CN": zhCN,
  "en-US": enUS,
  "ja-JP": jaJP,
  "id-ID": idID,
  "vi-VN": viVN,
};

function lookup(messages: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      messages,
    );
}

describe("billing label coverage", () => {
  const paths = [
    ...Object.values(METER_KEYS).map(meterMessagePath),
    ...Object.values(MODULES).map(moduleMessagePath),
  ];

  for (const [locale, messages] of Object.entries(catalogs)) {
    it(`names every usage meter and plan module in ${locale}`, () => {
      const missing = paths.filter((path) => {
        const value = lookup(messages, path);
        return typeof value !== "string" || value.trim() === "";
      });

      expect(missing).toEqual([]);
    });
  }
});
