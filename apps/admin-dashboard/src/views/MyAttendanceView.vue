<template>
  <div class="min-h-full bg-ios-bg -mx-4 -my-4 px-4 py-6 sm:-mx-6 sm:px-6">
    <div class="max-w-3xl mx-auto space-y-6">
      <!-- Page header -->
      <header>
        <h1 class="text-2xl font-bold text-ios-text">
          {{ t("myAttendance.title") }}
        </h1>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("myAttendance.subtitle") }}
        </p>
      </header>

      <!-- No restaurant on the session: the panel needs one to load a shift,
           and an empty page would read as "no shift today". -->
      <div
        v-if="!restaurantId"
        data-testid="my-attendance-error"
        class="flex items-start gap-3 rounded-2xl bg-white p-5 shadow-ios-card"
      >
        <ExclamationTriangleIcon class="h-5 w-5 shrink-0 text-ios-red" />
        <p class="flex-1 text-sm font-semibold text-ios-text">
          {{ t("myShifts.noRestaurant") }}
        </p>
      </div>

      <ClockInOutPanel
        v-else
        :restaurant-id="restaurantId"
        :employee-id="employeeId"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Employee-facing clock in/out (#308).
 *
 * ClockInOutPanel had no importer at all until d08c7f4b mounted it on the
 * attendance tab under /dashboard/employees — but that route is ADMIN/OWNER
 * only, so it gave managers a 代打 surface and left the people who actually
 * work the shifts with no way in. This is the same self-service shape as
 * MyShiftsView (#320) and MyLeavesView (#344), and needs no new endpoint:
 * GET /scheduling/:restaurantId/schedules carries no role gate and pins
 * employeeId to the session for roles 2-4, and clock-in/clock-out do the same
 * with the body's employeeId, so an employee can only ever reach their own
 * shift.
 *
 * employeeId is passed rather than left to the panel's own fallback so a
 * manager opening this page clocks themselves, not whoever the panel would
 * otherwise resolve.
 */
import { computed } from "vue";
import { ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import ClockInOutPanel from "@/components/scheduling/ClockInOutPanel.vue";

const { t } = useI18n();
const authStore = useAuthStore();

const restaurantId = computed(() => authStore.restaurantId || "");
const employeeId = computed(() => authStore.user?.id);
</script>
