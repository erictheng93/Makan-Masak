<template>
  <div
    class="ui-page min-h-screen bg-ios-bg p-5 space-y-5"
    data-testid="billing-page"
  >
    <div>
      <h1 class="ui-page-heading text-3xl font-bold text-ios-text">
        {{ t("billing.title") }}
      </h1>
      <p class="text-sm text-ios-secondary mt-0.5">
        {{ t("billing.subtitle") }}
      </p>
    </div>

    <div
      v-if="plan?.pendingChange"
      class="ui-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-ios-orange-soft p-5 text-sm text-ios-orange-deep"
      data-testid="billing-pending-change"
      :data-deferred="plan.pendingChange.deferredReason ?? 'none'"
    >
      <div>
        <p class="font-semibold" data-testid="billing-pending-text">
          {{
            plan.pendingChange.deferredReason === "open_cash_shift"
              ? t("billing.pending.waitingShift", {
                  plan: tierLabel(plan.pendingChange.toTier),
                })
              : t("billing.pending.scheduled", {
                  date: formatDate(plan.pendingChange?.effectiveAt ?? 0),
                  plan: tierLabel(plan.pendingChange.toTier),
                })
          }}
        </p>
        <RouterLink
          v-if="plan.pendingChange.deferredReason === 'open_cash_shift'"
          :to="{ name: 'POSCheckout' }"
          class="mt-1 inline-block font-semibold underline"
          data-testid="billing-pending-pos-link"
        >
          {{ t("billing.confirm.goToPos") }}
        </RouterLink>
      </div>
      <button
        type="button"
        class="rounded-full bg-ios-orange px-5 py-2 font-semibold text-white disabled:opacity-40"
        :disabled="busy"
        data-testid="billing-pending-cancel"
        @click="cancelPending"
      >
        {{ t("billing.pending.cancel") }}
      </button>
    </div>

    <div
      v-if="error"
      data-testid="billing-error"
      class="ui-panel bg-white rounded-2xl shadow-sm p-5 text-sm text-ios-red"
    >
      {{ error }}
    </div>

    <!-- Plan -->
    <section
      class="ui-panel bg-white rounded-3xl shadow-sm p-6"
      data-testid="billing-plan"
    >
      <div class="ui-toolbar flex flex-wrap items-center justify-between gap-3">
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
              ? 'bg-ios-green-soft text-ios-green-deep'
              : 'bg-ios-red-soft text-ios-red-deep'
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
        {{
          trialDaysLeft > 0
            ? t("billing.trialRemaining", { days: trialDaysLeft })
            : t("billing.trialExpiredBanner")
        }}
      </p>
    </section>

    <!-- Usage -->
    <section
      class="ui-panel bg-white rounded-3xl shadow-sm p-6"
      data-testid="billing-usage"
    >
      <div
        class="ui-toolbar flex flex-wrap items-baseline justify-between gap-2"
      >
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
          <div class="ui-toolbar flex items-baseline justify-between gap-3">
            <span class="text-sm font-semibold text-ios-text">
              {{ meterLabel(meter.meterKey) }}
            </span>
            <span class="text-sm text-ios-secondary tabular-nums">
              {{ formatMeterValue(meter.meterKey, meter.total, locale) }}
              <template v-if="meter.hardLimit">
                /
                {{
                  formatMeterValue(meter.meterKey, meter.hardLimit, locale)
                }}</template
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
      class="ui-panel bg-white rounded-3xl shadow-sm p-6"
      data-testid="billing-modules"
    >
      <h2 class="text-lg font-bold text-ios-text">
        {{ t("billing.modulesTitle") }}
      </h2>
      <div class="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="entry in moduleEntries"
          :key="entry.key"
          class="ui-toolbar flex items-center justify-between px-4 py-2.5 rounded-2xl bg-ios-bg"
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

    <!-- Plans: a plain switch, no payment step. -->
    <section
      id="plans"
      class="ui-panel bg-white rounded-3xl shadow-sm p-6 scroll-mt-4"
      data-testid="billing-plans"
    >
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-lg font-bold text-ios-text">
          {{ t("billing.plans.title") }}
        </h2>
        <a
          :href="guideUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-sm font-semibold text-ios-blue"
          data-testid="billing-plans-guide"
        >
          {{ t("billing.plans.guide") }}
        </a>
      </div>
      <p class="text-sm text-ios-secondary mt-1">
        {{ t("billing.plans.hint") }}
      </p>

      <p
        v-if="needsRestaurant"
        class="mt-4 text-sm text-ios-secondary"
        data-testid="billing-plans-no-restaurant"
      >
        {{ t("dailyPnl.noRestaurant") }}
      </p>

      <p
        v-if="planLoadFailed"
        class="mt-4 text-sm text-ios-red"
        data-testid="billing-plans-error"
      >
        {{ t("billing.plans.loadFailed") }}
      </p>

      <div v-if="plan" class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="option in plan.options"
          :key="option.tier"
          class="flex min-w-0 flex-col rounded-2xl p-5"
          :class="
            option.action === 'current' ? 'bg-ios-blue-soft' : 'bg-ios-bg'
          "
          :data-testid="`plan-card-${option.tier}`"
          :data-action="option.action"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-base font-bold text-ios-text">
              {{ tierLabel(option.tier) }}
            </h3>
            <span
              v-if="option.action === 'current'"
              class="rounded-full bg-ios-blue px-3 py-0.5 text-xs font-semibold text-white"
              data-testid="plan-current-marker"
            >
              {{ t("billing.currentPlan") }}
            </span>
          </div>

          <dl class="mt-3 space-y-1 text-sm">
            <div
              v-for="row in quotaRows(option)"
              :key="row.key"
              class="flex justify-between gap-3"
              :data-testid="`plan-${option.tier}-limit-${row.key}`"
            >
              <dt class="text-ios-secondary">{{ row.label }}</dt>
              <dd class="font-semibold text-ios-text tabular-nums">
                {{ row.value }}
              </dd>
            </div>
          </dl>

          <ul class="mt-3 space-y-1 text-sm text-ios-text">
            <li
              v-for="key in option.modules"
              :key="key"
              class="flex items-start gap-2"
              :data-testid="`plan-${option.tier}-module-${key}`"
            >
              <span class="text-ios-green" aria-hidden="true">✓</span>
              <span>{{ moduleLabel(key) }}</span>
            </li>
          </ul>

          <div class="mt-auto pt-4">
            <p
              v-if="isPendingTarget(option)"
              class="mb-2 text-xs font-semibold text-ios-orange-deep"
            >
              {{
                t("billing.pending.badge", {
                  date: formatDate(plan.pendingChange?.effectiveAt ?? 0),
                })
              }}
            </p>
            <button
              v-if="option.action !== 'current'"
              type="button"
              class="w-full rounded-full px-5 py-2.5 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50"
              :class="
                option.action === 'upgrade'
                  ? 'bg-ios-blue text-white'
                  : 'bg-white text-ios-text'
              "
              :disabled="option.action === 'unavailable' || busy"
              :data-testid="`plan-action-${option.tier}`"
              @click="
                isPendingTarget(option) ? cancelPending() : startChange(option)
              "
            >
              {{
                isPendingTarget(option)
                  ? t("billing.pending.cancel")
                  : actionLabel(option)
              }}
            </button>
            <p
              v-if="option.action === 'unavailable'"
              class="mt-2 text-xs text-ios-secondary"
              :data-testid="`plan-unavailable-${option.tier}`"
            >
              {{
                option.unavailableReason === "region"
                  ? t("billing.plans.unavailableRegion")
                  : t("billing.plans.unavailableTrial")
              }}
            </p>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { useToast } from "vue-toastification";
