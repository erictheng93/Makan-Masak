/**
 * 入駐時選定的國別，是這家店所有地區性預設值的唯一來源。
 *
 * 開通前沒有任何地方決定一家店在哪裡：provisioning 把 city 寫死成「台中市」，
 * 也完全不寫 settings，於是幣別靠預設值落回 TWD、時區留空。國別一旦在申請
 * 表選定，幣別、時區、電話前綴、可用金流、發票制度就都有了依據。
 */
export type SupportedCountryCode = "TW" | "MY";

export const SUPPORTED_COUNTRIES = [
  "TW",
  "MY",
] as const satisfies readonly SupportedCountryCode[];

export interface CountryProfile {
  countryCode: SupportedCountryCode;
  /** 必須是 packages/utils/src/currency.ts 的 CurrencyCode */
  currency: "TWD" | "MYR";
  /** 必須是 business-timezone.ts 支援的固定時區 */
  timezone: "Asia/Taipei" | "Asia/Kuala_Lumpur";
  phonePrefix: string;
  cities: readonly string[];
}

const TW_CITIES = [
  "臺北市",
  "新北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
  // production 既有資料用的是「台中市」（異體字），保留以免既有店家對不上。
  "台中市",
] as const;

const MY_CITIES = [
  "Kuala Lumpur",
  "Putrajaya",
  "Labuan",
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Penang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
] as const;

export const COUNTRY_PROFILES: Record<SupportedCountryCode, CountryProfile> = {
  TW: {
    countryCode: "TW",
    currency: "TWD",
    timezone: "Asia/Taipei",
    phonePrefix: "+886",
    cities: TW_CITIES,
  },
  MY: {
    countryCode: "MY",
    currency: "MYR",
    timezone: "Asia/Kuala_Lumpur",
    phonePrefix: "+60",
    cities: MY_CITIES,
  },
};

/** 把不可信的值收斂成支援的國別，不支援就回 null（呼叫端決定要擋還是套預設）。 */
export const normalizeCountryCode = (
  value: unknown,
): SupportedCountryCode | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(code)
    ? (code as SupportedCountryCode)
    : null;
};

export const citiesForCountry = (
  country: SupportedCountryCode,
): readonly string[] => COUNTRY_PROFILES[country].cities;
