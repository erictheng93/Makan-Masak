<template>
  <main class="min-h-full space-y-6 bg-ios-bg p-5">
    <header class="ui-toolbar flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="ui-page-heading text-2xl font-semibold text-ios-text">
          {{ t("pages.members") }}
        </h1>
        <p class="mt-1 text-sm text-ios-secondary">
          {{ t("members.subtitle") }}
        </p>
      </div>
      <button
        type="button"
        data-testid="member-export"
        :disabled="exporting || !restaurantId"
        class="ui-panel rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ios-text shadow-ios-sm transition-all duration-200 hover:shadow-ios-card disabled:opacity-50"
        @click="exportCsv"
      >
        {{ exporting ? t("members.export.busy") : t("members.export.action") }}
      </button>
    </header>

    <p
      v-if="exportError"
      data-testid="member-export-error"
      class="ui-panel rounded-2xl bg-white px-4 py-3 text-sm text-red-700 shadow-ios-sm"
      role="alert"
    >
      {{ exportError }}
    </p>

    <!-- 統計卡列 -->
    <section class="grid grid-cols-1 gap-4 md:grid-cols-4">
      <article
        v-for="card in statCards"
        :key="card.key"
        class="ui-panel rounded-2xl bg-white p-5 shadow-ios-card"
      >
        <div class="ui-page flex items-center gap-3">
          <span
            class="flex h-10 w-10 items-center justify-center rounded-full"
            :class="card.tint"
          >
            <component :is="card.icon" class="h-5 w-5" />
          </span>
          <div>
            <p class="text-xs text-ios-secondary">{{ card.label }}</p>
            <p class="mt-0.5 text-2xl font-semibold tabular-nums text-ios-text">
              {{ card.value }}
            </p>
          </div>
        </div>
      </article>
    </section>

    <!-- 快速篩選膠囊 -->
    <section class="flex flex-wrap gap-2">
      <button
        v-for="pill in quickFilterPills"
        :key="pill.key"
        type="button"
        :data-testid="`quick-filter-${pill.key}`"
        :data-active="activeQuickFilter === pill.key ? 'true' : 'false'"
        :aria-pressed="activeQuickFilter === pill.key"
        class="rounded-full px-4 py-2 text-sm font-medium transition-all duration-200"
        :class="
          activeQuickFilter === pill.key
            ? 'bg-primary-700 text-white'
            : 'bg-white text-ios-secondary shadow-ios-sm hover:text-ios-text'
        "
        @click="applyQuickFilter(pill.key)"
      >
        {{ pill.label }}
      </button>
    </section>

    <!-- 進階篩選 -->
    <section class="ui-panel rounded-2xl bg-white p-5 shadow-ios-card">
      <h2 class="mb-4 text-base font-semibold text-ios-text">
        {{ t("members.filters.title") }}
      </h2>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div class="md:col-span-2">
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-search"
          >
            {{ t("members.search.label") }}
          </label>
          <input
            id="member-search"
            v-model="filters.search"
            type="search"
            :placeholder="t('members.search.placeholder')"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @input="debouncedReload"
          />
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-sort"
          >
            {{ t("members.filters.sort") }}
          </label>
          <select
            id="member-sort"
            v-model="filters.sort"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          >
            <option value="recent">
              {{ t("members.filters.sortOptions.recent") }}
            </option>
            <option value="spent">
              {{ t("members.filters.sortOptions.spent") }}
            </option>
            <option value="orders">
              {{ t("members.filters.sortOptions.orders") }}
            </option>
            <option value="name">
              {{ t("members.filters.sortOptions.name") }}
            </option>
          </select>
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-blocked"
          >
            {{ t("members.filters.blocked") }}
          </label>
          <select
            id="member-blocked"
            v-model="filters.blocked"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          >
            <option value="">
              {{ t("members.filters.blockedOptions.all") }}
            </option>
            <option value="true">
              {{ t("members.filters.blockedOptions.blocked") }}
            </option>
            <option value="false">
              {{ t("members.filters.blockedOptions.active") }}
            </option>
          </select>
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-filter-tag"
          >
            {{ t("members.annotations.tagFilter") }}
          </label>
          <input
            id="member-filter-tag"
            v-model="filters.tag"
            data-testid="member-filter-tag"
            type="text"
            :placeholder="t('members.annotations.tagFilterPlaceholder')"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          />
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-min-orders"
          >
            {{ t("members.filters.minOrders") }}
          </label>
          <input
            id="member-min-orders"
            v-model="filters.minOrders"
            type="number"
            min="0"
            step="1"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          />
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-min-spent"
          >
            {{ t("members.filters.minSpent") }}
          </label>
          <input
            id="member-min-spent"
            v-model="filters.minSpent"
            type="number"
            min="0"
            step="1"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          />
        </div>
        <div>
          <label
            class="mb-2 block text-xs font-medium text-ios-secondary"
            for="member-last-from"
          >
            {{ t("members.filters.lastOrderFrom") }}
          </label>
          <input
            id="member-last-from"
            v-model="filters.lastOrderFrom"
            type="date"
            class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
            @change="reload"
          />
        </div>
        <div class="flex items-end gap-3">
          <div class="flex-1">
            <label
              class="mb-2 block text-xs font-medium text-ios-secondary"
              for="member-last-to"
            >
              {{ t("members.filters.lastOrderTo") }}
            </label>
            <input
              id="member-last-to"
              v-model="filters.lastOrderTo"
              type="date"
              class="w-full rounded-xl border-0 bg-ios-bg px-3 py-2.5 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
              @change="reload"
            />
          </div>
          <button
            type="button"
            data-testid="reset-filters"
            class="rounded-full bg-ios-bg px-4 py-2.5 text-sm font-medium text-ios-text transition-colors duration-200 hover:bg-gray-200"
            @click="resetFilters"
          >
            {{ t("members.filters.reset") }}
          </button>
        </div>
      </div>
    </section>

    <!-- 會員列表 -->
    <section
      class="ui-panel overflow-hidden rounded-2xl bg-white shadow-ios-card"
    >
      <div class="ui-table-scroll overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-100">
          <thead>
            <tr
              class="text-left text-xs font-medium uppercase tracking-wider text-ios-secondary"
            >
              <th class="px-6 py-3">{{ t("members.table.member") }}</th>
              <th class="px-6 py-3">{{ t("members.table.contact") }}</th>
              <th class="px-6 py-3">{{ t("members.table.orders") }}</th>
              <th class="px-6 py-3">{{ t("members.table.spent") }}</th>
              <th class="px-6 py-3">{{ t("members.table.lastOrder") }}</th>
              <th class="px-6 py-3">{{ t("members.table.firstOrder") }}</th>
              <th class="px-6 py-3">{{ t("members.table.status") }}</th>
              <th class="px-6 py-3 text-right">
                {{ t("members.table.actions") }}
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
            v-else-if="members.length === 0"
            class="divide-y divide-gray-100"
          >
            <tr>
              <td colspan="8" class="px-6 py-12 text-center">
                <UsersIcon class="mx-auto h-10 w-10 text-ios-tertiary" />
                <p class="mt-3 text-sm font-medium text-ios-text">
                  {{ t("members.empty.title") }}
                </p>
                <p class="mt-1 text-sm text-ios-secondary">
                  {{ t("members.empty.description") }}
                </p>
              </td>
            </tr>
          </tbody>
          <tbody v-else class="divide-y divide-gray-100">
            <tr
              v-for="member in members"
              :key="member.memberId"
              :data-testid="`member-row-${member.memberId}`"
              :data-status="member.status"
              class="cursor-pointer transition-colors duration-200 hover:bg-ios-bg"
              @click="openMember(member)"
            >
              <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                  <span
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-ios-blue"
                    aria-hidden="true"
                  >
                    {{ memberInitial(member) }}
                  </span>
                  <div>
                    <p class="text-sm font-medium text-ios-text">
                      {{ memberName(member) }}
                    </p>
                    <p
                      v-if="!member.marketingReachable"
                      data-testid="marketing-unreachable"
                      class="mt-1 inline-block rounded-full bg-orange-50 px-2 py-0.5 text-xs text-ios-orange"
                    >
                      {{ t("members.badges.marketingUnreachable") }}
                    </p>
                  </div>
                </div>
              </td>
              <td class="px-6 py-4 text-sm text-ios-secondary">
                <div>{{ member.maskedPhone ?? "—" }}</div>
                <div>{{ member.maskedEmail ?? "—" }}</div>
              </td>
              <td class="px-6 py-4 text-sm text-ios-text">
                {{ member.orderCount }}
                <span class="ml-1 text-xs text-ios-secondary">
                  {{
                    t("members.cancelledCount", {
                      count: member.cancelledOrderCount,
                    })
                  }}
                </span>
              </td>
              <td class="px-6 py-4 text-sm tabular-nums text-ios-text">
                {{ formatCents(member.totalSpentCents) }}
              </td>
              <td class="px-6 py-4 text-sm text-ios-secondary">
                {{ formatRelative(member.lastOrderAt) }}
              </td>
              <td class="px-6 py-4 text-sm text-ios-secondary">
                {{ formatDay(member.firstOrderAt) }}
              </td>
              <td class="px-6 py-4">
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="statusTint(member)"
                >
                  {{ statusLabel(member) }}
                </span>
              </td>
              <td class="px-6 py-4 text-right">
                <button
                  type="button"
                  :data-testid="`member-detail-${member.memberId}`"
                  class="rounded-full px-3 py-1.5 text-sm font-medium text-ios-blue transition-colors duration-200 hover:bg-blue-50"
                  @click.stop="openMember(member)"
                >
                  {{ t("members.actions.detail") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分頁 -->
      <footer
        v-if="pagination.total > 0"
        class="ui-toolbar flex items-center justify-between px-4 py-3 sm:px-6"
      >
        <div class="ui-toolbar flex flex-1 justify-between sm:hidden">
          <button
            type="button"
            :disabled="page === 1"
            class="rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text disabled:opacity-40"
            @click="changePage(page - 1)"
          >
            {{ t("members.pagination.previous") }}
          </button>
          <button
            type="button"
            :disabled="page >= pagination.pages"
            class="rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text disabled:opacity-40"
            @click="changePage(page + 1)"
          >
            {{ t("members.pagination.next") }}
          </button>
        </div>
        <div
          class="ui-toolbar hidden sm:flex sm:flex-1 sm:items-center sm:justify-between"
        >
          <p
            class="text-sm text-ios-secondary"
            data-testid="members-pagination-summary"
          >
            {{
              t("members.pagination.showing", {
                start: rangeStart,
                end: rangeEnd,
                total: pagination.total,
              })
            }}
          </p>
          <nav
            class="flex items-center gap-1"
            :aria-label="t('members.pagination.label')"
          >
            <button
              type="button"
              :disabled="page === 1"
              class="flex h-11 w-11 items-center justify-center rounded-full bg-ios-bg text-ios-text disabled:opacity-40"
              :aria-label="t('members.pagination.previous')"
              @click="changePage(page - 1)"
            >
              <ChevronLeftIcon class="h-4 w-4" />
            </button>
            <button
              v-for="visiblePage in visiblePages"
              :key="visiblePage"
              :aria-current="visiblePage === page ? 'page' : undefined"
              type="button"
              class="min-w-11 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-200"
              :class="
                visiblePage === page
                  ? 'bg-primary-700 text-white'
                  : 'bg-ios-bg text-ios-text hover:bg-gray-200'
              "
              @click="changePage(visiblePage)"
            >
              {{ visiblePage }}
            </button>
            <button
              type="button"
              :disabled="page >= pagination.pages"
              class="flex h-11 w-11 items-center justify-center rounded-full bg-ios-bg text-ios-text disabled:opacity-40"
              :aria-label="t('members.pagination.next')"
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
          v-if="selectedMember"
          class="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          <div
            class="absolute inset-0 bg-black/30 backdrop-blur-sm"
            @click="closeDetail"
          />
          <div
            data-testid="member-detail-panel"
            class="relative max-h-[90vh] w-full space-y-4 overflow-y-auto rounded-t-3xl bg-ios-bg p-5 sm:max-w-2xl sm:rounded-3xl"
          >
            <div class="ui-toolbar flex items-center justify-between">
              <h2 class="text-base font-semibold text-ios-text">
                {{ t("members.detail.title") }}
              </h2>
              <button
                type="button"
                data-testid="member-detail-close"
                class="flex h-11 w-11 items-center justify-center rounded-full bg-gray-200 text-ios-text/85 transition-colors duration-200 hover:bg-gray-300"
                :aria-label="t('members.detail.close')"
                @click="closeDetail"
              >
                <XMarkIcon class="h-4 w-4" />
              </button>
            </div>

            <p
              v-if="detailError"
              data-testid="member-detail-error"
              class="rounded-2xl bg-ios-red/10 px-4 py-3 text-sm text-ios-red"
            >
              {{ detailError }}
            </p>

            <!-- 身分與聯絡方式 -->
            <article class="ui-panel rounded-2xl bg-white p-4 shadow-ios-card">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-base font-semibold text-ios-blue"
                  aria-hidden="true"
                >
                  {{ memberInitial(selectedMember) }}
                </span>
                <div>
                  <p
                    data-testid="member-detail-name"
                    class="text-base font-semibold text-ios-text"
                  >
                    {{ memberName(selectedMember) }}
                  </p>
                  <div class="mt-1 flex flex-wrap gap-1.5">
                    <span
                      class="rounded-full px-2.5 py-0.5 text-xs font-medium"
                      :class="statusTint(selectedMember)"
                    >
                      {{ statusLabel(selectedMember) }}
                    </span>
                    <span
                      v-if="!selectedMember.marketingReachable"
                      class="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-ios-orange"
                    >
                      {{ t("members.badges.marketingUnreachable") }}
                    </span>
                  </div>
                </div>
              </div>

              <h3 class="mt-4 text-xs font-medium text-ios-secondary">
                {{ t("members.detail.contact") }}
              </h3>
              <dl class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-ios-secondary">
                    {{ t("members.reveal.phone") }}
                  </dt>
                  <dd data-testid="member-phone" class="text-ios-text">
                    {{ displayedPhone }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-ios-secondary">
                    {{ t("members.reveal.email") }}
                  </dt>
                  <dd data-testid="member-email" class="text-ios-text">
                    {{ displayedEmail }}
                  </dd>
                </div>
              </dl>

              <div class="mt-3 flex flex-wrap items-center gap-3">
                <button
                  v-if="!isRevealed"
                  type="button"
                  data-testid="reveal-contact"
                  :disabled="
                    revealLoading || selectedMember.status === 'deleted'
                  "
                  class="inline-flex items-center gap-1.5 rounded-full bg-primary-700 px-4 py-2 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-800 disabled:opacity-40"
                  @click="revealContact"
                >
                  <EyeIcon class="h-4 w-4" />
                  {{
                    revealLoading
                      ? t("members.reveal.revealing")
                      : t("members.reveal.action")
                  }}
                </button>
                <button
                  v-else
                  type="button"
                  data-testid="mask-contact"
                  class="inline-flex items-center gap-1.5 rounded-full bg-ios-bg px-4 py-2 text-sm font-medium text-ios-text transition-colors duration-200 hover:bg-gray-200"
                  @click="clearReveal"
                >
                  <EyeSlashIcon class="h-4 w-4" />
                  {{ t("members.reveal.hide") }}
                </button>
                <p
                  v-if="isRevealed"
                  data-testid="reveal-auto-mask-notice"
                  class="text-xs text-ios-secondary"
                >
                  {{
                    t("members.reveal.autoMaskNotice", {
                      minutes: REVEAL_TTL_MINUTES,
                    })
                  }}
                </p>
              </div>

              <p
                v-if="revealError"
                data-testid="reveal-error"
                class="mt-3 rounded-xl bg-ios-red/10 px-3 py-2 text-sm text-ios-red"
                role="alert"
              >
                {{ revealError }}
              </p>
            </article>

            <!-- 本店消費摘要 -->
            <article class="ui-panel rounded-2xl bg-white p-4 shadow-ios-card">
              <h3 class="text-base font-semibold text-ios-text">
                {{ t("members.detail.summary") }}
              </h3>
              <dl class="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3">
                <div v-for="entry in summaryEntries" :key="entry.key">
                  <dt class="text-xs text-ios-secondary">{{ entry.label }}</dt>
                  <dd
                    class="mt-0.5 text-sm font-medium tabular-nums text-ios-text"
                  >
                    {{ entry.value }}
                  </dd>
                </div>
              </dl>
            </article>

            <!-- 本店訂單紀錄 -->
            <article class="ui-panel rounded-2xl bg-white p-4 shadow-ios-card">
              <h3 class="text-base font-semibold text-ios-text">
                {{ t("members.detail.orders") }}
              </h3>
              <p
                v-if="ordersError"
                data-testid="member-orders-error"
                class="mt-3 rounded-xl bg-ios-red/10 px-3 py-2 text-sm text-ios-red"
              >
                {{ ordersError }}
              </p>
              <p
                v-else-if="ordersLoading"
                class="mt-3 text-sm text-ios-secondary"
                aria-busy="true"
              >
                {{ t("common.loading") }}
              </p>
              <p
                v-else-if="memberOrders.length === 0"
                class="mt-3 text-sm text-ios-secondary"
              >
                {{ t("members.detail.ordersEmpty") }}
              </p>
              <ul v-else class="mt-3 divide-y divide-gray-100">
                <li
                  v-for="order in memberOrders"
                  :key="order.orderId"
                  :data-testid="`member-order-${order.orderId}`"
                  class="ui-toolbar flex items-center justify-between gap-3 py-2.5"
                >
                  <div>
                    <p class="text-sm font-medium text-ios-text">
                      {{ order.orderNumber }}
                    </p>
                    <p class="text-xs text-ios-secondary">
                      {{ formatDay(order.createdAt) }}
                    </p>
                  </div>
                  <div class="flex items-center gap-3">
                    <span
                      class="rounded-full bg-ios-bg px-2.5 py-0.5 text-xs font-medium text-ios-secondary"
                    >
                      {{ orderStatusLabel(order.status) }}
                    </span>
                    <span
                      class="text-sm font-medium tabular-nums text-ios-text"
                    >
                      {{ formatCents(order.totalAmountCents) }}
                    </span>
                  </div>
                </li>
              </ul>
              <div
                v-if="ordersPagination.pages > 1"
                class="ui-toolbar mt-3 flex items-center justify-between"
              >
                <span class="text-xs text-ios-secondary">
                  {{
                    t("members.pagination.showing", {
                      start: ordersRangeStart,
                      end: ordersRangeEnd,
                      total: ordersPagination.total,
                    })
                  }}
                </span>
                <div class="flex gap-2">
                  <button
                    type="button"
                    data-testid="member-orders-prev"
                    :disabled="ordersPage === 1"
                    class="rounded-full bg-ios-bg px-3 py-1.5 text-sm text-ios-text disabled:opacity-40"
                    @click="changeOrdersPage(ordersPage - 1)"
                  >
                    {{ t("members.pagination.previous") }}
                  </button>
                  <button
                    type="button"
                    data-testid="member-orders-next"
                    :disabled="ordersPage >= ordersPagination.pages"
                    class="rounded-full bg-ios-bg px-3 py-1.5 text-sm text-ios-text disabled:opacity-40"
                    @click="changeOrdersPage(ordersPage + 1)"
                  >
                    {{ t("members.pagination.next") }}
                  </button>
                </div>
              </div>
            </article>

            <!-- 本店註記：標籤與備註 -->
            <article class="ui-panel rounded-2xl bg-white p-4 shadow-ios-card">
              <h3 class="text-base font-semibold text-ios-text">
                {{ t("members.annotations.title") }}
              </h3>
              <p class="mt-1 text-xs text-ios-secondary">
                {{ t("members.annotations.description") }}
              </p>

              <label
                class="mt-4 block text-xs font-medium text-ios-secondary"
                for="member-tag-input"
              >
                {{ t("members.annotations.tagsLabel") }}
              </label>
              <div
                class="mt-1.5 flex flex-wrap items-center gap-1.5"
                data-testid="member-tag-list"
              >
                <span
                  v-for="tag in draft.tags"
                  :key="tag"
                  class="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700"
                >
                  {{ tag }}
                  <button
                    type="button"
                    :data-testid="`member-tag-remove-${tag}`"
                    :aria-label="t('members.annotations.tagRemove', { tag })"
                    class="text-blue-700 transition-opacity duration-200 hover:opacity-60"
                    @click="removeTag(tag)"
                  >
                    <XMarkIcon class="h-3 w-3" />
                  </button>
                </span>
              </div>
              <input
                id="member-tag-input"
                v-model="tagDraft"
                data-testid="member-tag-input"
                type="text"
                :placeholder="t('members.annotations.tagsPlaceholder')"
                class="mt-2 w-full rounded-xl border-0 bg-ios-bg px-3 py-2 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
                @keydown.enter.prevent="addTag"
              />
              <p class="mt-1 text-xs text-ios-tertiary">
                {{ t("members.annotations.tagsHint") }}
              </p>

              <label
                class="mt-4 block text-xs font-medium text-ios-secondary"
                for="member-note-input"
              >
                {{ t("members.annotations.noteLabel") }}
              </label>
              <textarea
                id="member-note-input"
                v-model="draft.note"
                data-testid="member-note-input"
                rows="3"
                :placeholder="t('members.annotations.notePlaceholder')"
                class="mt-1.5 w-full rounded-xl border-0 bg-ios-bg px-3 py-2 text-sm text-ios-text focus:ring-2 focus:ring-ios-blue/30"
              ></textarea>

              <div class="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="member-annotations-save"
                  :disabled="annotationsSaving"
                  class="inline-flex h-11 items-center rounded-full bg-blue-500 px-5 text-sm font-medium text-white transition-colors duration-200 hover:bg-primary-800 disabled:opacity-40"
                  @click="saveAnnotations"
                >
                  {{
                    annotationsSaving
                      ? t("members.annotations.saving")
                      : t("members.annotations.save")
                  }}
                </button>
                <span
                  v-if="annotationsSaved"
                  data-testid="member-annotations-saved"
                  class="text-xs text-green-700"
                >
                  {{ t("members.annotations.saved") }}
                </span>
              </div>
            </article>

            <!-- 封鎖標記（危險區） -->
            <article class="rounded-2xl bg-red-50 p-4">
              <h3 class="text-base font-semibold text-red-700">
                {{ t("members.block.title") }}
              </h3>
              <p
                data-testid="member-block-explain"
                class="mt-1 text-xs text-red-700"
              >
                {{ t("members.block.explain") }}
              </p>

              <p
                v-if="selectedMember.isBlocked && selectedMember.blockedReason"
                data-testid="member-block-current-reason"
                class="mt-3 text-sm text-red-700"
              >
                {{
                  t("members.block.currentReason", {
                    reason: selectedMember.blockedReason,
                  })
                }}
              </p>

              <template v-if="!selectedMember.isBlocked">
                <label
                  class="mt-3 block text-xs font-medium text-red-700"
                  for="member-block-reason"
                >
                  {{ t("members.block.reasonLabel") }}
                </label>
                <input
                  id="member-block-reason"
                  v-model="blockReasonDraft"
                  data-testid="member-block-reason"
                  type="text"
                  :placeholder="t('members.block.reasonPlaceholder')"
                  class="mt-1.5 w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-ios-text focus:ring-2 focus:ring-red-500/30"
                />
              </template>

              <button
                type="button"
                data-testid="member-block-toggle"
                :disabled="blockPending || selectedMember.status === 'deleted'"
                class="mt-3 inline-flex h-11 items-center rounded-full px-5 text-sm font-medium transition-colors duration-200 disabled:opacity-40"
                :class="blockButtonTint"
                @click="toggleBlocked"
              >
                {{ blockButtonLabel }}
              </button>

              <p
                v-if="blockError"
                data-testid="member-block-error"
                class="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-red-700"
                role="alert"
              >
                {{ blockError }}
              </p>
            </article>
          </div>
        </div>
      </Transition>
    </Teleport>
  </main>
</template>

<script setup lang="ts">
import { computed, onUnmounted, onMounted, reactive, ref } from "vue";
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CurrencyDollarIcon,
  EyeIcon,
  EyeSlashIcon,
  UserPlusIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth";
import { useCurrency } from "@/composables/useCurrency";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useDateFormatter } from "@/composables/useDateFormatter";
import {
  membersService,
  type MemberContactReveal,
  type MemberListItem,
  type MemberListParams,
  type MemberOrderItem,
  type MemberSort,
  type MemberStats,
  type Pagination,
} from "@/services/membersService";

const PAGE_SIZE = 20;
const ORDERS_PAGE_SIZE = 20;
const FREQUENT_MIN_ORDERS = 5;
/**
 * The "first-time customer" pill. Needs an upper bound, which is why the API
 * gained `maxOrders` -- `minOrders` alone cannot express "exactly one order".
 */
const NEW_MAX_ORDERS = 1;
const DORMANT_DAYS = 30;
/**
 * §9.2: revealed PII is re-masked on a pure client-side timer so a panel left
 * open on a counter screen stops being a standing PII disclosure. Nothing is
 * persisted, so a reload masks it too.
 */
const REVEAL_TTL_MINUTES = 5;
const REVEAL_TTL_MS = REVEAL_TTL_MINUTES * 60 * 1000;

const KNOWN_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "paid",
  "served",
  "completed",
  "cancelled",
] as const;

type QuickFilter = "all" | "frequent" | "new" | "dormant" | "blocked";

const { t } = useI18n();
const authStore = useAuthStore();
const { formatPrice } = useCurrency();
const { confirm: confirmModal } = useConfirmModal();
const { formatShortDate, formatRelativeTime } = useDateFormatter();

const members = ref<MemberListItem[]>([]);
const stats = ref<MemberStats>({
  totalMembers: 0,
  newThisMonth: 0,
  repeatRate: 0,
  avgOrderValueCents: 0,
});
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
  sort: "recent" as MemberSort,
  blocked: "" as "" | "true" | "false",
  tag: "",
  // v-model on <input type="number"> applies the .number modifier implicitly,
  // so these arrive as numbers once typed into and as "" while empty.
  minOrders: "" as string | number,
  // Written only by the "first-time customer" pill; the advanced filter card
  // has no input for it (spec §12.2 does not list one).
  maxOrders: "" as string | number,
  minSpent: "" as string | number,
  lastOrderFrom: "",
  lastOrderTo: "",
});

