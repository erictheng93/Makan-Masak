<template>
  <section
    data-testid="pnl-rates"
    class="ui-panel pnl-noprint mb-4 rounded-3xl bg-white p-5 shadow-ios-sm"
  >
    <div class="flex items-center justify-between gap-3">
      <h2 class="text-[15px] font-bold text-ios-text">
        {{ t("dailyPnl.rates.title") }}
      </h2>
      <button
        type="button"
        data-testid="pnl-rates-close"
        class="rounded-full bg-ios-bg px-4 py-1.5 text-[13px] font-semibold text-ios-text transition-colors duration-200"
        @click="emit('close')"
      >
        {{ t("dailyPnl.rates.close") }}
      </button>
    </div>
    <p class="mt-1 text-[12px] text-ios-secondary">
      {{ t("dailyPnl.rates.appliesFromDate") }}
    </p>

    <p
      v-if="loading"
      data-testid="pnl-rates-loading"
      class="mt-4 text-[13px] text-ios-secondary"
    >
      {{ t("common.loading") }}
    </p>
    <div v-else-if="rates === null" role="alert" class="mt-4">
      <p class="text-[13px] font-semibold text-ios-text">
        {{ t("dailyPnl.rates.loadFailed") }}
      </p>
      <button
        type="button"
        data-testid="pnl-rates-retry"
        class="mt-2 rounded-full bg-ios-blue px-4 py-1.5 text-[13px] font-semibold text-white"
        @click="load()"
      >
        {{ t("common.retry") }}
      </button>
    </div>
    <form
      v-else
      data-testid="pnl-rates-form"
      class="mt-4"
      @submit.prevent="save"
    >
      <label class="mb-4 block text-[12px] font-medium text-ios-secondary">
        {{ t("dailyPnl.rates.effectiveFrom") }}
        <input
          v-model="effectiveFrom"
          type="date"
          :max="today"
          required
          data-testid="pnl-rates-effective-from"
          class="mt-1 block rounded-xl bg-ios-bg px-3 py-2 text-[14px] text-ios-text outline-none"
        />
      </label>
      <fieldset
        v-for="group in groups"
        :key="group.id"
        class="mb-4 min-w-0 border-0 p-0"
      >
        <legend class="text-[13px] font-bold text-ios-text">
          {{ group.title }}
        </legend>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <label
            v-for="key in group.keys"
            :key="key"
            class="flex items-center justify-between gap-3 text-[13px] text-ios-text"
          >
            {{ group.label(key) }}
            <span class="flex items-center gap-1">
              <input
                v-model="group.values[key]"
                type="number"
                min="0"
                max="100"
                step="0.01"
                inputmode="decimal"
                :data-testid="`pnl-rate-${group.id}-${key}`"
                class="block w-24 rounded-xl bg-ios-bg px-3 py-2 text-right text-[14px] text-ios-text outline-none"
              />
              <span class="text-ios-secondary" aria-hidden="true">%</span>
            </span>
          </label>
        </div>
      </fieldset>
      <button
        type="submit"
        data-testid="pnl-rates-save"
        :disabled="saving"
        class="rounded-full bg-ios-blue px-5 py-2 text-[14px] font-semibold text-white transition-colors duration-200 disabled:opacity-50"
      >
        {{ t("dailyPnl.rates.save") }}
      </button>
    </form>

    <div
      v-if="rates && rates.history.length > 0"
      data-testid="pnl-rates-history"
      class="mt-5"
    >
      <h3 class="text-[13px] font-bold text-ios-text">
        {{ t("dailyPnl.rates.history") }}
      </h3>
      <p class="mt-0.5 text-[12px] text-ios-secondary">
        {{ t("dailyPnl.rates.historyHint") }}
      </p>
      <ul class="mt-2 space-y-1.5">
        <li v-for="version in rates.history" :key="version.effectiveFrom">
          <button
            type="button"
            :data-testid="`pnl-rates-history-${version.effectiveFrom}`"
            :aria-pressed="effectiveFrom === version.effectiveFrom"
            class="flex w-full flex-wrap items-baseline gap-x-3 rounded-2xl bg-ios-bg px-3 py-2 text-left text-[13px] text-ios-text transition-colors duration-200"
            :class="
              effectiveFrom === version.effectiveFrom
                ? 'ring-2 ring-ios-blue'
                : ''
            "
            @click="pick(version)"
          >
            <span class="font-semibold tabular-nums">
              {{
                version.effectiveFrom === LEGACY_DATE
                  ? t("dailyPnl.rates.fromStart")
                  : version.effectiveFrom
              }}
            </span>
            <span class="min-w-0 text-ios-secondary">{{
              summary(version)
            }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import {
  pnlService,
  type PnlRates,
  type PnlRatesVersion,
} from "@/services/pnlService";
import { extractApiErrorCode } from "@/utils/errorHandler";

/** Server marker for rates that predate versioning. */
const LEGACY_DATE = "1970-01-01";

const props = defineProps<{ restaurantId: string; today: string }>();
const emit = defineEmits<{ saved: []; close: [] }>();

const { t } = useI18n();
const toast = useToast();

const rates = ref<PnlRates | null>(null);
const loading = ref(false);
const saving = ref(false);
const effectiveFrom = ref(props.today);
// Percent text per key, so "2.75" round-trips without float drift.
const paymentPct = reactive<Record<string, number | string>>({});
const platformPct = reactive<Record<string, number | string>>({});

// Literal keys, so the i18n parity scan can see every one of them.
function methodLabel(key: string): string {
  switch (key) {
    case "cash":
      return t("dailyPnl.rates.methods.cash");
    case "card":
      return t("dailyPnl.rates.methods.card");
    case "online":
      return t("dailyPnl.rates.methods.online");
    case "ewallet":
      return t("dailyPnl.rates.methods.ewallet");
    case "digital_wallet":
      return t("dailyPnl.rates.methods.digital_wallet");
    case "bank_transfer":
      return t("dailyPnl.rates.methods.bank_transfer");
    case "other":
      return t("dailyPnl.rates.methods.other");
    case "split":
      return t("dailyPnl.rates.methods.split");
    case "line_pay":
      return t("dailyPnl.rates.methods.line_pay");
    case "ecpay":
      return t("dailyPnl.rates.methods.ecpay");
    case "newebpay":
      return t("dailyPnl.rates.methods.newebpay");
    case "stripe":
      return t("dailyPnl.rates.methods.stripe");
    default:
      return key;
  }
}

function platformLabel(key: string): string {
  switch (key) {
    case "uber_eats":
      return t("dailyPnl.rates.platformNames.uber_eats");
    case "foodpanda":
      return t("dailyPnl.rates.platformNames.foodpanda");
    case "grabfood":
      return t("dailyPnl.rates.platformNames.grabfood");
    default:
      return key;
  }
}

const groups = computed(() =>
  rates.value
    ? [
        {
          id: "payment",
          title: t("dailyPnl.rates.paymentMethods"),
          keys: rates.value.paymentMethods,
          values: paymentPct,
          label: methodLabel,
        },
        {
          id: "platform",
          title: t("dailyPnl.rates.platforms"),
          keys: rates.value.platforms,
          values: platformPct,
          label: platformLabel,
        },
      ]
    : [],
);

function fill(
  target: Record<string, number | string>,
  bps: Record<string, number>,
  keys: string[],
) {
  for (const key of keys) target[key] = (bps[key] ?? 0) / 100;
}

/** One line of the non-zero rates in a version, e.g. "現金 2%, LINE Pay 1.5%". */
function summary(version: PnlRatesVersion): string {
  const parts = [
    ...Object.entries(version.paymentFeeBps).map(
      ([key, bps]) => [methodLabel(key), bps] as const,
    ),
    ...Object.entries(version.platformCommissionBps).map(
      ([key, bps]) => [platformLabel(key), bps] as const,
    ),
  ]
    .filter(([, bps]) => bps > 0)
    .map(([label, bps]) => `${label} ${bps / 100}%`);
  return parts.length > 0 ? parts.join(", ") : t("dailyPnl.rates.allZero");
}

/** Load a past version into the form; saving then replaces that date. */
function pick(version: PnlRatesVersion): void {
  const current = rates.value;
  if (!current) return;
  fill(paymentPct, version.paymentFeeBps, current.paymentMethods);
  fill(platformPct, version.platformCommissionBps, current.platforms);
  effectiveFrom.value = version.effectiveFrom;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await pnlService.getRates(props.restaurantId);
    fill(paymentPct, result.paymentFeeBps, result.paymentMethods);
    fill(platformPct, result.platformCommissionBps, result.platforms);
    rates.value = result;
  } catch {
    rates.value = null;
  } finally {
    loading.value = false;
  }
}

