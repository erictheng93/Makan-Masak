# 入駐地區與市集歸屬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓店主在入駐時選定「國家 → 城市 → 市集（選填）」，並以此決定新店的幣別與時區，同時把市集歸屬走既有的入駐申請核准流程。

**Architecture:** 國別是唯一的衍生來源。申請表存 `country_code`，開通時由它推導 `settings.currency` 與 `restaurants.timezone`，並在 `restaurants` 上留一個可查詢的 `country_code` 欄位供日後政策鎖定。市集選擇只產生 `market_join_requests`（待核准），店家先以獨立店開通，核准後才成為 `restaurant_market_memberships`。

**Tech Stack:** Cloudflare Workers (Hono) + D1 + Drizzle、Vue 3 + Vite、vitest（單元與 real D1 整合）、wrangler。

**Spec:** 本檔自足；背景決策見本節下方「決策紀錄」。

## 實作交付（2026-09-21）

Task 2–12 已實作並分別提交；Task 1 沿用已試跑版本。
實測與差異詳見 [稽核紀錄](../reviews/2026-09-21-onboarding-locale-and-market.md)。
下方 task 範例保留原規劃以供比對；實際平台 migration 使用 **0028**，
因 `0027_guest_coupon_identity.sql` 已占用 0027。Production 回填仍屬部署步驟，尚未執行。

## 決策紀錄（已定案，實作時不要再翻案）

1. **只開放台灣與馬來西亞**（`TW`、`MY`）。程式支援的幣別有 TWD／MYR／VND，但 VND 不在這次的下拉選單裡——列出沒有對應金流與發票支援的國家會給店主錯誤期待。
2. **國家與城市都用下拉**，城市依國家帶出。市集下拉依「國家＋城市」過濾。
3. **市集為選填**，且必須有一個明確的「我是獨立店面」選項，不能留白判定。
4. **自助入駐選了市集，核准前店家照常開通**，先以獨立店營運，不讓審核卡住做生意。
5. **平台協助入駐可當場核准**市集歸屬（平台團隊本來就確認過）。
6. **幣別在開通時由國別決定，之後不可在一般設定畫面改**（見 Task 7 的守門）。

## Global Constraints

- 金額一律以整數 cents 儲存（主幣 ×100，不分幣別）；幣別精度見 `packages/utils/src/currency.ts`（TWD/VND step 100、MYR step 1）。
- 幣別一律由伺服器判定，客戶端傳來的只能比對。既有工具：`apps/api/src/shared/utils/restaurant-currency.ts`。
- 新表必須 `STRICT`；migration 手寫、循序編號；平台軌下一號是 **0027**（0025、0026 已用），控制面軌下一號是 **0014**。
- 每個新 migration 都要在 `packages/database/migration-dual-track.json` 加一筆（平台軌）並跑 `pnpm check:migration-dual-track`、`pnpm check:strict-tables`。
- 所有 UI 字串要進六個語系；UI 依 `DESIGN.md` 與 `docs/UIUX-design-system.md`，`pnpm check:design-palette` 必須綠。
- `apps/api` 的 `typecheck` 會跑 **兩個** tsconfig（`tsconfig.json` 與 `tsconfig.test.json`）。只跑前者會漏掉測試檔的型別錯誤——CI 兩個都跑。
- 覆蓋率門檻在 `apps/api/src/features/**`：lines 90%／branches 78%，且 **real-integration 測試不計入**，新分支要有單元測試。
- 單檔 real D1 測試跑法：`cd apps/api && pnpm exec vitest run --config vitest.real-integration.config.ts <substring>`（必須在 app 目錄內，根目錄找不到 config）。
- 驗證指令不要接 `| tail` 或 `| grep` 收尾，退出碼會被吃掉。
- 動到任何套件的測試設定後，跑 `pnpm check:single-test-runner`：多一份 vitest 實例會讓整個測試套件隨機在啟動時整批失敗（CLAUDE.md 有記）。Task 1 的試跑已確認新增設定後仍是單一實例。

---

## 檔案結構

| 檔案 | 責任 |
| --- | --- |
| `packages/shared-types/src/locale.ts`（新） | 唯一的國別事實來源：`SupportedCountryCode`、幣別／時區／電話前綴對照、城市清單 |
| `packages/database/migrations_fresh/0027_restaurant_country_code.sql`（新） | `restaurants` 加 `country_code` |
| `packages/database/src/schema/restaurants.ts`（改） | 對應的 Drizzle 欄位 |
| `apps/management-api/migrations/0014_onboarding_locale_and_market.sql`（新） | `onboarding_applications` 加 `country_code`、`market_id`、`stall_number` |
| `apps/management-api/src/routes/onboarding.ts`（改） | 申請表驗證與寫入 |
| `apps/management-api/src/routes/markets.ts`（改） | 把回空陣列的樁換成真的讀 `PLATFORM_DB` |
| `apps/management-api/src/services/OnboardingService.ts`（改） | 開通時寫入 country／currency／timezone，並建立市集入駐申請 |
| `apps/onboarding-app/src/views/ApplyView.vue`（改） | 三層下拉 |
| `apps/admin-dashboard/src/views/PlatformOnboardingApplicationsView.vue`（改） | 審核畫面顯示國別與市集，平台協助可當場核准 |
| `apps/api/src/features/markets/services/MarketsService.ts`（改） | 核准入駐時的幣別一致性守門 |

---

### Task 1：國別事實來源（`packages/shared-types`）

> **已由我試跑完成**（commit `a1aecec2`），作為這份規劃可執行性的驗證。實作時
> 可直接跳過，或拿來比對。試跑發現兩件規劃原本漏掉的事，已補進下面的步驟：
> `packages/shared-types` 完全沒有測試環境，而 `SUPPORTED_COUNTRIES` 是
> readonly tuple，`toEqual` 前要展開成陣列。

**Files:**
- Create: `packages/shared-types/src/locale.ts`
- Create: `packages/shared-types/vitest.config.ts`
- Modify: `packages/shared-types/src/index.ts`、`packages/shared-types/package.json`
- Test: `packages/shared-types/src/locale.test.ts`

**Interfaces:**
- Produces:
  - `type SupportedCountryCode = "TW" | "MY"`
  - `const SUPPORTED_COUNTRIES: readonly SupportedCountryCode[]`
  - `interface CountryProfile { countryCode: SupportedCountryCode; currency: "TWD" | "MYR"; timezone: "Asia/Taipei" | "Asia/Kuala_Lumpur"; phonePrefix: string; cities: readonly string[] }`
  - `const COUNTRY_PROFILES: Record<SupportedCountryCode, CountryProfile>`
  - `function normalizeCountryCode(value: unknown): SupportedCountryCode | null`
  - `function citiesForCountry(country: SupportedCountryCode): readonly string[]`

為什麼放 `shared-types`：`apps/api`、`apps/management-api`、三個前端都要用同一份對照，而它只是常數與純函式，沒有執行期相依。

`timezone` 的值**必須**落在 `packages/database/src/utils/business-timezone.ts` 的 `BUSINESS_TIMEZONE_OFFSET_MINUTES` 裡（目前含 `Asia/Taipei`、`Asia/Kuala_Lumpur`），否則營業日切分會炸。

