/**
 * NYV Token Budget Manager — enforces per-tier token limits on all LLM calls
 * Fixes Audit Finding AI004: Token budget management not enforced per request
 * Tiers: SOLO (8K input) | PLUS (32K) | PRO (128K) | INSTITUTIONAL (500K)
 * @file src/utils/jrx-token-budget.ts
 */
import { createLogger } from './logger.js';

const logger = createLogger('./jrx-token-budget');

// ── Tier-based token budgets ──────────────────────────────────────────────────
export const TOKEN_BUDGETS = {
  SOLO: {
    inputTokens: 8_000,
    outputTokens: 2_000,
    contextWindow: 16_000,
    dailyTotal: 50_000,
  },
  PLUS: {
    inputTokens: 32_000,
    outputTokens: 8_000,
    contextWindow: 64_000,
    dailyTotal: 200_000,
  },
  PRO: {
    inputTokens: 128_000,
    outputTokens: 32_000,
    contextWindow: 256_000,
    dailyTotal: 1_000_000,
  },
  INSTITUTIONAL: {
    inputTokens: 500_000,
    outputTokens: 128_000,
    contextWindow: 1_000_000,
    dailyTotal: 10_000_000,
  },
  // Platform defaults for internal/unauthenticated calls:
  DEFAULT: {
    inputTokens: 4_000,
    outputTokens: 1_000,
    contextWindow: 8_000,
    dailyTotal: 20_000,
  },
} as const;

export type SubscriptionTier = keyof typeof TOKEN_BUDGETS;

export interface TokenBudgetResult {
  allowed: boolean;
  maxOutputTokens: number;
  estimatedInputTokens: number;
  reason?: string;
  tier: SubscriptionTier;
}

export class NyvTokenBudgetManager {
  /**
   * Checks if the request is within budget and returns allowed output token limit.
   * @param tier - User's subscription tier
   * @param inputText - The prompt text to estimate tokens from
   * @param requestedOutput - How many output tokens the caller wants
   */
  static enforce(
    tier: string | undefined,
    inputText: string,
    requestedOutput: number = 2_000
  ): TokenBudgetResult {
    const resolvedTier = (tier?.toUpperCase() as SubscriptionTier) ?? 'DEFAULT';
    const budget = TOKEN_BUDGETS[resolvedTier] ?? TOKEN_BUDGETS.DEFAULT;

    const estimatedInputTokens = NyvTokenBudgetManager.estimateTokens(inputText);

    if (estimatedInputTokens > budget.inputTokens) {
      logger.warn(
        '[TokenBudget] Input exceeds tier budget',
        { tier: resolvedTier, estimated: estimatedInputTokens, limit: budget.inputTokens }
      );
      return {
        allowed: false,
        maxOutputTokens: 0,
        estimatedInputTokens,
        tier: resolvedTier,
        reason: `INPUT_EXCEEDS_TIER_BUDGET: ${estimatedInputTokens} tokens > ${budget.inputTokens} limit for ${resolvedTier} tier`,
      };
    }

    const maxOutput = Math.min(requestedOutput, budget.outputTokens);
    return {
      allowed: true,
      maxOutputTokens: maxOutput,
      estimatedInputTokens,
      tier: resolvedTier,
    };
  }

  /**
   * Estimates token count from text.
   * Approximation: 1 token ≈ 4 chars for English, 2 chars for Indian scripts (Devanagari, etc.)
   */
  static estimateTokens(text: string): number {
    if (!text) return 0;
    const hasIndic = /[\u0900-\u097F\u0600-\u06FF\u0980-\u09FF\u0A00-\u0A7F]/.test(text);
    return Math.ceil(text.length / (hasIndic ? 2 : 4));
  }

  /** Returns the budget config for a given tier */
  static getBudget(tier: string | undefined) {
    const resolvedTier = (tier?.toUpperCase() as SubscriptionTier) ?? 'DEFAULT';
    return TOKEN_BUDGETS[resolvedTier] ?? TOKEN_BUDGETS.DEFAULT;
  }

  /** Formats a budget exceeded error response */
  static budgetExceededResponse(result: TokenBudgetResult) {
    return {
      error: 'TOKEN_BUDGET_EXCEEDED',
      code: 'NYV-TOKEN-001',
      tier: result.tier,
      estimatedInputTokens: result.estimatedInputTokens,
      tierLimit: TOKEN_BUDGETS[result.tier]?.inputTokens,
      reason: result.reason,
      message: `Your ${result.tier} plan supports up to ${TOKEN_BUDGETS[result.tier]?.inputTokens?.toLocaleString()} input tokens per request. Upgrade for higher limits.`,
      upgradeUrl: 'https://nyayasiddhi.com/pricing',
    };
  }
}

export default NyvTokenBudgetManager;
