<template>
  <div class="min-h-screen bg-ios-bg p-5 space-y-5">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-ios-text">
          {{ t("feedback.title") }}
        </h1>
        <p class="text-sm text-ios-secondary mt-0.5">
          {{
            isAdmin ? t("feedback.adminSubtitle") : t("feedback.ownerSubtitle")
          }}
        </p>
      </div>
      <button
        v-if="!isAdmin && !showForm"
        class="flex items-center gap-2 px-5 py-2.5 rounded-full bg-ios-blue text-white text-sm font-semibold hover:bg-blue-600 transition-all duration-200 shadow-sm"
        data-testid="open-feedback-form"
        @click="showForm = true"
      >
        <Plus class="w-4 h-4" />
        {{ t("feedback.submit") }}
      </button>
    </div>

    <!-- Feedback form (owner) -->
    <Transition name="fade-slide">
      <FeedbackForm
        v-if="showForm && !isAdmin"
        @cancel="showForm = false"
        @submitted="onSubmitted"
      />
    </Transition>

    <!-- Scoped stats: platform-wide for admins, own support tickets for owners -->
    <FeedbackStats v-if="stats" :stats="stats" />

    <!-- Filters -->
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex flex-wrap gap-3">
        <input
          v-model="filters.search"
          type="text"
          :placeholder="t('feedback.searchPlaceholder')"
          class="flex-1 min-w-48 px-4 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text placeholder-ios-secondary focus:ring-2 focus:ring-ios-blue/30 focus:bg-white transition-all"
          @input="debouncedFetch"
        />
        <select
          v-model="filters.status"
          class="px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
          @change="applyFilters"
        >
          <option value="">{{ t("feedback.allStatuses") }}</option>
          <option v-for="s in statuses" :key="s" :value="s">
            {{ t(`feedback.statuses.${s}`) }}
          </option>
        </select>
        <select
          v-model="filters.category"
          class="px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
          @change="applyFilters"
        >
          <option value="">{{ t("feedback.allCategories") }}</option>
          <option v-for="c in categories" :key="c" :value="c">
            {{ t(`feedback.categories.${c}`) }}
          </option>
        </select>
        <select
          v-model="filters.priority"
          class="px-3 py-2 bg-gray-50 border-0 rounded-xl text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30 transition-all"
          @change="applyFilters"
        >
          <option value="">{{ t("feedback.allPriorities") }}</option>
          <option v-for="p in priorities" :key="p" :value="p">
            {{ t(`feedback.priorities.${p}`) }}
          </option>
        </select>
      </div>
    </div>

    <!-- Feedback list -->
    <div v-if="isLoading" class="flex items-center justify-center py-12">
      <div
        class="w-8 h-8 border-2 border-ios-blue border-t-transparent rounded-full animate-spin"
      />
    </div>

    <div
      v-else-if="feedbackList.length === 0"
      class="bg-white rounded-2xl p-12 shadow-sm text-center"
    >
      <MessageSquare class="w-12 h-12 text-ios-tertiary mx-auto mb-3" />
      <p class="text-ios-secondary text-sm">{{ t("feedback.noFeedback") }}</p>
      <button
        v-if="!isAdmin && !showForm"
        class="mt-4 px-5 py-2.5 rounded-full bg-ios-blue text-white text-sm font-semibold hover:bg-blue-600 transition-all"
        @click="showForm = true"
      >
        {{ t("feedback.submit") }}
      </button>
    </div>

    <div v-else class="space-y-3">
      <div
        v-for="item in feedbackList"
        :key="item.id"
        class="bg-white rounded-2xl p-5 shadow-sm cursor-pointer hover:shadow-md transition-all duration-200 active:scale-[0.99]"
        @click="openDetail(item)"
      >
        <div class="flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-1.5">
              <span
                class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                :class="categoryClass(item.category)"
              >
                {{ t(`feedback.categories.${item.category}`) }}
              </span>
              <span
                class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                :class="statusClass(item.status)"
              >
                {{ t(`feedback.statuses.${item.status}`) }}
              </span>
              <span
                class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                :class="priorityClass(item.priority)"
              >
                {{ t(`feedback.priorities.${item.priority}`) }}
              </span>
            </div>
            <h3 class="text-sm font-semibold text-ios-text truncate">
              {{ item.subject }}
            </h3>
            <p class="text-xs text-ios-secondary mt-1 line-clamp-2">
              {{ item.description }}
            </p>
            <div
              class="flex items-center gap-3 mt-2 text-xs text-ios-secondary"
            >
              <span v-if="isAdmin && item.restaurant"
                >🏪 {{ item.restaurant.name }}</span
              >
              <span>{{ formatDate(item.createdAt) }}</span>
            </div>
          </div>
          <ChevronRight class="w-4 h-4 text-ios-tertiary flex-shrink-0 mt-1" />
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="pagination && pagination.totalPages > 1"
      class="flex items-center justify-center gap-2"
    >
      <button
        :disabled="pagination.page <= 1"
        class="px-4 py-2 rounded-full text-sm font-medium bg-white shadow-sm text-ios-blue disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all"
        @click="changePage(pagination.page - 1)"
      >
        {{ t("common.previous") }}
      </button>
      <span class="text-sm text-ios-secondary">
        {{ pagination.page }} / {{ pagination.totalPages }}
      </span>
      <button
        :disabled="pagination.page >= pagination.totalPages"
        class="px-4 py-2 rounded-full text-sm font-medium bg-white shadow-sm text-ios-blue disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-all"
        @click="changePage(pagination.page + 1)"
      >
        {{ t("common.next") }}
      </button>
    </div>

    <!-- Detail drawer -->
    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="selectedFeedback"
          class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          <div
            class="absolute inset-0 bg-black/30 backdrop-blur-sm"
            @click="selectedFeedback = null"
          />
          <div
            class="relative w-full sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-ios-bg rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
          >
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-base font-semibold text-ios-text">
                {{ t("feedback.detailTitle") }}
              </h2>
              <button
                class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-200 text-ios-text/85 hover:bg-gray-300 transition-colors"
                @click="selectedFeedback = null"
              >
                <X class="w-4 h-4" />
              </button>
            </div>
            <FeedbackDetail
              :feedback="selectedFeedback"
              @status-changed="onStatusChanged"
              @reply-added="onReplyAdded"
              @reply-updated="onReplyUpdated"
              @reply-deleted="onReplyDeleted"
              @feedback-updated="onFeedbackUpdated"
              @feedback-deleted="onFeedbackDeleted"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from "vue";
