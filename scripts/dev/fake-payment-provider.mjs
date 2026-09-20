#!/usr/bin/env node
/**
 * Fake payment provider adapter for local end-to-end runs.
 *
 * Speaks the market-checkout provider adapter contract
 * (docs/runbooks/market-checkout-provider-adapter-handoff.md) — create_payment,
 * status_lookup, webhook_verification (it signs the webhooks it sends) and
 * refund — plus the credit top-up charge endpoint, so a local API
 * (`pnpm dev:api`) can run the real pay -> webhook -> paid -> refund flow
 * without any gateway. No dependencies beyond Node.
 *
 *   node scripts/dev/fake-payment-provider.mjs
 *
 * Environment (defaults in brackets):
 *   FAKE_PROVIDER_PORT              [8799]
 *   FAKE_PROVIDER_API_BASE          [http://127.0.0.1:8787]  the local API
 *   MARKET_CHECKOUT_WEBHOOK_SECRET  [fake-market-webhook-secret]
 *   MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET  optional; when set, adapter
 *                                   requests without a valid HMAC are refused
 *   CREDIT_TOPUP_WEBHOOK_SECRET     [fake-topup-webhook-secret]
 *
 * Customer confirmation is simulated by opening the redirect URL the adapter
 * hands out (or curl-ing it):
 *
 *   GET /confirm/<checkoutId>[?style=stripe|linepay|generic][&amount=<n>][&currency=<ISO>]
 *
 * which sends a signed webhook to the API and prints the API's answer. The
 * default style is `stripe` (amount in Stripe's unit: TWD/MYR minor units,
 * VND whole dong); `linepay` sends a LINE Pay confirm result in whole TWD.
 * `amount` overrides the amount in that style's unit (to try an underpayment),
 * `currency` overrides the currency (to try a wrong-currency payment).
 *
 *   GET /topups/confirm/<intentId>[?amountCents=<n>][&currency=<ISO>]
 *
 * does the same for a credit top-up intent.
 *
 *   POST /wallet
 *
 * is the per-shop e-wallet seam (`SHOP_WALLET_GATEWAY_URL`). It speaks the
 * `ShopWalletGatewayRequest` / `ShopWalletGatewayResponse` shapes from
 * apps/api/src/features/shop-payments/services/ShopWalletGateway.ts — one
 * endpoint for all three operations, keyed on `operation`. The request never
 * carries the shop's secrets; it carries `merchantId`, and an adapter is
 * expected to hold its own keys for that account.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_PROVIDER_PORT ?? 8799);
const API_BASE = (
  process.env.FAKE_PROVIDER_API_BASE ?? "http://127.0.0.1:8787"
).replace(/\/$/, "");
const WEBHOOK_SECRET =
  process.env.MARKET_CHECKOUT_WEBHOOK_SECRET ?? "fake-market-webhook-secret";
const SIGNING_SECRET =
  process.env.MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET;
const TOPUP_WEBHOOK_SECRET =
  process.env.CREDIT_TOPUP_WEBHOOK_SECRET ?? "fake-topup-webhook-secret";
const SELF = `http://127.0.0.1:${PORT}`;
const PROVIDER = "fake_provider";

/** Stripe's unit for our internal cents (docs.stripe.com/currencies). */
const STRIPE_UNITS_PER_CENT = { TWD: 1, MYR: 1, VND: 0.01 };

/** checkoutId -> what create_payment was asked for, and what happened. */
const payments = new Map();
/** intentId -> top-up charge */
const topups = new Map();

const hmacHex = (secret, value) =>
  createHmac("sha256", secret).update(value).digest("hex");
const hmacBase64 = (secret, value) =>
  createHmac("sha256", secret).update(value).digest("base64");

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function verifyAdapterRequest(req, raw) {
  if (!SIGNING_SECRET) return true;
  const timestamp = req.headers["x-market-checkout-signature-timestamp"];
  const signature = req.headers["x-market-checkout-signature"];
  return (
    typeof timestamp === "string" &&
    signature === hmacHex(SIGNING_SECRET, `${timestamp}.${raw}`)
  );
}

// ---- adapter contract ----------------------------------------------------

function createPayment(body) {
  const whole = body.amountMinor / 10 ** body.currencyExponent;
  log(
    `create_payment ${body.checkoutId}: ${body.currency} amountCents=${body.amountCents}`,
    `amountMinor=${body.amountMinor} exp=${body.currencyExponent} (= ${whole} ${body.currency})`,
  );
  const providerTransactionId = `pi_fake_${body.checkoutId}`;
  payments.set(body.checkoutId, {
    ...body,
    providerTransactionId,
    status: "pending",
  });
  return {
    provider: PROVIDER,
    providerTransactionId,
    status: "requires_action",
    authorizedAmountCents: 0,
    allocations: [],
    nextAction: {
      type: "redirect",
      redirectUrl: `${SELF}/confirm/${encodeURIComponent(body.checkoutId)}`,
    },
  };
}

