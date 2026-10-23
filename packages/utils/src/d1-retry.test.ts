import { describe, expect, it, vi } from "vitest";
import { isReadOnlySql, withD1ReadRetry } from "./d1-retry";

const transient = () =>
  new Error(
    "D1_ERROR: Failed to get session commit token: internal error; reference = x",
  );

// Private fields make these behave like workerd bindings: calling a method
// with a Proxy as `this`, or batching a proxied statement, throws.
class FakeStatement {
  #sql: string;
  #db: FakeD1;
  constructor(sql: string, db: FakeD1) {
    this.#sql = sql;
    this.#db = db;
  }
  bind(..._values: unknown[]) {
    return new FakeStatement(this.#sql, this.#db);
  }
  first() {
    return this.#db.execute(this.#sql);
  }
  run() {
    return this.#db.execute(this.#sql);
  }
  static sqlOf(statement: FakeStatement) {
    // A brand check, like the binding's: false for a Proxy of a statement.
    if (!(#sql in statement)) throw new TypeError("Illegal invocation");
    return statement.#sql;
  }
}

class FakeD1 {
  #failures: number;
  execute = vi.fn(async (sql: string) => {
    if (this.#failures > 0) {
      this.#failures--;
      throw transient();
    }
    return { sql };
  });
  constructor(failures: number) {
    this.#failures = failures;
  }
  prepare(sql: string) {
    return new FakeStatement(sql, this);
  }
  async batch(statements: FakeStatement[]) {
    const sqls = statements.map((statement) => FakeStatement.sqlOf(statement));
    return this.execute(sqls.join(";"));
  }
  withSession() {
    return new FakeD1(this.#failures);
  }
}

describe("withD1ReadRetry", () => {
  it("retries a read that fails transiently", async () => {
    const d1 = new FakeD1(2);
    const db = withD1ReadRetry(d1);

    await expect(
      db.prepare("SELECT * FROM users WHERE id = ?").bind("u1").first(),
    ).resolves.toEqual({ sql: "SELECT * FROM users WHERE id = ?" });
    expect(d1.execute).toHaveBeenCalledTimes(3);
  });

  it("gives up after two retries", async () => {
    const d1 = new FakeD1(3);

    await expect(
      withD1ReadRetry(d1).prepare("select 1").first(),
    ).rejects.toThrow("session commit token");
    expect(d1.execute).toHaveBeenCalledTimes(3);
  });

  it("never retries a write", async () => {
    const d1 = new FakeD1(1);

    await expect(
      withD1ReadRetry(d1).prepare("UPDATE users SET name = ?").bind("a").run(),
    ).rejects.toThrow("session commit token");
    expect(d1.execute).toHaveBeenCalledOnce();
  });

  it("does not retry a non-transient error", async () => {
    const d1 = new FakeD1(0);
    d1.execute.mockRejectedValueOnce(new Error("D1_ERROR: no such table: x"));

    await expect(
      withD1ReadRetry(d1).prepare("SELECT * FROM x").first(),
    ).rejects.toThrow("no such table");
    expect(d1.execute).toHaveBeenCalledOnce();
  });

  it("hands the binding its own statements in a batch", async () => {
    const d1 = new FakeD1(1);
    const db = withD1ReadRetry(d1);

    await expect(
      db.batch([db.prepare("SELECT 1"), db.prepare("SELECT 2")]),
    ).resolves.toEqual({ sql: "SELECT 1;SELECT 2" });
    expect(d1.execute).toHaveBeenCalledTimes(2);
  });

  it("does not retry a batch containing a write", async () => {
    const d1 = new FakeD1(1);
    const db = withD1ReadRetry(d1);

    await expect(
      db.batch([db.prepare("SELECT 1"), db.prepare("DELETE FROM x")]),
    ).rejects.toThrow("session commit token");
    expect(d1.execute).toHaveBeenCalledOnce();
  });

  it("keeps retrying inside a session", async () => {
    const d1 = new FakeD1(1);
    const session = withD1ReadRetry(d1).withSession();

    await expect(session.prepare("SELECT 1").first()).resolves.toEqual({
      sql: "SELECT 1",
    });
  });
});

describe("isReadOnlySql", () => {
  it("treats only selects and write-free CTEs as reads", () => {
    expect(isReadOnlySql("  select 1")).toBe(true);
    expect(isReadOnlySql("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(true);
    expect(isReadOnlySql("WITH t AS (SELECT 1) DELETE FROM x")).toBe(false);
    expect(isReadOnlySql("INSERT INTO x VALUES (1)")).toBe(false);
    expect(isReadOnlySql("PRAGMA table_info(x)")).toBe(false);
  });
});
