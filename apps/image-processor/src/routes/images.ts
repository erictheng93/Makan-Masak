import { Hono } from "hono";
import { z } from "zod";
import { ImageService } from "../services/image-service";
import {
  authMiddleware,
  optionalAuth,
  requireRole,
  checkImageAccess,
  uploadRateLimit,
  transformRateLimit,
  checkFileSize,
} from "../middleware/auth";
import {
  validateQuery,
  validateParams,
  validateBody,
  validateFileType,
  securityScan,
  imageSchemas,
  type ImageBulkOperationBody,
  type ImageIdParams,
  type ImageListQuery,
  type ImageProcessBody,
  type ImageUpdateBody,
  type ImageUploadQuery,
  type ImageVariantQuery,
} from "../middleware/validation";
import type { Env, ImageMetadata, ImageTransformation } from "../types/env";
import { v7 as uuidv7 } from "uuid";

const app = new Hono<{ Bindings: Env }>();

const generateUniqueFilename = (originalFilename: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const extension = originalFilename.split(".").pop();
  const baseName = originalFilename
    .replace(/\.[^/.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]/g, "-");

  return `${baseName}-${timestamp}-${random}.${extension}`;
};

const extractImageMetadata = async (
  file: File,
): Promise<{
  width?: number;
  height?: number;
  format?: string;
  size: number;
  exif?: Record<string, unknown>;
}> => ({
  size: file.size,
  format: file.type,
});

const isUploadFile = (value: FormDataEntryValue): value is File =>
  typeof value === "object" &&
  value !== null &&
  "arrayBuffer" in value &&
  "name" in value &&
  "size" in value &&
  "type" in value;

const getUploadVariantFiles = (
  formData: FormData | undefined,
  original: File,
  allowedVariants: Set<string>,
  allowedMimeTypes: string[],
  maxSizeMB: number,
): Array<{ variant: string; file: File }> | Response => {
  const files = new Map<string, File>([["original", original]]);
  const normalizedMimeTypes = allowedMimeTypes.map((type) =>
    type.toLowerCase().trim(),
  );
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  let validationError: Response | undefined;

  if (formData) {
    formData.forEach((value, key) => {
      if (validationError) {
        return;
      }

      if (key === "file" || !isUploadFile(value) || value.size === 0) {
        return;
      }

      if (!allowedVariants.has(key)) {
        validationError = Response.json(
          {
            success: false,
            error: "Invalid image variant",
            variant: key,
          },
          { status: 400 },
        );
        return;
      }

      if (value.size > maxSizeBytes) {
        validationError = Response.json(
          {
            success: false,
            error: `File too large. Maximum size: ${maxSizeMB}MB`,
            variant: key,
            maxSize: maxSizeMB,
          },
          { status: 413 },
        );
        return;
      }

      if (
        value.type &&
        !normalizedMimeTypes.includes(value.type.toLowerCase())
      ) {
        validationError = Response.json(
          {
            success: false,
            error: "Invalid file type",
            allowedTypes: allowedMimeTypes,
            receivedType: value.type,
            variant: key,
          },
          { status: 400 },
        );
        return;
      }

      files.set(key, value);
    });
  }

  if (validationError) {
    return validationError;
  }

  return Array.from(files, ([variant, variantFile]) => ({
    variant,
    file: variantFile,
  }));
};

const fallbackVariantKeys = [
  "original",
  "thumbnail",
  "small",
  "medium",
  "large",
];

const getAllowedUploadVariants = (env: Env): Set<string> =>
  new Set(
    (env.DEFAULT_VARIANTS?.split(",") ?? fallbackVariantKeys)
      .map((variant) => variant.trim())
      .filter(Boolean),
  );

const variantsFromMetadata = (metadata?: ImageMetadata): string[] => {
  const variants = Object.keys(metadata?.variants ?? {});
  return variants.length > 0 ? variants : fallbackVariantKeys;
};

/**
 * Upload image
 * POST /images/upload
 */
