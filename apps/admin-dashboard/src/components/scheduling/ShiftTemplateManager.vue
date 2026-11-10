<template>
  <!-- Modal overlay -->
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isOpen"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
        @click.self="$emit('close')"
      >
        <Transition
          enter-active-class="transition-all duration-250 ease-out"
          enter-from-class="opacity-0 scale-95 translate-y-2"
          enter-to-class="opacity-100 scale-100 translate-y-0"
          leave-active-class="transition-all duration-200 ease-in"
          leave-from-class="opacity-100 scale-100 translate-y-0"
          leave-to-class="opacity-0 scale-95 translate-y-2"
        >
          <div
            v-if="isOpen"
            class="bg-white rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] w-full max-w-xl overflow-hidden"
          >
            <!-- Modal header -->
            <div
              class="flex items-center justify-between px-6 pt-6 pb-4 border-b border-ios-bg"
            >
              <h2 class="text-lg font-bold text-ios-text">管理班次模板</h2>
              <button
                :aria-label="t('common.close')"
                class="w-8 h-8 flex items-center justify-center rounded-full bg-ios-bg hover:bg-ios-separator transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                @click="$emit('close')"
              >
                <X class="w-4 h-4 text-ios-text/60" />
              </button>
            </div>

            <!-- Template list -->
            <div class="px-6 py-4 max-h-64 overflow-y-auto space-y-2">
              <div
                v-for="tpl in templates"
                :key="tpl.id"
                class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-ios-bg transition-colors"
              >
                <!-- Color dot -->
                <span
                  class="w-3 h-3 rounded-full shrink-0"
                  :style="{ backgroundColor: tpl.colorCode || '#007AFF' }"
                />
                <!-- Info -->
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-semibold text-ios-text">
                    {{ tpl.name }}
                  </p>
                  <p class="text-xs text-ios-text/40">
                    {{ tpl.startTime }}–{{ tpl.endTime }}
                  </p>
                </div>
                <!-- Actions -->
                <div class="flex items-center gap-1 shrink-0">
                  <button
                    class="p-1.5 rounded-full hover:bg-ios-blue/10 text-ios-blue transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                    title="編輯"
                    aria-label="編輯"
                    @click="startEdit(tpl)"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button
                    class="p-1.5 rounded-full hover:bg-ios-red/10 text-ios-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                    title="刪除"
                    aria-label="刪除"
                    @click="handleDelete(tpl.id)"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div
                v-if="templates.length === 0"
                class="text-center py-6 text-ios-text/40 text-sm"
              >
                尚無班次模板
              </div>
            </div>

            <!-- Add / Edit form -->
            <div class="px-6 pb-6 pt-2 border-t border-ios-bg">
              <p
                class="text-xs font-semibold text-ios-text/50 uppercase tracking-wide mb-3"
              >
                {{ editingId ? "編輯班次模板" : "新增班次模板" }}
              </p>

              <div class="space-y-3">
                <!-- Name + color row -->
                <div class="flex gap-2">
                  <div class="flex-1">
                    <label class="block text-xs text-ios-text/50 mb-1"
                      >名稱</label
                    >
                    <input
                      v-model="form.name"
                      type="text"
                      placeholder="例：早班"
                      class="w-full px-3 py-2 text-sm bg-ios-bg rounded-xl border-0 outline-none focus:ring-2 focus:ring-ios-blue/30 text-ios-text placeholder-ios-text/30"
                    />
                  </div>
                  <div class="w-20">
                    <label class="block text-xs text-ios-text/50 mb-1"
                      >顏色</label
                    >
                    <input
                      v-model="form.colorCode"
                      type="color"
                      class="w-full h-9 rounded-xl cursor-pointer border-0 bg-ios-bg p-1"
                    />
                  </div>
                </div>

                <!-- Times row -->
                <div class="flex gap-2">
                  <div class="flex-1">
                    <label class="block text-xs text-ios-text/50 mb-1"
                      >開始時間</label
                    >
                    <input
                      v-model="form.startTime"
                      type="time"
                      class="w-full px-3 py-2 text-sm bg-ios-bg rounded-xl border-0 outline-none focus:ring-2 focus:ring-ios-blue/30 text-ios-text"
                    />
                  </div>
                  <div class="flex-1">
                    <label class="block text-xs text-ios-text/50 mb-1"
                      >結束時間</label
                    >
                    <input
                      v-model="form.endTime"
                      type="time"
                      class="w-full px-3 py-2 text-sm bg-ios-bg rounded-xl border-0 outline-none focus:ring-2 focus:ring-ios-blue/30 text-ios-text"
                    />
                  </div>
                </div>

                <!-- Error -->
                <p v-if="formError" class="text-xs text-ios-red">
                  {{ formError }}
                </p>

                <!-- Buttons -->
                <div class="flex gap-2 pt-1">
                  <button
                    v-if="editingId"
                    class="px-3 py-2 text-xs font-medium rounded-full bg-ios-bg text-ios-text/60 hover:bg-ios-separator transition-colors"
                    @click="cancelEdit"
                  >
                    取消
                  </button>
                  <button
                    class="flex-1 px-4 py-2 text-sm font-semibold rounded-full bg-ios-blue text-white hover:bg-blue-600 transition-colors disabled:opacity-50"
                    :disabled="saving"
                    @click="handleSave"
                  >
                    <span v-if="saving">儲存中...</span>
                    <span v-else>{{ editingId ? "更新" : "新增" }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, reactive } from "vue";
