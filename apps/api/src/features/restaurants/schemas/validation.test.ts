import { describe, expect, it } from "vitest";
import { restaurantSchemas } from "./validation";

describe("restaurant validation schemas", () => {
  it("validates restaurant creation and business hours", () => {
    expect(
      restaurantSchemas.create.parse({
        name: "Nasi House",
        type: "restaurant",
        category: "Malaysian",
        address: "1 Market St",
        district: "Central",
        phone: "+886 912 345 678",
        businessHours: {
          monday: { open: "09:00", close: "21:00", isOpen: true },
        },
      }),
    ).toMatchObject({
      name: "Nasi House",
      businessHours: {
        monday: { open: "09:00", close: "21:00", isOpen: true },
      },
    });

    expect(() =>
      restaurantSchemas.create.parse({
        name: "Nasi House",
        type: "restaurant",
        category: "Malaysian",
        address: "1 Market St",
        district: "Central",
        phone: "bad",
      }),
    ).toThrow("Phone number must be at least 8 characters");
  });

  it("accepts only platform currencies in settings, and no currency at all", () => {
    for (const currency of ["TWD", "MYR", "VND"]) {
      expect(
        restaurantSchemas.update.safeParse({ settings: { currency } }).success,
      ).toBe(true);
    }
    expect(
      restaurantSchemas.update.safeParse({
        settings: { autoAcceptOrders: true },
      }).success,
    ).toBe(true);
    for (const currency of ["USD", "twd", "NT$", ""]) {
      expect(
        restaurantSchemas.update.safeParse({ settings: { currency } }).success,
      ).toBe(false);
    }
  });

  it("decodes contact URLs and sanitizes FAQs", () => {
    expect(
      restaurantSchemas.updateContactProfile.parse({
        messagingChannels: {
          line: "https://line.example.test/r/abc&amp;ref=shop",
        },
        faqs: [
          {
            question: "Do you serve <b>lunch</b>?",
            answer: "Yes &lt;daily&gt;",
            keywords: ["<lunch>"],
          },
        ],
      }),
    ).toEqual({
      messagingChannels: {
        line: "https://line.example.test/r/abc&ref=shop",
      },
      faqs: [
        {
          question: "Do you serve blunch/b?",
          answer: "Yes daily",
          keywords: ["lunch"],
        },
      ],
    });
  });

  it("applies service item defaults and update constraints", () => {
    expect(
      restaurantSchemas.createServiceItem.parse({
        name: "Private dining",
      }),
    ).toMatchObject({
      name: "Private dining",
      serviceType: "general",
      requiresBooking: false,
      paymentRequirement: "pay_at_venue",
      depositAmountCents: 0,
    });

    expect(() => restaurantSchemas.updateServiceItem.parse({})).toThrow(
      "At least one field is required",
    );
  });

  it("validates merchant-configured service booking payment terms", () => {
    expect(
      restaurantSchemas.createServiceItem.parse({
        name: "Facial",
        priceCents: 5000,
        paymentRequirement: "deposit",
        depositAmountCents: 1200,
      }),
    ).toMatchObject({
      paymentRequirement: "deposit",
      depositAmountCents: 1200,
    });

    expect(() =>
      restaurantSchemas.createServiceItem.parse({
        name: "Facial",
        priceCents: 5000,
        paymentRequirement: "deposit",
        depositAmountCents: 0,
      }),
    ).toThrow("positive deposit");
    expect(() =>
      restaurantSchemas.createServiceItem.parse({
        name: "Facial",
        priceCents: 5000,
        paymentRequirement: "deposit",
        depositAmountCents: 5001,
      }),
    ).toThrow("no greater than the service price");
  });

  it("rejects non-http service booking URLs", () => {
    expect(() =>
      restaurantSchemas.createServiceItem.parse({
        name: "Private dining",
        bookingUrl: "javascript:alert(1)",
      }),
    ).toThrow("URL must use http or https");

    expect(
      restaurantSchemas.createServiceItem.parse({
        name: "Private dining",
        bookingUrl: "https://booking.example.test/private",
      }),
    ).toMatchObject({
      bookingUrl: "https://booking.example.test/private",
    });
  });

  it("transforms list and shop QR params", () => {
    expect(
      restaurantSchemas.list.parse({
        page: "2",
        limit: "50",
        isAvailable: "true",
      }),
    ).toEqual({ page: 2, limit: 50, isAvailable: true });

    expect(restaurantSchemas.nearby.parse({})).toEqual({ limit: 10 });
    expect(
      restaurantSchemas.qrCodeParams.parse({
        qrCode: "SHOP-019fa136-cfe3-709f-a2ab-f8a3ebcd31a1-1785563580",
      }),
    ).toEqual({
      qrCode: "SHOP-019fa136-cfe3-709f-a2ab-f8a3ebcd31a1-1785563580",
    });
  });
});
