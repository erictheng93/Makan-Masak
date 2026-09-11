import type { WaitingListResponse } from "@makanmasak/shared-types";
import { sql } from "drizzle-orm";
import { BaseService, isWebPushEnabled } from "./base";

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  failure_count: number;
}

interface DeliverySubscription {
  id: string;
  endpoint: string;
  p256dhKey: string;
  authKey: string;
}

interface WebPushDelivery {
  subscription: DeliverySubscription;
  payload: Record<string, unknown>;
}

interface DeliveryResult {
  ok: boolean;
  status: number;
}

type Bytes = Uint8Array<ArrayBuffer>;

export interface CustomerPushDispatchResult {
  targeted: number;
  sent: number;
  failed: number;
  stale: number;
  skipped: boolean;
}

const textEncoder = new TextEncoder();
const WEB_PUSH_TTL_SECONDS = 5 * 60;
const WEB_PUSH_RECORD_SIZE = 4096;

export class CustomerWebPushService extends BaseService {
  async sendWaitingCalled(
    ticket: WaitingListResponse,
  ): Promise<CustomerPushDispatchResult> {
    if (!isWebPushEnabled(this.env) || !ticket.customerId) {
      return emptyResult(true);
    }

    const subscriptions = await this.loadWaitingListSubscriptions(
      ticket.customerId,
    );
    if (subscriptions.length === 0) {
      return emptyResult(true);
    }

    const payload = buildWaitingCalledPayload(ticket);
    let sent = 0;
    let failed = 0;
    let stale = 0;

    await Promise.all(
      subscriptions.map(async (subscription) => {
        const deliverySubscription = toDeliverySubscription(subscription);
        try {
          const result = await this.deliver({
            subscription: deliverySubscription,
            payload,
          });

          if (result.ok) {
            sent += 1;
            await this.markSuccess(subscription.id);
            return;
          }

          failed += 1;
          if (result.status === 404 || result.status === 410) {
            stale += 1;
          }
          await this.markFailure(subscription.id);
        } catch (error) {
          failed += 1;
          await this.markFailure(subscription.id);
          console.error("Customer web push delivery failed:", error);
        }
      }),
    );

    return {
      targeted: subscriptions.length,
      sent,
      failed,
      stale,
      skipped: false,
    };
  }

  /**
   * Deliver one arbitrary payload to one already-resolved subscription, doing
   * the same failure bookkeeping `sendWaitingCalled` does.
   *
   * Exists so marketing broadcasts (#335) reuse the VAPID signing and aes128gcm
   * encryption below instead of growing a second copy, while the audience,
   * consent and quiet-hours rules stay in the API feature that owns them.
   *
   * A 404 or 410 from the push service means the browser threw the
   * subscription away. That is reported to the caller as the status, and
   * handled here the way every other failure is: `failure_count` is
   * incremented, which takes the subscription out of every load query at 3 and
   * makes it eligible for the 90-day prune. Nothing is deleted on the spot —
   * a push service can 410 a subscription that a later re-subscribe revives
   * under the same endpoint.
   */
  async deliverToSubscription(
    subscription: DeliverySubscription,
    payload: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    try {
      const result = await this.deliver({ subscription, payload });
      if (result.ok) {
        await this.markSuccess(subscription.id);
      } else {
        await this.markFailure(subscription.id);
      }
      return result;
    } catch (error) {
      await this.markFailure(subscription.id);
      console.error("Customer web push delivery failed:", error);
      return { ok: false, status: 0 };
    }
  }

  private async loadWaitingListSubscriptions(
    customerId: string,
  ): Promise<PushSubscriptionRow[]> {
    const result = await this.db.all<PushSubscriptionRow>(sql`
      SELECT cps.id, cps.endpoint, cps.p256dh_key, cps.auth_key,
             cps.failure_count
        FROM customer_push_subscriptions cps
        LEFT JOIN customer_preferences cp
          ON cp.customer_id = cps.customer_id
       WHERE cps.customer_id = ${customerId}
         AND COALESCE(cp.waiting_list_opt_in, 1) = 1
         AND cps.failure_count < 3
    `);
    return result ?? [];
  }

  private async deliver(delivery: WebPushDelivery): Promise<DeliveryResult> {
    if (this.env.WEB_PUSH_DELIVERER) {
      return this.env.WEB_PUSH_DELIVERER(delivery);
    }

    const publicKey = this.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = this.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      return { ok: false, status: 0 };
    }

    return deliverWithFetch(delivery, {
      publicKey,
      privateKey,
      subject:
        this.env.WEB_PUSH_VAPID_SUBJECT ||
        this.env.NOTIFICATION_FROM_EMAIL ||
        "mailto:notifications@makanmasak.com",
    });
  }

  private async markSuccess(subscriptionId: string): Promise<void> {
    await this.db.run(sql`
      UPDATE customer_push_subscriptions
         SET last_used_at_ms = ${Date.now()},
             failure_count = 0
       WHERE id = ${subscriptionId}
    `);
  }

  private async markFailure(subscriptionId: string): Promise<void> {
    await this.db.run(sql`
      UPDATE customer_push_subscriptions
         SET last_used_at_ms = ${Date.now()},
             failure_count = failure_count + 1
       WHERE id = ${subscriptionId}
    `);
  }
}

