import { ref, computed } from "vue";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import type { MenuItemImportInput } from "@/utils/menuItemImport";
import type { ImageMenuCategoryDraft } from "@/utils/imageAssistedMenuImport";
import type { ImageVariants } from "@/composables/useImageUpload";
import { getApiErrorCode, isRecord } from "@makanmasak/shared/utils/unknown";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

export interface CategoryData {
  id: number;
  name: string;
  nameEn?: string;
  description?: string;
  sortOrder: number;
  isActive?: boolean;
  isVisible?: boolean;
  itemCount?: number;
}

export interface MenuItemData {
  id: number;
  categoryId: number;
  catalogType: "menu_item" | "product";
  name: string;
  nameEn?: string | null;
  description?: string | null;
  price: number;
  originalPrice?: number | null;
  ingredients?: string | null;
  spiceLevel?: number;
  preparationTime?: number;
  calories?: number | null;
  dietaryInfo?: Record<string, boolean>;
  allergens?: string[];
  tags?: string[];
  keywords?: string | null;
  options?: Record<string, unknown> | null;
  imageUrl?: string | null;
  imageId?: string | null;
  imageVariants?: ImageVariants | null;
  isFeatured: boolean;
  isAvailable: boolean;
  sortOrder: number;
  inventoryCount?: number | null;
  minInventoryAlert?: number | null;
  orderCount?: number;
  /** Diners who saved this dish; only on the owner's `includeAll` read. */
  favoriteCount?: number;
  rating?: number;
  reviewCount?: number;
  /**
   * Unix-ms timestamp from menu_items.updated_at_ms. Echoed back on save as the
   * optimistic-lock precondition, so a stale form cannot overwrite someone
   * else's concurrent edit (#85).
   */
  updatedAt?: number;
}

/**
 * Outcome of a single-item save.
 *
 * "conflict" is separate from "failed" on purpose: the remedy is to reload the
 * item, not to retry the same body, and the UI has to say so.
 */
export type SaveMenuItemOutcome = "saved" | "failed" | "conflict";

interface ApiValidationDetail {
  field?: string;
  index?: number;
  message?: string;
}

interface ApiErrorPayload {
  message?: string;
  details?: ApiValidationDetail[];
}

function getApiErrorPayload(error: unknown): ApiErrorPayload | undefined {
  if (
    !isRecord(error) ||
    !isRecord(error.response) ||
    !isRecord(error.response.data) ||
    !isRecord(error.response.data.error)
  ) {
    return undefined;
  }

  const payload = error.response.data.error;
  return {
    message: typeof payload.message === "string" ? payload.message : undefined,
    details: Array.isArray(payload.details)
      ? payload.details.filter(isRecord).map((detail) => ({
          field: typeof detail.field === "string" ? detail.field : undefined,
          index: typeof detail.index === "number" ? detail.index : undefined,
          message:
            typeof detail.message === "string" ? detail.message : undefined,
        }))
      : undefined,
  };
}

// Singleton state — shared across components within the same page
const categories = ref<CategoryData[]>([]);
const menuItems = ref<MenuItemData[]>([]);
const isLoading = ref(false);
const selectedCategoryId = ref<number | null>(null);

