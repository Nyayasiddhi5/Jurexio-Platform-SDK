/**
 * NV-LLM-ROUTING-POLICY-001 — Partner legal quality cascade (NSP/NYM).
 *
 * Partner best-outcome cascade (2026-08-14 Bedrock-default):
 *   Bedrock (us-east-1 → ap-south-1) → Gemini 3.x → OpenRouter paid / direct → :free → AgentZero
 *
 * Escape JRX_PARTNER_LEGAL_PREMIUM_FIRST=1 to try Claude/Gemini APIs before Bedrock.

 * Task-class: extract/summarize stay Nova-fast on Bedrock.
 * Speculative catalog ids only when JRX_LLM_ALLOW_SPECULATIVE=1.
 *
 * Indian legal default: Bedrock Claude (us-east-1) then Gemini 3.x; OpenRouter/direct last.
 */
import type { ModelEntry, RouterRequest, TaskKind, TierLevel } from '../services/intelligent-router/router-types.js';
import { getModel, isProviderAvailable } from '../services/intelligent-router/model-catalog.js';
import { getLlmCascadeGeminiOverride, getLlmCascadeLeadOverride, getPartnerLegalPremiumLeadIds } from './jrx-llm-cascade-config.js';
import { isLlmCostProfileActive } from './jrx-llm-cost-profile.js';
import { isPartnerExplicitFastAlias } from '../utils/jrx-partner-platform.js';
import { resolveDraftDocumentType } from './jrx-draft-length-registry.js';
import { isTransactionalDraftDocumentType } from '../services/jrx-indian-draft-structure-registry.js';
import {
  getBedrockClaudeDeepIds,
  getBedrockClaudeFastIds,
  getBedrockSlaFastLegalIds,
} from './jrx-bedrock-claude55-policy.js';

export type LlmAggregatorId = 'bedrock' | 'openrouter' | 'direct';

export interface PlatformRoutingOverride {
  /** Lead aggregator for this platform (default bedrock). */
  primaryAggregator?: LlmAggregatorId;
  /** Model ids prepended when aggregator is bedrock (optional; task-class leads preferred). */
  bedrockLeadModels?: string[];
  /** Skip direct anthropic/openai when sovereign-only. */
  sovereignOnly?: boolean;
  /** Prefer quality cascade (free last). Default true for ecosystem partners. */
  qualityFirst?: boolean;
}

/** Best Bedrock intelligence (AWS credits) — live-invoked us-east-1 2026-08-14. */
const BEDROCK_BEST_INTELLIGENCE = [
  'us.anthropic.claude-opus-5',
  'global.anthropic.claude-opus-4-8',
  'global.anthropic.claude-opus-4-7',
  'global.anthropic.claude-sonnet-5',
  'global.anthropic.claude-sonnet-4-6',
  'global.anthropic.claude-opus-4-6-v1',
  'deepseek.v3.2',
  'us.deepseek.r1-v1:0',
  'moonshotai.kimi-k2.5',
  'moonshot.kimi-k2-thinking',
  'qwen.qwen3-vl-235b-a22b',
  'qwen.qwen3-next-80b-a3b',
  'mistral.mistral-large-3-675b-instruct',
  'google.gemma-3-27b-it',
  'zai.glm-5',
];

/** NV-LLM-COST-PROFILE-001 — India APAC rails first when cost profile is ON. */
const BEDROCK_COST_FIRST_STANDARD = [
  'apac.amazon.nova-micro-v1:0',
  'global.amazon.nova-2-lite-v1:0',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  'apac.amazon.nova-pro-v1:0',
  'us.amazon.nova-pro-v1:0',
  'deepseek.v3.2',
  'meta.llama3-70b-instruct-v1:0',
];

/** Fast Amazon rails on Bedrock (prefer US profiles when region=us-east-1). */
const BEDROCK_FAST = [
  'us.amazon.nova-pro-v1:0',
  'global.amazon.nova-2-lite-v1:0',
  'apac.amazon.nova-pro-v1:0',
];

