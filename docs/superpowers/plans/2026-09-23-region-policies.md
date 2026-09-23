# 地區政策（國家／市集）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓平台管理員在 management-portal 依國家與市集設定政策（功能開關、稅率與服務費預設、允許的金流商、可販售方案、市集費率上限），並在 `apps/api` 的對應路徑上強制執行；上限類政策在資料無效或讀取失敗時一律阻擋。

**Architecture:** 一張 `policies` 表存國家層與市集層的值；`packages/database` 的登記表負責每個 key 的 zod 驗證、合併語意與允許層級。`apps/api` 用 KV 快取（以範圍為 key）讀取並合併兩層，不合法的上限類 key 標記為 unavailable；各執行點再與店家層既有設定合併。市集新增 `country_code`。`management-api` 提供 CRUD，並設有國別未知門檻、費率上限門檻、稽核與快取清除；portal 依登記表產生編輯畫面。

**Tech Stack:** Cloudflare Workers (Hono) + D1 + Drizzle、zod v4、Vue 3 + Vite、vitest（單元測試與 real D1）、wrangler。

**Spec:** `docs/superpowers/specs/2026-09-23-region-policies-design.md`（第二版）。§6 的對照表是每個執行點的依據。

## 實作注意事項（spec 沒寫、但執行時要知道的）

- `moduleGate` 在快取未命中時，才多讀一次 `restaurants.country_code`，結果存進 `CachedSubscription.countryCode`。22 個既有的 module-gate 測試用的 FakeKv 裝的訂閱資料沒有這個欄位，所以視為 NULL，會跳過政策，這些測試不必修改。
- 金流的扣款檢查做成 `ShopPaymentCredentialService.assertChargeAllowed`，由 `ShopWalletMarketCheckoutGateway` 透過既有的 `credentials` 依賴呼叫。退款函式的 `credentials` 型別只有 `loadGatewayCredentials`，所以**在型別上就不可能**去查政策。
- 稅率預設值抽成 `resolvePricingRates`，邏輯在 real D1 測試裡驗證；`GroupOrdersService` 只負責呼叫。

## Global Constraints

- 金額一律存整數 cents；比率在政策裡一律存 bps 整數（0–10000）。`restaurants.settings.taxRate`／`serviceChargeRate` 是小數，兩者以 `bps / 10000` 換算。
- 新表必須 `STRICT`。migration 手寫、循序編號：平台軌這次用 **0030**、**0031**。每個新 migration 都要在 `packages/database/migration-dual-track.json` 的 `freshOnly` 加一筆，並跑 `pnpm check:migration-dual-track` 與 `pnpm check:strict-tables`。
- 時間戳用 `INTEGER` Unix 毫秒（Drizzle `{ mode: "timestamp_ms" }`，欄位名稱結尾 `_ms`）。主鍵用 UUID v7。
- 新程式的查詢一律用 Drizzle（Layer 1／2），不寫 raw SQL 字串。
- API 錯誤一律丟 `ApiError`，交給全域 handler 格式化，不在 route 裡 try/catch 包錯誤格式。
- 上限類與平台類政策：資料無效或讀取失敗時一律 503 `POLICY_UNAVAILABLE`，**不能**退回不限制。預設類政策則退回 0。
- 金流政策只檢查「新連接或重新啟用」與「新扣款」，退款、狀態查詢、webhook、對帳一律不檢查。
- 所有 UI 字串進六個語系（zh-TW、zh-CN、en-US、vi-VN、ms-MY、id-ID）；UI 依 `DESIGN.md`，`pnpm check:design-palette` 必須通過。
- 測試：mock 的外部呼叫都要驗證呼叫參數；不做 CSS class 斷言；大型模組的第一次 import 放在 `beforeAll`。
- `apps/api` 的 `typecheck` 會跑兩個 tsconfig，兩個都要過。
- 驗證指令不要接 `| tail` 或 `| grep` 收尾，否則退出碼會被吃掉。
- 在 worktree `/Users/eric/Documents/Code/Makan-Masak-feat-region-policies`（分支 `feat/region-policies`）內工作。

## Review Focus

1. **上限類政策的資料壞掉**：模組、金流、方案、費率上限，只要有一筆不合法的值，讀到它的操作都要回 503，不能當作沒設定（Task 1、3、4 有測試）。
2. **政策收緊後退款**：已成立的付款要能退款，而且不會查詢政策；被擋的只有新扣款（Task 5 有測試）。
3. **訂閱快取沒有 `countryCode`**：`/me/modules` 也會寫訂閱快取，必須帶上國別，否則國家政策會被略過長達 5 分鐘（Task 4 有測試）。
4. **確認國別未知店家數時數字不符**（管理員確認之後又多了新店）：要再擋一次，不能沿用舊的確認（Task 9 有測試）。
5. **收平台費的市集國別未知**（城市名稱不在清單內）：市集寫入時要擋；設定費率上限時，也要因為這些市集而擋（Task 8、9 有測試）。

---

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `packages/shared-types/src/locale.ts`（改） | 新增 `countryForCity` |
| `packages/database/src/utils/region-policies.ts`（新） | 登記表、驗證、解析、合併（含 unavailable）、快取 key、常數 |
| `packages/database/src/schema/policies.ts`（新） | `policies` 表 |
| `packages/database/src/schema/markets.ts`（改） | `markets.countryCode` |
| `packages/database/migrations_fresh/0030_policies.sql`、`0031_market_country_code.sql`（新） | 建表；市集國別與回填 |
| `apps/api/src/shared/policy/regionPolicies.ts`（新） | 讀取各層（含 KV 快取）、合併、`requirePolicy`、查國別與市集 |
| `apps/api/src/shared/policy/regionPolicyGuards.ts`（新） | 金流、方案、費率上限的檢查，以及稅率預設值 |
| `apps/api/src/middleware/moduleGate.ts`、`features/me/routes/index.ts`（改） | 功能開關 |
| `apps/api/src/features/shop-payments/services/*.ts`（改） | 金流 |
| `apps/api/src/features/subscriptions/routes/index.ts`（改） | 方案 |
| `apps/api/src/features/group-orders/services/GroupOrdersService.ts`（改） | 稅率與服務費預設值 |
| `apps/api/src/features/markets/**`（改，新增 `services/market-country.ts`） | 市集國別、費率上限 |
| `apps/management-api/src/routes/policies.ts`（新） | 後台 CRUD 與各項門檻 |
| `apps/management-portal/src/views/PoliciesView.vue`（新）與 api、router、nav、i18n（改） | 管理畫面 |

---

### Task 1：登記表與合併邏輯（`packages/database`、`packages/shared-types`）

**Files:**
- Modify: `packages/shared-types/src/locale.ts`（檔尾）
- Create: `packages/database/src/utils/region-policies.ts`
- Modify: `packages/database/src/index.ts`（在 `export * from "./utils/plan-quotas";` 下一行）
- Modify: `apps/api/src/shared/utils/provider-money.ts:53-59`
- Test: `packages/database/src/utils/region-policies.test.ts`

**Interfaces:**
- Produces（皆從 `@makanmasak/database` 匯出）：
  - `NATIVE_PAYMENT_PROVIDERS`、`type NativePaymentProvider`；`PAID_PLAN_TIERS`、`type PaidPlanTier`
  - `POLICY_SCOPE_TYPES`、`type PolicyScopeType = "country" | "market"`
  - `REGION_POLICY_DEFINITIONS`、`type RegionPolicyKey`、`type RegionPolicyLayer`
  - `interface LoadedRegionPolicyLayer { values: RegionPolicyLayer; invalidKeys: string[] }`
  - `validateRegionPolicyValue(key: string, scopeType: PolicyScopeType, value: unknown): PolicyValidationResult`
  - `parseRegionPolicyLayer(scopeType, rows: ReadonlyArray<{ policyKey: string; value: string }>): LoadedRegionPolicyLayer`
  - `mergeRegionPolicies(country: LoadedRegionPolicyLayer | null, market: LoadedRegionPolicyLayer | null): EffectiveRegionPolicies`（包含 `unavailableKeys: ReadonlySet<RegionPolicyKey>`）
  - `EMPTY_REGION_POLICIES`、`describeRegionPolicies()`、`regionPolicyCacheKey(scopeType, scopeId)`（格式 `policy:v1:<type>:<id>`）
- Produces（從 `@makanmasak/shared-types` 匯出）：`countryForCity(city: string): SupportedCountryCode | null`

- [ ] **Step 1：寫失敗的測試**

`packages/database/src/utils/region-policies.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { countryForCity } from "@makanmasak/shared-types";
import {
  EMPTY_REGION_POLICIES,
  describeRegionPolicies,
  mergeRegionPolicies,
  parseRegionPolicyLayer,
  regionPolicyCacheKey,
  validateRegionPolicyValue,
  type LoadedRegionPolicyLayer,
  type RegionPolicyLayer,
} from "./region-policies";

const loaded = (
  values: RegionPolicyLayer,
  invalidKeys: string[] = [],
): LoadedRegionPolicyLayer => ({ values, invalidKeys });

describe("validateRegionPolicyValue", () => {
  it("accepts a valid module list at country scope", () => {
    expect(
      validateRegionPolicyValue("modules.disabled", "country", ["pos"]),
    ).toEqual({ ok: true, value: ["pos"] });
  });

  it("rejects unknown keys", () => {
    expect(validateRegionPolicyValue("nope", "country", 1)).toMatchObject({
      ok: false,
      code: "POLICY_KEY_UNKNOWN",
    });
  });

  it.each([
    ["modules.disabled", ["pos"]],
    ["pricing.default_tax_rate_bps", 500],
    ["pricing.default_service_charge_rate_bps", 500],
    ["plans.allowed_tiers", ["pro"]],
    ["platform.max_fee_rate_bps", 500],
  ])("keeps %s off the market scope (no market context)", (key, value) => {
    expect(validateRegionPolicyValue(key, "market", value)).toMatchObject({
      ok: false,
      code: "POLICY_SCOPE_NOT_ALLOWED",
    });
  });

  it("allows payment providers at market scope", () => {
    expect(
      validateRegionPolicyValue("payments.allowed_providers", "market", ["tng"]),
    ).toEqual({ ok: true, value: ["tng"] });
  });

  it.each([
    ["modules.disabled", ["not_a_module"]],
    ["modules.disabled", ["pos", "pos"]],
    ["payments.allowed_providers", ["touch_n_go"]],
    ["plans.allowed_tiers", ["trial"]],
    ["pricing.default_tax_rate_bps", 10001],
    ["pricing.default_tax_rate_bps", 5.5],
    ["platform.max_fee_rate_bps", -1],
  ])("rejects %s = %j", (key, value) => {
    expect(validateRegionPolicyValue(key, "country", value)).toMatchObject({
      ok: false,
      code: "POLICY_VALUE_INVALID",
    });
  });
});

describe("parseRegionPolicyLayer", () => {
  it("keeps valid rows and reports invalid ones", () => {
    expect(
      parseRegionPolicyLayer("country", [
        { policyKey: "modules.disabled", value: '["pos"]' },
        { policyKey: "pricing.default_tax_rate_bps", value: "not json" },
        { policyKey: "plans.allowed_tiers", value: '["trial"]' },
        { policyKey: "unknown.key", value: "1" },
      ]),
    ).toEqual({
      values: { "modules.disabled": ["pos"] },
      invalidKeys: [
        "pricing.default_tax_rate_bps",
        "plans.allowed_tiers",
        "unknown.key",
      ],
    });
  });
});

describe("mergeRegionPolicies", () => {
  it("is a no-op with no layers", () => {
    expect(mergeRegionPolicies(null, null)).toEqual(EMPTY_REGION_POLICIES);
    expect(EMPTY_REGION_POLICIES.modulesDisabled.size).toBe(0);
    expect(EMPTY_REGION_POLICIES.allowedProviders).toBeNull();
    expect(EMPTY_REGION_POLICIES.defaultTaxRate).toBeNull();
    expect(EMPTY_REGION_POLICIES.allowedPaidTiers).toBeNull();
    expect(EMPTY_REGION_POLICIES.maxFeeRateBps).toBeNull();
    expect(EMPTY_REGION_POLICIES.unavailableKeys.size).toBe(0);
  });

  it("intersects allowed providers and ignores unset layers", () => {
    expect([
      ...mergeRegionPolicies(
        loaded({ "payments.allowed_providers": ["tng", "grabpay"] }),
        loaded({ "payments.allowed_providers": ["tng", "stripe"] }),
      ).allowedProviders!,
    ]).toEqual(["tng"]);
    expect([
      ...mergeRegionPolicies(
        loaded({ "payments.allowed_providers": ["tng"] }),
        loaded({}),
      ).allowedProviders!,
    ]).toEqual(["tng"]);
  });

  it("reads country-only keys and converts bps", () => {
    const merged = mergeRegionPolicies(
      loaded({
        "modules.disabled": ["pos"],
        "pricing.default_tax_rate_bps": 500,
        "pricing.default_service_charge_rate_bps": 1000,
        "plans.allowed_tiers": ["pro"],
        "platform.max_fee_rate_bps": 800,
      }),
      null,
    );
    expect([...merged.modulesDisabled]).toEqual(["pos"]);
    expect(merged.defaultTaxRate).toBe(0.05);
    expect(merged.defaultServiceChargeRate).toBe(0.1);
    expect([...merged.allowedPaidTiers!]).toEqual(["pro"]);
    expect(merged.maxFeeRateBps).toBe(800);
  });

  it("marks invalid ceiling keys unavailable from either layer", () => {
    const merged = mergeRegionPolicies(
      loaded({}, ["modules.disabled", "platform.max_fee_rate_bps"]),
      loaded({}, ["payments.allowed_providers"]),
    );
    expect([...merged.unavailableKeys].sort()).toEqual([
      "modules.disabled",
      "payments.allowed_providers",
      "platform.max_fee_rate_bps",
    ]);
  });

  it("treats invalid default keys and unknown keys as unset, not unavailable", () => {
    const merged = mergeRegionPolicies(
      loaded({}, ["pricing.default_tax_rate_bps", "unknown.key"]),
      null,
    );
    expect(merged.unavailableKeys.size).toBe(0);
    expect(merged.defaultTaxRate).toBeNull();
  });
});

describe("helpers", () => {
  it("builds scope cache keys", () => {
    expect(regionPolicyCacheKey("country", "MY")).toBe("policy:v1:country:MY");
  });

  it("describes every key for the portal", () => {
    expect(describeRegionPolicies().map((d) => d.key)).toEqual([
      "modules.disabled",
      "payments.allowed_providers",
      "pricing.default_tax_rate_bps",
      "pricing.default_service_charge_rate_bps",
      "plans.allowed_tiers",
      "platform.max_fee_rate_bps",
    ]);
  });

  it.each([
    ["台中市", "TW"],
    ["臺中市", "TW"],
    ["Selangor", "MY"],
    ["Taichung", null],
    ["Hanoi", null],
  ])("maps city %s to %s", (city, country) => {
    expect(countryForCity(city)).toBe(country);
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd packages/database && pnpm exec vitest run src/utils/region-policies.test.ts`
Expected：FAIL，找不到 `./region-policies`。

- [ ] **Step 3：`countryForCity`**

在 `packages/shared-types/src/locale.ts` 檔尾加上：

```ts
/**
 * 城市屬於哪一國（名稱完全符合才算）。兩國城市清單不重疊，最多對到一國；
 * 對不到回 null，呼叫端必須把 null 當「未知」，不可當成任何國家。
 */
export const countryForCity = (city: string): SupportedCountryCode | null =>
  SUPPORTED_COUNTRIES.find((code) =>
    COUNTRY_PROFILES[code].cities.includes(city),
  ) ?? null;
```

- [ ] **Step 4：登記表**

`packages/database/src/utils/region-policies.ts`：

