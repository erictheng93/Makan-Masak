<template>
  <div class="space-y-6">
    <!-- Action Bar -->
    <div class="flex items-center justify-end gap-3">
      <button
        class="flex items-center px-4 py-2.5 rounded-full text-[13px] font-semibold bg-ios-orange text-white hover:bg-orange-600 transition-colors shadow-sm"
        :disabled="batchCalling"
        @click="batchCallNext"
      >
        <Bell class="w-4 h-4 mr-1.5" />
        {{ t("waitingList.callNext") }}
      </button>
      <button
        class="flex items-center px-5 py-2.5 rounded-full text-[13px] font-semibold bg-ios-blue text-white hover:bg-blue-600 transition-colors shadow-sm"
        @click="showAddDialog = true"
      >
        <Plus class="w-4 h-4 mr-1.5" />
        {{ t("waitingList.addCustomer") }}
      </button>
    </div>

    <!-- Filters -->
    <div class="card p-6">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("waitingList.filter.status")
          }}</label>
          <select
            v-model="filters.status"
            class="form-input"
            @change="loadWaitingList"
          >
            <option value="">{{ t("waitingList.filter.allStatus") }}</option>
            <option value="waiting">
              {{ t("waitingList.statusText.waiting") }}
            </option>
            <option value="called">
              {{ t("waitingList.statusText.called") }}
            </option>
            <option value="confirmed">
              {{ t("waitingList.statusText.confirmed") }}
            </option>
            <option value="seated">
              {{ t("waitingList.statusText.seated") }}
            </option>
            <option value="cancelled">
              {{ t("waitingList.statusText.cancelled") }}
            </option>
            <option value="expired">
              {{ t("waitingList.statusText.expired") }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">{{
            t("waitingList.filter.phone")
          }}</label>
          <input
            v-model="filters.phone"
            type="tel"
            class="form-input"
            :placeholder="t('waitingList.filter.enterPhone')"
            @keyup.enter="loadWaitingList"
          />
        </div>

        <div class="flex items-end space-x-2 col-span-2">
          <button class="btn-primary flex-1" @click="loadWaitingList">
            <Search class="w-4 h-4 mr-2" />
            {{ t("common.search") }}
          </button>
          <button class="btn-secondary flex-1" @click="resetFilters">
            <RotateCcw class="w-4 h-4 mr-2" />
            {{ t("common.reset") }}
          </button>
          <button class="btn-secondary flex-1" @click="loadWaitingList">
            <RefreshCw class="w-4 h-4 mr-2" />
            {{ t("common.refresh") }}
          </button>
        </div>
      </div>
    </div>

    <!-- Waiting Queue -->
    <div class="card">
      <div
        class="px-6 py-4 border-b border-gray-200 flex items-center justify-between"
      >
        <h2 class="text-lg font-medium text-gray-900">
          {{ t("waitingList.queue") }}
        </h2>
        <div class="flex rounded-lg shadow-sm">
          <button
            :class="[
              viewMode === 'card'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50',
              'px-4 py-2 text-sm font-medium rounded-l-md border border-gray-300',
            ]"
            data-testid="view-toggle-card"
            @click="viewMode = 'card'"
          >
            <LayoutGrid class="w-4 h-4" />
          </button>
          <button
            :class="[
              viewMode === 'table'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50',
              'px-4 py-2 text-sm font-medium rounded-r-md border border-l-0 border-gray-300',
            ]"
            data-testid="view-toggle-table"
            @click="viewMode = 'table'"
          >
            <List class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- Card View -->
      <div v-if="viewMode === 'card'" class="p-6">
        <div
          v-if="loading"
          class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <div v-for="i in 6" :key="i" class="animate-pulse">
            <div class="card p-4 space-y-3">
              <div class="h-8 bg-gray-200 rounded w-20"></div>
              <div class="h-4 bg-gray-200 rounded w-32"></div>
              <div class="h-4 bg-gray-200 rounded w-24"></div>
              <div class="h-8 bg-gray-200 rounded w-full"></div>
            </div>
          </div>
        </div>
        <div
          v-else-if="waitingList.length === 0"
          class="py-12 text-center text-gray-500"
        >
          <Users class="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p>{{ t("waitingList.noQueue") }}</p>
        </div>
        <div
          v-else
          class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <div
            v-for="entry in waitingList"
            :key="entry.id"
            :class="[
              'card p-4 border-l-4',
              entry.status === 'waiting'
                ? 'border-l-orange-500'
                : entry.status === 'called'
                  ? 'border-l-blue-500'
                  : entry.status === 'confirmed'
                    ? 'border-l-green-500'
                    : 'border-l-gray-300',
            ]"
          >
            <div class="flex items-start justify-between mb-3">
              <div>
                <div class="text-2xl font-bold text-gray-900">
                  {{ formatQueueNumber(entry) }}
                </div>
                <span
                  :class="getStatusBadgeClass(entry.status)"
                  class="mt-1 px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                >
                  {{ getStatusText(entry.status) }}
                </span>
              </div>
              <div class="text-right text-sm text-gray-500">
                <div>{{ formatTime(entry.createdAt) }}</div>
              </div>
            </div>

            <div class="space-y-2 mb-4">
              <div class="flex items-center text-sm">
                <User class="w-4 h-4 mr-2 text-gray-400" />
                <span class="font-medium text-gray-900">{{
                  entry.customerName
                }}</span>
              </div>
              <div class="flex items-center text-sm text-gray-600">
                <Phone class="w-4 h-4 mr-2 text-gray-400" />
                <span>{{ entry.customerPhone }}</span>
              </div>
              <div class="flex items-center text-sm text-gray-600">
                <Users class="w-4 h-4 mr-2 text-gray-400" />
                <span>{{ entry.partySize }} {{ t("waitingList.people") }}</span>
              </div>
              <div
                v-if="entry.estimatedWaitMinutes"
                class="flex items-center text-sm text-gray-600"
              >
                <Clock class="w-4 h-4 mr-2 text-gray-400" />
                <span>{{
                  t("waitingList.estimatedWaitMinutes", {
                    minutes: entry.estimatedWaitMinutes,
                  })
                }}</span>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button
                v-if="entry.status === 'waiting'"
                class="btn-sm btn-primary flex-1"
                @click="callCustomer(entry)"
              >
                <Bell class="w-4 h-4 mr-1" />
                {{ t("waitingList.call") }}
              </button>
              <button
                v-if="entry.status === 'called' || entry.status === 'confirmed'"
                class="btn-sm bg-green-600 text-white hover:bg-green-700 flex-1"
                @click="markSeated(entry.id)"
              >
                <CheckCircle class="w-4 h-4 mr-1" />
                {{ t("waitingList.seat") }}
              </button>
              <button
                v-if="entry.status === 'called'"
                class="btn-sm bg-red-600 text-white hover:bg-red-700 flex-1"
                @click="markExpired(entry.id)"
              >
                <XCircle class="w-4 h-4 mr-1" />
                {{ t("waitingList.expire") }}
              </button>
              <button
                v-if="['waiting', 'called'].includes(entry.status)"
                class="btn-sm btn-secondary flex-1"
                @click="cancelEntry(entry)"
              >
                {{ t("waitingList.cancel") }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Table View -->
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("waitingList.queueNumber") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("waitingList.customerInfo") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("waitingList.partySize") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("waitingList.waitTime") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("common.status") }}
              </th>
              <th
                class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("waitingList.joinedAt") }}
              </th>
              <th
                class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {{ t("common.actions") }}
              </th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            <template v-if="loading">
              <tr v-for="i in 5" :key="i" class="animate-pulse">
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-16"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-32"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-12"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-20"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-6 bg-gray-200 rounded w-16"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-4 bg-gray-200 rounded w-32"></div>
                </td>
                <td class="px-6 py-4">
                  <div class="h-8 bg-gray-200 rounded w-32 ml-auto"></div>
                </td>
              </tr>
            </template>
            <tr v-else-if="waitingList.length === 0">
              <td colspan="7" class="px-6 py-12 text-center text-gray-500">
                <Users class="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p>{{ t("waitingList.noQueue") }}</p>
              </td>
            </tr>
            <tr
              v-for="entry in waitingList"
              :key="entry.id"
              class="hover:bg-gray-50"
            >
              <td class="px-6 py-4 whitespace-nowrap">
                <span class="text-lg font-bold text-gray-900">{{
                  formatQueueNumber(entry)
                }}</span>
              </td>
              <td class="px-6 py-4">
                <div class="text-sm">
                  <div class="font-medium text-gray-900">
                    {{ entry.customerName }}
                  </div>
                  <div class="text-gray-500">{{ entry.customerPhone }}</div>
                </div>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ entry.partySize }} {{ t("waitingList.people") }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {{ entry.estimatedWaitMinutes || "--" }}
                {{ t("reservation.minutes") }}
              </td>
              <td class="px-6 py-4 whitespace-nowrap">
                <span
                  :class="getStatusBadgeClass(entry.status)"
                  class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                >
                  {{ getStatusText(entry.status) }}
                </span>
              </td>
              <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {{ formatTime(entry.createdAt) }}
              </td>
              <td
                class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2"
              >
                <button
                  v-if="entry.status === 'waiting'"
                  class="text-blue-600 hover:text-blue-900"
                  :title="t('waitingList.call')"
                  @click="callCustomer(entry)"
                >
                  <Bell class="w-5 h-5" />
                </button>
                <button
                  v-if="
                    entry.status === 'called' || entry.status === 'confirmed'
                  "
                  class="text-green-600 hover:text-green-900"
                  :title="t('waitingList.seat')"
                  @click="markSeated(entry.id)"
                >
                  <CheckCircle class="w-5 h-5" />
                </button>
                <button
                  v-if="entry.status === 'called'"
                  class="text-red-600 hover:text-red-900"
                  :title="t('waitingList.expire')"
                  @click="markExpired(entry.id)"
                >
                  <XCircle class="w-5 h-5" />
                </button>
                <button
                  v-if="['waiting', 'called'].includes(entry.status)"
                  class="text-gray-600 hover:text-gray-900"
                  :title="t('waitingList.cancel')"
                  @click="cancelEntry(entry)"
                >
                  <Trash2 class="w-5 h-5" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Pagination -->
        <div
          v-if="pagination.total > 0 && viewMode === 'table'"
          class="px-6 py-4 flex items-center justify-between border-t border-gray-200"
        >
          <div class="text-sm text-gray-700">
            {{
              t("waitingList.pagination.showing", {
                start: (pagination.page - 1) * pagination.limit + 1,
                end: Math.min(
                  pagination.page * pagination.limit,
                  pagination.total,
                ),
                total: pagination.total,
              })
            }}
          </div>
          <div>
            <nav
              class="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
            >
              <button
                :disabled="pagination.page === 1"
                class="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                @click="
                  pagination.page--;
                  loadWaitingList();
                "
              >
                <ChevronLeft class="h-5 w-5" />
              </button>
              <button
                :disabled="
                  pagination.page * pagination.limit >= pagination.total
                "
                class="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                @click="
                  pagination.page++;
                  loadWaitingList();
                "
              >
                <ChevronRight class="h-5 w-5" />
              </button>
            </nav>
          </div>
        </div>
      </div>
    </div>

    <!-- Add to Queue Dialog -->
    <TransitionRoot as="template" :show="showAddDialog">
      <Dialog as="div" class="relative z-10" @close="showAddDialog = false">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          />
        </TransitionChild>

        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div
            class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
          >
            <TransitionChild
              as="template"
              enter="ease-out duration-300"
              enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enter-to="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leave-from="opacity-100 translate-y-0 sm:scale-100"
              leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel
                class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg"
              >
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <DialogTitle
                    as="h3"
                    class="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    {{ t("waitingList.addCustomer") }}
                  </DialogTitle>
                  <div class="space-y-4">
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("waitingList.customerNameRequired") }}</label
                      >
                      <input
                        v-model="form.customerName"
                        type="text"
                        class="form-input"
                      />
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("waitingList.customerPhoneRequired") }}</label
                      >
                      <input
                        v-model="form.customerPhone"
                        type="tel"
                        class="form-input"
                      />
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("waitingList.partySizeRequired") }}</label
                      >
                      <input
                        v-model.number="form.partySize"
                        type="number"
                        min="1"
                        max="20"
                        class="form-input"
                      />
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("waitingList.notes") }}</label
                      >
                      <textarea
                        v-model="form.notes"
                        rows="3"
                        class="form-input"
                        :placeholder="t('waitingList.notesPlaceholder')"
                      ></textarea>
                    </div>
                    <div
                      v-if="estimatedWait"
                      class="bg-blue-50 border border-blue-200 rounded-lg p-4"
                    >
                      <div class="flex items-start">
                        <Info class="w-5 h-5 text-blue-600 mr-3 mt-0.5" />
                        <div class="text-sm">
                          <p class="font-medium text-blue-900 mb-1">
                            {{
                              t("waitingList.estimatedWaitMinutes", {
                                minutes: estimatedWait.estimatedWaitMinutes,
                              })
                            }}
                          </p>
                          <p class="text-blue-700">
                            {{
                              t("waitingList.partiesAhead", {
                                count: estimatedWait.partiesAhead,
                              })
                            }}
                          </p>
                          <p class="text-blue-700">
                            {{
                              t("waitingList.availableTablesCount", {
                                count: estimatedWait.availableTables,
                              })
                            }}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6"
                >
                  <button
                    :disabled="submitting"
                    class="btn-primary w-full sm:ml-3 sm:w-auto disabled:opacity-50"
                    @click="addToQueue"
                  >
                    <span v-if="!submitting">{{
                      t("waitingList.confirmAdd")
                    }}</span>
                    <span v-else class="flex items-center justify-center">
                      <Loader2 class="animate-spin w-4 h-4 mr-2" />
                      {{ t("waitingList.processing") }}
                    </span>
                  </button>
                  <button
                    class="btn-secondary mt-3 w-full sm:mt-0 sm:w-auto"
                    @click="showAddDialog = false"
                  >
                    {{ t("common.cancel") }}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- Call Customer Dialog -->
    <TransitionRoot as="template" :show="showCallDialog">
      <Dialog as="div" class="relative z-10" @close="showCallDialog = false">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div
            class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"
          />
        </TransitionChild>

        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div
            class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
          >
            <TransitionChild
              as="template"
              enter="ease-out duration-300"
              enter-from="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enter-to="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leave-from="opacity-100 translate-y-0 sm:scale-100"
              leave-to="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <DialogPanel
                class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg"
              >
                <div class="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <DialogTitle
                    as="h3"
                    class="text-lg font-medium leading-6 text-gray-900 mb-4"
                  >
                    {{ t("waitingList.callCustomer") }}
                  </DialogTitle>
                  <div v-if="selectedEntry" class="space-y-4">
                    <div class="bg-gray-50 rounded-lg p-4">
                      <div
                        class="text-3xl font-bold text-center text-gray-900 mb-2"
                      >
                        {{ formatQueueNumber(selectedEntry) }}
                      </div>
                      <div class="text-center">
                        <p class="text-lg font-medium text-gray-900">
                          {{ selectedEntry.customerName }}
                        </p>
                        <p class="text-sm text-gray-600">
                          {{ selectedEntry.customerPhone }}
                        </p>
                        <p class="text-sm text-gray-600">
                          {{ selectedEntry.partySize }}
                          {{ t("waitingList.people") }}
                        </p>
                      </div>
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-1"
                        >{{ t("waitingList.assignTableRequired") }}</label
                      >
                      <select v-model="callForm.tableId" class="form-input">
                        <option :value="null">
                          {{ t("waitingList.selectTable") }}
                        </option>
                        <option
                          v-for="table in availableTables"
                          :key="table.id"
                          :value="table.id"
                        >
                          {{ table.number }} ({{ table.capacity
                          }}{{ t("waitingList.people") }})
                        </option>
                      </select>
                    </div>
                    <div>
                      <label
                        class="block text-sm font-medium text-gray-700 mb-2"
                        >{{ t("waitingList.notificationMethod") }}</label
                      >
                      <div class="space-y-2">
                        <label class="flex items-center">
                          <input
                            v-model="callForm.notificationMethod"
                            type="radio"
                            value="sms"
                            class="form-radio"
                          />
                          <span class="ml-2 text-sm text-gray-700">{{
                            t("waitingList.sms")
                          }}</span>
                        </label>
                        <label class="flex items-center">
                          <input
                            v-model="callForm.notificationMethod"
                            type="radio"
                            value="display"
                            class="form-radio"
                          />
                          <span class="ml-2 text-sm text-gray-700">{{
                            t("waitingList.display")
                          }}</span>
                        </label>
                        <label class="flex items-center">
                          <input
                            v-model="callForm.notificationMethod"
                            type="radio"
                            value="both"
                            class="form-radio"
                          />
                          <span class="ml-2 text-sm text-gray-700">{{
                            t("waitingList.both")
                          }}</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6"
                >
                  <button
                    :disabled="calling"
                    class="btn-primary w-full sm:ml-3 sm:w-auto disabled:opacity-50"
                    @click="confirmCall"
                  >
                    <Bell class="w-4 h-4 mr-2" />
                    <span v-if="!calling">{{
                      t("waitingList.confirmCallBtn")
                    }}</span>
                    <span v-else class="flex items-center justify-center">
                      <Loader2 class="animate-spin w-4 h-4 mr-2" />
                      {{ t("waitingList.calling") }}
                    </span>
                  </button>
                  <button
                    class="btn-secondary mt-3 w-full sm:mt-0 sm:w-auto"
                    @click="showCallDialog = false"
                  >
                    {{ t("common.cancel") }}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted, computed } from "vue";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import {
  Plus,
  Bell,
  Clock,
  Users,
  Search,
  RotateCcw,
  RefreshCw,
  LayoutGrid,
  List,
  User,
  Phone,
  CheckCircle,
  XCircle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Info,
} from "lucide-vue-next";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useAuthStore } from "@/stores/auth";
import { WaitingListService } from "@/services/waitingListService";
import { notifySeatingChanged } from "./seatingEvents";
import { useWebSocketService } from "@/services/websocketService";
import { format } from "date-fns";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";
import {
  RealtimeEventType,
  WaitingStatus,
  type WaitingListEntry,
  type JoinWaitingListRequest,
  type QueueStatus,
  type WaitTimeEstimateResult,
} from "@makanmasak/shared-types";

