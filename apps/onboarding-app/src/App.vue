<script setup lang="ts">
import { ref } from "vue";
import { RouterView } from "vue-router";
import { LanguageIcon, CheckIcon } from "@heroicons/vue/24/outline";
import { useI18n, type Locale } from "@/i18n";

const { t, locale, localeConfig, switchLocale, supportedLocales } = useI18n();

const showLanguageMenu = ref(false);

const handleLocaleChange = async (code: string) => {
  await switchLocale(code as Locale);
  showLanguageMenu.value = false;
};
</script>

<template>
  <div class="min-h-screen bg-ios-bg">
    <!-- Header -->
    <header
      class="bg-white/80 backdrop-blur-md shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    >
      <div class="max-w-4xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <span class="text-2xl font-bold text-primary-600">MakanMasak</span>
            <span class="ml-2 text-sm text-gray-500">{{
              t("app.tagline.platformHosted")
            }}</span>
          </div>

          <!-- Language Switcher -->
          <div class="relative">
            <button
              type="button"
              class="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 rounded-full bg-white/60 hover:bg-white transition-colors border border-gray-200"
              @click="showLanguageMenu = !showLanguageMenu"
            >
              <LanguageIcon class="h-4 w-4 text-gray-400" />
              <span class="text-base">{{ localeConfig.flag }}</span>
              <span class="hidden sm:inline">{{
                localeConfig.nativeName
              }}</span>
            </button>
            <transition name="dropdown">
              <div
                v-if="showLanguageMenu"
                class="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50 min-w-[180px]"
              >
                <button
                  v-for="loc in supportedLocales"
                  :key="loc.code"
                  type="button"
                  class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-gray-50"
                  :class="
                    loc.code === locale
                      ? 'text-primary-600 font-semibold bg-primary-50'
                      : 'text-gray-700'
                  "
                  @click="handleLocaleChange(loc.code)"
                >
                  <span class="text-base">{{ loc.flag }}</span>
                  <span class="flex-1 text-left">{{ loc.nativeName }}</span>
                  <CheckIcon
                    v-if="loc.code === locale"
                    class="h-4 w-4 text-primary-600"
                  />
                </button>
              </div>
            </transition>
            <div
              v-if="showLanguageMenu"
              class="fixed inset-0 z-40"
              @click="showLanguageMenu = false"
            />
          </div>
        </div>
      </div>
    </header>

    <!-- Main -->
    <main class="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
      <RouterView />
    </main>

    <!-- Footer -->
    <footer class="mt-auto py-8">
      <div class="max-w-4xl mx-auto px-4 text-center text-sm text-gray-500">
        <p>{{ t("app.footer.copyright") }}</p>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-8px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