function emptyResult(skipped: boolean): CustomerPushDispatchResult {
  return {
    targeted: 0,
    sent: 0,
    failed: 0,
    stale: 0,
    skipped,
  };
}

function buildWaitingCalledPayload(
  ticket: WaitingListResponse,
): Record<string, unknown> {
  const tableNumber = ticket.table?.number || String(ticket.tableId || "");
  return {
    type: "waiting_called",
    title: "候位已叫號",
    body: tableNumber
      ? `您的候位 ${ticket.queueDisplay} 已叫號，請前往 ${tableNumber}。`
      : `您的候位 ${ticket.queueDisplay} 已叫號，請準備入座。`,
    ticketId: ticket.id,
    restaurantId: ticket.restaurantId,
    queueDisplay: ticket.queueDisplay,
    tableId: ticket.tableId ?? null,
    tableNumber,
    url: `/r/${ticket.restaurantId}/wait-list/${ticket.id}`,
    tag: `waiting-${ticket.id}`,
  };
}

function toDeliverySubscription(
  row: PushSubscriptionRow,
): DeliverySubscription {
  return {
    id: row.id,
    endpoint: row.endpoint,
    p256dhKey: row.p256dh_key,
    authKey: row.auth_key,
  };
}

async function deliverWithFetch(
  delivery: WebPushDelivery,
  vapid: { publicKey: string; privateKey: string; subject: string },
): Promise<DeliveryResult> {
  const body = await encryptPayload(
    JSON.stringify(delivery.payload),
    delivery.subscription,
  );
  const token = await createVapidToken(delivery.subscription.endpoint, vapid);

  const response = await fetch(delivery.subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${token}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(WEB_PUSH_TTL_SECONDS),
    },
    body,
  });

  return { ok: response.ok, status: response.status };
}

async function encryptPayload(
  payload: string,
  subscription: DeliverySubscription,
): Promise<Bytes> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const receiverPublicKey = await crypto.subtle.importKey(
    "raw",
    base64UrlToUint8Array(subscription.p256dhKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const senderKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const senderPublicKey = new Uint8Array(
    (await crypto.subtle.exportKey("raw", senderKeys.publicKey)) as ArrayBuffer,
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverPublicKey } as Parameters<
        SubtleCrypto["deriveBits"]
      >[0],
      senderKeys.privateKey,
      256,
    ),
  );

  const authSecret = base64UrlToUint8Array(subscription.authKey);
  const ikm = await hmacSha256(authSecret, sharedSecret);
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdfExpand(prk, "Content-Encoding: nonce\0", 12);

  const plaintext = concatUint8Arrays(encodeUtf8(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      plaintext,
    ),
  );

  return concatUint8Arrays(
    salt,
    uint32BigEndian(WEB_PUSH_RECORD_SIZE),
    new Uint8Array([senderPublicKey.byteLength]),
    senderPublicKey,
    ciphertext,
  );
}

async function createVapidToken(
  endpoint: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(
    encodeUtf8(JSON.stringify({ typ: "JWT", alg: "ES256" })),
  );
  const claims = base64UrlEncode(
    encodeUtf8(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: now + 12 * 60 * 60,
        sub: normalizeVapidSubject(vapid.subject),
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const key = await importVapidPrivateKey(vapid.publicKey, vapid.privateKey);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encodeUtf8(unsigned),
    ),
  );
  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function importVapidPrivateKey(
  publicKey: string,
  privateKey: string,
): Promise<CryptoKey> {
  const publicBytes = base64UrlToUint8Array(publicKey);
  const privateBytes = base64UrlToUint8Array(privateKey);
  if (publicBytes.byteLength !== 65 || publicBytes[0] !== 4) {
    throw new Error("Invalid VAPID public key");
  }
  if (privateBytes.byteLength !== 32) {
    throw new Error("Invalid VAPID private key");
  }

  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(publicBytes.slice(1, 33)),
      y: base64UrlEncode(publicBytes.slice(33, 65)),
      d: base64UrlEncode(privateBytes),
      ext: false,
      key_ops: ["sign"],
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function hmacSha256(keyBytes: Bytes, data: Bytes): Promise<Bytes> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

async function hkdfExpand(
  prk: Bytes,
  info: string,
  length: number,
): Promise<Bytes> {
  const block = await hmacSha256(
    prk,
    concatUint8Arrays(encodeUtf8(info), new Uint8Array([1])),
  );
  return block.slice(0, length);
}

function normalizeVapidSubject(subject: string): string {
  if (subject.startsWith("mailto:") || subject.startsWith("https://")) {
    return subject;
  }
  if (subject.includes("@")) {
    return `mailto:${subject}`;
  }
  return subject;
}

function base64UrlToUint8Array(value: string): Bytes {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - base64.length) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(bytes: Bytes): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function uint32BigEndian(value: number): Bytes {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function concatUint8Arrays(...arrays: Bytes[]): Bytes {
  const length = arrays.reduce((sum, item) => sum + item.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  arrays.forEach((array) => {
    output.set(array, offset);
    offset += array.byteLength;
  });
  return output;
}

function encodeUtf8(value: string): Bytes {
  const encoded = textEncoder.encode(value);
  return new Uint8Array(encoded);
}

export type { DeliveryResult, DeliverySubscription, WebPushDelivery };