/** Anthropic-on-Bedrock profiles — Sonnet 5 first for interactive speed; Opus 5 for drafts. */
const BEDROCK_CLAUDE_FAST = [
  'global.anthropic.claude-sonnet-5',
  'global.anthropic.claude-sonnet-4-6',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  // NV-CASCADE-DRIFT-001 (2026-08-16) — the `us.` Haiku 4.5 profile used to be a
  // final rung here but does not resolve; only the `global.` profile above
  // exists. The boot-time cascade validator found it silently dropped from every
  // plus/pro/enterprise/superadmin ladder. Removed rather than aliased: it would
  // duplicate the rung above it and add no availability, and a dead rung is
  // reached exactly when the earlier ones already failed — so it can only burn
  // another hop plus a per-attempt timeout when latency is already hurting.
];

/** Haiku / lite-first cascade for explicit partner `-fast` SLA task types (NV-BEDROCK-CLAUDE55-001: dynamic). */
function bedrockSlaFastLegal(): string[] {
  return getBedrockSlaFastLegalIds();
}

/** True when the raw taskType / taskKind string is an explicit partner `-fast` alias. */
export function isSlaFastLegalRoute(req: RouterRequest): boolean {
  return isPartnerExplicitFastAlias(String(req.taskKind || ''));
}

/**
 * R-DRAFT-NSP-QUALITY P0 — Opus/deep-first for litigation drafts; Sonnet-first for
 * notices and agreements when partner `draftDocumentType` is present. Unknown
 * `legal_drafting` stays deep-first (protects SLP/writ/bail counsel path).
 */
export function isLegalDraftDeepFirstRouting(taskKind?: TaskKind, req?: RouterRequest): boolean {
  if (taskKind === 'litigation_strategy') return true;
  if (taskKind !== 'legal_drafting') return false;
  const slug = String(req?.draftDocumentType ?? '').trim();
  if (!slug) return true;
  const docType = resolveDraftDocumentType({ documentType: slug });
  return !isTransactionalDraftDocumentType(docType);
}

const BEDROCK_CLAUDE_DEEP = [
  'us.anthropic.claude-opus-5',
  'global.anthropic.claude-opus-4-8',
  'global.anthropic.claude-opus-4-7',
  'global.anthropic.claude-opus-4-6-v1',
];

const BEDROCK_ANTHROPIC_LATER = [
  ...BEDROCK_CLAUDE_FAST,
  ...BEDROCK_CLAUDE_DEEP,
];

