import {
  defineAsyncComponent,
  type AsyncComponentLoader,
  type Component,
} from "vue";

/**
 * 異步 Modal/Dialog 組件加載 Composable
 *
 * 使用方式:
 * ```typescript
 * import { useAsyncModals } from '@/composables/useAsyncModals'
 *
 * const { CouponFormModal, CouponStatsModal } = useAsyncModals()
 * ```
 *
 * 在模板中:
 * ```vue
 * <Suspense>
 *   <template #default>
 *     <CouponFormModal v-if="showModal" @close="showModal = false" />
 *   </template>
 *   <template #fallback>
 *     <div class="modal-skeleton">載入中...</div>
 *   </template>
 * </Suspense>
 * ```
 */

interface AsyncModalComponents {
  // Coupon Modals
  CouponFormModal: Component;
  CouponStatsModal: Component;
  CouponDistributeModal: Component;

  // Scheduling Modals
  ScheduleFormModal: Component;
  ShiftTemplateFormModal: Component;

  // Monitoring Modals
  ExportReportModal: Component;

  // Leave Management Dialogs
  LeaveRequestDialog: Component;
}

/**
 * 創建異步加載的 Modal 組件
 * @param loader - 動態 import 函數
 * @param delay - 延遲顯示 loading 的毫秒數 (默認 200ms)
 * @param timeout - 超時時間 (默認 30秒)
 */
function createAsyncModal(
  loader: AsyncComponentLoader,
  delay = 200,
  timeout = 30000,
): Component {
  return defineAsyncComponent({
    loader,
    delay, // 200ms 內加載完成不顯示 loading
    timeout, // 30秒超時
    errorComponent: {
      template: `
        <div class="modal-error p-6 bg-red-50 border border-red-200 rounded-lg">
          <h3 class="text-red-800 font-semibold mb-2">載入失敗</h3>
          <p class="text-red-600 text-sm">無法載入組件，請刷新頁面重試。</p>
        </div>
      `,
    },
    loadingComponent: {
      template: `
        <div class="modal-skeleton p-6 bg-gray-50 rounded-lg animate-pulse">
          <div class="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div class="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div class="h-32 bg-gray-200 rounded mb-4"></div>
          <div class="h-10 bg-gray-300 rounded w-24"></div>
        </div>
      `,
    },
  });
}

/**
 * 獲取所有異步 Modal 組件
 */
export function useAsyncModals(): AsyncModalComponents {
  return {
    // Coupon Modals
    CouponFormModal: createAsyncModal(
      () => import("@/components/coupons/CouponFormModal.vue"),
    ),
    CouponStatsModal: createAsyncModal(
      () => import("@/components/coupons/CouponStatsModal.vue"),
    ),
    CouponDistributeModal: createAsyncModal(
      () => import("@/components/coupons/CouponDistributeModal.vue"),
    ),

    // Scheduling Modals
    ScheduleFormModal: createAsyncModal(
      () => import("@/components/scheduling/ScheduleFormModal.vue"),
    ),
    ShiftTemplateFormModal: createAsyncModal(
      () => import("@/components/scheduling/ShiftTemplateFormModal.vue"),
    ),

    // Monitoring Modals
    ExportReportModal: createAsyncModal(
      () => import("@/components/monitoring/ExportReportModal.vue"),
    ),

    // Leave Management Dialogs
    LeaveRequestDialog: createAsyncModal(
      () => import("@/components/leaves/LeaveRequestDialog.vue"),
    ),
  };
}

/**
 * 快速創建單個異步 Modal
 *
 * @example
 * ```typescript
 * const MyModal = createAsyncModal(
 *   () => import('@/components/MyModal.vue')
 * )
 * ```
 */
export { createAsyncModal };

/**
 * 預加載 Modal 組件
 * 在用戶可能需要之前提前加載，改善體驗
 *
 * @example
 * ```typescript
 * // 在 onMounted 或用戶操作後調用
 * preloadModal(() => import('@/components/MyModal.vue'))
 * ```
 */
export function preloadModal(loader: AsyncComponentLoader): void {
  // 使用 requestIdleCallback 在瀏覽器空閒時預加載
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => {
      loader().catch(() => {
        // 預加載失敗不影響主流程
        console.warn("Modal preload failed, will load on demand");
      });
    });
  } else {
    // Fallback: 使用 setTimeout
    setTimeout(() => {
      loader().catch(() => {
        console.warn("Modal preload failed, will load on demand");
      });
    }, 1000);
  }
}

/**
 * 批量預加載多個 Modal
 *
 * @example
 * ```typescript
 * preloadModals([
 *   () => import('@/components/Modal1.vue'),
 *   () => import('@/components/Modal2.vue'),
 * ])
 * ```
 */
export function preloadModals(loaders: AsyncComponentLoader[]): void {
  loaders.forEach((loader, index) => {
    // 錯開加載時間，避免同時請求
    setTimeout(() => {
      preloadModal(loader);
    }, index * 500);
  });
}

// 默認導出
export default useAsyncModals;
