/**
 * task-367 (2026-05-13) — route-level regression: a JWT-only Console
 * call to GET /api/jrx/sdk/customer-orgs MUST flow through the SDK
 * gateway bypass with a real applicationId (not 0) AND emit the
 * platform-scoped SQL filter `platform_id = <resolved id>`.
 *
 * This complements the middleware-level test in
 * `jwt-bypass-application-id.test.ts` by locking in end-to-end behavior
 * across:
 *   - tryJwtBypass (resolves applicationId via the resolver)
 *   - the customer-orgs admin-scope guard (org_admin → customer-orgs:admin)
 *   - platformIdOrFail in nv-customer-orgs-routes.ts (uses sdkContext.applicationId)
 *
 * The global db mock returns a thenable chain via vi.mock; we override
 * `db.execute` per-test to capture the SQL bind values and assert the
 * platform_id filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import express, { type Request, type Response } from 'express';
import { createServer, type Server } from 'http';
import { AddressInfo } from 'net';

vi.mock('../../src/services/jrx-resolve-application-for-org.js', () => {
  const fn = vi.fn();
  return {
    resolveApplicationIdForOrg: fn,
    _resetApplicationIdCacheForTests: () => fn.mockReset(),
  };
});

import { db } from '../../src/db/index.js';
import { resolveApplicationIdForOrg } from '../../src/services/jrx-resolve-application-for-org.js';
import customerOrgsRouter from '../../src/routes/jrx-customer-orgs-routes.js';

const SECRET = process.env.NYV_JWT_SECRET!;

async function withApp<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use('/api/jrx/sdk/customer-orgs', customerOrgsRouter);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('task-367 — GET /api/jrx/sdk/customer-orgs (JWT-only) uses resolved platformId', () => {
  beforeEach(() => {
    (resolveApplicationIdForOrg as any).mockReset();
    (db!.execute as any).mockReset?.();
  });

  it('a Console JWT (org_admin, no SDK key) returns the partner-platform list, scoped to the resolved platform_id', async () => {
    // Resolver resolves NSP org → sdk_applications.id = 11.
    (resolveApplicationIdForOrg as any).mockResolvedValue(11);

    // Capture every SQL the route emits. The drizzle-orm mock in
    // tests/setup.ts represents a tagged template as { strings, values },
    // so we can inspect the bound values to confirm platform_id = 11
    // (not the historical 0).
    const sqlCalls: any[] = [];
    (db!.execute as any).mockImplementation((q: any) => {
      sqlCalls.push(q);
      // First call: the SELECT … FROM nv_customer_organizations list.
      // Return a single fake firm so the response body is non-empty.
      if (sqlCalls.length === 1) {
        return Promise.resolve({
          rows: [{
            id: 501, platform_id: 11, external_ref: 'sharma-co',
            display_name: 'Sharma & Co Law Firm', jurisdiction: 'IN',
            tier: 'standard', data_residency: 'IN', status: 'active',
            metadata: {}, created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }],
        });
      }
      // Second call: COUNT(*).
      return Promise.resolve({ rows: [{ n: 1 }] });
    });

    const token = jwt.sign(
      { userId: 42, email: 'admin@nsp.example', role: 'org_admin', organizationId: 7 },
      SECRET,
      { expiresIn: '1h' }
    );

    await withApp(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/api/jrx/sdk/customer-orgs?limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(resp.status).toBe(200);
      const body: any = await resp.json();
      expect(body.success).toBe(true);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].display_name).toBe('Sharma & Co Law Firm');
      expect(body.data.total).toBe(1);
    });

    // Resolver was consulted for the partner-platform org.
    expect(resolveApplicationIdForOrg).toHaveBeenCalledWith(7);

    // Both SQL calls (list + COUNT) MUST bind platform_id = 11. The
    // drizzle mock surfaces bound values as { strings, values } — every
    // route in nv-customer-orgs-routes.ts emits platform_id as the first
    // bound value. Asserting on values[0] catches the historical
    // hard-code-to-0 regression without false positives from LIMIT/OFFSET.
    expect(sqlCalls.length).toBeGreaterThanOrEqual(2);
    for (const q of sqlCalls) {
      const concatStrings = (q.strings ?? []).join(' ');
      expect(concatStrings).toContain('platform_id');
      expect(q.values?.[0]).toBe(11);
    }
  });

  it('rejects when the JWT cannot be resolved to any sdk_applications row (401, no SQL emitted)', async () => {
    (resolveApplicationIdForOrg as any).mockResolvedValue(null);
    const sqlCalls: any[] = [];
    (db!.execute as any).mockImplementation((q: any) => {
      sqlCalls.push(q);
      return Promise.resolve({ rows: [] });
    });

    const token = jwt.sign(
      { userId: 42, email: 'orphan@example', role: 'org_admin', organizationId: 9999 },
      SECRET,
      { expiresIn: '1h' }
    );

    await withApp(async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/api/jrx/sdk/customer-orgs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(resp.status).toBe(401);
      const body: any = await resp.json();
      expect(body.code).toBe('CUSTOMER_ORG_PLATFORM_REQUIRED');
    });

    // platformIdOrFail rejected before any SQL was issued.
    expect(sqlCalls).toHaveLength(0);
  });
});
