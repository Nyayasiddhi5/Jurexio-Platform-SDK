/**
 * NV Data-Retention Sweep (NV-RETENTION-TTL-001)
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategic P1 (data governance / DPDPA·GDPR storage-limitation): a real,
 * scheduled retention sweep that ages out telemetry/ephemeral rows past their
 * retention window and hard-deletes records whose explicit TTL (expires_at) has
 * elapsed. Because the row is physically DELETEd, any encrypted companion
 * columns (bytea) on that row are removed with it — i.e. encrypted hard-delete.
 *
 * SAFETY POSTURE (important — this deletes data):
 *   • Gated OFF by default. The sweep only runs when JRX_F_RETENTION_SWEEP=1.
 *   • DRY-RUN by default even when the timer is on: it logs the row counts it
 *     WOULD delete. Actual deletion only happens when JRX_RETENTION_APPLY=1.
 *   • Every policy is guarded by `to_regclass` (table exists) and a column
 *     existence check, so a missing table/column is skipped, never an error.
 *   • Conservative windows; audit/ledger tables (nv_audit_logs, data_lineage_
 *     events) are intentionally NOT swept here — legal-hold/audit retention is
 *     governed separately.
 *
 * Wire-up: src/index.ts calls startRetentionSweep() (daily cadence). Manual
 * runs available via runRetentionSweep({ apply }).
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';

const logger = createLogger('./jrx-retention');

type RetentionMode =
  | { kind: 'age'; tsColumn: string; ttlDays: number } // delete rows where tsColumn < now - ttlDays
  | { kind: 'expired'; tsColumn: string };             // delete rows where tsColumn < now (explicit TTL)

export interface RetentionPolicy {
  schema: string;
  table: string;
  mode: RetentionMode;
  /** Optional extra SQL predicate (already-safe literal), e.g. "status = 'completed'". */
  extraWhere?: string;
  note: string;
}

// Conservative, telemetry-first policy set. Tune windows via follow-up once
// per-tenant retention contracts are formalised.
export const RETENTION_POLICIES: RetentionPolicy[] = [
  { schema: 'nv_schema', table: 'ai_activity',          mode: { kind: 'age', tsColumn: 'created_at', ttlDays: 365 }, note: 'AI activity telemetry — 1y' },
  { schema: 'nv_schema', table: 'mcp_tool_executions',  mode: { kind: 'age', tsColumn: 'created_at', ttlDays: 90 },  note: 'MCP tool exec telemetry — 90d' },
  { schema: 'nv_schema', table: 'async_job_queue',      mode: { kind: 'age', tsColumn: 'completed_at', ttlDays: 30 }, extraWhere: "status = 'completed'", note: 'Completed async jobs — 30d' },
  { schema: 'nv_schema', table: 'mem0_memories',        mode: { kind: 'expired', tsColumn: 'expires_at' }, note: 'mem0 memories past explicit TTL' },
  { schema: 'nv_schema', table: 'memory_entries',       mode: { kind: 'expired', tsColumn: 'expires_at' }, note: 'tiered memory entries past explicit TTL' },
];

export interface RetentionPolicyResult {
  table: string;
  matched: number;
  deleted: number;
  skipped?: string;
}

export interface RetentionReport {
  applied: boolean;
  ranAt: string;
  results: RetentionPolicyResult[];
  totalMatched: number;
  totalDeleted: number;
}

async function tableHasColumn(schema: string, table: string, column: string): Promise<boolean> {
  if (!db) return false;
  const r: any = await db.execute(sql`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `);
  return (((r as any).rows ?? r) || []).length > 0;
}

function whereClause(p: RetentionPolicy): string {
  const col = `"${p.mode.tsColumn}"`;
  const base = p.mode.kind === 'age'
    ? `${col} < NOW() - INTERVAL '${p.mode.ttlDays} days'`
    : `${col} IS NOT NULL AND ${col} < NOW()`;
  return p.extraWhere ? `${base} AND ${p.extraWhere}` : base;
}

/**
 * Run one retention pass. `apply` defaults to the JRX_RETENTION_APPLY env so the
 * scheduled timer is dry-run unless explicitly opted in.
 */
export async function runRetentionSweep(opts?: { apply?: boolean }): Promise<RetentionReport> {
  const apply = opts?.apply ?? (process.env.JRX_RETENTION_APPLY === '1');
  const results: RetentionPolicyResult[] = [];
  let totalMatched = 0;
  let totalDeleted = 0;

  if (!db) {
    return { applied: false, ranAt: new Date().toISOString(), results: [{ table: '(none)', matched: 0, deleted: 0, skipped: 'no db' }], totalMatched: 0, totalDeleted: 0 };
  }

  for (const p of RETENTION_POLICIES) {
    const fq = `${p.schema}.${p.table}`;
    try {
      const reg: any = await db.execute(sql`SELECT to_regclass(${fq}) AS oid`);
      const exists = (((reg as any).rows ?? reg)[0]?.oid) != null;
      if (!exists) { results.push({ table: fq, matched: 0, deleted: 0, skipped: 'table missing' }); continue; }
      if (!(await tableHasColumn(p.schema, p.table, p.mode.tsColumn))) {
        results.push({ table: fq, matched: 0, deleted: 0, skipped: `column ${p.mode.tsColumn} missing` });
        continue;
      }

      const where = whereClause(p);
      const cntRes: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${p.schema}."${p.table}" WHERE ${where}`));
      const matched = Number((((cntRes as any).rows ?? cntRes)[0]?.n) || 0);
      totalMatched += matched;

      let deleted = 0;
      if (apply && matched > 0) {
        const delRes: any = await db.execute(sql.raw(`DELETE FROM ${p.schema}."${p.table}" WHERE ${where}`));
        deleted = Number((delRes as any).rowCount ?? matched);
        totalDeleted += deleted;
      }
      results.push({ table: fq, matched, deleted });
    } catch (err: any) {
      results.push({ table: fq, matched: 0, deleted: 0, skipped: `error: ${err?.message ?? err}` });
    }
  }

  logger.info('retention_sweep', { apply, totalMatched, totalDeleted, results });
  return { applied: apply, ranAt: new Date().toISOString(), results, totalMatched, totalDeleted };
}

let _interval: NodeJS.Timeout | null = null;

/** Start the daily retention timer. No-op unless JRX_F_RETENTION_SWEEP is on. */
export function startRetentionSweep(intervalMs = 24 * 60 * 60 * 1000): { stop: () => void } {
  if (!isJrxFeatureOn('retentionSweep')) {
    logger.info('retention_sweep_disabled', { reason: 'JRX_F_RETENTION_SWEEP not enabled' });
    return { stop: () => {} };
  }
  // First pass shortly after boot, then on the interval.
  const kick = setTimeout(() => { void runRetentionSweep().catch((e) => logger.warn('retention_first_pass_failed', { err: String(e) })); }, 60_000);
  if (typeof (kick as any).unref === 'function') (kick as any).unref();
  _interval = setInterval(() => { void runRetentionSweep().catch((e) => logger.warn('retention_pass_failed', { err: String(e) })); }, intervalMs);
  if (typeof (_interval as any).unref === 'function') (_interval as any).unref();
  logger.info('retention_sweep_started', { intervalMs, apply: process.env.JRX_RETENTION_APPLY === '1' });
  return { stop: () => { if (_interval) clearInterval(_interval); _interval = null; } };
}
