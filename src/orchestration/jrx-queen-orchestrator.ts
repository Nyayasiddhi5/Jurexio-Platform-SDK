// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Queen Orchestrator - Intelligent Task Decomposition & Multi-Agent Routing
 * 
 * CRITICAL IMPLEMENTATION (January 16, 2026)
 * 
 * This is the central intelligence for Jurexio Enterprise Platform SDK orchestration that:
 * 1. Receives user prompts and analyzes intent
 * 2. Decomposes complex tasks into subtasks using advanced algorithms
 * 3. Routes tasks to optimal agents based on capabilities
 * 4. Supports single-agent, multi-agent, and swarm patterns
 * 5. Synthesizes outputs from multiple agents
 * 6. Maintains full context engineering throughout
 * 
 * Orchestration Algorithms Supported:
 * - ACONIC: Constraint-based decomposition
 * - ADaPT: As-needed decomposition with adaptive planning
 * - DAG Orchestration: Directed acyclic graph task dependencies
 * - Hierarchical Task Analysis (HTA): Break complex tasks into subtasks
 * - Swarm Intelligence: Decentralized multi-agent collaboration
 * - Collective Intelligence: Brainstorm, consensus, vote, debate, synthesis
 * 
 * Agentic Standards Supported:
 * - A2A (Agent-to-Agent Protocol): Inter-agent communication
 * - MCP (Model Context Protocol): Tool and context exchange
 * - AG-UI: Agent-to-user interface streaming
 * - ROMA L1-L5: Autonomy label + L5 engine outcome track
 * - Parlant: Communication standards
 * - BMAD: Behavioral framework coordination
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import {
  startSpan,
  withSpan,
  runWithSpan,
  runWithRunRoot,
  getRunRootSpan,
  type NyvSpan,
} from '../utils/nyv-tracer.js';
import { buildAgentCacheNamespace } from '../services/jrx-cache-namespace.js';
import { getPatternAutoSelector } from '../services/nyv-pattern-auto-selector.js';
import {
  patternCapabilityHint,
  patternPreferredTopologyId,
  patternToOrchestrationPattern,
  patternSystemDirective,
  patternShouldForceMakerChecker,
  patternShouldApplyCot,
} from './jrx-pattern-execution-map.js';
import { fanInMemoryRecall, type MemoryRecallSource, type MemoryRecallItem } from './jrx-memory-fan-in.js';
import { resolveContextBudgets, withContextTimeout } from './jrx-context-budgets.js';
import {
  COT_MIN_REMAINING_MS,
  OPTIONAL_STAGE_GRACE_MS,
  proceedOnFirstUseful,
  recordStep0Outcome,
  setRequestPhase,
  settleOptional,
  trackSettled,
  type RequestPhase,
} from './jrx-completion-driven.js';
import {
  jurisdictionPromptResolver,
  PromptNotFoundError,
  type JurisdictionCode,
} from '../services/jrx-jurisdiction-prompt-resolver.js';
import { inferJurisdiction } from '../utils/jurisdiction-resolver.js';
import {
  betaPartnerMaxTokensFloor,
  betaQueenLeafMaxTokensFast,
  isBetaQualityFirst,
} from '../config/jrx-beta-quality-profile.js';
import {
  getActiveAgents as getRegistryAgents,
  resolveAgentId as resolveRegistryAgentId,
} from '../config/agent-registry-loader.js';
import { getBoundCapabilitiesForAgent } from '../config/agent-capability-bindings-v5.1.0.js';
import {
  capabilityManifest,
  mapBillingTierToCapabilityTier,
  resolveIntentToCapability,
  type CapabilityDescriptor,
  type CapabilityTier,
} from './capability-manifest.js';
import {
  formatAgentToolDirective,
  preInvokeAgentCapabilities,
  resolveCapabilityIdsFromAgentTools,
} from './jrx-agent-tool-bridge.js';
import { romaL5Engine } from '../packages/protocols/roma/roma-l5-engine.js';
import {
  getPolicyForTier,
  runWithConcurrency,
  evaluateFailures,
  type ExecutionPolicy,
} from './orchestration-policy.js';
// Session-10 Batch D: governance hooks injected at the synthesis LLM dispatch
// site below. Each hook is a no-op when its JRX_F_GOV_* flag is OFF (the
// default) — the orchestrator behaves byte-for-byte as before. When ON, the
// hook participates in the safety ring per NV-ARCH-001.
import { isNyvFeatureOn as _govFlagOn } from '../config/jrx-feature-flags.js';
import { isBedrockFirstPolicy, isPartnerLegalPremiumFirst } from '../config/jrx-llm-routing-policy.js';
import { remapQueenPreferredForClaude55 } from '../config/jrx-bedrock-claude55-policy.js';
import { NV_TIMEOUTS } from '../config/jrx-timeout-policy.js';
import type { QueenNodePromptPolicy } from '../config/jrx-prompt-budget.js';
import {
  classifyQueenNodeRole,
  resolveExplorationMaxTokens,
  type QueenNodeRole,
} from './jrx-queen-node-role.js';
import { withTenantSlot as _govWithTenantSlot } from './concurrency-governor.js';
import { nvCostOptimizationSuite as _govCostOpt } from '../services/jrx-cost-optimization-suite.js';
import { makerCheckerService as _govMakerChecker } from '../services/maker-checker-service.js';
// Static-import edge for `_govMakerChecker` is intentional: it gives the
// wiring auditor a real reachability link from queen orchestrator to
// maker-checker-service (closing the orphan gap). Session-11 (2026-05-10):
// the symbol is now actually consumed at the synthesis dispatch site below
// via maybeRunMakerCheckerLoop() — when JRX_F_GOV_MAKER_CHECKER is ON the
// post-synthesis output is passed through the maker/checker runLoop()
// using the LLM-driven synthesizer as the maker function and a deterministic
// quality checker; when the flag is OFF the helper is a no-op and returns
// the input unchanged (byte-for-byte v5 behaviour preserved). The HITL
// queue path (humanReviewQueue) is reachable from the existing /api/nv5/gov/
// maker-checker/queue admin endpoints — Session-10 Batch D wiring.
void _govMakerChecker;

/**
 * Session-11 (2026-05-10) maker-checker injection helper.
 *
 * Behaviour matrix:
 *   • JRX_F_GOV_MAKER_CHECKER OFF (default) → identity function: returns
 *     `currentSynthesis` unchanged. Zero overhead, byte-for-byte v5.
 *   • JRX_F_GOV_MAKER_CHECKER ON → wraps the LLM synthesizer in a
 *     makerCheckerService.runLoop call. The maker re-synthesises with
 *     checker feedback appended to the request as a `metadata.makerHint`
 *     field; the checker scores the output deterministically (length /
 *     citation marker presence / jurisdiction-token presence). On loop
 *     completion the approved output is returned; on loop failure the
 *     original synthesis is returned and a warning logged. The HITL
 *     queue path is exercised through the runLoop's own escalation logic
 *     (visible at /api/nv5/gov/maker-checker/queue when the gov flag is
 *     additionally on).
 *
 * Failure isolation: every error path returns `currentSynthesis` rather
 * than throwing, so the outer synthesis dispatch still returns a useful
 * answer if the maker-checker session itself crashes.
 */
// NV-GOV-MAKER-CHECKER-LLM-001: real LLM-backed checker. Routes a critique
// request through the SAME safety ring as synthesis/planning (withMiddleware →
// realLLMService.executeRequest → orchestrateLLM, honouring NV-LLM-001) and
// returns a structured legal-quality verdict. Returns null on ANY failure
// (provider error, empty/unparseable JSON) so the caller falls back to the
// deterministic heuristic checker — a critique failure must never poison a
// successful synthesis.
type CheckerIssueType = 'completeness' | 'relevance' | 'safety' | 'accuracy' | 'clarity' | 'format';
type CheckerSeverity = 'low' | 'medium' | 'high' | 'critical';
async function llmCheckSynthesis(
  request: OrchestrationRequest,
  content: string,
  jurisdiction: string,
): Promise<{
  score: number;
  approved: boolean;
  issues: Array<{ type: CheckerIssueType; severity: CheckerSeverity; description: string }>;
  suggestions: string[];
  reasoning: string;
} | null> {
  try {
    const { withMiddleware } = await import('./orchestration-middleware.js');
    const { realLLMService } = await import('../services/real-llm-service.js');
    const policy = resolveRequestPolicy(request);
    const reqAny = request as unknown as { userId?: string; tenantId?: string; orchestrationId?: string; id?: string };
    const ISSUE_TYPES = new Set<CheckerIssueType>(['completeness', 'relevance', 'safety', 'accuracy', 'clarity', 'format']);
    const SEVERITIES = new Set<CheckerSeverity>(['low', 'medium', 'high', 'critical']);

    const sys = `You are a senior ${jurisdiction} legal-quality reviewer — the CHECKER in a maker-checker loop. Critique the candidate answer for completeness, legal accuracy, citation support, jurisdiction fit, safety, and clarity. Respond with ONLY minified JSON of shape {"score":<0..1>,"approved":<bool>,"issues":[{"type":"completeness|relevance|safety|accuracy|clarity|format","severity":"low|medium|high|critical","description":"..."}],"suggestions":["..."]}. Set approved=true only when score>=0.85 and there are no high/critical issues. Do not include any prose outside the JSON.`;
    const user = `ORIGINAL REQUEST:\n${String(request.prompt ?? '').slice(0, 2000)}\n\nCANDIDATE ANSWER:\n${content.slice(0, 6000)}\n\nReturn the JSON critique now.`;

    const wrapped = await withMiddleware(
      withQueenRagSkip(
        {
          prompt: user,
          agentKey: 'queen.checker',
          tier: policy.tier,
          jurisdiction,
          userId: reqAny.userId,
          tenantId: reqAny.tenantId,
          requestId: reqAny.orchestrationId ?? reqAny.id,
          riskLevel: 'low' as const,
        },
        request,
      ),
      async () => {
        const response = await realLLMService.executeRequest({
          // NV-REQID-CORRELATION-001: CoT capture belongs to the parent request.
          id:           `${reqAny.orchestrationId ?? reqAny.id ?? 'orch'}::cot`,
          userId:       reqAny.userId ?? 'system',
          provider:     undefined as any,
          model:        undefined as any,
          prompt:       user,
          systemPrompt: sys,
          maxTokens:    800,
          temperature:  0.1,
          requirements: {
            complexity:   'medium',
            domain:       'analytical',
            priority:     'medium',
            costBudget:   'economy',
            responseTime: 'fast',
            qualityLevel: 'professional',
          },
          fallbackLevels: 2,
          timestamp:      new Date(),
        } as any);
        return { output: response.content };
      },
    );

    const raw = typeof wrapped.output === 'string' ? wrapped.output : '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const score = Math.max(0, Math.min(1, Number(j.score)));
    if (!Number.isFinite(score)) return null;
    const issues = (Array.isArray(j.issues) ? j.issues : [])
      .map((i: any) => ({
        type: (ISSUE_TYPES.has(i?.type) ? i.type : 'accuracy') as CheckerIssueType,
        severity: (SEVERITIES.has(i?.severity) ? i.severity : 'low') as CheckerSeverity,
        description: String(i?.description ?? '').slice(0, 400),
      }))
      .filter((i) => i.description.length > 0)
      .slice(0, 12);
    const suggestions = (Array.isArray(j.suggestions) ? j.suggestions : [])
      .map((s: any) => String(s).slice(0, 400))
      .filter(Boolean)
      .slice(0, 8);
    const approved = j.approved === true && score >= 0.85 && !issues.some((i) => i.severity === 'high' || i.severity === 'critical');
    return { score, approved, issues, suggestions, reasoning: 'LLM legal-quality critique' };
  } catch {
    return null;
  }
}

async function maybeRunMakerCheckerLoop(
  request: OrchestrationRequest,
  decomposition: TaskDecomposition,
  completed: AgentExecution[],
  currentSynthesis: string,
  synthesizeWithLLM: (
    decomposition: TaskDecomposition,
    completedExecutions: AgentExecution[],
    request: OrchestrationRequest,
  ) => Promise<string | null>,
): Promise<string> {
  // Task #156 — SME Legal Chat may force-enable maker-checker per request
  // via metadata.forceMakerChecker, regardless of the global gov flag.
  // The SME tool sets this so every SME-rated run goes through the same
  // governance loop the rest of the platform exercises behind the flag.
  const reqMeta = (request as unknown as {
    metadata?: {
      forceMakerChecker?: boolean;
      queenDepth?: boolean;
      partnerSyncLean?: boolean;
    };
  }).metadata ?? {};
  const partnerSyncLean = reqMeta.partnerSyncLean === true;
  if (partnerSyncLean) return currentSynthesis;

  const forceFromMetadata = reqMeta.forceMakerChecker === true;
  const forceFromQueenDepth = reqMeta.queenDepth === true;
  const autoPatternId = asExt(request).autoPatternId;
  const tier = String(asExt(request).tier ?? asExt(request).userTier ?? asExt(request).billingTier ?? 'lite').toLowerCase();
  // Wave B Queen OS: use patternShouldForceMakerChecker for P07 check;
  // force when queenDepth, pattern P07, or any non-lite tier (but never partnerSyncLean)
  const forceByPolicy = forceFromQueenDepth || patternShouldForceMakerChecker(autoPatternId) || tier !== 'lite';
  if (!forceFromMetadata && !forceByPolicy && !_govFlagOn('govMakerChecker')) return currentSynthesis;

  try {
    const jurisdiction = String(
      request.jurisdiction ?? (request as unknown as { userJurisdiction?: string }).userJurisdiction ?? 'IN',
    ).toUpperCase();

    const result = await _govMakerChecker.runLoop(request.prompt, {
      makerFn: async (_prompt, feedback) => {
        // First iteration: reuse the already-computed synthesis to avoid a
        // duplicate LLM call. Subsequent iterations call the synthesizer
        // again with the checker feedback merged into request.metadata.
        if (!feedback) {
          return {
            id: `mk-${Date.now()}-init`,
            content: currentSynthesis,
            metadata: { initial: true },
            confidence: 0.7,
            reasoning: 'initial synthesis (no feedback yet)',
          };
        }
        const reqWithHint: OrchestrationRequest = {
          ...request,
          metadata: {
            ...((request as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}),
            makerCheckerHint: feedback.suggestions.join(' | '),
            makerCheckerIssues: feedback.issues.map(i => i.description).join(' | '),
          },
        } as OrchestrationRequest;
        const next = await synthesizeWithLLM(decomposition, completed, reqWithHint);
        return {
          id: `mk-${Date.now()}-iter`,
          content: next ?? currentSynthesis,
          metadata: { iter: true },
          confidence: feedback.score,
          reasoning: `revised against ${feedback.issues.length} checker issues`,
        };
      },
      checkerFn: async (_prompt, output) => {
        // NV-GOV-MAKER-CHECKER-LLM-001: prefer a real LLM critique when enabled.
        // Fail-safe — on null (provider/parse failure) fall through to the
        // deterministic heuristic below so a critique failure never blocks the
        // loop.
        if (_govFlagOn('govMakerCheckerLlm')) {
          const llm = await llmCheckSynthesis(request, output.content, jurisdiction);
          if (llm) {
            return {
              id: `mk-check-${Date.now()}`,
              makerOutputId: output.id,
              approved: llm.approved,
              score: llm.score,
              issues: llm.issues,
              suggestions: llm.suggestions,
              reasoning: llm.reasoning,
              requiresHumanReview: llm.issues.some((i) => i.severity === 'critical'),
            };
          }
        }
        // Deterministic legal-quality checker — no LLM call. Heuristics:
        //   length ≥ 300 chars, presence of a jurisdiction token, presence
        //   of a citation marker (§ / Sec / cl. / Art. / Rule).
        const issues: Array<{ type: 'completeness' | 'relevance' | 'safety' | 'accuracy' | 'clarity' | 'format'; severity: 'low' | 'medium' | 'high' | 'critical'; description: string }> = [];
        const suggestions: string[] = [];
        if (output.content.length < 300) {
          issues.push({ type: 'completeness', severity: 'medium', description: 'Output shorter than 300 chars' });
          suggestions.push('Expand reasoning with cited authority');
        }
        if (!new RegExp(`\\b${jurisdiction}\\b`, 'i').test(output.content)) {
          issues.push({ type: 'relevance', severity: 'low', description: `Jurisdiction token "${jurisdiction}" not present` });
          suggestions.push(`Reference the ${jurisdiction} jurisdiction explicitly`);
        }
        if (!/(?:§|Sec\.|Section|Cl\.|Article|Art\.|Rule)\s*\d/i.test(output.content)) {
          issues.push({ type: 'accuracy', severity: 'low', description: 'No statutory citation marker detected' });
          suggestions.push('Cite at least one statute, section, or rule');
        }
        const baseScore = 0.85;
        const deduction = issues.reduce((s, i) => s + ({ low: 0.05, medium: 0.10, high: 0.20, critical: 0.40 } as Record<string, number>)[i.severity], 0);
        const score = Math.max(0, baseScore - deduction);
        return {
          id: `mk-check-${Date.now()}`,
          makerOutputId: output.id,
          approved: score >= 0.85 && issues.length === 0,
          score,
          issues,
          suggestions,
          reasoning: `legal-quality heuristic checker — ${issues.length} issue(s)`,
          requiresHumanReview: false,
        };
      },
      config: { maxIterations: 2, approvalThreshold: 0.85 },
      context: { orchestrationId: request.orchestrationId, jurisdiction },
    });

    const approved = result.iterations.find(it => it.checkerFeedback.approved);
    if (approved) return approved.makerOutput.content;
    const last = result.iterations[result.iterations.length - 1];
    if (last) return last.makerOutput.content;
    return currentSynthesis;
  } catch (e) {
    // Maker-checker is observation-grade until the firewall is flipped to
    // enforcement; never let a checker failure poison a successful synthesis.
    void e;
    return currentSynthesis;
  }
}

const logger = createLogger('queen-orchestrator');

/**
 * Optional, orchestrator-internal extension fields callers may attach to an
 * `OrchestrationRequest`. Captured once here so callsites don't have to use
 * `as any` to read them. Anything not on the public `OrchestrationRequest`
 * type lives here.
 *
 * Note: `orchestrationId` is now a first-class typed field on
 * `OrchestrationRequest` (NYV-ORCH-EVENT-CORRELATION-002, Task #37) so the
 * cross-request leak prevention contract is enforceable at compile time.
 */
type OrchRequestExt = OrchestrationRequest & {
  tier?: string;
  userTier?: string;
  billingTier?: string;
  jurisdiction?: string;
  userJurisdiction?: string;
  tenantJurisdiction?: string;
  practiceArea?: string;
  userId?: string;
  tenantId?: string;
  id?: string;
  requestId?: string;
  riskLevel?: string;
  agentKey?: string;
  skillsAllowedCapabilities?: string[];
  skillsActivated?: string[];
  // NV-PATTERN-DISPATCH-001: auto-selected agentic pattern (P01–P22) + its
  // behavioural directive, propagated from orchestrate() so decomposeTask and
  // buildAgentPrompt can shape execution instead of treating it as telemetry.
  autoPatternId?: string;
  patternDirective?: string;
  __queenCotApplied?: boolean;
  __queenCotTraceId?: string;
  __queenCotStrategy?: string;
  __queenCotConfidence?: number;
  /** NV-QE-COT-CAPTURE-FAIL-001 — CoT ran and threw (JSON parse, etc.). */
  __queenCotCaptureFailed?: boolean;
  __queenCotCaptureError?: string;
  /** NV-COMPLETION-DRIVEN-001 — CoT was skipped so HTTP could proceed. */
  __queenCotSkippedProgression?: boolean;
  __queenCotSkippedSla?: boolean;
  __requestPhase?: RequestPhase;
  // NYV-ORCH-CACHE-001 (Task #38): tally of per-agent prompt cache hits in
  // the current orchestration run. Bumped inside callAgentInner whenever an
  // agent answer is served from lmCacheService instead of the LLM, and
  // surfaced on OrchestrationResult.metadata.cacheHits at fan-in time.
  __cacheHits?: number;
  /** Set after Queen Step-0 Auto-RAG so per-agent middleware skips re-retrieve. */
  ragAlreadyApplied?: boolean;
  /** Set after Queen Step-0 memory fan-in so per-leaf PRE does not wait again. */
  memoryAlreadyApplied?: boolean;
  /**
   * NYV-ORCH-SAFETY-VERDICT-001: last user-facing middleware safety verdict
   * stamped by callAgent / synthesizeWithLLM. Legal-chat + partner envelopes
   * map middleware pass|review|reject → allow|review|block.
   */
  __lastSafetyVerdict?: OrchestrationSafetyVerdict;
  /**
   * NV-LEGALCHAT-QE-001: the middleware ring's own `post.stagesRun` — the list
   * of safety stages that MEASURABLY executed for the released answer.
   *
   * Callers that build a quality envelope need this rather than the verdict
   * `details`, because `details` only carries a key when a stage produced a
   * signal: a clean PII scan and a PII scan that never ran are indistinguishable
   * there. Ticking a gate off an absent signal is exactly the failure mode the
   * envelope exists to prevent.
   */
  __lastSafetyStagesRun?: string[];
  /** NV-LEGALCHAT-QE-001 — measured Step-0 Auto-RAG outcome (attempt vs grounding). */
  __ragStep0?: QueenRagStep0;
};

/**
 * NV-LEGALCHAT-RAG-EVENT-001 — measured Step-0 retrieval, including the counts.
 *
 * `chunkCount` / `layersUsed` / `retrievalMethods` are OPTIONAL on purpose:
 * they are only present when Auto-RAG actually returned. A run that timed out
 * has `timedOut: true` and NO `chunkCount`, because the retrieval may still be
 * in flight — reporting 0 there would be indistinguishable from "searched and
 * found nothing", which is the exact confusion this field set exists to end.
 */
export interface QueenRagStep0 {
  attempted: boolean;
  grounded: boolean;
  timedOut: boolean;
  chunkCount?: number;
  layersUsed?: string[];
  retrievalMethods?: string[];
  intent?: string;
  /** NV-RESEARCH-AUTHORITY-ENFORCE-001 — post-synthesis enforcer reads injected block. */
  contextBlock?: string;
}
const asExt = (r: OrchestrationRequest): OrchRequestExt => r as OrchRequestExt;

function completionDrivenResultMeta(request: OrchestrationRequest): {
  queenCotSkippedProgression?: boolean;
  requestPhase: RequestPhase;
  optionalDegraded?: boolean;
  orchestrationId?: string;
  safetyStagesRun?: string[];
  ragStep0?: QueenRagStep0;
} {
  const ext = asExt(request);
  const skipped = ext.__queenCotSkippedProgression === true;
  const captureFailed = ext.__queenCotCaptureFailed === true;
  const degraded = skipped || captureFailed;
  const phase: RequestPhase = degraded ? 'degraded' : (ext.__requestPhase === 'failed_infra' ? 'failed_infra' : 'ready');
  setRequestPhase(ext, phase);
  return {
    ...(skipped ? { queenCotSkippedProgression: true } : {}),
    requestPhase: phase,
    ...(degraded ? { optionalDegraded: true } : {}),
    /* NV-LEGALCHAT-QE-001 — measured safety-ring stages, so a caller building a
     * quality envelope stamps gates from evidence instead of assuming the ring
     * ran everything. Omitted (not empty) when no ring pass reported, so the
     * caller can distinguish "no evidence" from "evidence: nothing ran". */
    ...(ext.__lastSafetyStagesRun?.length ? { safetyStagesRun: [...ext.__lastSafetyStagesRun] } : {}),
    ...(ext.__ragStep0 ? { ragStep0: { ...ext.__ragStep0 } } : {}),
    /* Surface the run id partners asked for. Already stamped at orchestrate()
     * entry (line ~1580) and enforced by requireOrchestrationId(); it was only
     * ever visible on the SSE path, so a sync caller had no stable handle for a
     * multi-leaf run. */
    ...(request.orchestrationId ? { orchestrationId: request.orchestrationId } : {}),
  };
}

/** Legal-chat / partner envelope shape for Queen safety outcomes. */
export interface OrchestrationSafetyVerdict {
  verdict: 'allow' | 'block' | 'review';
  reason?: string;
  reasons?: string[];
  details?: Record<string, unknown>;
  enforced?: boolean;
  verdictId?: string;
  source: string;
}

async function maybeRunQueenCoT(request: OrchestrationRequest): Promise<boolean> {
  const reqExt = request as OrchRequestExt & {
    metadata?: Record<string, unknown>;
    enableCoT?: boolean;
    cotStrategy?: string;
  };
  const ext = asExt(request);
  if (ext.__queenCotApplied) return true;
  if (ext.__queenCotCaptureFailed) return false;
  if (ext.__queenCotSkippedProgression) return false;

  const metadata = reqExt.metadata ?? {};
  // Wave B Queen OS: skip CoT for partner lean path (explicit agentKey sync path)
  const partnerSyncLean = metadata.partnerSyncLean === true;
  if (partnerSyncLean) return false;

  const remaining = queenTimeRemainingMs(request);
  if (remaining !== undefined && remaining < COT_MIN_REMAINING_MS) {
    ext.__queenCotSkippedSla = true;
    ext.__queenCotSkippedProgression = true;
    logger.info('[Queen] CoT skipped — remaining wall below min', { remainingMs: remaining });
    return false;
  }

  const autoPatternId = reqExt.autoPatternId;
  const tier = String(reqExt.tier ?? reqExt.userTier ?? reqExt.billingTier ?? 'lite').toLowerCase();
  const enableCoT = reqExt.enableCoT === true || metadata.enableCoT === true || metadata.queenDepth === true;
  // Wave B Queen OS: use patternShouldApplyCot for P02 check + tier-based activation
  // NV-QUEEN-FULL-DEPTH-001: queenDepth / mitra+ also activate CoT
  const shouldRun = enableCoT
    || patternShouldApplyCot(autoPatternId)
    || tier === 'pro'
    || tier === 'enterprise'
    || tier === 'mitra'
    || metadata.queenDepth === true;
  if (!shouldRun) return false;

  try {
    const { chainOfThoughtService } = await import('../services/chain-of-thought-service.js');
    const cotStrategy = typeof reqExt.cotStrategy === 'string'
      ? reqExt.cotStrategy
      : typeof metadata.cotStrategy === 'string'
        ? String(metadata.cotStrategy)
        : 'zero_shot_cot';
    const cotSession = await chainOfThoughtService.executeReasoning(request.prompt, cotStrategy as any, {
      domain: 'legal',
      maxSteps: 8,
    });
    ext.__queenCotApplied = true;
    ext.__queenCotTraceId = cotSession.traceId;
    ext.__queenCotStrategy = cotSession.strategy;
    ext.__queenCotConfidence = cotSession.confidence;
    return true;
  } catch (error: unknown) {
    // NV-QE-COT-CAPTURE-FAIL-001: stamp the failure so the quality envelope can
    // scale CoT off for a *completed* answer instead of HTTP 500 after the swarm
    // has already been billed. Do NOT set __queenCotApplied — that would claim
    // reasoning that never parsed.
    ext.__queenCotCaptureFailed = true;
    ext.__queenCotCaptureError = error instanceof Error ? error.message : String(error);
    logger.warn('[Queen] CoT capture failed (non-fatal)', {
      error: ext.__queenCotCaptureError,
    });
    return false;
  }
}

const MW_STATUS_TO_VERDICT = {
  pass: 'allow',
  review: 'review',
  reject: 'block',
} as const;

/** Map middleware post.verdict onto the request for OrchestrationResult fan-in. */
function stampSafetyVerdict(
  request: OrchestrationRequest,
  post: { verdict?: { status: 'pass' | 'review' | 'reject'; reasons: string[]; details: Record<string, unknown>; enforced: boolean; verdictId?: string }; stagesRun?: string[] },
  source: string,
): void {
  const v = post?.verdict;
  if (!v) return;
  const ext = asExt(request);
  ext.__lastSafetyVerdict = {
    verdict: MW_STATUS_TO_VERDICT[v.status],
    reason: v.reasons?.length ? v.reasons.join('; ') : undefined,
    reasons: v.reasons,
    details: v.details,
    enforced: v.enforced,
    verdictId: v.verdictId,
    source,
  };
  /* Union across ring passes rather than last-write-wins: a leaf agent and the
   * synthesizer each run their own ring, and a gate that fired on either pass
   * did genuinely run for this request. */
  if (Array.isArray(post.stagesRun) && post.stagesRun.length) {
    const merged = new Set(ext.__lastSafetyStagesRun ?? []);
    for (const s of post.stagesRun) if (s !== '__reentrant_skip__') merged.add(s);
    ext.__lastSafetyStagesRun = [...merged];
  }
}

/** Propagate Step-0 RAG + memory skip to every Queen withMiddleware call site. */
function withQueenRagSkip<T extends Record<string, unknown>>(
  base: T,
  request: OrchestrationRequest,
): T & { skipRag: boolean; skipMemory: boolean; failOpenSafety: boolean } {
  const meta = (request as { metadata?: { partnerSyncLean?: boolean } }).metadata;
  return {
    ...base,
    skipRag: !!asExt(request).ragAlreadyApplied,
    skipMemory: !!asExt(request).memoryAlreadyApplied,
    failOpenSafety: meta?.partnerSyncLean === true,
  };
}

/**
 * Runtime guard for the orchestrationId invariant.
 *
 * `orchestrate()` MUST stamp `request.orchestrationId` at entry — span tags
 * and structured logs key off it for cross-cut observability and audit
 * correlation.
 *
 * Note (Task #64): cross-request lifecycle event isolation is now
 * structural — each request carries its own `lifecycleEvents` emitter
 * (see `QueenLifecycleEmitter`) and the orchestrator emits onto THAT
 * emitter, not the singleton. The orchestrationId stamp on lifecycle
 * payloads is informational (correlation, audit), not load-bearing for
 * routing. Throwing on a missing id keeps the informational invariant
 * honest and prevents downstream span/log collisions.
 */
function requireOrchestrationId(request: OrchestrationRequest): string {
  const id = request.orchestrationId;
  if (!id) {
    throw new Error(
      '[Queen] Internal invariant violated: orchestrationId not set on request before lifecycle emit. orchestrate() must set it at entry.',
    );
  }
  return id;
}

/**
 * Subtask shape extended with the optional `assignedCapabilityId` field that
 * `bindCapabilitiesToSubtasks()` writes when a manifest capability is bound.
 * Avoids `(subtask as any).assignedCapabilityId` reads/writes everywhere.
 */
type SubtaskWithCapability = Subtask & { assignedCapabilityId?: string };

/**
 * NYV-ORCH-MW-003 (Task #34, code-review round 2): there is NO capability-id
 * exemption allowlist. The previous "skip the safety ring for these IDs"
 * design was a governance bypass — capabilities like `safety.explainability`,
 * `compliance.consent`, `metering.usage-log`, `memory.tiered.recall`,
 * `rag.search` are reachable from `INTENT_CAPABILITY_MAP` and so could
 * become the final user-facing answer (see synthesizeResults() single-agent-
 * no-coordination path) without ever being checked.
 *
 * Instead, recursion safety is now enforced INSIDE `withMiddleware`
 * (see orchestration-middleware.ts) via an AsyncLocalStorage re-entry
 * guard: every Queen dispatch is wrapped, and any nested call back into
 * `withMiddleware` from within the safety ring becomes a no-op pass-through.
 * Middleware-internal `capabilityManifest.invoke(...)` calls don't go through
 * `withMiddleware` at all, so they are naturally cost-free.
 */

/**
 * Resolve the per-tier execution policy for a request.
 * Falls back to 'lite' when no tier hint is present.
 */
/**
 * NV-QUEEN-DEADLINE-001 — request-scoped wall-clock deadline.
 *
 * Measured defect: `NV_TIMEOUTS.orchWallClockMs` (540s) existed but nothing in
 * the Queen enforced it, and every node claimed a *fresh* `perNodeTimeoutMs`
 * (120s at enterprise tier). A swarm therefore burned 3 × 120s of billable
 * generation before failing, producing a 264s request whose nodes all timed out
 * — we paid for six completions and shipped a degraded answer.
 *
 * Recording the start once lets each node's budget be the MINIMUM of the tier
 * cap and the time actually left, so total wall time is bounded by the request
 * deadline instead of `nodes × perNodeTimeout`.
 */
