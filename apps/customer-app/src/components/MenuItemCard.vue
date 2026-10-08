<template>
  <div
    :id="resolvedAnchorId"
    :data-testid="`menu-item-card-${item.id}`"
    class="bg-white rounded-2xl shadow-card overflow-hidden transition-transform duration-150 active:scale-[0.98]"
    :class="{ 'shadow-card-lg': isFeatured }"
  >
    <!-- Featured layout (vertical: image on top, info below) -->
    <template v-if="isFeatured">
      <!-- 特色標籤 -->
      <div
        data-testid="featured-badge"
        class="bg-ios-blue text-white text-xs font-medium px-3 py-1 text-center"
      >
        {{ t("menuItemCard.featured") }}
      </div>

      <!-- Large image block -->
      <div
        class="h-40 bg-gray-100 overflow-hidden cursor-pointer"
        @click="$emit('view-details', item)"
      >
        <img
          v-if="item.imageUrl"
          :src="featuredImageSrc"
          :srcset="featuredImageSrcset"
          sizes="(min-width: 1024px) 382px, 334px"
          :alt="getLocalizedMenuName(item, currentLanguage)"
          loading="lazy"
          class="w-full h-full object-cover lazy-image"
        />
        <div
          v-else
          class="w-full h-full flex items-center justify-center text-gray-400"
        >
          <svg
            class="w-10 h-10"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        </div>
      </div>

      <!-- Info section below image -->
      <div class="p-4">
        <div class="flex items-start justify-between mb-1">
          <h3
            class="text-base font-bold text-ios-text cursor-pointer"
            @click="$emit('view-details', item)"
          >
            {{ getLocalizedMenuName(item, currentLanguage) }}
          </h3>
          <div class="flex items-center space-x-1 ml-2">
            <FollowButton
              target-type="dish"
              :target-id="String(item.id)"
              :name="getLocalizedMenuName(item, currentLanguage)"
              compact
            />
            <!-- 辣度指示器 -->
            <div v-if="item.spiceLevel > 0" class="flex items-center">
              <svg
                v-for="n in item.spiceLevel"
                :key="n"
                class="w-3 h-3 text-red-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <!-- 描述 -->
        <p
          v-if="item.description"
          class="text-sm text-ios-secondary leading-relaxed mb-2 line-clamp-2 cursor-pointer"
          @click="$emit('view-details', item)"
        >
          {{ item.description }}
        </p>

        <!-- 飲食資訊標籤 -->
        <div v-if="dietaryTags.length > 0" class="flex flex-wrap gap-1 mb-2">
          <span
            v-for="tag in dietaryTags"
            :key="tag.key"
            :class="[
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
              tag.class,
            ]"
          >
            {{ tag.label }}
          </span>
        </div>

        <!-- 價格和操作 -->
        <div class="flex items-center justify-between mt-3">
          <div class="flex items-baseline space-x-2">
            <span class="text-lg font-bold text-ios-text">
              {{ formatPrice(item.price) }}
            </span>
            <!-- 原價（如果有折扣） -->
            <span
              v-if="originalPrice && originalPrice !== item.price"
              class="text-sm text-ios-tertiary line-through"
            >
              {{ formatPrice(originalPrice) }}
            </span>
          </div>

          <!-- 庫存狀態 -->
          <div v-if="!item.isAvailable || isOutOfStock" class="text-right">
            <span
              class="text-xs font-medium text-ios-secondary bg-gray-100 px-2 py-1 rounded-full"
            >
              {{
                !item.isAvailable
                  ? t("menuItemCard.unavailable")
                  : t("menuItemCard.soldOut")
              }}
            </span>
          </div>

          <!-- 添加按鈕 -->
          <button
            v-else-if="!hasCustomizations"
            :disabled="isOutOfStock || orderingDisabled"
            :data-testid="`menu-item-add-${item.id}`"
            class="bg-ios-blue text-white px-4 py-2 rounded-full text-sm font-medium active:scale-95 transition-transform duration-150 disabled:bg-gray-200 disabled:text-gray-400 flex items-center space-x-1"
            @click="handleQuickAdd"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>{{ t("menuItemCard.addToCart") }}</span>
          </button>

          <!-- 客製化按鈕 -->
          <button
            v-else
            :disabled="isOutOfStock || orderingDisabled"
            :data-testid="`menu-item-customize-${item.id}`"
            class="bg-ios-blue/10 text-ios-blue px-4 py-2 rounded-full text-sm font-medium active:bg-ios-blue/20 transition-all duration-200 disabled:bg-gray-100 disabled:text-ios-tertiary"
            @click="handleCustomize"
          >
            {{ t("menuItemCard.selectSpec") }}
          </button>
        </div>

        <!-- 人氣指標 -->
        <div
          v-if="item.orderCount > 0"
          class="flex items-center mt-2 text-xs text-ios-secondary"
        >
          <svg
            class="w-3 h-3 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
          <span>{{
            tWithParams("menuItemCard.orderedCount", {
              count: item.orderCount,
            })
          }}</span>
        </div>
      </div>
    </template>

    <!-- Standard layout (horizontal: image left, info right) -->
    <template v-else>
      <div class="p-4">
        <div class="flex space-x-4">
          <!-- 菜品圖片 -->
          <div class="flex-shrink-0">
            <div
              class="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 cursor-pointer transition-transform hover:scale-105"
              @click="$emit('view-details', item)"
            >
              <img
                v-if="item.imageUrl"
                :src="listImageSrc"
                :srcset="listImageSrcset"
                sizes="70px"
                :alt="getLocalizedMenuName(item, currentLanguage)"
                loading="lazy"
                class="w-full h-full object-cover lazy-image"
              />
              <div
                v-else
                class="w-full h-full flex items-center justify-center text-gray-400"
              >
                <svg
                  class="w-8 h-8"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
            </div>
          </div>

          <!-- 菜品資訊 -->
          <div class="flex-1 min-w-0">
            <div class="flex items-start justify-between mb-1">
              <h3
                class="text-base font-bold text-ios-text cursor-pointer"
                @click="$emit('view-details', item)"
              >
                {{ getLocalizedMenuName(item, currentLanguage) }}
              </h3>
              <div class="flex items-center space-x-1 ml-2">
                <FollowButton
                  target-type="dish"
                  :target-id="String(item.id)"
                  :name="getLocalizedMenuName(item, currentLanguage)"
                  compact
                />
                <!-- 辣度指示器 -->
                <div v-if="item.spiceLevel > 0" class="flex items-center">
                  <svg
                    v-for="n in item.spiceLevel"
                    :key="n"
                    class="w-3 h-3 text-red-500"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <!-- 描述 -->
            <p
              v-if="item.description"
              class="text-sm text-ios-secondary leading-relaxed mb-2 line-clamp-2 cursor-pointer"
              @click="$emit('view-details', item)"
            >
              {{ item.description }}
            </p>

            <!-- 飲食資訊標籤 -->
            <div
              v-if="dietaryTags.length > 0"
              class="flex flex-wrap gap-1 mb-2"
            >
              <span
                v-for="tag in dietaryTags"
                :key="tag.key"
                :class="[
                  'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                  tag.class,
                ]"
              >
                {{ tag.label }}
              </span>
            </div>

            <!-- 價格和操作 -->
            <div class="flex items-center justify-between mt-3">
              <div class="flex items-baseline space-x-2">
                <span class="text-lg font-bold text-ios-text">
                  {{ formatPrice(item.price) }}
                </span>
                <!-- 原價（如果有折扣） -->
                <span
                  v-if="originalPrice && originalPrice !== item.price"
                  class="text-sm text-ios-tertiary line-through"
                >
                  {{ formatPrice(originalPrice) }}
                </span>
              </div>

              <!-- 庫存狀態 -->
              <div v-if="!item.isAvailable || isOutOfStock" class="text-right">
                <span
                  class="text-xs font-medium text-ios-secondary bg-gray-100 px-2 py-1 rounded-full"
                >
                  {{
                    !item.isAvailable
                      ? t("menuItemCard.unavailable")
                      : t("menuItemCard.soldOut")
                  }}
                </span>
              </div>

              <!-- 添加按鈕 -->
              <button
                v-else-if="!hasCustomizations"
                :disabled="isOutOfStock || orderingDisabled"
                :data-testid="`menu-item-add-${item.id}`"
                class="bg-ios-blue text-white px-4 py-2 rounded-full text-sm font-medium active:scale-95 transition-transform duration-150 disabled:bg-gray-200 disabled:text-gray-400 flex items-center space-x-1"
                @click="handleQuickAdd"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>{{ t("menuItemCard.addToCart") }}</span>
              </button>

              <!-- 客製化按鈕 -->
              <button
                v-else
                :disabled="isOutOfStock || orderingDisabled"
                :data-testid="`menu-item-customize-${item.id}`"
                class="bg-ios-blue/10 text-ios-blue px-4 py-2 rounded-full text-sm font-medium active:bg-ios-blue/20 transition-all duration-200 disabled:bg-gray-100 disabled:text-ios-tertiary"
                @click="handleCustomize"
              >
                {{ t("menuItemCard.selectSpec") }}
              </button>
            </div>

            <!-- 人氣指標 -->
            <div
              v-if="item.orderCount > 0"
              class="flex items-center mt-2 text-xs text-ios-secondary"
            >
              <svg
                class="w-3 h-3 mr-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
              <span>{{
                tWithParams("menuItemCard.orderedCount", {
                  count: item.orderCount,
                })
              }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useCurrency } from "@/composables/useCurrency";
