<template>
  <div class="settings-view">
    <!-- 頁面標題 -->
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">
          {{ t("settings.title") }}
        </h1>
        <p class="text-gray-600">{{ t("settings.subtitle") }}</p>
      </div>
      <div class="flex items-center space-x-3">
        <button
          class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
          data-testid="settings-reset"
          @click="resetToDefaults"
        >
          {{ t("settings.resetDefaults") }}
        </button>
        <button
          class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          data-testid="settings-save"
          @click="saveSettings"
        >
          {{ t("settings.saveSettings") }}
        </button>
      </div>
    </div>

    <!-- 設定分頁 -->
    <div class="mb-8">
      <nav class="flex space-x-8">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="[
            'py-2 px-1 border-b-2 font-medium text-sm',
            activeTab === tab.id
              ? 'border-blue-500 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
          ]"
          :data-active="activeTab === tab.id"
          :data-testid="`settings-tab-${tab.id}`"
          @click="activeTab = tab.id"
        >
          {{ tab.name }}
        </button>
      </nav>
    </div>

    <!-- 基本設定 -->
    <div v-show="activeTab === 'general'" class="space-y-8">
      <!-- 餐廳資訊 -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("settings.general.restaurantInfo") }}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.general.restaurantName")
            }}</label>
            <input
              v-model="settings.restaurant.name"
              type="text"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.general.contactPhone")
            }}</label>
            <input
              v-model="settings.restaurant.phone"
              type="tel"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.general.restaurantAddress")
            }}</label>
            <textarea
              v-model="settings.restaurant.address"
              rows="3"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.general.businessHours")
            }}</label>
            <div class="flex items-center space-x-2">
              <input
                v-model="settings.restaurant.openTime"
                type="time"
                class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <span class="text-gray-500">{{ t("settings.general.to") }}</span>
              <input
                v-model="settings.restaurant.closeTime"
                type="time"
                class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.general.timezone")
            }}</label>
            <!-- Honoured again as of #329: the choice here is stored on
                 `restaurants.timezone` and every business-day bucket derives
                 its SQL offset from it. Only fixed-offset zones are listed --
                 SQLite takes a constant date modifier, so a zone whose offset
                 moves twice a year would bucket half its year into the wrong
                 day, which is why the two US entries are gone. -->
            <select
              v-model="settings.restaurant.timezone"
              data-testid="settings-timezone"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="Asia/Taipei">
                {{ t("settings.general.timezones.taiwan") }}
              </option>
              <option value="Asia/Kuala_Lumpur">
                {{ t("settings.general.timezones.malaysia") }}
              </option>
              <option value="Asia/Singapore">
                {{ t("settings.general.timezones.singapore") }}
              </option>
              <option value="Asia/Shanghai">
                {{ t("settings.general.timezones.china") }}
              </option>
              <option value="Asia/Tokyo">
                {{ t("settings.general.timezones.japan") }}
              </option>
              <option value="Asia/Ho_Chi_Minh">
                {{ t("settings.general.timezones.vietnam") }}
              </option>
              <option value="Asia/Jakarta">
                {{ t("settings.general.timezones.indonesia") }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <!-- 系統偏好 -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("settings.general.systemPreferences") }}
        </h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.general.language")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.general.languageDesc") }}
              </p>
            </div>
            <select
              v-model="settings.system.language"
              class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="zh-TW">繁體中文</option>
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
              <option value="ja-JP">日本語</option>
              <option value="vi-VN">Tiếng Việt</option>
              <option value="id-ID">Bahasa Indonesia</option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.general.currency")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.general.currencyDesc") }}
              </p>
            </div>
            <select
              v-model="settings.system.currency"
              class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="MYR">
                {{ t("settings.general.currencies.myr") }}
              </option>
              <option value="TWD">
                {{ t("settings.general.currencies.twd") }}
              </option>
            </select>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.general.autoLogout")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.general.autoLogoutDesc") }}
              </p>
            </div>
            <select
              v-model.number="settings.system.autoLogoutMinutes"
              class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="30">{{ t("settings.general.minutes30") }}</option>
              <option value="60">{{ t("settings.general.hour1") }}</option>
              <option value="120">{{ t("settings.general.hours2") }}</option>
              <option value="240">{{ t("settings.general.hours4") }}</option>
              <option value="0">{{ t("settings.general.neverLogout") }}</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- 市場 / 商圈 -->
    <div v-show="activeTab === 'markets'" class="space-y-8">
      <div class="bg-white rounded-lg shadow p-6">
        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("settings.markets.readinessTitle") }}
            </h3>
            <p class="mt-1 text-sm text-gray-500">
              {{ t("settings.markets.readinessSubtitle") }}
            </p>
          </div>
          <div class="text-left sm:text-right">
            <div class="text-2xl font-semibold text-gray-900">
              {{ marketplaceReadiness.score }}%
            </div>
            <div
              class="text-sm"
              :class="
                marketplaceReadiness.ready ? 'text-green-700' : 'text-amber-700'
              "
            >
              {{
                marketplaceReadiness.ready
                  ? t("settings.markets.ready")
                  : t("settings.markets.notReady")
              }}
            </div>
          </div>
        </div>

        <div class="mt-5 grid gap-3 md:grid-cols-2">
          <div
            v-for="issue in marketplaceReadinessItems"
            :key="issue.key"
            class="rounded-lg border px-4 py-3"
            :class="
              issue.done
                ? 'border-green-200 bg-green-50'
                : issue.severity === 'required'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-gray-200 bg-gray-50'
            "
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="font-medium text-gray-900">
                  {{ t(`settings.markets.readiness.${issue.key}.title`) }}
                </div>
                <p class="mt-1 text-sm text-gray-600">
                  {{ t(`settings.markets.readiness.${issue.key}.description`) }}
                </p>
              </div>
              <span
                class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                :class="
                  issue.done
                    ? 'bg-green-100 text-green-700'
                    : issue.severity === 'required'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-gray-200 text-gray-700'
                "
              >
                {{
                  issue.done
                    ? t("settings.markets.completed")
                    : issue.severity === "required"
                      ? t("settings.markets.required")
                      : t("settings.markets.recommended")
                }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <div
          class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("settings.markets.title") }}
            </h3>
            <p class="mt-1 text-sm text-gray-500">
              {{ t("settings.markets.subtitle") }}
            </p>
          </div>
          <button
            type="button"
            class="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            :disabled="isLoadingMarkets"
            @click="loadMarketSettings"
          >
            {{ t("settings.markets.refresh") }}
          </button>
        </div>

        <div class="mt-6">
          <div v-if="isLoadingMarkets" class="py-8 text-sm text-gray-500">
            {{ t("settings.markets.loading") }}
          </div>
          <div
            v-else-if="marketMemberships.length === 0"
            class="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500"
          >
            {{ t("settings.markets.empty") }}
          </div>
          <div v-else class="overflow-hidden rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    {{ t("settings.markets.market") }}
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    {{ t("settings.markets.area") }}
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    {{ t("settings.markets.stall") }}
                  </th>
                  <th
                    class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    {{ t("settings.markets.primary") }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 bg-white">
                <tr
                  v-for="membership in marketMemberships"
                  :key="membership.id"
                >
                  <td class="px-4 py-3">
                    <div class="font-medium text-gray-900">
                      {{ membership.market.name }}
                    </div>
                    <div class="text-xs text-gray-500">
                      /{{ membership.market.slug }}
                    </div>
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-700">
                    {{ membership.market.city }} ·
                    {{ membership.market.district }}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-700">
                    {{
                      formatMarketMembershipLocation(
                        membership,
                        t("settings.markets.notSet"),
                      )
                    }}
                  </td>
                  <td class="px-4 py-3 text-sm text-gray-700">
                    {{
                      membership.isPrimary
                        ? t("settings.markets.yes")
                        : t("settings.markets.no")
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t("settings.markets.requestsTitle") }}
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("settings.markets.requestsSubtitle") }}
        </p>

        <div class="mt-6">
          <div v-if="isLoadingMarkets" class="py-8 text-sm text-gray-500">
            {{ t("settings.markets.loading") }}
          </div>
          <div
            v-else-if="marketJoinRequests.length === 0"
            class="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500"
          >
            {{ t("settings.markets.noRequests") }}
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="request in marketJoinRequests"
              :key="request.id"
              class="rounded-lg border border-gray-200 p-4"
            >
              <div
                class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div>
                  <div class="font-medium text-gray-900">
                    {{ request.market.name }}
                  </div>
                  <div class="mt-1 text-sm text-gray-500">
                    {{ request.market.city }} · {{ request.market.district }}
                  </div>
                  <p
                    v-if="request.message"
                    class="mt-2 text-sm leading-6 text-gray-600"
                  >
                    {{ request.message }}
                  </p>
                </div>
                <span
                  class="inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium"
                  :class="marketJoinRequestStatusClass(request.status)"
                >
                  {{ t(`settings.markets.requestStatus.${request.status}`) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t("settings.markets.requestTitle") }}
        </h3>
        <p class="mt-1 text-sm text-gray-500">
          {{ t("settings.markets.requestSubtitle") }}
        </p>

        <div class="mt-5 grid gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("settings.markets.selectMarket") }}
            </label>
            <input
              v-model="marketJoinSearchQuery"
              type="search"
              data-testid="market-join-search"
              class="mb-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              :placeholder="t('settings.markets.searchPlaceholder')"
            />
            <select
              v-model="marketJoinForm.marketId"
              data-testid="market-join-select"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">
                {{ t("settings.markets.selectPlaceholder") }}
              </option>
              <option
                v-for="market in joinableMarketOptions"
                :key="market.id"
                :value="market.id"
              >
                {{ market.name }} · {{ market.city }} {{ market.district }}
              </option>
            </select>
            <p
              v-if="joinableMarketOptions.length === 0"
              data-testid="market-join-empty-options"
              class="mt-2 text-sm text-gray-500"
            >
              {{ t("settings.markets.noMatchingMarkets") }}
            </p>
            <div
              v-if="selectedMarketReadiness"
              class="mt-3 rounded-lg border p-3 text-sm"
              :class="
                selectedMarketReadiness.ready
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              "
            >
              <div class="flex items-center justify-between gap-3">
                <span class="font-medium">
                  {{ selectedMarketReadinessSummary.text }}
                </span>
                <span class="text-xs">
                  {{ selectedMarketReadiness.completedCount }}/{{
                    selectedMarketReadiness.totalCount
                  }}
                </span>
              </div>
              <div
                v-if="selectedMarketReadiness.issues.length > 0"
                class="mt-2 flex flex-wrap gap-2"
              >
                <span
                  v-for="issue in selectedMarketReadiness.issues"
                  :key="issue.key"
                  class="rounded-full bg-white/80 px-2 py-0.5 text-xs"
                >
                  {{ publicReadinessIssueLabel(issue.key) }}
                </span>
              </div>
              <div class="mt-2 flex flex-wrap gap-3 text-xs">
                <span>
                  商品
                  {{
                    selectedMarket?.catalogCoverage?.searchableProductCount ?? 0
                  }}
                </span>
                <span>
                  服務
                  {{ selectedMarket?.catalogCoverage?.publicServiceCount ?? 0 }}
                </span>
              </div>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("settings.markets.message") }}
            </label>
            <textarea
              v-model="marketJoinForm.message"
              data-testid="market-join-message"
              rows="3"
              maxlength="500"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              :placeholder="t('settings.markets.messagePlaceholder')"
            />
          </div>
          <div class="flex justify-end">
            <button
              type="button"
              data-testid="market-join-submit"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isSubmittingMarketRequest || !marketJoinForm.marketId"
              @click="submitMarketJoinRequest"
            >
              {{
                isSubmittingMarketRequest
                  ? t("settings.markets.submitting")
                  : t("settings.markets.submit")
              }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 聯絡與 FAQ -->
    <div v-show="activeTab === 'contact'" class="space-y-8">
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("settings.contact.title") }}
            </h3>
            <p class="mt-1 text-sm text-gray-500">
              {{ t("settings.contact.subtitle") }}
            </p>
          </div>
          <button
            type="button"
            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            :disabled="isSavingContactProfile"
            @click="saveContactProfile"
          >
            {{
              isSavingContactProfile
                ? t("settings.contact.saving")
                : t("settings.contact.save")
            }}
          </button>
        </div>

        <div v-if="isLoadingContactProfile" class="mt-6 text-sm text-gray-500">
          {{ t("settings.contact.loading") }}
        </div>
        <div v-else class="mt-6 space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-for="channel in contactChannelFields" :key="channel.key">
              <label class="block text-sm font-medium text-gray-700 mb-2">
                {{ channel.label }}
              </label>
              <input
                v-model="contactProfile.messagingChannels[channel.key]"
                type="url"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                :placeholder="channel.placeholder"
              />
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between gap-3">
              <h4 class="font-medium text-gray-900">
                {{ t("settings.contact.faqTitle") }}
              </h4>
              <button
                type="button"
                class="px-3 py-2 text-sm text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                @click="addContactFaq"
              >
                {{ t("settings.contact.addFaq") }}
              </button>
            </div>

            <div
              v-if="contactProfile.faqs.length === 0"
              class="mt-4 rounded-lg border border-dashed border-gray-300 p-5 text-sm text-gray-500"
            >
              {{ t("settings.contact.emptyFaq") }}
            </div>
            <div v-else class="mt-4 space-y-4">
              <div
                v-for="(faq, index) in contactProfile.faqs"
                :key="faq.localId"
                class="rounded-lg border border-gray-200 p-4"
              >
                <div class="flex justify-end">
                  <button
                    type="button"
                    class="text-sm text-red-600 hover:text-red-700"
                    @click="removeContactFaq(index)"
                  >
                    {{ t("settings.contact.removeFaq") }}
                  </button>
                </div>
                <div class="mt-3 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div class="md:col-span-3">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      {{ t("settings.contact.question") }}
                    </label>
                    <input
                      v-model="faq.question"
                      type="text"
                      maxlength="200"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      {{ t("settings.contact.displayOrder") }}
                    </label>
                    <input
                      v-model.number="faq.displayOrder"
                      type="number"
                      min="0"
                      max="1000"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div class="md:col-span-4">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      {{ t("settings.contact.answer") }}
                    </label>
                    <textarea
                      v-model="faq.answer"
                      rows="3"
                      maxlength="1000"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div class="md:col-span-3">
                    <label class="block text-sm font-medium text-gray-700 mb-2">
                      {{ t("settings.contact.keywords") }}
                    </label>
                    <input
                      v-model="faq.keywordsText"
                      type="text"
                      class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      :placeholder="t('settings.contact.keywordsPlaceholder')"
                    />
                  </div>
                  <label class="flex items-center gap-2 pt-7 text-sm">
                    <input
                      v-model="faq.isActive"
                      type="checkbox"
                      class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    {{ t("settings.contact.active") }}
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        ref="serviceItemsSection"
        data-testid="settings-service-items-section"
        class="space-y-6"
      >
        <RestaurantServiceItemsManager
          :restaurant-id="authStore.restaurantId"
          :is-market-service-gap-context="isMarketServiceGapContext"
          :market-gap-name="marketServiceGapName"
          :market-gap-slug="marketServiceGapSlug"
          :market-gap-area-city="marketServiceGapAreaCity"
          :market-gap-area-district="marketServiceGapAreaDistrict"
        />
        <ServiceBookingSlotsManager :restaurant-id="authStore.restaurantId" />
      </div>
    </div>

    <!-- 訂單設定 -->
    <div v-show="activeTab === 'orders'" class="space-y-8">
      <!-- 訂單流程 -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("settings.orders.title") }}
        </h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.orders.acceptGuestOrders")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.orders.acceptGuestOrdersDesc") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="settings.orders.acceptGuestOrders"
                type="checkbox"
                class="sr-only peer"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              />
            </label>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.orders.autoConfirm")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.orders.autoConfirmDesc") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="settings.orders.autoConfirm"
                type="checkbox"
                class="sr-only peer"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              />
            </label>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.orders.prepTimeAlert")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.orders.prepTimeAlertDesc") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="settings.orders.preparationTimeAlert"
                type="checkbox"
                class="sr-only peer"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              />
            </label>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.orders.defaultPrepTime")
            }}</label>
            <input
              v-model.number="settings.orders.defaultPreparationTime"
              type="number"
              min="5"
              max="60"
              class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <!-- 最低消費設定 -->
          <div class="border-t border-gray-200 pt-4">
            <div class="flex items-center justify-between mb-4">
              <div>
                <label class="text-sm font-medium text-gray-900">{{
                  t("settings.orders.enableMinOrder")
                }}</label>
                <p class="text-sm text-gray-500">
                  {{ t("settings.orders.enableMinOrderDesc") }}
                </p>
              </div>
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  v-model="settings.orders.minimumOrderEnabled"
                  type="checkbox"
                  class="sr-only peer"
                />
                <div
                  class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
                />
              </label>
            </div>

            <div v-if="settings.orders.minimumOrderEnabled" class="space-y-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                  {{ t("settings.orders.minOrderAmount") }} ({{
                    settings.system.currency
                  }})
                </label>
                <div class="flex items-center space-x-2">
                  <span class="text-gray-500">RM</span>
                  <input
                    v-model.number="settings.orders.minimumOrderAmount"
                    type="number"
                    min="0"
                    step="0.50"
                    max="500"
                    class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="0.00"
                  />
                </div>
                <p class="text-xs text-gray-500 mt-1">
                  {{ t("settings.orders.minOrderHint") }}
                </p>
              </div>

              <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div class="flex items-start space-x-2">
                  <svg
                    class="w-5 h-5 text-blue-600 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p class="text-sm font-medium text-blue-800">
                      {{ t("settings.orders.reminder") }}
                    </p>
                    <p class="text-sm text-blue-700">
                      {{ t("settings.orders.minOrderWarning") }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                {{ t("settings.orders.taxRate") }}
              </label>
              <div class="flex items-center space-x-2">
                <input
                  v-model.number="settings.orders.taxRatePercent"
                  data-testid="settings-tax-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  class="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0"
                />
                <span class="text-gray-500">%</span>
              </div>
              <p class="text-xs text-gray-500 mt-1">
                {{ t("settings.orders.taxRateHint") }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">
                {{ t("settings.orders.serviceChargeRate") }}
              </label>
              <div class="flex items-center space-x-2">
                <input
                  v-model.number="settings.orders.serviceChargeRatePercent"
                  data-testid="settings-service-charge-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  class="w-28 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="0"
                />
                <span class="text-gray-500">%</span>
              </div>
              <p class="text-xs text-gray-500 mt-1">
                {{ t("settings.orders.serviceChargeHint") }}
              </p>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.orders.retentionDays")
            }}</label>
            <select
              v-model.number="settings.orders.retentionDays"
              class="w-48 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="30">30 {{ t("settings.days") }}</option>
              <option value="90">90 {{ t("settings.days") }}</option>
              <option value="180">180 {{ t("settings.days") }}</option>
              <option value="365">1 {{ t("settings.year") }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 外帶/外送設定 -->
      <div class="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 class="text-lg font-bold text-gray-900 mb-1">
          {{ t("settings.delivery.title") }}
        </h3>
        <p class="text-sm text-gray-500 mb-4">
          {{ t("settings.delivery.subtitle") }}
        </p>

        <!-- Enable Dine-in -->
        <div
          class="flex items-center justify-between p-3 bg-gray-50 rounded-lg mb-2"
        >
          <div>
            <div class="font-semibold text-sm">
              🍽️ {{ t("settings.delivery.enableDineIn") }}
            </div>
            <div class="text-xs text-gray-500">
              {{ t("settings.delivery.enableDineInDesc") }}
            </div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="deliverySettings.enableDineIn"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"
            ></div>
          </label>
        </div>

        <!-- Enable Takeaway -->
        <div
          class="flex items-center justify-between p-3 bg-gray-50 rounded-lg mb-2"
        >
          <div>
            <div class="font-semibold text-sm">
              🛍️ {{ t("settings.delivery.enableTakeaway") }}
            </div>
            <div class="text-xs text-gray-500">
              {{ t("settings.delivery.enableTakeawayDesc") }}
            </div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="deliverySettings.enableTakeaway"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"
            ></div>
          </label>
        </div>

        <!-- Enable Delivery -->
        <div
          class="flex items-center justify-between p-3 bg-gray-50 rounded-lg mb-4"
        >
          <div>
            <div class="font-semibold text-sm">
              🛵 {{ t("settings.delivery.enableDelivery") }}
            </div>
            <div class="text-xs text-gray-500">
              {{ t("settings.delivery.enableDeliveryDesc") }}
            </div>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="deliverySettings.enableDelivery"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"
            ></div>
          </label>
        </div>

        <!-- Delivery Fee -->
        <div class="border border-gray-200 rounded-lg p-3 mb-3">
          <label class="block font-semibold text-sm mb-2">{{
            t("settings.delivery.deliveryFee")
          }}</label>
          <div class="flex items-center gap-2">
            <span class="text-gray-500 text-sm">NT$</span>
            <input
              v-model.number="deliverySettings.deliveryFee"
              type="number"
              min="0"
              step="10"
              class="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <p class="text-xs text-gray-400 mt-1">
            {{ t("settings.delivery.freeDeliveryHint") }}
          </p>
        </div>

        <!-- Estimated Prep Time -->
        <div class="border border-gray-200 rounded-lg p-3">
          <label class="block font-semibold text-sm mb-2">{{
            t("settings.delivery.estimatedPrepTime")
          }}</label>
          <div class="flex items-center gap-2">
            <input
              v-model.number="deliverySettings.estimatedPrepTimeMin"
              type="number"
              min="1"
              max="120"
              class="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span class="text-gray-500">~</span>
            <input
              v-model.number="deliverySettings.estimatedPrepTimeMax"
              type="number"
              min="1"
              max="120"
              class="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span class="text-gray-500 text-sm">{{
              t("settings.minutes")
            }}</span>
          </div>
        </div>
      </div>

      <!-- 桌台設定 -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("settings.tables.title") }}
        </h3>
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.tables.prefix")
            }}</label>
            <input
              v-model="settings.tables.prefix"
              type="text"
              maxlength="5"
              class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="T"
            />
          </div>

          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.tables.autoClean")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.tables.autoCleanDesc") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="settings.tables.autoClean"
                type="checkbox"
                class="sr-only peer"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              />
            </label>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.tables.cleanDelay")
            }}</label>
            <input
              v-model.number="settings.tables.cleanDelay"
              type="number"
              min="0"
              max="30"
              class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- QR Code 設定 -->
    <div v-show="activeTab === 'qrcode'" class="space-y-8">
      <!-- 店家模式設定 -->
      <div class="bg-white rounded-lg shadow p-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t("settings.qrcode.shopTitle") }}
            </h3>
            <p class="text-sm text-gray-500 mt-1">
              {{ t("settings.qrcode.shopDesc") }}
            </p>
          </div>
        </div>

        <!-- 啟用店家模式 -->
        <div class="border-b border-gray-200 pb-4 mb-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.qrcode.enableShopMode")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.qrcode.enableShopModeDesc") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="shopQR.enabled"
                type="checkbox"
                class="sr-only peer"
                @change="handleToggleShopMode"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              />
            </label>
          </div>
        </div>

        <!-- 店家設定 -->
        <div v-if="shopQR.enabled" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("settings.qrcode.displayName") }}
            </label>
            <input
              v-model="shopQR.settings.displayName"
              type="text"
              maxlength="50"
              :placeholder="t('settings.qrcode.displayNameExample')"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p class="text-xs text-gray-500 mt-1">
              {{ t("settings.qrcode.displayNameHint") }}
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ t("settings.qrcode.instructions") }}
            </label>
            <textarea
              v-model="shopQR.settings.instructions"
              rows="2"
              maxlength="100"
              :placeholder="t('settings.qrcode.instructionsExample')"
              class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p class="text-xs text-gray-500 mt-1">
              {{ t("settings.qrcode.instructionsHint") }}
            </p>
          </div>

          <!-- 儲存設定按鈕 -->
          <div class="flex justify-end pt-4">
            <button
              :disabled="isSavingShopSettings"
              class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              @click="saveShopSettings"
            >
              <span v-if="!isSavingShopSettings">{{
                t("settings.qrcode.saveSettings")
              }}</span>
              <span v-else class="flex items-center">
                <svg
                  class="animate-spin h-4 w-4 mr-2"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                {{ t("settings.qrcode.saving") }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- QR Code 管理 -->
      <div v-if="shopQR.enabled" class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("settings.qrcode.management") }}
        </h3>

        <!-- 沒有 QR Code 時 -->
        <div v-if="!shopQR.qrCode" class="text-center py-8">
          <div
            class="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"
          >
            <svg
              class="w-10 h-10 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
              />
            </svg>
          </div>
          <p class="text-gray-600 mb-4">
            {{ t("settings.qrcode.notGenerated") }}
          </p>
          <button
            :disabled="isGeneratingQR"
            class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="generateShopQR"
          >
            <span v-if="!isGeneratingQR">{{
              t("settings.qrcode.generateQR")
            }}</span>
            <span v-else class="flex items-center">
              <svg
                class="animate-spin h-4 w-4 mr-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              {{ t("settings.qrcode.generating") }}
            </span>
          </button>
        </div>

        <!-- 已有 QR Code 時 -->
        <div v-else class="space-y-6">
          <!-- QR Code 顯示 -->
          <div class="flex flex-col md:flex-row gap-6">
            <!-- QR Code 圖片 -->
            <div class="flex-shrink-0">
              <div
                class="w-64 h-64 bg-white border-2 border-gray-200 rounded-lg p-4 flex items-center justify-center"
              >
                <div
                  v-if="shopQrPreviewUrl"
                  class="w-full h-full flex items-center justify-center"
                >
                  <img
                    :src="shopQrPreviewUrl"
                    :alt="t('settings.qrcode.previewAlt')"
                    class="max-w-full max-h-full"
                  />
                </div>
                <div v-else class="text-center">
                  <svg
                    class="w-32 h-32 text-gray-400 mx-auto"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                    />
                  </svg>
                  <p class="text-sm text-gray-500 mt-2">QR Code</p>
                </div>
              </div>
            </div>

            <!-- QR Code 資訊 -->
            <div class="flex-1 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1"
                  >QR Code</label
                >
                <div class="flex items-center space-x-2">
                  <code
                    class="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded text-sm font-mono break-all"
                  >
                    {{ shopQrPayload }}
                  </code>
                  <button
                    class="px-3 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                    :title="t('settings.qrcode.copy')"
                    @click="copyQRCode"
                  >
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">{{
                  t("settings.qrcode.version")
                }}</label>
                <p class="text-sm text-gray-600">v{{ shopQR.version }}</p>
              </div>

              <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div class="flex items-start space-x-2">
                  <svg
                    class="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div>
                    <p class="text-sm font-medium text-blue-800">
                      {{ t("settings.qrcode.usageGuide") }}
                    </p>
                    <p class="text-sm text-blue-700">
                      {{ t("settings.qrcode.usageGuideText") }}
                    </p>
                  </div>
                </div>
              </div>

              <!-- 操作按鈕 -->
              <div class="flex flex-wrap gap-3 pt-2">
                <button
                  data-testid="shop-qr-download"
                  class="px-4 py-2 text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                  @click="downloadQRCode"
                >
                  <span class="flex items-center">
                    <svg
                      class="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                      />
                    </svg>
                    {{ t("settings.qrcode.downloadQR") }}
                  </span>
                </button>

                <button
                  data-testid="shop-qr-print"
                  class="px-4 py-2 text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
                  @click="printShopQRCode"
                >
                  <span class="flex items-center">
                    <svg
                      class="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2m-12 0v4h12v-4H8z"
                      />
                    </svg>
                    {{ t("settings.qrcode.printQR") }}
                  </span>
                </button>

                <button
                  :disabled="isRegeneratingQR"
                  class="px-4 py-2 text-orange-600 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="regenerateShopQR"
                >
                  <span v-if="!isRegeneratingQR" class="flex items-center">
                    <svg
                      class="w-4 h-4 mr-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                    {{ t("settings.qrcode.regenerate") }}
                  </span>
                  <span v-else class="flex items-center">
                    <svg
                      class="animate-spin h-4 w-4 mr-2"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                      ></circle>
                      <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    {{ t("settings.qrcode.regenerating") }}
                  </span>
                </button>
              </div>

              <!-- 重新生成警告 -->
              <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <div class="flex items-start space-x-2">
                  <svg
                    class="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div>
                    <p class="text-sm font-medium text-yellow-800">
                      {{ t("settings.qrcode.warning") }}
                    </p>
                    <p class="text-sm text-yellow-700">
                      {{ t("settings.qrcode.warningText") }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 通知設定 -->
    <div v-show="activeTab === 'notifications'" class="space-y-8">
      <!-- 音效通知 -->
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold text-gray-900 mb-4">
          {{ t("settings.notifications.soundTitle") }}
        </h3>
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <label class="text-sm font-medium text-gray-900">{{
                t("settings.notifications.enableSound")
              }}</label>
              <p class="text-sm text-gray-500">
                {{ t("settings.notifications.enableSoundDesc") }}
              </p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input
                v-model="settings.notifications.sound.enabled"
                type="checkbox"
                class="sr-only peer"
              />
              <div
                class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
              />
            </label>
          </div>

          <div
            v-if="settings.notifications.sound.enabled"
            class="ml-6 space-y-3"
          >
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("settings.notifications.volume")
              }}</label>
              <input
                v-model.number="settings.notifications.sound.volume"
                type="range"
                min="0"
                max="100"
                class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              />
              <div class="text-sm text-gray-500">
                {{ settings.notifications.sound.volume }}%
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("settings.notifications.newOrderSound")
              }}</label>
              <select
                v-model="settings.notifications.sound.newOrder"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="bell">
                  {{ t("settings.notifications.sounds.bell") }}
                </option>
                <option value="chime">
                  {{ t("settings.notifications.sounds.chime") }}
                </option>
                <option value="notification">
                  {{ t("settings.notifications.sounds.notification") }}
                </option>
                <option value="custom">
                  {{ t("settings.notifications.sounds.custom") }}
                </option>
              </select>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">{{
                t("settings.notifications.completeSound")
              }}</label>
              <select
                v-model="settings.notifications.sound.complete"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="success">
                  {{ t("settings.notifications.sounds.success") }}
                </option>
                <option value="ding">
                  {{ t("settings.notifications.sounds.ding") }}
                </option>
                <option value="chime">
                  {{ t("settings.notifications.sounds.chime") }}
                </option>
                <option value="custom">
                  {{ t("settings.notifications.sounds.custom") }}
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 桌面通知 -->
    <div
      v-show="activeTab === 'notifications'"
      class="bg-white rounded-lg shadow p-6"
    >
      <h3 class="text-lg font-semibold text-gray-900 mb-4">
        {{ t("settings.notifications.desktopTitle") }}
      </h3>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-gray-900">{{
              t("settings.notifications.enableDesktop")
            }}</label>
            <p class="text-sm text-gray-500">
              {{ t("settings.notifications.enableDesktopDesc") }}
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="settings.notifications.desktop.enabled"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>

        <div
          v-if="settings.notifications.desktop.enabled"
          class="ml-6 space-y-3"
        >
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">{{
              t("settings.notifications.duration")
            }}</label>
            <input
              v-model.number="settings.notifications.desktop.duration"
              type="number"
              min="3"
              max="30"
              class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 安全設定 -->
  <div v-show="activeTab === 'security'" class="space-y-8">
    <!-- 密碼政策 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">
        {{ t("settings.security.passwordTitle") }}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("settings.security.minLength")
          }}</label>
          <input
            v-model.number="settings.security.password.minLength"
            type="number"
            min="6"
            max="32"
            data-testid="settings-password-min-length"
            class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-gray-900">{{
              t("settings.security.requireNumbers")
            }}</label>
            <p class="text-sm text-gray-500">
              {{ t("settings.security.requireNumbersDesc") }}
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="settings.security.password.requireNumbers"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-gray-900">{{
              t("settings.security.requireSymbols")
            }}</label>
            <p class="text-sm text-gray-500">
              {{ t("settings.security.requireSymbolsDesc") }}
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="settings.security.password.requireSymbols"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("settings.security.expireDays")
          }}</label>
          <select
            v-model.number="settings.security.password.expireDays"
            class="w-48 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="0">{{ t("settings.security.neverExpire") }}</option>
            <option value="30">30 {{ t("settings.days") }}</option>
            <option value="60">60 {{ t("settings.days") }}</option>
            <option value="90">90 {{ t("settings.days") }}</option>
            <option value="180">180 {{ t("settings.days") }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 登入安全 -->
    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-lg font-semibold text-gray-900 mb-4">
        {{ t("settings.security.loginTitle") }}
      </h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("settings.security.maxAttempts")
          }}</label>
          <input
            v-model.number="settings.security.login.maxAttempts"
            type="number"
            min="3"
            max="10"
            class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("settings.security.lockoutMinutes")
          }}</label>
          <input
            v-model.number="settings.security.login.lockoutMinutes"
            type="number"
            min="5"
            max="120"
            class="w-32 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-gray-900">{{
              t("settings.security.logActivity")
            }}</label>
            <p class="text-sm text-gray-500">
              {{ t("settings.security.logActivityDesc") }}
            </p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input
              v-model="settings.security.login.logActivity"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"
            />
          </label>
        </div>
      </div>
    </div>
  </div>

  <!-- 外送平台串接設定 -->
  <div v-show="activeTab === 'integrations'" class="space-y-8">
    <IntegrationsSettings />
  </div>

  <!-- 成功提示 -->
  <div
    v-if="showSuccessMessage"
    class="fixed top-4 right-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg shadow-lg z-50"
  >
    <div class="flex items-center">
      <CheckCircleIcon class="h-5 w-5 mr-2" />
      <span>{{ t("settings.savedSuccess") }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  ref,
  reactive,
  toRaw,
  onMounted,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import { CheckCircleIcon } from "@heroicons/vue/24/outline";
import IntegrationsSettings from "@/components/settings/IntegrationsSettings.vue";
import RestaurantServiceItemsManager from "@/components/settings/RestaurantServiceItemsManager.vue";
import ServiceBookingSlotsManager from "@/components/settings/ServiceBookingSlotsManager.vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/services/api";
import {
  marketsService,
  type MarketJoinRequest,
  type MarketListItem,
  type RestaurantMarketMembership,
} from "@/services/marketsService";
import {
  evaluateMarketplaceReadiness,
  type MarketplaceReadinessIssueKey,
} from "@/utils/marketplaceReadiness";
import {
  marketPublicReadinessSummary,
  publicReadinessIssueLabel,
} from "@/utils/marketPublicReadiness";
import { filterMarketJoinRequestOptions } from "@/utils/marketJoinRequestOptions";
import { formatMarketMembershipLocation } from "@/utils/marketMembershipDisplay";
import { setRestaurantCurrency } from "@/composables/useCurrency";
import { printQRCodeSheet, toPrintableDataUrl } from "@/utils/qrPrintSheet";
import type { CurrencyCode } from "@makanmasak/shared-types";

const { t } = useI18n();
const toast = useToast();
const { confirm: confirmModal } = useConfirmModal();
const authStore = useAuthStore();
const route = useRoute();

// 分頁選項
const tabs = [
  { id: "general", name: t("settings.tabs.general") },
  { id: "markets", name: t("settings.tabs.markets") },
  { id: "contact", name: t("settings.tabs.contact") },
  { id: "orders", name: t("settings.tabs.orders") },
  { id: "qrcode", name: t("settings.tabs.qrcode") },
  { id: "notifications", name: t("settings.tabs.notifications") },
  { id: "security", name: t("settings.tabs.security") },
  { id: "integrations", name: t("settings.tabs.integrations") },
];

const tabIds = tabs.map((tab) => tab.id);
const activeTab = ref(
  typeof route.query.tab === "string" && tabIds.includes(route.query.tab)
    ? route.query.tab
    : "general",
);
const serviceItemsSection = ref<HTMLElement | null>(null);
const showSuccessMessage = ref(false);
const isMarketServiceGapContext = computed(
  () => route.query.source === "market-gap" && route.query.gap === "services",
);
const marketServiceGapName = computed(() =>
  firstQueryString(route.query.marketName),
);
const marketServiceGapSlug = computed(() =>
  firstQueryString(route.query.marketSlug),
);
const marketServiceGapAreaCity = computed(() =>
  firstQueryString(route.query.areaCity),
);
const marketServiceGapAreaDistrict = computed(() =>
  firstQueryString(route.query.areaDistrict),
);

// Shop QR 狀態
interface ShopQrSettings {
  displayName: string;
  instructions: string;
}

interface ShopQrCodeInfo {
  enabled: boolean;
  qrCode: string | null;
  qrUrl: string | null;
  qrCodeImageUrl: string | null;
  version: number;
  settings: Partial<ShopQrSettings>;
}

type ShopQrCodeMutation = Pick<
  ShopQrCodeInfo,
  "qrCode" | "qrUrl" | "qrCodeImageUrl" | "version"
>;

const shopQR = reactive({
  enabled: false,
  qrCode: "",
  qrUrl: "",
  qrCodeImageUrl: "",
  version: 1,
  settings: {
    displayName: "",
    instructions: "",
  },
});

const generatedShopQrDataUrl = ref("");
const shopQrPreviewUrl = computed(
  () => shopQR.qrCodeImageUrl || generatedShopQrDataUrl.value,
);
/**
 * What the QR bitmap actually encodes. The API returns `qrUrl` — a real https://
 * link a phone camera can open — while `qrCode` is only the lookup key. Older
 * API builds omit `qrUrl`, so fall back rather than printing a blank sticker.
 */
const shopQrPayload = computed(() => shopQR.qrUrl || shopQR.qrCode);

const isGeneratingQR = ref(false);
const isRegeneratingQR = ref(false);
const isSavingShopSettings = ref(false);
const isLoadingMarkets = ref(false);
const isSubmittingMarketRequest = ref(false);
const availableMarkets = ref<MarketListItem[]>([]);
const marketMemberships = ref<RestaurantMarketMembership[]>([]);
const marketJoinRequests = ref<MarketJoinRequest[]>([]);
const marketJoinSearchQuery = ref("");
const marketJoinForm = reactive({
  marketId: "",
  message: "",
});
const isLoadingContactProfile = ref(false);
const isSavingContactProfile = ref(false);

type ContactChannelKey = "line" | "whatsapp" | "instagram" | "telegram";

interface ContactFaqForm {
  localId: string;
  question: string;
  answer: string;
  keywordsText: string;
  displayOrder: number;
  isActive: boolean;
}

const contactChannelFields: Array<{
  key: ContactChannelKey;
  label: string;
  placeholder: string;
}> = [
  {
    key: "line",
    label: "LINE",
    placeholder: "https://line.me/ti/p/~your-shop",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    placeholder: "https://wa.me/886912345678",
  },
  {
    key: "instagram",
    label: "Instagram",
    placeholder: "https://ig.me/m/your-shop",
  },
  {
    key: "telegram",
    label: "Telegram",
    placeholder: "https://t.me/your-shop",
  },
];

const contactProfile = reactive({
  messagingChannels: {
    line: "",
    whatsapp: "",
    instagram: "",
    telegram: "",
  } as Record<ContactChannelKey, string>,
  faqs: [] as ContactFaqForm[],
});

// 設定數據
const settings = reactive({
  restaurant: {
    name: "",
    phone: "",
    address: "",
    city: "",
    district: "",
    latitude: null as number | null,
    longitude: null as number | null,
    openTime: "08:00",
    closeTime: "22:00",
    timezone: "Asia/Taipei",
  },
  system: {
    language: "zh-TW",
    currency: "MYR",
    autoLogoutMinutes: 60,
  },
  orders: {
    acceptGuestOrders: false,
    autoConfirm: true,
    preparationTimeAlert: true,
    defaultPreparationTime: 15,
    retentionDays: 90,
    minimumOrderEnabled: false,
    minimumOrderAmount: 0,
    // Held as percentages because that is what a shop owner types. The server
    // stores fractions -- calculateOrderTotal does `subtotalCents * taxRate`,
    // so 5% has to reach it as 0.05. The conversion happens at the payload
    // boundary in both directions; nothing else in this file divides by 100.
    taxRatePercent: 0,
    serviceChargeRatePercent: 0,
  },
  tables: {
    prefix: "T",
    autoClean: true,
    cleanDelay: 5,
  },
  notifications: {
    sound: {
      enabled: true,
      volume: 75,
      newOrder: "bell",
      complete: "success",
    },
    desktop: {
      enabled: true,
      duration: 5,
    },
  },
  security: {
    password: {
      minLength: 8,
      requireNumbers: true,
      requireSymbols: false,
      expireDays: 90,
    },
    login: {
      maxAttempts: 5,
      lockoutMinutes: 15,
      logActivity: true,
    },
  },
});

watch(
  () => route.query.tab,
  (tab) => {
    if (typeof tab === "string" && tabIds.includes(tab)) {
      activeTab.value = tab;
      focusRequestedSection();
    }
  },
);
watch(
  () => route.query.section,
  () => focusRequestedSection(),
);

watch(
  () => [shopQrPayload.value, shopQR.qrCodeImageUrl] as const,
  async ([payload, qrCodeImageUrl]) => {
    if (!payload || qrCodeImageUrl) {
      generatedShopQrDataUrl.value = "";
      return;
    }

    try {
      generatedShopQrDataUrl.value = await toPrintableDataUrl(payload);
    } catch (error) {
      console.error("Failed to prepare shop QR image:", error);
      generatedShopQrDataUrl.value = "";
    }
  },
);

async function focusRequestedSection() {
  if (route.query.section !== "services") return;
  if (activeTab.value !== "contact") return;

  await nextTick();
  serviceItemsSection.value?.scrollIntoView({
    block: "start",
    behavior: "smooth",
  });
}

function firstQueryString(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") ?? "";
  }
  return typeof value === "string" ? value : "";
}