const selectedMember = ref<MemberListItem | null>(null);
const detailError = ref<string | null>(null);
const memberOrders = ref<MemberOrderItem[]>([]);
const ordersPagination = ref<Pagination>({
  total: 0,
  page: 1,
  limit: ORDERS_PAGE_SIZE,
  pages: 1,
});
const ordersPage = ref(1);
const ordersLoading = ref(false);
const ordersError = ref<string | null>(null);

const exporting = ref(false);
const exportError = ref<string | null>(null);

const revealed = ref<(MemberContactReveal & { memberId: string }) | null>(null);
const revealLoading = ref(false);
const revealError = ref<string | null>(null);

/**
 * A3 annotation draft. Held separately from `selectedMember` so an unsaved
 * edit never leaks into the list rows behind the drawer, and so closing the
 * drawer discards it rather than showing a value the server never received.
 */
const draft = reactive<{ tags: string[]; note: string }>({
  tags: [],
  note: "",
});
const tagDraft = ref("");
const blockReasonDraft = ref("");
const annotationsSaving = ref(false);
const annotationsSaved = ref(false);
const blockPending = ref(false);
const blockError = ref<string | null>(null);
let savedNoticeTimer: ReturnType<typeof setTimeout> | undefined;

let searchTimer: ReturnType<typeof setTimeout> | undefined;
let remaskTimer: ReturnType<typeof setTimeout> | undefined;

