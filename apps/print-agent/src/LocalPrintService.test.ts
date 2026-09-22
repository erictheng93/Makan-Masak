import { createServer } from "node:net";
import type { AddressInfo, Server as NetServer } from "node:net";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { PrintJob } from "@makanmasak/shared-types";
import { PrintAgentService } from "./services/PrintAgentService";
import {
  LocalPrintService,
  MAX_ACKNOWLEDGEMENT_ATTEMPTS,
  MAX_CLOUD_JOBS_PER_DRAIN,
  PRINT_COMPLETION_TIMEOUT_MS,
} from "./LocalPrintService";
import type { LocalPrintServiceConfig } from "./LocalPrintService";

const API_KEY = "test-print-agent-api-key";
const CLOUD_ENDPOINT = "https://api.example/v1";
const CLOUD_KEY = "mmpa_test_cloud_key";
const TEST_ACKNOWLEDGEMENT_STORE_PATH = join(
  tmpdir(),
  "makan-print-agent-test-pending-acks.json",
);

const createConfig = (
  overrides: Partial<LocalPrintServiceConfig> = {},
): LocalPrintServiceConfig => ({
  port: 31003,
  wsPort: 31004,
  allowedOrigins: ["http://localhost:5173"],
  apiKey: API_KEY,
  cloudEndpoint: CLOUD_ENDPOINT,
  serviceName: "Print Agent",
  restaurantId: "restaurant-42",
  cloudKey: CLOUD_KEY,
  acknowledgementStorePath: TEST_ACKNOWLEDGEMENT_STORE_PATH,
  autoDiscovery: false,
  discoveryInterval: 30000,
  heartbeatInterval: 60000,
  maxQueueSize: 100,
  maxRetries: 3,
  retryDelay: 5000,
  ...overrides,
});

const reservePorts = async (count: number): Promise<number[]> => {
  const servers = await Promise.all(
    Array.from(
      { length: count },
      () =>
        new Promise<NetServer>((resolve, reject) => {
          const server = createServer();
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
  );

  const ports = servers.map((server) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server to have an address");
    }
    return address.port;
  });

  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );

  return ports;
};

const getPrivateServers = (service: LocalPrintService) => {
  const internals = service as unknown as {
    httpServer?: { address(): AddressInfo | string | null };
    wsServer?: { address(): AddressInfo | string | null };
  };

  if (!internals.httpServer || !internals.wsServer) {
    throw new Error("Expected local print service servers to be initialized");
  }

  return {
    httpServer: internals.httpServer,
    wsServer: internals.wsServer,
  };
};

const addressOf = (server: {
  address(): AddressInfo | string | null;
}): string => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to expose a TCP address");
  }
  return address.address;
};

const buildPrintRequest = (overrides: Record<string, unknown> = {}) => ({
  restaurantId: "restaurant-42",
  country: "TW",
  type: "order",
  data: {
    order: {
      id: "ORDER-1",
      items: [{ name: "Nasi Lemak", quantity: 1, price: 12 }],
      subtotal: 12,
      tax: 0,
      total: 12,
      createdAt: new Date().toISOString(),
    },
  },
  ...overrides,
});

const apiFetch = (
  port: number,
  path: string,
  init: RequestInit = {},
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      ...(init.headers ?? {}),
    },
  });

/**
 * Cloud calls are stubbed for every test in this file. Without this the agent
 * would resolve api.example over real DNS on each start(), which is both slow
 * and a hidden dependency on the poll being non-fatal.
 */
let cloudCalls: Array<{ url: string; init?: RequestInit }> = [];
let stateDirectories: string[] = [];
let cloudHandler: (url: string) => Response = () =>
  Response.json({ success: true, data: null });

beforeEach(() => {
  const realFetch = globalThis.fetch;
  cloudCalls = [];
  cloudHandler = () => Response.json({ success: true, data: null });

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(CLOUD_ENDPOINT)) {
      return realFetch(input, init);
    }
    cloudCalls.push({ url, init });
    return cloudHandler(url);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await rm(TEST_ACKNOWLEDGEMENT_STORE_PATH, { force: true });
  await Promise.all(
    stateDirectories.map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
  stateDirectories = [];
});