// 外帶/外送設定
const deliverySettings = reactive({
  enableDineIn: true,
  enableTakeaway: true,
  enableDelivery: false,
  deliveryFee: 0,
  estimatedPrepTimeMin: 15,
  estimatedPrepTimeMax: 20,
});

const marketplaceReadiness = computed(() =>
  evaluateMarketplaceReadiness({
    city: settings.restaurant.city,
    district: settings.restaurant.district,
    address: settings.restaurant.address,
    latitude: settings.restaurant.latitude,
    longitude: settings.restaurant.longitude,
    takeawayEnabled: deliverySettings.enableTakeaway,
    shopModeEnabled: shopQR.enabled,
    shopQrCode: shopQR.qrCode,
    contactChannelCount: Object.values(contactProfile.messagingChannels).filter(
      (value) => value.trim().length > 0,
    ).length,
    activeFaqCount: contactProfile.faqs.filter((faq) => faq.isActive).length,
    marketMembershipCount: marketMemberships.value.length,
  }),
);

const marketplaceReadinessItems = computed(() => {
  const issues = new Map(
    marketplaceReadiness.value.issues.map((issue) => [issue.key, issue]),
  );
  const keys: MarketplaceReadinessIssueKey[] = [
    "location",
    "fulfillment",
    "shopMode",
    "contact",
    "faq",
    "market",
  ];

  return keys.map((key) => {
    const issue = issues.get(key);
    return {
      key,
      done: !issue,
      severity: issue?.severity ?? "recommended",
    };
  });
});