type WaitingFilterStatus = "" | WaitingStatus;

interface WaitingFiltersState {
  status: WaitingFilterStatus;
  phone: string;
}

interface WaitingListResponseWithPagination {
  data?: WaitingListEntry[];
  pagination?: {
    total?: number;
  };
}

const toast = useToast();
const authStore = useAuthStore();
const wsService = useWebSocketService();
const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();

const WAITING_LIST_REALTIME_EVENTS: RealtimeEventType[] = [
  RealtimeEventType.WAITING_LIST_JOINED,
  RealtimeEventType.WAITING_LIST_CALLED,
  RealtimeEventType.WAITING_LIST_CONFIRMED,
  RealtimeEventType.WAITING_LIST_SEATED,
  RealtimeEventType.WAITING_LIST_CANCELLED,
  RealtimeEventType.WAITING_LIST_EXPIRED,
];

// State
const loading = ref(false);
const submitting = ref(false);
const calling = ref(false);
const batchCalling = ref(false);
const showAddDialog = ref(false);
const showCallDialog = ref(false);
const viewMode = ref<"card" | "table">("card");
const waitingList = ref<WaitingListEntry[]>([]);
const queueStatus = ref<QueueStatus | null>(null);
const selectedEntry = ref<WaitingListEntry | null>(null);
const estimatedWait = ref<WaitTimeEstimateResult | null>(null);
interface AvailableTable {
  id: number;
  number: string;
  capacity: number;
}