const connectWebSocket = (
  port: number,
  apiKey?: string,
): Promise<WebSocket> => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
    });

    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
};

describe("LocalPrintService network boundary", () => {
  let service: LocalPrintService | undefined;

  afterEach(async () => {
    if (service?.isServiceRunning()) {
      await service.stop();
    }
    service = undefined;
  });

  it("binds HTTP and WebSocket listeners to loopback", async () => {
    const [port, wsPort] = await reservePorts(2);
    service = new LocalPrintService(createConfig({ port, wsPort }));

    await service.start();

    const { httpServer, wsServer } = getPrivateServers(service);
    expect(addressOf(httpServer)).toBe("127.0.0.1");
    expect(addressOf(wsServer)).toBe("127.0.0.1");
  });

  it("requires the API key during WebSocket handshake", async () => {
    const [port, wsPort] = await reservePorts(2);
    service = new LocalPrintService(createConfig({ port, wsPort }));

    await service.start();

    await expect(connectWebSocket(wsPort)).rejects.toThrow(
      /Unexpected server response: 401/,
    );

    const ws = await connectWebSocket(wsPort, API_KEY);
    try {
      expect(service.getConnectedClientsCount()).toBe(1);
    } finally {
      ws.close();
    }
  });
});

describe("LocalPrintService HTTP API contract", () => {
  let service: LocalPrintService | undefined;

  afterEach(async () => {
    if (service?.isServiceRunning()) {
      await service.stop();
    }
    service = undefined;
  });

  const startService = async (): Promise<number> => {
    const [port, wsPort] = await reservePorts(2);
    service = new LocalPrintService(createConfig({ port, wsPort }));
    await service.start();
    return port;
  };

  it("initializes the print agent service during start()", async () => {
    await startService();

    expect(service!.getPrintAgentService().initialized).toBe(true);
  });

  it("reports degraded (not unhealthy) health when running with no printers", async () => {
    const port = await startService();

    const response = await apiFetch(port, "/health");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          status: "degraded",
          services: expect.objectContaining({ initialized: true }),
          devices: expect.objectContaining({ total: 0, online: 0 }),
        }),
      }),
    );
  });

  it("returns 503 NO_PRINTER_AVAILABLE when printing with no printers", async () => {
    const port = await startService();

    const response = await apiFetch(port, "/print", {
      method: "POST",
      body: JSON.stringify(buildPrintRequest()),
    });
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "NO_PRINTER_AVAILABLE",
          message: expect.any(String),
        }),
      }),
    );
  });

  it("returns 400 VALIDATION_ERROR for a malformed print request", async () => {
    const port = await startService();

    const response = await apiFetch(port, "/print", {
      method: "POST",
      body: JSON.stringify(buildPrintRequest({ country: undefined })),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
          message: expect.stringContaining("country"),
        }),
      }),
    );
  });

  it("returns 400 VALIDATION_ERROR for a mismatched restaurant ID", async () => {
    const port = await startService();

    const response = await apiFetch(port, "/print", {
      method: "POST",
      body: JSON.stringify(buildPrintRequest({ restaurantId: "other-shop" })),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
      }),
    );
  });

  it("returns 404 JOB_NOT_FOUND when cancelling an unknown job", async () => {
    const port = await startService();

    const response = await apiFetch(port, "/print/unknown-job", {
      method: "DELETE",
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "JOB_NOT_FOUND" }),
      }),
    );
  });

  it("rejects HTTP requests without the API key", async () => {
    const port = await startService();

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "UNAUTHORIZED" }),
      }),
    );
  });
});

