/**
 * 打印作業管理器
 * 負責打印作業的佇列管理、調度和執行
 */

import type {
  PrintJob,
  PrintJobStatus,
  PrintJobPriority,
  PrintRequest,
  PrintContent,
  PrintServiceConfig,
} from "@makanmasak/shared-types";

import { PrintJobError } from "../errors/PrintErrors";

export type PrintJobManagerConfig = PrintServiceConfig["queue"];

/**
 * Every event this manager emits, with the payload it carries.
 *
 * Subscribers used to register `(...args: any[]) => void`, so a handler
 * reading the wrong field compiled fine and failed at runtime. Keying the
 * signatures off this map checks both ends.
 */
export type PrintJobManagerEvents = {
  job_created: { job: PrintJob };
  job_started: { job: PrintJob };
  job_completed: { job: PrintJob };
  job_cancelled: { job: PrintJob };
  job_retried: { job: PrintJob };
  job_failed: { job: PrintJob; error: string };
  job_retry_scheduled: { job: PrintJob; error: string };
  device_jobs_paused: { deviceId: string };
  device_jobs_resumed: { deviceId: string };
  jobs_cleaned_up: { removedCount: number; cutoffTime: Date };
};

export class PrintJobManager {
  private config: PrintJobManagerConfig;
  private jobs: Map<string, PrintJob> = new Map();
  private processing: Set<string> = new Set();
  private pausedDevices: Set<string> = new Set();
  private jobExecutor?: (job: PrintJob) => Promise<void>;
  private eventHandlers = new Map<
    keyof PrintJobManagerEvents,
    ((payload: never) => void)[]
  >();
  private processingInterval?: NodeJS.Timeout;
  private isInitialized = false;

