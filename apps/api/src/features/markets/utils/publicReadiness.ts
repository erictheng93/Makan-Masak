import { marketOpeningHoursSchema } from "../schemas/opening-hours";

export type MarketPublicReadinessIssueKey =
  | "description"
  | "location"
  | "openingHours"
  | "image"
  | "map"
  | "vendors"
  | "products"
  | "services";

export interface MarketPublicReadinessIssue {
  key: MarketPublicReadinessIssueKey;
  severity: "required" | "recommended";
}

export interface MarketPublicReadinessInput {
  description?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  openingHours?: unknown;
  bannerUrl?: string | null;
  logoUrl?: string | null;
  imageUrls?: string[] | null;
  mapLayout?: {
    title?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
  vendorCount: number;
  searchableProductCount?: number;
  publicServiceCount?: number;
}

export interface MarketPublicReadinessResult {
  score: number;
  ready: boolean;
  completedCount: number;
  totalCount: number;
  issues: MarketPublicReadinessIssue[];
}

export function evaluateMarketPublicReadiness(
  input: MarketPublicReadinessInput,
): MarketPublicReadinessResult {
  const checks = [
    {
      key: "description" as const,
      severity: "required" as const,
      passed: hasText(input.description),
    },
    {
      key: "location" as const,
      severity: "required" as const,
      passed:
        hasText(input.city) &&
        hasText(input.district) &&
        hasText(input.address) &&
        typeof input.latitude === "number" &&
        typeof input.longitude === "number",
    },
    {
      key: "openingHours" as const,
      severity: "required" as const,
      passed: hasOpeningHours(input.openingHours),
    },
    {
      key: "image" as const,
      severity: "recommended" as const,
      passed:
        hasText(input.bannerUrl) ||
        hasText(input.logoUrl) ||
        (input.imageUrls ?? []).some(hasText),
    },
    {
      key: "map" as const,
      severity: "recommended" as const,
      passed: hasMapLayout(input.mapLayout),
    },
    {
      key: "vendors" as const,
      severity: "required" as const,
      passed: input.vendorCount > 0,
    },
    {
      key: "products" as const,
      severity: "required" as const,
      passed:
        (input.searchableProductCount ?? 0) > 0 ||
        (input.publicServiceCount ?? 0) > 0,
    },
    {
      key: "services" as const,
      severity: "recommended" as const,
      passed: (input.publicServiceCount ?? 0) > 0,
    },
  ];

  const completedCount = checks.filter((check) => check.passed).length;
  const issues = checks
    .filter((check) => !check.passed)
    .map(({ key, severity }) => ({ key, severity }));

  return {
    score: Math.round((completedCount / checks.length) * 100),
    ready: issues.every((issue) => issue.severity !== "required"),
    completedCount,
    totalCount: checks.length,
    issues,
  };
}

function hasMapLayout(value: MarketPublicReadinessInput["mapLayout"]): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    hasText(value.title) ||
    hasText(value.description) ||
    hasText(value.imageUrl)
  );
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOpeningHours(value: unknown): boolean {
  const result = marketOpeningHoursSchema.safeParse(value);
  return (
    result.success &&
    Object.values(result.data).some((day) => day && day.closed !== true)
  );
}
