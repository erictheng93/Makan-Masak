import { Hono } from "hono";
import type { z } from "zod";
import type { SupportedCountryCode } from "@makanmasak/shared-types";
import { requireRole } from "../../../middleware/auth";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../../../middleware/validation";
import type { Env } from "../../../shared/types";
import { assertMarketFeeWithinRegionCap } from "../../../shared/policy/regionPolicyGuards";
import { createSearchIndexSync } from "../../discovery/services/SearchIndexSyncService";
import {
  addMarketVendorSchema,
  adminMarketJoinRequestsQuerySchema,
  adminVendorCandidatesQuerySchema,
  approveMarketJoinRequestSchema,
  bulkCreateMarketsSchema,
  createMarketSchema,
  importMarketVendorsSchema,
  marketJoinRequestIdParamSchema,
  marketIdParamSchema,
  marketVendorParamSchema,
  updateMarketVendorSchema,
  updateMarketSchema,
} from "../schemas/validation";
import {
  MarketsService,
  type UpdateMarketInput,
} from "../services/MarketsService";
import { resolveMarketCountry } from "../services/market-country";
import { RestaurantsService } from "../../restaurants/services/RestaurantsService";

const routes = new Hono<{ Bindings: Env }>();

type ImportMarketVendorInput = z.infer<
  typeof importMarketVendorsSchema
>["vendors"][number];
type BulkCreateMarketInput = Omit<
  z.infer<typeof bulkCreateMarketsSchema>["markets"][number],
  "countryCode"
> & { countryCode?: SupportedCountryCode | null };

function restaurantBusinessHoursFromMarketOpeningHours(
  openingHours: Record<
    string,
    { open: string; close: string; closed?: boolean }
  > | null,
) {
  const weekdays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return Object.fromEntries(
    weekdays.flatMap((day) => {
      // Restaurant eligibility reads full weekday names. Prefer an explicit
      // full name when a legacy market contains both spellings of the same day.
      const hours = openingHours?.[day] ?? openingHours?.[day.slice(0, 3)];
      if (!hours) return [];
      return [
        [
          day,
          {
            open: hours.open ?? "00:00",
            close: hours.close ?? "00:00",
            isOpen: !hours.closed,
          },
        ],
      ];
    }),
  );
}

type BulkCreateMarketIssue = {
  index: number;
  code: "duplicate_in_payload" | "slug_exists";
  severity: "blocking";
  message: string;
  slug: string;
  marketName?: string;
};

type VendorImportIssue = {
  index: number;
  code:
    | "already_attached"
    | "city_defaulted"
    | "coordinates_missing"
    | "duplicate_in_payload"
    | "phone_defaulted"
    | "restaurant_not_found";
  severity: "blocking" | "warning";
  message: string;
  field?: "city" | "coordinates" | "phone";
  restaurantId?: string;
  restaurantName?: string;
};

const newVendorDuplicateKey = (vendor: ImportMarketVendorInput) =>
  vendor.restaurantId
    ? `id:${vendor.restaurantId}`
    : `new:${vendor.name?.trim().toLowerCase() ?? ""}\u0000${
        vendor.address?.trim().toLowerCase() ?? ""
      }`;

async function preflightMarketBulkImport(input: {
  markets: BulkCreateMarketInput[];
  marketsService: MarketsService;
}) {
  const issues: BulkCreateMarketIssue[] = [];
  const seen = new Map<string, number>();
  const duplicateIndexes = new Set<number>();

  for (const [index, market] of input.markets.entries()) {
    const firstIndex = seen.get(market.slug);
    if (firstIndex !== undefined) {
      duplicateIndexes.add(index);
      issues.push({
        index,
        code: "duplicate_in_payload",
        severity: "blocking",
        message: "Market slug appears more than once in this import payload",
        slug: market.slug,
        marketName: market.name,
      });
      continue;
    }
    seen.set(market.slug, index);
  }

  const existingMarkets = await input.marketsService.listMarketsBySlugs([
    ...seen.keys(),
  ]);
  const existingSlugNames = new Map(
    existingMarkets.map((market) => [market.slug, market.name]),
  );
  const createableMarkets: BulkCreateMarketInput[] = [];
  const results = input.markets.map((market, index) => {
    const existingName = existingSlugNames.get(market.slug);
    if (duplicateIndexes.has(index)) {
      return {
        status: "skipped" as const,
        reason: "duplicate_in_payload" as const,
        slug: market.slug,
        marketName: market.name,
      };
    }

    if (existingName !== undefined) {
      issues.push({
        index,
        code: "slug_exists",
        severity: "blocking",
        message: "Market slug already exists",
        slug: market.slug,
        marketName: existingName,
      });
      return {
        status: "skipped" as const,
        reason: "slug_exists" as const,
        slug: market.slug,
        marketName: existingName,
      };
    }

    createableMarkets.push(market);
    return {
      status: "would_create" as const,
      slug: market.slug,
      marketName: market.name,
      type: market.type,
      city: market.city,
      district: market.district,
    };
  });

  return {
    createableMarkets,
    issues,
    results,
  };
}