const restaurantId = computed(() =>
  authStore.restaurantId == null ? null : String(authStore.restaurantId),
);

const statCards = computed(() => [
  {
    key: "total",
    label: t("members.stats.total"),
    value: String(stats.value.totalMembers),
    icon: UsersIcon,
    tint: "bg-blue-50 text-ios-blue",
  },
  {
    key: "newThisMonth",
    label: t("members.stats.newThisMonth"),
    value: String(stats.value.newThisMonth),
    icon: UserPlusIcon,
    tint: "bg-green-50 text-ios-green",
  },
  {
    key: "repeatRate",
    label: t("members.stats.repeatRate"),
    value: `${Math.round(stats.value.repeatRate * 100)}%`,
    icon: ArrowPathIcon,
    tint: "bg-orange-50 text-ios-orange",
  },
  {
    key: "avgOrderValue",
    label: t("members.stats.avgOrderValue"),
    value: formatCents(stats.value.avgOrderValueCents),
    icon: CurrencyDollarIcon,
    tint: "bg-teal-50 text-teal-700",
  },
]);

const quickFilterPills = computed<{ key: QuickFilter; label: string }[]>(() => [
  { key: "all", label: t("members.quickFilters.all") },
  { key: "frequent", label: t("members.quickFilters.frequent") },
  { key: "new", label: t("members.quickFilters.new") },
  { key: "dormant", label: t("members.quickFilters.dormant") },
  { key: "blocked", label: t("members.quickFilters.blocked") },
]);

