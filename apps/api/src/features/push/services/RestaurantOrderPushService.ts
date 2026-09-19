import type { Env } from "../../../types/env";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { isWebPushEnabled, restaurants } from "@makanmasak/database";
import {
  formatCurrency,
  normalizeCurrencyCode,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@makanmasak/utils";

interface PushSubscriptionRecord {
  id: string;
  restaurantId: string | null;
  subscription: {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  };
}

export interface RestaurantOrderPushInput {
  restaurantId: string;
  orderId: string;
  orderNumber: string;
  orderSource?: string | null;
  /** Major units, as on the Order wire contract. */
  totalAmount: number;
  /**
   * The restaurant's currency. When omitted it is read from
   * `restaurants.settings.currency`, once, and only if there is a
   * subscription to deliver to.
   */
  currency?: string | null;
  itemCount: number;
  customerName?: string;
  notes?: string | null;
}

const SUBSCRIPTION_PREFIX = "push:subscription:";

export class RestaurantOrderPushService {
  constructor(private readonly env: Env) {}

  async notifyNewOrder(input: RestaurantOrderPushInput) {
    if (!isWebPushEnabled(this.env) || !this.env.WEB_PUSH_DELIVERER) {
      return { attempted: 0, delivered: 0 };
    }

    const subscriptions = await this.listRestaurantSubscriptions(
      input.restaurantId,
    );
    if (subscriptions.length === 0) return { attempted: 0, delivered: 0 };

    const currency =
      normalizeCurrencyCode(input.currency) ??
      (await this.loadRestaurantCurrency(input.restaurantId));
    const payload = buildNewOrderPayload(input, currency);
    let delivered = 0;

    await Promise.all(
      subscriptions.map(async ({ key, record }) => {
        const result = await this.env.WEB_PUSH_DELIVERER?.({
          subscription: {
            id: record.id,
            endpoint: record.subscription.endpoint,
            p256dhKey: record.subscription.keys.p256dh,
            authKey: record.subscription.keys.auth,
          },
          payload,
        });

        if (result?.ok) {
          delivered += 1;
          return;
        }
        if (result?.status === 404 || result?.status === 410) {
          await this.env.CACHE_KV.delete(key);
        }
      }),
    );

    return { attempted: subscriptions.length, delivered };
  }

  private async loadRestaurantCurrency(
    restaurantId: string,
  ): Promise<CurrencyCode> {
    try {
      const row = await drizzle(this.env.DB)
        .select({ settings: restaurants.settings })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .get();
      return normalizeCurrencyCode(row?.settings?.currency) ?? DEFAULT_CURRENCY;
    } catch {
      // A notification with the platform currency beats no notification.
      return DEFAULT_CURRENCY;
    }
  }

  private async listRestaurantSubscriptions(restaurantId: string) {
    const prefix = `${SUBSCRIPTION_PREFIX}${keySegment(restaurantId)}:`;
    const listed = await this.env.CACHE_KV.list({ prefix });
    const records = await Promise.all(
      listed.keys.map(async ({ name }) => {
        const record = await this.env.CACHE_KV.get<PushSubscriptionRecord>(
          name,
          "json",
        );
        if (!isPushSubscriptionRecord(record, restaurantId)) return null;
        return { key: name, record };
      }),
    );

    return records.filter(
      (record): record is { key: string; record: PushSubscriptionRecord } =>
        record !== null,
    );
  }
}

function buildNewOrderPayload(
  input: RestaurantOrderPushInput,
  currency: CurrencyCode,
) {
  const isMarketCheckout = input.orderSource === "market_checkout";

  return {
    type: "new_order",
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    orderSource: input.orderSource ?? "direct",
    title: isMarketCheckout ? "市場結帳新訂單" : "新訂單",
    body: `${input.orderNumber} · ${input.itemCount} items · ${formatCurrency(
      Number.isFinite(input.totalAmount) ? input.totalAmount : 0,
      currency,
    )}`,
    tag: `order-${input.orderId}`,
    priority: isMarketCheckout ? "high" : "normal",
    requireInteraction: isMarketCheckout,
    data: {
      orderId: input.orderId,
      restaurantId: input.restaurantId,
      orderSource: input.orderSource ?? "direct",
      customerName: input.customerName,
      notes: input.notes ?? undefined,
    },
  };
}

function isPushSubscriptionRecord(
  value: unknown,
  restaurantId: string,
): value is PushSubscriptionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PushSubscriptionRecord>;
  return (
    record.restaurantId === restaurantId &&
    typeof record.id === "string" &&
    typeof record.subscription?.endpoint === "string" &&
    typeof record.subscription.keys?.p256dh === "string" &&
    typeof record.subscription.keys.auth === "string"
  );
}

function keySegment(value: string) {
  return encodeURIComponent(value.trim());
}