function addNewVendorDefaultIssues(
  issues: VendorImportIssue[],
  input: {
    index: number;
    vendor: ImportMarketVendorInput;
    marketCity: string;
  },
) {
  if (!input.vendor.phone) {
    issues.push({
      index: input.index,
      code: "phone_defaulted",
      severity: "warning",
      field: "phone",
      message: "Phone is missing and defaults to 00000000",
      restaurantName: input.vendor.name,
    });
  }
  if (!input.vendor.city) {
    issues.push({
      index: input.index,
      code: "city_defaulted",
      severity: "warning",
      field: "city",
      message: `City is missing and defaults to ${input.marketCity}`,
      restaurantName: input.vendor.name,
    });
  }
  if (
    typeof input.vendor.latitude !== "number" ||
    typeof input.vendor.longitude !== "number"
  ) {
    issues.push({
      index: input.index,
      code: "coordinates_missing",
      severity: "warning",
      field: "coordinates",
      message: "Coordinates are missing and map-based discovery is weaker",
      restaurantName: input.vendor.name,
    });
  }
}

async function dryRunVendorImport(input: {
  vendors: ImportMarketVendorInput[];
  marketId: string;
  marketCity: string;
  marketsService: MarketsService;
  restaurantsService: RestaurantsService;
}) {
  const issues: VendorImportIssue[] = [];
  const results = [];
  const seen = new Set<string>();
  let wouldCreateRestaurants = 0;
  let wouldAttachVendors = 0;
  let skipped = 0;

  for (const [index, vendor] of input.vendors.entries()) {
    const duplicateKey = newVendorDuplicateKey(vendor);
    if (seen.has(duplicateKey)) {
      skipped += 1;
      issues.push({
        index,
        code: "duplicate_in_payload",
        severity: "blocking",
        message: "Vendor appears more than once in this import payload",
        restaurantId: vendor.restaurantId,
        restaurantName: vendor.name,
      });
      results.push({
        status: "skipped",
        reason: "duplicate_in_payload",
        restaurantId: vendor.restaurantId,
        restaurantName: vendor.name,
        stallNumber: vendor.stallNumber ?? null,
        locationLabel: vendor.locationLabel ?? null,
        mapPosition: vendor.mapPosition ?? null,
      });
      continue;
    }
    seen.add(duplicateKey);

    if (!vendor.restaurantId) {
      wouldCreateRestaurants += 1;
      wouldAttachVendors += 1;
      addNewVendorDefaultIssues(issues, {
        index,
        vendor,
        marketCity: input.marketCity,
      });
      results.push({
        status: "would_create",
        restaurantName: vendor.name,
        stallNumber: vendor.stallNumber ?? null,
        locationLabel: vendor.locationLabel ?? null,
        mapPosition: vendor.mapPosition ?? null,
      });
      continue;
    }

    const restaurant = await input.restaurantsService.getRestaurant(
      vendor.restaurantId,
    );
    if (!restaurant || !restaurant.isActive) {
      skipped += 1;
      issues.push({
        index,
        code: "restaurant_not_found",
        severity: "blocking",
        message: "Restaurant was not found or is inactive",
        restaurantId: vendor.restaurantId,
        restaurantName: vendor.name,
      });
      results.push({
        status: "skipped",
        reason: "restaurant_not_found",
        restaurantId: vendor.restaurantId,
        restaurantName: vendor.name,
        stallNumber: vendor.stallNumber ?? null,
        locationLabel: vendor.locationLabel ?? null,
        mapPosition: vendor.mapPosition ?? null,
      });
      continue;
    }

    const memberships = await input.marketsService.listRestaurantMemberships(
      vendor.restaurantId,
    );
    if (
      memberships.memberships.some(
        (membership) => membership.marketId === input.marketId,
      )
    ) {
      skipped += 1;
      issues.push({
        index,
        code: "already_attached",
        severity: "blocking",
        message: "Restaurant already belongs to this market",
        restaurantId: vendor.restaurantId,
        restaurantName: restaurant.name,
      });
      results.push({
        status: "skipped",
        reason: "already_attached",
        restaurantId: vendor.restaurantId,
        restaurantName: restaurant.name,
        stallNumber: vendor.stallNumber ?? null,
        locationLabel: vendor.locationLabel ?? null,
      });
      continue;
    }

    wouldAttachVendors += 1;
    results.push({
      status: "would_attach",
      restaurantId: vendor.restaurantId,
      restaurantName: restaurant.name,
      stallNumber: vendor.stallNumber ?? null,
      locationLabel: vendor.locationLabel ?? null,
      mapPosition: vendor.mapPosition ?? null,
    });
  }

  return {
    dryRun: true,
    wouldCreateRestaurants,
    wouldAttachVendors,
    skipped,
    issueCount: issues.length,
    blockingIssueCount: issues.filter((issue) => issue.severity === "blocking")
      .length,
    warningIssueCount: issues.filter((issue) => issue.severity === "warning")
      .length,
    issues,
    results,
  };
}

