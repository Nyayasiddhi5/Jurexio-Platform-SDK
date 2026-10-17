/**
 * NV-CONSOLE-JWT-DUAL-001 — dualSdkOrJwt must not treat Console JWTs as SDK keys.
 */
import { describe, expect, it } from 'vitest';
import { isSdkBearerCredential } from '../../src/middleware/jrx-sdk-auth-header.js';

describe('isSdkBearerCredential (NV-CONSOLE-JWT-DUAL-001)', () => {
  it('accepts canonical nyv_ SDK key prefixes', () => {
    expect(isSdkBearerCredential('nyv_key_abc123')).toBe(true);
    expect(isSdkBearerCredential('nyv_sk_abc123')).toBe(true);
    expect(isSdkBearerCredential('  nyv_key_x  ')).toBe(true);
  });

  it('rejects compact JWTs (Console Authorization Bearer)', () => {
    const jwt =
      '[PURGED-JWT]';
    expect(isSdkBearerCredential(jwt)).toBe(false);
  });

  it('rejects empty / whitespace', () => {
    expect(isSdkBearerCredential('')).toBe(false);
    expect(isSdkBearerCredential('   ')).toBe(false);
  });
});
