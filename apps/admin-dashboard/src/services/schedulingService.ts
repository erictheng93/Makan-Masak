/**
 * Employee Scheduling Service
 * API client for employee scheduling and shift management
 */

import type { UserId } from "@/types/api-user";
import { api } from "@/services/api";
import type {
  ShiftTemplate,
  CreateShiftTemplateData,
  EmployeeSchedule,
  CreateScheduleData,
  UpdateScheduleData,
  BulkCreateSchedulesData,
  AvailableEmployee,
  SchedulingConflict,
  SwapRequest,
  CreateSwapRequestData,
  ClockInData,
  ClockOutData,
  ScheduleFilters,
  ConflictFilters,
  SwapRequestFilters,
  PaginatedResponse,
  ApiResponse,
  DailyStats,
  WeeklySummary,
} from "@/types/scheduling";

/**
 * Reshape a list response into the paginated envelope every caller expects.
 *
 * The three list methods below used to do `return response.data.data!`, typed
 * as `Promise<PaginatedResponse<T>>`. That typechecked only because the generic
 * was `api.get<PaginatedResponse<T>>`, which claims the server nests a
 * paginated envelope inside `data`. It does not: `data` is the bare array and
 * `pagination` is its sibling. So every caller's `response.data` was
 * `undefined`, and `.length` / `.filter` / `for..of` on it threw at runtime —
 * silently, inside a try/catch that turned the whole panel into an error card.
 *
 * That is why the attendance clock-in panel still did not work after #308 wired
 * it up: the component was reachable and its data layer was not.
 */
function toPaginated<T>(body: {
  // Structural rather than `ApiResponse<T[]>`: two different ApiResponse types
  // are in scope here (types/index carries `pagination`, types/scheduling does
  // not), and naming either one makes the other fail to assign.
  success: boolean;
  data?: T[];
  pagination?: PaginatedResponse<T>["pagination"];
}): PaginatedResponse<T> {
  const data = body.data ?? [];
  return {
    success: body.success,
    data,
    pagination: body.pagination ?? {
      page: 1,
      limit: data.length,
      total: data.length,
      totalPages: 1,
    },
  };
}

class SchedulingService {
  private api: typeof api;

  constructor() {
    this.api = api;
  }

  // ========================================
  // Shift Template Management
  // ========================================

  /**
   * Get all shift templates for a restaurant
   */
  async getShiftTemplates(restaurantId: string): Promise<ShiftTemplate[]> {
    const response = await this.api.get<ShiftTemplate[]>(
      `/scheduling/${restaurantId}/templates`,
    );
    return response.data.data!;
  }

  /**
   * Get a specific shift template
   */
  async getShiftTemplate(id: number): Promise<ShiftTemplate> {
    const response = await this.api.get<ShiftTemplate>(
      `/scheduling/templates/${id}`,
    );
    return response.data.data!;
  }

