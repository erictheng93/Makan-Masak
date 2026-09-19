<template>
  <div class="menu-view p-6 bg-ios-bg min-h-screen">
    <!-- Page header -->
    <div
      class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6"
    >
      <div>
        <h1 class="text-2xl font-bold text-ios-text">{{ t("menu.title") }}</h1>
        <p class="text-[15px] text-ios-secondary mt-0.5">
          {{ t("menu.subtitle") }}
        </p>
      </div>
      <div class="flex gap-2.5 items-center">
        <!-- Categories stat chip -->
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 bg-white rounded-full shadow-[0_1px_6px_rgba(0,0,0,0.06)]"
        >
          <span class="text-[13px] font-semibold text-ios-text">{{
            categories.length
          }}</span>
          <span class="text-[12px] text-ios-secondary">{{
            t("menu.stats.categories")
          }}</span>
        </div>
        <!-- Total items stat chip -->
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 bg-white rounded-full shadow-[0_1px_6px_rgba(0,0,0,0.06)]"
        >
          <span class="text-[13px] font-semibold text-ios-text">{{
            menuItems.length
          }}</span>
          <span class="text-[12px] text-ios-secondary">{{
            t("menu.stats.items")
          }}</span>
        </div>
        <!-- Available stat chip -->
        <div
          class="flex items-center gap-1.5 px-3.5 py-2 bg-ios-green-soft rounded-full"
        >
          <span class="text-[13px] font-semibold text-ios-green-deep">{{
            availableCount
          }}</span>
          <span class="text-[12px] text-ios-green-deep">{{
            t("menu.stats.available")
          }}</span>
        </div>
      </div>
    </div>

    <!-- Master-detail grid -->
    <div class="grid grid-cols-[300px_1fr] gap-5 items-start">
      <!-- LEFT: CategoryPanel -->
      <CategoryPanel
        :categories="categories"
        :menu-items="menuItems"
        :selected-category-id="selectedCategoryId"
        @select="selectedCategoryId = $event"
        @add-category="startAddCategory"
        @edit-category="startEditCategory"
        @delete-category="handleDeleteCategory"
        @reorder="reorderCategories"
      />

      <!-- RIGHT: Items panel -->
      <div>
        <!-- Items header -->
        <div
          class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 bg-white rounded-2xl px-5 py-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
        >
          <div class="flex items-center gap-3">
            <h2 class="text-[17px] font-bold text-ios-text">
              {{ currentCategoryName }}
            </h2>
            <span
              class="px-2.5 py-0.5 bg-ios-bg rounded-full text-[12px] font-semibold text-ios-secondary"
            >
              {{
                t("menu.itemsHeader.itemCount", { count: filteredItems.length })
              }}
            </span>
          </div>
          <div class="flex flex-wrap gap-2.5 items-center">
            <!-- Search input -->
            <div class="relative">
              <MagnifyingGlassIcon
                class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ios-tertiary"
              />
              <input
                v-model="searchQuery"
                data-testid="admin-menu-search"
                type="text"
                :placeholder="t('menu.searchPlaceholder')"
                class="pl-9 pr-4 py-2 bg-ios-bg rounded-full text-[13px] text-ios-text placeholder-ios-tertiary border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 w-44 transition-all"
              />
            </div>

            <!-- Status filter pills -->
            <div class="flex items-center bg-ios-bg rounded-full p-0.5">
              <button
                v-for="filter in statusFilters"
                :key="filter.value"
                :class="[
                  'px-3 py-1.5 rounded-full text-[12px] font-semibold transition-all',
                  statusFilter === filter.value
                    ? 'bg-white text-ios-text shadow-[0_1px_4px_rgba(0,0,0,0.1)]'
                    : 'text-ios-secondary hover:text-ios-text',
                ]"
                @click="statusFilter = filter.value"
              >
                {{ filter.label }}
              </button>
            </div>

            <!-- Add item button -->
            <button
              data-testid="admin-menu-add-item"
              class="flex items-center gap-1.5 px-[18px] py-[9px] bg-blue-600 text-white rounded-full text-[13px] font-semibold -translate-y-px shadow-[0_4px_14px_rgba(0,122,255,0.3)]"
              @click="openAddItemModal"
            >
              <PlusIcon class="h-4 w-4" />
              {{ t("menu.addItem") }}
            </button>
          </div>
        </div>

        <section
          class="mb-4 rounded-2xl bg-white px-5 py-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
        >
          <div
            v-if="isMarketProductGapContext"
            data-testid="market-product-gap-context"
            class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
          >
            <h3 class="text-[15px] font-bold text-amber-900">市場搜尋缺商品</h3>
            <p class="mt-1 text-[13px] leading-5 text-amber-800">
              新增可販售餐點或商品並保持上架後，這間店鋪會更容易出現在
              {{ marketGapName || "夜市/商圈" }} 搜尋結果。
            </p>
          </div>
          <div class="flex flex-col gap-3 sm:flex-row sm:justify-between">
            <div>
              <h3 class="text-[15px] font-bold text-ios-text">
                {{ t("menu.import.title") }}
              </h3>
              <p class="mt-1 text-[13px] text-ios-secondary">
                {{ t("menu.import.description") }}
              </p>
            </div>
            <button
              type="button"
              class="w-fit rounded-full bg-ios-bg px-3.5 py-2 text-[13px] font-semibold text-ios-text hover:bg-ios-separator"
              @click="loadMenuItemImportExample"
            >
              {{ t("menu.import.loadExample") }}
            </button>
          </div>

          <textarea
            v-model="menuItemImportText"
            rows="6"
            data-testid="menu-item-import-csv"
            class="mt-3 w-full rounded-xl border-0 bg-ios-bg px-3 py-2 font-mono text-[13px] text-ios-text outline-none focus:ring-2 focus:ring-ios-primary/30"
            placeholder="name,category,price,description,imageUrl,isFeatured,isAvailable,sortOrder,catalogType,tags,keywords"
          />

          <div
            v-if="menuItemImportPreview.errors.length"
            class="mt-3 space-y-1"
          >
            <p
              v-for="importError in menuItemImportPreview.errors"
              :key="importError"
              class="text-[13px] text-ios-error"
            >
              {{ importError }}
            </p>
          </div>
          <p v-if="menuItemImportError" class="mt-3 text-[13px] text-ios-error">
            {{ menuItemImportError }}
          </p>
          <div
            v-if="
              menuItemImportText.trim() &&
              !menuItemImportPreview.errors.length &&
              menuItemImportPreview.items.length
            "
            class="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-[13px] text-blue-800"
          >
            {{
              t("menu.import.previewReady", {
                count: menuItemImportPreview.items.length,
              })
            }}
          </div>
          <div
            v-if="menuItemImportResult"
            data-testid="menu-item-import-success"
            class="mt-3 rounded-xl bg-green-50 px-3 py-2 text-[13px] text-green-800"
          >
            {{
              t("menu.import.successBanner", { count: menuItemImportResult })
            }}
          </div>
          <div
            v-if="showMarketProductGapNextStep"
            data-testid="market-product-gap-next-step"
            class="mt-3 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[13px] leading-5 text-blue-800"
          >
            已補齊
            {{ marketGapName || "夜市/商圈" }}
            的商品資料。請回到市場公開品質並重建搜尋索引，讓顧客搜尋立即包含這批商品。
            <button
              type="button"
              data-testid="market-product-gap-return"
              class="mt-2 block rounded-lg bg-blue-100 px-3 py-1.5 text-[12px] font-semibold text-blue-900 hover:bg-blue-200"
              @click="returnToMarketReadiness"
            >
              回市場公開品質
            </button>
          </div>

          <div class="mt-4 flex justify-end">
            <button
              type="button"
              data-testid="menu-item-import-submit"
              class="rounded-full bg-blue-600 px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(0,122,255,0.25)] disabled:opacity-50"
              :disabled="
                isImportingMenuItems ||
                !menuItemImportText.trim() ||
                menuItemImportPreview.errors.length > 0 ||
                menuItemImportPreview.items.length === 0
              "
              @click="importMenuItemsFromCsv"
            >
              {{
                isImportingMenuItems
                  ? t("menu.import.submitting")
                  : t("menu.import.submit")
              }}
            </button>
          </div>
        </section>

        <ImageAssistedMenuImport
          :categories="categories"
          :source-images="imageMenuSourceImages"
          :is-publishing="isPublishingImageMenu"
          :upload-error="imageMenuUploadError"
          :publish-error="imageMenuPublishError"
          :errors="imageMenuErrors"
          :category-errors="imageMenuCategoryErrors"
          @select-images="uploadImageMenuSources"
          @publish="publishImageAssistedMenu"
        />

        <!-- VirtualMenuGrid -->
        <VirtualMenuGrid
          v-if="filteredItems.length > 0"
          ref="menuGridRef"
          :menu-items="filteredItems"
          :item-height="330"
          :container-height="800"
          :columns-count="3"
          :buffer-size="3"
        >
          <template #default="{ menuItem }">
            <MenuItemCard
              :item="menuItem"
              :category-name="getCategoryName(menuItem.categoryId)"
              :highlighted="menuItem.id === highlightedItemId"
              @edit="editMenuItem"
              @toggle-status="toggleMenuItemStatus"
              @delete="handleDeleteMenuItem"
            />
          </template>
        </VirtualMenuGrid>

        <!-- Empty state -->
        <div
          v-if="filteredItems.length === 0 && !isLoading"
          class="flex flex-col items-center justify-center py-20 bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
        >
          <CakeIcon class="h-14 w-14 text-ios-tertiary mb-3" />
          <h3 class="text-[17px] font-semibold text-ios-text mb-1">
            {{ t("menu.empty.title") }}
          </h3>
          <p class="text-[14px] text-ios-secondary mb-5">
            {{ t("menu.empty.subtitle") }}
          </p>
          <button
            data-testid="admin-menu-add-item-empty"
            class="flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 text-white rounded-full text-[14px] font-semibold -translate-y-px shadow-[0_4px_14px_rgba(0,122,255,0.3)]"
            @click="openAddItemModal"
          >
            <PlusIcon class="h-4 w-4" />
            {{ t("menu.addItem") }}
          </button>
        </div>

        <!-- Loading state -->
        <div
          v-if="isLoading"
          class="flex items-center justify-center py-20 bg-white rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.04)]"
        >
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-ios-primary"
          />
        </div>
      </div>
    </div>

    <!-- Category edit modal -->
    <CategoryEditForm
      v-if="showCategoryEditForm"
      :editing-category="editingCategory"
      @save="handleSaveCategory"
      @cancel="cancelCategoryEdit"
    />

    <!-- Delete confirm modal -->
    <div v-if="showDeleteConfirm" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black/30 backdrop-blur-sm"
          @click="cancelDelete"
        />
        <div class="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full">
          <div class="p-6 text-center">
            <div
              class="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-ios-error/10 mb-4"
            >
              <ExclamationTriangleIcon class="h-6 w-6 text-ios-error" />
            </div>
            <h3 class="text-[17px] font-bold text-ios-text mb-2">
              {{ deleteConfirmTitle }}
            </h3>
            <p class="text-[14px] text-ios-secondary mb-6">
              {{ deleteConfirmMessage }}
            </p>
            <div class="flex gap-2.5 justify-center">
              <button
                data-testid="admin-delete-cancel"
                class="px-5 py-2.5 text-[14px] font-semibold text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors"
                @click="cancelDelete"
              >
                {{ t("common.cancel") }}
              </button>
              <button
                data-testid="admin-delete-confirm"
                class="px-5 py-2.5 text-[14px] font-semibold text-white bg-ios-error rounded-full hover:bg-ios-error/90 transition-colors shadow-[0_2px_8px_rgba(255,59,48,0.25)]"
                @click="confirmDelete"
              >
                {{ t("common.delete") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Menu item modal -->
    <div v-if="showMenuItemModal" class="fixed inset-0 z-50 overflow-y-auto">
      <div class="flex items-center justify-center min-h-screen px-4">
        <div
          class="fixed inset-0 bg-black/30 backdrop-blur-sm"
          @click="closeMenuItemModal"
        />
        <div
          class="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          data-testid="item-modal"
        >
          <div class="p-6">
            <h3 class="text-[18px] font-bold text-ios-text mb-5">
              {{ editingMenuItem ? t("menu.editItem") : t("menu.addItem") }}
            </h3>

            <!-- Concurrent-edit prompt: someone changed this item while the
                 form was open, so the save was refused (#85). -->
            <div
              v-if="menuItemConflict"
              data-testid="menu-item-conflict"
              data-status="conflict"
              role="alert"
              aria-live="assertive"
              class="mb-5 rounded-2xl bg-ios-orange-soft px-4 py-3.5 shadow-ios-sm transition-all duration-300 ease-out"
            >
              <div class="flex items-start gap-2.5">
                <ExclamationTriangleIcon
                  class="mt-0.5 h-5 w-5 shrink-0 text-ios-warning"
                />
                <div class="flex-1">
                  <p class="text-[14px] font-semibold text-ios-text">
                    {{ t("menu.conflict.title") }}
                  </p>
                  <p class="mt-1 text-[13px] leading-5 text-ios-secondary">
                    {{
                      menuItemConflict.removed
                        ? t("menu.conflict.removed")
                        : t("menu.conflict.message", {
                            name: menuItemConflict.name,
                          })
                    }}
                  </p>
                  <div class="mt-3 flex flex-wrap gap-2.5">
                    <button
                      v-if="!menuItemConflict.removed"
                      type="button"
                      data-testid="menu-item-conflict-reload"
                      class="rounded-full bg-ios-primary px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(0,122,255,0.25)] transition-colors hover:bg-ios-primary/90"
                      @click="reloadConflictedMenuItem"
                    >
                      {{ t("menu.conflict.reload") }}
                    </button>
                    <button
                      type="button"
                      data-testid="menu-item-conflict-dismiss"
                      class="rounded-full bg-white/70 px-4 py-2 text-[13px] font-semibold text-ios-text transition-colors hover:bg-white"
                      @click="
                        menuItemConflict.removed
                          ? closeMenuItemModal()
                          : (menuItemConflict = null)
                      "
                    >
                      {{
                        menuItemConflict.removed
                          ? t("common.close")
                          : t("menu.conflict.keepEditing")
                      }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- What the merge did, after the owner reloaded (#85). -->
            <div
              v-if="menuItemMergeSummary"
              data-testid="menu-item-merge-summary"
              data-status="merged"
              role="status"
              aria-live="polite"
              class="mb-5 rounded-2xl bg-ios-blue-soft px-4 py-3.5 shadow-ios-sm transition-all duration-300 ease-out"
            >
              <p class="text-[14px] font-semibold text-ios-text">
                {{ t("menu.conflict.mergedTitle") }}
              </p>
              <ul
                class="mt-1.5 space-y-1 text-[13px] leading-5 text-ios-secondary"
              >
                <li
                  v-if="menuItemMergeSummary.overridden.length"
                  data-testid="menu-item-merge-overridden"
                  class="text-ios-orange-deep"
                >
                  {{
                    t("menu.conflict.mergedOverridden", {
                      fields: menuItemMergeSummary.overridden.join("、"),
                    })
                  }}
                </li>
                <li
                  v-if="menuItemMergeSummary.kept.length"
                  data-testid="menu-item-merge-kept"
                >
                  {{
                    t("menu.conflict.mergedKept", {
                      fields: menuItemMergeSummary.kept.join("、"),
                    })
                  }}
                </li>
                <li
                  v-if="menuItemMergeSummary.applied.length"
                  data-testid="menu-item-merge-applied"
                >
                  {{
                    t("menu.conflict.mergedApplied", {
                      fields: menuItemMergeSummary.applied.join("、"),
                    })
                  }}
                </li>
                <li
                  v-if="
                    !menuItemMergeSummary.kept.length &&
                    !menuItemMergeSummary.applied.length &&
                    !menuItemMergeSummary.overridden.length
                  "
                  data-testid="menu-item-merge-noop"
                >
                  {{ t("menu.conflict.mergedNoChanges") }}
                </li>
              </ul>
            </div>

            <form @submit.prevent="handleSaveMenuItem">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <!-- Item name -->
                <div class="md:col-span-2">
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.itemName") }}
                    <span class="text-ios-error ml-0.5">*</span>
                  </label>
                  <input
                    v-model="menuItemForm.name"
                    data-testid="menu-item-name-input"
                    type="text"
                    required
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  />
                </div>

                <!-- Name (English) -->
                <div>
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.nameEn") }}
                  </label>
                  <input
                    v-model="menuItemForm.nameEn"
                    type="text"
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  />
                </div>

                <!-- Original price -->
                <div>
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.originalPrice") }}
                  </label>
                  <input
                    v-model.number="menuItemForm.originalPrice"
                    type="number"
                    :step="inputStep"
                    min="0"
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  />
                </div>

                <!-- Price -->
                <div>
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.price") }}
                    <span class="text-ios-error ml-0.5">*</span>
                  </label>
                  <input
                    v-model.number="menuItemForm.price"
                    data-testid="menu-item-price-input"
                    type="number"
                    :step="inputStep"
                    min="1"
                    required
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  />
                </div>

                <!-- Category -->
                <div>
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.category") }}
                    <span class="text-ios-error ml-0.5">*</span>
                  </label>
                  <select
                    v-model="menuItemForm.categoryId"
                    data-testid="menu-item-category-select"
                    required
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  >
                    <option value="">
                      {{ t("menu.form.selectCategory") }}
                    </option>
                    <option
                      v-for="category in categories"
                      :key="category.id"
                      :value="category.id"
                    >
                      {{ category.name }}
                    </option>
                  </select>
                </div>

                <!-- Catalog type -->
                <div>
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    類型
                  </label>
                  <select
                    v-model="menuItemForm.catalogType"
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  >
                    <option value="menu_item">餐點</option>
                    <option value="product">商品</option>
                  </select>
                </div>

                <!-- Image upload -->
                <div class="md:col-span-2" data-status="image-upload">
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.image") }}
                  </label>
                  <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <img
                      v-if="currentImagePreview"
                      :src="currentImagePreview"
                      :alt="menuItemForm.name || t('menu.form.image')"
                      class="h-20 w-20 rounded-2xl object-cover shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                    />
                    <div class="flex flex-wrap items-center gap-2.5">
                      <input
                        ref="imageFileInput"
                        type="file"
                        class="sr-only"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        data-testid="menu-item-image-input"
                        @change="handleImageFileSelected"
                      />
                      <button
                        type="button"
                        class="rounded-full bg-ios-primary px-4 py-2 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(0,122,255,0.18)] transition-all duration-300 ease-out hover:bg-ios-primary/90 disabled:opacity-60"
                        :disabled="imageUploadState === 'uploading'"
                        @click="imageFileInput?.click()"
                      >
                        {{
                          currentImagePreview
                            ? t("menu.upload.changeImage")
                            : t("menu.upload.selectFile")
                        }}
                      </button>
                      <span
                        v-if="imageUploadState === 'uploading'"
                        data-status="uploading"
                        class="inline-flex items-center gap-2 rounded-full bg-ios-blue-soft px-3 py-1.5 text-[12px] font-semibold text-ios-primary"
                      >
                        <span
                          class="h-3 w-3 animate-spin rounded-full border-2 border-ios-primary/25 border-t-ios-primary"
                        />
                        {{ t("menu.upload.uploading") }}
                      </span>
                      <span
                        v-else-if="imageUploadState === 'success'"
                        data-status="success"
                        class="inline-flex items-center gap-1.5 rounded-full bg-ios-green-soft px-3 py-1.5 text-[12px] font-semibold text-ios-green-deep"
                      >
                        ✓ {{ t("menu.upload.uploaded") }}
                      </span>
                      <span
                        v-else-if="imageUploadState === 'error'"
                        data-status="error"
                        class="inline-flex items-center gap-1.5 rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-red"
                      >
                        ✗ {{ t("menu.upload.failed") }}
                      </span>
                    </div>
                  </div>
                  <p
                    v-if="imageUploadState === 'error' && imageUploadError"
                    class="mt-2 text-[12px] text-ios-red"
                  >
                    {{ imageUploadError }}
                  </p>
                </div>

                <!-- Description -->
                <div class="md:col-span-2">
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.description") }}
                  </label>
                  <textarea
                    v-model="menuItemForm.description"
                    rows="3"
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all resize-none"
                  />
                </div>

                <!-- Product details -->
                <div class="md:col-span-2 rounded-xl bg-ios-bg p-4">
                  <h4 class="mb-3 text-[14px] font-bold text-ios-text">
                    {{ t("menu.form.productDetails") }}
                  </h4>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <label class="text-[13px] font-semibold text-ios-text">
                      {{ t("menu.form.spiceLevel") }}
                      <input
                        v-model.number="menuItemForm.spiceLevel"
                        type="number"
                        min="0"
                        max="5"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                    <label class="text-[13px] font-semibold text-ios-text">
                      {{ t("menu.form.preparationTime") }}
                      <input
                        v-model.number="menuItemForm.preparationTime"
                        type="number"
                        min="1"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                    <label class="text-[13px] font-semibold text-ios-text">
                      {{ t("menu.form.calories") }}
                      <input
                        v-model.number="menuItemForm.calories"
                        type="number"
                        min="0"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                    <label
                      class="md:col-span-3 text-[13px] font-semibold text-ios-text"
                    >
                      {{ t("menu.form.ingredients") }}
                      <input
                        v-model="menuItemForm.ingredients"
                        type="text"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                    <label
                      class="md:col-span-3 text-[13px] font-semibold text-ios-text"
                    >
                      {{ t("menu.form.tags") }}
                      <input
                        v-model="menuItemForm.tagsText"
                        type="text"
                        :placeholder="t('menu.form.tagsPlaceholder')"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                    <label
                      class="md:col-span-3 text-[13px] font-semibold text-ios-text"
                    >
                      {{ t("menu.form.keywords") }}
                      <input
                        v-model="menuItemForm.keywords"
                        type="text"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                  </div>
                </div>

                <!-- Dietary information -->
                <div class="md:col-span-2 rounded-xl bg-ios-bg p-4">
                  <h4 class="mb-3 text-[14px] font-bold text-ios-text">
                    {{ t("menu.form.dietaryInfo") }}
                  </h4>
                  <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <label
                      v-for="diet in dietaryFields"
                      :key="diet.key"
                      class="flex items-center gap-2 text-[13px] text-ios-text"
                    >
                      <input
                        v-model="menuItemForm.dietaryInfo[diet.key]"
                        type="checkbox"
                        class="h-4 w-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                      />
                      {{ t(diet.label) }}
                    </label>
                  </div>
                  <label
                    class="mt-3 block text-[13px] font-semibold text-ios-text"
                  >
                    {{ t("menu.form.allergens") }}
                    <input
                      v-model="menuItemForm.allergensText"
                      type="text"
                      :placeholder="t('menu.form.allergensPlaceholder')"
                      class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                    />
                  </label>
                </div>

                <!-- Customization options -->
                <div class="md:col-span-2 rounded-xl bg-ios-bg p-4">
                  <div
                    class="mb-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <h4 class="text-[14px] font-bold text-ios-text">
                      {{ t("menu.form.options") }}
                    </h4>
                    <div
                      v-if="optionSourceItems.length && !usesSharedOptionGroups"
                      class="flex items-center gap-2"
                    >
                      <select
                        v-model="optionSourceId"
                        data-testid="option-source-select"
                        class="rounded-full bg-white px-3 py-1.5 text-[12px] text-ios-text outline-none focus:ring-2 focus:ring-ios-primary/30"
                      >
                        <option value="">
                          {{ t("menu.form.copyOptionsFrom") }}
                        </option>
                        <option
                          v-for="source in optionSourceItems"
                          :key="source.id"
                          :value="source.id"
                        >
                          {{ source.name }}
                        </option>
                      </select>
                      <button
                        type="button"
                        data-testid="copy-options"
                        :disabled="optionSourceId === ''"
                        class="rounded-full bg-ios-primary/10 px-3 py-1.5 text-[12px] font-semibold text-ios-primary disabled:opacity-40"
                        @click="applyOptionsFromSource"
                      >
                        {{ t("menu.form.copyOptionsApply") }}
                      </button>
                    </div>
                  </div>
                  <MenuItemOptionGroups
                    v-if="usesSharedOptionGroups"
                    v-model="itemOptionGroups"
                    :library="optionGroupLibrary"
                  />
                  <div v-else class="space-y-4">
                    <div v-if="editingMenuItem" class="rounded-xl bg-white p-3">
                      <p class="text-[12px] text-ios-secondary">
                        {{ t("menu.form.switchToSharedHint") }}
                      </p>
                      <button
                        type="button"
                        data-testid="switch-to-shared-groups"
                        class="mt-2 rounded-full bg-ios-primary/10 px-3 py-1.5 text-[12px] font-semibold text-ios-primary"
                        @click="switchToSharedOptionGroups"
                      >
                        {{ t("menu.form.switchToShared") }}
                      </button>
                    </div>
                    <section class="rounded-xl bg-white p-3">
                      <div class="mb-3 flex items-center justify-between gap-3">
                        <h5 class="text-[13px] font-semibold text-ios-text">
                          {{ t("menu.form.optionSizes") }}
                        </h5>
                        <button
                          type="button"
                          data-testid="add-size-option"
                          class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text hover:bg-ios-separator"
                          @click="addSizeOption"
                        >
                          {{ t("common.add") }}
                        </button>
                      </div>
                      <div
                        v-for="(size, index) in menuItemForm.sizes"
                        :key="size.id"
                        class="mb-2 grid grid-cols-1 gap-2 last:mb-0 sm:grid-cols-[1fr_120px_auto_auto] sm:items-center"
                      >
                        <input
                          v-model="size.name"
                          type="text"
                          :placeholder="t('menu.form.optionName')"
                          class="rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                        />
                        <input
                          v-model.number="size.priceAdjustment"
                          type="number"
                          :step="inputStep"
                          class="rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                        />
                        <label
                          class="flex items-center gap-1.5 text-[12px] text-ios-text"
                        >
                          <input
                            v-model="size.isDefault"
                            type="checkbox"
                            class="h-4 w-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                          />
                          {{ t("menu.form.defaultOption") }}
                        </label>
                        <div class="flex items-center gap-1.5">
                          <button
                            type="button"
                            :data-testid="`move-size-up-${index}`"
                            :aria-label="t('menu.form.moveUp')"
                            :disabled="index === 0"
                            class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                            @click="moveSizeOption(index, -1)"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            :data-testid="`move-size-down-${index}`"
                            :aria-label="t('menu.form.moveDown')"
                            :disabled="index === menuItemForm.sizes.length - 1"
                            class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                            @click="moveSizeOption(index, 1)"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
                            @click="removeSizeOption(index)"
                          >
                            {{ t("common.delete") }}
                          </button>
                        </div>
                      </div>
                    </section>

                    <section class="rounded-xl bg-white p-3">
                      <div class="mb-3 flex items-center justify-between gap-3">
                        <h5 class="text-[13px] font-semibold text-ios-text">
                          {{ t("menu.form.optionAddOns") }}
                        </h5>
                        <button
                          type="button"
                          data-testid="add-addon-option"
                          class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text hover:bg-ios-separator"
                          @click="addAddOnOption"
                        >
                          {{ t("common.add") }}
                        </button>
                      </div>
                      <div
                        v-for="(addOn, index) in menuItemForm.addOns"
                        :key="addOn.id"
                        class="mb-2 grid grid-cols-1 gap-2 last:mb-0 sm:grid-cols-[1fr_120px_120px_auto_auto] sm:items-center"
                      >
                        <input
                          v-model="addOn.name"
                          type="text"
                          :placeholder="t('menu.form.optionName')"
                          class="rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                        />
                        <input
                          v-model.number="addOn.price"
                          type="number"
                          :step="inputStep"
                          min="0"
                          class="rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                        />
                        <input
                          v-model.number="addOn.maxQuantity"
                          :data-testid="`addon-max-quantity-${index}`"
                          :placeholder="t('menu.form.optionMaxQuantity')"
                          :title="t('menu.form.optionMaxQuantity')"
                          type="number"
                          min="1"
                          step="1"
                          class="rounded-xl bg-ios-bg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                        />
                        <label
                          class="flex items-center gap-1.5 text-[12px] text-ios-text"
                        >
                          <input
                            v-model="addOn.available"
                            type="checkbox"
                            class="h-4 w-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                          />
                          {{ t("menu.form.isAvailable") }}
                        </label>
                        <div class="flex items-center gap-1.5">
                          <button
                            type="button"
                            :data-testid="`move-addon-up-${index}`"
                            :aria-label="t('menu.form.moveUp')"
                            :disabled="index === 0"
                            class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                            @click="moveAddOnOption(index, -1)"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            :data-testid="`move-addon-down-${index}`"
                            :aria-label="t('menu.form.moveDown')"
                            :disabled="index === menuItemForm.addOns.length - 1"
                            class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                            @click="moveAddOnOption(index, 1)"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
                            @click="removeAddOnOption(index)"
                          >
                            {{ t("common.delete") }}
                          </button>
                        </div>
                      </div>
                    </section>

                    <section class="rounded-xl bg-white p-3">
                      <div class="mb-3 flex items-center justify-between gap-3">
                        <h5 class="text-[13px] font-semibold text-ios-text">
                          {{ t("menu.form.optionGroups") }}
                        </h5>
                        <button
                          type="button"
                          data-testid="add-customization-group"
                          class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text hover:bg-ios-separator"
                          @click="addCustomizationGroup"
                        >
                          {{ t("common.add") }}
                        </button>
                      </div>
                      <div
                        v-for="(
                          group, groupIndex
                        ) in menuItemForm.customizations"
                        :key="group.id"
                        class="mb-3 rounded-xl bg-ios-bg p-3 last:mb-0"
                      >
                        <div
                          class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_120px_auto_auto] sm:items-center"
                        >
                          <input
                            v-model="group.name"
                            type="text"
                            :placeholder="t('menu.form.optionGroupName')"
                            class="rounded-xl bg-white px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                          />
                          <select
                            v-model="group.type"
                            class="rounded-xl bg-white px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                          >
                            <option value="single">
                              {{ t("menu.form.singleChoice") }}
                            </option>
                            <option value="multiple">
                              {{ t("menu.form.multipleChoice") }}
                            </option>
                          </select>
                          <input
                            v-if="group.type === 'multiple'"
                            v-model.number="group.maxSelections"
                            :data-testid="`group-max-selections-${groupIndex}`"
                            :placeholder="t('menu.form.optionMaxSelections')"
                            :title="t('menu.form.optionMaxSelections')"
                            type="number"
                            min="1"
                            step="1"
                            class="rounded-xl bg-white px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                          />
                          <span v-else />

                          <label
                            class="flex items-center gap-1.5 text-[12px] text-ios-text"
                          >
                            <input
                              v-model="group.required"
                              type="checkbox"
                              class="h-4 w-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                            />
                            {{ t("menu.form.requiredOption") }}
                          </label>
                          <div class="flex items-center gap-1.5">
                            <button
                              type="button"
                              :data-testid="`move-group-up-${groupIndex}`"
                              :aria-label="t('menu.form.moveUp')"
                              :disabled="groupIndex === 0"
                              class="rounded-full bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                              @click="moveCustomizationGroup(groupIndex, -1)"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              :data-testid="`move-group-down-${groupIndex}`"
                              :aria-label="t('menu.form.moveDown')"
                              :disabled="
                                groupIndex ===
                                menuItemForm.customizations.length - 1
                              "
                              class="rounded-full bg-white px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                              @click="moveCustomizationGroup(groupIndex, 1)"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
                              @click="removeCustomizationGroup(groupIndex)"
                            >
                              {{ t("common.delete") }}
                            </button>
                          </div>
                        </div>
                        <div class="mt-2 space-y-2">
                          <div
                            v-for="(choice, choiceIndex) in group.choices"
                            :key="choice.id"
                            class="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto_auto] sm:items-center"
                          >
                            <input
                              v-model="choice.name"
                              type="text"
                              :placeholder="t('menu.form.optionChoiceName')"
                              class="rounded-xl bg-white px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                            />
                            <input
                              v-model.number="choice.priceAdjustment"
                              type="number"
                              :step="inputStep"
                              class="rounded-xl bg-white px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-ios-primary/30"
                            />
                            <label
                              class="flex items-center gap-1.5 text-[12px] text-ios-text"
                            >
                              <input
                                v-model="choice.isDefault"
                                type="checkbox"
                                class="h-4 w-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                              />
                              {{ t("menu.form.defaultOption") }}
                            </label>
                            <div class="flex items-center gap-1.5">
                              <button
                                type="button"
                                :data-testid="`move-choice-up-${groupIndex}-${choiceIndex}`"
                                :aria-label="t('menu.form.moveUp')"
                                :disabled="choiceIndex === 0"
                                class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                                @click="
                                  moveCustomizationChoice(
                                    groupIndex,
                                    choiceIndex,
                                    -1,
                                  )
                                "
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                :data-testid="`move-choice-down-${groupIndex}-${choiceIndex}`"
                                :aria-label="t('menu.form.moveDown')"
                                :disabled="
                                  choiceIndex === group.choices.length - 1
                                "
                                class="rounded-full bg-ios-bg px-2.5 py-1.5 text-[12px] font-semibold text-ios-text disabled:opacity-30"
                                @click="
                                  moveCustomizationChoice(
                                    groupIndex,
                                    choiceIndex,
                                    1,
                                  )
                                "
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                class="rounded-full bg-ios-red-soft px-3 py-1.5 text-[12px] font-semibold text-ios-error"
                                @click="
                                  removeCustomizationChoice(
                                    groupIndex,
                                    choiceIndex,
                                  )
                                "
                              >
                                {{ t("common.delete") }}
                              </button>
                            </div>
                          </div>
                          <button
                            type="button"
                            class="rounded-full bg-ios-bg px-3 py-1.5 text-[12px] font-semibold text-ios-text hover:bg-ios-separator"
                            @click="addCustomizationChoice(groupIndex)"
                          >
                            {{ t("menu.form.addChoice") }}
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                  <p
                    v-if="optionsError"
                    class="mt-1.5 text-[12px] text-ios-error"
                  >
                    {{ optionsError }}
                  </p>
                </div>

                <!-- Sort order -->
                <div>
                  <label
                    class="block text-[13px] font-semibold text-ios-text mb-1.5"
                  >
                    {{ t("menu.form.sortOrder") }}
                  </label>
                  <input
                    v-model.number="menuItemForm.sortOrder"
                    type="number"
                    min="0"
                    class="w-full px-4 py-2.5 bg-ios-bg rounded-xl text-[14px] text-ios-text border-0 outline-none focus:ring-2 focus:ring-ios-primary/30 transition-all"
                  />
                </div>

                <!-- Inventory -->
                <div class="md:col-span-2 rounded-xl bg-ios-bg p-4">
                  <h4 class="mb-3 text-[14px] font-bold text-ios-text">
                    {{ t("menu.form.inventory") }}
                  </h4>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label class="text-[13px] font-semibold text-ios-text">
                      {{ t("menu.form.inventoryCount") }}
                      <input
                        v-model.number="menuItemForm.inventoryCount"
                        data-testid="inventory-count-input"
                        type="number"
                        min="0"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                    <label class="text-[13px] font-semibold text-ios-text">
                      {{ t("menu.form.minInventoryAlert") }}
                      <input
                        v-model.number="menuItemForm.minInventoryAlert"
                        data-testid="min-inventory-alert-input"
                        type="number"
                        min="0"
                        class="mt-1.5 w-full px-4 py-2.5 bg-white rounded-xl text-[14px] font-normal border-0 outline-none focus:ring-2 focus:ring-ios-primary/30"
                      />
                    </label>
                  </div>
                </div>

                <!-- Checkboxes -->
                <div class="flex items-center gap-5">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      v-model="menuItemForm.isFeatured"
                      type="checkbox"
                      class="w-4 h-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                    />
                    <span class="text-[13px] text-ios-text">{{
                      t("menu.form.featuredItem")
                    }}</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      v-model="menuItemForm.isAvailable"
                      type="checkbox"
                      class="w-4 h-4 rounded border-ios-tertiary text-ios-primary focus:ring-ios-primary/30"
                    />
                    <span class="text-[13px] text-ios-text">{{
                      t("menu.form.isAvailable")
                    }}</span>
                  </label>
                </div>
              </div>

              <!-- Modal actions -->
              <div
                class="flex justify-end gap-2.5 mt-6 pt-5 border-t border-black/[0.06]"
              >
                <button
                  type="button"
                  class="px-5 py-2.5 text-[14px] font-semibold text-ios-text bg-ios-bg rounded-full hover:bg-ios-separator transition-colors"
                  @click="closeMenuItemModal"
                >
                  {{ t("common.cancel") }}
                </button>
                <button
                  type="submit"
                  data-testid="menu-item-submit"
                  class="px-5 py-2.5 text-[14px] font-semibold text-white bg-ios-primary rounded-full hover:bg-ios-primary/90 transition-colors shadow-[0_2px_8px_rgba(0,122,255,0.25)]"
                >
                  {{
                    editingMenuItem ? t("menu.form.update") : t("menu.form.add")
                  }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "@/i18n";
import { useCurrency } from "@/composables/useCurrency";
import { useMenuManagement } from "@/composables/useMenuManagement";
import { getAuthToken } from "@/utils/authTokenProvider";
import {
  useImageUpload,
  type ImageVariants,
} from "@/composables/useImageUpload";
import type {
  CategoryData,
  MenuItemData,
} from "@/composables/useMenuManagement";
import CategoryPanel from "@/components/menu/CategoryPanel.vue";
import CategoryEditForm from "@/components/menu/CategoryEditForm.vue";
import MenuItemCard from "@/components/menu/MenuItemCard.vue";
import MenuItemOptionGroups from "@/components/menu/MenuItemOptionGroups.vue";
import ImageAssistedMenuImport from "@/components/menu/ImageAssistedMenuImport.vue";
import {
  useOptionGroups,
  type MenuItemOptionGroupLink,
} from "@/composables/useOptionGroups";
import VirtualMenuGrid from "@/components/VirtualMenuGrid.vue";
import type { VirtualMenuGridInstance } from "@/components/VirtualMenuGrid.vue";
import {
  PlusIcon,
  MagnifyingGlassIcon,
  CakeIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import {
  buildMenuItemImportTemplate,
  parseMenuItemImport,
} from "@/utils/menuItemImport";
import {
  validateImageAssistedMenuItems,
  validateImageAssistedMenuCategories,
  type ImageAssistedMenuItemErrors,
  type ImageMenuCategoryErrors,
  type ImageMenuCategoryDraft,
} from "@/utils/imageAssistedMenuImport";

type NumericFormValue = number | "" | null | undefined;
type SizeOptionForm = {
  id: string;
  name: string;
  priceAdjustment: NumericFormValue;
  isDefault: boolean;
};
type AddOnOptionForm = {
  id: string;
  name: string;
  price: NumericFormValue;
  maxQuantity: NumericFormValue;
  available: boolean;
};
type CustomizationChoiceForm = {
  id: string;
  name: string;
  priceAdjustment: NumericFormValue;
  isDefault: boolean;
};
type CustomizationGroupForm = {
  id: string;
  name: string;
  type: "single" | "multiple";
  required: boolean;
  maxSelections: NumericFormValue;
  choices: CustomizationChoiceForm[];
};

const { t } = useI18n();
const { inputStep, currencyCode } = useCurrency();
const route = useRoute();
const router = useRouter();
const {
  categories,
  menuItems,
  isLoading,
  selectedCategoryId,
  filteredItemsByCategory,
  getCategoryName,
  fetchMenu,
  saveCategory,
  deleteCategory,
  reorderCategories,
  saveMenuItem,
  importMenuItems,
  createImageAssistedCategories,
  deleteMenuItem,
  toggleMenuItemStatus,
  restaurantId,
} = useMenuManagement();

// ── Local UI State ──
const searchQuery = ref("");
const statusFilter = ref<"all" | "available" | "unavailable">("all");
const showCategoryEditForm = ref(false);
const editingCategory = ref<CategoryData | null>(null);
const showMenuItemModal = ref(false);
const editingMenuItem = ref<MenuItemData | null>(null);
const previousImageId = ref<string | null>(null);
const menuGridRef = ref<VirtualMenuGridInstance | null>(null);
const highlightedItemId = ref<number | null>(null);
const menuItemImportText = ref("");
const menuItemImportError = ref("");
const menuItemImportResult = ref<number | null>(null);
const isImportingMenuItems = ref(false);
const imageMenuSourceImages = ref<string[]>([]);
const imageMenuUploadError = ref("");
const imageMenuPublishError = ref("");
const imageMenuErrors = ref<ImageAssistedMenuItemErrors>({});
const imageMenuCategoryErrors = ref<ImageMenuCategoryErrors>({});
const imageMenuCreatedCategoryIds = new Map<string, number>();
const isPublishingImageMenu = ref(false);
const hasCompletedMarketProductGap = ref(false);
const imageFileInput = ref<HTMLInputElement | null>(null);
const {
  upload: uploadImage,
  reset: resetImageUpload,
  state: imageUploadState,
  errorMessage: imageUploadError,
} = useImageUpload();

const menuItemForm = ref({
  name: "",
  nameEn: "",
  description: "",
  price: 0,
  originalPrice: undefined as number | undefined,
  ingredients: "",
  spiceLevel: 0,
  preparationTime: 15,
  calories: undefined as number | undefined,
  tagsText: "",
  keywords: "",
  allergensText: "",
  dietaryInfo: {
    vegetarian: false,
    vegan: false,
    halal: false,
    glutenFree: false,
    dairyFree: false,
    nutFree: false,
    seafoodFree: false,
    organic: false,
    localSource: false,
  },
  sizes: [] as SizeOptionForm[],
  addOns: [] as AddOnOptionForm[],
  customizations: [] as CustomizationGroupForm[],
  categoryId: "" as string | number,
  catalogType: "menu_item" as "menu_item" | "product",
  imageUrl: "",
  imageId: "",
  imageVariants: null as ImageVariants | null,
  isFeatured: false,
  isAvailable: true,
  sortOrder: 0,
  inventoryCount: null as NumericFormValue,
  minInventoryAlert: 5 as NumericFormValue,
  // The version this form was populated from; sent back on save so a
  // concurrent edit is refused instead of silently overwritten (#85).
  updatedAt: undefined as number | undefined,
});

type MenuItemFormState = typeof menuItemForm.value;

// Set when the API refuses a save because someone else changed the item first.
// `removed` is the terminal case: the other editor deleted it, so there is
// nothing to merge into and the only move left is to close.
const menuItemConflict = ref<{
  id: number;
  name: string;
  removed?: boolean;
} | null>(null);

/**
 * The values the open form was populated from.
 *
 * Without it a conflict can only be resolved by throwing the owner's work away,
 * because "what did *I* change?" is unanswerable from the current form alone —
 * every field looks different from the newly fetched row, whether the owner
 * touched it or the other editor did.
 */
const menuItemBaseline = ref<MenuItemFormState | null>(null);

// Outcome of the last merge, so the owner can see what was kept and what moved.
const menuItemMergeSummary = ref<{
  kept: string[];
  applied: string[];
  overridden: string[];
} | null>(null);

/**
 * Fields the merge reasons about, grouped by what has to move together.
 *
 * Anything not listed (catalogType, updatedAt) always takes the freshly fetched
 * value: the form does not edit it, so the owner can have no pending change to
 * preserve.
 */
const MENU_ITEM_MERGE_FIELDS = [
  { keys: ["name"], label: "menu.form.itemName" },
  { keys: ["nameEn"], label: "menu.form.nameEn" },
  { keys: ["description"], label: "menu.form.description" },
  { keys: ["price"], label: "menu.form.price" },
  { keys: ["originalPrice"], label: "menu.form.originalPrice" },
  { keys: ["ingredients"], label: "menu.form.ingredients" },
  { keys: ["spiceLevel"], label: "menu.form.spiceLevel" },
  { keys: ["preparationTime"], label: "menu.form.preparationTime" },
  { keys: ["calories"], label: "menu.form.calories" },
  { keys: ["tagsText"], label: "menu.form.tags" },
  { keys: ["keywords"], label: "menu.form.keywords" },
  { keys: ["allergensText"], label: "menu.form.allergens" },
  { keys: ["dietaryInfo"], label: "menu.form.dietaryInfo" },
  {
    keys: ["sizes", "addOns", "customizations"],
    label: "menu.form.options",
  },
  { keys: ["categoryId"], label: "menu.form.category" },
  // The three image fields are one decision. Keeping a locally chosen imageUrl
  // while adopting someone else's imageId would pair a URL with the wrong
  // stored asset, which is worse than either version on its own.
  { keys: ["imageUrl", "imageId", "imageVariants"], label: "menu.form.image" },
  { keys: ["isFeatured"], label: "menu.form.featuredItem" },
  { keys: ["isAvailable"], label: "menu.form.isAvailable" },
  { keys: ["sortOrder"], label: "menu.form.sortOrder" },
  {
    keys: ["inventoryCount", "minInventoryAlert"],
    label: "menu.form.inventory",
  },
] as const satisfies ReadonlyArray<{
  keys: ReadonlyArray<keyof MenuItemFormState>;
  label: string;
}>;

/** Structural equality — imageVariants is an object, so `===` would always differ. */
const isSameFieldValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value
        .filter((item) => item && typeof item === "object")
        .map((item) => item as Record<string, unknown>)
    : [];

const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === "boolean" ? value : fallback;

/** Absent caps stay blank in the form and are omitted from the payload again. */
const asOptionalCount = (value: unknown): NumericFormValue =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : "";

const optionId = (prefix: string, index: number, current?: unknown): string =>
  typeof current === "string" && current.trim()
    ? current
    : `${prefix}-${index + 1}`;

const normalizeOptionsForForm = (
  options: unknown,
): {
  sizes: SizeOptionForm[];
  addOns: AddOnOptionForm[];
  customizations: CustomizationGroupForm[];
} => {
  const record = asRecord(options);
  return {
    sizes: asArray(record.sizes).map((size, index) => ({
      id: optionId("size", index, size.id),
      name: typeof size.name === "string" ? size.name : "",
      priceAdjustment: asNumber(size.priceAdjustment),
      isDefault: asBoolean(size.isDefault),
    })),
    addOns: asArray(record.addOns).map((addOn, index) => ({
      id: optionId("addon", index, addOn.id),
      name: typeof addOn.name === "string" ? addOn.name : "",
      price: asNumber(addOn.price),
      maxQuantity: asOptionalCount(addOn.maxQuantity),
      available: asBoolean(addOn.available, true),
    })),
    customizations: asArray(record.customizations).map((group, groupIndex) => ({
      id: optionId("group", groupIndex, group.id),
      name: typeof group.name === "string" ? group.name : "",
      type: group.type === "multiple" ? "multiple" : "single",
      required: asBoolean(group.required),
      maxSelections: asOptionalCount(group.maxSelections),
      choices: asArray(group.choices).map((choice, choiceIndex) => ({
        id: optionId("choice", choiceIndex, choice.id),
        name: typeof choice.name === "string" ? choice.name : "",
        priceAdjustment: asNumber(choice.priceAdjustment),
        isDefault: asBoolean(choice.isDefault),
      })),
    })),
  };
};

const buildMenuItemForm = (item: MenuItemData): MenuItemFormState => ({
  name: item.name,
  nameEn: item.nameEn ?? "",
  description: item.description ?? "",
  price: item.price,
  // A cleared field comes back as null, but the form uses undefined for "empty"
  // — one representation, so the baseline/merge diff cannot report a spurious
  // change and the number inputs stay blank rather than rendering a null.
  originalPrice: item.originalPrice ?? undefined,
  ingredients: item.ingredients ?? "",
  spiceLevel: item.spiceLevel ?? 0,
  preparationTime: item.preparationTime ?? 15,
  calories: item.calories ?? undefined,
  tagsText: item.tags?.join(", ") ?? "",
  keywords: item.keywords ?? "",
  allergensText: item.allergens?.join(", ") ?? "",
  dietaryInfo: {
    vegetarian: !!item.dietaryInfo?.vegetarian,
    vegan: !!item.dietaryInfo?.vegan,
    halal: !!item.dietaryInfo?.halal,
    glutenFree: !!item.dietaryInfo?.glutenFree,
    dairyFree: !!item.dietaryInfo?.dairyFree,
    nutFree: !!item.dietaryInfo?.nutFree,
    seafoodFree: !!item.dietaryInfo?.seafoodFree,
    organic: !!item.dietaryInfo?.organic,
    localSource: !!item.dietaryInfo?.localSource,
  },
  ...normalizeOptionsForForm(item.options),
  categoryId: item.categoryId,
  catalogType: item.catalogType ?? "menu_item",
  imageUrl: item.imageUrl ?? "",
  imageId: item.imageId ?? "",
  imageVariants: item.imageVariants ?? null,
  isFeatured: item.isFeatured,
  isAvailable: item.isAvailable,
  sortOrder: item.sortOrder,
  inventoryCount: item.inventoryCount ?? null,
  minInventoryAlert: item.minInventoryAlert ?? "",
  updatedAt: item.updatedAt,
});
const optionsError = ref("");
const dietaryFields = [
  { key: "vegetarian", label: "menu.form.vegetarian" },
  { key: "vegan", label: "menu.form.vegan" },
  { key: "halal", label: "menu.form.halal" },
  { key: "glutenFree", label: "menu.form.glutenFree" },
  { key: "dairyFree", label: "menu.form.dairyFree" },
  { key: "nutFree", label: "menu.form.nutFree" },
  { key: "seafoodFree", label: "menu.form.seafoodFree" },
  { key: "organic", label: "menu.form.organic" },
  { key: "localSource", label: "menu.form.localSource" },
] as const;

// ── Status filter options ──
const statusFilters = computed(() => [
  { value: "all" as const, label: t("menu.itemsHeader.filterAll") },
  { value: "available" as const, label: t("menu.itemsHeader.filterAvailable") },
  {
    value: "unavailable" as const,
    label: t("menu.itemsHeader.filterUnavailable"),
  },
]);

// ── Computed ──
const currentCategoryName = computed(() => {
  if (selectedCategoryId.value === null)
    return t("menu.categoryPanel.allItems");
  return getCategoryName(selectedCategoryId.value);
});

const filteredItems = computed(() => {
  let items = filteredItemsByCategory.value;

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.nameEn?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query),
    );
  }

  if (statusFilter.value === "available") {
    items = items.filter(
      (item) =>
        item.isAvailable &&
        (item.inventoryCount == null || item.inventoryCount > 0),
    );
  } else if (statusFilter.value === "unavailable") {
    items = items.filter(
      (item) =>
        !item.isAvailable ||
        (item.inventoryCount != null && item.inventoryCount <= 0),
    );
  }

  return [...items].sort((a, b) => a.sortOrder - b.sortOrder);
});

const availableCount = computed(
  () =>
    menuItems.value.filter(
      (i) =>
        i.isAvailable && (i.inventoryCount == null || i.inventoryCount > 0),
    ).length,
);
const isMarketProductGapContext = computed(
  () => route.query.source === "market-gap" && route.query.gap === "products",
);
const marketGapName = computed(() => firstQueryString(route.query.marketName));
const marketGapSlug = computed(() => firstQueryString(route.query.marketSlug));
const marketGapAreaCity = computed(() =>
  firstQueryString(route.query.areaCity),
);
const marketGapAreaDistrict = computed(() =>
  firstQueryString(route.query.areaDistrict),
);
const showMarketProductGapNextStep = computed(
  () => isMarketProductGapContext.value && hasCompletedMarketProductGap.value,
);
const currentImagePreview = computed(
  () =>
    menuItemForm.value.imageVariants?.thumbnail ||
    menuItemForm.value.imageUrl ||
    "",
);
const menuItemImportPreview = computed(() => {
  if (!menuItemImportText.value.trim()) {
    return { items: [], errors: [] };
  }

  return parseMenuItemImport(
    menuItemImportText.value,
    categories.value,
    currencyCode.value,
  );
});

// ── Category Panel Handlers ──
const startAddCategory = () => {
  editingCategory.value = null;
  showCategoryEditForm.value = true;
};

const startEditCategory = (category: CategoryData) => {
  editingCategory.value = category;
  showCategoryEditForm.value = true;
};

const handleSaveCategory = async (
  form: {
    name: string;
    nameEn: string;
    description: string;
    sortOrder: number;
    isVisible: boolean;
  },
  editingId?: number,
) => {
  if (await saveCategory(form, editingId)) {
    showCategoryEditForm.value = false;
    editingCategory.value = null;
  }
};

const cancelCategoryEdit = () => {
  showCategoryEditForm.value = false;
  editingCategory.value = null;
};

// ── Delete Confirm Modal ──
const deleteConfirm = ref<{
  title: string;
  message: string;
  action: (() => Promise<void>) | null;
} | null>(null);

const showDeleteConfirm = computed(() => deleteConfirm.value !== null);
const deleteConfirmTitle = computed(() => deleteConfirm.value?.title ?? "");
const deleteConfirmMessage = computed(() => deleteConfirm.value?.message ?? "");

const openDeleteConfirm = (
  title: string,
  message: string,
  action: () => Promise<void>,
) => {
  deleteConfirm.value = { title, message, action };
};

const confirmDelete = async () => {
  if (deleteConfirm.value?.action) {
    await deleteConfirm.value.action();
  }
  cancelDelete();
};

const cancelDelete = () => {
  deleteConfirm.value = null;
};

const handleDeleteCategory = (category: CategoryData) => {
  openDeleteConfirm(
    t("common.delete"),
    t("menu.confirms.deleteCategory", { name: category.name }),
    () => deleteCategory(category.id),
  );
};

// ── Menu Item Handlers ──
/**
 * Shared option groups for this item.
 *
 * Which editor an item gets is decided by the same rule the assembler uses:
 * an item with link rows is on shared groups, an item with none is still on
 * its JSON options. There is no flag to keep in sync, and no way for the two
 * to disagree.
 */
const {
  groups: optionGroupLibrary,
  fetchGroups: fetchOptionGroupLibrary,
  fetchItemGroups,
  saveItemGroups,
} = useOptionGroups();
const itemOptionGroups = ref<MenuItemOptionGroupLink[]>([]);
const usesSharedOptionGroups = ref(false);

const switchToSharedOptionGroups = () => {
  usesSharedOptionGroups.value = true;
};

const openAddItemModal = () => {
  editingMenuItem.value = null;
  menuItemConflict.value = null;
  menuItemForm.value = {
    name: "",
    nameEn: "",
    description: "",
    price: 0,
    originalPrice: undefined,
    ingredients: "",
    spiceLevel: 0,
    preparationTime: 15,
    calories: undefined,
    tagsText: "",
    keywords: "",
    allergensText: "",
    dietaryInfo: {
      vegetarian: false,
      vegan: false,
      halal: false,
      glutenFree: false,
      dairyFree: false,
      nutFree: false,
      seafoodFree: false,
      organic: false,
      localSource: false,
    },
    sizes: [],
    addOns: [],
    customizations: [],
    categoryId: selectedCategoryId.value ?? "",
    catalogType: "menu_item",
    imageUrl: "",
    imageId: "",
    imageVariants: null,
    isFeatured: false,
    isAvailable: true,
    sortOrder: 0,
    inventoryCount: null,
    minInventoryAlert: 5,
    updatedAt: undefined,
  };
  previousImageId.value = null;
  optionSourceId.value = "";
  itemOptionGroups.value = [];
  usesSharedOptionGroups.value = false;
  resetImageUpload();
  showMenuItemModal.value = true;
};

const loadItemOptionGroups = async (menuItemId: number) => {
  const [links] = await Promise.all([
    fetchItemGroups(menuItemId),
    fetchOptionGroupLibrary(),
  ]);
  itemOptionGroups.value = links;
  // An empty list means this item never moved off its JSON options, so it
  // keeps the inline editor until the owner chooses to switch.
  usesSharedOptionGroups.value = links.length > 0;
};

const editMenuItem = (item: MenuItemData) => {
  editingMenuItem.value = item;
  menuItemConflict.value = null;
  menuItemMergeSummary.value = null;
  previousImageId.value = item.imageId ?? null;
  optionSourceId.value = "";
  itemOptionGroups.value = [];
  usesSharedOptionGroups.value = false;
  void loadItemOptionGroups(item.id);
  menuItemForm.value = buildMenuItemForm(item);
  // Snapshot, not a reference to the same object — the form is edited in place.
  menuItemBaseline.value = { ...menuItemForm.value };
  resetImageUpload();
  showMenuItemModal.value = true;
};

const closeMenuItemModal = () => {
  showMenuItemModal.value = false;
  editingMenuItem.value = null;
  menuItemConflict.value = null;
  menuItemMergeSummary.value = null;
  menuItemBaseline.value = null;
  previousImageId.value = null;
  resetImageUpload();
};

/**
 * Reload the item the save was refused on, merging field by field.
 *
 * Blanket "keep mine" is the overwrite the 409 exists to prevent, but blanket
 * "take theirs" throws away work the owner may have spent minutes on. Comparing
 * both sides against the baseline the form was opened with separates the two:
 * a field the owner never touched can safely adopt the other editor's value,
 * and only a field both of them changed is a genuine collision. Those keep the
 * owner's value — they are looking at it — and are named explicitly so the
 * choice is theirs to undo before saving again.
 */
const reloadConflictedMenuItem = async () => {
  const conflicted = menuItemConflict.value;
  menuItemConflict.value = null;
  if (!conflicted) return;

  await fetchMenu();
  const fresh = menuItems.value.find((item) => item.id === conflicted.id);
  if (!fresh) {
    // Deleted while the form was open. Say so in place rather than closing the
    // modal from under the owner, which reads as the save having worked.
    menuItemConflict.value = { ...conflicted, removed: true };
    return;
  }

  const baseline = menuItemBaseline.value;
  const freshForm = buildMenuItemForm(fresh);

  // No baseline means nothing to reason about — take the fresh row wholesale.
  if (!baseline) {
    editMenuItem(fresh);
    return;
  }

  const mine = menuItemForm.value;
  const merged: MenuItemFormState = { ...freshForm };
  const kept: string[] = [];
  const applied: string[] = [];
  const overridden: string[] = [];

  for (const group of MENU_ITEM_MERGE_FIELDS) {
    const iChanged = group.keys.some(
      (key) => !isSameFieldValue(mine[key], baseline[key]),
    );
    const theyChanged = group.keys.some(
      (key) => !isSameFieldValue(freshForm[key], baseline[key]),
    );

    if (iChanged) {
      for (const key of group.keys) {
        // Same object shape on both sides, so the widening cast is safe.
        (merged as Record<string, unknown>)[key] = mine[key];
      }
      (theyChanged ? overridden : kept).push(t(group.label));
    } else if (theyChanged) {
      applied.push(t(group.label));
    }
  }

  editingMenuItem.value = fresh;
  previousImageId.value = fresh.imageId ?? null;
  // The whole point of the reload: save again against the version we just read.
  menuItemForm.value = { ...merged, updatedAt: freshForm.updatedAt };
  menuItemBaseline.value = { ...freshForm };
  menuItemMergeSummary.value = { kept, applied, overridden };
  resetImageUpload();
};

const handleImageFileSelected = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const uploaded = await uploadImage(file, {
    restaurantId: restaurantId.value,
  });
  if (uploaded) {
    menuItemForm.value.imageUrl = uploaded.imageUrl;
    menuItemForm.value.imageId = uploaded.imageId;
    menuItemForm.value.imageVariants = uploaded.imageVariants;
  }
  input.value = "";
};

const addSizeOption = () => {
  menuItemForm.value.sizes.push({
    id: optionId("size", menuItemForm.value.sizes.length),
    name: "",
    priceAdjustment: 0,
    isDefault: menuItemForm.value.sizes.length === 0,
  });
};

const removeSizeOption = (index: number) => {
  menuItemForm.value.sizes.splice(index, 1);
};

const addAddOnOption = () => {
  menuItemForm.value.addOns.push({
    id: optionId("addon", menuItemForm.value.addOns.length),
    name: "",
    price: 0,
    maxQuantity: "",
    available: true,
  });
};

const removeAddOnOption = (index: number) => {
  menuItemForm.value.addOns.splice(index, 1);
};

const addCustomizationChoice = (groupIndex: number) => {
  const group = menuItemForm.value.customizations[groupIndex];
  if (!group) return;
  group.choices.push({
    id: optionId("choice", group.choices.length),
    name: "",
    priceAdjustment: 0,
    isDefault: group.choices.length === 0,
  });
};

const removeCustomizationChoice = (groupIndex: number, choiceIndex: number) => {
  const group = menuItemForm.value.customizations[groupIndex];
  if (!group) return;
  group.choices.splice(choiceIndex, 1);
};

const addCustomizationGroup = () => {
  menuItemForm.value.customizations.push({
    id: optionId("group", menuItemForm.value.customizations.length),
    name: "",
    type: "single",
    required: false,
    maxSelections: "",
    choices: [
      {
        id: "choice-1",
        name: "",
        priceAdjustment: 0,
        isDefault: true,
      },
    ],
  });
};

const removeCustomizationGroup = (index: number) => {
  menuItemForm.value.customizations.splice(index, 1);
};

// Array order is the order the customer sees — `options` is stored as JSON and
// read back whole, so moving a row is the whole feature.
const moveInList = <T,>(list: T[], index: number, delta: number) => {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const [row] = list.splice(index, 1);
  list.splice(target, 0, row);
};

const moveSizeOption = (index: number, delta: number) =>
  moveInList(menuItemForm.value.sizes, index, delta);

const moveAddOnOption = (index: number, delta: number) =>
  moveInList(menuItemForm.value.addOns, index, delta);

const moveCustomizationGroup = (index: number, delta: number) =>
  moveInList(menuItemForm.value.customizations, index, delta);

const moveCustomizationChoice = (
  groupIndex: number,
  choiceIndex: number,
  delta: number,
) => {
  const group = menuItemForm.value.customizations[groupIndex];
  if (!group) return;
  moveInList(group.choices, choiceIndex, delta);
};

// Copying options from a sibling item. Every drink needs the same 甜度/冰塊, and
// building each one by hand is where owners give up. This copies the rows into
// the form so they stay editable per item — the two items do not become linked.
const optionSourceId = ref<number | "">("");

const itemHasOptions = (item: MenuItemData): boolean => {
  const { sizes, addOns, customizations } = normalizeOptionsForForm(
    item.options,
  );
  return sizes.length > 0 || addOns.length > 0 || customizations.length > 0;
};

const optionSourceItems = computed(() =>
  menuItems.value.filter(
    (item) => item.id !== editingMenuItem.value?.id && itemHasOptions(item),
  ),
);

const applyOptionsFromSource = () => {
  const source = menuItems.value.find(
    (item) => item.id === optionSourceId.value,
  );
  if (!source) return;
  optionsError.value = "";
  const copied = normalizeOptionsForForm(source.options);
  menuItemForm.value.sizes = copied.sizes;
  menuItemForm.value.addOns = copied.addOns;
  menuItemForm.value.customizations = copied.customizations;
};

const numericOrZero = (value: NumericFormValue): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const positiveCount = (value: NumericFormValue): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;

const nullableInteger = (value: NumericFormValue): number | null => {
  if (value === "" || value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const hasIncompleteOptionRows = (): boolean =>
  menuItemForm.value.sizes.some((size) => !size.name.trim()) ||
  menuItemForm.value.addOns.some((addOn) => !addOn.name.trim()) ||
  menuItemForm.value.customizations.some(
    (group) =>
      !group.name.trim() || !group.choices.some((choice) => choice.name.trim()),
  );

const buildStructuredOptions = (): Record<string, unknown> | null => {
  const sizes = menuItemForm.value.sizes
    .filter((size) => size.name.trim())
    .map((size, index) => ({
      id: size.id || optionId("size", index),
      name: size.name.trim(),
      priceAdjustment: numericOrZero(size.priceAdjustment),
      isDefault: size.isDefault,
    }));

  const addOns = menuItemForm.value.addOns
    .filter((addOn) => addOn.name.trim())
    .map((addOn, index) => ({
      id: addOn.id || optionId("addon", index),
      name: addOn.name.trim(),
      price: numericOrZero(addOn.price),
      // Strict schema: a positive integer or the key must be absent entirely.
      ...(positiveCount(addOn.maxQuantity) !== undefined
        ? { maxQuantity: positiveCount(addOn.maxQuantity) }
        : {}),
      available: addOn.available,
    }));

  const customizations = menuItemForm.value.customizations
    .map((group, groupIndex) => {
      const choices = group.choices
        .filter((choice) => choice.name.trim())
        .map((choice, choiceIndex) => ({
          id: choice.id || optionId("choice", choiceIndex),
          name: choice.name.trim(),
          priceAdjustment: numericOrZero(choice.priceAdjustment),
          isDefault: choice.isDefault,
        }));
      // A cap on a single-choice group would contradict itself, and the field
      // is hidden for that type, so a leftover value never reaches the API.
      const maxSelections =
        group.type === "multiple"
          ? positiveCount(group.maxSelections)
          : undefined;
      return {
        id: group.id || optionId("group", groupIndex),
        name: group.name.trim(),
        type: group.type,
        required: group.required,
        ...(maxSelections !== undefined ? { maxSelections } : {}),
        choices,
      };
    })
    .filter((group) => group.name && group.choices.length > 0);

  const options: Record<string, unknown> = {};
  if (sizes.length) options.sizes = sizes;
  if (customizations.length) options.customizations = customizations;
  if (addOns.length) options.addOns = addOns;
  return Object.keys(options).length ? options : null;
};

const handleSaveMenuItem = async () => {
  optionsError.value = "";
  // buildStructuredOptions() drops rows it cannot turn into valid options, so
  // a half-filled row would vanish on save while the modal reported success —
  // the same silent-drop failure the strict `options` schema exists to prevent.
  // Refuse instead, and name what is missing.
  if (!usesSharedOptionGroups.value && hasIncompleteOptionRows()) {
    optionsError.value = t("menu.form.optionsIncomplete");
    return;
  }
  // In shared mode the JSON column is not what the menu reads, and leaving
  // it untouched keeps the old setup recoverable if the owner switches back.
  const options = usesSharedOptionGroups.value
    ? undefined
    : buildStructuredOptions();
  const oldImageId = previousImageId.value;
  const nextImageId = menuItemForm.value.imageId || null;
  const editingItem = editingMenuItem.value;
  menuItemConflict.value = null;
  const outcome = await saveMenuItem(
    {
      name: menuItemForm.value.name,
      nameEn: menuItemForm.value.nameEn || null,
      description: menuItemForm.value.description || null,
      price: Number(menuItemForm.value.price),
      originalPrice: menuItemForm.value.originalPrice || null,
      ingredients: menuItemForm.value.ingredients || null,
      spiceLevel: Number(menuItemForm.value.spiceLevel),
      preparationTime: menuItemForm.value.preparationTime
        ? Number(menuItemForm.value.preparationTime)
        : undefined,
      calories: menuItemForm.value.calories || null,
      dietaryInfo: Object.fromEntries(
        Object.entries(menuItemForm.value.dietaryInfo).filter(
          ([, value]) => value,
        ),
      ),
      allergens: menuItemForm.value.allergensText
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      tags: menuItemForm.value.tagsText
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      keywords: menuItemForm.value.keywords || null,
      options,
      categoryId: Number(menuItemForm.value.categoryId),
      catalogType: menuItemForm.value.catalogType,
      imageUrl: menuItemForm.value.imageUrl || null,
      imageId: nextImageId,
      imageVariants: menuItemForm.value.imageVariants,
      isFeatured: menuItemForm.value.isFeatured,
      isAvailable: menuItemForm.value.isAvailable,
      sortOrder: menuItemForm.value.sortOrder,
      inventoryCount: nullableInteger(menuItemForm.value.inventoryCount),
      minInventoryAlert: nullableInteger(menuItemForm.value.minInventoryAlert),
      updatedAt: menuItemForm.value.updatedAt,
    },
    editingItem?.id,
  );
  // Checked before the generic failure branch: "conflict" is truthy and needs
  // its own remedy, not the silent return a plain failure gets.
  if (outcome === "conflict" && editingItem) {
    menuItemConflict.value = {
      id: editingItem.id,
      name: menuItemForm.value.name || editingItem.name,
    };
    return;
  }
  if (outcome !== "saved") {
    return;
  }
  // Links are a separate resource, so they are written after the item is
  // known to have saved. A new item has no id to attach them to yet.
  if (usesSharedOptionGroups.value && editingItem) {
    const linksSaved = await saveItemGroups(
      editingItem.id,
      itemOptionGroups.value,
    );
    if (!linksSaved) return;
  }
  deletePreviousImageIfChanged(oldImageId, nextImageId);
  if (isMarketProductGapContext.value) {
    hasCompletedMarketProductGap.value = true;
  }
  closeMenuItemModal();
};

function deletePreviousImageIfChanged(
  oldImageId: string | null,
  nextImageId: string | null,
) {
  if (!oldImageId || oldImageId === nextImageId) {
    return;
  }

  const imageApiUrl = import.meta.env.VITE_IMAGE_API_URL;
  const token = getAuthToken();
  if (!imageApiUrl || !token) {
    console.warn("Skipping previous image delete: missing image API config");
    return;
  }

  fetch(`${imageApiUrl}/images/${oldImageId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }).catch((error) => {
    console.warn("Failed to delete previous menu item image:", error);
  });
}

const loadMenuItemImportExample = () => {
  menuItemImportError.value = "";
  menuItemImportResult.value = null;
  menuItemImportText.value = buildMenuItemImportTemplate(
    currentCategoryName.value,
    marketGapName.value,
  );
};

function firstQueryString(value: unknown) {
  if (Array.isArray(value)) {
    return value.find((item) => typeof item === "string") ?? "";
  }
  return typeof value === "string" ? value : "";
}

function returnToMarketReadiness() {
  router.push({
    name: "PlatformMarkets",
    query: {
      ...(marketGapSlug.value ? { marketSlug: marketGapSlug.value } : {}),
      ...(marketGapAreaCity.value ? { areaCity: marketGapAreaCity.value } : {}),
      ...(marketGapAreaDistrict.value
        ? { areaDistrict: marketGapAreaDistrict.value }
        : {}),
    },
  });
}

const importMenuItemsFromCsv = async () => {
  const parsed = menuItemImportPreview.value;
  if (!parsed.items.length || parsed.errors.length) {
    menuItemImportError.value =
      parsed.errors[0] ?? t("menu.errors.importInvalid");
    return;
  }

  isImportingMenuItems.value = true;
  menuItemImportError.value = "";
  menuItemImportResult.value = null;
  try {
    await importMenuItems(parsed.items);
    menuItemImportResult.value = parsed.items.length;
    hasCompletedMarketProductGap.value = true;
    menuItemImportText.value = "";
  } catch (error) {
    // importMenuItems already localises the reason (including the failing row)
    // and puts it on the Error it rethrows; nothing was written, so the owner
    // can fix that row and resubmit the same CSV without duplicating anything.
    menuItemImportError.value =
      error instanceof Error && error.message
        ? error.message
        : t("menu.errors.importFailed");
  } finally {
    isImportingMenuItems.value = false;
  }
};

const uploadImageMenuSources = async (files: File[]) => {
  imageMenuUploadError.value = "";
  for (const file of files) {
    const uploaded = await uploadImage(file, {
      restaurantId: restaurantId.value,
    });
    if (!uploaded) {
      imageMenuUploadError.value =
        imageUploadError.value || t("menu.upload.failed");
      return;
    }
    imageMenuSourceImages.value.push(uploaded.imageUrl);
  }
};

const publishImageAssistedMenu = async (payload: {
  categories: ImageMenuCategoryDraft[];
  items: Parameters<typeof validateImageAssistedMenuItems>[0];
}) => {
  imageMenuPublishError.value = "";
  imageMenuErrors.value = {};
  imageMenuCategoryErrors.value = {};

  const categoryErrors = validateImageAssistedMenuCategories(
    payload.categories,
  );
  if (Object.keys(categoryErrors).length) {
    imageMenuCategoryErrors.value = categoryErrors;
    imageMenuPublishError.value = t("menu.imageImport.fixFields");
    return;
  }

  const categoryIds = new Map<string, number>(
    categories.value.map((category) => [
      `existing-${category.id}`,
      category.id,
    ]),
  );
  imageMenuCreatedCategoryIds.forEach((id, key) => categoryIds.set(key, id));
  payload.categories.forEach((category, index) => {
    if (!categoryIds.has(category.key)) {
      categoryIds.set(category.key, -(index + 1));
    }
  });
  const beforeCreate = validateImageAssistedMenuItems(
    payload.items,
    categoryIds,
    currencyCode.value,
  );
  if (Object.keys(beforeCreate.errors).length) {
    imageMenuErrors.value = beforeCreate.errors;
    imageMenuPublishError.value = t("menu.imageImport.fixFields");
    return;
  }

  isPublishingImageMenu.value = true;
  try {
    const categoriesToCreate = payload.categories.filter(
      (category) => !imageMenuCreatedCategoryIds.has(category.key),
    );
    const createdCategoryIds = categoriesToCreate.length
      ? await createImageAssistedCategories(
          categoriesToCreate,
          imageMenuCreatedCategoryIds,
        )
      : imageMenuCreatedCategoryIds;
    createdCategoryIds.forEach((id, key) => categoryIds.set(key, id));
    const ready = validateImageAssistedMenuItems(
      payload.items,
      categoryIds,
      currencyCode.value,
    );
    await importMenuItems(ready.items);
    await fetchMenu();
    imageMenuPublishError.value = "";
    imageMenuErrors.value = {};
  } catch (error) {
    imageMenuPublishError.value =
      error instanceof Error && error.message
        ? t("menu.imageImport.publishFailed", { message: error.message })
        : t("menu.imageImport.publishFailed");
  } finally {
    isPublishingImageMenu.value = false;
  }
};

const handleDeleteMenuItem = (item: MenuItemData) => {
  openDeleteConfirm(
    t("common.delete"),
    t("menu.confirms.deleteItem", { name: item.name }),
    () => deleteMenuItem(item),
  );
};

// ── Highlight item from cross-module navigation ──
watch(
  () => route.query.highlightItem,
  async (itemIdStr) => {
    if (!itemIdStr) {
      highlightedItemId.value = null;
      return;
    }
    const itemId = Number(itemIdStr);
    if (isNaN(itemId)) return;

    const item = menuItems.value.find((m) => m.id === itemId);
    if (item) {
      selectedCategoryId.value = item.categoryId;
      searchQuery.value = "";
      statusFilter.value = "all";
    }

    highlightedItemId.value = itemId;

    await nextTick();
    await nextTick();
    menuGridRef.value?.scrollToMenuItem(itemId);

    setTimeout(() => {
      highlightedItemId.value = null;
    }, 3000);
  },
  { immediate: true },
);

onMounted(() => {
  fetchMenu();
});
</script>

<style scoped>
.menu-view {
  min-height: 100vh;
}

.line-clamp-1 {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.line-clamp-2 {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (max-width: 900px) {
  .grid-cols-\[300px_1fr\] {
    grid-template-columns: 1fr;
  }
}
</style>
