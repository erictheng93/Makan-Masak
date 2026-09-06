<template>
  <transition name="dialog-fade">
    <div v-if="isOpen" class="dialog-overlay" @click.self="handleClose">
      <div class="dialog-container">
        <!-- 對話框標題 -->
        <div class="dialog-header">
          <h2 class="dialog-title">
            {{ t("leaves.request.title") }}
          </h2>
          <button class="btn-close" @click="handleClose">
            <svg class="icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>

        <!-- 對話框內容 -->
        <form class="dialog-content" @submit.prevent="handleSubmit">
          <!-- 請假類型選擇 -->
          <div class="form-group">
            <label class="form-label required">
              {{ t("leaves.request.leaveType") }}
            </label>
            <select
              v-model="formData.leaveTypeId"
              class="form-select"
              :class="{ error: errors.leaveTypeId }"
              required
            >
              <option value="">
                {{ t("leaves.request.selectLeaveType") }}
              </option>
              <option
                v-for="type in leaveTypes"
                :key="type.id"
                :value="type.id"
              >
                {{ type.name }} ({{ t("leaves.balance.remaining") }}:
                {{ getTypeBalance(type.id) }} {{ t("leaves.balance.days") }})
              </option>
            </select>
            <span v-if="errors.leaveTypeId" class="error-message">
              {{ errors.leaveTypeId }}
            </span>
          </div>

          <!-- 開始日期 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">
                {{ t("leaves.request.startDate") }}
              </label>
              <input
                v-model="formData.startDate"
                type="date"
                class="form-input"
                :class="{ error: errors.startDate }"
                :min="minDate"
                required
                @change="calculateDuration"
              />
              <span v-if="errors.startDate" class="error-message">
                {{ errors.startDate }}
              </span>
            </div>

            <div class="form-group">
              <label class="form-label">
                {{ t("leaves.request.startPeriod") }}
              </label>
              <select
                v-model="formData.startPeriod"
                class="form-select"
                :disabled="!selectedLeaveType?.allowHalfDay"
                @change="calculateDuration"
              >
                <option value="full">{{ t("leaves.request.fullDay") }}</option>
                <option value="am">{{ t("leaves.request.morning") }}</option>
                <option value="pm">{{ t("leaves.request.afternoon") }}</option>
              </select>
            </div>
          </div>

          <!-- 結束日期 -->
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">
                {{ t("leaves.request.endDate") }}
              </label>
              <input
                v-model="formData.endDate"
                type="date"
                class="form-input"
                :class="{ error: errors.endDate }"
                :min="formData.startDate || minDate"
                required
                @change="calculateDuration"
              />
              <span v-if="errors.endDate" class="error-message">
                {{ errors.endDate }}
              </span>
            </div>

            <div class="form-group">
              <label class="form-label">
                {{ t("leaves.request.endPeriod") }}
              </label>
              <select
                v-model="formData.endPeriod"
                class="form-select"
                :disabled="
                  !selectedLeaveType?.allowHalfDay ||
                  formData.startDate === formData.endDate
                "
                @change="calculateDuration"
              >
                <option value="full">{{ t("leaves.request.fullDay") }}</option>
                <option value="am">{{ t("leaves.request.morning") }}</option>
                <option value="pm">{{ t("leaves.request.afternoon") }}</option>
              </select>
            </div>
          </div>

          <!-- 計算的天數 -->
          <div v-if="calculatedDays > 0" class="duration-display">
            <svg class="icon" viewBox="0 0 20 20" fill="currentColor">
              <path
                fill-rule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clip-rule="evenodd"
              />
            </svg>
            <span>
              {{ t("leaves.request.totalDuration") }}:
              <strong>{{ calculatedDays }}</strong>
              {{ t("leaves.balance.days") }}
            </span>
          </div>

          <!-- 請假原因 -->
          <div class="form-group">
            <label class="form-label required">
              {{ t("leaves.request.reason") }}
            </label>
            <textarea
              v-model="formData.reason"
              class="form-textarea"
              :class="{ error: errors.reason }"
              :placeholder="t('leaves.request.reasonPlaceholder')"
              rows="4"
              required
              maxlength="500"
            />
            <div class="textarea-footer">
              <span v-if="errors.reason" class="error-message">
                {{ errors.reason }}
              </span>
              <span class="char-count">
                {{ formData.reason.length }} / 500
              </span>
            </div>
          </div>

          <!-- 證明文件連結 (如需要證明文件) -->
          <div
            v-if="selectedLeaveType?.requiresDocumentation"
            class="form-group"
          >
            <label class="form-label required" for="leave-attachment-url">
              {{ t("leaves.request.attachments") }}
            </label>
            <input
              id="leave-attachment-url"
              v-model.trim="formData.attachmentUrl"
              type="url"
              class="form-input"
              :class="{ error: errors.attachmentUrl }"
              inputmode="url"
              placeholder="https://..."
              data-testid="leave-attachment-url"
            />
            <span v-if="errors.attachmentUrl" class="error-message">
              {{ errors.attachmentUrl }}
            </span>
            <p v-else class="field-hint">
              {{ t("leaves.request.attachmentUrlHint") }}
            </p>
          </div>

          <!-- 警告訊息 -->
          <div v-if="warnings.length > 0" class="warnings">
            <div
              v-for="(warning, index) in warnings"
              :key="index"
              class="warning-item"
            >
              <svg class="icon-warning" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>{{ warning }}</span>
            </div>
          </div>

          <!-- 操作按鈕 -->
          <div class="dialog-actions">
            <button type="button" class="btn-cancel" @click="handleClose">
              {{ t("common.cancel") }}
            </button>
            <button
              type="submit"
              class="btn-submit"
              :disabled="isSubmitting || !isFormValid"
            >
              <span v-if="!isSubmitting">
                {{ t("leaves.request.submit") }}
              </span>
              <span v-else class="loading-spinner">
                <svg class="spinner" viewBox="0 0 24 24">
                  <circle
                    class="spinner-circle"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    fill="none"
                  />
                </svg>
                {{ t("common.submitting") }}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "@/i18n";
