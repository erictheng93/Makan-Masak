import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { keywordVariants } from "@makanmasak/shared-types";

/**
 * `col LIKE pattern`, OR-ed across the 台/臺 spellings of the pattern.
 * The swap is char-level, so `%`/`_` escaping and wildcard placement already in
 * `pattern` are preserved untouched.
 */
export const likeAny = (col: AnyColumn | SQL, pattern: string): SQL =>
  sql`(${sql.join(
    keywordVariants(pattern).map((p) => sql`${col} LIKE ${p}`),
    sql` OR `,
  )})`;
