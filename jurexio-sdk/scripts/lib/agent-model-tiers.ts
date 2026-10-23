/**
 * Jurexio v5.0.1 — Canonical April-2026 model-tier map.
 *
 * Single source of truth for which models each tier × jurisdiction × practice-area
 * agent should declare in its `preferredModels` and `fallbackModels`.
 *
 * Constraints:
 *   - 5 LLM providers ONLY: anthropic, openai, google, openrouter, sarvam
 *   - Indic-language tail (Sarvam) only for IN-jurisdiction agents
 *   - Voice models reserved for agents flagged with voice tools
 */

export type Tier = 'executive' | 'senior' | 'specialist' | 'associate';
export type Jurisdiction = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG' | 'Default';

export interface TierModelResult {
  preferredModels: string[];
  fallbackModels: string[];
  voiceModels?: string[];
}

const COMMON_FREE_FALLBACKS = [
  'meta-llama/llama-4-maverick:free',
  'qwen/qwen3-235b-instruct:free',
  'google/gemma-3-27b-it:free',
];

const SARVAM_INDIC_TAIL_PREFERRED = ['sarvam-7b'];
const SARVAM_INDIC_TAIL_FALLBACK = ['sarvam-2b', 'sarvamai/sarvam-translate'];

const VOICE_MODELS_DEFAULT = [
  'tts-1-hd',
  'whisper-1',
  'gpt-4o-realtime-preview',
];

const TIER_PREFERRED: Record<Tier, string[]> = {
  executive: ['claude-opus-4-6', 'gpt-4.1', 'gemini-3.1-pro-preview'],
  senior: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-pro-preview'],
  specialist: ['claude-sonnet-4-6', 'gpt-4.1', 'gemini-3-flash-preview'],
  associate: ['claude-haiku-4-5', 'gpt-4.1-mini', 'gemini-3-flash-preview'],
};

const TIER_FALLBACK: Record<Tier, string[]> = {
  executive: ['claude-sonnet-4-6', ...COMMON_FREE_FALLBACKS],
  senior: ['claude-haiku-4-5', ...COMMON_FREE_FALLBACKS],
  specialist: ['claude-haiku-4-5', ...COMMON_FREE_FALLBACKS],
  associate: ['gpt-4.1-nano', ...COMMON_FREE_FALLBACKS],
};

export function normalizeTier(tier: string | undefined | null): Tier {
  const t = String(tier || '').toLowerCase().trim();
  if (t === 'executive' || t === 'senior' || t === 'specialist' || t === 'associate') {
    return t as Tier;
  }
  return 'specialist';
}

export function getTierModels(args: {
  tier: string;
  jurisdiction: string;
  practiceArea?: string;
  hasVoice?: boolean;
}): TierModelResult {
  const tier = normalizeTier(args.tier);
  const jur = String(args.jurisdiction || 'Default') as Jurisdiction;
  const isIN = jur === 'IN' || jur === 'Default';

  const preferredModels = [...TIER_PREFERRED[tier]];
  const fallbackModels = [...TIER_FALLBACK[tier]];

  if (isIN) {
    preferredModels.push(...SARVAM_INDIC_TAIL_PREFERRED);
    fallbackModels.push(...SARVAM_INDIC_TAIL_FALLBACK);
  }

  const result: TierModelResult = { preferredModels, fallbackModels };

  if (args.hasVoice) {
    result.voiceModels = [...VOICE_MODELS_DEFAULT];
  }

  return result;
}

export const ALL_ALLOWED_MODEL_IDS = new Set<string>([
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'claude-haiku-4',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o3',
  'o3-mini',
  'gpt-4o',
  'tts-1',
  'tts-1-hd',
  'whisper-1',
  'gpt-4o-realtime-preview',
  'gpt-4o-audio-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
  'sarvam-2b',
  'sarvam-7b',
  'sarvamai/sarvam-1',
  'sarvamai/sarvam-translate',
  'sarvamai/sarvam-summarize',
  'meta-llama/llama-4-maverick:free',
  'meta-llama/llama-4-scout:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-instruct:free',
  'qwen/qwen3-coder:free',
  'mistralai/mistral-medium-3:free',
  'google/gemma-3-27b-it:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'openai/gpt-oss-120b:free',
]);

export const STALE_MODEL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bclaude-sonnet-4(?!-)/g, 'claude-sonnet-4-6'],
  [/\bclaude-haiku-3\.5\b/g, 'claude-haiku-4-5'],
  [/\bclaude-3-5-sonnet(?:-v2)?\b/g, 'claude-sonnet-4-6'],
  [/\bgemini-2\.5-pro\b/g, 'gemini-3.1-pro-preview'],
  [/\bgemini-1\.5-pro\b/g, 'gemini-3-pro-preview'],
  [/\bdeepseek-r1\b/g, 'qwen/qwen3-235b-instruct:free'],
  [/\bgpt-5\.2\b/g, 'gpt-4.1'],
];
