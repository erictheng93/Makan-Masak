<template>
  <div class="space-y-4">
    <!-- Current staff vs departed -->
    <div class="inline-flex gap-1 p-1 bg-ios-bg rounded-full">
      <button
        v-for="option in rosterOptions"
        :key="option.value"
        class="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
        :class="
          roster === option.value
            ? 'bg-white text-ios-text shadow-sm'
            : 'text-ios-text/60 hover:text-ios-text'
        "
        @click="roster = option.value"
      >
        {{ option.label }}
      </button>
    </div>

    <!-- Search & Filters -->
    <div class="flex flex-col sm:flex-row gap-3">
      <div class="relative flex-1">
        <Search
          class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ios-text/30"
        />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('users.search.placeholder')"
          class="w-full pl-10 pr-4 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text placeholder-ios-text/30 focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
        />
      </div>
      <select
        v-model="roleFilter"
        class="px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
      >
        <option value="">{{ t("users.search.allRoles") }}</option>
        <option value="1">{{ t("users.search.ownerRole") }}</option>
        <option value="2">{{ t("users.search.chefRole") }}</option>
        <option value="3">{{ t("users.search.serviceRole") }}</option>
        <option value="4">{{ t("users.search.cashierRole") }}</option>
      </select>
      <select
        v-model="statusFilter"
        class="px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-sm text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
      >
        <option value="">{{ t("users.search.allStatuses") }}</option>
        <option value="active">{{ t("users.status.active") }}</option>
        <option value="inactive">{{ t("users.status.inactive") }}</option>
        <option value="suspended">{{ t("users.status.suspended") }}</option>
      </select>
    </div>

    <!-- Employee Table -->
    <div v-if="rosterLoading" class="flex items-center justify-center py-16">
      <div
        class="w-8 h-8 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
      />
    </div>

    <div v-else-if="filteredUsers.length === 0" class="text-center py-16">
      <Users class="mx-auto w-12 h-12 text-ios-text/20 mb-3" />
      <h3 class="text-sm font-medium text-ios-text/60">
        {{
          isArchivedRoster
            ? t("users.empty.archivedTitle")
            : t("users.empty.title")
        }}
      </h3>
      <p class="text-xs text-ios-text/40 mt-1">
        {{
          isArchivedRoster
            ? t("users.empty.archivedDescription")
            : t("users.empty.description")
        }}
      </p>
    </div>

    <div v-else class="overflow-x-auto">
      <table v-if="!compact" class="min-w-full">
        <thead>
          <tr class="border-b border-ios-bg">
            <th
              class="px-4 py-3 text-left text-xs font-medium text-ios-text/40 uppercase tracking-wider"
            >
              {{ t("users.table.info") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium text-ios-text/40 uppercase tracking-wider"
            >
              {{ t("users.table.role") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium text-ios-text/40 uppercase tracking-wider"
            >
              {{ t("users.table.status") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium text-ios-text/40 uppercase tracking-wider"
            >
              {{ t("employees.table.workStatus") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium text-ios-text/40 uppercase tracking-wider"
            >
              {{ t("users.table.lastLogin") }}
            </th>
            <th
              class="px-4 py-3 text-left text-xs font-medium text-ios-text/40 uppercase tracking-wider"
            >
              {{ t("users.table.actions") }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-ios-bg">
          <tr
            v-for="user in paginatedUsers"
            :key="user.id"
            class="hover:bg-ios-bg/50 cursor-pointer transition-colors"
            @click="navigateToDetail(user.id)"
          >
            <!-- Employee Info -->
            <td class="px-4 py-3.5">
              <div class="flex items-center gap-3">
                <div class="relative">
                  <div
                    class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold"
                    :class="avatarClass(user.role)"
                  >
                    {{ getInitials(user) }}
                  </div>
                  <!-- Clock-in dot -->
                  <span
                    v-if="user.clockInStatus?.isClockedIn"
                    class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-ios-green border-2 border-white rounded-full"
                  >
                    <span
                      class="absolute inset-0 rounded-full bg-ios-green animate-ping opacity-40"
                    />
                  </span>
                  <!-- On leave dot -->
                  <span
                    v-else-if="user.leaveStatus?.isOnLeave"
                    class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-ios-orange border-2 border-white rounded-full"
                  />
                </div>
                <div class="min-w-0">
                  <div class="text-sm font-medium text-ios-text truncate">
                    {{ user.fullName || user.username }}
                  </div>
                  <div class="text-xs text-ios-text/40 truncate">
                    {{ user.email || user.username }}
                  </div>
                </div>
              </div>
            </td>

            <!-- Role -->
            <td class="px-4 py-3.5">
              <span
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                :class="roleBadgeClass(user.role)"
              >
                <component :is="roleIcon(user.role)" class="w-3 h-3" />
                {{ roleText(user.role) }}
              </span>
            </td>

            <!-- Account Status -->
            <td class="px-4 py-3.5">
              <span
                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                :class="statusBadgeClass(user.status)"
              >
                {{ statusText(user.status) }}
              </span>
            </td>

            <!-- Work Status -->
            <td class="px-4 py-3.5">
              <span
                v-if="user.clockInStatus?.isClockedIn"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"
              >
                <Clock class="w-3 h-3" />
                {{ t("employees.clockIn.working") }}
              </span>
              <span
                v-else-if="user.leaveStatus?.isOnLeave"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700"
              >
                <CalendarOff class="w-3 h-3" />
                {{
                  user.leaveStatus.leaveType || t("employees.clockIn.onLeave")
                }}
              </span>
              <span v-else class="text-xs text-ios-text/30">
                {{ t("employees.clockIn.off") }}
              </span>
            </td>

            <!-- Last Login -->
            <td class="px-4 py-3.5 text-xs text-ios-text/50">
              {{
                user.lastLoginAt
                  ? formatDateTime(user.lastLoginAt)
                  : t("users.table.neverLoggedIn")
              }}
            </td>

            <!-- Actions -->
            <td class="px-4 py-3.5" @click.stop>
              <EmployeeRowActions
                v-bind="actionProps(user)"
                @edit="$emit('editUser', user)"
                @reset="handleResetPassword(user)"
                @toggle="handleToggleStatus(user)"
                @archive="handleArchive(user)"
                @restore="handleRestore(user)"
              />
            </td>
          </tr>
        </tbody>
      </table>

      <ul v-else class="space-y-3" data-testid="employee-cards">
        <li
          v-for="user in paginatedUsers"
          :key="user.id"
          class="rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
          data-testid="employee-card"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            @click="navigateToDetail(user.id)"
          >
            <span
              class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              :class="avatarClass(user.role)"
            >
              {{ getInitials(user) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-ios-text">
                {{ user.fullName || user.username }}
              </span>
              <span class="block truncate text-xs text-ios-text/40">
                {{ user.email || user.username }}
              </span>
            </span>
          </button>
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium"
              :class="roleBadgeClass(user.role)"
            >
              <component :is="roleIcon(user.role)" class="h-3 w-3" />
              {{ roleText(user.role) }}
            </span>
            <span
              class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
              :class="statusBadgeClass(user.status)"
            >
              {{ statusText(user.status) }}
            </span>
            <span
              v-if="user.clockInStatus?.isClockedIn"
              class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
            >
              <Clock class="h-3 w-3" />
              {{ t("employees.clockIn.working") }}
            </span>
            <span
              v-else-if="user.leaveStatus?.isOnLeave"
              class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
            >
              <CalendarOff class="h-3 w-3" />
              {{ user.leaveStatus.leaveType || t("employees.clockIn.onLeave") }}
            </span>
            <span v-else class="text-xs text-ios-text/30">
              {{ t("employees.clockIn.off") }}
            </span>
          </div>
          <div class="mt-2 flex justify-end">
            <EmployeeRowActions
              v-bind="actionProps(user)"
              compact
              @edit="$emit('editUser', user)"
              @reset="handleResetPassword(user)"
              @toggle="handleToggleStatus(user)"
              @archive="handleArchive(user)"
              @restore="handleRestore(user)"
            />
          </div>
        </li>
      </ul>

      <!-- Pagination -->
      <div
        v-if="totalPages > 1"
        class="flex items-center justify-between pt-4 border-t border-ios-bg"
      >
        <p class="text-xs text-ios-text/40">
          {{
            t("employees.pagination.showing", {
              from: (currentPage - 1) * pageSize + 1,
              to: Math.min(currentPage * pageSize, filteredUsers.length),
              total: filteredUsers.length,
            })
          }}
        </p>
        <div class="flex gap-1">
          <button
            v-for="page in totalPages"
            :key="page"
            class="w-8 h-8 rounded-lg text-xs font-medium transition-colors"
            :class="
              page === currentPage
                ? 'bg-ios-blue text-white'
                : 'text-ios-text/50 hover:bg-ios-bg'
            "
            @click="currentPage = page"
          >
            {{ page }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  useEmployeeDisplay,
  getInitials as getInitialsHelper,
  avatarClass,
  roleIcon,
  roleBadgeClass,
  statusBadgeClass,
} from "@/composables/useEmployeeDisplay";
import type { Employee, EmployeeWithStatus } from "@/types/employee";
import type { UserId } from "@/types/api-user";
import { Search, Users, Clock, CalendarOff } from "lucide-vue-next";
import EmployeeRowActions from "@/components/employees/EmployeeRowActions.vue";
import { useIsCompactViewport } from "@/composables/useIsCompactViewport";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{
  usersWithStatus?: EmployeeWithStatus[];
  archivedUsers?: EmployeeWithStatus[];
  isLoading?: boolean;
  archivedLoading?: boolean;
  /** A row write is in flight; the status and remove buttons wait. */
  busy?: boolean;
}>();

const router = useRouter();
const { t } = useI18n();
const authStore = useAuthStore();
// Only the top admin tier may touch another admin's credentials (API-enforced).
const isAdministrator = computed(
  () => authStore.user?.adminTier === "administrator",
);
const { roleText, statusText } = useEmployeeDisplay();
const { formatDateTime } = useDateFormatter();

// Local filter state that operates on the passed-in prop
const searchQuery = ref("");
const roleFilter = ref("");
const statusFilter = ref("");

type Roster = "current" | "archived";
const roster = ref<Roster>("current");
const isArchivedRoster = computed(() => roster.value === "archived");
const rosterLoading = computed(() =>
  isArchivedRoster.value ? props.archivedLoading : props.isLoading,
);
const rosterOptions = computed<Array<{ value: Roster; label: string }>>(() => [
  { value: "current", label: t("users.roster.current") },
  { value: "archived", label: t("users.roster.archived") },
]);

// The departed list is a separate request, so it is only fetched when someone
// actually opens that side -- the roster and its counts stay the default.
watch(roster, (value) => {
  if (value === "archived") emit("loadArchived");
});

const filteredUsers = computed(() => {
  const source = isArchivedRoster.value
    ? props.archivedUsers
    : props.usersWithStatus;
  if (!source) return [];
  let filtered = source;
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (u) =>
        u.username?.toLowerCase().includes(q) ||
        u.fullName?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q),
    );
  }
  if (roleFilter.value) {
    filtered = filtered.filter((u) => u.role === Number(roleFilter.value));
  }
  if (statusFilter.value) {
    filtered = filtered.filter((u) => u.status === statusFilter.value);
  }
  return filtered;
});

// Pagination
const currentPage = ref(1);
const pageSize = 15;

const totalPages = computed(() =>
  Math.ceil(filteredUsers.value.length / pageSize),
);

const paginatedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredUsers.value.slice(start, start + pageSize);
});

// Reset to page 1 when filters change
watch([searchQuery, roleFilter, statusFilter, roster], () => {
  currentPage.value = 1;
});

// Helpers
const getInitials = (user: EmployeeWithStatus) => getInitialsHelper(user);

const navigateToDetail = (id: UserId) => {
  router.push(`/dashboard/employees/${id}`);
};

const compact = useIsCompactViewport();
const actionProps = (user: Employee) => ({
  user,
  archived: isArchivedRoster.value,
  busy: props.busy,
  isAdministrator: isAdministrator.value,
});

const emit = defineEmits<{
  editUser: [user: Employee];
  refresh: [];
  resetPassword: [user: EmployeeWithStatus];
  toggleStatus: [user: EmployeeWithStatus];
  archiveUser: [user: EmployeeWithStatus];
  restoreUser: [user: EmployeeWithStatus];
  loadArchived: [];
}>();

const { confirm: confirmModal } = useConfirmModal();

const handleArchive = async (user: EmployeeWithStatus) => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("users.actions.archive"),
    message: t("users.confirm.archive", { username: user.username }),
    confirmLabel: t("users.actions.archive"),
  });
  if (!confirmed) return;
  emit("archiveUser", user);
};

const handleRestore = async (user: EmployeeWithStatus) => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("users.actions.restore"),
    message: t("users.confirm.restore", { username: user.username }),
    confirmLabel: t("users.actions.restore"),
  });
  if (!confirmed) return;
  emit("restoreUser", user);
};

// The parent's password form is the confirmation; no separate dialog.
const handleResetPassword = (user: EmployeeWithStatus) => {
  emit("resetPassword", user);
};

// Disabling bumps the account's token version: the employee is signed out of
// every device at once (kitchen display, POS) mid-shift, and re-enabling does
// not bring those sessions back. That is not a one-tap action.
const handleToggleStatus = async (user: EmployeeWithStatus) => {
  if (user.status === "active") {
    const confirmed = await confirmModal({
      type: "danger",
      title: t("users.actions.disable"),
      message: t("users.confirm.disable", { username: user.username }),
      confirmLabel: t("users.actions.disable"),
    });
    if (!confirmed) return;
  }
  emit("toggleStatus", user);
};
</script>
