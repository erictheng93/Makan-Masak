/**
 * Reservation Service
 * API service for reservation management
 */

import { api } from "@/services/api";
import {
  ReservationStatus,
  type Reservation,
  type CreateReservationRequest,
  type UpdateReservationRequest,
  type ReservationFilters,
  type ReservationResponse,
  type AvailabilityRequest,
  type AvailabilityResponse,
  type CreateSlotRequest,
  type BatchCreateSlotsRequest,
  type ReservationStats,
  type ReservationSlot,
} from "@makanmasak/shared-types";

export class ReservationService {
  /**
   * 取得訂位列表
   */
  static async listReservations(filters: ReservationFilters = {}) {
    const params = new URLSearchParams();

    if (filters.restaurantId)
      params.append("restaurantId", filters.restaurantId);
    if (filters.status) {
      const statusValue = Array.isArray(filters.status)
        ? filters.status.map((s) => String(s)).join(",")
        : String(filters.status);
      params.append("status", statusValue);
    }
    if (filters.reservationDate) params.append("date", filters.reservationDate);
    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.customerPhone) params.append("phone", filters.customerPhone);
    if (filters.confirmationCode)
      params.append("code", filters.confirmationCode);
    if (filters.page) params.append("page", filters.page.toString());
    if (filters.limit) params.append("limit", filters.limit.toString());
    if (filters.sortBy) params.append("sortBy", filters.sortBy);
    if (filters.sortOrder) params.append("sortOrder", filters.sortOrder);

    const response = await api.get<ReservationResponse>(
      `/reservations?${params.toString()}`,
    );
    return response.data;
  }

  /**
   * 取得單一訂位詳情
   */
  static async getReservation(id: string) {
    const response = await api.get<Reservation>(`/reservations/${id}`);
    return response.data.data;
  }

  /**
   * 建立新訂位
   */
  static async createReservation(data: CreateReservationRequest) {
    const response = await api.post<Reservation>(`/reservations/staff`, data, {
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    return response.data;
  }

  /**
   * 更新訂位
   */
  static async updateReservation(id: string, data: UpdateReservationRequest) {
    const response = await api.put<Reservation>(`/reservations/${id}`, data);
    return response.data;
  }

  /**
   * 確認訂位
   */
  static async confirmReservation(id: string) {
    const response = await api.post<Reservation>(`/reservations/${id}/confirm`);
    return response.data;
  }

  /**
   * 標記到店
   */
  static async markArrived(id: string) {
    const response = await api.post<Reservation>(`/reservations/${id}/arrive`);
    return response.data;
  }

  /**
   * 標記入座
   */
  static async markSeated(id: string) {
    const response = await api.post<Reservation>(`/reservations/${id}/seat`);
    return response.data;
  }

  /**
   * 完成訂位
   */
  static async completeReservation(id: string) {
    const response = await api.post<Reservation>(
      `/reservations/${id}/complete`,
    );
    return response.data;
  }

  /**
   * 標記未到店
   */
  static async markNoShow(id: string) {
    const response = await api.post<Reservation>(`/reservations/${id}/no-show`);
    return response.data;
  }

  /**
   * 取消訂位（管理員）
   */
  static async cancelReservation(id: string, reason?: string) {
    const response = await api.post<Reservation>(
      `/reservations/${id}/cancel`,
      reason ? { reason } : undefined,
    );
    return response.data;
  }

  /**
   * 查詢可用時段
   */
  static async getAvailability(request: AvailabilityRequest) {
    const params = new URLSearchParams({
      restaurantId: request.restaurantId,
      date: request.date,
      partySize: request.partySize.toString(),
      ...(request.duration && { duration: request.duration.toString() }),
    });

    const response = await api.get<AvailabilityResponse>(
      `/reservations/availability?${params.toString()}`,
    );
    return response.data;
  }

  /**
   * 取得訂位統計
   */
  static async getStats(restaurantId: string, date?: string) {
    const params = new URLSearchParams({ ...(date && { date }) });
    const response = await api.get<ReservationStats>(
      `/reservations/stats/${restaurantId}?${params.toString()}`,
    );
    return response.data.data;
  }

  /**
   * 建立時段
   */
  static async createSlot(data: CreateSlotRequest) {
    const response = await api.post<ReservationSlot>(
      `/reservations/slots`,
      data,
    );
    return response.data;
  }

  /**
   * 批次建立時段
   */
  static async batchCreateSlots(data: BatchCreateSlotsRequest) {
    const response = await api.post<{ created: number }>(
      `/reservations/slots/batch`,
      data,
    );
    return response.data;
  }

  /**
   * 取得狀態顯示文字
   */
  static getStatusText(status: ReservationStatus): string {
    const statusMap: Record<ReservationStatus, string> = {
      [ReservationStatus.PENDING]: "待確認",
      [ReservationStatus.CONFIRMED]: "已確認",
      [ReservationStatus.ARRIVED]: "已到店",
      [ReservationStatus.SEATED]: "已入座",
      [ReservationStatus.COMPLETED]: "已完成",
      [ReservationStatus.CANCELLED]: "已取消",
      [ReservationStatus.NO_SHOW]: "未到店",
    };
    return statusMap[status] || status;
  }

  /**
   * 取得狀態顏色
   */
  static getStatusColor(status: ReservationStatus): string {
    const colorMap: Record<ReservationStatus, string> = {
      [ReservationStatus.PENDING]: "warning",
      [ReservationStatus.CONFIRMED]: "info",
      [ReservationStatus.ARRIVED]: "primary",
      [ReservationStatus.SEATED]: "success",
      [ReservationStatus.COMPLETED]: "default",
      [ReservationStatus.CANCELLED]: "error",
      [ReservationStatus.NO_SHOW]: "error",
    };
    return colorMap[status] || "default";
  }
}
