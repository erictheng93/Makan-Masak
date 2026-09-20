/**
 * 統一收據格式化服務
 * 負責根據地區、模板和業務需求格式化收據內容
 */

import type {
  PrintContent,
  PrintRequest,
  CountryCode,
  RegionConfig,
  ReceiptTemplate,
  TemplateLayout,
  PrintJobType,
} from "@makanmasak/shared-types";

import { ReceiptFormatterFactory } from "./ReceiptFormatterFactory";
import { PrintFormattingError } from "../errors/PrintErrors";
import { REGION_CONFIGS } from "../config/regions";
import { formatCurrencyAmount } from "../utils/money";

export class ReceiptFormattingService {
  private regions: Map<CountryCode, RegionConfig> = new Map();
  private templates: Map<string, ReceiptTemplate> = new Map();

  constructor() {
    this.initializeDefaultConfigs();
  }

  // =============================================
  // 主要格式化方法
  // =============================================

  async formatReceipt(request: PrintRequest): Promise<PrintContent> {
    try {
      // 獲取地區配置
      const region = this.getRegionConfig(request.country);

      // 驗證請求數據
      this.validatePrintRequest(request);

      // 創建格式化器
      const formatter = ReceiptFormatterFactory.createFormatter(
        request.country,
        region,
      );

      // 執行格式化
      const content = formatter.formatReceipt(request);

      // 驗證輸出內容
      this.validatePrintContent(content);

      return content;
    } catch (error) {
      throw new PrintFormattingError(`Failed to format receipt: ${error}`, {
        request,
        error,
      });
    }
  }

  async formatBatch(requests: PrintRequest[]): Promise<PrintContent[]> {
    const results: PrintContent[] = [];
    const errors: Array<{ index: number; error: unknown }> = [];

    for (let i = 0; i < requests.length; i++) {
      try {
        const content = await this.formatReceipt(requests[i]);
        results.push(content);
      } catch (error) {
        errors.push({ index: i, error });
        // 添加空內容作為佔位符
        results.push({
          header: {
            restaurantInfo: {
              name: "Unknown Restaurant",
              address: "Unknown Address",
              phone: "Unknown Phone",
            },
            transactionInfo: {
              orderId: "UNKNOWN",
              cashier: "Unknown",
              timestamp: new Date(),
              receiptNumber: "ERROR",
            },
          },
          items: [],
          summary: { subtotal: 0, tax: [], total: 0, payment: [] },
          footer: {
            thankYouMessage: "Error processing receipt",
          },
        });
      }
    }

    if (errors.length > 0) {
      console.warn(
        `Batch formatting completed with ${errors.length} errors:`,
        errors,
      );
    }

    return results;
  }

  // =============================================
  // 模板管理
  // =============================================

  addTemplate(id: string, template: ReceiptTemplate): void {
    this.validateTemplate(template);
    this.templates.set(id, template);
  }

  getTemplate(country: CountryCode, type: string): ReceiptTemplate {
    // 嘗試獲取特定國家和類型的模板
    const specificTemplate = this.templates.get(`${country}_${type}`);
    if (specificTemplate) return specificTemplate;

    // 嘗試獲取國家預設模板
    const countryDefault = this.templates.get(`${country}_default`);
    if (countryDefault) return countryDefault;

    // 嘗試獲取類型預設模板
    const typeDefault = this.templates.get(`default_${type}`);
    if (typeDefault) return typeDefault;

    // 使用全域預設模板
    const globalDefault = this.templates.get("default_receipt");
    if (globalDefault) return globalDefault;

    throw new PrintFormattingError(
      `No template found for country: ${country}, type: ${type}`,
    );
  }

  updateTemplate(id: string, updates: Partial<ReceiptTemplate>): void {
    const existing = this.templates.get(id);
    if (!existing) {
      throw new PrintFormattingError(`Template not found: ${id}`);
    }

    const updated = { ...existing, ...updates };
    this.validateTemplate(updated);
    this.templates.set(id, updated);
  }

  removeTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  listTemplates(): Array<{ id: string; template: ReceiptTemplate }> {
    return Array.from(this.templates.entries()).map(([id, template]) => ({
      id,
      template,
    }));
  }

  // =============================================
  // 地區管理
  // =============================================

  addRegion(country: CountryCode, config: RegionConfig): void {
    this.validateRegionConfig(config);
    this.regions.set(country, config);
  }

  getRegionConfig(country: CountryCode): RegionConfig {
    const region = this.regions.get(country);
    if (!region) {
      throw new PrintFormattingError(
        `Region configuration not found for country: ${country}`,
      );
    }
    return region;
  }

  updateRegion(country: CountryCode, updates: Partial<RegionConfig>): void {
    const existing = this.regions.get(country);
    if (!existing) {
      throw new PrintFormattingError(`Region not found: ${country}`);
    }

    const updated = { ...existing, ...updates };
    this.validateRegionConfig(updated);
    this.regions.set(country, updated);
  }

  getSupportedRegions(): CountryCode[] {
    return Array.from(this.regions.keys());
  }

  // =============================================
  // 格式化預覽
  // =============================================

  async previewReceipt(
    request: PrintRequest,
    options?: {
      templateId?: string;
      sampleData?: boolean;
    },
  ): Promise<{
    content: PrintContent;
    preview: string;
    metadata: {
      templateUsed: string;
      region: CountryCode;
      estimatedLines: number;
      estimatedWidth: number;
    };
  }> {
    // 如果需要示例資料，生成預覽資料
    if (options?.sampleData) {
      request = this.generateSampleRequest(request.country, request.type);
    }

    // 如果指定了模板，暫時替換
    let originalTemplate: ReceiptTemplate | undefined;
    if (options?.templateId) {
      const template = this.templates.get(options.templateId);
      if (template) {
        const tempId = `${request.country}_${request.type}`;
        originalTemplate = this.templates.get(tempId);
        this.templates.set(tempId, template);
      }
    }

    try {
      const content = await this.formatReceipt(request);
      const preview = this.generateTextPreview(content);
      const region = this.getRegionConfig(request.country);

      return {
        content,
        preview,
        metadata: {
          templateUsed:
            options?.templateId || `${request.country}_${request.type}`,
          region: request.country,
          estimatedLines: this.countPreviewLines(preview),
          estimatedWidth: region.receipt.width,
        },
      };
    } finally {
      // 恢復原始模板
      if (originalTemplate && options?.templateId) {
        const tempId = `${request.country}_${request.type}`;
        this.templates.set(tempId, originalTemplate);
      }
    }
  }

  // =============================================
  // 驗證方法
  // =============================================

  private validatePrintRequest(request: PrintRequest): void {
    if (!request.country) {
      throw new PrintFormattingError("Country is required");
    }

    if (!request.type) {
      throw new PrintFormattingError("Print type is required");
    }

    if (!request.data) {
      throw new PrintFormattingError("Print data is required");
    }

    if (!request.data.order) {
      throw new PrintFormattingError("Order data is required");
    }

    // 驗證訂單數據結構
    const { order } = request.data;
    if (!order.id) {
      throw new PrintFormattingError("Order ID is required");
    }

    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new PrintFormattingError("Order items are required");
    }

