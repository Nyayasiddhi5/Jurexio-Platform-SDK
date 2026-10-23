import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-cost-optimization-suite');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface CachedPrompt {
  agentId: string;
  prompt: string;
  version: string;
  cachedAt: Date;
  hit: boolean;
}

interface CacheHit {
  query: string;
  result: string;
  jurisdiction: JurisdictionCode;
  statuteVersion: string;
  cachedAt: Date;
  similarity: number;
}

interface SpeculativeResult {
  text: string;
  accepted: boolean;
  draftModel: string;
  verifyModel: string;
  tokensSaved: number;
}

interface CompressedContext {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
}

interface LLMRequest {
  model: string;
  prompt: string;
  maxTokens: number;
  userId?: string;
}

interface LLMResponse {
  text: string;
  tokens: number;
  model: string;
}

interface BudgetCheck {
  allowed: boolean;
  remainingBudget: number;
  estimatedCost: number;
  reason?: string;
}

interface TokenUsageReport {
  userId: string;
  period: 'day' | 'month';
  totalTokens: number;
  totalCost: number;
  byModel: Record<string, { tokens: number; cost: number }>;
  budgetRemaining: number;
}

const promptCache = new Map<string, CachedPrompt>();
const semanticCache = new Map<string, CacheHit>();
const tokenUsage = new Map<string, { tokens: number; cost: number }>();

class NvCostOptimizationSuite {
  async getSystemPromptCached(agentId: string): Promise<CachedPrompt> {
    const cacheKey = `nv:prompt:agent:${agentId}`;
    const cached = promptCache.get(cacheKey);

    if (cached) {
      logger.info({ method: 'getSystemPromptCached', agentId, hit: true });
      return { ...cached, hit: true };
    }

    const prompt = `[System prompt for agent ${agentId}]`;
    const entry: CachedPrompt = {
      agentId,
      prompt,
      version: '1.0',
      cachedAt: new Date(),
      hit: false,
    };
    promptCache.set(cacheKey, entry);
    logger.info({ method: 'getSystemPromptCached', agentId, hit: false });
    return entry;
  }

  async checkSemanticCache(query: string, jurisdiction: JurisdictionCode, statuteVersion: string): Promise<CacheHit | null> {
    const queryHash = crypto.createHash('sha256').update(`${query}:${jurisdiction}:${statuteVersion}`).digest('hex').slice(0, 16);
    const cached = semanticCache.get(queryHash);

    if (cached) {
      logger.info({ method: 'checkSemanticCache', hit: true, jurisdiction });
      return cached;
    }

    return null;
  }

  async storeSemanticCache(query: string, jurisdiction: JurisdictionCode, statuteVersion: string, result: string): Promise<void> {
    const queryHash = crypto.createHash('sha256').update(`${query}:${jurisdiction}:${statuteVersion}`).digest('hex').slice(0, 16);
    semanticCache.set(queryHash, {
      query,
      result,
      jurisdiction,
      statuteVersion,
      cachedAt: new Date(),
      similarity: 1.0,
    });
    logger.info({ method: 'storeSemanticCache', jurisdiction, queryHash });
  }

  async invalidateCacheForStatute(statuteId: string): Promise<number> {
    let invalidated = 0;
    for (const [key, entry] of semanticCache.entries()) {
      if (entry.result.includes(statuteId) || key.includes(statuteId)) {
        semanticCache.delete(key);
        invalidated++;
      }
    }
    logger.info({ method: 'invalidateCacheForStatute', statuteId, invalidated });
    return invalidated;
  }

  async speculativeDecode(
    query: string,
    context: string,
    draftModel: string,
    verifyModel: string
  ): Promise<SpeculativeResult> {
    logger.info({ method: 'speculativeDecode', draftModel, verifyModel });

    const draftText = `[Draft response from ${draftModel} for: ${query.slice(0, 50)}...]`;
    const accepted = true;

    return {
      text: draftText,
      accepted,
      draftModel,
      verifyModel,
      tokensSaved: accepted ? 500 : 0,
    };
  }

  async compressContext(context: string, targetRatio: number): Promise<CompressedContext> {
    const words = context.split(/\s+/);
    const originalTokens = Math.ceil(words.length * 1.3);

    const sentences = context.split(/[.!?]+/).filter(s => s.trim());
    const statutePattern = /section\s+\d+|article\s+\d+|act\s+\d{4}|sanhita|code/gi;

    const scoredSentences = sentences.map((s, i) => {
      let score = 0;
      if (statutePattern.test(s)) score += 10;
      if (i < 3 || i >= sentences.length - 2) score += 5;
      score += new Set(s.toLowerCase().split(/\s+/)).size / Math.max(s.split(/\s+/).length, 1) * 3;
      return { text: s.trim(), score };
    });

    scoredSentences.sort((a, b) => b.score - a.score);
    const targetCount = Math.max(Math.ceil(sentences.length * targetRatio), 3);
    const selected = scoredSentences.slice(0, targetCount);
    selected.sort((a, b) => sentences.indexOf(a.text + '.') - sentences.indexOf(b.text + '.'));

    const compressed = selected.map(s => s.text).join('. ') + '.';
    const compressedTokens = Math.ceil(compressed.split(/\s+/).length * 1.3);

    return {
      original: context,
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio: compressedTokens / Math.max(originalTokens, 1),
    };
  }

  async batchInfer(requests: LLMRequest[], maxBatchSize: number = 16): Promise<LLMResponse[]> {
    logger.info({ method: 'batchInfer', requestCount: requests.length, maxBatchSize });

    const batches: LLMRequest[][] = [];
    for (let i = 0; i < requests.length; i += maxBatchSize) {
      batches.push(requests.slice(i, i + maxBatchSize));
    }

    const results: LLMResponse[] = [];
    for (const batch of batches) {
      for (const req of batch) {
        results.push({
          text: `[Batch response for: ${req.prompt.slice(0, 30)}...]`,
          tokens: 100,
          model: req.model,
        });
      }
    }

    return results;
  }

  async checkTokenBudget(userId: string, estimatedTokens: number): Promise<BudgetCheck> {
    const usage = tokenUsage.get(userId) || { tokens: 0, cost: 0 };
    const budget = 1000000;
    const remaining = budget - usage.tokens;
    const allowed = remaining >= estimatedTokens;

    return {
      allowed,
      remainingBudget: Math.max(remaining, 0),
      estimatedCost: estimatedTokens * 0.00001,
      reason: allowed ? undefined : 'Token budget exceeded',
    };
  }

  async deductTokens(userId: string, tokens: number, modelId: string): Promise<void> {
    const usage = tokenUsage.get(userId) || { tokens: 0, cost: 0 };
    usage.tokens += tokens;
    usage.cost += tokens * 0.00001;
    tokenUsage.set(userId, usage);
    logger.info({ method: 'deductTokens', userId, tokens, modelId });
  }

  async getUserTokenUsage(userId: string, period: 'day' | 'month'): Promise<TokenUsageReport> {
    const usage = tokenUsage.get(userId) || { tokens: 0, cost: 0 };
    return {
      userId,
      period,
      totalTokens: usage.tokens,
      totalCost: usage.cost,
      byModel: {},
      budgetRemaining: Math.max(1000000 - usage.tokens, 0),
    };
  }
}

export const nvCostOptimizationSuite = new NvCostOptimizationSuite();
