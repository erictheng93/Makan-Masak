import { computed, ref, type ComputedRef } from "vue";

/**
 * Which built-but-unlaunched features the API currently has switched off.
 *
 * The API declares this in shared/feature-adoption.ts and serves it from
 * GET /info, so the UI can present an unlaunched feature as unavailable rather
 * than offering a control whose request the API refuses.
 *
 * Mirrors apps/admin-dashboard/src/composables/useFeatureAvailability.ts. The
 * two are kept separate rather than shared because these apps deploy
 * independently and have no common frontend package; if a third app needs it,
 * that is the point to extract one.
 */

/** Mirrors the keys of UNLAUNCHED_FEATURES in the API. */
export type UnlaunchedFeature =
  | "storedValueCredits"
  | "tenantBackups"
  | "marketCheckouts"
  | "webPush"
  | "customerWebPush";

interface DisabledFeatureEntry {
  feature: string;
  flag: string;
  prefix: string;
}

const disabled = ref<ReadonlySet<string>>(new Set());
let inFlight: Promise<void> | null = null;

/**
 * `/info` sits at the app root, not under the versioned API base, so it cannot
 * go through the shared client. Derived from the configured base so a deploy
 * pointing at a different origin still resolves.
 */
function infoUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL || "/api/v1";
  return `${base.replace(/\/api\/v1\/?$/, "")}/info`;
}

async function load(): Promise<void> {
  try {
    const response = await fetch(infoUrl(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return;

    const body = (await response.json()) as {
      disabledFeatures?: DisabledFeatureEntry[];
    };
    disabled.value = new Set(
      (body.disabledFeatures ?? []).map((entry) => entry.feature),
    );
  } catch {
    // Fails open on purpose. Hiding a working feature because /info was briefly
    // unreachable is worse than the reverse: the API's own gate is what
    // actually enforces availability, and this is only presentation.
  }
}

/** Idempotent; concurrent callers share one request. */
export function loadFeatureAvailability(): Promise<void> {
  inFlight ??= load();
  return inFlight;
}

export function useFeatureAvailability(): {
  isDisabled: (feature: UnlaunchedFeature) => boolean;
  disabledFeatures: ComputedRef<ReadonlySet<string>>;
} {
  void loadFeatureAvailability();

  return {
    isDisabled: (feature: UnlaunchedFeature) => disabled.value.has(feature),
    disabledFeatures: computed(() => disabled.value),
  };
}

/** Test seam: resets the module-level cache between cases. */
export function __resetFeatureAvailability(): void {
  disabled.value = new Set();
  inFlight = null;
}
