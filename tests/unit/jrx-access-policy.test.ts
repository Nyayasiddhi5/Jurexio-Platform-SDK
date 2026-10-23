import { describe, expect, it } from 'vitest';
import { evaluateJrxAccessDecision } from '../../src/services/jrx-access-policy-service.js';

describe('JRX access policy v1', () => {
  it('denies unknown permission', () => {
    const r = evaluateJrxAccessDecision({
      permission: 'matter.not.a.real.permission',
      subjectId: 'person-1',
    });
    expect(r.decision).toBe('deny');
    expect(r.code).toBe('PERMISSION_UNKNOWN');
  });

  it('denies when resourceId set without matter policy', () => {
    const r = evaluateJrxAccessDecision({
      permission: 'matter.open.approve',
      subjectId: 'person-1',
      resourceId: 'matter-99',
    });
    expect(r.code).toBe('MATTER_POLICY_REQUIRED');
  });

  it('denies GUARDED self-approval', () => {
    const r = evaluateJrxAccessDecision({
      permission: 'matter.open.approve',
      subjectId: 'person-1',
      context: {
        heldPermissions: ['matter.open.approve'],
        stepUpVerified: true,
        requesterId: 'person-1',
      },
    });
    expect(r.code).toBe('SOD_SELF_APPROVAL_FORBIDDEN');
  });

  it('allows when permission held and step-up satisfied', () => {
    const r = evaluateJrxAccessDecision({
      permission: 'engine.review.approve',
      subjectId: 'person-2',
      context: {
        heldPermissions: ['engine.review.approve'],
        stepUpVerified: true,
        requesterId: 'person-1',
      },
    });
    expect(r.decision).toBe('allow');
    expect(r.code).toBe('ACCESS_ALLOWED');
  });
});
