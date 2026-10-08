# 商圈攤位「今日開店」與開店紀錄報表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 商圈裡的攤位每個營業日預設未開店，店主一鍵開店後才會在商圈 QR 頁面以「營業中」出現並可下單；平台與店主可查開店紀錄報表（每日明細、期間彙總、當日營收、CSV）。

**Architecture:** 開店狀態存在會籍列（`restaurant_market_memberships.opened_at_ms`），「今日」由攤位時區＋商圈換日時間算出，不需要 cron。每次開收都寫一筆 `market_vendor_open_events`，報表由事件與商圈子訂單在 JS 裡彙整（純函式，單元測試）。伺服器端在商圈結帳時擋下未開店攤位。

**Tech Stack:** Cloudflare Workers + Hono、D1 + Drizzle、Vue 3 + Tailwind（admin-dashboard、customer-app）、vitest（unit + real-D1 integration）。

**Spec:** `docs/superpowers/specs/2026-09-28-market-vendor-daily-open-design.md`

## Global Constraints

- Migration 手寫在 `packages/database/migrations_fresh/0034_market_vendor_daily_open.sql`；**不要**跑 `pnpm db:generate`。
- 新表必須 `) STRICT`；主鍵 TEXT UUID v7；時間欄位 INTEGER Unix ms（Drizzle `{ mode: "timestamp_ms" }`）。
- 新 migration 必須登記在 `packages/database/migration-dual-track.json` 的 `freshOnly`，並通過 `pnpm check:migration-dual-track` 與 `pnpm check:strict-tables`。
- 查詢只用 Drizzle Layer 1／Layer 2，不寫 raw SQL 字串。
- API 錯誤一律丟 `ApiError`（`apps/api/src/shared/utils/api-error.ts`），不在 route 裡 try/catch 格式化。
- 錯誤碼：`VENDOR_NOT_OPEN_TODAY`（409，`details.restaurantIds: string[]`）、`MARKET_MEMBERSHIP_NOT_FOUND`（404）、`RESTAURANT_INACTIVE`（400）、`MARKET_NOT_FOUND`（404）。
- 換日時間：`markets.business_day_cutoff_minutes`，0–1439，預設 300（05:00）。
- 報表區間上限 92 天；日期格式 `YYYY-MM-DD`。
- 營收只算商圈子訂單（`market_checkout_child_orders`）且 `orders.payment_status = 'completed'`；金額存整數 cents，CSV 輸出 `revenue_cents` 整數＋幣別。
- 開店／收攤只開放角色 0（平台）與 1（店主，且必須是本店）。
- UI 遵守 `DESIGN.md` 與 `docs/UIUX-design-system.md`：卡片 `rounded-2xl bg-white shadow-ios-card`、按鈕 `rounded-full`、只用 `ios-*` token；`pnpm check:design-palette` 必須通過。
- 測試不斷言 CSS class；用 `data-testid`、`data-status`、文字。mock 呼叫要用 `toHaveBeenCalledWith(expect.objectContaining(...))` 驗證。
- 每個任務完成後跑 `pnpm verify`；全部完成後跑一次 `pnpm verify:push`。

## Review Focus

1. **部署後舊快取沒有 `businessDayCutoffMinutes`**：`getMarketBySlug` 的 KV 快取（5 分鐘）裡的 market 物件是舊形狀，讀到 `undefined` 會讓營業日算成 `NaN`。所有讀 cutoff 的地方都要 `?? DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES`。測試在 Task 4。
2. **昨天開店、今天沒收攤、今天按「收攤」**：狀態已經是未開店，不應寫事件，也不應報錯；今天按「開店」則應覆寫昨天的 `opened_at_ms` 並寫一筆 open。測試在 Task 3。
3. **夜市跨午夜**：23:00 開店、隔天 01:00 仍屬同一營業日，攤位不能消失，01:00 的訂單要算在前一天的營收。測試在 Task 1 與 Task 5。
4. **一個攤位同時在兩個商圈**：在 A 商圈開店不影響 B 商圈的狀態，也不讓 B 商圈的結帳通過。測試在 Task 4。
5. **既有商圈結帳測試會因新的開店檢查全部變紅**：所有建立商圈結帳的測試 fixture 都要把會籍設為已開店，否則 gate 會擋下它們。處理在 Task 4 Step 6。

---

### Task 1: 營業日規則（純函式）

**Files:**
- Create: `packages/database/src/utils/market-business-day.ts`
- Create: `packages/database/src/utils/market-business-day.test.ts`
- Modify: `packages/database/src/index.ts`（在第 18 行 `export * from "./utils/business-timezone";` 後加 export）

**Interfaces:**
- Consumes: `getBusinessDate(offsetMinutes, date)`（`packages/database/src/utils/business-day.ts`）、`SUPPORTED_BUSINESS_TIMEZONES`、`businessTimezoneOffsetMinutes`（`business-timezone.ts`）
- Produces（從 `@makanmasak/database` 匯出）：
  - `DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES: 300`
  - `getMarketBusinessDate(offsetMinutes: number, cutoffMinutes: number, at?: Date): string`
  - `isMarketVendorOpenToday(openedAt: Date | null | undefined, offsetMinutes: number, cutoffMinutes: number, now?: Date): boolean`
  - `marketBusinessDayStartMs(businessDate: string, offsetMinutes: number, cutoffMinutes: number): number`
  - `marketBusinessDayEndMs(businessDate: string, offsetMinutes: number, cutoffMinutes: number): number`
  - `marketBusinessDateCacheKey(cutoffMinutes: number, now?: Date): string`

- [ ] **Step 1: Write the failing test**

```ts
// packages/database/src/utils/market-business-day.test.ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES,
  getMarketBusinessDate,
  isMarketVendorOpenToday,
  marketBusinessDateCacheKey,
  marketBusinessDayEndMs,
  marketBusinessDayStartMs,
} from "./market-business-day";

const TAIPEI = 8 * 60;
const HO_CHI_MINH = 7 * 60;
const CUTOFF = DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES; // 05:00

// Local wall-clock time at a fixed offset, as a Date.
function local(isoLocal: string, offsetMinutes: number) {
  return new Date(Date.parse(`${isoLocal}Z`) - offsetMinutes * 60_000);
}

describe("getMarketBusinessDate", () => {
  it("keeps the small hours on the previous business day until the cutoff", () => {
    expect(
      getMarketBusinessDate(TAIPEI, CUTOFF, local("2026-09-29T04:59", TAIPEI)),
    ).toBe("2026-09-28");
    expect(
      getMarketBusinessDate(TAIPEI, CUTOFF, local("2026-09-29T05:00", TAIPEI)),
    ).toBe("2026-09-29");
  });

  it("rolls over at midnight when the cutoff is 0", () => {
    expect(
      getMarketBusinessDate(TAIPEI, 0, local("2026-09-28T23:59", TAIPEI)),
    ).toBe("2026-09-28");
    expect(
      getMarketBusinessDate(TAIPEI, 0, local("2026-09-29T00:00", TAIPEI)),
    ).toBe("2026-09-29");
  });

  it("uses the stall's own offset", () => {
    // 21:30 UTC is 04:30 in Ho Chi Minh (+7) but 05:30 in Taipei (+8).
    const at = new Date("2026-09-28T21:30:00Z");
    expect(getMarketBusinessDate(HO_CHI_MINH, CUTOFF, at)).toBe("2026-09-28");
    expect(getMarketBusinessDate(TAIPEI, CUTOFF, at)).toBe("2026-09-29");
  });
});

describe("isMarketVendorOpenToday", () => {
  it("is closed when the stall never opened", () => {
    expect(isMarketVendorOpenToday(null, TAIPEI, CUTOFF)).toBe(false);
    expect(isMarketVendorOpenToday(undefined, TAIPEI, CUTOFF)).toBe(false);
  });

  it("stays open across midnight for a night market", () => {
    const openedAt = local("2026-09-28T23:00", TAIPEI);
    expect(
      isMarketVendorOpenToday(
        openedAt,
        TAIPEI,
        CUTOFF,
        local("2026-09-29T01:00", TAIPEI),
      ),
    ).toBe(true);
  });

  it("closes by itself at the cutoff", () => {
    const openedAt = local("2026-09-28T17:00", TAIPEI);
    expect(
      isMarketVendorOpenToday(
        openedAt,
        TAIPEI,
        CUTOFF,
        local("2026-09-29T05:00", TAIPEI),
      ),
    ).toBe(false);
  });
});

describe("business day bounds", () => {
  it("starts at the cutoff and lasts 24 hours", () => {
    const start = marketBusinessDayStartMs("2026-09-28", TAIPEI, CUTOFF);
    expect(new Date(start).toISOString()).toBe("2026-09-27T21:00:00.000Z");
    expect(marketBusinessDayEndMs("2026-09-28", TAIPEI, CUTOFF)).toBe(
      start + 86_400_000,
    );
  });
});

describe("marketBusinessDateCacheKey", () => {
  it("changes when any supported zone crosses the cutoff", () => {
    // 20:59Z → 21:59Z crosses 05:00 in +8 (Taipei) but not in +7.
    expect(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T20:59:00Z")),
    ).not.toBe(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T21:59:00Z")),
    );
  });

  it("is stable within the same business day everywhere", () => {
    expect(
      marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T09:00:00Z")),
    ).toBe(marketBusinessDateCacheKey(CUTOFF, new Date("2026-09-28T10:00:00Z")));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @makanmasak/database exec vitest run src/utils/market-business-day.test.ts`
Expected: FAIL，`Failed to resolve import "./market-business-day"`

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/database/src/utils/market-business-day.ts
import { getBusinessDate } from "./business-day";
import {
  SUPPORTED_BUSINESS_TIMEZONES,
  businessTimezoneOffsetMinutes,
} from "./business-timezone";

/**
 * Markets roll their business day over at a local wall-clock time rather than
 * at midnight, because a night-market stall trading until 01:00 is still on
 * the evening it opened. 05:00 unless the market says otherwise.
 */
export const DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES = 300;

const DAY_MS = 86_400_000;

export function getMarketBusinessDate(
  offsetMinutes: number,
  cutoffMinutes: number,
  at: Date = new Date(),
): string {
  return getBusinessDate(offsetMinutes - cutoffMinutes, at);
}

/** "Open today" = opened during the business day `now` falls in. */
export function isMarketVendorOpenToday(
  openedAt: Date | null | undefined,
  offsetMinutes: number,
  cutoffMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!openedAt) return false;
  return (
    getMarketBusinessDate(offsetMinutes, cutoffMinutes, openedAt) ===
    getMarketBusinessDate(offsetMinutes, cutoffMinutes, now)
  );
}

export function marketBusinessDayStartMs(
  businessDate: string,
  offsetMinutes: number,
  cutoffMinutes: number,
): number {
  return (
    Date.parse(`${businessDate}T00:00:00Z`) +
    (cutoffMinutes - offsetMinutes) * 60_000
  );
}

export function marketBusinessDayEndMs(
  businessDate: string,
  offsetMinutes: number,
  cutoffMinutes: number,
): number {
  return (
    marketBusinessDayStartMs(businessDate, offsetMinutes, cutoffMinutes) +
    DAY_MS
  );
}

/**
 * A cache-key fragment that changes whenever any supported zone crosses the
 * market's cutoff. A vendor list cached at 04:59 therefore cannot be served at
 * 05:00 with yesterday's "open" flags still on it.
 */
export function marketBusinessDateCacheKey(
  cutoffMinutes: number,
  now: Date = new Date(),
): string {
  return SUPPORTED_BUSINESS_TIMEZONES.map((zone) =>
    getMarketBusinessDate(
      businessTimezoneOffsetMinutes(zone),
      cutoffMinutes,
      now,
    ),
  ).join(",");
}
```

在 `packages/database/src/index.ts` 第 18 行後加：

```ts
export * from "./utils/market-business-day";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @makanmasak/database exec vitest run src/utils/market-business-day.test.ts`
Expected: PASS（9 tests）

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/utils/market-business-day.ts packages/database/src/utils/market-business-day.test.ts packages/database/src/index.ts
git commit -m "feat(database): add market business-day helpers"
```

---

### Task 2: Migration 0034 與 Drizzle schema

**Files:**
- Create: `packages/database/migrations_fresh/0034_market_vendor_daily_open.sql`
- Modify: `packages/database/src/schema/markets.ts`（`markets` 表、`restaurantMarketMemberships` 表、新增 `marketVendorOpenEvents`）
- Modify: `packages/database/migration-dual-track.json`（`freshOnly` 陣列最後，0033 那筆之後）

**Interfaces:**
- Produces（從 `@makanmasak/database` 匯出）：
  - `markets.businessDayCutoffMinutes: number`（notNull，default 300）
  - `restaurantMarketMemberships.openedAt: Date | null`
  - `marketVendorOpenEvents` 表：`id`、`marketId`、`restaurantId`、`action: "open" | "close"`、`businessDate: string`、`occurredAt: Date`、`actorUserId: string | null`

- [ ] **Step 1: Write the migration**

```sql
-- 商圈攤位「今日開店」（spec: docs/superpowers/specs/2026-09-28-market-vendor-daily-open-design.md）
--
-- opened_at_ms：最後一次按「開店」的時間；收攤設回 NULL。「今日已開店」由它
-- 與攤位時區＋商圈換日時間算出，所以不需要每日重置的排程。
-- business_day_cutoff_minutes：商圈的營業日從當地幾點起算，預設 05:00，
-- 讓營業到凌晨的夜市攤位不會在午夜消失。
--
-- 兩個 ALTER TABLE ... ADD COLUMN 都不改變表的 STRICT 屬性，不必重建。
ALTER TABLE `restaurant_market_memberships` ADD COLUMN `opened_at_ms` INTEGER;
ALTER TABLE `markets` ADD COLUMN `business_day_cutoff_minutes` INTEGER DEFAULT 300 NOT NULL
  CHECK (`business_day_cutoff_minutes` BETWEEN 0 AND 1439);

-- 每次開店／收攤一筆，報表由它計算。business_date 在事件發生時算好存下，
-- 事後修改換日時間不會改寫歷史。
CREATE TABLE `market_vendor_open_events` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `market_id` TEXT NOT NULL REFERENCES `markets`(`id`) ON DELETE CASCADE,
  `restaurant_id` TEXT NOT NULL REFERENCES `restaurants`(`id`) ON DELETE CASCADE,
  `action` TEXT NOT NULL CHECK (`action` IN ('open', 'close')),
  `business_date` TEXT NOT NULL,
  `occurred_at_ms` INTEGER NOT NULL,
  `actor_user_id` TEXT
) STRICT;
CREATE INDEX `market_vendor_open_events_market_date_idx`
  ON `market_vendor_open_events` (`market_id`, `business_date`);
CREATE INDEX `market_vendor_open_events_restaurant_date_idx`
  ON `market_vendor_open_events` (`restaurant_id`, `business_date`);
```

- [ ] **Step 2: Update the Drizzle schema**

