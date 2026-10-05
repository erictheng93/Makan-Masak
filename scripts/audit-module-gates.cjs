#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const PROTECTED = [
  ["/menu/*", "menu_management", "apps/api/src/features/menu/routes/index.ts"],
  [
    "/kitchen/*",
    "kitchen_display",
    "apps/api/src/features/kitchen/routes/index.ts",
  ],
  [
    "/orders/group/*",
    "online_ordering",
    "apps/api/src/features/group-orders/routes/index.ts",
  ],
  [
    "/orders/*",
    "online_ordering",
    "apps/api/src/features/orders/routes/index.ts",
  ],
  ["/pos/*", "pos", "apps/api/src/app-factory.ts"],
  ["/payments/*", "online_ordering", "apps/api/src/app-factory.ts"],
  [
    "/tables/*",
    "table_management",
    "apps/api/src/features/tables/routes/index.ts",
  ],
  [
    "/seats/*",
    "table_management",
    "apps/api/src/features/seats/routes/index.ts",
  ],
  [
    "/analytics/*",
    "analytics",
    "apps/api/src/features/analytics/routes/index.ts",
  ],
  [
    "/ai-analytics/*",
    "ai_analytics",
    "apps/api/src/features/ai-analytics/routes/index.ts",
  ],
  ["/coupons/*", "coupons", "apps/api/src/features/coupons/routes/index.ts"],
  [
    "/reservations/*",
    "reservations",
    "apps/api/src/features/reservations/routes/index.ts",
  ],
  [
    "/waiting-list/*",
    "reservations",
    "apps/api/src/features/waiting-list/routes/index.ts",
  ],
  [
    "/partnerships/*",
    "loyalty",
    "apps/api/src/features/partnerships/routes/index.ts",
  ],
  [
    "/integrations/*",
    "platform_integration",
    "apps/api/src/features/integrations/routes/admin.ts",
  ],
  ["/leaves/*", "staff_management", "apps/api/src/app-factory.ts"],
  ["/scheduling/*", "staff_management", "apps/api/src/app-factory.ts"],
  // /forecast is gated per route, not with a blanket gate: demand forecasting
  // and alerts are analytics, the ingredient forecast is inventory.
  [
    "/forecast/* (demand)",
    "analytics",
    "apps/api/src/features/forecast/routes/index.ts",
  ],
  [
    "/forecast/* (ingredient)",
    "inventory",
    "apps/api/src/features/forecast/routes/index.ts",
  ],
  ["/ingredients/*", "inventory", "apps/api/src/app-factory.ts"],
  // /feedback is deliberately NOT gated — it is the support-ticket channel and
  // must never depend on plan tier. See app-factory.ts for the rationale.
];

const failures = [];
for (const [prefix, module, relPath] of PROTECTED) {
  const file = path.join(ROOT, relPath);
  const source = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const pattern = new RegExp(
    `moduleGate\\(\\s*(?:\\[[^\\]]*)?["']${module}["']`,
  );
  if (!pattern.test(source)) {
    failures.push(`${prefix} (${relPath}): missing moduleGate("${module}")`);
  }
}

if (failures.length > 0) {
  console.error("Module gate audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Module gate audit passed (${PROTECTED.length} checks).`);
