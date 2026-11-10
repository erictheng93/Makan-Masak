<template>
  <div class="min-h-screen bg-ios-bg p-6 space-y-6">
    <!-- Header -->
    <div class="flex justify-between items-center">
      <div>
        <h1 class="text-2xl font-bold text-ios-text">
          {{ t("employees.title") }}
        </h1>
        <p class="text-sm text-ios-text/50 mt-1">
          {{ t("employees.subtitle") }}
        </p>
      </div>
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        @click="showModal = true"
      >
        <Plus class="w-4 h-4 mr-1.5" />
        {{ t("users.addEmployee") }}
      </button>
    </div>

    <!-- Stats Grid -->
    <div
      class="-mx-6 flex snap-x gap-3 overflow-x-auto px-6 pb-1 lg:mx-0 lg:grid lg:grid-cols-7 lg:gap-4 lg:overflow-visible lg:px-0"
      data-testid="employee-stats"
    >
      <div
        v-for="stat in statCards"
        :key="stat.label"
        class="w-36 shrink-0 snap-start bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-transform hover:scale-[1.02] lg:w-auto"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center"
            :class="stat.bgClass"
          >
            <component
              :is="stat.icon"
              class="w-5 h-5"
              :class="stat.iconClass"
            />
          </div>
          <div class="min-w-0">
            <p class="text-xs text-ios-text/50 truncate">{{ stat.label }}</p>
            <p class="text-xl font-bold" :class="stat.valueClass">
              {{ stat.value }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      <nav
        class="flex overflow-x-auto border-b border-ios-bg px-3 sm:px-6"
        data-testid="employee-tabs"
      >
        <router-link
          v-for="tab in tabs"
          :key="tab.name"
          :to="tab.path"
          class="flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4 py-3.5 text-sm font-medium border-b-2 transition-colors -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ios-blue"
          :class="
            isActiveTab(tab.path)
              ? 'border-ios-blue text-ios-blue'
              : 'border-transparent text-ios-text/40 hover:text-ios-text/70'
          "
          :data-active="isActiveTab(tab.path)"
        >
          <component :is="tab.icon" class="w-4 h-4" />
          {{ tab.label }}
          <span
            v-if="tab.badge !== undefined && tab.badge > 0"
            :data-testid="`tab-badge-${tab.name}`"
            class="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-ios-red text-white"
          >
            {{ tab.badge }}
          </span>
        </router-link>
      </nav>

      <!-- Tab Content -->
      <div class="p-4 sm:p-6">
        <router-view
          :users-with-status="employeeList.usersWithStatus.value"
          :archived-users="employeeList.archivedUsers.value"
          :is-loading="employeeList.isLoading.value"
          :archived-loading="employeeList.archivedLoading.value"
          :busy="rowBusy"
          @edit-user="editUser"
          @refresh="employeeList.fetchAll"
          @reset-password="handleResetPassword"
          @toggle-status="handleToggleStatus"
          @load-archived="employeeList.fetchArchivedUsers"
          @archive-user="handleArchiveUser"
          @restore-user="handleRestoreUser"
        />
      </div>
    </div>

    <!-- Employee Form Modal -->
    <EmployeeFormModal
      :is-open="showModal"
      :employee="editingEmployee"
      :saving="saving"
      :field-errors="fieldErrors"
      @close="closeModal"
      @save="handleSave"
    />

    <ResetPasswordModal
      :user="resetTarget"
      @close="resetTarget = null"
      @done="resetTarget = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useEmployeeList } from "@/composables/useEmployeeList";
import { useAsyncAction } from "@/composables/useAsyncAction";
import { useUndoToast } from "@/composables/useUndoToast";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/services/api";
import {
  leavesService,
  LEAVE_REQUESTS_CHANGED,
} from "@/services/leavesService";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import EmployeeFormModal from "@/components/employees/EmployeeFormModal.vue";
import ResetPasswordModal from "@/components/employees/ResetPasswordModal.vue";
import type { Employee, EmployeeFormData } from "@/types/employee";
import { isRecord } from "@makanmasak/shared/utils/unknown";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  Users,
  Plus,
  Clock,
  CalendarOff,
  Crown,
  ChefHat,
  Truck,
  CreditCard,
  ClipboardCheck,
  Calendar,
  CalendarCheck,
} from "lucide-vue-next";