// Derived rather than stored, so the pills can never disagree with the advanced
// filter card they write into.
const activeQuickFilter = computed<QuickFilter>(() => {
  if (filters.blocked === "true") return "blocked";
  if (toOptionalNumber(filters.minOrders) === FREQUENT_MIN_ORDERS)
    return "frequent";
  if (toOptionalNumber(filters.maxOrders) === NEW_MAX_ORDERS) return "new";
  if (filters.lastOrderTo && filters.lastOrderTo === dormantCutoff())
    return "dormant";
  return "all";
});

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
const ordersRangeStart = computed(() =>
  ordersPagination.value.total === 0
    ? 0
    : (ordersPagination.value.page - 1) * ordersPagination.value.limit + 1,
);
const ordersRangeEnd = computed(() =>
  Math.min(
    ordersPagination.value.page * ordersPagination.value.limit,
    ordersPagination.value.total,
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

const isRevealed = computed(
  () =>
    revealed.value !== null &&
    revealed.value.memberId === selectedMember.value?.memberId,
);

const displayedPhone = computed(() => {
  if (isRevealed.value) {
    return revealed.value?.phone ?? t("members.reveal.none");
  }
  return selectedMember.value?.maskedPhone ?? t("members.reveal.none");
});

const displayedEmail = computed(() => {
  if (isRevealed.value) {
    return revealed.value?.email ?? t("members.reveal.none");
  }
  return selectedMember.value?.maskedEmail ?? t("members.reveal.none");
});

const summaryEntries = computed(() => {
  const member = selectedMember.value;
  if (!member) return [];
  return [
    {
      key: "orderCount",
      label: t("members.detail.orderCount"),
      value: String(member.orderCount),
    },
    {
      key: "cancelledOrders",
      label: t("members.detail.cancelledOrders"),
      value: String(member.cancelledOrderCount),
    },
    {
      key: "totalSpent",
      label: t("members.detail.totalSpent"),
      value: formatCents(member.totalSpentCents),
    },
    {
      key: "avgOrderValue",
      label: t("members.detail.avgOrderValue"),
      value: formatCents(member.avgOrderValueCents),
    },
    {
      key: "firstOrder",
      label: t("members.detail.firstOrder"),
      value: formatDay(member.firstOrderAt),
    },
    {
      key: "lastOrder",
      label: t("members.detail.lastOrder"),
      value: formatDay(member.lastOrderAt),
    },
  ];
});

function formatCents(cents: number | null | undefined): string {
  return formatPrice((cents ?? 0) / 100);
}

function formatDay(value: string | null): string {
  return value ? formatShortDate(value) : "—";
}

function formatRelative(value: string | null): string {
  return value ? formatRelativeTime(value) : "—";
}

function orderStatusLabel(status: string): string {
  // Only literal, known statuses go through t(); anything else is echoed so an
  // unmapped status never renders as a raw translation key.
  return (KNOWN_ORDER_STATUSES as readonly string[]).includes(status)
    ? t(`orders.status.${status}`)
    : status;
}

function memberName(member: MemberListItem): string {
  if (member.status === "deleted") return t("members.deletedCustomer");
  const name = member.displayName?.trim();
  return name ? name : t("members.unnamedCustomer");
}

function memberInitial(member: MemberListItem): string {
  return memberName(member).slice(0, 1).toUpperCase();
}

function statusLabel(member: MemberListItem): string {
  if (member.status === "deleted") return t("members.status.deleted");
  if (member.isBlocked) return t("members.status.blocked");
  return t("members.status.active");
}

function statusTint(member: MemberListItem): string {
  if (member.status === "deleted") return "bg-gray-100 text-ios-secondary";
  if (member.isBlocked) return "bg-red-50 text-ios-red";
  return "bg-green-50 text-ios-green";
}

function dormantCutoff(): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DORMANT_DAYS);
  const month = String(cutoff.getMonth() + 1).padStart(2, "0");
  const day = String(cutoff.getDate()).padStart(2, "0");
  return `${cutoff.getFullYear()}-${month}-${day}`;
}