import { menuItemElementId } from "@/utils/shopMenuDeepLink";
import type {
  MenuItem,
  SelectedCustomizations,
} from "@makanmasak/shared-types";
import { useI18n } from "@/composables/useI18n";
import { getLocalizedMenuName } from "@/utils/localized-menu-content";
import FollowButton from "@/components/follow/FollowButton.vue";

// Props
const props = defineProps<{
  item: MenuItem;
  isFeatured?: boolean;
  anchorId?: string | null;
  /**
   * The channel this card is shown in cannot take orders right now — the shop
   * has QR ordering switched off, or the code that got the customer here has
   * been retired. Distinct from `isOutOfStock`, which is about this one dish,
   * and it deliberately reuses the same disabled styling: from the customer's
   * side both mean "look, don't add".
   */
  orderingDisabled?: boolean;
}>();

// Emits
const emits = defineEmits<{
  "add-to-cart": [
    data: {
      item: MenuItem;
      quantity: number;
      customizations?: SelectedCustomizations;
      notes?: string;
    },
  ];
  "view-details": [item: MenuItem];
}>();

const { t, tWithParams, currentLanguage } = useI18n();
const { formatPrice } = useCurrency();

// Computed
const resolvedAnchorId = computed(() =>
  props.anchorId === null
    ? undefined
    : (props.anchorId ?? menuItemElementId(props.item.id)),
);

