/**
 * Group Orders Validation Schemas
 * Zod schemas for validating group orders requests
 */

import { z } from "zod";
import { GROUP_ORDER_FEE_MODES } from "@makanmasak/shared-types";

// Reusable sanitizing schema for free-text user input (C10 release gate).
// Removes HTML metacharacters instead of trying to strip whole tags/attributes,
// which can be bypassed by overlapping fragments.
const sanitizeFreeText = (input: string): string => {
  return input.replace(/[<>"`=]/g, "");
};

const notesSchema = (maxLength: number) =>
  z.string().max(maxLength).transform(sanitizeFreeText);

// Core validation schemas
export const createGroupOrderSchema = z.lazy(() =>
  z
    .object({
      restaurantId: z
        .union([z.string(), z.number()])
        .transform((val) => String(val)),
      tableId: z
        .number()
        .int()
        .positive("Table ID must be a positive integer")
        .optional(),
      tableNumber: z.string().optional(),
      hostName: z.string().max(50).optional(),
      expectedMembers: z.number().int().min(2).max(30).optional(),
      notes: notesSchema(500).optional(),
      expirationHours: z
        .number()
        .min(1, "Expiration hours must be at least 1 hour")
        .max(168, "Expiration hours cannot exceed 7 days (168 hours)")
        .optional(),
      expirationMinutes: z
        .number()
        .min(5, "Expiration must be at least 5 minutes")
        .max(180, "Expiration cannot exceed 180 minutes")
        .optional(),
      maxMembers: z
        .number()
        .min(2, "Maximum members must be at least 2")
        .max(30, "Maximum members cannot exceed 30")
        .optional(),
      permissions: z
        .object({
          canInviteMembers: z.boolean().optional(),
          canModifyOthersCart: z.boolean().optional(),
          canFinalizeOrder: z.boolean().optional(),
          canSplitBill: z.boolean().optional(),
          canProcessPayment: z.boolean().optional(),
        })
        .optional(),
      fulfillmentType: z.enum(["dine_in", "delivery", "pickup"]).optional(),
      deliveryAddress: z
        .object({
          line1: z.string().min(1).max(200),
          line2: z.string().max(200).optional(),
          contactPhone: z.string().max(20).optional(),
          notes: notesSchema(300).optional(),
        })
        .optional(),
      pickupAt: z.iso.datetime().optional(),
      autoSubmitOnExpiry: z.boolean().optional(),
      feeMode: z.enum(GROUP_ORDER_FEE_MODES).optional(),
    })
    .refine(
      (data) => data.fulfillmentType !== "delivery" || !!data.deliveryAddress,
      {
        message: "deliveryAddress is required when fulfillmentType is delivery",
        path: ["deliveryAddress"],
      },
    )
    .refine((data) => data.fulfillmentType !== "pickup" || !!data.pickupAt, {
      message: "pickupAt is required when fulfillmentType is pickup",
      path: ["pickupAt"],
    }),
);

export const joinGroupSchema = z.lazy(() =>
  z.object({
    memberName: z
      .string()
      .min(1, "Member name is required")
      .max(50, "Member name cannot exceed 50 characters")
      .trim(),
    phone: z
      .string()
      .max(20, "Phone number cannot exceed 20 characters")
      .regex(/^[+]?[0-9\-\s()]+$/, "Invalid phone number format")
      .optional(),
    email: z
      .email("Invalid email format")
      .max(100, "Email cannot exceed 100 characters")
      .optional(),
  }),
);

/**
 * `memberToken` is optional here so that a request without one reaches the
 * route and is refused as unauthorised, rather than being reported as a
 * malformed body. The routes require it.
 */
export const addCartItemSchema = z.lazy(() =>
  z.object({
    memberId: z.uuid("Invalid member ID format"),
    memberToken: z.string().min(1).max(255).optional(),
    menuItemId: z
      .number()
      .int()
      .positive("Menu item ID must be a positive integer"),
    quantity: z
      .number()
      .int("Quantity must be an integer")
      .min(1, "Quantity must be at least 1")
      .max(99, "Quantity cannot exceed 99"),
    customizations: z.record(z.string(), z.any()).optional(),
    specialInstructions: notesSchema(200).optional(),
  }),
);

export const updateCartItemSchema = z.lazy(() =>
  z
    .object({
      memberId: z.uuid("Invalid member ID format").optional(),
      memberToken: z.string().min(1).max(255).optional(),
      quantity: z
        .number()
        .int("Quantity must be an integer")
        .min(1, "Quantity must be at least 1")
        .max(99, "Quantity cannot exceed 99")
        .optional(),
      customizations: z.record(z.string(), z.any()).optional(),
      specialInstructions: notesSchema(200).optional(),
    })
    // Only the editable fields count — the caller's credentials are always
    // present, so counting every key would make this check vacuous.
    .refine(
      (data) =>
        data.quantity !== undefined ||
        data.customizations !== undefined ||
        data.specialInstructions !== undefined,
      {
        message: "At least one field must be provided for update",
      },
    ),
);

export const removeCartItemSchema = z.lazy(() =>
  z.object({
    memberId: z.uuid("Invalid member ID format"),
    memberToken: z.string().min(1).max(255).optional(),
  }),
);

/**
 * Only the methods finalize can perform without extra input. `custom` and
 * `single_payer` need per-member amounts, and a group order has no column for
 * them — accepting either here would store a preference that makes the order
 * fail to finalize much later, with nothing to point at.
 */
export const splitTypePreferenceSchema = z.lazy(() =>
  z.object({
    splitType: z.enum(["equal", "by_item", "proportional"], {
      error: "Split type must be one of: equal, by_item, proportional",
    }),
    memberToken: z.string().min(1).max(255).optional(),
  }),
);

/**
 * Who carries the service charge and tax. Separate from the split type, which
 * only divides the food.
 */
export const feeModePreferenceSchema = z.lazy(() =>
  z.object({
    feeMode: z.enum(GROUP_ORDER_FEE_MODES, {
      error: "Fee mode must be one of: proportional, equal, host",
    }),
    memberToken: z.string().min(1).max(255).optional(),
  }),
);

export const autoSubmitOnExpirySchema = z.lazy(() =>
  z.object({
    enabled: z.boolean({ error: "enabled must be true or false" }),
    memberToken: z.string().min(1).max(255).optional(),
  }),
);

export const splitBillSchema = z.lazy(() =>
  z
    .object({
      memberToken: z.string().min(1).max(255).optional(),
      splitType: z.enum(
        ["equal", "proportional", "individual", "by_item", "custom"],
        {
          error:
            "Split type must be one of: equal, proportional, individual, by_item, custom",
        },
      ),
      serviceChargeRate: z
        .number()
        .min(0, "Service charge rate cannot be negative")
        .max(1, "Service charge rate cannot exceed 100%")
        .optional()
        .default(0),
      taxRate: z
        .number()
        .min(0, "Tax rate cannot be negative")
        .max(1, "Tax rate cannot exceed 100%")
        .optional()
        .default(0),
      sharedServiceChargeCents: z
        .number()
        .int("Shared service charge must be in whole cents")
        .min(0, "Shared service charge cannot be negative")
        .optional(),
      sharedTaxCents: z
        .number()
        .int("Shared tax must be in whole cents")
        .min(0, "Shared tax cannot be negative")
        .optional(),
      orderTotalCents: z
        .number()
        .int("Order total must be in whole cents")
        .min(0, "Order total cannot be negative")
        .optional(),
      customSplits: z
        .array(
          z.object({
            memberId: z.uuid("Invalid member ID format"),
            amount: z.number().positive("Amount must be positive"),
            items: z.array(z.any()),
          }),
        )
        .optional(),
      customAmounts: z
        .array(
          z.object({
            memberId: z.uuid("Invalid member ID format"),
            amount: z.number().positive("Amount must be positive"),
          }),
        )
        .optional(),
    })
    .refine(
      (data) => {
        if (data.splitType === "custom") {
          return (
            (data.customSplits && data.customSplits.length > 0) ||
            (data.customAmounts && data.customAmounts.length > 0)
          );
        }
        return true;
      },
      {
        message:
          "Custom splits or custom amounts are required when split type is custom",
        path: ["customSplits"],
      },
    ),
);

export const processPaymentSchema = z.lazy(() =>
  z.object({
    memberToken: z.string().min(1).max(255).optional(),
    paymentMethod: z
      .string()
      .min(1, "Payment method is required")
      .max(50, "Payment method cannot exceed 50 characters"),
    amount: z
      .number()
      .positive("Payment amount must be positive")
      .max(99999.99, "Payment amount cannot exceed 99,999.99")
      .optional(), // Optional - will use amount from split_bills if not provided
    transactionId: z
      .string()
      .max(100, "Transaction ID cannot exceed 100 characters")
      .optional(),
    paymentDetails: z.record(z.string(), z.any()).optional(), // Additional payment details (card info, etc.)
  }),
);

export const recoverFinalizationSchema = z.lazy(() =>
  z.object({
    bearerMemberId: z.uuid("Invalid bearer member ID format").optional(),
  }),
);

export const recoverHostSchema = z.lazy(() =>
  z.object({
    recoveryCode: z.string().min(1, "Recovery code is required").max(100),
  }),
);

export const lockGroupOrderSchema = z.lazy(() =>
  z.object({
    memberToken: z.string().min(1, "Member token is required").max(255),
  }),
);

// Parameter validation schemas
export const groupOrderIdParamSchema = z.object({
  groupOrderId: z.uuid("Invalid group order ID format"),
});

export const shareCodeParamSchema = z.lazy(() =>
  z.object({
    shareCode: z
      .string()
      .min(6, "Share code must be at least 6 characters")
      .max(20, "Share code cannot exceed 20 characters")
      .regex(
        /^[A-Z0-9]+$/,
        "Share code must contain only uppercase letters and numbers",
      ),
  }),
);

export const memberIdParamSchema = z.object({
  memberId: z.uuid("Invalid member ID format"),
});

export const itemIdParamSchema = z.object({
  itemId: z.uuid("Invalid item ID format"),
});

// Query parameter schemas
export const activitiesQuerySchema = z.lazy(() =>
  z.object({
    limit: z.coerce
      .number()
      .int("Limit must be an integer")
      .min(1, "Limit must be at least 1")
      .max(100, "Limit cannot exceed 100")
      .optional()
      .default(50),
    offset: z.coerce
      .number()
      .int("Offset must be an integer")
      .min(0, "Offset cannot be negative")
      .optional()
      .default(0),
    type: z
      .enum([
        "group_created",
        "member_joined",
        "member_left",
        "item_added",
        "item_updated",
        "item_removed",
        "bill_split",
        "payment_made",
        "order_finalized",
        "order_cancelled",
      ])
      .optional(),
  }),
);

export const statisticsQuerySchema = z.lazy(() =>
  z
    .object({
      timeRange: z
        .enum(["day", "week", "month", "quarter", "year"])
        .default("month"),
      restaurantId: z
        .string()
        .optional()
        .transform((val) => {
          if (!val || val.trim() === "") return undefined;
          return val;
        }),
      startDate: z.iso
        .datetime()
        .optional()
        .or(z.literal(""))
        .transform((val) => (val === "" ? undefined : val)),
      endDate: z.iso
        .datetime()
        .optional()
        .or(z.literal(""))
        .transform((val) => (val === "" ? undefined : val)),
    })
    .refine(
      (data) => {
        if (data.startDate && data.endDate) {
          return new Date(data.startDate) < new Date(data.endDate);
        }
        return true;
      },
      {
        message: "Start date must be before end date",
        path: ["endDate"],
      },
    ),
);

// Complex validation helpers
type GroupOrderPermissionMap = Partial<
  Record<
    | "canInviteMembers"
    | "canModifyOthersCart"
    | "canFinalizeOrder"
    | "canSplitBill"
    | "canProcessPayment",
    boolean
  >
>;

export const validateGroupOrderPermissions = (
  permissions: GroupOrderPermissionMap | undefined,
  userRole: number,
) => {
  // Owner (1) and Admin (0) have all permissions
  if (userRole <= 1) {
    return { valid: true };
  }

  // Other roles have limited permissions
  const restrictedPermissions = {
    canInviteMembers: true,
    canModifyOthersCart: false,
    canFinalizeOrder: userRole <= 2, // Chef and above
    canSplitBill: userRole <= 3, // Service crew and above
    canProcessPayment: userRole <= 4, // Cashier and above
  };

  const invalidPermissions = Object.entries(permissions || {})
    .filter(
      ([key, value]) =>
        value === true &&
        restrictedPermissions[key as keyof typeof restrictedPermissions] ===
          false,
    )
    .map(([key]) => key);

  if (invalidPermissions.length > 0) {
    return {
      valid: false,
      error: `Insufficient permissions for: ${invalidPermissions.join(", ")}`,
    };
  }

  return { valid: true };
};

export const validateCartItemQuantity = (
  quantity: number,
  availableStock?: number,
) => {
  if (quantity <= 0) {
    return { valid: false, error: "Quantity must be positive" };
  }

  if (availableStock !== undefined && quantity > availableStock) {
    return {
      valid: false,
      error: `Only ${availableStock} items available in stock`,
    };
  }

  return { valid: true };
};

export const validatePaymentAmount = (
  amount: number,
  totalDue: number,
  tolerance: number = 0.01,
) => {
  if (amount <= 0) {
    return { valid: false, error: "Payment amount must be positive" };
  }

  if (amount > totalDue + tolerance) {
    return {
      valid: false,
      error: `Payment amount (${amount}) exceeds total due (${totalDue})`,
    };
  }

  return { valid: true };
};

// Export all schemas for easy import
export const groupOrderSchemas = {
  createGroupOrder: createGroupOrderSchema,
  joinGroup: joinGroupSchema,
  addCartItem: addCartItemSchema,
  updateCartItem: updateCartItemSchema,
  removeCartItem: removeCartItemSchema,
  autoSubmitOnExpiry: autoSubmitOnExpirySchema,
  splitTypePreference: splitTypePreferenceSchema,
  feeModePreference: feeModePreferenceSchema,
  splitBill: splitBillSchema,
  processPayment: processPaymentSchema,
  recoverFinalization: recoverFinalizationSchema,
  recoverHost: recoverHostSchema,
  lockGroupOrder: lockGroupOrderSchema,

  // Parameters
  groupOrderIdParam: groupOrderIdParamSchema,
  shareCodeParam: shareCodeParamSchema,
  memberIdParam: memberIdParamSchema,
  itemIdParam: itemIdParamSchema,

  // Queries
  activitiesQuery: activitiesQuerySchema,
  statisticsQuery: statisticsQuerySchema,
};

// Type exports for TypeScript
export type CreateGroupOrderData = z.infer<typeof createGroupOrderSchema>;
export type JoinGroupData = z.infer<typeof joinGroupSchema>;
export type AddCartItemData = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemData = z.infer<typeof updateCartItemSchema>;
export type RemoveCartItemData = z.infer<typeof removeCartItemSchema>;
export type SplitBillData = z.infer<typeof splitBillSchema>;
export type ProcessPaymentData = z.infer<typeof processPaymentSchema>;
export type LockGroupOrderData = z.infer<typeof lockGroupOrderSchema>;
export type ActivitiesQueryData = z.infer<typeof activitiesQuerySchema>;
export type StatisticsQueryData = z.infer<typeof statisticsQuerySchema>;
