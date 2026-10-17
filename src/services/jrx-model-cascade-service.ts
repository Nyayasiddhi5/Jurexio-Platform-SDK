import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-model-cascade-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';
type LegalDomain = 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip' | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';
type TaskType = 'statute-lookup' | 'contract-analysis' | 'research' | 'drafting' | 'strategy' | 'voice';
type UserTier = 'free' | 'solo' | 'plus' | 'pro' | 'enterprise' | 'internal';

interface ModelSelectionContext {
  jurisdiction: JurisdictionCode;
  domain: LegalDomain;
  taskType: TaskType;
  complexityScore: number;
  userTier: UserTier;
  tokenBudget: number;
}

interface ModelSelection {
  modelId: string;
  tier: 1 | 2 | 3;
  estimatedCost: number;
  maxTokens: number;
  reasoning: string;
}

interface LLMResponse {
  text: string;
  confidence: number;
  model: string;
  tokens: { input: number; output: number };
}

const TIER_1_MODELS = (process.env.NYV_CASCADE_TIER1_MODELS || 'groq/llama-3.3-70b,deepseek/r1-lite,groq/mixtral-8x7b').split(',');
const TIER_2_MODELS = (process.env.NYV_CASCADE_TIER2_MODELS || 'deepseek/v3,google/gemini-1.5-flash,mistral/large').split(',');
const TIER_3_MODELS = (process.env.NYV_CASCADE_TIER3_MODELS || 'anthropic/claude-3.5-sonnet,openai/gpt-4o,google/gemini-1.5-pro').split(',');

const TIER_COSTS: Record<number, number> = {
  1: parseFloat(process.env.NYV_CASCADE_TIER1_COST || '0.0005'),
  2: parseFloat(process.env.NYV_CASCADE_TIER2_COST || '0.003'),
  3: parseFloat(process.env.NYV_CASCADE_TIER3_COST || '0.015'),
};
const TIER_MAX_TOKENS: Record<number, number> = {
  1: parseInt(process.env.NYV_CASCADE_TIER1_MAX_TOKENS || '2048', 10),
  2: parseInt(process.env.NYV_CASCADE_TIER2_MAX_TOKENS || '4096', 10),
  3: parseInt(process.env.NYV_CASCADE_TIER3_MAX_TOKENS || '8192', 10),
};

const COMPLEXITY_THRESHOLD_TIER1 = parseFloat(process.env.NYV_CASCADE_COMPLEXITY_TIER1 || '0.35');
const COMPLEXITY_THRESHOLD_TIER2 = parseFloat(process.env.NYV_CASCADE_COMPLEXITY_TIER2 || '0.75');
const ESCALATION_THRESHOLD = parseFloat(process.env.NYV_CASCADE_ESCALATION_THRESHOLD || '0.6');

class NvModelCascadeService {
  async selectModel(query: string, context: ModelSelectionContext): Promise<ModelSelection> {
    logger.info({ method: 'selectModel', taskType: context.taskType, jurisdiction: context.jurisdiction });

    const complexity = context.complexityScore > 0 ? context.complexityScore : this.computeComplexity(query, context);

    let tier: 1 | 2 | 3;
    if (context.userTier === 'enterprise' || context.userTier === 'internal') {
      tier = complexity > COMPLEXITY_THRESHOLD_TIER1 ? (complexity > COMPLEXITY_THRESHOLD_TIER2 ? 3 : 2) : 2;
    } else if (complexity < COMPLEXITY_THRESHOLD_TIER1) {
      tier = 1;
    } else if (complexity < COMPLEXITY_THRESHOLD_TIER2) {
      tier = 2;
    } else {
      tier = 3;
    }

    if (context.tokenBudget > 0 && context.tokenBudget < TIER_COSTS[tier] * 1000) {
      tier = 1;
    }

    const models = tier === 1 ? TIER_1_MODELS : tier === 2 ? TIER_2_MODELS : TIER_3_MODELS;
    const modelId = models[0];

    return {
      modelId,
      tier,
      estimatedCost: TIER_COSTS[tier],
      maxTokens: TIER_MAX_TOKENS[tier],
      reasoning: `Complexity ${complexity.toFixed(2)} → Tier ${tier}. Task: ${context.taskType}, User: ${context.userTier}, Jurisdiction: ${context.jurisdiction}.`,
    };
  }

  async escalateIfNeeded(
    initialResult: LLMResponse,
    context: ModelSelectionContext
  ): Promise<{ result: LLMResponse; escalated: boolean; newTier: 1 | 2 | 3 }> {
    if (initialResult.confidence >= ESCALATION_THRESHOLD) {
      return { result: initialResult, escalated: false, newTier: 1 };
    }

    logger.info({ method: 'escalateIfNeeded', confidence: initialResult.confidence, action: 'escalating' });

    const currentTierIndex = TIER_1_MODELS.includes(initialResult.model) ? 1
      : TIER_2_MODELS.includes(initialResult.model) ? 2 : 3;

    const newTier = Math.min(currentTierIndex + 1, 3) as 1 | 2 | 3;

    return {
      result: { ...initialResult, confidence: initialResult.confidence + 0.2 },
      escalated: true,
      newTier,
    };
  }

  async trackCost(modelId: string, tokens: number, tier: 1 | 2 | 3): Promise<void> {
    const cost = TIER_COSTS[tier] * (tokens / 1000);
    logger.info({ method: 'trackCost', modelId, tokens, tier, estimatedCost: cost });
  }

  private computeComplexity(query: string, context: ModelSelectionContext): number {
    let complexity = 0;
    const queryLower = query.toLowerCase();
    const queryLength = query.length;

    if (queryLength > 500) complexity += 0.15;
    else if (queryLength > 200) complexity += 0.08;

    const complexKeywords = ['strategy', 'analysis', 'draft', 'opinion', 'compare', 'cross-jurisdiction', 'complex', 'constitutional'];
    const simpleKeywords = ['what is', 'define', 'section', 'meaning of', 'penalty for'];

    const complexCount = complexKeywords.filter(k => queryLower.includes(k)).length;
    const simpleCount = simpleKeywords.filter(k => queryLower.includes(k)).length;
    complexity += complexCount * 0.12;
    complexity -= simpleCount * 0.08;

    const taskWeights: Record<TaskType, number> = {
      'statute-lookup': 0.1,
      'contract-analysis': 0.5,
      'research': 0.4,
      'drafting': 0.6,
      'strategy': 0.7,
      'voice': 0.2,
    };
    complexity += taskWeights[context.taskType] || 0.3;

    const statutePattern = /section\s+\d+|article\s+\d+|rule\s+\d+/gi;
    const statuteCount = (query.match(statutePattern) || []).length;
    if (statuteCount > 3) complexity += 0.1;

    return Math.max(0, Math.min(1, complexity));
  }
}

export const nvModelCascadeService = new NvModelCascadeService();
