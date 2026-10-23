/**
 * Retry read-only D1 statements that fail with a transient error.
 *
 * For local dev: `pnpm dev` runs the api and realtime workers as two workerd
 * processes over one SQLite file (`--persist-to .wrangler/shared-state`), and
 * concurrent access fails intermittently with `D1_ERROR: Failed to get session
 * commit token: internal error`. The workers enable this only when the dev
 * script passes `--var D1_READ_RETRY:true`; deployed workers never wrap their
 * binding. Turning it on in production is a separate decision.
 *
 * Writes are never retried: a write that errored may still have committed, and
 * running it again could apply it twice.
 */

const TRANSIENT_ERROR =
  /Failed to get session commit token|internal error|Network connection lost|storage caused object to be reset|reset because its code was updated/i;
const RETRY_DELAYS_MS = [25, 100];
const STATEMENT_RUNNERS = new Set(["first", "all", "raw", "run"]);

const statements = new WeakMap<object, { real: object; readOnly: boolean }>();

export function isReadOnlySql(sql: string): boolean {
  const text = sql.trim();
  if (/^select\b/i.test(text)) return true;
  // A CTE can end in INSERT/UPDATE/DELETE; only treat it as a read without one.
  return (
    /^with\b/i.test(text) && !/\b(insert|update|delete|replace)\b/i.test(text)
  );
}

export function isTransientD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_ERROR.test(message);
}

async function retryIfRead<R>(
  readOnly: boolean,
  run: () => Promise<R>,
): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (
        !readOnly ||
        attempt >= RETRY_DELAYS_MS.length ||
        !isTransientD1Error(error)
      ) {
        throw error;
      }
      console.warn(
        `[d1-retry] transient D1 error on a read, retry ${attempt + 1}:`,
        error instanceof Error ? error.message : String(error),
      );
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_DELAYS_MS[attempt]),
      );
    }
  }
}

type AnyFunction = (...args: unknown[]) => unknown;

function wrapStatement<S extends object>(statement: S, readOnly: boolean): S {
  const proxy = new Proxy(statement, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const method = value as AnyFunction;
      if (prop === "bind") {
        return (...args: unknown[]) =>
          wrapStatement(method.apply(target, args) as object, readOnly);
      }
      if (STATEMENT_RUNNERS.has(prop as string)) {
        return (...args: unknown[]) =>
          retryIfRead(
            readOnly,
            () => method.apply(target, args) as Promise<unknown>,
          );
      }
      // Binding methods throw "Illegal invocation" unless called on the original.
      return method.bind(target);
    },
  });
  statements.set(proxy, { real: statement, readOnly });
  return proxy;
}

/**
 * Wrap a D1 binding (or a `withSession()` result) so its read-only statements
 * retry on transient errors. Everything else passes through unchanged.
 */
export function withD1ReadRetry<D extends object>(db: D): D {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      const method = value as AnyFunction;
      if (prop === "prepare") {
        return (sql: string) =>
          wrapStatement(method.call(target, sql) as object, isReadOnlySql(sql));
      }
      if (prop === "batch") {
        return (batch: object[]) => {
          const entries = batch.map((s) => statements.get(s));
          // The binding only accepts its own statement objects, not proxies.
          const real = batch.map((s, i) => entries[i]?.real ?? s);
          const readOnly = entries.every((entry) => entry?.readOnly === true);
          return retryIfRead(
            readOnly,
            () => method.call(target, real) as Promise<unknown>,
          );
        };
      }
      if (prop === "withSession") {
        return (...args: unknown[]) =>
          withD1ReadRetry(method.apply(target, args) as object);
      }
      return method.bind(target);
    },
  });
}