  /**
   * Create a new shift template
   */
  async createShiftTemplate(
    restaurantId: string,
    data: CreateShiftTemplateData,
  ): Promise<ShiftTemplate> {
    const response = await this.api.post<ShiftTemplate>(
      `/scheduling/${restaurantId}/templates`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Update a shift template
   */
  async updateShiftTemplate(
    id: number,
    data: Partial<CreateShiftTemplateData>,
  ): Promise<ShiftTemplate> {
    const response = await this.api.put<ShiftTemplate>(
      `/scheduling/templates/${id}`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Delete a shift template
   */
  async deleteShiftTemplate(id: number): Promise<void> {
    await this.api.delete(`/scheduling/templates/${id}`);
  }

  // ========================================
  // Employee Schedule Management
  // ========================================

  /**
   * Get employee schedules with filters
   */
  async getSchedules(
    filters: ScheduleFilters,
  ): Promise<PaginatedResponse<EmployeeSchedule>> {
    const { restaurantId, ...params } = filters;
    const response = await this.api.get<EmployeeSchedule[]>(
      `/scheduling/${restaurantId}/schedules`,
      params,
    );
    return toPaginated(response.data);
  }

  /**
   * Get a specific schedule
   */
  async getSchedule(id: number): Promise<EmployeeSchedule> {
    const response = await this.api.get<EmployeeSchedule>(
      `/scheduling/schedules/${id}`,
    );
    return response.data.data!;
  }

  /**
   * Create a new schedule
   */
  async createSchedule(
    restaurantId: string,
    data: CreateScheduleData,
  ): Promise<EmployeeSchedule> {
    const response = await this.api.post<EmployeeSchedule>(
      `/scheduling/${restaurantId}/schedules`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Update a schedule
   */
  async updateSchedule(
    id: number,
    data: UpdateScheduleData,
  ): Promise<EmployeeSchedule> {
    const response = await this.api.put<EmployeeSchedule>(
      `/scheduling/schedules/${id}`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Delete (cancel) a schedule
   */
  async deleteSchedule(id: number): Promise<void> {
    await this.api.delete(`/scheduling/schedules/${id}`);
  }

  /**
   * Bulk create schedules
   */
  async bulkCreateSchedules(
    restaurantId: string,
    data: BulkCreateSchedulesData,
  ): Promise<{ count: number }> {
    const response = await this.api.post<{ count: number }>(
      `/scheduling/${restaurantId}/schedules/bulk`,
      data,
    );
    return response.data.data!;
  }

  // ========================================
  // Available Employees (Leave Integration)
  // ========================================

  /**
   * Get available employees for scheduling on a specific date
   * Filters out employees on approved leave
   */
  async getAvailableEmployees(
    restaurantId: string,
    date: string,
    shiftTemplateId?: number,
  ): Promise<AvailableEmployee[]> {
    const params: { date: string; shiftTemplateId?: number } = { date };
    if (shiftTemplateId) {
      params.shiftTemplateId = shiftTemplateId;
    }

    const response = await this.api.get<AvailableEmployee[]>(
      `/scheduling/${restaurantId}/available-employees`,
      params,
    );
    return response.data.data!;
  }

  // ========================================
  // Currently Clocked-In Employees
  // ========================================

  /**
   * Get currently clocked-in employees
   */
  async getClockedInEmployees(
    restaurantId: string,
  ): Promise<EmployeeSchedule[]> {
    const response = await this.api.get<EmployeeSchedule[]>(
      `/scheduling/${restaurantId}/clocked-in`,
    );
    return response.data.data!;
  }

  /**
   * Get attendance report
   */
  async getAttendanceReport(
    restaurantId: string,
    startDate: string,
    endDate: string,
    employeeId?: UserId,
  ): Promise<ApiResponse<unknown>> {
    const params: {
      startDate: string;
      endDate: string;
      employeeId?: UserId;
    } = { startDate, endDate };
    if (employeeId) {
      params.employeeId = employeeId;
    }
    const response = await this.api.get<unknown>(
      `/scheduling/${restaurantId}/attendance-report`,
      params,
    );
    return response.data as ApiResponse<unknown>;
  }

  /**
   * Admin clock-in for employee
   */
  async adminClockIn(id: number, notes?: string): Promise<EmployeeSchedule> {
    const response = await this.api.post<EmployeeSchedule>(
      `/scheduling/schedules/${id}/admin-clock-in`,
      { notes },
    );
    return response.data.data!;
  }

  /**
   * Admin clock-out for employee
   */
  async adminClockOut(id: number, notes?: string): Promise<EmployeeSchedule> {
    const response = await this.api.post<EmployeeSchedule>(
      `/scheduling/schedules/${id}/admin-clock-out`,
      { notes },
    );
    return response.data.data!;
  }

  // ========================================
  // Clock In/Out
  // ========================================

  /**
   * Clock in to a shift
   */
  async clockIn(id: number, data: ClockInData): Promise<EmployeeSchedule> {
    const response = await this.api.post<EmployeeSchedule>(
      `/scheduling/schedules/${id}/clock-in`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Clock out from a shift
   */
  async clockOut(id: number, data: ClockOutData): Promise<EmployeeSchedule> {
    const response = await this.api.post<EmployeeSchedule>(
      `/scheduling/schedules/${id}/clock-out`,
      data,
    );
    return response.data.data!;
  }

  // ========================================
  // Conflict Management
  // ========================================

  /**
   * Get scheduling conflicts
   */
  async getConflicts(
    filters: ConflictFilters,
  ): Promise<PaginatedResponse<SchedulingConflict>> {
    const { restaurantId, ...params } = filters;
    const response = await this.api.get<SchedulingConflict[]>(
      `/scheduling/${restaurantId}/conflicts`,
      params,
    );
    return toPaginated(response.data);
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    id: number,
    userId: UserId,
    resolutionNotes: string,
  ): Promise<SchedulingConflict> {
    const response = await this.api.post<SchedulingConflict>(
      `/scheduling/conflicts/${id}/resolve`,
      { userId, resolutionNotes },
    );
    return response.data.data!;
  }

  // ========================================
  // Swap Request Management
  // ========================================

  /**
   * Get swap requests
   */
  async getSwapRequests(
    filters: SwapRequestFilters,
  ): Promise<PaginatedResponse<SwapRequest>> {
    const { restaurantId, ...params } = filters;
    const response = await this.api.get<SwapRequest[]>(
      `/scheduling/${restaurantId}/swap-requests`,
      params,
    );
    return toPaginated(response.data);
  }

  /**
   * Create a swap request
   */
  async createSwapRequest(
    restaurantId: string,
    data: CreateSwapRequestData,
  ): Promise<SwapRequest> {
    const response = await this.api.post<SwapRequest>(
      `/scheduling/${restaurantId}/swap-requests`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Approve a swap request
   */
  async approveSwapRequest(
    id: number,
    managerId: UserId,
  ): Promise<SwapRequest> {
    const response = await this.api.post<SwapRequest>(
      `/scheduling/swap-requests/${id}/approve`,
      { managerId },
    );
    return response.data.data!;
  }

  /**
   * Accept a swap request (employee)
   */
  async acceptSwapRequest(
    id: number,
    employeeId: UserId,
  ): Promise<SwapRequest> {
    const response = await this.api.post<SwapRequest>(
      `/scheduling/swap-requests/${id}/accept`,
      { employeeId },
    );
    return response.data.data!;
  }

  /**
   * Reject a swap request (manager)
   */
  async rejectSwapRequest(
    id: number,
    managerId: UserId,
    reason: string,
  ): Promise<SwapRequest> {
    const response = await this.api.post<SwapRequest>(
      `/scheduling/swap-requests/${id}/reject`,
      { managerId, reason },
    );
    return response.data.data!;
  }

  /**
   * Cancel a swap request (requester)
   */
  async cancelSwapRequest(id: number): Promise<SwapRequest> {
    const response = await this.api.post<SwapRequest>(
      `/scheduling/swap-requests/${id}/cancel`,
    );
    return response.data.data!;
  }

  // ========================================
  // Statistics & Analytics
  // ========================================

  /**
   * Get daily scheduling statistics
   */
  async getDailyStats(restaurantId: string, date: string): Promise<DailyStats> {
    const response = await this.api.get<DailyStats>(
      `/scheduling/${restaurantId}/stats/daily`,
      { date },
    );
    return response.data.data!;
  }

  /**
   * Get weekly summary
   */
  async getWeeklySummary(
    restaurantId: string,
    weekStartDate: string,
  ): Promise<WeeklySummary> {
    const response = await this.api.get<WeeklySummary>(
      `/scheduling/${restaurantId}/stats/weekly`,
      { weekStartDate },
    );
    return response.data.data!;
  }
}

// Export singleton instance
export const schedulingService = new SchedulingService();
export default schedulingService;