app.post(
  "/upload",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  (c, next) => uploadRateLimit(c.env)(c, next),
  (c, next) => {
    const maxImageSizeMB = parseInt(c.env.MAX_IMAGE_SIZE_MB) || 10;
    const maxRequestSizeMB =
      parseInt(c.env.MAX_UPLOAD_REQUEST_SIZE_MB ?? "") || maxImageSizeMB + 2;
    return checkFileSize(maxRequestSizeMB)(c, next);
  },
  (c, next) => validateFileType(c.env.ALLOWED_MIME_TYPES.split(","))(c, next),
  securityScan,
  validateQuery(imageSchemas.uploadParams),
  async (c) => {
    try {
      const user = c.get("user");
      const file = c.get("file") as File;
      const query = c.get("validatedQuery") as ImageUploadQuery;

      if (!file) {
        return c.json(
          {
            success: false,
            error: "No file provided",
          },
          400,
        );
      }

      // Authoritative size enforcement. The checkFileSize middleware only
      // inspects the Content-Length header (cheap early reject, but spoofable
      // and absent on some clients). Now that the multipart body is parsed we
      // have the real byte length — reject oversized uploads before spending a
      // Cloudflare Images call.
      const maxSizeMB = parseInt(c.env.MAX_IMAGE_SIZE_MB) || 10;
      if (file.size > maxSizeMB * 1024 * 1024) {
        return c.json(
          {
            success: false,
            error: `File too large. Maximum size: ${maxSizeMB}MB`,
            maxSize: maxSizeMB,
          },
          413,
        );
      }

      const variantFiles = getUploadVariantFiles(
        c.get("formData"),
        file,
        getAllowedUploadVariants(c.env),
        c.env.ALLOWED_MIME_TYPES.split(","),
        maxSizeMB,
      );
      if (variantFiles instanceof Response) {
        return variantFiles;
      }

      const uploadRestaurantId =
        user.role === 0 ? query.restaurantId : user.restaurantId;

      if (!uploadRestaurantId) {
        return c.json(
          {
            success: false,
            error: "Restaurant access is required for image uploads",
          },
          403,
        );
      }

      // Generate unique filename
      const uniqueFilename = generateUniqueFilename(file.name);

      // Parse tags if provided
      const tags = query.tags
        ? query.tags.split(",").map((tag: string) => tag.trim())
        : undefined;

      const imageId = uuidv7();
      const uploadedVariants: string[] = [];
      const imageService = new ImageService(c.env);

      try {
        for (const variantFile of variantFiles) {
          await imageService.putImageVariant(
            imageId,
            variantFile.variant,
            variantFile.file,
          );
          uploadedVariants.push(variantFile.variant);
        }
      } catch (error) {
        await imageService.deleteImageVariants(imageId, uploadedVariants);
        throw error;
      }

      const imageMetadata = await extractImageMetadata(file);
      const variants = imageService.buildVariantUrls(imageId, uploadedVariants);

      // Save metadata to database
      const metadata: Omit<ImageMetadata, "id"> = {
        filename: uniqueFilename,
        originalFilename: file.name,
        mimeType: file.type,
        size: file.size,
        width: imageMetadata.width,
        height: imageMetadata.height,
        variants,
        uploadedAt: new Date().toISOString(),
        uploadedBy: user.id,
        restaurantId: uploadRestaurantId,
        category: query.category,
        tags,
        altText: query.altText,
        caption: query.caption,
        exifData: imageMetadata.exif,
      };

      const saveResult = await imageService.saveImageMetadata(
        metadata,
        imageId,
      );

      if (!saveResult.success) {
        await imageService.deleteImageVariants(imageId, uploadedVariants);

        return c.json(
          {
            success: false,
            error: saveResult.error || "Failed to save metadata",
          },
          500,
        );
      }

      // Record upload in analytics
      c.executionCtx.waitUntil(
        imageService.recordImageView(saveResult.id!, "upload"),
      );

      return c.json(
        {
          success: true,
          data: {
            id: saveResult.id,
            filename: uniqueFilename,
            originalFilename: file.name,
            size: file.size,
            variants,
            uploadedAt: metadata.uploadedAt,
          },
        },
        201,
      );
    } catch (error) {
      console.error("Image upload error:", error);
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Upload failed",
        },
        500,
      );
    }
  },
);

/**
 * Get image metadata
 * GET /images/:imageId
 */
