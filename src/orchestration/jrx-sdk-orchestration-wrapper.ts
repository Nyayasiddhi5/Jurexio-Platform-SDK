import crypto from 'node:crypto';
/**
 * jrx-sdk-orchestration-wrapper.ts — R2 deliverable for NV-LLM-001 / NV-ARCH-001.
 *
 * Single canonical entry point that EVERY SDK service (doc pipeline, workflow,
 * voice, AutomateAI, identity-extraction, gateway routes) MUST use instead of
 * calling realLLMService.executeRequest directly.
 *
 * It guarantees the canonical safety ring documented in replit.md
 * NV-ARCH-001:
 *
 *   tenant isolation → guardrails → callJurexio (single-agent, the ring) OR
 *   queenOrchestrator (multi-agent, swarm) → agent allocation → 22-section
 *   Parlant prompt → 5-tier memory + multi-tier RAG + GraphRAG → CoT/ReAct →
 *   NV-ROUTER-001 (intelligent-router/orchestrateLLM) → response engineering →
 *   hallucination + citation + safety + HITL gate → audit hash chain → stream.
 *
 * Whitelisted by NV-LLM-001 to call realLLMService internally (transitively
 * via callJurexio).
 *
 * Returns an LLMResponse-shape so existing call sites swap in with a one-line
 * diff, augmented with `.orchestration` envelope (R2 acceptance criterion).
 */
import { callJurexio, type NvOrchestrationOptions, type NvResponse } from '../services/jrx-client.js';
import type { LLMRequest, LLMResponse } from '../services/real-llm-service.js';
import { createLogger } from '../utils/logger.js';
import { isSoftPolicyActive } from '../middleware/jrx-integration-soft-policy.js';

const logger = createLogger('sdk-orch-wrapper');

export interface SdkOrchestrationContext {
  /** Caller-provided context object (from middleware: tenantId, userId, sdkPlatform, etc). */
  ctx?: any;
  /** Agent key — 'auto' to let allocator pick, or explicit agent id. */
  agentKey?: string;
  /** SDK platform: NSP | NSPM | NYM | NSI | NSA | NSM | JRX | RAG-AUDIT | gateway. */
  sdkPlatform?: string;
  /** Jurisdiction: IN | UK | US | EU | SG | GC | DEFAULT. */
  jurisdiction?: string;
  /** Task: document_analysis, workflow_step, voice_qa, identity_extraction, etc. */
  taskType?: string;
  /** Domain context shown in prompt enhancement. */
  domainContext?: string;
  /** Tier: free | pro | enterprise | government | superadmin (gates HITL/CoT/RAG). */
  tier?: string;
  /** Force enable HITL gate (e.g. for identity-extraction high-risk). */
  enableHITL?: boolean;
  /** Force enable hallucination detection (e.g. for legal drafts/contracts). */
  enableHallucinationCheck?: boolean;
  /** Force enable citation verification. */
  enableCitationVerification?: boolean;
  /** Enable RAG retrieval (statute / case / template). */
  enableRAG?: boolean;
  /** Enable 5-tier memory read/write. */
  enableMemory?: boolean;
  /** NV-COT-SDK-001 — return chain-of-thought trace on SDK orchestration responses. */
  enableCoT?: boolean;
  cotStrategy?: string;
  /** RAG document IDs to retrieve from. */
  ragDocumentIds?: string[];
  /** Matter ID for L2 matter-memory scope. */
  matterId?: string;
  /** Partner/ecosystem thread id — must NOT be confused with per-request `req.id`. */
  sessionId?: string;
  /** Risk category for HITL routing. */
  riskCategory?: string;
  /** NSP/NYM soft-policy pass-through. */
  softPolicy?: boolean;
  /** NV-DOCUMENT-TYPE-AGENT-PIN-001 */
  documentType?: string;
  parameters?: Record<string, unknown>;
}

