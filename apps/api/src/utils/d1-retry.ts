/**
 * Retry for transient D1 failures.
 *
 * The messages are the ones Cloudflare lists as retryable
 * (developers.cloudflare.com/d1/best-practices/retry-queries). D1 already
 * retries read-only queries twice on its own, so this is the layer above that,
 * for unattended paths where one blip would otherwise page a human.
 *
 * Only wrap idempotent work. A retry after "Network connection lost" may run a
 * write that already landed, so anything that creates rows or moves money
 * must not go through here.
 */

const RETRYABLE_D1_MESSAGES = [
  "Network connection lost",
  "storage caused object to be reset",
  "reset because its code was updated",
];

/** Walks `cause`: Drizzle wraps the D1 error as "Failed query: ...". */
export function isRetryableD1Error(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    const message =
      current instanceof Error ? current.message : String(current);
    if (RETRYABLE_D1_MESSAGES.some((m) => message.includes(m))) return true;
    current = current instanceof Error ? current.cause : undefined;
  }
  return false;
}

export interface D1RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withD1Retry<T>(
  operation: () => PromiseLike<T>,
  { retries = 2, baseDelayMs = 200, sleep = defaultSleep }: D1RetryOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryableD1Error(error)) throw error;
      // Exponential backoff with full jitter, as Cloudflare recommends.
      await sleep(Math.random() * baseDelayMs * 2 ** attempt);
    }
  }
}
