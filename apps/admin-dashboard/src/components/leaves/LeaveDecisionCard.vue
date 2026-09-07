<template>
  <div
    class="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden transition-all duration-300"
  >
    <!-- Collapsed header row -->
    <div class="px-4 py-3.5">
      <div class="flex items-start gap-3">
        <!-- Urgency dot -->
        <div
          class="mt-1 w-2.5 h-2.5 rounded-full shrink-0"
          :class="urgencyColor"
        />

        <!-- Main info -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-ios-text text-sm">
              {{ employeeName }}
            </span>
            <span
              class="text-xs font-medium px-2 py-0.5 rounded-full"
              :style="leaveTypeBadgeStyle"
            >
              {{ request.leaveType?.name || "請假" }}
            </span>
            <span class="text-xs text-ios-text/50">
              {{ formatDateRange(request.startDate, request.endDate) }}
              ({{ request.totalDays }}天)
            </span>
          </div>

          <!-- Balance snapshot -->
          <div v-if="balance" class="mt-1 text-xs text-ios-text/50">
            餘額：{{ balance.leaveType?.name }}剩
            <span
              class="font-medium"
              :class="
                balance.remainingDays >= request.totalDays
                  ? 'text-ios-green'
                  : 'text-ios-red'
              "
            >
              {{ balance.remainingDays }}天
            </span>
            （申請{{ request.totalDays }}天）
          </div>

          <!-- Conflict warning (collapsed) -->
          <div
            v-if="conflictLevel === 'understaffed'"
            class="mt-1.5 flex items-center gap-1 text-xs text-ios-red"
          >
            <span>⚠</span>
            <span>當天人力低於門檻</span>
          </div>
          <div
            v-else-if="conflictLevel === 'has_colleagues'"
            class="mt-1.5 flex items-center gap-1 text-xs text-ios-orange"
          >
            <span>⚠</span>
            <span>當天已有{{ sameDayColleagues.length }}人請假</span>
          </div>
          <div
            v-else
            class="mt-1.5 flex items-center gap-1 text-xs text-ios-green"
          >
            <span>✓</span>
            <span>該時段人力充足</span>
          </div>
        </div>

        <!-- Expand toggle -->
        <button
          data-testid="leave-expand-toggle"
          class="shrink-0 w-7 h-7 flex items-center justify-center rounded-full hover:bg-ios-bg transition-colors text-ios-text/40"
          @click="toggleExpanded"
        >
          <ChevronDown
            class="w-4 h-4 transition-transform duration-200"
            :class="isExpanded ? 'rotate-180' : ''"
          />
        </button>
      </div>

      <!-- Action buttons -->
      <div v-if="!showRejectInput" class="flex gap-2 mt-3">
        <button
          class="flex-1 py-2 rounded-full text-sm font-semibold bg-ios-green text-white hover:bg-green-600 transition-colors"
          :disabled="isProcessing"
          @click="handleApprove"
        >
          <span
            v-if="isProcessing && processingAction === 'approve'"
            class="flex items-center justify-center gap-1.5"
          >
            <span
              class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"
            />
            處理中
          </span>
          <span v-else>批准</span>
        </button>
        <button
          class="flex-1 py-2 rounded-full text-sm font-semibold border border-ios-red text-ios-red hover:bg-ios-red/10 transition-colors"
          :disabled="isProcessing"
          data-testid="leave-reject-open"
          @click="showRejectInput = true"
        >
          拒絕
        </button>
      </div>

      <!-- Reject reason input -->
      <div v-else class="mt-3 space-y-2">
        <input
          v-model="rejectReason"
          type="text"
          data-testid="leave-reject-reason"
          placeholder="拒絕原因（必填）"
          class="w-full px-3 py-2 text-sm bg-ios-bg rounded-xl border-none focus:shadow-[0_0_0_2px_rgba(255,59,48,0.25)] focus:bg-white transition-all text-ios-text placeholder-ios-text/30"
          @keydown.enter="rejectReason.trim() && handleReject()"
          @keydown.esc="showRejectInput = false"
        />
        <div class="flex gap-2">
          <button
            class="flex-1 py-2 rounded-full text-sm font-semibold bg-ios-red text-white hover:bg-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="isProcessing || !rejectReason.trim()"
            data-testid="leave-reject-confirm"
            @click="handleReject"
          >
            <span
              v-if="isProcessing && processingAction === 'reject'"
              class="flex items-center justify-center gap-1.5"
            >
              <span
                class="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"
              />
              處理中
            </span>
            <span v-else>確認拒絕</span>
          </button>
          <button
            class="px-4 py-2 rounded-full text-sm font-semibold text-ios-text/60 hover:bg-ios-bg transition-colors"
            @click="
              showRejectInput = false;
              rejectReason = '';
            "
          >
            取消
          </button>
        </div>
      </div>
    </div>

    <!-- Expanded accordion: timeline + details -->
    <Transition name="accordion">
      <div
        v-if="isExpanded"
        class="border-t border-ios-bg px-4 py-3 bg-ios-bg/40"
      >
        <p
          class="text-xs font-semibold text-ios-text/50 mb-2 uppercase tracking-wider"
        >
          排班概覽
        </p>
        <LeaveTimelineStrip
          :center-date="request.startDate"
          :leave-requests="teamLeaves"
          :current-request-id="request.id"
          :schedule-count="scheduleCount"
          :staffing-threshold="staffingThreshold"
        />

        <!-- Same-day colleagues list -->
        <div v-if="sameDayColleagues.length > 0" class="mt-3">
          <p class="text-xs font-semibold text-ios-text/50 mb-1.5">
            同日請假同事
          </p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="col in sameDayColleagues"
              :key="col.id"
              class="text-xs px-2 py-0.5 bg-ios-red/10 text-ios-red rounded-full font-medium"
            >
              {{ col.employee?.fullName || `員工${col.employeeId}` }}
            </span>
          </div>
        </div>

        <!-- Reason -->
        <div v-if="request.reason" class="mt-3">
          <p class="text-xs font-semibold text-ios-text/50 mb-1">請假原因</p>
          <p class="text-sm text-ios-text/70">{{ request.reason }}</p>
        </div>

        <!-- Attachment. This card is the live approval UI and had no
             attachment row at all, so an approver could not see the proof
             document even once it was stored (#343). -->
        <div v-if="attachmentHref" class="mt-3">
          <p class="text-xs font-semibold text-ios-text/50 mb-1">證明文件</p>
          <a
            :href="attachmentHref"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="leave-attachment-link"
            class="inline-flex items-center gap-1.5 text-sm text-ios-primary rounded-full bg-ios-blue-soft px-3 py-1.5 transition-all duration-300 ease-out hover:bg-ios-blue-soft/70"
          >
            <Paperclip class="w-3.5 h-3.5" />
            {{ attachmentLabel }}
          </a>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { ChevronDown, Paperclip } from "lucide-vue-next";
import LeaveTimelineStrip from "./LeaveTimelineStrip.vue";
import { useLeaveConflict } from "@/composables/useLeaveConflict";
import { safeExternalHref } from "@/utils/safeExternalHref";
import type { LeaveRequest, LeaveBalance } from "@/services/leavesService";

interface Props {
  request: LeaveRequest;
  balance: LeaveBalance | null;
  teamLeaves: LeaveRequest[];
  scheduleCount?: Record<string, number>;
  staffingThreshold?: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  approve: [requestId: number];
  reject: [requestId: number, reason?: string];
}>();

const isExpanded = ref(false);
const showRejectInput = ref(false);
const rejectReason = ref("");
const isProcessing = ref(false);
const processingAction = ref<"approve" | "reject" | null>(null);

const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value;
};

