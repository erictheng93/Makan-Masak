const assert = require("node:assert/strict");
const {
  chromium,
  installReviewData,
  out,
  fs,
  path,
  manifest,
  routePath,
} = require("./local-review-data.cjs");
const results = {
  method:
    "Real production components in an isolated browser with local example responses; no production service writes.",
  checks: [],
  errors: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(out, "interaction-checks.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
const screenshotDir = path.join(out, "interaction-screenshots");
fs.mkdirSync(screenshotDir, { recursive: true });
function check(name, value, details) {
  results.checks.push({ name, pass: Boolean(value), details });
  assert.ok(value, name);
}

async function dialogCheck(page, trigger, label) {
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "attached" });
  await dialog
    .locator("button:visible,input:visible,select:visible,textarea:visible")
    .first()
    .waitFor();
  check(
    `${label}: named dialog`,
    Boolean(await dialog.getAttribute("aria-labelledby")) ||
      Boolean(await dialog.getAttribute("aria-label")),
  );
  check(
    `${label}: initial focus inside`,
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  );
  const controls = dialog.locator(
    "button:visible:not([disabled]), input:visible:not([disabled]), select:visible:not([disabled]), textarea:visible:not([disabled]), a[href]:visible",
  );
  await controls.last().focus();
  await page.keyboard.press("Tab");
  check(
    `${label}: Tab contained`,
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  );
  await page.screenshot({
    path: path.join(screenshotDir, `${label}.png`),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  await page.waitForFunction(
    (element) => element === document.activeElement,
    await trigger.elementHandle(),
  );
  check(
    `${label}: trigger focus restored`,
    await trigger.evaluate((element) => element === document.activeElement),
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const scenario = async (app, route, width, name, run) => {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      locale: "zh-TW",
      serviceWorkers: "block",
      reducedMotion: "reduce",
    });
    await installReviewData(context, app);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const jsErrors = [];
    page.on("pageerror", (error) => jsErrors.push(error.message));
    try {
      const port =
        4410 +
        [
          "customer-app",
          "admin-dashboard",
          "kitchen-display",
          "management-portal",
          "onboarding-app",
        ].indexOf(app);
      await page.goto(`http://127.0.0.1:${port}${route}`, {
        waitUntil: "networkidle",
      });
      await run(page);
      check(`${name}: no JavaScript errors`, jsErrors.length === 0, jsErrors);
    } catch (error) {
      results.errors.push({ name, message: error.message });
    } finally {
      await context.close();
      save();
    }
  };
  try {
    for (const width of [1100, 390]) {
      await scenario(
        "customer-app",
        "/",
        width,
        `customer-entry-${width}`,
        async (page) => {
          await dialogCheck(
            page,
            page.getByTestId("manual-input-btn"),
            `customer-manual-${width}`,
          );
          await page
            .getByRole("link", { name: "探索美食", exact: true })
            .click();
          await page.waitForURL("**/discover");
          check(
            `customer-entry-${width}: real router navigation`,
            new URL(page.url()).pathname === "/discover",
          );
        },
      );
      await scenario(
        "customer-app",
        "/restaurant/demo-restaurant/table/1",
        width,
        `customer-cart-${width}`,
        async (page) => {
          await page
            .getByRole("button", { name: "加入", exact: true })
            .first()
            .click();
          const add = page
            .getByRole("dialog")
            .getByRole("button", { name: /加入/ });
          if (await add.count()) await add.last().click();
          await page
            .getByRole("button", { name: /購物車/ })
            .last()
            .click();
          await page.waitForURL("**/cart**");
          const quantity = page
            .locator('[data-testid^="cart-item-quantity-"]')
            .first();
          const before = Number(await quantity.textContent());
          await page.locator('[data-testid^="qty-increase-"]').first().click();
          check(
            `customer-cart-${width}: real quantity handler`,
            Number(await quantity.textContent()) === before + 1,
          );
          const footer = page.locator(".customer-checkout-footer");
          check(
            `customer-cart-${width}: footer visible`,
            await footer.isVisible(),
          );
          const clearance = await page.evaluate(() => {
            const footer = document.querySelector(".customer-checkout-footer");
            const main = document.querySelector(".customer-shell main");
            return {
              reserved: parseFloat(getComputedStyle(main).paddingBottom),
              footer: footer.getBoundingClientRect().height,
            };
          });
          check(
            `customer-cart-${width}: content clears measured footer`,
            clearance.reserved >= clearance.footer,
            clearance,
          );
        },
      );
      for (const view of ["MenuView", "ShopMenuView"]) {
        const record = manifest.routes.find(
          (item) =>
            item.file === `apps/customer-app/src/views/${view}.vue` &&
            item.origin !== "live" &&
            !item.variant,
        );
        await scenario(
          "customer-app",
          routePath(record),
          width,
          `menu-bottom-${view}-${width}`,
          async (page) => {
            await page
              .locator("main")
              .getByRole("button", { name: "加入", exact: true })
              .first()
              .click();
            const dialogAdd = page
              .getByRole("dialog")
              .getByRole("button", { name: /加入/ });
            if (await dialogAdd.count()) await dialogAdd.last().click();
            await page.evaluate(() => {
              document.scrollingElement.scrollTop =
                document.scrollingElement.scrollHeight;
            });
            const lastAdd = page
              .locator("main")
              .getByRole("button", { name: "加入", exact: true })
              .last();
            await page.waitForFunction(
              (element) => {
                document.scrollingElement.scrollTop =
                  document.scrollingElement.scrollHeight;
                const rect = element.getBoundingClientRect();
                return (
                  rect.bottom <= innerHeight &&
                  element.contains(
                    document.elementFromPoint(
                      rect.x + rect.width / 2,
                      rect.y + rect.height / 2,
                    ),
                  )
                );
              },
              await lastAdd.elementHandle(),
            );
            const exposed = await lastAdd.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return {
                bottom: rect.bottom,
                viewport: innerHeight,
                hit: element.contains(
                  document.elementFromPoint(
                    rect.x + rect.width / 2,
                    rect.y + rect.height / 2,
                  ),
                ),
              };
            });
            check(
              `menu-bottom-${view}-${width}: final Add is exposed`,
              exposed.hit && exposed.bottom <= exposed.viewport,
              exposed,
            );
            const countBefore = Number(
              await page.getByTestId("cart-count").first().textContent(),
            );
            await lastAdd.click();
            const countAfter = Number(
              await page.getByTestId("cart-count").first().textContent(),
            );
            check(
              `menu-bottom-${view}-${width}: final Add opens item choices or updates cart`,
              (await page.getByRole("dialog").count()) > 0 ||
                countAfter > countBefore,
            );
            await page.screenshot({
              path: path.join(
                screenshotDir,
                `menu-bottom-${view}-${width}.png`,
              ),
              animations: "disabled",
            });
          },
        );
      }
      await scenario(
        "admin-dashboard",
        "/dashboard/menu/option-groups",
        width,
        `admin-dialog-${width}`,
        async (page) => {
          await dialogCheck(
            page,
            page.getByTestId("add-group"),
            `admin-option-group-${width}`,
          );
        },
      );
      await scenario(
        "kitchen-display",
        "/settings",
        width,
        `kitchen-settings-${width}`,
        async (page) => {
          const toggle = page.getByRole("switch").first();
          const previous = await toggle.getAttribute("aria-checked");
          await toggle.click();
          check(
            `kitchen-settings-${width}: switch updates real state`,
            (await toggle.getAttribute("aria-checked")) !== previous,
          );
          await dialogCheck(
            page,
            page.getByRole("button", { name: /緊急時間/ }),
            `kitchen-threshold-${width}`,
          );
        },
      );
      await scenario(
        "management-portal",
        "/licenses",
        width,
        `portal-dialog-${width}`,
        async (page) => {
          await dialogCheck(
            page,
            page.getByRole("button", { name: "生成授權", exact: true }).first(),
            `portal-license-${width}`,
          );
        },
      );
      await scenario(
        "onboarding-app",
        "/apply",
        width,
        `onboarding-form-${width}`,
        async (page) => {
          const form = page.locator("form");
          await page.getByTestId("onboarding-submit").click();
          await page.locator('[aria-invalid="true"]').first().waitFor();
          check(
            `onboarding-form-${width}: empty required form rejected`,
            (await page.locator('[aria-invalid="true"]').count()) > 0,
          );
          const labels = await page
            .getByTestId("onboarding-business-name")
            .evaluate((element) =>
              [...element.labels].map((label) => label.textContent.trim()),
            );
          check(
            `onboarding-form-${width}: visible associated field labels`,
            labels.length > 0 && Boolean(labels[0]),
          );
          await page.getByTestId("onboarding-country").selectOption("TW");
          check(
            `onboarding-form-${width}: country enables city`,
            await page.getByTestId("onboarding-city").isEnabled(),
          );
          await page
            .getByTestId("onboarding-market")
            .selectOption("")
            .catch(() => {});
          await page.screenshot({
            path: path.join(screenshotDir, `onboarding-form-${width}.png`),
            animations: "disabled",
          });
        },
      );
    }
    await scenario(
      "kitchen-display",
      "/kitchen/demo-restaurant",
      390,
      "kitchen-language",
      async (page) => {
        await page.locator("header button[aria-expanded]").click();
        const option = page.getByRole("button", { name: /English/ });
        await option.waitFor();
        const reachable = await option.evaluate((element) => {
          const rectangle = element.getBoundingClientRect();
          const target = document.elementFromPoint(
            rectangle.x + rectangle.width / 2,
            rectangle.y + rectangle.height / 2,
          );
          return element === target || element.contains(target);
        });
        check("kitchen-language: popup not clipped on phone", reachable);
        await option.click();
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .waitFor();
        check("kitchen-language: actual locale changes", true);
      },
    );
    await scenario(
      "admin-dashboard",
      "/dashboard/employees/1",
      390,
      "employee-long-identifier",
      async (page) => {
        const email = page
          .getByText(
            "employee.with.a.very.long.address.without.breaks@example-restaurant.test",
            { exact: true },
          )
          .first();
        await email.waitFor();
        const size = await email.evaluate((element) => ({
          page: document.documentElement.scrollWidth,
          viewport: innerWidth,
          content: element.scrollWidth,
          parent: element.parentElement.clientWidth,
        }));
        check(
          "employee-long-identifier: phone page stays within viewport",
          size.page <= size.viewport + 2,
          size,
        );
        check(
          "employee-long-identifier: email wraps within card",
          size.content <= size.parent + 2,
          size,
        );
        await page.screenshot({
          path: path.join(screenshotDir, "employee-long-identifier-mobile.png"),
          fullPage: true,
          animations: "disabled",
        });
      },
    );
  } finally {
    await browser.close();
  }
  results.finishedAt = new Date().toISOString();
  results.summary = {
    checks: results.checks.length,
    passed: results.checks.filter((check) => check.pass).length,
    failures: results.checks.filter((check) => !check.pass).length,
    scenarioErrors: results.errors.length,
  };
  save();
  console.log(JSON.stringify(results.summary));
  if (results.errors.length || results.summary.failures) process.exitCode = 1;
}
main().catch((error) => {
  results.errors.push({ message: error.stack });
  save();
  console.error(error);
  process.exitCode = 1;
});
