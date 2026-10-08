import { apiClient } from "./api";
import type { Restaurant, MenuItem, Category } from "@makanmasak/shared-types";

export interface MenuApiResponse {
  restaurant: Restaurant;
  categories: Category[];
  menuItems: MenuItem[];
  featuredItems: MenuItem[];
}

export interface CategoryMenuResponse {
  category: Category;
  menuItems: MenuItem[];
}

export const menuApi = {
  /**
   * 獲取餐廳完整菜單資訊
   */
  async getRestaurantMenu(
    restaurantId: string,
    tableId?: number,
    options?: { fresh?: boolean },
  ): Promise<MenuApiResponse> {
    const params = new URLSearchParams();
    if (tableId) {
      params.append("tableId", tableId.toString());
    }

    const response = await apiClient.request<MenuApiResponse>({
      method: "GET",
      url: `/menu/${restaurantId}${params.toString() ? `?${params.toString()}` : ""}`,
      ...(options?.fresh ? { headers: { "Cache-Control": "no-cache" } } : {}),
    });
    return response;
  },

  /**
   * 獲取餐廳基本資訊
   */
  async getRestaurant(restaurantId: string): Promise<Restaurant> {
    const response = await apiClient.get<Restaurant>(
      `/restaurants/${restaurantId}`,
    );
    return response;
  },

  /**
   * 獲取特定分類的菜單項目
   */
  async getCategoryMenu(
    restaurantId: string,
    categoryId: number,
  ): Promise<CategoryMenuResponse> {
    const response = await apiClient.get<CategoryMenuResponse>(
      `/restaurants/${restaurantId}/categories/${categoryId}/menu`,
    );
    return response;
  },

  /**
   * 獲取單個菜單項目詳情
   */
  async getMenuItem(
    restaurantId: string,
    menuItemId: number,
  ): Promise<MenuItem> {
    const response = await apiClient.get<MenuItem>(
      `/restaurants/${restaurantId}/menu/${menuItemId}`,
    );
    return response;
  },

  /**
   * 獲取推薦菜品
   */
  async getFeaturedItems(
    restaurantId: string,
    limit: number = 10,
  ): Promise<MenuItem[]> {
    const response = await apiClient.get<MenuItem[]>(
      `/restaurants/${restaurantId}/menu/featured?limit=${limit}`,
    );
    return response;
  },

  /**
   * 搜索菜單項目
   */
  async searchMenuItems(
    restaurantId: string,
    query: string,
    options?: {
      categoryId?: number;
      priceMin?: number;
      priceMax?: number;
      dietary?: string[];
      limit?: number;
      offset?: number;
    },
  ): Promise<{
    menuItems: MenuItem[];
    total: number;
    hasMore: boolean;
  }> {
    const params = new URLSearchParams({ query });

    if (options?.categoryId) {
      params.append("categoryId", options.categoryId.toString());
    }
    if (options?.priceMin !== undefined) {
      params.append("priceMin", options.priceMin.toString());
    }
    if (options?.priceMax !== undefined) {
      params.append("priceMax", options.priceMax.toString());
    }
    if (options?.dietary?.length) {
      options.dietary.forEach((diet) => params.append("dietary", diet));
    }
    if (options?.limit) {
      params.append("limit", options.limit.toString());
    }
    if (options?.offset) {
      params.append("offset", options.offset.toString());
    }

    const response = await apiClient.get<{
      menuItems: MenuItem[];
      total: number;
      hasMore: boolean;
    }>(`/restaurants/${restaurantId}/menu/search?${params.toString()}`);
    return response;
  },

  /**
   * 檢查菜單項目庫存
   */
  async checkItemAvailability(
    restaurantId: string,
    menuItemIds: number[],
  ): Promise<Record<number, { isAvailable: boolean; inventoryCount: number }>> {
    const response = await apiClient.post<
      Record<
        number,
        {
          isAvailable: boolean;
          inventoryCount: number;
        }
      >
    >(`/restaurants/${restaurantId}/menu/availability`, { menuItemIds });
    return response;
  },

  /**
   * 獲取菜單分類
   */
  async getCategories(restaurantId: string): Promise<Category[]> {
    const response = await apiClient.get<Category[]>(
      `/restaurants/${restaurantId}/categories`,
    );
    return response;
  },

  /**
   * 獲取營業時間和可用性
   */
  async getRestaurantAvailability(restaurantId: string): Promise<{
    isOpen: boolean;
    businessHours: Record<string, string>;
    nextOpenTime?: string;
    specialHours?: Array<{
      date: string;
      hours: string;
      note?: string;
    }>;
  }> {
    const response = await apiClient.get<{
      isOpen: boolean;
      businessHours: Record<string, string>;
      nextOpenTime?: string;
      specialHours?: Array<{
        date: string;
        hours: string;
        note?: string;
      }>;
    }>(`/restaurants/${restaurantId}/availability`);
    return response;
  },

  /**
   * 驗證桌號
   */
  async validateTable(
    restaurantId: string,
    tableId: number,
  ): Promise<{
    isValid: boolean;
    table?: {
      id: number;
      number: string;
      seats: number;
      status: string;
    };
    restaurant?: Restaurant;
  }> {
    const response = await apiClient.get<{
      isValid: boolean;
      table?: {
        id: number;
        number: string;
        seats: number;
        status: string;
      };
      restaurant?: Restaurant;
    }>(`/restaurants/${restaurantId}/tables/${tableId}/validate`);
    return response;
  },

  /**
   * 搜尋餐廳（依名稱）
   */
  async searchRestaurants(
    query: string,
    limit: number = 10,
  ): Promise<
    Array<{
      restaurantId: string;
      name: string;
      type: string | null;
      district: string | null;
      imageUrl: string | null;
    }>
  > {
    const params = new URLSearchParams({ q: query, limit: limit.toString() });
    const response = await apiClient.get<{
      results: Array<{
        restaurantId: string;
        name: string;
        type: string | null;
        district: string | null;
        imageUrl: string | null;
      }>;
    }>(`/discovery/restaurants?${params.toString()}`);
    return response.results;
  },

  /**
   * 取得菜單 - getRestaurantMenu 的別名
   */
  async getMenu(
    restaurantId: string,
    tableId?: number,
    options?: { fresh?: boolean },
  ): Promise<MenuApiResponse> {
    return this.getRestaurantMenu(restaurantId, tableId, options);
  },
};

export default menuApi;
