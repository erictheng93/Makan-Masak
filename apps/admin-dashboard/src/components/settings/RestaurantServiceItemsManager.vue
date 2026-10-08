<template>
  <section class="rounded-lg bg-white p-6 shadow" data-testid="service-manager">
    <div
      class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div>
        <h3 class="text-lg font-semibold text-gray-900">店家服務項目</h3>
        <p class="mt-1 text-sm text-gray-500">
          維護會顯示在店鋪菜單與夜市/商圈搜尋裡的預約、外送、租借或現場服務。
        </p>
      </div>
      <button
        type="button"
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        @click="resetForm"
      >
        新增服務
      </button>
    </div>

    <div
      v-if="isMarketServiceGapContext"
      data-testid="market-service-gap-context"
      class="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <h4 class="text-sm font-semibold text-amber-900">市場搜尋缺服務</h4>
      <p class="mt-1 text-sm leading-5 text-amber-800">
        新增公開且啟用的服務後，這間店鋪會更完整地出現在
        {{ marketGapName || "夜市/商圈" }} 服務搜尋結果。
      </p>
    </div>

    <div
      v-if="!restaurantId"
      class="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      請先選擇要管理的店家。
    </div>

    <template v-else>
      <form class="mt-5 space-y-4" @submit.prevent="saveService">
        <div class="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div class="md:col-span-2">
            <label class="mb-2 block text-sm font-medium text-gray-700">
              服務名稱
            </label>
            <input
              v-model="form.name"
              data-testid="service-name-input"
              type="text"
              required
              maxlength="100"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="例：代客切水果"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">
              類型
            </label>
            <select
              v-model="form.serviceType"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="general">一般服務</option>
              <option value="booking">預約</option>
              <option value="pickup">自取</option>
              <option value="delivery">外送</option>
              <option value="consultation">諮詢</option>
              <option value="rental">租借</option>
              <option value="activity">活動</option>
            </select>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">
              排序
            </label>
            <input
              v-model.number="form.sortOrder"
              type="number"
              min="0"
              max="1000"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div class="md:col-span-4">
            <label class="mb-2 block text-sm font-medium text-gray-700">
              說明
            </label>
            <textarea
              v-model="form.description"
              data-testid="service-description-input"
              rows="2"
              maxlength="1000"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="說明服務內容、條件或使用方式"
            />
          </div>
          <div>
            <label
              for="service-price-input"
              class="mb-2 block text-sm font-medium text-gray-700"
            >
              {{ t("settings.serviceItems.price", { symbol: currencySymbol }) }}
            </label>
            <input
              id="service-price-input"
              v-model.number="form.price"
              data-testid="service-price-input"
              type="number"
              min="0"
              :step="inputStep"
              :placeholder="inputPlaceholder"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">
              價格文字
            </label>
            <input
              v-model="form.priceLabel"
              data-testid="service-price-label-input"
              type="text"
              maxlength="80"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="例：依距離報價"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">
              預估分鐘
            </label>
            <input
              v-model.number="form.durationMinutes"
              type="number"
              min="1"
              max="1440"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">
              付款條件
            </label>
            <select
              v-model="form.paymentRequirement"
              data-testid="service-payment-requirement"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="pay_at_venue">現場付款</option>
              <option value="prepay">預付全額</option>
              <option value="deposit">支付訂金</option>
              <option value="none">免付款</option>
            </select>
          </div>
          <div v-if="form.paymentRequirement === 'deposit'">
            <label class="mb-2 block text-sm font-medium text-gray-700">
              訂金金額（{{ currencySymbol }}）
            </label>
            <input
              v-model.number="form.depositAmount"
              data-testid="service-deposit-amount"
              type="number"
              min="0.01"
              :max="form.price"
              :step="inputStep"
              required
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-gray-700">
              標籤
            </label>
            <input
              v-model="tagsText"
              type="text"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="水果, 分裝"
            />
          </div>
          <div class="md:col-span-4">
            <label class="mb-2 block text-sm font-medium text-gray-700">
              預約連結
            </label>
            <input
              v-model="form.bookingUrl"
              type="url"
              class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="https://..."
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-4">
          <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              v-model="form.requiresBooking"
              type="checkbox"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            需預約
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              v-model="form.isPublic"
              type="checkbox"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            公開顯示
          </label>
          <label class="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              v-model="form.isActive"
              type="checkbox"
              class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            啟用
          </label>
        </div>

        <div class="flex items-center justify-end gap-2">
          <button
            v-if="editingServiceId"
            type="button"
            class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
            @click="resetForm"
          >
            取消編輯
          </button>
          <button
            type="submit"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="isSaving || !form.name.trim()"
          >
            {{ editingServiceId ? "更新服務" : "新增服務" }}
          </button>
        </div>
      </form>

      <section class="mt-6 border-t border-gray-200 pt-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:justify-between">
          <div>
            <h4 class="text-base font-semibold text-gray-900">批次匯入服務</h4>
            <p class="mt-1 text-sm text-gray-500">
              貼上 CSV，一次建立會顯示在市場搜尋裡的服務項目。
            </p>
          </div>
          <button
            type="button"
            class="w-fit rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            @click="loadServiceImportExample"
          >
            載入範例
          </button>
        </div>

        <textarea
          v-model="serviceImportText"
          rows="7"
          data-testid="service-import-csv"
          class="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          placeholder="name,serviceType,description,priceCents,priceLabel,durationMinutes,requiresBooking,bookingUrl,tags,sortOrder,isActive,isPublic"
        />

        <div v-if="serviceImportPreview.errors.length" class="mt-3 space-y-1">
          <p
            v-for="importError in serviceImportPreview.errors"
            :key="importError"
            class="text-sm text-red-600"
          >
            {{ importError }}
          </p>
        </div>
        <p v-if="serviceImportError" class="mt-3 text-sm text-red-600">
          {{ serviceImportError }}
        </p>
        <div
          v-if="
            serviceImportText.trim() &&
            !serviceImportPreview.errors.length &&
            serviceImportPreview.items.length
          "
          class="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800"
        >
          已解析 {{ serviceImportPreview.items.length }} 筆服務，準備匯入。
        </div>
        <div
          v-if="serviceImportResult"
          class="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          已成功匯入 {{ serviceImportResult }} 筆服務。
        </div>
        <div
          v-if="showMarketServiceGapNextStep"
          data-testid="market-service-gap-next-step"
          class="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm leading-5 text-blue-800"
        >
          已補齊
          {{ marketGapName || "夜市/商圈" }}
          的服務資料。請回到市場公開品質並重建搜尋索引，讓顧客搜尋立即包含這批服務。
          <button
            type="button"
            data-testid="market-service-gap-return"
            class="mt-2 block rounded-lg bg-blue-100 px-3 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-200"
            @click="returnToMarketReadiness"
          >
            回市場公開品質
          </button>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            data-testid="service-import-submit"
            class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            :disabled="
              isImportingServices ||
              !serviceImportText.trim() ||
              serviceImportPreview.errors.length > 0 ||
              serviceImportPreview.items.length === 0
            "
            @click="importServices"
          >
            {{ isImportingServices ? "匯入中..." : "匯入服務" }}
          </button>
        </div>
      </section>

      <div
        v-if="error"
        class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        {{ error }}
      </div>

      <div v-if="isLoading" class="mt-6 text-sm text-gray-500">
        載入服務中...
      </div>
      <div
        v-else-if="services.length === 0"
        class="mt-6 rounded-lg border border-dashed border-gray-300 p-5 text-sm text-gray-500"
      >
        尚未建立服務項目。
      </div>
      <div
        v-else
        class="mt-6 divide-y divide-gray-100 rounded-lg border border-gray-200"
      >
        <div
          v-for="service in services"
          :key="service.id"
          class="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between"
        >
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="font-medium text-gray-900">{{ service.name }}</h4>
              <span
                class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
              >
                {{ serviceTypeLabel(service.serviceType) }}
              </span>
              <span
                class="rounded px-2 py-0.5 text-xs"
                :class="
                  service.isPublic
                    ? 'bg-green-50 text-green-700'
                    : 'bg-gray-100 text-gray-500'
                "
              >
                {{ service.isPublic ? "公開" : "未公開" }}
              </span>
              <span
                class="rounded px-2 py-0.5 text-xs"
                :class="
                  service.isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-red-50 text-red-700'
                "
              >
                {{ service.isActive ? "啟用" : "停用" }}
              </span>
            </div>
            <p v-if="service.description" class="mt-1 text-sm text-gray-500">
              {{ service.description }}
            </p>
            <p class="mt-2 text-sm text-gray-700">
              {{
                servicePriceLabel(service) || t("settings.serviceItems.noPrice")
              }}
            </p>
            <p class="mt-1 text-sm text-gray-600">
              {{ paymentRequirementLabel(service) }}
            </p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button
              type="button"
              :data-testid="`edit-service-${service.id}`"
              class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              @click="editService(service)"
            >
              編輯
            </button>
            <button
              type="button"
              :data-testid="`delete-service-${service.id}`"
              class="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
              @click="deleteService(service.id)"
            >
              刪除
            </button>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type {
  RestaurantServiceItem,
  RestaurantServiceType,
  ServiceItemPaymentRequirement,
} from "@makanmasak/shared-types";
import { restaurantServiceItemsService } from "@/services/restaurantServiceItemsService";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import {
  buildRestaurantServiceItemImportTemplate,
  parseRestaurantServiceItemImport,
} from "@/utils/restaurantServiceItemImport";