/** Per-tier Bedrock lead models — AWS-credit best intelligence first. */
const TIER_BEDROCK_LEAD: Record<TierLevel, string[]> = {
  superadmin: [
    ...BEDROCK_BEST_INTELLIGENCE,
    ...BEDROCK_FAST,
    ...BEDROCK_ANTHROPIC_LATER,
  ],
  enterprise: [
    ...BEDROCK_BEST_INTELLIGENCE,
    ...BEDROCK_FAST,
    ...BEDROCK_ANTHROPIC_LATER,
  ],
  pro: [
    'us.anthropic.claude-opus-5',
    'global.anthropic.claude-opus-4-8',
    'global.anthropic.claude-sonnet-5',
    'global.anthropic.claude-sonnet-4-6',
    'deepseek.v3.2',
    'us.deepseek.r1-v1:0',
    'moonshotai.kimi-k2.5',
    'qwen.qwen3-vl-235b-a22b',
    'qwen.qwen3-next-80b-a3b',
    'mistral.mistral-large-3-675b-instruct',
    'google.gemma-3-27b-it',
    'us.amazon.nova-pro-v1:0',
    'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  ],
  plus: [
    'us.amazon.nova-pro-v1:0',
    'apac.amazon.nova-pro-v1:0',
    'deepseek.v3.2',
    'meta.llama3-70b-instruct-v1:0',
    'zai.glm-5',
  ],
  free: [
    'global.amazon.nova-2-lite-v1:0',
    'us.amazon.nova-pro-v1:0',
    'apac.amazon.nova-pro-v1:0',
    'meta.llama3-70b-instruct-v1:0',
  ],
  solo: [
    'us.amazon.nova-pro-v1:0',
    'apac.amazon.nova-pro-v1:0',
    'deepseek.v3.2',
    'meta.llama3-70b-instruct-v1:0',
  ],
};

const ECOSYSTEM_LEGAL_LEADS = [
  ...BEDROCK_ANTHROPIC_LATER,
  ...BEDROCK_BEST_INTELLIGENCE,
  ...BEDROCK_FAST,
];

/**
 * Direct Claude/Gemini leads used after Bedrock (or before it when
 * JRX_PARTNER_LEGAL_PREMIUM_FIRST=1). Unavailable providers are skipped.
 */
const PARTNER_LEGAL_PREMIUM_LEAD = [
  'us.anthropic.claude-opus-5',
  'global.anthropic.claude-opus-4-8',
  'claude-sonnet-4-6',
  /* NV-CASCADE-DEAD-RUNG-001: `anthropic/claude-sonnet-4-6` is not in the catalog;
   * `anthropic/claude-opus-4-7` is the real OpenRouter Anthropic route. */
  'anthropic/claude-opus-4-7',
  'global.anthropic.claude-sonnet-5',
  'global.anthropic.claude-sonnet-4-6',
  'global.anthropic.claude-opus-4-7',
  'global.anthropic.claude-opus-4-6-v1',
  // NV-DEMO-MODEL-002 (2026-08-21): 3.7-flash before 3-1-pro — latest Flash is
  // primary Gemini rail; Pro preview is fallback only (20.79s on bench).
  'gemini-3.7-flash',
  'gemini-3-1-pro-preview',
  // NV-LEGAL-MULTI-PROVIDER-001 (2026-08-20) — top-tier direct/API fallbacks after Bedrock+Gemini.
  'deepseek-v4-pro',
  'grok-4.20-reasoning',
  'grok-4.20',
  'command-r-plus-08-2024',
  'deepseek/deepseek-v4-pro',
  'x-ai/grok-4.20',
  'google/gemini-3-1-pro-preview',
  '@preset/nyv',
];

const PLATFORM_OVERRIDES: Record<string, PlatformRoutingOverride> = {
  NSP: { primaryAggregator: 'bedrock', qualityFirst: true },
  NYM: { primaryAggregator: 'bedrock', qualityFirst: true },
  NSI: { primaryAggregator: 'bedrock', qualityFirst: true },
  NSA: { primaryAggregator: 'bedrock', qualityFirst: true },
  NSM: { primaryAggregator: 'bedrock', qualityFirst: true },
  NSPM: { primaryAggregator: 'bedrock', qualityFirst: true },
  JRX: { primaryAggregator: 'bedrock', qualityFirst: true },
  MIN: { primaryAggregator: 'bedrock', sovereignOnly: true },
  INS: { primaryAggregator: 'bedrock', sovereignOnly: true },
};

/** Proven paid OpenRouter / gateway leads (invocable in production). */
const OPENROUTER_PROVEN_LEAD = [
  '@preset/nyv',
  /* NV-CASCADE-DEAD-RUNG-001: was `anthropic/claude-sonnet-4-6`, which has NO catalog
   * entry and no alias — `getModel()` returned undefined and the rung was silently
   * dropped, so this "3-model" lead was really 2. `anthropic/claude-opus-4-7` is the
   * OpenRouter Anthropic route that actually exists (`model-catalog.ts:1110`). */
  'anthropic/claude-opus-4-7',
  'google/gemini-3-1-pro-preview',
];

/** Speculative frontier — only when JRX_LLM_ALLOW_SPECULATIVE=1. */
const OPENROUTER_SPECULATIVE_LEAD = [
  'anthropic/claude-opus-4-7',
  'openai/gpt-5.5',
  'google/gemini-3-1-pro-preview',
  'deepseek/deepseek-v4-pro',
];

/** OpenRouter :free tier — last among cloud (quality-first partners). */
const OPENROUTER_FREE_LEAD = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-nano-9b-v2:free',
];

/**
 * Direct-provider proven lead.
 *
 * NV-MODEL-AVAIL-PROBE-001 (2026-08-16): `gemini-2.5-pro` and `gemini-2.5-flash`
 * were removed — both now 404 with "no longer available to new users" on this
 * account, so they were dead rungs. `gemini-3.7-flash` (6.99s) and
 * `gemini-3.1-flash-lite` (4.65s) are live and both faster than
 * `gemini-3-1-pro-preview` (20.79s) on the bench legal task, so they sit above
 * the legacy `gpt-4.1` tail: a fallback rung is reached precisely when latency
 * or availability already hurt, so later rungs must be FASTER, not slower.
 */