const availableTables = ref<AvailableTable[]>([]);

// Filters
const filters = reactive<WaitingFiltersState>({
  status: "",
  phone: "",
});

// Pagination
const pagination = reactive({
  page: 1,
  limit: 50,
  total: 0,
});

// Form
const form = reactive<Partial<JoinWaitingListRequest>>({
  customerName: "",
  customerPhone: "",
  partySize: 2,
  notes: "",
});

// Call form
const callForm = reactive({
  tableId: null as number | null,
  notificationMethod: "both" as "sms" | "display" | "both",
});

let waitingRealtimeSubscriptionId: string | null = null;
let waitingRealtimeRefreshTimer: number | null = null;
let waitingRealtimeActive = false;

// Restaurant ID — use authStore.restaurantId which handles admin managing other restaurants
const restaurantId = computed(() => authStore.restaurantId || "");

/**
 * Load waiting list
 */
async function loadWaitingList() {
  loading.value = true;
  try {
    const response: WaitingListResponseWithPagination =
      await WaitingListService.listWaitingList({
        restaurantId: restaurantId.value,
        status: filters.status || undefined,
        customerPhone: filters.phone || undefined,
        page: pagination.page,
        limit: pagination.limit,
      });

    // API returns { success, data: [...], pagination: {...} }
    waitingList.value = response.data ?? [];
    pagination.total = response.pagination?.total ?? waitingList.value.length;
  } catch (error) {
    console.error("Load waiting list error:", error);
    toast.error(t("waitingList.loadError"));
  } finally {
    loading.value = false;
  }
}

