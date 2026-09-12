<template>
  <div class="min-h-screen bg-ios-bg p-5 space-y-5" data-testid="billing-page">
    <div>
      <h1 class="text-3xl font-bold text-ios-text">{{ t("billing.title") }}</h1>
      <p class="text-sm text-ios-secondary mt-0.5">
        {{ t("billing.subtitle") }}
      </p>
    </div>

    <div
      v-if="error"
      data-testid="billing-error"
      class="bg-white rounded-2xl shadow-sm p-5 text-sm text-ios-red"
    >
      {{ error }}
    </div>

    <!-- Plan -->
    <section
      class="bg-white rounded-3xl shadow-sm p-6"
      data-testid="billing-plan"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold text-ios-secondary uppercase">
            {{ t("billing.currentPlan") }}
          </p>
          <p
            class="text-2xl font-bold text-ios-text mt-1"
            data-testid="billing-plan-tier"
          >
            {{ planLabel }}
          </p>
        </div>
        <span
          class="px-4 py-1.5 rounded-full text-sm font-semibold"
          :class="
            subscription?.isActive
              ? 'bg-ios-green/10 text-ios-green'
              : 'bg-ios-red/10 text-ios-red'
          "
          :data-status="subscription?.isActive ? 'active' : 'inactive'"
          data-testid="billing-plan-status"
        >
          {{
            subscription?.isActive
              ? t("billing.statusActive")
              : t("billing.statusInactive")
          }}
        </span>
      </div>

      <p
        v-if="trialDaysLeft !== null"
        class="text-sm text-ios-secondary mt-3"
        data-testid="billing-trial-remaining"
      >
        {{ t("billing.trialRemaining", { days: trialDaysLeft }) }}
      </p>
    </section>

    <!-- Usage -->
    <section
      class="bg-white rounded-3xl shadow-sm p-6"
      data-testid="billing-usage"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-bold text-ios-text">
          {{ t("billing.usageTitle") }}
        </h2>
        <p v-if="cycleLabel" class="text-xs text-ios-secondary">
          {{ cycleLabel }}
        </p>
      </div>

      <p
        v-if="!loading && meters.length === 0"
        class="text-sm text-ios-secondary mt-4"
        data-testid="billing-usage-empty"
      >
        {{ t("billing.usageEmpty") }}
      </p>

      <ul v-else class="mt-4 space-y-4">
        <li
          v-for="meter in meters"
          :key="meter.meterKey"
          :data-testid="`billing-meter-${meter.meterKey}`"
          :data-state="meterState(meter)"
        >
          <div class="flex items-baseline justify-between gap-3">
            <span class="text-sm font-semibold text-ios-text">
              {{ meterLabel(meter.meterKey) }}
            </span>
            <span class="text-sm text-ios-secondary tabular-nums">
              {{ meter.total }}
              <template v-if="meter.hardLimit">
                / {{ meter.hardLimit }}</template
              >
            </span>
          </div>
          <div class="mt-2 h-2 rounded-full bg-ios-bg overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="meterBarClass(meter)"
              :style="{ width: `${barWidth(meter)}%` }"
            />
          </div>
        </li>
      </ul>
    </section>

    <!-- Modules -->
    <section
      class="bg-white rounded-3xl shadow-sm p-6"
      data-testid="billing-modules"
    >
      <h2 class="text-lg font-bold text-ios-text">
        {{ t("billing.modulesTitle") }}
      </h2>
      <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="entry in moduleEntries"
          :key="entry.key"
          class="flex items-center justify-between px-4 py-2.5 rounded-2xl bg-ios-bg"
          :data-testid="`billing-module-${entry.key}`"
          :data-enabled="entry.enabled ? 'true' : 'false'"
        >
          <span class="text-sm text-ios-text">{{
            moduleLabel(entry.key)
          }}</span>
          <span
            class="text-xs font-semibold"
            :class="entry.enabled ? 'text-ios-green' : 'text-ios-secondary'"
          >
            {{ entry.enabled ? t("billing.moduleOn") : t("billing.moduleOff") }}
          </span>
        </div>
      </div>
    </section>

    <!--
      Deliberately not an "upgrade" button. There is no self-serve plan change
      anywhere in the product: every plan field is written by the platform
      operator console, so a button here would be a dead end. The support-ticket
      channel is the route that actually reaches someone.
    -->
    <section class="bg-white rounded-3xl shadow-sm p-6">
      <h2 class="text-lg font-bold text-ios-text">
        {{ t("billing.changePlanTitle") }}
      </h2>
      <p class="text-sm text-ios-secondary mt-1">
        {{ t("billing.changePlanHint") }}
      </p>
      <RouterLink
        to="/dashboard/feedback"
        data-testid="billing-contact-support"
        class="inline-flex items-center gap-2 mt-4 px-5 py-2.5 rounded-full bg-ios-blue text-white text-sm font-semibold hover:bg-blue-600 transition-all duration-200 shadow-sm"
      >
        {{ t("billing.changePlanCta") }}
      </RouterLink>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "@/i18n";
