<template>
  <div class="cashier-checkout">
    <!-- 結帳操作列 -->
    <div class="flex justify-between items-center mb-6">
      <div class="flex items-center space-x-4">
        <!-- 班次資訊 -->
        <div class="bg-blue-50 px-4 py-2 rounded-2xl">
          <p class="text-sm text-blue-800 font-medium">
            {{ t("cashier.shift") }}: {{ currentShift.name }}
          </p>
          <p class="text-xs text-blue-600">
            {{ currentShift.startTime }} - {{ currentShift.endTime }}
          </p>
        </div>

        <!-- 今日業績 -->
        <div class="bg-green-50 px-4 py-2 rounded-2xl">
          <p class="text-sm text-gray-500">
            {{ t("cashier.todayPerformance") }}
          </p>
          <p class="text-lg font-semibold text-ios-green">
            {{ formatPrice(todayRevenue) }}
          </p>
        </div>
      </div>

      <!-- 功能按鈕 -->
      <div class="flex items-center space-x-2">
        <button
          class="px-3 py-2 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors text-sm"
          @click="openShiftReport"
        >
          {{ t("cashier.shiftReport") }}
        </button>
        <button
          data-testid="cashier-open-refund"
          class="px-3 py-2 bg-ios-orange text-white rounded-full hover:bg-orange-600 transition-colors text-sm"
          @click="openRefundDialog"
        >
          {{ t("cashier.refundProcess") }}
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- 左側：待結帳訂單列表 -->
      <div class="lg:col-span-2">
        <div class="bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <div class="flex items-center justify-between">
              <h2 class="text-xl font-semibold text-gray-900">
                {{ t("cashier.pendingOrders") }}
              </h2>
              <div class="flex items-center space-x-4">
                <div class="relative">
                  <MagnifyingGlassIcon
                    class="absolute left-3 top-3 h-4 w-4 text-gray-400"
                  />
                  <input
                    v-model="searchQuery"
                    type="text"
                    :placeholder="t('cashier.searchPlaceholder')"
                    class="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <button
                  class="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  @click="refreshOrders"
                >
                  <ArrowPathIcon class="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>

          <div class="divide-y divide-gray-200">
            <div
              v-for="order in filteredOrders"
              :key="order.id"
              :class="[
                'p-6 cursor-pointer hover:bg-gray-50 transition-colors',
                selectedOrder?.id === order.id
                  ? 'bg-blue-50 border-l-4 border-blue-500'
                  : '',
              ]"
              @click="selectOrder(order)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <div class="flex-shrink-0">
                    <div
                      class="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center"
                    >
                      <DocumentTextIcon class="w-5 h-5 text-blue-600" />
                    </div>
                  </div>
                  <div class="ml-4">
                    <div class="flex items-center">
                      <h3 class="text-lg font-medium text-gray-900">
                        {{ order.orderNumber }}
                      </h3>
                      <span
                        :class="getOrderStatusClass(order.status)"
                        class="ml-2 px-2 py-1 text-xs font-medium rounded-full"
                      >
                        {{ getOrderStatusText(order.status) }}
                      </span>
                    </div>
                    <div class="flex items-center mt-1 text-sm text-gray-500">
                      <MapPinIcon class="w-4 h-4 mr-1" />
                      <span>{{
                        order.tableNumber
                          ? `${t("cashier.tableNumber")} ${order.tableNumber}`
                          : t("cashier.takeaway")
                      }}</span>
                      <span class="mx-2">•</span>
                      <ClockIcon class="w-4 h-4 mr-1" />
                      <span>{{ formatClockTime(order.createdAt) }}</span>
                    </div>
                  </div>
                </div>
                <div class="text-right">
                  <p class="text-xl font-bold text-gray-900">
                    {{ formatPrice(order.totalAmount) }}
                  </p>
                  <p class="text-sm text-gray-500">
                    {{ t("cashier.itemCount", { count: order.items.length }) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 空狀態 -->
            <div v-if="filteredOrders.length === 0" class="p-12 text-center">
              <ShoppingBagIcon class="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <h3 class="text-lg font-medium text-gray-900 mb-2">
                {{ t("cashier.noPendingOrders") }}
              </h3>
              <p class="text-gray-500">{{ t("cashier.allOrdersCompleted") }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 右側：結帳區域 -->
      <div class="space-y-6">
        <!-- 選中的訂單詳情 -->
        <div class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{
                selectedOrder
                  ? t("cashier.orderDetails")
                  : t("cashier.selectOrder")
              }}
            </h3>

            <div v-if="selectedOrder">
              <!-- 訂單基本信息 -->
              <div class="mb-6">
                <div class="flex items-center justify-between mb-4">
                  <h4 class="font-medium text-gray-900">
                    {{ selectedOrder.orderNumber }}
                  </h4>
                  <span
                    :class="getOrderStatusClass(selectedOrder.status)"
                    class="px-2 py-1 text-xs font-medium rounded-full"
                  >
                    {{ getOrderStatusText(selectedOrder.status) }}
                  </span>
                </div>
                <div class="text-sm text-gray-600 space-y-1">
                  <div class="flex justify-between">
                    <span>{{ t("cashier.tableNumber") }}:</span>
                    <span>{{
                      selectedOrder.tableNumber || t("cashier.takeaway")
                    }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span>{{ t("cashier.orderTime") }}:</span>
                    <span>{{ formatDateTime(selectedOrder.createdAt) }}</span>
                  </div>
                  <div class="flex justify-between">
                    <span>{{ t("cashier.customer") }}:</span>
                    <span>{{
                      selectedOrder.customerName || t("cashier.customer")
                    }}</span>
                  </div>
                </div>
              </div>

              <!-- 商品清單 -->
              <div class="mb-6">
                <h5 class="font-medium text-gray-900 mb-3">
                  {{ t("cashier.itemList") }}
                </h5>
                <div class="space-y-2">
                  <div
                    v-for="item in selectedOrder.items"
                    :key="item.id"
                    class="flex justify-between text-sm"
                  >
                    <div>
                      <span class="font-medium">{{ item.menuItemName }}</span>
                      <span class="text-gray-500 ml-2"
                        >x{{ item.quantity }}</span
                      >
                    </div>
                    <span>{{ formatPrice(item.totalPrice) }}</span>
                  </div>
                </div>
              </div>

              <!-- 金額計算 -->
              <div class="border-t border-gray-200 pt-4 space-y-2">
                <div class="flex justify-between text-sm">
                  <span>{{ t("cashier.subtotal") }}:</span>
                  <span>{{ formatPrice(selectedOrder.subtotal) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span>{{ t("cashier.serviceCharge") }}:</span>
                  <span>{{ formatPrice(selectedOrder.serviceCharge) }}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span>{{ t("cashier.tax") }}:</span>
                  <span>{{ formatPrice(selectedOrder.taxAmount) }}</span>
                </div>
                <div
                  v-if="selectedOrder.discountAmount > 0"
                  class="text-sm text-green-600"
                >
                  <div class="flex justify-between">
                    <span>{{ t("cashier.discount") }}:</span>
                    <span
                      >-{{ formatPrice(selectedOrder.discountAmount) }}</span
                    >
                  </div>
                </div>
                <div
                  class="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-200"
                >
                  <span>{{ t("cashier.total") }}:</span>
                  <span>{{ formatPrice(selectedOrder.totalAmount) }}</span>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-8">
              <CursorArrowRaysIcon
                class="mx-auto h-12 w-12 text-gray-400 mb-2"
              />
              <p class="text-gray-500">{{ t("cashier.pleaseSelectOrder") }}</p>
            </div>
          </div>
        </div>

        <!-- 付款方式選擇 -->
        <div v-if="selectedOrder" class="bg-white rounded-lg shadow">
          <div class="p-6">
            <h3 class="text-lg font-semibold text-gray-900 mb-4">
              {{ t("cashier.paymentMethod") }}
            </h3>

            <div class="grid grid-cols-2 gap-3 mb-4">
              <button
                v-for="method in paymentMethods"
                :key="method.id"
                :class="[
                  'flex flex-col items-center p-4 border-2 rounded-lg transition-colors',
                  selectedPaymentMethod === method.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300',
                ]"
                :data-selected="selectedPaymentMethod === method.id"
                @click="selectedPaymentMethod = method.id"
              >
                <component :is="method.icon" class="w-6 h-6 mb-2" />
                <span class="text-sm font-medium">{{ method.name }}</span>
              </button>
            </div>

            <!-- 現金付款輸入 -->
            <div v-if="selectedPaymentMethod === 'cash'" class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.amountReceived")
              }}</label>
              <div class="relative">
                <span class="absolute left-3 top-3 text-gray-500">{{
                  currencySymbol
                }}</span>
                <input
                  v-model.number="cashReceived"
                  data-testid="received-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
                  placeholder="0.00"
                />
              </div>
              <div
                v-if="cashReceived > 0"
                class="mt-2 p-3 bg-gray-50 rounded-lg"
              >
                <div class="flex justify-between text-sm">
                  <span>{{ t("cashier.amountDue") }}:</span>
                  <span class="font-medium">{{
                    formatPrice(selectedOrder.totalAmount)
                  }}</span>
                </div>
                <div class="flex justify-between text-sm">
                  <span>{{ t("cashier.received") }}:</span>
                  <span class="font-medium">{{
                    formatPrice(cashReceived)
                  }}</span>
                </div>
                <div
                  class="flex justify-between text-lg font-bold mt-1 pt-1 border-t border-gray-200"
                >
                  <span>{{ t("cashier.change") }}:</span>
                  <span
                    :class="change >= 0 ? 'text-green-600' : 'text-red-600'"
                  >
                    {{ formatPrice(change) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- 結帳按鈕 -->
            <div class="space-y-3">
              <div
                v-if="paymentError"
                data-testid="payment-error"
                role="alert"
                class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {{ paymentError }}
              </div>

              <button
                :disabled="!canProcessPayment"
                data-testid="pay-btn"
                class="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-lg"
                @click="processPayment"
              >
                {{ t("cashier.confirmPayment") }}
              </button>

              <div class="grid grid-cols-2 gap-3">
                <button
                  class="py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors text-sm"
                  @click="applyDiscount"
                >
                  {{ t("cashier.applyDiscount") }}
                </button>
                <button
                  class="py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
                  @click="printReceipt"
                >
                  {{ t("cashier.printReceipt") }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 班次報告模態框 -->
    <div v-if="showShiftReport" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeShiftReport"
        />
        <div
          class="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("cashier.shiftReport") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeShiftReport"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-6">
            <!-- 班次基本資訊 -->
            <div class="grid grid-cols-2 gap-4">
              <div class="bg-blue-50 p-4 rounded-lg">
                <h4 class="font-medium text-blue-900 mb-2">
                  {{ t("cashier.shiftInfo") }}
                </h4>
                <div class="text-sm text-blue-800 space-y-1">
                  <p>{{ t("cashier.shift") }}: {{ shiftReport.name }}</p>
                  <p>
                    {{ t("cashier.time") }}: {{ shiftReport.startTime }} -
                    {{ shiftReport.endTime }}
                  </p>
                  <p>
                    {{ t("cashier.cashierName") }}:
                    {{ shiftReport.cashierName }}
                  </p>
                </div>
              </div>
              <div class="bg-green-50 p-4 rounded-lg">
                <h4 class="font-medium text-green-900 mb-2">
                  {{ t("cashier.revenueTotal") }}
                </h4>
                <div class="text-sm text-green-800 space-y-1">
                  <p>
                    {{ t("cashier.cash") }}:
                    {{ formatPrice(shiftReport.cashTotal) }}
                  </p>
                  <p>
                    {{ t("cashier.card") }}:
                    {{ formatPrice(shiftReport.cardTotal) }}
                  </p>
                  <p>
                    {{ t("cashier.digitalPayment") }}:
                    {{ formatPrice(shiftReport.digitalTotal) }}
                  </p>
                  <p class="font-bold text-lg pt-1 border-t border-green-200">
                    {{ t("cashier.total") }}:
                    {{ formatPrice(shiftReport.totalRevenue) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 交易明細 -->
            <div>
              <h4 class="font-medium text-gray-900 mb-3">
                {{ t("cashier.transactionDetails") }}
              </h4>
              <div class="grid grid-cols-3 gap-4 text-center">
                <div class="bg-gray-50 p-3 rounded">
                  <p class="text-sm text-gray-600">
                    {{ t("cashier.totalOrders") }}
                  </p>
                  <p class="text-2xl font-bold text-gray-900">
                    {{ shiftReport.totalOrders }}
                  </p>
                </div>
                <div class="bg-gray-50 p-3 rounded">
                  <p class="text-sm text-gray-600">
                    {{ t("cashier.avgOrderValue") }}
                  </p>
                  <p class="text-2xl font-bold text-gray-900">
                    {{ formatPrice(shiftReport.avgOrderValue) }}
                  </p>
                </div>
                <div class="bg-gray-50 p-3 rounded">
                  <p class="text-sm text-gray-600">
                    {{ t("cashier.refundCount") }}
                  </p>
                  <p class="text-2xl font-bold text-gray-900">
                    {{ shiftReport.refundCount }}
                  </p>
                </div>
              </div>
            </div>

            <!-- 現金盤點 -->
            <div class="bg-yellow-50 p-4 rounded-lg">
              <h4 class="font-medium text-yellow-900 mb-3">
                {{ t("cashier.cashCount") }}
              </h4>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label
                    class="block text-sm font-medium text-yellow-800 mb-1"
                    >{{ t("cashier.systemAmount") }}</label
                  >
                  <div class="text-lg font-bold text-yellow-900">
                    {{ formatPrice(shiftReport.systemCashAmount) }}
                  </div>
                </div>
                <div>
                  <label
                    class="block text-sm font-medium text-yellow-800 mb-1"
                    >{{ t("cashier.actualAmount") }}</label
                  >
                  <input
                    v-model.number="actualCashAmount"
                    type="number"
                    step="0.01"
                    class="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div
                class="mt-3 p-2 rounded"
                :class="
                  cashDifference === 0
                    ? 'bg-green-100 text-green-800'
                    : 'bg-red-100 text-red-800'
                "
              >
                <p class="text-sm font-medium">
                  {{
                    cashDifference === 0
                      ? t("cashier.cashMatch")
                      : cashDifference > 0
                        ? t("cashier.cashOver", {
                            amount: formatPrice(Math.abs(cashDifference)),
                          })
                        : t("cashier.cashShort", {
                            amount: formatPrice(Math.abs(cashDifference)),
                          })
                  }}
                </p>
              </div>
            </div>
          </div>

          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closeShiftReport"
            >
              {{ t("common.close") }}
            </button>
            <button
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              @click="printShiftReport"
            >
              {{ t("cashier.printReport") }}
            </button>
            <button
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              @click="endShift"
            >
              {{ t("cashier.endShift") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 退款處理模態框 -->
    <div v-if="showRefundDialog" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="closeRefundDialog"
        />
        <div class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6">
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-gray-900">
              {{ t("cashier.refundProcess") }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="closeRefundDialog"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>

          <div class="space-y-4">
            <div
              v-if="refundError"
              data-testid="refund-error"
              role="alert"
              class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {{ refundError }}
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.orderNumber")
              }}</label>
              <input
                v-model="refundData.orderNumber"
                data-testid="cashier-refund-order-number"
                type="text"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('cashier.enterOrderNumber')"
              />
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.refundAmount")
              }}</label>
              <div class="relative">
                <span class="absolute left-3 top-3 text-gray-500">{{
                  currencySymbol
                }}</span>
                <input
                  v-model.number="refundData.amount"
                  data-testid="cashier-refund-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.refundType") || "退款類型"
              }}</label>
              <select
                v-model="refundData.refundType"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="full">
                  {{ t("cashier.refundTypes.full") || "全額退款" }}
                </option>
                <option value="partial">
                  {{ t("cashier.refundTypes.partial") || "部分退款" }}
                </option>
                <option value="item">
                  {{ t("cashier.refundTypes.item") || "單品退款" }}
                </option>
                <option value="service">
                  {{ t("cashier.refundTypes.service") || "服務退款" }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.refundMethod") || "退款方式"
              }}</label>
              <select
                v-model="refundData.refundMethod"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="cash">
                  {{ t("cashier.paymentMethods.cash") }}
                </option>
                <option value="card">
                  {{ t("cashier.paymentMethods.card") }}
                </option>
                <option value="digital_wallet">
                  {{ t("cashier.paymentMethods.digitalWallet") }}
                </option>
                <option value="bank_transfer">
                  {{ t("cashier.paymentMethods.bankTransfer") }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.refundReason")
              }}</label>
              <select
                v-model="refundData.reason"
                data-testid="cashier-refund-reason"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">{{ t("cashier.selectReason") }}</option>
                <option value="quality_issue">
                  {{ t("cashier.reasons.qualityIssue") }}
                </option>
                <option value="wrong_order">
                  {{ t("cashier.reasons.wrongOrder") }}
                </option>
                <option value="customer_change">
                  {{ t("cashier.reasons.customerChange") }}
                </option>
                <option value="service_issue">
                  {{ t("cashier.reasons.serviceIssue") }}
                </option>
                <option value="other">{{ t("cashier.reasons.other") }}</option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("cashier.notes")
              }}</label>
              <textarea
                v-model="refundData.notes"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="t('cashier.optionalNotes')"
              />
            </div>
          </div>

          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closeRefundDialog"
            >
              {{ t("common.cancel") }}
            </button>
            <button
              :disabled="!canProcessRefund"
              data-testid="cashier-confirm-refund"
              class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="processRefund"
            >
              {{ t("cashier.confirmRefund") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 收款成功模態框 -->
    <div
      v-if="showPaymentSuccess"
      data-testid="payment-success"
      class="fixed inset-0 z-50 overflow-y-auto"
    >
      <div class="flex items-center justify-center min-h-screen px-4">
        <div class="fixed inset-0 bg-black opacity-30" />
        <div
          class="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6 text-center"
        >
          <CheckCircleIcon class="mx-auto h-16 w-16 text-green-600 mb-4" />
          <h3 class="text-xl font-semibold text-gray-900 mb-2">
            {{ t("cashier.paymentSuccess") }}
          </h3>
          <p class="text-gray-600 mb-6">
            {{
              t("cashier.orderCompleted", {
                orderNumber: completedOrder?.orderNumber ?? "",
              })
            }}
          </p>
          <div class="space-y-3">
            <button
              class="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              @click="printFinalReceipt"
            >
              {{ t("cashier.printReceipt") }}
            </button>
            <button
              class="w-full py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors"
              @click="closePaymentSuccess"
            >
              {{ t("cashier.done") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 折扣輸入 Modal -->
    <div v-if="showDiscountModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black opacity-30"
          @click="showDiscountModal = false"
        />
        <div
          class="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6"
        >
          <div class="flex items-center justify-between mb-6">
            <h3 class="text-xl font-semibold text-ios-text">
              {{ t("cashier.applyDiscount") || "套用折扣" }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="showDiscountModal = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("cashier.prompts.discountPercent") || "折扣百分比" }}
            </label>
            <div class="relative">
              <input
                v-model.number="discountPercentInput"
                type="number"
                step="1"
                min="0"
                max="100"
                class="w-full pr-10 pl-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-ios-blue focus:border-ios-blue"
                placeholder="0"
                @keyup.enter="confirmApplyDiscount"
              />
              <span class="absolute right-3 top-2.5 text-gray-500">%</span>
            </div>
          </div>
          <div class="flex justify-end space-x-3 mt-6">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200 transition-colors"
              @click="showDiscountModal = false"
            >
              {{ t("common.cancel") || "取消" }}
            </button>
            <button
              :disabled="
                !discountPercentInput ||
                discountPercentInput <= 0 ||
                discountPercentInput > 100
              "
              class="px-4 py-2 bg-ios-blue text-white rounded-full hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="confirmApplyDiscount"
            >
              {{ t("common.confirm") || "確認" }}
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
              {{ t("cashier.endShift") || "結束班次" }}
            </h3>
            <button
              class="text-gray-400 hover:text-gray-600"
              @click="showEndShiftModal = false"
            >
              <XMarkIcon class="w-6 h-6" />
            </button>
          </div>
          <p class="text-gray-600 mb-6">
            {{ t("cashier.confirms.endShift") || "確定要結束當前班次嗎？" }}
          </p>
          <div class="flex justify-end space-x-3">
            <button
              class="px-4 py-2 bg-gray-100 text-gray-800 rounded-full hover:bg-gray-200 transition-colors"
              @click="showEndShiftModal = false"
            >
              {{ t("common.cancel") || "取消" }}
            </button>
            <button
              class="px-4 py-2 bg-ios-red text-white rounded-full hover:bg-red-600 transition-colors"
              @click="confirmEndShift"
            >
              {{ t("cashier.endShift") || "結束班次" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import {
  MagnifyingGlassIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  MapPinIcon,
  ClockIcon,
  ShoppingBagIcon,
  CursorArrowRaysIcon,
  CheckCircleIcon,
  XMarkIcon,
} from "@heroicons/vue/24/outline";
import {
  CreditCardIcon,
  BanknotesIcon,
  DevicePhoneMobileIcon,
  BuildingLibraryIcon,
} from "@heroicons/vue/24/solid";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";
import { api, unwrapApiList, unwrapApiPayload } from "@/services/api";
import { extractApiErrorCode } from "@/utils/errorHandler";
import { toLocalDateStr } from "@/utils/dateUtils";
import { useAuthStore } from "@/stores/auth";
import type {
  Order as ApiOrder,
  OrderItem as ApiOrderItem,
  OrderPaymentStatus,
  OrderStatus,
} from "@makanmasak/shared-types";

const { t } = useI18n();
const { formatPrice, currencySymbol } = useCurrency();
const { formatDateTime, formatTime } = useDateFormatter();
const authStore = useAuthStore();

// Loading states
const isLoadingOrders = ref(false);
const isLoadingShift = ref(false);
const isProcessing = ref(false);

// Type definitions
interface CashierOrderItem {
  id: string;
  menuItemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface CashierOrder {
  id: string;
  orderNumber: string;
  tableNumber: string;
  customerName: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  createdAt: number;
  subtotal: number;
  serviceCharge: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentMethod?: string;
  // Set by a real payment. `canRefund` on the orders screen requires it, which
  // is why a checkout that never wrote a transaction row left the order
  // unrefundable (#310).
  paymentTransactionId?: string;
  items: CashierOrderItem[];
}

interface RegisterPayload {
  id: string;
  status?: string;
}

interface ShiftPayload {
  id?: string;
  name?: string;
  startTime?: string;
  endTime?: string;
  operatorName?: string;
}

interface DailyReportPayload {
  summary?: {
    totalSales?: number;
  };
  totalSales?: number;
}

interface ShiftReportPayload {
  shift?: {
    name?: string;
    startTime?: string;
    endTime?: string;
  };
  sales?: {
    cash?: number;
    card?: number;
    digital?: number;
    total?: number;
  };
  cashTotal?: number;
  cardTotal?: number;
  digitalTotal?: number;
  totalRevenue?: number;
  totalOrders?: number;
  avgOrderValue?: number;
  refundCount?: number;
  systemCashAmount?: number;
  orders?: number;
  refunds?: number;
}

// 響應式數據
const searchQuery = ref("");
const selectedOrder = ref<CashierOrder | null>(null);
const selectedPaymentMethod = ref("cash");
const cashReceived = ref(0);
const paymentError = ref("");
const showPaymentSuccess = ref(false);
const completedOrder = ref<CashierOrder | null>(null);

// 新增的狀態
const showShiftReport = ref(false);
const showRefundDialog = ref(false);
const actualCashAmount = ref(0);
const todayRevenue = ref(0);

// Modal 狀態
const showDiscountModal = ref(false);
const discountPercentInput = ref(0);
const showEndShiftModal = ref(false);

// 班次資訊
const currentShift = ref({
  id: "",
  name: "",
  startTime: "",
  endTime: "",
  cashierName: "",
  registerId: "",
});

// 班次報告數據
const shiftReport = ref({
  name: "",
  startTime: "",
  endTime: "",
  cashierName: "",
  cashTotal: 0,
  cardTotal: 0,
  digitalTotal: 0,
  totalRevenue: 0,
  totalOrders: 0,
  avgOrderValue: 0,
  refundCount: 0,
  systemCashAmount: 0,
});

// 退款數據
const refundData = ref({
  orderNumber: "",
  amount: 0,
  reason: "",
  notes: "",
  refundType: "partial" as "full" | "partial" | "item" | "service",
  refundMethod: "cash",
});
const refundError = ref<string | null>(null);

// 付款方式
const paymentMethods = computed(() => [
  { id: "cash", name: t("cashier.paymentMethods.cash"), icon: BanknotesIcon },
  { id: "card", name: t("cashier.paymentMethods.card"), icon: CreditCardIcon },
  {
    id: "digital_wallet",
    name: t("cashier.paymentMethods.digitalWallet"),
    icon: DevicePhoneMobileIcon,
  },
  {
    id: "bank_transfer",
    name: t("cashier.paymentMethods.bankTransfer"),
    icon: BuildingLibraryIcon,
  },
]);

// 待結帳訂單 (loaded from API)
const orders = ref<CashierOrder[]>([]);

// 計算屬性
const filteredOrders = computed(() => {
  let filtered = orders.value.filter(
    (order) =>
      ["ready", "delivered"].includes(order.status) &&
      order.paymentStatus === "pending",
  );

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    filtered = filtered.filter(
      (order) =>
        order.orderNumber.toLowerCase().includes(query) ||
        order.tableNumber?.toLowerCase().includes(query) ||
        order.customerName?.toLowerCase().includes(query),
    );
  }

  return filtered.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
});

const change = computed(() => {
  if (!selectedOrder.value || selectedPaymentMethod.value !== "cash") return 0;
  return cashReceived.value - selectedOrder.value.totalAmount;
});

const canProcessPayment = computed(() => {
  if (!selectedOrder.value || !selectedPaymentMethod.value) return false;

  if (selectedPaymentMethod.value === "cash") {
    return cashReceived.value >= selectedOrder.value.totalAmount;
  }

  return true;
});

const canProcessRefund = computed(() => {
  return (
    refundData.value.orderNumber &&
    refundData.value.amount > 0 &&
    refundData.value.reason
  );
});

const cashDifference = computed(() => {
  return actualCashAmount.value - shiftReport.value.systemCashAmount;
});

// --- Data loading functions ---
const loadOrders = async () => {
  isLoadingOrders.value = true;
  try {
    const response = await api.get("/orders", {
      status: "ready,delivered",
      paymentStatus: "pending",
      restaurantId: authStore.restaurantId,
      limit: 50,
    });
    if (response.data.success && response.data.data) {
      const payload = response.data.data;
      const rawOrders = unwrapApiList<ApiOrder>(payload);
      orders.value = rawOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        tableNumber: order.table?.number ?? "",
        customerName: order.customerInfo?.name ?? "",
        status: order.status,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
        subtotal: order.subtotal,
        serviceCharge: order.serviceCharge ?? 0,
        taxAmount: order.taxAmount ?? 0,
        discountAmount: order.discountAmount ?? 0,
        totalAmount: order.totalAmount,
        paymentMethod: order.paymentMethod,
        items: (order.items ?? []).map((item: ApiOrderItem) => ({
          id: String(item.id),
          menuItemName: item.itemSnapshot?.name ?? item.menuItem?.name ?? "",
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
        })),
      }));
    }
  } catch (error) {
    console.error("Failed to load orders:", error);
  } finally {
    isLoadingOrders.value = false;
  }
};

const loadCurrentShift = async () => {
  isLoadingShift.value = true;
  try {
    // Try to get registers first, then current shift for the first one
    const regResponse = await api.get("/pos/registers", {
      restaurantId: authStore.restaurantId,
    });
    if (regResponse.data.success && regResponse.data.data) {
      const registers = unwrapApiList<RegisterPayload>(regResponse.data.data);
      const activeRegister = registers.find((r) => r.status === "active");
      if (activeRegister) {
        currentShift.value.registerId = activeRegister.id;
        const shiftResponse = await api.get(
          `/pos/shifts/current/${activeRegister.id}`,
        );
        if (shiftResponse.data.success && shiftResponse.data.data) {
          const shift = unwrapApiPayload<ShiftPayload>(shiftResponse.data.data);
          currentShift.value = {
            id: shift.id || "",
            name: shift.name || "",
            startTime: shift.startTime || "",
            endTime: shift.endTime || "",
            cashierName: shift.operatorName || authStore.user?.username || "",
            registerId: activeRegister.id,
          };
        }
      }
    }
  } catch {
    // No active shift — keep defaults
  } finally {
    isLoadingShift.value = false;
  }
};

const loadTodayRevenue = async () => {
  try {
    // The shop's calendar day, not UTC's: toISOString() gave Taipei the
    // previous day's takings from midnight until 08:00.
    const today = toLocalDateStr(new Date());
    const response = await api.get("/pos/reports/daily", {
      date: today,
      restaurantId: authStore.restaurantId,
    });
    if (response.data.success && response.data.data) {
      const report = unwrapApiPayload<DailyReportPayload>(response.data.data);
      todayRevenue.value = report.summary?.totalSales ?? report.totalSales ?? 0;
    }
  } catch {
    // Keep default 0
  }
};

// 方法
const refreshOrders = async () => {
  await loadOrders();
};

const selectOrder = (order: CashierOrder) => {
  selectedOrder.value = order;
  paymentError.value = "";
  cashReceived.value = 0;
  selectedPaymentMethod.value = "cash";
};

// formatTime treats a bare string as an "HH:mm" time-of-day, so ISO datetimes
// must be converted to a Date first.
const formatClockTime = (dateTime: number) => formatTime(new Date(dateTime));

const getOrderStatusClass = (status: string) => {
  const classes: Record<string, string> = {
    ready: "bg-green-100 text-green-800",
    delivered: "bg-blue-100 text-blue-800",
    completed: "bg-gray-100 text-gray-800",
  };
  return classes[status] || "bg-gray-100 text-gray-800";
};

const getOrderStatusText = (status: string) => {
  const texts: Record<string, string> = {
    ready: t("cashier.orderStatus.ready"),
    delivered: t("cashier.orderStatus.delivered"),
    paid: t("cashier.orderStatus.paid"),
  };
  return texts[status] || status;
};

// Held across retries of one checkout, not minted per request. The server
// requires an Idempotency-Key and uses it to replay the first answer instead of
// charging again, which only works if a retry presents the same key. Cleared on
// success so the next customer starts a new one.
const pendingPaymentKey = ref<string | null>(null);

const processPayment = async () => {
  if (!canProcessPayment.value || !selectedOrder.value) return;

  paymentError.value = "";
  isProcessing.value = true;
  if (!pendingPaymentKey.value) {
    pendingPaymentKey.value = crypto.randomUUID();
  }

  try {
    // This used to be `PUT /orders/:id/status {status:"paid"}` followed by an
    // optional `POST /pos/quick-payment`. Neither recorded a payment:
    // updateOrderStatus writes only `status` and `paid_at`, and
    // /pos/quick-payment does not exist in the API at all — its 404 was
    // swallowed by a catch whose comment claimed the payment had been
    // recorded. So an order left the counter marked paid with payment_status
    // still "pending", no payment_transaction row, and therefore no
    // paymentTransactionId — which is what the refund button requires. Revenue
    // counted it (status "paid" is in FULFILLED_ORDER_STATUSES) while nothing
    // recorded that money had arrived, and the order was terminal, so it could
    // be neither refunded nor cancelled (#310).
    //
    // POST /payments does the whole thing in one guarded, idempotent call:
    // writes the transaction, sets payment_status and payment_transaction_id,
    // and closes the order.
    const response = await api.post(
      "/payments",
      {
        orderId: String(selectedOrder.value.id),
        paymentMode: "full",
        amount: selectedOrder.value.totalAmount,
        expectedTotal: selectedOrder.value.totalAmount,
        method: selectedPaymentMethod.value,
        closeOrder: true,
      },
      { headers: { "Idempotency-Key": pendingPaymentKey.value } },
    );

    if (response.data.success) {
      pendingPaymentKey.value = null;
      const { transactionId } = unwrapApiPayload<{ transactionId?: string }>(
        response.data.data,
      );

      const orderIndex = orders.value.findIndex(
        (o) => o.id === selectedOrder.value!.id,
      );
      if (orderIndex > -1) {
        orders.value[orderIndex].paymentStatus = "completed";
        orders.value[orderIndex].status = "paid";
        orders.value[orderIndex].paymentMethod = selectedPaymentMethod.value;
        orders.value[orderIndex].paymentTransactionId = transactionId;
      }

      completedOrder.value = { ...selectedOrder.value };
      showPaymentSuccess.value = true;
      selectedOrder.value = null;

      // Update today's revenue
      todayRevenue.value += completedOrder.value!.totalAmount;
    }
  } catch (error) {
    console.error("Payment processing error:", error);
    // The server prices the order, not this screen. A local discount changes
    // only what is displayed here, so it arrives as a total the server does not
    // recognise. Say that plainly rather than showing "Request failed with
    // status code 400".
    const code = extractApiErrorCode(error);
    paymentError.value =
      code === "PAYMENT_AMOUNT_MISMATCH" || code === "PAYMENT_TOTAL_MISMATCH"
        ? t("cashier.amountMismatch")
        : (apiErrorMessage(error) ??
          (error instanceof Error
            ? error.message
            : t("cashier.paymentFailed") || "Payment failed"));
  } finally {
    isProcessing.value = false;
  }
};

function apiErrorMessage(error: unknown): string | undefined {
  const data = (error as { response?: { data?: unknown } } | null)?.response
    ?.data;
  const apiError = (data as { error?: { message?: unknown } } | null)?.error;
  return typeof apiError?.message === "string" ? apiError.message : undefined;
}

const applyDiscount = () => {
  if (!selectedOrder.value) return;
  discountPercentInput.value = 0;
  showDiscountModal.value = true;
};

/**
 * Send the discount to the server and take its answer as the price.
 *
 * This used to recompute the totals in place and post nothing, which could not
 * work: `PaymentService` prices the order from `orders.total_amount_cents` and
 * refuses any `amount`/`expectedTotal` that disagrees, so a locally discounted
 * order answered PAYMENT_AMOUNT_MISMATCH and simply could not be paid. Worse,
 * `printReceipt` sends whatever total is on screen, so a receipt printed
 * before payment showed a discount the database had never agreed to (#327).
 *
 * Only the percentage is sent. The server derives the money from the order's
 * own stored cents, so this screen never names a price.
 */
const confirmApplyDiscount = async () => {
  if (!selectedOrder.value || !discountPercentInput.value || isProcessing.value)
    return;

  const percent = discountPercentInput.value;
  isProcessing.value = true;
  paymentError.value = "";

  try {
    const response = await api.post(
      `/orders/${selectedOrder.value.id}/discount`,
      {
        discountPercent: percent,
        reason: t("cashier.discountReason", { percent }),
      },
    );
    const updated = unwrapApiPayload<{
      discountAmount?: number;
      totalAmount?: number;
    }>(response.data.data);

    selectedOrder.value.discountAmount = updated.discountAmount ?? 0;
    selectedOrder.value.totalAmount =
      updated.totalAmount ?? selectedOrder.value.totalAmount;

    const orderIndex = orders.value.findIndex(
      (o) => o.id === selectedOrder.value!.id,
    );
    if (orderIndex > -1) {
      orders.value[orderIndex].discountAmount =
        selectedOrder.value.discountAmount;
      orders.value[orderIndex].totalAmount = selectedOrder.value.totalAmount;
    }

    showDiscountModal.value = false;
  } catch (error) {
    console.error("Failed to apply discount:", error);
    const code = extractApiErrorCode(error);
    paymentError.value =
      code === "ORDER_HAS_COUPON_DISCOUNT"
        ? t("cashier.discountCouponConflict")
        : (apiErrorMessage(error) ?? t("cashier.discountFailed"));
    showDiscountModal.value = false;
  } finally {
    isProcessing.value = false;
  }
};

const printReceipt = async () => {
  if (!selectedOrder.value || !currentShift.value.registerId) return;
  isProcessing.value = true;
  try {
    await api.post("/pos/receipts/print", {
      orderId: String(selectedOrder.value.id),
      registerId: currentShift.value.registerId,
      items: selectedOrder.value.items,
      totalAmount: selectedOrder.value.totalAmount,
      paymentMethod: selectedPaymentMethod.value,
    });
  } catch (error) {
    console.error("Failed to print receipt:", error);
  } finally {
    isProcessing.value = false;
  }
};

const printFinalReceipt = async () => {
  if (!completedOrder.value || !currentShift.value.registerId) {
    closePaymentSuccess();
    return;
  }
  isProcessing.value = true;
  try {
    await api.post("/pos/receipts/print", {
      orderId: String(completedOrder.value.id),
      registerId: currentShift.value.registerId,
      items: completedOrder.value.items,
      totalAmount: completedOrder.value.totalAmount,
      paymentMethod: completedOrder.value.paymentMethod || "cash",
    });
  } catch (error) {
    console.error("Failed to print receipt:", error);
  } finally {
    isProcessing.value = false;
    closePaymentSuccess();
  }
};

const closePaymentSuccess = () => {
  showPaymentSuccess.value = false;
  completedOrder.value = null;
};

// 班次報告相關方法
const openShiftReport = async () => {
  if (!currentShift.value.id) {
    showShiftReport.value = true;
    actualCashAmount.value = shiftReport.value.systemCashAmount;
    return;
  }
  isProcessing.value = true;
  try {
    const response = await api.get(
      `/pos/shifts/${currentShift.value.id}/report`,
    );
    if (response.data.success && response.data.data) {
      const report = unwrapApiPayload<ShiftReportPayload>(response.data.data);
      const shift = report.shift || {};
      shiftReport.value = {
        name: shift.name || currentShift.value.name,
        startTime: shift.startTime || currentShift.value.startTime,
        endTime: shift.endTime || currentShift.value.endTime,
        cashierName: currentShift.value.cashierName,
        cashTotal: report.sales?.cash ?? report.cashTotal ?? 0,
        cardTotal: report.sales?.card ?? report.cardTotal ?? 0,
        digitalTotal: report.sales?.digital ?? report.digitalTotal ?? 0,
        totalRevenue: report.sales?.total ?? report.totalRevenue ?? 0,
        totalOrders: report.orders ?? 0,
        avgOrderValue:
          (report.orders ?? 0) > 0
            ? Math.round(
                ((report.sales?.total ?? 0) / (report.orders ?? 1)) * 100,
              ) / 100
            : 0,
        refundCount: report.refunds ?? 0,
        systemCashAmount: report.sales?.cash ?? 0,
      };
    }
  } catch (error) {
    console.error("Failed to load shift report:", error);
  } finally {
    isProcessing.value = false;
  }
  showShiftReport.value = true;
  actualCashAmount.value = shiftReport.value.systemCashAmount;
};

const closeShiftReport = () => {
  showShiftReport.value = false;
};

const printShiftReport = () => {
  // TODO: Integrate with print service when available
  console.log("Print shift report for shift:", currentShift.value.id);
};

const endShift = () => {
  if (!currentShift.value.id) return;
  showEndShiftModal.value = true;
};

const confirmEndShift = async () => {
  if (!currentShift.value.id) return;
  showEndShiftModal.value = false;
  isProcessing.value = true;
  try {
    await api.post(`/pos/shifts/${currentShift.value.id}/end`, {
      actualAmount: actualCashAmount.value,
    });
    currentShift.value = {
      id: "",
      name: "",
      startTime: "",
      endTime: "",
      cashierName: "",
      registerId: "",
    };
    closeShiftReport();
  } catch (error) {
    console.error("Failed to end shift:", error);
  } finally {
    isProcessing.value = false;
  }
};

// 退款相關方法
const openRefundDialog = () => {
  refundError.value = null;
  showRefundDialog.value = true;
  refundData.value = {
    orderNumber: "",
    amount: 0,
    reason: "",
    notes: "",
    refundType: "partial",
    refundMethod: "cash",
  };
};

const closeRefundDialog = () => {
  showRefundDialog.value = false;
};

const processRefund = async () => {
  if (!canProcessRefund.value) return;

  isProcessing.value = true;
  try {
    await api.post(
      "/pos/refunds/create",
      {
        originalOrderId: refundData.value.orderNumber.trim(),
        refundType: refundData.value.refundType,
        refundAmount: refundData.value.amount,
        refundMethod: refundData.value.refundMethod,
        reasonCode: refundData.value.reason,
        reasonDescription: refundData.value.notes || undefined,
      },
      {
        headers: {
          "X-Register-Id": currentShift.value.registerId,
          "X-Shift-Id": currentShift.value.id,
        },
      },
    );

    // 更新統計數據
    shiftReport.value.refundCount++;
    shiftReport.value.totalRevenue -= refundData.value.amount;
    todayRevenue.value -= refundData.value.amount;

    closeRefundDialog();
  } catch (error) {
    console.error("Refund processing error:", error);
    refundError.value =
      error instanceof Error ? error.message : t("cashier.alerts.refundFailed");
  } finally {
    isProcessing.value = false;
  }
};

// 生命週期
onMounted(async () => {
  await Promise.all([loadOrders(), loadCurrentShift(), loadTodayRevenue()]);
});
</script>

<style scoped>
.cashier-checkout {
  /* Inherits padding from parent POSView container */
}
</style>
