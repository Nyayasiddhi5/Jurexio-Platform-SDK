import { createLogger } from '../../utils/logger.js';

const logger = createLogger('router-stats');

interface DecisionRecord {
  ts: number;
  agentId?: string;
  tier?: string;
  jurisdiction?: string;
  taskKind?: string;
  requestId?: string;
  primaryModelId: string;
  pickedModelId: string;
  pickedProvider?: string;
  fallbackLevel: number;
  ok: boolean;
  latencyMs: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  errorMessage?: string;
}

const RING_SIZE = 1000;
const ring: DecisionRecord[] = [];
let cursor = 0;

// ── Persistent write-through (RDS) ─────────────────────────────────────────
// Batches up to PERSIST_BATCH records or PERSIST_INTERVAL_MS, then flushes
// asynchronously. Single-flight mutex prevents concurrent flushes from
// racing on the same buffer. On DB error, the entire failed batch is
// re-prepended to the buffer (lossless) and a backoff is applied. The
// buffer is hard-capped at PERSIST_BUFFER_MAX so a long DB outage cannot
// OOM the gateway — when full, oldest records are dropped with a metric.
// Errors never bubble up: the LLM call succeeded; a DB hiccup must not
// look like an LLM failure.
const PERSIST_BATCH = 25;
const PERSIST_INTERVAL_MS = 3_000;
const PERSIST_BUFFER_MAX = 5_000;
const PERSIST_MAX_RETRIES = 3;
const PERSIST_BACKOFF_MS = 5_000;
const persistBuffer: DecisionRecord[] = [];
let persistTimer: NodeJS.Timeout | null = null;
let persistDisabled = false;
let flushInFlight = false;
let consecutiveFailures = 0;
let nextFlushAllowedAt = 0;
let droppedDueToBackpressure = 0;
let droppedAsUnwritable = 0;

/**
 * NV-ROUTER-LOG-WIDTH-001 — column widths of `nv_router_decisions`, mirrored here
 * because the writer uses raw SQL rather than Drizzle and therefore gets no
 * compile-time width checking.
 *
 * Live widths (probed on jrx-staging): request_id/task_kind 64, agent_id 96,
 * primary_model_id/picked_model_id 96, tier/picked_provider 32, jurisdiction 16.
 */
const COL_WIDTHS = {
  requestId: 64,
  agentId: 96,
  tier: 32,
  jurisdiction: 16,
  taskKind: 64,
  modelId: 96,
  provider: 32,
} as const;

/** Clamp to a column width. Returns null for empty so we store NULL, not ''. */
function fit(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const s = String(value);
  if (!s) return null;
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * NV-ROUTER-LOG-WIDTH-001 — reduce a dispatch id to its correlatable parent.
 *
 * `NV-REQID-CORRELATION-001` made every Queen dispatch id parent-scoped
 * (`<parent-uuid>::leaf-swarm-agent-0-1786963251079`, `::synthesis`, `::cot`).
 * That was the right fix for correlation, but it pushed the value past
 * `request_id varchar(64)`, so **every batch containing a Queen leaf failed with
 * `22001` and was retried forever** — head-of-line blocking that silently froze
 * the entire decision history (observed live: 11,394 rows, newest 10:29:04, while
 * traffic continued).
 *
 * Cutting at `::` is deliberately not a blind truncation: the parent UUID is
 * exactly the join key that appears in the API response and in provider log
 * lines, so the row stays correlatable to the request. The leaf suffix is not
 * lost to the platform — span trees already carry per-leaf identity, and it is
 * preserved here in `task_kind` when there is room.
 */
function correlationParent(requestId: string | null | undefined): string | null {
  if (!requestId) return null;
  const raw = String(requestId);
  const sep = raw.indexOf('::');
  return fit(sep > 0 ? raw.slice(0, sep) : raw, COL_WIDTHS.requestId);
}

/** The leaf/stage suffix of a scoped dispatch id, for task_kind enrichment. */
function dispatchStage(requestId: string | null | undefined): string | null {
  if (!requestId) return null;
  const raw = String(requestId);
  const sep = raw.indexOf('::');
  return sep > 0 ? raw.slice(sep + 2) : null;
}

/**
 * Postgres error codes that mean "this data will NEVER be writable".
 * Retrying these is not resilience, it is a permanent stall — the batch fails
 * identically every time while newer records queue behind it.
 */
const UNWRITABLE_SQLSTATES = new Set([
  '22001', // string_data_right_truncation
  '22003', // numeric_value_out_of_range
  '22007', // invalid_datetime_format
  '22P02', // invalid_text_representation
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23505', // unique_violation
  '42703', // undefined_column
  '42P01', // undefined_table
]);

function isUnwritable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return typeof code === 'string' && UNWRITABLE_SQLSTATES.has(code);
}

