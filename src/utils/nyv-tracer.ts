/**
 * NYV-OBS-TRACER-001 (Task #28) — Structured spans for Queen lifecycle.
 *
 * Goal: every orchestration phase (rag → decompose → assign → execute →
 * synthesis) gets a measurable span with consistent tags so we can answer
 * "where did the last 200 orchestrations spend their time?" in one query.
 *
 * Two backends, picked at startup:
 *
 *   1) Sentry (preferred) — when @sentry/node is installed AND
 *      NYV_SENTRY_DSN / SENTRY_DSN is set, spans become real Sentry
 *      transactions/spans visible on the Sentry Performance dashboard.
 *      We optional-import to avoid a hard dep when running in dev with
 *      no DSN.
 *
 *   2) Structured JSONL fallback — always-on. We write one log line per
 *      span finish with { span, traceId, parentId, durationMs, status,
 *      tags } so log aggregators (CloudWatch Insights, Loki) can group
 *      by `span` field even when Sentry is not configured.
 *
 * Latency ring-buffer: we also keep the last N samples per span name in
 * memory, so /api/jrx/health/full can report p50/p95 durations without
 * needing to call out to Sentry.
 */

import { createLogger } from './logger.js';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

const logger = createLogger('tracer');

type SpanStatus = 'ok' | 'error' | 'cancelled';

export interface SpanTags {
  [key: string]: string | number | boolean | undefined | null;
}

export interface NyvSpan {
  name: string;
  traceId: string;
  parentId?: string;
  spanId: string;
  startMs: number;
  tags: SpanTags;
  finish(status?: SpanStatus, extra?: SpanTags): void;
  setTag(key: string, value: string | number | boolean): void;
  /** True when running under a real Sentry tracer; false for JSONL fallback. */
  readonly sentryBacked: boolean;
}

/* ───────── Sentry backend (optional) ───────── */

interface SentryTracer {
  startSpan: <T>(opts: { name: string; op?: string; attributes?: SpanTags }, cb: (span: any) => T) => T;
  startInactiveSpan: (opts: { name: string; op?: string; attributes?: SpanTags }) => any;
  init: (opts: { dsn: string; environment?: string; tracesSampleRate?: number; release?: string }) => void;
}

let sentryReady = false;
let sentryMod: SentryTracer | null = null;
const SENTRY_DSN = (process.env.NYV_SENTRY_DSN || process.env.SENTRY_DSN || '').trim();

/**
 * Best-effort Sentry initialization. Safe to call multiple times; only
 * the first call wins. Failures are logged once and we silently fall
 * back to JSONL spans.
 */
export async function initTracer(): Promise<void> {
  if (sentryReady || sentryMod) return;
  if (!SENTRY_DSN) {
    logger.info('Tracer: NYV_SENTRY_DSN not set — using JSONL span fallback');
    return;
  }
  try {
    const mod: any = await import('@sentry/node').catch(() => null);
    if (!mod?.init) {
      logger.info('Tracer: @sentry/node not installed — using JSONL span fallback');
      return;
    }
    mod.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.NYV_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
      release: process.env.NYV_DEPLOY_ID || `nyv-${process.env.npm_package_version || '3.1.2'}`,
    });
    sentryMod = mod as SentryTracer;
    sentryReady = true;
    logger.info('Tracer: Sentry backend active', {
      env: process.env.NODE_ENV,
      sampleRate: Number(process.env.NYV_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    });
  } catch (e) {
    logger.warn('Tracer: Sentry init failed — JSONL fallback', { err: String(e) });
  }
}

/* ───────── Latency ring buffer ───────── */

const RING_SIZE = 200;
const ringBuffers = new Map<string, number[]>();

// Task #28 follow-up: tagged latency buckets so /admin/health/full can
// expose latency broken down by orchestration pattern × jurisdiction
// without a separate metrics store. Key is `${spanName}|${tagKey}=${tagValue}`.
// Capped at 64 buckets per span name to bound memory.
const TAGGED_RING_SIZE = 100;
const MAX_BUCKETS_PER_SPAN = 64;
const taggedRingBuffers = new Map<string, number[]>();
const taggedBucketCount = new Map<string, number>();

// NYV-OBS-TRACKED-TAGS-001 (Task #28 round 4): tenantId added so
// /admin/health/full → tracer.spanLatenciesByTag actually surfaces
// "p95 by tenant" without re-deriving from raw JSONL. The cardinality
// is bounded by MAX_BUCKETS_PER_SPAN (64) so a noisy tenant cannot
// blow the in-memory ring set.
const TRACKED_TAG_KEYS = ['orchestrationPattern', 'jurisdiction', 'tier', 'agentTier', 'tenantId'];

function pushSample(name: string, durationMs: number): void {
  let buf = ringBuffers.get(name);
  if (!buf) {
    buf = [];
    ringBuffers.set(name, buf);
  }
  buf.push(durationMs);
  if (buf.length > RING_SIZE) buf.shift();
}

