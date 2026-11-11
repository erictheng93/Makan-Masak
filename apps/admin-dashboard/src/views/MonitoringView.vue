<template>
  <div class="ui-page min-h-screen bg-gray-50 py-6">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <!-- Header -->
      <div class="mb-8">
        <div class="ui-toolbar flex items-center justify-between">
          <div>
            <h1 class="ui-page-heading text-3xl font-bold text-gray-900">
              {{ t("monitoring.title") }}
            </h1>
            <p class="mt-2 text-sm text-gray-600">
              {{ t("monitoring.subtitle") }}
            </p>
          </div>

          <div class="flex items-center space-x-3">
            <!-- Auto refresh toggle -->
            <button
              :class="[
                'inline-flex items-center px-3 py-2 border rounded-md text-sm font-medium transition-colors',
                autoRefresh
                  ? 'border-green-500 bg-green-50 text-green-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
              ]"
              :data-active="autoRefresh"
              @click="toggleAutoRefresh"
            >
              <component
                :is="autoRefresh ? CheckCircleIcon : XCircleIcon"
                class="w-4 h-4 mr-2"
              />
              {{
                autoRefresh
                  ? t("monitoring.actions.autoRefresh")
                  : t("monitoring.actions.manualRefresh")
              }}
            </button>

            <!-- Refresh button -->
            <button
              :disabled="loading"
              class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-700 hover:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              data-testid="manual-refresh"
              @click="refreshAllData()"
            >
              <ArrowPathIcon
                :class="['w-4 h-4 mr-2', { 'animate-spin': loading }]"
              />
              {{
                loading
                  ? t("monitoring.actions.refreshing")
                  : t("monitoring.actions.refresh")
              }}
            </button>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="initialLoading" class="flex justify-center items-center py-12">
        <div class="text-center">
          <div
            class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"
          ></div>
          <p class="mt-4 text-gray-600">
            {{ t("monitoring.misc.loadingData") }}
          </p>
        </div>
      </div>

      <!-- Main Content -->
      <template v-else>
        <!-- Overall Health Status -->
        <div class="mb-8">
          <div class="ui-panel bg-white overflow-hidden shadow-lg rounded-lg">
            <div class="px-6 py-8">
              <div
                class="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:gap-0"
              >
                <div class="flex-shrink-0">
                  <div
                    :class="[
                      'w-20 h-20 rounded-full flex items-center justify-center',
                      getHealthBgColor(overview?.status || 'down'),
                    ]"
                  >
                    <component
                      :is="getHealthIcon(overview?.status || 'down')"
                      class="w-10 h-10 text-white"
                    />
                  </div>
                </div>

                <div class="ml-0 min-w-0 w-full flex-1 sm:ml-6 sm:w-auto">
                  <div
                    class="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                  >
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-3">
                        <h2 class="text-2xl font-bold text-gray-900">
                          {{ t("monitoring.health.overall") }}
                        </h2>
                        <span
                          :class="[
                            'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
                            getHealthBadgeColor(overview?.status || 'down'),
                          ]"
                        >
                          {{ getHealthStatusText(overview?.status || "down") }}
                        </span>
                      </div>

                      <div
                        class="mt-3 flex flex-wrap items-start gap-x-6 gap-y-4"
                      >
                        <div>
                          <div class="text-sm text-gray-500 mb-1">
                            {{ t("monitoring.health.score") }}
                          </div>
                          <div class="flex items-baseline">
                            <span class="text-4xl font-bold text-gray-900">
                              {{ healthScoreDisplay }}
                            </span>
                            <span class="text-xl text-gray-500 ml-1">/100</span>
                          </div>
                          <!-- The score only covers groups the API measures;
                               saying which keeps 100 from overclaiming. -->
                          <div
                            v-if="healthScoreBasis.length"
                            class="max-w-full [overflow-wrap:anywhere] text-xs text-gray-500 mt-1"
                          >
                            {{
                              t("monitoring.health.basis", {
                                groups: healthScoreBasis.join(", "),
                              })
                            }}
                          </div>
                        </div>

                        <div>
                          <div class="text-sm text-gray-500 mb-1">
                            {{ t("monitoring.misc.uptime") }}
                          </div>
                          <div
                            class="[overflow-wrap:anywhere] text-lg font-semibold text-gray-900"
                          >
                            {{ formatUptime(overview?.uptime || 0) }}
                          </div>
                        </div>

                        <div>
                          <div class="text-sm text-gray-500 mb-1">
                            {{ t("monitoring.misc.lastUpdate") }}
                          </div>
                          <div
                            class="[overflow-wrap:anywhere] text-lg font-semibold text-gray-900"
                          >
                            {{ formatLastUpdate(lastUpdateTime) }}
                          </div>
                        </div>
                      </div>

                      <!-- Health Score Progress Bar -->
                      <div class="mt-4 max-w-md">
                        <div
                          class="ui-toolbar flex justify-between text-sm text-gray-600 mb-1"
                        >
                          <span>{{ t("monitoring.misc.systemHealth") }}</span>
                          <span>{{ healthScoreDisplay }}%</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-3">
                          <div
                            :class="[
                              'h-3 rounded-full transition-all duration-500',
                              getHealthScoreColor(healthScore ?? 0),
                            ]"
                            :style="{ width: `${healthScore ?? 0}%` }"
                          />
                        </div>
                      </div>
                    </div>

                    <!-- Health Score Gauge Chart -->
                    <div class="max-w-full shrink-0 self-center sm:self-auto">
                      <HealthScoreGauge
                        :score="healthScore ?? 0"
                        :label="t('monitoring.health.score')"
                        :size="200"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Key Metrics Cards -->
        <div class="mb-8">
          <h3 class="text-lg font-medium text-gray-900 mb-4">
            {{ t("monitoring.keyMetrics.title") }}
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div
              v-for="metric in keyMetricsCards"
              :key="metric.id"
              class="ui-panel bg-white overflow-hidden shadow rounded-lg"
            >
              <div class="p-5">
                <div class="flex items-center">
                  <div class="flex-shrink-0">
                    <div
                      :class="[
                        'w-12 h-12 rounded-lg flex items-center justify-center',
                        metric.bgColor,
                      ]"
                    >
                      <component
                        :is="metric.icon"
                        :class="['w-6 h-6', metric.iconColor]"
                      />
                    </div>
                  </div>
                  <div class="ml-5 w-0 flex-1">
                    <dl>
                      <dt class="text-sm font-medium text-gray-500 truncate">
                        {{ metric.name }}
                      </dt>
                      <dd class="flex items-baseline">
                        <div class="text-2xl font-semibold text-gray-900">
                          {{ metric.value }}
                        </div>
                        <div
                          :class="[
                            'ml-2 flex items-baseline text-sm font-semibold',
                            metric.trendColor,
                          ]"
                        >
                          <component
                            :is="metric.trendIcon"
                            class="w-4 h-4 mr-1"
                          />
                          {{ metric.trend }}
                        </div>
                      </dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Real-time Alert Notifications (platform admin only — see canManageAlerts) -->
        <div v-if="canManageAlerts" class="mb-8">
          <AlertNotificationPanel
            :alerts="wsAlerts"
            :connection-status="wsConnectionStatus"
            @acknowledge="handleAcknowledgeAlert"
            @clear-all="handleClearAllAlerts"
            @reconnect="handleReconnectWebSocket"
          />
        </div>

        <!-- Components Status Grid -->
        <div class="mb-8">
          <h3 class="text-lg font-medium text-gray-900 mb-4">
            {{ t("monitoring.components.title") }}
          </h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div
              v-for="component in componentsStatus"
              :key="component.name"
              class="ui-panel bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
            >
              <div class="p-5">
                <div class="ui-toolbar flex items-center justify-between mb-3">
                  <h4 class="text-sm font-medium text-gray-900">
                    {{ component.displayName }}
                  </h4>
                  <span
                    :class="[
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      getComponentStatusColor(component.status),
                    ]"
                  >
                    {{ getComponentStatusText(component.status) }}
                  </span>
                </div>

                <!-- Health Indicator -->
                <div class="mb-3">
                  <div
                    class="ui-toolbar flex justify-between text-xs text-gray-600 mb-1"
                  >
                    <span>{{ t("monitoring.components.healthScore") }}</span>
                    <span>{{ component.healthScore }}/100</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-2">
                    <div
                      :class="[
                        'h-2 rounded-full transition-all duration-300',
                        getHealthScoreColor(component.healthScore),
                      ]"
                      :style="{ width: `${component.healthScore}%` }"
                    />
                  </div>
                </div>

                <!-- Component Details -->
                <div class="text-xs text-gray-500 space-y-1">
                  <div v-if="component.latency !== undefined">
                    {{ t("monitoring.components.latency") }}:
                    {{ Math.round(component.latency) }}ms
                  </div>
                  <div v-if="component.errorRate !== undefined">
                    {{ t("monitoring.components.errorRate") }}:
                    {{ (component.errorRate * 100).toFixed(2) }}%
                  </div>
                  <div v-if="component.issues.length > 0">
                    {{
                      t("monitoring.components.issueCount", {
                        count: component.issues.length,
                      })
                    }}
                  </div>
                  <div>
                    {{ t("monitoring.components.lastCheck") }}:
                    {{ formatRelativeTime(component.lastCheck) }}
                  </div>
                </div>

                <!-- Issues List -->
                <div
                  v-if="component.issues.length > 0"
                  class="mt-3 pt-3 border-t border-gray-200"
                >
                  <div class="text-xs font-medium text-red-700 mb-1">
                    {{ t("monitoring.components.issuesFound") }}
                  </div>
                  <ul class="text-xs text-red-700 space-y-1">
                    <li
                      v-for="(issue, idx) in component.issues"
                      :key="idx"
                      class="truncate"
                    >
                      {{ issue }}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Alert Rules & Performance Report in Tabs -->
        <div class="mb-8">
          <div class="ui-panel bg-white shadow rounded-lg">
            <!-- Tabs -->
            <div class="border-b border-gray-200">
              <nav class="-mb-px flex space-x-8 px-6" aria-label="Tabs">
                <button
                  v-for="tab in tabs"
                  :key="tab.id"
                  :class="[
                    'py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap',
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                  ]"
                  @click="activeTab = tab.id as typeof activeTab"
                >
                  <div class="flex items-center">
                    <component :is="tab.icon" class="w-5 h-5 mr-2" />
                    {{ tab.name }}
                    <span
                      v-if="tab.badge"
                      :class="[
                        'ml-2 py-0.5 px-2 rounded-full text-xs font-medium',
                        activeTab === tab.id
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600',
                      ]"
                    >
                      {{ tab.badge }}
                    </span>
                  </div>
                </button>
              </nav>
            </div>

            <!-- Tab Content -->
            <div class="p-6">
              <!-- Alert Rules Tab -->
              <div v-if="activeTab === 'alerts'" class="space-y-4">
                <div class="ui-toolbar flex justify-between items-center mb-4">
                  <h3 class="text-lg font-medium text-gray-900">
                    {{ t("monitoring.alerts.title") }}
                  </h3>
                  <button
                    class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-700 hover:bg-primary-800"
                    @click="showCreateAlertDialog = true"
                  >
                    <PlusIcon class="w-4 h-4 mr-2" />
                    {{ t("monitoring.misc.createAlertRule") }}
                  </button>
                </div>

                <!-- Alert Rules List -->
                <div v-if="alertRules.length > 0" class="space-y-3">
                  <div
                    v-for="rule in alertRules"
                    :key="rule.id"
                    class="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                  >
                    <div class="ui-toolbar flex items-center justify-between">
                      <div class="flex-1">
                        <div class="flex items-center">
                          <h4 class="text-sm font-medium text-gray-900">
                            {{ rule.name }}
                          </h4>
                          <span
                            :class="[
                              'ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                              rule.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800',
                            ]"
                          >
                            {{
                              rule.isActive
                                ? t("monitoring.misc.enabled")
                                : t("monitoring.misc.disabled")
                            }}
                          </span>
                          <span
                            :class="[
                              'ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
                              getAlertSeverityBadgeColor(rule.config.severity),
                            ]"
                          >
                            {{ getAlertSeverityText(rule.config.severity) }}
                          </span>
                        </div>
                        <p class="mt-1 text-sm text-gray-500">
                          {{ rule.condition }}
                        </p>
                        <div
                          class="mt-2 flex items-center text-xs text-gray-500 space-x-4"
                        >
                          <span
                            >{{ t("monitoring.misc.triggerCount") }}:
                            {{ rule.triggerCount }}</span
                          >
                          <span v-if="rule.lastTriggered">
                            {{ t("monitoring.misc.lastTriggered") }}:
                            {{ formatRelativeTime(rule.lastTriggered) }}
                          </span>
                        </div>
                      </div>
                      <div class="ml-4 flex items-center space-x-2">
                        <button
                          :aria-label="
                            rule.isActive
                              ? t('a11y.pauseRule')
                              : t('a11y.resumeRule')
                          "
                          class="p-2 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                          @click="toggleAlertRule(rule)"
                        >
                          <component
                            :is="rule.isActive ? PauseIcon : PlayIcon"
                            class="w-5 h-5"
                          />
                        </button>
                        <button
                          :aria-label="t('common.delete')"
                          class="p-2 text-red-700 hover:text-red-700 rounded-md hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
                          @click="deleteAlert(rule.id)"
                        >
                          <TrashIcon class="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="text-center py-12">
                  <BellIcon class="mx-auto h-12 w-12 text-gray-400" />
                  <h3 class="mt-2 text-sm font-medium text-gray-900">
                    {{ t("monitoring.misc.noAlertRules") }}
                  </h3>
                  <p class="mt-1 text-sm text-gray-500">
                    {{ t("monitoring.misc.createAlertRuleHint") }}
                  </p>
                  <div class="mt-6">
                    <button
                      class="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-700 hover:bg-primary-800"
                      @click="showCreateAlertDialog = true"
                    >
                      <PlusIcon class="w-4 h-4 mr-2" />
                      {{ t("monitoring.misc.createAlertRule") }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Performance Report Tab -->
              <div v-if="activeTab === 'performance'" class="space-y-6">
                <div class="ui-toolbar flex justify-between items-center mb-4">
                  <h3 class="text-lg font-medium text-gray-900">
                    {{ t("monitoring.performance.title") }}
                  </h3>
                  <select
                    v-model="reportDays"
                    class="block w-40 pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                    @change="loadPerformanceReport"
                  >
                    <option :value="1">
                      {{ t("monitoring.performance.last1Day") }}
                    </option>
                    <option :value="7">
                      {{ t("monitoring.performance.last7Days") }}
                    </option>
                    <option :value="30">
                      {{ t("monitoring.performance.last30Days") }}
                    </option>
                  </select>
                </div>

                <div v-if="performanceReport">
                  <!-- API Performance -->
                  <div class="bg-gray-50 rounded-lg p-6">
                    <h4 class="text-md font-medium text-gray-900 mb-4">
                      {{ t("monitoring.performance.api.title") }}
                    </h4>
                    <dl class="grid grid-cols-2 gap-4">
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.api.totalRequests") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.apiPerformance.totalRequests.toLocaleString()
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{
                            t("monitoring.performance.api.averageResponseTime")
                          }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.apiPerformance.averageResponseTime.toFixed(
                              0,
                            )
                          }}ms
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.api.p95ResponseTime") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.apiPerformance.p95ResponseTime.toFixed(
                              0,
                            )
                          }}ms
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.api.errorRate") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{ performanceReport.apiPerformance.errorRate }}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <!-- Database Performance -->
                  <div class="bg-gray-50 rounded-lg p-6">
                    <h4 class="text-md font-medium text-gray-900 mb-4">
                      {{ t("monitoring.performance.database.title") }}
                    </h4>
                    <dl class="grid grid-cols-2 gap-4">
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{
                            t("monitoring.performance.database.totalQueries")
                          }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.databasePerformance.totalQueries.toLocaleString()
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{
                            t(
                              "monitoring.performance.database.averageQueryTime",
                            )
                          }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.databasePerformance.averageQueryTime.toFixed(
                              0,
                            )
                          }}ms
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.database.slowQueries") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.databasePerformance.slowQueries
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{
                            t("monitoring.performance.database.queryErrorRate")
                          }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{
                            performanceReport.databasePerformance.queryErrorRate
                          }}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <!-- Cache Performance -->
                  <div class="bg-gray-50 rounded-lg p-6">
                    <h4 class="text-md font-medium text-gray-900 mb-4">
                      {{ t("monitoring.performance.cache.title") }}
                    </h4>
                    <dl class="grid grid-cols-2 gap-4">
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.cache.hitRate") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{ performanceReport.cachePerformance.hitRate }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.cache.totalKeys") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{ performanceReport.cachePerformance.totalKeys }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.cache.totalSize") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{ performanceReport.cachePerformance.totalSize }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-sm text-gray-500">
                          {{ t("monitoring.performance.cache.expiringKeys") }}
                        </dt>
                        <dd class="text-lg font-semibold text-gray-900">
                          {{ performanceReport.cachePerformance.expiringKeys }}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <!-- Performance Trend Charts -->
                  <div
                    v-if="performanceChartData.length > 0"
                    class="space-y-6 mt-6"
                  >
                    <!-- Multi-metric comparison chart -->
                    <div class="bg-gray-50 rounded-lg p-6">
                      <h4 class="text-md font-medium text-gray-900 mb-4">
                        {{ t("monitoring.performance.charts.trendComparison") }}
                      </h4>
                      <div class="h-80">
                        <MultiMetricChart
                          :series="multiMetricChartSeries"
                          unit="ms"
                          :y-axis-label="t('monitoring.misc.responseTimeUnit')"
                        />
                      </div>
                    </div>

                    <!-- Cache hit rate trend -->
                    <div class="bg-gray-50 rounded-lg p-6">
                      <h4 class="text-md font-medium text-gray-900 mb-4">
                        {{ t("monitoring.performance.charts.cacheHitRate") }}
                      </h4>
                      <div class="h-64">
                        <MetricTrendChart
                          :label="t('monitoring.performance.cache.hitRate')"
                          color="#30b0c7"
                          :data="cacheHitRateTrendData"
                          fill-color="rgba(139, 92, 246, 0.1)"
                          unit="%"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- Recommendations -->
                  <div
                    v-if="performanceReport.recommendations.length > 0"
                    class="bg-blue-50 border-l-4 border-blue-400 p-4 rounded"
                  >
                    <div class="flex">
                      <div class="flex-shrink-0">
                        <InformationCircleIcon class="h-5 w-5 text-blue-700" />
                      </div>
                      <div class="ml-3">
                        <h3 class="text-sm font-medium text-blue-800">
                          {{
                            t("monitoring.performance.recommendations.title")
                          }}
                        </h3>
                        <div class="mt-2 text-sm text-blue-700">
                          <ul class="list-disc list-inside space-y-1">
                            <li
                              v-for="(
                                recommendation, idx
                              ) in performanceReport.recommendations"
                              :key="idx"
                            >
                              {{ recommendation }}
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="text-center py-12">
                  <ChartBarIcon class="mx-auto h-12 w-12 text-gray-400" />
                  <h3 class="mt-2 text-sm font-medium text-gray-900">
                    {{ t("monitoring.performance.recommendations.loading") }}
                  </h3>
                </div>
              </div>

              <!-- Errors Tab -->
              <div v-if="activeTab === 'errors'" class="space-y-4">
                <h3 class="text-lg font-medium text-gray-900 mb-4">
                  {{ t("monitoring.errors.title") }}
                </h3>

                <div
                  v-if="overview?.topErrors && overview.topErrors.length > 0"
                  class="space-y-6"
                >
                  <!-- Error bar chart -->
                  <div class="bg-gray-50 rounded-lg p-6">
                    <h4 class="text-md font-medium text-gray-900 mb-4">
                      {{ t("monitoring.errors.statistics") }}
                    </h4>
                    <div class="h-80">
                      <MetricBarChart
                        :data="errorBarChartData"
                        :title="t('monitoring.errors.errorCount')"
                        :unit="t('monitoring.misc.chartUnit')"
                        :horizontal="true"
                      />
                    </div>
                  </div>

                  <!-- Error list -->
                  <div class="space-y-3">
                    <h4 class="text-md font-medium text-gray-900">
                      {{ t("monitoring.errors.details") }}
                    </h4>
                    <div
                      v-for="error in overview.topErrors"
                      :key="error.type"
                      class="border border-gray-200 rounded-lg p-4"
                    >
                      <div class="ui-toolbar flex items-center justify-between">
                        <div>
                          <h4 class="text-sm font-medium text-gray-900">
                            {{ error.type }}
                          </h4>
                          <p class="text-sm text-gray-500 mt-1">
                            {{ t("monitoring.errors.occurredTimes") }}:
                            {{ error.count }}
                          </p>
                        </div>
                        <ExclamationTriangleIcon class="w-6 h-6 text-red-700" />
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="text-center py-12">
                  <CheckCircleIcon class="mx-auto h-12 w-12 text-green-700" />
                  <h3 class="mt-2 text-sm font-medium text-gray-900">
                    {{ t("monitoring.errors.noErrors") }}
                  </h3>
                  <p class="mt-1 text-sm text-gray-500">
                    {{ t("monitoring.errors.systemRunningNormally") }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Create Alert Rule Dialog -->
    <CreateAlertRuleModal
      :show="showCreateAlertDialog"
      @close="showCreateAlertDialog = false"
      @created="handleAlertRuleCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useToast } from "vue-toastification";
import { useI18n } from "@/i18n";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowPathIcon,
  BellIcon,
  ChartBarIcon,
  InformationCircleIcon,
  PlusIcon,
  TrashIcon,
  PlayIcon,
  PauseIcon,
  ClockIcon,
  ServerIcon,
  CircleStackIcon,
  MinusIcon,
} from "@heroicons/vue/24/outline";
import { monitoringService } from "@/services/monitoringService";
import type {
  MonitoringOverview,
  SystemMetrics,
  AlertRule,
  PerformanceReport,
  HealthStatusType,
  ComponentStatusType,
  ComponentOverview,
} from "@/types/monitoring";
import HealthScoreGauge from "@/components/monitoring/HealthScoreGauge.vue";
import MultiMetricChart from "@/components/monitoring/MultiMetricChart.vue";
import MetricBarChart from "@/components/monitoring/MetricBarChart.vue";
import MetricTrendChart from "@/components/monitoring/MetricTrendChart.vue";
import AlertNotificationPanel from "@/components/monitoring/AlertNotificationPanel.vue";
import CreateAlertRuleModal from "@/components/monitoring/CreateAlertRuleModal.vue";
import { monitoringWebSocket } from "@/services/monitoringWebSocket";
import { createVisibilityAwarePoller } from "@/services/visibilityAwarePoller";
import { useConfirmModal } from "@/composables/useConfirmModal";
import { useAuthStore } from "@/stores/auth";
import { UserRole } from "@/types";

