<template>
  <div class="min-h-screen bg-ios-bg p-5 space-y-5">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-ios-text">
          {{ t("subscriptions.title") }}
        </h1>
        <p class="text-sm text-ios-secondary mt-0.5">
          {{ t("subscriptions.subtitle") }}
        </p>
      </div>
      <button
        class="flex items-center gap-2 px-5 py-2.5 rounded-full bg-ios-blue text-white text-sm font-semibold hover:bg-blue-600 transition-all duration-200 shadow-sm"
        @click="showCreateModal = true"
      >
        <Plus class="w-4 h-4" />
        {{ t("subscriptions.addSubscription") }}
      </button>
    </div>

    <div class="inline-flex rounded-full bg-white p-1 shadow-sm">
      <button
        class="rounded-full px-4 py-2 text-sm font-semibold transition"
        :class="
          activeTab === 'subscriptions'
            ? 'bg-ios-blue text-white'
            : 'text-ios-text/85 hover:bg-ios-bg'
        "
        @click="activeTab = 'subscriptions'"
      >
        訂閱
      </button>
      <button
        class="rounded-full px-4 py-2 text-sm font-semibold transition"
        :class="
          activeTab === 'usage'
            ? 'bg-ios-blue text-white'
            : 'text-ios-text/85 hover:bg-ios-bg'
        "
        @click="activeTab = 'usage'"
      >
        用量
      </button>
    </div>

    <UsageTab v-if="activeTab === 'usage'" :subscriptions="subscriptions" />

    <!-- Loading state -->
    <div v-else-if="isLoading" class="flex items-center justify-center py-16">
      <div
        class="w-8 h-8 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
      />
    </div>

    <!-- Error state -->
    <div
      v-else-if="errorMessage"
      class="bg-white rounded-2xl p-8 shadow-sm text-center"
    >
      <AlertCircle class="w-10 h-10 text-ios-red mx-auto mb-3" />
      <p class="text-ios-text font-medium">{{ errorMessage }}</p>
      <button
        class="mt-4 px-5 py-2.5 rounded-full bg-ios-blue text-white text-sm font-semibold hover:bg-blue-600 transition-all"
        @click="loadSubscriptions"
      >
        {{ t("common.retry") }}
      </button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="subscriptions.length === 0"
      class="bg-white rounded-2xl p-12 shadow-sm text-center"
    >
      <CreditCard class="w-12 h-12 text-ios-tertiary mx-auto mb-3" />
      <p class="text-ios-secondary text-sm">{{ t("subscriptions.empty") }}</p>
    </div>

    <!-- Subscription cards -->
    <div v-else class="space-y-4">
      <div
        v-for="sub in subscriptions"
        :key="sub.id"
        class="bg-white rounded-2xl shadow-sm overflow-hidden transition-all duration-200"
        :class="{ 'opacity-60': !sub.isActive }"
      >
        <!-- Card header -->
        <div class="p-5">
          <div class="flex items-start justify-between gap-4">
            <!-- Left: restaurant info + plan badge -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2.5 flex-wrap">
                <span class="text-base font-semibold text-ios-text font-mono">
                  {{ truncateId(sub.restaurantId) }}
                </span>
                <!-- Plan badge -->
                <span
                  class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                  :class="planBadgeClass(sub.planTier)"
                >
                  {{ t(`subscriptions.plans.${sub.planTier}`) }}
                </span>
              </div>
              <!-- Trial end date -->
              <p
                v-if="sub.planTier === 'trial' && sub.trialEndsAt"
                class="text-xs text-ios-orange mt-1"
              >
                {{ t("subscriptions.trialEndsAt") }}
                {{ formatDate(sub.trialEndsAt) }}
              </p>
              <p
                v-else-if="sub.billingCycleEndAt"
                class="text-xs text-ios-secondary mt-1"
              >
                {{ t("subscriptions.billingUntil") }}
                {{ formatDate(sub.billingCycleEndAt) }}
              </p>
            </div>

            <!-- Right: kill switch + plan change -->
            <div class="flex items-center gap-3 flex-shrink-0">
              <!-- Plan change dropdown -->
              <div class="relative">
                <select
                  :value="sub.planTier"
                  class="appearance-none pl-3 pr-8 py-2 bg-ios-bg border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all cursor-pointer"
                  :disabled="updatingPlan[sub.restaurantId]"
                  @change="
                    onPlanChange(
                      sub,
                      ($event.target as HTMLSelectElement).value as PlanTier,
                    )
                  "
                >
                  <option v-for="tier in planTiers" :key="tier" :value="tier">
                    {{ t(`subscriptions.plans.${tier}`) }}
                  </option>
                </select>
                <ChevronDown
                  class="w-3.5 h-3.5 text-ios-secondary absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
                />
              </div>

              <!-- Kill switch toggle -->
              <button
                class="flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold transition-all duration-200"
                :class="
                  sub.isActive
                    ? 'bg-ios-green/10 text-ios-green hover:bg-ios-green/20'
                    : 'bg-ios-red/10 text-ios-red hover:bg-ios-red/20'
                "
                :disabled="updatingStatus[sub.restaurantId]"
                @click="onToggleActive(sub)"
              >
                <span
                  v-if="updatingStatus[sub.restaurantId]"
                  class="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin"
                />
                <template v-else>
                  <ToggleRight v-if="sub.isActive" class="w-4 h-4" />
                  <ToggleLeft v-else class="w-4 h-4" />
                </template>
                <span>{{
                  sub.isActive
                    ? t("subscriptions.active")
                    : t("subscriptions.inactive")
                }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Module toggles grid -->
        <div class="px-5 pb-5">
          <p
            class="text-xs font-semibold text-ios-secondary uppercase tracking-wide mb-3"
          >
            {{ t("subscriptions.modules") }}
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="moduleKey in allModules"
              :key="moduleKey"
              class="px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
              :class="moduleToggleClass(sub, moduleKey)"
              :disabled="!!updatingModules[sub.restaurantId]"
              :title="moduleKey"
              @click="onToggleModule(sub, moduleKey)"
            >
              <span
                v-if="updatingModules[sub.restaurantId] === moduleKey"
                class="inline-block w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin mr-1"
              />
              {{ t(`subscriptions.moduleNames.${moduleKey}`) }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create subscription modal -->
    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="showCreateModal"
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          <div
            class="absolute inset-0 bg-black/30 backdrop-blur-sm"
            @click="closeCreateModal"
          />
          <div
            class="relative w-full sm:max-w-lg bg-ios-bg rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
          >
            <!-- Modal header -->
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold text-ios-text">
                {{ t("subscriptions.addSubscription") }}
              </h2>
              <button
                :aria-label="t('common.close')"
                class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 text-ios-text/85 hover:bg-gray-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                @click="closeCreateModal"
              >
                <X class="w-4 h-4" />
              </button>
            </div>

            <!-- Form -->
            <div class="bg-white rounded-2xl p-4 shadow-sm space-y-4">
              <!-- Restaurant ID -->
              <div>
                <label
                  class="block text-xs font-semibold text-ios-secondary uppercase tracking-wide mb-1.5"
                >
                  {{ t("subscriptions.form.restaurantId") }}
                  <span class="text-ios-red">*</span>
                </label>
                <input
                  v-model="createForm.restaurantId"
                  type="text"
                  :placeholder="t('subscriptions.form.restaurantIdPlaceholder')"
                  class="w-full px-4 py-2.5 bg-ios-bg border-0 rounded-xl text-sm text-ios-text placeholder-ios-secondary focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all"
                />
              </div>

              <!-- Plan tier -->
              <div>
                <label
                  class="block text-xs font-semibold text-ios-secondary uppercase tracking-wide mb-1.5"
                >
                  {{ t("subscriptions.form.planTier") }}
                  <span class="text-ios-red">*</span>
                </label>
                <div class="relative">
                  <select
                    v-model="createForm.planTier"
                    class="w-full appearance-none pl-4 pr-8 py-2.5 bg-ios-bg border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
                  >
                    <option v-for="tier in planTiers" :key="tier" :value="tier">
                      {{ t(`subscriptions.plans.${tier}`) }}
                    </option>
                  </select>
                  <ChevronDown
                    class="w-3.5 h-3.5 text-ios-secondary absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  />
                </div>
              </div>

              <!-- Trial end date (shown only when plan is trial) -->
              <Transition name="fade-slide">
                <div v-if="createForm.planTier === 'trial'">
                  <label
                    class="block text-xs font-semibold text-ios-secondary uppercase tracking-wide mb-1.5"
                  >
                    {{ t("subscriptions.form.trialEndsAt") }}
                  </label>
                  <input
                    v-model="createForm.trialEndsAt"
                    type="date"
                    class="w-full px-4 py-2.5 bg-ios-bg border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all"
                  />
                </div>
              </Transition>
            </div>

            <!-- Error message -->
            <p v-if="createError" class="text-sm text-ios-red px-1">
              {{ createError }}
            </p>

            <!-- Actions -->
            <div class="flex gap-3">
              <button
                class="flex-1 py-3 rounded-full bg-ios-bg text-ios-text text-sm font-semibold hover:bg-gray-200 transition-all duration-200"
                @click="closeCreateModal"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                class="flex-1 py-3 rounded-full bg-ios-blue text-white text-sm font-semibold hover:bg-blue-600 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="isCreating"
                @click="onCreateSubscription"
              >
                <span
                  v-if="isCreating"
                  class="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
                />
                <span v-else>{{ t("subscriptions.form.create") }}</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Deactivation confirmation modal -->
    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="confirmDeactivate"
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          <div
            class="absolute inset-0 bg-black/30 backdrop-blur-sm"
            @click="confirmDeactivate = null"
          />
          <div
            class="relative w-full sm:max-w-sm bg-ios-bg rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
          >
            <div class="text-center space-y-2">
              <div
                class="w-12 h-12 rounded-full bg-ios-red/10 flex items-center justify-center mx-auto"
              >
                <AlertCircle class="w-6 h-6 text-ios-red" />
              </div>
              <h2 class="text-base font-semibold text-ios-text">
                {{ t("subscriptions.confirmDeactivateTitle") }}
              </h2>
              <p class="text-sm text-ios-secondary">
                {{ t("subscriptions.confirmDeactivateMessage") }}
                <span class="font-mono font-medium text-ios-text">{{
                  truncateId(confirmDeactivate)
                }}</span>
              </p>
            </div>
            <div class="flex gap-3">
              <button
                class="flex-1 py-3 rounded-full bg-ios-bg text-ios-text text-sm font-semibold hover:bg-gray-200 transition-all duration-200"
                @click="confirmDeactivate = null"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                class="flex-1 py-3 rounded-full bg-ios-red text-white text-sm font-semibold hover:bg-red-600 transition-all duration-200"
                @click="executeDeactivate"
              >
                {{ t("subscriptions.deactivate") }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import {
  Plus,
  CreditCard,
  AlertCircle,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  subscriptionService,
  type Subscription,
  type PlanTier,
} from "@/services/subscriptionService";
import UsageTab from "@/components/billing/UsageTab.vue";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();
const { formatDate } = useDateFormatter();

// ─── State ────────────────────────────────────────────────────────────────────

const subscriptions = ref<Subscription[]>([]);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);
const activeTab = ref<"subscriptions" | "usage">("subscriptions");

// Per-row updating states (keyed by restaurantId)
const updatingModules = reactive<Record<string, string | false>>({});
const updatingStatus = reactive<Record<string, boolean>>({});
const updatingPlan = reactive<Record<string, boolean>>({});

// Create modal
const showCreateModal = ref(false);
const isCreating = ref(false);
const createError = ref<string | null>(null);
const createForm = reactive({
  restaurantId: "",
  planTier: "trial" as PlanTier,
  trialEndsAt: "",
});

// Deactivation confirmation
const confirmDeactivate = ref<string | null>(null);

// ─── Constants ────────────────────────────────────────────────────────────────

const planTiers: PlanTier[] = ["trial", "basic", "pro", "enterprise"];

const allModules = [
  "menu_management",
  "table_management",
  "online_ordering",
  "kitchen_display",
  "receipt_printing",
  "coupons",
  "reservations",
  "analytics",
  "ai_analytics",
  "platform_integration",
  "loyalty",
] as const;

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadSubscriptions() {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    subscriptions.value = await subscriptionService.getAll();
  } catch (err: unknown) {
    errorMessage.value = resolveUserFacingError(err, t, {
      fallbackKey: "subscriptions.loadError",
    }).message;
  } finally {
    isLoading.value = false;
  }
}

// ─── Module toggle ────────────────────────────────────────────────────────────

async function onToggleModule(sub: Subscription, moduleKey: string) {
  if (updatingModules[sub.restaurantId]) return;

  // Optimistic update
  const currentValue = sub.effectiveModules[moduleKey] ?? false;
  const newOverrides = {
    ...sub.moduleOverrides,
    [moduleKey]: !currentValue,
  };

  const idx = subscriptions.value.findIndex(
    (s) => s.restaurantId === sub.restaurantId,
  );
  if (idx === -1) return;

  // Optimistically mutate effective modules
  subscriptions.value[idx] = {
    ...subscriptions.value[idx],
    moduleOverrides: newOverrides,
    effectiveModules: {
      ...subscriptions.value[idx].effectiveModules,
      [moduleKey]: !currentValue,
    },
  };

  updatingModules[sub.restaurantId] = moduleKey;
  try {
    const updated = await subscriptionService.updateModules(
      sub.restaurantId,
      newOverrides,
    );
    subscriptions.value[idx] = updated;
  } catch {
    // Rollback optimistic update
    subscriptions.value[idx] = sub;
  } finally {
    updatingModules[sub.restaurantId] = false;
  }
}

// ─── Plan change ──────────────────────────────────────────────────────────────

async function onPlanChange(sub: Subscription, planTier: PlanTier) {
  if (planTier === sub.planTier) return;
  updatingPlan[sub.restaurantId] = true;
  try {
    const updated = await subscriptionService.changePlan(
      sub.restaurantId,
      planTier,
    );
    const idx = subscriptions.value.findIndex(
      (s) => s.restaurantId === sub.restaurantId,
    );
    if (idx !== -1) subscriptions.value[idx] = updated;
  } catch {
    // no-op: select will reset via v-model binding to original
  } finally {
    updatingPlan[sub.restaurantId] = false;
  }
}

// ─── Kill switch ──────────────────────────────────────────────────────────────

function onToggleActive(sub: Subscription) {
  if (sub.isActive) {
    // Ask for confirmation before deactivating
    confirmDeactivate.value = sub.restaurantId;
  } else {
    executeActivate(sub.restaurantId);
  }
}

async function executeActivate(restaurantId: string) {
  updatingStatus[restaurantId] = true;
  try {
    const updated = await subscriptionService.setActive(restaurantId, true);
    const idx = subscriptions.value.findIndex(
      (s) => s.restaurantId === restaurantId,
    );
    if (idx !== -1) subscriptions.value[idx] = updated;
  } finally {
    updatingStatus[restaurantId] = false;
  }
}

async function executeDeactivate() {
  const restaurantId = confirmDeactivate.value;
  if (!restaurantId) return;
  confirmDeactivate.value = null;
  updatingStatus[restaurantId] = true;
  try {
    const updated = await subscriptionService.setActive(restaurantId, false);
    const idx = subscriptions.value.findIndex(
      (s) => s.restaurantId === restaurantId,
    );
    if (idx !== -1) subscriptions.value[idx] = updated;
  } finally {
    updatingStatus[restaurantId] = false;
  }
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function closeCreateModal() {
  showCreateModal.value = false;
  createError.value = null;
  createForm.restaurantId = "";
  createForm.planTier = "trial";
  createForm.trialEndsAt = "";
}

async function onCreateSubscription() {
  createError.value = null;
  if (!createForm.restaurantId.trim()) {
    createError.value = t("subscriptions.form.restaurantIdRequired");
    return;
  }

  isCreating.value = true;
  try {
    const created = await subscriptionService.create({
      restaurantId: createForm.restaurantId.trim(),
      planTier: createForm.planTier,
      trialEndsAt: createForm.trialEndsAt
        ? new Date(createForm.trialEndsAt).toISOString()
        : null,
    });
    subscriptions.value.unshift(created);
    closeCreateModal();
  } catch (err: unknown) {
    createError.value = resolveUserFacingError(err, t, {
      fallbackKey: "subscriptions.form.createError",
    }).message;
  } finally {
    isCreating.value = false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function planBadgeClass(tier: PlanTier): string {
  const map: Record<PlanTier, string> = {
    trial: "bg-gray-100 text-ios-text/85",
    basic: "bg-ios-blue/10 text-ios-blue",
    pro: "bg-ios-orange/10 text-ios-orange",
    enterprise: "bg-teal-100 text-teal-700",
  };
  return map[tier] ?? "bg-gray-100 text-ios-text/85";
}

function moduleToggleClass(sub: Subscription, moduleKey: string): string {
  const isEnabled = sub.effectiveModules[moduleKey] ?? false;
  const isOverridden = moduleKey in sub.moduleOverrides;

  if (isEnabled) {
    return isOverridden
      ? "bg-ios-blue text-white shadow-sm"
      : "bg-ios-green/15 text-ios-green";
  }
  return "bg-ios-bg text-ios-secondary hover:bg-gray-200";
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  loadSubscriptions();
});
</script>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease-out;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: all 0.3s ease-out;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from > div:last-child,
.sheet-leave-to > div:last-child {
  transform: translateY(100%);
}
</style>
