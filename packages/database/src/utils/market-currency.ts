import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { ApiError, DEFAULT_CURRENCY } from "@makanmasak/utils";

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
 * Recheck all active peers in the write itself. This serializes currency
 * changes against attachments, including two first vendors joining at once.
 * A departed vendor no longer constrains a market's currency.
 */
export function marketCurrencyMatches(
  restaurantId: string,
  currency: SQL | string,
  marketId?: string,
): SQL {
  const marketScope = marketId
    ? sql`peer_membership.market_id = ${marketId}`
    : sql`peer_membership.market_id IN (
        SELECT own_membership.market_id FROM restaurant_market_memberships own_membership
        WHERE own_membership.restaurant_id = ${restaurantId}
          AND own_membership.left_at_ms IS NULL
      )`;
  return sql`NOT EXISTS (
    SELECT 1 FROM restaurant_market_memberships peer_membership
    JOIN restaurants peer_restaurant ON peer_restaurant.id = peer_membership.restaurant_id
    WHERE ${marketScope}
      AND peer_membership.left_at_ms IS NULL
      AND peer_membership.restaurant_id <> ${restaurantId}
      AND ${restaurantCurrencySql(sql`peer_restaurant.settings`)} IS NOT ${currency}
  )`;
}

export function marketVendorCurrencyMismatch(currencies?: readonly string[]) {
  return new ApiError(
    "MARKET_VENDOR_CURRENCY_MISMATCH",
    "All vendors in a market must use the same currency",
    409,
    currencies ? { currencies: [...new Set(currencies)].sort() } : undefined,
  );
}
