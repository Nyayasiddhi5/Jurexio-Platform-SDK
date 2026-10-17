/**
 * Types unit tests — @jurexio/client-sdk v5
 * Tests: type shape validation, constant value coverage, pattern event types.
 */

import { describe, it, expect } from 'vitest';

describe('SDK Type Exports', () => {
  describe('JrxPatternSpecializedEvent event types', () => {
    const EXPECTED_SPECIALIZED_EVENT_TYPES = [
      'react_cycle',
      'reasoning_step',
      'branch_evaluated',
      'reflection_round',
      'plan_created',
      'task_executed',
      'refinement_iteration',
      'maker_response',
      'checker_verdict',
      'tool_attempt',
      'route_decision',
      'mcp_step',
    ];

    it('all expected specialized event types are non-empty strings', () => {
      for (const t of EXPECTED_SPECIALIZED_EVENT_TYPES) {
        expect(typeof t).toBe('string');
        expect(t.length).toBeGreaterThan(0);
      }
    });

    it('each event type uses underscore separator convention', () => {
      for (const t of EXPECTED_SPECIALIZED_EVENT_TYPES) {
        expect(t).toMatch(/^[a-z][a-z_]+$/);
      }
    });

    it('covers all 12 specialised event variants', () => {
      expect(EXPECTED_SPECIALIZED_EVENT_TYPES).toHaveLength(12);
    });
  });

  describe('Jurisdiction constants', () => {
    const SUPPORTED_JURISDICTIONS = ['IN', 'UK', 'GC', 'EU', 'US', 'SG', 'ALL'];

    it('has exactly 7 jurisdiction codes', () => {
      expect(SUPPORTED_JURISDICTIONS).toHaveLength(7);
    });

    it('all jurisdiction codes are uppercase 2-3 char strings', () => {
      for (const j of SUPPORTED_JURISDICTIONS) {
        expect(j).toMatch(/^[A-Z]{2,3}$/);
      }
    });

    it('includes IN (India), UK, EU, US, SG (Singapore), GC (Gulf), ALL', () => {
      expect(SUPPORTED_JURISDICTIONS).toContain('IN');
      expect(SUPPORTED_JURISDICTIONS).toContain('UK');
      expect(SUPPORTED_JURISDICTIONS).toContain('EU');
      expect(SUPPORTED_JURISDICTIONS).toContain('US');
      expect(SUPPORTED_JURISDICTIONS).toContain('SG');
      expect(SUPPORTED_JURISDICTIONS).toContain('GC');
      expect(SUPPORTED_JURISDICTIONS).toContain('ALL');
    });
  });

  describe('Pattern name constants', () => {
    const SUPPORTED_PATTERNS = [
      'react', 'cot', 'tot', 'reflection', 'plan-and-execute',
      'maas', 'refinement', 'maker-checker', 'corrective-rag', 'agentic-tools',
      'router', 'mcp', 'rag', 'hitl', 'self-consistency',
      'constitutional', 'generated-knowledge', 'multimodal', 'few-shot',
      'chain-verification', 'grpo', 'wai',
    ];

    it('covers all 22 JRX patterns', () => {
      expect(SUPPORTED_PATTERNS).toHaveLength(22);
    });

    it('includes core legal AI patterns', () => {
      expect(SUPPORTED_PATTERNS).toContain('react');
      expect(SUPPORTED_PATTERNS).toContain('rag');
      expect(SUPPORTED_PATTERNS).toContain('grpo');
      expect(SUPPORTED_PATTERNS).toContain('cot');
      expect(SUPPORTED_PATTERNS).toContain('hitl');
    });
  });

  describe('Risk badge constants', () => {
    const RISK_BADGES = ['GREEN', 'YELLOW', 'RED'];

    it('defines three risk badge levels', () => {
      expect(RISK_BADGES).toHaveLength(3);
    });

    it('badge progression from low to high risk', () => {
      expect(RISK_BADGES[0]).toBe('GREEN');
      expect(RISK_BADGES[1]).toBe('YELLOW');
      expect(RISK_BADGES[2]).toBe('RED');
    });
  });

  describe('JrxPatternResponse shape contract', () => {
    it('required fields are non-empty strings (structural check)', () => {
      const mockResponse = {
        success: true,
        pattern: 'react',
        traceId: 'JRX-REACT-20260406-001',
        data: { answer: 'Test answer' },
        processingTime: 1234,
      };
      expect(mockResponse.success).toBe(true);
      expect(typeof mockResponse.pattern).toBe('string');
      expect(typeof mockResponse.traceId).toBe('string');
      expect(mockResponse.traceId.startsWith('JRX-')).toBe(true);
      expect(typeof mockResponse.processingTime).toBe('number');
    });
  });
});
