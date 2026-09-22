<template>
  <div class="service-view">
    <!-- 送菜員控制台標題 -->
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-gray-900">
          {{ t("serviceView.title") }}
        </h1>
        <p class="text-gray-600">{{ t("serviceView.subtitle") }}</p>
      </div>
      <div class="flex items-center space-x-4">
        <!-- 個人績效 -->
        <div class="bg-green-100 px-4 py-2 rounded-lg">
          <p class="text-sm text-green-800 font-medium">
            {{ t("serviceView.todayDelivered") }}: {{ todayDelivered
            }}{{ t("serviceView.orders") }}
          </p>
          <p class="text-xs text-green-600">
            {{ t("serviceView.efficiency") }}: {{ deliveryEfficiency }}%
          </p>
        </div>

        <!-- 當前時間 -->
        <div class="text-right">
          <p class="text-sm text-gray-500">
            {{ t("serviceView.currentTime") }}
          </p>
          <p class="text-lg font-semibold">
            {{ currentTime }}
          </p>
        </div>

        <!-- 刷新按鈕 -->
        <button
          class="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          @click="refreshOrders"
        >
          <ArrowPathIcon class="h-4 w-4 mr-2" />
          {{ t("serviceView.refresh") }}
        </button>
      </div>
    </div>

    <!-- 快速狀態總覽 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <div class="bg-orange-100 rounded-lg p-6 border-l-4 border-orange-500">
        <div class="flex items-center">
          <TruckIcon class="h-8 w-8 text-orange-600 mr-3" />
          <div>
            <p class="text-sm font-medium text-orange-800">
              {{ t("serviceView.readyForDelivery") }}
            </p>
            <p class="text-2xl font-bold text-orange-900">
              {{ orderStats.readyForDelivery }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-blue-100 rounded-lg p-6 border-l-4 border-blue-500">
        <div class="flex items-center">
          <MapIcon class="h-8 w-8 text-blue-600 mr-3" />
          <div>
            <p class="text-sm font-medium text-blue-800">
              {{ t("serviceView.delivering") }}
            </p>
            <p class="text-2xl font-bold text-blue-900">
              {{ orderStats.delivering }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-green-100 rounded-lg p-6 border-l-4 border-green-500">
        <div class="flex items-center">
          <CheckCircleIcon class="h-8 w-8 text-green-600 mr-3" />
          <div>
            <p class="text-sm font-medium text-green-800">
              {{ t("serviceView.delivered") }}
            </p>
            <p class="text-2xl font-bold text-green-900">
              {{ orderStats.delivered }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-teal-100 rounded-lg p-6 border-l-4 border-teal-500">
        <div class="flex items-center">
          <ClockIcon class="h-8 w-8 text-teal-600 mr-3" />
          <div>
            <p class="text-sm font-medium text-teal-800">
              {{ t("serviceView.avgDeliveryTime") }}
            </p>
            <p class="text-2xl font-bold text-teal-900">
              {{ avgDeliveryTime }}{{ t("serviceView.minutes") }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 主要工作區域 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- 左側：待配送訂單 -->
      <div class="lg:col-span-2">
        <div class="bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-gray-900">
                {{ t("serviceView.pendingOrders") }}
              </h2>
              <div class="flex items-center space-x-3">
                <!-- 桌台篩選 -->
                <select
                  v-model="selectedTable"
                  class="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{{ t("serviceView.allTables") }}</option>
                  <option
                    v-for="table in availableTables"
                    :key="table"
                    :value="table"
                  >
                    {{ t("serviceView.tableNumber", { number: table }) }}
                  </option>
                </select>

                <!-- 優先級篩選 -->
                <select
                  v-model="selectedPriority"
                  class="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{{ t("serviceView.allPriority") }}</option>
                  <option value="high">
                    {{ t("serviceView.priority.high") }}
                  </option>
                  <option value="normal">
                    {{ t("serviceView.priority.normal") }}
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div class="divide-y divide-gray-200">
            <div
              v-for="order in filteredOrders"
              :key="order.id"
              class="p-6 hover:bg-gray-50 transition-colors"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <!-- 訂單標題 -->
                  <div class="flex items-center mb-3">
                    <div class="flex items-center">
                      <div
                        :class="
                          getStatusIconClass(order.localPhase ?? order.status)
                        "
                        class="p-2 rounded-full mr-3"
                      >
                        <component
                          :is="getStatusIcon(order.localPhase ?? order.status)"
                          class="h-5 w-5"
                        />
                      </div>
                      <div>
                        <h3 class="text-lg font-bold text-gray-900">
                          {{ order.orderNumber }}
                        </h3>
                        <p class="text-sm text-gray-600">
                          {{
                            ["table", "seat"].includes(order.orderType)
                              ? t("serviceView.tableNumber", {
                                  number: order.tableNumber,
                                })
                              : t("serviceView.takeawayDelivery")
                          }}
                        </p>
                      </div>
                    </div>
                    <div class="ml-4 flex items-center space-x-2">
                      <span
                        :class="getPriorityBadgeClass(order.priority)"
                        class="px-2 py-1 rounded-full text-xs font-medium"
                      >
                        {{ getPriorityText(order.priority) }}
                      </span>
                      <span class="text-xs text-gray-500">{{
                        getTimeElapsed(order.readyAt)
                      }}</span>
                    </div>
                  </div>

                  <!-- 訂單項目 -->
                  <div class="bg-gray-50 rounded-lg p-3 mb-3">
                    <div class="space-y-2">
                      <div
                        v-for="item in order.items"
                        :key="item.id"
                        class="flex items-center justify-between text-sm"
                      >
                        <div class="flex items-center">
                          <span
                            class="flex items-center justify-center w-6 h-6 bg-blue-100 text-blue-800 rounded-full font-semibold text-xs mr-2"
                          >
                            {{ item.quantity }}
                          </span>
                          <span class="font-medium">{{
                            item.menuItemName
                          }}</span>
                          <div
                            v-if="item.specialInstructions"
                            class="ml-2 text-orange-600"
                          >
                            <ExclamationTriangleIcon
                              class="w-4 h-4 inline mr-1"
                            />
                            <span class="text-xs">{{
                              item.specialInstructions
                            }}</span>
                          </div>
                        </div>
                        <div
                          v-if="
                            item.customizations &&
                            Object.keys(item.customizations).length > 0
                          "
                          class="flex flex-wrap gap-1"
                        >
                          <span
                            v-for="(value, key) in item.customizations"
                            :key="key"
                            class="inline-block px-1 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded"
                          >
                            {{ key }}: {{ value }}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 客戶信息 -->
                  <div
                    v-if="order.customerInfo"
                    class="text-sm text-gray-600 mb-3"
                  >
                    <div class="flex items-center">
                      <UserIcon class="w-4 h-4 mr-1" />
                      <span>{{ order.customerInfo.name }}</span>
                      <span v-if="order.customerInfo.phone" class="ml-2">
                        | 📱 {{ order.customerInfo.phone }}
                      </span>
                    </div>
                  </div>

                  <!-- 特殊要求 -->
                  <div
                    v-if="order.deliveryNotes"
                    class="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3"
                  >
                    <div class="flex items-start">
                      <ExclamationCircleIcon
                        class="w-4 h-4 text-yellow-600 mr-2 mt-0.5 flex-shrink-0"
                      />
                      <p class="text-sm text-yellow-800">
                        {{ order.deliveryNotes }}
                      </p>
                    </div>
                  </div>
                </div>

                <!-- 操作按鈕 -->
                <div class="ml-6 flex flex-col space-y-2">
                  <button
                    v-if="order.status === 'ready' && !order.localPhase"
                    class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm whitespace-nowrap"
                    @click="startDelivery(order)"
                  >
                    {{ t("serviceView.startDelivery") }}
                  </button>
                  <button
                    v-else-if="
                      order.localPhase === 'delivering' &&
                      order.assignedTo === String(authStore.user?.id)
                    "
                    class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm whitespace-nowrap"
                    @click="completeDelivery(order)"
                  >
                    {{ t("serviceView.confirmDelivery") }}
                  </button>

                  <!-- 輔助按鈕 -->
                  <button
                    class="px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors text-xs"
                    @click="contactCustomer(order)"
                  >
                    {{ t("serviceView.contactCustomer") }}
                  </button>
                  <button
                    class="px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors text-xs"
                    @click="reportIssue(order)"
                  >
                    {{ t("serviceView.reportIssue") }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 空狀態 -->
            <div v-if="filteredOrders.length === 0" class="p-12 text-center">
              <CheckCircleIcon class="mx-auto h-16 w-16 text-gray-400 mb-4" />
              <h3 class="text-xl font-medium text-gray-900 mb-2">
                {{ t("serviceView.noOrders") }}
              </h3>
              <p class="text-gray-500">{{ t("serviceView.allDelivered") }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側：今日配送記錄和個人統計 -->
      <div class="space-y-6">
        <!-- 配送中的訂單 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("serviceView.myDeliveries") }} ({{
                myActiveDeliveries.length
              }})
            </h3>

            <div v-if="myActiveDeliveries.length > 0" class="space-y-3">
              <div
                v-for="delivery in myActiveDeliveries"
                :key="delivery.id"
                class="flex items-center justify-between p-3 bg-blue-50 rounded-lg"
              >
                <div>
                  <p class="font-medium text-gray-900">
                    {{ delivery.orderNumber }}
                  </p>
                  <p class="text-sm text-gray-600">
                    {{
                      t("serviceView.tableNumber", {
                        number: delivery.tableNumber,
                      })
                    }}
                  </p>
                  <p class="text-xs text-blue-600">
                    {{ t("serviceView.startTime") }}:
                    {{ formatClockTime(delivery.deliveryStartTime) }}
                  </p>
                </div>
                <div class="text-right">
                  <p class="text-sm font-medium text-blue-800">
                    {{ getDeliveryDuration(delivery.deliveryStartTime) }}
                  </p>
                  <button
                    class="mt-1 px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 transition-colors"
                    @click="completeDelivery(delivery)"
                  >
                    {{ t("serviceView.delivered") }}
                  </button>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-6">
              <TruckIcon class="mx-auto h-8 w-8 text-gray-400 mb-2" />
              <p class="text-gray-500 text-sm">
                {{ t("serviceView.noActiveDeliveries") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 今日個人績效 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("serviceView.todayPerformance") }}
            </h3>

            <div class="space-y-4">
              <!-- 績效指標 -->
              <div class="grid grid-cols-2 gap-4">
                <div class="text-center p-3 bg-green-50 rounded">
                  <p class="text-sm text-green-600">
                    {{ t("serviceView.completedDeliveries") }}
                  </p>
                  <p class="text-2xl font-bold text-green-800">
                    {{ todayStats.completed }}
                  </p>
                </div>
                <div class="text-center p-3 bg-blue-50 rounded">
                  <p class="text-sm text-blue-600">
                    {{ t("serviceView.avgTime") }}
                  </p>
                  <p class="text-2xl font-bold text-blue-800">
                    {{ todayStats.avgTime }}{{ t("serviceView.minutes") }}
                  </p>
                </div>
              </div>

              <!-- 效率進度條 -->
              <div>
                <div class="flex justify-between text-sm mb-1">
                  <span class="text-gray-600">{{
                    t("serviceView.serviceEfficiency")
                  }}</span>
                  <span class="font-medium">{{ deliveryEfficiency }}%</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div
                    class="h-2 rounded-full transition-all duration-300"
                    :class="
                      deliveryEfficiency >= 90
                        ? 'bg-green-500'
                        : deliveryEfficiency >= 70
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    "
                    :style="{ width: `${deliveryEfficiency}%` }"
                  />
                </div>
              </div>
            </div>

            <!-- 今日時間軸 -->
            <div class="mt-6">
              <h4 class="text-sm font-medium text-gray-900 mb-3">
                {{ t("serviceView.todayTimeline") }}
              </h4>
              <div class="space-y-2 max-h-48 overflow-y-auto">
                <div
                  v-for="record in todayDeliveryRecords"
                  :key="record.id"
                  class="flex items-center text-sm"
                >
                  <div class="w-2 h-2 bg-green-500 rounded-full mr-3" />
                  <span class="text-gray-600 text-xs">{{
                    record.completedAt
                  }}</span>
                  <span class="ml-2 font-medium">{{ record.orderNumber }}</span>
                  <span class="ml-auto text-gray-500 text-xs"
                    >{{ record.duration }}{{ t("serviceView.minutes") }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 聯絡客戶模態框 -->
    <div v-if="showContactDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeContactDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("serviceView.contactCustomer") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeContactDialog"
            >
              <XMarkIcon class="w-5 h-5" />
            </button>
          </div>

          <div v-if="selectedOrderForContact" class="space-y-4">
            <div>
              <p class="text-sm text-gray-600">
                {{ t("serviceView.orderNumber") }}
              </p>
              <p class="font-medium">
                {{ selectedOrderForContact.orderNumber }}
              </p>
            </div>

            <div v-if="selectedOrderForContact.customerInfo">
              <p class="text-sm text-gray-600">
                {{ t("serviceView.customerInfo") }}
              </p>
              <p class="font-medium">
                {{ selectedOrderForContact.customerInfo.name }}
              </p>
              <p
                v-if="selectedOrderForContact.customerInfo.phone"
                class="text-sm text-gray-500"
              >
                📱 {{ selectedOrderForContact.customerInfo.phone }}
              </p>
            </div>

            <div class="flex space-x-2">
              <button
                class="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                @click="makePhoneCall"
              >
                {{ t("serviceView.makeCall") }}
              </button>
              <button
                class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                @click="sendMessage"
              >
                {{ t("serviceView.sendMessage") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 問題回報模態框 -->
    <div v-if="showIssueDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeIssueDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("serviceView.reportIssue") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeIssueDialog"
            >
              <XMarkIcon class="w-5 h-5" />
            </button>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{
                t("serviceView.issueType")
              }}</label>
              <select
                v-model="issueData.type"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{{ t("serviceView.selectIssueType") }}</option>
                <option value="wrong_order">
                  {{ t("serviceView.issues.wrongOrder") }}
                </option>
                <option value="missing_items">
                  {{ t("serviceView.issues.missingItems") }}
                </option>
                <option value="quality_issue">
                  {{ t("serviceView.issues.qualityIssue") }}
                </option>
                <option value="customer_unavailable">
                  {{ t("serviceView.issues.customerUnavailable") }}
                </option>
                <option value="access_issue">
                  {{ t("serviceView.issues.accessIssue") }}
                </option>
                <option value="other">
                  {{ t("serviceView.issues.other") }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{{
                t("serviceView.issueDescription")
              }}</label>
              <textarea
                v-model="issueData.description"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('serviceView.issueDescPlaceholder')"
              />
            </div>

            <div class="flex justify-end space-x-3">
              <button
                class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
                @click="closeIssueDialog"
              >
                {{ t("serviceView.cancel") }}
              </button>
              <button
                :disabled="!issueData.type || !issueData.description"
                class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                @click="submitIssue"
              >
                {{ t("serviceView.submitIssue") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  type Component,
} from "vue";
import {
  ArrowPathIcon,
  TruckIcon,
  MapIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useAuthStore } from "@/stores/auth";
import { api, unwrapApiData } from "@/services/api";
import type {
  Order as ApiOrder,
  OrderItem as ApiOrderItem,
} from "@makanmasak/shared-types";

const { t } = useI18n();
const { formatTime, formatTimeWithSeconds } = useDateFormatter();
const authStore = useAuthStore();

// Type definitions
interface ServiceCustomerInfo {
  name: string;
  phone: string;
}

interface ServiceOrderItem extends ApiOrderItem {
  menuItemName: string;
  specialInstructions?: string;
}

interface ServiceOrder {
  id: string;
  orderNumber: string;
  tableNumber: string;
  orderType: NonNullable<ApiOrder["orderType"]>;
  status: ApiOrder["status"];
  localPhase?: "delivering";
  priority: string;
  readyAt: number;
  deliveryStartTime?: string | number | null;
  customerInfo: ServiceCustomerInfo;
  deliveryNotes?: string;
  assignedTo?: string;
  deliveredAt?: string | number | null;
  items: ServiceOrderItem[];
}

// 響應式數據
const currentTime = ref("");
const selectedTable = ref("");
const selectedPriority = ref("");
const todayDelivered = ref(0);
const deliveryEfficiency = ref(0);
const avgDeliveryTime = ref(0);

// 模態框狀態
const showContactDialog = ref(false);
const showIssueDialog = ref(false);
const selectedOrderForContact = ref<ServiceOrder | null>(null);

// 問題回報數據
const issueData = ref<{
  orderId: string | null;
  type: string;
  description: string;
}>({
  orderId: null,
  type: "",
  description: "",
});

let timeInterval: NodeJS.Timeout | null = null;
// ponytail: polls every 15s because ServiceLayout opens no realtime socket;
// subscribe to ORDER_STATUS_UPDATE instead once it does.
const ORDER_POLL_MS = 15_000;
let orderPoll: NodeJS.Timeout | null = null;

// 訂單數據 - fetched from API
const orders = ref<ServiceOrder[]>([]);

// 「配送中」是這台裝置上的本地標記,不是訂單狀態——伺服器只認 ORDER_STATUSES 的
// 八個值。存進 sessionStorage,讓重新整理清單或重載頁面都不會把送菜員手上的單洗掉。
const DELIVERY_PHASE_STORAGE_KEY_PREFIX = "service-view:delivery-phase";

interface LocalDeliveryPhase {
  deliveryStartTime: string;
  assignedTo: string;
}

function getDeliveryPhaseStorageKey(): string | null {
  const restaurantId = authStore.restaurantId;
  const userId = authStore.user?.id;
  if (restaurantId == null || restaurantId === "" || userId == null) {
    return null;
  }

  return `${DELIVERY_PHASE_STORAGE_KEY_PREFIX}:${encodeURIComponent(
    String(restaurantId),
  )}:${encodeURIComponent(String(userId))}`;
}

function readStoredDeliveryPhases(
  storageKey = getDeliveryPhaseStorageKey(),
): Record<string, LocalDeliveryPhase> {
  if (!storageKey) return {};

  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const restored: Record<string, LocalDeliveryPhase> = {};
    for (const [id, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const phase = value as Partial<LocalDeliveryPhase> | null;
      if (typeof phase?.deliveryStartTime !== "string") continue;
      restored[id] = {
        deliveryStartTime: phase.deliveryStartTime,
        assignedTo:
          typeof phase.assignedTo === "string" ? phase.assignedTo : "",
      };
    }
    return restored;
  } catch {
    // Private-mode browsers throw on access; a lost phase is recoverable.
    return {};
  }
}

let loadedDeliveryPhaseStorageKey = getDeliveryPhaseStorageKey();
const localDeliveryPhases = ref<Record<string, LocalDeliveryPhase>>(
  readStoredDeliveryPhases(loadedDeliveryPhaseStorageKey),
);

function syncDeliveryPhasesWithAuthenticatedSession() {
  const storageKey = getDeliveryPhaseStorageKey();
  if (storageKey === loadedDeliveryPhaseStorageKey) return false;

  loadedDeliveryPhaseStorageKey = storageKey;
  localDeliveryPhases.value = readStoredDeliveryPhases(storageKey);
  // Do not leave an earlier session's delivery actions usable while its
  // replacement list is loading.
  orders.value = [];
  return true;
}

function persistDeliveryPhases() {
  const storageKey = getDeliveryPhaseStorageKey();
  if (!storageKey) return;

  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify(localDeliveryPhases.value),
    );
  } catch {
    // Keeping the in-memory phase is still better than dropping it.
  }
}

// 伺服器不再列為 ready 的單(已送達或已取消)留著只會讓 key 無限累積。
function pruneDeliveryPhases(readyOrderIds: string[]) {
  const stillReady = new Set(readyOrderIds);
  let changed = false;
  for (const id of Object.keys(localDeliveryPhases.value)) {
    if (!stillReady.has(id)) {
      delete localDeliveryPhases.value[id];
      changed = true;
    }
  }
  if (changed) persistDeliveryPhases();
}

function isCompleteReadyOrderResponse(response: { data: unknown }) {
  const payload = response.data;
  if (!payload || typeof payload !== "object") return false;

  const pagination = (payload as { pagination?: unknown }).pagination;
  if (!pagination || typeof pagination !== "object") return false;

  const totalPages = (pagination as { totalPages?: unknown }).totalPages;
  return typeof totalPages === "number" && totalPages <= 1;
}

// 今日配送記錄 - populated from delivered orders
const todayDeliveryRecords = ref<
  Array<{
    id: string;
    orderNumber: string;
    completedAt: string;
    duration: number;
  }>
>([]);

// 計算屬性
const orderStats = computed(() => ({
  readyForDelivery: orders.value.filter(
    (o) => o.status === "ready" && !o.localPhase,
  ).length,
  delivering: orders.value.filter((o) => o.localPhase === "delivering").length,
  delivered: orders.value.filter((o) => o.status === "delivered").length,
}));

const availableTables = computed(() => {
  const tables = new Set(
    orders.value.map((o) => o.tableNumber).filter(Boolean),
  );
  return Array.from(tables).sort();
});

const filteredOrders = computed(() => {
  let filtered = orders.value.filter(
    (o) => o.status === "ready" || o.localPhase === "delivering",
  );

  if (selectedTable.value) {
    filtered = filtered.filter((o) => o.tableNumber === selectedTable.value);
  }

  if (selectedPriority.value) {
    filtered = filtered.filter((o) => o.priority === selectedPriority.value);
  }

  // 按優先級和時間排序
  return filtered.sort((a, b) => {
    // 優先級排序
    if (a.priority === "high" && b.priority !== "high") return -1;
    if (b.priority === "high" && a.priority !== "high") return 1;
    // 時間排序
    return new Date(a.readyAt).getTime() - new Date(b.readyAt).getTime();
  });
});

const myActiveDeliveries = computed(() => {
  const userId = String(authStore.user?.id || "current_user");
  return orders.value.filter(
    (o) => o.localPhase === "delivering" && o.assignedTo === userId,
  );
});

const todayStats = computed(() => ({
  completed: todayDelivered.value,
  avgTime: avgDeliveryTime.value,
}));

// 方法
const updateCurrentTime = () => {
  currentTime.value = formatTimeWithSeconds(new Date());
};

const refreshOrders = async () => {
  try {
    // Auth may hydrate after this view is created, or change without a reload.
    syncDeliveryPhasesWithAuthenticatedSession();

    // Delivery in progress is local to this device, so only fetch server-ready orders.
    const response = await api.get("/orders", {
      status: "ready",
      restaurantId: authStore.restaurantId,
    });
    const data = unwrapApiData<ApiOrder[]>(response);
    if (Array.isArray(data)) {
      // `/orders` is paginated. Only an explicitly single-page response proves
      // that a locally tracked order has left the server's ready set.
      if (isCompleteReadyOrderResponse(response)) {
        pruneDeliveryPhases(data.map((order) => String(order.id)));
      }
      orders.value = data.map((order) => {
        // The rebuilt row would otherwise drop the phase this device is
        // holding, sending an in-progress delivery back to「開始配送」.
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          tableNumber: order.table?.number ?? "",
          orderType: order.orderType ?? "table",
          status: order.status,
          localPhase: order.deliveryAssignedTo
            ? ("delivering" as const)
            : undefined,
          deliveryStartTime: order.deliveryStartTime,
          assignedTo: order.deliveryAssignedTo ?? undefined,
          priority: "normal",
          readyAt: order.readyAt ?? order.updatedAt,
          customerInfo: {
            name: order.customerInfo?.name ?? order.customer?.fullName ?? "",
            phone: order.customerInfo?.phone ?? order.customer?.phone ?? "",
          },
          deliveryNotes: order.notes ?? "",
          items: (order.items ?? []).map((item) => ({
            ...item,
            menuItemName: item.itemSnapshot?.name ?? item.menuItem?.name ?? "",
            specialInstructions: item.customizations?.specialInstructions,
          })),
        };
      });
    }

    // Also fetch today's delivered orders for the timeline
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const deliveredResponse = await api.get("/orders", {
      status: "delivered",
      restaurantId: authStore.restaurantId,
      dateFrom: todayStart.toISOString(),
    });
    const deliveredData = unwrapApiData<ApiOrder[]>(deliveredResponse);
    if (Array.isArray(deliveredData)) {
      todayDelivered.value = deliveredData.length;
      todayDeliveryRecords.value = deliveredData.map((order) => {
        const completedAt = order.deliveredAt ?? order.updatedAt;
        const startTime = order.readyAt ?? order.createdAt;
        const duration =
          completedAt && startTime
            ? Math.round(
                (new Date(completedAt).getTime() -
                  new Date(startTime).getTime()) /
                  (1000 * 60),
              )
            : 0;
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          completedAt: formatClockTime(completedAt) || "-",
          duration,
        };
      });

      // Calculate avg delivery time
      if (todayDeliveryRecords.value.length > 0) {
        const totalDuration = todayDeliveryRecords.value.reduce(
          (sum, r) => sum + r.duration,
          0,
        );
        avgDeliveryTime.value = Math.round(
          totalDuration / todayDeliveryRecords.value.length,
        );
      }

      // Calculate efficiency (on-time percentage estimate)
      deliveryEfficiency.value =
        todayDelivered.value > 0
          ? Math.min(
              100,
              Math.round(
                (todayDeliveryRecords.value.filter((r) => r.duration <= 10)
                  .length /
                  todayDelivered.value) *
                  100,
              ),
            )
          : 0;
    }
  } catch (err) {
    console.error("Failed to refresh orders:", err);
  }
};

watch(getDeliveryPhaseStorageKey, (storageKey, previousStorageKey) => {
  if (storageKey === previousStorageKey) return;
  if (syncDeliveryPhasesWithAuthenticatedSession() && storageKey) {
    void refreshOrders();
  }
});

const startDelivery = async (order: ServiceOrder) => {
  try {
    const response = await api.post(`/orders/${order.id}/delivery-claim`);
    const claimed = unwrapApiData<ApiOrder>(response);
    const index = orders.value.findIndex(
      (candidate) => candidate.id === order.id,
    );
    if (index > -1 && claimed) {
      orders.value[index].localPhase = "delivering";
      orders.value[index].deliveryStartTime = claimed.deliveryStartTime;
      orders.value[index].assignedTo = claimed.deliveryAssignedTo ?? undefined;
    }
  } catch (err) {
    console.error("Failed to claim delivery", err);
    await refreshOrders();
  }
};

const completeDelivery = async (order: ServiceOrder) => {
  try {
    syncDeliveryPhasesWithAuthenticatedSession();

    await api.put(`/orders/${order.id}/status`, {
      status: "delivered",
      notes: `Delivered by service crew`,
    });

    // The server now carries this order's truth, so drop the local phase.
    delete localDeliveryPhases.value[String(order.id)];
    persistDeliveryPhases();

    // Update local state optimistically
    const index = orders.value.findIndex((o) => o.id === order.id);
    if (index > -1) {
      orders.value[index].status = "delivered";
      orders.value[index].localPhase = undefined;
      orders.value[index].deliveredAt = new Date().toISOString();

      // Update statistics
      todayDelivered.value++;

      // Add to today's delivery records
      const duration = order.deliveryStartTime
        ? Math.round(
            (new Date().getTime() -
              new Date(order.deliveryStartTime).getTime()) /
              (1000 * 60),
          )
        : 0;
      todayDeliveryRecords.value.unshift({
        id: `local-${Date.now()}`,
        orderNumber: order.orderNumber,
        completedAt: formatClockTime(new Date()) || "-",
        duration,
      });

      // Recalculate avg delivery time
      if (todayDeliveryRecords.value.length > 0) {
        const totalDuration = todayDeliveryRecords.value.reduce(
          (sum, r) => sum + r.duration,
          0,
        );
        avgDeliveryTime.value = Math.round(
          totalDuration / todayDeliveryRecords.value.length,
        );
      }
    }
  } catch (err) {
    console.error("Complete delivery error:", err);
    // Refresh from server on error
    await refreshOrders();
  }
};

const contactCustomer = (order: ServiceOrder) => {
  selectedOrderForContact.value = order;
  showContactDialog.value = true;
};

const reportIssue = (order: ServiceOrder) => {
  issueData.value.orderId = order.id;
  showIssueDialog.value = true;
};

const closeContactDialog = () => {
  showContactDialog.value = false;
  selectedOrderForContact.value = null;
};

const closeIssueDialog = () => {
  showIssueDialog.value = false;
  issueData.value = {
    orderId: null,
    type: "",
    description: "",
  };
};

const makePhoneCall = () => {
  if (selectedOrderForContact.value?.customerInfo?.phone) {
    const phone = selectedOrderForContact.value.customerInfo.phone;
    window.open(`tel:${phone}`);
  }
  closeContactDialog();
};

const sendMessage = () => {
  if (selectedOrderForContact.value?.customerInfo?.phone) {
    const phone = selectedOrderForContact.value.customerInfo.phone;
    window.open(`sms:${phone}`);
  }
  closeContactDialog();
};

const submitIssue = async () => {
  if (!issueData.value.type || !issueData.value.description) return;

  try {
    // Report issue via API if endpoint exists, otherwise log
    console.log("Issue reported:", {
      orderId: issueData.value.orderId,
      type: issueData.value.type,
      description: issueData.value.description,
    });
  } catch (err) {
    console.error("Failed to submit issue:", err);
  }
  closeIssueDialog();
};

// 輔助方法
const getStatusIcon = (status: string) => {
  const icons: Record<string, Component> = {
    ready: TruckIcon,
    delivering: MapIcon,
    delivered: CheckCircleIcon,
  };
  return icons[status] || TruckIcon;
};

const getStatusIconClass = (status: string) => {
  const classes: Record<string, string> = {
    ready: "bg-orange-100 text-orange-600",
    delivering: "bg-blue-100 text-blue-600",
    delivered: "bg-green-100 text-green-600",
  };
  return classes[status] || "bg-gray-100 text-gray-600";
};

const getPriorityBadgeClass = (priority: string) => {
  return priority === "high"
    ? "bg-red-100 text-red-800"
    : "bg-gray-100 text-gray-600";
};

const getPriorityText = (priority: string) => {
  return priority === "high"
    ? t("serviceView.priority.high")
    : t("serviceView.priority.normal");
};

const getTimeElapsed = (dateTime: string | number) => {
  const now = new Date();
  const time = new Date(dateTime);
  const diffInMinutes = Math.floor(
    (now.getTime() - time.getTime()) / (1000 * 60),
  );

  if (diffInMinutes < 1) return t("serviceView.justReady");
  if (diffInMinutes < 60)
    return t("serviceView.minutesAgo", { minutes: diffInMinutes });
  const hours = Math.floor(diffInMinutes / 60);
  return t("serviceView.hoursAgo", { hours });
};

const getDeliveryDuration = (startTime: string | number | null | undefined) => {
  if (!startTime) return "-";
  const now = new Date();
  const start = new Date(startTime);
  const diffInMinutes = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60),
  );
  return `${diffInMinutes} ${t("serviceView.minutes")}`;
};

// Keeps the null/empty guard; also converts ISO strings to a Date because
// formatTime treats a bare string as an "HH:mm" time-of-day, not a datetime.
const formatClockTime = (
  dateTime: string | number | Date | null | undefined,
) => {
  if (!dateTime) return "-";
  const date = typeof dateTime === "string" ? new Date(dateTime) : dateTime;
  return formatTime(date);
};

// getIssueTypeText is available for future use in issue display
void function getIssueTypeText(type: string) {
  const types: Record<string, string> = {
    wrong_order: t("serviceView.issues.wrongOrder"),
    missing_items: t("serviceView.issues.missingItems"),
    quality_issue: t("serviceView.issues.qualityIssue"),
    customer_unavailable: t("serviceView.issues.customerUnavailable"),
    access_issue: t("serviceView.issues.accessIssue"),
    other: t("serviceView.issues.other"),
  };
  return types[type] || type;
};

// 生命週期
onMounted(async () => {
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);

  // Fetch orders from API
  await refreshOrders();
  orderPoll = setInterval(() => void refreshOrders(), ORDER_POLL_MS);
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
  if (orderPoll) clearInterval(orderPoll);
});
</script>

<style scoped>
.service-view {
  padding: 1.5rem;
  min-height: 100vh;
  background-color: #f9fafb;
}

@media (max-width: 640px) {
  .service-view {
    padding: 1rem;
  }
}
</style>
