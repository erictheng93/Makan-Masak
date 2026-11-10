<template>
  <div v-if="isOpen" class="fixed inset-0 z-50 overflow-y-auto">
    <div class="flex items-center justify-center min-h-screen px-4">
      <div
        class="fixed inset-0 bg-black/30 backdrop-blur-[2px]"
        @click="$emit('close')"
      />
      <div class="relative bg-white rounded-2xl shadow-xl max-w-md w-full">
        <div class="p-6">
          <h3 class="text-lg font-semibold text-ios-text mb-4">
            {{
              employee ? t("users.modal.editTitle") : t("users.modal.addTitle")
            }}
          </h3>

          <form @submit.prevent="handleSave">
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-ios-text/70 mb-1">
                  {{ t("users.modal.usernameLabel") }}
                  <span class="text-ios-red">*</span>
                </label>
                <input
                  v-model="form.username"
                  type="text"
                  required
                  :disabled="!!employee"
                  class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all disabled:opacity-50"
                />
                <p
                  v-if="errors.username"
                  data-testid="error-username"
                  role="alert"
                  class="mt-1 text-xs text-ios-red"
                >
                  {{ errors.username }}
                </p>
              </div>

              <div v-if="!employee">
                <label class="block text-sm font-medium text-ios-text/70 mb-1">
                  {{ t("users.modal.passwordLabel") }}
                  <span class="text-ios-red">*</span>
                </label>
                <input
                  v-model="form.password"
                  type="password"
                  required
                  autocomplete="new-password"
                  aria-describedby="employee-password-hint"
                  class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
                />
                <p
                  id="employee-password-hint"
                  data-testid="password-hint"
                  class="mt-1 text-xs"
                  :class="passwordInvalid ? 'text-ios-red' : 'text-ios-text/50'"
                >
                  {{ t("users.modal.passwordHint") }}
                </p>
                <p
                  v-if="errors.password"
                  data-testid="error-password"
                  role="alert"
                  class="mt-1 text-xs text-ios-red"
                >
                  {{ errors.password }}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-ios-text/70 mb-1">
                  {{ t("users.modal.fullNameLabel") }}
                </label>
                <input
                  v-model="form.fullName"
                  type="text"
                  class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
                />
                <p
                  v-if="errors.fullName"
                  data-testid="error-fullName"
                  role="alert"
                  class="mt-1 text-xs text-ios-red"
                >
                  {{ errors.fullName }}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-ios-text/70 mb-1">
                  {{ t("users.modal.emailLabel") }}
                </label>
                <input
                  v-model="form.email"
                  type="email"
                  class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
                />
                <p
                  v-if="errors.email"
                  data-testid="error-email"
                  role="alert"
                  class="mt-1 text-xs text-ios-red"
                >
                  {{ errors.email }}
                </p>
              </div>

              <div>
                <label class="block text-sm font-medium text-ios-text/70 mb-1">
                  {{ t("users.modal.roleLabel") }}
                  <span class="text-ios-red">*</span>
                </label>
                <select
                  v-model.number="form.role"
                  required
                  class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
                >
                  <option :value="null" disabled>
                    {{ t("users.modal.selectRole") }}
                  </option>
                  <option value="1">{{ t("users.search.ownerRole") }}</option>
                  <option value="2">{{ t("users.search.chefRole") }}</option>
                  <option value="3">{{ t("users.search.serviceRole") }}</option>
                  <option value="4">{{ t("users.search.cashierRole") }}</option>
                </select>
              </div>

              <div v-if="employee">
                <label class="block text-sm font-medium text-ios-text/70 mb-1">
                  {{ t("users.modal.statusLabel") }}
                </label>
                <select
                  v-model="form.status"
                  class="w-full px-3.5 py-2.5 bg-ios-bg border-none rounded-xl text-ios-text focus:shadow-[0_0_0_2px_rgba(0,122,255,0.25)] focus:bg-white transition-all"
                >
                  <option value="active">{{ t("users.status.active") }}</option>
                  <option value="inactive">
                    {{ t("users.status.inactive") }}
                  </option>
                </select>
              </div>
            </div>

            <div class="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                class="px-5 py-2 rounded-full text-[13px] font-semibold text-ios-text/60 bg-ios-bg hover:bg-ios-separator transition-colors"
                @click="$emit('close')"
              >
                {{ t("users.modal.cancel") }}
              </button>
              <button
                type="submit"
                :disabled="saving"
                class="px-5 py-2 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {{
                  saving
                    ? t("common.saving")
                    : employee
                      ? t("users.modal.update")
                      : t("users.modal.add")
                }}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "@/i18n";
import type { Employee, EmployeeFormData } from "@/types/employee";

const props = defineProps<{
  isOpen: boolean;
  employee?: Employee | null;
  /** Owned by the parent: true while the save request is in flight. */
  saving?: boolean;
  /** Server (or parent) field messages keyed by field name. */
  fieldErrors?: Record<string, string>;
}>();

const emit = defineEmits<{
  close: [];
  save: [form: EmployeeFormData, isEdit: boolean];
}>();

const { t } = useI18n();

// Mirrors apps/api users/schemas/validation.ts strongPasswordSchema.
const PASSWORD_STRENGTH_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/;
const isStrongPassword = (p: string) =>
  p.length >= 8 && p.length <= 100 && PASSWORD_STRENGTH_REGEX.test(p);

const passwordInvalid = ref(false);
const errors = computed(() => props.fieldErrors ?? {});

const form = ref<EmployeeFormData>({
  username: "",
  password: "",
  fullName: "",
  email: "",
  role: null,
  status: "active",
});

watch(
  () => props.isOpen,
  (open) => {
    passwordInvalid.value = false;
    if (open && props.employee) {
      form.value = {
        username: props.employee.username,
        password: "",
        fullName: props.employee.fullName || "",
        email: props.employee.email || "",
        role: props.employee.role,
        status: props.employee.status === "active" ? "active" : "inactive",
      };
    } else if (open) {
      form.value = {
        username: "",
        password: "",
        fullName: "",
        email: "",
        role: null,
        status: "active",
      };
    }
  },
);

watch(
  () => form.value.password,
  () => (passwordInvalid.value = false),
);

const handleSave = () => {
  if (props.saving) return;
  if (!props.employee && !isStrongPassword(form.value.password)) {
    passwordInvalid.value = true;
    return;
  }
  emit("save", { ...form.value }, !!props.employee);
};
</script>
