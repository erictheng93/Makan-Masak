<template>
  <section
    data-testid="pnl-rates"
    class="ui-panel mb-4 rounded-3xl bg-white p-5 shadow-ios-sm"
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
      {{ t("dailyPnl.rates.appliesToPast") }}
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
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { pnlService, type PnlRates } from "@/services/pnlService";

const props = defineProps<{ restaurantId: string }>();
const emit = defineEmits<{ saved: []; close: [] }>();

const { t } = useI18n();
const toast = useToast();

const rates = ref<PnlRates | null>(null);
const loading = ref(false);
const saving = ref(false);
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
    await pnlService.saveRates(props.restaurantId, {
      paymentFeeBps,
      platformCommissionBps,
    });
    toast.success(t("dailyPnl.rates.saved"));
    emit("saved");
  } catch {
    toast.error(t("dailyPnl.rates.saveFailed"));
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
</script>
