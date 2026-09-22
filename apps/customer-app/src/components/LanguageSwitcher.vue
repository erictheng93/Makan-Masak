<template>
  <div class="language-switcher">
    <div class="relative">
      <button
        class="flex items-center gap-2 px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        :class="{ 'h-10 w-10 justify-center px-0': compact }"
        @click="toggleDropdown"
      >
        <span class="text-lg">{{ currentLanguageInfo?.flag }}</span>
        <span v-if="!compact" class="font-medium">{{
          currentLanguageInfo?.name
        }}</span>
        <svg
          class="w-4 h-4 transition-transform duration-200"
          :class="{ 'rotate-180': isOpen }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      <div
        v-show="isOpen"
        class="absolute top-full mt-1 w-full min-w-max bg-white border border-gray-300 rounded-lg shadow-lg z-50"
        :class="compact ? 'right-0' : 'left-0'"
      >
        <div class="py-1">
          <button
            v-for="language in supportedLanguages"
            :key="language.code"
            class="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-50"
            :class="{
              'bg-orange-50 text-orange-700': currentLanguage === language.code,
            }"
            @click="selectLanguage(language.code)"
          >
            <span class="text-lg">{{ language.flag }}</span>
            <span class="font-medium">{{ language.name }}</span>
            <svg
              v-if="currentLanguage === language.code"
              class="w-4 h-4 ml-auto text-orange-600"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "@/composables/useI18n";
import type { SupportedLanguage } from "@/i18n";

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const {
  currentLanguage,
  currentLanguageInfo,
  supportedLanguages,
  changeLanguage,
} = useI18n();

const isOpen = ref(false);

const toggleDropdown = () => {
  isOpen.value = !isOpen.value;
};

const selectLanguage = (language: SupportedLanguage) => {
  changeLanguage(language);
  isOpen.value = false;
};

const closeDropdown = (event: MouseEvent) => {
  const target = event.target as Element;
  if (!target.closest(".language-switcher")) {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", closeDropdown);
});

onUnmounted(() => {
  document.removeEventListener("click", closeDropdown);
});
</script>
