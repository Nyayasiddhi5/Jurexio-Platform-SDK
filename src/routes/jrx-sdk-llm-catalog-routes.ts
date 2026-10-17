/**
 * SDK LLM Catalog + Router Introspection Routes — Session-15 v15 TASK-A
 * (NV-PARTNER-INTROSPECTION-2026-05-11)
 *
 * Auth: sdkGatewayAuth (X-API-Key with Authorization: Bearer fallback).
 *
 * Mount: /api/jrx/v1/sdk/llm
 *
 *  GET  /catalog                    — full MODEL_CATALOG (115+ entries) with
 *                                     per-model availability based on whether
 *                                     the bound provider is reachable right now.
 *                                     Filters via query params: ?provider=,
 *                                     ?jurisdiction=, ?taskKind=, ?latestOnly=true,
 *                                     ?free=true, ?vision=true, ?reasoning=true.
 *  GET  /providers                  — provider availability matrix (live), the
 *                                     same shape as router-stats /providers but
 *                                     under SDK auth so partners can introspect.
 *  GET  /router/health              — aggregate health snapshot + recent decision
 *                                     stats (no PII; counters only).
 *  POST /router/explain             — given task hints (tier, jurisdiction,
 *                                     taskKind, requireVision, etc.) returns
 *                                     the model sequence WITHOUT calling the
 *                                     LLM. Lets partners predict cost/latency
 *                                     before they invoke an AI route.
 *
 * NV-API-CONTRACT-001: ALL ROUTES ARE ADDITIVE. No changes to any existing
 * surface. Safe to ship without a major version bump.
 *
 * NV-AUTH-HEADER-001: uses sdkGatewayAuth → which uses extractSdkApiKey.
 *
 * NV-WIRING-001: this file is imported and mounted in src/index.ts under
 * /api/jrx/v1/sdk/llm at the same place as the other v1 SDK routers.
 */

import { Router, Request, Response } from 'express';
import {
  MODEL_CATALOG,
  isProviderAvailable,
  pickSequence,
  getAggregates,
  getHealthSnapshot,
} from '../services/intelligent-router/index.js';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { secureRandomHex } from '../utils/jrx-secure-random.js';
import { createLogger } from '../utils/logger.js';
import { NYV_PLATFORM_VERSION } from '../config/nyv-master-config.js';

const router = Router();
const logger = createLogger('sdk-llm-catalog');

const PLATFORM_VERSION = NYV_PLATFORM_VERSION;
const DOCS_URL = 'https://docs.jurexio.example/canonical/04c-sdk-troubleshooting';

router.use(sdkGatewayAuth);

function envelopeOk(extra: Record<string, unknown> = {}) {
  return {
    success: true,
    requestId: secureRandomHex(8),
    platform: PLATFORM_VERSION,
    generated_at: new Date().toISOString(),
    ...extra,
  };
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === '1' || v === 1;
}

router.get('/catalog', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filterProvider = q.provider?.toLowerCase();
  const filterJurisdiction = q.jurisdiction?.toUpperCase();
  const filterTaskKind = q.taskKind;
  const latestOnly = asBool(q.latestOnly);
  const freeOnly = asBool(q.free);
  const requireVision = asBool(q.vision);
  const requireReasoning = asBool(q.reasoning);

  const filtered = MODEL_CATALOG.filter((m) => {
    if (filterProvider && m.provider !== filterProvider) return false;
    if (filterJurisdiction && m.jurisdictionFit && !(filterJurisdiction in m.jurisdictionFit)) return false;
    if (filterTaskKind && m.preferredFor && !m.preferredFor.includes(filterTaskKind as never)) return false;
    if (latestOnly && !m.isLatest) return false;
    if (freeOnly && !m.isFree) return false;
    if (requireVision && !m.capabilities.vision) return false;
    if (requireReasoning && !m.capabilities.reasoning) return false;
    return true;
  });

  res.json(envelopeOk({
    data: {
      total_in_catalog: MODEL_CATALOG.length,
      returned: filtered.length,
      filters_applied: {
        provider: filterProvider ?? null,
        jurisdiction: filterJurisdiction ?? null,
        taskKind: filterTaskKind ?? null,
        latestOnly,
        freeOnly,
        requireVision,
        requireReasoning,
      },
      models: filtered.map((m) => ({
        id: m.id,
        provider: m.provider,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        costInPer1M: m.costInPer1M,
        costOutPer1M: m.costOutPer1M,
        capabilities: m.capabilities,
        legalQuality: m.legalQuality,
        generalQuality: m.generalQuality,
        speedScore: m.speedScore,
        isFree: m.isFree,
        isLatest: m.isLatest ?? false,
        preferredFor: m.preferredFor ?? [],
        jurisdictionFit: m.jurisdictionFit ?? {},
        notes: m.notes ?? null,
        providerAvailable: isProviderAvailable(m.provider),
      })),
    },
    docs_url: DOCS_URL,
  }));
});

