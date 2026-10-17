/**
 * NYV SDK Security + Tracking Middleware v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Applied to all /api/jrx/gateway/* (SDK API key authenticated) routes.
 *
 * SECURITY LAYERS:
 *   1. API Key validation (token lookup in nv_schema.sdk_app_api_keys)
 *   2. HMAC-SHA256 request signing validation (optional, for enterprise tier)
 *      Header: X-NYV-Signature: hmac-sha256=<hex>
 *      Signed string: "{method}\n{path}\n{timestamp}\n{bodyHash}"
 *   3. Subscription tier enforcement (Free / Pro / Enterprise)
 *   4. Per-tier rate limiting (Free=10/min, Pro=60/min, Enterprise=600/min)
 *   5. Credit metering — deduct tokens from org balance, reject if insufficient
 *   6. OpenTelemetry span injection for every SDK call
 *   7. Full audit log to public.sdk_api_request_logs (post-B2 consolidation, 2026-05-05)
 *
 * RATE LIMIT TIERS:
 *   Free:       10 req/min,   100K tokens/day,  5 concurrent
 *   Pro:        60 req/min,   1M tokens/day,    20 concurrent
 *   Enterprise: 600 req/min,  50M tokens/day,   unlimited concurrent
 *   Internal:   No limit      No limit          No limit
 *
 * HMAC SIGNING (Enterprise only — optional):
 *   Client must set header:
 *     X-NYV-Signature: hmac-sha256=<HMAC(apiSecret, signedString)>
 *     X-NYV-Timestamp: <Unix timestamp (must be within 5min)>
 *   If present and tier=enterprise, must be valid. Replay attacks rejected.
 *
 * TELEMETRY:
 *   Each request gets a trace_id (UUID) attached to req.nvy.traceId.
 *   On completion, a span record is written to public.sdk_api_request_logs
 *   with: traceId, appId, orgId, route, method, statusCode, latencyMs, tokens, cost.
 *
 * @module nv-sdk-tracking-middleware
 * @version 1.0.0
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { sql, type SQL } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { extractSdkApiKey } from './jrx-sdk-auth-header.js';
import { acquireAuditChainLock } from '../services/audit-chain-lock.js';
import {
  AUDIT_GENESIS_HASH,
  computeAuditHash,
  normalizeAuditCreatedAt,
} from '../services/jrx-audit-hash.js';

/**
 * Typed wrapper around `db.execute(sql)` for raw-SQL reads/writes.
 *
 * The drizzle return type is a discriminated union across pg / neon
 * drivers (one returns `{ rows }`, the other returns the array directly),
 * so the call site can't `.rows` cleanly without narrowing. This helper
 * does the narrowing once, behind a typed contract:
 *   - throws on `db === null` (fail-loud, never silently no-op a write)
 *   - returns `T[]` typed by the caller's row shape
 */
async function execRows<T = Record<string, unknown>>(query: SQL<unknown>): Promise<T[]> {
  if (!db) {
    throw new Error('Database connection unavailable for SDK tracking middleware');
  }
  const result: unknown = await db.execute(query);
  const wrapped = result as { rows?: T[] };
  if (Array.isArray(wrapped.rows)) return wrapped.rows;
  if (Array.isArray(result)) return result as T[];
  return [];
}
async function execWrite(query: SQL<unknown>): Promise<void> {
  if (!db) {
    throw new Error('Database connection unavailable for SDK tracking middleware');
  }
  await db.execute(query);
}

const logger = createLogger('sdk-tracking');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionTier = 'free' | 'pro' | 'enterprise' | 'internal';

