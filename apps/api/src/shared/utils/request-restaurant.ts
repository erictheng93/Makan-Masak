import { badRequest } from "./api-error";

/**
 * The restaurant a public or customer request is for, read from its JSON body
 * without consuming it, for gates (moduleGate, quotaGate) that run before
 * validation. Callers whose credential carries no restaurant — guests, group
 * members, canonical customers — are gated on the restaurant they order from.
 */
export async function resolveRestaurantIdFromJsonBody(c: {
  req: { raw: Request };
}): Promise<string | undefined> {
  const body = await c.req.raw
    .clone()
    .json()
    .catch(() => {
      throw badRequest("Invalid JSON body", "INVALID_JSON");
    });
  if (!body || typeof body !== "object") return undefined;
  const restaurantId = (body as Record<string, unknown>).restaurantId;
  return typeof restaurantId === "string" || typeof restaurantId === "number"
    ? String(restaurantId)
    : undefined;
}
