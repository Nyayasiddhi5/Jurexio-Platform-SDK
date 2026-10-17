/**
 * task-367 (2026-05-13) — regression: JWT-only Console call to
 * /api/jrx/sdk/customer-orgs MUST resolve a real partner-platform
 * `applicationId` (not the historical 0 hard-code) so the SQL filter
 * `platform_id = sdkContext.applicationId` actually returns the
 * partner's customer firms.
 *
 * Two paths are covered:
 *   1. JWT carries the `applicationId` claim → bypass uses it directly.
 *   2. JWT does NOT carry the claim → bypass falls back to
 *      `resolveApplicationIdForOrg(organizationId)` (cached DB lookup).
 *
 * Implementation note: the global setup in tests/setup.ts hoists a
 * blanket db mock. We override the resolver module instead — that
 * keeps the test decoupled from the DB driver while still exercising
 * the real middleware code path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../../src/services/jrx-resolve-application-for-org.js', () => {
  const fn = vi.fn();
  return {
    resolveApplicationIdForOrg: fn,
    _resetApplicationIdCacheForTests: () => fn.mockReset(),
  };
});

import { sdkGatewayAuth } from '../../src/middleware/jrx-sdk-gateway.js';
import { resolveApplicationIdForOrg } from '../../src/services/jrx-resolve-application-for-org.js';

const SECRET = process.env.NYV_JWT_SECRET!;

interface CapturedResponse {
  status: number;
  body: any;
}

/**
 * Drive sdkGatewayAuth without supertest by faking a minimal Express
 * (req, res, next) trio. Captures the JSON response (or the populated
 * `sdkContext` if the middleware proceeds to the next handler).
 */
async function runMiddleware(token: string): Promise<{ res: CapturedResponse; sdkContext: any | null }> {
  const req: any = {
    headers: { authorization: `Bearer ${token}` },
    method: 'GET',
    path: '/probe',
    query: {},
    body: {},
  };
  const captured: CapturedResponse = { status: 200, body: undefined };
  const res: any = {
    status(code: number) { captured.status = code; return res; },
    json(payload: any) { captured.body = payload; return res; },
  };
  let nextCalled = false;
  await sdkGatewayAuth(req, res, () => { nextCalled = true; });
  return { res: captured, sdkContext: nextCalled ? req.sdkContext : null };
}

describe('task-367 — tryJwtBypass populates sdkContext.applicationId', () => {
  beforeEach(() => {
    (resolveApplicationIdForOrg as any).mockReset();
  });

  it('uses the applicationId claim from the JWT directly when present', async () => {
    const token = jwt.sign(
      { userId: 42, email: 'admin@nsp.example', role: 'org_admin', organizationId: 7, applicationId: 11 },
      SECRET,
      { expiresIn: '1h' }
    );
    const { sdkContext } = await runMiddleware(token);
    expect(sdkContext).toBeTruthy();
    expect(sdkContext.applicationId).toBe(11);
    expect(sdkContext.platformId).toBe(11);
    expect(sdkContext.organizationId).toBe(7);
    // The org_admin role MUST carry customer-orgs:admin so the
    // /api/jrx/sdk/customer-orgs scope guard passes.
    expect(sdkContext.scopes).toContain('customer-orgs:admin');
    // Claim was honoured — no DB fallback needed.
    expect(resolveApplicationIdForOrg).not.toHaveBeenCalled();
  });

  it('falls back to resolveApplicationIdForOrg(organizationId) when the claim is absent', async () => {
    (resolveApplicationIdForOrg as any).mockResolvedValue(99);
    const token = jwt.sign(
      { userId: 42, email: 'admin@nsp.example', role: 'org_admin', organizationId: 7 },
      SECRET,
      { expiresIn: '1h' }
    );
    const { sdkContext } = await runMiddleware(token);
    expect(sdkContext).toBeTruthy();
    expect(sdkContext.applicationId).toBe(99);
    expect(sdkContext.platformId).toBe(99);
    expect(resolveApplicationIdForOrg).toHaveBeenCalledWith(7);
  });

  it('leaves applicationId at 0 (and platformId undefined) when neither claim nor DB resolves', async () => {
    (resolveApplicationIdForOrg as any).mockResolvedValue(null);
    const token = jwt.sign(
      { userId: 42, email: 'admin@solo.example', role: 'org_admin', organizationId: 1234 },
      SECRET,
      { expiresIn: '1h' }
    );
    const { sdkContext } = await runMiddleware(token);
    expect(sdkContext).toBeTruthy();
    expect(sdkContext.applicationId).toBe(0);
    expect(sdkContext.platformId).toBeUndefined();
  });
});
