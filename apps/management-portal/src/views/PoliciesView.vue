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
  definitions.value.filter((definition) =>
    definition.scopes.includes(scopeType.value),
  ),
);

const labelKey = (key: string) => `policies.keys.${key.replace(/\./g, "_")}`;

function toDraft(definition: PolicyDefinition, value: unknown) {
  if (definition.ui.kind === "list") {
    return Array.isArray(value) ? (value as string[]) : [];
  }
  return typeof value === "number" ? String(value / 100) : "";
}

async function loadScope() {
  state.value = await policiesApi.list(scopeType.value, scopeId.value);
  drafts.value = Object.fromEntries(
    definitions.value.map((definition) => [
      definition.key,
      toDraft(definition, state.value?.policies[definition.key]?.value),
    ]),
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

/**
 * A percentage the API will accept: present and within 0–100. Without this an
 * emptied field saved as Number("") = 0, silently setting a 0% cap or rate.
 */
function canSave(definition: PolicyDefinition): boolean {
  if (definition.ui.kind !== "bps") return true;
  const draft = String(drafts.value[definition.key] ?? "").trim();
  if (draft === "") return false;
  const bps = Number(draft) * 100;
  return Number.isFinite(bps) && bps >= 0 && bps <= 10000;
}

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
      response?: {
        data?: { error?: { code?: string; details?: { count?: number } } };
      };
    }
  )?.response?.data?.error;
  return apiError?.code === "POLICY_BLOCKED_BY_UNKNOWN_COUNTRY"
    ? (apiError.details?.count ?? null)
    : null;
}

async function save(definition: PolicyDefinition) {
  if (!canSave(definition)) return;
  saving.value = definition.key;
  const value = draftValue(definition);
  try {
    try {
      await policiesApi.set(
        scopeType.value,
        scopeId.value,
        definition.key,
        value,
      );
    } catch (error) {
      const count = unknownCountryCount(error);
      if (count === null) throw error;
      if (!window.confirm(t("policies.confirmUnknownCountry", { count })))
        return;
      await policiesApi.set(
        scopeType.value,
        scopeId.value,
        definition.key,
        value,
        count,
      );
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

/** The markets endpoint caps a page at 100; walk every page. */
async function loadAllMarkets(): Promise<Market[]> {
  const all: Market[] = [];
  for (let page = 1; ; page += 1) {
    const result = await marketsApi.list({ limit: 100, page });
    all.push(...result.markets);
    if (result.markets.length === 0 || all.length >= result.total) return all;
  }
}

onMounted(async () => {
  const [registry, markets] = await Promise.all([
    policiesApi.registry(),
    loadAllMarkets(),
  ]);
  definitions.value = registry;
  marketOptions.value = markets;
  await loadScope();
});
</script>

<template>
  <div class="space-y-6" data-testid="management-policies-page">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">
        {{ t("policies.title") }}
      </h1>
      <p class="mt-1 text-sm text-gray-500">{{ t("policies.subtitle") }}</p>
    </div>

    <div class="card flex flex-wrap items-center gap-3">
      <button
        v-for="code in COUNTRIES"
        :key="code"
        type="button"
        class="btn rounded-full"
        :class="
          scopeType === 'country' && scopeId === code
            ? 'btn-primary'
            : 'btn-secondary'
        "
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
          <option
            v-for="market in marketOptions"
            :key="market.id"
            :value="market.id"
          >
            {{ market.name }}（{{ market.city }}）
          </option>
        </select>
      </label>
    </div>

    <p
      v-if="
        scopeType === 'country' && (state?.restaurantsWithoutCountry ?? 0) > 0
      "
      class="card text-sm text-gray-700"
      role="status"
      data-testid="policies-unknown-country"
    >
      {{
        t("policies.unknownCountryWarning", {
          count: state?.restaurantsWithoutCountry ?? 0,
        })
      }}
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
          <h2 class="font-semibold text-gray-900">
            {{ t(labelKey(definition.key)) }}
          </h2>
          <span
            class="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600"
          >
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
            :disabled="saving === definition.key || !canSave(definition)"
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