const DIRECT_PROVEN_LEAD = [
  'claude-sonnet-4-6',
  'gemini-3.7-flash',
  'gemini-3-1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'deepseek-v4-pro',
  'grok-4.20-reasoning',
  'command-r-plus-08-2024',
  'gpt-4.1',
];

const DIRECT_SPECULATIVE_LEAD = [
  'claude-opus-4-7',
  'gpt-5.5',
];

function envTruthy(v: string | undefined, defaultWhenUnset = false): boolean {
  if (v == null || v === '') return defaultWhenUnset;
  const s = v.toLowerCase();
  return s === 'true' || s === '1' || s === 'on' || s === 'yes';
}

/** Speculative / unproven frontier model ids — opt-in only. */
export function isSpeculativeLlmAllowed(): boolean {
  return envTruthy(process.env.JRX_LLM_ALLOW_SPECULATIVE, false);
}

/**
 * Prefer OpenRouter free models first until quota.
 * Default OFF (quality-first for NSP/NYM). Set JRX_LLM_OPENROUTER_FREE_FIRST=1 for cost burn.
 */
export function isOpenRouterFreeFirst(): boolean {
  return envTruthy(process.env.JRX_LLM_OPENROUTER_FREE_FIRST, false)
    && isProviderAvailable('openrouter');
}

/** NV-OMNIROUTE-004: per-platform allowlist. Default = all platforms allowed.
 *  Set JRX_OMNIROUTE_ALLOWED_PLATFORMS=NSP,NYS,NYM to restrict. */
export function isOmniRouteAllowedForPlatform(app?: string): boolean {
  const allowed = String(process.env.JRX_OMNIROUTE_ALLOWED_PLATFORMS ?? '').trim();
  if (!allowed) return true;
  const list = allowed.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const key = normalizePlatform(app);
  return list.includes(key);
}

/** Bedrock enabled — default ON in production when AWS region is configured (EC2 IAM role). */
export function isBedrockRoutingEnabled(): boolean {
  const explicit = process.env.JRX_BEDROCK_ENABLED;
  if (explicit != null && explicit !== '') {
    return envTruthy(explicit, false);
  }
  if (process.env.JRX_BEDROCK_DISABLED === 'true') return false;
  const hasAws =
    !!(process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION) ||
    process.env.NODE_ENV === 'production';
  return hasAws;
}

/** Bedrock-first routing (aggregator before direct APIs). Override with JRX_ROUTER_BEDROCK_FIRST=off. */
export function isBedrockFirstPolicy(): boolean {
  if (!isBedrockRoutingEnabled()) return false;
  const v = process.env.JRX_ROUTER_BEDROCK_FIRST;
  if (v != null && v !== '') return envTruthy(v, true);
  return true;
}

/**
 * When ON, NSP/NYM legal tasks try Claude/Gemini APIs before Bedrock.
 * Default OFF (Bedrock us-east-1 first, Gemini fallback). Set 1 to restore API-first.
 */
export function isPartnerLegalPremiumFirst(): boolean {
  return envTruthy(process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST, false);
}

function normalizePlatform(app?: string): string {
  if (!app) return 'NSP';
  const u = app.toUpperCase();
  if (u === 'NYAYAMITRA' || u.startsWith('NYM')) return 'NYM';
  if (u === 'NYAYAVIGYA' || u.startsWith('JRX')) return 'JRX';
  if (u.startsWith('NSPM')) return 'NSPM';
  if (u.startsWith('NSP')) return 'NSP';
  if (u.startsWith('NSI')) return 'NSI';
  if (u.startsWith('NSA')) return 'NSA';
  if (u.startsWith('NSM')) return 'NSM';
  return u.slice(0, 3);
}

export function getPlatformRoutingOverride(req: RouterRequest): PlatformRoutingOverride {
  const key = normalizePlatform(req.app);
  return PLATFORM_OVERRIDES[key] ?? { primaryAggregator: 'bedrock', qualityFirst: true };
}

/** Legal / counsel task kinds that warrant Claude/Gemini-Pro premium leads. */
export function isPartnerLegalQualityTask(taskKind?: TaskKind): boolean {
  if (!taskKind) return true; // default legal_research in router
  switch (taskKind) {
    case 'chain_of_thought':
    case 'legal_research':
    case 'litigation_strategy':
    case 'legal_drafting':
    case 'contract_analysis':
    case 'compliance_review':
    // NSP/NYM Legal Chat resolves to generic_chat — it is still counsel-grade.
    case 'generic_chat':
      return true;
    case 'summarization':
    case 'classification':
    case 'extraction':
    case 'vision':
    case 'json_structured':
      return false;
    default: {
      const exhaustive: never = taskKind;
      return Boolean(exhaustive);
    }
  }
}