const toast = useToast();
const { t } = useI18n();
const { confirm: confirmModal } = useConfirmModal();
const authStore = useAuthStore();

/**
 * 告警規則存在單一全域 KV key 底下，沒有 restaurant 欄位，/alerts/recent 也會
 * 回傳其他租戶的錯誤路徑與例外訊息，所以 API 端已把整組 /alerts/* 收成 role 0
 * 專用。這裡必須同步：店主留在這頁仍看得到指標、健康度與錯誤統計，但告警分頁
 * 要整個收起來，否則 getAlertRules 會 rethrow，店主一進來就是錯誤狀態。
 */
const canManageAlerts = computed(() => authStore.userRole === UserRole.ADMIN);

/**
 * Matched to METRICS_CACHE_TTL_SECONDS in the API's MonitoringService, which is
 * how often the Analytics Engine aggregate behind these panels is recomputed.
 * Polling faster than that cannot surface newer numbers -- the previous 30s
 * interval meant every other refresh was guaranteed to redisplay identical data
 * while still spending a D1 probe, five KV reads and three Worker requests.
 */
const AUTO_REFRESH_INTERVAL_MS = 60_000;

// ============================================================================
// State
// ============================================================================

const loading = ref(false);
const initialLoading = ref(true);
const autoRefresh = ref(true);
const lastUpdateTime = ref(Date.now());
/** Latches so an outage does not raise the same toast on every interval. */
const refreshFailed = ref(false);
const showCreateAlertDialog = ref(false);