```ts
/**
 * 地區政策登記表（spec: docs/superpowers/specs/2026-09-23-region-policies-design.md）。
 *
 * `policies` 表只存 JSON，這裡決定每個 key 合法的值、合併語意與可以設定在
 * 哪一層。apps/api 讀取時與 management-api 寫入時都經過同一份驗證。
 *
 * 一個 key 只開放在確實拿得到該層情境的層級（spec D8）：第一版只有
 * payments.allowed_providers 在市集結帳時知道市集，其他 key 只到國家層。
 *
 * 每個 key 在「沒有任何一層設定」時的效果都等於現狀。
 */
import { z } from "zod";
import { MODULES, type ModuleKey, type PlanTier } from "../schema/subscriptions";

export const NATIVE_PAYMENT_PROVIDERS = [
  "stripe",
  "linepay",
  "ecpay",
  "newebpay",
  "tng",
  "grabpay",
] as const;
export type NativePaymentProvider = (typeof NATIVE_PAYMENT_PROVIDERS)[number];

/** `trial` 不在這裡：開通一律給 trial，國家不能禁止它。 */
export const PAID_PLAN_TIERS = [
  "basic",
  "pro",
  "enterprise",
] as const satisfies readonly PlanTier[];
export type PaidPlanTier = (typeof PAID_PLAN_TIERS)[number];

export const POLICY_SCOPE_TYPES = ["country", "market"] as const;
export type PolicyScopeType = (typeof POLICY_SCOPE_TYPES)[number];

/**
 * - ceiling_deny：關閉清單，各層取聯集
 * - ceiling_allow：允許清單，各層取交集；沒有任何一層設定 = 不限制
 * - default：越下層越優先，店家自己的設定再蓋過它
 * - platform_cap：只有平台設定，店家不參與
 *
 * 除了 default，其他三種在資料無效時都不能退回「不限制」（spec D7）。
 */
export type PolicyMerge =
  | "ceiling_deny"
  | "ceiling_allow"
  | "default"
  | "platform_cap";

export type PolicyUi =
  | { kind: "list"; options: readonly string[] }
  | { kind: "bps" };

const MODULE_KEYS = Object.values(MODULES) as [ModuleKey, ...ModuleKey[]];

function distinctList<const T extends readonly [string, ...string[]]>(
  options: T,
) {
  return z
    .array(z.enum(options))
    .refine((list) => new Set(list).size === list.length, {
      message: "Duplicate entries",
    });
}

const bps = z.number().int().min(0).max(10000);

export const REGION_POLICY_DEFINITIONS = {
  "modules.disabled": {
    schema: distinctList(MODULE_KEYS),
    merge: "ceiling_deny",
    scopes: ["country"],
    ui: { kind: "list", options: MODULE_KEYS },
  },
  "payments.allowed_providers": {
    schema: distinctList(NATIVE_PAYMENT_PROVIDERS),
    merge: "ceiling_allow",
    scopes: ["country", "market"],
    ui: { kind: "list", options: NATIVE_PAYMENT_PROVIDERS },
  },
  "pricing.default_tax_rate_bps": {
    schema: bps,
    merge: "default",
    scopes: ["country"],
    ui: { kind: "bps" },
  },
  "pricing.default_service_charge_rate_bps": {
    schema: bps,
    merge: "default",
    scopes: ["country"],
    ui: { kind: "bps" },
  },
  "plans.allowed_tiers": {
    schema: distinctList(PAID_PLAN_TIERS),
    merge: "ceiling_allow",
    scopes: ["country"],
    ui: { kind: "list", options: PAID_PLAN_TIERS },
  },
  "platform.max_fee_rate_bps": {
    schema: bps,
    merge: "platform_cap",
    scopes: ["country"],
    ui: { kind: "bps" },
  },
} as const satisfies Record<
  string,
  {
    schema: z.ZodType;
    merge: PolicyMerge;
    scopes: readonly PolicyScopeType[];
    ui: PolicyUi;
  }
>;

export type RegionPolicyKey = keyof typeof REGION_POLICY_DEFINITIONS;
export type RegionPolicyValue<K extends RegionPolicyKey> = z.infer<
  (typeof REGION_POLICY_DEFINITIONS)[K]["schema"]
>;
export type RegionPolicyLayer = {
  [K in RegionPolicyKey]?: RegionPolicyValue<K>;
};

/** 一層解析後的結果；invalidKeys 包含未知 key 與不合法的值。會被整份放進 KV。 */
export interface LoadedRegionPolicyLayer {
  values: RegionPolicyLayer;
  invalidKeys: string[];
}

export const REGION_POLICY_KEYS = Object.keys(
  REGION_POLICY_DEFINITIONS,
) as RegionPolicyKey[];

export function isRegionPolicyKey(value: string): value is RegionPolicyKey {
  return Object.hasOwn(REGION_POLICY_DEFINITIONS, value);
}

export function regionPolicyCacheKey(
  scopeType: PolicyScopeType,
  scopeId: string,
): string {
  return `policy:v1:${scopeType}:${scopeId}`;
}

export type PolicyValidationResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      code:
        | "POLICY_KEY_UNKNOWN"
        | "POLICY_SCOPE_NOT_ALLOWED"
        | "POLICY_VALUE_INVALID";
      issues?: unknown;
    };

export function validateRegionPolicyValue(
  key: string,
  scopeType: PolicyScopeType,
  value: unknown,
): PolicyValidationResult {
  if (!isRegionPolicyKey(key)) return { ok: false, code: "POLICY_KEY_UNKNOWN" };
  const definition = REGION_POLICY_DEFINITIONS[key];
  if (!(definition.scopes as readonly PolicyScopeType[]).includes(scopeType)) {
    return { ok: false, code: "POLICY_SCOPE_NOT_ALLOWED" };
  }
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      code: "POLICY_VALUE_INVALID",
      issues: parsed.error.issues,
    };
  }
  return { ok: true, value: parsed.data };
}

export function parseRegionPolicyLayer(
  scopeType: PolicyScopeType,
  rows: ReadonlyArray<{ policyKey: string; value: string }>,
): LoadedRegionPolicyLayer {
  const values: Record<string, unknown> = {};
  const invalidKeys: string[] = [];
  for (const row of rows) {
    let raw: unknown;
    try {
      raw = JSON.parse(row.value);
    } catch {
      invalidKeys.push(row.policyKey);
      continue;
    }
    const result = validateRegionPolicyValue(row.policyKey, scopeType, raw);
    if (result.ok) values[row.policyKey] = result.value;
    else invalidKeys.push(row.policyKey);
  }
  return { values: values as RegionPolicyLayer, invalidKeys };
}

export interface EffectiveRegionPolicies {
  modulesDisabled: ReadonlySet<ModuleKey>;
  /** null = 不限制 */
  allowedProviders: ReadonlySet<NativePaymentProvider> | null;
  /** 小數（0.05 = 5%）；null = 沒有政策預設 */
  defaultTaxRate: number | null;
  defaultServiceChargeRate: number | null;
  /** null = 不限制；trial 永遠允許、不在這裡 */
  allowedPaidTiers: ReadonlySet<PaidPlanTier> | null;
  maxFeeRateBps: number | null;
  /** 資料無效的上限類與平台類 key；讀到它們的執行點必須回 503 */
  unavailableKeys: ReadonlySet<RegionPolicyKey>;
}

export function mergeRegionPolicies(
  country: LoadedRegionPolicyLayer | null,
  market: LoadedRegionPolicyLayer | null,
): EffectiveRegionPolicies {
  const layers = [country, market].filter(
    (layer): layer is LoadedRegionPolicyLayer => layer !== null,
  );

  const unavailableKeys = new Set<RegionPolicyKey>();
  for (const layer of layers) {
    for (const key of layer.invalidKeys) {
      if (
        isRegionPolicyKey(key) &&
        REGION_POLICY_DEFINITIONS[key].merge !== "default"
      ) {
        unavailableKeys.add(key);
      }
    }
  }

  const modulesDisabled = new Set<ModuleKey>(
    layers.flatMap((layer) => layer.values["modules.disabled"] ?? []),
  );

  let allowedProviders: Set<NativePaymentProvider> | null = null;
  for (const layer of layers) {
    const list = layer.values["payments.allowed_providers"];
    if (!list) continue;
    const previous: Set<NativePaymentProvider> | null = allowedProviders;
    allowedProviders = previous
      ? new Set(list.filter((provider) => previous.has(provider)))
      : new Set(list);
  }

  const countryValues = country?.values;
  const taxBps = countryValues?.["pricing.default_tax_rate_bps"] ?? null;
  const serviceBps =
    countryValues?.["pricing.default_service_charge_rate_bps"] ?? null;
  const tiers = countryValues?.["plans.allowed_tiers"];

  return {
    modulesDisabled,
    allowedProviders,
    defaultTaxRate: taxBps === null ? null : taxBps / 10000,
    defaultServiceChargeRate: serviceBps === null ? null : serviceBps / 10000,
    allowedPaidTiers: tiers ? new Set(tiers) : null,
    maxFeeRateBps: countryValues?.["platform.max_fee_rate_bps"] ?? null,
    unavailableKeys,
  };
}

export const EMPTY_REGION_POLICIES: EffectiveRegionPolicies =
  mergeRegionPolicies(null, null);

export interface RegionPolicyDescriptor {
  key: RegionPolicyKey;
  merge: PolicyMerge;
  scopes: readonly PolicyScopeType[];
  ui: PolicyUi;
}

export function describeRegionPolicies(): RegionPolicyDescriptor[] {
  return REGION_POLICY_KEYS.map((key) => {
    const definition = REGION_POLICY_DEFINITIONS[key];
    return {
      key,
      merge: definition.merge,
      scopes: definition.scopes,
      ui: definition.ui,
    };
  });
}
```

在 `packages/database/src/index.ts` 的 `export * from "./utils/plan-quotas";` 下一行加上：

```ts
export * from "./utils/region-policies";
```

- [ ] **Step 5：`NativePaymentProvider` 只保留一個來源**

`apps/api/src/shared/utils/provider-money.ts` 第 53–59 行原本是：

```ts
export type NativePaymentProvider =
  | "stripe"
  | "linepay"
  | "ecpay"
  | "newebpay"
  | "tng"
  | "grabpay";
```

換成（`import type` 放到檔頭的 import 區）：

```ts
import type { NativePaymentProvider } from "@makanmasak/database";
export type { NativePaymentProvider };
```

- [ ] **Step 6：確認通過**

Run: `cd packages/database && pnpm exec vitest run src/utils/region-policies.test.ts`
Expected：PASS。

Run: `pnpm exec turbo run typecheck --filter=@makanmasak/database --filter=@makanmasak/shared-types --filter=@makanmasak/api`
Expected：PASS。

- [ ] **Step 7：Commit**

```bash
git add packages/shared-types/src/locale.ts packages/database/src/utils/region-policies.ts packages/database/src/utils/region-policies.test.ts packages/database/src/index.ts apps/api/src/shared/utils/provider-money.ts
git commit -m "feat(policies): add region policy registry and merge rules"
```

---

### Task 2：資料表與 migration（`policies`、`markets.country_code`）

**Files:**
- Create: `packages/database/migrations_fresh/0030_policies.sql`
- Create: `packages/database/migrations_fresh/0031_market_country_code.sql`
- Create: `packages/database/src/schema/policies.ts`
- Modify: `packages/database/src/schema/markets.ts`（`city` 欄位之後、索引區塊）
- Modify: `packages/database/src/schema/index.ts`（在 `export * from "./restaurant-alerts";` 下一行）
- Modify: `packages/database/migration-dual-track.json`（`freshOnly` 陣列最後）
- Test: `packages/database/src/schema/policies.test.ts`

**Interfaces:**
- Produces：`regionPolicies`（SQL 表名 `policies`，欄位 `id, scopeType, scopeId, policyKey, value, updatedBy, createdAt, updatedAt`）；`markets.countryCode: SupportedCountryCode | null`

- [ ] **Step 1：寫失敗的測試**

`packages/database/src/schema/policies.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { COUNTRY_PROFILES } from "@makanmasak/shared-types";
import { markets, regionPolicies } from "./index";

describe("policies schema", () => {
  it("maps to the policies table with ms timestamps", () => {
    const config = getTableConfig(regionPolicies);
    expect(config.name).toBe("policies");
    expect(config.columns.map((c) => c.name)).toEqual([
      "id",
      "scope_type",
      "scope_id",
      "policy_key",
      "value",
      "updated_by",
      "created_at_ms",
      "updated_at_ms",
    ]);
    const unique = config.indexes.find(
      (index) => index.config.name === "policies_scope_key_idx",
    );
    expect(unique?.config.unique).toBe(true);
  });

  it("gives markets a country code", () => {
    expect(getTableConfig(markets).columns.map((c) => c.name)).toContain(
      "country_code",
    );
  });

  it("backfills every profile city in 0031", () => {
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          "../../migrations_fresh/0031_market_country_code.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    for (const profile of Object.values(COUNTRY_PROFILES)) {
      for (const city of profile.cities) {
        expect(sql, `${profile.countryCode} ${city}`).toContain(`'${city}'`);
      }
    }
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd packages/database && pnpm exec vitest run src/schema/policies.test.ts`
Expected：FAIL。

- [ ] **Step 3：Drizzle schema**

`packages/database/src/schema/policies.ts`：

```ts
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import type { PolicyScopeType } from "../utils/region-policies";

/**
 * 國家層與市集層的地區政策。每列是某個範圍的一個 key；value 是 JSON，
 * 合法性由 utils/region-policies.ts 的登記表決定，寫入與讀取都經過它。
 * 修改歷史記在 audit_logs（resource = 'policies'），不在這張表。
 */
export const regionPolicies = sqliteTable(
  "policies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    scopeType: text("scope_type").notNull().$type<PolicyScopeType>(),
    scopeId: text("scope_id").notNull(),
    policyKey: text("policy_key").notNull(),
    value: text("value").notNull(),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    scopeKeyIdx: uniqueIndex("policies_scope_key_idx").on(
      table.scopeType,
      table.scopeId,
      table.policyKey,
    ),
  }),
);

export type RegionPolicyRow = typeof regionPolicies.$inferSelect;
```

在 `packages/database/src/schema/index.ts` 的 `export * from "./restaurant-alerts";` 下一行加上 `export * from "./policies";`。

在 `packages/database/src/schema/markets.ts` 的 `markets` 表：在 `city: text("city").notNull(),` 下一行加上

```ts
    // 市集所在國。收平台費（platform_fee_rate_bps > 0）的市集必須有值，
    // 國家層的費率上限依它套用；NULL = 未知，不可當成任何國家。
    countryCode: text("country_code").$type<SupportedCountryCode>(),
```

在該表的索引區塊加上

```ts
    countryCodeIdx: index("markets_country_code_idx").on(table.countryCode),
```

並在檔頭加上 `import type { SupportedCountryCode } from "@makanmasak/shared-types";`（`restaurants.ts` 也是這樣匯入的）。

- [ ] **Step 4：Migration**

`packages/database/migrations_fresh/0030_policies.sql`：

```sql
-- 地區政策：國家層（scope_type = 'country'，scope_id = 'TW'／'MY'）與
-- 市集層（scope_type = 'market'，scope_id = markets.id）。店家層不在這裡，
-- 沿用 shop_subscriptions.module_overrides 與 restaurants.settings。
-- value 是 JSON，合法性由 packages/database/src/utils/region-policies.ts
-- 的登記表把關。新表，舊程式不會碰：表是空的時候系統行為不變。
CREATE TABLE `policies` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `scope_type` TEXT NOT NULL CHECK (`scope_type` IN ('country', 'market')),
  `scope_id` TEXT NOT NULL,
  `policy_key` TEXT NOT NULL,
  `value` TEXT NOT NULL,
  `updated_by` TEXT,
  `created_at_ms` INTEGER NOT NULL,
  `updated_at_ms` INTEGER NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `policies_scope_key_idx`
  ON `policies` (`scope_type`, `scope_id`, `policy_key`);
```

`packages/database/migrations_fresh/0031_market_country_code.sql`：

```sql
-- 市集所在國（ISO 3166-1 alpha-2）。國家層的平台費率上限依它套用；
-- 之前只能用 markets.city 文字反查，對不到就會靜默地不套上限。
--
-- ALTER TABLE ... ADD COLUMN 不改變表的 STRICT 屬性，不必重建。允許 NULL：
-- 城市名稱對不到清單的市集留給人工處理，應用程式禁止這類市集收平台費。
--
-- 回填只認 COUNTRY_PROFILES（packages/shared-types/src/locale.ts）裡的
-- 城市名稱，完全符合才填；policies.test.ts 會檢查兩份清單一致。
ALTER TABLE `markets` ADD COLUMN `country_code` TEXT;
--> statement-breakpoint
CREATE INDEX `markets_country_code_idx` ON `markets` (`country_code`);
--> statement-breakpoint
UPDATE `markets` SET `country_code` = 'TW'
 WHERE `country_code` IS NULL
   AND `city` IN ('臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市',
                  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
                  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
                  '臺東縣', '澎湖縣', '金門縣', '連江縣', '台中市');
--> statement-breakpoint
UPDATE `markets` SET `country_code` = 'MY'
 WHERE `country_code` IS NULL
   AND `city` IN ('Kuala Lumpur', 'Putrajaya', 'Labuan', 'Johor', 'Kedah',
                  'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak',
                  'Perlis', 'Penang', 'Sabah', 'Sarawak', 'Selangor',
                  'Terengganu');
```

在 `packages/database/migration-dual-track.json` 的 `freshOnly` 陣列裡，`0029_…` 那筆之後加上：

```json
    {
      "fresh": "0030_policies.sql",
      "reason": "Region policies scope platform-API restaurants by country and market; the management-api database has no restaurants or markets rows to scope a policy against. management-api edits them through its PLATFORM_DB binding instead."
    },
    {
      "fresh": "0031_market_country_code.sql",
      "reason": "markets is a platform-API table; the management-api database has no markets row to carry a country on."
    }
```

- [ ] **Step 5：確認通過，並跑 migration 相關的檢查**

Run: `cd packages/database && pnpm exec vitest run src/schema/policies.test.ts && pnpm test`
Expected：PASS。如果有 schema 與 migration 的一致性測試要求登記新表或新欄位，照它的錯誤訊息補上，不要修改測試本身。

Run: `pnpm check:migration-dual-track && pnpm check:strict-tables && pnpm db:migrate:local`
Expected：三個都成功，`0030`、`0031` 都已套用。

- [ ] **Step 6：Commit**

```bash
git add packages/database/migrations_fresh/0030_policies.sql packages/database/migrations_fresh/0031_market_country_code.sql packages/database/src/schema packages/database/migration-dual-track.json
git commit -m "feat(database): add policies table and market country code"
```

---

### Task 3：解析器與檢查函式（`apps/api`）

**Files:**
- Create: `apps/api/src/shared/policy/regionPolicies.ts`
- Create: `apps/api/src/shared/policy/regionPolicyGuards.ts`
- Test: `apps/api/src/shared/policy/regionPolicies.test.ts`（real D1 + real KV）

**Interfaces:**
- Consumes：Task 1、Task 2 的產出
- Produces：
  - `interface RegionPolicyDeps { DB: D1Database; CACHE_KV?: KVNamespace }`
  - `resolveRegionPolicies(deps, { countryCode, marketId? }): Promise<EffectiveRegionPolicies>`（讀取失敗時丟 503 `POLICY_UNAVAILABLE`）
  - `requirePolicy(effective, key: RegionPolicyKey): void`（key 在 `unavailableKeys` 裡就丟 503）
  - `policyUnavailable(cause): ApiError`
  - `restaurantCountryCode(db, restaurantId)`、`marketIdBySlug(db, slug)`
  - `assertPaymentProviderAllowed(deps, { restaurantId, provider, marketSlug? })` → 403 `PAYMENT_PROVIDER_NOT_ALLOWED`
  - `assertPlanTierAllowed(deps, { restaurantId, planTier })` → 400 `PLAN_NOT_AVAILABLE_IN_REGION`
  - `assertMarketFeeWithinRegionCap(deps, { countryCode, platformFeeRateBps })` → 400 `MARKET_COUNTRY_REQUIRED`／`PLATFORM_FEE_ABOVE_REGION_CAP`
  - `resolvePricingRates(deps, { countryCode, settings })` → `{ taxRate, serviceChargeRate }`

