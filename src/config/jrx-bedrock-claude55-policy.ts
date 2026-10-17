/**
 * NV-BEDROCK-CLAUDE55-001 — Claude 5.5 family on Bedrock (flag-gated rollout).
 *
 * Default OFF: ladders unchanged until JRX_F_BEDROCK_* flags are set.
 * NSP /orchestrate contract unchanged — routing only.
 */
import { isNyvFeatureOn } from './jrx-feature-flags.js';

export const BEDROCK_CLAUDE_HAIKU_55 = 'global.anthropic.claude-haiku-5-5';
export const BEDROCK_CLAUDE_SONNET_55 = 'global.anthropic.claude-sonnet-5-5';
/** Opus 5.5 — prefer US profile (mirrors Opus 5 payment/entitlement pattern). */
export const BEDROCK_CLAUDE_OPUS_55 = 'us.anthropic.claude-opus-5-5';
export const BEDROCK_CLAUDE_OPUS_55_GLOBAL = 'global.anthropic.claude-opus-5-5';

export function isBedrockHaiku55FastEnabled(): boolean {
  return isNyvFeatureOn('bedrockHaiku55Fast');
}

export function isBedrockSonnet55ChatEnabled(): boolean {
  return isNyvFeatureOn('bedrockSonnet55Chat');
}

export function isBedrockOpus55CounselEnabled(): boolean {
  return isNyvFeatureOn('bedrockOpus55Counsel');
}

export function isBedrockQueen55LeavesEnabled(): boolean {
  return isNyvFeatureOn('bedrockQueen55Leaves');
}

/** Ops convention: QA regression lane keeps legacy ladders when set. */
export function isLlmBaselineFrozen(): boolean {
  const v = String(process.env.NYV_LLM_BASELINE_FROZEN ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

function featureAllowed(check: () => boolean): boolean {
  if (isLlmBaselineFrozen()) return false;
  return check();
}

export function prependUnique(lead: string, ladder: readonly string[]): string[] {
  const rest = ladder.filter((id) => id !== lead);
  return [lead, ...rest];
}

export function getBedrockSlaFastLegalIds(): string[] {
  const tail = getBedrockClaudeFastIds();
  const core = [
    'global.anthropic.claude-haiku-4-5-20251001-v1:0',
    'global.amazon.nova-2-lite-v1:0',
    'us.amazon.nova-pro-v1:0',
    'gemini-3.1-flash-lite',
    'gemini-3.7-flash',
  ];
  const merged = [...core, ...tail.filter((id) => !core.includes(id))];
  if (featureAllowed(isBedrockHaiku55FastEnabled)) {
    return prependUnique(BEDROCK_CLAUDE_HAIKU_55, merged);
  }
  return merged;
}

export function getBedrockClaudeFastIds(): string[] {
  const base = [
    'global.anthropic.claude-sonnet-5',
    'global.anthropic.claude-sonnet-4-6',
    'global.anthropic.claude-haiku-4-5-20251001-v1:0',
  ] as const;
  if (featureAllowed(isBedrockSonnet55ChatEnabled)) {
    return prependUnique(BEDROCK_CLAUDE_SONNET_55, base);
  }
  return [...base];
}

export function getBedrockClaudeDeepIds(): string[] {
  const base = [
    'us.anthropic.claude-opus-5',
    'global.anthropic.claude-opus-4-8',
    'global.anthropic.claude-opus-4-7',
    'global.anthropic.claude-opus-4-6-v1',
  ] as const;
  if (featureAllowed(isBedrockOpus55CounselEnabled)) {
    return prependUnique(BEDROCK_CLAUDE_OPUS_55, base);
  }
  return [...base];
}

export function isClaude55BedrockModelId(modelId: string): boolean {
  const id = String(modelId || '').toLowerCase();
  return id.includes('claude-haiku-5-5')
    || id.includes('claude-sonnet-5-5')
    || id.includes('claude-opus-5-5');
}

export function isClaude55HaikuModelId(modelId: string): boolean {
  return String(modelId || '').toLowerCase().includes('claude-haiku-5-5');
}

/** Queen registry stamp → Bedrock profile when Phase 5 flag ON. */
export function remapQueenPreferredForClaude55(modelId: string, role: 'exploration' | 'synthesis'): string {
  if (!featureAllowed(isBedrockQueen55LeavesEnabled)) return modelId;
  const id = String(modelId || '').trim();
  const lower = id.toLowerCase();
  if (role === 'exploration' || lower.includes('haiku') || lower.includes('mini') || lower.includes('lite')) {
    if (lower.includes('haiku-4-5') || lower === 'claude-haiku-4-5') {
      return BEDROCK_CLAUDE_HAIKU_55;
    }
  }
  if (lower.includes('sonnet-5') && !lower.includes('5-5')) {
    return BEDROCK_CLAUDE_SONNET_55;
  }
  if (lower.includes('opus-5') && !lower.includes('5-5')) {
    return BEDROCK_CLAUDE_OPUS_55;
  }
  return id;
}

export function resolvePromptCacheMinCharsForModel(modelId: string): number {
  if (isClaude55BedrockModelId(modelId)) {
    const n = Number(process.env.NYV_PROMPT_CACHE_MIN_CHARS_CLAUDE55 ?? 512);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 512;
  }
  return Number(process.env.NYV_PROMPT_CACHE_MIN_CHARS || 4000);
}
