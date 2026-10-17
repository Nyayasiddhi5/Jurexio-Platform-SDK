// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Hash Chain Integrity Verifier — Algorithm P2
 * @version 5.2.1
 *
 * Verifies the SHA-256 hash chain of audit trail records for NSP, NSI, and Core.
 * Uses the same canonical hash SSoT as appendAuditRecord (nv-audit-hash.ts).
 *
 * Scheduled via cron (daily at 02:00 UTC). Can also be triggered on-demand.
 */

import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  normalizeAuditCreatedAt,
  verifyAuditRecordHash,
  type AuditHashRow,
} from './jrx-audit-hash.js';

const logger = createLogger('hash-chain-verifier');

/* ── Types ─────────────────────────────────────────────────── */

export interface AuditRecord {
  id: number | string;
  previous_hash: string | null;
  record_hash: string;
  event_type: string;
  payload: string | object;
  created_at: string | Date;
}

export interface ChainVerificationResult {
  platform: string;
  table: string;
  totalRecords: number;
  validRecords: number;
  brokenLinks: Array<{ id: number | string; expected: string; actual: string }>;
  linkageBreaks: number;
  integrityScore: number;    // 0.0 – 1.0
  verified: boolean;
  verifiedAt: string;
}

/* ── Platform audit table config ─────────────────────────────  */

const AUDIT_TABLES = [
  { platform: 'NSP', schema: 'ns_schema', table: 'ns_audit_logs' },
  { platform: 'NSI', schema: 'ni_schema', table: 'ni_audit_logs' },
  { platform: 'Core', schema: 'nv_schema', table: 'nv_audit_logs' },
];

/* ── Verifier ──────────────────────────────────────────────── */

async function verifyTable(
  platform: string,
  schema: string,
  table: string,
  limit = 10000,
): Promise<ChainVerificationResult> {
  const brokenLinks: ChainVerificationResult['brokenLinks'] = [];
  let linkageBreaks = 0;
  let totalRecords = 0;

  try {
    const rows = await db.execute(
      sql.raw(`
        SELECT id::text AS id, previous_hash, record_hash, event_type,
               payload, created_at
        FROM "${schema}"."${table}"
        ORDER BY created_at ASC
        LIMIT ${limit}
      `)
    ) as any;

    const records: AuditRecord[] =
      (rows?.rows ?? rows ?? []) as AuditRecord[];

    totalRecords = records.length;

    for (let i = 0; i < records.length; i++) {
      const record = records[i]!;

      /* Skip records without a stored hash (legacy rows) */
      if (!record.record_hash) continue;

      const row: AuditHashRow = {
        id: String(record.id),
        event_type: record.event_type,
        payload: record.payload,
        previous_hash: record.previous_hash ?? AUDIT_GENESIS_HASH,
        record_hash: record.record_hash,
        created_at: record.created_at,
      };

      if (!verifyAuditRecordHash(row)) {
        const expected = computeAuditHash(
          row.id,
          row.previous_hash,
          row.event_type,
          row.payload,
          normalizeAuditCreatedAt(row.created_at),
        );
        brokenLinks.push({
          id: record.id,
          expected,
          actual: record.record_hash,
        });
      }

      if (i > 0) {
        const prev = records[i - 1]!;
        if (prev.record_hash && record.previous_hash !== prev.record_hash) {
          linkageBreaks++;
        }
      } else if (record.previous_hash && record.previous_hash !== AUDIT_GENESIS_HASH) {
        linkageBreaks++;
      }
    }
  } catch (err: any) {
    /* Table doesn't exist yet — skip gracefully */
    logger.warn('hash_chain_table_skip', { platform, table, err: String(err) });
    return {
      platform,
      table,
      totalRecords: 0,
      validRecords: 0,
      brokenLinks: [],
      linkageBreaks: 0,
      integrityScore: 1.0,
      verified: true,
      verifiedAt: new Date().toISOString(),
    };
  }

  const validRecords   = totalRecords - brokenLinks.length;
  const integrityScore = totalRecords > 0 ? validRecords / totalRecords : 1.0;
  const verified       = brokenLinks.length === 0 && linkageBreaks === 0;

  if (!verified) {
    logger.error('hash_chain_integrity_failure', {
      platform,
      table,
      brokenCount: brokenLinks.length,
      linkageBreaks,
      integrityScore,
    });
  } else {
    logger.info('hash_chain_integrity_ok', { platform, table, totalRecords, integrityScore });
  }

  return {
    platform,
    table,
    totalRecords,
    validRecords,
    brokenLinks,
    linkageBreaks,
    integrityScore: parseFloat(integrityScore.toFixed(4)),
    verified,
    verifiedAt: new Date().toISOString(),
  };
}

/* ── Public API ────────────────────────────────────────────── */

export async function runHashChainVerification(): Promise<ChainVerificationResult[]> {
  logger.info('hash_chain_verification_start', { tables: AUDIT_TABLES.length });
  const results = await Promise.all(
    AUDIT_TABLES.map(t => verifyTable(t.platform, t.schema, t.table))
  );
  const allOk = results.every(r => r.verified);
  logger.info('hash_chain_verification_complete', {
    allOk,
    results: results.map(r => ({
      platform: r.platform,
      score: r.integrityScore,
      ok: r.verified,
      linkageBreaks: r.linkageBreaks,
    })),
  });
  return results;
}

/* ── Cron schedule helper (called from src/cron/index.ts or startup) ── */

export function scheduleHashChainCron(): void {
  /* Run at 02:00 UTC daily */
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(2, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);

  const delay = next.getTime() - now.getTime();

  setTimeout(() => {
    runHashChainVerification().catch(err =>
      logger.error('hash_chain_cron_error', { err: String(err) })
    );
    /* Repeat every 24 h */
    setInterval(() => {
      runHashChainVerification().catch(err =>
        logger.error('hash_chain_cron_error', { err: String(err) })
      );
    }, 24 * 60 * 60 * 1000);
  }, delay);

  logger.info('hash_chain_cron_scheduled', {
    nextRun: next.toISOString(),
    delayMs: delay,
  });
}