    if (typeof order.total !== "number" || order.total < 0) {
      throw new PrintFormattingError("Valid order total is required");
    }
  }

  private validatePrintContent(content: PrintContent): void {
    if (!content.header || !content.header.restaurantInfo) {
      throw new PrintFormattingError("Header restaurant info is required");
    }

    if (!Array.isArray(content.items)) {
      throw new PrintFormattingError("Items array is required");
    }

    if (!content.summary || typeof content.summary.total !== "number") {
      throw new PrintFormattingError("Summary with total is required");
    }
  }

  private validateTemplate(template: ReceiptTemplate): void {
    if (!template.id || !template.name) {
      throw new PrintFormattingError("Template ID and name are required");
    }

    if (!template.country || !template.type) {
      throw new PrintFormattingError("Template country and type are required");
    }

    if (!template.layout) {
      throw new PrintFormattingError("Template layout is required");
    }

    // 驗證布局結構
    const requiredSections: (keyof TemplateLayout)[] = [
      "header",
      "items",
      "summary",
      "footer",
    ];
    for (const section of requiredSections) {
      if (!template.layout[section]) {
        throw new PrintFormattingError(
          `Template layout missing section: ${String(section)}`,
        );
      }
    }
  }

  private validateRegionConfig(config: RegionConfig): void {
    if (!config.country || !config.currency || !config.locale) {
      throw new PrintFormattingError("Region config missing required fields");
    }

    if (!config.numberFormat || !config.tax || !config.receipt) {
      throw new PrintFormattingError(
        "Region config missing formatting sections",
      );
    }
  }

  // =============================================
  // 工具方法
  // =============================================

  private generateSampleRequest(
    country: CountryCode,
    type: PrintJobType,
  ): PrintRequest {
    return {
      country,
      type,
      restaurantId: "1",
      data: {
        order: {
          id: "TEST-" + Date.now(),
          items: [
            {
              name: "Test Item 1",
              quantity: 2,
              price: 10.0,
              modifiers: [],
            },
            {
              name: "Test Item 2",
              quantity: 1,
              price: 15.5,
              modifiers: [{ name: "Extra Sauce", price: 2.0 }],
            },
          ],
          subtotal: 37.5,
          tax: 1.88,
          total: 39.38,
          tableNumber: "T01",
          createdAt: new Date(),
        },
        customer: {
          name: "Test Customer",
          phone: "123-456-7890",
        },
        payment: {
          method: "cash",
          amount: 40.0,
          change: 0.62,
          transactionId: "TXN-" + Date.now(),
        },
      },
    };
  }

  private generateTextPreview(content: PrintContent): string {
    const lines: string[] = [];
    const width = 32; // 預設寬度

    // Header
    if (content.header.restaurantInfo.name) {
      lines.push(this.centerText(content.header.restaurantInfo.name, width));
    }
    if (content.header.restaurantInfo.address) {
      lines.push(this.centerText(content.header.restaurantInfo.address, width));
    }
    lines.push("-".repeat(width));

    // Transaction info
    if (content.header.transactionInfo) {
      const { transactionInfo } = content.header;
      if (transactionInfo.receiptNumber) {
        lines.push(`Receipt: ${transactionInfo.receiptNumber}`);
      }
      if (transactionInfo.timestamp) {
        lines.push(
          `Date: ${new Date(transactionInfo.timestamp).toLocaleString()}`,
        );
      }
    }
    lines.push("-".repeat(width));

    // Items
    for (const item of content.items) {
      const itemLine = `${item.quantity}x ${item.name}`;
      lines.push(itemLine.substring(0, width));

      if (item.modifiers && item.modifiers.length > 0) {
        for (const mod of item.modifiers) {
          lines.push(`  + ${mod.name}`);
        }
      }

      const priceLine = this.rightAlign(
        formatCurrencyAmount(item.totalPrice, content.summary.currency),
        width,
      );
      lines.push(priceLine);
    }
    lines.push("-".repeat(width));

    // Summary
    const money = (amount: number) =>
      formatCurrencyAmount(amount, content.summary.currency);
    lines.push(
      this.formatSummaryLine(
        "Subtotal",
        money(content.summary.subtotal),
        width,
      ),
    );

    for (const tax of content.summary.tax) {
      lines.push(this.formatSummaryLine(tax.name, money(tax.amount), width));
    }

    lines.push("=".repeat(width));
    lines.push(
      this.formatSummaryLine(
        "TOTAL",
        money(content.summary.total),
        width,
        true,
      ),
    );

    // 現金進位調整（#405）：為 0 或未帶時不印，收據維持原樣。
    const roundingAdjustment = content.summary.roundingAdjustment ?? 0;
    if (roundingAdjustment !== 0) {
      lines.push(
        this.formatSummaryLine(
          "Rounding Adj",
          `${roundingAdjustment > 0 ? "+" : "-"}${money(Math.abs(roundingAdjustment))}`,
          width,
        ),
      );
      lines.push(
        this.formatSummaryLine(
          "AMOUNT DUE",
          money(
            content.summary.amountDue ??
              content.summary.total + roundingAdjustment,
          ),
          width,
          true,
        ),
      );
    }

    // Footer
    if (content.footer.thankYouMessage) {
      lines.push("");
      lines.push(this.centerText(content.footer.thankYouMessage, width));
    }

    return lines.join("\n");
  }

  private centerText(text: string, width: number): string {
    if (text.length >= width) return text.substring(0, width);
    const padding = Math.floor((width - text.length) / 2);
    return " ".repeat(padding) + text;
  }

  private rightAlign(text: string, width: number): string {
    if (text.length >= width) return text.substring(0, width);
    return " ".repeat(width - text.length) + text;
  }

  private formatSummaryLine(
    label: string,
    amountStr: string,
    width: number,
    bold = false,
  ): string {
    const maxLabelLength = width - amountStr.length - 1;
    const truncatedLabel = label.substring(0, maxLabelLength);
    const padding = width - truncatedLabel.length - amountStr.length;

    const line = truncatedLabel + " ".repeat(padding) + amountStr;
    return bold ? line.toUpperCase() : line;
  }

  private countPreviewLines(preview: string): number {
    return preview.split("\n").length;
  }

  // =============================================
  // 初始化
  // =============================================

  private initializeDefaultConfigs(): void {
    // 加載預設地區配置
    for (const [country, config] of Object.entries(REGION_CONFIGS)) {
      this.regions.set(country as CountryCode, config);
    }

    // 加載預設模板
    this.loadDefaultTemplates();
  }

  private loadDefaultTemplates(): void {
    // 基本收據模板
    const defaultReceiptTemplate: ReceiptTemplate = {
      id: "default_receipt",
      name: "Default Receipt",
      description: "Standard receipt template",
      country: "TW",
      type: "receipt",
      layout: {
        header: {
          show: true,
          order: 1,
          spacing: 2,
          alignment: "center",
          fields: ["logo", "restaurant", "transaction"],
        },
        items: {
          show: true,
          order: 2,
          spacing: 1,
          alignment: "left",
          fields: ["items", "modifiers"],
        },
        summary: {
          show: true,
          order: 3,
          spacing: 2,
          alignment: "right",
          fields: ["subtotal", "tax", "total"],
        },
        footer: {
          show: true,
          order: 4,
          spacing: 2,
          alignment: "center",
          fields: ["thanks", "qr", "contact"],
        },
      },
      styles: {
        fonts: {
          normal: {
            size: "normal",
            bold: false,
            underline: false,
            doubleHeight: false,
            doubleWidth: false,
          },
          bold: {
            size: "normal",
            bold: true,
            underline: false,
            doubleHeight: false,
            doubleWidth: false,
          },
          large: {
            size: "large",
            bold: false,
            underline: false,
            doubleHeight: false,
            doubleWidth: false,
          },
          title: {
            size: "large",
            bold: true,
            underline: false,
            doubleHeight: true,
            doubleWidth: true,
          },
        },
        spacing: { line: 1, section: 2, item: 1 },
        borders: { style: "dashed", sections: ["header", "summary"] },
      },
    };

    this.templates.set("default_receipt", defaultReceiptTemplate);

    // 為每個支援的地區創建專用模板
    for (const country of this.getSupportedRegions()) {
      const countryTemplate = {
        ...defaultReceiptTemplate,
        id: `${country}_receipt`,
        name: `${country.toUpperCase()} Receipt`,
        country,
      };
      this.templates.set(`${country}_receipt`, countryTemplate);
    }
  }
}
