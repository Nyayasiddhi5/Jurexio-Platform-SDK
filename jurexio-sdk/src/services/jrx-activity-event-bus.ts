/**
 * NV Activity Event Bus
 * ─────────────────────────────────────────────────────────────────────────────
 * In-process pub/sub for SDK gateway activity events. Powers the Live
 * Activity Feed (gap #4 from Session-15 v3 audit).
 *
 * Design — mirrors `legal-chat-event-bus.ts` so anyone touching one
 * understands the other:
 *   - Single in-memory EventEmitter keyed by orgId.
 *   - Ring buffer of last RING_CAP events per org so /recent endpoint can
 *     hydrate a freshly-mounted UI without waiting for the next call.
 *   - Never throws to publishers. A misbehaving subscriber cannot block the
 *     gateway middleware that calls publish().
 *   - For multi-replica prod: swap the in-memory store for Redis pub/sub
 *     without changing the public API (publishActivity / subscribe / recent).
 *
 * Task #313 — Batched DB persistence
 * ─────────────────────────────────────────────────────────────────────────────
 *  Per-request inserts to `nv_schema.ai_activity` would be expensive on the
 *  hot SDK path. Instead, every event published to the in-memory bus is also
 *  enqueued to a bounded queue that flushes in batches to Postgres:
 *    - Bounded queue (DB_QUEUE_CAP) — when full we drop OLDEST so the most
 *      recent traffic is always preserved (and we record dropped count).
 *    - Flush trigger: every DB_FLUSH_INTERVAL_MS or whenever queue length
 *      reaches DB_BATCH_TARGET — whichever fires first.
 *    - Single multi-row INSERT per flush; ON CONFLICT (trace_id) DO NOTHING
 *      so retries / overlap with the Task #301 seed are harmless.
 *    - Failure budget: after DB_MAX_CONSECUTIVE_FAILURES failures the writer
 *      opens its circuit for DB_BACKOFF_MS, during which it stops attempting
 *      DB writes (the in-memory bus and ring buffer keep working). On the
 *      first success after recovery, the failure counter resets.
 *    - Never blocks publishers; never throws.
 *
 * Guardrails honored:
 *   - NV-ARCH-001: no LLM emission, pure metadata fan-out.
 *   - NV-NAMING-001: grep first showed no `jrx-activity-event-bus` exists.
 *   - NV-LLM-001: not in the LLM-emit path.
 */

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

export interface SdkActivityEvent {
  orgId: string;
  requestId: string;
  ts: number;
  method: string;
  route: string;
  status: number;
  ms: number;
  sdkKeyPrefix?: string | null;
  platformCode?: string | null;
  scope?: string | null;
  userAgent?: string | null;
  // Task #301 — additive fields used by the Live Activity Feed filter UI
  // (jurisdiction header propagated from SDK auth context; `agent` is the
  // routed agent key when a downstream handler attaches `req.routedAgent`;
  // `eventType` is the route-prefix categorisation produced by
  // `deriveEventType` in jrx-activity-stream-routes). All default to null so
  // older publishers stay forward-compatible.
  jurisdiction?: string | null;
  agent?: string | null;
  eventType?: string | null;
  // NV-AUDIT-TOKENS-001 — real per-request LLM usage accumulated by
  // recordLlmUsage() and read off res.locals.nvUsage by the activity publisher.
  // All default to null/0 so older publishers stay forward-compatible.
  tokensUsed?: number | null;
  modelProvider?: string | null;
  modelName?: string | null;
  costUsd?: number | null;
}

const RING_CAP = 200;
const MAX_LISTENERS = 256;

// ─── Batched DB persistence tunables (Task #313) ──────────────────────────
const DB_QUEUE_CAP = 5_000;            // hard upper bound on in-flight queue
const DB_BATCH_TARGET = 100;           // flush early when this many queued
const DB_BATCH_MAX = 500;              // never flush more than this per insert
const DB_FLUSH_INTERVAL_MS = 1_500;    // periodic flush cadence
const DB_MAX_CONSECUTIVE_FAILURES = 5; // open circuit after this many fails
const DB_BACKOFF_MS = 30_000;          // circuit-open duration

const logger = createLogger('./jrx-activity-event-bus');

interface PersistStats {
  enqueued: number;
  flushed: number;
  failed: number;
  dropped: number;
  consecutiveFailures: number;
  circuitOpenUntil: number;
  lastFlushAt: number;
  lastErrorMessage: string | null;
  queueDepth: number;
}

class NvActivityEventBus {
  private bus = new EventEmitter();
  private rings = new Map<string, SdkActivityEvent[]>();

  // Batched persistence state — kept private; expose via stats() for tests/ops.
  private dbQueue: SdkActivityEvent[] = [];
  private dbTimer: NodeJS.Timeout | null = null;
  private flushInFlight = false;
  private stats: PersistStats = {
    enqueued: 0,
    flushed: 0,
    failed: 0,
    dropped: 0,
    consecutiveFailures: 0,
    circuitOpenUntil: 0,
    lastFlushAt: 0,
    lastErrorMessage: null,
    queueDepth: 0,
  };

  constructor() {
    this.bus.setMaxListeners(MAX_LISTENERS);
    // Tests and short-lived scripts must not be kept alive by the timer.
    this.dbTimer = setInterval(() => { void this.flush(); }, DB_FLUSH_INTERVAL_MS);
    this.dbTimer.unref?.();
  }

