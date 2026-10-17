import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attemptEcourtsIndiaLiveFetch } from '../jrx-ecourtsindia-live-fetch.js';

describe('attemptEcourtsIndiaLiveFetch', () => {
  const prev = process.env.JRX_ECOURTSINDIA_API_KEY;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (prev === undefined) delete process.env.JRX_ECOURTSINDIA_API_KEY;
    else process.env.JRX_ECOURTSINDIA_API_KEY = prev;
  });

  it('maps partner case payload to found resolve', async () => {
    process.env.JRX_ECOURTSINDIA_API_KEY = 'eci_live_test_key_len_ok';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: {
            courtCaseData: {
              cnr: 'TSWL000000742024',
              courtName: 'Test Court',
              caseStatus: 'PENDING',
              petitioners: ['A'],
              respondents: ['B'],
            },
          },
        }),
    });

    const result = await attemptEcourtsIndiaLiveFetch({ cnr: 'TSWL000000742024' });
    expect(result.kind).toBe('found');
    if (result.kind === 'found') {
      expect(result.data.source).toBe('ecourtsindia_live');
      expect(result.data.claimEcourts).toBe(false);
      expect(result.data.fields.petitioner?.value).toBe('A');
    }
  });
});
