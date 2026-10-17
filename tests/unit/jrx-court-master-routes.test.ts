/**
 * NV-COURT-MASTER-P0-001 — partner jurisdiction cascade lookup routes.
 *
 * Exercises the HTTP surface (validation, response shape, cascade wiring) with
 * an injected in-memory provider so no DB is required. Auth + India-scope
 * middleware are stubbed the same way the CNR/caselaw route tests do.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

vi.mock('../../src/middleware/jrx-dual-auth.js', () => ({
  dualSdkOrJwt: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../src/middleware/jrx-partner-india-scope.js', () => ({
  partnerIndiaScopeMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import {
  __setCourtMasterProviderForTests,
  type CourtMasterProvider,
} from '../../src/services/jrx-court-master-lookup.js';

const provider: CourtMasterProvider = {
  async listCourtTypes() {
    return [
      { code: 'sc', name: 'Supreme Court' },
      { code: 'hc', name: 'High Court' },
      { code: 'dc', name: 'District Court' },
    ];
  },
  async listStates(courtType) {
    if (courtType === 'dc') {
      return [
        { code: '2', name: 'Andhra Pradesh' },
        { code: '29', name: 'Karnataka' },
      ];
    }
    return [{ code: 'Andhra Pradesh', name: 'Andhra Pradesh' }];
  },
  async listDistricts(courtType, state) {
    if (courtType !== 'dc') return [];
    if (state === '2' || state.toLowerCase() === 'andhra pradesh') {
      return [
        { code: '2', name: 'Ananthapur' },
        { code: '3', name: 'Chittoor' },
      ];
    }
    return [];
  },
  async listComplexes(courtType, state, district) {
    if (courtType !== 'dc') return [];
    if ((state === '2' || state.toLowerCase() === 'andhra pradesh') && district === '2') {
      return [
        { code: '1020002', name: 'Court of Senior Civil Judge, Penukonda', courtNumbers: '11,12' },
      ];
    }
    return [];
  },
  async listCaseTypes(courtType, state) {
    if (courtType === 'hc') {
      return [
        { code: 'WP', displayName: 'Writ Petition', stateCode: '' },
        ...(state === 'AP' ? [{ code: 'CRLP', displayName: 'Criminal Petition', stateCode: 'AP' }] : []),
      ];
    }
    return [];
  },
};

let base: string;
let server: Server;

beforeAll(async () => {
  __setCourtMasterProviderForTests(provider);
  const { default: router } = await import('../../src/routes/jrx-court-master-routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/jrx/v1/sdk/jurisdiction', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  __setCourtMasterProviderForTests(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/jrx/v1/sdk/jurisdiction${path}`);
  return { status: res.status, body: await res.json() };
}

describe('court-master lookup routes', () => {
  it('GET /court-types returns sc/hc/dc with claimEcourts:false', async () => {
    const { status, body } = await get('/court-types');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.claimEcourts).toBe(false);
    expect(body.source).toBe('nyv_court_master');
    expect(body.data.courtTypes.map((c: any) => c.code)).toEqual(['sc', 'hc', 'dc']);
    expect(body.data.count).toBe(3);
  });

  it('GET /states requires courtType', async () => {
    const { status, body } = await get('/states');
    expect(status).toBe(400);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /states?courtType=dc lists DC states', async () => {
    const { status, body } = await get('/states?courtType=dc');
    expect(status).toBe(200);
    expect(body.data.courtType).toBe('dc');
    expect(body.data.states).toContainEqual({ code: '2', name: 'Andhra Pradesh' });
    expect(body.data.count).toBe(2);
  });

  it('GET /states?courtType=hc lists HC benches (state name as code)', async () => {
    const { body } = await get('/states?courtType=hc');
    expect(body.data.states[0].name).toBe('Andhra Pradesh');
  });

  it('GET /districts requires courtType and state', async () => {
    expect((await get('/districts?courtType=dc')).status).toBe(400);
    expect((await get('/districts?state=2')).status).toBe(400);
  });

  it('GET /districts?courtType=dc&state=2 lists districts (by code or name)', async () => {
    const byCode = await get('/districts?courtType=dc&state=2');
    expect(byCode.status).toBe(200);
    expect(byCode.body.data.districts).toContainEqual({ code: '2', name: 'Ananthapur' });
    const byName = await get('/districts?courtType=dc&state=Andhra%20Pradesh');
    expect(byName.body.data.count).toBe(2);
  });

  it('GET /complexes requires courtType, state, district', async () => {
    expect((await get('/complexes?courtType=dc&state=2')).status).toBe(400);
  });

  it('GET /complexes?courtType=dc&state=2&district=2 lists complexes', async () => {
    const { status, body } = await get('/complexes?courtType=dc&state=2&district=2');
    expect(status).toBe(200);
    expect(body.data.complexes).toEqual([
      { code: '1020002', name: 'Court of Senior Civil Judge, Penukonda', courtNumbers: '11,12' },
    ]);
  });

  it('GET /case-types?courtType=hc returns state-agnostic + state-specific rows', async () => {
    const anyState = await get('/case-types?courtType=hc');
    expect(anyState.body.data.caseTypes.map((c: any) => c.code)).toEqual(['WP']);
    const withState = await get('/case-types?courtType=hc&state=AP');
    expect(withState.body.data.caseTypes.map((c: any) => c.code).sort()).toEqual(['CRLP', 'WP']);
  });

  it('rejects an invalid courtType', async () => {
    expect((await get('/states?courtType=zz')).status).toBe(400);
  });
});
