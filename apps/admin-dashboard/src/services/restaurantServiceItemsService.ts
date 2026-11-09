import { api, unwrapApiPayload } from "@/services/api";
import type {
  CreateRestaurantServiceItemRequest,
  RestaurantServiceItem,
  UpdateRestaurantServiceItemRequest,
} from "@makanmasak/shared-types";

export type ServiceItemFormInput = Omit<
  CreateRestaurantServiceItemRequest,
  "restaurantId"
>;

// Settings mounts two managers that both list the same items; share the
// request while one is in flight (reloads after a write still refetch).
const inFlightLists = new Map<string, Promise<RestaurantServiceItem[]>>();

export const restaurantServiceItemsService = {
  list(restaurantId: string): Promise<RestaurantServiceItem[]> {
    const pending = inFlightLists.get(restaurantId);
    if (pending) return pending;
    const request = api
      .get<RestaurantServiceItem[]>(
        `/restaurants/${restaurantId}/service-items`,
      )
      .then((response) =>
        unwrapApiPayload<RestaurantServiceItem[]>(response.data),
      )
      .finally(() => inFlightLists.delete(restaurantId));
    inFlightLists.set(restaurantId, request);
    return request;
  },

  async create(
    restaurantId: string,
    input: ServiceItemFormInput,
  ): Promise<RestaurantServiceItem> {
    const response = await api.post<RestaurantServiceItem>(
      `/restaurants/${restaurantId}/service-items`,
      input,
    );
    return unwrapApiPayload<RestaurantServiceItem>(response.data);
  },

  async update(
    restaurantId: string,
    serviceItemId: number,
    input: UpdateRestaurantServiceItemRequest,
  ): Promise<RestaurantServiceItem> {
    const response = await api.put<RestaurantServiceItem>(
      `/restaurants/${restaurantId}/service-items/${serviceItemId}`,
      input,
    );
    return unwrapApiPayload<RestaurantServiceItem>(response.data);
  },

  async remove(restaurantId: string, serviceItemId: number): Promise<void> {
    await api.delete(
      `/restaurants/${restaurantId}/service-items/${serviceItemId}`,
    );
  },
};
