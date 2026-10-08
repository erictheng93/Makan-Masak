/**
 * QR Codes Service
 * Business logic for QR codes feature
 */

import type { Env } from "../../../shared/types";
import { getDatabaseConnection } from "../../../core/database";
import { KVCacheService } from "../../../core/cache";
import {
  ConsoleLogger,
  SimplePerformanceTracker,
} from "../../../core/monitoring";
import { CACHE_TTL, USER_ROLES } from "../../../shared/constants";
import { forbidden } from "../../../shared/utils/api-error";
import {
  QRCodeService,
  count,
  eq,
  inArray,
  qrCodes,
  qrDownloads,
  qrTemplates,
  users,
} from "@makanmasak/database";
import * as QRCode from "qrcode";
import { strToU8, zipSync } from "fflate";

// Import types
import type {
  QRCodeEntity,
  QRBatchEntity,
  QRTemplate,
  GenerateQRRequest,
  BulkQRRequest,
  CreateQRTemplateData,
  UpdateQRTemplateData,
  QRStatistics,
  QRDownloadCaller,
  QRTemplateActor,
  IQRCodeService,
  IQRTemplateService,
} from "../types";

interface QRBatchStatus {
  totalCodes?: number | null;
  total_codes?: number | null;
  restaurantId?: string | number | null;
  restaurant_id?: string | number | null;
}

interface QROwnedResource {
  restaurantId?: string | number | null;
  restaurant_id?: string | number | null;
}

export class QrCodesService implements IQRCodeService, IQRTemplateService {
  private db: ReturnType<typeof getDatabaseConnection>;
  private qrService: QRCodeService;
  private cache: KVCacheService;
  private logger: ConsoleLogger;
  private performance: SimplePerformanceTracker;

  constructor(private env: Env) {
    this.db = getDatabaseConnection(env);
    this.qrService = new QRCodeService(env.DB, env);
    this.cache = new KVCacheService(env.CACHE_KV);
    this.logger = new ConsoleLogger("qr-codes-service");
    this.performance = new SimplePerformanceTracker();
  }

  // QR Code Generation Methods
  async generateQR(
    data: GenerateQRRequest,
    userId?: string,
    restaurantId?: string,
  ): Promise<QRCodeEntity> {
    const timer = this.performance.startTimer("qr-codes.generate");

    try {
      // Add creator information to metadata
      if (!data.metadata) {
        data.metadata = {};
      }

      if (userId) {
        data.metadata.createdBy = userId.toString();
      }

      // Call the existing QRCodeService with correct method name
      const result = await this.qrService.generateQRCode({
        content: data.content,
        format: data.format || "png",
        style: data.style,
        metadata: data.metadata,
        restaurantId,
        createdBy: userId,
      });
      const qrEntityId = this.toStringEntityId(result.id, "QR code generation");

      // Transform result to match our entity interface
      const qrEntity: QRCodeEntity = {
        id: qrEntityId,
        content: data.content,
        format: data.format || "png",
        style: data.style,
        metadata: data.metadata,
        downloadUrl: result.url || undefined,
        downloadCount: 0,
        fileSize: undefined,
        restaurantId,
        userId,
        createdAt: new Date(result.createdAt),
        updatedAt: new Date(result.createdAt),
      };

      // Create audit log
      await this.qrService.createAuditLog({
        userId: userId ?? "system",
        action: "QR_GENERATED",
        resource: "qr_codes",
        description: `Generated QR code for content: ${data.content.substring(0, 50)}...`,
      });

      this.logger.info("QR Code generated", {
        id: qrEntity.id,
        format: data.format,
        userId,
        restaurantId,
      });

      this.performance.recordMetric("qr-codes.generate.success", 1);
      return qrEntity;
    } catch (error) {
      this.logger.error("Failed to generate QR code", error as Error, {
        data,
        userId,
        restaurantId,
      });
      this.performance.recordMetric("qr-codes.generate.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.generate.duration",
        duration,
        "ms",
      );
    }
  }