routes.use("*", requireRole([0]));

routes.get("/readiness", async (c) => {
  const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
  const data = await service.listAdminReadiness({ limit: 100 });
  return c.json({ success: true, data });
});

routes.get("/area-readiness", async (c) => {
  const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
  const data = await service.listAreaReadiness();
  return c.json({ success: true, data });
});

routes.get(
  "/vendor-candidates",
  validateQuery(adminVendorCandidatesQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const data = await service.listVendorCandidates(query);
    return c.json({ success: true, data });
  },
);

routes.get(
  "/join-requests",
  validateQuery(adminMarketJoinRequestsQuerySchema),
  async (c) => {
    const query = c.get("validatedQuery");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const data = await service.listJoinRequests(query);
    return c.json({ success: true, data });
  },
);

routes.post(
  "/join-requests/:requestId/approve",
  validateParams(marketJoinRequestIdParamSchema),
  validateBody(approveMarketJoinRequestSchema),
  async (c) => {
    const { requestId } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const result = await service.approveJoinRequest(requestId, body);

    if (result.status === "not_found") {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_JOIN_REQUEST_NOT_FOUND",
            message: "Market join request not found",
          },
        },
        404,
      );
    }

    if (result.status === "not_pending") {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_JOIN_REQUEST_NOT_PENDING",
            message: "Market join request is not pending",
          },
        },
        409,
      );
    }

    if (result.status === "market_not_found") {
      return c.json(
        {
          success: false,
          error: { code: "MARKET_NOT_FOUND", message: "Market not found" },
        },
        404,
      );
    }

    const sync = createSearchIndexSync(c.env);
    await sync.onMarketMembershipChanged(result.membership.restaurantId);

    return c.json({
      success: true,
      data: { request: result.request, membership: result.membership },
    });
  },
);

routes.post(
  "/join-requests/:requestId/reject",
  validateParams(marketJoinRequestIdParamSchema),
  async (c) => {
    const { requestId } = c.get("validatedParams");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const result = await service.rejectJoinRequest(requestId);

    if (result.status === "not_found") {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_JOIN_REQUEST_NOT_FOUND",
            message: "Market join request not found",
          },
        },
        404,
      );
    }

    if (result.status === "not_pending") {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_JOIN_REQUEST_NOT_PENDING",
            message: "Market join request is not pending",
          },
        },
        409,
      );
    }

    return c.json({ success: true, data: { request: result.request } });
  },
);