import { useModuleAccess } from "@makanmasak/shared/composables/useModuleAccess";
import { useI18n } from "@/i18n";
import { api } from "@/services/api";
import {
  planService,
  type PlanImpact,
  type PlanOption,
  type PlanOverview,
} from "@/services/planService";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { extractApiErrorCode, markErrorHandled } from "@/utils/errorHandler";
import { plansGuideUrl } from "@/utils/guideLinks";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import {
  formatBytes,
  formatCount,
  formatMeterValue,
  meterMessagePath,
  moduleMessagePath,
} from "@/utils/billingLabels";

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
const toast = useToast();
const authStore = useAuthStore();
const route = useRoute();
const { confirm } = useConfirmModal();
const { refresh: refreshModuleAccess } = useModuleAccess();

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

function tierLabel(tier: string): string {
  return translateOr(`billing.tier.${tier}`, tier);
}

const planLabel = computed(() => {
  const tier = subscription.value?.planTier;
  return tier ? tierLabel(tier) : "—";
});

const guideUrl = computed(() => plansGuideUrl(locale.value));

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

const plan = ref<PlanOverview | null>(null);
const planLoadFailed = ref(false);
const busy = ref(false);

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: "medium" }).format(
    ms,
  );
}

// Admin-scoped plan calls name the shop; an owner's token already does.
const actingRestaurantId = computed(() =>
  authStore.user?.role === UserRole.ADMIN ? authStore.restaurantId : null,
);
const needsRestaurant = computed(
  () => authStore.user?.role === UserRole.ADMIN && !authStore.restaurantId,
);

