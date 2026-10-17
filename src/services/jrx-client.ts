// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import { realLLMService } from './real-llm-service.js';
import type { LLMRequest } from './real-llm-service.js';
import { promptEnhancementPipeline } from '../orchestration/jrx-prompt-enhancement-pipeline.js';
import { responseEngineeringPipeline } from '../orchestration/jrx-response-engineering-pipeline.js';
import {
  NvHallucinationDetector,
  NvCitationVerifier,
  NvBiasDetector,
  NvHITLService,
  NvExplainabilityService,
  NvAgentMetricsService,
  classifyRiskLevel,
} from './jrx-orchestration-services.js';
import { graphMemoryService, type MemoryNode } from './memory/graph-memory-service.js';
import {
  buildMemoryInjectionBlock,
  buildGraphInjectionBlock,
  extractDirectMemoryRecall,
} from './memory/jrx-memory-injection-budget.js';
import { selfRAGService } from './rag/self-rag-service.js';
import { confidenceScorer, type ConfidenceResult } from './confidence-scorer.js';
import { tokenCostPredictionService } from './token-cost-prediction-service.js';
import { aguiJurexioIntegrationService } from '../packages/protocols/agui-nyayavigya-integration-service.js';
// A2A bus imported lazily below to avoid circular dependency during module init
import { chainOfThoughtService, selectCoTStrategy } from './chain-of-thought-service.js';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { needsGenerationBeyondRetrieval } from './jrx-statute-qa-grounding.js';
import {
  isSlaFastTaskType,
  isPartnerExplicitFastAlias,
  isPartnerExplicitFastChatAlias,
  shouldSkipExpensiveDraftFastSteps,
} from '../utils/jrx-partner-platform.js';
import {
  getAllAgents as getRegistryAgents,
  getAgent as getRegistryAgent,
  resolveRegistryAgentId,
} from './agent-registry-service.js';
import {
  capabilitiesForTaskType,
  classifySubjectArea,
  nameHintsForSubject,
  researchAgentIdForCapabilities,
} from './jrx-agent-capability-alias.js';
import {
  resolvePinnedAgentIdForDocumentType,
  shouldApplyDocumentTypeAgentPin,
} from './jrx-document-type-agent-pin.js';
import { safetyPipeline } from './safety-pipeline.js';import { isSoftPolicyActive } from '../middleware/jrx-integration-soft-policy.js';
import { jrxGuardrailsService, type BarCouncilEnforcement } from './jrx/jrx-guardrails.js';
import {
  budgetForRequest,
  estimatePromptTokens,
  isPromptBudgetEnforced,
} from '../config/jrx-prompt-budget.js';


const logger = createLogger('client');

const hallucinationDetector = new NvHallucinationDetector();
const citationVerifier = new NvCitationVerifier();
const biasDetector = new NvBiasDetector();
const hitlService = new NvHITLService();
const explainabilityService = new NvExplainabilityService();
const agentMetricsService = new NvAgentMetricsService();
// GAP-008: A2A bus lazy-initialized on first use to avoid circular dependency at module load
let _a2aBus: any = null;
async function getA2ABus(): Promise<any> {
  if (!_a2aBus) {
    const { default: A2ACollaborationBus } = await import('../packages/protocols/a2a-collaboration-bus.js');
    _a2aBus = new A2ACollaborationBus({
      coreConfig: { agents: [], maxConcurrency: 20 },
      storage: { get: async () => null, set: async () => {}, delete: async () => {} },
    });
  }
  return _a2aBus;
}

// NV-NSP-FIX-002 (2026-04-27, rev2): The previous list was over-aggressive —
// terms like "legal advice", "file a case", "bail guidance", "outcome
// prediction" and "notice drafting" appear in legitimate legal-research
// outputs. NSP integration tests showed valid responses being filtered with
// "[Response filtered by Jurexio compliance engine]".
//
// HARD list — banned regardless of context. Strictly prescriptive /
// outcome-guaranteeing / unethical-instruction phrases.
const BANNED_KEYWORDS = [
  'guaranteed win', 'guaranteed to win',
  'definitely guilty', 'definitely not guilty',
  'you will win', 'you will lose',
  'bribe the judge', 'corrupt the court', 'pay off the judge',
  'fabricate evidence', 'destroy evidence', 'obstruct justice',
  'commit perjury', 'file false affidavit', 'lie under oath',
];

// SOFT list — banned only when the response does NOT also carry a disclaimer
// pattern. Educational / explanatory uses of these phrases (with the proper
// disclaimer that the response is not legal advice) are allowed through.
const SOFT_BANNED_KEYWORDS = [
  'legal advice',
];

// Phrases that mark the response as informational / disclaimer-bearing.
// If any of these match the response, SOFT_BANNED_KEYWORDS hits are exempt.
const DISCLAIMER_PATTERNS: RegExp[] = [
  /\b(?:cannot|can'?t|do(?:es)? not|don'?t|will not|won'?t|may not|should not|shouldn'?t|never|unable to)\s+(?:provide|give|offer|render|constitute|amount to|be considered|substitute for)\s+(?:legal\s+)?advice\b/i,
  /\bnot\s+(?:to\s+be\s+|intended\s+as\s+|construed\s+as\s+)?legal\s+advice\b/i,
  /\b(?:this|the\s+(?:above|following|response))\s+(?:does\s+not|is\s+not|isn'?t)\s+(?:constitute\s+)?legal\s+advice\b/i,
  /\bfor\s+(?:proper\s+|specific\s+|formal\s+|professional\s+)?legal\s+advice[,]?\s+(?:please\s+)?consult\b/i,
  /\b(?:informational|educational|general)\s+(?:purpose|guidance)\b/i,
  /\bconsult\s+(?:a\s+)?(?:qualified\s+)?(?:advocate|lawyer|attorney|legal\s+counsel|professional)\b/i,
];

function redactPII(text: string): string {
  if (!text) return text;
  return text
    .replace(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, '[REDACTED_NAME]')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{10}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_AADHAAR]')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[REDACTED_PAN]')
    .replace(/\b[A-Z]\d{7}\b/g, '[REDACTED_PASSPORT_IN]')
    .replace(/\b\d{9}\b/g, '[REDACTED_PASSPORT_US]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]')
    .replace(/\b784-\d{4}-\d{7}-\d\b/g, '[REDACTED_EMIRATES_ID]')
    .replace(/\b[STFGM]\d{7}[A-Z]\b/g, '[REDACTED_NRIC_SG]')
    .replace(/\b\d{10}[A-Z]{2}\b/g, '[REDACTED_SA_ID]')
    .replace(/\b(DL|dl)[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{4}[\s-]?\d{7}\b/g, '[REDACTED_DL_IN]')
    .replace(/\b[A-Z]\d{3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g, '[REDACTED_DL_US]')
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d][A-Z]\d\b/g, '[REDACTED_GSTIN]')
    .replace(/\b\d{2}\/\d{2}\/\d{4}\b/g, '[REDACTED_DOB]')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '[REDACTED_DATE_ISO]')
    .replace(/\b\d{2}[A-Z]{3}\d{4}[A-Z]\b/g, '[REDACTED_TAN]')
    .replace(/\b[A-Z]{4}0[A-Z\d]{6}\b/g, '[REDACTED_IFSC]')
    .replace(/\b\d{9,18}\b(?=.*(?:account|bank|a\/c))/gi, '[REDACTED_BANK_ACCT]')
    .replace(/\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_VISA]')
    .replace(/\b5[1-5]\d{2}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[REDACTED_MASTERCARD]')
    .replace(/\b3[47]\d{2}[\s-]?\d{6}[\s-]?\d{5}\b/g, '[REDACTED_AMEX]')
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g, '[REDACTED_IBAN]')
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, '[REDACTED_CPF_BR]')
    .replace(/\b\d{8,9}\b(?=.*(?:tfn|tax\s*file))/gi, '[REDACTED_TFN_AU]')
    .replace(/\b\d{3}[\s-]?\d{3}[\s-]?\d{3}\b(?=.*(?:sin|social\s*insurance))/gi, '[REDACTED_SIN_CA]')
    .replace(/\b[A-Z]{2}\d{6}[A-Z]?\b(?=.*(?:nino|national\s*insurance))/gi, '[REDACTED_NINO_UK]')
    .replace(/\+\d{1,3}[\s-]?\d{6,14}\b/g, '[REDACTED_INTL_PHONE]')
    .replace(/\b\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|blvd|lane|ln|drive|dr)\b/gi, '[REDACTED_ADDRESS]');
}

function complianceCheck(text: string): { passed: boolean; violations: string[] } {
  // NV-NSP-FIX-002 (2026-04-27, rev2): word-boundary match (not substring).
  // HARD list — banned regardless of context. SOFT list — exempted when a
  // DISCLAIMER_PATTERN is present anywhere in the response. Stops legitimate
  // legal-research outputs from being content-filtered into
  // "[Response filtered by Jurexio compliance engine]".
  if (!text) return { passed: true, violations: [] };
  const violations: string[] = [];
  const compileRegex = (kw: string): RegExp => {
    const pattern = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`\\b${pattern}\\b`, 'i');
  };
  // Hard bans — always violate
  for (const kw of BANNED_KEYWORDS) {
    if (compileRegex(kw).test(text)) violations.push(kw);
  }
  // Soft bans — only violate when no disclaimer in the response
  const hasDisclaimer = DISCLAIMER_PATTERNS.some(p => p.test(text));
  if (!hasDisclaimer) {
    for (const kw of SOFT_BANNED_KEYWORDS) {
      if (compileRegex(kw).test(text)) violations.push(`${kw} (soft, no disclaimer)`);
    }
  }
  return { passed: violations.length === 0, violations };
}

export type ProductTier = 'solo' | 'plus' | 'pro' | 'standard' | 'elite' | 'government' | 'default';

export interface NvOrchestrationOptions {
  /**
   * NV-REQID-CORRELATION-001: caller-supplied correlation id. When the caller
   * already minted an id and returned it to the client, it MUST be passed here
   * so provider log lines can be correlated to the API response. Minting a
   * fresh id below this seam makes per-request fan-out and cost unmeasurable.
   */
  requestId?: string;
  maxTokens?: number;
  source?: string;
  tenantId?: string;
  userId?: string;
  tier?: ProductTier;
  jurisdiction?: string;
  taskType?: string;
  language?: string;
  sessionId?: string;
  domainContext?: string;
  enableOrchestration?: boolean;
  previousMessages?: { role: string; content: string }[];
  stream?: boolean;
  enableHITL?: boolean;
  enableHallucinationCheck?: boolean;
  enableExplainability?: boolean;
  enableCitationVerification?: boolean;
  enableRAG?: boolean;
  enableMemory?: boolean;
  ragDocumentIds?: string[];
  matterId?: string;
  riskCategory?: 'low' | 'medium' | 'high' | 'critical';
  /** NV-COT-SDK-001 — explicit CoT for SDK/agentic tasks (all tiers when true). */
  enableCoT?: boolean;
  cotStrategy?: 'zero_shot_cot' | 'few_shot_cot' | 'self_consistency' | 'tree_of_thought' | 'step_back' | 'decomposition' | 'least_to_most' | 'chain_of_verification';
  /** NSP/NYM integration soft-policy: pass-through compliance / Gate-8 blocks. */
  softPolicy?: boolean;
  /** NV-LEGAL-INTEL-FORCE-001 — force legal-intel overlay + quality for ecosystem. */
  forceLegalBestOutcome?: boolean;
  /** Caller-declared LLM requirements (orchestrate path forwards responseTime/complexity). */
  responseTime?: 'fastest' | 'balanced' | 'economical' | 'fast' | 'relaxed';
  costBudget?: string;
  llmComplexity?: 'simple' | 'medium' | 'complex' | 'expert';
  qualityLevel?: string;
  /** NV-DOCUMENT-TYPE-AGENT-PIN-001 — partner draft documentType for specialist pin. */
  documentType?: string;
  parameters?: Record<string, unknown>;
}

export interface NvOrchestrationMetadata {
  promptEnhanced: boolean;
  responseEngineered: boolean;
  agentResolved: boolean;
  tierRouting: string;
  enhancementMetrics?: {
    originalLength: number;
    enhancedLength: number;
    enhancements: string[];
    estimatedTokens: number;
    complexity: number;
    qualityScore: number;
  };
  qualityMetrics?: {
    readability: number;
    coherence: number;
    accuracy: number;
    completeness: number;
    relevance: number;
    overall: number;
  };
}