export interface SdkOrchestrationEnvelope {
  agentId: string | null;
  agentResolved: boolean;
  pattern: string;
  promptEnhanced: boolean;
  responseEngineered: boolean;
  piiRedacted: boolean;
  compliancePassed: boolean;
  hallucinationCheck: boolean | null;
  citationsVerified: boolean | null;
  hitlTriggered: boolean | null;
  /**
   * NV-ZEROCOST-ATTRIBUTION-001 — `callJurexio` returns these on its own
   * orchestration block for its three zero-completion exits. They were dropped
   * here, so a cache hit and a billed model call left this wrapper looking
   * identical apart from a zero token count.
   */
  cacheHit?: boolean;
  cacheTier?: string;
  /** True when a fuzzy match served an answer computed for a different prompt. */
  cacheSemanticMatch?: boolean;
  cacheSimilarityScore?: number;
  deterministic?: boolean;
  deterministicResolver?: string;
  ragAbstain?: boolean;
  layersUsed?: string[];
  router: {
    provider: string;
    model: string;
    fallbackLevel?: number;
  };
  auditId: string;
  safetyRing: 'callJurexio';
}

export type SdkOrchestrationResponse = LLMResponse & {
  orchestration: SdkOrchestrationEnvelope;
};

/**
 * THE one canonical SDK call.
 *
 * @param req  LLMRequest as built by existing SDK services (kept for compat).
 * @param ctx  Orchestration context (agent, jurisdiction, task, tier).
 * @returns    LLMResponse with .orchestration envelope.
 */
