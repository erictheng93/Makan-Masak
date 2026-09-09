<template>
  <div class="orders-view" data-testid="admin-orders-page">
    <!-- 訂單統計卡片 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="bg-white rounded-lg shadow p-4 lg:p-6">
        <div class="flex items-center">
          <div class="p-2 bg-yellow-100 rounded-lg">
            <ClockIcon class="h-5 w-5 lg:h-6 lg:w-6 text-yellow-600" />
          </div>
          <div class="ml-3 lg:ml-4 min-w-0">
            <h3 class="text-sm lg:text-lg font-semibold text-gray-900 truncate">
              {{ t("orders.stats.pending") }}
            </h3>
            <p class="text-xl lg:text-2xl font-bold text-yellow-600">
              {{ stats.pending }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-4 lg:p-6">
        <div class="flex items-center">
          <div class="p-2 bg-blue-100 rounded-lg">
            <ShoppingBagIcon class="h-5 w-5 lg:h-6 lg:w-6 text-blue-600" />
          </div>
          <div class="ml-3 lg:ml-4 min-w-0">
            <h3 class="text-sm lg:text-lg font-semibold text-gray-900 truncate">
              {{ t("orders.stats.preparing") }}
            </h3>
            <p class="text-xl lg:text-2xl font-bold text-blue-600">
              {{ stats.preparing }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-4 lg:p-6">
        <div class="flex items-center">
          <div class="p-2 bg-green-100 rounded-lg">
            <CheckCircleIcon class="h-5 w-5 lg:h-6 lg:w-6 text-green-600" />
          </div>
          <div class="ml-3 lg:ml-4 min-w-0">
            <h3 class="text-sm lg:text-lg font-semibold text-gray-900 truncate">
              {{ t("orders.stats.completed") }}
            </h3>
            <p class="text-xl lg:text-2xl font-bold text-green-600">
              {{ stats.completed }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-4 lg:p-6">
        <div class="flex items-center">
          <div class="p-2 bg-red-100 rounded-lg">
            <XCircleIcon class="h-5 w-5 lg:h-6 lg:w-6 text-red-600" />
          </div>
          <div class="ml-3 lg:ml-4 min-w-0">
            <h3 class="text-sm lg:text-lg font-semibold text-gray-900 truncate">
              {{ t("orders.stats.cancelled") }}
            </h3>
            <p class="text-xl lg:text-2xl font-bold text-red-600">
              {{ stats.cancelled }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 訂單篩選和搜索 -->
    <div class="bg-white rounded-lg shadow mb-6">
      <div class="p-4 lg:p-6">
        <div class="flex flex-col gap-3">
          <!-- Search -->
          <div class="relative">
            <MagnifyingGlassIcon
              class="absolute left-3 top-3 h-4 w-4 text-gray-400"
            />
            <input
              v-model="searchQuery"
              type="text"
              data-testid="admin-orders-search"
              :placeholder="t('orders.searchPlaceholder')"
              class="w-full pl-10 pr-4 py-2 bg-white border-0 rounded-xl shadow-ios-sm focus:ring-2 focus:ring-ios-blue focus:ring-opacity-30 transition-colors"
            />
          </div>

          <!-- Filters row -->
          <div class="flex flex-wrap gap-2">
            <select
              v-model="statusFilter"
              data-testid="admin-orders-status-filter"
              class="flex-1 min-w-[120px] px-3 py-2 bg-white border-0 rounded-xl shadow-ios-sm text-sm focus:ring-2 focus:ring-ios-blue focus:ring-opacity-30 transition-colors"
            >
              <option value="">{{ t("orders.filter.allStatus") }}</option>
              <option value="pending">{{ t("orders.status.pending") }}</option>
              <option value="confirmed">
                {{ t("orders.status.confirmed") }}
              </option>
              <option value="preparing">
                {{ t("orders.status.preparing") }}
              </option>
              <option value="ready">{{ t("orders.status.ready") }}</option>
              <option value="delivered">
                {{ t("orders.status.delivered") }}
              </option>
              <option value="paid">{{ t("orders.status.paid") }}</option>
              <option value="refunded">
                {{ t("orders.status.refunded") }}
              </option>
              <option value="cancelled">
                {{ t("orders.status.cancelled") }}
              </option>
            </select>

            <select
              v-model="typeFilter"
              data-testid="admin-orders-type-filter"
              class="flex-1 min-w-[120px] px-3 py-2 bg-white border-0 rounded-xl shadow-ios-sm text-sm focus:ring-2 focus:ring-ios-blue focus:ring-opacity-30 transition-colors"
            >
              <option value="">{{ t("orders.filter.allTypes") }}</option>
              <option value="dine_in">{{ t("orders.type.dineIn") }}</option>
              <option value="takeaway">{{ t("orders.type.takeaway") }}</option>
              <option value="delivery">{{ t("orders.type.delivery") }}</option>
            </select>

            <select
              v-model="sourceFilter"
              data-testid="admin-orders-source-filter"
              class="flex-1 min-w-[120px] px-3 py-2 bg-white border-0 rounded-xl shadow-ios-sm text-sm focus:ring-2 focus:ring-ios-blue focus:ring-opacity-30 transition-colors"
            >
              <option value="">{{ t("orders.filter.allSources") }}</option>
              <option value="direct">{{ t("orders.source.direct") }}</option>
              <option value="market_checkout">
                {{ t("orders.source.marketCheckout") }}
              </option>
              <option value="uber_eats">Uber Eats</option>
              <option value="foodpanda">Foodpanda</option>
              <option value="grabfood">GrabFood</option>
            </select>

            <button
              class="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm whitespace-nowrap"
              @click="refreshOrders"
            >
              <ArrowPathIcon class="h-4 w-4 mr-1.5" />
              {{ t("orders.refresh") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 訂單列表 -->
    <div class="bg-white rounded-lg shadow">
      <div class="p-4 lg:p-6">
        <h2 class="text-lg lg:text-xl font-semibold text-gray-900 mb-4 lg:mb-6">
          {{ t("orders.orderList") }}
        </h2>

        <!-- ==================== Desktop Table (lg+) ==================== -->
        <div class="hidden lg:block">
          <!-- 表格標題 -->
          <div
            class="grid grid-cols-[minmax(100px,1fr)_60px_90px_70px_70px_80px_80px_minmax(120px,1.2fr)_auto] gap-3 px-4 py-3 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wider rounded-t-lg"
          >
            <div>{{ t("orders.columns.orderNumber") }}</div>
            <div>{{ t("orders.columns.tableNumber") }}</div>
            <div>{{ t("orders.columns.customer") }}</div>
            <div>{{ t("orders.columns.type") }}</div>
            <div>{{ t("orders.columns.source") }}</div>
            <div>{{ t("orders.columns.status") }}</div>
            <div>{{ t("orders.columns.total") }}</div>
            <div>{{ t("orders.columns.orderTime") }}</div>
            <div class="text-right">{{ t("orders.columns.actions") }}</div>
          </div>

          <!-- 虛擬滾動訂單列表 -->
          <div
            v-if="filteredOrders.length > 0"
            ref="containerRef"
            class="overflow-y-auto"
            :style="{ height: CONTAINER_HEIGHT + 'px' }"
            @scroll="handleScroll"
          >
            <div
              class="relative"
              :style="{ height: totalHeight + 'px', minHeight: '100%' }"
            >
              <div
                :style="{
                  transform: `translateY(${offsetY}px)`,
                  willChange: 'transform',
                }"
              >
                <div
                  v-for="{ item: order } in visibleItems"
                  :key="order.id"
                  class="grid grid-cols-[minmax(100px,1fr)_60px_90px_70px_70px_80px_80px_minmax(120px,1.2fr)_auto] gap-3 px-4 py-3 hover:bg-gray-50 border-b border-gray-200 items-center"
                  :style="{ height: ITEM_HEIGHT + 'px' }"
                >
                  <div class="text-sm font-medium text-gray-900 truncate">
                    {{ getOrderNumber(order) }}
                  </div>
                  <div
                    class="text-sm text-gray-500"
                    :data-testid="`admin-order-table-${order.id}`"
                  >
                    {{ getTableNumber(order) }}
                  </div>
                  <div class="text-sm text-gray-500 truncate">
                    {{ getCustomerName(order) }}
                  </div>
                  <div>
                    <span
                      :class="getTypeClass(getOrderType(order))"
                      class="px-1.5 inline-flex text-xs leading-5 font-semibold rounded-full"
                    >
                      {{ getTypeText(getOrderType(order)) }}
                    </span>
                  </div>
                  <div>
                    <span
                      v-if="order.orderSource && order.orderSource !== 'direct'"
                      :class="getSourceClass(order.orderSource)"
                      class="px-1.5 inline-flex text-xs leading-5 font-semibold rounded-full"
                    >
                      {{ getSourceText(order.orderSource) }}
                    </span>
                    <span v-else class="text-xs text-gray-400">{{
                      t("orders.source.direct")
                    }}</span>
                  </div>
                  <div>
                    <span
                      :class="getStatusClass(order.status)"
                      class="px-1.5 inline-flex text-xs leading-5 font-semibold rounded-full"
                    >
                      {{ getStatusText(order.status) }}
                    </span>
                  </div>
                  <div class="text-sm text-gray-500">
                    {{ formatPrice(order.totalAmount) }}
                  </div>
                  <div class="text-xs text-gray-500">
                    {{ formatDateTime(order.createdAt) }}
                  </div>
                  <!-- Desktop actions: icon buttons -->
                  <div class="flex items-center justify-end gap-1">
                    <button
                      class="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                      :data-testid="`admin-order-view-${order.id}`"
                      :title="t('orders.actions.view')"
                      @click="viewOrderDetails(order)"
                    >
                      <EyeIcon class="h-4 w-4" />
                    </button>
                    <button
                      v-if="canUpdateStatus(order.status)"
                      class="p-1.5 text-green-600 hover:bg-green-50 rounded-md transition-colors"
                      :data-testid="`admin-order-update-${order.id}`"
                      :title="t('orders.actions.update')"
                      @click="updateOrderStatus(order)"
                    >
                      <ArrowPathIcon class="h-4 w-4" />
                    </button>
                    <button
                      v-if="canCancel(order.status)"
                      class="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      :data-testid="`admin-order-cancel-${order.id}`"
                      :title="t('orders.actions.cancel')"
                      @click="cancelOrder(order)"
                    >
                      <XCircleIcon class="h-4 w-4" />
                    </button>
                    <button
                      v-if="canRefund(order)"
                      class="p-1.5 text-orange-600 hover:bg-orange-50 rounded-md transition-colors"
                      :data-testid="`admin-order-refund-${order.id}`"
                      :title="t('orders.actions.refund')"
                      @click="refundOrder(order)"
                    >
                      {{ t("orders.actions.refund") }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ==================== Mobile/Tablet Card List (<lg) ==================== -->
        <div class="lg:hidden">
          <div v-if="filteredOrders.length > 0" class="space-y-3">
            <div
              v-for="order in filteredOrders"
              :key="order.id"
              class="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <!-- Card header: order number + status -->
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold text-gray-900">
                  {{ getOrderNumber(order) }}
                </span>
                <span
                  :class="getStatusClass(order.status)"
                  class="px-2 py-0.5 text-xs font-semibold rounded-full"
                >
                  {{ getStatusText(order.status) }}
                </span>
              </div>

              <!-- Card body: key info in 2-col grid -->
              <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm mb-3">
                <div class="text-gray-500">
                  {{ t("orders.columns.customer") }}
                </div>
                <div class="text-gray-900 text-right">
                  {{ getCustomerName(order) }}
                </div>

                <div class="text-gray-500">
                  {{ t("orders.columns.tableNumber") }}
                </div>
                <div
                  class="text-gray-900 text-right"
                  :data-testid="`admin-order-table-${order.id}`"
                >
                  {{ getTableNumber(order) }}
                </div>

                <div class="text-gray-500">{{ t("orders.columns.type") }}</div>
                <div class="text-right">
                  <span
                    :class="getTypeClass(getOrderType(order))"
                    class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                  >
                    {{ getTypeText(getOrderType(order)) }}
                  </span>
                </div>

                <div class="text-gray-500">{{ t("orders.columns.total") }}</div>
                <div class="text-gray-900 font-semibold text-right">
                  {{ formatPrice(order.totalAmount) }}
                </div>

                <div class="text-gray-500">
                  {{ t("orders.columns.orderTime") }}
                </div>
                <div class="text-gray-500 text-right text-xs">
                  {{ formatDateTime(order.createdAt) }}
                </div>
              </div>

              <!-- Card footer: action buttons -->
              <div
                class="flex items-center gap-2 pt-3 border-t border-gray-100"
              >
                <button
                  class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  :data-testid="`admin-order-view-${order.id}`"
                  @click="viewOrderDetails(order)"
                >
                  <EyeIcon class="h-4 w-4" />
                  {{ t("orders.actions.view") }}
                </button>
                <button
                  v-if="canUpdateStatus(order.status)"
                  class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                  :data-testid="`admin-order-update-${order.id}`"
                  @click="updateOrderStatus(order)"
                >
                  <ArrowPathIcon class="h-4 w-4" />
                  {{ t("orders.actions.update") }}
                </button>
                <button
                  v-if="canCancel(order.status)"
                  class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                  :data-testid="`admin-order-cancel-${order.id}`"
                  @click="cancelOrder(order)"
                >
                  <XCircleIcon class="h-4 w-4" />
                  {{ t("orders.actions.cancel") }}
                </button>
                <button
                  v-if="canRefund(order)"
                  class="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
                  :data-testid="`admin-order-refund-${order.id}`"
                  @click="refundOrder(order)"
                >
                  {{ t("orders.actions.refund") }}
                </button>
              </div>
            </div>
          </div>
        </div>
        <nav
          v-if="orderStore.pagination.totalPages > 1"
          class="flex items-center justify-between border-t px-4 py-3 text-sm"
          aria-label="Order pagination"
        >
          <span>{{ orderStore.pagination.total }}</span>
          <div class="flex gap-2">
            <button
              :disabled="orderStore.pagination.page <= 1"
              data-testid="admin-orders-previous-page"
              class="rounded border px-3 py-1 disabled:opacity-50"
              @click="goToPage(orderStore.pagination.page - 1)"
            >
              {{ t("common.previousPage") }}
            </button>
            <button
              :disabled="
                orderStore.pagination.page >= orderStore.pagination.totalPages
              "
              data-testid="admin-orders-next-page"
              class="rounded border px-3 py-1 disabled:opacity-50"
              @click="goToPage(orderStore.pagination.page + 1)"
            >
              {{ t("common.nextPage") }}
            </button>
          </div>
        </nav>

        <!-- 載入指示器 -->
        <div v-if="isLoading" class="p-4 text-center">
          <div class="flex items-center justify-center">
            <div
              class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"
            />
            <span class="ml-2 text-sm text-gray-600">{{
              t("common.loading")
            }}</span>
          </div>
        </div>

        <!-- 空狀態 -->
        <div
          v-if="filteredOrders.length === 0 && !isLoading"
          class="text-center py-12"
        >
          <ShoppingBagIcon class="mx-auto h-12 w-12 text-gray-400" />
          <h3 class="mt-2 text-sm font-medium text-gray-900">
            {{ t("orders.empty.title") }}
          </h3>
          <p class="mt-1 text-sm text-gray-500">
            {{ t("orders.empty.subtitle") }}
          </p>
        </div>
      </div>
    </div>

    <!-- 訂單詳情模態框 -->
    <div v-if="selectedOrder" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="selectedOrder = null"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-2xl w-full">
          <div class="p-4 sm:p-6">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-2">
                <h3 class="text-lg font-semibold">
                  {{ t("orders.orderDetail") }} -
                  {{ getOrderNumber(selectedOrder) }}
                </h3>
                <span
                  v-if="
                    selectedOrder?.deliveryInfo?.type &&
                    selectedOrder.deliveryInfo.type !== 'dine_in'
                  "
                  :class="[
                    'px-2 py-1 rounded-full text-xs font-semibold',
                    selectedOrder.deliveryInfo.type === 'delivery'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-green-100 text-green-800',
                  ]"
                >
                  {{
                    selectedOrder.deliveryInfo.type === "delivery"
                      ? "🛵 外送"
                      : "🛍️ 外帶"
                  }}
                </span>
              </div>
              <button
                class="text-gray-400 hover:text-gray-600"
                @click="selectedOrder = null"
              >
                <XMarkIcon class="h-6 w-6" />
              </button>
            </div>

            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700">{{
                    t("orders.columns.tableNumber")
                  }}</label>
                  <p class="text-sm text-gray-900">
                    {{ getTableNumber(selectedOrder) }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">{{
                    t("orders.detail.customerName")
                  }}</label>
                  <p class="text-sm text-gray-900">
                    {{ getCustomerName(selectedOrder) }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">{{
                    t("orders.detail.orderType")
                  }}</label>
                  <p class="text-sm text-gray-900">
                    {{ getTypeText(getOrderType(selectedOrder)) }}
                  </p>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700">{{
                    t("orders.detail.orderStatus")
                  }}</label>
                  <p class="text-sm text-gray-900">
                    {{ getStatusText(selectedOrder.status) }}
                  </p>
                </div>
              </div>

              <!-- Delivery Info Section -->
              <div
                v-if="
                  selectedOrder?.deliveryInfo &&
                  selectedOrder.deliveryInfo.type !== 'dine_in'
                "
                class="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl"
              >
                <h4
                  class="font-semibold text-amber-800 mb-3 flex items-center gap-1"
                >
                  <span>📦</span> {{ t("orders.detail.deliveryInfo") }}
                </h4>
                <div class="grid grid-cols-[80px_1fr] gap-y-2 text-sm">
                  <span class="text-gray-500">{{
                    t("orders.detail.type")
                  }}</span>
                  <span class="font-medium">
                    {{
                      selectedOrder.deliveryInfo.type === "delivery"
                        ? "🛵 外送"
                        : "🛍️ 外帶"
                    }}
                  </span>
                  <template v-if="selectedOrder.deliveryInfo.address">
                    <span class="text-gray-500">{{
                      t("orders.detail.address")
                    }}</span>
                    <span>{{ selectedOrder.deliveryInfo.address }}</span>
                  </template>
                  <template v-if="selectedOrder.deliveryInfo.phone">
                    <span class="text-gray-500">{{
                      t("orders.detail.phone")
                    }}</span>
                    <span>{{ selectedOrder.deliveryInfo.phone }}</span>
                  </template>
                  <template v-if="selectedOrder.deliveryInfo.instructions">
                    <span class="text-gray-500">{{
                      t("orders.detail.notes")
                    }}</span>
                    <span>{{ selectedOrder.deliveryInfo.instructions }}</span>
                  </template>
                  <template v-if="selectedOrder.deliveryInfo.deliveryFee">
                    <span class="text-gray-500">{{
                      t("orders.detail.deliveryFee")
                    }}</span>
                    <span class="font-semibold">{{
                      formatPrice(selectedOrder.deliveryInfo.deliveryFee)
                    }}</span>
                  </template>
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between mb-2">
                  <label class="block text-sm font-medium text-gray-700">{{
                    t("orders.detail.orderItems")
                  }}</label>
                  <button
                    v-if="canEditItems(selectedOrder)"
                    type="button"
                    class="text-sm font-medium text-ios-blue hover:underline"
                    data-testid="toggle-item-edit"
                    @click="isEditingItems = !isEditingItems"
                  >
                    {{
                      isEditingItems
                        ? t("orders.edit.done")
                        : t("orders.edit.title")
                    }}
                  </button>
                </div>

                <OrderItemsEditor
                  v-if="isEditingItems && canEditItems(selectedOrder)"
                  :order="selectedOrder"
                  @updated="onOrderItemsUpdated"
                />
                <div v-else class="border rounded-lg divide-y">
                  <div
                    v-for="item in selectedOrder.items"
                    :key="item.id"
                    class="p-3 hover:bg-ios-bg transition-colors rounded-lg cursor-pointer group/item"
                    @click="navigateToMenuItem(item)"
                  >
                    <div class="flex justify-between items-start">
                      <div class="flex-1 min-w-0">
                        <p
                          class="font-medium text-ios-blue group-hover/item:underline flex items-center gap-1"
                        >
                          {{ getMenuItemName(item) }}
                          <ArrowTopRightOnSquareIcon
                            class="h-3.5 w-3.5 opacity-0 group-hover/item:opacity-100 transition-opacity"
                          />
                        </p>
                        <p class="text-sm text-gray-500">
                          {{ t("orders.detail.quantity") }}: {{ item.quantity }}
                        </p>
                      </div>
                      <p class="font-medium">
                        {{ formatPrice(item.unitPrice * item.quantity) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div class="border-t pt-4">
                <div
                  v-if="selectedOrder?.deliveryInfo?.deliveryFee"
                  class="flex justify-between text-sm text-gray-500 mb-2"
                >
                  <span>{{ t("orders.detail.deliveryFee") }}</span>
                  <span>{{
                    formatPrice(selectedOrder.deliveryInfo.deliveryFee)
                  }}</span>
                </div>
                <div class="flex justify-between text-lg font-semibold">
                  <span>{{ t("orders.detail.totalAmount") }}</span>
                  <span>{{ formatPrice(selectedOrder.totalAmount) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { api } from "@/services/api";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import {
  CANCELLABLE_ORDER_STATUSES,
  ROLE_STATUS_PERMISSIONS,
} from "@makanmasak/shared-types";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import { useAuthStore } from "@/stores/auth";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useOrderStore } from "@/stores/order";
import { useVirtualScroll } from "@/composables/useVirtualScroll";
import { useConfirmModal } from "@/composables/useConfirmModal";
import OrderItemsEditor from "@/components/orders/OrderItemsEditor.vue";
import type { Order, OrderItem, OrderStatus } from "@/types";
import {
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  ShoppingBagIcon,
  XMarkIcon,
  EyeIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/vue/24/outline";

const { t } = useI18n();
const toast = useToast();
const { formatPrice } = useCurrency();
const { formatDateTime } = useDateFormatter();
const router = useRouter();
const authStore = useAuthStore();
const { confirm: confirmModal } = useConfirmModal();
const orderStore = useOrderStore();

// 響應式數據
const searchQuery = ref("");
const statusFilter = ref("");
const typeFilter = ref("");
const sourceFilter = ref("");
const selectedOrder = ref<Order | null>(null);
const isLoading = ref(false);
const isEditingItems = ref(false);

/**
 * #273. Editing is offered on exactly the statuses the API will accept, so the
 * button never opens an editor whose every action 400s. Roles 0 and 1 match the
 * route's requireRole: changing what a customer is charged is an owner-level
 * action, like cancel and refund beside it.
 */
const MODIFIABLE_ORDER_STATUSES: OrderStatus[] = ["pending", "confirmed"];

const canEditItems = (order: Order | null): boolean =>
  !!order &&
  MODIFIABLE_ORDER_STATUSES.includes(order.status) &&
  (authStore.user?.role === 0 || authStore.user?.role === 1);

/**
 * The server owns the recomputed totals and the new version, so the modal is
 * re-pointed at what it returned rather than patched field by field.
 */
const onOrderItemsUpdated = (order: Order) => {
  selectedOrder.value = order;
};

const getOrderNumber = (order: Order) => order.orderNumber ?? order.id;
const getTableNumber = (order: Order) =>
  order.table?.number ??
  (order.tableId ? String(order.tableId) : t("orders.type.takeaway"));
const getCustomerName = (order: Order) =>
  order.customerInfo?.name || t("orders.defaultCustomer");
const getOrderType = (order: Order) => {
  if (order.deliveryInfo?.type) {
    return order.deliveryInfo.type;
  }

  if (order.orderType === "table" || order.orderType === "seat") {
    return "dine_in";
  }

  if (order.orderType === "shop") {
    return "takeaway";
  }

  return order.tableId ? "dine_in" : "takeaway";
};

const getSourceClass = (source: string) => {
  const classes: Record<string, string> = {
    uber_eats: "bg-green-100 text-green-800",
    foodpanda: "bg-teal-100 text-teal-800",
    grabfood: "bg-orange-100 text-orange-800",
    // Blue rather than amber: amber resolves to orange here and would have been
    // indistinguishable from grabfood. Market checkout is also the one source
    // that is ours rather than a third party, so primary blue fits.
    market_checkout: "bg-blue-100 text-blue-800",
  };
  return classes[source] || "bg-gray-100 text-gray-800";
};

const getSourceText = (source: string) => {
  const texts: Record<string, string> = {
    uber_eats: "Uber Eats",
    foodpanda: "Foodpanda",
    grabfood: "GrabFood",
    market_checkout: t("orders.source.marketCheckout"),
    direct: t("orders.source.direct"),
  };
  return texts[source] || source;
};
const getMenuItemName = (item: OrderItem) =>
  item.menuItem?.name || `#${item.menuItemId}`;

const navigateToMenuItem = (item: OrderItem) => {
  if (item.menuItemId) {
    selectedOrder.value = null;
    router.push({
      path: "/dashboard/menu",
      query: { highlightItem: String(item.menuItemId) },
    });
  }
};

// 計算屬性
const stats = ref({ pending: 0, preparing: 0, completed: 0, cancelled: 0 });

const selectedFulfillmentType = () =>
  typeFilter.value
    ? (typeFilter.value as "dine_in" | "takeaway" | "delivery")
    : undefined;

const filteredOrders = computed(() => {
  return ([...orderStore.orders] as Order[]).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
});

// 虛擬滾動配置
const ITEM_HEIGHT = 52;
const CONTAINER_HEIGHT = 500;

const {
  containerRef: _containerRef,
  visibleItems,
  totalHeight,
  offsetY,
  handleScroll,
} = useVirtualScroll<Order>(filteredOrders, {
  itemHeight: ITEM_HEIGHT,
  buffer: 5,
  containerHeight: CONTAINER_HEIGHT,
});

const STATS_ROLES = [0, 1];

const refreshOrderStats = async () => {
  const role = authStore.user?.role;
  if (role === undefined || !STATS_ROLES.includes(role)) return;

  try {
    const response = await api.get<{
      pendingOrders: number;
      preparingOrders: number;
      completedOrders: number;
      cancelledOrders: number;
    }>("/orders/stats");
    const data = response.data.data;
    if (!data) return;
    stats.value = {
      pending: data.pendingOrders ?? 0,
      preparing: data.preparingOrders ?? 0,
      completed: data.completedOrders ?? 0,
      cancelled: data.cancelledOrders ?? 0,
    };
  } catch (error) {
    console.error("Failed to load order statistics:", error);
  }
};

// 方法
const refreshOrders = async () => {
  isLoading.value = true;
  try {
    await orderStore.fetchOrders({
      page: 1,
      limit: 20,
      status: statusFilter.value
        ? [statusFilter.value as OrderStatus]
        : undefined,
      fulfillmentType: selectedFulfillmentType(),
      orderSource: sourceFilter.value || undefined,
      search: searchQuery.value.trim() || undefined,
    });
    // The stat cards are a supplement to the list, so a failure here must not
    // take the page down with it. GET /orders/stats is requireRole([0, 1])
    // while this screen is also routed for roles 2-4, so a 403 is expected
    // rather than exceptional -- leave the cards at zero and keep the orders
    // visible instead of rejecting out of refreshOrders().
    await refreshOrderStats();
  } finally {
    isLoading.value = false;
  }
};

const goToPage = async (page: number) => {
  await orderStore.fetchOrders({
    page,
    limit: orderStore.pagination.limit,
    status: statusFilter.value
      ? [statusFilter.value as OrderStatus]
      : undefined,
    fulfillmentType: selectedFulfillmentType(),
    orderSource: sourceFilter.value || undefined,
    search: searchQuery.value.trim() || undefined,
  });
};

// POST /payments/refund is requireRole([0, 1, 4]), but /dashboard/orders is
// also routed for role 3 (送菜員). Without the role check the button rendered
// for them and every click was a guaranteed 403 -- the same defect class this
// screen was just fixed for on the 更新 button.
const REFUND_ROLES = [0, 1, 4];

const canRefund = (order: Order) => {
  const role = authStore.user?.role;
  return (
    order.status === "paid" &&
    Boolean(order.paymentTransactionId) &&
    role !== undefined &&
    REFUND_ROLES.includes(role)
  );
};

const refundOrder = async (order: Order) => {
  if (!order.paymentTransactionId) return;

  // A refund is terminal -- RefundService.processRefund completes it
  // synchronously and nothing in this UI can reverse it. Every other
  // money-adjacent action here confirms first.
  const confirmed = await confirmModal({
    type: "danger",
    title: t("orders.actions.refund"),
    message: t("orders.confirms.refundOrder", {
      number: getOrderNumber(order),
    }),
    confirmLabel: t("orders.confirms.refundOrderConfirm"),
  });
  if (!confirmed) return;

  try {
    await api.post("/payments/refund", {
      transactionId: order.paymentTransactionId,
      reason: `Refund requested from order ${getOrderNumber(order)}`,
    });
    await refreshOrders();
  } catch (error) {
    // `error` is the raw AxiosError, whose .message is "Request failed with
    // status code 404" -- useless to a shop owner. Resolve the server's code
    // to a translated sentence instead.
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "orders.refundFailed",
      }).message,
    );
  }
};

watch([searchQuery, statusFilter, typeFilter, sourceFilter], () => {
  void refreshOrders();
});

const viewOrderDetails = (order: Order) => {
  selectedOrder.value = order;
  // Opening a different order must not inherit the previous one's edit mode.
  isEditingItems.value = false;
};

const updateOrderStatus = async (order: Order) => {
  const nextStatus = getNextStatus(order.status);
  if (nextStatus) {
    const success = await orderStore.updateOrderStatus(
      order.id,
      nextStatus as OrderStatus,
    );
    if (!success) {
      toast.error(orderStore.error || t("orders.updateFailed"));
      return;
    }
    // The stat cards are a restaurant-wide aggregate from the server, so
    // advancing an order changes them. The store only patches the row it
    // holds, which would leave 待處理 showing the pre-confirm count until the
    // next filter change.
    await refreshOrderStats();
  }
};

const cancelOrder = async (order: Order) => {
  const confirmed = await confirmModal({
    type: "danger",
    // The dismiss button is labelled 取消 by the modal itself, so titling the
    // dialog and its confirm button with orders.actions.cancel ("取消") too put
    // three identical labels on screen -- nothing but colour told the owner
    // which 取消 aborted the dialog and which cancelled the order.
    title: t("orders.confirms.cancelOrderTitle"),
    message: t("orders.confirms.cancelOrder", {
      number: getOrderNumber(order),
    }),
    confirmLabel: t("orders.confirms.cancelOrderConfirm"),
  });
  if (!confirmed) return;
  await orderStore.cancelOrder(order.id);
  await refreshOrders();
};

const canUpdateStatus = (status: string) => {
  const nextStatus = getNextStatus(status) as OrderStatus | null;
  const role = authStore.user?.role;
  return (
    nextStatus !== null &&
    role !== undefined &&
    Boolean(ROLE_STATUS_PERMISSIONS[role]?.includes(nextStatus))
  );
};

// Two things this used to get wrong, both of the same shape as the 更新 and
// 退款 buttons before they were fixed: it decided on its own what the server
// would accept, and it did not ask whether this role may cancel at all.
//
// The status list came from a hardcoded ["pending", "confirmed"] while the
// server's machine also allows preparing -> cancelled and ready -> cancelled.
// A customer who leaves once the kitchen has started left the owner no button,
// and the only remaining move was to push the order forward to paid -- which
// records revenue that never arrived and is terminal (#310). Deriving it from
// CANCELLABLE_ORDER_STATUSES means the button cannot narrow on its own again.
//
// The role check is the other half: ROLE_STATUS_PERMISSIONS grants "cancelled"
// to admin and owner only, but /dashboard/orders is also routed for chef,
// service crew and cashier. Without it the button rendered for all of them and
// every click was a guaranteed 403.
const canCancel = (status: string) => {
  const role = authStore.user?.role;
  return (
    CANCELLABLE_ORDER_STATUSES.includes(status) &&
    role !== undefined &&
    Boolean(ROLE_STATUS_PERMISSIONS[role]?.includes("cancelled"))
  );
};

const getNextStatus = (currentStatus: string) => {
  const statusFlow: Record<string, string> = {
    pending: "confirmed",
    confirmed: "preparing",
    preparing: "ready",
    ready: "delivered",
  };
  return statusFlow[currentStatus] || null;
};

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    // Eight statuses on five hues, so the chain separates by depth as well as
    // hue: pending is the lightest orange and ready the full one (ready is the
    // state that needs someone to act), preparing the lighter teal and
    // delivered the deeper. Before this, yellow/amber collapsed onto orange and
    // purple onto teal, which made pending look like ready and preparing look
    // like delivered.
    pending: "bg-orange-100 text-orange-800",
    confirmed: "bg-blue-100 text-blue-800",
    preparing: "bg-teal-100 text-teal-800",
    ready: "bg-orange-200 text-orange-900",
    delivered: "bg-teal-200 text-teal-900",
    paid: "bg-green-100 text-green-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
};

