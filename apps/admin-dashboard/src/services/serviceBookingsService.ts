import { api, unwrapApiPayload } from "@/services/api";

export type ServiceBookingStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type ServiceBookingPaymentRequirement =
  | "none"
  | "deposit"
  | "prepay"
  | "pay_at_venue";

export interface ServiceBookingSlot {
  id: string;
  restaurantId: string;
  serviceItemId: number;
  date: string;
  timeSlot: string;
  maxCapacity: number;
  currentBookings: number;
  isAvailable: number;
  blockReason?: string | null;
}

export interface CreateServiceBookingSlotInput {
  restaurantId: string;
  serviceItemId: number;
  date: string;
  timeSlot: string;
  maxCapacity: number;
  isAvailable?: boolean;
  blockReason?: string;
}

export interface BatchCreateServiceBookingSlotsInput {
  restaurantId: string;
  serviceItemId: number;
  startDate: string;
  endDate: string;
  timeSlots: string[];
  maxCapacity: number;
  isAvailable?: boolean;
}

export interface BlockServiceBookingSlotInput {
  restaurantId: string;
  serviceItemId: number;
  date: string;
  timeSlot: string;
  blockReason?: string;
}

export interface ServiceBooking {
  id: string;
  restaurantId: string;
  serviceItemId: number;
  serviceNameSnapshot: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  status: ServiceBookingStatus;
  confirmationCode: string;
  paymentRequirement: ServiceBookingPaymentRequirement;
  depositRequiredCents: number;
  balanceDueCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  paymentStatus: "unpaid" | "deposit_paid" | "paid" | "refunded";
  paymentMethod: "none" | "credits" | "cash";
  reminderOptIn: number;
  reminderMinutesBefore?: number | null;
  reminderScheduledAt?: string | null;
  reminderSentAt?: string | null;
  calendarUid: string;
  recurrenceGroupId?: string | null;
  recurrenceIndex?: number | null;
  recurrenceCount?: number | null;
  specialRequests?: string | null;
}

export const serviceBookingsService = {
  async listSlots(filters: {
    restaurantId: string;
    serviceItemId?: number;
    date?: string;
  }): Promise<ServiceBookingSlot[]> {
    const response = await api.get<{ slots: ServiceBookingSlot[] }>(
      "/service-bookings/slots",
      filters,
    );
    return unwrapApiPayload<{ slots: ServiceBookingSlot[] }>(response.data)
      .slots;
  },

  async createSlot(
    input: CreateServiceBookingSlotInput,
  ): Promise<ServiceBookingSlot> {
    const response = await api.post<{ slot: ServiceBookingSlot }>(
      "/service-bookings/slots",
      input,
    );
    return unwrapApiPayload<{ slot: ServiceBookingSlot }>(response.data).slot;
  },

  async batchCreateSlots(
    input: BatchCreateServiceBookingSlotsInput,
  ): Promise<{ created: number; slots: ServiceBookingSlot[] }> {
    const response = await api.post<{
      created: number;
      slots: ServiceBookingSlot[];
    }>("/service-bookings/slots/batch", input);
    return unwrapApiPayload<{ created: number; slots: ServiceBookingSlot[] }>(
      response.data,
    );
  },

  async blockSlot(
    input: BlockServiceBookingSlotInput,
  ): Promise<ServiceBookingSlot> {
    const response = await api.post<{ slot: ServiceBookingSlot }>(
      "/service-bookings/slots/block",
      input,
    );
    return unwrapApiPayload<{ slot: ServiceBookingSlot }>(response.data).slot;
  },

  async listBookings(filters: {
    restaurantId: string;
    date?: string;
    status?: ServiceBookingStatus;
  }): Promise<ServiceBooking[]> {
    const response = await api.get<{ bookings: ServiceBooking[] }>(
      "/service-bookings",
      filters,
    );
    return unwrapApiPayload<{ bookings: ServiceBooking[] }>(response.data)
      .bookings;
  },

  async listDueReminders(filters: {
    restaurantId?: string;
    before?: string;
  }): Promise<ServiceBooking[]> {
    const response = await api.get<{ bookings: ServiceBooking[] }>(
      "/service-bookings/reminders/due",
      filters,
    );
    return unwrapApiPayload<{ bookings: ServiceBooking[] }>(response.data)
      .bookings;
  },

  async markReminderSent(id: string): Promise<ServiceBooking> {
    const response = await api.post<{ booking: ServiceBooking }>(
      `/service-bookings/${id}/reminder-sent`,
    );
    return unwrapApiPayload<{ booking: ServiceBooking }>(response.data).booking;
  },

  calendarInviteUrl(id: string): string {
    return `/service-bookings/${encodeURIComponent(id)}/ics`;
  },

  async confirmCash(id: string): Promise<ServiceBooking> {
    const response = await api.post<{ booking: ServiceBooking }>(
      `/service-bookings/${id}/confirm-cash`,
    );
    return unwrapApiPayload<{ booking: ServiceBooking }>(response.data).booking;
  },

  async complete(id: string): Promise<ServiceBooking> {
    const response = await api.post<{ booking: ServiceBooking }>(
      `/service-bookings/${id}/complete`,
    );
    return unwrapApiPayload<{ booking: ServiceBooking }>(response.data).booking;
  },

  async markNoShow(id: string): Promise<ServiceBooking> {
    const response = await api.post<{ booking: ServiceBooking }>(
      `/service-bookings/${id}/no-show`,
    );
    return unwrapApiPayload<{ booking: ServiceBooking }>(response.data).booking;
  },

  async cancel(id: string): Promise<ServiceBooking> {
    const response = await api.delete<{ booking: ServiceBooking }>(
      `/service-bookings/${id}`,
    );
    return unwrapApiPayload<{ booking: ServiceBooking }>(response.data).booking;
  },
};