export function getPersistentLogStats(): {
  bufferLength: number;
  consecutiveFailures: number;
  droppedDueToBackpressure: number;
  droppedAsUnwritable: number;
  disabled: boolean;
} {
  return {
    bufferLength: persistBuffer.length,
    consecutiveFailures,
    droppedDueToBackpressure,
    droppedAsUnwritable,
    disabled: persistDisabled,
  };
}

async function flushPersistent(): Promise<void> {
  if (persistDisabled || persistBuffer.length === 0) return;
  if (flushInFlight) return; // single-flight
  if (Date.now() < nextFlushAllowedAt) {
    scheduleFlush(nextFlushAllowedAt - Date.now());
    return;
  }
  flushInFlight = true;
  const batch = persistBuffer.splice(0, PERSIST_BATCH);
  try {
    // Lazy-import to break circular dep + tolerate missing DB in tests.
    const { pool } = await import('../../db/index.js');
    if (!pool) {
      // No DATABASE_URL configured — silently drop *this batch only*,
      // disable further attempts so we don't spin.
      persistDisabled = true;
      return;
    }
    const values: any[] = [];
    const placeholders: string[] = [];
    let p = 1;
    for (const r of batch) {
      placeholders.push(
        `(to_timestamp($${p++}/1000.0), $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`
      );
      values.push(
        r.ts,
        correlationParent(r.requestId),
        fit(r.agentId, COL_WIDTHS.agentId),
        fit(r.tier, COL_WIDTHS.tier),
        fit(r.jurisdiction, COL_WIDTHS.jurisdiction),
        /* Keep the dispatch stage (leaf / synthesis / cot) visible now that the
         * scoped suffix is stripped from request_id — but only when the caller
         * did not already supply a task kind, which is the more useful label. */
        fit(r.taskKind ?? dispatchStage(r.requestId), COL_WIDTHS.taskKind),
        fit(r.primaryModelId, COL_WIDTHS.modelId),
        fit(r.pickedModelId, COL_WIDTHS.modelId),
        fit(r.pickedProvider, COL_WIDTHS.provider) ?? 'unknown',
        r.fallbackLevel,
        r.ok,
        r.latencyMs,
        r.costUsd,
        r.tokensIn,
        r.tokensOut,
        r.errorMessage ?? null,
      );
    }
    const sql =
      `INSERT INTO nv_router_decisions ` +
      `(ts, request_id, agent_id, tier, jurisdiction, task_kind, primary_model_id, picked_model_id, picked_provider, fallback_level, ok, latency_ms, cost_usd, tokens_in, tokens_out, error_message) ` +
      `VALUES ${placeholders.join(', ')}`;
    await pool.query(sql, values);
    consecutiveFailures = 0;
    // If more records arrived during the flush, keep draining.
    if (persistBuffer.length > 0) scheduleFlush(0);
  } catch (err) {
    consecutiveFailures += 1;
    /* NV-ROUTER-LOG-WIDTH-001 — do not retry data that can never be written.
     *
     * The previous behaviour was unconditional `unshift` + backoff, described as
     * "lossless". Against a transient DB outage it is. Against a permanently
     * invalid row it is a head-of-line block: the same batch fails identically
     * forever, and every later decision queues behind it until the FIFO cap
     * silently discards the newest history. Live evidence: `attempt: 22` on a
     * `22001` (value too long) while the table had not gained a row in minutes.
     *
     * A single unwritable batch is therefore dropped — loudly, with the SQLSTATE
     * and a sample — so the remaining buffer drains. Dropping one batch of
     * telemetry is strictly better than losing all subsequent telemetry, and the
     * ERROR line makes the drop auditable rather than silent. */
    if (isUnwritable(err)) {
      droppedAsUnwritable += batch.length;
      const sample = batch[0];
      logger.error('persistent decision-log batch is permanently unwritable — dropped (not retried)', {
        alertCode: 'JRX-ROUTER-LOG-001',
        sqlstate: (err as { code?: string }).code,
        error: (err as Error).message,
        batchSize: batch.length,
        totalDroppedAsUnwritable: droppedAsUnwritable,
        sampleRequestId: sample?.requestId,
        sampleAgentId: sample?.agentId,
        sampleModelId: sample?.pickedModelId,
      });
      consecutiveFailures = 0;
      if (persistBuffer.length > 0) scheduleFlush(0);
      return;
    }
    logger.warn('persistent decision-log write failed', {
      batchSize: batch.length,
      attempt: consecutiveFailures,
      error: (err as Error).message,
    });
    // Lossless requeue: put the entire failed batch back at the head of
    // the buffer so we retry every record. Apply a buffer cap to bound
    // memory: if the buffer would exceed the cap, drop the oldest
    // overflow (FIFO). Apply exponential backoff up to ~40 s.
    persistBuffer.unshift(...batch);
    if (persistBuffer.length > PERSIST_BUFFER_MAX) {
      const overflow = persistBuffer.length - PERSIST_BUFFER_MAX;
      // FIFO: drop the OLDEST records (front of the buffer) — same policy
      // as the producer-side cap. Newest records survive because they're
      // the ones the operator most wants when investigating an outage.
      persistBuffer.splice(0, overflow);
      droppedDueToBackpressure += overflow;
      logger.error('persistent decision-log buffer overflow — oldest records dropped (FIFO)', {
        dropped: overflow,
        totalDropped: droppedDueToBackpressure,
        bufferMax: PERSIST_BUFFER_MAX,
      });
    }
    if (consecutiveFailures >= PERSIST_MAX_RETRIES) {
      const backoff = PERSIST_BACKOFF_MS * Math.min(8, 2 ** (consecutiveFailures - PERSIST_MAX_RETRIES));
      nextFlushAllowedAt = Date.now() + backoff;
      scheduleFlush(backoff);
    } else {
      scheduleFlush(PERSIST_INTERVAL_MS);
    }
  } finally {
    flushInFlight = false;
  }
}

