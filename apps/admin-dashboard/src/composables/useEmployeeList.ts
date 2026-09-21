import { ref, computed } from "vue";
import { api } from "@/services/api";
import { schedulingService } from "@/services/schedulingService";
import { useAuthStore } from "@/stores/auth";
import type {
  Employee,
  EmployeeWithStatus,
  EmployeeStats,
  EmployeeFormData,
} from "@/types/employee";
import type { EmployeeSchedule } from "@/types/scheduling";
import { t } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import { mapApiUser, type ApiUser, type UserId } from "@/types/api-user";

// Module-level shared state — all callers share the same data
const users = ref<Employee[]>([]);
const archivedUsers = ref<Employee[]>([]);
const clockedInList = ref<EmployeeSchedule[]>([]);
const todaySchedules = ref<EmployeeSchedule[]>([]);
const todayLeaveRequests = ref<
  Array<{ employeeId: UserId; leaveTypeName: string; endDate: string }>
>([]);
const isLoading = ref(false);
const archivedLoading = ref(false);
const clockedInLoading = ref(false);
const schedulesLoading = ref(false);
const leaveLoading = ref(false);
const error = ref<string | null>(null);

interface TodayLeaveRequest {
  employeeId: UserId;
  leaveType?: { name?: string };
  leaveTypeName?: string;
  endDate: string;
}

function buildUsersUrl(
  restaurantId: string | number | null | undefined,
  archived?: "only",
) {
  const params = new URLSearchParams();
  if (restaurantId) params.set("restaurantId", String(restaurantId));
  // Omitted means current staff. The API defaults the same way, so the roster
  // and every count derived from it exclude departed employees (#337).
  if (archived) params.set("archived", archived);

  const query = params.toString();
  return query ? `/users?${query}` : "/users";
}