const props = defineProps<{
  restaurantId?: string | null;
  isMarketServiceGapContext?: boolean;
  marketGapName?: string;
  marketGapSlug?: string;
  marketGapAreaCity?: string;
  marketGapAreaDistrict?: string;
}>();

const router = useRouter();
const { t } = useI18n();
const {
  currencySymbol,
  inputStep,
  inputPlaceholder,
  formatCents,
  majorToCents,
  centsToMajor,
} = useCurrency();
const services = ref<RestaurantServiceItem[]>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref<string | null>(null);
const editingServiceId = ref<number | null>(null);
const tagsText = ref("");
const serviceImportText = ref("");
const serviceImportError = ref("");
const serviceImportResult = ref<number | null>(null);
const isImportingServices = ref(false);
const hasCompletedMarketServiceGap = ref(false);
const showMarketServiceGapNextStep = computed(
  () => props.isMarketServiceGapContext && hasCompletedMarketServiceGap.value,
);

const defaultForm = () => ({
  name: "",
  description: "",
  serviceType: "general" as RestaurantServiceType,
  /** Major units as typed (NT$350, RM 12.50); sent as cents. */
  price: undefined as number | undefined,
  priceLabel: "",
  durationMinutes: undefined as number | undefined,
  paymentRequirement: "pay_at_venue" as ServiceItemPaymentRequirement,
  depositAmount: undefined as number | undefined,
  requiresBooking: false,
  bookingUrl: "",
  sortOrder: 0,
  isActive: true,
  isPublic: true,
});

