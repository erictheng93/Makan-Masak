// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { router } from "./index";
import { UserRole } from "@/types";
import { setAuthTokenProvider } from "@/utils/authTokenProvider";
import { navigationPending } from "@/utils/routeProgress";

// A structurally valid JWT that expires in 2100; only exp is read client-side.
const LIVE_TOKEN = [
  btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  btoa(JSON.stringify({ exp: 4102444800 })),
  "sig",
].join(".");

function signInAsOwner() {
  localStorage.setItem(
    "auth_user",
    JSON.stringify({
      id: "u-1",
      username: "owner",
      role: UserRole.OWNER,
      restaurantId: "r-1",
    }),
  );
  setAuthTokenProvider(() => LIVE_TOKEN);
  setActivePinia(createPinia());
}

describe("navigation progress and title timing", () => {
  // Pay the cold route-graph transform once, under the hook's own budget.
  beforeAll(async () => {
    signInAsOwner();
    await router.push("/dashboard/orders");
  }, 60_000);

  afterEach(() => {
    localStorage.clear();
    setAuthTokenProvider(() => null);
  });

  it("is pending while the lazy chunk resolves and clears afterwards", async () => {
    signInAsOwner();
    const seen: boolean[] = [];
    const stop = router.beforeResolve(() => {
      seen.push(navigationPending.value);
    });
    await router.push("/dashboard/settings");
    stop();

    expect(seen).toEqual([true]);
    expect(navigationPending.value).toBe(false);
  }, 30_000);

  it("clears pending when the guard redirects", async () => {
    // No session: the guard sends this to /login.
    setActivePinia(createPinia());
    await router.push("/dashboard/orders");

    expect(router.currentRoute.value.path).toBe("/login");
    expect(navigationPending.value).toBe(false);
  }, 30_000);

  it("updates the document title only after the route has resolved", async () => {
    signInAsOwner();
    await router.push("/dashboard/orders");
    document.title = "before";
    let titleDuringResolve = "";
    const stop = router.beforeResolve(() => {
      titleDuringResolve = document.title;
    });
    await router.push("/dashboard/settings");
    stop();

    expect(titleDuringResolve).toBe("before");
    expect(document.title).not.toBe("before");
  }, 30_000);
});
