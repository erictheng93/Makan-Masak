<template>
  <div class="group-orders-view">
    <!-- 標題區域 -->
    <div
      class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-8"
    >
      <div>
        <h1 class="text-2xl sm:text-3xl font-bold text-gray-900">
          {{ t("groupOrders.title") }}
        </h1>
        <p class="text-gray-600 text-sm sm:text-base">
          {{ t("groupOrders.subtitle") }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <!-- 即時統計 -->
        <div class="bg-blue-100 px-3 py-2 rounded-lg">
          <p class="text-sm text-blue-800 font-medium whitespace-nowrap">
            {{ t("groupOrders.activeOrders") }}: {{ activeGroupOrders }}
          </p>
          <p class="text-xs text-blue-600 whitespace-nowrap">
            {{ t("groupOrders.totalOrders") }}: {{ totalGroupOrders }}
          </p>
        </div>

        <!-- 功能按鈕 -->
        <button
          class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm whitespace-nowrap"
          data-testid="open-create-group-order"
          @click="createGroupOrder"
        >
          {{ t("groupOrders.createOrder") }}
        </button>

        <button
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm whitespace-nowrap"
          @click="generateShareCode"
        >
          {{ t("groupOrders.generateShareCode") }}
        </button>
      </div>
    </div>

    <!-- 統計卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
      <div class="bg-white rounded-lg shadow p-3 sm:p-6">
        <div class="flex items-center gap-3">
          <div class="p-2 sm:p-3 rounded-full bg-green-100 flex-shrink-0">
            <UserGroupIcon class="h-5 w-5 sm:h-6 sm:w-6 text-green-600" />
          </div>
          <div class="min-w-0">
            <p class="text-xs sm:text-sm font-medium text-gray-500 truncate">
              {{ t("groupOrders.activeOrders") }}
            </p>
            <p class="text-xl sm:text-2xl font-semibold text-gray-900">
              {{ activeGroupOrders }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-3 sm:p-6">
        <div class="flex items-center gap-3">
          <div class="p-2 sm:p-3 rounded-full bg-blue-100 flex-shrink-0">
            <CurrencyDollarIcon class="h-5 w-5 sm:h-6 sm:w-6 text-blue-600" />
          </div>
          <div class="min-w-0">
            <p class="text-xs sm:text-sm font-medium text-gray-500 truncate">
              {{ t("groupOrders.avgOrderValue") }}
            </p>
            <p class="text-xl sm:text-2xl font-semibold text-gray-900">
              {{ formatPrice(averageOrderValue) }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-3 sm:p-6">
        <div class="flex items-center gap-3">
          <div class="p-2 sm:p-3 rounded-full bg-yellow-100 flex-shrink-0">
            <UsersIcon class="h-5 w-5 sm:h-6 sm:w-6 text-yellow-600" />
          </div>
          <div class="min-w-0">
            <p class="text-xs sm:text-sm font-medium text-gray-500 truncate">
              {{ t("groupOrders.avgMembers") }}
            </p>
            <p class="text-xl sm:text-2xl font-semibold text-gray-900">
              {{ avgGroupSize.toFixed(1) }} {{ t("groupOrders.people") }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 主要內容區域 -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-8">
      <!-- 左側：整體團體訂單列表 -->
      <div class="xl:col-span-2">
        <div class="bg-white rounded-lg shadow">
          <div class="p-4 sm:p-6 border-b border-gray-200">
            <div
              class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <h2 class="text-lg sm:text-xl font-semibold text-gray-900">
                {{ t("groupOrders.orderList") }}
              </h2>
              <div class="flex flex-wrap items-center gap-2 sm:gap-4">
                <!-- 搜尋篩選 -->
                <div class="relative flex-1 min-w-[160px]">
                  <MagnifyingGlassIcon
                    class="absolute left-3 top-3 h-4 w-4 text-gray-400"
                  />
                  <input
                    v-model="searchQuery"
                    type="text"
                    :placeholder="t('groupOrders.searchPlaceholder')"
                    class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  />
                </div>

                <select
                  v-model="statusFilter"
                  class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">{{ t("groupOrders.allStatus") }}</option>
                  <option value="active">
                    {{ t("groupOrders.status.active") }}
                  </option>
                  <option value="finalizing">
                    {{ t("groupOrders.status.finalizing") }}
                  </option>
                  <option value="finalizing_failed">
                    {{ t("groupOrders.status.finalizingFailed") }}
                  </option>
                  <option value="checkout">
                    {{ t("groupOrders.status.checkout") }}
                  </option>
                  <option value="completed">
                    {{ t("groupOrders.status.completed") }}
                  </option>
                  <option value="cancelled">
                    {{ t("groupOrders.status.cancelled") }}
                  </option>
                </select>

                <button
                  class="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors flex-shrink-0"
                  @click="refreshGroupOrders()"
                >
                  <ArrowPathIcon class="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div class="divide-y divide-gray-200">
            <div
              v-for="groupOrder in filteredGroupOrders"
              :key="groupOrder.id"
              class="p-4 sm:p-6 hover:bg-gray-50 cursor-pointer transition-colors"
              @click="selectGroupOrder(groupOrder)"
            >
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <!-- 訂單基本信息 -->
                  <div class="flex items-center mb-3">
                    <div class="flex-shrink-0">
                      <div
                        class="w-12 h-12 bg-gradient-to-r from-blue-500 to-teal-600 rounded-lg flex items-center justify-center"
                      >
                        <UserGroupIcon class="w-6 h-6 text-white" />
                      </div>
                    </div>
                    <div class="ml-4">
                      <div class="flex items-center">
                        <h3 class="text-lg font-medium text-gray-900">
                          {{ groupOrder.shareCode }}
                        </h3>
                        <span
                          :class="getStatusClass(groupOrder.status)"
                          class="ml-2 px-2 py-1 text-xs font-medium rounded-full"
                        >
                          {{ getStatusText(groupOrder.status) }}
                        </span>
                      </div>
                      <div class="flex items-center mt-1 text-sm text-gray-500">
                        <MapPinIcon class="w-4 h-4 mr-1" />
                        <span>{{
                          groupOrder.tableNumber
                            ? t("groupOrders.tableNumber", {
                                number: groupOrder.tableNumber,
                              })
                            : t("groupOrders.takeaway")
                        }}</span>
                        <span class="mx-2">·</span>
                        <ClockIcon class="w-4 h-4 mr-1" />
                        <span>{{ formatDateTime(groupOrder.createdAt) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- 成員與金額信息 -->
                  <div class="grid grid-cols-2 gap-4 mb-4">
                    <div class="bg-blue-50 p-3 rounded-lg">
                      <p class="text-sm text-blue-800 font-medium">
                        {{ t("groupOrders.members") }}
                      </p>
                      <div class="flex items-center mt-1">
                        <span class="text-2xl font-bold text-blue-900">{{
                          groupOrder.memberCount
                        }}</span>
                        <span class="text-sm text-blue-600 ml-2">{{
                          t("groupOrders.people")
                        }}</span>
                      </div>
                      <div class="text-xs text-blue-600 mt-1">
                        {{ t("groupOrders.host") }}: {{ groupOrder.hostName }}
                      </div>
                    </div>

                    <div class="bg-green-50 p-3 rounded-lg">
                      <p class="text-sm text-green-800 font-medium">
                        {{ t("groupOrders.orderTotal") }}
                      </p>
                      <div class="flex items-center mt-1">
                        <span class="text-2xl font-bold text-green-900">{{
                          formatPrice(groupOrder.totalAmount)
                        }}</span>
                      </div>
                      <div class="text-xs text-green-600 mt-1">
                        {{ groupOrder.itemCount }} {{ t("groupOrders.items") }}
                      </div>
                    </div>
                  </div>

                  <!-- 付款狀態 -->
                  <div class="flex items-center justify-between">
                    <div class="flex items-center">
                      <!-- 成員頭像 -->
                      <div class="flex -space-x-2">
                        <div
                          v-for="(member, index) in groupOrder.members.slice(
                            0,
                            4,
                          )"
                          :key="member.id"
                          :class="[
                            'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 border-white',
                            getMemberColor(index),
                          ]"
                          :title="member.name || ''"
                        >
                          {{ (member.name || "?").charAt(0) }}
                        </div>
                        <div
                          v-if="groupOrder.members.length > 4"
                          class="w-8 h-8 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center text-xs font-medium text-gray-600"
                        >
                          +{{ groupOrder.members.length - 4 }}
                        </div>
                      </div>
                    </div>

                    <!-- 付款信息 -->
                    <div class="text-right">
                      <div class="flex items-center text-sm">
                        <span class="text-gray-500">{{
                          t("groupOrders.paid")
                        }}</span>
                        <span class="ml-1 font-medium"
                          >{{ groupOrder.paidMembers }}/{{
                            groupOrder.memberCount
                          }}</span
                        >
                      </div>
                      <div class="w-32 bg-gray-200 rounded-full h-2 mt-1">
                        <div
                          class="bg-green-600 h-2 rounded-full transition-all duration-300"
                          :style="{
                            width: `${(groupOrder.paidMembers / groupOrder.memberCount) * 100}%`,
                          }"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 操作按鈕 -->
                <div class="flex flex-col space-y-2 ml-6">
                  <button
                    v-if="groupOrder.status === 'active'"
                    class="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
                    @click.stop="shareGroupOrder(groupOrder)"
                  >
                    {{ t("groupOrders.share") }}
                  </button>

                  <button
                    :data-testid="`group-order-details-${groupOrder.id}`"
                    class="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors"
                    @click.stop="selectGroupOrder(groupOrder)"
                  >
                    {{ t("groupOrders.details") }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 空狀態 -->
            <div
              v-if="filteredGroupOrders.length === 0"
              class="p-12 text-center"
            >
              <UserGroupIcon class="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 class="text-lg font-medium text-gray-900 mb-2">
                {{ t("groupOrders.noOrders") }}
              </h3>
              <p class="text-gray-500">{{ t("groupOrders.noOrdersHint") }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側：詳細信息面板 -->
      <div class="space-y-6">
        <!-- 選中訂單詳情 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{
                selectedGroupOrder
                  ? t("groupOrders.orderDetails")
                  : t("groupOrders.selectOrder")
              }}
            </h3>

            <div v-if="selectedGroupOrder">
              <!-- 基本信息 -->
              <div class="mb-6">
                <div class="flex items-center justify-between mb-4">
                  <h4 class="font-medium text-gray-900">
                    {{ selectedGroupOrder.shareCode }}
                  </h4>
                  <div class="flex items-center space-x-2">
                    <button
                      class="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                      :title="t('groupOrders.copyShareCode')"
                      @click="copyShareCode(selectedGroupOrder.shareCode)"
                    >
                      <DocumentDuplicateIcon class="w-4 h-4" />
                    </button>
                    <button
                      class="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                      :title="t('groupOrders.share')"
                      @click="shareGroupOrder(selectedGroupOrder!)"
                    >
                      {{ t("groupOrders.share") }}
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3 text-sm">
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.statusLabel") }}:</span
                    >
                    <span
                      :class="getStatusClass(selectedGroupOrder.status)"
                      class="px-2 py-1 text-xs font-medium rounded-full"
                    >
                      {{ getStatusText(selectedGroupOrder.status) }}
                    </span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.tableLabel") }}:</span
                    >
                    <span>{{
                      selectedGroupOrder.tableNumber ||
                      t("groupOrders.takeaway")
                    }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.createdTime") }}:</span
                    >
                    <span>{{
                      formatClockTime(selectedGroupOrder.createdAt)
                    }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.hostLabel") }}:</span
                    >
                    <span>{{ selectedGroupOrder.hostName }}</span>
                  </div>
                </div>
              </div>

              <button
                v-if="selectedGroupOrder.status === 'active'"
                :data-testid="`staff-finalize-${selectedGroupOrder.id}`"
                :disabled="isFinalizingAsStaff"
                class="mb-6 w-full rounded-lg bg-green-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
                @click="finalizeAsStaff(selectedGroupOrder.id)"
              >
                {{
                  isFinalizingAsStaff
                    ? t("groupOrders.alerts.finalizing")
                    : t("groupOrders.alerts.finalize")
                }}
              </button>

              <!-- 最終結帳失敗診斷與復原 -->
              <div
                v-if="selectedGroupOrder.finalizeFailure"
                class="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm"
              >
                <h5 class="mb-2 font-medium text-red-900">
                  {{ t("groupOrders.finalizeFailure.title") }}
                </h5>
                <dl class="space-y-1 text-red-800">
                  <div class="flex justify-between gap-4">
                    <dt>{{ t("groupOrders.finalizeFailure.code") }}</dt>
                    <dd class="font-mono">
                      {{ selectedGroupOrder.finalizeFailure.code }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt>{{ t("groupOrders.finalizeFailure.failedAt") }}</dt>
                    <dd>
                      {{
                        formatDateTime(
                          selectedGroupOrder.finalizeFailure.failedAt,
                        )
                      }}
                    </dd>
                  </div>
                  <div>
                    <dt>{{ t("groupOrders.finalizeFailure.error") }}</dt>
                    <dd>{{ selectedGroupOrder.finalizeFailure.splitError }}</dd>
                  </div>
                  <div
                    v-if="
                      selectedGroupOrder.finalizeFailure.expectedTotalCents !==
                        undefined &&
                      selectedGroupOrder.finalizeFailure.roundedTotalCents !==
                        undefined
                    "
                    class="flex justify-between gap-4"
                  >
                    <dt>
                      {{ t("groupOrders.finalizeFailure.totalMismatch") }}
                    </dt>
                    <dd>
                      {{
                        formatCents(
                          selectedGroupOrder.finalizeFailure.expectedTotalCents,
                        )
                      }}
                      /
                      {{
                        formatCents(
                          selectedGroupOrder.finalizeFailure.roundedTotalCents,
                        )
                      }}
                    </dd>
                  </div>
                </dl>
                <div
                  v-if="
                    selectedGroupOrder.finalizeFailure.recoveryErrorDetails
                      ?.length
                  "
                  class="mt-3 border-t border-red-200 pt-3"
                >
                  <h6 class="font-medium text-red-900">
                    {{ t("groupOrders.finalizeFailure.recoveryHistory") }}
                  </h6>
                  <p class="mt-1 text-red-800">
                    {{ t("groupOrders.finalizeFailure.recoveryAttempts") }}:
                    {{
                      selectedGroupOrder.finalizeFailure.recoveryErrorDetails
                        .length
                    }}
                  </p>
                  <ul class="mt-2 space-y-1 text-red-800">
                    <li
                      v-for="recoveryError in selectedGroupOrder.finalizeFailure
                        .recoveryErrorDetails"
                      :key="`${recoveryError.code}-${recoveryError.attemptedAt}`"
                    >
                      <span class="font-mono">{{ recoveryError.code }}</span>
                      ·
                      {{
                        t("groupOrders.finalizeFailure.recoveryAttemptedAt")
                      }}:
                      {{ formatDateTime(recoveryError.attemptedAt) }}
                    </li>
                  </ul>
                </div>
                <p
                  v-if="finalizationRecoveryError"
                  data-testid="finalization-recovery-error"
                  role="alert"
                  class="mt-3 rounded-lg border border-red-300 bg-white p-3 text-red-900"
                >
                  {{ t("groupOrders.finalizeFailure.recoveryFailed") }}:
                  {{ finalizationRecoveryError }}
                </p>
                <label
                  v-if="selectedGroupOrder.status === 'finalizing_failed'"
                  :for="`finalization-bearer-${selectedGroupOrder.id}`"
                  class="mt-3 block text-sm font-medium text-red-900"
                >
                  {{ t("groupOrders.finalizeFailure.bearerMember") }}
                </label>
                <select
                  v-if="selectedGroupOrder.status === 'finalizing_failed'"
                  :id="`finalization-bearer-${selectedGroupOrder.id}`"
                  v-model="finalizationBearerMemberId"
                  :disabled="isRecoveringFinalization"
                  class="mt-1 block w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                  :data-testid="`finalization-bearer-${selectedGroupOrder.id}`"
                >
                  <option value="">
                    {{
                      t("groupOrders.finalizeFailure.bearerMemberPlaceholder")
                    }}
                  </option>
                  <option
                    v-for="member in selectedGroupOrder.members"
                    :key="member.id"
                    :value="member.id"
                  >
                    {{ member.name || member.memberName || member.id }}
                  </option>
                </select>
                <button
                  v-if="selectedGroupOrder.status === 'finalizing_failed'"
                  :data-testid="`recover-finalization-${selectedGroupOrder.id}`"
                  :disabled="isRecoveringFinalization"
                  class="mt-4 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                  @click="
                    recoverFinalization(
                      selectedGroupOrder.id,
                      finalizationBearerMemberId || undefined,
                    )
                  "
                >
                  {{
                    isRecoveringFinalization
                      ? t("groupOrders.finalizeFailure.recovering")
                      : t("groupOrders.finalizeFailure.recover")
                  }}
                </button>
              </div>

              <!-- 成員列表 -->
              <div class="mb-6">
                <h5 class="font-medium text-gray-900 mb-3">
                  {{ t("groupOrders.members") }} ({{
                    selectedGroupOrder.members.length
                  }})
                </h5>
                <div class="space-y-2">
                  <div
                    v-for="(member, index) in selectedGroupOrder.members"
                    :key="member.id"
                    class="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div class="flex items-center">
                      <div
                        :class="[
                          'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                          getMemberColor(index),
                        ]"
                      >
                        {{ (member.name || "?").charAt(0) }}
                      </div>
                      <div class="ml-3">
                        <p class="text-sm font-medium text-gray-900">
                          {{ member.name || "" }}
                        </p>
                        <p class="text-xs text-gray-500">
                          {{ member.itemCount }}
                          {{ t("groupOrders.items") }}・{{
                            formatPrice(member.totalAmount)
                          }}
                        </p>
                      </div>
                    </div>

                    <div class="flex items-center">
                      <span
                        :class="[
                          'px-2 py-1 text-xs font-medium rounded-full',
                          member.revenueRecognised
                            ? 'bg-green-100 text-green-800'
                            : member.paymentStatus === 'paid'
                              ? 'bg-gray-100 text-gray-700'
                              : member.paymentStatus === 'pending'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-red-100 text-red-800',
                        ]"
                      >
                        {{ getMemberPaymentStatusText(member) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 訂單金額 -->
              <div class="border-t border-gray-200 pt-4">
                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.subtotal") }}:</span
                    >
                    <span>{{ formatPrice(selectedGroupOrder.subtotal) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.serviceCharge") }}:</span
                    >
                    <span>{{
                      formatPrice(selectedGroupOrder.serviceCharge)
                    }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("groupOrders.tax") }}:</span
                    >
                    <span>{{ formatPrice(selectedGroupOrder.taxAmount) }}</span>
                  </div>
                  <div
                    class="flex justify-between font-bold text-lg pt-2 border-t border-gray-200"
                  >
                    <span>{{ t("groupOrders.total") }}:</span>
                    <span class="text-green-600">{{
                      formatPrice(selectedGroupOrder.totalAmount)
                    }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-8">
              <CursorArrowRaysIcon
                class="mx-auto h-12 w-12 text-gray-400 mb-2"
              />
              <p class="text-gray-500">
                {{ t("groupOrders.selectOrderHint") }}
              </p>
            </div>
          </div>
        </div>

        <!-- 快速操作 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("groupOrders.quickActions") }}
            </h3>

            <div class="space-y-3">
              <button
                class="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
                @click="createGroupOrder"
              >
                {{ t("groupOrders.createOrder") }}
              </button>

              <button
                class="w-full py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                @click="generateShareCode"
              >
                {{ t("groupOrders.generateShareCode") }}
              </button>

              <button
                class="w-full py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                @click="exportGroupOrderReport"
              >
                {{ t("groupOrders.exportReport") }}
              </button>
            </div>
          </div>
        </div>

        <!-- 統計圖表 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("groupOrders.usageStats") }}
            </h3>

            <div class="space-y-4">
              <!-- 訂單總數 -->
              <div>
                <div class="flex justify-between text-sm mb-2">
                  <span class="text-gray-600">{{
                    t("groupOrders.totalOrders")
                  }}</span>
                  <span class="font-medium">{{ totalGroupOrders }}</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div
                    class="bg-blue-600 h-2 rounded-full"
                    :style="{
                      width: `${Math.min(totalGroupOrders * 5, 100)}%`,
                    }"
                  />
                </div>
              </div>

              <!-- 平均成員數 -->
              <div>
                <div class="flex justify-between text-sm mb-2">
                  <span class="text-gray-600">{{
                    t("groupOrders.avgMembers")
                  }}</span>
                  <span class="font-medium"
                    >{{ avgGroupSize.toFixed(1) }}
                    {{ t("groupOrders.people") }}</span
                  >
                </div>
                <div class="w-full bg-gray-200 rounded-full h-2">
                  <div
                    class="bg-green-600 h-2 rounded-full"
                    :style="{ width: `${Math.min(avgGroupSize * 10, 100)}%` }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 建立訂單模態框 -->
    <div v-if="showCreateDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeCreateDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("groupOrders.createOrder") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeCreateDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("groupOrders.tableNumberLabel")
              }}</label>
              <input
                v-model="newGroupOrder.tableNumber"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('groupOrders.tableNumberPlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("groupOrders.hostNameLabel")
              }}</label>
              <input
                v-model="newGroupOrder.hostName"
                type="text"
                data-testid="create-host-name"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('groupOrders.hostNamePlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("groupOrders.expectedMembers")
              }}</label>
              <input
                v-model.number="newGroupOrder.expectedMembers"
                type="number"
                min="2"
                max="20"
                data-testid="create-expected-members"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('groupOrders.expectedMembersPlaceholder')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("groupOrders.notesLabel")
              }}</label>
              <textarea
                v-model="newGroupOrder.notes"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('groupOrders.notesPlaceholder')"
              />
            </div>
          </div>

          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closeCreateDialog"
            >
              {{ t("groupOrders.cancel") }}
            </button>
            <button
              :disabled="!canCreateGroupOrder"
              class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="submit-create-group-order"
              @click="submitCreateGroupOrder"
            >
              {{ t("groupOrders.createOrderBtn") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 分享模態框 -->
    <div v-if="showShareDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeShareDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("groupOrders.shareOrder") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeShareDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="text-center space-y-6">
            <!-- 分享資訊 -->
            <div>
              <p class="text-sm text-gray-600 mb-2">
                {{ t("groupOrders.shareCode") }}
              </p>
              <div class="flex items-center space-x-2">
                <input
                  :value="shareData.shareCode"
                  readonly
                  class="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50"
                />
                <button
                  class="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  @click="copyShareCode(shareData.shareCode)"
                >
                  {{ t("groupOrders.copy") }}
                </button>
              </div>
            </div>

            <!-- 團主接手碼：僅建立當下回傳一次 -->
            <div v-if="shareData.recoveryCode">
              <p class="text-sm text-gray-600 mb-1">
                {{ t("groupOrders.hostRecoveryCode") }}
              </p>
              <p class="text-xs text-gray-500 mb-2">
                {{ t("groupOrders.hostRecoveryHint") }}
              </p>
              <div class="flex items-center space-x-2">
                <input
                  :value="shareData.recoveryCode"
                  readonly
                  data-testid="host-recovery-code"
                  class="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs"
                />
                <button
                  class="px-3 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-800 transition-colors"
                  @click="copyRecoveryCode"
                >
                  {{ t("groupOrders.copy") }}
                </button>
              </div>
            </div>

            <!-- 分享連結 -->
            <div>
              <p class="text-sm text-gray-600 mb-2">
                {{ t("groupOrders.shareLink") }}
              </p>
              <div class="flex items-center space-x-2">
                <input
                  :value="shareData.shareUrl"
                  readonly
                  class="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-xs"
                />
                <button
                  class="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  @click="copyShareUrl"
                >
                  {{ t("groupOrders.copy") }}
                </button>
              </div>
            </div>

            <!-- 分享按鈕 -->
            <div class="grid grid-cols-2 gap-3">
              <button
                class="py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                @click="shareToWhatsApp"
              >
                WhatsApp
              </button>
              <button
                class="py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                @click="shareToWechat"
              >
                {{ t("groupOrders.wechat") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  UserGroupIcon,
  UsersIcon,
  ClockIcon,
  CurrencyDollarIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  MapPinIcon,
  DocumentDuplicateIcon,
  CursorArrowRaysIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { useAuthStore } from "@/stores/auth";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  groupOrdersService,
  type GroupOrder as ApiGroupOrder,
  type GroupOrderMember as ApiGroupOrderMember,
} from "@/services/groupOrdersService";

const { t } = useI18n();
const { formatPrice } = useCurrency();
const { formatDateTime, formatTime } = useDateFormatter();
const authStore = useAuthStore();
const toast = useToast();

// 類別定義
type ApiGroupOrderMemberPayload = Omit<ApiGroupOrderMember, "name"> & {
  name?: string;
  memberName?: string;
};

type GroupOrderMember = ApiGroupOrderMember & {
  memberName?: string;
};

type ApiGroupOrderPayload = Omit<ApiGroupOrder, "members"> & {
  members?: ApiGroupOrderMemberPayload[];
  paidMembers?: number;
};

type GroupOrder = Omit<ApiGroupOrder, "members"> & {
  paidMembers: number;
  members: GroupOrderMember[];
};

// 響應式狀態
const searchQuery = ref("");
const statusFilter = ref("");
const selectedGroupOrder = ref<GroupOrder | null>(null);
const showCreateDialog = ref(false);
const showShareDialog = ref(false);
const isRecoveringFinalization = ref(false);
const isFinalizingAsStaff = ref(false);
const finalizationRecoveryError = ref<string | null>(null);
const finalizationBearerMemberId = ref("");

// 統計數據 - populated from API
const activeGroupOrders = ref(0);
const totalGroupOrders = ref(0);
const averageOrderValue = ref(0);
const avgGroupSize = ref(0);

// 表單數據
const newGroupOrder = ref({
  tableNumber: "",
  hostName: "",
  expectedMembers: 2,
  notes: "",
});

const shareData = ref({
  shareCode: "",
  shareUrl: "",
  // Only set right after a create -- the server returns the recovery code once
  // and never again, so an existing group cannot reproduce it.
  recoveryCode: "",
});

// 團體訂單數據 - fetched from API
const groupOrders = ref<GroupOrder[]>([]);

// 計算屬性
const filteredGroupOrders = computed(() => {
  let filtered = [...groupOrders.value];

  // 狀態篩選
  if (statusFilter.value) {
    filtered = filtered.filter((order) => order.status === statusFilter.value);
  }

  // 搜尋篩選
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (order) =>
        order.shareCode.toLowerCase().includes(query) ||
        order.tableNumber?.toLowerCase().includes(query) ||
        order.hostName.toLowerCase().includes(query),
    );
  }

  return filtered;
});

const canCreateGroupOrder = computed(() => {
  return (
    newGroupOrder.value.hostName && newGroupOrder.value.expectedMembers >= 2
  );
});

// 工具函數
// formatTime expects an HH:mm value, so ISO datetimes must first become Date.
const formatClockTime = (dateTime: string) => formatTime(new Date(dateTime));
const formatCents = (amountCents: number) => formatPrice(amountCents / 100);

const getStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    active: "bg-blue-100 text-blue-800",
    finalizing: "bg-yellow-100 text-yellow-800",
    finalizing_failed: "bg-red-100 text-red-800",
    checkout: "bg-green-100 text-green-800",
    completed: "bg-gray-100 text-gray-800",
    cancelled: "bg-gray-100 text-gray-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
};

