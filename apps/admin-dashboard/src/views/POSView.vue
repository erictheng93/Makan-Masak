<template>
  <div class="ui-page pos-container">
    <!-- POS 系統標題 -->
    <div class="ui-toolbar flex justify-between items-center mb-6">
      <div>
        <h1 class="ui-page-heading text-3xl font-bold text-ios-text">
          {{ t("pos.systemTitle") }}
        </h1>
        <p class="text-gray-500 mt-1">{{ t("pos.systemSubtitle") }}</p>
      </div>
      <div class="flex items-center space-x-4">
        <!-- 現在時間 -->
        <div class="text-right">
          <p class="text-sm text-gray-500">{{ t("cashier.currentTime") }}</p>
          <p class="text-lg font-semibold text-ios-text">{{ currentTime }}</p>
        </div>
      </div>
    </div>

    <!-- Tab 導航 -->
    <div
      class="ui-tabs flex gap-1 bg-white rounded-full p-1 mb-6 shadow-ios-sm"
    >
      <router-link
        v-for="tab in tabs"
        :key="tab.name"
        :to="tab.path"
        :class="[
          'flex items-center justify-center px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-200',
          isActiveTab(tab.path)
            ? 'bg-primary-700 text-white shadow-sm'
            : 'text-gray-500 hover:text-gray-700',
        ]"
      >
        <component :is="tab.icon" class="w-4 h-4 mr-2" />
        {{ tab.label }}
      </router-link>
    </div>

    <!-- Tab 內容 -->
    <router-view />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "@/i18n";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { ShoppingCart, Settings2 } from "lucide-vue-next";

const route = useRoute();
const { t } = useI18n();
const { formatTimeWithSeconds } = useDateFormatter();

const currentTime = ref("");
let timeInterval: NodeJS.Timeout | null = null;

const tabs = computed(() => [
  {
    name: "checkout",
    label: t("pos.tabs.checkout"),
    path: "/dashboard/pos/checkout",
    icon: ShoppingCart,
  },
  {
    name: "management",
    label: t("pos.tabs.management"),
    path: "/dashboard/pos/management",
    icon: Settings2,
  },
]);

const isActiveTab = (path: string) => {
  return route.path === path || route.path.startsWith(path + "/");
};

const updateCurrentTime = () => {
  currentTime.value = formatTimeWithSeconds(new Date());
};

onMounted(() => {
  updateCurrentTime();
  timeInterval = setInterval(updateCurrentTime, 1000);
});

onUnmounted(() => {
  if (timeInterval) clearInterval(timeInterval);
});
</script>

<style scoped>
.pos-container {
  padding: 1.5rem;
  min-height: 100vh;
  background-color: theme("colors.ios-bg");
}

@media (max-width: 640px) {
  .pos-container {
    padding: 1rem;
  }
}
</style>
