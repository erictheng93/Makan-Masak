<template>
  <div id="app" class="min-h-screen">
    <NavigationProgress />
    <router-view />
    <ConfirmModal />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import NavigationProgress from "@/components/layout/NavigationProgress.vue";
import ConfirmModal from "@/components/common/ConfirmModal.vue";

const authStore = useAuthStore();
const router = useRouter();

onMounted(async () => {
  // Skip auth check on public pages (login, forgot-password, etc.)
  // to avoid triggering unnecessary refresh requests that can
  // abort subsequent login calls (net::ERR_ABORTED).
  const publicRoutes = ["Login", "ForgotPassword", "ResetPassword"];
  const currentRoute = router.currentRoute.value.name;
  if (currentRoute && publicRoutes.includes(currentRoute as string)) return;

  await authStore.checkAuth();
});
</script>