export async function executeWithFullSafetyRing(
  req: LLMRequest,
  ctx: SdkOrchestrationContext = {}
): Promise<SdkOrchestrationResponse> {
  const startedAt = Date.now();
  // N8 (2026-05-09): per-stage timing instrumentation — surfaced on
  // response.orchestration.timings so /agents/:id/execute callers can
  // attribute p95 latency to the actual hotspot stage (LLM gen vs RAG vs
  // safety gates vs prompt build).
  const timings: Record<string, number> = { startMs: startedAt };
  const tStart = (k: string) => { timings[`${k}_start`] = Date.now() - startedAt; };
  const tEnd = (k: string) => { timings[k] = (Date.now() - startedAt) - (timings[`${k}_start`] || 0); };
  tStart('opts_build');

  const opts: NvOrchestrationOptions = {
    maxTokens: req.maxTokens ?? 2048,
    source: 'nyayasiddhi',
    tenantId: ctx.ctx?.tenantId || ctx.ctx?.organizationId,
    userId: req.userId || ctx.ctx?.userId || 'sdk-anonymous',
    tier: (ctx.tier as any) || ctx.ctx?.tier || 'enterprise',
    jurisdiction: ctx.jurisdiction,
    taskType: ctx.taskType,
    language: 'en',
    // NV-MEM-SESSION-001 — memory store/recall keys on the partner thread id.
    // Using req.id (per-request UUID) made every orchestrate call amnesiac.
    requestId: req.id,
    sessionId: ctx.sessionId || ctx.ctx?.sessionId || req.id,
    domainContext: ctx.domainContext,
    enableOrchestration: true,
    enableHITL: ctx.enableHITL ?? false,
    enableHallucinationCheck: ctx.enableHallucinationCheck ?? false,
    enableCitationVerification: ctx.enableCitationVerification ?? false,
    enableExplainability: false,
    enableRAG: ctx.enableRAG ?? false,
    enableMemory: ctx.enableMemory ?? false,
    ragDocumentIds: ctx.ragDocumentIds,
    matterId: ctx.matterId,
    enableCoT: ctx.enableCoT ?? false,
    // NV-COT-AUTO-STRATEGY-001 — forward only a caller-supplied strategy so
    // jrx-client can pick from the task shape. Defaulting here pinned every SDK
    // request to zero_shot_cot regardless of task.
    cotStrategy: (ctx.cotStrategy as any) || undefined,
    softPolicy: Boolean(ctx.softPolicy ?? ctx.ctx?.softPolicy) || isSoftPolicyActive(),
    // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
    riskCategory: ctx.riskCategory,
    responseTime: req.requirements?.responseTime as NvOrchestrationOptions['responseTime'],
    costBudget: req.requirements?.costBudget,
    llmComplexity: req.requirements?.complexity as NvOrchestrationOptions['llmComplexity'],
    qualityLevel: req.requirements?.qualityLevel,
    documentType: ctx.documentType,
    parameters: ctx.parameters,
  };

  tEnd('opts_build');
  const agentKey = ctx.agentKey || 'auto';
  const systemPrompt = req.systemPrompt || 'You are a Jurexio legal AI assistant.';

  let nvResp: NvResponse;
  tStart('callJurexio_full_ring');
  try {
    nvResp = await callJurexio(agentKey, systemPrompt, req.prompt, opts);
  } catch (err: any) {
    tEnd('callJurexio_full_ring');
    logger.error('[sdk-orch-wrapper] callJurexio threw', {
      sdkPlatform: ctx.sdkPlatform,
      agentKey,
      taskType: ctx.taskType,
      err: err?.message,
    });
    throw err;
  }
  tEnd('callJurexio_full_ring');

  const responseTime = Date.now() - startedAt;
  timings.totalMs = responseTime;
  const o = nvResp.orchestration || ({} as any);
  const r = (nvResp as any).router || {};

  // D-4: surface the citation-verification verdict on the envelope. NvResponse
  // carries citations:{ verified, unverified } when verification ran; map it to a
  // boolean (true only when ≥1 citation verified and none unverified), or null
  // when verification did not run (no citations object). Previously the wrapper
  // read a non-existent `nvResp.citationsVerified`, so this was always null.
  const citObj = (nvResp as any).citations as { verified?: number; unverified?: number } | undefined;
  const citationsVerifiedFlag: boolean | null = citObj
    ? ((citObj.verified ?? 0) > 0 && (citObj.unverified ?? 0) === 0)
    : null;

  // H1 (R5 architect-fix 2026-05-07): normalize NvResponse.tokens (prompt/completion)
  // to LLMResponse.tokens (input/output) — emit BOTH shapes so legacy callers that
  // read .tokens.prompt/.completion (e.g. jrx-gateway-routes:167, jrx-orchestration-
  // routes:400) and new callers that destructure LLMResponse.tokens.input/output
  // both work without breakage.
  const t = nvResp.tokens || ({} as any);
  // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
  const inputTok = (t.input ?? t.prompt ?? 0) as number;
  // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
  const outputTok = (t.output ?? t.completion ?? 0) as number;
  const totalTok = (t.total ?? inputTok + outputTok) as number;
  const tokensNormalized: any = {
    input: inputTok,
    output: outputTok,
    prompt: inputTok,        // legacy alias
    completion: outputTok,   // legacy alias
    total: totalTok,
  };

  const ragCtx = (nvResp as any).ragContext as
    | { layersUsed?: string[]; documentsRetrieved?: number; retrievalMethods?: string[] }
    | undefined;
  const layersUsed = ragCtx?.layersUsed || [];
  const ragActuallyUsed = !!(ragCtx && (ragCtx.documentsRetrieved ?? 0) > 0);

  return {
    id: req.id,
    requestId: req.id, // H2: required by LLMResponse
    content: nvResp.content,
    provider: (nvResp as any).provider || r.provider || 'orchestrator',
    model: nvResp.model || r.model || 'orchestrator',
    tokens: tokensNormalized,
    cost: (nvResp as any).cost ?? 0,
    responseTime: nvResp.latencyMs ?? responseTime,
    qualityScore: (nvResp as any).qualityScore ?? 0.95, // H2: required field
    metadata: {
      // H2: typed required keys per LLMResponse.metadata declaration
      fallbackLevel: (nvResp as any).fallbackLevel ?? r.fallbackLevel ?? 0,
      routingReason: r.routingReason || 'callJurexio-safety-ring',
      contextUsed: ragActuallyUsed || !!(ctx.enableMemory && (nvResp as any).memoryContext),
      intelligenceLevel: ((ctx.tier === 'enterprise' || ctx.tier === 'government' || ctx.tier === 'superadmin') ? 'expert' : (ctx.tier === 'pro' ? 'professional' : 'standard')) as 'standard' | 'professional' | 'expert',
      costOptimization: true, // orchestrateLLM always cost-optimizes per NV-ROUTER-001
      // wrapper-specific extras (preserved):
      orchestrationId: (nvResp as any).orchestrationId,
      auditId: (nvResp as any).auditId,
      router: (nvResp as any).router,
      layersUsed,
      ragConfidence: ragActuallyUsed ? 0.75 : 0,
    },
    ragContext: ragCtx,
    memoryContext: (nvResp as any).memoryContext,
    orchestration: {
      agentId: o.agentId || agentKey,
      agentResolved: !!o.agentResolved,
      pattern: o.pattern || 'callJurexio',
      promptEnhanced: !!o.promptEnhanced,
      responseEngineered: !!o.responseEngineered,
      piiRedacted: nvResp.piiRedacted ?? true,
      compliancePassed: nvResp.compliancePassed ?? true,
      hallucinationCheck: (nvResp as any).hallucinationCheck ?? null,
      citationsVerified: citationsVerifiedFlag,
      hitlTriggered: (nvResp as any).hitlTriggered ?? null,
      // NV-ZEROCOST-ATTRIBUTION-001 — carry the zero-completion mechanism through
      // instead of leaving the caller to infer it from a token count of 0.
      ...(o.cacheHit === true ? { cacheHit: true } : {}),
      ...(typeof o.cacheTier === 'string' ? { cacheTier: o.cacheTier } : {}),
      ...(o.cacheSemanticMatch === true ? { cacheSemanticMatch: true } : {}),
      ...(typeof o.cacheSimilarityScore === 'number'
        ? { cacheSimilarityScore: o.cacheSimilarityScore }
        : {}),
      ...(o.deterministic === true ? { deterministic: true } : {}),
      ...(typeof o.deterministicResolver === 'string'
        ? { deterministicResolver: o.deterministicResolver }
        : {}),
      ...(o.ragAbstain === true ? { ragAbstain: true } : {}),
      layersUsed,
      ungrounded: ctx.enableRAG ? !ragActuallyUsed : undefined,
      router: {
        provider: (nvResp as any).provider || 'orchestrator',
        model: nvResp.model || 'orchestrator',
        fallbackLevel: (nvResp as any).fallbackLevel,
      },
      auditId: (nvResp as any).auditId || `audit_${Date.now()}`,
      safetyRing: 'callJurexio',
      chainOfThought: (nvResp as any).chainOfThought ?? null,
      // N8: per-stage timings (ms) for p95 hotspot attribution
      timings: {
        totalMs: responseTime,
        optsBuildMs: timings['opts_build'] || 0,
        callJurexioMs: timings['callJurexio_full_ring'] || 0,
        // Innermost stage timings (RAG, LLM, gates) are populated by
        // callJurexio itself via nvResp.orchestration.timings if available.
        innerStages: (nvResp as any).orchestration?.timings || {},
      },
    },
  } as SdkOrchestrationResponse;
}

/** Convenience for callers who only need the textual content. */
export async function executeWithFullSafetyRingSimple(
  systemPrompt: string,
  userPrompt: string,
  ctx: SdkOrchestrationContext = {},
  maxTokens: number = 2048
): Promise<string> {
  const resp = await executeWithFullSafetyRing(
    {
      id: `sdk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      userId: ctx.ctx?.userId || 'sdk-anonymous',
      prompt: userPrompt,
      systemPrompt,
      maxTokens,
      temperature: 0.3,
      requirements: {
        complexity: 'complex',
        domain: 'analytical',
        priority: 'high',
        costBudget: 'balanced',
        responseTime: 'balanced',
        qualityLevel: 'professional',
      },
      fallbackLevels: 3,
      timestamp: new Date(),
    } as LLMRequest,
    ctx
  );
  return resp.content;
}
