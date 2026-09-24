<template>
  <div>
    <!-- Action Bar -->
    <div class="flex items-center justify-end gap-3 mb-6">
      <button
        class="flex items-center px-4 py-2.5 rounded-full text-[13px] font-semibold bg-white text-ios-text/70 border border-ios-bg hover:bg-ios-bg transition-colors"
        @click="showSettings = true"
      >
        <Settings class="w-4 h-4 mr-1.5" />
        {{ t("queue.queueSettings") }}
      </button>
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        @click="callNextCustomer"
      >
        <Bell class="w-4 h-4 mr-1.5" />
        {{ t("queue.callNext") }}
      </button>
    </div>

    <!-- 主要內容區域 -->
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-8">
      <!-- 左側：候位列表 -->
      <div class="lg:col-span-2">
        <div class="bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-gray-900">
                {{ t("queue.queueList") }}
              </h2>
              <div class="flex items-center space-x-4">
                <!-- 篩選器 -->
                <select
                  v-model="queueFilter"
                  class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{{ t("queue.filterAll") }}</option>
                  <option value="waiting">
                    {{ t("queue.status.waiting") }}
                  </option>
                  <option value="called">{{ t("queue.status.called") }}</option>
                  <option value="no_show">
                    {{ t("queue.status.noShow") }}
                  </option>
                </select>

                <button
                  class="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  @click="refreshQueue"
                >
                  <ArrowPathIcon class="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div class="divide-y divide-gray-200">
            <div
              v-for="(queueItem, index) in filteredQueue"
              :key="queueItem.id"
              :class="[
                'p-4 cursor-pointer hover:bg-gray-50 transition-colors',
                queueItem.status === 'called' ? 'bg-yellow-50' : '',
                queueItem.status === 'no_show' ? 'bg-red-50' : '',
              ]"
              @click="selectQueueItem(queueItem)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <!-- 號碼 -->
                  <div class="flex-shrink-0">
                    <div
                      :class="[
                        'w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg',
                        getQueueNumberColor(queueItem.status),
                      ]"
                    >
                      {{ queueItem.queueNumber }}
                    </div>
                  </div>

                  <!-- 基本資訊 -->
                  <div class="ml-4">
                    <div class="flex items-center">
                      <h3 class="text-lg font-medium text-gray-900">
                        {{
                          queueItem.customerName ||
                          t("queue.customerNumber", {
                            number: queueItem.queueNumber,
                          })
                        }}
                      </h3>
                      <span
                        :class="getStatusClass(queueItem.status)"
                        class="ml-2 px-2 py-1 text-xs font-medium rounded-full"
                      >
                        {{ getStatusText(queueItem.status) }}
                      </span>
                    </div>

                    <div class="flex items-center mt-1 text-sm text-gray-500">
                      <UsersIcon class="w-4 h-4 mr-1" />
                      <span
                        >{{ queueItem.partySize }} {{ t("queue.people") }}</span
                      >
                      <span class="mx-2">·</span>
                      <ClockIcon class="w-4 h-4 mr-1" />
                      <span
                        >{{ t("queue.waitingFor") }}
                        {{ getWaitTime(queueItem.joinedAt)
                        }}{{ t("queue.minutesShort") }}</span
                      >

                      <span
                        v-if="queueItem.tablePreferences?.length"
                        class="mx-2"
                        >·</span
                      >
                      <BuildingStorefrontIcon
                        v-if="queueItem.tablePreferences?.length"
                        class="w-4 h-4 mr-1"
                      />
                      <span v-if="queueItem.tablePreferences?.length">{{
                        queueItem.tablePreferences.join(", ")
                      }}</span>
                    </div>
                  </div>
                </div>

                <!-- 右側操作 -->
                <div class="flex items-center space-x-2">
                  <!-- 優先級標示 -->
                  <div v-if="queueItem.priority > 0" class="flex items-center">
                    <StarIcon class="w-4 h-4 text-yellow-500" />
                    <span class="text-xs text-yellow-600 ml-1">VIP</span>
                  </div>

                  <!-- 預估等待時間 -->
                  <div class="text-right">
                    <p class="text-sm font-medium text-gray-900">
                      {{ t("queue.estimated") }}:
                      {{ calculateEstimatedWait(index)
                      }}{{ t("queue.minutesShort") }}
                    </p>
                    <p class="text-xs text-gray-500">
                      {{ formatClockTime(queueItem.joinedAt) }}
                      {{ t("queue.joined") }}
                    </p>
                  </div>

                  <!-- 快速操作按鈕 -->
                  <div class="flex flex-col space-y-1">
                    <button
                      v-if="queueItem.status === 'waiting'"
                      class="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 transition-colors"
                      @click.stop="callCustomer(queueItem)"
                    >
                      {{ t("queue.call") }}
                    </button>

                    <button
                      v-if="queueItem.status === 'called'"
                      class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
                      @click.stop="seatCustomer(queueItem)"
                    >
                      {{ t("queue.assignSeat") }}
                    </button>

                    <button
                      class="px-3 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700 transition-colors"
                      @click.stop="editQueueItem(queueItem)"
                    >
                      {{ t("queue.edit") }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- 特殊需求與備註 -->
              <div
                v-if="queueItem.specialRequests || queueItem.notes"
                class="mt-3 p-2 bg-gray-50 rounded"
              >
                <p
                  v-if="queueItem.specialRequests"
                  class="text-xs text-gray-600"
                >
                  <span class="font-medium"
                    >{{ t("queue.specialRequests") }}:</span
                  >
                  {{ queueItem.specialRequests }}
                </p>
                <p v-if="queueItem.notes" class="text-xs text-gray-600 mt-1">
                  <span class="font-medium">{{ t("queue.notes") }}:</span>
                  {{ queueItem.notes }}
                </p>
              </div>
            </div>

            <!-- 空狀態 -->
            <div v-if="filteredQueue.length === 0" class="p-12 text-center">
              <UsersIcon class="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 class="text-lg font-medium text-gray-900 mb-2">
                {{ t("queue.noCustomers") }}
              </h3>
              <p class="text-gray-500">{{ t("queue.noCustomersHint") }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側上：桌位狀態 -->
      <div class="lg:col-span-2">
        <div class="bg-white rounded-lg shadow mb-6">
          <div class="p-6 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-gray-900">
                {{ t("queue.tableStatus") }}
              </h2>
              <div class="flex space-x-2">
                <button
                  class="px-3 py-1 bg-green-100 text-green-800 rounded text-sm"
                  :class="{
                    'bg-green-600 text-white': tableViewFilter === 'available',
                  }"
                  @click="toggleTableView('available')"
                >
                  {{ t("queue.available") }} ({{ availableTables }})
                </button>
                <button
                  class="px-3 py-1 bg-red-100 text-red-800 rounded text-sm"
                  :class="{
                    'bg-red-600 text-white': tableViewFilter === 'occupied',
                  }"
                  @click="toggleTableView('occupied')"
                >
                  {{ t("queue.occupied") }}({{ occupiedTables }})
                </button>
                <button
                  class="px-3 py-1 bg-gray-100 text-gray-800 rounded text-sm"
                  :class="{
                    'bg-gray-600 text-white': tableViewFilter === 'all',
                  }"
                  @click="toggleTableView('all')"
                >
                  {{ t("queue.all") }}
                </button>
              </div>
            </div>
          </div>

          <div class="p-6">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div
                v-for="table in filteredTables"
                :key="table.id"
                :class="[
                  'relative p-4 rounded-lg border-2 cursor-pointer transition-all',
                  getTableStatusColor(table.status),
                  selectedTable?.id === table.id ? 'ring-2 ring-blue-500' : '',
                ]"
                @click="selectTable(table)"
              >
                <div class="text-center">
                  <div class="font-bold text-lg">{{ table.number }}</div>
                  <div class="text-sm text-gray-600">
                    {{ table.capacity }}{{ t("queue.seats") }}
                  </div>

                  <!-- 狀態標籤 -->
                  <div class="mt-2">
                    <span
                      :class="getTableStatusTextColor(table.status)"
                      class="text-xs font-medium px-2 py-1 rounded-full"
                    >
                      {{ getTableStatusText(table.status) }}
                    </span>
                  </div>

                  <!-- 使用時間（佔用狀態） -->
                  <div
                    v-if="table.occupiedSince"
                    class="text-xs text-gray-500 mt-1"
                  >
                    {{ t("queue.usedFor") }}
                    {{ getOccupiedTime(table.occupiedSince)
                    }}{{ t("queue.minutesShort") }}
                  </div>
                </div>

                <!-- 清潔狀態 -->
                <div
                  v-if="table.cleaningStatus === 'cleaning'"
                  class="absolute top-2 right-2"
                >
                  <div
                    class="w-3 h-3 bg-yellow-400 rounded-full animate-pulse"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 快速操作面板 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("queue.quickActions") }}
            </h3>

            <div class="grid grid-cols-2 gap-4">
              <!-- 手動加入候位 -->
              <button
                class="p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-center"
                @click="addToQueue"
              >
                <PlusIcon class="w-6 h-6 text-gray-400 mx-auto mb-2" />
                <span class="text-sm font-medium text-gray-700">{{
                  t("queue.manualAdd")
                }}</span>
              </button>

              <!-- 清潔桌位 -->
              <button
                v-if="selectedTable && selectedTable.status === 'occupied'"
                class="p-4 bg-orange-100 rounded-lg hover:bg-orange-200 transition-colors text-center"
                @click="cleanTable(selectedTable)"
              >
                <SparklesIcon class="w-6 h-6 text-orange-600 mx-auto mb-2" />
                <span class="text-sm font-medium text-orange-800">{{
                  t("queue.cleanTable")
                }}</span>
              </button>

              <!-- 發送通知 -->
              <button
                class="p-4 bg-teal-100 rounded-lg hover:bg-teal-200 transition-colors text-center"
                @click="sendNotification"
              >
                <BellIcon class="w-6 h-6 text-teal-600 mx-auto mb-2" />
                <span class="text-sm font-medium text-teal-800">{{
                  t("queue.sendNotification")
                }}</span>
              </button>

              <!-- 統計報表 -->
              <button
                class="p-4 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-center"
                @click="generateReport"
              >
                <DocumentChartBarIcon
                  class="w-6 h-6 text-gray-600 mx-auto mb-2"
                />
                <span class="text-sm font-medium text-gray-800">{{
                  t("queue.statsReport")
                }}</span>
              </button>
            </div>

            <!-- 自動分配控制 -->
            <div
              class="mt-6 p-4 bg-gradient-to-r from-blue-50 to-teal-50 rounded-lg"
            >
              <div class="flex items-center justify-between mb-3">
                <h4 class="font-medium text-gray-900">
                  {{ t("queue.smartAssignment") }}
                </h4>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    v-model="autoAssignment"
                    type="checkbox"
                    class="sr-only peer"
                    @change="toggleAutoAssignment"
                  />
                  <div
                    class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                  ></div>
                </label>
              </div>
              <p class="text-sm text-gray-600">
                {{
                  autoAssignment
                    ? t("queue.autoAssignEnabled")
                    : t("queue.autoAssignDisabled")
                }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 手動加入候位模態框 -->
    <div v-if="showAddDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeAddDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("queue.addToQueue") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeAddDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("queue.customerName")
              }}</label>
              <input
                v-model="newQueueItem.customerName"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('queue.customerNamePlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("queue.contactPhone")
              }}</label>
              <input
                v-model="newQueueItem.customerPhone"
                type="tel"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('queue.contactPhonePlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("queue.partySize")
              }}</label>
              <select
                v-model.number="newQueueItem.partySize"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option v-for="n in 12" :key="n" :value="n">
                  {{ n }} {{ t("queue.people") }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("queue.tablePreference")
              }}</label>
              <select
                v-model="newQueueItem.tablePreferences"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{{ t("queue.preferences.none") }}</option>
                <option value="window">
                  {{ t("queue.preferences.window") }}
                </option>
                <option value="corner">
                  {{ t("queue.preferences.corner") }}
                </option>
                <option value="center">
                  {{ t("queue.preferences.center") }}
                </option>
                <option value="quiet">
                  {{ t("queue.preferences.quiet") }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("queue.specialRequests")
              }}</label>
              <textarea
                v-model="newQueueItem.specialRequests"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('queue.specialRequestsPlaceholder')"
              />
            </div>

            <div>
              <label class="flex items-center">
                <input
                  v-model="newQueueItem.isVIP"
                  type="checkbox"
                  class="rounded border-gray-300 text-yellow-600 shadow-sm focus:border-yellow-300 focus:ring focus:ring-yellow-200 focus:ring-opacity-50"
                />
                <span class="ml-2 text-sm text-gray-700">{{
                  t("queue.vipCustomer")
                }}</span>
              </label>
            </div>
          </div>

          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closeAddDialog"
            >
              {{ t("queue.cancel") }}
            </button>
            <button
              :disabled="!canAddToQueue"
              class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="submitAddToQueue"
            >
              {{ t("queue.addToQueueBtn") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 安排座位模態框 -->
    <div v-if="showSeatDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeSeatDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("queue.assignSeat") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeSeatDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div v-if="selectedQueueItem" class="space-y-4">
            <!-- 顧客資訊 -->
            <div class="bg-gray-50 p-4 rounded-lg">
              <h4 class="font-medium text-gray-900 mb-2">
                {{ t("queue.customerInfo") }}
              </h4>
              <div class="text-sm space-y-1">
                <p>
                  <span class="text-gray-600">{{ t("queue.number") }}:</span>
                  {{ selectedQueueItem.queueNumber }}
                </p>
                <p>
                  <span class="text-gray-600">{{ t("queue.name") }}:</span>
                  {{ selectedQueueItem.customerName || t("queue.notProvided") }}
                </p>
                <p>
                  <span class="text-gray-600"
                    >{{ t("queue.partyCount") }}:</span
                  >
                  {{ selectedQueueItem.partySize }} {{ t("queue.people") }}
                </p>
                <p v-if="selectedQueueItem.tablePreferences?.length">
                  <span class="text-gray-600"
                    >{{ t("queue.preference") }}:</span
                  >
                  {{ selectedQueueItem.tablePreferences.join(", ") }}
                </p>
                <p>
                  <span class="text-gray-600">{{ t("queue.waitTime") }}:</span>
                  {{ getWaitTime(selectedQueueItem.joinedAt) }}
                  {{ t("queue.minutes") }}
                </p>
              </div>
            </div>

            <!-- 推薦桌位 -->
            <div>
              <h4 class="font-medium text-gray-900 mb-3">
                {{ t("queue.recommendedTables") }}
              </h4>
              <div class="grid grid-cols-2 gap-3">
                <div
                  v-for="table in recommendedTables"
                  :key="table.id"
                  :class="[
                    'p-3 border-2 rounded-lg cursor-pointer transition-all',
                    seatAssignment.tableId === table.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300',
                  ]"
                  @click="seatAssignment.tableId = table.id"
                >
                  <div class="text-center">
                    <div class="font-bold">
                      {{
                        t("queue.tableNumberLabel", { number: table.number })
                      }}
                    </div>
                    <div class="text-sm text-gray-600">
                      {{ table.capacity }}{{ t("queue.seats") }}
                    </div>
                    <div class="text-xs text-green-600 mt-1">
                      {{ t("queue.matchScore") }} {{ table.matchScore }}%
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 備註 -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("queue.additionalNotes")
              }}</label>
              <textarea
                v-model="seatAssignment.notes"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('queue.seatNotesPlaceholder')"
              />
            </div>
          </div>

          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closeSeatDialog"
            >
              {{ t("queue.cancel") }}
            </button>
            <button
              :disabled="!seatAssignment.tableId"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="confirmSeatAssignment"
            >
              {{ t("queue.confirmAssignment") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted } from "vue";
import {
  UsersIcon,
  ClockIcon,
  BuildingStorefrontIcon,
  ArrowPathIcon,
  StarIcon,
  PlusIcon,
  SparklesIcon,
  BellIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import DocumentChartBarIcon from "@heroicons/vue/24/outline/DocumentChartBarIcon";
import { Settings, Bell } from "lucide-vue-next";
import { queueService, type QueueItem } from "@/services/queueService";
import { useRealtimeQueue } from "@/composables/useRealtimeQueue";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useAuthStore } from "@/stores/auth";
import { api, unwrapApiData } from "@/services/api";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";

const { t } = useI18n();
const toast = useToast();
const { formatTime } = useDateFormatter();

// 使用候位類型定義 - 已從 queueService 導入
// QueueItem 現在來自模組導出
interface Table {
  id: string;
  number: string;
  capacity: number;
  status: "available" | "occupied" | "reserved" | "cleaning";
  occupiedSince: string | null;
  cleaningStatus: "clean" | "cleaning" | "dirty";
  matchScore?: number;
}

interface QueueStatusSummary {
  queue?: {
    total_waiting?: number;
    avg_estimated_wait?: number;
  };
}

// 響應式狀態
const authStore = useAuthStore();
const {
  // isConnected,
  // getRecentQueueUpdates,
  // getUpdateCountByStatus
} = useRealtimeQueue();

const queueFilter = ref("");
const tableViewFilter = ref("all");
const selectedQueueItem = ref<QueueItem | null>(null);
const selectedTable = ref<Table | null>(null);
const showAddDialog = ref(false);
const showSeatDialog = ref(false);
const showSettings = ref(false);
const autoAssignment = ref(true);

// 候位資料
const queueItems = ref<QueueItem[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const queueStatus = ref<QueueStatusSummary | null>(null);

// 統計數據 - 從新 API 即時數據獲取
const currentWaiting = computed(() => {
  return queueStatus.value?.queue?.total_waiting || 0;
});

const avgWaitTime = computed(() => {
  return queueStatus.value?.queue?.avg_estimated_wait || 0;
});

const availableTables = computed(() => {
  return tables.value.filter((t) => t.status === "available").length;
});
const occupiedTables = computed(() => {
  return tables.value.filter(
    (t) => t.status === "occupied" || t.status === "reserved",
  ).length;
});

// 表單數據 - 配合新API 結構
const newQueueItem = ref({
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  partySize: 2,
  tablePreferences: [] as number[],
  specialRequests: "",
  queueType: "walkin" as "walkin" | "online" | "phone",
  notificationMethods: ["sms"] as string[],
  isVIP: false,
});

const seatAssignment = ref({
  tableId: "" as string | number,
  notes: "",
});

// 候位佇列現在從API 獲取
// queueItems 響應變量已在上面定義

// 桌位數據 - fetched from API
const tables = ref<Table[]>([]);

// 計算屬性
const filteredQueue = computed(() => {
  let filtered = [...queueItems.value];

  if (queueFilter.value) {
    filtered = filtered.filter((item) => item.status === queueFilter.value);
  }

  return filtered.sort((a, b) => {
    // 優先級排序，然後按加入時間
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
  });
});

const filteredTables = computed(() => {
  if (tableViewFilter.value === "all") {
    return tables.value;
  }

  const statusMap: Record<string, string[]> = {
    available: ["available"],
    occupied: ["occupied", "reserved"],
  };

  return tables.value.filter((table) =>
    statusMap[tableViewFilter.value]?.includes(table.status),
  );
});

const recommendedTables = computed(() => {
  if (!selectedQueueItem.value) return [];

  const availableTables = tables.value.filter(
    (table) => table.status === "available",
  );
  const partySize = selectedQueueItem.value.partySize;

  return availableTables
    .map((table) => {
      let score = 100;

      // 容量匹配度
      if (table.capacity === partySize) {
        score += 20;
      } else if (table.capacity === partySize + 1) {
        score += 10;
      } else if (table.capacity < partySize) {
        score -= 50;
      } else if (table.capacity > partySize + 2) {
        score -= 10;
      }

      // 偏好匹配（簡化處理）
      if (selectedQueueItem.value?.tablePreferences?.length) {
        if (table.number.includes("1") || table.number.includes("2")) {
          // 假設靠窗
          if (selectedQueueItem.value.tablePreferences.includes(1)) score += 15; // 1 = window preference
        }
      }

      return { ...table, matchScore: Math.max(0, Math.min(100, score)) };
    })
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0))
    .slice(0, 4);
});

