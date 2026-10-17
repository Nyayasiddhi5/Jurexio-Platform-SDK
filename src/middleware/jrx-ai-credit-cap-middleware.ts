/**
 * nv-ai-credit-cap-middleware.ts — NV-CREDIT-UNIVERSAL-001 (pre-spend leg)
 *
 * Reusable pre-spend AI token-budget gate for routes that call a model but are
 * not the orchestrate/legal-chat handlers that already inline the enforcer.
 *
 * WHY A MIDDLEWARE RATHER THAN AN INLINE CALL PER ROUTE
 * ────────────────────────────────────────────────────
 * The audit behind NV-CREDIT-UNIVERSAL-001 found ~110 partner-reachable handlers
 * reaching a paid model call with no cap. Inlining `enforce()` into each would be
 * 110 chances to drift on the refusal shape, and a partner would then have to
 * branch per endpoint. One factory, one refusal contract.
 *
 * REFUSAL CONTRACT — identical to `/api/jrx/orchestrate` on purpose
 * ───────────────────────────────────────────────────────────────
 * HTTP 429 `RATE_LIMIT_EXCEEDED` with `details.code = 'CREDIT_CAP_EXCEEDED'`, so a
 * caller that already handles the orchestrate refusal handles this one unchanged.
 *
 * FAIL-SOFT — also matching `/orchestrate`
 * ────────────────────────────────────────
 * If the enforcer itself throws (missing credit table, DB blip) the request
 * proceeds. A broken meter must not deny a lawyer an answer; the alternative
 * turns a billing dependency into an availability dependency for the whole AI
 * surface.
 *
 * PARTNER BYPASS
 * ──────────────
 * `bypassCaps` is threaded from `wantsPartnerDemoUnlimited(req)`, the same source
 * `/orchestrate` uses, so NSP/NYM ecosystem traffic (NV-NSP-UNLIMITED-001, default
 * ON) is admitted exactly as before. This gate can therefore be added to a live
 * partner path without changing that partner's behaviour.
 *
 * NV-NO-DUPLICATE-001: no second enforcer — this calls `nvAICreditEnforcer`.
 * NV-WIRING-001: applied at route registration in src/routes/*.
 *
 * OBSERVE MODE (NV-CREDIT-OBSERVE-001)
 * ────────────────────────────────────
 * These caps default to *observe*: the enforcer still runs and a would-be refusal
 * is logged with the full budget arithmetic, but the request proceeds. See
 * `nv-credit-cap-observe.ts` for why (the budgets have never been compared to real
 * consumption, because the counter behind them was never written). The pre-existing
 * inline enforcement on `/orchestrate*` and `/legal-chat/send` does NOT import that
 * module and keeps refusing.
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createLogger } from '../utils/logger.js';
import { sendApiError } from '../utils/jrx-api-error.js';
import { estimatePromptTokens } from '../config/jrx-prompt-budget.js';
import { wantsPartnerDemoUnlimited } from '../utils/jrx-partner-platform.js';
import { nvAICreditEnforcer } from '../services/jrx-ai-credit-enforcer.js';
import { observeCreditCapRefusal, resolveCreditCapMode } from './jrx-credit-cap-observe.js';
import {
  estimateAuxCostMicroUsd,
  type NvAuxCostDriver,
  type NvAuxCostEstimate,
} from './jrx-aux-cost-estimator.js';

const logger = createLogger('./jrx-ai-credit-cap');

/** Body fields that carry the text we will actually send to a model. */
const PROMPT_BODY_KEYS = [
  'prompt', 'query', 'message', 'text', 'content', 'documentText', 'question',
  'input', 'instruction', 'outputText', 'userMessage',
] as const;

/**
 * Price the prompt we will actually send, not the bare instruction.
 *
 * An attached 60 KB contract is the dominant term; estimating on the instruction
 * alone is what lets a request through a cap it will then exceed (the
 * NV-INLINE-DOC-PROMPT-001 reasoning on `/orchestrate`).
 */
