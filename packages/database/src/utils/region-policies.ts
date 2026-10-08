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
import {
  MODULES,
  type ModuleKey,
  type PlanTier,
} from "../schema/subscriptions";

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

  const providerLists = layers.flatMap((layer) => {
    const list = layer.values["payments.allowed_providers"];
    return list === undefined ? [] : [list];
  });
  const allowedProviders =
    providerLists.reduce<Set<NativePaymentProvider> | null>(
      (allowed, list) =>
        allowed === null
          ? new Set(list)
          : new Set(list.filter((provider) => allowed.has(provider))),
      null,
    );

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
