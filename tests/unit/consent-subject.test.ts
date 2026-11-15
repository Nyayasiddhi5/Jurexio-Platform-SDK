import { describe, expect, it } from 'vitest';
import {
  isPlatformOperator,
  resolveConsentSubject,
  type ConsentCaller,
} from '../../src/authz/consent-subject.js';

function caller(id: string, role?: string): ConsentCaller {
  return { id, role };
}

describe('isPlatformOperator', () => {
  it.each(['admin', 'super_admin', 'superadmin', 'service'])('admits %s', (role) => {
    expect(isPlatformOperator(role)).toBe(true);
  });

  it.each(['user', 'org_admin', 'sme', 'developer', 'manager', undefined])('rejects %s', (role) => {
    expect(isPlatformOperator(role)).toBe(false);
  });
});

describe('resolveConsentSubject', () => {
  it('rejects a missing caller', () => {
    expect(resolveConsentSubject(null, '42')).toEqual({ ok: false, status: 401 });
  });

  it('uses the caller when no other user is requested', () => {
    expect(resolveConsentSubject(caller('42', 'user'), undefined)).toEqual({
      ok: true,
      subjectUserId: '42',
    });
    expect(resolveConsentSubject(caller('42', 'user'), '')).toEqual({
      ok: true,
      subjectUserId: '42',
    });
  });

  it('allows a user to name themselves', () => {
    expect(resolveConsentSubject(caller('42', 'user'), '42')).toEqual({
      ok: true,
      subjectUserId: '42',
    });
  });

  it('refuses a user who names someone else', () => {
    expect(resolveConsentSubject(caller('42', 'user'), '7')).toEqual({ ok: false, status: 403 });
    expect(resolveConsentSubject(caller('42', 'org_admin'), '7')).toEqual({ ok: false, status: 403 });
    expect(resolveConsentSubject(caller('42', 'sme'), '7')).toEqual({ ok: false, status: 403 });
  });

  it('allows an operator to name another principal', () => {
    expect(resolveConsentSubject(caller('1', 'admin'), '7')).toEqual({
      ok: true,
      subjectUserId: '7',
    });
    expect(resolveConsentSubject(caller('service-account', 'service'), '7')).toEqual({
      ok: true,
      subjectUserId: '7',
    });
    expect(resolveConsentSubject(caller('1', 'superadmin'), '7')).toEqual({
      ok: true,
      subjectUserId: '7',
    });
  });
});