function costFirstTierLead(tier: TierLevel, taskKind?: TaskKind, req?: RouterRequest): string[] | null {
  if (!isLlmCostProfileActive()) return null;
  const deepFirst = isLegalDraftDeepFirstRouting(taskKind, req);
  if (deepFirst) return null;
  if (
    taskKind === 'summarization' || taskKind === 'classification' || taskKind === 'extraction'
  ) {
    return null;
  }
  const standard: TierLevel[] = ['free', 'solo', 'plus', 'pro'];
  if (standard.includes(tier)) {
    const tail = (TIER_BEDROCK_LEAD[tier] ?? TIER_BEDROCK_LEAD.pro).filter(
      (id) => !BEDROCK_COST_FIRST_STANDARD.includes(id),
    );
    return [...BEDROCK_COST_FIRST_STANDARD, ...tail];
  }
  if (tier === 'enterprise' || tier === 'superadmin') {
    const tail = TIER_BEDROCK_LEAD[tier].filter(
      (id) => !BEDROCK_COST_FIRST_STANDARD.includes(id),
    );
    return [...BEDROCK_COST_FIRST_STANDARD, ...tail];
  }
  return null;
}

export function bedrockLeadIdsForTier(tier: TierLevel, taskKind?: TaskKind, req?: RouterRequest): string[] {
  const costFirstLead = costFirstTierLead(tier, taskKind, req);
  if (costFirstLead) return costFirstLead;

  const base = TIER_BEDROCK_LEAD[tier] ?? TIER_BEDROCK_LEAD.pro;
  // NV-FAST-SERVING-TIER-001 — explicit partner `-fast` aliases: Haiku / lite first.
  if (req && isSlaFastLegalRoute(req)) {
    const slaFast = bedrockSlaFastLegal();
    return [
      ...slaFast,
      'deepseek.v3.2',
      'qwen.qwen3-vl-235b-a22b',
      ...base.filter((id) => !slaFast.includes(id)),
    ];
  }
  // Extraction / classify / summarise → fastest Nova first
  if (taskKind === 'summarization' || taskKind === 'classification' || taskKind === 'extraction') {
    return [
      'us.amazon.nova-pro-v1:0',
      'global.amazon.nova-2-lite-v1:0',
      // NV-DOCPARSE-LLM-FALLBACK-001 — cheapest Amazon rail as an extra low-cost
      // rung (kept BELOW nova-pro/nova-2-lite so it never displaces the current
      // primary; docparse_fallback pins it directly via preferredModels).
      'apac.amazon.nova-micro-v1:0',
      'global.amazon.nova-micro-v1:0',
      'apac.amazon.nova-pro-v1:0',
      'deepseek.v3.2',
      'meta.llama3-70b-instruct-v1:0',
      ...base.filter(
        (id) =>
          !id.includes('nova-pro') &&
          !id.includes('deepseek.v3.2') &&
          !id.includes('llama3-70b'),
      ),
    ];
  }
  if (isPartnerLegalQualityTask(taskKind)) {
    const deepFirst = isLegalDraftDeepFirstRouting(taskKind, req);
    const claudeFast = getBedrockClaudeFastIds();
    const claudeDeep = getBedrockClaudeDeepIds();
    const claude = deepFirst
      ? [...claudeDeep, ...claudeFast]
      : [...claudeFast, ...claudeDeep];
    /* NV-LADDER-COST-EFFECTIVE-001 — promote the value rungs above the *deep* tier.
     *
     * Measured from the catalog: `deepseek.v3.2` is legalQuality 96 at $0.27/$1.1, versus
     * `claude-sonnet-5` at legalQuality 100 for $3/$15 — 11x the input cost for 4 quality
     * points. Previously ALL of BEDROCK_CLAUDE_DEEP (four Opus rungs at $5/$25) sat above
     * every value model, so a fallback walked three more $5/$25 rungs before ever reaching
     * a 96-quality model at $0.27. That ordering is the structural reason blended cost
     * measured at -552.9%.
     *
     * What this does NOT do: it does not demote the FAST Claude lead. The first-choice
     * model for partner legal work is unchanged, so quality on the happy path is
     * untouched — this only changes what we fall back *to*. Value models are inserted
     * between FAST and DEEP for non-drafting tasks.
     *
     * Drafting and litigation strategy keep Opus-first (`deepFirst`) and are deliberately
     * left alone: those are the tasks where the marginal quality genuinely matters and
     * where a cheaper fallback is the wrong trade.
     *
     * `JRX_LADDER_COST_FIRST=0` restores the previous all-Claude-then-value order. */
    const costFirst =
      isLlmCostProfileActive() || String(process.env.JRX_LADDER_COST_FIRST ?? '1') !== '0';
    const value = [
      'deepseek.v3.2',                        // legalQuality 96 @ 0.27/1.1
      'qwen.qwen3-vl-235b-a22b',              // 94 @ 0.22/0.88
      'qwen.qwen3-235b-a22b-2507-v1:0',       // 94 @ 0.22/0.88
      'zai.glm-5',                            // 91 @ 0.5/1.5
    ];
    const claudeOrdered =
      costFirst && !deepFirst
        ? [...claudeFast, ...value, ...claudeDeep]
        : claude;
    return [
      ...claudeOrdered,
      'deepseek.v3.2',
      'us.deepseek.r1-v1:0',
      'moonshotai.kimi-k2.5',
      'moonshot.kimi-k2-thinking',
      'qwen.qwen3-vl-235b-a22b',
      'qwen.qwen3-next-80b-a3b',
      'qwen.qwen3-235b-a22b-2507-v1:0',
      'mistral.mistral-large-3-675b-instruct',
      'google.gemma-3-27b-it',
      'zai.glm-5',
      'us.amazon.nova-pro-v1:0',
      'apac.amazon.nova-pro-v1:0',
      ...base.filter(
        (id) =>
          !id.includes('deepseek') &&
          !id.includes('qwen') &&
          !id.includes('mistral-large-3') &&
          !id.includes('kimi') &&
          !id.includes('gemma') &&
          !id.includes('glm-5') &&
          !id.includes('nova-pro') &&
          !id.includes('anthropic.claude'),
      ),
    ];
  }
  return base;
}

