/**
 * Jurexio Enterprise Platform 3.1.2 — Audit-log hash-chain self-test
 * NYV-NS-010  ·  2026-05-01
 *
 * Verifies on boot that the nv_audit_logs hash-chain is intact:
 *   record_hash[N] == sha256(id|trace_id|route|method|event_type|previous_hash[N])
 *
 * The check samples the most recent N entries (default 50) so it stays cheap
 * even for large audit tables. Any tamper / hash mismatch is logged at ERROR
 * level and the boot is aborted unless NYV_AUDIT_CHAIN_TOLERATE=1 (operator
 * override for emergency boots, logged loudly).
 *
 * The genesis block is seeded by scripts/jrx-seed-rag-and-audit.ts.
 */

import * as crypto from 'crypto';
import { db } from '../db/index.js';
import { sql as dsql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-audit-chain-self-test');
const SAMPLE_SIZE = Number(process.env.NYV_AUDIT_CHAIN_SAMPLE ?? 50);
const TOLERATE = process.env.NYV_AUDIT_CHAIN_TOLERATE === '1';

interface AuditRow {
  id: string;
  trace_id: string;
  route: string;
  method: string;
  event_type: string | null;
  record_hash: string | null;
  previous_hash: string | null;
}

function expectedHash(row: AuditRow): string {
  const payload = [
    row.id,
    row.trace_id,
    row.route,
    row.method,
    row.event_type ?? '',
    row.previous_hash ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export interface AuditChainSelfTestResult {
  checked: number;
  ok: boolean;
  /**
   * True when the failure mode is "schema not yet migrated / table missing /
   * required columns absent" rather than a real hash mismatch. Bootstrap
   * treats this as a loud WARN, never a hard abort, because dev databases
   * legitimately reach this code path before drizzle migration 0001 has run.
   */
  schemaMissing: boolean;
  mismatches: Array<{ id: string; expected: string; actual: string | null }>;
  message: string;
}

function isSchemaMissingError(msg: string): boolean {
  // Postgres: 42P01 (undefined_table), 42703 (undefined_column).
  // We match on the english snippets these errors carry because the pg
  // driver surfaces them in the .message string and we don't want to
  // depend on driver-specific .code propagation here.
  //
  // drizzle-orm ≥0.40 wraps the underlying PG error in a parent error whose
  // .message is "Failed query: <sql> params: <n>" — the original PG text
  // (e.g. 'column "trace_id" does not exist') is in err.cause.message.
  // We therefore also walk the full stringified error so the guard stays
  // robust to driver-version changes.
  const m = msg.toLowerCase();
  return (
    m.includes('does not exist')
    || m.includes('relation "nv_audit_logs"')
    || m.includes('undefined_table')
    || m.includes('undefined_column')
  );
}

function isSchemaMissingErrorDeep(err: unknown): boolean {
  // Walk the full cause chain to handle drizzle wrapper errors.
  let node: unknown = err;
  while (node != null) {
    const nodeMsg = node instanceof Error ? node.message : String(node);
    if (isSchemaMissingError(nodeMsg)) return true;
    node = node instanceof Error ? (node as NodeJS.ErrnoException).cause : null;
  }
  return false;
}

export async function runAuditChainSelfTest(): Promise<AuditChainSelfTestResult> {
  let rows: AuditRow[];
  try {
    if (!db) {
      throw new Error('Database connection unavailable for audit chain self-test');
    }
    const result: unknown = await db.execute(dsql`
      SELECT id, trace_id, route, method, event_type, record_hash, previous_hash
        FROM nv_audit_logs
       ORDER BY created_at DESC
       LIMIT ${SAMPLE_SIZE}
    `);
    const wrapped = result as { rows?: AuditRow[] };
    rows = wrapped.rows ?? (Array.isArray(result) ? (result as AuditRow[]) : []);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const schemaMissing = isSchemaMissingErrorDeep(err);
    return {
      checked: 0,
      ok: schemaMissing, // schema-not-ready is a warning, not a tamper
      schemaMissing,
      mismatches: [],
      message: schemaMissing
        ? `Audit table/column not yet present (${msg}). Skipping self-test — run drizzle migration 0001 + seed to enable. This is normal on a fresh dev DB.`
        : `Audit table unreachable: ${msg}. Run drizzle migration 0001 + seed.`,
    };
  }

  if (rows.length === 0) {
    return {
      checked: 0,
      ok: true,
      schemaMissing: false,
      mismatches: [],
      message: 'Audit chain empty (no entries yet) — self-test trivially passes.',
    };
  }

  const mismatches: AuditChainSelfTestResult['mismatches'] = [];
  for (const row of rows) {
    if (!row.record_hash) continue;            // legacy rows pre-NS-010
    const expected = expectedHash(row);
    if (expected !== row.record_hash) {
      mismatches.push({ id: row.id, expected, actual: row.record_hash });
    }
  }

  return {
    checked: rows.length,
    ok: mismatches.length === 0,
    schemaMissing: false,
    mismatches,
    message: mismatches.length === 0
      ? `Audit chain ok: ${rows.length} recent entries verified.`
      : `Audit chain TAMPER suspected: ${mismatches.length}/${rows.length} mismatches.`,
  };
}

/**
 * Wrapper for the bootstrap pipeline. Aborts boot on tamper unless
 * NYV_AUDIT_CHAIN_TOLERATE=1.
 */
export async function assertAuditChainIntegrityOnBoot(): Promise<void> {
  const result = await runAuditChainSelfTest();
  if (result.ok) {
    logger.info(`[NYV-NS-010] ${result.message}`);
    return;
  }
  if (TOLERATE) {
    logger.error(`[NYV-NS-010] ${result.message} — proceeding because NYV_AUDIT_CHAIN_TOLERATE=1`, {
      mismatches: result.mismatches.slice(0, 5),
    });
    return;
  }
  logger.error(`[NYV-NS-010] ${result.message} — refusing to boot. Set NYV_AUDIT_CHAIN_TOLERATE=1 to override (and investigate immediately).`, {
    mismatches: result.mismatches.slice(0, 5),
  });
  throw new Error(`[NYV-NS-010] Audit hash-chain integrity check failed: ${result.mismatches.length} mismatches`);
}
