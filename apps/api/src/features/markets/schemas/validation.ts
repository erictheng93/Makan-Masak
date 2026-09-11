import { z } from "zod";

const decodeHtmlEntities = (value: string): string =>
  value
    // Decode &amp; LAST so a literal `&amp;lt;` round-trips to `&lt;`, not `<`
    // (decoding it first would re-expose escaped markup — a sanitizer bypass).
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x60;/g, "`")
    .replace(/&#x3D;/g, "=")
    .replace(/&amp;/g, "&");

const urlSchema = z.lazy(() =>
  z.string().transform(decodeHtmlEntities).pipe(z.url()),
);

const coordinateSchema = z.lazy(() =>
  z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
);
const linearRingSchema = z.lazy(() =>
  z
    .array(coordinateSchema)
    .min(4)
    .refine(
      (ring) => {
        const first = ring[0];
        const last = ring[ring.length - 1];
        return first[0] === last[0] && first[1] === last[1];
      },
      { message: "GeoJSON linear rings must be closed" },
    ),
);
const polygonCoordinatesSchema = z.lazy(() => z.array(linearRingSchema).min(1));
const boundaryGeojsonSchema = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal("Polygon"),
      coordinates: polygonCoordinatesSchema,
    }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(polygonCoordinatesSchema).min(1),
    }),
  ]),
);
const marketMapLayoutSchema = z.lazy(() =>
  z.object({
    title: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    imageUrl: urlSchema.nullable().optional(),
    width: z.number().int().min(1).max(10000).nullable().optional(),
    height: z.number().int().min(1).max(10000).nullable().optional(),
  }),
);

export const marketListQuerySchema = z.lazy(() =>
  z.object({
    q: z.string().trim().min(1).max(100).optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    type: z
      .enum([
        "night_market",
        "commercial_district",
        "food_court",
        "event_venue",
      ])
      .optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
);

export const nearbyMarketsQuerySchema = z.lazy(() =>
  z.object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().min(0.1).max(10).default(2),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
);

export const marketSlugParamSchema = z.lazy(() =>
  z.object({
    slug: z.string().min(1).max(120),
  }),
);

export const marketVendorsQuerySchema = z.lazy(() =>
  z
    .object({
      openNow: z.coerce.boolean().optional(),
      takeaway: z.coerce.boolean().optional(),
      delivery: z.coerce.boolean().optional(),
      q: z.string().min(1).max(100).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
      radiusKm: z.coerce.number().min(0.1).max(10).optional(),
      sortBy: z.enum(["rating", "popular", "distance"]).optional(),
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

export const marketIdParamSchema = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(120),
  }),
);

export const marketVendorParamSchema = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(120),
    restaurantId: z.string().min(1).max(120),
  }),
);

export const createMarketSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(120),
  name: z.string().min(1).max(120),
  type: z.enum([
    "night_market",
    "commercial_district",
    "food_court",
    "event_venue",
  ]),
  description: z.string().max(5000).nullable().optional(),
  city: z.string().min(1).max(80),
  district: z.string().min(1).max(80),
  address: z.string().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  boundaryGeojson: boundaryGeojsonSchema.nullable().optional(),
  openingHours: z.record(z.string(), z.any()).nullable().optional(),
  mapLayout: marketMapLayoutSchema.nullable().optional(),
  bannerUrl: urlSchema.nullable().optional(),
  logoUrl: urlSchema.nullable().optional(),
  imageUrls: z.array(urlSchema).nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).nullable().optional(),
  platformFeeRateBps: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
});

export const updateMarketSchema = z.lazy(() => createMarketSchema.partial());

export const addMarketVendorSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1).max(120),
    stallNumber: z.string().max(80).nullable().optional(),
    locationLabel: z.string().max(160).nullable().optional(),
    mapPosition: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      })
      .nullable()
      .optional(),
    marketHours: z.record(z.string(), z.any()).nullable().optional(),
    isPrimary: z.boolean().optional(),
  }),
);

export const updateMarketVendorSchema = z.lazy(() =>
  z.object({
    stallNumber: z.string().max(80).nullable().optional(),
    locationLabel: z.string().max(160).nullable().optional(),
    mapPosition: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
      })
      .nullable()
      .optional(),
    marketHours: z.record(z.string(), z.any()).nullable().optional(),
    isPrimary: z.boolean().optional(),
  }),
);

const importMarketVendorSchema = z.lazy(() =>
  z
    .object({
      restaurantId: z.string().min(1).max(120).optional(),
      name: z.string().min(1).max(120).optional(),
      type: z.string().min(1).max(50).optional(),
      category: z.string().min(1).max(50).optional(),
      description: z.string().max(1000).optional(),
      address: z.string().min(1).max(200).optional(),
      district: z.string().min(1).max(80).optional(),
      city: z.string().min(1).max(80).optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      phone: z
        .string()
        .min(8)
        .max(30)
        .regex(/^[\d\s\-+()]+$/)
        .optional(),
      email: z.email().optional(),
      website: urlSchema.optional(),
      stallNumber: z.string().max(80).nullable().optional(),
      locationLabel: z.string().max(160).nullable().optional(),
      mapPosition: z
        .object({
          x: z.number().min(0).max(100),
          y: z.number().min(0).max(100),
        })
        .nullable()
        .optional(),
      marketHours: z.record(z.string(), z.any()).nullable().optional(),
      isPrimary: z.boolean().optional(),
    })
    .superRefine((value, ctx) => {
      if (value.restaurantId) return;

      for (const key of ["name", "address", "district"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when restaurantId is omitted`,
          });
        }
      }
    }),
);

export const importMarketVendorsSchema = z.lazy(() =>
  z.object({
    dryRun: z.boolean().optional(),
    vendors: z.array(importMarketVendorSchema).min(1).max(50),
  }),
);

export const bulkCreateMarketsSchema = z.lazy(() =>
  z.object({
    dryRun: z.boolean().optional(),
    markets: z.array(createMarketSchema).min(1).max(50),
  }),
);

export const createMarketJoinRequestSchema = z.lazy(() =>
  z
    .object({
      marketId: z.string().min(1).max(120).optional(),
      marketSlug: z.string().min(1).max(120).optional(),
      message: z.string().trim().max(500).nullable().optional(),
    })
    .refine((input) => Boolean(input.marketId || input.marketSlug), {
      path: ["marketId"],
      message: "marketId or marketSlug is required",
    }),
);

export const adminMarketJoinRequestsQuerySchema = z.lazy(() =>
  z.object({
    status: z.enum(["pending", "approved", "rejected"]).optional(),
  }),
);

export const adminVendorCandidatesQuerySchema = z.lazy(() =>
  z.object({
    q: z.string().trim().max(80).optional(),
    marketId: z.string().min(1).max(120).optional(),
    limit: z
      .string()
      .transform(Number)
      .refine((value) => Number.isInteger(value) && value > 0 && value <= 20, {
        message: "Limit must be a positive integer up to 20",
      })
      .optional(),
  }),
);

export const marketJoinRequestIdParamSchema = z.lazy(() =>
  z.object({
    requestId: z.coerce.number().int().min(1),
  }),
);

export const approveMarketJoinRequestSchema = z.lazy(() =>
  z.object({
    stallNumber: z.string().max(80).nullable().optional(),
    locationLabel: z.string().max(160).nullable().optional(),
    marketHours: z.record(z.string(), z.any()).nullable().optional(),
    isPrimary: z.boolean().optional(),
  }),
);
