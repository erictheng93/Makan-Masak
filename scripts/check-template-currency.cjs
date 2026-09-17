#!/usr/bin/env node
/**
 * Prevent literal dollar prefixes in Vue templates (#390).
 * Currency formatters own both the symbol and decimal precision.
 */
const fs = require("node:fs");
const path = require("node:path");

function checkTemplateCurrency({ root = path.resolve(__dirname, "..") } = {}) {
  const violations = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (entry.isFile() && entry.name.endsWith(".vue")) {
        const source = fs.readFileSync(file, "utf8");
        // Preserve offsets while excluding comments and non-template blocks.
        const template = source.replace(
          /<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
          (block) => block.replace(/[^\r\n]/g, " "),
        );
        for (const match of template.matchAll(/\$\s*\{\{|\$\$\{/g)) {
          violations.push({
            file: path.relative(root, file).split(path.sep).join("/"),
            line: source.slice(0, match.index).split("\n").length,
          });
        }
      }
    }
  }
  const apps = path.join(root, "apps");
  if (fs.existsSync(apps)) {
    for (const app of fs.readdirSync(apps, { withFileTypes: true })) {
      const src = path.join(apps, app.name, "src");
      if (app.isDirectory() && fs.existsSync(src)) scan(src);
    }
  }
  return { violations };
}

if (require.main === module) {
  const { violations } = checkTemplateCurrency();
  if (violations.length) {
    for (const { file, line } of violations) {
      console.error(
        `${file}:${line}: hardcoded currency prefix; use the restaurant currency formatter.`,
      );
    }
    process.exitCode = 1;
  } else console.log("Vue template currency guard passed.");
}

module.exports = { checkTemplateCurrency };
