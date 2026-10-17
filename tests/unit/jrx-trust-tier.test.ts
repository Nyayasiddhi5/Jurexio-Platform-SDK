import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  decideOrchestrateMemoryWrite,
  isEvalOrTestOrchestrateRequest,
} from '../../src/services/jrx-trust-tier.js';

function fakeReq(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return { body, headers } as unknown as Request;
}

describe('./jrx-trust-tier', () => {
  it('blocks eval fixture matter ids', () => {
    expect(isEvalOrTestOrchestrateRequest(fakeReq({ matterId: 'eval-bail-001' }))).toBe(true);
  });

  it('blocks unreviewed draft output from durable memory when gate enabled', () => {
    process.env.NYV_F_TRUST_TIER_MEMORY = '1';
    const decision = decideOrchestrateMemoryWrite({
      req: fakeReq({ taskType: 'legal-draft-fast' }),
      taskType: 'legal-draft-fast',
      content: 'IN THE HIGH COURT\n1. That the petitioner\nPRAYER',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.tier).toBe('T3_ai_output');
    delete process.env.NYV_F_TRUST_TIER_MEMORY;
  });

  it('allows explicit counsel acceptance', () => {
    process.env.NYV_F_TRUST_TIER_MEMORY = '1';
    const decision = decideOrchestrateMemoryWrite({
      req: fakeReq({ taskType: 'legal-draft', options: { counselAccepted: true } }),
      taskType: 'legal-draft',
      content: 'complete draft body',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.tier).toBe('T4_accepted_counsel');
    delete process.env.NYV_F_TRUST_TIER_MEMORY;
  });
});