const canEnableShopMode = computed(
  () =>
    deliverySettings.enableDineIn ||
    deliverySettings.enableTakeaway ||
    deliverySettings.enableDelivery,
);

const selectedMarket = computed(() =>
  availableMarkets.value.find(
    (market) => market.id === marketJoinForm.marketId,
  ),
);

const joinableMarketOptions = computed(() =>
  filterMarketJoinRequestOptions(
    availableMarkets.value,
    marketMemberships.value,
    marketJoinRequests.value,
    marketJoinSearchQuery.value,
  ),
);

watch(joinableMarketOptions, (options) => {
  if (
    marketJoinForm.marketId &&
    !options.some((market) => market.id === marketJoinForm.marketId)
  ) {
    marketJoinForm.marketId = "";
  }
});

const selectedMarketReadiness = computed(
  () => selectedMarket.value?.publicReadiness,
);

const selectedMarketReadinessSummary = computed(() =>
  marketPublicReadinessSummary(selectedMarketReadiness.value),
);

// 預設設定
// A deep snapshot, taken before anything mutates `settings`. `{ ...settings }`
// only copied the six top-level keys, so `defaultSettings.orders` stayed the
// *same object* as `settings.orders` — editing a field edited the "default"
// too, and resetToDefaults assigned those identical references back over
// themselves. The reset button did nothing at all.
/**
 * The form takes a percentage; OrderService multiplies the subtotal by a
 * fraction. Both directions round, because neither division nor multiplication
 * by 100 is exact in binary floating point: 0.7% becomes 0.006999999999999999
 * going in, and 7% comes back as 7.000000000000001. Of the 1001 rates a
 * 0.1-step input can produce between 0 and 100, 93 change value across an
 * unrounded round trip, so the owner would watch the figure grow a tail every
 * time the page reloaded.
 */