export function useMenuManagement() {
  const authStore = useAuthStore();
  const toast = useToast();
  const { t } = useI18n();

  // ── Computed ──

  const filteredItemsByCategory = computed(() => {
    if (selectedCategoryId.value === null) return menuItems.value;
    return menuItems.value.filter(
      (item) => item.categoryId === selectedCategoryId.value,
    );
  });

  const getItemsInCategory = (categoryId: number) => {
    return menuItems.value.filter((item) => item.categoryId === categoryId);
  };

  const getCategoryName = (categoryId: number) => {
    const cat = categories.value.find((c) => c.id === categoryId);
    return cat?.name ?? t("menu.unknownCategory");
  };

  // ── Fetch ──

  const fetchMenu = async () => {
    if (!authStore.restaurantId) return;
    isLoading.value = true;
    try {
      const response = await api.get<{
        categories: CategoryData[];
        menuItems: MenuItemData[];
      }>(`/menu/${authStore.restaurantId}?includeAll=true`);
      const payload = response.data?.success ? response.data.data : undefined;
      if (payload) {
        categories.value = payload.categories.map((c) => ({
          ...c,
          nameEn: c.nameEn || "",
        }));
        // No client-side deleted-item filter: soft-deleted items carry
        // deleted_at_ms and the API excludes them at the source (#80). The old
        // sortOrder !== -1 convention is retired.
        menuItems.value = payload.menuItems.map((item) => ({
          ...item,
          nameEn: item.nameEn || "",
          catalogType: item.catalogType ?? "menu_item",
          isFeatured: !!item.isFeatured,
          isAvailable: !!item.isAvailable,
          // Listed explicitly because saveMenuItem depends on it: without a
          // version to send, an edit cannot be checked against concurrent
          // changes (#85).
          updatedAt: item.updatedAt,
        }));
      }
    } catch (error) {
      console.error("Failed to fetch menu:", error);
      toast.error(t("menu.errors.fetchFailed"));
    } finally {
      isLoading.value = false;
    }
  };

  // ── Category CRUD ──

  const saveCategory = async (
    form: {
      name: string;
      nameEn?: string;
      description?: string;
      sortOrder: number;
      isVisible?: boolean;
    },
    editingId?: number,
  ): Promise<boolean> => {
    if (!authStore.restaurantId) return false;
    try {
      if (editingId) {
        // isVisible is update-only in the API contract (createCategorySchema
        // does not declare it, so POSTing it would just be stripped). New
        // categories start visible by DB default.
        await api.put(`/menu/categories/${editingId}`, form);
        toast.success(t("menu.toast.categoryUpdated"));
      } else {
        const { isVisible: _isVisible, ...createPayload } = form;
        await api.post(
          `/menu/${authStore.restaurantId}/categories`,
          createPayload,
        );
        toast.success(t("menu.toast.categoryCreated"));
      }
      await fetchMenu();
      return true;
    } catch (error: unknown) {
      console.error("Failed to save category:", error);
      toast.error(
        resolveUserFacingError(error, t, {
          fallbackKey: "menu.errors.saveFailed",
        }).message,
      );
      return false;
    }
  };

  const deleteCategory = async (categoryId: number) => {
    try {
      await api.delete(`/menu/categories/${categoryId}`);
      // Optimistically remove from local state
      categories.value = categories.value.filter((c) => c.id !== categoryId);
      menuItems.value = menuItems.value.filter(
        (i) => i.categoryId !== categoryId,
      );
      toast.success(t("menu.toast.categoryDeleted"));
      if (selectedCategoryId.value === categoryId) {
        selectedCategoryId.value = null;
      }
      await fetchMenu();
    } catch (error: unknown) {
      console.error("Failed to delete category:", error);
      toast.error(
        resolveUserFacingError(error, t, {
          fallbackKey: "menu.errors.deleteFailed",
        }).message,
      );
      await fetchMenu();
    }
  };

  const reorderCategories = async (orderedCategories: CategoryData[]) => {
    if (!authStore.restaurantId) return;
    // Optimistic update
    categories.value = orderedCategories;
    try {
      await api.patch(`/menu/${authStore.restaurantId}/categories/reorder`, {
        categories: orderedCategories.map((c, i) => ({
          id: c.id,
          sortOrder: i,
        })),
      });
    } catch (error) {
      console.error("Failed to reorder categories:", error);
      toast.error(t("menu.errors.reorderFailed"));
      await fetchMenu(); // rollback
    }
  };

  // ── Menu Item CRUD ──

  const saveMenuItem = async (
    form: {
      name: string;
      nameEn?: string | null;
      description?: string | null;
      price: number;
      originalPrice?: number | null;
      ingredients?: string | null;
      spiceLevel?: number;
      preparationTime?: number;
      calories?: number | null;
      dietaryInfo?: Record<string, boolean>;
      allergens?: string[];
      tags?: string[];
      keywords?: string | null;
      options?: Record<string, unknown> | null;
      categoryId: number;
      catalogType?: "menu_item" | "product";
      imageUrl?: string | null;
      imageId?: string | null;
      imageVariants?: ImageVariants | null;
      isFeatured: boolean;
      isAvailable: boolean;
      sortOrder: number;
      inventoryCount?: number | null;
      minInventoryAlert?: number | null;
      // Set when editing: the updatedAt the form was populated from.
      updatedAt?: number;
    },
    editingId?: number,
  ): Promise<SaveMenuItemOutcome> => {
    if (!authStore.restaurantId) return "failed";
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        categoryId: Number(form.categoryId),
        imageUrl: form.imageUrl || null,
        imageId: form.imageId || null,
        imageVariants: form.imageVariants ?? null,
      };
      if (editingId) {
        // The form writes every field it rendered, so it must prove which
        // version it rendered. A form with no version cannot be saved safely —
        // treat it as a conflict so the UI offers the same reload remedy
        // instead of sending a body the API would reject as invalid (#85).
        if (!form.updatedAt) return "conflict";
        await api.put(`/menu/items/${editingId}`, {
          ...payload,
          updatedAt: form.updatedAt,
        });
        toast.success(t("menu.toast.itemUpdated"));
      } else {
        const { updatedAt: _updatedAt, ...createPayload } = payload;
        await api.post(`/menu/${authStore.restaurantId}/items`, createPayload);
        toast.success(t("menu.toast.itemCreated"));
      }
      await fetchMenu();
      return "saved";
    } catch (error: unknown) {
      console.error("Failed to save menu item:", error);
      if (getApiErrorCode(error) === "MENU_ITEM_MODIFIED") {
        return "conflict";
      }
      toast.error(describeSaveFailure(error));
      return "failed";
    }
  };

  /**
   * Say which field the API rejected, not just that something was rejected.
   *
   * A shape error in the hand-typed `options` JSON surfaced as the envelope's
   * generic "Validation failed" while `error.details` already carried the zod
   * issue naming the offending key — the one piece of information the owner
   * needed to fix it. Same source `describeImportFailure` reads for CSV rows.
   */
  const describeSaveFailure = (error: unknown): string => {
    const apiError = getApiErrorPayload(error);
    const details = apiError?.details ?? [];
    const issue = details.find((detail) => detail.message);

    if (issue?.message) {
      return issue.field ? `${issue.field}: ${issue.message}` : issue.message;
    }
    return apiError?.message || t("menu.errors.saveFailed");
  };

  /**
   * Turn a failed bulk import into one sentence the owner can act on.
   *
   * The API reports per-row problems in `error.details` — zod paths like
   * "items.6.price" for shape errors, `{ index }` for the cross-tenant category
   * check — and `index` is the 0-based position in the array we submitted, which
   * is CSV line `index + 2` (line 1 is the header, matching the wording
   * parseMenuItemImport already uses).
   */
  const describeImportFailure = (error: unknown): string => {
    const apiError = getApiErrorPayload(error);
    const details = apiError?.details ?? [];

    for (const detail of details) {
      const index =
        typeof detail?.index === "number"
          ? detail.index
          : Number(String(detail?.field ?? "").split(".")[1]);
      if (Number.isInteger(index)) {
        return t("menu.errors.importRowFailed", {
          row: index + 2,
          reason: detail?.message || apiError?.message || "",
        });
      }
    }

    return apiError?.message || t("menu.errors.importFailed");
  };

  const importMenuItems = async (items: MenuItemImportInput[]) => {
    if (!authStore.restaurantId || items.length === 0) return;
    try {
      // One atomic request, not one POST per row: a per-row loop left every
      // item before the failing one committed, so a retry duplicated them (#85).
      const response = await api.post<{ created: number }>(
        `/menu/${authStore.restaurantId}/items/bulk`,
        { items },
      );
      const created = response.data?.data?.created ?? items.length;
      toast.success(t("menu.toast.itemsImported", { count: created }));
      await fetchMenu();
    } catch (error: unknown) {
      console.error("Failed to import menu items:", error);
      const message = describeImportFailure(error);
      toast.error(message);
      // Nothing was written, so the caller can safely offer a retry — it must
      // show which row stopped it, hence the message rides on the error.
      throw new Error(message);
    }
  };

  /**
   * Categories deliberately remain individual requests: the existing API has
   * no category bulk endpoint. Callers then use importMenuItems once for the
   * atomic item write; if that write fails, these empty categories are kept for
   * a safe retry rather than attempting an unreliable cross-request rollback.
   */
  const createImageAssistedCategories = async (
    drafts: ImageMenuCategoryDraft[],
    ids: Map<string, number> = new Map(),
  ): Promise<Map<string, number>> => {
    if (!authStore.restaurantId) return ids;

    for (const draft of drafts) {
      if (ids.has(draft.key)) continue;
      const response = await api.post<CategoryData>(
        `/menu/${authStore.restaurantId}/categories`,
        { name: draft.name, sortOrder: draft.sortOrder },
      );
      const category = response.data?.data;
      if (!category?.id) {
        throw new Error("Category creation returned no category id");
      }
      ids.set(draft.key, category.id);
    }
    return ids;
  };

  const deleteMenuItem = async (item: MenuItemData) => {
    try {
      await api.delete(`/menu/items/${item.id}`);
      // Optimistically remove from local state immediately so UI updates
      menuItems.value = menuItems.value.filter((i) => i.id !== item.id);
      toast.success(t("menu.toast.itemDeleted"));
      // Also refetch to sync with server (handles edge cache staleness)
      await fetchMenu();
    } catch (error: unknown) {
      console.error("Failed to delete menu item:", error);
      toast.error(
        resolveUserFacingError(error, t, {
          fallbackKey: "menu.errors.deleteFailed",
        }).message,
      );
      // Re-fetch to restore state if delete failed
      await fetchMenu();
    }
  };

  const toggleMenuItemStatus = async (item: MenuItemData) => {
    try {
      // Deliberately no updatedAt: this writes availability and nothing else,
      // so it cannot clobber a concurrent price or name edit, and the newest
      // sold-out decision is the one that should win. Sending a version here
      // would make the toggle fail whenever anything else about the item had
      // changed — see STOCK_ONLY_ITEM_FIELDS in the API's menu schemas (#85).
      await api.put(`/menu/items/${item.id}`, {
        isAvailable: !item.isAvailable,
      });
      await fetchMenu();
    } catch (error) {
      console.error("Failed to toggle status:", error);
      toast.error(t("menu.errors.toggleFailed"));
    }
  };

  return {
    // State
    categories,
    menuItems,
    isLoading,
    selectedCategoryId,
    // The restaurant currently being managed — for a platform admin this is the
    // one picked in the header selector, not anything carried in their token.
    // Wrapped in computed() because Pinia unwraps store refs on access, which
    // would otherwise snapshot the value at composable-call time.
    restaurantId: computed(() => authStore.restaurantId),
    // Computed
    filteredItemsByCategory,
    // Methods
    getItemsInCategory,
    getCategoryName,
    fetchMenu,
    saveCategory,
    deleteCategory,
    reorderCategories,
    saveMenuItem,
    importMenuItems,
    createImageAssistedCategories,
    deleteMenuItem,
    toggleMenuItemStatus,
  };
}
