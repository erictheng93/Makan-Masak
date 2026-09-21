<template>
  <section
    v-if="showChecklist"
    data-testid="owner-setup-checklist"
    class="rounded-2xl bg-white p-6 shadow-ios-card"
    aria-labelledby="owner-setup-checklist-title"
  >
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2
          id="owner-setup-checklist-title"
          class="text-lg font-semibold text-ios-text"
        >
          {{ t("dashboard.setupChecklist.title") }}
        </h2>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("dashboard.setupChecklist.description") }}
        </p>
      </div>
      <button
        data-testid="setup-checklist-dismiss"
        type="button"
        class="min-h-11 rounded-full px-3 text-sm font-medium text-ios-secondary transition-colors hover:bg-ios-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
        @click="dismiss"
      >
        {{ t("dashboard.setupChecklist.dismiss") }}
      </button>
    </div>

    <ul class="mt-4 grid gap-3 sm:grid-cols-2" role="list">
      <li
        v-for="item in checklist"
        :key="item.key"
        :data-testid="`setup-checklist-${item.key}`"
        :data-status="item.state"
        class="flex items-center justify-between gap-3 rounded-2xl bg-ios-bg px-4 py-3"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            :class="statusIconClass(item.state)"
          >
            {{ statusIcon(item.state) }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium text-ios-text">{{ item.label }}</p>
            <p
              v-if="item.state === 'unknown'"
              class="mt-0.5 text-xs text-ios-secondary"
            >
              {{ t("dashboard.setupChecklist.unableToVerify") }}
            </p>
          </div>
        </div>

        <button
          v-if="item.state !== 'complete'"
          :data-testid="`setup-checklist-${item.key}-action`"
          type="button"
          class="min-h-11 shrink-0 rounded-full bg-ios-blue px-4 text-sm font-medium text-white transition-colors hover:bg-ios-blue/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue focus-visible:ring-offset-2"
          @click="navigate(item.to)"
        >
          {{
            item.state === "unknown"
              ? t("dashboard.setupChecklist.check")
              : t("dashboard.setupChecklist.complete")
          }}
        </button>
        <span v-else class="shrink-0 text-sm font-medium text-ios-green">
          {{ t("dashboard.setupChecklist.done") }}
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { api, unwrapApiList, unwrapApiPayload } from "@/services/api";
import { useAuthStore } from "@/stores/auth";

type ChecklistState = "complete" | "incomplete" | "unknown";

interface RestaurantProfile {
  name?: string;
  address?: string;
  city?: string;
  district?: string;
  businessHours?: Record<string, unknown>;
  isAvailable?: boolean;
  settings?: { allowGuestOrders?: boolean };
}

interface MenuPayload {
  menuItems?: Array<{ isAvailable?: boolean }>;
}

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore();

const setupChecks = ref<Record<string, ChecklistState>>({});
const dismissed = ref(false);

const checklist = computed(() => [
  {
    key: "profile",
    label: t("dashboard.setupChecklist.profile"),
    to: "/dashboard/settings",
    state: setupChecks.value.profile ?? "unknown",
  },
  {
    key: "menu",
    label: t("dashboard.setupChecklist.menu"),
    to: "/dashboard/menu",
    state: setupChecks.value.menu ?? "unknown",
  },
  {
    key: "tables",
    label: t("dashboard.setupChecklist.tables"),
    to: "/dashboard/seating/table-setup",
    state: setupChecks.value.tables ?? "unknown",
  },
  {
    key: "guest-orders",
    label: t("dashboard.setupChecklist.guestOrders"),
    to: "/dashboard/settings?tab=orders",
    state: setupChecks.value.guestOrders ?? "unknown",
  },
  {
    key: "staff",
    label: t("dashboard.setupChecklist.staff"),
    to: "/dashboard/employees",
    state: setupChecks.value.staff ?? "unknown",
  },
]);

const storageKey = computed(() =>
  authStore.restaurantId
    ? `makanmasak:setup-checklist-dismissed:${authStore.restaurantId}`
    : "",
);

const showChecklist = computed(
  () =>
    authStore.user?.role === 1 &&
    authStore.hasRestaurantContext &&
    !dismissed.value &&
    // Adding employees is explicitly optional, so it cannot keep the card open.
    checklist.value.some(
      (item) => item.key !== "staff" && item.state !== "complete",
    ),
);

function wasDismissed() {
  try {
    return Boolean(storageKey.value && localStorage.getItem(storageKey.value));
  } catch {
    // Storage may be blocked in a private or embedded browser context.
    return false;
  }
}

function dismiss() {
  try {
    if (storageKey.value) localStorage.setItem(storageKey.value, "1");
  } catch {
    // The in-memory dismissal still makes the current session predictable.
  }
  dismissed.value = true;
}

function listState(result: PromiseSettledResult<unknown>): ChecklistState {
  if (result.status === "rejected") return "unknown";

  return unwrapApiList<unknown>((result.value as { data: unknown }).data)
    .length > 0
    ? "complete"
    : "incomplete";
}

function profileIsComplete(profile: RestaurantProfile | null) {
  return Boolean(
    profile?.name?.trim() &&
    profile.address?.trim() &&
    profile.city?.trim() &&
    profile.district?.trim() &&
    !profile.address.startsWith("Onboarding GPS ") &&
    !profile.address.startsWith("Onboarding application ") &&
    !profile.district.startsWith("onboarding-") &&
    Object.keys(profile.businessHours ?? {}).length > 0,
  );
}

function statusIcon(state: ChecklistState) {
  if (state === "complete") return "✓";
  return state === "unknown" ? "?" : "!";
}

function statusIconClass(state: ChecklistState) {
  if (state === "complete") return "bg-ios-green/10 text-ios-green";
  return state === "unknown"
    ? "bg-ios-red/10 text-ios-red"
    : "bg-ios-orange/10 text-ios-orange";
}

function navigate(to: string) {
  void router.push(to);
}

async function loadChecklist() {
  if (authStore.user?.role !== 1 || !authStore.restaurantId) return;

  dismissed.value = wasDismissed();
  if (dismissed.value) return;

  const restaurantId = authStore.restaurantId;
  const checks = await Promise.allSettled([
    api.get(`/restaurants/${restaurantId}`),
    api.get(`/menu/${restaurantId}?includeAll=true`),
    api.get("/tables", { restaurantId, limit: 1 }),
    api.get("/users", { restaurantId, limit: 100 }),
  ]);

  const profile =
    checks[0].status === "fulfilled"
      ? (unwrapApiPayload(
          (checks[0].value as { data: unknown }).data,
        ) as RestaurantProfile)
      : null;
  const menu =
    checks[1].status === "fulfilled"
      ? (unwrapApiPayload(
          (checks[1].value as { data: unknown }).data,
        ) as MenuPayload)
      : null;
  const staff =
    checks[3].status === "fulfilled"
      ? unwrapApiList<{ role: number }>(
          (checks[3].value as { data: unknown }).data,
        )
      : [];

  setupChecks.value = {
    profile:
      checks[0].status === "rejected"
        ? "unknown"
        : profileIsComplete(profile)
          ? "complete"
          : "incomplete",
    menu:
      checks[1].status === "rejected"
        ? "unknown"
        : menu?.menuItems?.some((item) => item.isAvailable === true)
          ? "complete"
          : "incomplete",
    tables: listState(checks[2]),
    guestOrders:
      checks[0].status === "rejected"
        ? "unknown"
        : profile?.isAvailable === true &&
            profile.settings?.allowGuestOrders === true
          ? "complete"
          : "incomplete",
    staff:
      checks[3].status === "rejected"
        ? "unknown"
        : staff.some((user) => user.role >= 2 && user.role <= 4)
          ? "complete"
          : "incomplete",
  };
}

onMounted(() => {
  void loadChecklist();
});
</script>