const route = useRoute();
const { t } = useI18n();
const toast = useToast();
const undoToast = useUndoToast();
const employeeList = useEmployeeList();
const authStore = useAuthStore();

const showModal = ref(false);
const editingEmployee = ref<Employee | null>(null);
const pendingLeaveCount = ref(0);

// Stats cards
const statCards = computed(() => [
  {
    label: t("users.stats.owner"),
    value: employeeList.stats.value.owner,
    icon: Crown,
    bgClass: "bg-teal-50",
    iconClass: "text-teal-600",
    valueClass: "text-teal-600",
  },
  {
    label: t("users.stats.chef"),
    value: employeeList.stats.value.chef,
    icon: ChefHat,
    bgClass: "bg-orange-50",
    iconClass: "text-orange-600",
    valueClass: "text-orange-600",
  },
  {
    label: t("users.stats.service"),
    value: employeeList.stats.value.service,
    icon: Truck,
    bgClass: "bg-green-50",
    iconClass: "text-green-600",
    valueClass: "text-green-600",
  },
  {
    label: t("users.stats.cashier"),
    value: employeeList.stats.value.cashier,
    icon: CreditCard,
    bgClass: "bg-blue-50",
    iconClass: "text-blue-600",
    valueClass: "text-blue-600",
  },
  {
    label: t("users.stats.total"),
    value: employeeList.stats.value.total,
    icon: Users,
    bgClass: "bg-gray-100",
    iconClass: "text-ios-text/60",
    valueClass: "text-ios-text",
  },
  {
    label: t("employees.stats.currentlyWorking"),
    value: employeeList.stats.value.currentlyWorking,
    icon: Clock,
    bgClass: "bg-emerald-50",
    iconClass: "text-emerald-600",
    valueClass: "text-emerald-600",
  },
  {
    label: t("employees.stats.onLeaveToday"),
    value: employeeList.stats.value.onLeaveToday,
    icon: CalendarOff,
    bgClass: "bg-amber-50",
    iconClass: "text-amber-600",
    valueClass: "text-amber-600",
  },
]);

// Tabs
const tabs = computed(() => [
  {
    name: "list",
    path: "/dashboard/employees",
    label: t("employees.tabs.list"),
    icon: Users,
    badge: undefined,
  },
  {
    name: "scheduling",
    path: "/dashboard/employees/scheduling",
    label: t("employees.tabs.scheduling"),
    icon: Calendar,
    badge: undefined,
  },
  {
    name: "leaves",
    path: "/dashboard/employees/leaves",
    label: t("employees.tabs.leaves"),
    icon: CalendarCheck,
    badge: pendingLeaveCount.value,
  },
  {
    name: "attendance",
    path: "/dashboard/employees/attendance",
    label: t("employees.tabs.attendance"),
    icon: ClipboardCheck,
    badge: undefined,
  },
]);

const isActiveTab = (path: string) => {
  // Exact match for list tab (don't match attendance or :id routes)
  if (path === "/dashboard/employees") {
    return route.path === "/dashboard/employees";
  }
  return route.path === path || route.path.startsWith(path + "/");
};

// Modal handlers
const editUser = (user: Employee) => {
  editingEmployee.value = user;
  fieldErrors.value = {};
  showModal.value = true;
};

const closeModal = () => {
  fieldErrors.value = {};
  showModal.value = false;
  editingEmployee.value = null;
};

const saving = ref(false);
const fieldErrors = ref<Record<string, string>>({});
const FORM_FIELDS = ["username", "password", "fullName", "email"];

// Staff cannot sign in from a shop-less page (usernames are per shop), so tell
// the owner which link to hand the new employee. Best effort: never blocks.
const announceSignInLink = async () => {
  let slug = authStore.user?.loginSlug ?? null;
  if (!slug && authStore.restaurantId) {
    try {
      const res = await api.get<{ loginSlug?: string | null }>(
        `/restaurants/${authStore.restaurantId}`,
      );
      slug = res.data?.data?.loginSlug ?? null;
    } catch {
      /* the plain success path below still runs */
    }
  }
  toast.success(
    slug
      ? t("users.success.createdSignIn", {
          url: `${window.location.origin}/s/${slug}`,
        })
      : t("users.success.created"),
  );
};