const getStatusText = (status: string) => {
  const texts: Record<string, string> = {
    active: t("groupOrders.status.active"),
    finalizing: t("groupOrders.status.finalizing"),
    finalizing_failed: t("groupOrders.status.finalizingFailed"),
    checkout: t("groupOrders.status.checkout"),
    completed: t("groupOrders.status.completed"),
    cancelled: t("groupOrders.status.cancelled"),
  };
  return texts[status] || status;
};

const getPaymentStatusText = (status: string) => {
  const texts: Record<string, string> = {
    unpaid: t("groupOrders.paymentStatus.unpaid"),
    pending: t("groupOrders.paymentStatus.pending"),
    paid: t("groupOrders.paymentStatus.paid"),
  };
  return texts[status] || status;
};

const getMemberPaymentStatusText = (member: GroupOrderMember) => {
  if (member.paymentStatus === "paid" && !member.revenueRecognised) {
    return t("groupOrders.paymentStatus.selfSettled");
  }
  return getPaymentStatusText(member.paymentStatus);
};

const getMemberColor = (index: number) => {
  const colors = [
    "bg-blue-500 text-white",
    "bg-green-500 text-white",
    "bg-teal-500 text-white",
    "bg-orange-500 text-white",
    "bg-teal-500 text-white",
    "bg-teal-500 text-white",
  ];
  return colors[index % colors.length];
};

