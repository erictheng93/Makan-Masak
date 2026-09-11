import { z } from "zod";

export const dishSearchQuerySchema = z.lazy(() =>
  z
    .object({
      q: z.string().min(1).max(100).optional(),
      district: z.string().optional(),
      city: z.string().optional(),
      categoryName: z.string().optional(),
      catalogType: z.enum(["menu_item", "product"]).optional(),
      marketId: z.string().optional(),
      marketSlug: z.string().min(1).max(120).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(0.1).max(10).optional(),
      priceMin: z.coerce.number().min(0).optional(),
      priceMax: z.coerce.number().min(0).optional(),
      openNow: z.coerce.boolean().optional(),
      takeaway: z.coerce.boolean().optional(),
      delivery: z.coerce.boolean().optional(),
      sortBy: z
        .enum(["price_asc", "price_desc", "popular", "open_now", "distance"])
        .optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .superRefine((query, ctx) => {
      if (
        query.sortBy === "distance" &&
        (query.lat == null || query.lng == null)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sortBy"],
          message: "distance sorting requires lat and lng",
        });
      }

      const hasSearchScope =
        query.q ||
        query.marketId ||
        query.marketSlug ||
        query.categoryName ||
        query.city ||
        query.district ||
        (query.lat != null && query.lng != null);

      if (!hasSearchScope) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["q"],
          message: "Required",
        });
      }
    }),
);

export const dishCategoryQuerySchema = z.lazy(() =>
  z.object({
    district: z.string().optional(),
    city: z.string().optional(),
    catalogType: z.enum(["menu_item", "product"]).optional(),
    marketId: z.string().optional(),
    marketSlug: z.string().min(1).max(120).optional(),
    takeaway: z.coerce.boolean().optional(),
    delivery: z.coerce.boolean().optional(),
  }),
);

export const serviceTypeFacetQuerySchema = z.lazy(() =>
  z.object({
    district: z.string().optional(),
    city: z.string().optional(),
    marketId: z.string().optional(),
    marketSlug: z.string().min(1).max(120).optional(),
    openNow: z.coerce.boolean().optional(),
    takeaway: z.coerce.boolean().optional(),
    delivery: z.coerce.boolean().optional(),
  }),
);

export const restaurantBrowseQuerySchema = z.lazy(() =>
  z
    .object({
      q: z.string().min(1).max(100).optional(),
      district: z.string().optional(),
      city: z.string().optional(),
      marketId: z.string().optional(),
      marketSlug: z.string().min(1).max(120).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(0.1).max(10).optional(),
      cuisineType: z.string().optional(),
      priceRange: z.coerce.number().int().min(1).max(3).optional(),
      openNow: z.coerce.boolean().optional(),
      takeaway: z.coerce.boolean().optional(),
      delivery: z.coerce.boolean().optional(),
      sortBy: z.enum(["rating", "popular", "open_now", "distance"]).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .superRefine((query, ctx) => {
      if (
        query.sortBy === "distance" &&
        (query.lat == null || query.lng == null)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sortBy"],
          message: "distance sorting requires lat and lng",
        });
      }
    }),
);

export const serviceSearchQuerySchema = z.lazy(() =>
  z
    .object({
      q: z.string().min(1).max(100).optional(),
      district: z.string().optional(),
      city: z.string().optional(),
      marketId: z.string().optional(),
      marketSlug: z.string().min(1).max(120).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(0.1).max(10).optional(),
      serviceType: z
        .enum([
          "general",
          "booking",
          "pickup",
          "delivery",
          "consultation",
          "rental",
          "activity",
        ])
        .optional(),
      takeaway: z.coerce.boolean().optional(),
      delivery: z.coerce.boolean().optional(),
      openNow: z.coerce.boolean().optional(),
      sortBy: z
        .enum(["price_asc", "price_desc", "popular", "open_now", "distance"])
        .optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .superRefine((query, ctx) => {
      if (
        query.sortBy === "distance" &&
        (query.lat == null || query.lng == null)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sortBy"],
          message: "distance sorting requires lat and lng",
        });
      }

      const hasSearchScope =
        query.q ||
        query.marketId ||
        query.marketSlug ||
        query.city ||
        query.district ||
        query.serviceType ||
        (query.lat != null && query.lng != null);

      if (!hasSearchScope) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["q"],
          message: "Required",
        });
      }
    }),
);

export const restaurantIdParamSchema = z.object({
  id: z.string().min(1),
});
