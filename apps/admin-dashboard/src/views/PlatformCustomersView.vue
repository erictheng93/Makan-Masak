<template>
  <main class="min-h-full space-y-6 bg-ios-bg p-5">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-ios-text">
          {{ t("pages.platformCustomers") }}
        </h1>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("platformCustomers.subtitle") }}
        </p>
      </div>
    </header>

    <!-- 篩選 -->
    <section class="rounded-2xl bg-white p-5 shadow-ios-card">
      <h2 class="mb-4 text-base font-semibold text-ios-text">
        {{ t("platformCustomers.filters.title") }}
      </h2>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div class="md:col-span-2">
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="platform-customer-search"
          >
            {{ t("platformCustomers.search.label") }}
          </label>
          <input
            id="platform-customer-search"
            v-model="filters.search"
            type="search"
            :placeholder="t('platformCustomers.search.placeholder')"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @input="debouncedReload"
          />
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="platform-customer-status"
          >
            {{ t("platformCustomers.filters.status") }}
          </label>
          <select
            id="platform-customer-status"
            v-model="filters.status"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          >
            <option value="">
              {{ t("platformCustomers.filters.statusOptions.all") }}
            </option>
            <option value="active">
              {{ t("platformCustomers.filters.statusOptions.active") }}
            </option>
            <option value="deleted">
              {{ t("platformCustomers.filters.statusOptions.deleted") }}
            </option>
          </select>
        </div>
        <div class="flex items-end gap-3">
          <div class="flex-1">
            <label
              class="mb-2 block text-xs font-medium text-ios-secondary"
              for="platform-customer-sort"
            >
              {{ t("platformCustomers.filters.sort") }}
            </label>
            <select
              id="platform-customer-sort"
              v-model="filters.sort"
              class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
              @change="reload"
            >
              <option value="recent">
                {{ t("platformCustomers.filters.sortOptions.recent") }}
              </option>
              <option value="spent">
                {{ t("platformCustomers.filters.sortOptions.spent") }}
              </option>
              <option value="orders">
                {{ t("platformCustomers.filters.sortOptions.orders") }}
              </option>
              <option value="restaurants">
                {{ t("platformCustomers.filters.sortOptions.restaurants") }}
              </option>
              <option value="name">
                {{ t("platformCustomers.filters.sortOptions.name") }}
              </option>
            </select>
          </div>
          <button
            type="button"
            data-testid="platform-reset-filters"
            class="rounded-full bg-ios-bg px-4 py-2.5 text-sm font-medium text-ios-text transition-colors duration-200 hover:bg-gray-200"
            @click="resetFilters"
          >
            {{ t("platformCustomers.filters.reset") }}
          </button>
        </div>
      </div>
    </section>

    <!-- 顧客列表 -->
    <section class="overflow-hidden rounded-2xl bg-white shadow-ios-card">
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100">
          <thead>
            <tr
              class="text-left text-xs font-medium uppercase tracking-wider text-ios-secondary"
            >
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.customer") }}
              </th>
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.contact") }}
              </th>
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.restaurants") }}
              </th>
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.orders") }}
              </th>
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.spent") }}
              </th>
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.lastOrder") }}
              </th>
              <th class="px-6 py-3">
                {{ t("platformCustomers.table.status") }}
              </th>
              <th class="px-6 py-3 text-right">
                {{ t("platformCustomers.table.actions") }}
              </th>
            </tr>
          </thead>
          <tbody v-if="loading" class="divide-y divide-gray-100">
            <tr>
              <td
                colspan="8"
                class="px-6 py-12 text-center text-sm text-ios-secondary"
                aria-busy="true"
              >
                {{ t("common.loading") }}
              </td>
            </tr>
          </tbody>
          <tbody
            v-else-if="customers.length === 0"
            class="divide-y divide-gray-100"
          >
            <tr>
              <td colspan="8" class="px-6 py-12 text-center">
                <UsersIcon class="mx-auto h-10 w-10 text-ios-tertiary" />
                <p class="mt-3 text-sm font-medium text-ios-text">
                  {{ t("platformCustomers.empty.title") }}
                </p>
                <p class="mt-1 text-sm text-ios-secondary">
                  {{ t("platformCustomers.empty.description") }}
                </p>
              </td>
            </tr>
          </tbody>
          <tbody v-else class="divide-y divide-gray-100">
            <tr
              v-for="customer in customers"
              :key="customer.customerId"
              :data-testid="`platform-customer-row-${customer.customerId}`"
              :data-status="customer.status"
              class="cursor-pointer transition-colors duration-200 hover:bg-ios-bg"
              @click="openCustomer(customer)"
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <span
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-ios-blue"
                    aria-hidden="true"
                  >
                    {{ customerInitial(customer) }}
                  </span>
                  <p class="text-sm font-medium text-ios-text">
                    {{ customerName(customer) }}
                  </p>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-ios-secondary">
                <div>{{ customer.maskedPhone ?? "—" }}</div>
                <div>{{ customer.maskedEmail ?? "—" }}</div>
              </td>
              <td
                class="px-6 py-4 text-sm tabular-nums text-ios-text"
                data-testid="platform-customer-restaurant-count"
              >
                {{ customer.restaurantCount }}
              </td>
              <td class="px-6 py-4 text-sm tabular-nums text-ios-text">
                {{ customer.orderCount }}
              </td>
              <td class="px-6 py-4 text-sm tabular-nums text-ios-text">
                {{ formatMoneyByCurrency(customer.totalSpentByCurrency) }}
              </td>
              <td class="px-6 py-4 text-sm text-ios-secondary">
                {{
                  customer.lastOrderAt
                    ? formatRelativeTime(customer.lastOrderAt)
                    : "—"
                }}
              </td>
              <td class="px-6 py-4">
                <span
                  class="rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="
                    customer.status === 'deleted'
                      ? 'bg-gray-100 text-ios-secondary'
                      : 'bg-green-50 text-ios-green'
                  "
                >
                  {{ t(`platformCustomers.status.${customer.status}`) }}
                </span>
              </td>
              <td class="px-6 py-4 text-right">
                <button
                  type="button"
                  class="text-sm font-medium text-ios-blue"
                  @click.stop="openCustomer(customer)"
                >
                  {{ t("platformCustomers.actions.detail") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer
        v-if="pagination.pages > 1"
        class="flex items-center justify-between border-t border-gray-100 px-6 py-4"
      >
        <div class="flex flex-1 justify-between sm:hidden">
          <button
            type="button"
            :disabled="page === 1"
            class="rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text disabled:opacity-40"
            @click="changePage(page - 1)"
          >
            {{ t("platformCustomers.pagination.previous") }}
          </button>
          <button
            type="button"
            :disabled="page >= pagination.pages"
            class="rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text disabled:opacity-40"
            @click="changePage(page + 1)"
          >
            {{ t("platformCustomers.pagination.next") }}
          </button>
        </div>
        <div
          class="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between"
        >
          <p
            class="text-sm text-ios-secondary"
            data-testid="platform-customers-pagination-summary"
          >
            {{
              t("platformCustomers.pagination.showing", {
                start: rangeStart,
                end: rangeEnd,
                total: pagination.total,
              })
            }}
          </p>
          <nav
            class="flex items-center gap-1"
            :aria-label="t('platformCustomers.pagination.label')"
          >
            <button
              type="button"
              :disabled="page === 1"
              class="flex h-8 w-8 items-center justify-center rounded-full bg-ios-bg text-ios-text disabled:opacity-40"
              :aria-label="t('platformCustomers.pagination.previous')"
              @click="changePage(page - 1)"
            >
              <ChevronLeftIcon class="h-4 w-4" />
            </button>
            <button
              v-for="visiblePage in visiblePages"
              :key="visiblePage"
              type="button"
              class="min-w-8 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200"
              :class="
                visiblePage === page
                  ? 'bg-ios-blue text-white'
                  : 'bg-ios-bg text-ios-text hover:bg-gray-200'
              "
              @click="changePage(visiblePage)"
            >
              {{ visiblePage }}
            </button>
            <button
              type="button"
              :disabled="page >= pagination.pages"
              class="flex h-8 w-8 items-center justify-center rounded-full bg-ios-bg text-ios-text disabled:opacity-40"
              :aria-label="t('platformCustomers.pagination.next')"
              @click="changePage(page + 1)"
            >
              <ChevronRightIcon class="h-4 w-4" />
            </button>
          </nav>
        </div>
      </footer>
    </section>

    <!-- 詳情抽屜 -->
    <Teleport to="body">
      <Transition name="sheet">
        <div
          v-if="selected"
          class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          <div
            class="absolute inset-0 bg-black/30 backdrop-blur-sm"
            @click="closeDetail"
          />
          <div
            data-testid="platform-customer-detail-panel"
            class="relative max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-3xl bg-ios-bg p-5 sm:max-w-2xl sm:rounded-3xl"
          >
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold text-ios-text">
                {{ t("platformCustomers.detail.title") }}
              </h2>
              <button
                type="button"
                data-testid="platform-customer-detail-close"
                class="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-ios-text/85 transition-colors duration-200 hover:bg-gray-300"
                :aria-label="t('platformCustomers.detail.close')"
                @click="closeDetail"
              >
                <XMarkIcon class="h-4 w-4" />
              </button>
            </div>

            <!-- 身分與聯絡方式 -->
            <article class="rounded-2xl bg-white p-4 shadow-ios-card">
              <h3 class="text-sm font-semibold text-ios-text">
                {{ t("platformCustomers.detail.identity") }}
              </h3>
              <div class="mt-3 flex items-center gap-3">
                <span
                  class="flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-base font-semibold text-ios-blue"
                  aria-hidden="true"
                >
                  {{ customerInitial(selected) }}
                </span>
                <div>
                  <p class="text-sm font-medium text-ios-text">
                    {{ customerName(selected) }}
                  </p>
                  <p class="text-xs text-ios-secondary">
                    {{ selected.locale ?? "—" }}
                  </p>
                </div>
              </div>

              <dl class="mt-4 space-y-2 text-sm">
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-ios-secondary">
                    {{ t("platformCustomers.reveal.phone") }}
                  </dt>
                  <dd
                    class="text-ios-text"
                    data-testid="platform-customer-phone"
                  >
                    {{
                      revealed?.customerId === selected.customerId
                        ? (revealed.phone ?? t("platformCustomers.reveal.none"))
                        : (selected.maskedPhone ?? "—")
                    }}
                  </dd>
                </div>
                <div class="flex items-center justify-between gap-3">
                  <dt class="text-ios-secondary">
                    {{ t("platformCustomers.reveal.email") }}
                  </dt>
                  <dd
                    class="text-ios-text"
                    data-testid="platform-customer-email"
                  >
                    {{
                      revealed?.customerId === selected.customerId
                        ? (revealed.email ?? t("platformCustomers.reveal.none"))
                        : (selected.maskedEmail ?? "—")
                    }}
                  </dd>
                </div>
              </dl>

              <div v-if="selected.status !== 'deleted'" class="mt-4">
                <button
                  v-if="revealed?.customerId !== selected.customerId"
                  type="button"
                  data-testid="platform-customer-reveal"
                  :disabled="revealLoading"
                  class="flex items-center gap-2 rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text transition-colors duration-200 hover:bg-gray-200 disabled:opacity-50"
                  @click="revealContact"
                >
                  <EyeIcon class="h-4 w-4" />
                  {{
                    revealLoading
                      ? t("platformCustomers.reveal.revealing")
                      : t("platformCustomers.reveal.action")
                  }}
                </button>
                <div v-else class="space-y-2">
                  <button
                    type="button"
                    data-testid="platform-customer-hide"
                    class="flex items-center gap-2 rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text transition-colors duration-200 hover:bg-gray-200"
                    @click="clearReveal"
                  >
                    <EyeSlashIcon class="h-4 w-4" />
                    {{ t("platformCustomers.reveal.hide") }}
                  </button>
                  <p class="text-xs text-ios-secondary">
                    {{
                      t("platformCustomers.reveal.autoMaskNotice", {
                        minutes: REVEAL_TTL_MINUTES,
                      })
                    }}
                  </p>
                </div>
                <p
                  v-if="revealError"
                  data-testid="platform-customer-reveal-error"
                  class="mt-3 text-sm text-red-700"
                  role="alert"
                >
                  {{ revealError }}
                </p>
              </div>
            </article>

            <!-- 各店消費 -->
            <article class="rounded-2xl bg-white p-4 shadow-ios-card">
              <h3 class="text-sm font-semibold text-ios-text">
                {{ t("platformCustomers.detail.perRestaurant") }}
              </h3>
              <p class="mt-1 text-xs text-ios-secondary">
                {{ t("platformCustomers.detail.perRestaurantHint") }}
              </p>
              <p
                v-if="slicesLoading"
                class="mt-3 text-sm text-ios-secondary"
                aria-busy="true"
              >
                {{ t("common.loading") }}
              </p>
              <p
                v-else-if="slicesError"
                class="mt-3 text-sm text-red-700"
                role="alert"
              >
                {{ slicesError }}
              </p>
              <p
                v-else-if="slices.length === 0"
                class="mt-3 text-sm text-ios-secondary"
              >
                {{ t("platformCustomers.detail.perRestaurantEmpty") }}
              </p>
              <ul v-else class="mt-3 divide-y divide-gray-100">
                <li
                  v-for="slice in slices"
                  :key="slice.restaurantId"
                  :data-testid="`platform-customer-slice-${slice.restaurantId}`"
                  class="flex items-center justify-between gap-3 py-2.5"
                >
                  <div>
                    <p class="text-sm font-medium text-ios-text">
                      {{
                        slice.restaurantName ??
                        t("platformCustomers.detail.unknownRestaurant")
                      }}
                    </p>
                    <p class="text-xs text-ios-secondary">
                      {{
                        t("platformCustomers.detail.sliceOrders", {
                          count: slice.orderCount,
                          cancelled: slice.cancelledOrderCount,
                        })
                      }}
                    </p>
                  </div>
                  <p class="text-sm font-medium tabular-nums text-ios-text">
                    {{ formatCents(slice.totalSpentCents, slice.currency) }}
                  </p>
                </li>
              </ul>
            </article>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
/**
 * Platform customer directory (role 0) — spec §7.2 / §12.3, issue #299 A4.
 *
 * The cross-shop view of a person, which no tenant-scoped page may show. It
 * deliberately does NOT surface a shop's own tags, notes or block markers:
 * those are one tenant's private opinion of a customer, and the API does not
 * return them here.
 *
 * `PlatformCustomerMergesView` and the "start a merge" action from §12.3 are
 * stage D4, not this one — they need the merge engine that does not exist yet.
 */
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeSlashIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { formatCurrency } from "@makanmasak/utils";
import type { CurrencyCode } from "@makanmasak/shared-types";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  platformCustomersService,
  type Pagination,
  type PlatformCustomerContactReveal,
  type PlatformCustomerListItem,
  type PlatformCustomerListParams,
  type PlatformCustomerRestaurantSlice,
  type PlatformCustomerSort,
} from "@/services/platformCustomersService";

const PAGE_SIZE = 20;
/**
 * Same policy as the tenant page (§9.2): a revealed value is re-masked on a
 * pure client-side timer so a panel left open stops being a standing
 * disclosure. Nothing is persisted, so a reload masks it too.
 */
const REVEAL_TTL_MINUTES = 5;
const REVEAL_TTL_MS = REVEAL_TTL_MINUTES * 60 * 1000;

const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();
const { formatRelativeTime } = useDateFormatter();

const customers = ref<PlatformCustomerListItem[]>([]);
const pagination = ref<Pagination>({
  total: 0,
  page: 1,
  limit: PAGE_SIZE,
  pages: 1,
});
const page = ref(1);
const loading = ref(false);

const filters = reactive({
  search: "",
  status: "" as "" | "active" | "deleted",
  sort: "recent" as PlatformCustomerSort,
});

const selected = ref<PlatformCustomerListItem | null>(null);
const slices = ref<PlatformCustomerRestaurantSlice[]>([]);
const slicesLoading = ref(false);
const slicesError = ref<string | null>(null);

const revealed = ref<PlatformCustomerContactReveal | null>(null);
const revealLoading = ref(false);
const revealError = ref<string | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let remaskTimer: ReturnType<typeof setTimeout> | undefined;

const rangeStart = computed(() =>
  pagination.value.total === 0
    ? 0
    : (pagination.value.page - 1) * pagination.value.limit + 1,
);
const rangeEnd = computed(() =>
  Math.min(
    pagination.value.page * pagination.value.limit,
    pagination.value.total,
  ),
);
const visiblePages = computed(() => {
  const pages: number[] = [];
  const first = Math.max(1, page.value - 2);
  const last = Math.min(pagination.value.pages, page.value + 2);
  for (let candidate = first; candidate <= last; candidate += 1) {
    pages.push(candidate);
  }
  return pages;
});

function formatCents(cents: number, currency: CurrencyCode): string {
  return formatCurrency(cents / 100, currency);
}

function formatMoneyByCurrency(
  amounts: ReadonlyArray<{ currency: CurrencyCode; amountCents: number }>,
): string {
  if (amounts.length === 0) return "—";
  return amounts
    .map((amount) => formatCents(amount.amountCents, amount.currency))
    .join(" · ");
}

/** The API sends null for a deleted customer; the copy is the client's. */
function customerName(customer: PlatformCustomerListItem): string {
  if (customer.status === "deleted")
    return t("platformCustomers.deletedCustomer");
  return customer.displayName?.trim() || t("platformCustomers.unnamedCustomer");
}

function customerInitial(customer: PlatformCustomerListItem): string {
  return customerName(customer).slice(0, 1).toUpperCase();
}

function buildListParams(): PlatformCustomerListParams {
  return {
    page: page.value,
    limit: PAGE_SIZE,
    search: filters.search.trim() || undefined,
    status: filters.status === "" ? undefined : filters.status,
    sort: filters.sort,
  };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await platformCustomersService.list(buildListParams());
    customers.value = result.data;
    pagination.value = result.pagination;
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  page.value = 1;
  void load();
}

function debouncedReload(): void {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reload, 300);
}