function scheduleFlush(delayMs: number = PERSIST_INTERVAL_MS): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersistent();
  }, Math.max(0, delayMs));
  // Don't keep the event loop alive just for this.
  if (typeof persistTimer.unref === 'function') persistTimer.unref();
}

export function disablePersistentLog(): void { persistDisabled = true; }
export function enablePersistentLog(): void { persistDisabled = false; }

export function recordDecision(rec: DecisionRecord): void {
  if (ring.length < RING_SIZE) ring.push(rec);
  else ring[cursor] = rec;
  cursor = (cursor + 1) % RING_SIZE;
  if (!persistDisabled) {
    persistBuffer.push(rec);
    // Hard cap on the buffer at the producer side too — handles the
    // pathological case where flush is broken and writes pour in.
    if (persistBuffer.length > PERSIST_BUFFER_MAX) {
      const overflow = persistBuffer.length - PERSIST_BUFFER_MAX;
      persistBuffer.splice(0, overflow);
      droppedDueToBackpressure += overflow;
    }
    if (persistBuffer.length >= PERSIST_BATCH) void flushPersistent();
    else scheduleFlush();
  }
}

export function getRecentDecisions(limit = 100): DecisionRecord[] {
  const sorted = [...ring].sort((a, b) => b.ts - a.ts);
  return sorted.slice(0, limit);
}

export function getAggregates(): {
  totalCalls: number;
  successRate: number;
  byModel: Record<string, { calls: number; ok: number; fail: number; avgLatencyMs: number; totalCostUsd: number }>;
  byTier: Record<string, number>;
  byTask: Record<string, number>;
  byAgent: Record<string, number>;
  byJurisdiction: Record<string, number>;
  fallbackLevelDistribution: Record<number, number>;
} {
  const byModel: Record<string, { calls: number; ok: number; fail: number; latSum: number; totalCostUsd: number }> = {};
  const byTier: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const byJurisdiction: Record<string, number> = {};
  const fallbackLevelDistribution: Record<number, number> = {};
  let okCount = 0;

  for (const r of ring) {
    if (!byModel[r.pickedModelId]) {
      byModel[r.pickedModelId] = { calls: 0, ok: 0, fail: 0, latSum: 0, totalCostUsd: 0 };
    }
    const m = byModel[r.pickedModelId];
    m.calls += 1;
    m.latSum += r.latencyMs;
    m.totalCostUsd += r.costUsd;
    if (r.ok) { m.ok += 1; okCount += 1; } else { m.fail += 1; }

    if (r.tier) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
    if (r.taskKind) byTask[r.taskKind] = (byTask[r.taskKind] ?? 0) + 1;
    if (r.agentId) byAgent[r.agentId] = (byAgent[r.agentId] ?? 0) + 1;
    if (r.jurisdiction) byJurisdiction[r.jurisdiction] = (byJurisdiction[r.jurisdiction] ?? 0) + 1;
    fallbackLevelDistribution[r.fallbackLevel] = (fallbackLevelDistribution[r.fallbackLevel] ?? 0) + 1;
  }

  const byModelOut: Record<string, { calls: number; ok: number; fail: number; avgLatencyMs: number; totalCostUsd: number }> = {};
  for (const [id, v] of Object.entries(byModel)) {
    byModelOut[id] = {
      calls: v.calls,
      ok: v.ok,
      fail: v.fail,
      avgLatencyMs: v.calls ? Math.round(v.latSum / v.calls) : 0,
      totalCostUsd: Number(v.totalCostUsd.toFixed(6)),
    };
  }

  return {
    totalCalls: ring.length,
    successRate: ring.length ? okCount / ring.length : 0,
    byModel: byModelOut,
    byTier,
    byTask,
    byAgent,
    byJurisdiction,
    fallbackLevelDistribution,
  };
}

export function resetStats(): void {
  ring.length = 0;
  cursor = 0;
}

export type { DecisionRecord };
