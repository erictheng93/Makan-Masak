import { Hono, type Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { orders, printAgents, receipts } from "@makanmasak/database";
import { z } from "zod";
import type { Env } from "../../types/env";
import { hashPrintAgentKey } from "../../shared/utils/print-agent-key";

const app = new Hono<{ Bindings: Env }>();

/**
 * A claim older than this lost its agent rather than the race: the agent caps
 * its own wait on the physical printer at 30s, so anything still "printing"
 * after five minutes is a process that died between claiming and
 * acknowledging. Without this the row stays claimed forever and the receipt is
 * silently never printed.
 */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Delivery attempts before a receipt is given up on. A receipt that reliably
 * kills the agent — a malformed historic payload, say — would otherwise be
 * reclaimed on every poll forever.
 */
const MAX_DELIVERY_ATTEMPTS = 5;

/** 代理回報的印表機台數。壞掉或缺席的值一律忽略，不要覆蓋既有讀數。 */
function optionalCount(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 1000
    ? value
    : undefined;
}

const acknowledgementSchema = z.lazy(() =>
  z.object({
    // Additive on purpose: an agent that predates `indeterminate` only ever
    // sends the first two values and keeps working untouched, so no version gate
    // is needed on either side.
    status: z.enum(["printed", "failed", "indeterminate"]),
    printerName: z.string().trim().max(200).optional(),
    response: z.string().max(2000).optional(),
  }),
);

interface AgentIdentity {
  agentId: string;
  /** null = 服務整間店而不是某一台收銀機，例如廚房出單機。 */
  registerId: string | null;
  restaurantId: string;
}

/**
 * Resolve the caller from its key alone. The restaurant is carried by the
 * credential itself and never read from a header: an agent that could name its
 * own tenant could claim and read another shop's receipts, which carry customer
 * names, line items and payment methods.
 */
async function authenticateAgent(
  c: Context<{ Bindings: Env }>,
): Promise<AgentIdentity | null> {
  const presented = c.req.header("X-Print-Agent-Key");
  if (!presented) return null;

  const [agent] = await drizzle(c.env.DB)
    .select({
      agentId: printAgents.id,
      registerId: printAgents.registerId,
      restaurantId: printAgents.restaurantId,
    })
    .from(printAgents)
    .where(
      and(
        eq(printAgents.keyHash, await hashPrintAgentKey(presented)),
        isNull(printAgents.revokedAt),
      ),
    )
    .limit(1);

  return agent ?? null;
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    {
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid print-agent credentials",
      },
    },
    401,
  );
}

function requestForReceipt(
  receipt: {
    id: string;
    orderId: string;
    content: string;
    createdAt: Date | null;
  },
  restaurantId: string,
) {
  let content: Record<string, unknown> = {};
  try {
    content = JSON.parse(receipt.content || "{}") as Record<string, unknown>;
  } catch {
    // A malformed historic payload should be acknowledged as failed by the
    // agent rather than leaving a claimed row behind after an API exception.
  }
  return {
    country: "TW",
    type: "receipt",
    restaurantId,
    data: {
      order: {
        id: receipt.orderId,
        tableNumber:
          typeof content.tableNumber === "string"
            ? content.tableNumber
            : undefined,
        deliveryAddress:
          typeof content.deliveryAddress === "string"
            ? content.deliveryAddress
            : undefined,
        deliveryPhone:
          typeof content.deliveryPhone === "string"
            ? content.deliveryPhone
            : undefined,
        deliveryFee: Number(content.deliveryFee ?? 0),
        items: Array.isArray(content.items)
          ? content.items.map((item: Record<string, unknown>) => ({
              name: String(item.name ?? "Item"),
              quantity: Number(item.quantity ?? 1),
              price: Number(item.price ?? 0),
            }))
          : [],
        subtotal: Number(content.subtotal ?? 0),
        tax: Number(content.taxAmount ?? 0),
        total: Number(content.totalAmount ?? 0),
        createdAt: (receipt.createdAt ?? new Date(0)).toISOString(),
      },
      customer: content.customerName
        ? { name: String(content.customerName) }
        : undefined,
      payment: content.paymentMethod
        ? {
            method: String(content.paymentMethod),
            amount: Number(content.totalAmount ?? 0),
            transactionId: receipt.id,
          }
        : undefined,
    },
  };
}