/**
 * Load queue status
 */
async function loadQueueStatus() {
  try {
    queueStatus.value =
      (await WaitingListService.getQueueStatus(restaurantId.value)) ?? null;
    // Every waiting-list action and realtime event ends in this reload.
    notifySeatingChanged();
  } catch (error) {
    console.error("Load queue status error:", error);
  }
}

async function refreshWaitingData() {
  await Promise.all([loadWaitingList(), loadQueueStatus()]);
}

function scheduleRealtimeRefresh() {
  if (waitingRealtimeRefreshTimer !== null) return;

  waitingRealtimeRefreshTimer = window.setTimeout(() => {
    waitingRealtimeRefreshTimer = null;
    void refreshWaitingData();
  }, 250);
}

async function startWaitingRealtime() {
  const currentRestaurantId = restaurantId.value;
  if (!currentRestaurantId || waitingRealtimeSubscriptionId) return;

  waitingRealtimeActive = true;

  try {
    await wsService.connect(currentRestaurantId);

    if (
      !waitingRealtimeActive ||
      waitingRealtimeSubscriptionId ||
      restaurantId.value !== currentRestaurantId
    ) {
      return;
    }

    waitingRealtimeSubscriptionId = wsService.subscribe(
      WAITING_LIST_REALTIME_EVENTS,
      (event) => {
        if (event.restaurantId !== restaurantId.value) return;
        scheduleRealtimeRefresh();
      },
    );
  } catch (error) {
    console.error("Waiting list realtime connect error:", error);
  }
}

