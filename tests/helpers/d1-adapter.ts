/**
 * D1Database adapter wrapping better-sqlite3 for tests.
 *
 * Implements the subset of D1Database / D1PreparedStatement interfaces that
 * the existing test code uses (`prepare`, `bind`, `all`, `first`, `run`,
 * `raw`, `exec`, `batch`). Async signatures wrap better-sqlite3's synchronous
 * API so call sites that `await` D1 calls work unchanged.
 *
 * Why a thin adapter instead of `@cloudflare/vitest-pool-workers`:
 *
 * - D1 itself is SQLite under the hood, so query planner behavior, index
 *   selection, and EXPLAIN QUERY PLAN output match production
 * - much smaller setup than miniflare (no wrangler.toml, no Worker bindings,
 *   no pool config)
 * - synchronous in-memory better-sqlite3 wrapped in async stubs
 *
 * If a test ever needs Workers runtime semantics (DurableObjects, KV, R2,
 * Service Bindings, etc.) it should NOT use this helper — it should use
 * miniflare via `@cloudflare/vitest-pool-workers` instead.
 */

import type Database from "better-sqlite3";

/**
 * Subset of @cloudflare/workers-types D1Result that we populate. The full
 * D1Result has more `meta` fields but tests only read `results` and
 * `success`, so we keep `meta` minimal and pass-through-typed.
 */
export interface D1AdapterResult<T = unknown> {
  results: T[];
  success: true;
  meta: {
    duration: number;
    size_after: number;
    rows_read: number;
    rows_written: number;
    last_row_id: number;
    changed_db: boolean;
    changes: number;
  };
}

export interface D1AdapterExecResult {
  count: number;
  duration: number;
}

export class D1DatabaseAdapter {
  constructor(private sqlite: Database.Database) {}

  prepare(sql: string): D1PreparedStatementAdapter {
    const stmt = this.sqlite.prepare(sql);
    return new D1PreparedStatementAdapter(stmt);
  }

  async exec(sql: string): Promise<D1AdapterExecResult> {
    const start = performance.now();
    this.sqlite.exec(sql);
    const count = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean).length;
    return {
      count,
      duration: performance.now() - start,
    };
  }

  async batch<T = unknown>(
    statements: D1PreparedStatementAdapter[],
  ): Promise<D1AdapterResult<T>[]> {
    // D1 runs a batch as one transaction: a failing statement rolls back the
    // ones before it. Without this, tests would bless partial writes.
    const results: D1AdapterResult<T>[] = [];
    this.sqlite.exec("BEGIN");
    try {
      for (const stmt of statements) {
        results.push(await stmt.all<T>());
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
    return results;
  }

  /** Test-only escape hatch for tear-down. Not part of D1Database. */
  close(): void {
    this.sqlite.close();
  }

  /** Test-only escape hatch — direct better-sqlite3 access for ANALYZE etc. */
  raw(): Database.Database {
    return this.sqlite;
  }
}

export class D1PreparedStatementAdapter {
  /**
   * Bound parameters from `.bind()`. Empty array means "no params bound yet"
   * — call sites that hit `.all()` / `.first()` / `.run()` directly without
   * binding (uncommon, but D1 supports it for parameter-less queries) work
   * because spreading `[]` is a no-op.
   */
  private boundParams: unknown[] = [];

  constructor(private stmt: Database.Statement) {}

  /**
   * D1's `bind` returns a NEW prepared statement so the original is reusable
   * for re-binding. We mirror that by returning a fresh adapter that wraps
   * the same underlying better-sqlite3 statement but with its own
   * `boundParams`.
   */
  bind(...values: unknown[]): D1PreparedStatementAdapter {
    const next = new D1PreparedStatementAdapter(this.stmt);
    next.boundParams = values;
    return next;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const row = this.stmt.get(...this.boundParams) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    if (colName !== undefined) return (row[colName] ?? null) as T;
    return row as T;
  }

  async all<T = unknown>(): Promise<D1AdapterResult<T>> {
    const start = performance.now();
    // D1's `.all()` accepts non-SELECT statements (UPDATE / INSERT /
    // DELETE) and just returns an empty results array with the row-count
    // meta populated. better-sqlite3 is stricter — calling `.all()` on a
    // non-readable statement throws. Detect via `stmt.reader` and route
    // non-readers through `.run()` so the adapter matches D1 semantics.
    if (!this.stmt.reader) {
      const info = this.stmt.run(...this.boundParams);
      return {
        results: [] as T[],
        success: true,
        meta: {
          duration: performance.now() - start,
          size_after: 0,
          rows_read: 0,
          rows_written: info.changes,
          last_row_id: Number(info.lastInsertRowid),
          changed_db: info.changes > 0,
          changes: info.changes,
        },
      };
    }
    const rows = this.stmt.all(...this.boundParams) as T[];
    return {
      results: rows,
      success: true,
      meta: {
        duration: performance.now() - start,
        size_after: 0,
        rows_read: rows.length,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
    };
  }

  async run(): Promise<D1AdapterResult<unknown>> {
    const start = performance.now();
    const info = this.stmt.run(...this.boundParams);
    return {
      results: [],
      success: true,
      meta: {
        duration: performance.now() - start,
        size_after: 0,
        rows_read: 0,
        rows_written: info.changes,
        last_row_id: Number(info.lastInsertRowid),
        changed_db: info.changes > 0,
        changes: info.changes,
      },
    };
  }

  async raw<T = unknown>(): Promise<T[]> {
    return this.stmt.raw().all(...this.boundParams) as T[];
  }
}
