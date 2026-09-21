<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useI18n } from "@/i18n";
import { useToast } from "vue-toastification";
import {
  UserPlus,
  Building2,
  Shield,
  ChevronDown,
  Loader2,
} from "lucide-vue-next";
import { api, unwrapApiList } from "@/services/api";
import { useDateFormatter } from "@/composables/useDateFormatter";
import type { Restaurant, PlatformUser } from "@/types";
import { UserRole } from "@/types";
import { resolveUserFacingError } from "@makanmasak/shared/utils/user-facing-error";

const { t } = useI18n();
const { formatDate } = useDateFormatter();
const toast = useToast();

// ============================================================
// Tab State
// ============================================================

type TabType = "owners" | "admins";
const activeTab = ref<TabType>("owners");

// ============================================================
// Shared State
// ============================================================

const submitting = ref(false);
const submitError = ref("");
const restaurants = ref<Restaurant[]>([]);
const owners = ref<PlatformUser[]>([]);
const admins = ref<PlatformUser[]>([]);
const loadingOwners = ref(false);
const loadingAdmins = ref(false);
const showNewRestaurant = ref(false);

// Owner form
const ownerForm = reactive({
  username: "",
  password: "",
  fullName: "",
  email: "",
  phone: "",
  restaurantId: undefined as string | undefined,
  newRestaurantName: "",
  newRestaurantType: "",
  newRestaurantAddress: "",
  newRestaurantDistrict: "",
  newRestaurantPhone: "",
});

// Admin form
const adminForm = reactive({
  username: "",
  password: "",
  fullName: "",
  email: "",
});

const errors = reactive<Record<string, string>>({});

// ============================================================
// Validation
// ============================================================

const passwordRegex =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

function clearErrors() {
  Object.keys(errors).forEach((key) => delete errors[key]);
}

function validateOwnerForm(): boolean {
  clearErrors();

  if (!ownerForm.username.trim()) {
    errors.username = t("accountManagement.usernameRequired");
  } else if (ownerForm.username.length < 3 || ownerForm.username.length > 50) {
    errors.username = t("accountManagement.usernameLength");
  }

  if (!ownerForm.password) {
    errors.password = t("accountManagement.passwordRequired");
  } else if (!passwordRegex.test(ownerForm.password)) {
    errors.password = t("accountManagement.passwordStrength");
  }

  if (!ownerForm.fullName.trim()) {
    errors.fullName = t("accountManagement.fullNameRequired");
  }

  if (!ownerForm.email.trim()) {
    errors.email = t("accountManagement.emailRequired");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerForm.email)) {
    errors.email = t("accountManagement.emailInvalid");
  }

  if (showNewRestaurant.value) {
    if (!ownerForm.newRestaurantName?.trim()) {
      errors.newRestaurantName = t(
        "accountManagement.newRestaurantNameRequired",
      );
    }
    if (!ownerForm.newRestaurantType?.trim()) {
      errors.newRestaurantType = t(
        "accountManagement.newRestaurantTypeRequired",
      );
    }
    if (!ownerForm.newRestaurantDistrict?.trim()) {
      errors.newRestaurantDistrict = t(
        "accountManagement.newRestaurantDistrictRequired",
      );
    }
    if (!ownerForm.newRestaurantPhone?.trim()) {
      errors.newRestaurantPhone = t(
        "accountManagement.newRestaurantPhoneRequired",
      );
    }
  } else if (!ownerForm.restaurantId) {
    errors.restaurantId = t("accountManagement.restaurantRequired");
  }

  return Object.keys(errors).length === 0;
}

