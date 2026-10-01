import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "./defaults";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.PRINTER_ENCODING;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createDefaultConfig", () => {
  it("builds defaults from environment variables", () => {
    process.env.RESTAURANT_ID = "restaurant-42";
    process.env.PRINT_AGENT_PORT = "4100";
    process.env.PRINT_AGENT_WS_PORT = "4101";
    process.env.ALLOWED_ORIGINS = "https://owner.example, https://pos.example";
    process.env.PRINT_AGENT_API_KEY = "explicit-api-key";
    process.env.CLOUD_API_ENDPOINT = "https://api.example/v1";
    process.env.AUTO_DISCOVERY = "false";
    process.env.DISCOVERY_INTERVAL = "45000";
    process.env.HEARTBEAT_INTERVAL = "90000";
    process.env.MAX_QUEUE_SIZE = "250";
    process.env.MAX_RETRIES = "5";
    process.env.RETRY_DELAY = "3000";

    expect(createDefaultConfig()).toEqual({
      port: 4100,
      wsPort: 4101,
      allowedOrigins: ["https://owner.example", "https://pos.example"],
      apiKey: "explicit-api-key",
      cloudEndpoint: "https://api.example/v1",
      serviceName: "Print Agent - Restaurant restaurant-42",
      restaurantId: "restaurant-42",
      cloudKey: undefined,
      printerEncoding: undefined,
      autoDiscovery: false,
      discoveryInterval: 45000,
      heartbeatInterval: 90000,
      maxQueueSize: 250,
      maxRetries: 5,
      retryDelay: 3000,
    });
  });

  it.each(["utf8", "big5", "gbk", " BIG5 "])(
    "accepts and normalizes PRINTER_ENCODING=%s",
    (value) => {
      process.env.PRINT_AGENT_API_KEY = "explicit-api-key";
      process.env.PRINTER_ENCODING = value;

      expect(createDefaultConfig().printerEncoding).toBe(
        value.trim().toLowerCase(),
      );
    },
  );

  it.each([undefined, "", "   "])(
    "leaves encoding unset for PRINTER_ENCODING=%s",
    (value) => {
      process.env.PRINT_AGENT_API_KEY = "explicit-api-key";
      if (value === undefined) delete process.env.PRINTER_ENCODING;
      else process.env.PRINTER_ENCODING = value;

      expect(createDefaultConfig().printerEncoding).toBeUndefined();
    },
  );

  it("rejects unsupported printer encodings", () => {
    process.env.PRINT_AGENT_API_KEY = "explicit-api-key";
    process.env.PRINTER_ENCODING = "latin1";

    expect(() => createDefaultConfig()).toThrow(
      "PRINTER_ENCODING must be utf8, big5 or gbk",
    );
  });

  it("refuses to create a config without an explicit API key", () => {
    process.env.RESTAURANT_ID = "restaurant-42";
    delete process.env.PRINT_AGENT_API_KEY;

    expect(() => createDefaultConfig()).toThrow(
      "PRINT_AGENT_API_KEY is required",
    );
  });

  it("refuses blank API keys", () => {
    process.env.RESTAURANT_ID = "restaurant-42";
    process.env.PRINT_AGENT_API_KEY = "   ";

    expect(() => createDefaultConfig()).toThrow(
      "PRINT_AGENT_API_KEY is required",
    );
  });
});