const queenDeadlines = new WeakMap<object, number>();

function startQueenDeadline(request: OrchestrationRequest, startedAt: number): number {
  // Use the tier's own wall-clock budget (lite 180s / mitra 360s / enterprise
  // 540s) rather than the global cap, so a lite request cannot occupy an
  // enterprise-sized window.
  const r = asExt(request);
  const rawTier = r.tier ?? r.userTier ?? r.billingTier ?? 'lite';
  const tier = typeof rawTier === 'string' ? mapBillingTierToCapabilityTier(rawTier) : 'lite';
  const budget = Math.min(getPolicyForTier(tier).wallClockMs, NV_TIMEOUTS.orchWallClockMs);
  const deadline = startedAt + budget;
  queenDeadlines.set(request as object, deadline);
  return deadline;
}

function queenTimeRemainingMs(request: OrchestrationRequest): number | undefined {
  const deadline = queenDeadlines.get(request as object);
  if (deadline === undefined) return undefined;
  return Math.max(0, deadline - Date.now());
}

function resolveRequestPolicy(request: OrchestrationRequest): { tier: CapabilityTier; policy: ExecutionPolicy } {
  const r = asExt(request);
  const rawTier = r.tier ?? r.userTier ?? r.billingTier ?? 'lite';
  const tier = typeof rawTier === 'string' ? mapBillingTierToCapabilityTier(rawTier) : 'lite';
  const base = getPolicyForTier(tier);

  // NV-SME-PARALLEL-001 (2026-06-18): allow a caller to raise the per-node wall
  // budget for this one request. SME Legal Chat runs `parallel` mode where each
  // independent specialist agent may do an Opus synthesis + maker-checker pass;
  // under the current OpenRouter/free-model fallbacks a single node can exceed
  // the default enterprise 90s cap and get cut. Honouring a bounded override
  // (clamped to 600s, never below the tier default) lets parallel fan-out
  // complete without prematurely failing slow-but-healthy nodes. Other callers
  // are unaffected — the override only applies when metadata.perNodeTimeoutMs is set.
  const overrideRaw = (request as unknown as { metadata?: { perNodeTimeoutMs?: number } })
    .metadata?.perNodeTimeoutMs;
  const override = typeof overrideRaw === 'number' ? overrideRaw : Number(overrideRaw);
  const withOverride = Number.isFinite(override) && override > base.perNodeTimeoutMs
    ? { ...base, perNodeTimeoutMs: Math.min(override, 600_000) }
    : base;

  // NV-QUEEN-DEADLINE-001 — never hand a node more time than the request has
  // left. Without this, N nodes each waited the full tier cap and the request
  // ran for N × perNodeTimeout while billing for every timed-out generation.
  const remaining = queenTimeRemainingMs(request);
  if (remaining !== undefined && remaining < withOverride.perNodeTimeoutMs) {
    // Keep a small floor so a nearly-exhausted budget fails fast and cleanly
    // rather than issuing a call that is certain to be cut mid-generation.
    const clamped = Math.max(5_000, remaining);
    return { tier, policy: { ...withOverride, perNodeTimeoutMs: clamped } };
  }
  return { tier, policy: withOverride };
}

/**
 * Manifest-driven candidate-capability discovery.
 * Returns capability ids that are:
 *   - tier-permitted, jurisdiction-permitted (uses precedence-resolved jurisdiction)
 *   - tagged with at least one keyword from the prompt analysis
 *   - (optionally) constrained to the skills allowlist when one is provided
 */
/** Core capabilities that ADaPT/HTA/SIMPLE decomposer intents must always bind. */
export const QUEEN_CORE_CAPABILITY_IDS: readonly string[] = [
  'agent.auto-select',
  'rag.search',
  'memory.tiered.recall',
  'safety.hallucination-check',
  'safety.bias-check',
  'safety.citation-verify',
] as const;

/**
 * Discover candidate capabilities for Queen decomposition.
 * Always unions QUEEN_CORE_CAPABILITY_IDS so INTENT_CAPABILITY_MAP bindings for
 * domain_specific / quality_check / initial_attempt never miss in production.
 */
export function discoverCandidateCapabilities(opts: {
  tier: CapabilityTier;
  jurisdiction: string;
  keywords: string[];
  intent: string;
  domains: string[];
  skillsAllowlist?: string[] | null;
}): CapabilityDescriptor[] {
  const tagSet = new Set<string>([
    ...opts.keywords.map((k) => k.toLowerCase()),
    ...opts.domains.map((d) => d.toLowerCase()),
    opts.intent?.toLowerCase?.() ?? '',
    // Legal / India prompts: keep legal retrieval tags discoverable.
    'legal', 'law', 'rag', 'agent', 'safety', 'analysis', 'research',
  ].filter(Boolean));

  const tierAndJurisdiction = capabilityManifest.list({
    tier: opts.tier,
    jurisdiction: opts.jurisdiction,
  });

  const matched = tierAndJurisdiction.filter((cap) => {
    if (tagSet.size === 0) return true;
    return cap.tags.some((t) => tagSet.has(t.toLowerCase()))
      || tagSet.has(cap.category)
      || cap.id.split('.').some((seg) => tagSet.has(seg));
  });

  // Always ensure core orchestrator leaves are present (even if keyword filter missed them).
  const byId = new Map<string, CapabilityDescriptor>();
  for (const c of matched) byId.set(c.id, c);
  for (const coreId of QUEEN_CORE_CAPABILITY_IDS) {
    if (byId.has(coreId)) continue;
    const found = tierAndJurisdiction.find((c) => c.id === coreId)
      || capabilityManifest.list({}).find((c) => c.id === coreId);
    if (found) byId.set(coreId, found);
  }

  let out = Array.from(byId.values());
  if (opts.skillsAllowlist && opts.skillsAllowlist.length > 0) {
    const allow = new Set(opts.skillsAllowlist);
    const core = new Set<string>(QUEEN_CORE_CAPABILITY_IDS);
    // Core caps stay even if skills surface omitted them (partner best-outcome).
    out = out.filter((c) => allow.has(c.id) || core.has(c.id));
  }
  return out;
}

/**
 * Resolve the v3 23-section system prompt for an agent in the current request's
 * jurisdiction context. Fail-loud in production; structured fallback in dev for
 * the 3 platform-internal agents (case-brief-generator, clause-classifier,
 * mitra-conversational) that have no v3 prompt.
 */
function resolveAgentSystemPrompt(agent: Agent, request: OrchestrationRequest): {
  prompt: string;
  jurisdiction: JurisdictionCode;
  source: 'v3-jurisdiction' | 'platform-internal-fallback';
  promptBytes: number;
} {
  // Precedence (highest first): explicit request param → user profile → tenant default → DEFAULT.
  // The agent's own `agent.jurisdiction` field is intentionally NOT used here — that field is
  // metadata about the agent, not a routing override. Letting it override user/tenant choice
  // would silently send a UK customer's request to an India-baked prompt, etc.
  const r = asExt(request);
  const inferred = inferJurisdiction({
    explicit:      r.jurisdiction ?? null,
    userProfile:   r.userJurisdiction ?? null,
    tenantDefault: r.tenantJurisdiction ?? null,
  });

  try {
    const resolved = jurisdictionPromptResolver.resolvePrompt(agent.id, inferred.jurisdiction);
    let prompt = resolved.prompt;
    // NV-LEGAL-INTEL-FORCE-001 — bake legal intelligence into every resolved agent prompt
    try {
      const rPrompt = String((request as any).prompt || (request as any).task || '');
      if (inferred.jurisdiction === 'IN' || String(inferred.jurisdiction || '').startsWith('IN')) {
        if (!prompt.includes('NV-LEGAL-INTEL-FORCE-001')) {
          prompt = `${prompt}\n\n---\nNV-LEGAL-INTEL-FORCE-001\nYou are a Jurexio legal agent. Write as a practising Indian advocate — precise, humanized, jurisdiction-correct (BNS/BNSS/BSA post–1 Jul 2024). Never invent citations. Bail applications: no surety schedules until after grant. Prefer RAG/authorities when available.`;
        }
        if (rPrompt && /\b(draft|bail|petition|research|advise)\b/i.test(rPrompt)) {
          prompt = `${prompt}\n\nTask context: apply High Court / Sessions practice patterns and BNSS court-application knowledge when relevant to: ${rPrompt.slice(0, 400)}`;
        }
      }
    } catch { /* non-fatal */ }
    return {
      prompt,
      jurisdiction: resolved.jurisdiction,
      source: 'v3-jurisdiction',
      promptBytes: Buffer.byteLength(prompt, 'utf-8'),
    };
  } catch (e: any) {
    if (!(e instanceof PromptNotFoundError)) throw e;
    // Platform-internal agents have no v3 prompt — these are by design.
    if (process.env.NODE_ENV === 'production') {
      logger.error({
        msg: 'agent has no v3 prompt in production — refusing to use empty fallback',
        agentId: agent.id,
        jurisdiction: inferred.jurisdiction,
        availableJurisdictions: e.availableJurisdictions,
      });
      throw e;
    }
    const fallback = `You are ${agent.name}, a specialized AI agent with expertise in ${agent.capabilities.join(', ')}.`;
    logger.warn({
      msg: 'agent has no v3 prompt — using minimal fallback (DEV/TEST only)',
      agentId: agent.id,
      jurisdiction: inferred.jurisdiction,
    });
    return {
      prompt: fallback,
      jurisdiction: inferred.jurisdiction,
      source: 'platform-internal-fallback',
      promptBytes: Buffer.byteLength(fallback, 'utf-8'),
    };
  }
}

interface Agent {
  id: string;
  name: string;
  capabilities: string[];
  status: string;
  tier?: string;
  category?: string;
  romaLevel?: string;
  practiceArea?: string;
  preferredModels?: string[];
  fallbackModels?: string[];
  securityLevel?: string;
  jurisdiction?: string;
  description?: string;
  protocols?: string[];
  systemPrompt?: string;
  /** Registry tools[] — mapped to capability leaves via nv-agent-tool-bridge. */
  tools?: string[];
  /** Registry mcpToolsAllowed — partner/MCP allowlist (execution via bridge). */
  mcpToolsAllowed?: string[];
  preferredTools?: string[];
}

class ConsolidatedAgentRegistry {
  private agents: Agent[] = [];
  private initialized = false;

  async waitForReady(): Promise<void> {
    if (this.initialized) return;
    await this.loadAllAgents();
  }

  private async loadAllAgents(): Promise<void> {
    try {
      this.agents = getRegistryAgents().map(agent => this.normalizeAgent(agent));
      logger.info(
        `QueenOrchestrator: v5.1.0 registry loaded — ${this.agents.length} active agents (Default + primary overlay)`,
      );

      this.initialized = true;
    } catch (error: any) {
      logger.error('QueenOrchestrator: Failed to load agent registry:', error.message);
      this.initialized = true;
    }
  }

  private normalizeAgent(raw: any): Agent {
    const id = raw.id || 'unknown';
    const module = raw.module || raw.category || 'general';
    const jurisdictions: string[] = [];
    if (raw.jurisdictionScope?.primary) jurisdictions.push(...raw.jurisdictionScope.primary);
    if (raw.jurisdictionActivation?.primary) jurisdictions.push(String(raw.jurisdictionActivation.primary));
    const displayName = raw.name || id.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const capabilitySet = new Set<string>([
      ...(raw.capabilities || [module, 'legal-analysis', 'compliance']),
      ...getBoundCapabilitiesForAgent(id),
    ]);

    const asStringList = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

    return {
      id,
      name: displayName,
      capabilities: Array.from(capabilitySet),
      status: 'active',
      tier: raw.tier,
      category: module,
      romaLevel: raw.romaLevel,
      practiceArea: raw.practiceArea || module,
      preferredModels: raw.preferredModels || ['gpt-4o'],
      fallbackModels: raw.fallbackModels || ['gpt-4o-mini'],
      securityLevel: raw.securityLevel || 'standard',
      jurisdiction: raw.jurisdiction || jurisdictions[0] || 'India',
      description: raw.description || `${displayName} — ROMA ${raw.romaLevel || 'L5'} (${raw.tier} tier)`,
      protocols: raw.protocols || ['MCP', 'A2A', 'AG-UI'],
      systemPrompt: raw.systemPrompt || `You are ${displayName}, a ROMA ${raw.romaLevel || 'L5'} legal AI agent specialised in ${module}.`,
      tools: asStringList(raw.tools),
      mcpToolsAllowed: asStringList(raw.mcpToolsAllowed),
      preferredTools: asStringList(raw.preferredTools),
    };
  }

  getStats(): { totalAgents: number; protocols: string[]; tiers: Record<string, number>; practiceAreas: string[] } {
    const tiers: Record<string, number> = {};
    const practiceAreas = new Set<string>();
    for (const a of this.agents) {
      if (a.tier) tiers[a.tier] = (tiers[a.tier] || 0) + 1;
      if (a.practiceArea) practiceAreas.add(a.practiceArea);
    }
    return {
      totalAgents: this.agents.length,
      protocols: ['A2A', 'MCP', 'AG-UI', 'ROMA', 'Parlant', 'BMAD'],
      tiers,
      practiceAreas: Array.from(practiceAreas),
    };
  }

  getAgentsByCapability(cap: string): Agent[] {
    const capLower = cap.toLowerCase();
    return this.agents.filter(a =>
      a.status === 'active' &&
      a.capabilities.some(c => c.toLowerCase().includes(capLower))
    );
  }

  getAgent(id: string): Agent | undefined {
    const resolved = resolveRegistryAgentId(id) || id;
    return this.agents.find(a => a.id === resolved);
  }

  getAllAgents(): Agent[] {
    return this.agents.filter(a => a.status === 'active');
  }

  getAgentsByJurisdiction(jurisdiction: string): Agent[] {
    const jurisLower = jurisdiction.toLowerCase();
    return this.agents.filter(a =>
      a.jurisdiction?.toLowerCase().includes(jurisLower)
    );
  }

  getAgentsByTier(tier: string): Agent[] {
    return this.agents.filter(a => a.tier === tier);
  }
}

function remapPreferredToBedrockIfPolicy(modelId: string, role: 'exploration' | 'synthesis' = 'synthesis'): string {
  const id = String(modelId || '').trim();
  if (!id) return id;
  if (isPartnerLegalPremiumFirst() || !isBedrockFirstPolicy()) return id;
  const upgraded = remapQueenPreferredForClaude55(id, role);
  if (upgraded !== id) return upgraded;
  if (id === 'claude-sonnet-4-6' || id === 'anthropic/claude-sonnet-4-6' || id === 'anthropic.claude-sonnet-5') {
    return 'global.anthropic.claude-sonnet-5';
  }
  if (
    id === 'claude-opus-5'
    || id === 'anthropic.claude-opus-5'
    || id === 'global.anthropic.claude-opus-5'
    || id === 'anthropic/claude-opus-5'
  ) {
    return 'us.anthropic.claude-opus-5';
  }
  if (id === 'claude-opus-4-8' || id === 'anthropic/claude-opus-4-8') {
    return 'global.anthropic.claude-opus-4-8';
  }
  if (id === 'claude-opus-4-7' || id === 'anthropic/claude-opus-4-7') {
    return 'global.anthropic.claude-opus-4-7';
  }
  if (id === 'claude-opus-4-6' || id === 'anthropic/claude-opus-4-6') {
    return 'global.anthropic.claude-opus-4-6-v1';
  }
  if (id === 'claude-haiku-4-5' || (id.includes('claude-haiku-4-5') && !id.startsWith('global.') && !id.startsWith('us.'))) {
    return 'global.anthropic.claude-haiku-4-5-20251001-v1:0';
  }
  if (id === 'claude-haiku-5-5' || id.includes('claude-haiku-5-5')) {
    return 'global.anthropic.claude-haiku-5-5';
  }
  if (id === 'claude-sonnet-5-5' || id.includes('claude-sonnet-5-5')) {
    return 'global.anthropic.claude-sonnet-5-5';
  }
  if (id === 'claude-opus-5-5' || id.includes('claude-opus-5-5')) {
    return 'us.anthropic.claude-opus-5-5';
  }
  return id;
}

function toPreferredModelRouting(modelId: string): { provider: string; model: string } {
  const id = String(modelId || '').trim();
  if (!id) return { provider: 'openrouter', model: 'agentzero' };

  // OpenRouter-style provider/model (and OmniRoute ids).
  if (id.includes('/')) {
    const [provider, ...rest] = id.split('/');
    return { provider, model: rest.join('/') };
  }

  // AWS Bedrock native / inference-profile ids — never stamp as openrouter.
  if (
    id.startsWith('deepseek.') ||
    id.startsWith('qwen.') ||
    id.startsWith('mistral.') ||
    id.startsWith('moonshot.') ||
    id.startsWith('moonshotai.') ||
    id.startsWith('zai.') ||
    id.startsWith('meta.') ||
    id.startsWith('amazon.') ||
    id.startsWith('google.gemma') ||
    id.startsWith('apac.') ||
    id.startsWith('global.') ||
    id.startsWith('us.') ||
    id.startsWith('eu.') ||
    id.includes('nova-')
  ) {
    return { provider: 'bedrock', model: id };
  }

  // Direct provider keys (premium partner path) — catalog SSoT uses these providers.
  if (id.startsWith('claude-')) return { provider: 'anthropic', model: id };
  if (id.startsWith('gemini-')) return { provider: 'google', model: id };
  if (id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) {
    return { provider: 'openai', model: id };
  }
  if (id === 'agentzero' || id.startsWith('sarvam')) {
    return { provider: id.startsWith('sarvam') ? 'sarvam' : 'agentzero', model: id };
  }
  return { provider: 'openrouter', model: id };
}

/**
 * NV-QUEEN-LEAF-TIER-001 — leaf vs synthesis role.
 *
 * Measured defect (`scripts/_ec2-swarm-fail-rca.sh`, SSM `d9d3ffc5`): every
 * Queen leaf declared `complexity:'complex'`, `qualityLevel:'professional'` and
 * asked for 16,384 output tokens, so three *throwaway* swarm-exploration leaves
 * each ran `gemini-3-1-pro-preview` for 24–58 s and then blew the 120 s per-node
 * budget. Sum of completion latencies for one request: **249 s across 6 calls**,
 * all three exploration nodes failing with `policy: per-node timeout`.
 *
 * Exploration leaves produce intermediate notes that a synthesis node rewrites —
 * their output is never shown to the user verbatim. They therefore do not need a
 * frontier model, professional quality level, or a 16 k output window. Synthesis
 * and aggregation nodes DO: they author what the user reads.
 *
 * Classification lives in `nv-queen-node-role.ts` so it is unit-testable without
 * booting the agent graph. This is the plan's §8.5 leaf/synthesis split, applied
 * at the one place that actually dispatches a model.
 */
async function resolveAgentModelRouting(
  prompt: string,
  agent: Agent,
  role: QueenNodeRole = 'synthesis',
  jurisdiction?: string,
): Promise<{
  provider: string;
  model: string;
  reason: string;
}> {
  const { selectModel } = await import('../services/cost-aware-router.js');
  const scored = selectModel(prompt, {
    domain: agent.category?.toLowerCase() || 'legal',
    jurisdiction: jurisdiction || 'IN',
    // Exploration notes get a tenth of the synthesis budget. `maxBudgetUSD` is a
    // HARD filter in the scorer, so this genuinely excludes frontier models from
    // intermediate leaves rather than merely nudging them down the ranking.
    maxBudgetUSD: role === 'exploration' ? 0.005 : 0.05,
    // Exploration writes short notes; synthesis authors the user-visible answer.
    // Declaring this honestly keeps context-fit and cost scoring truthful.
    expectedOutputTokens: role === 'exploration' ? 2_048 : 8_192,
  });

  // NYV_IGNORE_REGISTRY_PREFERRED_MODELS=1 → Bedrock-first / policy cascade only
  // (use when rolling back preferredModels stamps without swapping registry files).
  const ignorePreferred = /^(1|true|yes|on)$/i.test(
    String(process.env.NYV_IGNORE_REGISTRY_PREFERRED_MODELS || ''),
  );
  if (ignorePreferred) {
    return {
      provider: scored.provider,
      model: scored.model,
      reason: 'NYV_IGNORE_REGISTRY_PREFERRED_MODELS + scored pick',
    };
  }

  const preferred = (agent.preferredModels || []).map(String);
  const firstPreferred = preferred[0];
  const roma = String(agent.romaLevel || 'L2').toUpperCase();

  const opusPreferred = preferred.find(model => model.toLowerCase().includes('opus'));
  const budgetPreferred = preferred.find(
    model => model.toLowerCase().includes('haiku') || model.toLowerCase().includes('mini'),
  );

  // NV-QUEEN-LEAF-TIER-001: an exploration leaf never escalates to the agent's
  // premium `preferredModels`. Its output is intermediate notes, so take the
  // scored pick — which already filtered on availability, health, budget and
  // task fit — instead of a registry stamp meant for user-visible output.
  if (role === 'exploration') {
    return {
      provider: scored.provider,
      model: scored.model,
      reason: `exploration leaf → scored pick (NV-QUEEN-LEAF-TIER-001; ${scored.reason})`,
    };
  }

  if (roma === 'L5' && opusPreferred) {
    return { ...toPreferredModelRouting(remapPreferredToBedrockIfPolicy(opusPreferred, role)), reason: 'ROMA L5 preferred opus model' };
  }
  if (roma === 'L1' && budgetPreferred) {
    return { ...toPreferredModelRouting(remapPreferredToBedrockIfPolicy(budgetPreferred, role)), reason: 'ROMA L1 preferred budget model' };
  }
  if ((roma === 'L2' || roma === 'L3' || roma === 'L4') && firstPreferred) {
    return { ...toPreferredModelRouting(remapPreferredToBedrockIfPolicy(firstPreferred, role)), reason: `ROMA ${roma} preferred model` };
  }

  return {
    provider: scored.provider,
    model: scored.model,
    reason: scored.reason,
  };
}

const agentRegistry = new ConsolidatedAgentRegistry();

// ================================================================================================
// TYPE DEFINITIONS
// ================================================================================================

export interface OrchestrationRequest {
  prompt: string;
  /**
   * NV-REQID-CORRELATION-001: the caller's correlation id. Propagated to every
   * leaf dispatch so per-request fan-out is measurable rather than inferred
   * from a log time window.
   */
  requestId?: string;
  type: 'code' | 'research' | 'creative' | 'analysis' | 'general';
  orchestrationMode?: 'single_agent' | 'sequential' | 'parallel' | 'dag' | 'swarm' | 'hierarchical';
  language?: string;
  userId?: string;
  sessionId?: string;
  jurisdiction?: string;
  taskType?: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  enableCoT?: boolean;
  cotStrategy?: string;
  /**
   * NYV-ORCH-EVENT-CORRELATION-002 (Task #37): per-run correlation id
   * stamped on every Queen lifecycle event payload, span tag and
   * structured log line. Set by `orchestrate()` at entry; callers that
   * need the id known up-front may pre-pin it here.
   *
   * Task #64: with per-request lifecycle emitters this id is now
   * informational (correlation, audit, observability) rather than
   * load-bearing for routing — events fan out on `lifecycleEvents`, which
   * is itself private to the request, so cross-request leakage is
   * structurally impossible regardless of what id (or no id) appears on
   * any individual payload.
   */
  orchestrationId?: string;
  /**
   * NYV-ORCH-PER-REQUEST-EMITTER-001 (Task #64): per-request lifecycle
   * event sink. The orchestrator emits `decomposition_complete`,
   * `agent_started`, `agent_completed`, `agent_failed`, `synthesis_started`,
   * and `synthesis_complete` onto THIS emitter — never onto the singleton
   * QueenOrchestrator EventEmitter. Each call to `orchestrate()` owns its
   * own emitter (a caller may pre-create one to subscribe before
   * orchestration starts; otherwise the orchestrator instantiates a fresh
   * one at entry). Listeners attached here are GC'd with the request,
   * eliminating the unbounded listener growth that the prior shared-
   * emitter design caused under load.
   */
  lifecycleEvents?: QueenLifecycleEmitter;
  /**
   * NYV-OBS-TENANT-FIELDS-001 (Task #28 round 7): tenant + tier are
   * first-class on the request so route handlers can plumb them
   * through without `as any` casts. The Queen tags every span with
   * tenantId so per-tenant latency aggregation works end-to-end.
   */
  tenantId?: string;
  tier?: string;
  /**
   * Output coordination — applied uniformly across all subtasks AND the final
   * synthesis. The format controls structure (markdown / json / narrative /
   * structured) and language controls the natural language of the response.
   * Both are passed through to buildAgentPrompt and synthesizeWithLLM so the
   * single-source-of-truth output shape is enforced.
   */
  format?: 'markdown' | 'json' | 'narrative' | 'structured';
  preferences?: {
    costOptimization?: boolean;
    qualityPriority?: boolean;
    speedPriority?: boolean;
    maxAgents?: number;
    outputFormat?: 'markdown' | 'json' | 'narrative' | 'structured' | string;
  };
  context?: {
    previousMessages?: Array<{ role: string; content: string }>;
    sessionMemory?: Record<string, any>;
    userPreferences?: Record<string, any>;
  };
  /** AdaptiveRouter / partner flags (queenDepth, adaptiveComplexity, …). */
  metadata?: Record<string, unknown>;
}

export interface Subtask {
  id: string;
  type: string;
  description: string;
  dependencies: string[];
  priority: number;
  estimatedComplexity: 'simple' | 'moderate' | 'complex';
  requiredCapabilities: string[];
  assignedAgent?: Agent;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: any;
}

export interface TaskDecomposition {
  originalPrompt: string;
  analyzedIntent: string;
  taskType: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
  subtasks: Subtask[];
  orchestrationPattern: 'single_agent' | 'sequential' | 'parallel' | 'dag' | 'swarm' | 'hierarchical';
  estimatedAgents: number;
  estimatedTime: number;
  decompositionAlgorithm: string;
  metadata?: Record<string, any>;
}

export interface AgentExecution {
  agentId: string;
  agentName: string;
  subtaskId: string;
  startTime: number;
  endTime?: number;
  status: 'running' | 'completed' | 'failed';
  output?: any;
  tokens?: { input: number; output: number };
  cost?: number;
  model?: string;
  /**
   * NYV-ORCH-CACHE-001 (Task #38): true when the agent answer was served
   * from the LLM prompt cache (lmCacheService) rather than a fresh LLM
   * call. Synthesis still consumes `output` the same way; this flag is
   * surfaced for observability + the orchestration-level cacheHits tally.
   */
  cacheHit?: boolean;
}

export interface OrchestrationResult {
  success: boolean;
  taskDecomposition: TaskDecomposition;
  executions: AgentExecution[];
  synthesizedOutput: string;
  /**
   * NYV-ORCH-SAFETY-VERDICT-001: mapped safety outcome from the last
   * user-facing middleware pass (agent dispatch and/or synthesis).
   * Consumers (legal-chat SSE, partner /orchestrate) must honour `block`.
   */
  safetyVerdict?: OrchestrationSafetyVerdict;
  metadata: {
    totalTime: number;
    totalTokens: { input: number; output: number };
    totalCost: number;
    agentsUsed: number;
    orchestrationPattern: string;
    queenCotApplied?: boolean;
    /** NV-QE-COT-CAPTURE-FAIL-001 — CoT was attempted and threw. */
    queenCotCaptureFailed?: boolean;
    queenCotCaptureError?: string;
    /** NV-COMPLETION-DRIVEN-001 */
    queenCotSkippedProgression?: boolean;
    requestPhase?: RequestPhase;
    optionalDegraded?: boolean;
    /** Stable id for the whole Queen run (span tags + AG-UI filter + partners). */
    orchestrationId?: string;
    /** NV-CTX-ENG-QUEEN-001 — applied context-engineering stats (fail-soft). */
    contextEngineering?: unknown;
    /**
     * NYV-ORCH-CACHE-001 (Task #38): number of per-agent dispatches in this
     * orchestration that were served from the prompt cache instead of the
     * LLM. Always present (0 when the cache returned no hits).
     */
    cacheHits: number;
    /**
     * NYV-A5-VERBALISE-001: post-synthesis calibrated confidence statement
     * produced by the verbalised-sampling service. Present only when the
     * caller opted in (priority high|critical OR metadata.verbalize===true).
     * Pure post-processing; never mutates `synthesizedOutput`. Shape mirrors
     * `VerbalizedProbability` from `verbalized-sampling-service.ts`.
     */
    verbalizedConfidence?: unknown;
  };
}

export interface CollectiveIntelligenceMode {
  mode: 'brainstorm' | 'consensus' | 'vote' | 'debate' | 'synthesis';
  participants: Agent[];
  topic: string;
  rounds: number;
}

// ================================================================================================
// QUEEN LIFECYCLE EVENT PAYLOADS (NYV-ORCH-EVENT-CORRELATION-002, Task #37)
// ================================================================================================
// Each payload REQUIRES `orchestrationId: string` so the AG-UI listener filter
// (which keys on `payload.orchestrationId === myOrchestrationId`) cannot be
// silently broken by a future lifecycle emit that forgets to stamp the id.
// Forgetting the stamp would re-introduce the cross-request data leak that
// listener filtering exists to prevent.

export interface QueenDecompositionCompleteEvent {
  orchestrationId: string;
  algorithm: string;
  pattern: TaskDecomposition['orchestrationPattern'];
  complexity: TaskDecomposition['complexity'];
  subtaskCount: number;
  subtasks: Array<{
    id: string;
    type: string;
    description: string;
    assignedAgent?: string;
    complexity: Subtask['estimatedComplexity'];
  }>;
}

export interface QueenAgentStartedEvent {
  orchestrationId: string;
  subtaskId: string;
  subtaskType: string;
  agentId: string;
  agentName: string;
  agentTier?: string;
  romaLevel?: string | number;
  description: string;
}

export interface QueenAgentCompletedEvent {
  orchestrationId: string;
  subtaskId: string;
  agentId: string;
  agentName: string;
  durationMs: number;
  outputPreview: string;
  outputLength: number;
  via: 'manifest' | 'llm' | 'cache';
  model?: string;
  capability?: string;
}

export interface QueenAgentFailedEvent {
  orchestrationId: string;
  subtaskId: string;
  agentId: string;
  agentName: string;
  error: string;
  durationMs: number;
}

export interface QueenSynthesisStartedEvent {
  orchestrationId: string;
  agentCount: number;
  failedCount: number;
  format: string;
  language: string;
}

export interface QueenSynthesisTokenEvent {
  orchestrationId: string;
  delta: string;
  /** Running text so far (provisional until post-safety gate). */
  accumulated: string;
  /** true while streaming pre-gate; false after middleware safety verdict. */
  provisional?: boolean;
}

export interface QueenSynthesisFinalEvent {
  orchestrationId: string;
  /** Post-safety-gate final text (authoritative for clients). */
  content: string;
  provisional: false;
  length: number;
}

export interface QueenSynthesisCompleteEvent {
  orchestrationId: string;
  length: number;
  format: string;
  language: string;
}

export interface QueenLifecycleEventMap {
  decomposition_complete: QueenDecompositionCompleteEvent;
  agent_started: QueenAgentStartedEvent;
  agent_completed: QueenAgentCompletedEvent;
  agent_failed: QueenAgentFailedEvent;
  synthesis_started: QueenSynthesisStartedEvent;
  synthesis_token: QueenSynthesisTokenEvent;
  /** NV-QUEEN-SSE-002 — emitted after stampSafetyVerdict (stream-after-gate parity). */
  synthesis_final: QueenSynthesisFinalEvent;
  synthesis_complete: QueenSynthesisCompleteEvent;
}