import { X, Pencil, Trash2 } from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { schedulingService } from "@/services/schedulingService";
import type { ShiftTemplate } from "@/types/scheduling";
import { t } from "@/i18n";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const props = defineProps<{
  isOpen: boolean;
  templates: ShiftTemplate[];
  restaurantId: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "template-created", template: ShiftTemplate): void;
  (e: "template-updated", template: ShiftTemplate): void;
  (e: "template-deleted", id: number): void;
}>();

const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();

// ── Form state ──────────────────────────────────────────
const editingId = ref<number | null>(null);
const saving = ref(false);
const formError = ref("");

const form = reactive({
  name: "",
  startTime: "08:00",
  endTime: "16:00",
  colorCode: "#007AFF",
});

function resetForm() {
  form.name = "";
  form.startTime = "08:00";
  form.endTime = "16:00";
  form.colorCode = "#007AFF";
  editingId.value = null;
  formError.value = "";
}

function startEdit(tpl: ShiftTemplate) {
  editingId.value = tpl.id;
  form.name = tpl.name;
  form.startTime = tpl.startTime;
  form.endTime = tpl.endTime;
  form.colorCode = tpl.colorCode || "#007AFF";
  formError.value = "";
}

function cancelEdit() {
  resetForm();
}

// ── CRUD ────────────────────────────────────────────────
async function handleSave() {
  if (!form.name.trim()) {
    formError.value = "請輸入班次名稱";
    return;
  }
  if (!form.startTime || !form.endTime) {
    formError.value = "請設定開始和結束時間";
    return;
  }

  // Calculate duration in minutes
  const [sh, sm] = form.startTime.split(":").map(Number);
  const [eh, em] = form.endTime.split(":").map(Number);
  let durationMinutes = eh * 60 + em - (sh * 60 + sm);
  if (durationMinutes <= 0) durationMinutes += 24 * 60; // overnight

  saving.value = true;
  formError.value = "";
  try {
    const data = {
      name: form.name.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      colorCode: form.colorCode,
      shiftType: "regular" as const,
      durationMinutes,
    };

    if (editingId.value) {
      const updated = await schedulingService.updateShiftTemplate(
        editingId.value,
        data,
      );
      emit("template-updated", updated);
    } else {
      const created = await schedulingService.createShiftTemplate(
        props.restaurantId,
        data,
      );
      emit("template-created", created);
    }
    resetForm();
  } catch (e: unknown) {
    formError.value = resolveUserFacingError(e, t, {
      fallbackKey: "errors.generic",
    }).message;
  } finally {
    saving.value = false;
  }
}

async function handleDelete(id: number) {
  const confirmed = await confirmModal({
    type: "danger",
    title: "刪除模板",
    message: "確定要刪除此班次模板？",
    confirmLabel: "刪除",
  });
  if (!confirmed) return;
  try {
    await schedulingService.deleteShiftTemplate(id);
    emit("template-deleted", id);
    if (editingId.value === id) resetForm();
  } catch (e: unknown) {
    toast.error(
      resolveUserFacingError(e, t, { fallbackKey: "errors.deleteFailed" })
        .message,
    );
  }
}
</script>
