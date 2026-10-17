/**
 * T010 Stream A — Share-grant enforcement integration test.
 *
 * Acceptance: Org B requesting Org A's document MUST receive a 403 unless an
 * active row exists in `nv_doc_share_grants` matching either the org-specific
 * tuple or the ecosystem-wide tuple for B's platform. We exercise the
 * `assertReadAccess` strict variant directly because it owns the policy
 * decision; the express middleware is a thin wrapper around it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── DB mock — we control what `select(...).from(nvDocShareGrants).where(...)` returns ──
const mockReturned: any = { rows: [] as any[] };

vi.mock('../../src/db/index.js', () => {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    from:   vi.fn().mockReturnThis(),
    where:  vi.fn(async () => mockReturned.rows),
  };
  return { db: builder };
});

vi.mock('../../src/config/jrx-dms-config.js', () => ({
  getJrxDmsConfig: () => ({
    sharing: {
      auditEveryGrant: false,
      auditEveryCrossPlatformRead: false,
      autoShareLargeDocs: false,
      autoShareThresholdMb: 50,
      ecosystemPlatforms: ['NSP', 'NSI'],
    },
    backend: { sharedBucket: 'jrx-shared-documents' },
  }),
}));

import { assertReadAccess, DocAccessDeniedError, checkAccess } from '../../src/services/jrx-doc-sharing-service.js';

beforeEach(() => { mockReturned.rows = []; });

describe('share-grant enforcement (assertReadAccess)', () => {
  it('owner reading own document → allow without DB lookup', async () => {
    const r = await assertReadAccess('doc_owner', 'org-A', 'NSP', {
      ownerOrgId: 'org-A', ownerPlatformCode: 'NSP',
    });
    expect(r.hasAccess).toBe(true);
    expect(r.reason).toBe('owner');
  });

  it('Org B reading Org A document with NO grant → throws DocAccessDeniedError (403)', async () => {
    mockReturned.rows = []; // no rows
    await expect(
      assertReadAccess('doc_xyz', 'org-B', 'NSI', {
        ownerOrgId: 'org-A', ownerPlatformCode: 'NSP',
      }),
    ).rejects.toBeInstanceOf(DocAccessDeniedError);

    try {
      await assertReadAccess('doc_xyz', 'org-B', 'NSI', {
        ownerOrgId: 'org-A', ownerPlatformCode: 'NSP',
      });
    } catch (e: any) {
      expect(e.statusCode).toBe(403);
      expect(e.code).toBe('DOC_ACCESS_DENIED');
      expect(e.reason).toBe('no-grant');
    }
  });

  it('revoked grant (revoked_at set) → still 403 (filter excludes revoked)', async () => {
    mockReturned.rows = []; // sharing service filters on isNull(revoked_at)
    await expect(
      assertReadAccess('doc_revoked', 'org-B', 'NSI'),
    ).rejects.toMatchObject({ code: 'DOC_ACCESS_DENIED', reason: 'no-grant' });
  });

  it('expired grant → 403 with reason="expired"', async () => {
    mockReturned.rows = [{
      id: 1,
      documentId: 'doc_exp',
      grantedToPlatformCode: 'NSI',
      grantedToOrgId: 'org-B',
      grantType: 'read',
      grantReason: 'manual',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000), // expired 1m ago
    }];
    await expect(
      assertReadAccess('doc_exp', 'org-B', 'NSI'),
    ).rejects.toMatchObject({ code: 'DOC_ACCESS_DENIED', reason: 'expired' });
  });

  it('active org-specific grant → allow (reason="org-grant")', async () => {
    mockReturned.rows = [{
      id: 42,
      documentId: 'doc_ok',
      grantedToPlatformCode: 'NSI',
      grantedToOrgId: 'org-B',
      grantType: 'read',
      grantReason: 'manual',
      revokedAt: null,
      expiresAt: null,
    }];
    const r = await assertReadAccess('doc_ok', 'org-B', 'NSI');
    expect(r.hasAccess).toBe(true);
    expect(r.reason).toBe('org-grant');
    expect(r.grantId).toBe(42);
  });

  it('active ecosystem-wide grant (granted_to_org_id IS NULL) → allow', async () => {
    mockReturned.rows = [{
      id: 99,
      documentId: 'doc_eco',
      grantedToPlatformCode: 'NSI',
      grantedToOrgId: null,
      grantType: 'read',
      grantReason: 'auto-large-doc',
      revokedAt: null,
      expiresAt: null,
    }];
    const r = await assertReadAccess('doc_eco', 'org-B', 'NSI');
    expect(r.hasAccess).toBe(true);
    expect(r.reason).toBe('ecosystem-grant');
  });

  it('non-strict checkAccess returns hasAccess=false (no throw) for parity', async () => {
    mockReturned.rows = [];
    const r = await checkAccess('doc_chk', 'NSI', 'org-B');
    expect(r.hasAccess).toBe(false);
    expect(r.reason).toBe('no-grant');
  });
});