const handleSave = async (form: EmployeeFormData, isEdit: boolean) => {
  if (saving.value) return;
  saving.value = true;
  fieldErrors.value = {};
  try {
    if (isEdit && editingEmployee.value) {
      await employeeList.updateUser(editingEmployee.value, form);
    } else {
      await employeeList.createUser(form);
      void announceSignInLink();
    }
    closeModal();
  } catch (error: unknown) {
    // 後端驗證失敗會在信封的 details 帶逐欄訊息：對得上表單欄位的顯示在欄位下，
    // 其餘（或沒有 details）才用 toast。
    const envelope =
      isRecord(error) &&
      isRecord(error.response) &&
      isRecord(error.response.data)
        ? error.response.data.error
        : undefined;
    const details = isRecord(envelope) ? envelope.details : undefined;
    const unmapped: string[] = [];
    const mapped: Record<string, string> = {};
    for (const d of Array.isArray(details) ? details : []) {
      if (!isRecord(d) || typeof d.message !== "string") continue;
      if (typeof d.field === "string" && FORM_FIELDS.includes(d.field)) {
        mapped[d.field] ??= d.message;
      } else {
        unmapped.push(d.message);
      }
    }
    fieldErrors.value = mapped;

    if (Object.keys(mapped).length === 0 || unmapped.length > 0) {
      toast.error(
        unmapped.length > 0
          ? unmapped.join("\n")
          : resolveUserFacingError(error, t, {
              fallbackKey: "users.errors.saveFailed",
            }).message,
      );
    }
  } finally {
    saving.value = false;
  }
};

const resetTarget = ref<Employee | null>(null);
const handleResetPassword = (user: Employee) => {
  resetTarget.value = user;
};

const archiveAction = useAsyncAction(
  (user: Employee) => employeeList.archiveUser(user.id),
  { fallbackError: t("users.errors.archiveFailed") },
);
const restoreAction = useAsyncAction(
  (user: Employee) => employeeList.restoreUser(user.id),
  { fallbackError: t("users.errors.restoreFailed") },
);
const statusAction = useAsyncAction(
  (userId: Employee["id"], isActive: boolean) =>
    employeeList.setUserActive(userId, isActive),
  { fallbackError: t("users.errors.toggleFailed") },
);

// Row buttons that write stay disabled while any of them is in flight.
const rowBusy = computed(
  () =>
    archiveAction.pending.value ||
    restoreAction.pending.value ||
    statusAction.pending.value,
);

const handleArchiveUser = async (user: Employee) => {
  if ((await archiveAction.run(user)) !== undefined) {
    toast.success(t("users.success.archived", { username: user.username }));
  }
};

const handleRestoreUser = async (user: Employee) => {
  if ((await restoreAction.run(user)) !== undefined) {
    toast.success(t("users.success.restored", { username: user.username }));
  }
};

// Reversible, so no confirmation: apply now, offer Undo.
const handleToggleStatus = async (user: Employee) => {
  const next = user.status !== "active";
  if ((await statusAction.run(user.id, next)) === undefined) return;
  undoToast(
    t(next ? "users.success.enabled" : "users.success.disabled", {
      username: user.username,
    }),
    () => void statusAction.run(user.id, !next),
  );
};

async function loadPendingLeaveCount() {
  try {
    const restaurantId = authStore.restaurantId;
    if (restaurantId) {
      const pending = await leavesService.getRequests(String(restaurantId), {
        status: "pending",
      });
      pendingLeaveCount.value = Array.isArray(pending) ? pending.length : 0;
    }
  } catch {
    // silently ignore errors fetching leave count
  }
}

// Employees file requests from their own screen while this page is open, and
// the leaves tab below approves them, so the badge cannot be counted once.
const pendingLeavePoller = createVisibilityAwarePoller({
  intervalMs: 60_000,
  onTick: loadPendingLeaveCount,
});

onMounted(() => {
  employeeList.fetchAll();
  void loadPendingLeaveCount();
  pendingLeavePoller.start();
  window.addEventListener(LEAVE_REQUESTS_CHANGED, loadPendingLeaveCount);
});
onBeforeUnmount(() => {
  pendingLeavePoller.stop();
  window.removeEventListener(LEAVE_REQUESTS_CHANGED, loadPendingLeaveCount);
});
</script>