const normalizeGroupOrderMember = (
  member: ApiGroupOrderMemberPayload,
): GroupOrderMember => ({
  ...member,
  name: member.name || member.memberName || "",
});

const countPaidMembers = (members: GroupOrderMember[]) =>
  members.filter((member) => member.revenueRecognised === true).length;

const normalizeGroupOrder = (order: ApiGroupOrderPayload): GroupOrder => {
  const members = (order.members ?? []).map(normalizeGroupOrderMember);

  return {
    ...order,
    members,
    paidMembers: order.paidMembers ?? countPaidMembers(members),
  };
};

// 操作函數
const selectGroupOrder = (groupOrder: GroupOrder) => {
  selectedGroupOrder.value = groupOrder;
  finalizationRecoveryError.value = null;
  finalizationBearerMemberId.value = "";
};

const refreshGroupOrders = async ({ silent = false } = {}) => {
  try {
    const restaurantId = authStore.restaurantId ?? undefined;
    const [ordersData, statsData] = await Promise.all([
      groupOrdersService.getGroupOrders({ restaurantId }),
      groupOrdersService.getGroupOrderStats({ restaurantId }),
    ]);

    groupOrders.value = ordersData.map(normalizeGroupOrder);

    activeGroupOrders.value = statsData.activeGroupOrders ?? 0;
    totalGroupOrders.value = statsData.totalGroupOrders ?? 0;
    averageOrderValue.value = statsData.averageOrderValue ?? 0;
    avgGroupSize.value = statsData.averageGroupSize ?? 0;

    // Update selected order with fresh data
    if (selectedGroupOrder.value) {
      const updated = groupOrders.value.find(
        (o) => o.id === selectedGroupOrder.value!.id,
      );
      if (updated) {
        selectedGroupOrder.value = updated;
      }
    }
  } catch (err) {
    if (!silent) {
      toast.error(
        resolveUserFacingError(err, t, {
          fallbackKey: "groupOrders.alerts.loadFailed",
        }).message,
      );
    }
  }
};

