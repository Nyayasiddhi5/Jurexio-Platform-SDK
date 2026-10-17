/**
 * NV-SESSION-POOLING-001 — an auto-minted session must never pool distinct
 * end-users of the same partner platform.
 *
 * Live defect this locks: for an SDK caller with no `x-customer-user-id`,
 * `userId` falls back to `sdk:<appName>` — identical for EVERY end user of that
 * platform. `mintEcosystemPromptSessionId` hashed `platform|org|user|day`, so all
 * NSP traffic collapsed into one session per day and session memory was written
 * under it. Two NSP calls on jrx-prod both returned
 * `jrx-sess-nsp-9ae2cc89bab6bce7`, and the model itself reported that "the
 * retrieved memory context in this session appears to belong to a different
 * matter/client thread" — cross-matter context reached the prompt and only the
 * model's refusal prevented disclosure. Model discretion is not access control.
 */
import { describe, it, expect } from 'vitest';
import {
  isAppLevelIdentity,
  mintEcosystemPromptSessionId,
} from '../../src/services/jrx-prompt-session-store.js';

describe('NV-SESSION-POOLING-001 — app-level identity detection', () => {
  it('treats the SDK fallback identity as app-level, not a user', () => {
    expect(isAppLevelIdentity('sdk:Nyayasiddhi Professional™')).toBe(true);
    expect(isAppLevelIdentity('sdk_app_42')).toBe(true);
    expect(isAppLevelIdentity('sdk-123')).toBe(true);
  });

  it('treats missing / anon identity as app-level', () => {
    expect(isAppLevelIdentity(undefined)).toBe(true);
    expect(isAppLevelIdentity('')).toBe(true);
    expect(isAppLevelIdentity('   ')).toBe(true);
    expect(isAppLevelIdentity('anon')).toBe(true);
  });

  it('treats a real end-user id as a user', () => {
    expect(isAppLevelIdentity('nsp-user-9931')).toBe(false);
    expect(isAppLevelIdentity('42')).toBe(false);
    expect(isAppLevelIdentity('advocate@firm.in')).toBe(false);
  });
});

describe('NV-SESSION-POOLING-001 — minting cannot pool matters', () => {
  it('does NOT reuse one session for two calls with only an app-level identity', () => {
    const opts = {
      platform: 'NSP',
      userId: 'sdk:Nyayasiddhi Professional™',
      orgId: '10000000',
    };
    const a = mintEcosystemPromptSessionId(opts);
    const b = mintEcosystemPromptSessionId(opts);
    // This is the exact pair that collapsed to jrx-sess-nsp-9ae2cc89bab6bce7 live.
    expect(a).not.toBe(b);
    expect(a).toContain('-req-');
  });

  it('still gives a STABLE per-day session when a real end-user id is supplied', () => {
    const opts = { platform: 'NSP', userId: 'nsp-user-9931', orgId: '10000000' };
    expect(mintEcosystemPromptSessionId(opts)).toBe(mintEcosystemPromptSessionId(opts));
  });

  it('partitions distinct end users of the same platform and org', () => {
    const a = mintEcosystemPromptSessionId({ platform: 'NSP', userId: 'nsp-user-9931', orgId: '10000000' });
    const b = mintEcosystemPromptSessionId({ platform: 'NSP', userId: 'nsp-user-5502', orgId: '10000000' });
    expect(a).not.toBe(b);
  });

  it('partitions the same user across different orgs (multi-tenant)', () => {
    const a = mintEcosystemPromptSessionId({ platform: 'NSP', userId: 'u-1', orgId: 'org-A' });
    const b = mintEcosystemPromptSessionId({ platform: 'NSP', userId: 'u-1', orgId: 'org-B' });
    expect(a).not.toBe(b);
  });

  it('an explicit sessionId always wins — including over the pooling guard', () => {
    // A partner that manages its own threads must not be second-guessed.
    expect(
      mintEcosystemPromptSessionId({
        platform: 'NSP',
        userId: 'sdk:Nyayasiddhi Professional™',
        orgId: '10000000',
        explicitSessionId: 'nsp-thread-777',
      }),
    ).toBe('nsp-thread-777');
  });

  it('keeps the platform prefix so a session id stays attributable in logs', () => {
    expect(
      mintEcosystemPromptSessionId({ platform: 'NYM', userId: 'nym-user-3', orgId: 'o1' }),
    ).toMatch(/^jrx-sess-nym-/);
  });
});
