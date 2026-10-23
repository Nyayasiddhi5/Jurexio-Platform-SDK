/**
 * JRX-OBS-REQMETRICS-001 (Task #28) — In-process request rate + error
 * histogram for /api/jrx/admin/health/full.
 *
 * Why not Prometheus/StatsD: this platform runs single-process per pod
 * today and operators have repeatedly asked for a single JSON snapshot
 * they can curl during incidents. A lightweight in-memory ring is enough
 * to answer "how many RPS right now?" and "what classes of errors are
 * we seeing in the last 100 requests?" without standing up a side-car.
 *
 * Memory budget: O(60) for the per-second RPS window + O(100) for the
 * error histogram = trivially bounded.
 */

import type { Request, Response, NextFunction } from 'express';

const WINDOW_SECONDS = 60;
const ERROR_BUFFER_SIZE = 100;

interface RpsBucket {
  /** Unix epoch second */
  ts: number;
  count: number;
}

interface ErrorSample {
  ts: number;
  status: number;
  /** 4xx / 5xx / network / etc. */
  errClass: string;
  path: string;
  method: string;
}

const rpsBuckets: RpsBucket[] = [];
const errorBuffer: ErrorSample[] = [];

// Total counter so we can also report cumulative request count without
// it resetting every window — useful for "requests since boot".
let totalRequests = 0;
let totalErrors = 0;

function nowSec(): number { return Math.floor(Date.now() / 1000); }

function classifyStatus(status: number): string {
  if (status >= 500) return '5xx';
  if (status >= 400) return '4xx';
  if (status >= 300) return '3xx';
  if (status >= 200) return '2xx';
  return '1xx';
}

function recordRequest(status: number, path: string, method: string): void {
  const ts = nowSec();
  totalRequests++;
  // Rotate any stale buckets out (older than WINDOW_SECONDS).
  while (rpsBuckets.length && rpsBuckets[0].ts < ts - WINDOW_SECONDS) {
    rpsBuckets.shift();
  }
  let last = rpsBuckets[rpsBuckets.length - 1];
  if (!last || last.ts !== ts) {
    last = { ts, count: 0 };
    rpsBuckets.push(last);
  }
  last.count++;

  if (status >= 400) {
    totalErrors++;
    errorBuffer.push({
      ts: Date.now(),
      status,
      errClass: classifyStatus(status),
      path,
      method,
    });
    if (errorBuffer.length > ERROR_BUFFER_SIZE) errorBuffer.shift();
  }
}

/**
 * Express middleware — increments counters on res 'finish'. Mounted
 * once at the app level. Skips its own admin endpoints to avoid feedback.
 */
export function nyvRequestMetricsMiddleware() {
  return function (req: Request, res: Response, next: NextFunction) {
    // Skip self-instrumentation: health probes hit every second and
    // would otherwise dominate the RPS bucket.
    const skip =
      req.path.startsWith('/api/jrx/health') ||
      req.path.startsWith('/api/jrx/admin/health') ||
      req.path === '/healthz' ||
      req.path === '/health';
    if (skip) return next();

    res.once('finish', () => {
      try { recordRequest(res.statusCode, req.path, req.method); } catch { /* never crash */ }
    });
    next();
  };
}

export interface RequestMetricsSnapshot {
  totalRequests: number;
  totalErrors: number;
  /** Average requests/sec over the last `windowSeconds`. */
  rpsLastMinute: number;
  windowSeconds: number;
  /**
   * Last-100 error samples bucketed by class — answers
   * "what kinds of failures are operators seeing right now?".
   */
  errorClassHistogram: Record<string, number>;
  /** Most recent 10 errors with path + status, for fast triage. */
  recentErrors: Array<Pick<ErrorSample, 'ts' | 'status' | 'errClass' | 'path' | 'method'>>;
}

export function getRequestMetricsSnapshot(): RequestMetricsSnapshot {
  const cutoff = nowSec() - WINDOW_SECONDS;
  const inWindow = rpsBuckets.filter(b => b.ts >= cutoff);
  const total = inWindow.reduce((s, b) => s + b.count, 0);
  const rps = total / WINDOW_SECONDS;

  const histogram: Record<string, number> = {};
  for (const e of errorBuffer) {
    histogram[e.errClass] = (histogram[e.errClass] ?? 0) + 1;
  }

  return {
    totalRequests,
    totalErrors,
    rpsLastMinute: Math.round(rps * 100) / 100,
    windowSeconds: WINDOW_SECONDS,
    errorClassHistogram: histogram,
    recentErrors: errorBuffer.slice(-10).map(e => ({
      ts: e.ts, status: e.status, errClass: e.errClass, path: e.path, method: e.method,
    })),
  };
}

export function _resetRequestMetrics(): void {
  rpsBuckets.length = 0;
  errorBuffer.length = 0;
  totalRequests = 0;
  totalErrors = 0;
}
