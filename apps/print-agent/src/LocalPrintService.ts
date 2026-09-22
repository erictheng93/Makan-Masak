/**
 * 本地打印代理服務
 * 在餐廳本地運行，連接雲端系統與打印機硬體
 */

import express from "express";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import cors from "cors";
import { PrintAgentService } from "./services/PrintAgentService";
import { validateConfig } from "./config/validation";
import { PrinterDriverFactory } from "@makanmasak/queue-core/print";
import type {
  PrintJob,
  PrintRequest,
  PrintResponse,
  PrinterEvent,
} from "@makanmasak/shared-types";

type WebSocketClientInfo = {
  origin: string;
  secure: boolean;
  req: IncomingMessage;
};

type WebSocketMessage =
  | { type: "ping" }
  | { type: "subscribe" }
  | { type: string };

const isWebSocketMessage = (value: unknown): value is WebSocketMessage => {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
};

const LOOPBACK_HOST = "127.0.0.1";

/**
 * The most receipts one drain will claim.
 *
 * Bounds the failure mode where the cloud keeps handing back a receipt it
 * never marks done — an acknowledgement that does not land, say — which would
 * otherwise pin the agent in a print loop that never returns to the heartbeat
 * and never observes stop(). At the second or two a receipt actually takes,
 * 20 still clears a realistic dinner-rush backlog inside one heartbeat
 * interval, and anything past it is only deferred to the next heartbeat.
 */
export const MAX_CLOUD_JOBS_PER_DRAIN = 20;

/**
 * How long the agent watches the local queue before it stops waiting for the
 * physical printer. The cloud's reclaim of an abandoned claim is written
 * against this number, so the two have to stay in step.
 */
export const PRINT_COMPLETION_TIMEOUT_MS = 30_000;

/**
 * How many times one pending acknowledgement may be rejected before the agent
 * gives up on it. 404 does not count: that is the cloud saying the receipt has
 * already left `printing`, which is a success from here.
 *
 * At the default 60s heartbeat this is roughly ten minutes of trying, well
 * past a transient outage, and it exists because the drain blocks all new
 * claims until the head of the queue clears.
 */
export const MAX_ACKNOWLEDGEMENT_ATTEMPTS = 10;

/**
 * What the agent tells the cloud about a receipt it claimed.
 *
 * `indeterminate` is not a third flavour of failure — it is the absence of an
 * observation. The cloud re-queues a `failed` receipt so a jam recovers on its
 * own, which makes `failed` a claim that nothing reached paper. Reporting it
 * for a job we merely stopped watching would print that receipt twice.
 */
type CloudAcknowledgement = {
  status: "printed" | "failed" | "indeterminate";
  printerName?: string;
  response?: string;
};

type PendingCloudAcknowledgement = {
  receiptId: string;
  acknowledgement: CloudAcknowledgement;
  /**
   * Failed deliveries so far. Absent in stores written before the cap existed,
   * and read as 0 — an upgrade must not judge its own queue invalid, because
   * that path now quarantines the file and reprints those receipts.
   */
  attempts?: number;
};

const isCloudAcknowledgement = (
  value: unknown,
): value is CloudAcknowledgement => {
  if (typeof value !== "object" || value === null) return false;
  const acknowledgement = value as Record<string, unknown>;
  return (
    (acknowledgement.status === "printed" ||
      acknowledgement.status === "failed" ||
      acknowledgement.status === "indeterminate") &&
    (acknowledgement.printerName === undefined ||
      typeof acknowledgement.printerName === "string") &&
    (acknowledgement.response === undefined ||
      typeof acknowledgement.response === "string")
  );
};

const isPendingCloudAcknowledgement = (
  value: unknown,
): value is PendingCloudAcknowledgement => {
  if (typeof value !== "object" || value === null) return false;
  const pending = value as Record<string, unknown>;
  return (
    typeof pending.receiptId === "string" &&
    isCloudAcknowledgement(pending.acknowledgement) &&
    (pending.attempts === undefined ||
      (typeof pending.attempts === "number" &&
        Number.isInteger(pending.attempts) &&
        pending.attempts >= 0))
  );
};

export interface LocalPrintServiceConfig {
  // 網路設定
  port: number;
  wsPort: number;
  allowedOrigins: string[];