import { Plus, MessageSquare, ChevronRight, X } from "lucide-vue-next";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import { useFeedback } from "@/composables/useFeedback";
import FeedbackForm from "@/components/feedback/FeedbackForm.vue";
import FeedbackDetail from "@/components/feedback/FeedbackDetail.vue";
import FeedbackStats from "@/components/feedback/FeedbackStats.vue";
import type {
  FeedbackItem,
  FeedbackFilters,
  FeedbackStats as FeedbackStatsType,
} from "@/composables/useFeedback";

const { t } = useI18n();
const authStore = useAuthStore();
const { isLoading, fetchFeedback, fetchFeedbackById, fetchStats } =
  useFeedback();

const isAdmin = computed(() => authStore.user?.role === UserRole.ADMIN);
const showForm = ref(false);
const feedbackList = ref<FeedbackItem[]>([]);
const selectedFeedback = ref<FeedbackItem | null>(null);
const stats = ref<FeedbackStatsType | null>(null);
const pagination = ref<{
  page: number;
  limit: number;
  total: number;
  totalPages: number;
} | null>(null);

const filters = reactive({
  search: "",
  status: "",
  category: "",
  priority: "",
  page: 1,
});

const categories = [
  "bug_report",
  "feature_request",
  "usability",
  "performance",
  "billing",
  "other",
];
const statuses = ["open", "in_progress", "resolved", "closed"];
const priorities = ["low", "medium", "high", "urgent"];

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFetch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  filters.page = 1;
  searchDebounceTimer = setTimeout(() => loadFeedback(), 400);
}

function applyFilters() {
  filters.page = 1;
  loadFeedback();
}

async function loadFeedback() {
  const params: FeedbackFilters = { page: filters.page, limit: 20 };
  if (filters.search) params.search = filters.search;
  if (filters.status) params.status = filters.status;
  if (filters.category) params.category = filters.category;
  if (filters.priority) params.priority = filters.priority;

  const result = await fetchFeedback(params);
  feedbackList.value = result.feedback;
  pagination.value = result.pagination;
}

async function loadStats() {
  stats.value = await fetchStats();
}

function changePage(page: number) {
  filters.page = page;
  loadFeedback();
}

async function openDetail(item: FeedbackItem) {
  selectedFeedback.value = await fetchFeedbackById(item.id);
}

async function onSubmitted() {
  showForm.value = false;
  await Promise.all([loadFeedback(), loadStats()]);
}

function onStatusChanged(status: string) {
  if (selectedFeedback.value) {
    selectedFeedback.value = { ...selectedFeedback.value, status };
    const idx = feedbackList.value.findIndex(
      (f) => f.id === selectedFeedback.value!.id,
    );
    if (idx !== -1)
      feedbackList.value[idx] = { ...feedbackList.value[idx], status };
    loadStats();
  }
}

async function onReplyAdded() {
  if (selectedFeedback.value) {
    selectedFeedback.value = await fetchFeedbackById(selectedFeedback.value.id);
  }
}

function onReplyUpdated(responseId: number, message: string) {
  if (!selectedFeedback.value?.responses) return;
  const responses = selectedFeedback.value.responses.map((r) =>
    r.id === responseId ? { ...r, message } : r,
  );
  selectedFeedback.value = { ...selectedFeedback.value, responses };
}

function onReplyDeleted(responseId: number) {
  if (!selectedFeedback.value?.responses) return;
  const responses = selectedFeedback.value.responses.filter(
    (r) => r.id !== responseId,
  );
  selectedFeedback.value = { ...selectedFeedback.value, responses };
}

function onFeedbackUpdated(updated: FeedbackItem) {
  selectedFeedback.value = { ...selectedFeedback.value!, ...updated };
  const idx = feedbackList.value.findIndex((f) => f.id === updated.id);
  if (idx !== -1) {
    feedbackList.value[idx] = { ...feedbackList.value[idx], ...updated };
  }
}

function onFeedbackDeleted() {
  if (!selectedFeedback.value) return;
  feedbackList.value = feedbackList.value.filter(
    (f) => f.id !== selectedFeedback.value!.id,
  );
  selectedFeedback.value = null;
}

function formatDate(ts: string | number): string {
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

onMounted(() => {
  loadFeedback();
  loadStats();
});
</script>

<style scoped>
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease-out;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: all 0.3s ease-out;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from > div:last-child {
  transform: translateY(100%);
}
</style>