// ================================================================================================
// PER-REQUEST LIFECYCLE EMITTER (NYV-ORCH-PER-REQUEST-EMITTER-001, Task #64)
// ================================================================================================
//
// Earlier rounds (Tasks #27 / #36 / #37) routed every Queen lifecycle event
// through the singleton `QueenOrchestrator` EventEmitter and relied on every
// emit stamping `orchestrationId` plus every listener filtering on it. That
// works, but the entire cross-request isolation guarantee was one forgotten
// stamp away from re-leaking, and every active stream added 6 listeners to
// a global emitter (Node MaxListeners + unbounded memory under load).
//
// `QueenLifecycleEmitter` is a thin, typed EventEmitter whose lifetime is
// scoped to a single `orchestrate()` call. The AG-UI route (and any other
// caller that wants progress events) constructs one, subscribes its
// listeners directly on it, and passes it via `OrchestrationRequest.
// lifecycleEvents`. The orchestrator emits onto THAT emitter — never onto
// the singleton — so two concurrent requests are architecturally incapable
// of seeing each other's events, with or without an id stamp.
//
// The base `queenOrchestrator` singleton still exists and still inherits
// EventEmitter for the non-lifecycle `orchestration_complete` broadcast
// (consumed by sdk-webhook-listener). That signal is intentionally global
// — it announces "any orchestration somewhere finished" and does not
// carry per-user content.

// Node's EventEmitter typings declare `listener` as `(...args: any[]) => void`.
// To keep this file free of `any`, we describe the same callable shape using
// `unknown[]` and bridge through it. The bridge is a *type* coercion only —
// the runtime function reference is preserved unchanged, so calling `off()`
// with the original listener still works (this is critical: a wrapping
// closure would create a new reference and silently break removal).
type LifecycleListenerBridge = (...args: readonly unknown[]) => void;

export class QueenLifecycleEmitter extends EventEmitter {
  // Override `emit` / `on` / `off` / `once` with typed signatures keyed off
  // `QueenLifecycleEventMap`. The base method semantics are unchanged — we
  // only narrow the type surface so a future emit/listener with the wrong
  // event name or payload shape fails to compile.
  override emit<K extends keyof QueenLifecycleEventMap>(
    event: K,
    payload: QueenLifecycleEventMap[K],
  ): boolean {
    return super.emit(event, payload);
  }
  override on<K extends keyof QueenLifecycleEventMap>(
    event: K,
    listener: (payload: QueenLifecycleEventMap[K]) => void,
  ): this {
    return super.on(event, listener as unknown as LifecycleListenerBridge);
  }
  override off<K extends keyof QueenLifecycleEventMap>(
    event: K,
    listener: (payload: QueenLifecycleEventMap[K]) => void,
  ): this {
    return super.off(event, listener as unknown as LifecycleListenerBridge);
  }
  override once<K extends keyof QueenLifecycleEventMap>(
    event: K,
    listener: (payload: QueenLifecycleEventMap[K]) => void,
  ): this {
    return super.once(event, listener as unknown as LifecycleListenerBridge);
  }
}

// ================================================================================================
// QUEEN ORCHESTRATOR
// ================================================================================================

/** Coerce prompt/pattern hints to a string[] — pattern dispatch may emit a capability id string. */
function normalizePatternCapabilityHints(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
  }
  if (typeof raw === 'string' && raw.length > 0) return [raw];
  return [];
}

export class QueenOrchestrator extends EventEmitter {
  private static instance: QueenOrchestrator;
  private isInitialized: boolean = false;

  private constructor() {
    super();
    logger.info('👑 QueenOrchestrator instance created');
  }

  public static getInstance(): QueenOrchestrator {
    if (!QueenOrchestrator.instance) {
      QueenOrchestrator.instance = new QueenOrchestrator();
    }
    return QueenOrchestrator.instance;
  }

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;

    logger.info('👑 Initializing QueenOrchestrator...');
    
    await agentRegistry.waitForReady();
    
