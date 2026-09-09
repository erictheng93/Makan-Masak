/**
 * 店務主流程 → 選項群組, against a real API and a real D1.
 *
 * This node needs no seed data at all — the page writes its own first row — so
 * it exercises the full create → read → mutate → delete lifecycle from an empty
 * table. That makes it the cleanest end-to-end proof that the admin dashboard
 * and the Worker actually agree.
 *
 * Context worth keeping: #257 reported this page had no sidebar entry and was
 * reachable only by typing the URL. That is fixed (`Sidebar.vue`,
 * `nav-item-menu-option-groups`), and the first test pins the fix by navigating
 * through the sidebar rather than by URL — a URL-only spec would still pass if
 * the entry regressed.
 */
import { expect, test } from "@playwright/test";
import {
  apiCleanup,
  apiRequest,
  assertAuthenticated,
  assertNoOverlayError,
  e2eName,
  getOwnerContext,
  gotoAdmin,
  installAdminSession,
  POLL_TIMEOUT,
  requireStack,
} from "./admin-e2e";

interface OptionChoice {
  id?: string;
  name?: string;
  isAvailable?: boolean | number;
  priceAdjustment?: number;
}

interface OptionGroup {
  id?: string;
  name?: string;
  kind?: string;
  type?: string;
  choices?: OptionChoice[];
}

async function fetchGroups(restaurantId: string, token: string) {
  const result = await apiRequest<OptionGroup[]>(
    `/api/v1/menu/${restaurantId}/option-groups`,
    { token },
  );
  return result.body.data ?? [];
}

test.describe.configure({ mode: "serial" });