  // 認證設定
  apiKey: string; // 本機 HTTP/WS：POS 前端 -> 代理
  cloudKey?: string; // 雲端派工：代理 -> 雲端，由後台核發並綁定收銀機
  cloudEndpoint: string;
  acknowledgementStorePath?: string;

  // 服務設定
  serviceName: string;
  restaurantId: string;

  // 打印機設定
  autoDiscovery: boolean;
  discoveryInterval: number; // ms
  heartbeatInterval: number; // ms

  // 佇列設定
  maxQueueSize: number;
  maxRetries: number;
  retryDelay: number;
}

export class LocalPrintService {
  private config: LocalPrintServiceConfig;
  private printAgentService: PrintAgentService;
  private driverFactory: PrinterDriverFactory;
  private expressApp!: express.Application;
  private httpServer?: Server;
  private wsServer?: WebSocketServer;
  private connectedClients: Set<WebSocket> = new Set();
  private isRunning = false;
  private discoveryTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private cloudPollInFlight = false;

  constructor(config: LocalPrintServiceConfig) {
    this.config = config;
    this.printAgentService = new PrintAgentService(config);
    this.driverFactory = new PrinterDriverFactory({
      connectionTimeout: 10000,
      commandTimeout: 5000,
      retryAttempts: 3,
      enableAutoDetection: config.autoDiscovery,
    });

    this.setupExpressApp();
    this.setupEventHandlers();
  }

  // =============================================
  // 服務生命週期
  // =============================================

  async start(): Promise<void> {
    try {
      console.log(
        `🖨️  Starting Local Print Service for Restaurant ${this.config.restaurantId}`,
      );

      const validation = validateConfig(this.config);
      if (!validation.success) {
        throw new Error(
          `Invalid print agent configuration: ${validation.errors.join("; ")}`,
        );
      }

      // 初始化打印代理服務（避免延遲初始化導致健康檢查誤報）
      // 初始化失敗時降級運行 — HTTP 伺服器仍然啟動，健康檢查會回報 unhealthy
      try {
        await this.printAgentService.initialize();
      } catch (error) {
        console.error(
          "⚠️  Print Agent Service initialization failed; starting in degraded mode:",
          error,
        );
      }

      // 啟動 HTTP 伺服器
      await this.startHttpServer();

      // 啟動 WebSocket 伺服器
      await this.startWebSocketServer();

      // 初始化打印機發現
      if (this.config.autoDiscovery) {
        await this.startPrinterDiscovery();
      }

      // 啟動心跳
      this.startHeartbeat();

      this.isRunning = true;
      console.log(`✅ Local Print Service started successfully`);
      console.log(`📡 HTTP API: http://localhost:${this.config.port}`);
      console.log(`🔗 WebSocket: ws://localhost:${this.config.wsPort}`);

      // 先拉一次雲端待印工作，不必等第一次心跳。失敗刻意不往外丟：index.ts
      // 對 start() 失敗的處理是 process.exit(1)，而店內的本機列印（HTTP/WS）
      // 不該因為對外連線斷掉、金鑰沒設或雲端回非 2xx 就整個停擺。
      await this.registerWithCloud().catch((error) => {
        console.error(
          "⚠️  Initial cloud job poll failed; continuing with local printing:",
          error,
        );
      });
    } catch (error) {
      await this.stopNetworkServers();
      console.error("❌ Failed to start Local Print Service:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log("🛑 Stopping Local Print Service...");

    this.isRunning = false;

    // 停止定時器
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    // 關閉 WebSocket 連線
    this.connectedClients.forEach((ws) => ws.close());

    // 關閉打印代理服務（清除作業佇列定時器等）
    try {
      await this.printAgentService.shutdown();
    } catch (error) {
      console.error("⚠️  Print Agent Service shutdown error:", error);
    }

    await this.stopNetworkServers();

    console.log("✅ Local Print Service stopped");
  }

  // =============================================
  // HTTP API 設定
  // =============================================

  private setupExpressApp(): void {
    this.expressApp = express();

    // 中間件
    this.expressApp.use(
      cors({
        origin: this.config.allowedOrigins,
        credentials: true,
      }),
    );
    this.expressApp.use(express.json({ limit: "10mb" }));
    this.expressApp.use(this.authenticateRequest.bind(this));

    // API 路由
    this.setupApiRoutes();

    // 錯誤處理
    this.expressApp.use(this.errorHandler.bind(this));
  }

  /**
   * 將 PrintResponse 結果對應到 HTTP 狀態碼：
   * - 成功 → 200
   * - VALIDATION_ERROR（請求格式錯誤）→ 400
   * - NO_PRINTER_AVAILABLE（無可用打印機）→ 503
   * - 其他錯誤（內部失敗）→ 500
   */
  private httpStatusForPrintResult(result: PrintResponse): number {
    if (result.success) {
      return 200;
    }

    switch (result.error?.code) {
      case "VALIDATION_ERROR":
        return 400;
      case "NO_PRINTER_AVAILABLE":
        return 503;
      default:
        return 500;
    }
  }

  private setupApiRoutes(): void {
    const router = express.Router();

    // =============================================
    // 打印作業管理
    // =============================================

    // 創建打印作業
    router.post("/print", async (req, res) => {
      try {
        const printRequest: PrintRequest = req.body;
        const result =
          await this.printAgentService.createPrintJob(printRequest);
        res.status(this.httpStatusForPrintResult(result)).json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "PRINT_FAILED",
            message: `Print job creation failed: ${error}`,
          },
        });
      }
    });

