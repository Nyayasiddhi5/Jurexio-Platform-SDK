import type { AgentClass, ModelEntry, TaskKind, TierLevel } from './router-types.js';
import { getModel } from './model-catalog.js';
import { bedrockLeadIdsForTier } from '../../config/jrx-llm-routing-policy.js';

// NV-OMNIROUTE-003: OmniRoute fallback aliases appear as last-resort before
// AgentZero in every sequence. They are automatically filtered out when
// JRX_OMNIROUTE_ENABLED is not true or OMNIROUTE_API_KEY is missing.
const OMNIROUTE_FALLBACK = [
  'omniroute/auto/reliable',
  'omniroute/auto/cheap',
  'omniroute/auto/free',
];

// Bedrock aggregator leads every cascade when JRX_ROUTER_BEDROCK_FIRST is on (default).
function withBedrockLead(ids: string[], tier: TierLevel, taskKind: TaskKind): string[] {
  const leads = bedrockLeadIdsForTier(tier, taskKind);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...leads, ...ids]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAY 2026 LATEST-MODEL CASCADE (Session-15 v2, 2026-05-11)
//
// Per user mandate: every cascade leads with the LATEST May 2026 paid frontier
// model from each provider, then fans out across all configured providers,
// then falls back to free :free tier, then sovereign AgentZero.
//
// Order of preference (paid frontier → paid mid → cross-provider paid →
// free tier → sovereign):
//   1. Anthropic Claude Opus 4.7  (May 2026 frontier, 1M ctx)
//   2. OpenAI GPT-5.5 / 5.5-pro    (May 2026 OpenAI flagship, 400K ctx)
//   3. Google Gemini 3.1 Pro Preview (May 2026 Google flagship, 1M ctx)
//   4. xAI Grok 4.20 Reasoning     (May 2026, 2M ctx — best for ultra-long docs)
//   5. DeepSeek V4 Pro             (May 2026, 1M ctx, cheap+strong)
//   6. Anthropic Claude Sonnet 4.6 (1M ctx, balanced)
//   7. OpenAI GPT-5.4              (March 2026 fallback)
//   8. Bedrock Claude Opus 4.7 v1:0 (VPC-only frontier)
//   9. OpenRouter paid (cross-provider gateway)
//  10. Sarvam-105B (Indic-jurisdiction primary)
//  11. OpenRouter :free terminal
//  12. AgentZero sovereign
//
// `:free` models are NEVER promoted above paid models — they serve as
// last-resort before the sovereign terminal fallback.
// ─────────────────────────────────────────────────────────────────────────────

