const { chromium, fs, path, out } = require("./local-review-data.cjs");
const scrollReview = process.env.REVIEW_SCROLL === "1";
const report = JSON.parse(
  fs.readFileSync(
    path.join(
      out,
      scrollReview ? "scroll-checks.json" : "production-checks.json",
    ),
    "utf8",
  ),
);
const folder = scrollReview ? "scroll-contact-sheets" : "contact-sheets";
const target = path.join(out, folder);
fs.mkdirSync(target, { recursive: true });
async function main() {
  const browser = await chromium.launch({ headless: true });
  const manifest = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 720, height: 1200 },
      deviceScaleFactor: 1,
    });
    for (const app of [...new Set(report.pages.map((item) => item.app))]) {
      for (const device of ["desktop", "mobile"]) {
        const items = report.pages.filter(
          (item) => item.app === app && item.device === device,
        );
        const width = device === "desktop" ? 330 : 220;
        const height = device === "desktop" ? 246 : 476;
        for (let start = 0; start < items.length; start += 8) {
          const chunk = items.slice(start, start + 8);
          const cards = chunk
            .map((item) => {
              const image = fs
                .readFileSync(path.join(out, item.screenshot))
                .toString("base64");
              return `<figure><figcaption>${path.basename(item.file, ".vue")}</figcaption><img src="data:image/png;base64,${image}" style="width:${width}px;height:${height}px"></figure>`;
            })
            .join("");
          await page.setViewportSize({
            width: width * 2 + 54,
            height: Math.min(
              2200,
              Math.ceil(chunk.length / 2) * (height + 52) + 20,
            ),
          });
          await page.setContent(
            `<html><head><style>*{box-sizing:border-box}body{margin:0;padding:18px;background:#F2F2F7;display:grid;grid-template-columns:repeat(2,${width}px);gap:22px 18px;font-family:Arial,sans-serif}figure{margin:0}figcaption{font-size:12px;line-height:18px;margin-bottom:7px;color:#1C1C1E}img{display:block;object-fit:cover;object-position:top;background:white}</style></head><body>${cards}</body></html>`,
          );
          await page.evaluate(async () =>
            Promise.all([...document.images].map((image) => image.decode())),
          );
          const file = `${app}-${device}-${start / 8 + 1}.jpg`;
          await page.screenshot({
            path: path.join(target, file),
            fullPage: true,
            type: "jpeg",
            quality: 87,
          });
          manifest.push({
            file: `${folder}/${file}`,
            device,
            pages: chunk.map((item) => item.file),
          });
        }
      }
    }
  } finally {
    await browser.close();
  }
  if (manifest.reduce((sum, item) => sum + item.pages.length, 0) !== 226)
    throw new Error("Incomplete sheet coverage");
  fs.writeFileSync(
    path.join(
      out,
      scrollReview
        ? "scroll-contact-sheet-manifest.json"
        : "contact-sheet-manifest.json",
    ),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    `Created ${manifest.length} sheets covering 226 page/device images.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
