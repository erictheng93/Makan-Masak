import { z } from "zod";

export const alertIdParamSchema = z.object({
  id: z.uuid(),
});

export const alertListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export type AlertIdParamInput = z.infer<typeof alertIdParamSchema>;
export type AlertListQueryInput = z.infer<typeof alertListQuerySchema>;
