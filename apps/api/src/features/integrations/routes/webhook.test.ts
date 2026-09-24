import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSelectFixtureDb,
  type SelectFixtures,
} from "@makanmasak/database/testing";

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  drizzle: vi.fn(),
  adapter: {
    verifyWebhook: vi.fn(),
    parseCancellation: vi.fn(),
    fetchOrder: vi.fn(),
    denyOrder: vi.fn(),
  },
  integrationService: {
    getDecryptedCredentials: vi.fn(),
    readStoredCredentials: vi.fn(),
  },
  integrationServiceCtor: vi.fn(),
  orderService: {
    processWebhook: vi.fn(),
    processCancellation: vi.fn(),
  },
  orderServiceCtor: vi.fn(),
}));

vi.mock("../../../middleware/idempotency", () => ({
  idempotencyMiddleware: vi.fn(
    () => async (_c: unknown, next: () => Promise<void>) => next(),
  ),
}));

vi.mock("drizzle-orm/d1", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
}));

vi.mock("@makanmasak/database", () => ({
  platformIntegrations: {
    enabled: "enabled",
    platform: "platform",
    // Must mirror the real schema's columns. The select fixture returns rows
    // whatever the where clause says, so a column missing here reads as
    // `undefined` in the query and every assertion still passes.
    storeId: "storeId",
  },
  platformWebhookLogs: {
    id: "id",
  },
  WEBHOOK_LOG_STATUS: {
    RECEIVED: "received",
    PROCESSED: "processed",
    FAILED: "failed",
    IGNORED: "ignored",
  },
}));

vi.mock("../adapters/PlatformAdapter", () => ({
  getAdapter: vi.fn(() => mocks.adapter),
}));

vi.mock("../services/PlatformIntegrationService", () => ({
  PlatformIntegrationService: vi.fn(function PlatformIntegrationService(
    ...args: unknown[]
  ) {
    mocks.integrationServiceCtor(...args);
    return mocks.integrationService;
  }),
}));

vi.mock("../services/PlatformOrderService", () => ({
  PlatformOrderService: vi.fn(function PlatformOrderService(
    ...args: unknown[]
  ) {
    mocks.orderServiceCtor(...args);
    return mocks.orderService;
  }),
}));

import routes from "./webhook";
import { PlatformOrderRejectedError } from "../adapters/PlatformOrderRejectedError";
import { eq } from "drizzle-orm";
import { platformIntegrations } from "@makanmasak/database";
import { idempotencyMiddleware } from "../../../middleware/idempotency";

// The route builds its middleware once, while `./webhook` is evaluated — long
// before the first `beforeEach`. Snapshot the options here, because
// `vi.clearAllMocks()` would otherwise erase the only call there is.
const idempotencyOptions = vi
  .mocked(idempotencyMiddleware)
  .mock.calls.map(([options]) => options);

const fixtureTables = { platformIntegrations };
type SelectFixtureName = keyof typeof fixtureTables;

function mockSelectResults(fixtures: SelectFixtures<SelectFixtureName>) {
  Object.assign(mocks.db, createSelectFixtureDb(fixtureTables, fixtures));
}

function mockMutations(returningRows: unknown[] = [{ id: "log-1" }]) {
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const onConflictDoNothing = vi.fn();

  mocks.db.insert.mockImplementation(() => {
    const builder = {
      values: vi.fn((payload: unknown) => {
        inserted.push(payload);
        return builder;
      }),
      returning: vi.fn(() => Promise.resolve(returningRows)),
      onConflictDoNothing,
    };
    onConflictDoNothing.mockImplementation(() => builder);
    return builder;
  });

  mocks.db.update.mockImplementation(() => {
    const builder = {
      set: vi.fn((payload: unknown) => {
        updated.push(payload);
        return builder;
      }),
      where: vi.fn(() => builder),
      then: (
        resolve: (value: unknown) => void,
        reject?: (reason: unknown) => void,
      ) => Promise.resolve(undefined).then(resolve, reject),
    };
    return builder;
  });

  return { inserted, updated, onConflictDoNothing };
}

function request(path: string, init: RequestInit = {}) {
  return routes.request(path, init, {
    DB: { binding: "db" },
    ENCRYPTION_KEY: "test-key",
  } as never);
}

async function json(response: Response) {
  return (await response.json()) as {
    data?: unknown;
    error?: string;
    orderId?: number;
    success?: boolean;
  };
}

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: "integration-1",
    restaurantId: "restaurant-1",
    platform: "uber_eats",
    enabled: true,
    // Plaintext column the route resolves on, kept in step with the copy
    // inside the encrypted credentials (#338).
    storeId: "store-1",
    credentials: { storeId: "store-1" },
    config: { webhookSecret: "configured-secret" },
    ...overrides,
  };
}

