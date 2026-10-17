/**
 * Database System — REAL DELEGATION SEAM
 * JRX-ORCH-SEAM-003 (Task #32)
 *
 * Wraps the canonical DB connection (drizzle + pg/neon) so that legacy
 * consumers like knowledge-base-system can keep calling
 * `databaseSystem.getDatabase()` and then `db.execute(query, params?)`.
 *
 * Returns a hybrid result that:
 *   - is iterable directly (`for (const r of result) ...`)
 *   - exposes `.rows` and `.rowCount` (pg-style)
 *
 * Uses **parameterized queries** through the underlying `pg`/`neon` pool —
 * `?` placeholders are converted to PostgreSQL `$N` positional bindings.
 * Values are sent as parameters, never interpolated into SQL strings, so
 * this seam is SQL-injection safe.
 */

import { db as _raw_drizzleDb, pool as _raw_nvPool, type DbRow } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const drizzleDb = lazyRequire(() => _raw_drizzleDb, 'db');
const nvPool = lazyRequire(() => _raw_nvPool, 'pool');
import { nvDbPoolManager } from './jrx-db-pool-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database-system');

export type { DbRow };

/**
 * Hybrid array+object result. Behaves like `DbRow[]` for legacy code that
 * does `for (const row of result)` and like a pg-style result for code
 * that reads `result.rows`. We attach the rows array onto an Array
 * instance so both shapes work without copying.
 */
export type DBExecResult = DbRow[] & { rows: DbRow[]; rowCount: number };

function asExecResult(rows: DbRow[] | undefined, rowCount?: number): DBExecResult {
  const safeRows = rows ?? [];
  // We deliberately mutate an Array instance to attach the pg-shape fields.
  // The cast is `unknown`-typed because the resulting structural type is
  // not directly assignable from `Array<DbRow>` without the extra fields.
  const arr = safeRows.slice() as DbRow[] & { rows?: DbRow[]; rowCount?: number };
  arr.rows = safeRows;
  arr.rowCount = typeof rowCount === 'number' ? rowCount : safeRows.length;
  return arr as DBExecResult;
}

/**
 * Convert legacy `?` placeholders to PostgreSQL `$N` bindings.
 * String literals are preserved verbatim — `?` inside quoted strings is
 * NOT touched. This is a deliberately small, auditable parser.
 */
export function convertQuestionMarksToPg(query: string): string {
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let n = 0;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    const next = query[i + 1];
    if (inLineComment) { out += c; if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { out += c; if (c === '*' && next === '/') { out += next; i++; inBlockComment = false; } continue; }
    if (!inSingle && !inDouble && c === '-' && next === '-') { inLineComment = true; out += c; continue; }
    if (!inSingle && !inDouble && c === '/' && next === '*') { inBlockComment = true; out += c; continue; }
    if (!inDouble && c === "'") {
      // PG escape: '' inside string
      if (inSingle && next === "'") { out += c + next; i++; continue; }
      inSingle = !inSingle; out += c; continue;
    }
    if (!inSingle && c === '"') { inDouble = !inDouble; out += c; continue; }
    if (!inSingle && !inDouble && c === '?') { n++; out += `$${n}`; continue; }
    out += c;
  }
  return out;
}

/**
 * Structural shape of the underlying driver query call. Both `pg.Pool` and
 * `@neondatabase/serverless` pools satisfy this signature at runtime; we
 * keep the seam typed structurally so callers do not need to know which
 * driver is wired in.
 */
interface PoolWithQuery {
  query: (text: string, values: ReadonlyArray<unknown>) => Promise<{
    rows?: DbRow[];
    rowCount?: number | null;
  }>;
}

interface DrizzleWithExecute {
  execute: (q: { text: string; values: ReadonlyArray<unknown> }) => Promise<{
    rows?: DbRow[];
    rowCount?: number | null;
  }>;
}

function poolHasQuery(p: unknown): p is PoolWithQuery {
  return !!p && typeof (p as { query?: unknown }).query === 'function';
}

function drizzleHasExecute(d: unknown): d is DrizzleWithExecute {
  return !!d && typeof (d as { execute?: unknown }).execute === 'function';
}

export interface DatabaseHandle {
  execute: (query: string, params?: ReadonlyArray<unknown>) => Promise<DBExecResult>;
  query:   (query: string, params?: ReadonlyArray<unknown>) => Promise<DBExecResult>; // alias
  drizzle: () => typeof drizzleDb;
}

export class DatabaseSystem {
  private handle: DatabaseHandle | null = null;

  async getDatabase(): Promise<DatabaseHandle> {
    if (this.handle) return this.handle;

    const exec = async (
      query: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<DBExecResult> => {
      const text = convertQuestionMarksToPg(query);
      const values = params ?? [];
      try {
        // Prefer the canonical pool (parameterized, safe)
        if (poolHasQuery(nvPool)) {
          const result = await nvPool.query(text, values);
          return asExecResult(result.rows ?? [], result.rowCount ?? undefined);
        }
        // Fallback: drizzle.execute with parameterized statement.
        if (drizzleHasExecute(drizzleDb)) {
          const result = await drizzleDb.execute({ text, values });
          return asExecResult(result.rows ?? [], result.rowCount ?? undefined);
        }
        throw new Error('database-system: neither pg pool nor drizzle.execute available');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('[DatabaseSystem] execute failed', { error: msg });
        throw e;
      }
    };

    this.handle = {
      execute: exec,
      query: exec,
      drizzle: () => drizzleDb,
    };

    return this.handle;
  }

  async healthCheck(): Promise<{ ok: boolean; pools: number }> {
    const metrics = nvDbPoolManager.getAllMetrics?.();
    return { ok: true, pools: metrics?.snapshots?.length ?? 0 };
  }

  async query<T extends DbRow = DbRow>(
    query: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<T[]> {
    const handle = await this.getDatabase();
    const result = await handle.execute(query, params);
    // The hybrid result IS an array of DbRow; the cast narrows row shape.
    return (result as DbRow[] as T[]) ?? [];
  }
}

export const databaseSystem = new DatabaseSystem();
export default databaseSystem;