function paidGatewayLeads(): string[] {
  const ids = [...OPENROUTER_PROVEN_LEAD, ...DIRECT_PROVEN_LEAD];
  if (isSpeculativeLlmAllowed()) {
    ids.push(...OPENROUTER_SPECULATIVE_LEAD, ...DIRECT_SPECULATIVE_LEAD);
  }
  return ids;
}

function partnerLegalPremiumLeads(): string[] {
  const fromEnv = getPartnerLegalPremiumLeadIds();
  const base = fromEnv.length ? fromEnv : PARTNER_LEGAL_PREMIUM_LEAD;
  return [
    ...base,
    ...DIRECT_PROVEN_LEAD.filter((id) => !base.includes(id)),
  ];
}

/**
 * Prepend aggregator-first models to a scored sequence. Never removes AgentZero terminal.
 *
 * Quality-first partners (legal tasks, default 2026-08-14):
 *   env lead → Bedrock → Gemini 3.x → OpenRouter/direct → :free → AgentZero
 *
 * JRX_PARTNER_LEGAL_PREMIUM_FIRST=1 restores Claude/Gemini API before Bedrock.
 *
 * Cost-burn when JRX_LLM_OPENROUTER_FREE_FIRST=1 (non-quality platforms only):
 *   env lead → :free → Bedrock → Gemini → paid → AgentZero
 */