  async generateBulkQR(
    data: BulkQRRequest,
    userId?: string,
    restaurantId?: string,
  ): Promise<QRBatchEntity> {
    const timer = this.performance.startTimer("qr-codes.generateBulk");

    try {
      if (!restaurantId || !userId) {
        throw new Error(
          "Restaurant ID and User ID are required for bulk generation",
        );
      }

      // Extract table IDs from the request
      const tableIds = data.tables.map((table) => table.id);

      // Call the existing QRCodeService for bulk generation (convert to string for database service)
      const result = await this.qrService.generateBulkQRCodes(
        String(restaurantId),
        tableIds,
        userId,
      );
      const batchEntityId = this.toNumericEntityId(
        result.id,
        "QR batch generation",
      );

      // Transform result to match our entity interface
      const batchEntity: QRBatchEntity = {
        id: batchEntityId,
        name: `Batch-${Date.now()}`,
        format: data.format || "zip",
        itemCount: data.tables.length,
        downloadUrl: undefined,
        downloadCount: 0,
        totalFileSize: 0,
        restaurantId,
        userId,
        status: "completed",
        progress: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
        batchId: result.batchId,
      };

      this.logger.info("Bulk QR codes generated", {
        batchId: result.batchId,
        itemCount: data.tables.length,
        userId,
        restaurantId,
      });

      this.performance.recordMetric("qr-codes.generateBulk.success", 1);
      return batchEntity;
    } catch (error) {
      this.logger.error("Failed to generate bulk QR codes", error as Error, {
        data,
        userId,
        restaurantId,
      });
      this.performance.recordMetric("qr-codes.generateBulk.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.generateBulk.duration",
        duration,
        "ms",
      );
    }
  }

  async downloadQR(
    id: string,
    caller?: QRDownloadCaller,
  ): Promise<{ data: Buffer; contentType: string; filename: string } | null> {
    const timer = this.performance.startTimer("qr-codes.download");

    try {
      // Get QR code details first
      const qrCode = await this.qrService.getQRCode(id);

      if (!qrCode) {
        return null;
      }

      this.assertRestaurantAccess(qrCode, caller);

      // Record the download
      await this.qrService.recordDownload(id, qrCode.format || "png");

      const rendered = await this.renderQRCodeArtifact(
        qrCode.content,
        qrCode.format || "png",
        this.parseQRStyle(qrCode.styleJson),
      );

      this.logger.info("QR code downloaded", { id });
      this.performance.recordMetric("qr-codes.download.success", 1);

      return {
        data: rendered.data,
        contentType: rendered.contentType,
        filename: `qr-code-${id}.${rendered.extension}`,
      };
    } catch (error) {
      this.logger.error("Failed to download QR code", error as Error, { id });
      this.performance.recordMetric("qr-codes.download.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.download.duration",
        duration,
        "ms",
      );
    }
  }

  async downloadBatch(
    batchId: string,
    caller?: QRDownloadCaller,
  ): Promise<{ data: Buffer; contentType: string; filename: string } | null> {
    const timer = this.performance.startTimer("qr-codes.downloadBatch");

    try {
      // Get batch status
      const batch = await this.qrService.getBatchStatus(batchId);

      if (!batch) {
        return null;
      }

      this.assertRestaurantAccess(batch, caller);

      const archive = await this.renderBatchArchive(batchId, batch);

      this.logger.info("Batch QR codes downloaded", { batchId });
      this.performance.recordMetric("qr-codes.downloadBatch.success", 1);

      return {
        data: archive,
        contentType: "application/zip",
        filename: `qr-batch-${batchId}.zip`,
      };
    } catch (error) {
      this.logger.error("Failed to download batch QR codes", error as Error, {
        batchId,
      });
      this.performance.recordMetric("qr-codes.downloadBatch.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.downloadBatch.duration",
        duration,
        "ms",
      );
    }
  }

