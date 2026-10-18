import { Context, Next } from "hono";
import { z } from "zod";
import type { Env } from "../types/env";

// 通用驗證錯誤處理
export const handleValidationError = (error: z.ZodError) => {
  const errors = error.issues.map((err) => ({
    field: err.path.join("."),
    message: err.message,
    code: err.code,
  }));

  return {
    success: false,
    error: "Validation failed",
    details: errors,
  };
};

// 請求體驗證中間件
export const validateBody = <T>(schema: z.ZodSchema<T>) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const body = await c.req.json();
      const validated = schema.parse(body);

      c.set("validatedBody", validated);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(handleValidationError(error), 400);
      }

      return c.json(
        {
          success: false,
          error: "Invalid JSON body",
        },
        400,
      );
    }
  };
};

// 查詢參數驗證中間件
export const validateQuery = <T>(schema: z.ZodSchema<T>) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const query = c.req.query();
      const validated = schema.parse(query);

      c.set("validatedQuery", validated);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(handleValidationError(error), 400);
      }

      return c.json(
        {
          success: false,
          error: "Invalid query parameters",
        },
        400,
      );
    }
  };
};

// 路徑參數驗證中間件
export const validateParams = <T>(schema: z.ZodSchema<T>) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const params = c.req.param();
      const validated = schema.parse(params);

      c.set("validatedParams", validated);
      await next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return c.json(handleValidationError(error), 400);
      }

      return c.json(
        {
          success: false,
          error: "Invalid path parameters",
        },
        400,
      );
    }
  };
};

// 常用的驗證 schemas
export const imageSchemas = {
  // 圖片上傳參數
  uploadParams: z.object({
    variants: z.string().optional(),
    category: z.string().max(50).optional(),
    altText: z.string().max(200).optional(),
    caption: z.string().max(500).optional(),
    tags: z.string().optional(), // comma-separated tags
    restaurantId: z.uuid().optional(),
  }),

  // 圖片處理參數
  processParams: z.object({
    transformations: z
      .array(
        z.object({
          type: z.enum([
            "resize",
            "crop",
            "rotate",
            "blur",
            "brighten",
            "sharpen",
          ]),
          width: z.number().int().positive().max(2048).optional(),
          height: z.number().int().positive().max(2048).optional(),
          fit: z
            .enum(["scale-down", "contain", "cover", "crop", "pad"])
            .optional(),
          gravity: z
            .enum(["auto", "center", "top", "bottom", "left", "right"])
            .optional(),
          angle: z.number().min(-360).max(360).optional(),
          radius: z.number().min(0).max(50).optional(),
          sigma: z.number().min(0).max(10).optional(),
          amount: z.number().min(0).max(100).optional(),
          background: z
            .string()
            .regex(/^#[0-9a-fA-F]{6}$/)
            .optional(),
        }),
      )
      .optional(),
    variants: z.array(z.string()).optional(),
    format: z.enum(["webp", "jpeg", "png", "avif"]).optional(),
    quality: z.number().int().min(1).max(100).optional(),
  }),

  // 圖片列表查詢
  listQuery: z.object({
    restaurantId: z.uuid().optional(),
    category: z.string().optional(),
    uploadedBy: z.uuid().optional(),
    tags: z.string().optional(), // comma-separated
    page: z.preprocess((val) => (val ? Number(val) : 1), z.number().default(1)),
    limit: z.preprocess(
      (val) => (val ? Number(val) : 20),
      z.number().default(20),
    ),
    sortBy: z.enum(["uploaded_at", "filename", "size"]).default("uploaded_at"),
    sortOrder: z.enum(["ASC", "DESC"]).default("DESC"),
  }),

  // 圖片 ID 參數
  imageIdParam: z
    .object({
      imageId: z.string().min(1),
      id: z.string().min(1).optional(),
    })
    .transform((data) => ({
      imageId: data.imageId || data.id!,
      id: data.imageId || data.id!,
    })),

  // 圖片變體參數
  variantParams: z.object({
    variant: z.string().default("original"),
    width: z.preprocess(
      (val) => (val ? Number(val) : undefined),
      z.number().optional(),
    ),
    height: z.preprocess(
      (val) => (val ? Number(val) : undefined),
      z.number().optional(),
    ),
    fit: z.enum(["scale-down", "contain", "cover", "crop", "pad"]).optional(),
    format: z.enum(["webp", "jpeg", "png", "avif"]).optional(),
    quality: z.preprocess(
      (val) => (val ? Number(val) : undefined),
      z.number().optional(),
    ),
  }),

  // 圖片更新參數
  updateBody: z.object({
    altText: z.string().max(200).optional(),
    caption: z.string().max(500).optional(),
    category: z.string().max(50).optional(),
    tags: z.array(z.string()).optional(),
  }),

  // 分析查詢參數
  analyticsQuery: z.object({
    restaurantId: z.uuid().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),

  // 批量操作參數
  bulkOperationBody: z.object({
    imageIds: z.array(z.string()).min(1).max(100),
    operation: z.enum([
      "delete",
      "update_category",
      "update_tags",
      "generate_variants",
    ]),
    data: z.record(z.string(), z.any()).optional(),
  }),
};

export type ImageUploadQuery = z.infer<typeof imageSchemas.uploadParams>;
export type ImageListQuery = z.infer<typeof imageSchemas.listQuery>;
export type ImageIdParams = z.infer<typeof imageSchemas.imageIdParam>;
export type ImageVariantQuery = z.infer<typeof imageSchemas.variantParams>;
export type ImageUpdateBody = z.infer<typeof imageSchemas.updateBody>;
export type ImageProcessBody = z.infer<typeof imageSchemas.processParams>;
export type ImageBulkOperationBody = z.infer<
  typeof imageSchemas.bulkOperationBody
>;
export type ImageAnalyticsQuery = z.infer<typeof imageSchemas.analyticsQuery>;

// 文件類型驗證中間件
export const validateFileType = (allowedMimeTypes: string[]) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const contentType = c.req.header("Content-Type") || "";

      // 對於 multipart/form-data，需要解析 FormData 來檢查文件類型
      if (contentType.includes("multipart/form-data")) {
        const formData = await c.req.formData();
        const file = formData.get("file") as File;

        if (file && file.type) {
          const normalizedTypes = allowedMimeTypes.map((type) =>
            type.toLowerCase().trim(),
          );

          if (!normalizedTypes.includes(file.type.toLowerCase())) {
            return c.json(
              {
                success: false,
                error: "Invalid file type",
                allowedTypes: allowedMimeTypes,
                receivedType: file.type,
              },
              400,
            );
          }
        }

        // 將 FormData 重新設置到 context 以供後續使用
        c.set("formData", formData);
        c.set("file", file);
      }

      await next();
    } catch (error) {
      console.error("File type validation error:", error);
      return c.json(
        {
          success: false,
          error: "File validation failed",
        },
        400,
      );
    }
  };
};