    // 查詢作業狀態
    router.get("/print/:jobId", async (req, res) => {
      try {
        const { jobId } = req.params;
        const job = await this.printAgentService.getJobStatus(jobId);

        if (job) {
          res.json({
            success: true,
            data: job,
          });
        } else {
          res.status(404).json({
            success: false,
            error: {
              code: "JOB_NOT_FOUND",
              message: "Print job not found",
            },
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "STATUS_CHECK_FAILED",
            message: `Status check failed: ${error}`,
          },
        });
      }
    });

    // 取消作業
    router.delete("/print/:jobId", async (req, res) => {
      try {
        const { jobId } = req.params;
        const cancelled = await this.printAgentService.cancelJob(jobId);

        if (cancelled) {
          res.json({
            success: true,
            message: "Job cancelled",
          });
        } else {
          res.status(404).json({
            success: false,
            error: {
              code: "JOB_NOT_FOUND",
              message: "Job not found or cannot be cancelled",
            },
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "CANCEL_FAILED",
            message: `Job cancellation failed: ${error}`,
          },
        });
      }
    });

    // =============================================
    // 設備管理
    // =============================================

    // 獲取所有設備
    router.get("/devices", async (req, res) => {
      try {
        const devices = this.printAgentService.getDevices();
        res.json({
          success: true,
          data: devices,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "DEVICE_LIST_FAILED",
            message: `Failed to get devices: ${error}`,
          },
        });
      }
    });

    // 獲取特定設備
    router.get("/devices/:deviceId", async (req, res) => {
      try {
        const { deviceId } = req.params;
        const device = this.printAgentService.getDevice(deviceId);

        if (device) {
          res.json({
            success: true,
            data: device,
          });
        } else {
          res.status(404).json({
            success: false,
            error: {
              code: "DEVICE_NOT_FOUND",
              message: "Device not found",
            },
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "DEVICE_GET_FAILED",
            message: `Failed to get device: ${error}`,
          },
        });
      }
    });

    // 手動添加設備
    router.post("/devices", async (req, res) => {
      try {
        const { connectionType, address, brand: _brand } = req.body;

        // 檢測設備
        const device = await this.driverFactory.detectPrinter({
          type: connectionType,
          address: address,
        });

        if (device) {
          // 註冊打印機
          const registered =
            await this.printAgentService.registerPrinter(device);

          if (!registered) {
            res.status(500).json({
              success: false,
              error: {
                code: "DEVICE_REGISTER_FAILED",
                message: "Detected printer but failed to register it",
              },
            });
            return;
          }

          res.json({
            success: true,
            data: device,
            message: "Device added successfully",
          });
        } else {
          res.status(400).json({
            success: false,
            error: {
              code: "DEVICE_NOT_DETECTED",
              message: "Could not detect printer at specified address",
            },
          });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "DEVICE_ADD_FAILED",
            message: `Failed to add device: ${error}`,
          },
        });
      }
    });

    // 移除設備
    router.delete("/devices/:deviceId", async (req, res) => {
      try {
        const { deviceId } = req.params;
        await this.printAgentService.unregisterPrinter(deviceId);

        res.json({
          success: true,
          message: "Device removed successfully",
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "DEVICE_REMOVE_FAILED",
            message: `Failed to remove device: ${error}`,
          },
        });
      }
    });

    // 測試設備
    router.post("/devices/:deviceId/test", async (req, res) => {
      try {
        const { deviceId } = req.params;
        const device = this.printAgentService.getDevice(deviceId);

        if (!device) {
          res.status(404).json({
            success: false,
            error: {
              code: "DEVICE_NOT_FOUND",
              message: "Device not found",
            },
          });
          return;
        }

        // 創建測試打印作業
        const testRequest: PrintRequest = {
          restaurantId: this.config.restaurantId,
          country: "TW",
          type: "order",
          deviceId,
          data: {
            order: {
              id: "TEST_ORDER",
              items: [
                {
                  name: "Test Item",
                  quantity: 1,
                  price: 0,
                },
              ],
              subtotal: 0,
              tax: 0,
              total: 0,
              createdAt: new Date(),
            },
          },
        };

        const result = await this.printAgentService.createPrintJob(testRequest);
        res.status(this.httpStatusForPrintResult(result)).json(result);
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "TEST_FAILED",
            message: `Device test failed: ${error}`,
          },
        });
      }
    });

    // =============================================
    // 系統管理
    // =============================================

    // 健康檢查
    router.get("/health", async (req, res) => {
      try {
        const health = await this.printAgentService.healthCheck();
        // degraded 仍然回 200（服務可用，硬體缺席）；unhealthy 回 503
        res.status(health.status === "unhealthy" ? 503 : 200).json({
          success: true,
          data: {
            ...health,
            service: "running",
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: "2.0.0",
          },
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "HEALTH_CHECK_FAILED",
            message: `Health check failed: ${error}`,
          },
        });
      }
    });

    // 統計資訊
    router.get("/statistics", async (req, res) => {
      try {
        const stats = this.printAgentService.getStatistics();
        res.json({
          success: true,
          data: stats,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "STATS_FAILED",
            message: `Failed to get statistics: ${error}`,
          },
        });
      }
    });

    // 設備發現
    router.post("/discover", async (req, res) => {
      try {
        const { connectionTypes } = req.body || {
          connectionTypes: ["usb", "network"],
        };
        const devices =
          await this.driverFactory.scanForPrinters(connectionTypes);

        res.json({
          success: true,
          data: devices,
          message: `Found ${devices.length} printer(s)`,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: {
            code: "DISCOVERY_FAILED",
            message: `Device discovery failed: ${error}`,
          },
        });
      }
    });

    this.expressApp.use("/api/v1", router);
  }

  // =============================================
  // WebSocket 設定
  // =============================================

  private setupWebSocket(): void {
    if (this.wsServer) {
      return;
    }

    this.wsServer = new WebSocketServer({
      host: LOOPBACK_HOST,
      port: this.config.wsPort,
      verifyClient: (info: WebSocketClientInfo) => {
        // 驗證 WebSocket 連線
        return this.verifyWebSocketClient(info);
      },
    });

    this.wsServer.on("connection", (ws, _request) => {
      console.log("📡 WebSocket client connected");

      this.connectedClients.add(ws);

      // 發送歡迎訊息
      ws.send(
        JSON.stringify({
          type: "welcome",
          data: {
            service: this.config.serviceName,
            restaurantId: this.config.restaurantId,
            timestamp: new Date().toISOString(),
          },
        }),
      );

      // 處理客戶端訊息
      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.error("Invalid WebSocket message:", error);
        }
      });

      // 處理連線關閉
      ws.on("close", () => {
        console.log("📡 WebSocket client disconnected");
        this.connectedClients.delete(ws);
      });

      // 處理錯誤
      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.connectedClients.delete(ws);
      });
    });
  }

  private verifyWebSocketClient(info: WebSocketClientInfo): boolean {
    // 實作 WebSocket 客戶端驗證邏輯
    // 可以檢查 API key、來源等
    const headerValue = info.req.headers["x-api-key"];
    const apiKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    return apiKey === this.config.apiKey;
  }

  private handleWebSocketMessage(ws: WebSocket, message: unknown): void {
    if (!isWebSocketMessage(message)) {
      ws.send(
        JSON.stringify({
          type: "error",
          error: "Invalid message format",
        }),
      );
      return;
    }

    switch (message.type) {
      case "ping":
        ws.send(
          JSON.stringify({
            type: "pong",
            timestamp: new Date().toISOString(),
          }),
        );
        break;

      case "subscribe":
        // 訂閱特定事件類型
        // 實作事件訂閱邏輯
        break;

      default:
        console.warn("Unknown WebSocket message type:", message.type);
    }
  }

  // =============================================
  // 事件處理
  // =============================================

  private setupEventHandlers(): void {
    // 監聽打印機事件
    this.printAgentService.on("device_connected", (data: unknown) => {
      this.broadcastEvent({
        type: "device_connected",
        timestamp: new Date(),
        data,
      });
    });

    this.printAgentService.on("device_disconnected", (data: unknown) => {
      this.broadcastEvent({
        type: "device_disconnected",
        timestamp: new Date(),
        data,
      });
    });

    this.printAgentService.on("job_completed", (data: unknown) => {
      this.broadcastEvent({
        type: "job_completed",
        timestamp: new Date(),
        data,
      });
    });

    this.printAgentService.on("job_failed", (data: unknown) => {
      this.broadcastEvent({
        type: "job_failed",
        timestamp: new Date(),
        data,
      });
    });
  }

  private broadcastEvent(event: PrinterEvent): void {
    const message = JSON.stringify({
      type: "event",
      event,
    });

    this.connectedClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  // =============================================
  // 私有方法
  // =============================================

  private async startHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.expressApp.listen(
        this.config.port,
        LOOPBACK_HOST,
        () => {
          resolve();
        },
      );

      this.httpServer = server;
      server.on("error", reject);
    });
  }

  private async startWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setupWebSocket();

      const server = this.wsServer;
      if (!server) {
        reject(new Error("WebSocket server was not initialized"));
        return;
      }

      const handleListening = () => {
        server.off("error", handleError);
        resolve();
      };
      const handleError = (error: Error) => {
        server.off("listening", handleListening);
        reject(error);
      };

      if (server.address()) {
        resolve();
        return;
      }

      server.once("listening", handleListening);
      server.once("error", handleError);
    });
  }

  private async stopNetworkServers(): Promise<void> {
    const closeWebSocketServer = this.wsServer
      ? new Promise<void>((resolve, reject) => {
          this.wsServer!.close((error?: Error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        })
      : Promise.resolve();

    const closeHttpServer =
      this.httpServer && typeof this.httpServer.close === "function"
        ? new Promise<void>((resolve, reject) => {
            this.httpServer!.close((error?: Error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          })
        : Promise.resolve();

    await Promise.all([closeWebSocketServer, closeHttpServer]);
    this.wsServer = undefined;
    this.httpServer = undefined;
    this.connectedClients.clear();
  }

  private async startPrinterDiscovery(): Promise<void> {
    // 立即執行一次發現
    await this.discoverPrinters();

    // 設定定期發現
    this.discoveryTimer = setInterval(async () => {
      await this.discoverPrinters();
    }, this.config.discoveryInterval);
  }

  private async discoverPrinters(): Promise<void> {
    try {
      console.log("🔍 Discovering printers...");
      const devices = await this.driverFactory.scanForPrinters([
        "usb",
        "network",
      ]);

      for (const device of devices) {
        // 檢查是否已經註冊
        const existing = this.printAgentService.getDevice(device.id);
        if (!existing) {
          try {
            await this.printAgentService.registerPrinter(device);
            console.log(`✅ Registered new printer: ${device.name}`);
          } catch (error) {
            console.error(
              `❌ Failed to register printer ${device.name}:`,
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error("Printer discovery failed:", error);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.sendHeartbeat();
      } catch (error) {
        console.error("Heartbeat failed:", error);
      }
    }, this.config.heartbeatInterval);
  }

  private async sendHeartbeat(): Promise<void> {
    await this.pollCloudJobs();
  }

  private async registerWithCloud(): Promise<void> {
    await this.pollCloudJobs();
  }

  private async pollCloudJobs(): Promise<void> {
    // 沒有雲端憑證就只當本機列印伺服器 —— 這是合法的設定，不是錯誤。
    const cloudKey = this.config.cloudKey;
    if (!cloudKey) return;
    // The guard spans the whole drain, not a single claim: a heartbeat that
    // fires while we are still working through the backlog would otherwise
    // start a second drain and have both claim the same receipts.
    if (this.cloudPollInFlight) return;
    this.cloudPollInFlight = true;
    try {
      if (!(await this.drainPendingAcknowledgements(cloudKey))) return;
      // The cloud hands back at most one receipt per call, so claiming once
      // per heartbeat printed a dinner-rush backlog at one receipt a minute.
      // Keep claiming until the queue is empty instead.
      let claimed = 0;
      while (claimed < MAX_CLOUD_JOBS_PER_DRAIN) {
        // A throw propagates out of the drain on purpose: an unreachable or
        // erroring cloud must cost one call per heartbeat, not a tight loop
        // of MAX_CLOUD_JOBS_PER_DRAIN of them.
        const outcome = await this.claimAndPrintOneJob(cloudKey);
        if (outcome !== "printed") return;
        claimed += 1;
      }
      console.warn(
        `⚠️  Cloud job drain stopped at its ${MAX_CLOUD_JOBS_PER_DRAIN}-receipt bound; the rest wait for the next heartbeat`,
      );
    } finally {
      this.cloudPollInFlight = false;
    }
  }

  /**
   * Claims and prints at most one receipt.
   *
   * "empty" and "failed" both end the drain, and "failed" covers every
   * outcome that is not a confirmed print — an indeterminate one included.
   * Stopping on a failure matters now that the cloud re-queues a failed
   * receipt instead of settling it: the drain would otherwise re-claim that
   * same receipt immediately, fail again, and burn its whole delivery budget
   * in seconds — and then do the same to every other receipt in the queue.
   * Whatever just broke the printer is almost certainly still broken for the
   * next receipt, so the useful move is to leave the backlog alone and try
   * again on the next heartbeat. That is also what makes the cloud's "no
   * backoff, paced by the poll cadence" assumption true. A printer we waited
   * 30s on and still could not read is wedged in the same way, so it stops the
   * drain too, even though the cloud settles that one terminally.
   *
   * The cost is a receipt the printer chokes on specifically: it stalls the
   * queue behind it for as many heartbeats as its budget allows, then settles
   * to failed and the queue moves on. A real outage is far more common than a
   * poison receipt, and this recovers from it without human help.
   */
  private async claimAndPrintOneJob(
    cloudKey: string,
  ): Promise<"empty" | "printed" | "failed"> {
    // Neither the register nor the restaurant is sent: the cloud derives
    // both from the credential. An agent that could name its own tenant
    // could claim another shop's receipts.
    //
    // Never claim work that this agent cannot send to a physical printer. A
    // claim moves a receipt to `printing` and spends one delivery attempt, so
    // learning after the GET that every device is offline is already too late.
    // Pending acknowledgements are drained before this method runs, so this
    // guard cannot strand the outcome of a receipt claimed while hardware was
    // still online.
    const devices = await this.printerCounts();
    if (!devices || devices.online < 1) return "empty";

    // Printer counts ride along on every claim rather than a second heartbeat.
    const url = new URL("print/jobs", `${this.config.cloudEndpoint}/`);
    url.searchParams.set("printersTotal", String(devices.total));
    url.searchParams.set("printersOnline", String(devices.online));

    const response = await fetch(url, {
      headers: { "X-Print-Agent-Key": cloudKey },
    });
    if (!response.ok)
      throw new Error(`Cloud job poll failed (${response.status})`);
    const payload = (await response.json()) as {
      data: { receiptId: string; request: PrintRequest } | null;
    };
    if (!payload.data) return "empty";

    const request = payload.data.request;
    request.data.order.createdAt = new Date(request.data.order.createdAt);
    const result = await this.printAgentService.createPrintJob(request);
    const acknowledgement =
      result.success && result.jobId
        ? await this.waitForPrintCompletion(result.jobId)
        : { status: "failed" as const, response: result.error?.message };
    const pending = { receiptId: payload.data.receiptId, acknowledgement };
    try {
      await this.persistPendingAcknowledgement(pending);
    } catch (error) {
      // The store is the only thing between a lost acknowledgement and a
      // reprint, so a store we cannot write puts this receipt back where it
      // was before it existed. Spend the one network attempt still available
      // rather than dropping the acknowledgement on the floor.
      console.error(
        "Could not persist a pending acknowledgement; sending it inline instead:",
        error,
      );
      try {
        await this.acknowledgeCloudJob(cloudKey, pending);
      } catch (acknowledgeError) {
        console.error(
          "Inline acknowledgement also failed; the cloud will re-issue this receipt and it will print again:",
          acknowledgeError,
        );
      }
      // Stop the drain either way. A store that cannot be written cannot
      // protect the next receipt either, and this is the fault that has to
      // reach a human — claiming more work would only bury it.
      throw error;
    }
    return (await this.drainPendingAcknowledgements(cloudKey)) &&
      acknowledgement.status === "printed"
      ? "printed"
      : "failed";
  }

  /**
   * Current printer count. A failed health probe returns null, which is a
   * safety stop for claiming work: unknown hardware availability must not be
   * treated as a working printer.
   */
  private async printerCounts(): Promise<{
    total: number;
    online: number;
  } | null> {
    try {
      const health = await this.printAgentService.healthCheck();
      return { total: health.devices.total, online: health.devices.online };
    } catch (error) {
      console.error("Printer health probe failed:", error);
      return null;
    }
  }

  /**
   * The acknowledgement for a job the local queue has finished with, or null
   * while it is still pending/printing and nothing can honestly be reported.
   */
  private settledAcknowledgement(
    job: PrintJob | null,
  ): CloudAcknowledgement | null {
    if (job?.status === "completed") {
      return { status: "printed", printerName: job.deviceId };
    }
    if (job?.status === "failed" || job?.status === "cancelled") {
      return {
        status: "failed",
        printerName: job.deviceId,
        response: job.error?.message,
      };
    }
    return null;
  }

  private async waitForPrintCompletion(
    jobId: string,
  ): Promise<CloudAcknowledgement> {
    const deadline = Date.now() + PRINT_COMPLETION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const settled = this.settledAcknowledgement(
        await this.printAgentService.getJobStatus(jobId),
      );
      if (settled) return settled;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // One more read before giving up. The queue may have settled inside the
    // last poll gap, and calling a print that did happen anything other than
    // "printed" costs either a duplicate receipt or a lost one.
    const settled = this.settledAcknowledgement(
      await this.printAgentService.getJobStatus(jobId),
    );
    if (settled) return settled;

    // Still running. The local queue only cancels a job that has not been
    // handed to a printer yet, so a successful cancel proves nothing reached
    // paper and the cloud is free to re-queue it. A refused cancel means the
    // job is mid-print — it may well finish and print, on its own retries,
    // long after we stopped watching — so its outcome is simply unknown.
    const cancelled = await this.printAgentService.cancelJob(jobId);
    return cancelled
      ? {
          status: "failed",
          response:
            "Cancelled before printing after waiting for the physical printer",
        }
      : {
          status: "indeterminate",
          response: "Timed out waiting for physical printer completion",
        };
  }

  private acknowledgementStorePath(): string {
    return (
      this.config.acknowledgementStorePath ??
      join(
        homedir(),
        ".makanmasak",
        "print-agent",
        "pending-cloud-acknowledgements.json",
      )
    );
  }

  private async readPendingAcknowledgements(): Promise<
    PendingCloudAcknowledgement[]
  > {
    try {
      const parsed: unknown = JSON.parse(
        readFileSync(this.acknowledgementStorePath(), "utf8"),
      );
      if (
        !Array.isArray(parsed) ||
        !parsed.every(isPendingCloudAcknowledgement)
      ) {
        throw new Error("Pending acknowledgement store is invalid");
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      return this.quarantineAcknowledgementStore(error);
    }
  }

  /**
   * A store we cannot read must not be able to stop the agent printing.
   * Every drain begins by reading it and no claim happens until that drain
   * succeeds, so a throw here silences cloud printing for good — and reaches
   * nothing louder than the heartbeat's `console.error`. Move the file aside
   * and carry on from empty instead.
   *
   * The cost is real but bounded: the acknowledgements in that file are lost,
   * so the cloud re-issues those receipts and they print a second time. That
   * is one duplicate per stranded receipt, against a register that otherwise
   * never prints again. The quarantined copy is left on disk for whoever
   * investigates.
   */
  private quarantineAcknowledgementStore(
    cause: unknown,
  ): PendingCloudAcknowledgement[] {
    const storePath = this.acknowledgementStorePath();
    const quarantinePath = `${storePath}.corrupt-${Date.now()}`;
    try {
      renameSync(storePath, quarantinePath);
    } catch (renameError) {
      // We cannot move it aside, so the next read fails the same way and
      // carrying on from empty would just lose the acknowledgements without
      // buying the recovery. Report the original fault.
      console.error(
        "Pending acknowledgement store is unreadable and could not be quarantined:",
        renameError,
      );
      throw cause;
    }
    console.error(
      `Pending acknowledgement store quarantined to ${quarantinePath}; its acknowledgements are lost and those receipts will print again:`,
      cause,
    );
    return [];
  }

  private async writePendingAcknowledgements(
    acknowledgements: PendingCloudAcknowledgement[],
  ): Promise<void> {
    const storePath = this.acknowledgementStorePath();
    mkdirSync(dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    const file = openSync(temporaryPath, "w", 0o600);
    try {
      writeFileSync(file, JSON.stringify(acknowledgements));
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    try {
      renameSync(temporaryPath, storePath);
    } catch (error) {
      unlinkSync(temporaryPath);
      throw error;
    }
  }

  private async persistPendingAcknowledgement(
    acknowledgement: PendingCloudAcknowledgement,
  ): Promise<void> {
    const pending = await this.readPendingAcknowledgements();
    await this.writePendingAcknowledgements([
      ...pending.filter(
        (entry) => entry.receiptId !== acknowledgement.receiptId,
      ),
      acknowledgement,
    ]);
  }

  /**
   * Sends every pending acknowledgement, oldest first, and reports whether the
   * queue is now empty. A `false` stops the caller claiming new work, which is
   * what keeps an acknowledgement ahead of the cloud's five-minute re-claim.
   *
   * That same property is why one undeliverable entry cannot be allowed to sit
   * at the head forever: it would hold the whole register hostage. An entry the
   * cloud has rejected `MAX_ACKNOWLEDGEMENT_ATTEMPTS` times is dropped so the
   * rest of the queue can move. Its receipt then reprints once the cloud's
   * claim times out — the same trade the quarantine path makes, and the same
   * reason: a duplicate beats a register that never prints again.
   */
  private async drainPendingAcknowledgements(
    cloudKey: string,
  ): Promise<boolean> {
    const pending = await this.readPendingAcknowledgements();
    for (let index = 0; index < pending.length; index += 1) {
      const entry = pending[index];
      const remaining = pending.slice(index + 1);
      try {
        await this.acknowledgeCloudJob(cloudKey, entry);
      } catch (error) {
        const attempts = (entry.attempts ?? 0) + 1;
        if (attempts >= MAX_ACKNOWLEDGEMENT_ATTEMPTS) {
          console.error(
            `Cloud acknowledgement for ${entry.receiptId} abandoned after ${attempts} attempts; that receipt will be re-issued and printed again:`,
            error,
          );
          await this.writePendingAcknowledgements(remaining);
          continue;
        }
        console.error(
          `Cloud acknowledgement retry failed (attempt ${attempts}/${MAX_ACKNOWLEDGEMENT_ATTEMPTS}):`,
          error,
        );
        await this.writePendingAcknowledgements([
          { ...entry, attempts },
          ...remaining,
        ]);
        return false;
      }
      await this.writePendingAcknowledgements(remaining);
    }
    return true;
  }

  private async acknowledgeCloudJob(
    cloudKey: string,
    pending: PendingCloudAcknowledgement,
  ): Promise<void> {
    const response = await fetch(
      new URL(
        `print/jobs/${encodeURIComponent(pending.receiptId)}/ack`,
        `${this.config.cloudEndpoint}/`,
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Print-Agent-Key": cloudKey,
        },
        body: JSON.stringify(pending.acknowledgement),
      },
    );
    // The API updates only a receipt still in `printing`. A retry that races
    // with a prior successful request therefore gets 404; it is terminal and
    // safe to forget locally because the acknowledgement already settled.
    if (!response.ok && response.status !== 404)
      throw new Error(`Cloud acknowledgement failed (${response.status})`);
  }

  private authenticateRequest(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): void {
    const apiKey = req.headers["x-api-key"];

    if (apiKey !== this.config.apiKey) {
      res.status(401).json({
        success: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid API key",
        },
      });
      return;
    }

    next();
  }

  private errorHandler(
    error: unknown,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ): void {
    console.error("API Error:", error);

    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  }

  // =============================================
  // 公開介面
  // =============================================

  getConfig(): LocalPrintServiceConfig {
    return this.config;
  }

  getPrintAgentService(): PrintAgentService {
    return this.printAgentService;
  }

  getPrinterService(): PrintAgentService {
    return this.printAgentService;
  }

  isServiceRunning(): boolean {
    return this.isRunning;
  }

  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }
}
