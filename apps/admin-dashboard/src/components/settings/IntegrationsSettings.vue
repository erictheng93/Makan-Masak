<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-2">
        {{ t("integrations.title") }}
      </h3>
      <p class="text-sm text-gray-500">
        {{ t("integrations.subtitle") }}
      </p>
    </div>

    <!-- Platform Cards -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Uber Eats Card -->
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <div
              class="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center text-lg"
            >
              🟢
            </div>
            <div>
              <h4 class="font-semibold text-gray-900">Uber Eats</h4>
              <p class="text-xs text-gray-500">
                {{ t("integrations.deliveryIntegration") }}
              </p>
            </div>
          </div>
          <span
            v-if="uberEats.enabled"
            class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium"
          >
            {{ t("integrations.connected") }}
          </span>
          <span
            v-else
            class="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium"
          >
            {{ t("integrations.notConnected") }}
          </span>
        </div>

        <!-- Not Connected -->
        <div v-if="!uberEats.enabled">
          <div v-if="!showConnectForm" class="text-center py-4">
            <p class="text-sm text-gray-500 mb-4">
              {{ t("integrations.connectDescription") }}
            </p>
            <button
              class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              @click="showConnectForm = true"
            >
              {{ t("integrations.connectUberEats") }}
            </button>
          </div>

          <!-- Connect Form -->
          <div v-else class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Client ID</label
              >
              <input
                v-model="connectForm.clientId"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Uber Eats API Client ID"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Client Secret</label
              >
              <input
                v-model="connectForm.clientSecret"
                type="password"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Uber Eats API Client Secret"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1"
                >Store ID</label
              >
              <input
                v-model="connectForm.storeId"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Uber Eats Store ID"
              />
            </div>
            <div class="flex items-center space-x-3">
              <button
                :disabled="isConnecting"
                class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                @click="connectUberEats"
              >
                {{
                  isConnecting
                    ? t("integrations.connecting")
                    : t("integrations.confirmConnect")
                }}
              </button>
              <button
                class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                @click="showConnectForm = false"
              >
                {{ t("common.cancel") }}
              </button>
            </div>
          </div>
        </div>

        <!-- Connected: Config -->
        <div v-else class="space-y-4">
          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-sm font-medium text-gray-900">
                {{ t("integrations.autoAccept") }}
              </p>
              <p class="text-xs text-gray-500">
                {{ t("integrations.autoAcceptDesc") }}
              </p>
            </div>
            <button
              :aria-label="t('integrations.autoAccept')"
              role="switch"
              :aria-checked="Boolean(uberEats.config?.autoAcceptOrders)"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                uberEats.config?.autoAcceptOrders
                  ? 'bg-green-600'
                  : 'bg-gray-200',
              ]"
              @click="toggleAutoAccept"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  uberEats.config?.autoAcceptOrders
                    ? 'translate-x-6'
                    : 'translate-x-1',
                ]"
              />
            </button>
          </div>

          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-sm font-medium text-gray-900">
                {{ t("integrations.menuSync") }}
              </p>
              <p class="text-xs text-gray-500">
                {{ t("integrations.menuSyncDesc") }}
              </p>
            </div>
            <button
              :aria-label="t('integrations.menuSync')"
              role="switch"
              :aria-checked="Boolean(uberEats.config?.menuSyncEnabled)"
              :class="[
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                uberEats.config?.menuSyncEnabled
                  ? 'bg-green-600'
                  : 'bg-gray-200',
              ]"
              @click="toggleMenuSync"
            >
              <span
                :class="[
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  uberEats.config?.menuSyncEnabled
                    ? 'translate-x-6'
                    : 'translate-x-1',
                ]"
              />
            </button>
          </div>

          <div
            class="flex items-center justify-between py-2 border-t border-gray-100"
          >
            <div>
              <p class="text-sm font-medium text-gray-900">
                {{ t("integrations.manualSync") }}
              </p>
              <p class="text-xs text-gray-500">
                <template v-if="uberEats.lastMenuSyncAt">
                  {{ t("integrations.lastSync") }}:
                  {{ formatShortDateTime(uberEats.lastMenuSyncAt) }}
                  <span
                    :class="getSyncStatusClass(uberEats.menuSyncStatus)"
                    class="ml-1"
                  >
                    {{ getSyncStatusText(uberEats.menuSyncStatus) }}
                  </span>
                </template>
                <template v-else>{{ t("integrations.notSynced") }}</template>
              </p>
            </div>
            <button
              :disabled="isSyncing"
              class="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              @click="syncMenu"
            >
              {{
                isSyncing
                  ? t("integrations.syncing")
                  : t("integrations.syncNow")
              }}
            </button>
          </div>

          <div class="pt-4 border-t border-gray-200">
            <button
              class="text-sm text-red-600 hover:text-red-700 font-medium"
              @click="confirmDisconnect = true"
            >
              {{ t("integrations.disconnect") }}
            </button>
          </div>
        </div>
      </div>

      <!-- Foodpanda Card (Coming Soon) -->
      <div class="bg-white rounded-lg shadow p-6 opacity-60">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center space-x-3">
            <div
              class="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center text-lg"
            >
              🩷
            </div>
            <div>
              <h4 class="font-semibold text-gray-900">Foodpanda</h4>
              <p class="text-xs text-gray-500">
                {{ t("integrations.deliveryIntegration") }}
              </p>
            </div>
          </div>
          <span
            class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium"
          >
            {{ t("integrations.comingSoon") }}
          </span>
        </div>
        <div class="text-center py-4">
          <p class="text-sm text-gray-500">
            {{ t("integrations.foodpandaComingSoon") }}
          </p>
        </div>
      </div>
    </div>

    <!-- Webhook Logs -->
    <div class="bg-white rounded-lg shadow p-6">
      <div class="flex items-center justify-between mb-4">
        <h4 class="font-semibold text-gray-900">
          {{ t("integrations.webhookLogs") }}
        </h4>
        <button
          class="text-sm text-blue-600 hover:text-blue-700"
          @click="
            showLogs = !showLogs;
            if (showLogs) loadWebhookLogs();
          "
        >
          {{ showLogs ? t("integrations.collapse") : t("integrations.expand") }}
        </button>
      </div>

      <div v-if="showLogs">
        <div v-if="webhookLogs.length === 0" class="text-center py-6">
          <p class="text-sm text-gray-500">
            {{ t("integrations.noWebhookLogs") }}
          </p>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500"
                >
                  {{ t("integrations.logTime") }}
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500"
                >
                  {{ t("integrations.logPlatform") }}
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500"
                >
                  {{ t("integrations.logEvent") }}
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500"
                >
                  {{ t("integrations.logStatus") }}
                </th>
                <th
                  class="px-4 py-2 text-left text-xs font-medium text-gray-500"
                >
                  {{ t("integrations.logError") }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr v-for="log in webhookLogs" :key="log.id">
                <td class="px-4 py-2 text-sm text-gray-500">
                  {{ formatShortDateTime(log.createdAt) }}
                </td>
                <td class="px-4 py-2 text-sm text-gray-900">
                  {{ log.platform }}
                </td>
                <td class="px-4 py-2 text-sm text-gray-900">
                  {{ log.eventType }}
                </td>
                <td class="px-4 py-2">
                  <span
                    :class="getLogStatusClass(log.status)"
                    class="px-2 py-0.5 rounded-full text-xs font-medium"
                  >
                    {{ getLogStatusText(log.status) }}
                  </span>
                </td>
                <td class="px-4 py-2 text-sm text-red-600">
                  {{ log.error || "-" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Disconnect Confirmation Modal -->
    <div
      v-if="confirmDisconnect"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-lg shadow-xl p-6 max-w-md mx-4">
        <h3 class="text-lg font-semibold text-gray-900 mb-2">
          {{ t("integrations.confirmDisconnectTitle") }}
        </h3>
        <p class="text-sm text-gray-600 mb-4">
          {{ t("integrations.confirmDisconnectDesc") }}
        </p>
        <div class="flex items-center justify-end space-x-3">
          <button
            class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            @click="confirmDisconnect = false"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            :disabled="isDisconnecting"
            class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
            @click="disconnectUberEats"
          >
            {{
              isDisconnecting
                ? t("integrations.disconnecting")
                : t("integrations.confirmDisconnect")
            }}
          </button>
        </div>
      </div>
    </div>

    <!-- Toast Message -->
    <div
      v-if="message"
      :class="[
        'fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50',
        message.type === 'success'
          ? 'bg-green-100 text-green-800'
          : 'bg-red-100 text-red-800',
      ]"
    >
      {{ message.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { apiClient, unwrapApiPayload } from "@/services/api";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();
const { formatShortDateTime } = useDateFormatter();

const authStore = useAuthStore();

const showConnectForm = ref(false);
const showLogs = ref(false);
const isConnecting = ref(false);
const isSyncing = ref(false);
const isDisconnecting = ref(false);
const confirmDisconnect = ref(false);
const message = ref<{ type: "success" | "error"; text: string } | null>(null);

const connectForm = reactive({
  clientId: "",
  clientSecret: "",
  storeId: "",
});

const uberEats = reactive({
  enabled: false,
  config: null as {
    autoAcceptOrders?: boolean;
    menuSyncEnabled?: boolean;
  } | null,
  lastMenuSyncAt: null as string | null,
  menuSyncStatus: null as string | null,
});

const webhookLogs = ref<
  Array<{
    id: number;
    platform: string;
    eventType: string;
    status: string;
    error?: string;
    createdAt: string;
  }>
>([]);

onMounted(async () => {
  await loadIntegration();
});

async function loadIntegration() {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    const response = await apiClient.get<{
      enabled: boolean;
      config: { autoAcceptOrders?: boolean; menuSyncEnabled?: boolean } | null;
      lastMenuSyncAt: string | null;
      menuSyncStatus: string | null;
    }>(`/integrations/${restaurantId}/uber_eats`);
    if (response.data?.data) {
      // Defensive: handle double-wrapped cache responses
      const raw = response.data.data;
      const data = unwrapApiPayload<{
        enabled: boolean;
        config: {
          autoAcceptOrders?: boolean;
          menuSyncEnabled?: boolean;
        } | null;
        lastMenuSyncAt: string | null;
        menuSyncStatus: string | null;
      }>(raw);
      uberEats.enabled = data.enabled;
      uberEats.config = data.config;
      uberEats.lastMenuSyncAt = data.lastMenuSyncAt;
      uberEats.menuSyncStatus = data.menuSyncStatus;
    }
  } catch {
    // Not connected yet
  }
}

async function connectUberEats() {
  if (
    !connectForm.clientId ||
    !connectForm.clientSecret ||
    !connectForm.storeId
  ) {
    showMsg("error", t("integrations.alerts.fillAllFields"));
    return;
  }
  isConnecting.value = true;
  try {
    const restaurantId = authStore.restaurantId;
    await apiClient.post(`/integrations/${restaurantId}/uber_eats/connect`, {
      clientId: connectForm.clientId,
      clientSecret: connectForm.clientSecret,
      storeId: connectForm.storeId,
    });
    showMsg("success", t("integrations.alerts.connectSuccess"));
    showConnectForm.value = false;
    await loadIntegration();
  } catch (err: unknown) {
    showMsg(
      "error",
      resolveUserFacingError(err, t, {
        fallbackKey: "integrations.alerts.connectFailed",
      }).message,
    );
  } finally {
    isConnecting.value = false;
  }
}

async function toggleAutoAccept() {
  try {
    const restaurantId = authStore.restaurantId;
    const newValue = !uberEats.config?.autoAcceptOrders;
    await apiClient.put(`/integrations/${restaurantId}/uber_eats`, {
      autoAcceptOrders: newValue,
    });
    if (uberEats.config) uberEats.config.autoAcceptOrders = newValue;
  } catch {
    showMsg("error", t("integrations.alerts.updateFailed"));
  }
}

async function toggleMenuSync() {
  try {
    const restaurantId = authStore.restaurantId;
    const newValue = !uberEats.config?.menuSyncEnabled;
    await apiClient.put(`/integrations/${restaurantId}/uber_eats`, {
      menuSyncEnabled: newValue,
    });
    if (uberEats.config) uberEats.config.menuSyncEnabled = newValue;
  } catch {
    showMsg("error", t("integrations.alerts.updateFailed"));
  }
}

async function syncMenu() {
  isSyncing.value = true;
  try {
    const restaurantId = authStore.restaurantId;
    await apiClient.post(`/integrations/${restaurantId}/uber_eats/menu-sync`);
    showMsg("success", t("integrations.alerts.syncTriggered"));
    await loadIntegration();
  } catch (err: unknown) {
    showMsg(
      "error",
      resolveUserFacingError(err, t, {
        fallbackKey: "integrations.alerts.syncFailed",
      }).message,
    );
  } finally {
    isSyncing.value = false;
  }
}

async function disconnectUberEats() {
  isDisconnecting.value = true;
  try {
    const restaurantId = authStore.restaurantId;
    await apiClient.delete(`/integrations/${restaurantId}/uber_eats`);
    uberEats.enabled = false;
    uberEats.config = null;
    uberEats.lastMenuSyncAt = null;
    uberEats.menuSyncStatus = null;
    confirmDisconnect.value = false;
    showMsg("success", t("integrations.alerts.disconnectSuccess"));
  } catch {
    showMsg("error", t("integrations.alerts.disconnectFailed"));
  } finally {
    isDisconnecting.value = false;
  }
}

async function loadWebhookLogs() {
  try {
    const restaurantId = authStore.restaurantId;
    const response = await apiClient.get<typeof webhookLogs.value>(
      `/integrations/${restaurantId}/webhook-logs`,
    );
    webhookLogs.value = response.data?.data || [];
  } catch {
    webhookLogs.value = [];
  }
}

function showMsg(type: "success" | "error", text: string) {
  message.value = { type, text };
  setTimeout(() => {
    message.value = null;
  }, 3000);
}

function getSyncStatusClass(status?: string | null) {
  const classes: Record<string, string> = {
    idle: "text-gray-500",
    syncing: "text-blue-600",
    success: "text-green-600",
    error: "text-red-600",
  };
  return classes[status || "idle"] || "text-gray-500";
}

function getSyncStatusText(status?: string | null) {
  const texts: Record<string, string> = {
    idle: "",
    syncing: `(${t("integrations.syncStatus.syncing")})`,
    success: `(${t("integrations.syncStatus.success")})`,
    error: `(${t("integrations.syncStatus.error")})`,
  };
  return texts[status || "idle"] || "";
}

function getLogStatusClass(status: string) {
  const classes: Record<string, string> = {
    received: "bg-blue-100 text-blue-800",
    processed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
}

function getLogStatusText(status: string) {
  const texts: Record<string, string> = {
    received: t("integrations.logStatusText.received"),
    processed: t("integrations.logStatusText.processed"),
    failed: t("integrations.logStatusText.failed"),
  };
  return texts[status] || status;
}
</script>