function webhookPayload(overrides: Record<string, unknown> = {}) {
  return {
    event_id: "event-1",
    event_type: "order.created",
    store: { id: "store-1" },
    order: { id: "uber-order-1" },
    ...overrides,
  };
}

describe("platform webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.drizzle.mockReturnValue(mocks.db);
    mocks.adapter.verifyWebhook.mockResolvedValue(true);
    mocks.adapter.fetchOrder.mockResolvedValue({
      id: "uber-order-1",
      store: { id: "store-1" },
      cart: { items: [] },
      payment: { charges: { total: { amount: 1399, currency_code: "MYR" } } },
    });
    mocks.integrationService.getDecryptedCredentials.mockResolvedValue({
      clientSecret: "decrypted-secret",
    });
    mocks.integrationService.readStoredCredentials.mockImplementation(
      (stored: unknown) => Promise.resolve(stored),
    );
    mocks.orderService.processWebhook.mockResolvedValue(101);
    mocks.adapter.parseCancellation.mockResolvedValue({
      platformOrderId: "uber-order-1",
      reason: "customer_cancelled",
    });
    mocks.orderService.processCancellation.mockResolvedValue({
      handled: true,
    });
  });

  it("rejects malformed payloads and payloads without a store id", async () => {
    let response = await request("/uber-eats", {
      method: "POST",
      body: "{",
    });
    let body = await json(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: { code: "INVALID_JSON", message: "Invalid JSON payload" },
    });
    expect(mocks.db.select).not.toHaveBeenCalled();

    response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify({ event_id: "event-1" }),
      headers: { "Content-Type": "application/json" },
    });
    body = await json(response);

    expect(response.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: { code: "MISSING_PARAM", message: "Missing store id in payload" },
    });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("returns not found when no enabled integration matches the store", async () => {
    // The store id is now a WHERE clause, so a miss comes back as no rows
    // rather than rows this route has to decrypt and sift through.
    mockSelectResults({ platformIntegrations: [[]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: { code: "INTEGRATION_NOT_FOUND", message: "Unknown store" },
    });
    expect(mocks.adapter.verifyWebhook).not.toHaveBeenCalled();
  });

  it("decrypts nothing when an unauthenticated request names an unknown store", async () => {
    // The invariant this whole ticket is about (#338). This route takes no
    // authentication, so anything it does before the signature check is work
    // a stranger can command. It used to decrypt every enabled integration's
    // credentials — every tenant's, not just the caller's — merely to find
    // which row the payload's store id belonged to.
    mockSelectResults({ platformIntegrations: [[]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload({ store: { id: "not-a-tenant" } })),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(404);
    expect(
      mocks.integrationService.readStoredCredentials,
    ).not.toHaveBeenCalled();
  });

  it("decrypts exactly one integration when the store resolves", async () => {
    mockSelectResults({ platformIntegrations: [[integration()]] });

    await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Uber-Signature": "valid",
      },
    });

    // One, and only one: the signing secret lives inside the ciphertext, so a
    // single decryption is unavoidable. What must not come back is a count
    // that scales with how many integrations the platform has.
    expect(
      mocks.integrationService.readStoredCredentials,
    ).toHaveBeenCalledOnce();

    // And the single row came from the database narrowing on the store, not
    // from this route reading every row and picking one.
    expect(eq).toHaveBeenCalledWith(platformIntegrations.storeId, "store-1");
  });

  it("refuses a signature when the integration stores no webhook secret", async () => {
    // An HMAC keyed on "" is one any caller can compute, so falling back to it
    // turned the signature check into a formality for such a row.
    mockSelectResults({
      platformIntegrations: [
        [integration({ credentials: { storeId: "store-1" }, config: {} })],
      ],
    });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Uber-Signature": "anything",
      },
    });
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: { code: "INVALID_SIGNATURE", message: "Invalid signature" },
    });
    expect(mocks.adapter.verifyWebhook).not.toHaveBeenCalled();
  });

  it("rejects invalid webhook signatures with the configured secret", async () => {
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.adapter.verifyWebhook.mockResolvedValueOnce(false);

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: {
        "Content-Type": "application/json",
        "X-Uber-Signature": "invalid",
      },
    });
    const body = await json(response);

    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: { code: "INVALID_SIGNATURE", message: "Invalid signature" },
    });
    expect(mocks.adapter.verifyWebhook).toHaveBeenCalledWith(
      expect.any(Request),
      "configured-secret",
    );
    expect(
      mocks.integrationService.getDecryptedCredentials,
    ).not.toHaveBeenCalled();
  });

  it("uses encrypted credentials for store matching and webhook secrets", async () => {
    const mutations = mockMutations();
    const encryptedCredentials = "encrypted-credentials";
    mockSelectResults({
      platformIntegrations: [
        [integration({ credentials: encryptedCredentials, config: {} })],
      ],
    });
    mocks.integrationService.readStoredCredentials.mockResolvedValueOnce({
      storeId: "store-1",
      clientSecret: "client-secret",
      webhookSecret: "decrypted-webhook-secret",
    });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(mocks.integrationService.readStoredCredentials).toHaveBeenCalledWith(
      encryptedCredentials,
    );
    expect(mocks.adapter.verifyWebhook).toHaveBeenCalledWith(
      expect.any(Request),
      "decrypted-webhook-secret",
    );
    expect(mocks.orderService.processWebhook).toHaveBeenCalledWith(
      "uber_eats",
      webhookPayload(),
      "restaurant-1",
    );
    expect(body).toEqual({ success: true, orderId: 101 });
    expect(mutations.inserted[0]).toMatchObject({
      restaurantId: "restaurant-1",
      platform: "uber_eats",
      eventType: "order.created",
      status: "received",
    });
    expect(mutations.updated[0]).toMatchObject({ status: "processed" });
  });

  it("fetches full order details for a signed Uber notification", async () => {
    mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    const notification = {
      event_id: "event-notification",
      event_type: "orders.notification",
      meta: { resource_id: "uber-order-1", user_id: "store-1", status: "pos" },
      resource_href: "https://attacker.example.test/ignore-this-url",
    };
    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(notification),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(mocks.adapter.fetchOrder).toHaveBeenCalledWith(
      "uber-order-1",
      expect.objectContaining({ storeId: "store-1" }),
    );
    expect(mocks.orderService.processWebhook).toHaveBeenCalledWith(
      "uber_eats",
      expect.objectContaining({ id: "uber-order-1", store: { id: "store-1" } }),
      "restaurant-1",
    );
  });

  it("refuses fetched order details from another Uber store", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.adapter.fetchOrder.mockResolvedValueOnce({
      id: "uber-order-1",
      store: { id: "other-store" },
      cart: { items: [] },
    });
    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify({
        event_type: "orders.notification",
        event_id: "event-other-store",
        meta: { user_id: "store-1", resource_id: "uber-order-1" },
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(500);
    expect(mocks.orderService.processWebhook).not.toHaveBeenCalled();
    expect(mutations.updated[0]).toMatchObject({
      status: "failed",
      platformEventId: null,
    });
  });

  it("denies an order Uber can never redeliver successfully and keeps its event id", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.adapter.denyOrder.mockResolvedValueOnce(undefined);
    mocks.orderService.processWebhook.mockRejectedValueOnce(
      new PlatformOrderRejectedError("Uber Eats TWD amount unit is unverified"),
    );

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify({
        event_type: "orders.notification",
        event_id: "event-twd",
        meta: { user_id: "store-1", resource_id: "uber-order-1" },
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      success: true,
      data: { acknowledged: true, rejected: true },
    });
    expect(mocks.adapter.denyOrder).toHaveBeenCalledOnce();
    expect(mocks.adapter.denyOrder).toHaveBeenCalledWith(
      "uber-order-1",
      "Uber Eats TWD amount unit is unverified",
      expect.objectContaining({ storeId: "store-1" }),
    );
    expect(mutations.updated[0]).toMatchObject({
      status: "failed",
      error: "Uber Eats TWD amount unit is unverified",
    });
    expect(mutations.updated[0]).not.toHaveProperty("platformEventId");
  });

  it("returns 500 for redelivery when denying a rejected order fails", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.adapter.denyOrder.mockRejectedValueOnce(new Error("Uber 503"));
    mocks.orderService.processWebhook.mockRejectedValueOnce(
      new PlatformOrderRejectedError("Platform order currency mismatch"),
    );

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(500);
    expect(mocks.adapter.denyOrder).toHaveBeenCalledWith(
      "uber-order-1",
      "Platform order currency mismatch",
      expect.any(Object),
    );
    expect(mutations.updated[0]).toMatchObject({
      status: "failed",
      platformEventId: null,
    });
  });

  it("acknowledges a duplicate event before creating another order", async () => {
    const mutations = mockMutations([]);
    mockSelectResults({ platformIntegrations: [[integration()]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: { duplicate: true },
    });
    expect(mocks.orderService.processWebhook).not.toHaveBeenCalled();
    expect(mutations.inserted[0]).toMatchObject({
      platform: "uber_eats",
      platformEventId: "event-1",
    });
    expect(mutations.onConflictDoNothing).toHaveBeenCalled();
  });

  it("reserves the camelCase event id the idempotency middleware also accepts", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify({
        ...webhookPayload(),
        event_id: undefined,
        eventId: "event-camel",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(mutations.inserted[0]).toMatchObject({
      platformEventId: "event-camel",
    });
  });

  it("processes platform cancellations without echoing them into order creation", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload({ event_type: "orders.cancel" })),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { handled: true } });
    expect(mocks.orderService.processWebhook).not.toHaveBeenCalled();
    expect(mocks.orderService.processCancellation).toHaveBeenCalledWith(
      "uber_eats",
      webhookPayload({ event_type: "orders.cancel" }),
      "restaurant-1",
    );
    expect(mutations.updated[0]).toMatchObject({ status: "processed" });
  });

  it("acknowledges an unmapped cancellation as ignored", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.orderService.processCancellation.mockResolvedValueOnce({
      handled: false,
    });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload({ event_type: "order.cancelled" })),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(mutations.updated[0]).toMatchObject({ status: "ignored" });
  });

  it("records a real cancellation failure and returns 500 for redelivery", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.orderService.processCancellation.mockRejectedValueOnce(
      new Error("D1 unavailable"),
    );

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload({ event_type: "order.cancelled" })),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(500);
    expect(mutations.updated[0]).toMatchObject({
      status: "failed",
      error: "D1 unavailable",
      platformEventId: null,
    });
  });

  it("ignores an event type that announces neither a new order nor a cancellation", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(
        webhookPayload({ event_type: "orders.status_changed" }),
      ),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        acknowledged: true,
        eventType: "orders.status_changed",
        handled: false,
      },
    });
    // Routing anything but a creation event through order creation is what
    // produced the orphan orders in #237, and the cancellation branch must not
    // swallow unrelated types either.
    expect(mocks.orderService.processWebhook).not.toHaveBeenCalled();
    expect(mocks.orderService.processCancellation).not.toHaveBeenCalled();
    expect(mutations.updated[0]).toMatchObject({ status: "ignored" });
  });

  it("acknowledges payment events without order processing", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload({ event_type: "payment.succeeded" })),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: {
        acknowledged: true,
        eventType: "payment.succeeded",
      },
    });
    expect(mocks.orderService.processWebhook).not.toHaveBeenCalled();
    expect(mutations.updated).toEqual([
      expect.objectContaining({ status: "processed" }),
    ]);
  });

  it("configures the idempotency middleware to release the key on a 5xx", () => {
    // This suite mocks the middleware to a pass-through, so the replay
    // behaviour itself is covered in `middleware/idempotency.test.ts`. What
    // has to be pinned here is the wiring: without this flag the 500 below is
    // cached for the whole TTL and the released `platform_event_id` never
    // gets a redelivery to accept.
    expect(idempotencyOptions).toContainEqual(
      expect.objectContaining({ releaseOnServerError: true }),
    );
  });

  it("logs failed order processing and returns an error", async () => {
    const mutations = mockMutations();
    mockSelectResults({ platformIntegrations: [[integration()]] });
    mocks.orderService.processWebhook.mockRejectedValueOnce(
      new Error("menu item missing"),
    );

    const response = await request("/uber-eats", {
      method: "POST",
      body: JSON.stringify(webhookPayload()),
      headers: { "Content-Type": "application/json" },
    });
    const body = await json(response);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: {
        code: "WEBHOOK_PROCESSING_FAILED",
        message: "Processing failed",
      },
    });
    // The reservation is released so the platform's redelivery is processed
    // rather than acknowledged as a duplicate that never happened.
    expect(mutations.updated[0]).toMatchObject({
      status: "failed",
      error: "menu item missing",
      platformEventId: null,
    });
  });

  it("returns not implemented for foodpanda webhooks", async () => {
    const response = await request("/foodpanda", { method: "POST" });
    const body = await json(response);

    expect(response.status).toBe(501);
    expect(body).toEqual({
      success: false,
      error: {
        code: "INTEGRATION_NOT_AVAILABLE",
        message: "Foodpanda integration not yet implemented",
      },
    });
  });
});
