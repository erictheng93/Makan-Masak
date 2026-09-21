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
    <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
      <div
        v-for="stat in statCards"
        :key="stat.label"
        class="bg-white rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-transform hover:scale-[1.02]"
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
      <nav class="flex border-b border-ios-bg px-6">
        <router-link
          v-for="tab in tabs"
          :key="tab.name"
          :to="tab.path"
          class="flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors -mb-px"
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
            class="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-ios-red text-white"
          >
            {{ tab.badge }}
          </span>
        </router-link>
      </nav>

      <!-- Tab Content -->
      <div class="p-6">
        <router-view
          :users-with-status="employeeList.usersWithStatus.value"
          :archived-users="employeeList.archivedUsers.value"
          :is-loading="employeeList.isLoading.value"
          :archived-loading="employeeList.archivedLoading.value"
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
      @close="closeModal"
      @save="handleSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useEmployeeList } from "@/composables/useEmployeeList";
import { useAuthStore } from "@/stores/auth";
import { leavesService } from "@/services/leavesService";
import EmployeeFormModal from "@/components/employees/EmployeeFormModal.vue";
import type { Employee, EmployeeFormData } from "@/types/employee";
import type { UserId } from "@/types/api-user";
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
  showModal.value = true;
};

const closeModal = () => {
  showModal.value = false;
  editingEmployee.value = null;
};

const handleSave = async (form: EmployeeFormData, isEdit: boolean) => {
  try {
    if (isEdit && editingEmployee.value) {
      await employeeList.updateUser(editingEmployee.value, form);
    } else {
      await employeeList.createUser(form);
    }
    closeModal();
  } catch (error: unknown) {
    // 驗證失敗時後端會在信封的 details 帶逐欄訊息，那比信封本身的
    // 「Validation failed」有用得多，所以優先顯示。
    const envelope =
      isRecord(error) &&
      isRecord(error.response) &&
      isRecord(error.response.data)
        ? error.response.data.error
        : undefined;
    const details = isRecord(envelope) ? envelope.details : undefined;
    const fieldMessages = Array.isArray(details)
      ? details
          .map((d) =>
            isRecord(d) && typeof d.message === "string" ? d.message : "",
          )
          .filter(Boolean)
      : [];

    toast.error(
      fieldMessages.length > 0
        ? fieldMessages.join("\n")
        : resolveUserFacingError(error, t, {
            fallbackKey: "users.errors.saveFailed",
          }).message,
    );
  }
};

const handleResetPassword = async (userId: UserId) => {
  try {
    await employeeList.resetPassword(userId);
    toast.success(t("users.confirm.resetPasswordSuccess"));
  } catch (error: unknown) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "users.errors.resetFailed",
      }).message,
    );
  }
};

const handleArchiveUser = async (user: Employee) => {
  try {
    await employeeList.archiveUser(user.id);
    toast.success(t("users.success.archived", { username: user.username }));
  } catch (error: unknown) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "users.errors.archiveFailed",
      }).message,
    );
  }
};

const handleRestoreUser = async (user: Employee) => {
  try {
    await employeeList.restoreUser(user.id);
    toast.success(t("users.success.restored", { username: user.username }));
  } catch (error: unknown) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "users.errors.restoreFailed",
      }).message,
    );
  }
};

const handleToggleStatus = async (user: Employee) => {
  try {
    await employeeList.toggleUserStatus(user);
  } catch (error: unknown) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "users.errors.toggleFailed",
      }).message,
    );
  }
};

onMounted(async () => {
  employeeList.fetchAll();
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
});
</script>
