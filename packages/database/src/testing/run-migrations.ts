import fs from "node:fs";
import path from "node:path";
import type { D1Database } from "@cloudflare/workers-types";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../migrations_fresh");

export async function runMigrations(db: D1Database): Promise<void> {
  const label = `[runMigrations:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}]`;
  console.time(label);
  try {
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean);

      for (const [index, statement] of statements.entries()) {
        try {
          await db.prepare(statement).run();
        } catch (err) {
          throw new Error(
            `[runMigrations] failed in ${file} statement ${index + 1}/${
              statements.length
            }: ${(err as Error).message}`,
          );
        }
      }
    }
  } finally {
    console.timeEnd(label);
  }
}

export async function listUserTables(db: D1Database): Promise<string[]> {
  const result = await db
    .prepare(
      // Exclude FTS5 virtual tables (`CREATE VIRTUAL TABLE`) and their shadow
      // tables (e.g. dish_search_fts_data / _idx / _docsize / _config) — neither
      // can be DELETEd directly (FTS5 raises "table X may not be modified"), and
      // they are derived search indexes, not user data.
      //
      // NOTE: shadow tables have a real `CREATE TABLE` sql (NOT NULL), so they
      // can't be filtered by `sql IS NULL`. Instead exclude any table whose name
      // is `<virtual table>_<suffix>`, which is how FTS5 names its shadows.
      `SELECT name FROM sqlite_master AS m
       WHERE m.type='table'
         AND m.name NOT LIKE 'sqlite_%'
         AND m.name != '__drizzle_migrations'
         -- workerd's own D1 metadata (_cf_KV, _cf_METADATA): SQLITE_AUTH on DELETE
         AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
         AND m.sql IS NOT NULL
         AND m.sql NOT LIKE 'CREATE VIRTUAL TABLE%'
         AND NOT EXISTS (
           SELECT 1 FROM sqlite_master AS v
           WHERE v.type='table'
             AND v.sql LIKE 'CREATE VIRTUAL TABLE%'
             AND m.name LIKE replace(v.name, '_', '\\_') || '\\_%' ESCAPE '\\'
         )`,
    )
    .all<{ name: string }>();
  return (result.results ?? []).map((r) => r.name);
}
