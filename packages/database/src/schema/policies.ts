import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { v7 as uuidv7 } from "uuid";
import type { PolicyScopeType } from "../utils/region-policies";

/**
 * 國家層與市集層的地區政策。每列是某個範圍的一個 key；value 是 JSON，
 * 合法性由 utils/region-policies.ts 的登記表決定，寫入與讀取都經過它。
 * 修改歷史記在 audit_logs（resource = 'policies'），不在這張表。
 */
export const regionPolicies = sqliteTable(
  "policies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    scopeType: text("scope_type").notNull().$type<PolicyScopeType>(),
    scopeId: text("scope_id").notNull(),
    policyKey: text("policy_key").notNull(),
    value: text("value").notNull(),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at_ms", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => ({
    scopeKeyIdx: uniqueIndex("policies_scope_key_idx").on(
      table.scopeType,
      table.scopeId,
      table.policyKey,
    ),
  }),
);

export type RegionPolicyRow = typeof regionPolicies.$inferSelect;
