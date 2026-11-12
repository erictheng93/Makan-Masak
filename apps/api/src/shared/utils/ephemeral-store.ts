import { drizzle } from "drizzle-orm/d1";
import { eq, lte } from "drizzle-orm";
import { ephemeralKv } from "@makanmasak/database";

/**
 * The slice of the Workers KV API the write-heavy callers use, so a caller
 * moves from KV to D1 by swapping the object it is handed.
 */
export interface EphemeralStore {
  get(key: string): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Drizzle's D1 and better-sqlite3 drivers both satisfy this. */
type EphemeralDb = Pick<
  ReturnType<typeof drizzle>,
  "select" | "insert" | "delete"
>;

/**
 * Key/value state backed by the `ephemeral_kv` D1 table. See the schema file
 * for why this is not Workers KV. Unlike KV it is strongly consistent and has
 * no 60-second minimum TTL.
 */
export class D1EphemeralStore implements EphemeralStore {
  constructor(
    private readonly db: EphemeralDb,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  async get(key: string, type?: "json"): Promise<unknown> {
    const [row] = await this.db
      .select({ value: ephemeralKv.value, expiresAt: ephemeralKv.expiresAt })
      .from(ephemeralKv)
      .where(eq(ephemeralKv.key, key))
      .limit(1);
    if (!row || row.expiresAt.getTime() <= this.now()) return null;
    return type === "json" ? JSON.parse(row.value) : row.value;
  }

  async put(
    key: string,
    value: string,
    options: { expirationTtl: number },
  ): Promise<void> {
    const expiresAt = new Date(this.now() + options.expirationTtl * 1000);
    await this.db
      .insert(ephemeralKv)
      .values({ key, value, expiresAt })
      .onConflictDoUpdate({
        target: ephemeralKv.key,
        set: { value, expiresAt },
      });
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(ephemeralKv).where(eq(ephemeralKv.key, key));
  }

  /**
   * Read and delete in one statement. For one-time values: a get followed by a
   * delete lets two concurrent requests both read the value.
   */
  async take(key: string): Promise<string | null> {
    const [row] = await this.db
      .delete(ephemeralKv)
      .where(eq(ephemeralKv.key, key))
      .returning({
        value: ephemeralKv.value,
        expiresAt: ephemeralKv.expiresAt,
      });
    if (!row || row.expiresAt.getTime() <= this.now()) return null;
    return row.value;
  }

  /** For the daily cleanup cron; readers already ignore expired rows. */
  async deleteExpired(): Promise<void> {
    await this.db
      .delete(ephemeralKv)
      .where(lte(ephemeralKv.expiresAt, new Date(this.now())));
  }
}

export function ephemeralStore(env: { DB: D1Database }): D1EphemeralStore {
  return new D1EphemeralStore(drizzle(env.DB));
}