test.describe("選項群組 (real API)", () => {
  test("owner reaches the page from the sidebar and creates a group with a choice", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();
    const groupName = e2eName("Group");
    const choiceName = e2eName("Choice");
    let groupId: string | undefined;

    await installAdminSession(page, login);

    try {
      // Land on the menu page, then navigate by clicking the nav entry. #257
      // was exactly "the page works but nothing links to it", so the click is
      // the assertion.
      await gotoAdmin(page, "/dashboard/menu", {
        expectApi: `/api/v1/menu/${restaurantId}`,
      });
      await assertAuthenticated(page);

      const navEntry = page.getByTestId("nav-item-menu-option-groups");
      await expect(
        navEntry,
        "shared option groups must be reachable from the sidebar (#257)",
      ).toBeVisible();

      await Promise.all([
        page.waitForResponse(
          (response) =>
            response.url().includes("/option-groups") && response.ok(),
          { timeout: 60_000 },
        ),
        navEntry.click(),
      ]);

      await page.getByTestId("add-group").click();
      await expect(page.getByTestId("group-modal")).toBeVisible();
      await page.getByTestId("group-name-input").fill(groupName);
      await page
        .getByTestId("group-public-id-input")
        .fill(`e2e-${Date.now().toString(36)}`);
      await page.getByTestId("group-kind-select").selectOption("addon");
      await page.getByTestId("group-type-select").selectOption("multiple");

      const groupCreated = page.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/menu/${restaurantId}/option-groups`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("save-group").click();
      const groupResponse = await groupCreated;
      expect(
        groupResponse.ok(),
        `option group create returned ${groupResponse.status()}`,
      ).toBe(true);

      const groupBody = (await groupResponse.json()) as { data?: OptionGroup };
      groupId = groupBody.data?.id;
      // option_groups uses TEXT UUID v7 primary keys, unlike the integer
      // autoincrement ids on menu_items / categories. The repo is mixed by
      // design; check per table before assuming.
      expect(groupId, "created option group id").toMatch(/^[0-9a-f-]{36}$/);

      await expect(page.getByTestId(`option-group-${groupId}`)).toBeVisible();

      // Add a priced choice to the group we just made.
      await page.getByTestId(`add-choice-${groupId}`).click();
      await expect(page.getByTestId("choice-modal")).toBeVisible();
      await page.getByTestId("choice-name-input").fill(choiceName);
      // Required by the form; omitting it silently blocks submit via native
      // HTML validation, which surfaces only as "the POST never fired".
      await page
        .getByTestId("choice-public-id-input")
        .fill(`e2e-c-${Date.now().toString(36)}`);
      await page.getByTestId("choice-price-input").fill("15");

      const choiceCreated = page.waitForResponse(
        (response) =>
          response.url().includes(`/option-groups/${groupId}/choices`) &&
          response.request().method() === "POST",
      );
      await page.getByTestId("save-choice").click();
      const choiceResponse = await choiceCreated;
      expect(
        choiceResponse.ok(),
        `option choice create returned ${choiceResponse.status()}`,
      ).toBe(true);

      // Server-side truth: the group exists, carries the kind/type we chose,
      // and owns exactly the one choice.
      await expect
        .poll(
          async () => {
            const groups = await fetchGroups(restaurantId, token);
            const found = groups.find((group) => group.id === groupId);
            return found
              ? {
                  name: found.name,
                  kind: found.kind,
                  type: found.type,
                  choiceNames: (found.choices ?? []).map(
                    (choice) => choice.name,
                  ),
                }
              : undefined;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toEqual({
          name: groupName,
          kind: "addon",
          type: "multiple",
          choiceNames: [choiceName],
        });

      await assertNoOverlayError(page);
    } finally {
      if (groupId) {
        await apiCleanup(`/api/v1/menu/option-groups/${groupId}`, token);
      }
    }
  });

  test("owner marks a choice sold out and the server records it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    // Provision through the real API so the UI test starts from a known row.
    const groupResult = await apiRequest<OptionGroup>(
      `/api/v1/menu/${restaurantId}/option-groups`,
      {
        token,
        method: "POST",
        body: {
          name: e2eName("SoldOutGroup"),
          publicId: `e2e-so-${Date.now().toString(36)}`,
          kind: "addon",
          type: "multiple",
        },
      },
    );
    expect(
      groupResult.ok,
      `option group fixture returned ${groupResult.status}`,
    ).toBe(true);
    const groupId = groupResult.body.data?.id;

    const choiceResult = await apiRequest<OptionChoice>(
      `/api/v1/menu/option-groups/${groupId}/choices`,
      {
        token,
        method: "POST",
        // createOptionChoiceSchema is `.strict()`: publicId is required and
        // the price field is `priceAdjustment`, not `priceDelta`.
        body: {
          name: e2eName("SoldOutChoice"),
          publicId: `e2e-soc-${Date.now().toString(36)}`,
          priceAdjustment: 0,
        },
      },
    );
    expect(
      choiceResult.ok,
      `option choice fixture returned ${choiceResult.status}`,
    ).toBe(true);
    const choiceId = choiceResult.body.data?.id;

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/menu/option-groups", {
        expectApi: "/option-groups",
      });
      await assertAuthenticated(page);

      const toggle = page.getByTestId(`toggle-choice-${choiceId}`);
      await expect(toggle).toBeVisible();

      const toggled = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/option-choices/${choiceId}`) &&
          response.request().method() === "PATCH",
      );
      await toggle.click();
      const response = await toggled;
      expect(
        response.ok(),
        `choice availability toggle returned ${response.status()}`,
      ).toBe(true);

      await expect(
        page.getByTestId(`choice-soldout-${choiceId}`),
      ).toBeVisible();

      await expect
        .poll(
          async () => {
            const groups = await fetchGroups(restaurantId, token);
            const choice = groups
              .find((group) => group.id === groupId)
              ?.choices?.find((entry) => entry.id === choiceId);
            return choice?.isAvailable === true || choice?.isAvailable === 1;
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(false);

      await assertNoOverlayError(page);
    } finally {
      if (groupId) {
        await apiCleanup(`/api/v1/menu/option-groups/${groupId}`, token);
      }
    }
  });

  test("owner deletes a group and it leaves both the page and the database", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await requireStack();

    const { login, token, restaurantId } = await getOwnerContext();

    const groupResult = await apiRequest<OptionGroup>(
      `/api/v1/menu/${restaurantId}/option-groups`,
      {
        token,
        method: "POST",
        body: {
          name: e2eName("DeleteGroup"),
          publicId: `e2e-del-${Date.now().toString(36)}`,
          kind: "choice",
          type: "single",
        },
      },
    );
    const groupId = groupResult.body.data?.id;
    let deleted = false;

    await installAdminSession(page, login);

    try {
      await gotoAdmin(page, "/dashboard/menu/option-groups", {
        expectApi: "/option-groups",
      });
      await assertAuthenticated(page);
      await expect(page.getByTestId(`option-group-${groupId}`)).toBeVisible();

      // Destructive actions go through the app's own ConfirmModal
      // (components/common/ConfirmModal.vue), not window.confirm — there is no
      // dialog event to intercept. Matching its confirm button by accessible
      // name does not work either: every group row also renders a "Delete"
      // button, so the name is ambiguous. The component now carries
      // data-testid hooks (added with this suite) for exactly that reason.
      await page.getByTestId(`delete-group-${groupId}`).click();
      await expect(page.getByTestId("confirm-modal")).toBeVisible();
      const confirmButton = page.getByTestId("confirm-modal-confirm");

      const removed = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/menu/option-groups/${groupId}`) &&
          response.request().method() === "DELETE",
      );
      await confirmButton.click();
      const response = await removed;
      expect(
        response.ok(),
        `option group delete returned ${response.status()}`,
      ).toBe(true);
      deleted = true;

      await expect(page.getByTestId(`option-group-${groupId}`)).toHaveCount(0);

      await expect
        .poll(
          async () => {
            const groups = await fetchGroups(restaurantId, token);
            return groups.some((group) => group.id === groupId);
          },
          { timeout: POLL_TIMEOUT },
        )
        .toBe(false);

      await assertNoOverlayError(page);
    } finally {
      // Only if the UI did not already do it — a redundant DELETE would mask a
      // failed one.
      if (!deleted && groupId) {
        await apiCleanup(`/api/v1/menu/option-groups/${groupId}`, token);
      }
    }
  });
});