  async getStatistics(restaurantId?: string): Promise<QRStatistics> {
    const timer = this.performance.startTimer("qr-codes.getStatistics");

    try {
      // Try cache first
      const cacheKey = `qr-stats:${restaurantId || "global"}`;
      const cached = await this.cache.get<QRStatistics>(cacheKey);

      if (cached) {
        this.logger.debug("Statistics retrieved from cache", { restaurantId });
        return cached;
      }

      const qrStats = restaurantId
        ? await this.getRestaurantStatistics(restaurantId)
        : await this.getGlobalStatistics();

      // Cache the result
      await this.cache.set(cacheKey, qrStats, CACHE_TTL.MEDIUM);

      this.performance.recordMetric("qr-codes.getStatistics.success", 1);
      return qrStats;
    } catch (error) {
      this.logger.error("Failed to get QR code statistics", error as Error, {
        restaurantId,
      });
      this.performance.recordMetric("qr-codes.getStatistics.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.getStatistics.duration",
        duration,
        "ms",
      );
    }
  }

  private assertRestaurantAccess(
    resource: QROwnedResource,
    caller?: QRDownloadCaller,
  ): void {
    if (caller?.userRole === 0) {
      return;
    }

    const resourceRestaurantId = String(
      resource.restaurantId ?? resource.restaurant_id ?? "",
    );

    if (
      !caller?.userRestaurantId ||
      !resourceRestaurantId ||
      caller.userRestaurantId !== resourceRestaurantId
    ) {
      throw forbidden("Access denied");
    }
  }

  private async getGlobalStatistics(): Promise<QRStatistics> {
    const stats = await this.qrService.getQRCodeStats();

    return {
      totalQRCodes: stats.totalCodes || 0,
      totalDownloads: stats.totalDownloads || 0,
      totalTemplates: 0,
      popularTemplates: (stats.popularTemplates || []).map((template) => ({
        id: template.id,
        name: template.name,
        usage_count: template.usageCount || 0,
      })),
      formatDistribution: {},
      recentActivity: [],
    };
  }