// A feature-bound limit on a plan without that feature is "not included",
// never "unlimited".
const QUOTA_MODULE: Record<string, string> = {
  "print.jobs": "receipt_printing",
  "ai.requests": "ai_analytics",
};

const QUOTA_ROWS = [
  ["orders.created", "orders"],
  ["print.jobs", "print"],
  ["ai.requests", "ai"],
  ["storage.bytes", "storage"],
] as const;

function quotaRows(option: PlanOption) {
  return QUOTA_ROWS.filter(([meter]) => option.quotas[meter] !== undefined).map(
    ([meter, key]) => {
      const quota = option.quotas[meter];
      const module = QUOTA_MODULE[meter];
      return {
        key,
        label: t(`billing.plans.limit.${key}`),
        value:
          module && !option.modules.includes(module)
            ? t("billing.plans.notIncluded")
            : !quota
              ? t("billing.plans.unlimited")
              : key === "storage"
                ? formatBytes(quota.hard, locale.value)
                : formatCount(quota.hard, locale.value),
      };
    },
  );
}

function isPendingTarget(option: PlanOption): boolean {
  return plan.value?.pendingChange?.toTier === option.tier;
}

function actionLabel(option: PlanOption): string {
  // A paid plan that drops features is a change, not an upgrade.
  if (option.action === "upgrade") {
    return option.lostModules.length
      ? t("billing.plans.changeNow")
      : t("billing.plans.upgradeNow");
  }
  if (option.action === "downgrade") {
    return option.effective === "immediately" || option.effectiveAt === null
      ? t("billing.plans.downgradeNow")
      : t("billing.plans.scheduleDowngrade", {
          date: formatDate(option.effectiveAt),
        });
  }
  return t("billing.plans.unavailable");
}

async function loadSummary() {
  try {
    const [modulesResponse, usageResponse] = await Promise.all([
      api.get("/me/modules"),
      api.get("/me/usage"),
    ]);
    subscription.value = modulesResponse.data?.data ?? null;
    usage.value = usageResponse.data?.data ?? null;
  } catch {
    error.value = t("billing.loadFailed");
  }
}

async function loadPlan() {
  if (needsRestaurant.value) return;
  try {
    plan.value = await planService.getPlan(actingRestaurantId.value);
    planLoadFailed.value = false;
  } catch {
    planLoadFailed.value = true;
  }
}

// Each code is its own translated sentence; an unknown error is left to the
// global handler's toast.
const PLAN_ERROR_KEYS: Record<string, string> = {
  PLAN_UNCHANGED: "billing.errors.unchanged",
  PLAN_TRIAL_NOT_REENTERABLE: "billing.errors.trialNotReenterable",
  PLAN_NOT_AVAILABLE_IN_REGION: "billing.errors.notInRegion",
  SUBSCRIPTION_INACTIVE: "billing.errors.inactive",
  PLAN_CHANGE_BLOCKED_OPEN_SHIFT: "billing.errors.openShift",
  PLAN_CHANGE_CONFLICT: "billing.errors.conflict",
  PLAN_NO_PENDING_CHANGE: "billing.errors.noPending",
};

async function reportError(caught: unknown) {
  const code = extractApiErrorCode(caught);
  const key = code ? PLAN_ERROR_KEYS[code] : undefined;
  if (!key) return;
  markErrorHandled(caught);
  toast.error(t(key));
  // Whatever the refusal, show what is true now.
  // This covers PLAN_UNCHANGED too: asking for the current plan while a
  // downgrade is pending is refused, and the page may be stale.
  await loadPlan();
}

