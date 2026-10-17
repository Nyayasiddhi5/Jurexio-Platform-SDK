import { describe, it, expect, afterEach } from 'vitest';
import {
  applyRoutingPolicy,
  isLegalDraftDeepFirstRouting,
  isPartnerLegalPremiumFirst,
  isPartnerLegalQualityTask,
} from '../../src/config/jrx-llm-routing-policy.js';
import { getPartnerLegalPremiumLeadIds, getBedrockRegionOrder } from '../../src/config/jrx-llm-cascade-config.js';
import {
  BEDROCK_CLAUDE_HAIKU_55,
  BEDROCK_CLAUDE_SONNET_55,
  BEDROCK_CLAUDE_OPUS_55,
  getBedrockSlaFastLegalIds,
  getBedrockClaudeFastIds,
  getBedrockClaudeDeepIds,
} from '../../src/config/jrx-bedrock-claude55-policy.js';
import { pickSequence } from '../../src/services/intelligent-router/intelligent-router.js';
import { resolveContextBudgets } from '../../src/orchestration/jrx-context-budgets.js';
import type { ModelEntry } from '../../src/services/intelligent-router/router-types.js';

const stub = (id: string, provider: ModelEntry['provider']): ModelEntry => ({
  id,
  provider,
  displayName: id,
  contextWindow: 128000,
  maxOutput: 8192,
  inputCostPer1k: 0.001,
  outputCostPer1k: 0.002,
  legalQuality: 90,
  latencyMs: 1000,
  preferredFor: [],
  jurisdictions: ['IN'],
});

