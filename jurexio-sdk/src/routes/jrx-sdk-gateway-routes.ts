// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { partnerIndiaScopeMiddleware } from '../middleware/jrx-partner-india-scope.js';
import { nvAiCreditCap } from '../middleware/jrx-ai-credit-cap-middleware.js';
import { extractCourtDocumentFields, buildCourtDocFieldBlock } from '../services/jrx-court-document-fields.js';
import { resolveIngestBytes, toCourtDocExtractOptions } from '../services/jrx-docparse-ingest-helper.js';
import { guardrailEnforcementMiddleware, responseGuardrailMiddleware, guardrailManager } from '../middleware/guardrails-enforcement.js';
import { sdkApplicationService } from '../services/sdk/sdk-application-service.js';
import { PLATFORM_VERSION, PLATFORM_NAME, SDK_CONFIG } from '../config/platform-config.js';
import type { LLMRequest, LLMResponse } from '../services/real-llm-service.js';
import { promptEnhancementPipeline } from '../orchestration/jrx-prompt-enhancement-pipeline.js';
import { responseEngineeringPipeline } from '../orchestration/jrx-response-engineering-pipeline.js';
import { sarvamAIService } from '../services/sarvam-translation-service.js';
import { realOCRPipelineService } from '../services/enterprise-platform/real-ocr-pipeline-service.js';
import { openaiDocumentIntelligenceService } from '../services/openai-document-intelligence-service.js';
import { razorpayPaymentService } from '../services/razorpay-payment-service.js';
import { grpoOptimizationService } from '../services/grpo-optimization-service.js';
import { lmCacheService } from '../services/lm-cache-service.js';
import {
  buildAgentCacheNamespace,
  matchAgentCacheNamespace,
} from '../services/jrx-cache-namespace.js';
import { appendAuditRecord } from '../middleware/jrx-sdk-tracking-middleware.js';
import { verbalizedSamplingService } from '../services/verbalized-sampling-service.js';
import { mem0PersistenceService } from '../services/mem0-persistence-service.js';
import { selfHealingMLService } from '../services/self-healing-ml-service.js';
import { getRegistryStats, getAgent as getRuntimeAgent, resolveRegistryAgentId } from '../services/agent-registry-service.js';
import { PromptGuardrailService } from '../../server/services/legal-agents/prompt-guardrail-service.js';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { nvCitationVerifier, nvHallucinationDetector } from '../services/jrx-orchestration-services.js';
import {
  wantsNspNymBestOutcome,
  resolveNspNymBestOutcomeQuality,
  isIndiaOnlyPartner,
} from '../utils/jrx-partner-platform.js';
import {
  buildLegalDraftSystemPrompt,
  buildLegalDraftUserPrompt,
  buildLegalSummarizeSystemPrompt,
  inferDraftDocFamily,
} from '../services/jrx-legal-drafting-prompt.js';
import { resolveFirmClauseOverlay } from '../services/jrx-firm-clause-library.js';
import { applyLegalResponseFormatting } from '../services/jrx-legal-response-format.js';
import { normalizeGatewayEmbeddingsTexts } from '../utils/jrx-embeddings-request-normalize.js';


const logger = createLogger('sdk-gateway-routes');

const promptGuardrailService = new PromptGuardrailService();

function buildLLMRequest(overrides: Partial<LLMRequest> & { id: string; userId: string; prompt: string }): LLMRequest {
  return {
    requirements: {
      complexity: 'medium',
      domain: 'analytical',
      priority: 'medium',
      costBudget: 'balanced',
      responseTime: 'balanced',
      qualityLevel: 'professional',
    },
    fallbackLevels: 3,
    timestamp: new Date(),
    ...overrides,
  };
}

const router = Router();
// NV-LLM-001 (R2): direct RealLLMService removed; executeWithOrchestration
// below now delegates to executeWithFullSafetyRing wrapper.

/**
 * NV-LLM-001 / NV-ARCH-001 (R2 — 2026-05-07):
 * Replaced the legacy partial wrapper (prompt-enhancement + response-eng only)
 * with the canonical full-safety-ring wrapper. Adds: tenant isolation,
 * guardrails, agent allocation, 22-section Parlant prompt, 5-tier memory +
 * RAG + GraphRAG, CoT/ReAct, halluc/cite/HITL, audit hash chain.
 *
 * Signature preserved so all 5 SDK gateway endpoints (chat/generate/analyze/
 * summarize/embed) work unchanged.
 */
async function executeWithOrchestration(
  llmRequest: LLMRequest,
  context: {
    agentId?: string;
    jurisdiction?: string;
    taskType?: string;
    domainContext?: string;
    tenantId?: string;
    matterId?: string;
    sdkContext?: any;
    enableHITL?: boolean;
    enableHallucinationCheck?: boolean;
    enableCitationVerification?: boolean;
    enableRAG?: boolean;
    enableMemory?: boolean;
  }
): Promise<LLMResponse & { orchestration: any }> {
  const { executeWithFullSafetyRing } = await import('../orchestration/jrx-sdk-orchestration-wrapper.js');

  // NV-SDK-MATTER-CTX-2026-05-11 (Session-15): Synthesize matterId from the
  // SDK request context when the caller didn't pass an explicit matter scope.
  // The 22-section system prompt (jrx-system-prompt-engine §22) hard-requires a
  // matter context — without it, latest-gen LLMs (esp. gpt-oss-120b:free) return
  // a fake JSON 400 ("Missing required matter context (matter_id, session_id, …)")
  // that gets piped straight into the SDK response, making it look like the
  // gateway returned canned/RAG data when in fact the LLM round-trip succeeded.
  // Deriving from {applicationId, apiKeyId, requestId} keeps the value stable
  // per-application + unique per-request so memory/audit scopes still partition.
  const sdkCtx = context.sdkContext || {};
  const synthMatterId = context.matterId
    || `sdk_matter_${sdkCtx.applicationId || 'gateway'}_${llmRequest.id}`;

  // Dev-mandate (Session-15): SDK callers run at enterprise tier so HITL/RAG/
  // memory/CoT/ReAct gates are unlocked end-to-end. Lock back to per-app tier
  // before broader prod rollout.
  return executeWithFullSafetyRing(llmRequest, {
    ctx: {
      tenantId: context.tenantId || sdkCtx.organizationId,
      userId: llmRequest.userId || `sdk_user_${sdkCtx.apiKeyId || 'anonymous'}`,
      organizationId: sdkCtx.organizationId,
      tier: 'enterprise',
      softPolicy: Boolean(sdkCtx.softPolicy),
    },
    sdkPlatform: sdkCtx.metadataPlatform || sdkCtx.platformUatLabel || 'gateway',
    agentKey: context.agentId || 'auto',
    jurisdiction: context.jurisdiction,
    taskType: context.taskType || 'legal-analysis',
    domainContext: context.domainContext || `${context.jurisdiction || 'India'} jurisdiction legal analysis`,
    tier: 'enterprise',
    matterId: synthMatterId,
    softPolicy: Boolean(sdkCtx.softPolicy),
    enableHITL: context.enableHITL ?? false,
    enableHallucinationCheck: context.enableHallucinationCheck ?? true,
    enableCitationVerification: context.enableCitationVerification ?? true,
    enableRAG: context.enableRAG ?? true,
    enableMemory: context.enableMemory ?? true,
  });
}

function formatAgentNameGw(id: string): string {
  return id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function normaliseV2AgentGw(raw: any): any {
  const id = raw.id || 'unknown';
  const module = raw.module || 'general';
  const jurisdictions: string[] = [];
  if (raw.jurisdictionScope?.primary) jurisdictions.push(...raw.jurisdictionScope.primary);
  const name = formatAgentNameGw(id);
  return {
    ...raw,
    id,
    name,
    category: module,
    practiceArea: module,
    jurisdiction: jurisdictions[0] || 'India',
    jurisdictions,
    status: 'active',
    description: raw.description || `${name} — ROMA ${raw.romaLevel || 'L5'} (${raw.tier} tier)`,
    capabilities: raw.capabilities || [module, 'legal-analysis', 'compliance'],
    systemPrompt: raw.systemPrompt || `You are ${name}, a ROMA ${raw.romaLevel || 'L5'} legal AI agent specialised in ${module}.`,
    preferredModels: raw.preferredModels || ['gpt-4o'],
    fallbackModels: raw.fallbackModels || ['gpt-4o-mini'],
  };
}

let legalAgentsRegistry: any = null;
try {
  // v5.1.0 format-b — Default registry: 164 agents w/ §0–§22 systemPrompt.
  const v3RegistryPath = path.resolve(process.cwd(), 'config/agent-registries/Jurexio-Legal-registry-Default.json');

  if (fs.existsSync(v3RegistryPath)) {
    const v3Data = JSON.parse(fs.readFileSync(v3RegistryPath, 'utf-8'));
    legalAgentsRegistry = { ...v3Data, agents: (v3Data.agents || []).map(normaliseV2AgentGw) };
    const totalCount = legalAgentsRegistry?.agents?.length || 0;
    if (totalCount === 0) {
      logger.error('SDK Gateway: v3 registry loaded but contains 0 agents');
    } else {
      logger.info(`SDK Gateway: v5 ROMA L5 registry loaded — ${totalCount} agents (Default jurisdiction, §0–§22 v5 sections)`);
    }
  } else {
    logger.error(`SDK Gateway: v3 registry not found at ${v3RegistryPath}`);
  }
} catch (error: any) {
  logger.error('SDK Gateway: Failed to load legal agents registry:', error);
}

function getAgentFromRegistry(agentId: string): any | null {
  const resolvedId = resolveRegistryAgentId(agentId) || agentId;
  const runtimeAgent = getRuntimeAgent(resolvedId);
  if (runtimeAgent) return normaliseV2AgentGw(runtimeAgent);
  if (legalAgentsRegistry?.agents) {
    return legalAgentsRegistry.agents.find((a: any) => a.id === resolvedId || a.id === agentId) || null;
  }
  return null;
}

function getAllRegistryAgents(): any[] {
  if (legalAgentsRegistry?.agents) {
    return legalAgentsRegistry.agents.map((a: any) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      practiceArea: a.practiceArea || a.practice_area,
      jurisdiction: a.jurisdiction,
      romaLevel: a.romaLevel,
      /*
       * NV-CAPABILITY-MANIFEST-001 (2026-08-18) — project the fields a partner needs to
       * build an assignable skill catalogue.
       *
       * NSP asked for a machine-readable manifest: stable key, purpose, required inputs,
       * output schema, whether it produces citations, typical latency, credit cost. This
       * endpoint returned only 6 fields for 148 agents, so they concluded the capability was
       * missing. It was not — the registry already carries ~60 fields per agent including
       * `inputTypes`, `outputFormats`, `performanceTargets`, `capabilities`, `agentSkills`
       * and `mcpToolsAllowed`. We were simply under-projecting.
       *
       * Extending the existing canonical endpoint rather than minting a new manifest route:
       * NSP already reconciles four registries that disagree, and a fifth from us would make
       * it worse. This is additive, so no existing consumer breaks (NV-API-CONTRACT-001).
       */
      description: a.description,
      capabilities: Array.isArray(a.capabilities) ? a.capabilities : undefined,
      inputTypes: Array.isArray(a.inputTypes) ? a.inputTypes : undefined,
      outputFormats: Array.isArray(a.outputFormats) ? a.outputFormats : undefined,
      /* `tools` is the agent's own allow-list; `mcpToolsAllowed` is the MCP surface it may
       * reach. Both matter to a catalogue: the first says what it does, the second what it
       * can call. */
      tools: Array.isArray(a.tools) ? a.tools : undefined,
      mcpToolsAllowed: Array.isArray(a.mcpToolsAllowed) ? a.mcpToolsAllowed : undefined,
      /*
       * Derived, not invented. A citation-producing agent is identifiable three ways in the
       * registry, and NSP needs a single boolean to badge on: the mandatory citation skill,
       * a citation-verification performance target, or a citation-shaped capability. Stated
       * as a derivation so nobody mistakes it for an editorially curated flag.
       */
      producesCitations: (() => {
        const skills = JSON.stringify(a.agentSkills ?? '');
        const caps = JSON.stringify(a.capabilities ?? '');
        const perf = JSON.stringify(a.performanceTargets ?? '');
        return /SKILL-CITATION|citation/i.test(skills)
          || /citation/i.test(caps)
          || /citationVerificationRate/i.test(perf);
      })(),
      /* The registry states these as human strings ("< 3s"); passed through verbatim rather
       * than parsed to a number, because inventing a precision the registry does not have
       * would be worse than making the partner read a string. */
      performanceTargets: a.performanceTargets ?? undefined,
      /* Subscription gating is the closest thing we have to a credit cost. NSP asked for
       * cost; this is what exists, and calling it `subscriptionGating` keeps it honest
       * instead of dressing it up as a per-call price we do not track here. */
      subscriptionGating: a.subscriptionGating ?? undefined,
      agentSkills: a.agentSkills ?? undefined,
      status: a.status,
      version: a.version,
    }));
  }
  return [];
}

