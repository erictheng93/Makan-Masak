import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

type FieldMap = Record<string, string>;
type SchemaMap = Record<string, Record<string, FieldMap>>;

const {
  describeSchema,
  diffSnapshots,
  hasBreakingChanges,
}: {
  describeSchema: (schema: unknown) => FieldMap;
  diffSnapshots: (
    previous: SchemaMap,
    current: SchemaMap,
  ) => {
    removedSchemas: string[];
    changedSchemas: Array<{
      schema: string;
      addedFields: string[];
      removedFields: string[];
      retypedFields: Array<{ field: string; from: string; to: string }>;
    }>;
  };
  hasBreakingChanges: (changes: unknown) => boolean;
} = require("../../scripts/check-api-contracts.cjs");

// The contracts are imported for real — that is the whole point of the fix.
// They are tiny (zod + two helper modules), so the cold import is cheap.
const authContracts =
  await import("../../apps/api/src/contracts/schemas/authentication");
const orderContracts =
  await import("../../apps/api/src/contracts/schemas/orders");
const menuContracts = await import("../../apps/api/src/contracts/schemas/menu");

describe("contract snapshot extraction", () => {
  it("records fields that arrive through a spread", () => {
    // `...TimestampFields` — invisible to the pre-2026-09-06 regex extractor.
    const shape = describeSchema(authContracts.AuthUserSchema);

    expect(shape.createdAt).toBe("union(date|number|string)");
    expect(shape.updatedAt).toBe("union(date|number|string)");
  });

  it("walks into an envelope helper instead of stopping at success/data", () => {
    // MeResponse = successEnvelope(AuthUserSchema). The old extractor had
    // `successEnvelope -> ["success", "data"]` hard-coded and went no deeper.
    const shape = describeSchema(authContracts.MeResponse);

    expect(shape.success).toBe("literal(true)");
    expect(shape["data.username"]).toBe("string");
    expect(shape["data.createdAt"]).toBe("union(date|number|string)");
  });

  it("keeps optional and nullable in the label", () => {
    const shape = describeSchema(authContracts.AuthUserSchema);

    expect(shape.fullName).toBe("string?");
    expect(shape.phone).toBe("string|null?");
  });

  it("records enum members, not just the field name", () => {
    // docs/investigations/2026-04-09-orderstatus-surface-audit.md §7 —
    // dropping a status from the enum used to slip through silently.
    const shape = describeSchema(orderContracts.OrderStatusEnum);

    expect(shape.$).toContain("refunded");
    expect(shape.$).toContain("pending");
  });

  it("descends through arrays and marks a loose object", () => {
    const shape = describeSchema(menuContracts.GetFeaturedResponse);

    expect(shape.data).toBe("array");
    expect(shape["data[]"]).toBe("object+catchall");
    expect(shape["data[].price"]).toBe("number");
  });
});

describe("contract snapshot diff", () => {
  const baseline: SchemaMap = {
    menu: {
      CategorySchema: {
        $: "object+catchall",
        createdAt: "union(date|number|string)",
        name: "string",
      },
    },
  };

  it("flags a type change as breaking — the whole point of issue #336", () => {
    const current: SchemaMap = {
      menu: {
        CategorySchema: {
          ...baseline.menu.CategorySchema,
          createdAt: "number", // ISO string -> Unix milliseconds
        },
      },
    };

    const changes = diffSnapshots(baseline, current);

    expect(changes.changedSchemas).toHaveLength(1);
    expect(changes.changedSchemas[0].retypedFields).toEqual([
      {
        field: "createdAt",
        from: "union(date|number|string)",
        to: "number",
      },
    ]);
    expect(hasBreakingChanges(changes)).toBe(true);
  });

  it("treats a newly optional field as breaking too", () => {
    const current: SchemaMap = {
      menu: {
        CategorySchema: { ...baseline.menu.CategorySchema, name: "string?" },
      },
    };

    expect(hasBreakingChanges(diffSnapshots(baseline, current))).toBe(true);
  });

  it("does not flag a purely additive field", () => {
    const current: SchemaMap = {
      menu: {
        CategorySchema: { ...baseline.menu.CategorySchema, icon: "string?" },
      },
    };

    const changes = diffSnapshots(baseline, current);

    expect(changes.changedSchemas[0].addedFields).toEqual(["icon"]);
    expect(hasBreakingChanges(changes)).toBe(false);
  });

  it("still flags a removed field and a removed schema", () => {
    const withoutField: SchemaMap = {
      menu: { CategorySchema: { $: "object+catchall", name: "string" } },
    };
    expect(hasBreakingChanges(diffSnapshots(baseline, withoutField))).toBe(
      true,
    );

    const withoutSchema: SchemaMap = { menu: {} };
    expect(diffSnapshots(baseline, withoutSchema).removedSchemas).toEqual([
      "menu.CategorySchema",
    ]);
  });
});