describe('partner legal premium routing', () => {
  const prev: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });

  it('treats legal_drafting as premium legal task', () => {
    expect(isPartnerLegalQualityTask('legal_drafting')).toBe(true);
    expect(isPartnerLegalQualityTask('summarization')).toBe(false);
  });

  it('Bedrock-default cascade places Bedrock Claude before Gemini', () => {
    prev.JRX_BEDROCK_ENABLED = process.env.JRX_BEDROCK_ENABLED;
    prev.JRX_PARTNER_LEGAL_PREMIUM_FIRST = process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    prev.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    process.env.JRX_BEDROCK_ENABLED = '1';
    delete process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = 'test-placeholder';
    const seq = [stub('agentzero', 'agentzero')];
    const out = applyRoutingPolicy(
      seq,
      { app: 'NSP', taskKind: 'legal_research' },
      'enterprise',
      'legal_research',
    );
    const ids = out.map((m) => m.id);
    const bedrock = ids.findIndex((id) => id === 'us.anthropic.claude-opus-5');
    const sonnet = ids.findIndex((id) => id === 'global.anthropic.claude-sonnet-5');
    const gemini = ids.findIndex((id) => id === 'gemini-3-1-pro-preview');
    expect(sonnet).toBeGreaterThanOrEqual(0);
    expect(bedrock).toBeGreaterThan(sonnet);
    expect(gemini).toBeGreaterThan(bedrock);
  });

  it('litigation draft tasks still lead with Opus 5 when documentType is absent or pleading', () => {
    prev.JRX_BEDROCK_ENABLED = process.env.JRX_BEDROCK_ENABLED;
    prev.JRX_PARTNER_LEGAL_PREMIUM_FIRST = process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    prev.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    process.env.JRX_BEDROCK_ENABLED = '1';
    delete process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = 'test-placeholder';
    expect(isLegalDraftDeepFirstRouting('legal_drafting', { app: 'NSP' })).toBe(true);
    const seq = [stub('agentzero', 'agentzero')];
    const out = applyRoutingPolicy(
      seq,
      { app: 'NSP', taskKind: 'legal_drafting', draftDocumentType: 'writ_petition' },
      'enterprise',
      'legal_drafting',
    );
    const ids = out.map((m) => m.id);
    const bedrock = ids.findIndex((id) => id === 'us.anthropic.claude-opus-5');
    const sonnet = ids.findIndex((id) => id === 'global.anthropic.claude-sonnet-5');
    expect(bedrock).toBeGreaterThanOrEqual(0);
    expect(sonnet).toBeGreaterThan(bedrock);
  });

  it('transactional draft documentType leads with Sonnet 5 before Opus 5', () => {
    prev.JRX_BEDROCK_ENABLED = process.env.JRX_BEDROCK_ENABLED;
    prev.JRX_PARTNER_LEGAL_PREMIUM_FIRST = process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    prev.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    process.env.JRX_BEDROCK_ENABLED = '1';
    delete process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = 'test-placeholder';
    expect(isLegalDraftDeepFirstRouting('legal_drafting', {
      app: 'NSP',
      draftDocumentType: 'simple_agreement',
    })).toBe(false);
    const seq = [stub('agentzero', 'agentzero')];
    const out = applyRoutingPolicy(
      seq,
      { app: 'NSP', taskKind: 'legal_drafting', draftDocumentType: 'legal_notice' },
      'enterprise',
      'legal_drafting',
    );
    const ids = out.map((m) => m.id);
    const bedrock = ids.findIndex((id) => id === 'us.anthropic.claude-opus-5');
    const sonnet = ids.findIndex((id) => id === 'global.anthropic.claude-sonnet-5');
    expect(sonnet).toBeGreaterThanOrEqual(0);
    expect(bedrock).toBeGreaterThan(sonnet);
  });

  it('reads JRX_PARTNER_LEGAL_PREMIUM_MODELS without a code change', () => {
    prev.JRX_PARTNER_LEGAL_PREMIUM_MODELS = process.env.JRX_PARTNER_LEGAL_PREMIUM_MODELS;
    process.env.JRX_PARTNER_LEGAL_PREMIUM_MODELS = 'claude-sonnet-4-6,gemini-3-1-pro-preview';
    expect(getPartnerLegalPremiumLeadIds()).toEqual(['claude-sonnet-4-6', 'gemini-3-1-pro-preview']);
  });

  it('partner best-outcome raises RAG topK from env (default 16)', () => {
    prev.JRX_PARTNER_RAG_TOP_K = process.env.JRX_PARTNER_RAG_TOP_K;
    delete process.env.JRX_PARTNER_RAG_TOP_K;
    const b = resolveContextBudgets('moderate', { partnerBestOutcome: true });
    expect(b.ragTopK).toBeGreaterThanOrEqual(16);
    expect(b.parallelTimeoutMs).toBeGreaterThanOrEqual(45_000);
  });

  it('maps legal-draft-fast taskType string to Haiku-first SLA cascade (not Opus-first)', () => {
    prev.JRX_BEDROCK_ENABLED = process.env.JRX_BEDROCK_ENABLED;
    prev.JRX_PARTNER_LEGAL_PREMIUM_FIRST = process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    prev.JRX_LLM_CASCADE_LEAD = process.env.JRX_LLM_CASCADE_LEAD;
    prev.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    process.env.JRX_BEDROCK_ENABLED = '1';
    delete process.env.JRX_PARTNER_LEGAL_PREMIUM_FIRST;
    process.env.JRX_LLM_CASCADE_LEAD =
      'global.anthropic.claude-sonnet-5,us.anthropic.claude-opus-5,global.anthropic.claude-opus-4-8';
    if (!process.env.GOOGLE_API_KEY) process.env.GOOGLE_API_KEY = 'test-placeholder';
    const out = pickSequence({
      app: 'NSP',
      tier: 'enterprise',
      jurisdiction: 'IN',
      taskKind: 'legal-draft-fast' as any,
    });
    const ids = out.sequence.map((m) => m.id);
    const haiku = ids.findIndex((id) => id.includes('claude-haiku'));
    const opus = ids.findIndex((id) => id === 'us.anthropic.claude-opus-5');
    const sonnet = ids.findIndex((id) => id === 'global.anthropic.claude-sonnet-5');
    expect(haiku).toBeGreaterThanOrEqual(0);
    if (opus >= 0) expect(haiku).toBeLessThan(opus);
    if (sonnet >= 0 && opus >= 0) expect(sonnet).toBeLessThan(opus);
  });

  it('Claude 5.5 flags OFF ⇒ SLA fast ladder unchanged (no Haiku 5.5 lead)', () => {
    prev.JRX_F_BEDROCK_HAIKU_55_FAST = process.env.JRX_F_BEDROCK_HAIKU_55_FAST;
    prev.JRX_LLM_BASELINE_FROZEN = process.env.JRX_LLM_BASELINE_FROZEN;
    delete process.env.JRX_F_BEDROCK_HAIKU_55_FAST;
    delete process.env.JRX_LLM_BASELINE_FROZEN;
    const ids = getBedrockSlaFastLegalIds();
    expect(ids[0]).not.toBe(BEDROCK_CLAUDE_HAIKU_55);
    expect(ids.find((id) => id === BEDROCK_CLAUDE_HAIKU_55)).toBeUndefined();
  });

  it('Claude 5.5 flags ON ⇒ Haiku / Sonnet / Opus 5.5 prepended when baseline not frozen', () => {
    prev.JRX_F_BEDROCK_HAIKU_55_FAST = process.env.JRX_F_BEDROCK_HAIKU_55_FAST;
    prev.JRX_F_BEDROCK_SONNET_55_CHAT = process.env.JRX_F_BEDROCK_SONNET_55_CHAT;
    prev.JRX_F_BEDROCK_OPUS_55_COUNSEL = process.env.JRX_F_BEDROCK_OPUS_55_COUNSEL;
    prev.JRX_LLM_BASELINE_FROZEN = process.env.JRX_LLM_BASELINE_FROZEN;
    process.env.JRX_F_BEDROCK_HAIKU_55_FAST = '1';
    process.env.JRX_F_BEDROCK_SONNET_55_CHAT = '1';
    process.env.JRX_F_BEDROCK_OPUS_55_COUNSEL = '1';
    delete process.env.JRX_LLM_BASELINE_FROZEN;
    expect(getBedrockSlaFastLegalIds()[0]).toBe(BEDROCK_CLAUDE_HAIKU_55);
    expect(getBedrockClaudeFastIds()[0]).toBe(BEDROCK_CLAUDE_SONNET_55);
    expect(getBedrockClaudeDeepIds()[0]).toBe(BEDROCK_CLAUDE_OPUS_55);
  });

  it('JRX_LLM_BASELINE_FROZEN=1 blocks 5.5 even when feature flags ON', () => {
    prev.JRX_F_BEDROCK_HAIKU_55_FAST = process.env.JRX_F_BEDROCK_HAIKU_55_FAST;
    prev.JRX_LLM_BASELINE_FROZEN = process.env.JRX_LLM_BASELINE_FROZEN;
    process.env.JRX_F_BEDROCK_HAIKU_55_FAST = '1';
    process.env.JRX_LLM_BASELINE_FROZEN = '1';
    expect(getBedrockSlaFastLegalIds()[0]).not.toBe(BEDROCK_CLAUDE_HAIKU_55);
  });

  it('Bedrock region order is us-east-1 then ap-south-1 even if AWS_BEDROCK_REGION=ap-south-1', () => {
    prev.JRX_BEDROCK_REGION_ORDER = process.env.JRX_BEDROCK_REGION_ORDER;
    process.env.AWS_BEDROCK_REGION = 'ap-south-1';
    delete process.env.JRX_BEDROCK_REGION_ORDER;
    expect(getBedrockRegionOrder()).toEqual(['us-east-1', 'ap-south-1']);
  });
});