const employeeName = computed(
  () => props.request.employee?.fullName || `員工${props.request.employeeId}`,
);

// The URL is employee-supplied, so it goes through safeExternalHref before it
// reaches an href — javascript:/data: never becomes a link. Any http(s) host is
// allowed here, because the document lives on whatever drive the employee uses.
const attachmentHref = computed(() =>
  safeExternalHref(props.request.attachmentUrl, { allowAnyHttpHost: true }),
);

const attachmentLabel = computed(() => {
  if (!attachmentHref.value) return "";
  try {
    return new URL(attachmentHref.value).hostname;
  } catch {
    return attachmentHref.value;
  }
});

const { sameDayColleagues, urgencyLevel } = useLeaveConflict(
  computed(() => props.request),
  computed(() => props.teamLeaves),
  computed(() => props.scheduleCount),
  computed(() => props.staffingThreshold),
);

const conflictLevel = urgencyLevel;

const urgencyColor = computed(() => {
  if (conflictLevel.value === "understaffed") return "bg-ios-red";
  if (conflictLevel.value === "has_colleagues") return "bg-ios-orange";
  return "bg-ios-green";
});

const leaveTypeBadgeStyle = computed(() => {
  const color = props.request.leaveType?.color ?? "#007AFF";
  return {
    backgroundColor: `${color}15`,
    color,
  };
});

const formatDateRange = (start: string, end: string): string => {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
  const fmt = (d: Date) =>
    `${d.getMonth() + 1}/${d.getDate()}(${weekDays[d.getDay()]})`;
  if (start === end) return fmt(s);
  return `${fmt(s)}-${fmt(e)}`;
};

const handleApprove = async () => {
  isProcessing.value = true;
  processingAction.value = "approve";
  try {
    emit("approve", props.request.id);
  } finally {
    isProcessing.value = false;
    processingAction.value = null;
  }
};

const handleReject = async () => {
  isProcessing.value = true;
  processingAction.value = "reject";
  try {
    emit("reject", props.request.id, rejectReason.value.trim());
  } finally {
    isProcessing.value = false;
    processingAction.value = null;
    showRejectInput.value = false;
    rejectReason.value = "";
  }
};
</script>

<style scoped>
.accordion-enter-active,
.accordion-leave-active {
  transition:
    max-height 0.25s ease-out,
    opacity 0.2s ease-out;
  overflow: hidden;
  max-height: 400px;
}
.accordion-enter-from,
.accordion-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
