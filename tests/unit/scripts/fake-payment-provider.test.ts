import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("fake payment provider error responses", () => {
  let provider: ChildProcess | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    const portReservation = createServer();
    portReservation.listen(0, "127.0.0.1");
    await once(portReservation, "listening");
    const address = portReservation.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected a local TCP address");
    }
    const port = address.port;
    await new Promise<void>((resolve, reject) => {
      portReservation.close((error) => (error ? reject(error) : resolve()));
    });
    baseUrl = `http://127.0.0.1:${port}`;

    provider = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../../scripts/dev/fake-payment-provider.mjs",
            import.meta.url,
          ),
        ),
      ],
      {
        env: {
          ...process.env,
          FAKE_PROVIDER_PORT: String(port),
          MARKET_CHECKOUT_PROVIDER_SPLIT_SIGNING_SECRET: "",
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Fake payment provider did not become ready"));
      }, 10_000);
      let output = "";
      provider!.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes(`fake payment provider on ${baseUrl}`)) {
          clearTimeout(timeout);
          resolve();
        }
      });
      provider!.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      provider!.once("exit", (code, signal) => {
        clearTimeout(timeout);
        reject(new Error(`Fake payment provider exited: ${code ?? signal}`));
      });
    });
  });

  afterAll(async () => {
    if (
      !provider ||
      provider.exitCode !== null ||
      provider.signalCode !== null
    ) {
      return;
    }
    const exited = once(provider, "exit");
    provider.kill("SIGTERM");
    const forceKill = setTimeout(() => provider?.kill("SIGKILL"), 2_000);
    try {
      await exited;
    } finally {
      clearTimeout(forceKill);
    }
  });

  it("keeps the health endpoint available", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(5_000),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      message: "Fake provider ready",
    });
  });

  it("does not expose JSON parser errors or request contents", async () => {
    const response = await fetch(`${baseUrl}/payments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "private-payment-marker",
      signal: AbortSignal.timeout(5_000),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });

  it.each(["/confirm/%", "/topups/confirm/%"])(
    "does not expose URI decoding errors for %s",
    async (path) => {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(5_000),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Internal server error" });
    },
  );
});
