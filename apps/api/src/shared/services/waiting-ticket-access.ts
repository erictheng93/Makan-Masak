import { normalizeE164Phone } from "@makanmasak/utils";
import { sign, verify } from "jsonwebtoken";
import type { Context } from "hono";
import type { Env } from "../../types/env";
import type { WaitingListResponse } from "@makanmasak/shared-types";
import { forbidden } from "../utils/api-error";

type WaitingAccessContext = Pick<
  Context<{ Bindings: Env }>,
  "env" | "get" | "req"
>;

type Ticket = Pick<
  WaitingListResponse,
  "id" | "restaurantId" | "customerId" | "customerPhone"
>;

export function requireWaitingRestaurantScope(
  env: Env,
  restaurantId: string,
): void {
  if (
    env.DEPLOYMENT_MODE === "independent" &&
    (!env.TENANT_ID || env.TENANT_ID !== restaurantId)
  ) {
    throw forbidden("Waiting ticket access denied");
  }
}

export function issueWaitingTicketToken(env: Env, ticket: Ticket): string {
  requireWaitingRestaurantScope(env, ticket.restaurantId);
  return sign({ restaurantId: ticket.restaurantId }, env.JWT_SECRET, {
    algorithm: "HS256",
    subject: ticket.id,
    audience: "waiting-ticket",
    expiresIn: "48h",
  });
}

/** A profile phone is not proof: require an identity or a consumed OTP. */
export async function requireVerifiedWaitingPhone(
  c: WaitingAccessContext,
  phone: string,
): Promise<void> {
  const customer = c.get("customer");
  if (!customer)
    throw forbidden("Verify your phone to recover waiting tickets");
  const verified = await c.env.DB.prepare(
    `SELECT 1 AS verified FROM customer_auth_identities
       WHERE customer_id = ? AND provider_uid = ? AND provider = 'password'
         AND verified_at_ms IS NOT NULL
     UNION ALL
     SELECT 1 AS verified FROM customer_phone_verification_tokens
       WHERE customer_id = ? AND phone = ? AND used_at_ms IS NOT NULL
     LIMIT 1`,
  )
    .bind(
      customer.id,
      normalizeE164Phone(phone),
      customer.id,
      normalizeE164Phone(phone),
    )
    .first();
  if (!verified)
    throw forbidden("Verify your phone to recover waiting tickets");
}

export async function requireWaitingTicketAccess(
  c: WaitingAccessContext,
  ticket: Ticket,
): Promise<void> {
  requireWaitingRestaurantScope(c.env, ticket.restaurantId);
  const user = c.get("user");
  if (
    user &&
    [0, 1, 3, 4].includes(user.role) &&
    (user.role === 0 || String(user.restaurantId) === ticket.restaurantId)
  )
    return;
  const token = c.req.header("X-Waiting-Ticket-Token");
  if (token) {
    try {
      const payload = verify(token, c.env.JWT_SECRET, {
        algorithms: ["HS256"],
        audience: "waiting-ticket",
        subject: ticket.id,
      });
      if (
        typeof payload === "object" &&
        payload.restaurantId === ticket.restaurantId
      )
        return;
    } catch {
      /* Invalid capabilities grant no access. */
    }
  }
  const customer = c.get("customer");
  if (customer && ticket.customerId === customer.id) return;
  await requireVerifiedWaitingPhone(c, ticket.customerPhone);
}

export async function requireWaitingPreorderAccess(
  c: WaitingAccessContext,
  ticketId: string,
  restaurantId: string,
): Promise<void> {
  const ticket = await c.env.DB.prepare(
    `SELECT id, restaurant_id AS restaurantId, customer_id AS customerId,
            customer_phone AS customerPhone FROM waiting_list WHERE id = ? LIMIT 1`,
  )
    .bind(ticketId)
    .first<Ticket>();
  if (!ticket || ticket.restaurantId !== restaurantId) {
    throw forbidden("Waiting ticket access denied");
  }
  await requireWaitingTicketAccess(c, ticket);
}
