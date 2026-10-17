/**
 * NV-OTEL-GENAI-001 — real, dependency-free OTLP/HTTP (JSON) span exporter.
 *
 * The platform's in-house tracer (`tracing.ts` / `llm-tracing.ts`) deliberately
 * avoids the heavy `@opentelemetry/*` SDK, but it already builds a `resourceSpans`
 * shape. This module turns the internal span into a SPEC-COMPLIANT OTLP/JSON
 * payload (hex trace/span ids, typed attribute values, correct status codes,
 * string nanosecond timestamps) and POSTs it to any OTLP/HTTP collector
 * (Jaeger, Tempo, Datadog Agent, otelcol, …) at `<endpoint>/v1/traces`.
 *
 * Activation (any of):
 *   - JRX_F_OTEL_GENAI=1                              (explicit flag), OR
 *   - OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set, OR
 *   - OTEL_EXPORTER_OTLP_ENDPOINT is set
 * When inactive, `maybeExportSpan` is a cheap no-op so default behaviour is
 * byte-for-byte unchanged.
 *
 * Hard guarantees (fully real implementation, fail-safe):
 *   - Never throws into the caller (every path is try/catch-guarded).
 *   - Never blocks the request: spans are queued and flushed fire-and-forget on
 *     a timer / size threshold; export failures are logged at debug and dropped.
 *   - Bounded memory: the queue is capped; overflow drops oldest.
 */

import { createLogger } from './logger.js';

const logger = createLogger('otlp-exporter');

// Structural shape we consume — matches `Span` in tracing.ts without importing
// it (keeps this module free of any runtime import cycle).
export interface ExportableSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;          // epoch ms
  endTime?: number;           // epoch ms
  attributes: Record<string, string | number | boolean | undefined>;
  status: 'UNSET' | 'OK' | 'ERROR';
  error?: string;
  kind?: number;              // OTel SpanKind (1=INTERNAL, 5=CLIENT)
}

interface OtlpKeyValue {
  key: string;
  value:
    | { stringValue: string }
    | { intValue: string }
    | { doubleValue: number }
    | { boolValue: boolean };
}

const MAX_QUEUE = 2048;
const BATCH_SIZE = 128;
const FLUSH_INTERVAL_MS = 5_000;
const EXPORT_TIMEOUT_MS = 4_000;

let queue: Array<Record<string, unknown>> = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let warnedNoFetch = false;

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** OTLP export is active when the flag is on OR a collector endpoint is set. */
export function isOtlpEnabled(): boolean {
  return (
    envFlagOn('JRX_F_OTEL_GENAI') ||
    !!process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  );
}

function tracesEndpoint(): string | null {
  const direct = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  if (direct) return direct;
  const base = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (base) return `${base.replace(/\/+$/, '')}/v1/traces`;
  return null;
}