function pushTaggedSamples(name: string, durationMs: number, tags: SpanTags): void {
  // NYV-OBS-CARDINALITY-CAP-001 (Task #28 round 6): the previous version
  // hoisted `perSpan` once at the top of the function and then wrote
  // `perSpan + 1` for every newly-created bucket inside the loop —
  // because the local was never re-read, all new buckets in a single
  // call recorded the same count, weakening the MAX_BUCKETS_PER_SPAN
  // guard and letting the cap drift well past 64 once high-cardinality
  // tags like tenantId entered the set. Track `count` as a live local
  // and recommit it on every successful insertion.
  let count = taggedBucketCount.get(name) ?? 0;
  for (const k of TRACKED_TAG_KEYS) {
    const v = tags[k];
    if (v === undefined || v === null || v === '') continue;
    const key = `${name}|${k}=${String(v)}`;
    let buf = taggedRingBuffers.get(key);
    if (!buf) {
      if (count >= MAX_BUCKETS_PER_SPAN) continue; // budget exhausted
      buf = [];
      taggedRingBuffers.set(key, buf);
      count += 1;
      taggedBucketCount.set(name, count);
    }
    buf.push(durationMs);
    if (buf.length > TAGGED_RING_SIZE) buf.shift();
  }
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export interface SpanLatencyStats {
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export function getSpanLatencies(): Record<string, SpanLatencyStats> {
  const out: Record<string, SpanLatencyStats> = {};
  for (const [name, buf] of ringBuffers.entries()) {
    out[name] = {
      count: buf.length,
      p50Ms: percentile(buf, 50),
      p95Ms: percentile(buf, 95),
      p99Ms: percentile(buf, 99),
      maxMs: buf.reduce((m, v) => (v > m ? v : m), 0),
    };
  }
  return out;
}

/**
 * Latency aggregates broken down by tag — answers "what's p95 for
 * queen.orchestrate when jurisdiction=IN vs UK?" or "...by orchestrationPattern".
 * Only the tag keys in TRACKED_TAG_KEYS are bucketed (orchestrationPattern,
 * jurisdiction, tier, agentTier).
 *
 * Shape: { [spanName]: { [tagKey]: { [tagValue]: SpanLatencyStats } } }
 */
export function getTaggedSpanLatencies(): Record<string, Record<string, Record<string, SpanLatencyStats>>> {
  const out: Record<string, Record<string, Record<string, SpanLatencyStats>>> = {};
  for (const [key, buf] of taggedRingBuffers.entries()) {
    const pipe = key.indexOf('|');
    if (pipe < 0) continue;
    const name = key.slice(0, pipe);
    const eq = key.indexOf('=', pipe + 1);
    if (eq < 0) continue;
    const tagKey = key.slice(pipe + 1, eq);
    const tagValue = key.slice(eq + 1);
    const stats: SpanLatencyStats = {
      count: buf.length,
      p50Ms: percentile(buf, 50),
      p95Ms: percentile(buf, 95),
      p99Ms: percentile(buf, 99),
      maxMs: buf.reduce((m, v) => (v > m ? v : m), 0),
    };
    (out[name] ??= {});
    (out[name][tagKey] ??= {});
    out[name][tagKey][tagValue] = stats;
  }
  return out;
}

export function _resetSpanLatencies(): void {
  ringBuffers.clear();
  taggedRingBuffers.clear();
  taggedBucketCount.clear();
}

/* ───────── Span API ───────── */

/**
 * NYV-OBS-SPAN-CONTEXT-001 (Task #61): two complementary AsyncLocalStorage
 * slots that together replace the untyped `request.__rootSpan` escape hatch
 * the queen orchestrator used to thread per-run parenting through.
 *
 *   • `spanContext` — the *ambient* current span. Updated by `withSpan()`
 *     so any `startSpan()` deep inside a phase callback auto-parents to
 *     the immediately-enclosing span (e.g. queen.synthesis → queen.llm.call).
 *
 *   • `runRootContext` — the *run's root* span, pinned for the entire
 *     orchestration. Read via `getRunRootSpan()` by callsites that must
 *     parent directly to the root regardless of how deeply they're
 *     nested inside other phase spans (e.g. per-agent `queen.agent`
 *     spans, which the original `__rootSpan` design parented directly
 *     to `queen.orchestrate`, NOT to the enclosing `queen.execute`
 *     phase span).
 *
 * Both propagate through async/await and Promise.all branches automatically,
 * so a future per-agent span path cannot silently lose trace-tree
 * parenting by forgetting to copy a request property — there is nothing
 * to copy.
 */
const spanContext = new AsyncLocalStorage<NyvSpan>();
const runRootContext = new AsyncLocalStorage<NyvSpan>();

/** Current span in the running async context, or undefined when none is active. */
export function getCurrentSpan(): NyvSpan | undefined {
  return spanContext.getStore();
}

/**
 * The current orchestration run's root span, or undefined when no run is
 * active. Set by `runWithRunRoot()`; survives the entire orchestration
 * regardless of how deeply nested the caller is inside intermediate
 * phase spans. Use this when you need to parent a span directly to the
 * run root (not to whatever ambient phase span happens to be active).
 */
export function getRunRootSpan(): NyvSpan | undefined {
  return runRootContext.getStore();
}

/**
 * Run `fn` with `span` installed as the current span. Any startSpan()
 * called inside `fn` (or any async descendant) will auto-parent to it
 * unless an explicit `opts.parent` is provided. Returns whatever `fn`
 * returns (including a Promise) so it composes cleanly with async code.
 */
export function runWithSpan<T>(span: NyvSpan, fn: () => T): T {
  return spanContext.run(span, fn);
}

/**
 * Run `fn` with `span` pinned as the orchestration run's root span,
 * readable anywhere inside via `getRunRootSpan()`. Independent of the
 * ambient `spanContext` slot — installing a run root does NOT change
 * the ambient current span (callers typically install both in tandem
 * by nesting `runWithRunRoot(root, () => runWithSpan(root, fn))`).
 */
export function runWithRunRoot<T>(span: NyvSpan, fn: () => T): T {
  return runRootContext.run(span, fn);
}

export interface StartSpanOptions {
  parent?: NyvSpan | { traceId: string; spanId: string };
  op?: string;
  tags?: SpanTags;
}

/**
 * Start a span. Always returns a span object with finish(); when Sentry
 * is active, the span is also recorded in Sentry. The JSONL path
 * always runs so logs stay searchable regardless of DSN config.
 *
 * Parent resolution order: explicit `opts.parent` → current ALS span
 * (`getCurrentSpan()`) → none (root span, fresh traceId).
 */
export function startSpan(name: string, opts: StartSpanOptions = {}): NyvSpan {
  const parent = opts.parent ?? spanContext.getStore();
  const traceId = parent?.traceId ?? crypto.randomBytes(16).toString('hex');
  const parentId = parent?.spanId;
  const spanId = crypto.randomBytes(8).toString('hex');
  const startMs = Date.now();
  // NYV-OBS-TRACE-CORRELATION-001 (Task #28 round 7): inject traceId
  // explicitly into the span tag set so it (a) flows through Sentry
  // attributes, (b) appears on every JSONL emit, and (c) is queryable
  // via spanLatenciesByTag — making "show me every span for trace X"
  // a single-key lookup without joining on the top-level emit field.
  const tags: SpanTags = { traceId, ...(opts.tags ?? {}) };

  let sentrySpan: any = null;
  if (sentryReady && sentryMod?.startInactiveSpan) {
    try {
      sentrySpan = sentryMod.startInactiveSpan({
        name,
        op: opts.op ?? 'nyv.span',
        attributes: tags,
      });
    } catch {
      /* swallow — fall back to JSONL */
    }
  }

  let finished = false;
  const span: NyvSpan = {
    name,
    traceId,
    parentId,
    spanId,
    startMs,
    tags,
    sentryBacked: sentrySpan != null,
    setTag(key, value) {
      tags[key] = value;
      if (sentrySpan?.setAttribute) {
        try { sentrySpan.setAttribute(key, value as any); } catch { /* ignore */ }
      }
    },
    finish(status = 'ok', extra) {
      if (finished) return;
      finished = true;
      const durationMs = Date.now() - startMs;
      const finalTags = { ...tags, ...(extra ?? {}) };
      pushSample(name, durationMs);
      pushTaggedSamples(name, durationMs, finalTags);

      if (sentrySpan) {
        try {
          if (status !== 'ok' && sentrySpan.setStatus) sentrySpan.setStatus(status);
          if (sentrySpan.end) sentrySpan.end();
          else if (sentrySpan.finish) sentrySpan.finish();
        } catch { /* ignore */ }
      }

      logger.info(`span ${name} ${status} (${durationMs}ms)`, {
        span: name,
        op: opts.op ?? 'nyv.span',
        traceId,
        parentId,
        spanId,
        durationMs,
        status,
        ...finalTags,
      });
    },
  };
  return span;
}

/**
 * Wrap an async fn with a span — auto-finishes with status=error on throw.
 *
 * The span is installed as the current ALS span for the duration of `fn`,
 * so any nested `startSpan()` / `withSpan()` calls inside `fn` (including
 * across async/await and Promise.all branches) auto-parent to it. This is
 * what makes per-agent spans deep inside `executeOrchestration()` show up
 * under their run's root span without callers having to thread a span
 * object (or a `__rootSpan` request property) through every signature.
 */
export async function withSpan<T>(
  name: string,
  opts: StartSpanOptions,
  fn: (span: NyvSpan) => Promise<T>,
): Promise<T> {
  const span = startSpan(name, opts);
  try {
    const result = await spanContext.run(span, () => fn(span));
    span.finish('ok');
    return result;
  } catch (e) {
    span.finish('error', { errorMessage: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

export function isSentryActive(): boolean {
  return sentryReady;
}

export function getTracerStatus(): { backend: 'sentry' | 'jsonl'; dsnConfigured: boolean } {
  return { backend: sentryReady ? 'sentry' : 'jsonl', dsnConfigured: !!SENTRY_DSN };
}