function statusLookup(body) {
  const payment = payments.get(body.checkoutId);
  log(`status_lookup ${body.checkoutId}: ${payment?.status ?? "unknown"}`);
  if (!payment) return { provider: PROVIDER, status: "pending" };
  return {
    provider: PROVIDER,
    providerTransactionId: payment.providerTransactionId,
    status: payment.status,
    amountReceivedCents:
      payment.status === "pending" ? undefined : payment.amountCents,
    amountRefundedCents: payment.refundedAmountCents,
    currency: payment.currency,
    eventId: `lookup-${body.checkoutId}-${Date.now()}`,
    eventType: `market_checkout.payment_${payment.status}`,
  };
}

function refund(body) {
  const payment = payments.get(body.checkoutId);
  log(
    `refund ${body.checkoutId}: ${body.currency} amountCents=${body.amountCents} amountMinor=${body.amountMinor}`,
  );
  if (payment) {
    payment.status = "refunded";
    payment.refundedAmountCents = body.amountCents;
  }
  return {
    provider: PROVIDER,
    providerTransactionId: body.providerTransactionId,
    refundId: `re_fake_${body.checkoutId}`,
    status: "refunded",
    refundedAmountCents: body.amountCents,
    currency: body.currency,
    eventType: "market_checkout.payment_refunded",
  };
}

