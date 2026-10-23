/**
 * Task #114 — runtime overlay store for JRX_F_* feature flags.
 *
 * Backed by the `nv_runtime_flag_overrides` table (drizzle migration 0007).
 * Held in an in-memory Map for zero-latency reads from `flagOn()` and
 * refreshed:
 *   - on first access (lazy boot — defensive `CREATE TABLE IF NOT EXISTS`
 *     so a host that has not yet run migrations still works);
 *   - whenever `setOverride()` / `clearOverride()` mutates a row.
 *
 * NV-LLM-001 / NV-ARCH-001 unaffected: this module never emits LLM traffic.
 * NV-DB-SCRIPT-001 unaffected: runs through the canonical drizzle `db`
 * (driver-aware), not the standalone-script `_pg-pool.ts` path.
 */
import { sql } from 'drizzle-orm';
import { db as rawDb } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('runtime-flag-overrides');

export interface OverrideRow {
  logical: string;
  envName: string;
  value: boolean;
  reason: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/**
 * Drizzle's `db.execute()` returns one of two shapes depending on the
 * underlying driver (`pg.QueryResult` vs `@neondatabase/serverless` array
 * result). We type the shapes we actually consume rather than reaching
 * for `any` — keeps the runtime defensive without losing type safety.
 */
interface DbRow {
  logical: unknown;
  env_name: unknown;
  value: unknown;
  reason: unknown;
  updated_by: unknown;
  updated_at: unknown;
}
interface DbExecResult {
  rows?: DbRow[];
  rowCount?: number;
}

function asRows(result: unknown): DbRow[] {
  if (Array.isArray(result)) return result as DbRow[];
  if (result && typeof result === 'object' && Array.isArray((result as DbExecResult).rows)) {
    return (result as DbExecResult).rows as DbRow[];
  }
  return [];
}

function asRowCount(result: unknown): number {
  if (result && typeof result === 'object') {
    const r = result as DbExecResult;
    if (typeof r.rowCount === 'number') return r.rowCount;
    if (Array.isArray(r.rows)) return r.rows.length;
  }
  if (Array.isArray(result)) return result.length;
  return 0;
}

function coerceBool(v: unknown): boolean {
  // Drizzle/Neon may return BOOLEAN as native boolean, 0/1, or 't'/'f'/'true'/'false'.
  return v === true || v === 1 || v === 't' || v === 'true';
}

function coerceTimestamp(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return String(v ?? '');
}

const cache = new Map<string, OverrideRow>();
let booted = false;
let bootInflight: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (!rawDb) return;
  try {
    await rawDb.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_runtime_flag_overrides (
        logical    VARCHAR(64)  PRIMARY KEY,
        env_name   VARCHAR(96)  NOT NULL,
        value      BOOLEAN      NOT NULL,
        reason     TEXT,
        updated_by VARCHAR(100),
        updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
  } catch (err) {
    logger.warn('[flag-overrides] ensureTable failed (continuing with empty cache)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function loadAll(): Promise<void> {
  if (!rawDb) return;
  try {
    const result = await rawDb.execute(sql`
      SELECT logical, env_name, value, reason, updated_by, updated_at
      FROM nv_runtime_flag_overrides
    `);
    const rows = asRows(result);
    cache.clear();
    for (const row of rows) {
      const logical = String(row.logical);
      cache.set(logical, {
        logical,
        envName: String(row.env_name),
        value: coerceBool(row.value),
        reason: row.reason == null ? null : String(row.reason),
        updatedBy: row.updated_by == null ? null : String(row.updated_by),
        updatedAt: coerceTimestamp(row.updated_at),
      });
    }
    logger.info(`[flag-overrides] loaded ${cache.size} overlay row(s)`);
  } catch (err) {
    logger.warn('[flag-overrides] loadAll failed (continuing with empty cache)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function bootIfNeeded(): Promise<void> {
  if (booted) return;
  if (bootInflight) return bootInflight;
  bootInflight = (async () => {
    await ensureTable();
    await loadAll();
    booted = true;
  })();
  try {
    await bootInflight;
  } finally {
    bootInflight = null;
  }
}

/**
 * Synchronous overlay lookup. Returns:
 *   - true  → forced ON  (overlay row, value=true)
 *   - false → forced OFF (overlay row, value=false)
 *   - undefined → no overlay (caller should fall back to env)
 *
 * Callers that need fresh DB state must `await reloadOverrides()` first.
 * `flagOn()` deliberately uses the cache to stay synchronous.
 */
export function getOverride(logical: string): boolean | undefined {
  const row = cache.get(logical);
  return row ? row.value : undefined;
}

export function getOverrideRow(logical: string): OverrideRow | undefined {
  return cache.get(logical);
}

/**
 * Hydration-safe variant of `getOverrideRow`. Awaits the boot sequence
 * (`ensureTable` + `loadAll`) before reading the cache so callers running
 * during a cold-start race — e.g. an admin firing the very first toggle
 * before `initFlagOverrides()` finished — see the true persisted row,
 * not stale `undefined`. Mutation paths (the PATCH route) MUST use this
 * variant so the rollback baseline (`previousValue`) is correct.
 */
export async function getOverrideRowSafe(logical: string): Promise<OverrideRow | undefined> {
  await bootIfNeeded();
  return cache.get(logical);
}

export function listOverrides(): OverrideRow[] {
  return Array.from(cache.values());
}

/**
 * Boot the overlay cache from DB. Safe to call multiple times — only the
 * first call reads; subsequent calls are no-ops until `reloadOverrides()`
 * is called.
 */
export async function initFlagOverrides(): Promise<void> {
  await bootIfNeeded();
}

/** Force a re-read from DB. Used by mutation paths so the in-memory cache
 *  always agrees with the row that was just written. */
export async function reloadOverrides(): Promise<void> {
  await ensureTable();
  await loadAll();
  booted = true;
}

export interface SetOverrideArgs {
  logical: string;
  envName: string;
  value: boolean;
  updatedBy?: string | null;
  reason?: string | null;
}

export async function setOverride(args: SetOverrideArgs): Promise<OverrideRow> {
  await bootIfNeeded();
  if (!rawDb) throw new Error('database unavailable');
  await rawDb.execute(sql`
    INSERT INTO nv_runtime_flag_overrides (logical, env_name, value, reason, updated_by, updated_at)
    VALUES (${args.logical}, ${args.envName}, ${args.value}, ${args.reason ?? null}, ${args.updatedBy ?? null}, NOW())
    ON CONFLICT (logical) DO UPDATE
      SET env_name   = EXCLUDED.env_name,
          value      = EXCLUDED.value,
          reason     = EXCLUDED.reason,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
  `);
  await reloadOverrides();
  return cache.get(args.logical)!;
}

export async function clearOverride(logical: string): Promise<boolean> {
  await bootIfNeeded();
  if (!rawDb) throw new Error('database unavailable');
  const result = await rawDb.execute(sql`
    DELETE FROM nv_runtime_flag_overrides WHERE logical = ${logical}
  `);
  await reloadOverrides();
  return asRowCount(result) > 0;
}
