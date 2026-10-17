/**
 * NV Activity Publisher Middleware
 * ─────────────────────────────────────────────────────────────────────────────
 * Records every successful SDK gateway / nv5 call to nvActivityEventBus on
 * response finish. Pure metadata recording — no LLM emission, no body
 * inspection, no PII, no auth header inspection beyond the already-attached
 * `req.sdkContext` populated by the canonical SDK auth middleware
 * (`extractSdkApiKey`).
 *
 * Skips:
 *   - /health, /api/jrx/health* (would create infinite logs from healthchecks)
 *   - /api/jrx/activity/* (the consumer endpoints — never feed back into self)
 *   - status < 100 / >= 600 sentinel values (early-aborted requests)
 *
 * Guardrails honored:
 *   - NV-ARCH-001: outside the safety ring, post-response only.
 *   - NV-NAMING-001: grep showed no existing publisher; new file with `nv-` prefix.
 *   - NV-AUTH-HEADER-001: reads `req.sdkContext` populated upstream; never
 *     reads X-API-Key directly.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { nvActivityEventBus } from '../services/jrx-activity-event-bus.js';
import { deriveEventType } from '../routes/jrx-activity-stream-routes.js';

const SKIP_PREFIXES = [
  '/health',
  '/api/jrx/health',
  '/api/jrx/activity/',
  '/api/jrx/openapi.json',
  '/api/jrx/docs',
];

interface SdkContext {
  orgId?: string;
  apiKeyPrefix?: string;
  platformCode?: string;
  scope?: string;
  jurisdiction?: string;
}

export function activityPublisher(req: Request, res: Response, next: NextFunction): void {
  const path = req.originalUrl || req.url || '';
  if (SKIP_PREFIXES.some(p => path.startsWith(p))) return next();

  const startedAt = Date.now();
  // Prefer the canonical per-request id set globally in index.ts so the
  // ai_activity trace_id correlates with the rest of the request's telemetry.
  const requestId =
    (req as Request & { requestId?: string }).requestId ||
    (req.headers['x-request-id'] as string) ||
    randomUUID();
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    try {
      const status = res.statusCode;
      if (status < 100 || status >= 600) return;
      const ctx: SdkContext = (req as Request & { sdkContext?: SdkContext }).sdkContext ?? {};
      const headerJur = (req.headers['x-jurisdiction'] || req.headers['x-nv-jurisdiction']) as string | undefined;
      const routedAgent = (req as Request & { routedAgent?: string }).routedAgent;
      const route = path.split('?')[0];
      // Fall back to JWT-session orgId when there's no SDK context (e.g. console
      // calls authenticated via Bearer JWT instead of X-API-Key). Without this
      // those events would bucket as 'unknown' and never reach the org's feed.
      type SessionUserOrg = { orgId?: string; organization_id?: string; organizationId?: string };
      const sessUser = (req as Request & { user?: SessionUserOrg }).user;
      const sessOrg = sessUser?.orgId ?? sessUser?.organization_id ?? sessUser?.organizationId;
      // NV-AUDIT-TOKENS-001 — real LLM usage accumulated during this request
      // (recordLlmUsage → res.locals.nvUsage). Null/0 when the request made no
      // LLM calls (most non-AI routes), which is correct.
      const usage = res.locals?.nvUsage;
      const tokensUsed = usage ? (usage.promptTokens || 0) + (usage.completionTokens || 0) : 0;
      nvActivityEventBus.publish({
        orgId: ctx.orgId || sessOrg || 'unknown',
        requestId,
        ts: Date.now(),
        method: req.method,
        route,
        status,
        ms: Date.now() - startedAt,
        sdkKeyPrefix: ctx.apiKeyPrefix ?? null,
        platformCode: ctx.platformCode ?? null,
        scope: ctx.scope ?? null,
        userAgent: (req.headers['user-agent'] as string) || null,
        jurisdiction: (ctx.jurisdiction || (typeof headerJur === 'string' ? headerJur.toUpperCase() : null)) ?? null,
        agent: routedAgent ?? ctx.scope ?? null,
        eventType: deriveEventType(route),
        tokensUsed,
        modelProvider: usage?.provider ?? null,
        modelName: usage?.model ?? null,
        costUsd: usage?.costUsd ?? null,
      });
    } catch {
      /* never throw from finish handler */
    }
  });

  next();
}
