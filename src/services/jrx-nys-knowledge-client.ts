/**
 * NV-JRX-KNOWLEDGE-001 — HTTP client for the NYS Knowledgesearch plane.
 *
 * Talks to the live NYS API (nyayasearch / EC2 jrx-api) with:
 *   - X-API-Key auth (NV-AUTH-HEADER-001)
 *   - Circuit breaker + timeout
 *   - Graceful degrade (returns null / empty — never throws into Queen hot path)
 *
 * Env (names only):
 *   JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL   e.g. https://nyayasearch.jurexio.example/api
 *   JRX_ECOSYSTEM_KNOWLEDGE_API_KEY    machine key accepted by NYS authGuard
 *   JRX_ECOSYSTEM_KNOWLEDGE_TIMEOUT_MS default 15000
 *   JRX_ECOSYSTEM_KNOWLEDGE_CB_FAILURES default 5 (open after N consecutive failures)
 *   JRX_ECOSYSTEM_KNOWLEDGE_CB_COOLDOWN_MS default 30000
 */
import { createLogger } from '../utils/logger.js';
import { sanitizeErrorForClient } from '../utils/error-sanitizer.js';

const logger = createLogger('./jrx-nys-knowledge-client');

export interface NysClientStats {
  configured: boolean;
  baseUrl: string | null;
  circuit: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  lastError?: string;
  lastSuccessAt?: string;
  totalCalls: number;
  totalFailures: number;
  /** Surfaces whose breaker is currently open, e.g. `caselaw/search`. */
  openCircuits?: string[];
}

let lastError: string | undefined;
let lastSuccessAt: string | undefined;
let totalCalls = 0;
let totalFailures = 0;

/**
 * NV-NSP-503-PERMANENCE-006 — the breaker is partitioned per upstream surface.
 *
 * It used to be a single process-global counter, which made it a fault *amplifier*
 * rather than a protection: five slow `caselaw/search?mode=hybrid` calls opened the
 * breaker, and every subsequent call to every other NYS surface — `mode=fts`,
 * `verify-citation`, `legal-work/tasks` — was then answered `503 "NYS knowledge
 * circuit open"` locally, without touching NYS, for the whole cooldown. NSP was told
 * `fts` was the safe interim mode, and `fts` was being taken down by hybrid.
 *
 * Bucketing by the first two path segments keeps the protection (a genuinely broken
 * surface still trips) while confining the blast radius to that surface.
 */
interface BreakerBucket {
  consecutiveFailures: number;
  openedAt: number;
}
const breakers = new Map<string, BreakerBucket>();

/** `/caselaw/search?…` → `caselaw/search`; `/healthz` → `healthz`. */
function breakerKey(path: string): string {
  return path.split('?')[0].split('/').filter(Boolean).slice(0, 2).join('/') || 'root';
}

function bucket(key: string): BreakerBucket {
  let b = breakers.get(key);
  if (!b) {
    b = { consecutiveFailures: 0, openedAt: 0 };
    breakers.set(key, b);
  }
  return b;
}

function baseUrl(): string | null {
  const raw = (process.env.JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL ?? '').trim().replace(/\/$/, '');
  return raw || null;
}

function apiKey(): string | null {
  const k = (process.env.JRX_ECOSYSTEM_KNOWLEDGE_API_KEY ?? '').trim();
  return k || null;
}

function timeoutMs(): number {
  // NV-TIMEOUT-POLICY-001: 45s default for caselaw under Queen (was 30s)
  const n = Number(process.env.JRX_ECOSYSTEM_KNOWLEDGE_TIMEOUT_MS ?? '45000');
  return Number.isFinite(n) && n > 0 ? n : 45_000;
}

