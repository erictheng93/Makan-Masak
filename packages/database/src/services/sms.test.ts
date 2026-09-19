import { describe, it, expect, vi } from "vitest";
import {
  createSmsProvider,
  resolveSmsProviderName,
  isSmsConfigured,
  toTaiwanLocalPhone,
  MitakeSmsProvider,
  Every8dSmsProvider,
  TwilioSmsProvider,
  NoopSmsProvider,
  type SmsProviderEnv,
} from "./sms";

function textResponse(body: string, status = 200) {
  return new Response(body, { status });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Reads the form body out of a recorded fetch call. */
function formBodyOf(call: Parameters<typeof fetch>): URLSearchParams {
  const init = call[1] as RequestInit;
  return new URLSearchParams(String(init.body));
}

function buildEnv(overrides: Partial<SmsProviderEnv> = {}): SmsProviderEnv {
  return { ...overrides };
}

describe("toTaiwanLocalPhone", () => {
  it("converts +886 E.164 to local 09 format", () => {
    expect(toTaiwanLocalPhone("+886912345678")).toBe("0912345678");
  });

  it("converts a bare 886 prefix", () => {
    expect(toTaiwanLocalPhone("886912345678")).toBe("0912345678");
  });

  it("leaves non-TW numbers untouched", () => {
    expect(toTaiwanLocalPhone("+6591234567")).toBe("+6591234567");
  });
});

describe("resolveSmsProviderName", () => {
  it("defaults to noop with no credentials", () => {
    expect(resolveSmsProviderName(buildEnv())).toBe("noop");
  });

  it("auto-selects mitake ahead of every8d and twilio", () => {
    const name = resolveSmsProviderName(
      buildEnv({
        MITAKE_USERNAME: "u",
        MITAKE_PASSWORD: "p",
        EVERY8D_UID: "u",
        EVERY8D_PWD: "p",
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "tok",
        TWILIO_PHONE_NUMBER: "+15550000000",
      }),
    );
    expect(name).toBe("mitake");
  });

  it("auto-selects every8d ahead of twilio", () => {
    const name = resolveSmsProviderName(
      buildEnv({
        EVERY8D_UID: "u",
        EVERY8D_PWD: "p",
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "tok",
        TWILIO_PHONE_NUMBER: "+15550000000",
      }),
    );
    expect(name).toBe("every8d");
  });

  it("honours an explicit provider over auto-detection order", () => {
    const name = resolveSmsProviderName(
      buildEnv({
        SMS_PROVIDER: "twilio",
        MITAKE_USERNAME: "u",
        MITAKE_PASSWORD: "p",
        TWILIO_ACCOUNT_SID: "sid",
        TWILIO_AUTH_TOKEN: "tok",
        TWILIO_PHONE_NUMBER: "+15550000000",
      }),
    );
    expect(name).toBe("twilio");
  });

  it("fails closed to noop on an unrecognised provider name", () => {
    const name = resolveSmsProviderName(
      buildEnv({
        SMS_PROVIDER: "mitaki",
        MITAKE_USERNAME: "u",
        MITAKE_PASSWORD: "p",
      }),
    );
    expect(name).toBe("noop");
  });
});

describe("createSmsProvider", () => {
  it("returns noop when the selected provider has no credentials", () => {
    const provider = createSmsProvider(buildEnv({ SMS_PROVIDER: "mitake" }));
    expect(provider.name).toBe("noop");
  });

  it("builds each provider when credentials are present", () => {
    expect(
      createSmsProvider(
        buildEnv({ MITAKE_USERNAME: "u", MITAKE_PASSWORD: "p" }),
      ),
    ).toBeInstanceOf(MitakeSmsProvider);

    expect(
      createSmsProvider(buildEnv({ EVERY8D_UID: "u", EVERY8D_PWD: "p" })),
    ).toBeInstanceOf(Every8dSmsProvider);

    expect(
      createSmsProvider(
        buildEnv({
          TWILIO_ACCOUNT_SID: "sid",
          TWILIO_AUTH_TOKEN: "tok",
          TWILIO_PHONE_NUMBER: "+15550000000",
        }),
      ),
    ).toBeInstanceOf(TwilioSmsProvider);

    expect(createSmsProvider(buildEnv())).toBeInstanceOf(NoopSmsProvider);
  });

  it("reports configuration state", () => {
    expect(isSmsConfigured(buildEnv())).toBe(false);
    expect(
      isSmsConfigured(buildEnv({ EVERY8D_UID: "u", EVERY8D_PWD: "p" })),
    ).toBe(true);
  });
});

describe("MitakeSmsProvider", () => {
  it("posts local-format number and parses a success response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        textResponse(
          "[1]\r\nmsgid=1010079522\r\nstatuscode=1\r\nAccountPoint=98",
        ),
      );

    const provider = new MitakeSmsProvider(
      "acct",
      "secret",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({
      to: "+886912345678",
      body: "驗證碼 123456",
    });

    expect(result).toEqual({
      success: true,
      messageId: "1010079522",
      providerCode: "1",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("smsapi.mitake.com.tw/api/mtk/SmSend");
    expect(String(url)).toContain("CharsetURL=UTF8");
    expect(init).toMatchObject({ method: "POST" });

    const form = formBodyOf(fetchMock.mock.calls[0]);
    expect(form.get("dstaddr")).toBe("0912345678");
    expect(form.get("smbody")).toBe("驗證碼 123456");
  });

  it("treats a letter status code as failure with the vendor message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse("[1]\r\nmsgid=\r\nstatuscode=e"));

    const provider = new MitakeSmsProvider(
      "acct",
      "bad",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result.success).toBe(false);
    expect(result.providerCode).toBe("e");
    expect(result.error).toBe("帳號、密碼錯誤");
  });

  it("treats numeric failure codes (5-9) as failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse("[1]\r\nstatuscode=6"));

    const provider = new MitakeSmsProvider(
      "acct",
      "secret",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886900000000", body: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("門號有錯誤");
  });

  it("fails when no statuscode is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("garbage"));

    const provider = new MitakeSmsProvider(
      "acct",
      "secret",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no statuscode");
  });

  it("honours an API base override", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse("[1]\r\nstatuscode=1"));

    const provider = new MitakeSmsProvider(
      "acct",
      "secret",
      "https://smsb2c.mitake.com.tw",
      fetchMock as unknown as typeof fetch,
    );
    await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "smsb2c.mitake.com.tw",
    );
  });

  it("surfaces network errors instead of throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket closed"));

    const provider = new MitakeSmsProvider(
      "acct",
      "secret",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result).toEqual({ success: false, error: "socket closed" });
  });
});

