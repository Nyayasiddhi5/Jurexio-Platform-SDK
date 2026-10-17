/**
 * Jurexio Enterprise Platform 3.1.2 — Type-narrowing helpers for the TS sprint
 * JRX-NS-005  ·  2026-05-01
 *
 * Express-/runtime-side helpers that turn nullable singletons (db, redis,
 * env vars, request context, …) into NON-NULL bindings with a single call
 * site, so service code can drop the noisy ?. / ! / `if (!db) throw` boilerplate
 * that was generating ~600 of our 2,104 TS errors.
 *
 * Pattern (canonical):
 *   import { db as rawDb } from '../db/index.js';
 *   import { requireDb } from '../utils/jrx-type-helpers.js';
 *   const db = requireDb(rawDb);     // throws clearly at module init if null
 *
 * After this rebind every `db.select(...)` etc. in the file is type-safe.
 *
 * GUIDING RULES:
 *   - Every helper here either returns a non-null value or throws a
 *     descriptive Error. NO silent fallbacks (per repo invariants).
 *   - The thrown error includes the missing-binding name so log scraping
 *     can map a boot failure straight to the offending env / dep.
 */

export class JrxMissingDependencyError extends Error {
  constructor(public readonly name: string, hint?: string) {
    super(
      `[JRX-NS-005] Required dependency '${name}' is null/undefined at use site.`
        + (hint ? ` Hint: ${hint}` : '')
    );
    this.name = 'JrxMissingDependencyError';
  }
}

/** Narrow a nullable value to a non-null one or throw. */
export function requireValue<T>(value: T | null | undefined, name: string, hint?: string): T {
  if (value === null || value === undefined) {
    throw new JrxMissingDependencyError(name, hint);
  }
  return value;
}

/** Narrow the drizzle db singleton. Use at module top: `const db = requireDb(rawDb);`. */
export function requireDb<T>(db: T | null | undefined): T {
  return requireValue(db, 'db', 'Database not initialised. Did initializeDatabase() run?');
}

/**
 * task-251 (2026-05-12): Lazy non-null binding for module-scope singletons.
 *
 * Returns a transparent stand-in that re-resolves `getRaw()` on every property
 * access and throws `JrxMissingDependencyError(name)` if the underlying value
 * is still null/undefined. Use it instead of:
 *
 *   - `const db = rawDb!`                    // permissive cast, hides errors
 *   - `const db = rawDb as NonNullable<...>` // same
 *   - `const db = requireDb(rawDb)` at module top — eager, throws at IMPORT
 *     time if the importer is loaded before initializeDatabase() runs (this
 *     bit us in prod once already; see jrx-orchestration-services JRX-NS-022).
 *
 * Canonical pattern (preferred for service-style modules with no Express
 * `res` in scope):
 *
 *   import { db as rawDb } from '../db/index.js';
 *   import { lazyRequire } from '../utils/jrx-type-helpers.js';
 *   const db = lazyRequire(() => rawDb, 'db');
 *
 * For HTTP route handlers prefer the explicit `if (!db) { res.status(500)
 * .json({ error: 'Database not available' }); return; }` early-return —
 * it produces a cleaner client response than letting the throw propagate.
 */
export function lazyRequire<T extends object>(
  getRaw: () => T | null | undefined,
  name: string,
  hint?: string,
): T {
  return new Proxy(Object.create(null) as T, {
    get(_t, prop, receiver) {
      const real = getRaw();
      if (real === null || real === undefined) {
        throw new JrxMissingDependencyError(name, hint);
      }
      const v = Reflect.get(real as object, prop, receiver);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(real) : v;
    },
    has(_t, prop) {
      const real = getRaw();
      if (real === null || real === undefined) return false;
      return Reflect.has(real as object, prop);
    },
  }) as T;
}

/** Narrow the redis client. */
export function requireRedis<T>(redis: T | null | undefined): T {
  return requireValue(redis, 'redis', 'Redis client not initialised. Check JRX_REDIS_TCP_URL / REDIS_URL.');
}

/** Read a required env var or throw with a helpful name. */
export function requireEnv(name: string, hint?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    throw new JrxMissingDependencyError(`process.env.${name}`, hint);
  }
  return v;
}

/**
 * Narrow `req.user` (auth middleware adds it). Most route handlers can do:
 *   const user = requireAuthedUser(req);
 */
export function requireAuthedUser<U>(req: { user?: U | null }): U {
  return requireValue(req.user, 'req.user', 'Route requires authentication middleware');
}

/** Narrow a string-or-array header to a string. */
export function requireStringHeader(
  header: string | string[] | undefined,
  name: string
): string {
  if (typeof header !== 'string' || header.trim() === '') {
    throw new JrxMissingDependencyError(`header:${name}`);
  }
  return header;
}

/**
 * task-260 (2026-05-12): Normalise the heterogeneous shapes returned by
 * Drizzle's `db.execute(...)`, the raw `pg`/`@neondatabase/serverless`
 * `pool.query(...)` calls, and our local `.catch(() => ({ rows: [...] }))`
 * fallbacks into a guaranteed `Row[]`. Avoids the `((x as any).rows ?? (x
 * as any))` double-cast that was previously sprinkled at every call site.
 *
 * Accepts:
 *   - `{ rows: T[] }`            (pg/Neon QueryResult, our `.catch()` shim)
 *   - `T[]`                      (Neon HTTP driver returning rows directly)
 *   - `null` / `undefined`       (defensive)
 */
export type SqlRow = Record<string, unknown>;
export function extractRows<T = SqlRow>(result: unknown): T[] {
  if (result === null || result === undefined) return [];
  if (Array.isArray(result)) return result as T[];
  if (typeof result === 'object' && 'rows' in (result as object)) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as T[];
  }
  return [];
}

/** Coerce unknown JSON to a typed object after a runtime predicate check. */
export function requireShape<T>(
  value: unknown,
  predicate: (v: unknown) => v is T,
  name: string
): T {
  if (!predicate(value)) {
    throw new JrxMissingDependencyError(name, 'Payload did not match expected shape');
  }
  return value;
}