function percentToRate(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.round((percent / 100) * 1e6) / 1e6;
}

function rateToPercent(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(rate * 100 * 1e4) / 1e4;
}

const defaultSettings = structuredClone(toRaw(settings));

// 方法
// What the server last told us, so a field the user did not touch is not
// resent. Only business hours need this today -- see buildBusinessHours.
const loadedBusinessHours = reactive({ openTime: "", closeTime: "" });

const WEEKDAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/**
 * businessHours is Record<day, {open, close, isOpen}> and the customer app
 * renders it per day (formatBusinessHours). This screen offers a single
 * open/close pair for the whole week, so writing it always would flatten any
 * per-day hours set elsewhere, silently and with nothing on screen to warn the
 * owner. Return undefined when the pair is unchanged since load: the server
 * merges settings and skips absent columns, so omitting the field leaves the
 * stored hours exactly as they were.
 *
 * isOpen is carried over per day rather than forced true, so a shop that is
 * closed on Mondays stays closed on Mondays after an hours edit.
 */
function buildBusinessHours() {
  const { openTime, closeTime } = settings.restaurant;
  if (
    openTime === loadedBusinessHours.openTime &&
    closeTime === loadedBusinessHours.closeTime
  ) {
    return undefined;
  }
  return Object.fromEntries(
    WEEKDAY_KEYS.map((day) => [
      day,
      {
        open: openTime,
        close: closeTime,
        isOpen: currentBusinessHours.value?.[day]?.isOpen ?? true,
      },
    ]),
  );
}

