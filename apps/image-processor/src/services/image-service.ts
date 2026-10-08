import type {
  Env,
  ImageMetadata,
  ImageProcessingJob,
  ImageAnalytics,
  ImageTransformation,
  StoredImageObject,
} from "../types/env";
import { ImageService as DatabaseImageService } from "@makanmasak/database";
import type { AuthUser } from "../middleware/auth";
import type { D1Database } from "@cloudflare/workers-types";

type DatabaseImageServiceInstance = InstanceType<typeof DatabaseImageService>;
type CreateImageData = Parameters<
  DatabaseImageServiceInstance["createImage"]
>[0];

type DatabaseImageListRow = {
  id: string;
  filename: string;
  originalFilename?: string;
  original_filename?: string;
  mimeType?: string;
  mime_type?: string;
  size: number;
  width?: number | null;
  height?: number | null;
  variants?: string | ImageMetadata["variants"] | null;
  uploadedAt?: Date | string | number;
  uploaded_at?: string;
  uploadedBy?: string | null;
  uploaded_by?: string | null;
  restaurantId?: string | number | null;
  restaurant_id?: string | number | null;
  category?: string;
  tags?: string | string[] | null;
  altText?: string | null;
  alt_text?: string | null;
  caption?: string | null;
};

type CategoryStatsRow = {
  category: string | null;
  count: number;
};

type JobStatsRow = {
  status: string;
  count: number;
  avg_duration: number | null;
};

const parseProcessingJobId = (jobId: string): number | null => {
  const id = Number(jobId);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;

  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }

  return end === value.length ? value : value.slice(0, end);
};

/**
 * Image service for database operations and metadata management
 */
export class ImageService {
  private db: D1Database;
  private cache: KVNamespace;
  private dbImageService: DatabaseImageServiceInstance;
  private imagesBucket: Env["IMAGES_BUCKET"];
  private imageBaseUrl: string;

  constructor(env: Env) {
    this.db = env.DB;
    this.cache = env.IMAGE_CACHE;
    this.dbImageService = new DatabaseImageService(env.DB, env);
    this.imagesBucket = env.IMAGES_BUCKET;
    this.imageBaseUrl = stripTrailingSlashes(env.IMAGE_API_BASE_URL);
  }

  generateImageUrl(imageId: string, variant: string): string {
    return `${this.imageBaseUrl}/images/${encodeURIComponent(
      imageId,
    )}/${encodeURIComponent(variant)}`;
  }

  imageObjectKey(imageId: string, variant: string): string {
    return `${imageId}/${variant}`;
  }

  buildVariantUrls(
    imageId: string,
    variants: string[],
  ): Record<string, string> {
    return variants.reduce<Record<string, string>>((urls, variant) => {
      urls[variant] = this.generateImageUrl(imageId, variant);
      return urls;
    }, {});
  }

  async putImageVariant(
    imageId: string,
    variant: string,
    file: File,
  ): Promise<void> {
    await this.imagesBucket.put(
      this.imageObjectKey(imageId, variant),
      await file.arrayBuffer(),
      {
        httpMetadata: {
          contentType: file.type || "application/octet-stream",
        },
        customMetadata: {
          imageId,
          variant,
          originalFilename: file.name,
        },
      },
    );
  }

  async getImageVariant(imageId: string, variant: string) {
    return this.imagesBucket.get(this.imageObjectKey(imageId, variant));
  }