    const stats = agentRegistry.getStats();
    logger.info(`   📊 Connected to ${stats.totalAgents} agents across ${stats.practiceAreas.length} practice areas`);
    logger.info(`   🏗️  Tiers: ${Object.entries(stats.tiers).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    logger.info(`   🔗 Protocols: ${stats.protocols.join(', ')}`);
    
    this.isInitialized = true;
    logger.info('✅ QueenOrchestrator initialized with real agent registry');
  }

  // ================================================================================================
  // TYPED LIFECYCLE EVENT API (NYV-ORCH-PER-REQUEST-EMITTER-001, Task #64)
  // ================================================================================================
  //
  // All internal lifecycle emits go through `emitLifecycle(request, …)`.
  // The emitter is the per-request `request.lifecycleEvents` (created at
  // `orchestrate()` entry if the caller did not provide one) — NOT the
  // singleton `QueenOrchestrator` EventEmitter. Two simultaneous
  // `orchestrate()` calls have completely disjoint emitters and listeners,
  // so cross-request event leakage is structurally impossible.
  //
  // Subscribers no longer attach to the singleton: they construct a
  // `QueenLifecycleEmitter`, attach listeners to it directly, and pass it
  // via `request.lifecycleEvents` before calling `orchestrate()`. See
  // `nv-agui-stream-routes.ts` for the canonical pattern.
  //
  // The base `emit` / `on` are still inherited for the non-lifecycle
  // `orchestration_complete` broadcast (consumed by sdk-webhook-listener),
  // which is intentionally global — it carries no per-user content.

  protected emitLifecycle<K extends keyof QueenLifecycleEventMap>(
    request: OrchestrationRequest,
    event: K,
    payload: QueenLifecycleEventMap[K],
  ): boolean {
    const emitter = request.lifecycleEvents;
    if (!emitter) {
      // orchestrate() must populate `lifecycleEvents` at entry; if we are
      // emitting before that runs, it is a programmer error.
      throw new Error(
        `[Queen] Internal invariant violated: emitLifecycle('${String(event)}') called before request.lifecycleEvents was populated. orchestrate() must initialise it at entry.`,
      );
    }
    return emitter.emit(event, payload);
  }

  // ================================================================================================
  // MAIN ORCHESTRATION ENTRY POINT
  // ================================================================================================

  /**
   * Main orchestration method - receives user prompt and delivers intelligent output
   */
  public async orchestrate(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const startTime = Date.now();
    // NV-QUEEN-DEADLINE-001 — arm the request-level wall clock before any fan-out
    // so per-node budgets shrink as the request ages instead of each node
    // claiming a fresh tier cap.
    startQueenDeadline(request, startTime);
    // NYV-ORCH-EVENT-CORRELATION-001 (Task #27, post-architect): every Queen
    // run gets a unique orchestrationId attached to ALL lifecycle event
    // payloads, span tags and structured log lines for cross-cut audit and
    // observability. Honour an externally-provided id; otherwise mint a
    // fresh one.
    // NV-REQID-CORRELATION-001: prefer the caller's correlation id so the
    // Queen's existing orchestrationId invariant doubles as the join key
    // between the API response and every downstream provider log line.
    const orchestrationId: string =
      request.orchestrationId ??
      (request.requestId ? `orch-${request.requestId}` : undefined) ??
      `orch-${startTime.toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    request.orchestrationId = orchestrationId;
    setRequestPhase(asExt(request), 'accepted');
    // NYV-ORCH-PER-REQUEST-EMITTER-001 (Task #64): every run owns a
    // private lifecycle emitter. Callers (e.g. AG-UI route) that need to
    // subscribe before orchestration starts pre-create one and pass it on
    // the request; everyone else gets a freshly-minted emitter that is
    // GC'd with the request when this method returns. Either way,
    // `emitLifecycle()` writes ONLY to this per-request sink — never to
    // the singleton — so two concurrent orchestrate() calls cannot see
    // each other's events.
    if (!request.lifecycleEvents) {
      request.lifecycleEvents = new QueenLifecycleEmitter();
    }
    // NYV-ORCH-CACHE-001 (Task #38): zero the per-run cache-hit counter at
    // entry so a request object reused across multiple orchestrate() calls
    // (e.g. retries, A/B fan-out) reports a clean tally per run.
    asExt(request).__cacheHits = 0;
    logger.info(`\n👑 ========== QUEEN ORCHESTRATION START [${orchestrationId}] ==========`);
    logger.info(`📝 Prompt: ${request.prompt.substring(0, 100)}...`);
    logger.info(`🏷️  Type: ${request.type}`);

    // NYV-OBS-QUEEN-SPAN-001 (Task #28): root span for the whole run.
    // Every child phase span (rag, decompose, execute, synthesis) is
    // attached via { parent: rootSpan }. Tag set is intentionally
    // small + searchable so we can group "p95 by jurisdiction" easily.
    // NYV-OBS-TENANT-CORRELATION-001 (Task #28 round 4): include tenantId
    // on every Queen span so cross-tenant queries on Sentry/CloudWatch
    // ("p95 by tenant") work without joining a separate index. tenantId is
    // optional on the request — fall back to 'unknown' so the tag is
    // always present for grouping.
    const _reqExt = request as OrchRequestExt;
    const _tenantId = _reqExt.tenantId ?? 'unknown';
    // NYV-ORCH-MEM-003 (Task #27 round 2): normalize sessionId/userId from
    // BOTH top-level and request.metadata. Caller paths differ —
    // nv-legal-chat-routes.ts passes sessionId via `metadata.sessionId`,
    // nv-agui-stream-routes.ts passes it top-level, and other orchestrate
    // callers may use either. Without this normalization the recall/remember
    // hooks below silently no-op for the legal-chat path. memSessionId /
    // memUserId are the single source of truth for memory wiring below.
    const _reqMeta = (request as { metadata?: { sessionId?: unknown; userId?: unknown } }).metadata
      ?? {};
    const memSessionId =
      (typeof request.sessionId === 'string' && request.sessionId) ||
      (typeof _reqMeta.sessionId === 'string' && _reqMeta.sessionId) ||
      undefined;
    const memUserId =
      (typeof _reqExt.userId === 'string' && _reqExt.userId) ||
      (typeof _reqMeta.userId === 'string' && _reqMeta.userId) ||
      undefined;
    const rootSpan = startSpan('queen.orchestrate', {
      op: 'queen.orchestrate',
      tags: {
        orchestrationId,
        tenantId: _tenantId,
        jurisdiction: _reqExt.jurisdiction ?? 'IN',
        tier: _reqExt.tier ?? _reqExt.userTier ?? 'lite',
        type: request.type,
        userId: _reqExt.userId,
      },
    });

    // CRITICAL: lazy-init the consolidated agent registry on first call. Without
    // this the BM25 corpus loads with 0 agents, every subtask gets "no suitable
    // agent found", and the orchestrator silently returns a 200-byte stub. The
    // method is idempotent (early-returns when isInitialized=true).
    await this.initialize();

    // NYV-OBS-SPAN-CONTEXT-001 (Task #61): install the root span in BOTH
    // ALS slots for the whole orchestration body:
    //   • runRootContext (via runWithRunRoot) → the run's pinned root,
    //     readable via getRunRootSpan() from anywhere inside, used by
    //     executeAgent() to parent queen.agent spans DIRECTLY to
    //     queen.orchestrate (preserving the original __rootSpan contract
    //     where per-agent spans skipped over the queen.execute phase
    //     wrapper and attached straight to the run root).
    //   • spanContext (via runWithSpan) → the ambient current span, used
    //     by withSpan()/startSpan() to default the parent for any other
    //     nested span that doesn't care about run-root vs ambient.
    // Both replace the untyped `request.__rootSpan` extension property,
    // which was the single point where forgetting one copy silently
    // turned per-agent spans into orphan spans on the dashboard. With
    // ALS that whole class of regression is impossible because there
    // is nothing to copy.
    return runWithRunRoot(rootSpan, () => runWithSpan(rootSpan, async () => {
    try {
      // Step 0 (NV-CTX-BUDGET-001): Memory ∥ Auto-RAG with complexity budgets.
      // Serial RAG→memory wasted wall time on simple paths and over-fetched
      // on lean turns. Budgets scale simple→tight / complex→full; each arm
      // is fail-soft + wall-clock capped via withContextTimeout.
      const metaAny = (request as { metadata?: Record<string, unknown> }).metadata ?? {};
      const step0Complexity =
        (typeof metaAny.adaptiveComplexity === 'string' && metaAny.adaptiveComplexity) ||
        (typeof metaAny.complexity === 'string' && metaAny.complexity) ||
        this.assessPromptComplexity(request.prompt).complexity;
      const partnerBest =
        metaAny.nspNymBestOutcome === true
        || metaAny.forceLegalBestOutcome === true;
      const budgets = resolveContextBudgets(
        partnerBest ? 'very_complex' : step0Complexity,
        { partnerBestOutcome: partnerBest },
      );
      logger.info('[Queen] Step-0 context budgets', {
        complexity: budgets.complexity,
        ragTopK: budgets.ragTopK,
        memoryLimit: budgets.memoryLimit,
        memorySources: budgets.memorySources,
        parallelTimeoutMs: budgets.parallelTimeoutMs,
      });

      const memTiersForFan =
        budgets.memorySources === 'session'
          ? (['session'] as const)
          : budgets.memorySources === 'session+longterm'
            ? (['session', 'longterm'] as const)
            : (['session', 'longterm', 'social'] as const);

      const ragSpan = startSpan('queen.rag', {
        parent: rootSpan,
        op: 'queen.rag',
        tags: { orchestrationId, jurisdiction: request.jurisdiction || 'IN', complexity: budgets.complexity },
      });
      /* NV-LEGALCHAT-RAG-EVENT-001 — carry the measured counts out of Step-0.
       * `chunkCount` is set ONLY when `autoRagRetrieve` returned; a timeout or a
       * thrown retrieval leaves it undefined so a downstream reporter cannot
       * present "no measurement" as "retrieved 0". */
      type RagPack = {
        contextBlock: string;
        timedOut: boolean;
        failed?: boolean;
        chunkCount?: number;
        layersUsed?: string[];
        retrievalMethods?: string[];
        intent?: string;
      };
      const ragPromise = withContextTimeout<RagPack>(
        (async (): Promise<RagPack> => {
          try {
            const reqExtRag = asExt(request);
            const { autoRagRetrieve } = await import('../services/jrx-auto-rag-router.js');
            const { tier: capTier } = resolveRequestPolicy(request);
            const autoRag = await autoRagRetrieve({
              query: request.prompt,
              jurisdiction: request.jurisdiction || 'IN',
              tier: reqExtRag.tier ?? capTier,
              taskType: request.type,
              userId: memUserId,
              tenantId: reqExtRag.tenantId,
              topK: budgets.ragTopK,
              /* NV-CITE-GROUND-001 (2026-08-19) — the Queen path passed `ragTopK`
               * but neither char cap, so `formatAutoRagContext` ran in its
               * unbounded mode here. `nv-client.ts` (the specialist path) has
               * passed both since NV-RAG-CHAR-BUDGET-001; the Queen was the
               * remaining uncapped consumer, and it is the one NSP and the
               * console take. Passing them also makes the authority roll-up
               * budget-reserved rather than unbounded on this path. */
              ragChunkCharCap: budgets.ragChunkCharCap,
              ragTotalCharCap: budgets.ragTotalCharCap,
            });
            if (autoRag.chunks.length > 0) {
              logger.info(
                `📚 Auto-RAG: ${autoRag.chunks.length} chunks via [${autoRag.layersUsed.join('+')}] intent=${autoRag.intent} topK=${budgets.ragTopK}`,
              );
              ragSpan.finish('ok', {
                chunkCount: autoRag.chunks.length,
                retrievalMethod: autoRag.retrievalMethods.join(','),
                intent: autoRag.intent,
                layers: autoRag.layersUsed.join('+'),
                topK: budgets.ragTopK,
              });
            } else {
              ragSpan.finish('ok', { chunkCount: 0, intent: autoRag.intent, topK: budgets.ragTopK });
            }
            return {
              contextBlock: autoRag.contextBlock || '',
              timedOut: false,
              chunkCount: autoRag.chunks.length,
              layersUsed: [...autoRag.layersUsed],
              retrievalMethods: [...autoRag.retrievalMethods],
              intent: autoRag.intent,
            };
          } catch (e) {
            ragSpan.finish('error', { errorMessage: e instanceof Error ? e.message : String(e) });
            return { contextBlock: '', timedOut: false, failed: true };
          }
        })(),
        budgets.parallelTimeoutMs,
        { contextBlock: '', timedOut: true },
      );

      type MemPack = { block: string; recalledCount: number; sourceCount: number; timedOut?: boolean };
      const memPromise: Promise<MemPack> =
        memSessionId && memUserId
          ? withContextTimeout(
              (async (): Promise<MemPack> => {
                const memSpan = startSpan('queen.memory.recall', {
                  parent: rootSpan,
                  op: 'queen.memory.recall',
                  tags: { orchestrationId, sessionId: memSessionId, complexity: budgets.complexity },
                });
                try {
                  const orgId =
                    (request as { organizationId?: string }).organizationId ??
                    _reqExt.tenantId ??
                    _tenantId;
                  const memTier = mapBillingTierToCapabilityTier(
                    String(_reqExt.tier ?? _reqExt.userTier ?? 'lite'),
                  );
                  const memJurisdiction = request.jurisdiction ?? 'IN';
                  const available = capabilityManifest.list({
                    tier: memTier,
                    jurisdiction: memJurisdiction,
                  });
                  const availableSet = new Set(available.map((c: { id: string }) => c.id));
                  const memCtx = {
                    tier: memTier,
                    jurisdiction: memJurisdiction,
                    userId: memUserId,
                    tenantId: _reqExt.tenantId ?? _tenantId,
                  };
                  const unwrapResults = (r: unknown): MemoryRecallItem[] => {
                    if (!r) return [];
                    const arr =
                      (r as { results?: unknown[] }).results ?? (r as { items?: unknown[] }).items;
                    return Array.isArray(arr) ? (arr as MemoryRecallItem[]) : [];
                  };
                  const recallSources: MemoryRecallSource[] = [];
                  if (availableSet.has('memory.tiered.recall')) {
                    recallSources.push({
                      id: 'memory.tiered.recall',
                      label: 'tiered memory recall',
                      run: (signal) =>
                        capabilityManifest
                          .invoke(
                            'memory.tiered.recall',
                            {
                              query: request.prompt,
                              tiers: [...memTiersForFan],
                              limit: budgets.memoryLimit,
                            },
                            { ...memCtx, signal },
                          )
                          .then(unwrapResults),
                    });
                  }
                  if (budgets.memorySources === 'full' && availableSet.has('memory.mem0.recall')) {
                    recallSources.push({
                      id: 'memory.mem0.recall',
                      label: 'mem0 recall',
                      run: (signal) =>
                        capabilityManifest
                          .invoke(
                            'memory.mem0.recall',
                            { query: request.prompt, limit: Math.min(5, budgets.memoryLimit) },
                            { ...memCtx, signal },
                          )
                          .then(unwrapResults),
                    });
                  }
                  if (budgets.memorySources === 'full' && availableSet.has('memory.5tier.episodic')) {
                    recallSources.push({
                      id: 'memory.5tier.episodic',
                      label: '5-tier episodic recall',
                      run: (signal) =>
                        capabilityManifest
                          .invoke(
                            'memory.5tier.episodic',
                            { sessionId: memSessionId, limit: budgets.memoryLimit },
                            { ...memCtx, signal },
                          )
                          .then(unwrapResults),
                    });
                  }
                  if (budgets.memorySources === 'full' && availableSet.has('memory.social.context')) {
                    recallSources.push({
                      id: 'memory.social.context',
                      label: 'social context recall',
                      run: (signal) =>
                        capabilityManifest
                          .invoke(
                            'memory.social.context',
                            { userId: memUserId, agentKey: _reqExt.agentKey, orgId },
                            { ...memCtx, signal },
                          )
                          .then(unwrapResults),
                    });
                  }
                  const recalled = await fanInMemoryRecall({
                    query: request.prompt,
                    userId: memUserId,
                    sessionId: memSessionId,
                    orgId,
                    tenantId: _reqExt.tenantId ?? _tenantId,
                    jurisdiction: request.jurisdiction,
                    limit: budgets.memoryLimit,
                    tiers: [...memTiersForFan],
                    sources: recallSources.length > 0 ? recallSources : undefined,
                  });
                  if (recalled.length > 0) {
                    const memLines = recalled
                      .slice(0, budgets.memorySlice)
                      .map((m) => {
                        const content =
                          typeof m === 'string'
                            ? m
                            : String((m as { content?: unknown }).content ?? JSON.stringify(m));
                        const type =
                          typeof m === 'string'
                            ? 'memory'
                            : String((m as { type?: unknown }).type ?? 'memory');
                        return `[${type}] ${content.substring(0, budgets.memoryCharCap)}`;
                      })
                      .join('\n');
                    logger.info(
                      `🧠 Memory: recalled ${recalled.length} entries for session ${memSessionId} (sources: ${recallSources.length}, budget=${budgets.complexity})`,
                    );
                    memSpan.finish('ok', {
                      recalledCount: recalled.length,
                      sourceCount: recallSources.length,
                      memoryLimit: budgets.memoryLimit,
                    });
                    return {
                      block: '\n\n--- Prior Session Memory ---\n' + memLines,
                      recalledCount: recalled.length,
                      sourceCount: recallSources.length,
                    };
                  }
                  memSpan.finish('ok', { recalledCount: 0 });
                  return { block: '', recalledCount: 0, sourceCount: recallSources.length };
                } catch (e) {
                  memSpan.finish('error', {
                    errorMessage: e instanceof Error ? e.message : String(e),
                  });
                  logger.warn(
                    `[Memory] recall failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`,
                  );
                  return { block: '', recalledCount: 0, sourceCount: 0 };
                }
              })(),
              budgets.parallelTimeoutMs,
              { block: '', recalledCount: 0, sourceCount: 0, timedOut: true },
            )
          : Promise.resolve({ block: '', recalledCount: 0, sourceCount: 0 });

      /* NV-COMPLETION-DRIVEN-001 Wave B — Step-0 grounding is completion-driven.
       *
       * `Promise.all` made Step-0 cost the SLOWER of RAG and memory, always, up to
       * the shared `parallelTimeoutMs` (20 s moderate / 35 s very_complex). So a
       * request whose RAG returned authorities in 900 ms still sat behind a hung
       * `memory.tiered.recall` for the rest of that window before a single leaf
       * started — the same defect as the per-leaf fan-in wait, one layer up.
       *
       * Now whichever source produces useful grounding first releases the pair and
       * the sibling gets a short grace. If NEITHER is useful there is nothing to
       * progress to, so the original hard cap still applies (enforced inside
       * `withContextTimeout`, so nothing can outlive it either way). */
      const ragTracked = trackSettled(ragPromise);
      const memTracked = trackSettled(memPromise);
      const grounding = await proceedOnFirstUseful([
        {
          promise: ragTracked.promise,
          isUseful: (v) => !!(v as { contextBlock?: string } | undefined)?.contextBlock,
        },
        {
          promise: memTracked.promise,
          isUseful: (v) => Number((v as { recalledCount?: number } | undefined)?.recalledCount) > 0,
        },
      ]);
      const ragPack: RagPack = ragTracked.state.value ?? { contextBlock: '', timedOut: true };
      const memPack = memTracked.state.value ?? {
        block: '',
        recalledCount: 0,
        sourceCount: 0,
        timedOut: true,
      };
      /* NV-STEP0-OBSERVABILITY-001 — always emit the Step-0 outcome, not only the
       * early-release case.
       *
       * The release log previously fired only when a source was useful while its
       * sibling was still pending, so a healthy run logged nothing at all. That made
       * `step0_first_useful = 0` ambiguous between "the mechanism never had to fire"
       * (correct, and expected while memory recall is fast) and "the mechanism is
       * never reached" (a wiring defect). A ratio needs both numerators, so the
       * normal path is now counted too. */
      recordStep0Outcome({
        releasedEarly: grounding.releasedEarly,
        ragSettled: ragTracked.state.done,
        memSettled: memTracked.state.done,
        ragUseful: !!ragPack.contextBlock,
        memUseful: Number(memPack.recalledCount) > 0,
      });
      if (grounding.releasedEarly && !(ragTracked.state.done && memTracked.state.done)) {
        logger.info(
          `[Queen] Step-0 released on first useful grounding (rag=${ragTracked.state.done ? 'in' : 'pending'} mem=${memTracked.state.done ? 'in' : 'pending'}) — not waiting out ${budgets.parallelTimeoutMs}ms`,
        );
      }
      if (ragPack.timedOut) {
        logger.warn(`[Queen] Step-0 RAG timed out at ${budgets.parallelTimeoutMs}ms (non-fatal)`);
        try {
          ragSpan.finish('error', { errorMessage: 'context_budget_timeout' });
        } catch {
          /* span may already be finished */
        }
      }
      if (memPack.timedOut) {
        logger.warn(`[Queen] Step-0 memory timed out at ${budgets.parallelTimeoutMs}ms (non-fatal)`);
      }

      // Always inject retrieval policy so every agent turn sees NYS → RAG → memory → LLM
      // even when Auto-RAG returns zero chunks (agents must still know the order).
      {
        const { agentRetrievalPolicyDirective } = await import(
          '../services/jrx-agent-retrieval-policy.js'
        );
        const { isNyvFeatureOn } = await import('../config/jrx-feature-flags.js');
        const policy = agentRetrievalPolicyDirective({
          jurisdiction: request.jurisdiction || 'IN',
          nysPlaneOn: isNyvFeatureOn('nysKnowledgePlane'),
        });
        request = {
          ...request,
          prompt: `${policy}\n\n${request.prompt}${ragPack.contextBlock}${memPack.block}`,
        };
      }
      // Always mark Step-0 as done (even empty) so agent middleware does not
      // re-hit NYS/tenant Auto-RAG on the same orchestration.
      asExt(request).ragAlreadyApplied = true;
      /* NV-LEGALCHAT-QE-001 — `grounded` is deliberately separate from
       * `attempted`: Step-0 always runs, so "attempted" alone would let a
       * zero-chunk retrieval be reported as grounding.
       *
       * NV-LEGALCHAT-RAG-EVENT-001 — the counts ride along so a reporter does not
       * have to infer them. They are spread conditionally: an absent `chunkCount`
       * means "not measured" (timeout / thrown retrieval), which must stay
       * distinguishable from a measured zero. */
      asExt(request).__ragStep0 = {
        attempted: true,
        grounded: !!ragPack.contextBlock,
        timedOut: !!ragPack.timedOut,
        ...(typeof ragPack.chunkCount === 'number' ? { chunkCount: ragPack.chunkCount } : {}),
        ...(ragPack.layersUsed ? { layersUsed: [...ragPack.layersUsed] } : {}),
        ...(ragPack.retrievalMethods ? { retrievalMethods: [...ragPack.retrievalMethods] } : {}),
        ...(ragPack.intent ? { intent: ragPack.intent } : {}),
        ...(ragPack.contextBlock ? { contextBlock: ragPack.contextBlock } : {}),
      };
      asExt(request).memoryAlreadyApplied = true;
      setRequestPhase(asExt(request), 'grounding');
      (asExt(request) as { __contextBudgets?: unknown }).__contextBudgets = {
        complexity: budgets.complexity,
        ragTopK: budgets.ragTopK,
        memoryLimit: budgets.memoryLimit,
        parallelTimeoutMs: budgets.parallelTimeoutMs,
        ragTimedOut: !!ragPack.timedOut,
        memoryTimedOut: !!memPack.timedOut,
      };

      // NV-CTX-ENG-QUEEN-001: wire createContextEngineer onto live Queen path
      // (ProductionOrchestrator already had it; /orchestrate did not). Fail-soft.
      // Complements realLLMService.applyContextEngineering on each LLM call.
      try {
        const { createContextEngineer } = await import('../packages/protocols/context-engineering.js');
        const engineer = createContextEngineer();
        const engineered = await engineer.engineerContext({
          id: `ctx-${orchestrationId}`,
          agentId: 'queen-orchestrator',
          taskType: String(request.type || 'analysis'),
          query: request.prompt.slice(0, 4000),
          requiredLayers: ['task', 'domain'],
          optionalLayers: ['session', 'memory'],
          constraints: {
            maxTokens: 2048,
            relevanceThreshold: 0.35,
            includeDomainKnowledge: true,
            prioritizeRecent: true,
          },
          metadata: {
            timestamp: new Date(),
            sessionId: String(request.sessionId || orchestrationId),
            userId: memUserId,
            projectId: _reqExt.tenantId,
          },
        });
        const merged = String(engineered?.mergedContent || '').trim();
        if (merged && merged.length > 40) {
          const tokensReduced = Number(engineered?.optimization?.tokensReduced || 0);
          request = {
            ...request,
            prompt: `${request.prompt}\n\n[CONTEXT-ENGINEERING]\n${merged.slice(0, 3000)}\n[/CONTEXT-ENGINEERING]`,
          };
          (asExt(request) as any).__contextEngineering = {
            applied: engineered?.optimization?.applied || [],
            tokensReduced,
            relevanceScore: engineered?.statistics?.relevanceScore,
          };
          logger.info('[Queen] context engineering applied', {
            tokensReduced,
            layers: engineered?.statistics?.totalLayers,
          });
        }
      } catch (ctxErr: unknown) {
        logger.warn(`[Queen] context engineering skipped (non-fatal): ${ctxErr instanceof Error ? ctxErr.message : String(ctxErr)}`);
      }

      // NYV-ORCH-SKILLS-002 (Task #32 round 3): if the caller did not pre-pass
      // a skillsAllowedCapabilities allowlist, derive it from the
      // SkillsSystemService for this request's tier × jurisdiction × intent.
      // This wires the skills surface into orchestration entry — tier/jurisdiction
      // gating is now enforced at decomposition time, not optionally.
      const reqExt = request as OrchestrationRequest & {
        skillsAllowedCapabilities?: string[];
        skillsActivated?: string[];
        tier?: string;
        userTier?: string;
        billingTier?: string;
        jurisdiction?: string;
        practiceArea?: string;
        userId?: string;
      };
      if (!Array.isArray(reqExt.skillsAllowedCapabilities)) {
        const tierMap: Record<string, 'solo' | 'plus' | 'pro' | 'enterprise'> = {
          lite: 'solo', mitra: 'plus', enterprise: 'pro', sovereign: 'enterprise', 'white-label': 'enterprise',
        };
        const rawTier = String(reqExt.tier ?? reqExt.userTier ?? reqExt.billingTier ?? 'lite');
        const skillsTier: 'solo' | 'plus' | 'pro' | 'enterprise' = tierMap[rawTier] ?? 'solo';
        const skillsCtx: import('../services/skills/skills-system-service.js').SkillActivationContext = {
          agentId: 'queen-orchestrator',
          jurisdiction: reqExt.jurisdiction ?? 'IN',
          practiceArea: reqExt.practiceArea ?? 'all',
          tier: skillsTier,
          taskType: 'orchestration',
          userId: reqExt.userId,
        };
        try {
          const { skillsSystem } = await import('../services/skills/skills-system-service.js');
          const surface = await skillsSystem.getCapabilitiesForContext(skillsCtx);
          reqExt.skillsAllowedCapabilities = surface.capabilities.map((c) => c.id);
          reqExt.skillsActivated = surface.activatedSkills?.map((s) => s.id) ?? [];
          logger.info(`Skills surface activated: ${surface.activatedSkills.length} skills, ${surface.capabilities.length} capabilities allowed`);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          // Skills gating contract: when the SkillsSystemService cannot derive
          // an allowlist, falling back to the full tier surface would let
          // unsanctioned capabilities through. Refuse in production.
          if (process.env.NODE_ENV === 'production') {
            throw new Error(`[Queen] skills-allowlist derivation failed in production — refusing to proceed with full tier surface: ${msg}`);
          }
          logger.warn('[Queen] skills-derived allowlist unavailable — continuing with full tier surface', { error: msg });
        }
      }

      const patternSelector = getPatternAutoSelector();
      const patternSelection = patternSelector.select(
        request.prompt,
        request.jurisdiction,
        undefined,
      );
      logger.info(`🎯 PatternAutoSelector: ${patternSelection.selectedPattern?.patternId} (${patternSelection.selectedPattern?.patternName}), confidence: ${patternSelection.confidence.toFixed(2)}, intent: ${patternSelection.taskAnalysis.intent}, complexity: ${patternSelection.taskAnalysis.complexity}`);

      // NV-PATTERN-DISPATCH-001: propagate the auto-selected pattern onto the
      // request so it actually SHAPES execution — both the structural
      // orchestrationPattern (in decomposeTask) and a behavioural directive
      // injected into every agent prompt (buildAgentPrompt). Previously the
      // pattern was telemetry-only. Only applied when the caller did not force
      // an orchestrationMode (forced mode always wins).
      {
        const selId = patternSelection.selectedPattern?.patternId;
        const directive = patternSystemDirective(selId);
        _reqExt.autoPatternId = selId;
        if (directive) _reqExt.patternDirective = directive;
      }

      // NYV-OBS-QUEEN-MEMORY-001 (Task #28 round 3): record a memory-pressure
      // snapshot at orchestration start so operators can correlate "this run
      // was slow" with "the platform was under heap pressure when it ran".
      // The span finishes immediately — it is a point-in-time read, not a
      // wrapped phase — so it shows up in /admin/health/full's spanLatencies
      // with maxMs ≈ 0 but its tags carry the per-tier memory state.
      try {
        const { nvMemoryManager } = await import('../services/jrx-memory-manager.js');
        const memSnap = await nvMemoryManager.getStats();
        const memSpan = startSpan('queen.memory', {
          parent: rootSpan,
          op: 'queen.memory',
          tags: {
            orchestrationId,
            tenantId: _tenantId,
            jurisdiction: _reqExt.jurisdiction ?? 'IN',
            tier: _reqExt.tier ?? _reqExt.userTier ?? 'lite',
            // NYV-OPS-MEMORY-SHAPE-001 (Task #28 round 5): match the real
            // nested shape returned by nvMemoryManager.getStats().
            // Round-3 used flat `sessionEntries`/`longtermEntries`/
            // `socialEntries` which never existed → every span tag was 0.
            pressureStatus:  memSnap?.pressure?.status   ?? 'unknown',
            heapPct:         memSnap?.pressure?.heapPct  ?? 0,
            sessionEntries:  memSnap?.session?.entries   ?? 0,
            longtermEntries: memSnap?.longterm?.entries  ?? 0,
            socialEntries:   memSnap?.social?.entries    ?? 0,
          },
        });
        memSpan.finish('ok');
      } catch (e) {
        // Memory subsystem unavailable — keep going; orchestration must not
        // fail because we could not snapshot pressure.
      }

      // Step 1: Analyze and decompose the task
      const decomposition = await withSpan(
        'queen.decompose',
        {
          parent: rootSpan,
          op: 'queen.decompose',
          tags: {
            orchestrationId,
            tenantId: _tenantId,
            jurisdiction: _reqExt.jurisdiction ?? 'IN',
            tier: _reqExt.tier ?? _reqExt.userTier ?? 'lite',
          },
        },
        async (s) => {
          const d = await this.decomposeTask(request);
          s.setTag('subtaskCount', d.subtasks.length);
          s.setTag('algorithm', d.decompositionAlgorithm ?? 'unknown');
          // NYV-OBS-TAG-NORMALIZE-001 (Task #28 round 3): use
          // `orchestrationPattern` so getTaggedSpanLatencies (which keys on
          // TRACKED_TAG_KEYS=['orchestrationPattern',…]) actually buckets it.
          s.setTag('orchestrationPattern', d.orchestrationPattern ?? 'unknown');
          return d;
        },
      );
      const selectedPatternId = patternSelection.selectedPattern?.patternId;
      const capabilityHint = patternCapabilityHint(selectedPatternId);
      const preferredTopologyId = patternPreferredTopologyId(selectedPatternId);
      const priorHints = normalizePatternCapabilityHints(
        (decomposition.metadata as Record<string, unknown> | undefined)?.patternCapabilityHint,
      );
      decomposition.metadata = {
        ...(decomposition.metadata || {}),
        autoSelectedPattern: selectedPatternId,
        patternConfidence: patternSelection.confidence,
        taskIntent: patternSelection.taskAnalysis.intent,
        taskComplexity: patternSelection.taskAnalysis.complexity,
        alternativePatterns: patternSelection.alternativePatterns.map(p => p.patternId),
        patternCapabilityHint: capabilityHint
          ? [...priorHints, capabilityHint]
          : priorHints,
        ...(preferredTopologyId && decomposition.orchestrationPattern === 'swarm'
          ? { preferredTopologyId }
          : {}),
      };
      // NYV-OBS-PATTERN-ROOT-001 (Task #28 round 11): once decomposition
      // resolves the orchestrationPattern, propagate it onto the
      // queen.orchestrate ROOT span as well as the subtaskCount. The
      // pattern was previously only on the queen.decompose phase span,
      // so "p95 of queen.orchestrate by orchestrationPattern" needed
      // a join. Tagging the root directly makes the top-level
      // latency-by-pattern view a one-key lookup.
      rootSpan.setTag('orchestrationPattern', decomposition.orchestrationPattern ?? 'unknown');
      rootSpan.setTag('subtaskCount', decomposition.subtasks.length);
      logger.info(`📊 Decomposition: ${decomposition.subtasks.length} subtasks, Pattern: ${decomposition.orchestrationPattern}`);

      // Step 1b (Task #32 round 3): bind manifest capabilities to subtasks.
      // Each subtask is matched against the candidate-capability set produced by
      // discoverCandidateCapabilities() and gets an assignedCapabilityId when a
      // suitable manifest entry exists. Downstream executeAgent() routes through
      // the manifest invoker (capabilityManifest.invoke) for those subtasks,
      // making the manifest the SSoT for execution — not just metadata.
      this.bindCapabilitiesToSubtasks(decomposition);
      const boundCount = decomposition.subtasks.filter((s) => (s as SubtaskWithCapability).assignedCapabilityId).length;
      logger.info(`🔗 Capability binding: ${boundCount}/${decomposition.subtasks.length} subtasks bound to manifest capabilities`);

      // Step 2: Assign optimal agents to subtasks
      await this.assignAgents(decomposition);
      logger.info(`🤖 Agents assigned: ${decomposition.subtasks.filter(s => s.assignedAgent).length}`);
      setRequestPhase(asExt(request), 'generating');

      // NYV-ORCH-LIFECYCLE-001 (Task #27): emit a decomposition_complete event
      // so AG-UI streaming subscribers can render the plan to the user before
      // any agent executes (gives the user immediate feedback during long runs).
      this.emitLifecycle(request, 'decomposition_complete', {
        orchestrationId,
        algorithm: decomposition.decompositionAlgorithm,
        pattern: decomposition.orchestrationPattern,
        complexity: decomposition.complexity,
        subtaskCount: decomposition.subtasks.length,
        subtasks: decomposition.subtasks.map(s => ({
          id: s.id,
          type: s.type,
          description: s.description.slice(0, 200),
          assignedAgent: s.assignedAgent?.name,
          complexity: s.estimatedComplexity,
        })),
      });

      // Step 3: Execute based on orchestration pattern
      const executions = await withSpan(
        'queen.execute',
        {
          parent: rootSpan,
          op: 'queen.execute',
          tags: {
            orchestrationId,
            tenantId: _tenantId,
            // NYV-OBS-TAG-NORMALIZE-001 (Task #28 round 3): keep both keys
            // — `orchestrationPattern` is the bucketed dimension (matches
            // TRACKED_TAG_KEYS), `pattern` stays for back-compat with
            // existing dashboards that already filter on it.
            orchestrationPattern: decomposition.orchestrationPattern ?? 'unknown',
            pattern: decomposition.orchestrationPattern ?? 'unknown',
            jurisdiction: _reqExt.jurisdiction ?? 'IN',
            tier: _reqExt.tier ?? _reqExt.userTier ?? 'lite',
            subtaskCount: decomposition.subtasks.length,
          },
        },
        async (s) => {
          const ex = await this.executeOrchestration(decomposition, request);
          s.setTag('executionCount', ex.length);
          s.setTag('successCount', ex.filter((e: any) => e.status === 'completed' || e.success).length);
          return ex;
        },
      );
      logger.info(`✅ Executions completed: ${executions.length}`);

      // Step 4: Synthesize results
      const synthesizedOutput = await withSpan(
        'queen.synthesis',
        {
          parent: rootSpan,
          op: 'queen.synthesis',
          tags: {
            orchestrationId,
            tenantId: _tenantId,
            jurisdiction: _reqExt.jurisdiction ?? 'IN',
            tier: _reqExt.tier ?? _reqExt.userTier ?? 'lite',
            orchestrationPattern: decomposition.orchestrationPattern ?? 'unknown',
          },
        },
        async (s) => {
          const out = await this.synthesizeResults(decomposition, executions, request);
          s.setTag('outputChars', out.length);
          return out;
        },
      );
      // NV-LEGAL-FORMAT-001 — Queen parity with specialist safety-ring polish
      let polishedOutput = synthesizedOutput;
      try {
        const { applyLegalResponseFormatting } = await import('../services/jrx-legal-response-format.js');
        const promptBlob = String(request.prompt || '');
        const draftish = /\b(draft|plead|petition|plaint|affidavit|legal\s+notice|contract|agreement|fir|bail)\b/i.test(promptBlob)
          || /draft/i.test(String(request.type || ''));
        polishedOutput = applyLegalResponseFormatting(synthesizedOutput, {
          jurisdiction: String(_reqExt.jurisdiction ?? request.jurisdiction ?? 'IN'),
          taskType: draftish ? 'document-drafting' : String(request.type || 'research'),
          query: promptBlob,
          includeDisclaimer: true,
          comprehensive: partnerBest || undefined,
        });
      } catch { /* non-fatal */ }
      try {
        const { applyStatuteQaGroundingGate } = await import('../services/jrx-statute-qa-grounding.js');
        const gated = await applyStatuteQaGroundingGate({
          query: String(request.prompt || ''),
          answer: polishedOutput,
          jurisdiction: String(_reqExt.jurisdiction ?? request.jurisdiction ?? 'IN'),
        });
        polishedOutput = gated.content;
        if (gated.corrected) {
          logger.info('queen_statute_qa_corrected', {
            reason: gated.reason,
            act: gated.statute?.act_short_title,
            section: gated.statute?.section_number,
          });
        }
      } catch (e: any) {
        logger.warn('queen_statute_qa_gate_failed', { error: e?.message || String(e) });
      }

      // NYV-ORCH-MEM-002 (Task #27): persist the (prompt, output) pair to
      // session memory so the next turn in the same session can recall it.
      // Fire-and-forget within try/catch — memory write failure must NOT
      // poison a successful orchestration.
      if (memSessionId && memUserId) {
        const memWriteSpan = startSpan('queen.memory.remember', {
          parent: rootSpan,
          op: 'queen.memory.remember',
          tags: { orchestrationId, sessionId: memSessionId },
        });
        try {
          const { nvMemoryManager } = await import('../services/jrx-memory-manager.js');
          await nvMemoryManager.remember({
            userId: memUserId,
            sessionId: memSessionId,
            type: 'interaction',
            tier: 'session',
            content: `Q: ${request.prompt.substring(0, 500)}\nA: ${polishedOutput.substring(0, 1500)}`,
            jurisdiction: request.jurisdiction,
            tags: ['orchestration', request.type, request.jurisdiction || 'IN'],
            metadata: {
              orchestrationId,
              agentsUsed: new Set(executions.map(e => e.agentId)).size,
              orchestrationPattern: decomposition.orchestrationPattern,
            },
          });
          logger.info(`🧠 Memory: stored interaction for session ${memSessionId}`);
          memWriteSpan.finish('ok');
        } catch (e) {
          memWriteSpan.finish('error', { errorMessage: e instanceof Error ? e.message : String(e) });
          logger.warn(`[Memory] remember failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const totalTime = Date.now() - startTime;

      // NYV-ORCH-CACHE-001 (Task #38): roll up the per-agent cache hit
      // counter (bumped inside callAgentInner) onto the public result so
      // observability + perf dashboards can compute hit rate without
      // having to re-walk the executions array.
      const cacheHits = asExt(request).__cacheHits ?? 0;

      // A5 — Verbalised sampling for high-stakes drafting (NYV-A5-VERBALISE-001)
      // Opt-in: triggers when priority is high/critical OR caller explicitly
      // sets metadata.verbalize. Computes a calibrated confidence statement
      // from execution-level confidence signals (or a sane default) and
      // attaches it to result.metadata.verbalizedConfidence. Pure post-
      // synthesis — never mutates synthesizedOutput, never calls an LLM,
      // and a failure here cannot break the orchestration.
      let verbalizedConfidence: any = undefined;
      try {
        const reqMeta = (request as any).metadata ?? {};
        const verbalizeOptIn =
          request.priority === 'high' ||
          request.priority === 'critical' ||
          reqMeta.verbalize === true;
        if (verbalizeOptIn) {
          const { verbalizedSamplingService } = await import(
            '../services/verbalized-sampling-service.js'
          );
          // Average per-execution confidence when present; fall back to 0.7.
          const confidenceScores = executions
            .map((e: any) => (typeof e?.confidence === 'number' ? e.confidence : null))
            .filter((v): v is number => v !== null);
          const avgConfidence = confidenceScores.length
            ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
            : 0.7;
          const domain = String(
            request.jurisdiction ?? asExt(request).practiceArea ?? 'legal',
          );
          verbalizedConfidence = verbalizedSamplingService.verbalizeConfidence(
            avgConfidence,
            domain,
          );
        }
      } catch (e) {
        logger.warn(
          `[A5/Verbalise] post-synthesis verbalisation failed (non-fatal): ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      const result: OrchestrationResult = {
        success: true,
        taskDecomposition: decomposition,
        executions,
        synthesizedOutput: polishedOutput,
        ...(asExt(request).__lastSafetyVerdict
          ? { safetyVerdict: asExt(request).__lastSafetyVerdict }
          : {}),
        metadata: {
          totalTime,
          totalTokens: this.calculateTotalTokens(executions),
          totalCost: this.calculateTotalCost(executions),
          agentsUsed: new Set(executions.map(e => e.agentId)).size,
          orchestrationPattern: decomposition.orchestrationPattern,
          queenCotApplied: asExt(request).__queenCotApplied === true,
          queenCotCaptureFailed: asExt(request).__queenCotCaptureFailed === true,
          ...(asExt(request).__queenCotCaptureError
            ? { queenCotCaptureError: asExt(request).__queenCotCaptureError }
            : {}),
          ...completionDrivenResultMeta(request),
          contextEngineering: (asExt(request) as any).__contextEngineering ?? null,
          cacheHits,
          ...(verbalizedConfidence ? { verbalizedConfidence } : {}),
        }
      };

      logger.info(`👑 ========== ORCHESTRATION COMPLETE (${totalTime}ms, ${cacheHits} cache hit(s)) ==========\n`);
      this.emit('orchestration_complete', result);
      rootSpan.finish('ok', {
        totalMs: totalTime,
        agentsUsed: result.metadata.agentsUsed,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
        totalTokens: result.metadata.totalTokens,
        outputChars: synthesizedOutput.length,
        cacheHits,
      });
      return result;

    } catch (error: unknown) {
      logger.error(`❌ Orchestration failed:`, error instanceof Error ? { message: error.message, stack: error.stack } : error as Record<string, any>);
      rootSpan.finish('error', { errorMessage: error instanceof Error ? error.message : String(error) });
      throw error;
    }
    }));
  }

  // ================================================================================================
  // TASK DECOMPOSITION ALGORITHMS
  // ================================================================================================

  /**
   * NYV-SDK-AUTO-ORCH-001 (2026-06-12): public, zero-LLM-call complexity probe.
   *
   * Route handlers (notably the partner /api/jrx/orchestrate path) call this to
   * decide whether a request warrants full Queen multi-agent orchestration or
   * a single-agent safety-ring pass — BEFORE committing to either path. It is
   * a thin public wrapper over the same private analyzePrompt() heuristic the
   * decomposer itself uses, so route-level auto-engagement can never diverge
   * from what the Queen would actually decompose.
   */
  public assessPromptComplexity(prompt: string): {
    intent: string;
    complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
    domains: string[];
    requiresMultipleAgents: boolean;
  } {
    const a = this.analyzePrompt(String(prompt ?? ''), undefined);
    return {
      intent: a.intent,
      complexity: a.complexity,
      domains: a.domains,
      requiresMultipleAgents: a.requiresMultipleAgents,
    };
  }

  /**
   * Decompose a complex task into subtasks using advanced algorithms
   * Supports: ACONIC, ADaPT, HTA, DAG
   */
  private async decomposeTask(request: OrchestrationRequest): Promise<TaskDecomposition> {
    logger.info(`🔬 Analyzing task for decomposition...`);
    
    // Analyze prompt complexity and intent
    const analysis = this.analyzePrompt(request.prompt, request.type);

    // Manifest-driven: resolve tier, jurisdiction precedence, and the optional
    // skills allowlist. Then enumerate candidate capabilities for downstream
    // dispatch (orchestration middleware will invoke these uniformly).
    const { tier } = resolveRequestPolicy(request);
    const reqExt = asExt(request);
    const inferredJurisdiction = inferJurisdiction({
      explicit:      reqExt.jurisdiction ?? null,
      userProfile:   reqExt.userJurisdiction ?? null,
      tenantDefault: reqExt.tenantJurisdiction ?? null,
    }).jurisdiction;
    const skillsAllowlist: string[] | null = Array.isArray(reqExt.skillsAllowedCapabilities)
      ? reqExt.skillsAllowedCapabilities
      : null;
    const candidateCapabilities = discoverCandidateCapabilities({
      tier,
      jurisdiction: inferredJurisdiction,
      keywords: analysis.keywords,
      intent: analysis.intent,
      domains: analysis.domains,
      skillsAllowlist,
    });
    logger.info(`🧭 Manifest-driven candidates: ${candidateCapabilities.length} (tier=${tier}, jurisdiction=${inferredJurisdiction}, skillsGated=${skillsAllowlist ? skillsAllowlist.length : 'no'})`);

    // Select decomposition algorithm based on complexity
    const algorithm = this.selectDecompositionAlgorithm(analysis);
    logger.info(`📐 Selected algorithm: ${algorithm}`);

    let subtasks: Subtask[];
    let orchestrationPattern: TaskDecomposition['orchestrationPattern'];

    const forcedMode = request.orchestrationMode;

    // NYV-P1-ORCH-CORE-001 (item A) — OPTIONAL LLM-driven planner.
    // Flag-gated (JRX_F_QUEEN_LLM_PLANNER, default OFF) and only attempted
    // when the caller did NOT force an orchestration mode. The planner routes
    // a compact planning prompt through the EXISTING safety-ring entrypoint
    // (withMiddleware → realLLMService.executeRequest → orchestrateLLM), the
    // same pattern synthesizeWithLLM uses (NV-LLM-001). On ANY failure —
    // flag off, LLM unavailable, parse error, empty/invalid plan — it returns
    // null and we fall through to the existing keyword heuristic below, which
    // remains the default path. The planner NEVER throws and NEVER fabricates.
    let llmPlan:
      | { subtasks: Subtask[]; orchestrationPattern: TaskDecomposition['orchestrationPattern']; engagedCapabilities: string[] }
      | null = null;
    if (!forcedMode && _govFlagOn('queenLlmPlanner')) {
      llmPlan = await this.tryLlmDecompositionPlan(request, analysis, candidateCapabilities);
    }

    if (llmPlan) {
      subtasks = llmPlan.subtasks;
      orchestrationPattern = llmPlan.orchestrationPattern;
      logger.info(`🧠 LLM planner produced ${subtasks.length} subtask(s) (pattern=${orchestrationPattern})`);
    } else if (forcedMode) {
      switch (forcedMode) {
        case 'dag':
          subtasks = this.aconicDecompose(request, analysis);
          orchestrationPattern = 'dag';
          break;
        case 'parallel':
          subtasks = this.adaptDecompose(request, analysis);
          orchestrationPattern = 'parallel';
          break;
        case 'sequential':
          subtasks = this.adaptDecompose(request, analysis);
          orchestrationPattern = 'sequential';
          break;
        case 'hierarchical':
          subtasks = this.htaDecompose(request, analysis);
          orchestrationPattern = 'hierarchical';
          break;
        case 'swarm':
          subtasks = this.swarmDecompose(request, analysis);
          orchestrationPattern = 'swarm';
          break;
        default:
          subtasks = this.simpleDecompose(request, analysis);
          orchestrationPattern = 'single_agent';
      }
      logger.info(`📐 Forced orchestration mode applied: ${forcedMode}`);
    } else {
      switch (algorithm) {
        case 'ACONIC':
          // Constraint-based decomposition for complex reasoning
          subtasks = this.aconicDecompose(request, analysis);
          orchestrationPattern = 'dag';
          break;

        case 'ADaPT':
          // Adaptive decomposition with planning
          subtasks = this.adaptDecompose(request, analysis);
          orchestrationPattern = subtasks.length > 3 ? 'parallel' : 'sequential';
          break;

        case 'HTA':
          // Hierarchical task analysis
          subtasks = this.htaDecompose(request, analysis);
          orchestrationPattern = 'hierarchical';
          break;

        case 'SWARM':
          // Swarm intelligence for creative/research tasks
          subtasks = this.swarmDecompose(request, analysis);
          orchestrationPattern = 'swarm';
          break;

        default:
          // Simple single-agent handling
          subtasks = this.simpleDecompose(request, analysis);
          orchestrationPattern = 'single_agent';
      }
    }

    // NV-PATTERN-DISPATCH-001: when the caller did not force a mode and the LLM
    // planner did not run, let the auto-selected agentic pattern override the
    // structural shape where it implies one (e.g. P16 Swarm → swarm, P15 HTA →
    // hierarchical, P07 Maker-Checker → sequential). The keyword heuristic
    // stands when the pattern has no structural implication.
    if (!forcedMode && !llmPlan) {
      const autoPatternId = reqExt.autoPatternId;
      const structural = patternToOrchestrationPattern(autoPatternId);
      if (structural && structural !== orchestrationPattern) {
        logger.info(`🎯 Pattern ${autoPatternId} overrides orchestrationPattern ${orchestrationPattern} → ${structural}`);
        orchestrationPattern = structural;
      }
    }

    return {
      originalPrompt: request.prompt,
      analyzedIntent: analysis.intent,
      taskType: request.type,
      complexity: analysis.complexity,
      subtasks,
      orchestrationPattern,
      estimatedAgents: subtasks.length,
      estimatedTime: subtasks.length * 2000, // 2s per subtask estimate
      // NYV-P1-ORCH-CORE-001 (item A): record provenance so observers can tell
      // an LLM-planned decomposition apart from the keyword-heuristic one.
      decompositionAlgorithm: llmPlan ? 'LLM_PLANNER' : algorithm,
      metadata: {
        capabilityCandidates: candidateCapabilities.map((c) => ({
          id: c.id,
          category: c.category,
          costClass: c.costClass,
          safetyClass: c.safetyClass,
          tags: c.tags,
        })),
        patternCapabilityHint: analysis.patternCapabilityHint,
        manifestTier: tier,
        manifestJurisdiction: inferredJurisdiction,
        skillsAllowlistSize: skillsAllowlist?.length ?? null,
        ...(llmPlan
          ? {
              llmPlanner: {
                engaged: true,
                heuristicFallbackAlgorithm: algorithm,
                engagedCapabilities: llmPlan.engagedCapabilities,
                subtaskCount: llmPlan.subtasks.length,
              },
            }
          : {}),
      },
    };
  }

  /**
   * NYV-P1-ORCH-CORE-001 (item A) — LLM-driven decomposition planner.
   *
   * Asks the planning model for a STRICT JSON plan and maps it onto the
   * existing {@link Subtask}/{@link TaskDecomposition} types. The call flows
   * through the SAME safety-ring entrypoint as {@link synthesizeWithLLM}
   * (`withMiddleware` → `realLLMService.executeRequest` → `orchestrateLLM`),
   * so NV-LLM-001 (single-router rule) holds — there is no direct provider
   * SDK call here.
   *
   * Returns `null` (and logs at WARN) on ANY of: LLM error/unavailability,
   * empty/non-JSON output, JSON that doesn't parse, or a plan with zero
   * valid subtasks. Callers MUST treat `null` as "use the heuristic". This
   * method never throws and never invents a plan from nothing.
   */
  private async tryLlmDecompositionPlan(
    request: OrchestrationRequest,
    analysis: ReturnType<typeof this.analyzePrompt>,
    candidateCapabilities: Array<{ id: string; category?: string; tags?: string[] }>,
  ): Promise<
    | { subtasks: Subtask[]; orchestrationPattern: TaskDecomposition['orchestrationPattern']; engagedCapabilities: string[] }
    | null
  > {
    const VALID_PATTERNS: ReadonlyArray<TaskDecomposition['orchestrationPattern']> = [
      'single_agent', 'sequential', 'parallel', 'dag', 'swarm', 'hierarchical',
    ];
    try {
      const reqExt = asExt(request);
      const candidateIds = candidateCapabilities.map((c) => c.id).filter(Boolean);
      const candidateList = candidateIds.slice(0, 40).join(', ') || '(none enumerated)';

      const planSystem = `You are the PLANNING module of Jurexio's Queen orchestrator. Decompose the user's legal task into an executable multi-agent plan.

Return ONLY a single valid JSON object — no prose, no markdown fences. Exact shape:
{
  "orchestrationPattern": one of ["single_agent","sequential","parallel","dag","swarm","hierarchical"],
  "candidateCapabilities": string[]   // subset of the ALLOWED capability ids below to engage
  "subtasks": [
    {
      "title": string,                // short imperative title
      "description": string,          // what this subtask must produce
      "dependsOn": number[],          // 0-based indexes of subtasks that must finish first (empty if none)
      "requiredCapabilities": string[]// subset of the ALLOWED capability ids (optional)
    }
  ]
}

RULES:
- 1 to 8 subtasks. Use "single_agent" with exactly ONE subtask for simple asks.
- dependsOn indexes MUST reference earlier subtasks only (a DAG, no cycles).
- Pick capabilities ONLY from the ALLOWED list; drop anything not in it.
- Do not include any field not listed above.`;

      const planUser = `USER TASK:
${String(request.prompt ?? '').slice(0, 4000)}

JURISDICTION: ${request.jurisdiction || reqExt.jurisdiction || 'IN'}
HEURISTIC INTENT: ${analysis.intent}
HEURISTIC COMPLEXITY: ${analysis.complexity}
HEURISTIC DOMAINS: ${analysis.domains.join(', ') || '(none)'}
ALLOWED CAPABILITY IDS: ${candidateList}

Produce the JSON plan now.`;

      const { withMiddleware } = await import('./orchestration-middleware.js');
      const { realLLMService } = await import('../services/real-llm-service.js');
      const policy = resolveRequestPolicy(request);

      const wrapped = await withMiddleware(
        withQueenRagSkip(
          {
            prompt: planUser,
            agentKey: 'queen.planner',
            tier: policy.tier,
            jurisdiction: inferJurisdiction({
              explicit:      reqExt.jurisdiction ?? null,
              userProfile:   reqExt.userJurisdiction ?? null,
              tenantDefault: reqExt.tenantJurisdiction ?? null,
            }).jurisdiction,
            userId: reqExt.userId,
            tenantId: reqExt.tenantId,
            requestId: reqExt.id ?? reqExt.requestId,
            riskLevel: 'low' as const,
          },
          request,
        ),
        async () => {
          const response = await realLLMService.executeRequest({
            // NV-REQID-CORRELATION-001: planning call, same parent request.
            id:           `${reqExt.orchestrationId ?? reqExt.requestId ?? 'orch'}::plan`,
            userId:       reqExt.userId ?? 'system',
            provider:     undefined as any,
            model:        undefined as any,
            prompt:       planUser,
            systemPrompt: planSystem,
            maxTokens:    1024,
            temperature:  0.1, // near-deterministic structured planning
            requirements: {
              complexity:   'medium',
              domain:       'analytical',
              priority:     'medium',
              costBudget:   'economy',
              responseTime: 'fast',
              qualityLevel: 'professional',
            },
            fallbackLevels: 2,
            timestamp:      new Date(),
          } as any);
          return { output: response.content };
        },
      );

      const raw = typeof wrapped.output === 'string' ? wrapped.output : '';
      const parsed = this.parseLlmPlanJson(raw);
      if (!parsed) {
        logger.warn('[QueenPlanner] LLM plan unparseable/empty — falling back to heuristic');
        return null;
      }

      const pattern: TaskDecomposition['orchestrationPattern'] =
        VALID_PATTERNS.includes(parsed.orchestrationPattern as any)
          ? (parsed.orchestrationPattern as TaskDecomposition['orchestrationPattern'])
          : (parsed.subtasks.length > 3 ? 'parallel' : parsed.subtasks.length > 1 ? 'sequential' : 'single_agent');

      const candidateSet = new Set(candidateIds);
      const engaged = new Set<string>();
      const now = Date.now();

      const subtasks: Subtask[] = parsed.subtasks.map((st, idx) => {
        const caps = (st.requiredCapabilities ?? [])
          .filter((c) => candidateSet.size === 0 || candidateSet.has(c));
        for (const c of caps) engaged.add(c);
        const deps = (st.dependsOn ?? [])
          .filter((d) => Number.isInteger(d) && d >= 0 && d < idx) // earlier-only, no cycles
          .map((d) => `llm-${now}-${d}`);
        const complexity: Subtask['estimatedComplexity'] =
          analysis.complexity === 'simple' ? 'simple'
            : analysis.complexity === 'very_complex' || analysis.complexity === 'complex' ? 'complex'
            : 'moderate';
        return {
          id: `llm-${now}-${idx}`,
          type: 'llm_planned',
          description: `${st.title ? st.title + ': ' : ''}${st.description ?? st.title ?? `subtask ${idx + 1}`}`.slice(0, 800),
          dependencies: deps,
          priority: idx + 1,
          estimatedComplexity: complexity,
          requiredCapabilities: caps.length > 0 ? caps : (analysis.domains.length ? analysis.domains : ['general']),
          status: 'pending',
        };
      });

      if (subtasks.length === 0) {
        logger.warn('[QueenPlanner] LLM plan had zero valid subtasks — falling back to heuristic');
        return null;
      }

      // Merge any explicit top-level candidateCapabilities the model engaged.
      for (const c of parsed.candidateCapabilities ?? []) {
        if (candidateSet.size === 0 || candidateSet.has(c)) engaged.add(c);
      }

      return { subtasks, orchestrationPattern: pattern, engagedCapabilities: [...engaged] };
    } catch (err: any) {
      logger.warn(`[QueenPlanner] LLM planner failed (fail-safe to heuristic): ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Strictly parse the planning model's JSON output. Tolerates an optional
   * ```json fence and leading/trailing prose by extracting the first balanced
   * `{...}` object, then validates the minimal shape. Returns `null` on any
   * structural problem so the caller falls back to the heuristic.
   */
  private parseLlmPlanJson(raw: string): {
    orchestrationPattern?: string;
    candidateCapabilities?: string[];
    subtasks: Array<{ title?: string; description?: string; dependsOn?: number[]; requiredCapabilities?: string[] }>;
  } | null {
    if (!raw || !raw.trim()) return null;
    let text = raw.trim();
    // Strip a leading/trailing markdown fence if present.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) text = fence[1].trim();
    // Extract the first balanced top-level object.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const jsonSlice = text.slice(start, end + 1);
    let obj: any;
    try {
      obj = JSON.parse(jsonSlice);
    } catch {
      return null;
    }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.subtasks)) return null;
    const subtasks = obj.subtasks
      .filter((s: any) => s && typeof s === 'object' && (typeof s.title === 'string' || typeof s.description === 'string'))
      .slice(0, 8)
      .map((s: any) => ({
        title: typeof s.title === 'string' ? s.title : undefined,
        description: typeof s.description === 'string' ? s.description : undefined,
        dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [],
        requiredCapabilities: Array.isArray(s.requiredCapabilities)
          ? s.requiredCapabilities.filter((c: any) => typeof c === 'string')
          : [],
      }));
    if (subtasks.length === 0) return null;
    return {
      orchestrationPattern: typeof obj.orchestrationPattern === 'string' ? obj.orchestrationPattern : undefined,
      candidateCapabilities: Array.isArray(obj.candidateCapabilities)
        ? obj.candidateCapabilities.filter((c: any) => typeof c === 'string')
        : [],
      subtasks,
    };
  }

  /**
   * Analyze prompt to determine complexity and intent
   */
  private analyzePrompt(prompt: string, taskType?: string): {
    intent: string;
    complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
    keywords: string[];
    domains: string[];
    actionVerbs: string[];
    patternCapabilityHint: string[];
    requiresMultipleAgents: boolean;
  } {
    const words = prompt.toLowerCase().split(/\s+/);
    const length = words.length;

    // Extract keywords
    const techKeywords = ['api', 'database', 'frontend', 'backend', 'deploy', 'test', 'security', 'auth', 'payment'];
    const creativeKeywords = ['design', 'write', 'create', 'generate', 'compose', 'draft'];
    const analysisKeywords = ['analyze', 'compare', 'evaluate', 'research', 'investigate', 'study'];
    const orchestrationKeywords = ['build', 'develop', 'implement', 'create application', 'full stack'];
    const patternHintTokens = new Set<string>();

    if (taskType && /^(legal[_-]?draft|doc[_-]?draft|document[_-]?draft)[_-]agentic$/i.test(String(taskType))) {
      patternHintTokens.add('draft_agentic');
      patternHintTokens.add('draft');
    }

    const foundTechKeywords = words.filter(w => techKeywords.some(k => w.includes(k)));
    const foundCreativeKeywords = words.filter(w => creativeKeywords.some(k => w.includes(k)));
    const foundAnalysisKeywords = words.filter(w => analysisKeywords.some(k => w.includes(k)));
    const foundOrchestrationKeywords = words.filter(w => orchestrationKeywords.some(k => w.includes(k)));
    const normalizedPrompt = prompt.toLowerCase();

    // Specific leaf intents win over generic tokens so INTENT_CAPABILITY_MAP
    // resolves catalog/generate/submit/playbook before broad template/filing.
    if (/\btemplate(s)?\b/.test(normalizedPrompt)) {
      if (/\b(catalog|list|browse|show)\b/.test(normalizedPrompt)) patternHintTokens.add('catalog');
      else if (/\b(generate|draft|create|build|fill)\b/.test(normalizedPrompt)) patternHintTokens.add('generate');
      else patternHintTokens.add('template');
    }
    if (/\b(twin|twindesk|digital[-\s_]?twin)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('twin');
    } else if (/\bsimulat(e|ion|ing)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('simulation');
    }
    if (/\bsubmit\b/.test(normalizedPrompt) && /\b(filing|court|e[-\s_]?filing)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('submit');
    } else if (/\b(e[-\s_]?filing|filing)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('filing');
    }
    if (/\bplaybook\b/.test(normalizedPrompt)) {
      patternHintTokens.add('playbook');
    } else if (/\b(contract[-\s_]?lifecycle|contract lifecycle|clm)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('contract_lifecycle');
    } else if (/\blifecycle\b/.test(normalizedPrompt) && /\bcontract(s)?\b/.test(normalizedPrompt)) {
      patternHintTokens.add('lifecycle');
    } else if (/\bcontract(s)?\b/.test(normalizedPrompt)) {
      patternHintTokens.add('contract');
    }
    if (/\bprecedent(s)?\b|\bcase[-\s_]?law\b|\bcaselaw\b/.test(normalizedPrompt)) {
      patternHintTokens.add('precedent');
      if (/\bcaselaw\b/.test(normalizedPrompt)) patternHintTokens.add('caselaw');
    }
    // NV-AGENT-RESEARCH-PIN-001 — route research vs draft paths to distinct specialists.
    if (/\b(statute|section|ipc|bns|bnss|bsa|crpc|cpc)\b/.test(normalizedPrompt)
      && /\b(research|lookup|what (?:does|is)|meaning|provision)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('statute-research');
    }
    if (/\b(caselaw|case law|judgment|reported in|scc online)\b/.test(normalizedPrompt)
      && /\b(research|find|search|cite|citation)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('caselaw-research');
    }
    if (/\bprecedent\b/.test(normalizedPrompt)
      && /\b(research|analog|distinguish|binding|persuasive)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('precedent-research');
    }
    if (/\b(draft|petition|plaint|affidavit|notice|agreement|written statement|bail|writ petition|quash)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('draft');
    }
    // NV-LEGAL-DRAFT-AGENTIC-001 — explicit agentic drafting → plan→research→draft→self-validate mesh.
    if (/\bagentic\s+(?:draft|drafting|pleading|legal)\b|\b(?:legal|doc(?:ument)?)[\s_-]?draft[\s_-]?agentic\b/.test(normalizedPrompt)) {
      patternHintTokens.add('draft_agentic');
      patternHintTokens.add('draft');
    }
    // NV-INDIAN-STRUCTURE-001 — NSP partner taskType vocabulary in prompt metadata.
    if (/\b(legal[\s_-]?chat|counsel[\s_-]?assist|quick[\s_-]?legal)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('legal-chat');
    }
    if (/\b(contract[\s_-]?review|review[\s_-]+(?:this|the)[\s_-]+agreement|clause[\s_-]?risk)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('contract_review');
    }
    if (/\b(citation[\s_-]?check|verify[\s_-]+(?:this|the)[\s_-]+citation|cite[\s_-]?for[\s_-]?proposition)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('citation_check');
    }
    if (/\b(statute[\s_-]?lookup|instant[\s_-]?search|section[\s_-]?lookup)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('statute-research');
    }
    // Doc pipeline intents (AdaptiveRouter + INTENT_CAPABILITY_MAP)
    if (/\bocr\b|optical\s*character/.test(normalizedPrompt)) patternHintTokens.add('ocr');
    if (/\bparse\b|parsing\b/.test(normalizedPrompt)) patternHintTokens.add('parse');
    if (/\bcompare\b|comparison\b|\bdiff\b/.test(normalizedPrompt)) patternHintTokens.add('compare');
    if (/\bclassif(y|ication)\b/.test(normalizedPrompt)) patternHintTokens.add('classify');
    if (/\bembed(ding)?\b/.test(normalizedPrompt)) patternHintTokens.add('embed');
    if (/\bsummar(y|ise|ize)\b/.test(normalizedPrompt)) patternHintTokens.add('summarize');
    if (/\bdoc(ument)?[-\s_]?analy[sz]e\b/.test(normalizedPrompt)) patternHintTokens.add('doc_analyze');
    if (/\bmultilingual\b|\btranslat/.test(normalizedPrompt)) patternHintTokens.add('multilingual');
    if (/\bmultimodal\b|\bvoice\b|\btts\b|\bstt\b/.test(normalizedPrompt)) patternHintTokens.add('multimodal');
    // High-value leaves already factory-wired (Replit) — INTENT hints so Queen schedules them
    if (/\bautomateai\b|\bworkflow\s*bot\b|\bautomate\s+workflow\b/.test(normalizedPrompt)) patternHintTokens.add('automateai');
    if (/\bopenbot\b/.test(normalizedPrompt)) patternHintTokens.add('openbot');
    if (/\bclawdbot\b|\bcrawl\b/.test(normalizedPrompt)) patternHintTokens.add('clawdbot');
    if (/\bbmad\b/.test(normalizedPrompt)) patternHintTokens.add('bmad');
    if (/\ba2a\b|\bagent[-\s]+to[-\s]+agent\b|\btask\s+handoff\b/.test(normalizedPrompt)) {
      patternHintTokens.add('a2a');
    }
    if (/\bamend(ment)?\b/.test(normalizedPrompt)) patternHintTokens.add('amend');
    if (/\bforensic\b/.test(normalizedPrompt)) patternHintTokens.add('forensic');
    if (/\btimeline\b/.test(normalizedPrompt)) patternHintTokens.add('timeline');
    if (/\baudit\s*trail\b|\btrail\b/.test(normalizedPrompt) && /\b(nyaya|audit|legal)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('trail');
    }
    if (/\bregulatory\s*watch\b|\bnyaya-tools\.watch\b/.test(normalizedPrompt)) patternHintTokens.add('watch');
    if (/\blegal\s*(intel(ligence)?|feed|digest)\b|\btoday'?s\s+(judgments?|rulings?)\b|\bgazette\s+news\b|\bregulatory\s+feed\b/.test(normalizedPrompt)) {
      patternHintTokens.add('legal_feed');
    }
    if (/\b(instant\s*search|find\s+section|typeahead|statute\s+lookup)\b/.test(normalizedPrompt)) {
      patternHintTokens.add('instant_search');
    }
    if (/\bknowledge\s*graph\b|\bnyaya-tools\.graph\b/.test(normalizedPrompt)) patternHintTokens.add('graph');
    if (/\bweb\s*search\b|\bwebsearch\b/.test(normalizedPrompt)) patternHintTokens.add('web_search');
    if (/\bnotebook\b/.test(normalizedPrompt)) patternHintTokens.add('notebook');
    if (/\bfinancial\s*data\b|\benterprise\.financial\b/.test(normalizedPrompt)) patternHintTokens.add('financial');
    if (/\bmultimedia\b/.test(normalizedPrompt)) patternHintTokens.add('multimedia');
    if (/\bdomain\s*research\b/.test(normalizedPrompt)) patternHintTokens.add('domain_research');
    if (/\bgrpo\b/.test(normalizedPrompt)) patternHintTokens.add('grpo');
    if (/\bmcp\b/.test(normalizedPrompt)) patternHintTokens.add('mcp');
    // A1 Wave — inventory leaf hints
    if (/\bgraphrag\b|\bgraph\s*rag\b/.test(normalizedPrompt)) patternHintTokens.add('graphrag');
    if (/\brerank(er|ing)?\b/.test(normalizedPrompt)) patternHintTokens.add('rerank');
    if (/\bcorrective\s*rag\b/.test(normalizedPrompt)) patternHintTokens.add('corrective_rag');
    if (/\badaptive\s*rag\b/.test(normalizedPrompt)) patternHintTokens.add('adaptive_rag');
    if (/\bself[-\s]?rag\b/.test(normalizedPrompt)) patternHintTokens.add('self_rag');
    if (/\blightrag\b/.test(normalizedPrompt)) patternHintTokens.add('lightrag');
    if (/\bmem0\b/.test(normalizedPrompt)) patternHintTokens.add('mem0');
    if (/\bsocial\s*memory\b/.test(normalizedPrompt)) patternHintTokens.add('social_memory');
    if (/\bdocs?\s*intelligence\b|\bdocument\s*intelligence\b/.test(normalizedPrompt)) patternHintTokens.add('docs_intelligence');
    if (/\bcompliance\s*calendar\b/.test(normalizedPrompt)) patternHintTokens.add('compliance_calendar');
    if (/\bbulk\s*analy/.test(normalizedPrompt)) patternHintTokens.add('bulk_analysis');
    if (/\bcalendar\s*extract/.test(normalizedPrompt)) patternHintTokens.add('calendar_extract');
    if (/\bworkflow\s*protocol\b/.test(normalizedPrompt)) patternHintTokens.add('workflow_protocol');
    if (/\busage\s*meter/.test(normalizedPrompt)) patternHintTokens.add('usage_metering');
    if (/\bagent\s*lifecycle\b/.test(normalizedPrompt)) patternHintTokens.add('agent_lifecycle');

    // Determine complexity
    let complexity: 'simple' | 'moderate' | 'complex' | 'very_complex';
    const totalKeywords = foundTechKeywords.length + foundCreativeKeywords.length + 
                          foundAnalysisKeywords.length + foundOrchestrationKeywords.length;

    if (length < 10 && totalKeywords <= 1) {
      complexity = 'simple';
    } else if (length < 30 && totalKeywords <= 3) {
      complexity = 'moderate';
    } else if (length < 100 || totalKeywords <= 5) {
      complexity = 'complex';
    } else {
      complexity = 'very_complex';
    }

    // Determine domains — legal-first for Indian / advocate / statute language
    // so ADaPT does not invent a false "technology" leaf from words like "test"/"auth".
    const domains: string[] = [];
    const legalCue = words.some(w =>
      ['legal', 'law', 'contract', 'compliance', 'bail', 'petition', 'statute', 'bnss', 'bns', 'bsa',
        'court', 'advocate', 'section', 'fir', 'ipc', 'crpc', 'draft', 'notice', 'injunction'].includes(w)
      || /section\s*\d+/i.test(normalizedPrompt)
    );
    if (legalCue) domains.push('legal');
    if (foundAnalysisKeywords.length > 0) domains.push('analysis');
    if (foundCreativeKeywords.length > 0 && !legalCue) domains.push('creative');
    // Only tag technology when clearly software/engineering (not legal "authority"/"security deposit")
    if (foundTechKeywords.length > 0 && !legalCue) domains.push('technology');
    if (words.some(w => ['finance', 'money', 'payment', 'banking'].includes(w))) domains.push('finance');
    if (words.some(w => ['health', 'medical', 'patient', 'doctor'].includes(w))) domains.push('healthcare');
    if (words.some(w => ['legal', 'law', 'contract', 'compliance'].includes(w)) && !domains.includes('legal')) {
      domains.push('legal');
    }
    if (domains.length === 0) domains.push(legalCue ? 'legal' : 'analysis');

    // Prefer research/legal intent over technical when legal cues dominate
    let intent = 'general_assistance';
    if (foundTechKeywords.length > 0 && !legalCue) intent = 'technical_development';
    if (foundCreativeKeywords.length > foundTechKeywords.length) intent = 'creative_generation';
    if (foundAnalysisKeywords.length > foundCreativeKeywords.length || legalCue) intent = 'research_analysis';
    if (foundOrchestrationKeywords.length > 0 && !legalCue) intent = 'application_development';

    // Determine if multiple agents needed
    const requiresMultipleAgents = complexity === 'complex' || complexity === 'very_complex' || 
                                   domains.length > 1 || foundOrchestrationKeywords.length > 0;

    return {
      intent,
      complexity,
      keywords: [...foundTechKeywords, ...foundCreativeKeywords, ...foundAnalysisKeywords],
      domains,
      actionVerbs: words.filter(w => ['build', 'create', 'develop', 'analyze', 'design', 'implement'].includes(w)),
      patternCapabilityHint: [...patternHintTokens],
      requiresMultipleAgents
    };
  }

  /**
   * Select the best decomposition algorithm based on task analysis
   */
  private selectDecompositionAlgorithm(analysis: ReturnType<typeof this.analyzePrompt>): string {
    if (analysis.complexity === 'simple') {
      return 'SIMPLE';
    }

    if (analysis.intent === 'research_analysis' || analysis.domains.includes('analysis')) {
      return 'SWARM'; // Swarm is good for research/creative exploration
    }

    if (analysis.intent === 'application_development' || analysis.domains.length > 2) {
      return 'HTA'; // Hierarchical for complex application development
    }

    if (analysis.complexity === 'very_complex') {
      return 'ACONIC'; // Constraint-based for very complex tasks
    }

    return 'ADaPT'; // Adaptive for everything else
  }

  // ================================================================================================
  // DECOMPOSITION ALGORITHMS IMPLEMENTATION
  // ================================================================================================

  /**
   * ACONIC: Analysis of Constraint-Induced Complexity
   * Best for complex reasoning tasks with multiple constraints
   */
  private aconicDecompose(request: OrchestrationRequest, analysis: ReturnType<typeof this.analyzePrompt>): Subtask[] {
    logger.info(`   📐 ACONIC decomposition: Converting to constraint graph...`);
    
    const subtasks: Subtask[] = [];
    const constraints = this.extractConstraints(request.prompt);
    
    // Create subtasks based on constraint groups
    let priority = 1;
    
    // Phase 1: Understanding & Planning
    subtasks.push({
      id: `aconic-understand-${Date.now()}`,
      type: 'understanding',
      description: `Analyze and understand the full requirements: ${request.prompt.substring(0, 100)}...`,
      dependencies: [],
      priority: priority++,
      estimatedComplexity: 'moderate',
      requiredCapabilities: ['analysis', 'planning'],
      status: 'pending'
    });

    // Phase 2: Constraint-based subtasks
    for (const constraint of constraints) {
      subtasks.push({
        id: `aconic-constraint-${Date.now()}-${priority}`,
        type: 'constraint_resolution',
        description: `Resolve constraint: ${constraint}`,
        dependencies: [subtasks[0].id],
        priority: priority++,
        estimatedComplexity: 'complex',
        requiredCapabilities: this.inferCapabilitiesFromConstraint(constraint),
        status: 'pending'
      });
    }

    // Phase 3: Integration
    subtasks.push({
      id: `aconic-integrate-${Date.now()}`,
      type: 'integration',
      description: 'Integrate all constraint solutions into coherent output',
      dependencies: subtasks.slice(1).map(s => s.id),
      priority: priority++,
      estimatedComplexity: 'complex',
      requiredCapabilities: ['integration', 'synthesis'],
      status: 'pending'
    });

    return subtasks;
  }

  /**
   * ADaPT: As-Needed Decomposition and Planning
   * Decomposes tasks only when necessary, with adaptive planning
   */
  private adaptDecompose(request: OrchestrationRequest, analysis: ReturnType<typeof this.analyzePrompt>): Subtask[] {
    logger.info(`   📐 ADaPT decomposition: Adaptive planning...`);
    
    const subtasks: Subtask[] = [];
    let priority = 1;

    // Initial attempt subtask
    subtasks.push({
      id: `adapt-initial-${Date.now()}`,
      type: 'initial_attempt',
      description: `Direct attempt at: ${request.prompt.substring(0, 100)}...`,
      dependencies: [],
      priority: priority++,
      estimatedComplexity: analysis.complexity === 'simple' ? 'simple' : 'moderate',
      requiredCapabilities: analysis.domains,
      status: 'pending'
    });

    // Only add more subtasks if complexity warrants it
    if (analysis.complexity !== 'simple') {
      // Decompose based on domains
      for (const domain of analysis.domains) {
        subtasks.push({
          id: `adapt-domain-${domain}-${Date.now()}`,
          type: 'domain_specific',
          description: `Handle ${domain} aspects of the request`,
          dependencies: [subtasks[0].id],
          priority: priority++,
          estimatedComplexity: 'moderate',
          requiredCapabilities: [domain],
          status: 'pending'
        });
      }

      // Quality check subtask
      subtasks.push({
        id: `adapt-quality-${Date.now()}`,
        type: 'quality_check',
        description: 'Verify and refine the output',
        dependencies: subtasks.slice(1).map(s => s.id),
        priority: priority++,
        estimatedComplexity: 'simple',
        requiredCapabilities: ['qa', 'review'],
        status: 'pending'
      });
    }

    return subtasks;
  }

  /**
   * HTA: Hierarchical Task Analysis
   * Best for complex application development
   */
  private htaDecompose(request: OrchestrationRequest, analysis: ReturnType<typeof this.analyzePrompt>): Subtask[] {
    logger.info(`   📐 HTA decomposition: Hierarchical breakdown...`);
    
    const subtasks: Subtask[] = [];
    let priority = 1;

    // Level 0: Overall goal
    subtasks.push({
      id: `hta-goal-${Date.now()}`,
      type: 'goal_definition',
      description: `Define overall goal: ${request.prompt.substring(0, 100)}...`,
      dependencies: [],
      priority: priority++,
      estimatedComplexity: 'simple',
      requiredCapabilities: ['planning', 'analysis'],
      status: 'pending'
    });

    // Level 1: Major phases
    const phases = ['planning', 'design', 'implementation', 'testing', 'deployment'];
    const phaseSubtasks: Subtask[] = [];

    for (const phase of phases) {
      if (this.isPhaseRelevant(phase, analysis)) {
        const phaseTask: Subtask = {
          id: `hta-phase-${phase}-${Date.now()}`,
          type: phase,
          description: `${phase.charAt(0).toUpperCase() + phase.slice(1)} phase`,
          dependencies: [subtasks[0].id],
          priority: priority++,
          estimatedComplexity: 'moderate',
          requiredCapabilities: this.getPhaseCapabilities(phase),
          status: 'pending'
        };
        phaseSubtasks.push(phaseTask);
        subtasks.push(phaseTask);
      }
    }

    // Level 2: Integration
    subtasks.push({
      id: `hta-integration-${Date.now()}`,
      type: 'integration',
      description: 'Integrate all phases into final deliverable',
      dependencies: phaseSubtasks.map(s => s.id),
      priority: priority++,
      estimatedComplexity: 'complex',
      requiredCapabilities: ['integration', 'synthesis', 'quality'],
      status: 'pending'
    });

    return subtasks;
  }

  /**
   * Swarm decomposition for distributed intelligence
   */
  private swarmDecompose(request: OrchestrationRequest, analysis: ReturnType<typeof this.analyzePrompt>): Subtask[] {
    logger.info(`   📐 SWARM decomposition: Distributed intelligence...`);
    
    const subtasks: Subtask[] = [];
    let priority = 1;

    // Swarm uses multiple independent agents working on the same problem
    // MAX_PARALLEL_AGENTS cap: prevent runaway parallel execution at scale
    const MAX_SWARM_AGENTS = parseInt(process.env.MAX_SWARM_AGENTS || '10', 10);
    const swarmSize = Math.min(MAX_SWARM_AGENTS, Math.min(5, Math.max(3, analysis.domains.length + 2)));

    for (let i = 0; i < swarmSize; i++) {
      subtasks.push({
        id: `swarm-agent-${i}-${Date.now()}`,
        type: 'swarm_exploration',
        description: `Swarm agent ${i + 1}: Independent exploration of ${request.prompt.substring(0, 50)}...`,
        dependencies: [],
        priority: priority,
        estimatedComplexity: 'moderate',
        requiredCapabilities: analysis.domains.length > 0 ? [analysis.domains[i % analysis.domains.length]] : ['research'],
        status: 'pending'
      });
    }
    priority++;

    // Swarm aggregation
    subtasks.push({
      id: `swarm-aggregate-${Date.now()}`,
      type: 'swarm_aggregation',
      description: 'Aggregate and synthesize swarm insights',
      dependencies: subtasks.map(s => s.id),
      priority: priority++,
      estimatedComplexity: 'complex',
      requiredCapabilities: ['synthesis', 'analysis'],
      status: 'pending'
    });

    return subtasks;
  }

  /**
   * Simple decomposition for straightforward tasks
   */
  private simpleDecompose(request: OrchestrationRequest, analysis: ReturnType<typeof this.analyzePrompt>): Subtask[] {
    logger.info(`   📐 SIMPLE decomposition: Single agent handling...`);
    
    return [{
      id: `simple-${Date.now()}`,
      type: 'direct_execution',
      description: request.prompt,
      dependencies: [],
      priority: 1,
      estimatedComplexity: 'simple',
      requiredCapabilities: analysis.domains.length > 0 ? analysis.domains : ['general'],
      status: 'pending'
    }];
  }

  // ================================================================================================
  // CAPABILITY BINDING (Task #32 round 3 — manifest-driven SSoT)
  // ================================================================================================

  /**
   * Bind each subtask to a manifest capability when one matches. The candidate
   * pool is derived from decomposition.metadata.capabilityCandidates which was
   * computed in decomposeTask() using tier × jurisdiction × skills allowlist.
   *
   * Match score per subtask × candidate:
   *   +5 if candidate.id segment overlaps a token in subtask.requiredCapabilities
   *   +3 if candidate.tag overlaps a token in subtask.description
   *   +2 if candidate.category matches subtask.type token
   *   +1 if candidate.id contains subtask.type token
   *
   * Score must be >= 3 to bind. Otherwise the subtask falls back to the
   * legacy agent-only path. This keeps the manifest the SSoT when a real
   * binding exists, while keeping legacy paths working for synthetic subtasks.
   */
  private bindCapabilitiesToSubtasks(decomposition: TaskDecomposition): void {
    const meta = decomposition.metadata as
      | (Record<string, unknown> & {
          capabilityCandidates?: Array<{ id: string; category: string; tags: string[] }>;
        })
      | undefined;
    const candidates = meta?.capabilityCandidates ?? [];
    if (candidates.length === 0) return;

    const candidateIds: ReadonlySet<string> = new Set(candidates.map((c) => c.id));
    const tokenize = (s: string) => (s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

    interface BindingTraceEntry {
      subtaskId: string;
      type: string;
      bound: string | null;
      source: 'pattern-direct' | 'intent-map' | 'heuristic' | 'category-fallback' | 'unbound';
      matchedIntent?: string;
    }
    const bindingTrace: BindingTraceEntry[] = [];
    const unboundInProd: string[] = [];
    const patternHints = normalizePatternCapabilityHints(meta?.patternCapabilityHint);

    for (const subtask of decomposition.subtasks) {
      const leafLike = /^(direct_execution|initial_attempt|implementation|domain_specific|integration)$/i.test(subtask.type);

      // Phase 0: pattern dispatch may emit a direct manifest capability id (e.g. P20 → e-filing.submit).
      if (leafLike) {
        const directId = patternHints.find((h) => candidateIds.has(h));
        if (directId) {
          (subtask as SubtaskWithCapability).assignedCapabilityId = directId;
          bindingTrace.push({
            subtaskId: subtask.id,
            type: subtask.type,
            bound: directId,
            source: 'pattern-direct',
            matchedIntent: directId,
          });
          continue;
        }
      }

      // Phase 1: deterministic intent map (SSoT).
      // Pattern hints are only applied to leaf-like subtasks so broad prompt
      // keywords do not override every planning / analysis step in a DAG.
      const intentTokens: string[] = [
        ...(leafLike ? patternHints : []),
        subtask.type,
        ...(subtask.requiredCapabilities ?? []),
        ...tokenize(subtask.type),
      ].filter(Boolean);

      const intentMatch = resolveIntentToCapability(intentTokens, candidateIds);
      if (intentMatch) {
        (subtask as SubtaskWithCapability).assignedCapabilityId = intentMatch.capabilityId;
        bindingTrace.push({
          subtaskId: subtask.id,
          type: subtask.type,
          bound: intentMatch.capabilityId,
          source: 'intent-map',
          matchedIntent: intentMatch.matchedIntent,
        });
        continue;
      }

      // Phase 2: heuristic scorer fallback.
      const reqTokens = new Set<string>([
        ...((subtask.requiredCapabilities ?? []).flatMap(tokenize)),
        ...tokenize(subtask.type),
      ]);
      const descTokens = new Set<string>(tokenize(subtask.description));

      let best: { id: string; score: number } | null = null;
      for (const cap of candidates) {
        const idSegs = tokenize(cap.id);
        const tagSegs = (cap.tags ?? []).flatMap(tokenize);
        let score = 0;
        if (idSegs.some((s) => reqTokens.has(s))) score += 5;
        if (tagSegs.some((t) => descTokens.has(t))) score += 3;
        if (reqTokens.has(cap.category) || descTokens.has(cap.category)) score += 2;
        if (idSegs.some((s) => descTokens.has(s))) score += 1;
        if (!best || score > best.score) best = { id: cap.id, score };
      }
      if (best && best.score >= 3) {
        (subtask as SubtaskWithCapability).assignedCapabilityId = best.id;
        bindingTrace.push({
          subtaskId: subtask.id,
          type: subtask.type,
          bound: best.id,
          source: 'heuristic',
        });
        continue;
      }

      // Phase 3 (NYV-DECOMP-FALLBACK-001, round 10d): manifest-driven
      // category fallback. When neither the intent map nor the keyword
      // scorer produced a confident bind, walk the candidate set looking
      // for a category that overlaps the subtask's type/requirement
      // tokens or its description tokens. This guarantees that any
      // capability whose CATEGORY is reachable by intent — even if its
      // tags are sparse — is still discoverable. Without this fallback,
      // sparsely-tagged but correctly-categorised tools become orphans.
      const subtaskTokenSet = new Set<string>([...reqTokens, ...descTokens]);
      const categoryHit = candidates.find((c) => subtaskTokenSet.has(c.category));
      if (categoryHit) {
        (subtask as SubtaskWithCapability).assignedCapabilityId = categoryHit.id;
        bindingTrace.push({
          subtaskId: subtask.id,
          type: subtask.type,
          bound: categoryHit.id,
          source: 'category-fallback',
        });
        continue;
      }

      bindingTrace.push({
        subtaskId: subtask.id,
        type: subtask.type,
        bound: null,
        source: 'unbound',
      });
      unboundInProd.push(`${subtask.id}(${subtask.type})`);
    }

    // Persist trace for audit / observability.
    if (decomposition.metadata) {
      (decomposition.metadata as Record<string, unknown>).capabilityBindingTrace = bindingTrace;
    }

    // NV-QUEEN-NEVER-MISS-001: never refuse orchestration in production for
    // unbound ADaPT/HTA leaves. Soft-bind to agent.auto-select (or first
    // candidate) so Queen continues and partners always get a response.
    // Escape hatch: NYV_QUEEN_HARD_BIND_FAIL=1 restores legacy throw.
    if (unboundInProd.length > 0) {
      const summary = `[QueenOrchestrator] capability binding miss for ${unboundInProd.length} subtask(s): ${unboundInProd.slice(0, 5).join(', ')}${unboundInProd.length > 5 ? '...' : ''}`;
      const hardFail = String(process.env.NYV_QUEEN_HARD_BIND_FAIL || '').trim() === '1';
      if (hardFail && process.env.NODE_ENV === 'production') {
        logger.error(summary + ' — refusing to proceed in production (NYV_QUEEN_HARD_BIND_FAIL=1)');
        throw new Error(summary + ' — register an INTENT_CAPABILITY_MAP entry in src/orchestration/capability-manifest.ts');
      }

      const softId =
        (candidateIds.has('agent.auto-select') ? 'agent.auto-select' : null)
        || (candidateIds.has('rag.search') ? 'rag.search' : null)
        || candidates[0]?.id
        || 'agent.auto-select';

      for (const subtask of decomposition.subtasks) {
        if (!(subtask as SubtaskWithCapability).assignedCapabilityId) {
          (subtask as SubtaskWithCapability).assignedCapabilityId = softId;
          bindingTrace.push({
            subtaskId: subtask.id,
            type: subtask.type,
            bound: softId,
            source: 'category-fallback',
            matchedIntent: 'soft-bind-never-miss',
          });
        }
      }
      if (decomposition.metadata) {
        (decomposition.metadata as Record<string, unknown>).capabilityBindingTrace = bindingTrace;
        (decomposition.metadata as Record<string, unknown>).capabilitySoftBound = unboundInProd;
      }
      logger.warn(summary + ` — soft-bound to ${softId} (never-miss; set NYV_QUEEN_HARD_BIND_FAIL=1 to refuse)`);
    }
  }

  // ================================================================================================
  // AGENT ASSIGNMENT
  // ================================================================================================

  /**
   * Assign optimal agents to each subtask
   */
  private async assignAgents(decomposition: TaskDecomposition): Promise<void> {
    logger.info(`🤖 Assigning agents to ${decomposition.subtasks.length} subtasks...`);

    /* T005: Pre-load BM25 corpus + performance scores for this assignment pass */
    let bm25Scores = new Map<string, number>();
    try {
      const { bm25AgentSelector } = await import('../services/bm25-agent-selector.js');
      const { agentPerformanceTracker } = await import('../services/agent-performance-tracker.js');
      const allAgents = agentRegistry.getAllAgents();

      bm25AgentSelector.load(allAgents.map(a => ({
        key:          a.id,
        name:         a.name,
        description:  a.description || '',
        practiceAreas: [a.practiceArea ?? a.category ?? 'general'].filter(Boolean) as string[],
        tier:         a.tier ?? 'L3',
        protocols:    (a.protocols ?? []) as string[],
      })));

      bm25Scores = agentPerformanceTracker.getAllScores();
      logger.info(`   📊 BM25 corpus loaded: ${allAgents.length} agents`);
    } catch { /* BM25 unavailable — fall back to capability scoring */ }

    for (const subtask of decomposition.subtasks) {
      const agent = this.findOptimalAgent(subtask, bm25Scores);
      if (agent) {
        subtask.assignedAgent = agent;
        logger.info(`   ✅ ${subtask.type} → ${agent.name} (${agent.tier}, ${agent.romaLevel})`);
      } else if ((subtask as SubtaskWithCapability).assignedCapabilityId) {
        // Capability-bound subtask: agent serves only as audit/accounting wrapper.
        // Use the first registered agent (or a synthetic one) so executor paths
        // that require subtask.assignedAgent still proceed via the manifest.
        const all = agentRegistry.getAllAgents().filter(a => a.status === 'active');
        const wrapper: Agent = all[0] ?? {
          id: 'manifest-wrapper',
          name: 'Manifest Capability Wrapper',
          tier: 'standard',
          romaLevel: 'L2',
          category: 'capability',
          capabilities: ['manifest-invoke'],
          status: 'active',
        };
        subtask.assignedAgent = wrapper;
        const capId = (subtask as SubtaskWithCapability).assignedCapabilityId;
        logger.info(`   🔗 ${subtask.type} → manifest:${capId} (wrapper agent: ${wrapper.name})`);
      } else {
        logger.warn(`   ⚠️ No suitable agent found for: ${subtask.type}`);
      }
    }
  }

  /**
   * Find the optimal agent for a subtask based on capabilities
   */
  private findOptimalAgent(subtask: Subtask, bm25Scores: Map<string, number> = new Map()): Agent | undefined {
    const allAgents = agentRegistry.getAllAgents();
    
    // Score each agent based on capability match
    const scoredAgents = allAgents
      .filter(agent => agent.status === 'active')
      .map(agent => {
        let score = 0;
        
        // Capability match
        for (const reqCap of subtask.requiredCapabilities) {
          if (agent.capabilities.some(cap => 
            cap.toLowerCase().includes(reqCap.toLowerCase()) ||
            reqCap.toLowerCase().includes(cap.toLowerCase())
          )) {
            score += 10;
          }
          if ((agent.category ?? '').toLowerCase().includes(reqCap.toLowerCase())) {
            score += 5;
          }
        }

        // ROMA level bonus (higher is better for complex tasks)
        const romaScore: Record<string, number> = { 'L5': 5, 'L4': 4, 'L3': 3, 'L2': 2, 'L1': 1 };
        const romaBonus = romaScore[agent.romaLevel ?? 'L1'] ?? 1;
        if (subtask.estimatedComplexity === 'complex') {
          score += romaBonus * 2;
        } else {
          score += romaBonus;
        }

        // Tier bonus
        if (subtask.estimatedComplexity === 'complex' && agent.tier === 'executive') {
          score += 5;
        }

        /* T005: BM25 performance boost (0–1 scale mapped to 0–10 points) */
        const perfScore = bm25Scores.get(agent.id) ?? 0.8;
        score += perfScore * 10;

        return { agent, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);

    return scoredAgents[0]?.agent;
  }

  // ================================================================================================
  // ORCHESTRATION EXECUTION
  // ================================================================================================

  /**
   * Execute the orchestration based on the selected pattern
   */
  private async executeOrchestration(
    decomposition: TaskDecomposition, 
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    logger.info(`⚡ Executing ${decomposition.orchestrationPattern} orchestration...`);

    switch (decomposition.orchestrationPattern) {
      case 'single_agent':
        return this.executeSingleAgent(decomposition, request);
      
      case 'sequential':
        return this.executeSequential(decomposition, request);
      
      case 'parallel':
        return this.executeParallel(decomposition, request);
      
      case 'dag':
        return this.executeDAG(decomposition, request);
      
      case 'swarm':
        return this.executeSwarm(decomposition, request);
      
      case 'hierarchical':
        return this.executeHierarchical(decomposition, request);
      
      default:
        return this.executeSingleAgent(decomposition, request);
    }
  }

  /**
   * Execute single agent pattern
   */
  private async executeSingleAgent(
    decomposition: TaskDecomposition, 
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    const subtask = decomposition.subtasks[0];
    if (!subtask?.assignedAgent) {
      throw new Error('No agent assigned for single agent execution');
    }

    // Single-agent: in PROD, real failures must propagate so callers see
    // a hard error. In dev/test, surface a visible failed AgentExecution
    // so synthesis can render it.
    try {
      const execution = await this.executeAgent(subtask.assignedAgent, subtask, request);
      return [execution];
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') throw err;
      const failedExec = this.buildFailedExecutionFromError(subtask, err instanceof Error ? err : new Error(String(err)));
      return [failedExec];
    }
  }

  /**
   * Execute sequential pattern (one after another)
   */
  private async executeSequential(
    decomposition: TaskDecomposition, 
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    const { policy } = resolveRequestPolicy(request);
    const executions: AgentExecution[] = [];
    const eligible = decomposition.subtasks.filter(s => s.assignedAgent);
    let failed = 0;

    for (const subtask of eligible) {
      try {
        const execution = await this.executeAgent(subtask.assignedAgent!, subtask, request);
        executions.push(execution);
        subtask.status = 'completed';
        subtask.result = execution.output;
      } catch (err: any) {
        failed++;
        subtask.status = 'failed';
        const failedExec = this.buildFailedExecutionFromError(subtask, err instanceof Error ? err : new Error(String(err)));
        executions.push(failedExec);
        const decision = evaluateFailures(policy, failed, eligible.length);
        if (decision.halt) {
          throw new Error(`executeSequential halted: ${decision.reason} (failed=${failed}/${eligible.length})`);
        }
      }
    }

    return executions;
  }

  /**
   * Execute parallel pattern (all at once) — uniform tier-policy enforcement.
   * Independent subtasks are bounded by `maxConcurrentNodes`, each capped at
   * `perNodeTimeoutMs`, and partial-failure behavior follows `failurePolicy`.
   */
  private async executeParallel(
    decomposition: TaskDecomposition, 
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    const { policy } = resolveRequestPolicy(request);
    const independentSubtasks = decomposition.subtasks.filter(s => s.dependencies.length === 0 && s.assignedAgent);
    const dependentSubtasks = decomposition.subtasks.filter(s => s.dependencies.length > 0 && s.assignedAgent);

    const parallelResults = await runWithConcurrency(
      independentSubtasks,
      (subtask) => this.executeAgent(subtask.assignedAgent!, subtask, request),
      { concurrency: policy.maxConcurrentNodes, timeoutMs: policy.perNodeTimeoutMs },
    );

    let failed = 0;
    const parallelExecutions: AgentExecution[] = [];
    for (let i = 0; i < independentSubtasks.length; i++) {
      const r = parallelResults[i];
      if (r?.value) {
        parallelExecutions.push(r.value);
        independentSubtasks[i].status = 'completed';
        independentSubtasks[i].result = r.value.output;
      } else if (r?.error) {
        failed++;
        independentSubtasks[i].status = 'failed';
        const failedExec = this.buildFailedExecutionFromError(independentSubtasks[i], r.error);
        parallelExecutions.push(failedExec);
        logger.warn(`parallel node failed: ${independentSubtasks[i].id}`, { err: r.error.message });
      }
    }
    const decision = evaluateFailures(policy, failed, independentSubtasks.length);
    if (decision.halt) {
      throw new Error(`executeParallel halted: ${decision.reason} (failed=${failed}/${independentSubtasks.length})`);
    }

    // Dependents — wave-by-wave (NYV-SDK-AUTO-ORCH-001 latency fix,
    // 2026-06-12). Previously this loop ran EVERY dependent strictly
    // sequentially, so an ADaPT plan (initial → N domain tasks → quality
    // check) serialized all N domain tasks even though they only depend on
    // the initial attempt — a complex orchestration burned 4× model latency
    // back-to-back and overran the 300s edge budget. Now each wave gathers
    // every dependent whose dependencies have completed and runs the wave
    // through the same bounded runner as the independent set (same
    // maxConcurrentNodes / perNodeTimeoutMs / failurePolicy semantics).
    const dependentExecutions: AgentExecution[] = [];
    let depFailed = 0;
    const completedIds = new Set(independentSubtasks.filter(s => s.status === 'completed').map(s => s.id));
    const pendingDependents = [...dependentSubtasks];
    while (pendingDependents.length > 0) {
      const waveIdx = pendingDependents.reduce<number[]>((acc, s, i) => {
        if (s.dependencies.every(d => completedIds.has(d))) acc.push(i);
        return acc;
      }, []);
      // No dependent is ready (deps failed or missing) — run the remainder
      // anyway, preserving the legacy behaviour of attempting every subtask.
      const wave = (waveIdx.length > 0 ? waveIdx : pendingDependents.map((_, i) => i))
        .map(i => pendingDependents[i]);
      for (let i = pendingDependents.length - 1; i >= 0; i--) {
        if (wave.includes(pendingDependents[i])) pendingDependents.splice(i, 1);
      }

      const waveResults = await runWithConcurrency(
        wave,
        (subtask) => this.executeAgent(subtask.assignedAgent!, subtask, request),
        { concurrency: policy.maxConcurrentNodes, timeoutMs: policy.perNodeTimeoutMs },
      );
      for (let i = 0; i < wave.length; i++) {
        const subtask = wave[i];
        const r = waveResults[i];
        if (r?.value) {
          dependentExecutions.push(r.value);
          subtask.status = 'completed';
          subtask.result = r.value.output;
          completedIds.add(subtask.id);
        } else {
          depFailed++;
          subtask.status = 'failed';
          const err = r?.error ?? new Error('unknown dependent failure');
          dependentExecutions.push(this.buildFailedExecutionFromError(subtask, err));
          const decision = evaluateFailures(policy, depFailed, dependentSubtasks.length);
          if (decision.halt) {
            throw new Error(`executeParallel(dependents) halted: ${decision.reason}`);
          }
        }
      }
    }

    return [...parallelExecutions, ...dependentExecutions];
  }

  /**
   * Execute DAG pattern — wave-by-wave, each wave bounded by tier policy.
   */
  private async executeDAG(
    decomposition: TaskDecomposition, 
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    const { policy } = resolveRequestPolicy(request);
    const executions: AgentExecution[] = [];
    const completed = new Set<string>();
    const failedIds = new Set<string>();
    let totalFailed = 0;

    while (completed.size + failedIds.size < decomposition.subtasks.length) {
      const readySubtasks = decomposition.subtasks.filter(subtask =>
        !completed.has(subtask.id) &&
        !failedIds.has(subtask.id) &&
        subtask.assignedAgent &&
        subtask.dependencies.every(dep => completed.has(dep))
      );

      if (readySubtasks.length === 0) {
        logger.warn('⚠️ DAG execution stalled - no ready subtasks');
        break;
      }

      const waveResults = await runWithConcurrency(
        readySubtasks,
        (subtask) => this.executeAgent(subtask.assignedAgent!, subtask, request),
        { concurrency: policy.maxConcurrentNodes, timeoutMs: policy.perNodeTimeoutMs },
      );

      for (let i = 0; i < readySubtasks.length; i++) {
        const r = waveResults[i];
        if (r?.value) {
          completed.add(readySubtasks[i].id);
          readySubtasks[i].status = 'completed';
          readySubtasks[i].result = r.value.output;
          executions.push(r.value);
        } else if (r?.error) {
          totalFailed++;
          failedIds.add(readySubtasks[i].id);
          readySubtasks[i].status = 'failed';
          executions.push(this.buildFailedExecutionFromError(readySubtasks[i], r.error));
          logger.warn(`dag node failed: ${readySubtasks[i].id}`, { err: r.error.message });
        }
      }
      const decision = evaluateFailures(policy, totalFailed, executions.length + totalFailed);
      if (decision.halt) {
        throw new Error(`executeDAG halted: ${decision.reason} (failed=${totalFailed})`);
      }
    }

    return executions;
  }

  /**
   * Execute swarm pattern — exploration parallelized under tier policy,
   * aggregation runs sequentially after.
   */
  private async executeSwarm(
    decomposition: TaskDecomposition, 
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    const { policy } = resolveRequestPolicy(request);
    const swarmSubtasks = decomposition.subtasks.filter(s => s.type === 'swarm_exploration' && s.assignedAgent);
    const aggregationSubtask = decomposition.subtasks.find(s => s.type === 'swarm_aggregation');

    const swarmResults = await runWithConcurrency(
      swarmSubtasks,
      (subtask) => this.executeAgent(subtask.assignedAgent!, subtask, request),
      { concurrency: policy.maxConcurrentNodes, timeoutMs: policy.perNodeTimeoutMs },
    );

    let failed = 0;
    const swarmExecutions: AgentExecution[] = [];
    for (let i = 0; i < swarmSubtasks.length; i++) {
      const r = swarmResults[i];
      if (r?.value) {
        swarmExecutions.push(r.value);
        swarmSubtasks[i].status = 'completed';
        swarmSubtasks[i].result = r.value.output;
      } else if (r?.error) {
        failed++;
        swarmSubtasks[i].status = 'failed';
        swarmExecutions.push(this.buildFailedExecutionFromError(swarmSubtasks[i], r.error));
        logger.warn(`swarm node failed: ${swarmSubtasks[i].id}`, { err: r.error.message });
      }
    }
    const decision = evaluateFailures(policy, failed, swarmSubtasks.length);
    if (decision.halt) {
      throw new Error(`executeSwarm halted: ${decision.reason} (failed=${failed}/${swarmSubtasks.length})`);
    }

    const executions: AgentExecution[] = [...swarmExecutions];
    if (aggregationSubtask?.assignedAgent) {
      const aggregationExecution = await this.executeAgent(
        aggregationSubtask.assignedAgent,
        aggregationSubtask,
        request
      );
      aggregationSubtask.status = 'completed';
      aggregationSubtask.result = aggregationExecution.output;
      executions.push(aggregationExecution);
    }

    return executions;
  }

  /**
   * Execute hierarchical pattern — real manager→worker level execution.
   *
   * NV-ORCH-HIER-001 (Session-33): unlike `executeDAG` (which only *gates*
   * ordering on dependency completion), the hierarchical executor threads each
   * completed parent level's output into its child subtasks' context before they
   * run, so downstream "worker" agents genuinely build on upstream "manager"
   * findings. Each level runs bounded by the tier concurrency/timeout policy.
   */
  private async executeHierarchical(
    decomposition: TaskDecomposition,
    request: OrchestrationRequest
  ): Promise<AgentExecution[]> {
    const { policy } = resolveRequestPolicy(request);
    const executions: AgentExecution[] = [];
    const completed = new Map<string, string>(); // subtaskId → output summary
    const failedIds = new Set<string>();
    let totalFailed = 0;
    const wallStarted = Date.now();
    let levelsRun = 0;

    while (completed.size + failedIds.size < decomposition.subtasks.length) {
      // NV-TIMEOUT-POLICY-001: stop hierarchical blow-ups under ALB 600s
      if (Date.now() - wallStarted > policy.wallClockMs) {
        logger.warn('hierarchical wall-clock budget exhausted', {
          wallClockMs: policy.wallClockMs,
          completed: completed.size,
          failed: failedIds.size,
        });
        break;
      }
      if (levelsRun >= policy.maxHierarchyDepth) {
        logger.warn('hierarchical maxHierarchyDepth reached', {
          maxHierarchyDepth: policy.maxHierarchyDepth,
          completed: completed.size,
        });
        break;
      }
      levelsRun += 1;

      const readySubtasks = decomposition.subtasks.filter(subtask =>
        !completed.has(subtask.id) &&
        !failedIds.has(subtask.id) &&
        subtask.assignedAgent &&
        subtask.dependencies.every(dep => completed.has(dep))
      );

      if (readySubtasks.length === 0) {
        logger.warn('⚠️ Hierarchical execution stalled - no ready subtasks');
        break;
      }

      // Thread completed parent outputs into each ready child's context so the
      // worker builds on the manager's findings (the real hierarchy behaviour).
      for (const st of readySubtasks) {
        const upstream = st.dependencies
          .map(dep => completed.get(dep))
          .filter((x): x is string => typeof x === 'string' && x.length > 0);
        if (upstream.length > 0) {
          st.description = `${st.description}\n\nUPSTREAM FINDINGS (from parent tasks — build on these, do not repeat):\n${upstream.map((u, i) => `[${i + 1}] ${u}`).join('\n')}`;
        }
      }

      const waveResults = await runWithConcurrency(
        readySubtasks,
        (subtask) => this.executeAgent(subtask.assignedAgent!, subtask, request),
        { concurrency: policy.maxConcurrentNodes, timeoutMs: policy.perNodeTimeoutMs },
      );

      for (let i = 0; i < readySubtasks.length; i++) {
        const r = waveResults[i];
        if (r?.value) {
          readySubtasks[i].status = 'completed';
          readySubtasks[i].result = r.value.output;
          const outStr = typeof r.value.output === 'string' ? r.value.output : JSON.stringify(r.value.output ?? '');
          completed.set(readySubtasks[i].id, outStr.slice(0, 600));
          executions.push(r.value);
        } else if (r?.error) {
          totalFailed++;
          failedIds.add(readySubtasks[i].id);
          readySubtasks[i].status = 'failed';
          executions.push(this.buildFailedExecutionFromError(readySubtasks[i], r.error));
          logger.warn(`hierarchical node failed: ${readySubtasks[i].id}`, { err: r.error.message });
        }
      }
      const decision = evaluateFailures(policy, totalFailed, executions.length + totalFailed);
      if (decision.halt) {
        throw new Error(`executeHierarchical halted: ${decision.reason} (failed=${totalFailed})`);
      }
    }

    return executions;
  }

  /**
   * Execute a single agent on a subtask
   */
  private async executeAgent(
    agent: Agent, 
    subtask: Subtask, 
    request: OrchestrationRequest
  ): Promise<AgentExecution> {
    // NYV-ORCH-PER-REQUEST-EMITTER-002 (post-architect 2026-05-05): lazy
    // initialise per-request emitter + orchestrationId AT THE PUBLIC
    // ENTRY (before withSpan tags resolve) so callers that bypass
    // orchestrate() — single-agent retries, AG-UI single-agent route,
    // smoke tests — don't trigger the requireOrchestrationId() invariant
    // throw at line ~2199. Was previously initialised inside
    // _executeAgentInner; that's too late because withSpan reads
    // requireOrchestrationId() in the tag block before the inner runs.
    if (!request.lifecycleEvents) {
      request.lifecycleEvents = new QueenLifecycleEmitter();
    }
    if (!request.orchestrationId) {
      request.orchestrationId = `orch-direct-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    }
    // NYV-OBS-AGENT-SPAN-001 (Task #28 round 2): wrap each agent execution
    // in a "queen.agent" span so /admin/health/full reports per-agent
    // boundaries (count, p50/p95/p99 latency, success/error rate) and
    // pattern-tagged buckets via TRACKED_TAG_KEYS. The span auto-finishes
    // with status=error on throw, matching the rest of the lifecycle.
    // NYV-OBS-SPAN-CONTEXT-001 (Task #61): parent the queen.agent span
    // DIRECTLY to the orchestration run's root via the tracer's typed
    // run-root ALS slot — preserving the original __rootSpan contract
    // where per-agent spans attached straight to queen.orchestrate
    // instead of nesting under the enclosing queen.execute phase span.
    // The lookup is implicit: orchestrate() pinned the root span at run
    // entry, so nothing has to be threaded through the call chain or
    // stashed on the request. A future per-agent code path that calls
    // executeAgent() inside the same orchestrate() run gets correct
    // parenting for free.
    const _ext = asExt(request);
    return withSpan(
      'queen.agent',
      {
        op: 'queen.agent',
        parent: getRunRootSpan(),
        tags: {
          orchestrationId: requireOrchestrationId(request),
          tenantId:        _ext.tenantId ?? 'unknown',
          subtaskId:       subtask.id,
          subtaskType:     subtask.type,
          agentId:         agent.id,
          agentName:       agent.name,
          agentTier:       agent.tier,
          romaLevel:       agent.romaLevel,
          jurisdiction:    _ext.jurisdiction ?? '',
          tier:            resolveRequestPolicy(request).tier,
        },
      },
      (span) => this._executeAgentInner(agent, subtask, request, span),
    );
  }

  private async _executeAgentInner(
    agent: Agent,
    subtask: Subtask,
    request: OrchestrationRequest,
    span: NyvSpan,
  ): Promise<AgentExecution> {
    const startTime = Date.now();
    logger.info(`   🤖 Executing: ${agent.name} on "${subtask.type}"`);

    subtask.status = 'in_progress';

    // NYV-ORCH-PER-REQUEST-EMITTER-002 (post-architect 2026-05-05):
    // orchestrate() lazy-creates `request.lifecycleEvents` AND
    // `request.orchestrationId` at entry, but executeAgent() is also a
    // public path (used by per-agent retries, unit tests, and the AG-UI
    // single-agent route). When the caller bypasses orchestrate() we must
    // initialise BOTH here too — otherwise emitLifecycle() and
    // requireOrchestrationId() throw invariant errors and the agent run
    // never starts. Tests that exercise this path:
    //   tests/orchestration/smoke.test.ts (executes a single agent
    //   without calling orchestrate()).
    if (!request.lifecycleEvents) {
      request.lifecycleEvents = new QueenLifecycleEmitter();
    }
    if (!request.orchestrationId) {
      request.orchestrationId = `orch-direct-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    }

    // NYV-ORCH-LIFECYCLE-002 (Task #27): emit per-agent lifecycle so AG-UI
    // streaming subscribers can render real "agent started / agent completed"
    // events tied to the actual orchestration plan (not decorative).
    this.emitLifecycle(request, 'agent_started', {
      orchestrationId: requireOrchestrationId(request),
      subtaskId:   subtask.id,
      subtaskType: subtask.type,
      agentId:     agent.id,
      agentName:   agent.name,
      agentTier:   agent.tier,
      romaLevel:   agent.romaLevel,
      description: String(subtask.description || '').slice(0, 240),
    });

    try {
      // NYV-ORCH-MANIFEST-DISPATCH-001 (Task #32 round 3): if this subtask
      // was bound to a manifest capability during bindCapabilitiesToSubtasks(),
      // route the call through the manifest invoker. This makes the manifest
      // the SSoT for execution — agent serves only as a metadata wrapper for
      // accounting/audit. Falls back to the legacy LLM path on failure or when
      // no binding exists.
      //
      // NYV-ORCH-MW-003 (Task #34, code-review round 2): the manifest dispatch
      // path ALWAYS flows through withMiddleware() — same as the LLM path —
      // so EVERY Queen-dispatched answer (LLM or manifest-bound, regardless
      // of capability id) is checked by the safety ring (hallucination/bias/
      // citation/PII/HITL/governance) and gets a recorded safety verdict in
      // the audit log. There is NO capability-id exemption allowlist; the
      // recursion-safety concern that motivated the previous allowlist is
      // now handled INSIDE withMiddleware via an AsyncLocalStorage re-entry
      // guard (see orchestration-middleware.ts).
      const capabilityId: string | undefined = (subtask as SubtaskWithCapability).assignedCapabilityId;
      if (capabilityId && capabilityManifest.get(capabilityId)) {
        try {
          const reqExt = asExt(request);
          const ctx: import('./capability-manifest.js').CapabilityContext = {
            tier: resolveRequestPolicy(request).tier,
            jurisdiction: inferJurisdiction({
              explicit:      reqExt.jurisdiction ?? null,
              userProfile:   reqExt.userJurisdiction ?? null,
              tenantDefault: reqExt.tenantJurisdiction ?? null,
            }).jurisdiction,
            userId:    reqExt.userId,
            tenantId:  reqExt.tenantId,
            requestId: reqExt.id ?? reqExt.requestId,
            agentKey:  agent.id,
          };
          const promptText = String(subtask.description || request.prompt || '').trim();
          const capInput = {
            // Aliases: rag.search expects `query`; auto-select accepts query|prompt.
            query: promptText,
            prompt: promptText,
            originalPrompt: String(request.prompt || ''),
            text: promptText,
            subtaskType: subtask.type,
            requiredCapabilities: subtask.requiredCapabilities ?? [],
            jurisdiction: ctx.jurisdiction,
            topK: 8,
          };

          // Retrieval / routing caps must ground the LLM — not replace the answer.
          // Returning only RAG JSON or auto-select metadata is a drafting failure for NSP/NYM.
          const CONTEXT_ONLY_CAPS = new Set([
            'rag.search',
            'memory.tiered.recall',
            'agent.auto-select',
          ]);

          let manifestContextInject = '';
          if (CONTEXT_ONLY_CAPS.has(capabilityId)) {
            try {
              const capResult = await capabilityManifest.invoke(capabilityId, capInput, ctx);
              if (capabilityId === 'rag.search' && capResult && typeof capResult === 'object') {
                const block = String((capResult as any).contextBlock || '').trim();
                if (block) manifestContextInject = `\n\nRAG GROUNDING (cite; do not invent):\n${block}\n`;
                else manifestContextInject = `\n\nRAG RESULT:\n${JSON.stringify(capResult).slice(0, 6000)}\n`;
              } else if (capabilityId === 'memory.tiered.recall') {
                manifestContextInject = `\n\nMEMORY RECALL:\n${typeof capResult === 'string' ? capResult : JSON.stringify(capResult).slice(0, 4000)}\n`;
              } else if (capabilityId === 'agent.auto-select') {
                manifestContextInject = `\n\nAGENT ROUTING HINT:\n${typeof capResult === 'string' ? capResult : JSON.stringify(capResult).slice(0, 2000)}\n`;
              }
              logger.info(`   ✅ Capability ${capabilityId} grounded LLM path (context-only; never terminal)`);
            } catch (ctxCapErr: any) {
              logger.warn(`   ⚠️  Context capability ${capabilityId} failed (non-fatal; LLM continues)`, {
                error: ctxCapErr?.message,
              });
            }
            // Stash for toolContextBlock merge below (per-agent local via closure var).
            (subtask as any).__nyvManifestContextInject = manifestContextInject;
            // Fall through to LLM agent path below.
          } else {
          const { withMiddleware } = await import('./orchestration-middleware.js');
          const wrapped = await withMiddleware(
            withQueenRagSkip(
              {
                prompt: subtask.description || request.prompt,
                agentKey: agent.id,
                tier: ctx.tier,
                jurisdiction: ctx.jurisdiction,
                userId: ctx.userId,
                tenantId: ctx.tenantId,
                requestId: ctx.requestId,
                riskLevel: (['low', 'medium', 'high', 'critical'].includes(String(reqExt.riskLevel))
                  ? (reqExt.riskLevel as 'low' | 'medium' | 'high' | 'critical')
                  : 'medium'),
              },
              request,
            ),
            async () => {
              const capResult = await capabilityManifest.invoke(capabilityId, capInput, ctx);
              const text = typeof capResult === 'string' ? capResult : JSON.stringify(capResult);
              return {
                output: text,
                // Tagged so governance/metering can distinguish manifest
                // dispatches from real LLM dispatches in the audit trail.
                model: `manifest:${capabilityId}`,
                provider: 'manifest',
                tokens: {
                  input: Math.ceil((subtask.description?.length ?? 0) / 4),
                  output: Math.ceil(text.length / 4),
                },
              };
            },
          );
          stampSafetyVerdict(request, wrapped.post, 'queen.manifest');
          const outputStr = wrapped.output;

          const manifestExec: AgentExecution = {
            agentId: agent.id,
            agentName: agent.name,
            subtaskId: subtask.id,
            startTime,
            endTime: Date.now(),
            status: 'completed',
            output: outputStr,
            tokens: { input: Math.ceil((subtask.description?.length ?? 0) / 4), output: Math.ceil(outputStr.length / 4) },
            cost: 0.001,
            model: `manifest:${capabilityId}`,
          };
          this.emitLifecycle(request, 'agent_completed', {
            orchestrationId: requireOrchestrationId(request),
            subtaskId: subtask.id,
            agentId: agent.id,
            agentName: agent.name,
            durationMs: Date.now() - startTime,
            outputPreview: outputStr.slice(0, 240),
            outputLength: outputStr.length,
            via: 'manifest',
            capability: capabilityId,
          });
          return manifestExec;
          } // end non-context-only terminal manifest path
        } catch (capErr: any) {
          // NV-QUEEN-NEVER-MISS-001: recoverable caps fall through to LLM even in PROD.
          // Safety-ring rejections (middleware) still fail loud.
          const msg = String(capErr?.message || capErr || '');
          // NV-QUEEN-CAPERR-CLASSIFY-001 — a crash inside a safety capability is
          // a BUG, not a policy verdict. Measured: `safety.hallucination-check`
          // threw `Cannot read properties of undefined (reading 'match')` when
          // invoked as a subtask leaf with no upstream output; because the id
          // starts with `safety.` it was treated as a rejection and killed the
          // whole agent in production. Programmer errors must degrade, not fail.
          const isProgrammerError =
            capErr instanceof TypeError
            || capErr instanceof ReferenceError
            || capErr instanceof SyntaxError
            || /is not a function|cannot read propert|undefined is not|null is not/i.test(msg);
          const safetyReject = !isProgrammerError
            && (/safety|compliance|BANNED|policy.?violation|verdict/i.test(msg)
              || capabilityId.startsWith('safety.'));
          if (safetyReject && process.env.NODE_ENV === 'production') {
            logger.error(`   ❌ Capability ${capabilityId} failed in PROD — refusing legacy fallback`, { error: capErr?.message });
            throw capErr;
          }
          if (isProgrammerError) {
            logger.error(`   🐞 Capability ${capabilityId} crashed (defect, not a policy verdict) — degrading to LLM agent path`, {
              error: msg,
              errorType: capErr?.constructor?.name,
            });
          } else {
            logger.warn(`   ⚠️  Capability ${capabilityId} failed; falling back to LLM agent path (never-miss)`, { error: capErr?.message });
          }
        }
      }

      // NV-AGENT-TOOL-BRIDGE-001: registry tools/mcp → capability leaves.
      // Cost-capped pre-invoke (skips RAG/auto-select — Queen Step-0 already RAGs).
      const resolvedCaps = resolveCapabilityIdsFromAgentTools({
        tools: agent.tools,
        mcpToolsAllowed: agent.mcpToolsAllowed,
        preferredTools: agent.preferredTools,
        boundCapabilities: agent.capabilities,
      });
      const promptBlob = `${subtask.description || ''} ${request.prompt || ''}`.toLowerCase();
      const SKIP_PRE = new Set(['rag.search', 'agent.auto-select', 'memory.tiered.recall', 'memory.tiered.store']);
      const preCandidates = resolvedCaps.filter((id) => {
        if (SKIP_PRE.has(id)) return false;
        const leafHint = id.split('.').pop() || id;
        return promptBlob.includes(leafHint.replace(/-/g, ''))
          || promptBlob.includes(leafHint)
          || promptBlob.includes(id);
      });
      let toolContextBlock = String((subtask as any).__nyvManifestContextInject || '');
      if (preCandidates.length > 0) {
        const reqExt = asExt(request);
        const pre = await preInvokeAgentCapabilities({
          capabilityIds: preCandidates,
          prompt: subtask.description || request.prompt,
          subtaskType: subtask.type,
          ctx: {
            tier: resolveRequestPolicy(request).tier,
            jurisdiction: inferJurisdiction({
              explicit: reqExt.jurisdiction ?? null,
              userProfile: reqExt.userJurisdiction ?? null,
              tenantDefault: reqExt.tenantJurisdiction ?? null,
            }).jurisdiction,
            userId: reqExt.userId,
            tenantId: reqExt.tenantId,
            requestId: reqExt.id ?? reqExt.requestId,
            agentKey: agent.id,
          },
        });
        if (pre.snippets.length) {
          toolContextBlock += `\n\nTOOL PRE-INVOKE RESULTS (cite these; do not invent):\n${pre.snippets.join('\n\n')}\n`;
        }
      }

      // Build the prompt for this agent
      const agentPrompt = this.buildAgentPrompt(agent, subtask, request) + toolContextBlock;

      /* NV-QUEEN-LEAF-TIER-001: classify this node before dispatch. Exploration
       * leaves feed a synthesis node and are routed cheap/fast; synthesis nodes
       * author user-visible output and keep the premium path. */
      const nodeRole = classifyQueenNodeRole(subtask);

      // Simulate agent execution (in production, this calls the LLM)
      // NYV-ORCH-CACHE-001 (Task #38): callAgent now returns whether the
      // answer came from the prompt cache so we can mark `cacheHit` on the
      // execution and emit `via: 'cache'` instead of `via: 'llm'`.
      const { output, cacheHit } = await this.callAgent(agent, agentPrompt, request, nodeRole);

      const execution: AgentExecution = {
        agentId: agent.id,
        agentName: agent.name,
        subtaskId: subtask.id,
        startTime,
        endTime: Date.now(),
        status: 'completed',
        output,
        tokens: { input: agentPrompt.length / 4, output: output.length / 4 },
        cost: cacheHit ? 0 : 0.001, // Estimated; cache hits incur no LLM cost
        model: agent.preferredModels?.[0] ?? 'deepseek.v3.2',
        cacheHit,
      };

      this.emitLifecycle(request, 'agent_completed', {
        orchestrationId: requireOrchestrationId(request),
        subtaskId:     subtask.id,
        agentId:       agent.id,
        agentName:     agent.name,
        durationMs:    Date.now() - startTime,
        outputPreview: typeof output === 'string' ? output.slice(0, 240) : '',
        outputLength:  typeof output === 'string' ? output.length : 0,
        via:           cacheHit ? 'cache' : 'llm',
        model:         execution.model,
      });

      try {
        romaL5Engine.trackOutcome(agent.id, {
          success: true,
          latencyMs: Date.now() - startTime,
          usedFallback: false,
          hallucinationDetected: false,
        });
      } catch {
        /* ROMA learning must never fail the Queen turn */
      }

      return execution;

    } catch (error: unknown) {
      // NYV-ORCH-FAILLOUD-001 (Task #32 round 4): executeAgent must propagate
      // real errors so the failure-policy primitives (runWithConcurrency +
      // evaluateFailures) see them as r.error, not as soft "completed-with-
      // failed-status" values. Sequential / single-agent paths catch this
      // and synthesize a visible failed AgentExecution for synthesis;
      // parallel / DAG / swarm paths use the helper below to do the same.
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`   ❌ Agent ${agent.name} failed: ${msg}`);
      this.emitLifecycle(request, 'agent_failed', {
        orchestrationId: requireOrchestrationId(request),
        subtaskId: subtask.id,
        agentId:   agent.id,
        agentName: agent.name,
        error:     msg.slice(0, 400),
        durationMs: Date.now() - startTime,
      });
      try {
        romaL5Engine.trackOutcome(agent.id, {
          success: false,
          latencyMs: Date.now() - startTime,
          usedFallback: false,
          hallucinationDetected: false,
          errorCode: 'agent_failed',
        });
      } catch {
        /* ROMA learning must never fail the Queen turn */
      }
      const wrapped: Error & { agentExecution?: AgentExecution } =
        error instanceof Error ? (error as Error & { agentExecution?: AgentExecution }) : new Error(msg);
      wrapped.agentExecution = {
        agentId: agent.id,
        agentName: agent.name,
        subtaskId: subtask.id,
        startTime,
        endTime: Date.now(),
        status: 'failed' as const,
        output: `Error: ${msg}`,
      };
      throw wrapped;
    }
  }

  /**
   * Convert a runWithConcurrency error result into a visible failed
   * AgentExecution so synthesizeResults can surface it in the response.
   */
  private buildFailedExecutionFromError(subtask: Subtask, err: Error): AgentExecution {
    const carried = (err as Error & { agentExecution?: AgentExecution }).agentExecution;
    if (carried) return carried;
    const now = Date.now();
    return {
      agentId: subtask.assignedAgent?.id ?? 'unknown',
      agentName: subtask.assignedAgent?.name ?? 'unknown',
      subtaskId: subtask.id,
      startTime: now,
      endTime: now,
      status: 'failed',
      output: `Error: ${err.message}`,
    };
  }

  /**
   * Build a prompt for an agent based on the subtask
   */
  private buildAgentPrompt(agent: Agent, subtask: Subtask, request: OrchestrationRequest): string {
    const { prompt: systemContext, jurisdiction, source, promptBytes } = resolveAgentSystemPrompt(agent, request);
    logger.debug({
      msg: 'buildAgentPrompt resolved system context',
      agentId: agent.id,
      jurisdiction,
      source,
      promptBytes,
    });

    // NYV-ORCH-COORD-001 (Task #27): inject the cross-cutting Parlant + BMAD
    // directives + language coordination at every agent prompt so each subtask
    // shares one disciplined behavioural contract. Synthesis re-applies these
    // at fan-in time to keep the final output consistent with subtask outputs.
    const language = (request.language || 'en').toLowerCase();
    const langDirective = (language && language !== 'en')
      ? `\n- Output Language: ${this.languageName(language)} (${language}) — write your entire response in this language; preserve statute names, case names and legal Latin verbatim.`
      : '';

    // NV-PATTERN-DISPATCH-001: inject the auto-selected agentic pattern's
    // behavioural directive so the agent genuinely executes per the pattern
    // (CoT / Reflection / ToT / Maker-Checker / RAG-grounding / …). Set on the
    // request by orchestrate() after pattern auto-selection.
    const patternDirective = asExt(request).patternDirective;
    const patternBlock = patternDirective
      ? `\n\nAGENTIC PATTERN (mandatory execution style):\n- ${patternDirective}`
      : '';

    const reqFormat = (request.format || (request.preferences?.outputFormat as string) || 'markdown').toLowerCase();
    const formatDirective = (() => {
      switch (reqFormat) {
        case 'json':       return '- Output Format: respond with a single VALID JSON object (no surrounding prose, no markdown fences).';
        case 'narrative':  return '- Output Format: flowing professional narrative — no bullet lists, no markdown headers.';
        case 'structured': return '- Output Format: explicit sections — Answer · Reasoning · Citations · Risk · Next Steps.';
        default:           return '- Output Format: clean Markdown with headings, lists, and quoted citations where useful.';
      }
    })();

    const parlantBmad = `

PARLANT STANDARDS (mandatory):
1. EVIDENCE-FIRST — every legal proposition is tied to a specific statute (with section number), case (with citation, year, court), or regulatory instrument. If the source isn't available, write "source unavailable" — never invent.
2. NO-HALLUCINATION LOCK — refuse to fabricate section numbers, case names, dates, or party names. Name what is missing instead of guessing.
3. CITATION FORMAT — Indian: "Section X of <Act>, <Year>"; UK: OSCOLA; US: Bluebook; EU/SG/GC: local accepted form. Always include year + court for cases.
4. SCOPE DISCIPLINE — answer ONLY the assigned subtask; do not silently widen scope.

BMAD BEHAVIOURAL FRAMEWORK:
- ROLE: ${agent.name} (${agent.tier} tier, ROMA ${agent.romaLevel || 'L2'})
- TONE: precise professional counsel — formal, accessible, no marketing language.
- STRUCTURE: lead with the answer, then reasoning, then citations.
- CONFIDENCE: state confidence explicitly when uncertain ("medium-confidence", "high-confidence").
- ESCALATION: if the matter exceeds your tier or autonomy, say so and recommend escalation.`;

    const resolvedCaps = resolveCapabilityIdsFromAgentTools({
      tools: agent.tools,
      mcpToolsAllowed: agent.mcpToolsAllowed,
      preferredTools: agent.preferredTools,
      boundCapabilities: agent.capabilities,
    });
    const toolsBlock = formatAgentToolDirective(resolvedCaps);

    return `${systemContext}

TASK: ${subtask.description}

ORIGINAL REQUEST: ${request.prompt}

CONTEXT:
- Task Type: ${subtask.type}
- Complexity: ${subtask.estimatedComplexity}
- Your Role: ${agent.tier} tier, ${agent.romaLevel} autonomy level
- Jurisdiction: ${jurisdiction}${langDirective}
${formatDirective}${patternBlock}
${parlantBmad}${toolsBlock}

Produce the highest-quality output for this subtask. Adhere strictly to all 23 sections of your system prompt above (identity, capabilities, jurisdiction, knowledge, patterns, tools, hitl, guardrails, output, citation, language, security, compliance, memory, collaboration, escalation, audit, errors, performance, quantum, grpo, behavioral, data-privacy-pii-redaction).`;
  }

  /**
   * Map an ISO-639 code to its display name. Used by the language coordinator
   * to render directives the LLM can act on. Falls back to the code itself
   * when no friendly name is registered.
   */
  private languageName(code: string): string {
    const map: Record<string, string> = {
      en: 'English',  hi: 'Hindi',     ta: 'Tamil',     te: 'Telugu',
      bn: 'Bengali',  mr: 'Marathi',   gu: 'Gujarati',  kn: 'Kannada',
      ml: 'Malayalam',pa: 'Punjabi',   ur: 'Urdu',      or: 'Odia',
      as: 'Assamese', sa: 'Sanskrit',  sd: 'Sindhi',    ne: 'Nepali',
      ar: 'Arabic',   fr: 'French',    es: 'Spanish',   de: 'German',
      pt: 'Portuguese', ja: 'Japanese',zh: 'Chinese',   ko: 'Korean',
    };
    return map[code] || code;
  }

  /**
   * NYV-ORCH-CACHE-001 (Task #38): build the prompt-cache namespace for a
   * given agent dispatch. Cache entries are scoped per
   *   tenant × jurisdiction × agent
   * so that two tenants asking the same question never share a cached
   * answer (cross-tenant leak prevention) and so that the same prompt
   * routed to two different agents (e.g. `litigation` vs `compliance`) is
   * cached independently. Missing tenant/jurisdiction fall back to stable
   * sentinels so the namespace is deterministic.
   */
  private buildCacheNamespace(agent: Agent, reqExt: OrchRequestExt): string {
    // NYV-CACHE-NS-001 (Task #66): namespace shape lives in a shared helper
    // so admin invalidation routes (`/cache/admin/invalidate-*`) and the CLI
    // ops script can target the exact same buckets we wrote to here.
    const tenantId = reqExt.tenantId == null ? undefined : String(reqExt.tenantId);
    const jurisdiction = reqExt.jurisdiction == null ? undefined : String(reqExt.jurisdiction);
    return buildAgentCacheNamespace({ tenantId, jurisdiction, agentId: agent.id });
  }

  /**
   * Call the agent via the RealLLMService for production LLM inference.
   *
   * NYV-ORCH-CACHE-001 (Task #38): returns `{ output, cacheHit }` so the
   * caller (executeAgent) can stamp the AgentExecution with the cache flag
   * and emit `via: 'cache' | 'llm'` correctly. The cache decision happens
   * inside callAgentInner; this wrapper carries the flag back through the
   * middleware ring (which only forwards `output`).
   */
  private async callAgent(
    agent: Agent,
    prompt: string,
    request: OrchestrationRequest,
    role: QueenNodeRole = 'synthesis',
  ): Promise<{ output: string; cacheHit: boolean }> {
    // NYV-ORCH-MW-001: every agent dispatch flows through the orchestration
    // middleware ring (consent → memory → RAG → safety → exec → hallucination
    // → bias → memory persist → metering → audit) so all decomposition
    // patterns share one uniform contract.
    const { withMiddleware } = await import('./orchestration-middleware.js');
    const { mapBillingTierToCapabilityTier } = await import('./capability-manifest.js');

    const reqExt = asExt(request);
    let cacheHit = false;
    const wrapped = await withMiddleware(
      withQueenRagSkip(
        {
          prompt,
          agentKey: agent.id,
          tier: mapBillingTierToCapabilityTier(String(reqExt.tier ?? agent.tier ?? 'lite')),
          jurisdiction: reqExt.jurisdiction,
          userId: reqExt.userId,
          tenantId: reqExt.tenantId,
          requestId: reqExt.id ?? reqExt.requestId,
          riskLevel: (['low','medium','high','critical'].includes(String(reqExt.riskLevel))
            ? (reqExt.riskLevel as 'low' | 'medium' | 'high' | 'critical')
            : 'medium'),
        },
        request,
      ),
      async (pre) => {
        const out = await this.callAgentInner(agent, pre.enrichedPrompt, request, role);
        cacheHit = out.cacheHit;
        // NYV-ORCH-MW-002 (round 10c): hand the resolved {model, provider}
        // back to post-middleware so governance.model-policy runs uniformly
        // for every orchestrated dispatch — never gated on absent metadata.
        return {
          output: out.content,
          model: out.model,
          provider: out.provider,
          tokens: { input: Math.ceil(pre.enrichedPrompt.length / 4), output: Math.ceil(out.content.length / 4) },
        };
      },
    );
    stampSafetyVerdict(request, wrapped.post, `queen.agent:${agent.id}`);
    return { output: wrapped.output, cacheHit };
  }

  /**
   * Inner LLM call (post-middleware). Kept private so external callers always
   * traverse the middleware ring via callAgent above.
   */
  private async callAgentInner(
    agent: Agent,
    prompt: string,
    request: OrchestrationRequest,
    role: QueenNodeRole = 'synthesis',
  ): Promise<{ content: string; model: string; provider: string; cacheHit: boolean }> {
    const startMs = Date.now();
    const reqExt = asExt(request);
    const callJurisdiction =
      typeof reqExt.jurisdiction === 'string' ? reqExt.jurisdiction : undefined;

    /* NYV-ORCH-SMART-003 (Task #33): live concurrency tracking so the
     * smart router can deprioritize already-busy agents. Increment up
     * front and always decrement in the outer finally block — even when
     * the LLM call throws OR we return early on a cache hit — so the
     * counter never leaks. */
    const { agentPerformanceTracker } = await import('../services/agent-performance-tracker.js');
    agentPerformanceTracker.beginExecution(agent.id);

    // NYV-ORCH-CACHE-001 (Task #38): cache namespace is scoped per
    // (tenant × jurisdiction × agent) so two tenants asking the same
    // question never share the cached answer.
    const cacheNamespace = this.buildCacheNamespace(agent, reqExt);

    try {
      /* NYV-ORCH-CACHE-001 (Task #38): consult the LLM prompt cache
       * before dispatching to the model. Hits skip the LLM entirely,
       * saving cost + latency. Misses fall through to the LLM and the
       * answer is written back to the cache on success. The lookup is
       * wrapped in its own try/catch so cache faults degrade gracefully
       * into the live LLM path; the outer try/finally still releases the
       * concurrency slot on a cache-hit early return. */
      try {
        const { lmCacheService } = await import('../services/lm-cache-service.js');
        const lookup = await lmCacheService.get(prompt, cacheNamespace);
        if (lookup.hit && lookup.entry) {
          reqExt.__cacheHits = (reqExt.__cacheHits ?? 0) + 1;
          const cachedModel = lookup.entry.metadata.model || 'cache';
          logger.info({
            msg: 'served agent from prompt cache (skipping LLM)',
            agentId: agent.id,
            agentName: agent.name,
            tier: lookup.tier,
            semanticMatch: lookup.semanticMatch,
            similarityScore: lookup.similarityScore,
            namespace: cacheNamespace,
            cachedModel,
            lookupLatencyMs: lookup.latencyMs,
          });
          /* Record a fast-path performance sample so BM25 re-ranking still
           * sees this agent succeed (cheaply) on this prompt + a jurisdiction
           * win so the smart router (Task #33) treats this agent as proven
           * for this jurisdiction. Direct (sync) calls — Task #33 lifted
           * agentPerformanceTracker into module scope above. */
          agentPerformanceTracker.record({
            agentKey:     agent.id,
            success:      true,
            latencyMs:    Date.now() - startMs,
            qualityScore: 0.85,
            timestamp:    new Date(),
          });
          agentPerformanceTracker.recordJurisdictionOutcome(agent.id, callJurisdiction, true);
          return {
            content: lookup.entry.value,
            model: cachedModel,
            provider: 'cache',
            cacheHit: true,
          };
        }
      } catch (cacheErr: unknown) {
        // Cache lookups must never break a real request. Log and proceed
        // to the live LLM call. We deliberately do not fail-loud here
        // because a transient cache fault should degrade gracefully into
        // the existing (already proven) LLM path.
        logger.warn('[QueenOrchestrator] prompt cache lookup failed; falling through to LLM', {
          error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
          agentId: agent.id,
        });
      }

      /* T003 + v5.1.0: ROMA-aware model selection */
      const routing = await resolveAgentModelRouting(prompt, agent, role, callJurisdiction);

      const { RealLLMService } = await import('../services/real-llm-service.js');
      const llmService = new RealLLMService();
      const { prompt: agentSystemPrompt, jurisdiction: agentJurisdiction, source: promptSource, promptBytes } =
        resolveAgentSystemPrompt(agent, request);

      /* NV-TOKEN-BUDGET-001 (Queen leaf lane) — declare a task class BEFORE
       * assembling, so each layer asks "does this node justify me?" instead of
       * unconditionally appending.
       *
       * Measured live on jrx-staging (`2026-08-16T0910Z-aws-ssm`): this site assembled
       * 13,570–19,938 prompt tokens per leaf (89,610 across 7 completions) while
       * the Phase-3 micro path on the same deploy was at 1,048. The block that
       * used to be here called `buildUniversalLegalIntelligenceOverlay()` with no
       * `depth` (⇒ `full` tier) and `assembleLayeredAgentSystemPrompt()` with no
       * `lean` (⇒ full L1) — the lean tiers already existed and were simply never
       * selected by task, exactly the Phase-3 defect one layer down.
       *
       * The role split reuses NV-QUEEN-LEAF-TIER-001's existing `role` seam (plan
       * §8.5) rather than a second classifier, so model, output ceiling and prompt
       * budget can never disagree about what a node is. Assembly itself lives in
       * `nv-queen-leaf-prompt.ts` so the correctness floor is testable per tier. */
      let effectiveAgentSystemPrompt = agentSystemPrompt;
      let promptAssemblyMode = 'legacy';
      let leafPromptPolicy: QueenNodePromptPolicy | undefined;
      let leafPromptTokens = 0;
      try {
        const { budgetForQueenNode } = await import('../config/jrx-prompt-budget.js');
        const { buildQueenLeafSystemPrompt } = await import('./jrx-queen-leaf-prompt.js');
        const { beginPromptConstitutionTurn } = await import('../services/jrx-prompt-session-store.js');

        const metaForBudget = (request as { metadata?: Record<string, unknown> }).metadata ?? {};
        leafPromptPolicy = budgetForQueenNode({
          role,
          prompt: String(prompt || request.prompt || ''),
          // A partner "best legal outcome" request must never be shrunk below
          // the research tier, on either leg.
          forceBestOutcome:
            metaForBudget.nspNymBestOutcome === true
            || metaForBudget.forceLegalBestOutcome === true,
        });

        const assembled = await buildQueenLeafSystemPrompt({
          agentId: agent.id,
          registrySystemPrompt: agentSystemPrompt,
          promptBlob: String(prompt || request.prompt || ''),
          jurisdiction: agentJurisdiction || 'IN',
          policy: leafPromptPolicy,
          sessionId: String(reqExt.sessionId || request.sessionId || ''),
          resolveTurn: beginPromptConstitutionTurn,
        });
        effectiveAgentSystemPrompt = assembled.systemPrompt;
        promptAssemblyMode = assembled.assemblyMode;
        leafPromptTokens = assembled.systemPromptTokens;
        logger.info('[Queen] budgeted leaf prompt (NV-TOKEN-BUDGET-001)', {
          agentId: agent.id,
          nodeRole: assembled.role,
          taskClass: assembled.taskClass,
          overlayDepth: assembled.overlayDepth,
          leanActiveLayer: assembled.leanActiveLayer,
          mode: assembled.assemblyMode,
          systemPromptTokens: assembled.systemPromptTokens,
          cap: assembled.budgetTokens,
          overBudget: assembled.overBudget,
          l0Downgraded: assembled.l0Downgraded,
          reason: leafPromptPolicy.reason,
        });
      } catch (layerErr: unknown) {
        logger.warn('[Queen] budgeted prompt assembly failed; falling back', {
          err: layerErr instanceof Error ? layerErr.message : String(layerErr),
          agentId: agent.id,
        });
        try {
          const promptBlob = String(prompt || request.prompt || '');
          const {
            buildUniversalLegalIntelligenceOverlay,
            mergeLegalIntelligencePrompt,
          } = await import('../services/jrx-legal-intelligence-overlay.js');
          const legalIntelOverlay = buildUniversalLegalIntelligenceOverlay({
            prompt: promptBlob,
            jurisdiction: agentJurisdiction || 'IN',
            partnerBestOutcome: true,
            // Keep the fallback on the budgeted tier too — otherwise a transient
            // assembly fault silently restores the 19,938-token prompt.
            depth: leafPromptPolicy?.overlayDepth ?? 'full',
          });
          effectiveAgentSystemPrompt = mergeLegalIntelligencePrompt(agentSystemPrompt, legalIntelOverlay);
        } catch { /* non-fatal */ }
      }
      // Optional legacy compiler only when session present and layered path did not run
      const sessionIdForCompiler = String(reqExt.sessionId || request.sessionId || '').trim();
      if (
        sessionIdForCompiler
        && process.env.NYV_QUEEN_PROMPT_COMPILER === '1'
        && promptAssemblyMode === 'legacy'
      ) {
        try {
          const { getPromptCompiler } = await import('../services/nyv-prompt-compiler.js');
          const compiled = getPromptCompiler().compile(
            agentSystemPrompt,
            sessionIdForCompiler,
            agent.id,
            prompt,
            agentJurisdiction,
          );
          if (compiled.compiledPrompt) {
            effectiveAgentSystemPrompt = compiled.compiledPrompt;
            if (compiled.compressionApplied) {
              logger.info('[Queen] prompt compiler saved tokens on leaf', {
                agentId: agent.id,
                sessionId: sessionIdForCompiler,
                tokensSaved: compiled.tokensSaved,
              });
            }
          }
        } catch (compErr: unknown) {
          logger.warn('[Queen] prompt compiler (non-fatal)', {
            err: compErr instanceof Error ? compErr.message : String(compErr),
          });
        }
      }
      void promptAssemblyMode;
      logger.info({
        msg: 'dispatched agent to LLM',
        agentId: agent.id,
        agentName: agent.name,
        jurisdiction: agentJurisdiction,
        promptSource,
        promptBytes,
        provider: routing.provider,
        model: routing.model,
        routingReason: routing.reason,
        nodeRole: role,
        // NV-TOKEN-BUDGET-001: the number the live probe measures, at the one
        // site that decides it — so a regression is visible in the dispatch log
        // rather than only on the provider invoice.
        promptTaskClass: leafPromptPolicy?.taskClass,
        systemPromptTokens: leafPromptTokens,
      });
      const promptBlobForTemp = String(prompt || request.prompt || '');
      const draftOrResearchTemp = /\b(draft|bail|petition|research|statute|precedent|advise|opinion)\b/i.test(promptBlobForTemp);
      // Align leaf specialist tokens with partner floor (default 16k) so long
      // Indian legal drafts / IRAC answers are not truncated at 4096.
      const betaLeafFast = isBetaQualityFirst() ? betaQueenLeafMaxTokensFast() : 4_096;
      const betaLeafCounsel = isBetaQualityFirst()
        ? betaPartnerMaxTokensFloor()
        : 16_384;
      const leafMaxRaw = Number(
        draftOrResearchTemp
          ? (process.env.NYV_QUEEN_LEAF_MAX_TOKENS || process.env.NYV_PARTNER_MAX_TOKENS_FLOOR || betaLeafCounsel)
          : (process.env.NYV_QUEEN_LEAF_MAX_TOKENS_FAST || process.env.NYV_PARTNER_MAX_TOKENS_CHAT || betaLeafFast),
      );
      const synthesisMaxTokens = draftOrResearchTemp
        ? (Number.isFinite(leafMaxRaw) && leafMaxRaw > 0 ? Math.max(4_096, leafMaxRaw) : betaLeafCounsel)
        : (Number.isFinite(leafMaxRaw) && leafMaxRaw > 0
          ? (isBetaQualityFirst() ? Math.max(4_096, leafMaxRaw) : Math.min(8_192, Math.max(1_024, leafMaxRaw)))
          : betaLeafFast);

      /* NV-QUEEN-LEAF-TIER-001: an exploration leaf writes notes for a synthesis
       * node, not prose for the user. Capping it at 2k output (env-tunable) is
       * what stops a 16,384-token frontier generation from consuming the whole
       * 120 s per-node budget — the measured cause of `policy: per-node timeout`
       * on all three swarm-exploration nodes. */
      const explorationMaxTokens = resolveExplorationMaxTokens();

      const isExploration = role === 'exploration';
      const leafMaxTokens = isExploration
        ? Math.min(explorationMaxTokens, synthesisMaxTokens)
        : synthesisMaxTokens;

      const response = await llmService.executeRequest({
        // NV-REQID-CORRELATION-001: derive from the parent so this leaf's
        // billed provider line is attributable to the originating request.
        id:           `${reqExt.orchestrationId ?? reqExt.requestId ?? 'orch'}::leaf-${crypto.randomUUID()}`,
        userId:       reqExt.userId ?? 'system',
        provider:     routing.provider,
        model:        routing.model,
        prompt,
        systemPrompt: effectiveAgentSystemPrompt,
        maxTokens:    leafMaxTokens,
        temperature:  draftOrResearchTemp ? 0.35 : 0.55,
        requirements: isExploration
          ? {
              // Intermediate notes: optimise for speed and cost. The synthesis
              // node still runs at professional quality on the merged evidence.
              complexity:   'medium',
              domain:       'analytical',
              priority:     'medium',
              costBudget:   'minimal',
              responseTime: 'fastest',
              qualityLevel: 'standard',
            }
          : {
              complexity:   'complex',
              domain:       'analytical',
              priority:     'high',
              costBudget:   'balanced',
              responseTime: 'balanced',
              qualityLevel: 'professional',
            },
        // Exploration nodes are redundant by construction (a swarm runs several
        // in parallel), so one fallback hop is enough; deep cascades there only
        // add wall-clock to a node whose output may be discarded anyway.
        fallbackLevels: isExploration ? 1 : 3,
        /* NV-LEAF-BUDGET-FORWARD-001: forward the SAME ceiling that
         * `resolveAgentModelRouting()` used, so the router enforces it as a hard
         * filter. Passing only `model` made the leaf pick a +8 preference that the
         * curated premium lead outranked — leaves logged a cheap Bedrock model
         * while every billed completion was `gemini-3-1-pro-preview`. */
        maxCostUsd:     isExploration ? 0.005 : 0.05,
        timestamp:      new Date(),
      });      /* T005: Record performance for future BM25 re-ranking +
       * NYV-ORCH-SMART-003: per-jurisdiction outcome so the coalition
       * former can favor agents with proven wins in the requested
       * jurisdiction. */
      agentPerformanceTracker.record({
        agentKey:     agent.id,
        success:      true,
        latencyMs:    Date.now() - startMs,
        qualityScore: 0.85,
        timestamp:    new Date(),
      });
      agentPerformanceTracker.recordJurisdictionOutcome(agent.id, callJurisdiction, true);

      // NYV-ORCH-CACHE-001 (Task #38): persist a successful LLM response
      // into the prompt cache so subsequent identical (or semantically
      // similar) prompts in the same tenant + jurisdiction + agent scope
      // are served from cache. Failure to store must NOT poison the
      // returned answer — log + move on.
      try {
        const { lmCacheService } = await import('../services/lm-cache-service.js');
        await lmCacheService.set(prompt, response.content, {
          namespace: cacheNamespace,
          model: routing.model,
          tags: ['queen-orchestrator', `agent:${agent.id}`, `tier:${agent.tier}`],
          originalLatencyMs: Date.now() - startMs,
        });
      } catch (cacheSetErr: unknown) {
        logger.warn('[QueenOrchestrator] prompt cache set failed; continuing without caching', {
          error: cacheSetErr instanceof Error ? cacheSetErr.message : String(cacheSetErr),
          agentId: agent.id,
        });
      }

      return { content: response.content, model: routing.model, provider: routing.provider, cacheHit: false };
    } catch (error: unknown) {
      agentPerformanceTracker.record({
        agentKey:     agent.id,
        success:      false,
        latencyMs:    Date.now() - startMs,
        qualityScore: 0,
        timestamp:    new Date(),
      });
      agentPerformanceTracker.recordJurisdictionOutcome(agent.id, callJurisdiction, false);

      // Fail-loud for prompt integrity errors — never substitute a synthetic fallback when
      // the system prompt itself was missing/wrong. This preserves the resolver's no-silent-
      // fallback contract end-to-end. (Production also exits via the boot validator if any
      // prompt is missing, so this only fires for genuinely missing v3 prompts at runtime.)
      if (error instanceof PromptNotFoundError) {
        logger.error({
          msg: 'refusing to fabricate output for an agent with missing v3 prompt',
          agentId: agent.id,
          jurisdiction: error.jurisdiction,
          availableJurisdictions: error.availableJurisdictions,
        });
        throw error;
      }

      // FAIL-LOUD in production: a structured echo would silently mask LLM
      // failures (rate limits, provider outage, prompt-template bugs) and
      // pollute downstream synthesis + audit. Dev/test still get the legacy
      // structured fallback so unit suites without live providers can run.
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd) {
        logger.error('[QueenOrchestrator] LLM call failed in PRODUCTION — refusing structured fallback', {
          agentId: agent.id,
          agentName: agent.name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error instanceof Error
          ? error
          : new Error(`[QueenOrchestrator] FAIL-LOUD: LLM call failed for agent=${agent.name}: ${String(error)}`);
      }

      logger.warn(`[QueenOrchestrator] LLM call failed for agent ${agent.name}, using structured fallback (dev/test only): ${error instanceof Error ? error.message : String(error)}`);
      return {
        content: `[dev-fallback:${agent.name}] Analysis of "${request.prompt.substring(0, 50)}..."

1. Analyzed requirements within domain (${agent.category}).
2. Applied expertise in ${agent.capabilities.slice(0, 3).join(', ')}.
3. Compliant with ROMA ${agent.romaLevel || 'L2'} standards.

Agent: ${agent.name} | Tier: ${agent.tier}`,
        model: 'dev-fallback',
        provider: 'dev-fallback',
        cacheHit: false,
      };
    } finally {
      /* NYV-ORCH-SMART-003: always release the in-flight slot, even when
       * the call threw or returned a dev-only fallback above. */
      agentPerformanceTracker.endExecution(agent.id);
    }
  }

  // ================================================================================================
  // RESULT SYNTHESIS
  // ================================================================================================

  /**
   * Synthesize results from all agent executions.
   *
   * NYV-ORCH-SYNTH-001 (Task #27): the legacy implementation produced a flat
   * markdown concatenation of agent outputs with a header — readable, but no
   * actual synthesis. Users complained about templated bullet output. This
   * version routes multi-agent results (and any single-agent result that
   * needs format/language coordination) through a real LLM synthesizer that:
   *   - reconciles conflicting agent outputs on authority hierarchy
   *   - applies the requested format (markdown / json / narrative / structured)
   *   - applies the requested language (Hindi, Tamil, ... preserve citations)
   *   - keeps the Parlant + BMAD evidence-first discipline intact
   *
   * Failed branches are logged server-side only (NV-CLIENT-OUTCOME-SANITIZE-001).
   * Client content is the legal outcome — never Orchestrated Response chrome.
   * In dev/test, LLM synthesis failures fall back to the legacy concat so
   * unit suites without live providers can still run; in production the
   * failure throws so callers see the real error rather than a silent stub.
   */
  private async synthesizeResults(
    decomposition: TaskDecomposition,
    executions: AgentExecution[],
    request: OrchestrationRequest
  ): Promise<string> {
    logger.info(`📝 Synthesizing ${executions.length} agent outputs...`);

    const completed = executions.filter(e => e.status === 'completed' && e.output);
    const failed = executions.filter(e => e.status !== 'completed');
    setRequestPhase(asExt(request), 'enriching');
    const cotPromise = completed.length > 0 ? maybeRunQueenCoT(request) : Promise.resolve(false);
    const releaseCot = async (value: string): Promise<string> => {
      await settleOptional(cotPromise, OPTIONAL_STAGE_GRACE_MS);
      if (
        completed.length > 0
        && !asExt(request).__queenCotApplied
        && !asExt(request).__queenCotCaptureFailed
      ) {
        asExt(request).__queenCotSkippedProgression = true;
      }
      return value;
    };

    // Decide whether the response needs cross-agent synthesis OR format/
    // language coordination. A single agent answering in English markdown
    // doesn't need an extra LLM hop — its output is already canonical.
    const lang = (request.language || 'en').toLowerCase();
    const fmt = (request.format || (request.preferences?.outputFormat as string) || 'markdown').toLowerCase();
    const needsCoordination = lang !== 'en' || (fmt && fmt !== 'markdown');
    const needsSynthesis = completed.length > 1 || (completed.length === 1 && needsCoordination);

    if (needsSynthesis) {
      this.emitLifecycle(request, 'synthesis_started', {
        orchestrationId: requireOrchestrationId(request),
        agentCount: completed.length,
        failedCount: failed.length,
        format: fmt,
        language: lang,
      });
      try {
        const synthesized = await this.synthesizeWithLLM(decomposition, completed, request);
        if (synthesized) {
          // Session-11 (2026-05-10): full maker-checker injection in the
          // synthesis dispatch path. When JRX_F_GOV_MAKER_CHECKER is OFF
          // (default) this is a fast no-op. When ON, the synthesized
          // output is passed through MakerCheckerService.runLoop using the
          // LLM synthesizer as the maker and a deterministic legal-quality
          // checker (length, citation, jurisdiction-token presence). Loop
          // failures NEVER mutate the orchestration outcome — they fall
          // back to the original synthesized output and log a warning,
          // keeping the safety ring's fail-loud-but-safe contract.
          const finalOutput = await maybeRunMakerCheckerLoop(
            request,
            decomposition,
            completed,
            synthesized,
            this.synthesizeWithLLM.bind(this),
          );
          this.emitLifecycle(request, 'synthesis_complete', {
            orchestrationId: requireOrchestrationId(request),
            length: finalOutput.length,
            format: fmt,
            language: lang,
          });
          // NV-CLIENT-OUTCOME-SANITIZE-001: never append Failed Branches to client content.
          // Partial failures are logged server-side only.
          if (failed.length > 0) {
            logger.warn('[Synthesis] partial agent failures (not exposed to client)', {
              failed: failed.length,
              succeeded: completed.length,
              ids: failed.map((e) => e.subtaskId).slice(0, 8),
            });
          }
          try {
            const { sanitizeOrchestrationContentForClient } = await import('../utils/jrx-client-outcome-sanitize.js');
            return releaseCot(sanitizeOrchestrationContentForClient(finalOutput));
          } catch {
            return releaseCot(finalOutput);
          }
        }
      } catch (synthErr: unknown) {
        const msg = synthErr instanceof Error ? synthErr.message : String(synthErr);
        logger.warn(`[Synthesis] LLM synthesizer failed: ${msg}`);
        if (process.env.NODE_ENV === 'production') {
          // Fail-loud in production — never substitute a templated stub
          // for a real synthesis failure (it would mask provider outages).
          throw synthErr instanceof Error ? synthErr : new Error(msg);
        }
        // dev/test: fall through to legacy concat below
      }
    }

    // Single agent → return outcome only (NV-CLIENT-OUTCOME-SANITIZE-001).
    // Failed branches logged internally; never prepend Orchestrated Response chrome.
    if (completed.length === 1 && !needsCoordination) {
      if (failed.length > 0) {
        logger.warn('[Synthesis] single-agent success with failed siblings (not exposed to client)', {
          failed: failed.length,
          ids: failed.map((e) => e.subtaskId).slice(0, 8),
        });
      }
      const raw = completed[0].output || '';
      try {
        const { sanitizeOrchestrationContentForClient } = await import('../utils/jrx-client-outcome-sanitize.js');
        return releaseCot(sanitizeOrchestrationContentForClient(raw));
      } catch {
        return releaseCot(typeof raw === 'string' ? raw : String(raw ?? ''));
      }
    }

    // Legacy concat fallback — still outcome-only for clients.
    const successBlock = completed
      .map((e) => {
        const body = typeof e.output === 'string' ? e.output : String(e.output ?? '');
        return body.trim();
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
    if (failed.length > 0) {
      logger.warn('[Synthesis] legacy concat with failures (not exposed to client)', {
        failed: failed.length,
        succeeded: completed.length,
      });
    }
    try {
      const { sanitizeOrchestrationContentForClient } = await import('../utils/jrx-client-outcome-sanitize.js');
      return releaseCot(sanitizeOrchestrationContentForClient(successBlock));
    } catch {
      return releaseCot(successBlock);
    }
  }

  /**
   * NYV-ORCH-SYNTH-002 (Task #27): real LLM-driven synthesis.
   * Builds an evidence-block prompt where each agent's output is wrapped
   * in <EVIDENCE> tags, then asks the senior-counsel synthesizer to produce
   * the final answer applying the requested format/language and the
   * Parlant/BMAD discipline. The synthesizer routes through RealLLMService
   * with the SAME provider routing/cost-aware selection used by individual
   * agents (no special-cased provider) so failures and metering are uniform.
   */
  private async synthesizeWithLLM(
    decomposition: TaskDecomposition,
    completedExecutions: AgentExecution[],
    request: OrchestrationRequest,
  ): Promise<string | null> {
    if (completedExecutions.length === 0) return null;

    const language = (request.language || 'en').toLowerCase();
    const format = (request.format || (request.preferences?.outputFormat as string) || 'markdown').toLowerCase();

    // NV-QUEEN-EVIDENCE-CAP-001 — context engineering: cap per-agent + total evidence
    // so synthesis does not burn the token budget concatenating full leaf outputs.
    const perEvidenceCap = Math.max(
      1_000,
      Number(process.env.NYV_QUEEN_EVIDENCE_PER_AGENT_CHARS) || 6_000,
    );
    const totalEvidenceCap = Math.max(
      perEvidenceCap,
      Number(process.env.NYV_QUEEN_EVIDENCE_TOTAL_CHARS) || 24_000,
    );
    let evidenceUsed = 0;
    const evidenceBlock = completedExecutions
      .map((e, i) => {
        if (evidenceUsed >= totalEvidenceCap) {
          return `<EVIDENCE id="${i + 1}" agent="${e.agentName}" agentId="${e.agentId || ''}" subtask="${e.subtaskId}" truncated="budget_exhausted"/>`;
        }
        const raw = typeof e.output === 'string' ? e.output : JSON.stringify(e.output);
        const remaining = totalEvidenceCap - evidenceUsed;
        const cap = Math.min(perEvidenceCap, remaining);
        const truncated = raw.length > cap;
        const out = truncated ? `${raw.slice(0, Math.max(0, cap - 80))}\n…[truncated ${raw.length - cap} chars]` : raw;
        evidenceUsed += out.length;
        return `<EVIDENCE id="${i + 1}" agent="${e.agentName}" agentId="${e.agentId || ''}" role="specialist" subtask="${e.subtaskId}" model="${e.model || 'unknown'}"${truncated ? ' truncated="1"' : ''}>
Preserve this specialist's ROLE IDENTITY and CORE MANDATE voice when synthesizing.
${out}
</EVIDENCE>`;
      })
      .join('\n\n');

    const formatInstruction = (() => {
      switch (format) {
        case 'json':
          return 'Respond with a SINGLE valid JSON object only — no surrounding prose, no markdown fences. Required shape: { "answer": string, "key_points": string[], "citations": Array<{"text":string,"source":string}>, "confidence": number, "caveats": string[] }.';
        case 'narrative':
          return 'Respond as a flowing professional narrative — no bullet lists, no markdown headers. Each paragraph should build on the previous one.';
        case 'structured':
          return 'Respond with these explicit sections in this exact order: ## Answer · ## Reasoning · ## Citations · ## Risk · ## Recommended Next Steps.';
        case 'markdown':
        default:
          return 'Respond in clean Markdown with headings, lists where useful, and quoted citations.';
      }
    })();

    const langInstruction = (language && language !== 'en')
      ? `\n\nCRITICAL: Write the entire response in ${this.languageName(language)} (${language}). Keep statute names, case names, party names and legal Latin in their original form, but ALL explanatory prose must be in ${this.languageName(language)}.`
      : '';

    const synthesisSystem = `You are the SENIOR COUNSEL at Jurexio, India's sovereign legal AI platform. Your job is to take the EVIDENCE blocks below — each produced by a specialist agent — and produce ONE coherent, authoritative answer to the user's question.

CRITICAL DISCIPLINE (Parlant + BMAD standards):
- Cite every legal claim. If the evidence does not contain the citation, omit the claim — never invent a section number, case name, year, or court.
- Reconcile conflicts between agents explicitly. When two agents disagree, identify the conflict and resolve it on the authority hierarchy: statute > binding precedent > persuasive precedent > regulatory guidance > commentary.
- Never re-list agent names or evidence headers in the final answer; SYNTHESIZE, do not concatenate.
- Be specific. Vague generalities ("various provisions apply") are forbidden.
- If the evidence is insufficient to answer fully, say so plainly and list what is missing.
- Mirror the user's question scope — do not silently widen or narrow it.

OUTPUT REQUIREMENT: ${formatInstruction}${langInstruction}`;

    const synthesisUser = `USER QUESTION:
${request.prompt}

JURISDICTION: ${request.jurisdiction || 'IN'}
ORCHESTRATION PATTERN: ${decomposition.orchestrationPattern}
DECOMPOSITION ALGORITHM: ${decomposition.decompositionAlgorithm}

EVIDENCE FROM ${completedExecutions.length} SPECIALIST AGENT${completedExecutions.length === 1 ? '' : 'S'}:
${evidenceBlock}

TASK: Produce the final answer for the user, integrating the evidence above. Follow every discipline rule and the output requirement.`;

    const { realLLMService } = await import('../services/real-llm-service.js');
    const reqExt = asExt(request);

    // NYV-ORCH-MW-003 (Task #34): the final synthesis call now flows through
    // the orchestration middleware ring. The synthesized answer is what
    // ultimately reaches the user, so it MUST get the same hallucination /
    // bias / PII / consent / HITL / governance check as individual agent
    // outputs — and a recorded safety verdict in the audit log. The verdict
    // step in PROD will throw before the answer is returned if an unsafe
    // response is detected.
    const { withMiddleware } = await import('./orchestration-middleware.js');
    const policy = resolveRequestPolicy(request);
    const wrapped = await withMiddleware(
      withQueenRagSkip(
        {
          prompt: synthesisUser,
          agentKey: 'queen.synthesizer',
          tier: policy.tier,
          jurisdiction: inferJurisdiction({
            explicit:      reqExt.jurisdiction ?? null,
            userProfile:   reqExt.userJurisdiction ?? null,
            tenantDefault: reqExt.tenantJurisdiction ?? null,
          }).jurisdiction,
          userId: reqExt.userId,
          tenantId: reqExt.tenantId,
          requestId: reqExt.id ?? reqExt.requestId,
          riskLevel: (['low', 'medium', 'high', 'critical'].includes(String(reqExt.riskLevel))
            ? (reqExt.riskLevel as 'low' | 'medium' | 'high' | 'critical')
            : 'high'),
        },
        request,
      ),
      async () => {
        // ── Session-10 Batch D: cost-optimizer pre-LLM budget gate ────────
        // JRX_F_GOV_COST_OPT (default OFF). When ON, denies the LLM call
        // before dispatch if the user has exhausted their token budget.
        // The check is non-blocking on infrastructure errors — failures
        // log + allow (fail-open is intentional for a budget advisory in
        // dev/UAT; tighten to fail-closed before production rollout).
        if (_govFlagOn('govCostOpt') && reqExt.userId) {
          try {
            const _budget = await _govCostOpt.checkTokenBudget(String(reqExt.userId), 4096);
            if (!_budget.allowed) {
              throw new Error(`[gov:cost-opt] token budget exceeded: ${_budget.reason ?? 'no reason'}`);
            }
          } catch (e: any) {
            if (String(e?.message ?? '').startsWith('[gov:cost-opt] token budget exceeded')) throw e;
            logger.warn(`[gov:cost-opt] budget check failed (fail-open): ${e?.message ?? e}`);
          }
        }
        // ── Session-10 Batch D: concurrency-governor wrap ─────────────────
        // JRX_F_GOV_CONCURRENCY (default OFF). When ON, enforces per-tenant
        // semaphores around the synthesis LLM dispatch — bounds concurrent
        // in-flight LLM calls per tenant and queues excess. snapshotGovernor
        // (exposed at /api/nv5/gov/concurrency/snapshot) reflects live state.
        const _llmDispatch = async () => {
          // NV-QUEEN-SSE-001 — stream synthesis tokens when lifecycle listener present
          const wantStream = !!request.lifecycleEvents
            && (request.lifecycleEvents.listenerCount('synthesis_token') > 0
              || process.env.NYV_QUEEN_SYNTHESIS_STREAM === '1');
          if (wantStream) {
            try {
              const { streamLLM } = await import('../services/intelligent-router/llm-orchestrator.js');
              let accumulated = '';
              const orchId = requireOrchestrationId(request);
              const suppressProvisional = process.env.NYV_QUEEN_SUPPRESS_PROVISIONAL === '1';
              for await (const delta of streamLLM({
                // NV-REQID-CORRELATION-001: synthesis is part of the same
                // request; a standalone UUID here made it look like fan-out
                // from an unrelated caller.
                requestId: `${orchId}::synthesis`,
                systemPrompt: synthesisSystem,
                userMessage: synthesisUser,
                routing: {
                  agentId: 'queen.synthesizer',
                  jurisdiction: (reqExt.jurisdiction as any) || 'IN',
                  taskKind: 'legal_research',
                  tier: policy.tier,
                },
                maxTokens: (() => {
                  const raw = Number(
                    process.env.NYV_QUEEN_SYNTHESIS_MAX_TOKENS ||
                      process.env.NYV_PARTNER_MAX_TOKENS_FLOOR ||
                      16_384,
                  );
                  return Number.isFinite(raw) && raw > 0 ? Math.max(4096, raw) : 16_384;
                })(),
                temperature: 0.3,
              })) {
                if (!delta || /\[STREAM_INTERRUPTED:/i.test(delta)) continue;
                accumulated += delta;
                if (suppressProvisional) continue;
                try {
                  this.emitLifecycle(request, 'synthesis_token', {
                    orchestrationId: orchId,
                    delta,
                    accumulated,
                    provisional: true,
                  });
                } catch { /* non-fatal */ }
              }
              if (accumulated.trim()) {
                /* NV-METER-STREAM-USAGE-001 (2026-08-16): `streamLLM` now reads real
                 * provider usage and records it into the request accumulator itself,
                 * which is what billing (`nvAICreditEnforcer`) and the response
                 * envelope both read. The figures below are therefore display-only
                 * for this frame and are deliberately left as a character estimate
                 * rather than plumbed a second time — double-recording the same
                 * completion would inflate the ledger, which is a worse defect than
                 * an approximate local number. */
                return {
                  content: accumulated,
                  model: 'streamLLM',
                  provider: 'stream',
                  inputTokens: Math.ceil(synthesisUser.length / 4),
                  outputTokens: Math.ceil(accumulated.length / 4),
                  tokensEstimated: true,
                  latencyMs: 0,
                } as any;
              }
            } catch (streamErr: any) {
              logger.warn('[Queen] synthesis stream failed — falling back to blocking LLM', {
                err: streamErr?.message,
              });
            }
          }
          return realLLMService.executeRequest({
          // NV-REQID-CORRELATION-001: blocking synthesis fallback, same request.
          id:           `${reqExt.orchestrationId ?? reqExt.requestId ?? 'orch'}::synthesis-blocking`,
          userId:       reqExt.userId ?? 'system',
          provider:     undefined as any,
          model:        undefined as any,
          prompt:       synthesisUser,
          systemPrompt: synthesisSystem,
          maxTokens:    (() => {
            const raw = Number(
              process.env.NYV_QUEEN_SYNTHESIS_MAX_TOKENS ||
                process.env.NYV_PARTNER_MAX_TOKENS_FLOOR ||
                16_384,
            );
            return Number.isFinite(raw) && raw > 0 ? Math.max(4096, raw) : 16_384;
          })(),
          temperature:  0.3, // lower = more deterministic synthesis
          requirements: {
            complexity:   'expert',
            domain:       'analytical',
            priority:     'high',
            costBudget:   'quality',
            responseTime: 'balanced',
            qualityLevel: 'expert',
          },
          fallbackLevels: 3,
          timestamp:      new Date(),
        } as any);
        };
        const _govTenantId = String(reqExt.tenantId ?? 'default');
        const response = _govFlagOn('govConcurrency')
          ? await _govWithTenantSlot(_govTenantId, _llmDispatch)
          : await _llmDispatch();
        // ── Session-10 Batch D: cost-optimizer post-LLM token accounting ──
        // JRX_F_GOV_COST_OPT (default OFF). Mirrors the pre-check above:
        // when ON we deduct actual usage from the user's running budget.
        // Failures fail-open (matches dev/UAT advisory posture).
        if (_govFlagOn('govCostOpt') && reqExt.userId) {
          try {
            const _ti = (response as any).inputTokens ?? (response as any).usage?.input_tokens ?? 0;
            const _to = (response as any).outputTokens ?? (response as any).usage?.output_tokens ?? 0;
            const _model = (response as any).model ?? 'unknown';
            await _govCostOpt.deductTokens(String(reqExt.userId), Number(_ti) + Number(_to), String(_model));
          } catch (e: any) {
            logger.warn(`[gov:cost-opt] post-deduct failed (fail-open): ${e?.message ?? e}`);
          }
        }
        const tokensIn = (response as any).inputTokens ?? (response as any).usage?.input_tokens;
        const tokensOut = (response as any).outputTokens ?? (response as any).usage?.output_tokens;
        return {
          output: response.content,
          model: (response as any).model ?? 'unknown',
          provider: (response as any).provider ?? 'unknown',
          tokens: {
            input: typeof tokensIn === 'number' ? tokensIn : Math.ceil(synthesisUser.length / 4),
            output: typeof tokensOut === 'number' ? tokensOut : Math.ceil((response.content?.length ?? 0) / 4),
          },
          latencyMs: (response as any).latencyMs,
          costUsd:   (response as any).costUsd,
        };
      },
    );

    stampSafetyVerdict(request, wrapped.post, 'queen.synthesizer');
    // NV-QUEEN-SSE-003 — post-gate token-by-token then authoritative final.
    // Provisional tokens may already have streamed; gated deltas let clients
    // confirm/replace with post-safety text without waiting for one blob.
    try {
      let finalText = typeof wrapped.output === 'string' ? wrapped.output : String(wrapped.output ?? '');
      try {
        const { sanitizeOrchestrationContentForClient } = await import('../utils/jrx-client-outcome-sanitize.js');
        finalText = sanitizeOrchestrationContentForClient(finalText);
      } catch { /* keep raw if sanitize unavailable */ }
      const orchId = requireOrchestrationId(request);
      const chunkSize = Math.max(24, Number(process.env.NYV_QUEEN_GATED_CHUNK_CHARS) || 96);
      if (process.env.NYV_QUEEN_GATED_TOKEN_STREAM !== '0' && finalText.length > 0) {
        let gatedAccum = '';
        for (let i = 0; i < finalText.length; i += chunkSize) {
          const delta = finalText.slice(i, i + chunkSize);
          gatedAccum += delta;
          this.emitLifecycle(request, 'synthesis_token', {
            orchestrationId: orchId,
            delta,
            accumulated: gatedAccum,
            provisional: false,
          });
        }
      }
      this.emitLifecycle(request, 'synthesis_final', {
        orchestrationId: orchId,
        content: finalText,
        provisional: false,
        length: finalText.length,
      });
    } catch { /* non-fatal */ }
    return wrapped.output;
  }

  /**
   * Failed-branch diagnostics for **server logs only**.
   * Never append to client-facing content (NV-CLIENT-OUTCOME-SANITIZE-001).
   */
  private formatFailureBlock(failed: AgentExecution[]): string {
    if (failed.length === 0) return '';
    const lines = failed.map(e => {
      const eExt = e as AgentExecution & { error?: string };
      const reason = typeof e.output === 'string'
        ? e.output
        : eExt.error ?? `status=${e.status}`;
      return `- **${e.subtaskId}** (agent=${e.agentName ?? e.agentId}): ${reason}`;
    }).join('\n');
    // Log-only surface; empty string for any content concatenation path.
    logger.warn(`[Synthesis] Failed Branches (${failed.length})\n${lines}`);
    return '';
  }

  // ================================================================================================
  // HELPER METHODS
  // ================================================================================================

  private extractConstraints(prompt: string): string[] {
    // Extract constraints from the prompt (simplified)
    const constraints: string[] = [];
    const constraintPatterns = [
      /must\s+(\w+)/gi,
      /should\s+(\w+)/gi,
      /requires?\s+(\w+)/gi,
      /need(s)?\s+(\w+)/gi
    ];

    for (const pattern of constraintPatterns) {
      const matches = prompt.matchAll(pattern);
      for (const match of matches) {
        constraints.push(match[0]);
      }
    }

    return constraints.length > 0 ? constraints : ['quality output', 'completeness'];
  }

  private inferCapabilitiesFromConstraint(constraint: string): string[] {
    const capabilityMap: Record<string, string[]> = {
      'api': ['backend', 'integration'],
      'database': ['database', 'data'],
      'frontend': ['frontend', 'ui'],
      'test': ['qa', 'testing'],
      'deploy': ['devops', 'deployment'],
      'secure': ['security', 'compliance']
    };

    for (const [key, caps] of Object.entries(capabilityMap)) {
      if (constraint.toLowerCase().includes(key)) {
        return caps;
      }
    }

    return ['general'];
  }

  private isPhaseRelevant(phase: string, analysis: ReturnType<typeof this.analyzePrompt>): boolean {
    const phaseRelevance: Record<string, string[]> = {
      'planning': ['analysis', 'research_analysis', 'application_development'],
      'design': ['creative', 'application_development'],
      'implementation': ['technology', 'application_development', 'technical_development'],
      'testing': ['technology', 'application_development'],
      'deployment': ['application_development']
    };

    const relevantIntents = phaseRelevance[phase] || [];
    return relevantIntents.some(intent => 
      analysis.intent.includes(intent) || analysis.domains.includes(intent)
    );
  }

  private getPhaseCapabilities(phase: string): string[] {
    const phaseCapabilities: Record<string, string[]> = {
      'planning': ['planning', 'analysis', 'architecture'],
      'design': ['design', 'ui', 'ux'],
      'implementation': ['development', 'coding', 'engineering'],
      'testing': ['qa', 'testing', 'automation'],
      'deployment': ['devops', 'deployment', 'infrastructure']
    };

    return phaseCapabilities[phase] || ['general'];
  }

  private calculateTotalTokens(executions: AgentExecution[]): { input: number; output: number } {
    return executions.reduce(
      (acc, exec) => ({
        input: acc.input + (exec.tokens?.input || 0),
        output: acc.output + (exec.tokens?.output || 0)
      }),
      { input: 0, output: 0 }
    );
  }

  private calculateTotalCost(executions: AgentExecution[]): number {
    return executions.reduce((acc, exec) => acc + (exec.cost || 0), 0);
  }

  // ================================================================================================
  // COLLECTIVE INTELLIGENCE
  // ================================================================================================

  /**
   * Execute collective intelligence mode
   */
  public async executeCollectiveIntelligence(
    config: CollectiveIntelligenceMode,
    request: OrchestrationRequest
  ): Promise<OrchestrationResult> {
    logger.info(`🧠 Collective Intelligence: ${config.mode} mode with ${config.participants.length} agents`);

    const startTime = Date.now();
    const executions: AgentExecution[] = [];

    /* NV-QUEEN-COLLECTIVE-PARALLEL-001 (2026-08-16) — every branch below used to
     * `await this.executeAgent(...)` inside a `for` loop, so a swarm of N agents
     * cost N × per-agent latency even though the agents are independent by
     * construction ("All agents generate ideas independently").
     *
     * Measured on jrx-staging: a swarm request took 362 s wall while its completions
     * summed to only 89 s (6 completions: 7s, 7s, 8s, 20s, 21s, 26s). Serialisation
     * — not model speed — is the dominant cost, which is why cutting per-leaf model
     * cost by 20× (NV-QUEEN-LEAF-TIER-001) barely moved wall-clock.
     *
     * `runWithConcurrency` is the SAME helper the decomposition path already uses
     * (`executeSubtasks`), so this reuses the established policy contract —
     * `maxConcurrentNodes` and `perNodeTimeoutMs` from the tier, and the
     * request-scoped deadline clamp from NV-QUEEN-DEADLINE-001 — rather than
     * introducing a second concurrency mechanism (NV-NO-DUPLICATE-001).
     *
     * A failed lane must remain VISIBLE: `runWithConcurrency` resolves errors
     * instead of throwing, and `buildFailedExecutionFromError` turns each into a
     * failed AgentExecution so `synthesizeResults` can surface the gap rather than
     * silently answering from a partial swarm. */
    const { policy: collectivePolicy } = resolveRequestPolicy(request);
    const runLane = async (subtasks: Subtask[]): Promise<void> => {
      const settled = await runWithConcurrency(
        subtasks,
        (subtask) => this.executeAgent(subtask.assignedAgent!, subtask, request),
        {
          concurrency: collectivePolicy.maxConcurrentNodes,
          timeoutMs: collectivePolicy.perNodeTimeoutMs,
        },
      );
      for (let i = 0; i < subtasks.length; i++) {
        const r = settled[i];
        if (r?.value) executions.push(r.value);
        else if (r?.error) executions.push(this.buildFailedExecutionFromError(subtasks[i], r.error));
      }
    };

    const collectiveSubtask = (
      agent: Agent,
      id: string,
      type: string,
      description: string,
      complexity: Subtask['estimatedComplexity'] = 'moderate',
    ): Subtask => ({
      id,
      type,
      description,
      dependencies: [],
      priority: 1,
      estimatedComplexity: complexity,
      requiredCapabilities: agent.capabilities,
      status: 'pending',
      // Set so a timed-out lane is attributable to a named agent rather than
      // surfacing as 'unknown' in the synthesised answer.
      assignedAgent: agent,
    } as Subtask);

    switch (config.mode) {
      case 'brainstorm':
        // All agents generate ideas independently → fully parallel.
        await runLane(config.participants.map((agent) =>
          collectiveSubtask(
            agent,
            `brainstorm-${agent.id}`,
            'brainstorm',
            `Generate creative ideas for: ${config.topic}`,
          )));
        break;

      case 'consensus':
        /* Rounds are genuinely sequential — round N+1 reacts to the agreement
         * reached in round N — but the agents WITHIN a round are independent, so
         * only the inner loop is parallelised. Flattening the rounds too would
         * change the semantics of consensus, not just its speed. */
        for (let round = 0; round < config.rounds; round++) {
          await runLane(config.participants.map((agent) =>
            collectiveSubtask(
              agent,
              `consensus-${agent.id}-r${round}`,
              'consensus',
              `Round ${round + 1}: Contribute to consensus on ${config.topic}`,
            )));
        }
        break;

      case 'debate':
        // Each side argues its assigned position without reading the other's
        // output in this implementation, so the positions run concurrently.
        await runLane(config.participants.map((agent, i) =>
          collectiveSubtask(
            agent,
            `debate-${agent.id}`,
            'debate',
            `Argue ${i % 2 === 0 ? 'pro' : 'con'} position on: ${config.topic}`,
            'complex',
          )));
        break;

      case 'synthesis':
      case 'vote':
      default:
        await runLane(config.participants.map((agent) =>
          collectiveSubtask(
            agent,
            `${config.mode}-${agent.id}`,
            config.mode,
            `${config.mode} contribution on: ${config.topic}`,
          )));
    }

    const synthesizedOutput = await this.synthesizeResults(
      {
        originalPrompt: request.prompt,
        analyzedIntent: `collective_${config.mode}`,
        taskType: request.type,
        complexity: 'complex',
        subtasks: [],
        orchestrationPattern: 'swarm',
        estimatedAgents: config.participants.length,
        estimatedTime: Date.now() - startTime,
        decompositionAlgorithm: `collective_${config.mode}`
      },
      executions,
      request
    );

    /* NV-QUEEN-COT-COLLECTIVE-001 (2026-08-16) — the collective/swarm path never
     * ran CoT capture, while `nv-adaptive-router` sets `requireCoT: true` for every
     * `forceLegalBestOutcome` Queen request. `snapshotQualityEnvelope` then finds
     * `cot` missing, `QualityEnvelopeError` is thrown, and the route returns HTTP
     * 500 — AFTER the swarm has produced a complete, correct answer and been billed
     * for 6–13 completions.
     *
     * Measured on jrx-staging: the same litigation-strategy prompt returned 200 with a
     * full answer on one run and `INTERNAL_ERROR: mandatory steps missing: cot` on
     * the next. The variability is not the model — it is whether the request
     * happened to reach the decomposition path (which does call this, at :4844) or
     * the collective path (which did not). This is the single worst class of defect
     * in the platform: full spend, full latency, zero delivered value.
     *
     * Placed after synthesis and before the result is built, mirroring the
     * decomposition path, and only when the swarm actually produced something —
     * claiming reasoning over an empty result would be worse than failing. */
    /* NV-QUEEN-COT-COLLECTIVE-001 / NV-COMPLETION-DRIVEN-001 — CoT must still
     * be invoked on this path (synthesizeResults already started it). Do not
     * await a second capture after the answer exists. */
    if (executions.some((e) => e.status === 'completed' && e.output)) {
      void maybeRunQueenCoT(request);
    }

    let polishedCollective = synthesizedOutput;
    try {
      const { applyLegalResponseFormatting } = await import('../services/jrx-legal-response-format.js');
      polishedCollective = applyLegalResponseFormatting(synthesizedOutput, {
        jurisdiction: String((request as any).jurisdiction ?? 'IN'),
        taskType: String(request.type || 'research'),
        query: String(request.prompt || ''),
        includeDisclaimer: true,
      });
    } catch { /* non-fatal */ }
    try {
      const { applyStatuteQaGroundingGate } = await import('../services/jrx-statute-qa-grounding.js');
      const gated = await applyStatuteQaGroundingGate({
        query: String(request.prompt || ''),
        answer: polishedCollective,
        jurisdiction: String((request as any).jurisdiction ?? 'IN'),
      });
      polishedCollective = gated.content;
      if (gated.corrected) {
        logger.info('collective_statute_qa_corrected', {
          reason: gated.reason,
          act: gated.statute?.act_short_title,
          section: gated.statute?.section_number,
        });
      }
    } catch (e: any) {
      logger.warn('collective_statute_qa_gate_failed', { error: e?.message || String(e) });
    }

    return {
      success: true,
      taskDecomposition: {
        originalPrompt: request.prompt,
        analyzedIntent: `collective_${config.mode}`,
        taskType: request.type,
        complexity: 'complex',
        subtasks: [],
        orchestrationPattern: 'swarm',
        estimatedAgents: config.participants.length,
        estimatedTime: Date.now() - startTime,
        decompositionAlgorithm: `collective_${config.mode}`
      },
      executions,
      synthesizedOutput: polishedCollective,
      ...(asExt(request).__lastSafetyVerdict
        ? { safetyVerdict: asExt(request).__lastSafetyVerdict }
        : {}),
      metadata: {
        totalTime: Date.now() - startTime,
        totalTokens: this.calculateTotalTokens(executions),
        totalCost: this.calculateTotalCost(executions),
        agentsUsed: config.participants.length,
        orchestrationPattern: `collective_${config.mode}`,
        queenCotApplied: asExt(request).__queenCotApplied === true,
        queenCotCaptureFailed: asExt(request).__queenCotCaptureFailed === true,
        ...(asExt(request).__queenCotCaptureError
          ? { queenCotCaptureError: asExt(request).__queenCotCaptureError }
          : {}),
        cacheHits: asExt(request).__cacheHits ?? 0,
        ...completionDrivenResultMeta(request),
      }
    };
  }
}

// Export singleton instance
export const queenOrchestrator = QueenOrchestrator.getInstance();