城市清單：台灣用 22 個縣市，馬來西亞用 13 州＋3 個聯邦直轄區。清單寫死在這支檔案，不查資料庫——城市是政策鎖定的維度，要能被型別檢查。

- [ ] **Step 0：先給這個套件一個測試環境**

`packages/shared-types` 目前沒有任何測試、沒有 `vitest.config.ts`、`package.json`
也沒有 `test` script。缺了設定，vitest 會往上找到根設定並把 `projects` 解析到
錯的目錄（CLAUDE.md 記載 `packages/database` 就是這樣壞過）。

```ts
// packages/shared-types/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";
import { sharedTestConfig } from "../../vitest.shared";

export default defineConfig({
  test: {
    ...sharedTestConfig,
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["node_modules/", "dist/"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

`sharedTestConfig` 的展開是必要的，`scripts/check-package-test-scripts.cjs`
會檢查；`test` 必須是單發的 `vitest run`（`vitest` 是 watch 模式，會讓 turbo 永遠卡住）：

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 1：先寫會失敗的測試**

```ts
// packages/shared-types/src/locale.test.ts
import { describe, expect, it } from "vitest";
import {
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  citiesForCountry,
  normalizeCountryCode,
} from "./locale";

describe("COUNTRY_PROFILES", () => {
  it("maps each supported country to its currency and timezone", () => {
    expect(COUNTRY_PROFILES.TW).toMatchObject({
      currency: "TWD",
      timezone: "Asia/Taipei",
      phonePrefix: "+886",
    });
    expect(COUNTRY_PROFILES.MY).toMatchObject({
      currency: "MYR",
      timezone: "Asia/Kuala_Lumpur",
      phonePrefix: "+60",
    });
  });

  it("only offers countries the platform can actually settle", () => {
    // VND is a supported currency but no Vietnamese payment or invoice
    // support exists, so it must not appear in the onboarding dropdown.
    // readonly tuple 要展開，否則 toEqual 比不過
    expect([...SUPPORTED_COUNTRIES]).toEqual(["TW", "MY"]);
  });

  it("gives every country a non-empty city list with no duplicates", () => {
    for (const country of SUPPORTED_COUNTRIES) {
      const cities = citiesForCountry(country);
      expect(cities.length).toBeGreaterThan(0);
      expect(new Set(cities).size).toBe(cities.length);
    }
  });

  it("includes the cities production already uses", () => {
    expect(citiesForCountry("TW")).toContain("台中市");
    expect(citiesForCountry("MY")).toContain("Kuala Lumpur");
  });
});

