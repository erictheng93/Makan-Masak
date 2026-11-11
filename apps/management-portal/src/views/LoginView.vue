<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ArrowRightOnRectangleIcon } from "@heroicons/vue/24/outline";
import { authApi } from "@/services/api";
import { saveManagementSession } from "@/services/auth";

const route = useRoute();
const router = useRouter();

const apiToken = ref("");
const loading = ref(false);
const errorMessage = ref("");

const redirectTarget = computed(() => {
  const redirect = route.query.redirect;
  return typeof redirect === "string" &&
    redirect.startsWith("/") &&
    !redirect.startsWith("//")
    ? redirect
    : "/";
});

async function submit() {
  const token = apiToken.value.trim();
  if (!token) {
    errorMessage.value = "請輸入 API admin token";
    return;
  }

  loading.value = true;
  errorMessage.value = "";
  try {
    const session = await authApi.exchange(token);
    saveManagementSession({
      token: session.token,
      expiresAt: session.expiresAt,
    });
    await router.replace(redirectTarget.value);
  } catch {
    errorMessage.value = "登入失敗，請確認 token 仍有效且具備平台管理員權限";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main
    class="portal-page ui-page min-h-screen bg-gray-100 flex items-center justify-center px-4 py-12"
  >
    <section class="w-full max-w-md bg-white rounded-3xl shadow-card p-6">
      <div class="mb-6">
        <p class="text-lg font-bold text-green-700">MakanMasak</p>
        <h1 class="mt-2 text-2xl font-semibold text-gray-900">管理平台登入</h1>
        <p class="mt-2 text-sm text-gray-600">
          使用 API 平台管理員 token 換取管理平台工作階段。
        </p>
      </div>

      <form class="space-y-5" @submit.prevent="submit">
        <div>
          <label for="api-token" class="label">API admin token</label>
          <textarea
            id="api-token"
            v-model="apiToken"
            class="input min-h-28 resize-y font-mono text-xs"
            :class="{ 'input-error': errorMessage }"
            :aria-invalid="errorMessage ? 'true' : undefined"
            :aria-describedby="errorMessage ? 'portal-login-error' : undefined"
            autocomplete="off"
            spellcheck="false"
            required
          />
        </div>

        <p
          v-if="errorMessage"
          id="portal-login-error"
          class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          class="btn btn-primary w-full"
          :disabled="loading"
        >
          <ArrowRightOnRectangleIcon class="mr-2 h-5 w-5" />
          {{ loading ? "登入中..." : "登入管理平台" }}
        </button>
      </form>
    </section>
  </main>
</template>