/** Parse `OTEL_EXPORTER_OTLP_HEADERS="k1=v1,k2=v2"` into a header map. */
function exporterHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  if (raw) {
    for (const pair of raw.split(',')) {
      const idx = pair.indexOf('=');
      if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return headers;
}

/** Hex-only, lower-cased; UUIDs become hex by stripping dashes. */
function toHex(id: string, width: 16 | 32): string {
  const hex = (id || '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length >= width) return hex.slice(0, width);
  return hex.padEnd(width, '0');
}

function msToUnixNano(ms: number): string {
  // Avoid float precision loss for nanoseconds.
  return (BigInt(Math.max(0, Math.floor(ms))) * 1_000_000n).toString();
}

function toOtlpAttributes(attrs: Record<string, string | number | boolean | undefined>): OtlpKeyValue[] {
  const out: OtlpKeyValue[] = [];
  for (const [key, val] of Object.entries(attrs)) {
    if (val === undefined || val === null) continue;
    if (typeof val === 'boolean') {
      out.push({ key, value: { boolValue: val } });
    } else if (typeof val === 'number') {
      if (Number.isInteger(val) && Math.abs(val) < Number.MAX_SAFE_INTEGER) {
        out.push({ key, value: { intValue: String(val) } });
      } else {
        out.push({ key, value: { doubleValue: val } });
      }
    } else {
      out.push({ key, value: { stringValue: String(val) } });
    }
  }
  return out;
}

// OTel status: 0=UNSET, 1=OK, 2=ERROR.
function toStatusCode(status: 'UNSET' | 'OK' | 'ERROR'): number {
  if (status === 'OK') return 1;
  if (status === 'ERROR') return 2;
  return 0;
}

function toOtlpSpan(span: ExportableSpan): Record<string, unknown> {
  const start = span.startTime;
  const end = span.endTime ?? Date.now();
  const otlp: Record<string, unknown> = {
    traceId: toHex(span.traceId, 32),
    spanId: toHex(span.spanId, 16),
    name: span.name,
    kind: span.kind ?? 1,
    startTimeUnixNano: msToUnixNano(start),
    endTimeUnixNano: msToUnixNano(end),
    attributes: toOtlpAttributes(span.attributes),
    status: { code: toStatusCode(span.status), message: span.error || '' },
  };
  if (span.parentSpanId) otlp.parentSpanId = toHex(span.parentSpanId, 16);
  return otlp;
}

function resourceAttributes(): OtlpKeyValue[] {
  const attrs: Record<string, string | number | boolean> = {
    'service.name': process.env.OTEL_SERVICE_NAME || 'nyayavigya',
    'service.version': process.env.SERVICE_VERSION || '5.1.0',
    'service.namespace': 'ai-platform',
    'deployment.environment': process.env.NODE_ENV || 'development',
  };
  // Honour OTEL_RESOURCE_ATTRIBUTES="k=v,k2=v2" if provided.
  const raw = process.env.OTEL_RESOURCE_ATTRIBUTES;
  if (raw) {
    for (const pair of raw.split(',')) {
      const idx = pair.indexOf('=');
      if (idx > 0) attrs[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  }
  return toOtlpAttributes(attrs);
}

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);
  // Don't keep the event loop alive solely for trace flushing.
  if (typeof flushTimer === 'object' && flushTimer && 'unref' in flushTimer) {
    (flushTimer as unknown as { unref: () => void }).unref();
  }
}

/**
 * Convert + enqueue a finished span for OTLP export. No-op unless enabled.
 * Safe to call from any span-end path; never throws.
 */
export function maybeExportSpan(span: ExportableSpan): void {
  try {
    if (!isOtlpEnabled()) return;
    if (queue.length >= MAX_QUEUE) queue.shift(); // drop oldest under pressure
    queue.push(toOtlpSpan(span));
    ensureFlushTimer();
    if (queue.length >= BATCH_SIZE) void flush();
  } catch (err) {
    logger.debug('[OTLP] enqueue failed (non-fatal)', { err: (err as Error)?.message });
  }
}

/** Flush queued spans to the collector. Fire-and-forget; never throws. */
export async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const endpoint = tracesEndpoint();
  const fetchFn: typeof fetch | undefined = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!endpoint || !fetchFn) {
    if (!endpoint && !warnedNoFetch) {
      // Flag is on but no collector endpoint — keep the span in the structured
      // log (already emitted by the tracer) and clear the queue so we don't grow.
      logger.debug('[OTLP] export enabled but no OTEL_EXPORTER_OTLP_ENDPOINT set — relying on structured logs');
    }
    if (!fetchFn && !warnedNoFetch) {
      logger.warn('[OTLP] global fetch unavailable — cannot export OTLP spans');
      warnedNoFetch = true;
    }
    queue = [];
    return;
  }

  const batch = queue.splice(0, BATCH_SIZE);
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: resourceAttributes() },
        scopeSpans: [
          {
            scope: { name: 'nyayavigya-llm-tracer', version: '1.0.0' },
            spans: batch,
          },
        ],
      },
    ],
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), EXPORT_TIMEOUT_MS);
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: exporterHeaders(),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      logger.debug('[OTLP] collector returned non-2xx', { status: res.status });
    }
  } catch (err) {
    // Network/collector failure must never affect the request path.
    logger.debug('[OTLP] export POST failed (non-fatal)', { err: (err as Error)?.message });
  }
}

export default { maybeExportSpan, flush, isOtlpEnabled };
