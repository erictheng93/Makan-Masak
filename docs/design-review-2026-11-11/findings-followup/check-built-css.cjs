const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const root = path.resolve(__dirname, "../../..");
const apps = process.env.REVIEW_APP
  ? [process.env.REVIEW_APP]
  : [
      "customer-app",
      "admin-dashboard",
      "kitchen-display",
      "management-portal",
      "onboarding-app",
    ];
async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const app of apps) {
      const dist = path.join(root, "apps", app, "dist");
      const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
      const styles = [...html.matchAll(/<link[^>]*href="([^"]+\.css)"[^>]*>/g)]
        .map((m) =>
          fs.readFileSync(path.join(dist, m[1].replace(/^\//, "")), "utf8"),
        )
        .join("\n");
      if (!styles) throw new Error(`Missing built CSS for ${app}`);
      for (const width of [390, 1100]) {
        const page = await browser.newPage({
          viewport: { width, height: 844 },
        });
        await page.setContent(
          `<style>${styles}</style><div style="padding:24px"><div id="mobile" class="ui-toolbar flex sm:hidden">Mobile pagination</div><div id="desktop" class="ui-toolbar hidden sm:flex">Desktop pagination</div><div class="text-center"><h1 id="heading" class="ui-page-heading text-2xl">Sign in</h1></div><button id="switch" role="switch" aria-checked="false" aria-label="Auto accept" class="relative inline-flex h-6 w-11 items-center rounded-full bg-gray-200"><span class="h-4 w-4 rounded-full bg-white"></span></button><button id="action" class="min-h-11">Action</button></div>`,
        );
        const actual = await page.evaluate(() => {
          const css = (id) => getComputedStyle(document.getElementById(id));
          const button = document.getElementById("switch");
          const rect = button.getBoundingClientRect();
          return {
            mobile: css("mobile").display !== "none",
            desktop: css("desktop").display !== "none",
            heading: css("heading").display,
            switchWidth: rect.width,
            switchHeight: rect.height,
            expandedSwitchHit: button.contains(
              document.elementFromPoint(rect.x + rect.width / 2, rect.y - 8),
            ),
            actionHeight: document
              .getElementById("action")
              .getBoundingClientRect().height,
          };
        });
        const hasPaginationUtilities =
          styles.includes(".sm\\:hidden") && styles.includes(".sm\\:flex");
        const hasSwitchUtilities =
          styles.includes(".w-11") && styles.includes(".h-6");
        const pass =
          (!hasPaginationUtilities ||
            (actual.mobile === width < 640 &&
              actual.desktop === width >= 640)) &&
          actual.heading === "block" &&
          (!hasSwitchUtilities ||
            (actual.switchWidth > actual.switchHeight * 1.4 &&
              actual.expandedSwitchHit)) &&
          actual.actionHeight >= 44;
        results.push({
          app,
          width,
          hasPaginationUtilities,
          hasSwitchUtilities,
          actual,
          pass,
        });
        await page.screenshot({
          path: path.join(
            __dirname,
            `${process.env.CSS_REPORT ? path.basename(process.env.CSS_REPORT, ".json") + "-" : ""}${app}-built-css-${width}.png`,
          ),
        });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(
    path.join(__dirname, process.env.CSS_REPORT || "built-css-checks.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      checked: results.length,
      passed: results.filter((r) => r.pass).length,
      results,
    }),
  );
  if (results.some((r) => !r.pass)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