router.get('/providers', (_req: Request, res: Response) => {
  // Derive the provider list from MODEL_CATALOG so new providers added to the
  // catalog appear here automatically (no second source of truth to update).
  const providerSet = new Set<string>();
  for (const m of MODEL_CATALOG) providerSet.add(m.provider);
  const providers = Array.from(providerSet).sort();

  const matrix = providers.map((id) => {
    const modelsForProvider = MODEL_CATALOG.filter((m) => m.provider === id);
    return {
      id,
      available: isProviderAvailable(id),
      model_count_in_catalog: modelsForProvider.length,
      latest_models: modelsForProvider.filter((m) => m.isLatest).map((m) => m.id),
      sample_model: modelsForProvider[0]?.id ?? null,
    };
  });

  res.json(envelopeOk({
    data: {
      total_providers: providers.length,
      total_models: MODEL_CATALOG.length,
      providers: matrix,
    },
    docs_url: DOCS_URL,
  }));
});

router.get('/router/health', (_req: Request, res: Response) => {
  try {
    const aggregates = getAggregates();
    const health = getHealthSnapshot();
    res.json(envelopeOk({
      data: {
        catalog_size: MODEL_CATALOG.length,
        aggregates,
        health,
      },
      docs_url: DOCS_URL,
    }));
  } catch (err) {
    logger.error('router_health_failed', { error: (err as Error).message });
    res.status(500).json({
      success: false,
      requestId: secureRandomHex(8),
      platform: PLATFORM_VERSION,
      error: {
        code: 'ROUTER_HEALTH_UNAVAILABLE',
        message: 'Router health snapshot temporarily unavailable.',
        cause: 'router-snapshot-failed',
        retryable: true,
        retry_after_seconds: 5,
        docs_url: DOCS_URL,
      },
    });
  }
});

router.post('/router/explain', (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const decision = pickSequence({
      agentId: body.agentId as string | undefined,
      userId: body.userId as string | undefined,
      // NV-UAT-DEFAULT-ORG-001 (task #335): missing org → baseline '1'
      // in dev / E2E-bypass mode for catalog lookups. Production keeps undefined.
      organizationId: (body.organizationId as string | undefined) ??
        ((process.env.NODE_ENV !== 'production') ? '1' : undefined),
      tier: body.tier as string | undefined,
      plan: body.plan as string | undefined,
      jurisdiction: body.jurisdiction as string | undefined,
      taskKind: body.taskKind as never,
      promptTokens: body.promptTokens as number | undefined,
      expectedOutputTokens: body.expectedOutputTokens as number | undefined,
      requireJson: body.requireJson as boolean | undefined,
      requireVision: body.requireVision as boolean | undefined,
      requireReasoning: body.requireReasoning as boolean | undefined,
      maxCostUsd: body.maxCostUsd as number | undefined,
      preferCheaper: body.preferCheaper as boolean | undefined,
      preferredModels: body.preferredModels as string[] | undefined,
      fallbackModels: body.fallbackModels as string[] | undefined,
      forbiddenModels: body.forbiddenModels as string[] | undefined,
      patternKey: body.patternKey as string | undefined,
      app: body.app as string | undefined,
    });

    res.json(envelopeOk({
      data: {
        primary: decision.primary
          ? {
              id: decision.primary.id,
              provider: decision.primary.provider,
              displayName: decision.primary.displayName,
              estimated_cost_in_per_1m: decision.primary.costInPer1M,
              estimated_cost_out_per_1m: decision.primary.costOutPer1M,
              providerAvailable: isProviderAvailable(decision.primary.provider),
            }
          : null,
        sequence: decision.sequence.map((m) => ({
          id: m.id,
          provider: m.provider,
          displayName: m.displayName,
          providerAvailable: isProviderAvailable(m.provider),
          reasons: decision.reasonsByModel[m.id] ?? [],
        })),
        inputs: decision.inputs,
      },
      docs_url: DOCS_URL,
    }));
  } catch (err) {
    logger.error('router_explain_failed', { error: (err as Error).message });
    res.status(400).json({
      success: false,
      requestId: secureRandomHex(8),
      platform: PLATFORM_VERSION,
      error: {
        code: 'ROUTER_EXPLAIN_BAD_INPUT',
        message: 'Could not produce a routing decision for the supplied hints.',
        cause: 'router-explain-failed',
        retryable: false,
        details: (err as Error).message,
        docs_url: DOCS_URL,
      },
    });
  }
});

export default router;
