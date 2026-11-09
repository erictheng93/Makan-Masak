import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { ApiError } from "../../../shared/utils/api-error";

/**
 * `/lock` proves the caller holds the host's memberToken before it turns a
 * cart into a real order. Three sibling routes that are just as consequential
 * prove nothing at all.
 *
 * The groupOrderId is a UUID, so this is not about outsiders — it is shared
 * with everyone at the table by design. The exposure is member-to-member: any
 * member holding the id can act on any other member.
 *
 * These tests pin who may do what. The rule differs per route, so they assert
 * the outcome rather than naming a service method:
 *
 *   /split           host only — it locks the group and creates the bills
 *   /payment/:id     host only — it marks money as received
 *   /leave/:id       that member, or the host removing someone
 */
const groupServiceMocks = vi.hoisted(() => ({
  splitBill: vi.fn(),
  processPayment: vi.fn(),
  leaveGroup: vi.fn(),
  addCartItem: vi.fn(),
  updateCartItem: vi.fn(),
  removeCartItem: vi.fn(),
  setAutoSubmitOnExpiry: vi.fn(),
  setSplitType: vi.fn(),
  setFeeMode: vi.fn(),
  isHostSession: vi.fn(),
  isMemberSession: vi.fn(),
  getGroupOrder: vi.fn(),
  getGroupOrderStatus: vi.fn(),
}));

vi.mock("../services/GroupOrdersService", () => ({
  GroupOrdersService: vi.fn(function GroupOrdersService() {
    return groupServiceMocks;
  }),
}));

vi.mock("@makanmasak/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@makanmasak/database")>();
  return {
    ...actual,
    RealtimeBroadcastService: vi.fn(function RealtimeBroadcastService() {
      return {
        generateEventId: () => "evt-1",
        broadcastEvent: vi.fn(async () => undefined),
      };
    }),
  };
});

import groupOrdersRoutes from "./index";

const GROUP_ORDER_ID = "018ffb9a-7b8a-7c3d-9f23-123456789abc";
const HOST_MEMBER_ID = "018ffb9a-7b8a-7c3d-9f23-1234567890a1";
const OTHER_MEMBER_ID = "018ffb9a-7b8a-7c3d-9f23-1234567890a2";
const HOST_TOKEN = "host-session-token";
const OTHER_TOKEN = "other-session-token";
const ITEM_ID = "018ffb9a-7b8a-7c3d-9f23-1234567890b1";
const CSRF = "b".repeat(64);

function buildApp() {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(
        { success: false, error: { code: err.code, message: err.message } },
        err.status as 400 | 403 | 404,
      );
    }
    return c.json({ success: false, error: { message: String(err) } }, 500);
  });
  app.route("/orders/group", groupOrdersRoutes);
  return app;
}

const env = { DB: {}, CACHE_KV: {} } as never;