const getStatusText = (status: string) => {
  const texts: Record<string, string> = {
    pending: t("orders.status.pending"),
    confirmed: t("orders.status.confirmed"),
    preparing: t("orders.status.preparing"),
    ready: t("orders.status.ready"),
    delivered: t("orders.status.delivered"),
    paid: t("orders.status.paid"),
    refunded: t("orders.status.refunded"),
    cancelled: t("orders.status.cancelled"),
  };
  return texts[status] || status;
};

const getTypeClass = (type: string) => {
  const classes: Record<string, string> = {
    dine_in: "bg-blue-100 text-blue-800",
    takeaway: "bg-green-100 text-green-800",
    delivery: "bg-teal-100 text-teal-800",
  };
  return classes[type] || "bg-gray-100 text-gray-800";
};

const getTypeText = (type: string) => {
  const texts: Record<string, string> = {
    dine_in: t("orders.type.dineIn"),
    takeaway: t("orders.type.takeaway"),
    delivery: t("orders.type.delivery"),
  };
  return texts[type] || type;
};

// 生命周期
onMounted(() => {
  refreshOrders();
});
</script>

<style scoped>
.orders-view {
  padding: 1rem;
}

@media (min-width: 1024px) {
  .orders-view {
    padding: 1.5rem;
  }
}
</style>