/* NV-CREDIT-UNIVERSAL-001 — pre-spend cap on the gateway's model-calling routes.
 *
 * These all reach `executeWithOrchestration` → the safety ring → a paid provider,
 * and none of them was capped: only `/orchestrate` and `/legal-chat/send` were.
 * Same enforcer, same `CREDIT_CAP_EXCEEDED` refusal, and `bypassCaps` still
 * honours NSP/NYM demo-unlimited — so live partner traffic is unchanged and only
 * an uncapped non-partner caller is newly refused.
 *
 * The completion allowance is higher for drafting and research than for analysis
 * because those return a whole document; under-pricing the completion is what
 * admits a request that then blows the cap. */
const gatewayDocCap = nvAiCreditCap({ agentKey: 'gateway:documents', completionAllowance: 4_096 });
const gatewayDraftCap = nvAiCreditCap({ agentKey: 'gateway:documents/draft', completionAllowance: 8_192 });
const gatewayResearchCap = nvAiCreditCap({ agentKey: 'gateway:research', completionAllowance: 8_192 });
const gatewayAgentCap = nvAiCreditCap({ agentKey: 'gateway:agents/execute', completionAllowance: 4_096 });
/* NV-CREDIT-COST-DIM-001 — embeddings bill per input token at an embedding rate, not
 * a chat rate, so this cap meters MONEY (micro-USD) instead of tokens. Pricing this
 * route's input text against the gpt-4o-denominated daily token budget would
 * over-charge it by roughly 100×. Observe mode, same as every cap in this file. */
const gatewayEmbeddingsCap = nvAiCreditCap({
  agentKey: 'gateway:documents/embeddings',
  costDriver: 'embedding_tokens',
});

function checkScope(scopes: string[], required: string): boolean {
  return scopes.includes(required) || scopes.includes('*');
}

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
/* NV-PARTNER-INDIA-SCOPE-001 (gateway) — NSP and NYM are India-only products, but
 * this router was the one partner surface where that was never enforced: every
 * other partner router (knowledge, cnr, orchestrate, intelligence) mounts this
 * middleware, so an NSP key sending `jurisdiction: "US"` to
 * `/api/jrx/gateway/documents/analyze` or `/research/query` was answered under US
 * law. Mounted AFTER sdkGatewayAuth because it reads `req.sdkContext` to identify
 * the platform. It is a no-op for every non-India partner (`isIndiaOnlyPartner`
 * gates on INDIA_ONLY_PARTNER_CODES = NSP/NYM), so JRX and internal callers are
 * unaffected. */
router.use(partnerIndiaScopeMiddleware);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);
// N5 (2026-05-09, FINAL post-architect post-investigation): NO additional
// tracking middleware needed. The canonical writer to public.sdk_api_request_logs
// is already wired inside sdkGatewayAuth (src/middleware/jrx-sdk-gateway.ts:566–599
// — `res.on('finish')` → `db.insert(sdkApiRequestLogs).values({...})`). Adding
// sdkTrackingMiddleware here was redundant AND broke env-var SDK keys (which
// resolveApiKey doesn't recognize, only DB-stored sdk_app_api_keys are).
// Verified writes via psql: rows 5227–5229 (200) and 5230–5231 (401) confirm
// the existing writer is live. Architect was right that the dynamic-import
// `withSdkTracking` mount was a no-op; investigation showed it was also
// redundant — the audit coverage was never actually missing.

/**
 * GET /api/jrx/gateway/templates — NSP probe alias for canonical catalog.
 * NV-TEMPLATES-API-001: same envelope as GET /api/jrx/templates.
 */
router.get('/templates', async (req: Request, res: Response): Promise<void> => {
  try {
    const { nspCatalogEnvelope } = await import('../services/jrx-templates-catalog-service.js');
    const { isIndiaOnlyPartner } = await import('../utils/jrx-partner-platform.js');
    const indiaOnly = isIndiaOnlyPartner(req);
    const envelope = nspCatalogEnvelope({
      jurisdiction: indiaOnly ? 'IN' : (req.query.jurisdiction ? String(req.query.jurisdiction) : undefined),
      includeNonIndia: indiaOnly ? false : undefined,
      category: req.query.category
        ? String(req.query.category)
        : req.query.document_type
          ? String(req.query.document_type)
          : undefined,
      complexity: req.query.complexity ? String(req.query.complexity) as any : undefined,
      q: req.query.q ? String(req.query.q) : req.query.search ? String(req.query.search) : undefined,
      kind: req.query.kind ? String(req.query.kind) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    });
    res.setHeader('X-JRX-Templates-Count', String(envelope.data.total));
    res.json(envelope);
  } catch (err: any) {
    logger.error('gateway/templates failed', { error: err?.message });
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: err?.message || 'templates failed' } });
  }
});

/**
 * GET /api/jrx/agents/registry-version  (NV-AGENT-REG-VERSION-001, 2026-05-09)
 * Per directive: "ensure the agent version is queries to fetch so that any
 * updated future agents registry will be proper and scalable."
 *
 * Returns per-jurisdiction registry inventory: file, agent count, version
 * set, sha256 hash. Auth: any valid SDK key (X-API-Key) with `agents:read`.
 * Source-of-truth: config/agent-registries/*.json (v5.1.0 — 164 runtime agents;
 * archived v5.0.0 flat backup 1042 under archive/v5.0.0/, forensic mode only).
 * Legacy 275-agent file (src/data/jrx-agents-registry.legacy-v2-*.json) is
 * NOT included — retired 2026-05-09.
 */
router.get('/agents/registry-version', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  try {
    const runtimeStats = getRegistryStats();
    const fs = await import('fs');
    const path = await import('path');
    const crypto = await import('crypto');
    const dir = path.join(process.cwd(), 'config', 'agent-registries');
    const files = fs.readdirSync(dir).filter(f =>
      f.startsWith('Jurexio-Legal-registry-') && f.endsWith('.json') && !f.includes('archive'),
    );
    const registries = files.map(f => {
      const full = path.join(dir, f);
      const buf = fs.readFileSync(full);
      const json = JSON.parse(buf.toString());
      const agents: any[] = Array.isArray(json) ? json : (json.agents || []);
      const versions = Array.from(new Set(agents.map((a: any) => a?.version || 'none'))).sort();
      const jurisdictions = Array.from(new Set(agents.map((a: any) => a?.jurisdiction || 'none'))).sort();
      return {
        file: f,
        jurisdictionCode: f.replace(/^Jurexio-Legal-registry-/, '').replace(/\.json$/, ''),
        agentCount: agents.length,
        agentVersions: versions,
        jurisdictions,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        sizeBytes: buf.length,
        modifiedAt: fs.statSync(full).mtime.toISOString(),
      };
    });
    const inventoryTotalAgents = registries.reduce((s, r) => s + r.agentCount, 0);
    const allVersions = Array.from(new Set(registries.flatMap(r => r.agentVersions))).sort();
    res.json({
      success: true,
      data: {
        canonicalVersion: runtimeStats.registryVersion,
        registryCount: registries.length,
        totalAgents: runtimeStats.totalAgents,
        registryFormat: runtimeStats.registryFormat,
        practiceAreas: runtimeStats.practiceAreas,
        runtimeJurisdictions: runtimeStats.jurisdictions,
        inventoryTotalAgents,
        archivedBackupAgents: runtimeStats.archivedBackupAgents,
        forensicMode: runtimeStats.forensicMode,
        mcpTools: runtimeStats.mcpTools,
        topologyCatalog: runtimeStats.topologyCatalog,
        agentVersions: allVersions,
        retiredFiles: ['src/data/jrx-agents-registry.json (v2.0.0, 275 agents) — renamed *.legacy-v2-2026-05-09.json'],
        registries,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: 'Failed to read agent registries', detail: e.message });
  }
});

/* GET /gateway/models — alias of /api/jrx/models for SDK consumers (NSP/NYM)
 * so they can reach agents AND models under one /gateway/* prefix with the
 * same X-API-Key auth. Read-through to the dynamic model registry; respects
 * the same query filters as /api/jrx/models (type, tier, jurisdiction,
 * provider, enabled, search). Added 2026-05-12 per user request. */
router.get('/models', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'models:read') && !checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: models:read or agents:read' });
    return;
  }
  try {
    const { dynamicModelRegistry } = await import('../config/jrx-dynamic-model-registry.js');
    const { type, tier, jurisdiction, provider, enabled, search } = req.query as Record<string, string | undefined>;
    let models = dynamicModelRegistry.getAll();
    if (type) models = models.filter((m: any) => m.type === type);
    if (tier) models = models.filter((m: any) => m.routing.tier === Number(tier));
    if (jurisdiction) models = models.filter((m: any) =>
      m.capabilities.supportedJurisdictions.includes(jurisdiction) ||
      m.capabilities.supportedJurisdictions.includes('GLOBAL')
    );
    if (provider) models = models.filter((m: any) => m.provider === provider);
    if (enabled !== undefined) models = models.filter((m: any) => m.enabled === (enabled === 'true'));
    if (search) {
      const q = search.toLowerCase();
      models = models.filter((m: any) =>
        m.id.toLowerCase().includes(q) ||
        m.displayName.toLowerCase().includes(q) ||
        (m.tags || []).some((t: string) => t.includes(q))
      );
    }
    res.json({
      success: true,
      data: {
        applicationId: ctx.applicationId,
        appName: ctx.appName,
        total: models.length,
        models: models.sort((a: any, b: any) => a.routing.tier - b.routing.tier || a.routing.priority - b.routing.priority),
        stats: dynamicModelRegistry.getStats(),
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: 'Failed to read model registry', detail: e.message });
  }
});

router.get('/agents', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }

  /* ── T002: Redis cache for agent registry (60-min TTL) ──────
   * Agent list is static per deployment — cache aggressively.
   * Cache key is per-application so allowedAgents filter is respected.
   *
   * NV-CAPABILITY-MANIFEST-001 (2026-08-18) — the key now includes a BUILD component.
   *
   * The comment above says "static per deployment", but the key carried no build or version
   * marker, so a deploy did NOT invalidate it. Measured: after shipping the widened
   * projection (NSP's capability manifest), the live endpoint still returned the old 6-field
   * shape and every new field read as MISSING — a stale 60-minute cache serving pre-deploy
   * data while the new code sat unused. The same trap would silently hide any future
   * registry change for up to an hour, and a partner would reasonably conclude the
   * capability was never shipped.
   *
   * `JRX_BUILD_ID` is set by the deploy; the registry agent count is a cheap fallback that
   * changes whenever the registry itself does.
   */
  const registryBuildMarker = String(
    process.env.JRX_BUILD_ID
      || process.env.JRX_DEPLOY_ID
      || `agents-${legalAgentsRegistry?.agents?.length ?? 0}`,
  );
  const cacheKey = `agent-registry:v2:${registryBuildMarker}:${ctx.applicationId}:${ctx.allowedAgents.sort().join(',')}`;
  let filteredAgents: unknown[] | null = null;
  try {
    const { cacheGet, cacheSet } = await import('../services/redis-cache.js').catch(() => ({ cacheGet: null, cacheSet: null }));
    if (cacheGet) {
      filteredAgents = (await cacheGet(cacheKey)) as unknown[] | null;
    }
    if (!filteredAgents) {
      const allAgents = getAllRegistryAgents();
      const allowedAgents = ctx.allowedAgents;
      filteredAgents = allowedAgents.length > 0
        ? allAgents.filter(agent => (agent as any).id && allowedAgents.includes((agent as any).id))
        : allAgents;
      if (cacheSet) await cacheSet(cacheKey, filteredAgents, 3600);
    }
  } catch {
    /* Redis unavailable — fall through to live data */
    const allAgents = getAllRegistryAgents();
    filteredAgents = ctx.allowedAgents.length > 0
      ? allAgents.filter(agent => (agent as any).id && ctx.allowedAgents.includes((agent as any).id))
      : allAgents;
  }

  res.json({
    success: true,
    data: {
      applicationId: ctx.applicationId,
      appName: ctx.appName,
      total: (filteredAgents as unknown[]).length,
      agents: filteredAgents,
    },
  });
});

