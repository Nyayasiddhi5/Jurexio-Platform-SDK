import { describe, it, expect } from 'vitest';
import {
  applyOrchestrationCounselDraftExitPolish,
  counselDraftExitNeedsPolish,
} from '../../src/services/jrx-orchestration-content-enforcers.js';

describe('NV-ORCH-COUNSEL-EXIT-POLISH P3', () => {
  it('detects abrupt counsel draft endings', () => {
    const abrupt = 'Grounds:\n1. The agreement provides that payment is due within';
    expect(counselDraftExitNeedsPolish(abrupt, 'simple_agreement')).toBe(true);
  });

  it('appends agreement closure on counsel path only', () => {
    const stub = 'Agreement between Party A and Party B.\n1. Payment terms.';
    const out = applyOrchestrationCounselDraftExitPolish(stub, {
      taskType: 'legal-draft',
      documentType: 'simple_agreement',
    });
    expect(out).toMatch(/IN WITNESS WHEREOF/i);
  });

  it('does not mutate legal-draft-fast (fast path owns polish)', () => {
    const stub = 'Incomplete fast stub';
    const out = applyOrchestrationCounselDraftExitPolish(stub, {
      taskType: 'legal-draft-fast',
      documentType: 'simple_agreement',
    });
    expect(out).toBe(stub);
  });
});
