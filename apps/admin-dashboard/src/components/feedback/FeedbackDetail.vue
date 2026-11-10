<template>
  <div class="space-y-4">
    <!-- Metadata card -->
    <div class="bg-white rounded-2xl p-5 shadow-sm">
      <!-- Edit mode -->
      <template v-if="isEditingFeedback">
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-ios-secondary mb-1">{{
              t("feedback.subjectLabel")
            }}</label>
            <input
              v-model="editForm.subject"
              type="text"
              maxlength="200"
              class="w-full px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all"
            />
            <span class="text-[10px] text-ios-secondary mt-0.5 block text-right"
              >{{ editForm.subject.length }}/200</span
            >
          </div>
          <div class="flex flex-wrap gap-3">
            <div class="flex-1 min-w-[120px]">
              <label
                class="block text-xs font-medium text-ios-secondary mb-1"
                >{{ t("feedback.typeLabel") }}</label
              >
              <select
                v-model="editForm.category"
                class="w-full px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
              >
                <option
                  v-for="cat in feedbackCategories"
                  :key="cat"
                  :value="cat"
                >
                  {{ t(`feedback.categories.${cat}`) }}
                </option>
              </select>
            </div>
            <div class="flex-1 min-w-[120px]">
              <label
                class="block text-xs font-medium text-ios-secondary mb-1"
                >{{ t("feedback.priorityLabel") }}</label
              >
              <select
                v-model="editForm.priority"
                class="w-full px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
              >
                <option v-for="p in feedbackPriorities" :key="p" :value="p">
                  {{ t(`feedback.priorities.${p}`) }}
                </option>
              </select>
            </div>
            <div class="flex-1 min-w-[120px]">
              <label
                class="block text-xs font-medium text-ios-secondary mb-1"
                >{{ t("feedback.moduleLabel") }}</label
              >
              <select
                v-model="editForm.relatedModule"
                class="w-full px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
              >
                <option v-for="m in feedbackModules" :key="m" :value="m">
                  {{ t(`feedback.modules.${m}`) }}
                </option>
              </select>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-ios-secondary mb-1">{{
              t("feedback.descriptionLabel")
            }}</label>
            <textarea
              v-model="editForm.description"
              rows="4"
              maxlength="5000"
              class="w-full px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all resize-none"
            />
            <span class="text-[10px] text-ios-secondary mt-0.5 block text-right"
              >{{ editForm.description.length }}/5000</span
            >
          </div>
          <div class="flex items-center gap-2">
            <button
              :disabled="!isEditFormValid"
              class="px-4 py-1.5 rounded-full text-xs font-semibold bg-ios-blue text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              @click="handleSaveFeedback"
            >
              {{ t("feedback.saveEdit") }}
            </button>
            <button
              class="px-4 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-ios-text/85 hover:bg-gray-200 transition-all"
              @click="cancelFeedbackEdit"
            >
              {{ t("feedback.cancelEdit") }}
            </button>
          </div>
        </div>
      </template>

      <!-- Read-only mode -->
      <template v-else>
        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="flex-1">
            <h2 class="text-lg font-semibold text-ios-text mb-1">
              {{ feedback.subject }}
            </h2>
            <div class="flex flex-wrap items-center gap-2 mt-2">
              <span
                class="px-2.5 py-0.5 rounded-full text-xs font-medium"
                :class="categoryClass(feedback.category)"
              >
                {{ t(`feedback.categories.${feedback.category}`) }}
              </span>
              <span
                class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                :class="priorityClass(feedback.priority)"
              >
                {{ t(`feedback.priorities.${feedback.priority}`) }}
              </span>
              <span
                class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                :class="statusClass(feedback.status)"
              >
                {{ t(`feedback.statuses.${feedback.status}`) }}
              </span>
              <span
                class="px-2.5 py-0.5 rounded-full text-xs bg-gray-100 text-ios-text/85"
              >
                {{ t(`feedback.modules.${feedback.relatedModule}`) }}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 flex-shrink-0">
            <!-- Edit / Delete feedback buttons -->
            <template v-if="canEditFeedback">
              <button
                class="p-1.5 rounded-xl text-ios-secondary hover:text-ios-blue hover:bg-ios-blue/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                :title="t('feedback.editFeedback')"
                :aria-label="t('feedback.editFeedback')"
                @click="startFeedbackEdit"
              >
                <Pencil class="w-4 h-4" />
              </button>
              <button
                class="p-1.5 rounded-xl text-ios-secondary hover:text-ios-red hover:bg-ios-red/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                :title="t('feedback.deleteFeedback')"
                :aria-label="t('feedback.deleteFeedback')"
                @click="isDeletingFeedback = true"
              >
                <Trash2 class="w-4 h-4" />
              </button>
            </template>
            <!-- Admin: status update -->
            <select
              v-if="isAdmin"
              :value="feedback.status"
              class="px-3 py-1.5 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
              @change="handleStatusChange"
            >
              <option value="open">{{ t("feedback.statuses.open") }}</option>
              <option value="in_progress">
                {{ t("feedback.statuses.in_progress") }}
              </option>
              <option value="resolved">
                {{ t("feedback.statuses.resolved") }}
              </option>
              <option value="closed">
                {{ t("feedback.statuses.closed") }}
              </option>
            </select>
          </div>
        </div>

        <p class="text-sm text-ios-text/85 leading-relaxed whitespace-pre-wrap">
          {{ feedback.description }}
        </p>

        <!-- Delete confirmation -->
        <div
          v-if="isDeletingFeedback"
          class="mt-3 p-3 bg-ios-red/5 rounded-xl flex items-center justify-between gap-3"
        >
          <p class="text-sm text-ios-red font-medium">
            {{ t("feedback.deleteConfirm") }}
          </p>
          <div class="flex gap-2 flex-shrink-0">
            <button
              class="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-ios-text/85 hover:bg-gray-200 transition-all"
              @click="isDeletingFeedback = false"
            >
              {{ t("feedback.cancelEdit") }}
            </button>
            <button
              class="px-3 py-1 rounded-full text-xs font-semibold bg-ios-red text-white hover:bg-red-600 transition-all"
              @click="handleDeleteFeedback"
            >
              {{ t("feedback.confirmDelete") }}
            </button>
          </div>
        </div>
      </template>

      <!-- Metadata footer -->
      <div
        class="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ios-secondary"
      >
        <span v-if="feedback.restaurant">
          🏪 {{ feedback.restaurant.name }}
        </span>
        <span v-if="feedback.user">
          👤 {{ feedback.user.fullName || feedback.user.username }}
        </span>
        <span>{{ formatDate(feedback.createdAt) }}</span>
        <span v-if="feedback.resolvedAt" class="text-ios-green">
          ✓ {{ t("feedback.resolvedAt") }} {{ formatDate(feedback.resolvedAt) }}
        </span>
      </div>

      <!-- Attachments -->
      <div
        v-if="safeAttachmentUrls.length"
        data-testid="feedback-attachments"
        class="mt-3 flex flex-wrap gap-2"
      >
        <a
          v-for="(url, i) in safeAttachmentUrls"
          :key="i"
          :href="url"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center gap-1.5 px-3 py-1.5 bg-ios-blue/10 text-ios-blue rounded-lg text-xs font-medium hover:bg-ios-blue/20 transition-colors"
        >
          <Paperclip class="w-3 h-3" />
          {{ t("feedback.attachment") }} {{ i + 1 }}
        </a>
      </div>
    </div>

    <!-- Responses thread -->
    <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-100">
        <h3 class="text-sm font-semibold text-ios-text">
          {{ t("feedback.replies") }}
          <span class="ml-1 text-ios-secondary font-normal">
            ({{ visibleResponses.length }})
          </span>
        </h3>
      </div>

      <div v-if="visibleResponses.length" class="divide-y divide-gray-50">
        <div
          v-for="response in visibleResponses"
          :key="response.id"
          class="px-5 py-4"
          :class="response.isInternal ? 'bg-amber-50/50' : ''"
        >
          <div class="flex items-start gap-3">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
              :class="
                response.isInternal
                  ? 'bg-amber-100 text-amber-700'
                  : isAdminUser(response.userId)
                    ? 'bg-ios-blue/10 text-ios-blue'
                    : 'bg-gray-100 text-ios-text/85'
              "
            >
              {{ getInitials(response.user) }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs font-semibold text-ios-text">
                  {{
                    response.user?.fullName || response.user?.username || "—"
                  }}
                </span>
                <span
                  v-if="response.isInternal"
                  class="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium"
                >
                  {{ t("feedback.internalNote") }}
                </span>
                <span class="text-[10px] text-ios-secondary ml-auto">
                  {{ formatDate(response.createdAt) }}
                </span>
                <!-- Edit / Delete actions (own reply or admin) -->
                <template v-if="canEditResponse(response)">
                  <button
                    v-if="editingResponseId !== response.id"
                    class="p-1 rounded-lg text-ios-secondary hover:text-ios-blue hover:bg-ios-blue/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                    :title="t('feedback.editReply')"
                    :aria-label="t('feedback.editReply')"
                    @click="startEdit(response)"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button
                    class="p-1 rounded-lg text-ios-secondary hover:text-ios-red hover:bg-ios-red/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                    :title="t('feedback.deleteReply')"
                    :aria-label="t('feedback.deleteReply')"
                    @click="handleDeleteResponse(response.id)"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </template>
              </div>

              <!-- Inline edit mode -->
              <template v-if="editingResponseId === response.id">
                <textarea
                  v-model="editingMessage"
                  rows="3"
                  maxlength="2000"
                  class="w-full px-3 py-2 bg-gray-50 border border-ios-blue/30 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all resize-none"
                />
                <div class="flex items-center gap-2 mt-2">
                  <button
                    :disabled="
                      !editingMessage.trim() ||
                      editingMessage === response.message
                    "
                    class="px-3 py-1 rounded-full text-xs font-semibold bg-ios-blue text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    @click="handleUpdateResponse(response.id)"
                  >
                    {{ t("feedback.saveEdit") }}
                  </button>
                  <button
                    class="px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-ios-text/85 hover:bg-gray-200 transition-all"
                    @click="cancelEdit"
                  >
                    {{ t("feedback.cancelEdit") }}
                  </button>
                </div>
              </template>
              <p
                v-else
                class="text-sm text-ios-text/85 leading-relaxed whitespace-pre-wrap"
              >
                {{ response.message }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="px-5 py-10 text-center">
        <MessageCircle class="w-10 h-10 text-ios-tertiary mx-auto mb-2" />
        <p class="text-sm text-ios-secondary">{{ t("feedback.noReplies") }}</p>
      </div>

      <!-- Reply input -->
      <div class="px-5 py-4 border-t border-gray-100 space-y-3">
        <textarea
          v-model="replyMessage"
          :placeholder="t('feedback.replyPlaceholder')"
          rows="3"
          maxlength="2000"
          class="w-full px-4 py-2.5 bg-gray-50 border-0 rounded-xl text-sm text-ios-text placeholder-ios-secondary focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all resize-none"
        />
        <div class="flex items-center justify-between gap-3">
          <label v-if="isAdmin" class="flex items-center gap-2 cursor-pointer">
            <input
              v-model="replyIsInternal"
              type="checkbox"
              class="w-4 h-4 rounded text-amber-500 focus:ring-amber-400"
            />
            <span class="text-xs text-ios-text/85">{{
              t("feedback.markInternal")
            }}</span>
          </label>
          <div v-else />
          <button
            :disabled="!replyMessage.trim()"
            class="px-5 py-2 rounded-full text-sm font-semibold bg-ios-blue text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
            @click="handleReply"
          >
            {{ t("feedback.sendReply") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { Paperclip, Pencil, Trash2, MessageCircle } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import type { UserId } from "@/types/api-user";
import { useFeedback } from "@/composables/useFeedback";
import { safeExternalHref } from "@/utils/safeExternalHref";
import type {
  FeedbackItem,
  FeedbackResponseItem,
  UpdateFeedbackPayload,
} from "@/composables/useFeedback";

const feedbackCategories = [
  "bug_report",
  "feature_request",
  "usability",
  "performance",
  "billing",
  "other",
] as const;
const feedbackPriorities = ["low", "medium", "high", "urgent"] as const;
const feedbackModules = [
  "menu",
  "orders",
  "pos",
  "tables",
  "reservations",
  "scheduling",
  "analytics",
  "settings",
  "integrations",
  "other",
] as const;

const props = defineProps<{ feedback: FeedbackItem }>();
const emit = defineEmits<{
  statusChanged: [status: string];
  replyAdded: [];
  replyUpdated: [responseId: number, message: string];
  replyDeleted: [responseId: number];
  feedbackUpdated: [feedback: FeedbackItem];
  feedbackDeleted: [];
}>();

const { t } = useI18n();
const authStore = useAuthStore();
const {
  addResponse,
  updateStatus,
  updateResponse,
  deleteResponse,
  updateFeedback,
  deleteFeedback,
} = useFeedback();

const isAdmin = computed(() => authStore.user?.role === UserRole.ADMIN);
const currentUserId = computed(() => authStore.user?.id);
const replyMessage = ref("");
const replyIsInternal = ref(false);

// Reply edit state
const editingResponseId = ref<number | null>(null);
const editingMessage = ref("");

// Feedback edit state
const isEditingFeedback = ref(false);
const isDeletingFeedback = ref(false);
const editForm = reactive({
  subject: "",
  description: "",
  category: "",
  priority: "",
  relatedModule: "",
});

const canEditFeedback = computed(() => {
  if (isAdmin.value) return true;
  return (
    props.feedback.userId === currentUserId.value &&
    props.feedback.status === "open"
  );
});

const isEditFormValid = computed(() => {
  return editForm.subject.length >= 5 && editForm.description.length >= 10;
});

function startFeedbackEdit() {
  editForm.subject = props.feedback.subject;
  editForm.description = props.feedback.description;
  editForm.category = props.feedback.category;
  editForm.priority = props.feedback.priority;
  editForm.relatedModule = props.feedback.relatedModule;
  isEditingFeedback.value = true;
}

function cancelFeedbackEdit() {
  isEditingFeedback.value = false;
}

async function handleSaveFeedback() {
  const payload: UpdateFeedbackPayload = {};
  if (editForm.subject !== props.feedback.subject)
    payload.subject = editForm.subject;
  if (editForm.description !== props.feedback.description)
    payload.description = editForm.description;
  if (editForm.category !== props.feedback.category)
    payload.category = editForm.category;
  if (editForm.priority !== props.feedback.priority)
    payload.priority = editForm.priority;
  if (editForm.relatedModule !== props.feedback.relatedModule)
    payload.relatedModule = editForm.relatedModule;

  if (Object.keys(payload).length === 0) {
    cancelFeedbackEdit();
    return;
  }

  const updated = await updateFeedback(props.feedback.id, payload);
  emit("feedbackUpdated", updated);
  isEditingFeedback.value = false;
}

async function handleDeleteFeedback() {
  await deleteFeedback(props.feedback.id);
  isDeletingFeedback.value = false;
  emit("feedbackDeleted");
}

const visibleResponses = computed(() => props.feedback.responses ?? []);
const safeAttachmentUrls = computed(() =>
  (props.feedback.attachmentUrls ?? []).flatMap((url) => {
    const href = safeExternalHref(url, { allowAnyHttpHost: true });
    return href ? [href] : [];
  }),
);

function isAdminUser(userId: UserId) {
  // A heuristic — admin responses are those from non-restaurant users
  return userId !== props.feedback.userId;
}

function canEditResponse(response: FeedbackResponseItem): boolean {
  if (isAdmin.value) return true;
  return response.userId === currentUserId.value;
}

function startEdit(response: FeedbackResponseItem) {
  editingResponseId.value = response.id;
  editingMessage.value = response.message;
}

function cancelEdit() {
  editingResponseId.value = null;
  editingMessage.value = "";
}

async function handleUpdateResponse(responseId: number) {
  if (!editingMessage.value.trim()) return;
  await updateResponse(
    props.feedback.id,
    responseId,
    editingMessage.value.trim(),
  );
  emit("replyUpdated", responseId, editingMessage.value.trim());
  cancelEdit();
}

async function handleDeleteResponse(responseId: number) {
  await deleteResponse(props.feedback.id, responseId);
  emit("replyDeleted", responseId);
}

function getInitials(
  user?: { username: string; fullName?: string } | null,
): string {
  if (!user) return "?";
  const name = user.fullName || user.username;
  return name.slice(0, 2).toUpperCase();
}

function formatDate(ts: string | number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function categoryClass(cat: string): string {
  const map: Record<string, string> = {
    bug_report: "bg-ios-red/10 text-ios-red",
    feature_request: "bg-ios-green/10 text-ios-green",
    usability: "bg-ios-blue/10 text-ios-blue",
    performance: "bg-ios-orange/10 text-ios-orange",
    billing: "bg-teal-100 text-teal-700",
    other: "bg-gray-100 text-ios-text/85",
  };
  return map[cat] ?? "bg-gray-100 text-ios-text/85";
}

function priorityClass(p: string): string {
  const map: Record<string, string> = {
    low: "bg-gray-100 text-ios-secondary",
    medium: "bg-ios-blue/10 text-ios-blue",
    high: "bg-ios-orange/10 text-ios-orange",
    urgent: "bg-ios-red/10 text-ios-red",
  };
  return map[p] ?? "bg-gray-100 text-ios-text/85";
}

function statusClass(s: string): string {
  const map: Record<string, string> = {
    open: "bg-ios-blue/10 text-ios-blue",
    in_progress: "bg-ios-orange/10 text-ios-orange",
    resolved: "bg-ios-green/10 text-ios-green",
    closed: "bg-gray-100 text-ios-secondary",
  };
  return map[s] ?? "bg-gray-100 text-ios-text/85";
}

async function handleStatusChange(e: Event) {
  const status = (e.target as HTMLSelectElement).value;
  await updateStatus(props.feedback.id, status);
  emit("statusChanged", status);
}

async function handleReply() {
  if (!replyMessage.value.trim()) return;
  await addResponse(
    props.feedback.id,
    replyMessage.value.trim(),
    replyIsInternal.value,
  );
  replyMessage.value = "";
  replyIsInternal.value = false;
  emit("replyAdded");
}
</script>
