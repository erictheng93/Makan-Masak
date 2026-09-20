import { Hono } from "hono";
import { markets } from "@makanmasak/database";
import {
  citiesForCountry,
  normalizeCountryCode,
} from "@makanmasak/shared-types";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { ApiError, badRequest } from "@makanmasak/utils";
import type { ManagementEnv } from "../types";

const marketsRouter = new Hono<{ Bindings: ManagementEnv }>();
const adminMarketsRouter = new Hono<{ Bindings: ManagementEnv }>();

function boundedInteger(
  value: string | undefined,
  fallback: number,
  maximum?: number,
) {
  const parsed = Number(value);
  const lowerBounded = Number.isSafeInteger(parsed)
    ? Math.max(parsed, 1)
    : fallback;
  return maximum === undefined ? lowerBounded : Math.min(lowerBounded, maximum);
}

marketsRouter.get("/", async (c) => {
  const limit = boundedInteger(c.req.query("limit"), 50, 100);
  const maximumPage = Math.floor(Number.MAX_SAFE_INTEGER / limit) + 1;
  const page = boundedInteger(c.req.query("page"), 1, maximumPage);
  const countryQuery = c.req.query("country");
  const country = countryQuery ? normalizeCountryCode(countryQuery) : undefined;
  const city = c.req.query("city")?.trim() || undefined;
  const type = c.req.query("type")?.trim() || undefined;

  if (countryQuery && !country) {
    throw badRequest("Unsupported country", "UNSUPPORTED_COUNTRY");
  }
  if (country && city && !citiesForCountry(country).includes(city)) {
    throw badRequest(
      "City is not in the selected country",
      "CITY_NOT_IN_COUNTRY",
    );
  }
  if (!c.env.PLATFORM_DB) {
    throw new ApiError(
      "PLATFORM_DB_UNAVAILABLE",
      "Platform database is unavailable",
      500,
    );
  }

  const db = drizzle(c.env.PLATFORM_DB);
  const where = and(
    eq(markets.isActive, true),
    isNull(markets.deletedAt),
    country ? inArray(markets.city, citiesForCountry(country)) : undefined,
    city ? eq(markets.city, city) : undefined,
    type ? eq(markets.type, type) : undefined,
  );
  const [marketRows, totalRows] = await Promise.all([
    db
      .select({
        id: markets.id,
        slug: markets.slug,
        name: markets.name,
        type: markets.type,
        city: markets.city,
        district: markets.district,
      })
      .from(markets)
      .where(where)
      .orderBy(markets.name)
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ value: count() }).from(markets).where(where),
  ]);

  return c.json({
    success: true,
    data: {
      markets: marketRows,
      total: totalRows[0]?.value ?? 0,
      page,
      limit,
    },
  });
});

adminMarketsRouter.get("/join-requests", (c) => {
  return c.json({
    success: true,
    data: {
      requests: [],
      status: c.req.query("status"),
    },
  });
});

adminMarketsRouter.get("/vendor-candidates", (c) => {
  return c.json({
    success: true,
    data: {
      restaurants: [],
      total: 0,
      query: c.req.query("q") ?? "",
    },
  });
});

export { marketsRouter, adminMarketsRouter };