const form = reactive(defaultForm());
const serviceImportPreview = computed(() => {
  if (!serviceImportText.value.trim()) {
    return { items: [], errors: [] };
  }

  return parseRestaurantServiceItemImport(serviceImportText.value);
});

async function loadServices() {
  if (!props.restaurantId) return;

  isLoading.value = true;
  error.value = null;
  try {
    services.value = await restaurantServiceItemsService.list(
      props.restaurantId,
    );
  } catch (loadError) {
    error.value =
      loadError instanceof Error ? loadError.message : "載入服務項目失敗";
  } finally {
    isLoading.value = false;
  }
}

function resetForm() {
  Object.assign(form, defaultForm());
  tagsText.value = "";
  editingServiceId.value = null;
}

function resetServiceImport() {
  serviceImportText.value = "";
  serviceImportError.value = "";
  serviceImportResult.value = null;
}

function servicePayload() {
  const tags = tagsText.value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    serviceType: form.serviceType,
    priceCents:
      typeof form.price === "number" && Number.isFinite(form.price)
        ? majorToCents(form.price)
        : undefined,
    priceLabel: form.priceLabel.trim() || null,
    durationMinutes:
      typeof form.durationMinutes === "number"
        ? form.durationMinutes
        : undefined,
    paymentRequirement: form.paymentRequirement,
    depositAmountCents:
      form.paymentRequirement === "deposit" &&
      typeof form.depositAmount === "number" &&
      Number.isFinite(form.depositAmount)
        ? majorToCents(form.depositAmount)
        : 0,
    requiresBooking: form.requiresBooking,
    bookingUrl: form.bookingUrl.trim() || null,
    tags,
    keywords: tags.join(" ") || undefined,
    sortOrder: form.sortOrder,
    isActive: form.isActive,
    isPublic: form.isPublic,
  };
}

async function saveService() {
  if (!props.restaurantId || !form.name.trim()) return;

  isSaving.value = true;
  error.value = null;
  try {
    if (editingServiceId.value) {
      await restaurantServiceItemsService.update(
        props.restaurantId,
        editingServiceId.value,
        servicePayload(),
      );
    } else {
      await restaurantServiceItemsService.create(
        props.restaurantId,
        servicePayload(),
      );
    }
    if (props.isMarketServiceGapContext) {
      hasCompletedMarketServiceGap.value = true;
    }
    resetForm();
    await loadServices();
  } catch (saveError) {
    error.value =
      saveError instanceof Error ? saveError.message : "儲存服務項目失敗";
  } finally {
    isSaving.value = false;
  }
}