- [ ] **Step 1：寫失敗的測試**

`apps/api/src/shared/policy/regionPolicies.test.ts`：

```ts
/**
 * 解析器與檢查函式對 real D1（migrations_fresh，含 0030／0031）與 real KV 的行為。
 * 放在預設 unit project，理由同 ShopPaymentCredentialService.test.ts。
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { markets, regionPolicies } from "@makanmasak/database";
import {
  createTestDatabase,
  REAL_D1_SETUP_TIMEOUT_MS,
  type TestDatabase,
} from "@makanmasak/database/testing";
import {
  buildSeedHelpers,
  type SeedHelpers,
} from "../../__tests__/integration/helpers/seed-helper";
import {
  marketIdBySlug,
  resolveRegionPolicies,
  restaurantCountryCode,
} from "./regionPolicies";
import {
  assertMarketFeeWithinRegionCap,
  assertPaymentProviderAllowed,
  assertPlanTierAllowed,
  resolvePricingRates,
} from "./regionPolicyGuards";

describe("region policies against real D1", () => {
  let testDb: TestDatabase;
  let seed: SeedHelpers;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    seed = buildSeedHelpers(testDb);
  }, REAL_D1_SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await testDb?.dispose();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const deps = () => ({
    DB: testDb.bindings.DB,
    CACHE_KV: testDb.bindings.CACHE_KV,
  });

  const brokenKv = () => ({
    DB: testDb.bindings.DB,
    CACHE_KV: {
      get: vi.fn().mockRejectedValue(new Error("kv down")),
    } as unknown as KVNamespace,
  });

  async function setPolicy(
    scopeType: "country" | "market",
    scopeId: string,
    policyKey: string,
    value: string,
  ) {
    await testDb.drizzle
      .insert(regionPolicies)
      .values({ scopeType, scopeId, policyKey, value });
    await testDb.bindings.CACHE_KV.delete(`policy:v1:${scopeType}:${scopeId}`);
  }

  async function seedMarket(id: string, slug: string, city: string) {
    const now = new Date();
    await testDb.drizzle.insert(markets).values({
      id,
      slug,
      name: slug,
      type: "night_market",
      city,
      district: "Central",
      address: "1 Market Road",
      latitude: 0,
      longitude: 0,
      createdAt: now,
      updatedAt: now,
    } as never);
  }

  const myShop = () =>
    seed.restaurant({ countryCode: "MY", settings: { currency: "MYR" } });

  it("enforces STRICT and the scope/key unique index", async () => {
    await setPolicy("country", "MY", "modules.disabled", "[]");
    await expect(
      setPolicy("country", "MY", "modules.disabled", '["pos"]'),
    ).rejects.toThrow();
    const { results } = await testDb.bindings.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE name = 'policies'",
    ).all<{ sql: string }>();
    expect(results[0]!.sql.trim().endsWith(") STRICT")).toBe(true);
  });

  it("returns empty policies for an unknown country", async () => {
    const effective = await resolveRegionPolicies(deps(), { countryCode: null });
    expect(effective.modulesDisabled.size).toBe(0);
    expect(effective.allowedProviders).toBeNull();
  });

  it("merges the country and market layers", async () => {
    await seedMarket("m-1", "jalan-alor", "Kuala Lumpur");
    await setPolicy("country", "MY", "payments.allowed_providers", '["tng","grabpay"]');
    await setPolicy("market", "m-1", "payments.allowed_providers", '["tng"]');

    const effective = await resolveRegionPolicies(deps(), {
      countryCode: "MY",
      marketId: "m-1",
    });
    expect([...effective.allowedProviders!]).toEqual(["tng"]);
  });

  it("serves the layer from KV after the first read", async () => {
    await setPolicy("country", "MY", "modules.disabled", '["pos"]');
    await resolveRegionPolicies(deps(), { countryCode: "MY" });
    await testDb.drizzle.delete(regionPolicies);

    const effective = await resolveRegionPolicies(deps(), { countryCode: "MY" });
    expect([...effective.modulesDisabled]).toEqual(["pos"]);
  });

  it("works without KV", async () => {
    await setPolicy("country", "MY", "modules.disabled", '["pos"]');
    const effective = await resolveRegionPolicies(
      { DB: testDb.bindings.DB },
      { countryCode: "MY" },
    );
    expect([...effective.modulesDisabled]).toEqual(["pos"]);
  });

  it("drops a corrupt default but keeps it out of unavailableKeys", async () => {
    await setPolicy("country", "MY", "pricing.default_tax_rate_bps", "oops");
    const effective = await resolveRegionPolicies(deps(), { countryCode: "MY" });
    expect(effective.defaultTaxRate).toBeNull();
    expect(effective.unavailableKeys.size).toBe(0);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("invalid policy rows"),
      expect.objectContaining({ keys: ["pricing.default_tax_rate_bps"] }),
    );
  });

  it("blocks a charge when the provider policy is corrupt", async () => {
    const shop = await myShop();
    await setPolicy("country", "MY", "payments.allowed_providers", '["nope"]');
    await expect(
      assertPaymentProviderAllowed(deps(), {
        restaurantId: shop.id,
        provider: "tng",
      }),
    ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
  });

  it("fails closed when the store is down", async () => {
    const shop = await myShop();
    const broken = brokenKv();
    await expect(
      assertPaymentProviderAllowed(broken, {
        restaurantId: shop.id,
        provider: "tng",
      }),
    ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
    expect(broken.CACHE_KV.get).toHaveBeenCalledWith(
      "policy:v1:country:MY",
      "json",
    );
  });

  it("fails closed when the checkout market cannot be found", async () => {
    const shop = await myShop();
    await expect(
      assertPaymentProviderAllowed(deps(), {
        restaurantId: shop.id,
        provider: "tng",
        marketSlug: "missing",
      }),
    ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE" });
  });

  it("looks up a restaurant country and a market id", async () => {
    const shop = await myShop();
    await seedMarket("m-2", "pasar", "Selangor");
    expect(await restaurantCountryCode(testDb.bindings.DB, shop.id)).toBe("MY");
    expect(await marketIdBySlug(testDb.bindings.DB, "pasar")).toBe("m-2");
    expect(await marketIdBySlug(testDb.bindings.DB, "missing")).toBeNull();
  });

  describe("assertPaymentProviderAllowed", () => {
    it("allows anything when no policy is set", async () => {
      const shop = await myShop();
      await expect(
        assertPaymentProviderAllowed(deps(), {
          restaurantId: shop.id,
          provider: "grabpay",
        }),
      ).resolves.toBeUndefined();
    });

    it("blocks a provider the market excludes", async () => {
      const shop = await myShop();
      await seedMarket("m-3", "night", "Penang");
      await setPolicy("market", "m-3", "payments.allowed_providers", '["tng"]');
      await expect(
        assertPaymentProviderAllowed(deps(), {
          restaurantId: shop.id,
          provider: "grabpay",
          marketSlug: "night",
        }),
      ).rejects.toMatchObject({
        code: "PAYMENT_PROVIDER_NOT_ALLOWED",
        status: 403,
      });
    });
  });

  describe("assertPlanTierAllowed", () => {
    it("always allows trial", async () => {
      const shop = await myShop();
      await setPolicy("country", "MY", "plans.allowed_tiers", '["basic"]');
      await expect(
        assertPlanTierAllowed(deps(), { restaurantId: shop.id, planTier: "trial" }),
      ).resolves.toBeUndefined();
    });

    it("blocks a paid tier the country does not sell", async () => {
      const shop = await myShop();
      await setPolicy("country", "MY", "plans.allowed_tiers", '["basic"]');
      await expect(
        assertPlanTierAllowed(deps(), { restaurantId: shop.id, planTier: "pro" }),
      ).rejects.toMatchObject({ code: "PLAN_NOT_AVAILABLE_IN_REGION", status: 400 });
    });
  });

  describe("assertMarketFeeWithinRegionCap", () => {
    it("lets a free market through without a country", async () => {
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: null,
          platformFeeRateBps: 0,
        }),
      ).resolves.toBeUndefined();
    });

    it("requires a country for a fee-charging market", async () => {
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: null,
          platformFeeRateBps: 100,
        }),
      ).rejects.toMatchObject({ code: "MARKET_COUNTRY_REQUIRED", status: 400 });
    });

    it("enforces the country cap", async () => {
      await setPolicy("country", "TW", "platform.max_fee_rate_bps", "800");
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 900,
        }),
      ).rejects.toMatchObject({ code: "PLATFORM_FEE_ABOVE_REGION_CAP", status: 400 });
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 800,
        }),
      ).resolves.toBeUndefined();
    });

    it("blocks the write when the cap is corrupt", async () => {
      await setPolicy("country", "TW", "platform.max_fee_rate_bps", '"high"');
      await expect(
        assertMarketFeeWithinRegionCap(deps(), {
          countryCode: "TW",
          platformFeeRateBps: 100,
        }),
      ).rejects.toMatchObject({ code: "POLICY_UNAVAILABLE", status: 503 });
    });
  });

  describe("resolvePricingRates", () => {
    it("fills unset rates from the country default", async () => {
      await setPolicy("country", "MY", "pricing.default_tax_rate_bps", "600");
      await expect(
        resolvePricingRates(deps(), {
          countryCode: "MY",
          settings: { serviceChargeRate: 0.1 },
        }),
      ).resolves.toEqual({ taxRate: 0.06, serviceChargeRate: 0.1 });
    });

    it("keeps the shop's own rate over the default", async () => {
      await setPolicy("country", "MY", "pricing.default_tax_rate_bps", "600");
      await expect(
        resolvePricingRates(deps(), {
          countryCode: "MY",
          settings: { taxRate: 0, serviceChargeRate: 0 },
        }),
      ).resolves.toEqual({ taxRate: 0, serviceChargeRate: 0 });
    });

    it("falls back to 0 when the policy store is down", async () => {
      await expect(
        resolvePricingRates(brokenKv(), { countryCode: "MY", settings: null }),
      ).resolves.toEqual({ taxRate: 0, serviceChargeRate: 0 });
    });
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd apps/api && pnpm exec vitest run src/shared/policy/regionPolicies.test.ts`
Expected：FAIL，找不到 `./regionPolicies`。

- [ ] **Step 3：解析器**

`apps/api/src/shared/policy/regionPolicies.ts`：

```ts
/**
 * 讀取並合併國家層與市集層的地區政策。
 * Spec: docs/superpowers/specs/2026-09-23-region-policies-design.md §5
 *
 * 快取以範圍為 key（policy:v1:country:MY），management-api 寫入後刪除同一個
 * key。已知競態：讀取端可能在刪除後才把舊值寫回，舊值最多活一個 TTL，
 * 所以生效保證是「約 6 分鐘內」（TTL 加上 KV 邊緣快取），見 spec §5.2。
 *
 * 讀取失敗一律丟 POLICY_UNAVAILABLE（503）。資料無效的上限類 key 放在
 * unavailableKeys，由 requirePolicy 在執行點轉成 503。
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import {
  EMPTY_REGION_POLICIES,
  markets,
  mergeRegionPolicies,
  parseRegionPolicyLayer,
  regionPolicies,
  regionPolicyCacheKey,
  restaurants,
  type EffectiveRegionPolicies,
  type LoadedRegionPolicyLayer,
  type PolicyScopeType,
  type RegionPolicyKey,
} from "@makanmasak/database";
import {
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { ApiError } from "../utils/api-error";

export const REGION_POLICY_CACHE_TTL_SECONDS = 300;

export interface RegionPolicyDeps {
  DB: D1Database;
  CACHE_KV?: KVNamespace;
}

export function policyUnavailable(cause: unknown): ApiError {
  console.error("[region-policies] policy unavailable", cause);
  return new ApiError(
    "POLICY_UNAVAILABLE",
    "Regional policy is temporarily unavailable",
    503,
  );
}

/** 上限類 key 的資料無效時，讀到它的操作必須阻擋（spec D7）。 */
export function requirePolicy(
  effective: EffectiveRegionPolicies,
  key: RegionPolicyKey,
): void {
  if (effective.unavailableKeys.has(key)) {
    throw policyUnavailable(new Error(`invalid stored policy ${key}`));
  }
}

async function loadLayer(
  deps: RegionPolicyDeps,
  scopeType: PolicyScopeType,
  scopeId: string,
): Promise<LoadedRegionPolicyLayer> {
  const cacheKey = regionPolicyCacheKey(scopeType, scopeId);
  if (deps.CACHE_KV) {
    const cached = await deps.CACHE_KV.get<LoadedRegionPolicyLayer>(
      cacheKey,
      "json",
    );
    if (cached) return cached;
  }

  const rows = await drizzle(deps.DB)
    .select({
      policyKey: regionPolicies.policyKey,
      value: regionPolicies.value,
    })
    .from(regionPolicies)
    .where(
      and(
        eq(regionPolicies.scopeType, scopeType),
        eq(regionPolicies.scopeId, scopeId),
      ),
    );

  const layer = parseRegionPolicyLayer(scopeType, rows);
  if (layer.invalidKeys.length > 0) {
    console.error("[region-policies] invalid policy rows", {
      scopeType,
      scopeId,
      keys: layer.invalidKeys,
    });
  }

  if (deps.CACHE_KV) {
    await deps.CACHE_KV.put(cacheKey, JSON.stringify(layer), {
      expirationTtl: REGION_POLICY_CACHE_TTL_SECONDS,
    });
  }
  return layer;
}

/** 國別不明時跳過國家層；只有明確傳入 marketId 才讀市集層。 */
export async function resolveRegionPolicies(
  deps: RegionPolicyDeps,
  scope: { countryCode: string | null | undefined; marketId?: string | null },
): Promise<EffectiveRegionPolicies> {
  const country = normalizeCountryCode(scope.countryCode);
  const marketId = scope.marketId ?? null;
  if (!country && !marketId) return EMPTY_REGION_POLICIES;

  try {
    const [countryLayer, marketLayer] = await Promise.all([
      country ? loadLayer(deps, "country", country) : null,
      marketId ? loadLayer(deps, "market", marketId) : null,
    ]);
    return mergeRegionPolicies(countryLayer, marketLayer);
  } catch (error) {
    throw policyUnavailable(error);
  }
}

export async function restaurantCountryCode(
  db: D1Database,
  restaurantId: string,
): Promise<SupportedCountryCode | null> {
  const [row] = await drizzle(db)
    .select({ countryCode: restaurants.countryCode })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return normalizeCountryCode(row?.countryCode);
}

export async function marketIdBySlug(
  db: D1Database,
  slug: string,
): Promise<string | null> {
  const [row] = await drizzle(db)
    .select({ id: markets.id })
    .from(markets)
    .where(eq(markets.slug, slug))
    .limit(1);
  return row?.id ?? null;
}
```

- [ ] **Step 4：檢查函式**

`apps/api/src/shared/policy/regionPolicyGuards.ts`：

```ts
/**
 * 各執行點用的地區政策檢查（spec §6 的對照表）。上限類讀不到或資料無效時
 * 丟 503；預設值類讀不到時回到現狀的 0，不擋交易。
 */
import {
  EMPTY_REGION_POLICIES,
  type NativePaymentProvider,
  type PaidPlanTier,
  type PlanTier,
} from "@makanmasak/database";
import type { SupportedCountryCode } from "@makanmasak/shared-types";
import { ApiError } from "../utils/api-error";
import {
  marketIdBySlug,
  policyUnavailable,
  requirePolicy,
  resolveRegionPolicies,
  restaurantCountryCode,
  type RegionPolicyDeps,
} from "./regionPolicies";

async function lookup<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw policyUnavailable(error);
  }
}

/** 只用在新連接、重新啟用與新扣款；退款、查詢、webhook、對帳不可呼叫（spec D11）。 */
export async function assertPaymentProviderAllowed(
  deps: RegionPolicyDeps,
  input: {
    restaurantId: string;
    provider: NativePaymentProvider;
    marketSlug?: string | null;
  },
): Promise<void> {
  const [countryCode, marketId] = await lookup(() =>
    Promise.all([
      restaurantCountryCode(deps.DB, input.restaurantId),
      input.marketSlug ? marketIdBySlug(deps.DB, input.marketSlug) : null,
    ]),
  );
  if (input.marketSlug && !marketId) {
    // 結帳 session 指向不存在的市集是資料不一致；跳過市集層等於失敗開放。
    throw policyUnavailable(new Error(`market ${input.marketSlug} not found`));
  }
  const effective = await resolveRegionPolicies(deps, { countryCode, marketId });
  requirePolicy(effective, "payments.allowed_providers");
  if (
    effective.allowedProviders &&
    !effective.allowedProviders.has(input.provider)
  ) {
    throw new ApiError(
      "PAYMENT_PROVIDER_NOT_ALLOWED",
      `${input.provider} is not available in this region`,
      403,
      { provider: input.provider },
    );
  }
}

export async function assertPlanTierAllowed(
  deps: RegionPolicyDeps,
  input: { restaurantId: string; planTier: PlanTier },
): Promise<void> {
  if (input.planTier === "trial") return;
  const countryCode = await lookup(() =>
    restaurantCountryCode(deps.DB, input.restaurantId),
  );
  const effective = await resolveRegionPolicies(deps, { countryCode });
  requirePolicy(effective, "plans.allowed_tiers");
  if (
    effective.allowedPaidTiers &&
    !effective.allowedPaidTiers.has(input.planTier as PaidPlanTier)
  ) {
    throw new ApiError(
      "PLAN_NOT_AVAILABLE_IN_REGION",
      `The ${input.planTier} plan is not offered in this region`,
      400,
      { planTier: input.planTier },
    );
  }
}

/** 收平台費的市集必須有國別，費率不得超過該國上限（spec D6、D9）。 */
export async function assertMarketFeeWithinRegionCap(
  deps: RegionPolicyDeps,
  input: {
    countryCode: SupportedCountryCode | null;
    platformFeeRateBps: number;
  },
): Promise<void> {
  if (input.platformFeeRateBps === 0) return;
  if (!input.countryCode) {
    throw new ApiError(
      "MARKET_COUNTRY_REQUIRED",
      "A market that charges a platform fee needs a country",
      400,
    );
  }
  const effective = await resolveRegionPolicies(deps, {
    countryCode: input.countryCode,
  });
  requirePolicy(effective, "platform.max_fee_rate_bps");
  const cap = effective.maxFeeRateBps;
  if (cap !== null && input.platformFeeRateBps > cap) {
    throw new ApiError(
      "PLATFORM_FEE_ABOVE_REGION_CAP",
      `Platform fee exceeds the ${input.countryCode} cap`,
      400,
      { maxFeeRateBps: cap, requested: input.platformFeeRateBps },
    );
  }
}

/** 店家自己的設定優先；沒設的那一項才用政策預設，再沒有就是 0（現狀）。 */
export async function resolvePricingRates(
  deps: RegionPolicyDeps,
  input: {
    countryCode: string | null | undefined;
    settings:
      | { taxRate?: number | null; serviceChargeRate?: number | null }
      | null
      | undefined;
  },
): Promise<{ taxRate: number; serviceChargeRate: number }> {
  const ownTax = input.settings?.taxRate ?? null;
  const ownService = input.settings?.serviceChargeRate ?? null;
  if (ownTax !== null && ownService !== null) {
    return { taxRate: ownTax, serviceChargeRate: ownService };
  }

  let effective = EMPTY_REGION_POLICIES;
  try {
    effective = await resolveRegionPolicies(deps, {
      countryCode: input.countryCode,
    });
  } catch {
    // 預設值不擋交易；policyUnavailable 已經記錄錯誤。
  }
  return {
    taxRate: ownTax ?? effective.defaultTaxRate ?? 0,
    serviceChargeRate: ownService ?? effective.defaultServiceChargeRate ?? 0,
  };
}
```