const canAddToQueue = computed(() => {
  return !!(
    newQueueItem.value.customerName &&
    (newQueueItem.value.customerPhone || newQueueItem.value.customerEmail) &&
    newQueueItem.value.partySize > 0
  );
});

// 工具函數
// formatTime treats a bare string as an "HH:mm" time-of-day, so ISO datetimes
// must be converted to a Date first.
const formatClockTime = (dateTime: string) => formatTime(new Date(dateTime));

const getWaitTime = (joinedAt: string) => {
  const now = new Date();
  const joined = new Date(joinedAt);
  return Math.floor((now.getTime() - joined.getTime()) / (1000 * 60));
};

const getOccupiedTime = (occupiedSince: string) => {
  const now = new Date();
  const occupied = new Date(occupiedSince);
  return Math.floor((now.getTime() - occupied.getTime()) / (1000 * 60));
};

const calculateEstimatedWait = (queueIndex: number) => {
  return (queueIndex + 1) * avgWaitTime.value;
};

// 狀態樣式方法
const getQueueNumberColor = (status: string) => {
  const colors: Record<string, string> = {
    waiting: "bg-blue-100 text-blue-800",
    // called was yellow and expired orange, which are the same colour here.
    // Being called is the live, act-now state so it keeps full orange; expired
    // is spent and drops to the muted step next to cancelled.
    called: "bg-orange-200 text-orange-900",
    notified: "bg-teal-100 text-teal-800",
    seated: "bg-green-100 text-green-800",
    no_show: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-800",
    expired: "bg-orange-100 text-orange-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
};

const getStatusText = (status: string) => {
  const texts: Record<string, string> = {
    waiting: t("queue.status.waiting"),
    called: t("queue.status.called"),
    notified: t("queue.status.notified"),
    seated: t("queue.status.seated"),
    no_show: t("queue.status.noShow"),
    cancelled: t("queue.status.cancelled"),
    expired: t("queue.status.expired"),
  };
  return texts[status] || status;
};

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    waiting: "bg-blue-100 text-blue-800",
    // called was yellow and expired orange, which are the same colour here.
    // Being called is the live, act-now state so it keeps full orange; expired
    // is spent and drops to the muted step next to cancelled.
    called: "bg-orange-200 text-orange-900",
    notified: "bg-teal-100 text-teal-800",
    seated: "bg-green-100 text-green-800",
    no_show: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-800",
    expired: "bg-orange-100 text-orange-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
};

const getTableStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    available: "border-green-200 bg-green-50",
    occupied: "border-red-200 bg-red-50",
    // reserved was yellow, cleaning orange -- now the same hue, so they
    // separate by depth: a held table is the stronger signal.
    reserved: "border-orange-300 bg-orange-100",
    cleaning: "border-orange-200 bg-orange-50",
  };
  return colors[status] || "border-gray-200 bg-gray-50";
};

const getTableStatusTextColor = (status: string) => {
  const colors: Record<string, string> = {
    available: "bg-green-100 text-green-800",
    occupied: "bg-red-100 text-red-800",
    reserved: "bg-orange-200 text-orange-900",
    cleaning: "bg-orange-100 text-orange-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
};

const getTableStatusText = (status: string) => {
  const texts: Record<string, string> = {
    available: t("queue.tableStatusText.available"),
    occupied: t("queue.tableStatusText.occupied"),
    reserved: t("queue.tableStatusText.reserved"),
    cleaning: t("queue.tableStatusText.cleaning"),
  };
  return texts[status] || status;
};

// 操作函數
const selectQueueItem = (item: QueueItem) => {
  selectedQueueItem.value = item;
};

const selectTable = (table: Table) => {
  selectedTable.value = table;
};

const toggleTableView = (filter: string) => {
  tableViewFilter.value = filter;
};

// Fetch tables from API
const fetchTables = async () => {
  if (!authStore.user?.restaurantId) return;

  try {
    const response = await api.get("/tables", {
      restaurantId: authStore.user.restaurantId,
    });
    const data = unwrapApiData<unknown[]>(response);
    if (Array.isArray(data)) {
      tables.value = data.map((table) => {
        const t = table as Record<string, unknown>;
        return {
          id: String(t.id),
          number:
            (typeof t.tableNumber === "string" && t.tableNumber) ||
            (typeof t.number === "string" && t.number) ||
            `T${t.id}`,
          capacity:
            (typeof t.capacity === "number" && t.capacity) ||
            (typeof t.seats === "number" && t.seats) ||
            4,
          status:
            t.status === "occupied" ||
            t.status === "reserved" ||
            t.status === "cleaning"
              ? t.status
              : "available",
          occupiedSince:
            typeof t.occupiedSince === "string" ? t.occupiedSince : null,
          cleaningStatus:
            t.cleaningStatus === "cleaning" || t.cleaningStatus === "dirty"
              ? t.cleaningStatus
              : "clean",
        };
      });
    }
  } catch (err) {
    console.error("Failed to fetch tables:", err);
  }
};

// API 操作 - 使用新模組化服務
const refreshQueue = async () => {
  if (!authStore.user?.restaurantId) return;

  loading.value = true;
  error.value = null;

  try {
    const [queueData, statusData] = await Promise.all([
      queueService.getQueue(authStore.user.restaurantId),
      queueService.getQueueStatus(authStore.user.restaurantId),
      fetchTables(),
    ]);

    queueItems.value = queueData;
    queueStatus.value = statusData;
  } catch (err) {
    error.value = t("queue.alerts.refreshFailed");
    console.error("Failed to refresh queue:", err);
  } finally {
    loading.value = false;
  }
};

const callNextCustomer = async () => {
  if (!authStore.user?.restaurantId) return;

  try {
    const result = await queueService.callNext(authStore.user.restaurantId, {
      // operatorId removed - not part of CallNextRequest interface
    });

    if (result.success && result.data) {
      // 更新本地候位
      const index = queueItems.value.findIndex(
        (item) => item.id === result.data!.id,
      );
      if (index !== -1) {
        queueItems.value[index] = result.data;
      }
      toast.success(
        t("queue.alerts.called", {
          name: result.data.customerName || result.data.queueNumber,
        }),
      );
    } else {
      toast.error(result.error || t("queue.alerts.callFailed"));
    }
  } catch (err) {
    toast.error(t("queue.alerts.callRetry"));
    console.error("Failed to call next customer:", err);
  }
};

const callCustomer = async (queueItem: QueueItem) => {
  if (!authStore.user?.restaurantId) return;

  try {
    const result = await queueService.callNext(authStore.user.restaurantId, {
      specificQueueId: queueItem.id,
    });

    if (result.success && result.data) {
      // 更新本地候位
      const index = queueItems.value.findIndex(
        (item) => item.id === queueItem.id,
      );
      if (index !== -1) {
        queueItems.value[index] = result.data;
      }
      toast.success(
        t("queue.alerts.called", {
          name: queueItem.customerName || queueItem.queueNumber,
        }),
      );
    } else {
      toast.error(result.error || t("queue.alerts.callFailed"));
    }
  } catch (error) {
    toast.error(t("queue.alerts.callRetry"));
    console.error("Failed to call customer:", error);
  }
};

const seatCustomer = (queueItem: QueueItem) => {
  selectedQueueItem.value = queueItem;
  showSeatDialog.value = true;
  seatAssignment.value = { tableId: "", notes: "" };
};

const addToQueue = () => {
  showAddDialog.value = true;
  newQueueItem.value = {
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    partySize: 2,
    tablePreferences: [],
    specialRequests: "",
    queueType: "walkin",
    notificationMethods: ["sms"],
    isVIP: false,
  };
};

const closeAddDialog = () => {
  showAddDialog.value = false;
};

const submitAddToQueue = async () => {
  if (!canAddToQueue.value || !authStore.user?.restaurantId) return;

  loading.value = true;

  try {
    const joinData = {
      restaurantId: authStore.user.restaurantId,
      customerName: newQueueItem.value.customerName,
      customerPhone: newQueueItem.value.customerPhone,
      customerEmail: newQueueItem.value.customerEmail,
      partySize: newQueueItem.value.partySize,
      specialRequests: newQueueItem.value.specialRequests || undefined,
      queueType: newQueueItem.value.queueType,
      tablePreferences: newQueueItem.value.tablePreferences,
      notificationMethods: newQueueItem.value.notificationMethods,
    };

    const result = await queueService.joinQueue(joinData);

    if (result.success && result.data) {
      closeAddDialog();
      toast.success(
        t("queue.alerts.addedToQueue", {
          number: result.data.queueNumber,
          minutes: result.data.estimatedWaitMinutes,
        }),
      );

      // 刷新候位列表
      await refreshQueue();
    } else {
      toast.error(result.error || t("queue.alerts.addFailed"));
    }
  } catch (error) {
    toast.error(t("queue.alerts.addRetry"));
    console.error("Failed to add to queue:", error);
  } finally {
    loading.value = false;
  }
};

const closeSeatDialog = () => {
  showSeatDialog.value = false;
  selectedQueueItem.value = null;
};

const confirmSeatAssignment = async () => {
  if (!selectedQueueItem.value || !seatAssignment.value.tableId) return;

  try {
    const result = await queueService.seatCustomer(selectedQueueItem.value.id, {
      tableId: Number(seatAssignment.value.tableId),
    });

    if (result.success) {
      // 更新本地候位
      const index = queueItems.value.findIndex(
        (item) => item.id === selectedQueueItem.value!.id,
      );
      if (index !== -1) {
        queueItems.value[index].status = "seated";
        queueItems.value[index].seatedAt = new Date().toISOString();
        queueItems.value[index].assignedTableId = Number(
          seatAssignment.value.tableId,
        );
      }

      // 更新桌位狀態(等待桌位 API 整合)
      const table = tables.value.find(
        (t) => t.id === seatAssignment.value.tableId.toString(),
      );
      if (table) {
        table.status = "occupied";
        table.occupiedSince = new Date().toISOString();
      }

      closeSeatDialog();
      toast.success(t("queue.alerts.seatSuccess"));
    } else {
      toast.error(result.error || t("queue.alerts.seatFailed"));
    }
  } catch (error) {
    toast.error(t("queue.alerts.seatRetry"));
    console.error("Failed to seat customer:", error);
  }
};

const editQueueItem = (queueItem: QueueItem) => {
  console.log("Edit queue item:", queueItem.id);
  toast.info(t("queue.alerts.editInDev"));
};

const cleanTable = async (table: Table) => {
  try {
    table.status = "cleaning";
    table.cleaningStatus = "cleaning";
    table.occupiedSince = null;

    await api.post(`/tables/${table.id}/clean`, {});

    table.status = "available";
    table.cleaningStatus = "clean";
    toast.success(t("queue.alerts.cleanDone", { number: table.number }));
  } catch (_error) {
    table.status = "occupied";
    table.cleaningStatus = "dirty";
    toast.error(t("queue.alerts.cleanFailed"));
  }
};

const sendNotification = () => {
  toast.info(t("queue.alerts.notifyInDev"));
};

const generateReport = () => {
  toast.info(t("queue.alerts.reportInDev"));
};

const toggleAutoAssignment = () => {
  console.log("Auto assignment:", autoAssignment.value);
  if (autoAssignment.value) {
    toast.success(t("queue.alerts.autoAssignOn"));
  } else {
    toast.info(t("queue.alerts.autoAssignOff"));
  }
};

// 監聽即時更新
// watch(queueUpdates, () => {
//   // 當候位佇列更新時刷新候位列表
//   refreshQueue();
// }, { deep: true });

// 定期刷新數據。A bare setInterval here was never cleared, so it kept polling
// after the tab was left and stacked another timer on every return.
const queuePoller = createVisibilityAwarePoller({
  intervalMs: 30_000,
  onTick: () => {
    if (loading.value) return;
    return refreshQueue();
  },
});

// 生命週期
onMounted(async () => {
  queuePoller.start();
  // 初次載入數據
  await refreshQueue();

  // 預選第一個候位項目
  if (queueItems.value.length > 0) {
    selectedQueueItem.value = queueItems.value[0];
  }
});
onBeforeUnmount(() => queuePoller.stop());

// 暴露給測試使用的內部狀態和函數
defineExpose({
  // 響應式數據
  queueItems,
  tables,
  newQueueItem,
  selectedQueueItem,
  selectedTable,
  showAddDialog,
  showSeatDialog,
  showSettings,
  seatAssignment,
  queueFilter,
  tableViewFilter,

  // Computed 屬性
  canAddToQueue,
  filteredQueue,
  filteredTables,
  recommendedTables,
  currentWaiting,
  avgWaitTime,
  availableTables,

  // 函數
  refreshQueue,
  callNextCustomer,
  callCustomer,
  seatCustomer,
  confirmSeatAssignment,
  submitAddToQueue,
  addToQueue,
  selectTable,
  cleanTable,
  calculateEstimatedWait,
  getWaitTime,
  getStatusClass,
  getStatusText,
  getTableStatusColor,
  getTableStatusText,
});
</script>

<style scoped>
/* 自定義滾動條 */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}
</style>