在 `markets` 的欄位物件最後（`deletedAt` 之後）加：

```ts
    // Last, to match the physical column order: 0034 appends it with ALTER
    // TABLE ADD COLUMN. Minutes after local midnight at which this market's
    // business day rolls over (see market-business-day.ts).
    businessDayCutoffMinutes: integer("business_day_cutoff_minutes")
      .notNull()
      .default(300),
```

在 `restaurantMarketMemberships` 的欄位物件最後（`leftAt` 之後）加：

```ts
    // Appended by 0034. When the owner last pressed "open today"; NULL once
    // they close. Read through isMarketVendorOpenToday, never compared raw.
    openedAt: integer("opened_at_ms", { mode: "timestamp_ms" }),
```

在 `marketCheckoutSessions` 定義之前加新表：

```ts
export const marketVendorOpenEvents = sqliteTable(
  "market_vendor_open_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    marketId: text("market_id")
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    action: text("action").$type<"open" | "close">().notNull(),
    businessDate: text("business_date").notNull(),
    occurredAt: integer("occurred_at_ms", { mode: "timestamp_ms" }).notNull(),
    actorUserId: text("actor_user_id"),
  },
  (table) => ({
    marketDateIdx: index("market_vendor_open_events_market_date_idx").on(
      table.marketId,
      table.businessDate,
    ),
    restaurantDateIdx: index(
      "market_vendor_open_events_restaurant_date_idx",
    ).on(table.restaurantId, table.businessDate),
  }),
);
```

`packages/database/src/schema/index.ts` 第 27 行已經 `export * from "./markets"`，不必再改。

- [ ] **Step 3: Register the migration**

在 `packages/database/migration-dual-track.json` 的 `freshOnly` 陣列，0033 那筆之後加：

```json
    {
      "fresh": "0034_market_vendor_daily_open.sql",
      "reason": "markets, restaurant_market_memberships and the new open-event log are platform-API tables; the management-api database has no markets to pair against."
    }
```

- [ ] **Step 4: Apply locally and run the guards**

Run:
```bash
pnpm db:migrate:local
pnpm check:migration-dual-track
pnpm check:strict-tables
pnpm --filter @makanmasak/database typecheck
```
Expected：migration 套用成功；三個檢查全部通過。

- [ ] **Step 5: Run the database package tests**

Run: `pnpm exec turbo run test --filter=@makanmasak/database`
Expected: PASS。若有 schema 與 migration 一致性的測試失敗，照它的訊息修 schema（通常是欄位順序或預設值），不要改測試。

- [ ] **Step 6: Commit**

```bash
git add packages/database/migrations_fresh/0034_market_vendor_daily_open.sql packages/database/src/schema/markets.ts packages/database/migration-dual-track.json
git commit -m "feat(database): add market vendor daily-open columns and event log"
```

---

### Task 3: 開店／收攤 API 與會籍狀態

**Files:**
- Modify: `apps/api/src/features/markets/services/MarketsService.ts`（新增 `setVendorOpenToday`；修改 `listRestaurantMemberships`，約第 1678 行）
- Modify: `apps/api/src/features/markets/schemas/validation.ts`（新增 `restaurantMarketParamSchema`）
- Modify: `apps/api/src/features/restaurants/routes/index.ts`（在 `GET /:id/markets`，約第 513 行之後加兩個 POST）
- Create: `apps/api/src/__tests__/integration/market-vendor-open.real.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `getMarketBusinessDate`、`isMarketVendorOpenToday`、`DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES`；`businessTimezoneOffsetMinutes`；Task 2 的欄位與 `marketVendorOpenEvents`
- Produces:
  - `MarketsService.setVendorOpenToday(input: { marketId: string; restaurantId: string; open: boolean; actorUserId: string | null; now?: Date }): Promise<{ status: "not_member" } | { status: "restaurant_inactive" } | { status: "ok"; state: MarketVendorOpenState }>`
  - `type MarketVendorOpenState = { isOpenToday: boolean; openedAt: Date | null; businessDate: string }`（從 MarketsService.ts export）
  - `listRestaurantMemberships` 每筆多了 `isOpenToday: boolean`、`openedAt: Date | null`、`businessDate: string`，`market` 多了 `businessDayCutoffMinutes: number`
  - `POST /api/v1/restaurants/:id/markets/:marketId/open` 與 `/close` → `{ success: true, data: MarketVendorOpenState }`
  - `restaurantMarketParamSchema`：`{ id: string; marketId: string }`

- [ ] **Step 1: Write the failing integration test**

```ts
// apps/api/src/__tests__/integration/market-vendor-open.real.integration.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  marketVendorOpenEvents,
  markets,
  restaurantMarketMemberships,
} from "@makanmasak/database";
import {
  createRealIntegrationTestApp,
  type RealIntegrationTestApp,
} from "./helpers/real-test-app";
import { buildSeedHelpers } from "./helpers/seed-helper";
import { readData, readEnvelope } from "../helpers/read-json";

const CSRF_HEADERS = {
  host: "test",
  origin: "https://test",
  cookie: `csrf_token=${"a".repeat(64)}`,
  "x-csrf-token": "a".repeat(64),
};

type OpenState = {
  isOpenToday: boolean;
  openedAt: string | null;
  businessDate: string;
};

async function seedMarket(testApp: RealIntegrationTestApp) {
  const now = new Date();
  const [market] = await testApp.testDb.drizzle
    .insert(markets)
    .values({
      id: `market-${crypto.randomUUID()}`,
      slug: `open-market-${crypto.randomUUID()}`,
      name: "開店測試夜市",
      type: "night_market",
      description: "Daily open fixture",
      city: "台中市",
      district: "西屯區",
      address: "台中市西屯區文華路",
      latitude: 24.1764,
      longitude: 120.6466,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return market;
}

describe("market vendor daily open — real integration", () => {
  let testApp: RealIntegrationTestApp;
  let seed: ReturnType<typeof buildSeedHelpers>;

  beforeAll(async () => {
    testApp = await createRealIntegrationTestApp();
    seed = buildSeedHelpers(testApp.testDb);
  }, 300000);

  afterAll(async () => {
    if (testApp) await testApp.dispose();
  });

  beforeEach(async () => {
    await testApp.testDb.truncateAll();
  });

  async function setup() {
    const market = await seedMarket(testApp);
    const vendor = await seed.restaurant({ name: "雞排攤" });
    const owner = await seed.user({
      role: 1,
      restaurantId: String(vendor.id),
    });
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: market.id,
      stallNumber: "A01",
      joinedAt: new Date(),
    });
    const token = await testApp.authHelper.ownerToken(
      owner.id,
      String(vendor.id),
    );
    return { market, vendor, owner, token };
  }

  function post(path: string, token: string) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        method: "POST",
        headers: { ...CSRF_HEADERS, authorization: `Bearer ${token}` },
      }),
    );
  }

  function get(path: string, token: string) {
    return testApp.app.fetch(
      new Request(`https://test/api/v1${path}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
  }

  it("starts closed, opens with one call, and records one event", async () => {
    const { market, vendor, token } = await setup();

    const before = await readData<{
      memberships: Array<{ marketId: string; isOpenToday: boolean }>;
    }>(await get(`/restaurants/${vendor.id}/markets`, token));
    expect(before.memberships[0]).toMatchObject({
      marketId: market.id,
      isOpenToday: false,
    });

    const openRes = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    expect(openRes.status).toBe(200);
    expect(await readData<OpenState>(openRes)).toMatchObject({
      isOpenToday: true,
      openedAt: expect.any(String),
      businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });

    // Pressing open again is a no-op, not a second event.
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);
    const events = await testApp.testDb.drizzle
      .select()
      .from(marketVendorOpenEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "open",
      marketId: market.id,
      restaurantId: String(vendor.id),
    });
  });

  it("closes and records the close", async () => {
    const { market, vendor, token } = await setup();
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);

    const closeRes = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/close`,
      token,
    );
    expect(await readData<OpenState>(closeRes)).toMatchObject({
      isOpenToday: false,
      openedAt: null,
    });
    const [membership] = await testApp.testDb.drizzle
      .select()
      .from(restaurantMarketMemberships)
      .where(eq(restaurantMarketMemberships.marketId, market.id));
    expect(membership.openedAt).toBeNull();
    const actions = (
      await testApp.testDb.drizzle.select().from(marketVendorOpenEvents)
    ).map((event) => event.action);
    expect(actions.sort()).toEqual(["close", "open"]);
  });

  it("treats yesterday's unclosed open as closed today", async () => {
    const { market, vendor, token } = await setup();
    await testApp.testDb.drizzle
      .update(restaurantMarketMemberships)
      .set({ openedAt: new Date(Date.now() - 30 * 60 * 60 * 1000) })
      .where(eq(restaurantMarketMemberships.marketId, market.id));

    // Close on an already-closed day: no error, no event.
    const closeRes = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/close`,
      token,
    );
    expect(closeRes.status).toBe(200);
    expect(await readData<OpenState>(closeRes)).toMatchObject({
      isOpenToday: false,
    });
    expect(
      await testApp.testDb.drizzle.select().from(marketVendorOpenEvents),
    ).toHaveLength(0);

    // Open today overwrites yesterday's timestamp.
    const openRes = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      token,
    );
    expect(await readData<OpenState>(openRes)).toMatchObject({
      isOpenToday: true,
    });
  });

  it("rejects another shop's owner and a market the shop is not in", async () => {
    const { market, vendor } = await setup();
    const otherShop = await seed.restaurant({ name: "別家" });
    const otherOwner = await seed.user({
      role: 1,
      restaurantId: String(otherShop.id),
    });
    const otherToken = await testApp.authHelper.ownerToken(
      otherOwner.id,
      String(otherShop.id),
    );

    const forbiddenRes = await post(
      `/restaurants/${vendor.id}/markets/${market.id}/open`,
      otherToken,
    );
    expect(forbiddenRes.status).toBe(403);

    const notMemberRes = await post(
      `/restaurants/${otherShop.id}/markets/${market.id}/open`,
      otherToken,
    );
    expect(notMemberRes.status).toBe(404);
    expect((await readEnvelope(notMemberRes)).error).toMatchObject({
      code: "MARKET_MEMBERSHIP_NOT_FOUND",
    });
  });
});
```

> 如果 `seed.user` 的回傳沒有 `id`，或 `readEnvelope` 的泛型簽章不同，照 `market-checkouts.real.integration.test.ts` 第 1030–1046 行的寫法調整；`CSRF_HEADERS` 以該檔第 66–72 行為準。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/market-vendor-open.real.integration.test.ts`
Expected: FAIL，`isOpenToday` 不存在，而且 POST 回 404（路由不存在）。

- [ ] **Step 3: Add the param schema**

在 `apps/api/src/features/markets/schemas/validation.ts` 的 `marketVendorParamSchema` 之後加：

```ts
export const restaurantMarketParamSchema = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(120),
    marketId: z.string().min(1).max(120),
  }),
);
```

- [ ] **Step 4: Implement the service**

在 `MarketsService.ts` 的 import 補上 `marketVendorOpenEvents`、`getMarketBusinessDate`、`isMarketVendorOpenToday`、`businessTimezoneOffsetMinutes`、`DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES`（全部來自 `@makanmasak/database`，加進既有的 import 區塊）。

在 `getActiveVendorMembership` 之後加：

```ts
  async setVendorOpenToday(input: {
    marketId: string;
    restaurantId: string;
    open: boolean;
    actorUserId: string | null;
    now?: Date;
  }): Promise<
    | { status: "not_member" }
    | { status: "restaurant_inactive" }
    | { status: "ok"; state: MarketVendorOpenState }
  > {
    const now = input.now ?? new Date();
    const [row] = await this.db
      .select({
        membershipId: restaurantMarketMemberships.id,
        openedAt: restaurantMarketMemberships.openedAt,
        timezone: restaurants.timezone,
        isActive: restaurants.isActive,
        cutoffMinutes: markets.businessDayCutoffMinutes,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .innerJoin(markets, eq(restaurantMarketMemberships.marketId, markets.id))
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, input.marketId),
          eq(restaurantMarketMemberships.restaurantId, input.restaurantId),
          isNull(restaurantMarketMemberships.leftAt),
          isNull(markets.deletedAt),
        ),
      )
      .limit(1);

    if (!row) return { status: "not_member" };
    if (input.open && !row.isActive) return { status: "restaurant_inactive" };

    const offset = businessTimezoneOffsetMinutes(row.timezone);
    const businessDate = getMarketBusinessDate(offset, row.cutoffMinutes, now);
    const openNow = isMarketVendorOpenToday(
      row.openedAt,
      offset,
      row.cutoffMinutes,
      now,
    );

    if (openNow === input.open) {
      return {
        status: "ok",
        state: {
          isOpenToday: openNow,
          openedAt: openNow ? row.openedAt : null,
          businessDate,
        },
      };
    }

    // One batch so the current state and the event log cannot disagree.
    await this.db.batch([
      this.db
        .update(restaurantMarketMemberships)
        .set({ openedAt: input.open ? now : null })
        .where(eq(restaurantMarketMemberships.id, row.membershipId)),
      this.db.insert(marketVendorOpenEvents).values({
        marketId: input.marketId,
        restaurantId: input.restaurantId,
        action: input.open ? "open" : "close",
        businessDate,
        occurredAt: now,
        actorUserId: input.actorUserId,
      }),
    ]);
    await this.bumpPublicCacheVersion();

    return {
      status: "ok",
      state: {
        isOpenToday: input.open,
        openedAt: input.open ? now : null,
        businessDate,
      },
    };
  }