routes.post("/", validateBody(createMarketSchema), async (c) => {
  const body = c.get("validatedBody");
  const countryCode = resolveMarketCountry(body);
  await assertMarketFeeWithinRegionCap(c.env, {
    countryCode,
    platformFeeRateBps: body.platformFeeRateBps ?? 0,
  });
  const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
  const market = await service.createMarket({ ...body, countryCode });
  return c.json({ success: true, data: { market } }, 201);
});

routes.post("/bulk", validateBody(bulkCreateMarketsSchema), async (c) => {
  const { dryRun = false, markets: requested } = c.get("validatedBody");
  const markets = requested.map((market) => ({
    ...market,
    countryCode: resolveMarketCountry(market),
  }));
  for (const market of markets) {
    await assertMarketFeeWithinRegionCap(c.env, {
      countryCode: market.countryCode,
      platformFeeRateBps: market.platformFeeRateBps ?? 0,
    });
  }
  const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
  const preflight = await preflightMarketBulkImport({
    markets,
    marketsService: service,
  });

  if (dryRun) {
    return c.json({
      success: true,
      data: {
        dryRun: true,
        wouldCreateMarkets: preflight.createableMarkets.length,
        createdMarkets: 0,
        skipped: markets.length - preflight.createableMarkets.length,
        issueCount: preflight.issues.length,
        blockingIssueCount: preflight.issues.length,
        issues: preflight.issues,
        results: preflight.results,
      },
    });
  }

  try {
    const createdMarkets = await service.createMarketsBulk(
      preflight.createableMarkets,
    );
    const createdBySlug = new Map(
      createdMarkets.map((market) => [market.slug, market]),
    );
    const results = preflight.results.map((result) => {
      if (result.status !== "would_create") return result;

      const market = createdBySlug.get(result.slug);
      return {
        status: "created" as const,
        slug: result.slug,
        marketName: result.marketName,
        market,
      };
    });

    return c.json(
      {
        success: true,
        data: {
          createdMarkets: createdMarkets.length,
          skipped: markets.length - createdMarkets.length,
          issueCount: preflight.issues.length,
          blockingIssueCount: preflight.issues.length,
          issues: preflight.issues,
          results,
        },
      },
      201,
    );
  } catch (error) {
    console.error("Failed to bulk create markets:", error);
    return c.json(
      {
        success: false,
        error: {
          code: "MARKET_BULK_IMPORT_FAILED",
          message: "Bulk market import failed and no markets were created",
        },
      },
      409,
    );
  }
});

routes.put(
  "/:id",
  validateParams(marketIdParamSchema),
  validateBody(updateMarketSchema),
  async (c) => {
    const { id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);

    // 城市、國別或費率任一項變動，都要重新確認國別與上限。
    let patch: UpdateMarketInput = body;
    if (
      body.city !== undefined ||
      body.countryCode !== undefined ||
      body.platformFeeRateBps !== undefined
    ) {
      const existing = await service.getMarketById(id);
      if (existing) {
        const countryCode = resolveMarketCountry({
          city: body.city ?? existing.city,
          // 改了城市又沒指定國別時重新推導；否則沿用既有值。
          countryCode:
            body.countryCode ??
            (body.city !== undefined ? undefined : existing.countryCode),
        });
        await assertMarketFeeWithinRegionCap(c.env, {
          countryCode,
          platformFeeRateBps:
            body.platformFeeRateBps ?? existing.platformFeeRateBps,
        });
        patch = { ...body, countryCode };
      }
    }

    const market = await service.updateMarket(id, patch);

    if (!market) {
      return c.json(
        {
          success: false,
          error: { code: "MARKET_NOT_FOUND", message: "Market not found" },
        },
        404,
      );
    }

    const sync = createSearchIndexSync(c.env);
    await sync.onMarketChanged(id);

    return c.json({ success: true, data: { market } });
  },
);

routes.delete("/:id", validateParams(marketIdParamSchema), async (c) => {
  const { id } = c.get("validatedParams");
  const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
  const deleted = await service.softDeleteMarket(id);

  if (!deleted) {
    return c.json(
      {
        success: false,
        error: { code: "MARKET_NOT_FOUND", message: "Market not found" },
      },
      404,
    );
  }

  const sync = createSearchIndexSync(c.env);
  await sync.onMarketChanged(id);

  return c.json({ success: true, data: { deleted } });
});