function estimateRequestTokens(req: Request, completionAllowance: number): number {
  const body = (req.body ?? {}) as Record<string, unknown>;
  let chars = 0;
  for (const key of PROMPT_BODY_KEYS) {
    const v = body[key];
    if (typeof v === 'string') chars += v.length;
  }
  // Chat-shaped payloads: messages[].content
  const msgs = body.messages;
  if (Array.isArray(msgs)) {
    for (const m of msgs) {
      const c = (m as { content?: unknown } | null)?.content;
      if (typeof c === 'string') chars += c.length;
    }
  }
  // Nothing recognisable in a known prompt field. Fall back to the serialised
  // body so an unusual field name under-prices rather than prices at zero — but
  // only when there was NO recognisable prompt at all. Adding it on top of a
  // matched prompt would let unrelated metadata (a 200 KB audit trail the caller
  // never asked us to send to a model) consume their token budget.
  if (chars === 0) {
    try { chars = JSON.stringify(body).length; } catch { chars = 0; }
  }
  const promptTokens = estimatePromptTokens('x'.repeat(Math.min(chars, 4_000_000)));
  return Math.min(promptTokens + completionAllowance, 200_000);
}

export interface NvAiCreditCapOptions {
  /**
   * Agent key stamped on the usage row / enforcer log. Defaults to the route path.
   */
  agentKey?: string;
  /**
   * Completion-side allowance added to the prompt estimate. These routes do not
   * resolve a `maxTokens` the way `/orchestrate` does, so a conservative fixed
   * allowance stands in for it. Under-estimating is the failure that matters.
   */
  completionAllowance?: number;
  /** Tier override when the route knows better than the request context. */
  tier?: string;
  /**
   * NV-CREDIT-COST-DIM-001 — meter this route in MONEY, not tokens.
   *
   * Set for the paid surfaces that consume no chat tokens. When set, the token
   * estimate is deliberately 0: pricing an embedding request's input text against
   * the gpt-4o-denominated daily token budget would over-charge it by ~100×, which
   * is the exact failure the cost dimension exists to remove.
   */
  costDriver?: NvAuxCostDriver;
  /**
   * Body fields carrying the billable quantity for `costDriver`. Defaults cover
   * the shapes in tree (`texts`/`documents` for embeddings, `text`/`script` for
   * TTS, `audio`/`audioBase64` for STT).
   */
  costBodyKeys?: readonly string[];
}

const DEFAULT_COMPLETION_ALLOWANCE = Number(
  process.env.NYV_AI_CREDIT_COMPLETION_ALLOWANCE || 4_096,
);

/** Where each driver's billable quantity lives in a request body, by observed shape. */
const COST_BODY_KEYS: Record<NvAuxCostDriver, readonly string[]> = {
  embedding_tokens: ['texts', 'documents', 'text', 'query', 'content', 'input'],
  tts_characters: ['text', 'script', 'input'],
  stt_audio_seconds: ['audioBase64', 'audio', 'content'],
  vision_images: ['image', 'imageBase64'],
  ocr_pages: ['pages', 'pageCount'],
};

function collectCostText(body: Record<string, unknown>, keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const v = body[key];
    if (typeof v === 'string') {
      out.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string') out.push(item);
        // `documents: [{ id, content }]` — the docs-pipeline embeddings shape.
        else if (item && typeof item === 'object') {
          const c = (item as { content?: unknown; text?: unknown }).content
            ?? (item as { text?: unknown }).text;
          if (typeof c === 'string') out.push(c);
        }
      }
    }
  }
  return out;
}

function buildAuxCostEstimate(
  req: Request,
  driver: NvAuxCostDriver,
  keys: readonly string[],
): NvAuxCostEstimate {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (driver === 'stt_audio_seconds') {
    const b64 = keys.map((k) => body[k]).find((v): v is string => typeof v === 'string' && v.length > 0);
    return estimateAuxCostMicroUsd({
      driver,
      audioBase64: b64,
      audioUrl: typeof body.audioUrl === 'string' ? body.audioUrl : undefined,
    });
  }
  if (driver === 'ocr_pages') {
    const declared = keys.map((k) => Number(body[k])).find((n) => Number.isFinite(n) && n > 0);
    return estimateAuxCostMicroUsd({ driver, pages: declared });
  }
  if (driver === 'vision_images') {
    const present = keys.some((k) => typeof body[k] === 'string' && (body[k] as string).length > 0);
    return estimateAuxCostMicroUsd({ driver, images: present ? 1 : 0 });
  }
  return estimateAuxCostMicroUsd({ driver, text: collectCostText(body, keys) });
}