```

在檔案頂層（class 之前）加 type：

```ts
export type MarketVendorOpenState = {
  isOpenToday: boolean;
  openedAt: Date | null;
  businessDate: string;
};
```

修改 `listRestaurantMemberships`：select 多取三個欄位並 join restaurants，map 時算狀態：

```ts
  async listRestaurantMemberships(restaurantId: string, now = new Date()) {
    const rows = await this.db
      .select({
        // ...既有欄位全部保留...
        openedAt: restaurantMarketMemberships.openedAt,
        cutoffMinutes: markets.businessDayCutoffMinutes,
        timezone: restaurants.timezone,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(markets, eq(restaurantMarketMemberships.marketId, markets.id))
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      // ...既有 where / orderBy 不變...

    return {
      memberships: rows.map((row) => {
        const offset = businessTimezoneOffsetMinutes(row.timezone);
        const isOpenToday = isMarketVendorOpenToday(
          row.openedAt,
          offset,
          row.cutoffMinutes,
          now,
        );
        return {
          // ...既有欄位全部保留...
          isOpenToday,
          openedAt: isOpenToday ? row.openedAt : null,
          businessDate: getMarketBusinessDate(offset, row.cutoffMinutes, now),
          market: {
            // ...既有 market 欄位...
            businessDayCutoffMinutes: row.cutoffMinutes,
          },
        };
      }),
    };
  }
```

- [ ] **Step 5: Add the routes**

在 `apps/api/src/features/restaurants/routes/index.ts` 的 import 補上 `badRequest`（從 `../../../shared/utils/api-error`，與既有 `notFound, forbidden` 同一行）與 `restaurantMarketParamSchema`（從 `../../markets/schemas/validation`，與 `createMarketJoinRequestSchema` 同一行）。在 `GET /:id/markets` 之後加：

```ts
function marketOpenTodayHandler(open: boolean) {
  return async (c: Context<{ Bindings: Env }>) => {
    const { id, marketId } = c.get("validatedParams");
    const user = c.get("user");

    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const result = await service.setVendorOpenToday({
      marketId,
      restaurantId: id,
      open,
      actorUserId: user.id ?? null,
    });

    if (result.status === "not_member") {
      throw notFound(
        "Market membership not found",
        "MARKET_MEMBERSHIP_NOT_FOUND",
      );
    }
    if (result.status === "restaurant_inactive") {
      throw badRequest("Restaurant is not active", "RESTAURANT_INACTIVE");
    }

    return c.json({ success: true, data: result.state }, HTTP_STATUS.OK);
  };
}

/**
 * POST /:id/markets/:marketId/open - Open this stall for today's business day
 */
app.post(
  "/:id/markets/:marketId/open",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(restaurantMarketParamSchema),
  marketOpenTodayHandler(true),
);

/**
 * POST /:id/markets/:marketId/close - Close this stall early for today
 */
app.post(
  "/:id/markets/:marketId/close",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(restaurantMarketParamSchema),
  marketOpenTodayHandler(false),
);
```

`Context` 從 `hono` import。若 `c.get("validatedParams")` 在獨立 handler 裡推不出型別，改成 inline handler（兩個路由各寫一次呼叫 `setVendorOpenToday`），不要用 `any`。

`GET /:id/markets` 的 `new MarketsService(c.env.DB)` 不需改（它只讀）。

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/market-vendor-open.real.integration.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 7: Run affected unit tests**

Run: `pnpm verify`
Expected: PASS。`MarketsService.test.ts` 若有 `listRestaurantMemberships` 的 select fixture，補上 `openedAt: null, cutoffMinutes: 300, timezone: "Asia/Taipei"` 並讓斷言包含 `isOpenToday: false`。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/features/markets/services/MarketsService.ts apps/api/src/features/markets/schemas/validation.ts apps/api/src/features/restaurants/routes/index.ts apps/api/src/__tests__/integration/market-vendor-open.real.integration.test.ts
git commit -m "feat(api): let market vendors open and close for the day"
```

---

### Task 4: 攤位清單改用開店狀態，結帳擋下未開店攤位

**Files:**
- Modify: `apps/api/src/features/markets/services/MarketsService.ts`（`listVendors` 約第 1004 行、`queryVendors` 約第 1020 行）
- Modify: `apps/api/src/features/market-checkouts/routes/index.ts`（約第 553–590 行的 vendors 檢查）
- Modify: 既有測試 fixture（Step 6 列出）
- Modify: `apps/api/src/__tests__/integration/market-vendor-open.real.integration.test.ts`（加測試）

**Interfaces:**
- Consumes: Task 1 全部 helper；Task 3 的 open 路由（測試用）
- Produces: `GET /markets/:slug/vendors` 的 `isOpen` 語意改為「今日已開店」；`POST /market-checkouts` 對未開店攤位回 409 `VENDOR_NOT_OPEN_TODAY`，`details: { restaurantIds: string[] }`

- [ ] **Step 1: Write the failing tests**

在 `market-vendor-open.real.integration.test.ts` 的 describe 內加（`seedMarket` 要讓市集通過 public readiness：若清單回 404，照 `markets.real.integration.test.ts` 第 154–190 行的 `seedMarket` 補齊 `openingHours`、`bannerUrl`、`logoUrl`、`imageUrls`，並為攤位加一個 `seed.menuItem`）：

```ts
  async function listVendors(slug: string) {
    const res = await testApp.app.fetch(
      new Request(`https://test/api/v1/markets/${slug}/vendors`),
    );
    return readData<{
      vendors: Array<{ restaurantId: string; isOpen: boolean }>;
    }>(res);
  }

  it("shows the stall as open only after it opens today", async () => {
    const { market, vendor, token } = await setup();
    await seed.menuItem(String(vendor.id), { name: "雞排", priceCents: 12000 });

    expect((await listVendors(market.slug)).vendors[0]).toMatchObject({
      restaurantId: String(vendor.id),
      isOpen: false,
    });

    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);

    // The open call bumps the cache version, so the new state is visible
    // immediately rather than after the 5-minute TTL.
    expect((await listVendors(market.slug)).vendors[0]).toMatchObject({
      isOpen: true,
    });
  });

  it("does not let opening in one market open the stall in another", async () => {
    const { market, vendor, token } = await setup();
    const otherMarket = await seedMarket(testApp);
    await testApp.testDb.drizzle.insert(restaurantMarketMemberships).values({
      restaurantId: String(vendor.id),
      marketId: otherMarket.id,
      joinedAt: new Date(),
    });

    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);

    const memberships = await readData<{
      memberships: Array<{ marketId: string; isOpenToday: boolean }>;
    }>(await get(`/restaurants/${vendor.id}/markets`, token));
    expect(
      Object.fromEntries(
        memberships.memberships.map((m) => [m.marketId, m.isOpenToday]),
      ),
    ).toEqual({ [market.id]: true, [otherMarket.id]: false });
  });

  it("rejects a market checkout that includes a stall not open today", async () => {
    const { market, vendor } = await setup();
    const item = await seed.menuItem(String(vendor.id), {
      name: "雞排",
      price: 120,
      priceCents: 12000,
    });

    const res = await testApp.app.fetch(
      new Request("https://test/api/v1/market-checkouts", {
        method: "POST",
        headers: { ...CSRF_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({
          marketSlug: market.slug,
          guestName: "Guest",
          phoneLastDigits: "789",
          vendors: [
            {
              restaurantId: String(vendor.id),
              items: [{ menuItemId: item.id, quantity: 1 }],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(409);
    expect((await readEnvelope(res)).error).toMatchObject({
      code: "VENDOR_NOT_OPEN_TODAY",
      details: { restaurantIds: [String(vendor.id)] },
    });
  });
```

> 結帳請求的 headers 以 `market-checkouts.real.integration.test.ts` 的 `CUSTOMER_HEADERS` 為準（找它的定義複製過來）；若 seed 的攤位預設沒開 `allowGuestOrders`，會先得到 403 而不是 409，這時照該檔的 seed 方式開啟。

另在 `apps/api/src/features/markets/services/MarketsService.test.ts` 加一個單元測試，釘住 Review Focus #1（舊快取缺 cutoff）：

```ts
  it("falls back to the default cutoff when a cached market predates it", async () => {
    const service = new MarketsService({} as D1Database);
    const openedAt = new Date();
    spyOnPrivate(service, "queryMarketBySlug").mockResolvedValue({
      market: { id: "m1", slug: "m", businessDayCutoffMinutes: undefined },
      publicReadiness: { ready: true },
    } as unknown as Awaited<ReturnType<MarketsService["queryMarketBySlug"]>>);
    mocks.cache.get.mockResolvedValue(null);
    // Rows come back from the vendor select; reuse this file's select fixture
    // helper so the vendor row carries openedAt = now and timezone Asia/Taipei.
    const vendors = await service.listVendors("m", {});
    expect(vendors?.vendors[0]?.isOpen).toBe(true);
    expect(mocks.cache.set).toHaveBeenCalledWith(
      expect.stringContaining(":vendors:"),
      expect.anything(),
      expect.any(Number),
    );
  });
```

> 這個檔用 `createSelectFixtureDb` 餵 select 結果；照同檔既有 `queryVendors` 測試的 fixture 寫法，讓第一個 select 回傳一列 `{ restaurantId: "r1", openedAt, timezone: "Asia/Taipei", ... }`、count select 回傳 `[{ count: 1 }]`。

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/market-vendor-open.real.integration.test.ts
pnpm --filter api exec vitest run src/features/markets/services/MarketsService.test.ts
```
Expected: FAIL。清單的 `isOpen` 還是依營業時間；結帳回 201 而不是 409。

- [ ] **Step 3: Change `queryVendors` and the cache key**

`listVendors`：

```ts
  async listVendors(slug: string, filters: VendorFilters, now = new Date()) {
    const detail = await this.getMarketBySlug(slug);
    const cutoffMinutes =
      detail?.market.businessDayCutoffMinutes ??
      DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES;
    const cacheKey = await this.publicCacheKey("vendors", {
      slug,
      ...filters,
      // Rolls the key over at the cutoff, so a list cached at 04:59 is not
      // served at 05:00 with yesterday's open flags.
      businessDay: marketBusinessDateCacheKey(cutoffMinutes, now),
    });
    // ...其餘不變，但呼叫改成 this.queryVendors(slug, filters, now)
  }
```

`queryVendors(slug, filters, now = new Date())`：
- select 多取 `openedAt: restaurantMarketMemberships.openedAt`。
- 在 map 之前算 `const cutoffMinutes = marketDetail.market.businessDayCutoffMinutes ?? DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES;`
- map 改成：

```ts
    // `timezone` and `openedAt` are destructured off rather than spread: they
    // only feed `isOpen` (the stall's own business day, #329), and the public
    // vendor payload does not otherwise carry them.
    let vendors = rows.map(({ timezone, openedAt, ...row }) => ({
      ...row,
      effectiveBusinessHours: row.marketHours ?? row.businessHours ?? null,
      isOpen: isMarketVendorOpenToday(
        openedAt,
        businessTimezoneOffsetMinutes(timezone),
        cutoffMinutes,
        now,
      ),
      // ...distanceKm 區塊不變...
    }));
```

import 補 `marketBusinessDateCacheKey`。若 `isOpenNow` 在檔內已無其他用途，移除它的 import（lint 會提示）。`filters.openNow` 的過濾不用改——它讀的就是新的 `isOpen`。

- [ ] **Step 4: Add the checkout gate**

在 `apps/api/src/features/market-checkouts/routes/index.ts`：
- import 補 `ApiError`（從 `../../../shared/utils/api-error`，加進既有那一行）與 `isMarketVendorOpenToday`、`businessTimezoneOffsetMinutes`、`DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES`（從 `@makanmasak/database`，加進既有那一行）。
- vendors 的 `Promise.all` map 最後把 `return { vendor, restaurant };` 改成 `return { vendor, restaurant, membership };`。
- 在 `Promise.all` 之後、`sharedCurrency(` 之前加：

```ts
  // Every stall in the checkout must have opened for today's business day.
  // Checked before any child order exists, so a rejection leaves nothing to
  // compensate; all closed stalls are named at once so the cart can drop them.
  const now = new Date();
  const cutoffMinutes =
    market.businessDayCutoffMinutes ??
    DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES;
  const closedRestaurantIds = vendors
    .filter(
      ({ restaurant, membership }) =>
        !isMarketVendorOpenToday(
          membership.openedAt,
          businessTimezoneOffsetMinutes(restaurant.timezone),
          cutoffMinutes,
          now,
        ),
    )
    .map(({ restaurant }) => restaurant.id);
  if (closedRestaurantIds.length > 0) {
    throw new ApiError(
      "VENDOR_NOT_OPEN_TODAY",
      "Some vendors are not open today",
      409,
      { restaurantIds: closedRestaurantIds },
    );
  }
```

- [ ] **Step 5: Run the new tests**

Run 同 Step 2。Expected: PASS。

- [ ] **Step 6: Open the stalls in every existing checkout fixture**

新 gate 會讓既有測試全部 409。對下列檔案，把每一個 `insert(restaurantMarketMemberships).values(...)` 的每一列加上 `openedAt: new Date()`：

- `apps/api/src/__tests__/integration/market-checkouts.real.integration.test.ts`
- `apps/api/src/__tests__/integration/market-checkout-child-order-settlement.real.integration.test.ts`
- `apps/api/src/__tests__/integration/market-checkout-provider-money.real.integration.test.ts`
- `apps/api/src/__tests__/integration/shop-wallet-market-checkout.real.integration.test.ts`
- `apps/api/src/__tests__/integration/market-checkout-voucher.real.integration.test.ts`（若它有建會籍）

`apps/api/src/features/market-checkouts/routes/index.test.ts` 是 mock db：membership fixture 加 `openedAt: new Date()`，restaurant fixture 若沒有 `timezone` 就加 `timezone: "Asia/Taipei"`，market fixture 加 `businessDayCutoffMinutes: 300`。

找漏網之魚：

```bash
grep -rln "restaurantMarketMemberships" apps/api/src | xargs grep -l "market-checkouts" | grep test
```

`tests/e2e/customer/markets.spec.ts`：若它打真 API 而非 mock，種資料的地方同樣要讓攤位已開店；若它 mock `/markets/*/vendors`，把 mock 的 `isOpen` 設為 `true`。

- [ ] **Step 7: Run all market checkout tests**

Run:
```bash
pnpm --filter api exec vitest run --config vitest.real-integration.config.ts market-checkout shop-wallet-market-checkout market-vendor-open markets.real
pnpm --filter api exec vitest run src/features/market-checkouts src/features/markets
```
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): show and sell only market stalls that opened today"
```

> `git add apps/api/src` 前先 `git status`，確認只有本任務的檔案（工作目錄可能有其他 agent 的改動，不要一併 stage）。

---

### Task 5: 報表計算（純函式）與 CSV

**Files:**
- Create: `apps/api/src/features/markets/services/market-open-report.ts`
- Create: `apps/api/src/features/markets/services/market-open-report.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `getMarketBusinessDate`、`marketBusinessDayEndMs`；`toCsv`（`apps/api/src/shared/utils/csv.ts`）
- Produces:

```ts
export interface OpenReportVendor { restaurantId: string; name: string; stallNumber: string | null; offsetMinutes: number; currency: string }
export interface OpenReportEvent { restaurantId: string; action: "open" | "close"; businessDate: string; occurredAtMs: number; actorUserId: string | null }
export interface OpenReportOrder { restaurantId: string; createdAtMs: number; amountCents: number }
export interface OpenReportInput { from: string; to: string; cutoffMinutes: number; openingHours: Record<string, { closed?: boolean }> | null; vendors: OpenReportVendor[]; events: OpenReportEvent[]; orders: OpenReportOrder[]; actorNames: Record<string, string>; nowMs: number }
export interface OpenReportDailyRow { businessDate: string; restaurantId: string; vendorName: string; stallNumber: string | null; firstOpenedAtMs: number | null; lastClosedAtMs: number | null; autoClosed: boolean; openMinutes: number; openedBy: string | null; orderCount: number; revenueCents: number; currency: string; offsetMinutes: number }
export interface OpenReportSummaryRow { restaurantId: string; vendorName: string; stallNumber: string | null; openDays: number; expectedDays: number; attendanceRate: number | null; avgOpenMinutes: number; orderCount: number; revenueCents: number; currency: string }
export interface OpenReport { daily: OpenReportDailyRow[]; summary: OpenReportSummaryRow[] }
export function buildOpenReport(input: OpenReportInput): OpenReport
export function openReportToCsv(report: OpenReport, view: "daily" | "summary"): string
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/features/markets/services/market-open-report.test.ts
import { describe, expect, it } from "vitest";
import {
  buildOpenReport,
  openReportToCsv,
  type OpenReportInput,
} from "./market-open-report";

const TAIPEI = 480;
const ms = (iso: string) => Date.parse(iso);

function buildInput(overrides: Partial<OpenReportInput> = {}): OpenReportInput {
  return {
    from: "2026-09-25", // Friday
    to: "2026-09-27", // Sunday
    cutoffMinutes: 300,
    openingHours: {
      friday: { closed: false },
      saturday: { closed: false },
    },
    vendors: [
      { restaurantId: "a", name: "雞排攤", stallNumber: "A01", offsetMinutes: TAIPEI, currency: "TWD" },
      { restaurantId: "b", name: "甜點攤", stallNumber: "B02", offsetMinutes: TAIPEI, currency: "TWD" },
    ],
    events: [
      // A, Friday: 17:00–19:00, reopens 20:00 and never closes.
      { restaurantId: "a", action: "open", businessDate: "2026-09-25", occurredAtMs: ms("2026-09-25T09:00:00Z"), actorUserId: "u1" },
      { restaurantId: "a", action: "close", businessDate: "2026-09-25", occurredAtMs: ms("2026-09-25T11:00:00Z"), actorUserId: "u1" },
      { restaurantId: "a", action: "open", businessDate: "2026-09-25", occurredAtMs: ms("2026-09-25T12:00:00Z"), actorUserId: "u1" },
      // B, Saturday: 18:00–20:00.
      { restaurantId: "b", action: "open", businessDate: "2026-09-26", occurredAtMs: ms("2026-09-26T10:00:00Z"), actorUserId: null },
      { restaurantId: "b", action: "close", businessDate: "2026-09-26", occurredAtMs: ms("2026-09-26T12:00:00Z"), actorUserId: null },
    ],
    orders: [
      // Friday 18:00 local.
      { restaurantId: "a", createdAtMs: ms("2026-09-25T10:00:00Z"), amountCents: 12000 },
      // Saturday 01:00 local — still Friday's business day.
      { restaurantId: "a", createdAtMs: ms("2026-09-25T17:00:00Z"), amountCents: 8000 },
    ],
    actorNames: { u1: "王老闆" },
    nowMs: ms("2026-09-28T00:00:00Z"),
    ...overrides,
  };
}

describe("buildOpenReport", () => {
  it("sums every open session and ends an unclosed one at the cutoff", () => {
    const report = buildOpenReport(buildInput());
    const friday = report.daily.find(
      (row) => row.restaurantId === "a" && row.businessDate === "2026-09-25",
    );
    expect(friday).toEqual(
      expect.objectContaining({
        firstOpenedAtMs: ms("2026-09-25T09:00:00Z"),
        // Business day ends at 05:00 local Saturday = 21:00Z Friday.
        lastClosedAtMs: ms("2026-09-25T21:00:00Z"),
        autoClosed: true,
        openMinutes: 120 + 540,
        openedBy: "王老闆",
        orderCount: 2,
        revenueCents: 20000,
      }),
    );
  });

  it("counts an ongoing session up to now without marking it closed", () => {
    const report = buildOpenReport(
      buildInput({ nowMs: ms("2026-09-25T13:00:00Z") }),
    );
    const friday = report.daily.find((row) => row.restaurantId === "a");
    expect(friday).toEqual(
      expect.objectContaining({
        lastClosedAtMs: null,
        autoClosed: false,
        openMinutes: 120 + 60,
      }),
    );
  });

  it("summarises attendance against the market's trading days", () => {
    const report = buildOpenReport(buildInput());
    expect(report.summary).toEqual([
      expect.objectContaining({
        restaurantId: "a",
        openDays: 1,
        expectedDays: 2, // Friday and Saturday; Sunday has no hours.
        attendanceRate: 0.5,
        avgOpenMinutes: 660,
        orderCount: 2,
        revenueCents: 20000,
      }),
      expect.objectContaining({
        restaurantId: "b",
        openDays: 1,
        attendanceRate: 0.5,
        avgOpenMinutes: 120,
        orderCount: 0,
      }),
    ]);
  });

  it("counts every day as a trading day when the market has no hours", () => {
    const report = buildOpenReport(buildInput({ openingHours: null }));
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ expectedDays: 3 }),
    );
  });

  it("reports no attendance rate when the market trades on no day in range", () => {
    const report = buildOpenReport(
      buildInput({ openingHours: { monday: { closed: false } } }),
    );
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ expectedDays: 0, attendanceRate: null }),
    );
  });

  it("keeps a day that has orders but no open event", () => {
    const report = buildOpenReport(buildInput({ events: [] }));
    expect(report.daily).toEqual([
      expect.objectContaining({
        restaurantId: "a",
        businessDate: "2026-09-25",
        firstOpenedAtMs: null,
        openMinutes: 0,
        orderCount: 2,
      }),
    ]);
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ openDays: 0, orderCount: 2 }),
    );
  });
});

describe("openReportToCsv", () => {
  it("writes local times and integer cents", () => {
    const csv = openReportToCsv(buildOpenReport(buildInput()), "daily");
    const [header, first] = csv.split("\n");
    expect(header).toBe(
      "business_date,restaurant_id,vendor_name,stall_number,first_opened_at,last_closed_at,auto_closed,open_minutes,opened_by,order_count,revenue_cents,currency",
    );
    expect(first).toBe(
      "2026-09-25,a,雞排攤,A01,2026-09-25 17:00,2026-09-26 05:00,true,660,王老闆,2,20000,TWD",
    );
  });

  it("writes the summary view", () => {
    const csv = openReportToCsv(buildOpenReport(buildInput()), "summary");
    expect(csv.split("\n")[0]).toBe(
      "restaurant_id,vendor_name,stall_number,open_days,expected_days,attendance_rate,avg_open_minutes,order_count,revenue_cents,currency",
    );
    expect(csv.split("\n")[1]).toBe("a,雞排攤,A01,1,2,0.5000,660,2,20000,TWD");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter api exec vitest run src/features/markets/services/market-open-report.test.ts`
Expected: FAIL，`Failed to resolve import "./market-open-report"`

- [ ] **Step 3: Write the implementation**

```ts
// apps/api/src/features/markets/services/market-open-report.ts
import {
  getMarketBusinessDate,
  marketBusinessDayEndMs,
} from "@makanmasak/database";
import { toCsv } from "../../../shared/utils/csv";

// (interfaces exactly as listed in this task's Interfaces block)

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const DAY_MS = 86_400_000;

export function listBusinessDates(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += DAY_MS
  ) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function countExpectedDays(
  from: string,
  to: string,
  openingHours: OpenReportInput["openingHours"],
): number {
  const dates = listBusinessDates(from, to);
  if (!openingHours || Object.keys(openingHours).length === 0) {
    return dates.length;
  }
  return dates.filter((date) => {
    const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const hours = openingHours[weekday];
    return Boolean(hours) && !hours.closed;
  }).length;
}

interface DayBucket {
  vendor: OpenReportVendor;
  businessDate: string;
  events: OpenReportEvent[];
  orderCount: number;
  revenueCents: number;
}

function toDailyRow(
  bucket: DayBucket,
  input: OpenReportInput,
): OpenReportDailyRow {
  const events = [...bucket.events].sort(
    (a, b) => a.occurredAtMs - b.occurredAtMs,
  );
  const dayEndMs = marketBusinessDayEndMs(
    bucket.businessDate,
    bucket.vendor.offsetMinutes,
    input.cutoffMinutes,
  );
  let openSince: number | null = null;
  let openMs = 0;
  let firstOpen: OpenReportEvent | null = null;
  let lastClosedAtMs: number | null = null;

  for (const event of events) {
    if (event.action === "open") {
      firstOpen ??= event;
      openSince ??= event.occurredAtMs;
    } else if (openSince !== null) {
      openMs += event.occurredAtMs - openSince;
      openSince = null;
      lastClosedAtMs = event.occurredAtMs;
    }
  }

  let autoClosed = false;
  if (openSince !== null) {
    if (input.nowMs >= dayEndMs) {
      openMs += dayEndMs - openSince;
      lastClosedAtMs = dayEndMs;
      autoClosed = true;
    } else {
      openMs += input.nowMs - openSince;
      lastClosedAtMs = null;
    }
  }

  return {
    businessDate: bucket.businessDate,
    restaurantId: bucket.vendor.restaurantId,
    vendorName: bucket.vendor.name,
    stallNumber: bucket.vendor.stallNumber,
    firstOpenedAtMs: firstOpen?.occurredAtMs ?? null,
    lastClosedAtMs,
    autoClosed,
    openMinutes: Math.round(openMs / 60_000),
    openedBy: firstOpen?.actorUserId
      ? (input.actorNames[firstOpen.actorUserId] ?? null)
      : null,
    orderCount: bucket.orderCount,
    revenueCents: bucket.revenueCents,
    currency: bucket.vendor.currency,
    offsetMinutes: bucket.vendor.offsetMinutes,
  };
}

// ponytail: orders are bucketed in JS, one row each. Fine for a 92-day window
// of one market; move the bucketing into SQL (per-offset DATE()) if a report
// ever has to scan six-figure order counts.
export function buildOpenReport(input: OpenReportInput): OpenReport {
  const vendorsById = new Map(
    input.vendors.map((vendor) => [vendor.restaurantId, vendor]),
  );
  const buckets = new Map<string, DayBucket>();
  const bucketFor = (vendor: OpenReportVendor, businessDate: string) => {
    const key = `${vendor.restaurantId}|${businessDate}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { vendor, businessDate, events: [], orderCount: 0, revenueCents: 0 };
      buckets.set(key, bucket);
    }
    return bucket;
  };
  const inRange = (date: string) => date >= input.from && date <= input.to;

  for (const event of input.events) {
    const vendor = vendorsById.get(event.restaurantId);
    if (vendor && inRange(event.businessDate)) {
      bucketFor(vendor, event.businessDate).events.push(event);
    }
  }
  for (const order of input.orders) {
    const vendor = vendorsById.get(order.restaurantId);
    if (!vendor) continue;
    const businessDate = getMarketBusinessDate(
      vendor.offsetMinutes,
      input.cutoffMinutes,
      new Date(order.createdAtMs),
    );
    if (!inRange(businessDate)) continue;
    const bucket = bucketFor(vendor, businessDate);
    bucket.orderCount += 1;
    bucket.revenueCents += order.amountCents;
  }

  const daily = [...buckets.values()]
    .map((bucket) => toDailyRow(bucket, input))
    .sort(
      (a, b) =>
        a.businessDate.localeCompare(b.businessDate) ||
        (a.stallNumber ?? "").localeCompare(b.stallNumber ?? "") ||
        a.vendorName.localeCompare(b.vendorName),
    );

  const expectedDays = countExpectedDays(
    input.from,
    input.to,
    input.openingHours,
  );
  const summary = input.vendors.map((vendor) => {
    const rows = daily.filter((row) => row.restaurantId === vendor.restaurantId);
    const openRows = rows.filter((row) => row.firstOpenedAtMs !== null);
    const totalOpenMinutes = openRows.reduce(
      (sum, row) => sum + row.openMinutes,
      0,
    );
    return {
      restaurantId: vendor.restaurantId,
      vendorName: vendor.name,
      stallNumber: vendor.stallNumber,
      openDays: openRows.length,
      expectedDays,
      attendanceRate:
        expectedDays > 0 ? Math.min(1, openRows.length / expectedDays) : null,
      avgOpenMinutes:
        openRows.length > 0 ? Math.round(totalOpenMinutes / openRows.length) : 0,
      orderCount: rows.reduce((sum, row) => sum + row.orderCount, 0),
      revenueCents: rows.reduce((sum, row) => sum + row.revenueCents, 0),
      currency: vendor.currency,
    };
  });

  return { daily, summary };
}

function localTime(ms: number | null, offsetMinutes: number): string {
  if (ms === null) return "";
  return new Date(ms + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

export function openReportToCsv(
  report: OpenReport,
  view: "daily" | "summary",
): string {
  if (view === "summary") {
    return toCsv([
      [
        "restaurant_id",
        "vendor_name",
        "stall_number",
        "open_days",
        "expected_days",
        "attendance_rate",
        "avg_open_minutes",
        "order_count",
        "revenue_cents",
        "currency",
      ],
      ...report.summary.map((row) => [
        row.restaurantId,
        row.vendorName,
        row.stallNumber,
        row.openDays,
        row.expectedDays,
        row.attendanceRate === null ? "" : row.attendanceRate.toFixed(4),
        row.avgOpenMinutes,
        row.orderCount,
        row.revenueCents,
        row.currency,
      ]),
    ]);
  }

  return toCsv([
    [
      "business_date",
      "restaurant_id",
      "vendor_name",
      "stall_number",
      "first_opened_at",
      "last_closed_at",
      "auto_closed",
      "open_minutes",
      "opened_by",
      "order_count",
      "revenue_cents",
      "currency",
    ],
    ...report.daily.map((row) => [
      row.businessDate,
      row.restaurantId,
      row.vendorName,
      row.stallNumber,
      localTime(row.firstOpenedAtMs, row.offsetMinutes),
      localTime(row.lastClosedAtMs, row.offsetMinutes),
      row.autoClosed,
      row.openMinutes,
      row.openedBy,
      row.orderCount,
      row.revenueCents,
      row.currency,
    ]),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter api exec vitest run src/features/markets/services/market-open-report.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/markets/services/market-open-report.ts apps/api/src/features/markets/services/market-open-report.test.ts
git commit -m "feat(api): compute market stall open-day reports"
```

---

### Task 6: 報表 API（平台與店主）

**Files:**
- Create: `apps/api/src/features/markets/services/MarketOpenReportService.ts`
- Create: `apps/api/src/features/markets/routes/open-report-response.ts`
- Modify: `apps/api/src/features/markets/schemas/validation.ts`（新增 `marketOpenReportQuerySchema`）
- Modify: `apps/api/src/features/markets/routes/admin.ts`（新增 `GET /:id/open-report`）
- Modify: `apps/api/src/features/restaurants/routes/index.ts`（新增 `GET /:id/markets/:marketId/open-report`）
- Modify: `apps/api/src/__tests__/integration/market-vendor-open.real.integration.test.ts`（加測試）

**Interfaces:**
- Consumes: Task 5 的 `buildOpenReport`、`openReportToCsv`、型別；Task 3 的 `restaurantMarketParamSchema`
- Produces:
  - `MarketOpenReportService.getReport(input: { marketId: string; restaurantId?: string; from: string; to: string; now?: Date }): Promise<MarketOpenReportResult | null>`
  - `type MarketOpenReportResult = OpenReport & { market: { id: string; name: string; businessDayCutoffMinutes: number }; from: string; to: string }`
  - `GET /api/v1/admin/markets/:id/open-report?from&to[&view=daily|summary][&format=csv]`（角色 0）
  - `GET /api/v1/restaurants/:id/markets/:marketId/open-report?...`（角色 0／1）
  - JSON：`{ success: true, data: MarketOpenReportResult }`；CSV：`text/csv; charset=utf-8`，檔名 `market-open-report-{view}-{from}-{to}.csv`

- [ ] **Step 1: Write the failing integration tests**

在 `market-vendor-open.real.integration.test.ts` 的 import 補 `marketCheckoutChildOrders`、`marketCheckoutSessions`、`orders`，describe 內加：

```ts
  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  it("reports today's open session and completed market revenue to the owner", async () => {
    const { market, vendor, token } = await setup();
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);

    const order = await seed.order(String(vendor.id), {
      paymentStatus: "completed",
      totalAmountCents: 12000,
    });
    const checkoutId = `mc-${crypto.randomUUID()}`;
    const now = new Date();
    await testApp.testDb.drizzle.insert(marketCheckoutSessions).values({
      id: checkoutId,
      marketId: market.id,
      marketSlug: market.slug,
      marketName: market.name,
      subtotalCents: 12000,
      childOrderCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await testApp.testDb.drizzle.insert(marketCheckoutChildOrders).values({
      checkoutId,
      restaurantId: String(vendor.id),
      restaurantName: vendor.name,
      orderId: String(order.id),
      orderNumber: "M-001",
      totalAmountCents: 12000,
      tokenExpiresAt: new Date(Date.now() + 3_600_000),
      createdAt: now,
    });

    const from = new Date(Date.now() - 2 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await get(
      `/restaurants/${vendor.id}/markets/${market.id}/open-report?from=${from}&to=${to}`,
      token,
    );
    expect(res.status).toBe(200);
    const report = await readData<{
      daily: Array<Record<string, unknown>>;
      summary: Array<Record<string, unknown>>;
    }>(res);
    expect(report.daily).toEqual([
      expect.objectContaining({
        restaurantId: String(vendor.id),
        firstOpenedAtMs: expect.any(Number),
        orderCount: 1,
        revenueCents: 12000,
      }),
    ]);
    expect(report.summary[0]).toEqual(
      expect.objectContaining({ openDays: 1, orderCount: 1 }),
    );
  });

  it("exports the platform report as CSV", async () => {
    const { market, vendor, token } = await setup();
    await post(`/restaurants/${vendor.id}/markets/${market.id}/open`, token);
    const adminToken = await testApp.authHelper.adminToken(String(vendor.id));

    const res = await get(
      `/admin/markets/${market.id}/open-report?from=${today()}&to=${today()}&view=summary&format=csv`,
      adminToken,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).split("\n");
    expect(lines[0]).toContain("open_days");
    expect(lines[1]).toContain(String(vendor.id));
  });

  it("rejects a range longer than 92 days or reversed", async () => {
    const { market, vendor, token } = await setup();
    const tooLong = await get(
      `/restaurants/${vendor.id}/markets/${market.id}/open-report?from=2026-01-01&to=2026-06-30`,
      token,
    );
    expect(tooLong.status).toBe(400);
    const reversed = await get(
      `/restaurants/${vendor.id}/markets/${market.id}/open-report?from=2026-09-10&to=2026-09-01`,
      token,
    );
    expect(reversed.status).toBe(400);
  });
```

> `seed.order` 的 override 欄位名以 `helpers/seed-helper.ts` 第 236 行起的實作為準；若它不收 `paymentStatus`，seed 之後用 `update(orders).set({ paymentStatus: "completed" })`。`adminToken` 需要 DB 裡有對應的 admin user 時，照 `markets.real.integration.test.ts` 第 997–1005 行先 `seed.user({ role: 0, ... })`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/market-vendor-open.real.integration.test.ts`
Expected: FAIL，報表路由回 404。

- [ ] **Step 3: Add the query schema**

在 `apps/api/src/features/markets/schemas/validation.ts` 加：

```ts
const MAX_OPEN_REPORT_DAYS = 92;

const reportDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    { message: "Invalid date" },
  );

export const marketOpenReportQuerySchema = z.lazy(() =>
  z
    .object({
      from: reportDateSchema,
      to: reportDateSchema,
      view: z.enum(["daily", "summary"]).optional(),
      format: z.enum(["json", "csv"]).optional(),
    })
    .refine((query) => query.from <= query.to, {
      message: "from must not be after to",
      path: ["from"],
    })
    .refine(
      (query) =>
        (Date.parse(`${query.to}T00:00:00Z`) -
          Date.parse(`${query.from}T00:00:00Z`)) /
          86_400_000 <
        MAX_OPEN_REPORT_DAYS,
      { message: `Range must be at most ${MAX_OPEN_REPORT_DAYS} days`, path: ["to"] },
    ),
);

export type MarketOpenReportQuery = z.infer<typeof marketOpenReportQuerySchema>;
```

- [ ] **Step 4: Implement the service**

```ts
// apps/api/src/features/markets/services/MarketOpenReportService.ts
import { drizzle } from "drizzle-orm/d1";
import { and, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import type { D1Database } from "@cloudflare/workers-types";
import {
  DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES,
  businessTimezoneOffsetMinutes,
  marketCheckoutChildOrders,
  marketCheckoutSessions,
  marketVendorOpenEvents,
  markets,
  orders,
  restaurantMarketMemberships,
  restaurants,
  users,
} from "@makanmasak/database";
import { displayCurrencyFromRestaurantSettings } from "../../../shared/utils/restaurant-currency";
import {
  buildOpenReport,
  type OpenReport,
  type OpenReportVendor,
} from "./market-open-report";

const DAY_MS = 86_400_000;

export type MarketOpenReportResult = OpenReport & {
  market: { id: string; name: string; businessDayCutoffMinutes: number };
  from: string;
  to: string;
};

export class MarketOpenReportService {
  private readonly db;

  constructor(d1: D1Database) {
    this.db = drizzle(d1);
  }

  async getReport(input: {
    marketId: string;
    restaurantId?: string;
    from: string;
    to: string;
    now?: Date;
  }): Promise<MarketOpenReportResult | null> {
    const [market] = await this.db
      .select({
        id: markets.id,
        name: markets.name,
        cutoffMinutes: markets.businessDayCutoffMinutes,
        openingHours: markets.openingHours,
      })
      .from(markets)
      .where(and(eq(markets.id, input.marketId), isNull(markets.deletedAt)))
      .limit(1);
    if (!market) return null;
    const cutoffMinutes =
      market.cutoffMinutes ?? DEFAULT_MARKET_BUSINESS_DAY_CUTOFF_MINUTES;

    const vendorRows = await this.db
      .select({
        restaurantId: restaurants.id,
        name: restaurants.name,
        stallNumber: restaurantMarketMemberships.stallNumber,
        timezone: restaurants.timezone,
        settings: restaurants.settings,
      })
      .from(restaurantMarketMemberships)
      .innerJoin(
        restaurants,
        eq(restaurantMarketMemberships.restaurantId, restaurants.id),
      )
      .where(
        and(
          eq(restaurantMarketMemberships.marketId, market.id),
          input.restaurantId
            ? eq(restaurantMarketMemberships.restaurantId, input.restaurantId)
            : undefined,
        ),
      );
    // A stall that left and rejoined has two membership rows; report it once.
    const vendors = [
      ...new Map(
        vendorRows.map((row): [string, OpenReportVendor] => [
          row.restaurantId,
          {
            restaurantId: row.restaurantId,
            name: row.name,
            stallNumber: row.stallNumber,
            offsetMinutes: businessTimezoneOffsetMinutes(row.timezone),
            currency: displayCurrencyFromRestaurantSettings(row.settings),
          },
        ]),
      ).values(),
    ];

    const eventRows = await this.db
      .select()
      .from(marketVendorOpenEvents)
      .where(
        and(
          eq(marketVendorOpenEvents.marketId, market.id),
          input.restaurantId
            ? eq(marketVendorOpenEvents.restaurantId, input.restaurantId)
            : undefined,
          gte(marketVendorOpenEvents.businessDate, input.from),
          lte(marketVendorOpenEvents.businessDate, input.to),
        ),
      );

    // One day of slack on each side covers every offset and cutoff; the
    // builder assigns each order to its exact business day.
    const windowStart = new Date(Date.parse(`${input.from}T00:00:00Z`) - DAY_MS);
    const windowEnd = new Date(Date.parse(`${input.to}T00:00:00Z`) + 2 * DAY_MS);
    const orderRows = await this.db
      .select({
        restaurantId: marketCheckoutChildOrders.restaurantId,
        createdAt: marketCheckoutChildOrders.createdAt,
        amountCents: marketCheckoutChildOrders.totalAmountCents,
      })
      .from(marketCheckoutChildOrders)
      .innerJoin(
        marketCheckoutSessions,
        eq(marketCheckoutChildOrders.checkoutId, marketCheckoutSessions.id),
      )
      .innerJoin(orders, eq(orders.id, marketCheckoutChildOrders.orderId))
      .where(
        and(
          eq(marketCheckoutSessions.marketId, market.id),
          eq(orders.paymentStatus, "completed"),
          input.restaurantId
            ? eq(marketCheckoutChildOrders.restaurantId, input.restaurantId)
            : undefined,
          gte(marketCheckoutChildOrders.createdAt, windowStart),
          lt(marketCheckoutChildOrders.createdAt, windowEnd),
        ),
      );

    const actorIds = [
      ...new Set(
        eventRows
          .map((event) => event.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actorRows = actorIds.length
      ? await this.db
          .select({
            id: users.id,
            fullName: users.fullName,
            username: users.username,
          })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];

    const report = buildOpenReport({
      from: input.from,
      to: input.to,
      cutoffMinutes,
      openingHours: market.openingHours ?? null,
      vendors,
      events: eventRows.map((event) => ({
        restaurantId: event.restaurantId,
        action: event.action,
        businessDate: event.businessDate,
        occurredAtMs: event.occurredAt.getTime(),
        actorUserId: event.actorUserId,
      })),
      orders: orderRows.map((row) => ({
        restaurantId: row.restaurantId,
        createdAtMs: row.createdAt.getTime(),
        amountCents: row.amountCents,
      })),
      actorNames: Object.fromEntries(
        actorRows.map((row) => [row.id, row.fullName || row.username]),
      ),
      nowMs: (input.now ?? new Date()).getTime(),
    });

    return {
      market: {
        id: market.id,
        name: market.name,
        businessDayCutoffMinutes: cutoffMinutes,
      },
      from: input.from,
      to: input.to,
      ...report,
    };
  }
}
```

> 若 `orders.id` 的型別與 `marketCheckoutChildOrders.orderId`（text）不同，改成與 `MarketCheckoutChildOrderSettlement.ts` 相同的 join 條件。

- [ ] **Step 5: Add the response helper and routes**

```ts
// apps/api/src/features/markets/routes/open-report-response.ts
import type { Context } from "hono";
import type { MarketOpenReportQuery } from "../schemas/validation";
import type { MarketOpenReportResult } from "../services/MarketOpenReportService";
import { openReportToCsv } from "../services/market-open-report";

export function openReportResponse(
  c: Context,
  report: MarketOpenReportResult,
  query: MarketOpenReportQuery,
) {
  if (query.format === "csv") {
    const view = query.view ?? "daily";
    return c.body(openReportToCsv(report, view), 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="market-open-report-${view}-${report.from}-${report.to}.csv"`,
    });
  }
  return c.json({ success: true, data: report }, 200);
}
```

`admin.ts`（整個 router 已是 `requireRole([0])`），在既有 `GET` 路由附近加；`validateQuery`、`notFound` 若未 import 就補上：

```ts
routes.get(
  "/:id/open-report",
  validateParams(marketIdParamSchema),
  validateQuery(marketOpenReportQuerySchema),
  async (c) => {
    const { id } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    const report = await new MarketOpenReportService(c.env.DB).getReport({
      marketId: id,
      from: query.from,
      to: query.to,
    });
    if (!report) throw notFound("Market not found", "MARKET_NOT_FOUND");
    return openReportResponse(c, report, query);
  },
);
```

`restaurants/routes/index.ts`，在 Task 3 的兩個 POST 之後加：

```ts
/**
 * GET /:id/markets/:marketId/open-report - This stall's open-day report
 */
app.get(
  "/:id/markets/:marketId/open-report",
  authMiddleware,
  requireRole([USER_ROLES.ADMIN, USER_ROLES.OWNER]),
  validateParams(restaurantMarketParamSchema),
  validateQuery(marketOpenReportQuerySchema),
  async (c) => {
    const { id, marketId } = c.get("validatedParams");
    const query = c.get("validatedQuery");
    const user = c.get("user");

    if (user.role === USER_ROLES.OWNER && user.restaurantId !== id) {
      throw forbidden("Access denied");
    }

    const report = await new MarketOpenReportService(c.env.DB).getReport({
      marketId,
      restaurantId: id,
      from: query.from,
      to: query.to,
    });
    // No vendor row means this shop never belonged to the market.
    if (!report || report.summary.length === 0) {
      throw notFound(
        "Market membership not found",
        "MARKET_MEMBERSHIP_NOT_FOUND",
      );
    }
    return openReportResponse(c, report, query);
  },
);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter api exec vitest run --config vitest.real-integration.config.ts src/__tests__/integration/market-vendor-open.real.integration.test.ts`
Expected: PASS

- [ ] **Step 7: Run verify and commit**

Run: `pnpm verify`，Expected: PASS

```bash
git add apps/api/src/features/markets apps/api/src/features/restaurants/routes/index.ts apps/api/src/__tests__/integration/market-vendor-open.real.integration.test.ts
git commit -m "feat(api): serve market stall open-day reports to platform and owners"
```

---

### Task 7: 平台設定商圈換日時間

**Files:**
- Modify: `apps/api/src/features/markets/schemas/validation.ts`（`createMarketSchema`）
- Modify: `apps/admin-dashboard/src/services/marketsService.ts`（`MarketListItem` 約第 68 行、`UpdateMarketPublicProfileInput`）
- Modify: `apps/admin-dashboard/src/utils/marketPublicProfileForm.ts`
- Modify: `apps/admin-dashboard/src/utils/marketPublicProfileForm.test.ts`
- Modify: `apps/admin-dashboard/src/views/PlatformMarketsView.vue`（營業時間 JSON 欄位約第 1128 行之後；`editForm` 預設約第 2025 行）

**Interfaces:**
- Produces: API 接受 `businessDayCutoffMinutes: number`（0–1439，選填）；admin 表單欄位 `businessDayCutoffTime: string`（`HH:mm`）

- [ ] **Step 1: Write the failing test**

在 `marketPublicProfileForm.test.ts` 加：

```ts
  it("round-trips the business-day cutoff as HH:mm", () => {
    const form = marketPublicProfileFormFromMarket({
      ...baseMarket,
      businessDayCutoffMinutes: 330,
    });
    expect(form.businessDayCutoffTime).toBe("05:30");

    expect(
      buildMarketPublicProfilePayload({
        ...form,
        businessDayCutoffTime: "04:15",
      }),
    ).toEqual(expect.objectContaining({ businessDayCutoffMinutes: 255 }));
  });

  it("defaults the cutoff to 05:00 and rejects a malformed time", () => {
    const { businessDayCutoffMinutes: _unused, ...legacy } = {
      ...baseMarket,
      businessDayCutoffMinutes: undefined,
    };
    expect(
      marketPublicProfileFormFromMarket(legacy).businessDayCutoffTime,
    ).toBe("05:00");
    expect(() =>
      buildMarketPublicProfilePayload({
        ...marketPublicProfileFormFromMarket(baseMarket),
        businessDayCutoffTime: "25:00",
      }),
    ).toThrow("Business day cutoff");
  });
```

> `baseMarket` 用這個檔既有測試裡建 `MarketListItem` 的那個物件（若它是 inline，抽成檔內常數）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-dashboard exec vitest run src/utils/marketPublicProfileForm.test.ts`
Expected: FAIL，`businessDayCutoffTime` 為 undefined。

- [ ] **Step 3: Implement**

API `createMarketSchema` 在 `platformFeeRateBps` 之後加：

```ts
  businessDayCutoffMinutes: z.number().int().min(0).max(1439).optional(),
```

確認 `MarketsService.createMarket` 與 `updateMarket` 是把 input 展開進 `.values()`／`.set()`；若是逐欄對映，把 `businessDayCutoffMinutes` 加進對映。

admin `marketsService.ts`：`MarketListItem` 與 `UpdateMarketPublicProfileInput` 各加 `businessDayCutoffMinutes?: number;`。

`marketPublicProfileForm.ts`：

```ts
// interface MarketPublicProfileForm 加：
  businessDayCutoffTime: string;

// marketPublicProfileFormFromMarket 回傳物件加：
    businessDayCutoffTime: minutesToTime(market.businessDayCutoffMinutes ?? 300),

// buildMarketPublicProfilePayload 回傳物件加：
    businessDayCutoffMinutes: timeToMinutes(
      form.businessDayCutoffTime,
      "Business day cutoff",
    ),

// 檔案底部加：
function minutesToTime(minutes: number) {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeToMinutes(value: string, label: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) throw new Error(`${label} must be a time between 00:00 and 23:59`);
  return Number(match[1]) * 60 + Number(match[2]);
}
```

`PlatformMarketsView.vue`：`editForm` 預設加 `businessDayCutoffTime: "05:00",`；在營業時間 JSON 的 `<label>` 之後加：

```vue
        <label class="block">
          <span class="text-sm font-medium text-gray-700">營業日換日時間</span>
          <input
            v-model="editForm.businessDayCutoffTime"
            type="time"
            data-testid="market-business-day-cutoff"
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          />
          <span class="mt-1 block text-xs text-gray-500">
            攤位在這個時間之後才算進入新的一天（夜市建議 05:00）
          </span>
        </label>
```

（沿用這個表單既有的中文與樣式寫法；此 view 的其他欄位也是寫死中文。）

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter admin-dashboard exec vitest run src/utils/marketPublicProfileForm.test.ts src/views/PlatformMarketsView.test.ts`
Expected: PASS。`PlatformMarketsView.test.ts` 若有比對整個更新 payload 的斷言，補上 `businessDayCutoffMinutes: 300`。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/markets/schemas/validation.ts apps/api/src/features/markets/services/MarketsService.ts apps/admin-dashboard/src/services/marketsService.ts apps/admin-dashboard/src/utils/marketPublicProfileForm.ts apps/admin-dashboard/src/utils/marketPublicProfileForm.test.ts apps/admin-dashboard/src/views/PlatformMarketsView.vue
git commit -m "feat(markets): let the platform set a market's business-day cutoff"
```

---

### Task 8: 店家後台首頁「今日開店」卡片

**Files:**
- Modify: `apps/admin-dashboard/src/services/marketsService.ts`（`RestaurantMarketMembership` 約第 277 行；新增 `setMarketOpenToday`）
- Create: `apps/admin-dashboard/src/components/dashboard/MarketOpenTodayCard.vue`
- Create: `apps/admin-dashboard/src/components/dashboard/MarketOpenTodayCard.test.ts`
- Modify: `apps/admin-dashboard/src/views/DashboardView.vue`（第 40 行 `<SetupChecklistCard />` 之後；import 區約第 296 行）
- Modify: `apps/admin-dashboard/src/i18n/locales/*.ts`（6 個檔）

**Interfaces:**
- Consumes: `GET /restaurants/:id/markets`（Task 3 的 `isOpenToday`、`openedAt`）；`POST /restaurants/:id/markets/:marketId/open|close`
- Produces:
  - `RestaurantMarketMembership` 多了 `isOpenToday: boolean; openedAt: string | number | null; businessDate: string`
  - `marketsService.setMarketOpenToday(restaurantId: string, marketId: string, open: boolean): Promise<MarketVendorOpenState>`
  - `interface MarketVendorOpenState { isOpenToday: boolean; openedAt: string | number | null; businessDate: string }`
  - route name `MarketOpenReport`（Task 9 建立；本任務的卡片連過去）

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin-dashboard/src/components/dashboard/MarketOpenTodayCard.test.ts
// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketOpenTodayCard from "./MarketOpenTodayCard.vue";

const authState = vi.hoisted(() => ({
  user: { id: 10, role: 1 },
  restaurantId: "shop-1" as string | null,
}));
const marketsService = vi.hoisted(() => ({
  listRestaurantMemberships: vi.fn(),
  setMarketOpenToday: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("@/stores/auth", () => ({ useAuthStore: () => authState }));
vi.mock("@/services/marketsService", () => ({ marketsService }));
vi.mock("vue-router", () => ({
  RouterLink: { template: "<a><slot /></a>" },
}));

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    restaurantId: "shop-1",
    marketId: "market-1",
    isPrimary: true,
    joinedAt: 0,
    isOpenToday: false,
    openedAt: null,
    businessDate: "2026-09-28",
    market: { id: "market-1", slug: "fengjia", name: "逢甲夜市", type: "night_market", city: "台中市", district: "西屯區" },
    ...overrides,
  };
}

describe("MarketOpenTodayCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 10, role: 1 };
    authState.restaurantId = "shop-1";
  });

  it("opens the stall with one tap", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([membership()]);
    marketsService.setMarketOpenToday.mockResolvedValue({
      isOpenToday: true,
      openedAt: Date.now(),
      businessDate: "2026-09-28",
    });

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    const row = wrapper.find('[data-testid="market-open-market-1"]');
    expect(row.attributes("data-status")).toBe("closed");

    await wrapper
      .find('[data-testid="market-open-button-market-1"]')
      .trigger("click");
    await flushPromises();

    expect(marketsService.setMarketOpenToday).toHaveBeenCalledOnce();
    expect(marketsService.setMarketOpenToday).toHaveBeenCalledWith(
      "shop-1",
      "market-1",
      true,
    );
    expect(
      wrapper.find('[data-testid="market-open-market-1"]').attributes("data-status"),
    ).toBe("open");
  });

  it("asks before closing early", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([
      membership({ isOpenToday: true, openedAt: Date.now() }),
    ]);
    marketsService.setMarketOpenToday.mockResolvedValue({
      isOpenToday: false,
      openedAt: null,
      businessDate: "2026-09-28",
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    await wrapper
      .find('[data-testid="market-close-button-market-1"]')
      .trigger("click");

    expect(confirm).toHaveBeenCalledOnce();
    expect(marketsService.setMarketOpenToday).not.toHaveBeenCalled();
  });

  it("stays hidden for shops not in any market and for staff roles", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([]);
    const empty = mount(MarketOpenTodayCard);
    await flushPromises();
    expect(empty.find('[data-testid="market-open-today-card"]').exists()).toBe(false);

    authState.user = { id: 11, role: 4 };
    const cashier = mount(MarketOpenTodayCard);
    await flushPromises();
    expect(marketsService.listRestaurantMemberships).toHaveBeenCalledOnce();
    expect(cashier.find('[data-testid="market-open-today-card"]').exists()).toBe(false);
  });

  it("shows an error and keeps the state when opening fails", async () => {
    marketsService.listRestaurantMemberships.mockResolvedValue([membership()]);
    marketsService.setMarketOpenToday.mockRejectedValue(new Error("offline"));

    const wrapper = mount(MarketOpenTodayCard);
    await flushPromises();
    await wrapper
      .find('[data-testid="market-open-button-market-1"]')
      .trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toBe(
      "dashboard.marketOpenToday.error",
    );
    expect(
      wrapper.find('[data-testid="market-open-market-1"]').attributes("data-status"),
    ).toBe("closed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-dashboard exec vitest run src/components/dashboard/MarketOpenTodayCard.test.ts`
Expected: FAIL，找不到 `./MarketOpenTodayCard.vue`。

- [ ] **Step 3: Add the service call and types**

`marketsService.ts`：`RestaurantMarketMembership` 加：

```ts
  isOpenToday: boolean;
  openedAt: string | number | null;
  businessDate: string;
```

在檔內加 export interface：

```ts
export interface MarketVendorOpenState {
  isOpenToday: boolean;
  openedAt: string | number | null;
  businessDate: string;
}
```

`marketsService` 物件裡、`listRestaurantMemberships` 之後加：

```ts
  async setMarketOpenToday(
    restaurantId: string,
    marketId: string,
    open: boolean,
  ): Promise<MarketVendorOpenState> {
    const response = await api.post<MarketVendorOpenState>(
      `/restaurants/${restaurantId}/markets/${marketId}/${open ? "open" : "close"}`,
    );
    return unwrapApiPayload<MarketVendorOpenState>(response.data);
  },
```

- [ ] **Step 4: Write the component**

```vue
<!-- apps/admin-dashboard/src/components/dashboard/MarketOpenTodayCard.vue -->
<template>
  <section
    v-if="memberships.length > 0"
    data-testid="market-open-today-card"
    class="rounded-2xl bg-white p-6 shadow-ios-card"
    aria-labelledby="market-open-today-title"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2
          id="market-open-today-title"
          class="text-lg font-semibold text-ios-text"
        >
          {{ t("dashboard.marketOpenToday.title") }}
        </h2>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("dashboard.marketOpenToday.description") }}
        </p>
      </div>
      <RouterLink
        :to="{ name: 'MarketOpenReport' }"
        class="min-h-11 shrink-0 rounded-full px-3 py-2.5 text-sm font-medium text-ios-blue transition-colors duration-200 ease-out hover:bg-ios-bg"
      >
        {{ t("dashboard.marketOpenToday.report") }}
      </RouterLink>
    </div>
    <ul class="mt-4 space-y-3" role="list">
      <li
        v-for="membership in memberships"
        :key="membership.marketId"
        :data-testid="`market-open-${membership.marketId}`"
        :data-status="membership.isOpenToday ? 'open' : 'closed'"
        class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-3"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-ios-text">
            {{ membership.market.name }}
          </p>
          <p class="mt-0.5 text-xs text-ios-secondary">
            {{
              membership.isOpenToday
                ? t("dashboard.marketOpenToday.openSince", {
                    time: formatTime(membership.openedAt),
                  })
                : t("dashboard.marketOpenToday.closed")
            }}
          </p>
        </div>
        <button
          v-if="!membership.isOpenToday"
          :data-testid="`market-open-button-${membership.marketId}`"
          type="button"
          :disabled="pendingMarketId === membership.marketId"
          class="min-h-11 shrink-0 rounded-full bg-ios-blue px-5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-ios-blue/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue focus-visible:ring-offset-2 disabled:opacity-60"
          @click="setOpen(membership, true)"
        >
          {{ t("dashboard.marketOpenToday.open") }}
        </button>
        <button
          v-else
          :data-testid="`market-close-button-${membership.marketId}`"
          type="button"
          :disabled="pendingMarketId === membership.marketId"
          class="min-h-11 shrink-0 rounded-full px-4 text-sm font-medium text-ios-red transition-colors duration-200 ease-out hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-red disabled:opacity-60"
          @click="closeEarly(membership)"
        >
          {{ t("dashboard.marketOpenToday.close") }}
        </button>
      </li>
    </ul>
    <p v-if="hasError" role="alert" class="mt-3 text-sm text-ios-red">
      {{ t("dashboard.marketOpenToday.error") }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import {
  marketsService,
  type RestaurantMarketMembership,
} from "@/services/marketsService";

const OWNER_ROLE = 1;

const { t } = useI18n();
const authStore = useAuthStore();
const memberships = ref<RestaurantMarketMembership[]>([]);
const pendingMarketId = ref<string | null>(null);
const hasError = ref(false);

function formatTime(value: string | number | null) {
  if (value === null) return "";
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function setOpen(membership: RestaurantMarketMembership, open: boolean) {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;
  pendingMarketId.value = membership.marketId;
  hasError.value = false;
  try {
    const state = await marketsService.setMarketOpenToday(
      restaurantId,
      membership.marketId,
      open,
    );
    Object.assign(membership, state);
  } catch {
    hasError.value = true;
  } finally {
    pendingMarketId.value = null;
  }
}

function closeEarly(membership: RestaurantMarketMembership) {
  if (!window.confirm(t("dashboard.marketOpenToday.confirmClose"))) return;
  void setOpen(membership, false);
}

onMounted(async () => {
  const restaurantId = authStore.restaurantId;
  if (authStore.user?.role !== OWNER_ROLE || !restaurantId) return;
  try {
    memberships.value =
      await marketsService.listRestaurantMemberships(restaurantId);
  } catch {
    memberships.value = [];
  }
});
</script>
```

> 若 admin 的 `t` 不接受第二個參數物件，改用同檔 `RealtimeNotificationPanel.vue` 第 129 行的呼叫方式。`text-ios-red`、`shadow-ios-card` 若不是現有 token 名，照 `DESIGN.md` 換成對應 token。

- [ ] **Step 5: Mount the card and add strings**

`DashboardView.vue`：第 40 行 `<SetupChecklistCard />` 之後加 `<MarketOpenTodayCard />`；import 區第 296 行之後加 `import MarketOpenTodayCard from "@/components/dashboard/MarketOpenTodayCard.vue";`。

每個 admin locale 檔的 `dashboard` 物件裡（`setupChecklist` 旁）加 `marketOpenToday`：

| key | zh-TW | zh-CN | en-US |
|---|---|---|---|
| title | 今日營業 | 今日营业 | Open today |
| description | 每天開始營業時按一下，客人才會在商圈 QR 看到你的攤位 | 每天开始营业时按一下，顾客才会在商圈 QR 看到你的摊位 | Tap when you start trading so customers see your stall on the market QR |
| open | 今日開店 | 今日开店 | Open today |
| close | 提早收攤 | 提前收摊 | Close early |
| closed | 今日尚未開店 | 今日尚未开店 | Not open yet today |
| openSince | 營業中 · 自 {time} | 营业中 · 自 {time} | Open since {time} |
| confirmClose | 確定要收攤嗎？客人將無法再向你下單。 | 确定要收摊吗？顾客将无法再向你下单。 | Close now? Customers will not be able to order from you. |
| error | 更新營業狀態失敗，請再試一次 | 更新营业状态失败，请再试一次 | Could not update your status. Please try again. |
| report | 開店紀錄 | 开店记录 | Open-day report |

`ja-JP`、`vi-VN`、`id-ID` 先放 en-US 的文字，再跑 `pnpm i18n:export-handoff` 產出翻譯交接檔（沿用既有 i18n 交接流程）。

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter admin-dashboard exec vitest run src/components/dashboard/MarketOpenTodayCard.test.ts src/views/DashboardView.test.ts`
Expected: PASS。`DashboardView.test.ts` 若因新元件多打一次 API 而失敗，在該檔 `vi.mock("@/components/dashboard/MarketOpenTodayCard.vue", () => ({ default: { template: "<div />" } }))`。

- [ ] **Step 7: Commit**

```bash
git add apps/admin-dashboard/src/services/marketsService.ts apps/admin-dashboard/src/components/dashboard/MarketOpenTodayCard.vue apps/admin-dashboard/src/components/dashboard/MarketOpenTodayCard.test.ts apps/admin-dashboard/src/views/DashboardView.vue apps/admin-dashboard/src/i18n/locales
git commit -m "feat(admin): one-tap open-today card for market stalls"
```

---

### Task 9: 開店紀錄報表頁（店主與平台）

**Files:**
- Modify: `apps/admin-dashboard/src/services/marketsService.ts`（報表型別與兩個函式）
- Create: `apps/admin-dashboard/src/components/markets/MarketOpenReportPanel.vue`
- Create: `apps/admin-dashboard/src/components/markets/MarketOpenReportPanel.test.ts`
- Create: `apps/admin-dashboard/src/views/MarketOpenReportView.vue`
- Modify: `apps/admin-dashboard/src/router/index.ts`（`/` 的 children，`owner-overview` 之後）
- Modify: `apps/admin-dashboard/src/views/PlatformMarketsView.vue`（編輯中市集的區塊）
- Modify: `apps/admin-dashboard/src/views/SettingsView.vue`（`activeTab === 'markets'` 區塊的標題，約第 344 行）
- Modify: `apps/admin-dashboard/src/i18n/locales/*.ts`

**Interfaces:**
- Consumes: Task 6 的兩個報表端點；Task 8 的 `listRestaurantMemberships`
- Produces:
  - `type MarketOpenReportScope = { kind: "platform"; marketId: string } | { kind: "owner"; restaurantId: string; marketId: string }`
  - `marketsService.getMarketOpenReport(scope, range: { from: string; to: string }): Promise<MarketOpenReport>`
  - `marketsService.exportMarketOpenReportCsv(scope, range, view: "daily" | "summary"): Promise<Blob>`
  - `<MarketOpenReportPanel :scope="MarketOpenReportScope" />`
  - route `{ path: "market-open-report", name: "MarketOpenReport" }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin-dashboard/src/components/markets/MarketOpenReportPanel.test.ts
// @vitest-environment jsdom

import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MarketOpenReportPanel from "./MarketOpenReportPanel.vue";

const marketsService = vi.hoisted(() => ({
  getMarketOpenReport: vi.fn(),
  exportMarketOpenReportCsv: vi.fn(),
}));

vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("@/services/marketsService", () => ({ marketsService }));

const report = {
  market: { id: "market-1", name: "逢甲夜市", businessDayCutoffMinutes: 300 },
  from: "2026-09-22",
  to: "2026-09-28",
  daily: [
    {
      businessDate: "2026-09-25",
      restaurantId: "a",
      vendorName: "雞排攤",
      stallNumber: "A01",
      firstOpenedAtMs: Date.parse("2026-09-25T09:00:00Z"),
      lastClosedAtMs: Date.parse("2026-09-25T21:00:00Z"),
      autoClosed: true,
      openMinutes: 660,
      openedBy: "王老闆",
      orderCount: 2,
      revenueCents: 20000,
      currency: "TWD",
      offsetMinutes: 480,
    },
  ],
  summary: [
    {
      restaurantId: "a",
      vendorName: "雞排攤",
      stallNumber: "A01",
      openDays: 1,
      expectedDays: 2,
      attendanceRate: 0.5,
      avgOpenMinutes: 660,
      orderCount: 2,
      revenueCents: 20000,
      currency: "TWD",
    },
  ],
};

describe("MarketOpenReportPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    marketsService.getMarketOpenReport.mockResolvedValue(report);
  });

  it("loads the last seven days for the given scope", async () => {
    const scope = { kind: "platform" as const, marketId: "market-1" };
    const wrapper = mount(MarketOpenReportPanel, { props: { scope } });
    await flushPromises();

    expect(marketsService.getMarketOpenReport).toHaveBeenCalledOnce();
    expect(marketsService.getMarketOpenReport).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );
    const row = wrapper.find('[data-testid="open-report-daily-a-2026-09-25"]');
    expect(row.text()).toContain("雞排攤");
    expect(row.attributes("data-auto-closed")).toBe("true");
  });

  it("switches to the summary view", async () => {
    const wrapper = mount(MarketOpenReportPanel, {
      props: { scope: { kind: "platform", marketId: "market-1" } },
    });
    await flushPromises();
    await wrapper.find('[data-testid="open-report-view-summary"]').trigger("click");

    expect(
      wrapper.find('[data-testid="open-report-summary-a"]').text(),
    ).toContain("50%");
  });

  it("exports the current view as CSV", async () => {
    marketsService.exportMarketOpenReportCsv.mockResolvedValue(
      new Blob(["a,b"], { type: "text/csv" }),
    );
    URL.createObjectURL = vi.fn(() => "blob:report");
    URL.revokeObjectURL = vi.fn();
    const scope = { kind: "owner" as const, restaurantId: "shop-1", marketId: "market-1" };
    const wrapper = mount(MarketOpenReportPanel, { props: { scope } });
    await flushPromises();
    await wrapper.find('[data-testid="open-report-export"]').trigger("click");
    await flushPromises();

    expect(marketsService.exportMarketOpenReportCsv).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({ from: expect.any(String) }),
      "daily",
    );
  });

  it("shows the API's validation error instead of a table", async () => {
    marketsService.getMarketOpenReport.mockRejectedValue(new Error("bad range"));
    const wrapper = mount(MarketOpenReportPanel, {
      props: { scope: { kind: "platform", marketId: "market-1" } },
    });
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toBe("marketOpenReport.loadFailed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter admin-dashboard exec vitest run src/components/markets/MarketOpenReportPanel.test.ts`
Expected: FAIL，找不到元件。

- [ ] **Step 3: Add service functions and types**

在 `marketsService.ts` 加：

```ts
export type MarketOpenReportScope =
  | { kind: "platform"; marketId: string }
  | { kind: "owner"; restaurantId: string; marketId: string };

export interface MarketOpenReportDailyRow {
  businessDate: string;
  restaurantId: string;
  vendorName: string;
  stallNumber: string | null;
  firstOpenedAtMs: number | null;
  lastClosedAtMs: number | null;
  autoClosed: boolean;
  openMinutes: number;
  openedBy: string | null;
  orderCount: number;
  revenueCents: number;
  currency: string;
  offsetMinutes: number;
}

export interface MarketOpenReportSummaryRow {
  restaurantId: string;
  vendorName: string;
  stallNumber: string | null;
  openDays: number;
  expectedDays: number;
  attendanceRate: number | null;
  avgOpenMinutes: number;
  orderCount: number;
  revenueCents: number;
  currency: string;
}

export interface MarketOpenReport {
  market: { id: string; name: string; businessDayCutoffMinutes: number };
  from: string;
  to: string;
  daily: MarketOpenReportDailyRow[];
  summary: MarketOpenReportSummaryRow[];
}

function openReportPath(scope: MarketOpenReportScope) {
  return scope.kind === "platform"
    ? `/admin/markets/${scope.marketId}/open-report`
    : `/restaurants/${scope.restaurantId}/markets/${scope.marketId}/open-report`;
}
```

`marketsService` 物件裡加：

```ts
  async getMarketOpenReport(
    scope: MarketOpenReportScope,
    range: { from: string; to: string },
  ): Promise<MarketOpenReport> {
    const response = await api.get<MarketOpenReport>(openReportPath(scope), range);
    return unwrapApiPayload<MarketOpenReport>(response.data);
  },

  async exportMarketOpenReportCsv(
    scope: MarketOpenReportScope,
    range: { from: string; to: string },
    view: "daily" | "summary",
  ): Promise<Blob> {
    const response = await api.instance.get<Blob>(openReportPath(scope), {
      params: { ...range, view, format: "csv" },
      responseType: "blob",
    });
    return response.data;
  },
```

- [ ] **Step 4: Write the panel**

```vue
<!-- apps/admin-dashboard/src/components/markets/MarketOpenReportPanel.vue -->
<template>
  <section class="rounded-2xl bg-white p-6 shadow-ios-card" aria-labelledby="open-report-title">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <h2 id="open-report-title" class="text-lg font-semibold text-ios-text">
        {{ t("marketOpenReport.title") }}
      </h2>
      <div class="flex flex-wrap items-end gap-3">
        <label class="text-sm text-ios-secondary">
          {{ t("marketOpenReport.from") }}
          <input v-model="from" type="date" data-testid="open-report-from" class="mt-1 block rounded-full bg-ios-bg px-4 py-2 text-sm text-ios-text" @change="load" />
        </label>
        <label class="text-sm text-ios-secondary">
          {{ t("marketOpenReport.to") }}
          <input v-model="to" type="date" data-testid="open-report-to" class="mt-1 block rounded-full bg-ios-bg px-4 py-2 text-sm text-ios-text" @change="load" />
        </label>
        <div class="flex rounded-full bg-ios-bg p-1" role="tablist">
          <button
            v-for="option in views"
            :key="option"
            type="button"
            role="tab"
            :aria-selected="view === option"
            :data-testid="`open-report-view-${option}`"
            class="min-h-9 rounded-full px-4 text-sm font-medium transition-colors duration-200 ease-out"
            :class="view === option ? 'bg-white text-ios-text shadow-ios-card' : 'text-ios-secondary'"
            @click="view = option"
          >
            {{ t(`marketOpenReport.view.${option}`) }}
          </button>
        </div>
        <button
          type="button"
          data-testid="open-report-export"
          :disabled="!report"
          class="min-h-11 rounded-full bg-ios-blue px-5 text-sm font-semibold text-white transition-colors duration-200 ease-out hover:bg-ios-blue/90 disabled:opacity-60"
          @click="exportCsv"
        >
          {{ t("marketOpenReport.export") }}
        </button>
      </div>
    </div>

    <p v-if="loadFailed" role="alert" class="mt-4 text-sm text-ios-red">
      {{ t("marketOpenReport.loadFailed") }}
    </p>

    <div v-else-if="report" class="mt-4 overflow-x-auto">
      <table v-if="view === 'daily'" class="w-full text-left text-sm">
        <thead class="text-xs text-ios-secondary">
          <tr>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.date") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.vendor") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.opened") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.closed") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.hours") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.openedBy") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.orders") }}</th>
            <th class="py-2">{{ t("marketOpenReport.col.revenue") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in report.daily"
            :key="`${row.restaurantId}-${row.businessDate}`"
            :data-testid="`open-report-daily-${row.restaurantId}-${row.businessDate}`"
            :data-auto-closed="String(row.autoClosed)"
          >
            <td class="py-2 pr-4">{{ row.businessDate }}</td>
            <td class="py-2 pr-4">{{ vendorLabel(row) }}</td>
            <td class="py-2 pr-4">{{ localTime(row.firstOpenedAtMs, row.offsetMinutes) }}</td>
            <td class="py-2 pr-4">
              {{ localTime(row.lastClosedAtMs, row.offsetMinutes) }}
              <span v-if="row.autoClosed" class="ml-1 text-xs text-ios-secondary">{{ t("marketOpenReport.autoClosed") }}</span>
            </td>
            <td class="py-2 pr-4">{{ hours(row.openMinutes) }}</td>
            <td class="py-2 pr-4">{{ row.openedBy ?? "" }}</td>
            <td class="py-2 pr-4">{{ row.orderCount }}</td>
            <td class="py-2">{{ money(row.revenueCents, row.currency) }}</td>
          </tr>
        </tbody>
      </table>

      <table v-else class="w-full text-left text-sm">
        <thead class="text-xs text-ios-secondary">
          <tr>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.vendor") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.openDays") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.attendance") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.avgHours") }}</th>
            <th class="py-2 pr-4">{{ t("marketOpenReport.col.orders") }}</th>
            <th class="py-2">{{ t("marketOpenReport.col.revenue") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in report.summary"
            :key="row.restaurantId"
            :data-testid="`open-report-summary-${row.restaurantId}`"
          >
            <td class="py-2 pr-4">{{ vendorLabel(row) }}</td>
            <td class="py-2 pr-4">{{ row.openDays }} / {{ row.expectedDays }}</td>
            <td class="py-2 pr-4">{{ row.attendanceRate === null ? "—" : `${Math.round(row.attendanceRate * 100)}%` }}</td>
            <td class="py-2 pr-4">{{ hours(row.avgOpenMinutes) }}</td>
            <td class="py-2 pr-4">{{ row.orderCount }}</td>
            <td class="py-2">{{ money(row.revenueCents, row.currency) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { formatCurrency } from "@makanmasak/utils";
import { useI18n } from "@/i18n";
import {
  marketsService,
  type MarketOpenReport,
  type MarketOpenReportScope,
} from "@/services/marketsService";

const props = defineProps<{ scope: MarketOpenReportScope }>();

const { t } = useI18n();
const views = ["daily", "summary"] as const;
const view = ref<(typeof views)[number]>("daily");
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const from = ref(isoDay(-6));
const to = ref(isoDay(0));
const report = ref<MarketOpenReport | null>(null);
const loadFailed = ref(false);

async function load() {
  loadFailed.value = false;
  try {
    report.value = await marketsService.getMarketOpenReport(props.scope, {
      from: from.value,
      to: to.value,
    });
  } catch {
    report.value = null;
    loadFailed.value = true;
  }
}

async function exportCsv() {
  const blob = await marketsService.exportMarketOpenReportCsv(
    props.scope,
    { from: from.value, to: to.value },
    view.value,
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `market-open-report-${view.value}-${from.value}-${to.value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function vendorLabel(row: { vendorName: string; stallNumber: string | null }) {
  return row.stallNumber ? `${row.stallNumber} ${row.vendorName}` : row.vendorName;
}

function localTime(ms: number | null, offsetMinutes: number) {
  if (ms === null) return "";
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(11, 16);
}

function hours(minutes: number) {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function money(cents: number, currency: string) {
  return formatCurrency(cents / 100, currency);
}

onMounted(load);
watch(() => props.scope, load, { deep: true });
</script>
```

> 若 `formatCurrency` 的簽章不是 `(major, currency)`，改用 `apps/admin-dashboard/src/composables/useCurrency.ts` 匯出的格式化函式。

- [ ] **Step 5: Owner view, route, and entry points**

```vue
<!-- apps/admin-dashboard/src/views/MarketOpenReportView.vue -->
<template>
  <div class="space-y-6">
    <h1 class="text-2xl font-semibold text-ios-text">
      {{ t("marketOpenReport.pageTitle") }}
    </h1>
    <label v-if="memberships.length > 1" class="block text-sm text-ios-secondary">
      {{ t("marketOpenReport.market") }}
      <select v-model="marketId" data-testid="open-report-market" class="mt-1 block rounded-full bg-white px-4 py-2 text-sm text-ios-text shadow-ios-card">
        <option v-for="m in memberships" :key="m.marketId" :value="m.marketId">
          {{ m.market.name }}
        </option>
      </select>
    </label>
    <MarketOpenReportPanel
      v-if="scope"
      :scope="scope"
    />
    <p v-else-if="loaded" class="text-sm text-ios-secondary">
      {{ t("marketOpenReport.noMarkets") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import MarketOpenReportPanel from "@/components/markets/MarketOpenReportPanel.vue";
import {
  marketsService,
  type RestaurantMarketMembership,
} from "@/services/marketsService";

const { t } = useI18n();
const authStore = useAuthStore();
const memberships = ref<RestaurantMarketMembership[]>([]);
const marketId = ref("");
const loaded = ref(false);

const scope = computed(() =>
  authStore.restaurantId && marketId.value
    ? {
        kind: "owner" as const,
        restaurantId: authStore.restaurantId,
        marketId: marketId.value,
      }
    : null,
);

onMounted(async () => {
  if (authStore.restaurantId) {
    memberships.value = await marketsService
      .listRestaurantMemberships(authStore.restaurantId)
      .catch(() => []);
    marketId.value = memberships.value[0]?.marketId ?? "";
  }
  loaded.value = true;
});
</script>
```

`router/index.ts`，`owner-overview` 路由之後加：

```ts
      {
        path: "market-open-report",
        name: "MarketOpenReport",
        component: () => import("@/views/MarketOpenReportView.vue"),
        meta: {
          titleKey: "pages.marketOpenReport",
          roles: [UserRole.ADMIN, UserRole.OWNER],
        },
      },
```

`PlatformMarketsView.vue`：在編輯中市集（`editingMarket`）的詳情區塊最後加：

```vue
        <MarketOpenReportPanel
          v-if="editingMarket"
          :scope="{ kind: 'platform', marketId: editingMarket.id }"
        />
```

並 import 元件。

`SettingsView.vue`：在 `settings.markets.title` 標題旁加：

```vue
            <RouterLink
              :to="{ name: 'MarketOpenReport' }"
              class="rounded-full px-3 py-2 text-sm font-medium text-ios-blue hover:bg-ios-bg"
            >
              {{ t("dashboard.marketOpenToday.report") }}
            </RouterLink>
```

（`RouterLink` 若該檔未 import，從 `vue-router` import。）

- [ ] **Step 6: Add strings**

每個 admin locale 加 `pages.marketOpenReport` 與頂層 `marketOpenReport`：

| key | zh-TW | zh-CN | en-US |
|---|---|---|---|
| pages.marketOpenReport | 開店紀錄 | 开店记录 | Open-day report |
| marketOpenReport.pageTitle | 開店紀錄 | 开店记录 | Open-day report |
| marketOpenReport.title | 開店紀錄報表 | 开店记录报表 | Stall open-day report |
| marketOpenReport.market | 商圈 | 商圈 | Market |
| marketOpenReport.from | 開始日期 | 开始日期 | From |
| marketOpenReport.to | 結束日期 | 结束日期 | To |
| marketOpenReport.view.daily | 每日明細 | 每日明细 | Daily |
| marketOpenReport.view.summary | 期間彙總 | 期间汇总 | Summary |
| marketOpenReport.export | 匯出 CSV | 导出 CSV | Export CSV |
| marketOpenReport.loadFailed | 無法載入報表，請確認日期區間（最多 92 天） | 无法载入报表，请确认日期区间（最多 92 天） | Could not load the report. Check the date range (92 days max). |
| marketOpenReport.noMarkets | 你的店尚未加入任何商圈 | 你的店尚未加入任何商圈 | Your shop is not in any market yet |
| marketOpenReport.autoClosed | 換日自動結束 | 换日自动结束 | Ended at day rollover |
| marketOpenReport.col.date | 營業日 | 营业日 | Business day |
| marketOpenReport.col.vendor | 攤位 | 摊位 | Stall |
| marketOpenReport.col.opened | 開店 | 开店 | Opened |
| marketOpenReport.col.closed | 收攤 | 收摊 | Closed |
| marketOpenReport.col.hours | 營業時長 | 营业时长 | Hours open |
| marketOpenReport.col.openedBy | 操作者 | 操作者 | Opened by |
| marketOpenReport.col.orders | 訂單數 | 订单数 | Orders |
| marketOpenReport.col.revenue | 營業額 | 营业额 | Revenue |
| marketOpenReport.col.openDays | 開店天數 | 开店天数 | Days open |
| marketOpenReport.col.attendance | 出勤率 | 出勤率 | Attendance |
| marketOpenReport.col.avgHours | 平均營業時長 | 平均营业时长 | Avg hours open |

`ja-JP`、`vi-VN`、`id-ID` 先放 en-US 文字，跑 `pnpm i18n:export-handoff`。

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter admin-dashboard exec vitest run src/components/markets/MarketOpenReportPanel.test.ts src/views/PlatformMarketsView.test.ts src/views/SettingsView.test.ts`
Expected: PASS。`PlatformMarketsView.test.ts` 若因新 panel 多打 API 而失敗，在該檔 mock `@/components/markets/MarketOpenReportPanel.vue` 為空元件。

- [ ] **Step 8: Commit**

```bash
git add apps/admin-dashboard/src
git commit -m "feat(admin): market stall open-day report for owners and platform"
```

> commit 前 `git status`，只 stage 本任務的檔案。

---

### Task 10: 客人端灰色顯示與結帳錯誤處理

**Files:**
- Modify: `apps/customer-app/src/components/markets/VendorListInMarket.vue`（第 147–165 行的按鈕）
- Modify: `apps/customer-app/src/components/markets/StallMapInMarket.vue`（第 129–140 行的攤位按鈕）
- Modify: `apps/customer-app/src/views/MarketDetailView.vue`（`openVendor` 第 846 行、`submitMarketCheckout` 第 1046 行）
- Modify: `apps/customer-app/src/stores/marketCart.ts`（新增 `removeVendor`）
- Modify: `apps/customer-app/src/tests/components/vendor-list-in-market.test.ts`
- Modify: `apps/customer-app/src/tests/stores/market-cart.test.ts`
- Modify: `packages/shared/src/i18n/src/locales/*/customer.json`（6 個語系）

**Interfaces:**
- Consumes: `GET /markets/:slug/vendors` 的 `isOpen`（Task 4）；結帳 409 `VENDOR_NOT_OPEN_TODAY` 的 `details.restaurantIds`
- Produces: `marketCartStore.removeVendor(marketSlug: string, restaurantId: string): void`

- [ ] **Step 1: Write the failing tests**

`vendor-list-in-market.test.ts` 加：

```ts
  it("greys out a stall that has not opened today and blocks its menu", async () => {
    const wrapper = mount(VendorListInMarket, {
      props: {
        vendors: [vendor({ isOpen: false })],
        loading: false,
        query: "",
        takeawayOnly: false,
        deliveryOnly: false,
        hasMore: false,
      },
    });

    const card = wrapper.find('[data-testid="market-vendor-restaurant-1"]');
    expect(card.attributes("data-status")).toBe("closed-today");
    expect(card.text()).toContain("markets.vendors.notOpenToday");
    const menuButton = wrapper.find('[data-testid="open-vendor-menu-restaurant-1"]');
    expect(menuButton.attributes("disabled")).toBeDefined();
    await menuButton.trigger("click");
    expect(wrapper.emitted("selectVendor")).toBeUndefined();
  });
```

> props 以同檔第一個測試傳的為準；卡片容器若已有 `data-testid`，用既有的，並在其上加 `data-status`。

`market-cart.test.ts` 加：

```ts
  it("removes one vendor's items from a market cart", () => {
    const store = useMarketCartStore();
    // Build a cart with two vendors using this file's existing addItem helper.
    addTwoVendorItems(store, "fengjia");

    store.removeVendor("fengjia", "vendor-a");

    expect(
      store.cartForMarket("fengjia")?.vendors.map((v) => v.restaurantId),
    ).toEqual(["vendor-b"]);
  });
```

> `addTwoVendorItems`：用同檔既有的 `addItem` 呼叫方式，對 `vendor-a`、`vendor-b` 各加一項；若檔內沒有 helper，就在這個測試裡直接呼叫兩次 `store.addItem(...)`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter customer-app exec vitest run src/tests/components/vendor-list-in-market.test.ts src/tests/stores/market-cart.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the list and map**

`VendorListInMarket.vue`：
- 攤位卡片容器加 `:data-status="vendor.isOpen ? 'open' : 'closed-today'"`，未開店時加 `opacity-60`（用 `:class`）。
- 在攤位名稱區塊下方加：

```vue
          <span
            v-if="!vendor.isOpen"
            class="mt-1 inline-block rounded-full bg-ios-bg px-2 py-0.5 text-xs font-medium text-ios-secondary"
          >
            {{ t("markets.vendors.notOpenToday") }}
          </span>
```

- 「看菜單」按鈕的 `:disabled` 改成 `!vendor.isOpen || vendor.availableMenuItemCount <= 0`；「看服務」按鈕同樣加上 `!vendor.isOpen ||`。「聯絡攤位」不變。

`StallMapInMarket.vue`：攤位按鈕加 `:disabled="!vendor.isOpen"` 與 `:data-status="vendor.isOpen ? 'open' : 'closed-today'"`；右上角狀態字樣在未開店時改用 `t("markets.vendors.notOpenToday")`。

- [ ] **Step 4: Guard navigation and handle the checkout error**

`MarketDetailView.vue` 的 `openVendor`：

```ts
function openVendor(vendor: { restaurantId: string; isOpen?: boolean }) {
  const listed = store.vendors.find(
    (entry) => entry.restaurantId === vendor.restaurantId,
  );
  if ((vendor.isOpen ?? listed?.isOpen) === false) {
    toast.info(t("markets.vendors.notOpenToday"));
    return;
  }
  router.push({
    name: "ShopMenu",
    params: { restaurantId: vendor.restaurantId },
    query: marketReturnQuery(),
  });
}
```

（`toast.info` 若不存在，用該檔已在用的 `toast.error`。）

`submitMarketCheckout` 的 `catch`：

```ts
  } catch (error) {
    console.error("Market checkout failed:", error);
    const { code } = parseUserFacingError(error);
    if (code === "VENDOR_NOT_OPEN_TODAY" && marketCart.value) {
      const closedIds = closedVendorIdsFrom(error);
      for (const restaurantId of closedIds) {
        marketCartStore.removeVendor(marketCart.value.marketSlug, restaurantId);
      }
      toast.error(t("markets.detail.vendorNotOpenToday"));
      return;
    }
    toast.error(t("markets.detail.checkoutFailed"));
  } finally {
```

檔內加 helper，並從 `@makanmasak/shared/utils/user-facing-error` import `parseUserFacingError`：

```ts
function closedVendorIdsFrom(error: unknown): string[] {
  const details = (
    error as { response?: { data?: { error?: { details?: unknown } } } }
  )?.response?.data?.error?.details as { restaurantIds?: unknown } | undefined;
  return Array.isArray(details?.restaurantIds)
    ? details.restaurantIds.filter((id): id is string => typeof id === "string")
    : [];
}
```

`marketCart.ts` 的 `clearMarket` 之前加：

```ts
  function removeVendor(marketSlug: string, restaurantId: string) {
    const cart = carts.value[marketSlug];
    if (!cart) return;
    cart.vendors = cart.vendors.filter(
      (entry) => entry.restaurantId !== restaurantId,
    );
    cart.updatedAt = Date.now();
    saveCarts();
  }
```

並加進 store 的 return 物件。

- [ ] **Step 5: Add strings**

`packages/shared/src/i18n/src/locales/*/customer.json`：`markets.vendors` 加 `notOpenToday`，`markets.detail` 加 `vendorNotOpenToday`。

| key | zh-TW | zh-CN | en-US |
|---|---|---|---|
| markets.vendors.notOpenToday | 今日未營業 | 今日未营业 | Not open today |
| markets.detail.vendorNotOpenToday | 有攤位今天還沒開店，已從購物車移除，請確認後再結帳 | 有摊位今天还没开店，已从购物车移除，请确认后再结账 | A stall in your cart is not open today and was removed. Please review and check out again. |

`ms-MY`、`vi-VN`、`id-ID` 先放 en-US 文字，跑 `pnpm i18n:export-handoff`。

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter customer-app exec vitest run src/tests/components/vendor-list-in-market.test.ts src/tests/stores/market-cart.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/customer-app/src packages/shared/src/i18n/src/locales
git commit -m "feat(customer): grey out market stalls not open today"
```

> commit 前 `git status`，只 stage 本任務的檔案。

---

### Task 11: 全域驗證

- [ ] **Step 1: Run the full gate**

Run: `pnpm verify:push`
Expected: 全部通過（含 prettier、i18n coverage、`check:design-palette`、`check:strict-tables`、`check:migration-dual-track`、real integrations）。失敗就回到對應任務修，不要用 skip。

- [ ] **Step 2: Manual smoke test（本機）**

```bash
pnpm db:migrate:local
pnpm dev
```

1. 用店主帳號登入 admin（:3001），首頁看到「今日營業」卡片，按「今日開店」。
2. 用 customer app（:3000）開 `/markets/<slug>`：該攤位顯示營業、可點；其他攤位灰色「今日未營業」、不可點。
3. 回 admin 按「提早收攤」，客人端重新整理後該攤位變灰。
4. 打開「開店紀錄」頁，看到今天一列，匯出 CSV 內容正確。

- [ ] **Step 3: Production rollout note**

正式環境套用 0034 依 CLAUDE.md「Before applying anything to production D1 by hand」流程：先在 schema copy 上重放、確認 `market_vendor_open_events` 是 STRICT，再 `pnpm db:migrate:prod`。上線當下**所有攤位都是未開店**，要事先通知商圈店家每天按「今日開店」。