export interface NvResponse {
  content: string;
  tokens: { prompt: number; completion: number; total: number };
  model: string;
  latencyMs: number;
  piiRedacted: boolean;
  compliancePassed: boolean;
  source: string;
  orchestration?: NvOrchestrationMetadata;
  requestId?: string;
  hallucinationCheck?: {
    score: number;
    flaggedClaims: string[];
    status: string;
  };
  hitlStatus?: {
    required: boolean;
    reviewId?: string;
    status: string;
  };
  explainability?: {
    reasoningSteps: string[];
    sourcesConsulted: string[];
    confidence: number;
  };
  citations?: {
    verified: number;
    unverified: number;
    details: Array<{ text: string; verified: boolean; source?: string }>;
  };
  ragContext?: {
    chunksUsed: number;
    sources: string[];
  };
  memoryContext?: {
    memoriesUsed: number;
    sessionId?: string;
  };
  confidence?: {
    score: number;
    action: 'auto_approve' | 'review' | 'escalate';
    explanation: string;
  };
  biasAudit?: {
    score: number;
    findings: string[];
    recommendations: string[];
  };
  chainOfThought?: {
    steps: string[];
    strategy: string;
    confidence: number;
  };
  selfRagValidated?: boolean;
  adaptiveRagUsed?: boolean;
  graphTraversalUsed?: boolean;
  cost?: {
    estimatedInputCost: number;
    estimatedOutputCost: number;
    totalEstimatedCost: number;
    model: string;
    provider: string;
  };
  regulatoryGate8?: {
    jurisdiction: string;
    enforcement: BarCouncilEnforcement;
    matchedRules: string[];
    warnings: string[];
  };
}

interface AgentRegistryEntry {
  id: string;
  name: string;
  tier: string;
  romaLevel: string;
  category: string;
  practiceArea: string;
  systemPrompt: string;
  preferredModels: string[];
  fallbackModels: string[];
  capabilities: string[];
  securityLevel: string;
  costOptimization?: { preferCheaperModels?: boolean; maxCostPerTask?: number };
  jurisdiction?: string;
  [key: string]: any;
}

const TIER_ROUTING_CONFIG: Record<ProductTier, {
  costBudget: string;
  qualityLevel: string;
  priority: string;
  fallbackLevels: number;
  responseTime: string;
  temperature: number;
}> = {
  solo: {
    costBudget: 'economy',
    qualityLevel: 'standard',
    priority: 'low',
    fallbackLevels: 5,
    responseTime: 'relaxed',
    temperature: 0.7,
  },
  plus: {
    costBudget: 'balanced',
    qualityLevel: 'professional',
    priority: 'medium',
    fallbackLevels: 3,
    responseTime: 'balanced',
    temperature: 0.7,
  },
  pro: {
    costBudget: 'premium',
    qualityLevel: 'expert',
    priority: 'high',
    fallbackLevels: 2,
    responseTime: 'fast',
    temperature: 0.5,
  },
  standard: {
    costBudget: 'balanced',
    qualityLevel: 'professional',
    priority: 'medium',
    fallbackLevels: 3,
    responseTime: 'balanced',
    temperature: 0.6,
  },
  elite: {
    costBudget: 'premium',
    qualityLevel: 'expert',
    priority: 'high',
    fallbackLevels: 2,
    responseTime: 'fast',
    temperature: 0.5,
  },
  government: {
    costBudget: 'unlimited',
    qualityLevel: 'expert',
    priority: 'critical',
    fallbackLevels: 1,
    responseTime: 'fast',
    temperature: 0.3,
  },
  default: {
    costBudget: 'balanced',
    qualityLevel: 'professional',
    priority: 'medium',
    fallbackLevels: 3,
    responseTime: 'balanced',
    temperature: 0.7,
  },
};

function toAgentRegistryEntry(raw: any): AgentRegistryEntry {
  const jurisdictions = Array.isArray(raw.jurisdictions) ? raw.jurisdictions : ['DEFAULT'];
  return {
    ...raw,
    id: String(raw.id || 'unknown'),
    name: String(raw.name || raw.id || 'Unknown Agent'),
    tier: String(raw.tier || 'assistant'),
    romaLevel: String(raw.romaLevel || 'L2'),
    category: String(raw.category || raw.practiceArea || 'general'),
    practiceArea: String(raw.practiceArea || raw.category || 'general'),
    systemPrompt: String(raw.systemPrompt || ''),
    preferredModels: Array.isArray(raw.preferredModels) ? raw.preferredModels.map(String) : [],
    fallbackModels: Array.isArray(raw.fallbackModels) ? raw.fallbackModels.map(String) : [],
    capabilities: Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [],
    securityLevel: String(raw.securityLevel || 'standard'),
    jurisdiction: String(jurisdictions[0] || 'DEFAULT'),
    jurisdictions,
  } as AgentRegistryEntry;
}

function initializeAgentRegistry(): void {
  const agents = getRegistryAgents();
  logger.info(
    `[NV-Gateway] v5.1.0 agent registry ready: ${agents.length} agents, ${new Set(agents.map(a => a.practiceArea)).size} practice areas`,
  );
}

function resolveAgent(agentKey: string): AgentRegistryEntry | null {
  const resolvedId = resolveRegistryAgentId(agentKey) || agentKey;
  const agent = getRegistryAgent(resolvedId);
  return agent ? toAgentRegistryEntry(agent) : null;
}

/**
 * NV-AGENT-CAPABILITY-ALIAS-001 / NV-AGENT-JURISDICTION-LIST-001.
 *
 * Two defects were making partner traffic land on `agentKey='generic'`, which
 * discards all 164 specialist system prompts and leaves the prompt-depth ladder
 * with no bundle to draw jurisdiction / reasoning / evidence / citation sections
 * from:
 *
 *  1. **Vocabulary mismatch.** The old body matched `taskType` against
 *     `capabilities[]` by raw substring. The registry speaks kebab-case skills
 *     (`case-law-research`, `statute-retrieval`) while callers send snake_case
 *     tasks (`legal_research`, `statute_lookup`). Measured against the live
 *     registry, only 5 of 21 partner taskTypes bound an agent — and those five
 *     bound by accident, via bare words like `research` appearing inside
 *     `case-law-research`. Now routed through `capabilitiesForTaskType()`.
 *
 *  2. **Only the first jurisdiction was considered.** `toAgentRegistryEntry()`
 *     collapses `jurisdictions[]` to `jurisdiction = jurisdictions[0]`, so an
 *     agent declaring `['DEFAULT','IN']` was rejected for an `IN` request even
 *     though it serves IN. The full list is now checked, with `DEFAULT` treated
 *     as "serves any jurisdiction".
 *
 * Ranking is capability-precedence first (a `legal_research` request should reach
 * a case-law specialist before a generic multi-hop-RAG agent), then
 * subject-matter match on the agent's name, then tier. Ties break on agent id so
 * selection is deterministic — otherwise the same request could land on
 * different agents across replicas and identical inputs would produce divergent
 * answers.
 *
 * NV-AGENT-SUBJECT-MATTER-001: the subject pass is what stops a BNS/IPC murder
 * question being answered by the *Tax Law Research Agent*. All 18 research
 * agents carry byte-identical `capabilities[]` (164 agents share just 9 distinct
 * sets), so capability + tier alone cannot tell them apart and returns whichever
 * sorts first. The specialism lives in the agent's name.
 *
 * Reproduce with: `npx tsx scripts/jrx-probe-agent-selection.ts`
 *                 `npx tsx scripts/jrx-probe-subject-matter-selection.ts`
 */
export interface ResolveAgentOptions {
  jurisdiction?: string;
  prompt?: string;
  taskType?: string;
  documentType?: string;
  parameters?: Record<string, unknown>;
}

function resolveAgentByCapability(
  taskType: string,
  jurisdiction?: string,
  prompt?: string,
  resolveOpts?: Omit<ResolveAgentOptions, 'taskType'>,
): AgentRegistryEntry | null {
  const wanted = capabilitiesForTaskType(taskType || 'general');
  const entries = getRegistryAgents().map(toAgentRegistryEntry);

  function jurisMatchesEntry(a: AgentRegistryEntry): boolean {
    if (!jurisdiction) return true;
    const want = jurisdiction.toLowerCase();
    const declared = [
      ...(Array.isArray(a.jurisdictions) ? a.jurisdictions : []),
      ...(a.jurisdiction ? [a.jurisdiction] : []),
    ].map(j => String(j).toLowerCase());
    if (declared.length === 0) return true;
    // DEFAULT is the registry's "any jurisdiction" marker.
    return declared.some(j => j === 'default' || j.includes(want) || want.includes(j));
  }

  // NV-DOCUMENT-TYPE-AGENT-PIN-001 — draft registry pin before capability tie-break.
  if (shouldApplyDocumentTypeAgentPin(taskType) || resolveOpts?.documentType) {
    const pinnedId = resolvePinnedAgentIdForDocumentType({
      documentType: resolveOpts?.documentType,
      taskType,
      prompt,
      parameters: resolveOpts?.parameters,
    });
    if (pinnedId) {
      const pinned = entries.find((a) => a.id === pinnedId);
      if (pinned && jurisMatchesEntry(pinned)) {
        return pinned;
      }
    }
  }

  const subjectArea = prompt ? classifySubjectArea(prompt) : 'general';
  const nameHints = nameHintsForSubject(subjectArea);
  const researchPinId = researchAgentIdForCapabilities(wanted);

  type Ranked = { agent: AgentRegistryEntry; capRank: number; subjectRank: number };
  const ranked: Ranked[] = [];

  for (const a of entries) {
    if (!jurisMatchesEntry(a)) continue;
    const caps = (a.capabilities ?? []).map(c => c.toLowerCase());
    if (caps.length === 0) continue;

    // Earliest matching alias wins: `wanted` is ordered best-match-first.
    let capRank = -1;
    for (let i = 0; i < wanted.length; i += 1) {
      const w = wanted[i].toLowerCase();
      if (!w) continue;
      if (caps.some(c => c === w || c.includes(w))) { capRank = i; break; }
    }
    if (capRank === -1) continue;

    // Lower is better; hints are ordered most-specific-first. Agents that do not
    // match the subject rank last but stay eligible, so a subject with no
    // dedicated specialist still resolves instead of falling back to generic.
    const haystack = `${a.name ?? ''} ${(a as { description?: string }).description ?? ''}`.toLowerCase();
    let subjectRank = nameHints.length;
    for (let i = 0; i < nameHints.length; i += 1) {
      if (haystack.includes(nameHints[i].toLowerCase())) { subjectRank = i; break; }
    }

    ranked.push({ agent: a, capRank, subjectRank });
  }

  if (ranked.length === 0) return null;

  const tierPriority: Record<string, number> = { sovereign: 5, expert: 4, professional: 3, assistant: 2, executor: 1 };
  ranked.sort((x, y) => {
    if (x.capRank !== y.capRank) return x.capRank - y.capRank;
    if (x.subjectRank !== y.subjectRank) return x.subjectRank - y.subjectRank;
    if (researchPinId) {
      const xPin = x.agent.id === researchPinId ? 0 : 1;
      const yPin = y.agent.id === researchPinId ? 0 : 1;
      if (xPin !== yPin) return xPin - yPin;
    }
    const t = (tierPriority[y.agent.tier] || 0) - (tierPriority[x.agent.tier] || 0);
    if (t !== 0) return t;
    return x.agent.id.localeCompare(y.agent.id);
  });

  return ranked[0].agent;
}