const overview = ref<MonitoringOverview | null>(null);
const metrics = ref<SystemMetrics | null>(null);
const alertRules = ref<AlertRule[]>([]);
const performanceReport = ref<PerformanceReport | null>(null);

// 店主看不到告警分頁，預設分頁要跟著落到他實際看得到的第一個分頁。
const activeTab = ref<"alerts" | "performance" | "errors">(
  canManageAlerts.value ? "alerts" : "performance",
);
const reportDays = ref(7);

// WebSocket state
const wsConnected = ref(false);
const wsAlerts = monitoringWebSocket.alerts;
const wsConnectionStatus = monitoringWebSocket.connectionStatus;

/**
 * Skips its tick while the tab is in the background and catches up on the way
 * back, but only when a whole interval actually elapsed -- flicking between
 * tabs should not cost a refresh.
 */
const refreshPoller = createVisibilityAwarePoller({
  intervalMs: AUTO_REFRESH_INTERVAL_MS,
  onTick: () => refreshAllData({ silent: true }),
  shouldCatchUp: () =>
    Date.now() - lastUpdateTime.value >= AUTO_REFRESH_INTERVAL_MS,
});

// ============================================================================
// Computed
// ============================================================================

// null means "not enough measured data to score", which is different from 0.
// Returning 0 for absent data reported a healthy system as totally broken.
const healthScore = computed<number | null>(() => {
  if (!metrics.value) return null;
  return monitoringService.calculateHealthScore(metrics.value);
});

