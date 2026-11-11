const assert = require("node:assert/strict");
const {
  chromium,
  installReviewData,
  fs,
  path,
} = require("../implementation/local-review-data.cjs");
const checks = [];

async function sample(page, action) {
  await page.evaluate(() => {
    window.motionSamples = [];
    window.motionComplete = false;
    let count = 0;
    function frame() {
      const dialog = document.querySelector('[role="dialog"]');
      const panel = dialog?.querySelector('[id^="headlessui-dialog-panel"]');
      window.motionSamples.push({
        visible: Boolean(dialog),
        title: dialog?.querySelector("h2,h3")?.textContent.trim(),
        duration: panel ? getComputedStyle(panel).transitionDuration : "0s",
        moving: document
          .getAnimations()
          .some((animation) =>
            ["opacity", "transform"].includes(animation.transitionProperty),
          ),
      });
      if (++count < 36) requestAnimationFrame(frame);
      else window.motionComplete = true;
    }
    requestAnimationFrame(frame);
  });
  await action();
  await page.waitForFunction(() => window.motionComplete);
  return page.evaluate(() => window.motionSamples);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion,
      });
      await installReviewData(context, "kitchen-display");
      const page = await context.newPage();
      for (const [name, route, trigger] of [
        ["urgent", "/settings", /緊急時間/],
        ["refresh", "/settings", /自動刷新間隔/],
        ["sound", "/settings", /通知音效/],
        ["confirmation", "/settings", /^恢復預設$/],
        ["order-details", "/kitchen/demo-restaurant", /查看詳情/],
      ]) {
        await page.goto(`http://127.0.0.1:4412${route}`, {
          waitUntil: "networkidle",
        });
        const opener = page.getByRole("button", { name: trigger }).first();
        const enter = await sample(page, () => opener.click());
        assert.ok(
          enter.some((frame) => frame.visible && frame.title),
          `${name}: named content opens`,
        );
        if (reducedMotion === "no-preference")
          assert.ok(
            enter.some((frame) => frame.moving),
            `${name}: real enter animation`,
          );
        else
          assert.ok(
            enter
              .filter((frame) => frame.visible)
              .every((frame) =>
                frame.duration
                  .split(",")
                  .every((value) => parseFloat(value) <= 0.001),
              ),
            `${name}: respects reduced motion`,
          );
        const leave = await sample(page, () => page.keyboard.press("Escape"));
        if (reducedMotion === "no-preference")
          assert.ok(
            leave.some((frame) => frame.visible && frame.title && frame.moving),
            `${name}: content survives real leave animation`,
          );
        assert.equal(
          await page.getByRole("dialog").count(),
          0,
          `${name}: closes after leave`,
        );
        assert.equal(
          await opener.evaluate(
            (element) => element === document.activeElement,
          ),
          true,
          `${name}: focus returns to opener`,
        );
        checks.push({
          name,
          reducedMotion,
          enterMoving: enter.some((frame) => frame.moving),
          leaveMoving: leave.some((frame) => frame.moving),
          pass: true,
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(__dirname, "other-apps-browser.json"),
    JSON.stringify({ checks, passed: checks.length }, null, 2) + "\n",
  );
  console.log(`${checks.length}/10 real-browser motion scenarios passed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
