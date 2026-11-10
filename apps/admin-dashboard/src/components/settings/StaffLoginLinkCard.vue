<template>
  <div class="bg-white rounded-lg shadow p-6" data-testid="staff-login-card">
    <h3 class="text-lg font-semibold text-gray-900 mb-1">
      {{ t("settings.staffLogin.title") }}
    </h3>
    <p class="text-sm text-gray-600 mb-4">
      {{ t("settings.staffLogin.description") }}
    </p>

    <div v-if="current" class="space-y-3 mb-6">
      <div v-for="link in links" :key="link.id">
        <label class="form-label">{{ link.label }}</label>
        <div class="flex items-center gap-2">
          <input
            :value="link.url"
            readonly
            class="form-input flex-1"
            :data-testid="`staff-login-${link.id}-url`"
          />
          <button
            type="button"
            class="btn-secondary rounded-full"
            :data-testid="`staff-login-${link.id}-copy`"
            @click="copy(link.url)"
          >
            {{ t("settings.staffLogin.copy") }}
          </button>
        </div>
      </div>
    </div>
    <p v-else class="text-sm text-gray-500 mb-6">
      {{ t("settings.staffLogin.notSet") }}
    </p>

    <form class="space-y-2" @submit.prevent="save">
      <label for="login-slug" class="form-label">{{
        t("settings.staffLogin.code")
      }}</label>
      <div class="flex items-center gap-2">
        <input
          id="login-slug"
          v-model.trim="draft"
          type="text"
          autocomplete="off"
          class="form-input flex-1"
          :class="{ 'border-red-500': fieldError }"
          data-testid="staff-login-slug-input"
          @input="fieldError = ''"
        />
        <button
          type="submit"
          class="btn-primary rounded-full"
          :disabled="saving || draft === current"
          data-testid="staff-login-save"
        >
          {{ t("settings.staffLogin.save") }}
        </button>
      </div>
      <p
        v-if="fieldError"
        class="text-sm text-red-600"
        data-testid="staff-login-slug-error"
      >
        {{ fieldError }}
      </p>
      <p v-else class="text-xs text-gray-500">
        {{ t("settings.staffLogin.codeHint") }}
      </p>
      <p v-if="current" class="text-xs text-orange-600">
        {{ t("settings.staffLogin.changeWarning") }}
      </p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { api } from "@/services/api";
import { KITCHEN_DISPLAY_URL } from "@/utils/loginRedirect";
import { RESERVED_SHOP_SLUGS, SHOP_SLUG_PATTERN } from "@/utils/loginShop";
import { getApiErrorStatus } from "@makanmasak/shared/utils/unknown";

const props = defineProps<{
  restaurantId: string;
  loginSlug: string | null;
}>();
const emit = defineEmits<{ saved: [slug: string] }>();

const { t } = useI18n();
const toast = useToast();

const current = ref(props.loginSlug);
const draft = ref(props.loginSlug ?? "");
const saving = ref(false);
const fieldError = ref("");

watch(
  () => props.loginSlug,
  (slug) => {
    current.value = slug;
    draft.value = slug ?? "";
  },
);

const links = computed(() => [
  {
    id: "admin",
    label: t("settings.staffLogin.adminLink"),
    url: `${window.location.origin}/s/${current.value}`,
  },
  {
    id: "kitchen",
    label: t("settings.staffLogin.kitchenLink"),
    url: `${KITCHEN_DISPLAY_URL}/s/${current.value}`,
  },
]);

const copy = async (url: string) => {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(t("settings.staffLogin.copied"));
  } catch {
    toast.error(t("settings.staffLogin.copyFailed"));
  }
};

const validate = (slug: string): string => {
  if (!SHOP_SLUG_PATTERN.test(slug)) return t("settings.staffLogin.invalid");
  if (RESERVED_SHOP_SLUGS.includes(slug)) {
    return t("settings.staffLogin.reserved");
  }
  return "";
};

const save = async () => {
  if (saving.value) return;
  fieldError.value = validate(draft.value);
  if (fieldError.value) return;

  saving.value = true;
  try {
    await api.put(`/restaurants/${props.restaurantId}/login-slug`, {
      loginSlug: draft.value,
    });
    current.value = draft.value;
    toast.success(t("settings.staffLogin.saved"));
    emit("saved", draft.value);
  } catch (error: unknown) {
    const code = (
      error as { response?: { data?: { error?: { code?: string } } } }
    ).response?.data?.error?.code;
    if (getApiErrorStatus(error) === 409 || code === "SLUG_TAKEN") {
      fieldError.value = t("settings.staffLogin.taken");
    } else if (code === "SLUG_RESERVED") {
      fieldError.value = t("settings.staffLogin.reserved");
    } else if (code === "SLUG_INVALID") {
      fieldError.value = t("settings.staffLogin.invalid");
    } else {
      toast.error(t("settings.staffLogin.saveFailed"));
    }
  } finally {
    saving.value = false;
  }
};
</script>
