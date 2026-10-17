import { describe, expect, it } from 'vitest';
import { isPgAuthFailed } from '../../src/utils/jrx-pg-auth-failed.js';
import { resolveApiError } from '../../client/src/lib/jrx-messages';

describe('isPgAuthFailed', () => {
  it('detects 28P01 on the error and on cause', () => {
    expect(isPgAuthFailed({ code: '28P01' })).toBe(true);
    expect(isPgAuthFailed({ cause: { code: '28P01' } })).toBe(true);
    expect(isPgAuthFailed({ cause: { cause: { code: '28P01' } } })).toBe(true);
    expect(isPgAuthFailed(new Error('password authentication failed for user "nyvadmin"'))).toBe(true);
    expect(isPgAuthFailed({ code: '42501' })).toBe(false);
  });
});

describe('resolveApiError login envelope', () => {
  it('does not stringify catalog error objects as [object Object]', () => {
    const msg = resolveApiError({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
    expect(msg.message).not.toMatch(/\[object Object\]/);
    expect(msg.message).toMatch(/unexpected error/i);
  });
});