- [ ] **Step 5：確認通過**

Run: `cd apps/api && pnpm exec vitest run src/shared/policy/regionPolicies.test.ts`
Expected：PASS。

- [ ] **Step 6：Commit**

```bash
git add apps/api/src/shared/policy
git commit -m "feat(api): resolve region policies and fail closed on ceilings"
```

---

### Task 4：功能開關（`moduleGate` 與 `/me/modules`）

**Files:**
- Modify: `apps/api/src/middleware/moduleGate.ts`
- Modify: `apps/api/src/features/me/routes/index.ts:17-90`
- Test: `apps/api/src/middleware/moduleGate.region.test.ts`（新）
- Test: `apps/api/src/features/me/routes/` 內既有測試（新增 case，並照需要更新）

**Interfaces:**
- Consumes：Task 3 的 `resolveRegionPolicies`、`requirePolicy`
- Produces：
  - `CachedSubscription.countryCode?: SupportedCountryCode | null`
  - `loadCachedSubscription(env: Pick<Env, "DB" | "CACHE_KV">, restaurantId: string): Promise<CachedSubscription | null>`
  - `regionDisabledModules(env, sub): Promise<ReadonlySet<ModuleKey>>`（資料無效或讀取失敗時丟 503）

- [ ] **Step 1：寫失敗的測試**

`apps/api/src/middleware/moduleGate.region.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { moduleGate } from "./moduleGate";
import { ApiError } from "../shared/utils/api-error";

vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({})),
}));

function kvWith(entries: Record<string, unknown>) {
  return {
    get: vi.fn(async (key: string) => entries[key] ?? null),
    put: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}

const subscription = (countryCode?: string | null) => ({
  isActive: true,
  planTier: "basic",
  moduleOverrides: { pos: true },
  trialEndsAt: null,
  ...(countryCode === undefined ? {} : { countryCode }),
});

const layer = (values: object, invalidKeys: string[] = []) => ({
  values,
  invalidKeys,
});

function buildApp(user: { role: number; restaurantId: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, user as never);
    await next();
  });
  app.onError((err, c) =>
    err instanceof ApiError
      ? c.json(
          { success: false, error: { code: err.code } },
          err.status as 403 | 503,
        )
      : c.json({ success: false }, 500),
  );
  app.get("/pos", moduleGate("pos"), (c) => c.json({ success: true }));
  return app;
}

const call = (app: Hono, kv: ReturnType<typeof kvWith>) =>
  app.fetch(new Request("https://test/pos"), { DB: {}, CACHE_KV: kv } as never);

describe("moduleGate region policies", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("blocks a module the country disabled even with a shop override", async () => {
    const kv = kvWith({
      "subscription:r1": subscription("MY"),
      "policy:v1:country:MY": layer({ "modules.disabled": ["pos"] }),
    });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "MODULE_NOT_AVAILABLE_IN_REGION" },
    });
    expect(kv.get).toHaveBeenCalledWith("policy:v1:country:MY", "json");
  });

  it("skips region policies when the cached entry has no country", async () => {
    const kv = kvWith({ "subscription:r1": subscription() });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);

    expect(res.status).toBe(200);
    expect(kv.get).not.toHaveBeenCalledWith(
      expect.stringMatching(/^policy:/),
      "json",
    );
  });

  it("lets platform admins through", async () => {
    const kv = kvWith({
      "subscription:r1": subscription("MY"),
      "policy:v1:country:MY": layer({ "modules.disabled": ["pos"] }),
    });
    const res = await call(buildApp({ role: 0, restaurantId: "r1" }), kv);
    expect(res.status).toBe(200);
  });

  it("returns 503 when the stored module policy is corrupt", async () => {
    const kv = kvWith({
      "subscription:r1": subscription("MY"),
      "policy:v1:country:MY": layer({}, ["modules.disabled"]),
    });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "POLICY_UNAVAILABLE" },
    });
  });

  it("returns 503 when the policy store fails", async () => {
    const kv = kvWith({ "subscription:r1": subscription("MY") });
    kv.get.mockImplementation(async (key: string) => {
      if (key.startsWith("policy:")) throw new Error("kv down");
      return subscription("MY");
    });
    const res = await call(buildApp({ role: 1, restaurantId: "r1" }), kv);
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd apps/api && pnpm exec vitest run src/middleware/moduleGate.region.test.ts`
Expected：第一個與第四、五個 case FAIL。

- [ ] **Step 3：修改 `moduleGate.ts`**

import 區：把 `restaurants` 加進既有的 `@makanmasak/database` import，另外加上

```ts
import {
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import {
  requirePolicy,
  resolveRegionPolicies,
} from "../shared/policy/regionPolicies";
```

`CachedSubscription` 加一個欄位：

```ts
  /**
   * 店家營業所在國，供地區政策使用。舊的快取項目沒有這個欄位，視同 null
   * （跳過國家政策），TTL 到期後自然補上。所有寫入訂閱快取的地方都必須
   * 經過 loadCachedSubscription，才不會寫出沒有國別的項目。
   */
  countryCode?: SupportedCountryCode | null;
```

把私有的 `getSubscription(c, restaurantId)` 整個換成：

```ts
/**
 * Fetch subscription from KV cache, falling back to DB.
 * Writes through to KV on a cache miss. Every writer of the subscription
 * cache goes through here so the entry always carries `countryCode`.
 */
export async function loadCachedSubscription(
  env: Pick<Env, "DB" | "CACHE_KV">,
  restaurantId: string,
): Promise<CachedSubscription | null> {
  const cacheKey = subscriptionCacheKey(restaurantId);

  const cached = await env.CACHE_KV.get<CachedSubscription>(cacheKey, "json");
  if (cached) return cached;

  const db = drizzle(env.DB);
  const [row] = await db
    .select({
      isActive: shopSubscriptions.isActive,
      planTier: shopSubscriptions.planTier,
      moduleOverrides: shopSubscriptions.moduleOverrides,
      trialEndsAt: shopSubscriptions.trialEndsAt,
    })
    .from(shopSubscriptions)
    .where(eq(shopSubscriptions.restaurantId, restaurantId))
    .limit(1);

  if (!row) return null;

  const [restaurant] = await db
    .select({ countryCode: restaurants.countryCode })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);

  const sub: CachedSubscription = {
    isActive: row.isActive,
    planTier: row.planTier as PlanTier,
    moduleOverrides: (row.moduleOverrides ?? {}) as ModuleMap,
    trialEndsAt: row.trialEndsAt ? row.trialEndsAt.getTime() : null,
    countryCode: normalizeCountryCode(restaurant?.countryCode),
  };

  await env.CACHE_KV.put(cacheKey, JSON.stringify(sub), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

  return sub;
}

/** 國家層關閉的模組；國別不明時是空集合。資料無效或讀取失敗丟 503。 */
export async function regionDisabledModules(
  env: Pick<Env, "DB" | "CACHE_KV">,
  sub: CachedSubscription,
): Promise<ReadonlySet<ModuleKey>> {
  const effective = await resolveRegionPolicies(env, {
    countryCode: sub.countryCode ?? null,
  });
  requirePolicy(effective, "modules.disabled");
  return effective.modulesDisabled;
}
```

middleware 本體：把 `const sub = await getSubscription(c, restaurantId);` 改成 `const sub = await loadCachedSubscription(c.env, restaurantId);`，並在 `if (!resolveModule(sub, module)) { … }` 區塊之後、`await next();` 之前加上：

```ts
    // 地區政策是上限：國家關掉的模組，方案與單店覆寫都開不起來。
    if ((await regionDisabledModules(c.env, sub)).has(module)) {
      throw forbidden(
        "This feature is not available in your region.",
        "MODULE_NOT_AVAILABLE_IN_REGION",
      );
    }
```

- [ ] **Step 4：`/me/modules` 改用共用的載入函式**

在 `apps/api/src/features/me/routes/index.ts` 中：

1. 從 `../../../middleware/moduleGate` 的 import 拿掉 `CACHE_TTL_SECONDS`、`subscriptionCacheKey`、`type CachedSubscription`，改成匯入 `loadCachedSubscription`、`regionDisabledModules`。
2. `router.get("/modules", …)` 裡，從 `const service = new SubscriptionService(c.env.DB);` 一直到該 handler 結尾，整段換成：

```ts
  const service = new SubscriptionService(c.env.DB);
  const sub = await loadCachedSubscription(c.env, restaurantId);

  if (!sub) {
    return c.json({
      success: true,
      data: emptyModuleAccess(restaurantId),
    });
  }

  const effectiveModules = service.getEffectiveModules({
    planTier: sub.planTier,
    moduleOverrides: sub.moduleOverrides,
  } as Parameters<typeof service.getEffectiveModules>[0]);
  for (const module of await regionDisabledModules(c.env, sub)) {
    effectiveModules[module] = false;
  }

  return c.json({
    success: true,
    data: {
      restaurantId,
      planTier: sub.planTier,
      isActive: sub.isActive,
      trialEndsAt: sub.trialEndsAt,
      effectiveModules,
    },
  });
});
```

3. `readCachedSubscription` 如果已經沒有其他呼叫者，就刪掉。第 122 行附近 `/usage` 對 `subscriptionCacheKey` 的使用：先讀懂它在做什麼。如果它會**寫入**訂閱快取，改成呼叫 `loadCachedSubscription`；如果只是讀取，保留原樣。

- [ ] **Step 5：給 `/me/modules` 補測試**

用 `ls apps/api/src/features/me/routes/*.test.ts` 找到既有的測試檔，照它建立 app 與 env 的方式加上兩個 case：

```ts
it("reports region-disabled modules as off", async () => {
  // CACHE_KV.get 的回傳：
  //   "subscription:<restaurantId>" → { isActive: true, planTier: "pro",
  //     moduleOverrides: {}, trialEndsAt: null, countryCode: "MY" }
  //   "policy:v1:country:MY" → { values: { "modules.disabled": ["pos"] }, invalidKeys: [] }
  // 用 role 1、同一個 restaurantId 的使用者呼叫 GET /modules
  expect(body.data.effectiveModules.pos).toBe(false);
  expect(body.data.effectiveModules.menu_management).toBe(true);
});

it("writes the country into the subscription cache on a miss", async () => {
  // CACHE_KV.get 一律回傳 null；mock 的 DB 先回傳訂閱列，再回傳 { countryCode: "MY" }
  expect(env.CACHE_KV.put).toHaveBeenCalledWith(
    "subscription:<restaurantId>",
    expect.stringContaining('"countryCode":"MY"'),
    expect.objectContaining({ expirationTtl: 300 }),
  );
});
```

把註解換成該檔 helper 的實際 mock 設定。既有測試如果斷言了 `CACHE_KV.put` 的內容，更新成包含 `countryCode`。

- [ ] **Step 6：確認通過**

Run: `cd apps/api && pnpm exec vitest run src/middleware src/features/me module-gate`
Expected：PASS。22 個既有的 module-gate 測試不必修改；如果失敗，檢查那個測試的 FakeKv 是不是把任何 key 都對應到訂閱資料（對 `policy:` key 應該回 null）。

- [ ] **Step 7：Commit**

```bash
git add apps/api/src/middleware apps/api/src/features/me
git commit -m "feat(api): enforce region-disabled modules in moduleGate"
```

---

### Task 5：金流可用性（`shop-payments`）

**Files:**
- Modify: `apps/api/src/features/shop-payments/services/ShopPaymentCredentialService.ts`（`assertProviderSuitsRestaurant` 約 :269；新增 `assertChargeAllowed`）
- Modify: `apps/api/src/features/shop-payments/services/ShopWalletMarketCheckoutGateway.ts`（`ShopWalletMarketCheckoutGateway` 的 constructor 與 `process`，約 :128–150）
- Modify: `apps/api/src/features/shop-payments/services/ShopWalletMarketCheckoutGateway.test.ts`（`credentialsStub` 約 :26 與新 case）
- Test: `apps/api/src/features/shop-payments/services/ShopPaymentCredentialService.test.ts`（新 case）

**Interfaces:**
- Consumes：Task 3 的 `assertPaymentProviderAllowed`
- Produces：`ShopPaymentCredentialService.assertChargeAllowed(restaurantId: string, provider: ShopPaymentProvider, marketSlug: string): Promise<void>`
- **不變**：`loadGatewayCredentials` 的簽名與行為；`refundShopWalletMarketCheckoutPayment` 的 `credentials` 型別維持 `Pick<…, "loadGatewayCredentials">`

- [ ] **Step 1：寫失敗的測試（real D1）**

在 `ShopPaymentCredentialService.test.ts` 最外層 `describe` 內、`describe("connect", …)` 之後加上。檔頭把 `regionPolicies`、`markets` 加進 `@makanmasak/database` 的 import：

```ts
  describe("region payment policy", () => {
    async function allowOnly(
      scopeType: "country" | "market",
      scopeId: string,
      providers: string[],
    ) {
      await testDb.drizzle.insert(regionPolicies).values({
        scopeType,
        scopeId,
        policyKey: "payments.allowed_providers",
        value: JSON.stringify(providers),
      });
    }

    const myShopInMy = () =>
      seed.restaurant({
        countryCode: "MY",
        settings: { allowOnlineOrdering: true, allowGuestOrders: true, currency: "MYR" },
      });

    async function seedMarket() {
      const now = new Date();
      await testDb.drizzle.insert(markets).values({
        id: "m-policy",
        slug: "policy-market",
        name: "Policy Market",
        type: "night_market",
        city: "Kuala Lumpur",
        district: "Bukit Bintang",
        address: "Jalan Alor",
        latitude: 3.14,
        longitude: 101.7,
        createdAt: now,
        updatedAt: now,
      } as never);
    }

    it("refuses to connect a provider the country does not allow", async () => {
      const shop = await myShopInMy();
      await allowOnly("country", "MY", ["tng"]);
      await expect(
        service().connect(shop.id, "grabpay", connectInput()),
      ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_NOT_ALLOWED", status: 403 });
    });

    it("refuses to re-enable a connection the country no longer allows", async () => {
      const shop = await myShopInMy();
      await service().connect(shop.id, "grabpay", connectInput());
      await service().update(shop.id, "grabpay", { status: "disabled" });
      await allowOnly("country", "MY", ["tng"]);
      await expect(
        service().update(shop.id, "grabpay", { status: "connected" }),
      ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_NOT_ALLOWED" });
    });

    it("blocks a new charge the market excludes", async () => {
      const shop = await myShopInMy();
      await seedMarket();
      await allowOnly("market", "m-policy", ["tng"]);
      await expect(
        service().assertChargeAllowed(shop.id, "grabpay", "policy-market"),
      ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_NOT_ALLOWED" });
      await expect(
        service().assertChargeAllowed(shop.id, "tng", "policy-market"),
      ).resolves.toBeUndefined();
    });

    it("keeps loading credentials for refunds after the policy tightens", async () => {
      const shop = await myShopInMy();
      await service().connect(shop.id, "grabpay", connectInput());
      await allowOnly("country", "MY", ["tng"]);
      await expect(
        service().loadGatewayCredentials(shop.id, "grabpay"),
      ).resolves.toMatchObject({ provider: "grabpay" });
    });
  });
```

如果 `update` 的 input 型別名稱或狀態值不是 `"disabled"`／`"connected"`，照 `UpdateShopPaymentCredentialInput` 實際定義調整。

- [ ] **Step 2：寫失敗的測試（gateway）**

在 `ShopWalletMarketCheckoutGateway.test.ts`：

1. `credentialsStub` 的型別與內容加上 `assertChargeAllowed`：