function cbFailures(): number {
  const n = Number(process.env.JRX_ECOSYSTEM_KNOWLEDGE_CB_FAILURES ?? '5');
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function cbCooldownMs(): number {
  const n = Number(process.env.JRX_ECOSYSTEM_KNOWLEDGE_CB_COOLDOWN_MS ?? '30000');
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

function circuitState(key = 'root'): NysClientStats['circuit'] {
  const b = bucket(key);
  if (b.consecutiveFailures < cbFailures()) return 'closed';
  if (Date.now() - b.openedAt >= cbCooldownMs()) return 'half-open';
  return 'open';
}

export function isNysKnowledgeConfigured(): boolean {
  return Boolean(baseUrl());
}

/**
 * Reset every breaker bucket. Exported for tests only — a partitioned breaker is
 * module state, and a test that cannot clear it can only ever assert one outcome.
 */
export function __resetNysBreakersForTest(): void {
  breakers.clear();
  lastError = undefined;
}

export function getNysKnowledgeClientStats(): NysClientStats {
  /* The aggregate view reports the WORST bucket, so an operator dashboard still shows
   * "open" when any surface is tripped rather than hiding it behind healthy ones. */
  let worst: NysClientStats['circuit'] = 'closed';
  let maxFailures = 0;
  for (const key of breakers.keys()) {
    const state = circuitState(key);
    if (state === 'open') worst = 'open';
    else if (state === 'half-open' && worst === 'closed') worst = 'half-open';
    maxFailures = Math.max(maxFailures, bucket(key).consecutiveFailures);
  }
  return {
    configured: isNysKnowledgeConfigured(),
    baseUrl: baseUrl(),
    circuit: worst,
    consecutiveFailures: maxFailures,
    lastError,
    lastSuccessAt,
    totalCalls,
    totalFailures,
    openCircuits: [...breakers.keys()].filter((k) => circuitState(k) === 'open'),
  };
}

function recordSuccess(key: string): void {
  const b = bucket(key);
  b.consecutiveFailures = 0;
  b.openedAt = 0;
  lastSuccessAt = new Date().toISOString();
}

function recordFailure(key: string, err: string): void {
  const b = bucket(key);
  b.consecutiveFailures += 1;
  totalFailures += 1;
  // Never store raw Postgres/AWS credential strings in stats (Console health).
  lastError = sanitizeErrorForClient(err);
  if (b.consecutiveFailures >= cbFailures() && b.openedAt === 0) {
    b.openedAt = Date.now();
    logger.warn('NYS knowledge circuit OPEN', {
      surface: key,
      consecutiveFailures: b.consecutiveFailures,
      err: lastError,
    });
  }
  if (circuitState(key) === 'half-open') {
    // stay open until a success; reset open clock on half-open probe failure
    b.openedAt = Date.now();
  }
}

export interface NysRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** Override timeout for long agentic runs (legal-work). */
  timeoutMs?: number;
  /**
   * Deprecated for NYS federation: partner JRX SDK keys are not valid on NYS.
   * Machine auth always uses JRX_ECOSYSTEM_KNOWLEDGE_API_KEY. Kept for call-site compat.
   */
  forwardApiKey?: string | null;
  /** Extra transient retries (default from JRX_ECOSYSTEM_KNOWLEDGE_RETRIES, usually 2). */
  retries?: number;
}

function maxRetries(): number {
  const n = Number(process.env.JRX_ECOSYSTEM_KNOWLEDGE_RETRIES ?? '2');
  return Number.isFinite(n) && n >= 0 ? Math.min(5, n) : 2;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Low-level NYS HTTP call with transient retries (CorpusBusyError / 503 / network).
 * Returns parsed JSON or error envelope. Never throws.
 */
export async function nysKnowledgeRequest<T = unknown>(
  opts: NysRequestOptions,
): Promise<
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; data?: T }
> {
  const base = baseUrl();
  if (!base) {
    return { ok: false, status: 503, error: 'JRX_ECOSYSTEM_KNOWLEDGE_BASE_URL not configured' };
  }

  const key = breakerKey(opts.path);
  const state = circuitState(key);
  if (state === 'open') {
    return { ok: false, status: 503, error: `NYS knowledge circuit open (${key})` };
  }
  if (state === 'half-open') {
    const b = bucket(key);
    b.consecutiveFailures = 0; // allow one probe
    b.openedAt = 0;
  }

  const retries = opts.retries ?? maxRetries();
  let lastFail: { status: number; error: string } | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    totalCalls += 1;
    const qs = new URLSearchParams();
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
    }
    const path = opts.path.startsWith('/') ? opts.path : `/${opts.path}`;
    const url = `${base}${path}${qs.size ? `?${qs}` : ''}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const authKey = apiKey();
    if (authKey) {
      headers['X-API-Key'] = authKey;
      headers.Authorization = `Bearer ${authKey}`;
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      const res = await fetch(url, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? timeoutMs()),
      });

      let data: unknown = null;
      const text = await res.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }

      if (!res.ok) {
        const msg =
          typeof (data as any)?.error === 'string'
            ? (data as any).error
            : typeof (data as any)?.error?.message === 'string'
              ? (data as any).error.message
              : `NYS HTTP ${res.status}`;
        const safe = sanitizeErrorForClient(msg);
        const retryable =
          isRetryableStatus(res.status) ||
          (data as any)?.retryable === true ||
          /busy|timeout|throttl|temporar/i.test(msg);
        lastFail = { status: res.status, error: safe };
        if (retryable && attempt < retries) {
          const backoff = Math.min(4000, 250 * 2 ** attempt);
          logger.warn('NYS knowledge retryable failure — retrying', {
            path: opts.path,
            status: res.status,
            attempt: attempt + 1,
            backoffMs: backoff,
          });
          await sleep(backoff);
          continue;
        }
        recordFailure(key, msg);
        return { ok: false, status: res.status, error: safe, data: data as T };
      }

      recordSuccess(key);
      if (attempt > 0) {
        logger.info('NYS knowledge recovered after retry', { path: opts.path, attempt });
      }
      return { ok: true, status: res.status, data: data as T };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const safe = sanitizeErrorForClient(msg);
      lastFail = { status: 503, error: safe };
      if (attempt < retries) {
        const backoff = Math.min(4000, 250 * 2 ** attempt);
        logger.warn('NYS knowledge network failure — retrying', {
          path: opts.path,
          attempt: attempt + 1,
          backoffMs: backoff,
          error: safe,
        });
        await sleep(backoff);
        continue;
      }
      recordFailure(key, msg);
      logger.warn('NYS knowledge request failed', { path: opts.path, error: safe });
      return { ok: false, status: 503, error: safe };
    }
  }

  return lastFail
    ? { ok: false, status: lastFail.status, error: lastFail.error }
    : { ok: false, status: 503, error: 'NYS knowledge request failed' };
}

/** Probe NYS /healthz for health aggregators. */
export async function nysKnowledgeHealthz(): Promise<{
  ok: boolean;
  status: number;
  latencyMs: number;
  body?: unknown;
  error?: string;
}> {
  const start = Date.now();
  const result = await nysKnowledgeRequest({ path: '/healthz', method: 'GET', timeoutMs: 5000 });
  const latencyMs = Date.now() - start;
  if (!result.ok) {
    return { ok: false, status: result.status, latencyMs, error: result.error };
  }
  return { ok: true, status: result.status, latencyMs, body: result.data };
}

/**
 * Returns the NYS machine key for proxy call-sites.
 * Does not forward inbound JRX partner keys (they are invalid on NYS).
 */
export function forwardKeyFromReq(_req?: { headers: Record<string, unknown> }): string | null {
  return apiKey();
}
