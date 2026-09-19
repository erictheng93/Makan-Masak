<template>
  <div class="space-y-6">
    <div
      class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
    >
      <div>
        <h1 class="text-2xl font-bold text-gray-900">市場結帳紀錄</h1>
        <p class="mt-1 text-sm text-gray-500">
          追蹤跨攤位 checkout、子訂單與聯合付款狀態。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="w-fit rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="isExporting"
          data-testid="export-checkouts"
          @click="exportCheckouts"
        >
          {{ isExporting ? "匯出中..." : "匯出 CSV" }}
        </button>
        <button
          type="button"
          class="w-fit rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="isExportingVendors"
          data-testid="export-vendor-settlements"
          @click="exportVendorSettlements"
        >
          {{ isExportingVendors ? "匯出中..." : "匯出攤位對帳" }}
        </button>
        <button
          type="button"
          class="w-fit rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          :disabled="isExportingAccounting"
          data-testid="export-accounting-ledger"
          @click="exportAccountingLedger"
        >
          {{ isExportingAccounting ? "匯出中..." : "匯出會計分錄" }}
        </button>
        <button
          type="button"
          class="w-fit rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          :disabled="isLoading"
          @click="loadCheckouts"
        >
          {{ isLoading ? "讀取中..." : "重新整理" }}
        </button>
      </div>
    </div>

    <section class="rounded-lg bg-white p-4 shadow-ios-card">
      <div
        class="grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_12rem_13rem_10rem_10rem_auto]"
      >
        <input
          v-model="marketSlug"
          type="search"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          placeholder="市場 slug"
          @keyup.enter="loadCheckouts"
        />
        <select
          v-model="paymentStatus"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="">全部付款狀態</option>
          <option value="pending">待付款</option>
          <option value="partial_paid">部分付款</option>
          <option value="paid">已付款</option>
          <option value="failed">付款失敗</option>
          <option value="refunded">已退款</option>
          <option value="partial_refunded">部分退款</option>
        </select>
        <select
          v-model="operationAlert"
          data-testid="market-checkout-operation-alert"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="">全部營運狀態</option>
          <option value="provider_pending_stale">待對帳</option>
          <option value="provider_webhook_missing">未收到 webhook</option>
          <option value="provider_webhook_failed">webhook 失敗</option>
          <option value="provider_status_mismatch">狀態不一致</option>
          <option value="provider_refund_pending">退款處理中</option>
          <option value="provider_refund_failed">退款失敗</option>
          <option value="provider_amount_mismatch">金額不符待審</option>
        </select>
        <input
          v-model="dateFrom"
          type="date"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          aria-label="起始日期"
          data-testid="market-checkout-date-from"
        />
        <input
          v-model="dateTo"
          type="date"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
          aria-label="結束日期"
          data-testid="market-checkout-date-to"
        />
        <button
          type="button"
          data-testid="market-checkout-filter"
          class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          @click="loadCheckouts"
        >
          篩選
        </button>
      </div>
    </section>

    <section
      v-if="providerStatus"
      data-testid="provider-status"
      class="rounded-lg border p-4"
      :class="providerStatusClass"
    >
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div>
          <div class="text-sm font-semibold text-gray-900">金流 Provider</div>
          <div class="mt-1 text-sm text-gray-700">
            {{ providerModeLabel(providerStatus.splitMode) }} ·
            {{ providerKindLabel(providerStatus.providerKind) }}
          </div>
        </div>
        <span
          class="w-fit rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="providerStatusPillClass"
        >
          {{ providerReadinessLabel(providerStatus.readiness) }}
        </span>
      </div>
      <button
        type="button"
        data-testid="check-provider-connectivity"
        class="mt-3 rounded-lg border border-gray-300 bg-white/70 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-white disabled:opacity-50"
        :disabled="isCheckingProvider"
        @click="checkProviderConnectivity"
      >
        {{ isCheckingProvider ? "檢查中..." : "檢查 Provider 連線" }}
      </button>
      <div
        v-if="providerStatus.missingConfiguration.length"
        class="mt-3 text-sm text-red-700"
      >
        缺少設定：{{ providerStatus.missingConfiguration.join(", ") }}
      </div>
      <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div
          v-for="item in providerConfigurationChecks"
          :key="item.label"
          class="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-3 py-2"
        >
          <dt class="font-medium text-gray-600">{{ item.label }}</dt>
          <dd
            class="rounded-full px-2 py-0.5 font-semibold"
            :class="
              item.configured
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            "
          >
            {{ item.configured ? "已設定" : "未設定" }}
          </dd>
        </div>
      </dl>
      <div
        v-if="providerStatus.notes.length"
        class="mt-3 space-y-1 text-sm text-gray-600"
      >
        <p v-for="note in providerStatus.notes" :key="note">{{ note }}</p>
      </div>
      <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
        <span
          v-for="capability in providerStatus.capabilities"
          :key="capability"
          class="rounded-full bg-white/70 px-2.5 py-1"
        >
          {{ capability }}
        </span>
      </div>
      <div
        v-if="providerConnectivityCheck"
        data-testid="provider-connectivity-check"
        class="mt-3 rounded-lg bg-white/70 p-3 text-sm text-gray-700"
      >
        <div class="font-semibold" :class="providerConnectivityResultClass">
          {{
            providerConnectivityStatusLabel(providerConnectivityCheck.status)
          }}
        </div>
        <div class="mt-1">{{ providerConnectivityCheck.message }}</div>
        <div class="mt-1 text-xs text-gray-500">
          {{ formatDate(providerConnectivityCheck.checkedAt) }}
          <span v-if="providerConnectivityCheck.responseStatus">
            · HTTP {{ providerConnectivityCheck.responseStatus }}
          </span>
        </div>
      </div>
    </section>

    <section
      v-if="summary"
      data-testid="checkout-summary"
      class="grid gap-3 md:grid-cols-3 xl:grid-cols-6"
    >
      <div
        v-for="metric in summaryMetrics"
        :key="metric.label"
        class="rounded-lg bg-white p-4 shadow-ios-card"
      >
        <div class="text-xs font-medium text-gray-500">{{ metric.label }}</div>
        <div class="mt-2 text-xl font-semibold text-gray-900">
          {{ metric.value }}
        </div>
      </div>
    </section>

    <section
      v-if="summary?.topMarkets.length"
      class="rounded-lg bg-white p-4 shadow-ios-card"
    >
      <div class="mb-3 text-sm font-semibold text-gray-900">市場排行</div>
      <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="market in summary.topMarkets"
          :key="market.slug"
          class="rounded-lg border border-gray-200 p-3"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="font-semibold text-gray-900">{{ market.name }}</div>
              <div class="mt-1 text-xs text-gray-500">/{{ market.slug }}</div>
            </div>
            <div class="text-right text-sm font-semibold text-gray-900">
              {{ formatCents(market.subtotalCents) }}
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
            <span class="rounded-full bg-gray-100 px-2.5 py-1">
              {{ market.checkoutCount }} 筆
            </span>
            <span
              class="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"
            >
              已收 {{ formatCents(market.paidAmountCents) }}
            </span>
            <span class="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">
              已退 {{ formatCents(market.refundedAmountCents) }}
            </span>
          </div>
        </article>
      </div>
    </section>

    <section
      v-if="vendorSettlements.length"
      data-testid="vendor-settlements"
      class="rounded-lg bg-white p-4 shadow-ios-card"
    >
      <div class="mb-3 text-sm font-semibold text-gray-900">攤位對帳</div>
      <div class="overflow-x-auto">
        <table class="min-w-full text-left text-sm">
          <thead class="text-xs text-gray-500">
            <tr>
              <th class="whitespace-nowrap py-2 pr-4 font-medium">攤位</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">子訂單</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">GMV</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">已收</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">已退</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">淨收</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">平台費</th>
              <th class="whitespace-nowrap px-4 py-2 font-medium">淨撥款</th>
              <th class="whitespace-nowrap pl-4 py-2 font-medium">異常</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200">
            <tr
              v-for="vendor in vendorSettlements"
              :key="vendor.restaurantId"
              class="text-gray-700"
            >
              <td class="min-w-44 py-3 pr-4">
                <div class="font-semibold text-gray-900">
                  {{ vendor.restaurantName }}
                </div>
                <div class="mt-1 text-xs text-gray-500">
                  {{ vendor.checkoutCount }} 筆 checkout
                </div>
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                {{ vendor.childOrderCount }}
              </td>
              <td class="whitespace-nowrap px-4 py-3">
                {{ formatCents(vendor.subtotalCents) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-emerald-700">
                {{ formatCents(vendor.paidAmountCents) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-slate-700">
                {{ formatCents(vendor.refundedAmountCents) }}
              </td>
              <td
                class="whitespace-nowrap px-4 py-3 font-semibold text-gray-900"
              >
                {{ formatCents(vendor.netPaidAmountCents) }}
              </td>
              <td class="whitespace-nowrap px-4 py-3 text-gray-700">
                {{ formatCents(vendor.platformFeeCents) }}
              </td>
              <td
                class="whitespace-nowrap px-4 py-3 font-semibold text-primary-700"
              >
                {{ formatCents(vendor.vendorNetAmountCents) }}
              </td>
              <td class="whitespace-nowrap pl-4 py-3 text-gray-600">
                {{ vendor.failedPaymentCount }} 失敗 /
                {{ vendor.refundedPaymentCount }} 退款
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rounded-lg bg-white shadow-ios-card">
      <div v-if="error" class="p-4 text-sm text-red-600">{{ error }}</div>
      <div v-else-if="isLoading" class="p-8 text-center text-sm text-gray-500">
        載入市場結帳中...
      </div>
      <div
        v-else-if="checkouts.length === 0"
        class="p-8 text-center text-sm text-gray-500"
      >
        尚無市場結帳紀錄。
      </div>
      <div v-else class="divide-y divide-gray-200">
        <article
          v-for="checkout in checkouts"
          :key="checkout.id"
          class="grid gap-3 p-4 lg:grid-cols-[1.2fr_8rem_8rem_8rem_10rem_auto]"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="truncate text-base font-semibold text-gray-900">
                {{ checkout.market.name }}
              </h2>
              <span
                class="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
              >
                /{{ checkout.market.slug }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-500">
              {{ checkout.id }} · {{ formatDate(checkout.createdAt) }}
            </p>
            <div
              v-if="checkout.operationAlerts?.length"
              data-testid="checkout-operation-alerts"
              class="mt-2 flex flex-wrap gap-1.5"
            >
              <span
                v-for="alert in checkout.operationAlerts"
                :key="`${checkout.id}-${alert.type}`"
                class="rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="operationAlertClass(alert.severity)"
              >
                {{ alert.label }}
              </span>
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">付款</div>
            <span
              class="mt-1 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
              :class="paymentClass(checkout.paymentStatus)"
            >
              {{ paymentStatusLabel(checkout.paymentStatus) }}
            </span>
          </div>
          <div>
            <div class="text-xs text-gray-500">攤位</div>
            <div class="mt-1 text-sm font-semibold text-gray-900">
              {{ checkout.childOrderCount }} 攤
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">總額</div>
            <div class="mt-1 text-sm font-semibold text-gray-900">
              {{ formatCents(checkout.subtotal) }}
            </div>
          </div>
          <div>
            <div class="text-xs text-gray-500">更新</div>
            <div class="mt-1 text-sm text-gray-700">
              {{ formatDate(checkout.updatedAt) }}
            </div>
          </div>
          <button
            type="button"
            :data-testid="`open-checkout-${checkout.id}`"
            class="h-fit rounded-lg border border-primary-600 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-50"
            @click="openCheckout(checkout.id)"
          >
            查看
          </button>
        </article>
      </div>
    </section>

    <section
      v-if="selectedCheckout"
      data-testid="checkout-detail"
      class="rounded-lg bg-white p-4 shadow-ios-card"
    >
      <div
        class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div>
          <h2 class="text-lg font-semibold text-gray-900">
            {{ selectedCheckout.market.name }} 結帳明細
          </h2>
          <p class="mt-1 text-sm text-gray-500">
            {{ selectedCheckout.id }} ·
            {{ selectedCheckout.childOrders.length }} 筆子訂單
          </p>
        </div>
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <div
            v-if="selectedCheckout.payment"
            class="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
          >
            已付款 {{ selectedCheckout.payment.paidAmount }} /
            {{ selectedCheckout.payment.totalAmount }}
            <span v-if="selectedCheckout.payment.refundedAmount">
              · 已退 {{ selectedCheckout.payment.refundedAmount }}
            </span>
          </div>
          <button
            v-if="canRefundSelectedCheckout"
            type="button"
            data-testid="refund-checkout"
            class="rounded-lg border border-red-600 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            :disabled="isRefunding"
            @click="refundSelectedCheckout"
          >
            {{ isRefunding ? "退款中..." : "整筆退款" }}
          </button>
          <button
            v-if="canReconcileSelectedCheckout"
            type="button"
            data-testid="reconcile-checkout"
            class="rounded-lg border border-amber-600 px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50"
            :disabled="isReconciling"
            @click="reconcileSelectedCheckout"
          >
            {{ isReconciling ? "查單中..." : "查詢 Provider 狀態" }}
          </button>
        </div>
      </div>

      <div
        v-if="selectedCheckout.payment?.parentPayment"
        data-testid="checkout-parent-payment"
        class="mt-4 rounded-lg border border-gray-200 p-3"
      >
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <div class="text-sm font-semibold text-gray-900">父層付款</div>
            <div class="mt-1 text-xs text-gray-500">
              {{ selectedCheckout.payment.parentPayment.paymentId }} ·
              {{ selectedCheckout.payment.parentPayment.provider }} ·
              {{
                splitModeLabel(selectedCheckout.payment.parentPayment.splitMode)
              }}
            </div>
          </div>
          <div class="text-sm font-semibold text-gray-900">
            {{
              paymentStatusLabel(selectedCheckout.payment.parentPayment.status)
            }}
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
          <span class="rounded-full bg-gray-100 px-2.5 py-1">
            已收
            {{
              formatCents(
                selectedCheckout.payment.parentPayment.paidAmountCents,
              )
            }}
          </span>
          <span class="rounded-full bg-slate-100 px-2.5 py-1">
            已退
            {{
              formatCents(
                selectedCheckout.payment.parentPayment.refundedAmountCents,
              )
            }}
          </span>
          <span class="rounded-full bg-gray-100 px-2.5 py-1">
            子交易
            {{ selectedCheckout.payment.parentPayment.childPaymentIds.length }}
          </span>
          <span
            v-if="selectedCheckout.payment.parentPayment.providerTransactionId"
            class="rounded-full bg-gray-100 px-2.5 py-1"
          >
            交易 ID
            {{ selectedCheckout.payment.parentPayment.providerTransactionId }}
          </span>
          <span
            v-if="selectedCheckout.payment.parentPayment.nextAction"
            class="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700"
          >
            下一步
            {{ selectedCheckout.payment.parentPayment.nextAction.type }}
            <template
              v-if="
                selectedCheckout.payment.parentPayment.nextAction.redirectUrl
              "
            >
              ·
              {{
                formatUrlHost(
                  selectedCheckout.payment.parentPayment.nextAction.redirectUrl,
                )
              }}
            </template>
          </span>
          <span
            v-if="selectedCheckout.payment.parentPayment.lastWebhook"
            class="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700"
          >
            最後 webhook
            {{
              selectedCheckout.payment.parentPayment.lastWebhook.eventId || "-"
            }}
            ·
            {{ selectedCheckout.payment.parentPayment.lastWebhook.eventType }}
            ·
            {{
              webhookStatusLabel(
                selectedCheckout.payment.parentPayment.lastWebhook.status,
              )
            }}
            ·
            {{
              formatDate(
                selectedCheckout.payment.parentPayment.lastWebhook.receivedAt,
              )
            }}
          </span>
          <span
            v-if="
              selectedCheckout.payment.parentPayment.lastWebhook?.payloadSummary
            "
            class="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700"
          >
            Webhook 摘要
            {{
              providerPayloadSummaryLabel(
                selectedCheckout.payment.parentPayment.lastWebhook
                  .payloadSummary,
              )
            }}
          </span>
          <span
            v-if="selectedCheckout.payment.parentPayment.lastReconciliation"
            class="rounded-full bg-teal-50 px-2.5 py-1 text-teal-700"
          >
            最後查單
            {{
              selectedCheckout.payment.parentPayment.lastReconciliation
                .eventId || "-"
            }}
            ·
            {{
              selectedCheckout.payment.parentPayment.lastReconciliation
                .eventType
            }}
            ·
            {{
              webhookStatusLabel(
                selectedCheckout.payment.parentPayment.lastReconciliation
                  .status,
              )
            }}
            ·
            {{
              formatDate(
                selectedCheckout.payment.parentPayment.lastReconciliation
                  .receivedAt,
              )
            }}
          </span>
          <span
            v-if="
              selectedCheckout.payment.parentPayment.lastReconciliation
                ?.payloadSummary
            "
            class="rounded-full bg-teal-50 px-2.5 py-1 text-teal-700"
          >
            查單摘要
            {{
              providerPayloadSummaryLabel(
                selectedCheckout.payment.parentPayment.lastReconciliation
                  .payloadSummary,
              )
            }}
          </span>
          <span
            v-if="selectedCheckout.payment.parentPayment.lastRefund"
            class="rounded-full bg-orange-50 px-2.5 py-1 text-orange-700"
          >
            最後退款
            {{
              selectedCheckout.payment.parentPayment.lastRefund.eventId || "-"
            }}
            ·
            {{ selectedCheckout.payment.parentPayment.lastRefund.eventType }}
            ·
            {{
              webhookStatusLabel(
                selectedCheckout.payment.parentPayment.lastRefund.status,
              )
            }}
            ·
            {{
              formatDate(
                selectedCheckout.payment.parentPayment.lastRefund.receivedAt,
              )
            }}
          </span>
          <span
            v-if="
              selectedCheckout.payment.parentPayment.lastRefund?.payloadSummary
            "
            class="rounded-full bg-orange-50 px-2.5 py-1 text-orange-700"
          >
            退款摘要
            {{
              providerPayloadSummaryLabel(
                selectedCheckout.payment.parentPayment.lastRefund
                  .payloadSummary,
              )
            }}
          </span>
          <span class="rounded-full bg-gray-100 px-2.5 py-1">
            冪等鍵
            {{ selectedCheckout.payment.parentPayment.idempotencyKey }}
          </span>
          <span class="rounded-full bg-gray-100 px-2.5 py-1">
            更新
            {{ formatDate(selectedCheckout.payment.parentPayment.updatedAt) }}
          </span>
        </div>
        <div
          v-if="providerPaymentAlerts.length"
          data-testid="checkout-provider-alerts"
          class="mt-3 space-y-2"
        >
          <div
            v-for="alert in providerPaymentAlerts"
            :key="alert"
            class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800"
          >
            {{ alert }}
          </div>
        </div>
      </div>

      <div
        v-if="selectedCheckout.payment?.settlement"
        data-testid="checkout-settlement"
        class="mt-4 rounded-lg border border-gray-200 p-3"
      >
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <div class="text-sm font-semibold text-gray-900">對帳分配</div>
            <div class="mt-1 text-xs text-gray-500">
              平台費率
              {{
                formatFeeRate(
                  selectedCheckout.payment.settlement.platformFeeRateBps,
                )
              }}
              · 平台費
              {{
                formatCents(
                  selectedCheckout.payment.settlement.platformFeeCents,
                )
              }}
            </div>
          </div>
          <div class="text-sm font-semibold text-gray-900">
            攤位淨收
            {{
              formatCents(
                selectedCheckout.payment.settlement.vendorNetAmountCents,
              )
            }}
          </div>
        </div>
        <div class="mt-3 overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr>
                <th class="whitespace-nowrap py-2 pr-4 font-medium">攤位</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">訂單</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">已收</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">已退</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">平台費</th>
                <th class="whitespace-nowrap pl-4 py-2 font-medium">淨收</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr
                v-for="allocation in selectedCheckout.payment.settlement
                  .vendorAllocations"
                :key="`${allocation.restaurantId}-${allocation.orderId}`"
                class="text-gray-700"
              >
                <td class="min-w-44 py-3 pr-4 font-semibold text-gray-900">
                  {{ allocation.restaurantName }}
                </td>
                <td class="whitespace-nowrap px-4 py-3">
                  {{ allocation.orderNumber }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-emerald-700">
                  {{ formatCents(allocation.grossAmountCents) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-slate-700">
                  {{ formatCents(allocation.refundedAmountCents) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-gray-700">
                  {{ formatCents(allocation.platformFeeCents) }}
                </td>
                <td
                  class="whitespace-nowrap pl-4 py-3 font-semibold text-gray-900"
                >
                  {{ formatCents(allocation.netAmountCents) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div
        v-if="selectedCheckout.payment?.childPayments.length"
        data-testid="checkout-child-payments"
        class="mt-4 rounded-lg border border-gray-200 p-3"
      >
        <div
          class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
        >
          <div>
            <div class="text-sm font-semibold text-gray-900">付款子交易</div>
            <div class="mt-1 text-xs text-gray-500">
              逐攤位付款結果與錯誤訊息，用於重試與人工對帳。
            </div>
          </div>
          <div class="text-sm font-semibold text-gray-900">
            {{ failedChildPaymentCount }} 筆失敗
          </div>
        </div>

        <div class="mt-3 overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="text-xs text-gray-500">
              <tr>
                <th class="whitespace-nowrap py-2 pr-4 font-medium">攤位</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">訂單</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">狀態</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">金額</th>
                <th class="whitespace-nowrap px-4 py-2 font-medium">付款 ID</th>
                <th class="whitespace-nowrap pl-4 py-2 font-medium">錯誤</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr
                v-for="payment in selectedCheckout.payment.childPayments"
                :key="`${payment.restaurantId}-${payment.orderId}`"
                class="text-gray-700"
              >
                <td class="min-w-44 py-3 pr-4 font-semibold text-gray-900">
                  {{ payment.restaurantName }}
                </td>
                <td class="whitespace-nowrap px-4 py-3">
                  {{ payment.orderNumber }} · #{{ payment.orderId }}
                </td>
                <td class="whitespace-nowrap px-4 py-3">
                  <span
                    class="rounded-full px-2.5 py-1 text-xs font-semibold"
                    :class="childPaymentClass(payment.status)"
                  >
                    {{ childPaymentStatusLabel(payment.status) }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-4 py-3">
                  {{ formatPrice(payment.amount) }}
                </td>
                <td class="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                  {{ payment.paymentId || payment.refundId || "-" }}
                </td>
                <td class="min-w-56 pl-4 py-3 text-sm text-red-700">
                  {{ payment.errorMessage || "-" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="mt-4 grid gap-3">
        <article
          v-for="order in selectedCheckout.childOrders"
          :key="`${order.restaurantId}-${order.orderId}`"
          class="rounded-lg border border-gray-200 p-3"
        >
          <div
            class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"
          >
            <div>
              <h3 class="font-semibold text-gray-900">
                {{ order.restaurantName }}
              </h3>
              <p class="mt-1 text-sm text-gray-500">
                {{ order.orderNumber }} · #{{ order.orderId }}
              </p>
            </div>
            <div class="text-sm font-semibold text-gray-900">
              {{ formatPrice(order.totalAmount) }}
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-xs">
            <span
              class="rounded-full bg-blue-50 px-2.5 py-1 font-semibold text-blue-700"
            >
              {{ order.status || "unknown" }}
            </span>
            <span
              class="rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-700"
            >
              {{ order.paymentStatus || "pending" }}
            </span>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  marketCheckoutsService,
  type MarketCheckoutDetail,
  type MarketCheckoutListItem,
  type MarketCheckoutPaymentProviderConnectivityCheck,
  type MarketCheckoutPaymentProviderStatus,
  type MarketCheckoutProviderPayloadSummary,
  type MarketCheckoutPaymentStatus,
  type MarketCheckoutOperationAlertType,
  type MarketCheckoutSummary,
  type MarketCheckoutVendorSettlement,
} from "@/services/marketCheckoutsService";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useDateFormatter } from "@/composables/useDateFormatter";

const { locale } = useI18n();
const { formatPrice } = useCurrency();
const { formatShortDateTime } = useDateFormatter();

const checkouts = ref<MarketCheckoutListItem[]>([]);
const selectedCheckout = ref<MarketCheckoutDetail | null>(null);
const summary = ref<MarketCheckoutSummary | null>(null);
const vendorSettlements = ref<MarketCheckoutVendorSettlement[]>([]);
const providerStatus = ref<MarketCheckoutPaymentProviderStatus | null>(null);
const providerConnectivityCheck =
  ref<MarketCheckoutPaymentProviderConnectivityCheck | null>(null);
const isLoading = ref(false);
const isRefunding = ref(false);
const isReconciling = ref(false);
const isCheckingProvider = ref(false);
const isExporting = ref(false);
const isExportingVendors = ref(false);
const isExportingAccounting = ref(false);
const error = ref<string | null>(null);
const marketSlug = ref("");
const paymentStatus = ref<MarketCheckoutPaymentStatus | "">("");
const operationAlert = ref<MarketCheckoutOperationAlertType | "">("");
const dateFrom = ref("");
const dateTo = ref("");

const canRefundSelectedCheckout = computed(() => {
  const status = selectedCheckout.value?.payment?.status;
  return status === "paid" || status === "partial_paid";
});

const canReconcileSelectedCheckout = computed(() => {
  const parentPayment = selectedCheckout.value?.payment?.parentPayment;
  return (
    parentPayment?.splitMode === "provider_split" &&
    parentPayment.status === "pending"
  );
});

const summaryMetrics = computed(() => {
  if (!summary.value) return [];
  const failedCount = summary.value.paymentStatusCounts.failed ?? 0;
  const partialCount = summary.value.paymentStatusCounts.partial_paid ?? 0;
  return [
    { label: "Checkout", value: String(summary.value.totalCheckouts) },
    { label: "GMV", value: formatCents(summary.value.totalSubtotalCents) },
    { label: "已收", value: formatCents(summary.value.paidAmountCents) },
    { label: "已退", value: formatCents(summary.value.refundedAmountCents) },
    { label: "淨收", value: formatCents(summary.value.netPaidAmountCents) },
    {
      label: "異常",
      value: String(failedCount + partialCount),
    },
  ];
});

const failedChildPaymentCount = computed(
  () =>
    selectedCheckout.value?.payment?.childPayments.filter(
      (payment) => payment.status === "failed",
    ).length ?? 0,
);

const providerStatusClass = computed(() => {
  if (!providerStatus.value) return "border-gray-200 bg-white";
  return {
    ready: "border-emerald-200 bg-emerald-50",
    warning: "border-amber-200 bg-amber-50",
    not_configured: "border-red-200 bg-red-50",
  }[providerStatus.value.readiness];
});

const providerConfigurationChecks = computed(() => {
  if (!providerStatus.value) return [];
  return [
    {
      label: "Provider gateway URL",
      configured: providerStatus.value.providerSplitUrlConfigured,
    },
    {
      label: "Webhook 驗簽 secret",
      configured: providerStatus.value.providerWebhookSecretConfigured,
    },
    {
      label: "Provider status lookup URL",
      configured: providerStatus.value.providerStatusUrlConfigured,
    },
    {
      label: "Provider refund URL",
      configured: providerStatus.value.providerRefundUrlConfigured,
    },
    {
      label: "Request signing secret",
      configured: providerStatus.value.providerSplitSigningConfigured,
    },
    {
      label: "Health check URL",
      configured: providerStatus.value.providerSplitHealthUrlConfigured,
    },
  ];
});

const providerStatusPillClass = computed(() => {
  if (!providerStatus.value) return "bg-gray-100 text-gray-700";
  return {
    ready: "bg-emerald-100 text-emerald-800",
    warning: "bg-amber-100 text-amber-800",
    not_configured: "bg-red-100 text-red-800",
  }[providerStatus.value.readiness];
});

const providerConnectivityResultClass = computed(() => {
  if (!providerConnectivityCheck.value) return "text-gray-700";
  return {
    passed: "text-emerald-700",
    skipped: "text-amber-700",
    failed: "text-red-700",
  }[providerConnectivityCheck.value.status];
});

const providerPaymentAlerts = computed(() => {
  const parentPayment = selectedCheckout.value?.payment?.parentPayment;
  if (!parentPayment) return [];

  const alerts: string[] = [];
  if (
    parentPayment.splitMode === "provider_split" &&
    parentPayment.status === "pending"
  ) {
    const updatedAtMs = Date.parse(parentPayment.updatedAt);
    if (
      Number.isFinite(updatedAtMs) &&
      Date.now() - updatedAtMs > 30 * 60 * 1000
    ) {
      alerts.push("Provider 付款仍待處理超過 30 分鐘");
    }
    if (!parentPayment.lastWebhook) {
      alerts.push("尚未收到 provider webhook");
    }
  }

  if (parentPayment.lastWebhook?.status === "failed") {
    alerts.push("最後 webhook 回報付款失敗");
  }
  if (
    parentPayment.status === "pending" &&
    parentPayment.lastWebhook?.status === "paid"
  ) {
    alerts.push("最後 webhook 已付款，但父層付款仍待處理");
  }
  if (parentPayment.lastRefund?.status === "pending") {
    alerts.push("Provider 退款仍在處理中");
  }
  if (parentPayment.lastRefund?.status === "failed") {
    alerts.push("Provider 退款失敗");
  }

  return alerts;
});

async function loadCheckouts() {
  isLoading.value = true;
  error.value = null;
  try {
    const filters = currentFilters();
    const aggregateFilters = currentAggregateFilters();
    const [result, nextSummary, vendorSummary, nextProviderStatus] =
      await Promise.all([
        marketCheckoutsService.list({
          page: 1,
          limit: 20,
          ...filters,
        }),
        marketCheckoutsService.summary(aggregateFilters),
        marketCheckoutsService.vendors(aggregateFilters),
        marketCheckoutsService.providerStatus(),
      ]);
    checkouts.value = result.checkouts;
    summary.value = nextSummary;
    vendorSettlements.value = vendorSummary.vendors;
    providerStatus.value = nextProviderStatus;
  } catch (loadError) {
    error.value =
      loadError instanceof Error ? loadError.message : "市場結帳讀取失敗";
  } finally {
    isLoading.value = false;
  }
}

async function openCheckout(id: string) {
  selectedCheckout.value = await marketCheckoutsService.get(id);
}

async function refundSelectedCheckout() {
  if (!selectedCheckout.value || !canRefundSelectedCheckout.value) return;
  if (!window.confirm("確定要退款這筆市場結帳嗎？")) return;

  isRefunding.value = true;
  error.value = null;
  try {
    selectedCheckout.value = await marketCheckoutsService.refund(
      selectedCheckout.value.id,
      "admin_market_checkout_refund",
    );
    await loadCheckouts();
  } catch (refundError) {
    error.value =
      refundError instanceof Error ? refundError.message : "市場結帳退款失敗";
  } finally {
    isRefunding.value = false;
  }
}

async function reconcileSelectedCheckout() {
  if (!selectedCheckout.value || !canReconcileSelectedCheckout.value) return;

  isReconciling.value = true;
  error.value = null;
  try {
    const checkoutId = selectedCheckout.value.id;
    await marketCheckoutsService.reconcile(checkoutId);
    selectedCheckout.value = await marketCheckoutsService.get(checkoutId);
    await loadCheckouts();
  } catch (reconcileError) {
    error.value =
      reconcileError instanceof Error
        ? reconcileError.message
        : "Provider 狀態查詢失敗";
  } finally {
    isReconciling.value = false;
  }
}

async function checkProviderConnectivity() {
  isCheckingProvider.value = true;
  error.value = null;
  try {
    providerConnectivityCheck.value =
      await marketCheckoutsService.checkProviderConnectivity();
  } catch (checkError) {
    error.value =
      checkError instanceof Error
        ? checkError.message
        : "Provider 連線檢查失敗";
  } finally {
    isCheckingProvider.value = false;
  }
}

async function exportCheckouts() {
  isExporting.value = true;
  error.value = null;
  try {
    const blob = await marketCheckoutsService.exportCsv(currentFilters());
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `market-checkouts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (exportError) {
    error.value =
      exportError instanceof Error ? exportError.message : "市場結帳匯出失敗";
  } finally {
    isExporting.value = false;
  }
}

async function exportVendorSettlements() {
  isExportingVendors.value = true;
  error.value = null;
  try {
    const blob = await marketCheckoutsService.exportVendorsCsv(
      currentAggregateFilters(),
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `market-checkout-vendors-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (exportError) {
    error.value =
      exportError instanceof Error ? exportError.message : "攤位對帳匯出失敗";
  } finally {
    isExportingVendors.value = false;
  }
}

async function exportAccountingLedger() {
  isExportingAccounting.value = true;
  error.value = null;
  try {
    const blob = await marketCheckoutsService.exportAccountingCsv(
      currentAggregateFilters(),
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `market-checkout-accounting-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (exportError) {
    error.value =
      exportError instanceof Error ? exportError.message : "會計分錄匯出失敗";
  } finally {
    isExportingAccounting.value = false;
  }
}

function currentFilters() {
  return {
    marketSlug: marketSlug.value.trim(),
    paymentStatus: paymentStatus.value,
    operationAlert: operationAlert.value,
    dateFrom: dateFrom.value.trim(),
    dateTo: dateTo.value.trim(),
  };
}

function currentAggregateFilters() {
  return {
    marketSlug: marketSlug.value.trim(),
    paymentStatus: paymentStatus.value,
    dateFrom: dateFrom.value.trim(),
    dateTo: dateTo.value.trim(),
  };
}

function paymentStatusLabel(status: MarketCheckoutPaymentStatus) {
  const labels: Record<MarketCheckoutPaymentStatus, string> = {
    pending: "待付款",
    partial_paid: "部分付款",
    paid: "已付款",
    failed: "付款失敗",
    refunded: "已退款",
    partial_refunded: "部分退款",
  };
  return labels[status];
}

function webhookStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "待付款",
    partial_paid: "部分付款",
    paid: "已付款",
    failed: "付款失敗",
    refunded: "已退款",
    partial_refunded: "部分退款",
    review_required: "金額不符待審",
  };
  return labels[status] ?? status;
}

function providerPayloadSummaryLabel(
  summary: MarketCheckoutProviderPayloadSummary,
) {
  const identity = summary.objectId ?? summary.providerTransactionId;
  const amountCents =
    summary.amountReceivedCents ??
    summary.amountCents ??
    summary.amountRefundedCents;
  const amount =
    amountCents === undefined
      ? undefined
      : `${summary.currency ?? ""} ${formatProviderAmountCents(amountCents)}`.trim();
  return [
    [identity, summary.status, amount].filter(Boolean).join(" · "),
    [summary.failureCode, summary.failureReason].filter(Boolean).join(" · "),
    summary.metadataKeys?.length
      ? `metadata: ${[...summary.metadataKeys].sort().join(", ")}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatProviderAmountCents(value: number) {
  // Plain grouped number, not money — the provider currency is rendered
  // separately by the caller, so this must not carry a currency symbol.
  return new Intl.NumberFormat(locale.value, {
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function paymentClass(status: MarketCheckoutPaymentStatus) {
  return {
    pending: "bg-gray-100 text-gray-700",
    // partial_paid was amber and partial_refunded orange -- the same colour
    // here, since amber resolves to orange. Money coming in reads as a lighter
    // step of the success hue; money going back out stays on orange.
    partial_paid: "bg-green-50 text-green-700",
    paid: "bg-green-100 text-green-800",
    failed: "bg-red-50 text-red-700",
    refunded: "bg-slate-100 text-slate-700",
    partial_refunded: "bg-orange-50 text-orange-700",
  }[status];
}

function operationAlertClass(severity: "warning" | "critical") {
  return {
    warning: "bg-amber-50 text-amber-700",
    critical: "bg-red-50 text-red-700",
  }[severity];
}

function splitModeLabel(mode: "child_transactions" | "provider_split") {
  return {
    child_transactions: "子交易編排",
    provider_split: "付款商拆帳",
  }[mode];
}

function formatUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function providerReadinessLabel(
  readiness: MarketCheckoutPaymentProviderStatus["readiness"],
) {
  return {
    ready: "可用",
    warning: "需注意",
    not_configured: "未設定",
  }[readiness];
}

function providerModeLabel(
  mode: MarketCheckoutPaymentProviderStatus["splitMode"],
) {
  return {
    child_transactions: "子訂單逐筆付款",
    provider_split: "Provider 統一授權拆帳",
  }[mode];
}

function providerKindLabel(
  providerKind: MarketCheckoutPaymentProviderStatus["providerKind"],
) {
  return {
    internal_child_transactions: "內部付款服務",
    http_provider_split: "HTTP Provider Gateway",
  }[providerKind];
}

function providerConnectivityStatusLabel(
  status: MarketCheckoutPaymentProviderConnectivityCheck["status"],
) {
  return {
    passed: "連線通過",
    skipped: "未檢查",
    failed: "連線失敗",
  }[status];
}

function childPaymentStatusLabel(status: "paid" | "failed" | "refunded") {
  return {
    paid: "已付款",
    failed: "付款失敗",
    refunded: "已退款",
  }[status];
}

function childPaymentClass(status: "paid" | "failed" | "refunded") {
  return {
    paid: "bg-emerald-50 text-emerald-700",
    failed: "bg-red-50 text-red-700",
    refunded: "bg-slate-100 text-slate-700",
  }[status];
}

function formatCents(value: number) {
  return formatPrice(value / 100);
}

function formatFeeRate(value: number) {
  return `${(value / 100).toFixed(2)}%`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatShortDateTime(date);
}

onMounted(loadCheckouts);
</script>