const healthScoreDisplay = computed(() =>
  healthScore.value === null ? "—" : String(healthScore.value),
);

// Which metric groups the score actually covers. 100 across one group is a
// weaker claim than 100 across four, and the UI should not hide that.
const healthScoreBasis = computed(() =>
  metrics.value ? monitoringService.healthScoreBasis(metrics.value) : [],
);

const tabs = computed(() => [
  ...(canManageAlerts.value
    ? [
        {
          id: "alerts",
          name: t("monitoring.tabs.alerts"),
          icon: BellIcon,
          badge: alertRules.value.length,
        },
      ]
    : []),
  {
    id: "performance",
    name: t("monitoring.tabs.performance"),
    icon: ChartBarIcon,
    badge: null,
  },
  {
    id: "errors",
    name: t("monitoring.tabs.errors"),
    icon: ExclamationTriangleIcon,
    badge: overview.value?.topErrors?.length || 0,
  },
]);

const keyMetricsCards = computed(() => {
  if (!overview.value) return [];

  return [
    {
      id: "requests",
      name: t("monitoring.keyMetrics.requestsPerMinute"),
      value: overview.value.keyMetrics.requestsPerMinute,
      trend: t("monitoring.misc.live"),
      trendIcon: MinusIcon,
      trendColor: "text-gray-400",
      icon: ServerIcon,
      iconColor: "text-blue-700",
      bgColor: "bg-blue-50",
    },
    {
      id: "response",
      name: t("monitoring.keyMetrics.averageResponseTime"),
      value: overview.value.keyMetrics.averageResponseTime,
      trend: t("monitoring.misc.live"),
      trendIcon: MinusIcon,
      trendColor: "text-gray-400",
      icon: ClockIcon,
      iconColor: "text-green-700",
      bgColor: "bg-green-50",
    },
    {
      id: "cache",
      name: t("monitoring.keyMetrics.cacheHitRate"),
      value: overview.value.keyMetrics.cacheHitRate,
      trend: t("monitoring.misc.live"),
      trendIcon: MinusIcon,
      trendColor: "text-gray-400",
      icon: CircleStackIcon,
      iconColor: "text-teal-700",
      bgColor: "bg-teal-50",
    },
    {
      // 5xx only. Client 4xx is shown as its own subtitle rather than folded in
      // here: an expired session's 401 is the system working, and counting it
      // as an active error hides real server faults in routine noise.
      id: "errors",
      name: t("monitoring.keyMetrics.serverErrors"),
      value: overview.value.keyMetrics.serverErrors,
      subtitle: t("monitoring.keyMetrics.clientErrorsNote", {
        count: overview.value.keyMetrics.clientErrors,
      }),
      trend:
        overview.value.keyMetrics.serverErrors === 0
          ? t("monitoring.misc.stable")
          : t("monitoring.misc.live"),
      trendIcon:
        overview.value.keyMetrics.serverErrors === 0
          ? CheckCircleIcon
          : ExclamationTriangleIcon,
      trendColor:
        overview.value.keyMetrics.serverErrors === 0
          ? "text-green-700"
          : "text-red-700",
      icon: ExclamationTriangleIcon,
      iconColor: "text-red-700",
      bgColor: "bg-red-50",
    },
  ];
});

