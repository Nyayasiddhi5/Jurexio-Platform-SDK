#!/usr/bin/env tsx
/**
 * NV-AUDIT-HASH-CHAIN-REPAIR — GAP-002 / UAT-SEC-002
 *
 * Diagnose and optionally repair nv_schema.nv_audit_logs hash chain.
 * Uses the canonical hash SSoT (jrx-audit-hash.ts) — same as appendAuditRecord.
 *
 * Usage:
 *   npx tsx scripts/jrx-audit-hash-chain-repair.ts --diagnose [--limit=10000]
 *   npx tsx scripts/jrx-audit-hash-chain-repair.ts --repair [--full] [--dry-run]
 *
 * Env: DATABASE_URL_ADMIN or DATABASE_URL (admin role required for --repair)
 */
import { Pool } from 'pg';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  normalizeAuditCreatedAt,
  verifyAuditRecordHash,
  type AuditHashRow,
} from '../src/services/jrx-audit-hash.js';

const args = process.argv.slice(2);
const arg = (name: string, def: string) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const flag = (name: string) => args.includes(`--${name}`);

const SAMPLE_LIMIT = parseInt(arg('limit', '10000'), 10);
const DB_URL =
  process.env.DATABASE_URL_ADMIN ||
  process.env.JRX_DATABASE_URL_ADMIN ||
  process.env.DATABASE_URL ||
  process.env.JRX_DATABASE_URL ||
  '';

if (!DB_URL) {
  console.error('FATAL: set DATABASE_URL_ADMIN or DATABASE_URL');
  process.exit(2);
}
if (!flag('diagnose') && !flag('repair')) {
  console.error('Usage: --diagnose | --repair [--full] [--dry-run] [--limit=N]');
  process.exit(2);
}

interface Row {
  id: string;
  event_type: string;
  payload: string | object;
  previous_hash: string;
  record_hash: string;
  created_at: string;
}

async function loadRows(pool: Pool, limit: number): Promise<Row[]> {
  const { rows } = await pool.query<Row>(`
    SELECT id::text AS id, event_type, payload, previous_hash, record_hash,
           created_at::text AS created_at
    FROM nv_schema.nv_audit_logs
    ORDER BY created_at ASC
    LIMIT $1
  `, [limit]);
  return rows;
}

function diagnose(rows: Row[]) {
  let hashMismatches = 0;
  let linkageBreaks = 0;
  let firstHashBreak: string | undefined;
  let firstLinkageBreak: string | undefined;
  let firstRepairIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const rec = rows[i]!;
    const row: AuditHashRow = {
      id: rec.id,
      event_type: rec.event_type,
      payload: rec.payload,
      previous_hash: rec.previous_hash,
      record_hash: rec.record_hash,
      created_at: rec.created_at,
    };

    const hashBad = rec.record_hash && !verifyAuditRecordHash(row);
    if (hashBad) {
      hashMismatches++;
      if (!firstHashBreak) firstHashBreak = rec.id;
      if (firstRepairIndex < 0) firstRepairIndex = i;
    }

    let linkBad = false;
    if (i > 0) {
      const prev = rows[i - 1]!;
      if (prev.record_hash && rec.previous_hash !== prev.record_hash) {
        linkageBreaks++;
        linkBad = true;
        if (!firstLinkageBreak) firstLinkageBreak = rec.id;
        if (firstRepairIndex < 0) firstRepairIndex = i;
      }
    } else if (rec.previous_hash !== AUDIT_GENESIS_HASH) {
      linkageBreaks++;
      linkBad = true;
      if (!firstLinkageBreak) firstLinkageBreak = rec.id;
      if (firstRepairIndex < 0) firstRepairIndex = 0;
    }

    if ((hashBad || linkBad) && firstRepairIndex < 0) firstRepairIndex = i;
  }

  return {
    totalRows: rows.length,
    withHash: rows.filter(r => r.record_hash).length,
    hashMismatches,
    linkageBreaks,
    firstHashBreak,
    firstLinkageBreak,
    firstRepairIndex,
    chainHead: rows.at(-1)?.record_hash?.slice(0, 16) ?? 'none',
  };
}

