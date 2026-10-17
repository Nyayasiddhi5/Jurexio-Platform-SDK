/**
 * jrx-credit-usage-recorder.ts — NV-CREDIT-UNIVERSAL-001
 *
 * Universal post-spend AI-credit accounting for every `/api/jrx/*` request that
 * actually spent money on a model.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `nvAICreditEnforcer.enforce()` decides whether to admit a request by reading
 * `getUsedToday()`, which sums `nv_schema.ai_credit_usage`. A pre-spend cap is
 * therefore only as real as the post-spend rows behind it: with nothing writing
 * that table, `usedToday` stays 0 forever and neither the daily token budget nor
 * the hourly request limit can ever trip, no matter how many `enforce()` call
 * sites exist. Enforcement without recording is decorative.
 *
 * Before this module, exactly two handlers wrote those rows — the sync
 * `/api/jrx/orchestrate` (JRX-P1-ORCH-CORE-001 item D) and `/api/jrx/legal-chat/send`
 * (NV-LEGALCHAT-CREDIT-001). An audit of every mounted router found ~110 further
 * partner-reachable handlers that reach a paid model call and recorded nothing,
 * including `/orchestrate/stream`, which enforced a cap it could never enforce.
 *
 * WHY IT IS A RESPONSE-FINISH BACKSTOP AND NOT 110 EDITS
 * ─────────────────────────────────────────────────────
 * All LLM spend funnels through `orchestrateLLM` (NV-LLM-001 single-router rule;
 * `RealLLMService`'s legacy per-provider fallback is closed and throws), and
 * `orchestrateLLM` already reports every provider call into the request-scoped
 * `nvRequestUsageContext` accumulator. So the truthful token/cost figure for ANY
 * request is already available at response-finish without touching a handler.
 * Recording there covers surfaces uniformly, cannot drift per-endpoint, and does
 * not duplicate the enforcer (NV-NO-DUPLICATE-001) — it reuses it.
 *
 * This module deliberately does NOT enforce. A response-finish hook runs after
 * the money is spent, so a refusal there would bill and refuse. Pre-spend caps
 * stay at the routes that can still decline before calling a model.
 *
 * NV-WIRING-001: called from jrx-usage-metering-middleware's existing `finish`
 * hook (mounted on `/api/jrx/` in src/index.ts).
 */

import type { Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import { claimRequestUsageForBilling, type RequestUsage } from '../utils/jrx-request-usage-context.js';
import { nvAICreditEnforcer } from '../services/jrx-ai-credit-enforcer.js';

const logger = createLogger('./jrx-credit-usage-recorder');

interface AuthLikeUser {
  id?: string | number;
  userId?: string | number;
  sub?: string;
  organizationId?: string | null;
  tier?: string | null;
  jurisdiction?: string | null;
}

function resolveUserId(req: Request, sdkAppId?: string): string {
  const user = (req as unknown as { user?: AuthLikeUser }).user;
  const fromJwt = user?.id ?? user?.userId ?? user?.sub;
  if (fromJwt !== undefined && fromJwt !== null && String(fromJwt).trim()) return String(fromJwt);
  // Partner SDK traffic has no platform user; bill the application so a runaway
  // API key is attributable and capped as one subject rather than as `anon`,
  // which would pool every keyless caller into one shared budget.
  if (sdkAppId) return `sdk_app_${sdkAppId}`;
  return 'anon';
}

function resolveTier(req: Request): string {
  const sdkTier = req.nvSdk?.tier;
  if (sdkTier) return String(sdkTier);
  const user = (req as unknown as { user?: AuthLikeUser }).user;
  if (user?.tier) return String(user.tier);
  return 'pro';
}

/**
 * Record this request's real model spend into `nv_schema.ai_credit_usage`.
 *
 * Returns the token count written, or 0 when nothing was written (no spend, flag
 * off, or a route-level recorder already claimed the request). Fully fail-soft:
 * a credit-table problem must never affect a response that already succeeded.
 *
 * A non-token paid call (embedding, STT, TTS, off-ring vision) writes a row with
 * `tokens_used = 0` and a real `cost_usd`, so it returns 0 here while still having
 * recorded. Callers must not read the return value as "nothing was billed".
 */
export function recordRequestAiCredit(req: Request, res: Response, usage: RequestUsage | undefined): number {
  if (!isJrxFeatureOn('creditRecord')) return 0;
  if (!usage) return 0;
  try {
    const tokensUsed = Math.max(
      0,
      Math.floor(Number(usage.promptTokens || 0) + Number(usage.completionTokens || 0)),
    );
    const costUsd = Math.max(0, Number(usage.costUsd || 0));
    // `calls === 0` means no model was invoked on this request (a deterministic
    // proxy, a validation 400, a cache hit). Billing those would turn every
    // health poll into usage and could exhaust a customer's budget without a
    // single model call.
    if (Number(usage.calls || 0) <= 0) return 0;
    // NV-CREDIT-COST-DIM-001: a row is warranted when EITHER dimension moved. The
    // original `tokensUsed <= 0` gate silently discarded every non-token paid call
    // — an STT transcription or an embedding batch has real cost and zero chat
    // tokens, so gating on tokens alone would leave the cost budget reading a
    // counter nothing writes, which is the exact defect this whole change fixes.
    if (tokensUsed <= 0 && costUsd <= 0) return 0;
    if (!claimRequestUsageForBilling(usage)) return 0;

    const sdkCtx = req.nvSdk;
    const user = (req as unknown as { user?: AuthLikeUser }).user;
    const orgId = sdkCtx?.orgId ?? user?.organizationId ?? undefined;
    const jurisdiction = String(req.headers['x-jurisdiction'] ?? user?.jurisdiction ?? '').toUpperCase() || undefined;
    const requestId = String(
      sdkCtx?.traceId ?? req.headers['x-request-id'] ?? res.getHeader('x-request-id') ?? '',
    ) || `${req.method}:${req.path}:${Date.now()}`;

    void nvAICreditEnforcer
      .record({
        userId: resolveUserId(req, sdkCtx?.appId),
        orgId: orgId ? String(orgId) : undefined,
        tier: resolveTier(req),
        tokensUsed,
        // The route path is the agent key here: it is what makes an
        // `ai_credit_usage` row attributable to a surface during an incident.
        agentKey: req.path,
        jurisdiction,
        model: usage.model,
        requestId,
        costUsd,
      })
      .catch((e: unknown) =>
        logger.warn('[NV-CREDIT-UNIVERSAL] record() failed (non-fatal)', {
          route: req.path,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    return tokensUsed;
  } catch (e: unknown) {
    logger.warn('[NV-CREDIT-UNIVERSAL] record() dispatch failed (non-fatal)', {
      route: req.path,
      error: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}