function resetFilters(): void {
  filters.search = "";
  filters.status = "";
  filters.sort = "recent";
  reload();
}

function changePage(nextPage: number): void {
  if (nextPage < 1 || nextPage > pagination.value.pages) return;
  page.value = nextPage;
  void load();
}

async function openCustomer(customer: PlatformCustomerListItem): Promise<void> {
  clearReveal();
  selected.value = customer;
  slices.value = [];
  slicesError.value = null;
  slicesLoading.value = true;
  try {
    const rows = await platformCustomersService.listRestaurants(
      customer.customerId,
    );
    if (selected.value?.customerId !== customer.customerId) return;
    slices.value = rows;
  } catch {
    if (selected.value?.customerId !== customer.customerId) return;
    slicesError.value = t("platformCustomers.detail.perRestaurantFailed");
  } finally {
    slicesLoading.value = false;
  }
}

function closeDetail(): void {
  clearReveal();
  selected.value = null;
  slices.value = [];
  slicesError.value = null;
}

function clearReveal(): void {
  clearTimeout(remaskTimer);
  remaskTimer = undefined;
  revealed.value = null;
  revealError.value = null;
}

/**
 * The confirm modal is the gate, and it says out loud that the access is
 * recorded. Never call this on panel open or hover: it writes an audit row and
 * spends a per-account rate-limit budget shared with the tenant reveal.
 */