const isOutOfStock = computed(() => {
  // null/undefined means stock is not tracked — the API sends null for that
  // (it used to coerce it to 0, which is why 0 was once read as "untracked").
  // A tracked 0 is genuinely sold out: the order path claims stock with
  // `inventoryCount IS NULL OR inventoryCount >= quantity`, so showing it as
  // buyable only sends the customer into a failed submit (#166).
  if (!props.item.isAvailable) return true;
  return props.item.inventoryCount != null && props.item.inventoryCount <= 0;
});

const hasCustomizations = computed(() => {
  const options = props.item.options;
  return !!(
    options?.sizes?.length ||
    options?.customizations?.length ||
    options?.addOns?.length
  );
});

const dietaryTags = computed(() => {
  const tags: Array<{ key: string; label: string; class: string }> = [];
  const dietary = props.item.dietaryInfo;

  if (dietary?.vegetarian) {
    tags.push({
      key: "vegetarian",
      label: t("menu.vegetarian"),
      class: "bg-ios-green-soft text-ios-green-deep",
    });
  }

  if (dietary?.vegan) {
    tags.push({
      key: "vegan",
      label: t("menu.vegan"),
      class: "bg-ios-green-soft text-ios-green-deep",
    });
  }

  if (dietary?.halal) {
    tags.push({
      key: "halal",
      label: t("menu.halal"),
      class: "bg-ios-blue-soft text-ios-blue-deep",
    });
  }

  if (dietary?.glutenFree) {
    tags.push({
      key: "gluten-free",
      label: t("menu.glutenFree"),
      class: "bg-ios-orange-soft text-ios-orange-deep",
    });
  }

  return tags;
});

