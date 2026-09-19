import type { Env } from "../types/env";
import { queryMarketCheckoutProviderSplitStatus } from "../features/market-checkouts/services/MarketCheckoutPaymentProvider";
import { MarketCheckoutPaymentReconciliationService } from "../features/market-checkouts/services/MarketCheckoutPaymentReconciliationService";

const DEFAULT_PENDING_AFTER_MS = 30 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 25;

export interface MarketCheckoutReconciliationWorkerOptions {
  nowMs?: number;
  pendingAfterMs?: number;
  limit?: number;
  fetcher?: typeof fetch;
}

export interface MarketCheckoutReconciliationWorkerResult {
  scanned: number;
  reconciled: number;
  failed: number;
  skipped: number;
  skippedReason?: string;
  durationMs: number;
  results: Array<{
    checkoutId: string;
    paymentId: string;
    status?: string;
    error?: string;
  }>;
}

export async function reconcilePendingMarketCheckoutPayments(
  env: Env,
  options: MarketCheckoutReconciliationWorkerOptions = {},
): Promise<MarketCheckoutReconciliationWorkerResult> {
  const startedAt = Date.now();
  if (
    env.MARKET_CHECKOUT_SPLIT_MODE !== "provider_split" ||
    !env.MARKET_CHECKOUT_PROVIDER_STATUS_URL
  ) {
    return {
      scanned: 0,
      reconciled: 0,
      failed: 0,
      skipped: 0,
      skippedReason: "provider_status_lookup_not_configured",
      durationMs: Date.now() - startedAt,
      results: [],
    };
  }

  const reconciliationService = new MarketCheckoutPaymentReconciliationService(
    env,
  );
  const nowMs = options.nowMs ?? Date.now();
  const pendingAfterMs = options.pendingAfterMs ?? DEFAULT_PENDING_AFTER_MS;
  const inputs = await reconciliationService.listPendingStatusLookupInputs({
    updatedBeforeMs: nowMs - pendingAfterMs,
    limit: options.limit ?? DEFAULT_BATCH_LIMIT,
  });

  let reconciled = 0;
  let failed = 0;
  let skipped = 0;
  const results: MarketCheckoutReconciliationWorkerResult["results"] = [];

  for (const input of inputs) {
    try {
      const providerStatus = await queryMarketCheckoutProviderSplitStatus(
        env,
        input,
        options.fetcher ?? fetch,
      );
      const reconciliation = await reconciliationService.reconcile(
        input.checkoutId,
        providerStatus,
      );
      if (reconciliation.reviewRequired) {
        // Held, not applied: the provider's money did not match the payment.
        failed += 1;
        results.push({
          checkoutId: input.checkoutId,
          paymentId: input.paymentId,
          error: `Provider amount held for review: ${reconciliation.reviewReason}`,
        });
        continue;
      }
      if (reconciliation.status === "pending") {
        skipped += 1;
      } else {
        reconciled += 1;
      }
      results.push({
        checkoutId: input.checkoutId,
        paymentId: input.paymentId,
        status: reconciliation.status,
      });
    } catch (error) {
      failed += 1;
      results.push({
        checkoutId: input.checkoutId,
        paymentId: input.paymentId,
        error:
          error instanceof Error
            ? error.message
            : "Market checkout reconciliation failed",
      });
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log("marketCheckoutReconciliation.batch", {
    scanned: inputs.length,
    reconciled,
    failed,
    skipped,
    durationMs,
  });

  return {
    scanned: inputs.length,
    reconciled,
    failed,
    skipped,
    durationMs,
    results,
  };
}
