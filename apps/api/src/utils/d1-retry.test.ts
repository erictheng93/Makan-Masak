import { describe, expect, it, vi } from "vitest";
import { isRetryableD1Error, withD1Retry } from "./d1-retry";

const noSleep = vi.fn().mockResolvedValue(undefined);

function drizzleFailure(d1Message: string) {
  return new Error("Failed query: select ...", {
    cause: new Error(`D1_ERROR: ${d1Message}`),
  });
}

describe("isRetryableD1Error", () => {
  it("recognises a transient D1 error wrapped by Drizzle", () => {
    expect(isRetryableD1Error(drizzleFailure("Network connection lost."))).toBe(
      true,
    );
  });

  it("does not treat a schema error as transient", () => {
    expect(isRetryableD1Error(drizzleFailure("no such column: x"))).toBe(false);
  });
});

describe("withD1Retry", () => {
  it("retries a transient failure and returns the eventual result", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(drizzleFailure("Network connection lost."))
      .mockResolvedValueOnce(["row"]);

    await expect(withD1Retry(operation, { sleep: noSleep })).resolves.toEqual([
      "row",
    ]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-transient failure without retrying", async () => {
    const error = drizzleFailure("no such column: x");
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withD1Retry(operation, { sleep: noSleep })).rejects.toBe(
      error,
    );
    expect(operation).toHaveBeenCalledOnce();
  });

  it("gives up after the retry budget so a real outage still alerts", async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(drizzleFailure("Network connection lost."));

    await expect(
      withD1Retry(operation, { retries: 2, sleep: noSleep }),
    ).rejects.toThrow("Failed query");
    expect(operation).toHaveBeenCalledTimes(3);
  });
});