router.post('/agents/:agentId/execute', gatewayAgentCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const rawAgentId = String(req.params.agentId);
  const agentId = resolveRegistryAgentId(rawAgentId) || rawAgentId;
  const { prompt, context, jurisdiction, options, documentText, content, status: docStatus } = req.body ?? {};

  // Empty / document-pending → clear 400 (no useless AI call). Guardrail, not key change.
  const reviewLike =
    /review/i.test(rawAgentId) ||
    /review/i.test(agentId) ||
    agentId === 'contract-reviewer';
  if (reviewLike) {
    const candidateText =
      (typeof documentText === 'string' && documentText) ||
      (typeof content === 'string' && content) ||
      (typeof prompt === 'string' && prompt) ||
      (typeof context?.documentText === 'string' && context.documentText) ||
      (typeof context?.content === 'string' && context.content) ||
      (typeof context?.document === 'string' && context.document) ||
      '';
    const pending =
      typeof docStatus === 'string' ? docStatus :
      typeof context?.status === 'string' ? context.status :
      undefined;
    const trimmed = String(candidateText).trim();
    const isPending =
      (pending && /pending|document[_-]?pending|not[_-]?ready|processing/i.test(pending)) ||
      !trimmed ||
      trimmed.length < 20 ||
      /^(document[_-]?pending|pending|null|undefined)$/i.test(trimmed);
    if (isPending) {
      res.status(400).json({
        success: false,
        error: 'Document text is empty or still pending. Wait for parse/ingest to finish, then retry review.',
        code: 'DOCUMENT_TEXT_PENDING_OR_EMPTY',
        field: 'documentText',
        retryable: true,
        agentId: rawAgentId,
      });
      return;
    }
  }

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }

  // Signature / allowlist check: resolve aliases so contract-review-deep is not blocked
  // when the app allowlist contains contract-reviewer (keep guardrail, expand exempt set).
  // Soft policy (NSP/NYM): skip allowlist entirely for integration testing.
  const softPolicy = Boolean(ctx.softPolicy);
  const allowed = softPolicy ? [] : (ctx.allowedAgents || []);
  if (allowed.length > 0) {
    const allowedResolved = new Set(
      allowed.flatMap((a) => {
        const r = resolveRegistryAgentId(a) || a;
        return [a, r];
      }),
    );
    // If app already allows any contract-review* agent, deep alias is exempt.
    const allowsContractReview = [...allowedResolved].some((a) =>
      /contract[-_]?review/i.test(String(a)),
    );
    if (allowsContractReview) {
      allowedResolved.add('contract-reviewer');
      allowedResolved.add('contract-review-deep');
    }
    if (!allowedResolved.has(agentId) && !allowedResolved.has(rawAgentId)) {
      res.status(403).json({
        success: false,
        error: `Agent "${rawAgentId}" is not in the allowed agents list for this application.`,
        code: 'nv_sdk_policy_violation',
        agentId: rawAgentId,
        resolvedAgentId: agentId,
      });
      return;
    }
  }

  const agent = getAgentFromRegistry(agentId);
  const effectiveJurisdiction = jurisdiction || ctx.jurisdiction;
  const llmConfig = ctx.llmConfig || {};
  const requestId = ctx.requestId || crypto.randomUUID();

  let promptCompliance: any = null;
  if (agent?.systemPrompt) {
    const validation = promptGuardrailService.validateSystemPrompt(agent.systemPrompt);
    promptCompliance = {
      score: validation.score,
      maxScore: validation.maxScore,
      percentage: validation.percentage,
      format: validation.format,
      compliant: validation.valid,
    };
  }

  try {
    const llmRequest = buildLLMRequest({
      id: requestId,
      userId: `sdk_app_${ctx.applicationId}`,
      prompt: prompt,
      systemPrompt: agent?.systemPrompt || `You are a legal AI agent (${agentId}) specializing in ${agent?.practiceArea || 'general law'} for jurisdiction ${effectiveJurisdiction}. Provide accurate, well-reasoned legal analysis.`,
      model: llmConfig.model || 'auto',
      provider: llmConfig.provider || SDK_CONFIG.defaults.provider,
      maxTokens: Math.min(llmConfig.maxTokens || SDK_CONFIG.defaults.maxTokensPerRequest, SDK_CONFIG.defaults.maxTokensPerRequest),
      temperature: llmConfig.temperature ?? SDK_CONFIG.defaults.temperature,
      context: {
        agentId,
        agentName: agent?.name || agentId,
        jurisdiction: effectiveJurisdiction,
        appName: ctx.appName,
        appType: ctx.appType,
        ...(context || {}),
      },
    });

    const llmResponse = await executeWithOrchestration(llmRequest, {
      agentId,
      sdkContext: ctx,
      jurisdiction: effectiveJurisdiction,
      taskType: 'agent-execution',
      domainContext: `${agent?.practiceArea || 'general law'} under ${effectiveJurisdiction} jurisdiction`,
    });

    const envelopeMethod = reviewLike ? 'contract_review' : 'agent_execution';

    res.json({
      success: true,
      method: envelopeMethod,
      envelope: envelopeMethod,
      data: {
        agentId: rawAgentId,
        resolvedAgentId: agentId,
        agentName: agent?.name || agentId,
        requestId,
        response: llmResponse.content,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        qualityScore: llmResponse.qualityScore,
        latencyMs: Date.now() - startTime,
        jurisdiction: effectiveJurisdiction,
        orchestration: llmResponse.orchestration,
        promptCompliance,
        timestamp: new Date().toISOString(),
        // snake_case companions for partner parsers
        agent_id: rawAgentId,
        resolved_agent_id: agentId,
        request_id: requestId,
        quality_score: llmResponse.qualityScore,
        latency_ms: Date.now() - startTime,
        review_type: envelopeMethod,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `Agent execution failed: ${error?.message || 'Unknown error'}`,
      data: {
        agentId: rawAgentId,
        resolvedAgentId: agentId,
        requestId,
        latencyMs: Date.now() - startTime,
      },
    });
  }
});

router.get('/agents/:agentId/status', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }

  const agentId = String(req.params.agentId);
  const agent = getAgentFromRegistry(agentId);

  if (!agent) {
    res.status(404).json({ success: false, error: `Agent "${agentId}" not found in the registry.` });
    return;
  }

  res.json({
    success: true,
    data: {
      agentId: agent.id,
      name: agent.name,
      tier: agent.tier,
      practiceArea: agent.practiceArea || agent.practice_area,
      romaLevel: agent.romaLevel,
      status: 'available',
      jurisdiction: agent.jurisdiction,
      lastHealthCheck: new Date().toISOString(),
    },
  });
});

/* NV-CREDIT-UNIVERSAL-001 — see the cap factory block above `checkScope`. */
router.post('/documents/analyze', gatewayDocCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const body = req.body || {};
  const content =
    (typeof body.content === 'string' && body.content) ||
    (typeof body.documentText === 'string' && body.documentText) ||
    (typeof body.text === 'string' && body.text) ||
    '';
  const type = (typeof body.type === 'string' && body.type.trim()) || 'legal';
  const jurisdiction = body.jurisdiction;

  if (!content || typeof content !== 'string') {
    res.status(400).json({
      success: false,
      error: 'Missing required field: content (aliases: documentText, text)',
      code: 'DOCUMENT_TEXT_REQUIRED',
    });
    return;
  }
  const contentTrim = content.trim();
  if (
    !contentTrim ||
    contentTrim.length < 20 ||
    /^(document[_-]?pending|pending|null|undefined)$/i.test(contentTrim)
  ) {
    res.status(400).json({
      success: false,
      error: 'Document text is empty or still pending. Wait for parse/ingest to finish, then retry analysis.',
      code: 'DOCUMENT_TEXT_PENDING_OR_EMPTY',
      field: 'content',
      retryable: true,
    });
    return;
  }

  const effectiveJurisdiction = jurisdiction || ctx.jurisdiction;
  const requestId = ctx.requestId || crypto.randomUUID();

  const contentPreview = content.length > 3000 ? content.substring(0, 3000) + '\n\n[Document truncated for analysis — full document is ' + content.length + ' characters]' : content;

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Document analysis timed out after 90 seconds. Try with shorter content.')), 90000);
    });

    const llmRequest = buildLLMRequest({
      id: requestId,
      userId: `sdk_app_${ctx.applicationId}`,
      prompt: `Analyze the following ${type} document under ${effectiveJurisdiction} jurisdiction. Provide structured analysis covering:\n1. Key entities and parties\n2. Important clauses and terms\n3. Risk assessment (high/medium/low)\n4. Compliance status\n5. Missing or problematic clauses\n\nDocument:\n${contentPreview}`,
      systemPrompt: `You are a legal document analysis AI specialized in ${effectiveJurisdiction} law. Extract entities, identify clauses, assess risk levels, and evaluate compliance. Return concise, structured analysis.`,
      model: ctx.llmConfig?.model || 'auto',
      provider: ctx.llmConfig?.provider || SDK_CONFIG.defaults.provider,
      maxTokens: Math.min(SDK_CONFIG.defaults.maxTokensPerRequest, 2000),
      temperature: 0.3,
    });

    const llmResponse = await Promise.race([
      executeWithOrchestration(llmRequest, {
        sdkContext: ctx,
        jurisdiction: effectiveJurisdiction,
        taskType: 'document-analysis',
        domainContext: `${type} document analysis under ${effectiveJurisdiction} jurisdiction`,
      }),
      timeoutPromise,
    ]);

    /* NV-COURT-DOC-FIELDS-001 — attach structured fields alongside the prose.
     *
     * `analysis` is left byte-identical for existing consumers; this is purely
     * additive. NSP asked for this because prose alone gave them nothing to attach
     * to a matter, so they fell back to their own regex layer and badged extraction
     * as "Heuristic" — while we were already paying for a full LLM read.
     *
     * Extraction is deterministic and runs off the same `content`, so it costs no
     * extra tokens and cannot fail the request: a throw here would turn a working
     * analysis into an error, which is strictly worse than returning prose alone. */
    let extraction: Awaited<ReturnType<typeof extractCourtDocumentFields>> | null = null;
    let extractionOutcome: { failed?: boolean; reason?: string } | null = null;
    const ingestCtx = resolveIngestBytes(body);
    const extractOpts = toCourtDocExtractOptions(ingestCtx, {
      batchId: requestId,
      actor: `sdk:${ctx.applicationId}`,
    });
    try {
      extraction = await extractCourtDocumentFields(content, effectiveJurisdiction, extractOpts);
    } catch (fieldErr: unknown) {
      /* NV-ANALYZE-STATUS-005 — record that this was a *throw*, not an empty document.
       * Swallowing it silently is what made `[]` ambiguous for NSP. */
      extractionOutcome = {
        failed: true,
        reason: 'Structured field extraction failed; arrays are empty because extraction did not complete.',
      };
      logger.warn('[Gateway] court-document field extraction failed (non-fatal)', {
        requestId,
        err: fieldErr instanceof Error ? fieldErr.message : String(fieldErr),
      });
    }

    res.json({
      success: true,
      data: {
        analysisId: `doc_analysis_${requestId}`,
        requestId,
        documentType: type,
        jurisdiction: effectiveJurisdiction,
        analysis: llmResponse.content,
        /* Structured extraction — the part partners badge on. `fieldSource: 'nyv'`
         * is what lets NSP show "JRX" instead of "Heuristic".
         * NV-COURT-DOC-FIELDS-004: shaped by the shared builder so this handler and
         * the orchestrate path cannot drift apart again. */
        ...buildCourtDocFieldBlock(extraction, null, extractionOutcome),
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        latencyMs: Date.now() - startTime,
        orchestration: llmResponse.orchestration,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = error?.message?.includes('timed out') || latencyMs > 50000;
    res.status(isTimeout ? 504 : 500).json({
      success: false,
      error: `Document analysis failed: ${error?.message || 'Unknown error'}`,
      data: { requestId, latencyMs },
    });
  }
});

// ── Phase 1 audit-fix 2026-05-11: short-form aliases ─────────────────────────
// Several Console pages and downstream SDKs historically called /draft,
// /analyze, /summarize at the gateway root. The canonical routes live under
// /documents/{...}; these aliases preserve old call sites with a 308 PERMANENT
// REDIRECT (POST body preserved) so any pinned client keeps working. Additive
// only — no behavioural change for callers already on the canonical path.
router.post('/draft',     (_req: Request, res: Response) => res.redirect(308, '/api/jrx/gateway/documents/draft'));
router.post('/analyze',   (_req: Request, res: Response) => res.redirect(308, '/api/jrx/gateway/documents/analyze'));
router.post('/summarize', (_req: Request, res: Response) => res.redirect(308, '/api/jrx/gateway/documents/summarize'));