const currentBusinessHours = ref<Record<
  string,
  { open: string; close: string; isOpen: boolean }
> | null>(null);

const saveSettings = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (restaurantId) {
      const businessHours = buildBusinessHours();
      await api.put(`/restaurants/${restaurantId}`, {
        // Top-level restaurant columns.
        name: settings.restaurant.name,
        phone: settings.restaurant.phone,
        address: settings.restaurant.address,
        city: settings.restaurant.city,
        district: settings.restaurant.district,
        ...(businessHours ? { businessHours } : {}),
        isAvailable: settings.orders.acceptGuestOrders,
        supportsTakeaway: deliverySettings.enableTakeaway,
        supportsDelivery: deliverySettings.enableDelivery,

        // A column, not a `settings` key: this is where every business-day
        // bucket reads its offset from, and one boundary in two places is how
        // a report ends up disagreeing with the till (#329).
        timezone: settings.restaurant.timezone,
        settings: {
          allowGuestOrders: settings.orders.acceptGuestOrders,
          currency: settings.system.currency,
          enableDineIn: deliverySettings.enableDineIn,
          enableTakeaway: deliverySettings.enableTakeaway,
          enableDelivery: deliverySettings.enableDelivery,
          deliveryFee: deliverySettings.deliveryFee,
          estimatedPrepTimeMin: deliverySettings.estimatedPrepTimeMin,
          estimatedPrepTimeMax: deliverySettings.estimatedPrepTimeMax,

          // Read by the server. restaurantSettingsSchema declares these, and
          // OrderService.createOrder gates on minOrderAmount -- it is compared
          // against a major-unit subtotal, so the figure entered here goes
          // through unconverted.
          //
          // The toggle is not stored: 0 and "disabled" are the same thing to
          // the gate (`minOrderAmount > 0`), so storing both invites them to
          // disagree. It is derived back from the amount on load.
          minOrderAmount: settings.orders.minimumOrderEnabled
            ? settings.orders.minimumOrderAmount
            : 0,
          autoAcceptOrders: settings.orders.autoConfirm,

          // Fractions, not percentages: OrderService computes tax as
          // `subtotalCents * taxRate`, so 5% has to arrive as 0.05. Both rates
          // were unreachable from this screen until now, which is why every
          // order carried taxAmount 0 and serviceCharge 0 (#313).
          taxRate: percentToRate(settings.orders.taxRatePercent),
          serviceChargeRate: percentToRate(
            settings.orders.serviceChargeRatePercent,
          ),

          // Console preferences with no server behaviour, kept under one key so
          // the flat namespace above stays "settings the server acts on".
          adminConsole: {
            language: settings.system.language,
            autoLogoutMinutes: settings.system.autoLogoutMinutes,
            preparationTimeAlert: settings.orders.preparationTimeAlert,
            defaultPreparationTime: settings.orders.defaultPreparationTime,
            retentionDays: settings.orders.retentionDays,
            tables: { ...settings.tables },
            notifications: structuredClone(toRaw(settings.notifications)),
            security: structuredClone(toRaw(settings.security)),
          },
        },
      });
      setRestaurantCurrency(settings.system.currency as CurrencyCode);
      loadedBusinessHours.openTime = settings.restaurant.openTime;
      loadedBusinessHours.closeTime = settings.restaurant.closeTime;
    }

    showSuccessMessage.value = true;
    setTimeout(() => {
      showSuccessMessage.value = false;
    }, 3000);
  } catch (error) {
    console.error("Failed to save settings:", error);
    toast.error(t("settings.alerts.saveFailed"));
  }
};