function toOptionalNumber(value: string | number): number | undefined {
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildListParams(): MemberListParams {
  const minOrders = toOptionalNumber(filters.minOrders);
  const maxOrders = toOptionalNumber(filters.maxOrders);
  const minSpent = toOptionalNumber(filters.minSpent);
  return {
    page: page.value,
    limit: PAGE_SIZE,
    search: filters.search.trim() || undefined,
    // Exact match server-side; a partial tag would turn the list into an
    // enumeration tool the same way a partial phone search would.
    tag: filters.tag.trim() || undefined,
    sort: filters.sort,
    minOrders: minOrders === undefined ? undefined : Math.floor(minOrders),
    maxOrders: maxOrders === undefined ? undefined : Math.floor(maxOrders),
    // The filter is entered in major currency units; the API speaks cents.
    minSpentCents:
      minSpent === undefined ? undefined : Math.round(minSpent * 100),
    lastOrderFrom: filters.lastOrderFrom || undefined,
    lastOrderTo: filters.lastOrderTo || undefined,
    blocked: filters.blocked === "" ? undefined : filters.blocked,
  };
}

async function load(): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;
  loading.value = true;
  try {
    const [list, memberStats] = await Promise.all([
      membersService.list(id, buildListParams()),
      membersService.stats(id),
    ]);
    members.value = list.data;
    pagination.value = list.pagination;
    stats.value = memberStats;
  } finally {
    loading.value = false;
  }
}

