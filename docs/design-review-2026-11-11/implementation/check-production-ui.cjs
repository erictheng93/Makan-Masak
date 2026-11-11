const {
  root,
  reviewRoot,
  out,
  apps,
  manifest,
  routePath,
  installReviewData,
  chromium,
  fs,
  path,
} = require("./local-review-data.cjs");
const crypto = require("node:crypto");
const scrollReview = process.env.REVIEW_SCROLL === "1";
const audits = ["customer-audit.json", "operations-audit.json"].flatMap(
  (file) => JSON.parse(fs.readFileSync(path.join(reviewRoot, file), "utf8")),
);
const selected = audits.filter(
  (page) =>
    (!process.env.REVIEW_APP || page.app === process.env.REVIEW_APP) &&
    (!process.env.REVIEW_VIEW ||
      path.basename(page.file, ".vue") === process.env.REVIEW_VIEW),
);
const imageDir = path.join(
  out,
  scrollReview ? "scroll-screenshots" : "screenshots",
);
fs.mkdirSync(imageDir, { recursive: true });
const result = {
  startedAt: new Date().toISOString(),
  method:
    "Actual production Vue components, isolated local data scenarios. Unknown APIs return explicit 503; this is visual and local interaction evidence, not full backend certification.",
  pages: [],
  interactions: [],
  errors: [],
  mutationsSentToRemote: 0,
};
const scope = process.env.REVIEW_APP
  ? `${process.env.REVIEW_APP}${process.env.REVIEW_VIEW ? "-" + process.env.REVIEW_VIEW : ""}`
  : null;
const outputPath = path.join(
  out,
  scrollReview
    ? scope
      ? `scroll-${scope}-checks.json`
      : "scroll-checks.json"
    : `${scope || "production"}-checks.json`,
);
const save = () =>
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");

async function reviewScrolling(page) {
  const keyboardStops = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    keyboardStops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        return {
          tag: el.tagName,
          name: (
            el.getAttribute("aria-label") ||
            el.textContent ||
            el.getAttribute("placeholder") ||
            ""
          )
            .trim()
            .slice(0, 80),
          focused: el !== document.body,
        };
      }),
    );
  }
  const scrolling = await page.evaluate(async () => {
    const nextFrame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const roots = [
      document.scrollingElement,
      ...document.querySelectorAll("body *"),
    ].filter((el, index, all) => {
      if (!el || all.indexOf(el) !== index) return false;
      const r = el.getBoundingClientRect(),
        css = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        (el === document.scrollingElement ||
          ["auto", "scroll"].includes(css.overflowY) ||
          ["auto", "scroll"].includes(css.overflowX)) &&
        (el.scrollHeight > el.clientHeight + 2 ||
          el.scrollWidth > el.clientWidth + 2)
      );
    });
    const measurements = [];
    for (const el of roots) {
      const vertical = el.scrollHeight > el.clientHeight + 2;
      const horizontal = el.scrollWidth > el.clientWidth + 2;
      let steps = 0;
      if (vertical) {
        for (
          let y = 0;
          y < el.scrollHeight;
          y += Math.max(200, el.clientHeight * 0.8)
        ) {
          el.scrollTop = y;
          steps++;
          await nextFrame();
        }
        el.scrollTop = el.scrollHeight;
      }
      if (horizontal) {
        el.scrollLeft = el.scrollWidth;
        await nextFrame();
        el.scrollLeft = 0;
      }
      await nextFrame();
      measurements.push({
        tag: el.tagName,
        class: typeof el.className === "string" ? el.className : "",
        vertical,
        horizontal,
        steps,
        scrollTop: Math.round(el.scrollTop),
        maximumTop: el.scrollHeight - el.clientHeight,
        reachedBottom:
          !vertical ||
          Math.abs(el.scrollTop - (el.scrollHeight - el.clientHeight)) <= 2,
      });
    }
    return measurements;
  });
  return {
    keyboardStops,
    scrollContainers: scrolling,
    scrollingPass: scrolling.every((item) => item.reachedBottom),
  };
}