function validateAdminForm(): boolean {
  clearErrors();

  if (!adminForm.username.trim()) {
    errors.username = t("accountManagement.usernameRequired");
  } else if (adminForm.username.length < 3 || adminForm.username.length > 50) {
    errors.username = t("accountManagement.usernameLength");
  }

  if (!adminForm.password) {
    errors.password = t("accountManagement.passwordRequired");
  } else if (!passwordRegex.test(adminForm.password)) {
    errors.password = t("accountManagement.passwordStrength");
  }

  if (!adminForm.fullName.trim()) {
    errors.fullName = t("accountManagement.fullNameRequired");
  }

  if (!adminForm.email.trim()) {
    errors.email = t("accountManagement.emailRequired");
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminForm.email)) {
    errors.email = t("accountManagement.emailInvalid");
  }

  return Object.keys(errors).length === 0;
}

// ============================================================
// Data Loading
// ============================================================

async function fetchRestaurants() {
  try {
    const response = await api.get<Restaurant[]>("/restaurants");
    if (response.data?.success && response.data.data) {
      const payload = response.data.data;
      restaurants.value = unwrapApiList<Restaurant>(payload);
    }
  } catch (e) {
    console.error("Failed to fetch restaurants:", e);
  }
}

async function fetchOwners() {
  loadingOwners.value = true;
  try {
    const response = await api.get<PlatformUser[]>("/users", {
      params: { role: 1 },
    });
    if (response.data?.success && response.data.data) {
      const payload = response.data.data;
      owners.value = unwrapApiList<PlatformUser>(payload);
    }
  } catch (e) {
    console.error("Failed to fetch owners:", e);
  } finally {
    loadingOwners.value = false;
  }
}

async function fetchAdmins() {
  loadingAdmins.value = true;
  try {
    const response = await api.get<PlatformUser[]>("/users", {
      params: { role: 0 },
    });
    if (response.data?.success && response.data.data) {
      const payload = response.data.data;
      admins.value = unwrapApiList<PlatformUser>(payload);
    }
  } catch (e) {
    console.error("Failed to fetch admins:", e);
  } finally {
    loadingAdmins.value = false;
  }
}

onMounted(() => {
  fetchRestaurants();
  fetchOwners();
  fetchAdmins();
});

// ============================================================
// Form Submission
// ============================================================

function resetOwnerForm() {
  ownerForm.username = "";
  ownerForm.password = "";
  ownerForm.fullName = "";
  ownerForm.email = "";
  ownerForm.phone = "";
  ownerForm.restaurantId = undefined;
  ownerForm.newRestaurantName = "";
  ownerForm.newRestaurantType = "";
  ownerForm.newRestaurantAddress = "";
  ownerForm.newRestaurantDistrict = "";
  ownerForm.newRestaurantPhone = "";
  showNewRestaurant.value = false;
  clearErrors();
  submitError.value = "";
}

function resetAdminForm() {
  adminForm.username = "";
  adminForm.password = "";
  adminForm.fullName = "";
  adminForm.email = "";
  clearErrors();
  submitError.value = "";
}

async function handleOwnerSubmit() {
  if (!validateOwnerForm()) return;

  submitting.value = true;
  submitError.value = "";

  try {
    let restaurantId = ownerForm.restaurantId;

    // Create restaurant if needed
    if (showNewRestaurant.value) {
      const restaurantRes = await api.post<Restaurant>("/restaurants", {
        name: ownerForm.newRestaurantName,
        type: ownerForm.newRestaurantType,
        category: "restaurant",
        address: ownerForm.newRestaurantAddress,
        district: ownerForm.newRestaurantDistrict,
        phone: ownerForm.newRestaurantPhone,
        email: ownerForm.email,
      });
      if (restaurantRes.data?.success && restaurantRes.data.data) {
        restaurantId = String(restaurantRes.data.data.id);
        await fetchRestaurants();
      } else {
        throw new Error(
          restaurantRes.data?.error?.message || "Failed to create restaurant",
        );
      }
    }

    // Create owner user
    await api.post("/users", {
      username: ownerForm.username,
      password: ownerForm.password,
      fullName: ownerForm.fullName,
      email: ownerForm.email,
      phone: ownerForm.phone || undefined,
      role: UserRole.OWNER,
      restaurantId,
    });

    toast.success(t("accountManagement.createOwnerSuccess"));
    resetOwnerForm();
    await fetchOwners();
  } catch (e: unknown) {
    const msg = resolveUserFacingError(e, t, {
      fallbackKey: "accountManagement.createError",
    }).message;
    submitError.value = msg;
  } finally {
    submitting.value = false;
  }
}