app.get(
  "/:imageId",
  optionalAuth,
  validateParams(imageSchemas.imageIdParam),
  checkImageAccess,
  async (c) => {
    try {
      const { imageId } = c.get("validatedParams") as ImageIdParams;
      const imageService = new ImageService(c.env);

      const result = await imageService.getImageMetadata(imageId);

      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error || "Image not found",
          },
          404,
        );
      }

      // Record view for analytics
      c.executionCtx.waitUntil(
        imageService.recordImageView(imageId, "metadata"),
      );

      return c.json({
        success: true,
        data: result.data,
      });
    } catch (error) {
      console.error("Get image metadata error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to get image metadata",
        },
        500,
      );
    }
  },
);

/**
 * Update image metadata
 * PUT /images/:imageId
 */
app.put(
  "/:imageId",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  validateParams(imageSchemas.imageIdParam),
  validateBody(imageSchemas.updateBody),
  checkImageAccess,
  async (c) => {
    try {
      const { imageId } = c.get("validatedParams") as ImageIdParams;
      const updates = c.get("validatedBody") as ImageUpdateBody;
      const imageService = new ImageService(c.env);

      const result = await imageService.updateImageMetadata(imageId, updates);

      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error || "Failed to update image",
          },
          500,
        );
      }

      return c.json({
        success: true,
        message: "Image metadata updated successfully",
      });
    } catch (error) {
      console.error("Update image metadata error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to update image metadata",
        },
        500,
      );
    }
  },
);

/**
 * Delete image
 * DELETE /images/:imageId
 */
app.delete(
  "/:imageId",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  validateParams(imageSchemas.imageIdParam),
  checkImageAccess,
  async (c) => {
    try {
      const { imageId } = c.get("validatedParams") as ImageIdParams;
      const imageService = new ImageService(c.env);

      const metadataResult = await imageService.getImageMetadata(imageId);
      const variants = metadataResult.success
        ? variantsFromMetadata(metadataResult.data)
        : fallbackVariantKeys;
      const deleteResult = await imageService.deleteImageVariants(
        imageId,
        variants,
      );

      if (!deleteResult.success) {
        return c.json(
          {
            success: false,
            error: deleteResult.error || "Failed to delete image",
          },
          500,
        );
      }

      // Delete metadata from database
      const deleteMetadataResult =
        await imageService.deleteImageMetadata(imageId);

      if (!deleteMetadataResult.success) {
        console.error(
          "Failed to delete image metadata:",
          deleteMetadataResult.error,
        );
        // Continue anyway since the image objects were deleted from R2.
      }

      return c.json({
        success: true,
        message: "Image deleted successfully",
      });
    } catch (error) {
      console.error("Delete image error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to delete image",
        },
        500,
      );
    }
  },
);

/**
 * List images
 * GET /images
 */
app.get(
  "/",
  authMiddleware,
  validateQuery(imageSchemas.listQuery),
  async (c) => {
    try {
      const user = c.get("user");
      const query = c.get("validatedQuery") as ImageListQuery;
      const imageService = new ImageService(c.env);

      // Apply access control
      const options: Parameters<ImageService["listImages"]>[0] = {
        ...query,
        tags: query.tags
          ? query.tags.split(",").map((tag: string) => tag.trim())
          : undefined,
      };

      // Non-admins can only see their restaurant's images
      if (user.role !== 0) {
        options.restaurantId = user.restaurantId;
      }

      const result = await imageService.listImages(options);

      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error || "Failed to list images",
          },
          500,
        );
      }

      const { images, total } = result.data!;

      return c.json({
        success: true,
        data: {
          images,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            pages: Math.ceil(total / query.limit),
          },
        },
      });
    } catch (error) {
      console.error("List images error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to list images",
        },
        500,
      );
    }
  },
);

/**
 * Get image (optimized delivery)
 * GET /images/:imageId/view
 */
