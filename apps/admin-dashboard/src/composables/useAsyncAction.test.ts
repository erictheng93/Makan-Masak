// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseApiError, useAsyncAction } from "./useAsyncAction";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("vue-toastification", () => ({ useToast: () => toast }));
const markErrorHandled = vi.hoisted(() => vi.fn());
vi.mock("@/utils/errorHandler", () => ({ markErrorHandled }));
vi.mock("@/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const apiError = (status: number, error: Record<string, unknown>) =>
  Object.assign(new Error("request failed"), {
    response: { status, data: { success: false, error } },
  });

describe("parseApiError", () => {
  it("flattens the unified envelope, including field details", () => {
    expect(
      parseApiError(
        apiError(409, {
          code: "USERNAME_TAKEN",
          message: "Username already exists",
          details: [{ field: "username", message: "Username already exists" }],
        }),
      ),
    ).toEqual({
      code: "USERNAME_TAKEN",
      message: "Username already exists",
      fieldErrors: { username: "Username already exists" },
      status: 409,
    });
  });

  it("tolerates anything that is not an API error", () => {
    expect(parseApiError(new Error("offline"))).toEqual({
      code: undefined,
      message: undefined,
      fieldErrors: {},
      status: undefined,
    });
    expect(parseApiError(undefined).fieldErrors).toEqual({});
  });
});

describe("useAsyncAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is pending while running and ignores a second tap", async () => {
    let finish!: (value: string) => void;
    const action = vi.fn(
      () => new Promise<string>((resolve) => (finish = resolve)),
    );
    const { run, pending } = useAsyncAction(action, { success: "Saved" });

    const first = run();
    expect(pending.value).toBe(true);
    await expect(run()).resolves.toBeUndefined();
    expect(action).toHaveBeenCalledOnce();

    finish("ok");
    await expect(first).resolves.toBe("ok");
    expect(pending.value).toBe(false);
    expect(toast.success).toHaveBeenCalledWith("Saved");
  });

  it("shows the server's message once and does not rethrow", async () => {
    const { run, error } = useAsyncAction(() =>
      Promise.reject(
        apiError(400, { code: "X", message: "Shift already open" }),
      ),
    );

    await expect(run()).resolves.toBeUndefined();
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith("Shift already open");
    expect(error.value?.code).toBe("X");
  });

  it("hands field errors to the form instead of toasting", async () => {
    const onFieldErrors = vi.fn();
    const { run } = useAsyncAction(
      () =>
        Promise.reject(
          apiError(400, {
            code: "VALIDATION_ERROR",
            message: "Validation failed",
            details: [{ field: "email", message: "Invalid email address" }],
          }),
        ),
      { onFieldErrors },
    );

    await run();
    expect(onFieldErrors).toHaveBeenCalledWith({
      email: "Invalid email address",
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the server sent none", async () => {
    const { run } = useAsyncAction(() => Promise.reject(new Error("offline")));
    await run();
    expect(toast.error).toHaveBeenCalledWith("errors.saveFailed");
  });
});

describe("useAsyncAction + global error handler", () => {
  it("marks a caught failure handled before toasting, so only one toast shows", async () => {
    vi.clearAllMocks();
    const error = apiError(500, { code: "X", message: "boom" });
    const { run } = useAsyncAction(() => Promise.reject(error));

    await run();

    expect(markErrorHandled).toHaveBeenCalledWith(error);
    expect(toast.error).toHaveBeenCalledOnce();
  });
});
