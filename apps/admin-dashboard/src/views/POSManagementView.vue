<template>
  <div class="pos-management">
    <!-- 收銀櫃管理操作列 -->
    <div
      class="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
    >
      <div class="flex flex-wrap items-center gap-3">
        <!-- 收銀櫃狀態 -->
        <div class="bg-green-50 px-4 py-2 rounded-2xl">
          <p class="text-sm text-green-800 font-medium">
            {{ t("pos.register") }}:
            {{ currentRegister?.name || t("pos.notSelected") }}
          </p>
          <p class="text-xs text-green-600">
            {{ t("pos.balance") }}:
            {{ formatDrawerBalance(currentRegister) }}
          </p>
        </div>

        <!-- 班次資訊 -->
        <div class="bg-blue-50 px-4 py-2 rounded-2xl">
          <p class="text-sm text-blue-800 font-medium">
            {{ t("pos.shift") }}:
            {{ currentShift?.name || t("pos.notStarted") }}
          </p>
          <p class="text-xs text-blue-600">
            {{
              currentShift
                ? `${formatClockTime(currentShift.startTime)} - ${formatClockTime(currentShift.endTime || "")}`
                : t("pos.pleaseStartShift")
            }}
          </p>
        </div>
      </div>

      <!-- 功能按鈕 -->
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="!currentShift"
          class="px-4 py-2 bg-ios-green text-white rounded-full hover:bg-green-600 transition-colors text-sm"
          @click="startShift"
        >
          {{ t("pos.startShift") }}
        </button>
        <button
          v-else
          data-testid="pos-open-end-shift"
          class="px-4 py-2 bg-ios-red text-white rounded-full hover:bg-red-600 transition-colors text-sm"
          @click="endShift"
        >
          {{ t("pos.endShift") }}
        </button>

        <button
          class="px-3 py-2 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors text-sm"
          @click="openRegisterManagement"
        >
          {{ t("pos.registerManagement") }}
        </button>

        <button
          class="px-3 py-2 bg-ios-orange text-white rounded-full hover:bg-orange-600 transition-colors text-sm"
          @click="openPromotionsDialog"
        >
          {{ t("pos.promotionManagement") }}
        </button>
      </div>
    </div>

    <!-- 統計卡片 -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-blue-100">
            <BanknotesIcon class="h-6 w-6 text-blue-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("pos.todayRevenue") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ formatPrice(todayStats.revenue) }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-green-100">
            <ShoppingCartIcon class="h-6 w-6 text-green-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("pos.orderCount") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ todayStats.orders }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-teal-100">
            <UserGroupIcon class="h-6 w-6 text-teal-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("pos.activeRegisters") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ registers.filter((r) => r.status === "active").length }}
            </p>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center">
          <div class="p-3 rounded-full bg-yellow-100">
            <ClockIcon class="h-6 w-6 text-yellow-600" />
          </div>
          <div class="ml-4">
            <p class="text-sm font-medium text-gray-500">
              {{ t("pos.avgServiceTime") }}
            </p>
            <p class="text-2xl font-semibold text-gray-900">
              {{ todayStats.avgServiceTime }}{{ t("pos.minutes") }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 主要內容區 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- 左側：現金櫃管理 -->
      <div class="lg:col-span-2 space-y-6">
        <!-- 收銀櫃列表 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-gray-900">
                {{ t("pos.registerList") }}
              </h2>
              <button
                class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                @click="createRegister"
              >
                {{ t("pos.addRegister") }}
              </button>
            </div>
          </div>

          <div class="p-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                v-for="register in registers"
                :key="register.id"
                :class="[
                  'border-2 rounded-lg p-4 cursor-pointer transition-all',
                  currentRegister?.id === register.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300',
                ]"
                @click="selectRegister(register)"
              >
                <div class="flex items-center justify-between mb-3">
                  <h3 class="font-medium text-gray-900">{{ register.name }}</h3>
                  <span
                    :class="getRegisterStatusClass(register.status)"
                    class="px-2 py-1 text-xs font-medium rounded-full"
                  >
                    {{ getRegisterStatusText(register.status) }}
                  </span>
                </div>

                <div class="space-y-2 text-sm">
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("pos.currentBalance") }}:</span
                    >
                    <span class="font-semibold">{{
                      formatDrawerBalance(register)
                    }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("pos.todayTransactions") }}:</span
                    >
                    <span>{{ register.todayTransactions }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-gray-600"
                      >{{ t("pos.lastActivity") }}:</span
                    >
                    <span>{{ formatClockTime(register.lastActivity) }}</span>
                  </div>
                </div>

                <div class="mt-4 flex space-x-2">
                  <button
                    v-if="register.status === 'inactive'"
                    class="flex-1 py-2 bg-green-600 text-white rounded text-xs hover:bg-green-700 transition-colors"
                    @click.stop="activateRegister(register.id)"
                  >
                    {{ t("pos.activate") }}
                  </button>
                  <button
                    v-else
                    class="flex-1 py-2 bg-gray-600 text-white rounded text-xs hover:bg-gray-700 transition-colors"
                    @click.stop="deactivateRegister(register.id)"
                  >
                    {{ t("pos.deactivate") }}
                  </button>

                  <button
                    class="flex-1 py-2 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors"
                    @click.stop="openCashMovement(register)"
                  >
                    {{ t("pos.cashManagement") }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 最近交易 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-gray-900">
                {{ t("pos.recentTransactions") }}
              </h2>
              <div class="flex space-x-2">
                <button
                  class="px-3 py-1 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200 transition-colors"
                  @click="exportTransactions"
                >
                  {{ t("pos.export") }}
                </button>
                <button
                  data-testid="refresh-btn"
                  class="p-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  @click="refreshTransactions"
                >
                  <ArrowPathIcon class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div class="divide-y divide-gray-200">
            <div
              v-for="transaction in recentTransactions"
              :key="transaction.id"
              class="p-4 hover:bg-gray-50"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <div class="flex-shrink-0">
                    <div
                      :class="[
                        'w-10 h-10 rounded-full flex items-center justify-center',
                        getTransactionTypeColor(transaction.type),
                      ]"
                    >
                      <component
                        :is="getTransactionIcon(transaction.type)"
                        class="w-5 h-5"
                      />
                    </div>
                  </div>
                  <div class="ml-4">
                    <p class="text-sm font-medium text-gray-900">
                      {{ getTransactionTypeText(transaction.type) }}
                    </p>
                    <p class="text-xs text-gray-500">
                      {{ transaction.description }} -
                      {{ formatDateTime(transaction.createdAt) }}
                    </p>
                  </div>
                </div>
                <div class="text-right">
                  <p
                    :class="[
                      'text-sm font-semibold',
                      transaction.amount >= 0
                        ? 'text-green-600'
                        : 'text-red-600',
                    ]"
                  >
                    {{ transaction.amount >= 0 ? "+" : "-"
                    }}{{ formatPrice(Math.abs(transaction.amount)) }}
                  </p>
                  <p class="text-xs text-gray-500">
                    {{ transaction.registerId }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 空狀態 -->
            <div
              v-if="recentTransactions.length === 0"
              class="p-12 text-center"
            >
              <DocumentTextIcon class="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 class="text-lg font-medium text-gray-900 mb-2">
                {{ t("pos.noTransactions") }}
              </h3>
              <p class="text-gray-500">{{ t("pos.noTransactionsHint") }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側：快速操作 -->
      <div class="space-y-6">
        <!-- 快速收款 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("pos.quickPayment") }}
            </h3>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("pos.orderNumber")
                }}</label>
                <input
                  v-model="quickPayment.orderNumber"
                  type="text"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  :placeholder="t('pos.orderNumberPlaceholder')"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("pos.amount")
                }}</label>
                <div class="relative">
                  <span class="absolute left-3 top-3 text-gray-500">{{
                    currencySymbol
                  }}</span>
                  <input
                    v-model.number="quickPayment.amount"
                    data-testid="pos-quick-payment-amount"
                    type="number"
                    :step="inputStep"
                    min="0"
                    class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    :placeholder="inputPlaceholder"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("pos.paymentMethod")
                }}</label>
                <select
                  v-model="quickPayment.paymentMethod"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">{{ t("pos.selectMethod") }}</option>
                  <option value="cash">{{ t("pos.methods.cash") }}</option>
                  <option value="card">{{ t("pos.methods.card") }}</option>
                  <option value="digital_wallet">
                    {{ t("pos.methods.digitalWallet") }}
                  </option>
                  <option value="bank_transfer">
                    {{ t("pos.methods.bankTransfer") }}
                  </option>
                </select>
              </div>

              <button
                :disabled="!canProcessQuickPayment"
                class="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                @click="processQuickPayment"
              >
                {{ t("pos.confirmPayment") }}
              </button>
            </div>
          </div>
        </div>

        <!-- 市場結帳收款 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("pos.marketCheckoutPayment") }}
            </h3>

            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("pos.marketCheckoutId")
                }}</label>
                <input
                  v-model="marketCheckoutPayment.checkoutId"
                  data-testid="pos-market-checkout-id"
                  type="text"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  :placeholder="t('pos.marketCheckoutIdPlaceholder')"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">{{
                  t("pos.paymentMethod")
                }}</label>
                <select
                  v-model="marketCheckoutPayment.paymentMethod"
                  data-testid="pos-market-checkout-payment-method"
                  class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="cash">{{ t("pos.methods.cash") }}</option>
                  <option value="card">{{ t("pos.methods.card") }}</option>
                  <option value="digital_wallet">
                    {{ t("pos.methods.digitalWallet") }}
                  </option>
                </select>
              </div>

              <p class="text-xs text-gray-500">
                {{ t("pos.marketCheckoutPaymentHint") }}
              </p>

              <button
                data-testid="pos-market-checkout-pay"
                :disabled="!canProcessMarketCheckoutPayment || isProcessing"
                class="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                @click="processMarketCheckoutPayment"
              >
                {{
                  isProcessing
                    ? t("common.processing")
                    : t("pos.confirmMarketCheckoutPayment")
                }}
              </button>
            </div>
          </div>
        </div>

        <!-- 促銷活動 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-gray-900">
                {{ t("pos.activePromotions") }}
              </h3>
              <button
                class="text-blue-600 hover:text-blue-700 text-sm font-medium"
                @click="openPromotionsDialog"
              >
                {{ t("pos.managePromotions") }}
              </button>
            </div>

            <div class="space-y-3">
              <div
                v-for="promotion in activePromotions"
                :key="promotion.id"
                class="p-3 bg-teal-50 rounded-lg border border-teal-200"
              >
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-teal-900">
                      {{ promotion.title }}
                    </p>
                    <p class="text-xs text-teal-600">
                      {{ promotion.description }}
                    </p>
                  </div>
                  <span class="text-sm font-bold text-teal-900">
                    {{
                      promotion.discountType === "percentage"
                        ? `${promotion.discountValue}%`
                        : formatPrice(promotion.discountValue)
                    }}
                  </span>
                </div>
              </div>

              <div
                v-if="activePromotions.length === 0"
                class="text-center py-4"
              >
                <p class="text-sm text-gray-500">{{ t("pos.noPromotions") }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 今日班次狀況 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-gray-900">
                {{ t("pos.todayShift") }}
              </h3>
              <button
                class="text-blue-600 hover:text-blue-700 text-sm font-medium"
                @click="generateShiftReport"
              >
                {{ t("pos.generateReport") }}
              </button>
            </div>

            <div v-if="currentShift" class="space-y-3">
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">{{ t("pos.startTime") }}:</span>
                <span class="font-medium">{{
                  formatClockTime(currentShift.startTime)
                }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">{{ t("pos.workHours") }}:</span>
                <span class="font-medium"
                  >{{ getShiftDuration() }}{{ t("pos.hours") }}</span
                >
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-600"
                  >{{ t("pos.processedOrders") }}:</span
                >
                <span class="font-medium">{{
                  currentShift.processedOrders
                }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-gray-600">{{ t("pos.totalRevenue") }}:</span>
                <span class="font-medium text-green-600">{{
                  formatPrice(currentShift.totalRevenue)
                }}</span>
              </div>
            </div>

            <div v-else class="text-center py-4">
              <p class="text-sm text-gray-500 mb-3">{{ t("pos.noShift") }}</p>
              <button
                class="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                @click="startShift"
              >
                {{ t("pos.startShift") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 現金管理模態框 -->
    <div
      v-if="showCashMovementDialog"
      class="fixed inset-0 z-50 overflow-y-auto"
    >
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeCashMovementDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("pos.cashManagement") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeCashMovementDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("pos.operationType")
              }}</label>
              <select
                v-model="cashMovement.type"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{{ t("pos.selectMethod") }}</option>
                <option value="cash_in">{{ t("pos.cashIn") }}</option>
                <option value="cash_out">{{ t("pos.cashOut") }}</option>
                <option value="drawer_count">{{ t("pos.drawerCount") }}</option>
                <option value="refund">{{ t("pos.refund") }}</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("pos.amount")
              }}</label>
              <div class="relative">
                <span class="absolute left-3 top-3 text-gray-500">{{
                  currencySymbol
                }}</span>
                <input
                  v-model.number="cashMovement.amount"
                  type="number"
                  :step="inputStep"
                  min="0"
                  class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  :placeholder="inputPlaceholder"
                />
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("pos.description")
              }}</label>
              <textarea
                v-model="cashMovement.description"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('pos.descriptionPlaceholder')"
              />
            </div>
          </div>

          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closeCashMovementDialog"
            >
              {{ t("pos.cancel") }}
            </button>
            <button
              :disabled="!canProcessCashMovement"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="processCashMovement"
            >
              {{ t("pos.confirmOperation") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 促銷管理模態框 -->
    <div v-if="showPromotionsDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closePromotionsDialog"
        />
        <div
          class="relative bg-white rounded-lg shadow-xl max-w-4xl w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("pos.promotionManagementTitle") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closePromotionsDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="mb-6">
            <button
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              @click="createPromotion"
            >
              {{ t("pos.addPromotion") }}
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-for="promotion in allPromotions"
              :key="promotion.id"
              class="border rounded-lg p-4"
            >
              <div class="flex items-center justify-between mb-2">
                <h4 class="font-medium text-gray-900">{{ promotion.title }}</h4>
                <span
                  :class="[
                    'px-2 py-1 text-xs font-medium rounded-full',
                    promotion.isActive
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800',
                  ]"
                >
                  {{ promotion.isActive ? t("pos.enabled") : t("pos.paused") }}
                </span>
              </div>
              <p class="text-sm text-gray-600 mb-3">
                {{ promotion.description }}
              </p>

              <div class="flex items-center justify-between">
                <span class="text-lg font-bold text-teal-600">
                  {{
                    promotion.discountType === "percentage"
                      ? `${promotion.discountValue}%`
                      : formatPrice(promotion.discountValue)
                  }}
                </span>

                <div class="flex space-x-2">
                  <button
                    class="px-3 py-1 bg-gray-100 text-gray-600 rounded text-sm hover:bg-gray-200 transition-colors"
                    @click="editPromotion(promotion)"
                  >
                    {{ t("pos.edit") }}
                  </button>
                  <button
                    :class="[
                      'px-3 py-1 rounded text-sm transition-colors',
                      promotion.isActive
                        ? 'bg-red-100 text-red-600 hover:bg-red-200'
                        : 'bg-green-100 text-green-600 hover:bg-green-200',
                    ]"
                    @click="togglePromotion(promotion)"
                  >
                    {{ promotion.isActive ? t("pos.pause") : t("pos.enable") }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增收銀櫃 Modal -->
    <div
      v-if="showCreateRegisterModal"
      class="fixed inset-0 z-50 overflow-y-auto"
    >
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showCreateRegisterModal = false"
        />
        <div
          class="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-ios-text">
              {{ t("pos.createRegister") || "新增收銀櫃" }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="showCreateRegisterModal = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("pos.prompts.registerName") || "收銀櫃名稱" }}
            </label>
            <input
              v-model="newRegisterName"
              type="text"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-ios-blue focus:border-ios-blue"
              :placeholder="
                t('pos.prompts.registerNamePlaceholder') || '例如: 一號收銀櫃'
              "
              @keyup.enter="confirmCreateRegister"
            />
          </div>
          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200 transition-colors"
              @click="showCreateRegisterModal = false"
            >
              {{ t("common.cancel") || "取消" }}
            </button>
            <button
              :disabled="!newRegisterName.trim()"
              class="px-4 py-2 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="confirmCreateRegister"
            >
              {{ t("common.confirm") || "確認" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 開始班次 Modal -->
    <div v-if="showStartShiftModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showStartShiftModal = false"
        />
        <div
          class="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-ios-text">
              {{ t("pos.startShift") || "開始班次" }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="showStartShiftModal = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("pos.prompts.startingCash") || "初始現金金額" }}
            </label>
            <div class="relative">
              <span class="absolute left-3 top-3 text-gray-500">{{
                currencySymbol
              }}</span>
              <input
                v-model.number="startingCashAmount"
                type="number"
                :step="inputStep"
                min="0"
                class="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-ios-blue focus:border-ios-blue"
                :placeholder="inputPlaceholder"
                @keyup.enter="confirmStartShift"
              />
            </div>
          </div>
          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200 transition-colors"
              @click="showStartShiftModal = false"
            >
              {{ t("common.cancel") || "取消" }}
            </button>
            <button
              :disabled="startingCashAmount < 0"
              class="px-4 py-2 bg-ios-green text-white rounded-full hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="confirmStartShift"
            >
              {{ t("pos.startShift") || "開始班次" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 結束班次確認 Modal -->
    <div v-if="showEndShiftModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showEndShiftModal = false"
        />
        <div
          class="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-ios-text">
              {{ t("pos.endShift") || "結束班次" }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="showEndShiftModal = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          <p class="text-gray-600 mb-6">
            {{
              t("pos.confirms.endShift") ||
              "確定要結束當前班次嗎？結束後將無法繼續記錄交易。"
            }}
          </p>
          <label class="mb-6 block">
            <span class="mb-2 block text-sm font-medium text-gray-700">
              {{ t("cashier.actualAmount") || "實際清點現金" }}
            </span>
            <input
              v-model.number="endingCashAmount"
              data-testid="pos-ending-cash-amount"
              type="number"
              min="0"
              :step="inputStep"
              :placeholder="inputPlaceholder"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <div class="flex justify-end space-x-3">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200 transition-colors"
              @click="showEndShiftModal = false"
            >
              {{ t("common.cancel") || "取消" }}
            </button>
            <button
              :disabled="!hasValidEndingCash"
              data-testid="pos-confirm-end-shift"
              class="px-4 py-2 bg-ios-red text-white rounded-full hover:bg-red-600 transition-colors"
              @click="confirmEndShift"
            >
              {{ t("pos.endShift") || "結束班次" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增促銷活動 Modal -->
    <div
      v-if="showCreatePromotionModal"
      class="fixed inset-0 z-50 overflow-y-auto"
    >
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showCreatePromotionModal = false"
        />
        <div
          class="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-ios-text">
              {{ t("pos.createPromotion") || "新增促銷活動" }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="showCreatePromotionModal = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("pos.prompts.promotionName") || "活動名稱" }}
            </label>
            <input
              v-model="newPromotionName"
              type="text"
              class="w-full px-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-ios-blue focus:border-ios-blue"
              :placeholder="
                t('pos.prompts.promotionNamePlaceholder') || '例如: 週末特惠'
              "
              @keyup.enter="confirmCreatePromotion"
            />
          </div>
          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200 transition-colors"
              @click="showCreatePromotionModal = false"
            >
              {{ t("common.cancel") || "取消" }}
            </button>
            <button
              :disabled="!newPromotionName.trim()"
              class="px-4 py-2 bg-ios-orange text-white rounded-full hover:bg-orange-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="confirmCreatePromotion"
            >
              {{ t("common.confirm") || "確認" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, type Component } from "vue";
import type { UserId } from "@/types/api-user";
import {
  BanknotesIcon,
  ShoppingCartIcon,
  UserGroupIcon,
  ClockIcon,
  DocumentTextIcon,
  ArrowPathIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import PlusIcon from "@heroicons/vue/24/solid/PlusIcon";
import MinusIcon from "@heroicons/vue/24/solid/MinusIcon";
import AdjustmentsHorizontalIcon from "@heroicons/vue/24/solid/AdjustmentsHorizontalIcon";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { api, unwrapApiList, unwrapApiPayload } from "@/services/api";
import {
  posService,
  type MarketCheckoutPosPaymentMethod,
} from "@/services/posService";
import { useAuthStore } from "@/stores/auth";

const { t } = useI18n();
const { formatPrice, currencySymbol, inputStep, inputPlaceholder } =
  useCurrency();
const { formatDateTime, formatTime } = useDateFormatter();
const authStore = useAuthStore();

// Loading states — assigned in async operations, read via template bindings
const isLoadingRegisters = ref(false);
const isLoadingTransactions = ref(false);
const isLoadingPromotions = ref(false);
const isLoadingStats = ref(false);
const isProcessing = ref(false);

// Mark as used for TS — these are consumed in async functions below
// and will be wired to template loading indicators
void api;
void authStore;
void isLoadingRegisters.value;
void isLoadingTransactions.value;
void isLoadingPromotions.value;
void isLoadingStats.value;
void isProcessing.value;

// 類型定義
interface CashRegister {
  id: string;
  name: string;
  status: "active" | "inactive" | "maintenance";
  // cash_registers has no currentBalance column.  A drawer balance belongs
  // to an open shift's reconciliation, not to the register configuration.
  currentBalance?: number;
  todayTransactions: number;
  lastActivity: string;
  location: string;
}

interface CashShift {
  id: string;
  name: string;
  startTime: string;
  endTime?: string;
  registerId: string;
  operatorId: UserId;
  startingCash: number;
  totalRevenue: number;
  processedOrders: number;
  status: "active" | "ended" | "closed";
  /** Actual API fields retained while mapping the display model below. */
  startedAt?: string | Date;
  endedAt?: string | Date;
  startAmount?: number;
  totalTransactions?: number;
}

interface DailyStatsPayload {
  totalSales?: number;
  totalOrders?: number;
  avgOrderValue?: number;
}

interface Transaction {
  id: string;
  registerId: string;
  type: "sale" | "refund" | "cash_in" | "cash_out" | "drawer_count";
  amount: number;
  description: string;
  createdAt: string;
  operatorId: UserId;
}

interface Promotion {
  id: string;
  title: string;
  description: string;
  discountType: "percentage" | "fixed_amount";
  discountValue: number;
  isActive: boolean;
  startDate: string;
  endDate: string;
  conditions: string;
}

// 響應式狀態
const currentRegister = ref<CashRegister | null>(null);
const currentShift = ref<CashShift | null>(null);
const showCashMovementDialog = ref(false);
const showPromotionsDialog = ref(false);

// 統計數據
const todayStats = ref({
  revenue: 0,
  orders: 0,
  avgServiceTime: 0,
});

// 收銀櫃列表
const registers = ref<CashRegister[]>([]);

// 最近交易
const recentTransactions = ref<Transaction[]>([]);

// 促銷活動
const activePromotions = ref<Promotion[]>([]);

const allPromotions = ref<Promotion[]>([]);

// 快速收款
const quickPayment = ref({
  orderNumber: "",
  amount: 0,
  paymentMethod: "",
});

const marketCheckoutPayment = ref<{
  checkoutId: string;
  paymentMethod: MarketCheckoutPosPaymentMethod;
}>({
  checkoutId: "",
  paymentMethod: "cash",
});

// 現金管理
const cashMovement = ref({
  type: "",
  amount: 0,
  description: "",
});

// Modal 狀態
const showCreateRegisterModal = ref(false);
const newRegisterName = ref("");
const showStartShiftModal = ref(false);
const startingCashAmount = ref(0);
const showEndShiftModal = ref(false);
// `null`, not 0, means the cashier has not performed a physical count yet.
const endingCashAmount = ref<number | null>(null);
const showCreatePromotionModal = ref(false);
const newPromotionName = ref("");

// 計算屬性
const canProcessQuickPayment = computed(() => {
  return (
    quickPayment.value.orderNumber &&
    quickPayment.value.amount > 0 &&
    quickPayment.value.paymentMethod &&
    currentRegister.value
  );
});

const canProcessMarketCheckoutPayment = computed(() => {
  return (
    marketCheckoutPayment.value.checkoutId.trim().length > 0 &&
    marketCheckoutPayment.value.paymentMethod &&
    currentRegister.value &&
    currentShift.value
  );
});

const canProcessCashMovement = computed(() => {
  return (
    cashMovement.value.type &&
    cashMovement.value.amount > 0 &&
    cashMovement.value.description
  );
});

const hasValidEndingCash = computed(
  () =>
    typeof endingCashAmount.value === "number" &&
    Number.isFinite(endingCashAmount.value) &&
    endingCashAmount.value >= 0,
);

// 輔助函數
// formatTime treats a bare string as an "HH:mm" time-of-day, so ISO datetimes
// must be converted to a Date first. A missing end time is normal for an open
// shift; never leak "Invalid Date" into the cashier UI.
const formatClockTime = (dateTime?: string) => {
  const date = new Date(dateTime ?? "");
  return Number.isFinite(date.getTime()) ? formatTime(date) : "—";
};

const validIsoDate = (value: unknown): string | undefined => {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  }
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
};

const formatDrawerBalance = (register: CashRegister | null | undefined) =>
  typeof register?.currentBalance === "number" &&
  Number.isFinite(register.currentBalance)
    ? formatPrice(register.currentBalance)
    : "—";

const normalizeRegister = (value: unknown): CashRegister => {
  const register = (value ?? {}) as Record<string, unknown>;
  const status =
    register.status === "active" ||
    register.status === "inactive" ||
    register.status === "maintenance"
      ? register.status
      : register.isActive === false
        ? "inactive"
        : "active";
  const todayTransactions = register.todayTransactions;

  return {
    id: typeof register.id === "string" ? register.id : "",
    name: typeof register.name === "string" ? register.name : "",
    status,
    // Deliberately do not copy a non-contract `currentBalance` property.
    // The dashboard cannot safely infer a drawer total from register config.
    todayTransactions:
      typeof todayTransactions === "number" &&
      Number.isFinite(todayTransactions)
        ? todayTransactions
        : 0,
    lastActivity:
      validIsoDate(register.lastActivity ?? register.updatedAt) ?? "",
    location: typeof register.location === "string" ? register.location : "",
  };
};

const getRegisterStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    inactive: "bg-gray-100 text-gray-800",
    maintenance: "bg-yellow-100 text-yellow-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
};

const getRegisterStatusText = (status: string) => {
  const texts: Record<string, string> = {
    active: t("pos.registerStatus.active"),
    inactive: t("pos.registerStatus.inactive"),
    maintenance: t("pos.registerStatus.maintenance"),
  };
  return texts[status] || status;
};

const getTransactionTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    sale: "bg-green-100",
    refund: "bg-red-100",
    cash_in: "bg-blue-100",
    cash_out: "bg-orange-100",
    drawer_count: "bg-teal-100",
  };
  return colors[type] || "bg-gray-100";
};

const getTransactionIcon = (type: string) => {
  const icons: Record<string, Component> = {
    sale: BanknotesIcon,
    refund: MinusIcon,
    cash_in: PlusIcon,
    cash_out: MinusIcon,
    drawer_count: AdjustmentsHorizontalIcon,
  };
  return icons[type] || DocumentTextIcon;
};

const getTransactionTypeText = (type: string) => {
  const texts: Record<string, string> = {
    sale: t("pos.transactionType.sale"),
    refund: t("pos.transactionType.refund"),
    cash_in: t("pos.transactionType.cashIn"),
    cash_out: t("pos.transactionType.cashOut"),
    drawer_count: t("pos.transactionType.drawerCount"),
  };
  return texts[type] || type;
};

const selectRegister = async (register: CashRegister) => {
  currentRegister.value = register;
  // Load current shift for the selected register
  await loadCurrentShift(register.id);
};

const createRegister = () => {
  newRegisterName.value = "";
  showCreateRegisterModal.value = true;
};

const confirmCreateRegister = async () => {
  const name = newRegisterName.value.trim();
  if (!name) return;
  showCreateRegisterModal.value = false;
  isProcessing.value = true;
  try {
    const response = await api.post("/pos/registers", {
      name,
      restaurantId: authStore.restaurantId,
      location: t("pos.defaults.locationPending"),
    });
    if (response.data.success) {
      await loadRegisters();
    }
  } catch (error) {
    console.error("Failed to create register:", error);
  } finally {
    isProcessing.value = false;
  }
};

const activateRegister = async (registerId: string) => {
  isProcessing.value = true;
  try {
    await api.post(`/pos/registers/${registerId}/activate`);
    const register = registers.value.find((r) => r.id === registerId);
    if (register) {
      register.status = "active";
      register.lastActivity = new Date().toISOString();
    }
  } catch (error) {
    console.error("Failed to activate register:", error);
  } finally {
    isProcessing.value = false;
  }
};

const deactivateRegister = async (registerId: string) => {
  isProcessing.value = true;
  try {
    await api.post(`/pos/registers/${registerId}/deactivate`);
    const register = registers.value.find((r) => r.id === registerId);
    if (register) {
      register.status = "inactive";
    }
  } catch (error) {
    console.error("Failed to deactivate register:", error);
  } finally {
    isProcessing.value = false;
  }
};

const startShift = () => {
  if (!currentRegister.value) return;
  startingCashAmount.value = 0;
  showStartShiftModal.value = true;
};

const confirmStartShift = async () => {
  if (!currentRegister.value) return;
  const amount = startingCashAmount.value;
  showStartShiftModal.value = false;
  isProcessing.value = true;
  try {
    const response = await api.post("/pos/shifts/start", {
      registerId: currentRegister.value.id,
      startAmount: amount,
      operatorId: authStore.user?.id ?? "",
    });
    if (response.data.success && response.data.data) {
      const shiftData = unwrapApiPayload<Partial<CashShift>>(
        response.data.data,
      );
      currentShift.value = {
        id: shiftData.id || "",
        name: shiftData.name || t("pos.defaults.morningShift"),
        startTime:
          validIsoDate(shiftData.startedAt ?? shiftData.startTime) ??
          new Date().toISOString(),
        registerId: currentRegister.value.id,
        operatorId: authStore.user?.id ?? "",
        startingCash: shiftData.startAmount ?? amount,
        totalRevenue: 0,
        processedOrders: 0,
        status: "active",
      };
    }
  } catch (error) {
    console.error("Failed to start shift:", error);
  } finally {
    isProcessing.value = false;
  }
};

const endShift = () => {
  if (!currentShift.value) return;
  endingCashAmount.value = null;
  showEndShiftModal.value = true;
};

const confirmEndShift = async () => {
  if (!currentShift.value || !hasValidEndingCash.value) return;
  showEndShiftModal.value = false;
  isProcessing.value = true;
  try {
    await api.post(`/pos/shifts/${currentShift.value.id}/end`, {
      actualAmount: endingCashAmount.value,
    });
    currentShift.value = null;
  } catch (error) {
    console.error("Failed to end shift:", error);
  } finally {
    isProcessing.value = false;
  }
};

const getShiftDuration = () => {
  if (!currentShift.value) return "0";
  const start = new Date(currentShift.value.startTime);
  if (!Number.isFinite(start.getTime())) return "0";
  const now = new Date();
  const hours = Math.floor(
    (now.getTime() - start.getTime()) / (1000 * 60 * 60),
  );
  return hours.toString();
};

const processQuickPayment = async () => {
  if (!canProcessQuickPayment.value) return;

  isProcessing.value = true;
  try {
    const response = await api.post("/pos/quick-payment", {
      orderId: quickPayment.value.orderNumber,
      registerId: currentRegister.value!.id,
      amount: quickPayment.value.amount,
      paymentMethod: quickPayment.value.paymentMethod,
      operatorId: authStore.user?.id ?? "",
    });

    if (response.data.success) {
      // The server's register record has no running drawer balance. Do not
      // invent one client-side (and especially do not add card/digital sales
      // to cash); closing reconciliation is authoritative.
      if (currentRegister.value) {
        currentRegister.value.todayTransactions++;
        currentRegister.value.lastActivity = new Date().toISOString();
      }

      // 更新班次統計
      if (currentShift.value) {
        currentShift.value.totalRevenue += quickPayment.value.amount;
        currentShift.value.processedOrders++;
      }

      // Refresh transactions to show the new one
      await refreshTransactions();

      // 重置表單
      quickPayment.value = {
        orderNumber: "",
        amount: 0,
        paymentMethod: "",
      };
    }
  } catch (error) {
    console.error("Quick payment failed:", error);
  } finally {
    isProcessing.value = false;
  }
};

const processMarketCheckoutPayment = async () => {
  if (!canProcessMarketCheckoutPayment.value) return;

  isProcessing.value = true;
  try {
    const result = await posService.payMarketCheckout({
      checkoutId: marketCheckoutPayment.value.checkoutId.trim(),
      registerId: currentRegister.value!.id,
      shiftId: currentShift.value!.id,
      paymentMethod: marketCheckoutPayment.value.paymentMethod,
    });
    const paidAmount =
      (result.payment.paidAmountCents ?? result.payment.totalAmountCents) / 100;

    if (currentRegister.value) {
      currentRegister.value.todayTransactions++;
      currentRegister.value.lastActivity = new Date().toISOString();
    }

    if (currentShift.value) {
      currentShift.value.totalRevenue += paidAmount;
      currentShift.value.processedOrders++;
    }

    await refreshTransactions();

    marketCheckoutPayment.value = {
      checkoutId: "",
      paymentMethod: "cash",
    };
  } catch (error) {
    console.error("Market checkout POS payment failed:", error);
  } finally {
    isProcessing.value = false;
  }
};

const openCashMovement = (register: CashRegister) => {
  currentRegister.value = register;
  showCashMovementDialog.value = true;
  cashMovement.value = { type: "", amount: 0, description: "" };
};

const closeCashMovementDialog = () => {
  showCashMovementDialog.value = false;
};

const processCashMovement = async () => {
  if (!canProcessCashMovement.value || !currentRegister.value) return;
  if (!currentShift.value) return;

  isProcessing.value = true;
  try {
    const response = await api.post(
      `/pos/shifts/${currentShift.value.id}/cash-movements`,
      {
        type: cashMovement.value.type,
        amount: cashMovement.value.amount,
        description: cashMovement.value.description,
      },
    );

    if (response.data.success) {
      currentRegister.value.lastActivity = new Date().toISOString();

      await refreshTransactions();
      closeCashMovementDialog();
    }
  } catch (error) {
    console.error("Cash movement failed:", error);
  } finally {
    isProcessing.value = false;
  }
};

const openPromotionsDialog = () => {
  showPromotionsDialog.value = true;
};

const closePromotionsDialog = () => {
  showPromotionsDialog.value = false;
};

const createPromotion = () => {
  newPromotionName.value = "";
  showCreatePromotionModal.value = true;
};

const confirmCreatePromotion = async () => {
  const title = newPromotionName.value.trim();
  if (!title) return;
  showCreatePromotionModal.value = false;
  isProcessing.value = true;
  try {
    const response = await api.post("/pos/promotions", {
      title,
      description: t("pos.defaults.newPromotion"),
      discountType: "percentage",
      discountValue: 10,
      isActive: false,
      startDate: new Date().toISOString().split("T")[0],
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    });
    if (response.data.success) {
      await loadPromotions();
    }
  } catch (error) {
    console.error("Failed to create promotion:", error);
  } finally {
    isProcessing.value = false;
  }
};

const editPromotion = (promotion: Promotion) => {
  // TODO: Open promotion edit dialog
  console.log("Edit promotion:", promotion.id);
};

const togglePromotion = async (promotion: Promotion) => {
  isProcessing.value = true;
  try {
    await api.put(`/pos/promotions/${promotion.id}`, {
      isActive: !promotion.isActive,
    });
    promotion.isActive = !promotion.isActive;
    // Update active promotions list
    activePromotions.value = allPromotions.value.filter((p) => p.isActive);
  } catch (error) {
    console.error("Failed to toggle promotion:", error);
  } finally {
    isProcessing.value = false;
  }
};

const openRegisterManagement = () => {
  loadRegisters();
};

const refreshTransactions = async () => {
  if (!currentRegister.value) return;
  isLoadingTransactions.value = true;
  try {
    const response = await api.get(
      `/pos/registers/${currentRegister.value.id}/cash-movements`,
    );
    if (response.data.success && response.data.data) {
      recentTransactions.value = response.data.data as Transaction[];
    }
  } catch (error) {
    console.error("Failed to load transactions:", error);
  } finally {
    isLoadingTransactions.value = false;
  }
};

const exportTransactions = async () => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const response = await api.get("/pos/reports/export", {
      type: "daily",
      format: "csv",
      startDate: today,
    });
    // If the response is a blob/csv, trigger download
    if (response.data) {
      const blob = new Blob([JSON.stringify(response.data)], {
        type: "text/csv",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error("Failed to export transactions:", error);
  }
};

const generateShiftReport = async () => {
  if (!currentShift.value) return;
  try {
    const response = await api.get(
      `/pos/shifts/${currentShift.value.id}/report`,
    );
    if (response.data.success && response.data.data) {
      console.log("Shift report:", response.data.data);
      // TODO: Display shift report in a dialog
    }
  } catch (error) {
    console.error("Failed to generate shift report:", error);
  }
};

// --- Data loading functions ---
const loadRegisters = async () => {
  isLoadingRegisters.value = true;
  try {
    const params: Record<string, string> = {};
    if (authStore.restaurantId) {
      params.restaurantId = authStore.restaurantId;
    }
    const response = await api.get("/pos/registers", params);
    if (response.data.success && response.data.data) {
      registers.value = unwrapApiList<unknown>(response.data.data).map(
        normalizeRegister,
      );
    }
  } catch (error) {
    console.error("Failed to load registers:", error);
  } finally {
    isLoadingRegisters.value = false;
  }
};

const loadCurrentShift = async (registerId: string) => {
  try {
    const response = await api.get(`/pos/shifts/current/${registerId}`);
    if (response.data.success && response.data.data) {
      const shiftData = unwrapApiPayload<
        Partial<CashShift> & {
          totalSales?: number;
          startedAt?: string | Date;
          endedAt?: string | Date;
          startAmount?: number;
          totalTransactions?: number;
        }
      >(response.data.data);
      currentShift.value = {
        id: shiftData.id || "",
        name: shiftData.name || "",
        startTime:
          validIsoDate(shiftData.startedAt ?? shiftData.startTime) ?? "",
        endTime: validIsoDate(shiftData.endedAt ?? shiftData.endTime),
        registerId: shiftData.registerId || registerId,
        operatorId: shiftData.operatorId || "",
        startingCash: shiftData.startAmount ?? shiftData.startingCash ?? 0,
        totalRevenue: shiftData.totalSales || 0,
        processedOrders:
          shiftData.totalTransactions ?? shiftData.processedOrders ?? 0,
        status:
          shiftData.status === "ended" || shiftData.status === "closed"
            ? "ended"
            : "active",
      };
    } else {
      currentShift.value = null;
    }
  } catch {
    currentShift.value = null;
  }
};

const loadDailyStats = async () => {
  if (!currentRegister.value) return;
  isLoadingStats.value = true;
  try {
    const today = new Date().toISOString().split("T")[0];
    const response = await api.get(
      `/pos/registers/${currentRegister.value.id}/stats/daily`,
      { date: today },
    );
    if (response.data.success && response.data.data) {
      const stats = unwrapApiPayload<DailyStatsPayload>(response.data.data);
      todayStats.value = {
        revenue: stats.totalSales ?? 0,
        orders: stats.totalOrders ?? 0,
        avgServiceTime: stats.avgOrderValue
          ? Math.round(stats.avgOrderValue * 10) / 10
          : 0,
      };
    }
  } catch (error) {
    console.error("Failed to load daily stats:", error);
    // Keep defaults (zeros) on error
  } finally {
    isLoadingStats.value = false;
  }
};

const loadPromotions = async () => {
  isLoadingPromotions.value = true;
  try {
    const response = await api.get("/pos/promotions");
    if (response.data.success && response.data.data) {
      allPromotions.value = response.data.data as Promotion[];
      activePromotions.value = allPromotions.value.filter((p) => p.isActive);
    }
  } catch (error) {
    console.error("Failed to load promotions:", error);
  } finally {
    isLoadingPromotions.value = false;
  }
};

// 生命週期
onMounted(async () => {
  // Load registers from API
  await loadRegisters();

  // 自動選擇第一個現金櫃
  if (registers.value.length > 0) {
    currentRegister.value = registers.value[0];
    // Load shift for the first register
    await loadCurrentShift(registers.value[0].id);
  }

  // Load daily stats, transactions, and promotions in parallel
  await Promise.all([
    loadDailyStats(),
    refreshTransactions(),
    loadPromotions(),
  ]);
});
</script>

<style scoped>
.pos-management {
  /* Inherits padding from parent POSView container */
}
</style>