function loadServiceImportExample() {
  serviceImportError.value = "";
  serviceImportResult.value = null;
  serviceImportText.value = buildRestaurantServiceItemImportTemplate();
}

async function importServices() {
  if (!props.restaurantId) return;

  const parsed = serviceImportPreview.value;
  if (!parsed.items.length || parsed.errors.length) {
    serviceImportError.value =
      parsed.errors[0] ?? "請確認匯入資料格式後再送出。";
    return;
  }

  isImportingServices.value = true;
  serviceImportError.value = "";
  serviceImportResult.value = null;
  try {
    for (const item of parsed.items) {
      await restaurantServiceItemsService.create(props.restaurantId, item);
    }
    serviceImportResult.value = parsed.items.length;
    hasCompletedMarketServiceGap.value = true;
    serviceImportText.value = "";
    await loadServices();
  } catch (importError) {
    serviceImportError.value =
      importError instanceof Error ? importError.message : "匯入服務項目失敗";
  } finally {
    isImportingServices.value = false;
  }
}

function returnToMarketReadiness() {
  router.push({
    name: "PlatformMarkets",
    query: {
      ...(props.marketGapSlug ? { marketSlug: props.marketGapSlug } : {}),
      ...(props.marketGapAreaCity ? { areaCity: props.marketGapAreaCity } : {}),
      ...(props.marketGapAreaDistrict
        ? { areaDistrict: props.marketGapAreaDistrict }
        : {}),
    },
  });
}

function editService(service: RestaurantServiceItem) {
  editingServiceId.value = service.id;
  form.name = service.name;
  form.description = service.description ?? "";
  form.serviceType = service.serviceType;
  form.price =
    typeof service.priceCents === "number"
      ? centsToMajor(service.priceCents)
      : undefined;
  form.priceLabel = service.priceLabel ?? "";
  form.durationMinutes = service.durationMinutes ?? undefined;
  form.paymentRequirement = service.paymentRequirement ?? "pay_at_venue";
  form.depositAmount =
    service.paymentRequirement === "deposit"
      ? centsToMajor(service.depositAmountCents ?? 0)
      : undefined;
  form.requiresBooking = service.requiresBooking;
  form.bookingUrl = service.bookingUrl ?? "";
  form.sortOrder = service.sortOrder;
  form.isActive = service.isActive;
  form.isPublic = service.isPublic;
  tagsText.value = service.tags?.join(", ") ?? "";
}

async function deleteService(serviceId: number) {
  if (!props.restaurantId) return;

  error.value = null;
  try {
    await restaurantServiceItemsService.remove(props.restaurantId, serviceId);
    services.value = services.value.filter(
      (service) => service.id !== serviceId,
    );
    if (editingServiceId.value === serviceId) resetForm();
  } catch (deleteError) {
    error.value =
      deleteError instanceof Error ? deleteError.message : "刪除服務項目失敗";
  }
}

function serviceTypeLabel(type: RestaurantServiceType) {
  const labels: Record<RestaurantServiceType, string> = {
    general: "一般服務",
    booking: "預約",
    pickup: "自取",
    delivery: "外送",
    consultation: "諮詢",
    rental: "租借",
    activity: "活動",
  };
  return labels[type];
}

function paymentRequirementLabel(service: RestaurantServiceItem) {
  const requirement = service.paymentRequirement ?? "pay_at_venue";
  if (requirement === "deposit") {
    return `訂金 ${formatCents(service.depositAmountCents ?? 0)}`;
  }
  const labels: Record<ServiceItemPaymentRequirement, string> = {
    none: "免付款",
    deposit: "支付訂金",
    prepay: "預付全額",
    pay_at_venue: "現場付款",
  };
  return labels[requirement];
}

function servicePriceLabel(service: RestaurantServiceItem) {
  if (service.priceLabel) return service.priceLabel;
  if (typeof service.priceCents === "number") {
    return formatCents(service.priceCents);
  }
  return "";
}

onMounted(loadServices);

watch(
  () => props.restaurantId,
  () => {
    resetForm();
    resetServiceImport();
    hasCompletedMarketServiceGap.value = false;
    loadServices();
  },
);
</script>