```ts
function credentialsStub(byRestaurant: Record<string, string> = {}): Pick<
  ShopPaymentCredentialService,
  "loadGatewayCredentials" | "assertChargeAllowed"
> & {
  loadGatewayCredentials: Mock;
  assertChargeAllowed: Mock;
} {
  return {
    loadGatewayCredentials: vi.fn(async (restaurantId: string) => ({
      provider: "tng" as const,
      merchantId: byRestaurant[restaurantId] ?? "TNG-MERCHANT-7788",
      environment: "sandbox" as const,
      secret: { merchantKey: "never-on-the-wire" },
    })),
    assertChargeAllowed: vi.fn(async () => {}),
  };
}
```

2. 在 `describe("ShopWalletMarketCheckoutGateway", …)`（或檔內測試 `process` 的那個 describe）加上：

```ts
  it("checks the region policy for every vendor before charging", async () => {
    const credentials = credentialsStub();
    const { gateway, calls } = gatewayStub();
    await new ShopWalletMarketCheckoutGateway(env, "tng", gateway, credentials).process(
      splitInput(),
    );
    for (const restaurantId of new Set(splitInput().allocations.map((a) => a.restaurantId))) {
      expect(credentials.assertChargeAllowed).toHaveBeenCalledWith(
        restaurantId,
        "tng",
        "jalan-alor",
      );
    }
    expect(calls).toHaveLength(1);
  });

  it("does not charge when the region refuses the provider", async () => {
    const credentials = credentialsStub();
    credentials.assertChargeAllowed.mockRejectedValueOnce(
      new ApiError("PAYMENT_PROVIDER_NOT_ALLOWED", "no", 403),
    );
    const { gateway, calls } = gatewayStub();
    await expect(
      new ShopWalletMarketCheckoutGateway(env, "tng", gateway, credentials).process(
        splitInput(),
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_NOT_ALLOWED" });
    expect(calls).toHaveLength(0);
  });
```

3. 在 `describe("refundShopWalletMarketCheckoutPayment", …)` 裡，照既有 refund case 呼叫的參數加上：

```ts
  it("refunds without consulting region policy", async () => {
    const credentials = credentialsStub();
    credentials.assertChargeAllowed.mockRejectedValue(
      new ApiError("PAYMENT_PROVIDER_NOT_ALLOWED", "no", 403),
    );
    // 用既有 refund case 的 input 與 gateway 呼叫 refundShopWalletMarketCheckoutPayment(env, input, gateway, credentials)
    expect(result).toMatchObject({ /* 與既有 refund case 相同的成功斷言 */ });
    expect(credentials.assertChargeAllowed).not.toHaveBeenCalled();
  });
```

把註解換成既有 refund case 的實際 input 與斷言。如果 `ApiError` 還沒在檔頭匯入，從 `../../../shared/utils/api-error` 匯入。

- [ ] **Step 3：確認測試失敗**

Run: `cd apps/api && pnpm exec vitest run src/features/shop-payments`
Expected：新 case FAIL（`assertChargeAllowed` 不存在或沒被呼叫）；typecheck 也會因為 `assertChargeAllowed` 不存在而失敗。

- [ ] **Step 4：實作**

`ShopPaymentCredentialService.ts` 的 import 區加上：

```ts
import { assertPaymentProviderAllowed } from "../../../shared/policy/regionPolicyGuards";
```

`assertProviderSuitsRestaurant` 的第一行（`resolveRestaurantCurrency` 之前）加上下面這行。`connect`，以及 `update` 在改回 connected 或換 merchantId 時，都已經會呼叫它：

```ts
    // 新連接與重新啟用只看國家層；這時沒有市集情境（spec §6）。
    await assertPaymentProviderAllowed(this.env, { restaurantId, provider });
```

在 class 裡、`loadGatewayCredentials` 之前新增：

```ts
  /**
   * 新扣款前的地區政策檢查（國家層加市集層）。只給 charge 用：
   * 退款、狀態查詢、webhook、對帳不可呼叫，政策收緊不能讓已成立的
   * 交易無法退款（spec D11）。loadGatewayCredentials 刻意不做這個檢查。
   */
  async assertChargeAllowed(
    restaurantId: string,
    provider: ShopPaymentProvider,
    marketSlug: string,
  ): Promise<void> {
    await assertPaymentProviderAllowed(this.env, {
      restaurantId,
      provider,
      marketSlug,
    });
  }
```

`ShopWalletMarketCheckoutGateway.ts`：constructor 的 `credentials` 型別加上 `assertChargeAllowed`：

```ts
    private readonly credentials: Pick<
      ShopPaymentCredentialService,
      "loadGatewayCredentials" | "assertChargeAllowed"
    > = new ShopPaymentCredentialService(env),
```

`process` 裡，在 `resolveSharedMerchantAccount(…)` 之後、建立 adapter 之前加上：

```ts
    // 新扣款才檢查地區政策；refundShopWalletMarketCheckoutPayment 不經過這裡。
    for (const restaurantId of new Set(
      input.allocations.map((a) => a.restaurantId),
    )) {
      await this.credentials.assertChargeAllowed(
        restaurantId,
        this.provider,
        input.marketSlug,
      );
    }
```

`refundShopWalletMarketCheckoutPayment` 與 `resolveSharedMerchantAccount` **不要修改**。

- [ ] **Step 5：確認通過**

Run: `cd apps/api && pnpm exec vitest run src/features/shop-payments src/features/market-checkouts`
Expected：PASS。

- [ ] **Step 6：Commit**

```bash
git add apps/api/src/features/shop-payments
git commit -m "feat(api): enforce region payment providers on new shop-wallet charges"
```

---

### Task 6：可販售方案（`subscriptions`）

**Files:**
- Modify: `apps/api/src/features/subscriptions/routes/index.ts`（`router.post("/")` 約 :168、`router.patch("/:restaurantId/plan")` 約 :217）
- Test: 既有的 subscriptions route 測試檔（`ls apps/api/src/features/subscriptions/routes/`）

**Interfaces:**
- Consumes：Task 3 的 `assertPlanTierAllowed`

- [ ] **Step 1：寫失敗的測試**

在既有的 route 測試檔加上 guard 的 mock，並新增三個 case。發請求的方式與 `SubscriptionService` 的 mock 名稱沿用該檔既有的寫法：

```ts
vi.mock("../../../shared/policy/regionPolicyGuards", () => ({
  assertPlanTierAllowed: vi.fn(async () => {}),
}));
import { assertPlanTierAllowed } from "../../../shared/policy/regionPolicyGuards";
import { ApiError } from "../../../shared/utils/api-error";

it("checks the region before changing plan", async () => {
  // PATCH /rest-1/plan  body { planTier: "pro" }
  expect(res.status).toBe(200);
  expect(assertPlanTierAllowed).toHaveBeenCalledWith(
    expect.objectContaining({ DB: expect.anything() }),
    { restaurantId: "rest-1", planTier: "pro" },
  );
});

it("does not change the plan when the region refuses it", async () => {
  vi.mocked(assertPlanTierAllowed).mockRejectedValueOnce(
    new ApiError("PLAN_NOT_AVAILABLE_IN_REGION", "no", 400),
  );
  // PATCH /rest-1/plan  body { planTier: "pro" }
  expect(res.status).toBe(400);
  expect(changePlanMock).not.toHaveBeenCalled();
});

it("checks the region when creating a subscription", async () => {
  // POST /  body { restaurantId: "rest-1", planTier: "basic" }
  expect(assertPlanTierAllowed).toHaveBeenCalledWith(expect.anything(), {
    restaurantId: "rest-1",
    planTier: "basic",
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd apps/api && pnpm exec vitest run src/features/subscriptions`
Expected：新 case FAIL。

- [ ] **Step 3：實作**

在 routes 的 import 區加上 `import { assertPlanTierAllowed } from "../../../shared/policy/regionPolicyGuards";`。

`router.post("/")` 的 handler 裡，在 `const service = …` 之前加上：

```ts
    await assertPlanTierAllowed(c.env, {
      restaurantId: body.restaurantId,
      planTier: body.planTier,
    });
```

`router.patch("/:restaurantId/plan")` 的 handler 裡，在 `const service = …` 之前加上：

```ts
    await assertPlanTierAllowed(c.env, { restaurantId, planTier });
```

`SubscriptionService.provisionDefaultForRestaurant` 與 `BillingCycleService` 的試用到期降級是系統動作，**不要**加檢查（spec §6）。

- [ ] **Step 4：確認通過並 commit**

Run: `cd apps/api && pnpm exec vitest run src/features/subscriptions`
Expected：PASS。

```bash
git add apps/api/src/features/subscriptions
git commit -m "feat(api): refuse plan tiers a region does not sell"
```

---

### Task 7：稅率與服務費預設值（`GroupOrdersService`）

**Files:**
- Modify: `apps/api/src/features/group-orders/services/GroupOrdersService.ts`（約 :2002–2068 與 :3026–3043）

**Interfaces:**
- Consumes：Task 3 的 `resolvePricingRates`（邏輯已在 Task 3 驗證；這裡只做串接，既有的 group-order 測試用來確認沒有退步）

- [ ] **Step 1：拆帳路徑（約 :2002）**

import 區加上 `import { resolvePricingRates } from "../../../shared/policy/regionPolicyGuards";`。

把 `.select({ settings: restaurants.settings })` 改成

```ts
        .select({
          settings: restaurants.settings,
          countryCode: restaurants.countryCode,
        })
```

在 `computeSplitBills({` 之前加上

```ts
      const rates = await resolvePricingRates(
        { DB: this.rawDb, CACHE_KV: this.rawCacheKV },
        { countryCode: restaurant?.countryCode, settings: restaurant?.settings },
      );
```

並把

```ts
        rates: {
          serviceChargeRate: restaurant?.settings?.serviceChargeRate ?? 0,
          taxRate: restaurant?.settings?.taxRate ?? 0,
        },
```

換成 `rates,`。

- [ ] **Step 2：成員小計路徑（約 :3026）**

同樣把 `.select({ settings: restaurants.settings })` 改成也取 `countryCode`，並把

```ts
    const taxRate = restaurant?.settings?.taxRate ?? 0;
    const serviceChargeRate = restaurant?.settings?.serviceChargeRate ?? 0;
```

換成

```ts
    const { taxRate, serviceChargeRate } = await resolvePricingRates(
      { DB: this.rawDb, CACHE_KV: this.rawCacheKV },
      { countryCode: restaurant?.countryCode, settings: restaurant?.settings },
    );
```

- [ ] **Step 3：確認沒有退步並 commit**

Run: `cd apps/api && pnpm exec vitest run src/features/group-orders`
Expected：PASS。既有 mock 的店家列沒有 `countryCode`，`resolvePricingRates` 會直接用 `EMPTY_REGION_POLICIES`，不會碰 DB。

```bash
git add apps/api/src/features/group-orders/services/GroupOrdersService.ts
git commit -m "feat(api): default group-order tax and service rates from region policy"
```

---

### Task 8：市集國別與費率上限（`apps/api` 市集管理）

**Files:**
- Create: `apps/api/src/features/markets/services/market-country.ts`
- Create: `apps/api/src/features/markets/services/market-country.test.ts`
- Modify: `apps/api/src/features/markets/schemas/validation.ts:134-162`（`createMarketSchema`）
- Modify: `apps/api/src/features/markets/services/MarketsService.ts`（`CreateMarketInput`／`UpdateMarketInput`，若為手寫型別）
- Modify: `apps/api/src/features/markets/routes/admin.ts`（`routes.post("/")` 約 :491、`routes.post("/bulk")` 約 :498、`routes.put("/:id")` 約 :570）
- Test: `apps/api/src/features/markets/routes/admin.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `countryForCity`；Task 3 的 `assertMarketFeeWithinRegionCap`
- Produces：`resolveMarketCountry(input: { countryCode?: SupportedCountryCode | null; city: string }): SupportedCountryCode | null`（不一致時丟 400 `MARKET_COUNTRY_CITY_MISMATCH`）

- [ ] **Step 1：寫失敗的測試**

`apps/api/src/features/markets/services/market-country.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { resolveMarketCountry } from "./market-country";

describe("resolveMarketCountry", () => {
  it("derives the country from a known city", () => {
    expect(resolveMarketCountry({ city: "台中市" })).toBe("TW");
    expect(resolveMarketCountry({ city: "Penang" })).toBe("MY");
  });

  it("returns null for an unknown city with no explicit country", () => {
    expect(resolveMarketCountry({ city: "Taichung" })).toBeNull();
  });

  it("accepts an explicit country for an unknown city", () => {
    expect(resolveMarketCountry({ city: "Taichung", countryCode: "TW" })).toBe("TW");
  });

  it("rejects an explicit country that contradicts the city", () => {
    expect(() =>
      resolveMarketCountry({ city: "台中市", countryCode: "MY" }),
    ).toThrow(expect.objectContaining({ code: "MARKET_COUNTRY_CITY_MISMATCH" }));
  });
});
```

在 `admin.test.ts` 加上 guard 的 mock 與新 case（`marketsFns` 和發請求的方式沿用檔內既有的寫法；如果 `marketsFns` 沒有 `getMarketById`、`createMarketsBulk`，把它們以 `vi.fn()` 加進檔頂的 mock 物件）：

```ts
vi.mock("../../../shared/policy/regionPolicyGuards", () => ({
  assertMarketFeeWithinRegionCap: vi.fn(async () => {}),
}));
import { assertMarketFeeWithinRegionCap } from "../../../shared/policy/regionPolicyGuards";
import { ApiError } from "../../../shared/utils/api-error";

it("stores the derived country and checks the cap on create", async () => {
  // POST / with { ...marketBody, city: "台中市", platformFeeRateBps: 500 }
  expect(assertMarketFeeWithinRegionCap).toHaveBeenCalledWith(expect.anything(), {
    countryCode: "TW",
    platformFeeRateBps: 500,
  });
  expect(marketsFns.createMarket).toHaveBeenCalledWith(
    expect.objectContaining({ countryCode: "TW" }),
  );
});

it("does not create a market the guard refuses", async () => {
  vi.mocked(assertMarketFeeWithinRegionCap).mockRejectedValueOnce(
    new ApiError("MARKET_COUNTRY_REQUIRED", "country", 400),
  );
  // POST / with { ...marketBody, city: "Taichung", platformFeeRateBps: 500 }
  expect(res.status).toBe(400);
  expect(marketsFns.createMarket).not.toHaveBeenCalled();
});

it("rejects a country that contradicts the city", async () => {
  // POST / with { ...marketBody, city: "台中市", countryCode: "MY" }
  expect(res.status).toBe(400);
  await expect(res.json()).resolves.toMatchObject({
    error: { code: "MARKET_COUNTRY_CITY_MISMATCH" },
  });
});

it("re-derives the country when the city changes", async () => {
  marketsFns.getMarketById.mockResolvedValueOnce({
    id: "market-1",
    city: "台中市",
    countryCode: "TW",
    platformFeeRateBps: 300,
  });
  // PUT /market-1 with { city: "Penang" }
  expect(assertMarketFeeWithinRegionCap).toHaveBeenCalledWith(expect.anything(), {
    countryCode: "MY",
    platformFeeRateBps: 300,
  });
  expect(marketsFns.updateMarket).toHaveBeenCalledWith(
    "market-1",
    expect.objectContaining({ city: "Penang", countryCode: "MY" }),
  );
});

it("keeps an explicit country when only the fee changes", async () => {
  marketsFns.getMarketById.mockResolvedValueOnce({
    id: "market-1",
    city: "Taichung",
    countryCode: "TW",
    platformFeeRateBps: 300,
  });
  // PUT /market-1 with { platformFeeRateBps: 900 }
  expect(assertMarketFeeWithinRegionCap).toHaveBeenCalledWith(expect.anything(), {
    countryCode: "TW",
    platformFeeRateBps: 900,
  });
});

