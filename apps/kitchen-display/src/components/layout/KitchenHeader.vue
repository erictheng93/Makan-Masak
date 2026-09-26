<template>
  <header
    class="fixed top-0 w-full z-50 bg-white/85 backdrop-blur-xl border-b border-black/5"
  >
    <div class="px-4 py-3">
      <div
        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:flex-nowrap lg:gap-4"
      >
        <!-- Left Section: Title + Connection Status -->
        <div class="flex items-center gap-3 min-w-0">
          <h1
            class="shrink-0 whitespace-nowrap text-lg font-extrabold text-ios-text lg:text-2xl"
          >
            {{ t("header.title") }}
          </h1>
          <!-- Connection Status -->
          <div class="flex items-center gap-1.5">
            <div
              :class="[
                'w-2.5 h-2.5 rounded-full transition-colors duration-200',
                isConnected ? 'bg-ios-green' : 'bg-ios-red',
              ]"
            />
            <span
              :class="[
                'text-sm font-medium hidden sm:inline',
                isConnected ? 'text-ios-green' : 'text-ios-red',
              ]"
            >
              {{
                isConnected ? t("header.connected") : t("header.disconnected")
              }}
            </span>
          </div>
        </div>

        <!-- Center Section: iOS Segmented Control for Kanban/Grid -->
        <div class="flex flex-1 justify-end lg:justify-center">
          <div class="bg-ios-bg rounded-full p-0.5 inline-flex">
            <button
              :class="[
                'transition-all duration-200 ease-out',
                currentViewMode === 'kanban'
                  ? 'bg-white rounded-full shadow-card-sm px-4 py-1.5 text-sm font-semibold text-ios-text'
                  : 'px-4 py-1.5 text-sm font-medium text-ios-secondary',
              ]"
              @click="$emit('update:viewMode', 'kanban')"
            >
              {{ t("header.boardView") }}
            </button>
            <button
              :class="[
                'transition-all duration-200 ease-out',
                currentViewMode === 'grid'
                  ? 'bg-white rounded-full shadow-card-sm px-4 py-1.5 text-sm font-semibold text-ios-text'
                  : 'px-4 py-1.5 text-sm font-medium text-ios-secondary',
              ]"
              @click="$emit('update:viewMode', 'grid')"
            >
              {{ t("header.gridView") }}
            </button>
          </div>
        </div>

        <!-- Right Section: Action Buttons -->
        <div
          class="flex w-full min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:w-auto lg:flex-none lg:overflow-visible lg:pb-0"
        >
          <!-- Reconnect Button (when disconnected) -->
          <button
            v-if="!isConnected"
            class="h-11 w-11 shrink-0 rounded-full bg-ios-bg flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
            :title="t('header.reconnect')"
            @click="$emit('reconnect')"
          >
            <RefreshCw class="w-5 h-5 text-ios-orange" />
          </button>

          <!-- Refresh Button -->
          <button
            v-if="isConnected"
            :disabled="isRefreshing"
            class="h-11 w-11 shrink-0 rounded-full bg-ios-bg flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95 disabled:opacity-50"
            :title="t('header.refreshOrders')"
            @click="$emit('refresh')"
          >
            <RefreshCw
              :class="[
                'w-5 h-5 text-ios-secondary',
                { 'animate-spin': isRefreshing },
              ]"
            />
          </button>

          <!-- Fullscreen Toggle -->
          <button
            class="h-11 w-11 shrink-0 rounded-full bg-ios-bg flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
            :title="t('header.fullscreen')"
            @click="$emit('toggle-fullscreen')"
          >
            <Minimize2 v-if="isFullscreen" class="w-5 h-5 text-ios-secondary" />
            <Maximize2 v-else class="w-5 h-5 text-ios-secondary" />
          </button>

          <!-- Notification Button -->
          <button
            class="h-11 w-11 shrink-0 rounded-full bg-ios-bg flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
            :title="t('header.notifications')"
          >
            <Bell class="w-5 h-5 text-ios-secondary" />
          </button>

          <!-- Language Switcher -->
          <div class="relative">
            <button
              class="h-11 shrink-0 px-3 rounded-full bg-ios-bg flex items-center gap-1.5 transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
              @click="showLanguageMenu = !showLanguageMenu"
            >
              <Globe class="w-5 h-5 text-ios-secondary" />
              <span
                class="text-sm font-medium text-ios-secondary hidden sm:inline"
                >{{ localeConfig.flag }}</span
              >
            </button>
            <transition name="dropdown">
              <div
                v-if="showLanguageMenu"
                class="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-card-lg border border-black/5 overflow-hidden z-50 min-w-[160px]"
              >
                <button
                  v-for="loc in supportedLocales"
                  :key="loc.code"
                  class="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-ios-bg"
                  :class="{
                    'text-ios-blue font-semibold': loc.code === locale,
                    'text-ios-text': loc.code !== locale,
                  }"
                  @click="handleLocaleChange(loc.code)"
                >
                  <span class="text-base">{{ loc.flag }}</span>
                  <span>{{ loc.nativeName }}</span>
                  <span v-if="loc.code === locale" class="ml-auto text-ios-blue"
                    >✓</span
                  >
                </button>
              </div>
            </transition>
            <div
              v-if="showLanguageMenu"
              class="fixed inset-0 z-40"
              @click="showLanguageMenu = false"
            />
          </div>

          <!-- My Shifts Button — the employee swap entry (#320) -->
          <button
            data-testid="open-my-shifts"
            class="h-11 w-11 shrink-0 rounded-full bg-ios-bg flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
            :title="t('header.myShifts')"
            @click="$emit('open-my-shifts')"
          >
            <CalendarClock class="w-5 h-5 text-ios-secondary" />
          </button>

          <!-- Settings Button -->
          <button
            class="h-11 w-11 shrink-0 rounded-full bg-ios-bg flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
            :title="t('header.settings')"
            @click="$emit('open-settings')"
          >
            <Settings class="w-5 h-5 text-ios-secondary" />
          </button>

          <!-- Logout Button -->
          <button
            class="h-11 w-11 shrink-0 rounded-full bg-ios-red/10 flex items-center justify-center transition-all duration-200 ease-out hover:bg-ios-red/20 active:scale-95"
            :title="t('header.logout')"
            @click="handleLogoutClick"
          >
            <LogOut class="w-5 h-5 text-ios-red" />
          </button>
        </div>
      </div>
    </div>

    <!-- Logout Confirmation Modal -->
    <div
      v-if="showLogoutConfirm"
      class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      @click="showLogoutConfirm = false"
    >
      <div
        class="bg-white rounded-3xl p-6 max-w-sm w-full shadow-card-lg"
        @click.stop
      >
        <div class="text-center">
          <div
            class="w-12 h-12 bg-ios-red/10 rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <AlertTriangle class="w-6 h-6 text-ios-red" />
          </div>
          <h3 class="text-lg font-semibold text-ios-text mb-2">
            {{ t("header.logoutConfirmTitle") }}
          </h3>
          <p class="text-ios-secondary mb-6">
            {{ t("header.logoutConfirmMessage") }}
          </p>

          <div class="flex gap-3">
            <button
              class="flex-1 py-2.5 px-4 rounded-full bg-ios-bg text-ios-text font-semibold text-sm transition-all duration-200 ease-out hover:bg-ios-separator active:scale-95"
              @click="showLogoutConfirm = false"
            >
              {{ t("common.cancel") }}
            </button>
            <button
              class="flex-1 py-2.5 px-4 rounded-full bg-ios-red text-white font-semibold text-sm transition-all duration-200 ease-out hover:bg-ios-red/90 active:scale-95"
              @click="confirmLogout"
            >
              {{ t("header.logout") }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  RefreshCw,
  Maximize2,
  Minimize2,
  Bell,
  CalendarClock,
  Settings,
  LogOut,
  AlertTriangle,
  Globe,
} from "lucide-vue-next";
import type { KitchenStats } from "@/types";
import { useI18n } from "@/i18n";
import type { Locale } from "@/i18n";

const { t, locale, localeConfig, switchLocale, supportedLocales } = useI18n();

// Props
interface Props {
  restaurantName: string;
  currentTime: Date;
  stats: KitchenStats;
  connectionStatus?: string;
  isConnected?: boolean;
  viewMode?: "kanban" | "grid";
}

const props = withDefaults(defineProps<Props>(), {
  connectionStatus: "disconnected",
  isConnected: false,
  viewMode: "kanban",
});

// Emits
const emit = defineEmits<{
  logout: [];
  refresh: [];
  reconnect: [];
  "toggle-fullscreen": [];
  "open-my-shifts": [];
  "open-settings": [];
  "update:viewMode": ["kanban" | "grid"];
}>();

// State
const isRefreshing = ref(false);
const isFullscreen = ref(false);
const showLogoutConfirm = ref(false);
const showLanguageMenu = ref(false);

// Computed
const currentViewMode = computed(() => props.viewMode ?? "kanban");

// Methods
const handleLocaleChange = async (code: string) => {
  await switchLocale(code as Locale);
  showLanguageMenu.value = false;
};

const handleLogoutClick = () => {
  showLogoutConfirm.value = true;
};

const confirmLogout = () => {
  showLogoutConfirm.value = false;
  // 延遲一下讓動畫完成
  setTimeout(() => {
    emit("logout");
  }, 100);
};

const checkFullscreenStatus = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

// Handle fullscreen change events
onMounted(() => {
  document.addEventListener("fullscreenchange", checkFullscreenStatus);
  checkFullscreenStatus();
});

onUnmounted(() => {
  document.removeEventListener("fullscreenchange", checkFullscreenStatus);
});

// Handle refresh state (could be managed by parent)
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
