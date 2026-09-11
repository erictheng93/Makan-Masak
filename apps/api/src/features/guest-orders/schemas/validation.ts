/**
 * Guest Orders Validation Schemas
 * Zod validation for guest (unauthenticated) order endpoints
 */

import { z } from "zod";

// Sanitize free-text user input by removing HTML metacharacters instead of
// trying to strip whole tags/attributes, which can be bypassed by overlap.
const sanitizeFreeText = (input: string): string => {
  return input.replace(/[<>"`=]/g, "");
};

const notesSchema = (maxLength: number) =>
  z.string().max(maxLength).transform(sanitizeFreeText);

const selectedCustomizationsSchema = z
  .object({
    size: z
      .object({
        id: z.string(),
        name: z.string(),
        priceAdjustment: z.number().optional(),
      })
      .optional(),
    options: z
      .array(
        z.object({
          id: z.string(),
          optionName: z.string(),
          choiceId: z.string(),
          choiceName: z.string(),
          priceAdjustment: z.number().optional(),
        }),
      )
      .optional(),
    addOns: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          unitPrice: z.number().positive(),
          quantity: z.number().int().positive(),
          totalPrice: z.number().positive(),
        }),
      )
      .optional(),
    specialInstructions: notesSchema(200).optional(),
  })
  .optional();

const deliveryInfoSchema = z.lazy(() =>
  z
    .object({
      type: z.enum(["dine_in", "takeaway", "delivery"]),
      address: z.string().min(1).optional(),
      phone: z.string().min(8).max(15).optional(),
      instructions: z.string().max(500).optional(),
      deliveryFee: z.number().min(0).optional(),
    })
    .refine(
      (data) => {
        if (data.type === "delivery") {
          return !!data.address && !!data.phone;
        }
        return true;
      },
      { message: "Delivery orders require address and phone" },
    ),
);

const guestOrderItemSchema = z.lazy(() =>
  z.object({
    menuItemId: z.number().int().positive(),
    quantity: z.number().int().positive().max(99),
    customizations: selectedCustomizationsSchema,
    notes: notesSchema(200).optional(),
  }),
);

export const createGuestOrderSchema = z.lazy(() =>
  z
    .object({
      restaurantId: z.string().min(1),
      guestName: z.string().max(50).default("Guest"),
      orderType: z.enum(["shop", "table", "seat"]),
      // What the customer scanned, when they scanned something. Optional on
      // purpose: clients that predate the field, and entry points with no sticker
      // to present, must keep working. See assertShopQrCurrent.
      shopQrCode: z.string().max(100).optional(),
      waitingListId: z.string().min(1).max(100).optional(),
      customerPhone: z.string().max(20).optional(),
      tableId: z.number().int().positive().optional(),
      seatId: z.number().int().positive().optional(),
      items: z.array(guestOrderItemSchema).min(1).max(20),
      clientMutationId: z.string().max(100).optional(),
      notes: notesSchema(500).optional(),
      deliveryInfo: deliveryInfoSchema.optional(),
    })
    .refine(
      (data) => {
        if (data.orderType === "table" || data.orderType === "seat") {
          return data.tableId != null;
        }
        return true;
      },
      {
        message: "tableId is required for table/seat order types",
        path: ["tableId"],
      },
    )
    .refine(
      (data) => {
        if (data.orderType === "seat") {
          return data.seatId != null;
        }
        return true;
      },
      { message: "seatId is required for seat order type", path: ["seatId"] },
    )
    .refine((data) => !data.waitingListId || !!data.customerPhone, {
      message: "customerPhone is required for waiting-list pre-orders",
      path: ["customerPhone"],
    }),
);

export const addGuestOrderItemsSchema = z.lazy(() =>
  z.object({
    items: z.array(guestOrderItemSchema).min(1).max(20),
  }),
);

export type CreateGuestOrderInput = z.infer<typeof createGuestOrderSchema>;
export type AddGuestOrderItemsInput = z.infer<typeof addGuestOrderItemsSchema>;
