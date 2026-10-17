/**
 * NV Persistence Helper — generic write-through cache pattern.
 *
 * Used by ClaWdBot / OpenBot / AutomateAI / TwinDesk to back their in-memory
 * `Map<>`s with a Postgres table. Pattern:
 *
 *    Map<id, T>  ←  hydrate on boot  ←  SELECT * FROM table
 *    Map.set(…)  →  write-through    →  INSERT ... ON CONFLICT DO UPDATE
 *    Map.delete  →  soft delete      →  UPDATE … SET status='archived'
 *
 * This is intentionally simple — no event bus, no leases, single-process.
 * Sufficient for the bot/workflow services where the failure mode is
 * "lost user-visible state" not "privacy violation". For the latter
 * (federated-privacy ε-budget) see `jrx-federated-privacy-service.ts`,
 * which uses SERIALIZABLE transactions directly rather than this helper.
 */

import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-persistence');

export interface PersistOptions {
  table: string;          // qualified name e.g. 'nv_schema.nv_clawdbot_bots'
  pkColumn: string;       // primary key column name in DB
  jsonColumns: string[];  // columns whose value comes from a JS object via JSON.stringify
  scalarColumns?: string[]; // additional scalar columns
}

/**
 * Hydrate a Map from the table. Returns row count loaded.
 */
export async function hydrateMap<T>(
  map: Map<string, T>,
  selectSql: string,
  rowToEntry: (row: any) => [string, T] | null,
): Promise<number> {
  if (!db) {
    logger.warn('hydrateMap: db not available, skipping hydration');
    return 0;
  }
  try {
    const result: any = await db.execute(sql.raw(selectSql));
    const rows: any[] = Array.isArray(result) ? result : (result.rows ?? []);
    let n = 0;
    for (const row of rows) {
      const entry = rowToEntry(row);
      if (entry) { map.set(entry[0], entry[1]); n += 1; }
    }
    logger.info({ msg: 'hydrate complete', selectSql: selectSql.slice(0, 80), rows: n });
    return n;
  } catch (e: any) {
    logger.warn({ msg: 'hydrate failed (table may not exist yet — run db:push)', error: e.message });
    return 0;
  }
}

/**
 * Write-through upsert. Builds a parameterized INSERT … ON CONFLICT DO UPDATE.
 * `values` keys MUST match the DB column names exactly.
 */
export async function upsertRow(
  qualifiedTable: string,
  pkColumn: string,
  values: Record<string, unknown>,
): Promise<void> {
  if (!db) return;
  const cols = Object.keys(values);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = cols.filter(c => c !== pkColumn).map(c => `"${c}" = EXCLUDED."${c}"`);
  const sqlText = `INSERT INTO ${qualifiedTable} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT ("${pkColumn}") DO UPDATE SET ${updates.join(', ')}`;
  const params = cols.map(c => {
    const v = values[c];
    return v && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  try {
    /*
     * NV-PERSIST-UPSERT-001 (2026-08-18) — this function NEVER persisted anything.
     *
     * It previously ran `db.execute(sql.raw(sqlText))` FIRST, with the `$1..$n` placeholders
     * unbound. Postgres rejects that with "there is no parameter $1" (verified live), the
     * throw was swallowed by this very catch block, and the correct `pool.query(sqlText,
     * params)` on the next line was never reached. Every write for all eight consumers
     * (ClaWdBot, OpenBot, AutomateAI, TwinDesk, digital-twin, federated-privacy, and the
     * two RAG audit paths) was silently lost, and the failure surfaced only as a warn.
     *
     * Evidence: `nv_schema.nv_openbot_channels` and `nv_openbot_routes` both held **0 rows**
     * on the live database despite the service having run for months.
     *
     * The fix is to delete the unparameterised call. `pool.query` binds properly and is the
     * only statement that should ever have run.
     */
    const { pool } = await import('../../db/index.js');
    await (pool as any).query(sqlText, params);
  } catch (e: any) {
    logger.warn({ msg: 'upsert failed', table: qualifiedTable, pk: values[pkColumn], error: e.message });
  }
}

/**
 * Soft-delete (UPDATE status='archived'). Falls back to hard DELETE if no
 * status column exists.
 */
export async function softDelete(
  qualifiedTable: string,
  pkColumn: string,
  pkValue: string,
  hasStatusColumn = true,
): Promise<void> {
  if (!db) return;
  try {
    const { pool } = await import('../../db/index.js');
    if (hasStatusColumn) {
      await (pool as any).query(`UPDATE ${qualifiedTable} SET status = 'archived' WHERE "${pkColumn}" = $1`, [pkValue]);
    } else {
      await (pool as any).query(`DELETE FROM ${qualifiedTable} WHERE "${pkColumn}" = $1`, [pkValue]);
    }
  } catch (e: any) {
    logger.warn({ msg: 'softDelete failed', table: qualifiedTable, pk: pkValue, error: e.message });
  }
}

/**
 * Raw SELECT helper (returns rows array)
 */
export async function selectRows(sqlText: string, params: unknown[] = []): Promise<any[]> {
  if (!db) return [];
  try {
    const { pool } = await import('../../db/index.js');
    const result: any = await (pool as any).query(sqlText, params);
    return result.rows ?? [];
  } catch (e: any) {
    logger.warn({ msg: 'selectRows failed', sql: sqlText.slice(0, 80), error: e.message });
    return [];
  }
}