async function call(method: string, path: string, body?: unknown) {
  const response = await buildApp().fetch(
    new Request(`https://test${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: "https://test",
        host: "test",
        "x-csrf-token": CSRF,
        cookie: `csrf_token=${CSRF}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: response.status };
}

/** Only the host's token is genuine in these tests. */
function onlyHostTokenIsValid() {
  groupServiceMocks.isHostSession.mockImplementation(
    async (_groupOrderId: string, token: string) => token === HOST_TOKEN,
  );
  groupServiceMocks.isMemberSession.mockImplementation(
    async (_groupOrderId: string, memberId: string, token: string) =>
      (memberId === HOST_MEMBER_ID && token === HOST_TOKEN) ||
      (memberId === OTHER_MEMBER_ID && token === OTHER_TOKEN),
  );
}

describe("group order mutations require proof of who is calling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onlyHostTokenIsValid();
    groupServiceMocks.splitBill.mockResolvedValue({ success: true, data: [] });
    groupServiceMocks.processPayment.mockResolvedValue({
      success: true,
      data: {},
    });
    groupServiceMocks.leaveGroup.mockResolvedValue({ success: true });
    groupServiceMocks.addCartItem.mockResolvedValue({
      success: true,
      data: { id: ITEM_ID, quantity: 1 },
      restaurantId: "rest-1",
    });
    groupServiceMocks.updateCartItem.mockResolvedValue({
      success: true,
      data: { id: ITEM_ID, quantity: 2 },
    });
    groupServiceMocks.removeCartItem.mockResolvedValue({ success: true });
    groupServiceMocks.setAutoSubmitOnExpiry.mockResolvedValue({
      success: true,
      data: { autoSubmitOnExpiry: true },
    });
    groupServiceMocks.setSplitType.mockResolvedValue({
      success: true,
      data: { splitType: "equal", restaurantId: "rest-1" },
    });
    groupServiceMocks.setFeeMode.mockResolvedValue({
      success: true,
      data: { feeMode: "equal", restaurantId: "rest-1" },
    });
    groupServiceMocks.getGroupOrder.mockResolvedValue({
      groupOrder: { id: GROUP_ORDER_ID, restaurantId: "rest-1" },
    });
    groupServiceMocks.getGroupOrderStatus.mockResolvedValue("active");
  });

  describe("POST /:groupOrderId/split", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/split`,
        { splitType: "equal" },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.splitBill).not.toHaveBeenCalled();
    });

    it("refuses a member who is not the host", async () => {
      // Splitting locks the cart for everyone. One member should not be able
      // to end ordering for the table.
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/split`,
        { splitType: "equal", memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.splitBill).not.toHaveBeenCalled();
    });

    it("allows the host", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/split`,
        { splitType: "equal", memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.splitBill).toHaveBeenCalledOnce();
    });
  });

  describe("POST /:groupOrderId/payment/:memberId", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/payment/${OTHER_MEMBER_ID}`,
        { paymentMethod: "cash" },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.processPayment).not.toHaveBeenCalled();
    });

    // This used to be host-only, on the reading that the record meant "the
    // restaurant received money" — and self-service would let anyone walk out
    // having declared themselves paid. No money moves through here: the record
    // is one diner telling the table they have settled their own share, which
    // is the entire point of splitting. If a real cash or card flow is added,
    // takings need their own staff-confirmed state rather than this flag.
    it("lets a member settle their own share", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/payment/${OTHER_MEMBER_ID}`,
        { paymentMethod: "cash", memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.processPayment).toHaveBeenCalledOnce();
    });

    it("still refuses a member settling somebody else's share", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/payment/${HOST_MEMBER_ID}`,
        { paymentMethod: "cash", memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.processPayment).not.toHaveBeenCalled();
    });

    it("allows the host to settle a member's bill", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/payment/${OTHER_MEMBER_ID}`,
        { paymentMethod: "cash", memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.processPayment).toHaveBeenCalledOnce();
    });
  });

  describe("POST /:groupOrderId/leave/:memberId", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/leave/${OTHER_MEMBER_ID}`,
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.leaveGroup).not.toHaveBeenCalled();
    });

    it("lets a member leave using their own token", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/leave/${OTHER_MEMBER_ID}`,
        { memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.leaveGroup).toHaveBeenCalledOnce();
    });

    it("refuses one member removing another", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/leave/${HOST_MEMBER_ID}`,
        { memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.leaveGroup).not.toHaveBeenCalled();
    });

    it("lets the host remove someone", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/leave/${OTHER_MEMBER_ID}`,
        { memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.leaveGroup).toHaveBeenCalledOnce();
    });
  });

  /**
   * The cart routes are the ones a table actually hammers — once per dish,
   * not once per meal like /split or /lock. They take `memberId` from the
   * body and never check it against anything, so the id that ends up on the
   * item (and therefore on that person's share of the bill) is whatever the
   * caller typed. Member ids are not secret either: `GET /:groupOrderId`
   * lists every member, so possession of the group id is enough to name
   * someone else.
   *
   * The chosen rule is "prove you are who you claim, then edit the shared
   * cart freely": a member may change or delete anyone's item, but may not
   * act under another member's name. Attribution has to be honest because it
   * decides who pays for the dish; editing is deliberately communal.
   */
  describe("POST /:groupOrderId/cart", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/cart`,
        { memberId: OTHER_MEMBER_ID, menuItemId: 101, quantity: 1 },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.addCartItem).not.toHaveBeenCalled();
    });

    it("refuses a member adding a dish under someone else's name", async () => {
      // The item carries memberId into the split, so a member who can forge
      // it can put their dinner on another diner's bill.
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/cart`,
        {
          memberId: HOST_MEMBER_ID,
          menuItemId: 101,
          quantity: 1,
          memberToken: OTHER_TOKEN,
        },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.addCartItem).not.toHaveBeenCalled();
    });

    it("allows a member adding a dish under their own name", async () => {
      const { status } = await call(
        "POST",
        `/orders/group/${GROUP_ORDER_ID}/cart`,
        {
          memberId: OTHER_MEMBER_ID,
          menuItemId: 101,
          quantity: 1,
          memberToken: OTHER_TOKEN,
        },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.addCartItem).toHaveBeenCalledOnce();
    });
  });

  describe("PUT /:groupOrderId/cart/:itemId", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`,
        { quantity: 2 },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.updateCartItem).not.toHaveBeenCalled();
    });

    it("refuses a caller whose name does not match their token", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`,
        { quantity: 2, memberId: HOST_MEMBER_ID, memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.updateCartItem).not.toHaveBeenCalled();
    });

    it("lets a member change an item another member added", async () => {
      // Deliberate: one person at the table adjusting a shared order is
      // normal. This is the permissive half of the rule, pinned so nobody
      // tightens it by accident.
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`,
        { quantity: 2, memberId: OTHER_MEMBER_ID, memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.updateCartItem).toHaveBeenCalledOnce();
    });
  });

  describe("DELETE /:groupOrderId/cart/:itemId", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "DELETE",
        `/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`,
        { memberId: OTHER_MEMBER_ID },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.removeCartItem).not.toHaveBeenCalled();
    });

    it("refuses a caller whose name does not match their token", async () => {
      const { status } = await call(
        "DELETE",
        `/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`,
        { memberId: HOST_MEMBER_ID, memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.removeCartItem).not.toHaveBeenCalled();
    });

    it("lets a member remove an item another member added", async () => {
      const { status } = await call(
        "DELETE",
        `/orders/group/${GROUP_ORDER_ID}/cart/${ITEM_ID}`,
        { memberId: OTHER_MEMBER_ID, memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.removeCartItem).toHaveBeenCalledOnce();
    });
  });

  /**
   * Auto-submit decides whether a table that never pressed submit still ends
   * up with a real order at expiry. That is the host's call — a member who
   * flipped it on could leave the table committed to a bill nobody confirmed,
   * and a member who flipped it off could quietly discard an order the host
   * meant to place.
   */
  describe("PUT /:groupOrderId/auto-submit", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/auto-submit`,
        { enabled: true },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.setAutoSubmitOnExpiry).not.toHaveBeenCalled();
    });

    it("refuses a member who is not the host", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/auto-submit`,
        { enabled: true, memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.setAutoSubmitOnExpiry).not.toHaveBeenCalled();
    });

    it("lets the host turn it on", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/auto-submit`,
        { enabled: true, memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.setAutoSubmitOnExpiry).toHaveBeenCalledWith(
        GROUP_ORDER_ID,
        true,
      );
    });

    it("lets the host turn it back off", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/auto-submit`,
        { enabled: false, memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.setAutoSubmitOnExpiry).toHaveBeenCalledWith(
        GROUP_ORDER_ID,
        false,
      );
    });
  });

  /**
   * How the bill gets divided decides what each person is asked to pay, so it
   * belongs to the host for the same reason /split does. Unlike /split it does
   * not end ordering — this only records the choice finalize will use.
   */
  describe("PUT /:groupOrderId/split-type", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/split-type`,
        { splitType: "equal" },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.setSplitType).not.toHaveBeenCalled();
    });

    it("refuses a member who is not the host", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/split-type`,
        { splitType: "equal", memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.setSplitType).not.toHaveBeenCalled();
    });

    it("lets the host choose a split method", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/split-type`,
        { splitType: "by_item", memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.setSplitType).toHaveBeenCalledWith(
        GROUP_ORDER_ID,
        "by_item",
      );
    });

    it("rejects a split method the finalize path cannot carry out", async () => {
      // `custom` and `single_payer` need per-member amounts, and a group order
      // has nowhere to keep them. Storing either would make finalize fail with
      // "Custom amounts are required" long after the host made the choice.
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/split-type`,
        { splitType: "custom", memberToken: HOST_TOKEN },
      );

      expect(status).toBe(400);
      expect(groupServiceMocks.setSplitType).not.toHaveBeenCalled();
    });
  });

  /**
   * Who pays the service charge is the host's call for the same reason the
   * split method is: a member could otherwise move the whole fee onto the host,
   * or off themselves and onto everyone else.
   */
  describe("PUT /:groupOrderId/fee-mode", () => {
    it("refuses a caller with no token", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/fee-mode`,
        { feeMode: "equal" },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.setFeeMode).not.toHaveBeenCalled();
    });

    it("refuses a member who is not the host", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/fee-mode`,
        { feeMode: "host", memberToken: OTHER_TOKEN },
      );

      expect(status).toBe(403);
      expect(groupServiceMocks.setFeeMode).not.toHaveBeenCalled();
    });

    it("lets the host change who carries the fee", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/fee-mode`,
        { feeMode: "host", memberToken: HOST_TOKEN },
      );

      expect(status).toBe(200);
      expect(groupServiceMocks.setFeeMode).toHaveBeenCalledWith(
        GROUP_ORDER_ID,
        "host",
      );
    });

    it("rejects a mode that is not one of the three", async () => {
      const { status } = await call(
        "PUT",
        `/orders/group/${GROUP_ORDER_ID}/fee-mode`,
        { feeMode: "whoever", memberToken: HOST_TOKEN },
      );

      expect(status).toBe(400);
      expect(groupServiceMocks.setFeeMode).not.toHaveBeenCalled();
    });
  });

  it("does not tell an unauthorised caller whether the group order exists", async () => {
    groupServiceMocks.isHostSession.mockResolvedValue(false);
    groupServiceMocks.isMemberSession.mockResolvedValue(false);

    const known = await call("POST", `/orders/group/${GROUP_ORDER_ID}/split`, {
      splitType: "equal",
      memberToken: "wrong",
    });
    const unknown = await call(
      "POST",
      "/orders/group/018ffb9a-7b8a-7c3d-9f23-999999999999/split",
      { splitType: "equal", memberToken: "wrong" },
    );

    expect(known.status).toBe(unknown.status);
  });
});