it("checks every row of a bulk import before creating any", async () => {
  vi.mocked(assertMarketFeeWithinRegionCap)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new ApiError("PLATFORM_FEE_ABOVE_REGION_CAP", "cap", 400));
  // POST /bulk with two markets
  expect(res.status).toBe(400);
  expect(marketsFns.createMarketsBulk).not.toHaveBeenCalled();
});
```

既有斷言 `expect(marketsFns.createMarket).toHaveBeenCalledWith(marketBody)` 與 `updateMarket` 的精確參數斷言，更新成包含 `countryCode`（`marketBody.city` 是台中市時為 `"TW"`）。

- [ ] **Step 2：確認測試失敗**

Run: `cd apps/api && pnpm exec vitest run src/features/markets`
Expected：新 case FAIL。

- [ ] **Step 3：實作**

`apps/api/src/features/markets/services/market-country.ts`：

```ts
import {
  countryForCity,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { ApiError } from "../../../shared/utils/api-error";

/**
 * 市集國別：明確指定優先，否則由城市推導；兩者都有卻不一致就拒絕。
 * 推導不出來回 null（未知）；收平台費的市集由 assertMarketFeeWithinRegionCap
 * 要求必須有國別（spec D9）。
 */
export function resolveMarketCountry(input: {
  countryCode?: SupportedCountryCode | null;
  city: string;
}): SupportedCountryCode | null {
  const fromCity = countryForCity(input.city);
  if (input.countryCode && fromCity && input.countryCode !== fromCity) {
    throw new ApiError(
      "MARKET_COUNTRY_CITY_MISMATCH",
      "The market's country does not match its city",
      400,
      { countryCode: input.countryCode, city: input.city },
    );
  }
  return input.countryCode ?? fromCity;
}
```

`validation.ts`：在 `createMarketSchema` 的 `city` 下一行加上

```ts
  countryCode: z.enum(SUPPORTED_COUNTRIES).optional(),
```

並從 `@makanmasak/shared-types` 匯入 `SUPPORTED_COUNTRIES`。`updateMarketSchema`（`.partial()`）與 `bulkCreateMarketsSchema`（重用 `createMarketSchema`）會自動帶上這個欄位。

`MarketsService.ts`：如果 `CreateMarketInput`／`UpdateMarketInput` 是手寫的 interface（不是從 zod 推導），加上 `countryCode?: SupportedCountryCode | null;`。`createMarket`、`createMarketsBulk`、`updateMarket` 都是把 input 展開寫入，不必改寫入邏輯。

`admin.ts` 的 import 區加上：

```ts
import { assertMarketFeeWithinRegionCap } from "../../../shared/policy/regionPolicyGuards";
import { resolveMarketCountry } from "../services/market-country";
```

`routes.post("/")` 改成：

```ts
routes.post("/", validateBody(createMarketSchema), async (c) => {
  const body = c.get("validatedBody");
  const countryCode = resolveMarketCountry(body);
  await assertMarketFeeWithinRegionCap(c.env, {
    countryCode,
    platformFeeRateBps: body.platformFeeRateBps ?? 0,
  });
  const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
  const market = await service.createMarket({ ...body, countryCode });
  return c.json({ success: true, data: { market } }, 201);
});
```

`routes.post("/bulk")`：把開頭的 `const { dryRun = false, markets } = c.get("validatedBody");` 改成先補上國別、逐列檢查，任何一列不合格就整批不建：

```ts
  const { dryRun = false, markets: requested } = c.get("validatedBody");
  const markets = requested.map((market) => ({
    ...market,
    countryCode: resolveMarketCountry(market),
  }));
  for (const market of markets) {
    await assertMarketFeeWithinRegionCap(c.env, {
      countryCode: market.countryCode,
      platformFeeRateBps: market.platformFeeRateBps ?? 0,
    });
  }
```

（其餘程式碼沿用 `markets` 這個名稱，不必改。）

`routes.put("/:id")` 的 handler 開頭改成：

```ts
    const { id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);

    // 城市、國別或費率任一項變動，都要重新確認國別與上限。
    let patch = body;
    if (
      body.city !== undefined ||
      body.countryCode !== undefined ||
      body.platformFeeRateBps !== undefined
    ) {
      const existing = await service.getMarketById(id);
      if (existing) {
        const countryCode = resolveMarketCountry({
          city: body.city ?? existing.city,
          // 改了城市又沒指定國別時重新推導；否則沿用既有值。
          countryCode:
            body.countryCode ??
            (body.city !== undefined ? undefined : existing.countryCode),
        });
        await assertMarketFeeWithinRegionCap(c.env, {
          countryCode,
          platformFeeRateBps:
            body.platformFeeRateBps ?? existing.platformFeeRateBps,
        });
        patch = { ...body, countryCode };
      }
    }

    const market = await service.updateMarket(id, patch);
```

（`existing` 不存在時交給 `updateMarket` 回 null，由既有流程回 404。）

- [ ] **Step 4：確認通過並 commit**

Run: `cd apps/api && pnpm exec vitest run src/features/markets`
Expected：PASS。

```bash
git add apps/api/src/features/markets
git commit -m "feat(api): give markets a country and keep fees under the region cap"
```

---

### Task 9：後台 API（`management-api`）

**Files:**
- Create: `apps/management-api/src/routes/policies.ts`
- Modify: `apps/management-api/src/index.ts`（import 區；`protectedApi.route("/admin/markets", …)` 下一行）
- Test: `apps/management-api/src/__tests__/policies.routes.test.ts`

**Interfaces:**
- Consumes：Task 1 的 `describeRegionPolicies`、`validateRegionPolicyValue`、`regionPolicyCacheKey`、`POLICY_SCOPE_TYPES`；Task 2 的 `regionPolicies`、`markets.countryCode`；既有的 `restaurants`、`auditLogs`、`AUDIT_ACTIONS`
- Produces（HTTP，皆在 `/api/v1/admin/policies` 之下，需要 management Bearer token）：
  - `GET /registry` → `{ definitions }`
  - `GET /?scope_type=&scope_id=` → `{ scopeType, scopeId, policies, restaurantsWithoutCountry? }`
  - `PUT /:scopeType/:scopeId/:policyKey`，body `{ value, acknowledgeRestaurantsWithoutCountry? }`
  - `DELETE /:scopeType/:scopeId/:policyKey` → `{ deleted }`
  - 錯誤碼：`POLICY_SCOPE_INVALID` 400、`POLICY_SCOPE_NOT_FOUND` 404、`POLICY_KEY_UNKNOWN` 404、`POLICY_SCOPE_NOT_ALLOWED` 400、`POLICY_VALUE_INVALID` 400、`POLICY_BLOCKED_BY_UNKNOWN_COUNTRY` 409（`details: { count, restaurants }`）、`POLICY_CAP_BELOW_EXISTING_MARKET_FEES` 409（`details: { markets, marketsWithoutCountry }`）、`PLATFORM_DB_UNAVAILABLE` 500

- [ ] **Step 1：寫失敗的測試**

`apps/management-api/src/__tests__/policies.routes.test.ts`：

```ts
import Database from "better-sqlite3";
import { sign } from "hono/jwt";
import { describe, expect, it, vi } from "vitest";
import { D1DatabaseAdapter } from "../../../../tests/helpers/d1-adapter";
import app from "../index";
import type { ManagementEnv } from "../types";

function createEnv(options: { unknownRestaurants?: number; seedSql?: string } = {}) {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE policies (
      id TEXT PRIMARY KEY NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      policy_key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_by TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX policies_scope_key_idx
      ON policies (scope_type, scope_id, policy_key);
    CREATE TABLE markets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country_code TEXT,
      platform_fee_rate_bps INTEGER NOT NULL DEFAULT 0,
      deleted_at_ms INTEGER
    );
    CREATE TABLE restaurants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country_code TEXT,
      deleted_at_ms INTEGER
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT, on_behalf_of_user_id TEXT, restaurant_id TEXT,
      action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT,
      description TEXT NOT NULL, changes TEXT, ip_address TEXT,
      user_agent TEXT, success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT, execution_time_ms INTEGER,
      created_at_ms INTEGER NOT NULL
    );
    INSERT INTO markets (id, name, city, country_code, platform_fee_rate_bps)
      VALUES ('m-tw', '逢甲夜市', '台中市', 'TW', 900),
             ('m-my', 'Jalan Alor', 'Kuala Lumpur', 'MY', 0);
    INSERT INTO restaurants (id, name, country_code) VALUES ('r1', 'Known', 'TW');
  `);
  for (let i = 0; i < (options.unknownRestaurants ?? 0); i += 1) {
    sqlite
      .prepare("INSERT INTO restaurants (id, name, country_code) VALUES (?, ?, NULL)")
      .run(`unknown-${i}`, `Unknown ${i}`);
  }
  if (options.seedSql) sqlite.exec(options.seedSql);

  const kv = { delete: vi.fn(async () => {}) };
  const env: ManagementEnv = {
    NODE_ENV: "test",
    API_VERSION: "v1",
    API_BASE_URL: "http://localhost",
    CORS_ORIGIN: "http://localhost:3010",
    LOG_LEVEL: "error",
    JWT_SECRET: "test-secret",
    CF_API_TOKEN: "test-token",
    CF_ACCOUNT_ID: "test-account",
    MANAGEMENT_DB: {} as D1Database,
    PLATFORM_DB: new D1DatabaseAdapter(sqlite) as unknown as D1Database,
    CACHE_KV: kv as unknown as KVNamespace,
    DEPLOYMENT_STATUS_KV: {} as KVNamespace,
    BUNDLE_STORAGE: {} as R2Bucket,
  };
  return { env, kv, sqlite };
}

async function token() {
  return sign(
    {
      id: "admin-1",
      email: "admin@example.test",
      role: "admin",
      aud: "management",
      iss: "makanmakan-management",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    "test-secret",
    "HS256",
  );
}

async function call(env: ManagementEnv, method: string, path: string, body?: unknown) {
  return app.fetch(
    new Request(`https://management.test/api/v1/admin/policies${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
}

const lastAudit = (sqlite: Database.Database) => {
  const row = sqlite
    .prepare("SELECT action, resource, resource_id, changes FROM audit_logs ORDER BY id DESC")
    .get() as { action: string; resource: string; resource_id: string; changes: string };
  return { ...row, changes: JSON.parse(row.changes) };
};