/** Cascade-rebuild previous_hash + record_hash from startIndex through end. */
function planCascadeRepairs(rows: Row[], startIndex: number): Array<{ id: string; previousHash: string; recordHash: string }> {
  const updates: Array<{ id: string; previousHash: string; recordHash: string }> = [];

  for (let i = Math.max(0, startIndex); i < rows.length; i++) {
    const rec = rows[i]!;
    const expectedPrev = i === 0 ? AUDIT_GENESIS_HASH : rows[i - 1]!.record_hash;
    const createdAtIso = normalizeAuditCreatedAt(rec.created_at);
    const newRecordHash = computeAuditHash(
      rec.id,
      expectedPrev,
      rec.event_type,
      rec.payload,
      createdAtIso,
    );

    if (rec.previous_hash !== expectedPrev || rec.record_hash !== newRecordHash) {
      rec.previous_hash = expectedPrev;
      rec.record_hash = newRecordHash;
      updates.push({ id: rec.id, previousHash: expectedPrev, recordHash: newRecordHash });
    }
  }

  return updates;
}

async function applyCascadeRepairs(
  pool: Pool,
  updates: Array<{ id: string; previousHash: string; recordHash: string }>,
  dryRun: boolean,
): Promise<number> {
  if (updates.length === 0) return 0;
  if (dryRun) return updates.length;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let applied = 0;
    for (const u of updates) {
      const res = await client.query(
        `UPDATE nv_schema.nv_audit_logs
         SET previous_hash = $1, record_hash = $2
         WHERE id::text = $3`,
        [u.previousHash, u.recordHash, u.id],
      );
      applied += res.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return applied;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({
    connectionString: normalizePgConnectionString(DB_URL),
    ssl: DB_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  const totalCount = parseInt(
    (await pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM nv_schema.nv_audit_logs`)).rows[0]?.c ?? '0',
    10,
  );

  const loadLimit = flag('repair') && flag('full') ? totalCount : SAMPLE_LIMIT;

  console.log('=== NV-AUDIT-HASH-CHAIN-REPAIR ===');
  console.log(`table_total=${totalCount} load_limit=${loadLimit} admin_url_len=${DB_URL.length}`);

  const rows = await loadRows(pool, loadLimit);
  let report = diagnose(rows);

  console.log('--- diagnose ---');
  console.log(`sample_rows=${report.totalRows} with_record_hash=${report.withHash}`);
  console.log(`hash_mismatches=${report.hashMismatches} linkage_breaks=${report.linkageBreaks}`);
  console.log(`first_hash_break_id=${report.firstHashBreak ?? 'none'}`);
  console.log(`first_linkage_break_id=${report.firstLinkageBreak ?? 'none'}`);
  console.log(`first_repair_index=${report.firstRepairIndex}`);
  console.log(`chain_head_prefix=${report.chainHead}`);

  if (flag('repair')) {
    const dryRun = flag('dry-run');
    const startIndex = report.firstRepairIndex >= 0 ? report.firstRepairIndex : 0;
    const updates = planCascadeRepairs(rows, startIndex);
    const applied = await applyCascadeRepairs(pool, updates, dryRun);
    console.log('--- repair ---');
    console.log(`cascade_from_index=${startIndex} candidates=${updates.length} applied=${applied} dry_run=${dryRun}`);

    if (!dryRun && applied > 0) {
      const postRows = await loadRows(pool, loadLimit);
      report = diagnose(postRows);
      console.log('--- post-repair ---');
      console.log(`hash_mismatches=${report.hashMismatches} linkage_breaks=${report.linkageBreaks}`);
      console.log(`chain_head_prefix=${report.chainHead}`);
    }
  }

  const ok = report.hashMismatches === 0 && report.linkageBreaks === 0;
  console.log(`verdict=${ok ? 'PASS' : 'FAIL'}`);
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(2);
});