async function handleAdminSubmit() {
  if (!validateAdminForm()) return;

  submitting.value = true;
  submitError.value = "";

  try {
    await api.post("/users", {
      username: adminForm.username,
      password: adminForm.password,
      fullName: adminForm.fullName,
      email: adminForm.email,
      role: UserRole.ADMIN,
    });

    toast.success(t("accountManagement.createAdminSuccess"));
    resetAdminForm();
    await fetchAdmins();
  } catch (e: unknown) {
    const msg = resolveUserFacingError(e, t, {
      fallbackKey: "accountManagement.createError",
    }).message;
    submitError.value = msg;
  } finally {
    submitting.value = false;
  }
}

// ============================================================
// Restaurant Selection
// ============================================================

function handleRestaurantChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "__new__") {
    showNewRestaurant.value = true;
    ownerForm.restaurantId = undefined;
  } else {
    showNewRestaurant.value = false;
    ownerForm.restaurantId = value || undefined;
  }
}

// ============================================================
// Helpers
// ============================================================

function getRestaurantName(restaurantId: string | null): string {
  if (!restaurantId) return "—";
  const r = restaurants.value.find(
    (rest) => String(rest.id) === String(restaurantId),
  );
  return r?.name || restaurantId;
}

function switchTab(tab: TabType) {
  activeTab.value = tab;
  clearErrors();
  submitError.value = "";
}
</script>

