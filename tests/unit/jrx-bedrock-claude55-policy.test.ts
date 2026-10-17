import { describe, it, expect, afterEach } from 'vitest';
import {
  BEDROCK_CLAUDE_HAIKU_55,
  getBedrockSlaFastLegalIds,
  getBedrockClaudeFastIds,
  getBedrockClaudeDeepIds,
  isLlmBaselineFrozen,
} from '../../src/config/jrx-bedrock-claude55-policy.js';
import { bedrockLeadIdsForTier } from '../../src/config/jrx-llm-routing-policy.js';

describe('NV-BEDROCK-CLAUDE55-001', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });

  function saveEnv(keys: string[]) {
    for (const k of keys) prev[k] = process.env[k];
  }

  it('flags OFF — SLA fast ladder unchanged (no Haiku 5.5)', () => {
    saveEnv(['NYV_F_BEDROCK_HAIKU_55_FAST', 'NYV_LLM_BASELINE_FROZEN']);
    delete process.env.NYV_F_BEDROCK_HAIKU_55_FAST;
    delete process.env.NYV_LLM_BASELINE_FROZEN;
    const ids = getBedrockSlaFastLegalIds();
    expect(ids[0]).toBe('global.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(ids.includes(BEDROCK_CLAUDE_HAIKU_55)).toBe(false);
  });

  it('Haiku 5.5 fast flag ON — prepends global Haiku 5.5', () => {
    saveEnv(['NYV_F_BEDROCK_HAIKU_55_FAST', 'NYV_LLM_BASELINE_FROZEN']);
    process.env.NYV_F_BEDROCK_HAIKU_55_FAST = '1';
    delete process.env.NYV_LLM_BASELINE_FROZEN;
    const ids = getBedrockSlaFastLegalIds();
    expect(ids[0]).toBe(BEDROCK_CLAUDE_HAIKU_55);
  });

  it('NYV_LLM_BASELINE_FROZEN=1 blocks 5.5 even when flags ON', () => {
    saveEnv(['NYV_F_BEDROCK_HAIKU_55_FAST', 'NYV_LLM_BASELINE_FROZEN']);
    process.env.NYV_F_BEDROCK_HAIKU_55_FAST = '1';
    process.env.NYV_LLM_BASELINE_FROZEN = '1';
    expect(isLlmBaselineFrozen()).toBe(true);
    expect(getBedrockSlaFastLegalIds()[0]).toBe('global.anthropic.claude-haiku-4-5-20251001-v1:0');
  });

  it('Sonnet 5.5 chat flag prepends Sonnet 5.5', () => {
    saveEnv(['NYV_F_BEDROCK_SONNET_55_CHAT']);
    process.env.NYV_F_BEDROCK_SONNET_55_CHAT = '1';
    expect(getBedrockClaudeFastIds()[0]).toBe('global.anthropic.claude-sonnet-5-5');
  });

  it('Opus 5.5 counsel flag prepends us Opus 5.5', () => {
    saveEnv(['NYV_F_BEDROCK_OPUS_55_COUNSEL']);
    process.env.NYV_F_BEDROCK_OPUS_55_COUNSEL = '1';
    expect(getBedrockClaudeDeepIds()[0]).toBe('us.anthropic.claude-opus-5-5');
  });

  it('bedrockLeadIdsForTier legal-chat-fast uses Haiku 5.5 when flag ON', () => {
    saveEnv(['NYV_F_BEDROCK_HAIKU_55_FAST', 'NYV_BEDROCK_ENABLED']);
    process.env.NYV_F_BEDROCK_HAIKU_55_FAST = '1';
    process.env.NYV_BEDROCK_ENABLED = '1';
    const ids = bedrockLeadIdsForTier('enterprise', 'legal_research', {
      app: 'NSP',
      taskKind: 'legal-chat-fast',
    });
    expect(ids[0]).toBe(BEDROCK_CLAUDE_HAIKU_55);
  });
});