function stopWaitingRealtime() {
  waitingRealtimeActive = false;

  if (waitingRealtimeSubscriptionId) {
    wsService.unsubscribe(waitingRealtimeSubscriptionId);
    waitingRealtimeSubscriptionId = null;
  }

  if (waitingRealtimeRefreshTimer !== null) {
    window.clearTimeout(waitingRealtimeRefreshTimer);
    waitingRealtimeRefreshTimer = null;
  }
}

/**
 * Add to queue
 */
async function addToQueue() {
  if (!form.customerName || !form.customerPhone || !form.partySize) {
    toast.warning(t("common.fillRequired"));
    return;
  }

  submitting.value = true;
  try {
    const request: JoinWaitingListRequest = {
      restaurantId: restaurantId.value,
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      partySize: form.partySize,
      notes: form.notes,
    };

    await WaitingListService.joinWaitingList(request);
    toast.success(t("waitingList.addSuccess"));
    showAddDialog.value = false;
    resetForm();
    await loadWaitingList();
    await loadQueueStatus();
  } catch (error: unknown) {
    console.error("Add to queue error:", error);
    toast.error(
      resolveUserFacingError(error, t, { fallbackKey: "waitingList.addError" })
        .message,
    );
  } finally {
    submitting.value = false;
  }
}