const componentsStatus = computed(() => {
  if (!overview.value) return [];

  return overview.value.components.map((comp) => ({
    name: comp.name,
    displayName: getComponentDisplayName(comp.name),
    status: comp.status,
    healthScore: calculateComponentHealthScore(comp),
    latency: comp.latency,
    errorRate: comp.issues > 0 ? comp.issues / 100 : 0,
    issues: comp.issueDetails || [],
    lastCheck: comp.lastCheck,
  }));
});

// Chart data - Single point from current real metrics
const performanceChartData = computed(() => {
  if (!metrics.value) return [];

  return [
    {
      timestamp: Date.now(),
      apiResponseTime: metrics.value.apiMetrics.averageResponseTime,
      dbQueryTime: metrics.value.databaseMetrics.averageQueryTime,
      cacheHitRate: metrics.value.cacheMetrics.hitRate,
    },
  ];
});

// Only plot a series the API actually measures. Database and cache metrics
// have no data source at all — recordDatabaseQuery is never called and
// cacheMonitoringMiddleware is never registered — so they arrive as zeroes.
// Charting those next to real API latency presented "0ms queries, 0% hit rate"
// as observed values.
const multiMetricChartSeries = computed(() => {
  const series = [];

  if (metrics.value?.measured?.api) {
    series.push({
      label: t("monitoring.performance.charts.apiResponseTime"),
      data: performanceChartData.value.map((d) => ({
        timestamp: d.timestamp,
        value: d.apiResponseTime,
      })),
      color: "#007aff",
      fillColor: "rgba(59, 130, 246, 0.1)",
    });
  }

  if (metrics.value?.measured?.database) {
    series.push({
      label: t("monitoring.performance.charts.dbQueryTime"),
      data: performanceChartData.value.map((d) => ({
        timestamp: d.timestamp,
        value: d.dbQueryTime,
      })),
      color: "#34c759",
      fillColor: "rgba(16, 185, 129, 0.1)",
    });
  }

  return series;
});

