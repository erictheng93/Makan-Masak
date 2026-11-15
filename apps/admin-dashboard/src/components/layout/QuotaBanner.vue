<template>
  <div v-if="alerts.length" class="mx-4 mt-4 space-y-2">
    <div
      v-for="alert in alerts"
      :key="alert.meter.meterKey"
      role="status"
      class="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sm"
      :class="
        alert.meter.state === 'over'
          ? 'bg-ios-red-soft text-ios-red-deep'
          : 'bg-ios-orange-soft text-ios-orange-deep'
      "
      :data-testid="`quota-banner-${alert.meter.meterKey}`"
      :data-state="alert.meter.state"
    >
      <span>{{ alert.text }}</span>
      <div class="flex shrink-0 items-center gap-2">
        <router-link
          :to="{ name: 'Billing', hash: '#plans' }"
          class="rounded-full px-4 py-1.5 font-medium text-white"
          :class="alert.meter.state === 'over' ? 'bg-ios-red' : 'bg-ios-orange'"
          data-testid="quota-banner-action"
        >
          {{ t("billing.quota.viewPlans") }}
        </router-link>
        <button
          v-if="alert.meter.state === 'warning'"
          type="button"
          class="rounded-full px-3 py-1.5 font-medium"
          :aria-label="t('common.close')"
          data-testid="quota-banner-dismiss"
          @click="dismiss(alert.meter.meterKey)"
        >
          ✕
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import { getQuotaMeters, type QuotaMeter } from "@/services/planService";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";

const STALE_MS = 5 * 60_000;
const POLL_MS = 15 * 60_000;
const DISMISS_KEY = "quota_banner_dismissed";

const { t, locale } = useI18n();
const authStore = useAuthStore();

const meters = ref<QuotaMeter[]>([]);
const dismissed = ref<string[]>(readDismissed());
let lastFetchAt = 0;

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

// Warning only: an "over" banner is never dismissible. Lasts for the session.
function dismiss(meterKey: string) {
  dismissed.value = [...dismissed.value, meterKey];
  try {
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(dismissed.value));
  } catch {
    // Without storage the banner returns on reload; harmless.
  }
}

const KIND: Record<string, "orders" | "print" | "ai"> = {
  "orders.created": "orders",
  "print.jobs": "print",
  "ai.requests": "ai",
};

const alerts = computed(() => {
  if (authStore.user?.role !== UserRole.OWNER) return [];
  const number = new Intl.NumberFormat(locale.value);
  return meters.value
    .filter(
      (meter) =>
        meter.enforced &&
        meter.state !== "ok" &&
        KIND[meter.meterKey] &&
        !(
          meter.state === "warning" && dismissed.value.includes(meter.meterKey)
        ),
    )
    .sort((a, b) => Number(b.state === "over") - Number(a.state === "over"))
    .map((meter) => {
      const limit = meter.hardLimit ?? meter.softLimit ?? 0;
      const text =
        meter.state === "over"
          ? t(`billing.quota.over.${KIND[meter.meterKey]}`)
          : t(`billing.quota.warning.${KIND[meter.meterKey]}`, {
              pct: limit
                ? Math.min(100, Math.round((meter.total / limit) * 100))
                : 0,
              used: number.format(meter.total),
              limit: number.format(limit),
            });
      return { meter, text };
    });
});

async function load() {
  if (authStore.user?.role !== UserRole.OWNER) return;
  lastFetchAt = Date.now();
  try {
    meters.value = await getQuotaMeters();
  } catch {
    // The banner is advisory; a failed read leaves the last known state.
  }
}

// Fetch on mount and when the tab comes back after a while; never a tight loop.
const poller = createVisibilityAwarePoller({
  intervalMs: POLL_MS,
  onTick: load,
  shouldCatchUp: () => Date.now() - lastFetchAt > STALE_MS,
});

// The billing page announces a plan change so the banner does not wait out
// the poll interval.
const PLAN_CHANGED_EVENT = "plan-changed";
const reload = () => void load();

// The signed-in user can arrive after this component mounts.
watch(() => authStore.user?.role, reload);

onMounted(() => {
  void load();
  poller.start();
  window.addEventListener(PLAN_CHANGED_EVENT, reload);
});
onUnmounted(() => {
  poller.stop();
  window.removeEventListener(PLAN_CHANGED_EVENT, reload);
});
</script>