describe("Every8dSmsProvider", () => {
  it("parses the CSV success row and posts a local-format number", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        textResponse("120.5,1,1.0,0,220478cc-8506-49b2-93b7-2505f651c12e"),
      );

    const provider = new Every8dSmsProvider(
      "uid",
      "pwd",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({
      to: "+886912345678",
      body: "驗證碼 123456",
    });

    expect(result).toEqual({
      success: true,
      messageId: "220478cc-8506-49b2-93b7-2505f651c12e",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://oms.every8d.com/API21/HTTP/sendSMS.ashx",
    );

    const form = formBodyOf(fetchMock.mock.calls[0]);
    expect(form.get("UID")).toBe("uid");
    expect(form.get("PWD")).toBe("pwd");
    expect(form.get("DEST")).toBe("0912345678");
    expect(form.get("MSG")).toBe("驗證碼 123456");
  });

  it("detects the negative-code error body returned with HTTP 200", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse("-104,Invalid username or password."));

    const provider = new Every8dSmsProvider(
      "uid",
      "bad",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result.success).toBe(false);
    expect(result.providerCode).toBe("-104");
    expect(result.error).toBe("Invalid username or password.");
  });

  it("fails when the vendor accepted zero messages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(textResponse("120.5,0,0,1,batch-1"));

    const provider = new Every8dSmsProvider(
      "uid",
      "pwd",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("accepted 0 messages");
  });

  it("fails on a malformed CSV row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse("120.5,1"));

    const provider = new Every8dSmsProvider(
      "uid",
      "pwd",
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("unexpected response");
  });
});

describe("TwilioSmsProvider", () => {
  it("sends E.164 unchanged and returns the message sid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sid: "SM123" }));

    const provider = new TwilioSmsProvider(
      "AC1",
      "token",
      "+15550000000",
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({
      to: "+886912345678",
      body: "code",
    });

    expect(result).toEqual({ success: true, messageId: "SM123" });

    const form = formBodyOf(fetchMock.mock.calls[0]);
    expect(form.get("To")).toBe("+886912345678");
    expect(form.get("From")).toBe("+15550000000");
  });

  it("returns the Twilio error message on a non-2xx response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ message: "Authenticate", code: 20003 }, 401),
      );

    const provider = new TwilioSmsProvider(
      "AC1",
      "bad",
      "+15550000000",
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.sendSMS({ to: "+886912345678", body: "x" });

    expect(result).toEqual({
      success: false,
      error: "Authenticate",
      providerCode: "20003",
    });
  });
});

describe("NoopSmsProvider", () => {
  it("always fails with an explicit reason", async () => {
    const result = await new NoopSmsProvider().sendSMS();
    expect(result.success).toBe(false);
    expect(result.error).toContain("No SMS provider configured");
  });
});

describe("SMS providers call fetch unbound", () => {
  // workerd's global fetch throws "Illegal invocation" when it is called as a
  // method of another object; this stand-in does the same.
  function strictFetch(this: unknown, ..._args: unknown[]) {
    if (this !== undefined && this !== globalThis) {
      return Promise.reject(new TypeError("Illegal invocation"));
    }
    return Promise.resolve(new Response("", { status: 599 }));
  }
  const fetchImpl = vi.fn(strictFetch) as unknown as typeof fetch;

  it.each([
    [
      "mitake",
      () => new MitakeSmsProvider("acct", "secret", undefined, fetchImpl),
    ],
    [
      "every8d",
      () => new Every8dSmsProvider("acct", "secret", undefined, fetchImpl),
    ],
    [
      "twilio",
      () => new TwilioSmsProvider("sid", "token", "+15550000000", fetchImpl),
    ],
  ])("%s reaches fetch without an Illegal invocation", async (_name, make) => {
    const result = await make().sendSMS({
      to: "+886912345678",
      body: "驗證碼 123456",
    });

    expect(fetchImpl).toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("Illegal invocation");
  });
});
