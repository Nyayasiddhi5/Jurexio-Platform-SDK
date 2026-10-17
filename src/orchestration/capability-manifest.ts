/**
 * NV Capability Manifest — Single Source of Truth
 * JRX-ORCH-CAPMAN-001 (Task #32)
 *
 * One declarative manifest consumed by:
 *   - Queen Orchestrator (decomposition + dispatch)
 *   - NvToolExecutionService (tool registry)
 *   - SkillsSystemService (per-skill tool gating)
 *   - SDK Auto-Initialization (per-tier exposure)
 *   - Orchestration Middleware (memory/RAG/safety/HITL/metering/audit)
 *
 * REGISTRY AUTHORITY (dual-registry honesty):
 *  - **Runtime + SDK authority:** this TypeScript manifest is the single
 *    source of truth for Queen decomposition, middleware, skills gating, and
 *    partner SDK tier surfaces. The generated
 *    `capability-manifest.snapshot.json` is a read-only export of this file
 *    (see `npm run manifest:snapshot`); it must never be edited by hand.
 *  - **DB seed (derived, not authoritative):** `nv_schema.protocol_registry`
 *    rows (`CAP_<id>`) are populated FROM this manifest via
 *    `scripts/jrx-reseed-protocol-registry.ts` / boot-time init. Stale DB rows
 *    do not define runtime behaviour — reseed after manifest changes.
 *
 * RULES (do not violate):
 *  - Never write capability.jurisdiction to anything that should respect
 *    explicit→user→tenant→DEFAULT precedence. Capabilities ONLY declare
 *    `supportedJurisdictions` (or 'all') for filtering — never to override
 *    request jurisdiction.
 *  - Capability `factory` MUST return the real bound implementation. No
 *    silent placeholders. If a dependency is missing in production, throw.
 *  - Adding a capability is the only blessed way to expose new functionality
 *    to the agentic decomposition + parallel execution path.
 */

import { createLogger } from '../utils/logger.js';
import type { TemplatesCatalogQuery } from '../services/jrx-templates-catalog-service.js';

const logger = createLogger('capability-manifest');

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type CapabilityTier = 'lite' | 'mitra' | 'enterprise' | 'sovereign' | 'white-label';

export type CapabilityCategory =
  | 'memory'
  | 'intelligence'
  | 'rag'
  | 'tools'
  | 'skills'
  | 'safety'
  | 'hitl'
  | 'metering'
  | 'audit'
  | 'agent-orchestration'
  | 'task-allocation'
  | 'document-pipeline'
  | 'vector'
  | 'database'
  | 'cache'
  | 'llm-gateway'
  | 'circuit-breaker'
  | 'streaming'
  | 'protocol'
  | 'compliance'
  | 'multimodal'
  | 'workflow'
  | 'omnichannel'
  | 'simulation'
  | 'monitoring'
  | 'white-label'
  | 'security';

export type CostClass = 'free' | 'low' | 'medium' | 'high' | 'metered';
export type SafetyClass = 'safe' | 'review' | 'high-risk' | 'sovereign';
export type ExecutionPattern =
  | 'sequential'
  | 'parallel'
  | 'dag'
  | 'swarm'
  | 'hierarchical'
  | 'simple'
  | 'cot-with-tools'
  | 'collective-debate';

/**
 * Side-effect classification — surfaces in the manifest so middleware,
 * audit, and tool-registry can reason about durability without inspecting
 * the implementation. `pure` = no externally visible mutation; `read` =
 * external read-only fetch (no writes); `write` = mutates persistent
 * state (DB / vector store / file); `network` = makes outbound network
 * calls (LLM, third-party API); `mixed` = combination.
 */
export type SideEffect = 'pure' | 'read' | 'write' | 'network' | 'mixed';

/**
 * Route exposure descriptor — declares how (or whether) a capability is
 * already surfaced via existing transport (HTTP/RPC/CLI), so the manifest
 * doubles as the inventory map the orchestrator and gateway agree on.
 */
export interface RouteExposure {
  /** Transport: 'http' | 'queue' | 'cli' | 'internal' (Queen-only). */
  transport: 'http' | 'queue' | 'cli' | 'internal';
  /** HTTP method when transport='http'. */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Path when transport='http' (e.g. '/api/orchestration/invoke'). */
  path?: string;
  /** Symbolic queue/cli identifier when not HTTP. */
  channel?: string;
}

export interface CapabilityInput {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  required?: boolean;
  description?: string;
}

export interface CapabilityDescriptor {
  /** Stable canonical id, kebab-case e.g. 'memory.tiered.recall' */
  id: string;

  /** Human-readable display name */
  displayName: string;

  /** What domain this lives in */
  category: CapabilityCategory;

  /** Tiers permitted to invoke this capability */
  tiers: CapabilityTier[];

  /** Jurisdictions where this is enabled, or 'all' */
  supportedJurisdictions: string[] | 'all';

  /** Cost classification — drives metering + budget gates */
  costClass: CostClass;

  /** Safety classification — drives safety/HITL middleware */
  safetyClass: SafetyClass;

  /** Execution patterns Queen Orchestrator may compose this into */
  supportedPatterns: ExecutionPattern[];

  /** Declared inputs (used for validation + tool-registry binding) */
  inputs?: CapabilityInput[];

  /** Declared output shape description */
  output?: string;

  /** Free-form tags for routing/decomposition keyword matching */
  tags: string[];

  /** Source module where the implementation lives — for documentation */
  source: string;

  /**
   * Side-effect classification (round 10c). First-class manifest field so
   * middleware (audit, metering, idempotency) and the planner can reason
   * about durability without reflecting into the implementation. Optional
   * for backward compatibility; descriptors that omit it are treated as
   * `mixed` by consumers.
   */
  sideEffects?: SideEffect;

  /**
   * Existing transport exposure (round 10c). Records how this capability
   * is already invokable from outside the orchestrator (HTTP route, queue,
   * CLI, or `internal` for Queen-only). The manifest is the inventory
   * map; gateway code can derive its routing table from this field.
   */
  routeExposure?: RouteExposure;

  /**
   * Factory returns the bound implementation. Lazy so circular deps are safe.
   * The returned object MUST expose an `invoke(input, ctx)` method that
   * resolves to a JSON-serialisable result (or throws on real failure).
   */
  factory: () => Promise<CapabilityInstance> | CapabilityInstance;
}

export interface CapabilityContext {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  jurisdiction?: string;
  tier?: CapabilityTier;
  agentKey?: string;
  /** Free-form passthrough for middleware/tools */
  metadata?: Record<string, unknown>;
  /** NV-COMPLETION-DRIVEN-001 — abort hangers when the useful result is in. */
  signal?: AbortSignal;
}

/**
 * Typed loader contracts (round 7+ — replaces the old `(mod: LoadedModule)` /
 * `(svc)` / `Promise<any>` slop in factories with structural types
 * the TS compiler can actually check).
 *
 *  - `CapabilityInvocationInput`  — shape of the JSON-ish payload Queen
 *                                   sends to a capability factory.
 *  - `CapabilityInvocationOutput` — what a capability returns; concrete
 *                                   shape is described in
 *                                   `CapabilityDescriptor.output`.
 *  - `LoadedModule`               — namespace returned by a dynamic
 *                                   `import('...')`. Keys are unknown
 *                                   because the module shape is data,
 *                                   not code.
 *  - `LoadedService`              — service-shaped record where each
 *                                   property is a callable async method.
 *                                   Used to type the picked-out service
 *                                   from a loaded module.
 *  - `AsyncCapabilityMethod`      — single async method on a service.
 */
export type CapabilityInvocationInput = Record<string, unknown>;
export type CapabilityInvocationOutput = unknown;
export type AsyncCapabilityMethod = (...args: unknown[]) => unknown;
export type LoadedModule = Record<string, unknown>;
/*
 * NV-TSC-LOADED-SERVICE-001 (2026-08-19) — this was `Record<string, AsyncCapabilityMethod |
 * unknown>`, which accounted for 17 of the repo's 39 baseline type errors on its own.
 *
 * The union is a no-op: `AsyncCapabilityMethod | unknown` collapses to `unknown`, so the type
 * was really `Record<string, unknown>`. A CLASS INSTANCE does not satisfy that, because an
 * index signature is only inferred for object literals and type aliases — never for a class.
 * So every real service (`SdkApplicationService`, `SdkDocumentPipelineService`, …) was
 * rejected at each `pickServiceMethod(svc, …)` call, 17 times over.
 *
 * `object` is the accurate constraint: these values are service instances whose methods are
 * looked up reflectively by `pickServiceMethod`, which already validates that the named
 * property is callable at runtime. Widening to `object` keeps that contract, admits class
 * instances, and still rejects primitives — whereas `any` would have silenced the symptom
 * and lost the check.
 */
export type LoadedService = object;

export interface CapabilityInstance {
  invoke: (input: CapabilityInvocationInput, ctx: CapabilityContext) => Promise<CapabilityInvocationOutput>;
  /** Optional health check — used by smoke tests */
  health?: () => Promise<{ ok: boolean; detail?: string }>;
}

