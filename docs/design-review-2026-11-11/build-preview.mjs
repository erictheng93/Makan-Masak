import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const inputs = ["customer-audit.json", "operations-audit.json"];
const pages = inputs.flatMap((file) => {
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  return Array.isArray(data) ? data : data.pages;
});
const manifestPath = path.join(dir, "baseline-manifest.json");
const baseline = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  : { routes: [] };
const images = {};
const assets = {};
for (const [key, filename] of Object.entries({order:"1-order.jpg",kitchen:"2-kitchen.jpg",tracking:"3-tracking.jpg",dashboard:"4-dashboard.jpg"})) {
  const imagePath = path.resolve(dir, "../../apps/onboarding-app/public/tour", filename);
  assets[key] = `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString("base64")}`;
}
for (const page of pages) {
  page.id = page.file.replace(/^apps\//, "").replace(/\/src\/views\//, "/").replace(/\.vue$/, "");
  page.captures = (baseline.routes || []).filter((route) => route.file === page.file);
  for (const capture of page.captures) {
    if (!capture.screenshot) continue;
    const imagePath = path.resolve(dir, capture.screenshot);
    if (!imagePath.startsWith(dir + path.sep) || !fs.existsSync(imagePath)) {
      throw new Error(`Missing or unsafe screenshot: ${capture.screenshot}`);
    }
    const mime = imagePath.endsWith(".webp") ? "image/webp" : imagePath.endsWith(".jpg") ? "image/jpeg" : "image/png";
    images[capture.screenshot] ??= `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
  }
}
const escaped = JSON.stringify({ pages, images, assets, generatedAt: "2026-11-11" }).replace(/</g, "\\u003c");
let html = fs.readFileSync(path.join(dir, "preview-source/template.html"), "utf8");
html = html.replace("/* WORKBENCH_CSS */", fs.readFileSync(path.join(dir, "preview-source/workbench.css"), "utf8"));
html = html.replace("/* REVIEW_DATA */", `const REVIEW = ${escaped};`);
const runtime = ["customer-specific.js", "operations-specific.js", "runtime.js"].map((file) => fs.readFileSync(path.join(dir, "preview-source", file), "utf8")).join("\n");
html = html.replace("/* PREVIEW_RUNTIME */", runtime);
fs.writeFileSync(path.join(dir, "preview.html"), html);
console.log(`Built ${pages.length} page proposals; ${pages.filter((p) => p.captures.some((c) => images[c.screenshot] && c.status !== "blocked")).length} views with baseline captures.`);
