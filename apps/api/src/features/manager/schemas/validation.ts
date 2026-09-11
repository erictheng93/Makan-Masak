import { z } from "zod";
import { boundedLimitQuery } from "../../../middleware/validation";

// Supported proxy actions. Start narrow and grow the enum deliberately;
// every addition needs a matching handler branch in ManagerActionsService.
const supportedActions = ["update_menu_availability"] as const;
const supportedResources = ["menu_item"] as const;

export const managerActionSchema = z.lazy(() =>
  z.object({
    restaurantId: z.string().min(1),
    action: z.enum(supportedActions),
    resource: z.enum(supportedResources),
    // Accept either string or number; the audit row stores a canonical string.
    resourceId: z
      .union([z.string().min(1), z.number().int().positive()])
      .transform((v) => String(v)),
    onBehalfOfUserId: z.string().trim().min(1).optional(),
    reason: z.string().max(500).optional(),
    // Free-form extension bag for action-specific arguments. The menu
    // availability handler reads { isAvailable: boolean } when present.
    payload: z.record(z.string(), z.any()).optional(),
  }),
);

export const auditLogQuerySchema = z.lazy(() =>
  z.object({
    resourceId: z.string().min(1).optional(),
    resource: z.string().min(1).optional(),
    actorId: z.string().trim().min(1).optional(),
    onBehalfOfUserId: z.string().trim().min(1).optional(),
    restaurantId: z.string().min(1).optional(),
    action: z.string().min(1).optional(),
    limit: boundedLimitQuery("50"),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .optional()
      .prefault("0"),
  }),
);

export type ManagerActionInput = z.infer<typeof managerActionSchema>;

/**
 * What `ManagerActionsService.execute` accepts. `action`/`resource` widen back
 * to `string` because the service re-checks the pair itself
 * (`assertActionResourcePair`) rather than trusting that validation ran — with
 * the zod-narrowed literals the mismatch branch would be unreachable, and the
 * guard is what stops a new entry in `supportedActions` from silently pairing
 * with the wrong resource. Routes pass `ManagerActionInput`, which is assignable.
 */
export type ManagerActionCommand = Omit<
  ManagerActionInput,
  "action" | "resource"
> & {
  action: string;
  resource: string;
};
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