const resetToDefaults = async () => {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("settings.confirms.resetDefaultsTitle"),
    message: t("settings.confirms.resetDefaults"),
    confirmLabel: t("settings.confirms.resetDefaultsAction"),
  });
  if (!confirmed) return;

  // Clone again on every reset. Assigning the snapshot's own nested objects
  // would hand `settings` the very references `defaultSettings` holds, and the
  // next edit would corrupt the snapshot exactly as the shallow spread did.
  Object.assign(settings, structuredClone(defaultSettings));
};

const loadSettings = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (restaurantId) {
      const response = await api.get<{
        name?: string;
        phone?: string;
        address?: string;
        city?: string;
        district?: string;
        latitude?: number | null;
        longitude?: number | null;
        isAvailable?: boolean;
        supportsTakeaway?: boolean;
        timezone?: string;
        businessHours?: Record<
          string,
          { open: string; close: string; isOpen: boolean }
        > | null;
        settings?: {
          allowGuestOrders?: boolean;
          currency?: string;
          enableDineIn?: boolean;
          enableTakeaway?: boolean;
          enableDelivery?: boolean;
          deliveryFee?: number;
          estimatedPrepTimeMin?: number;
          estimatedPrepTimeMax?: number;
          minOrderAmount?: number;
          autoAcceptOrders?: boolean;
          taxRate?: number;
          serviceChargeRate?: number;
          adminConsole?: {
            language?: string;
            autoLogoutMinutes?: number;
            preparationTimeAlert?: boolean;
            defaultPreparationTime?: number;
            retentionDays?: number;
            tables?: Partial<typeof settings.tables>;
            notifications?: Partial<typeof settings.notifications>;
            security?: Partial<typeof settings.security>;
          };
        };
      }>(`/restaurants/${restaurantId}`);
      const data = response.data?.data;
      if (data) {
        if (data.name) settings.restaurant.name = data.name;
        if (data.phone) settings.restaurant.phone = data.phone;
        if (data.address) settings.restaurant.address = data.address;
        if (data.city) settings.restaurant.city = data.city;
        if (data.district) settings.restaurant.district = data.district;
        if (data.latitude !== undefined) {
          settings.restaurant.latitude = data.latitude;
        }
        if (data.longitude !== undefined) {
          settings.restaurant.longitude = data.longitude;
        }
        if (data.timezone) settings.restaurant.timezone = data.timezone;
        settings.orders.acceptGuestOrders =
          data.settings?.allowGuestOrders === true &&
          data.isAvailable !== false;
        if (data.supportsTakeaway !== undefined) {
          deliverySettings.enableTakeaway = data.supportsTakeaway;
        }

        // The screen shows one open/close pair for the week; take it from the
        // first day that has hours. Recording what was loaded is what lets
        // saveSettings leave per-day hours alone when the owner did not touch
        // these two fields.
        currentBusinessHours.value = data.businessHours ?? null;
        const firstDay = Object.values(data.businessHours ?? {}).find(
          (day) => day?.open && day?.close,
        );
        if (firstDay) {
          settings.restaurant.openTime = firstDay.open;
          settings.restaurant.closeTime = firstDay.close;
        }
        loadedBusinessHours.openTime = settings.restaurant.openTime;
        loadedBusinessHours.closeTime = settings.restaurant.closeTime;
      }
      if (data?.settings) {
        if (data.settings.currency) {
          settings.system.currency = data.settings.currency;
          setRestaurantCurrency(data.settings.currency as CurrencyCode);
        }
        if (data.settings.enableDineIn !== undefined) {
          deliverySettings.enableDineIn = data.settings.enableDineIn;
        }
        if (data.settings.enableTakeaway !== undefined) {
          deliverySettings.enableTakeaway = data.settings.enableTakeaway;
        }
        if (data.settings.enableDelivery !== undefined) {
          deliverySettings.enableDelivery = data.settings.enableDelivery;
        }
        if (data.settings.deliveryFee !== undefined) {
          deliverySettings.deliveryFee = data.settings.deliveryFee;
        }
        if (data.settings.estimatedPrepTimeMin !== undefined) {
          deliverySettings.estimatedPrepTimeMin =
            data.settings.estimatedPrepTimeMin;
        }
        if (data.settings.estimatedPrepTimeMax !== undefined) {
          deliverySettings.estimatedPrepTimeMax =
            data.settings.estimatedPrepTimeMax;
        }

        // Server-read settings.
        if (data.settings.minOrderAmount !== undefined) {
          settings.orders.minimumOrderAmount = data.settings.minOrderAmount;
          // Derived, not stored: the order gate gates on `> 0`, so an amount of
          // zero and a disabled toggle are the same thing. Keeping a separate
          // flag would let the two disagree and there would be no way to tell
          // which one the gate was following.
          settings.orders.minimumOrderEnabled =
            data.settings.minOrderAmount > 0;
        }
        if (data.settings.autoAcceptOrders !== undefined) {
          settings.orders.autoConfirm = data.settings.autoAcceptOrders;
        }
        if (data.settings.taxRate !== undefined) {
          settings.orders.taxRatePercent = rateToPercent(data.settings.taxRate);
        }
        if (data.settings.serviceChargeRate !== undefined) {
          settings.orders.serviceChargeRatePercent = rateToPercent(
            data.settings.serviceChargeRate,
          );
        }
        // Console preferences. Each group is merged rather than assigned so a
        // payload written by an older build, missing keys this one expects,
        // leaves the defaults in place instead of turning them undefined.
        const console = data.settings.adminConsole;
        if (console) {
          if (console.language) settings.system.language = console.language;
          if (console.autoLogoutMinutes !== undefined) {
            settings.system.autoLogoutMinutes = console.autoLogoutMinutes;
          }
          if (console.preparationTimeAlert !== undefined) {
            settings.orders.preparationTimeAlert = console.preparationTimeAlert;
          }
          if (console.defaultPreparationTime !== undefined) {
            settings.orders.defaultPreparationTime =
              console.defaultPreparationTime;
          }
          if (console.retentionDays !== undefined) {
            settings.orders.retentionDays = console.retentionDays;
          }
          if (console.tables) Object.assign(settings.tables, console.tables);
          if (console.notifications?.sound) {
            Object.assign(
              settings.notifications.sound,
              console.notifications.sound,
            );
          }
          if (console.notifications?.desktop) {
            Object.assign(
              settings.notifications.desktop,
              console.notifications.desktop,
            );
          }
          if (console.security?.password) {
            Object.assign(
              settings.security.password,
              console.security.password,
            );
          }
          if (console.security?.login) {
            Object.assign(settings.security.login, console.security.login);
          }
        }
      }
    }
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
};