describe("LocalPrintService cloud job dispatch", () => {
  let service: LocalPrintService | undefined;

  // Cloud-dispatch cases below focus on acknowledgement and drain behaviour,
  // not printer discovery. Give their fake local printer a real online health
  // reading; the dedicated offline case verifies that no such reading means
  // no cloud receipt is claimed.
  beforeEach(() => {
    vi.spyOn(PrintAgentService.prototype, "healthCheck").mockResolvedValue({
      status: "healthy",
      services: { printerService: true, initialized: true },
      devices: { total: 1, online: 1, errors: 0 },
      queue: { pending: 0, processing: 0, failed: 0 },
    });
  });

  afterEach(async () => {
    // The printer-deadline tests install fake timers. Restore before stop(),
    // which waits on real timers of its own.
    vi.useRealTimers();
    if (service?.isServiceRunning()) {
      await service.stop();
    }
    service = undefined;
  });

  const pollCloudJobs = (target: LocalPrintService): Promise<void> =>
    (target as unknown as { pollCloudJobs(): Promise<void> }).pollCloudJobs();

  const pendingJob = (receiptId = "receipt-1") => ({
    success: true,
    data: {
      receiptId,
      request: {
        country: "TW",
        type: "receipt",
        restaurantId: "restaurant-42",
        data: {
          order: {
            id: "order-1",
            items: [{ name: "Nasi Lemak", quantity: 1, price: 12 }],
            subtotal: 12,
            tax: 0,
            total: 12,
            createdAt: "2025-08-12T12:00:00.000Z",
          },
        },
      },
    },
  });

  /** Hands out the given receipts one per poll, then reports an empty queue. */
  const serveQueuedJobs = (receiptIds: string[]) => {
    const queued = [...receiptIds];
    cloudHandler = (url) => {
      if (url.includes("/ack")) return Response.json({ success: true });
      const receiptId = queued.shift();
      return Response.json(
        receiptId ? pendingJob(receiptId) : { success: true, data: null },
      );
    };
  };

  const jobPolls = () =>
    cloudCalls.filter((call) => !call.url.includes("/ack"));

  const ackedReceipts = () =>
    cloudCalls
      .filter((call) => call.url.includes("/ack"))
      .map((call) => new URL(call.url).pathname.split("/").at(-2));

  const printsCompletedJobs = (target: LocalPrintService) => {
    const agent = target.getPrintAgentService();
    vi.spyOn(agent, "getJobStatus").mockResolvedValue({
      id: "job-1",
      status: "completed",
      deviceId: "USB-1",
    } as unknown as PrintJob);
    return vi
      .spyOn(agent, "createPrintJob")
      .mockResolvedValue({ success: true, jobId: "job-1" });
  };

  const serveOneJob = () => serveQueuedJobs(["receipt-1"]);

  /**
   * The queue is drained, so the last cloud call is the empty poll that ended
   * the drain. Read the last acknowledgement, not the last call.
   */
  const acknowledgement = () =>
    JSON.parse(
      String(
        cloudCalls.filter((call) => call.url.includes("/ack")).at(-1)?.init
          ?.body,
      ),
    ) as Record<string, unknown>;

  /**
   * Drives a drain past the agent's wait on the physical printer without
   * spending 30 real seconds on it. The caller installs the fake timers so its
   * job-status mock can be written against the same clock.
   */
  const drainPastThePrinterDeadline = async (
    target: LocalPrintService,
  ): Promise<void> => {
    const drain = pollCloudJobs(target);
    await vi.advanceTimersByTimeAsync(PRINT_COMPLETION_TIMEOUT_MS);
    await drain;
  };

  it("claims a job for its own register and acknowledges a completed print", async () => {
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    const createPrintJob = vi
      .spyOn(agent, "createPrintJob")
      .mockResolvedValue({ success: true, jobId: "job-1" });
    vi.spyOn(agent, "getJobStatus").mockResolvedValue({
      id: "job-1",
      status: "completed",
      deviceId: "USB-1",
    } as unknown as PrintJob);
    serveOneJob();

    await pollCloudJobs(service);

    const polled = new URL(String(cloudCalls[0]?.url));
    expect(polled.origin + polled.pathname).toBe(
      `${CLOUD_ENDPOINT}/print/jobs`,
    );
    // No register and no restaurant anywhere on the wire: the cloud derives
    // both from the credential, so this agent cannot ask for another shop's
    // receipts. Asserted per-parameter rather than against a whole URL string,
    // which would also break every time an unrelated parameter is added.
    expect(polled.searchParams.get("registerId")).toBeNull();
    expect(polled.searchParams.get("restaurantId")).toBeNull();
    expect(cloudCalls[0]?.init?.headers).toEqual({
      "X-Print-Agent-Key": CLOUD_KEY,
    });
    expect(createPrintJob).toHaveBeenCalledOnce();
    // The ESC/POS formatter calls Date methods on this field, but JSON only
    // ever carries a string.
    expect(
      createPrintJob.mock.calls[0]?.[0].data.order.createdAt,
    ).toBeInstanceOf(Date);

    expect(cloudCalls[1]?.url).toBe(
      `${CLOUD_ENDPOINT}/print/jobs/receipt-1/ack`,
    );
    expect(cloudCalls[1]?.init?.method).toBe("POST");
    expect(acknowledgement()).toEqual({
      status: "printed",
      printerName: "USB-1",
    });
  });

  it("retries a persisted acknowledgement before claiming again after an ack outage", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "makan-print-agent-"));
    stateDirectories.push(stateDirectory);
    const acknowledgementStorePath = join(stateDirectory, "pending-acks.json");
    service = new LocalPrintService(createConfig({ acknowledgementStorePath }));
    const createPrintJob = printsCompletedJobs(service);
    let cloudStatus: "printing" | "printed" = "printing";
    let failFirstAcknowledgement = true;
    cloudHandler = (url) => {
      if (url.includes("/ack")) {
        if (failFirstAcknowledgement) {
          failFirstAcknowledgement = false;
          throw new Error("temporary network failure");
        }
        cloudStatus = "printed";
        return Response.json({ success: true });
      }
      return Response.json(
        cloudStatus === "printing"
          ? pendingJob()
          : { success: true, data: null },
      );
    };

    await expect(pollCloudJobs(service)).resolves.toBeUndefined();
    expect(createPrintJob).toHaveBeenCalledOnce();
    expect(ackedReceipts()).toEqual(["receipt-1"]);

    // A restart must remember the printed receipt; otherwise the cloud can
    // re-issue its still-printing claim after its five-minute timeout.
    service = new LocalPrintService(createConfig({ acknowledgementStorePath }));
    await pollCloudJobs(service);

    expect(createPrintJob).toHaveBeenCalledOnce();
    expect(ackedReceipts()).toEqual(["receipt-1", "receipt-1"]);
    expect(cloudStatus).toBe("printed");
  });

  it("quarantines an unreadable acknowledgement store instead of stalling", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "makan-print-agent-"));
    stateDirectories.push(stateDirectory);
    const acknowledgementStorePath = join(stateDirectory, "pending-acks.json");
    await writeFile(acknowledgementStorePath, "{ not json", "utf8");
    service = new LocalPrintService(createConfig({ acknowledgementStorePath }));
    const createPrintJob = printsCompletedJobs(service);
    serveOneJob();

    // Every drain reads the store before anything is claimed, so a throw here
    // would mean this poll never reaches the printer at all.
    await expect(pollCloudJobs(service)).resolves.toBeUndefined();

    expect(createPrintJob).toHaveBeenCalledOnce();
    expect(ackedReceipts()).toEqual(["receipt-1"]);

    const quarantined = (await readdir(stateDirectory)).filter((name) =>
      name.startsWith("pending-acks.json.corrupt-"),
    );
    expect(quarantined).toHaveLength(1);
    await expect(
      readFile(join(stateDirectory, quarantined[0]), "utf8"),
    ).resolves.toBe("{ not json");
  });

  it("rejects a store whose entries are the wrong shape", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "makan-print-agent-"));
    stateDirectories.push(stateDirectory);
    const acknowledgementStorePath = join(stateDirectory, "pending-acks.json");
    // Valid JSON, but `status` is not one of the three the cloud accepts.
    await writeFile(
      acknowledgementStorePath,
      JSON.stringify([
        { receiptId: "receipt-9", acknowledgement: { status: "queued" } },
      ]),
      "utf8",
    );
    service = new LocalPrintService(createConfig({ acknowledgementStorePath }));
    printsCompletedJobs(service);
    serveOneJob();

    await expect(pollCloudJobs(service)).resolves.toBeUndefined();

    expect(ackedReceipts()).toEqual(["receipt-1"]);
    expect(
      (await readdir(stateDirectory)).filter((name) =>
        name.startsWith("pending-acks.json.corrupt-"),
      ),
    ).toHaveLength(1);
  });

  it("abandons an acknowledgement the cloud keeps rejecting so the queue can move", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "makan-print-agent-"));
    stateDirectories.push(stateDirectory);
    const acknowledgementStorePath = join(stateDirectory, "pending-acks.json");
    service = new LocalPrintService(createConfig({ acknowledgementStorePath }));
    const createPrintJob = printsCompletedJobs(service);

    const queued = ["receipt-1", "receipt-2"];
    cloudHandler = (url) => {
      if (url.includes("/ack")) {
        // 400 is not the 404 that means "already settled", so this one is
        // rejected for good rather than being terminal-and-safe to forget.
        return url.includes("receipt-1")
          ? new Response("rejected", { status: 400 })
          : Response.json({ success: true });
      }
      const receiptId = queued.shift();
      return Response.json(
        receiptId ? pendingJob(receiptId) : { success: true, data: null },
      );
    };

    for (let poll = 0; poll < MAX_ACKNOWLEDGEMENT_ATTEMPTS; poll += 1) {
      await pollCloudJobs(service);
    }

    // The first poll printed receipt-1 and made its first ack attempt; the
    // polls after it only retried that ack, claiming nothing. The last one
    // spent the final attempt, dropped the entry, and went on to receipt-2.
    expect(
      ackedReceipts().filter((receiptId) => receiptId === "receipt-1"),
    ).toHaveLength(MAX_ACKNOWLEDGEMENT_ATTEMPTS);
    expect(createPrintJob).toHaveBeenCalledTimes(2);
    expect(ackedReceipts()).toContain("receipt-2");
  });

  it("counts attempts from zero for a store written before the cap existed", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "makan-print-agent-"));
    stateDirectories.push(stateDirectory);
    const acknowledgementStorePath = join(stateDirectory, "pending-acks.json");
    // The exact shape 5b512bd6 wrote: no `attempts` field at all. Reading it
    // as invalid would quarantine the file and reprint the receipt.
    await writeFile(
      acknowledgementStorePath,
      JSON.stringify([
        { receiptId: "receipt-9", acknowledgement: { status: "printed" } },
      ]),
      "utf8",
    );
    service = new LocalPrintService(createConfig({ acknowledgementStorePath }));
    printsCompletedJobs(service);
    serveOneJob();

    await expect(pollCloudJobs(service)).resolves.toBeUndefined();

    expect(ackedReceipts()).toEqual(["receipt-9", "receipt-1"]);
    expect(
      (await readdir(stateDirectory)).filter((name) =>
        name.startsWith("pending-acks.json.corrupt-"),
      ),
    ).toEqual([]);
  });

  it("still acknowledges inline when the pending store cannot be written", async () => {
    service = new LocalPrintService(createConfig());
    const createPrintJob = printsCompletedJobs(service);
    serveOneJob();
    const writeFailure = new Error("ENOSPC: no space left on device");
    vi.spyOn(
      service as unknown as {
        writePendingAcknowledgements(entries: unknown[]): Promise<void>;
      },
      "writePendingAcknowledgements",
    ).mockRejectedValue(writeFailure);

    // The drain stops: a store that cannot be written cannot protect the next
    // receipt either, and the heartbeat's catch is what surfaces that.
    await expect(pollCloudJobs(service)).rejects.toThrow(writeFailure);

    expect(createPrintJob).toHaveBeenCalledOnce();
    // Without the inline send this receipt would carry no acknowledgement at
    // all, and the cloud would reprint it after CLAIM_TIMEOUT_MS.
    expect(ackedReceipts()).toEqual(["receipt-1"]);
    expect(acknowledgement()).toMatchObject({ status: "printed" });
  });

  it("forgets an acknowledgement the cloud reports as already settled", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "makan-print-agent-"));
    stateDirectories.push(stateDirectory);
    service = new LocalPrintService(
      createConfig({
        acknowledgementStorePath: join(stateDirectory, "pending-acks.json"),
      }),
    );
    const createPrintJob = printsCompletedJobs(service);
    let claimed = false;
    cloudHandler = (url) =>
      url.includes("/ack")
        ? new Response("already acknowledged", { status: 404 })
        : Response.json(
            claimed
              ? { success: true, data: null }
              : ((claimed = true), pendingJob()),
          );

    await pollCloudJobs(service);
    await pollCloudJobs(service);

    expect(createPrintJob).toHaveBeenCalledOnce();
    expect(ackedReceipts()).toEqual(["receipt-1"]);
    expect(jobPolls()).toHaveLength(3);
  });

  it("acknowledges failure when the local queue refuses the job", async () => {
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: false,
      error: { code: "NO_PRINTER_AVAILABLE", message: "No printer available" },
    });
    const getJobStatus = vi.spyOn(agent, "getJobStatus");
    serveOneJob();

    await pollCloudJobs(service);

    // A claimed receipt that is never acknowledged stays "printing" forever —
    // there is no reclaim path on the cloud side.
    expect(getJobStatus).not.toHaveBeenCalled();
    expect(acknowledgement()).toEqual({
      status: "failed",
      response: "No printer available",
    });
  });

  it("acknowledges failure when the printer reports a failed job", async () => {
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: true,
      jobId: "job-1",
    });
    vi.spyOn(agent, "getJobStatus").mockResolvedValue({
      id: "job-1",
      status: "failed",
      deviceId: "USB-1",
      error: { code: "PAPER_OUT", message: "Paper out" },
    } as unknown as PrintJob);
    serveOneJob();

    await pollCloudJobs(service);

    expect(acknowledgement()).toEqual({
      status: "failed",
      printerName: "USB-1",
      response: "Paper out",
    });
  });

  it("reports an indeterminate outcome for a print it stopped watching mid-print", async () => {
    // 30s is up and the job is still on the printer. The local queue keeps
    // retrying a job like this well past that point, so it may yet come out on
    // paper. The cloud re-queues anything reported `failed`, so claiming a
    // failure here is how the same bill gets printed twice.
    vi.useFakeTimers();
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: true,
      jobId: "job-1",
    });
    vi.spyOn(agent, "getJobStatus").mockResolvedValue({
      id: "job-1",
      status: "printing",
      deviceId: "USB-1",
    } as unknown as PrintJob);
    // Mid-print is exactly the state the local queue refuses to cancel.
    const cancelJob = vi.spyOn(agent, "cancelJob").mockResolvedValue(false);
    serveOneJob();

    await drainPastThePrinterDeadline(service);

    expect(cancelJob).toHaveBeenCalledOnce();
    expect(cancelJob).toHaveBeenCalledWith("job-1");
    expect(acknowledgement()).toEqual({
      status: "indeterminate",
      response: "Timed out waiting for physical printer completion",
    });
  });

  it("reports a plain failure when the timed-out job never left the queue", async () => {
    // The local queue only cancels a job still `pending`, so a cancel that
    // succeeds proves nothing reached the printer. That is an observed
    // outcome, and re-queueing it is safe.
    vi.useFakeTimers();
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: true,
      jobId: "job-1",
    });
    vi.spyOn(agent, "getJobStatus").mockResolvedValue({
      id: "job-1",
      status: "pending",
      deviceId: "USB-1",
    } as unknown as PrintJob);
    const cancelJob = vi.spyOn(agent, "cancelJob").mockResolvedValue(true);
    serveOneJob();

    await drainPastThePrinterDeadline(service);

    expect(cancelJob).toHaveBeenCalledWith("job-1");
    expect(acknowledgement()).toEqual({
      status: "failed",
      response:
        "Cancelled before printing after waiting for the physical printer",
    });
  });

  it("acknowledges a print that completed inside the last poll gap", async () => {
    vi.useFakeTimers();
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: true,
      jobId: "job-1",
    });
    // Completes on the deadline itself — after the last poll of the wait loop
    // and before the re-read that closes the race.
    const deadline = Date.now() + PRINT_COMPLETION_TIMEOUT_MS;
    vi.spyOn(agent, "getJobStatus").mockImplementation(
      async () =>
        ({
          id: "job-1",
          status: Date.now() < deadline ? "printing" : "completed",
          deviceId: "USB-1",
        }) as unknown as PrintJob,
    );
    const cancelJob = vi.spyOn(agent, "cancelJob").mockResolvedValue(false);
    serveOneJob();

    await drainPastThePrinterDeadline(service);

    // Without the re-read the agent would cancel-and-report on a receipt that
    // is already on paper.
    expect(cancelJob).not.toHaveBeenCalled();
    expect(acknowledgement()).toEqual({
      status: "printed",
      printerName: "USB-1",
    });
  });

  it("stops the drain when a print fails instead of burning the backlog", async () => {
    // The cloud re-queues a failed receipt rather than settling it, so a drain
    // that carried on would re-claim the same one immediately, fail again, and
    // spend its whole delivery budget in seconds — then do the same to every
    // receipt behind it. One failed attempt per heartbeat is the pacing the
    // cloud's retry rule assumes.
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: false,
      error: { code: "NO_PRINTER_AVAILABLE", message: "No printer available" },
    });
    serveQueuedJobs(["receipt-1", "receipt-2", "receipt-3"]);

    await pollCloudJobs(service);

    // One claim, one failed acknowledgement, and the backlog left untouched.
    expect(jobPolls()).toHaveLength(1);
    expect(ackedReceipts()).toEqual(["receipt-1"]);
    expect(acknowledgement()).toMatchObject({ status: "failed" });
  });

  it("resumes the backlog on the next poll once printing recovers", async () => {
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    const createPrintJob = vi.spyOn(agent, "createPrintJob").mockResolvedValue({
      success: false,
      error: { code: "NO_PRINTER_AVAILABLE", message: "No printer available" },
    });
    serveQueuedJobs(["receipt-1", "receipt-2"]);

    await pollCloudJobs(service);
    expect(jobPolls()).toHaveLength(1);

    // Printer comes back: the very next heartbeat drains what is left.
    printsCompletedJobs(service);
    createPrintJob.mockResolvedValue({ success: true, jobId: "job-1" });
    await pollCloudJobs(service);

    expect(ackedReceipts()).toEqual(["receipt-1", "receipt-2"]);
  });

  it("stays a local-only print server when no cloud credential is configured", async () => {
    // A shop can run the agent purely for the POS on the same LAN. Without a
    // credential there is no tenant to poll for, so it must not call out at
    // all rather than poll and be rejected every minute.
    service = new LocalPrintService(createConfig({ cloudKey: undefined }));
    const agent = service.getPrintAgentService();
    const createPrintJob = vi.spyOn(agent, "createPrintJob");

    await pollCloudJobs(service);

    expect(cloudCalls).toHaveLength(0);
    expect(createPrintJob).not.toHaveBeenCalled();
  });

  it("does not claim a cloud receipt while every printer is offline", async () => {
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    vi.spyOn(agent, "healthCheck").mockResolvedValue({
      status: "degraded",
      services: { printerService: true, initialized: true },
      devices: { total: 1, online: 0, errors: 1 },
      queue: { pending: 0, processing: 0, failed: 0 },
    });
    const createPrintJob = vi.spyOn(agent, "createPrintJob");
    serveOneJob();

    await pollCloudJobs(service);

    expect(cloudCalls).toHaveLength(0);
    expect(createPrintJob).not.toHaveBeenCalled();
  });

  it("prints nothing and acknowledges nothing when the queue is empty", async () => {
    service = new LocalPrintService(createConfig());
    const agent = service.getPrintAgentService();
    const createPrintJob = vi.spyOn(agent, "createPrintJob");

    await pollCloudJobs(service);

    expect(createPrintJob).not.toHaveBeenCalled();
    expect(cloudCalls).toHaveLength(1);
  });

  it("drains the whole queue in one poll instead of one receipt per heartbeat", async () => {
    // The cloud returns one receipt per call. Claiming once per heartbeat made
    // a dinner-rush backlog of four take four minutes to print.
    service = new LocalPrintService(createConfig());
    const createPrintJob = printsCompletedJobs(service);
    serveQueuedJobs(["receipt-1", "receipt-2", "receipt-3", "receipt-4"]);

    await pollCloudJobs(service);

    expect(createPrintJob).toHaveBeenCalledTimes(4);
    expect(ackedReceipts()).toEqual([
      "receipt-1",
      "receipt-2",
      "receipt-3",
      "receipt-4",
    ]);
    // Four claims plus the empty poll that ends the drain — it stops on the
    // empty queue rather than claiming until the bound.
    expect(jobPolls()).toHaveLength(5);
  });

  it("keeps reporting printer counts on every claim of a drain", async () => {
    service = new LocalPrintService(createConfig());
    printsCompletedJobs(service);
    serveQueuedJobs(["receipt-1", "receipt-2"]);

    await pollCloudJobs(service);

    // Counts ride along on the poll; a drain that dropped them after the first
    // claim would leave the cloud with a stale reading for a whole heartbeat.
    for (const call of jobPolls()) {
      const polled = new URL(call.url);
      expect(polled.searchParams.get("printersTotal")).toBe("1");
      expect(polled.searchParams.get("printersOnline")).toBe("1");
    }
  });

  it("ignores a heartbeat that fires mid-drain", async () => {
    // Two concurrent drains would claim and print the same receipts twice.
    service = new LocalPrintService(createConfig());
    const target = service;
    let heartbeat: Promise<void> | undefined;
    const agent = target.getPrintAgentService();
    vi.spyOn(agent, "getJobStatus").mockResolvedValue({
      id: "job-1",
      status: "completed",
      deviceId: "USB-1",
    } as unknown as PrintJob);
    const createPrintJob = vi
      .spyOn(agent, "createPrintJob")
      .mockImplementation(async () => {
        heartbeat ??= pollCloudJobs(target);
        return { success: true, jobId: "job-1" };
      });
    serveQueuedJobs(["receipt-1", "receipt-2"]);

    await pollCloudJobs(target);
    await heartbeat;

    expect(createPrintJob).toHaveBeenCalledTimes(2);
    expect(ackedReceipts()).toEqual(["receipt-1", "receipt-2"]);
  });

  it("stops draining at its bound instead of looping forever", async () => {
    // A cloud that keeps handing back a receipt it never marks done would
    // otherwise pin the agent here and it would never poll — or stop — again.
    service = new LocalPrintService(createConfig());
    const createPrintJob = printsCompletedJobs(service);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cloudHandler = (url) =>
      url.includes("/ack")
        ? Response.json({ success: true })
        : Response.json(pendingJob());

    await pollCloudJobs(service);

    expect(createPrintJob).toHaveBeenCalledTimes(MAX_CLOUD_JOBS_PER_DRAIN);
    expect(jobPolls()).toHaveLength(MAX_CLOUD_JOBS_PER_DRAIN);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(String(MAX_CLOUD_JOBS_PER_DRAIN)),
    );
  });

  it("stops draining on the first failed claim rather than hot-looping", async () => {
    service = new LocalPrintService(createConfig());
    const createPrintJob = printsCompletedJobs(service);
    let polls = 0;
    cloudHandler = (url) => {
      if (url.includes("/ack")) return Response.json({ success: true });
      polls += 1;
      return polls === 1
        ? Response.json(pendingJob())
        : new Response("upstream down", { status: 500 });
    };

    await expect(pollCloudJobs(service)).rejects.toThrow(
      /Cloud job poll failed \(500\)/,
    );

    expect(createPrintJob).toHaveBeenCalledOnce();
    expect(polls).toBe(2);

    // The in-flight guard must be released even when the drain throws, or one
    // bad poll would silence the agent until it is restarted.
    cloudHandler = () => Response.json({ success: true, data: null });
    await pollCloudJobs(service);
    expect(jobPolls()).toHaveLength(3);
  });

  it("keeps serving local print jobs when the startup cloud poll fails", async () => {
    // index.ts turns a rejected start() into process.exit(1). Coupling the
    // daemon's startup to cloud reachability means an offline uplink takes out
    // the shop's local printing too, which used to work on its own.
    cloudHandler = () => {
      throw new Error("getaddrinfo ENOTFOUND api.example");
    };
    const [port, wsPort] = await reservePorts(2);
    service = new LocalPrintService(createConfig({ port, wsPort }));

    await expect(service.start()).resolves.toBeUndefined();

    expect(service.isServiceRunning()).toBe(true);
    const response = await apiFetch(port, "/health");
    expect(response.status).toBe(200);
  });
});