import { api } from "@/services/api";
import { meterMessagePath, moduleMessagePath } from "@/utils/billingLabels";

interface UsageMeter {
  meterKey: string;
  total: number;
  softLimit?: number | null;
  hardLimit?: number | null;
  percentage?: number | null;
}

interface SubscriptionSummary {
  planTier?: string;
  isActive?: boolean;
  trialEndsAt?: number | null;
  effectiveModules?: Record<string, boolean>;
}

interface UsageSummary {
  cycleStartAt?: number | null;
  cycleEndAt?: number | null;
  meters?: UsageMeter[];
}

const { t, locale } = useI18n();

/**
 * The app's i18n runtime has no `te`. A missing key resolves to the key itself,
 * so that is the check — which also keeps a raw meter/module key readable on
 * screen rather than showing a dotted i18n path.
 */
function translateOr(key: string, fallback: string): string {
  const value = t(key);
  return value === key ? fallback : value;
}

const subscription = ref<SubscriptionSummary | null>(null);
const usage = ref<UsageSummary | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

const meters = computed(() => usage.value?.meters ?? []);

const moduleEntries = computed(() =>
  Object.entries(subscription.value?.effectiveModules ?? {}).map(
    ([key, enabled]) => ({ key, enabled }),
  ),
);

const planLabel = computed(() => {
  const tier = subscription.value?.planTier;
  if (!tier) return "—";
  return translateOr(`billing.tier.${tier}`, tier);
});

const trialDaysLeft = computed(() => {
  const endsAt = subscription.value?.trialEndsAt;
  if (!endsAt || subscription.value?.planTier !== "trial") return null;
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 86_400_000));
});

const cycleLabel = computed(() => {
  const { cycleStartAt, cycleEndAt } = usage.value ?? {};
  if (!cycleStartAt || !cycleEndAt) return "";
  const fmt = new Intl.DateTimeFormat(locale.value, {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(cycleStartAt)} – ${fmt.format(cycleEndAt)}`;
});

function meterLabel(key: string): string {
  return translateOr(meterMessagePath(key), key);
}

function moduleLabel(key: string): string {
  return translateOr(moduleMessagePath(key), key);
}

/** Percentage of the hard limit, clamped so an overage still renders a full bar. */
function barWidth(meter: UsageMeter): number {
  if (!meter.hardLimit) return 0;
  return Math.min(100, Math.round((meter.total / meter.hardLimit) * 100));
}

function meterState(meter: UsageMeter): "over" | "warning" | "ok" {
  if (meter.hardLimit && meter.total >= meter.hardLimit) return "over";
  if (meter.softLimit && meter.total >= meter.softLimit) return "warning";
  return "ok";
}

function meterBarClass(meter: UsageMeter): string {
  const state = meterState(meter);
  if (state === "over") return "bg-ios-red";
  if (state === "warning") return "bg-ios-orange";
  return "bg-ios-blue";
}

onMounted(async () => {
  try {
    const [modulesResponse, usageResponse] = await Promise.all([
      api.get("/me/modules"),
      api.get("/me/usage"),
    ]);
    subscription.value = modulesResponse.data?.data ?? null;
    usage.value = usageResponse.data?.data ?? null;
  } catch {
    error.value = t("billing.loadFailed");
  } finally {
    loading.value = false;
  }
});
</script>