interface AuthLikeUser {
  id?: string | number;
  userId?: string | number;
  sub?: string;
  organizationId?: string | null;
  tier?: string | null;
}

export function nvAiCreditCap(options: NvAiCreditCapOptions = {}): RequestHandler {
  const completionAllowance = options.completionAllowance ?? DEFAULT_COMPLETION_ALLOWANCE;
  const costDriver = options.costDriver;
  const costBodyKeys = options.costBodyKeys ?? (costDriver ? COST_BODY_KEYS[costDriver] : []);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sdkCtx = req.nvSdk;
      const user = (req as unknown as { user?: AuthLikeUser }).user;
      const jwtId = user?.id ?? user?.userId ?? user?.sub;
      const userId = jwtId !== undefined && jwtId !== null && String(jwtId).trim()
        ? String(jwtId)
        : sdkCtx?.appId
          ? `sdk_app_${sdkCtx.appId}`
          : 'anon';
      const orgId = sdkCtx?.orgId ?? user?.organizationId ?? undefined;
      const tier = options.tier ?? String(sdkCtx?.tier ?? user?.tier ?? 'pro');
      const agentKey = options.agentKey ?? req.path;

      const costEstimate: NvAuxCostEstimate | undefined = costDriver
        ? buildAuxCostEstimate(req, costDriver, costBodyKeys)
        : undefined;
      // A cost-metered surface prices in money only. Charging its input text against
      // the token budget as well would double-count the same request in two units.
      const estimatedTokens = costDriver ? 0 : estimateRequestTokens(req, completionAllowance);

      const check = await nvAICreditEnforcer.enforce({
        userId,
        orgId: orgId ? String(orgId) : undefined,
        tier,
        estimatedTokens,
        agentKey,
        bypassCaps: wantsPartnerDemoUnlimited(req),
        ...(costEstimate ? { estimatedCostMicroUsd: costEstimate.microUsd } : {}),
      });

      if (!check.allowed) {
        const mustRefuse = observeCreditCapRefusal({
          surface: req.path,
          agentKey,
          subject: {
            userId,
            orgId: orgId ? String(orgId) : undefined,
            apiKeyId: sdkCtx?.apiKeyId ? String(sdkCtx.apiKeyId) : undefined,
            appId: sdkCtx?.appId ? String(sdkCtx.appId) : undefined,
            tier,
          },
          estimatedTokens,
          ...(costEstimate ? { estimatedCostMicroUsd: costEstimate.microUsd } : {}),
          check,
        });
        if (!mustRefuse) {
          next();
          return;
        }
        sendApiError(res, 'RATE_LIMIT_EXCEEDED', {
          overrideMessage: 'NYV-CREDIT-001: AI token budget exceeded for this billing period.',
          details: {
            code: 'CREDIT_CAP_EXCEEDED',
            reason: check.reason,
            tier: check.tier,
            budgetLimit: check.budgetLimit,
            usedToday: check.usedToday,
            remainingToday: check.remainingToday,
            retryAfterSeconds: check.retryAfterSeconds ?? 3600,
          },
        });
        return;
      }
      next();
    } catch (err: unknown) {
      logger.warn('[NV-CREDIT-CAP] credit check failed (non-fatal)', {
        route: req.path,
        error: err instanceof Error ? err.message : String(err),
      });
      next();
    }
  };
}

/**
 * Current mode of the newly-added caps, for admin/observability surfaces. Re-exported
 * so callers do not have to import the observe module directly and accidentally reach
 * for it from a pre-existing enforced surface.
 */
export { resolveCreditCapMode };