const recoverFinalization = async (
  groupOrderId: string,
  bearerMemberId?: string,
) => {
  if (isRecoveringFinalization.value) return;

  isRecoveringFinalization.value = true;
  finalizationRecoveryError.value = null;

  try {
    if (bearerMemberId) {
      await groupOrdersService.recoverFinalization(groupOrderId, {
        bearerMemberId,
      });
    } else {
      await groupOrdersService.recoverFinalization(groupOrderId);
    }
    await refreshGroupOrders();
  } catch (error) {
    finalizationRecoveryError.value = resolveUserFacingError(error, t, {
      codeKeys: {
        GROUP_ORDER_FINALIZATION_RECOVERY_IN_PROGRESS:
          "groupOrders.finalizeFailure.recoveryInProgress",
        GROUP_ORDER_FINALIZATION_RECOVERY_RECLAIMED:
          "groupOrders.finalizeFailure.recoveryReclaimed",
        BAD_REQUEST: "groupOrders.finalizeFailure.recoveryRetryFailed",
      },
      fallbackKey: "groupOrders.finalizeFailure.recoveryRetryFailed",
    }).message;
    await refreshGroupOrders();
  } finally {
    isRecoveringFinalization.value = false;
  }
};

const finalizeAsStaff = async (groupOrderId: string) => {
  if (isFinalizingAsStaff.value) return;
  if (!window.confirm(t("groupOrders.alerts.finalizeConfirm"))) return;

  isFinalizingAsStaff.value = true;
  try {
    await groupOrdersService.finalizeAsStaff(groupOrderId);
    toast.success(t("groupOrders.alerts.finalized"));
    await refreshGroupOrders({ silent: true });
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.finalizeFailed",
      }).message,
    );
  } finally {
    isFinalizingAsStaff.value = false;
  }
};