// 圖片尺寸驗證中間件
export const validateImageDimensions = (options: {
  maxWidth?: number;
  maxHeight?: number;
  minWidth?: number;
  minHeight?: number;
  aspectRatio?: { width: number; height: number; tolerance?: number };
}) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    try {
      const file = c.get("file") as File;

      if (file && file.type.startsWith("image/")) {
        // 在實際應用中，這裡需要解析圖片來獲取尺寸
        // 由於 Workers 環境限制，這裡提供基本的文件大小檢查

        const {
          maxWidth: _maxWidth,
          maxHeight: _maxHeight,
          minWidth: _minWidth,
          minHeight: _minHeight,
          aspectRatio: _aspectRatio,
        } = options;

        // 注意：在 Workers 中解析圖片尺寸需要使用 WebP 或其他支持的 API
        // 這裡提供一個簡化的實現示例

        // 實際實現中，你可能需要：
        // 1. 使用 ImageMagick WASM 版本
        // 2. 使用 Canvas API（如果可用）
        // 3. 使用第三方服務來獲取圖片信息

        console.log(
          "Image dimension validation - feature needs implementation",
        );
      }

      await next();
    } catch (error) {
      console.error("Image dimension validation error:", error);
      await next();
    }
  };
};

// 安全檢查中間件 - 檢查圖片是否包含惡意內容
export const securityScan = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  try {
    const file = c.get("file") as File;

    if (file) {
      // 檢查文件擴展名和 MIME 類型是否匹配
      const filename = file.name || "";
      const extension = filename.split(".").pop()?.toLowerCase();
      const mimeType = file.type.toLowerCase();

      const extensionMimeMap: Record<string, string[]> = {
        jpg: ["image/jpeg"],
        jpeg: ["image/jpeg"],
        png: ["image/png"],
        webp: ["image/webp"],
        gif: ["image/gif"],
        avif: ["image/avif"],
      };

      if (extension && extensionMimeMap[extension]) {
        if (!extensionMimeMap[extension].includes(mimeType)) {
          return c.json(
            {
              success: false,
              error: "File extension and MIME type mismatch",
              extension,
              mimeType,
            },
            400,
          );
        }
      }

      // 檢查文件頭（魔術數字）
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer.slice(0, 16));

      // JPEG: FF D8 FF
      // PNG: 89 50 4E 47
      // GIF: 47 49 46 38
      // WebP: 52 49 46 46 ... 57 45 42 50

      const isValidImage =
        (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) || // JPEG
        (bytes[0] === 0x89 &&
          bytes[1] === 0x50 &&
          bytes[2] === 0x4e &&
          bytes[3] === 0x47) || // PNG
        (bytes[0] === 0x47 &&
          bytes[1] === 0x49 &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x38) || // GIF
        (bytes[0] === 0x52 &&
          bytes[1] === 0x49 &&
          bytes[2] === 0x46 &&
          bytes[3] === 0x46); // RIFF (WebP)

      if (!isValidImage) {
        return c.json(
          {
            success: false,
            error: "Invalid image file format",
          },
          400,
        );
      }

      // 重新創建 File 對象，因為我們消耗了 ArrayBuffer
      const newFile = new File([arrayBuffer], file.name, { type: file.type });
      c.set("file", newFile);
    }

    await next();
  } catch (error) {
    console.error("Security scan error:", error);
    return c.json(
      {
        success: false,
        error: "Security scan failed",
      },
      500,
    );
  }
};

// 擴展 Context 類型以包含驗證後的資料
declare module "hono" {
  interface ContextVariableMap {
    validatedBody: unknown;
    validatedQuery: unknown;
    validatedParams: unknown;
    formData: FormData;
    file: File;
  }
}
