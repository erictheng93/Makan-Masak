<template>
  <div class="flex h-screen bg-ios-bg">
    <!-- Mobile overlay backdrop -->
    <Transition name="fade">
      <div
        v-if="isMobile && !isSidebarCollapsed"
        class="fixed inset-0 bg-black/30 backdrop-blur-sm z-30"
        @click="isSidebarCollapsed = true"
      />
    </Transition>

    <Sidebar
      :is-collapsed="isSidebarCollapsed"
      :is-mobile="isMobile"
      @toggle="toggleSidebar"
      @navigate="onSidebarNavigate"
    />

    <div class="flex-1 flex flex-col overflow-hidden">
      <Header @toggle-sidebar="toggleSidebar" />

      <RestaurantContextBanner />

      <main class="flex-1 overflow-y-auto p-4">
        <router-view />
      </main>
    </div>

    <NotificationPanel
      v-if="showNotifications"
      @close="showNotifications = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import Sidebar from "@/components/layout/Sidebar.vue";
import Header from "@/components/layout/Header.vue";
import NotificationPanel from "@/components/layout/NotificationPanel.vue";
import RestaurantContextBanner from "@/components/layout/RestaurantContextBanner.vue";
import { useRealtimeConnection } from "@/composables/useRealtimeConnection";
import { useAuthStore } from "@/stores/auth";
import { useRestaurantCurrency } from "@/composables/useRestaurantCurrency";

const MOBILE_BREAKPOINT = 1024;
const isMobile = ref(false);
const isSidebarCollapsed = ref(false);
const showNotifications = ref(false);

const { connect, disconnect } = useRealtimeConnection();
const authStore = useAuthStore();
useRestaurantCurrency();

function checkMobile() {
  const wasMobile = isMobile.value;
  isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
  if (isMobile.value && !wasMobile) {
    isSidebarCollapsed.value = true;
  }
}

const toggleSidebar = () => {
  isSidebarCollapsed.value = !isSidebarCollapsed.value;
};

const onSidebarNavigate = () => {
  if (isMobile.value) {
    isSidebarCollapsed.value = true;
  }
};

onMounted(() => {
  checkMobile();
  window.addEventListener("resize", checkMobile);
});

// Reactively connect/disconnect realtime WebSocket based on restaurant context
watch(
  () => authStore.restaurantId,
  (newId, oldId) => {
    if (oldId) disconnect();
    if (newId) connect();
  },
  { immediate: true },
);

onUnmounted(() => {
  window.removeEventListener("resize", checkMobile);
  disconnect();
});
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