const createGroupOrder = () => {
  showCreateDialog.value = true;
  newGroupOrder.value = {
    tableNumber: "",
    hostName: "",
    expectedMembers: 2,
    notes: "",
  };
};

const closeCreateDialog = () => {
  showCreateDialog.value = false;
};

const submitCreateGroupOrder = async () => {
  if (!canCreateGroupOrder.value) return;

  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;

    const created = await groupOrdersService.createGroupOrder({
      tableNumber: newGroupOrder.value.tableNumber || undefined,
      hostName: newGroupOrder.value.hostName,
      expectedMembers: newGroupOrder.value.expectedMembers,
      restaurantId,
      notes: newGroupOrder.value.notes || undefined,
    });

    closeCreateDialog();

    // Refresh list from API
    await refreshGroupOrders({ silent: true });

    // The response keys the group as `groupOrderId`; matching on `created.id`
    // compared against undefined and never found the row.
    const newGroup = groupOrders.value.find(
      (o) => o.id === created.groupOrderId,
    );
    if (newGroup) {
      // Pass the recovery code straight into the share dialog. It is shown once
      // so staff can hand host control to a diner, who can then submit the
      // group or decide what happens when it expires.
      shareGroupOrder(newGroup, created.recoveryCode);
    }

    toast.success(
      t("groupOrders.alerts.orderCreated", { shareCode: created.shareCode }),
    );
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.createFailed",
      }).message,
    );
  }
};