export function useEmployeeList() {
  const authStore = useAuthStore();

  // In-flight fetch promise for deduplication
  let fetchUsersPromise: Promise<void> | null = null;

  // Lookup maps
  const clockedInMap = computed(() => {
    const map = new Map<
      UserId,
      { isClockedIn: boolean; clockInTime?: string; scheduleId?: number }
    >();
    for (const schedule of clockedInList.value) {
      map.set(schedule.employeeId, {
        isClockedIn: true,
        clockInTime: schedule.clockInTime || undefined,
        scheduleId: schedule.id,
      });
    }
    return map;
  });

  const onLeaveMap = computed(() => {
    const map = new Map<
      UserId,
      { isOnLeave: boolean; leaveType?: string; endDate?: string }
    >();
    for (const req of todayLeaveRequests.value) {
      map.set(req.employeeId, {
        isOnLeave: true,
        leaveType: req.leaveTypeName,
        endDate: req.endDate,
      });
    }
    return map;
  });

  // Enhanced users with status
  const usersWithStatus = computed<EmployeeWithStatus[]>(() => {
    return users.value.map((u) => ({
      ...u,
      clockInStatus: clockedInMap.value.get(u.id) || { isClockedIn: false },
      leaveStatus: onLeaveMap.value.get(u.id) || { isOnLeave: false },
    }));
  });

  // Stats
  const stats = computed<EmployeeStats>(() => ({
    owner: users.value.filter((u) => u.role === 1).length,
    chef: users.value.filter((u) => u.role === 2).length,
    service: users.value.filter((u) => u.role === 3).length,
    cashier: users.value.filter((u) => u.role === 4).length,
    total: users.value.length,
    currentlyWorking: clockedInList.value.length,
    onLeaveToday: todayLeaveRequests.value.length,
  }));

  // Fetch methods (with deduplication — concurrent callers share the same in-flight request)
  const fetchUsers = () => {
    if (fetchUsersPromise) return fetchUsersPromise;
    fetchUsersPromise = (async () => {
      isLoading.value = true;
      error.value = null;
      try {
        const response = await api.get(buildUsersUrl(authStore.restaurantId));
        const payload = response.data?.success
          ? response.data.data
          : response.data;
        users.value = (Array.isArray(payload) ? payload : []).map((user) =>
          mapApiUser(user as ApiUser),
        );
      } catch (e: unknown) {
        error.value = resolveUserFacingError(e, t, {
          fallbackKey: "errors.loadUsersFailed",
        }).message;
        console.error("Failed to fetch users:", e);
      } finally {
        isLoading.value = false;
        fetchUsersPromise = null;
      }
    })();
    return fetchUsersPromise;
  };

  const fetchClockedIn = async () => {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    clockedInLoading.value = true;
    try {
      clockedInList.value =
        await schedulingService.getClockedInEmployees(restaurantId);
    } catch (e) {
      console.error("Failed to fetch clocked-in employees:", e);
    } finally {
      clockedInLoading.value = false;
    }
  };

  /**
   * Today's roster — who was *supposed* to work, which is the only honest
   * denominator for an attendance rate. Headcount is not: a five-person shop
   * that rosters two people can never exceed 40%.
   *
   * The date is the local one, matching ClockInOutPanel, because that is what
   * decides which schedule row a person can clock into. `toISOString()` would
   * name the previous day between local midnight and 08:00 in GMT+8.
   */
  const fetchTodaySchedules = async () => {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    schedulesLoading.value = true;
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const collected: EmployeeSchedule[] = [];
      // One restaurant-day fits in a page or two. The loop exists so a large
      // roster is counted rather than silently truncated at the API's 100-row
      // ceiling — an undercounted denominator would inflate the rate.
      for (let page = 1; page <= 10; page += 1) {
        const response = await schedulingService.getSchedules({
          restaurantId,
          startDate: today,
          endDate: today,
          page,
          limit: 100,
        });
        collected.push(...response.data);
        if (
          response.data.length === 0 ||
          collected.length >= response.pagination.total
        ) {
          break;
        }
      }
      todaySchedules.value = collected;
    } catch (e) {
      console.error("Failed to fetch today schedules:", e);
    } finally {
      schedulesLoading.value = false;
    }
  };

  const fetchTodayLeaves = async () => {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    leaveLoading.value = true;
    try {
      const today = new Date().toISOString().split("T")[0];
      const response = await api.get(`/leaves/${restaurantId}/requests`, {
        status: "approved",
        startDate: today,
        endDate: today,
      });
      const data = response.data?.data || response.data || [];
      const requests: TodayLeaveRequest[] = Array.isArray(data)
        ? (data as TodayLeaveRequest[])
        : [];
      todayLeaveRequests.value = requests.map((request) => ({
        employeeId: request.employeeId,
        leaveTypeName:
          request.leaveType?.name ?? request.leaveTypeName ?? "Leave",
        endDate: request.endDate,
      }));
    } catch (e) {
      console.error("Failed to fetch today leaves:", e);
    } finally {
      leaveLoading.value = false;
    }
  };

  const fetchAll = async () => {
    await fetchUsers();
    // Fire-and-forget for secondary data
    fetchClockedIn();
    fetchTodayLeaves();
    fetchTodaySchedules();
  };

  // CRUD
  const createUser = async (form: EmployeeFormData) => {
    if (form.role === null) {
      throw new Error("A role must be selected before creating an employee");
    }
    await api.post("/users", {
      username: form.username,
      password: form.password,
      fullName: form.fullName,
      email: form.email,
      role: form.role,
    });
    await fetchUsers();
    // Initialize leave balances for new employee (non-blocking)
    try {
      const year = new Date().getFullYear();
      await api.post(`/leaves/${authStore.restaurantId}/balances/accrue`, {
        year,
      });
    } catch {
      /* non-blocking */
    }
  };

  const updateUser = async (employee: Employee, form: EmployeeFormData) => {
    if (form.role === null) {
      throw new Error("A role must be selected before updating an employee");
    }

    await api.put(`/users/${employee.id}`, {
      fullName: form.fullName,
      email: form.email,
    });

    if (form.role !== employee.role) {
      await api.patch(`/users/${employee.id}/role`, { role: form.role });
    }

    const isActive = form.status === "active";
    if (isActive !== employee.isActive) {
      await api.patch(`/users/${employee.id}/status`, { isActive });
    }

    await fetchUsers();
  };

  const toggleUserStatus = async (user: Employee) => {
    const newIsActive = user.status !== "active";
    await api.patch(`/users/${user.id}/status`, { isActive: newIsActive });
    await fetchUsers();
  };

  const fetchArchivedUsers = async () => {
    archivedLoading.value = true;
    try {
      const response = await api.get(
        buildUsersUrl(authStore.restaurantId, "only"),
      );
      const payload = response.data?.success
        ? response.data.data
        : response.data;
      archivedUsers.value = (Array.isArray(payload) ? payload : []).map(
        (user) => mapApiUser(user as ApiUser),
      );
    } catch (e: unknown) {
      error.value = resolveUserFacingError(e, t, {
        fallbackKey: "errors.loadUsersFailed",
      }).message;
      console.error("Failed to fetch archived users:", e);
    } finally {
      archivedLoading.value = false;
    }
  };

  /** Remove a departed employee from the roster; the row survives for history. */
  const archiveUser = async (userId: UserId) => {
    await api.delete(`/users/${userId}`);
    await Promise.all([fetchUsers(), fetchArchivedUsers()]);
  };

  /** Rehire: put an archived employee back on the active roster. */
  const restoreUser = async (userId: UserId) => {
    await api.post(`/users/${userId}/restore`);
    await Promise.all([fetchUsers(), fetchArchivedUsers()]);
  };

  const resetPassword = async (userId: UserId) => {
    const tempPassword = `Reset${Date.now().toString(36)}!`;
    await api.post(`/users/${userId}/reset-password`, {
      newPassword: tempPassword,
      confirmPassword: tempPassword,
    });
  };

  return {
    // State
    users,
    archivedUsers,
    archivedLoading,
    usersWithStatus,
    stats,
    clockedInList,
    todaySchedules,
    isLoading,
    clockedInLoading,
    schedulesLoading,
    leaveLoading,
    error,

    // Methods
    fetchAll,
    fetchUsers,
    fetchClockedIn,
    fetchTodayLeaves,
    fetchTodaySchedules,
    createUser,
    updateUser,
    toggleUserStatus,
    fetchArchivedUsers,
    archiveUser,
    restoreUser,
    resetPassword,
  };
}
