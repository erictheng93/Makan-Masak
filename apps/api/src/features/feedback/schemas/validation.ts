import { z } from "zod";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  FEEDBACK_MODULES,
} from "@makanmasak/database";
import { httpUrlSchema } from "../../../shared/utils/url";

export const createFeedbackSchema = z.object({
  subject: z
    .string()
    .min(5, "Subject must be at least 5 characters")
    .max(200, "Subject must be at most 200 characters"),
  description: z
    .string()
    .min(10, "Description must be at least 10 characters")
    .max(5000, "Description must be at most 5000 characters"),
  category: z.enum(FEEDBACK_CATEGORIES),
  priority: z.enum(FEEDBACK_PRIORITIES).optional(),
  relatedModule: z.enum(FEEDBACK_MODULES).optional(),
  attachmentUrls: z
    .array(httpUrlSchema)
    .max(5, "Maximum 5 attachments allowed")
    .optional(),
});

export const updateFeedbackSchema = z.lazy(() =>
  createFeedbackSchema
    .partial()
    .refine((data) => Object.values(data).some((v) => v !== undefined), {
      message: "At least one field must be provided",
    }),
);

export const updateFeedbackStatusSchema = z.lazy(() =>
  z.object({
    status: z.enum(FEEDBACK_STATUSES),
  }),
);

export const addResponseSchema = z.lazy(() =>
  z.object({
    message: z
      .string()
      .min(1, "Message cannot be empty")
      .max(2000, "Message must be at most 2000 characters"),
    isInternal: z.boolean().optional().default(false),
  }),
);

export const feedbackFiltersSchema = z.lazy(() =>
  z.object({
    category: z.enum(FEEDBACK_CATEGORIES).optional(),
    status: z.enum(FEEDBACK_STATUSES).optional(),
    priority: z.enum(FEEDBACK_PRIORITIES).optional(),
    relatedModule: z.enum(FEEDBACK_MODULES).optional(),
    restaurantId: z.string().optional(),
    search: z.string().max(200).optional(),
    page: z.coerce.number().int().positive().max(1000).optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  }),
);

export const feedbackIdParamSchema = z.lazy(() =>
  z.object({
    id: z.coerce.number().int().positive("ID must be a positive integer"),
  }),
);

export const responseIdParamSchema = z.lazy(() =>
  z.object({
    id: z.coerce
      .number()
      .int()
      .positive("Feedback ID must be a positive integer"),
    responseId: z.coerce
      .number()
      .int()
      .positive("Response ID must be a positive integer"),
  }),
);

export const updateResponseSchema = z.lazy(() =>
  z.object({
    message: z
      .string()
      .min(1, "Message cannot be empty")
      .max(2000, "Message must be at most 2000 characters"),
  }),
);

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type UpdateFeedbackInput = z.infer<typeof updateFeedbackSchema>;
export type UpdateFeedbackStatusInput = z.infer<
  typeof updateFeedbackStatusSchema
>;
export type AddResponseInput = z.infer<typeof addResponseSchema>;
export type FeedbackFiltersInput = z.infer<typeof feedbackFiltersSchema>;
export type FeedbackIdParamInput = z.infer<typeof feedbackIdParamSchema>;
export type ResponseIdParamInput = z.infer<typeof responseIdParamSchema>;
export type UpdateResponseInput = z.infer<typeof updateResponseSchema>;