async function confirm(checkoutId, query) {
  const payment = payments.get(checkoutId);
  if (!payment) return { error: `unknown checkout ${checkoutId}` };
  const style = query.get("style") ?? "stripe";
  const currency = query.get("currency") ?? payment.currency;
  const override = query.has("amount") ? Number(query.get("amount")) : null;
  let route;
  let raw;
  let headers;

  if (style === "linepay") {
    const amount = override ?? payment.amountCents / 100;
    raw = JSON.stringify({
      returnCode: "0000",
      returnMessage: "Success.",
      currency,
      info: {
        orderId: `market_pay_${checkoutId}`,
        transactionId: payment.providerTransactionId,
        payInfo: [{ method: "CREDIT_CARD", amount }],
      },
    });
    const nonce = crypto.randomUUID();
    route = "linepay";
    headers = {
      "x-linepay-nonce": nonce,
      "x-linepay-signature": hmacBase64(
        WEBHOOK_SECRET,
        `${WEBHOOK_SECRET}${raw}${nonce}`,
      ),
    };
  } else if (style === "generic") {
    const amount = override ?? payment.amountCents;
    raw = JSON.stringify({
      id: `evt_fake_${checkoutId}_${Date.now()}`,
      type: "market_checkout.payment_paid",
      amount_cents: amount,
      currency,
      metadata: {
        marketCheckoutId: checkoutId,
        providerTransactionId: payment.providerTransactionId,
      },
    });
    route = PROVIDER;
    headers = { "x-webhook-signature": hmacHex(WEBHOOK_SECRET, raw) };
  } else {
    const unit = STRIPE_UNITS_PER_CENT[payment.currency] ?? 1;
    const amount = override ?? Math.round(payment.amountCents * unit);
    raw = JSON.stringify({
      id: `evt_fake_${checkoutId}_${Date.now()}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: payment.providerTransactionId,
          object: "payment_intent",
          amount,
          amount_received: amount,
          currency: currency.toLowerCase(),
          status: "succeeded",
          metadata: { marketCheckoutId: checkoutId },
        },
      },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    route = "stripe";
    headers = {
      "stripe-signature": `t=${timestamp},v1=${hmacHex(WEBHOOK_SECRET, `${timestamp}.${raw}`)}`,
    };
  }

  const url = `${API_BASE}/api/v1/market-checkouts/payment-webhooks/${route}`;
  log(`webhook -> ${url}\n${raw}`);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
  const answer = await response.json().catch(() => null);
  log(`webhook <- ${response.status} ${JSON.stringify(answer)}`);
  if (answer?.data?.status === "paid") payment.status = "paid";
  return {
    webhook: { url, body: JSON.parse(raw) },
    status: response.status,
    answer,
  };
}

// ---- credit top-up --------------------------------------------------------

function createTopupCharge(body) {
  log(
    `topup charge ${body.intentId}: ${body.currency} amountCents=${body.amountCents} amountMinor=${body.amountMinor}`,
  );
  topups.set(body.intentId, body);
  return {
    providerTransactionId: `ptxn_fake_${body.intentId}`,
    status: "requires_action",
    nextAction: {
      type: "redirect",
      redirectUrl: `${SELF}/topups/confirm/${encodeURIComponent(body.intentId)}`,
    },
  };
}

async function confirmTopup(intentId, query) {
  const charge = topups.get(intentId);
  if (!charge) return { error: `unknown intent ${intentId}` };
  const raw = JSON.stringify({
    intentId,
    providerTransactionId: `ptxn_fake_${intentId}`,
    status: "paid",
    amountCents: query.has("amountCents")
      ? Number(query.get("amountCents"))
      : charge.amountCents,
    currency: query.get("currency") ?? charge.currency,
  });
  const timestamp = new Date().toISOString();
  const url = `${API_BASE}/api/v1/credits/topup-webhooks/${PROVIDER}`;
  log(`topup webhook -> ${url}\n${raw}`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-credit-topup-signature-timestamp": timestamp,
      "x-credit-topup-signature": hmacHex(
        TOPUP_WEBHOOK_SECRET,
        `${timestamp}.${raw}`,
      ),
    },
    body: raw,
  });
  const answer = await response.json().catch(() => null);
  log(`topup webhook <- ${response.status} ${JSON.stringify(answer)}`);
  return { status: response.status, answer };
}

// ---- per-shop e-wallet seam ----------------------------------------------

/**
 * One endpoint for charge / refund / status against a shop's own wallet.
 *
 * A charge answers with a redirect, so the same `/confirm/<checkoutId>` route
 * that drives the platform adapter drives this one too — confirm with
 * `?style=generic`, which posts a signed `market_checkout.payment_paid`.
 */
function walletOperation(body) {
  const reference = String(body.reference ?? "");
  log(
    `wallet ${body.operation} ${body.provider} ${reference}:`,
    `${body.currency} amountCents=${body.amountCents}`,
    `providerAmount=${body.providerAmount} amountMinor=${body.amountMinor}`,
    `exp=${body.currencyExponent} merchant=${body.merchantId}`,
  );
  if (body.credentials !== undefined) {
    // Loud, because the whole point of the seam is that secrets stay inside
    // the Worker: an adapter over HTTP must never be handed them.
    log("WARNING: wallet request carried a `credentials` field");
  }

  const providerTransactionId = `tng_fake_${reference}`;
  if (body.operation === "refund") {
    const payment = payments.get(reference);
    if (payment) {
      payment.status = "refunded";
      payment.refundedAmountCents = body.amountCents;
    }
    return {
      providerTransactionId:
        body.providerTransactionId ?? providerTransactionId,
      status: "refunded",
      refundId: `tng_re_${reference}`,
      providerAmount: body.providerAmount,
      currency: body.currency,
    };
  }

  if (body.operation === "status") {
    const payment = payments.get(reference);
    return {
      providerTransactionId:
        body.providerTransactionId ?? providerTransactionId,
      status: payment?.status === "paid" ? "paid" : "pending",
      ...(payment?.status === "paid"
        ? { providerAmount: body.providerAmount, currency: body.currency }
        : {}),
    };
  }

  payments.set(reference, {
    checkoutId: reference,
    amountCents: body.amountCents,
    amountMinor: body.amountMinor,
    currencyExponent: body.currencyExponent,
    currency: body.currency,
    providerTransactionId,
    status: "pending",
  });
  return {
    providerTransactionId,
    status: "requires_action",
    nextAction: {
      type: "redirect",
      redirectUrl: `${SELF}/confirm/${encodeURIComponent(reference)}`,
    },
  };
}

// ---- server ---------------------------------------------------------------

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", SELF);
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        message: "Fake provider ready",
        capabilities: [
          "create_payment",
          "status_lookup",
          "webhook_verification",
          "refund",
          "shop_wallet",
        ],
      });
    }
    if (req.method === "GET" && url.pathname.startsWith("/confirm/")) {
      const id = decodeURIComponent(url.pathname.slice("/confirm/".length));
      return send(res, 200, await confirm(id, url.searchParams));
    }
    if (req.method === "GET" && url.pathname.startsWith("/topups/confirm/")) {
      const id = decodeURIComponent(
        url.pathname.slice("/topups/confirm/".length),
      );
      return send(res, 200, await confirmTopup(id, url.searchParams));
    }
    if (req.method !== "POST") return send(res, 404, { error: "not found" });

    const raw = await readBody(req);
    if (!verifyAdapterRequest(req, raw)) {
      log(`rejected unsigned request to ${url.pathname}`);
      return send(res, 401, { error: "invalid signature" });
    }
    const body = JSON.parse(raw || "{}");
    switch (url.pathname) {
      case "/payments":
        return send(res, 200, createPayment(body));
      case "/status":
        return send(res, 200, statusLookup(body));
      case "/refunds":
        return send(res, 200, refund(body));
      case "/topups":
        return send(res, 200, createTopupCharge(body));
      case "/wallet":
        return send(res, 200, walletOperation(body));
      default:
        return send(res, 404, { error: "not found" });
    }
  } catch (error) {
    log("error", error);
    return send(res, 500, { error: "Internal server error" });
  }
}).listen(PORT, "127.0.0.1", () => {
  log(`fake payment provider on ${SELF}, webhooks -> ${API_BASE}`);
});
