import { describe, expect, it, vi } from "vitest";
import { createAlertPresenter } from "./alertPresentation";
import type { EmergencyAlert } from "@/services/ownerService";

function alert(overrides: Partial<EmergencyAlert> = {}): EmergencyAlert {
  return {
    id: "0198c3a4-5b6c-7d8e-9f01-234567890abc",
    alertType: "inventory_low",
    severity: "high",
    title: "Coconut milk is below its minimum stock level",
    description: "Coconut milk is at 2 L, below the 5 L minimum.",
    details: {
      name: "Coconut milk",
      currentStock: 2,
      minStockLevel: 5,
      unit: "L",
    },
    createdAt: 1757116800000,
    ...overrides,
  };
}

/** Stand-in for vue-i18n: echoes the key so assertions can see what was asked. */
const echoT = (key: string) => `t:${key}`;
const identityStatus = (status: string) => status;

describe("createAlertPresenter", () => {
  it("renders a known alert type through its locale key", () => {
    const t = vi.fn(echoT);
    const presenter = createAlertPresenter(t, identityStatus);

    expect(presenter.title(alert())).toBe("t:owner.alerts.inventory_low.title");
    expect(t).toHaveBeenCalledWith(
      "owner.alerts.inventory_low.title",
      expect.objectContaining({
        name: "Coconut milk",
        currentStock: 2,
        minStockLevel: 5,
        unit: "L",
      }),
    );
  });

  it("passes the same details to the description key", () => {
    const t = vi.fn(echoT);
    const presenter = createAlertPresenter(t, identityStatus);

    expect(presenter.description(alert())).toBe(
      "t:owner.alerts.inventory_low.description",
    );
  });

  // A producer shipped without locale keys must not show the owner a raw key.
  it("falls back to the stored English for an unknown alert type", () => {
    const t = vi.fn(echoT);
    const presenter = createAlertPresenter(t, identityStatus);
    const unknown = alert({
      alertType: "table_unattended",
      title: "Table 7 has been waiting",
      description: "Table 7 has had no service for 20 minutes.",
    });

    expect(presenter.title(unknown)).toBe("Table 7 has been waiting");
    expect(presenter.description(unknown)).toBe(
      "Table 7 has had no service for 20 minutes.",
    );
    expect(t).not.toHaveBeenCalled();
  });

  // #350: a refused payment reaches the panel with the order and the reason,
  // both of which have to survive into the translated message.
  it("renders a payment failure through its locale key", () => {
    const t = vi.fn(echoT);
    const presenter = createAlertPresenter(t, identityStatus);
    const paymentFailed = alert({
      alertType: "payment_failed",
      severity: "critical",
      title: "Payment failed for order A-001",
      description: "Payment for order A-001 was refused (UNEXPECTED_ERROR).",
      details: {
        orderId: "0198c3a4-5b6c-7d8e-9f01-2345678900ff",
        orderNumber: "A-001",
        errorCode: "UNEXPECTED_ERROR",
        paymentMode: "full",
        submittedAmount: 119,
        serverTotal: 120,
        currency: "TWD",
      },
    });

    expect(presenter.title(paymentFailed)).toBe(
      "t:owner.alerts.payment_failed.title",
    );
    expect(presenter.description(paymentFailed)).toBe(
      "t:owner.alerts.payment_failed.description",
    );
    expect(t).toHaveBeenCalledWith(
      "owner.alerts.payment_failed.title",
      expect.objectContaining({
        orderNumber: "A-001",
        errorCode: "UNEXPECTED_ERROR",
        submittedAmount: 119,
        serverTotal: 120,
        currency: "TWD",
      }),
    );
  });

  // The status inside an alert has to read the same as the status everywhere
  // else on the dashboard, so it goes through the view's own translator.
  it("translates an order status through the supplied translator", () => {
    const t = vi.fn(echoT);
    const translateStatus = vi.fn(() => "準備中");
    const presenter = createAlertPresenter(t, translateStatus);

    presenter.description(
      alert({
        alertType: "order_overdue",
        details: { orderNumber: "A-001", minutesLate: 35, status: "preparing" },
      }),
    );

    expect(translateStatus).toHaveBeenCalledWith("preparing");
    expect(t).toHaveBeenCalledWith(
      "owner.alerts.order_overdue.description",
      expect.objectContaining({
        orderNumber: "A-001",
        minutesLate: 35,
        status: "準備中",
      }),
    );
  });

  // `details` is a JSON column, so it can hold values a message cannot render.
  it("drops values that cannot be interpolated", () => {
    const t = vi.fn(echoT);
    const presenter = createAlertPresenter(t, identityStatus);

    presenter.title(
      alert({
        details: {
          name: "Coconut milk",
          currentStock: 2,
          tracked: true,
          supplier: null,
          history: [1, 2, 3],
          meta: { nested: true },
        },
      }),
    );

    expect(t).toHaveBeenCalledWith("owner.alerts.inventory_low.title", {
      name: "Coconut milk",
      currentStock: 2,
      tracked: "true",
    });
  });

  it("leaves a non-string status untouched", () => {
    const t = vi.fn(echoT);
    const translateStatus = vi.fn();
    const presenter = createAlertPresenter(t, translateStatus);

    presenter.description(
      alert({ alertType: "order_overdue", details: { status: 3 } }),
    );

    expect(translateStatus).not.toHaveBeenCalled();
    expect(t).toHaveBeenCalledWith(
      "owner.alerts.order_overdue.description",
      expect.objectContaining({ status: 3 }),
    );
  });

  it.each([
    ["null details", null],
    ["absent details", undefined],
  ])("renders with %s rather than throwing", async (_label, details) => {
    const t = vi.fn(echoT);
    const presenter = createAlertPresenter(t, identityStatus);

    expect(presenter.title(alert({ details }))).toBe(
      "t:owner.alerts.inventory_low.title",
    );
    expect(t).toHaveBeenCalledWith("owner.alerts.inventory_low.title", {});
  });
});
