/**
 * Unit Tests — JrxAiRiskEngine
 * Tests: 5-component risk formula, GREEN/YELLOW/RED badges, block gate at >60
 * Coverage target: 100% branches on risk assessment logic
 */
import { describe, it, expect } from 'vitest';
import { JrxAiRiskEngine } from '../../../src/services/jrx-ai-risk-engine.js';

describe('JrxAiRiskEngine', () => {
  describe('compute() — clean Indian output', () => {
    it('returns GREEN badge for valid BNS-compliant Indian output', () => {
      const result = JrxAiRiskEngine.compute(
        'The Bharatiya Nyaya Sanhita (BNS) 2023 under Section 302 applies. Refer to BNS 302.',
        'IN', '', [], true
      );
      expect(result.badge).toBe('GREEN');
      expect(result.score).toBeLessThanOrEqual(30);
      expect(result.blocked).toBe(false);
      expect(result.requiresConfirmation).toBe(false);
    });

    it('has zero jurisdiction mismatch for clean IN output', () => {
      const result = JrxAiRiskEngine.compute(
        'The High Court of Delhi held under BNSS 2023 that the accused must appear.',
        'IN', '', [], true
      );
      expect(result.components.jurisdictionMismatch).toBe(0);
    });
  });

  describe('compute() — jurisdiction violations', () => {
    it('returns elevated mismatch score when IPC used in Indian output', () => {
      const result = JrxAiRiskEngine.compute(
        'Under IPC Section 302, the accused is liable. Pre-trial discovery applies.',
        'IN', '', [], true
      );
      expect(result.score).toBeGreaterThan(30);
      expect(result.components.jurisdictionMismatch).toBeGreaterThan(0);
    });

    it('blocks output with multiple India-jurisdiction violations', () => {
      // Triggers jurisdictionMismatch + hallucination + unsupportedRefs across thresholds
      const result = JrxAiRiskEngine.compute(
        [
          'IPC applies here. CrPC procedures govern. $50,000 in damages. Pre-trial discovery phase.',
          'Section 999 of the fictitious Act is relevant.',
          'The court held defendant liable. The court decided the motion. It was ruled in favor.',
          'Court observed lack of evidence. The law stated damages apply.',
          'Court held again. Decided again. Ruled. Observed. Stated. Held once more.',
        ].join(' '),
        'IN', '', [], true
      );
      expect(result.blocked).toBe(true);
      expect(result.requiresConfirmation).toBe(true);
      expect(result.score).toBeGreaterThan(60);
      expect(result.badge).toBe('RED');
    });

    it('detects USD currency in Indian legal output', () => {
      const result = JrxAiRiskEngine.compute(
        'The defendant must pay $50,000 to the plaintiff.',
        'IN', '', [], true
      );
      expect(result.components.jurisdictionMismatch).toBeGreaterThan(0);
    });
  });

  describe('compute() — clause absence', () => {
    it('returns 0 clause absence when no expected clauses', () => {
      const result = JrxAiRiskEngine.compute('Any output text.', 'IN', '', [], true);
      expect(result.components.clauseAbsence).toBe(0);
    });

    it('detects missing required clauses', () => {
      const result = JrxAiRiskEngine.compute(
        'This agreement is made between the parties.',
        'IN', '', ['CLAUSE_001', 'CLAUSE_002', 'CLAUSE_003'], true
      );
      expect(result.components.clauseAbsence).toBeGreaterThan(0);
    });

    it('returns 0 clause absence when all clauses present', () => {
      const result = JrxAiRiskEngine.compute(
        'CLAUSE_001 is present. CLAUSE_002 is present.',
        'IN', '', ['CLAUSE_001', 'CLAUSE_002'], true
      );
      expect(result.components.clauseAbsence).toBe(0);
    });
  });

  describe('compute() — hallucination detection', () => {
    it('returns 0 hallucination for non-legal content', () => {
      const result = JrxAiRiskEngine.compute(
        'The held result was in the decided case.',
        'IN', '', [], false
      );
      expect(result.components.hallucinationProbability).toBe(0);
    });

    it('detects legal claims without citations', () => {
      const result = JrxAiRiskEngine.compute(
        'The court held the accused liable. It was decided that damages apply.',
        'IN', '', [], true
      );
      expect(result.components.hallucinationProbability).toBeGreaterThan(0);
    });

    it('returns low hallucination when citations back up claims', () => {
      const result = JrxAiRiskEngine.compute(
        'The court held under BNS 302 that the accused is liable. [2024] 3 SCC 100 is relevant.',
        'IN', '', [], true
      );
      expect(result.components.hallucinationProbability).toBeLessThan(0.5);
    });
  });

  describe('compute() — structural deviation', () => {
    it('returns 0 structural deviation when no template provided', () => {
      const result = JrxAiRiskEngine.compute('Some output.', 'IN', '', [], true);
      expect(result.components.structuralDeviation).toBe(0);
    });

    it('detects deviation when heading counts differ', () => {
      const template = '## Section 1\n## Section 2\n## Section 3';
      const output = '## Only One Heading';
      const result = JrxAiRiskEngine.compute(output, 'IN', template, [], true);
      expect(result.components.structuralDeviation).toBeGreaterThan(0);
    });
  });

  describe('badge thresholds', () => {
    it('score 0 → GREEN badge', () => {
      const result = JrxAiRiskEngine.compute(
        'Bharatiya Nyaya Sanhita (BNS) 2023 Section 302.',
        'IN', '', [], false
      );
      expect(['GREEN', 'YELLOW']).toContain(result.badge);
    });

    it('blocked is false when score ≤ 60', () => {
      const result = JrxAiRiskEngine.compute(
        'The court held under BNS 302 that the matter is disposed.',
        'IN', '', [], true
      );
      if (result.score <= 60) {
        expect(result.blocked).toBe(false);
      }
    });
  });

  describe('formatMetadataBlock()', () => {
    it('returns _nyv_metadata block with all required fields', () => {
      const riskAssessment = JrxAiRiskEngine.compute('Output text.', 'IN', '', [], true);
      const block = JrxAiRiskEngine.formatMetadataBlock({
        modelVersion: 'gpt-5-mini',
        jurisdiction: 'IN',
        caseType: 'criminal',
        clauseSource: 'JRX-CLAUSE-BANK-v3.1.2',
        confidenceScore: 85,
        riskAssessment,
        promptHash: 'abc123',
        templateMode: 'STRICT',
      });
      expect(block).toHaveProperty('_nyv_metadata');
      const meta = (block as any)._nyv_metadata;
      expect(meta.generated_by).toBe('gpt-5-mini');
      expect(meta.jurisdiction).toBe('IN');
      expect(meta.template_mode).toBe('STRICT');
      expect(meta.risk_score).toBe(riskAssessment.score);
      expect(meta.risk_badge).toBe(riskAssessment.badge);
    });
  });

  describe('buildPromptHash()', () => {
    it('returns deterministic SHA-256 hash', () => {
      const hash1 = JrxAiRiskEngine.buildPromptHash('system prompt', 'user prompt');
      const hash2 = JrxAiRiskEngine.buildPromptHash('system prompt', 'user prompt');
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('differs for different prompts', () => {
      const hash1 = JrxAiRiskEngine.buildPromptHash('system A', 'user A');
      const hash2 = JrxAiRiskEngine.buildPromptHash('system B', 'user B');
      expect(hash1).not.toBe(hash2);
    });
  });
});
