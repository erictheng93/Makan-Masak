import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  notExists,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/sqlite-core";
import { restaurantMarketMemberships } from "../schema/markets";
import { restaurants } from "../schema/restaurants";
import {
  ApiError,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@makanmasak/utils";

// Match the server currency resolver's String.trim(), including legacy blanks.
const ECMASCRIPT_WHITESPACE =
  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/**
 * SQL counterpart for object/double-encoded settings in atomic money writes.
 * Deeper encodings return NULL: never misread an unresolved currency as TWD.
 */
export function restaurantCurrencySql(settings: SQLWrapper): SQL {
  return sql`CASE
    WHEN json_type(${settings}, '$') = 'text'
      AND json_type(json_extract(${settings}, '$'), '$') = 'text'
    THEN NULL
    ELSE upper(coalesce(
    nullif(trim(json_extract(${settings}, '$.currency'), ${ECMASCRIPT_WHITESPACE}), ''),
    nullif(trim(json_extract(json_extract(${settings}, '$'), '$.currency'), ${ECMASCRIPT_WHITESPACE}), ''),
    ${DEFAULT_CURRENCY}
  )) END`;
}

/**
 * Currency for read-only, cross-restaurant views.
 *
 * The source JSON predates the currency enum and can contain an invalid
 * legacy value. Money writes fail closed through `restaurantCurrencySql`'s
 * callers, but a platform listing must not either return an unsupported code
 * to its client or become unavailable because of one malformed row. This is
 * the SQL twin of `displayRestaurantCurrency`: absent or invalid settings are
 * labelled as the legacy default, TWD.
 */
export function displayRestaurantCurrencySql(
  settings: SQLWrapper,
): SQL<CurrencyCode> {
  // The inner resolver is itself a searched CASE expression. Parenthesize it
  // before using it as this simple CASE's selector; otherwise SQLite receives
  // the invalid token sequence `CASE CASE ...` (#411).
  return sql<CurrencyCode>`CASE (${restaurantCurrencySql(settings)})
    WHEN 'MYR' THEN 'MYR'
    WHEN 'VND' THEN 'VND'
    ELSE ${DEFAULT_CURRENCY}
  END`;
}

/**
 * Recheck all active peers in the write itself. This serializes currency
 * changes against attachments, including two first vendors joining at once.
 * A departed vendor no longer constrains a market's currency.
 */
export function marketCurrencyMatches(
  restaurantId: string,
  currency: SQL | string,
  marketId?: string,
): SQL {
  const peerMembership = alias(restaurantMarketMemberships, "peer_membership");
  const ownMembership = alias(restaurantMarketMemberships, "own_membership");
  const peerRestaurant = alias(restaurants, "peer_restaurant");
  const queryBuilder = new QueryBuilder();
  const marketScope = marketId
    ? eq(peerMembership.marketId, marketId)
    : inArray(
        peerMembership.marketId,
        queryBuilder
          .select({ marketId: ownMembership.marketId })
          .from(ownMembership)
          .where(
            and(
              eq(ownMembership.restaurantId, restaurantId),
              isNull(ownMembership.leftAt),
            ),
          ),
      );
  return notExists(
    queryBuilder
      .select({ id: peerMembership.id })
      .from(peerMembership)
      .innerJoin(
        peerRestaurant,
        eq(peerRestaurant.id, peerMembership.restaurantId),
      )
      .where(
        and(
          marketScope,
          isNull(peerMembership.leftAt),
          ne(peerMembership.restaurantId, restaurantId),
          sql`${restaurantCurrencySql(peerRestaurant.settings)} IS NOT ${currency}`,
        ),
      ),
  );
}

export function marketVendorCurrencyMismatch(currencies?: readonly string[]) {
  return new ApiError(
    "MARKET_VENDOR_CURRENCY_MISMATCH",
    "All vendors in a market must use the same currency",
    409,
    currencies ? { currencies: [...new Set(currencies)].sort() } : undefined,
  );
}