describe("admin policy routes", () => {
  it("requires a management token", async () => {
    const { env } = createEnv();
    const res = await app.fetch(
      new Request("https://management.test/api/v1/admin/policies/registry"),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("serves the registry", async () => {
    const { env } = createEnv();
    const body = (await (await call(env, "GET", "/registry")).json()) as {
      data: { definitions: { key: string }[] };
    };
    expect(body.data.definitions.map((d) => d.key)).toContain("modules.disabled");
  });

  it("sets a policy, audits it and clears the scope cache", async () => {
    const { env, kv, sqlite } = createEnv();
    const res = await call(env, "PUT", "/country/MY/modules.disabled", { value: ["pos"] });

    expect(res.status).toBe(200);
    expect(sqlite.prepare("SELECT value, updated_by FROM policies").get()).toEqual({
      value: '["pos"]',
      updated_by: "admin@example.test",
    });
    expect(lastAudit(sqlite)).toMatchObject({
      action: "system_config",
      resource: "policies",
      resource_id: "country:MY:modules.disabled",
      changes: { after: { value: ["pos"] }, metadata: { adminId: "admin-1" } },
    });
    expect(kv.delete).toHaveBeenCalledWith("policy:v1:country:MY");
  });

  it("updates in place and records the previous value", async () => {
    const { env, sqlite } = createEnv();
    await call(env, "PUT", "/country/MY/modules.disabled", { value: ["pos"] });
    await call(env, "PUT", "/country/MY/modules.disabled", { value: [] });

    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM policies").get()).toEqual({ n: 1 });
    expect(lastAudit(sqlite).changes).toMatchObject({
      before: { value: ["pos"] },
      after: { value: [] },
    });
  });

  it.each([
    ["/country/SG/modules.disabled", { value: [] }, 400, "POLICY_SCOPE_INVALID"],
    ["/market/nope/payments.allowed_providers", { value: [] }, 404, "POLICY_SCOPE_NOT_FOUND"],
    ["/country/MY/nope", { value: 1 }, 404, "POLICY_KEY_UNKNOWN"],
    ["/market/m-my/modules.disabled", { value: ["pos"] }, 400, "POLICY_SCOPE_NOT_ALLOWED"],
    ["/country/MY/plans.allowed_tiers", { value: ["trial"] }, 400, "POLICY_VALUE_INVALID"],
    ["/country/MY/modules.disabled", { value: ["pos", "pos"] }, 400, "POLICY_VALUE_INVALID"],
  ])("rejects PUT %s", async (path, body, status, code) => {
    const { env, kv } = createEnv();
    const res = await call(env, "PUT", path, body);
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ error: { code } });
    expect(kv.delete).not.toHaveBeenCalled();
  });

  it("allows payment providers at market scope", async () => {
    const { env, kv } = createEnv();
    const res = await call(env, "PUT", "/market/m-my/payments.allowed_providers", {
      value: ["tng"],
    });
    expect(res.status).toBe(200);
    expect(kv.delete).toHaveBeenCalledWith("policy:v1:market:m-my");
  });

  describe("unknown-country gate", () => {
    it("blocks a country ceiling while shops have no country", async () => {
      const { env, sqlite } = createEnv({ unknownRestaurants: 2 });
      const res = await call(env, "PUT", "/country/MY/modules.disabled", { value: ["pos"] });

      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
          details: {
            count: 2,
            restaurants: [
              expect.objectContaining({ id: "unknown-0" }),
              expect.objectContaining({ id: "unknown-1" }),
            ],
          },
        },
      });
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM policies").get()).toEqual({ n: 0 });
    });

    it("accepts an acknowledgment that matches the current count", async () => {
      const { env, sqlite } = createEnv({ unknownRestaurants: 2 });
      const res = await call(env, "PUT", "/country/MY/modules.disabled", {
        value: ["pos"],
        acknowledgeRestaurantsWithoutCountry: 2,
      });
      expect(res.status).toBe(200);
      expect(lastAudit(sqlite).changes).toMatchObject({
        metadata: { acknowledgedRestaurantsWithoutCountry: 2 },
      });
    });

    it("rejects a stale acknowledgment", async () => {
      const { env } = createEnv({ unknownRestaurants: 3 });
      const res = await call(env, "PUT", "/country/MY/payments.allowed_providers", {
        value: ["tng"],
        acknowledgeRestaurantsWithoutCountry: 2,
      });
      expect(res.status).toBe(409);
    });

    it("does not gate defaults or market scopes", async () => {
      const { env } = createEnv({ unknownRestaurants: 1 });
      expect(
        (await call(env, "PUT", "/country/MY/pricing.default_tax_rate_bps", { value: 600 }))
          .status,
      ).toBe(200);
      expect(
        (await call(env, "PUT", "/market/m-my/payments.allowed_providers", { value: ["tng"] }))
          .status,
      ).toBe(200);
    });
  });

  describe("fee cap gate", () => {
    it("refuses a cap below an existing market's fee", async () => {
      const { env } = createEnv();
      const res = await call(env, "PUT", "/country/TW/platform.max_fee_rate_bps", { value: 800 });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "POLICY_CAP_BELOW_EXISTING_MARKET_FEES",
          details: { markets: [expect.objectContaining({ id: "m-tw" })] },
        },
      });
    });

    it("refuses any cap while a fee-charging market has no country", async () => {
      const { env } = createEnv({
        seedSql: `INSERT INTO markets (id, name, city, country_code, platform_fee_rate_bps)
                  VALUES ('m-null', 'Mystery', 'Taichung', NULL, 100);`,
      });
      const res = await call(env, "PUT", "/country/MY/platform.max_fee_rate_bps", { value: 5000 });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          details: { marketsWithoutCountry: [expect.objectContaining({ id: "m-null" })] },
        },
      });
    });

    it("accepts a cap that covers every market", async () => {
      const { env } = createEnv();
      const res = await call(env, "PUT", "/country/TW/platform.max_fee_rate_bps", { value: 900 });
      expect(res.status).toBe(200);
    });
  });

  it("lists a country's policies with the unknown-country count", async () => {
    const { env } = createEnv({ unknownRestaurants: 1 });
    await call(env, "PUT", "/country/MY/pricing.default_tax_rate_bps", { value: 600 });
    const res = await call(env, "GET", "/?scope_type=country&scope_id=MY");
    await expect(res.json()).resolves.toMatchObject({
      data: {
        scopeType: "country",
        scopeId: "MY",
        policies: { "pricing.default_tax_rate_bps": { value: 600 } },
        restaurantsWithoutCountry: 1,
      },
    });
  });

  it("deletes a policy idempotently", async () => {
    const { env, kv, sqlite } = createEnv();
    await call(env, "PUT", "/country/MY/modules.disabled", { value: ["pos"] });
    const first = await call(env, "DELETE", "/country/MY/modules.disabled");
    const second = await call(env, "DELETE", "/country/MY/modules.disabled");

    await expect(first.json()).resolves.toMatchObject({ data: { deleted: true } });
    await expect(second.json()).resolves.toMatchObject({ data: { deleted: false } });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM policies").get()).toEqual({ n: 0 });
    expect(kv.delete).toHaveBeenCalledTimes(2); // PUT + first DELETE
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/policies.routes.test.ts`
Expected：FAIL（除了 401 那個 case，其餘都回 404）。

- [ ] **Step 3：實作 route**

`apps/management-api/src/routes/policies.ts`：

```ts
/**
 * 地區政策的後台 CRUD（spec §7）。值的合法性與層級限制由 @makanmasak/database
 * 的登記表決定；這裡負責範圍存在性、兩道寫入門檻（國別未知的店、費率上限
 * 對既有市集）、稽核，以及清除 apps/api 讀取時用的範圍快取（兩邊共用
 * 同一個 CACHE_KV namespace）。
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import {
  AUDIT_ACTIONS,
  auditLogs,
  describeRegionPolicies,
  markets,
  POLICY_SCOPE_TYPES,
  regionPolicies,
  regionPolicyCacheKey,
  restaurants,
  validateRegionPolicyValue,
  type PolicyScopeType,
  type RegionPolicyKey,
} from "@makanmasak/database";
import {
  normalizeCountryCode,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { ApiError } from "@makanmasak/utils";
import type { ManagementEnv } from "../types";
import type { ManagementUser } from "../middleware/auth";

const router = new Hono<{
  Bindings: ManagementEnv;
  Variables: { managementUser: ManagementUser };
}>();

type PlatformDb = ReturnType<typeof drizzle>;
type Scope = { type: PolicyScopeType; id: string };

/** 國家層的這些 key 會漏掉國別未知的店，寫入前要過門檻（spec D10）。 */
const GATED_BY_UNKNOWN_COUNTRY: ReadonlySet<RegionPolicyKey> = new Set([
  "modules.disabled",
  "payments.allowed_providers",
  "plans.allowed_tiers",
]);
const UNKNOWN_COUNTRY_SAMPLE_SIZE = 50;

function platformDb(env: ManagementEnv): PlatformDb {
  if (!env.PLATFORM_DB) {
    throw new ApiError("PLATFORM_DB_UNAVAILABLE", "Platform database is unavailable", 500);
  }
  return drizzle(env.PLATFORM_DB);
}

async function requireScope(
  db: PlatformDb,
  rawType: string | undefined,
  rawId: string | undefined,
): Promise<Scope> {
  const type = POLICY_SCOPE_TYPES.find((t) => t === rawType);
  if (!type || !rawId) {
    throw new ApiError("POLICY_SCOPE_INVALID", "Unknown policy scope", 400);
  }
  if (type === "country") {
    const country = normalizeCountryCode(rawId);
    if (!country || country !== rawId) {
      throw new ApiError("POLICY_SCOPE_INVALID", "Unsupported country", 400);
    }
    return { type, id: country };
  }
  const [market] = await db
    .select({ id: markets.id })
    .from(markets)
    .where(and(eq(markets.id, rawId), isNull(markets.deletedAt)))
    .limit(1);
  if (!market) {
    throw new ApiError("POLICY_SCOPE_NOT_FOUND", "Market not found", 404);
  }
  return { type, id: market.id };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readValue(db: PlatformDb, scope: Scope, policyKey: string) {
  const [row] = await db
    .select({ value: regionPolicies.value })
    .from(regionPolicies)
    .where(
      and(
        eq(regionPolicies.scopeType, scope.type),
        eq(regionPolicies.scopeId, scope.id),
        eq(regionPolicies.policyKey, policyKey),
      ),
    )
    .limit(1);
  return row ? safeJson(row.value) : undefined;
}

const restaurantsWithoutCountryWhere = and(
  isNull(restaurants.countryCode),
  isNull(restaurants.deletedAt),
);

async function countRestaurantsWithoutCountry(db: PlatformDb): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(restaurants)
    .where(restaurantsWithoutCountryWhere);
  return result?.value ?? 0;
}

/** 回傳本次寫入時確認的店家數（沒有國別未知的店時為 0）。 */
async function assertUnknownCountryAcknowledged(
  db: PlatformDb,
  acknowledged: unknown,
): Promise<number> {
  const total = await countRestaurantsWithoutCountry(db);
  if (total === 0 || acknowledged === total) return total;
  const sample = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(restaurantsWithoutCountryWhere)
    .orderBy(restaurants.id)
    .limit(UNKNOWN_COUNTRY_SAMPLE_SIZE);
  throw new ApiError(
    "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY",
    `${total} restaurants have no country and would not follow this policy`,
    409,
    { count: total, restaurants: sample },
  );
}

/** 上限不能低於該國任何收費市集；國別未知的收費市集會逃過上限，也要先處理。 */
async function assertCapCoversExistingMarkets(
  db: PlatformDb,
  country: SupportedCountryCode,
  cap: number,
): Promise<void> {
  const columns = {
    id: markets.id,
    name: markets.name,
    platformFeeRateBps: markets.platformFeeRateBps,
  };
  const [above, withoutCountry] = await Promise.all([
    db
      .select(columns)
      .from(markets)
      .where(
        and(
          eq(markets.countryCode, country),
          isNull(markets.deletedAt),
          gt(markets.platformFeeRateBps, cap),
        ),
      ),
    db
      .select(columns)
      .from(markets)
      .where(
        and(
          isNull(markets.countryCode),
          isNull(markets.deletedAt),
          gt(markets.platformFeeRateBps, 0),
        ),
      ),
  ]);
  if (above.length > 0 || withoutCountry.length > 0) {
    throw new ApiError(
      "POLICY_CAP_BELOW_EXISTING_MARKET_FEES",
      "Fix these markets before setting the cap",
      409,
      { markets: above, marketsWithoutCountry: withoutCountry },
    );
  }
}

function auditRow(
  admin: ManagementUser,
  scope: Scope,
  policyKey: string,
  before: unknown,
  after: unknown,
  metadata: Record<string, unknown> = {},
) {
  return {
    userId: null,
    action: AUDIT_ACTIONS.SYSTEM_CONFIG,
    resource: "policies",
    resourceId: `${scope.type}:${scope.id}:${policyKey}`,
    description: `Region policy ${policyKey} ${after === undefined ? "cleared" : "set"} for ${scope.type} ${scope.id} by ${admin.email}`,
    changes: {
      ...(before === undefined ? {} : { before: { value: before } }),
      ...(after === undefined ? {} : { after: { value: after } }),
      metadata: { adminId: admin.id, adminEmail: admin.email, ...metadata },
    },
    success: true,
  };
}

router.get("/registry", (c) =>
  c.json({ success: true, data: { definitions: describeRegionPolicies() } }),
);

router.get("/", async (c) => {
  const db = platformDb(c.env);
  const scope = await requireScope(db, c.req.query("scope_type"), c.req.query("scope_id"));
  const rows = await db
    .select({
      policyKey: regionPolicies.policyKey,
      value: regionPolicies.value,
      updatedBy: regionPolicies.updatedBy,
      updatedAt: regionPolicies.updatedAt,
    })
    .from(regionPolicies)
    .where(
      and(eq(regionPolicies.scopeType, scope.type), eq(regionPolicies.scopeId, scope.id)),
    );

  const policies = Object.fromEntries(
    rows.map((row) => [
      row.policyKey,
      { value: safeJson(row.value), updatedBy: row.updatedBy, updatedAt: row.updatedAt.getTime() },
    ]),
  );

  return c.json({
    success: true,
    data: {
      scopeType: scope.type,
      scopeId: scope.id,
      policies,
      ...(scope.type === "country"
        ? { restaurantsWithoutCountry: await countRestaurantsWithoutCountry(db) }
        : {}),
    },
  });
});

router.put("/:scopeType/:scopeId/:policyKey", async (c) => {
  const db = platformDb(c.env);
  const scope = await requireScope(db, c.req.param("scopeType"), c.req.param("scopeId"));
  const policyKey = c.req.param("policyKey");
  const body = (await c.req.json().catch(() => null)) as {
    value?: unknown;
    acknowledgeRestaurantsWithoutCountry?: unknown;
  } | null;

  const result = validateRegionPolicyValue(policyKey, scope.type, body?.value);
  if (!result.ok) {
    throw new ApiError(
      result.code,
      "Invalid region policy",
      result.code === "POLICY_KEY_UNKNOWN" ? 404 : 400,
      result.issues,
    );
  }

  const metadata: Record<string, unknown> = {};
  if (
    scope.type === "country" &&
    GATED_BY_UNKNOWN_COUNTRY.has(policyKey as RegionPolicyKey)
  ) {
    const acknowledged = await assertUnknownCountryAcknowledged(
      db,
      body?.acknowledgeRestaurantsWithoutCountry,
    );
    if (acknowledged > 0) metadata.acknowledgedRestaurantsWithoutCountry = acknowledged;
  }
  if (policyKey === "platform.max_fee_rate_bps") {
    await assertCapCoversExistingMarkets(
      db,
      scope.id as SupportedCountryCode,
      result.value as number,
    );
  }

  const admin = c.get("managementUser");
  const before = await readValue(db, scope, policyKey);
  const value = JSON.stringify(result.value);
  const now = new Date();

  await db.batch([
    db
      .insert(regionPolicies)
      .values({
        scopeType: scope.type,
        scopeId: scope.id,
        policyKey,
        value,
        updatedBy: admin.email,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [regionPolicies.scopeType, regionPolicies.scopeId, regionPolicies.policyKey],
        set: { value, updatedBy: admin.email, updatedAt: now },
      }),
    db.insert(auditLogs).values(auditRow(admin, scope, policyKey, before, result.value, metadata)),
  ]);
  await c.env.CACHE_KV.delete(regionPolicyCacheKey(scope.type, scope.id));

  return c.json({
    success: true,
    data: { scopeType: scope.type, scopeId: scope.id, policyKey, value: result.value },
  });
});

router.delete("/:scopeType/:scopeId/:policyKey", async (c) => {
  const db = platformDb(c.env);
  const scope = await requireScope(db, c.req.param("scopeType"), c.req.param("scopeId"));
  const policyKey = c.req.param("policyKey");
  const before = await readValue(db, scope, policyKey);
  if (before === undefined) {
    return c.json({ success: true, data: { deleted: false } });
  }

  const admin = c.get("managementUser");
  await db.batch([
    db
      .delete(regionPolicies)
      .where(
        and(
          eq(regionPolicies.scopeType, scope.type),
          eq(regionPolicies.scopeId, scope.id),
          eq(regionPolicies.policyKey, policyKey),
        ),
      ),
    db.insert(auditLogs).values(auditRow(admin, scope, policyKey, before, undefined)),
  ]);
  await c.env.CACHE_KV.delete(regionPolicyCacheKey(scope.type, scope.id));

  return c.json({ success: true, data: { deleted: true } });
});

export default router;
```

在 `apps/management-api/src/index.ts` 的 import 區加上 `import adminPoliciesRouter from "./routes/policies";`，並在 `protectedApi.route("/admin/markets", adminMarketsRouter);` 下一行加上：

```ts
protectedApi.route("/admin/policies", adminPoliciesRouter);
```

（`/admin` 已經在 `PROTECTED_PREFIXES` 裡，驗證會自動套用。）

- [ ] **Step 4：確認通過**

Run: `cd apps/management-api && pnpm exec vitest run src/__tests__/policies.routes.test.ts`
Expected：PASS。

Run: `pnpm exec turbo run typecheck test --filter=@makanmasak/management-api`
Expected：PASS。

- [ ] **Step 5：確認正式環境共用 KV**

Run: `grep -nE 'binding = "CACHE_KV"' -A1 apps/api/wrangler.toml apps/management-api/wrangler.toml`
Expected：兩邊的 production `id` 都是 `5850dad46b684f2d8b69b3344d146a1d`，dev 都是 `makanmasak-cache-dev`。如果不一致，先停下來回報，不要繼續：這種情況下後台清不到 apps/api 的快取。

- [ ] **Step 6：Commit**

```bash
git add apps/management-api/src/routes/policies.ts apps/management-api/src/index.ts apps/management-api/src/__tests__/policies.routes.test.ts
git commit -m "feat(management-api): admin CRUD for region policies with write gates"
```

---

### Task 10：management-portal「地區政策」頁

**Files:**
- Modify: `apps/management-portal/src/services/api.ts`（`marketsApi` 之後，以及 `api` 匯出物件約 :458）
- Create: `apps/management-portal/src/views/PoliciesView.vue`
- Modify: `apps/management-portal/src/router/index.ts`（`/markets` 路由之後）
- Modify: `apps/management-portal/src/layouts/AppLayout.vue:36-43`
- Modify: `apps/management-portal/src/i18n/locales/{zh-TW,zh-CN,en-US,vi-VN,ms-MY,id-ID}.ts`
- Test: `apps/management-portal/src/views/PoliciesView.test.ts`

**Interfaces:**
- Consumes：Task 9 的 HTTP API
- Produces：`policiesApi.registry()`、`policiesApi.list(scopeType, scopeId)`、`policiesApi.set(scopeType, scopeId, key, value, acknowledge?)`、`policiesApi.clear(scopeType, scopeId, key)`

- [ ] **Step 1：寫失敗的測試**

`apps/management-portal/src/views/PoliciesView.test.ts`：

```ts
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PoliciesView from "./PoliciesView.vue";
import { marketsApi, policiesApi } from "@/services/api";

vi.mock("vue-toastification", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  policiesApi: { registry: vi.fn(), list: vi.fn(), set: vi.fn(), clear: vi.fn() },
  marketsApi: { list: vi.fn() },
}));