router.post('/documents/draft', gatewayDraftCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:write' });
    return;
  }

  const { template, parameters, jurisdiction, depth, documentType, instruction } = req.body;

  // NSP/NYM SDK callers sometimes send `prompt` / `instruction` without a named
  // template — coerce to a custom draft so AI tasks do not hard-400.
  let effectiveTemplate = template;
  let effectiveParameters = parameters;
  if ((!effectiveTemplate || typeof effectiveTemplate !== 'string') && typeof req.body?.prompt === 'string') {
    effectiveTemplate = 'custom';
    effectiveParameters = {
      ...(typeof parameters === 'object' && parameters ? parameters : {}),
      instruction: req.body.prompt,
    };
  }
  if (!effectiveTemplate || typeof effectiveTemplate !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: template' });
    return;
  }

  if (!effectiveParameters || typeof effectiveParameters !== 'object') {
    res.status(400).json({ success: false, error: 'Missing required field: parameters' });
    return;
  }

  // SME forum precision: lift top-level court/district fields into parameters
  // NV-NSP-DRAFT-CONTRACT-001: also lift NSP drafting contract keys.
  effectiveParameters = {
    ...(effectiveParameters as Record<string, unknown>),
    ...(['highCourt', 'courtName', 'district', 'state', 'seat', 'policeStation', 'bench', 'place'] as const).reduce(
      (acc, key) => {
        const v = (req.body as Record<string, unknown>)?.[key];
        if (v != null && String(v).trim()) acc[key] = String(v).trim();
        return acc;
      },
      {} as Record<string, string>,
    ),
    ...([
      '_nspDraftRequirements',
      '_outputFormat',
      '_tone',
      '_language',
      '_jurisdiction',
      '_bnssApplicationKey',
      '_bnssSections',
      // NV-FIRM-CLAUSE-DRAFT-001 — the firm's own clause wording. Lifted like
      // any other NSP contract key; it is tenant-checked before it can reach a
      // prompt, so lifting it here is not a trust decision.
      '_firmClauseLibrary',
      'maxTokens',
    ] as const).reduce(
      (acc, key) => {
        const top = (req.body as Record<string, unknown>)?.[key];
        const nested = (effectiveParameters as Record<string, unknown>)?.[key];
        if (top != null) acc[key] = top as any;
        else if (nested != null) acc[key] = nested as any;
        return acc;
      },
      {} as Record<string, unknown>,
    ),
  };
  if ((req.body as any)?._nspDraftRequirements != null && !(effectiveParameters as any)._nspDraftRequirements) {
    (effectiveParameters as any)._nspDraftRequirements = (req.body as any)._nspDraftRequirements;
  }
  if ((req.body as any)?.depth != null) {
    (effectiveParameters as any).depth = (req.body as any).depth;
  }

  const {
    resolveIntelligenceDepth,
    depthSystemHint,
    depthDeniedForTier,
    DEPTH_WORD_LIMITS,
  } = await import('../config/jrx-intelligence-depth.js');
  const resolvedDepth = resolveIntelligenceDepth(req.body, 'detailed');
  const denied = depthDeniedForTier(resolvedDepth, (ctx as any).subscriptionTier ?? (ctx as any).tier);
  if (denied) {
    res.status(403).json({ success: false, error: denied, code: 'DEPTH_TIER_DENIED' });
    return;
  }

  const effectiveJurisdiction =
    (isIndiaOnlyPartner(req) ? 'IN' : null)
    || (effectiveParameters as any)?._jurisdiction
    || jurisdiction
    || ctx.jurisdiction
    || 'IN';
  const requestId = ctx.requestId || crypto.randomUUID();
  const depthHint = depthSystemHint(resolvedDepth, typeof documentType === 'string' ? documentType : undefined);
  const bodyMax = Number((req.body as any)?.maxTokens || (effectiveParameters as any)?.maxTokens || 0);
  const maxOut = Math.min(
    8192,
    Math.max(512, bodyMax > 0 ? bodyMax : DEPTH_WORD_LIMITS[resolvedDepth] * 6),
  );
  const partnerBest = wantsNspNymBestOutcome(req);
  const quality = resolveNspNymBestOutcomeQuality(req, {
    userId: `sdk_app_${ctx.applicationId}`,
    enableRAG: true,
    enableCitationVerification: true,
    enableHallucinationCheck: true,
    enableExplainability: true,
    enableMemory: true,
    enableCoT: true,
  });
  const instr =
    typeof instruction === 'string'
      ? instruction
      : typeof (effectiveParameters as any)?.instruction === 'string'
        ? String((effectiveParameters as any).instruction)
        : typeof req.body?.prompt === 'string'
          ? String(req.body.prompt)
          : undefined;

  try {
    /* NV-FIRM-CLAUSE-DRAFT-001 — resolved before the prompt is built, and only
     * from the org this request is already RLS-bound to. `req.withTenant` is
     * handed over as the read handle so the lookup runs inside the tenant
     * transaction; the resolver never touches the global pool. */
    const firmClauseOverlay = await resolveFirmClauseOverlay({
      orgId: req.orgId,
      withTenant: req.withTenant,
      family: inferDraftDocFamily(
        effectiveTemplate,
        typeof documentType === 'string' ? documentType : undefined,
        instr,
      ),
      documentType: typeof documentType === 'string' ? documentType : undefined,
      template: effectiveTemplate,
      practiceArea: typeof (effectiveParameters as any)?.practiceArea === 'string'
        ? String((effectiveParameters as any).practiceArea)
        : undefined,
      jurisdiction: effectiveJurisdiction,
      requestClauses:
        (effectiveParameters as any)?._firmClauseLibrary
        ?? (effectiveParameters as any)?.firmClauseLibrary,
    });

    const llmRequest = buildLLMRequest({
      id: requestId,
      userId: `sdk_app_${ctx.applicationId}`,
      prompt: buildLegalDraftUserPrompt({
        template: effectiveTemplate,
        jurisdiction: effectiveJurisdiction,
        parameters: effectiveParameters as Record<string, unknown>,
        documentType: typeof documentType === 'string' ? documentType : undefined,
        instruction: instr,
      }),
      systemPrompt: buildLegalDraftSystemPrompt({
        jurisdiction: effectiveJurisdiction,
        template: effectiveTemplate,
        documentType: typeof documentType === 'string' ? documentType : undefined,
        instruction: instr,
        parameters: effectiveParameters as Record<string, unknown>,
        depthHint,
        partnerBestOutcome: partnerBest,
        firmClauseOverlay,
      }),
      model: ctx.llmConfig?.model || 'auto',
      provider: ctx.llmConfig?.provider || SDK_CONFIG.defaults.provider,
      maxTokens: Math.min(SDK_CONFIG.defaults.maxTokensPerRequest, maxOut),
      // Slightly lower temperature for precise legal instruments
      temperature: partnerBest ? 0.35 : 0.45,
      requirements: {
        complexity: partnerBest ? 'complex' : 'medium',
        domain: 'analytical',
        priority: partnerBest ? 'high' : 'medium',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional',
      },
    });

    const llmResponse = await executeWithOrchestration(llmRequest, {
      sdkContext: ctx,
      jurisdiction: effectiveJurisdiction,
      // Prefer drafting specialist registry persona when available
      agentId: partnerBest ? 'drafting-specialist' : undefined,
      taskType: 'document-drafting',
      domainContext: `${effectiveTemplate} document drafting under ${effectiveJurisdiction} jurisdiction`,
      enableHallucinationCheck: quality.enableHallucinationCheck,
      enableCitationVerification: quality.enableCitationVerification,
      enableRAG: quality.enableRAG,
      enableMemory: quality.enableMemory,
    });

    const formatted = applyLegalResponseFormatting(llmResponse.content || '', {
      jurisdiction: effectiveJurisdiction,
      taskType: 'document-drafting',
      query: String(req.body?.instruction || req.body?.prompt || ''),
      includeDisclaimer: true,
    });

    res.json({
      success: true,
      data: {
        draftId: `doc_draft_${requestId}`,
        requestId,
        template: effectiveTemplate,
        jurisdiction: effectiveJurisdiction,
        content: formatted,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        latencyMs: Date.now() - startTime,
        orchestration: {
          ...llmResponse.orchestration,
          bestOutcome: partnerBest,
          qualityGates: {
            rag: quality.enableRAG,
            citations: quality.enableCitationVerification,
            hallucination: quality.enableHallucinationCheck,
          },
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `Document drafting failed: ${error?.message || 'Unknown error'}`,
    });
  }
});

router.post('/research/query', gatewayResearchCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'research:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: research:read' });
    return;
  }

  const { query, jurisdiction, sources } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }

  const effectiveJurisdiction = jurisdiction || ctx.jurisdiction;
  const effectiveSources = sources || ['statutes', 'case_law', 'regulations'];
  const requestId = ctx.requestId || crypto.randomUUID();
  const partnerBest = wantsNspNymBestOutcome(req);

  try {
    // NV-NSP-AI-SEARCH-001: retrieve ranked corpus hits first so partners
    // that expect rankedResults (NSP ai-search) get real results, then
    // ground the research narrative on those chunks.
    let rankedResults: Array<{
      id: string;
      title: string;
      content: string;
      score: number;
      source: string;
      jurisdiction?: string;
      citationRef?: string;
    }> = [];
    try {
      const { autoRagRetrieve } = await import('../services/jrx-auto-rag-router.js');
      const rag = await autoRagRetrieve({
        query,
        jurisdiction: effectiveJurisdiction || 'IN',
        tenantId: ctx.customerOrgId != null ? String(ctx.customerOrgId) : undefined,
        topK: 8,
        tier: (ctx.tier as any) || 'enterprise',
        taskType: 'legal-research',
      });
      rankedResults = (rag.chunks || []).map((c: any, i: number) => ({
        id: c.id || `hit-${i}`,
        title: c.title || c.citationRef || c.source || `Result ${i + 1}`,
        content: c.content || '',
        score: typeof c.score === 'number' ? c.score : Math.max(0, 1 - i * 0.05),
        source: c.source || c.layer || 'rag',
        jurisdiction: c.jurisdiction || effectiveJurisdiction,
        citationRef: c.citationRef || c.title,
      }));
    } catch (ragErr: any) {
      logger.warn('[SDK-Gateway] research RAG retrieve failed (non-fatal)', {
        err: ragErr?.message,
      });
    }

    const groundedContext = rankedResults.length
      ? rankedResults.slice(0, 6).map((r, i) =>
          `[${i + 1}] ${r.title}\n${String(r.content).slice(0, 600)}`).join('\n\n')
      : '';

    const { buildUniversalLegalIntelligenceOverlay, mergeLegalIntelligencePrompt } =
      await import('../services/jrx-legal-intelligence-overlay.js');
    const researchOverlay = buildUniversalLegalIntelligenceOverlay({
      prompt: String(query),
      jurisdiction: effectiveJurisdiction,
      taskKind: 'research',
      partnerBestOutcome: partnerBest,
    });
    const researchSystemPrompt = mergeLegalIntelligencePrompt(
      `You are Jurexio Legal Research Intelligence specialized in ${effectiveJurisdiction} law. Produce accurate, citation-grounded research. Prefer retrieved excerpts. Write as counsel — precise, humanized, never invent authorities.`,
      researchOverlay,
    );

    const llmRequest = buildLLMRequest({
      id: requestId,
      userId: `sdk_app_${ctx.applicationId}`,
      prompt: `Legal research query: "${query}"\nJurisdiction: ${effectiveJurisdiction}\nSources to search: ${effectiveSources.join(', ')}\n\n${groundedContext ? `Retrieved authority excerpts:\n${groundedContext}\n\n` : ''}Provide a counsel-grade legal research brief including relevant statutes, case law citations, and regulatory frameworks. Prefer the retrieved excerpts. Structure: Issue → Short answer → Analysis → Authorities → Practical next steps. Humanized advocate voice — not chatbot filler.`,
      systemPrompt: researchSystemPrompt,
      model: ctx.llmConfig?.model || 'auto',
      provider: ctx.llmConfig?.provider || SDK_CONFIG.defaults.provider,
      maxTokens: Math.min(Number(SDK_CONFIG.defaults.maxTokensPerRequest) || 4096, partnerBest ? 4096 : 2048),
      temperature: 0.3,
    });

    // NV-NSP-AI-SEARCH-FAST-001: hard-cap LLM wait so partners always get
    // rankedResults quickly. If LLM is slow/offline, synthesize research from RAG.
    const researchLlmBudgetMs = Math.max(
      8_000,
      Math.min(Number(process.env.JRX_RESEARCH_LLM_BUDGET_MS) || 22_000, 45_000),
    );
    const ragFallbackResearch = rankedResults.length
      ? `Legal research results for "${query}" (${effectiveJurisdiction}).\n\n` +
        rankedResults.slice(0, 6).map((r, i) =>
          `${i + 1}. ${r.title}${r.citationRef ? ` — ${r.citationRef}` : ''}\n` +
          `${String(r.content || '').slice(0, 400)}`).join('\n\n') +
        `\n\n(Narrative synthesized from retrieved authorities while the LLM path timed out or degraded.)`
      : `No corpus hits were retrieved for "${query}" under ${effectiveJurisdiction}. Refine the query or retry shortly.`;

    let llmResponse: Awaited<ReturnType<typeof executeWithOrchestration>>;
    let researchDegraded = false;
    try {
      llmResponse = await Promise.race([
        executeWithOrchestration(llmRequest, {
          sdkContext: ctx,
          jurisdiction: effectiveJurisdiction,
          taskType: 'legal-research',
          domainContext: `Legal research query under ${effectiveJurisdiction} jurisdiction, sources: ${effectiveSources.join(', ')}`,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`research_llm_budget_${researchLlmBudgetMs}ms`)), researchLlmBudgetMs);
        }),
      ]);
      if (!llmResponse?.content?.trim()) {
        researchDegraded = true;
        llmResponse = {
          ...llmResponse,
          content: ragFallbackResearch,
          model: llmResponse?.model || 'rag-fallback',
          provider: llmResponse?.provider || 'rag',
        } as typeof llmResponse;
      }
    } catch (llmErr: any) {
      researchDegraded = true;
      logger.warn('[SDK-Gateway] research LLM budget exceeded — returning RAG rankedResults', {
        err: llmErr?.message,
        budgetMs: researchLlmBudgetMs,
        ranked: rankedResults.length,
      });
      llmResponse = {
        content: ragFallbackResearch,
        model: 'rag-fallback',
        provider: 'rag',
        tokens: { prompt: 0, completion: 0, total: 0 },
        cost: 0,
        orchestration: { degraded: true, reason: llmErr?.message || 'research_llm_budget' },
      } as unknown as typeof llmResponse;
    }

    // If RAG returned nothing, still surface a single ranked narrative hit so
    // NSP ai-search does not treat the response as empty rankedResults.
    if (rankedResults.length === 0 && llmResponse.content?.trim()) {
      rankedResults = [{
        id: `research-synth-${requestId}`,
        title: `Research synthesis: ${String(query).slice(0, 80)}`,
        content: llmResponse.content,
        score: 0.55,
        source: 'llm_research',
        jurisdiction: effectiveJurisdiction,
        citationRef: undefined,
      }];
    }

    res.json({
      success: true,
      data: {
        researchId: `research_${requestId}`,
        requestId,
        query,
        jurisdiction: effectiveJurisdiction,
        sources: effectiveSources,
        research: llmResponse.content,
        rankedResults,
        results: rankedResults,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        latencyMs: Date.now() - startTime,
        orchestration: llmResponse.orchestration,
        degraded: researchDegraded || undefined,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `Legal research failed: ${error?.message || 'Unknown error'}`,
    });
  }
});

