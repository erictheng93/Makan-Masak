/**
 * Owner-scoped CRUD over a shop's own e-wallet connections.
 *
 * Tenancy follows the shape `features/integrations/routes/admin.ts` uses:
 * every route carries `:restaurantId`, and one middleware pair checks it
 * against the caller's own restaurant before any handler runs. Platform admin
 * (role 0) is the only caller allowed to name a restaurant that is not theirs;
 * an owner (role 1) naming anyone else's gets 403, not 404, because the row's
 * existence is not the point — the attempt is.
 *
 * Secrets are write-only. The request body may carry them; no response shape
 * in this file can. See `ShopPaymentCredentialService.toView`.
 */
import { Hono } from "hono";
import { z } from "zod";
import { validateBody } from "../../../middleware/validation";
import type { Env } from "../../../types/env";
import { authMiddleware, requireRole } from "../../../shared/middleware";
import {
  badRequest,
  forbidden,
  notFound,
} from "../../../shared/utils/api-error";
import { ShopPaymentCredentialService } from "../services/ShopPaymentCredentialService";
import {
  isShopPaymentProvider,
  SHOP_PAYMENT_PROVIDER_VALUES,
  type ShopPaymentProvider,
} from "../types";

type ShopPaymentsUser = {
  id?: string | number | null;
  role: number;
  restaurantId?: string | number | null;
};

type ShopPaymentsEnv = {
  Bindings: Env;
  Variables: { user: ShopPaymentsUser };
};

const routes = new Hono<ShopPaymentsEnv>();

function assertRestaurantScope(user: ShopPaymentsUser, restaurantId: string) {
  if (user.role === 0) return;
  if (user.restaurantId == null || String(user.restaurantId) !== restaurantId) {
    throw forbidden(
      "Cannot manage payment credentials for another restaurant",
      "SHOP_PAYMENT_CREDENTIAL_FORBIDDEN",
    );
  }
}

function requireProvider(value: string): ShopPaymentProvider {
  if (!isShopPaymentProvider(value)) {
    throw notFound(
      "Unknown payment provider",
      "SHOP_PAYMENT_PROVIDER_UNSUPPORTED",
    );
  }
  return value;
}

function actorId(user: ShopPaymentsUser): string | null {
  return user.id == null ? null : String(user.id);
}

// Platform admin (0) and shop owner (1) only. Staff roles never see a
// merchant account, let alone write one.
routes.use("/*", authMiddleware);
routes.use("/*", requireRole([0, 1]));
routes.use("/:restaurantId", async (c, next) => {
  assertRestaurantScope(c.get("user"), c.req.param("restaurantId"));
  await next();
});
routes.use("/:restaurantId/*", async (c, next) => {
  assertRestaurantScope(c.get("user"), c.req.param("restaurantId"));
  await next();
});

const secretSchema = z.object({
  merchantKey: z.string().trim().min(1).max(512).optional(),
  clientSecret: z.string().trim().min(1).max(512).optional(),
  webhookSecret: z.string().trim().min(1).max(512).optional(),
});

const configSchema = z.object({
  note: z.string().trim().max(500).optional(),
  returnUrl: z.string().trim().url().max(2048).optional(),
});

const connectSchema = z.lazy(() =>
  z.object({
    merchantId: z.string().trim().min(1).max(128),
    displayName: z.string().trim().max(128).nullish(),
    environment: z.enum(["sandbox", "production"]).optional(),
    secret: secretSchema,
    config: configSchema.optional(),
  }),
);

const updateSchema = z.lazy(() =>
  z.object({
    merchantId: z.string().trim().min(1).max(128).optional(),
    displayName: z.string().trim().max(128).nullish(),
    environment: z.enum(["sandbox", "production"]).optional(),
    secret: secretSchema.optional(),
    config: configSchema.optional(),
    status: z.enum(["connected", "disabled"]).optional(),
  }),
);

type ConnectBody = z.infer<typeof connectSchema>;
type UpdateBody = z.infer<typeof updateSchema>;

/** GET /:restaurantId — every wallet this shop has connected. */
routes.get("/:restaurantId", async (c) => {
  const service = new ShopPaymentCredentialService(c.env);
  const credentials = await service.list(c.req.param("restaurantId"));
  return c.json({
    success: true,
    data: { credentials, supportedProviders: SHOP_PAYMENT_PROVIDER_VALUES },
  });
});

/** GET /:restaurantId/:provider — one connection. */
routes.get("/:restaurantId/:provider", async (c) => {
  const provider = requireProvider(c.req.param("provider"));
  const service = new ShopPaymentCredentialService(c.env);
  const credential = await service.get(c.req.param("restaurantId"), provider);
  if (!credential) {
    throw notFound(
      "Payment provider is not connected",
      "SHOP_PAYMENT_CREDENTIAL_NOT_FOUND",
    );
  }
  return c.json({ success: true, data: credential });
});

/** POST /:restaurantId/:provider/connect — connect or rotate. */
routes.post(
  "/:restaurantId/:provider/connect",
  validateBody(connectSchema),
  async (c) => {
    const provider = requireProvider(c.req.param("provider"));
    const body = c.get("validatedBody") as ConnectBody;
    const service = new ShopPaymentCredentialService(c.env);
    const credential = await service.connect(
      c.req.param("restaurantId"),
      provider,
      {
        merchantId: body.merchantId,
        displayName: body.displayName ?? null,
        environment: body.environment,
        secret: body.secret,
        config: body.config,
      },
      actorId(c.get("user")),
    );
    return c.json({ success: true, data: credential }, 201);
  },
);

/** PUT /:restaurantId/:provider — edit non-secret fields, rotate, enable/disable. */
routes.put(
  "/:restaurantId/:provider",
  validateBody(updateSchema),
  async (c) => {
    const provider = requireProvider(c.req.param("provider"));
    const body = c.get("validatedBody") as UpdateBody;
    if (Object.keys(body).length === 0) {
      throw badRequest("No changes were provided", "NO_CHANGES");
    }
    const service = new ShopPaymentCredentialService(c.env);
    const credential = await service.update(
      c.req.param("restaurantId"),
      provider,
      {
        ...(body.merchantId !== undefined && { merchantId: body.merchantId }),
        ...(body.displayName !== undefined && {
          displayName: body.displayName ?? null,
        }),
        ...(body.environment !== undefined && {
          environment: body.environment,
        }),
        ...(body.secret !== undefined && { secret: body.secret }),
        ...(body.config !== undefined && { config: body.config }),
        ...(body.status !== undefined && { status: body.status }),
      },
      actorId(c.get("user")),
    );
    return c.json({ success: true, data: credential });
  },
);

/** DELETE /:restaurantId/:provider — disconnect and forget the secret. */
routes.delete("/:restaurantId/:provider", async (c) => {
  const provider = requireProvider(c.req.param("provider"));
  const service = new ShopPaymentCredentialService(c.env);
  await service.disconnect(c.req.param("restaurantId"), provider);
  return c.json({ success: true, data: { provider, status: "disconnected" } });
});

export default routes;
