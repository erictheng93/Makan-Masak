import {
  countryForCity,
  type SupportedCountryCode,
} from "@makanmasak/shared-types";
import { ApiError } from "../../../shared/utils/api-error";

/**
 * 市集國別：明確指定優先，否則由城市推導；兩者都有卻不一致就拒絕。
 * 推導不出來回 null（未知）；收平台費的市集由 assertMarketFeeWithinRegionCap
 * 要求必須有國別（spec D9）。
 */
export function resolveMarketCountry(input: {
  countryCode?: SupportedCountryCode | null;
  city: string;
}): SupportedCountryCode | null {
  const fromCity = countryForCity(input.city);
  if (input.countryCode && fromCity && input.countryCode !== fromCity) {
    throw new ApiError(
      "MARKET_COUNTRY_CITY_MISMATCH",
      "The market's country does not match its city",
      400,
      { countryCode: input.countryCode, city: input.city },
    );
  }
  return input.countryCode ?? fromCity;
}