function reload(): void {
  page.value = 1;
  void load();
}

/**
 * §7.1 export. Exports what the operator is looking at, not the whole
 * directory: the same filters the list is showing, minus paging, which the
 * API rejects outright.
 *
 * The server writes an audit row for this, so it is bound to a click and
 * nothing else -- never a watcher, never a retry.
 */
async function exportCsv(): Promise<void> {
  const id = restaurantId.value;
  if (!id || exporting.value) return;
  exporting.value = true;
  exportError.value = null;
  try {
    const { page: _page, limit: _limit, ...filterParams } = buildListParams();
    const blob = await membersService.exportCsv(id, filterParams);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch {
    exportError.value = t("members.export.failed");
  } finally {
    exporting.value = false;
  }
}

function debouncedReload(): void {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(reload, 300);
}

function applyQuickFilter(kind: QuickFilter): void {
  filters.minOrders = "";
  filters.maxOrders = "";
  filters.blocked = "";
  filters.lastOrderTo = "";
  if (kind === "frequent") filters.minOrders = FREQUENT_MIN_ORDERS;
  if (kind === "new") filters.maxOrders = NEW_MAX_ORDERS;
  if (kind === "blocked") filters.blocked = "true";
  if (kind === "dormant") filters.lastOrderTo = dormantCutoff();
  reload();
}

function resetFilters(): void {
  filters.search = "";
  filters.sort = "recent";
  filters.blocked = "";
  filters.tag = "";
  filters.minOrders = "";
  filters.maxOrders = "";
  filters.minSpent = "";
  filters.lastOrderFrom = "";
  filters.lastOrderTo = "";
  reload();
}

function changePage(nextPage: number): void {
  if (nextPage < 1 || nextPage > pagination.value.pages) return;
  page.value = nextPage;
  void load();
}

async function openMember(member: MemberListItem): Promise<void> {
  clearReveal();
  selectedMember.value = member;
  resetAnnotationDraft(member);
  detailError.value = null;
  ordersPage.value = 1;
  await Promise.all([
    loadMemberDetail(member.memberId),
    loadMemberOrders(member.memberId),
  ]);
}

function closeDetail(): void {
  clearReveal();
  selectedMember.value = null;
  // Drop the unsaved draft with the drawer: reopening must show what the
  // server holds, never a half-typed edit from a previous member.
  resetAnnotationDraft(null);
  memberOrders.value = [];
  detailError.value = null;
  ordersError.value = null;
}

async function loadMemberDetail(memberId: string): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;
  try {
    const detail = await membersService.get(id, memberId);
    if (selectedMember.value?.memberId !== memberId) return;
    selectedMember.value = detail;
    // The list projection and the detail projection can differ; the draft has
    // to follow the authoritative one.
    resetAnnotationDraft(detail);
  } catch {
    if (selectedMember.value?.memberId !== memberId) return;
    detailError.value = t("members.detail.loadFailed");
  }
}