const cacheHitRateTrendData = computed(() => {
  if (!metrics.value?.measured?.cache) return [];

  return performanceChartData.value.map((d) => ({
    timestamp: d.timestamp,
    value: d.cacheHitRate * 100,
  }));
});

const errorBarChartData = computed(() => {
  if (!overview.value?.topErrors) return [];

  return overview.value.topErrors.map((error) => ({
    label: error.type,
    value: error.count,
    color: "#ff3b30",
  }));
});

// ============================================================================
// Methods
// ============================================================================

/**
 * @param options.silent Set by the auto-refresh loop. A background refresh that
 *   worked is not news, and at one toast a minute it was pure interruption; the
 *   "last update" timestamp and the button spinner already report success.
 *   Failures are still reported either way.
 */
async function refreshAllData(options: { silent?: boolean } = {}) {
  loading.value = true;
  try {
    // Alert rules are deliberately not reloaded here. They are configuration,
    // not telemetry -- they change only when an operator edits them, and every
    // path that edits them reloads them itself. Polling them alongside the
    // metrics spent a request and a KV read a minute re-fetching a list that is
    // identical for days at a time.
    await loadOverviewWithMetrics();
    lastUpdateTime.value = Date.now();
    refreshFailed.value = false;
    if (!options.silent) {
      toast.success(t("monitoring.notifications.dataUpdated"));
    }
  } catch (error) {
    console.error("Failed to refresh data:", error);
    // A manual refresh always answers the click. A background one reports only
    // the transition into failure: during an outage the loop would otherwise
    // raise the same toast every minute, and "last update" ageing on screen is
    // already the persistent signal.
    const shouldReport = !options.silent || !refreshFailed.value;
    refreshFailed.value = true;
    if (shouldReport) {
      toast.error(t("monitoring.notifications.updateFailed"));
    }
  } finally {
    loading.value = false;
  }
}