describe("normalizeCountryCode", () => {
  it.each([
    ["TW", "TW"],
    [" my ", "MY"],
    ["tw", "TW"],
    ["VN", null],
    ["", null],
    [undefined, null],
    [60, null],
  ])("narrows %p to %p", (input, expected) => {
    expect(normalizeCountryCode(input)).toBe(expected);
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd packages/shared-types && pnpm exec vitest run src/locale.test.ts`
Expected: FAIL，`Cannot find module './locale'`

- [ ] **Step 3：實作**

```ts
// packages/shared-types/src/locale.ts
/**
 * 入駐時選定的國別，是這家店所有地區性預設值的唯一來源。
 *
 * 開通前沒有任何地方決定一家店在哪裡：provisioning 把 city 寫死成「台中市」，
 * 也完全不寫 settings，於是幣別靠預設值落回 TWD、時區留空。國別一旦在申請
 * 表選定，幣別、時區、電話前綴、可用金流、發票制度就都有了依據。
 */
export type SupportedCountryCode = "TW" | "MY";

export const SUPPORTED_COUNTRIES = [
  "TW",
  "MY",
] as const satisfies readonly SupportedCountryCode[];

export interface CountryProfile {
  countryCode: SupportedCountryCode;
  /** 必須是 packages/utils/src/currency.ts 的 CurrencyCode */
  currency: "TWD" | "MYR";
  /** 必須是 business-timezone.ts 支援的固定時區 */
  timezone: "Asia/Taipei" | "Asia/Kuala_Lumpur";
  phonePrefix: string;
  cities: readonly string[];
}

const TW_CITIES = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
  // production 既有資料用的是「台中市」（異體字），保留以免既有店家對不上。
  "台中市",
] as const;

const MY_CITIES = [
  "Kuala Lumpur", "Putrajaya", "Labuan",
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan",
  "Pahang", "Perak", "Perlis", "Penang", "Sabah", "Sarawak",
  "Selangor", "Terengganu",
] as const;

export const COUNTRY_PROFILES: Record<SupportedCountryCode, CountryProfile> = {
  TW: {
    countryCode: "TW",
    currency: "TWD",
    timezone: "Asia/Taipei",
    phonePrefix: "+886",
    cities: TW_CITIES,
  },
  MY: {
    countryCode: "MY",
    currency: "MYR",
    timezone: "Asia/Kuala_Lumpur",
    phonePrefix: "+60",
    cities: MY_CITIES,
  },
};

/** 把不可信的值收斂成支援的國別，不支援就回 null（呼叫端決定要擋還是套預設）。 */
export const normalizeCountryCode = (
  value: unknown,
): SupportedCountryCode | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(code)
    ? (code as SupportedCountryCode)
    : null;
};

export const citiesForCountry = (
  country: SupportedCountryCode,
): readonly string[] => COUNTRY_PROFILES[country].cities;
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd packages/shared-types && pnpm exec vitest run src/locale.test.ts`
Expected: PASS

- [ ] **Step 5：從 index 匯出並 commit**

在 `packages/shared-types/src/index.ts` 加上：

```ts
export {
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  citiesForCountry,
  normalizeCountryCode,
  type CountryProfile,
  type SupportedCountryCode,
} from "./locale";
```

```bash
git add packages/shared-types
git commit -m "feat(shared-types): make the onboarding country the source of locale defaults"
```

驗收（試跑實測值）：`pnpm exec vitest run src/locale.test.ts` → 11 passed；
`pnpm run typecheck` → exit 0；`node scripts/check-package-test-scripts.cjs`、
`pnpm check:single-test-runner` 皆 OK。

---

### Task 2：`restaurants.country_code` 欄位

**Files:**
- Create: `packages/database/migrations_fresh/0027_restaurant_country_code.sql`
- Modify: `packages/database/src/schema/restaurants.ts`、`packages/database/migration-dual-track.json`
- Test: `packages/database/src/schema/schema-hardening.test.ts`（既有檔，加一個案例）

**Interfaces:**
- Consumes: Task 1 的 `SupportedCountryCode`
- Produces: `restaurants.countryCode`（Drizzle 欄位，`text("country_code")`，可為 null）

為什麼是真欄位而不是塞進 `settings` JSON：政策鎖定要能 `WHERE country_code = 'MY'` 並建索引，`json_extract` 在這種查詢上很難受。幣別**仍然**留在 `settings.currency`（既有程式全靠它），由開通流程依國別寫入。

欄位允許 null：既有兩家店在 Task 8 補資料之前是 null，讀取端一律把 null 當「未知」而非「台灣」。

- [ ] **Step 1：寫 migration**

```sql
-- packages/database/migrations_fresh/0027_restaurant_country_code.sql
-- 一家店營業所在的國別（ISO 3166-1 alpha-2）。
--
-- 幣別與時區仍分別住在 settings.currency 與 timezone，因為既有程式都讀那裡；
-- 這一欄是給「按地區推政策」用的可查詢維度（WHERE country_code = 'MY'），
-- json_extract 沒辦法好好建索引。開通時由申請表的國別寫入，兩者同源。
--
-- ALTER TABLE ... ADD COLUMN 不會動到表的 STRICT 屬性，所以不需要重建表；
-- TEXT 是 STRICT 合法型別。允許 NULL：這欄位之前不存在，既有列沒有答案，
-- 讀取端必須把 NULL 當「未知」而不是預設成任何國家。
ALTER TABLE `restaurants` ADD COLUMN `country_code` TEXT;
--> statement-breakpoint
CREATE INDEX `restaurants_country_code_idx` ON `restaurants` (`country_code`);
```

- [ ] **Step 2：加 Drizzle 欄位**

在 `packages/database/src/schema/restaurants.ts` 的 `timezone` 附近加：

```ts
    // 營業所在國（ISO 3166-1 alpha-2）。開通時由申請表寫入，是政策鎖定的
    // 查詢維度；幣別與時區的權威仍分別是 settings.currency 與 timezone。
    countryCode: text("country_code"),
```

並在 index 區塊加：

```ts
    countryCodeIdx: index("restaurants_country_code_idx").on(table.countryCode),
```

- [ ] **Step 3：加 dual-track 條目**

在 `packages/database/migration-dual-track.json` 的 `freshOnly` 陣列末端加：

```json
    {
      "fresh": "0027_restaurant_country_code.sql",
      "reason": "restaurants is a platform-API table; the management-api database has no restaurants row to carry a country on."
    }
```

- [ ] **Step 4：跑守門與本機 migration**

```bash
pnpm check:migration-dual-track
pnpm check:strict-tables
pnpm db:migrate:local
```

Expected: 三個都 exit 0，最後一個顯示 0027 已套用

- [ ] **Step 5：加一個結構斷言測試**

在 `packages/database/src/schema/schema-hardening.test.ts` 加：

```ts
it("carries a queryable country on restaurants", () => {
  const config = getTableConfig(restaurants);
  const column = config.columns.find((c) => c.name === "country_code");
  expect(column).toBeDefined();
  expect(column?.notNull).toBe(false);
  expect(
    config.indexes.some((index) =>
      index.config.columns.some((c) => "name" in c && c.name === "country_code"),
    ),
  ).toBe(true);
});
```

Run: `cd packages/database && pnpm exec vitest run src/schema/schema-hardening.test.ts`
Expected: PASS

- [ ] **Step 6：commit**

```bash
git add packages/database/migrations_fresh/0027_restaurant_country_code.sql packages/database/src/schema/restaurants.ts packages/database/migration-dual-track.json packages/database/src/schema/schema-hardening.test.ts
git commit -m "feat(database): give restaurants a queryable country code"
```

---

### Task 3：申請表欄位（控制面 migration）

**Files:**
- Create: `apps/management-api/migrations/0014_onboarding_locale_and_market.sql`
- Test: 無獨立測試（結構由 Task 4 的路由測試覆蓋）

控制面軌**不需要** dual-track 條目（那份設定只管平台軌）；但仍要跑 `pnpm db:migrate:local`，它會同時套兩軌。

- [ ] **Step 1：寫 migration**

```sql
-- apps/management-api/migrations/0014_onboarding_locale_and_market.sql
-- 入駐申請要記錄店家在哪裡營業，以及想掛在哪個市集底下。
--
-- country_code 是幣別與時區的來源：開通時由它決定新店的 settings.currency
-- 與 timezone。在這之前 provisioning 把 city 寫死成「台中市」、完全不寫
-- settings，所以每一家開出來的店實質上都是台灣店。
--
-- market_id 只是「申請掛在哪個市集」，不是歸屬本身。市集歸屬會影響平台抽成
-- （markets.platform_fee_rate_bps 決定攤商實收）與合併結帳，所以它必須經過
-- 核准：開通時寫的是 market_join_requests，核准後才有 membership。
ALTER TABLE onboarding_applications ADD COLUMN country_code TEXT;
ALTER TABLE onboarding_applications ADD COLUMN market_id TEXT;
ALTER TABLE onboarding_applications ADD COLUMN stall_number TEXT;
```

- [ ] **Step 2：套用本機並確認欄位存在**

```bash
pnpm db:migrate:local
cd apps/management-api && pnpm exec wrangler d1 execute makanmakan-management-local --local --persist-to ../../.wrangler/shared-state --command "SELECT name FROM pragma_table_info('onboarding_applications') WHERE name IN ('country_code','market_id','stall_number')"
```

Expected: 三個欄位都列出來

- [ ] **Step 3：commit**

```bash
git add apps/management-api/migrations/0014_onboarding_locale_and_market.sql
git commit -m "feat(onboarding): record where a shop trades and which market it applies to"
```

---

### Task 4：申請 API 收下並驗證國別、城市、市集

**Files:**
- Modify: `apps/management-api/src/routes/onboarding.ts:28-40`（`applicationSchema` 附近）、`:150-170`（回應投影）
- Test: `apps/management-api/src/__tests__/onboarding-locale.test.ts`（新）

**Interfaces:**
- Consumes: Task 1 的 `normalizeCountryCode`、`citiesForCountry`
- Produces: 申請 payload 多三個欄位 `countryCode`（必填）、`marketId`（選填）、`stallNumber`（選填）

驗證規則：
1. `countryCode` 必填且必須是 `TW` 或 `MY`——不給預設值。給預設就是把「這家店在哪裡」變成猜的，正是這次要消滅的東西。
2. `city` 必須屬於該國的城市清單，否則 400 `CITY_NOT_IN_COUNTRY`。
3. `marketId` 有給的話，該市集必須存在、`is_active = 1`，且 `markets.city` 與申請的城市相同，否則 400 `MARKET_NOT_IN_CITY`。

- [ ] **Step 1：先寫會失敗的測試**

```ts
// apps/management-api/src/__tests__/onboarding-locale.test.ts
import { describe, expect, it } from "vitest";
import { applicationSchema } from "../routes/onboarding";

describe("applicationSchema country and city", () => {
  const base = {
    businessName: "測試店",
    contactName: "王小明",
    contactEmail: "owner@example.test",
    contactPhone: "0912345678",
    address: "逢甲路 1 號",
    district: "西屯區",
  };

  it("requires a country code", () => {
    const result = applicationSchema.safeParse({ ...base, city: "台中市" });
    expect(result.success).toBe(false);
  });

  it("rejects a country the platform does not onboard", () => {
    const result = applicationSchema.safeParse({
      ...base,
      countryCode: "VN",
      city: "Hà Nội",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a city that does not belong to the country", () => {
    const result = applicationSchema.safeParse({
      ...base,
      countryCode: "MY",
      city: "台中市",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("city");
    }
  });

  it("accepts a matching country and city", () => {
    const result = applicationSchema.safeParse({
      ...base,
      countryCode: "MY",
      city: "Kuala Lumpur",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe("MY");
  });

  it("normalizes a lowercase country code", () => {
    const result = applicationSchema.safeParse({
      ...base,
      countryCode: "tw",
      city: "台中市",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.countryCode).toBe("TW");
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/onboarding-locale.test.ts`
Expected: FAIL（`applicationSchema` 未匯出，或不認得 `countryCode`）

- [ ] **Step 3：實作**

在 `apps/management-api/src/routes/onboarding.ts`：把 `applicationSchema` 改成 `export const`（測試要用），並加上欄位與跨欄位檢查：

```ts
import {
  citiesForCountry,
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";

// ...原有欄位之後
  countryCode: z
    .string()
    .trim()
    .transform((value) => normalizeCountryCode(value))
    .refine((value): value is SupportedCountryCode => value != null, {
      message: "countryCode must be one of TW, MY",
    }),
  marketId: z.string().trim().min(1).max(64).optional(),
  stallNumber: z.string().trim().min(1).max(32).optional(),
```

在 schema 末端加跨欄位檢查（`.superRefine`）：

```ts
.superRefine((value, ctx) => {
  if (!value.city) return;
  if (!citiesForCountry(value.countryCode).includes(value.city)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["city"],
      message: `city ${value.city} is not in ${value.countryCode}`,
    });
  }
});
```

同時在寫入申請與回應投影（`:150-170`）帶上 `countryCode`、`marketId`、`stallNumber`。

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/onboarding-locale.test.ts`
Expected: PASS（5 個案例）

- [ ] **Step 5：市集存在性與城市一致性（路由層）**

市集資料在 `PLATFORM_DB`，所以這段在路由裡查，不在 zod 裡：

```ts
if (parsed.data.marketId) {
  const market = await c.env.PLATFORM_DB.prepare(
    "SELECT id, city, is_active FROM markets WHERE id = ? AND deleted_at_ms IS NULL",
  )
    .bind(parsed.data.marketId)
    .first<{ id: string; city: string; is_active: number }>();

  if (!market || market.is_active !== 1) {
    return c.json(
      {
        success: false,
        error: { code: "MARKET_NOT_FOUND", message: "Market not found" },
      },
      400,
    );
  }
  if (market.city !== parsed.data.city) {
    return c.json(
      {
        success: false,
        error: {
          code: "MARKET_NOT_IN_CITY",
          message: "Market is not in the selected city",
        },
      },
      400,
    );
  }
}
```

- [ ] **Step 6：commit**

```bash
git add apps/management-api/src/routes/onboarding.ts apps/management-api/src/__tests__/onboarding-locale.test.ts
git commit -m "feat(onboarding): validate the applicant's country, city and market"
```

---

### Task 5：市集下拉的資料來源（把樁換成真的）

**Files:**
- Modify: `apps/management-api/src/routes/markets.ts:7-23`
- Test: `apps/management-api/src/__tests__/markets-list.test.ts`（新）

**Interfaces:**
- Produces: `GET /api/v1/markets?country=MY&city=Kuala+Lumpur&type=night_market` → `{ success, data: { markets: Array<{ id, slug, name, type, city, district }>, total, page, limit } }`

為什麼不讓 onboarding-app 直接打 `api.makanmasak.com`：入駐前端的 `VITE_API_URL` 指向 `manage-api.makanmasak.com`，改成跨打平台 API 要處理 CORS 白名單與兩套 base URL。`markets.ts` 這支樁本來就是為這件事預留的，補實它比較省。

**注意**：目前它回的是寫死的空陣列（`markets: []`），所以任何「下拉是空的」都不能當成「沒有市集」——先確認這支已經補實。

- [ ] **Step 1：先寫會失敗的測試**

```ts
// apps/management-api/src/__tests__/markets-list.test.ts
import { describe, expect, it, vi } from "vitest";
import marketsRouter from "../routes/markets";

function envWithMarkets(rows: unknown[]) {
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn(() => ({ all }));
  return {
    env: {
      PLATFORM_DB: { prepare: vi.fn(() => ({ bind, all })) },
    },
    bind,
  };
}

describe("GET /markets", () => {
  it("returns markets from the platform database, not an empty stub", async () => {
    const { env } = envWithMarkets([
      {
        id: "m-1",
        slug: "fengjia",
        name: "逢甲夜市",
        type: "night_market",
        city: "台中市",
        district: "西屯區",
      },
    ]);

    const response = await marketsRouter.request(
      "/?country=TW&city=台中市",
      {},
      env as never,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { markets: Array<{ slug: string }>; total: number };
    };
    expect(body.data.markets).toHaveLength(1);
    expect(body.data.markets[0].slug).toBe("fengjia");
    expect(body.data.total).toBe(1);
  });

  it("filters by city so a market in another city cannot be picked", async () => {
    const { env, bind } = envWithMarkets([]);

    await marketsRouter.request(
      "/?country=MY&city=Kuala Lumpur",
      {},
      env as never,
    );

    expect(bind).toHaveBeenCalledWith(
      expect.stringContaining("Kuala Lumpur"),
      expect.anything(),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/markets-list.test.ts`
Expected: FAIL（回的是空陣列，`toHaveLength(1)` 不過）

- [ ] **Step 3：實作**

```ts
marketsRouter.get("/", async (c) => {
  const page = Math.max(parseInt(c.req.query("page") || "1", 10), 1);
  const limit = Math.min(
    Math.max(parseInt(c.req.query("limit") || "50", 10), 1),
    100,
  );
  const city = c.req.query("city")?.trim();

  // 市集住在平台資料庫；這支路由是入駐流程選市集時唯一的來源。
  // 一定要帶城市過濾：跨城市的市集不該出現在選單裡，而且核准後
  // 會讓該市集的合併結帳混入不同地區的攤商。
  const rows = await c.env.PLATFORM_DB.prepare(
    `SELECT id, slug, name, type, city, district
       FROM markets
      WHERE is_active = 1
        AND deleted_at_ms IS NULL
        AND (?1 IS NULL OR city = ?1)
      ORDER BY name
      LIMIT ?2 OFFSET ?3`,
  )
    .bind(city ?? null, limit, (page - 1) * limit)
    .all();

  const markets = rows.results ?? [];
  return c.json({
    success: true,
    data: { markets, total: markets.length, page, limit },
  });
});
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/markets-list.test.ts`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add apps/management-api/src/routes/markets.ts apps/management-api/src/__tests__/markets-list.test.ts
git commit -m "feat(management-api): serve the real market list for onboarding"
```

---

### Task 6：開通時寫入國別、幣別、時區

**Files:**
- Modify: `apps/management-api/src/services/OnboardingService.ts:864-884`（`restaurants` insert）
- Test: `apps/management-api/src/__tests__/onboarding-provisioning-locale.test.ts`（新）

**Interfaces:**
- Consumes: Task 1 的 `COUNTRY_PROFILES`、Task 3 的申請欄位
- Produces: 新店的 `country_code`、`timezone`、`settings.currency`

目前那段 insert **完全沒有寫 `settings`**，而且 `city` 寫死 `?? "台中市"`。這個 task 是整份規劃的核心：

```ts
const profile = COUNTRY_PROFILES[application.countryCode];
```

並在 insert 加上：

```ts
          countryCode: profile.countryCode,
          timezone: profile.timezone,
          city: application.city ?? profile.cities[0],
          settings: {
            currency: profile.currency,
          },
```

`city` 的 fallback 從寫死的「台中市」換成該國城市清單的第一項——申請表已強制選城市，這條 fallback 只在舊資料補跑時才會走到。

- [ ] **Step 1：先寫會失敗的測試**

```ts
// apps/management-api/src/__tests__/onboarding-provisioning-locale.test.ts
import { describe, expect, it } from "vitest";
import { buildProvisionedRestaurantValues } from "../services/OnboardingService";

describe("buildProvisionedRestaurantValues", () => {
  const base = {
    id: "rest-1",
    businessName: "Nasi Lemak Stall",
    contactEmail: "owner@example.test",
    contactPhone: "+60123456789",
    address: "Jalan 1",
    district: "Bukit Bintang",
  };

  it("prices a Malaysian shop in MYR on Kuala Lumpur time", () => {
    const values = buildProvisionedRestaurantValues({
      ...base,
      countryCode: "MY",
      city: "Kuala Lumpur",
    });

    expect(values.countryCode).toBe("MY");
    expect(values.timezone).toBe("Asia/Kuala_Lumpur");
    expect(values.settings).toMatchObject({ currency: "MYR" });
    expect(values.city).toBe("Kuala Lumpur");
  });

  it("prices a Taiwanese shop in TWD on Taipei time", () => {
    const values = buildProvisionedRestaurantValues({
      ...base,
      countryCode: "TW",
      city: "台中市",
    });

    expect(values.countryCode).toBe("TW");
    expect(values.timezone).toBe("Asia/Taipei");
    expect(values.settings).toMatchObject({ currency: "TWD" });
  });

  it("never leaves settings unset, which is what made every shop TWD", () => {
    const values = buildProvisionedRestaurantValues({
      ...base,
      countryCode: "MY",
      city: "Kuala Lumpur",
    });
    expect(values.settings).toBeDefined();
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/onboarding-provisioning-locale.test.ts`
Expected: FAIL（`buildProvisionedRestaurantValues` 不存在）

- [ ] **Step 3：把 insert 的值抽成可測函式**

在 `OnboardingService.ts` 匯出：

```ts
export function buildProvisionedRestaurantValues(application: {
  id: string;
  businessName: string;
  contactEmail: string;
  contactPhone: string | null;
  address: string;
  district: string;
  countryCode: SupportedCountryCode;
  city: string;
}) {
  const profile = COUNTRY_PROFILES[application.countryCode];
  return {
    id: application.id,
    name: application.businessName,
    type: "onboarding" as const,
    category: "restaurant" as const,
    address: application.address,
    district: application.district,
    city: application.city ?? profile.cities[0],
    countryCode: profile.countryCode,
    timezone: profile.timezone,
    // 幣別的權威仍是 settings.currency（apps/api 全部讀這裡），由國別決定。
    // 在這之前這個欄位根本沒被寫過，所以每一家新店都落回平台預設的 TWD。
    settings: { currency: profile.currency },
    phone: application.contactPhone ?? "",
    email: application.contactEmail,
    isAvailable: false,
    isActive: true,
  };
}
```

再讓原本的 `platformDb.insert(restaurants).values({...})` 改用它（時間戳與經緯度仍在呼叫端補上）。

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/onboarding-provisioning-locale.test.ts`
Expected: PASS（3 個案例）

- [ ] **Step 5：commit**

```bash
git add apps/management-api/src/services/OnboardingService.ts apps/management-api/src/__tests__/onboarding-provisioning-locale.test.ts
git commit -m "feat(onboarding): provision a shop in its own currency and timezone"
```

---

### Task 7：幣別在開店後不可隨意更改

**Files:**
- Modify: `apps/api/src/features/restaurants/services/RestaurantsService.ts`（`updateSettings` 路徑）
- Test: `apps/api/src/__tests__/integration/restaurant-currency-lock.real.integration.test.ts`（新）

**Interfaces:**
- Produces: 400 `CURRENCY_CHANGE_NOT_ALLOWED`

為什麼必須有這道：一家店開始收錢之後改幣別，等於把歷史訂單的解讀整個改掉——NT$100 的舊單會被讀成 RM100，報表、結算、退款全部錯位。開通時決定沒問題，之後要改必須是有防護的獨立流程。

規則：`settings.currency` 只有在這家店**沒有任何訂單**時才可更改；有訂單就擋下。

- [ ] **Step 1：先寫會失敗的 real D1 測試**

```ts
// apps/api/src/__tests__/integration/restaurant-currency-lock.real.integration.test.ts
import { beforeAll, describe, expect, it } from "vitest";
import { startTestApiServer, type TestApiServerHandle } from "./helpers/start-test-api-server";

describe("restaurant currency lock", () => {
  let api: TestApiServerHandle;

  beforeAll(async () => {
    api = await startTestApiServer();
    return () => api.stop();
  }, 30_000);

  it("lets a shop with no orders switch currency", async () => {
    const { restaurantId, token } = await api.seed.restaurantWithOwner({
      settings: { currency: "TWD" },
    });

    const response = await fetch(`${api.url}/api/v1/restaurants/${restaurantId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ settings: { currency: "MYR" } }),
    });

    expect(response.status).toBe(200);
  });

  it("refuses to switch currency once money has moved", async () => {
    const { restaurantId, token } = await api.seed.restaurantWithOwner({
      settings: { currency: "TWD" },
    });
    await api.seed.paidOrder({ restaurantId, totalAmountCents: 10000 });

    const response = await fetch(`${api.url}/api/v1/restaurants/${restaurantId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ settings: { currency: "MYR" } }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CURRENCY_CHANGE_NOT_ALLOWED");
  });
});
```

> `api.seed` 的實際 helper 名稱請以 `apps/api/src/__tests__/integration/helpers/seed-helper.ts` 為準；若沒有 `paidOrder`，就用該檔既有的建單 helper 再更新 `payment_status`。

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/api && pnpm exec vitest run --config vitest.real-integration.config.ts restaurant-currency-lock`
Expected: FAIL，第二個案例拿到 200

- [ ] **Step 3：實作守門**

在 `RestaurantsService` 更新設定的路徑，於寫入前：

```ts
const nextCurrency = normalizeCurrencyCode(input.settings?.currency);
const currentCurrency = currencyFromRestaurantSettings(current.settings, id);

if (nextCurrency && nextCurrency !== currentCurrency) {
  const [{ orderCount }] = await this.db
    .select({ orderCount: count(orders.id) })
    .from(orders)
    .where(eq(orders.restaurantId, id));

  if (orderCount > 0) {
    throw badRequest(
      "Currency cannot change once the shop has orders",
      "CURRENCY_CHANGE_NOT_ALLOWED",
    );
  }
}
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/api && pnpm exec vitest run --config vitest.real-integration.config.ts restaurant-currency-lock`
Expected: PASS（2 個案例）

- [ ] **Step 5：補單元測試並 commit**

real-integration 不計入覆蓋率門檻，所以也要在 `RestaurantsService` 的既有單元測試檔加一個「有訂單時擋下」的案例。

```bash
git add apps/api/src/features/restaurants apps/api/src/__tests__/integration/restaurant-currency-lock.real.integration.test.ts
git commit -m "feat(restaurants): lock a shop's currency once it has orders"
```

---

### Task 8：市集入駐申請（開通時建立，不直接給歸屬）

**Files:**
- Modify: `apps/management-api/src/services/OnboardingService.ts`（restaurant insert 之後）
- Test: `apps/management-api/src/__tests__/onboarding-market-request.test.ts`（新）

**Interfaces:**
- Consumes: Task 3 的 `market_id`、`stall_number`
- Produces: `market_join_requests` 一列（`status = 'pending'`），**不**寫 `restaurant_market_memberships`

為什麼不能直接給歸屬：`markets.platform_fee_rate_bps` 決定該市集訂單的平台抽成與攤商實收，市集結帳又會把同市集多攤的訂單合併成一筆付款。讓店主自助選就等於自選抽成、自行掛進別人的購物車與探索頁。

店家仍然照常開通（決策 4），核准前就是一家獨立店。

- [ ] **Step 1：先寫會失敗的測試**

```ts
// apps/management-api/src/__tests__/onboarding-market-request.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildMarketJoinRequestWrites } from "../services/OnboardingService";

describe("buildMarketJoinRequestWrites", () => {
  it("creates a pending request, never a membership", () => {
    const writes = buildMarketJoinRequestWrites({
      restaurantId: "rest-1",
      marketId: "market-1",
      stallNumber: "A12",
      nowMs: 1_780_000_000_000,
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      table: "market_join_requests",
      values: expect.objectContaining({
        restaurant_id: "rest-1",
        market_id: "market-1",
        status: "pending",
      }),
    });
    expect(JSON.stringify(writes)).not.toContain("restaurant_market_memberships");
  });

  it("writes nothing when the shop said it is independent", () => {
    expect(
      buildMarketJoinRequestWrites({
        restaurantId: "rest-1",
        marketId: null,
        stallNumber: null,
        nowMs: 1_780_000_000_000,
      }),
    ).toEqual([]);
  });

  it("carries the stall number into the request message", () => {
    const writes = buildMarketJoinRequestWrites({
      restaurantId: "rest-1",
      marketId: "market-1",
      stallNumber: "A12",
      nowMs: 1_780_000_000_000,
    });
    expect(JSON.stringify(writes)).toContain("A12");
  });
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/onboarding-market-request.test.ts`
Expected: FAIL（函式不存在）

- [ ] **Step 3：實作**

```ts
/**
 * 入駐時選的市集只會變成「待核准的申請」。
 *
 * 市集歸屬會動到錢：markets.platform_fee_rate_bps 決定該市集訂單的平台抽成，
 * 而市集結帳把同市集多攤的訂單合併成一筆付款。自助選擇若直接成為歸屬，等於
 * 讓人自選抽成條件並掛進別人的合併結帳與探索頁面。核准權在平台／市集管理者。
 */
export function buildMarketJoinRequestWrites(input: {
  restaurantId: string;
  marketId: string | null;
  stallNumber: string | null;
  nowMs: number;
}) {
  if (!input.marketId) return [];
  return [
    {
      table: "market_join_requests" as const,
      values: {
        restaurant_id: input.restaurantId,
        market_id: input.marketId,
        status: "pending" as const,
        message: input.stallNumber ? `攤位 ${input.stallNumber}` : null,
        requested_at_ms: input.nowMs,
      },
    },
  ];
}
```

在 provisioning 的 batch 裡（`restaurants` insert 之後、users insert 之前後皆可）依這個結果寫入 `PLATFORM_DB`。

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/onboarding-market-request.test.ts`
Expected: PASS（3 個案例）

- [ ] **Step 5：commit**

```bash
git add apps/management-api/src/services/OnboardingService.ts apps/management-api/src/__tests__/onboarding-market-request.test.ts
git commit -m "feat(onboarding): request market membership instead of granting it"
```

---

### Task 9：核准入駐時的幣別一致性守門

**Files:**
- Modify: `apps/api/src/features/markets/services/MarketsService.ts`（核准 join request 的方法，約 `:1670` 附近的查詢所屬的那個 service 方法）
- Test: `apps/api/src/__tests__/integration/market-join-currency.real.integration.test.ts`（新）

**Interfaces:**
- Produces: 409 `MARKET_VENDOR_CURRENCY_MISMATCH`

為什麼必要：市集結帳現在強制「同一筆結帳的攤商必須同幣別」（`MIXED_CURRENCY_CHECKOUT`，409）。若一家馬幣店被核准進台灣夜市，**整個市集的合併結帳都會掛掉**，受害的是其他攤商。把這個檢查提前到核准當下，錯誤訊息也才講得清楚。

- [ ] **Step 1：先寫會失敗的 real D1 測試**

```ts
// apps/api/src/__tests__/integration/market-join-currency.real.integration.test.ts
import { beforeAll, describe, expect, it } from "vitest";
import { startTestApiServer, type TestApiServerHandle } from "./helpers/start-test-api-server";

describe("market join currency guard", () => {
  let api: TestApiServerHandle;

  beforeAll(async () => {
    api = await startTestApiServer();
    return () => api.stop();
  }, 30_000);

  it("refuses a vendor whose currency differs from the market's vendors", async () => {
    const { marketId, adminToken } = await api.seed.marketWithVendor({
      vendorSettings: { currency: "TWD" },
    });
    const { restaurantId } = await api.seed.restaurantWithOwner({
      settings: { currency: "MYR" },
    });
    const requestId = await api.seed.marketJoinRequest({ marketId, restaurantId });

    const response = await fetch(
      `${api.url}/api/v1/markets/${marketId}/join-requests/${requestId}/approve`,
      { method: "POST", headers: { authorization: `Bearer ${adminToken}` } },
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MARKET_VENDOR_CURRENCY_MISMATCH");
  });

  it("approves a vendor that matches the market's currency", async () => {
    const { marketId, adminToken } = await api.seed.marketWithVendor({
      vendorSettings: { currency: "TWD" },
    });
    const { restaurantId } = await api.seed.restaurantWithOwner({
      settings: { currency: "TWD" },
    });
    const requestId = await api.seed.marketJoinRequest({ marketId, restaurantId });

    const response = await fetch(
      `${api.url}/api/v1/markets/${marketId}/join-requests/${requestId}/approve`,
      { method: "POST", headers: { authorization: `Bearer ${adminToken}` } },
    );

    expect(response.status).toBe(200);
  });
});
```

> 實際的核准端點路徑與 seed helper 名稱以 repo 現況為準；若核准目前只存在於 service 層而沒有路由，就直接測 service 方法。

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/api && pnpm exec vitest run --config vitest.real-integration.config.ts market-join-currency`
Expected: FAIL，第一個案例拿到 200

- [ ] **Step 3：實作**

在核准方法裡，寫入 membership 之前：

```ts
import { resolveSharedRestaurantCurrency } from "../../../shared/utils/restaurant-currency";

// 市集結帳把同市集多攤的訂單合併成一筆付款，且強制同幣別
// （MIXED_CURRENCY_CHECKOUT）。若讓幣別不同的攤商進來，壞掉的是整個市集的
// 合併結帳，而不只是這一攤——所以擋在核准當下，不要等到結帳才發現。
const existingVendorIds = await this.listActiveVendorIds(marketId);
await resolveSharedRestaurantCurrency(this.env.DB, [
  ...existingVendorIds,
  restaurantId,
]);
```

`resolveSharedRestaurantCurrency` 已經會在幣別不一致時丟 `MIXED_CURRENCY_CHECKOUT`（409）。若要更精確的錯誤碼，就在這裡 catch 並改丟 `MARKET_VENDOR_CURRENCY_MISMATCH`，訊息帶上兩邊的幣別。

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/api && pnpm exec vitest run --config vitest.real-integration.config.ts market-join-currency`
Expected: PASS（2 個案例）

- [ ] **Step 5：補單元測試並 commit**

```bash
git add apps/api/src/features/markets apps/api/src/__tests__/integration/market-join-currency.real.integration.test.ts
git commit -m "feat(markets): refuse a vendor whose currency breaks the market's checkout"
```

---

### Task 10：入駐表單的三層下拉

**Files:**
- Modify: `apps/onboarding-app/src/views/ApplyView.vue:340-375`（目前 district／city 是自由輸入）
- Modify: `apps/onboarding-app/src/locales/*.ts`（每個語系）
- Test: `apps/onboarding-app/src/views/ApplyView.test.ts`（既有檔，加案例）

**Interfaces:**
- Consumes: Task 1 的 `COUNTRY_PROFILES`、Task 5 的 `GET /markets`

行為：

1. 國家下拉（預設**不選**，強迫使用者自己選；不要預設台灣）。
2. 選了國家才啟用城市下拉，內容來自 `citiesForCountry`。
3. 選了城市才啟用市集下拉，內容來自 `GET /markets?country=&city=`；第一個選項固定是「我是獨立店面，不屬於任何商圈」（value 為空字串）。
4. 選了市集才顯示攤位號碼輸入框（選填）。
5. 改國家要清掉城市與市集（否則會送出不相符的組合，被 Task 4 的驗證擋下，但使用者不知道為什麼）。

- [ ] **Step 1：先寫會失敗的元件測試**

```ts
// 追加到 apps/onboarding-app/src/views/ApplyView.test.ts
it("only offers cities that belong to the chosen country", async () => {
  const wrapper = mount(ApplyView);

  await wrapper.find('[data-testid="onboarding-country"]').setValue("MY");

  const cityOptions = wrapper
    .find('[data-testid="onboarding-city"]')
    .findAll("option")
    .map((option) => option.text());

  expect(cityOptions).toContain("Kuala Lumpur");
  expect(cityOptions).not.toContain("台中市");
});

it("clears city and market when the country changes", async () => {
  const wrapper = mount(ApplyView);

  await wrapper.find('[data-testid="onboarding-country"]').setValue("TW");
  await wrapper.find('[data-testid="onboarding-city"]').setValue("台中市");
  await wrapper.find('[data-testid="onboarding-country"]').setValue("MY");

  expect(
    (wrapper.find('[data-testid="onboarding-city"]').element as HTMLSelectElement).value,
  ).toBe("");
});

it("offers an explicit independent-shop choice rather than a blank", async () => {
  const wrapper = mount(ApplyView);

  await wrapper.find('[data-testid="onboarding-country"]').setValue("TW");
  await wrapper.find('[data-testid="onboarding-city"]').setValue("台中市");
  await flushPromises();

  const marketOptions = wrapper
    .find('[data-testid="onboarding-market"]')
    .findAll("option")
    .map((option) => option.text());

  expect(marketOptions[0]).toBe("我是獨立店面，不屬於任何商圈");
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/onboarding-app && pnpm exec vitest run src/views/ApplyView.test.ts`
Expected: FAIL（找不到 `onboarding-country`）

- [ ] **Step 3：實作三層下拉**

把 city 由 `<input>` 換成 `<select>`，並在它之前加入國家下拉、之後加入市集下拉與攤位號碼。樣式沿用同檔既有的 `class="input"`，不要引入新顏色（`pnpm check:design-palette` 會擋）。

```vue
<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  COUNTRY_PROFILES,
  SUPPORTED_COUNTRIES,
  citiesForCountry,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";

const markets = ref<Array<{ id: string; name: string }>>([]);

// 預設不選國家：預設任何一個，就等於把「這家店在哪裡」變回用猜的。
const cityOptions = computed(() =>
  form.countryCode ? citiesForCountry(form.countryCode as SupportedCountryCode) : [],
);

// 換國家要清掉下游選擇，否則會送出不相符的組合，被伺服器擋下卻看不出原因。
watch(
  () => form.countryCode,
  () => {
    form.city = "";
    form.marketId = "";
    form.stallNumber = "";
    markets.value = [];
  },
);

watch(
  () => form.city,
  async (city) => {
    form.marketId = "";
    markets.value = [];
    if (!city || !form.countryCode) return;
    const response = await api.get("/markets", {
      params: { country: form.countryCode, city },
    });
    markets.value = response.data.data.markets;
  },
);
</script>

<template>
  <div>
    <label for="onboarding-country" class="label"
      >{{ t("apply.form.country.label") }} *</label
    >
    <select
      id="onboarding-country"
      v-model="form.countryCode"
      data-testid="onboarding-country"
      class="input"
      :class="{ 'input-error': errors.countryCode }"
    >
      <option value="">{{ t("apply.form.country.placeholder") }}</option>
      <option v-for="code in SUPPORTED_COUNTRIES" :key="code" :value="code">
        {{ t(`apply.form.country.options.${code}`) }}
      </option>
    </select>
  </div>

  <div>
    <label for="onboarding-city" class="label"
      >{{ t("apply.form.city.label") }} *</label
    >
    <select
      id="onboarding-city"
      v-model="form.city"
      data-testid="onboarding-city"
      class="input"
      :disabled="!form.countryCode"
    >
      <option value="">{{ t("apply.form.city.placeholder") }}</option>
      <option v-for="city in cityOptions" :key="city" :value="city">
        {{ city }}
      </option>
    </select>
  </div>

  <div>
    <label for="onboarding-market" class="label">{{
      t("apply.form.market.label")
    }}</label>
    <select
      id="onboarding-market"
      v-model="form.marketId"
      data-testid="onboarding-market"
      class="input"
      :disabled="!form.city"
    >
      <!-- 空字串是明確的「獨立店面」，不是未作答 -->
      <option value="">{{ t("apply.form.market.independent") }}</option>
      <option v-for="market in markets" :key="market.id" :value="market.id">
        {{ market.name }}
      </option>
    </select>
  </div>

  <div v-if="form.marketId">
    <label for="onboarding-stall-number" class="label">{{
      t("apply.form.stallNumber.label")
    }}</label>
    <input
      id="onboarding-stall-number"
      v-model="form.stallNumber"
      data-testid="onboarding-stall-number"
      type="text"
      maxlength="32"
      class="input"
    />
  </div>
</template>
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/onboarding-app && pnpm exec vitest run src/views/ApplyView.test.ts`
Expected: PASS

- [ ] **Step 5：補齊語系字串並 commit**

每個語系都要有 `apply.form.country.label`、`apply.form.market.label`、`apply.form.market.independent`、`apply.form.stallNumber.label`。

```bash
git add apps/onboarding-app/src
git commit -m "feat(onboarding-app): pick country, city and market from dropdowns"
```

---

### Task 11：審核畫面顯示與當場核准

**Files:**
- Modify: `apps/admin-dashboard/src/views/PlatformOnboardingApplicationsView.vue`
- Modify: `apps/admin-dashboard/src/locales/*.ts`（六個語系）
- Test: `apps/admin-dashboard/src/views/PlatformOnboardingApplicationsView.test.ts`（既有檔，加案例）

行為：

1. 申請列表與詳情顯示國別（含國旗字樣或代碼）、城市、市集名稱與攤位號碼。
2. 若申請帶了市集，核准畫面多一個「同時核准市集入駐」的勾選（預設勾起，因為平台協助的情境本來就確認過）。
3. 勾起時，核准動作除了開通，還要把對應的 `market_join_requests` 設為 approved 並建立 membership——這一步要走 Task 9 的幣別守門，被擋下時要在畫面顯示原因，而不是靜默失敗。

- [ ] **Step 1：先寫會失敗的元件測試**

```ts
it("shows where the applicant trades", async () => {
  const wrapper = await mountWithApplications([
    {
      id: "APP-1",
      businessName: "Nasi Lemak Stall",
      countryCode: "MY",
      city: "Kuala Lumpur",
      marketName: "Pasar Malam Taman Connaught",
      stallNumber: "A12",
      status: "submitted",
    },
  ]);

  const text = wrapper.text();
  expect(text).toContain("MY");
  expect(text).toContain("Kuala Lumpur");
  expect(text).toContain("Pasar Malam Taman Connaught");
  expect(text).toContain("A12");
});

it("surfaces why a market approval was refused", async () => {
  const wrapper = await mountWithApplications([
    { id: "APP-1", countryCode: "MY", marketName: "逢甲夜市", status: "submitted" },
  ]);
  approveMock.mockRejectedValueOnce({
    response: { data: { error: { code: "MARKET_VENDOR_CURRENCY_MISMATCH" } } },
  });

  await wrapper.find('[data-testid="approve-application"]').trigger("click");
  await flushPromises();

  expect(wrapper.text()).toContain("幣別");
});
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd apps/admin-dashboard && pnpm exec vitest run src/views/PlatformOnboardingApplicationsView.test.ts`
Expected: FAIL

- [ ] **Step 3：實作**

列表與詳情多一個「營業地點」欄位，核准區多一個勾選：

```vue
<td data-testid="application-location">
  {{ application.countryCode ?? "—" }} · {{ application.city ?? "—" }}
  <span v-if="application.marketName" class="text-ios-gray-600">
    · {{ application.marketName }}
    <template v-if="application.stallNumber">
      （{{ t("onboarding.stall") }} {{ application.stallNumber }}）
    </template>
  </span>
</td>
```

```vue
<label v-if="application.marketName" class="flex items-center gap-2">
  <input
    v-model="approveMarketMembership"
    data-testid="approve-market-membership"
    type="checkbox"
  />
  {{ t("onboarding.approveMarketMembership") }}
</label>
```

核准送出時帶上該旗標，並把伺服器的錯誤碼轉成看得懂的訊息——尤其是幣別被擋下的情況，不能靜默失敗：

```ts
async function approve(application: OnboardingApplication) {
  try {
    await onboardingApi.approve(application.id, {
      approveMarketMembership: approveMarketMembership.value,
    });
  } catch (error) {
    const code = extractApiErrorCode(error);
    errorMessage.value =
      code === "MARKET_VENDOR_CURRENCY_MISMATCH"
        ? t("onboarding.errors.marketCurrencyMismatch")
        : t("onboarding.errors.approveFailed");
    return;
  }
  await refresh();
}
```

語系字串 `onboarding.errors.marketCurrencyMismatch` 要講清楚原因，例如「這家店的幣別與該市集其他攤商不同，核准會讓整個市集的合併結帳失效」。

- [ ] **Step 4：跑測試確認通過**

Run: `cd apps/admin-dashboard && pnpm exec vitest run src/views/PlatformOnboardingApplicationsView.test.ts`
Expected: PASS

- [ ] **Step 5：commit**

```bash
git add apps/admin-dashboard/src
git commit -m "feat(admin): show and approve an applicant's market placement"
```

---

### Task 12：補既有 production 資料

**Files:**
- Create: `scripts/backfill-restaurant-country.sql`
- Test: 無（一次性資料修補，靠實查驗收）

production 目前只有 2 家店：一家 `settings.currency = 'TWD'`、一家 `settings` 為 NULL，`country_code` 都還沒有值。兩家都在台中市，所以都填 `TW`。

- [ ] **Step 1：寫補資料 SQL**

```sql
-- scripts/backfill-restaurant-country.sql
-- 0027 之前建立的店沒有 country_code。production 這兩家都是台灣店
-- （city 為台中市、settings.currency 為 TWD 或未設）。
UPDATE restaurants
   SET country_code = 'TW',
       settings = json_set(COALESCE(settings, '{}'), '$.currency', 'TWD'),
       timezone = COALESCE(NULLIF(timezone, ''), 'Asia/Taipei')
 WHERE country_code IS NULL;
```

- [ ] **Step 2：先在本機套用並確認**

```bash
cd apps/api && pnpm exec wrangler d1 execute makanmakan-local --local --persist-to ../../.wrangler/shared-state --file=../../scripts/backfill-restaurant-country.sql
cd apps/api && pnpm exec wrangler d1 execute makanmakan-local --local --persist-to ../../.wrangler/shared-state --command "SELECT id, country_code, timezone, json_extract(settings,'\$.currency') AS currency FROM restaurants"
```

Expected: 每一列都有 `country_code`、`timezone`、`currency`

- [ ] **Step 3：commit**

```bash
git add scripts/backfill-restaurant-country.sql
git commit -m "chore(data): backfill the country of shops created before 0027"
```

> production 的套用是部署步驟，不在這份規劃的 commit 範圍內。順序見下節。

---

## 部署順序

1. **平台 migration 0028 與控制面 migration 0014**（純新增欄位，舊程式不碰，可先套）
2. **`apps/api`**（幣別鎖、市集核准守門）
3. **`apps/management-api`**（申請驗證、市集清單、開通寫入）
4. **`apps/onboarding-app`** 與 **`apps/admin-dashboard`**（兩個表單）
5. **跑 `scripts/backfill-restaurant-country.sql`**（要在 0028 之後）

管理面與入駐前端要一起走：入駐表單開始送 `countryCode`，而舊的 management-api 會把它當未知欄位忽略，於是開出來的店仍然沒有國別——所以 **management-api 要先於 onboarding-app 部署**。

## 驗收（整份完成後）

```bash
pnpm verify:push
cd apps/api && pnpm exec vitest run --coverage.enabled --coverage.provider=v8 \
  --coverage.reporter=json --coverage.reportsDirectory=./cov-api \
  --coverage.include='src/features/**/*.ts' --maxWorkers=2
```

覆蓋率門檻：`apps/api/src/features/**` lines ≥ 90%、branches ≥ 78%。

實際流程驗收（本機，不要用 curl 打寫入端點，會被 CSRF 擋，用瀏覽器走）：

1. 入駐表單選「馬來西亞 → Kuala Lumpur → 某市集 → 攤位 A12」送出。
2. 平台後台核准。
3. 查資料庫：新店 `country_code = 'MY'`、`timezone = 'Asia/Kuala_Lumpur'`、`settings.currency = 'MYR'`，且 `market_join_requests` 有一列 `pending`（若審核時沒勾「同時核准市集」）。
4. 用該店的帳號登入店家後台，確認菜單價格輸入框的 step 是 `0.01`、金額顯示是 `RM`。