/** Proven-first cascade — speculative frontier only loaded when present in catalog + ALLOW_SPECULATIVE. */
// NV-MODEL-AVAIL-PROBE-001 (2026-08-16): the `gemini-2.5-*` ids that used to sit
// in these ladders are dead on this account (404 "no longer available to new
// users"). `getModel()` now aliases them to live models, but they are replaced
// explicitly here so the ladders read as what they actually are. Ordering rule:
// a fallback rung is reached precisely BECAUSE the previous rung was slow or
// unavailable, so later rungs must be faster — measured on the bench legal task,
// `gemini-3.7-flash` is 6.99s and `gemini-3.1-flash-lite` 4.65s, versus 20.79s
// for `gemini-3-1-pro-preview`.
const ENTERPRISE_LEGAL_FRONTIER_RAW = [
  'deepseek.v3.2',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'apac.amazon.nova-pro-v1:0',
  'gemini-3-1-pro-preview',
  'gemini-3.7-flash',
  'claude-sonnet-4-6',
  'global.anthropic.claude-sonnet-4-6',
  '@preset/nyv',
  'gpt-4.1',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const ENTERPRISE_LEGAL_FRONTIER = withBedrockLead(ENTERPRISE_LEGAL_FRONTIER_RAW, 'enterprise', 'legal_research');

const SUPERADMIN_LEGAL_FRONTIER = [
  'deepseek.v3.2',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'apac.amazon.nova-pro-v1:0',
  'gemini-3-1-pro-preview',
  'claude-sonnet-4-6',
  'gemini-3.7-flash',
  '@preset/nyv',
  'gpt-4.1',
  'meta-llama/llama-3.3-70b-instruct:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const PRO_LEGAL_BALANCED = [
  'deepseek.v3.2',
  'apac.amazon.nova-pro-v1:0',
  'gemini-3-1-pro-preview',
  'claude-sonnet-4-6',
  'gemini-3.7-flash',
  '@preset/nyv',
  'gpt-4.1',
  'claude-haiku-4-5',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const PLUS_BALANCED = [
  'apac.amazon.nova-pro-v1:0',
  'deepseek.v3.2',
  'gemini-3.7-flash',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gpt-4.1',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const SOLO_CHEAP = [
  'apac.amazon.nova-pro-v1:0',
  'gemini-3.7-flash',
  'gemini-3-1-flash-lite-preview',
  'claude-haiku-4-5',
  'meta.llama3-70b-instruct-v1:0',
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-nano-9b-v2:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const FREE_BUDGET = [
  'apac.amazon.nova-pro-v1:0',
  'gemini-3-1-flash-lite-preview',
  'gemini-3.7-flash',
  'claude-haiku-4-5',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const VISION_FIRST = [
  'gemini-3.7-flash',
  'gemini-3-1-pro-preview',
  'apac.amazon.nova-pro-v1:0',
  'deepseek.v3.2',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

const REASONING_FIRST = [
  'deepseek.v3.2',
  'qwen.qwen3-235b-a22b-2507-v1:0',
  'claude-sonnet-4-6',
  'gemini-3-1-pro-preview',
  'gemini-3.7-flash',
  'apac.amazon.nova-pro-v1:0',
  'meta-llama/llama-3.3-70b-instruct:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

// Indic-jurisdiction-aware sequence.
// NV-UAT-FIX-2026-05-12 (Task #154): sarvam-105b was leading and returning
// ~91-token tool-call-marker stubs ("statute-verification\nstatute_name\n…")
// for analytical legal-research queries, causing 9/55 UAT anchor failures
// (IN-RES-002, IN-LIT-002..005, IN-REG-001/004/005, IN-SAF-002). Sarvam stays
// in the sequence as Indic-language specialist (Hindi/Tamil/etc. translation
// and short-form Indic answers) but is demoted below the strong analytical
// models so legal research, drafting, and refusal scenarios get a
// comprehensive multi-paragraph answer first. Sarvam will still serve when
// the leaders are degraded or rate-limited.
const INDIC_LEGAL = [
  // Counsel-grade + Bedrock us-east-1 breadth (policy may prepend premium again).
  'claude-sonnet-4-6',
  'us.anthropic.claude-opus-5',
  'global.anthropic.claude-opus-4-8',
  'global.anthropic.claude-opus-4-7',
  'global.anthropic.claude-sonnet-5',
  'global.anthropic.claude-sonnet-4-6',
  'global.anthropic.claude-opus-4-6-v1',
  'gemini-3-1-pro-preview',
  'gemini-3.7-flash',
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
  'us.amazon.nova-2-lite-v1:0',
  'global.amazon.nova-2-lite-v1:0',
  'gemini-3-flash-preview',
  'gemini-3-1-flash-lite-preview',
  'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  'sarvam-105b',
  'sarvam-m',
  '@preset/nyv',
  /* NV-CASCADE-DEAD-RUNG-001: `anthropic/claude-sonnet-4-6` is not catalogued. */
  'anthropic/claude-opus-4-7',
  'google/gemini-3-1-pro-preview',
  'perplexity/sonar-pro',
  'qwen/qwen3-235b-a22b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'openai/gpt-oss-120b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  ...OMNIROUTE_FALLBACK,
  'agentzero',
];

export function defaultSequenceFor(
  tier: TierLevel,
  agentClass: AgentClass,
  taskKind: TaskKind,
  opts: { requireVision?: boolean; requireReasoning?: boolean; jurisdiction?: string } = {}
): ModelEntry[] {
  const ids = pickIdSequence(tier, agentClass, taskKind, opts);
  const seq: ModelEntry[] = [];
  for (const id of ids) {
    const m = getModel(id);
    if (m) seq.push(m);
  }
  return seq;
}

function pickIdSequence(
  tier: TierLevel,
  agentClass: AgentClass,
  taskKind: TaskKind,
  opts: { requireVision?: boolean; requireReasoning?: boolean; jurisdiction?: string }
): string[] {
  if (opts.requireVision) return VISION_FIRST;
  if (opts.requireReasoning) return REASONING_FIRST;

  const isLegalHeavy =
    taskKind === 'legal_drafting' ||
    taskKind === 'legal_research' ||
    taskKind === 'litigation_strategy' ||
    taskKind === 'contract_analysis' ||
    taskKind === 'compliance_review' ||
    taskKind === 'chain_of_thought';

  const isSeniorOrAbove =
    agentClass === 'executive' || agentClass === 'senior' || agentClass === 'specialist';

  // Indic jurisdiction → Sarvam-led cascade for legal-heavy tasks
  if (opts.jurisdiction === 'IN' && isLegalHeavy) {
    return INDIC_LEGAL;
  }

  if (tier === 'superadmin') {
    return isLegalHeavy || isSeniorOrAbove ? SUPERADMIN_LEGAL_FRONTIER : ENTERPRISE_LEGAL_FRONTIER;
  }
  if (tier === 'enterprise') {
    return isLegalHeavy || isSeniorOrAbove ? ENTERPRISE_LEGAL_FRONTIER : PRO_LEGAL_BALANCED;
  }
  if (tier === 'pro') {
    return isLegalHeavy || isSeniorOrAbove ? PRO_LEGAL_BALANCED : PLUS_BALANCED;
  }
  if (tier === 'plus') {
    return isLegalHeavy || isSeniorOrAbove ? PLUS_BALANCED : SOLO_CHEAP;
  }
  if (tier === 'solo') {
    return isLegalHeavy ? PLUS_BALANCED : SOLO_CHEAP;
  }
  return FREE_BUDGET;
}

export function ultimateFallbackSequence(): ModelEntry[] {
  // Bedrock AWS-credit models first, then direct Gemini/Claude, OpenRouter paid,
  // OpenRouter :free, OmniRoute, AgentZero. Speculative frontier pruned from default.
  //
  // NV-MODEL-AVAIL-PROBE-001: `gemini-2.5-pro` / `gemini-2.5-flash` removed —
  // dead on this account (404 "no longer available to new users"). This is the
  // LAST-RESORT ladder, so its rungs must be the ones most likely to answer
  // quickly: the live Flash rails measured 4.65–6.99s vs 20.79s for 3.1 Pro.
  const ids = [
    'deepseek.v3.2',
    'qwen.qwen3-235b-a22b-2507-v1:0',
    'mistral.mistral-large-3-675b-instruct',
    'apac.amazon.nova-pro-v1:0',
    'meta.llama3-70b-instruct-v1:0',
    'gemini-3.7-flash',
    'gemini-3-1-flash-lite-preview',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    '@preset/nyv',
    'qwen/qwen3-235b-a22b:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-nano-9b-v2:free',
    ...OMNIROUTE_FALLBACK,
  'agentzero',
];
  return ids.map(getModel).filter((m): m is ModelEntry => !!m);
}