const loadMarketSettings = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;

    isLoadingMarkets.value = true;
    const [markets, memberships, joinRequests] = await Promise.all([
      marketsService.listMarkets(),
      marketsService.listRestaurantMemberships(restaurantId),
      marketsService.listJoinRequests(restaurantId),
    ]);
    availableMarkets.value = markets;
    marketMemberships.value = memberships;
    marketJoinRequests.value = joinRequests;
  } catch (error) {
    console.error("Failed to load market settings:", error);
    toast.error(t("settings.markets.loadFailed"));
  } finally {
    isLoadingMarkets.value = false;
  }
};

const submitMarketJoinRequest = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId || !marketJoinForm.marketId) return;

    isSubmittingMarketRequest.value = true;
    await marketsService.requestJoin(restaurantId, {
      marketId: marketJoinForm.marketId,
      message: marketJoinForm.message.trim() || null,
    });
    toast.success(t("settings.markets.requestSuccess"));
    marketJoinForm.marketId = "";
    marketJoinForm.message = "";
    marketJoinSearchQuery.value = "";
    await loadMarketSettings();
  } catch (error) {
    console.error("Failed to submit market join request:", error);
    toast.error(t("settings.markets.requestFailed"));
  } finally {
    isSubmittingMarketRequest.value = false;
  }
};

const marketJoinRequestStatusClass = (status: MarketJoinRequest["status"]) => {
  if (status === "approved") return "bg-green-100 text-green-700";
  if (status === "rejected") return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-800";
};

const addContactFaq = () => {
  contactProfile.faqs.push({
    localId: crypto.randomUUID(),
    question: "",
    answer: "",
    keywordsText: "",
    displayOrder: contactProfile.faqs.length + 1,
    isActive: true,
  });
};

const removeContactFaq = (index: number) => {
  contactProfile.faqs.splice(index, 1);
};

