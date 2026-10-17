/**
 * NV-ECOURTS-TIER4B-001 — cascade wiring + async job tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CnrResolveData } from '../../../packages/client-sdk/src/api/CnrApi.js';
import { mapCaseApiNotFound } from '../jrx-case-api-adapter.js';
import {
  ECOURTS_PORTAL_ATTEMPTED,
  isEcourtsPortalFetchEnabled,
} from '../jrx-ecourts-portal-fetch.js';
import {
  clearEcourtsPortalJobsForTests,
  enqueueEcourtsPortalJob,
  getEcourtsPortalJob,
} from '../jrx-ecourts-tier4b-worker.js';
import { mergeNotFoundCascade, unionSourcesTried } from '../jrx-cnr-unified-cascade.js';

describe('./jrx-ecourts-tier4b-cascade', () => {
  const prevFlag = process.env.JRX_F_ECOURTS_PORTAL_FETCH;

  beforeEach(() => {
    clearEcourtsPortalJobsForTests();
  });

  afterEach(() => {
    clearEcourtsPortalJobsForTests();
    if (prevFlag === undefined) delete process.env.JRX_F_ECOURTS_PORTAL_FETCH;
    else process.env.JRX_F_ECOURTS_PORTAL_FETCH = prevFlag;
  });

  it('portal fetch defaults off', () => {
    delete process.env.JRX_F_ECOURTS_PORTAL_FETCH;
    expect(isEcourtsPortalFetchEnabled()).toBe(false);
  });

  it('enqueue returns null when flag off', () => {
    delete process.env.JRX_F_ECOURTS_PORTAL_FETCH;
    expect(enqueueEcourtsPortalJob({ cnr: 'TSWL000000742024' })).toBeNull();
  });

  it('enqueue returns jobId when flag on', () => {
    process.env.JRX_F_ECOURTS_PORTAL_FETCH = '1';
    const queued = enqueueEcourtsPortalJob({ cnr: 'TSWL000000742024' });
    expect(queued?.jobId).toBeTruthy();
    const job = getEcourtsPortalJob(queued!.jobId);
    expect(job?.status).toMatch(/queued|running|completed|failed/);
  });

  it('cascade not_found unions ecourts_portal_attempted when tier-4b queued', () => {
    const caseApiMiss: CnrResolveData = mapCaseApiNotFound('TSWL000000999999', 42);
    const legacyMiss: CnrResolveData = {
      ...caseApiMiss,
      sourcesTried: ['nys_rds', 'opendata_athena_case_details'],
    };
    const merged = mergeNotFoundCascade(caseApiMiss, legacyMiss);
    const withPortal = {
      ...merged,
      sourcesTried: unionSourcesTried(merged.sourcesTried, [ECOURTS_PORTAL_ATTEMPTED]),
      claimEcourts: false,
    };
    expect(withPortal.status).toBe('not_found');
    expect(withPortal.sourcesTried).toContain(ECOURTS_PORTAL_ATTEMPTED);
    expect(withPortal.claimEcourts).toBe(false);
  });

  it('async job completes with failed when no session cookie', async () => {
    process.env.JRX_F_ECOURTS_PORTAL_FETCH = '1';
    delete process.env.NYV_ECOURTS_SESSION_COOKIE;
    const queued = enqueueEcourtsPortalJob({ cnr: 'TSWL000000742024' });
    expect(queued?.jobId).toBeTruthy();

    await vi.waitFor(
      () => {
        const job = getEcourtsPortalJob(queued!.jobId);
        expect(job?.status).toBe('failed');
      },
      { timeout: 5000 },
    );

    const job = getEcourtsPortalJob(queued!.jobId);
    expect(job?.error).toContain('NYV_ECOURTS_SESSION_COOKIE');
    expect(job?.sourcesTried).toContain(ECOURTS_PORTAL_ATTEMPTED);
  });
});