/**
 * The share link is handed to diners, so it has to point at the customer app,
 * not at wherever the owner happens to be standing. `window.location.origin`
 * here is the admin dashboard (https://admin.makanmasak.com), which has no
 * group route at all -- and the path was wrong too: the customer app joins a
 * group at `/group/:shareCode` (apps/customer-app/src/router/index.ts), not
 * `/order/group/:shareCode`. Both halves had to change for the link to resolve.
 */
const buildShareUrl = (shareCode: string) => {
  const customerAppUrl =
    import.meta.env.VITE_CUSTOMER_APP_URL || "http://localhost:3000";
  return `${customerAppUrl.replace(/\/+$/, "")}/group/${shareCode}`;
};

const shareGroupOrder = (groupOrder: GroupOrder, recoveryCode = "") => {
  shareData.value = {
    shareCode: groupOrder.shareCode,
    shareUrl: buildShareUrl(groupOrder.shareCode),
    recoveryCode,
  };
  showShareDialog.value = true;
};

const closeShareDialog = () => {
  showShareDialog.value = false;
};

const copyShareCode = async (shareCode: string) => {
  try {
    await navigator.clipboard.writeText(shareCode);
    toast.success(t("groupOrders.alerts.shareCodeCopied"));
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.copyFailed",
      }).message,
    );
  }
};