/**
 * One request for both panels. /overview already loads the metrics to derive
 * its keyMetrics and trends, so asking it to return them costs the API nothing
 * and drops a whole round trip -- with it a Worker request and a KV read --
 * from every refresh. It also removes a skew the two-request version had, where
 * the summary and the raw numbers could come from different aggregate windows.
 */
async function loadOverviewWithMetrics() {
  // Deliberately not caught here. Swallowing the failure made Promise.all
  // resolve regardless, so refreshAllData reported "updated" and advanced the
  // "last update" clock while every request had failed -- a monitoring page
  // claiming the system is fine is the one failure it must never have.
  const result = await monitoringService.getOverview({
    includeMetrics: true,
  });
  overview.value = result;
  if (result.metrics) {
    metrics.value = result.metrics;
  }
}

// Also uncaught: now that the rules load once rather than on every refresh, a
// silently swallowed failure would leave an empty rule list on screen for the
// life of the session with nothing to indicate it was not simply empty.
async function loadAlertRules() {
  const response = await monitoringService.getAlertRules();
  alertRules.value = response.rules;
}

async function loadPerformanceReport() {
  try {
    performanceReport.value = await monitoringService.getPerformanceReport({
      days: reportDays.value,
    });
  } catch (error) {
    console.error("Failed to load performance report:", error);
    toast.error(t("monitoring.notifications.performanceReportFailed"));
  }
}

async function toggleAlertRule(rule: AlertRule) {
  try {
    await monitoringService.updateAlertRule(rule.id, {
      isActive: !rule.isActive,
    });
    await loadAlertRules();
    toast.success(
      rule.isActive
        ? t("monitoring.alerts.messages.disabled")
        : t("monitoring.alerts.messages.enabled"),
    );
  } catch (error) {
    console.error("Failed to toggle alert rule:", error);
    toast.error(t("monitoring.notifications.updateFailed"));
  }
}

async function deleteAlert(id: string) {
  const confirmed = await confirmModal({
    type: "danger",
    title: t("monitoring.alerts.messages.deleteConfirm"),
    message: t("monitoring.alerts.messages.deleteConfirm"),
    confirmLabel: t("common.delete"),
  });
  if (!confirmed) return;

  try {
    await monitoringService.deleteAlertRule(id);
    await loadAlertRules();
    toast.success(t("monitoring.alerts.messages.deleted"));
  } catch (error) {
    console.error("Failed to delete alert rule:", error);
    toast.error(t("monitoring.notifications.updateFailed"));
  }
}

async function handleAlertRuleCreated() {
  try {
    await loadAlertRules();
  } catch (error) {
    console.error("Failed to reload alert rules:", error);
    toast.error(t("monitoring.notifications.updateFailed"));
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) {
    startAutoRefresh();
    toast.info(t("monitoring.notifications.autoRefreshEnabled"));
  } else {
    stopAutoRefresh();
    toast.info(t("monitoring.notifications.autoRefreshDisabled"));
  }
}

function startAutoRefresh() {
  refreshPoller.start();
}

function stopAutoRefresh() {
  refreshPoller.stop();
}

// ============================================================================
// Utility Functions
// ============================================================================

function getHealthIcon(status: HealthStatusType) {
  const iconMap = {
    healthy: CheckCircleIcon,
    warning: ExclamationTriangleIcon,
    critical: XCircleIcon,
    down: XCircleIcon,
  };
  return iconMap[status] || XCircleIcon;
}

function getHealthBgColor(status: HealthStatusType) {
  const colorMap = {
    healthy: "bg-green-500",
    warning: "bg-yellow-500",
    critical: "bg-red-500",
    down: "bg-gray-500",
  };
  return colorMap[status] || "bg-gray-500";
}

function getHealthBadgeColor(status: HealthStatusType) {
  const colorMap = {
    healthy: "bg-green-100 text-green-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
    down: "bg-gray-100 text-gray-800",
  };
  return colorMap[status] || "bg-gray-100 text-gray-800";
}