router.post('/research/precedent', gatewayResearchCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'research:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: research:read' });
    return;
  }

  const { caseDescription, jurisdiction } = req.body;

  if (!caseDescription || typeof caseDescription !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: caseDescription' });
    return;
  }

  const effectiveJurisdiction = jurisdiction || ctx.jurisdiction;
  const requestId = ctx.requestId || crypto.randomUUID();

  try {
    const llmRequest = buildLLMRequest({
      id: requestId,
      userId: `sdk_app_${ctx.applicationId}`,
      prompt: `Find relevant legal precedents for the following case:\n\n"${caseDescription}"\n\nJurisdiction: ${effectiveJurisdiction}\n\nProvide precedent cases with citations, court names, years, outcomes, and key legal principles established.`,
      systemPrompt: `You are a legal precedent research AI specialized in ${effectiveJurisdiction} case law. Find and analyze relevant precedent cases with accurate citations, including Supreme Court, High Court, and tribunal decisions.`,
      model: ctx.llmConfig?.model || 'auto',
      provider: ctx.llmConfig?.provider || SDK_CONFIG.defaults.provider,
      maxTokens: SDK_CONFIG.defaults.maxTokensPerRequest,
      temperature: 0.3,
    });

    const llmResponse = await executeWithOrchestration(llmRequest, {
      sdkContext: ctx,
      jurisdiction: effectiveJurisdiction,
      taskType: 'precedent-search',
      domainContext: `Legal precedent search under ${effectiveJurisdiction} jurisdiction`,
    });

    res.json({
      success: true,
      data: {
        precedentSearchId: `precedent_${requestId}`,
        requestId,
        caseDescription: caseDescription.substring(0, 200),
        jurisdiction: effectiveJurisdiction,
        precedents: llmResponse.content,
        model: llmResponse.model,
        provider: llmResponse.provider,
        tokens: llmResponse.tokens,
        cost: llmResponse.cost,
        latencyMs: Date.now() - startTime,
        orchestration: llmResponse.orchestration,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `Precedent search failed: ${error?.message || 'Unknown error'}`,
    });
  }
});

/**
 * POST /api/jrx/gateway/citations/verify — SDK-key citation verification
 * (parity with JWT POST /api/jrx/citations/verify).
 */
router.post('/citations/verify', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { outputText, text, content, jurisdiction } = req.body;
  const effectiveOutput =
    typeof outputText === 'string' ? outputText
      : typeof text === 'string' ? text
        : typeof content === 'string' ? content
          : null;
  if (!effectiveOutput) {
    res.status(400).json({ success: false, error: 'outputText is required' });
    return;
  }

  const requestId = ctx.requestId || crypto.randomUUID();
  const effectiveJurisdiction = jurisdiction || ctx.jurisdiction || 'IN';

  try {
    const result = await nvCitationVerifier.verifyCitations({
      requestId,
      outputText: effectiveOutput,
      jurisdiction: effectiveJurisdiction,
      tenantId: String(ctx.organizationId),
    });
    res.json({
      success: true,
      data: result,
      requestId,
      jurisdiction: effectiveJurisdiction,
    });
  } catch (error: any) {
    logger.error({ route: 'gateway/citations/verify', error: error?.message });
    res.status(500).json({
      success: false,
      error: `Citation verification failed: ${error?.message || 'Unknown error'}`,
    });
  }
});

/**
 * POST /api/jrx/gateway/hallucination/check — SDK-key hallucination detection
 * (parity with JWT POST /api/jrx/hallucination/check).
 */
router.post('/hallucination/check', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { inputText, outputText, text, content, agentKey, requestId: bodyRequestId } = req.body;
  const effectiveOutput =
    typeof outputText === 'string' ? outputText
      : typeof text === 'string' ? text
        : typeof content === 'string' ? content
          : null;
  if (!effectiveOutput) {
    res.status(400).json({ success: false, error: 'outputText is required' });
    return;
  }

  const requestId = bodyRequestId || ctx.requestId || crypto.randomUUID();

  try {
    const result = await nvHallucinationDetector.checkOutput({
      requestId,
      inputText: inputText || '',
      outputText: effectiveOutput,
      agentKey: agentKey || 'sdk-gateway',
      userId: `sdk_app_${ctx.applicationId}`,
      tenantId: String(ctx.organizationId),
    });
    res.json({ success: true, data: result, requestId });
  } catch (error: any) {
    logger.error({ route: 'gateway/hallucination/check', error: error?.message });
    res.status(500).json({
      success: false,
      error: `Hallucination check failed: ${error?.message || 'Unknown error'}`,
    });
  }
});

router.get('/usage', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const result = await sdkApplicationService.getAppUsageAnalytics(
    ctx.applicationId,
    ctx.organizationId,
    { start: thirtyDaysAgo, end: now }
  );

  if (!result.success) {
    res.status(500).json({ success: false, error: result.error });
    return;
  }

  res.json({
    success: true,
    data: {
      applicationId: ctx.applicationId,
      appName: ctx.appName,
      ...result.data,
    },
  });
});

router.get('/usage/tokens', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [dailyResult, monthlyResult] = await Promise.all([
    sdkApplicationService.getAppUsageAnalytics(
      ctx.applicationId,
      ctx.organizationId,
      { start: todayStart, end: now }
    ),
    sdkApplicationService.getAppUsageAnalytics(
      ctx.applicationId,
      ctx.organizationId,
      { start: monthStart, end: now }
    ),
  ]);

  res.json({
    success: true,
    data: {
      applicationId: ctx.applicationId,
      appName: ctx.appName,
      daily: {
        tokensUsed: dailyResult.data?.totalTokensUsed ?? 0,
        budget: ctx.dailyTokenBudget,
        remaining: Math.max(0, ctx.dailyTokenBudget - (dailyResult.data?.totalTokensUsed ?? 0)),
        requestCount: dailyResult.data?.requestCount ?? 0,
        estimatedCost: dailyResult.data?.totalEstimatedCost ?? '0',
      },
      monthly: {
        tokensUsed: monthlyResult.data?.totalTokensUsed ?? 0,
        requestCount: monthlyResult.data?.requestCount ?? 0,
        estimatedCost: monthlyResult.data?.totalEstimatedCost ?? '0',
      },
      rateLimitPerMinute: ctx.rateLimitPerMinute,
      timestamp: new Date().toISOString(),
    },
  });
});

