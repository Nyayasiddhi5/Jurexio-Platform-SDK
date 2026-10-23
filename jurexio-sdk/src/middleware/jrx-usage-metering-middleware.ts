/**
 * jrx-usage-metering-middleware.ts — Task #302 (Demo G2C — Operations Hub + Cost Optimizer)
 *
 * Per-request SDK usage writer. Mounted globally on `/api/jrx/*` so every
 * gateway call leaves a row in `public.sdk_usage_metering`. The Operations
 * Hub + Cost Optimizer aggregators read from this table.
 *
 * Schema (shared/schema.ts → sdkUsageMetering):
 *   id, application_id, agent_id, tokens_in, tokens_out, cost_usd, period,
 *   request_count, metadata (jsonb), recorded_at
 *
 * The relational columns (provider, model, org_id, latency_ms, sdk_key_prefix,
 * status_code, route, jurisdiction) are persisted into `metadata` so we can
 * roll them up via JSONB without a schema change. `period='request'` marks
 * raw per-request rows (vs. 'daily' aggregates written by sdkUsageMeteringService).
 *
 * Pricing: simple price-table in jrx-llm-pricing.ts. We capture tokens from
 *   - response.locals.nvUsage = { promptTokens, completionTokens, model, provider }
 *     set by realLLMService consumers, OR
 *   - the response body when it includes `usage`/`tokens` fields, OR
 *   - heuristic: ~Math.ceil(reqBytes/4) input + Math.ceil(resBytes/4) output.
 *
 * Audit trail: per-request writes are NON-fatal. A failure is logged at
 * debug level — the parallel sdk_api_request_logs writer (in
 * jrx-sdk-tracking-middleware) and the hash-chained nv_audit_logs are still
 * the durable audit surfaces.
 *
 * NV-WIRING-001: imported and mounted from src/index.ts.
 * NV-NAMING-001: jrx- prefix.
 * NV-ARCH-001:   no LLM calls, just an observation tap.
 */

import type { Request, Response, NextFunction } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { priceUsd, normalizeModel } from '../utils/jrx-llm-pricing.js';
import { recordRequestAiCredit } from './jrx-credit-usage-recorder.js';
import { buildPartnerAiRequestMeta } from '../utils/jrx-partner-platform.js';

const logger = createLogger('./jrx-usage-metering');

declare global {
  namespace Express {
    interface Locals {
      nvUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        model?: string;
        provider?: string;
        agentId?: string;
        jurisdiction?: string;
        // NV-AUDIT-TOKENS-001 — populated by nvRequestUsageContext / recordLlmUsage
        costUsd?: number;
        calls?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      };
    }
  }
}

interface CapturedRow {
  applicationId: number | null;
  agentId: string | null;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  costUsd: number;
  metadata: Record<string, unknown>;
}

const FLUSH_BATCH_SIZE = 25;
const FLUSH_INTERVAL_MS = 5_000;
const buffer: CapturedRow[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushBuffer(); }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

async function flushBuffer(): Promise<void> {
  if (!db || buffer.length === 0) return;
  const rows = buffer.splice(0, buffer.length);
  try {
    for (const r of rows) {
      await db.execute(sql`
        INSERT INTO sdk_usage_metering (
          application_id, agent_id, tokens_in, tokens_out, tokens_cache_read,
          tokens_cache_write, cost_usd, period, request_count, metadata, recorded_at
        ) VALUES (
          ${r.applicationId}, ${r.agentId}, ${r.tokensIn}, ${r.tokensOut},
          ${r.tokensCacheRead}, ${r.tokensCacheWrite}, ${r.costUsd}, 'request', 1,
          ${JSON.stringify(r.metadata)}::jsonb, NOW()
        )
      `);
    }
  } catch (err) {
    logger.debug('[usage-metering] flush failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
  }
}

function asInt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function extractTokensFromBody(body: unknown): { in: number; out: number } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, any>;
  const usage = b.usage ?? b.tokensUsage ?? b.tokens;
  if (usage && typeof usage === 'object') {
    const inT = asInt(usage.prompt_tokens ?? usage.promptTokens ?? usage.input ?? usage.in);
    const outT = asInt(usage.completion_tokens ?? usage.completionTokens ?? usage.output ?? usage.out);
    if (inT || outT) return { in: inT, out: outT };
  }
  if (b.data && typeof b.data === 'object') {
    return extractTokensFromBody(b.data);
  }
  return null;
}

/**
 * Per task #302 spec we meter EVERY `/api/jrx/*` request. Self-referential
 * aggregator polls (operations/, cost/, admin/, audit/, hitl/), health probes,
 * OpenAPI docs and auth/JWT chatter ARE still written so the audit picture is
 * complete, but they're tagged `metadata.internal = true` so cost / spend
 * dashboards can exclude them at query time and not inflate the very metrics
 * those pages display.
 */
const INTERNAL_PREFIXES = [
  '/api/jrx/operations/',
  '/api/jrx/cost/',
  '/api/jrx/admin/',
  '/api/jrx/audit/',
  '/api/jrx/hitl/',
  '/api/jrx/regulatory',
  '/api/jrx/providers/failover',
  '/api/jrx/drift',
  '/api/jrx/health',
  '/api/jrx/docs',
  '/api/jrx/auth/',
  '/api/jrx/feature-flags',
  '/api/jrx/governance',
  '/api/jrx/policies',
  '/api/jrx/statutes',
];

function isInternalRoute(url: string): boolean {
  for (const p of INTERNAL_PREFIXES) if (url.startsWith(p)) return true;
  return false;
}

