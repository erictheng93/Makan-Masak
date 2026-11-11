import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../..");
const target = process.env.PREVIEW_URL || "http://127.0.0.1:4320/preview.html";
const qaDir = path.join(dir, "baseline/qa");
fs.mkdirSync(qaDir, { recursive: true });
const hash = () =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(dir, "preview.html")))
    .digest("hex");
const result = {
  startedAt: new Date().toISOString(),
  url: target,
  startHash: hash(),
  status: "in-progress",
  checks: [],
  pages: [],
  errors: [],
  consoleErrors: [],
  externalRequests: [],
  fidelity: [],
  screenshots: [],
};
const save = () =>
  fs.writeFileSync(
    path.join(dir, "baseline/preview-check.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
function check(name, pass, details) {
  result.checks.push({
    name,
    pass,
    ...(details === undefined ? {} : { details }),
  });
  if (!pass) console.log("FAIL", name, JSON.stringify(details)?.slice(0, 350));
}
const walk = (p) =>
  fs
    .readdirSync(p, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(p, e.name))
        : e.name.endsWith(".vue")
          ? [path.relative(root, path.join(p, e.name))]
          : [],
    );
const sources = [
  "customer-app",
  "admin-dashboard",
  "kitchen-display",
  "management-portal",
  "onboarding-app",
]
  .flatMap((a) => walk(path.join(root, "apps", a, "src/views")))
  .sort();
const audits = ["customer-audit.json", "operations-audit.json"].flatMap((f) => {
  const a = JSON.parse(fs.readFileSync(path.join(dir, f)));
  return Array.isArray(a) ? a : a.pages;
});
check(
  "exact source inventory",
  JSON.stringify(sources) === JSON.stringify(audits.map((a) => a.file).sort()),
  {
    sources: sources.length,
    proposals: audits.length,
    missing: sources.filter((f) => !audits.some((a) => a.file === f)),
    extra: audits.filter((a) => !sources.includes(a.file)).map((a) => a.file),
  },
);
const badLines = audits.flatMap((a) => {
  const n = fs.readFileSync(path.join(root, a.file), "utf8").split("\n").length;
  return a.issues
    .filter((i) => !Number.isInteger(i.line) || i.line < 1 || i.line > n)
    .map((i) => ({ file: a.file, line: i.line, max: n }));
});
check("metadata line ranges", badLines.length === 0, badLines);
const baseline = JSON.parse(
  fs.readFileSync(path.join(dir, "baseline-manifest.json")),
);
const invalidCaptures = [];
const captureFormats = { png: 0, jpeg: 0 };
for (const r of baseline.routes.filter((r) => r.screenshot)) {
  const f = path.join(dir, r.screenshot);
  try {
    const b = fs.readFileSync(f);
    if (/\.jpe?g$/i.test(f)) {
      captureFormats.jpeg++;
      if (
        b.length < 1000 ||
        b[0] !== 255 ||
        b[1] !== 216 ||
        b[2] !== 255 ||
        b[b.length - 2] !== 255 ||
        b[b.length - 1] !== 217
      )
        invalidCaptures.push({
          file: r.screenshot,
          reason: "JPEG signature/end marker invalid",
        });
    } else {
      captureFormats.png++;
      if (
        b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        b.readUInt32BE(16) !== r.viewport.width ||
        b.readUInt32BE(20) !== r.viewport.height
      )
        invalidCaptures.push({
          file: r.screenshot,
          reason: "PNG signature/dimensions mismatch",
        });
    }
  } catch (e) {
    invalidCaptures.push({ file: r.screenshot, reason: e.message });
  }
}
check("baseline image validity", invalidCaptures.length === 0, {
  files: new Set(baseline.routes.map((r) => r.screenshot).filter(Boolean)).size,
  formats: captureFormats,
  note: "PNG pixel dimensions match logical viewport; live JPEG files may use device pixel ratio 2, so verify JPEG markers and logical viewport metadata separately.",
  invalid: invalidCaptures,
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-TW",
  });
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname)) {
      result.externalRequests.push(u.origin + u.pathname);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", (e) =>
    result.errors.push({ message: e.message, phase: result.phase }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      result.consoleErrors.push({
        message: m.text().slice(0, 500),
        phase: result.phase,
      });
  });
  await page.goto(target, { waitUntil: "load" });
  await page.waitForTimeout(150);
  const inventory = await page.evaluate(() =>
    REVIEW.pages.map(({ id, file, app, title }) => ({ id, file, app, title })),
  );
  check(
    "runtime inventory matches source",
    JSON.stringify(inventory.map((p) => p.file).sort()) ===
      JSON.stringify(sources),
    { count: inventory.length },
  );
  async function select(item) {
    await page.evaluate(
      (id) =>
        new Promise((resolve) => {
          document
            .querySelector("#proposal")
            .addEventListener("load", () => resolve(), { once: true });
          selectPage(pages.find((p) => p.id === id));
        }),
      item.id,
    );
    return await (
      await page.locator("#proposal").elementHandle()
    ).contentFrame();
  }
  async function setDevice(device) {
    await page.locator(`[data-device="${device}"]`).click();
    await page.waitForTimeout(30);
  }
  const representative = {
    "customer-app": "MenuView",
    "admin-dashboard": "OrdersView",
    "kitchen-display": "EnhancedKitchenDashboard",
    "management-portal": "DashboardView",
    "onboarding-app": "ApplyView",
  };
  for (const device of ["desktop", "mobile"]) {
    await page.setViewportSize({
      width: device === "mobile" ? 390 : 1440,
      height: device === "mobile" ? 844 : 1000,
    });
    await setDevice(device);
    for (const item of inventory) {
      result.phase = `${device}:${item.id}`;
      const beforeErrors = result.errors.length;
      const frame = await select(item);
      const inspected = await frame.evaluate(async () => {
        const decodeIssues = [];
        await Promise.all(
          [...document.images].map(async (image) => {
            image.loading = "eager";
            try {
              await image.decode();
            } catch {
              decodeIssues.push(image.getAttribute("src")?.slice(0, 100));
            }
          }),
        );
        const d = document.documentElement,
          b = document.body;
        return {
          width: innerWidth,
          scrollWidth: d.scrollWidth,
          bodyText: b.innerText.trim().length,
          bodyHeight: b.getBoundingClientRect().height,
          heading: b.querySelector("h1,h2")?.textContent,
          brokenImages: decodeIssues,
          overflowElements: [...b.querySelectorAll("*")]
            .filter((e) => {
              const r = e.getBoundingClientRect();
              if (
                r.width === 0 ||
                r.right <= innerWidth + 2 ||
                r.left >= innerWidth
              )
                return false;
              let p = e.parentElement;
              while (p && p !== b) {
                const c = getComputedStyle(p);
                if (["auto", "scroll", "hidden", "clip"].includes(c.overflowX))
                  return false;
                p = p.parentElement;
              }
              return true;
            })
            .slice(0, 6)
            .map((e) => ({
              tag: e.tagName,
              class: e.className,
              right: Math.round(e.getBoundingClientRect().right),
            })),
        };
      });
      const outer = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        broken: [...document.images].filter(
          (i) => i.complete && i.naturalWidth === 0,
        ).length,
        original: !!document.querySelector("#original-content img"),
      }));
      const row = {
        id: item.id,
        app: item.app,
        file: item.file,
        device,
        viewport: inspected.width,
        ...inspected,
        outer,
        jsErrors: result.errors.length - beforeErrors,
        pass:
          inspected.bodyText > 40 &&
          inspected.bodyHeight > 50 &&
          inspected.scrollWidth <= inspected.width + 2 &&
          outer.scrollWidth <= outer.width + 2 &&
          inspected.brokenImages.length === 0 &&
          outer.broken === 0 &&
          outer.original &&
          result.errors.length === beforeErrors,
      };
      result.pages.push(row);
      if (!row.pass)
        console.log(
          "PAGE FAIL",
          item.id,
          device,
          JSON.stringify(row).slice(0, 550),
        );
      if (item.file.endsWith("/" + representative[item.app] + ".vue")) {
        const name = `${item.app}-${device}.png`;
        await page.screenshot({
          path: path.join(qaDir, name),
          fullPage: false,
        });
        result.screenshots.push("baseline/qa/" + name);
      }
      save();
    }
    console.log("Scanned", device, inventory.length);
  }
  // Workbench interactions use real visible controls.
  result.phase = "workbench interactions";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setDevice("desktop");
  await page.locator("#page-search").fill("MenuView");
  check(
    "catalog search",
    (await page.locator(".page-link").count()) > 0 &&
      (await page.locator(".page-link").count()) < inventory.length,
  );
  await page.locator("#page-search").fill("no-such-page-qa");
  check(
    "empty search state",
    (await page.locator(".empty-search").count()) === 1,
  );
  await page.locator("#all-apps").click();
  await page.locator('[data-app="management-portal"]').click();
  check(
    "app filter",
    (await page.locator(".page-link").count()) ===
      inventory.filter((p) => p.app === "management-portal").length,
  );
  const first = await page.locator("#page-title").textContent();
  await page.locator("#next").click();
  check(
    "next navigation",
    (await page.locator("#page-title").textContent()) !== first,
  );
  await page.locator("#prev").click();
  check(
    "previous navigation",
    (await page.locator("#page-title").textContent()) === first,
  );
  await page.locator("#all-apps").click();
  await page.locator('[data-view="after"]').click();
  check("after compare mode", await page.locator(".before-pane").isHidden());
  await page.locator('[data-view="before"]').click();
  check("before compare mode", await page.locator(".after-pane").isHidden());
  await page.locator('[data-view="compare"]').click();
  check(
    "side by side mode",
    (await page.locator(".before-pane").isVisible()) &&
      (await page.locator(".after-pane").isVisible()),
  );
  await page.locator("#method-button").click();
  check(
    "method dialog opens",
    await page.locator("#method-dialog").evaluate((e) => e.open),
  );
  await page.keyboard.press("Escape");
  check(
    "method dialog Escape",
    !(await page.locator("#method-dialog").evaluate((e) => e.open)),
  );
  const interactiveSelect = async (item) => {
    const frame = await select(item);
    await page.locator(".proposal-viewport").scrollIntoViewIfNeeded();
    return frame;
  };
  const find = (app, leaf) =>
    inventory.find(
      (p) => p.app === app && p.file.endsWith("/" + leaf + ".vue"),
    );
  const livePages = await page.evaluate(() =>
    pages
      .filter((p) => p.captures.some((c) => c.origin === "live"))
      .map((p) => p.id),
  );
  for (const id of livePages) {
    await select(inventory.find((p) => p.id === id));
    const selector = page.locator("#capture-selector");
    check(
      "capture variants available:" + id,
      (await selector.locator("option").count()) > 1,
    );
    for (const value of await selector
      .locator("option")
      .evaluateAll((es) => es.map((e) => e.value))) {
      await selector.selectOption(value);
      const originalValid = await page
        .locator("#original-content img")
        .evaluate(async (e) => {
          await e.decode().catch(() => {});
          return e.complete && e.naturalWidth > 0;
        });
      check("capture selector image:" + id + ":" + value, originalValid);
    }
  }
  let f = await interactiveSelect(find("customer-app", "MenuView"));
  await f.locator("[data-add]").first().click();
  check(
    "menu addition counter",
    (await f.locator("[data-cart-count]").textContent()).includes("1"),
  );
  check(
    "menu addition sum",
    (await f.locator("[data-cart-total]").textContent()).includes("160"),
  );
  // Navigate by its user-facing control, then observe continuity.
  await f.locator('[data-nav="CartView"]').click();
  await page.waitForTimeout(100);
  f = await (await page.locator("#proposal").elementHandle()).contentFrame();
  const cartAfterMenu = await f.locator("[data-grandtotal]").textContent();
  check(
    "menu to cart continuity",
    Number(cartAfterMenu.replace(/[^\d.]/g, "")) === 160,
    { cartAfterMenu },
  );
  if (!cartAfterMenu.includes("160"))
    result.fidelity.push({
      id: "cart-continuity",
      severity: "high",
      finding: `加入一份NT$160餐點後進入購物車，總價為${cartAfterMenu}，購物車仍顯示固定範例內容。`,
    });
  f = await interactiveSelect(find("customer-app", "CartView"));
  const totalBefore = Number(
    (await f.locator("[data-grandtotal]").textContent()).replace(/[^\d.]/g, ""),
  );
  const unitPrice = Number(
    await f.locator(".cart-line").first().getAttribute("data-price"),
  );
  await f.locator('[data-step="1"]').first().click();
  const expectedTotal = totalBefore + unitPrice;
  check(
    "cart quantity recalculation",
    Number(
      (await f.locator("[data-grandtotal]").textContent()).replace(
        /[^\d.]/g,
        "",
      ),
    ) === expectedTotal,
    { totalBefore, unitPrice, expectedTotal },
  );
  try {
    await f.locator("[data-submit-order]").click({ timeout: 2000 });
    check("checkout pointer access", true);
  } catch (e) {
    check("checkout pointer access", false, e.message.split("Call log:")[0]);
    result.fidelity.push({
      id: "checkout-overlay",
      severity: "high",
      finding: "購物車送出按鈕被固定示意資料狀態工具列遮擋，滑鼠無法按下。",
    });
    await f.locator("[data-submit-order]").focus();
    await f.locator("[data-submit-order]").press("Enter");
  }
  check(
    "checkout is local demo",
    (await f.locator(".toast").textContent()).includes("不會產生正式訂單"),
  );
  f = await interactiveSelect(
    find("kitchen-display", "EnhancedKitchenDashboard"),
  );
  const headerBefore = await f.locator(".kitchen-counters").textContent();
  await f.locator('[data-column="0"] [data-move-ticket]').first().click();
  check(
    "kitchen ticket moves",
    (await f.locator('[data-column="0"] [data-ticket]').count()) === 2 &&
      (await f.locator('[data-column="1"] [data-ticket]').count()) === 3,
  );
  check(
    "kitchen column counts",
    (await f.locator('[data-column="0"] .kanban-count').textContent()) === "2",
  );
  check(
    "kitchen header counts refresh",
    (await f.locator(".kitchen-counters").textContent()) !== headerBefore,
  );
  if ((await f.locator(".kitchen-counters").textContent()) === headerBefore)
    result.fidelity.push({
      id: "kitchen-summary",
      severity: "medium",
      finding: "工單從待處理移至製作中，欄位數字更新為2與3，頁首摘要仍是3與2。",
    });
  f = await interactiveSelect(find("onboarding-app", "ApplyView"));
  const form = f.locator("[data-preview-form]").first();
  check(
    "empty required form invalid",
    !(await form.evaluate((e) => e.checkValidity())),
  );
  const country = form.locator("[data-onboarding-country]");
  if (await country.count()) {
    check(
      "city initially gated",
      await form.locator("[data-onboarding-city]").isDisabled(),
    );
    await country.selectOption({ label: "台灣" });
    check(
      "country enables city",
      !(await form.locator("[data-onboarding-city]").isDisabled()),
    );
    await form
      .locator("[data-onboarding-city]")
      .selectOption({ label: "台北市" });
  }
  await form.locator("input,select,textarea").evaluateAll((els) => {
    for (const e of els) {
      if (
        e.disabled ||
        e.closest("[hidden]") ||
        e.hasAttribute("data-onboarding-country") ||
        e.hasAttribute("data-onboarding-city")
      )
        continue;
      if (e.tagName === "SELECT") {
        if (e.required && !e.value)
          e.selectedIndex = e.options.length > 1 ? 1 : 0;
      } else if (e.type === "checkbox") e.checked = true;
      else if (e.type === "email") e.value = "qa@example.test";
      else if (e.type === "number")
        e.value = e.closest("label")?.textContent.includes("緯度")
          ? "25.03"
          : e.closest("label")?.textContent.includes("經度")
            ? "121.56"
            : "2";
      else if (e.type === "tel") e.value = "0900000000";
      else if (e.type === "date") e.value = "2026-11-11";
      else e.value = "Local QA example";
      e.dispatchEvent(new Event("input", { bubbles: true }));
      e.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  check("filled form valid", await form.evaluate((e) => e.checkValidity()));
  await form.locator('[type="submit"]').click();
  const confirmation = await form.locator(".form-success").textContent();
  check("form local confirmation", confirmation.includes("沒有送往正式系統"), {
    confirmation,
    sandbox: await page.locator("#proposal").getAttribute("sandbox"),
  });
  if (!confirmation)
    result.fidelity.push({
      id: "sandbox-form-submission",
      severity: "high",
      finding:
        "預覽iframe的sandbox未允許表單，原生驗證通過後提交仍被瀏覽器阻擋，無法出現完成提示。",
    });
  f = await interactiveSelect(find("admin-dashboard", "SettingsView"));
  const st = f.locator("[data-settings-tab]");
  check("settings tabs present", (await st.count()) > 1);
  if ((await st.count()) > 1) {
    await st.first().focus();
    await f.locator("body").press("ArrowRight");
    check(
      "settings keyboard tab navigation",
      (await st.nth(1).getAttribute("aria-selected")) === "true",
    );
  }
  f = await interactiveSelect(find("admin-dashboard", "OrdersView"));
  await f.locator("[data-detail]").first().click();
  check(
    "detail modal opens",
    await f.locator("#detail-dialog").evaluate((e) => e.open),
  );
  await f.locator("body").press("Escape");
  check(
    "detail modal Escape",
    !(await f.locator("#detail-dialog").evaluate((e) => e.open)),
  );
  for (const state of ["empty", "error", "loading"]) {
    await f.locator(`.state-control [data-state="${state}"]`).click();
    check(
      state + " demo state",
      (await f.locator(".preview-" + state).count()) === 1,
    );
    if (state === "error") {
      await f.locator('.preview-error [data-state="normal"]').click();
      check(
        "error retry restores content",
        (await f.locator(".preview-error").count()) === 0 &&
          (await f.locator("table").count()) > 0,
      );
    }
  }
  await f.locator('.state-control [data-state="normal"]').click();
  await context.close();
} catch (e) {
  result.fatal = e.stack;
  console.log("FATAL", e.stack);
} finally {
  await browser?.close();
  result.endHash = hash();
  result.artifactChanged = result.startHash !== result.endHash;
  result.finishedAt = new Date().toISOString();
  result.summary = {
    pageChecks: result.pages.length,
    pageFailures: result.pages.filter((p) => !p.pass).length,
    checks: result.checks.length,
    failedChecks: result.checks.filter((c) => !c.pass),
    jsErrors: result.errors.length,
    consoleErrors: result.consoleErrors.length,
    externalRequests: result.externalRequests.length,
    fidelityFindings: result.fidelity.length,
  };
  result.status = result.fatal
    ? "error"
    : result.artifactChanged
      ? "stale"
      : result.summary.pageFailures ||
          result.summary.failedChecks.length ||
          result.errors.length ||
          result.consoleErrors.length ||
          result.externalRequests.length
        ? "failed"
        : result.fidelity.length
          ? "passed-with-fidelity-notes"
          : "passed";
  save();
  console.log(
    JSON.stringify(
      {
        status: result.status,
        ...result.summary,
        artifactChanged: result.artifactChanged,
        fidelity: result.fidelity,
      },
      null,
      2,
    ),
  );
}