export function applyRoutingPolicy(sequence: ModelEntry[], req: RouterRequest, tier: TierLevel, taskKind: TaskKind): ModelEntry[] {
  if (!sequence.length) return sequence;

  /* ── NV-POLICY-BUDGET-001 (2026-08-16) ────────────────────────────────────
   * The curated `leadIds` below are PREPENDED ahead of the scored sequence. Until
   * now that happened unconditionally, which silently defeated `req.maxCostUsd` —
   * a hard filter in `costFitScore` (it returns -1000, removing the candidate).
   * The scorer would correctly exclude a frontier model as over-budget and this
   * function would then put it straight back at position 0.
   *
   * Measured consequence: Queen exploration leaves pass `maxBudgetUSD: 0.005`
   * (NV-QUEEN-LEAF-TIER-001) yet still landed on `gemini-3-1-pro-preview`
   * (`$1.5/$12` per 1M, ~20.8s on the bench legal task) — so the leaf/synthesis
   * cost split had no effect on which model was actually called, and three
   * throwaway nodes each burned the 120s per-node budget.
   *
   * A declared budget is a caller CONTRACT, not a hint, so lead ids are now held
   * to it as well. AgentZero is free and still appended terminally, so this can
   * never empty the cascade. When no budget is declared the behaviour is
   * unchanged. */
  const budget = req.maxCostUsd;
  const promptTokens = req.promptTokens ?? 1500;
  const outputTokens = req.expectedOutputTokens ?? 1500;
  const withinBudget = (m: ModelEntry): boolean => {
    if (budget == null) return true;
    if (m.provider === 'agentzero') return true;
    const est = ((promptTokens * m.costInPer1M) + (outputTokens * m.costOutPer1M)) / 1_000_000;
    return est <= budget;
  };

  const platform = getPlatformRoutingOverride(req);
  const aggregator = platform.primaryAggregator ?? 'bedrock';
  const sovereignOnly = !!platform.sovereignOnly;
  const qualityFirst = platform.qualityFirst !== false;
  const slaFastLegal = isSlaFastLegalRoute(req);
  const premiumLegal =
    !slaFastLegal
    && qualityFirst
    && !sovereignOnly
    && isPartnerLegalPremiumFirst()
    && isPartnerLegalQualityTask(taskKind);

  const leadIds: string[] = [];
  const deferredFreeFromLead: string[] = [];
  const skipCascadeLead =
    slaFastLegal
    || taskKind === 'summarization' || taskKind === 'classification' || taskKind === 'extraction';
  if (slaFastLegal) {
    leadIds.push(...bedrockSlaFastLegal());
  }
  if (!skipCascadeLead) {
    for (const id of getLlmCascadeLeadOverride()) {
      if (qualityFirst && (id.includes(':free') || id.endsWith('/free'))) {
        deferredFreeFromLead.push(id);
        continue;
      }
      leadIds.push(id);
    }
    const deepFirst = !slaFastLegal && isLegalDraftDeepFirstRouting(taskKind, req);
    if (deepFirst) {
      const opus5 = leadIds.filter((id) => /claude-opus-5/i.test(id));
      const opus48 = leadIds.filter((id) => /claude-opus-4-8/i.test(id));
      const opusRest = leadIds.filter(
        (id) => /claude-opus/i.test(id) && !/claude-opus-5|claude-opus-4-8/i.test(id),
      );
      const sonnet = leadIds.filter((id) => /claude-sonnet/i.test(id));
      const rest = leadIds.filter((id) => !/claude-(opus|sonnet)/i.test(id));
      leadIds.length = 0;
      leadIds.push(...opus5, ...opus48, ...opusRest, ...sonnet, ...rest);
    } else {
      const sonnet5 = leadIds.filter((id) => /claude-sonnet-5/i.test(id));
      const opus5 = leadIds.filter((id) => /claude-opus-5/i.test(id));
      const rest = leadIds.filter(
        (id) => !/claude-sonnet-5/i.test(id) && !/claude-opus-5/i.test(id),
      );
      leadIds.length = 0;
      leadIds.push(...sonnet5, ...rest, ...opus5);
    }
  }

  if (!sovereignOnly && !qualityFirst && isOpenRouterFreeFirst()) {
    leadIds.push(...OPENROUTER_FREE_LEAD);
  }

  // NV-BEDROCK-DEFAULT-001: Bedrock before Gemini / OpenRouter unless premium-first escape.
  if (premiumLegal) {
    leadIds.push(...partnerLegalPremiumLeads());
  }

  if (aggregator === 'bedrock' && isBedrockFirstPolicy()) {
    leadIds.push(...bedrockLeadIdsForTier(tier, taskKind, req));
    if (platform.bedrockLeadModels?.length) {
      leadIds.push(...platform.bedrockLeadModels);
    } else if (platform.qualityFirst) {
      leadIds.push(...ECOSYSTEM_LEGAL_LEADS);
    }
  } else if (aggregator === 'openrouter') {
    leadIds.push(...paidGatewayLeads());
  }

  if (!sovereignOnly && isProviderAvailable('google')) {
    leadIds.push(...getLlmCascadeGeminiOverride());
  }

  if (!premiumLegal && !sovereignOnly) {
    leadIds.push(...partnerLegalPremiumLeads());
  }

  if (!sovereignOnly && isProviderAvailable('omniroute') && isOmniRouteAllowedForPlatform(req.app)) {
    /* NV-CASCADE-DEAD-RUNG-001: `omniroute/auto` has no catalog entry — the catalog
     * defines only `/auto/reliable`, `/auto/cheap` and `/auto/free`
     * (`model-catalog.ts` omniroute block). It was silently dropped on every request. */
    leadIds.push('omniroute/auto/reliable', 'omniroute/auto/cheap');
  }

  if (!sovereignOnly) {
    leadIds.push(...paidGatewayLeads());
  }

  // Free last for quality-first partners (incl. any :free deferred from CASCADE_LEAD).
  if (!sovereignOnly && qualityFirst && isProviderAvailable('openrouter')) {
    leadIds.push(...deferredFreeFromLead, ...OPENROUTER_FREE_LEAD);
  } else if (deferredFreeFromLead.length) {
    leadIds.push(...deferredFreeFromLead);
  }

  const seen = new Set<string>();
  const out: ModelEntry[] = [];

  for (const id of leadIds) {
    if (seen.has(id)) continue;
    const m = getModel(id);
    if (!m) continue;
    if (m.provider === 'omniroute' && !isOmniRouteAllowedForPlatform(req.app)) continue;
    if (!isProviderAvailable(m.provider) && m.provider !== 'agentzero') continue;
    // NV-POLICY-BUDGET-001: never prepend a lead the caller cannot afford.
    if (!withinBudget(m)) continue;
    seen.add(id);
    out.push(m);
  }

  for (const m of sequence) {
    if (seen.has(m.id)) continue;
    if (sovereignOnly && (m.provider === 'anthropic' || m.provider === 'openai' || m.provider === 'google')) {
      continue;
    }
    if (m.provider === 'omniroute' && !isOmniRouteAllowedForPlatform(req.app)) continue;
    if (!isProviderAvailable(m.provider) && m.provider !== 'agentzero') continue;
    /* The scored candidates already passed `costFitScore`, but `pickSequence`
     * merges in the curated default + ultimate-fallback ladders, which are not
     * cost-filtered. Re-check here so the budget holds for every rung. */
    if (!withinBudget(m)) continue;
    seen.add(m.id);
    out.push(m);
  }

  const az = getModel('agentzero');
  if (az) {
    const filtered = out.filter((m) => m.id !== 'agentzero');
    filtered.push(az);
    return filtered;
  }
  return out;
}

