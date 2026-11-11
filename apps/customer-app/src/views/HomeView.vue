<template>
  <div class="customer-shell min-h-screen bg-ios-bg">
    <!-- 頂部導航 -->
    <nav class="bg-white/80 backdrop-blur-xl shadow-card-sm">
      <div class="max-w-md lg:max-w-5xl mx-auto px-4 lg:px-8 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-3">
            <div
              class="w-10 h-10 bg-ios-blue rounded-xl flex items-center justify-center"
            >
              <span class="text-white font-bold text-lg">M</span>
            </div>
            <div>
              <h1 class="text-xl font-bold text-ios-text">MakanMasak</h1>
              <p class="text-sm text-ios-secondary">
                {{ t("home.subtitle") }}
              </p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
      </div>
    </nav>

    <!-- 主要內容 -->
    <main class="max-w-md lg:max-w-5xl mx-auto px-4 lg:px-8 py-8 lg:py-16">
      <!-- 歡迎區塊 — tablet: two-column hero layout -->
      <div
        class="home-entry lg:grid lg:grid-cols-2 lg:items-center lg:gap-12 mb-10 lg:mb-14"
      >
        <!-- 圖示 + 文字 -->
        <div class="text-left lg:flex-1 mb-8 lg:mb-0">
          <div
            class="w-16 h-16 lg:w-20 lg:h-20 mb-6 bg-ios-blue/10 rounded-2xl lg:rounded-3xl flex items-center justify-center"
          >
            <svg
              class="w-8 h-8 lg:w-10 lg:h-10 text-ios-blue"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 class="text-3xl lg:text-4xl font-bold text-ios-text mb-2 lg:mb-3">
            {{ t("home.title") }}
          </h2>
          <p class="text-ios-secondary text-base lg:text-lg">
            {{ t("home.subtitle") }}
          </p>
        </div>

        <!-- 主要操作按鈕 — tablet: 右欄獨立 -->
        <div class="lg:flex-1 lg:max-w-sm space-y-3 lg:space-y-4">
          <!-- 掃描QR碼按鈕 -->
          <button
            data-testid="scan-qr-btn"
            class="w-full bg-ios-blue text-white font-semibold py-4 px-6 rounded-full active:scale-[0.98] transition-transform duration-150 flex items-center justify-center space-x-3 shadow-card-sm"
            @click="startQRScan"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M12 12h-4.01M12 12v4m6-4h.01M12 8h.01"
              />
            </svg>
            <span>{{ t("home.scanQR") }}</span>
          </button>

          <!-- 手動輸入按鈕 -->
          <button
            data-testid="manual-input-btn"
            class="w-full bg-white shadow-card-sm text-ios-text font-semibold py-4 px-6 rounded-full active:scale-[0.98] transition-transform duration-150 flex items-center justify-center space-x-3"
            @click="showManualInput = true"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <span>{{ t("home.manualInput") }}</span>
          </button>

          <!-- 探索美食按鈕 -->
          <router-link
            to="/discover"
            class="w-full bg-white text-ios-text font-semibold py-4 px-6 rounded-full active:scale-[0.98] transition-transform duration-150 flex items-center justify-center space-x-3 shadow-card-sm"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span>{{ t("home.discoverFood") }}</span>
          </router-link>

          <router-link
            to="/markets"
            data-testid="market-directory-link"
            class="w-full shadow-card-sm bg-white text-ios-text font-semibold py-4 px-6 rounded-full active:scale-[0.98] transition-transform duration-150 flex items-center justify-center space-x-3"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
              />
            </svg>
            <span>夜市與商圈</span>
          </router-link>
        </div>
      </div>

      <!-- 最近使用的餐廳 -->
      <div v-if="recentRestaurants.length > 0" class="mt-12">
        <h3 class="text-lg font-semibold text-ios-text mb-4">
          {{ t("home.recentOrders") }}
        </h3>
        <div class="space-y-3 lg:grid lg:grid-cols-3 lg:gap-4 lg:space-y-0">
          <button
            v-for="restaurant in recentRestaurants"
            :key="restaurant.id"
            class="w-full bg-white p-4 rounded-xl shadow-card-sm active:scale-[0.98] transition-transform duration-150 text-left"
            @click="selectRecentRestaurant(restaurant)"
          >
            <div class="flex items-center space-x-3">
              <div
                class="w-12 h-12 bg-ios-bg rounded-2xl flex items-center justify-center flex-shrink-0"
              >
                <svg
                  class="w-6 h-6 text-ios-tertiary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-4m-5 0H9m0 0H7m2 0v-9m10 9v-9M9 8h6m-6 4h6"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-ios-text truncate">
                  {{ restaurant.name }}
                </p>
                <p class="text-sm text-ios-secondary truncate">
                  {{ restaurant.address }}
                </p>
              </div>
              <svg
                class="w-5 h-5 text-ios-tertiary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </button>
        </div>
      </div>

      <!-- 功能介紹 -->
      <div class="mt-12 lg:mt-16">
        <h3 class="text-lg lg:text-xl font-semibold text-ios-text mb-6">
          {{ t("home.features.title") }}
        </h3>

        <div class="grid gap-4 lg:grid-cols-3 lg:gap-6">
          <div
            class="flex items-start space-x-4 lg:flex-col lg:space-x-0 lg:space-y-4 lg:bg-white lg:rounded-2xl lg:p-6 lg:shadow-[0_2px_12px_rgb(0,0,0,0.06)]"
          >
            <div
              class="w-10 h-10 lg:w-12 lg:h-12 bg-ios-green/15 rounded-2xl flex items-center justify-center flex-shrink-0"
            >
              <svg
                class="w-5 h-5 lg:w-6 lg:h-6 text-ios-green"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <div>
              <h4 class="font-medium text-ios-text lg:text-base">
                {{ t("home.features.qrOrder") }}
              </h4>
              <p class="text-sm text-ios-secondary lg:mt-1">
                {{ t("home.features.qrOrderDesc") }}
              </p>
            </div>
          </div>

          <div
            class="flex items-start space-x-4 lg:flex-col lg:space-x-0 lg:space-y-4 lg:bg-white lg:rounded-2xl lg:p-6 lg:shadow-[0_2px_12px_rgb(0,0,0,0.06)]"
          >
            <div
              class="w-10 h-10 lg:w-12 lg:h-12 bg-ios-blue/15 rounded-2xl flex items-center justify-center flex-shrink-0"
            >
              <svg
                class="w-5 h-5 lg:w-6 lg:h-6 text-ios-blue"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                />
              </svg>
            </div>
            <div>
              <h4 class="font-medium text-ios-text lg:text-base">
                {{ t("home.features.realtime") }}
              </h4>
              <p class="text-sm text-ios-secondary lg:mt-1">
                {{ t("home.features.realtimeDesc") }}
              </p>
            </div>
          </div>

          <div
            class="flex items-start space-x-4 lg:flex-col lg:space-x-0 lg:space-y-4 lg:bg-white lg:rounded-2xl lg:p-6 lg:shadow-[0_2px_12px_rgb(0,0,0,0.06)]"
          >
            <div
              class="w-10 h-10 lg:w-12 lg:h-12 bg-ios-teal/15 rounded-2xl flex items-center justify-center flex-shrink-0"
            >
              <svg
                class="w-5 h-5 lg:w-6 lg:h-6 text-ios-teal"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.031 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <div>
              <h4 class="font-medium text-ios-text lg:text-base">
                {{ t("home.features.payment") }}
              </h4>
              <p class="text-sm text-ios-secondary lg:mt-1">
                {{ t("home.features.paymentDesc") }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- PWA 安裝提示 -->
    <div
      v-if="appStore.isInstallable"
      class="customer-floating-cart fixed bottom-4 left-4 right-4 bg-ios-blue text-white p-4 rounded-2xl shadow-lg max-w-md mx-auto"
    >
      <div class="flex items-center justify-between">
        <div class="flex-1 pr-4">
          <p class="font-medium">
            {{ t("pwa.installTitle") }}
          </p>
          <p class="text-sm text-white/80">
            {{ t("pwa.installDescription") }}
          </p>
        </div>
        <button
          class="bg-white text-ios-blue px-4 py-2 rounded-full font-medium text-sm active:scale-[0.98] transition-transform duration-150"
          @click="appStore.installApp"
        >
          {{ t("pwa.installAction") }}
        </button>
      </div>
    </div>

    <!-- 手動輸入對話框 -->
    <ManualInputModal
      v-model:show="showManualInput"
      @restaurant-selected="handleRestaurantSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useToast } from "vue-toastification";
import { useI18n } from "@/composables/useI18n";
import { useAppStore } from "@/stores/app";
import ManualInputModal from "@/components/ManualInputModal.vue";
import LanguageSwitcher from "@/components/LanguageSwitcher.vue";
import type { Restaurant } from "@makanmasak/shared-types";

type RecentRestaurant = Restaurant & { lastVisit: number };

const router = useRouter();
const toast = useToast();
const { t } = useI18n();
const appStore = useAppStore();

const showManualInput = ref(false);
const recentRestaurants = ref<RecentRestaurant[]>([]);

onMounted(() => {
  loadRecentRestaurants();
});

const startQRScan = () => {
  // 檢查設備支援
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast.error(t("toast.cameraNotSupported"));
    return;
  }

  router.push("/scan");
};

const selectRecentRestaurant = (_restaurant: Restaurant) => {
  // 這裡應該要求用戶輸入桌號，或者從歷史記錄中取得
  showManualInput.value = true;
};

const handleRestaurantSelected = ({
  restaurantId,
}: {
  restaurantId: string;
}) => {
  router.push(`/restaurant/${restaurantId}/shop/order-type`);
};

const loadRecentRestaurants = () => {
  try {
    const saved = localStorage.getItem("makanmakan_recent_restaurants");
    if (saved) {
      const parsed = JSON.parse(saved);
      // 只保留最近7天內的記錄
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      recentRestaurants.value = (parsed as RecentRestaurant[])
        .filter((item: RecentRestaurant) => item.lastVisit > sevenDaysAgo)
        .slice(0, 3); // 只顯示最近3家
    }
  } catch (error) {
    console.warn("載入最近使用的餐廳失敗:", error);
  }
};
</script>
