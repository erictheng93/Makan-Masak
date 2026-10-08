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

/**
 * 市集匯入時新建店家的國別：沿用市集的國別，並與店家城市核對。兩者都
 * 推不出來就拒絕——沒有國別的店會繞過所有國家層上限政策（spec §4.4）。
 */
export function vendorCountry(
  marketCountry: SupportedCountryCode | null,
  city: string,
): SupportedCountryCode {
  const fromCity = countryForCity(city);
  if (marketCountry && fromCity && marketCountry !== fromCity) {
    throw new ApiError(
      "RESTAURANT_COUNTRY_CITY_MISMATCH",
      "The vendor's city is not in the market's country",
      400,
      { countryCode: marketCountry, city },
    );
  }
  const country = marketCountry ?? fromCity;
  if (!country) {
    throw new ApiError(
      "RESTAURANT_COUNTRY_REQUIRED",
      "Cannot tell which country this vendor is in; set the market's country first",
      400,
      { city },
    );
  }
  return country;
}
