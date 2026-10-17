/**
 * Jurexio Enterprise Platform 3.1.2 — Vector Store Eviction Job
 * NYV-NS-014  ·  P2 G2  ·  2026-05-01
 *
 * Background eviction loop that keeps `knowledge_chunks` (the RAG vector
 * store) within configurable bounds. Without this, the table grows
 * unboundedly as users upload documents and HNSW index quality degrades.
 *
 * Eviction policy (in order):
 *   1. AGE  — delete rows where updated_at < NOW() - NYV_RAG_MAX_AGE_DAYS.
 *   2. SIZE — if row count still exceeds NYV_RAG_MAX_CHUNKS, delete the
 *             oldest rows (by updated_at ASC) until under cap.
 *
 * Safety
 * ------
 *   - Idempotent and re-entrant: per-pass DELETE caps to NYV_RAG_BATCH_SIZE
 *     so we never lock the table for long.
 *   - Dry-run mode (NYV_RAG_EVICT_DRY_RUN=1) logs what would be deleted
 *     without mutating.
 *   - Disabled entirely when NYV_RAG_EVICT_DISABLED=1.
 *   - Writes a single audit-log row per pass into nv_audit_logs (best-effort,
 *     never fatal — the eviction loop must not be the thing that breaks
 *     the audit chain).
 *
 * Schedule
 * --------
 *   The exported start() is wired into src/index.ts so it boots with the
 *   gateway. Default cadence is 6 hours; configurable via
 *   NYV_RAG_EVICT_INTERVAL_MS.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';

const logger = createLogger('./jrx-vector-eviction');

const DEFAULTS = {
  MAX_AGE_DAYS: 180,
  MAX_CHUNKS: 5_000_000,
  BATCH_SIZE: 5_000,
  INTERVAL_MS: 6 * 60 * 60 * 1000,
};

interface EvictionConfig {
  maxAgeDays: number;
  maxChunks: number;
  batchSize: number;
  intervalMs: number;
  dryRun: boolean;
  disabled: boolean;
}

function readConfig(): EvictionConfig {
  const num = (k: string, d: number) => {
    const v = process.env[k];
    if (!v) return d;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  return {
    maxAgeDays: num('NYV_RAG_MAX_AGE_DAYS', DEFAULTS.MAX_AGE_DAYS),
    maxChunks: num('NYV_RAG_MAX_CHUNKS', DEFAULTS.MAX_CHUNKS),
    batchSize: num('NYV_RAG_BATCH_SIZE', DEFAULTS.BATCH_SIZE),
    intervalMs: num('NYV_RAG_EVICT_INTERVAL_MS', DEFAULTS.INTERVAL_MS),
    dryRun: process.env.NYV_RAG_EVICT_DRY_RUN === '1',
    disabled: process.env.NYV_RAG_EVICT_DISABLED === '1',
  };
}

export interface EvictionStats {
  startedAt: string;
  finishedAt: string;
  ageEvicted: number;
  sizeEvicted: number;
  remaining: number;
  dryRun: boolean;
}

async function tableExists(): Promise<boolean> {
  if (!db) return false;
  try {
    const r: any = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.tables
      WHERE table_name = 'knowledge_chunks' LIMIT 1
    `);
    const rows = (r as any).rows ?? r;
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function countRows(): Promise<number> {
  if (!db) return 0;
  const r: any = await db.execute(sql`SELECT COUNT(*)::bigint AS n FROM knowledge_chunks`);
  const rows = (r as any).rows ?? r;
  const n = rows?.[0]?.n;
  return typeof n === 'string' ? parseInt(n, 10) : Number(n ?? 0);
}

async function evictByAge(cfg: EvictionConfig): Promise<number> {
  if (!db) return 0;
  if (cfg.dryRun) {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::bigint AS n FROM knowledge_chunks
      WHERE updated_at < NOW() - (${cfg.maxAgeDays} || ' days')::interval
    `);
    const rows = (r as any).rows ?? r;
    return Number(rows?.[0]?.n ?? 0);
  }
  // Batched delete using a CTE so we never lock the whole table.
  const r: any = await db.execute(sql`
    WITH victims AS (
      SELECT id FROM knowledge_chunks
      WHERE updated_at < NOW() - (${cfg.maxAgeDays} || ' days')::interval
      ORDER BY updated_at ASC
      LIMIT ${cfg.batchSize}
    )
    DELETE FROM knowledge_chunks
    WHERE id IN (SELECT id FROM victims)
    RETURNING id
  `);
  const rows = (r as any).rows ?? r;
  return Array.isArray(rows) ? rows.length : 0;
}

async function evictBySize(cfg: EvictionConfig, total: number): Promise<number> {
  if (!db) return 0;
  if (total <= cfg.maxChunks) return 0;
  const overshoot = total - cfg.maxChunks;
  const toDelete = Math.min(overshoot, cfg.batchSize);
  if (cfg.dryRun) return toDelete;
  const r: any = await db.execute(sql`
    WITH victims AS (
      SELECT id FROM knowledge_chunks
      ORDER BY updated_at ASC
      LIMIT ${toDelete}
    )
    DELETE FROM knowledge_chunks
    WHERE id IN (SELECT id FROM victims)
    RETURNING id
  `);
  const rows = (r as any).rows ?? r;
  return Array.isArray(rows) ? rows.length : 0;
}

async function writeAuditEntry(stats: EvictionStats): Promise<void> {
  if (!db) return;
  try {
    // NYV-NS-014 (post-architect 2026-05-05): route through the canonical
    // hash-chain audit writer so RAG eviction events are linked into the
    // tamper-evident chain alongside SDK and orchestrator audit records.
    // The previous direct INSERT used columns (event_type, payload) that do
    // not exist in nv_audit_logs (real columns are action, metadata) — the
    // write was silently failing every pass, and broke the hash-chain
    // invariant test (tests/unit/security/hash-chain.test.ts).
    await appendAuditRecord({
      eventType: 'rag.vector.eviction',
      payload: JSON.stringify(stats),
      strict: false,
    });
  } catch (err: any) {
    // Audit chain failures are non-fatal here. The boot-time hash-chain
    // self-test (NYV-NS-010) catches schema problems separately.
    logger.warn(`[NYV-NS-014] audit write skipped: ${err?.message || err}`);
  }
}

export async function runOnce(): Promise<EvictionStats | null> {
  const cfg = readConfig();
  const startedAt = new Date().toISOString();
  if (cfg.disabled) {
    logger.info('[NYV-NS-014] eviction disabled by NYV_RAG_EVICT_DISABLED=1');
    return null;
  }
  if (!(await tableExists())) {
    logger.info('[NYV-NS-014] knowledge_chunks table not present, skipping');
    return null;
  }

  let ageEvicted = 0;
  let sizeEvicted = 0;
  try {
    ageEvicted = await evictByAge(cfg);
    const remainingAfterAge = await countRows();
    sizeEvicted = await evictBySize(cfg, remainingAfterAge);
  } catch (err: any) {
    logger.error(`[NYV-NS-014] eviction failed: ${err?.message || err}`);
    return null;
  }

  const remaining = await countRows();
  const stats: EvictionStats = {
    startedAt,
    finishedAt: new Date().toISOString(),
    ageEvicted,
    sizeEvicted,
    remaining,
    dryRun: cfg.dryRun,
  };

  logger.info(
    `[NYV-NS-014] eviction pass complete: age=${ageEvicted} size=${sizeEvicted} `
    + `remaining=${remaining} dryRun=${cfg.dryRun}`,
  );
  await writeAuditEntry(stats);
  return stats;
}

let timer: NodeJS.Timeout | null = null;

export function start(): void {
  const cfg = readConfig();
  if (cfg.disabled) {
    logger.info('[NYV-NS-014] vector eviction disabled at boot');
    return;
  }
  if (timer) {
    logger.warn('[NYV-NS-014] start() called twice; ignoring');
    return;
  }
  // First pass after a short delay so we don't compete with cold-boot work.
  setTimeout(() => { void runOnce(); }, 60_000).unref();
  timer = setInterval(() => { void runOnce(); }, cfg.intervalMs);
  timer.unref();
  logger.info(
    `[NYV-NS-014] vector eviction scheduled every ${Math.round(cfg.intervalMs / 60000)}m `
    + `(maxAge=${cfg.maxAgeDays}d, maxChunks=${cfg.maxChunks}, dryRun=${cfg.dryRun})`,
  );
}

export function stop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