export interface CapabilityResolveOptions {
  tier?: CapabilityTier;
  jurisdiction?: string;
  category?: CapabilityCategory;
  pattern?: ExecutionPattern;
  tags?: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Lazy factory helpers — wrap a Promise<module> into a CapabilityInstance
// ──────────────────────────────────────────────────────────────────────────────

function fromMethod<T>(
  loader: () => Promise<T>,
  resolve: (m: T) => (input: CapabilityInvocationInput, ctx: CapabilityContext) => Promise<CapabilityInvocationOutput>,
): () => Promise<CapabilityInstance> {
  return async () => {
    const mod = await loader();
    const fn = resolve(mod);
    return { invoke: (input, ctx) => fn(input, ctx) };
  };
}

/**
 * Pick the first existing service-export from a dynamically-imported
 * module by trying a list of well-known export names (e.g. the
 * conventional singleton, then `default`, then the module itself).
 * Replaces `(mod as any).foo ?? (mod as any).default ?? mod` patterns.
 */
function pickModuleService(mod: LoadedModule, names: readonly string[]): LoadedService {
  for (const n of names) {
    const v = mod[n];
    if (v && typeof v === 'object') return v as LoadedService;
  }
  return mod as LoadedService;
}

/**
 * Pick the first existing async method on a service by name (used for
 * dynamic `op` dispatch). Throws an actionable error if none of the
 * candidate names resolve to a callable. Replaces
 * `(svc as any)[op] ?? svc.process ?? svc.execute` patterns.
 */
function pickServiceMethod(svc: LoadedService, names: readonly string[]): AsyncCapabilityMethod {
  for (const n of names) {
    const fn = svc[n];
    if (typeof fn === 'function') return fn as AsyncCapabilityMethod;
  }
  throw new Error(`[manifest] service missing methods: tried [${names.join(', ')}]`);
}

/** Cast a concrete service singleton to the structural LoadedService record. */
function asLoadedService(svc: unknown): LoadedService {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return svc as LoadedService;
}

/** The only documented `as unknown as` seam in the orchestration layer.
 *  Lets each factory declare its own structural input shape without
 *  proliferating per-call narrowing or Zod parses. */
function coerceInput<T>(input: CapabilityInvocationInput): T {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return input as unknown as T;
}

// ──────────────────────────────────────────────────────────────────────────────
// CAPABILITY DEFINITIONS
//
// These are the only things Queen Orchestrator, the tool registry, the skills
// system, and the SDK auto-init must consult to know what is available.
// ──────────────────────────────────────────────────────────────────────────────

const CAPABILITIES: CapabilityDescriptor[] = [
  // ── Memory ────────────────────────────────────────────────────────────────
  {
    id: 'memory.tiered.recall',
    displayName: 'Tiered Memory Recall',
    category: 'memory',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple'],
    inputs: [
      { name: 'query', type: 'string', required: true },
      { name: 'limit', type: 'number' },
    ],
    output: 'Array<{ id, content, score, tier }>',
    tags: ['memory', 'recall', 'episodic', 'semantic'],
    source: 'src/services/jrx-orchestration-services.ts:NvMemoryService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvMemoryService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ sessionId?: string; matterId?: string; scope?: string; limit?: number; query?: string }>(input);
        return svc.retrieve({
          userId: ctx.userId ?? 'system',
          sessionId: i.sessionId,
          matterId: i.matterId,
          scope: i.scope,
          limit: i.limit ?? 10,
          // NV-MEM-SEMANTIC-001: forward the query so tiered recall ranks by
          // relevance (the orchestration middleware passes the live query here).
          query: i.query,
        });
      },
    ),
  },
  {
    id: 'memory.tiered.store',
    displayName: 'Tiered Memory Store',
    category: 'memory',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple', 'cot-with-tools', 'collective-debate'],
    inputs: [
      { name: 'content', type: 'string', required: true },
      { name: 'tier', type: 'string' },
    ],
    output: '{ id, stored: true }',
    tags: ['memory', 'store', 'persist'],
    sideEffects: 'write',
    routeExposure: { transport: 'internal', channel: 'orchestration.memory.store' },
    source: 'src/services/jrx-orchestration-services.ts:NvMemoryService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvMemoryService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          key?: string; content?: string | object; value?: string | object;
          memoryType?: string; tier?: string; scope?: string; matterId?: string;
          sessionId?: string; importance?: number; ttlMinutes?: number;
        }>(input);
        return svc.store({
          userId: ctx.userId ?? 'system',
          tenantId: ctx.tenantId,
          key: i.key ?? `${ctx.agentKey ?? 'agent'}:${Date.now()}`,
          value: typeof i.content === 'string' ? i.content : JSON.stringify(i.content ?? i.value ?? ''),
          memoryType: i.memoryType ?? i.tier ?? 'session',
          scope: i.scope ?? 'user',
          matterId: i.matterId,
          sessionId: i.sessionId,
          importance: i.importance,
          ttlMinutes: i.ttlMinutes,
        });
      },
    ),
  },

  // ── RAG ───────────────────────────────────────────────────────────────────
  {
    id: 'rag.search',
    displayName: 'RAG Search',
    category: 'rag',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    inputs: [
      { name: 'query', type: 'string', required: true },
      { name: 'topK', type: 'number' },
    ],
    output: 'Array<{ doc, score, snippet }>',
    tags: ['rag', 'retrieval', 'context', 'nys_global'],
    source: 'src/services/jrx-auto-rag-router.ts:autoRagRetrieve',
    factory: fromMethod(
      () => import('../services/jrx-auto-rag-router.js').then(m => m),
      (mod) => async (input, ctx) => {
        // Queen capInput historically sent `prompt` / `originalPrompt`, not `query`.
        // Accept all aliases so rag.search never crashes on undefined.trim().
        const i = coerceInput<{
          query?: string;
          prompt?: string;
          originalPrompt?: string;
          text?: string;
          topK?: number;
          limit?: number;
          jurisdiction?: string;
        }>(input);
        const query = String(
          i.query || i.prompt || i.originalPrompt || i.text || '',
        ).trim();
        if (!query) {
          return {
            chunks: [],
            contextBlock: '',
            layersUsed: [],
            confidence: 0,
            skipped: true,
            reason: 'empty_query',
          };
        }
        const result = await mod.autoRagRetrieve({
          query,
          jurisdiction: i.jurisdiction || (ctx as any).jurisdiction || 'IN',
          tenantId: ctx.tenantId ? String(ctx.tenantId) : undefined,
          topK: i.topK ?? i.limit ?? 8,
        });
        return {
          chunks: result.chunks,
          contextBlock: result.contextBlock,
          layersUsed: result.layersUsed,
          confidence: result.confidence,
        };
      },
    ),
  },

  // ── Skills ────────────────────────────────────────────────────────────────
  {
    id: 'skills.activate',
    displayName: 'Activate Legal Skills for Context',
    category: 'skills',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple'],
    inputs: [
      { name: 'practiceArea', type: 'string', required: true },
      { name: 'taskType', type: 'string', required: true },
    ],
    output: '{ activatedSkills, composedPromptDelta, requiredTools }',
    tags: ['skills', 'prompt-enhancement'],
    source: 'src/services/skills/skills-system-service.ts',
    factory: fromMethod(
      () => import('../services/skills/skills-system-service.js').then(m => m.skillsSystem),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ tier?: string; practiceArea: string; taskType: string }>(input);
        const allowedSkillTiers = ['solo', 'plus', 'pro', 'enterprise'] as const;
        type SkillCtxTier = typeof allowedSkillTiers[number];
        const rawInputTier = typeof i.tier === 'string' ? i.tier : undefined;
        const skillTier: SkillCtxTier =
          (rawInputTier && (allowedSkillTiers as readonly string[]).includes(rawInputTier))
            ? (rawInputTier as SkillCtxTier)
            : mapCapabilityTierToSkillTier(ctx.tier ?? 'lite');
        return svc.activateSkillsForContext({
          agentId: ctx.agentKey ?? 'default',
          jurisdiction: ctx.jurisdiction ?? 'IN',
          practiceArea: i.practiceArea,
          tier: skillTier,
          taskType: i.taskType,
          userId: ctx.userId,
        });
      },
    ),
  },

  // ── Safety / HITL ─────────────────────────────────────────────────────────
  {
    id: 'safety.hallucination-check',
    displayName: 'Hallucination + Citation Grounding Check',
    category: 'safety',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple'],
    tags: ['safety', 'hallucination', 'grounding'],
    source: 'src/services/jrx-orchestration-services.ts:NvHallucinationDetector',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvHallucinationDetector),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ inputText?: string; outputText: string }>(input);
        return svc.checkOutput({
          requestId: ctx.requestId ?? 'unknown',
          inputText: i.inputText ?? '',
          outputText: i.outputText,
          agentKey: ctx.agentKey ?? 'default',
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        });
      },
    ),
  },
  {
    id: 'safety.bias-check',
    displayName: 'Bias / Fairness Check',
    category: 'safety',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['safety', 'bias', 'fairness'],
    source: 'src/services/jrx-orchestration-services.ts:NvBiasDetector',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvBiasDetector),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ outputText: string }>(input);
        return svc.auditOutput({
          agentKey: ctx.agentKey ?? 'default',
          outputText: i.outputText,
          tenantId: ctx.tenantId,
          jurisdiction: ctx.jurisdiction,
        });
      },
    ),
  },
  {
    id: 'safety.pii-vault',
    displayName: 'PII Vault Tokenize/Detokenize',
    category: 'safety',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple', 'cot-with-tools'],
    tags: ['pii', 'privacy', 'redaction'],
    sideEffects: 'write',
    routeExposure: { transport: 'internal', channel: 'orchestration.safety.pii' },
    source: 'src/services/jrx-orchestration-services.ts:NvPIIVaultService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvPIIVaultService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          op?: string; token?: string; piiType?: string; type?: string;
          value: string; ttlMinutes?: number;
        }>(input);
        if (i.op === 'detokenize') return svc.detokenize(i.token ?? '');
        return svc.tokenize({
          piiType: i.piiType ?? i.type ?? 'generic',
          value: i.value,
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          requestId: ctx.requestId,
          ttlMinutes: i.ttlMinutes,
        });
      },
    ),
  },
  {
    id: 'hitl.queue',
    displayName: 'Queue Output for Human Review',
    category: 'hitl',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple', 'cot-with-tools', 'collective-debate'],
    tags: ['hitl', 'review', 'governance'],
    sideEffects: 'write',
    routeExposure: { transport: 'internal', channel: 'orchestration.hitl.queue' },
    source: 'src/services/jrx-orchestration-services.ts:NvHITLService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvHITLService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ aiOutput: string; riskLevel?: 'low' | 'medium' | 'high' | 'critical' }>(input);
        return svc.checkAndQueue({
          requestId: ctx.requestId ?? 'unknown',
          agentKey: ctx.agentKey ?? 'default',
          aiOutput: i.aiOutput,
          riskLevel: i.riskLevel ?? 'medium',
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        });
      },
    ),
  },

  // ── Metering / Audit ──────────────────────────────────────────────────────
  {
    id: 'metering.usage-log',
    displayName: 'Usage / Cost Log',
    category: 'metering',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple', 'cot-with-tools', 'collective-debate'],
    tags: ['metering', 'billing', 'usage'],
    sideEffects: 'write',
    routeExposure: { transport: 'internal', channel: 'orchestration.metering.usage' },
    source: 'src/services/jrx-orchestration-services.ts:NvUsageService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvUsageService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          source?: string; inputTokens?: number; outputTokens?: number;
          model?: string; provider?: string; latencyMs?: number;
          success?: boolean; costUsd?: number; errorMessage?: string;
        }>(input);
        await svc.logUsage({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          agentKey: ctx.agentKey ?? 'default',
          source: i.source ?? 'orchestration',
          inputTokens: i.inputTokens ?? 0,
          outputTokens: i.outputTokens ?? 0,
          model: i.model ?? 'unknown',
          provider: i.provider ?? 'unknown',
          tier: ctx.tier ?? 'lite',
          latencyMs: i.latencyMs ?? 0,
          success: i.success ?? true,
          costUsd: i.costUsd,
          errorMessage: i.errorMessage,
        });
        return { ok: true };
      },
    ),
  },

  // Audit-log writer for the orchestration safety verdict (Task #34).
  // Persists the aggregated pass/review/reject verdict plus its raw signals
  // into the hash-chained nv_audit_logs table so every Queen-dispatched
  // answer carries a tamper-evident record of WHY it was allowed/blocked.
  // The middleware invokes this from postMiddleware after all safety stages
  // have run; failure is fail-loud in production (see middleware step 10).
  {
    id: 'audit.safety-verdict',
    displayName: 'Orchestration Safety Verdict (audit log)',
    category: 'audit',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple', 'cot-with-tools', 'collective-debate'],
    tags: ['audit', 'safety', 'verdict', 'governance'],
    sideEffects: 'write',
    routeExposure: { transport: 'internal', channel: 'orchestration.audit.safety-verdict' },
    source: 'src/middleware/jrx-sdk-tracking-middleware.ts:appendAuditRecord',
    factory: () => ({
      invoke: async (input, ctx) => {
        const i = coerceInput<{
          verdict: 'pass' | 'review' | 'reject';
          reasons?: string[];
          details?: Record<string, unknown>;
          enforced?: boolean;
          outputHash?: string;
          outputLength?: number;
          agentKey?: string;
          model?: string;
          provider?: string;
          stagesRun?: string[];
        }>(input);
        const { appendAuditRecord } = await import(
          '../middleware/jrx-sdk-tracking-middleware.js'
        );
        const payload = JSON.stringify({
          verdict: i.verdict,
          reasons: i.reasons ?? [],
          details: i.details ?? {},
          enforced: i.enforced ?? false,
          outputHash: i.outputHash ?? null,
          outputLength: i.outputLength ?? 0,
          agentKey: i.agentKey ?? ctx.agentKey ?? null,
          model: i.model ?? null,
          provider: i.provider ?? null,
          stagesRun: i.stagesRun ?? [],
          requestId: ctx.requestId ?? null,
          tenantId: ctx.tenantId ?? null,
          userId: ctx.userId ?? null,
          jurisdiction: ctx.jurisdiction ?? null,
          tier: ctx.tier ?? null,
        });
        const rec = await appendAuditRecord({
          eventType: `orchestration.safety-verdict:${i.verdict}`,
          payload,
        });
        return {
          id: rec.id,
          recordHash: rec.recordHash,
          previousHash: rec.previousHash,
          createdAt: rec.createdAt,
          verdict: i.verdict,
        };
      },
    }),
  },

  // ── Tools ─────────────────────────────────────────────────────────────────
  {
    id: 'tools.execute',
    displayName: 'Sandboxed Tool Execution',
    category: 'tools',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple'],
    inputs: [
      { name: 'toolName', type: 'string', required: true },
      { name: 'toolCategory', type: 'string', required: true },
      { name: 'inputParams', type: 'object' },
    ],
    output: '{ result, executionTimeMs }',
    tags: ['tools', 'sandbox'],
    source: 'src/services/jrx-orchestration-services.ts:NvToolExecutionService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvToolExecutionService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ toolName: string; toolCategory: string; inputParams?: Record<string, unknown> }>(input);
        return svc.executeToolCall({
          requestId: ctx.requestId,
          tenantId: ctx.tenantId,
          toolName: i.toolName,
          toolCategory: i.toolCategory,
          inputParams: i.inputParams ?? {},
        });
      },
    ),
  },

  // ── Document Pipeline / Vector ────────────────────────────────────────────
  {
    id: 'docs.process',
    displayName: 'Document Pipeline Processor',
    category: 'document-pipeline',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['documents', 'parsing', 'chunking'],
    source: 'src/services/document-pipeline/document-processor.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/document-processor.js'),
      (mod: LoadedModule) => async (input) => {
        const i = coerceInput<{ databaseSystem?: unknown; request: unknown }>(input);
        type DocCtor = new (db: unknown) => { processDocument: (req: unknown) => Promise<unknown> };
        const Cls = (mod.NyayavignyaDocumentProcessor ?? mod.DocumentProcessor) as DocCtor;
        const procExisting = mod.documentProcessor as { processDocument: (req: unknown) => Promise<unknown> } | undefined;
        const proc = procExisting ?? new Cls(i.databaseSystem ?? null);
        return proc.processDocument(i.request);
      },
    ),
  },
  {
    id: 'vector.search',
    displayName: 'Vector Database Search',
    category: 'vector',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['vector', 'embedding', 'similarity'],
    source: 'src/services/document-pipeline/vector-database.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/vector-database.js'),
      (mod: LoadedModule) => async (input) => {
        const i = coerceInput<{
          collection?: unknown;
          searcher?: { searchVectors: (id: unknown, req: unknown) => Promise<unknown> };
          collectionId: unknown; request: unknown;
        }>(input);
        type VecCtor = new (cfg: unknown, db: unknown) => { searchVectors: (id: unknown, req: unknown) => Promise<unknown> };
        const ctor = (mod.NyayavignyaVectorDatabase ?? mod.VectorDatabase) as VecCtor;
        const inst = (i.collection && i.searcher) ? i.searcher : new ctor(mod.defaultVectorConfig, null);
        return inst.searchVectors(i.collectionId, i.request);
      },
    ),
  },

  // ── Streaming / Protocol ──────────────────────────────────────────────────
  {
    id: 'streaming.session',
    displayName: 'Streaming Session',
    category: 'streaming',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['streaming', 'sse'],
    source: 'src/services/jrx-orchestration-services.ts:NvStreamingService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvStreamingService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ model?: string }>(input);
        return svc.createSession({
          userId: ctx.userId,
          tenantId: ctx.tenantId,
          agentKey: ctx.agentKey,
          model: i.model,
        });
      },
    ),
  },
  {
    id: 'protocol.registry',
    displayName: 'Protocol Registry (ROMA / MCP / A2A)',
    category: 'protocol',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['protocol', 'roma', 'governance'],
    source: 'src/services/jrx-orchestration-services.ts:NvProtocolRegistryService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvProtocolRegistryService),
      (svc) => async (input) => {
        const i = coerceInput<{
          op?: string; protocolName: string; protocolVersion?: string;
          status?: string; config?: unknown; activatedBy?: string; dependsOn?: string[];
        }>(input);
        if (i.op === 'list') return svc.getRegistry();
        if (i.op === 'activate') return svc.activateProtocol(i.protocolName);
        if (i.op === 'init-roma') { await svc.initializeROMA(); return { ok: true }; }
        return svc.registerProtocol({
          protocolName: i.protocolName,
          protocolVersion: i.protocolVersion,
          status: i.status,
          config: i.config,
          activatedBy: i.activatedBy,
          dependsOn: i.dependsOn,
        });
      },
    ),
  },

  // ── Intelligence ──────────────────────────────────────────────────────────
  {
    id: 'intelligence.precedent-similarity',
    displayName: 'Precedent Similarity (semantic case match)',
    category: 'intelligence',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['precedent', 'similarity', 'semantic', 'case-law'],
    source: 'src/services/intelligence/jrx-precedent-similarity-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-precedent-similarity-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['precedentSimilarityService', 'default']);
        const fn = pickServiceMethod(svc, ['findSimilar', 'searchSimilar', 'search']);
        return fn.call(svc, { ...input, jurisdiction: ctx.jurisdiction, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'intelligence.litigation-risk',
    displayName: 'Litigation Risk Scoring',
    category: 'intelligence',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['litigation', 'risk', 'scoring'],
    source: 'src/services/intelligence/jrx-litigation-risk-v2-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-litigation-risk-v2-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['litigationRiskService', 'default']);
        const fn = pickServiceMethod(svc, ['assess', 'score', 'predict']);
        return fn.call(svc, { ...input, jurisdiction: ctx.jurisdiction, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'intelligence.amendment-impact',
    displayName: 'Amendment Impact Analysis',
    category: 'intelligence',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['amendment', 'impact', 'regulatory'],
    source: 'src/services/intelligence/jrx-amendment-impact-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-amendment-impact-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['nvAmendmentImpactService', 'amendmentImpactService', 'default']);
        const fn = pickServiceMethod(svc, ['analyze', 'assessImpact', 'evaluate', 'analyzeImpact']);
        return fn.call(svc, { ...input, jurisdiction: ctx.jurisdiction, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'intelligence.conflict-check',
    displayName: 'Conflict-of-Interest Detection',
    category: 'intelligence',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['conflict', 'compliance', 'ethics'],
    source: 'src/services/intelligence/jrx-conflict-detector-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-conflict-detector-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['conflictDetectorService', 'default']);
        const fn = pickServiceMethod(svc, ['check', 'detect', 'scan']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId, userId: ctx.userId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'intelligence.regulatory-watch',
    displayName: 'Regulatory Intelligence Watch',
    category: 'intelligence',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['regulatory', 'compliance', 'watch'],
    source: 'src/services/intelligence/jrx-regulatory-intelligence-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-regulatory-intelligence-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['nvRegulatoryIntelligenceService', 'regulatoryIntelligenceService', 'default']);
        const fn = pickServiceMethod(svc, ['fetchUpdates', 'list', 'search', 'getRegulatoryDigest']);
        return fn.call(svc, { ...input, jurisdiction: ctx.jurisdiction }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Compliance / Governance ───────────────────────────────────────────────
  {
    id: 'compliance.consent',
    displayName: 'User Consent Check / Record',
    category: 'compliance',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple', 'cot-with-tools', 'collective-debate'],
    tags: ['consent', 'privacy', 'gdpr', 'dpdp'],
    sideEffects: 'mixed',
    routeExposure: { transport: 'internal', channel: 'orchestration.compliance.consent' },
    source: 'src/services/jrx-orchestration-services.ts:NvConsentService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvConsentService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ op?: string; consentType?: string; granted?: boolean; ipAddress?: string; userAgent?: string }>(input);
        if (i.op === 'record') {
          return svc.recordConsent({
            userId: ctx.userId ?? 'anonymous',
            tenantId: ctx.tenantId,
            consentType: i.consentType ?? 'data-processing',
            granted: i.granted ?? true,
            ipAddress: i.ipAddress,
            userAgent: i.userAgent,
          });
        }
        return svc.checkConsent(ctx.userId ?? 'anonymous', i.consentType ?? 'data-processing');
      },
    ),
  },
  {
    id: 'compliance.export',
    displayName: 'Compliance Audit Export (DPDP/GDPR/SOX/HIPAA)',
    category: 'compliance',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['compliance', 'audit', 'export'],
    source: 'src/services/jrx-orchestration-services.ts:NvComplianceExportService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvComplianceExportService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          framework?: string; evidenceType?: string; title?: string;
          description?: string; generatedBy?: string;
        }>(input);
        return svc.generateEvidence({
          tenantId: ctx.tenantId ?? 'system',
          framework: i.framework ?? 'DPDP',
          evidenceType: i.evidenceType ?? 'audit-export',
          title: i.title ?? `${i.framework ?? 'DPDP'} compliance export`,
          description: i.description,
          generatedBy: i.generatedBy ?? ctx.userId ?? 'system',
        });
      },
    ),
  },
  {
    id: 'compliance.incident',
    displayName: 'Incident Reporting / Logging',
    category: 'compliance',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['incident', 'audit', 'governance'],
    source: 'src/services/jrx-orchestration-services.ts:NvIncidentService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvIncidentService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          severity?: 'low' | 'medium' | 'high' | 'critical';
          incidentType?: string; title?: string; description?: string;
          affectedRequestIds?: string[];
        }>(input);
        return svc.reportIncident({
          tenantId: ctx.tenantId,
          severity: i.severity ?? 'medium',
          incidentType: i.incidentType ?? 'general',
          title: i.title ?? (i.description?.slice(0, 80) ?? 'Incident'),
          description: i.description,
          reportedBy: ctx.userId,
          affectedRequestIds: i.affectedRequestIds,
        });
      },
    ),
  },

  // ── Citation / Explainability / Feedback ──────────────────────────────────
  {
    id: 'safety.citation-verify',
    displayName: 'Citation Verification (legal source grounding)',
    category: 'safety',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'simple'],
    tags: ['citation', 'verification', 'grounding'],
    source: 'src/services/jrx-orchestration-services.ts:NvCitationVerifier',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvCitationVerifier),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ outputText: string }>(input);
        return svc.verifyCitations({
          requestId: ctx.requestId ?? 'unknown',
          outputText: i.outputText,
          jurisdiction: ctx.jurisdiction,
          tenantId: ctx.tenantId,
        });
      },
    ),
  },
  {
    id: 'safety.explainability',
    displayName: 'Explainability / Reasoning Trace',
    category: 'safety',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['explainability', 'reasoning', 'xai'],
    source: 'src/services/jrx-orchestration-services.ts:NvExplainabilityService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvExplainabilityService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ userPrompt?: string; aiOutput?: string; tier?: string }>(input);
        return svc.generateExplanation({
          requestId: ctx.requestId ?? 'unknown',
          agentKey: ctx.agentKey ?? 'default',
          userPrompt: i.userPrompt ?? '',
          aiOutput: i.aiOutput ?? '',
          tier: i.tier ?? ctx.tier ?? 'lite',
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        });
      },
    ),
  },
  {
    id: 'feedback.submit',
    displayName: 'User Feedback Submission',
    category: 'audit',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['feedback', 'rlhf', 'quality'],
    source: 'src/services/jrx-orchestration-services.ts:NvFeedbackService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvFeedbackService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ rating?: number; comment?: string; thumbs?: 'up' | 'down'; responseSnippet?: string; tags?: string[] }>(input);
        return svc.submitFeedback({
          requestId: ctx.requestId ?? 'unknown',
          userId: ctx.userId ?? 'anonymous',
          agentKey: ctx.agentKey ?? 'default',
          rating: i.rating ?? 0,
          comment: i.comment,
          thumbs: i.thumbs,
          responseSnippet: i.responseSnippet,
          tags: i.tags,
          tenantId: ctx.tenantId,
        });
      },
    ),
  },

  // ── Specialised Workflows ─────────────────────────────────────────────────
  {
    id: 'workflow.contract-playbook',
    displayName: 'Contract Playbook Analysis',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['contract', 'playbook', 'review'],
    source: 'src/services/jrx-contract-playbook-service.ts:NvContractPlaybookService',
    factory: fromMethod(
      () => import('../services/jrx-contract-playbook-service.js').then(m => m.nvContractPlaybookService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ contractText?: string; content?: string; documentText?: string; playbookId: string }>(input);
        return svc.checkAgainstPlaybook({
          tenantId: ctx.tenantId ?? 'system',
          playbookId: i.playbookId,
          documentText: i.documentText ?? i.contractText ?? i.content ?? '',
        });
      },
    ),
  },
  {
    id: 'workflow.calendar-extract',
    displayName: 'Calendar / Deadline Extraction',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['calendar', 'deadline', 'extraction'],
    source: 'src/services/jrx-orchestration-services.ts:NvCalendarExtractionService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvCalendarExtractionService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ documentText?: string; content?: string; matterId?: string }>(input);
        return svc.extractFromDocument({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          documentText: i.documentText ?? i.content ?? '',
          matterId: i.matterId,
          jurisdiction: ctx.jurisdiction,
        });
      },
    ),
  },
  {
    id: 'workflow.bulk-analysis',
    displayName: 'Bulk Document Analysis',
    category: 'workflow',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['parallel', 'dag'],
    tags: ['bulk', 'batch', 'analysis'],
    source: 'src/services/jrx-orchestration-services.ts:NvBulkAnalysisService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvBulkAnalysisService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ documents?: unknown[]; analysisType?: string; jobName?: string; totalDocuments?: number }>(input);
        return svc.createJob({
          tenantId: ctx.tenantId ?? 'system',
          userId: ctx.userId,
          jobName: i.jobName ?? `bulk-${Date.now()}`,
          analysisType: i.analysisType ?? 'general',
          totalDocuments: i.totalDocuments ?? (i.documents?.length ?? 0),
          tier: ctx.tier,
        });
      },
    ),
  },
  {
    id: 'workflow.email-classify',
    displayName: 'Email Classification (intake/triage)',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['email', 'classification', 'triage'],
    source: 'src/services/jrx-orchestration-services.ts:NvEmailClassificationService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvEmailClassificationService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ subject?: string; body?: string; from?: string }>(input);
        return svc.classifyEmail({
          tenantId: ctx.tenantId ?? 'system',
          userId: ctx.userId,
          emailSubject: i.subject ?? '',
          emailBodySnippet: i.body ?? '',
          emailFrom: i.from ?? '',
        });
      },
    ),
  },

  // ── Wave B6 Mesh v1 aliases ───────────────────────────────────────────────
  // New intent-facing ids are thin wrappers over existing live leaves:
  // templates.*, digital_twin.simulate, clm.playbook, efiling.steps,
  // intelligence.precedent. They exist so Queen can bind by intent without
  // inventing stubbed capabilities. jrx-allow-placeholder: these wrap LIVE leaves.
  {
    id: 'templates.catalog',
    displayName: 'Templates Catalog (NSP / ecosystem)',
    category: 'tools',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['template', 'templates', 'catalog', 'browse', 'list', 'drafting'],
    source: 'src/services/jrx-templates-catalog-service.ts',
    factory: fromMethod(
      () => import('../services/jrx-templates-catalog-service.js'),
      (mod: LoadedModule) => async (input) => {
        const svc = mod as LoadedModule & {
          nspCatalogEnvelope?: (q?: TemplatesCatalogQuery) => unknown;
        };
        if (typeof svc.nspCatalogEnvelope !== 'function') {
          throw new Error('[manifest] templates.catalog factory missing nspCatalogEnvelope');
        }
        const q = coerceInput<Partial<TemplatesCatalogQuery>>(input);
        return svc.nspCatalogEnvelope(q) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'templates.generate',
    displayName: 'Templates Generator (NSP / ecosystem)',
    category: 'tools',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['template', 'templates', 'generate', 'draft', 'drafting', 'fill'],
    source: 'src/services/jrx-templates-catalog-service.ts',
    factory: fromMethod(
      () => import('../services/jrx-templates-catalog-service.js'),
      (mod: LoadedModule) => async (input) => {
        const svc = mod as LoadedModule & {
          fillTemplate?: (id: string, variables: Record<string, unknown>) => { content: string; template: { id: string; name: string; jurisdiction_code: string; document_type: string; approval_status?: string } } | null;
        };
        if (typeof svc.fillTemplate !== 'function') {
          throw new Error('[manifest] templates.generate factory missing fillTemplate');
        }
        const i = coerceInput<{ templateId?: string; id?: string; variables?: Record<string, unknown>; fields?: Record<string, unknown> }>(input);
        const templateId = String(i.templateId ?? i.id ?? '').trim();
        if (!templateId) {
          throw new Error('[templates.generate] templateId is required');
        }
        const filled = svc.fillTemplate(templateId, i.variables ?? i.fields ?? {});
        if (!filled) {
          throw new Error(`[templates.generate] template not found: ${templateId}`);
        }
        return {
          success: true,
          data: {
            templateId: filled.template.id,
            name: filled.template.name,
            content: filled.content,
            variables: i.variables ?? i.fields ?? {},
            jurisdiction_code: filled.template.jurisdiction_code,
            document_type: filled.template.document_type,
            approval_status: filled.template.approval_status,
            generatedAt: new Date().toISOString(),
          },
        } as CapabilityInvocationOutput;
      },
    ),
  },
  {
    id: 'digital_twin.simulate',
    displayName: 'Digital Twin Simulation (alias)',
    category: 'simulation',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['digital-twin', 'digital_twin', 'twin', 'simulation', 'modeling', 'scenario'],
    source: 'src/services/digital-twin/digital-twin-service.ts',
    factory: fromMethod(
      () => import('../services/digital-twin/digital-twin-service.js'),
      (mod: LoadedModule) => async (input) => {
        const svc = pickModuleService(mod, ['digitalTwinService', 'default']);
        const fn = pickServiceMethod(svc, ['runSimulation', 'simulate', 'run', 'execute']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'clm.playbook',
    displayName: 'Contract Lifecycle Playbook Analysis',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['contract', 'playbook', 'clm', 'review', 'lifecycle', 'contract-lifecycle'],
    source: 'src/services/jrx-contract-playbook-service.ts',
    factory: fromMethod(
      () => import('../services/jrx-contract-playbook-service.js').then((m) => m.nvContractPlaybookService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ playbookId: string; documentText?: string; contractText?: string; content?: string }>(input);
        return svc.checkAgainstPlaybook({
          playbookId: i.playbookId,
          documentText: i.documentText ?? i.contractText ?? i.content ?? '',
          tenantId: ctx.tenantId ?? 'system',
        });
      },
    ),
  },
  {
    id: 'efiling.steps',
    displayName: 'E-Filing Steps / Submission Prep',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['e-filing', 'efiling', 'filing', 'steps', 'court', 'submission'],
    source: 'src/services/e-filing/e-filing-service.ts',
    factory: fromMethod(
      () => import('../services/e-filing/e-filing-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['eFilingService', 'default']);
        const i = coerceInput<{
          op?: 'steps' | 'create' | 'submit';
          jurisdiction?: string;
          filingType?: string;
          filingId?: string;
          organizationId?: string;
          userId?: string;
          courtName?: string;
          caseNumber?: string;
          caseTitle?: string;
          documents?: Array<Record<string, unknown>>;
          metadata?: Record<string, unknown>;
        }>(input);
        const jurisdiction = String(i.jurisdiction ?? ctx.jurisdiction ?? 'IN').toUpperCase();
        const op = String(i.op ?? 'steps');
        if (op === 'create') {
          const createFn = pickServiceMethod(svc, ['createFiling']);
          return createFn.call(svc, {
            organizationId: i.organizationId ?? ctx.tenantId ?? 'system',
            userId: i.userId ?? ctx.userId ?? 'system',
            jurisdiction,
            filingType: i.filingType ?? 'civil-suit',
            courtName: i.courtName ?? 'Auto-selected court',
            caseNumber: i.caseNumber ?? `AUTO-${Date.now()}`,
            caseTitle: i.caseTitle ?? 'Auto-generated filing',
            documents: i.documents ?? [],
            metadata: i.metadata ?? {},
          }) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'submit') {
          const submitFn = pickServiceMethod(svc, ['submitFiling']);
          if (!i.filingId) {
            throw new Error('[efiling.steps] filingId is required for submit');
          }
          return submitFn.call(svc, i.filingId) as Promise<CapabilityInvocationOutput>;
        }
        return {
          jurisdiction,
          supportedFilingTypes: (svc as { getSupportedFilingTypes?: (j: string) => string[] }).getSupportedFilingTypes?.(jurisdiction) ?? [],
          formatRequirements: (svc as { getFormatRequirements?: (j: string) => string[] }).getFormatRequirements?.(jurisdiction) ?? [],
          health: (svc as { healthCheck?: () => unknown }).healthCheck?.(),
          submissionSteps: [
            'Select the filing type and jurisdiction',
            'Attach and validate all required documents',
            'Pay fees and satisfy signature requirements',
            'Submit once the filing is ready',
          ],
        } as CapabilityInvocationOutput;
      },
    ),
  },
  {
    id: 'intelligence.precedent',
    displayName: 'Precedent Research (semantic match)',
    category: 'intelligence',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['precedent', 'case-law', 'caselaw', 'research', 'semantic', 'similarity'],
    source: 'src/services/intelligence/jrx-precedent-similarity-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-precedent-similarity-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['nvPrecedentSimilarityService', 'default']);
        const fn = pickServiceMethod(svc, ['findSimilarPrecedents', 'findSimilar', 'searchSimilar', 'search']);
        const i = coerceInput<{ caseDescription?: string; description?: string; jurisdiction?: string; maxResults?: number }>(input);
        return fn.call(svc, i.caseDescription ?? i.description ?? '', String(i.jurisdiction ?? ctx.jurisdiction ?? 'IN').toUpperCase(), {
          maxResults: i.maxResults ?? 5,
        }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Agent Lifecycle / Selection ───────────────────────────────────────────
  {
    id: 'agent.auto-select',
    displayName: 'Agent Auto-Selection (capability-driven routing)',
    category: 'agent-orchestration',
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'hierarchical', 'cot-with-tools', 'collective-debate'],
    tags: ['agent', 'routing', 'selection', 'debate'],
    sideEffects: 'read',
    routeExposure: { transport: 'internal', channel: 'orchestration.agent.auto-select' },
    source: 'src/services/jrx-orchestration-services.ts:NvAgentAutoSelector',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvAgentAutoSelector),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ query?: string; prompt?: string }>(input);
        return svc.selectAgent({
          query: i.query ?? i.prompt ?? '',
          jurisdiction: ctx.jurisdiction,
          userId: ctx.userId,
          tenantId: ctx.tenantId,
        });
      },
    ),
  },
  {
    id: 'agent.metrics',
    displayName: 'Agent Performance Metrics',
    category: 'agent-orchestration',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['metrics', 'performance', 'monitoring'],
    source: 'src/services/jrx-orchestration-services.ts:NvAgentMetricsService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvAgentMetricsService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ op?: string; latencyMs?: number; tokens?: number; costUsd?: number; success?: boolean }>(input);
        if (i.op === 'record') {
          return svc.recordMetrics({
            agentKey: ctx.agentKey ?? 'default',
            tenantId: ctx.tenantId,
            latencyMs: i.latencyMs ?? 0,
            tokens: i.tokens ?? 0,
            costUsd: i.costUsd,
            success: i.success ?? true,
          });
        }
        return svc.getAgentMetrics(ctx.agentKey, ctx.tenantId);
      },
    ),
  },
  {
    id: 'agent.custom-create',
    displayName: 'Create Custom Agent',
    category: 'agent-orchestration',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'high-risk',
    supportedPatterns: ['simple'],
    tags: ['agent', 'custom', 'create'],
    source: 'src/services/jrx-orchestration-services.ts:NvCustomAgentService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvCustomAgentService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          name?: string; agentName?: string; description?: string;
          systemPrompt: string; allowedActions?: string[];
          knowledgeSourceIds?: string[]; temperature?: number;
          maxTokens?: number; modelPreference?: string;
        }>(input);
        return svc.createAgent({
          tenantId: ctx.tenantId ?? 'system',
          createdBy: ctx.userId,
          agentName: i.agentName ?? i.name ?? 'custom-agent',
          description: i.description,
          systemPrompt: i.systemPrompt,
          knowledgeSourceIds: i.knowledgeSourceIds,
          allowedActions: i.allowedActions,
          temperature: i.temperature,
          maxTokens: i.maxTokens,
          modelPreference: i.modelPreference,
        });
      },
    ),
  },

  // ── Model Governance ──────────────────────────────────────────────────────
  {
    id: 'governance.model-policy',
    displayName: 'Model Governance Policy Check',
    category: 'compliance',
    // JRX-CAP-MODEL-POLICY-LITE-001 (2026-04-30): model-policy is a SECURITY control
    // (5-provider lockdown enforcement + verified-model gate). It must run on every tier,
    // not just paid ones — otherwise lite-tier users bypass the lockdown entirely and the
    // orchestrate route fails closed with `capability not exposed to tier lite` and falls
    // back to single-agent (which then bypasses the Queen memory wiring shipped in
    // JRX-ORCH-MEM-001/002/003). Adding 'lite' and 'mitra' so all tiers are governed.
    tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple', 'cot-with-tools', 'collective-debate'],
    tags: ['governance', 'policy', 'model'],
    sideEffects: 'write',
    routeExposure: { transport: 'internal', channel: 'orchestration.governance.model-policy' },
    source: 'src/services/jrx-orchestration-services.ts:NvModelGovernanceService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvModelGovernanceService),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{
          provider?: string; model?: string; modelName?: string;
          version?: string; deploymentRegions?: string[];
          riskAssessment?: Record<string, unknown>;
        }>(input);
        const resolvedModel = i.modelName ?? i.model;
        const resolvedProvider = i.provider;
        if (!resolvedModel || !resolvedProvider) {
          throw new Error(
            `[governance.model-policy] structured-input failure: required fields missing ` +
            `(model=${resolvedModel ?? 'undefined'}, provider=${resolvedProvider ?? 'undefined'}). ` +
            `Caller must supply both before invocation; refusing to register an un-attributable model.`,
          );
        }
        return svc.registerModel({
          modelName: resolvedModel,
          provider: resolvedProvider,
          version: i.version,
          deploymentRegions: i.deploymentRegions ?? (ctx.jurisdiction ? [ctx.jurisdiction] : ['IN']),
          approvedBy: ctx.userId ?? 'system',
          riskAssessment: i.riskAssessment,
        });
      },
    ),
  },

  // ── Document Pipeline (extended) ──────────────────────────────────────────
  {
    id: 'docs.parse-legal',
    displayName: 'Legal Document Parser (clause + heading detection)',
    category: 'document-pipeline',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['parsing', 'legal', 'clauses'],
    source: 'src/services/document-pipeline/jrx-legal-parser-service.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/jrx-legal-parser-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['legalParserService', 'default']);
        const fn = pickServiceMethod(svc, ['parse', 'parseDocument', 'process']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'docs.chunk-legal',
    displayName: 'Legal-Aware Chunker (jurisdictional segmentation)',
    category: 'document-pipeline',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['chunking', 'segmentation'],
    source: 'src/services/document-pipeline/jrx-legal-chunker-service.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/jrx-legal-chunker-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['legalChunkerService', 'default']);
        const fn = pickServiceMethod(svc, ['chunk', 'process']);
        return fn.call(svc, { ...input, jurisdiction: ctx.jurisdiction, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'docs.ocr',
    displayName: 'GOT-OCR Document Recognition',
    category: 'document-pipeline',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['ocr', 'vision', 'extraction'],
    source: 'src/services/document-pipeline/jrx-got-ocr-adapter-service.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/jrx-got-ocr-adapter-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['nvOcrAdapterService', 'nvGotOcrAdapterService', 'default']);
        const fn = pickServiceMethod(svc, ['ocrDocument', 'ocrImage', 'recognize', 'process', 'extract']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'docs.esign',
    displayName: 'E-Signature Adapter',
    category: 'document-pipeline',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['esign', 'signature', 'docusign'],
    source: 'src/services/document-pipeline/jrx-esign-adapter-service.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/jrx-esign-adapter-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        // NV-ESIGN-WIRE-001: singleton is `nvESignAdapterService` (DB-persisted
        // sessions). Provider outbound (DocuSign REST / Aadhaar) remains stub —
        // createSigningSession persists + returns oauth_required honesty when
        // DOCUSIGN_* keys absent. Do not claim live DocuSign/iManage OAuth.
        const svc = pickModuleService(mod, ['nvESignAdapterService', 'default']);
        const op = String((input as { op?: string }).op || 'create').toLowerCase();
        const orgId = Number(
          (input as { organizationId?: number }).organizationId
            ?? ctx.tenantId
            ?? 0,
        ) || 0;
        if (op === 'status' || op === 'check') {
          const sessionId = String((input as { sessionId?: string }).sessionId || '');
          const status = await (svc as { checkSigningStatus: (id: string) => Promise<string> })
            .checkSigningStatus(sessionId);
          return { status, sessionId } as CapabilityInvocationOutput;
        }
        if (op === 'get' || op === 'session') {
          const sessionId = String((input as { sessionId?: string }).sessionId || '');
          const session = await (svc as { getSession: (id: string) => Promise<unknown> })
            .getSession(sessionId);
          return { session } as CapabilityInvocationOutput;
        }
        const signersRaw = (input as { signers?: Array<{
          name: string; email: string; role: 'primary' | 'witness' | 'notary'; order: number;
        }> }).signers;
        const signersList = Array.isArray(signersRaw) && signersRaw.length > 0
          ? signersRaw
          : [{ name: 'Signer', email: 'signer@example.com', role: 'primary' as const, order: 1 }];
        const docRaw = (input as { document?: string | Buffer; documentBase64?: string }).document
          ?? (input as { documentBase64?: string }).documentBase64
          ?? '';
        const document = Buffer.isBuffer(docRaw)
          ? docRaw
          : Buffer.from(String(docRaw || (input as { prompt?: string }).prompt || 'unsigned'), 'utf-8');
        const createFn = (svc as Record<string, unknown>).createSigningSession as
          | ((doc: Buffer, signers: typeof signersList, opts: { organizationId: number; platformCode?: string | null }) => Promise<unknown>)
          | undefined;
        if (typeof createFn !== 'function') {
          throw new Error('[manifest] nvESignAdapterService missing createSigningSession');
        }
        const session = await createFn.call(svc, document, signersList, {
          organizationId: orgId,
          platformCode: ctx.userId ?? null,
        });
        return {
          session,
          providerNote: 'JRX e-sign session persisted; external DocuSign/iManage OAuth not live until partner credentials + /oauth/start route.',
        } as CapabilityInvocationOutput;
      },
    ),
  },
  {
    id: 'docs.pdfa',
    displayName: 'PDF/A Archival Generation',
    category: 'document-pipeline',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['pdfa', 'archival', 'compliance'],
    source: 'src/services/document-pipeline/jrx-pdfa-generator-service.ts',
    factory: fromMethod(
      () => import('../services/document-pipeline/jrx-pdfa-generator-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['pdfaGeneratorService', 'default']);
        const fn = pickServiceMethod(svc, ['generate', 'convert', 'process']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Nyaya-Tools Suite ─────────────────────────────────────────────────────
  // Full suite of NyayaVignya legal-domain tools. Each is the proper, bound
  // service implementation — no stubs.
  ...buildNyayaToolsCapabilities(),

  // ── Jurisdiction Agents (per-region overlays) ─────────────────────────────
  {
    id: 'jurisdiction.overlay',
    displayName: 'Jurisdictional Overlay (per-region prompt + rule layering)',
    category: 'agent-orchestration',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['jurisdiction', 'overlay', 'localization'],
    source: 'src/services/jurisdiction-agents/jrx-jurisdiction-overlay-service.ts',
    factory: fromMethod(
      () => import('../services/jurisdiction-agents/jrx-jurisdiction-overlay-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['jurisdictionOverlayService', 'default']);
        const fn = pickServiceMethod(svc, ['applyOverlay', 'overlay', 'apply']);
        return fn.call(svc, { ...input, jurisdiction: ctx.jurisdiction }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'jurisdiction.sync',
    displayName: 'Unified Jurisdiction Sync',
    category: 'agent-orchestration',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['jurisdiction', 'sync', 'governance'],
    source: 'src/services/jurisdiction-agents/unified-jurisdiction-sync.ts',
    factory: fromMethod(
      () => import('../services/jurisdiction-agents/unified-jurisdiction-sync.js'),
      (mod: LoadedModule) => async (input) => {
        const svc = pickModuleService(mod, ['unifiedJurisdictionSync', 'default']);
        const fn = pickServiceMethod(svc, ['sync', 'refresh', 'execute']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Contract Lifecycle (CLM) ──────────────────────────────────────────────
  {
    id: 'clm.lifecycle',
    displayName: 'Contract Lifecycle Management (CLM)',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['contract', 'lifecycle', 'clm', 'workflow', 'contract-lifecycle', 'playbook'],
    source: 'src/services/contract-lifecycle/contract-lifecycle-service.ts',
    factory: fromMethod(
      () => import('../services/contract-lifecycle/contract-lifecycle-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['contractLifecycleService', 'default']);
        const i = coerceInput<{
          op?: 'create' | 'advance' | 'get' | 'dashboard' | 'health' | 'expiring' | 'overdue';
          contractId?: string;
          userId?: string;
          organizationId?: string;
          comments?: string;
          withinDays?: number;
          type?: string;
          stage?: string;
          title?: string;
          jurisdiction?: string | string[];
          governingLaw?: string;
          parties?: unknown[];
          autoRenew?: boolean;
          tags?: string[];
          metadata?: Record<string, unknown>;
        }>(input);
        const op = String(i.op ?? 'dashboard');
        const orgId = i.organizationId ?? ctx.tenantId;
        const userId = i.userId ?? ctx.userId ?? 'system';

        if (op === 'create') {
          const createFn = pickServiceMethod(svc, ['createContract']);
          return createFn.call(svc, {
            organizationId: orgId ?? 'system',
            ownedBy: userId,
            type: (i.type ?? 'custom') as 'custom',
            stage: (i.stage ?? 'initiation') as 'initiation',
            title: i.title ?? 'Untitled contract',
            jurisdiction: Array.isArray(i.jurisdiction)
              ? i.jurisdiction
              : [String(i.jurisdiction ?? ctx.jurisdiction ?? 'IN').toUpperCase()],
            governingLaw: i.governingLaw ?? String(i.jurisdiction ?? ctx.jurisdiction ?? 'IN').toUpperCase(),
            parties: (i.parties ?? []) as [],
            autoRenew: i.autoRenew ?? false,
            complianceStatus: { passed: true, frameworks: [], violations: [] },
            tags: i.tags ?? [],
            metadata: i.metadata ?? {},
          }) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'advance') {
          if (!i.contractId) {
            throw new Error('[clm.lifecycle] contractId is required for advance');
          }
          const advanceFn = pickServiceMethod(svc, ['advanceStage']);
          return advanceFn.call(svc, i.contractId, userId, i.comments) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'get') {
          if (!i.contractId) {
            throw new Error('[clm.lifecycle] contractId is required for get');
          }
          const getFn = pickServiceMethod(svc, ['getContract']);
          return { success: true, data: getFn.call(svc, i.contractId) } as CapabilityInvocationOutput;
        }
        if (op === 'expiring') {
          const expiringFn = pickServiceMethod(svc, ['getExpiringContracts']);
          return expiringFn.call(svc, i.withinDays ?? 30, orgId) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'overdue') {
          const overdueFn = pickServiceMethod(svc, ['getOverdueObligations']);
          return overdueFn.call(svc, orgId) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'health') {
          const healthFn = pickServiceMethod(svc, ['healthCheck']);
          return healthFn.call(svc) as Promise<CapabilityInvocationOutput>;
        }
        const dashboardFn = pickServiceMethod(svc, ['getDashboardStats']);
        return dashboardFn.call(svc, orgId) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Digital Twin (legal practice mirroring) ───────────────────────────────
  {
    id: 'digital-twin.simulate',
    displayName: 'Digital Twin Simulation',
    category: 'intelligence',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['digital-twin', 'twin', 'simulation', 'modeling', 'scenario'],
    source: 'src/services/digital-twin/digital-twin-service.ts',
    factory: fromMethod(
      () => import('../services/digital-twin/digital-twin-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['digitalTwinService', 'default']);
        const fn = pickServiceMethod(svc, ['runSimulation', 'simulate', 'run']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── E-Filing (court e-filing adapters) ────────────────────────────────────
  {
    id: 'e-filing.submit',
    displayName: 'Court E-Filing Submission',
    category: 'workflow',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['e-filing', 'court', 'submission', 'filing'],
    source: 'src/services/e-filing/e-filing-service.ts',
    factory: fromMethod(
      () => import('../services/e-filing/e-filing-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['eFilingService', 'default']);
        const i = coerceInput<{ filingId?: string }>(input);
        if (!i.filingId) {
          throw new Error('[e-filing.submit] filingId is required');
        }
        const fn = pickServiceMethod(svc, ['submitFiling', 'submit']);
        return fn.call(svc, i.filingId) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── AutomateAI (workflow automation) ──────────────────────────────────────
  {
    id: 'automateai.workflow',
    displayName: 'AutomateAI Workflow Engine',
    category: 'workflow',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag', 'parallel'],
    tags: ['automation', 'workflow', 'rpa'],
    source: 'src/services/automateai/automateai-service.ts',
    factory: fromMethod(
      () => import('../services/automateai/automateai-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['automateAIService', 'default']);
        const fn = pickServiceMethod(svc, ['runWorkflow', 'execute', 'run']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── ClawdBot (web crawler / case-law harvesting) ──────────────────────────
  {
    id: 'clawdbot.crawl',
    displayName: 'ClawdBot Legal Web Crawl',
    category: 'tools',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['crawl', 'scrape', 'case-law', 'harvest'],
    source: 'src/services/clawdbot/clawdbot-service.ts',
    factory: fromMethod(
      () => import('../services/clawdbot/clawdbot-service.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['clawdBotService', 'default']);
        const fn = pickServiceMethod(svc, ['crawl', 'fetch', 'execute']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Multi-Org (tenant federation) ─────────────────────────────────────────
  {
    id: 'multi-org.federate',
    displayName: 'Multi-Organization Federation',
    category: 'compliance',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['multi-org', 'federation', 'tenancy'],
    source: 'src/services/multi-org/index.ts',
    factory: fromMethod(
      () => import('../services/multi-org/index.js'),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, ['multiOrgService', 'default']);
        const op = String(input.op ?? 'list');
        const fn = pickServiceMethod(svc, [op, 'execute']);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Enterprise Platform (research / financial / web / OCR / multimedia) ──
  ...buildEnterprisePlatformCapabilities(),

  // ── OmniChannel / OpenBot ───────────────────────────────────────────────────
  {
    id: 'openbot.receive',
    displayName: 'OpenBot — Inbound Channel Message',
    category: 'omnichannel',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['openbot', 'channel', 'inbound', 'whatsapp', 'slack', 'teams', 'telegram'],
    source: 'src/services/openbot/openbot-service.ts',
    factory: fromMethod(
      () => import('../services/openbot/openbot-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['openBotService', 'default']);
        const fn = pickServiceMethod(svc, ['receiveMessage']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'openbot.send',
    displayName: 'OpenBot — Outbound Channel Message',
    category: 'omnichannel',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['simple', 'sequential', 'parallel'],
    tags: ['openbot', 'channel', 'outbound', 'notification'],
    source: 'src/services/openbot/openbot-service.ts',
    factory: fromMethod(
      () => import('../services/openbot/openbot-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['openBotService', 'default']);
        const fn = pickServiceMethod(svc, ['sendMessage']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── TwinDesk Simulation ─────────────────────────────────────────────────────
  {
    id: 'twindesk.simulate',
    displayName: 'TwinDesk — Persona Simulation',
    category: 'simulation',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['twindesk', 'simulation', 'persona', 'digital-twin', 'scenario'],
    source: 'src/services/twindesk/twindesk-service.ts',
    factory: fromMethod(
      () => import('../services/twindesk/twindesk-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['twinDeskService', 'default']);
        const fn = pickServiceMethod(svc, ['simulate']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'twindesk.chat',
    displayName: 'TwinDesk — Persona Chat',
    category: 'simulation',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['twindesk', 'chat', 'persona'],
    source: 'src/services/twindesk/twindesk-service.ts',
    factory: fromMethod(
      () => import('../services/twindesk/twindesk-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['twinDeskService', 'default']);
        const fn = pickServiceMethod(svc, ['chat']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Regulatory Monitor ──────────────────────────────────────────────────────
  {
    id: 'regulatory-monitor.events',
    displayName: 'Regulatory Monitor — Events Feed',
    category: 'monitoring',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential', 'parallel'],
    tags: ['regulatory', 'monitor', 'compliance', 'events', 'feed'],
    source: 'src/services/regulatory-monitor/regulatory-monitor-service.ts',
    factory: fromMethod(
      () => import('../services/regulatory-monitor/regulatory-monitor-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['regulatoryMonitor', 'default']);
        const fn = pickServiceMethod(svc, ['getEvents']);
        return fn.call(svc, input?.filters) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'regulatory-monitor.subscribe',
    displayName: 'Regulatory Monitor — Subscribe',
    category: 'monitoring',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple'],
    tags: ['regulatory', 'monitor', 'subscribe', 'alert'],
    source: 'src/services/regulatory-monitor/regulatory-monitor-service.ts',
    factory: fromMethod(
      () => import('../services/regulatory-monitor/regulatory-monitor-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['regulatoryMonitor', 'default']);
        const fn = pickServiceMethod(svc, ['subscribe']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── White-Label ─────────────────────────────────────────────────────────────
  {
    id: 'white-label.config',
    displayName: 'White-Label — Partner Configuration',
    category: 'white-label',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['simple'],
    tags: ['white-label', 'partner', 'config', 'branding'],
    source: 'src/services/white-label/white-label-service.ts',
    factory: fromMethod(
      () => import('../services/white-label/white-label-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['whiteLabelService', 'default']);
        const op = String(input?.op ?? 'getConfig');
        const fn = pickServiceMethod(svc, [op]);
        const args = Array.isArray(input?.args) ? input.args : [input?.partnerId ?? input];
        return fn.call(svc, ...args) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'white-label.feature-toggle',
    displayName: 'White-Label — Feature Toggle Check',
    category: 'white-label',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'free',
    safetyClass: 'safe',
    supportedPatterns: ['simple'],
    tags: ['white-label', 'feature', 'toggle', 'gating'],
    source: 'src/services/white-label/white-label-service.ts',
    factory: fromMethod(
      () => import('../services/white-label/white-label-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['whiteLabelService', 'default']);
        const fn = pickServiceMethod(svc, ['isFeatureEnabled']);
        return fn.call(svc, input?.partnerId, input?.feature) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Memory variants (graph / project / 5-tier / social) ─────────────────────
  {
    id: 'memory.graph.add',
    displayName: 'Graph Memory — Add Node',
    category: 'memory',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['memory', 'graph', 'knowledge'],
    source: 'src/services/memory/graph-memory-service.ts',
    factory: fromMethod(
      () => import('../services/memory/graph-memory-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['graphMemoryService', 'default']);
        const fn = pickServiceMethod(svc, ['addMemory']);
        return fn.call(svc, input?.content ?? input, input?.options ?? {}) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'memory.project.store',
    displayName: 'Project Memory — Store Entry',
    category: 'memory',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['memory', 'project', 'persist'],
    source: 'src/services/memory/project-memory-manager.ts',
    factory: fromMethod(
      () => import('../services/memory/project-memory-manager.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['projectMemoryManager', 'default']);
        const fn = pickServiceMethod(svc, ['storeMemory']);
        return fn.call(svc, input?.projectId, input?.memory, input?.memoryType ?? 'long') as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'memory.5tier.episodic',
    displayName: '5-Tier Memory — Episodic Read',
    category: 'memory',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['memory', '5tier', 'episodic', 'session'],
    source: 'src/services/memory/jrx-5tier-memory-service.ts',
    factory: fromMethod(
      () => import('../services/memory/jrx-5tier-memory-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nv5TierMemoryService', 'default']);
        const fn = pickServiceMethod(svc, ['getEpisodic']);
        return fn.call(svc, input?.sessionId, input?.limit ?? 20) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'memory.social.context',
    displayName: 'Social Memory — Context',
    category: 'memory',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['memory', 'social', 'context', 'mem0'],
    source: 'src/services/social-memory-service.ts',
    factory: fromMethod(
      () => import('../services/social-memory-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['socialMemoryService', 'default']);
        if (typeof svc.getSocialContext === 'function') {
          return svc.getSocialContext(input) as Promise<CapabilityInvocationOutput>;
        }
        const helper = mod.getSocialContext;
        if (typeof helper !== 'function') {
          throw new Error('social-memory: getSocialContext not exposed on service or module');
        }
        return helper(input?.userId, input?.agentKey, input?.orgId) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── mem0 persistence (canonical) ──────────────────────────────────────────
  {
    id: 'memory.mem0.store',
    displayName: 'mem0 — Persist Memory',
    category: 'memory',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential', 'parallel'],
    tags: ['memory', 'mem0', 'persist', 'agent-context'],
    source: 'src/services/mem0-persistence-service.ts:Mem0PersistenceService',
    factory: fromMethod(
      () => import('../services/mem0-persistence-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['mem0PersistenceService', 'default']);
        const fn = pickServiceMethod(svc, ['store']);
        const i = coerceInput<{ agentId?: string; namespace?: string; content: string; metadata?: Record<string, unknown>; type?: string }>(input);
        return fn.call(svc, i.agentId ?? ctx.agentKey ?? 'agent', i.namespace ?? ctx.tenantId ?? 'default', i.content, i.metadata, i.type) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'memory.mem0.recall',
    displayName: 'mem0 — Recall Memories',
    category: 'memory',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential', 'parallel', 'dag'],
    tags: ['memory', 'mem0', 'recall', 'agent-context'],
    source: 'src/services/mem0-persistence-service.ts:Mem0PersistenceService',
    factory: fromMethod(
      () => import('../services/mem0-persistence-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['mem0PersistenceService', 'default']);
        const fn = pickServiceMethod(svc, ['recall']);
        const i = coerceInput<{ agentId?: string; namespace?: string; query?: string; limit?: number }>(input);
        return fn.call(svc, i.agentId ?? ctx.agentKey ?? 'agent', i.namespace ?? ctx.tenantId ?? 'default', i.query, i.limit ?? 10) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'memory.mem0.consolidate',
    displayName: 'mem0 — Consolidate Memories',
    category: 'memory',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['memory', 'mem0', 'consolidate', 'compaction'],
    source: 'src/services/mem0-persistence-service.ts:Mem0PersistenceService',
    factory: fromMethod(
      () => import('../services/mem0-persistence-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['mem0PersistenceService', 'default']);
        const fn = pickServiceMethod(svc, ['consolidate']);
        const i = coerceInput<{ agentId?: string; namespace?: string }>(input);
        return fn.call(svc, i.agentId ?? ctx.agentKey ?? 'agent', i.namespace ?? ctx.tenantId ?? 'default') as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── RAG variants (Adaptive / Corrective / Self / GraphRAG / LightRAG / Reranker) ──
  {
    id: 'rag.adaptive',
    displayName: 'Adaptive RAG — Query-aware Retrieval',
    category: 'rag',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag', 'cot-with-tools', 'collective-debate'],
    tags: ['rag', 'adaptive', 'retrieval'],
    sideEffects: 'read',
    routeExposure: { transport: 'internal', channel: 'orchestration.rag.adaptive' },
    source: 'src/services/rag/adaptive-rag-service.ts',
    factory: fromMethod(
      () => import('../services/rag/adaptive-rag-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['adaptiveRAGService', 'default']);
        const fn = pickServiceMethod(svc, ['adaptiveRetrieve']);
        const i = coerceInput<{ query: string; context?: Record<string, unknown> }>(input);
        return fn.call(svc, i.query, i.context) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'rag.corrective',
    displayName: 'Corrective RAG — Self-correcting Retrieval',
    category: 'rag',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['rag', 'corrective', 'crag', 'retrieval'],
    source: 'src/services/rag/corrective-rag-service.ts',
    factory: fromMethod(
      () => import('../services/rag/corrective-rag-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['correctiveRAGService', 'default']);
        const fn = pickServiceMethod(svc, ['runCRAGPipeline']);
        const i = coerceInput<{ query: string; documents?: unknown[] }>(input);
        return fn.call(svc, i.query, i.documents ?? []) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'rag.self',
    displayName: 'Self-RAG — Reflective Retrieval & Validation',
    category: 'rag',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag'],
    tags: ['rag', 'self-rag', 'reflection', 'validation'],
    source: 'src/services/rag/self-rag-service.ts',
    factory: fromMethod(
      () => import('../services/rag/self-rag-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['selfRAGService', 'default']);
        const fn = pickServiceMethod(svc, ['runSelfRAGLoop']);
        const i = coerceInput<{ query: string; answer?: string; context?: unknown[] }>(input);
        return fn.call(svc, i.query, i.answer ?? '', i.context ?? []) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'rag.graph',
    displayName: 'GraphRAG — Legal Knowledge Graph Retrieval',
    category: 'rag',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel', 'dag'],
    tags: ['rag', 'graph', 'graphrag', 'knowledge-graph', 'legal'],
    source: 'src/services/rag/jrx-graphrag-legal-service.ts',
    factory: fromMethod(
      () => import('../services/rag/jrx-graphrag-legal-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['nyvGraphRAGLegal', 'default']);
        const fn = pickServiceMethod(svc, ['search']);
        const i = coerceInput<{ query: string; orgId?: string; userId?: string; maxResults?: number }>(input);
        return fn.call(svc, i.query, i.orgId ?? ctx.tenantId ?? 'default', i.userId ?? ctx.userId ?? 'system', i.maxResults ?? 5) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'rag.lightrag',
    displayName: 'LightRAG — Lightweight Hybrid Retrieval',
    category: 'rag',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['rag', 'lightrag', 'hybrid', 'retrieval'],
    source: 'src/services/rag/jrx-lightrag-pipeline.ts',
    factory: fromMethod(
      () => import('../services/rag/jrx-lightrag-pipeline.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const helper = mod.getLightRAGPipeline;
        if (typeof helper !== 'function') {
          throw new Error('lightrag: getLightRAGPipeline not exported');
        }
        const pipeline = helper() as LoadedService;
        const fn = pickServiceMethod(pipeline, ['query']);
        const i = coerceInput<{ query: string; mode?: string; limit?: number }>(input);
        return fn.call(pipeline, i.query, { mode: i.mode, limit: i.limit }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'rag.reranker',
    displayName: 'Legal Reranker — Domain-aware Result Reranking',
    category: 'rag',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'parallel'],
    tags: ['rag', 'reranker', 'rerank', 'cross-encoder'],
    source: 'src/services/rag/jrx-legal-reranker-service.ts',
    factory: fromMethod(
      () => import('../services/rag/jrx-legal-reranker-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvLegalRerankerService', 'default']);
        const fn = pickServiceMethod(svc, ['rerankLegal']);
        const i = coerceInput<{ query: string; candidates: unknown[]; options?: Record<string, unknown> }>(input);
        return fn.call(svc, i.query, i.candidates ?? [], i.options ?? {}) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Vector store adapters (Qdrant) ────────────────────────────────────────
  {
    id: 'vector.qdrant.search',
    displayName: 'Qdrant Vector Store — Search',
    category: 'vector',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'parallel'],
    tags: ['vector', 'qdrant', 'search', 'embedding'],
    source: 'src/services/rag/jrx-qdrant-adapter-service.ts',
    factory: fromMethod(
      () => import('../services/rag/jrx-qdrant-adapter-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvVectorStore', 'default']);
        const fn = pickServiceMethod(svc, ['search']);
        const i = coerceInput<{ query: number[]; collection?: string; limit?: number; filter?: Record<string, unknown> }>(input);
        return fn.call(svc, i.query, { collection: i.collection, limit: i.limit, filter: i.filter }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'vector.qdrant.upsert',
    displayName: 'Qdrant Vector Store — Upsert',
    category: 'vector',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'parallel'],
    tags: ['vector', 'qdrant', 'upsert', 'embedding'],
    source: 'src/services/rag/jrx-qdrant-adapter-service.ts',
    factory: fromMethod(
      () => import('../services/rag/jrx-qdrant-adapter-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvVectorStore', 'default']);
        const fn = pickServiceMethod(svc, ['upsert']);
        const i = coerceInput<{ collection: string; vectors: unknown[] }>(input);
        return fn.call(svc, i.collection, i.vectors ?? []) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Intelligence: secure collaboration & regulatory intelligence digest ───
  {
    id: 'intelligence.secure-collaboration',
    displayName: 'Secure Multi-party Collaboration',
    category: 'intelligence',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'high-risk',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['collaboration', 'privileged', 'multi-party', 'security'],
    source: 'src/services/intelligence/jrx-secure-collaboration-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-secure-collaboration-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['nvSecureCollaborationService', 'default']);
        const i = coerceInput<{ op: 'create' | 'join' | 'share' | 'annotate' | 'close' | 'get'; sessionId?: string; matterId?: string; participants?: string[]; userId?: string; inviteToken?: string; document?: unknown; annotation?: unknown }>(input);
        const op = i.op ?? 'create';
        const userId = i.userId ?? ctx.userId ?? 'system';
        if (op === 'create') {
          const fn = pickServiceMethod(svc, ['createSecureSession']);
          return fn.call(svc, i.matterId ?? '', i.participants ?? [], userId) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'join') {
          const fn = pickServiceMethod(svc, ['joinSession']);
          return fn.call(svc, i.sessionId ?? '', userId, i.inviteToken ?? '') as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'share') {
          const fn = pickServiceMethod(svc, ['shareDocument']);
          return fn.call(svc, i.sessionId ?? '', i.document, userId) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'annotate') {
          const fn = pickServiceMethod(svc, ['addPrivilegedAnnotation']);
          return fn.call(svc, i.sessionId ?? '', i.annotation) as Promise<CapabilityInvocationOutput>;
        }
        if (op === 'close') {
          const fn = pickServiceMethod(svc, ['closeSession']);
          return fn.call(svc, i.sessionId ?? '') as Promise<CapabilityInvocationOutput>;
        }
        const fn = pickServiceMethod(svc, ['getSession']);
        return fn.call(svc, i.sessionId ?? '') as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'intelligence.regulatory-digest',
    displayName: 'Regulatory Intelligence — Digest',
    category: 'intelligence',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['regulatory', 'intelligence', 'digest', 'changes'],
    source: 'src/services/intelligence/jrx-regulatory-intelligence-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-regulatory-intelligence-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['nvRegulatoryIntelligenceService', 'default']);
        const fn = pickServiceMethod(svc, ['getRegulatoryDigest']);
        const i = coerceInput<{ jurisdiction?: string; days?: number }>(input);
        return fn.call(svc, i.jurisdiction ?? ctx.jurisdiction ?? 'IN', i.days ?? 7) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'intelligence.compliance-calendar',
    displayName: 'Regulatory Intelligence — Compliance Calendar',
    category: 'intelligence',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['regulatory', 'compliance', 'calendar', 'deadlines'],
    source: 'src/services/intelligence/jrx-regulatory-intelligence-service.ts',
    factory: fromMethod(
      () => import('../services/intelligence/jrx-regulatory-intelligence-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput, ctx: CapabilityContext) => {
        const svc = pickModuleService(mod, ['nvRegulatoryIntelligenceService', 'default']);
        const fn = pickServiceMethod(svc, ['getComplianceCalendar']);
        const i = coerceInput<{ jurisdiction?: string }>(input);
        return fn.call(svc, i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Compliance: EU AI Act ─────────────────────────────────────────────────
  {
    id: 'compliance.eu-ai-act',
    displayName: 'EU AI Act — Conformity Assessment',
    category: 'compliance',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: ['EU', 'UK'],
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['compliance', 'eu-ai-act', 'gpai', 'high-risk'],
    source: 'src/services/eu-ai-act-compliance-service.ts',
    factory: fromMethod(
      () => import('../services/eu-ai-act-compliance-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['euAiActComplianceService', 'default']);
        const fn = pickServiceMethod(svc, ['assessConformity', 'classifySystem', 'getReport', 'evaluate']);
        return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Security: federated privacy & post-quantum primitives ────────────────
  {
    id: 'security.federated-privacy.session',
    displayName: 'Federated Privacy — Session Init',
    category: 'security',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'sequential'],
    tags: ['security', 'federated', 'privacy', 'flwr'],
    source: 'src/services/security/jrx-federated-privacy-service.ts',
    factory: fromMethod(
      () => import('../services/security/jrx-federated-privacy-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvFederatedPrivacyService', 'default']);
        const fn = pickServiceMethod(svc, ['initializeFederatedSession']);
        const i = coerceInput<{ clientId: string; modelType: string }>(input);
        return fn.call(svc, i.clientId, i.modelType) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'security.federated-privacy.aggregate',
    displayName: 'Federated Privacy — Aggregate Gradients',
    category: 'security',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'safe',
    supportedPatterns: ['sequential'],
    tags: ['security', 'federated', 'privacy', 'aggregation', 'dp'],
    source: 'src/services/security/jrx-federated-privacy-service.ts',
    factory: fromMethod(
      () => import('../services/security/jrx-federated-privacy-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvFederatedPrivacyService', 'default']);
        const fn = pickServiceMethod(svc, ['aggregateGradients']);
        const i = coerceInput<{ sessionId: string }>(input);
        return fn.call(svc, i.sessionId) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'security.federated-privacy.dp-noise',
    displayName: 'Federated Privacy — Differential Privacy Noise',
    category: 'security',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'parallel'],
    tags: ['security', 'differential-privacy', 'noise', 'dp'],
    source: 'src/services/security/jrx-federated-privacy-service.ts',
    factory: fromMethod(
      () => import('../services/security/jrx-federated-privacy-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvFederatedPrivacyService', 'default']);
        const fn = pickServiceMethod(svc, ['privatizeAnalytics', 'addDifferentialPrivacyNoise']);
        const i = coerceInput<{ data: Record<string, number>; epsilon?: number }>(input);
        return fn.call(svc, i.data, i.epsilon ?? 1.0) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'security.pqc.kem-keygen',
    displayName: 'PQC — ML-KEM Key Generation',
    category: 'security',
    tiers: ['sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'sovereign',
    supportedPatterns: ['simple'],
    tags: ['security', 'pqc', 'kem', 'ml-kem', 'post-quantum'],
    source: 'src/services/security/jrx-pqc-service.ts',
    factory: fromMethod(
      () => import('../services/security/jrx-pqc-service.js'),
      (mod: LoadedModule) => async () => {
        const svc = pickModuleService(mod, ['nvPqcService', 'default']);
        const fn = pickServiceMethod(svc, ['kemKeygen']);
        return fn.call(svc) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'security.pqc.dsa-sign',
    displayName: 'PQC — ML-DSA Sign',
    category: 'security',
    tiers: ['sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'sovereign',
    supportedPatterns: ['simple'],
    tags: ['security', 'pqc', 'dsa', 'ml-dsa', 'sign', 'post-quantum'],
    source: 'src/services/security/jrx-pqc-service.ts',
    factory: fromMethod(
      () => import('../services/security/jrx-pqc-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvPqcService', 'default']);
        const fn = pickServiceMethod(svc, ['dsaSign']);
        const i = coerceInput<{ message: string | Buffer; secretKey: string | Buffer }>(input);
        const msg = typeof i.message === 'string' ? Buffer.from(i.message) : i.message;
        const sk = typeof i.secretKey === 'string' ? Buffer.from(i.secretKey, 'base64') : i.secretKey;
        return fn.call(svc, msg, sk) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },
  {
    id: 'security.pqc.dsa-verify',
    displayName: 'PQC — ML-DSA Verify',
    category: 'security',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'safe',
    supportedPatterns: ['simple', 'parallel'],
    tags: ['security', 'pqc', 'dsa', 'ml-dsa', 'verify', 'post-quantum'],
    source: 'src/services/security/jrx-pqc-service.ts',
    factory: fromMethod(
      () => import('../services/security/jrx-pqc-service.js'),
      (mod: LoadedModule) => async (input: CapabilityInvocationInput) => {
        const svc = pickModuleService(mod, ['nvPqcService', 'default']);
        const fn = pickServiceMethod(svc, ['dsaVerify']);
        const i = coerceInput<{ message: string | Buffer; signature: string | Buffer; publicKey: string | Buffer }>(input);
        const msg = typeof i.message === 'string' ? Buffer.from(i.message) : i.message;
        const sig = typeof i.signature === 'string' ? Buffer.from(i.signature, 'base64') : i.signature;
        const pk = typeof i.publicKey === 'string' ? Buffer.from(i.publicKey, 'base64') : i.publicKey;
        return fn.call(svc, msg, sig, pk) as Promise<CapabilityInvocationOutput>;
      },
    ),
  },

  // ── Agent orchestration suites: Agent-Chain / BMAD / Parlant ──────────────
  {
    id: 'agent.chain.execute',
    displayName: 'Agent Chain — Execute Composed Pipeline',
    category: 'agent-orchestration',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'medium',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'dag', 'hierarchical', 'cot-with-tools'],
    tags: ['agent', 'chain', 'pipeline', 'composition', 'cot', 'tool-use'],
    sideEffects: 'mixed',
    routeExposure: { transport: 'internal', channel: 'orchestration.agent.chain.execute' },
    source: 'src/services/jrx-orchestration-services.ts:NvAgentChainService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvAgentChain),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ chainId: number; initialInput: string }>(input);
        return svc.executeChain({
          chainId: i.chainId,
          initialInput: i.initialInput,
          userId: ctx.userId ?? 'system',
          tenantId: ctx.tenantId,
        });
      },
    ),
  },
  {
    id: 'agent.bmad.orchestrate',
    displayName: 'BMAD — Behaviour-driven Multi-Agent Decomposition',
    category: 'agent-orchestration',
    tiers: ['enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'high',
    safetyClass: 'review',
    supportedPatterns: ['hierarchical', 'swarm', 'dag', 'collective-debate'],
    tags: ['agent', 'bmad', 'multi-agent', 'orchestration', 'debate'],
    sideEffects: 'mixed',
    routeExposure: { transport: 'internal', channel: 'orchestration.agent.bmad' },
    source: 'src/services/jrx-orchestration-services.ts:NvBMADService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvBMAD),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ templateId: string; requirements: string }>(input);
        return svc.runBMADWorkflow({
          templateId: i.templateId,
          requirements: i.requirements,
          userId: ctx.userId ?? 'system',
          tenantId: ctx.tenantId,
        });
      },
    ),
  },
  {
    id: 'agent.parlant.govern',
    displayName: 'Parlant — Conversation Governance',
    category: 'agent-orchestration',
    tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
    supportedJurisdictions: 'all',
    costClass: 'low',
    safetyClass: 'review',
    supportedPatterns: ['sequential', 'simple'],
    tags: ['agent', 'parlant', 'conversation', 'governance'],
    source: 'src/services/jrx-orchestration-services.ts:NvParlantService',
    factory: fromMethod(
      () => import('../services/jrx-orchestration-services.js').then(m => m.nvParlant),
      (svc) => async (input, ctx) => {
        const i = coerceInput<{ agentKey: string; context?: Record<string, unknown> }>(input);
        return svc.createSession({
          userId: ctx.userId ?? 'system',
          agentKey: i.agentKey,
          context: i.context,
        });
      },
    ),
  },

  // ── Wave B7 — extended service coverage (steps 1+5 inventory pass) ────────
  ...buildExtendedDocumentPipelineCapabilities(),
  ...buildExtendedRagCapabilities(),
  ...buildTestingJudgeCapabilities(),
  ...buildExtendedComplianceCapabilities(),
  ...buildOrchestrationPatternCapabilities(),
  ...buildExtendedIntelligenceCapabilities(),
  ...buildSecurityGovernanceCapabilities(),
  ...buildProtocolMcpCapabilities(),
  ...buildProtocolA2aCapabilities(),
  ...buildSdkSurfaceCapabilities(),
  ...buildSimulationCapabilities(),
  ...buildWorkflowVaultCapabilities(),
];

/**
 * Builder: Nyaya-Tools suite (NyayaAmend / Compare / Forensic / Graph /
 * Template / Timeline / Trail / Watch + Agent Lifecycle).
 * One declarative table; each tool produces a single capability descriptor.
 */
/**
 * NV-NYAYA-TOOLS-BINDING-001 (2026-08-17) — explicit typed adapters.
 *
 * These nine capabilities were previously built from a generic
 * `{ exports, methods }` spec that resolved a service export by name and then
 * called the first matching method with **one object argument**:
 *
 *     fn.call(svc, { ...input, tenantId, userId, jurisdiction })
 *
 * No jrx-legal-tools service implements that interface. Every one of them takes
 * either positional typed arguments (`calculateLimitation(causeOfAction,
 * jurisdiction, eventDate)`) or a specific input interface (`CompareInput`).
 * The generic builder therefore produced two failure modes, verified at
 * runtime with `scripts/jrx-probe-jrx-legal-tools-binding.ts`:
 *
 *  1. **Hard failure (7 of 9)** — the declared method names (`build`, `query`,
 *     `process`, `analyze`, `render`, `record`, `onboard`) exist on no class, so
 *     `pickServiceMethod` threw `[manifest] service missing methods`. Safe but
 *     the capability was simply unavailable to Queen despite being bound to
 *     live intents in `INTENT_CAPABILITY_MAP`.
 *  2. **Silent wrong answer (2 of 9)** — `amend` and `watch` DID resolve a real
 *     method, and were then called with an object where a number or a
 *     jurisdiction string was expected. `assessAmendmentImpact({query:…})`
 *     matched zero rows and returned `impactSeverity: 'low'` with empty
 *     arrays — a plausible-looking "no amendment impact" for a tool that never
 *     ran. That is the more dangerous of the two modes and the reason this is
 *     fixed rather than deleted.
 *
 * Each capability now declares an explicit adapter that maps the Queen's
 * generic leaf input (`{ query, prompt, text, jurisdiction, … }`) onto the real
 * signature, following the same shape as `safety.citation-verify` above.
 * Where a tool genuinely requires an identifier the orchestrator cannot infer
 * (`matterId`, `documentHash`, an event date for a limitation computation), the
 * adapter raises a **structured-input failure** rather than substituting a
 * default. That message is matched by `DEFAULT_RETRY.isRetryable` as a caller
 * bug, so it fails fast without burning breaker budget, and it never invents a
 * legal answer from a missing input.
 */
function buildNyayaToolsCapabilities(): CapabilityDescriptor[] {
  type ToolMeta = {
    id: string;
    displayName: string;
    source: string;
    tags: string[];
    cost: CostClass;
    safety: SafetyClass;
    tiers: CapabilityTier[];
    patterns: ExecutionPattern[];
    factory: CapabilityDescriptor['factory'];
  };

  /**
   * Reject a missing required identifier loudly. The `structured-input
   * failure` prefix is deliberate: `DEFAULT_RETRY.isRetryable` treats it as a
   * caller bug and stops immediately instead of retrying three times.
   */
  const need = <T>(value: T | undefined | null, cap: string, field: string): T => {
    if (value === undefined || value === null
        || (typeof value === 'string' && value.trim() === '')) {
      throw new Error(
        `[CapabilityManifest] structured-input failure: ${cap} requires '${field}' `
        + `and the orchestrator did not supply it`,
      );
    }
    return value;
  };

  /** Queen's leaf input plus the identifiers a caller may pass explicitly. */
  type ToolInput = {
    query?: string;
    prompt?: string;
    text?: string;
    content?: string;
    jurisdiction?: string;
    op?: string;
    days?: number;
    maxHops?: number;
    // Explicit identifiers — only present when a caller supplies them.
    amendmentId?: number;
    statuteId?: string;
    sectionNumber?: string;
    sectionId?: string;
    caseId?: string;
    concept?: string;
    matterId?: string;
    templateId?: string;
    variables?: Record<string, string>;
    document?: string;
    documentHash?: string;
    mimeType?: string;
    fileName?: string;
    sourceText?: string;
    targetText?: string;
    compare?: Record<string, unknown>;
    causeOfAction?: string;
    eventDate?: string;
    caseType?: string;
    court?: string;
    category?: string;
  };

  /** Best available free-text for the request, in preference order. */
  const textOf = (i: ToolInput): string =>
    String(i.query || i.prompt || i.text || i.content || '').trim();

  const jurOf = (i: ToolInput, ctx: CapabilityContext): string =>
    String(ctx.jurisdiction || i.jurisdiction || 'IN');

  const metas: ToolMeta[] = [
    {
      id: 'jrx-legal-tools.amend',
      displayName: 'NyayaAmend — Statute Amendment Tracker',
      source: 'src/services/jrx-legal-tools/jrx-nyayaamend-service.ts',
      tags: ['amendment', 'statute', 'tracking'],
      cost: 'medium', safety: 'review',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel', 'dag'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayaamend-service.js')
          .then(m => m.nvNyayaAmendService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          const jur = jurOf(i, ctx) as Parameters<typeof svc.getRecentAmendments>[0];
          if (typeof i.amendmentId === 'number') {
            return svc.assessAmendmentImpact(i.amendmentId);
          }
          if (i.statuteId && i.sectionNumber) {
            return svc.getTemporalTimeline(i.statuteId, i.sectionNumber, jur);
          }
          // Default: what changed recently in this jurisdiction. Grounding
          // context, and the only variant inferable from a bare prompt.
          return { amendments: await svc.getRecentAmendments(jur, i.days ?? 30) };
        },
      ),
    },
    {
      id: 'jrx-legal-tools.compare',
      displayName: 'NyayaCompare — Document Diff & Compare',
      source: 'src/services/jrx-legal-tools/jrx-nyayacompare-service.ts',
      tags: ['compare', 'diff', 'documents'],
      cost: 'low', safety: 'safe',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel', 'dag', 'simple'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayacompare-service.js')
          .then(m => m.nvNyayaCompareService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          // Two plain texts is the common case and needs no statute ids.
          if (i.sourceText && i.targetText) {
            return {
              diffs: svc.computeDiffs(i.sourceText, i.targetText),
              similarity: svc.computeSimilarity(i.sourceText, i.targetText),
            };
          }
          if (i.statuteId && i.sectionNumber) {
            return { versions: await svc.compareVersions(i.statuteId, i.sectionNumber) };
          }
          const c = (i.compare ?? {}) as Record<string, string>;
          const jur = jurOf(i, ctx);
          return svc.compareSections({
            sourceJurisdiction: need(c.sourceJurisdiction ?? jur, 'jrx-legal-tools.compare', 'sourceJurisdiction'),
            targetJurisdiction: need(c.targetJurisdiction, 'jrx-legal-tools.compare', 'targetJurisdiction'),
            sourceSectionNumber: need(c.sourceSectionNumber, 'jrx-legal-tools.compare', 'sourceSectionNumber'),
            targetSectionNumber: c.targetSectionNumber,
            sourceStatuteId: need(c.sourceStatuteId, 'jrx-legal-tools.compare', 'sourceStatuteId'),
            targetStatuteId: c.targetStatuteId,
          } as Parameters<typeof svc.compareSections>[0]);
        },
      ),
    },
    {
      id: 'jrx-legal-tools.forensic',
      displayName: 'NyayaForensic — Document Forensics',
      source: 'src/services/jrx-legal-tools/jrx-nyayaforensic-service.ts',
      tags: ['forensic', 'integrity', 'audit'],
      cost: 'medium', safety: 'high-risk',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'dag'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayaforensic-service.js')
          .then(m => m.nvNyayaForensicService),
        (svc) => async (input) => {
          const i = coerceInput<ToolInput>(input);
          if (i.documentHash) return svc.verifyChainOfCustody(i.documentHash);
          const content = i.document || i.content || i.text || '';
          // Forensics on an empty document would report a clean verdict on
          // nothing. Refuse instead.
          need(content, 'jrx-legal-tools.forensic', 'document');
          return svc.verifyDocument({
            content,
            mimeType: i.mimeType || 'text/plain',
            fileName: i.fileName,
          });
        },
      ),
    },
    {
      id: 'jrx-legal-tools.graph',
      displayName: 'NyayaGraph — Citation / Entity Graph',
      source: 'src/services/jrx-legal-tools/jrx-nyayagraph-service.ts',
      tags: ['graph', 'citation', 'entities'],
      cost: 'medium', safety: 'safe',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel', 'dag'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayagraph-service.js')
          .then(m => m.nvNyayaGraphService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          // Overruled-case lookup is the highest-value variant: an answer that
          // cites an overruled judgment is confidently wrong.
          if (i.caseId) return { overruledBy: await svc.findOverruledCases(i.caseId) };
          if (i.sectionId) return svc.findCitationChain(i.sectionId, i.maxHops ?? 5);
          const concept = i.concept || textOf(i);
          if (concept) {
            const jur = jurOf(i, ctx) as Parameters<typeof svc.findRelatedConcepts>[1];
            return { relatedConcepts: await svc.findRelatedConcepts(concept, jur) };
          }
          return svc.getGraphStats();
        },
      ),
    },
    {
      id: 'jrx-legal-tools.template',
      displayName: 'NyayaTemplate — Legal Template Generator',
      source: 'src/services/jrx-legal-tools/jrx-nyayatemplate-service.ts',
      tags: ['template', 'generation', 'drafting'],
      cost: 'low', safety: 'review',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'simple'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayatemplate-service.js')
          .then(m => m.nvNyayaTemplateService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          const jur = jurOf(i, ctx) as Parameters<typeof svc.getTemplates>[0];
          if (i.templateId && i.variables) {
            return svc.generateDocument(i.templateId, i.variables, jur);
          }
          if (i.templateId) return svc.getTemplate(i.templateId);
          if (i.document) return svc.scoreEnforceability(i.document, jur);
          // Default: which templates apply here. Useful drafting context.
          return { templates: await svc.getTemplates(jur, i.category) };
        },
      ),
    },
    {
      id: 'jrx-legal-tools.timeline',
      displayName: 'NyayaTimeline — Case Timeline Builder',
      source: 'src/services/jrx-legal-tools/jrx-nyayatimeline-service.ts',
      tags: ['timeline', 'chronology', 'case'],
      cost: 'low', safety: 'safe',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel', 'dag'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayatimeline-service.js')
          .then(m => m.nvNyayaTimelineService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          const jur = jurOf(i, ctx) as Parameters<typeof svc.calculateLimitation>[1];
          if (i.matterId) return svc.getMatterTimeline(i.matterId);
          if (i.caseType && i.court) {
            return svc.getProceduralChecklist(i.caseType, i.court, jur);
          }
          // A limitation period is computed FROM a date. Defaulting that date
          // to "now" would silently produce a wrong deadline, so require it.
          const cause = i.causeOfAction || textOf(i);
          need(cause, 'jrx-legal-tools.timeline', 'causeOfAction');
          const eventDate = need(i.eventDate, 'jrx-legal-tools.timeline', 'eventDate');
          const parsed = new Date(eventDate);
          if (Number.isNaN(parsed.getTime())) {
            throw new Error(
              `[CapabilityManifest] structured-input failure: jrx-legal-tools.timeline `
              + `'eventDate' is not a valid date: ${eventDate}`,
            );
          }
          return svc.calculateLimitation(cause, jur, parsed);
        },
      ),
    },
    {
      id: 'jrx-legal-tools.trail',
      displayName: 'NyayaTrail — Audit Trail',
      source: 'src/services/jrx-legal-tools/jrx-nyayatrail-service.ts',
      tags: ['audit', 'trail', 'evidence'],
      cost: 'free', safety: 'high-risk',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'simple'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayatrail-service.js')
          .then(m => m.nvNyayaTrailService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          // Every trail operation is scoped to a matter. There is no sane
          // default — a privilege log for the wrong matter is a disclosure risk.
          const matterId = need(i.matterId, 'jrx-legal-tools.trail', 'matterId');
          switch (i.op) {
            case 'privilege-log':
              return svc.generatePrivilegeLog(matterId);
            case 'retention':
              return svc.enforceRetention(
                matterId,
                jurOf(i, ctx) as Parameters<typeof svc.enforceRetention>[1],
              );
            case 'closing-report':
              return svc.generateClosingReport(matterId);
            default:
              return svc.classifyMatterDocuments(matterId);
          }
        },
      ),
    },
    {
      id: 'jrx-legal-tools.watch',
      displayName: 'NyayaWatch — Regulatory & Case Watch',
      source: 'src/services/jrx-legal-tools/jrx-nyayawatch-service.ts',
      tags: ['watch', 'monitor', 'alerts', 'regulatory'],
      cost: 'low', safety: 'safe',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-nyayawatch-service.js')
          .then(m => m.nvNyayaWatchService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<ToolInput>(input);
          const jur = jurOf(i, ctx) as Parameters<typeof svc.scanForChanges>[0];
          if (i.statuteId && i.sectionNumber) {
            return svc.checkStatuteValidity(i.statuteId, i.sectionNumber);
          }
          if (i.op === 'digest') return svc.generateDigest(jur, i.days ?? 7);
          return { alerts: await svc.scanForChanges(jur, i.days ?? 7) };
        },
      ),
    },
    {
      id: 'jrx-legal-tools.agent-lifecycle',
      displayName: 'Nyaya Agent Lifecycle Manager',
      source: 'src/services/jrx-legal-tools/jrx-agent-lifecycle-service.ts',
      tags: ['agent', 'lifecycle', 'governance'],
      cost: 'free', safety: 'high-risk',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'simple'],
      factory: fromMethod(
        () => import('../services/jrx-legal-tools/jrx-agent-lifecycle-service.js')
          .then(m => m.nvAgentLifecycleService),
        (svc) => async () => {
          // Read-only by design. `spawn`/`terminate`/`transition` mutate live
          // agent state and must not be reachable from an LLM-authored plan;
          // they stay available to the lifecycle routes under explicit auth.
          return svc.getHealthReport();
        },
      ),
    },
  ];

  return metas.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    category: 'tools',
    tiers: m.tiers,
    supportedJurisdictions: 'all',
    costClass: m.cost,
    safetyClass: m.safety,
    supportedPatterns: m.patterns,
    tags: m.tags,
    source: m.source,
    factory: m.factory,
  }));
}


/**
 * Builder: Enterprise Platform suite (financial/research/web-search/OCR/
 * multimedia/notebook/code-quality/visual-analytics).
 */
function buildEnterprisePlatformCapabilities(): CapabilityDescriptor[] {
  type EpSpec = {
    id: string;
    displayName: string;
    file: string;
    exports: string[];
    methods: string[];
    category: CapabilityCategory;
    tags: string[];
    cost: CostClass;
    safety: SafetyClass;
    tiers: CapabilityTier[];
    patterns: ExecutionPattern[];
  };

  const specs: EpSpec[] = [
    {
      id: 'enterprise.financial-data',
      displayName: 'Real Financial Data',
      file: '../services/enterprise-platform/real-financial-data-service.js',
      exports: ['realFinancialDataService', 'financialDataService'],
      methods: ['fetchData', 'getQuote', 'execute'],
      category: 'tools', tags: ['finance', 'market', 'data'],
      cost: 'medium', safety: 'safe',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel'],
    },
    {
      id: 'enterprise.investment-research',
      displayName: 'Investment Research',
      file: '../services/enterprise-platform/investment-research-service.js',
      exports: ['investmentResearchService'],
      methods: ['research', 'analyze', 'execute'],
      category: 'intelligence', tags: ['investment', 'research', 'finance'],
      cost: 'high', safety: 'review',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'dag'],
    },
    {
      id: 'enterprise.web-search',
      displayName: 'Real Web Search',
      file: '../services/enterprise-platform/real-web-search-service.js',
      exports: ['realWebSearchService', 'webSearchService'],
      methods: ['search', 'query', 'execute'],
      category: 'tools', tags: ['web', 'search', 'retrieval'],
      cost: 'low', safety: 'safe',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel', 'dag'],
    },
    {
      id: 'enterprise.ocr-pipeline',
      displayName: 'Real OCR Pipeline',
      file: '../services/enterprise-platform/real-ocr-pipeline-service.js',
      exports: ['realOcrPipelineService', 'ocrPipelineService'],
      methods: ['recognize', 'extract', 'process'],
      category: 'document-pipeline', tags: ['ocr', 'extraction', 'vision'],
      cost: 'high', safety: 'review',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel'],
    },
    {
      id: 'enterprise.multimedia',
      displayName: 'Real Multimedia Processing',
      file: '../services/enterprise-platform/real-multimedia-api-service.js',
      exports: ['realMultimediaApiService', 'multimediaApiService'],
      methods: ['process', 'transcribe', 'execute'],
      category: 'multimodal', tags: ['multimedia', 'audio', 'video'],
      cost: 'high', safety: 'review',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel'],
    },
    {
      id: 'enterprise.notebook-studio',
      displayName: 'Notebook Document Studio',
      file: '../services/enterprise-platform/notebook-document-studio-service.js',
      exports: ['notebookDocumentStudioService'],
      methods: ['render', 'process', 'execute'],
      category: 'workflow', tags: ['notebook', 'authoring', 'studio'],
      cost: 'medium', safety: 'safe',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'simple'],
    },
    {
      id: 'enterprise.code-quality',
      displayName: 'Code-Quality Gateway',
      file: '../services/enterprise-platform/code-quality-gateway-service.js',
      exports: ['codeQualityGatewayService'],
      methods: ['scan', 'check', 'execute'],
      category: 'compliance', tags: ['code-quality', 'static-analysis', 'security'],
      cost: 'low', safety: 'review',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel'],
    },
    {
      id: 'enterprise.content-asset',
      displayName: 'Content Asset Management',
      file: '../services/enterprise-platform/content-asset-management-service.js',
      exports: ['contentAssetManagementService'],
      methods: ['store', 'fetch', 'list', 'execute'],
      category: 'workflow', tags: ['content', 'assets', 'cms'],
      cost: 'low', safety: 'safe',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'simple'],
    },
    {
      id: 'enterprise.visual-analytics',
      displayName: 'Visual Analytics Dashboard',
      file: '../services/enterprise-platform/visual-analytics-dashboard-service.js',
      exports: ['visualAnalyticsDashboardService'],
      methods: ['render', 'compose', 'execute'],
      category: 'workflow', tags: ['analytics', 'dashboard', 'visualization'],
      cost: 'low', safety: 'safe',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'simple'],
    },
    {
      id: 'enterprise.domain-research',
      displayName: 'Domain Research API',
      file: '../services/enterprise-platform/domain-research-api-service.js',
      exports: ['domainResearchApiService'],
      methods: ['research', 'execute', 'query'],
      category: 'intelligence', tags: ['domain', 'research', 'discovery'],
      cost: 'medium', safety: 'safe',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      patterns: ['sequential', 'parallel'],
    },
  ];

  return specs.map((s) => ({
    id: s.id,
    displayName: s.displayName,
    category: s.category,
    tiers: s.tiers,
    supportedJurisdictions: 'all',
    costClass: s.cost,
    safetyClass: s.safety,
    supportedPatterns: s.patterns,
    tags: s.tags,
    source: s.file,
    factory: fromMethod(
      () => import(s.file),
      (mod: LoadedModule) => async (input, ctx) => {
        const svc = pickModuleService(mod, [...s.exports, 'default']);
        const fn = pickServiceMethod(svc, s.methods);
        return fn.call(svc, { ...input, tenantId: ctx.tenantId, userId: ctx.userId }) as Promise<CapabilityInvocationOutput>;
      },
    ),
  }));
}

/** Wave B7 — document-pipeline leaves not yet in the core manifest. */
function buildExtendedDocumentPipelineCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'docs.embed',
      displayName: 'Text Embedding Generation',
      category: 'document-pipeline',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'parallel'],
      tags: ['embedding', 'vector', 'documents'],
      sideEffects: 'network',
      source: 'src/services/document-pipeline/embedding-service.ts',
      factory: fromMethod(
        () => import('../services/document-pipeline/embedding-service.js'),
        (mod: LoadedModule) => async (input) => {
          const svc = pickModuleService(mod, ['nyayavignyaEmbeddingService', 'default']);
          const fn = pickServiceMethod(svc, ['generateEmbedding', 'generateBatchEmbeddings']);
          const i = coerceInput<{ text?: string; texts?: string[]; model?: string; provider?: string }>(input);
          if (Array.isArray(i.texts) && i.texts.length > 0) {
            return fn.call(svc, { texts: i.texts, model: i.model, provider: i.provider }) as Promise<CapabilityInvocationOutput>;
          }
          if (!i.text) throw new Error('[docs.embed] text or texts is required');
          return fn.call(svc, { text: i.text, model: i.model, provider: i.provider }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'docs.parse',
      displayName: 'Document Parsing (PDF/Office/Image)',
      category: 'document-pipeline',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'parallel', 'dag'],
      tags: ['parsing', 'pdf', 'office', 'extraction'],
      sideEffects: 'write',
      source: 'src/services/document-pipeline/document-parsing-service.ts',
      factory: fromMethod(
        () => import('../services/document-pipeline/document-parsing-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['documentParsingService', 'default']);
          const fn = pickServiceMethod(svc, ['parseDocument', 'parsePDF', 'parseOfficeDocument']);
          const i = coerceInput<{ filePath: string; originalFilename?: string; assistantId?: number }>(input);
          if (!i.filePath) throw new Error('[docs.parse] filePath is required');
          return fn.call(
            svc,
            i.filePath,
            ctx.userId ?? 'system',
            i.originalFilename ?? i.filePath,
            i.assistantId,
          ) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'docs.intelligence',
      displayName: 'Document Intelligence Pipeline',
      category: 'document-pipeline',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['intelligence', 'classification', 'extraction'],
      sideEffects: 'mixed',
      source: 'src/services/document-pipeline/document-intelligence-service.ts',
      factory: fromMethod(
        () => import('../services/document-pipeline/document-intelligence-service.js'),
        (mod: LoadedModule) => async (input) => {
          const svc = pickModuleService(mod, ['documentIntelligenceService', 'default']);
          const fn = pickServiceMethod(svc, ['processDocument', 'searchDocuments']);
          return fn.call(svc, input) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'docs.watermark',
      displayName: 'Document Watermarking',
      category: 'document-pipeline',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['watermark', 'provenance', 'integrity'],
      sideEffects: 'write',
      source: 'src/services/document-pipeline/jrx-watermark-service.ts',
      factory: fromMethod(
        () => import('../services/document-pipeline/jrx-watermark-service.js'),
        (mod: LoadedModule) => async (input) => {
          const svc = pickModuleService(mod, ['nvWatermarkService', 'default']);
          const i = coerceInput<{ document: string | Buffer; metadata: Record<string, unknown>; mode?: string }>(input);
          if (!i.document) throw new Error('[docs.watermark] document buffer is required');
          const buf = typeof i.document === 'string' ? Buffer.from(i.document, 'base64') : i.document;
          const mode = String(i.mode ?? 'dual');
          if (mode === 'invisible') {
            const fn = pickServiceMethod(svc, ['addInvisibleWatermark']);
            return fn.call(svc, buf, i.metadata) as Promise<CapabilityInvocationOutput>;
          }
          if (mode === 'visible') {
            const fn = pickServiceMethod(svc, ['addVisibleWatermark']);
            return fn.call(svc, buf, i.metadata) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['addDualWatermark']);
          return fn.call(svc, buf, i.metadata) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'docs.identity-extract',
      displayName: 'Identity Field Extraction',
      category: 'document-pipeline',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['identity', 'kyc', 'extraction', 'pii'],
      sideEffects: 'network',
      source: 'src/services/identity-extraction-service.ts',
      factory: fromMethod(
        () => import('../services/identity-extraction-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['identityExtractionService', 'default']);
          const fn = pickServiceMethod(svc, ['extractIdentityFields']);
          const i = coerceInput<{ documentId: number; documentType: string; organizationId?: number }>(input);
          if (!i.documentId || !i.documentType) {
            throw new Error('[docs.identity-extract] documentId and documentType are required');
          }
          return fn.call(svc, i.documentId, ctx.userId ?? 'system', i.documentType, i.organizationId) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — RAG embedding leaf. */
function buildExtendedRagCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'rag.embedding',
      displayName: 'Legal Embedding (jurisdiction-aware)',
      category: 'rag',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'parallel'],
      tags: ['embedding', 'rag', 'vector'],
      sideEffects: 'network',
      source: 'src/services/rag/jrx-legal-embedding-service.ts',
      factory: fromMethod(
        () => import('../services/rag/jrx-legal-embedding-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvLegalEmbeddingService', 'default']);
          const i = coerceInput<{ text?: string; texts?: string[]; jurisdiction?: string; domain?: string }>(input);
          const options = { jurisdiction: i.jurisdiction ?? ctx.jurisdiction ?? 'IN', domain: i.domain };
          if (Array.isArray(i.texts) && i.texts.length > 0) {
            const fn = pickServiceMethod(svc, ['embedBatch']);
            return fn.call(svc, i.texts, options) as Promise<CapabilityInvocationOutput>;
          }
          if (!i.text) throw new Error('[rag.embedding] text or texts is required');
          const fn = pickServiceMethod(svc, ['embed']);
          return fn.call(svc, i.text, options) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — testing / judge framework leaves. */
function buildTestingJudgeCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'testing.judge',
      displayName: 'LLM Judge — Legal Response Evaluation',
      category: 'simulation',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['testing', 'judge', 'evaluation', 'quality'],
      sideEffects: 'network',
      source: 'src/services/testing/jrx-llm-judge-service.ts',
      factory: fromMethod(
        () => import('../services/testing/jrx-llm-judge-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvLlmJudgeService', 'default']);
          const fn = pickServiceMethod(svc, ['evaluate']);
          const i = coerceInput<{ response: string; query: string; jurisdiction?: string; domain?: string; judgeModel?: string }>(input);
          if (!i.response || !i.query) throw new Error('[testing.judge] response and query are required');
          return fn.call(svc, i.response, {
            query: i.query,
            jurisdiction: (i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as 'IN',
            domain: (i.domain ?? 'other') as 'other',
          }, i.judgeModel) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'testing.oracle',
      displayName: 'Agent Oracle Test Suite',
      category: 'simulation',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['testing', 'oracle', 'regression', 'agent'],
      sideEffects: 'network',
      source: 'src/services/testing/jrx-agent-testing-framework.ts',
      factory: fromMethod(
        () => import('../services/testing/jrx-agent-testing-framework.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvAgentTestingFramework', 'default']);
          const fn = pickServiceMethod(svc, ['runOracleTests']);
          const i = coerceInput<{ jurisdiction?: string; agentId?: string }>(input);
          return fn.call(svc, (i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as 'IN', i.agentId) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'testing.adversarial',
      displayName: 'Agent Adversarial Test Suite',
      category: 'simulation',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['testing', 'adversarial', 'red-team', 'agent'],
      sideEffects: 'network',
      source: 'src/services/testing/jrx-agent-testing-framework.ts',
      factory: fromMethod(
        () => import('../services/testing/jrx-agent-testing-framework.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvAgentTestingFramework', 'default']);
          const fn = pickServiceMethod(svc, ['runAdversarialTests']);
          const i = coerceInput<{ agentId?: string; jurisdiction?: string }>(input);
          return fn.call(svc, i.agentId, (i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as 'IN') as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'testing.scorecard',
      displayName: 'Agent Quality Scorecard',
      category: 'simulation',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'dag', 'hierarchical'],
      tags: ['testing', 'scorecard', 'benchmark', 'agent'],
      sideEffects: 'network',
      source: 'src/services/testing/jrx-agent-testing-framework.ts',
      factory: fromMethod(
        () => import('../services/testing/jrx-agent-testing-framework.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvAgentTestingFramework', 'default']);
          const fn = pickServiceMethod(svc, ['generateScorecard']);
          const i = coerceInput<{ jurisdiction?: string; agentId?: string }>(input);
          return fn.call(svc, (i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as 'IN', i.agentId) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — compliance leaves beyond consent/export/incident/eu-ai-act. */
function buildExtendedComplianceCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'compliance.bipa-consent',
      displayName: 'IL BIPA Biometric Consent',
      category: 'compliance',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: ['US'],
      costClass: 'low',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['bipa', 'biometric', 'consent', 'privacy'],
      sideEffects: 'write',
      source: 'src/services/compliance/jrx-bipa-consent-service.ts',
      factory: fromMethod(
        () => import('../services/compliance/jrx-bipa-consent-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['bipaConsentService', 'default']);
          const i = coerceInput<{ op?: string; userId?: string; biometricType?: string; disclosureText?: string; purpose?: string; storageTerm?: string }>(input);
          const op = String(i.op ?? 'check');
          const userId = i.userId ?? ctx.userId;
          if (!userId) throw new Error('[compliance.bipa-consent] userId is required');
          if (op === 'grant') {
            const fn = pickServiceMethod(svc, ['grant']);
            if (!i.biometricType || !i.disclosureText || !i.purpose) {
              throw new Error('[compliance.bipa-consent] grant requires biometricType, disclosureText, purpose');
            }
            return fn.call(svc, {
              userId,
              orgId: ctx.tenantId ?? null,
              biometricType: i.biometricType,
              disclosureText: i.disclosureText,
              purpose: i.purpose,
              storageTerm: i.storageTerm,
            }) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['check']);
          if (!i.biometricType) throw new Error('[compliance.bipa-consent] biometricType is required for check');
          return fn.call(svc, userId, i.biometricType) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'compliance.breach-notice',
      displayName: 'Breach Notice Planner',
      category: 'compliance',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['breach', 'incident', 'notification', 'compliance'],
      sideEffects: 'write',
      source: 'src/services/compliance/jrx-breach-notice-service.ts',
      factory: fromMethod(
        () => import('../services/compliance/jrx-breach-notice-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvBreachNoticeService', 'default']);
          const i = coerceInput<{ op?: string; incidentId?: string; orgId?: string; payload?: Record<string, unknown> }>(input);
          const op = String(i.op ?? 'plan');
          const orgId = i.orgId ?? ctx.tenantId ?? 'platform';
          if (op === 'file') {
            const fn = pickServiceMethod(svc, ['fileBreachIncident']);
            return fn.call(svc, { ...(i.payload ?? input), orgId }) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'get') {
            if (!i.incidentId) throw new Error('[compliance.breach-notice] incidentId required for get');
            const fn = pickServiceMethod(svc, ['getBreachIncident']);
            return fn.call(svc, i.incidentId, orgId) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['planNotices']);
          const planInput = i.payload ?? input;
          return fn.call(svc, planInput) as CapabilityInvocationOutput;
        },
      ),
    },
  ];
}

/** Wave B7 — DAG / swarm / CoT pattern sub-orchestrators. */
function buildOrchestrationPatternCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'orchestration.dag.execute',
      displayName: 'DAG Orchestration — Plan + Execute',
      category: 'agent-orchestration',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'review',
      supportedPatterns: ['dag', 'parallel', 'hierarchical'],
      tags: ['dag', 'orchestration', 'parallel', 'plan'],
      sideEffects: 'mixed',
      source: 'src/services/dag-orchestration-service.ts',
      factory: fromMethod(
        () => import('../services/dag-orchestration-service.js').then(m => m.dagOrchestrationService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<{
            op?: string;
            planId?: string;
            planName?: string;
            tasks?: Array<{ id: string; name: string; dependencies: string[]; estimatedTokens?: number }>;
            totalContextBudget?: number;
          }>(input);
          const op = String(i.op ?? 'create');
          if (op === 'execute') {
            if (!i.planId) throw new Error('[orchestration.dag.execute] planId is required for execute');
            return svc.executePlan(i.planId);
          }
          if (!i.planId || !i.tasks?.length) {
            throw new Error('[orchestration.dag.execute] planId and tasks are required for create');
          }
          if (ctx.tier) svc.setTier(ctx.tier);
          svc.setCapabilityContextDefaults({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            jurisdiction: ctx.jurisdiction,
            tier: ctx.tier,
          });
          return svc.createExecutionPlan(
            i.planId,
            i.planName ?? i.planId,
            i.tasks,
            i.totalContextBudget,
          );
        },
      ),
    },
    {
      id: 'orchestration.swarm.topology',
      displayName: 'Swarm Topology Execution',
      category: 'agent-orchestration',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['swarm', 'parallel', 'hierarchical', 'collective-debate'],
      tags: ['swarm', 'topology', 'consensus', 'multi-agent'],
      sideEffects: 'mixed',
      source: 'src/services/jrx-swarm-topology-service.ts',
      factory: fromMethod(
        () => import('../services/jrx-swarm-topology-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvSwarmTopologyService', 'default']);
          const i = coerceInput<{ op?: string; topologyId?: string; query?: string; agents?: string[]; jurisdiction?: string }>(input);
          const op = String(i.op ?? 'execute');
          if (op === 'catalog') {
            const fn = pickServiceMethod(svc, i.query ? ['search'] : ['getAll']);
            return i.query ? fn.call(svc, i.query) : fn.call(svc);
          }
          if (!i.topologyId || !i.query) {
            throw new Error('[orchestration.swarm.topology] topologyId and query are required');
          }
          const fn = pickServiceMethod(svc, ['executeTopology']);
          return fn.call(svc, {
            topologyId: i.topologyId,
            query: i.query,
            agents: i.agents ?? [],
            jurisdiction: i.jurisdiction ?? ctx.jurisdiction ?? 'IN',
            userId: ctx.userId ?? 'system',
          }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'orchestration.cot.reason',
      displayName: 'Chain-of-Thought Reasoning',
      category: 'agent-orchestration',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['cot-with-tools', 'sequential', 'dag'],
      tags: ['cot', 'reasoning', 'chain-of-thought'],
      sideEffects: 'network',
      source: 'src/services/chain-of-thought-service.ts',
      factory: fromMethod(
        () => import('../services/chain-of-thought-service.js').then(m => m.chainOfThoughtService),
        (svc) => async (input) => {
          const i = coerceInput<{ query: string; strategy?: string; domain?: string; maxSteps?: number; verifySteps?: boolean }>(input);
          if (!i.query) throw new Error('[orchestration.cot.reason] query is required');
          const fn = pickServiceMethod(asLoadedService(svc), ['executeReasoning']);
          return fn.call(svc, i.query, i.strategy ?? 'zero_shot_cot', {
            domain: i.domain,
            maxSteps: i.maxSteps,
            verifySteps: i.verifySteps,
          }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — intelligence leaves (summarize, NER, statute verify, doc analyze, feed). */
function buildExtendedIntelligenceCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'intelligence.summarize',
      displayName: 'Legal Document Summarizer',
      category: 'intelligence',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'parallel', 'simple'],
      tags: ['summarize', 'summary', 'legal', 'documents'],
      sideEffects: 'network',
      source: 'src/services/jrx-legal-summarizer-service.ts',
      factory: fromMethod(
        () => import('../services/jrx-legal-summarizer-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvLegalSummarizerService', 'default']);
          const fn = pickServiceMethod(svc, ['summarize']);
          const i = coerceInput<{ text: string; jurisdiction?: string; level?: string; audience?: string; docType?: string; maxLength?: number }>(input);
          if (!i.text) throw new Error('[intelligence.summarize] text is required');
          return fn.call(svc, i.text, {
            level: (i.level ?? 'executive') as 'executive',
            audience: (i.audience ?? 'lawyer') as 'lawyer',
            jurisdiction: (i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as 'IN',
            docType: (i.docType ?? 'other') as 'other',
            maxWords: i.maxLength,
          }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'intelligence.ner',
      displayName: 'Legal Named-Entity Recognition',
      category: 'intelligence',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'parallel'],
      tags: ['ner', 'entities', 'extraction', 'legal'],
      sideEffects: 'network',
      source: 'src/services/jrx-legal-ner-v2-service.ts',
      factory: fromMethod(
        () => import('../services/jrx-legal-ner-v2-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvLegalNerV2Service', 'default']);
          const fn = pickServiceMethod(svc, ['extractEntities']);
          const i = coerceInput<{ text: string; jurisdiction?: string }>(input);
          if (!i.text) throw new Error('[intelligence.ner] text is required');
          return fn.call(svc, i.text, (i.jurisdiction ?? ctx.jurisdiction ?? 'IN') as 'IN') as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'intelligence.statute-verify',
      displayName: 'Statute Citation Verification',
      category: 'intelligence',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'parallel', 'qa'],
      tags: ['citation', 'statute', 'verification', 'grounding'],
      sideEffects: 'read',
      source: 'src/services/jrx-citation-verification-service.ts',
      factory: fromMethod(
        () => import('../services/jrx-citation-verification-service.js'),
        (mod: LoadedModule) => async (input) => {
          const svc = pickModuleService(mod, ['nvCitationVerificationService', 'default']);
          const fn = pickServiceMethod(svc, ['verify']);
          const i = coerceInput<{ text: string; eventDate?: string }>(input);
          if (!i.text) throw new Error('[intelligence.statute-verify] text is required');
          const eventDate = i.eventDate ? new Date(i.eventDate) : undefined;
          return fn.call(svc, i.text, eventDate) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'intelligence.doc-analyze',
      displayName: 'Legal Document Risk Analysis',
      category: 'intelligence',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['analysis', 'risk', 'contracts', 'documents'],
      sideEffects: 'network',
      source: 'src/services/legal-doc-analyze-service.ts',
      factory: fromMethod(
        () => import('../services/legal-doc-analyze-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['legalDocAnalyzeService', 'default']);
          const fn = pickServiceMethod(svc, ['analyzeDocument']);
          const i = coerceInput<{ text: string; pageCount?: number; options?: Record<string, unknown> }>(input);
          if (!i.text) throw new Error('[intelligence.doc-analyze] text is required');
          return fn.call(svc, i.text, i.pageCount ?? 1, i.options ?? {}, ctx.tenantId ?? 'platform') as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'intelligence.legal-feed',
      displayName: 'Daily Legal Intelligence Feed',
      category: 'intelligence',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'parallel'],
      tags: ['feed', 'intelligence', 'regulatory', 'news'],
      sideEffects: 'read',
      source: 'src/services/jrx-legal-intelligence-feed-service.ts',
      factory: fromMethod(
        () => import('../services/jrx-legal-intelligence-feed-service.js'),
        (mod: LoadedModule) => async (input) => {
          const svc = pickModuleService(mod, ['legalIntelligenceFeedService', 'default']);
          const i = coerceInput<{ op?: string; jurisdiction?: string; limit?: number; orgId?: string }>(input);
          const op = String(i.op ?? 'get');
          if (op === 'generate') {
            const fn = pickServiceMethod(svc, ['generateDailyLegalIntelligenceFeed']);
            return fn.call(svc, { jurisdiction: i.jurisdiction, topN: i.limit, orgId: i.orgId }) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'list') {
            const fn = pickServiceMethod(svc, ['listLegalIntelligenceFeeds']);
            return fn.call(svc, { limit: i.limit, orgId: i.orgId }) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['getLegalIntelligenceFeed']);
          return fn.call(svc, { jurisdiction: i.jurisdiction, orgId: i.orgId }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — RBAC, maker-checker, HITL workflow. */
function buildSecurityGovernanceCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'security.rbac.check',
      displayName: 'RBAC Access Check',
      category: 'security',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['rbac', 'authorization', 'access'],
      sideEffects: 'read',
      source: 'src/services/rbac/rbac-service.ts',
      factory: fromMethod(
        () => import('../services/rbac/rbac-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['rbacService', 'default']);
          const fn = pickServiceMethod(svc, ['checkAccess']);
          const i = coerceInput<{ userId: string; role: string; resource: string; action: string; orgId?: string }>(input);
          if (!i.userId || !i.role || !i.resource || !i.action) {
            throw new Error('[security.rbac.check] userId, role, resource, action are required');
          }
          return fn.call(svc, {
            userId: i.userId,
            role: i.role,
            orgId: i.orgId ?? ctx.tenantId,
          }, i.resource, i.action) as CapabilityInvocationOutput;
        },
      ),
    },
    {
      id: 'workflow.maker-checker',
      displayName: 'Maker-Checker Human Review Loop',
      category: 'workflow',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'hierarchical'],
      tags: ['maker-checker', 'human-review', 'approval'],
      sideEffects: 'write',
      source: 'src/services/maker-checker-service.ts',
      factory: fromMethod(
        () => import('../services/maker-checker-service.js'),
        (mod: LoadedModule) => async (input) => {
          const svc = pickModuleService(mod, ['makerCheckerService', 'default']);
          const fn = pickServiceMethod(svc, ['runLoop']);
          const i = coerceInput<{ prompt: string; context?: Record<string, unknown>; config?: Record<string, unknown> }>(input);
          if (!i.prompt) throw new Error('[workflow.maker-checker] prompt is required');
          return fn.call(svc, i.prompt, { context: i.context, config: i.config }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'hitl.workflow',
      displayName: 'HITL Workflow Execution',
      category: 'hitl',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'hierarchical'],
      tags: ['hitl', 'workflow', 'approval', 'human'],
      sideEffects: 'write',
      source: 'src/services/hitl-workflow-service.ts',
      factory: fromMethod(
        () => import('../services/hitl-workflow-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['hitlWorkflowService', 'default']);
          const i = coerceInput<{ op?: string; workflowId?: string; ownerId?: string; executionId?: string; payload?: Record<string, unknown> }>(input);
          const op = String(i.op ?? 'start');
          if (op === 'resolve') {
            const fn = pickServiceMethod(svc, ['resolveOrCreatePlatformOrchestrateWorkflow']);
            return fn.call(svc, i.ownerId ?? ctx.userId ?? 'system') as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'get') {
            if (!i.executionId) throw new Error('[hitl.workflow] executionId required for get');
            const fn = pickServiceMethod(svc, ['getExecution']);
            return fn.call(svc, i.executionId) as Promise<CapabilityInvocationOutput>;
          }
          if (!i.workflowId) throw new Error('[hitl.workflow] workflowId is required for start');
          const fn = pickServiceMethod(svc, ['startExecution']);
          return fn.call(svc, {
            workflowId: i.workflowId,
            initiatedBy: ctx.userId ?? 'system',
            ...(i.payload ?? input),
          }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — MCP connector invoke leaf. */
function buildProtocolMcpCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'protocol.mcp.invoke',
      displayName: 'MCP Connector Invoke',
      category: 'protocol',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'cot-with-tools'],
      tags: ['mcp', 'connector', 'protocol', 'tools'],
      sideEffects: 'network',
      source: 'src/services/mcp/jrx-mcp-connector-service.ts',
      factory: fromMethod(
        () => import('../services/mcp/jrx-mcp-connector-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['nvMcpConnectorService', 'default']);
          const i = coerceInput<{ connectorId?: string; toolId?: string; action?: string; input?: Record<string, unknown> }>(input);
          if (i.toolId) {
            const fn = pickServiceMethod(svc, ['invokeForTool']);
            return fn.call(svc, i.toolId, i.input ?? {}, ctx.tenantId ?? 'platform') as Promise<CapabilityInvocationOutput>;
          }
          if (!i.connectorId || !i.action) {
            throw new Error('[protocol.mcp.invoke] connectorId+action or toolId is required');
          }
          const fn = pickServiceMethod(svc, ['invoke']);
          return fn.call(svc, i.connectorId, i.action, i.input ?? {}, ctx.tenantId ?? 'platform') as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** A2A collaboration bus — existing protocol, Queen-schedulable via INTENT. */
function buildProtocolA2aCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'protocol.a2a.handoff',
      displayName: 'A2A — Agent-to-Agent Handoff',
      category: 'protocol',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'swarm', 'hierarchical'],
      tags: ['a2a', 'handoff', 'protocol', 'agent'],
      sideEffects: 'mixed',
      routeExposure: { transport: 'internal', channel: 'orchestration.protocol.a2a.handoff' },
      source: 'src/packages/protocols/a2a-collaboration-bus.ts',
      factory: fromMethod(
        () => import('../packages/protocols/a2a-collaboration-bus.js').then((m) => m.getSharedA2ABus()),
        (bus) => async (input, ctx) => {
          const i = coerceInput<{
            fromAgent?: string;
            toAgent?: string;
            action?: string;
            taskId?: string;
            summary?: string;
          }>(input);
          const fromAgent = String(i.fromAgent || ctx.agentKey || 'queen');
          const toAgent = String(i.toAgent || 'specialist');
          try {
          const result = await bus.sendMessage({
            id: `a2a-${Date.now()}`,
            type: 'handoff',
            fromAgent,
            toAgent,
            payload: {
              action: String(i.action || 'agent_handoff'),
              data: {
                taskId: i.taskId || ctx.requestId || 'queen',
                contentSummary: String(i.summary || '').slice(0, 500),
                tenantId: ctx.tenantId,
                userId: ctx.userId,
              },
            },
            metadata: {
              priority: 'normal',
              category: 'queen_intent_handoff',
              tags: ['a2a', fromAgent, toAgent],
              correlationId: ctx.requestId,
              conversationId: ctx.requestId,
            },
            routing: {
              path: [fromAgent],
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
              encryptionLevel: 'basic',
              accessLevel: 'internal',
            },
            timestamp: new Date(),
          });
          return { fromAgent, toAgent, status: result?.status ?? 'delivered', result };
          } catch (err) {
            return {
              fromAgent,
              toAgent,
              status: 'degraded',
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
      ),
    },
  ];
}

/** Wave B7 — SDK surface leaves for partner tier exposure. */
function buildSdkSurfaceCapabilities(): CapabilityDescriptor[] {
  const sdkCtx = (ctx: CapabilityContext) => ({
    orgId: ctx.tenantId ? Number(ctx.tenantId) : 0,
    userId: ctx.userId ?? 'system',
    tier: ctx.tier ?? 'enterprise',
    jurisdiction: ctx.jurisdiction ?? 'IN',
  });

  return [
    {
      id: 'sdk.application',
      displayName: 'SDK Application Registry',
      category: 'protocol',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['sdk', 'application', 'partner'],
      sideEffects: 'write',
      source: 'src/services/sdk/sdk-application-service.ts',
      factory: fromMethod(
        () => import('../services/sdk/sdk-application-service.js').then(m => m.sdkApplicationService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<{ op?: string; appId?: number; orgId?: number; input?: Record<string, unknown> }>(input);
          const op = String(i.op ?? 'list');
          const orgId = i.orgId ?? Number(ctx.tenantId ?? 0);
          if (op === 'create') {
            const fn = pickServiceMethod(svc, ['createApplication']);
            return fn.call(svc, i.input ?? input) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'get' && i.appId) {
            const fn = pickServiceMethod(svc, ['getApplicationById']);
            return fn.call(svc, i.appId, orgId) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['getApplicationsByOrg']);
          return fn.call(svc, orgId) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'sdk.document-pipeline',
      displayName: 'SDK Document Pipeline',
      category: 'document-pipeline',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['sdk', 'documents', 'pipeline'],
      sideEffects: 'mixed',
      source: 'src/services/sdk/sdk-document-pipeline-service.ts',
      factory: fromMethod(
        () => import('../services/sdk/sdk-document-pipeline-service.js').then(m => m.sdkDocumentPipelineService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<{
            op?: string;
            content?: string;
            format?: string;
            jurisdiction?: string;
            language?: string;
            documentA?: string;
            documentB?: string;
            textA?: string;
            textB?: string;
            prompt?: string;
            compareTypes?: string[];
            text?: string;
          }>(input);
          const op = String(i.op ?? 'pipeline');
          const sctx = sdkCtx(ctx);
          if (op === 'extract') {
            const fn = pickServiceMethod(svc, ['extractContent']);
            return fn.call(svc, { ...(input as object), ...sctx }) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'parse') {
            const fn = pickServiceMethod(svc, ['parseDocument']);
            if (!i.content || !i.format) throw new Error('[sdk.document-pipeline] content and format required for parse');
            return fn.call(svc, i.content, i.format, i.jurisdiction ?? sctx.jurisdiction, i.language ?? 'en', sctx) as Promise<CapabilityInvocationOutput>;
          }
          // Doc A/B compare (NOT jrx-legal-tools.compare which is statute-section compare)
          if (op === 'compare') {
            const a = String(i.documentA || i.textA || '').trim();
            const b = String(i.documentB || i.textB || '').trim();
            if (!a || !b) {
              throw new Error('[sdk.document-pipeline] documentA/textA and documentB/textB required for compare');
            }
            const types = Array.isArray(i.compareTypes) && i.compareTypes.length
              ? i.compareTypes.map(String)
              : ['clause', 'semantic'];
            const fn = pickServiceMethod(svc, ['compareDocuments']);
            return fn.call(svc, a, b, types, sctx) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'classify') {
            const text = String(i.content || i.text || i.prompt || '').trim();
            if (!text) throw new Error('[sdk.document-pipeline] content/text required for classify');
            const fn = pickServiceMethod(svc, ['extractContent']);
            return fn.call(svc, { ...(input as object), content: text, op: 'classify', ...sctx }) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['runFullPipeline']);
          return fn.call(svc, input, sctx) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'sdk.multimodal-voice',
      displayName: 'SDK Multimodal Voice',
      category: 'multimodal',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'parallel'],
      tags: ['sdk', 'voice', 'multimodal', 'vision'],
      sideEffects: 'network',
      source: 'src/services/sdk/sdk-multimodal-voice-service.ts',
      factory: fromMethod(
        () => import('../services/sdk/sdk-multimodal-voice-service.js').then(m => m.sdkMultimodalVoiceService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<{ op?: string; text?: string; query?: string; language?: string; jurisdiction?: string }>(input);
          const op = String(i.op ?? 'capabilities');
          const sctx = sdkCtx(ctx);
          if (op === 'capabilities') {
            const fn = pickServiceMethod(svc, ['getCapabilities']);
            return fn.call(svc) as CapabilityInvocationOutput;
          }
          if (op === 'synthesize') {
            const fn = pickServiceMethod(svc, ['synthesizeSpeech']);
            if (!i.text) throw new Error('[sdk.multimodal-voice] text required for synthesize');
            return fn.call(svc, i.text, i.language ?? 'en', undefined, 1, 'mp3', sctx) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'rag') {
            const fn = pickServiceMethod(svc, ['queryMultimodalRAG']);
            if (!i.query) throw new Error('[sdk.multimodal-voice] query required for rag');
            return fn.call(svc, i.query, ['text'], i.jurisdiction ?? sctx.jurisdiction, 5, sctx) as Promise<CapabilityInvocationOutput>;
          }
          throw new Error(`[sdk.multimodal-voice] unknown op: ${op}`);
        },
      ),
    },
    {
      id: 'sdk.workflow-protocol',
      displayName: 'SDK Workflow Protocol',
      category: 'workflow',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'dag', 'hierarchical'],
      tags: ['sdk', 'workflow', 'protocol', 'agui'],
      sideEffects: 'mixed',
      source: 'src/services/sdk/sdk-workflow-protocol-service.ts',
      factory: fromMethod(
        () => import('../services/sdk/sdk-workflow-protocol-service.js').then(m => m.sdkWorkflowProtocolService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<{ op?: string; workflowId?: string; name?: string; goal?: string; message?: string }>(input);
          const op = String(i.op ?? 'list');
          const sctx = sdkCtx(ctx);
          if (op === 'execute') {
            if (!i.workflowId) throw new Error('[sdk.workflow-protocol] workflowId required');
            const fn = pickServiceMethod(svc, ['executeWorkflow']);
            return fn.call(svc, i.workflowId, input, 'sync', sctx) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'autonomous') {
            if (!i.goal) throw new Error('[sdk.workflow-protocol] goal required');
            const fn = pickServiceMethod(svc, ['startAutonomousExecution']);
            return fn.call(svc, i.goal, {}, 5, sctx) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'parlant') {
            if (!i.message) throw new Error('[sdk.workflow-protocol] message required');
            const fn = pickServiceMethod(svc, ['interactParlant']);
            return fn.call(svc, i.message, undefined, {}, [], sctx) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(svc, ['listWorkflows']);
          return fn.call(svc, 'active', 1, 20, sctx) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'sdk.usage-metering',
      displayName: 'SDK Usage Metering',
      category: 'metering',
      tiers: ['mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['sdk', 'metering', 'usage', 'billing'],
      sideEffects: 'read',
      source: 'src/services/sdk/sdk-usage-metering-service.ts',
      factory: fromMethod(
        () => import('../services/sdk/sdk-usage-metering-service.js').then(m => m.sdkUsageMeteringService),
        (svc) => async (input, ctx) => {
          const i = coerceInput<{ op?: string; applicationId?: number; organizationId?: number; days?: number }>(input);
          const op = String(i.op ?? 'org');
          if (op === 'app') {
            if (!i.applicationId) throw new Error('[sdk.usage-metering] applicationId required');
            const fn = pickServiceMethod(svc, ['getUsageSummary']);
            return fn.call(svc, i.applicationId, 'daily', i.days ?? 30) as Promise<CapabilityInvocationOutput>;
          }
          const orgId = i.organizationId ?? Number(ctx.tenantId ?? 0);
          const fn = pickServiceMethod(svc, ['getOrganizationUsage']);
          return fn.call(svc, orgId, i.days ?? 30) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — GRPO + verbalized sampling simulation leaves. */
function buildSimulationCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'simulation.grpo',
      displayName: 'GRPO Policy Optimization',
      category: 'simulation',
      tiers: ['sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'high',
      safetyClass: 'sovereign',
      supportedPatterns: ['swarm', 'parallel', 'collective-debate'],
      tags: ['grpo', 'optimization', 'policy', 'rl'],
      sideEffects: 'network',
      source: 'src/services/grpo-optimization-service.ts',
      factory: fromMethod(
        () => import('../services/grpo-optimization-service.js').then(m => m.grpoOptimizationService),
        (svc) => async (input) => {
          const loaded = asLoadedService(svc);
          const i = coerceInput<{ op?: string; prompt?: string; context?: string; chosen?: string; rejected?: string; responses?: Array<{ content: string; metadata?: Record<string, unknown> }> }>(input);
          const op = String(i.op ?? 'evaluate');
          if (op === 'generate') {
            if (!i.prompt) throw new Error('[simulation.grpo] prompt required');
            const fn = pickServiceMethod(loaded, ['generateAndEvaluate']);
            return fn.call(svc, i.prompt, i.context) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'optimize') {
            const fn = pickServiceMethod(loaded, ['optimizePolicy']);
            return fn.call(svc) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'preference') {
            if (!i.prompt || !i.chosen || !i.rejected) {
              throw new Error('[simulation.grpo] prompt, chosen, rejected required');
            }
            const fn = pickServiceMethod(loaded, ['addPreferencePair']);
            return fn.call(svc, i.prompt, i.chosen, i.rejected) as Promise<CapabilityInvocationOutput>;
          }
          if (!i.prompt) throw new Error('[simulation.grpo] prompt required for evaluate');
          if (!Array.isArray(i.responses) || i.responses.length === 0) {
            const fn = pickServiceMethod(loaded, ['generateAndEvaluate']);
            return fn.call(svc, i.prompt, i.context) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(loaded, ['evaluateGroup']);
          return fn.call(svc, i.prompt, i.responses) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'simulation.verbalized-sampling',
      displayName: 'Verbalized Sampling Analysis',
      category: 'simulation',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'cot-with-tools'],
      tags: ['sampling', 'confidence', 'calibration', 'cot'],
      sideEffects: 'network',
      source: 'src/services/verbalized-sampling-service.ts',
      factory: fromMethod(
        () => import('../services/verbalized-sampling-service.js').then(m => m.verbalizedSamplingService),
        (svc) => async (input) => {
          const loaded = asLoadedService(svc);
          const i = coerceInput<{ op?: string; prompt?: string; options?: Array<Record<string, unknown>>; context?: string; score?: number; domain?: string }>(input);
          const op = String(i.op ?? 'analyze');
          if (op === 'cot') {
            if (!i.prompt) throw new Error('[simulation.verbalized-sampling] prompt required');
            const fn = pickServiceMethod(loaded, ['generateChainOfThought']);
            return fn.call(svc, i.prompt, i.context) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'verbalize') {
            const fn = pickServiceMethod(loaded, ['verbalizeConfidence']);
            return fn.call(svc, i.score ?? 0.5, i.domain) as CapabilityInvocationOutput;
          }
          if (!i.prompt || !Array.isArray(i.options)) {
            throw new Error('[simulation.verbalized-sampling] prompt and options[] required');
          }
          const fn = pickServiceMethod(loaded, ['analyzeSamplingOptions']);
          return fn.call(svc, i.prompt, i.options) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'agent.persona',
      displayName: 'Agent Persona Registry',
      category: 'agent-orchestration',
      tiers: ['lite', 'mitra', 'enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'free',
      safetyClass: 'safe',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['persona', 'agent', 'tone', 'platform'],
      sideEffects: 'read',
      source: 'src/services/agent-persona-service.ts',
      factory: fromMethod(
        () => import('../services/agent-persona-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const svc = pickModuleService(mod, ['agentPersonaService', 'default']);
          const i = coerceInput<{ op?: string; agentKey?: string; platform?: string; timeOfDay?: string }>(input);
          const op = String(i.op ?? 'get');
          if (op === 'list') {
            const fn = pickServiceMethod(svc, ['listAllPersonas']);
            return fn.call(svc) as CapabilityInvocationOutput;
          }
          if (!i.agentKey) throw new Error('[agent.persona] agentKey required');
          if (op === 'prompt') {
            const getFn = pickServiceMethod(svc, ['getPersona', 'getBasePersona']);
            const persona = await getFn.call(svc, i.agentKey, ctx.tenantId ?? 'platform') as CapabilityInvocationOutput;
            const fn = pickServiceMethod(svc, ['buildPersonaSystemPrompt']);
            return fn.call(svc, persona, i.timeOfDay) as CapabilityInvocationOutput;
          }
          const fn = pickServiceMethod(svc, ['getPersona', 'getBasePersona']);
          return fn.call(svc, i.agentKey, ctx.tenantId ?? 'platform') as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

/** Wave B7 — matter vault + webhook dispatch workflow leaves. */
function buildWorkflowVaultCapabilities(): CapabilityDescriptor[] {
  return [
    {
      id: 'workflow.matter-vault',
      displayName: 'Matter Vault — Case Document Vault',
      category: 'workflow',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'medium',
      safetyClass: 'high-risk',
      supportedPatterns: ['sequential', 'dag'],
      tags: ['matter', 'vault', 'case', 'documents'],
      sideEffects: 'write',
      source: 'src/services/jrx-matter-vault-service.ts',
      factory: fromMethod(
        () => import('../services/jrx-matter-vault-service.js'),
        (mod: LoadedModule) => async (input, ctx) => {
          const i = coerceInput<{ op?: string; vaultId?: string; orgId?: string; input?: Record<string, unknown> }>(input);
          const op = String(i.op ?? 'list');
          const orgId = i.orgId ?? ctx.tenantId;
          if (op === 'create') {
            const fn = pickServiceMethod(mod as LoadedService, ['createMatterVault']);
            return fn.call(mod, i.input ?? input) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'get') {
            if (!i.vaultId) throw new Error('[workflow.matter-vault] vaultId required');
            const fn = pickServiceMethod(mod as LoadedService, ['getMatterVault']);
            return fn.call(mod, i.vaultId, orgId) as Promise<CapabilityInvocationOutput>;
          }
          if (op === 'playbook') {
            if (!i.vaultId) throw new Error('[workflow.matter-vault] vaultId required');
            const fn = pickServiceMethod(mod as LoadedService, ['runMatterVaultPlaybook']);
            return fn.call(mod, i.vaultId, i.input ?? input) as Promise<CapabilityInvocationOutput>;
          }
          const fn = pickServiceMethod(mod as LoadedService, ['listMatterVaults']);
          return fn.call(mod, orgId) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
    {
      id: 'queue.webhook.dispatch',
      displayName: 'Webhook Delivery Dispatch',
      category: 'protocol',
      tiers: ['enterprise', 'sovereign', 'white-label'],
      supportedJurisdictions: 'all',
      costClass: 'low',
      safetyClass: 'review',
      supportedPatterns: ['sequential', 'simple'],
      tags: ['webhook', 'queue', 'dispatch', 'integration'],
      sideEffects: 'network',
      source: 'src/services/queue/webhook-dispatcher.ts',
      factory: fromMethod(
        () => import('../services/queue/webhook-dispatcher.js'),
        (mod: LoadedModule) => async (input) => {
          const fn = pickServiceMethod(mod as LoadedService, ['dispatchWebhook']);
          const i = coerceInput<{ url: string; payload?: Record<string, unknown>; headers?: Record<string, string> }>(input);
          if (!i.url) throw new Error('[queue.webhook.dispatch] url is required');
          return fn.call(mod, { url: i.url, payload: i.payload ?? {}, headers: i.headers ?? {} }) as Promise<CapabilityInvocationOutput>;
        },
      ),
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Registry API
// ──────────────────────────────────────────────────────────────────────────────

class CapabilityManifest {
  private readonly byId = new Map<string, CapabilityDescriptor>();
  private readonly byCategory = new Map<CapabilityCategory, CapabilityDescriptor[]>();
  private readonly instances = new Map<string, CapabilityInstance>();

  constructor(seed: CapabilityDescriptor[]) {
    for (const cap of seed) this.register(cap);
    logger.info('[CapabilityManifest] initialized', {
      total: this.byId.size,
      categories: Array.from(this.byCategory.keys()),
    });
  }

  register(cap: CapabilityDescriptor): void {
    if (this.byId.has(cap.id)) {
      logger.warn('[CapabilityManifest] duplicate capability id, overwriting', { id: cap.id });
    }
    this.byId.set(cap.id, cap);
    const arr = this.byCategory.get(cap.category) ?? [];
    arr.push(cap);
    this.byCategory.set(cap.category, arr);
  }

  list(opts: CapabilityResolveOptions = {}): CapabilityDescriptor[] {
    const all = Array.from(this.byId.values());
    return all.filter((c) => {
      if (opts.tier && !c.tiers.includes(opts.tier)) return false;
      if (opts.category && c.category !== opts.category) return false;
      if (opts.pattern && !c.supportedPatterns.includes(opts.pattern)) return false;
      if (opts.jurisdiction && c.supportedJurisdictions !== 'all'
        && !c.supportedJurisdictions.includes(opts.jurisdiction)) return false;
      if (opts.tags && opts.tags.length > 0) {
        const hit = opts.tags.some((t) => c.tags.includes(t));
        if (!hit) return false;
      }
      return true;
    });
  }

  get(id: string): CapabilityDescriptor | undefined {
    return this.byId.get(id);
  }

  /** Resolve a bound implementation. Caches instances after first load. */
  async resolve(id: string): Promise<CapabilityInstance> {
    const cached = this.instances.get(id);
    if (cached) return cached;
    const cap = this.byId.get(id);
    if (!cap) throw new Error(`[CapabilityManifest] unknown capability: ${id}`);
    const inst = await cap.factory();
    if (!inst || typeof inst.invoke !== 'function') {
      throw new Error(`[CapabilityManifest] capability ${id} factory returned invalid instance`);
    }
    this.instances.set(id, inst);
    return inst;
  }

  /**
   * Convenience: resolve + invoke + best-effort metering.
   *
   * JRX-CB-INVOKE-001 (Task #32 round 4): every outbound capability call now
   * goes through the shared circuit-breaker policy `outbound:capability` so
   * misbehaving services trip a uniform breaker instead of silently retrying.
   */
  async invoke(id: string, input: CapabilityInvocationInput, ctx: CapabilityContext): Promise<CapabilityInvocationOutput> {
    const cap = this.byId.get(id);
    if (!cap) throw new Error(`[CapabilityManifest] unknown capability: ${id}`);
    if (ctx.tier && !cap.tiers.includes(ctx.tier)) {
      throw new Error(`[CapabilityManifest] capability ${id} not exposed to tier ${ctx.tier}`);
    }
    if (ctx.jurisdiction && cap.supportedJurisdictions !== 'all'
        && !cap.supportedJurisdictions.includes(ctx.jurisdiction)) {
      throw new Error(`[CapabilityManifest] capability ${id} not enabled in jurisdiction ${ctx.jurisdiction}`);
    }
    const inst = await this.resolve(id);

    const { runWithRetryAndBreaker } = await import('../services/circuit-breaker.js');
    const { withSlots } = await import('./concurrency-governor.js');
    const breakerName = `cap:${id}`;
    // JRX-CB-RETRY-001 / NV-COMPLETION-DRIVEN-001: every capability invocation
    // flows through the SAME shared breaker + retry helper. Retries fire on
    // ECONN* / 502-504 only. Timeouts and aborts are NOT retried (one hang
    // must not become 3× the breaker budget). Caller bugs fail immediately.
    // Per-tenant + per-provider concurrency caps wrap the whole thing —
    // workloads in the same category (provider=cap.category) share an
    // upstream budget so one category cannot starve another for an
    // entire tenant or globally.
    return withSlots(
      { tenantId: ctx.tenantId, provider: cap.category },
      () => runWithRetryAndBreaker<CapabilityInvocationOutput>(
        breakerName,
        () => {
          if (ctx.signal?.aborted) {
            throw new Error('The operation was aborted');
          }
          return inst.invoke(input, ctx);
        },
        'outbound:capability',
      ),
    );
  }

  /** Used by SDK auto-init to expose the per-tier capability surface. */
  capabilitiesForTier(tier: CapabilityTier): CapabilityDescriptor[] {
    return this.list({ tier });
  }
}

export function mapCapabilityTierToSkillTier(t: CapabilityTier): 'solo' | 'plus' | 'pro' | 'enterprise' {
  switch (t) {
    case 'lite': return 'solo';
    case 'mitra': return 'plus';
    case 'enterprise': return 'pro';
    case 'sovereign': return 'enterprise';
    case 'white-label': return 'enterprise';
  }
}

export function mapBillingTierToCapabilityTier(t: string): CapabilityTier {
  switch ((t ?? '').toLowerCase()) {
    case 'free':
    case 'starter':
    case 'solo':
      return 'lite';
    case 'professional':
    case 'plus':
      return 'mitra';
    case 'pro':
    case 'enterprise':
      return 'enterprise';
    case 'elite':
    case 'internal':
    case 'superadmin':
    case 'super_admin':
    case 'sovereign':
    case 'government':
      return 'sovereign';
    case 'white-label':
    case 'whitelabel':
      return 'white-label';
    default:
      return 'lite';
  }
}

export const capabilityManifest = new CapabilityManifest(CAPABILITIES);
export default capabilityManifest;

// ──────────────────────────────────────────────────────────────────────────────
// Deterministic intent → capability map (Task #32). Queen resolves bindings
// via this table before any heuristic; PROD throws on unbound subtasks.
// ──────────────────────────────────────────────────────────────────────────────

export interface IntentCapabilityBinding {
  /** Lowercased intent label. Matched against subtask.type and requiredCapabilities. */
  intent: string;
  /** Capability ids in priority order; first permitted one wins. */
  capabilityIds: readonly string[];
  /** Audit rationale. */
  rationale: string;
}

/** Wave B6 Mesh v1 — high-value leaves Queen schedules by intent. */
export const WAVE_B6_MESH_LEAF_IDS = [
  'templates.catalog',
  'templates.generate',
  'digital_twin.simulate',
  'digital-twin.simulate',
  'clm.playbook',
  'clm.lifecycle',
  'efiling.steps',
  'e-filing.submit',
  'intelligence.precedent',
] as const;

export type WaveB6MeshLeafId = (typeof WAVE_B6_MESH_LEAF_IDS)[number];

/** Wave B7 — extended service-coverage leaves (inventory pass steps 1+5). */
export const WAVE_B7_EXTENDED_LEAF_IDS = [
  'docs.embed',
  'docs.parse',
  'docs.intelligence',
  'docs.watermark',
  'docs.identity-extract',
  'rag.embedding',
  'testing.judge',
  'testing.oracle',
  'testing.adversarial',
  'testing.scorecard',
  'compliance.bipa-consent',
  'compliance.breach-notice',
  'orchestration.dag.execute',
  'orchestration.swarm.topology',
  'orchestration.cot.reason',
  'intelligence.summarize',
  'intelligence.ner',
  'intelligence.statute-verify',
  'intelligence.doc-analyze',
  'intelligence.legal-feed',
  'security.rbac.check',
  'workflow.maker-checker',
  'hitl.workflow',
  'protocol.mcp.invoke',
  'sdk.application',
  'sdk.document-pipeline',
  'sdk.multimodal-voice',
  'sdk.workflow-protocol',
  'sdk.usage-metering',
  'simulation.grpo',
  'simulation.verbalized-sampling',
  'agent.persona',
  'workflow.matter-vault',
  'queue.webhook.dispatch',
] as const;

export type WaveB7ExtendedLeafId = (typeof WAVE_B7_EXTENDED_LEAF_IDS)[number];

const WAVE_B6_MESH_LEAF_SET: ReadonlySet<string> = new Set(WAVE_B6_MESH_LEAF_IDS);
const WAVE_B7_EXTENDED_LEAF_SET: ReadonlySet<string> = new Set(WAVE_B7_EXTENDED_LEAF_IDS);

/** True when `id` is one of the nine Wave B6 high-value mesh leaves. */
export function isWaveB6MeshLeaf(id: string): id is WaveB6MeshLeafId {
  return WAVE_B6_MESH_LEAF_SET.has(id);
}

/** True when `id` is one of the Wave B7 extended inventory leaves. */
export function isWaveB7ExtendedLeaf(id: string): id is WaveB7ExtendedLeafId {
  return WAVE_B7_EXTENDED_LEAF_SET.has(id);
}

export const INTENT_CAPABILITY_MAP: readonly IntentCapabilityBinding[] = [
  // ── Decomposer subtask types ──────────────────────────────────────────────
  { intent: 'understanding',         capabilityIds: ['rag.search', 'memory.tiered.recall'],            rationale: 'Initial understanding draws from RAG + memory.' },
  { intent: 'goal_definition',       capabilityIds: ['rag.search', 'memory.tiered.recall'],            rationale: 'Goal framing uses retrieved context.' },
  { intent: 'planning',              capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'Planning routes to the agent selector.' },
  { intent: 'design',                capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'Design phase uses agent + retrieval.' },
  { intent: 'initial_attempt',       capabilityIds: ['agent.auto-select'],                                rationale: 'Pick best agent for direct attempt.' },
  { intent: 'direct_execution',      capabilityIds: ['agent.auto-select'],                                rationale: 'Single-agent simple path.' },
  { intent: 'domain_specific',       capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'Domain handler with retrieval.' },
  // ADaPT domain name tokens (requiredCapabilities) — must resolve into core caps
  { intent: 'technology',            capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'ADaPT technology domain → agent+RAG.' },
  { intent: 'creative',              capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'ADaPT creative domain → agent+RAG.' },
  { intent: 'legal',                 capabilityIds: ['agent.auto-select', 'rag.search', 'safety.citation-verify'], rationale: 'ADaPT legal domain → agent+RAG+citation.' },
  { intent: 'finance',               capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'ADaPT finance domain.' },
  { intent: 'healthcare',            capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'ADaPT healthcare domain.' },
  { intent: 'constraint_resolution', capabilityIds: ['agent.auto-select'],                                rationale: 'Constraint solver via agent.' },
  { intent: 'implementation',        capabilityIds: ['tools.execute', 'agent.auto-select'],               rationale: 'Implementation invokes tools.' },
  { intent: 'testing',               capabilityIds: ['tools.execute', 'safety.hallucination-check'],    rationale: 'Test phase validates output.' },
  { intent: 'quality_check',         capabilityIds: ['safety.hallucination-check', 'safety.bias-check', 'agent.auto-select'], rationale: 'QA stage runs safety checks; auto-select soft-fallback.' },
  { intent: 'review',                capabilityIds: ['safety.hallucination-check', 'safety.bias-check', 'agent.auto-select'], rationale: 'Review uses safety pipeline; auto-select soft-fallback.' },
  { intent: 'integration',           capabilityIds: ['agent.auto-select'],                                rationale: 'Integration delegates to agent synthesis.' },
  { intent: 'deployment',            capabilityIds: ['compliance.consent', 'metering.usage-log'],       rationale: 'Deployment requires consent + usage record.' },
  // Prefer agent.auto-select so swarm leaves generate answers; RAG is injected
  // as context by Queen executeAgent (retrieval-only caps fall through to LLM).
  { intent: 'swarm_exploration',     capabilityIds: ['agent.auto-select', 'rag.search'],                  rationale: 'Swarm worker: reason via auto-select; RAG as grounding.' },
  { intent: 'swarm_aggregation',     capabilityIds: ['agent.auto-select'],                                rationale: 'Aggregator picks best agent.' },
  { intent: 'brainstorm',            capabilityIds: ['agent.auto-select'],                                rationale: 'Brainstorming uses generator agent.' },
  { intent: 'consensus',             capabilityIds: ['agent.auto-select', 'safety.hallucination-check'],  rationale: 'Consensus synthesizes + validates.' },
  { intent: 'debate',                capabilityIds: ['agent.auto-select'],                                rationale: 'Debate spawns competing agents.' },

  // ── requiredCapabilities tokens ───────────────────────────────────────────
  { intent: 'analysis',           capabilityIds: ['rag.search', 'agent.auto-select'],                          rationale: 'Analysis pulls evidence + reasons.' },
  { intent: 'research',           capabilityIds: ['rag.search', 'memory.tiered.recall'],                     rationale: 'Research = retrieval first.' },
  { intent: 'synthesis',          capabilityIds: ['agent.auto-select'],                                        rationale: 'Synthesis = generator agent.' },
  { intent: 'qa',                 capabilityIds: ['safety.hallucination-check', 'safety.citation-verify', 'agent.auto-select'],   rationale: 'QA runs grounding checks; auto-select soft-fallback.' },
  { intent: 'quality',            capabilityIds: ['safety.hallucination-check', 'safety.bias-check'],         rationale: 'Quality gates use safety stack.' },
  { intent: 'verification',       capabilityIds: ['safety.citation-verify', 'safety.hallucination-check'],   rationale: 'Verification = citation + grounding.' },
  { intent: 'citation',           capabilityIds: ['safety.citation-verify'],                                  rationale: 'Direct citation handling.' },
  { intent: 'compliance',         capabilityIds: ['compliance.consent', 'compliance.export'],                rationale: 'Compliance ops.' },
  { intent: 'consent',            capabilityIds: ['compliance.consent'],                                      rationale: 'Consent capability.' },
  { intent: 'incident',           capabilityIds: ['compliance.incident'],                                     rationale: 'Incident reporting.' },
  { intent: 'audit',              capabilityIds: ['compliance.export', 'metering.usage-log'],                 rationale: 'Audit ops.' },
  { intent: 'memory',             capabilityIds: ['memory.tiered.recall', 'memory.tiered.store'],            rationale: 'Memory access.' },
  { intent: 'rag',                capabilityIds: ['rag.search'],                                              rationale: 'Direct RAG.' },
  { intent: 'tool',               capabilityIds: ['tools.execute'],                                           rationale: 'Sandboxed tool exec.' },
  { intent: 'tools',              capabilityIds: ['tools.execute'],                                           rationale: 'Sandboxed tool exec.' },
  // Wave B6 Mesh v1: high-value leaf aliases driven by prompt hints / Queen binding.
  // Each keyword maps to the first matching capability in the list that is in the candidate set.
  { intent: 'template',           capabilityIds: ['templates.generate', 'templates.catalog', 'jrx-legal-tools.template'], rationale: 'Template requests should bind to live template leaves.' },
  { intent: 'templates',          capabilityIds: ['templates.catalog', 'templates.generate'],                 rationale: 'Templates (plural) → catalog first.' },
  { intent: 'catalog',            capabilityIds: ['templates.catalog'],                                       rationale: 'Catalog/list requests should bind to the catalog leaf.' },
  { intent: 'generate',           capabilityIds: ['templates.generate'],                                      rationale: 'Explicit generate + templateId → catalog fill; freeform draft uses agents.' },
  // NV-LEGAL-DRAFT-BEST-001: do NOT bind freeform "draft/drafting" to templates.generate
  // (fill-only → blanks). Queen / specialist drafting agents + gateway draftDocument
  // own freeform instruments; use intent "template"/"generate" when a catalog id is known.
  { intent: 'twin',               capabilityIds: ['digital_twin.simulate', 'twindesk.simulate', 'digital-twin.simulate'], rationale: 'Twin/simulation requests should bind to the simulation leaves.' },
  { intent: 'digital_twin',       capabilityIds: ['digital_twin.simulate', 'digital-twin.simulate'],         rationale: 'Explicit digital_twin → simulation leaves.' },
  { intent: 'simulation',         capabilityIds: ['digital_twin.simulate', 'twindesk.simulate', 'digital-twin.simulate'], rationale: 'Simulation requests → twin leaves.' },
  { intent: 'twindesk',           capabilityIds: ['twindesk.simulate', 'twindesk.chat'],                      rationale: 'TwinDesk requests → persona twins.' },
  { intent: 'persona',            capabilityIds: ['twindesk.simulate', 'twindesk.chat'],                      rationale: 'Persona requests → TwinDesk twins.' },
  { intent: 'filing',             capabilityIds: ['efiling.steps', 'e-filing.submit'],                       rationale: 'Filing requests should bind to the e-filing workflow leaf.' },
  { intent: 'e-filing',           capabilityIds: ['efiling.steps', 'e-filing.submit'],                       rationale: 'E-filing requests → filing workflow.' },
  { intent: 'efiling',            capabilityIds: ['efiling.steps', 'e-filing.submit'],                       rationale: 'Efiling (no hyphen) → filing workflow.' },
  { intent: 'submit',             capabilityIds: ['e-filing.submit', 'efiling.steps'],                       rationale: 'Court submission requests → e-filing submit leaf.' },
  { intent: 'court',              capabilityIds: ['efiling.steps', 'e-filing.submit'],                       rationale: 'Court requests → e-filing workflow.' },
  { intent: 'playbook',           capabilityIds: ['clm.playbook', 'workflow.contract-playbook'],             rationale: 'Playbook requests should bind to the CLM playbook leaf.' },
  { intent: 'contract_lifecycle', capabilityIds: ['clm.lifecycle', 'clm.playbook', 'workflow.contract-playbook'], rationale: 'Contract lifecycle requests should bind to the CLM lifecycle leaf.' },
  { intent: 'contract',           capabilityIds: ['clm.lifecycle', 'clm.playbook'],                          rationale: 'Contract requests → CLM leaves.' },
  { intent: 'clm',                capabilityIds: ['clm.lifecycle', 'clm.playbook'],                          rationale: 'CLM requests → contract lifecycle.' },
  { intent: 'lifecycle',          capabilityIds: ['clm.lifecycle'],                                          rationale: 'Lifecycle requests → CLM lifecycle.' },
  // NV-INDIAN-STRUCTURE-001 — NSP research/draft/chat intent aliases (Queen analyzePrompt hints).
  { intent: 'statute-research',   capabilityIds: ['intelligence.statute-verify', 'rag.search'], rationale: 'Statute lookup/research → statute verify + RAG.' },
  { intent: 'caselaw-research', capabilityIds: ['intelligence.precedent', 'intelligence.precedent-similarity'], rationale: 'Caselaw research → precedent intelligence.' },
  { intent: 'precedent-research', capabilityIds: ['intelligence.precedent', 'intelligence.precedent-similarity'], rationale: 'Precedent analog/distinguish research.' },
  { intent: 'draft',              capabilityIds: ['agent.auto-select', 'safety.citation-verify'], rationale: 'Freeform Indian drafting — specialist agents, not template fill-only.' },
  // NV-LEGAL-DRAFT-AGENTIC-001 — Tier D1 agentic draft: plan→research→draft→self-validate.
  { intent: 'draft_agentic',      capabilityIds: ['agent.auto-select', 'rag.search', 'intelligence.precedent', 'intelligence.statute-verify', 'safety.citation-verify'], rationale: 'Agentic draft loop: plan, then precedent+statute+RAG research, specialist draft, citation self-validate.' },
  { intent: 'draft-agentic',      capabilityIds: ['agent.auto-select', 'rag.search', 'intelligence.precedent', 'intelligence.statute-verify', 'safety.citation-verify'], rationale: 'Hyphen alias for the agentic draft loop.' },
  { intent: 'legal-chat',         capabilityIds: ['agent.auto-select', 'rag.search', 'safety.citation-verify'], rationale: 'Partner legal-chat-fast counsel Q&A.' },
  { intent: 'contract_review',    capabilityIds: ['intelligence.doc-analyze', 'clm.lifecycle'], rationale: 'Contract review / clause risk analysis.' },
  { intent: 'citation_check',     capabilityIds: ['safety.citation-verify', 'intelligence.statute-verify'], rationale: 'Citation verification / proposition gate.' },
  { intent: 'precedent',          capabilityIds: ['intelligence.precedent', 'intelligence.precedent-similarity'], rationale: 'Precedent research should bind to the precedent intelligence leaf.' },
  { intent: 'case_law',           capabilityIds: ['intelligence.precedent', 'intelligence.precedent-similarity'], rationale: 'Case law requests → precedent intelligence.' },
  { intent: 'case-law',           capabilityIds: ['intelligence.precedent', 'intelligence.precedent-similarity'], rationale: 'Case-law requests → precedent intelligence.' },
  { intent: 'caselaw',            capabilityIds: ['intelligence.precedent', 'intelligence.precedent-similarity'], rationale: 'Caselaw requests → precedent intelligence.' },
  { intent: 'pii',                capabilityIds: ['safety.pii-vault'],                                        rationale: 'PII tokenization.' },
  { intent: 'privacy',            capabilityIds: ['safety.pii-vault', 'compliance.consent'],                 rationale: 'Privacy safety.' },
  { intent: 'governance',         capabilityIds: ['governance.model-policy', 'compliance.export'],            rationale: 'Governance enforcement.' },
  { intent: 'metering',           capabilityIds: ['metering.usage-log'],                                      rationale: 'Usage logging.' },
  { intent: 'feedback',           capabilityIds: ['feedback.submit'],                                         rationale: 'User feedback.' },
  { intent: 'explainability',     capabilityIds: ['safety.explainability'],                                   rationale: 'XAI trace.' },
  // Wave B7 — extended inventory intent aliases
  { intent: 'judge',              capabilityIds: ['testing.judge'],                                           rationale: 'LLM judge evaluation.' },
  { intent: 'oracle',             capabilityIds: ['testing.oracle'],                                          rationale: 'Agent oracle regression suite.' },
  { intent: 'adversarial',        capabilityIds: ['testing.adversarial'],                                     rationale: 'Agent adversarial red-team suite.' },
  { intent: 'scorecard',          capabilityIds: ['testing.scorecard'],                                       rationale: 'Agent quality scorecard.' },
  { intent: 'summarize',          capabilityIds: ['intelligence.summarize'],                                  rationale: 'Legal summarization.' },
  { intent: 'summary',            capabilityIds: ['intelligence.summarize'],                                  rationale: 'Legal summarization.' },
  { intent: 'ner',                capabilityIds: ['intelligence.ner'],                                        rationale: 'Legal NER extraction.' },
  { intent: 'entities',           capabilityIds: ['intelligence.ner'],                                        rationale: 'Legal entity extraction.' },
  { intent: 'embedding',          capabilityIds: ['rag.embedding', 'docs.embed'],                             rationale: 'Text/legal embedding generation.' },
  { intent: 'embed',              capabilityIds: ['rag.embedding', 'docs.embed'],                             rationale: 'Embedding generation.' },
  { intent: 'watermark',          capabilityIds: ['docs.watermark'],                                          rationale: 'Document watermarking.' },
  { intent: 'bipa',               capabilityIds: ['compliance.bipa-consent'],                                 rationale: 'IL BIPA biometric consent.' },
  { intent: 'breach',             capabilityIds: ['compliance.breach-notice', 'compliance.incident'],         rationale: 'Breach notice planning.' },
  { intent: 'dag',                capabilityIds: ['orchestration.dag.execute'],                               rationale: 'DAG plan execution.' },
  { intent: 'swarm',              capabilityIds: ['orchestration.swarm.topology'],                            rationale: 'Swarm topology execution.' },
  { intent: 'cot',                capabilityIds: ['orchestration.cot.reason'],                                rationale: 'Chain-of-thought reasoning.' },
  { intent: 'chain_of_thought',   capabilityIds: ['orchestration.cot.reason'],                                rationale: 'Chain-of-thought reasoning.' },
  { intent: 'mcp',                capabilityIds: ['protocol.mcp.invoke'],                                     rationale: 'MCP connector invoke.' },
  { intent: 'rbac',               capabilityIds: ['security.rbac.check'],                                     rationale: 'RBAC authorization gate.' },
  { intent: 'maker_checker',      capabilityIds: ['workflow.maker-checker'],                                  rationale: 'Maker-checker human review loop.' },
  { intent: 'maker-checker',      capabilityIds: ['workflow.maker-checker'],                                  rationale: 'Maker-checker human review loop.' },
  { intent: 'hitl_workflow',      capabilityIds: ['hitl.workflow', 'hitl.queue'],                             rationale: 'HITL workflow execution.' },
  { intent: 'matter_vault',       capabilityIds: ['workflow.matter-vault'],                                  rationale: 'Matter vault case documents.' },
  { intent: 'matter-vault',       capabilityIds: ['workflow.matter-vault'],                                   rationale: 'Matter vault case documents.' },
  { intent: 'persona',            capabilityIds: ['agent.persona', 'twindesk.chat'],                          rationale: 'Agent persona registry.' },
  { intent: 'grpo',               capabilityIds: ['simulation.grpo'],                                         rationale: 'GRPO policy optimization.' },
  { intent: 'verbalized_sampling', capabilityIds: ['simulation.verbalized-sampling'],                         rationale: 'Verbalized sampling analysis.' },
  { intent: 'sdk',                capabilityIds: ['sdk.application', 'sdk.document-pipeline'],                rationale: 'SDK surface leaves.' },
  { intent: 'webhook',            capabilityIds: ['queue.webhook.dispatch'],                                  rationale: 'Outbound webhook dispatch.' },
  { intent: 'doc_analyze',        capabilityIds: ['intelligence.doc-analyze'],                                rationale: 'Legal document risk analysis.' },
  { intent: 'doc-analyze',        capabilityIds: ['intelligence.doc-analyze'],                                rationale: 'Legal document risk analysis.' },
  { intent: 'document_analyze',   capabilityIds: ['intelligence.doc-analyze'],                                rationale: 'Legal document risk analysis.' },
  { intent: 'ocr',                capabilityIds: ['docs.ocr', 'enterprise.ocr-pipeline'],                     rationale: 'OCR / Got-OCR document text extraction.' },
  { intent: 'parse',              capabilityIds: ['docs.parse', 'docs.parse-legal', 'docs.process'],          rationale: 'Document parse / legal parse.' },
  { intent: 'parsing',            capabilityIds: ['docs.parse', 'docs.parse-legal'],                          rationale: 'Document parsing.' },
  // Doc A/B compare → sdk.document-pipeline; statute section compare stays jrx-legal-tools.compare
  { intent: 'compare',            capabilityIds: ['sdk.document-pipeline', 'jrx-legal-tools.compare'],            rationale: 'Doc A/B via SDK pipeline; statute section via jrx-legal-tools.compare.' },
  { intent: 'comparison',         capabilityIds: ['sdk.document-pipeline', 'jrx-legal-tools.compare'],            rationale: 'Document comparison.' },
  { intent: 'diff',               capabilityIds: ['sdk.document-pipeline', 'jrx-legal-tools.compare'],            rationale: 'Document diff / redline compare.' },
  { intent: 'statute_compare',    capabilityIds: ['jrx-legal-tools.compare'],                                     rationale: 'Statute/IPC-BNS section compare only.' },
  { intent: 'classify',           capabilityIds: ['intelligence.doc-analyze', 'workflow.email-classify'],     rationale: 'Legal doc classify first; email classify secondary.' },
  { intent: 'classification',     capabilityIds: ['intelligence.doc-analyze', 'workflow.email-classify'],     rationale: 'Document classification.' },
  { intent: 'multilingual',       capabilityIds: ['intelligence.summarize', 'sdk.multimodal-voice'],          rationale: 'Multilingual legal processing.' },
  { intent: 'language',           capabilityIds: ['intelligence.summarize', 'sdk.multimodal-voice'],          rationale: 'Language / translation assist.' },
  { intent: 'translate',          capabilityIds: ['intelligence.summarize'],                                  rationale: 'Translation via summarize+language router.' },
  { intent: 'multimodal',         capabilityIds: ['sdk.multimodal-voice'],                                    rationale: 'Multimodal voice / vision leaf.' },
  { intent: 'voice',              capabilityIds: ['sdk.multimodal-voice'],                                    rationale: 'Voice synthesize / STT leaf.' },
  { intent: 'statute_verify',     capabilityIds: ['intelligence.statute-verify', 'safety.citation-verify'],   rationale: 'Statute citation verification.' },
  { intent: 'legal_feed',         capabilityIds: ['intelligence.legal-feed', 'intelligence.regulatory-watch'], rationale: 'Legal intelligence feed (own RSS/S3/RDS — no Tavily).' },
  { intent: 'instant_search',     capabilityIds: ['rag.search', 'intelligence.legal-feed'], rationale: 'Instant Search / statute-caselaw typeahead cohesion.' },
  // ── High-value leaves that already had factories (Replit-era) but lacked INTENT aliases ──
  { intent: 'automateai',         capabilityIds: ['automateai.workflow'],                                     rationale: 'AutomateAI workflow leaf.' },
  { intent: 'workflow_bot',       capabilityIds: ['automateai.workflow'],                                     rationale: 'Workflow automation bot.' },
  { intent: 'openbot',            capabilityIds: ['openbot.receive', 'openbot.send'],                         rationale: 'OpenBot receive/send.' },
  { intent: 'clawdbot',           capabilityIds: ['clawdbot.crawl'],                                          rationale: 'ClawdBot crawl leaf.' },
  { intent: 'crawl',              capabilityIds: ['clawdbot.crawl'],                                          rationale: 'Crawl via ClawdBot.' },
  { intent: 'bmad',               capabilityIds: ['agent.bmad.orchestrate'],                                  rationale: 'BMAD behavioural orchestration.' },
  { intent: 'a2a',                capabilityIds: ['protocol.a2a.handoff'],                                    rationale: 'A2A agent-to-agent handoff.' },
  { intent: 'agent_to_agent',     capabilityIds: ['protocol.a2a.handoff'],                                    rationale: 'A2A agent-to-agent handoff.' },
  { intent: 'handoff',            capabilityIds: ['protocol.a2a.handoff'],                                    rationale: 'A2A task handoff.' },
  { intent: 'amend',              capabilityIds: ['jrx-legal-tools.amend'],                                       rationale: 'Nyaya-tools amend.' },
  { intent: 'forensic',           capabilityIds: ['jrx-legal-tools.forensic'],                                    rationale: 'Nyaya-tools forensic.' },
  { intent: 'timeline',           capabilityIds: ['jrx-legal-tools.timeline'],                                    rationale: 'Nyaya-tools timeline.' },
  { intent: 'trail',              capabilityIds: ['jrx-legal-tools.trail'],                                       rationale: 'Nyaya-tools audit trail.' },
  { intent: 'watch',              capabilityIds: ['jrx-legal-tools.watch'],                                       rationale: 'Nyaya-tools regulatory watch.' },
  { intent: 'graph',              capabilityIds: ['jrx-legal-tools.graph', 'rag.graph'],                          rationale: 'Knowledge graph / GraphRAG.' },
  { intent: 'graphrag',           capabilityIds: ['rag.graph'],                                               rationale: 'GraphRAG retrieval leaf.' },
  { intent: 'rag_graph',          capabilityIds: ['rag.graph'],                                               rationale: 'GraphRAG retrieval leaf.' },
  { intent: 'web_search',         capabilityIds: ['enterprise.web-search'],                                   rationale: 'Enterprise web search.' },
  { intent: 'websearch',          capabilityIds: ['enterprise.web-search'],                                   rationale: 'Enterprise web search.' },
  { intent: 'notebook',           capabilityIds: ['enterprise.notebook-studio'],                              rationale: 'Enterprise notebook studio.' },
  { intent: 'financial',          capabilityIds: ['enterprise.financial-data'],                               rationale: 'Enterprise financial data.' },
  { intent: 'multimedia',         capabilityIds: ['enterprise.multimedia'],                                   rationale: 'Enterprise multimedia.' },
  { intent: 'domain_research',    capabilityIds: ['enterprise.domain-research'],                              rationale: 'Enterprise domain research.' },
  { intent: 'document_pipeline',  capabilityIds: ['sdk.document-pipeline'],                                   rationale: 'SDK full document pipeline.' },
  // ── A1 Wave: top inventory leaves → INTENT (2026-07-30) ──
  { intent: 'rerank',             capabilityIds: ['rag.reranker'],                                            rationale: 'Neural / cross-encoder rerank.' },
  { intent: 'reranker',           capabilityIds: ['rag.reranker'],                                            rationale: 'Neural / cross-encoder rerank.' },
  { intent: 'corrective_rag',     capabilityIds: ['rag.corrective'],                                          rationale: 'Corrective RAG loop.' },
  { intent: 'adaptive_rag',       capabilityIds: ['rag.adaptive'],                                            rationale: 'Adaptive RAG routing.' },
  { intent: 'self_rag',           capabilityIds: ['rag.self'],                                                rationale: 'Self-RAG reflection.' },
  { intent: 'lightrag',           capabilityIds: ['rag.lightrag'],                                            rationale: 'LightRAG leaf.' },
  { intent: 'mem0',               capabilityIds: ['memory.mem0.recall', 'memory.mem0.store'],                 rationale: 'Mem0 durable memory.' },
  { intent: 'mem0_recall',        capabilityIds: ['memory.mem0.recall'],                                       rationale: 'Mem0 recall.' },
  { intent: 'social_memory',      capabilityIds: ['memory.social.context'],                                   rationale: 'Social memory context.' },
  { intent: 'docs_intelligence',  capabilityIds: ['docs.intelligence'],                                       rationale: 'Document intelligence leaf.' },
  { intent: 'doc_intelligence',   capabilityIds: ['docs.intelligence'],                                       rationale: 'Document intelligence leaf.' },
  { intent: 'compliance_calendar', capabilityIds: ['intelligence.compliance-calendar'],                       rationale: 'Compliance calendar intelligence.' },
  { intent: 'bulk_analysis',      capabilityIds: ['workflow.bulk-analysis'],                                  rationale: 'Bulk document analysis workflow.' },
  { intent: 'calendar_extract',   capabilityIds: ['workflow.calendar-extract'],                               rationale: 'Calendar extraction workflow.' },
  { intent: 'workflow_protocol',  capabilityIds: ['sdk.workflow-protocol'],                                   rationale: 'SDK workflow protocol.' },
  { intent: 'usage_metering',     capabilityIds: ['sdk.usage-metering', 'metering.usage-log'],                rationale: 'SDK / platform usage metering.' },
  { intent: 'agent_lifecycle',    capabilityIds: ['jrx-legal-tools.agent-lifecycle'],                             rationale: 'Nyaya-tools agent lifecycle.' },
  { intent: 'openbot_send',       capabilityIds: ['openbot.send'],                                            rationale: 'OpenBot outbound send.' },
  { intent: 'general',            capabilityIds: ['agent.auto-select'],                                          rationale: 'Generic catch-all.' },
] as const;

const INTENT_INDEX: Map<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>();
  for (const b of INTENT_CAPABILITY_MAP) m.set(b.intent.toLowerCase(), b.capabilityIds);
  return m;
})();

/** Returns the first declared capability for any intent token that is in the candidate set. */
export function resolveIntentToCapability(
  intentTokens: readonly string[],
  candidateIds: ReadonlySet<string>,
): { capabilityId: string; matchedIntent: string } | null {
  for (const tokenRaw of intentTokens) {
    const token = (tokenRaw ?? '').toLowerCase();
    if (!token) continue;
    const ids = INTENT_INDEX.get(token);
    if (!ids) continue;
    for (const id of ids) {
      if (candidateIds.has(id)) {
        return { capabilityId: id, matchedIntent: token };
      }
    }
  }
  return null;
}

/** Returns the declared capability list for an intent, or null. */
export function getDeclaredCapabilitiesForIntent(intent: string): readonly string[] | null {
  return INTENT_INDEX.get(intent.toLowerCase()) ?? null;
}