async function loadMemberOrders(memberId: string): Promise<void> {
  const id = restaurantId.value;
  if (!id) return;
  ordersLoading.value = true;
  ordersError.value = null;
  try {
    const result = await membersService.listOrders(id, memberId, {
      page: ordersPage.value,
      limit: ORDERS_PAGE_SIZE,
    });
    if (selectedMember.value?.memberId !== memberId) return;
    memberOrders.value = result.data;
    ordersPagination.value = result.pagination;
  } catch {
    if (selectedMember.value?.memberId !== memberId) return;
    memberOrders.value = [];
    ordersError.value = t("members.detail.ordersLoadFailed");
  } finally {
    ordersLoading.value = false;
  }
}

function changeOrdersPage(nextPage: number): void {
  const member = selectedMember.value;
  if (!member) return;
  if (nextPage < 1 || nextPage > ordersPagination.value.pages) return;
  ordersPage.value = nextPage;
  void loadMemberOrders(member.memberId);
}

function apiErrorStatus(error: unknown): number | undefined {
  const response = (error as { response?: { status?: unknown } })?.response;
  return typeof response?.status === "number" ? response.status : undefined;
}

function apiErrorCode(error: unknown): string | undefined {
  const payload = (
    error as {
      response?: { data?: { error?: { code?: unknown } } };
    }
  )?.response?.data?.error;
  return typeof payload?.code === "string" ? payload.code : undefined;
}

function revealErrorMessage(error: unknown): string {
  const code = apiErrorCode(error);
  const status = apiErrorStatus(error);
  if (code === "MEMBER_NOT_FOUND" || status === 404) {
    return t("members.reveal.errors.notFound");
  }
  if (code === "PII_REVEAL_RATE_LIMITED" || status === 429) {
    return t("members.reveal.errors.rateLimited");
  }
  // MEMBER_DELETED is the API's code for a soft-deleted customer, whose full
  // contact details are withheld outright (spec §9.4).
  if (
    code === "MEMBER_DELETED" ||
    code === "MEMBER_ACCESS_DENIED" ||
    code === "FORBIDDEN" ||
    status === 403
  ) {
    return t("members.reveal.errors.forbidden");
  }
  return t("members.reveal.errors.failed");
}

/**
 * A2 PII reveal. Deliberate action only — a confirm modal that states the
 * access is audited, then one POST. The full values live in `revealed`, which
 * is never merged back into `members`, so leaving the panel loses them.
 */