function buildConfirm(option: PlanOption, impact: PlanImpact) {
  const plan_ = tierLabel(option.tier);
  const cycleEnd = option.effective === "cycle_end" && option.effectiveAt;
  const message = [
    cycleEnd
      ? t("billing.confirm.effectiveCycleEnd", {
          date: formatDate(option.effectiveAt as number),
        })
      : t("billing.confirm.effectiveNow"),
    cycleEnd
      ? t("billing.confirm.usageFreshScheduled")
      : t("billing.confirm.usageFresh"),
    plan.value?.currentTier === "trial"
      ? t("billing.confirm.trialNoReturn")
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const sections: Array<{
    heading: string;
    items: string[];
    blocking?: boolean;
  }> = [];
  if (option.gainedModules.length) {
    sections.push({
      heading: t("billing.confirm.gained"),
      items: option.gainedModules.map(moduleLabel),
    });
  }
  const lost = impact.lostModules?.length
    ? impact.lostModules
    : option.lostModules;
  if (lost.length) {
    sections.push({
      heading: t("billing.confirm.lost"),
      items: lost.map(moduleLabel),
    });
  }
  const sentence = (item: PlanImpact["items"][number]) =>
    t(`billing.impact.${item.key}`, { count: item.count });
  const visible = impact.items.filter((i) => i.blocking || i.count > 0);
  const blocking = visible.filter((i) => i.blocking);
  const notes = visible.filter((i) => !i.blocking);
  if (blocking.length) {
    sections.push({
      heading: t("billing.confirm.blocking"),
      items: blocking.map(sentence),
      blocking: true,
    });
  }
  if (notes.length) {
    sections.push({
      heading: t("billing.confirm.impact"),
      items: notes.map(sentence),
    });
  }

  return {
    type:
      option.action === "downgrade"
        ? ("danger" as const)
        : ("warning" as const),
    title: t("billing.confirm.title", { plan: plan_ }),
    message,
    confirmLabel: cycleEnd
      ? t("billing.confirm.confirmScheduleDowngrade")
      : lost.length
        ? t("billing.confirm.confirmChange")
        : t("billing.confirm.confirmUpgrade"),
    sections,
    confirmDisabled: blocking.length > 0,
    link: blocking.some((i) => i.key === "open_cash_shift")
      ? { to: { name: "POSCheckout" }, label: t("billing.confirm.goToPos") }
      : undefined,
  };
}

async function startChange(option: PlanOption) {
  if (busy.value) return;
  busy.value = true;
  try {
    let impact: PlanImpact;
    try {
      impact = await planService.getImpact(
        option.tier,
        actingRestaurantId.value,
      );
    } catch (caught) {
      await reportError(caught);
      return;
    }
    if (!(await confirm(buildConfirm(option, impact)))) return;

    try {
      await planService.changePlan(option.tier, actingRestaurantId.value);
    } catch (caught) {
      await reportError(caught);
      return;
    }
    await loadPlan();
    toast.success(
      plan.value?.pendingChange
        ? t("billing.plans.scheduled", { plan: tierLabel(option.tier) })
        : t("billing.plans.changed", { plan: tierLabel(option.tier) }),
    );
    // The sidebar and module gates read the module-access store, which caches
    // for five minutes: refresh it so new entries appear without a reload.
    await Promise.all([loadSummary(), refreshModuleAccess()]);
    window.dispatchEvent(new Event("plan-changed"));
  } finally {
    busy.value = false;
  }
}

async function cancelPending() {
  if (busy.value) return;
  const confirmed = await confirm({
    type: "warning",
    title: t("billing.pending.cancelTitle"),
    message: t("billing.pending.cancelMessage"),
    confirmLabel: t("billing.pending.cancel"),
  });
  if (!confirmed) return;
  busy.value = true;
  try {
    await planService.cancelPending(actingRestaurantId.value);
    await loadPlan();
    toast.success(t("billing.pending.cancelled"));
  } catch (caught) {
    await reportError(caught);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadSummary(), loadPlan()]);
  loading.value = false;
  if (route?.hash === "#plans") {
    await nextTick();
    document.getElementById("plans")?.scrollIntoView?.();
  }
});
</script>
