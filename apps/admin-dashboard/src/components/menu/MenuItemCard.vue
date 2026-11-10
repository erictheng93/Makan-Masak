<template>
  <!-- Compact row for phones: the page scrolls, so each dish must be short. -->
  <div
    v-if="compact"
    :data-testid="`admin-menu-item-${item.id}`"
    :class="[
      'bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)]',
      highlighted && 'ring-2 ring-ios-blue',
    ]"
  >
    <div class="flex items-center gap-3 p-2.5">
      <OptimizedImage
        :src="item.imageUrl || placeholderSvg"
        :alt="item.name"
        :width="128"
        :height="128"
        format="auto"
        fit="cover"
        :lazy="true"
        :fade-in="true"
        image-class="h-16 w-16 shrink-0 rounded-xl object-cover"
      />
      <div class="min-w-0 flex-1">
        <h3 class="text-[15px] font-bold text-ios-text line-clamp-1">
          {{ item.name }}
        </h3>
        <div class="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span class="text-[14px] font-bold text-ios-primary">
            {{ formatPrice(item.price) }}
          </span>
          <span
            v-if="item.isFeatured"
            class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-ios-warning/90 text-white"
          >
            {{ t("menu.featured") }}
          </span>
          <span
            :class="[
              'px-2 py-0.5 rounded-full text-[11px] font-semibold text-white',
              isAvailable ? 'bg-ios-success/90' : 'bg-ios-error/85',
            ]"
          >
            {{ isAvailable ? t("menu.available") : t("menu.soldOut") }}
          </span>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        :aria-checked="item.isAvailable"
        :aria-label="
          item.isAvailable ? t('menu.actionUnpublish') : t('menu.actionPublish')
        "
        :data-testid="`admin-menu-item-toggle-${item.id}`"
        class="flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary"
        @click.stop="$emit('toggle-status', item)"
      >
        <span
          :class="[
            'relative block h-[31px] w-[51px] rounded-full transition-colors duration-200',
            item.isAvailable ? 'bg-ios-success' : 'bg-ios-tertiary',
          ]"
        >
          <span
            :class="[
              'absolute top-0.5 left-0.5 h-[27px] w-[27px] rounded-full bg-white shadow transition-transform duration-200',
              item.isAvailable && 'translate-x-5',
            ]"
          />
        </span>
      </button>
      <button
        type="button"
        :aria-label="t('menu.moreActions')"
        :aria-expanded="actionsOpen"
        :data-testid="`admin-menu-item-more-${item.id}`"
        class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ios-secondary hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary"
        @click.stop="actionsOpen = !actionsOpen"
      >
        <EllipsisHorizontalIcon class="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
    <div v-if="actionsOpen" class="flex gap-2 px-2.5 pb-2.5">
      <button
        type="button"
        :data-testid="`admin-menu-item-edit-${item.id}`"
        class="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-ios-bg text-[14px] font-semibold text-ios-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-primary"
        @click.stop="$emit('edit', item)"
      >
        <PencilIcon class="h-4 w-4" aria-hidden="true" />
        {{ t("common.edit") }}
      </button>
      <button
        type="button"
        :data-testid="`admin-menu-item-delete-${item.id}`"
        class="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-ios-red-soft text-[14px] font-semibold text-ios-error focus:outline-none focus-visible:ring-2 focus-visible:ring-ios-error"
        @click.stop="$emit('delete', item)"
      >
        <TrashIcon class="h-4 w-4" aria-hidden="true" />
        {{ t("common.delete") }}
      </button>
    </div>
  </div>

  <div
    v-else
    :data-testid="`admin-menu-item-${item.id}`"
    :class="[
      'bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.07)] transition-all duration-[280ms] cursor-pointer group',
      highlighted &&
        'ring-2 ring-ios-blue shadow-[0_0_20px_rgba(0,122,255,0.15)]',
    ]"
  >
    <!-- Image -->
    <div class="relative">
      <OptimizedImage
        :src="item.imageUrl || placeholderSvg"
        :alt="item.name"
        :width="600"
        :height="400"
        format="auto"
        fit="cover"
        :lazy="true"
        :fade-in="true"
        image-class="w-full h-44 object-cover rounded-t-2xl"
      />
      <!-- Badges -->
      <div
        class="absolute top-2.5 left-2.5 right-2.5 flex justify-between pointer-events-none"
      >
        <span
          v-if="item.isFeatured"
          class="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-ios-warning/90 text-white backdrop-blur-sm"
        >
          {{ t("menu.featured") }}
        </span>
        <span v-else />
        <span
          :class="[
            'px-2.5 py-1 rounded-full text-[11px] font-semibold backdrop-blur-sm',
            isAvailable
              ? 'bg-ios-success/90 text-white'
              : 'bg-ios-error/85 text-white',
          ]"
        >
          {{ isAvailable ? t("menu.available") : t("menu.soldOut") }}
        </span>
      </div>
    </div>

    <!-- Body -->
    <div class="p-3.5 pb-4">
      <div class="flex justify-between items-start mb-1.5">
        <h3 class="text-[15px] font-bold text-ios-text line-clamp-1">
          {{ item.name }}
        </h3>
        <span
          class="text-[15px] font-bold text-ios-primary whitespace-nowrap ml-2"
        >
          {{ formatPrice(item.price) }}
        </span>
      </div>

      <p class="text-xs text-ios-secondary leading-relaxed line-clamp-2 mb-2.5">
        {{ item.description }}
      </p>
      <p
        v-if="item.inventoryCount != null"
        data-testid="inventory-count"
        class="mb-2.5 text-[11px] text-ios-secondary"
      >
        {{ t("menu.form.inventoryCount") }}: {{ item.inventoryCount }}
      </p>

      <!-- Order metrics -->
      <div
        v-if="
          (item.orderCount && item.orderCount > 0) ||
          (item.favoriteCount && item.favoriteCount > 0)
        "
        class="flex items-center gap-3 mb-2.5"
      >
        <span
          v-if="item.orderCount && item.orderCount > 0"
          class="flex items-center gap-1 text-[11px] text-ios-secondary"
        >
          <ShoppingBagIcon class="h-3 w-3" />
          {{ item.orderCount }} {{ t("menu.metrics.sold") }}
        </span>
        <span
          v-if="item.favoriteCount && item.favoriteCount > 0"
          data-testid="favorite-count"
          class="flex items-center gap-1 text-[11px] text-ios-secondary"
        >
          <HeartIcon class="h-3 w-3" />
          {{ item.favoriteCount }} {{ t("menu.metrics.saved") }}
        </span>
        <span
          v-if="item.rating && item.rating > 0"
          class="flex items-center gap-1 text-[11px] text-ios-orange"
        >
          <StarIcon class="h-3 w-3 fill-current" />
          {{ item.rating.toFixed(1) }}
        </span>
      </div>

      <div class="flex justify-between items-center">
        <div class="flex gap-1">
          <span
            v-if="categoryName"
            class="px-2 py-0.5 bg-ios-bg rounded-full text-[11px] text-ios-secondary font-medium"
          >
            {{ categoryName }}
          </span>
        </div>
        <!-- Hover actions -->
        <div
          class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 focus-within:opacity-100"
        >
          <button
            :data-testid="`admin-menu-item-edit-${item.id}`"
            class="w-[30px] h-[30px] flex items-center justify-center rounded-lg text-ios-secondary hover:bg-black/5 hover:text-ios-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :title="t('common.edit')"
            :aria-label="t('common.edit')"
            @click.stop="$emit('edit', item)"
          >
            <PencilIcon class="h-[15px] w-[15px]" />
          </button>
          <!-- Action labels, not status labels: reusing the status strings put
               "已下架" on an item that is currently on sale, which reads as the
               item's state rather than as what the click will do. -->
          <button
            :data-testid="`admin-menu-item-toggle-${item.id}`"
            class="w-[30px] h-[30px] flex items-center justify-center rounded-lg text-ios-secondary hover:bg-black/5 hover:text-ios-text transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :title="
              item.isAvailable
                ? t('menu.actionUnpublish')
                : t('menu.actionPublish')
            "
            :aria-label="
              item.isAvailable
                ? t('menu.actionUnpublish')
                : t('menu.actionPublish')
            "
            @click.stop="$emit('toggle-status', item)"
          >
            <component
              :is="item.isAvailable ? EyeSlashIcon : EyeIcon"
              class="h-[15px] w-[15px]"
            />
          </button>
          <button
            :data-testid="`admin-menu-item-delete-${item.id}`"
            class="w-[30px] h-[30px] flex items-center justify-center rounded-lg text-ios-secondary hover:bg-ios-red-soft hover:text-ios-error transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-blue"
            :title="t('common.delete')"
            :aria-label="t('common.delete')"
            @click.stop="$emit('delete', item)"
          >
            <TrashIcon class="h-[15px] w-[15px]" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import OptimizedImage from "@/components/OptimizedImage.vue";