  constructor(config: PrintJobManagerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 啟動作業處理器
    this.processingInterval = setInterval(() => {
      this.processNextJobs();
    }, 1000);

    this.isInitialized = true;
  }

  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    // 停止處理器
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }

    // 取消所有待處理的作業
    const pendingJobs = this.getJobsByStatus("pending");
    await Promise.all(pendingJobs.map((job) => this.cancelJob(job.id)));

    // 等待正在處理的作業完成（最多等待 30 秒）
    let waitTime = 0;
    while (this.processing.size > 0 && waitTime < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waitTime += 1000;
    }

    this.jobs.clear();
    this.processing.clear();
    this.pausedDevices.clear();
    this.eventHandlers.clear();
    this.isInitialized = false;
  }

  // =============================================
  // 作業管理
  // =============================================

  async createJob(
    request: PrintRequest & {
      deviceId: string;
      content: PrintContent;
    },
  ): Promise<PrintJob> {
    if (this.jobs.size >= this.config.maxQueueSize) {
      throw new PrintJobError("Print queue is full");
    }

    const jobId = this.generateJobId();
    const now = new Date();

    const job: PrintJob = {
      id: jobId,
      type: request.type,
      priority: request.priority || "normal",
      status: "pending",
      deviceId: request.deviceId,
      content: request.content,
      options: {
        copies: 1,
        cutPaper: true,
        openDrawer: false,
        buzzer: false,
        feedLines: 3,
        ...request.options,
      },
      attempts: 0,
      maxAttempts: this.config.maxRetries,
      createdAt: now,
      updatedAt: now,
      metadata: {
        restaurantId: request.restaurantId,
        orderId: request.data?.order?.id,
        userId: request.userId,
        country: request.country,
      },
    };

    this.jobs.set(jobId, job);
    this.emit("job_created", { job });

    return job;
  }

  getJob(jobId: string): PrintJob | null {
    return this.jobs.get(jobId) || null;
  }

  getJobsByStatus(status: PrintJobStatus): PrintJob[] {
    return Array.from(this.jobs.values())
      .filter((job) => job.status === status)
      .sort(this.priorityComparator);
  }

  getJobsByDevice(deviceId: string): PrintJob[] {
    return Array.from(this.jobs.values())
      .filter((job) => job.deviceId === deviceId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // 只能取消待處理的作業
    if (job.status !== "pending") return false;

    this.updateJob(jobId, {
      status: "cancelled",
      updatedAt: new Date(),
      cancelledAt: new Date(),
    });

    this.emit("job_cancelled", { job: this.jobs.get(jobId)! });
    return true;
  }

  async retryJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job) return false;

    // 只能重試失敗的作業
    if (job.status !== "failed") return false;

    // 檢查重試次數
    if (job.attempts >= job.maxAttempts) return false;

    this.updateJob(jobId, {
      status: "pending",
      updatedAt: new Date(),
      error: undefined,
    });

    this.emit("job_retried", { job: this.jobs.get(jobId)! });
    return true;
  }

  async pauseDeviceJobs(deviceId: string): Promise<void> {
    this.pausedDevices.add(deviceId);

    // 暫停正在處理的作業
    const processingJobs = this.getJobsByDevice(deviceId).filter(
      (job) => job.status === "printing",
    );

    for (const job of processingJobs) {
      this.updateJob(job.id, {
        status: "paused",
        updatedAt: new Date(),
      });
    }

    this.emit("device_jobs_paused", { deviceId });
  }

  async resumeDeviceJobs(deviceId: string): Promise<void> {
    this.pausedDevices.delete(deviceId);

    // 恢復暫停的作業
    const pausedJobs = this.getJobsByDevice(deviceId).filter(
      (job) => job.status === "paused",
    );

    for (const job of pausedJobs) {
      this.updateJob(job.id, {
        status: "pending",
        updatedAt: new Date(),
      });
    }

    this.emit("device_jobs_resumed", { deviceId });
  }

  async cancelDeviceJobs(deviceId: string): Promise<void> {
    const deviceJobs = this.getJobsByDevice(deviceId).filter(
      (job) => job.status === "pending" || job.status === "paused",
    );

    for (const job of deviceJobs) {
      await this.cancelJob(job.id);
    }
  }

  // =============================================
  // 佇列統計
  // =============================================

  getQueueStatistics(): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    cancelled: number;
    paused: number;
  } {
    const jobs = Array.from(this.jobs.values());

    return {
      total: jobs.length,
      pending: jobs.filter((j) => j.status === "pending").length,
      processing: jobs.filter((j) => j.status === "printing").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      cancelled: jobs.filter((j) => j.status === "cancelled").length,
      paused: jobs.filter((j) => j.status === "paused").length,
    };
  }

  getDeviceStatistics(deviceId: string): {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    averageProcessingTime: number;
  } {
    const deviceJobs = this.getJobsByDevice(deviceId);
    const completedJobs = deviceJobs.filter(
      (j) => j.status === "completed" && j.completedAt,
    );

    let totalProcessingTime = 0;
    for (const job of completedJobs) {
      if (job.startedAt && job.completedAt) {
        totalProcessingTime +=
          job.completedAt.getTime() - job.startedAt.getTime();
      }
    }

    return {
      total: deviceJobs.length,
      pending: deviceJobs.filter((j) => j.status === "pending").length,
      processing: deviceJobs.filter((j) => j.status === "printing").length,
      completed: completedJobs.length,
      failed: deviceJobs.filter((j) => j.status === "failed").length,
      averageProcessingTime:
        completedJobs.length > 0
          ? totalProcessingTime / completedJobs.length
          : 0,
    };
  }

  // =============================================
  // 內部處理邏輯
  // =============================================

  private async processNextJobs(): Promise<void> {
    if (this.processing.size >= this.config.maxConcurrentJobs) {
      return;
    }

    const pendingJobs = this.getJobsByStatus("pending").filter(
      (job) => !this.pausedDevices.has(job.deviceId),
    );

    for (const job of pendingJobs) {
      if (this.processing.size >= this.config.maxConcurrentJobs) {
        break;
      }

      this.processJob(job);
    }
  }

  private async processJob(job: PrintJob): Promise<void> {
    this.processing.add(job.id);

    try {
      // 更新作業狀態
      this.updateJob(job.id, {
        status: "printing",
        attempts: job.attempts + 1,
        startedAt: new Date(),
        updatedAt: new Date(),
      });

      this.emit("job_started", { job: this.jobs.get(job.id)! });

      // 執行實際打印邏輯
      await this.executePrintJob(job);

      // 標記完成
      this.updateJob(job.id, {
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      });

      this.emit("job_completed", { job: this.jobs.get(job.id)! });
    } catch (error) {
      this.handleJobError(job, error);
    } finally {
      this.processing.delete(job.id);
    }
  }

  private async executePrintJob(job: PrintJob): Promise<void> {
    if (!this.jobExecutor) {
      throw new PrintJobError(
        `No printer executor is configured for job ${job.id}`,
      );
    }
    await this.jobExecutor(job);
  }

  private handleJobError(job: PrintJob, error: unknown): void {
    const shouldRetry = job.attempts < job.maxAttempts;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (shouldRetry) {
      // 重試邏輯 - 延遲後重新加入佇列
      setTimeout(() => {
        this.updateJob(job.id, {
          status: "pending",
          updatedAt: new Date(),
        });
      }, this.config.retryDelay);

      this.emit("job_retry_scheduled", {
        job: this.jobs.get(job.id)!,
        error: errorMessage,
      });
    } else {
      // 標記為失敗
      this.updateJob(job.id, {
        status: "failed",
        error: {
          code: "EXECUTION_FAILED",
          message: errorMessage,
          timestamp: new Date(),
        },
        updatedAt: new Date(),
      });

      this.emit("job_failed", {
        job: this.jobs.get(job.id)!,
        error: errorMessage,
      });
    }
  }

  private updateJob(jobId: string, updates: Partial<PrintJob>): void {
    const job = this.jobs.get(jobId);
    if (job) {
      Object.assign(job, updates);
    }
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  private priorityComparator = (a: PrintJob, b: PrintJob): number => {
    const priorityOrder: Record<PrintJobPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];

    if (priorityDiff !== 0) return priorityDiff;

    // 相同優先級按創建時間排序
    return a.createdAt.getTime() - b.createdAt.getTime();
  };

  // =============================================
  // 事件管理
  // =============================================

  on<K extends keyof PrintJobManagerEvents>(
    event: K,
    handler: (payload: PrintJobManagerEvents[K]) => void,
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler as (payload: never) => void);
  }

  off<K extends keyof PrintJobManagerEvents>(
    event: K,
    handler: (payload: PrintJobManagerEvents[K]) => void,
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler as (payload: never) => void);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit<K extends keyof PrintJobManagerEvents>(
    event: K,
    data: PrintJobManagerEvents[K],
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          (handler as (payload: PrintJobManagerEvents[K]) => void)(data);
        } catch (error) {
          console.error(
            `PrintJobManager event handler error for ${event}:`,
            error,
          );
        }
      });
    }
  }

  // =============================================
  // 清理和維護
  // =============================================

  cleanupCompletedJobs(olderThanHours = 24): number {
    const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const jobsToRemove: string[] = [];

    for (const [jobId, job] of this.jobs) {
      if (
        (job.status === "completed" || job.status === "cancelled") &&
        job.updatedAt < cutoffTime
      ) {
        jobsToRemove.push(jobId);
      }
    }

    jobsToRemove.forEach((jobId) => this.jobs.delete(jobId));

    this.emit("jobs_cleaned_up", {
      removedCount: jobsToRemove.length,
      cutoffTime,
    });

    return jobsToRemove.length;
  }

  // 設置作業執行器（由 PrinterService 注入）
  setJobExecutor(executor: (job: PrintJob) => Promise<void>): void {
    this.jobExecutor = executor;
  }
}