  private async getRestaurantStatistics(
    restaurantId: string,
  ): Promise<QRStatistics> {
    // qr_templates has no restaurant_id: a template belongs to whoever created
    // it, and a user belongs to one restaurant.
    const restaurantUsers = this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.restaurantId, restaurantId));

    const [[codes], [downloads], [templates]] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(qrCodes)
        .where(eq(qrCodes.restaurantId, restaurantId)),
      this.db
        .select({ count: count() })
        .from(qrDownloads)
        .innerJoin(qrCodes, eq(qrCodes.id, qrDownloads.qrCodeId))
        .where(eq(qrCodes.restaurantId, restaurantId)),
      this.db
        .select({ count: count() })
        .from(qrTemplates)
        .where(inArray(qrTemplates.createdBy, restaurantUsers)),
    ]);

    return {
      totalQRCodes: codes?.count ?? 0,
      totalDownloads: downloads?.count ?? 0,
      totalTemplates: templates?.count ?? 0,
      // Template usage is not recorded anywhere (same as getGlobalStatistics).
      popularTemplates: [],
      formatDistribution: {},
      recentActivity: [],
    };
  }

  private parseQRStyle(styleJson: string | null | undefined) {
    if (!styleJson) {
      return undefined;
    }

    try {
      return JSON.parse(styleJson) as GenerateQRRequest["style"];
    } catch {
      this.logger.warn("Invalid QR style JSON ignored");
      return undefined;
    }
  }

  private async renderQRCodeArtifact(
    content: string,
    format: string,
    style?: GenerateQRRequest["style"],
  ): Promise<{
    data: Buffer;
    contentType: string;
    extension: string;
  }> {
    const options = {
      errorCorrectionLevel: style?.errorCorrection || "M",
      margin: 2,
      width: style?.size || 512,
      color: {
        dark: style?.foregroundColor || "#000000",
        light: style?.backgroundColor || "#ffffff",
      },
    } as const;

    if (format === "svg" || format === "pdf" || format === "jpeg") {
      const svg = await QRCode.toString(content, {
        ...options,
        type: "svg",
      });
      return {
        data: Buffer.from(svg, "utf8"),
        contentType: "image/svg+xml",
        extension: "svg",
      };
    }

    const png = await QRCode.toBuffer(content, {
      ...options,
      type: "png",
    });
    return {
      data: Buffer.from(png),
      contentType: "image/png",
      extension: "png",
    };
  }

  private async renderBatchArchive(
    batchId: string,
    batch: QRBatchStatus,
  ): Promise<Buffer> {
    const totalCodes = Number(batch.totalCodes ?? batch.total_codes ?? 0);
    const restaurantId = String(
      batch.restaurantId ?? batch.restaurant_id ?? "unknown-restaurant",
    );

    const entries: Record<string, Uint8Array> = {
      "manifest.json": strToU8(
        JSON.stringify(
          {
            batchId,
            restaurantId,
            totalCodes,
            generatedAt: new Date().toISOString(),
            format: "svg",
          },
          null,
          2,
        ),
      ),
    };

    for (let index = 1; index <= totalCodes; index += 1) {
      const content = `makanmakan://restaurant/${restaurantId}/qr-batch/${batchId}/code/${index}`;
      const svg = await QRCode.toString(content, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        width: 512,
      });
      entries[`qr-code-${String(index).padStart(3, "0")}.svg`] = strToU8(svg);
    }

    return Buffer.from(zipSync(entries, { level: 6 }));
  }

  // Template Management Methods
  async listTemplates(category?: string): Promise<QRTemplate[]> {
    const timer = this.performance.startTimer("qr-codes.listTemplates");

    try {
      // Try cache first
      const cacheKey = `qr-templates:${category || "all"}`;
      const cached = await this.cache.get<QRTemplate[]>(cacheKey);

      if (cached) {
        this.logger.debug("Templates retrieved from cache", { category });
        return cached;
      }

      // Get templates from the existing QRCodeService
      const templates = await this.qrService.getActiveTemplates();

      // Transform to match our interface (map the database structure to our interface)
      const transformedTemplates: QRTemplate[] = templates.map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description || "",
        category: "modern", // Default category since it's not in DB schema
        style: template.styleJson ? JSON.parse(template.styleJson) : {},
        isActive: template.isActive,
        usage_count: 0, // Would need separate query to get usage count
        createdAt: new Date(template.createdAt),
        updatedAt: new Date(template.updatedAt),
      }));

      // Cache the result
      await this.cache.set(cacheKey, transformedTemplates, CACHE_TTL.LONG);

      this.performance.recordMetric("qr-codes.listTemplates.success", 1);
      return transformedTemplates;
    } catch (error) {
      this.logger.error("Failed to list QR code templates", error as Error, {
        category,
      });
      this.performance.recordMetric("qr-codes.listTemplates.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.listTemplates.duration",
        duration,
        "ms",
      );
    }
  }

  async getTemplate(id: number): Promise<QRTemplate | null> {
    const timer = this.performance.startTimer("qr-codes.getTemplate");

    try {
      // Try cache first
      const cacheKey = `qr-template:${id}`;
      const cached = await this.cache.get<QRTemplate>(cacheKey);

      if (cached) {
        this.logger.debug("Template retrieved from cache", { id });
        return cached;
      }

      // Get template from the existing QRCodeService
      const template = await this.qrService.getTemplate(id);

      if (!template) {
        return null;
      }

      // Transform to match our interface
      const transformedTemplate: QRTemplate = {
        id: template.id,
        name: template.name,
        description: template.description || "",
        category: "modern", // Default category since it's not in DB schema
        style: template.styleJson ? JSON.parse(template.styleJson) : {},
        isActive: template.isActive,
        usage_count: 0, // Would need separate query to get usage count
        createdAt: new Date(template.createdAt),
        updatedAt: new Date(template.updatedAt),
      };

      // Cache the result
      await this.cache.set(cacheKey, transformedTemplate, CACHE_TTL.LONG);

      this.performance.recordMetric("qr-codes.getTemplate.success", 1);
      return transformedTemplate;
    } catch (error) {
      this.logger.error("Failed to get QR code template", error as Error, {
        id,
      });
      this.performance.recordMetric("qr-codes.getTemplate.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.getTemplate.duration",
        duration,
        "ms",
      );
    }
  }

  async createTemplate(data: CreateQRTemplateData): Promise<QRTemplate> {
    const timer = this.performance.startTimer("qr-codes.createTemplate");

    try {
      // Create template using the existing QRCodeService
      const template = await this.qrService.createTemplate({
        name: data.name,
        description: data.description,
        style: data.style,
        createdBy: data.createdBy ?? "system",
      });

      // Transform to match our interface
      const transformedTemplate: QRTemplate = {
        id: template.id,
        name: template.name,
        description: template.description || "",
        category: data.category,
        style: JSON.parse(template.styleJson),
        isActive: template.isActive,
        usage_count: 0,
        createdAt: new Date(template.createdAt),
        updatedAt: new Date(template.updatedAt),
      };

      // Clear template caches
      await this.cache.clear("qr-templates:");

      this.logger.info("QR code template created", {
        id: template.id,
        name: data.name,
      });
      this.performance.recordMetric("qr-codes.createTemplate.success", 1);

      return transformedTemplate;
    } catch (error) {
      this.logger.error("Failed to create QR code template", error as Error, {
        data,
      });
      this.performance.recordMetric("qr-codes.createTemplate.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.createTemplate.duration",
        duration,
        "ms",
      );
    }
  }

  async updateTemplate(
    id: number,
    data: UpdateQRTemplateData,
    actor: QRTemplateActor,
  ): Promise<QRTemplate | null> {
    const timer = this.performance.startTimer("qr-codes.updateTemplate");

    try {
      // 帶入真實操作者：模板歸屬只看 created_by，寫死 "system" 會讓任何店主
      // 改到別人的模板，審計日誌也記不到真兇。
      const template = await this.qrService.updateTemplate(
        id,
        {
          name: data.name,
          description: data.description,
          style: data.style,
        },
        actor.userId,
        { isPlatformAdmin: actor.userRole === USER_ROLES.ADMIN },
      );

      if (!template) {
        return null;
      }

      // Transform to match our interface
      const transformedTemplate: QRTemplate = {
        id: template.id,
        name: template.name,
        description: template.description || "",
        category: data.category || "modern",
        style: JSON.parse(template.styleJson),
        isActive: template.isActive,
        usage_count: 0,
        createdAt: new Date(template.createdAt),
        updatedAt: new Date(template.updatedAt),
      };

      // Clear caches
      await this.cache.delete(`qr-template:${id}`);
      await this.cache.clear("qr-templates:");

      this.logger.info("QR code template updated", { id });
      this.performance.recordMetric("qr-codes.updateTemplate.success", 1);

      return transformedTemplate;
    } catch (error) {
      this.logger.error("Failed to update QR code template", error as Error, {
        id,
        data,
      });
      this.performance.recordMetric("qr-codes.updateTemplate.error", 1);
      throw error;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.updateTemplate.duration",
        duration,
        "ms",
      );
    }
  }

  async deleteTemplate(id: number, actor: QRTemplateActor): Promise<boolean> {
    const timer = this.performance.startTimer("qr-codes.deleteTemplate");

    try {
      // 同 updateTemplate：軟刪除也必須限定在自己建立的模板。
      const deleted = await this.qrService.deleteTemplate(id, actor.userId, {
        isPlatformAdmin: actor.userRole === USER_ROLES.ADMIN,
      });

      if (!deleted) {
        return false;
      }

      // Clear caches
      await this.cache.delete(`qr-template:${id}`);
      await this.cache.clear("qr-templates:");

      this.logger.info("QR code template deleted", { id });
      this.performance.recordMetric("qr-codes.deleteTemplate.success", 1);

      return true;
    } catch (error) {
      this.logger.error("Failed to delete QR code template", error as Error, {
        id,
      });
      this.performance.recordMetric("qr-codes.deleteTemplate.error", 1);
      return false;
    } finally {
      const duration = this.performance.endTimer(timer);
      this.performance.recordMetric(
        "qr-codes.deleteTemplate.duration",
        duration,
        "ms",
      );
    }
  }

  private toNumericEntityId(
    id: string | number | null | undefined,
    context: string,
  ): number {
    if (id === null || id === undefined || id === "") {
      throw new Error(`${context} did not return an ID`);
    }

    const numericId = Number.parseInt(String(id), 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new Error(`${context} returned a non-numeric ID`);
    }

    return numericId;
  }

  private toStringEntityId(
    id: string | number | null | undefined,
    context: string,
  ): string {
    if (id === null || id === undefined || id === "") {
      throw new Error(`${context} did not return an ID`);
    }

    return String(id);
  }
}