import {
  PencilIcon,
  TrashIcon,
  EyeIcon,
  EyeSlashIcon,
  EllipsisHorizontalIcon,
  ShoppingBagIcon,
  StarIcon,
  HeartIcon,
} from "@heroicons/vue/24/outline";
import type { MenuItemData } from "@/composables/useMenuManagement";

const { t } = useI18n();
const { formatPrice } = useCurrency();

const props = defineProps<{
  item: MenuItemData;
  categoryName?: string;
  highlighted?: boolean;
  compact?: boolean;
}>();

const actionsOpen = ref(false);

const isAvailable = computed(
  () =>
    props.item.isAvailable &&
    (props.item.inventoryCount == null || props.item.inventoryCount > 0),
);

defineEmits<{
  edit: [item: MenuItemData];
  "toggle-status": [item: MenuItemData];
  delete: [item: MenuItemData];
}>();

const placeholderSvg =
  "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27600%27 height=%27400%27 fill=%27%23e5e7eb%27%3E%3Crect width=%27600%27 height=%27400%27/%3E%3Ctext x=%27300%27 y=%27200%27 text-anchor=%27middle%27 dominant-baseline=%27central%27 font-family=%27system-ui%27 font-size=%2748%27 fill=%27%239ca3af%27%3E🍽️%3C/text%3E%3C/svg%3E";
</script>
