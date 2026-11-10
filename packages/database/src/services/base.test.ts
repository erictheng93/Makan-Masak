import { describe, expect, it, vi } from "vitest";
import { BaseService } from "./base";

class TestService extends BaseService {
  exposeD1() {
    return this.d1;
  }
  read<T>(key: string, fn: () => Promise<T>) {
    return this.cachedQuery(key, fn, { ttl: 60 });
  }
  clear(tag: string) {
    return this.invalidateCache([tag], "tag");
  }
}

describe("BaseService deferred cache invalidation", () => {
  function build() {
    const service = new TestService(
      { prepare: vi.fn(), batch: vi.fn() } as never,
      { CACHE_KV: {} } as never,
    );
    let release!: () => void;
    const invalidate = vi.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const getOrExecute = vi.fn(async () => "cached");
    Object.defineProperty(service, "queryCache", {
      value: { invalidate, getOrExecute },
    });
    return { service, invalidate, getOrExecute, release: () => release() };
  }

  it("collects the clear instead of awaiting it", async () => {
    const { service, invalidate, release } = build();
    const pending: Promise<void>[] = [];
    const replays: Array<() => Promise<unknown>> = [];
    service.deferCacheInvalidation(pending, replays);

    // Resolves although the KV clear has not: the request is not held on it.
    await service.clear("menu:rest-1");

    expect(invalidate).toHaveBeenCalledWith(["menu:rest-1"], "tag");
    expect(pending).toHaveLength(1);
    release();
    await expect(pending[0]).resolves.toBeUndefined();

    // The replay re-runs the same clear for the delayed second sweep.
    expect(replays).toHaveLength(1);
    const again = replays[0]();
    release();
    await again;
    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenLastCalledWith(["menu:rest-1"], "tag");
  });

  it("reads through to D1 while its own clear is still pending", async () => {
    const { service, getOrExecute } = build();
    service.deferCacheInvalidation([]);
    expect(await service.read("menu", async () => "fresh")).toBe("cached");

    await service.clear("menu:rest-1");

    expect(await service.read("menu", async () => "fresh")).toBe("fresh");
    expect(getOrExecute).toHaveBeenCalledOnce();
  });
});

describe("BaseService read replication sessions", () => {
  function buildD1() {
    const session = { prepare: vi.fn(), batch: vi.fn(), getBookmark: vi.fn() };
    return {
      d1: {
        prepare: vi.fn(),
        batch: vi.fn(),
        withSession: vi.fn(() => session),
      },
      session,
    };
  }

  it("leaves queries on the primary when no constraint is given", () => {
    const { d1 } = buildD1();

    new TestService(d1 as never, {} as never);

    // The default has to stay bit-for-bit what it was before sessions existed:
    // roughly forty services inherit this constructor, and most of them write.
    expect(d1.withSession).not.toHaveBeenCalled();
  });

  it("opens a session with the given constraint when one is asked for", () => {
    const { d1 } = buildD1();

    new TestService(d1 as never, {} as never, {
      readSessionConstraint: "first-unconstrained",
    });

    expect(d1.withSession).toHaveBeenCalledOnce();
    expect(d1.withSession).toHaveBeenCalledWith("first-unconstrained");
  });

  it("passes a bookmark through unchanged", () => {
    const { d1 } = buildD1();

    // Bookmarks are opaque strings from a previous session's getBookmark();
    // the constraint must not be narrowed to the two named literals or
    // propagating one (#321) would not typecheck.
    new TestService(d1 as never, {} as never, {
      readSessionConstraint: "00000085-0000023b-00004ef8-boo",
    });

    expect(d1.withSession).toHaveBeenCalledWith(
      "00000085-0000023b-00004ef8-boo",
    );
  });

  it("keeps the raw d1 handle on the primary", () => {
    const { d1 } = buildD1();

    const service = new TestService(d1 as never, {} as never, {
      readSessionConstraint: "first-unconstrained",
    });

    // Write paths that reach for this.d1 must not inherit a read session.
    expect(service.exposeD1()).toBe(d1);
  });
});
