/**
 * task-356 — Route-level coverage for /api/jrx/compliance/breach.
 *
 * Specifically guards:
 *   - SECURITY: a caller-supplied `orgId` in the POST body that does not
 *     match the authenticated org context is rejected with 403
 *     `BREACH_ORG_MISMATCH` (no notice / CAM / audit side effects).
 *   - Successful POST uses the auth-context org, not anything in the body.
 *   - Required-field validation surfaces deterministic error codes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const sideEffects = { dispatched: 0, fileCalled: 0, lastInput: null as any };

beforeEach(() => {
  sideEffects.dispatched = 0;
  sideEffects.fileCalled = 0;
  sideEffects.lastInput = null;
});

// Stub the service so the route test isolates request → controller flow
// (the service itself is covered by tests/integration/jrx-breach-notice.test.ts).
vi.mock('../../src/services/compliance/jrx-breach-notice-service.js', () => ({
  fileBreachIncident: vi.fn(async (input: any) => {
    sideEffects.fileCalled += 1;
    sideEffects.dispatched += 1;
    sideEffects.lastInput = input;
    return {
      incidentId: input.incidentId,
      notices: [{
        noticeId: 'bn_test', incidentId: input.incidentId, orgId: input.orgId,
        state: 'NY', recipient: 'NY_RESIDENTS', channel: 'email',
        destination: 'x', template: 't', policyCode: 'POL-US-NYSHIELD-899-bb',
        subject: 's', bodyMarkdown: 'b', metadata: {},
        deliveryStatus: 'queued', providerRef: 'test:bn_test',
      }],
      bipaRecords: [],
    };
  }),
  getBreachIncident: vi.fn(async () => null),
}));

// Auth shim: dualSdkOrJwt is bypassed; req.user is injected from headers.
vi.mock('../../src/middleware/jrx-dual-auth.js', () => ({
  dualSdkOrJwt: (req: any, _res: any, next: any) => {
    const orgId = req.headers['x-test-org'] || 'org-auth';
    const userId = req.headers['x-test-user'] || 'usr-auth';
    req.user = { id: userId, orgId, organizationId: orgId, email: userId + '@test' };
    next();
  },
}));

// Avoid pulling in the real db module.
vi.mock('../../src/db/index.js', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }));

const router = (await import('../../src/routes/jrx-breach-notice-routes.js')).default;

const app = express();
app.use(express.json());
app.use('/api/jrx/compliance/breach', router);

let server: http.Server;
let baseUrl = '';

await new Promise<void>((resolve) => {
  server = app.listen(0, '127.0.0.1', () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  });
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function call(body: any, orgHeader = 'org-auth') {
  return fetch(`${baseUrl}/api/jrx/compliance/breach`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-org': orgHeader },
    body: JSON.stringify(body),
  });
}

const validBody = {
  incidentId: 'inc-route-001',
  natureOfBreach: 'Unauthorised disclosure',
  affectedResidents: [{ state: 'NY', count: 100 }],
  contact: { name: 'Officer', email: 'off@test' },
};

describe('POST /api/jrx/compliance/breach — security + validation', () => {
  it('rejects body.orgId that does not match the auth-context org with 403 BREACH_ORG_MISMATCH', async () => {
    const res = await call({ ...validBody, orgId: 'org-other-tenant' }, 'org-auth');
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe('BREACH_ORG_MISMATCH');
    // No service call, no dispatch, no audit.
    expect(sideEffects.fileCalled).toBe(0);
  });

  it('accepts body.orgId when it matches the auth-context org', async () => {
    const res = await call({ ...validBody, orgId: 'org-auth' }, 'org-auth');
    expect(res.status).toBe(201);
    expect(sideEffects.fileCalled).toBe(1);
    expect(sideEffects.lastInput.orgId).toBe('org-auth');
  });

  it('uses auth-context org when body.orgId is omitted (never trusts the body for org)', async () => {
    const res = await call(validBody, 'org-auth');
    expect(res.status).toBe(201);
    expect(sideEffects.lastInput.orgId).toBe('org-auth');
  });

  it('rejects body.org_id (snake_case alias) that mismatches with 403', async () => {
    const res = await call({ ...validBody, org_id: 'org-other' }, 'org-auth');
    expect(res.status).toBe(403);
    expect(sideEffects.fileCalled).toBe(0);
  });

  it('400 BREACH_INCIDENT_ID_REQUIRED when incidentId missing', async () => {
    const res = await call({ ...validBody, incidentId: '' });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe('BREACH_INCIDENT_ID_REQUIRED');
    expect(sideEffects.fileCalled).toBe(0);
  });

  it('400 BREACH_AFFECTED_RESIDENTS_REQUIRED when buckets empty', async () => {
    const res = await call({ ...validBody, affectedResidents: [] });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe('BREACH_AFFECTED_RESIDENTS_REQUIRED');
  });

  it('400 BREACH_CONTACT_REQUIRED when contact missing email', async () => {
    const res = await call({ ...validBody, contact: { name: 'x', email: '' } });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe('BREACH_CONTACT_REQUIRED');
  });
});
