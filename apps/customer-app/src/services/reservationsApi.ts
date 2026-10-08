import type {
  AvailabilityResponse,
  CreateReservationRequest,
  ReservationResponse,
} from "@makanmasak/shared-types";
import { apiClient } from "./api";

/**
 * The public reservation payload deliberately excludes customerId. A diner
 * does not get to attach an anonymous booking to another account.
 */
export type CreatePublicReservationInput = Omit<
  CreateReservationRequest,
  "customerId"
>;

export const reservationsApi = {
  getAvailability(input: {
    restaurantId: string;
    date: string;
    partySize: number;
    duration?: number;
  }): Promise<AvailabilityResponse> {
    return apiClient.get<AvailabilityResponse>(
      "/reservations/availability",
      input,
    );
  },

  create(
    input: CreatePublicReservationInput,
    idempotencyKey: string,
  ): Promise<ReservationResponse> {
    return apiClient.post<ReservationResponse>("/reservations", input, {
      headers: { "Idempotency-Key": idempotencyKey },
    });
  },

  verify(confirmationCode: string): Promise<ReservationResponse> {
    return apiClient.get<ReservationResponse>(
      `/reservations/verify/${encodeURIComponent(confirmationCode)}`,
    );
  },

  cancel(
    input: {
      reservationId: string;
      confirmationCode: string;
      reason?: string;
    },
    idempotencyKey: string,
  ): Promise<ReservationResponse> {
    return apiClient.delete<ReservationResponse>(
      `/reservations/${encodeURIComponent(input.reservationId)}/cancel`,
      {
        confirmationCode: input.confirmationCode,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      { headers: { "Idempotency-Key": idempotencyKey } },
    );
  },
};
