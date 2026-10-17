/**
 * NV-NSP-SLA-QE-001 — partner SLA paths must not fail-closed on llm_route_budget /
 * citation / hallucination after a delivered lean answer.
 */
import { describe, it, expect } from 'vitest';
import {
  createQualityEnvelope,
  markIngressGates,
  markSafetyRingGates,
  markResponseAndAudit,
  reconcilePartnerSlaQualityEnvelope,
  assertQualityEnvelope,
} from '../../src/orchestration/jrx-quality-envelope.js';

describe('NV-NSP-SLA-QE-001: reconcilePartnerSlaQualityEnvelope', () => {
  it('legal-draft-fast shape: llm_route_budget failed → ok after reconcile', () => {
    const prev = process.env.JRX_QUALITY_ENVELOPE_FAIL_CLOSED;
    process.env.JRX_QUALITY_ENVELOPE_FAIL_CLOSED = '1';
    try {
      const env = createQualityEnvelope({
        requestId: 'draft-fast',
        path: 'specialist',
        partnerLean: true,
        risk: 'low',
        requireCoT: false,
        requireMakerChecker: false,
        requireHitlScaled: false,
      });
      markIngressGates(env);
      markSafetyRingGates(env, {
        ragAttempted: true,
        ragGrounded: true,
        hallucinationRan: false,
        citationRan: false,
        biasRan: true,
        piiRan: true,
        complianceRan: true,
        llmRouted: false,
      });
      markResponseAndAudit(env);
      reconcilePartnerSlaQualityEnvelope(env, {
        slaFast: true,
        serpOnly: false,
        deliveredContent: true,
        complianceOk: true,
        webSearchGrounded: false,
        llmAttempted: true,
      });
      expect(() => assertQualityEnvelope(env)).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.JRX_QUALITY_ENVELOPE_FAIL_CLOSED;
      else process.env.JRX_QUALITY_ENVELOPE_FAIL_CLOSED = prev;
    }
  });

  it('web-search SERP shape: citation failed → ok when grounded', () => {
    const env = createQualityEnvelope({
      requestId: 'web-search',
      path: 'specialist',
      partnerLean: true,
      risk: 'low',
      requireCoT: false,
      requireMakerChecker: false,
      requireHitlScaled: false,
    });
    markIngressGates(env);
    markSafetyRingGates(env, {
      ragAttempted: false,
      hallucinationRan: false,
      citationRan: false,
      biasRan: true,
      piiRan: true,
      complianceRan: true,
      llmRouted: true,
    });
    markResponseAndAudit(env);
    reconcilePartnerSlaQualityEnvelope(env, {
      slaFast: true,
      serpOnly: true,
      deliveredContent: true,
      complianceOk: true,
      webSearchGrounded: true,
      llmAttempted: true,
    });
    const snap = assertQualityEnvelope(env);
    expect(snap.ok).toBe(true);
    expect(snap.missingMandatory).toEqual([]);
  });
});
