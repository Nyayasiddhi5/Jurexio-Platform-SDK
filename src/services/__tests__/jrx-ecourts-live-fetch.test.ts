/**
 * NV-ECOURTS-LIVE-FETCH-001 — honest tier attempt tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  attemptEcourtsLiveFetch,
  ECOURTS_LIVE_ATTEMPTED,
} from '../jrx-ecourts-live-fetch.js';

describe('./jrx-ecourts-live-fetch', () => {
  const prevKey = process.env.NYV_ECOURTS_API_KEY;

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevKey === undefined) delete process.env.NYV_ECOURTS_API_KEY;
    else process.env.NYV_ECOURTS_API_KEY = prevKey;
  });

  it('returns attempted when API key absent', async () => {
    delete process.env.NYV_ECOURTS_API_KEY;
    const result = await attemptEcourtsLiveFetch({ cnr: 'TSWL000000742024' });
    expect(result.kind).toBe('attempted');
    if (result.kind === 'attempted') {
      expect(result.tag).toBe(ECOURTS_LIVE_ATTEMPTED);
      expect(result.reason).toContain('NYV_ECOURTS_API_KEY');
    }
  });

  it('maps NIC success to found resolve data with claimEcourts false', async () => {
    process.env.NYV_ECOURTS_API_KEY = 'test-ecourts-key-len-ok';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('case_status_search')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              cnr_number: 'TSWL000000742024',
              petitioner_name: 'State',
              respondent_name: 'Accused',
              case_status: 'Pending',
              court_name: 'District Court',
            }),
          };
        }
        if (u.includes('case_hearings')) {
          return { ok: true, status: 200, json: async () => ({ orders: [] }) };
        }
        return { ok: false, status: 404, text: async () => '{}' };
      }),
    );

    const result = await attemptEcourtsLiveFetch({ cnr: 'TSWL000000742024' });
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.data.status).toBe('found');
      expect(result.data.claimEcourts).toBe(false);
      expect(result.data.sourcesTried).toContain(ECOURTS_LIVE_ATTEMPTED);
    }
  });
});
