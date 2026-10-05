import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { sign } from "jsonwebtoken";
import type { Env } from "../../types/env";
import { ApiError } from "../utils/api-error";
import {
  issueWaitingTicketToken,
  requireWaitingTicketAccess,
  requireWaitingPreorderAccess,
} from "./waiting-ticket-access";

const JWT_SECRET = "waiting-ticket-test-secret-at-least-32-chars";
const ticket = {
  id: "ticket-1",
  restaurantId: "rest-1",
  customerPhone: "0912345678",
  customerId: undefined,
};

function request(
  token?: string,
  customer?: { id: string },
  verified = false,
  preorder = false,
  independent = false,
) {
  const app = new Hono<{ Bindings: Env }>();
  app.onError((err, c) =>
    c.json({}, err instanceof ApiError ? (err.status as 403) : 500),
  );
  app.get("/", async (c) => {
    if (customer)
      c.set("customer", {
        ...customer,
        displayName: "Diner",
        status: "active",
        primaryPhone: ticket.customerPhone,
      });
    if (preorder)
      await requireWaitingPreorderAccess(c, ticket.id, ticket.restaurantId);
    else await requireWaitingTicketAccess(c, ticket);
    return c.json({ private: "ticket" });
  });
  return app.request(
    "/",
    { headers: token ? { "X-Waiting-Ticket-Token": token } : {} },
    {
      JWT_SECRET,
      ...(independent
        ? { DEPLOYMENT_MODE: "independent", TENANT_ID: "rest-2" }
        : {}),
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => ({
            first: async () =>
              sql.includes("FROM waiting_list")
                ? ticket
                : verified && args[1] === "+886912345678"
                  ? { verified: 1 }
                  : null,
          }),
        }),
      },
    } as unknown as Env,
  );
}

describe("waiting ticket ownership", () => {
  it("rejects another ticket, another tenant, expired tokens and staff-shaped tokens", async () => {
    const tokens = [
      issueWaitingTicketToken({ JWT_SECRET } as Env, {
        ...ticket,
        id: "ticket-2",
      }),
      issueWaitingTicketToken({ JWT_SECRET } as Env, {
        ...ticket,
        restaurantId: "rest-2",
      }),
      sign(
        {
          sub: ticket.id,
          restaurantId: ticket.restaurantId,
          aud: "waiting-ticket",
          exp: 1,
        },
        JWT_SECRET,
      ),
      sign(
        { sub: ticket.id, restaurantId: ticket.restaurantId, role: 0 },
        JWT_SECRET,
      ),
    ];
    for (const token of tokens) expect((await request(token)).status).toBe(403);
  });

  it("preserves guest polling and preorder with the same capability", async () => {
    const token = issueWaitingTicketToken({ JWT_SECRET } as Env, ticket);
    expect((await request(token)).status).toBe(200);
    expect((await request(token, undefined, false, true)).status).toBe(200);
    expect((await request(undefined, undefined, false, true)).status).toBe(403);
  });

  it("rejects foreign tenant capabilities in independent deployments", async () => {
    const token = issueWaitingTicketToken({ JWT_SECRET } as Env, ticket);
    expect((await request(token, undefined, false, false, true)).status).toBe(
      403,
    );
  });

  it("requires verified phone evidence even when the signed-in profile phone matches", async () => {
    expect((await request(undefined, { id: "customer-1" })).status).toBe(403);
    expect((await request(undefined, { id: "customer-1" }, true)).status).toBe(
      200,
    );
  });
});