async function inspect(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        css.visibility !== "hidden" &&
        css.display !== "none"
      );
    };
    const details = (el) => ({
      tag: el.tagName,
      text: (el.getAttribute("aria-label") || el.textContent || "")
        .trim()
        .slice(0, 70),
      class: typeof el.className === "string" ? el.className : "",
      width: Math.round(el.getBoundingClientRect().width),
      height: Math.round(el.getBoundingClientRect().height),
    });
    const controls = [
      ...document.querySelectorAll(
        "button,input:not([type=checkbox]):not([type=radio]):not([type=range]),select",
      ),
    ].filter(visible);
    const tinyControls = controls
      .filter(
        (el) =>
          el.getBoundingClientRect().height < 43.5 ||
          (el.tagName === "BUTTON" && el.getBoundingClientRect().width < 43.5),
      )
      .map(details);
    const unnamedButtons = [...document.querySelectorAll("button")]
      .filter(visible)
      .filter(
        (el) =>
          !el.textContent.trim() &&
          !el.getAttribute("aria-label") &&
          !el.getAttribute("aria-labelledby") &&
          !el.getAttribute("title"),
      )
      .map(details);
    const overflow = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        if (!visible(el)) return false;
        const rect = el.getBoundingClientRect();
        if (
          rect.right <= innerWidth + 2 ||
          rect.left >= innerWidth ||
          getComputedStyle(el).position === "fixed"
        )
          return false;
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          if (
            ["auto", "scroll", "hidden", "clip"].includes(
              getComputedStyle(parent).overflowX,
            )
          )
            return false;
          parent = parent.parentElement;
        }
        return true;
      })
      .slice(0, 8)
      .map(details);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      textLength: document.body.innerText.trim().length,
      headings: [...document.querySelectorAll("h1,h2")]
        .filter(visible)
        .map((el) => el.textContent.trim())
        .slice(0, 12),
      tinyControls,
      unnamedButtons,
      overflow,
      brokenImages: [...document.images]
        .filter((el) => visible(el) && el.complete && el.naturalWidth === 0)
        .map((el) => el.getAttribute("src")),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const app of apps.filter((app) =>
      selected.some((page) => page.app === app),
    )) {
      for (const [device, width, height] of [
        ["desktop", 1100, 820],
        ["mobile", 390, 844],
      ]) {
        const context = await browser.newContext({
          viewport: { width, height },
          locale: "zh-TW",
          serviceWorkers: "block",
          reducedMotion: "reduce",
        });
        const data = await installReviewData(context, app);
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        let pageErrors = [];
        page.on("pageerror", (error) => pageErrors.push(error.message));
        for (const source of selected.filter((item) => item.app === app)) {
          data.reset();
          pageErrors = [];
          const records = manifest.routes.filter(
            (route) =>
              route.file === source.file &&
              route.origin !== "live" &&
              !route.variant,
          );
          const record =
            records.find((route) => route.kind === "page") || records[0];
          const entry = {
            app,
            file: source.file,
            title: source.title,
            device,
            route: record?.route,
            sourceHash: crypto
              .createHash("sha256")
              .update(fs.readFileSync(path.join(root, source.file)))
              .digest("hex"),
          };
          try {
            if (!record) throw new Error("No route evidence for source view");
            const localPath = routePath(record);
            const url = `http://127.0.0.1:${4410 + apps.indexOf(app)}${localPath}`;
            await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
            await page.locator("#app").first().waitFor();
            for (let i = 0; i < 4; i++) {
              const close = page.locator(".Vue-Toastification__close-button");
              if (!(await close.count())) break;
              for (const button of await close.all())
                await button.click({ force: true }).catch(() => {});
            }
            await page.evaluate(async () => {
              await document.fonts.ready;
              await Promise.all(
                [...document.images].map((image) => {
                  image.loading = "eager";
                  return image.decode().catch(() => {});
                }),
              );
            });
            const expected = new URL(localPath, "http://localhost").pathname;
            entry.actualRoute = new URL(page.url()).pathname;
            entry.inheritedFrom = record.inheritedFrom || null;
            entry.routeMatches =
              entry.actualRoute === expected ||
              (Boolean(record.inheritedFrom) &&
                entry.actualRoute.startsWith(
                  expected.replace(/\/$/, "") + "/",
                ));
            if (scrollReview) Object.assign(entry, await reviewScrolling(page));
            Object.assign(entry, await inspect(page));
            entry.unavailableApi = [...new Set(data.unavailable)];
            entry.jsErrors = [...pageErrors];
            entry.dataState = entry.unavailableApi.length
              ? "includes-unavailable-api"
              : "sample-data";
            entry.screenshot = `${scrollReview ? "scroll-screenshots" : "screenshots"}/${app}--${path.basename(source.file, ".vue")}--${device}.png`;
            await page.screenshot({
              path: path.join(out, entry.screenshot),
              fullPage: !scrollReview,
              animations: "disabled",
            });
            entry.pass =
              entry.routeMatches &&
              entry.textLength > 8 &&
              entry.scrollWidth <= width + 2 &&
              !entry.jsErrors.length &&
              !entry.brokenImages.length &&
              !entry.tinyControls.length &&
              (!scrollReview || entry.scrollingPass);
          } catch (error) {
            entry.pass = false;
            entry.error = error.message;
          }
          result.pages.push(entry);
          save();
          console.log(
            `${entry.pass ? "PASS" : "REVIEW"} ${app} ${device} ${path.basename(source.file)}${entry.error ? " " + entry.error.slice(0, 100) : ""}`,
          );
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  result.finishedAt = new Date().toISOString();
  result.summary = {
    checked: result.pages.length,
    passed: result.pages.filter((page) => page.pass).length,
    needsReview: result.pages.filter((page) => !page.pass).length,
    unavailableDataPages: result.pages.filter(
      (page) => page.unavailableApi?.length,
    ).length,
    jsErrors: result.pages.reduce(
      (count, page) => count + (page.jsErrors?.length || 0),
      0,
    ),
    unnamedButtons: result.pages.reduce(
      (count, page) => count + (page.unnamedButtons?.length || 0),
      0,
    ),
  };
  save();
  console.log(JSON.stringify(result.summary));
  if (result.summary.needsReview) process.exitCode = 1;
}
main().catch((error) => {
  result.errors.push(error.stack);
  save();
  console.error(error);
  process.exitCode = 1;
});