function getHealthStatusText(status: HealthStatusType) {
  const keyMap: Record<string, string> = {
    healthy: "monitoring.statusText.healthy",
    warning: "monitoring.statusText.warning",
    critical: "monitoring.statusText.critical",
    down: "monitoring.statusText.down",
  };
  return t(keyMap[status] || "monitoring.statusText.unknown");
}

function getHealthScoreColor(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

function getComponentStatusColor(status: ComponentStatusType) {
  const colorMap: Record<ComponentStatusType, string> = {
    healthy: "bg-green-100 text-green-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
    down: "bg-gray-100 text-gray-800",
    // Muted rather than red: nothing checks this component, which is not the
    // same as having checked it and found a fault.
    unknown: "bg-gray-100 text-gray-500",
  };
  return colorMap[status] || "bg-gray-100 text-gray-800";
}

function getComponentStatusText(status: ComponentStatusType) {
  const keyMap: Record<string, string> = {
    healthy: "monitoring.statusText.healthy",
    warning: "monitoring.statusText.warning",
    critical: "monitoring.statusText.critical",
    down: "monitoring.statusText.stopped",
    unknown: "monitoring.statusText.unknown",
  };
  return t(keyMap[status] || "monitoring.statusText.unknown");
}

function getComponentDisplayName(name: string) {
  const keyMap: Record<string, string> = {
    api: "monitoring.components.api",
    database: "monitoring.components.database",
    cache: "monitoring.components.cache",
    external: "monitoring.components.external",
  };
  return keyMap[name] ? t(keyMap[name]) : name;
}

function calculateComponentHealthScore(component: ComponentOverview): number {
  let score = 100;

  if (component.status === "critical") score -= 50;
  else if (component.status === "warning") score -= 25;
  else if (component.status === "down") score = 0;

  if (component.latency && component.latency > 1000) score -= 20;
  else if (component.latency && component.latency > 500) score -= 10;

  if (component.issues) score -= Math.min(20, component.issues * 5);

  return Math.max(0, score);
}

function getAlertSeverityBadgeColor(severity: string) {
  const colorMap: Record<string, string> = {
    info: "bg-blue-100 text-blue-800",
    warning: "bg-yellow-100 text-yellow-800",
    critical: "bg-red-100 text-red-800",
    fatal: "bg-teal-100 text-teal-800",
  };
  return colorMap[severity] || "bg-gray-100 text-gray-800";
}

function getAlertSeverityText(severity: string) {
  const keyMap: Record<string, string> = {
    info: "monitoring.alerts.severity.info",
    warning: "monitoring.alerts.severity.warning",
    critical: "monitoring.alerts.severity.critical",
    fatal: "monitoring.alerts.severity.fatal",
  };
  return t(keyMap[severity] || "monitoring.statusText.unknown");
}

function formatUptime(ms: number) {
  // API returns uptime in milliseconds, formatUptime expects seconds
  return monitoringService.formatUptime(Math.floor(ms / 1000));
}

function formatLastUpdate(timestamp: number) {
  return monitoringService.formatRelativeTime(timestamp);
}

function formatRelativeTime(timestamp: number) {
  return monitoringService.formatRelativeTime(timestamp);
}

// ============================================================================
// WebSocket Methods
// ============================================================================

function connectWebSocket() {
  // 這條輪詢打的是 /alerts/recent，同樣已收成 role 0 專用。店主連上去只會每 30
  // 秒吃一次 403，所以直接不啟動。
  if (!canManageAlerts.value) return;
  try {
    // Polling service handles auth via api service — no token needed
    monitoringWebSocket.connect();
    wsConnected.value = true;
    console.log("[MonitoringView] Alert polling initiated");
  } catch (error) {
    console.error("[MonitoringView] Failed to start alert polling:", error);
    toast.error(t("monitoring.notifications.connectionFailed"));
  }
}

function disconnectWebSocket() {
  monitoringWebSocket.disconnect();
  wsConnected.value = false;
}

function handleAcknowledgeAlert(alertId: string) {
  monitoringWebSocket.acknowledgeAlert(alertId);
  toast.success(t("monitoring.notifications.alertAcknowledged"));
}

function handleClearAllAlerts() {
  monitoringWebSocket.clearAllAlerts();
  toast.info(t("monitoring.notifications.alertsCleared"));
}

function handleReconnectWebSocket() {
  toast.info(t("monitoring.notifications.reconnecting"));
  connectWebSocket();
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(async () => {
  initialLoading.value = true;
  try {
    await Promise.all([
      loadOverviewWithMetrics(),
      ...(canManageAlerts.value ? [loadAlertRules()] : []),
      loadPerformanceReport(),
    ]);
  } catch (error) {
    console.error("Failed to initialize monitoring view:", error);
    toast.error(t("monitoring.notifications.loadingFailed"));
  } finally {
    initialLoading.value = false;
  }

  if (autoRefresh.value) {
    startAutoRefresh();
  }

  // Connect to WebSocket for real-time alerts
  connectWebSocket();
});

onUnmounted(() => {
  // Also detaches the visibilitychange listener the poller owns.
  stopAutoRefresh();
  disconnectWebSocket();
});
</script>

<style scoped>
/* Custom animations */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}

/* Smooth transitions */
button,
[aria-current],
[role="status"] {
  transition-property:
    color, background-color, border-color, text-decoration-color, fill, stroke;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  transition-duration: 150ms;
}
</style>