routes.post(
  "/:id/vendors",
  validateParams(marketIdParamSchema),
  validateBody(addMarketVendorSchema),
  async (c) => {
    const { id } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const existing = await service.getActiveVendorMembership(
      id,
      body.restaurantId,
    );

    if (existing) {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_VENDOR_ALREADY_ATTACHED",
            message: "Restaurant already belongs to this market",
          },
        },
        409,
      );
    }

    const membership = await service.addVendor(id, body);

    if (!membership) {
      return c.json(
        {
          success: false,
          error: { code: "MARKET_NOT_FOUND", message: "Market not found" },
        },
        404,
      );
    }

    const sync = createSearchIndexSync(c.env);
    await sync.onMarketMembershipChanged(body.restaurantId);

    return c.json({ success: true, data: { membership } }, 201);
  },
);

routes.put(
  "/:id/vendors/:restaurantId",
  validateParams(marketVendorParamSchema),
  validateBody(updateMarketVendorSchema),
  async (c) => {
    const { id, restaurantId } = c.get("validatedParams");
    const body = c.get("validatedBody");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const existing = await service.getActiveVendorMembership(id, restaurantId);

    if (!existing) {
      return c.json(
        {
          success: false,
          error: {
            code: "MARKET_VENDOR_NOT_FOUND",
            message: "Restaurant does not belong to this market",
          },
        },
        404,
      );
    }

    const membership = await service.addVendor(id, {
      restaurantId,
      stallNumber: body.stallNumber,
      locationLabel: body.locationLabel,
      mapPosition: body.mapPosition,
      marketHours: body.marketHours,
      isPrimary: body.isPrimary,
    });

    const sync = createSearchIndexSync(c.env);
    await sync.onMarketMembershipChanged(restaurantId);

    return c.json({ success: true, data: { membership } });
  },
);

