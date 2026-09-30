import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrintRequest } from "@makanmasak/shared-types";
import { ReceiptFormattingService } from "./ReceiptFormattingService";
import { ReceiptFormatterFactory } from "./ReceiptFormatterFactory";
import { CommandBuilder } from "../commands/CommandBuilder";

const createReceiptRequest = (): PrintRequest => ({
  country: "TW",
  type: "receipt",
  restaurantId: "restaurant-1",
  data: {
    order: {
      id: "order-123",
      tableNumber: "A1",
      createdAt: new Date("2026-06-07T00:00:00.000Z"),
      items: [
        {
          name: "Beef Noodles",
          quantity: 2,
          price: 120,
          modifiers: [{ name: "Extra spicy", price: 10 }],
        },
      ],
      subtotal: 250,
      tax: 12.5,
      total: 262.5,
    },
    customer: {
      name: "Lin",
    },
    payment: {
      method: "credit_card",
      amount: 300,
      change: 37.5,
      cardLast4: "1234",
      transactionId: "txn-123",
    },
  },
});

describe("ReceiptFormattingService", () => {
  it("formats kitchen time in the configured region regardless of agent defaults", async () => {
    const request = createReceiptRequest();
    request.type = "kitchen";
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(() => {
      throw new Error("Ambient locale/timezone must not format kitchen time");
    });
    const service = new ReceiptFormattingService();
    const content = await service.formatReceipt(request);
    expect(CommandBuilder.kitchenLines(content).join("\n")).toMatch(
      /2026\/6\/7\s08:00:00/,
    );
    service.updateRegion("TW", { timezone: "Asia/Ho_Chi_Minh" });
    expect(
      CommandBuilder.kitchenLines(await service.formatReceipt(request)).join(
        "\n",
      ),
    ).toMatch(/2026\/6\/7\s07:00:00/);
  });

  it("leaves a shared frozen formatter result unchanged between requests", async () => {
    const request = createReceiptRequest();
    const service = new ReceiptFormattingService();
    const shared = await service.formatReceipt(request);
    Object.freeze(shared.header.transactionInfo);
    Object.freeze(shared.header);
    Object.freeze(shared);
    const formatter = ReceiptFormatterFactory.createFormatter(
      "TW",
      service.getRegionConfig("TW"),
    );
    const format = vi.spyOn(formatter, "formatReceipt").mockReturnValue(shared);
    const create = vi
      .spyOn(ReceiptFormatterFactory, "createFormatter")
      .mockReturnValue(formatter);
    request.type = "kitchen";
    const kitchen = await service.formatReceipt(request);
    request.type = "receipt";
    const receipt = await service.formatReceipt(request);
    expect(kitchen.type).toBe("kitchen");
    expect(receipt.type).toBe("receipt");
    expect(shared.type).toBe("receipt");
    expect(shared.header.transactionInfo).not.toHaveProperty("timestampText");
    expect(create).toHaveBeenCalledTimes(2);
    expect(format).toHaveBeenCalledTimes(2);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("formats receipt content from PrintRequest data", async () => {
    const service = new ReceiptFormattingService();

    const receipt = await service.formatReceipt(createReceiptRequest());

    expect(receipt.header.transactionInfo.orderId).toBe("order-123");
    expect(receipt.header.transactionInfo.tableNumber).toBe("A1");
    expect(receipt.header.transactionInfo.customerName).toBe("Lin");
    expect(receipt.items).toEqual([
      expect.objectContaining({
        name: "Beef Noodles",
        quantity: 2,
        unitPrice: 120,
        totalPrice: 240,
        modifiers: [{ name: "Extra spicy", price: 10 }],
      }),
    ]);
    expect(receipt.summary).toEqual(
      expect.objectContaining({
        subtotal: 250,
        total: 262.5,
        change: 37.5,
      }),
    );
    expect(receipt.summary.payment).toEqual([
      expect.objectContaining({
        method: "信用卡",
        amount: 300,
        details: "**** 1234",
      }),
    ]);
  });

  // 三個國別 formatter 各自組自己的 summary，任何一個漏掉外送費，那一國的
  // 收據就會小計加稅對不上總額（#348）。
  it("carries the delivery fee and address through every region's formatter", async () => {
    const service = new ReceiptFormattingService();

    for (const country of ["TW", "MY", "VN"] as const) {
      const request = createReceiptRequest();
      request.country = country;
      request.data.order.deliveryAddress = "台中市西屯區台灣大道三段99號";
      request.data.order.deliveryPhone = "0912345678";
      request.data.order.deliveryFee = 5;
      request.data.order.total = 267.5;

      const receipt = await service.formatReceipt(request);

      expect(receipt.summary.deliveryFee).toBe(5);
      expect(receipt.header.transactionInfo.deliveryAddress).toBe(
        "台中市西屯區台灣大道三段99號",
      );
      expect(receipt.header.transactionInfo.deliveryPhone).toBe("0912345678");
    }
  });

  it("generates Taiwan receipt numbers without Math.random", async () => {
    vi.setSystemTime(new Date("2026-06-07T00:00:00.000Z"));
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "fedcba98-7654-4000-8000-fedcba987654",
    );
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random should not be used for receipt numbers");
    });
    const service = new ReceiptFormattingService();

    const receipt = await service.formatReceipt(createReceiptRequest());

    expect(receipt.header.transactionInfo.receiptNumber).toBe(
      "TW1780790400000-FEDCBA98",
    );
    expect(randomSpy).not.toHaveBeenCalled();
  });
});
