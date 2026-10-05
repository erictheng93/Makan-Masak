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
console.log(
  "System handbook: structure, references, search, deep links and print checks passed.",
);