router.post('/translate', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { text, sourceLanguage, targetLanguage, domain } = req.body;

  if (!text || typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: text' });
    return;
  }
  if (!targetLanguage || typeof targetLanguage !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: targetLanguage' });
    return;
  }

  try {
    const result = await sarvamAIService.translate({
      text,
      sourceLanguage: sourceLanguage || 'en',
      targetLanguage,
      domain: domain || 'general',
      cacheEnabled: true,
    });

    res.json({
      success: true,
      data: {
        ...result,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Translation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/translate/batch', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { texts, sourceLanguage, targetLanguage, domain } = req.body;

  if (!Array.isArray(texts) || texts.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required field: texts (array)' });
    return;
  }
  if (!targetLanguage) {
    res.status(400).json({ success: false, error: 'Missing required field: targetLanguage' });
    return;
  }

  try {
    const results = await sarvamAIService.batchTranslate({
      texts,
      sourceLanguage: sourceLanguage || 'en',
      targetLanguage,
      domain,
    });

    res.json({
      success: true,
      data: {
        translations: results,
        count: results.length,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Batch translation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/translate/transliterate', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { input, sourceLanguageCode, targetLanguageCode } = req.body;

  if (!input || !sourceLanguageCode || !targetLanguageCode) {
    res.status(400).json({ success: false, error: 'Missing required fields: input, sourceLanguageCode, targetLanguageCode' });
    return;
  }

  try {
    const result = await sarvamAIService.transliterate({
      input,
      source_language_code: sourceLanguageCode,
      target_language_code: targetLanguageCode,
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Transliteration failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/translate/detect-language', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { input } = req.body;
  if (!input) {
    res.status(400).json({ success: false, error: 'Missing required field: input' });
    return;
  }

  try {
    const result = await sarvamAIService.detectLanguage({ input });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Language detection failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/translate/languages', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      languages: sarvamAIService.getSupportedLanguages(),
      total: sarvamAIService.getSupportedLanguages().length,
      provider: 'gemini (default) · sarvam when JRX_LANGUAGE_PROVIDER=sarvam',
    },
  });
});

router.get('/translate/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: sarvamAIService.getStats() });
});

router.post('/ocr/process', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { imageData, imageUrl, fileName, options } = req.body;

  if (!imageData && !imageUrl) {
    res.status(400).json({ success: false, error: 'Missing required field: imageData (base64) or imageUrl' });
    return;
  }

  try {
    const inputType = imageUrl ? 'url' : 'base64';
    const inputData = imageUrl || imageData;

    const result = await realOCRPipelineService.processDocument(
      { type: inputType, data: inputData, fileName: fileName || 'document.png' },
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      options || {}
    );

    res.json({
      success: true,
      data: {
        ...result,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `OCR processing failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/ocr/jobs', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { imageData, imageUrl, fileName, options } = req.body;

  if (!imageData && !imageUrl) {
    res.status(400).json({ success: false, error: 'Missing required field: imageData or imageUrl' });
    return;
  }

  try {
    const inputType = imageUrl ? 'url' : 'base64';
    const inputData = imageUrl || imageData;

    const job = await realOCRPipelineService.createJob(
      { type: inputType, data: inputData, fileName },
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      options || {},
      `sdk_app_${ctx.applicationId}`
    );

    res.json({
      success: true,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      data: { jobId: job.id, status: job.status, createdAt: job.createdAt },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `OCR job creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/ocr/jobs/:jobId', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const job = realOCRPipelineService.getJob(String(req.params.jobId));
  if (!job) {
    res.status(404).json({ success: false, error: 'OCR job not found' });
    return;
  }

  res.json({ success: true, data: job });
});

router.get('/ocr/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: realOCRPipelineService.getStats() });
});

router.post('/documents/summarize', gatewayDocCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { content, text, detailLevel, focusAreas, maxWords, depth, documentType, jurisdiction } = req.body;
  const effectiveContent = typeof content === 'string' ? content : (typeof text === 'string' ? text : null);

  if (!effectiveContent) {
    res.status(400).json({ success: false, error: 'Missing required field: content' });
    return;
  }

  try {
    const {
      resolveIntelligenceDepth,
      depthToLegacyDetailLevel,
      DEPTH_WORD_LIMITS,
      depthDeniedForTier,
      depthSystemHint,
    } = await import('../config/jrx-intelligence-depth.js');
    const resolvedDepth = resolveIntelligenceDepth(req.body, 'detailed');
    const denied = depthDeniedForTier(resolvedDepth, (ctx as any).subscriptionTier ?? (ctx as any).tier);
    if (denied) {
      res.status(403).json({ success: false, error: denied, code: 'DEPTH_TIER_DENIED' });
      return;
    }
    const legacyLevel = detailLevel || depthToLegacyDetailLevel(resolvedDepth);
    const wordCap = maxWords || DEPTH_WORD_LIMITS[resolvedDepth];
    const effectiveJurisdiction =
      (isIndiaOnlyPartner(req) ? 'IN' : null) || jurisdiction || ctx.jurisdiction || 'IN';
    const partnerBest = wantsNspNymBestOutcome(req);

    // NSP/NYM best-outcome: summarize via full safety ring with India-aware prompts
    // (DocIntel path remains for other partners / lean extracts).
    if (partnerBest) {
      const requestId = ctx.requestId || crypto.randomUUID();
      const quality = resolveNspNymBestOutcomeQuality(req, {
        userId: `sdk_app_${ctx.applicationId}`,
        enableRAG: true,
        enableCitationVerification: true,
        enableHallucinationCheck: true,
        enableMemory: true,
        enableCoT: true,
      });
      const depthHint = depthSystemHint(resolvedDepth, typeof documentType === 'string' ? documentType : undefined);
      const llmRequest = buildLLMRequest({
        id: requestId,
        userId: `sdk_app_${ctx.applicationId}`,
        prompt: [
          `Summarize the following legal document in approximately ${wordCap} words (${legacyLevel}).`,
          focusAreas?.length ? `Focus areas: ${focusAreas.join(', ')}.` : '',
          depthHint,
          `Also list key points as Markdown bullets.`,
          '',
          'Document:',
          String(effectiveContent).slice(0, 14000),
        ]
          .filter(Boolean)
          .join('\n'),
        systemPrompt: buildLegalSummarizeSystemPrompt(effectiveJurisdiction),
        model: ctx.llmConfig?.model || 'auto',
        provider: ctx.llmConfig?.provider || SDK_CONFIG.defaults.provider,
        maxTokens: Math.min(SDK_CONFIG.defaults.maxTokensPerRequest, Math.max(1024, wordCap * 4)),
        temperature: 0.25,
      });
      const llmResponse = await executeWithOrchestration(llmRequest, {
        sdkContext: ctx,
        jurisdiction: effectiveJurisdiction,
        agentId: 'document-analyzer',
        taskType: 'document-summary',
        domainContext: `legal summarization ${effectiveJurisdiction}`,
        enableHallucinationCheck: quality.enableHallucinationCheck,
        enableCitationVerification: quality.enableCitationVerification,
        enableRAG: quality.enableRAG,
        enableMemory: quality.enableMemory,
      });
      const summary = applyLegalResponseFormatting(llmResponse.content || '', {
        jurisdiction: effectiveJurisdiction,
        taskType: 'document-summary',
        includeDisclaimer: true,
      });
      const keyPoints = summary
        .split('\n')
        .map((l) => l.replace(/^[-*•]\s+/, '').trim())
        .filter((l) => l.length > 20)
        .slice(0, 12);
      res.json({
        success: true,
        data: {
          summary,
          keyPoints,
          detailLevel: legacyLevel,
          wordCount: summary.split(/\s+/).filter(Boolean).length,
          depth: resolvedDepth,
          documentType: documentType || undefined,
          depthHint,
          jurisdiction: effectiveJurisdiction,
          bestOutcome: true,
          model: llmResponse.model,
          provider: llmResponse.provider,
          latencyMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        },
      });
      return;
    }

    const result = await openaiDocumentIntelligenceService.summarizeDocument(effectiveContent, {
      detailLevel: legacyLevel,
      focusAreas: focusAreas || [],
      maxWords: wordCap,
      jurisdiction: effectiveJurisdiction,
    });

    res.json({
      success: true,
      data: {
        ...result,
        depth: resolvedDepth,
        documentType: documentType || undefined,
        depthHint: depthSystemHint(resolvedDepth, typeof documentType === 'string' ? documentType : undefined),
        jurisdiction: effectiveJurisdiction,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Summarization failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/documents/extract-entities', gatewayDocCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: content' });
    return;
  }

  try {
    const result = await openaiDocumentIntelligenceService.extractEntities(content);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Entity extraction failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/documents/compare', gatewayDocCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { document1, document2 } = req.body;

  if (!document1 || !document2) {
    res.status(400).json({ success: false, error: 'Missing required fields: document1, document2' });
    return;
  }

  try {
    const result = await openaiDocumentIntelligenceService.compareContracts(document1, document2);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Contract comparison failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/documents/classify-clauses', gatewayDocCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { content } = req.body;

  if (!content || typeof content !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: content' });
    return;
  }

  try {
    const result = await openaiDocumentIntelligenceService.classifyClauses(content);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Clause classification failed: ${error?.message || 'Unknown error'}` });
  }
});

/**
 * POST /prompt/improve — NV-PROMPT-IMPROVE-FAST-001
 * Lightweight prompt improvement for NSP/NYM (no Queen, no LLM, CoT off).
 * Aliases: /api/jrx/gateway/prompt/improve, /api/jrx/v1/sdk/prompt/improve
 */
const gatewayPromptImproveCap = nvAiCreditCap({
  agentKey: 'gateway:prompt/improve',
  completionAllowance: 512,
});

router.post('/prompt/improve', gatewayPromptImproveCap, async (req: Request, res: Response): Promise<void> => {
  const { prompt, taskType, jurisdiction, context } = req.body ?? {};

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    res.status(400).json({ success: false, error: 'Missing required field: prompt (string)' });
    return;
  }

  try {
    const { improvePromptFast } = await import('../services/jrx-prompt-improve-fast.js');
    const result = await improvePromptFast({
      prompt: prompt.trim(),
      taskType: typeof taskType === 'string' ? taskType : undefined,
      jurisdiction: typeof jurisdiction === 'string' ? jurisdiction : undefined,
      context: context && typeof context === 'object' ? context : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error?.message || 'Prompt improve failed',
    });
  }
});

router.post('/documents/embeddings', gatewayEmbeddingsCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const texts = normalizeGatewayEmbeddingsTexts(req.body);

  if (!texts) {
    res.status(400).json({
      success: false,
      error: 'Missing required field: texts (array of strings), or documents ([{ id, content }]), or content (string|string[])',
    });
    return;
  }

  try {
    const result = await openaiDocumentIntelligenceService.generateEmbeddings(texts);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Embedding generation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/documents/qa', gatewayDocCap, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { document, question } = req.body;

  if (!document || !question) {
    res.status(400).json({ success: false, error: 'Missing required fields: document, question' });
    return;
  }

  try {
    const result = await openaiDocumentIntelligenceService.answerQuestion(document, question);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Document Q&A failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/orders', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { amount, currency, receipt, notes } = req.body;

  if (!amount || typeof amount !== 'number') {
    res.status(400).json({ success: false, error: 'Missing required field: amount (number in smallest unit)' });
    return;
  }

  try {
    const order = await razorpayPaymentService.createOrder(amount, currency || 'INR', receipt, notes);
    res.json({ success: true, data: order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Order creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/payments/orders/:orderId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:read' });
    return;
  }

  try {
    const order = await razorpayPaymentService.getOrder(String(req.params.orderId));
    res.json({ success: true, data: order });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Order fetch failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/capture', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { paymentId, amount, currency } = req.body;

  if (!paymentId || !amount) {
    res.status(400).json({ success: false, error: 'Missing required fields: paymentId, amount' });
    return;
  }

  try {
    const payment = await razorpayPaymentService.capturePayment(paymentId, amount, currency || 'INR');
    res.json({ success: true, data: payment });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Payment capture failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/refund', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { paymentId, amount, notes } = req.body;

  if (!paymentId) {
    res.status(400).json({ success: false, error: 'Missing required field: paymentId' });
    return;
  }

  try {
    const refund = await razorpayPaymentService.refundPayment(paymentId, amount, notes);
    res.json({ success: true, data: refund });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Refund failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/subscriptions/plans', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { name, period, interval, amount, currency, description } = req.body;

  if (!name || !period || !interval || !amount) {
    res.status(400).json({ success: false, error: 'Missing required fields: name, period, interval, amount' });
    return;
  }

  try {
    const plan = await razorpayPaymentService.createPlan(name, period, interval, amount, currency || 'INR', description);
    res.json({ success: true, data: plan });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Plan creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/subscriptions', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { planId, customerId, totalCount, notes } = req.body;

  if (!planId || !totalCount) {
    res.status(400).json({ success: false, error: 'Missing required fields: planId, totalCount' });
    return;
  }

  try {
    const subscription = await razorpayPaymentService.createSubscription(planId, customerId, totalCount, notes);
    res.json({ success: true, data: subscription });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Subscription creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/payments/subscriptions/:subscriptionId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:read' });
    return;
  }

  try {
    const subscription = await razorpayPaymentService.getSubscription(String(req.params.subscriptionId));
    res.json({ success: true, data: subscription });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Subscription fetch failed: ${error?.message || 'Unknown error'}` });
  }
});

router.delete('/payments/subscriptions/:subscriptionId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const cancelAtEnd = req.query.cancelAtEnd === 'true';

  try {
    const result = await razorpayPaymentService.cancelSubscription(String(req.params.subscriptionId), cancelAtEnd);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Subscription cancellation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/customers', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { name, email, contact, notes } = req.body;

  if (!name || !email) {
    res.status(400).json({ success: false, error: 'Missing required fields: name, email' });
    return;
  }

  try {
    const customer = await razorpayPaymentService.createCustomer(name, email, contact, notes);
    res.json({ success: true, data: customer });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Customer creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/invoices', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  try {
    const invoice = await razorpayPaymentService.createInvoice(req.body);
    res.json({ success: true, data: invoice });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Invoice creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/payments/payment-links', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'billing:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: billing:write' });
    return;
  }

  const { amount, currency, description, customer, callbackUrl } = req.body;

  if (!amount || !description) {
    res.status(400).json({ success: false, error: 'Missing required fields: amount, description' });
    return;
  }

  try {
    const link = await razorpayPaymentService.createPaymentLink(amount, currency || 'INR', description, customer, callbackUrl);
    res.json({ success: true, data: link });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Payment link creation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/payments/tiers', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: razorpayPaymentService.getPlatformTiers(),
  });
});

router.get('/payments/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: razorpayPaymentService.getStatistics() });
});

router.post('/payments/webhooks/verify', (req: Request, res: Response): void => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';

  if (!signature) {
    res.status(400).json({ success: false, error: 'Missing X-Razorpay-Signature header' });
    return;
  }

  const isValid = razorpayPaymentService.verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    webhookSecret
  );

  res.json({ success: true, data: { verified: isValid } });
});

router.post('/optimization/grpo/evaluate', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { prompt, responses } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }
  if (!Array.isArray(responses) || responses.length < 2) {
    res.status(400).json({ success: false, error: 'Missing required field: responses (array of at least 2)' });
    return;
  }

  try {
    const result = await grpoOptimizationService.evaluateGroup(prompt, responses);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `GRPO evaluation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/optimization/grpo/generate-evaluate', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { prompt, context } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }

  try {
    const result = await grpoOptimizationService.generateAndEvaluate(prompt, context);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `GRPO generation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/optimization/grpo/preferences', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { prompt, chosen, rejected } = req.body;

  if (!prompt || !chosen || !rejected) {
    res.status(400).json({ success: false, error: 'Missing required fields: prompt, chosen, rejected' });
    return;
  }

  try {
    const result = await grpoOptimizationService.addPreferencePair(prompt, chosen, rejected);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Preference pair failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/optimization/grpo/optimize', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  try {
    const result = await grpoOptimizationService.optimizePolicy();
    res.json({ success: true, data: result || { message: 'Not enough data for policy update' } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Policy optimization failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/optimization/grpo/policy', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }
  res.json({ success: true, data: grpoOptimizationService.getCurrentPolicy() });
});

router.get('/optimization/grpo/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: grpoOptimizationService.getStats() });
});

router.get('/optimization/grpo/dimensions', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }
  res.json({ success: true, data: { dimensions: grpoOptimizationService.getRewardDimensions() } });
});

router.post('/cache/lookup', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  /* NV-CACHE-NS-FORGERY-001 (2026-08-16) — the cache namespace is DERIVED from
   * the authenticated application and never accepted from the caller.
   *
   * Every /cache/* endpoint below is gated only on `documents:read`, yet each one
   * used to take its namespace from the request body with `app_${applicationId}`
   * as a mere default. That made five distinct cross-tenant operations reachable
   * by any SDK key: read (lookup), poison (store/warm), wipe (invalidate) and a
   * completely unscoped global flush.
   *
   * Poisoning is the most serious: it injects attacker-chosen text into another
   * firm's cache, which the platform then serves as its own legal answer.
   * Wiping is a cost-amplification attack — every evicted entry becomes a fresh
   * frontier-model call.
   *
   * A caller-supplied namespace has no legitimate use on these routes: the SDK
   * context already identifies the tenant, so any value the client sends is
   * either redundant or an attempt to cross a boundary. */
  const { prompt } = req.body;
  const namespace = `app_${ctx.applicationId}`;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }

  try {
    const result = await lmCacheService.get(prompt, namespace);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Cache lookup failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/cache/store', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { prompt, response, metadata } = req.body;

  if (!prompt || !response) {
    res.status(400).json({ success: false, error: 'Missing required fields: prompt, response' });
    return;
  }

  try {
    // NV-CACHE-NS-FORGERY-001 — `namespace` is overwritten AFTER the metadata
    // spread, so a caller cannot smuggle another tenant's namespace through
    // `metadata`. Order matters here: spreading after would restore the hole.
    const entry = await lmCacheService.set(prompt, response, {
      ...metadata,
      namespace: `app_${ctx.applicationId}`,
    });
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Cache store failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/cache/invalidate', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  // NV-CACHE-NS-FORGERY-001 — scoped to the caller's own application. Accepting
  // a namespace here allowed any SDK key to evict another tenant's entire cache,
  // which is a cost-amplification attack: every evicted entry becomes a fresh
  // frontier-model call on that tenant's next request.
  const { prompt } = req.body;
  const namespace = `app_${ctx.applicationId}`;

  try {
    if (!prompt) {
      const count = await lmCacheService.invalidateNamespace(namespace);
      res.json({ success: true, data: { invalidated: count, namespace } });
    } else {
      const result = await lmCacheService.invalidate(prompt, namespace);
      res.json({ success: true, data: { invalidated: result } });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Cache invalidation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/cache/warm', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  const { entries } = req.body;

  if (!Array.isArray(entries) || entries.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required field: entries (array)' });
    return;
  }

  /* NV-CACHE-NS-FORGERY-001 — every warmed entry is re-stamped with the caller's
   * own namespace. `warmCache` reads `entry.metadata?.namespace` per entry, so an
   * unscoped array was a bulk cross-tenant poisoning primitive: one request could
   * seed arbitrary "legal answers" into any number of other tenants' namespaces. */
  const scopedEntries = entries.map((e: { prompt: string; response: string; metadata?: Record<string, unknown> }) => ({
    ...e,
    metadata: { ...(e.metadata ?? {}), namespace: `app_${ctx.applicationId}` },
  }));

  const count = lmCacheService.warmCache(scopedEntries as Parameters<typeof lmCacheService.warmCache>[0]);
  res.json({ success: true, data: { warmed: count } });
});

router.post('/cache/flush', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'documents:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: documents:read' });
    return;
  }

  /* NV-CACHE-NS-FORGERY-001 — `lmCacheService.flush()` clears entire TIERS with
   * no namespace dimension, so it is cross-tenant by construction and cannot be
   * made safe by scoping the argument. On a `documents:read` SDK key it was a
   * one-call platform-wide cache wipe: every tenant's next request would go to a
   * frontier model.
   *
   * Deliberately refused rather than silently narrowed to the caller's own
   * namespace — a caller asking to "flush all" and receiving a partial flush
   * would be misled about what happened. Per-tenant eviction already has a
   * correct home in /cache/invalidate; platform-wide flush belongs to the
   * operator admin surface, which authenticates differently. */
  res.status(403).json({
    success: false,
    error: 'Cache flush is not available to SDK callers: it is not tenant-scoped. '
      + 'Use POST /cache/invalidate to clear your own application namespace.',
  });
});

router.get('/cache/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: lmCacheService.getStats() });
});

// ─── Cache admin invalidation (Task #66) ────────────────────────────────────
// When a statute is amended, a system prompt is corrected, or a template is
// fixed, ops needs a way to flush stale answers right away — waiting for the
// 24h cold-tier TTL is not acceptable for a legal product.
//
// Both endpoints:
//   • require the `cache:admin` scope (granted to internal dashboard JWTs and
//     to API keys whose owner explicitly provisioned the scope),
//   • target the `jrx-agent:tenant:<id>:juris:<JURIS>:agent:<id>` namespace
//     shape used by the Queen orchestrator,
//   • write a hash-chained audit record so we can answer "who cleared what,
//     when?" at compliance review.
//
// CLI parity lives in `scripts/jrx-cache-invalidate.ts` for ops without a
// gateway path.

/**
 * Audit failure policy for the cache admin routes.
 *
 * Compliance review needs a defensible "who cleared what, when" trail for
 * every cache invalidation. In production we fail-closed: if the audit
 * append fails for any reason (DB down, table missing, hash-chain broken),
 * we must not silently report success, because a missing audit record
 * means we can't defend the action later.
 *
 * In dev/test environments the audit table is often absent (the hash-chain
 * writer logs and proceeds), so we degrade to "log + continue" so local
 * ops work isn't blocked. Set `NV_CACHE_ADMIN_REQUIRE_AUDIT=1` to force
 * fail-closed in dev too (recommended for staging that mirrors prod).
 */
export function shouldRequireAuditSuccess(): boolean {
  if (process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT === '1') return true;
  if (process.env.NV_CACHE_ADMIN_REQUIRE_AUDIT === '0') return false;
  return process.env.NODE_ENV === 'production';
}

export class CacheAdminAuditFailedError extends Error {
  constructor(public readonly cause: unknown) {
    super(`audit append failed: ${(cause as any)?.message || cause}`);
    this.name = 'CacheAdminAuditFailedError';
  }
}

async function recordCacheAdminAudit(params: {
  ctx: NonNullable<Request['sdkContext']>;
  action: 'invalidate-agent' | 'invalidate-jurisdiction';
  filter: Record<string, unknown>;
  count: number;
  namespaces: string[];
}): Promise<void> {
  try {
    await appendAuditRecord({
      eventType: `cache_invalidate:${params.action}`,
      payload: JSON.stringify({
        actor: {
          applicationId: params.ctx.applicationId,
          organizationId: params.ctx.organizationId,
          apiKeyId: params.ctx.apiKeyId,
          appName: params.ctx.appName,
          appType: params.ctx.appType,
          requestId: params.ctx.requestId,
        },
        filter: params.filter,
        result: {
          count: params.count,
          namespaces: params.namespaces,
        },
        at: new Date().toISOString(),
      }),
    });
  } catch (err: any) {
    // Hash-chain integrity violations always propagate — never swallow.
    if (err?.name === 'AuditChainBrokenError') throw err;

    if (shouldRequireAuditSuccess()) {
      logger.error(`[CacheAdmin] audit write failed (fail-closed): ${err?.message || err}`);
      throw new CacheAdminAuditFailedError(err);
    }
    // Dev/test fallback: log and continue so local invalidation works
    // even when the audit table is absent.
    logger.warn(`[CacheAdmin] audit write failed (degraded mode): ${err?.message || err}`);
  }
}

router.post('/cache/admin/invalidate-agent', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'cache:admin')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: cache:admin' });
    return;
  }

  const { tenantId, jurisdiction, agentId } = req.body ?? {};

  if (!agentId || typeof agentId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: agentId' });
    return;
  }
  if (jurisdiction !== undefined && typeof jurisdiction !== 'string') {
    res.status(400).json({ success: false, error: 'jurisdiction must be a string when provided' });
    return;
  }
  if (tenantId !== undefined && tenantId !== null && typeof tenantId !== 'string' && typeof tenantId !== 'number') {
    res.status(400).json({ success: false, error: 'tenantId must be a string or number when provided' });
    return;
  }

  try {
    const namespace = buildAgentCacheNamespace({
      tenantId: tenantId == null ? undefined : String(tenantId),
      jurisdiction,
      agentId,
    });
    const count = await lmCacheService.invalidateNamespace(namespace);

    await recordCacheAdminAudit({
      ctx,
      action: 'invalidate-agent',
      filter: { tenantId: tenantId == null ? null : String(tenantId), jurisdiction: jurisdiction ?? null, agentId },
      count,
      namespaces: count > 0 ? [namespace] : [],
    });

    res.json({
      success: true,
      data: {
        action: 'invalidate-agent',
        namespace,
        invalidated: count,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    if (error?.name === 'CacheAdminAuditFailedError') {
      res.status(503).json({ success: false, error: `Cache admin invalidation rejected: audit log unavailable (${error?.message})` });
      return;
    }
    res.status(500).json({ success: false, error: `Cache admin invalidation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/cache/admin/invalidate-jurisdiction', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'cache:admin')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: cache:admin' });
    return;
  }

  const { jurisdiction, tenantId, agentId } = req.body ?? {};

  if (!jurisdiction || typeof jurisdiction !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: jurisdiction' });
    return;
  }
  if (tenantId !== undefined && tenantId !== null && typeof tenantId !== 'string' && typeof tenantId !== 'number') {
    res.status(400).json({ success: false, error: 'tenantId must be a string or number when provided' });
    return;
  }
  if (agentId !== undefined && typeof agentId !== 'string') {
    res.status(400).json({ success: false, error: 'agentId must be a string when provided' });
    return;
  }

  try {
    const filter = {
      tenantId: tenantId == null ? undefined : String(tenantId),
      jurisdiction,
      agentId,
    };
    const predicate = matchAgentCacheNamespace(filter);
    const { count, namespaces } = await lmCacheService.invalidateMatching(predicate);

    await recordCacheAdminAudit({
      ctx,
      action: 'invalidate-jurisdiction',
      filter: {
        jurisdiction,
        tenantId: tenantId == null ? null : String(tenantId),
        agentId: agentId ?? null,
      },
      count,
      namespaces,
    });

    res.json({
      success: true,
      data: {
        action: 'invalidate-jurisdiction',
        filter: {
          jurisdiction: jurisdiction.toUpperCase(),
          tenantId: tenantId == null ? null : String(tenantId),
          agentId: agentId ?? null,
        },
        invalidated: count,
        namespaces,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    if (error?.name === 'CacheAdminAuditFailedError') {
      res.status(503).json({ success: false, error: `Cache admin invalidation rejected: audit log unavailable (${error?.message})` });
      return;
    }
    res.status(500).json({ success: false, error: `Cache admin invalidation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/sampling/analyze', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { prompt, options } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }
  if (!Array.isArray(options) || options.length < 2) {
    res.status(400).json({ success: false, error: 'Missing required field: options (array of at least 2)' });
    return;
  }

  try {
    const result = await verbalizedSamplingService.analyzeSamplingOptions(prompt, options);
    res.json({
      success: true,
      data: { ...result, latencyMs: Date.now() - startTime },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Sampling analysis failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/sampling/verbalize', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { score, domain } = req.body;

  if (typeof score !== 'number' || score < 0 || score > 1) {
    res.status(400).json({ success: false, error: 'Missing required field: score (number 0-1)' });
    return;
  }

  const result = verbalizedSamplingService.verbalizeConfidence(score, domain);
  res.json({ success: true, data: result });
});

router.post('/sampling/chain-of-thought', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { prompt, context, strategy } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: prompt' });
    return;
  }

  try {
    const { chainOfThoughtService } = await import('../services/chain-of-thought-service.js');
    const COT_STRATEGIES = [
      'zero_shot_cot', 'few_shot_cot', 'self_consistency', 'tree_of_thought',
      'step_back', 'decomposition', 'least_to_most', 'chain_of_verification',
    ] as const;
    const chosen = COT_STRATEGIES.includes(strategy) ? strategy : 'zero_shot_cot';
    const session = await chainOfThoughtService.executeReasoning(prompt, chosen, {
      domain: context?.domain || 'legal',
      maxSteps: context?.maxSteps ?? 8,
    });
    res.json({
      success: true,
      data: {
        strategy: chosen,
        strategiesAvailable: COT_STRATEGIES,
        steps: session.reasoning?.steps ?? [],
        stepCount: session.reasoning?.steps?.length ?? 0,
        confidence: session.reasoning?.totalConfidence ?? session.confidence,
        conclusion: session.reasoning?.conclusion,
        latencyMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Chain-of-thought generation failed: ${error?.message || 'Unknown error'}` });
  }
});

/** List all 8 CoT reasoning strategies reachable from SDK legal tier. */
router.get('/sampling/cot/strategies', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      count: 8,
      strategies: [
        { id: 'zero_shot_cot', label: 'Zero-Shot CoT', legalUse: 'General legal analysis' },
        { id: 'few_shot_cot', label: 'Few-Shot CoT', legalUse: 'Template-guided contract review' },
        { id: 'self_consistency', label: 'Self-Consistency', legalUse: 'High-stakes multi-path verification' },
        { id: 'tree_of_thought', label: 'Tree-of-Thought', legalUse: 'Litigation strategy branching' },
        { id: 'step_back', label: 'Step-Back', legalUse: 'Abstract statutory framing' },
        { id: 'decomposition', label: 'Decomposition', legalUse: 'Multi-issue matter breakdown' },
        { id: 'least_to_most', label: 'Least-to-Most', legalUse: 'Progressive complexity in M&A diligence' },
        { id: 'chain_of_verification', label: 'Chain-of-Verification', legalUse: 'Citation grounding audit' },
      ],
      executePath: 'POST /api/jrx/v1/sdk/sampling/chain-of-thought { prompt, strategy? }',
    },
  });
});

router.post('/sampling/calibrate', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { predictedConfidence, actualOutcome, domain } = req.body;

  if (typeof predictedConfidence !== 'number' || typeof actualOutcome !== 'boolean') {
    res.status(400).json({ success: false, error: 'Missing required fields: predictedConfidence (number), actualOutcome (boolean)' });
    return;
  }

  verbalizedSamplingService.recordCalibration({ predictedConfidence, actualOutcome, timestamp: new Date().toISOString(), domain });
  res.json({ success: true, data: { recorded: true, currentScore: verbalizedSamplingService.getCalibrationScore() } });
});

router.get('/sampling/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: verbalizedSamplingService.getStats() });
});

router.get('/sampling/vocabulary', (req: Request, res: Response): void => {
  const domain = req.query.domain as string | undefined;
  res.json({ success: true, data: verbalizedSamplingService.getConfidenceVocabulary(domain) });
});

router.post('/memory/store', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { agentId, content, type, tags, importance, metadata } = req.body;

  if (!agentId || !content) {
    res.status(400).json({ success: false, error: 'Missing required fields: agentId, content' });
    return;
  }

  try {
    const memory = await mem0PersistenceService.store(agentId, content, {
      type: type || 'factual',
      namespace: `app_${ctx.applicationId}`,
      tags,
      importance,
      metadata,
    });
    res.json({ success: true, data: memory });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Memory store failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/memory/recall', async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { agentId, query, limit, minStrength, types } = req.body;

  if (!agentId || !query) {
    res.status(400).json({ success: false, error: 'Missing required fields: agentId, query' });
    return;
  }

  try {
    const results = await mem0PersistenceService.recall(agentId, query, {
      namespace: `app_${ctx.applicationId}`,
      limit: limit || 10,
      minStrength,
      types,
    });
    res.json({
      success: true,
      data: { results, count: results.length, latencyMs: Date.now() - startTime, timestamp: new Date().toISOString() },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Memory recall failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/memory/reinforce', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { memoryId } = req.body;

  if (!memoryId) {
    res.status(400).json({ success: false, error: 'Missing required field: memoryId' });
    return;
  }

  try {
    const memory = await mem0PersistenceService.reinforce(memoryId);
    if (!memory) {
      res.status(404).json({ success: false, error: 'Memory not found' });
      return;
    }
    res.json({ success: true, data: memory });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Memory reinforce failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/memory/context/:agentId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  try {
    const context = await mem0PersistenceService.getAgentContext(
      String(req.params.agentId),
      `app_${ctx.applicationId}`
    );
    res.json({ success: true, data: context });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Context retrieval failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/memory/session', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { agentId, role, content } = req.body;

  if (!agentId || !role || !content) {
    res.status(400).json({ success: false, error: 'Missing required fields: agentId, role, content' });
    return;
  }

  try {
    const entry = await mem0PersistenceService.addSessionEntry(agentId, { role, content });
    res.json({ success: true, data: entry });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Session entry failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/memory/consolidate', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { agentId } = req.body;

  if (!agentId) {
    res.status(400).json({ success: false, error: 'Missing required field: agentId' });
    return;
  }

  try {
    const result = await mem0PersistenceService.consolidate(agentId, `app_${ctx.applicationId}`);
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Memory consolidation failed: ${error?.message || 'Unknown error'}` });
  }
});

router.delete('/memory/agent/:agentId', async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  try {
    const count = await mem0PersistenceService.clearAgent(String(req.params.agentId));
    res.json({ success: true, data: { cleared: count } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Agent memory clear failed: ${error?.message || 'Unknown error'}` });
  }
});

router.get('/memory/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: mem0PersistenceService.getStats() });
});

router.post('/healing/register', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { componentId, name, type } = req.body;

  if (!componentId || !name || !type) {
    res.status(400).json({ success: false, error: 'Missing required fields: componentId, name, type' });
    return;
  }

  try {
    const health = selfHealingMLService.registerComponent(componentId, name, type);
    res.json({ success: true, data: health });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Component registration failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/healing/report-failure', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { componentId, errorType, errorMessage, severity } = req.body;

  if (!componentId || !errorType || !errorMessage) {
    res.status(400).json({ success: false, error: 'Missing required fields: componentId, errorType, errorMessage' });
    return;
  }

  try {
    const failure = selfHealingMLService.reportFailure(componentId, errorType, errorMessage, severity);
    res.json({ success: true, data: failure });
  } catch (error: any) {
    res.status(500).json({ success: false, error: `Failure report failed: ${error?.message || 'Unknown error'}` });
  }
});

router.post('/healing/report-success', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { componentId } = req.body;

  if (!componentId) {
    res.status(400).json({ success: false, error: 'Missing required field: componentId' });
    return;
  }

  selfHealingMLService.reportSuccess(componentId);
  res.json({ success: true, data: { reported: true } });
});

router.get('/healing/health', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }

  const componentId = req.query.componentId as string | undefined;
  if (componentId) {
    const health = selfHealingMLService.getComponentHealth(componentId);
    if (!health) {
      res.status(404).json({ success: false, error: 'Component not found' });
      return;
    }
    res.json({ success: true, data: health });
  } else {
    res.json({ success: true, data: selfHealingMLService.getAllHealth() });
  }
});

router.get('/healing/circuit-breakers', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }

  const allHealth = selfHealingMLService.getAllHealth();
  const breakers = allHealth.map((h: any) => h.circuitBreaker);
  res.json({ success: true, data: breakers });
});

router.post('/healing/reset-breaker', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;

  if (!checkScope(ctx.scopes, 'agents:execute')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:execute' });
    return;
  }

  const { componentId } = req.body;

  if (!componentId) {
    res.status(400).json({ success: false, error: 'Missing required field: componentId' });
    return;
  }

  const result = selfHealingMLService.resetCircuitBreaker(componentId);
  res.json({ success: true, data: { reset: result } });
});

router.get('/healing/failures', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }

  const componentId = req.query.componentId as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const failures = selfHealingMLService.getFailureHistory(componentId, limit);
  res.json({ success: true, data: { failures, count: failures.length } });
});

router.get('/healing/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({ success: true, data: selfHealingMLService.getStats() });
});

router.get('/practice-areas', (_req: Request, res: Response): void => {
  const agents = legalAgentsRegistry?.agents || [];
  const practiceAreaMap: Record<string, { count: number; jurisdictions: Set<string>; tiers: Set<string> }> = {};
  agents.forEach((a: any) => {
    const pa = a.practiceArea || a.practice_area || a.module || 'general';
    if (!practiceAreaMap[pa]) practiceAreaMap[pa] = { count: 0, jurisdictions: new Set(), tiers: new Set() };
    practiceAreaMap[pa].count++;
    if (a.jurisdiction) practiceAreaMap[pa].jurisdictions.add(a.jurisdiction);
    if (a.tier) practiceAreaMap[pa].tiers.add(a.tier);
  });
  const practiceAreas = Object.entries(practiceAreaMap).map(([name, info]) => ({
    name,
    displayName: name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    agentCount: info.count,
    jurisdictions: [...info.jurisdictions],
    tiers: [...info.tiers],
  })).sort((a, b) => b.agentCount - a.agentCount);

  res.json({
    success: true,
    data: {
      totalPracticeAreas: practiceAreas.length,
      totalAgents: agents.length,
      practiceAreas,
    },
  });
});

router.get('/info', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      platform: PLATFORM_NAME,
      version: PLATFORM_VERSION,
      apiVersion: 'v1',
      capabilities: [
        'agent-execution',
        'document-analysis',
        'document-drafting',
        'document-summarization',
        'entity-extraction',
        'contract-comparison',
        'clause-classification',
        'document-embeddings',
        'document-qa',
        'legal-research',
        'precedent-search',
        'translation-22-indian-languages',
        'batch-translation',
        'transliteration',
        'language-detection',
        'ocr-vision-api',
        'ocr-background-jobs',
        'payment-processing',
        'subscription-management',
        'invoice-generation',
        'payment-links',
        'webhook-verification',
        'grpo-response-optimization',
        'lm-inference-caching',
        'verbalized-sampling',
        'chain-of-thought-reasoning',
        'agent-memory-persistence',
        'memory-consolidation',
        'self-healing-ml-pipeline',
        'circuit-breaker-management',
        'usage-analytics',
        'multi-jurisdiction',
        'pii-redaction',
        'prompt-injection-detection',
        'rate-limiting',
        'token-budgeting',
        'prompt-enhancement-pipeline',
        'response-engineering-pipeline',
        'queen-orchestration',
        'context-engineering',
        'smart-thinking-engine',
        'bmad-cam-2.0-framework',
        'financial-data-api',
        'code-quality-review',
        'domain-research-legal',
        'domain-research-academic',
        'domain-research-patents',
        'domain-research-medical',
        'investment-research',
        'visual-analytics',
        'content-asset-management',
        'web-search-api',
        'a2a-collaboration-protocol',
        'workflow-automation',
        'predictive-analytics',
        'token-cost-prediction',
        'advanced-analytics',
        'cost-optimization',
        'guardrail-enforcement',
        'legal-content-policy',
        'response-sanitization',
        'audit-trail-enhanced',
      ],
      supportedJurisdictions: [...SDK_CONFIG.supportedJurisdictions],
      authentication: {
        methods: ['X-API-Key', 'Authorization: Bearer'],
        scopeModel: 'fine-grained',
        availableScopes: [...SDK_CONFIG.scopes],
      },
      rateLimiting: {
        model: 'per-application',
        headerPrefix: 'X-RateLimit-',
      },
      agentsAvailable: legalAgentsRegistry?.agents?.length || 0,
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/health', (_req: Request, res: Response): void => {
  const registryStats = getRegistryStats();
  res.json({
    success: true,
    data: {
      status: 'healthy',
      platform: PLATFORM_NAME,
      version: PLATFORM_VERSION,
      registryVersion: registryStats.registryVersion,
      totalAgents: registryStats.totalAgents,
      mcpTools: registryStats.mcpTools,
      topologyCatalog: registryStats.topologyCatalog,
      uptime: process.uptime(),
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      timestamp: new Date().toISOString(),
    },
  });
});

router.get('/agents/:agentId/compliance', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'agents:read') && !checkScope(ctx.scopes, '*')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: agents:read' });
    return;
  }
  const agentId = String(req.params.agentId);
  const agent = getAgentFromRegistry(agentId);
  if (!agent) {
    res.status(404).json({ success: false, error: `Agent "${agentId}" not found` });
    return;
  }
  const validation = promptGuardrailService.validateSystemPrompt(agent.systemPrompt || '');
  res.json({
    success: true,
    data: {
      agentId,
      agentName: agent.name,
      practiceArea: agent.practiceArea || agent.practice_area,
      compliance: {
        score: validation.score,
        maxScore: validation.maxScore,
        percentage: validation.percentage,
        format: validation.format,
        compliant: validation.valid,
        xmlIdentity: validation.xmlIdentity,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        proseSections: validation.proseSections,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        errors: validation.errors,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        warnings: validation.warnings,
      },
    },
  });
});

router.get('/guardrails/stats', (req: Request, res: Response): void => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'usage:read') && !checkScope(ctx.scopes, '*')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: usage:read' });
    return;
  }
  res.json({
    success: true,
    data: guardrailManager.getStats(),
  });
});

/**
 * Legal Intelligence Feed (partner SDK)
 * Daily top 5–10 legal updates: statutes, acts, amendments, SC/HC judgments, news.
 *
 * GET  /legal-intelligence/feed              — today's digest (auto-generate if missing)
 * GET  /legal-intelligence/feed/history      — recent digests
 * POST /legal-intelligence/feed/generate     — force regenerate (ingest + LLM rank)
 */
router.get('/legal-intelligence/feed', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = req.sdkContext!;
    const jurisdiction = String(req.query.jurisdiction || ctx.jurisdiction || 'IN').toUpperCase();
    const limit = Math.min(10, Math.max(5, Number(req.query.limit || process.env.JRX_LEGAL_INTEL_TOP_N || 10)));
    const digestDate = req.query.date ? String(req.query.date).slice(0, 10) : undefined;
    const orgId = String(process.env.JRX_LEGAL_INTEL_ORG_ID || 'platform');

    const {
      getLegalIntelligenceFeed,
      generateDailyLegalIntelligenceFeed,
    } = await import('../services/jrx-legal-intelligence-feed-service.js');

    let digest = await getLegalIntelligenceFeed({ orgId, jurisdiction, digestDate, limit });
    if (!digest && !digestDate) {
      digest = await generateDailyLegalIntelligenceFeed({
        orgId,
        jurisdiction,
        topN: limit,
        softPolicy: Boolean(ctx.softPolicy),
      });
    }

    if (!digest) {
      res.status(404).json({
        success: false,
        error: 'No legal intelligence digest found for the requested date.',
        code: 'LEGAL_INTEL_NOT_FOUND',
      });
      return;
    }

    res.json({
      success: true,
      method: 'legal_intelligence_feed',
      envelope: 'legal_intelligence_feed',
      data: digest,
    });
  } catch (error: any) {
    logger.error('[LegalIntel] GET feed failed', { err: error?.message });
    res.status(500).json({
      success: false,
      error: `Legal intelligence feed failed: ${error?.message || 'Unknown error'}`,
      code: 'LEGAL_INTEL_ERROR',
    });
  }
});

router.get('/legal-intelligence/feed/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = req.sdkContext!;
    const jurisdiction = String(req.query.jurisdiction || ctx.jurisdiction || 'IN').toUpperCase();
    const days = Math.min(30, Math.max(1, Number(req.query.days || 7)));
    const orgId = String(process.env.JRX_LEGAL_INTEL_ORG_ID || 'platform');
    const { listLegalIntelligenceFeeds } = await import('../services/jrx-legal-intelligence-feed-service.js');
    const items = await listLegalIntelligenceFeeds({ orgId, jurisdiction, days });
    res.json({
      success: true,
      method: 'legal_intelligence_feed_history',
      data: { jurisdiction, days, digests: items },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: `Legal intelligence history failed: ${error?.message || 'Unknown error'}`,
    });
  }
});

router.post('/legal-intelligence/feed/generate', gatewayResearchCap, async (req: Request, res: Response): Promise<void> => {
  try {
    const ctx = req.sdkContext!;
    const body = req.body || {};
    const jurisdiction = String(body.jurisdiction || req.query.jurisdiction || ctx.jurisdiction || 'IN').toUpperCase();
    const topN = Math.min(10, Math.max(5, Number(body.topN || body.limit || process.env.JRX_LEGAL_INTEL_TOP_N || 10)));
    const digestDate = body.digestDate ? String(body.digestDate).slice(0, 10) : undefined;
    const skipIngest = Boolean(body.skipIngest);
    const orgId = String(process.env.JRX_LEGAL_INTEL_ORG_ID || 'platform');

    const { generateDailyLegalIntelligenceFeed } = await import('../services/jrx-legal-intelligence-feed-service.js');
    const digest = await generateDailyLegalIntelligenceFeed({
      orgId,
      jurisdiction,
      topN,
      digestDate,
      skipIngest,
      softPolicy: Boolean(ctx.softPolicy),
    });

    res.json({
      success: true,
      method: 'legal_intelligence_feed',
      envelope: 'legal_intelligence_feed',
      data: digest,
    });
  } catch (error: any) {
    logger.error('[LegalIntel] POST generate failed', { err: error?.message });
    res.status(500).json({
      success: false,
      error: `Legal intelligence generation failed: ${error?.message || 'Unknown error'}`,
      code: 'LEGAL_INTEL_GENERATE_ERROR',
    });
  }
});

export default router;