app.get("/jobs", async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);

  const db = drizzle(c.env.DB);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  // A till agent takes that till's receipts; a shop agent (register_id NULL)
  // takes the register-less ones, which is what an order-triggered kitchen
  // ticket is. `IS` rather than `=` so NULL matches NULL — `= NULL` is NULL,
  // which would silently match nothing and leave kitchen tickets unprinted.
  const servesThisAgent = sql`${receipts.registerId} IS ${agent.registerId}`;

  // Receipts carry no restaurant of their own; it comes from the order. This
  // is the tenant boundary, so it is applied to every statement below rather
  // than assumed from the register.
  const inThisRestaurant = inArray(
    receipts.orderId,
    db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.restaurantId, agent.restaurantId)),
  );

  // A claim older than the timeout is abandoned. So is one with no timestamp
  // at all: "printing" with nothing tracking the claim is precisely the state
  // this reclaim exists to resolve.
  const abandoned = and(
    eq(receipts.printStatus, "printing"),
    or(isNull(receipts.claimedAt), lte(receipts.claimedAt, staleBefore)),
  );

  await db
    .update(receipts)
    .set({
      printStatus: "failed",
      printerResponse: `Abandoned after ${MAX_DELIVERY_ATTEMPTS} delivery attempts`,
      claimedAt: null,
    })
    .where(
      and(
        inThisRestaurant,
        servesThisAgent,
        abandoned,
        gte(receipts.printAttempts, MAX_DELIVERY_ATTEMPTS),
      ),
    );

  const claimable = or(
    eq(receipts.printStatus, "pending"),
    and(abandoned, lt(receipts.printAttempts, MAX_DELIVERY_ATTEMPTS)),
  );

  const nextJob = db
    .select({ id: receipts.id })
    .from(receipts)
    .where(and(inThisRestaurant, servesThisAgent, claimable))
    .orderBy(asc(receipts.createdAt))
    .limit(1);

  // Claim and read in one statement, so two agents sharing a register cannot
  // both walk away with the same receipt.
  const [claimed] = await db
    .update(receipts)
    .set({
      printStatus: "printing",
      printAttempts: sql`${receipts.printAttempts} + 1`,
      claimedAt: now,
    })
    .where(
      and(
        // Repeated outside the subquery so the tenant scope of the write is
        // visible without tracing into it.
        inThisRestaurant,
        servesThisAgent,
        inArray(receipts.id, nextJob),
        claimable,
      ),
    )
    .returning({
      id: receipts.id,
      orderId: receipts.orderId,
      content: receipts.content,
      createdAt: receipts.createdAt,
    });

  // Reported on the poll rather than through a second endpoint: the agent
  // already calls this every heartbeat, and a separate health beat would be
  // one more thing that can silently stop while printing still works.
  const printersTotal = optionalCount(c.req.query("printersTotal"));
  const printersOnline = optionalCount(c.req.query("printersOnline"));

  await db
    .update(printAgents)
    .set({
      lastSeenAt: now,
      updatedAt: now,
      ...(printersTotal === undefined ? {} : { printersTotal }),
      ...(printersOnline === undefined ? {} : { printersOnline }),
    })
    .where(eq(printAgents.id, agent.agentId));

  if (!claimed) return c.json({ success: true, data: null });
  return c.json({
    success: true,
    data: {
      receiptId: claimed.id,
      request: requestForReceipt(claimed, agent.restaurantId),
    },
  });
});

app.post("/jobs/:receiptId/ack", async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);

  const parsed = acknowledgementSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success)
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid acknowledgement" },
      },
      400,
    );

  const db = drizzle(c.env.DB);

  // A re-queue is only safe for an outcome the agent actually observed.
  //
  // `failed` is such an outcome: the agent watched the job settle without
  // reaching paper — a jam, a printer briefly offline — so reprinting is the
  // right move, and treating it as terminal is what left a receipt silently
  // never printed until a human noticed. Below the attempt budget the row goes
  // back to `pending` so the next poll re-claims it; at the budget it stays
  // `failed`. `print_attempts` is already incremented by every claim, so it
  // bounds the retries with no second counter. There is no backoff — retries
  // are paced by the agent's own poll cadence.
  //
  // `indeterminate` is the opposite: the agent stopped waiting without ever
  // learning what happened, and its local queue keeps retrying a job it could
  // not cancel. That receipt or kitchen ticket may already be on paper, so
  // re-queueing it would print it a second time. It settles terminally as
  // `failed` however many attempts are left, and the last error stays readable
  // on the row for whoever decides to reprint it by hand.
  const settledStatus =
    parsed.data.status === "printed"
      ? "printed"
      : parsed.data.status === "indeterminate"
        ? "failed"
        : sql`CASE WHEN ${receipts.printAttempts} >= ${MAX_DELIVERY_ATTEMPTS} THEN 'failed' ELSE 'pending' END`;

  const settled = await db
    .update(receipts)
    .set({
      printStatus: settledStatus,
      // Written even when the row returns to `pending`, so the last error is
      // still readable while the retry is queued.
      printerName: parsed.data.printerName ?? null,
      printerResponse: parsed.data.response ?? null,
      claimedAt: null,
      ...(parsed.data.status === "printed" ? { printedAt: new Date() } : {}),
    })
    .where(
      and(
        eq(receipts.id, c.req.param("receiptId")),
        eq(receipts.printStatus, "printing"),
        // Scoped exactly like the claim, so a credential can never settle a
        // job it was not handed — neither another shop's nor another till's.
        inArray(
          receipts.orderId,
          db
            .select({ id: orders.id })
            .from(orders)
            .where(eq(orders.restaurantId, agent.restaurantId)),
        ),
        sql`${receipts.registerId} IS ${agent.registerId}`,
      ),
    )
    .returning({ id: receipts.id });

  if (settled.length === 0)
    return c.json(
      {
        success: false,
        error: { code: "JOB_NOT_FOUND", message: "No claimed print job found" },
      },
      404,
    );
  return c.json({ success: true });
});

export default app;
