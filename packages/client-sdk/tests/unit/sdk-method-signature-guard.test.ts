import { describe, expect, it } from 'vitest';
import {
  assertSdkMethodSignature,
  guardDocumentTextForReview,
  isSdkSignatureExempt,
  mapReviewEnvelope,
  normalizeAgentId,
  NvSdkPolicyViolationError,
} from '../../src/utils/sdkMethodSignatureGuard.js';

describe('sdkMethodSignatureGuard', () => {
  it('exempts /contract-review-deep from policy violation', () => {
    expect(isSdkSignatureExempt('/contract-review-deep')).toBe(true);
    expect(isSdkSignatureExempt('contract-review-deep')).toBe(true);
    const r = assertSdkMethodSignature({
      path: '/contract-review-deep',
      envelope: { method: 'contract_review', overall_risk: 'high' },
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('contract_review');
  });

  it('maps snake_case contract_review / document_review envelopes', () => {
    const mapped = mapReviewEnvelope({
      success: true,
      data: { method: 'document_review', risk_level: 'medium', clause_count: 3 },
    });
    expect(mapped?.method).toBe('document_review');
    expect(mapped?.camel.riskLevel).toBe('medium');
    expect(mapped?.camel.clauseCount).toBe(3);
  });

  it('normalizes deep agent id to contract-reviewer', () => {
    expect(normalizeAgentId('contract-review-deep')).toBe('contract-reviewer');
    expect(normalizeAgentId('document_review')).toBe('contract-reviewer');
  });

  it('still throws nv_sdk_policy_violation for unknown methods (guardrail kept)', () => {
    expect(() =>
      assertSdkMethodSignature({
        path: '/internal/custom-bot/run',
        method: 'totally_unknown_method',
      }),
    ).toThrow(NvSdkPolicyViolationError);
  });

  it('does not throw on successful gateway envelopes with any method', () => {
    const r = assertSdkMethodSignature({
      path: '/api/jrx/gateway/agents/A-025/execute',
      envelope: { success: true, method: 'agent_execution', data: {} },
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('agent_execution');
  });

  it('accepts gateway agent_execution envelopes (NSP A-025 / non-review agents)', () => {
    const r = assertSdkMethodSignature({
      path: '/api/jrx/gateway/agents/A-025/execute',
      agentId: 'A-025',
      envelope: {
        success: true,
        method: 'agent_execution',
        data: { agentId: 'A-025', response: 'Consideration is…' },
      },
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('agent_execution');
  });

  it('accepts agent execute paths with no method field', () => {
    const r = assertSdkMethodSignature({
      path: '/api/jrx/gateway/agents/legal-researcher/execute',
      envelope: { success: true, data: { response: 'ok' } },
    });
    expect(r.ok).toBe(true);
    expect(r.method).toBe('agent_execution');
  });

  it('does not treat legal-researcher as a document_review envelope', () => {
    const r = assertSdkMethodSignature({
      path: '/api/jrx/gateway/agents/legal-researcher/execute',
      agentId: 'legal-researcher',
      envelope: { success: true, data: { response: 'ok' } },
    });
    expect(r.method).toBe('agent_execution');
  });

  it('returns clear 400 body for empty / document-pending text', () => {
    const empty = guardDocumentTextForReview({ text: '  ' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.status).toBe(400);
      expect(empty.body.code).toBe('DOCUMENT_TEXT_PENDING_OR_EMPTY');
    }
    const pending = guardDocumentTextForReview({ text: 'x', status: 'document_pending' });
    expect(pending.ok).toBe(false);
    const ok = guardDocumentTextForReview({
      text: 'This is a sufficiently long contract clause for review testing purposes.',
    });
    expect(ok.ok).toBe(true);
  });
});
