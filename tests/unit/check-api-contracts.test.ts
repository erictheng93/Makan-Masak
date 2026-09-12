import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

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

// Issue #363. `z.lazy` is a deferral, not a type, so describing a lazified
// schema must produce exactly what describing the eager schema produces.
// The describer used to recurse into `def.getter()` with a *fresh* unwrap,
// which threw away every wrapper peeled off the outside of the lazy: a
// `.nullable()` schema came back labelled `object`, not `object|null`.
// #362 wrapped every module-scope schema in apps/api/src/features/** in
// z.lazy, so the first contract schema to follow gets either false BREAKING
// entries or — worse — a real nullability change reported as no change.
describe("z.lazy is transparent to the describer", () => {
  const eager = () => z.object({ a: z.string() });
  const lazy = () => z.lazy(() => z.object({ a: z.string() }));

  it("carries .nullable() through the lazy", () => {
    expect(describeSchema(lazy().nullable())).toEqual(
      describeSchema(eager().nullable()),
    );
    expect(describeSchema(lazy().nullable()).$).toBe("object|null");
  });

  it("carries .optional() through the lazy", () => {
    expect(describeSchema(lazy().optional())).toEqual(
      describeSchema(eager().optional()),
    );
    expect(describeSchema(lazy().optional()).$).toBe("object?");
  });

  it("carries .default() through the lazy", () => {
    expect(describeSchema(lazy().default({ a: "x" }))).toEqual(
      describeSchema(eager().default({ a: "x" })),
    );
    expect(describeSchema(lazy().default({ a: "x" })).$).toBe("object=");
  });

  it("carries a stack of wrappers through the lazy", () => {
    expect(describeSchema(lazy().nullable().optional())).toEqual(
      describeSchema(eager().nullable().optional()),
    );
    expect(describeSchema(lazy().nullable().optional()).$).toBe("object|null?");
  });

  it("merges wrappers applied on both sides of the lazy", () => {
    const split = z.lazy(() => eager().nullable()).optional();

    expect(describeSchema(split)).toEqual(
      describeSchema(eager().nullable().optional()),
    );
  });

  it("carries a wrapper on an object field that holds a lazy", () => {
    const lazified = z.object({ b: lazy().nullable(), c: z.string() });
    const plain = z.object({ b: eager().nullable(), c: z.string() });

    expect(describeSchema(lazified)).toEqual(describeSchema(plain));
    expect(describeSchema(lazified).b).toBe("object|null");
  });

  it("resolves a lazy that returns another lazy", () => {
    const doubled = z.lazy(() => lazy()).nullable();

    expect(describeSchema(doubled)).toEqual(describeSchema(eager().nullable()));
  });

  it("still reports <circular> for a self-referential lazy", () => {
    type Tree = { name: string; children: Tree[] };
    const TreeSchema: z.ZodType<Tree> = z.object({
      name: z.string(),
      children: z.array(z.lazy(() => TreeSchema)),
    });

    expect(describeSchema(TreeSchema)["children[]"]).toContain("<circular>");
  });

  it("does not hang on a lazy whose getter returns the lazy itself", () => {
    const selfLazy: z.ZodType = z.lazy(() => selfLazy);

    expect(describeSchema(selfLazy).$).toContain("<circular>");
  });

  it("does not hang on two lazies that defer to each other", () => {
    const left: z.ZodType = z.lazy(() => right);
    const right: z.ZodType = z.lazy(() => left);

    expect(describeSchema(left.nullable()).$).toContain("<circular>");
  });
});
