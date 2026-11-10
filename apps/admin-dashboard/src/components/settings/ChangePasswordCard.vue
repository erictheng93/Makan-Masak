<template>
  <section
    class="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
    data-testid="change-password-card"
  >
    <h3 class="text-lg font-semibold text-ios-text mb-1">
      {{ t("settings.security.changePassword.title") }}
    </h3>
    <p class="text-sm text-ios-text/60 mb-4">
      {{ t("settings.security.changePassword.description") }}
    </p>
    <form class="space-y-4 max-w-md" @submit.prevent="submit">
      <div>
        <label
          for="change-password-current"
          class="block text-sm font-medium text-ios-text/70 mb-1"
        >
          {{ t("settings.security.changePassword.current") }}
        </label>
        <input
          id="change-password-current"
          v-model="currentPassword"
          data-testid="change-password-current"
          type="password"
          autocomplete="current-password"
          required
          class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
        />
      </div>
      <div>
        <label
          for="change-password-new"
          class="block text-sm font-medium text-ios-text/70 mb-1"
        >
          {{ t("settings.security.changePassword.new") }}
        </label>
        <input
          id="change-password-new"
          v-model="newPassword"
          data-testid="change-password-new"
          type="password"
          autocomplete="new-password"
          required
          class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
        />
        <p class="mt-1 text-xs text-ios-text/50">
          {{ t("accountManagement.passwordStrength") }}
        </p>
      </div>
      <div>
        <label
          for="change-password-confirm"
          class="block text-sm font-medium text-ios-text/70 mb-1"
        >
          {{ t("settings.security.changePassword.confirm") }}
        </label>
        <input
          id="change-password-confirm"
          v-model="confirmPassword"
          data-testid="change-password-confirm"
          type="password"
          autocomplete="new-password"
          required
          class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
        />
      </div>
      <p
        v-if="error"
        role="alert"
        data-testid="change-password-error"
        class="text-sm text-ios-red"
      >
        {{ error }}
      </p>
      <button
        type="submit"
        data-testid="change-password-submit"
        :disabled="saving"
        class="px-5 py-2 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {{ t("settings.security.changePassword.submit") }}
      </button>
    </form>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth";
import { currentLoginPath } from "@/utils/loginShop";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();
const toast = useToast();
const router = useRouter();
const authStore = useAuthStore();

// Mirrors passwordSchema in apps/api/src/features/authentication/schemas/validation.ts
// (unanchored at the end, same as ResetPasswordModal).
const PASSWORD_RULE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;

const currentPassword = ref("");
const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const saving = ref(false);

async function submit() {
  const next = newPassword.value;
  if (next.length < 8 || next.length > 100 || !PASSWORD_RULE.test(next)) {
    error.value = t("accountManagement.passwordStrength");
    return;
  }
  if (next !== confirmPassword.value) {
    error.value = t("users.resetPasswordModal.mismatch");
    return;
  }
  if (next === currentPassword.value) {
    error.value = t("settings.security.changePassword.sameAsCurrent");
    return;
  }
  error.value = "";
  saving.value = true;
  try {
    await api.post("/auth/change-password", {
      currentPassword: currentPassword.value,
      newPassword: next,
      confirmPassword: confirmPassword.value,
    });
  } catch (e: unknown) {
    error.value = resolveUserFacingError(e, t, {
      // A wrong current password comes back as this code, not as a 401.
      dedicatedCodeKeys: {
        PASSWORD_CHANGE_FAILED: "settings.security.changePassword.failed",
      },
      fallbackKey: "settings.security.changePassword.failed",
    }).message;
    saving.value = false;
    return;
  }
  // The API revokes every session, this one included, so sign in again.
  toast.success(t("settings.security.changePassword.success"));
  await authStore.logout();
  saving.value = false;
  await router.push(currentLoginPath());
}
</script>
