import { computed, ref, type ComputedRef } from "vue";
import { hasCustomerAccessToken } from "@/services/customerAccessToken";

/**
 * Following markets and restaurants (#335).
 *
 * `customer_favorites` is the table the marketing broadcast fan-out reads to
 * build its audience, so "follow" and "favorite" are the same row — there is no
 * second table and no second concept. Only the two target types a broadcast can
 * be scoped to are tracked here; `dish` favorites live in the same table but
 * belong to a different feature and are filtered out so they can never appear in
 * a followed list or be counted as an audience.
 *
 * State is module-level on purpose. A discovery page mounts twenty
 * `FollowButton`s and a market page mounts one per vendor row; each of them
 * asking the server whether this diner follows it would turn one screen into
 * twenty round trips. They share one unfiltered GET instead.
 */
export type FollowTargetType = "market" | "restaurant";

export interface FollowedTarget {
  targetType: FollowTargetType;
  targetId: string;
  /**
   * The `customer_favorites` row id, which is what DELETE addresses. `null`
   * while an optimistic follow is still in flight: the id only exists once the
   * POST answers.
   */
  favoriteId: number | null;
  createdAtMs: number;
}

const FOLLOW_TARGET_TYPES: readonly FollowTargetType[] = [
  "market",
  "restaurant",
];

const entries = ref<Record<string, FollowedTarget>>({});
const loaded = ref(false);
const loading = ref(false);
const loadFailed = ref(false);
let inFlight: Promise<void> | null = null;

type IdentityApi =
  (typeof import("@/services/customerIdentityApi"))["customerIdentityApi"];

let identityApi: IdentityApi | null = null;

/**
 * Reached through a dynamic import rather than a top-level one. `FollowButton`
 * is mounted inside `RestaurantCard` and `MarketDetailHero`, which a dozen
 * component tests mount without mocking the service layer; a static import
 * would drag `@/services/api` into all of those graphs, and that module throws
 * at import time when `VITE_API_BASE_URL` is unset — which it is under vitest,
 * since `.env.development` is not loaded in test mode. Several existing tests
 * document keeping that module out of the graph deliberately, so this follows
 * the same rule instead of stubbing the variable everywhere.
 */
async function api(): Promise<IdentityApi> {
  identityApi ??= (await import("@/services/customerIdentityApi"))
    .customerIdentityApi;
  return identityApi;
}

const keyOf = (targetType: FollowTargetType, targetId: string): string =>
  `${targetType}:${targetId}`;

const isFollowTargetType = (value: string): value is FollowTargetType =>
  (FOLLOW_TARGET_TYPES as readonly string[]).includes(value);

/**
 * Whether a customer session is plausibly in hand, asked without reaching for
 * the pinia store: `FollowButton` renders inside cards that are mounted in
 * several places with no pinia installed, and `useAuthStore()` throws there.
 *
 * The access token alone is not enough. It is deliberately never persisted, so
 * for the first moment after a reload a signed-in diner has none — it is
 * restored from the HttpOnly refresh cookie asynchronously. The persisted user
 * record covers that window. A wrong "yes" costs one 401 the api client already
 * handles; a wrong "no" would send a signed-in diner to the login screen.
 */
export function hasCustomerSession(): boolean {
  if (hasCustomerAccessToken()) return true;
  try {
    return localStorage.getItem("customer_user") !== null;
  } catch {
    return false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const rows = await (await api()).listFavorites();
    const next: Record<string, FollowedTarget> = {};
    for (const row of rows ?? []) {
      if (!isFollowTargetType(row.targetType)) continue;
      next[keyOf(row.targetType, row.targetId)] = {
        targetType: row.targetType,
        targetId: row.targetId,
        favoriteId: row.id,
        createdAtMs: row.createdAtMs,
      };
    }
    entries.value = next;
    loaded.value = true;
    loadFailed.value = false;
  } catch (error) {
    // Swallowed rather than rethrown: a follow button whose list failed to load
    // still works. It renders as "not following", and POST /favorites is
    // idempotent — it answers with the existing row, which repopulates the id
    // the unfollow needs.
    loadFailed.value = true;
    console.warn("Failed to load followed targets:", error);
  } finally {
    loading.value = false;
    inFlight = null;
  }
}

function ensureLoaded(): Promise<void> {
  if (loaded.value) return Promise.resolve();
  inFlight ??= load();
  return inFlight;
}

/** Discards the cached list. Called on logout so the next diner starts clean. */
export function resetFollowing(): void {
  entries.value = {};
  loaded.value = false;
  loading.value = false;
  loadFailed.value = false;
  inFlight = null;
}

function sortedOfType(targetType: FollowTargetType): FollowedTarget[] {
  return Object.values(entries.value)
    .filter((entry) => entry.targetType === targetType)
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

async function follow(
  targetType: FollowTargetType,
  targetId: string,
): Promise<void> {
  const key = keyOf(targetType, targetId);
  entries.value[key] = {
    targetType,
    targetId,
    favoriteId: null,
    createdAtMs: Date.now(),
  };

  try {
    const row = await (
      await api()
    ).addFavorite({
      targetType,
      targetId,
    });
    entries.value[key] = {
      targetType,
      targetId,
      favoriteId: row?.id ?? null,
      createdAtMs: row?.createdAtMs ?? Date.now(),
    };
  } catch (error) {
    delete entries.value[key];
    throw error;
  }
}

async function unfollow(
  targetType: FollowTargetType,
  targetId: string,
): Promise<void> {
  const key = keyOf(targetType, targetId);
  const previous = entries.value[key];
  if (!previous) return;

  delete entries.value[key];

  // No row id means the follow that created it is still in flight, so there is
  // nothing to DELETE yet. Dropping the local entry is the whole of the undo:
  // the POST's own handler writes the row back on success, which is the state
  // the server holds either way.
  if (previous.favoriteId === null) return;

  try {
    await (await api()).removeFavorite(previous.favoriteId);
  } catch (error) {
    entries.value[key] = previous;
    throw error;
  }
}

export function useFollowing(): {
  ensureLoaded: () => Promise<void>;
  isLoaded: ComputedRef<boolean>;
  isLoading: ComputedRef<boolean>;
  loadFailed: ComputedRef<boolean>;
  isFollowing: (targetType: FollowTargetType, targetId: string) => boolean;
  toggle: (targetType: FollowTargetType, targetId: string) => Promise<boolean>;
  followedMarkets: ComputedRef<FollowedTarget[]>;
  followedRestaurants: ComputedRef<FollowedTarget[]>;
} {
  const isFollowing = (
    targetType: FollowTargetType,
    targetId: string,
  ): boolean => keyOf(targetType, targetId) in entries.value;

  /**
   * Flips the follow and resolves with the state the diner asked for. Reverts
   * and rethrows on failure so the caller can say so; the button's own state
   * comes back from `isFollowing`, never from a local copy.
   */
  const toggle = async (
    targetType: FollowTargetType,
    targetId: string,
  ): Promise<boolean> => {
    if (isFollowing(targetType, targetId)) {
      await unfollow(targetType, targetId);
      return false;
    }
    await follow(targetType, targetId);
    return true;
  };

  return {
    ensureLoaded,
    isLoaded: computed(() => loaded.value),
    isLoading: computed(() => loading.value),
    loadFailed: computed(() => loadFailed.value),
    isFollowing,
    toggle,
    followedMarkets: computed(() => sortedOfType("market")),
    followedRestaurants: computed(() => sortedOfType("restaurant")),
  };
}

export default useFollowing;