describe("PoliciesView", () => {
  beforeEach(() => {
    vi.mocked(policiesApi.registry).mockResolvedValue([
      {
        key: "modules.disabled",
        merge: "ceiling_deny",
        scopes: ["country"],
        ui: { kind: "list", options: ["pos", "loyalty"] },
      },
      {
        key: "payments.allowed_providers",
        merge: "ceiling_allow",
        scopes: ["country", "market"],
        ui: { kind: "list", options: ["tng", "grabpay"] },
      },
      {
        key: "pricing.default_tax_rate_bps",
        merge: "default",
        scopes: ["country"],
        ui: { kind: "bps" },
      },
    ]);
    vi.mocked(policiesApi.list).mockResolvedValue({
      scopeType: "country",
      scopeId: "TW",
      policies: {
        "pricing.default_tax_rate_bps": { value: 500, updatedBy: "a@b.c", updatedAt: 0 },
      },
      restaurantsWithoutCountry: 3,
    });
    vi.mocked(policiesApi.set).mockResolvedValue(undefined);
    vi.mocked(policiesApi.clear).mockResolvedValue(undefined);
    vi.mocked(marketsApi.list).mockResolvedValue({
      markets: [
        { id: "m-1", slug: "fengjia", name: "逢甲夜市", type: "night_market", city: "台中市", district: "西屯區" } as never,
      ],
      total: 1,
      page: 1,
      limit: 100,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the TW country scope and shows bps as a percentage", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();

    expect(policiesApi.list).toHaveBeenCalledWith("country", "TW");
    const input = wrapper.get('[data-testid="policy-input-pricing.default_tax_rate_bps"]');
    expect((input.element as HTMLInputElement).value).toBe("5");
    expect(wrapper.get('[data-testid="policies-unknown-country"]').text()).toContain("3");
  });

  it("marks unset keys as inherited", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    expect(
      wrapper.get('[data-testid="policy-row-modules.disabled"]').attributes("data-state"),
    ).toBe("unset");
  });

  it("saves a percentage back as bps", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper.get('[data-testid="policy-input-pricing.default_tax_rate_bps"]').setValue("6.5");
    await wrapper.get('[data-testid="policy-save-pricing.default_tax_rate_bps"]').trigger("click");
    await flushPromises();

    expect(policiesApi.set).toHaveBeenCalledWith("country", "TW", "pricing.default_tax_rate_bps", 650);
  });

  it("asks before writing past shops with no country, then resends the count", async () => {
    vi.mocked(policiesApi.set).mockRejectedValueOnce({
      response: {
        data: { error: { code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY", details: { count: 3 } } },
      },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper.get('[data-testid="policy-option-modules.disabled-pos"]').setValue(true);
    await wrapper.get('[data-testid="policy-save-modules.disabled"]').trigger("click");
    await flushPromises();

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("3"));
    expect(policiesApi.set).toHaveBeenNthCalledWith(1, "country", "TW", "modules.disabled", ["pos"]);
    expect(policiesApi.set).toHaveBeenNthCalledWith(2, "country", "TW", "modules.disabled", ["pos"], 3);
  });

  it("does not resend when the admin declines", async () => {
    vi.mocked(policiesApi.set).mockRejectedValueOnce({
      response: {
        data: { error: { code: "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY", details: { count: 3 } } },
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper.get('[data-testid="policy-save-modules.disabled"]').trigger("click");
    await flushPromises();

    expect(policiesApi.set).toHaveBeenCalledTimes(1);
  });

  it("clears a key", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper.get('[data-testid="policy-clear-pricing.default_tax_rate_bps"]').trigger("click");
    await flushPromises();

    expect(policiesApi.clear).toHaveBeenCalledWith("country", "TW", "pricing.default_tax_rate_bps");
  });

  it("shows only market-scope keys for a market", async () => {
    const wrapper = mount(PoliciesView);
    await flushPromises();
    await wrapper.get('[data-testid="policies-market-select"]').setValue("m-1");
    await flushPromises();

    expect(policiesApi.list).toHaveBeenLastCalledWith("market", "m-1");
    expect(wrapper.find('[data-testid="policy-row-payments.allowed_providers"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="policy-row-modules.disabled"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="policy-row-pricing.default_tax_rate_bps"]').exists()).toBe(false);
  });
});
```

- [ ] **Step 2：確認測試失敗**

Run: `cd apps/management-portal && pnpm exec vitest run src/views/PoliciesView.test.ts`
Expected：FAIL，找不到 `./PoliciesView.vue`。

- [ ] **Step 3：API client**

在 `apps/management-portal/src/services/api.ts` 的 `marketsApi` 之後加上：

```ts
export type PolicyScopeType = "country" | "market";

export interface PolicyDefinition {
  key: string;
  merge: "ceiling_deny" | "ceiling_allow" | "default" | "platform_cap";
  scopes: PolicyScopeType[];
  ui: { kind: "list"; options: string[] } | { kind: "bps" };
}

export interface PolicyScopeState {
  scopeType: PolicyScopeType;
  scopeId: string;
  policies: Record<string, { value: unknown; updatedBy: string | null; updatedAt: number }>;
  restaurantsWithoutCountry?: number;
}

const policyPath = (scopeType: PolicyScopeType, scopeId: string, key: string) =>
  `/admin/policies/${scopeType}/${encodeURIComponent(scopeId)}/${key}`;

export const policiesApi = {
  async registry(): Promise<PolicyDefinition[]> {
    const { data } = await apiClient.get<ApiResponse<{ definitions: PolicyDefinition[] }>>(
      "/admin/policies/registry",
    );
    return data.data!.definitions;
  },

  async list(scopeType: PolicyScopeType, scopeId: string): Promise<PolicyScopeState> {
    const { data } = await apiClient.get<ApiResponse<PolicyScopeState>>("/admin/policies", {
      params: { scope_type: scopeType, scope_id: scopeId },
    });
    return data.data!;
  },

  /** acknowledge：管理員已確認的「國別未知店家數」，見 spec D10。 */
  async set(
    scopeType: PolicyScopeType,
    scopeId: string,
    key: string,
    value: unknown,
    acknowledge?: number,
  ): Promise<void> {
    await apiClient.put(policyPath(scopeType, scopeId, key), {
      value,
      ...(acknowledge === undefined
        ? {}
        : { acknowledgeRestaurantsWithoutCountry: acknowledge }),
    });
  },

  async clear(scopeType: PolicyScopeType, scopeId: string, key: string): Promise<void> {
    await apiClient.delete(policyPath(scopeType, scopeId, key));
  },
};
```

並在檔尾的 `api` 物件（`markets: marketsApi,` 那一行）下面加上 `policies: policiesApi,`。

- [ ] **Step 4：頁面**

`apps/management-portal/src/views/PoliciesView.vue`：

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useToast } from "vue-toastification";
import {
  marketsApi,
  policiesApi,
  type PolicyDefinition,
  type PolicyScopeState,
  type PolicyScopeType,
} from "@/services/api";
import type { Market } from "@/types";
import { useI18n } from "@/i18n";

const { t } = useI18n();
const toast = useToast();

const COUNTRIES = ["TW", "MY"] as const;

const definitions = ref<PolicyDefinition[]>([]);
const scopeType = ref<PolicyScopeType>("country");
const scopeId = ref<string>("TW");
const state = ref<PolicyScopeState | null>(null);
const marketOptions = ref<Market[]>([]);
/** 表單草稿：清單類是勾選的值，比率類是百分比字串。 */
const drafts = ref<Record<string, string[] | string>>({});
const saving = ref<string | null>(null);

const visibleDefinitions = computed(() =>
  definitions.value.filter((d) => d.scopes.includes(scopeType.value)),
);

const labelKey = (key: string) => `policies.keys.${key.replace(/\./g, "_")}`;

function toDraft(definition: PolicyDefinition, value: unknown) {
  if (definition.ui.kind === "list") return Array.isArray(value) ? (value as string[]) : [];
  return typeof value === "number" ? String(value / 100) : "";
}

async function loadScope() {
  state.value = await policiesApi.list(scopeType.value, scopeId.value);
  drafts.value = Object.fromEntries(
    definitions.value.map((d) => [d.key, toDraft(d, state.value?.policies[d.key]?.value)]),
  );
}

async function selectCountry(code: string) {
  scopeType.value = "country";
  scopeId.value = code;
  await loadScope();
}

async function selectMarket(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  if (!id) return;
  scopeType.value = "market";
  scopeId.value = id;
  await loadScope();
}

const isSet = (key: string) => state.value?.policies[key] !== undefined;

function draftValue(definition: PolicyDefinition): unknown {
  const draft = drafts.value[definition.key];
  if (definition.ui.kind === "list") return draft as string[];
  // 百分比 → bps；四捨五入避免 6.5 * 100 的浮點誤差。
  return Math.round(Number(draft) * 100);
}

/** 國別未知門檻回傳的店家數；其他錯誤回 null。 */
function unknownCountryCount(error: unknown): number | null {
  const apiError = (
    error as {
      response?: { data?: { error?: { code?: string; details?: { count?: number } } } };
    }
  )?.response?.data?.error;
  return apiError?.code === "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY"
    ? (apiError.details?.count ?? null)
    : null;
}

async function save(definition: PolicyDefinition) {
  saving.value = definition.key;
  const value = draftValue(definition);
  try {
    try {
      await policiesApi.set(scopeType.value, scopeId.value, definition.key, value);
    } catch (error) {
      const count = unknownCountryCount(error);
      if (count === null) throw error;
      if (!window.confirm(t("policies.confirmUnknownCountry", { count }))) return;
      await policiesApi.set(scopeType.value, scopeId.value, definition.key, value, count);
    }
    toast.success(t("policies.toast.saved"));
    await loadScope();
  } finally {
    saving.value = null;
  }
}

async function clear(definition: PolicyDefinition) {
  saving.value = definition.key;
  try {
    await policiesApi.clear(scopeType.value, scopeId.value, definition.key);
    toast.success(t("policies.toast.cleared"));
    await loadScope();
  } finally {
    saving.value = null;
  }
}

onMounted(async () => {
  const [registry, marketList] = await Promise.all([
    policiesApi.registry(),
    marketsApi.list({ limit: 100 }),
  ]);
  definitions.value = registry;
  marketOptions.value = marketList.markets;
  await loadScope();
});
</script>

<template>
  <div class="space-y-6" data-testid="management-policies-page">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">{{ t("policies.title") }}</h1>
      <p class="mt-1 text-sm text-gray-500">{{ t("policies.subtitle") }}</p>
    </div>

    <div class="card flex flex-wrap items-center gap-3">
      <button
        v-for="code in COUNTRIES"
        :key="code"
        type="button"
        class="btn rounded-full"
        :class="scopeType === 'country' && scopeId === code ? 'btn-primary' : 'btn-secondary'"
        :aria-pressed="scopeType === 'country' && scopeId === code"
        :data-testid="`policies-country-${code}`"
        @click="selectCountry(code)"
      >
        {{ t(`policies.countries.${code}`) }}
      </button>
      <label class="flex items-center gap-2 text-sm text-gray-600">
        {{ t("policies.scope.market") }}
        <select
          class="input"
          data-testid="policies-market-select"
          :value="scopeType === 'market' ? scopeId : ''"
          @change="selectMarket"
        >
          <option value="">{{ t("policies.scope.marketPlaceholder") }}</option>
          <option v-for="market in marketOptions" :key="market.id" :value="market.id">
            {{ market.name }}（{{ market.city }}）
          </option>
        </select>
      </label>
    </div>

    <p
      v-if="scopeType === 'country' && (state?.restaurantsWithoutCountry ?? 0) > 0"
      class="card text-sm text-gray-700"
      role="status"
      data-testid="policies-unknown-country"
    >
      {{ t("policies.unknownCountryWarning", { count: state?.restaurantsWithoutCountry ?? 0 }) }}
    </p>

    <div class="space-y-4">
      <section
        v-for="definition in visibleDefinitions"
        :key="definition.key"
        class="card space-y-3"
        :data-testid="`policy-row-${definition.key}`"
        :data-state="isSet(definition.key) ? 'set' : 'unset'"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 class="font-semibold text-gray-900">{{ t(labelKey(definition.key)) }}</h2>
          <span class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
            {{ t(`policies.merge.${definition.merge}`) }}
          </span>
        </div>
        <p v-if="!isSet(definition.key)" class="text-sm text-gray-500">
          {{ t("policies.inherited") }}
        </p>

        <div v-if="definition.ui.kind === 'list'" class="flex flex-wrap gap-3">
          <label
            v-for="option in definition.ui.options"
            :key="option"
            class="flex items-center gap-2 text-sm text-gray-700"
          >
            <input
              v-model="drafts[definition.key]"
              type="checkbox"
              :value="option"
              :data-testid="`policy-option-${definition.key}-${option}`"
            />
            <code>{{ option }}</code>
          </label>
        </div>
        <label v-else class="flex items-center gap-2 text-sm text-gray-700">
          <input
            v-model="drafts[definition.key]"
            class="input w-32"
            type="number"
            min="0"
            max="100"
            step="0.01"
            inputmode="decimal"
            :aria-label="t(labelKey(definition.key))"
            :data-testid="`policy-input-${definition.key}`"
          />
          %
        </label>

        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-primary rounded-full"
            :disabled="saving === definition.key"
            :data-testid="`policy-save-${definition.key}`"
            @click="save(definition)"
          >
            {{ t("policies.actions.save") }}
          </button>
          <button
            v-if="isSet(definition.key)"
            type="button"
            class="btn btn-secondary rounded-full"
            :disabled="saving === definition.key"
            :data-testid="`policy-clear-${definition.key}`"
            @click="clear(definition)"
          >
            {{ t("policies.actions.clear") }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
```

寫之前先確認三件事，任何一項不符就照實際情況改：`btn-secondary` 與 `input` 這兩個 class 在 portal 的樣式裡存在（`grep -rn "btn-secondary\|\.input" apps/management-portal/src/assets`，不存在就改用 `LicensesView.vue`／`MarketsView.vue` 實際使用的 class）；`Market` 型別是從 `@/types` 匯出的；`marketsApi.list` 接受 `limit: 100`（後端上限是 100）。

- [ ] **Step 5：路由、導覽列、六個語系**

`router/index.ts` 在 `/markets` 路由之後加上：

```ts
  {
    path: "/policies",
    name: "Policies",
    component: () => import("@/views/PoliciesView.vue"),
    meta: { title: "地區政策" },
  },
```

`layouts/AppLayout.vue`：heroicons 的 import 加上 `GlobeAltIcon`，並在 `navigation` 的 markets 那一行後面加上：

```ts
  { name: t("nav.policies"), href: "/policies", icon: GlobeAltIcon },
```

每個語系檔：在 `nav` 區塊加上 `policies`，並在 `notFound:` 之前新增頂層 `policies` 區塊。

**zh-TW**

```ts
// nav 內
    policies: "地區政策",

  policies: {
    title: "地區政策",
    subtitle: "依國家或市集設定功能、金流、方案與費率。沒有設定的項目沿用上一層。",
    countries: { TW: "台灣", MY: "馬來西亞" },
    scope: { market: "市集", marketPlaceholder: "選擇市集…" },
    unknownCountryWarning:
      "有 {count} 家店尚未設定國別，國家政策不會套用到它們。請先執行國別回填。",
    confirmUnknownCountry:
      "有 {count} 家店尚未設定國別，這項政策不會套用到它們。確定仍要儲存嗎？",
    inherited: "未設定，沿用上一層",
    merge: {
      ceiling_deny: "上限：任一層關閉即關閉",
      ceiling_allow: "上限：只允許清單內的項目",
      default: "預設：店家可自行覆寫",
      platform_cap: "平台限定：店家無法修改",
    },
    keys: {
      modules_disabled: "關閉的功能模組",
      payments_allowed_providers: "允許的線上金流商",
      pricing_default_tax_rate_bps: "預設稅率",
      pricing_default_service_charge_rate_bps: "預設服務費率",
      plans_allowed_tiers: "可販售的付費方案",
      platform_max_fee_rate_bps: "市集平台費率上限",
    },
    actions: { save: "儲存", clear: "清除" },
    toast: { saved: "已儲存政策", cleared: "已清除政策" },
  },
```

**zh-CN**

```ts
    policies: "地区政策",

  policies: {
    title: "地区政策",
    subtitle: "按国家或市集设置功能、支付、方案与费率。未设置的项目沿用上一层。",
    countries: { TW: "台湾", MY: "马来西亚" },
    scope: { market: "市集", marketPlaceholder: "选择市集…" },
    unknownCountryWarning:
      "有 {count} 家店尚未设置国别，国家政策不会应用到它们。请先执行国别回填。",
    confirmUnknownCountry:
      "有 {count} 家店尚未设置国别，这项政策不会应用到它们。确定仍要保存吗？",
    inherited: "未设置，沿用上一层",
    merge: {
      ceiling_deny: "上限：任一层关闭即关闭",
      ceiling_allow: "上限：只允许清单内的项目",
      default: "默认：店家可自行覆盖",
      platform_cap: "平台限定：店家无法修改",
    },
    keys: {
      modules_disabled: "关闭的功能模块",
      payments_allowed_providers: "允许的在线支付商",
      pricing_default_tax_rate_bps: "默认税率",
      pricing_default_service_charge_rate_bps: "默认服务费率",
      plans_allowed_tiers: "可销售的付费方案",
      platform_max_fee_rate_bps: "市集平台费率上限",
    },
    actions: { save: "保存", clear: "清除" },
    toast: { saved: "已保存政策", cleared: "已清除政策" },
  },
```

**en-US**

```ts
    policies: "Region policies",

  policies: {
    title: "Region policies",
    subtitle:
      "Set modules, payments, plans and fees per country or market. Unset items inherit from the level above.",
    countries: { TW: "Taiwan", MY: "Malaysia" },
    scope: { market: "Market", marketPlaceholder: "Choose a market…" },
    unknownCountryWarning:
      "{count} shops have no country yet, so country policies do not apply to them. Run the country backfill first.",
    confirmUnknownCountry:
      "{count} shops have no country and will not follow this policy. Save anyway?",
    inherited: "Not set — inherits from the level above",
    merge: {
      ceiling_deny: "Ceiling: off if any level turns it off",
      ceiling_allow: "Ceiling: only listed items are allowed",
      default: "Default: shops can override",
      platform_cap: "Platform only: shops cannot change",
    },
    keys: {
      modules_disabled: "Disabled modules",
      payments_allowed_providers: "Allowed online payment providers",
      pricing_default_tax_rate_bps: "Default tax rate",
      pricing_default_service_charge_rate_bps: "Default service charge rate",
      plans_allowed_tiers: "Paid plans on sale",
      platform_max_fee_rate_bps: "Market platform fee cap",
    },
    actions: { save: "Save", clear: "Clear" },
    toast: { saved: "Policy saved", cleared: "Policy cleared" },
  },
```

**vi-VN**

```ts
    policies: "Chính sách khu vực",

  policies: {
    title: "Chính sách khu vực",
    subtitle:
      "Thiết lập mô-đun, thanh toán, gói và phí theo quốc gia hoặc chợ. Mục chưa thiết lập sẽ kế thừa từ cấp trên.",
    countries: { TW: "Đài Loan", MY: "Malaysia" },
    scope: { market: "Chợ", marketPlaceholder: "Chọn chợ…" },
    unknownCountryWarning:
      "{count} cửa hàng chưa có quốc gia nên chính sách quốc gia không áp dụng. Hãy chạy bổ sung quốc gia trước.",
    confirmUnknownCountry:
      "{count} cửa hàng chưa có quốc gia và sẽ không tuân theo chính sách này. Vẫn lưu?",
    inherited: "Chưa thiết lập — kế thừa từ cấp trên",
    merge: {
      ceiling_deny: "Giới hạn: tắt nếu bất kỳ cấp nào tắt",
      ceiling_allow: "Giới hạn: chỉ cho phép các mục trong danh sách",
      default: "Mặc định: cửa hàng có thể ghi đè",
      platform_cap: "Chỉ nền tảng: cửa hàng không thể thay đổi",
    },
    keys: {
      modules_disabled: "Mô-đun bị tắt",
      payments_allowed_providers: "Nhà cung cấp thanh toán trực tuyến được phép",
      pricing_default_tax_rate_bps: "Thuế suất mặc định",
      pricing_default_service_charge_rate_bps: "Phí dịch vụ mặc định",
      plans_allowed_tiers: "Gói trả phí được bán",
      platform_max_fee_rate_bps: "Mức trần phí nền tảng của chợ",
    },
    actions: { save: "Lưu", clear: "Xóa" },
    toast: { saved: "Đã lưu chính sách", cleared: "Đã xóa chính sách" },
  },
```

**ms-MY**

```ts
    policies: "Dasar wilayah",

  policies: {
    title: "Dasar wilayah",
    subtitle:
      "Tetapkan modul, pembayaran, pelan dan yuran mengikut negara atau pasar. Item yang tidak ditetapkan mewarisi tahap di atas.",
    countries: { TW: "Taiwan", MY: "Malaysia" },
    scope: { market: "Pasar", marketPlaceholder: "Pilih pasar…" },
    unknownCountryWarning:
      "{count} kedai belum mempunyai negara, jadi dasar negara tidak terpakai kepada mereka. Jalankan pengisian negara dahulu.",
    confirmUnknownCountry:
      "{count} kedai tiada negara dan tidak akan mengikut dasar ini. Simpan juga?",
    inherited: "Tidak ditetapkan — mewarisi tahap di atas",
    merge: {
      ceiling_deny: "Siling: dimatikan jika mana-mana tahap mematikannya",
      ceiling_allow: "Siling: hanya item dalam senarai dibenarkan",
      default: "Lalai: kedai boleh mengatasi",
      platform_cap: "Platform sahaja: kedai tidak boleh mengubah",
    },
    keys: {
      modules_disabled: "Modul yang dimatikan",
      payments_allowed_providers: "Penyedia pembayaran dalam talian yang dibenarkan",
      pricing_default_tax_rate_bps: "Kadar cukai lalai",
      pricing_default_service_charge_rate_bps: "Kadar caj perkhidmatan lalai",
      plans_allowed_tiers: "Pelan berbayar yang dijual",
      platform_max_fee_rate_bps: "Had yuran platform pasar",
    },
    actions: { save: "Simpan", clear: "Kosongkan" },
    toast: { saved: "Dasar disimpan", cleared: "Dasar dikosongkan" },
  },
```

**id-ID**

```ts
    policies: "Kebijakan wilayah",

  policies: {
    title: "Kebijakan wilayah",
    subtitle:
      "Atur modul, pembayaran, paket, dan biaya per negara atau pasar. Item yang belum diatur mewarisi tingkat di atasnya.",
    countries: { TW: "Taiwan", MY: "Malaysia" },
    scope: { market: "Pasar", marketPlaceholder: "Pilih pasar…" },
    unknownCountryWarning:
      "{count} toko belum memiliki negara, sehingga kebijakan negara tidak berlaku bagi mereka. Jalankan pengisian negara terlebih dahulu.",
    confirmUnknownCountry:
      "{count} toko tidak memiliki negara dan tidak akan mengikuti kebijakan ini. Tetap simpan?",
    inherited: "Belum diatur — mewarisi tingkat di atasnya",
    merge: {
      ceiling_deny: "Batas: mati jika tingkat mana pun mematikannya",
      ceiling_allow: "Batas: hanya item dalam daftar yang diizinkan",
      default: "Bawaan: toko dapat menimpa",
      platform_cap: "Khusus platform: toko tidak dapat mengubah",
    },
    keys: {
      modules_disabled: "Modul yang dinonaktifkan",
      payments_allowed_providers: "Penyedia pembayaran online yang diizinkan",
      pricing_default_tax_rate_bps: "Tarif pajak bawaan",
      pricing_default_service_charge_rate_bps: "Tarif biaya layanan bawaan",
      plans_allowed_tiers: "Paket berbayar yang dijual",
      platform_max_fee_rate_bps: "Batas biaya platform pasar",
    },
    actions: { save: "Simpan", clear: "Hapus" },
    toast: { saved: "Kebijakan disimpan", cleared: "Kebijakan dihapus" },
  },
```

- [ ] **Step 6：確認通過**

Run: `cd apps/management-portal && pnpm exec vitest run src/views/PoliciesView.test.ts src/i18n`
Expected：PASS（包含 i18n 覆蓋測試）。

Run: `pnpm exec turbo run typecheck lint --filter=@makanmasak/management-portal && pnpm check:design-palette`
Expected：PASS。

- [ ] **Step 7：Commit**

```bash
git add apps/management-portal/src
git commit -m "feat(management-portal): region policies page"
```

---

### Task 11：整體驗證

- [ ] **Step 1：跑完整的 gate**

Run: `pnpm verify:push`
Expected：全部 PASS。任何失敗都照實回報輸出內容，不要用重跑來蓋過。

- [ ] **Step 2：確認 spec 與實作一致**

逐列對照 spec §6 的表格，每一列都要找得到對應的程式碼和測試，並在 PR 描述裡列出這份對照（key → 檔案:行號 → 測試名稱）。任何一列對不上，都要先修正程式碼或 spec，才算完成。
