<template>
  <div
    v-if="user"
    class="fixed inset-0 z-50 overflow-y-auto"
    data-testid="reset-password-modal"
  >
    <div class="flex items-center justify-center min-h-screen px-4">
      <div
        class="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
        @click="close"
      />
      <div
        class="relative bg-white rounded-2xl shadow-xl max-w-md w-full"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-password-title"
      >
        <form class="p-6" @submit.prevent="submit">
          <h3
            id="reset-password-title"
            class="text-lg font-semibold text-ios-text mb-1"
          >
            {{ t("users.resetPasswordModal.title") }}
          </h3>
          <p class="text-sm text-ios-text/60 mb-4">
            {{
              t("users.resetPasswordModal.description", {
                username: user.username,
              })
            }}
          </p>

          <div class="space-y-4">
            <div>
              <label
                for="reset-password-new"
                class="block text-sm font-medium text-ios-text/70 mb-1"
              >
                {{ t("users.resetPasswordModal.newPassword") }}
              </label>
              <input
                id="reset-password-new"
                v-model="newPassword"
                data-testid="reset-password-new"
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
                for="reset-password-confirm"
                class="block text-sm font-medium text-ios-text/70 mb-1"
              >
                {{ t("users.resetPasswordModal.confirmPassword") }}
              </label>
              <input
                id="reset-password-confirm"
                v-model="confirmPassword"
                data-testid="reset-password-confirm"
                type="password"
                autocomplete="new-password"
                required
                class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
              />
            </div>

            <p
              v-if="error"
              role="alert"
              data-testid="reset-password-error"
              class="text-sm text-ios-red"
            >
              {{ error }}
            </p>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button
              type="button"
              class="px-5 py-2 rounded-full text-[13px] font-semibold text-ios-text/60 bg-ios-bg hover:bg-ios-separator transition-colors"
              @click="close"
            >
              {{ t("users.modal.cancel") }}
            </button>
            <button
              type="submit"
              data-testid="reset-password-submit"
              :disabled="saving"
              class="px-5 py-2 rounded-full text-[13px] font-semibold bg-ios-orange text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {{ t("users.resetPasswordModal.submit") }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { api } from "@/services/api";
import type { UserId } from "@/types/api-user";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

/**
 * The person resetting types the new password, so they know it and can hand
 * it over. The old flow generated one client-side and never showed it, which
 * left the account unusable by anyone.
 */
const props = defineProps<{
  user: { id: UserId; username: string } | null;
}>();

const emit = defineEmits<{
  close: [];
  done: [];
}>();

const { t } = useI18n();
const toast = useToast();

// Mirrors strongPasswordSchema in apps/api/src/features/users/schemas/validation.ts
// exactly: its regex is unanchored at the end, so only the first character is
// restricted to the set. A stricter copy here would refuse passwords the API
// accepts, such as "Pass_word1!".
const PASSWORD_RULE =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const meetsPasswordRule = (password: string) =>
  password.length >= 8 &&
  password.length <= 100 &&
  PASSWORD_RULE.test(password);

const newPassword = ref("");
const confirmPassword = ref("");
const error = ref("");
const saving = ref(false);

watch(
  () => props.user,
  () => {
    newPassword.value = "";
    confirmPassword.value = "";
    error.value = "";
  },
);

function close() {
  if (!saving.value) emit("close");
}

async function submit() {
  if (!props.user) return;
  if (!meetsPasswordRule(newPassword.value)) {
    error.value = t("accountManagement.passwordStrength");
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = t("users.resetPasswordModal.mismatch");
    return;
  }
  error.value = "";
  saving.value = true;
  try {
    await api.post(`/users/${props.user.id}/reset-password`, {
      newPassword: newPassword.value,
      confirmPassword: confirmPassword.value,
    });
    toast.success(
      t("users.confirm.resetPasswordSuccess", {
        username: props.user.username,
      }),
    );
    emit("done");
  } catch (e: unknown) {
    error.value = resolveUserFacingError(e, t, {
      fallbackKey: "users.errors.resetFailed",
    }).message;
  } finally {
    saving.value = false;
  }
}
</script>