const loadContactProfile = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;

    isLoadingContactProfile.value = true;
    const response = await api.get<{
      messagingChannels?: Partial<Record<ContactChannelKey, string>>;
      faqs?: Array<{
        id: number;
        question: string;
        answer: string;
        keywords?: string[];
        displayOrder: number;
        isActive: boolean;
      }>;
    }>(`/restaurants/${restaurantId}/contact-profile`);
    const data = response.data?.data;

    contactChannelFields.forEach((field) => {
      contactProfile.messagingChannels[field.key] =
        data?.messagingChannels?.[field.key] ?? "";
    });
    contactProfile.faqs = (data?.faqs ?? []).map((faq) => ({
      localId: String(faq.id),
      question: faq.question,
      answer: faq.answer,
      keywordsText: (faq.keywords ?? []).join(", "),
      displayOrder: faq.displayOrder,
      isActive: faq.isActive,
    }));
  } catch (error) {
    console.error("Failed to load contact profile:", error);
    toast.error(t("settings.contact.loadFailed"));
  } finally {
    isLoadingContactProfile.value = false;
  }
};

const saveContactProfile = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;

    isSavingContactProfile.value = true;
    await api.put(`/restaurants/${restaurantId}/contact-profile`, {
      messagingChannels: Object.fromEntries(
        contactChannelFields
          .map((field) => [
            field.key,
            contactProfile.messagingChannels[field.key].trim(),
          ])
          .filter(([, value]) => value),
      ),
      faqs: contactProfile.faqs
        .filter((faq) => faq.question.trim() && faq.answer.trim())
        .map((faq) => ({
          question: faq.question.trim(),
          answer: faq.answer.trim(),
          keywords: faq.keywordsText
            .split(",")
            .map((keyword) => keyword.trim())
            .filter(Boolean),
          displayOrder: faq.displayOrder,
          isActive: faq.isActive,
        })),
    });
    await loadContactProfile();
    toast.success(t("settings.contact.saveSuccess"));
  } catch (error) {
    console.error("Failed to save contact profile:", error);
    toast.error(t("settings.contact.saveFailed"));
  } finally {
    isSavingContactProfile.value = false;
  }
};

// Shop QR 方法
const loadShopQRInfo = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    const response = await api.get<ShopQrCodeInfo>(
      `/restaurants/${restaurantId}/qr/shop`,
    );

    const data = response.data.data;
    if (data) {
      shopQR.enabled = data.enabled || false;
      shopQR.qrCode = data.qrCode || "";
      shopQR.qrUrl = data.qrUrl || "";
      shopQR.qrCodeImageUrl = data.qrCodeImageUrl || "";
      shopQR.version = data.version || 1;
      if (data.settings) {
        shopQR.settings = { ...shopQR.settings, ...data.settings };
      }
    }
  } catch (error) {
    console.error("Failed to load shop QR info:", error);
  }
};

const handleToggleShopMode = async () => {
  try {
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    if (shopQR.enabled && !canEnableShopMode.value) {
      shopQR.enabled = false;
      toast.error(t("settings.alerts.fulfillmentRequired"));
      return;
    }
    await api.put(`/restaurants/${restaurantId}/shop-mode`, {
      enabled: shopQR.enabled,
      settings: shopQR.settings,
    });

    toast.success(
      shopQR.enabled
        ? t("settings.alerts.shopModeEnabled")
        : t("settings.alerts.shopModeDisabled"),
    );
    await loadShopQRInfo();
  } catch (error) {
    console.error("Failed to toggle shop mode:", error);
    toast.error(t("settings.alerts.operationFailed"));
    shopQR.enabled = !shopQR.enabled;
  }
};

const saveShopSettings = async () => {
  try {
    isSavingShopSettings.value = true;
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    if (shopQR.enabled && !canEnableShopMode.value) {
      toast.error(t("settings.alerts.fulfillmentRequired"));
      return;
    }
    await api.put(`/restaurants/${restaurantId}/shop-mode`, {
      enabled: shopQR.enabled,
      settings: shopQR.settings,
    });

    toast.success(t("settings.alerts.settingsSaved"));
  } catch (error) {
    console.error("Failed to save shop settings:", error);
    toast.error(t("settings.alerts.saveFailed"));
  } finally {
    isSavingShopSettings.value = false;
  }
};

const generateShopQR = async () => {
  try {
    isGeneratingQR.value = true;
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    const response = await api.post<ShopQrCodeMutation>(
      `/restaurants/${restaurantId}/qr/shop/generate`,
    );

    const data = response.data.data;
    if (data) {
      shopQR.qrCode = data.qrCode ?? "";
      shopQR.qrUrl = data.qrUrl || "";
      shopQR.qrCodeImageUrl = data.qrCodeImageUrl ?? "";
      shopQR.version = data.version ?? 1;
    }
    toast.success(t("settings.alerts.qrGenerated"));
  } catch (error) {
    console.error("Failed to generate shop QR:", error);
    toast.error(t("settings.alerts.generateFailed"));
  } finally {
    isGeneratingQR.value = false;
  }
};

const regenerateShopQR = async () => {
  const confirmed = await confirmModal({
    type: "warning",
    title: t("settings.confirms.regenerateQRTitle"),
    message: t("settings.confirms.regenerateQR"),
    confirmLabel: t("settings.confirms.regenerateQRAction"),
  });
  if (!confirmed) return;

  try {
    isRegeneratingQR.value = true;
    const restaurantId = authStore.restaurantId;
    if (!restaurantId) return;
    const response = await api.post<ShopQrCodeMutation>(
      `/restaurants/${restaurantId}/qr/shop/regenerate`,
    );

    const data = response.data.data;
    if (data) {
      shopQR.qrCode = data.qrCode ?? "";
      shopQR.qrUrl = data.qrUrl || "";
      shopQR.qrCodeImageUrl = data.qrCodeImageUrl ?? "";
      shopQR.version = data.version ?? 1;
      toast.success(
        t("settings.alerts.qrRegenerated", { version: data.version }),
      );
    }
  } catch (error) {
    console.error("Failed to regenerate shop QR:", error);
    toast.error(t("settings.alerts.regenerateFailed"));
  } finally {
    isRegeneratingQR.value = false;
  }
};

const copyQRCode = () => {
  if (navigator.clipboard) {
    // Copy what the sticker encodes, not the internal lookup key — an owner
    // pasting this into a LINE post or bio needs an openable link.
    navigator.clipboard.writeText(shopQrPayload.value).then(() => {
      toast.success(t("settings.alerts.copied"));
    });
  }
};

const resolveShopQRCodeDataUrl = async () => {
  if (shopQR.qrCodeImageUrl) return shopQR.qrCodeImageUrl;
  if (generatedShopQrDataUrl.value) return generatedShopQrDataUrl.value;
  if (!shopQrPayload.value) return "";

  generatedShopQrDataUrl.value = await toPrintableDataUrl(shopQrPayload.value);
  return generatedShopQrDataUrl.value;
};

const downloadQRCode = async () => {
  try {
    const dataUrl = await resolveShopQRCodeDataUrl();
    if (!dataUrl) {
      toast.error(t("settings.alerts.downloadFailed"));
      return;
    }

    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `shop-qr-${shopQR.qrCode}.png`;
    link.click();
  } catch (error) {
    console.error("Failed to download shop QR:", error);
    toast.error(t("settings.alerts.downloadFailed"));
  }
};

const printShopQRCode = async () => {
  try {
    const dataUrl = await resolveShopQRCodeDataUrl();
    const label = t("settings.qrcode.printTitle");
    if (!dataUrl || !printQRCodeSheet(label, [{ label, dataUrl }])) {
      toast.error(t("settings.alerts.printFailed"));
    }
  } catch (error) {
    console.error("Failed to print shop QR:", error);
    toast.error(t("settings.alerts.printFailed"));
  }
};

onMounted(() => {
  loadSettings();
  loadShopQRInfo();
  loadMarketSettings();
  loadContactProfile();
  focusRequestedSection();
});
</script>

<style scoped>
.settings-view {
  padding: 1.5rem;
}

@media (max-width: 640px) {
  .settings-view {
    padding: 1rem;
  }
}

/* 自訂 toggle switch 樣式 */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* ios-separator. The on-state below already uses ios-blue; #ccc was a plain
     web grey that predates the palette. */
  background-color: #e5e5ea;
  transition: 0.4s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #007aff;
}

input:checked + .slider:before {
  transform: translateX(20px);
}
</style>