routes.post(
  "/:id/vendor-imports",
  validateParams(marketIdParamSchema),
  validateBody(importMarketVendorsSchema),
  async (c) => {
    const { id } = c.get("validatedParams");
    const { dryRun = false, vendors } = c.get("validatedBody");
    const marketsService = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const restaurantsService = new RestaurantsService(
      c.env.DB,
      c.env,
      c.env.CACHE_KV,
    );
    const market = await marketsService.getMarketById(id);

    if (!market || market.deletedAt) {
      return c.json(
        {
          success: false,
          error: { code: "MARKET_NOT_FOUND", message: "Market not found" },
        },
        404,
      );
    }

    if (dryRun) {
      const data = await dryRunVendorImport({
        vendors,
        marketId: id,
        marketCity: market.city,
        marketsService,
        restaurantsService,
      });
      const publicReadiness = await marketsService.getPublicReadiness(id, {
        additionalVendorCount: data.wouldAttachVendors,
      });
      return c.json({
        success: true,
        data: {
          ...data,
          publicReadiness,
        },
      });
    }

    const sync = createSearchIndexSync(c.env);
    const results = [];
    let createdRestaurants = 0;
    let attachedVendors = 0;
    let skipped = 0;
    const issues: VendorImportIssue[] = [];
    const seen = new Set<string>();

    for (const [index, vendor] of vendors.entries()) {
      const duplicateKey = newVendorDuplicateKey(vendor);
      if (seen.has(duplicateKey)) {
        skipped += 1;
        issues.push({
          index,
          code: "duplicate_in_payload",
          severity: "blocking",
          message: "Vendor appears more than once in this import payload",
          restaurantId: vendor.restaurantId,
          restaurantName: vendor.name,
        });
        results.push({
          status: "skipped",
          reason: "duplicate_in_payload",
          restaurantId: vendor.restaurantId,
          restaurantName: vendor.name,
          stallNumber: vendor.stallNumber ?? null,
          locationLabel: vendor.locationLabel ?? null,
          mapPosition: vendor.mapPosition ?? null,
        });
        continue;
      }
      seen.add(duplicateKey);

      let restaurantId = vendor.restaurantId;
      let restaurantName = vendor.name;
      let status: "attached" | "created" = "attached";

      if (!restaurantId) {
        addNewVendorDefaultIssues(issues, {
          index,
          vendor,
          marketCity: market.city,
        });
        const restaurant = await restaurantsService.createRestaurant({
          name: vendor.name!,
          type: vendor.type ?? "market_stall",
          category: vendor.category ?? "food",
          description: vendor.description,
          address: vendor.address!,
          district: vendor.district!,
          city: vendor.city ?? market.city,
          phone: vendor.phone ?? "00000000",
          email: vendor.email,
          website: vendor.website,
          latitude: vendor.latitude ?? null,
          longitude: vendor.longitude ?? null,
          businessHours: restaurantBusinessHoursFromMarketOpeningHours(
            market.openingHours,
          ),
        });
        restaurantId = restaurant.id;
        restaurantName = restaurant.name;
        status = "created";
        createdRestaurants += 1;
      } else {
        const restaurant = await restaurantsService.getRestaurant(restaurantId);
        if (!restaurant || !restaurant.isActive) {
          skipped += 1;
          issues.push({
            index,
            code: "restaurant_not_found",
            severity: "blocking",
            message: "Restaurant was not found or is inactive",
            restaurantId,
            restaurantName,
          });
          results.push({
            status: "skipped",
            reason: "restaurant_not_found",
            restaurantId,
            restaurantName,
            stallNumber: vendor.stallNumber ?? null,
            locationLabel: vendor.locationLabel ?? null,
            mapPosition: vendor.mapPosition ?? null,
          });
          continue;
        }
        restaurantName = restaurant.name;
      }

      const memberships =
        await marketsService.listRestaurantMemberships(restaurantId);
      if (
        status === "attached" &&
        memberships.memberships.some((membership) => membership.marketId === id)
      ) {
        skipped += 1;
        issues.push({
          index,
          code: "already_attached",
          severity: "blocking",
          message: "Restaurant already belongs to this market",
          restaurantId,
          restaurantName,
        });
        results.push({
          status: "skipped",
          reason: "already_attached",
          restaurantId,
          restaurantName,
          stallNumber: vendor.stallNumber ?? null,
          locationLabel: vendor.locationLabel ?? null,
          mapPosition: vendor.mapPosition ?? null,
        });
        continue;
      }

      const membership = await marketsService.addVendor(id, {
        restaurantId,
        stallNumber: vendor.stallNumber,
        locationLabel: vendor.locationLabel,
        mapPosition: vendor.mapPosition,
        marketHours: vendor.marketHours,
        isPrimary: vendor.isPrimary,
      });

      if (!membership) {
        skipped += 1;
        results.push({
          status: "skipped",
          reason: "market_not_found",
          restaurantId,
          restaurantName,
          stallNumber: vendor.stallNumber ?? null,
          locationLabel: vendor.locationLabel ?? null,
          mapPosition: vendor.mapPosition ?? null,
        });
        continue;
      }

      await sync.onMarketMembershipChanged(restaurantId);
      attachedVendors += 1;
      results.push({
        status,
        restaurantId,
        restaurantName,
        membershipId: membership.id,
        stallNumber: membership.stallNumber,
        locationLabel: membership.locationLabel,
        mapPosition: membership.mapPosition,
      });
    }

    const [catalogReadiness, publicReadiness] = await Promise.all([
      marketsService.getCatalogReadiness(id),
      marketsService.getPublicReadiness(id),
    ]);

    return c.json({
      success: true,
      data: {
        createdRestaurants,
        attachedVendors,
        skipped,
        issueCount: issues.length,
        blockingIssueCount: issues.filter(
          (issue) => issue.severity === "blocking",
        ).length,
        warningIssueCount: issues.filter(
          (issue) => issue.severity === "warning",
        ).length,
        issues,
        catalogReadiness,
        publicReadiness,
        results,
      },
    });
  },
);

routes.delete(
  "/:id/vendors/:restaurantId",
  validateParams(marketVendorParamSchema),
  async (c) => {
    const { id, restaurantId } = c.get("validatedParams");
    const service = new MarketsService(c.env.DB, c.env.CACHE_KV);
    const removed = await service.removeVendor(id, restaurantId);

    if (removed) {
      const sync = createSearchIndexSync(c.env);
      await sync.onMarketMembershipChanged(restaurantId);
    }

    return c.json({ success: true, data: { removed } });
  },
);

export default routes;