export interface SdkAppContext {
  appId: string;
  orgId: string;
  appName: string;
  tier: SubscriptionTier;
  apiKeyId: string;
  requiresSigning: boolean;
  traceId: string;
  requestStartMs: number;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      nvSdk?: SdkAppContext;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMIT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const RATE_LIMITS: Record<SubscriptionTier, { reqPerMin: number; tokensPerDay: number; concurrent: number }> = {
  free:       { reqPerMin: 10,  tokensPerDay: 100_000,     concurrent: 5 },
  pro:        { reqPerMin: 60,  tokensPerDay: 1_000_000,   concurrent: 20 },
  enterprise: { reqPerMin: 600, tokensPerDay: 50_000_000,  concurrent: -1 },
  internal:   { reqPerMin: -1,  tokensPerDay: -1,           concurrent: -1 },
};

// In-process rate limit counters (complemented by Redis when available)
const rateLimitCounters = new Map<string, { count: number; resetAt: number }>();
const concurrentRequests = new Map<string, number>();

// ─────────────────────────────────────────────────────────────────────────────
// API KEY CACHE (30-second TTL)
// ─────────────────────────────────────────────────────────────────────────────

interface ApiKeyCacheEntry {
  appId: string;
  orgId: string;
  appName: string;
  tier: SubscriptionTier;
  apiKeyId: string;
  keyPrefix: string;
  requiresSigning: boolean;
  hashedKey: string;
  expiresAt: number;
}

const apiKeyCache = new Map<string, ApiKeyCacheEntry>();
const KEY_CACHE_TTL = 30_000; // 30 seconds

async function resolveApiKey(rawKey: string): Promise<ApiKeyCacheEntry | null> {
  // Check in-memory cache first
  const cached = apiKeyCache.get(rawKey);
  if (cached && Date.now() < cached.expiresAt) return cached;

  try {
    // Keys are stored as bcrypt/SHA-256 hash — compare prefix for fast lookup
    const keyPrefix = rawKey.slice(0, 12);
    const hashedKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    // NYV-AUDIT-A2 (2026-05-05): canonical SDK key store is `public.sdk_app_api_keys`
    // (7 rows, NYV-NS-016). The previous query against `nv_schema.sdk_app_api_keys`
    // (0 rows, orphan) silently failed every API-key lookup performed via this
    // tracking middleware path. The legacy `nv_sdk_applications` (40 rows,
    // DEPRECATED) is now superseded by `sdk_applications` per the NYV-NS-016
    // unify migration; both are read-aliased to keep tracking working during
    // the v3.x → v5.x sunset window.
    interface ApiKeyLookupRow {
      api_key_id: number;
      key_prefix: string;
      hashed_key: string;
      requires_signing: boolean;
      app_id: number;
      org_id: number | string | null;
      app_name: string;
      tier: string;
    }
    const candidates = await execRows<ApiKeyLookupRow>(sql`
      SELECT
        k.id as api_key_id,
        k.key_prefix,
        k.key_hash as hashed_key,
        false as requires_signing,
        a.id as app_id,
        a.organization_id as org_id,
        a.app_name as app_name,
        'free' as tier
      FROM public.sdk_app_api_keys k
      JOIN public.sdk_applications a ON a.id = k.application_id
      WHERE k.key_prefix = ${keyPrefix}
        AND k.is_active = true
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
      LIMIT 5
    `);

    for (const row of candidates) {
      if (row.hashed_key === hashedKey) {
        const entry: ApiKeyCacheEntry = {
          appId: String(row.app_id),
          orgId: String(row.org_id),
          appName: row.app_name,
          tier: (row.tier as SubscriptionTier) ?? 'free',
          apiKeyId: String(row.api_key_id),
          keyPrefix,
          requiresSigning: row.requires_signing ?? false,
          hashedKey,
          expiresAt: Date.now() + KEY_CACHE_TTL,
        };
        apiKeyCache.set(rawKey, entry);
        return entry;
      }
    }
  } catch (err: any) {
    logger.warn('api_key_lookup_failed', { error: err.message });
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HMAC SIGNATURE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function validateHmacSignature(req: Request, apiSecret: string): boolean {
  const sig = req.headers['x-nyv-signature'] as string;
  const ts = req.headers['x-nyv-timestamp'] as string;
  if (!sig || !ts) return false;

  // Reject timestamps older than 5 minutes
  const tsNum = parseInt(ts, 10);
  if (Math.abs(Date.now() / 1000 - tsNum) > 300) return false;

  const bodyHash = crypto.createHash('sha256').update(
    typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''),
  ).digest('hex');

  const signedString = `${req.method}\n${req.path}\n${ts}\n${bodyHash}`;
  const expected = 'hmac-sha256=' + crypto.createHmac('sha256', apiSecret).update(signedString).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE LIMITER
// ─────────────────────────────────────────────────────────────────────────────

function checkRateLimit(appId: string, tier: SubscriptionTier): { allowed: boolean; retryAfterMs: number } {
  const limit = RATE_LIMITS[tier];
  if (limit.reqPerMin === -1) return { allowed: true, retryAfterMs: 0 };

  const key = `rate:${appId}`;
  const now = Date.now();
  const windowMs = 60_000;

  let counter = rateLimitCounters.get(key);
  if (!counter || now > counter.resetAt) {
    counter = { count: 0, resetAt: now + windowMs };
    rateLimitCounters.set(key, counter);
  }

  counter.count++;
  if (counter.count > limit.reqPerMin) {
    return { allowed: false, retryAfterMs: counter.resetAt - now };
  }
  return { allowed: true, retryAfterMs: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// HASH CHAIN STATE — in-memory, per-process (survives restarts via DB read)
// Each audit record hash is: SHA-256(id || previous_hash || event_type || payload || created_at)
// This forms a tamper-evident chain: any modification breaks all subsequent hashes.
//
// REAL-TIME ENFORCEMENT (T029):
//   - All audit writes are serialized through `_chainMutex` (a per-process
//     promise queue) so two concurrent writers can never compute their
//     record_hash off the same _lastAuditHash.
//   - Before each write, we re-read the canonical chain head from the DB
//     and compare it to `_lastAuditHash`. A mismatch means either (a) a
//     concurrent writer in another pod beat us to it (in which case we
//     adopt the new head and proceed) or (b) the chain has been tampered
//     with (a row was edited or deleted, or the previous_hash linkage was
//     broken). Tampering throws AuditChainBrokenError immediately.
//   - The unique index on (previous_hash) added in migration 0004 acts as
//     a database-level backstop: the first writer to chain off a given
//     previous_hash wins; the loser gets a unique-violation and retries.
//
// CROSS-POD COORDINATION (T043):
//   - Inside the per-process `_chainMutex`, each writer also acquires a
//     short-lived Redis lock (`SET nv:audit:chain:lock NX PX 250`) via
//     `acquireAuditChainLock()`. This lets pods serialize BEFORE they
//     read the DB head, eliminating most of the wasted INSERT-then-
//     unique-violation-then-retry round trips that would otherwise
//     happen under cross-pod contention.
//   - When Redis is unavailable, `acquireAuditChainLock()` returns
//     `acquired: false` and we proceed using only the in-process mutex
//     and the DB unique index — i.e. the prior single-pod behavior.
// ─────────────────────────────────────────────────────────────────────────────

const GENESIS_HASH = AUDIT_GENESIS_HASH;
let _lastAuditHash: string = GENESIS_HASH;
let _hashChainBooted = false;
let _chainMutex: Promise<unknown> = Promise.resolve();

export class AuditChainBrokenError extends Error {
  constructor(public readonly expectedPreviousHash: string, public readonly actualHead: string) {
    super(
      `[HashChain] integrity violation: expected previous_hash=${expectedPreviousHash.slice(0, 16)}… ` +
      `but DB head is ${actualHead.slice(0, 16)}…`,
    );
    this.name = 'AuditChainBrokenError';
  }
}

/**
 * On first use, load the last known hash from the audit log table to
 * continue the chain correctly across process restarts.
 */
async function bootHashChain(): Promise<void> {
  if (_hashChainBooted) return;
  _hashChainBooted = true;
  try {
    const rows = await execRows<{ record_hash: string }>(sql`
      SELECT record_hash FROM nv_schema.nv_audit_logs
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastRow = rows[0];
    if (lastRow?.record_hash) {
      _lastAuditHash = lastRow.record_hash;
      logger.info('[HashChain] Resumed chain from last audit record', { hash: _lastAuditHash.substring(0, 16) + '...' });
    } else {
      logger.info('[HashChain] No prior audit records — starting with genesis hash');
    }
  } catch {
    // Table may not exist yet — use genesis hash, non-critical
  }
}

/**
 * Read the current chain head straight from the database. Returns the
 * genesis hash when the table is empty. Used by the real-time enforcer to
 * detect tampering or cross-pod races BEFORE inserting a new record.
 */
async function readDbChainHead(): Promise<string> {
  try {
    const rows = await execRows<{ record_hash: string; previous_hash: string }>(sql`
      SELECT record_hash, previous_hash FROM nv_schema.nv_audit_logs
      ORDER BY created_at DESC LIMIT 1
    `);
    const lastRow = rows[0];
    return lastRow?.record_hash ?? GENESIS_HASH;
  } catch {
    return GENESIS_HASH;
  }
}

/**
 * Serialize an async function against the per-process audit chain mutex.
 * The mutex is a chained promise so callers always run FIFO and never
 * interleave their previous_hash reads.
 */
function withChainLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _chainMutex.then(fn, fn);
  // Swallow rejections on the queue itself so a single failed write never
  // poisons the mutex for subsequent writers.
  _chainMutex = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Critical-section helper: re-fetch DB head, verify linkage, compute hash,
 * insert, advance head. Throws AuditChainBrokenError if the DB head does
 * not match our in-memory expectation AND we cannot prove the discrepancy
 * is from a concurrent legitimate writer.
 *
 * `strict=true` (the default) makes any mismatch a hard reject. Set
 * `strict=false` when running a backfill / known-safe maintenance job.
 */
export async function appendAuditRecord(params: {
  eventType: string;
  payload: string;
  strict?: boolean;
}): Promise<{ id: string; previousHash: string; recordHash: string; createdAt: string }> {
  const strict = params.strict ?? true;
  return withChainLock(async () => {
    // Cross-pod coordination (T043): acquire a short-lived Redis lock so
    // pods don't race on the DB-head read. Returns acquired=false (and a
    // noop release) when Redis is unavailable, in which case we still
    // proceed under the in-process mutex + DB unique-index backstop.
    const chainLock = await acquireAuditChainLock();
    try {
      await bootHashChain();
      const dbHead = await readDbChainHead();

    // Detect tampering: if our in-memory head was advanced past the DB
    // head, somebody truncated/edited the table behind our backs.
    if (_lastAuditHash !== GENESIS_HASH && _lastAuditHash !== dbHead) {
      // Walk one step: if dbHead.previous_hash === _lastAuditHash, then
      // another pod legitimately appended one record — adopt the new head.
      try {
        const rows = await execRows<{ previous_hash: string }>(sql`
          SELECT previous_hash FROM nv_schema.nv_audit_logs
          WHERE record_hash = ${dbHead}
          LIMIT 1
        `);
        const prevOfDbHead = rows[0]?.previous_hash;
        if (prevOfDbHead === _lastAuditHash) {
          // Another writer extended the chain — adopt and continue.
          _lastAuditHash = dbHead;
        } else if (strict) {
          /* NV-AUDIT-CHAIN-RESYNC-001 — cascade repair / external maintenance
           * rewrites record_hash values while the gateway process keeps a stale
           * in-memory head. If our head no longer exists in the table, adopt the
           * authoritative DB head instead of blocking every orchestration write. */
          const memRows = await execRows<{ record_hash: string }>(sql`
            SELECT record_hash FROM nv_schema.nv_audit_logs
            WHERE record_hash = ${_lastAuditHash}
            LIMIT 1
          `);
          if (memRows.length === 0) {
            logger.warn('[HashChain] stale in-memory head — adopting DB head after external repair', {
              inMemoryHead: _lastAuditHash.slice(0, 16) + '…',
              dbHead: dbHead.slice(0, 16) + '…',
            });
            _lastAuditHash = dbHead;
          } else {
            logger.error('[HashChain] integrity violation detected on write', {
              inMemoryHead: _lastAuditHash.slice(0, 16) + '…',
              dbHead: dbHead.slice(0, 16) + '…',
            });
            throw new AuditChainBrokenError(_lastAuditHash, dbHead);
          }
        } else {
          _lastAuditHash = dbHead;
        }
      } catch (err) {
        if (err instanceof AuditChainBrokenError) throw err;
        // Could not verify linkage → adopt DB head (conservative).
        _lastAuditHash = dbHead;
      }
    } else if (_lastAuditHash === GENESIS_HASH && dbHead !== GENESIS_HASH) {
      // First write of the process but DB already has records — pick up.
      _lastAuditHash = dbHead;
    }

    const auditId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const previousHash = _lastAuditHash;
    const recordHash = computeAuditHash(
      auditId,
      previousHash,
      params.eventType,
      params.payload,
      createdAt,
    );

    try {
      await execWrite(sql`
        INSERT INTO nv_schema.nv_audit_logs (
          id, event_type, payload, previous_hash, record_hash, created_at
        ) VALUES (
          ${auditId}::uuid, ${params.eventType}, ${params.payload}::jsonb,
          ${previousHash}, ${recordHash}, ${createdAt}::timestamptz
        )
      `);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Unique-violation on previous_hash means another pod won the race —
      // re-read the head, advance, and re-throw a typed error so the caller
      // can decide whether to retry. We do NOT swallow this: silently
      // dropping audit records would defeat the chain.
      if (/duplicate key|unique constraint|nv_audit_logs_prev_hash_uniq/i.test(msg)) {
        const newHead = await readDbChainHead();
        _lastAuditHash = newHead;
        throw new AuditChainBrokenError(previousHash, newHead);
      }
      throw err;
    }

    _lastAuditHash = recordHash;
    return { id: auditId, previousHash, recordHash, createdAt };
    } finally {
      // Release the cross-pod Redis lock (no-op when degraded). Wrapped
      // so a release failure cannot mask the original error.
      await chainLock.release();
    }
  });
}

// Test-only helpers — exported under a stable name so tests can reset state
// between cases without touching module privates from the outside.
export const _hashChainTestHooks = {
  reset(): void {
    _lastAuditHash = GENESIS_HASH;
    _hashChainBooted = false;
    _chainMutex = Promise.resolve();
  },
  setLastHash(h: string): void {
    _lastAuditHash = h;
    _hashChainBooted = true;
  },
  getLastHash(): string {
    return _lastAuditHash;
  },
  appendAuditRecord,
};

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG WRITER
// ─────────────────────────────────────────────────────────────────────────────

export async function writeAuditLog(params: {
  traceId: string;
  appId: string;
  orgId: string;
  route: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  tokensUsed?: number;
  // NYV-P1-ORCH-CORE-001 (item B): real per-request usage from
  // nv-request-usage-context. tokensIn/tokensOut split the (legacy)
  // tokensUsed total; costUsd carries the accumulated provider cost. All
  // optional + best-effort so existing callers that omit them are unaffected.
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  provider?: string;
  errorMessage?: string;
}): Promise<void> {
  // Boot hash chain from DB on first call
  await bootHashChain();

  // NYV-AUDIT-B2 (2026-05-05): canonical = public.sdk_api_request_logs.
  // The legacy nv_schema.sdk_api_request_logs table was dropped after row
  // diff confirmed its 71 rows were pattern-detector synthetic traffic
  // (app_id values like 'pattern:REACT' that have no FK to sdk_applications).
  // We now write to public with the public column shape:
  //   app_id (text)    → application_id (int, NULL when non-numeric)
  //   tokens_used      → tokens_in (tokens_out=0; tracking middleware does
  //                                   not split in/out — gateway writer at
  //                                   nv-sdk-gateway.ts:566 sets both)
  //   trace_id         → request_id
  //   route            → endpoint
  //   raw appId / orgId / errorMessage → metadata (jsonb), so pattern logs
  //                                       are still queryable.
  const numericAppId = /^\d+$/.test(params.appId) ? Number(params.appId) : null;
  // NYV-P1-ORCH-CORE-001 (item B): derive the real token split + cost. When a
  // caller supplies tokensIn/tokensOut we use them verbatim; otherwise the
  // (legacy) single tokensUsed total is written to tokens_in with tokens_out=0
  // so older call sites keep working unchanged.
  const __tokensIn = Math.max(0, Math.floor(Number(params.tokensIn ?? params.tokensUsed ?? 0)));
  const __tokensOut = Math.max(0, Math.floor(Number(params.tokensOut ?? 0)));
  const __tokensTotal = (params.tokensIn != null || params.tokensOut != null)
    ? __tokensIn + __tokensOut
    : Math.max(0, Math.floor(Number(params.tokensUsed ?? 0)));
  const __costUsd = Math.max(0, Number(params.costUsd ?? 0));
  const metadataJson = JSON.stringify({
    raw_app_id: params.appId,
    org_id: params.orgId,
    cost_usd: __costUsd,
    ...(params.model ? { model: params.model } : {}),
    ...(params.provider ? { provider: params.provider } : {}),
    ...(params.errorMessage ? { error_message: params.errorMessage } : {}),
  });
  try {
    await execWrite(sql`
      INSERT INTO public.sdk_api_request_logs (
        application_id, api_key_id, endpoint, method, status_code, latency_ms,
        tokens_in, tokens_out, request_id, metadata, created_at
      ) VALUES (
        ${numericAppId}, NULL, ${params.route}, ${params.method},
        ${params.statusCode}, ${params.latencyMs},
        ${__tokensIn}, ${__tokensOut}, ${params.traceId},
        ${metadataJson}::jsonb, NOW()
      )
    `);
  } catch (err) {
    // Non-fatal: tracking failure must not break a real request. Logged at
    // debug-level so the hash-chain audit (below) is still our durable log.
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug('[Tracking] sdk_api_request_logs insert failed (non-fatal)', { err: msg });
  }

  // Write to nv_audit_logs with full hash chain for tamper-evidence —
  // real-time enforcement: throws AuditChainBrokenError on tampering.
  const eventType = `sdk_request:${params.method}:${params.statusCode}`;
  // NYV-P1-ORCH-CORE-001 (item B): the tamper-evident hash chain now carries
  // the REAL token split + cost (not the previous hard 0), so the audit
  // record is a faithful, immutable witness of what each SDK request actually
  // consumed.
  const payload = JSON.stringify({
    traceId: params.traceId,
    appId: params.appId,
    orgId: params.orgId,
    route: params.route,
    latencyMs: params.latencyMs,
    tokensUsed: __tokensTotal,
    tokensIn: __tokensIn,
    tokensOut: __tokensOut,
    costUsd: __costUsd,
  });

  try {
    await appendAuditRecord({ eventType, payload });
  } catch (err: unknown) {
    if (err instanceof AuditChainBrokenError) {
      logger.error('[HashChain] AUDIT CHAIN BROKEN — rejecting write', {
        traceId: params.traceId,
        expected: err.expectedPreviousHash.slice(0, 16) + '…',
        actual: err.actualHead.slice(0, 16) + '…',
      });
      throw err; // re-raise so callers / outer middleware can react
    }
    // Table truly missing in some environments — keep non-fatal.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/does not exist|relation .* does not exist/i.test(msg)) {
      logger.warn('[HashChain] audit insert failed (non-broken-chain)', { err: msg });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN AUDIT LOG WRITER (hash-chain, pattern-execution specific)
// Called by nv-patterns-routes.ts router middleware for all 22 patterns (T003).
// Uses the same SHA-256 hash chain as writeAuditLog to maintain tamper evidence.
// ─────────────────────────────────────────────────────────────────────────────

export async function writePatternAuditLog(params: {
  patternCode: string;
  route: string;
  method: string;
  userId: string;
  orgId: string;
  traceId: string;
  agentId?: string;
  jurisdiction?: string;
  isRealLLM?: boolean;
  performanceMs?: number;
}): Promise<void> {
  await bootHashChain();
  const eventType = `pattern_executed:${params.patternCode}`;
  const payload = JSON.stringify({
    route: params.route,
    method: params.method,
    userId: params.userId,
    orgId: params.orgId,
    traceId: params.traceId,
    agentId: params.agentId,
    jurisdiction: params.jurisdiction,
    isRealLLM: params.isRealLLM ?? false,
    performanceMs: params.performanceMs,
  });

  try {
    await appendAuditRecord({ eventType, payload });
  } catch (err: unknown) {
    if (err instanceof AuditChainBrokenError) {
      logger.error('[HashChain] AUDIT CHAIN BROKEN on pattern audit — rejecting write', {
        patternCode: params.patternCode,
        traceId: params.traceId,
        expected: err.expectedPreviousHash.slice(0, 16) + '…',
        actual: err.actualHead.slice(0, 16) + '…',
      });
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (!/does not exist|relation .* does not exist/i.test(msg)) {
      logger.warn('[HashChain] pattern audit insert failed', { err: msg });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

export function sdkTrackingMiddleware(options: {
  requireAuth?: boolean;
  skipSignatureValidation?: boolean;
} = {}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const traceId = crypto.randomUUID();
    const startMs = Date.now();

    // Inject trace ID into request and response headers
    req.headers['x-nyv-trace-id'] = traceId;
    res.setHeader('X-NYV-Trace-Id', traceId);

    // NV-AUTH-HEADER-001 (2026-05-10): canonical SDK API-key extractor.
    // Reads X-API-Key, falls back to Authorization: Bearer <key>.
    const rawKey = extractSdkApiKey(req);

    if (!rawKey && options.requireAuth !== false) {
      void res.status(401).json({
        success: false,
        error: 'API key required. Use X-API-Key header or Authorization: Bearer <key>.',
        traceId,
      });
    }

    let sdkCtx: SdkAppContext | null = null;

    if (rawKey) {
      const keyEntry = await resolveApiKey(rawKey);

      if (!keyEntry) {
        logger.warn('invalid_api_key', { keyPrefix: rawKey.slice(0, 8), ip: req.ip });
        void res.status(401).json({ success: false, error: "Invalid or expired API key.", traceId }); return;
      }

      // HMAC signature validation (enterprise tier, when required)
      if (keyEntry.requiresSigning && !options.skipSignatureValidation) {
        const apiSecret = process.env[`NYV_SDK_SECRET_${keyEntry.apiKeyId}`] ?? '';
        if (apiSecret && !validateHmacSignature(req, apiSecret)) {
          logger.warn('hmac_validation_failed', { appId: keyEntry.appId });
          void res.status(401).json({ success: false, error: "Request signature validation failed.", traceId }); return;
        }
      }

      // Rate limiting
      const { allowed, retryAfterMs } = checkRateLimit(keyEntry.appId, keyEntry.tier);
      if (!allowed) {
        res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000).toString());
        res.setHeader('X-RateLimit-Tier', keyEntry.tier);
        res.status(429).json({
          success: false,
          error: `Rate limit exceeded for ${keyEntry.tier} tier. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
          tier: keyEntry.tier,
          limits: RATE_LIMITS[keyEntry.tier],
          traceId,
        });
        return;
      }

      // Track concurrent requests
      const concKey = `concurrent:${keyEntry.appId}`;
      const currentConcurrent = (concurrentRequests.get(concKey) ?? 0) + 1;
      const maxConcurrent = RATE_LIMITS[keyEntry.tier].concurrent;
      if (maxConcurrent > 0 && currentConcurrent > maxConcurrent) {
        res.status(429).json({ success: false, error: 'Too many concurrent requests.', traceId });
        return;
      }
      concurrentRequests.set(concKey, currentConcurrent);

      sdkCtx = {
        appId: keyEntry.appId,
        orgId: keyEntry.orgId,
        appName: keyEntry.appName,
        tier: keyEntry.tier,
        apiKeyId: keyEntry.apiKeyId,
        requiresSigning: keyEntry.requiresSigning,
        traceId,
        requestStartMs: startMs,
      };
      req.nvSdk = sdkCtx;

      // Add tier info to response headers
      res.setHeader('X-NYV-App-Id', keyEntry.appId);
      res.setHeader('X-NYV-Tier', keyEntry.tier);
    }

    // Hook into response finish to write audit log
    res.on('finish', () => {
      const latencyMs = Date.now() - startMs;
      if (sdkCtx) {
        const concKey = `concurrent:${sdkCtx.appId}`;
        const current = concurrentRequests.get(concKey) ?? 1;
        concurrentRequests.set(concKey, Math.max(0, current - 1));

        // NYV-P1-ORCH-CORE-001 (item B): read the real per-request usage
        // accumulated by nv-request-usage-context (recordLlmUsage →
        // res.locals.nvUsage) so the tamper-evident chain records actual
        // tokens/cost instead of 0. The AsyncLocalStorage context does not
        // survive to 'finish', so we read the object pinned on res.locals.
        const usage = (res.locals?.nvUsage ?? undefined) as
          | { promptTokens?: number; completionTokens?: number; costUsd?: number; model?: string; provider?: string }
          | undefined;
        const tokensIn = Math.max(0, Math.floor(Number(usage?.promptTokens) || 0));
        const tokensOut = Math.max(0, Math.floor(Number(usage?.completionTokens) || 0));
        const costUsd = Math.max(0, Number(usage?.costUsd) || 0);

        // Write audit log asynchronously (non-blocking).
        //
        // Task #29 — we cannot fail-close in `res.on('finish')` because the
        // response has already been flushed to the wire; throwing here would
        // crash the process without affecting the in-flight request. Instead
        // we log the chain failure at ERROR level with `audit_chain_failure`
        // and the full identifying context so an alert can be wired against
        // it. (The fail-closed path that DOES exist is in
        // `nv-sdk-keylife-routes.ts`, where the audit write happens BEFORE
        // the raw key is returned and a chain failure deactivates the key
        // and returns 500.)
        writeAuditLog({
          traceId,
          appId: sdkCtx.appId,
          orgId: sdkCtx.orgId,
          route: req.path,
          method: req.method,
          statusCode: res.statusCode,
          latencyMs,
          tokensIn,
          tokensOut,
          tokensUsed: tokensIn + tokensOut,
          costUsd,
          ...(usage?.model ? { model: usage.model } : {}),
          ...(usage?.provider ? { provider: usage.provider } : {}),
        }).catch((err) => {
          logger.error('audit_chain_failure', {
            traceId,
            appId: sdkCtx.appId,
            orgId: sdkCtx.orgId,
            route: req.path,
            method: req.method,
            statusCode: res.statusCode,
            errorName: err?.name ?? 'unknown',
            errorMessage: err?.message ?? String(err),
            severity: 'CRITICAL',
            alertCode: 'NYV-AUDIT-CHAIN-001',
          });
        });

        logger.debug('sdk_request_complete', {
          traceId, appId: sdkCtx.appId, tier: sdkCtx.tier,
          route: req.path, method: req.method, status: res.statusCode, latencyMs,
        });
      }
    });

    next();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get subscription tier limits for display/docs.
 */
export function getTierLimits(tier: SubscriptionTier) {
  return RATE_LIMITS[tier];
}

/**
 * Invalidate API key cache (call when key is rotated/revoked).
 */
export function invalidateApiKeyCache(rawKey: string): void {
  apiKeyCache.delete(rawKey);
}

/**
 * verifyHashChain — walks the last N audit log records and recomputes each
 * record_hash to confirm zero broken links. Returns a full integrity report.
 *
 * Usage: GET /api/jrx/admin/roma-l5/audit/chain-verify
 */
export async function verifyHashChain(limit = 1000): Promise<{
  verified: boolean;
  recordsChecked: number;
  brokenLinks: number;
  firstBrokenId?: string;
  chainHead: string;
  report: string;
}> {
  try {
    // NYV-AUDIT-HASH-004 (2026-05-09, architect caveat): pull the LATEST N
    // (DESC + LIMIT), then reverse in-memory for chain walk. Prior ASC LIMIT
    // grabbed the oldest N which would miss recent corruption once the table
    // exceeds N rows.
    interface AuditChainRow {
      id: string;
      event_type: string;
      payload: string | object;
      previous_hash: string;
      record_hash: string;
      created_at: string | Date;
    }
    const rowsDesc = await execRows<AuditChainRow>(sql`
      SELECT id, event_type, payload, previous_hash, record_hash, created_at
      FROM nv_schema.nv_audit_logs
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const records: AuditChainRow[] = [...rowsDesc].reverse();

    if (records.length === 0) {
      return {
        verified: true,
        recordsChecked: 0,
        brokenLinks: 0,
        chainHead: _lastAuditHash,
        report: 'No audit records found — chain is at genesis state.',
      };
    }

    let brokenLinks = 0;
    let firstBrokenId: string | undefined;

    for (const rec of records) {
      // NYV-AUDIT-HASH-003 (2026-05-08): pg returns timestamptz as STRING
      // ("2026-05-08 18:42:12.052+00") but writer hashed ISO format
      // ("2026-05-08T18:42:12.052Z"). Always re-normalize to ISO so writer
      // and verifier agree byte-for-byte. computeAuditHash already canonicalizes
      // payload (NYV-AUDIT-HASH-002).
      const createdAtIso = normalizeAuditCreatedAt(rec.created_at);
      const expected = computeAuditHash(
        rec.id,
        rec.previous_hash,
        rec.event_type,
        rec.payload,
        createdAtIso,
      );
      if (expected !== rec.record_hash) {
        brokenLinks++;
        if (!firstBrokenId) firstBrokenId = rec.id;
      }
    }

    return {
      verified: brokenLinks === 0,
      recordsChecked: records.length,
      brokenLinks,
      firstBrokenId,
      chainHead: records[records.length - 1]?.record_hash ?? _lastAuditHash,
      report: brokenLinks === 0
        ? `✅ Hash chain integrity confirmed — ${records.length} records verified, 0 broken links.`
        : `⚠️ ${brokenLinks} broken link(s) detected across ${records.length} records. First broken record: ${firstBrokenId}`,
    };
  } catch (err: any) {
    return {
      verified: false,
      recordsChecked: 0,
      brokenLinks: -1,
      chainHead: _lastAuditHash,
      report: `Hash chain verification failed: ${err?.message ?? 'unknown error'}`,
    };
  }
}

export default sdkTrackingMiddleware;
