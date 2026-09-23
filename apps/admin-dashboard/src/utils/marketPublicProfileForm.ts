import type {
  MarketListItem,
  UpdateMarketPublicProfileInput,
} from "@/services/marketsService";
import {
  validateMarketOpeningHours,
  type MarketOpeningHoursIssue,
} from "@makanmasak/shared/utils/market-opening-hours";

export interface MarketPublicProfileForm {
  description: string;
  address: string;
  latitude: string;
  longitude: string;
  openingHoursText: string;
  mapTitle: string;
  mapDescription: string;
  mapImageUrl: string;
  mapWidth: string;
  mapHeight: string;
  bannerUrl: string;
  logoUrl: string;
  imageUrlsText: string;
  tagsText: string;
}

export function marketPublicProfileFormFromMarket(
  market: MarketListItem,
): MarketPublicProfileForm {
  return {
    description: market.description ?? "",
    address: market.address ?? "",
    latitude: market.latitude == null ? "" : String(market.latitude),
    longitude: market.longitude == null ? "" : String(market.longitude),
    openingHoursText: market.openingHours
      ? JSON.stringify(market.openingHours, null, 2)
      : "",
    mapTitle: market.mapLayout?.title ?? "",
    mapDescription: market.mapLayout?.description ?? "",
    mapImageUrl: market.mapLayout?.imageUrl ?? "",
    mapWidth:
      market.mapLayout?.width == null ? "" : String(market.mapLayout.width),
    mapHeight:
      market.mapLayout?.height == null ? "" : String(market.mapLayout.height),
    bannerUrl: market.bannerUrl ?? "",
    logoUrl: market.logoUrl ?? "",
    imageUrlsText: (market.imageUrls ?? []).join("\n"),
    tagsText: (market.tags ?? []).join(", "),
  };
}

export function buildMarketPublicProfilePayload(
  form: MarketPublicProfileForm,
): UpdateMarketPublicProfileInput {
  return {
    description: trimmedOrNull(form.description),
    address: requiredText(form.address, "Address"),
    latitude: parseCoordinate(form.latitude, "Latitude"),
    longitude: parseCoordinate(form.longitude, "Longitude"),
    openingHours: parseOpeningHours(form.openingHoursText),
    mapLayout: buildMapLayout(form),
    bannerUrl: trimmedOrNull(form.bannerUrl),
    logoUrl: trimmedOrNull(form.logoUrl),
    imageUrls: splitLines(form.imageUrlsText),
    tags: splitCommaValues(form.tagsText),
  };
}

function buildMapLayout(form: MarketPublicProfileForm) {
  const title = trimmedOrNull(form.mapTitle);
  const description = trimmedOrNull(form.mapDescription);
  const imageUrl = trimmedOrNull(form.mapImageUrl);
  const width = parseOptionalPositiveInteger(form.mapWidth, "Map width");
  const height = parseOptionalPositiveInteger(form.mapHeight, "Map height");

  if (!title && !description && !imageUrl && !width && !height) {
    return null;
  }

  return {
    title,
    description,
    imageUrl,
    width,
    height,
  };
}

function trimmedOrNull(value: string | number | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredText(
  value: string | number | null | undefined,
  label: string,
) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function parseCoordinate(value: string | number, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number`);
  }
  return parsed;
}

function parseOpeningHours(value: string | number | null | undefined) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null) return null;
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(openingHoursIssueMessage({ kind: "not_object" }));
    }
    const issues = validateMarketOpeningHours(parsed);
    if (issues.length > 0) {
      throw new Error(
        `營業時間格式不正確：${issues.map(openingHoursIssueMessage).join("；")}`,
      );
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Opening hours must be valid JSON");
    }
    throw error;
  }
}

function openingHoursIssueMessage(issue: MarketOpeningHoursIssue): string {
  switch (issue.kind) {
    case "not_object":
      return '營業時間必須是物件，例如 {"mon":{"open":"10:00","close":"22:00"}}';
    case "invalid_day_hours":
      return `星期 ${issue.day} 的營業時間必須是物件`;
    case "unknown_day":
      return `未知的星期「${issue.day}」`;
    case "invalid_time":
      return `星期 ${issue.day} 的 ${issue.field} 需為 HH:MM（00:00–23:59），收到 ${formatInvalidValue(issue.value)}`;
    case "missing_time":
      return `星期 ${issue.day} 缺少 ${issue.field} 時間，需填入 HH:MM`;
    case "invalid_closed":
      return `星期 ${issue.day} 的 closed 必須是 true 或 false，收到 ${formatInvalidValue(issue.value)}`;
    case "unknown_field":
      return `星期 ${issue.day} 含有不支援的欄位「${issue.field}」`;
  }
}

function formatInvalidValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return "非純量值";
}

function parseOptionalPositiveInteger(
  value: string | number | null | undefined,
  label: string,
) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function splitLines(value: string | number | null | undefined) {
  const items = String(value ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function splitCommaValues(value: string | number | null | undefined) {
  const items = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}
