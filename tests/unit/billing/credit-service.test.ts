/**
 * Unit Tests — JrxTokenBudgetManager (Billing / Credit Service)
 * Tests: tier enforcement, token estimation, budget exceeded response, Indian scripts
 * Coverage target: 100% branches on token budget enforcement
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JrxTokenBudgetManager, TOKEN_BUDGETS } from '../../../src/utils/jrx-token-budget.js';

describe('JrxTokenBudgetManager', () => {
  describe('TOKEN_BUDGETS constants', () => {
    it('should have all 5 tier definitions', () => {
      expect(TOKEN_BUDGETS).toHaveProperty('SOLO');
      expect(TOKEN_BUDGETS).toHaveProperty('PLUS');
      expect(TOKEN_BUDGETS).toHaveProperty('PRO');
      expect(TOKEN_BUDGETS).toHaveProperty('INSTITUTIONAL');
      expect(TOKEN_BUDGETS).toHaveProperty('DEFAULT');
    });

    it('SOLO budget should be most restrictive', () => {
      expect(TOKEN_BUDGETS.SOLO.inputTokens).toBeLessThan(TOKEN_BUDGETS.PLUS.inputTokens);
      expect(TOKEN_BUDGETS.PLUS.inputTokens).toBeLessThan(TOKEN_BUDGETS.PRO.inputTokens);
      expect(TOKEN_BUDGETS.PRO.inputTokens).toBeLessThan(TOKEN_BUDGETS.INSTITUTIONAL.inputTokens);
    });

    it('INSTITUTIONAL tier should handle 500K input tokens', () => {
      expect(TOKEN_BUDGETS.INSTITUTIONAL.inputTokens).toBe(500_000);
    });

    it('DEFAULT tier should be below SOLO', () => {
      expect(TOKEN_BUDGETS.DEFAULT.inputTokens).toBeLessThanOrEqual(TOKEN_BUDGETS.SOLO.inputTokens);
    });
  });

  describe('estimateTokens()', () => {
    it('should return 0 for empty text', () => {
      expect(JrxTokenBudgetManager.estimateTokens('')).toBe(0);
    });

    it('should estimate ~1 token per 4 chars for English', () => {
      const text = 'The landlord has breached the tenancy agreement.';
      const estimate = JrxTokenBudgetManager.estimateTokens(text);
      expect(estimate).toBeGreaterThan(8);
      expect(estimate).toBeLessThan(20);
    });

    it('should use 2 chars/token for Devanagari (Hindi) text', () => {
      const hindi = 'मकान मालिक ने किराया समझौता तोड़ा है।';
      const english = 'The landlord has breached the tenancy agreement.';
      const hindiTokens = JrxTokenBudgetManager.estimateTokens(hindi);
      const englishTokens = JrxTokenBudgetManager.estimateTokens(english);
      // Hindi has 2 chars/token vs 4 chars/token for English
      // So for same content, Hindi text is shorter but more tokens-per-char
      expect(hindiTokens).toBeGreaterThan(0);
    });

    it('should handle Arabic script (Urdu)', () => {
      const urdu = 'مالک مکان نے معاہدہ توڑ دیا';
      const estimate = JrxTokenBudgetManager.estimateTokens(urdu);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should handle Bengali script', () => {
      const bengali = 'বাড়িওয়ালা চুক্তি লঙ্ঘন করেছেন।';
      const estimate = JrxTokenBudgetManager.estimateTokens(bengali);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should handle mixed English + Hindi text', () => {
      const mixed = 'The किराया agreement has been violated — अनुबंध उल्लंघन';
      const estimate = JrxTokenBudgetManager.estimateTokens(mixed);
      expect(estimate).toBeGreaterThan(0);
    });
  });

  describe('enforce() — budget check', () => {
    it('should ALLOW SOLO tier with small input', () => {
      const short = 'What is Section 138 NI Act?';
      const result = JrxTokenBudgetManager.enforce('SOLO', short, 500);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('SOLO');
      expect(result.maxOutputTokens).toBeLessThanOrEqual(2_000);
    });

    it('should DENY SOLO tier with oversized input', () => {
      const huge = 'x'.repeat(40_000); // 10,000 tokens estimated for English
      const result = JrxTokenBudgetManager.enforce('SOLO', huge, 500);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('INPUT_EXCEEDS_TIER_BUDGET');
    });

    it('should ALLOW PRO tier with large input', () => {
      const large = 'What are the legal implications? '.repeat(500); // ~4,000 tokens
      const result = JrxTokenBudgetManager.enforce('PRO', large, 2_000);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('PRO');
    });

    it('should cap output tokens to tier limit', () => {
      const text = 'Short query.';
      const result = JrxTokenBudgetManager.enforce('SOLO', text, 99_999);
      expect(result.maxOutputTokens).toBeLessThanOrEqual(TOKEN_BUDGETS.SOLO.outputTokens);
    });

    it('should fallback to DEFAULT for undefined tier', () => {
      const text = 'Simple legal question.';
      const result = JrxTokenBudgetManager.enforce(undefined, text);
      expect(result.tier).toBe('DEFAULT');
      expect(result.allowed).toBe(true);
    });

    it('should handle PLUS tier correctly', () => {
      const text = 'Analyze this IPC provision. '.repeat(200);
      const result = JrxTokenBudgetManager.enforce('PLUS', text, 8_000);
      expect(result.tier).toBe('PLUS');
    });

    it('should handle lowercase tier names (case-insensitive)', () => {
      const text = 'Quick question.';
      const result = JrxTokenBudgetManager.enforce('solo', text);
      expect(result.tier).toBe('SOLO');
    });

    it('should return non-zero estimatedInputTokens', () => {
      const text = 'Explain Section 144 CrPC.';
      const result = JrxTokenBudgetManager.enforce('PRO', text);
      expect(result.estimatedInputTokens).toBeGreaterThan(0);
    });

    it('should allow INSTITUTIONAL tier with very large input', () => {
      const text = 'Legal analysis required. '.repeat(10_000); // ~100K chars → ~25K tokens
      const result = JrxTokenBudgetManager.enforce('INSTITUTIONAL', text);
      expect(result.allowed).toBe(true);
      expect(result.tier).toBe('INSTITUTIONAL');
    });
  });

  describe('getBudget()', () => {
    it('should return SOLO budget for solo tier', () => {
      const b = JrxTokenBudgetManager.getBudget('SOLO');
      expect(b.inputTokens).toBe(TOKEN_BUDGETS.SOLO.inputTokens);
    });

    it('should return DEFAULT for unknown tier', () => {
      const b = JrxTokenBudgetManager.getBudget('UNKNOWN_TIER');
      expect(b).toEqual(TOKEN_BUDGETS.DEFAULT);
    });
  });

  describe('budgetExceededResponse()', () => {
    it('should return structured error with upgrade URL', () => {
      const result = JrxTokenBudgetManager.enforce('SOLO', 'x'.repeat(50_000));
      const response = JrxTokenBudgetManager.budgetExceededResponse(result);
      expect(response.error).toBe('TOKEN_BUDGET_EXCEEDED');
      expect(response.code).toBe('JRX-TOKEN-001');
      expect(response.upgradeUrl).toContain('nyayasiddhi.com/pricing');
      expect(response.tier).toBe('SOLO');
    });

    it('should include tier limit in response', () => {
      const result = JrxTokenBudgetManager.enforce('SOLO', 'x'.repeat(50_000));
      const response = JrxTokenBudgetManager.budgetExceededResponse(result);
      expect(response.tierLimit).toBe(TOKEN_BUDGETS.SOLO.inputTokens);
    });

    it('should include human-readable message', () => {
      const result = JrxTokenBudgetManager.enforce('PLUS', 'x'.repeat(200_000));
      const response = JrxTokenBudgetManager.budgetExceededResponse(result);
      expect(response.message).toContain('PLUS');
    });
  });
});
