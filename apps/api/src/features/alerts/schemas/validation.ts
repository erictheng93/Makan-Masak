import { z } from "zod";

export const alertIdParamSchema = z.lazy(() =>
  z.object({
    id: z.uuid(),
  }),
);

export const alertContextQuerySchema = z.lazy(() =>
  z.object({
    restaurantId: z.uuid().optional(),
  }),
);

export type AlertContextQueryInput = z.infer<typeof alertContextQuerySchema>;

export const alertListQuerySchema = z.lazy(() =>
  z.object({
    restaurantId: z.uuid().optional(),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  }),
);

export type AlertIdParamInput = z.infer<typeof alertIdParamSchema>;
export type AlertListQueryInput = z.infer<typeof alertListQuerySchema>;