  async deleteImageVariants(
    imageId: string,
    variants: Iterable<string>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await Promise.all(
        Array.from(new Set(variants)).map((variant) =>
          this.imagesBucket.delete(this.imageObjectKey(imageId, variant)),
        ),
      );

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete image",
      };
    }
  }

  async listStoredImages(options: {
    cursor?: string;
    limit?: number;
    prefix?: string;
  }): Promise<{
    success: boolean;
    result?: { images: StoredImageObject[]; cursor?: string };
    error?: string;
  }> {
    try {
      const result = await this.imagesBucket.list({
        cursor: options.cursor,
        limit: options.limit,
        prefix: options.prefix,
      });

      return {
        success: true,
        result: {
          images: result.objects
            .map((object) => {
              const [imageId, variant] = object.key.split("/");
              if (!imageId) return null;
              return {
                id: imageId,
                key: object.key,
                variant: variant || "original",
                uploaded: object.uploaded.toISOString(),
              };
            })
            .filter((image): image is StoredImageObject => image !== null),
          cursor: result.truncated ? result.cursor : undefined,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list images",
      };
    }
  }

  /**
   * Save image metadata to database
   */
  async saveImageMetadata(
    metadata: Omit<ImageMetadata, "id">,
    imageId?: string,
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      // ID will be generated by the database service

      // Use database service to create image record
      const imageData: CreateImageData = {
        id: imageId,
        filename: metadata.filename,
        originalFilename: metadata.originalFilename,
        mimeType: metadata.mimeType,
        size: metadata.size,
        width: metadata.width,
        height: metadata.height,
        category: metadata.category || "general",
        restaurantId: String(metadata.restaurantId || 1),
        uploadedBy: metadata.uploadedBy,
        variants: metadata.variants as unknown as string[],
        metadata: {
          tags: metadata.tags,
          altText: metadata.altText,
          caption: metadata.caption,
          exifData: metadata.exifData,
        },
      };

      const result = await this.dbImageService.createImage(imageData);
      const savedId = result.id;

      // Cache the metadata for quick access
      await this.cache.put(
        `image:${savedId}`,
        JSON.stringify({ id: savedId, ...metadata }),
        { expirationTtl: 3600 }, // Cache for 1 hour
      );

      return {
        success: true,
        id: savedId,
      };
    } catch (error) {
      console.error("Error saving image metadata:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to save metadata",
      };
    }
  }

  /**
   * Get image metadata by ID
   */
  async getImageMetadata(
    imageId: string,
  ): Promise<{ success: boolean; data?: ImageMetadata; error?: string }> {
    try {
      // Try cache first
      const cached = await this.cache.get(`image:${imageId}`);
      if (cached) {
        return {
          success: true,
          data: JSON.parse(cached),
        };
      }

      // Fetch from database using service
      const result = await this.dbImageService.getImage(imageId);

      if (!result) {
        return {
          success: false,
          error: "Image not found",
        };
      }

      // Parse metadata from database service result
      const dbMetadata = result.metadata ? JSON.parse(result.metadata) : {};
      const metadata: ImageMetadata = {
        id: result.id,
        filename: result.filename,
        originalFilename: result.originalFilename,
        mimeType: result.mimeType,
        size: result.size,
        width: result.width ?? undefined,
        height: result.height ?? undefined,
        variants: result.variants ? JSON.parse(result.variants) : [],
        uploadedAt:
          result.uploadedAt instanceof Date
            ? result.uploadedAt.toISOString()
            : String(result.uploadedAt),
        uploadedBy: result.uploadedBy !== null ? result.uploadedBy : undefined,
        restaurantId:
          result.restaurantId !== null ? result.restaurantId : undefined,
        category: result.category,
        tags: dbMetadata.tags,
        altText: dbMetadata.altText,
        caption: dbMetadata.caption,
        exifData: dbMetadata.exifData,
      };

      // Cache the result
      await this.cache.put(`image:${imageId}`, JSON.stringify(metadata), {
        expirationTtl: 3600,
      });

      return {
        success: true,
        data: metadata,
      };
    } catch (error) {
      console.error("Error getting image metadata:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get metadata",
      };
    }
  }

  /**
   * Update image metadata
   */
  async updateImageMetadata(
    imageId: string,
    updates: Partial<Omit<ImageMetadata, "id" | "filename" | "uploadedAt">>,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const hasUpdates =
        updates.altText !== undefined ||
        updates.caption !== undefined ||
        updates.category !== undefined ||
        updates.tags !== undefined ||
        updates.variants !== undefined;

      if (!hasUpdates) {
        return {
          success: false,
          error: "No fields to update",
        };
      }

      // Use database service for update - cast updates to compatible type
      await this.dbImageService.updateImage(
        imageId,
        updates as Partial<CreateImageData>,
      );

      // Invalidate cache
      await this.cache.delete(`image:${imageId}`);

      return { success: true };
    } catch (error) {
      console.error("Error updating image metadata:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update metadata",
      };
    }
  }

  /**
   * Delete image metadata
   */
  async deleteImageMetadata(
    imageId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Use database service for soft delete
      await this.dbImageService.deleteImage(imageId);

      // Remove from cache
      await this.cache.delete(`image:${imageId}`);

      return { success: true };
    } catch (error) {
      console.error("Error deleting image metadata:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to delete metadata",
      };
    }
  }

  /**
   * List images with filtering and pagination
   */
  async listImages(
    options: {
      restaurantId?: string;
      category?: string;
      uploadedBy?: string;
      tags?: string[];
      page?: number;
      limit?: number;
      sortBy?: "uploaded_at" | "filename" | "size";
      sortOrder?: "ASC" | "DESC";
    } = {},
  ): Promise<{
    success: boolean;
    data?: { images: ImageMetadata[]; total: number };
    error?: string;
  }> {
    try {
      const {
        restaurantId,
        category,
        uploadedBy,
        tags,
        page = 1,
        limit = 20,
        sortBy: _sortBy = "uploaded_at",
        sortOrder: _sortOrder = "DESC",
      } = options;

      const whereConditions: string[] = [];
      const params: unknown[] = [];

      if (restaurantId !== undefined) {
        whereConditions.push("restaurant_id = ?");
        params.push(restaurantId);
      }

      if (category !== undefined) {
        whereConditions.push("category = ?");
        params.push(category);
      }

      if (uploadedBy !== undefined) {
        whereConditions.push("uploaded_by = ?");
        params.push(uploadedBy);
      }

      if (tags && tags.length > 0) {
        // Simple tag search - could be improved with proper tag table
        const tagConditions = tags.map(() => "tags LIKE ?").join(" AND ");
        whereConditions.push(`(${tagConditions})`);
        tags.forEach((tag) => params.push(`%"${tag}"%`));
      }

      const _whereClause =
        whereConditions.length > 0
          ? `WHERE ${whereConditions.join(" AND ")}`
          : "";

      // Get total count
      // Use database service for count
      const totalCount = await this.dbImageService.getImagesCount({
        restaurantId:
          restaurantId !== undefined ? String(restaurantId) : undefined,
        category,
      });

      const total = totalCount || 0;

      // Get paginated results
      const offset = (page - 1) * limit;
      // Use database service for listing images
      const imageResults = await this.dbImageService.getImages({
        restaurantId:
          restaurantId !== undefined ? String(restaurantId) : undefined,
        category,
        offset,
        limit,
      });
      const images = { results: imageResults };

      const imageList: ImageMetadata[] = (
        images.results as DatabaseImageListRow[]
      ).map((row) => ({
        id: row.id,
        filename: row.filename,
        originalFilename: row.originalFilename ?? row.original_filename ?? "",
        mimeType: row.mimeType ?? row.mime_type ?? "",
        size: row.size,
        width: row.width ?? undefined,
        height: row.height ?? undefined,
        variants:
          typeof row.variants === "string"
            ? JSON.parse(row.variants)
            : (row.variants ?? {}),
        uploadedAt:
          row.uploadedAt instanceof Date
            ? row.uploadedAt.toISOString()
            : String(row.uploadedAt ?? row.uploaded_at ?? ""),
        uploadedBy: row.uploadedBy ?? row.uploaded_by ?? undefined,
        restaurantId:
          row.restaurantId !== undefined && row.restaurantId !== null
            ? String(row.restaurantId)
            : row.restaurant_id !== undefined && row.restaurant_id !== null
              ? String(row.restaurant_id)
              : undefined,
        category: row.category,
        tags: typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags,
        altText: row.altText ?? row.alt_text ?? undefined,
        caption: row.caption ?? undefined,
      }));

      return {
        success: true,
        data: {
          images: imageList,
          total,
        },
      };
    } catch (error) {
      console.error("Error listing images:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list images",
      };
    }
  }

  /**
   * Create processing job
   */
  async createProcessingJob(
    imageId: string,
    transformations: ImageTransformation[],
    variants: string[],
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    try {
      const dbJob = await this.dbImageService.createProcessingJob({
        imageId,
        jobType: "transformation",
        inputParams: {
          transformations,
          variants,
        },
      });
      const jobId = String(dbJob.id);

      const job: ImageProcessingJob = {
        id: jobId,
        imageId,
        status: "pending",
        transformations,
        variants,
        createdAt:
          dbJob.createdAt instanceof Date
            ? dbJob.createdAt.toISOString()
            : new Date().toISOString(),
      };

      // Cache job for quick access
      await this.cache.put(`job:${jobId}`, JSON.stringify(job), {
        expirationTtl: 3600,
      });

      return {
        success: true,
        jobId,
      };
    } catch (error) {
      console.error("Error creating processing job:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create job",
      };
    }
  }

  /**
   * Update processing job status
   */
  async updateJobStatus(
    jobId: string,
    status: ImageProcessingJob["status"],
    progress?: number,
    error?: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // FINAL NATIVE SQL ELIMINATED! 🎉 Using Drizzle ORM via DatabaseImageService
      const dbJobId = parseProcessingJobId(jobId);
      if (dbJobId === null) {
        return {
          success: false,
          error: "Invalid job ID",
        };
      }

      await this.dbImageService.updateProcessingJobStatus(
        dbJobId,
        status,
        progress !== undefined ? { progress } : undefined,
        error,
      );

      // Update cache
      const cached = await this.cache.get(`job:${jobId}`);
      if (cached) {
        const job = JSON.parse(cached);
        job.status = status;
        if (progress !== undefined) job.progress = progress;
        if (error !== undefined) job.error = error;
        if (status === "completed") job.completedAt = new Date().toISOString();

        await this.cache.put(`job:${jobId}`, JSON.stringify(job), {
          expirationTtl: 3600,
        });
      }

      return { success: true };
    } catch (error) {
      console.error("Error updating job status:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update job",
      };
    }
  }

  /**
   * Get processing job status
   */
  async getJobStatus(
    jobId: string,
    user: AuthUser,
  ): Promise<{ success: boolean; job?: ImageProcessingJob; error?: string }> {
    try {
      // Try cache first
      const cached = await this.cache.get(`job:${jobId}`);
      if (cached) {
        const job = JSON.parse(cached) as ImageProcessingJob;
        if (!(await this.canReadJob(job.imageId, user))) {
          return { success: false, error: "Job not found" };
        }
        return { success: true, job };
      }

      // Fetch from database
      // Use database service to get processing job
      const dbJobId = parseProcessingJobId(jobId);
      if (dbJobId === null) {
        return {
          success: false,
          error: "Invalid job ID",
        };
      }

      const result = await this.dbImageService.getProcessingJob(dbJobId);

      if (!result || !(await this.canReadJob(result.imageId, user))) {
        return { success: false, error: "Job not found" };
      }

      const job: ImageProcessingJob = {
        id: String(result.id),
        imageId: result.imageId as string,
        status: result.status as ImageProcessingJob["status"],
        transformations: result.inputParams
          ? JSON.parse(result.inputParams as string).transformations
          : [],
        variants: result.inputParams
          ? JSON.parse(result.inputParams as string).variants
          : [],
        createdAt:
          result.createdAt instanceof Date
            ? result.createdAt.toISOString()
            : String(result.createdAt),
        completedAt:
          result.completedAt instanceof Date
            ? result.completedAt.toISOString()
            : result.completedAt
              ? String(result.completedAt)
              : undefined,
        error: result.error as string | undefined,
        progress: result.outputData
          ? JSON.parse(result.outputData as string).progress
          : undefined,
      };

      return {
        success: true,
        job,
      };
    } catch (error) {
      console.error("Error getting job status:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get job status",
      };
    }
  }

  private async canReadJob(imageId: string, user: AuthUser): Promise<boolean> {
    // Read current ownership from D1 even when the job itself came from cache.
    const image = await this.dbImageService.getImage(imageId);
    return (
      !!image &&
      (user.role === 0 ||
        image.uploadedBy === user.id ||
        (user.restaurantId !== undefined &&
          image.restaurantId === user.restaurantId))
    );
  }

  /**
   * Get image analytics
   */
  async getImageAnalytics(
    options: {
      restaurantId?: string;
      dateFrom?: string;
      dateTo?: string;
    } = {},
  ): Promise<{ success: boolean; analytics?: ImageAnalytics; error?: string }> {
    try {
      // Basic statistics
      // Use database service for analytics summary
      const basicStats =
        await this.dbImageService.getImageAnalyticsSummary(options);

      // Category breakdown
      // Use database service for category stats
      const categoryStats = await this.dbImageService.getCategoryStats(options);

      // Processing job statistics
      // Use database service for job stats
      const jobStats = await this.dbImageService.getJobStats(options);

      const analytics: ImageAnalytics = {
        totalImages: (basicStats?.total_images as number) || 0,
        totalSize: (basicStats?.total_storage as number) || 0,
        avgProcessingTime: 0, // Will be calculated from job stats
        mostUsedVariants: [], // Would need variant usage tracking
        uploadsByCategory: ((categoryStats || []) as CategoryStatsRow[]).map(
          (row) => ({
            category: row.category || "uncategorized",
            count: row.count,
          }),
        ),
        errorRate: 0, // Calculate from job stats
        storageUsage: {
          original: (basicStats?.total_storage as number) || 0,
          variants: 0, // Would need variant size tracking
          total: (basicStats?.total_storage as number) || 0,
        },
      };

      // Calculate processing metrics from job stats
      const jobResults = jobStats || [];
      const completedJobs = jobResults.find(
        (row: JobStatsRow) => row.status === "completed",
      );
      const failedJobs = (jobResults as JobStatsRow[]).find(
        (row) => row.status === "failed",
      );
      const totalJobs = (jobResults as JobStatsRow[]).reduce(
        (sum, row) => sum + row.count,
        0,
      );

      if (completedJobs) {
        analytics.avgProcessingTime = completedJobs.avg_duration || 0;
      }

      if (failedJobs && totalJobs > 0) {
        analytics.errorRate = (failedJobs.count / totalJobs) * 100;
      }

      return {
        success: true,
        analytics,
      };
    } catch (error) {
      console.error("Error getting image analytics:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get analytics",
      };
    }
  }

  /**
   * Record image view/access for analytics
   */
  async recordImageView(
    imageId: string,
    variant: string = "original",
  ): Promise<void> {
    try {
      // Use database service for recording views
      await this.dbImageService.recordImageView({
        imageId,
        variant,
      });
    } catch (error) {
      // Log error but don't fail the request
      console.error("Error recording image view:", error);
    }
  }
}
