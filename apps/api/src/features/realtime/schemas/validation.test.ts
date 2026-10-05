import { describe, expect, it } from "vitest";
import {
  guestRealtimeTokenRequestSchema,
  webSocketTokenRequestSchema,
} from "./validation";

describe("realtime validation schemas", () => {
  it("accepts staff websocket token requests", () => {
    expect(
      webSocketTokenRequestSchema.parse({
        roomType: "kitchen",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: "session-1",
      }),
    ).toEqual({
      roomType: "kitchen",
      roomId: "restaurant-1",
      restaurantId: "restaurant-1",
      sessionId: "session-1",
    });
  });

  it("requires valid room details", () => {
    expect(() =>
      webSocketTokenRequestSchema.parse({
        roomType: "unknown",
        roomId: "",
        restaurantId: "restaurant-1",
      }),
    ).toThrow(/Invalid room type|Room ID is required/);
  });

  it("rejects the `restaurant` room: the realtime Worker has no route for it", () => {
    expect(() =>
      webSocketTokenRequestSchema.parse({
        roomType: "restaurant",
        roomId: "restaurant-1",
        restaurantId: "restaurant-1",
        sessionId: "session-1",
      }),
    ).toThrow(/Invalid room type/);
  });

  it("rejects customer room requests so they cannot bypass guest verification", () => {
    expect(() =>
      webSocketTokenRequestSchema.parse({
        roomType: "customer",
        roomId: "any-room",
        restaurantId: "restaurant-1",
      }),
    ).toThrow(/Invalid room type/);

    // Supplying a table ID must not re-open the customer path either: table IDs
    // are guessable sequential integers, not proof of presence at a table.
    expect(() =>
      webSocketTokenRequestSchema.parse({
        roomType: "customer",
        roomId: "any-room",
        restaurantId: "restaurant-1",
        tableId: "7",
      }),
    ).toThrow(/Invalid room type/);
  });

  it("accepts guest token exchange only with an order id", () => {
    const guestToken = `gt_${"a".repeat(64)}`;
    expect(
      guestRealtimeTokenRequestSchema.parse({
        restaurantId: "restaurant-1",
        guestToken,
        orderId: 1001,
      }),
    ).toMatchObject({
      restaurantId: "restaurant-1",
      guestToken,
      orderId: "1001",
    });

    expect(() =>
      guestRealtimeTokenRequestSchema.parse({
        restaurantId: "restaurant-1",
        guestToken,
      }),
    ).toThrow(/Order ID is required/);
  });

  it("requires signed table QR details when no guest token is provided", () => {
    expect(
      guestRealtimeTokenRequestSchema.parse({
        restaurantId: "restaurant-1",
        tableId: 12,
        qrCode: "https://shop.example.test/qr/signed",
      }),
    ).toMatchObject({
      tableId: "12",
      qrCode: "https://shop.example.test/qr/signed",
    });

    expect(() =>
      guestRealtimeTokenRequestSchema.parse({
        restaurantId: "restaurant-1",
        tableId: 12,
      }),
    ).toThrow(/signed table.*QR details/);
  });

  it("accepts signed seat QR details without a table id", () => {
    expect(
      guestRealtimeTokenRequestSchema.parse({
        restaurantId: "restaurant-1",
        seatId: 21,
        qrCode: "https://shop.example.test/order?t=seat",
      }),
    ).toMatchObject({
      restaurantId: "restaurant-1",
      seatId: "21",
      qrCode: "https://shop.example.test/order?t=seat",
    });
  });
});