import type { LeaveType } from "@makanmasak/shared-types";

const { t } = useI18n();

// Exactly the fields this dialog reads. Both callers now pass the same
// LeaveType, so this is a Pick of it rather than a structural stand-in: a
// column rename reaches this list through shared-types (#330).
type RequestDialogLeaveType = Pick<
  LeaveType,
  "id" | "name" | "minNoticeDays" | "requiresDocumentation" | "allowHalfDay"
>;

interface RequestDialogLeaveBalance {
  leaveTypeId: number;
  remainingDays: number;
}

interface Props {
  isOpen: boolean;
  leaveTypes: RequestDialogLeaveType[];
  balances: RequestDialogLeaveBalance[];
  preselectedTypeId?: number;
}

export interface LeaveRequestFormData {
  leaveTypeId: number | string;
  startDate: string;
  startPeriod: "full" | "am" | "pm";
  endDate: string;
  endPeriod: "full" | "am" | "pm";
  reason: string;
  // Single http(s) link, matching leave_requests.attachment_url — the column is
  // one TEXT field, not a list, and the API only ever accepted a URL. The
  // dialog used to collect File[] that no caller could send (#343).
  attachmentUrl?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  close: [];
  submit: [data: LeaveRequestFormData];
}>();

// 表單資料
const formData = ref<LeaveRequestFormData>({
  leaveTypeId: "",
  startDate: "",
  startPeriod: "full",
  endDate: "",
  endPeriod: "full",
  reason: "",
  attachmentUrl: "",
});

// 錯誤訊息
const errors = ref<Record<string, string>>({});

// 警告訊息
const warnings = ref<string[]>([]);

// 狀態
const isSubmitting = ref(false);
const calculatedDays = ref(0);

// 最小日期（今天）
const minDate = computed(() => {
  return new Date().toISOString().split("T")[0];
});

// 選中的請假類型
const selectedLeaveType = computed(() => {
  return props.leaveTypes.find((t) => t.id === formData.value.leaveTypeId);
});

