/**
 * NV-LLM-CASCADE-CONFIG-001 — env/config overrides for LLM execution hierarchy.
 *
 * Code holds curated defaults (default-sequences + jrx-llm-routing-policy).
 * Ops can reorder without code changes via:
 *
 *   JRX_LLM_CASCADE_LEAD=deepseek.v3.2,qwen.qwen3-235b-a22b-2507-v1:0,...
 *   JRX_LLM_CASCADE_ULTIMATE=...   (optional ultimate fallback prepend)
 *   JRX_LLM_CASCADE_GEMINI=gemini-3-1-pro-preview,gemini-3-flash-preview,gemini-2.5-pro,...
 *   JRX_ROUTER_BEDROCK_FIRST=1|0
 *   JRX_BEDROCK_ENABLED=1|0
 *
 * Describe via describeLlmCascadeConfig() for admin/health.
 */
import { getGeminiCascadeModels } from './jrx-gemini-models.js';
import { isLlmCostProfileActive } from './jrx-llm-cost-profile.js';

export function parseModelIdList(raw: string | undefined | null): string[] {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getLlmCascadeLeadOverride(): string[] {
  return parseModelIdList(process.env.JRX_LLM_CASCADE_LEAD);
}

export function getLlmCascadeUltimateOverride(): string[] {
  return parseModelIdList(process.env.JRX_LLM_CASCADE_ULTIMATE);
}

export function getLlmCascadeGeminiOverride(): string[] {
  const fromEnv = parseModelIdList(process.env.JRX_LLM_CASCADE_GEMINI);
  if (fromEnv.length) return fromEnv;
  return getGeminiCascadeModels();
}

/**
 * NV-PARTNER-LEGAL-PREMIUM-001 — comma-separated model ids without a code change.
 * Example: JRX_PARTNER_LEGAL_PREMIUM_MODELS=claude-sonnet-4-6,gemini-3-1-pro-preview
 */
export function getPartnerLegalPremiumLeadIds(): string[] {
  return parseModelIdList(process.env.JRX_PARTNER_LEGAL_PREMIUM_MODELS);
}

/**
 * NV-BEDROCK-REGION-001 — always try us-east-1 (Marketplace / Claude / R1 / US Nova)
 * then ap-south-1 (India failover). Do not invert when AWS_BEDROCK_REGION=ap-south-1.
 * Override: JRX_BEDROCK_REGION_ORDER=us-east-1,ap-south-1
 */
export function getBedrockRegionOrder(): string[] {
  const fromEnv = parseModelIdList(process.env.JRX_BEDROCK_REGION_ORDER);
  if (fromEnv.length >= 1) {
    const rest = fromEnv.filter((r) => r !== fromEnv[0]);
    return [fromEnv[0]!, ...rest];
  }
  if (isLlmCostProfileActive()) {
    return ['ap-south-1', 'us-east-1'];
  }
  return ['us-east-1', 'ap-south-1'];
}

/** Human-readable hierarchy for docs / ops (no secrets). */
export function describeLlmCascadeConfig(): Record<string, unknown> {
  return {
    policyOrder: [
      '1. JRX_LLM_CASCADE_LEAD (optional env prepend)',
      '2. Bedrock us-east-1 → ap-south-1 (Opus 5 / Opus 4.8 / Sonnet 5 / DeepSeek / Nova)',
      '3. Gemini 3.x pool (JRX_LLM_CASCADE_GEMINI; falls back to 2.5)',
      '4. OpenRouter paid + direct Anthropic/OpenAI (JRX_PARTNER_LEGAL_PREMIUM_FIRST=1 restores these before Bedrock)',
      '5. OmniRoute (if enabled)',
      '6. OpenRouter :free last',
      '7. Scored MODEL_CATALOG remainder',
      '8. agentzero terminal',
    ],
    envKeys: [
      'JRX_LLM_CASCADE_LEAD',
      'JRX_LLM_CASCADE_ULTIMATE',
      'JRX_LLM_CASCADE_GEMINI',
      'JRX_BEDROCK_REGION_ORDER',
      'JRX_PARTNER_LEGAL_PREMIUM_MODELS',
      'JRX_PARTNER_LEGAL_PREMIUM_FIRST',
      'JRX_PARTNER_MAX_TOKENS_FLOOR',
      'JRX_PARTNER_MAX_TOKENS_CHAT',
      'JRX_PARTNER_MAX_TOKENS_FAST',
      'JRX_NSP_COUNSEL_QUEEN',
      'JRX_LEGAL_COMPREHENSIVE',
      'JRX_PARTNER_RAG_TOP_K',
      'JRX_ROUTER_BEDROCK_FIRST',
      'JRX_BEDROCK_ENABLED',
      'JRX_OMNIROUTE_ENABLED',
      'JRX_LLM_HEDGE_MS',
      'JRX_LLM_OPENROUTER_FREE_FIRST',
      'JRX_LLM_ALLOW_SPECULATIVE',
      'JRX_LLM_COST_PROFILE',
    ],
    leadOverride: getLlmCascadeLeadOverride(),
    ultimateOverride: getLlmCascadeUltimateOverride(),
    geminiPool: getLlmCascadeGeminiOverride(),
    partnerPremiumOverride: getPartnerLegalPremiumLeadIds(),
    bedrockRegionOrder: getBedrockRegionOrder(),
    bedrockFirst: String(process.env.JRX_ROUTER_BEDROCK_FIRST ?? 'default-on-when-bedrock'),
    costProfile: isLlmCostProfileActive(),
  };
}
