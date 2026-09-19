/**
 * Discovery API Response Contracts
 *
 * Defines the STABLE response shapes for public discovery endpoints.
 * Customer app search and browse depends on these.
 */

import { z } from "zod";
import { successEnvelope } from "../helpers";
import { MenuItemSchema } from "./menu";

// ---------------------------------------------------------------------------
// Response Contracts
// ---------------------------------------------------------------------------

/**
 * Dish and service search results span restaurants, so each row names the
 * currency its price is in; the customer app formats every row with it
 * rather than with the last-visited shop's currency.
 */
const CrossRestaurantPriceSchema = z
  .object({
    restaurantId: z.string(),
    priceCents: z.number().nullable(),
    currency: z.enum(["TWD", "MYR", "VND"]),
  })
  .loose();

export const SearchResponse = successEnvelope(
  z
    .object({
      results: z.array(CrossRestaurantPriceSchema),
      total: z.number(),
    })
    .loose(),
);

export const BrowseRestaurantsResponse = successEnvelope(
  z.unknown(), // restaurant listing
);

export const GetRestaurantMenuResponse = successEnvelope(
  z
    .object({
      items: z.array(MenuItemSchema).optional(),
    })
    .loose(),
);

export const GetPopularItemsResponse = successEnvelope(
  z
    .object({
      dishes: z.array(CrossRestaurantPriceSchema),
    })
    .loose(),
);

export const ReindexResponse = successEnvelope(z.unknown());