app.get(
  "/:imageId/view",
  optionalAuth,
  validateParams(imageSchemas.imageIdParam),
  validateQuery(imageSchemas.variantParams),
  checkImageAccess,
  async (c) => {
    try {
      const { imageId } = c.get("validatedParams") as ImageIdParams;
      const { variant, width, height, fit, format, quality } = c.get(
        "validatedQuery",
      ) as ImageVariantQuery;
      const imageService = new ImageService(c.env);

      // Get image metadata
      const metadataResult = await imageService.getImageMetadata(imageId);

      if (!metadataResult.success) {
        return c.json(
          {
            success: false,
            error: "Image not found",
          },
          404,
        );
      }

      const metadata = metadataResult.data!;

      void width;
      void height;
      void fit;
      void format;
      void quality;

      const imageUrl = metadata.variants[variant] || metadata.variants.original;

      // Record view for analytics
      c.executionCtx.waitUntil(imageService.recordImageView(imageId, variant));

      // Redirect to the optimized image URL
      return c.redirect(imageUrl, 302);
    } catch (error) {
      console.error("Image view error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to serve image",
        },
        500,
      );
    }
  },
);

/**
 * Process image with transformations
 * POST /images/:imageId/process
 */
app.post(
  "/:imageId/process",
  authMiddleware,
  requireRole([0, 1, 2]), // Admin, Owner, Chef
  (c, next) => transformRateLimit(c.env)(c, next),
  validateParams(imageSchemas.imageIdParam),
  validateBody(imageSchemas.processParams),
  checkImageAccess,
  async (c) => {
    try {
      const { imageId } = c.get("validatedParams") as ImageIdParams;
      const {
        transformations = [],
        variants = [],
        format,
        quality,
      } = c.get("validatedBody") as ImageProcessBody;
      const imageService = new ImageService(c.env);

      // Create processing job
      const jobResult = await imageService.createProcessingJob(
        imageId,
        transformations,
        variants,
      );

      if (!jobResult.success) {
        return c.json(
          {
            success: false,
            error: jobResult.error || "Failed to create processing job",
          },
          500,
        );
      }

      const jobId = jobResult.jobId!;

      // Start processing asynchronously
      c.executionCtx.waitUntil(
        processImageAsync(
          c.env,
          jobId,
          imageId,
          transformations,
          variants,
          format,
          quality,
        ),
      );

      return c.json(
        {
          success: true,
          data: {
            jobId,
            status: "pending",
            message: "Image processing started",
          },
        },
        202,
      );
    } catch (error) {
      console.error("Process image error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to start image processing",
        },
        500,
      );
    }
  },
);

/**
 * Get processing job status
 * GET /images/jobs/:jobId
 */
app.get(
  "/jobs/:jobId",
  authMiddleware,
  validateParams(z.object({ jobId: z.string() })),
  async (c) => {
    try {
      const { jobId } = c.get("validatedParams") as { jobId: string };
      const imageService = new ImageService(c.env);

      const result = await imageService.getJobStatus(jobId, c.get("user"));

      if (!result.success) {
        return c.json(
          {
            success: false,
            error: result.error || "Job not found",
          },
          404,
        );
      }

      return c.json({
        success: true,
        data: result.job,
      });
    } catch (error) {
      console.error("Get job status error:", error);
      return c.json(
        {
          success: false,
          error: "Failed to get job status",
        },
        500,
      );
    }
  },
);

/**
 * Bulk operations on images
 * POST /images/bulk
 */