// 附件連結驗證。與後端 createLeaveRequestSchema 的 httpUrlSchema 對齊：
// 只收 http/https 絕對網址，其他一律擋在前端，避免送出後才吃 400。
const isHttpUrl = (value: string | undefined): boolean => {
  if (!value) return false;
  try {
    const protocol = new URL(value).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

// 表單驗證
const isFormValid = computed(() => {
  return (
    formData.value.leaveTypeId &&
    formData.value.startDate &&
    formData.value.endDate &&
    formData.value.reason.trim().length >= 10 &&
    calculatedDays.value > 0 &&
    (!selectedLeaveType.value?.requiresDocumentation ||
      isHttpUrl(formData.value.attachmentUrl))
  );
});

// 獲取某個請假類型的剩餘天數
const getTypeBalance = (typeId: number): string => {
  const balance = props.balances.find((b) => b.leaveTypeId === typeId);
  return balance ? balance.remainingDays.toString() : "0";
};

// 計算請假天數
const calculateDuration = () => {
  if (!formData.value.startDate || !formData.value.endDate) {
    calculatedDays.value = 0;
    return;
  }

  const start = new Date(formData.value.startDate);
  const end = new Date(formData.value.endDate);

  if (end < start) {
    errors.value.endDate = t("leaves.errors.endBeforeStart");
    calculatedDays.value = 0;
    return;
  }

  // 計算天數（簡化版，實際應考慮工作日、假日等）
  let days =
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // 考慮半天
  if (formData.value.startPeriod !== "full") days -= 0.5;
  if (formData.value.endPeriod !== "full") days -= 0.5;

  calculatedDays.value = days;

  // 檢查是否超過餘額
  checkBalance();
  // 檢查是否超過通知期限
  checkNoticeRequirement();
};

// 檢查餘額
const checkBalance = () => {
  if (!selectedLeaveType.value) return;

  const balance = props.balances.find(
    (b) => b.leaveTypeId === selectedLeaveType.value!.id,
  );
  if (balance && calculatedDays.value > balance.remainingDays) {
    warnings.value.push(
      t("leaves.warnings.insufficientBalance", {
        remaining: balance.remainingDays,
        requested: calculatedDays.value,
      }),
    );
  } else {
    warnings.value = warnings.value.filter(
      (w) => !w.includes(t("leaves.warnings.insufficientTag")),
    );
  }
};

// 檢查通知期限
const checkNoticeRequirement = () => {
  if (!selectedLeaveType.value?.minNoticeDays) return;

  const start = new Date(formData.value.startDate);
  const today = new Date();
  const noticeDays = Math.ceil(
    (start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (noticeDays < selectedLeaveType.value.minNoticeDays) {
    warnings.value.push(
      t("leaves.warnings.noticeRequired", {
        required: selectedLeaveType.value.minNoticeDays,
        actual: noticeDays,
      }),
    );
  } else {
    warnings.value = warnings.value.filter(
      (w) => !w.includes(t("leaves.warnings.noticeTag")),
    );
  }
};

// 處理提交
const handleSubmit = async () => {
  // 驗證表單
  errors.value = {};

  if (!formData.value.leaveTypeId) {
    errors.value.leaveTypeId = t("leaves.errors.selectLeaveType");
  }

  if (!formData.value.startDate) {
    errors.value.startDate = t("leaves.errors.selectStartDate");
  }

  if (!formData.value.endDate) {
    errors.value.endDate = t("leaves.errors.selectEndDate");
  }

  if (formData.value.reason.trim().length < 10) {
    errors.value.reason = t("leaves.errors.reasonMinLength");
  }

  if (
    selectedLeaveType.value?.requiresDocumentation &&
    !isHttpUrl(formData.value.attachmentUrl)
  ) {
    errors.value.attachmentUrl = t("leaves.errors.attachmentUrlInvalid");
  }

  if (Object.keys(errors.value).length > 0) {
    return;
  }

  isSubmitting.value = true;

  try {
    emit("submit", {
      ...formData.value,
      leaveTypeId: Number(formData.value.leaveTypeId),
      // "" would fail the API's z.url(); send nothing instead.
      attachmentUrl: formData.value.attachmentUrl || undefined,
    });
  } finally {
    isSubmitting.value = false;
  }
};

// 處理關閉
const handleClose = () => {
  if (!isSubmitting.value) {
    emit("close");
    resetForm();
  }
};

// 重置表單
const resetForm = () => {
  formData.value = {
    leaveTypeId: "",
    startDate: "",
    startPeriod: "full",
    endDate: "",
    endPeriod: "full",
    reason: "",
    attachmentUrl: "",
  };
  errors.value = {};
  warnings.value = [];
  calculatedDays.value = 0;
};

// 監聽預選類型
watch(
  () => props.preselectedTypeId,
  (newVal) => {
    if (newVal) {
      formData.value.leaveTypeId = newVal;
    }
  },
  { immediate: true },
);

// 監聽對話框開啟
watch(
  () => props.isOpen,
  (newVal) => {
    if (!newVal) {
      resetForm();
    }
  },
);
</script>

<style scoped>
/* 對話框動畫 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.3s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-active .dialog-container,
.dialog-fade-leave-active .dialog-container {
  transition: transform 0.3s ease;
}

.dialog-fade-enter-from .dialog-container,
.dialog-fade-leave-to .dialog-container {
  transform: scale(0.9);
}

/* 對話框覆蓋層 */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.dialog-container {
  background: white;
  border-radius: 16px;
  max-width: 600px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
}

/* 對話框標題 */
.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 24px 24px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.dialog-title {
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.btn-close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: #f3f4f6;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-close:hover {
  background: #e5e7eb;
}

.btn-close .icon {
  width: 20px;
  height: 20px;
  color: #6b7280;
}

/* 對話框內容 */
.dialog-content {
  padding: 24px;
}

/* 表單群組 */
.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 8px;
}

.form-label.required::after {
  content: " *";
  color: #ff3b30;
}

.label-note {
  font-size: 12px;
  font-weight: 400;
  color: #6b7280;
}

.form-input,
.form-select,
.form-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  color: #1f2937;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.form-input:focus,
.form-select:focus,
.form-textarea:focus {
  outline: none;
  border-color: #007aff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.form-input.error,
.form-select.error,
.form-textarea.error {
  border-color: #ff3b30;
}

.form-textarea {
  resize: vertical;
  font-family: inherit;
}

.textarea-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}

.char-count {
  font-size: 12px;
  color: #9ca3af;
}

/* 表單行 */
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* 錯誤訊息 */
.error-message {
  display: block;
  font-size: 12px;
  color: #ff3b30;
  margin-top: 4px;
}

/* 天數顯示 */
.duration-display {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: #eff6ff;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 14px;
  color: #1e40af;
}

.duration-display .icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.field-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #9ca3af;
}

/* 警告訊息 */
.warnings {
  margin-bottom: 20px;
}

.warning-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: #fef3c7;
  border-left: 4px solid #ff9500;
  border-radius: 8px;
  margin-bottom: 8px;
  font-size: 14px;
  color: #92400e;
}

.icon-warning {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  color: #ff9500;
}

/* 對話框操作 */
.dialog-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
}

.btn-cancel,
.btn-submit {
  flex: 1;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.btn-cancel {
  background: #f3f4f6;
  color: #4b5563;
}

.btn-cancel:hover {
  background: #e5e7eb;
}

.btn-submit {
  background: #007aff;
  color: white;
}

.btn-submit:hover:not(:disabled) {
  background: #2563eb;
}

.btn-submit:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

/* 載入動畫 */
.loading-spinner {
  display: flex;
  align-items: center;
  gap: 8px;
}

.spinner {
  width: 16px;
  height: 16px;
  animation: spin 1s linear infinite;
}

.spinner-circle {
  stroke-dasharray: 60;
  stroke-dashoffset: 0;
  animation: dash 1.5s ease-in-out infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes dash {
  0% {
    stroke-dashoffset: 60;
  }
  50% {
    stroke-dashoffset: 15;
  }
  100% {
    stroke-dashoffset: 60;
  }
}

/* 響應式設計 */
@media (max-width: 640px) {
  .dialog-container {
    max-width: 100%;
    margin: 0;
    border-radius: 16px 16px 0 0;
    max-height: 100vh;
  }

  .form-row {
    grid-template-columns: 1fr;
  }

  .dialog-actions {
    flex-direction: column-reverse;
  }
}
</style>
