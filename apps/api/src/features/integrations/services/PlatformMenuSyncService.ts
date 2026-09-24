import { eq, and, isNull } from "drizzle-orm";
import {
  createDatabase,
  loadAssembledMenuItemOptions,
  platformIntegrations,
  platformMenuMappings,
  menuItems,
  categories,
  restaurants,
} from "@makanmasak/database";
import type {
  PlatformType,
  MenuSyncPayload,
  MenuSyncModifierGroup,
} from "@makanmasak/shared-types";
import type { Env } from "../../../types/env";
import { getAdapter } from "../adapters/PlatformAdapter";
import { PlatformIntegrationService } from "./PlatformIntegrationService";
import { currencyFromRestaurantSettings } from "../../../shared/utils/restaurant-currency";
import { toRequiredCents } from "../../../shared/utils/money";
export class PlatformMenuSyncService {
  private db;
  private env: Env;
  private integrationService: PlatformIntegrationService;

  constructor(env: Env) {
    this.db = createDatabase(env.DB);
    this.env = env;
    this.integrationService = new PlatformIntegrationService(env);
  }

  async syncMenu(restaurantId: string, platform: PlatformType): Promise<void> {
    // Mark as syncing
    await this.db
      .update(platformIntegrations)
      .set({
        menuSyncStatus: "syncing",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(platformIntegrations.restaurantId, restaurantId),
          eq(platformIntegrations.platform, platform),
        ),
      );

    try {
      const [restaurant] = await this.db
        .select({
          settings: restaurants.settings,
          businessHours: restaurants.businessHours,
        })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);
      if (!restaurant) throw new Error("Restaurant not found for menu sync");
      const currencyCode = currencyFromRestaurantSettings(
        restaurant.settings,
        restaurantId,
      );
      const days = new Set([
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ]);
      const serviceAvailability = Object.entries(restaurant.businessHours ?? {})
        .filter(
          ([day, hours]) =>
            days.has(day) &&
            !("isOpen" in hours && !hours.isOpen) &&
            !("closed" in hours && hours.closed),
        )
        .map(([day, hours]) => {
          if (
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.open) ||
            !/^([01]\d|2[0-3]):[0-5]\d$/.test(hours.close) ||
            hours.open >= hours.close
          ) {
            throw new Error(`Invalid Uber Eats menu hours for ${day}`);
          }
          return {
            day_of_week: day,
            time_periods: [{ start_time: hours.open, end_time: hours.close }],
          };
        });
      // Read all active menu items and categories
      const allCategories = await this.db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.restaurantId, restaurantId),
            eq(categories.isActive, true),
            eq(categories.isVisible, true),
            isNull(categories.deletedAt),
          ),
        );

      const allMenuItems = await this.db
        .select()
        .from(menuItems)
        .where(
          and(
            eq(menuItems.restaurantId, restaurantId),
            eq(menuItems.isAvailable, true),
            isNull(menuItems.deletedAt),
          ),
        );

      const visibleCategories = allCategories.filter(
        (category) =>
          category.isActive !== false &&
          category.isVisible !== false &&
          !category.deletedAt,
      );
      const visibleCategoryIds = new Set(
        visibleCategories.map((cat) => cat.id),
      );
      const visibleItems = allMenuItems.filter(
        (item) =>
          item.isAvailable !== false &&
          !item.deletedAt &&
          visibleCategoryIds.has(item.categoryId),
      );

      const optionMap = await loadAssembledMenuItemOptions(
        this.db,
        visibleItems,
      );
      const modifierGroupsFor = (itemId: number): MenuSyncModifierGroup[] => {
        const options = optionMap.get(itemId);
        if (!options) return [];
        const groups: MenuSyncModifierGroup[] = [];
        if (options.sizes?.length) {
          groups.push({
            id: "size",
            name: "Size",
            required: true,
            minSelections: 1,
            maxSelections: 1,
            modifiers: options.sizes.map((size) => ({
              id: size.id,
              name: size.name,
              priceCents: toRequiredCents(size.priceAdjustment),
              available: size.available,
            })),
          });
        }
        for (const group of options.customizations ?? []) {
          groups.push({
            id: group.id,
            name: group.name,
            required: group.required ?? false,
            minSelections: group.required ? 1 : 0,
            maxSelections:
              group.type === "single"
                ? 1
                : (group.maxSelections ?? group.choices.length),
            modifiers: group.choices.map((choice) => ({
              id: choice.id,
              name: choice.name,
              priceCents: toRequiredCents(choice.priceAdjustment ?? 0),
              available: choice.available,
            })),
          });
        }
        if (options.addOns?.length) {
          groups.push({
            id: "add-ons",
            name: "Add-ons",
            required: false,
            minSelections: 0,
            maxSelections: options.addOns.length,
            modifiers: options.addOns.map((addOn) => ({
              id: addOn.id,
              name: addOn.name,
              priceCents: toRequiredCents(addOn.price),
              available: addOn.available,
            })),
          });
        }
        return groups;
      };

      // Build MenuSyncPayload
      const menuData: MenuSyncPayload = {
        restaurantId,
        currencyCode,
        serviceAvailability,
        categories: visibleCategories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          items: visibleItems
            .filter((item) => item.categoryId === cat.id)
            .map((item) => {
              if (item.priceCents == null) {
                throw new Error(`Menu item ${item.id} is missing a price`);
              }
              return {
                id: item.id,
                name: item.name,
                description: item.description ?? "",
                priceCents: item.priceCents,
                imageUrl: item.imageUrl ?? undefined,
                available: item.isAvailable ?? true,
                modifierGroups: modifierGroupsFor(item.id),
              };
            }),
        })),
      };

      // Get adapter and credentials
      const adapter = getAdapter(platform);
      const creds = await this.integrationService.getDecryptedCredentials(
        restaurantId,
        platform,
      );

      // Sync menu to platform
      const result = await adapter.syncMenu(menuData, creds);

      // Update platform_menu_mappings with returned platformItemIds
      if (result.platformItemIds) {
        for (const [internalIdStr, platformItemId] of Object.entries(
          result.platformItemIds,
        )) {
          const menuItemId = Number(internalIdStr);
          const existing = await this.db
            .select()
            .from(platformMenuMappings)
            .where(
              and(
                eq(platformMenuMappings.restaurantId, restaurantId),
                eq(platformMenuMappings.platform, platform),
                eq(platformMenuMappings.menuItemId, menuItemId),
              ),
            )
            .limit(1);

          if (existing[0]) {
            await this.db
              .update(platformMenuMappings)
              .set({
                platformItemId,
                updatedAt: new Date(),
              })
              .where(eq(platformMenuMappings.id, existing[0].id));
          } else {
            await this.db.insert(platformMenuMappings).values({
              restaurantId,
              platform,
              menuItemId,
              platformItemId,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }

      // Mark sync as success
      await this.db
        .update(platformIntegrations)
        .set({
          menuSyncStatus: "success",
          lastMenuSyncAt: new Date(),
          menuSyncError: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(platformIntegrations.restaurantId, restaurantId),
            eq(platformIntegrations.platform, platform),
          ),
        );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await this.db
        .update(platformIntegrations)
        .set({
          menuSyncStatus: "error",
          menuSyncError: errorMessage,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(platformIntegrations.restaurantId, restaurantId),
            eq(platformIntegrations.platform, platform),
          ),
        );

      throw error;
    }
  }
}
