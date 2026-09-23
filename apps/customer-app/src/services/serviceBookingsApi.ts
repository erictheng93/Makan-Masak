import { apiClient } from "./api";

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

export interface ServiceBookingAvailabilitySlot {
  timeSlot: string;
  remaining: number | null;
  isAvailable: boolean;
}

export interface ServiceBooking {
  id: string;
  restaurantId: string;
  serviceItemId: number;
  serviceNameSnapshot: string;
  durationMinutesSnapshot?: number | null;
  priceCentsSnapshot: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  status: ServiceBookingStatus;
  confirmationCode: string;
  specialRequests?: string | null;
  voucherDiscountCents: number;
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
}

export interface CreateServiceBookingInput {
  restaurantId: string;
  serviceItemId: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  bookingDate: string;
  bookingTime: string;
  partySize?: number;
  employeeId?: number;
  specialRequests?: string;
  voucherCode?: string;
  reminderOptIn?: boolean;
  reminderMinutesBefore?: number;
}

export interface CreateRecurringServiceBookingInput extends Omit<
  CreateServiceBookingInput,
  "bookingDate"
> {
  startDate: string;
  count: number;
  intervalWeeks?: number;
}

export interface JoinServiceBookingWaitlistInput extends Omit<
  CreateServiceBookingInput,
  "voucherCode" | "reminderOptIn" | "reminderMinutesBefore"
> {
  notes?: string;
}

export interface ServiceBookingWaitlistEntry {
  id: string;
  restaurantId: string;
  serviceItemId: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  bookingDate: string;
  bookingTime: string;
  partySize: number;
  status: "waiting" | "notified" | "converted" | "cancelled";
  specialRequests?: string | null;
  notes?: string | null;
}

export interface ServiceBookingContactProof {
  requireContact?: boolean;
  customerPhone?: string;
  customerEmail?: string;
}

export const serviceBookingsApi = {
  async getAvailability(input: {
    serviceItemId: number;
    date: string;
  }): Promise<ServiceBookingAvailabilitySlot[]> {
    const response = await apiClient.get<{
      slots: ServiceBookingAvailabilitySlot[];
    }>("/service-bookings/availability", input);
    return response.slots;
  },

  async createBooking(
    input: CreateServiceBookingInput,
  ): Promise<ServiceBooking> {
    const response = await apiClient.post<{ booking: ServiceBooking }>(
      "/service-bookings",
      input,
    );
    return response.booking;
  },

  async createRecurringBookings(
    input: CreateRecurringServiceBookingInput,
  ): Promise<ServiceBooking[]> {
    const response = await apiClient.post<{ bookings: ServiceBooking[] }>(
      "/service-bookings/recurring",
      input,
    );
    return response.bookings;
  },

  async joinWaitlist(
    input: JoinServiceBookingWaitlistInput,
  ): Promise<ServiceBookingWaitlistEntry> {
    const response = await apiClient.post<{
      waitlistEntry: ServiceBookingWaitlistEntry;
    }>("/service-bookings/waitlist", input);
    return response.waitlistEntry;
  },

  async payWithCredits(input: {
    bookingId: string;
    creditCardPublicId: string;
    pin?: string;
  }): Promise<ServiceBooking> {
    const response = await apiClient.post<{ booking: ServiceBooking }>(
      `/service-bookings/${input.bookingId}/pay`,
      {
        creditCardPublicId: input.creditCardPublicId,
        pin: input.pin,
      },
    );
    return response.booking;
  },

  async verify(
    code: string,
    contactProof?: ServiceBookingContactProof,
  ): Promise<ServiceBooking> {
    const url = `/service-bookings/verify/${encodeURIComponent(code)}`;
    const response =
      contactProof === undefined
        ? await apiClient.get<{ booking: ServiceBooking }>(url)
        : await apiClient.get<{ booking: ServiceBooking }>(url, contactProof);
    return response.booking;
  },

  async cancelByCode(
    code: string,
    contactProof?: ServiceBookingContactProof,
  ): Promise<ServiceBooking> {
    const url = `/service-bookings/verify/${encodeURIComponent(code)}/cancel`;
    const response =
      contactProof === undefined
        ? await apiClient.post<{ booking: ServiceBooking }>(url)
        : await apiClient.post<{ booking: ServiceBooking }>(url, contactProof);
    return response.booking;
  },

  calendarInviteUrl(code: string, contactProof?: ServiceBookingContactProof) {
    const params = new URLSearchParams();
    if (contactProof?.requireContact) params.set("requireContact", "true");
    if (contactProof?.customerPhone) {
      params.set("customerPhone", contactProof.customerPhone);
    }
    if (contactProof?.customerEmail) {
      params.set("customerEmail", contactProof.customerEmail);
    }
    const query = params.toString();
    return `/service-bookings/verify/${encodeURIComponent(code)}/ics${
      query ? `?${query}` : ""
    }`;
  },
};
