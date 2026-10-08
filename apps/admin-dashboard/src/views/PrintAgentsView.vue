<template>
  <div class="min-h-screen bg-ios-bg p-4 md:p-6">
    <div class="mx-auto max-w-4xl">
      <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-[22px] font-bold text-ios-text">
            {{ t("printAgents.title") }}
          </h1>
          <p class="mt-1 text-[13px] text-ios-secondary">
            {{ t("printAgents.description") }}
          </p>
        </div>
        <button
          v-if="canManagePrintAgents"
          type="button"
          data-testid="issue-agent"
          class="rounded-full bg-ios-primary px-4 py-2 text-[14px] font-semibold text-white transition-transform duration-150 active:scale-95"
          @click="isIssuing = !isIssuing"
        >
          {{ t("printAgents.issue") }}
        </button>
      </div>

      <form
        v-if="isIssuing"
        data-testid="issue-form"
        class="mb-4 rounded-2xl bg-white p-4 shadow-ios-sm"
        @submit.prevent="issue"
      >
        <label class="block text-[13px] font-semibold text-ios-text">
          {{ t("printAgents.form.label") }}
        </label>
        <input
          v-model="form.label"
          data-testid="agent-label"
          required
          maxlength="100"
          class="mt-2 w-full rounded-xl bg-ios-bg px-3 py-2 text-[14px] text-ios-text outline-none"
          :placeholder="t('printAgents.form.labelPlaceholder')"
        />

        <label class="mt-4 block text-[13px] font-semibold text-ios-text">
          {{ t("printAgents.form.register") }}
        </label>
        <select
          v-model="form.registerId"
          data-testid="agent-register"
          class="mt-2 w-full rounded-xl bg-ios-bg px-3 py-2 text-[14px] text-ios-text outline-none"
        >
          <!-- 預設不綁：廚房出單機沒有收銀台，而那正是自動出單票的收件人 -->
          <option value="">{{ t("printAgents.form.registerNone") }}</option>
          <option
            v-for="register in registers"
            :key="register.id"
            :value="register.id"
          >
            {{ register.name }}
          </option>
        </select>
        <p class="mt-2 text-[12px] text-ios-secondary">
          {{ t("printAgents.form.registerHint") }}
        </p>

        <button
          type="submit"
          data-testid="issue-submit"
          class="mt-4 rounded-full bg-ios-primary px-4 py-2 text-[14px] font-semibold text-white transition-transform duration-150 active:scale-95"
        >
          {{ t("printAgents.form.submit") }}
        </button>
      </form>

      <div
        v-if="isLoading"
        class="rounded-2xl bg-white p-8 text-center text-[14px] text-ios-secondary shadow-ios-sm"
      >
        {{ t("common.loading") }}
      </div>

      <div
        v-else-if="error"
        data-testid="print-agents-error"
        class="rounded-2xl bg-white p-8 text-center text-[14px] text-ios-error shadow-ios-sm"
      >
        {{ error }}
      </div>

      <div
        v-else-if="agents.length === 0"
        data-testid="print-agents-empty"
        class="rounded-3xl bg-white p-10 text-center shadow-ios-sm"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("printAgents.empty.title") }}
        </p>
        <p class="mt-2 text-[13px] text-ios-secondary">
          {{ t("printAgents.empty.hint") }}
        </p>
      </div>

      <ul v-else class="space-y-3">
        <li
          v-for="agent in agents"
          :key="agent.id"
          :data-status="agent.status"
          data-testid="print-agent-row"
          class="rounded-2xl bg-white p-4 shadow-ios-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  :class="dotClass(agent.status)"
                  aria-hidden="true"
                />
                <p class="truncate text-[15px] font-semibold text-ios-text">
                  {{ agent.label }}
                </p>
              </div>
              <p class="mt-1 text-[13px] text-ios-secondary">
                {{ scopeLabel(agent) }} ·
                {{ t(`printAgents.status.${agent.status}`) }}
              </p>
              <p class="mt-0.5 text-[12px] text-ios-secondary">
                {{ printerLabel(agent) }} · {{ lastSeenLabel(agent) }}
              </p>
            </div>
            <button
              v-if="canManagePrintAgents"
              type="button"
              data-testid="revoke-agent"
              class="rounded-full bg-ios-bg px-4 py-2 text-[13px] font-semibold text-ios-error transition-transform duration-150 active:scale-95"
              @click="revoke(agent)"
            >
              {{ t("printAgents.revoke") }}
            </button>
          </div>
        </li>
      </ul>

      <!-- 核發結果：明文金鑰只在這一次拿得到，關掉就沒了 -->
      <div
        v-if="issuedKey"
        data-testid="issued-key"
        class="mt-4 rounded-2xl bg-white p-4 shadow-ios-card"
      >
        <p class="text-[15px] font-semibold text-ios-text">
          {{ t("printAgents.issued.title") }}
        </p>
        <p class="mt-1 text-[13px] text-ios-warning">
          {{ t("printAgents.issued.warning") }}
        </p>
        <code
          class="mt-3 block break-all rounded-xl bg-ios-bg p-3 text-[13px] text-ios-text"
          >{{ issuedKey }}</code
        >
        <button
          type="button"
          class="mt-3 rounded-full bg-ios-primary px-4 py-2 text-[14px] font-semibold text-white transition-transform duration-150 active:scale-95"
          @click="issuedKey = null"
        >
          {{ t("printAgents.issued.done") }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "@/i18n";
import { posService } from "@/services/posService";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";
import type {
  CashRegister,
  PrintAgent,
  PrintAgentStatus,
} from "@/services/posService";

const { t } = useI18n();
const authStore = useAuthStore();
const canManagePrintAgents = computed(() =>
  authStore.hasPermission([UserRole.ADMIN, UserRole.OWNER]),
);

const agents = ref<PrintAgent[]>([]);
const registers = ref<CashRegister[]>([]);
const isLoading = ref(true);
const isIssuing = ref(false);
const error = ref<string | null>(null);
const issuedKey = ref<string | null>(null);
const form = ref({ label: "", registerId: "" });

/**
 * 狀態顏色只在這裡對應一次。`no_printer` 用警告色而不是錯誤色：代理是活的，
 * 出單佇列還在收工作，只是現在沒有印表機能吐紙。
 */
function dotClass(status: PrintAgentStatus): string {
  switch (status) {
    case "online":
      return "bg-ios-success";
    case "no_printer":
      return "bg-ios-warning";
    case "offline":
      return "bg-ios-error";
    default:
      return "bg-ios-tertiary";
  }
}

function scopeLabel(agent: PrintAgent): string {
  return agent.registerId
    ? t("printAgents.scope.register", {
        name: agent.registerName ?? agent.registerId,
      })
    : t("printAgents.scope.shop");
}

function printerLabel(agent: PrintAgent): string {
  if (agent.printersTotal === null) {
    return t("printAgents.printers.unknown");
  }
  return t("printAgents.printers.count", {
    online: agent.printersOnline ?? 0,
    total: agent.printersTotal,
  });
}

function lastSeenLabel(agent: PrintAgent): string {
  return agent.lastSeenAt
    ? t("printAgents.lastSeen", {
        time: new Date(agent.lastSeenAt).toLocaleString(),
      })
    : t("printAgents.status.never_seen");
}

/**
 * A background refresh keeps the rows on screen: it does not swap in the
 * loading card, and a failed tick does not replace the list with an error.
 */
async function load({ background = false } = {}): Promise<void> {
  if (!background) {
    isLoading.value = true;
    error.value = null;
  }
  try {
    agents.value = await posService.getPrintAgents(
      authStore.restaurantId ?? undefined,
    );
  } catch (cause) {
    if (background) {
      console.error("Background print agent refresh failed:", cause);
      return;
    }
    error.value =
      cause instanceof Error ? cause.message : t("printAgents.loadFailed");
  } finally {
    if (!background) isLoading.value = false;
  }
}

// Online / no-printer / offline and last-seen move with each agent's
// heartbeat, not with anything done on this page.
const agentsPoller = createVisibilityAwarePoller({
  intervalMs: 30_000,
  onTick: () => {
    if (isLoading.value) return;
    return load({ background: true });
  },
});

async function issue(): Promise<void> {
  if (!canManagePrintAgents.value) return;

  try {
    const issued = await posService.issuePrintAgent(
      {
        label: form.value.label,
        registerId: form.value.registerId || undefined,
      },
      authStore.restaurantId ?? undefined,
    );
    issuedKey.value = issued.key;
    form.value = { label: "", registerId: "" };
    isIssuing.value = false;
    await load();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : t("printAgents.issueFailed");
  }
}

async function revoke(agent: PrintAgent): Promise<void> {
  if (!canManagePrintAgents.value) return;

  if (!window.confirm(t("printAgents.revokeConfirm", { label: agent.label }))) {
    return;
  }

  try {
    await posService.revokePrintAgent(
      agent.id,
      authStore.restaurantId ?? undefined,
    );
    await load();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : t("printAgents.revokeFailed");
  }
}

onBeforeUnmount(() => agentsPoller.stop());
onMounted(async () => {
  agentsPoller.start();
  await load();
  try {
    registers.value = await posService.getRegisters();
  } catch {
    // 收銀機清單只是核發表單的下拉選項。取不到時仍然可以核發全店代理，
    // 不該讓整頁的代理狀態因此顯示成錯誤。
    registers.value = [];
  }
});
</script>