/** Percent → basis points; null when out of 0–100 or finer than 0.01%. */
function toBps(value: number | string): number | null {
  const pct = value === "" ? 0 : Number(value);
  const bps = Math.round(pct * 100);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.abs(pct * 100 - bps) < 1e-6 ? bps : null;
}

function collect(
  keys: string[],
  source: Record<string, number | string>,
): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const bps = toBps(source[key] ?? 0);
    if (bps === null) return null;
    out[key] = bps;
  }
  return out;
}

async function save(): Promise<void> {
  const current = rates.value;
  if (!current || saving.value) return;
  const paymentFeeBps = collect(current.paymentMethods, paymentPct);
  const platformCommissionBps = collect(current.platforms, platformPct);
  if (!paymentFeeBps || !platformCommissionBps) {
    toast.error(t("dailyPnl.rates.invalid"));
    return;
  }
  saving.value = true;
  try {
    const saved = await pnlService.saveRates(props.restaurantId, {
      paymentFeeBps,
      platformCommissionBps,
      effectiveFrom: effectiveFrom.value,
    });
    // The response is the GET shape: refresh the history list from it.
    if (saved?.history) rates.value = { ...current, ...saved };
    toast.success(t("dailyPnl.rates.saved"));
    emit("saved");
  } catch (cause) {
    switch (extractApiErrorCode(cause)) {
      case "PNL_RATES_DATE_INVALID":
        toast.error(t("dailyPnl.rates.dateInvalid"));
        break;
      case "PNL_RATES_TOO_MANY_VERSIONS":
        toast.error(t("dailyPnl.rates.tooManyVersions"));
        break;
      case "PNL_RATES_CONFLICT":
        toast.error(t("dailyPnl.rates.conflict"));
        // Someone else saved first: show what is stored now.
        await load();
        break;
      default:
        toast.error(t("dailyPnl.rates.saveFailed"));
    }
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
</script>