export async function callJurexio(
  agentKey: string,
  systemPrompt: string,
  userPrompt: string,
  options: NvOrchestrationOptions = {}
): Promise<NvResponse> {
  const {
    requestId: inboundRequestId,
    maxTokens = 2048,
    source = 'nyayasiddhi',
    tenantId,
    userId,
    tier = 'default',
    jurisdiction,
    taskType,
    language = 'en',
    sessionId,
    domainContext,
    documentType,
    parameters,
    enableOrchestration = true,
    previousMessages,
    enableHITL = false,
    enableHallucinationCheck = false,
    enableExplainability = false,
    enableCitationVerification = false,
    enableRAG = false,
    enableMemory = false,
    ragDocumentIds,
    matterId,
    riskCategory,
    enableCoT = false,
    cotStrategy = 'zero_shot_cot',
    softPolicy: softPolicyOpt = false,
    responseTime: callerResponseTime,
    costBudget: callerCostBudget,
    llmComplexity: callerLlmComplexity,
    qualityLevel: callerQualityLevel,
  } = options;

  const softPolicy = softPolicyOpt || isSoftPolicyActive();

  const start = Date.now();
  const slaFastExplicit = isPartnerExplicitFastAlias(taskType);
  let tierConfig = TIER_ROUTING_CONFIG[tier as ProductTier] || TIER_ROUTING_CONFIG.default;
  if (slaFastExplicit || callerResponseTime === 'fastest') {
    tierConfig = {
      ...tierConfig,
      responseTime: 'fastest',
      costBudget: callerCostBudget || 'minimal',
      qualityLevel: callerQualityLevel || (callerLlmComplexity === 'complex' ? 'professional' : 'standard'),
      priority: 'medium',
    };
  }

  let sanitizedPrompt = redactPII(userPrompt);

  const inputCheck = softPolicy ? { passed: true, violations: [] as string[] } : complianceCheck(sanitizedPrompt);
  if (!inputCheck.passed) {
    return {
      content: `Request blocked by Jurexio compliance filter. Violations: ${inputCheck.violations.join(', ')}`,
      tokens: { prompt: 0, completion: 0, total: 0 },
      model: 'compliance-filter',
      latencyMs: Date.now() - start,
      piiRedacted: true,
      compliancePassed: false,
      source,
      orchestration: {
        promptEnhanced: false,
        responseEngineered: false,
        agentResolved: false,
        tierRouting: tier,
      },
    };
  }

  try {
    // NV-REQID-CORRELATION-001: inherit the caller's id when present. Minting
    // unconditionally here severed every provider log line from the id handed
    // back to the client, so fan-out could only be counted by time window —
    // which silently attributes concurrent traffic to the request under test.
    const requestId = inboundRequestId || crypto.randomUUID();
    let resolvedAgentKey = agentKey;
    let agent: AgentRegistryEntry | null = null;

    if (agentKey === 'auto') {
      // NV-AGENT-SUBJECT-MATTER-001: pass the prompt so the subject-matter pass
      // can distinguish specialists that share identical capability sets. The
      // PII-redacted copy is used — routing must never see raw personal data.
      agent = resolveAgentByCapability(taskType || 'general', jurisdiction, sanitizedPrompt, {
        documentType,
        parameters,
      });
      if (agent) {
        resolvedAgentKey = agent.id;
        logger.info(`[NV-Gateway] Auto-selected agent: ${agent.name} (${agent.id}) for task=${taskType || 'general'}, jurisdiction=${jurisdiction || 'any'}, subject=${classifySubjectArea(sanitizedPrompt)}, documentType=${documentType || 'none'}`);
      } else {
        logger.info(`[NV-Gateway] Auto-selection found no matching agent, using generic fallback`);
        resolvedAgentKey = 'generic';
      }
    } else {
      agent = resolveAgent(agentKey);
    }
    const agentResolved = !!agent;

    // NV-SVC-SAFETY-PIPELINE-001: 13-step pre-gate (PII, compliance, agent audit).
    let safetyStepResults: import('./safety-pipeline.js').StepResult[] = [];
    try {
      const preSafety = await safetyPipeline.runPreProcessingPipeline({
        requestId,
        userId: userId || tenantId || 'system',
        query: userPrompt,
        agentId: resolvedAgentKey,
        jurisdiction,
        platformId: source,
        sessionId,
        tier: (tier === 'pro' || tier === 'elite' || tier === 'government' ? tier : 'solo') as 'solo' | 'plus' | 'pro' | 'enterprise',
        messages: previousMessages,
      });
      safetyStepResults = preSafety.stepResults;
      if (preSafety.blocked) {
        return {
          content: `Request blocked by Jurexio safety pipeline: ${preSafety.blockReason}`,
          tokens: { prompt: 0, completion: 0, total: 0 },
          model: 'safety-pipeline',
          latencyMs: Date.now() - start,
          piiRedacted: preSafety.piiRedacted,
          compliancePassed: false,
          source,
          requestId,
          orchestration: { promptEnhanced: false, responseEngineered: false, agentResolved, tierRouting: tier },
        };
      }
      sanitizedPrompt = preSafety.processedInput.query;
    } catch (safetyPreErr: any) {
      logger.warn(`[NV-Gateway] Safety pre-pipeline (non-fatal): ${safetyPreErr.message}`);
    }

    const slaFastTask = isSlaFastTaskType(taskType);
    const cacheNamespace = [
      'specialist',
      tenantId || 'anon',
      (jurisdiction || 'IN').toUpperCase(),
      resolvedAgentKey,
    ].join(':');

    // NV-LMCACHE-HOTPATH-001 — consult LM cache BEFORE memory ∥ RAG fan-in.
    // NV-MEM-CACHE-BYPASS-001 — memory turns must reach post-LLM store/recall;
    // a cache hit here previously skipped graph+matter writes (recall_hit=False).
    try {
      const { lmCacheService } = await import('./lm-cache-service.js');
      const lookup = await lmCacheService.get(sanitizedPrompt, cacheNamespace);
      if (lookup.hit && lookup.entry?.value && !enableMemory) {
        logger.info('[NV-Gateway] specialist LM cache hit (pre-RAG)', {
          requestId,
          namespace: cacheNamespace,
          tier: lookup.tier,
          semanticMatch: lookup.semanticMatch === true,
          similarityScore: lookup.similarityScore,
        });
        const { applyLegalResponseFormatting } = await import('./jrx-legal-response-format.js');
        let cachedContent = applyLegalResponseFormatting(String(lookup.entry.value), {
          jurisdiction,
          taskType,
          query: sanitizedPrompt,
        });
        try {
          const { applyFastDeliveryPolish } = await import('./jrx-fast-delivery-polish.js');
          cachedContent = await applyFastDeliveryPolish(cachedContent, {
            taskType,
            query: sanitizedPrompt,
            jurisdiction,
          });
        } catch { /* non-fatal */ }
        try {
          const { applyPartnerHumanPolish } = await import('../utils/jrx-partner-human-polish.js');
          cachedContent = applyPartnerHumanPolish(cachedContent, {
            taskType,
            agentKey: resolvedAgentKey,
          });
        } catch { /* non-fatal */ }
        let statuteQaMetaEarly: { applied: boolean; corrected: boolean; reason?: string } | undefined;
        if (!shouldSkipExpensiveDraftFastSteps(taskType)) {
          try {
            const { applyStatuteQaGroundingGate } = await import('./jrx-statute-qa-grounding.js');
            const gated = await applyStatuteQaGroundingGate({
              query: sanitizedPrompt,
              answer: cachedContent,
              jurisdiction,
              authority: null,
            });
            cachedContent = gated.content;
            statuteQaMetaEarly = { applied: gated.applied, corrected: gated.corrected, reason: gated.reason };
          } catch { /* non-fatal */ }
        }
        return {
          content: cachedContent,
          tokens: { prompt: 0, completion: 0, total: 0 },
          model: lookup.entry.metadata?.model || 'cache',
          latencyMs: Date.now() - start,
          piiRedacted: false,
          compliancePassed: true,
          source,
          requestId,
          orchestration: {
            promptEnhanced: false,
            responseEngineered: false,
            agentResolved: !!agent,
            tierRouting: tier,
            cacheHit: true,
            cacheTier: lookup.tier,
            cacheSemanticMatch: lookup.semanticMatch === true,
            cacheSimilarityScore: lookup.similarityScore,
            statuteQaGrounding: statuteQaMetaEarly,
          } as any,
        };
      }
    } catch (cacheErr: any) {
      logger.warn(`[NV-Gateway] LM cache pre-RAG lookup (non-fatal): ${cacheErr.message}`);
    }

    let effectiveSystemPrompt = systemPrompt;
    // NV-TOKEN-BUDGET-001 — decide the budget BEFORE assembling, so each layer
    // asks "does this task justify me?" instead of unconditionally appending.
    // Measured: without this a 19-token question reached the provider at ~5.1k
    // prompt tokens (registry L1 1,202 + overlay 2,300 + duplicates).
    const promptBudget = budgetForRequest({
      taskKind: taskType,
      prompt: sanitizedPrompt,
      forceBestOutcome: options.forceLegalBestOutcome === true,
    });
    const budgetEnforced = isPromptBudgetEnforced();
    // NV-AGENT-PROMPT-SESSION-001 + NV-LEGAL-INTEL-FORCE-001 — layered L0/L1/L2;
    // never wipe identity with longer generic registry / compiler.
    try {
      const {
        preferLegalIntelligenceSystemPrompt,
        buildUniversalLegalIntelligenceOverlay,
        mergeLegalIntelligencePrompt,
        looksLikeLegalIntelOverlay,
      } = await import('./jrx-legal-intelligence-overlay.js');
      const {
        assembleLayeredAgentSystemPrompt,
        parseAgentPromptBundle,
        resolveAgentPromptDepth,
      } = await import('./jrx-agent-prompt-bundle.js');
      const { beginPromptConstitutionTurn } = await import('./jrx-prompt-session-store.js');

      const registryBase = agent?.systemPrompt
        ? preferLegalIntelligenceSystemPrompt(systemPrompt, agent.systemPrompt)
        : systemPrompt;

      // NV-LEGAL-INTEL-MANDATE-001: High-Court counsel overlay on ALL safety-ring
      // AI paths by default. Escape only: NYV_LEGAL_INTEL_FORCE=0|off|false.
      const forceOff = ['0', 'false', 'off', 'no'].includes(
        String(process.env.NYV_LEGAL_INTEL_FORCE ?? '').trim().toLowerCase(),
      );
      const forceIntel = !forceOff || options.forceLegalBestOutcome === true;

      // NV-FAST-CHAT-NORAG-001 — lean overlay depth for explicit `-fast` chat FAQ.
      const overlayDepth = slaFastExplicit && !enableRAG
        ? 'micro'
        : (budgetEnforced ? promptBudget.overlayDepth : 'full');
      const overlay = forceIntel
        ? buildUniversalLegalIntelligenceOverlay({
          prompt: userPrompt,
          jurisdiction: jurisdiction || 'IN',
          partnerBestOutcome: true,
          depth: overlayDepth,
          documentType,
          taskType,
          parameters,
        })
        : (looksLikeLegalIntelOverlay(systemPrompt) ? systemPrompt : '');

      const fullRegistry = agent?.systemPrompt || registryBase;
      // Lean L1 for micro/chat/classify: those tasks do not justify the full
      // governance layer, and it is what pushed a one-line question over budget.
      const leanL1 = budgetEnforced
        && (promptBudget.taskClass === 'micro_faq'
          || promptBudget.taskClass === 'chat'
          || promptBudget.taskClass === 'classify');
      // NV-AGENT-PROMPT-DEPTH-001 — decide how much of the registry's operative
      // guidance (§3 jurisdiction, §4 reasoning, §5 evidence, §6 citation,
      // §17 output, §18 checklist) this task can afford. Before this, single-shot
      // partner traffic received none of it: the repeal rules that prevent
      // IPC-instead-of-BNS answers were parsed but never sent.
      const promptDepth = resolveAgentPromptDepth({
        maxPromptTokens: budgetEnforced ? promptBudget.maxPromptTokens : 24_000,
        taskClass: budgetEnforced ? promptBudget.taskClass : undefined,
        lean: leanL1,
      });
      if (agent && /<section_1_identity>|<section_0_security/i.test(String(fullRegistry))) {
        const bundle = parseAgentPromptBundle(String(fullRegistry), agent.id || 'unknown');
        if (sessionId) {
          const turn = await beginPromptConstitutionTurn({
            sessionId,
            agentId: agent.id || 'unknown',
            jurisdiction: jurisdiction || 'IN',
            promptHash: bundle.hash,
          });
          effectiveSystemPrompt = assembleLayeredAgentSystemPrompt({
            fullRegistryPrompt: String(fullRegistry),
            agentId: agent.id || 'unknown',
            mode: turn.mode,
            turnNumber: turn.turnNumber,
            taskOverlay: overlay || undefined,
            lean: leanL1,
            includeRetrievalPolicy: enableRAG,
            depth: promptDepth,
          }).systemPrompt;
        } else {
          effectiveSystemPrompt = assembleLayeredAgentSystemPrompt({
            fullRegistryPrompt: String(fullRegistry),
            agentId: agent.id || 'unknown',
            mode: 'single_shot',
            turnNumber: 1,
            taskOverlay: overlay || undefined,
            lean: leanL1,
            includeRetrievalPolicy: enableRAG,
            depth: promptDepth,
          }).systemPrompt;
        }
      } else {
        effectiveSystemPrompt = registryBase;
        if (forceIntel && overlay && !looksLikeLegalIntelOverlay(effectiveSystemPrompt)) {
          effectiveSystemPrompt = mergeLegalIntelligencePrompt(
            effectiveSystemPrompt,
            overlay,
            // Cap the non-registry base at the task's share of the budget rather
            // than the fixed 12k chars, which alone exceeded the whole budget.
            budgetEnforced ? Math.max(1_200, promptBudget.maxPromptTokens * 2) : undefined,
          );
        }
      }
    } catch {
      if (agent?.systemPrompt && agent.systemPrompt.length > systemPrompt.length) {
        effectiveSystemPrompt = agent.systemPrompt;
      }
    }

    // NV-PROMPT-COMPILER-001 — optional legacy path when layered XML not used
    if (sessionId && agent && !/<section_1_identity>/i.test(effectiveSystemPrompt) && process.env.NYV_SPECIALIST_PROMPT_COMPILER === '1') {
      try {
        const { assembleCompiledPrompt } = await import('./jrx-system-prompt-engine.js');
        const compiled = assembleCompiledPrompt(
          agent as any,
          sessionId,
          sanitizedPrompt,
          jurisdiction,
        );
        if (compiled.prompt) {
          const { mergeLegalIntelligencePrompt, looksLikeLegalIntelOverlay, buildUniversalLegalIntelligenceOverlay } =
            await import('./jrx-legal-intelligence-overlay.js');
          const priorHadIntel = looksLikeLegalIntelOverlay(effectiveSystemPrompt);
          effectiveSystemPrompt = compiled.prompt;
          if (priorHadIntel || options.forceLegalBestOutcome || !['0', 'false', 'off', 'no'].includes(String(process.env.NYV_LEGAL_INTEL_FORCE ?? '').trim().toLowerCase())) {
            const overlay = buildUniversalLegalIntelligenceOverlay({
              prompt: sanitizedPrompt,
              jurisdiction: jurisdiction || 'IN',
              partnerBestOutcome: true,
            });
            effectiveSystemPrompt = mergeLegalIntelligencePrompt(effectiveSystemPrompt, overlay);
          }
          if (compiled.compressionApplied) {
            logger.info(`[NV-Gateway] prompt compiler saved ~${compiled.tokensSaved} tokens session=${sessionId}`);
          }
        }
      } catch (compErr: any) {
        logger.warn(`[NV-Gateway] prompt compiler (non-fatal): ${compErr.message}`);
      }
    }

    let enhancedPrompt = sanitizedPrompt;
    let enhancedSystemPrompt = effectiveSystemPrompt;
    let enhancementMetrics: NvOrchestrationMetadata['enhancementMetrics'] = undefined;
    let ragContextResult: NvResponse['ragContext'] = undefined;
    let memoryContextResult: NvResponse['memoryContext'] = undefined;
    let graphTraversalUsed = false;
    let ragConfidence = 1;
    let ragAttempted = false;
    let ragGrounded = false;

    // NV-HOTPATH-PARALLEL-001 + NV-CTX-BUDGET-001 — memory ∥ Auto-RAG with complexity budgets
    const { resolveContextBudgets, withContextTimeout } = await import('../orchestration/jrx-context-budgets.js');
    const specialistComplexity = slaFastTask
      ? 'simple'
      : /research|analysis|contract|litigation|opinion/i.test(taskType || '')
        ? (String(tier) === 'lite' || tier === 'solo' || tier === 'default' ? 'moderate' : 'complex')
        : (String(tier) === 'lite' || tier === 'solo' || tier === 'default' ? 'simple' : 'moderate');
    const ctxBudgets = resolveContextBudgets(
      options.forceLegalBestOutcome && !slaFastTask ? 'very_complex' : specialistComplexity,
      {
        partnerBestOutcome: options.forceLegalBestOutcome === true,
        partnerSlaFast: slaFastTask,
      },
    );
    // NV-MEM-FAST-NORAG-001 — explicit partner memory on SLA-fast chat must not
    // inherit the 280-char / session-only budget meant for doc-less no-memory turns.
    if (enableMemory && slaFastTask) {
      ctxBudgets.memoryLimit = Math.max(ctxBudgets.memoryLimit, 6);
      ctxBudgets.memorySlice = Math.max(ctxBudgets.memorySlice, 6);
      ctxBudgets.memoryCharCap = Math.max(ctxBudgets.memoryCharCap, 720);
      ctxBudgets.memorySources = 'session+longterm';
    }

    const memoryPromise = (enableMemory && sessionId)
      ? withContextTimeout(
          (async () => {
            try {
              // NV-MEM-TENANT-001 — tenant is part of the recall key, not an
              // afterthought: without it a shared graph is readable across orgs.
              // NV-MEM-SINGLEPASS-001 — one scored pass yields both the memory
              // nodes and the GraphRAG chains (previously two O(n) scans).
              const graphPack = await graphMemoryService.recall(
                {
                  query: sanitizedPrompt,
                  userId,
                  tenantId,
                  sessionId,
                  limit: ctxBudgets.memoryLimit,
                  includeRelated: ctxBudgets.memorySources !== 'session',
                  maxHops: ctxBudgets.memoryMaxHops,
                },
                { maxChains: Math.min(6, ctxBudgets.memorySlice) },
              );

              // NV-MEM-DURABLE-RECALL-001 — L2 matter memory was written on every
              // orchestrate turn (NV-MEM-DURABLE-WIRE-001) but never read on the
              // live path; partner recall depended solely on the process-local graph
              // tier and returned empty after gateway recreate or cross-pod routing.
              let mergedNodes = graphPack.memory.nodes;
              if (matterId && userId) {
                const numericUserId = parseInt(String(userId), 10);
                if (Number.isFinite(numericUserId) && numericUserId > 0) {
                  try {
                  const { nv5TierMemoryService } = await import('./memory/jrx-5tier-memory-service.js');
                  const orgNumeric = tenantId != null && String(tenantId).trim() !== ''
                    ? parseInt(String(tenantId), 10)
                    : NaN;
                  const matterRows = await nv5TierMemoryService.getMatterMemory(
                    matterId,
                    {
                      userId: numericUserId,
                      ...(Number.isFinite(orgNumeric) && orgNumeric > 0 ? { orgId: orgNumeric } : {}),
                    },
                    Math.max(ctxBudgets.memoryLimit * 4, 24),
                  );
                  if (matterRows.length > 0) {
                    const sessionScoped = sessionId
                      ? matterRows.filter((row: Record<string, unknown>) => {
                          const meta = (row.metadata as Record<string, unknown>) || {};
                          const rowSession = meta.sessionId;
                          return rowSession != null && String(rowSession) === String(sessionId);
                        })
                      : [];
                    // NV-MEM-SESSION-SCOPE-001 — when the caller supplied a session id,
                    // never fall back to the full matter corpus: stale rows drowned out the
                    // current turn's graph write (partner codeword probe recall_hit=False).
                    const matterPool = sessionId
                      ? (sessionScoped.length > 0 ? sessionScoped : [])
                      : matterRows;
                    if (matterPool.length === 0) {
                      // keep graphPack.memory.nodes
                    } else {
                    const rankedRows = matterPool
                      .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
                        const ta = a.createdAt ? new Date(String(a.createdAt)).getTime() : 0;
                        const tb = b.createdAt ? new Date(String(b.createdAt)).getTime() : 0;
                        return tb - ta;
                      })
                      .slice(0, ctxBudgets.memoryLimit);
                    const matterNodes: MemoryNode[] = rankedRows.map((row: Record<string, unknown>, idx: number) => ({
                      id: `matter-${String(row.id ?? idx)}`,
                      type: 'fact',
                      content: String(row.content ?? ''),
                      metadata: (row.metadata as Record<string, unknown>) || { matterId, source: 'matter_memory' },
                      createdAt: row.createdAt ? new Date(String(row.createdAt)) : new Date(),
                      lastAccessedAt: new Date(),
                      accessCount: 1,
                      decayScore: 1,
                      importance: typeof row.importance === 'number' ? row.importance : 0.6,
                      source: 'matter_memory',
                      userId: String(numericUserId),
                      sessionId,
                      tenantId,
                    }));
                    mergedNodes = matterNodes;
                    const seen = new Set(mergedNodes.map((n) => n.content.slice(0, 120)));
                    for (const node of graphPack.memory.nodes) {
                      const key = node.content.slice(0, 120);
                      if (!seen.has(key)) {
                        mergedNodes.push(node);
                        seen.add(key);
                      }
                    }
                    mergedNodes = mergedNodes.slice(0, ctxBudgets.memoryLimit);
                    }
                  }
                  } catch (matterRecallErr: any) {
                    logger.warn(`[NV-Gateway] Matter memory recall failed (non-fatal): ${matterRecallErr.message}`);
                  }
                }
              }

              if (mergedNodes.length === 0 && sessionId) {
                try {
                  const { nv5TierMemoryService } = await import('./memory/jrx-5tier-memory-service.js');
                  const episodic = await nv5TierMemoryService.getEpisodic(sessionId, ctxBudgets.memoryLimit);
                  if (episodic.length > 0) {
                    mergedNodes = episodic.slice(-ctxBudgets.memoryLimit).map((ev, idx) => ({
                      id: `episodic-${sessionId}-${idx}`,
                      type: 'fact' as const,
                      content: String(ev.content ?? ''),
                      metadata: { source: 'episodic', type: ev.type },
                      createdAt: ev.timestamp instanceof Date ? ev.timestamp : new Date(String(ev.timestamp ?? Date.now())),
                      lastAccessedAt: new Date(),
                      accessCount: 1,
                      decayScore: 1,
                      importance: 0.6,
                      source: 'episodic',
                      userId,
                      sessionId,
                      tenantId,
                    }));
                  }
                } catch (episodicErr: any) {
                  logger.warn(`[NV-Gateway] Episodic recall failed (non-fatal): ${episodicErr.message}`);
                }
              }

              if (sessionId) {
                const sessionKey = String(sessionId);
                mergedNodes = mergedNodes
                  .filter((n) => !n.sessionId || String(n.sessionId) === sessionKey)
                  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                  .slice(0, ctxBudgets.memoryLimit);
              }

              if (mergedNodes === graphPack.memory.nodes) {
                return graphPack;
              }
              return {
                memory: { ...graphPack.memory, nodes: mergedNodes },
                graph: graphPack.graph,
              };
            } catch (err: any) {
              logger.warn(`[NV-Gateway] Memory recall failed (non-fatal): ${err.message}`);
              return null;
            }
          })(),
          ctxBudgets.parallelTimeoutMs,
          null,
        )
      : Promise.resolve(null);

    const chatFastStatutePrefetch = isPartnerExplicitFastChatAlias(taskType)
      && !enableRAG
      && !needsGenerationBeyondRetrieval(sanitizedPrompt);

    const statutePrefetchPromise = chatFastStatutePrefetch
      ? withContextTimeout(
          (async () => {
            try {
              const { tryStatutePrefetchLightweight } = await import('./jrx-statute-qa-grounding.js');
              return await tryStatutePrefetchLightweight(sanitizedPrompt, jurisdiction || 'IN', 1800);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`[NV-Gateway] Statute prefetch failed (non-fatal): ${msg}`);
              return null;
            }
          })(),
          2000,
          null,
        )
      : Promise.resolve(null);

    const ragPromise = enableRAG
      ? withContextTimeout(
          (async () => {
            try {
              const { autoRagRetrieve } = await import('./jrx-auto-rag-router.js');
              return await autoRagRetrieve({
                query: sanitizedPrompt,
                jurisdiction,
                tier,
                taskType,
                userId,
                tenantId,
                topK: ctxBudgets.ragTopK,
                // NV-RAG-CHAR-BUDGET-001: ragTopK caps how many chunks arrive;
                // these cap how large the assembled block may get. Without them
                // the partner floor (topK 16) could inject ~18k tokens of
                // retrieval alone, overrunning every prompt budget downstream.
                ragChunkCharCap: ctxBudgets.ragChunkCharCap,
                ragTotalCharCap: ctxBudgets.ragTotalCharCap,
              });
            } catch (err: any) {
              logger.warn(`[NV-Gateway] Auto-RAG retrieval failed (non-fatal): ${err.message}`);
              return null;
            }
          })(),
          ctxBudgets.parallelTimeoutMs,
          null,
        )
      : Promise.resolve(null);

    // NV-MEM-COMPILER-WIRE-001 — compiled-knowledge recall. Namespaced per
    // matter (falling back to tenant) so compiled articles cannot cross a
    // tenant boundary; skipped entirely when neither is known.
    const compiledNamespace = matterId
      ? `matter_${matterId}`
      : (tenantId ? `tenant_${tenantId}` : '');
    const compiledPromise = (enableMemory && compiledNamespace)
      ? withContextTimeout(
          (async () => {
            try {
              const { mem0PersistenceService } = await import('./mem0-persistence-service.js');
              return await mem0PersistenceService.recallCompiledKnowledge(
                resolvedAgentKey,
                sanitizedPrompt,
                {
                  namespace: compiledNamespace,
                  maxArticles: Math.max(1, Math.min(3, ctxBudgets.memorySlice)),
                  charCap: ctxBudgets.memoryCharCap * 2,
                },
              );
            } catch (err: any) {
              logger.warn(`[NV-Gateway] Compiled-knowledge recall failed (non-fatal): ${err.message}`);
              return null;
            }
          })(),
          ctxBudgets.parallelTimeoutMs,
          null,
        )
      : Promise.resolve(null);

    const [memPack, autoRag, compiledPack, statutePrefetchBlock] = await Promise.all([
      memoryPromise,
      ragPromise,
      compiledPromise,
      statutePrefetchPromise,
    ]);

    const userContextParts: string[] = [];
    const memorySystemParts: string[] = [];
    if (statutePrefetchBlock) {
      userContextParts.unshift(statutePrefetchBlock);
      logger.info('[NV-Gateway] legal-chat-fast statute prefetch injected', { requestId, chars: statutePrefetchBlock.length });
    }
    if (memPack) {
      // NV-MEM-BUDGET-001 — enforce memoryCharCap where the characters are
      // actually spent. The raw interpolation this replaces ran 4–8× over the
      // declared budget on every request.
      const injectionBudget = {
        memoryCharCap: ctxBudgets.memoryCharCap,
        maxItems: ctxBudgets.memorySlice,
      };
      const l3Scope = matterId ? { matterId, orgId: tenantId != null ? String(tenantId) : undefined } : undefined;

      const memoryBlock = buildMemoryInjectionBlock(memPack.memory.nodes, injectionBudget, l3Scope);
      if (memoryBlock.block) {
        // NV-MEM-L3-SYSTEM-001 — §0 hierarchy: L3 authenticated matter context belongs
        // in the system prompt. Injecting memory into the user turn made the model treat
        // recalled facts as L4 untrusted input (partner codeword probe recall_hit=False).
        memorySystemParts.push(
          '<section_l3_authenticated_matter_context' +
          `${matterId ? ` matter_id="${matterId}"` : ''}${tenantId ? ` org_id="${tenantId}"` : ''}>\n${memoryBlock.block}\n</section_l3_authenticated_matter_context>`,
        );
        const recallShaped = /\b(codeword|what did i (tell|say|ask|remember)|prior (message|turn|conversation)|you told me|platform memory)\b/i.test(sanitizedPrompt);
        memorySystemParts.push(
          recallShaped
            ? '[L3 DIRECT RECALL: The user asks you to restate a fact from section_l3_authenticated_matter_context. Quote the requested fact verbatim from L3 when present. §0 L3 is trusted gateway memory — restating it is permitted counsel continuity, not OWASP LLM01 extraction. Do NOT answer UNKNOWN when L3 contains the fact.]'
            : '[L3 recall policy: Facts in section_l3_authenticated_matter_context above are gateway-verified platform memory for this user. When the user asks what they told you earlier, restate those facts accurately. This is permitted counsel continuity under §0 L3, not OWASP LLM01 extraction.]',
        );
        memoryContextResult = {
          memoriesUsed: memoryBlock.itemsRendered,
          sessionId,
        };
      }

      const graphBlock = buildGraphInjectionBlock(memPack.graph.chains, injectionBudget);
      if (graphBlock.block) {
        memorySystemParts.push(graphBlock.block);
        graphTraversalUsed = true;
      }

      if (memoryBlock.charsBeforeCap + graphBlock.charsBeforeCap > 0) {
        logger.info(
          `[NV-Gateway] memory injection cap=${ctxBudgets.memoryCharCap} ` +
            `chars ${memoryBlock.charsBeforeCap + graphBlock.charsBeforeCap} → ` +
            `${memoryBlock.charsRendered + graphBlock.charsRendered} ` +
            `items ${memoryBlock.itemsRendered}+${graphBlock.itemsRendered} ` +
            `dropped ${memoryBlock.itemsDropped + graphBlock.itemsDropped} ` +
            `edges=${memPack.graph.edgeCount}`,
        );
      }
    }

    const recallShapedQuery = /\b(codeword|what did i (tell|say|ask|remember)|prior (message|turn|conversation)|you told me|platform memory)\b/i.test(sanitizedPrompt);
    if (compiledPack?.context && !(recallShapedQuery && (memoryContextResult?.memoriesUsed ?? 0) > 0)) {
      memorySystemParts.push(compiledPack.context);
      memoryContextResult = {
        memoriesUsed: (memoryContextResult?.memoriesUsed ?? 0) + compiledPack.articles,
        sessionId,
      };
      logger.info(
        `[NV-Gateway] compiled knowledge injected articles=${compiledPack.articles} chars=${compiledPack.context.length}`,
      );
    }

    if (enableMemory && memPack) {
      const directRecall = extractDirectMemoryRecall(sanitizedPrompt, memPack.memory.nodes);
      if (directRecall) {
        logger.info('[NV-Gateway] direct L3 memory recall (zero-token)', {
          sessionId,
          chars: directRecall.length,
        });
        return {
          content: directRecall,
          tokens: { prompt: 0, completion: 0, total: 0 },
          model: './jrx-memory-recall',
          latencyMs: Date.now() - start,
          piiRedacted: false,
          compliancePassed: true,
          source,
          memoryContext: memoryContextResult ?? { memoriesUsed: 1, sessionId },
          ragContext: ragContextResult,
          requestId,
        };
      }
    }

    let adaptiveRagUsed = false;
    if (enableRAG) {
      ragAttempted = true;
      if (autoRag) {
        ragConfidence = autoRag.confidence ?? 0;
        if (autoRag.chunks.length > 0) {
          ragGrounded = true;
          userContextParts.unshift(autoRag.contextBlock);
          ragContextResult = {
            // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
            documentsRetrieved: autoRag.chunks.length,
            searchQuery: sanitizedPrompt,
            retrievalMethods: autoRag.retrievalMethods,
            intent: autoRag.intent,
            layersUsed: autoRag.layersUsed,
            confidence: autoRag.confidence,
          };
          adaptiveRagUsed = autoRag.layersUsed.includes('adaptive') || autoRag.layersUsed.includes('corrective');
          logger.info(
            `[NV-Gateway] Auto-RAG: ${autoRag.chunks.length} chunks intent=${autoRag.intent} conf=${autoRag.confidence} layers=[${autoRag.layersUsed.join('+')}]`,
          );
        }
      }
    }

    // NV-STATUTE-QA-GROUND-001 — force statute authority into context for section FAQs
    let statuteAuthority: import('./jrx-statute-qa-grounding.js').StatuteAuthority | null = null;
    let statuteQaMeta: { applied: boolean; corrected: boolean; reason?: string } | undefined;
    try {
      const {
        parseStatuteReference,
        resolveStatuteAuthority,
        formatStatuteContextBlock,
        isStatuteQaGroundingEnabled,
      } = await import('./jrx-statute-qa-grounding.js');
      if (isStatuteQaGroundingEnabled() && parseStatuteReference(sanitizedPrompt)) {
        statuteAuthority = await resolveStatuteAuthority(sanitizedPrompt, jurisdiction || 'IN');
        if (statuteAuthority) {
          userContextParts.unshift(formatStatuteContextBlock(statuteAuthority));
          ragGrounded = true;
          ragConfidence = Math.max(ragConfidence, 0.9);
          logger.info('[NV-Gateway] statute QA authority injected', {
            act: statuteAuthority.act_short_title,
            section: statuteAuthority.section_number,
            title: statuteAuthority.section_title,
          });
        }
      }
    } catch (e: any) {
      logger.warn(`[NV-Gateway] statute QA pre-context failed (non-fatal): ${e?.message}`);
    }

    if (memorySystemParts.length > 0) {
      enhancedSystemPrompt = `${enhancedSystemPrompt}\n\n${memorySystemParts.join('\n\n')}`;
    }
    if (userContextParts.length > 0) {
      enhancedPrompt = `${userContextParts.join('\n\n')}\n\n[User Query]\n${sanitizedPrompt}`;
    }

    /* NV-NYS-DETERMINISTIC-WIRE-001 (2026-08-16) — honour the deterministic
     * verdict on the specialist path.
     *
     * NV-NYS-LLMREQUIRED-001 made Auto-RAG carry `deterministic.answer`, but only
     * the knowledge-plane routes consumed it. Per NV-WIRING-001 exported is not
     * live: every `/orchestrate` request — the majority of traffic — still paid a
     * frontier completion to restate statute text NYS had already returned
     * verbatim in ~50 ms.
     *
     * Placed BEFORE the NV-RAG-ABSTAIN-001 gate deliberately. A resolved statute
     * answer with pin-cites is strictly better than asking the user to clarify,
     * and `abstainTasks` includes 'advisory'/'research', so a citation-resolution
     * request could otherwise be told to rephrase a question we had already
     * answered.
     *
     * Safety: this returns stored corpus text with no model egress, so there is
     * nothing to redact — `compliancePassed` is true because no data left the
     * platform, not because a check was skipped. The scope gate
     * (`isDeterministicallySufficient`) has already rejected anything needing
     * reasoning; NYS's own `llmRequired: false` is NOT trusted on its own, since
     * it returns false for strategy prompts that merely name a section — the
     * exact shape of NV-STATUTE-FAQ-SCOPE-001. */
    const deterministicAnswer = autoRag?.deterministic?.answer;
    if (deterministicAnswer?.content && !needsGenerationBeyondRetrieval(sanitizedPrompt)) {
      logger.info(
        `[NV-Gateway] deterministic answer served resolver=${deterministicAnswer.resolver} ` +
          `intent=${deterministicAnswer.intent} citations=${deterministicAnswer.citations.length} ` +
          `chars=${deterministicAnswer.content.length} completions=0`,
      );
      return {
        content: deterministicAnswer.content,
        tokens: { prompt: 0, completion: 0, total: 0 },
        model: deterministicAnswer.resolver,
        latencyMs: Date.now() - start,
        piiRedacted: false,
        compliancePassed: true,
        source,
        requestId,
        ragContext: ragContextResult,
        orchestration: {
          promptEnhanced: false,
          responseEngineered: false,
          agentResolved: !!agent,
          tierRouting: tier,
          deterministic: true,
          deterministicResolver: deterministicAnswer.resolver,
          deterministicIntent: deterministicAnswer.intent,
          nysReason: deterministicAnswer.nysReason,
          citations: deterministicAnswer.citations,
          ragConfidence,
          ragGrounded,
        } as any,
      };
    }

    // NV-RAG-ABSTAIN-001 — research/opinion without grounding → ask-clarify.
    // Short statute FAQs are handled by NV-STATUTE-QA-GROUND-001 (retrieve + conflict rewrite),
    // not by allowing ungrounded model-only answers.
    const abstainTasks = /^(research|opinion|advisory|precedent|litigation)$/i;
    const wantsCaseLaw = /\b(case\s*law|precedent|cit(e|ation)|judgment|judgement|AIR\s|SCC\s)\b/i.test(sanitizedPrompt);
    const abstainFloor = Number(process.env.NYV_RAG_ABSTAIN_MIN_CONFIDENCE || '0.45');
    const forceAbstain = process.env.NYV_RAG_ABSTAIN_ON_EMPTY !== '0';
    if (
      forceAbstain
      && enableRAG
      && (abstainTasks.test(taskType || '') || wantsCaseLaw)
      && sanitizedPrompt.length > 120
      && (!ragGrounded || ragConfidence < abstainFloor)
    ) {
      const { buildUngroundedAbstainMessage } = await import('./jrx-legal-response-format.js');
      return {
        content: buildUngroundedAbstainMessage({
          query: sanitizedPrompt,
          confidence: ragConfidence,
          jurisdiction,
        }),
        tokens: { prompt: 0, completion: 0, total: 0 },
        model: 'rag-abstain',
        latencyMs: Date.now() - start,
        piiRedacted: false,
        compliancePassed: true,
        source,
        requestId,
        ragContext: ragContextResult,
        orchestration: {
          promptEnhanced: false,
          responseEngineered: false,
          agentResolved: !!agent,
          tierRouting: tier,
          ragAbstain: true,
          ragConfidence,
          ragGrounded,
        } as any,
      };
    }

    // NV-SPECIALIST-LMCACHE-001 — cache lookup moved pre-RAG (NV-LMCACHE-HOTPATH-001).
    // Late-path duplicate removed; writes still occur post-LLM below.

    // NV-TOKEN-BUDGET-001 — the enhancement pipeline restates role/domain/
    const skipEnhancement = budgetEnforced && (
      promptBudget.taskClass === 'micro_faq' || slaFastExplicit
    );
    if (enableOrchestration && !skipEnhancement) {
      try {
        const jurisdictionContext = jurisdiction || 'India';
        const enhanced = await promptEnhancementPipeline.enhance({
          originalPrompt: enhancedPrompt !== sanitizedPrompt ? enhancedPrompt : sanitizedPrompt,
          role: agent?.name || `Legal AI Agent (${resolvedAgentKey})`,
          task: taskType || 'legal-analysis',
          context: {
            sessionId,
            userId: userId || tenantId,
            agentId: resolvedAgentKey,
            domainContext: domainContext || `${jurisdictionContext} jurisdiction ${agent?.practiceArea || 'legal'} analysis`,
            constraints: [
              'Provide accurate legal citations',
              `Comply with ${jurisdictionContext} jurisdiction regulations`,
              agent?.securityLevel === 'critical' ? 'Apply maximum security protocols' : 'Apply standard security',
            ],
            previousMessages,
          },
          outputFormat: { type: 'structured' },
          config: {
            language,
            tone: 'professional',
            verbosity: tier === 'pro' || tier === 'elite' || tier === 'government' ? 'comprehensive' : 'detailed',
            enableChainOfThought: !!enableCoT,
          },
        });

        enhancedPrompt = enhanced.prompt;
        // Longest-wins let the pipeline's generic scaffolding displace the
        // budgeted, jurisdiction-grounded prompt. Only accept a longer system
        // prompt while it still fits the task budget.
        if (enhanced.systemPrompt && enhanced.systemPrompt.length > enhancedSystemPrompt.length) {
          const withinBudget = !budgetEnforced
            || estimatePromptTokens(enhanced.systemPrompt) <= promptBudget.maxPromptTokens;
          if (withinBudget) enhancedSystemPrompt = enhanced.systemPrompt;
        }
        enhancementMetrics = enhanced.metadata;
      } catch (err: any) {
        logger.warn(`[NV-Gateway] Prompt enhancement failed (non-fatal): ${err.message}`);
      }
    }

    if (budgetEnforced) {
      const assembledTokens =
        estimatePromptTokens(enhancedSystemPrompt) + estimatePromptTokens(enhancedPrompt);
      logger.info(
        `[NV-Gateway] prompt budget class=${promptBudget.taskClass} ` +
          `cap=${promptBudget.maxPromptTokens} assembled=${assembledTokens} ` +
          `system=${estimatePromptTokens(enhancedSystemPrompt)} user=${estimatePromptTokens(enhancedPrompt)} ` +
          `overlay=${promptBudget.overlayDepth}${assembledTokens > promptBudget.maxPromptTokens ? ' OVER' : ''}`,
      );
    }

    const isMitraAgent = ['mitra-conversational', 'clause-classifier', 'case-brief-generator'].includes(resolvedAgentKey);
    const mitraPreferredModel = isMitraAgent ? 'nvidia/nemotron-nano-9b-v2:free' : undefined;

    const llmRequest: LLMRequest = {
      id: requestId,
      userId: userId || tenantId || 'system',
      prompt: enhancedPrompt,
      systemPrompt: enhancedSystemPrompt,
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        ...(previousMessages || []),
        { role: 'user', content: enhancedPrompt },
      ],
      maxTokens,
      temperature: tierConfig.temperature,
      ...(isMitraAgent ? { provider: 'openrouter', model: mitraPreferredModel } : {}),
      // NV-ROUTER-TIER-PROPAGATION-2026-05-11: propagate tier/jurisdiction/agent
      // identity into the LLMRequest so real-llm-service.ts builds an accurate
      // RouterRequest. Without these, sanitizeInputs() defaults tier→'free' and
      // jurisdiction→'GLOBAL', causing tierFitScore to give paid Anthropic/
      // OpenAI direct providers -3 and free OpenRouter models +6 — the cascade
      // then chains through OpenRouter free models (rate-limited 429) and never
      // tries the paid providers we have keys for.
      ...({
        tier: tier as any,
        jurisdiction: jurisdiction as any,
        agentId: resolvedAgentKey,
        organizationId: tenantId,
        taskKind: (taskType as any) || undefined,
        documentType,
      } as any),
      requirements: {
        complexity: (callerLlmComplexity
          || (isMitraAgent ? 'medium' : (tierConfig.qualityLevel === 'expert' ? 'expert' : tierConfig.qualityLevel === 'standard' ? 'simple' : 'medium'))) as any,
        domain: agent?.practiceArea?.toLowerCase().includes('research') ? 'analytical' : 'analytical',
        priority: tierConfig.priority as any,
        costBudget: (callerCostBudget || tierConfig.costBudget) as any,
        responseTime: (callerResponseTime || tierConfig.responseTime) as any,
        qualityLevel: (callerQualityLevel || tierConfig.qualityLevel) as any,
      },
      fallbackLevels: tierConfig.fallbackLevels,
      timestamp: new Date(),
    };

    const llmResponse = await realLLMService.executeRequest(llmRequest);
    let processedContent = llmResponse.content;
    let qualityMetrics: NvOrchestrationMetadata['qualityMetrics'] = undefined;

    if (enableOrchestration && !slaFastExplicit) {
      try {
        const engineered = await responseEngineeringPipeline.process(
          {
            content: llmResponse.content,
            agentId: resolvedAgentKey,
            modelId: llmResponse.model,
            metadata: { jurisdiction, taskType, tier, agentName: agent?.name },
            tokensUsed: llmResponse.tokens.total,
            latency: llmResponse.responseTime,
          },
          {
            language,
            enableTranslation: language !== 'en',
            enableQualityCheck: true,
            enableFormatting: true,
            enableSanitization: true,
            tone: 'professional',
            targetAudience: tier === 'government' ? 'executive' : tier === 'pro' || tier === 'elite' ? 'business' : 'general',
          }
        );
        processedContent = engineered.processed.content;
        qualityMetrics = {
          readability: engineered.quality.readability,
          coherence: engineered.quality.coherence,
          accuracy: engineered.quality.accuracy,
          completeness: engineered.quality.completeness,
          relevance: engineered.quality.relevance,
          overall: engineered.quality.overall,
        };
      } catch (err: any) {
        logger.warn(`[NV-Gateway] Response engineering failed (non-fatal): ${err.message}`);
      }
    }

    /* ── Nyayamitra agent post-processing ─────────────────────────────────────
       (a) mitra-conversational → strip any model-emitted disclaimer
           (the Nyayamitra backend appends the canonical one).
       (b) clause-classifier / case-brief-generator → enforce STRICT JSON.
           Brace-balanced extraction; on parse failure, single retry with a
           hardened "JSON ONLY — no markdown, no commentary" re-prompt.
    ─────────────────────────────────────────────────────────────────────────── */
    if (resolvedAgentKey === 'mitra-conversational') {
      const stripped = processedContent
        .split('\n')
        .filter(line => !/^\s*(\*\*?disclaimer\*?\*?|disclaimer\s*[:\-])/i.test(line.trim()))
        .join('\n')
        .trim();
      if (stripped !== processedContent) {
        logger.info(`[NV-Gateway] mitra-conversational: stripped model-emitted disclaimer (${processedContent.length - stripped.length} chars)`);
        processedContent = stripped;
      }
    }

    if (resolvedAgentKey === 'clause-classifier' || resolvedAgentKey === 'case-brief-generator') {
      const extractJsonString = (raw: string): string | null => {
        const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
        let depth = 0, start = -1;
        for (let i = 0; i < cleaned.length; i++) {
          const c = cleaned[i];
          if (c === '{') { if (depth === 0) start = i; depth++; }
          else if (c === '}') {
            depth--;
            if (depth === 0 && start >= 0) {
              const candidate = cleaned.slice(start, i + 1);
              try { JSON.parse(candidate); return candidate; } catch { start = -1; }
            }
          }
        }
        return null;
      };

      let jsonStr = extractJsonString(processedContent);
      if (!jsonStr) {
        logger.warn(`[NV-Gateway] ${resolvedAgentKey}: JSON parse failed on first attempt — retrying once with strict re-prompt`);
        try {
          const strictSystem = enhancedSystemPrompt +
            '\n\nCRITICAL: Your previous response was not valid JSON. Output ONLY the JSON object now — no prose, no markdown fences, no commentary, no preamble. The first character of your response MUST be `{` and the last MUST be `}`.';
          const retryRequest: LLMRequest = {
            ...llmRequest,
            /* NV-REQID-CORRELATION-001 (follow-up) — this was `crypto.randomUUID()`,
             * which made the retry a billed call attributable to NO request: it does
             * not equal the parent id and shares no prefix with it, so neither the
             * provider-log extractor nor any audit join could see it. It is the
             * sibling of the Self-RAG dispatch below, which already uses a
             * `${requestId}-selfrag` suffix — this now follows the same convention.
             * Measured effect: the v2 benchmark's metering gate showed "envelope 4
             * vs provider log 1" on statute-faq, and this was one of the missing
             * calls. */
            id: `${requestId}-jsonretry`,
            systemPrompt: strictSystem,
            messages: [
              { role: 'system', content: strictSystem },
              { role: 'user', content: enhancedPrompt },
            ],
            temperature: 0,
          };
          const retryResp = await realLLMService.executeRequest(retryRequest);
          const retryJson = extractJsonString(retryResp.content);
          if (retryJson) {
            jsonStr = retryJson;
            processedContent = retryJson;
            logger.info(`[NV-Gateway] ${resolvedAgentKey}: strict JSON retry SUCCEEDED`);
          } else {
            logger.error(`[NV-Gateway] ${resolvedAgentKey}: strict JSON retry FAILED — returning fail-closed JSON error envelope`);
            processedContent = JSON.stringify({
              error: 'json_contract_violation',
              agentKey: resolvedAgentKey,
              message: 'Agent did not return parseable JSON after one strict retry.',
            });
          }
        } catch (retryErr: any) {
          logger.error(`[NV-Gateway] ${resolvedAgentKey}: JSON retry error: ${retryErr.message}`);
          processedContent = JSON.stringify({
            error: 'json_contract_violation',
            agentKey: resolvedAgentKey,
            message: `Agent JSON retry errored: ${retryErr.message || 'unknown'}`,
          });
        }
      } else {
        processedContent = jsonStr;
      }
    }

    // NV-SVC-SAFETY-PIPELINE-001: post-LLM steps 6–13 (hallucination, citation, confidence, audit).
    try {
      const postSafety = await safetyPipeline.runPostProcessingPipeline(
        processedContent,
        {
          requestId,
          userId: userId || tenantId || 'system',
          query: userPrompt,
          agentId: resolvedAgentKey,
          jurisdiction,
          platformId: source,
          sessionId,
          tier: (tier === 'pro' || tier === 'elite' || tier === 'government' ? 'pro' : 'solo') as 'solo' | 'plus' | 'pro' | 'enterprise',
        },
        safetyStepResults,
      );
      processedContent = postSafety.response;
    } catch (safetyPostErr: any) {
      logger.warn(`[NV-Gateway] Safety post-pipeline (non-fatal): ${safetyPostErr.message}`);
    }

    let hallucinationResult: NvResponse['hallucinationCheck'] = undefined;
    let citationResult: NvResponse['citations'] = undefined;
    let hitlResult: NvResponse['hitlStatus'] = undefined;
    let explainabilityResult: NvResponse['explainability'] = undefined;
    let biasAuditResult: NvResponse['biasAudit'] = undefined;
    let cotResult: NvResponse['chainOfThought'] = undefined;
    let selfRagValidated = false;
    let confidenceResult: NvResponse['confidence'] = undefined;

    // GAP-009: Emit AG-UI events when a session is active
    const aguiSessionId = sessionId ? `nv-${sessionId}` : null;
    if (aguiSessionId && sessionId) {
      try {
        aguiJurexioIntegrationService.createSession(0, undefined, resolvedAgentKey, undefined);
        aguiJurexioIntegrationService.emitProgress(aguiSessionId, 10, 'Analysing request', 8, 1);
        aguiJurexioIntegrationService.emitThinking(aguiSessionId, 'pipeline-start', `Processing ${taskType || 'legal'} task via ${resolvedAgentKey}`, resolvedAgentKey, 0.8);
      } catch { }
    }

    // GAP-001: Self-RAG — real regeneration via safety ring when validation fails
    if (enableRAG && ragGrounded && (tier === 'pro' || tier === 'elite' || tier === 'government') &&
        (taskType === 'analysis' || taskType === 'research' || taskType === 'contract-review')) {
      try {
        const ragContext = ragContextResult ? enhancedPrompt : '';
        const selfRagSession = await selfRAGService.runSelfRAGLoop(
          sanitizedPrompt,
          ragContext,
          async (query: string, ctx: string) => {
            // Real regen (not stub) — one bounded follow-up through LLM router
            const regen = await realLLMService.executeRequest({
              ...llmRequest,
              id: `${requestId}-selfrag`,
              prompt: `${ctx}\n\nRevise the answer for query: ${query}\nPrior draft:\n${processedContent}\n\nImprove grounding and citations only.`,
              messages: [
                { role: 'system', content: enhancedSystemPrompt },
                {
                  role: 'user',
                  content: `${ctx}\n\nRevise for query: ${query}\nPrior draft:\n${processedContent.slice(0, 6000)}`,
                },
              ],
            } as any);
            return regen.content || processedContent;
          },
          { config: { maxRegenerations: 1, validationThreshold: 0.75 } },
        );
        selfRagValidated = selfRagSession.passed || selfRagSession.iterations.length > 0;
        if (selfRagSession.finalAnswer && selfRagSession.finalAnswer !== processedContent) {
          processedContent = selfRagSession.finalAnswer;
          logger.info(`[NV-Gateway] Self-RAG: regenerated, iterations=${selfRagSession.iterations.length}`);
        }
      } catch (selfRagErr: any) {
        logger.warn(`[NV-Gateway] Self-RAG (non-fatal): ${selfRagErr.message}`);
      }
    }

    // NV-COT-001: CoT only when explicitly requested — never additive post-hoc tax on specialist
    const shouldRunCoT = !!enableCoT;
    if (shouldRunCoT) {
      try {
        // NV-COT-AUTO-STRATEGY-001 — seven of the eight implemented strategies
        // were unreachable because every server-side site pinned 'zero_shot_cot'.
        // Select from the task shape unless the caller named a strategy itself.
        // Only single-call strategies are auto-selected, so cost is unchanged.
        const effectiveCotStrategy = options.cotStrategy
          ? cotStrategy
          : selectCoTStrategy({
            prompt: sanitizedPrompt,
            taskType,
            taskClass: budgetEnforced ? promptBudget.taskClass : undefined,
          });
        const cotSession = await chainOfThoughtService.executeReasoning(
          sanitizedPrompt,
          effectiveCotStrategy,
          { maxSteps: 8, domain: 'legal' }
        );
        if (cotSession && cotSession.reasoning?.steps?.length > 0) {
          cotResult = {
            steps: cotSession.reasoning.steps.map((s: any) => s.thought || s.action || s.observation || String(s)),
            strategy: cotSession.strategy || effectiveCotStrategy,
            confidence: cotSession.reasoning.totalConfidence ?? cotSession.confidence ?? 0.8,
          };
          logger.info(`[NV-Gateway] CoT: ${cotSession.reasoning.steps.length} steps, strategy=${effectiveCotStrategy}`);
        }
      } catch (cotErr: any) {
        logger.warn(`[NV-Gateway] CoT capture (non-fatal): ${cotErr.message}`);
      }
    }

    // GAP-028: Confidence scorer evaluation — skip on explicit `-fast` SLA paths
    // (observe-only quality signal; not worth blocking the hot path).
    if (!slaFastExplicit) {
      try {
        const romaLevelMap: Record<string, 'L1' | 'L2' | 'L3' | 'L4'> = {
          solo: 'L1', plus: 'L2', pro: 'L3', elite: 'L4', government: 'L4', standard: 'L2', default: 'L2',
        };
        const complexityMap: Record<string, 'simple' | 'moderate' | 'complex' | 'very_complex'> = {
          solo: 'simple', plus: 'moderate', pro: 'complex', elite: 'complex', government: 'very_complex', standard: 'moderate', default: 'moderate',
        };

        /* ── GAP-010: ROMA L4 agent autonomy for research tasks ─────────────────
           Pro-tier research, analysis, and advisory tasks are promoted to ROMA L4
           to unlock full autonomous multi-step reasoning with cross-citation
           verification and self-RAG validation loops.
        ─────────────────────────────────────────────────────────────────────── */
        const researchAgentKeys = [
          'legal-research-agent', 'case-analysis-agent', 'advisory-agent',
          'contract-review-agent', 'risk-assessment-agent', 'regulatory-analyst',
        ];
        const researchTaskTypes = ['research', 'analysis', 'advisory', 'contract-review', 'risk-assessment'];
        const isResearchTask = researchAgentKeys.some(k => agentKey.includes(k.replace('-agent', '')))
          || researchTaskTypes.includes(taskType || '');
        let effectiveRomaLevel = romaLevelMap[tier || 'default'] || 'L2';
        if (isResearchTask && (tier === 'pro' || tier === 'elite' || tier === 'government')) {
          effectiveRomaLevel = 'L4';
          logger.info(`[GAP-010] ROMA L4 promoted: agentKey=${agentKey}, tier=${tier}, taskType=${taskType}`);
        }

        const confResult = confidenceScorer.evaluate({
          // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
          agentScores: [hallucinationResult ? (1 - hallucinationResult.score) * 100 : 80],
          taskComplexity: complexityMap[tier || 'default'] || 'moderate',
          romaLevel: effectiveRomaLevel as 'L1' | 'L2' | 'L3' | 'L4',
          modelQuality: 0.85,
          domainRelevance: ragContextResult ? 0.9 : 0.7,
        });
        confidenceResult = {
          score: confResult.confidence,
          action: confResult.action,
          explanation: confResult.explanation,
        };
        logger.info(`[NV-Gateway] Confidence: score=${confResult.confidence.toFixed(2)}, action=${confResult.action}`);
      } catch (confErr: any) {
        logger.warn(`[NV-Gateway] Confidence scorer (non-fatal): ${confErr.message}`);
      }
    }

    if (aguiSessionId) {
      try {
        aguiJurexioIntegrationService.emitProgress(aguiSessionId, 70, 'Post-processing response', 8, 6);
      } catch { }
    }

    const postLlmPromises: Promise<void>[] = [];

    if (enableHallucinationCheck) {
      postLlmPromises.push(
        hallucinationDetector.checkOutput({
          requestId,
          inputText: sanitizedPrompt,
          outputText: processedContent,
          agentKey: resolvedAgentKey,
          userId,
          tenantId,
        }).then(result => {
          hallucinationResult = {
            score: result.score,
            flaggedClaims: result.flaggedClaims,
            status: result.status,
          };
          logger.info(`[NV-Gateway] Hallucination check: score=${result.score.toFixed(2)}, status=${result.status}, flagged=${result.flaggedClaims.length}`);
        }).catch(err => {
          logger.warn(`[NV-Gateway] Hallucination check failed (non-fatal): ${err.message}`);
        })
      );
    }

    if (enableCitationVerification) {
      postLlmPromises.push(
        citationVerifier.verifyCitations({
          requestId,
          outputText: processedContent,
          jurisdiction,
          tenantId,
        }).then(result => {
          citationResult = result;
          logger.info(`[NV-Gateway] Citation verification: verified=${result.verified}, unverified=${result.unverified}`);
        }).catch(err => {
          logger.warn(`[NV-Gateway] Citation verification failed (non-fatal): ${err.message}`);
        })
      );
    }

    if (enableExplainability) {
      postLlmPromises.push(
        explainabilityService.generateExplanation({
          requestId,
          agentKey: resolvedAgentKey,
          userPrompt: sanitizedPrompt,
          aiOutput: processedContent,
          tier,
          userId,
          tenantId,
        }).then(result => {
          explainabilityResult = result;
          logger.info(`[NV-Gateway] Explainability: ${result.reasoningSteps.length} steps, confidence=${result.confidence.toFixed(2)}`);
        }).catch(err => {
          logger.warn(`[NV-Gateway] Explainability failed (non-fatal): ${err.message}`);
        })
      );
    }

    // GAP-006: Capture bias score in return and audit trail
    postLlmPromises.push(
      biasDetector.auditOutput({
        agentKey: resolvedAgentKey,
        outputText: processedContent,
        tenantId,
        jurisdiction,
      }).then(result => {
        biasAuditResult = {
          score: result.biasScore,
          findings: result.findings || [],
          recommendations: result.recommendations || [],
        };
        if (result.biasScore > 0.3) {
          logger.warn(`[NV-Gateway] Bias detected: score=${result.biasScore.toFixed(2)}, findings=${result.findings.join('; ')}`);
        } else {
          logger.info(`[NV-Gateway] Bias audit: score=${result.biasScore.toFixed(2)} (ok)`);
        }
      }).catch(err => {
        logger.warn(`[NV-Gateway] Bias audit failed (non-fatal): ${err.message}`);
      })
    );

    postLlmPromises.push(
      agentMetricsService.recordMetrics({
        agentKey: resolvedAgentKey,
        tenantId,
        latencyMs: Date.now() - start,
        tokens: llmResponse.tokens.total,
        success: true,
      }).catch(err => {
        logger.warn(`[NV-Gateway] Agent metrics recording failed (non-fatal): ${err.message}`);
      })
    );

    if (enableHITL) {
      const effectiveRisk = riskCategory || classifyRiskLevel(resolvedAgentKey, taskType);
      postLlmPromises.push(
        hitlService.checkAndQueue({
          requestId,
          agentKey: resolvedAgentKey,
          aiOutput: processedContent,
          riskLevel: effectiveRisk,
          userId,
          tenantId,
        }).then(result => {
          hitlResult = result;
          if (result.required) {
            logger.info(`[NV-Gateway] HITL review queued: reviewId=${result.reviewId}, risk=${effectiveRisk}`);
          }
        }).catch(err => {
          logger.warn(`[NV-Gateway] HITL check failed (non-fatal): ${err.message}`);
        })
      );
    }

    if (enableMemory && sessionId) {
      const { decideOrchestrateMemoryWrite } = await import('./jrx-trust-tier.js');
      const memWrite = decideOrchestrateMemoryWrite({
        req: {
          body: { taskType, sessionId, matterId, tenantId },
          headers: {},
        } as import('express').Request,
        taskType,
        content: processedContent,
      });
      const memoryMeta = {
        agentKey: resolvedAgentKey,
        matterId,
        taskType,
        trustTier: memWrite.tier,
      };
      if (memWrite.allowed) {
      postLlmPromises.push(
        graphMemoryService.addMemory(
          `Q: ${sanitizedPrompt.substring(0, 500)}\nA: ${processedContent.substring(0, 1000)}`,
          'fact',
          memoryMeta,
          {
            userId,
            tenantId,
            sessionId,
            source: memWrite.tier === 'T4_accepted_counsel' ? 'counsel_accepted' : 'session_scratch',
            importance: memWrite.tier === 'T4_accepted_counsel' ? 0.85 : 0.5,
          },
        ).then(() => {
          logger.info(`[NV-Gateway] Memory stored for session ${sessionId}`);
        }).catch(err => {
          logger.warn(`[NV-Gateway] Memory store failed (non-fatal): ${err.message}`);
        })
      );
      } else {
        logger.info('[NV-Gateway] Skipping graph memory write (trust tier)', {
          reason: memWrite.reason,
          tier: memWrite.tier,
        });
      }

      // NV-MEM-DURABLE-WIRE-001 — L2 matter memory was reachable only from the
      // manual /nyaya-tools routes, so nothing on the live request path ever
      // populated it and recall had nothing durable to draw on across pods.
      if (matterId && userId) {
        const numericUserId = parseInt(String(userId), 10);
        if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
          logger.warn('[NV-Gateway] Skipping durable matter memory — non-numeric userId');
        } else if (memWrite.allowed) {
        postLlmPromises.push(
          (async () => {
            const { nv5TierMemoryService } = await import('./memory/jrx-5tier-memory-service.js');
            await nv5TierMemoryService.saveMatterMemory(matterId, String(numericUserId), {
              memoryType: 'interaction',
              content: `Q: ${sanitizedPrompt.substring(0, 500)}\nA: ${processedContent.substring(0, 1000)}`,
              importance: memWrite.tier === 'T4_accepted_counsel' ? 0.85 : 0.5,
              metadata: {
                agentKey: resolvedAgentKey,
                taskType,
                sessionId,
                tenantId,
                trustTier: memWrite.tier,
              },
            }, { userId: numericUserId, orgId: tenantId });
            await nv5TierMemoryService.saveEpisodic(sessionId, {
              type: taskType || 'orchestrate',
              content: `Q: ${sanitizedPrompt.substring(0, 500)}\nA: ${processedContent.substring(0, 500)}`,
              agentId: resolvedAgentKey,
              timestamp: new Date(),
              metadata: { matterId, tenantId, trustTier: memWrite.tier },
            });
          })().catch(err => {
            logger.warn(`[NV-Gateway] Durable memory write failed (non-fatal): ${err.message}`);
          })
        );
        }
      }

      // Feed the compiler's own namespace so `recallCompiledKnowledge` above has
      // articles to serve. Consolidation is cooldown-gated inside `noteTurn`.
      const compiledWriteNamespace = matterId
        ? `matter_${matterId}`
        : (tenantId ? `tenant_${tenantId}` : '');
      if (compiledWriteNamespace && memWrite.allowed) {
        postLlmPromises.push(
          (async () => {
            const { mem0PersistenceService } = await import('./mem0-persistence-service.js');
            await mem0PersistenceService.noteTurn(
              resolvedAgentKey,
              `Q: ${sanitizedPrompt.substring(0, 500)}\nA: ${processedContent.substring(0, 1500)}`,
              {
                namespace: compiledWriteNamespace,
                importance: memWrite.tier === 'T4_accepted_counsel' ? 0.85 : 0.5,
                tags: [taskType || 'orchestrate', jurisdiction || 'IN', memWrite.tier],
                metadata: {
                  sessionId,
                  matterId,
                  tenantId,
                  agentKey: resolvedAgentKey,
                  trustTier: memWrite.tier,
                },
              },
            );
          })().catch(err => {
            logger.warn(`[NV-Gateway] Compiler memory note failed (non-fatal): ${err.message}`);
          })
        );
      }
    }

    await Promise.all(postLlmPromises);

    const citationSnapshot = citationResult as NvResponse['citations'];
    const hallucinationSnapshot = hallucinationResult as NvResponse['hallucinationCheck'];
    const gate8Result = await jrxGuardrailsService.evaluate({
      requestId,
      agentId: resolvedAgentKey,
      jurisdiction,
      promptText: sanitizedPrompt,
      responseText: processedContent,
      matterId,
      citations: citationSnapshot
        ? { verified: citationSnapshot.verified, unverified: citationSnapshot.unverified }
        : undefined,
      hallucinationCheck: hallucinationSnapshot
        ? { flaggedClaims: hallucinationSnapshot.flaggedClaims, status: hallucinationSnapshot.status }
        : undefined,
      metadata: {
        awsRegion: process.env.AWS_REGION,
        conflictCheckLogged: resolvedAgentKey === 'A-029',
      },
    });

    if (gate8Result.enforcement === 'HITL' || gate8Result.enforcement === 'MANDATORY_HITL') {
      const priorHitl = hitlResult as NvResponse['hitlStatus'];
      hitlResult = {
        required: true,
        reviewId: priorHitl?.reviewId || `gate8-${requestId}`,
        status: gate8Result.enforcement.toLowerCase(),
      };
    }

    // GAP-008: A2A Bus — fire-and-forget handoff notification for multi-agent workflows
    if (enableOrchestration && sessionId) {
      const a2aHandoffAgents: Record<string, string> = {
        'legal-research': 'legal-drafting-agent',
        'case-analysis': 'advisory-agent',
        'contract-review': 'contract-drafting-agent',
        'due-diligence': 'risk-reporting-agent',
        'litigation': 'court-filing-agent',
      };
      const nextAgent = a2aHandoffAgents[taskType || ''] || a2aHandoffAgents[resolvedAgentKey] || null;
      if (nextAgent) {
        const _fromAgent = resolvedAgentKey;
        const _toAgent = nextAgent;
        const _sessionId = sessionId;
        const _contentSnip = processedContent.slice(0, 500);
        const _msgPriority: 'high' | 'normal' = tier === 'government' || tier === 'elite' ? 'high' : 'normal';
        const _encLevel: 'enhanced' | 'basic' = tier === 'government' ? 'enhanced' : 'basic';
        const _accLevel: 'confidential' | 'internal' = tier === 'government' ? 'confidential' : 'internal';
        getA2ABus()
          .then((bus: any) => bus.sendMessage({
            id: crypto.randomUUID(),
            fromAgent: _fromAgent,
            toAgent: _toAgent,
            type: 'handoff',
            payload: {
              action: 'agent_handoff',
              data: { taskId: _sessionId, contentSummary: _contentSnip, userId, tenantId, tier, jurisdiction, taskType },
            },
            metadata: {
              priority: _msgPriority,
              category: 'legal_workflow_handoff',
              tags: [taskType || 'general', tier, _fromAgent].filter(Boolean),
              correlationId: _sessionId,
              conversationId: _sessionId,
            },
            routing: {
              path: [_fromAgent],
              hops: 0,
              maxHops: 3,
              broadcast: false,
              multicast: false,
              failover: true,
              retryPolicy: { maxRetries: 2, baseDelay: 1000, maxDelay: 5000, backoffStrategy: 'exponential' },
            },
            security: {
              authenticated: true,
              authorized: true,
              encryptionLevel: _encLevel,
              accessLevel: _accLevel,
            },
            timestamp: new Date(),
          }))
          .then((result: any) => {
            logger.info(`[NV-Gateway] GAP-008 A2A handoff: ${_fromAgent} → ${_toAgent} (session: ${_sessionId}) — status: ${result?.status}`);
          })
          .catch((err: any) => {
            logger.warn(`[NV-Gateway] A2A handoff failed (non-fatal): ${err.message}`);
          });
      }
    }

    const latencyMs = Date.now() - start;
    const outputCheck = softPolicy ? { passed: true, violations: [] as string[] } : complianceCheck(processedContent);
    // Soft policy: never replace LLM content with Gate-8 / compliance stubs.
    const gate8Blocked = softPolicy ? false : gate8Result.enforcement === 'BLOCK';

    const orchestrationTag = enableOrchestration ? ' [Orchestrated]' : '';
    const agentTag = agentResolved ? ` [Agent: ${agent!.name}]` : '';
    const tierTag = tier !== 'default' ? ` [Tier: ${tier}]` : '';
    const safetyTags = [
      enableHallucinationCheck ? 'HalluCheck' : '',
      enableCitationVerification ? 'CitVerify' : '',
      enableHITL ? 'HITL' : '',
      enableExplainability ? 'CoT' : '',
      enableMemory ? 'Memory' : '',
    ].filter(Boolean).join('+');
    const safetyTag = safetyTags ? ` [Safety: ${safetyTags}]` : '';
    logger.info(`[NV-Gateway]${orchestrationTag}${agentTag}${tierTag}${safetyTag} Agent: ${agentKey} | Source: ${source} | Provider: ${llmResponse.provider} | Model: ${llmResponse.model} | Tokens: ${llmResponse.tokens.total} | Latency: ${latencyMs}ms`);

    // Fire-and-forget lineage tracking — never blocks main response
    import('./jrx-phase5-services.js').then(({ nvDataLineage }) => {
      import('crypto').then(({ createHash }) => {
        nvDataLineage.recordLineage({
          requestId: requestId || sessionId || 'unknown',
          userId: userId || 'anonymous',
          orgId: tenantId || 'default',
          inputHash: createHash('sha256').update((userPrompt || '').substring(0, 200)).digest('hex').substring(0, 16),
          agentKey: resolvedAgentKey || agentKey || 'default',
          modelUsed: llmResponse?.model || 'unknown',
          provider: llmResponse?.provider || 'unknown',
          ragSources: ragContextResult ? ['vector_search'] : [],
          piiDetected: [],
          outputHash: createHash('sha256').update((processedContent || '').substring(0, 200)).digest('hex').substring(0, 16),
          latencyMs,
          complianceFlags: outputCheck.passed ? [] : ['compliance_filtered'],
        }).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});

    // GAP-009: Emit AG-UI completion event
    if (aguiSessionId) {
      try {
        aguiJurexioIntegrationService.emitProgress(aguiSessionId, 100, 'Complete', 8, 8);
        aguiJurexioIntegrationService.emitAgentComplete(aguiSessionId, resolvedAgentKey, 'Pipeline execution completed successfully');
      } catch { }
    }

    // NV-LEGAL-FORMAT-001 + statute QA grounding + LM cache write-back
    let citationVerified = true;
    if (!gate8Blocked && outputCheck.passed && processedContent) {
      const fastPostOpts = {
        taskType,
        query: sanitizedPrompt,
        jurisdiction,
        parameters: options.parameters,
        ragAttempted: ragAttempted,
        ragGrounded,
        statutePrefetchApplied: !!statutePrefetchBlock,
        ragContextBlock: userContextParts.join('\n'),
      };
      try {
        const { applyLegalResponseFormatting } = await import('./jrx-legal-response-format.js');
        processedContent = applyLegalResponseFormatting(processedContent, {
          jurisdiction,
          taskType,
          query: sanitizedPrompt,
          comprehensive: options.forceLegalBestOutcome === true && !isPartnerExplicitFastChatAlias(taskType),
        });
      } catch { /* non-fatal */ }
      try {
        const {
          applyFastDeliveryPolishWithMeta,
          applyPartnerFastPostProcess,
          shouldRunFastDeliveryPolish,
        } = await import('./jrx-fast-delivery-polish.js');
        if (shouldRunFastDeliveryPolish({ taskType })) {
          const polished = await applyFastDeliveryPolishWithMeta(processedContent, fastPostOpts);
          processedContent = polished.content;
          citationVerified = polished.citationVerified;
        } else if (isPartnerExplicitFastAlias(taskType)) {
          const post = await applyPartnerFastPostProcess(processedContent, fastPostOpts);
          processedContent = post.content;
          citationVerified = post.citationVerified;
        }
      } catch { /* non-fatal */ }
      try {
        const { applyPartnerHumanPolish } = await import('../utils/jrx-partner-human-polish.js');
        processedContent = applyPartnerHumanPolish(processedContent, {
          taskType,
          agentKey: resolvedAgentKey,
          includeDisclaimer: resolvedAgentKey !== 'mitra-conversational',
        });
      } catch { /* non-fatal */ }
      if (!shouldSkipExpensiveDraftFastSteps(taskType)) {
        try {
          const { applyStatuteQaGroundingGate } = await import('./jrx-statute-qa-grounding.js');
          const gated = await applyStatuteQaGroundingGate({
            query: sanitizedPrompt,
            answer: processedContent,
            jurisdiction,
            authority: statuteAuthority,
          });
          processedContent = gated.content;
          statuteQaMeta = { applied: gated.applied, corrected: gated.corrected, reason: gated.reason };
        } catch { /* non-fatal */ }
      }
      try {
        const { lmCacheService } = await import('./lm-cache-service.js');
        await lmCacheService.set(sanitizedPrompt, processedContent, {
          namespace: cacheNamespace,
          model: llmResponse.model,
        });
      } catch { /* non-fatal */ }
    }

    return {
      content: outputCheck.passed
        ? (gate8Blocked
            ? '[Response blocked by Jurexio Gate 8 bar-council guardrails]'
            : processedContent)
        : ((resolvedAgentKey === 'clause-classifier' || resolvedAgentKey === 'case-brief-generator')
            ? JSON.stringify({ error: 'compliance_filtered', agentKey: resolvedAgentKey, message: 'Response filtered by Jurexio compliance engine' })
            : '[Response filtered by Jurexio compliance engine]'),
      tokens: { prompt: llmResponse.tokens.input, completion: llmResponse.tokens.output, total: llmResponse.tokens.total },
      model: llmResponse.model,
      latencyMs,
      piiRedacted: true,
      compliancePassed: outputCheck.passed && !gate8Blocked,
      source,
      requestId,
      orchestration: {
        promptEnhanced: !!enhancementMetrics,
        responseEngineered: !!qualityMetrics,
        agentResolved,
        tierRouting: tier,
        enhancementMetrics,
        qualityMetrics,
        ragGrounded,
        ragConfidence,
        ragAttempted,
        statuteQaGrounding: statuteQaMeta,
        citationVerified,
      } as any,
      hallucinationCheck: hallucinationResult,
      hitlStatus: hitlResult,
      explainability: explainabilityResult,
      citations: citationResult,
      ragContext: ragContextResult,
      memoryContext: memoryContextResult,
      confidence: confidenceResult,
      biasAudit: biasAuditResult,
      chainOfThought: cotResult,
      selfRagValidated,
      adaptiveRagUsed,
      graphTraversalUsed,
      regulatoryGate8: {
        jurisdiction: gate8Result.jurisdiction,
        enforcement: gate8Result.enforcement,
        matchedRules: gate8Result.matchedRules.map(rule => rule.ruleId),
        warnings: gate8Result.warnings,
      },
    };
  } catch (error: any) {
    logger.error(`[NV-Gateway] Agent ${agentKey} failed:`, error.message);
    return {
      content: `AI service temporarily unavailable. Error: ${error.message?.substring(0, 100)}`,
      tokens: { prompt: 0, completion: 0, total: 0 },
      model: 'error',
      latencyMs: Date.now() - start,
      piiRedacted: true,
      compliancePassed: true,
      source,
      orchestration: {
        promptEnhanced: false,
        responseEngineered: false,
        agentResolved: false,
        tierRouting: tier,
      },
      // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
      providerError: {
        code: 'AI_SERVICE_UNAVAILABLE',
        message: error.message?.substring(0, 200) || 'unknown',
      },
    };
  }
}

export async function callJurexioSimple(systemPrompt: string, userPrompt: string, maxTokens: number = 2048): Promise<string> {
  const result = await callJurexio('generic', systemPrompt, userPrompt, { maxTokens });
  return result.content;
}

export function getAgentRegistry(): { total: number; tiers: Record<string, number>; practiceAreas: string[] } {
  const agents = getRegistryAgents().map(toAgentRegistryEntry);
  const tiers: Record<string, number> = {};
  const practiceAreas = new Set<string>();
  for (const agent of agents) {
    tiers[agent.tier] = (tiers[agent.tier] || 0) + 1;
    if (agent.practiceArea) practiceAreas.add(agent.practiceArea);
  }
  return { total: agents.length, tiers, practiceAreas: Array.from(practiceAreas) };
}

export function lookupAgent(agentKey: string): AgentRegistryEntry | null {
  return resolveAgent(agentKey);
}

export function findAgentByCapability(capability: string, jurisdiction?: string): AgentRegistryEntry | null {
  return resolveAgentByCapability(capability, jurisdiction);
}
