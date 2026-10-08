import type {
  PlatformType,
  PlatformCredentials,
  ParsedPlatformOrder,
  MenuSyncPayload,
  MenuSyncResult,
} from "@makanmasak/shared-types";
import type { PlatformAdapter } from "./PlatformAdapter";
import { PlatformOrderRejectedError } from "./PlatformOrderRejectedError";
import { normalizeCurrencyCode } from "@makanmasak/utils";
import {
  ISO_4217_EXPONENTS,
  assertCurrencyAlignedCents,
  centsToIsoMinorUnits,
} from "../../../shared/utils/provider-money";

const UBER_API_BASE = "https://api.uber.com";
const UBER_AUTH_URL = "https://login.uber.com/oauth/v2/token";

export class UberEatsAdapter implements PlatformAdapter {
  readonly platform: PlatformType = "uber_eats";

  async verifyWebhook(request: Request, secret: string): Promise<boolean> {
    const signature = request.headers.get("X-Uber-Signature");
    if (!signature) return false;

    const body = await request.clone().text();

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(body),
    );

    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return computedSignature === signature;
  }

  async refreshToken(
    credentials: PlatformCredentials,
  ): Promise<PlatformCredentials> {
    const response = await fetch(UBER_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.clientId ?? "",
        client_secret: credentials.clientSecret ?? "",
        scope: "eats.store eats.order eats.store.orders.read",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Uber Eats token refresh failed (${response.status}): ${errorBody}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    return {
      ...credentials,
      accessToken: data.access_token,
      tokenExpiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  async parseOrder(payload: unknown): Promise<ParsedPlatformOrder> {
    const order = payload as UberEatsOrderPayload;
    if (!order?.id || !order.cart?.items || !order.payment?.charges?.total) {
      throw new PlatformOrderRejectedError(
        "Uber Eats order is missing id, items, or total",
      );
    }
    const currencyCode = normalizeCurrencyCode(
      order.payment?.charges?.total?.currency_code,
    );
    if (!currencyCode || currencyCode === "VND") {
      throw new PlatformOrderRejectedError(
        "Uber Eats order currency is missing or unsupported",
      );
    }
    // The public docs do not establish whether TWD order amounts arrive as
    // whole NT$ or hundredths. Even an amount divisible by 100 is ambiguous.
    // Keep this closed until a TWD sandbox order confirms the raw unit.
    if (currencyCode === "TWD") {
      throw new PlatformOrderRejectedError(
        "Uber Eats TWD amount unit is unverified",
      );
    }
    const money = (value: UberMoney): number => {
      if (value.currency_code !== currencyCode) {
        throw new PlatformOrderRejectedError(
          "Uber Eats order currency mismatch",
        );
      }
      if (!Number.isSafeInteger(value.amount)) {
        throw new PlatformOrderRejectedError(
          "Uber Eats amount must be a safe integer",
        );
      }
      const cents = value.amount * 10 ** (2 - ISO_4217_EXPONENTS[currencyCode]);
      if (!Number.isSafeInteger(cents)) {
        throw new PlatformOrderRejectedError(
          "Uber Eats amount exceeds safe integer cents",
        );
      }
      assertCurrencyAlignedCents(cents, currencyCode);
      return cents;
    };

    const items = (order.cart?.items ?? []).map((item) => {
      const quantity = item.quantity ?? 1;
      if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new PlatformOrderRejectedError(
          "Uber Eats item quantity must be a positive integer",
        );
      }
      if (!item.price?.unit_price) {
        throw new PlatformOrderRejectedError(
          "Uber Eats item unit price is missing",
        );
      }
      const unitPriceCents = money(item.price.unit_price);
      const totalPriceCents = unitPriceCents * quantity;
      if (!Number.isSafeInteger(totalPriceCents)) {
        throw new PlatformOrderRejectedError(
          "Uber Eats item total exceeds safe integer cents",
        );
      }
      return {
        platformItemId: item.id ?? "",
        name: item.title ?? "",
        quantity,
        unitPriceCents,
        totalPriceCents,
        ...(item.special_instructions && { notes: item.special_instructions }),
        customizations: (item.selected_modifier_groups ?? []).flatMap((group) =>
          (group.selected_items ?? []).map((mod) => ({
            name: group.title ?? group.id ?? "Options",
            value: mod.title ?? "",
            priceAdjustmentCents: mod.price?.unit_price
              ? money(mod.price.unit_price)
              : 0,
          })),
        ),
      };
    });

    return {
      platformOrderId: order.id,
      platformStoreId: order.store?.id ?? "",
      currencyCode,
      customerName: order.eater?.first_name ?? "Unknown",
      customerPhone: order.eater?.phone ?? "",
      deliveryAddress: order.delivery_info?.location?.address ?? "",
      items,
      totalAmountCents: money(order.payment.charges.total),
      subtotalCents: order.payment.charges.sub_total
        ? money(order.payment.charges.sub_total)
        : 0,
      taxAmountCents: order.payment.charges.tax
        ? money(order.payment.charges.tax)
        : 0,
      ...(order.cart.special_instructions && {
        notes: order.cart.special_instructions,
      }),
      platformStatus: "received",
      rawPayload: payload,
    };
  }

  async parseCancellation(
    payload: unknown,
  ): Promise<{ platformOrderId: string; reason?: string }> {
    const notification = payload as UberEatsCancellationPayload;
    // Real `orders.cancel` webhooks carry the order id only in meta.resource_id.
    const platformOrderId =
      notification.meta?.resource_id ??
      notification.order?.id ??
      notification.platform_order_id ??
      notification.order_id ??
      notification.id;
    if (
      typeof platformOrderId !== "string" ||
      platformOrderId.trim().length === 0
    ) {
      throw new Error("Uber Eats cancellation payload is missing an order id");
    }

    return {
      platformOrderId,
      reason: notification.reason ?? notification.cancellation_reason,
    };
  }

  async fetchOrder(
    platformOrderId: string,
    creds: PlatformCredentials,
  ): Promise<unknown> {
    if (!/^[a-zA-Z0-9-]+$/.test(platformOrderId)) {
      throw new Error("Invalid Uber Eats order id");
    }
    const activeCreds = await this.ensureValidToken(creds);
    const response = await fetch(
      `${UBER_API_BASE}/v2/eats/order/${platformOrderId}`,
      { headers: { Authorization: `Bearer ${activeCreds.accessToken}` } },
    );
    if (!response.ok) {
      throw new Error(`Uber Eats order fetch failed (${response.status})`);
    }
    return response.json();
  }

  async acceptOrder(
    platformOrderId: string,
    creds: PlatformCredentials,
  ): Promise<void> {
    const activeCreds = await this.ensureValidToken(creds);
    const response = await fetch(
      `${UBER_API_BASE}/v2/eats/orders/${platformOrderId}/accept_pos_order`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeCreds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "accepted" }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to accept Uber Eats order ${platformOrderId} (${response.status}): ${errorBody}`,
      );
    }
  }

  async denyOrder(
    platformOrderId: string,
    reason: string,
    creds: PlatformCredentials,
  ): Promise<void> {
    const activeCreds = await this.ensureValidToken(creds);
    const response = await fetch(
      `${UBER_API_BASE}/v2/eats/orders/${platformOrderId}/deny_pos_order`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeCreds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: { explanation: reason },
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to deny Uber Eats order ${platformOrderId} (${response.status}): ${errorBody}`,
      );
    }
  }

  async cancelOrder(
    platformOrderId: string,
    reason: string,
    creds: PlatformCredentials,
  ): Promise<void> {
    const activeCreds = await this.ensureValidToken(creds);
    const response = await fetch(
      `${UBER_API_BASE}/v2/eats/orders/${platformOrderId}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${activeCreds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: reason,
          cancelling_party: "MERCHANT",
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to cancel Uber Eats order ${platformOrderId} (${response.status}): ${errorBody}`,
      );
    }
  }

  async syncMenu(
    menuData: MenuSyncPayload,
    creds: PlatformCredentials,
  ): Promise<MenuSyncResult> {
    const storeId = creds.storeId;
    if (!storeId) {
      throw new Error("storeId is required for menu sync");
    }
    const currency = normalizeCurrencyCode(menuData.currencyCode);
    if (currency !== "TWD" && currency !== "MYR") {
      throw new Error("Uber Eats menu currency must be TWD or MYR");
    }
    const locale = currency === "TWD" ? "zh_tw" : "en_my";
    if (currency === "TWD") {
      throw new Error("Uber Eats TWD amount unit is unverified");
    }
    if (!menuData.serviceAvailability?.length) {
      throw new Error("Uber Eats menu requires service availability");
    }
    const translated = (value: string) => ({
      translations: { [locale]: value },
    });
    const price = (cents: number) => centsToIsoMinorUnits(cents, currency);
    const safeModifierId = (value: string | number) => {
      const id = String(value);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error("Uber Eats menu has an unsafe modifier id");
      }
      return id;
    };
    const items: Array<Record<string, unknown>> = [];
    const modifierItems: Array<Record<string, unknown>> = [];
    const modifierGroups: Array<Record<string, unknown>> = [];
    for (const category of menuData.categories) {
      for (const item of category.items) {
        const groupIds: string[] = [];
        for (const [groupIndex, group] of (
          item.modifierGroups ?? []
        ).entries()) {
          const options = group.modifiers.filter(
            (mod) => mod.available !== false,
          );
          if (group.required && options.length === 0) {
            throw new Error(
              `Uber Eats modifier group ${group.name} has no available options`,
            );
          }
          if (options.length === 0) continue;
          const groupId = `${item.id}-${safeModifierId(group.id ?? groupIndex)}`;
          groupIds.push(groupId);
          const modifierOptions = options.map((mod, modIndex) => {
            const id = `${groupId}-${safeModifierId(mod.id ?? modIndex)}`;
            modifierItems.push({
              id,
              title: translated(mod.name),
              price_info: { price: price(mod.priceCents) },
              tax_info: {},
            });
            return { id, type: "ITEM" };
          });
          modifierGroups.push({
            id: groupId,
            title: translated(group.name),
            quantity_info: {
              quantity: {
                min_permitted: group.minSelections,
                max_permitted: group.maxSelections,
              },
            },
            modifier_options: modifierOptions,
          });
        }
        items.push({
          id: String(item.id),
          external_data: String(item.id),
          title: translated(item.name),
          ...(item.description && {
            description: translated(item.description),
          }),
          ...(item.imageUrl && { image_url: item.imageUrl }),
          price_info: { price: price(item.priceCents) },
          tax_info: {},
          ...(groupIds.length && { modifier_group_ids: { ids: groupIds } }),
        });
      }
    }
    const uberMenu = {
      menus: [
        {
          id: String(menuData.restaurantId),
          title: translated("Menu"),
          service_availability: menuData.serviceAvailability,
          category_ids: menuData.categories.map((category) =>
            String(category.id),
          ),
        },
      ],
      categories: menuData.categories.map((category) => ({
        id: String(category.id),
        title: translated(category.name),
        entities: category.items.map((item) => ({
          id: String(item.id),
          type: "ITEM",
        })),
      })),
      items: [...items, ...modifierItems],
      modifier_groups: modifierGroups,
    };
    const activeCreds = await this.ensureValidToken(creds);

    const response = await fetch(
      `${UBER_API_BASE}/v2/eats/stores/${storeId}/menus`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${activeCreds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(uberMenu),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Menu sync to Uber Eats failed (${response.status}): ${errorBody}`,
      );
    }

    // Upload returns 204 No Content; Uber uses our item IDs as its IDs.
    const platformItemIds = Object.fromEntries(
      menuData.categories.flatMap((category) =>
        category.items.map((item) => [item.id, String(item.id)]),
      ),
    ) as Record<number, string>;

    return {
      success: true,
      syncedItems: Object.keys(platformItemIds).length,
      platformItemIds,
    };
  }

  private async ensureValidToken(
    creds: PlatformCredentials,
  ): Promise<PlatformCredentials> {
    if (creds.tokenExpiresAt && creds.tokenExpiresAt > Date.now() + 60_000) {
      return creds;
    }
    return this.refreshToken(creds);
  }
}

// --- Internal type for Uber Eats raw order payload ---

interface UberMoney {
  amount: number;
  currency_code?: string;
}

interface UberEatsOrderPayload {
  id: string;
  store?: { id: string };
  eater?: { first_name: string; phone: string };
  delivery_info?: { location?: { address: string } };
  cart?: {
    special_instructions?: string;
    items: Array<{
      id?: string;
      title?: string;
      special_instructions?: string;
      quantity?: number;
      price?: { unit_price?: UberMoney };
      selected_modifier_groups?: Array<{
        id?: string;
        title?: string;
        selected_items?: Array<{
          title?: string;
          price?: { unit_price?: UberMoney };
        }>;
      }>;
    }>;
  };
  payment?: {
    charges?: {
      total?: UberMoney;
      sub_total?: UberMoney;
      tax?: UberMoney;
    };
  };
}

interface UberEatsCancellationPayload {
  id?: string;
  meta?: { resource_id?: string };
  order?: { id?: string };
  order_id?: string;
  platform_order_id?: string;
  reason?: string;
  cancellation_reason?: string;
}