app.post(
  "/bulk",
  authMiddleware,
  requireRole([0, 1]), // Admin, Owner only
  validateBody(imageSchemas.bulkOperationBody),
  async (c) => {
    try {
      const user = c.get("user");
      const { imageIds, operation, data } = c.get(
        "validatedBody",
      ) as ImageBulkOperationBody;
      const imageService = new ImageService(c.env);

      const results = [];

      for (const imageId of imageIds) {
        try {
          // Check access to each image
          const metadataResult = await imageService.getImageMetadata(imageId);

          if (!metadataResult.success) {
            results.push({ imageId, success: false, error: "Image not found" });
            continue;
          }

          const metadata = metadataResult.data!;

          // Access control check
          if (user.role !== 0 && metadata.restaurantId !== user.restaurantId) {
            results.push({ imageId, success: false, error: "Access denied" });
            continue;
          }

          switch (operation) {
            case "delete": {
              const deleteResult = await imageService.deleteImageVariants(
                imageId,
                variantsFromMetadata(metadata),
              );
              if (deleteResult.success) {
                await imageService.deleteImageMetadata(imageId);
              }
              results.push({
                imageId,
                success: deleteResult.success,
                error: deleteResult.error,
              });
              break;
            }

            case "update_category":
              if (data?.category) {
                const updateResult = await imageService.updateImageMetadata(
                  imageId,
                  {
                    category: data.category,
                  },
                );
                results.push({
                  imageId,
                  success: updateResult.success,
                  error: updateResult.error,
                });
              } else {
                results.push({
                  imageId,
                  success: false,
                  error: "Category required",
                });
              }
              break;

            case "update_tags":
              if (data?.tags) {
                const updateResult = await imageService.updateImageMetadata(
                  imageId,
                  {
                    tags: data.tags,
                  },
                );
                results.push({
                  imageId,
                  success: updateResult.success,
                  error: updateResult.error,
                });
              } else {
                results.push({
                  imageId,
                  success: false,
                  error: "Tags required",
                });
              }
              break;

            case "generate_variants": {
              // This would trigger variant generation
              const jobResult = await imageService.createProcessingJob(
                imageId,
                [],
                ["all"],
              );
              results.push({
                imageId,
                success: jobResult.success,
                jobId: jobResult.jobId,
                error: jobResult.error,
              });
              break;
            }

            default:
              results.push({
                imageId,
                success: false,
                error: "Unknown operation",
              });
          }
        } catch (error) {
          results.push({
            imageId,
            success: false,
            error: error instanceof Error ? error.message : "Operation failed",
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      return c.json({
        success: successCount > 0,
        data: {
          operation,
          processed: results.length,
          successful: successCount,
          failed: failCount,
          results,
        },
      });
    } catch (error) {
      console.error("Bulk operation error:", error);
      return c.json(
        {
          success: false,
          error: "Bulk operation failed",
        },
        500,
      );
    }
  },
);

/**
 * Serve public image variant
 * GET /images/:imageId/:variant
 */
app.get("/:imageId/:variant", async (c) => {
  try {
    const imageId = c.req.param("imageId");
    const variant = c.req.param("variant");
    const imageService = new ImageService(c.env);
    const object = await imageService.getImageVariant(imageId, variant);

    if (!object) {
      return c.json(
        {
          success: false,
          error: "Image not found",
        },
        404,
      );
    }

    const objectHeaders = new Headers();
    object.writeHttpMetadata(
      objectHeaders as unknown as import("@cloudflare/workers-types").Headers,
    );
    const headers: Record<string, string> = {};
    objectHeaders.forEach((value, key) => {
      headers[key] = value;
    });
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
    headers.ETag = object.httpEtag;

    return c.newResponse(
      object.body as unknown as ReadableStream,
      200,
      headers,
    );
  } catch (error) {
    console.error("Image delivery error:", error);
    return c.json(
      {
        success: false,
        error: "Failed to serve image",
      },
      500,
    );
  }
});

// Helper function for async image processing
async function processImageAsync(
  env: Env,
  jobId: string,
  imageId: string,
  transformations: ImageTransformation[],
  _variants: string[],
  _format?: string,
  _quality?: number,
) {
  const imageService = new ImageService(env);

  try {
    await imageService.updateJobStatus(jobId, "processing", 10);

    const metadataResult = await imageService.getImageMetadata(imageId);
    if (!metadataResult.success) {
      await imageService.updateJobStatus(
        jobId,
        "failed",
        undefined,
        metadataResult.error,
      );
      return;
    }

    await imageService.updateJobStatus(jobId, "processing", 50);

    const newVariants = { ...metadataResult.data!.variants };

    // Custom transformations are no longer generated by this worker after
    // Cloudflare Images was de-scoped. Keep the job lifecycle for callers.
    if (transformations.length > 0) {
      for (const transform of transformations) {
        newVariants[`custom_${transform.type}`] =
          metadataResult.data!.variants.original;
      }
    }

    await imageService.updateJobStatus(jobId, "processing", 80);

    // Update image metadata with new variants
    await imageService.updateImageMetadata(imageId, { variants: newVariants });

    await imageService.updateJobStatus(jobId, "completed", 100);
  } catch (error) {
    console.error("Async image processing error:", error);
    await imageService.updateJobStatus(
      jobId,
      "failed",
      undefined,
      error instanceof Error ? error.message : "Processing failed",
    );
  }
}

export default app;
