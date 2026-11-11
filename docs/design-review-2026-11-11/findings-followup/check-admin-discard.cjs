const assert = require("node:assert/strict");
const {
  chromium,
  installReviewData,
  fs,
  path,
} = require("../implementation/local-review-data.cjs");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [1100, 390])
      for (const kind of ["options", "shifts"]) {
        const context = await browser.newContext({
          viewport: { width, height: 844 },
          locale: "zh-TW",
          reducedMotion: "reduce",
        });
        await installReviewData(context, "admin-dashboard");
        if (kind === "shifts") {
          const workDate = new Date(Date.now() + 86400000)
            .toISOString()
            .slice(0, 10);
          await context.route(
            /\/scheduling\/[^/]+\/(schedules|swap-requests)(?:\?|$)/,
            (route) =>
              route.fulfill({
                json: {
                  success: true,
                  data: new URL(route.request().url()).pathname.endsWith(
                    "schedules",
                  )
                    ? [
                        {
                          id: 41,
                          restaurantId: "demo-restaurant",
                          employeeId: 1,
                          workDate,
                          startTime: "09:00",
                          endTime: "17:00",
                          scheduledHours: 8,
                          status: "scheduled",
                        },
                      ]
                    : [],
                },
              }),
          );
        }
        const page = await context.newPage();
        const route = kind === "options" ? "menu/option-groups" : "my-shifts";
        await page.goto(`http://127.0.0.1:4411/dashboard/${route}`, {
          waitUntil: "networkidle",
        });
        await page
          .getByTestId(kind === "options" ? "add-group" : "request-swap-button")
          .click();
        const input = page.getByTestId(
          kind === "options" ? "group-name-input" : "swap-reason",
        );
        await input.fill("鍵盤取消確認");
        await page.keyboard.press("Escape");
        const confirmation = page.getByTestId("confirm-modal");
        await confirmation.waitFor();
        await page.waitForFunction(
          () =>
            document.activeElement?.getAttribute("data-testid") ===
            "confirm-modal-cancel",
          null,
          { timeout: 3000 },
        );
        assert.ok(
          await confirmation.getAttribute("aria-labelledby"),
          "Confirmation must have a name",
        );
        await page.keyboard.press("Shift+Tab");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("data-testid"),
          ),
          "confirm-modal-confirm",
        );
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.getAttribute("data-testid"),
          ),
          "confirm-modal-cancel",
        );
        const imageDir = path.join(__dirname, "admin-discard-screenshots");
        fs.mkdirSync(imageDir, { recursive: true });
        await page.screenshot({
          path: path.join(imageDir, `${kind}-${width}.png`),
        });
        await page.keyboard.press("Escape");
        await confirmation.waitFor({ state: "detached" });
        await page.waitForFunction(
          (element) => document.activeElement === element,
          await input.elementHandle(),
        );
        assert.equal(await input.inputValue(), "鍵盤取消確認");
        await page.keyboard.press("Escape");
        await confirmation.waitFor();
        await page.keyboard.press("Escape");
        await confirmation.waitFor({ state: "detached" });
        await page.waitForFunction(
          (element) => document.activeElement === element,
          await input.elementHandle(),
        );
        await page.keyboard.press("Escape");
        await confirmation.waitFor();
        await page.getByTestId("confirm-modal-confirm").click();
        await page
          .getByTestId(kind === "options" ? "group-modal" : "swap-form")
          .waitFor({ state: "detached" });
        results.push({
          kind,
          width,
          initialFocus: true,
          tabContained: true,
          escapeKeepsEdit: true,
          focusReturned: true,
          repeatedEscapeThenDiscard: true,
        });
        await context.close();
      }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(__dirname, "admin-discard-browser.json"),
    JSON.stringify({ pass: true, results }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ pass: true, results }));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