/** Scoring boost when Bedrock-first policy is active. */
export function bedrockAffinityBoost(model: ModelEntry, tier: TierLevel, taskKind: TaskKind): number {
  if (!isBedrockFirstPolicy() || model.provider !== 'bedrock') return 0;
  // Premium-legal path: do not overweight Bedrock vs Claude/Gemini.
  if (isPartnerLegalPremiumFirst() && isPartnerLegalQualityTask(taskKind)) {
    let boost = tier === 'enterprise' || tier === 'superadmin' ? 8 : 5;
    if (model.id.includes('anthropic.claude')) boost += 10;
    if (model.preferredFor?.includes(taskKind)) boost += 4;
    return boost;
  }
  let boost = tier === 'enterprise' || tier === 'superadmin' ? 28 : 22;
  if (model.preferredFor?.includes(taskKind)) boost += 6;
  if (model.legalQuality >= 95) boost += 4;
  if (
    model.id.startsWith('deepseek.') ||
    model.id.startsWith('qwen.') ||
    model.id.startsWith('mistral.') ||
    model.id.includes('nova-pro') ||
    model.id.startsWith('meta.llama')
  ) {
    boost += 4;
  }
  if (isLlmCostProfileActive()) {
    if (model.id.includes('nova-micro') || model.id.includes('nova-2-lite')) boost += 10;
    if (model.id.includes('haiku')) boost += 6;
    if (model.id.includes('claude-opus')) boost -= 8;
  }
  return boost;
}