async function revealContact(): Promise<void> {
  const member = selectedMember.value;
  const id = restaurantId.value;
  if (!member || !id || member.status === "deleted") return;

  const confirmed = await confirmModal({
    type: "warning",
    title: t("members.reveal.confirmTitle"),
    message: t("members.reveal.confirmMessage"),
    confirmLabel: t("members.reveal.confirmLabel"),
  });
  if (!confirmed) return;

  revealError.value = null;
  revealLoading.value = true;
  try {
    const result = await membersService.revealContact(id, member.memberId);
    if (selectedMember.value?.memberId !== member.memberId) return;
    revealed.value = {
      memberId: member.memberId,
      phone: result?.phone ?? null,
      email: result?.email ?? null,
      revealedAt: result?.revealedAt ?? Date.now(),
    };
    scheduleRemask();
  } catch (error) {
    if (selectedMember.value?.memberId !== member.memberId) return;
    revealError.value = revealErrorMessage(error);
  } finally {
    revealLoading.value = false;
  }
}

function scheduleRemask(): void {
  clearTimeout(remaskTimer);
  remaskTimer = setTimeout(() => {
    revealed.value = null;
    remaskTimer = undefined;
  }, REVEAL_TTL_MS);
}

function clearReveal(): void {
  clearTimeout(remaskTimer);
  remaskTimer = undefined;
  revealed.value = null;
  revealError.value = null;
}

/**
 * Class names are looked up from a static map, never assembled from a state
 * value. Tailwind's scanner cannot follow `bg-${x}-50`, so a concatenated
 * class is simply never generated and the styling silently does not render.
 */
const BLOCK_BUTTON_TINT: Record<"block" | "unblock", string> = {
  block: "bg-red-500 text-white hover:bg-red-700",
  unblock: "bg-white text-red-700 hover:bg-red-100",
};

const blockButtonTint = computed(() =>
  selectedMember.value?.isBlocked
    ? BLOCK_BUTTON_TINT.unblock
    : BLOCK_BUTTON_TINT.block,
);

const blockButtonLabel = computed(() => {
  if (blockPending.value) return t("members.block.blocking");
  return selectedMember.value?.isBlocked
    ? t("members.block.unblockAction")
    : t("members.block.blockAction");
});

/** Reset the drafts to whatever the server currently holds for this member. */
function resetAnnotationDraft(member: MemberListItem | null): void {
  draft.tags = member?.tags ? [...member.tags] : [];
  draft.note = member?.note ?? "";
  tagDraft.value = "";
  blockReasonDraft.value = "";
  annotationsSaved.value = false;
  blockError.value = null;
}

function addTag(): void {
  const tag = tagDraft.value.trim();
  tagDraft.value = "";
  // Deduplicate here rather than letting the API reject the whole PATCH: a
  // repeated tag is a slip, not an error worth failing the save over.
  if (!tag || draft.tags.includes(tag)) return;
  draft.tags.push(tag);
}

function removeTag(tag: string): void {
  draft.tags = draft.tags.filter((entry) => entry !== tag);
}

function annotationErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response
    ?.status;
  const code = (
    error as { response?: { data?: { error?: { code?: string } } } }
  )?.response?.data?.error?.code;
  if (code === "MEMBER_NOT_FOUND" || status === 404) {
    return t("members.block.errors.notFound");
  }
  if (status === 400) return t("members.block.errors.invalid");
  return t("members.block.errors.failed");
}

/**
 * `tags` replaces the whole list server-side, so the full intended array goes
 * out every time. An empty note is sent as null rather than "" so the column
 * ends up genuinely cleared instead of holding an empty string.
 */
async function saveAnnotations(): Promise<void> {
  const id = restaurantId.value;
  const member = selectedMember.value;
  if (!id || !member) return;
  annotationsSaving.value = true;
  annotationsSaved.value = false;
  blockError.value = null;
  try {
    const updated = await membersService.update(id, member.memberId, {
      tags: draft.tags.length > 0 ? [...draft.tags] : null,
      note: draft.note.trim() ? draft.note.trim() : null,
    });
    applyUpdatedMember(updated);
    annotationsSaved.value = true;
    clearTimeout(savedNoticeTimer);
    savedNoticeTimer = setTimeout(() => {
      annotationsSaved.value = false;
      savedNoticeTimer = undefined;
    }, 4000);
  } catch (error) {
    blockError.value = annotationErrorMessage(error);
  } finally {
    annotationsSaving.value = false;
  }
}

async function toggleBlocked(): Promise<void> {
  const id = restaurantId.value;
  const member = selectedMember.value;
  if (!id || !member) return;
  const nextBlocked = !member.isBlocked;
  const name = memberName(member);
  const confirmed = await confirmModal({
    title: t("members.block.title"),
    message: nextBlocked
      ? t("members.block.confirmBlock", { name })
      : t("members.block.confirmUnblock", { name }),
    confirmLabel: nextBlocked
      ? t("members.block.blockAction")
      : t("members.block.unblockAction"),
    type: "danger",
  });
  if (!confirmed) return;

  blockPending.value = true;
  blockError.value = null;
  try {
    const updated = await membersService.update(id, member.memberId, {
      isBlocked: nextBlocked,
      // Only meaningful when blocking; the API clears it on an unblock anyway.
      ...(nextBlocked && blockReasonDraft.value.trim()
        ? { blockedReason: blockReasonDraft.value.trim() }
        : {}),
    });
    applyUpdatedMember(updated);
    blockReasonDraft.value = "";
  } catch (error) {
    blockError.value = annotationErrorMessage(error);
  } finally {
    blockPending.value = false;
  }
}

/** Keep the drawer and the row behind it in step with what the server saved. */
function applyUpdatedMember(updated: MemberListItem): void {
  selectedMember.value = updated;
  const index = members.value.findIndex(
    (row) => row.memberId === updated.memberId,
  );
  if (index !== -1) members.value[index] = updated;
  resetAnnotationDraft(updated);
}

onMounted(() => void load());
onUnmounted(() => {
  clearTimeout(savedNoticeTimer);
  clearTimeout(searchTimer);
  clearReveal();
});
</script>

<style scoped>
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