async function revealContact(): Promise<void> {
  const customer = selected.value;
  if (!customer || customer.status === "deleted") return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("platformCustomers.reveal.confirmTitle"),
    message: t("platformCustomers.reveal.confirmMessage"),
    confirmLabel: t("platformCustomers.reveal.confirmLabel"),
  });
  if (!confirmed) return;

  revealError.value = null;
  revealLoading.value = true;
  try {
    const result = await platformCustomersService.revealContact(
      customer.customerId,
    );
    if (selected.value?.customerId !== customer.customerId) return;
    revealed.value = {
      customerId: customer.customerId,
      phone: result?.phone ?? null,
      email: result?.email ?? null,
      revealedAt: result?.revealedAt ?? Date.now(),
    };
    clearTimeout(remaskTimer);
    remaskTimer = setTimeout(() => {
      revealed.value = null;
      remaskTimer = undefined;
    }, REVEAL_TTL_MS);
  } catch (error) {
    if (selected.value?.customerId !== customer.customerId) return;
    revealError.value = revealErrorMessage(error);
  } finally {
    revealLoading.value = false;
  }
}

function revealErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  if (status === 404) return t("platformCustomers.reveal.errors.notFound");
  if (status === 403) return t("platformCustomers.reveal.errors.forbidden");
  if (status === 429) return t("platformCustomers.reveal.errors.rateLimited");
  return t("platformCustomers.reveal.errors.failed");
}

onMounted(() => {
  void load();
});

onUnmounted(() => {
  clearTimeout(searchTimer);
  clearTimeout(remaskTimer);
});
</script>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 250ms ease-out;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
</style>
