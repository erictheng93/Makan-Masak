// Run: pnpm exec node scripts/check-system-handbook.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const filename = path.resolve(
  __dirname,
  "../docs/user-manuals/system-handbook.html",
);
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error));
const dom = new JSDOM(fs.readFileSync(filename, "utf8"), {
  url: "https://handbook.invalid/",
  runScripts: "dangerously",
  virtualConsole,
});
const { window: domWindow } = dom;
const { document: handbookDocument } = domWindow;
assert.equal(handbookDocument.documentElement.lang, "zh-Hant");
assert.equal(handbookDocument.querySelectorAll("h1").length, 1);
assert.equal(handbookDocument.querySelectorAll("main > article").length, 24);
const ids = [...handbookDocument.querySelectorAll("[id]")].map(
  (node) => node.id,
);
assert.equal(new Set(ids).size, ids.length, "Duplicate element IDs");
for (const link of handbookDocument.querySelectorAll("a[href]")) {
  const href = link.getAttribute("href");
  if (href.startsWith("#")) {
    assert(
      handbookDocument.getElementById(href.slice(1)),
      `Missing anchor: ${href}`,
    );
  } else if (!/^[a-z]+:/i.test(href)) {
    assert(
      fs.existsSync(
        path.resolve(
          path.dirname(filename),
          decodeURIComponent(href.split(/[?#]/)[0]),
        ),
      ),
      `Missing reference: ${href}`,
    );
  }
}
assert.equal(
  handbookDocument.querySelectorAll(
    "script[src], link[rel=stylesheet], img[src]",
  ).length,
  0,
  "Handbook must remain self-contained",
);

const input = handbookDocument.querySelector("#chapter-search");
const results = handbookDocument.querySelector("#search-results");
function search(value) {
  input.value = value;
  input.dispatchEvent(new domWindow.Event("input"));
}
search("OAUTH");
assert(
  results.querySelector('a[href="#identity"]'),
  "Search must include chapter body text",
);
search("customer_auth_identities");
results.querySelector('a[href="#schema-catalog"]').click();
assert(
  handbookDocument.querySelector("#schema-customer_auth_identities").open,
  "Search must reveal matching collapsed references",
);
search("<script>unlikely-query</script>");
assert.equal(results.querySelectorAll("a, script").length, 0);
assert(results.textContent.includes("找不到"));
search("");
assert(results.hidden);

const details = [...handbookDocument.querySelectorAll("article details")];
const originalState = details.map((detail) => detail.open);
domWindow.dispatchEvent(new domWindow.Event("beforeprint"));
assert(
  details.every((detail) => detail.open),
  "Printing must include collapsed references",
);
domWindow.dispatchEvent(new domWindow.Event("afterprint"));
assert.deepEqual(
  details.map((detail) => detail.open),
  originalState,
);
let printed = false;
domWindow.print = () => {
  printed = true;
};
handbookDocument.querySelector("#print-manual").click();
assert(printed);
domWindow.history.replaceState(null, "", "#schema-orders");
domWindow.dispatchEvent(new domWindow.Event("hashchange"));
assert(handbookDocument.querySelector("#schema-orders").open);
domWindow.history.replaceState(null, "", "#%invalid");
domWindow.dispatchEvent(new domWindow.Event("hashchange"));
assert.equal(errors.length, 0, errors.map(String).join("\n"));
domWindow.close();

const handbookPaths = [
  "system-handbook.html",
  "en-US/system-handbook.html",
  "ja-JP/system-handbook.html",
  "id-ID/system-handbook.html",
  "vi-VN/system-handbook.html",
  "fil-PH/system-handbook.html",
];
for (const directory of [
  "docs/user-manuals",
  "apps/onboarding-app/public/guide",
]) {
  for (const handbookPath of handbookPaths) {
    const source = fs.readFileSync(
      path.resolve(__dirname, "..", directory, handbookPath),
      "utf8",
    );
    const page = new JSDOM(source, {
      url: `https://handbook.invalid/guide/${handbookPath}`,
      runScripts: "outside-only",
    });
    // jsdom does not navigate. Capture only Location writes; run the actual
    // inline scripts and change events against the real handbook DOM.
    const navigation = {
      protocol: "https:",
      hash: "#schema-orders",
      href: "",
    };
    for (const script of page.window.document.querySelectorAll("script")) {
      page.window.Function("location", script.textContent)(navigation);
    }
    const selector = page.window.document.querySelector("#lang-switch");
    const changeLanguage = (locale) => {
      if (![...selector.options].some((option) => option.value === locale)) {
        selector.add(new page.window.Option(locale, locale));
      }
      selector.value = locale;
      navigation.href = "";
      selector.dispatchEvent(new page.window.Event("change"));
    };
    for (const base of [
      "https://handbook.invalid/guide/",
      "file:///checkout/docs/user-manuals/",
    ]) {
      for (const target of handbookPaths) {
        const locale = target.includes("/") ? target.split("/")[0] : "zh-TW";
        changeLanguage(locale);
        assert.equal(
          new URL(navigation.href, `${base}${handbookPath}`).href,
          `${base}${target}#schema-orders`,
          `${directory}/${handbookPath}: ${locale} must preserve the chapter`,
        );
      }
    }
    for (const payload of [
      "javascript:alert(1)//",
      "JaVaScRiPt:alert(1)//",
      "java\nscript:alert(1)//",
      "data:text/html,<script>alert(1)</script>",
      "https://attacker.invalid",
      "//attacker.invalid",
      "../en-US",
      "%6aavascript:alert(1)//",
      "__proto__",
      "constructor",
      "",
    ]) {
      changeLanguage(payload);
      assert.equal(
        navigation.href,
        "",
        `${directory}/${handbookPath}: reject unsupported locale ${JSON.stringify(payload)}`,
      );
    }
    page.window.document.documentElement.dataset.root = "javascript:alert(1)//";
    changeLanguage("en-US");
    assert.equal(
      new URL(navigation.href, `https://handbook.invalid/guide/${handbookPath}`)
        .href,
      "https://handbook.invalid/guide/en-US/system-handbook.html#schema-orders",
      `${directory}/${handbookPath}: DOM metadata must not control navigation`,
    );
    page.window.close();
  }
}
console.log(
  "System handbook: structure, references, search, deep links, print and safe language navigation checks passed (12 copies).",
);