const originalPrice = computed(() => {
  // 這裡可以實作原價邏輯（如果有折扣活動）
  return null;
});

// Methods
const getImageUrl = (url: string) => {
  // 如果是相對路徑，轉換為絕對路徑
  if (url.startsWith("/")) {
    return `${import.meta.env.VITE_IMAGE_BASE_URL || ""}${url}`;
  }
  return url;
};

// The standard list thumbnail renders in a w-20 box, which is 70px because this
// app's root font-size is 14px. DPR 2 therefore needs ~140 device px and DPR 3
// needs ~210, so offering both candidates lets the browser pick per device
// instead of hardcoding one size and being wrong on half of them (#65).
//
// The sizes hint is deliberately "70px" and not "5rem": the preload scanner
// resolves rem against the default 16px root before this app's CSS applies, so
// "5rem" reads as 80px there and pushes DPR 2 up to the 300w candidate. Measured
// in a browser — "5rem" picks small on both DPR 2 and 3, "70px" picks thumbnail
// on DPR 2 and small on DPR 3.
const listImageSrc = computed(() => {
  // The template's v-if narrows item.imageUrl, but that narrowing does not
  // reach here, so the empty case is handled explicitly.
  const url =
    props.item.imageVariants?.thumbnail ||
    props.item.imageVariants?.medium ||
    props.item.imageUrl;

  return url ? getImageUrl(url) : undefined;
});

const listImageSrcset = computed(() => {
  const variants = props.item.imageVariants;
  const candidates = [
    variants?.thumbnail && `${getImageUrl(variants.thumbnail)} 150w`,
    variants?.small && `${getImageUrl(variants.small)} 300w`,
  ].filter(Boolean);

  // Items uploaded before the variant pipeline have neither; fall back to src.
  return candidates.length > 0 ? candidates.join(", ") : undefined;
});

const featuredImageSrc = computed(() => {
  const url = props.item.imageVariants?.medium || props.item.imageUrl;

  return url ? getImageUrl(url) : undefined;
});

const featuredImageSrcset = computed(() => {
  const variants = props.item.imageVariants;
  const candidates = [
    variants?.medium && `${getImageUrl(variants.medium)} 600w`,
    variants?.large && `${getImageUrl(variants.large)} 1200w`,
  ].filter(Boolean);

  return candidates.length > 0 ? candidates.join(", ") : undefined;
});

const _handleImageError = (event: Event) => {
  // 圖片載入失敗時的處理
  const img = event.target as HTMLImageElement;
  img.style.display = "none";
};

const handleQuickAdd = () => {
  emits("add-to-cart", {
    item: props.item,
    quantity: 1,
  });
};

const handleCustomize = () => {
  // 對於有客製化選項的商品，觸發詳情查看
  emits("view-details", props.item);
};
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
