<template>
  <img
    v-if="!error"
    :src="computedImageUrl"
    :srcset="computedSrcset"
    :sizes="computedSizes"
    :alt="alt"
    :loading="lazy ? 'lazy' : 'eager'"
    :class="[
      'optimized-image',
      imageClass,
      {
        'animate-pulse': isLoading && showLoadingState,
        'opacity-0': isLoading && fadeIn,
        'opacity-100 transition-opacity duration-300': !isLoading && fadeIn,
      },
    ]"
    :style="imageStyle"
    @load="handleLoad"
    @error="handleError"
  />

  <!-- Error fallback -->
  <div
    v-else
    :class="['optimized-image-error', errorClass]"
    :style="{
      width: width ? `${width}px` : '100%',
      height: height ? `${height}px` : 'auto',
    }"
  >
    <slot name="error">
      <div
        class="flex items-center justify-center h-full bg-gray-100 text-gray-400"
      >
        <svg
          class="w-12 h-12"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    </slot>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from "vue";
import { computed, ref } from "vue";
import {
  useOptimizedImage,
  type ImageOptimizationOptions,
  type ImageFormat,
  type ImageFit,
  type ImageGravity,
} from "@/composables/useOptimizedImage";

// ============================================================================
// Props
// ============================================================================

interface Props {
  /**
   * 直接 URL 或本地路徑
   */
  src?: string;

  /** Alt text */
  alt: string;

  /** 目標寬度 */
  width?: number;

  /** 目標高度 */
  height?: number;

  /** 圖片質量 (0-100) */
  quality?: number;

  /** 圖片格式 ('auto' 自動檢測最佳格式) */
  format?: ImageFormat;

  /** 適應模式 */
  fit?: ImageFit;

  /** 裁切重力 */
  gravity?: ImageGravity;

  /** DPR (Device Pixel Ratio) */
  dpr?: number;

  /** 是否生成 srcset (響應式圖片) */
  generateSrcset?: boolean;

  /** 背景顏色（用於 pad 模式） */
  background?: string;

  /** 是否啟用銳化 */
  sharpen?: number;

  /** 是否懶加載 */
  lazy?: boolean;

  /** 是否淡入效果 */
  fadeIn?: boolean;

  /** 是否顯示加載狀態 */
  showLoadingState?: boolean;

  /** 圖片類名 */
  imageClass?: string;

  /** 錯誤狀態類名 */
  errorClass?: string;

  /** 自定義樣式 */
  imageStyle?: CSSProperties;
}

const props = withDefaults(defineProps<Props>(), {
  format: "auto",
  fit: "scale-down",
  gravity: "auto",
  dpr: 1,
  generateSrcset: true,
  lazy: true,
  fadeIn: true,
  showLoadingState: false,
  imageClass: "",
  errorClass: "",
  imageStyle: () => ({}),
});

// ============================================================================
// 發射事件
// ============================================================================

const emit = defineEmits<{
  load: [event: Event];
  error: [event: Event];
  formatDetected: [format: ImageFormat];
}>();

// ============================================================================
// 圖片優化
// ============================================================================

const imageOptions = computed<ImageOptimizationOptions>(() => ({
  src: props.src,
  width: props.width,
  height: props.height,
  quality: props.quality,
  format: props.format,
  fit: props.fit,
  gravity: props.gravity,
  dpr: props.dpr,
  generateSrcset: props.generateSrcset,
  background: props.background,
  sharpen: props.sharpen,
}));

const {
  imageUrl: optimizedImageUrl,
  srcset: optimizedSrcset,
  sizes: optimizedSizes,
  detectedFormat,
  isLoading: optimizedIsLoading,
  error: optimizedError,
} = useOptimizedImage(imageOptions.value);

// ========================================
// 狀態管理
// ========================================

const localIsLoading = ref(true);
const localError = ref(false);

const isLoading = computed(() => {
  return localIsLoading.value || optimizedIsLoading.value;
});

const error = computed(() => {
  return localError.value || !!optimizedError.value;
});

// ========================================
// 計算屬性
// ========================================

/**
 * 最終圖片 URL
 */
const computedImageUrl = computed(() => {
  return optimizedImageUrl.value;
});

/**
 * 最終 srcset
 */
const computedSrcset = computed(() => {
  if (!props.generateSrcset) {
    return undefined;
  }
  return optimizedSrcset.value;
});

/**
 * 最終 sizes
 */
const computedSizes = computed(() => {
  if (!props.generateSrcset) {
    return undefined;
  }
  return optimizedSizes.value;
});

// ========================================
// 事件處理
// ========================================

const handleLoad = (event: Event) => {
  localIsLoading.value = false;
  emit("load", event);

  // 發射檢測到的格式
  if (detectedFormat.value) {
    emit("formatDetected", detectedFormat.value);
  }
};

const handleError = (event: Event) => {
  localIsLoading.value = false;
  localError.value = true;
  emit("error", event);
  console.error("Image failed to load:", computedImageUrl.value);
};
</script>

<style scoped>
.optimized-image {
  display: block;
  max-width: 100%;
}

.optimized-image-error {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f3f4f6;
}
</style>
