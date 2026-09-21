import type { UserId } from "./api-user";
import type { EmployeeSchedule } from "./scheduling";

export interface Employee {
  id: UserId;
  username: string;
  fullName: string;
  email: string;
  phone?: string;
  role: number;
  status: "active" | "inactive" | "suspended";
  isActive: boolean;
  /** Departed staff: off the roster, still named on past records (#337). */
  isArchived?: boolean;
  archivedAt?: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  profileImageUrl?: string;
}

export interface EmployeeWithStatus extends Employee {
  clockInStatus?: {
    isClockedIn: boolean;
    clockInTime?: string;
    scheduleId?: number;
  };
  leaveStatus?: {
    isOnLeave: boolean;
    leaveType?: string;
    endDate?: string;
  };
}

export interface EmployeeFormData {
  username: string;
  password: string;
  fullName: string;
  email: string;
  /** Null is the unselected creation-state; it must never reach the API. */
  role: number | null;
  /** The API has no suspended state; employee status is active or inactive. */
  status: "active" | "inactive";
}

export interface LeaveBalance {
  id: number;
  employeeId: UserId;
  leaveTypeId: number;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  remainingDays: number;
  carryoverDays: number;
  leaveType?: {
    id: number;
    name: string;
    code: string;
    color?: string;
    isPaid?: boolean;
  };
}

export interface LeaveRequest {
  id: number;
  employeeId: UserId;
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  startPeriod: string;
  endPeriod: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "withdrawn";
  approvalChain?: string;
  createdAt: string;
  leaveType?: {
    name: string;
    code: string;
    color?: string;
  };
}

export interface AttendanceRecord {
  employeeId: UserId;
  employeeName: string;
  workDate: string;
  startTime: string;
  endTime: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  scheduledHours: number;
  actualHours: number;
  overtimeHours: number;
  status: string;
}

export interface EmployeeStats {
  owner: number;
  chef: number;
  service: number;
  cashier: number;
  total: number;
  currentlyWorking: number;
  onLeaveToday: number;
}

export interface ClockedInEmployee extends EmployeeSchedule {
  employeeName?: string;
}
