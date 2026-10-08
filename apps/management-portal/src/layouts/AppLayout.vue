<script setup lang="ts">
import { ref, computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  HomeIcon,
  BuildingStorefrontIcon,
  CloudIcon,
  HeartIcon,
  KeyIcon,
  MapIcon,
  GlobeAltIcon,
  Bars3Icon,
  XMarkIcon,
  LanguageIcon,
  CheckIcon,
  ArrowLeftOnRectangleIcon,
} from "@heroicons/vue/24/outline";
import { clearManagementSession } from "@/services/auth";
import { useI18n, type Locale } from "@/i18n";

const { t, locale, localeConfig, switchLocale, supportedLocales } = useI18n();
const route = useRoute();
const sidebarOpen = ref(false);
const showLanguageMenu = ref(false);

const handleLocaleChange = async (code: string) => {
  await switchLocale(code as Locale);
  showLanguageMenu.value = false;
};

const logout = () => {
  clearManagementSession();
  window.location.assign("/login");
};

const navigation = computed(() => [
  { name: t("nav.dashboard"), href: "/", icon: HomeIcon },
  { name: t("nav.tenants"), href: "/tenants", icon: BuildingStorefrontIcon },
  { name: t("nav.deployments"), href: "/deployments", icon: CloudIcon },
  { name: t("nav.health"), href: "/health", icon: HeartIcon },
  { name: t("nav.licenses"), href: "/licenses", icon: KeyIcon },
  { name: t("nav.markets"), href: "/markets", icon: MapIcon },
  { name: t("nav.policies"), href: "/policies", icon: GlobeAltIcon },
]);

const isCurrentRoute = (href: string) => {
  if (href === "/") {
    return route.path === "/";
  }
  return route.path.startsWith(href);
};
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Mobile sidebar -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-40 lg:hidden"
      @click="sidebarOpen = false"
    >
      <div class="fixed inset-0 bg-gray-600 bg-opacity-75" />
      <div class="fixed inset-y-0 left-0 flex w-64 flex-col bg-white">
        <div
          class="flex h-16 items-center justify-between px-4 border-b border-gray-200"
        >
          <span class="text-xl font-bold text-primary-600">MakanMasak</span>
          <button
            type="button"
            class="text-gray-500 hover:text-gray-700"
            @click="sidebarOpen = false"
          >
            <XMarkIcon class="h-6 w-6" />
          </button>
        </div>
        <nav class="flex-1 space-y-1 px-2 py-4">
          <RouterLink
            v-for="item in navigation"
            :key="item.name"
            :to="item.href"
            :class="[
              isCurrentRoute(item.href)
                ? 'bg-primary-50 text-primary-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              'group flex items-center px-3 py-2 text-sm font-medium rounded-md',
            ]"
            @click="sidebarOpen = false"
          >
            <component
              :is="item.icon"
              :class="[
                isCurrentRoute(item.href)
                  ? 'text-primary-600'
                  : 'text-gray-400 group-hover:text-gray-500',
                'mr-3 h-5 w-5 flex-shrink-0',
              ]"
            />
            {{ item.name }}
          </RouterLink>
        </nav>

        <div class="px-2 pb-4">
          <button
            type="button"
            class="group flex w-full items-center px-3 py-2 text-sm font-medium rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            @click="logout"
          >
            <ArrowLeftOnRectangleIcon
              class="mr-3 h-5 w-5 flex-shrink-0 text-gray-400 group-hover:text-gray-500"
            />
            登出
          </button>
        </div>
      </div>
    </div>

    <!-- Desktop sidebar -->
    <div class="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
      <div class="flex flex-col flex-grow bg-white border-r border-gray-200">
        <!-- Logo -->
        <div class="flex h-16 items-center px-6 border-b border-gray-200">
          <span class="text-xl font-bold text-primary-600">MakanMasak</span>
          <span class="ml-2 text-sm text-gray-500">{{
            t("layout.managementPortal")
          }}</span>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 space-y-1 px-3 py-4">
          <RouterLink
            v-for="item in navigation"
            :key="item.name"
            :to="item.href"
            :class="[
              isCurrentRoute(item.href)
                ? 'bg-primary-50 text-primary-700'
                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
              'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors',
            ]"
          >
            <component
              :is="item.icon"
              :class="[
                isCurrentRoute(item.href)
                  ? 'text-primary-600'
                  : 'text-gray-400 group-hover:text-gray-500',
                'mr-3 h-5 w-5 flex-shrink-0',
              ]"
            />
            {{ item.name }}
          </RouterLink>
        </nav>

        <div class="px-3 pb-4">
          <button
            type="button"
            class="group flex w-full items-center px-3 py-2 text-sm font-medium rounded-md text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
            @click="logout"
          >
            <ArrowLeftOnRectangleIcon
              class="mr-3 h-5 w-5 flex-shrink-0 text-gray-400 group-hover:text-gray-500"
            />
            登出
          </button>
        </div>

        <!-- Language Switcher + Version info -->
        <div class="px-4 py-4 border-t border-gray-200 space-y-3">
          <div class="relative">
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 rounded-md hover:bg-gray-50 transition-colors"
              @click="showLanguageMenu = !showLanguageMenu"
            >
              <LanguageIcon class="h-5 w-5 text-gray-400" />
              <span class="flex-1 text-left">{{
                localeConfig.nativeName
              }}</span>
              <span class="text-base">{{ localeConfig.flag }}</span>
            </button>
            <transition name="dropdown">
              <div
                v-if="showLanguageMenu"
                class="absolute left-0 right-0 bottom-full mb-2 bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden z-50"
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
          <p class="text-xs text-gray-500 px-3">
            {{ t("layout.version", { version: "1.0.0" }) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Main content area -->
    <div class="lg:pl-64">
      <!-- Top bar -->
      <div
        class="sticky top-0 z-10 flex h-16 bg-white border-b border-gray-200 lg:hidden"
      >
        <button
          type="button"
          class="px-4 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
          @click="sidebarOpen = true"
        >
          <Bars3Icon class="h-6 w-6" />
        </button>
        <div class="flex items-center px-4">
          <span class="text-lg font-bold text-primary-600">MakanMasak</span>
        </div>
      </div>

      <!-- Page content -->
      <main class="py-6">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}
.dropdown-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
