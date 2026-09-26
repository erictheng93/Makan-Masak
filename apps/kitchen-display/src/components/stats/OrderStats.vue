<template>
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <!-- Pending -->
    <div
      class="bg-gradient-to-br from-ios-orange-soft to-orange-200 rounded-2xl p-3 text-center shadow-card-sm"
    >
      <div class="text-kitchen-stats text-ios-orange-deep">
        {{ stats.pendingCount }}
      </div>
      <div class="text-xs font-semibold text-ios-orange-deep">
        {{ t("stats.pending") }}
      </div>
    </div>

    <!-- Preparing -->
    <div
      class="bg-gradient-to-br from-ios-blue-soft to-blue-200 rounded-2xl p-3 text-center shadow-card-sm"
    >
      <div class="text-kitchen-stats text-ios-blue-deep">
        {{ stats.preparingCount }}
      </div>
      <div class="text-xs font-semibold text-ios-blue-deep">
        {{ t("stats.preparing") }}
      </div>
    </div>

    <!-- Ready -->
    <div
      class="bg-gradient-to-br from-ios-green-soft to-green-200 rounded-2xl p-3 text-center shadow-card-sm"
    >
      <div class="text-kitchen-stats text-ios-green-deep">
        {{ stats.readyCount }}
      </div>
      <div class="text-xs font-semibold text-ios-green-deep">
        {{ t("stats.completed") }}
      </div>
    </div>

    <!-- Urgent -->
    <div
      class="bg-gradient-to-br from-ios-red-soft to-red-200 rounded-2xl p-3 text-center shadow-card-sm"
    >
      <div class="text-kitchen-stats text-ios-red-deep">
        {{ stats.urgentOrders }}
      </div>
      <div class="text-xs font-semibold text-ios-red-deep">
        {{ t("stats.urgentOrders") }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "@/i18n";
import type { KitchenStats } from "@/types";

const { t } = useI18n();

interface Props {
  stats: KitchenStats;
  loading?: boolean;
}

defineProps<Props>();

defineEmits<{
  refresh: [];
}>();
</script>