/**
 * Call customer
 */
function callCustomer(entry: WaitingListEntry) {
  selectedEntry.value = entry;
  callForm.tableId = null;
  // TODO: Load available tables
  availableTables.value = [];
  showCallDialog.value = true;
}

/**
 * Confirm call
 */
async function confirmCall() {
  if (!callForm.tableId) {
    toast.warning(t("waitingList.selectTableRequired"));
    return;
  }

  calling.value = true;
  try {
    await WaitingListService.callWaiting(selectedEntry.value!.id, {
      tableId: callForm.tableId,
    });

    toast.success(t("waitingList.callSuccess"));
    showCallDialog.value = false;
    await loadWaitingList();
    await loadQueueStatus();
  } catch (error: unknown) {
    console.error("Call waiting error:", error);
    toast.error(
      resolveUserFacingError(error, t, { fallbackKey: "waitingList.callError" })
        .message,
    );
  } finally {
    calling.value = false;
  }
}

/**
 * Batch call next
 */
async function batchCallNext() {
  batchCalling.value = true;
  try {
    await WaitingListService.batchCall(restaurantId.value, 1);
    toast.success(t("waitingList.callSuccess"));
    await loadWaitingList();
    await loadQueueStatus();
  } catch (error: unknown) {
    console.error("Batch call error:", error);
    toast.error(
      resolveUserFacingError(error, t, { fallbackKey: "waitingList.callError" })
        .message,
    );
  } finally {
    batchCalling.value = false;
  }
}