<template>
  <div class="max-w-4xl mx-auto space-y-6">
    <!-- Page Title -->
    <h1 class="text-2xl font-bold text-gray-900">
      {{ t("accountManagement.title") }}
    </h1>

    <!-- Tab Navigation -->
    <div class="border-b border-gray-200">
      <nav class="flex gap-6" aria-label="Tabs">
        <button
          class="pb-3 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'owners'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          "
          :data-active="activeTab === 'owners'"
          @click="switchTab('owners')"
        >
          {{ t("accountManagement.tabOwners") }}
        </button>
        <button
          class="pb-3 text-sm font-medium border-b-2 transition-colors"
          :class="
            activeTab === 'admins'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          "
          :data-active="activeTab === 'admins'"
          @click="switchTab('admins')"
        >
          {{ t("accountManagement.tabAdmins") }}
        </button>
      </nav>
    </div>

    <!-- ==================== Owner Tab ==================== -->
    <template v-if="activeTab === 'owners'">
      <!-- Owner Registration Form -->
      <form
        data-testid="account-management-owner-form"
        class="bg-white rounded-lg shadow-sm border border-gray-200"
        @submit.prevent="handleOwnerSubmit"
      >
        <!-- Section 1: Account Info -->
        <div class="px-6 py-5 border-b border-gray-200">
          <div class="flex items-center gap-2 mb-4">
            <UserPlus class="w-5 h-5 text-blue-600" />
            <h2 class="text-lg font-semibold text-gray-900">
              {{ t("accountManagement.accountInfo") }}
            </h2>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.username") }} *
              </label>
              <input
                v-model="ownerForm.username"
                data-testid="account-management-owner-username"
                type="text"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.username }"
                :placeholder="t('accountManagement.usernamePlaceholder')"
              />
              <p v-if="errors.username" class="mt-1 text-xs text-red-600">
                {{ errors.username }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.password") }} *
              </label>
              <input
                v-model="ownerForm.password"
                data-testid="account-management-owner-password"
                type="password"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.password }"
                :placeholder="t('accountManagement.passwordPlaceholder')"
              />
              <p v-if="errors.password" class="mt-1 text-xs text-red-600">
                {{ errors.password }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.fullName") }} *
              </label>
              <input
                v-model="ownerForm.fullName"
                data-testid="account-management-owner-full-name"
                type="text"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.fullName }"
                :placeholder="t('accountManagement.fullNamePlaceholder')"
              />
              <p v-if="errors.fullName" class="mt-1 text-xs text-red-600">
                {{ errors.fullName }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.email") }} *
              </label>
              <input
                v-model="ownerForm.email"
                data-testid="account-management-owner-email"
                type="email"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.email }"
                :placeholder="t('accountManagement.emailPlaceholder')"
              />
              <p v-if="errors.email" class="mt-1 text-xs text-red-600">
                {{ errors.email }}
              </p>
            </div>
          </div>
        </div>

        <!-- Section 2: Restaurant Binding -->
        <div class="px-6 py-5 border-b border-gray-200">
          <div class="flex items-center gap-2 mb-4">
            <Building2 class="w-5 h-5 text-green-600" />
            <h2 class="text-lg font-semibold text-gray-900">
              {{ t("accountManagement.restaurantBinding") }}
            </h2>
          </div>

          <div class="space-y-4">
            <!-- Restaurant Select -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.restaurant") }} *
              </label>
              <div class="relative">
                <select
                  data-testid="account-management-owner-restaurant"
                  class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm appearance-none pr-10"
                  :class="{ 'border-red-300': errors.restaurantId }"
                  :value="
                    showNewRestaurant ? '__new__' : ownerForm.restaurantId || ''
                  "
                  @change="handleRestaurantChange"
                >
                  <option value="" disabled>
                    {{ t("accountManagement.selectRestaurant") }}
                  </option>
                  <option v-for="r in restaurants" :key="r.id" :value="r.id">
                    {{ r.name }}
                  </option>
                  <option value="__new__">
                    {{ t("accountManagement.createNewRestaurant") }}
                  </option>
                </select>
                <ChevronDown
                  class="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
                />
              </div>
              <p v-if="errors.restaurantId" class="mt-1 text-xs text-red-600">
                {{ errors.restaurantId }}
              </p>
            </div>

            <!-- New Restaurant Fields -->
            <div
              v-if="showNewRestaurant"
              class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-green-50 rounded-lg border border-green-200"
            >
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t("accountManagement.restaurantName") }} *
                </label>
                <input
                  v-model="ownerForm.newRestaurantName"
                  data-testid="account-management-new-restaurant-name"
                  type="text"
                  class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  :class="{ 'border-red-300': errors.newRestaurantName }"
                  :placeholder="
                    t('accountManagement.restaurantNamePlaceholder')
                  "
                />
                <p
                  v-if="errors.newRestaurantName"
                  class="mt-1 text-xs text-red-600"
                >
                  {{ errors.newRestaurantName }}
                </p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t("accountManagement.restaurantType") }} *
                </label>
                <input
                  v-model="ownerForm.newRestaurantType"
                  data-testid="account-management-new-restaurant-type"
                  type="text"
                  class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  :class="{ 'border-red-300': errors.newRestaurantType }"
                  :placeholder="
                    t('accountManagement.restaurantTypePlaceholder')
                  "
                />
                <p
                  v-if="errors.newRestaurantType"
                  class="mt-1 text-xs text-red-600"
                >
                  {{ errors.newRestaurantType }}
                </p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t("accountManagement.restaurantAddress") }}
                </label>
                <input
                  v-model="ownerForm.newRestaurantAddress"
                  data-testid="account-management-new-restaurant-address"
                  type="text"
                  class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  :placeholder="
                    t('accountManagement.restaurantAddressPlaceholder')
                  "
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t("accountManagement.restaurantDistrict") }} *
                </label>
                <input
                  v-model="ownerForm.newRestaurantDistrict"
                  data-testid="account-management-new-restaurant-district"
                  type="text"
                  class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  :class="{ 'border-red-300': errors.newRestaurantDistrict }"
                  :placeholder="
                    t('accountManagement.restaurantDistrictPlaceholder')
                  "
                />
                <p
                  v-if="errors.newRestaurantDistrict"
                  class="mt-1 text-xs text-red-600"
                >
                  {{ errors.newRestaurantDistrict }}
                </p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  {{ t("accountManagement.restaurantPhone") }} *
                </label>
                <input
                  v-model="ownerForm.newRestaurantPhone"
                  data-testid="account-management-new-restaurant-phone"
                  type="tel"
                  class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                  :class="{ 'border-red-300': errors.newRestaurantPhone }"
                  :placeholder="
                    t('accountManagement.restaurantPhonePlaceholder')
                  "
                />
                <p
                  v-if="errors.newRestaurantPhone"
                  class="mt-1 text-xs text-red-600"
                >
                  {{ errors.newRestaurantPhone }}
                </p>
              </div>
            </div>

            <!-- Phone -->
            <div class="max-w-sm">
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.phone") }}
              </label>
              <input
                v-model="ownerForm.phone"
                data-testid="account-management-owner-phone"
                type="tel"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :placeholder="t('accountManagement.phonePlaceholder')"
              />
            </div>
          </div>
        </div>

        <!-- Section 3: Permission Confirmation -->
        <div class="px-6 py-5 border-b border-gray-200">
          <div class="flex items-center gap-2 mb-4">
            <Shield class="w-5 h-5 text-amber-600" />
            <h2 class="text-lg font-semibold text-gray-900">
              {{ t("accountManagement.permissionConfirm") }}
            </h2>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p class="text-sm text-amber-800 font-medium mb-2">
              {{ t("accountManagement.permissionNote") }}
            </p>
            <ul class="text-sm text-amber-700 space-y-1 list-disc list-inside">
              <li>
                {{ t("accountManagement.ownerPermissions.manageMenu") }}
              </li>
              <li>
                {{ t("accountManagement.ownerPermissions.manageOrders") }}
              </li>
              <li>
                {{ t("accountManagement.ownerPermissions.manageEmployees") }}
              </li>
              <li>
                {{ t("accountManagement.ownerPermissions.viewAnalytics") }}
              </li>
              <li>
                {{ t("accountManagement.ownerPermissions.manageSettings") }}
              </li>
            </ul>
          </div>
        </div>

        <!-- Error Banner + Submit -->
        <div class="px-6 py-4 space-y-3">
          <div
            v-if="submitError"
            class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
          >
            {{ submitError }}
          </div>
          <button
            data-testid="account-management-owner-submit"
            type="submit"
            class="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            :disabled="submitting"
          >
            <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
            {{
              submitting
                ? t("accountManagement.submitting")
                : t("accountManagement.submitOwner")
            }}
          </button>
        </div>
      </form>

      <!-- Existing Owners Table -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">
            {{ t("accountManagement.existingOwners") }}
          </h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.ownerName") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.restaurantCol") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.statusCol") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.createdAtCol") }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr v-if="loadingOwners">
                <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                  <Loader2 class="w-5 h-5 animate-spin mx-auto mb-2" />
                </td>
              </tr>
              <tr v-else-if="owners.length === 0">
                <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                  {{ t("accountManagement.noOwners") }}
                </td>
              </tr>
              <tr
                v-for="owner in owners"
                :key="owner.id"
                class="hover:bg-gray-50"
              >
                <td class="px-6 py-4">
                  <div class="font-medium text-gray-900">
                    {{ owner.fullName || owner.username }}
                  </div>
                  <div class="text-xs text-gray-500">@{{ owner.username }}</div>
                </td>
                <td class="px-6 py-4 text-gray-700">
                  {{ getRestaurantName(owner.restaurantId) }}
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                    :class="
                      owner.status === 'active' || !owner.status
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    "
                  >
                    {{
                      owner.status === "active" || !owner.status
                        ? t("accountManagement.statusActive")
                        : t("accountManagement.statusInactive")
                    }}
                  </span>
                </td>
                <td class="px-6 py-4 text-gray-500">
                  {{ formatDate(owner.createdAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ==================== Admin Tab ==================== -->
    <template v-if="activeTab === 'admins'">
      <!-- Admin Registration Form (simplified — no restaurant binding) -->
      <form
        class="bg-white rounded-lg shadow-sm border border-gray-200"
        @submit.prevent="handleAdminSubmit"
      >
        <div class="px-6 py-5 border-b border-gray-200">
          <div class="flex items-center gap-2 mb-4">
            <UserPlus class="w-5 h-5 text-blue-600" />
            <h2 class="text-lg font-semibold text-gray-900">
              {{ t("accountManagement.accountInfo") }}
            </h2>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.username") }} *
              </label>
              <input
                v-model="adminForm.username"
                type="text"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.username }"
                :placeholder="t('accountManagement.usernamePlaceholder')"
              />
              <p v-if="errors.username" class="mt-1 text-xs text-red-600">
                {{ errors.username }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.password") }} *
              </label>
              <input
                v-model="adminForm.password"
                type="password"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.password }"
                :placeholder="t('accountManagement.passwordPlaceholder')"
              />
              <p v-if="errors.password" class="mt-1 text-xs text-red-600">
                {{ errors.password }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.fullName") }} *
              </label>
              <input
                v-model="adminForm.fullName"
                type="text"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.fullName }"
                :placeholder="t('accountManagement.fullNamePlaceholder')"
              />
              <p v-if="errors.fullName" class="mt-1 text-xs text-red-600">
                {{ errors.fullName }}
              </p>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                {{ t("accountManagement.email") }} *
              </label>
              <input
                v-model="adminForm.email"
                type="email"
                class="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
                :class="{ 'border-red-300': errors.email }"
                :placeholder="t('accountManagement.emailPlaceholder')"
              />
              <p v-if="errors.email" class="mt-1 text-xs text-red-600">
                {{ errors.email }}
              </p>
            </div>
          </div>
        </div>

        <!-- Error Banner + Submit -->
        <div class="px-6 py-4 space-y-3">
          <div
            v-if="submitError"
            class="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700"
          >
            {{ submitError }}
          </div>
          <button
            type="submit"
            class="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            :disabled="submitting"
          >
            <Loader2 v-if="submitting" class="w-4 h-4 animate-spin" />
            {{
              submitting
                ? t("accountManagement.submitting")
                : t("accountManagement.submitAdmin")
            }}
          </button>
        </div>
      </form>

      <!-- Existing Admins Table -->
      <div class="bg-white rounded-lg shadow-sm border border-gray-200">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-lg font-semibold text-gray-900">
            {{ t("accountManagement.existingAdmins") }}
          </h2>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.adminName") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.emailCol") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.statusCol") }}
                </th>
                <th
                  class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {{ t("accountManagement.createdAtCol") }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-200">
              <tr v-if="loadingAdmins">
                <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                  <Loader2 class="w-5 h-5 animate-spin mx-auto mb-2" />
                </td>
              </tr>
              <tr v-else-if="admins.length === 0">
                <td colspan="4" class="px-6 py-8 text-center text-gray-500">
                  {{ t("accountManagement.noAdmins") }}
                </td>
              </tr>
              <tr
                v-for="admin in admins"
                :key="admin.id"
                class="hover:bg-gray-50"
              >
                <td class="px-6 py-4">
                  <div class="font-medium text-gray-900">
                    {{ admin.fullName || admin.username }}
                  </div>
                  <div class="text-xs text-gray-500">@{{ admin.username }}</div>
                </td>
                <td class="px-6 py-4 text-gray-700">
                  {{ admin.email }}
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                    :class="
                      admin.status === 'active' || !admin.status
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-800'
                    "
                  >
                    {{
                      admin.status === "active" || !admin.status
                        ? t("accountManagement.statusActive")
                        : t("accountManagement.statusInactive")
                    }}
                  </span>
                </td>
                <td class="px-6 py-4 text-gray-500">
                  {{ formatDate(admin.createdAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