  publish(ev: SdkActivityEvent): void {
    try {
      const key = ev.orgId || '_global';
      const ring = this.rings.get(key) ?? [];
      ring.push(ev);
      if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);
      this.rings.set(key, ring);
      this.bus.emit(`activity:${key}`, ev);
      this.bus.emit('activity:_global', ev);
      this.enqueueForDb(ev);
    } catch {
      /* never throw to caller */
    }
  }

  subscribe(orgId: string, fn: (ev: SdkActivityEvent) => void): () => void {
    const key = `activity:${orgId || '_global'}`;
    this.bus.on(key, fn);
    return () => { try { this.bus.off(key, fn); } catch { /* ignore */ } };
  }

  recent(orgId: string, limit = 50): SdkActivityEvent[] {
    const key = orgId || '_global';
    const ring = this.rings.get(key) ?? [];
    const lim = Math.max(1, Math.min(RING_CAP, Math.floor(limit)));
    return ring.slice(-lim).reverse();
  }

  // ─── Batched DB persistence (Task #313) ──────────────────────────────────

  /** Read-only snapshot of persistence health for /health & tests. */
  getPersistenceStats(): Readonly<PersistStats> {
    return { ...this.stats, queueDepth: this.dbQueue.length };
  }

  /** Force a flush — used by graceful shutdown and integration tests. */
  async flushNow(): Promise<void> { await this.flush(); }

  private enqueueForDb(ev: SdkActivityEvent): void {
    // Skip when there's no DB wired (dev without JRX_DATABASE_URL, unit tests).
    if (!db) return;
    this.dbQueue.push(ev);
    this.stats.enqueued++;
    if (this.dbQueue.length > DB_QUEUE_CAP) {
      const overflow = this.dbQueue.length - DB_QUEUE_CAP;
      this.dbQueue.splice(0, overflow);     // drop OLDEST — keep newest traffic
      this.stats.dropped += overflow;
    }
    if (this.dbQueue.length >= DB_BATCH_TARGET) {
      // fire-and-forget; flush() guards against concurrent runs itself.
      void this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushInFlight) return;
    if (!db) return;
    if (this.dbQueue.length === 0) return;
    const now = Date.now();
    if (this.stats.circuitOpenUntil > now) return;  // circuit still open

    this.flushInFlight = true;
    const batch = this.dbQueue.splice(0, DB_BATCH_MAX);
    try {
      await this.writeBatch(batch);
      this.stats.flushed += batch.length;
      this.stats.lastFlushAt = Date.now();
      this.stats.consecutiveFailures = 0;
      this.stats.lastErrorMessage = null;
    } catch (err: unknown) {
      this.stats.failed += batch.length;
      this.stats.consecutiveFailures++;
      this.stats.lastErrorMessage = err instanceof Error ? err.message : String(err);
      // Don't requeue: the rows are already retained in the ring buffer for
      // live consumers, and reattempting the same failing batch forever
      // would just amplify the outage. Log once per failure for visibility.
      logger.warn('activity_db_flush_failed', {
        size: batch.length,
        consecutiveFailures: this.stats.consecutiveFailures,
        err: this.stats.lastErrorMessage,
      });
      if (this.stats.consecutiveFailures >= DB_MAX_CONSECUTIVE_FAILURES) {
        this.stats.circuitOpenUntil = Date.now() + DB_BACKOFF_MS;
        logger.warn('activity_db_circuit_open', { backoffMs: DB_BACKOFF_MS });
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  private async writeBatch(batch: SdkActivityEvent[]): Promise<void> {
    if (batch.length === 0) return;
    // Build one parameterised multi-row INSERT. trace_id is UNIQUE on
    // nv_schema.ai_activity (see jrx-governance-schema.ts) so reruns or
    // overlap with the Task #301 seed are no-ops. prompt_hash is NOT NULL
    // so we synthesise a stable hash from requestId+ts.
    const rowFragments = batch.map((ev) => {
      const traceId = ev.requestId || `jrx-act-${ev.ts}-${Math.random().toString(36).slice(2, 10)}`;
      const promptHash = createHash('sha256').update(`${traceId}|${ev.ts}|${ev.route}`).digest('hex');
      const jurisdiction = (ev.jurisdiction || 'IN').toUpperCase();
      const patternKey = ev.agent ?? ev.scope ?? null;
      const route = ev.route || '/api/jrx/';
      const blocked = ev.status >= 400;
      // NV-AUDIT-TOKENS-001 — prefer the real model provider/name from the
      // request's accumulated LLM usage; fall back to the SDK platform code.
      const provider = ev.modelProvider ?? ev.platformCode ?? 'gateway';
      const modelName = ev.modelName ?? null;
      const tokensUsed = Math.max(0, Math.floor(Number(ev.tokensUsed) || 0));
      const costUsd = Math.max(0, Number(ev.costUsd) || 0);
      const latency = Math.max(0, Math.floor(ev.ms || 0));
      const createdAt = new Date(ev.ts || Date.now()).toISOString();
      return sql`(
        ${traceId}, ${ev.orgId || '_global'}, ${jurisdiction}, ${patternKey}, ${route},
        ${'STRICT'}, ${0}, ${promptHash}, ${blocked}, ${provider},
        ${modelName}, ${tokensUsed}, ${costUsd}, ${latency}, ${createdAt}::timestamptz, ${true}
      )`;
    });
    const values = sql.join(rowFragments, sql`, `);
    if (!db) return;
    await db.execute(sql`
      INSERT INTO nv_schema.ai_activity (
        trace_id, user_id, jurisdiction, pattern_key, route,
        template_mode, risk_score, prompt_hash, blocked, model_provider,
        model_name, tokens_used, cost_usd, latency_ms, created_at, jurisdiction_validated
      ) VALUES ${values}
      ON CONFLICT (trace_id) DO NOTHING
    `);
  }
}

export const nvActivityEventBus = new NvActivityEventBus();
