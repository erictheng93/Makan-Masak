<template>
  <div class="flex items-center" :class="compact ? 'gap-1' : 'gap-2'">
    <button
      v-for="a in actions"
      :key="a.key"
      type="button"
      class="inline-flex items-center justify-center rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
      :class="[compact ? 'w-11 h-11' : 'p-1.5', a.class]"
      :title="a.label"
      :aria-label="a.label"
      :disabled="a.disabled"
      @click="emit(a.key)"
    >
      <component :is="a.icon" class="w-4 h-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from "vue";
import { useI18n } from "@/i18n";
import {
  Pencil,
  KeyRound,
  UserX,
  UserCheck,
  UserMinus,
  UserRoundPlus,
} from "lucide-vue-next";
import type { Employee } from "@/types/employee";

type ActionKey = "edit" | "reset" | "toggle" | "archive" | "restore";
interface Action {
  key: ActionKey;
  label: string;
  icon: Component;
  class: string;
  disabled: boolean;
}

const props = defineProps<{
  user: Employee;
  archived: boolean;
  busy?: boolean;
  isAdministrator: boolean;
  compact?: boolean;
}>();
const emit = defineEmits<{
  (e: ActionKey): void;
}>();
const { t } = useI18n();

const actions = computed<Action[]>(() => {
  const busy = !!props.busy;
  const list: Action[] = [
    {
      key: "edit",
      label: t("users.actions.edit"),
      icon: Pencil,
      class: "text-ios-blue hover:bg-ios-blue/10",
      disabled: false,
    },
  ];
  if (props.user.role !== 0 || props.isAdministrator)
    list.push({
      key: "reset",
      label: t("users.actions.resetPassword"),
      icon: KeyRound,
      class: "text-ios-orange hover:bg-ios-orange/10",
      disabled: false,
    });
  if (props.archived) {
    list.push({
      key: "restore",
      label: t("users.actions.restore"),
      icon: UserRoundPlus,
      class: "text-ios-green hover:bg-ios-green/10",
      disabled: busy,
    });
  } else {
    const active = props.user.status === "active";
    list.push(
      {
        key: "toggle",
        label: active ? t("users.actions.disable") : t("users.actions.enable"),
        icon: active ? UserX : UserCheck,
        class: active
          ? "text-ios-red hover:bg-ios-red/10"
          : "text-ios-green hover:bg-ios-green/10",
        disabled: busy,
      },
      {
        key: "archive",
        label: t("users.actions.archive"),
        icon: UserMinus,
        class: "text-ios-red hover:bg-ios-red/10",
        disabled: busy,
      },
    );
  }
  return list;
});
</script>
