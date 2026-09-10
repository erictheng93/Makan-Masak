/**
 * Leaves Service
 * API client for employee leave management
 */

import { api } from "@/services/api";
import type { UserId } from "@/types/api-user";
import type {
  CreateLeaveRequestRequest,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
} from "@makanmasak/shared-types";

/**
 * The one frontend copy of each leaves entity. This file used to declare its
 * own LeaveType, LeaveBalance and LeaveRequest, all three narrower than and
 * inconsistent with the rows the endpoints return; they are now the
 * shared-types mirrors, pinned against the schema by `LeavesWireConformance`
 * in the database package (#330).
 */
export type { LeaveType, LeaveBalance, LeaveRequest };

/**
 * The four fields createLeaveTypeSchema requires. Everything else it accepts
 * has a server-side default, so this is the whole minimum form.
 */
export interface CreateLeaveTypeInput {
  code: string;
  name: string;
  accrualType: "yearly" | "monthly" | "none";
  accrualAmount: number;
  description?: string;
  requiresApproval?: boolean;
}

class LeavesService {
  private api: typeof api;

  constructor() {
    this.api = api;
  }

  /**
   * Get all leave types for a restaurant
   */
  async getLeaveTypes(restaurantId: string): Promise<LeaveType[]> {
    const response = await this.api.get<LeaveType[]>(
      `/leaves/${restaurantId}/types`,
    );
    return response.data.data ?? [];
  }

  /**
   * Get leave balances with optional filters
   */
  async getBalances(params: {
    restaurantId?: string;
    employeeId?: UserId;
    year?: number;
  }): Promise<LeaveBalance[]> {
    const response = await this.api.get<LeaveBalance[]>(
      "/leaves/balances",
      params,
    );
    return response.data.data ?? [];
  }

  /**
   * Get all leave balances for a restaurant (single bulk request)
   */
  async getRestaurantBalances(
    restaurantId: string,
    year?: number,
  ): Promise<LeaveBalance[]> {
    const params = year ? { year } : {};
    const response = await this.api.get<LeaveBalance[]>(
      `/leaves/${restaurantId}/balances`,
      params,
    );
    return response.data.data ?? [];
  }

  /**
   * Get leave requests with optional filters
   */
  async getRequests(
    restaurantId: string,
    params?: {
      employeeId?: UserId;
      status?: string;
      startDate?: string;
      endDate?: string;
    },
  ): Promise<LeaveRequest[]> {
    const response = await this.api.get<LeaveRequest[]>(
      `/leaves/${restaurantId}/requests`,
      params,
    );
    return response.data.data ?? [];
  }

  /**
   * Create a new leave request
   */
  async createRequest(
    restaurantId: string,
    data: Omit<CreateLeaveRequestRequest, "restaurantId" | "employeeId">,
  ): Promise<LeaveRequest> {
    const response = await this.api.post<LeaveRequest>(
      `/leaves/${restaurantId}/requests`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Create a leave type.
   *
   * The route has existed since the feature shipped; nothing called it, so
   * every new tenant started with an empty list and the leave-request dialog's
   * type selector had nothing to offer -- which made its submit button
   * permanently disabled and the whole approval flow unreachable (#307).
   */
  async createLeaveType(
    restaurantId: string,
    data: CreateLeaveTypeInput,
  ): Promise<LeaveType> {
    const response = await this.api.post<LeaveType>(
      `/leaves/${restaurantId}/types`,
      data,
    );
    return response.data.data!;
  }

  /**
   * Update a leave type. Tenant scope is enforced inside the handler by
   * looking the id up, not by a route-level guard, so there is no restaurantId
   * in the path.
   */
  async updateLeaveType(
    typeId: number,
    data: Partial<CreateLeaveTypeInput> & { isActive?: boolean },
  ): Promise<LeaveType> {
    const response = await this.api.put<LeaveType>(
      `/leaves/types/${typeId}`,
      data,
    );
    return response.data.data!;
  }

  async deleteLeaveType(typeId: number): Promise<void> {
    await this.api.delete(`/leaves/types/${typeId}`);
  }

  /**
   * Approve a leave request.
   *
   * `approveLeaveRequestSchema` is `{ comments?: string }`, so the body is
   * genuinely optional: since #355 `validateBody` hands an absent or empty
   * body to the schema as `{}` instead of failing the JSON parse first, and
   * an all-optional schema accepts that. (Before #355 it did not, and
   * approval failed 100% of the time until this method was made to send a
   * body — see #344 for the same shape on cancel.) We keep sending
   * `{ comments }` because it is what actually carries the comment; sending
   * nothing would work too.
   *
   * The approver is bound to the session by the route handler, so no userId is
   * sent.
   */
  async approveRequest(requestId: number, comments?: string): Promise<void> {
    await this.api.post(`/leaves/requests/${requestId}/approve`, { comments });
  }

  /**
   * Reject a leave request
   */
  async rejectRequest(requestId: number, reason?: string): Promise<void> {
    await this.api.post(`/leaves/requests/${requestId}/reject`, { reason });
  }

  /**
   * Cancel a leave request.
   *
   * `reason` is required, not optional: cancelLeaveRequestSchema is
   * `{ reason: nonEmptyString.max(500) }`, so an empty body is still a 400 --
   * now a `VALIDATION_ERROR` naming `reason` rather than the misleading
   * `INVALID_JSON` it was before #355. An earlier version of this method sent
   * no body and was deleted unused in 5b88e6fe -- do not restore that shape
   * (#344).
   *
   * The canceller is bound to the session by the route handler, which also
   * enforces "your own request unless admin/owner", so no userId is sent.
   */
  async cancelRequest(requestId: number, reason: string): Promise<void> {
    await this.api.post(`/leaves/requests/${requestId}/cancel`, { reason });
  }
}

// Export singleton instance
export const leavesService = new LeavesService();
export default leavesService;