interface AuthLikeUser { organizationId?: string | null; jurisdiction?: string | null; }
interface ReqWithUser { user?: AuthLikeUser }
interface BodyWithModel { model?: string; provider?: string; error?: string | { message?: string } }

function readUser(req: Request): AuthLikeUser | undefined {
  const r = req as unknown as ReqWithUser;
  return r.user;
}
function readBodyMeta(body: unknown): BodyWithModel {
  return (body && typeof body === 'object') ? (body as BodyWithModel) : {};
}

/**
 * Express middleware — captures per-request usage and writes to
 * `sdk_usage_metering` on response finish.
 */
export function nvUsageMetering(req: Request, res: Response, next: NextFunction): void {
  ensureFlushTimer();
  const startMs = Date.now();
  let capturedBody: unknown = null;
  let capturedBytes = 0;

  // Tap res.json so we can inspect token-usage fields without buffering streams.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    capturedBody = body;
    try { capturedBytes = Buffer.byteLength(JSON.stringify(body) ?? ''); } catch { /* noop */ }
    return originalJson(body);
  };

  res.on('finish', () => {
    try {
      const latencyMs = Date.now() - startMs;
      const sdkCtx = req.nvSdk;
      const localUsage = res.locals?.nvUsage ?? {};
      const bodyUsage = extractTokensFromBody(capturedBody);

      const reqBytes = Number(req.headers['content-length'] ?? 0) || 0;
      const fallbackIn = Math.ceil(reqBytes / 4);
      const fallbackOut = Math.ceil(capturedBytes / 4);

      const billableIn = asInt(localUsage.promptTokens ?? bodyUsage?.in ?? fallbackIn);
      const tokensOut = asInt(localUsage.completionTokens ?? bodyUsage?.out ?? fallbackOut);
      const tokensCacheRead = asInt(localUsage.cacheReadTokens ?? 0);
      const tokensCacheWrite = asInt(localUsage.cacheWriteTokens ?? 0);
      const tokensIn = Math.max(0, billableIn - tokensCacheRead - tokensCacheWrite);

      const bodyMeta = readBodyMeta(capturedBody);
      const user = readUser(req);
      const model = normalizeModel(localUsage.model ?? bodyMeta.model ?? 'unknown');
      const provider = String(localUsage.provider ?? bodyMeta.provider ?? 'unknown');
      const costUsd = priceUsd(model, billableIn, tokensOut);

      const sdkKeyPrefix = String(req.headers['x-api-key'] ?? '').slice(0, 12) || null;
      const orgId = sdkCtx?.orgId ?? user?.organizationId ?? null;
      const appId = sdkCtx?.appId ? Number(sdkCtx.appId) : null;
      const jurisdiction = String(
        req.headers['x-jurisdiction'] ?? user?.jurisdiction ?? localUsage.jurisdiction ?? '',
      ).toUpperCase() || null;

      const url = req.originalUrl || req.url || '';
      const metadata: Record<string, unknown> = {
        orgId,
        sdkKeyPrefix,
        provider,
        model,
        latencyMs,
        route: req.path,
        method: req.method,
        statusCode: res.statusCode,
        jurisdiction,
        ts: new Date().toISOString(),
      };
      if (isInternalRoute(url)) {
        metadata.internal = true;
      }

      /* NV-PARTNER-AI-LOG-001 — enrich the durable audit row with partner-AI
       * fields (taskType, resolved docType, intent source/confidence, filing
       * provenance, stream|sync). Secret-free (NV-SECRETS-001): no prompt body. */
      try {
        const partnerAi = buildPartnerAiRequestMeta(req);
        if (partnerAi) metadata.partnerAi = partnerAi;
      } catch { /* non-fatal — never block metering on enrichment */ }
      if (bodyMeta.error) {
        const errStr = typeof bodyMeta.error === 'string'
          ? bodyMeta.error
          : (bodyMeta.error.message ?? JSON.stringify(bodyMeta.error));
        metadata.error = String(errStr).slice(0, 500);
      }

      buffer.push({
        applicationId: Number.isFinite(appId as number) ? (appId as number) : null,
        agentId: localUsage.agentId ?? sdkCtx?.appName ?? null,
        tokensIn,
        tokensOut,
        tokensCacheRead,
        tokensCacheWrite,
        costUsd,
        metadata,
      });

      if (buffer.length >= FLUSH_BATCH_SIZE) {
        void flushBuffer();
      }

      /* NV-CREDIT-UNIVERSAL-001 — post-spend AI-credit accounting.
       *
       * Separate table and separate purpose from the row above:
       * `sdk_usage_metering` feeds cost dashboards, while
       * `nv_schema.ai_credit_usage` is the table `nvAICreditEnforcer.enforce()`
       * reads to decide whether to admit the NEXT request. Writing only the
       * former is why platform-wide pre-spend caps could never fire.
       *
       * Deliberately uses `res.locals.nvUsage` (real measured spend) and not the
       * byte-length heuristics above: a cap must be driven by tokens actually
       * billed by a provider, never by response size. */
      recordRequestAiCredit(req, res, res.locals?.nvUsage as never);
    } catch (err) {
      logger.debug('[usage-metering] capture failed (non-fatal)', { err: err instanceof Error ? err.message : String(err) });
    }
  });

  next();
}

/** Test/admin helper — flush the buffer synchronously. */
export async function flushUsageMeteringNow(): Promise<void> {
  await flushBuffer();
}

export default nvUsageMetering;
