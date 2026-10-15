import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEY,
  saveHostCredentials,
  readHostCredentials,
  saveMemberCredentials,
  readMemberCredentials,
  updateHostMemberToken,
  clearHostCredentials,
  clearMemberCredentials,
  saveActiveGroupOrder,
  readActiveGroupOrder,
  clearActiveGroupOrder,
} from "./groupOrderSession";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["warn"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

describe("groupOrderSession storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips host credentials for a group order", () => {
    saveHostCredentials({
      groupOrderId: "go-1",
      memberToken: "s-1",
      memberId: "m-1",
      recoveryCode: "r-1",
    });

    expect(readHostCredentials("go-1")).toMatchObject({
      groupOrderId: "go-1",
      memberToken: "s-1",
      memberId: "m-1",
      recoveryCode: "r-1",
    });
  });

  it("round-trips member credentials without a recovery code", () => {
    saveMemberCredentials({
      groupOrderId: "go-1",
      memberId: "m-2",
      memberToken: "s-2",
    });

    expect(readMemberCredentials("go-1")).toMatchObject({
      groupOrderId: "go-1",
      memberId: "m-2",
      memberToken: "s-2",
    });
  });

  it("remembers the active group order for a restaurant table", () => {
    saveActiveGroupOrder({
      groupOrderId: "go-1",
      restaurantId: "rest-1",
      tableId: "7",
    });

    expect(readActiveGroupOrder("rest-1", "7")).toMatchObject({
      groupOrderId: "go-1",
      restaurantId: "rest-1",
      tableId: "7",
    });
  });

  it("keeps host and member sessions separate for the same group order", () => {
    saveHostCredentials({
      groupOrderId: "go-1",
      memberToken: "host-token",
      memberId: "m-1",
      recoveryCode: "recovery-1",
    });
    saveMemberCredentials({
      groupOrderId: "go-1",
      memberId: "m-2",
      memberToken: "member-token",
    });

    expect(readHostCredentials("go-1")).toMatchObject({
      memberToken: "host-token",
      recoveryCode: "recovery-1",
    });
    expect(readMemberCredentials("go-1")).toMatchObject({
      memberId: "m-2",
      memberToken: "member-token",
    });
  });

  it("keeps the recovery code when only the member token is rotated", () => {
    saveHostCredentials({
      groupOrderId: "go-1",
      memberToken: "s-1",
      memberId: "m-1",
      recoveryCode: "r-1",
    });

    updateHostMemberToken("go-1", "s-2");

    // Recovery issues a new member token; losing the recovery code at that
    // moment would leave the host unable to recover a second time.
    expect(readHostCredentials("go-1")).toMatchObject({
      memberToken: "s-2",
      memberId: "m-1",
      recoveryCode: "r-1",
    });
  });

  it("does not return credentials past the TTL", () => {
    saveHostCredentials({
      groupOrderId: "go-1",
      memberToken: "s-1",
      recoveryCode: "r-1",
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    stored.hosts["go-1"].savedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    expect(readHostCredentials("go-1")).toBeNull();
  });

  it("does not return member credentials past the TTL", () => {
    saveMemberCredentials({
      groupOrderId: "go-1",
      memberId: "m-2",
      memberToken: "s-2",
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    stored.members["go-1"].savedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    expect(readMemberCredentials("go-1")).toBeNull();
  });

  it("does not return active group orders past the TTL", () => {
    saveActiveGroupOrder({
      groupOrderId: "go-1",
      restaurantId: "rest-1",
      tableId: "7",
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    stored.active["rest-1:7"].savedAt = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    expect(readActiveGroupOrder("rest-1", "7")).toBeNull();
  });

  it("isolates group orders from each other", () => {
    saveHostCredentials({
      groupOrderId: "a",
      memberToken: "1",
      recoveryCode: "x",
    });
    saveHostCredentials({
      groupOrderId: "b",
      memberToken: "2",
      recoveryCode: "y",
    });

    clearHostCredentials("a");

    expect(readHostCredentials("a")).toBeNull();
    expect(readHostCredentials("b")).not.toBeNull();
  });

  it("clears member sessions independently from host credentials", () => {
    saveHostCredentials({
      groupOrderId: "go-1",
      memberToken: "host-token",
      recoveryCode: "recovery-1",
    });
    saveMemberCredentials({
      groupOrderId: "go-1",
      memberId: "m-2",
      memberToken: "member-token",
    });

    clearMemberCredentials("go-1");

    expect(readMemberCredentials("go-1")).toBeNull();
    expect(readHostCredentials("go-1")).toMatchObject({
      recoveryCode: "recovery-1",
    });
  });

  it("clears an active group order without clearing credentials", () => {
    saveHostCredentials({
      groupOrderId: "go-1",
      memberToken: "host-token",
      recoveryCode: "recovery-1",
    });
    saveActiveGroupOrder({
      groupOrderId: "go-1",
      restaurantId: "rest-1",
      tableId: "7",
    });

    clearActiveGroupOrder("rest-1", "7");

    expect(readActiveGroupOrder("rest-1", "7")).toBeNull();
    expect(readHostCredentials("go-1")).toMatchObject({
      memberToken: "host-token",
    });
  });

  it("reads legacy host records from the old flat shape", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "go-1": {
          groupOrderId: "go-1",
          memberToken: "legacy-token",
          recoveryCode: "recovery-1",
          savedAt: Date.now(),
        },
      }),
    );

    expect(readHostCredentials("go-1")).toMatchObject({
      memberToken: "legacy-token",
      recoveryCode: "recovery-1",
    });
  });

  it("survives unavailable storage without throwing", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("QuotaExceededError");
    };

    // Safari private mode and a full quota both throw here. The group order
    // still works for this page load; only recovery degrades.
    expect(() =>
      saveHostCredentials({
        groupOrderId: "go-2",
        memberToken: "s",
        recoveryCode: "r",
      }),
    ).not.toThrow();

    Storage.prototype.setItem = original;
  });

  it("survives a corrupted blob without throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    expect(() => readHostCredentials("go-1")).not.toThrow();
    expect(readHostCredentials("go-1")).toBeNull();
  });
});