/**
 * Mark seated
 */
async function markSeated(id: string) {
  try {
    await WaitingListService.markSeated(id);
    toast.success(t("waitingList.seatSuccess"));
    await loadWaitingList();
    await loadQueueStatus();
  } catch (error: unknown) {
    console.error("Mark seated error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "waitingList.seatedError",
      }).message,
    );
  }
}

/**
 * Mark expired
 */
async function markExpired(id: string) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("waitingList.expireTitle"),
    message: t("waitingList.expirePrompt"),
    confirmLabel: t("waitingList.expireAction"),
  });
  if (!confirmed) return;

  try {
    await WaitingListService.expireWaiting(id);
    toast.success(t("waitingList.expireSuccess"));
    await loadWaitingList();
    await loadQueueStatus();
  } catch (error: unknown) {
    console.error("Mark expired error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "waitingList.expireError",
      }).message,
    );
  }
}

/**
 * Cancel entry
 */
async function cancelEntry(entry: WaitingListEntry) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("waitingList.cancelTitle"),
    message: t("waitingList.cancelPrompt"),
    confirmLabel: t("waitingList.cancelAction"),
  });
  if (!confirmed) return;

  try {
    await WaitingListService.cancelWaiting(entry.id, entry.customerPhone);
    toast.success(t("waitingList.cancelSuccess"));
    await loadWaitingList();
    await loadQueueStatus();
  } catch (error: unknown) {
    console.error("Cancel entry error:", error);
    toast.error(
      resolveUserFacingError(error, t, {
        fallbackKey: "waitingList.cancelError",
      }).message,
    );
  }
}

/**
 * Reset filters
 */
function resetFilters() {
  filters.status = "";
  filters.phone = "";
  pagination.page = 1;
  loadWaitingList();
}

/**
 * Reset form
 */
function resetForm() {
  form.customerName = "";
  form.customerPhone = "";
  form.partySize = 2;
  form.notes = "";
}

/**
 * Format queue number
 */
function formatQueueNumber(entry: WaitingListEntry): string {
  return entry.queueNumber
    ? `#${entry.queueNumber}`
    : `#${entry.id.slice(0, 6)}`;
}

/**
 * Format time
 */
function formatTime(date: string | Date | number): string {
  return format(new Date(date), "HH:mm");
}

/**
 * Get status text
 */
function getStatusText(status: string): string {
  const key = `waitingList.statusText.${status}`;
  const result = t(key);
  return result === key ? status : result;
}

/**
 * Get status badge class
 */
function getStatusBadgeClass(status: string): string {
  const classMap: Record<string, string> = {
    waiting: "bg-orange-100 text-orange-800",
    called: "bg-blue-100 text-blue-800",
    confirmed: "bg-green-100 text-green-800",
    seated: "bg-teal-100 text-teal-800",
    cancelled: "bg-gray-100 text-gray-800",
    expired: "bg-red-100 text-red-800",
  };
  return classMap[status] || "bg-gray-100 text-gray-800";
}

// Initialize
onMounted(async () => {
  await loadWaitingList();
  await loadQueueStatus();
  await startWaitingRealtime();
});

onUnmounted(() => {
  stopWaitingRealtime();
});
</script>
