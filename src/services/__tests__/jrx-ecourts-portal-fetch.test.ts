/**
 * NV-ECOURTS-PORTAL-FETCH-001 — Tier-4b honest attempt tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  attemptEcourtsPortalFetch,
  ECOURTS_PORTAL_ATTEMPTED,
  isEcourtsPortalFetchEnabled,
} from '../jrx-ecourts-portal-fetch.js';

describe('./jrx-ecourts-portal-fetch', () => {
  const prevFlag = process.env.JRX_F_ECOURTS_PORTAL_FETCH;
  const prevCookie = process.env.JRX_ECOURTS_SESSION_COOKIE;

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.JRX_F_ECOURTS_PORTAL_FETCH;
    else process.env.JRX_F_ECOURTS_PORTAL_FETCH = prevFlag;
    if (prevCookie === undefined) delete process.env.JRX_ECOURTS_SESSION_COOKIE;
    else process.env.JRX_ECOURTS_SESSION_COOKIE = prevCookie;
  });

  it('defaults portal fetch off', () => {
    delete process.env.JRX_F_ECOURTS_PORTAL_FETCH;
    expect(isEcourtsPortalFetchEnabled()).toBe(false);
  });

  it('returns skipped when flag off', async () => {
    delete process.env.JRX_F_ECOURTS_PORTAL_FETCH;
    const result = await attemptEcourtsPortalFetch({ cnr: 'TSWL000000742024' });
    expect(result.kind).toBe('skipped');
  });

  it('returns attempted when session cookie absent', async () => {
    process.env.JRX_F_ECOURTS_PORTAL_FETCH = '1';
    delete process.env.JRX_ECOURTS_SESSION_COOKIE;
    const result = await attemptEcourtsPortalFetch({ cnr: 'TSWL000000742024' });
    expect(result.kind).toBe('attempted');
    if (result.kind === 'attempted') {
      expect(result.tag).toBe(ECOURTS_PORTAL_ATTEMPTED);
      expect(result.reason).toContain('JRX_ECOURTS_SESSION_COOKIE');
    }
  });
});