const copyRecoveryCode = async () => {
  try {
    await navigator.clipboard.writeText(shareData.value.recoveryCode);
    toast.success(t("groupOrders.alerts.recoveryCodeCopied"));
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.copyFailed",
      }).message,
    );
  }
};

const copyShareUrl = async () => {
  try {
    await navigator.clipboard.writeText(shareData.value.shareUrl);
    toast.success(t("groupOrders.alerts.shareLinkCopied"));
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.copyFailed",
      }).message,
    );
  }
};

const shareToWhatsApp = () => {
  const text = t("groupOrders.whatsappMessage", {
    shareCode: shareData.value.shareCode,
    shareUrl: shareData.value.shareUrl,
  });
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`);
  toast.success(t("groupOrders.alerts.shareLinkCopied"));
};

const shareToWechat = async () => {
  const text = t("groupOrders.whatsappMessage", {
    shareCode: shareData.value.shareCode,
    shareUrl: shareData.value.shareUrl,
  });
  try {
    if (navigator.share) {
      await navigator.share({ text, url: shareData.value.shareUrl });
      return;
    }
    await navigator.clipboard.writeText(shareData.value.shareUrl);
    toast.success(t("groupOrders.alerts.shareLinkCopied"));
  } catch (error) {
    if ((error as DOMException).name !== "AbortError") {
      toast.error(t("groupOrders.alerts.shareFailed"));
    }
  }
};

const generateShareCode = async () => {
  const restaurantId = authStore.restaurantId;
  if (!restaurantId) return;

  try {
    const result = await groupOrdersService.generateShareCode(restaurantId);
    shareData.value = {
      shareCode: result.shareCode,
      shareUrl: buildShareUrl(result.shareCode),
      recoveryCode: result.recoveryCode ?? "",
    };
    showShareDialog.value = true;
    // Refresh list since generate-code creates a new group order
    await refreshGroupOrders({ silent: true });
    toast.success(
      t("groupOrders.alerts.shareCodeGenerated", {
        shareCode: result.shareCode,
      }),
    );
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.createFailed",
      }).message,
    );
  }
};

const exportGroupOrderReport = async () => {
  const restaurantId = authStore.restaurantId ?? undefined;
  try {
    const data = await groupOrdersService.exportGroupOrders({
      restaurantId,
      format: "csv",
    });
    // The API returns CSV text, not a Blob — convert it
    const blob =
      data instanceof Blob
        ? data
        : new Blob([typeof data === "string" ? data : JSON.stringify(data)], {
            type: "text/csv;charset=utf-8;",
          });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `group-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("groupOrders.exportReport"));
  } catch (error) {
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "groupOrders.alerts.exportFailed",
      }).message,
    );
  }
};

// 生命週期
onMounted(async () => {
  await refreshGroupOrders();

  // 預選第一個團體訂單
  if (groupOrders.value.length > 0) {
    selectedGroupOrder.value = groupOrders.value[0];
  }
});
</script>

<style scoped>
.group-orders-view {
  padding: 1.5rem;
  min-height: 100vh;
  background-color: #f9fafb;
}

@media (max-width: 640px) {
  .group-orders-view {
    padding: 1rem;
  }
}
</style>
