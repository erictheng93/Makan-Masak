import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The failure paths below are driven on purpose and the code logs each one.
const silencedConsole: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  for (const method of ["error"] as const) {
    silencedConsole.push(
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
  }
});
afterEach(() => {
  silencedConsole.splice(0).forEach((spy) => spy.mockRestore());
});

// A deploy replaces every hashed chunk, so a tab still holding the previous
// index.html requests filenames that no longer exist. Observed in production:
// the failed navigation routed to the error view, that view was a chunk from
// the same dead build, its failure re-entered onError, and the loop produced
// 18,994 console errors before anyone looked. These cover both halves — the
// recovery must not be made of the thing that is broken, and it must be able
// to give up.
//
// Each case drives a real navigation into a module that refuses to load, which
// is the only way vue-router calls onError. Reaching into the router's private
// handler set would pass even if nothing were wired up.

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ isAuthenticated: false, checkAuth: vi.fn() }),
}));

vi.mock("@/views/ErrorView.vue", () => ({
  default: {
    name: "ErrorView",
    template: "<div />",
  },
}));

const CHUNK_MESSAGE =
  "Failed to fetch dynamically imported module: https://makanmasak.com/assets/HomeView-Ab12Cd34.js";

async function loadRouterWithDeadHomeChunk(message = CHUNK_MESSAGE) {
  // Throwing from the factory would make vitest wrap the error in its own
  // "error when mocking a module" text, and the router would then be judging
  // vitest's message instead of ours. A module whose `default` cannot be read
  // fails where vue-router resolves the component, which is where a real dead
  // chunk fails.
  vi.doMock("@/views/HomeView.vue", () => ({
    get default(): never {
      throw new TypeError(message);
    },
  }));
  const { default: router } = await import("@/router");
  return router;
}

function stubLocation() {
  const assign = vi.fn();
  vi.stubGlobal("location", {
    assign,
    pathname: "/",
    href: "http://localhost/",
    replace: vi.fn(),
    reload: vi.fn(),
  });
  return assign;
}

describe("router recovery from a stale build", () => {
  // The first import of @/router transforms its eager dependency graph, which
  // alone approaches the 5s test timeout on a loaded machine (#211). Pay that
  // cost here under the hook's own budget; beforeEach resets the registry, so
  // per-test imports re-evaluate from already-transformed modules.
  beforeAll(async () => {
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787/api/v1");
    await import("@/router");
    vi.resetModules();
  }, 30_000);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.stubEnv("VITE_API_BASE_URL", "http://localhost:8787/api/v1");
  });

  it("resolves the error route without fetching a chunk", async () => {
    const { default: router } = await import("@/router");
    const record = router.getRoutes().find((route) => route.name === "Error");

    // A function here would mean a lazy import — the one thing this view must
    // not be, since it exists to report that lazy imports are failing.
    expect(record).toBeDefined();
    expect(typeof record!.components?.default).not.toBe("function");
  });

  it("reloads to the intended page instead of routing on a dead chunk", async () => {
    const assign = stubLocation();
    const router = await loadRouterWithDeadHomeChunk();
    const push = vi.spyOn(router, "push");

    await router.push("/").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(assign).toHaveBeenCalledWith("/");
    // The router judged the chunk failure itself, not a wrapper around it.
    expect(console.error).toHaveBeenCalledWith(
      "路由錯誤:",
      expect.objectContaining({ message: CHUNK_MESSAGE }),
    );
    // Routing is what looped, so the reload replaces it rather than joining it.
    expect(
      push.mock.calls.filter(
        ([target]) =>
          typeof target === "object" && target !== null && "name" in target,
      ),
    ).toHaveLength(0);
  });

  it("stops reloading once the same page has already been retried", async () => {
    const assign = stubLocation();
    sessionStorage.setItem(
      "makanmakan_chunk_reload_path",
      JSON.stringify({ path: "/", at: Date.now() }),
    );
    const router = await loadRouterWithDeadHomeChunk();

    await router.push("/").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(assign).not.toHaveBeenCalled();
    // The build really is unreachable, so say so rather than reload forever.
    expect(router.currentRoute.value.name).toBe("Error");
  });

  it("leaves ordinary navigation failures on the error page", async () => {
    const assign = stubLocation();
    const router = await loadRouterWithDeadHomeChunk(
      "component threw during setup",
    );

    await router.push("/").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(assign).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe("Error");
  });

  it("forgets the retry mark once a navigation succeeds", async () => {
    stubLocation();
    sessionStorage.setItem("makanmakan_chunk_reload_path", "/scan");
    const { default: router } = await import("@/router");

    await router.push("/error");

    expect(sessionStorage.getItem("makanmakan_chunk_reload_path")).toBeNull();
  });
});
